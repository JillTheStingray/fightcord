// node --test tests/      unfinished ranked sets (scout.js) and event reminders (events.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const scout = require('../scout.js');
const events = require('../events.js');

const row = (ft, theirs, opp) => ({ ranked: ft, date: Date.now(), players: [{ name: 'Them', score: theirs }, { name: 'Opp', score: opp }] });

test('unfinished sets: FT not reached, who was behind, casual and complete sets ignored', () => {
    const q = scout.summariseQuarks([
        row(3, 1, 0),      // unfinished, ahead
        row(3, 0, 1),      // unfinished, behind
        row(3, 1, 1),      // unfinished, level
        row(0, 1, 0),      // casual: no FT, not counted
        row(3, 3, 1),      // complete
        row(5, 2, 4),      // unfinished, behind
        row(10, 10, 9)     // complete
    ], 'Them', 'me').quits;
    assert.deepEqual(q, { ranked: 6, unfinished: 4, behind: 2 });
});

test('unfinished sets: the warning needs enough sets and at least two', () => {
    assert.equal(scout.quitsNote({ ranked: 3, unfinished: 3, behind: 3 }), '', 'too few sets');
    assert.equal(scout.quitsNote({ ranked: 12, unfinished: 1, behind: 1 }), '', 'once is nothing');
    assert.equal(scout.quitsNote({ ranked: 12, unfinished: 3, behind: 2 }), 'Left 3 of 12 ranked sets unfinished (2 while behind)');
    assert.equal(scout.quitsNote({ ranked: 12, unfinished: 2, behind: 0 }), 'Left 2 of 12 ranked sets unfinished');
});

test('events: key, normalise (string dates too), mine', () => {
    const ev = events.normalise({ name: 'SSEU #207', date: '2026-10-04T19:00:00Z', region: 'EU', gameid: 'fc1_sfiii3nr1', channel: { name: 'SF3' } });
    assert.equal(ev.date, Date.parse('2026-10-04T19:00:00Z'));
    assert.equal(ev.key, 'SSEU #207|' + ev.date + '|SF3');
    assert.equal(events.normalise({ name: 'x', date: 'not a date' }), null);
    assert.equal(events.isMine(ev, new Set(['sfiii3nr1']), new Set()), true, 'fc1_ prefix ignored');
    assert.equal(events.isMine(ev, new Set(), new Set(['SF3'])), true, 'joined channel');
    assert.equal(events.isMine(ev, new Set(['kof98']), new Set()), false);
});

test('events: reminder stages fire once, a missed early one is skipped', () => {
    const t = 1_800_000_000_000, MIN = 60000;
    const ev = { date: t };
    assert.deepEqual(events.dueStages(ev, t - 45 * MIN, 30, []), []);
    assert.deepEqual(events.dueStages(ev, t - 29 * MIN, 30, []), ['soon']);
    assert.deepEqual(events.dueStages(ev, t - 29 * MIN, 30, ['soon']), []);
    assert.deepEqual(events.dueStages(ev, t + 1 * MIN, 30, ['soon']), ['start']);
    assert.deepEqual(events.dueStages(ev, t + 1 * MIN, 30, []), ['start'], 'opened Fightcade late: just "starting"');
    assert.deepEqual(events.dueStages(ev, t + 31 * MIN, 30, []), [], 'long started');
    assert.deepEqual(events.dueStages(ev, t + 5 * MIN, 30, ['soon', 'start']), []);
});
