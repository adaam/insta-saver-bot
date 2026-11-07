const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendFailedDownload } = require('../src/failureLog');

test('appends failed download timestamps and URLs as TSV', async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'failed-download-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const logPath = path.join(directory, 'failed.txt');

    await appendFailedDownload('https://x.com/user/status/123', {
        logPath,
        now: new Date('2026-11-07T12:34:56.789Z'),
    });
    await appendFailedDownload('https://www.instagram.com/reel/ABC123/', {
        logPath,
        now: new Date('2026-11-07T12:35:00.000Z'),
    });

    assert.equal(
        await fs.promises.readFile(logPath, 'utf8'),
        '2026-11-07T12:34:56.789Z\thttps://x.com/user/status/123\n'
            + '2026-11-07T12:35:00.000Z\thttps://www.instagram.com/reel/ABC123/\n'
    );
});

test('replaces TSV control characters in logged values', async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'failed-download-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const logPath = path.join(directory, 'failed.txt');

    await appendFailedDownload('https://example.com/a\tvalue\nnext', {
        logPath,
        now: new Date('2026-11-07T12:34:56.789Z'),
    });

    assert.equal(
        await fs.promises.readFile(logPath, 'utf8'),
        '2026-11-07T12:34:56.789Z\thttps://example.com/a value next\n'
    );
});
