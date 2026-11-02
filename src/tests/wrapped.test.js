// node --test tests/      3.9: Fightcord Wrapped -- a month of sets -> the story's numbers (wrapped.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const W = require('../wrapped.js');

// a set on 2026-10-<day> at <hour>:00, local time
const at = (day, hour) => new Date(2026, 9, day, hour || 21, 0, 0).getTime();
const set = (day, hour, opp, result, more) => Object.assign({ at: at(day, hour), opp, result, rom: 'sfiii3nr1', channel: 'Street Fighter III 3rd Strike (Japan 990512)', durSec: 600 }, more || {});

test('a month: record, hours, nights, rival, nemesis, most beaten, best night, streak, comebacks', () => {
    const lostFirst = [{ w: 0 }, { w: 1 }, { w: 1 }];
    const sets = [
        set(3, 21, 'Rival', 'won', { myChar: 'Ken', oppChar: 'Chun-Li', games: lostFirst }),
        set(3, 22, 'Rival', 'lost', { myChar: 'Ken', oppChar: 'Chun-Li' }),
        set(4, 2, 'Rival', 'won', { myChar: 'Ken', oppChar: 'Yun' }),           // 2 AM: still the night of the 3rd
        set(10, 21, 'Boss', 'lost', { myChar: 'Ken' }),
        set(10, 22, 'Boss', 'lost', { myChar: 'Ryu' }),
        set(11, 21, 'Boss', 'lost'),
        set(12, 21, 'Easy', 'won'), set(12, 21, 'Easy', 'won'), set(12, 22, 'Rival', 'won'), set(12, 23, 'Rival', 'won'),
        set(1, 21, 'Easy', 'won', { at: new Date(2026, 8, 30, 21).getTime() })        // September: not in it
    ];
    const pts = [{ rom: 'sfiii3nr1', at: at(2), elo: 1500, rank: 3 }, { rom: 'sfiii3nr1', at: at(20), elo: 1580, rank: 4 }, { rom: 'sfiii3nr1', at: at(15), elo: 1610, rank: 4 }];
    const [from, to] = W.range(2026, 9);
    const w = W.wrapUp(sets, pts, from, to);
    assert.equal(w.sets, 10);
    assert.deepEqual([w.won, w.lost, w.draw], [6, 4, 0]);
    assert.equal(w.hours, 1.7);
    assert.equal(w.nights, 4, 'the 2 AM set counts as the night before (the 3rd, 10th, 11th, 12th)');
    assert.equal(w.rival.name, 'Rival');
    assert.deepEqual([w.rival.n, w.rival.w, w.rival.l], [5, 4, 1]);
    assert.equal(w.nemesis.name, 'Boss');
    assert.equal(w.victim.name, 'Easy');
    assert.equal(w.best.w, 4, 'the 12th');
    assert.equal(w.streak, 4);
    assert.equal(w.comebacks, 1);
    assert.equal(w.hour, 21);
    assert.deepEqual(w.main, { char: 'Ken', n: 4 });
    assert.deepEqual(w.faced, { char: 'Chun-Li', n: 2 });
    assert.equal(w.game, 'Street Fighter III 3rd Strike');
    assert.deepEqual(w.climb, { rom: 'sfiii3nr1', from: 1500, to: 1580, peak: 1610, rankFrom: 3, rankTo: 4 });
});

test('fewer than 5 sets: no Wrapped; months and years with enough, newest first', () => {
    const [from, to] = W.range(2026, 9);
    assert.equal(W.wrapUp([set(1, 21, 'A', 'won'), set(2, 21, 'A', 'won')], [], from, to), null);
    const many = (y, m, n) => Array.from({ length: n }, (_, i) => ({ at: new Date(y, m, 1 + i, 21).getTime(), opp: 'X', result: 'won' }));
    const list = W.periods(many(2026, 8, 6).concat(many(2026, 9, 3), many(2025, 11, 5)), new Date(2026, 10, 1).getTime());
    assert.deepEqual(list, [{ y: 2026, m: null }, { y: 2026, m: 8 }, { y: 2025, m: null }, { y: 2025, m: 11 }]);
});

test('month and year ranges are local time, the end left out', () => {
    const [a, b] = W.range(2026, 11);
    assert.equal(new Date(a).getMonth(), 11);
    assert.equal(new Date(b).getFullYear(), 2027);
    assert.equal(new Date(b).getMonth(), 0);
    const [ya, yb] = W.range(2026, null);
    assert.deepEqual([new Date(ya).getMonth(), new Date(yb).getFullYear()], [0, 2027]);
});
