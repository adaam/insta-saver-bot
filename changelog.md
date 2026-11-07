# Changelog

All notable changes to this project are documented in this file.

## 2026-11-07 — Twitter/X photo and video downloads

### Added

- Added platform-aware URL parsing for public `x.com`, `twitter.com`, and
  `mobile.twitter.com` status URLs.
- Added automatic removal of URL query parameters and fragments before a
  Twitter/X URL reaches either downloader.
- Added yt-dlp 2026.2.4 for public Tweet videos and animated GIFs.
- Added gallery-dl 1.32.19 for public Tweet photos. It runs with guest access,
  `--no-input`, no cookies, and video downloading disabled.
- Added support for photo-only, video-only, multi-photo, multi-video, and mixed
  photo/video Tweets.
- Added `src/ytdlp.js` to download and remux Twitter/X videos to MP4, parse
  machine-readable completed-file records, and validate every output path.
- Added `src/gallerydl.js` to download original Twitter/X images, discover the
  owner username, and preserve photo position order.
- Added `src/twitter.js` to coordinate both downloaders, combine their media,
  deduplicate concurrent requests, and manage one complete cache manifest per
  Tweet.
- Added `src/fxtwitter.js` as a restricted fallback for public Tweets that the
  direct extractors report as unavailable or login-required. It validates the
  requested Tweet ID, permits only `pbs.twimg.com` and `video.twimg.com` media
  URLs, validates response content types, and uses atomic temporary files.
- Added `TWITTER_FALLBACK_API`, defaulting to `https://api.fxtwitter.com`; set
  it to `off` to disable third-party fallback.
- Added Twitter/X storage under:

  ```text
  twitter/<username>/<tweet-id>_<position>.<image-extension>
  twitter/<username>/<tweet-id>_<media-id>.mp4
  twitter/.cache/<tweet-id>.json
  ```

- Added configuration for `YTDLP_BIN`, `GALLERYDL_BIN`, and
  `TWITTER_DOWNLOAD_DIR`.
- Added a detailed implementation and rollback plan in
  `design/20261107_twitter_download.md`.
- Added automated coverage for Twitter/X hostname and status-path validation,
  URL cleanup, Tweet ID validation, photo discovery and ordering, yt-dlp output
  parsing, no-video classification, path containment, and mixed-media cache
  loading.

### Changed

- Generalized the Telegram media uploader so Instagram and Twitter/X share the
  same `sendPhoto`, `sendVideo`, and `sendMediaGroup` behavior.
- Updated the bot welcome message, routing, logs, captions, and errors for both
  supported platforms.
- Added FFmpeg to the documented runtime requirements.
- Added `twitter/` to `.gitignore`.

### Fixed

- Fixed Telegram `413 Request Entity Too Large` failures for downloaded videos
  above the public Bot API's 50 MB multipart limit.
- Added `src/telegramPrepare.js` to measure every local file and create a
  two-pass H.264/AAC `.telegram.mp4` copy when a video exceeds the default
  47,000,000-byte safety limit. Original downloads are preserved.
- Added optional prepared-video caching with `TELEGRAM_TRANSCODE_CACHE=true`.
  It is disabled by default, so generated Telegram upload copies are removed
  after a successful or failed upload instead of consuming permanent storage.
- Changed Telegram media grouping to split not only at 10 items, but also when
  the combined local upload size would exceed the safe request size.
- Enabled `NTBA_FIX_350` before loading `node-telegram-bot-api`, adopting its
  future content-type behavior and removing that package's file content-type
  deprecation warning.
- Added `TELEGRAM_MAX_UPLOAD_BYTES`, `TRANSCODE_TIMEOUT_MS`, and
  `TELEGRAM_TRANSCODE_CACHE` configuration.

### Reliability and safety

- Twitter/X URLs must use HTTPS and an exact supported hostname; lookalike
  domains and non-numeric Tweet IDs are rejected.
- yt-dlp and gallery-dl are launched with `spawn()` argument arrays without a
  shell.
- Neither downloader receives Twitter/X credentials, cookies, or browser
  state.
- The fallback sends only the requested Tweet ID to FxTwitter. It does not send
  Twitter credentials, browser state, Telegram identity, or chat information.
- A pure-photo Tweet's explicit yt-dlp `No video formats found` result is
  treated as an expected empty video list. Other yt-dlp errors remain fatal.
- A manifest is written only after the photo and video passes finish, and cache
  entries are accepted only when every path stays within the configured root
  and points to an existing supported media file.

### Verification

- Confirmed an anonymous four-photo Tweet download for Tweet
  `894001459754180609` under `perrypumas/`.
- Confirmed an anonymous video Tweet download for Tweet
  `1790637656616943991` under `historyinmemes/`.
- Confirmed an anonymous mixed photo/video Tweet download for Tweet
  `1577924293023133696` under `carrotsprout_/`.
- Confirmed yt-dlp output is remuxed to MP4 and gallery-dl images retain their
  media position.
- Confirmed fallback download of the otherwise direct-extractor-inaccessible
  Tweet `2118719623319396658`, producing one MP4 and one JPEG under
  `sunfish_g/` in original media order.
- Confirmed all 21 automated tests, JavaScript syntax checks, and
  `git diff --check` pass after the fallback fix.
- Confirmed a 61,821,313-byte, 262-second, 720×1280 MP4 that previously caused
  Telegram HTTP 413 is converted to a 45,306,419-byte H.264/AAC MP4 while
  retaining its duration and resolution. A default-cache-disabled integration
  test completed in 37.83 seconds and confirmed the prepared file was removed.
