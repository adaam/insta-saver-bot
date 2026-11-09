# Worklog and agent handoff

Last updated: 2026-11-09 (Asia/Singapore)

## Repository state and safety notes

- Active branch: `adam`; remote branch: `adaam/adam`.
- Latest pushed commit before the current task: `6ec7829 feat: log failed downloads as TSV`.
- Do not add unrelated user files or directories to commits. At the start of
  this task these included `386460175_1781674775620267_8815677642002611161_n.jpg`,
  `old/`, `run.sh`, `run2.sh`, `src/instagramAuth.js`, and `today/`.
- On 2026-11-09 the user approved the Telegram video metadata, explicit 429
  message, and persistent retry changes for commit and push. Only related
  source, tests, README, changelog, and this worklog belong in that commit.

## Work completed before this task

### Instagram download migration

- Replaced the unreliable previous Instagram path with Instaloader 4.16.
- Telegram accepts public Instagram Reel, post, TV, and carousel URLs.
- Query strings and fragments are removed before processing.
- Photos and videos are downloaded without Instagram login where public guest
  access permits it.
- Media is stored by owner under `ig/<username>/` and a validated manifest is
  stored under `ig/.cache/`.
- Multi-photo, multi-video, and mixed carousel ordering is preserved.
- Relevant pushed commits:
  - `56b751f feat: support Instagram photo and video downloads`
  - `3b94d56 docs: add detailed Instaloader changelog`

### Twitter/X photo and video support

- Added strict parsing for individual `x.com`, `twitter.com`, and
  `mobile.twitter.com` status URLs; query strings and fragments are removed.
- gallery-dl 1.32.19 downloads public static photos.
- yt-dlp 2026.2.4 downloads/remuxes public videos and animated GIFs to MP4.
- A restricted FxTwitter fallback handles recognized anonymous-access
  failures. It validates the Tweet ID and permits media only from
  `pbs.twimg.com` and `video.twimg.com`.
- Files are stored under `twitter/<username>/`; complete manifests live under
  `twitter/.cache/`.
- Public test coverage included photo Tweet `894001459754180609`, video Tweet
  `1790637656616943991`, mixed Tweet `1577924293023133696`, and fallback Tweet
  `2118719623319396658`.
- Detailed original plan: `design/20261107_twitter_download.md`.
- Pushed commit: `da65f3a feat: support Twitter photo and video downloads`.

### Telegram 413 handling and optional transcode cache

- A 61,821,313-byte Twitter MP4 caused Telegram HTTP 413 because the public Bot
  API multipart limit is 50 MB.
- `src/telegramPrepare.js` now measures files and uses two-pass FFmpeg H.264/AAC
  compression above a 47,000,000-byte safety limit.
- The original download is never overwritten.
- Prepared video caching is disabled by default. Temporary transcodes are
  deleted after successful or failed upload. Set
  `TELEGRAM_TRANSCODE_CACHE=true` to retain/reuse `.telegram.mp4` files.
- `TELEGRAM_MAX_UPLOAD_BYTES` and `TRANSCODE_TIMEOUT_MS` are configurable.
- Media groups split at either 10 items or the cumulative safe byte limit.
- `NTBA_FIX_350=1` is set before loading `node-telegram-bot-api` to use explicit
  file content types and suppress its related deprecation warning.
- The reported 262-second, 720x1280 source compressed to 45,306,419 bytes in
  37.83 seconds on the user's machine. Default-mode cleanup was verified.
- Pushed commit: `0a7a1d3 fix: compress oversized Telegram videos`.

### Failed-download TSV log

- Downloader failures append to ignored runtime file `failed.txt`.
- Format is headerless TSV with exactly two fields:
  `<UTC ISO-8601 timestamp>\t<cleaned media URL>`.
- Only Instagram/Twitter downloader failures are logged; Telegram upload and
  FFmpeg preparation failures are intentionally excluded.
- Tabs and line breaks are sanitized to keep records parseable.
- Pushed commit: `6ec7829 feat: log failed downloads as TSV`.

## Current issue: Telegram reports wrong video width/height

The user observed incorrect width/height on Telegram for some Twitter and
Instagram videos. Both platforms share `src/telegramMedia.js`, so the issue is
in the common upload path rather than one downloader.

Investigated example:

```text
twitter/edge_him/2118586009323753511_1940654222271565824.mp4
```

Probe and decode results:

- File size: about 15 MiB.
- Video: H.264 High, yuv420p, 1080x1920, SAR 1:1, DAR 9:16, 50 fps.
- Audio: AAC stereo, 48 kHz.
- Duration: 120.064 seconds.
- No rotation metadata or display-matrix rotation.
- A decoded frame is correctly portrait at 1080x1920.
- MP4 `moov` precedes `mdat`, so the example is streamable.

Conclusion: this example's file metadata and pixels are correct. The shared
uploader currently omits `width`, `height`, `duration`, and
`supports_streaming`, forcing Telegram to infer them. Telegram Bot API supports
those fields for both `sendVideo` and `InputMediaVideo` media-group items.

