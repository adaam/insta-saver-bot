# Changelog

All notable changes to this project are documented in this file.

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
