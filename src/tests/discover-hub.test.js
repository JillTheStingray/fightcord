// node --test tests/      Discover's live hub (discover.js, 3.14): which game, and what it shows
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const disc = require('../discover.js');

const SF3 = { full: 'Street Fighter III 3rd Strike (Japan 990512)', short: 'Street Fighter III 3rd Strike', rom: 'sfiii3nr1', chan: { id: 'sf3' }, played: true, lastAt: 5, w: 3, l: 1 };
const KOF = { full: 'The King of Fighters 98', short: 'The King of Fighters 98', rom: 'kof98', chan: { id: 'kof' }, joined: true };

test('hub game: the last game you played that you are in, else the first joined one, else none', () => {
    const favOnly = { full: 'Vampire Savior', short: 'Vampire Savior', chan: null, fav: true };
    const playedNotJoined = { full: 'Garou', short: 'Garou', chan: null, played: true };
    assert.equal(disc.hubGame([playedNotJoined, KOF, SF3]), SF3, 'played and joined beats only joined');
    assert.equal(disc.hubGame([favOnly, KOF]), KOF, 'nothing played: the first joined game');
    assert.equal(disc.hubGame([favOnly, playedNotJoined]), null, 'no joined game: no hub (the spotlight stays)');
    assert.equal(disc.hubGame([]), null);
    assert.equal(disc.hubGame(null), null);
});

test('hub contents: only that game\'s matches, friends and rivals (channels by id or name)', () => {
    const live = [{ quark: 1, channel: 'sf3', players: ['a', 'b'] }, { quark: 2, channel: 'kof', players: ['c', 'd'] }, { quark: 3, channel: SF3.full, players: ['e', 'f'] }];
    const friends = [
        { name: 'InSf3ById', playing: null, channels: ['sf3'] },
        { name: 'InSf3ByName', playing: null, channels: [SF3.full, 'kof'] },
        { name: 'PlayingSf3', playing: { channelId: 'sf3', quarkId: 1 }, channels: ['kof'] },
        { name: 'PlayingKof', playing: { channelId: 'kof', quarkId: 2 }, channels: ['sf3'] },
        { name: 'Elsewhere', playing: null, channels: ['kof'] }
    ];
    const rivals = [{ name: 'R1', channel: SF3.full }, { name: 'R2', channel: 'Street Fighter III 3rd Strike (other set)' }, { name: 'R3', channel: KOF.full }];
    const h = disc.hubOf(SF3, live, friends, rivals);
    assert.equal(h.it, SF3);
    assert.deepEqual(h.live.map(m => m.quark), [1, 3]);
    // a friend in a match elsewhere is shown where they play, not here
    assert.deepEqual(h.friends.map(f => f.name), ['InSf3ById', 'InSf3ByName', 'PlayingSf3']);
    assert.deepEqual(h.rivals.map(r => r.name), ['R1', 'R2'], 'the same game under another set name counts');
    assert.equal(disc.hubOf(null, live, friends, rivals), null);
    const empty = disc.hubOf(KOF, [], null, undefined);
    assert.deepEqual([empty.live, empty.friends, empty.rivals], [[], [], []]);
});

test('hub shown: the rows below skip the first 4 matches and 3 friends / rivals the hub shows', () => {
    const live = [1, 2, 3, 4, 5].map(q => ({ quark: q, channel: 'sf3', players: [] }));
    const h = { it: SF3, live, friends: ['Ann', 'Bo', 'Cy', 'Di'].map(name => ({ name })), rivals: [{ name: 'Rex' }] };
    const s = disc.hubShown(h);
    assert.deepEqual([...s.quarks], ['1', '2', '3', '4'], 'the 5th match stays in Live now below');
    assert.deepEqual([...s.names].sort(), ['ann', 'bo', 'cy', 'rex'], 'case-insensitive, the 4th friend stays below');
    const none = disc.hubShown(null);
    assert.equal(none.names.size + none.quarks.size, 0);
});
