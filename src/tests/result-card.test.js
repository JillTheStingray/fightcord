// Match result cards: what Fightcade's end-of-set message says, from its data or its text
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../result-card.js');

const URL = 'https://replay.fightcade.com/fbneo/sfiii3nr1/1793300094615-8556';
const eg = (o) => ({ endgame: Object.assign({ name: 'Me', opponent: { name: 'Zig' }, playerId: 0, scores: [2, 0], ranked: 2, initialElo: 0, finalElo: 0, replayUrl: URL }, o) });

test('ranked: score, FT, outcome and the replay’s game, from Fightcade’s data', () => {
    const r = R.parseEndgame(eg({}), 'Me');
    assert.deepEqual([r.ranked, r.ft, r.me, r.opp, r.my, r.their, r.outcome, r.quit], [true, 2, 'Me', 'Zig', 2, 0, 'won', false]);
    assert.deepEqual([r.emu, r.rom, r.quark, r.replay], ['fbneo', 'sfiii3nr1', '1793300094615-8556', URL]);
    assert.equal(r.elo, null, 'no ELO sent');
    const l = R.parseEndgame(eg({ scores: [1, 3], ranked: 3, initialElo: 1500, finalElo: 1486 }), 'Me');
    assert.deepEqual([l.outcome, l.my, l.their, l.elo], ['lost', 1, 3, { from: 1500, to: 1486 }]);
});

test('you as player 2: the scores flip to your side', () => {
    const r = R.parseEndgame(eg({ playerId: 1, scores: [1, 2] }), 'Me');
    assert.deepEqual([r.my, r.their, r.outcome], [2, 1, 'won']);
});

test('a ranked set nobody finished, and a casual one', () => {
    const q = R.parseEndgame(eg({ scores: [1, 0], ranked: 3 }), 'Me');
    assert.equal(q.quit, true);
    const c = R.parseEndgame(eg({ ranked: 0, scores: [0, 0] }), 'Me');
    assert.deepEqual([c.ranked, c.ft, c.outcome, c.quit], [false, 0, '', false]);
    const nr = R.parseEndgame(eg({ replayUrl: '' }), 'Me');
    assert.deepEqual([nr.replay, nr.rom], ['', '']);
    assert.equal(R.parseEndgame(eg({ opponent: null }), 'Me'), null);
});

test('without the data: the message text, both kinds', () => {
    const r = R.parseEndgame({ text: '  Ranked match result - Zig 2 FT2 0 Me \n', href: URL }, 'Me');
    assert.deepEqual([r.me, r.opp, r.my, r.their, r.outcome, r.ft, r.rom], ['Me', 'Zig', 0, 2, 'lost', 2, 'sfiii3nr1']);
    const s = R.parseEndgame({ text: 'Ranked match result - Fightcade_Moderator 2 FT2 0 zigmanana', href: URL }, 'Fightcade_Moderator');
    assert.deepEqual([s.me, s.opp, s.outcome], ['Fightcade_Moderator', 'zigmanana', 'won']);
    const c = R.parseEndgame({ text: 'You have just finished a game vs Deno_411', href: '' }, 'Me');
    assert.deepEqual([c.opp, c.ranked, c.outcome, c.replay], ['Deno_411', false, '', '']);
    assert.equal(R.parseEndgame({ text: 'something else' }, 'Me'), null);
    assert.equal(R.parseEndgame({ text: 'You have just finished a game vs Deno', href: 'javascript:alert(1)' }, 'Me').replay, '', 'only real links');
});

test('the set Fightcord recorded: the same match id first, else the newest vs them in 15 minutes', () => {
    const now = 10 * 60000 * 10;
    const sets = [{ opp: 'zig', quark: 'old', at: now - 5 * 60000, myChar: 'Ken' }, { opp: 'Zig', quark: '1793300094615-8556', at: now - 20 * 60000, myChar: 'Ryu' }, { opp: 'other', at: now }];
    const r = R.parseEndgame(eg({}), 'Me');
    assert.equal(R.setFor(sets, r, now).myChar, 'Ryu');
    assert.equal(R.setFor(sets, Object.assign({}, r, { quark: 'x' }), now).myChar, 'Ken');
    assert.equal(R.setFor(sets, Object.assign({}, r, { quark: 'x' }), now + 30 * 60000), null);
});
