'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const an = require('../analytics.js');

// a set at a given day/hour (2026-10-05 is a Monday)
const at = (day, hour, min) => new Date(2026, 9, 5 + day, hour, min || 0).getTime();
const set = (o) => Object.assign({ result: 'won' }, o);

test('only won / lost sets count', () => {
    const a = an.analyze([set({ at: at(0, 20) }), set({ at: at(0, 21), result: 'lost' }), set({ at: at(0, 22), result: 'draw' }), set({ at: at(0, 23), result: null })]);
    assert.equal(a.total.n, 2);
    assert.equal(a.total.rate, 0.5);
});

test('opponent rank and rank gap buckets', () => {
    const a = an.analyze([
        set({ at: at(0, 20), oppRank: 6, myRank: 4 }),                    // vs S, gap +2
        set({ at: at(0, 21), oppRank: 4, myRank: 4, result: 'lost' }),    // vs B, gap 0
        set({ at: at(0, 22) })                                            // unknown rank
    ]);
    assert.equal(a.byOppRank.S.w, 1);
    assert.equal(a.byOppRank.B.l, 1);
    assert.equal(a.byOppRank['?'].n, 1);
    assert.equal(a.byGap[2].n, 1);
    assert.equal(a.byGap[0].n, 1);
    assert.equal(a.withRanks, 2);
});

test('ping buckets, hour heatmap (Monday first), FT', () => {
    assert.equal(an.pingBucket(45), '<60');
    assert.equal(an.pingBucket(60), '60–100');
    assert.equal(an.pingBucket(199), '150+');
    assert.equal(an.pingBucket(0), '');
    const a = an.analyze([set({ at: at(0, 20), ping: 80, ft: 3 }), set({ at: at(6, 9), ping: 200, ft: 0, result: 'lost' })]);
    assert.equal(a.byPing['60–100'].w, 1);
    assert.equal(a.byPing['150+'].l, 1);
    assert.equal(a.heat[0][20].n, 1, 'Monday 20:00');
    assert.equal(a.heat[6][9].n, 1, 'Sunday 09:00');
    assert.equal(a.byFt.FT3.n, 1);
    assert.equal(a.byFt.casual.n, 1);
});

test('session position: a session runs 5 AM to 5 AM', () => {
    const a = an.analyze([
        set({ at: at(0, 22) }), set({ at: at(0, 23) }), set({ at: at(1, 2) }),   // one session (02:00 is still the night before)
        set({ at: at(1, 20) })                                                       // a new one
    ]);
    assert.equal(a.byPos.first.n, 2);
    assert.equal(a.byPos.early.n, 2);
});

test('tilt: sets right after two losses in a row, reset per session', () => {
    const L = 'lost', W = 'won';
    const seq = [L, L, W, L, L, L, W];          // after-2 sets: index 2 (W), 5 (L), 6 (W)
    const a = an.analyze(seq.map((r, i) => set({ at: at(0, 12, i), result: r })));
    assert.equal(a.tilt.after2.n, 3);
    assert.equal(a.tilt.after2.w, 2);
    // a new session starts fresh
    const b = an.analyze([set({ at: at(0, 20), result: L }), set({ at: at(0, 21), result: L }), set({ at: at(1, 20) })]);
    assert.equal(b.tilt.after2.n, 0);
});

test('insights: tilt and warm-up show up when the numbers say so', () => {
    const sets = [];
    // 8 sessions: four losses to start (so 2 of the 3 sets after two losses are lost too), then five wins
    for (let d = 0; d < 8; d++) {
        ['lost', 'lost', 'lost', 'lost', 'won', 'won', 'won', 'won', 'won'].forEach((r, i) => sets.push(set({ at: at(d, 12 + i), result: r })));
    }
    const a = an.analyze(sets);
    const kinds = a.insights.map(i => i.kind);
    assert.ok(kinds.includes('tilt'), kinds.join());
    assert.ok(kinds.includes('warmup'), kinds.join());
    assert.ok(a.insights[0].score >= a.insights[a.insights.length - 1].score, 'strongest first');
});

test('no insights from too few sets', () => {
    assert.deepEqual(an.analyze([set({ at: at(0, 1) })]).insights, []);
});
