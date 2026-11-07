const fs = require('node:fs');
const path = require('node:path');
const { downloadTwitterFallback } = require('./fxtwitter');
const { downloadTwitterPhotos } = require('./gallerydl');
const { downloadTwitterVideos } = require('./ytdlp');

const activeDownloads = new Map();
const SUPPORTED_MEDIA = new Map([
    ['.mp4', 'video'],
    ['.jpg', 'photo'],
    ['.jpeg', 'photo'],
    ['.png', 'photo'],
    ['.webp', 'photo'],
]);

const isValidTweetId = (tweetId) => (
    typeof tweetId === 'string' && /^\d+$/.test(tweetId)
);

const isFallbackEligibleError = (error) => (
    /(?:unavailable|authrequired|authenticated cookies|login required|sign in|http (?:401|403|404|429)|rate.?limit|temporarily blocked)/i
        .test(error && error.message ? error.message : String(error))
);

const isPathInside = (root, candidate) => {
    const relativePath = path.relative(root, candidate);
    return relativePath !== ''
        && relativePath !== '..'
        && !relativePath.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativePath);
};

const manifestPath = (downloadRoot, tweetId) => (
    path.join(downloadRoot, '.cache', `${tweetId}.json`)
);

const loadCachedTwitterMedia = async (downloadRoot, tweetId) => {
    try {
        const stored = JSON.parse(
            await fs.promises.readFile(manifestPath(downloadRoot, tweetId), 'utf8')
        );
        if (!stored || typeof stored.username !== 'string' || !Array.isArray(stored.files)) {
            return null;
        }

        const mediaFiles = [];
        for (const relativeFile of stored.files) {
            if (typeof relativeFile !== 'string') {
                return null;
            }
            const filePath = path.resolve(downloadRoot, relativeFile);
            const extension = path.extname(filePath).toLowerCase();
            if (!isPathInside(downloadRoot, filePath)
                || !SUPPORTED_MEDIA.has(extension)
                || !fs.existsSync(filePath)
                || !fs.statSync(filePath).isFile()) {
                return null;
            }
            mediaFiles.push({ filePath, mediaType: SUPPORTED_MEDIA.get(extension) });
        }
        return mediaFiles.length > 0 ? { username: stored.username, mediaFiles } : null;
    } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
};

const saveManifest = async (downloadRoot, tweetId, result) => {
    const cacheDirectory = path.join(downloadRoot, '.cache');
    await fs.promises.mkdir(cacheDirectory, { recursive: true });
    await fs.promises.writeFile(
        manifestPath(downloadRoot, tweetId),
        `${JSON.stringify({
            username: result.username,
            files: result.mediaFiles.map(({ filePath }) => path.relative(downloadRoot, filePath)),
        }, null, 2)}\n`,
        'utf8'
    );
};

const performDownload = async (url, tweetId) => {
    const downloadRoot = path.resolve(
        process.cwd(),
        process.env.TWITTER_DOWNLOAD_DIR || 'twitter'
    );
    await fs.promises.mkdir(downloadRoot, { recursive: true });

    const cachedMedia = await loadCachedTwitterMedia(downloadRoot, tweetId);
    if (cachedMedia) {
        return { ...cachedMedia, cached: true };
    }

    let result;
    try {
        const photos = await downloadTwitterPhotos(url, downloadRoot, tweetId);
        const videos = await downloadTwitterVideos(url, downloadRoot, tweetId);
        const mediaFiles = [...photos.mediaFiles, ...videos.mediaFiles];
        if (mediaFiles.length === 0) {
            result = await downloadTwitterFallback(tweetId, downloadRoot);
        } else {
            const username = photos.username !== 'unknown' ? photos.username : videos.username;
            result = { username, mediaFiles };
        }
    } catch (error) {
        if (!isFallbackEligibleError(error)) {
            throw error;
        }
        console.warn(`Direct Twitter/X download failed; using fallback: ${error.message}`);
        result = await downloadTwitterFallback(tweetId, downloadRoot);
    }

    await saveManifest(downloadRoot, tweetId, result);
    return { ...result, cached: false };
};

const downloadTwitterMedia = (url, tweetId) => {
    if (!isValidTweetId(tweetId)) {
        return Promise.reject(new Error('Invalid Twitter/X Tweet ID.'));
    }
    if (activeDownloads.has(tweetId)) {
        return activeDownloads.get(tweetId);
    }

    const download = performDownload(url, tweetId)
        .finally(() => activeDownloads.delete(tweetId));
    activeDownloads.set(tweetId, download);
    return download;
};

module.exports = {
    downloadTwitterMedia,
    isFallbackEligibleError,
    isValidTweetId,
    loadCachedTwitterMedia,
};
