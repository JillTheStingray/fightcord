// node --test tests/      Fightcord 3.0 layout: the title bar's label, where your panel goes, the side colour
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const l3 = require('../layout3.js');

test('title bar: what it says for the view on screen', () => {
    assert.deepEqual(l3.whereLabel('welcome-channel'), { kind: 'home', text: 'Home' });
    assert.deepEqual(l3.whereLabel(''), { kind: 'home', text: 'Home' });
    assert.deepEqual(l3.whereLabel('search-channel'), { kind: 'search', text: 'Browse games' });
    assert.deepEqual(l3.whereLabel('about-channel'), { kind: 'home', text: 'Start' }, 'Fightcade’s start page');
    assert.equal(l3.whereLabel('patreon-channel').text, 'Patreon');
    assert.deepEqual(l3.whereLabel('sfiii3nr1', 'Street Fighter III 3rd Strike: Fight for the Future (Japan 990512, NO CD)'),
        { kind: 'channel', text: 'Street Fighter III 3rd Strike: Fight for the Future' }, 'the rom details in brackets go');
    assert.equal(l3.whereLabel('x', '').text, 'x', 'no name known: the id');
});

test('your panel: over the rail + member list on the left, over the list on the right', () => {
    assert.deepEqual(l3.panelBox({ rail: 72, list: 264, listLeft: true }), { left: 8, width: 320 });
    assert.deepEqual(l3.panelBox({ rail: 72, list: 0, listLeft: true }), { left: 8, width: 296 }, 'no list on screen (Discover): Discord’s sidebar width');
    assert.deepEqual(l3.panelBox({ rail: 72, list: 300, vw: 1440, listLeft: false }), { left: 1148, width: 284 });
    assert.deepEqual(l3.panelBox({ rail: 72, list: 0, vw: 1440, listLeft: false }), { left: 8, width: 296 }, 'list on the right but none on screen');
});

test('side panels: a colour between the rail and the chat', () => {
    assert.equal(l3.mix('#000000', '#ffffff', 0.5), '#808080');
    assert.equal(l3.mix('#131215', '#1b1a1f', 0), '#131215');
    assert.equal(l3.mix('#131215', '#1b1a1f', 1), '#1b1a1f');
    assert.equal(l3.mix('nope', '#1b1a1f', 0.5), '', 'a colour it can’t read: none (the theme’s own panel colour stays)');
    assert.deepEqual(Object.keys(l3.DENSITY), ['compact', 'default', 'spacious']);
    assert.equal(l3.TOP, 32);
});

test('themes: Ash is new, AMOLED is called Onyx, both are one-click Looks', () => {
    const th = require('../discord-theme.js');
    assert.equal(th.PRESETS.ash, 'Ash');
    assert.equal(th.PRESETS.amoled, 'Onyx');
    assert.equal(th.LOOKS.ash.preset, 'ash');
    assert.equal(th.LOOKS.onyx.preset, 'amoled');
});
