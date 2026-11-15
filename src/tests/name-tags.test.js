// node --test tests/      names in the game picture (name-tags.js): the layout maths and the window helper
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const N = require('../name-tags.js');

test('the picture: stretched to the window, or the game’s shape centred in it', () => {
    const client = { x: 100, y: 50, w: 1600, h: 900 };
    assert.deepEqual(N.pictureRect(client, { stretch: true }), { x: 100, y: 50, w: 1600, h: 900 });
    // 4:3 in a wide window: bars left and right
    assert.deepEqual(N.pictureRect(client, {}), { x: 100 + 200, y: 50, w: 1200, h: 900 });
    // 4:3 in a tall window: bars top and bottom
    assert.deepEqual(N.pictureRect({ x: 0, y: 0, w: 800, h: 1000 }, {}), { x: 0, y: 200, w: 800, h: 600 });
    assert.equal(N.pictureRect({ x: 0, y: 0, w: 0, h: 600 }, {}), null, 'a minimised window has no picture');
});

test('the emulator’s ini says whether the picture is stretched', () => {
    assert.equal(N.iniPicture('// If non-zero, allow stretching\r\nbVidFullStretch 1\r\n').stretch, true);
    assert.equal(N.iniPicture('bVidFullStretch 0\r\nbVidCorrectAspect 1\r\n').stretch, false);
    assert.equal(N.iniPicture('').stretch, false, 'FBNeo’s default keeps the shape');
});

test('layouts: yours per game, else the 3rd Strike one, else the default; always in range', () => {
    assert.deepEqual(N.layoutFor('sfiii3nr1', {}), N.PRESETS[0][1]);
    assert.deepEqual(N.layoutFor('kof98', {}), N.DEFAULT_LAYOUT);
    assert.deepEqual(N.layoutFor('kof98', { kof98: { x: 5, y: 30, size: 6 } }), { x: 5, y: 30, size: 6 });
    assert.deepEqual(N.layoutFor('SFIII3NR1', { sfiii3nr1: { x: 1, y: 2, size: 4 } }), { x: 1, y: 2, size: 4 }, 'rom names in any case');
    assert.deepEqual(N.cleanLayout({ x: 99, y: -5, size: 'big' }), { x: 40, y: 0, size: N.DEFAULT_LAYOUT.size });
});

test('the tags: P1 from the left edge, P2 mirrored from the right, sized by the picture', () => {
    const s = N.tagSpots(1200, 900, { x: 10, y: 20, size: 5 });
    assert.equal(s.h, 45);
    assert.deepEqual(s.p1, { left: 120, top: 180 });
    assert.deepEqual(s.p2, { right: 120, top: 180 });
    assert.ok(N.tagSpots(100, 60, { x: 0, y: 0, size: 3 }).h >= 8, 'never too small to read');
});

test('the window helper only asks Windows about the window, and compiles (Windows PowerShell)', { skip: process.platform !== 'win32' }, () => {
    const cs = N.TRACKER_CS;
    assert.ok(!/OpenProcess|ReadProcessMemory|WriteProcessMemory|SendMessage|PostMessage|SetWindowPos|keybd_event|SendInput/.test(cs), 'it never reads, writes or moves the emulator');
    const f = path.join(os.tmpdir(), 'fcwt-test-' + process.pid + '.cs');
    fs.writeFileSync(f, cs);
    try {
        const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -Path '" + f + "'; [FcWinTracker].FullName"], { encoding: 'utf8', timeout: 60000, windowsHide: true });
        assert.equal(out.trim(), 'FcWinTracker');
    } finally { fs.unlinkSync(f); }
});
