const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const TRUSTED_MEDIA_HOSTS = new Set(['pbs.twimg.com', 'video.twimg.com']);
const PHOTO_CONTENT_TYPES = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
]);

const sanitizeUsername = (username) => (
    typeof username === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(username)
        ? username
        : 'unknown'
);

const validateMediaUrl = (mediaUrl) => {
    const parsedUrl = new URL(mediaUrl);
    if (parsedUrl.protocol !== 'https:' || !TRUSTED_MEDIA_HOSTS.has(parsedUrl.hostname)) {
        throw new Error('FxTwitter returned an untrusted media URL.');
    }
    return parsedUrl.toString();
};

const extractFallbackMedia = (payload, tweetId) => {
    const tweet = payload && payload.tweet;
    if (!tweet || String(tweet.id) !== tweetId) {
        throw new Error('FxTwitter returned data for an unexpected Tweet ID.');
    }

    const username = sanitizeUsername(tweet.author && tweet.author.screen_name);
    const allMedia = tweet.media && Array.isArray(tweet.media.all) ? tweet.media.all : [];
    const media = allMedia.flatMap((item, index) => {
        if (!item || !['photo', 'video', 'gif'].includes(item.type) || !item.url) {
            return [];
        }
        return [{
            id: typeof item.id === 'string' && /^\d+$/.test(item.id) ? item.id : String(index + 1),
            mediaType: item.type === 'photo' ? 'photo' : 'video',
            url: validateMediaUrl(item.url),
            position: index + 1,
        }];
    });

    if (media.length === 0) {
        throw new Error('FxTwitter found no supported media in this Tweet.');
    }
    return { username, media };
};

const fetchWithTimeout = async (url, options = {}) => {
    const timeoutMs = Number(process.env.DOWNLOAD_TIMEOUT_MS) || 120000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
};

const downloadFile = async (media, profileDirectory, tweetId) => {
    const response = await fetchWithTimeout(media.url, {
        headers: { 'User-Agent': 'insta-saver-bot/0.1.3' },
    });
    if (!response.ok || !response.body) {
        throw new Error(`FxTwitter media download failed with HTTP ${response.status}.`);
    }

    const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const extension = media.mediaType === 'video'
        ? (contentType === 'video/mp4' ? '.mp4' : null)
        : PHOTO_CONTENT_TYPES.get(contentType);
    if (!extension) {
        throw new Error(`FxTwitter media has unsupported content type "${contentType}".`);
    }

    const suffix = media.mediaType === 'video' ? media.id : String(media.position);
    const filePath = path.join(profileDirectory, `${tweetId}_${suffix}${extension}`);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return { filePath, mediaType: media.mediaType };
    }

    const temporaryPath = `${filePath}.part`;
    try {
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporaryPath));
        await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
        await fs.promises.rm(temporaryPath, { force: true });
        throw error;
    }
    return { filePath, mediaType: media.mediaType };
};

const downloadTwitterFallback = async (tweetId, downloadRoot) => {
    const configuredApi = process.env.TWITTER_FALLBACK_API;
    if (configuredApi && configuredApi.toLowerCase() === 'off') {
        throw new Error('Twitter/X third-party fallback is disabled.');
    }
    const apiBase = (configuredApi || 'https://api.fxtwitter.com').replace(/\/$/, '');
    const response = await fetchWithTimeout(`${apiBase}/status/${tweetId}`, {
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
        throw new Error(`FxTwitter API failed with HTTP ${response.status}.`);
    }

    const extracted = extractFallbackMedia(await response.json(), tweetId);
    const profileDirectory = path.join(downloadRoot, extracted.username);
    await fs.promises.mkdir(profileDirectory, { recursive: true });
    const mediaFiles = [];
    for (const media of extracted.media) {
        mediaFiles.push(await downloadFile(media, profileDirectory, tweetId));
    }
    return { username: extracted.username, mediaFiles };
};

module.exports = {
    downloadTwitterFallback,
    extractFallbackMedia,
};
