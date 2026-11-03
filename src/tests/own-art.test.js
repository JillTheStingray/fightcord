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
