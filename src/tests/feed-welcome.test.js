// node --test tests/      the pure parts of feed.js and welcome.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const feed = require('../feed.js');
const welcome = require('../welcome.js');

test('feed: joins and leaves are grouped into one line', () => {
    assert.equal(feed.groupLine(['Ken'], 'join'), 'Ken joined');
    assert.equal(feed.groupLine(['Ken', 'Ryu'], 'join'), 'Ken and Ryu joined');
    assert.equal(feed.groupLine(['Ken', 'Ryu', 'Chun'], 'leave'), 'Ken, Ryu and 1 other left');
    assert.equal(feed.groupLine(['a', 'b', 'c', 'd', 'e'], 'join'), 'a, b and 3 others joined');
    assert.equal(feed.groupLine(['<x>'], 'join', (n) => '[' + n + ']'), '[<x>] joined');
});

test('feed: only interesting matches get their result looked up', () => {
    const none = () => false, noPos = () => 0;
    assert.equal(feed.worthLookup(['a'], [3], none, noPos), false, 'one player');
    assert.equal(feed.worthLookup(['a', 'b'], [3, 4], none, noPos), false, 'close ranks, strangers');
    assert.equal(feed.worthLookup(['a', 'b'], [2, 4], none, noPos), true, 'gap of 2');
    assert.equal(feed.worthLookup(['a', 'b'], [0, 6], none, noPos), false, 'unranked: no gap');
    assert.equal(feed.worthLookup(['a', 'b'], [3, 3], (n) => n === 'b', noPos), true, 'a friend');
    assert.equal(feed.worthLookup(['a', 'b'], [3, 3], none, (n) => (n === 'a' ? 42 : 0)), true, 'top 100');
    assert.equal(feed.worthLookup(['a', 'b'], [3, 3], none, () => 250), false, 'ranked but not top 100');
});

test('welcome: version compare', () => {
    const c = welcome.cmpVer;
    assert.equal(c('1.9', '1.9.0'), 0);
    assert.equal(c('1.10', '1.9'), 1);
    assert.equal(c('2.0.0', '1.9.2'), 1);
    assert.equal(c('', '0.1'), -1);
});

test('welcome: news shows once, only when this version has it', () => {
    const n = welcome.pendingNews;
    assert.equal(n('', '1.9.2').v, '1.9', 'a 2.0 beta shows the 2.0 news');
    assert.equal(n('1.9', '1.9.3'), null, 'seen already');
    assert.equal(n('1.9', '2.0.0'), null, '2.0 final: the same news, not again');
    assert.equal(n('', '1.8.0'), null, 'an older version has no news yet');
    assert.ok(welcome.NEWS.every(x => x.items.length && x.title));
});
