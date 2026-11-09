const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    calculateVideoBitrate,
    cleanupPreparedMedia,
    isTranscodeCacheEnabled,
    parseVideoMetadata,
    prepareMediaForTelegram,
} = require('../src/telegramPrepare');

test('disables the Telegram transcode cache by default', (t) => {
    const original = process.env.TELEGRAM_TRANSCODE_CACHE;
    t.after(() => {
        if (original === undefined) {
            delete process.env.TELEGRAM_TRANSCODE_CACHE;
        } else {
            process.env.TELEGRAM_TRANSCODE_CACHE = original;
        }
    });

    delete process.env.TELEGRAM_TRANSCODE_CACHE;
    assert.equal(isTranscodeCacheEnabled(), false);
    process.env.TELEGRAM_TRANSCODE_CACHE = 'true';
    assert.equal(isTranscodeCacheEnabled(), true);
});

test('calculates a safe positive video bitrate for a Telegram target size', () => {
    const bitrate = calculateVideoBitrate(262, 47_000_000);
    assert.ok(bitrate > 1_000_000);
    assert.ok(bitrate < 1_500_000);
});

test('parses portrait video metadata for Telegram', () => {
    assert.deepEqual(parseVideoMetadata(JSON.stringify({
        streams: [{ width: 1080, height: 1920, duration: '120.020000' }],
        format: { duration: '120.064000' },
    })), {
        width: 1080,
        height: 1920,
        duration: 120,
        supports_streaming: true,
    });
});

test('swaps display dimensions for a rotated video', () => {
    assert.deepEqual(parseVideoMetadata(JSON.stringify({
        streams: [{
            width: 1920,
            height: 1080,
            tags: { rotate: '90' },
        }],
        format: { duration: '30.6' },
    })), {
        width: 1080,
        height: 1920,
        duration: 31,
        supports_streaming: true,
    });
});

test('prefers display-matrix rotation metadata', () => {
    assert.deepEqual(parseVideoMetadata(JSON.stringify({
        streams: [{
            width: 1920,
            height: 1080,
            tags: { rotate: '0' },
            side_data_list: [{ rotation: -90 }],
        }],
        format: { duration: '10' },
    })), {
        width: 1080,
        height: 1920,
        duration: 10,
        supports_streaming: true,
    });
});

test('keeps media files that are already below the Telegram limit', async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'telegram-media-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'video.mp4');
    await fs.promises.writeFile(filePath, 'small video');

    const videoMetadata = {
        width: 1080,
        height: 1920,
        duration: 120,
        supports_streaming: true,
    };
    const result = await prepareMediaForTelegram(
        [{ filePath, mediaType: 'video' }],
        { probeVideo: async () => videoMetadata }
    );
    assert.deepEqual(result, [{ filePath, mediaType: 'video', fileSize: 11, videoMetadata }]);
});

test('removes only temporary prepared media', async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'telegram-cleanup-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const temporaryPath = path.join(directory, 'temporary.mp4');
    const cachedPath = path.join(directory, 'cached.mp4');
    await Promise.all([
        fs.promises.writeFile(temporaryPath, 'temporary'),
        fs.promises.writeFile(cachedPath, 'cached'),
    ]);

    await cleanupPreparedMedia([
        { filePath: temporaryPath, temporary: true },
        { filePath: cachedPath },
    ]);

    assert.equal(fs.existsSync(temporaryPath), false);
    assert.equal(fs.existsSync(cachedPath), true);
});
