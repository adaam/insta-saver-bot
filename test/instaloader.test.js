const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    findDownloadedMedia,
    isInstagramRateLimitError,
    isValidShortCode,
} = require('../src/instaloader');

test('accepts safe Instagram shortcodes only', () => {
    assert.equal(isValidShortCode('Abc_123-'), true);
    assert.equal(isValidShortCode('../post'), false);
});

test('recognizes explicit Instagram HTTP 429 errors', () => {
    assert.equal(isInstagramRateLimitError(new Error(
        'JSON Query: 429 Too Many Requests when accessing https://www.instagram.com/graphql/query'
    )), true);
    assert.equal(isInstagramRateLimitError(new Error('HTTP status 429')), true);
    assert.equal(isInstagramRateLimitError(new Error(
        '400 Bad Request - fail status, message feedback_required'
    )), false);
    assert.equal(isInstagramRateLimitError(new Error('Connection timed out')), false);
});

test('finds and orders photo/video carousel files', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'instaloader-test-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const profile = path.join(root, 'example.user');
    await fs.promises.mkdir(profile);

    for (const filename of ['Code_10.jpg', 'Code_2.mp4', 'Code_1.jpg', 'unrelated.jpg']) {
        await fs.promises.writeFile(path.join(profile, filename), 'test');
    }

    const result = await findDownloadedMedia(root, 'Code');
    assert.equal(result.username, 'example.user');
    assert.deepEqual(
        result.mediaFiles.map(({ filePath, mediaType }) => [path.basename(filePath), mediaType]),
        [
            ['Code_1.jpg', 'photo'],
            ['Code_2.mp4', 'video'],
            ['Code_10.jpg', 'photo'],
        ]
    );
});
