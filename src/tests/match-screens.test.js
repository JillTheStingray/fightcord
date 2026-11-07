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

test('the set score from Fightcade’s end-of-set row: your side, their name, nothing played (issue #2)', () => {
    const e = (o) => Object.assign({ name: 'Me', opponent: { name: 'Zig' }, playerId: 0, scores: [3, 1], ranked: 3 }, o);
    assert.deepEqual(ms.scoreOf(e({}), 'Zig'), { mine: 3, theirs: 1 });
    assert.deepEqual(ms.scoreOf(e({ playerId: 1 }), 'zig'), { mine: 1, theirs: 3 }, 'you as player 2');
    assert.deepEqual(ms.scoreOf(e({ ranked: 0, scores: [2, 2] }), 'Zig'), { mine: 2, theirs: 2 }, 'casual sets too');
    assert.equal(ms.scoreOf(e({}), 'Someone else'), null, 'another set’s row');
    assert.equal(ms.scoreOf(e({ scores: [0, 0] }), 'Zig'), null, 'no games played');
    assert.equal(ms.scoreOf(e({ scores: null }), 'Zig'), null);
    assert.equal(ms.scoreOf(null, 'Zig'), null);
    assert.deepEqual(ms.scoreOf(e({}), ''), { mine: 3, theirs: 1 }, 'opponent unknown: still counts');
});

test('casual sets the site lists as 0-0 count from the emulator’s own games (3.8.2)', () => {
    const site = (mine, theirs, games) => ({ mine, theirs, games });
    const emu = (mine, theirs) => ({ mine, theirs });
    assert.deepEqual(ms.siteOrEmu(site(1, 3, 4), emu(1, 2)), { mine: 1, theirs: 3 }, 'the site has it: the site');
    assert.deepEqual(ms.siteOrEmu(site(0, 0, 0), emu(4, 2)), { mine: 4, theirs: 2 }, 'was thrown away as "no games played"');
    assert.deepEqual(ms.siteOrEmu(site(0, 0, 6), emu(4, 2)), { mine: 4, theirs: 2 }, 'was saved as a 0-0 draw');
    assert.equal(ms.siteOrEmu(site(0, 0, 0), emu(0, 0)), 'none', 'really nothing played');
    assert.equal(ms.siteOrEmu(site(0, 0, 0), null), 'none');
    assert.equal(ms.siteOrEmu(site(0, 0, 3), null), null, 'played, score unknown yet: ask again');
    assert.equal(ms.siteOrEmu(null, emu(2, 1)), null, 'the site not answering yet: ask again first');
    assert.equal(ms.verdict(0, 0), null, '0-0 is not a draw');
    assert.equal(ms.verdict(2, 2), 'draw');
    assert.equal(ms.verdict(3, 1), 'won');
});

// 3.13: the result screen's stamps
test('callouts: perfect set, comeback, clutch, upset, rank up, so close', () => {
    const G = (s) => s.split('').map(c => ({ w: c === 'W' ? 1 : 0 }));
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 0, ft: 3 }), ['perfect']);
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 1, games: G('LWWW'), ft: 3 }), ['comeback'], 'behind 0–1, then won');
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 1, games: G('WLWW'), ft: 3 }), [], 'never behind: nothing');
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 2, games: G('WWLLW'), ft: 3 }), ['clutch'], 'the last game decided it');
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 2, games: G('LLWWW'), ft: 3 }), ['comeback', 'clutch']);
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 2, ft: 0 }), [], 'a casual set has no deciding game');
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 2, ft: 5 }), [], 'FT5: 3–2 isn’t the end');
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 1, ft: 3, myRank: 3, oppRank: 5 }), ['upset'], 'beat a higher rank');
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 1, ft: 3, myRank: 5, oppRank: 3 }), []);
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 3, theirs: 0, ft: 3, myRank: 2, oppRank: 4, rankUp: true }), ['rankup', 'perfect'], 'at most two, rank up first');
    assert.deepEqual(ms.calloutsOf({ kind: 'lost', mine: 2, theirs: 3, ft: 3 }), ['close']);
    assert.deepEqual(ms.calloutsOf({ kind: 'lost', mine: 0, theirs: 3, ft: 3 }), []);
    assert.deepEqual(ms.calloutsOf({ kind: 'draw', mine: 2, theirs: 2 }), []);
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: null, theirs: null }), [], 'no score known: no stamps');
    assert.deepEqual(ms.calloutsOf({ kind: 'won', mine: 2, theirs: 1 }), ['clutch'], 'FT unknown: one game each from the end still counts');
    assert.deepEqual(ms.calloutsOf(), []);
});

test('the VS banner: ranked FT, casual, matchmaking, unknown', () => {
    assert.deepEqual(ms.modeOf(3), { mm: false, mode: 'ranked', ft: 3 });
    assert.deepEqual(ms.modeOf(0), { mm: false, mode: 'casual', ft: 0 });
    assert.deepEqual(ms.modeOf(null), { mm: false, mode: '', ft: 0 });
    assert.deepEqual(ms.modeOf(undefined, 'matchmaking'), { mm: true, mode: '', ft: 0 });
    assert.deepEqual(ms.modeOf(5, 'matchmaking'), { mm: true, mode: 'ranked', ft: 5 });
});
