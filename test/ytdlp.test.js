const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isNoVideoError, parseYtDlpOutput } = require('../src/ytdlp');

test('parses multiple yt-dlp MP4 result records in order', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ytdlp-test-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const profile = path.join(root, 'example_user');
    await fs.promises.mkdir(profile);
    const first = path.join(profile, '123_456.mp4');
    const second = path.join(profile, '123_789.mp4');
    await fs.promises.writeFile(first, 'video');
    await fs.promises.writeFile(second, 'video');
    const stdout = [
        JSON.stringify({ filepath: first, uploader_id: 'example_user', display_id: '123' }),
        JSON.stringify({ filepath: second, uploader_id: 'example_user', display_id: '123' }),
    ].join('\n');

    const result = parseYtDlpOutput(stdout, root, '123');
    assert.equal(result.username, 'example_user');
    assert.deepEqual(
        result.mediaFiles.map(({ filePath, mediaType }) => [filePath, mediaType]),
        [[first, 'video'], [second, 'video']]
    );
});

test('allows an empty yt-dlp result for a photo-only Tweet', () => {
    assert.deepEqual(parseYtDlpOutput('', '/tmp/twitter', '123'), {
        username: 'unknown',
        mediaFiles: [],
    });
});

test('recognizes only yt-dlp no-video errors as an empty video result', () => {
    assert.equal(isNoVideoError('ERROR: No video formats found!'), true);
    assert.equal(isNoVideoError('No video could be found in this tweet'), true);
    assert.equal(isNoVideoError('ERROR: Login required'), false);
});

test('rejects yt-dlp files outside the download root', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ytdlp-root-'));
    const outside = path.join(os.tmpdir(), 'outside-twitter-test.mp4');
    t.after(() => Promise.all([
        fs.promises.rm(root, { recursive: true, force: true }),
        fs.promises.rm(outside, { force: true }),
    ]));
    await fs.promises.writeFile(outside, 'video');

    assert.throws(
        () => parseYtDlpOutput(
            JSON.stringify({ filepath: outside, uploader_id: 'user', display_id: '123' }),
            root,
            '123'
        ),
        /invalid or missing MP4/
    );
});
