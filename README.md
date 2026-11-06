<p align="center">
    <img width="200" height="200" src="./assets/icon.png" alt="Project logo">
</p>

<h1 align="center">Insta Saver Bot 🤖</h1>

A Telegram bot that accepts a public Instagram Reel or post link, downloads
its photos and videos to local storage with Instaloader, and uploads the local
files back to the Telegram chat. No Instagram login is used.

## Requirements

- Node.js 18 or newer
- Python 3.10 or newer
- A Telegram bot token from BotFather

Only public Instagram content that Instaloader can access while logged out is
supported. Private, deleted, age-restricted, or region-restricted content will
fail.

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
```

If Instaloader is installed elsewhere, set `INSTALOADER_BIN` to its executable
path. `DOWNLOAD_DIR` and `DOWNLOAD_TIMEOUT_MS` can also be configured in `.env`.

## Bot flow

1. A user sends a public Instagram Reel or post URL.
2. The bot validates the hostname and extracts the shortcode.
3. Instaloader obtains the public owner's username and downloads every photo
   and video without an Instagram session.
4. The bot uploads one file as a photo/video, or multiple files as Telegram
   media groups (up to 10 files per group).
5. Repeated requests for the same shortcode reuse the complete locally cached
   media list.

## Test

```bash
npm test
```

This project is not affiliated with Instagram or Telegram. Download and reuse
content only when you have permission to do so.

Original project by [Akash Vaghela](https://linkedin.com/in/akashvaghela09/).
