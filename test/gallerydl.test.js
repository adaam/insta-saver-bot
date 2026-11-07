const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findDownloadedPhotos } = require('../src/gallerydl');

test('finds and orders gallery-dl Tweet photos', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gallerydl-test-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const profile = path.join(root, 'example_user');
    await fs.promises.mkdir(profile);
    for (const filename of ['123_10.jpg', '123_2.webp', '123_1.png', 'other_1.jpg']) {
        await fs.promises.writeFile(path.join(profile, filename), 'photo');
    }

    const result = await findDownloadedPhotos(root, '123');
    assert.equal(result.username, 'example_user');
    assert.deepEqual(
        result.mediaFiles.map(({ filePath, mediaType }) => [path.basename(filePath), mediaType]),
        [
            ['123_1.png', 'photo'],
            ['123_2.webp', 'photo'],
            ['123_10.jpg', 'photo'],
        ]
    );
});

test('returns an empty list for a video-only Tweet', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gallerydl-empty-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    assert.deepEqual(await findDownloadedPhotos(root, '123'), {
        username: 'unknown',
        mediaFiles: [],
    });
});