## Telegram metadata implementation status

Completed and approved for delivery:

1. `src/telegramPrepare.js` now runs ffprobe for every prepared video after any
   size-based transcode.
2. It reads width, height, duration, rotate tags, and display-matrix rotation
   from the first video stream.
3. Rotation is normalized; 90-degree and 270-degree display rotations swap the
   reported width and height.
4. Duration is rounded to a positive whole number accepted by Telegram.
5. Each prepared video carries
   `{ width, height, duration, supports_streaming: true }` metadata.
6. `src/telegramMedia.js` passes that metadata through both single `sendVideo`
   calls and video entries in `sendMediaGroup`.
7. Tests cover portrait metadata, rotate tags, display-matrix rotation, single
   video options, and media-group options.
8. The complete automated suite, JavaScript syntax checks, and
   `git diff --check` pass; after the later retry work the suite contains 38
   tests.
9. The real reported Twitter file was checked through the new reader and
   produced exactly:

   ```json
   {
     "width": 1080,
     "height": 1920,
     "duration": 120,
     "supports_streaming": true
   }
   ```
10. An existing Instaloader MP4 under `ig/siniy.kot_/` was also probed through
    the new reader and returned 720x1280, 34 seconds, and streaming support,
    confirming the same code path works with both download sources.

Post-deployment checks:

1. User live-tests at least one affected Twitter/X video and one affected
   Instagram video, including a media group/carousel if available.
2. If Telegram still displays incorrect dimensions, capture the `video` object
   returned by Telegram's sent Message so local metadata can be compared with
   Telegram's stored width and height.
3. Inspect new six-column `failed.txt` records after a real failure and confirm
   the one-hour or twelve-hour retry uploads to the recorded chat.

## Instagram failure diagnosis and HTTP 429 message

On 2026-11-09, `failed.txt` showed a burst of Instagram failures, including
nine different URLs submitted within about 83 seconds. The installed and
pinned Instaloader version is 4.16, which was the latest official release, so
there was no newer version to install.

Two URLs from the failure log were retested anonymously with Instaloader 4.16:

- Post `DfgY1IJkXqf` downloaded all six images in about 78 seconds.
- Reel `DfNfZCUy2t3` downloaded its MP4 in about 33 seconds.

This confirmed direct shortcode downloads still work. The likely cause of the
burst is Instagram throttling or transient API latency: the bot deduplicates
only identical shortcodes, so different URLs can start separate Instaloader
processes concurrently. A future reliability change should serialize all
Instagram jobs and align Instaloader's request timeout (default 300 seconds)
with the bot's overall download timeout (default 120 seconds).

Implemented behavior:

- `isInstagramRateLimitError()` recognizes only explicit HTTP 429 / Too Many
  Requests errors from Instaloader stderr.
- Confirmed 429 failures return the dedicated Telegram message:
  `Instagram rate limit reached (HTTP 429 Too Many Requests). Please wait before trying again.`
- Timeouts, `feedback_required` HTTP 400 responses, private posts, and other
  failures retain the normal generic Instagram message; they are not falsely
  reported as confirmed HTTP 429 responses.

## Persistent automatic failed-download retries

The user requested that new failed downloads be retried after one hour and
twelve hours, with successful retries uploaded back to the original Telegram
chat. This is implemented inside the main bot process rather than as a second
process launched by `run.sh`:

- A second bot process would duplicate download/upload logic and could race on
  `failed.txt`.
- The main process scans on startup and every minute, so the schedule survives
  the periodic restarts performed by `run.sh`.
- Retry state is persisted in `failed.txt`; it does not depend on long-lived
  in-memory `setTimeout()` callbacks.
- Due records are claimed and processed sequentially. A scan cannot start a
  second copy while the previous scan is running.
- Records left as `retrying` by a process restart are returned to `pending` on
  the next startup.

New headerless TSV schema:

```text
failed_at\turl\tchat_id\tretry_count\tnext_retry_at\tstatus
```

Status lifecycle:

```text
pending -> retrying -> recovered_after_1h
                    -> pending -> retrying -> recovered_after_12h
                                           -> failed_after_12h
```

- New failures with a Telegram chat ID are scheduled for `failed_at + 1 hour`.
- If that attempt fails, the second attempt is scheduled for
  `failed_at + 12 hours`.
- A successful retry runs the same cache, preparation, ffprobe, compression,
  Telegram upload, and cleanup path as a normal request.
- The recovered media caption identifies whether the automatic one-hour or
  twelve-hour retry succeeded.
- If both attempts fail, the bot sends a final failure message containing the
  URL to the original chat.
- Existing two-column rows remain readable as `legacy_no_chat`; they are not
  retried because they do not contain a destination Telegram chat ID.
- Automated coverage now includes the six-column format, legacy parsing,
  one-hour recovery, twelve-hour recovery, terminal failure notification, and
  TSV control-character sanitization. The full suite has 38 passing tests.
