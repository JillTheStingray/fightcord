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
