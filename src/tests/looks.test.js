// node --test tests/      theme Looks (discord-theme.js): every part of a Look exists
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
const theme = require('../discord-theme.js');
const bg = require('../backgrounds.js');
const skin = require('../emu-skin.js');

test('looks: each one uses a real palette, font, background and emulator font', () => {
    const skinFonts = skin.FONTS.map(f => f.id);
    Object.keys(theme.LOOKS).forEach(k => {
        const L = theme.LOOKS[k];
        assert.ok(theme.PRESETS[L.preset], k + ': palette ' + L.preset);
        assert.ok(L.font in theme.FONTS, k + ': font in the font list');
        assert.ok(!L.font || /Noto|Segoe|Arial|Verdana|Trebuchet/.test(L.font) || theme.GFONTS[L.font], k + ': a web font has a Google Fonts entry');
        assert.match(L.accent, /^#[0-9a-f]{6}$/);
        assert.ok(['off', 'particles', 'waves', 'art', 'visualizer'].includes(L.bg.style), k + ': background style');
        if (L.bg.look) assert.ok(bg.LOOKS[L.bg.look], k + ': visualizer look');
        assert.ok(skinFonts.includes(L.emuFont), k + ': emulator font ' + L.emuFont);
        assert.equal(L.sw.length, 3);
    });
    assert.deepEqual(['crt', 'strike', 'tokyo'].filter(k => theme.LOOKS[k]).length, 3);
});

test('looks, 3.11: Online Edition needs your own game files, and keeps its lettering off the messages', () => {
    const L = theme.LOOKS.oe;
    assert.ok(L && L.own && L.preset === 'oe' && L.accent === '#e2d51c');
    assert.ok(!theme.LOOKS.strike.own, 'the 3rd Strike Look stays for everyone');
    const css = theme._css();
    assert.match(css, /html\.dc-theme\.dc-preset-oe\s*\{/, 'its palette');
    // every rule with the pictures or the font waits for the files (html.dc-oe-own)
    css.split('}').filter(r => /--dc-oe-|FC OE /.test(r.split('{')[1] || '')).forEach(r => assert.match(r.split('{')[0], /dc-oe-own/, r.slice(0, 80)));
    // the District lettering: names and titles, never a message's text
    const lettering = css.split('}').filter(r => /'FC OE District'/.test(r)).map(r => r.split('{')[0]).join(',');
    assert.match(lettering, /header \.author/);
    assert.doesNotMatch(lettering, /\.line\b|\.blocks|\.regular|input/);
});

test('looks, 3.11: text on the accent is dark on a light accent, white otherwise', () => {
    const on = (hex) => theme.onAccent([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
    assert.equal(on('#5865f2'), '#fff');
    assert.equal(on('#23a55a'), '#fff', 'Discord green keeps white');
    assert.equal(on('#e2d51c'), '#141303');
    assert.notEqual(on('#ffb000'), '#fff', 'the CRT amber gets dark text');
});
