// node --test tests/      matchup notes per character (notes.js) and when they show up
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../fightcord-core.js');
const { data, fmt } = core._test;
global.window = global.window || {};          // notes.js marks itself loaded on window
const notes = require('../notes.js');

function fakeFc(sets) {
    const stored = { people: {}, tags: [], matchups: {} };
    const toasts = [], handlers = {};
    const fc = {
        t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)),
        log() {}, own() {}, cmd() {}, emit() {}, on: (ev, fn) => { handlers[ev] = fn; },
        config: () => ({ data: stored, save() {} }),
        settings: { block() {}, refresh() {} },
        ui: { style() {}, toast: (title, o) => toasts.push({ title, o }) },
        fmt, data,
        history: { all: () => sets }
    };
    fc.t.plural = (n, a, b) => (n === 1 ? a : b);
    return { fc, stored, toasts, handlers };
}

const SETS = [
    { rom: 'sfiii3nr1', oppChar: 'Yang', result: 'won' },
    { rom: 'sfiii3nr1', oppChar: 'Yang', result: 'lost' },
    { rom: 'sfiii3nr1', oppChar: 'yang', result: 'won' },
    { rom: 'sfiii3nr1', oppChar: 'Ken', result: 'lost' },
    { rom: 'kof98', oppChar: 'Yang', result: 'lost' }            // another game's Yang doesn't count
];

test('matchups: one note per game + character, your record from the sets', () => {
    const f = fakeFc(SETS);
    const api = notes.start(f.fc);
    assert.equal(api.matchup('sfiii3nr1', 'Yang'), null);
    api.setMatchup('sfiii3nr1', 'Yang', '  parry the dive kick  ');
    assert.equal(api.matchup('sfiii3nr1', 'yang').text, 'parry the dive kick');
    assert.equal(api.matchup('kof98', 'Yang'), null);
    const r = api.matchupRecord('sfiii3nr1', 'Yang');
    assert.deepEqual([r.n, r.w, r.l], [3, 2, 1]);
    api.setMatchup('sfiii3nr1', 'Yang', '');                       // empty removes it
    assert.equal(api.matchup('sfiii3nr1', 'Yang'), null);
});

test('matchups: the card when they pick a character shows once, and only with a note or 3+ sets', () => {
    const f = fakeFc(SETS);
    const api = notes.start(f.fc);
    f.handlers['match:character']({ quark: 'q1', rom: 'sfiii3nr1', char: 'Yang' });
    assert.equal(f.toasts.length, 1);                              // 3 sets vs Yang
    assert.match(f.toasts[0].title, /vs Yang · 2–1/);
    f.handlers['match:character']({ quark: 'q1', rom: 'sfiii3nr1', char: 'Yang' });
    assert.equal(f.toasts.length, 1);                              // same set: not again
    f.handlers['match:character']({ quark: 'q1', rom: 'sfiii3nr1', char: 'Ken' });
    assert.equal(f.toasts.length, 1);                              // 1 set, no note: quiet
    api.setMatchup('sfiii3nr1', 'Ken', 'block low');
    f.handlers['match:character']({ quark: 'q2', rom: 'sfiii3nr1', char: 'Ken' });
    assert.equal(f.toasts.length, 2);
    assert.equal(f.toasts[1].o.sub, '“block low”');
});
