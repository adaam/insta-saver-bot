# Twitter/X download implementation plan

Date: 2026-11-07

## Goal

Extend the existing Telegram bot so a user can send a public Twitter/X status
URL and receive its downloadable photos, videos, or animated GIFs. Instagram
behavior must remain unchanged: Instagram continues to use Instaloader, while
Twitter/X uses yt-dlp and gallery-dl.

No Twitter/X login or browser cookies will be configured. Content that the
downloaders cannot access while logged out must fail with a clear Telegram
message.

## Confirmed downloader behavior

The locally installed yt-dlp version is `2026.02.04`. Its Twitter extractor
accepts `twitter.com` and `x.com` status URLs and can return one video or a
playlist when a Tweet contains multiple video entries.

The extractor deliberately filters out media whose type is `photo`. Therefore:

- Public Tweet videos are in scope.
- Animated GIFs, which Twitter serves as video, are in scope.
- Tweets containing multiple downloadable videos are in scope.
- Pure static-photo Tweets cannot be implemented with yt-dlp alone.
- Spaces, broadcasts, cards, and arbitrary `t.co` redirects are not included in
  the first bot integration even though yt-dlp has separate extractors for
  some of them.

FFmpeg is available locally and will be required to merge or remux output to
MP4 for predictable Telegram uploads.

The official gallery-dl `1.32.19` Twitter extractor supports individual Tweet
URLs, original static images, and unauthenticated guest-token access. Its
`extractor.twitter.videos=false` setting skips video items while retaining
photos, including photos in a mixed-media Tweet. It will therefore be used as
the photo-specific companion to yt-dlp:

- yt-dlp downloads videos and animated GIFs.
- gallery-dl downloads JPG, PNG, and WebP photos.
- Neither downloader receives account credentials or browser cookies.
- If Twitter/X stops allowing guest access, the request fails rather than
  silently switching to a logged-in browser session.

Some public, sensitive, Community, or newly published Tweets can still return
`Unavailable` or require authenticated cookies from both direct extractors.
For those access-restriction errors only, the coordinator uses the public
FxTwitter API as a metadata fallback. FxTwitter returns direct Twitter CDN
URLs; the bot downloads those files locally and never asks Telegram to fetch
the third-party URL. Operators can set `TWITTER_FALLBACK_API=off` to disable
this behavior.

## User flow

1. The user sends an HTTPS Instagram, Twitter, or X URL to the Telegram bot.
2. The bot parses the URL, validates the exact hostname, removes all query
   parameters and fragments, and identifies the platform.
3. Instagram URLs continue through the existing shortcode and Instaloader
   path.
4. Twitter/X status URLs are normalized and sent to the Twitter coordinator.
5. gallery-dl downloads all static photos while explicitly skipping videos.
6. yt-dlp downloads all video entries, remuxes them to MP4, and prints one
   machine-readable result record per completed file. Finding no video is a
   normal result when gallery-dl found photos.
7. If a direct extractor reports an access restriction, or both direct lists
   are empty, FxTwitter supplies an ordered photo/video list as a fallback.
8. The two ordered media lists, or fallback list, are validated before a cache
   manifest is written.
9. The bot uploads one item with `sendPhoto` or `sendVideo`, or multiple items
   with `sendMediaGroup` in groups of at most 10.
10. Completed media are retained locally and reused on repeated requests.

## URL validation and normalization

Add a platform-aware parser in `src/helper.js`.

Accepted Instagram hosts:

- `instagram.com`
- `www.instagram.com`

Accepted Twitter/X hosts:

- `x.com`
- `www.x.com`
- `twitter.com`
- `www.twitter.com`
- `mobile.twitter.com`

Only HTTPS is accepted. Twitter/X paths must match a status URL and contain a
numeric Tweet ID, for example:

```text
https://x.com/<username>/status/<tweet-id>
https://twitter.com/<username>/status/<tweet-id>
```

Before download, both `URL.search` and `URL.hash` are cleared. For example:

```text
https://x.com/user/status/123?s=20&t=value
```

becomes:

```text
https://x.com/user/status/123
```

Lookalike hosts such as `x.com.example.com` remain rejected.

## Download module

Create `src/twitter.js` as the public coordinator with the same external result
shape used by the Instaloader module:

```js
{
  username: 'account',
  mediaFiles: [
    { filePath: '/absolute/path/photo.jpg', mediaType: 'photo' },
    { filePath: '/absolute/path/video.mp4', mediaType: 'video' }
  ],
  cached: false
}
```

Create `src/ytdlp.js` as the video downloader. Implementation rules:

- Find yt-dlp using `YTDLP_BIN`, then `.venv/bin/yt-dlp`, then `yt-dlp` from
  `PATH`.
- Launch with `spawn()` and an argument array; never interpolate the URL into a
  shell command.
- Apply `DOWNLOAD_TIMEOUT_MS` to the child process.
- Enable `--no-progress` and `--no-warnings` so stdout can be parsed reliably.
- Use an `after_move` print template that emits one JSON record for every final
  file path and its metadata.
- Use `--remux-video mp4` and `--merge-output-format mp4` so Telegram receives
  MP4 files.
- Do not pass `--no-playlist`, because a Tweet may expose more than one video.
- Use restricted filenames and a template containing both Tweet display ID
  and media ID to prevent collisions.
