// node --test tests/      3.9.1: players' mains (notes.js) -- tagged by you, else from your sets with them
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../fightcord-core.js');
const { data, fmt } = core._test;
global.window = global.window || {};
const notes = require('../notes.js');
const mg = require('../matchup-guide.js')._test;

const S3 = 'sfiii3nr1';
function fakeFc(stored, sets) {
    const guide = { gameOf: mg.gameOf, find: mg.find, charsOf: mg.charsOf, faceHtml: mg.faceHtml };
    const fc = {
        t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)),
        log() {}, own() {}, cmd() {}, emit() {}, on() {},
        config: () => ({ data: stored, save() {} }),
        settings: { block() {}, refresh() {} },
        ui: { style() {}, toast() {}, ic: () => '' },
        modules: { get: (id) => (id === 'matchup-guide' ? guide : null) },
        app: { activeGameId: () => S3, isMe: (n) => n === 'Me' },
        fmt, data,
        history: { all: () => sets || [], vs: (n) => (sets || []).filter(s => s.opp.toLowerCase() === String(n).toLowerCase()) }
    };
    fc.t.plural = (n, a, b, v) => fc.t(n === 1 ? a : b, Object.assign({ n }, v));
    return fc;
}
const fresh = (sets, more) => notes.start(fakeFc(Object.assign({ people: {}, tags: [], matchups: {} }, more), sets));
const set = (opp, oppChar, rom) => ({ opp, oppChar, rom: rom || S3 });

test('from your sets: most-picked first, the emulator\'s spellings merged, other games and pockets left out', () => {
    const sets = [set('Kenji', 'Ken'), set('Kenji', 'Ken'), set('Kenji', 'Remya'), set('Kenji', 'Remy'),
        set('Kenji', 'Ken'), set('Kenji', 'Chun-Li', 'ssf2t'), set('Kenji', 'Ken'), set('Kenji', 'Ken'),
        set('Kenji', 'Ken'), set('Kenji', 'Ken'), set('Kenji', 'Akuma')];
    const keyOf = (rom) => { const g = mg.gameOf(rom); return g ? g.id : rom; };
    const canon = (rom, ch) => { const e = mg.find(rom, ch); return e ? e.name : ch; };
    const m = notes.mainsFrom(sets, '3s', keyOf, canon);
    assert.equal(m.total, 10, 'the ST set is another game');
    assert.deepEqual(m.chars, ['Ken', 'Remy'], 'Akuma once in 10 is a pocket pick');
    assert.equal(m.n.Remy, 2, '"Remya" is Remy');
    assert.deepEqual(notes.mainsFrom([{ opp: 'x', oppChar: 'Ken' }], '3s', keyOf, canon).chars, [], 'a set without a game counts for none');
});

test('tagged mains win over the picks, per game, up to 3, and an empty list clears the entry', () => {
    const api = fresh([set('Kenji', 'Ken'), set('Kenji', 'Ken')]);
    assert.deepEqual(api.mains('Kenji').chars, ['Ken']);
    assert.equal(api.mains('Kenji').auto, true);
    api.setMains('Kenji', S3, ['Yun', 'Chun-Li', 'Makoto', 'Urien']);
    const m = api.mains('Kenji');
    assert.equal(m.auto, false);
    assert.deepEqual(m.chars, ['Yun', 'Chun-Li', 'Makoto']);
    assert.equal(api.mains('Kenji', 'sfiii3n').auto, false, 'every 3rd Strike rom is the same game');
    assert.equal(api.mains('Kenji', 'ssf2t'), null, 'none in ST');
    api.setMains('Kenji', S3, []);
    assert.equal(api._config.people.kenji, undefined, 'nothing left: no entry');
    assert.equal(api.mains('Kenji').auto, true, 'back to the picks');
    assert.equal(fresh([set('Me', 'Ken')]).mains('Me'), null, 'not for yourself');
});

test('on the cards: faces next to the tags, and the switches turn them off', () => {
    const api = fresh([set('Kenji', 'Ken')], { tags: [{ id: 'spar', label: 'Good sparring', color: '#23a55a' }], people: { kenji: { name: 'Kenji', tags: ['spar'] } } });
    const html = api.chips('Kenji');
    assert.match(html, /^<div class="ntChips"><span class="ntMain auto"[^]*fc-mu-face[^]*Ken<\/span><span class="ntChip"/, 'their mains come before your tags');
    assert.match(api.chips('Stranger'), /^$/);
    api._config.autoMains = false;
    assert.doesNotMatch(api.chips('Kenji'), /ntMain/);
    api._config.autoMains = true;
    api._config.showMains = false;
    assert.doesNotMatch(api.chips('Kenji'), /ntMain/);
    api._config.showMains = true;
    assert.match(fresh([set('Solo', 'Ken')]).chips('Solo'), /ntMain/, 'mains alone are enough for a row');
});

test('yours: the ones you picked, else the ones you play most; theirs: your tag, then what they share, then your sets', () => {
    const mine = [set('Rival', 'Ken'), set('Rival', 'Ken')].map(s => Object.assign(s, { myChar: 'Yun' }));
    const shared = { kenji: { '3s': ['Remya'] } };
    let picked = {};
    const pres = { myMainsSet: () => picked, mainsOf: (n) => shared[String(n).toLowerCase()] || {} };
    const f = fakeFc({ people: {}, tags: [], matchups: {} }, mine.concat([set('Kenji', 'Ken')]));
    const guideGet = f.modules.get;
    f.modules.get = (id) => (id === 'presence' ? pres : guideGet(id));
    const api = notes.start(f);
    assert.deepEqual([api.mains('Me').chars, api.mains('Me').auto, api.mains('Me').own], [['Yun'], true, true]);
    picked = { '3s': ['Makoto'] };
    assert.deepEqual([api.mains('Me').chars, api.mains('Me').auto], [['Makoto'], false]);
    assert.match(api.chips('Me'), /Makoto: your main/);
    assert.deepEqual([api.mains('Kenji').chars, api.mains('Kenji').shared], [['Remy'], true], 'shared, in the guide’s spelling');
    assert.equal(api.mains('Rival').auto, true, 'nothing shared: your sets');
    api.setMains('Kenji', S3, ['Q']);
    assert.deepEqual(api.mains('Kenji').chars, ['Q'], 'your tag wins');
    // what you share without picking: games with 5+ sets
    assert.deepEqual(api.myAutoMains(), {});
    const many = Array.from({ length: 5 }, () => Object.assign(set('X', 'Ken'), { myChar: 'Dudley' }));
    assert.deepEqual(notes.start(fakeFc({ people: {}, tags: [], matchups: {} }, many)).myAutoMains(), { '3s': ['Dudley'] });
});
