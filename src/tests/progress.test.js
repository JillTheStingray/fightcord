'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pr = require('../progress.js');

const at = (day, hour) => new Date(2026, 9, 1 + day, hour || 12).getTime();
const pt = (o) => Object.assign({ rom: 'sfiii3nr1', rank: 4, elo: 1450, matches: 100 }, o);

test('one point per game per day: a newer one that day replaces it', () => {
    let r = pr.mergePoint([], pt({ at: at(0, 10) }));
    r = pr.mergePoint(r.points, pt({ at: at(0, 20), elo: 1460 }));
    assert.equal(r.points.length, 1);
    assert.equal(r.points[0].elo, 1460);
    assert.equal(r.changed, null);
    r = pr.mergePoint(r.points, pt({ at: at(1, 10), elo: 1470 }));
    assert.equal(r.points.length, 2);
});

test('a rank change is reported and always gets its own point', () => {
    let r = pr.mergePoint([], pt({ at: at(0, 10), rank: 4 }));
    r = pr.mergePoint(r.points, pt({ at: at(0, 11), rank: 5 }));
    assert.deepEqual(r.changed, { from: 4, to: 5 });
    assert.equal(r.points.length, 2);
});

test('games are kept apart', () => {
    let r = pr.mergePoint([], pt({ at: at(0), rom: 'a', rank: 3 }));
    r = pr.mergePoint(r.points, pt({ at: at(0), rom: 'b', rank: 6 }));
    assert.equal(r.points.length, 2);
    assert.equal(r.changed, null, 'a different game is not a rank change');
});

test('summary: latest, best ever, ELO change, best leaderboard spot', () => {
    const ps = [pt({ at: at(0), rank: 4, elo: 1400, matches: 100, pos: 250 }), pt({ at: at(1), rank: 5, elo: 1650, matches: 140, pos: 120 }),
        pt({ at: at(2), rank: 5, elo: 1600, matches: 160, pos: 150 }), pt({ at: at(2), rom: 'other', rank: 6 })];
    const s = pr.summarize(ps, 'sfiii3nr1');
    assert.equal(s.ps.length, 3);
    assert.equal(s.last.elo, 1600);
    assert.equal(s.best.elo, 1650);
    assert.equal(s.eloChange, 200);
    assert.equal(s.bestPos.pos, 120);
    assert.equal(s.matchesSince, 60);
    assert.equal(pr.summarize(ps, 'nothing'), null);
});
