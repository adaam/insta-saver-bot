const fs = require('node:fs');
const path = require('node:path');

const sanitizeTsvField = (value) => String(value).replace(/[\t\r\n]/g, ' ');

const appendFailedDownload = async (url, options = {}) => {
    const timestamp = (options.now || new Date()).toISOString();
    const logPath = options.logPath || path.join(process.cwd(), 'failed.txt');
    const line = `${sanitizeTsvField(timestamp)}\t${sanitizeTsvField(url)}\n`;
    await fs.promises.appendFile(logPath, line, 'utf8');
};

module.exports = {
    appendFailedDownload,
};
