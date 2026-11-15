// node --test tests/      matchup trials (trials.js): the request, the addon list, the trial script's limits, a start
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TR = require('../trials.js');

test('trials: found by game and opponent, any rom of the game and any case', () => {
    assert.equal(TR.forMatchup('sfiii3nr1', 'Chun-Li')[0].id, '3s-chun-crmk');
    assert.equal(TR.forMatchup('sfiii3', 'chun-li').length, 1);
    assert.equal(TR.forMatchup('sfiii3nr1', 'Ken').length, 0);
    assert.equal(TR.forMatchup('kof98', 'Chun-Li').length, 0);
});

test('trials: the request is plain key=value lines, and the progress file reads back', () => {
    const t = TR.TRIALS[0];
    const req = TR.requestText(t, { auto: 'parry', hint: 'line\nbreak = here' });
    assert.match(req, /^trial=3s-chun-crmk$/m);
    assert.match(req, /^char=16$/m);
    assert.match(req, /^auto=parry$/m);
    assert.match(req, /^hint=line break   here$/m, 'no newline or "=" can break a value');
    const r = TR.parseOut('trial=3s-chun-crmk\r\nstatus=passed\r\nstreak=5\r\nbest=7\r\npassed=1\r\n');
    assert.deepEqual([r.trial, r.status, r.streak, r.best, r.passed], ['3s-chun-crmk', 'passed', 5, 7, 1]);
});

test('trials: other game addons stay listed; ours is added once', () => {
    assert.equal(TR.addonsText(null), TR.ADDONS);
    const theirs = 'addons_run = {\r\n\t"combo-trainer.lua",\r\n}\r\n';
    const both = TR.addonsText(theirs);
    assert.ok(both.startsWith(theirs.trim()) && /table\.insert\(addons_run, "fightcord-trial\.lua"\)/.test(both));
    assert.equal(TR.addonsText(both), both, 'already there: unchanged');
});

test('the trial script: quiet without a request, and it never takes over the training script or the system', () => {
    const lua = TR.LUA;
    assert.match(lua, /if not req then return end/, 'no request: nothing happens in normal training');
    assert.match(lua, /os\.remove\(REQ\)/, 'the request is used once');
    assert.ok(!/emu\.register(before|after|exit)|gui\.register\(/.test(lua), 'the training script owns the frame and exit hooks');
    assert.ok(!/os\.execute|io\.popen|loadstring|dofile/.test(lua), 'runs nothing else');
    const writes = lua.match(/memory\.write\w*\([^)]*\)/g) || [];
    assert.deepEqual(writes, ['memory.writebyte(SEL_ID[2], OPP)'], 'its only memory write picks the dummy on the select screen');
});

test('starting a trial: installs the addon next to the training script, writes the request, opens training mode', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fctrial-'));
    const fb = path.join(root, 'emulator', 'fbneo');
    fs.mkdirSync(path.join(fb, 'fightcade'), { recursive: true });
    const addon = path.join(fb, 'fbneo-training-mode', 'games', 'sfiii3', 'addon');
    fs.mkdirSync(addon, { recursive: true });
    fs.writeFileSync(path.join(addon, 'addons.lua'), 'addons_run = { "mine.lua" }\r\n');
    const opened = [], toasts = [];
    global.window = global.window || {};
    window.__fcdOpenUri = (u) => opened.push(u);
    const data = {};
    const fc = {
        t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)),
        log() {}, emit() {}, tick() {},
        config: () => ({ data, save() {} }),
        emu: { dir: () => path.join(fb, 'fightcade'), running: async () => false },
        ui: { toast: (title) => toasts.push(title) }
    };
    fc.log.error = () => {};
    const api = TR.start(fc);
    try {
        assert.equal(await api.start('3s-chun-crmk', 'sfiii3nr1'), true);
        assert.deepEqual(opened, ['fcade://training/fbneo/sfiii3nr1']);
        assert.match(fs.readFileSync(path.join(addon, 'fightcord-trial.req'), 'utf8'), /^trial=3s-chun-crmk$/m);
        assert.ok(fs.readFileSync(path.join(addon, 'fightcord-trial.lua'), 'utf8').includes('\r\n'), 'Windows line ends');
        const list = fs.readFileSync(path.join(addon, 'addons.lua'), 'utf8');
        assert.ok(list.includes('"mine.lua"') && list.includes('fightcord-trial.lua'));
        // an emulator already open: no trial (the request would be read by the next training session instead)
        fc.emu.running = async () => true;
        assert.equal(await api.start('3s-chun-crmk', 'sfiii3nr1'), false);
        assert.equal(opened.length, 1);
    } finally {
        delete window.__fcdOpenUri;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
