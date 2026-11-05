// node --test tests/      3.10: your own 3rd Strike art (own-art.js) -- DDS, PNG, zip, the folder, the import
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

global.window = global.window || {};
const OA = require('../own-art.js');

// a DDS file: header + data (fourCC, or 32-bit BGRA when fmt is 'BGRA')
function dds(w, h, fmt, data) {
    const b = Buffer.alloc(128);
    b.write('DDS ', 0, 'ascii');
    b.writeUInt32LE(124, 4); b.writeUInt32LE(h, 12); b.writeUInt32LE(w, 16);
    if (fmt === 'BGRA') { b.writeUInt32LE(0x41, 80); b.writeUInt32LE(32, 88); b.writeUInt32LE(0xff0000, 92); b.writeUInt32LE(0xff00, 96); b.writeUInt32LE(0xff, 100); b.writeUInt32LE(0xff000000, 104); }
    else { b.writeUInt32LE(4, 80); b.write(fmt, 84, 'ascii'); }
    return Buffer.concat([b, Buffer.from(data)]);
}
const px = (img, x, y) => Array.from(img.rgba.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

test('DDS: DXT1 colours and its see-through colour, DXT5 alpha, 32-bit BGRA', () => {
    // red / blue end points; pixel 0 = c0, pixel 1 = c1, pixel 2 = 2/3 c0 + 1/3 c1
    const four = dds(4, 4, 'DXT1', [0x00, 0xf8, 0x1f, 0x00, 0b100100, 0, 0, 0]);
    const a = OA.decodeDds(four);
    assert.deepEqual([a.w, a.h], [4, 4]);
    assert.deepEqual(px(a, 0, 0), [255, 0, 0, 255]);
    assert.deepEqual(px(a, 1, 0), [0, 0, 255, 255]);
    assert.deepEqual(px(a, 2, 0), [170, 0, 85, 255]);
    // c0 <= c1: 3 colours + clear (index 3)
    const clear = OA.decodeDds(dds(4, 4, 'DXT1', [0x1f, 0x00, 0x00, 0xf8, 0b11, 0, 0, 0]));
    assert.equal(px(clear, 0, 0)[3], 0);
    // DXT5: a0 255, a1 0; indices 0, 1, 2 -> 255, 0, 218 (6/7 of the way)
    const alpha = [255, 0, 0b10001000, 0, 0, 0, 0, 0];
    const five = OA.decodeDds(dds(4, 4, 'DXT5', alpha.concat([0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0])));
    assert.deepEqual([px(five, 0, 0)[3], px(five, 1, 0)[3], px(five, 2, 0)[3]], [255, 0, 218]);
    assert.deepEqual(px(five, 0, 0).slice(0, 3), [255, 0, 0]);
    const raw = OA.decodeDds(dds(1, 1, 'BGRA', [10, 20, 30, 40]));
    assert.deepEqual(px(raw, 0, 0), [30, 20, 10, 40]);
    assert.equal(OA.decodeDds(Buffer.from('not a texture')), null);
    assert.equal(OA.decodeDds(dds(8, 8, 'DXT5', [1, 2, 3])), null, 'too short');
});

test('the see-through edges are cropped; the PNG is a real PNG', () => {
    const img = { w: 4, h: 3, rgba: new Uint8Array(4 * 3 * 4) };
    img.rgba.set([1, 2, 3, 255], (1 * 4 + 2) * 4);
    img.rgba.set([4, 5, 6, 255], (2 * 4 + 1) * 4);
    const box = OA.opaqueBox(img);
    assert.deepEqual(box, { x: 1, y: 1, w: 2, h: 2 });
    const c = OA.crop(img, box);
    assert.deepEqual(Array.from(c.rgba.subarray(4, 8)), [1, 2, 3, 255]);
    assert.deepEqual(OA.opaqueBox({ w: 2, h: 2, rgba: new Uint8Array(16) }), { x: 0, y: 0, w: 2, h: 2 }, 'all clear: all of it');
    const p = OA.png(c);
    assert.deepEqual(Array.from(p.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(p.readUInt32BE(16), 2); assert.equal(p.readUInt32BE(20), 2);
    assert.equal(OA.crc32(Buffer.from('IEND')), 0xae426082);
    const idat = p.indexOf('IDAT'), len = p.readUInt32BE(idat - 4);
    const rows = zlib.inflateSync(p.subarray(idat + 4, idat + 4 + len));
    assert.equal(rows.length, 2 * (2 * 4 + 1));
    assert.deepEqual(Array.from(rows.subarray(5, 9)), [1, 2, 3, 255]);
});

// a zip with one stored and one deflated file
function zip(files) {
    const locals = [], cents = [];
    let off = 0;
    for (const [name, data, deflate] of files) {
        const body = deflate ? zlib.deflateRawSync(data) : data, n = Buffer.from(name);
        const l = Buffer.alloc(30);
        l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(deflate ? 8 : 0, 8); l.writeUInt32LE(body.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
        locals.push(l, n, body); cents.push(c, n);
        off += 30 + n.length + body.length;
    }
    const cd = Buffer.concat(cents), e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
    return Buffer.concat(locals.concat([cd, e]));
}

test('zip: stored and deflated files; MSF sound files lose their header', () => {
    const z = zip([['a.txt', Buffer.from('hello'), false], ['dir/b.bin', Buffer.alloc(300, 7), true]]);
    const es = OA.zipEntries(z);
    assert.deepEqual(es.map(e => e.name), ['a.txt', 'dir/b.bin']);
    assert.equal(OA.zipRead(z, es[0]).toString(), 'hello');
    assert.deepEqual(OA.zipRead(z, es[1]), Buffer.alloc(300, 7));
    assert.deepEqual(OA.zipEntries(Buffer.from('nope')), []);
    const msf = Buffer.concat([Buffer.from('MSFC'), Buffer.alloc(60), Buffer.from([0xff, 0xfb, 1, 2])]);
    assert.deepEqual(Array.from(OA.stripMsf(msf)), [0xff, 0xfb, 1, 2]);
    assert.deepEqual(Array.from(OA.stripMsf(Buffer.from([0xff, 0xfb]))), [0xff, 0xfb], 'a plain MP3 stays as it is');
    assert.equal(OA.charKey('Chun-Li'), 'chunli');
});

// a tiny 3rd Strike Online Edition: RPCS3/dev_hdd0/game/NPEB00554/USRDIR
function fakeGame() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcoa-'));
    const usr = path.join(root, 'dev_hdd0', 'game', 'NPEB00554', 'USRDIR');
    fs.mkdirSync(path.join(usr, 'zip'), { recursive: true });
    fs.mkdirSync(path.join(usr, 'flashtextures', 'ColorPackIcons'), { recursive: true });
    fs.mkdirSync(path.join(usr, 'Sound', 'BGM'), { recursive: true });
    // 8x4 art: the left block solid (alpha 255), the right one clear
    const solid = [255, 255, 0, 0, 0, 0, 0, 0, 0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0], clear = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const art = dds(8, 4, 'DXT5', solid.concat(clear));
    fs.writeFileSync(path.join(usr, 'zip', 'mainmenu.zip'), zip([['flashtextures/mainmenu/ken.dds', art, true], ['flashtextures/mainmenu/chun-li.dds', art, false], ['other/x.dds', art, false]]));
    const bust = (v) => dds(1, 1, 'BGRA', [v, v, v, 255]);
    fs.writeFileSync(path.join(usr, 'flashtextures', 'ColorPackIcons', 'Colorpak01_Ken_A.dds'), bust(1));
    fs.writeFileSync(path.join(usr, 'flashtextures', 'ColorPackIcons', 'ColorpakDefault_Ken_B.dds'), bust(2));
    fs.writeFileSync(path.join(usr, 'flashtextures', 'ColorPackIcons', 'ColorpakDefault_Ken_A.dds'), bust(3));
    fs.writeFileSync(path.join(usr, 'flashtextures', 'ColorPackIcons', 'ColorpakDefault_Sean_ X.dds'), bust(4));
    fs.writeFileSync(path.join(usr, 'Sound', 'BGM', '51_VS.mp3'), Buffer.concat([Buffer.from('MSFC'), Buffer.alloc(60), Buffer.from([0xff, 0xfb])]));
    return { root, usr };
}

test('the folder: RPCS3, dev_hdd0, the game, USRDIR itself; elsewhere nothing', () => {
    const g = fakeGame();
    try {
        for (const d of [g.root, path.join(g.root, 'dev_hdd0'), path.join(g.root, 'dev_hdd0', 'game'), path.join(g.usr, '..'), g.usr]) assert.equal(OA.findUsrdir(d), g.usr, d);
        assert.equal(OA.findUsrdir(os.tmpdir() + path.sep + 'no-such-folder-fc'), '');
        assert.equal(OA.findUsrdir(path.join(g.usr, 'Sound')), '');
    } finally { fs.rmSync(g.root, { recursive: true, force: true }); }
});

test('the import: art cropped to the character, the default-colour bust, the jingles without their header', async () => {
    const g = fakeGame(), out = path.join(g.root, 'out');
    const steps = [];
    try {
        const r = await OA.importFrom(g.usr, (t) => steps.push(t), out);
        assert.deepEqual(r.chars.sort(), ['chunli', 'ken']);
        assert.deepEqual(r.faces.sort(), ['ken', 'sean']);
        assert.deepEqual(r.sounds, ['vs']);
        assert.ok(steps.length >= 3);
        const art = fs.readFileSync(path.join(out, 'full', 'ken.png'));
        assert.deepEqual([art.readUInt32BE(16), art.readUInt32BE(20)], [4, 4], 'the clear half is cut off');
        // the bust: ColorpakDefault_Ken_A (3), not _B or Colorpak01
        const bust = fs.readFileSync(path.join(out, 'face', 'ken.png')), idat = bust.indexOf('IDAT');
        assert.equal(zlib.inflateSync(bust.subarray(idat + 4, idat + 4 + bust.readUInt32BE(idat - 4)))[1], 3);
        assert.deepEqual(Array.from(fs.readFileSync(path.join(out, 'sound', 'vs.mp3'))), [0xff, 0xfb]);
        assert.equal(fs.existsSync(out + '.new'), false);
        // again: replaced, not added to
        fs.unlinkSync(path.join(g.usr, 'flashtextures', 'ColorPackIcons', 'ColorpakDefault_Sean_ X.dds'));
        const r2 = await OA.importFrom(g.usr, null, out);
        assert.deepEqual(r2.faces, ['ken']);
        assert.equal(fs.existsSync(path.join(out, 'face', 'sean.png')), false);
    } finally { fs.rmSync(g.root, { recursive: true, force: true }); }
});

/* ------------------------------------------- 3.11: GTF, the sheets, the bigger import */

// a GTF with one texture: header + one 0x24 entry + data
function gtf(w, h, fmt, data) {
    const head = Buffer.alloc(12 + 0x24);
    head.writeUInt32BE(0x01020304, 0); head.writeUInt32BE(data.length, 4); head.writeUInt32BE(1, 8);
    const e = 12;
    head.writeUInt32BE(0, e); head.writeUInt32BE(head.length, e + 4); head.writeUInt32BE(data.length, e + 8);
    head[e + 12] = fmt; head[e + 13] = 1; head[e + 14] = 2;
    head.writeUInt16BE(w, e + 20); head.writeUInt16BE(h, e + 22); head.writeUInt16BE(1, e + 24);
    head.writeUInt32BE(fmt & 0x20 ? w * 4 : 0, e + 28);
    return Buffer.concat([head, Buffer.from(data)]);
}

test('GTF: DXT1 like a DDS, A8R8G8B8 unswizzled, anything else left out', () => {
    // 0xa6 = DXT1, linear: the same red/blue block as the DDS test
    const [d] = OA.decodeGtf(gtf(4, 4, 0xa6, [0x00, 0xf8, 0x1f, 0x00, 0b100100, 0, 0, 0]));
    assert.deepEqual([d.w, d.h, px(d, 0, 0), px(d, 1, 0)], [4, 4, [255, 0, 0, 255], [0, 0, 255, 255]]);
    // 0x85 swizzled 2x2: memory order (0,0) (1,0) (0,1) (1,1) for 2x2 Morton; ARGB bytes
    const argb = [[255, 10, 0, 0], [255, 20, 0, 0], [255, 30, 0, 0], [128, 40, 0, 0]];
    const sw = OA.decodeGtf(gtf(2, 2, 0x85, [].concat(...argb)))[0];
    assert.deepEqual([px(sw, 0, 0), px(sw, 1, 0), px(sw, 0, 1), px(sw, 1, 1)], [[10, 0, 0, 255], [20, 0, 0, 255], [30, 0, 0, 255], [40, 0, 0, 128]]);
    assert.equal(OA.mortonIndex(1, 1, 4, 4), 3);
    assert.equal(OA.mortonIndex(2, 0, 4, 4), 4);
    assert.deepEqual(OA.decodeGtf(gtf(4, 4, 0x8b, Array(64).fill(0))), [], 'a format it can’t read');
    assert.deepEqual(OA.decodeGtf(Buffer.from('short')), []);
});

// an RGBA picture with opaque rectangles [x, y, w, h]
function sheet(w, h, rects) {
    const img = { w, h, rgba: new Uint8Array(w * h * 4) };
    rects.forEach(([x0, y0, rw, rh]) => { for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) img.rgba.set([200, 200, 200, 255], (y * w + x) * 4); });
    return img;
}

test('the sheets: each plate / oval found, put in the game’s order, nothing when the count is off', () => {
    const img = sheet(200, 120, [[2, 4, 60, 20], [3, 40, 90, 20], [110, 5, 50, 20], [112, 42, 40, 20], [111, 80, 70, 24]]);
    const bs = OA.boxes(img);
    assert.equal(bs.length, 5);
    assert.ok(bs.some(b => b.x === 3 && b.y === 40 && b.w === 90 && b.h === 20), 'tightened to the real pixels');
    const n = OA.splitNames(img, ['a', 'b'], ['c', 'd', 'e']);
    assert.deepEqual([n.a.y, n.b.y, n.c.x, n.e.y], [4, 40, 110, 80]);
    assert.equal(OA.splitNames(img, ['a'], ['c', 'd', 'e']), null);
    const ov = sheet(120, 60, [[60, 2, 50, 20], [4, 3, 50, 20], [4, 34, 50, 20], [62, 33, 50, 20]]);
    const o = OA.splitOvals(ov, ['tl', 'tr', 'bl', 'br']);
    assert.deepEqual([o.tl.x, o.tr.x, o.bl.y, o.br.x], [4, 60, 34, 62], 'rows, then left to right');
    assert.equal(OA.splitOvals(ov, ['one']), null);
    assert.equal(OA.boxes(sheet(40, 40, [[1, 1, 2, 2]])).length, 0, 'specks don’t count');
    const big = OA.shrink(sheet(10, 8, [[0, 0, 10, 8]]), 4);
    assert.deepEqual([big.w, big.h], [2, 2]);
});

test('the import, 3.11: portraits, ovals, names, VS background, banners and the Vault', async () => {
    const g = fakeGame(), out = path.join(g.root, 'out');
    try {
        const solid = (n) => [].concat(...Array(n).fill([255, 255, 0, 0, 0, 0, 0, 0, 0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0]));
        const clear = (n) => Array(16 * n).fill(0);
        // 8x4 DXT5: left block solid, right clear
        const port = gtf(8, 4, 0xa8, solid(1).concat(clear(1)));
        // the ovals: a 20-wide x 4-high sheet would be too small for boxes(); use 2 ovals in 16x8 (4x2 blocks)
        // with the order list cut to 2 -- the real order is checked against the pictures by eye
        const two = gtf(32, 8, 0xa8, solid(1).concat(clear(3), solid(1), clear(3), clear(8)));
        const usrZip = path.join(g.usr, 'zip');
        fs.writeFileSync(path.join(usrZip, 'hirez.wad.zip'), zip([
            ['hirez/cs_portraits/204_Ken.gtf', port, true], ['hirez/cs_portraits/204_Basketball.gtf', port, false],
            ['hirez/cs_misc/background_vs.gtf', port, false], ['hirez/charsel/Thumbnail_atlas.gtf', two, false]]));
        fs.writeFileSync(path.join(usrZip, 'trials.wad.zip'), zip([['flashtextures/trials/ken.dds', dds(8, 4, 'DXT5', solid(1).concat(clear(1))), false],
            ['flashtextures/trials/parry.dds', dds(4, 4, 'DXT5', solid(1)), false]]));
        fs.mkdirSync(path.join(g.usr, 'flashtextures', 'vault', 'concepts'), { recursive: true });
        fs.mkdirSync(path.join(g.usr, 'flashtextures', 'vault', 'thumbs'), { recursive: true });
        fs.writeFileSync(path.join(g.usr, 'flashtextures', 'vault', 'concepts', '204_ken.dds'), dds(4, 4, 'DXT1', [0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0]));
        fs.writeFileSync(path.join(g.usr, 'flashtextures', 'vault', 'thumbs', '204_ken.dds'), dds(4, 4, 'DXT1', [0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0]));
        fs.writeFileSync(path.join(g.usr, 'flashtextures', 'vault', 'concepts', 'nothumb.dds'), dds(4, 4, 'DXT1', [0, 0, 0, 0, 0, 0, 0, 0]));
        const r = await OA.importFrom(g.usr, null, out);
        assert.equal(r.v, 4);
        assert.deepEqual(r.portraits, ['ken'], 'Basketball is a stage, not a character');
        assert.equal(r.vsbg, true);
        assert.deepEqual(r.banners, ['ken'], 'the trial menu’s parry banner isn’t a character');
        assert.deepEqual(r.vault, ['204_ken'], 'only concepts with a thumbnail');
        assert.deepEqual(r.ovals, [], 'a sheet that doesn’t have all 20 ovals is left out, not mislabelled');
        const p = fs.readFileSync(path.join(out, 'portrait', 'ken.png'));
        assert.deepEqual([p.readUInt32BE(16), p.readUInt32BE(20)], [4, 4], 'cropped to the character');
        assert.ok(fs.existsSync(path.join(out, 'bg', 'vs.png')) && fs.existsSync(path.join(out, 'vault', '204_ken.png')));
        assert.equal(fs.readFileSync(path.join(out, 'bg', 'vs.png')).readUInt32BE(16), 8, 'character select’s VS background');
        // the menus' concrete backdrop wins when the copy has it
        fs.mkdirSync(path.join(g.usr, 'textures'));
        fs.writeFileSync(path.join(g.usr, 'textures', 'background.gtf'), gtf(4, 4, 0xa8, solid(1)));
        await OA.importFrom(g.usr, null, out);
        assert.equal(fs.readFileSync(path.join(out, 'bg', 'vs.png')).readUInt32BE(16), 4, 'textures/background.gtf');
    } finally { fs.rmSync(g.root, { recursive: true, force: true }); }
});

/* ------------------------------------------------- 3.11: the Online Edition Look's pieces */

// bits, most significant first (SWF shape records)
function bits() {
    const out = [];
    let cur = 0, n = 0;
    const put = (v, k) => { for (let i = k - 1; i >= 0; i--) { cur = cur * 2 + (Math.floor(v / 2 ** i) & 1); if (++n === 8) { out.push(cur); cur = 0; n = 0; } } };
    return { put, sb: (v, k) => put(v < 0 ? v + 2 ** k : v, k), done: () => { if (n) out.push(cur << (8 - n)); return Buffer.from(out); } };
}
// a glyph: [['m', x, y] | ['l', dx, dy] | ['c', cdx, cdy, adx, ady]] -> its SHAPE (1 fill bit, 0 line bits)
function shape(cmds) {
    const w = bits(), N = 16;
    w.put(1, 4); w.put(0, 4);
    cmds.forEach(c => {
        if (c[0] === 'm') { w.put(0, 1); w.put(0b00101, 5); w.put(N, 5); w.sb(c[1], N); w.sb(c[2], N); w.put(1, 1); }
        else if (c[0] === 'l') { w.put(1, 1); w.put(1, 1); w.put(N - 2, 4); w.put(1, 1); w.sb(c[1], N); w.sb(c[2], N); }
        else { w.put(1, 1); w.put(0, 1); w.put(N - 2, 4); c.slice(1).forEach(v => w.sb(v, N)); }
    });
    w.put(0, 1); w.put(0, 5);
    return w.done();
}
// a GFX movie with one DefineFont3 (layout, wide codes)
function gfx(name, glyphs) {
    const shapes = glyphs.map(g => shape(g.cmds)), n = glyphs.length;
    const offs = [];
    let at = (n + 1) * 2;
    shapes.forEach(s => { offs.push(at); at += s.length; });
    const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }, s16 = (v) => { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; };
    const body = Buffer.concat([u16(1), Buffer.from([0x84, 0, name.length]), Buffer.from(name, 'latin1'), u16(n),
        Buffer.concat(offs.map(u16)), u16(at), Buffer.concat(shapes), Buffer.concat(glyphs.map(g => u16(g.code))),
        s16(19260), s16(3900), s16(0), Buffer.concat(glyphs.map(g => s16(g.adv))), Buffer.alloc(n), u16(0)]);
    const tag = (code, data) => { const h = Buffer.alloc(6); h.writeUInt16LE((code << 6) | 63); h.writeUInt32LE(data.length, 2); return Buffer.concat([h, data]); };
    const movie = Buffer.concat([Buffer.from([0]), Buffer.from([0, 24, 1, 0]), tag(75, body), Buffer.from([0, 0])]);
    const head = Buffer.alloc(8); head.write('GFX', 0, 'latin1'); head[3] = 10; head.writeUInt32LE(8 + movie.length, 4);
    return Buffer.concat([head, movie]);
}
const GLYPHS = [
    // A: a square with a square hole (drawn the other way round)
    { code: 65, adv: 11000, cmds: [['m', 0, 0], ['l', 10000, 0], ['l', 0, -10000], ['l', -10000, 0], ['l', 0, 10000],
        ['m', 2000, -2000], ['l', 0, -6000], ['l', 6000, 0], ['l', 0, 6000], ['l', -6000, 0]] },
    // b: one curve and a line back
    { code: 98, adv: 9000, cmds: [['m', 0, 0], ['c', 5000, -10000, 5000, 10000], ['l', -10000, 0]] },
    { code: 32, adv: 3000, cmds: [] }
];
// the tables of a TrueType file -> { tag: Buffer }
function tables(f) {
    const n = f.readUInt16BE(4), t = {};
    for (let i = 0; i < n; i++) { const e = 12 + i * 16; t[f.toString('latin1', e, e + 4)] = f.subarray(f.readUInt32BE(e + 8), f.readUInt32BE(e + 8) + f.readUInt32BE(e + 12)); }
    return t;
}

test('the District font: Scaleform DefineFont3 glyphs become a TrueType font', () => {
    const [f] = OA.gfxFonts(gfx('DistrictTF-RegularItalic', GLYPHS));
    assert.equal(f.name, 'DistrictTF-RegularItalic');
    assert.deepEqual([f.ascent, f.descent], [963, 195]);
    assert.deepEqual(f.glyphs.map(g => [g.code, g.adv, g.contours.length]), [[65, 550, 2], [98, 450, 1], [32, 150, 0]]);
    // y up in the font, the closing point dropped
    assert.deepEqual(f.glyphs[0].contours[0].map(p => [p.x, p.y]), [[0, 0], [500, 0], [500, 500], [0, 500]]);
    assert.deepEqual(f.glyphs[1].contours[0].map(p => p.on), [true, false, true]);
    const font = OA.ttf(f, 'FC OE District'), t = tables(font);
    assert.equal(font.readUInt32BE(0), 0x10000);
    ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'].forEach(k => assert.ok(t[k], k));
    assert.equal(t.head.readUInt16BE(18), 1024, 'units per em');
    assert.equal(t.head.readUInt32BE(12), 0x5f0f3cf5);
    assert.equal(t.maxp.readUInt16BE(4), 4, '.notdef + 3 glyphs');
    // the whole file sums to the magic number once checkSumAdjustment is in
    let sum = 0;
    for (let i = 0; i < font.length; i += 4) sum = (sum + font.readUInt32BE(i)) >>> 0;
    assert.equal(sum, 0xb1b0afba);
    // cmap format 4: 'A' -> glyph 1, 'b' -> 2, ' ' -> 3
    const sub = t.cmap.subarray(t.cmap.readUInt32BE(8)), sc = sub.readUInt16BE(6) / 2;
    const look = (c) => {
        for (let i = 0; i < sc; i++) {
            const end = sub.readUInt16BE(14 + i * 2), start = sub.readUInt16BE(16 + sc * 2 + i * 2);
            if (c >= start && c <= end) return (c + sub.readUInt16BE(16 + sc * 4 + i * 2)) & 0xffff;
        }
        return 0;
    };
    assert.deepEqual([look(65), look(98), look(32), look(66)], [1, 2, 3, 0]);
    // glyph 1: 2 contours, 8 points; the space has no outline; advances in hmtx
    const loca = (i) => t.loca.readUInt32BE(i * 4);
    assert.equal(t.glyf.readInt16BE(loca(1)), 2);
    assert.equal(t.glyf.readUInt16BE(loca(1) + 12), 7, 'the last point of the second contour');
    assert.equal(loca(4) - loca(3), 0, 'the space');
    assert.deepEqual([t.hmtx.readUInt16BE(4), t.hmtx.readUInt16BE(12)], [550, 150]);
    assert.ok(Buffer.from(t.name).swap16().toString('utf16le').indexOf('FC OE District') >= 0);
    assert.deepEqual(OA.gfxFonts(Buffer.from('not a movie')), []);
});

test('the import, 3.11: the menus’ look (font, select bar, panel, scanlines)', async () => {
    const g = fakeGame(), out = path.join(g.root, 'out');
    try {
        const usrZip = path.join(g.usr, 'zip');
        fs.writeFileSync(path.join(usrZip, 'font.wad.zip'), zip([['font/font_lib.gfx', gfx('DistrictTF-RegularItalic', GLYPHS), true]]));
        fs.writeFileSync(path.join(usrZip, 'startscreen.wad.zip'), zip([['startscreen/genericPopup_I33.dds', dds(1, 1, 'BGRA', [0, 200, 220, 255]), false]]));
        fs.writeFileSync(path.join(usrZip, 'screens.zip'), zip([['flash/howToPlay_I5B.dds', dds(1, 1, 'BGRA', [20, 20, 20, 255]), false]]));
        fs.mkdirSync(path.join(g.usr, 'textures'));
        fs.writeFileSync(path.join(g.usr, 'textures', 'scanlines.gtf'), gtf(4, 4, 0xa8, [255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        const r = await OA.importFrom(g.usr, null, out);
        assert.deepEqual(r.theme, { font: true, bar: true, panel: true, scan: true }, 'no numbers font in this copy: left out');
        assert.equal(fs.readFileSync(path.join(out, 'theme', 'district.ttf')).readUInt32BE(0), 0x10000);
        ['bar.png', 'panel.png', 'scan.png'].forEach(n => assert.equal(fs.readFileSync(path.join(out, 'theme', n)).readUInt32BE(12), 0x49484452, n));
        // a copy without some of them: those left out, the rest still read
        fs.unlinkSync(path.join(usrZip, 'font.wad.zip'));
        fs.unlinkSync(path.join(usrZip, 'screens.zip'));
        const r2 = await OA.importFrom(g.usr, null, out);
        assert.deepEqual(r2.theme, { bar: true, scan: true });
        assert.deepEqual(r2.chars.sort(), ['chunli', 'ken']);
    } finally { fs.rmSync(g.root, { recursive: true, force: true }); }
});

// the real thing, on a PC that has the user's menu dump (never in the repo)
const REAL = path.join(os.homedir(), 'Downloads', 'SF3_Online_Edition_Trial_Menu_Assets', 'flash_menu_movies', 'font', 'font_lib.gfx');
test('the game’s own font_lib.gfx (only on a PC that has it)', { skip: !fs.existsSync(REAL) }, () => {
    const it = OA.gfxFonts(fs.readFileSync(REAL)).find(f => f.name === 'DistrictTF-RegularItalic');
    assert.ok(it);
    assert.equal(it.glyphs.length, 220);
    const A = it.glyphs.find(g => g.code === 65);
    assert.ok(A.adv > 400 && A.adv < 900 && A.contours.length === 2);
    assert.equal(tables(OA.ttf(it, 'FC OE District')).maxp.readUInt16BE(4), 221);
});