- Expanded the automated suite to 26 passing tests for upload-size preparation,
  optional transcode caching, temporary-file cleanup, and media-group splitting.

### Limitations

- Twitter/X guest access can change or be rate-limited without notice.
- The optional fallback depends on a third-party public API and discloses the
  requested Tweet ID to that service.
- Private, deleted, login-required, age-restricted, or otherwise unavailable
  Tweets may fail.
- This first integration accepts individual status URLs only; Spaces,
  broadcasts, timelines, searches, and arbitrary `t.co` redirects are not
  routed by the bot.
- Telegram file-size and media-format limits still apply.

## 2026-11-07 — Instaloader media download support

Commit: `56b751f feat: support Instagram photo and video downloads`

This release replaces the previous hard-coded Instagram GraphQL request flow
with a local Instaloader-based download pipeline. The Telegram bot now saves
public Instagram media locally before uploading it to Telegram and does not
require an Instagram account or session.

### Added

- Added Instaloader 4.16 as a pinned Python dependency in
  `requirements.txt`.
- Added `src/instaloader.js` to run Instaloader as a child process without a
  shell. This avoids interpolating user input into shell commands.
- Added support for downloading public Instagram content by shortcode:
  - Single-image posts.
  - Single-video posts and Reels.
  - Photo carousels.
  - Video carousels.
  - Mixed photo and video carousels.
- Added automatic Instagram username detection through Instaloader's
  `{profile}` directory pattern.
- Added local media storage using the following layout:

  ```text
  ig/<instagram-username>/<shortcode>.jpg
  ig/<instagram-username>/<shortcode>.mp4
  ig/<instagram-username>/<shortcode>_1.jpg
  ig/<instagram-username>/<shortcode>_2.mp4
  ```

- Added a manifest cache under `ig/.cache/`. A cached response is used only
  when every file listed in the manifest still exists. This prevents an
  incomplete carousel from being treated as a complete download.
- Added in-process download deduplication. Concurrent Telegram requests for
  the same shortcode share one active download instead of starting multiple
  Instaloader processes.
- Added a configurable download timeout through `DOWNLOAD_TIMEOUT_MS`.
- Added support for an alternative Instaloader executable through
  `INSTALOADER_BIN`.
- Added `src/telegramMedia.js` to select the correct Telegram API method:
  - `sendPhoto` for one photo.
  - `sendVideo` for one video.
  - `sendMediaGroup` for photo/video carousels.
- Added automatic splitting of carousels into groups of at most 10 items to
  respect Telegram's media-group limit. A final single-item remainder is sent
  with `sendPhoto` or `sendVideo`.
- Added explicit filenames and MIME content types for Telegram file uploads.
  This also prepares the bot for the future `node-telegram-bot-api`
  content-type behavior.
- Added automated tests for URL validation, shortcode validation, media-file
  detection and ordering, single-photo uploads, mixed media groups, and
  Telegram's 10-item group limit.

### Changed

- Changed the bot input flow to accept both `/reel/<shortcode>/` and
  `/p/<shortcode>/` Instagram URLs.
- Changed downloads from remote URL forwarding to local-file uploads. Telegram
  now receives the file produced by Instaloader rather than being asked to
  fetch an Instagram CDN URL.
- Changed the local output path from shortcode-only folders to username
  folders with shortcode-based filenames.
- Changed the welcome and error messages to describe photos, videos, Reels,
  posts, and carousels instead of video-only behavior.
- Changed URL cleaning to use URL parsing and exact hostname validation. This
  rejects lookalike domains such as `instagram.com.example.com` and requires
  HTTPS.
- Disabled video-thumbnail downloads so video posts do not produce an extra
  photo that would be uploaded alongside the video.
- Disabled caption and metadata JSON downloads because they are not used by
  the Telegram upload flow.
- Updated the README and environment example for the Instaloader setup and new
  download behavior.
- Removed the unused Axios dependency.

### Removed

- Removed `src/apis.js`, which depended on private Instagram GraphQL query
  identifiers, browser headers, and hard-coded cookies that could expire or be
  blocked.
- Removed the old manual API test script at `scripts/test.js`.
- Removed the old direct Instagram CDN download implementation from
  `src/index.js`.

### Reliability and safety

- Instagram shortcodes are restricted to letters, digits, underscores, and
  hyphens before they are passed to Instaloader.
- Instaloader is launched with `spawn()` and an argument array rather than a
  shell command.
- Downloaded-file discovery only accepts supported image extensions and MP4.
- Cache manifest paths are resolved and checked to ensure they stay inside the
  configured download directory.
- The bot catches download and Telegram upload failures and attempts to remove
  its temporary status message without crashing the polling process.

### Verification

- Confirmed an anonymous public Reel download with Instaloader.
- Confirmed an anonymous public photo download using shortcode
  `B_K4CykAOtf`, saved as `instagram/B_K4CykAOtf.jpg`.
- Confirmed that a second request uses the local manifest cache.
- All seven automated tests pass with `npm test`.
- JavaScript syntax checks and `git diff --check` pass.

### Limitations

- Only public content that Instagram exposes to logged-out Instaloader requests
  is supported.
- Private, deleted, age-restricted, region-restricted, or temporarily blocked
  posts may fail.
- Instagram can change its logged-out access behavior at any time, so some
  public posts may eventually require a session even though this bot does not
  currently use one.
- Telegram file-size and media-format limits still apply when uploading
  downloaded files.
