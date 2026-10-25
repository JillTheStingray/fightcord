// node --test tests/      the arcade VS / result screens (3.1): most-used characters, the stats face-off,
// rank progress, the set game by game
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../fightcord-core.js');
const ms = require('../match-screens.js');
const data = core._test.data;

test('most-used characters: top 3 by sets, ties by name, blanks skipped', () => {
    const sets = [{ myChar: 'Ken' }, { myChar: 'Akuma' }, { myChar: 'Ken' }, { myChar: '' }, { myChar: 'Yun' }, { myChar: 'Chun-Li' }, { myChar: 'Ken' }, {}, null];
    assert.deepEqual(ms.picksOf(sets, 'myChar'), [['Ken', 3], ['Akuma', 1], ['Chun-Li', 1]]);
    assert.deepEqual(ms.picksOf([], 'oppChar'), []);
    assert.deepEqual(ms.picksOf([{ oppChar: 'Yun' }, { oppChar: 'Yun' }], 'oppChar'), [['Yun', 2]]);
});

test('the tale of the tape: ranks, ELO, head to head, and the set odds', () => {
    const t = ms.tapeOf({ myRank: 4, oppRank: 5, myElo: { elo: 1450, est: true }, oppElo: { elo: 1600, est: false }, vs: { w: 2, l: 3 }, ft: 5 }, data);
    assert.deepEqual(t.rows.map(r => r[0]), ['Rank', 'ELO', 'Head to head']);
    assert.deepEqual(t.rows[0].slice(1), ['B', 'A', -1]);
    assert.deepEqual(t.rows[1].slice(1), ['~1,450', '1,600', -1]);
    assert.deepEqual(t.rows[2].slice(1), ['2', '3', -1]);
    assert.equal(t.ft, 5);
    assert.ok(t.odds.set < 0.5 && t.odds.set > 0, 'the lower ELO is the underdog');
    assert.equal(t.odds.est, true, 'an estimate on either side marks the odds as estimated');
    // nothing known: no rows, no odds; unknown FT counts as FT3
    const none = ms.tapeOf({}, data);
    assert.deepEqual(none.rows, []);
    assert.equal(none.odds, null);
    assert.equal(none.ft, 3);
    // first meeting: no head-to-head row
    assert.ok(!ms.tapeOf({ myRank: 3, oppRank: 3, vs: { w: 0, l: 0 } }, data).rows.some(r => r[0] === 'Head to head'));
});

test('rank progress through the ELO bands', () => {
    assert.deepEqual(data.rankProgress(4, 1450), { frac: 0.5, next: 5 });
    assert.equal(data.rankProgress('B', 1300).frac, 0, 'bottom of the band');
    assert.equal(data.rankProgress(1, 300).frac, 0, 'below the lowest band clamps');
    assert.deepEqual(data.rankProgress(6, 2500), { frac: 1, next: null }, 'S: the top rank');
    assert.equal(data.rankProgress(0, 1500), null);
    assert.equal(data.rankProgress(4, null), null);
    assert.equal(data.rankOfElo(1599), 4);
    assert.equal(data.rankOfElo(1600), 5);
    assert.equal(data.rankOfElo(200), 1);
    assert.equal(data.rankOfElo(0), 0);
});

test('the set game by game, from the emulator’s score', () => {
    const side = (a, b, mc, tc) => ({ mine: { score: a, char: mc }, theirs: { score: b, char: tc } });
    let c = ms.charStep(null, side(0, 0, 'Ken', 'Yun'));
    c = ms.charStep(c, side(1, 0, 'Ken', 'Yun'));
    c = ms.charStep(c, side(1, 1, 'Ken', 'Yun'));
    c = ms.charStep(c, side(1, 1, 'Ken', 'Chun-Li'));          // they switch between games
    c = ms.charStep(c, side(2, 1, 'Ken', 'Chun-Li'));
    c = ms.charStep(c, side(2, 1, 'Ken', 'Chun-Li'));          // the same poll again: nothing new
    assert.deepEqual(c.games.map(g => g.w), [1, 0, 1]);
    assert.deepEqual(c.games.map(g => g.t), ['Yun', 'Yun', 'Chun-Li']);
    // two games between polls: both counted (yours first)
    c = ms.charStep(c, side(3, 2, 'Ken', 'Chun-Li'));
    assert.deepEqual(c.games.map(g => g.w), [1, 0, 1, 1, 0]);
    assert.equal(c.games.length, c.sm + c.st, 'one per game');
    // joined mid-set: only the games seen
    const late = ms.charStep(ms.charStep(null, side(2, 1, 'Ken', 'Yun')), side(3, 1, 'Ken', 'Yun'));
    assert.deepEqual(late.games.map(g => g.w), [1]);
});
