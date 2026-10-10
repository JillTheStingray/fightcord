// node --test tests/      the game hub's data handling (game-hub.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const hub = require('../game-hub.js');

const Q = (o) => Object.assign({ quarkid: '1790', gameid: 'sfiii3nr1', emulator: 'fbneo', date: 1790000000, ranked: 3, num_matches: 5, duration: 600,
    players: [{ name: 'Alpha', score: 3, country: { iso_code: 'JP' } }, { name: 'Beta', score: 1, country: 'br' }] }, o);

test('hub: a quark row becomes a replay row (winner, FT, replay link, seconds or ms dates)', () => {
    const r = hub.replayRow(Q(), 'sfiii3nr1');
    assert.equal(r.winner, 0);
    assert.equal(r.ft, 3);
    assert.deepEqual(r.players.map(p => [p.name, p.score, p.cc]), [['Alpha', 3, 'jp'], ['Beta', 1, 'br']]);
    assert.equal(r.replay, 'https://replay.fightcade.com/fbneo/sfiii3nr1/1790');
    assert.equal(r.at, 1790000000 * 1000);
    assert.equal(hub.replayRow(Q({ date: 1790000000123 })).at, 1790000000123);
    // live: no replay yet, no winner
    const live = hub.replayRow(Q({ live: true, players: [{ name: 'A', score: null }, { name: 'B', score: null }] }));
    assert.equal(live.live, true);
    assert.equal(live.replay, '');
    assert.equal(live.winner, -1);
    // a draw, casual, nothing odd
    assert.equal(hub.replayRow(Q({ players: [{ name: 'A', score: 2 }, { name: 'B', score: 2 }] })).winner, -1);
    assert.equal(hub.replayRow(Q({ ranked: 0 })).ft, null);
    assert.deepEqual(hub.replayRow(null).players, []);
});

test('hub: replay filters (mine / friends / top 100)', () => {
    const rows = [Q(), Q({ players: [{ name: 'Me' }, { name: 'Gamma' }] }), Q({ players: [{ name: 'Delta' }, { name: 'friendo' }] })].map(q => hub.replayRow(q, 'x'));
    const ctx = { me: 'me', friends: new Set(['friendo']), top: new Set(['alpha']) };
    assert.equal(hub.filterReplays(rows, 'all', ctx).length, 3);
    assert.deepEqual(hub.filterReplays(rows, 'mine', ctx).map(r => r.players[1].name), ['Gamma']);
    assert.deepEqual(hub.filterReplays(rows, 'friends', ctx).map(r => r.players[0].name), ['Delta']);
    assert.deepEqual(hub.filterReplays(rows, 'top', ctx).map(r => r.players[0].name), ['Alpha']);
});

test('hub: ranking rows and search', () => {
    const rows = [{ name: 'KenMaster', country: { iso_code: 'US' }, gameinfo: { g: { rank: 6, num_matches: 900, time_played: 7200 } } }, { name: 'ryu_fan', gameinfo: {} }]
        .map((r, i) => hub.rankRow(r, i, 'g'));
    assert.deepEqual(rows[0], { pos: 1, name: 'KenMaster', cc: 'us', rank: 6, matches: 900, hours: 2, gravatar: '' });
    assert.equal(rows[1].rank, 0);
    assert.deepEqual(hub.searchRanks(rows, 'ken').map(r => r.name), ['KenMaster']);
    assert.equal(hub.searchRanks(rows, '  ').length, 2);
    assert.equal(hub.searchRanks(rows, 'zzz').length, 0);
});
