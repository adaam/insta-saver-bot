const test = require('node:test');
const assert = require('node:assert/strict');
const { domainCleaner, extractShortCode } = require('../src/helper');

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
