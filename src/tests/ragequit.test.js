// node --test tests/      3.8.1: the Ragequitter tag (notes.js) Fightcord puts on and takes off by itself
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../fightcord-core.js');
const { data, fmt } = core._test;
global.window = global.window || {};
const notes = require('../notes.js');

function fakeFc(stored) {
    const fc = {
        t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)),
        log() {}, own() {}, cmd() {}, emit() {}, on() {},
        config: () => ({ data: stored, save() {} }),
        settings: { block() {}, refresh() {} },
        ui: { style() {}, toast() {}, ic: () => '' },
        fmt, data, history: { all: () => [] }
    };
    fc.t.plural = (n, a, b, v) => fc.t(n === 1 ? a : b, Object.assign({ n }, v));
    return fc;
}
const fresh = (more) => notes.start(fakeFc(Object.assign({ people: {}, tags: [], matchups: {} }, more)));
const tagged = (api, n) => api.isRagequitter(n);

test('the rule: 2+ of 4+ recent ranked sets unfinished (1 in 5 or more), or 2 left on you while behind', () => {
    assert.equal(notes.rqVerdict({ n: 2, total: 10, you: 0 }), true);
    assert.equal(notes.rqVerdict({ n: 1, total: 4, you: 0 }), false, 'one could be a disconnect');
    assert.equal(notes.rqVerdict({ n: 2, total: 3, you: 0 }), false, 'too few sets to go on');
    assert.equal(notes.rqVerdict({ n: 2, total: 20, you: 0 }), false, '1 in 10');
    assert.equal(notes.rqVerdict({ n: 0, total: 0, you: 2 }), true);
    assert.equal(notes.rqVerdict({ n: 0, total: 0, you: 1 }), false);
});

test('tagged from their recent sets; untagged when they clean up; a clean player leaves no entry', () => {
    const api = fresh();
    assert.ok(api.tags().some(t => t.id === 'rq'), 'the tag is in the list');
    api.quitEvidence('Clean', { scout: { ranked: 12, unfinished: 0, behind: 0 } });
    assert.equal(api._config.people.clean, undefined);
    api.quitEvidence('Salty', { scout: { ranked: 10, unfinished: 3, behind: 2 } });
    assert.ok(tagged(api, 'salty'));
    assert.match(api.chips('Salty'), /left 3 of 10 recent ranked sets unfinished \(2 while behind\)/);
    assert.match(api.dots('Salty'), /Ragequitter/);
    api.quitEvidence('Salty', { scout: { ranked: 12, unfinished: 1, behind: 0 } });
    assert.ok(!tagged(api, 'Salty'), 'it put the tag on: it takes it off');
});

test('sets they left on you count once each; your own choice sticks', () => {
    const api = fresh();
    api.quitEvidence('Rager', { onYou: 'replay1' });
    api.quitEvidence('Rager', { onYou: 'replay1' });
    assert.ok(!tagged(api, 'Rager'), 'the same set twice is one');
    api.quitEvidence('Rager', { onYou: 'replay2' });
    assert.ok(tagged(api, 'Rager'));
    assert.match(api.chips('Rager'), /left 2 ranked sets with you while behind/);
    // you take it off: it stays off, whatever comes next
    api.toggleTag('Rager', 'rq');
    api.quitEvidence('Rager', { onYou: 'replay3' });
    assert.ok(!tagged(api, 'Rager'));
    // put on by you: never taken off by Fightcord
    api.toggleTag('Mine', 'rq');
    api.quitEvidence('Mine', { scout: { ranked: 20, unfinished: 0, behind: 0 } });
    assert.ok(tagged(api, 'Mine'));
});

test('switched off, or the tag deleted: nothing is tagged; an existing tag list gets it once', () => {
    const off = fresh({ autoRq: false });
    off.quitEvidence('Salty', { scout: { ranked: 10, unfinished: 5, behind: 5 } });
    assert.ok(!tagged(off, 'Salty'));
    const tags = [{ id: 'spar', label: 'Good sparring', color: '#23a55a' }];
    const old = fresh({ tags });
    assert.deepEqual(old.tags().map(t => t.id), ['spar', 'rq'], 'added to your own list');
    const gone = fresh({ tags: [{ id: 'spar', label: 'Good sparring', color: '#23a55a' }], rqTag: true });
    gone.quitEvidence('Salty', { scout: { ranked: 10, unfinished: 5, behind: 5 } });
    assert.ok(!tagged(gone, 'Salty'), 'you deleted the tag: it stays deleted');
});
