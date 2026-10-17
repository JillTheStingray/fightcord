// node --test tests/      Fightcord rank icons (rank-icons.js): all seven there, and the swap rule
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const r = require('../rank-icons.js');

test('seven icons, each a real WebP', () => {
    assert.deepEqual(Object.keys(r.ICONS), ['0', '1', '2', '3', '4', '5', '6']);
    for (const n of Object.keys(r.ICONS)) {
        const b = Buffer.from(r.ICONS[n], 'base64');
        assert.equal(b.slice(0, 4).toString(), 'RIFF', 'icon ' + n);
        assert.equal(b.slice(8, 12).toString(), 'WEBP', 'icon ' + n);
        assert.ok(b.length > 1000 && b.length < 20000, 'icon ' + n + ' size ' + b.length);
    }
    assert.match(r.url(6), /^data:image\/webp;base64,/);
    assert.equal(r.url(9), '');
});

test('one swap rule per Fightcade rank picture', () => {
    const css = r.css();
    for (let n = 0; n <= 6; n++) assert.ok(css.includes(`img[src$="ranks/rank${n}.png"]`), 'rank' + n);
    assert.equal((css.match(/content: url\("data:image\/webp/g) || []).length, 7);
});

test('a colour for every rank letter', () => {
    assert.deepEqual(Object.keys(r.COLORS).sort(), ['A', 'B', 'C', 'D', 'E', 'S']);
    Object.values(r.COLORS).forEach(c => assert.match(c, /^#[0-9a-f]{6}$/));
});
