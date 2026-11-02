// node --test tests/      3.9: which moments a finished set is worth (celebrations.js), and a new best ELO (progress.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const C = require('../celebrations.js');
const P = require('../progress.js');

const set = (result, opp, at) => ({ result, opp: opp || 'Zig', at: at || 0 });

test('win streaks: 3, 5, 10, then every 5; a set without a result doesn’t break one', () => {
    assert.equal(C.winRun([set('lost'), set('won'), set('won'), set('won')]), 3);
    assert.equal(C.winRun([set('won'), set('won'), set(null), set('won')]), 3, 'unknown result: still going');
    assert.equal(C.winRun([set('won'), set('draw')]), 0, 'a draw ends it');
    const wins = (n) => Array.from({ length: n }, () => set('won'));
    assert.deepEqual(C.streakMoment(wins(3)), { kind: 'streak', n: 3 });
    assert.equal(C.streakMoment(wins(4)), null);
    assert.deepEqual(C.streakMoment(wins(5)), { kind: 'streak', n: 5 });
    assert.deepEqual(C.streakMoment(wins(10)), { kind: 'streak', n: 10 });
    assert.equal(C.streakMoment(wins(12)), null);
    assert.deepEqual(C.streakMoment(wins(15)), { kind: 'streak', n: 15 });
});

test('nemesis: your first set win vs someone who beat you 3+ times', () => {
    const before = [set('lost', 'Boss'), set('lost', 'boss'), set('lost', 'Boss'), set('won', 'Other')];
    assert.deepEqual(C.nemesisMoment(before, set('won', 'Boss')), { kind: 'nemesis', opp: 'Boss', lost: 3 });
    assert.equal(C.nemesisMoment(before.slice(1), set('won', 'Boss')), null, 'only 2 losses');
    assert.equal(C.nemesisMoment(before.concat(set('won', 'Boss')), set('won', 'Boss')), null, 'not the first win');
    assert.equal(C.nemesisMoment(before, set('lost', 'Boss')), null);
});

test('one set, several moments: the biggest first', () => {
    const before = [set('lost', 'Boss'), set('lost', 'Boss'), set('lost', 'Boss'), set('won', 'A'), set('won', 'B')];
    const s = set('won', 'Boss');
    const m = C.momentsFor({ set: s, before, session: [set('won', 'A'), set('won', 'B'), s], badgesBefore: [], badgesAfter: ['sets100'] });
    assert.deepEqual(m.map(x => x.kind), ['badge', 'nemesis', 'streak']);
    const off = C.momentsFor({ set: s, before, session: [set('won', 'A'), set('won', 'B'), s], badgesBefore: [], badgesAfter: ['sets100'], on: { badge: false, nemesis: false } });
    assert.deepEqual(off.map(x => x.kind), ['streak'], 'switched off in Settings');
    assert.deepEqual(C.momentsFor({ set: set('lost'), before: [], session: [set('lost')], badgesBefore: ['sets100'], badgesAfter: ['sets100'] }), []);
});

test('a new best ELO: real ELO only, above your best, after 3 real points', () => {
    const pts = [{ rom: 'sf', elo: 1500, est: false }, { rom: 'sf', elo: 1540, est: false }, { rom: 'sf', elo: 1520, est: false }, { rom: 'sf', elo: 1900, est: true }, { rom: 'kof', elo: 2000, est: false }];
    assert.deepEqual(P.bestElo(pts, { rom: 'sf', elo: 1550, est: false }), { rom: 'sf', elo: 1550, prev: 1540 });
    assert.equal(P.bestElo(pts, { rom: 'sf', elo: 1540, est: false }), null, 'equal is not above');
    assert.equal(P.bestElo(pts, { rom: 'sf', elo: 1600, est: true }), null, 'an estimate');
    assert.equal(P.bestElo(pts.slice(0, 2), { rom: 'sf', elo: 1600, est: false }), null, 'too early to tell');
    assert.equal(P.bestElo(pts, { rom: 'new', elo: 1600, est: false }), null);
});
