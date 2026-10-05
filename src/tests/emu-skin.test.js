// node --test tests/      emulator overlay skin (emu-skin.js): Fightcade's originals backed up, put back
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const es = require('../emu-skin.js');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function tree() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcskin-'));
    const ui = path.join(root, 'ui'), bak = path.join(root, 'bak');
    fs.mkdirSync(ui);
    fs.writeFileSync(path.join(ui, 'background.png'), 'FC bar v1');
    fs.writeFileSync(path.join(ui, 'spectators.png'), 'FC eye v1');
    fs.writeFileSync(path.join(ui, 'rank1.png'), 'FC rank');
    return { root, ui, bak, read: (f) => fs.readFileSync(path.join(ui, f), 'utf8'), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const SKIN = { 'background.png': Buffer.from('our bar'), 'spectators.png': Buffer.from('our eye') };

test('emu skin: first apply backs up Fightcade\'s files, then writes ours', () => {
    const t = tree();
    try {
        const r = es.applyFiles(t.ui, t.bak, {}, SKIN);
        assert.deepEqual(r.changed.sort(), ['background.png', 'spectators.png']);
        assert.equal(t.read('background.png'), 'our bar');
        assert.equal(fs.readFileSync(path.join(t.bak, 'background.png'), 'utf8'), 'FC bar v1');
        assert.equal(r.state.written['background.png'], sha('our bar'));
        assert.equal(r.state.originals['spectators.png'], sha('FC eye v1'));
        assert.equal(t.read('rank1.png'), 'FC rank');                       // badges untouched
        // the same again: nothing to do, the backup stays Fightcade's
        const again = es.applyFiles(t.ui, t.bak, r.state, SKIN);
        assert.deepEqual(again.changed, []);
        assert.equal(fs.readFileSync(path.join(t.bak, 'background.png'), 'utf8'), 'FC bar v1');
    } finally { t.done(); }
});

test('emu skin: off puts the originals back byte for byte', () => {
    const t = tree();
    try {
        const on = es.applyFiles(t.ui, t.bak, {}, SKIN);
        const off = es.applyFiles(t.ui, t.bak, on.state, null);
        assert.deepEqual(off.changed.sort(), ['background.png', 'spectators.png']);
        assert.equal(t.read('background.png'), 'FC bar v1');
        assert.equal(t.read('spectators.png'), 'FC eye v1');
        assert.deepEqual(off.state.written, {});
    } finally { t.done(); }
});

test('emu skin: a file a Fightcade update brought is the new original', () => {
    const t = tree();
    try {
        const on = es.applyFiles(t.ui, t.bak, {}, SKIN);
        fs.writeFileSync(path.join(t.ui, 'background.png'), 'FC bar v2');      // Fightcade updated it
        const re = es.applyFiles(t.ui, t.bak, on.state, SKIN);
        assert.deepEqual(re.changed, ['background.png']);
        assert.equal(fs.readFileSync(path.join(t.bak, 'background.png'), 'utf8'), 'FC bar v2');
        assert.equal(re.state.originals['background.png'], sha('FC bar v2'));
        // and turned off while Fightcade's newer file is there: it's left alone
        fs.writeFileSync(path.join(t.ui, 'spectators.png'), 'FC eye v2');
        const off = es.applyFiles(t.ui, t.bak, re.state, null);
        assert.deepEqual(off.changed, ['background.png']);
        assert.equal(t.read('spectators.png'), 'FC eye v2');
        assert.equal(t.read('background.png'), 'FC bar v2');
    } finally { t.done(); }
});

test('emu skin: nothing is written where there\'s no original to put back', () => {
    const t = tree();
    try {
        fs.unlinkSync(path.join(t.ui, 'spectators.png'));
        const r = es.applyFiles(t.ui, t.bak, {}, SKIN);
        assert.deepEqual(r.changed, ['background.png']);
        assert.equal(fs.existsSync(path.join(t.ui, 'spectators.png')), false);
        assert.equal(r.state.written['spectators.png'], undefined);
    } finally { t.done(); }
});

test('emu skin: theme colours and the sizes the emulator expects', () => {
    assert.deepEqual(es.hexRgb('#5865f2'), [88, 101, 242]);
    assert.deepEqual(es.hexRgb('junk'), [88, 101, 242]);
    assert.deepEqual(es.SIZES['background.png'], [1220, 50]);
    assert.deepEqual(es.SIZES['spectators.png'], [135, 50]);
});

test('emu skin: nothing is touched while an emulator is open (or it can\'t tell)', async () => {
    const t = tree();
    try {
        for (const running of [true, null]) {
            const data = { enabled: true, written: {}, originals: {} };
            const fake = {
                t: (s) => s, log() {}, own() {}, on() {}, tick() {}, settings: { block() {} }, ui: { style() {} },
                config: () => ({ data, save() {} }), modules: { get: () => null },
                files: { path: (n) => path.join(t.root, n) },
                emu: { uiDir: () => t.ui, running: () => Promise.resolve(running) }
            };
            const api = es.start(fake);
            await api.sync(true);
            assert.equal(t.read('background.png'), 'FC bar v1');
            assert.equal(fs.existsSync(path.join(t.root, es.BACKUP)), false);
            assert.deepEqual(data.written, {});
        }
    } finally { t.done(); }
});

test('emu skin: the BMFont file round-trips with new characters, kerning and name', () => {
    const block = (type, d) => { const h = Buffer.alloc(5); h[0] = type; h.writeUInt32LE(d.length, 1); return Buffer.concat([h, d]); };
    const info = Buffer.alloc(14); info.writeInt16LE(36, 0); info[13] = 3;
    const common = Buffer.alloc(15); common.writeUInt16LE(36, 0); common.writeUInt16LE(28, 2); common.writeUInt16LE(512, 4); common.writeUInt16LE(512, 6); common.writeUInt16LE(1, 8);
    const chars = Buffer.alloc(20); chars.writeUInt32LE(65, 0); chars.writeUInt16LE(23, 8); chars.writeUInt16LE(25, 10); chars.writeInt16LE(-3, 12); chars.writeInt16LE(6, 14); chars.writeInt16LE(17, 16);
    const kern = Buffer.alloc(10); kern.writeUInt32LE(65, 0); kern.writeUInt32LE(86, 4); kern.writeInt16LE(-2, 8);
    const orig = Buffer.concat([Buffer.from('BMF\x03', 'latin1'), block(1, Buffer.concat([info, Buffer.from('Source Sans Pro\0', 'latin1')])),
        block(2, common), block(3, Buffer.from('font_0.png\0', 'latin1')), block(4, chars), block(5, kern)]);
    const src = es.parseFnt(orig);
    assert.equal(src.fontSize, 36); assert.equal(src.outline, 3); assert.equal(src.base, 28); assert.equal(src.lineHeight, 36);
    assert.deepEqual(src.chars[0], { id: 65, x: 0, y: 0, w: 23, h: 25, xo: -3, yo: 6, xa: 17, page: 0, chnl: 0 });
    assert.deepEqual(src.kerning, [{ a: 65, b: 86, amt: -2 }]);
    const out = es.parseFnt(es.buildFnt(src, [{ id: 65, x: 4, y: 5, w: 24, h: 26, xo: -4, yo: 5, xa: 18 }, { id: 86, x: 30, y: 5, w: 22, h: 26, xo: -4, yo: 5, xa: 16 }],
        [{ a: 65, b: 86, amt: -1 }], "'Noto Sans'"));
    assert.equal(out.blocks[1].slice(14).toString('latin1'), "'Noto Sans'\0".replace(/'/g, "'"));
    assert.equal(out.base, 28); assert.equal(out.scaleW, 512);
    assert.equal(out.blocks[3].toString('latin1'), 'font_0.png\0');
    assert.deepEqual(out.chars.map(c => [c.id, c.x, c.xa, c.chnl]), [[65, 4, 18, 15], [86, 30, 16, 15]]);
    assert.deepEqual(out.kerning, [{ a: 65, b: 86, amt: -1 }]);
    assert.equal(es.parseFnt(Buffer.from('nope')), null);
    assert.ok(es.FILES.includes('font.fnt') && es.FILES.includes('font_0.png'));
});

test('emu skin: the font list, and the old font switch carried over', () => {
    const ids = es.FONTS.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids.slice(0, 2), ['theme', 'fightcade']);
    es.FONTS.slice(2).forEach(f => {
        assert.ok(f.gf && f.family && f.weight, f.id + ' needs a Google Fonts family and a weight');
        assert.ok(f.gf.replace(/\+/g, ' ').startsWith(f.family), f.id + ': family and Google Fonts name agree');
    });
    const data = { enabled: false, font: false, written: {}, originals: {} };
    const fake = { t: (s) => s, log() {}, own() {}, on() {}, tick() {}, settings: { block() {}, refresh() {} }, ui: { style() {} },
        config: () => ({ data, save() {} }), modules: { get: () => null }, files: { path: (n) => n }, emu: { uiDir: () => 'x', running: () => Promise.resolve(true) } };
    es.start(fake);
    assert.equal(data.fontChoice, 'fightcade');
    assert.equal('font' in data, false);
});
