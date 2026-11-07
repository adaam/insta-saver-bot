const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PHOTO_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findGalleryDlpBinary = () => {
    if (process.env.GALLERYDL_BIN) {
        return process.env.GALLERYDL_BIN;
    }

    const localBinary = path.resolve(process.cwd(), '.venv', 'bin', 'gallery-dl');
    return fs.existsSync(localBinary) ? localBinary : 'gallery-dl';
};

const photoOrder = (filename, tweetId) => {
    const match = filename.match(new RegExp(`^${escapeRegExp(tweetId)}_(\\d+)\\.`, 'i'));
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const findDownloadedPhotos = async (downloadRoot, tweetId) => {
    const filenamePattern = new RegExp(
        `^${escapeRegExp(tweetId)}_\\d+\\.(?:jpe?g|png|webp)$`,
        'i'
    );
    const rootEntries = await fs.promises.readdir(downloadRoot, { withFileTypes: true });

    for (const rootEntry of rootEntries) {
        if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || rootEntry.name === '.cache') {
            continue;
        }
        const profileDirectory = path.join(downloadRoot, rootEntry.name);
        const filenames = (await fs.promises.readdir(profileDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isFile()
                && filenamePattern.test(entry.name)
                && PHOTO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
            .map((entry) => entry.name)
            .sort((left, right) => photoOrder(left, tweetId) - photoOrder(right, tweetId));

        if (filenames.length > 0) {
            return {
                username: rootEntry.name,
                mediaFiles: filenames.map((filename) => ({
                    filePath: path.join(profileDirectory, filename),
                    mediaType: 'photo',
                })),
            };
        }
    }
    return { username: 'unknown', mediaFiles: [] };
};

const downloadTwitterPhotos = (url, downloadRoot, tweetId) => new Promise((resolve, reject) => {
    const executable = findGalleryDlpBinary();
    const timeoutMs = Number(process.env.DOWNLOAD_TIMEOUT_MS) || 120000;
    const args = [
        '--no-input',
        '--quiet',
        '--destination',
        downloadRoot,
        '--filename',
        '{tweet_id}_{num}.{extension}',
        '--restrict-filenames',
        'ascii',
        '--option',
        'extractor.twitter.directory=["{user[name]}"]',
        '--option',
        'extractor.twitter.videos=false',
        '--option',
        'extractor.twitter.quoted=false',
        '--option',
        'extractor.twitter.retweets=false',
        '--',
        url,
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
                `gallery-dl was not found at "${executable}". Install requirements.txt or set GALLERYDL_BIN.`
            ));
            return;
        }
        reject(error);
    });
    child.on('close', async (code) => {
        clearTimeout(timer);
        if (timedOut) {
            reject(new Error(`gallery-dl timed out after ${timeoutMs}ms.`));
            return;
        }
        if (code !== 0) {
            reject(new Error((stderr || stdout).trim() || `gallery-dl exited with code ${code}.`));
            return;
        }
        try {
            resolve(await findDownloadedPhotos(downloadRoot, tweetId));
        } catch (error) {
            reject(error);
        }
    });
});

module.exports = {
    downloadTwitterPhotos,
    findDownloadedPhotos,
};
