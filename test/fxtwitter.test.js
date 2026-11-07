const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFallbackMedia } = require('../src/fxtwitter');

test('extracts ordered photo and video media from FxTwitter', () => {
    const result = extractFallbackMedia({
        tweet: {
            id: '123',
            author: { screen_name: 'example_user' },
            media: {
                all: [
                    {
                        id: '456',
                        type: 'video',
                        url: 'https://video.twimg.com/path/video.mp4?tag=1',
                    },
                    {
                        id: '789',
                        type: 'photo',
                        url: 'https://pbs.twimg.com/media/photo.jpg?name=orig',
                    },
                ],
            },
        },
    }, '123');

    assert.equal(result.username, 'example_user');
    assert.deepEqual(result.media.map(({ id, mediaType, position }) => ({
        id,
        mediaType,
        position,
    })), [
        { id: '456', mediaType: 'video', position: 1 },
        { id: '789', mediaType: 'photo', position: 2 },
    ]);
});

test('rejects untrusted FxTwitter media hosts and mismatched Tweet IDs', () => {
    const payload = {
        tweet: {
            id: '123',
            author: { screen_name: 'example' },
            media: { all: [{ type: 'photo', url: 'https://example.com/photo.jpg' }] },
        },
    };
    assert.throws(() => extractFallbackMedia(payload, '123'), /untrusted media URL/);
    assert.throws(() => extractFallbackMedia(payload, '456'), /unexpected Tweet ID/);
});
