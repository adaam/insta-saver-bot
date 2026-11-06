const test = require('node:test');
const assert = require('node:assert/strict');
const { sendInstagramMedia } = require('../src/telegramMedia');

test('sends a single photo with an explicit content type', async () => {
    const calls = [];
    const bot = {
        sendPhoto: (...args) => calls.push(args),
    };

    await sendInstagramMedia(
        bot,
        123,
        [{ filePath: '/tmp/Post.jpg', mediaType: 'photo' }],
        'caption'
    );

    assert.deepEqual(calls, [[
        123,
        '/tmp/Post.jpg',
        { caption: 'caption' },
        { filename: 'Post.jpg', contentType: 'image/jpeg' },
    ]]);
});

test('splits mixed media into Telegram groups of at most ten', async () => {
    const calls = [];
    const bot = {
        sendMediaGroup: (_chatId, media) => calls.push(['group', media]),
        sendPhoto: (_chatId, filePath, options) => calls.push(['photo', filePath, options]),
    };
    const media = Array.from({ length: 11 }, (_, index) => ({
        filePath: `/tmp/Post_${index + 1}.jpg`,
        mediaType: 'photo',
    }));

    await sendInstagramMedia(bot, 123, media, 'caption');

    assert.equal(calls[0][0], 'group');
    assert.equal(calls[0][1].length, 10);
    assert.equal(calls[0][1][0].caption, 'caption');
    assert.deepEqual(calls[1], ['photo', '/tmp/Post_11.jpg', {}]);
});
