// node --test tests/      translations: fc.t, and the dictionaries stay complete
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const core = require('../fightcord-core.js');
const T = core._test;
const check = require('../tools/i18n-check.js');

test('fc.t: English by default, placeholders, fallback, plural', () => {
    T.setLang('en');
    assert.equal(T.tr('Win {n} sets', { n: 5 }), 'Win 5 sets');
    assert.equal(T.tr('{a} and {b}', { a: 'x' }), 'x and {b}', 'a missing var stays visible');
    T.tr.add('pt', { 'Win {n} sets': 'Vencer {n} sets' });
    T.setLang('pt');
    assert.equal(T.tr('Win {n} sets', { n: 3 }), 'Vencer 3 sets');
    assert.equal(T.tr('Not translated yet'), 'Not translated yet', 'falls back to English');
    assert.equal(T.tr.plural(1, '{n} set', '{n} sets'), '1 set');
    assert.equal(T.tr.locale(), 'pt-BR');
    T.setLang('xx');
    assert.equal(T.tr.lang(), 'en', 'unknown language -> English');
});

test('pickLang: auto follows the browser language', () => {
    assert.equal(T.pickLang('es'), 'es');
    assert.equal(T.pickLang('nope'), T.pickLang('auto'));
});

test('dictionaries: every key translated, placeholders intact', () => {
    const r = check.report();
    assert.ok(r.keys > 500, 'found the keys (' + r.keys + ')');
    for (const lang of ['pt', 'es']) {
        assert.deepEqual(r.langs[lang].missing, [], lang + ' is missing translations - run: node tools/i18n-check.js --missing ' + lang);
        assert.deepEqual(r.langs[lang].broken, [], lang + ' has broken {placeholders}');
    }
});

test('dictionaries load as no-op modules (an old loader may start them)', () => {
    for (const lang of ['pt', 'es']) {
        const m = require(path.join(__dirname, '..', 'i18n-' + lang + '.js'));
        assert.equal(m.id, 'i18n-' + lang);
        assert.equal(typeof m.start, 'function');
        assert.ok(Object.keys(m.strings).length > 500);
    }
});
