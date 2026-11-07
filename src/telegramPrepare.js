const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_MAX_UPLOAD_BYTES = 47_000_000;
const AUDIO_BITRATE = 96_000;

const maxUploadBytes = () => {
    const configured = Number(process.env.TELEGRAM_MAX_UPLOAD_BYTES);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_MAX_UPLOAD_BYTES;
};

const isTranscodeCacheEnabled = () => ['1', 'true', 'yes', 'on']
    .includes(String(process.env.TELEGRAM_TRANSCODE_CACHE || '').toLowerCase());

const runCommand = (executable, args, timeoutMs) => new Promise((resolve, reject) => {
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
        reject(error);
    });
    child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
            reject(new Error(`${path.basename(executable)} timed out after ${timeoutMs}ms.`));
        } else if (code !== 0) {
            reject(new Error((stderr || stdout).trim() || `${executable} exited with code ${code}.`));
        } else {
            resolve(stdout.trim());
        }
    });
});

const calculateVideoBitrate = (duration, targetBytes) => {
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Unable to determine video duration for Telegram compression.');
    }
    const totalBitrate = Math.floor((targetBytes * 8 * 0.96) / duration);
    return Math.max(150_000, totalBitrate - AUDIO_BITRATE);
};

const getVideoDuration = async (filePath) => {
    const ffprobe = process.env.FFPROBE_BIN || 'ffprobe';
    const stdout = await runCommand(ffprobe, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath,
    ], 30000);
    return Number(stdout);
};

const removePassLogs = async (passLogPath) => {
    const directory = path.dirname(passLogPath);
    const prefix = path.basename(passLogPath);
    const entries = await fs.promises.readdir(directory);
    await Promise.all(entries
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => fs.promises.rm(path.join(directory, entry), { force: true })));
};

const compressVideo = async (filePath, targetBytes) => {
    const extension = path.extname(filePath);
    const basePath = filePath.slice(0, -extension.length);
    const cacheEnabled = isTranscodeCacheEnabled();
    const jobId = `${process.pid}-${randomUUID()}`;
    const outputPath = cacheEnabled
        ? `${basePath}.telegram.mp4`
        : `${basePath}.telegram-${jobId}.mp4`;
    if (cacheEnabled && fs.existsSync(outputPath)) {
        const existingSize = fs.statSync(outputPath).size;
        if (existingSize <= maxUploadBytes()) {
            return { filePath: outputPath, mediaType: 'video', fileSize: existingSize };
        }
    }

    console.log(`Compressing oversized Telegram video: ${filePath}`);
    const duration = await getVideoDuration(filePath);
    const videoBitrate = calculateVideoBitrate(duration, targetBytes);
    const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg';
    const timeoutMs = Number(process.env.TRANSCODE_TIMEOUT_MS) || 600000;
    const passLogPath = `${basePath}.telegram-pass-${jobId}`;
    const temporaryPath = `${basePath}.telegram-${jobId}.part.mp4`;
    const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const commonVideoArgs = [
        '-map', '0:v:0',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-pix_fmt', 'yuv420p',
        '-b:v', String(videoBitrate),
        '-passlogfile', passLogPath,
    ];

    try {
        await runCommand(ffmpeg, [
            '-y', '-i', filePath,
            ...commonVideoArgs,
            '-pass', '1',
            '-an',
            '-f', 'null',
            nullOutput,
        ], timeoutMs);
        await runCommand(ffmpeg, [
            '-y', '-i', filePath,
            ...commonVideoArgs,
            '-pass', '2',
            '-map', '0:a:0?',
            '-c:a', 'aac',
            '-b:a', String(AUDIO_BITRATE),
            '-movflags', '+faststart',
            temporaryPath,
        ], timeoutMs);
        const outputSize = fs.statSync(temporaryPath).size;
        if (outputSize > maxUploadBytes()) {
            throw new Error(`Compressed video is still too large for Telegram (${outputSize} bytes).`);
        }
        await fs.promises.rename(temporaryPath, outputPath);
        return {
            filePath: outputPath,
            mediaType: 'video',
            fileSize: outputSize,
            ...(!cacheEnabled ? { temporary: true } : {}),
        };
    } finally {
        await fs.promises.rm(temporaryPath, { force: true });
        await removePassLogs(passLogPath);
    }
};

const cleanupPreparedMedia = async (mediaFiles) => {
    await Promise.all(mediaFiles
        .filter(({ temporary }) => temporary)
        .map(({ filePath }) => fs.promises.rm(filePath, { force: true })));
};

const prepareMediaForTelegram = async (mediaFiles) => {
    const prepared = [];
    try {
        for (const media of mediaFiles) {
            const fileSize = fs.statSync(media.filePath).size;
            if (media.mediaType === 'video' && fileSize > maxUploadBytes()) {
                prepared.push(await compressVideo(media.filePath, maxUploadBytes()));
            } else {
                prepared.push({ ...media, fileSize });
            }
        }
        return prepared;
    } catch (error) {
        await cleanupPreparedMedia(prepared);
        throw error;
    }
};

module.exports = {
    calculateVideoBitrate,
    cleanupPreparedMedia,
    isTranscodeCacheEnabled,
    prepareMediaForTelegram,
};
