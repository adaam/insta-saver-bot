const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    isFallbackEligibleError,
    isValidTweetId,
    loadCachedTwitterMedia,
} = require('../src/twitter');

test('accepts numeric Tweet IDs only', () => {
    assert.equal(isValidTweetId('1234567890'), true);
    assert.equal(isValidTweetId('../123'), false);
    assert.equal(isValidTweetId('tweet'), false);
});

test('uses fallback only for Twitter/X access restrictions', () => {
    assert.equal(isFallbackEligibleError(new Error("[twitter][error] 'Unavailable'")), true);
    assert.equal(isFallbackEligibleError(new Error('AuthRequired: authenticated cookies needed')), true);
    assert.equal(isFallbackEligibleError(new Error('gallery-dl was not found')), false);
    assert.equal(isFallbackEligibleError(new Error('invalid output file')), false);
});

test('loads a complete mixed-media Twitter cache', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'twitter-cache-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const profile = path.join(root, 'example_user');
    const cache = path.join(root, '.cache');
    await fs.promises.mkdir(profile);
    await fs.promises.mkdir(cache);
    await fs.promises.writeFile(path.join(profile, '123_1.jpg'), 'photo');
    await fs.promises.writeFile(path.join(profile, '123_456.mp4'), 'video');
    await fs.promises.writeFile(path.join(cache, '123.json'), JSON.stringify({
        username: 'example_user',
        files: ['example_user/123_1.jpg', 'example_user/123_456.mp4'],
    }));

    const result = await loadCachedTwitterMedia(root, '123');
    assert.equal(result.username, 'example_user');
    assert.deepEqual(
        result.mediaFiles.map(({ mediaType }) => mediaType),
        ['photo', 'video']
    );
});
