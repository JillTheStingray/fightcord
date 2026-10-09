// node --test tests/      music visualizer helpers (backgrounds.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const bg = require('../backgrounds.js');

test('visualizer: log-spaced bands from a byte spectrum, 0..1', () => {
    const flat = new Uint8Array(256).fill(255);
    const b = bg.bands(flat, 32);
    assert.equal(b.length, 32);
    b.forEach(v => assert.equal(v, 1));
    assert.deepEqual(bg.bands(new Uint8Array(256), 8), [0, 0, 0, 0, 0, 0, 0, 0]);
    // bass only: the first bands light up, the last stay dark
    const bass = new Uint8Array(256);
    for (let i = 0; i < 6; i++) bass[i] = 200;
    const bb = bg.bands(bass, 32);
    assert.ok(bb[0] > 0.7 && bb[31] === 0);
    // the top quarter (above ~16 kHz) is ignored
    const hiss = new Uint8Array(256);
    for (let i = 200; i < 256; i++) hiss[i] = 255;
    assert.ok(bg.bands(hiss, 32).every(v => v === 0));
});

test('visualizer: the decibel window follows the music volume', () => {
    const full = bg.dbRange(1), quiet = bg.dbRange(0.25), silent = bg.dbRange(0);
    assert.equal(full.max, -6);
    assert.equal(full.max - full.min, 70);
    assert.ok(Math.abs(quiet.max - (-6 - 12.04)) < 0.01);        // a quarter = 12 dB lower
    assert.equal(silent.max, bg.dbRange(0.05).max);               // floor, no -Infinity
});

test('visualizer: automatic gain fills the picture for quiet and loud tracks alike', () => {
    const quiet = {}, loud = {};
    let q, l;
    for (let i = 0; i < 50; i++) { q = bg.agc(quiet, [0.3, 0.15, 0.05]); l = bg.agc(loud, [0.9, 0.45, 0.15]); }
    assert.ok(Math.abs(q[0] - l[0]) < 0.01 && q[0] > 0.85 && q[0] <= 1);
    assert.ok(q[1] < q[0] * 0.5);                                   // contrast kept
    const st = {}; bg.agc(st, [0.8]);
    for (let i = 0; i < 600; i++) bg.agc(st, [0.1]);                 // a quiet passage: the reference eases down
    assert.ok(st.ref < 0.8 && st.ref >= 0.2);
    assert.deepEqual(bg.agc({}, [0, 0]), [0, 0]);
});

test('visualizer: bass sits lower when steady and jumps on a hit', () => {
    const st = {};
    let v;
    for (let i = 0; i < 120; i++) v = bg.bassLift(st, [0.8, 0.5], 1);
    assert.ok(v[0] < 0.5, 'a steady bass line settles low: ' + v[0]);
    assert.equal(v[1], 0.5);                                          // above the bass: untouched
    const kick = bg.bassLift(st, [1, 0.5], 1);
    assert.ok(kick[0] > 0.95, 'a kick jumps: ' + kick[0]);
});

test('visualizer: a beat is bass well above its running average, not every frame', () => {
    const st = {};
    for (let i = 0; i < 30; i++) assert.equal(bg.beat(st, 0.2), false);   // steady, quiet
    assert.equal(bg.beat(st, 0.8), true);                                 // a kick
    assert.equal(bg.beat(st, 0.85), false);                               // too soon after
    for (let i = 0; i < 10; i++) bg.beat(st, 0.2);
    assert.equal(bg.beat(st, 0.8), true);
    assert.ok(bg.LOOKS.bars && bg.LOOKS.wave && bg.LOOKS.pulse);
});
