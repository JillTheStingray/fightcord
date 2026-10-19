// node --test tests/      Fightcord players (presence.js): name hashes, the book of who's online, replies
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const p = require('../presence.js');

test('names travel hashed, the same whatever the case', () => {
    const h = p.hashOf('NeutralKid82');
    assert.match(h, /^[0-9a-f]{32}$/);
    assert.equal(p.hashOf('neutralkid82'), h);
    assert.notEqual(p.hashOf('NeutralKid83'), h);
    assert.ok(!h.includes('neutral'));
});

test('the book: news only when something changed, gone after the TTL', () => {
    const b = p.Book(1000);
    assert.equal(b.heard('a', 0, 0), true);             // new
    assert.equal(b.heard('a', 0, 500), false);          // same, still fresh
    assert.equal(b.heard('a', 1, 600), true);           // voice turned on
    assert.deepEqual(b.get('a', 1500), { at: 600, voice: true, pv: '' });
    assert.equal(b.heard('a', 1, 650, 'abcd1234'), true, 'a new profile version is news');
    assert.equal(b.heard('a', 1, 660, 'abcd1234'), false);
    assert.equal(b.heard('a', 1, 670, 'not-a-pv'), true, 'a broken version counts as none');
    assert.equal(b.get('a', 1700), null);               // not heard for too long
    assert.equal(b.heard('a', 1, 1700), true);          // back = news
    assert.equal(b.count(1700), 1);
    assert.equal(b.gone('a'), true);
    assert.equal(b.get('a', 1700), null);
});

test('react: who records, who gets an answer', () => {
    const me = p.hashOf('me'), them = p.hashOf('them');
    assert.equal(p.react({ t: 'here', h: them }, me), 'record');
    assert.equal(p.react({ t: 'hi', h: them }, me), 'record+reply');
    assert.equal(p.react({ t: 'bye', h: them }, me), 'forget');
    assert.equal(p.react({ t: 'all' }, me), 'reply-soon');           // someone hidden asking
    assert.equal(p.react({ t: 'who', q: me }, me), 'reply');         // asked about us directly
    assert.equal(p.react({ t: 'who', q: them }, me), '');
    assert.equal(p.react({ t: 'who', q: '' }, ''), '');              // we don't know who we are yet
    assert.equal(p.react({ t: 'here', h: me }, me), '');             // our own echo
    assert.equal(p.react({ t: 'here', h: 'not-a-hash' }, me), '');
    assert.equal(p.react({ t: 'here' }, me), '');
    assert.equal(p.react(null, me), '');
    assert.equal(p.react({ t: 'nonsense', h: them }, me), '');
});

test('profiles: cleaned, capped, versioned; badges from your own history', () => {
    const c = p.cleanProfile({ s: '  hi\u0000 there ‮  ', a: 'x'.repeat(300), b: 'sfiii3nr1', bd: ['sets100', 'nope', 'sets100', 'streak5'] });
    assert.deepEqual(c, { s: 'hi there', a: 'x'.repeat(190), b: 'sfiii3nr1', bd: ['sets100', 'streak5'] });
    assert.equal(p.cleanProfile({ b: '../evil' }).b, '', 'a banner is a rom name, nothing else');
    assert.deepEqual(p.cleanProfile(null), { s: '', a: '', b: '', bd: [] });
    assert.match(p.profileVersion({ s: 'gg' }), /^[0-9a-f]{8}$/);
    assert.equal(p.profileVersion({ s: 'gg' }), p.profileVersion({ s: 'gg', a: '', bd: [] }), 'the same profile, the same version');
    assert.notEqual(p.profileVersion({ s: 'gg' }), p.profileVersion({ s: 'gg!' }));
    const sets = (results) => results.split('').map(r => ({ result: r === 'W' ? 'won' : r === 'L' ? 'lost' : null }));
    assert.deepEqual(p.badgesFrom(sets('WWWWLWWWWW?W'), 0), ['streak5'], 'an unknown result doesn’t break a streak');
    assert.deepEqual(p.badgesFrom(sets('W'.repeat(120)), 7), ['sets100', 'streak20', 'top10']);
    assert.deepEqual(p.badgesFrom([], 150), [], 'top 300 isn’t a badge');
});
