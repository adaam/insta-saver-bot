const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * ONE_HOUR_MS;
const DEFAULT_RETRY_SCAN_MS = 60 * 1000;
let logOperation = Promise.resolve();

const sanitizeTsvField = (value) => String(value ?? '').replace(/[\t\r\n]/g, ' ');

const withLogLock = (operation) => {
    const result = logOperation.then(operation, operation);
    logOperation = result.catch(() => {});
    return result;
};

const defaultLogPath = () => path.join(process.cwd(), 'failed.txt');

const parseFailedDownloadLine = (line) => {
    const fields = line.split('\t');
    if (fields.length < 2 || !fields[0] || !fields[1]) {
        return null;
    }
    if (fields.length === 2) {
        return {
            failedAt: fields[0],
            url: fields[1],
            chatId: '',
            retryCount: 0,
            nextRetryAt: '',
            status: 'legacy_no_chat',
        };
    }
    return {
        failedAt: fields[0],
        url: fields[1],
        chatId: fields[2] || '',
        retryCount: Number(fields[3]) || 0,
        nextRetryAt: fields[4] || '',
        status: fields[5] || 'pending',
    };
};

const serializeFailedDownload = (record) => [
    record.failedAt,
    record.url,
    record.chatId,
    record.retryCount,
    record.nextRetryAt,
    record.status,
].map(sanitizeTsvField).join('\t');

const readFailedDownloadsUnlocked = async (logPath) => {
    try {
        const contents = await fs.promises.readFile(logPath, 'utf8');
        return contents.split(/\r?\n/)
            .filter(Boolean)
            .map(parseFailedDownloadLine)
            .filter(Boolean);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
};

const writeFailedDownloadsUnlocked = async (logPath, records) => {
    const temporaryPath = `${logPath}.${process.pid}-${randomUUID()}.tmp`;
    try {
        const contents = records.length > 0
            ? `${records.map(serializeFailedDownload).join('\n')}\n`
            : '';
        await fs.promises.writeFile(temporaryPath, contents, 'utf8');
        await fs.promises.rename(temporaryPath, logPath);
    } finally {
        await fs.promises.rm(temporaryPath, { force: true });
    }
};

const appendFailedDownload = async (url, options = {}) => withLogLock(async () => {
    const failedAt = (options.now || new Date()).toISOString();
    const logPath = options.logPath || defaultLogPath();
    const chatId = options.chatId === undefined ? '' : String(options.chatId);
    const record = {
        failedAt,
        url,
        chatId,
        retryCount: 0,
        nextRetryAt: chatId
            ? new Date(new Date(failedAt).getTime() + ONE_HOUR_MS).toISOString()
            : '',
        status: chatId ? 'pending' : 'legacy_no_chat',
    };
    await fs.promises.appendFile(logPath, `${serializeFailedDownload(record)}\n`, 'utf8');
    return record;
});

const readFailedDownloads = async (options = {}) => withLogLock(() => (
    readFailedDownloadsUnlocked(options.logPath || defaultLogPath())
));

const recordKey = ({ failedAt, url, chatId }) => `${failedAt}\0${url}\0${chatId}`;

const updateRecord = async (logPath, key, update) => withLogLock(async () => {
    const records = await readFailedDownloadsUnlocked(logPath);
    const index = records.findIndex((record) => recordKey(record) === key);
    if (index === -1) {
        return null;
    }
    records[index] = { ...records[index], ...update };
    await writeFailedDownloadsUnlocked(logPath, records);
    return records[index];
});

const claimDueRecord = async (logPath, now) => withLogLock(async () => {
    const records = await readFailedDownloadsUnlocked(logPath);
    const nowMs = now.getTime();
    const index = records.findIndex((record) => (
        record.status === 'pending'
        && record.chatId
        && Number.isFinite(Date.parse(record.nextRetryAt))
        && Date.parse(record.nextRetryAt) <= nowMs
    ));
    if (index === -1) {
        return null;
    }
    records[index] = { ...records[index], status: 'retrying' };
    await writeFailedDownloadsUnlocked(logPath, records);
    return records[index];
});

const recoverInterruptedRetries = async (logPath) => withLogLock(async () => {
    const records = await readFailedDownloadsUnlocked(logPath);
    let changed = false;
    for (let index = 0; index < records.length; index += 1) {
        if (records[index].status === 'retrying') {
            records[index] = { ...records[index], status: 'pending' };
            changed = true;
        }
    }
    if (changed) {
        await writeFailedDownloadsUnlocked(logPath, records);
    }
});

const runDueFailedDownloads = async (options) => {
    const logPath = options.logPath || defaultLogPath();
    const now = options.now || new Date();
    const results = [];
    let record = await claimDueRecord(logPath, now);

    while (record) {
        const key = recordKey(record);
        const attempt = record.retryCount + 1;
        try {
            await options.retryHandler(record, attempt);
            const status = attempt === 1 ? 'recovered_after_1h' : 'recovered_after_12h';
            await updateRecord(logPath, key, {
                retryCount: attempt,
                nextRetryAt: '',
                status,
            });
            results.push({ ...record, attempt, status });
        } catch (error) {
            if (attempt < 2) {
                const scheduledAt = new Date(record.failedAt).getTime() + TWELVE_HOURS_MS;
                const nextRetryMs = Math.max(scheduledAt, now.getTime() + DEFAULT_RETRY_SCAN_MS);
                await updateRecord(logPath, key, {
                    retryCount: attempt,
                    nextRetryAt: new Date(nextRetryMs).toISOString(),
                    status: 'pending',
                });
                results.push({ ...record, attempt, status: 'pending', error });
            } else {
                await updateRecord(logPath, key, {
                    retryCount: attempt,
                    nextRetryAt: '',
                    status: 'failed_after_12h',
                });
                results.push({ ...record, attempt, status: 'failed_after_12h', error });
                if (options.finalFailureHandler) {
                    await options.finalFailureHandler(record, error);
                }
            }
        }
        record = await claimDueRecord(logPath, now);
    }
    return results;
};

const startFailedDownloadRetryWorker = (options) => {
    const logPath = options.logPath || defaultLogPath();
    let running = false;
    const run = async () => {
        if (running) {
            return;
        }
        running = true;
        try {
            await runDueFailedDownloads({ ...options, logPath, now: new Date() });
        } catch (error) {
            console.error('Failed-download retry worker error:', error.message);
        } finally {
            running = false;
        }
    };

    recoverInterruptedRetries(logPath)
        .then(run)
        .catch((error) => console.error('Unable to initialize retry worker:', error.message));
    const timer = setInterval(run, options.scanIntervalMs || DEFAULT_RETRY_SCAN_MS);
    return () => clearInterval(timer);
};

module.exports = {
    appendFailedDownload,
    parseFailedDownloadLine,
    readFailedDownloads,
    runDueFailedDownloads,
    startFailedDownloadRetryWorker,
};
