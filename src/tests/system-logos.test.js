// node --test tests/      system logos (system-logos.js): every logo is there and a real PNG
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../system-logos.js');

test('a logo for every system it names, each a PNG', () => {
    for (const key of new Set(Object.values(s.KEYS))) {
        assert.ok(s.LOGOS[key], 'logo for ' + key);
        const b = Buffer.from(s.LOGOS[key], 'base64');
        assert.equal(b.slice(1, 4).toString(), 'PNG', key);
        assert.equal(b.readUInt32BE(16), 112, key + ' width');
        assert.equal(b.readUInt32BE(20), 56, key + ' height');
    }
});

test('url by Fightcade system name; unknown systems keep their badge', () => {
    assert.match(s.url('Dreamcast'), /^data:image\/png;base64,/);
    assert.match(s.url(' Super NES '), /^data:image\/png;base64,/);
    assert.equal(s.url('Arcade FC1'), '');
    assert.equal(s.url(''), '');
});
