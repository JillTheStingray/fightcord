// node --test tests/      the matchup notes window (matchup-window.js): where it opens, and its page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { _test: MW } = require('../matchup-window.js');

const SCREEN = [{ x: 0, y: 0, width: 1920, height: 1040 }];

test('matchup window: opens at the right side of Fightcade the first time', () => {
    const b = MW.placeFor(null, SCREEN, { x: 100, y: 50, width: 1200, height: 800 });
    assert.equal(b.width, 380);
    assert.equal(b.x, 100 + 1200 - 380 - 24);
    assert.ok(b.y >= 50 && b.y + b.height <= 1040);
});

test('matchup window: comes back where you left it, unless that screen is gone', () => {
    const saved = { x: 1500, y: 100, width: 400, height: 700 };
    assert.deepEqual(MW.placeFor(saved, SCREEN, null), saved);
    // a second screen that's unplugged now: not off in the void
    const gone = MW.placeFor({ x: 2500, y: 100, width: 400, height: 700 }, SCREEN, { x: 0, y: 0, width: 1920, height: 1040 });
    assert.ok(gone.x + gone.width <= 1920 && gone.x >= 0);
    // nonsense saved: the default
    assert.equal(MW.placeFor({ x: NaN, y: 0, width: 10, height: 10 }, SCREEN, null).width, 380);
});

test('matchup window page: its script runs, its controls are clickable, links never open inside it', () => {
    assert.doesNotThrow(() => new Function(MW.PAGE_JS), 'the page script parses');
    assert.match(MW.PAGE, /header \{[^}]*-webkit-app-region: drag/, 'you move it by its top bar');
    assert.match(MW.PAGE, /header select, header button[^{]*\{ -webkit-app-region: no-drag/, 'and the buttons in it still click');
    assert.match(MW.PAGE_JS, /closest\('a\[href\]'\)[\s\S]*preventDefault[\s\S]*send\('open'/);
    assert.ok(!/require\(|nodeIntegration/.test(MW.PAGE_JS), 'the page itself can reach nothing');
});