- Use `--ignore-no-formats-error`. A successful process with no reported file,
  or yt-dlp's explicit `No video formats found` result, is returned as an empty
  video list because a pure-photo Tweet legitimately has no yt-dlp formats.
  Other non-zero exits remain failures.
- Reject printed paths outside the configured Twitter download root.

Create `src/gallerydl.js` as the photo downloader. Implementation rules:

- Find gallery-dl using `GALLERYDL_BIN`, then `.venv/bin/gallery-dl`, then
  `gallery-dl` from `PATH`.
- Launch with `spawn()` and an argument array, with the same timeout policy.
- Pass `--no-input` so it never prompts for credentials.
- Set `extractor.twitter.videos=false`, `quoted=false`, and `retweets=false` so
  only photos belonging to the requested Tweet are collected.
- Use gallery-dl's guest authentication; never pass cookies or browser state.
- Download into a username directory using gallery-dl's `{user[name]}` field,
  with filenames containing Tweet ID and media position.
- Scan only direct username directories for exact Tweet-ID filenames and
  supported image extensions.
- A successful run with no photos returns an empty photo list, which is normal
  for video-only Tweets.

`src/twitter.js` runs both downloaders, combines their results, requires at
least one media file, writes the shared manifest, and deduplicates simultaneous
requests for the same Tweet ID in memory. If either downloader has a real
network/authentication/process error, the request fails and no incomplete
manifest is written.

Create `src/fxtwitter.js` as the restricted fallback downloader:

- Call `<TWITTER_FALLBACK_API>/status/<tweet-id>` only after a recognized
  access error or an empty direct result.
- Verify the response Tweet ID exactly matches the requested ID.
- Accept only HTTPS media URLs hosted by `pbs.twimg.com` or
  `video.twimg.com`.
- Accept only JPEG, PNG, WebP, and MP4 response content types.
- Stream each response to a `.part` file and atomically rename it when the
  download completes.
- Preserve the fallback API's original media order.
- Do not send credentials, cookies, Telegram identity, or chat information to
  the fallback API. The Tweet ID is disclosed to the third-party service.

## Storage and cache

Add a configurable root:

```text
TWITTER_DOWNLOAD_DIR=twitter
```

Store files as:

```text
twitter/<twitter-username>/<tweet-id>_<media-id>.mp4
twitter/<twitter-username>/<tweet-id>_<position>.jpg
```

Store a manifest as:

```text
twitter/.cache/<tweet-id>.json
```

The manifest records the username and relative photo/video paths. Cache hits
are accepted only when every listed file still exists, has a supported image
extension or `.mp4`, and resolves inside the Twitter download root. A missing
or invalid manifest causes both downloaders to run again.

## Telegram integration

Generalize `src/telegramMedia.js` so the same uploader can be used for both
platforms. Keep the current Instagram export as a compatibility alias if
useful.

The caption identifies the source and account:

```text
X/Twitter: @<username> (<tweet-id>)
```

Expected errors are translated into a short user-facing message covering:

- Tweet has no downloadable photo, video, or animated GIF.
- Tweet is private, deleted, unavailable, age-restricted, or login-required.
- Twitter/X temporarily blocked the anonymous request.
- yt-dlp, gallery-dl, or FFmpeg is unavailable.
- The configured fallback service is disabled or unavailable.

Detailed yt-dlp stderr remains in server logs, not in Telegram messages.

## Dependencies and configuration

- Add `yt-dlp==2026.2.4` to `requirements.txt`.
- Add `gallery-dl==1.32.19` to `requirements.txt`.
- Document FFmpeg as a runtime requirement.
- Add `YTDLP_BIN`, `GALLERYDL_BIN`, and `TWITTER_DOWNLOAD_DIR` to
  `example.env`.
- Add `TWITTER_FALLBACK_API`, defaulting to `https://api.fxtwitter.com`; the
  value `off` disables third-party fallback.
- Add `twitter/` to `.gitignore`.
- Update the README setup, supported URL types, storage paths, and anonymous
  access limitations.

## Tests

Add automated tests for:

- Removing query parameters and fragments from X/Twitter URLs.
- Accepting `x.com`, `twitter.com`, and supported host variants.
- Rejecting HTTP, lookalike domains, non-status paths, and non-numeric Tweet
  IDs.
- Routing Instagram and Twitter/X URLs to the correct platform.
- Parsing multiple yt-dlp result records in their original order.
- Detecting multiple gallery-dl photos and ordering them by media position.
- Rejecting missing, unsupported, or out-of-root result paths.
- Loading a valid Twitter manifest cache.
- Parsing FxTwitter mixed media in original order and rejecting untrusted CDN
  hosts or mismatched Tweet IDs.
- Limiting fallback activation to recognized access restrictions.
- Using the shared Telegram uploader for one or multiple videos.
- Preserving all existing Instagram tests.

Run the following verification before handoff:

```bash
npm test
node --check src/index.js
node --check src/ytdlp.js
node --check src/gallerydl.js
node --check src/fxtwitter.js
node --check src/twitter.js
node --check src/telegramMedia.js
git diff --check
```

Anonymous live downloads should be attempted with a known public video Tweet
and a known public photo Tweet. The user will perform the final Telegram
end-to-end test before any commit or push.

## Rollback

The integration is isolated by platform routing. If Twitter/X extraction
becomes unreliable, remove or disable the Twitter/X routing branch and its
four downloader/coordinator modules; the existing Instagram Instaloader flow
remains independent.
