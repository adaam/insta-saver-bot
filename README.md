<p align="center">
    <img width="200" height="200" src="./assets/icon.png" alt="Project logo">
</p>

<h1 align="center">Insta Saver Bot 🤖</h1>

A Telegram bot that accepts public Instagram Reel/post and Twitter/X status
links, downloads their supported photos and videos to local storage, and
uploads the local files back to the Telegram chat. No social-media account
login or browser cookies are used.

## Requirements

- Node.js 18 or newer
- Python 3.10 or newer
- FFmpeg
- A Telegram bot token from BotFather

Instagram uses Instaloader. Twitter/X uses gallery-dl for photos and yt-dlp for
videos and animated GIFs. Only public content that these tools can access while
logged out is supported. Private, deleted, age-restricted, region-restricted,
or login-required content will fail.

When Twitter/X denies anonymous direct extraction for an otherwise public
Tweet, the bot can fall back to the public FxTwitter API. This sends the Tweet
ID (but no account credentials, cookies, or Telegram chat data) to that
third-party service. Set `TWITTER_FALLBACK_API=off` to disable the fallback.

## Setup

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp example.env .env
```

Set `TELEGRAM_TOKEN` in `.env`, then start the bot:

```bash
npm start
```

Downloaded media are retained locally as:

```text
ig/<instagram-username>/<instagram-shortcode>.<extension>
ig/<instagram-username>/<instagram-shortcode>_<carousel-position>.<extension>
twitter/<twitter-username>/<tweet-id>_<position>.<image-extension>
twitter/<twitter-username>/<tweet-id>_<media-id>.mp4
```

If the Python tools are installed elsewhere, set `INSTALOADER_BIN`,
`YTDLP_BIN`, or `GALLERYDL_BIN` to their executable paths. `DOWNLOAD_DIR`,
`TWITTER_DOWNLOAD_DIR`, and `DOWNLOAD_TIMEOUT_MS` can also be configured in
`.env`. `TWITTER_FALLBACK_API` selects or disables the restricted Twitter/X
metadata fallback.

The public Telegram Bot API accepts multipart video uploads up to 50 MB. The
bot uses a 47,000,000-byte safety limit and automatically creates a temporary
FFmpeg copy when a downloaded video is larger. The prepared copy is deleted
after upload by default; set `TELEGRAM_TRANSCODE_CACHE=true` to keep and reuse
it as `.telegram.mp4`. Size and timeout are configured with
`TELEGRAM_MAX_UPLOAD_BYTES` and `TRANSCODE_TIMEOUT_MS`.

## Bot flow

1. A user sends a public Instagram Reel/post or Twitter/X status URL.
2. The bot validates the exact hostname, removes URL query parameters and
   fragments, and routes the URL by platform.
3. Instagram uses Instaloader. Twitter/X uses gallery-dl for static photos and
   yt-dlp plus FFmpeg for videos and animated GIFs. Recognized anonymous-access
   failures can use FxTwitter as a metadata fallback.
4. The bot uploads one file as a photo/video, or multiple files as Telegram
   media groups (up to 10 files per group). Oversized videos are compressed
   before upload, and groups are also split by total upload size.
5. Repeated requests reuse a validated manifest of the complete local media
   list.

Downloader failures are recorded in `failed.txt` as headerless TSV records:

```text
<failed_at>\t<cleaned_url>\t<chat_id>\t<retry_count>\t<next_retry_at>\t<status>
```

Only download failures are recorded; Telegram upload and FFmpeg failures are
not added as new records. New failures are retried automatically after one hour
and, if needed, twelve hours after the original failure. Successful retries are
uploaded to the original Telegram chat. The main process scans this file on
startup and once per minute, so retries survive bot restarts. Legacy two-column
rows remain readable but cannot be retried because they do not contain a chat
ID.

The detailed Twitter/X implementation plan is in
[`design/20261107_twitter_download.md`](design/20261107_twitter_download.md).

## Test

```bash
npm test
```

This project is not affiliated with Instagram, Twitter/X, or Telegram.
Download and reuse content only when you have permission to do so.

Original project by [Akash Vaghela](https://linkedin.com/in/akashvaghela09/).
