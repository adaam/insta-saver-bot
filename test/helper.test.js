const test = require('node:test');
const assert = require('node:assert/strict');
const { domainCleaner, extractShortCode, parseMediaUrl } = require('../src/helper');

test('accepts and cleans an Instagram Reel URL', () => {
    const result = domainCleaner(' https://www.instagram.com/reel/DfTcQL2BMvl/?igsh=test ');

    assert.equal(result.success, true);
    assert.equal(result.data, 'https://www.instagram.com/reel/DfTcQL2BMvl/');
    assert.equal(extractShortCode(result.data), 'DfTcQL2BMvl');
});

test('accepts instagram.com without www', () => {
    const result = domainCleaner('https://instagram.com/p/ABC_123-/');

    assert.equal(result.success, true);
    assert.equal(extractShortCode(result.data), 'ABC_123-');
});

test('rejects lookalike and non-HTTPS domains', () => {
    assert.equal(domainCleaner('https://instagram.com.example.com/reel/abc/').success, false);
    assert.equal(domainCleaner('http://instagram.com/reel/abc/').success, false);
});

test('accepts and cleans Twitter/X status URLs', () => {
    const xResult = parseMediaUrl(
        'https://x.com/example/status/1234567890?s=20&t=value#fragment'
    );
    assert.deepEqual(xResult, {
        success: true,
        platform: 'twitter',
        data: 'https://x.com/example/status/1234567890',
        mediaId: '1234567890',
    });

    const twitterResult = parseMediaUrl(
        'https://mobile.twitter.com/example/status/1234567890/photo/1?ref=test'
    );
    assert.equal(twitterResult.success, true);
    assert.equal(twitterResult.data, 'https://mobile.twitter.com/example/status/1234567890');
});

test('rejects unsafe or unsupported Twitter/X URLs', () => {
    assert.equal(parseMediaUrl('http://x.com/user/status/123').success, false);
    assert.equal(parseMediaUrl('https://x.com.example.com/user/status/123').success, false);
    assert.equal(parseMediaUrl('https://x.com/user/status/not-a-number').success, false);
    assert.equal(parseMediaUrl('https://x.com/user').success, false);
});
