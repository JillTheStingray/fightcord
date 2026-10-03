'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../goals.js');

// 2026-10-07 is a Wednesday
const at = (day, hour, min) => new Date(2026, 9, 7 + day, hour, min || 0).getTime();
const now = at(0, 22);
const won = (o) => Object.assign({ result: 'won', at: at(0, 20) }, o);
const lost = (o) => Object.assign({ result: 'lost', at: at(0, 20) }, o);

test('periods: days start at 5 AM, weeks on Monday, sessions can be cleared', () => {
    assert.equal(G.periodStart('day', at(0, 22)), at(0, 5));
    assert.equal(G.periodStart('day', at(1, 2)), at(0, 5), '2 AM still belongs to the night before');
    assert.equal(G.periodStart('week', at(0, 22)), at(-2, 5), 'Monday 5 AM');
    assert.equal(G.periodStart('session', at(0, 22), at(0, 21)), at(0, 21));
});

test('win N sets, today only', () => {
    const sets = [won(), won(), lost(), won({ at: at(-1, 20) })];
    const r = G.evaluate({ type: 'wins', target: 3, scope: 'day' }, sets, now);
    assert.equal(r.value, 2);
    assert.equal(r.done, false);
    assert.ok(Math.abs(r.frac - 2 / 3) < 1e-9);
    assert.equal(G.evaluate({ type: 'wins', target: 3, scope: 'week' }, sets, now).done, true);
});

test('beat N different players ranked X or higher', () => {
    const sets = [won({ opp: 'A1', oppRank: 5 }), won({ opp: 'a1', oppRank: 5 }), won({ opp: 'S1', oppRank: 6 }), won({ opp: 'B1', oppRank: 4 }), lost({ opp: 'S2', oppRank: 6 })];
    const r = G.evaluate({ type: 'beatRank', target: 2, scope: 'day', rank: 'A' }, sets, now);
    assert.equal(r.value, 2, 'A1 once (any case) + S1');
    assert.equal(r.done, true);
});

test('minutes, sets, streak', () => {
    const sets = [won({ durSec: 600 }), lost({ durSec: 900, at: at(0, 20, 30) }), won({ durSec: 1200, at: at(0, 21) }), won({ at: at(0, 21, 30) })];
    assert.equal(G.evaluate({ type: 'minutes', target: 30, scope: 'day' }, sets, now).value, 45);
    assert.equal(G.evaluate({ type: 'sets', target: 4, scope: 'day' }, sets, now).done, true);
    assert.equal(G.evaluate({ type: 'streak', target: 2, scope: 'day' }, sets, now).value, 2);
});

test('win rate goal needs both the sets and the rate', () => {
    const three = [won(), won(), lost()];
    let r = G.evaluate({ type: 'winrate', target: 4, scope: 'day', rate: 60 }, three, now);
    assert.equal(r.done, false, 'only 3 of 4 sets');
    r = G.evaluate({ type: 'winrate', target: 3, scope: 'day', rate: 60 }, three, now);
    assert.equal(r.done, true, '67% over 3');
    r = G.evaluate({ type: 'winrate', target: 3, scope: 'day', rate: 70 }, three, now);
    assert.equal(r.done, false);
    assert.ok(r.frac < 1);
});
