// node --test tests/      the emulator's match files (core fc.emu), characters per set, overlay + analytics by character
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require('../fightcord-core.js');
const { data, emu } = core._test;
const ms = require('../match-screens.js');
const st = require('../streamer.js');
const an = require('../analytics.js');

const RAW = {
    game: 'sfiii3nr1\r\n', gamequark: '1791217087358-7474.0', p1name: '﻿TurtleTime', p1rank: 'B', p1score: '5',
    p1character: 'Akuma', p1country: 'NL', p2name: 'Rival', p2rank: 'd', p2score: '0', p2character: 'Yang', p2country: 'BR'
};

test('emulator files: parsed, the quark matches Fightcade\'s form', () => {
    const m = data.parseEmu(RAW);
    assert.equal(m.quark, '1791217087358-7474');
    assert.equal(m.rom, 'sfiii3nr1');
    assert.deepEqual(m.p1, { name: 'TurtleTime', rank: 'B', score: 5, char: 'Akuma', cc: 'nl' });
    assert.deepEqual(m.p2, { name: 'Rival', rank: 'D', score: 0, char: 'Yang', cc: 'br' });
    assert.equal(data.quarkKey('1791217087358-7474'), '1791217087358-7474');
    assert.equal(data.parseEmu({}), null);
    assert.equal(data.parseEmu(Object.assign({}, RAW, { p2score: '' })).p2.score, null);
});

test('emulator files: your side by name, either slot', () => {
    const m = data.parseEmu(RAW);
    assert.equal(data.emuSides(m, 'turtletime').theirs.name, 'Rival');
    assert.equal(data.emuSides(m, 'Rival').mine.char, 'Yang');
    assert.equal(data.emuSides(m, 'Someone'), null);
    assert.equal(data.emuSides(null, 'Rival'), null);
});

test('fc.emu reads <Fightcade>/emulator/fbneo/fightcade and checks the quark', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcemu-'));
    const dir = path.join(root, 'emulator', 'fbneo', 'fightcade');
    fs.mkdirSync(dir, { recursive: true });
    Object.keys(RAW).forEach(k => fs.writeFileSync(path.join(dir, k + '.txt'), RAW[k]));
    core._test.setDir(path.join(root, 'fc2-electron', 'resources', 'app', 'inject', 'fightcord'));
    try {
        assert.equal(emu.dir(), dir);
        assert.equal(emu.match('1791217087358-7474').p1.char, 'Akuma');
        assert.equal(emu.match('1791217087358-7474.0').p2.score, 0);
        assert.equal(emu.match('other-quark'), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('in-game chat mute comes from the emulator ini', () => {
    assert.equal(emu.iniMutesChat('// Mute Fightcade chat\r\nbVidMuteChat 1\r\n'), true);
    assert.equal(emu.iniMutesChat('bVidMuteChat 0\r\n'), false);
    assert.equal(emu.iniMutesChat('nVidDepth 1\n'), false);
    assert.equal(emu.iniMutesChat(''), false);
});

// 3.14.3: FBNeo ships with its match files off; without them 3rd Strike goals can't tell your side
test('the emulator’s match files get turned on: that one line only, and never while it runs', async () => {
    const INI = '// Show Fightcade overlay debug inputs\r\nbVidUnrankedScores 1\r\n\r\n// Save Fightcade overlay data to files in realtime (for Streaming)\r\nbVidSaveOverlayFiles 0\r\n\r\n// Save Fightcade chat history\r\nbVidSaveChatHistory 0\r\n';
    const on = emu.iniWithOverlayFiles(INI);
    assert.equal(on, INI.replace('bVidSaveOverlayFiles 0', 'bVidSaveOverlayFiles 1'));
    assert.equal(emu.iniWithOverlayFiles(on), null, 'already on');
    assert.equal(emu.iniWithOverlayFiles('nVidDepth 1\r\n'), null, 'no such line: left alone');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcini-'));
    const cfgDir = path.join(root, 'emulator', 'fbneo', 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    const ini = path.join(cfgDir, 'fcadefbneo.ini');
    fs.writeFileSync(ini, INI, 'latin1');
    core._test.setDir(path.join(root, 'fc2-electron', 'resources', 'app', 'inject', 'fightcord'));
    const realRunning = emu.running;
    try {
        emu.running = () => Promise.resolve(true);
        assert.equal(await emu.overlayFilesOn(), 'busy');
        assert.equal(fs.readFileSync(ini, 'latin1'), INI, 'untouched while the emulator is open');
        emu.running = () => Promise.resolve(null);
        assert.equal(await emu.overlayFilesOn(), 'busy', 'can’t tell = don’t touch');
        emu.running = () => Promise.resolve(false);
        assert.equal(await emu.overlayFilesOn(), 'done');
        assert.equal(fs.readFileSync(ini, 'latin1'), on);
        assert.equal(await emu.overlayFilesOn(), 'on');
        fs.unlinkSync(ini);
        assert.equal(await emu.overlayFilesOn(), 'none');
    } finally {
        emu.running = realRunning;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('characters per set: each finished game counts for the characters on screen', () => {
    const side = (ms_, ts, mc, tc) => ({ mine: { score: ms_, char: mc }, theirs: { score: ts, char: tc } });
    let c = ms.charStep(null, side(0, 0, 'Akuma', 'Yang'));
    c = ms.charStep(c, side(1, 0, 'Akuma', 'Yang'));          // game 1: Akuma beat Yang
    c = ms.charStep(c, side(1, 0, 'Akuma', 'Yun'));           // they switch
    c = ms.charStep(c, side(1, 1, 'Akuma', 'Yun'));
    c = ms.charStep(c, side(2, 1, 'Akuma', 'Yun'));
    c = ms.charStep(c, side(2, 1, 'Akuma', 'Yun'));           // no change: not counted twice
    assert.deepEqual(c.mine, { Akuma: 3 });
    assert.deepEqual(c.theirs, { Yang: 1, Yun: 2 });
    assert.equal(data.mainChar(c.theirs, c.lastTheirs), 'Yun');
    assert.equal(data.mainChar({}, 'Ken'), 'Ken');
    assert.equal(ms.charStep(c, null), c);
});

test('overlay: characters under the names while playing', () => {
    const s = st.overlayState({ me: 'Me', myChar: 'Akuma', opp: 'Them', oppChar: 'Yang', score: { mine: 1, theirs: 0 } });
    assert.equal(s.me.char, 'Akuma');
    assert.equal(s.opp.char, 'Yang');
    assert.equal(st.overlayState({ me: 'Me', myChar: 'Akuma' }).me.char, '');
});

test('analytics: by your character and by theirs', () => {
    const set = (o) => Object.assign({ at: Date.UTC(2026, 9, 1, 20), result: 'won' }, o);
    const a = an.analyze([set({ myChar: 'Akuma', oppChar: 'Yang' }), set({ myChar: 'Akuma', oppChar: 'Yun', result: 'lost' }), set({})]);
    assert.equal(a.byMyChar.Akuma.n, 2);
    assert.equal(a.byOppChar.Yang.w, 1);
    assert.equal(a.byOppChar.Yun.l, 1);
    assert.equal(Object.keys(a.byOppChar).length, 2);
});
