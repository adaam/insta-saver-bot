const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const isNoVideoError = (details) => /no video (?:formats|could be) found/i.test(details);

const findYtDlpBinary = () => {
    if (process.env.YTDLP_BIN) {
        return process.env.YTDLP_BIN;
    }

    const localBinary = path.resolve(process.cwd(), '.venv', 'bin', 'yt-dlp');
    return fs.existsSync(localBinary) ? localBinary : 'yt-dlp';
};

const isPathInside = (root, candidate) => {
    const relativePath = path.relative(root, candidate);
    return relativePath !== ''
        && relativePath !== '..'
        && !relativePath.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativePath);
};

const parseYtDlpOutput = (stdout, downloadRoot, tweetId) => {
    if (!stdout.trim()) {
        return { username: 'unknown', mediaFiles: [] };
    }

    const records = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        try {
            return JSON.parse(line);
        } catch {
            throw new Error(`yt-dlp returned an invalid result record: ${line}`);
        }
    });

    let username = 'unknown';
    const mediaFiles = records.map((record) => {
        if (!record || typeof record.filepath !== 'string') {
            throw new Error('yt-dlp returned a result without a file path.');
        }
        if (record.display_id && String(record.display_id) !== tweetId) {
            throw new Error('yt-dlp returned media for an unexpected Tweet ID.');
        }

        const filePath = path.resolve(record.filepath);
        if (!isPathInside(downloadRoot, filePath)
            || path.extname(filePath).toLowerCase() !== '.mp4'
            || !fs.existsSync(filePath)
            || !fs.statSync(filePath).isFile()) {
            throw new Error('yt-dlp reported an invalid or missing MP4 output file.');
        }

        if (typeof record.uploader_id === 'string' && record.uploader_id) {
            username = record.uploader_id;
        }
        return { filePath, mediaType: 'video' };
    });

    return { username, mediaFiles };
};

const downloadTwitterVideos = (url, downloadRoot, tweetId) => new Promise((resolve, reject) => {
    const executable = findYtDlpBinary();
    const timeoutMs = Number(process.env.DOWNLOAD_TIMEOUT_MS) || 120000;
    const outputTemplate = '%(uploader_id|unknown)s/%(display_id)s_%(id)s.%(ext)s';
    const resultTemplate = [
        '{"filepath":%(filepath)j',
        '"uploader_id":%(uploader_id)j',
        '"display_id":%(display_id)j',
        '"id":%(id)j}',
    ].join(',');
    const args = [
        '--no-progress',
        '--no-warnings',
        '--ignore-no-formats-error',
        '--restrict-filenames',
        '--merge-output-format',
        'mp4',
        '--remux-video',
        'mp4',
        '--paths',
        downloadRoot,
        '--output',
        outputTemplate,
        '--print',
        `after_move:${resultTemplate}`,
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
        stdout = (stdout + chunk.toString()).slice(-64000);
    });
    child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-16000);
    });
    child.on('error', (error) => {
        clearTimeout(timer);
        if (error.code === 'ENOENT') {
            reject(new Error(
                `yt-dlp was not found at "${executable}". Install requirements.txt or set YTDLP_BIN.`
            ));
            return;
        }
        reject(error);
    });
    child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
            reject(new Error(`yt-dlp timed out after ${timeoutMs}ms.`));
            return;
        }
        if (code !== 0) {
            const details = (stderr || stdout).trim();
            if (isNoVideoError(details)) {
                resolve({ username: 'unknown', mediaFiles: [] });
                return;
            }
            reject(new Error(details || `yt-dlp exited with code ${code}.`));
            return;
        }
        try {
            resolve(parseYtDlpOutput(stdout, downloadRoot, tweetId));
        } catch (error) {
            reject(error);
        }
    });
});

module.exports = {
    downloadTwitterVideos,
    isNoVideoError,
    parseYtDlpOutput,
};
