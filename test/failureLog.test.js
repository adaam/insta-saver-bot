const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    appendFailedDownload,
    parseFailedDownloadLine,
    readFailedDownloads,
    runDueFailedDownloads,
} = require('../src/failureLog');

const makeLog = async (t) => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'failed-download-'));
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    return path.join(directory, 'failed.txt');
};

test('appends a retryable failed download as six-column TSV', async (t) => {
    const logPath = await makeLog(t);
    await appendFailedDownload('https://x.com/user/status/123', {
        logPath,
        chatId: -100123,
        now: new Date('2026-11-07T12:34:56.789Z'),
    });

    assert.equal(
        await fs.promises.readFile(logPath, 'utf8'),
        '2026-11-07T12:34:56.789Z\thttps://x.com/user/status/123\t-100123\t0\t'
            + '2026-11-07T13:34:56.789Z\tpending\n'
    );
});

test('reads legacy two-column records without scheduling retries', async (t) => {
    const logPath = await makeLog(t);
    await fs.promises.writeFile(
        logPath,
        '2026-11-07T12:34:56.789Z\thttps://www.instagram.com/reel/ABC123/\n',
        'utf8'
    );

    assert.deepEqual(await readFailedDownloads({ logPath }), [{
        failedAt: '2026-11-07T12:34:56.789Z',
        url: 'https://www.instagram.com/reel/ABC123/',
        chatId: '',
        retryCount: 0,
        nextRetryAt: '',
        status: 'legacy_no_chat',
    }]);
});

test('retries after one hour and marks a successful Telegram retry recovered', async (t) => {
    const logPath = await makeLog(t);
    await appendFailedDownload('https://www.instagram.com/reel/ABC123/', {
        logPath,
        chatId: 123,
        now: new Date('2026-11-07T12:00:00.000Z'),
    });
    const calls = [];

    const results = await runDueFailedDownloads({
        logPath,
        now: new Date('2026-11-07T13:00:00.000Z'),
        retryHandler: async (record, attempt) => calls.push([record.url, record.chatId, attempt]),
    });

    assert.deepEqual(calls, [['https://www.instagram.com/reel/ABC123/', '123', 1]]);
    assert.equal(results[0].status, 'recovered_after_1h');
    const [record] = await readFailedDownloads({ logPath });
    assert.equal(record.retryCount, 1);
    assert.equal(record.nextRetryAt, '');
    assert.equal(record.status, 'recovered_after_1h');
});

test('retries a second time at twelve hours after the first retry fails', async (t) => {
    const logPath = await makeLog(t);
    await appendFailedDownload('https://x.com/user/status/123', {
        logPath,
        chatId: 456,
        now: new Date('2026-11-07T00:00:00.000Z'),
    });

    await runDueFailedDownloads({
        logPath,
        now: new Date('2026-11-07T01:00:00.000Z'),
        retryHandler: async () => {
            throw new Error('temporary failure');
        },
    });
    let [record] = await readFailedDownloads({ logPath });
    assert.equal(record.retryCount, 1);
    assert.equal(record.nextRetryAt, '2026-11-07T12:00:00.000Z');
    assert.equal(record.status, 'pending');

    const calls = [];
    await runDueFailedDownloads({
        logPath,
        now: new Date('2026-11-07T12:00:00.000Z'),
        retryHandler: async (_record, attempt) => calls.push(attempt),
    });
    [record] = await readFailedDownloads({ logPath });
    assert.deepEqual(calls, [2]);
    assert.equal(record.retryCount, 2);
    assert.equal(record.status, 'recovered_after_12h');
});

test('marks a record failed and notifies after both retries fail', async (t) => {
    const logPath = await makeLog(t);
    await fs.promises.writeFile(
        logPath,
        '2026-11-07T00:00:00.000Z\thttps://x.com/user/status/123\t456\t1\t'
            + '2026-11-07T12:00:00.000Z\tpending\n',
        'utf8'
    );
    const finalFailures = [];

    await runDueFailedDownloads({
        logPath,
        now: new Date('2026-11-07T12:00:00.000Z'),
        retryHandler: async () => {
            throw new Error('still failing');
        },
        finalFailureHandler: async (record, error) => {
            finalFailures.push([record.chatId, error.message]);
        },
    });

    const [record] = await readFailedDownloads({ logPath });
    assert.deepEqual(finalFailures, [['456', 'still failing']]);
    assert.equal(record.retryCount, 2);
    assert.equal(record.nextRetryAt, '');
    assert.equal(record.status, 'failed_after_12h');
});

test('replaces TSV control characters before writing fields', async (t) => {
    const logPath = await makeLog(t);
    await appendFailedDownload('https://example.com/a\tvalue\nnext', {
        logPath,
        now: new Date('2026-11-07T00:00:00.000Z'),
    });

    assert.equal(
        await fs.promises.readFile(logPath, 'utf8'),
        '2026-11-07T00:00:00.000Z\thttps://example.com/a value next\t\t0\t\tlegacy_no_chat\n'
    );
});
