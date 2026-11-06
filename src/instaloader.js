const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const activeDownloads = new Map();
const SUPPORTED_EXTENSIONS = new Map([
    ['.mp4', 'video'],
    ['.jpg', 'photo'],
    ['.jpeg', 'photo'],
    ['.png', 'photo'],
    ['.webp', 'photo'],
]);

const isValidShortCode = (shortCode) => (
    typeof shortCode === 'string' && /^[A-Za-z0-9_-]+$/.test(shortCode)
);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findInstaloaderBinary = () => {
    if (process.env.INSTALOADER_BIN) {
        return process.env.INSTALOADER_BIN;
    }

    const localBinary = path.resolve(process.cwd(), '.venv', 'bin', 'instaloader');
    return fs.existsSync(localBinary) ? localBinary : 'instaloader';
};

const runInstaloader = (shortCode, dirnamePattern) => new Promise((resolve, reject) => {
    const executable = findInstaloaderBinary();
    const timeoutMs = Number(process.env.DOWNLOAD_TIMEOUT_MS) || 120000;
    const args = [
        '--no-video-thumbnails',
        '--no-captions',
        '--no-metadata-json',
        `--dirname-pattern=${dirnamePattern}`,
        '--filename-pattern={shortcode}',
        '--',
        `-${shortCode}`,
    ];

    const child = spawn(executable, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
        stdout = (stdout + chunk.toString()).slice(-16000);
    });

    child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-16000);
    });

    child.on('error', (error) => {
        clearTimeout(timer);
        if (error.code === 'ENOENT') {
            reject(new Error(
                `Instaloader was not found at "${executable}". Install requirements.txt or set INSTALOADER_BIN.`
            ));
            return;
        }
        reject(error);
    });

    child.on('close', (code) => {
        clearTimeout(timer);

        if (timedOut) {
            reject(new Error(`Instaloader timed out after ${timeoutMs}ms.`));
            return;
        }

        if (code !== 0) {
            const details = (stderr || stdout).trim();
            reject(new Error(details || `Instaloader exited with code ${code}.`));
            return;
        }

        resolve(stdout);
    });
});

const mediaOrder = (filename, shortCode) => {
    const match = filename.match(
        new RegExp(`^${escapeRegExp(shortCode)}(?:_(\\d+))?\\.`, 'i')
    );
    return match && match[1] ? Number(match[1]) : 0;
};

const findDownloadedMedia = async (downloadRoot, shortCode) => {
    const filenamePattern = new RegExp(
        `^${escapeRegExp(shortCode)}(?:_\\d+)?\\.(?:mp4|jpe?g|png|webp)$`,
        'i'
    );
    const rootEntries = await fs.promises.readdir(downloadRoot, { withFileTypes: true });

    for (const rootEntry of rootEntries) {
        if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || rootEntry.name === '.cache') {
            continue;
        }

        const profileDirectory = path.join(downloadRoot, rootEntry.name);
        const filenames = (await fs.promises.readdir(profileDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && filenamePattern.test(entry.name))
            .map((entry) => entry.name)
            .sort((left, right) => mediaOrder(left, shortCode) - mediaOrder(right, shortCode));

        if (filenames.length > 0) {
            return {
                username: rootEntry.name,
                mediaFiles: filenames.map((filename) => {
                    const filePath = path.join(profileDirectory, filename);
                    return {
                        filePath,
                        mediaType: SUPPORTED_EXTENSIONS.get(path.extname(filename).toLowerCase()),
                    };
                }),
            };
        }
    }

    return null;
};

const manifestPath = (downloadRoot, shortCode) => (
    path.join(downloadRoot, '.cache', `${shortCode}.json`)
);

const loadCachedMedia = async (downloadRoot, shortCode) => {
    try {
        const stored = JSON.parse(
            await fs.promises.readFile(manifestPath(downloadRoot, shortCode), 'utf8')
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
            if (!filePath.startsWith(`${downloadRoot}${path.sep}`)
                || !SUPPORTED_EXTENSIONS.has(extension)
                || !fs.existsSync(filePath)) {
                return null;
            }
            mediaFiles.push({ filePath, mediaType: SUPPORTED_EXTENSIONS.get(extension) });
        }

        return mediaFiles.length > 0 ? { username: stored.username, mediaFiles } : null;
    } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
};

const saveManifest = async (downloadRoot, shortCode, result) => {
    const cacheDirectory = path.join(downloadRoot, '.cache');
    await fs.promises.mkdir(cacheDirectory, { recursive: true });
    const manifest = {
        username: result.username,
        files: result.mediaFiles.map(({ filePath }) => path.relative(downloadRoot, filePath)),
    };
    await fs.promises.writeFile(
        manifestPath(downloadRoot, shortCode),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8'
    );
};

const performDownload = async (shortCode) => {
    const downloadRoot = path.resolve(process.cwd(), process.env.DOWNLOAD_DIR || 'ig');
    await fs.promises.mkdir(downloadRoot, { recursive: true });

    const cachedMedia = await loadCachedMedia(downloadRoot, shortCode);
    if (cachedMedia) {
        return { ...cachedMedia, cached: true };
    }

    const dirnamePattern = path.join(downloadRoot, '{profile}');
    await runInstaloader(shortCode, dirnamePattern);

    const downloadedMedia = await findDownloadedMedia(downloadRoot, shortCode);
    if (!downloadedMedia) {
        throw new Error('Instaloader completed without producing a supported media file.');
    }

    await saveManifest(downloadRoot, shortCode, downloadedMedia);
    return { ...downloadedMedia, cached: false };
};

const downloadInstagramMedia = (shortCode) => {
    if (!isValidShortCode(shortCode)) {
        return Promise.reject(new Error('Invalid Instagram shortcode.'));
    }

    if (activeDownloads.has(shortCode)) {
        return activeDownloads.get(shortCode);
    }

    const download = performDownload(shortCode)
        .finally(() => activeDownloads.delete(shortCode));

    activeDownloads.set(shortCode, download);
    return download;
};

module.exports = {
    downloadInstagramMedia,
    findDownloadedMedia,
    isValidShortCode,
};
