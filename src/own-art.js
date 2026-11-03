/**
 * Fightcord: your own 3rd Strike art (3.10)
 *
 * Off until you point it at your own copy of Street Fighter III: 3rd Strike Online Edition (the PS3
 * game's folder, e.g. RPCS3's dev_hdd0\game\NPEB00554). Fightcord reads the character art and four
 * jingles from it once, saves them as PNG / MP3 in the "own-art" folder next to this plugin, and uses
 * them on your screen only: full-body art on the VS and result screens, the character busts as
 * character faces (cards, the matchup guide, mains), the jingles on the match screens. Nothing is
 * uploaded or shared, and Fightcord ships none of it: without the game, there's nothing.
 *
 * What it reads (USRDIR\...): zip\mainmenu.zip (flashtextures/mainmenu/<char>.dds, the full-body art),
 * flashtextures\ColorPackIcons\ColorpakDefault_<Char>_A.dds (the busts), Sound\BGM\51_VS / 55_Win /
 * 59_over / 57_S_Sel.mp3 (MP3 behind a 64-byte PS3 "MSF" header). The textures are DXT5 / 32-bit DDS,
 * decoded here (no Fightcade or browser support for DDS).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zl = () => require('zlib');      // (only when reading: the dev harness has none)

let fc = null;
let store = null, cfg = null;            // own-art-config.json
const OUT = path.join(__dirname, 'own-art');
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const E = (s) => fc.fmt.esc(s);

/* ------------------------------------------------------------- DDS -> PNG */

// -> { w, h, fmt } or null
function ddsInfo(buf) {
    if (!buf || buf.length < 128 || buf.toString('ascii', 0, 4) !== 'DDS ') return null;
    const h = buf.readUInt32LE(12), w = buf.readUInt32LE(16), pf = buf.readUInt32LE(80);
    const four = buf.toString('ascii', 84, 88);
    let fmt = '';
    if (pf & 4) fmt = four === 'DXT1' || four === 'DXT3' || four === 'DXT5' ? four : '';
    else if (buf.readUInt32LE(88) === 32) fmt = buf.readUInt32LE(92) === 0xff0000 ? 'BGRA' : 'RGBA';
    return fmt && w > 0 && h > 0 && w <= 8192 && h <= 8192 ? { w, h, fmt } : null;
}

const c565 = (c, out, o) => {
    out[o] = ((c >> 11) & 31) * 255 / 31 | 0;
    out[o + 1] = ((c >> 5) & 63) * 255 / 63 | 0;
    out[o + 2] = (c & 31) * 255 / 31 | 0;
};

// one 4x4 colour block (8 bytes at p); DXT1 sets alpha too (its 3-colour mode has a clear colour)
function colourBlock(b, p, rgba, w, h, bx, by, dxt1) {
    const c0 = b.readUInt16LE(p), c1 = b.readUInt16LE(p + 2), bits = b.readUInt32LE(p + 4);
    const pal = new Uint8Array(16);
    c565(c0, pal, 0); c565(c1, pal, 4);
    pal[3] = pal[7] = 255;
    if (c0 > c1 || !dxt1) {
        for (let i = 0; i < 3; i++) { pal[8 + i] = (2 * pal[i] + pal[4 + i]) / 3 | 0; pal[12 + i] = (pal[i] + 2 * pal[4 + i]) / 3 | 0; }
        pal[11] = pal[15] = 255;
    } else {
        for (let i = 0; i < 3; i++) pal[8 + i] = (pal[i] + pal[4 + i]) / 2 | 0;
        pal[11] = 255; pal[15] = 0;
    }
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const px = bx + x, py = by + y;
        if (px >= w || py >= h) continue;
        const k = (bits >>> (2 * (y * 4 + x))) & 3, o = (py * w + px) * 4;
        rgba[o] = pal[k * 4]; rgba[o + 1] = pal[k * 4 + 1]; rgba[o + 2] = pal[k * 4 + 2];
        if (dxt1) rgba[o + 3] = pal[k * 4 + 3];
    }
}

// the first mip level -> { w, h, rgba } or null
function decodeDds(buf) {
    const info = ddsInfo(buf);
    if (!info) return null;
    const { w, h, fmt } = info, rgba = new Uint8Array(w * h * 4);
    let p = 128;
    if (fmt === 'BGRA' || fmt === 'RGBA') {
        if (buf.length < p + w * h * 4) return null;
        const r = fmt === 'BGRA' ? 2 : 0, b = 2 - r;
        for (let i = 0; i < w * h; i++, p += 4) { const o = i * 4; rgba[o] = buf[p + r]; rgba[o + 1] = buf[p + 1]; rgba[o + 2] = buf[p + b]; rgba[o + 3] = buf[p + 3]; }
        return { w, h, rgba };
    }
    const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), size = fmt === 'DXT1' ? 8 : 16;
    if (buf.length < p + bw * bh * size) return null;
    const al = new Uint8Array(16), apal = new Uint8Array(8);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, p += size) {
        const X = bx * 4, Y = by * 4;
        if (fmt === 'DXT1') { colourBlock(buf, p, rgba, w, h, X, Y, true); continue; }
        colourBlock(buf, p + 8, rgba, w, h, X, Y, false);
        if (fmt === 'DXT3') {
            for (let i = 0; i < 16; i++) al[i] = ((buf[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
        } else {
            // DXT5: two end points, then 16 3-bit indices (48 bits, read as two 24-bit halves)
            const a0 = buf[p], a1 = buf[p + 1];
            apal[0] = a0; apal[1] = a1;
            if (a0 > a1) for (let i = 1; i < 7; i++) apal[i + 1] = ((7 - i) * a0 + i * a1) / 7 | 0;
            else { for (let i = 1; i < 5; i++) apal[i + 1] = ((5 - i) * a0 + i * a1) / 5 | 0; apal[6] = 0; apal[7] = 255; }
            const lo = buf[p + 2] | (buf[p + 3] << 8) | (buf[p + 4] << 16), hi = buf[p + 5] | (buf[p + 6] << 8) | (buf[p + 7] << 16);
            for (let i = 0; i < 8; i++) { al[i] = apal[(lo >> (3 * i)) & 7]; al[i + 8] = apal[(hi >> (3 * i)) & 7]; }
        }
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
            const px = X + x, py = Y + y;
            if (px < w && py < h) rgba[(py * w + px) * 4 + 3] = al[y * 4 + x];
        }
    }
    return { w, h, rgba };
}

// the part that isn't see-through -> { x, y, w, h } (all of it when it's all clear)
function opaqueBox(img, min) {
    const { w, h, rgba } = img, t = min == null ? 8 : min;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (rgba[(y * w + x) * 4 + 3] <= t) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
    }
    return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function crop(img, box) {
    const out = new Uint8Array(box.w * box.h * 4);
    for (let y = 0; y < box.h; y++) out.set(img.rgba.subarray(((box.y + y) * img.w + box.x) * 4, ((box.y + y) * img.w + box.x + box.w) * 4), y * box.w * 4);
    return { w: box.w, h: box.h, rgba: out };
}

let crcTable = null;
function crc32(b) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
// { w, h, rgba } -> PNG (8-bit RGBA, one IDAT)
function png(img) {
    const { w, h, rgba } = img, row = w * 4 + 1, raw = Buffer.alloc(row * h);
    for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * row + 1);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zl().deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ---------------------------------------------------------- zip, MSF, folders */

// a zip's files -> [{ name, method, csize, size, off }] (the central directory; no zip64)
function zipEntries(buf) {
    let e = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) return [];
    const n = buf.readUInt16LE(e + 10), out = [];
    let p = buf.readUInt32LE(e + 16);
    for (let k = 0; k < n && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; k++) {
        const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
        out.push({ name: buf.toString('utf8', p + 46, p + 46 + nl), method: buf.readUInt16LE(p + 10), csize: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24), off: buf.readUInt32LE(p + 42) });
        p += 46 + nl + xl + cl;
    }
    return out;
}
function zipRead(buf, en) {
    const p = en.off;
    if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) return null;
    const s = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28), raw = buf.subarray(s, s + en.csize);
    return en.method === 0 ? Buffer.from(raw) : en.method === 8 ? zl().inflateRawSync(raw) : null;
}

// the game's sound files: MP3 behind a 64-byte "MSF" header (as they are when there's none)
const stripMsf = (buf) => (buf && buf.length > 64 && buf.toString('ascii', 0, 3) === 'MSF' ? buf.subarray(64) : buf);

// "Chun-Li" / "chun-li" / "ChunLi" -> "chunli"
const charKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// (Fightcade's Node 12 has no fs.rmSync)
function rmTree(p) {
    if (!fs.existsSync(p)) return;
    if (fs.rmSync) fs.rmSync(p, { recursive: true, force: true });
    else fs.rmdirSync(p, { recursive: true });
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
const isGame = (dir) => { try { return fs.statSync(path.join(dir, 'zip', 'mainmenu.zip')).isFile(); } catch (e) { return false; } };
// the folder you picked -> its USRDIR ('' = no 3rd Strike Online Edition there). Takes the USRDIR itself,
// the game's folder (NPEB00554 / NPUB30535 ...), RPCS3's game folder, dev_hdd0 or RPCS3's own folder
function findUsrdir(dir) {
    if (!dir || !isDir(dir)) return '';
    if (isGame(dir)) return dir;
    if (isGame(path.join(dir, 'USRDIR'))) return path.join(dir, 'USRDIR');
    for (const base of [dir, path.join(dir, 'game'), path.join(dir, 'dev_hdd0', 'game')]) {
        let names = [];
        try { names = fs.readdirSync(base); } catch (e) { continue; }
        for (const n of names) { const u = path.join(base, n, 'USRDIR'); if (isGame(u)) return u; }
    }
    return '';
}

/* ---------------------------------------------------------------- reading */

const SOUNDS = { vs: '51_VS', win: '55_Win', lose: '59_over', draw: '57_S_Sel' };
const tick = () => new Promise(r => setTimeout(r, 0));

// reads the game once into OUT (or dest) -> { from, at, chars: [key], faces: [key], sounds: [kind] }
async function importFrom(usr, onStep, dest) {
    const to = dest || OUT;
    const step = (t) => { if (onStep) onStep(t); };
    const tmp = to + '.new';
    rmTree(tmp);
    ['full', 'face', 'sound'].forEach(d => fs.mkdirSync(path.join(tmp, d), { recursive: true }));
    const out = { from: usr, at: Date.now(), chars: [], faces: [], sounds: [] };
    // the full-body art
    const zip = fs.readFileSync(path.join(usr, 'zip', 'mainmenu.zip'));
    const arts = zipEntries(zip).filter(e => /^flashtextures\/mainmenu\/[^/]+\.dds$/i.test(e.name));
    for (let i = 0; i < arts.length; i++) {
        step(T('Character art {n} of {total}', { n: i + 1, total: arts.length }));
        await tick();
        const img = decodeDds(zipRead(zip, arts[i]) || Buffer.alloc(0));
        if (!img) continue;
        const k = charKey(path.basename(arts[i].name, path.extname(arts[i].name)));
        fs.writeFileSync(path.join(tmp, 'full', k + '.png'), png(crop(img, opaqueBox(img))));
        out.chars.push(k);
    }
    // the busts (the default colour; any colour when there's no default A)
    const iconDir = path.join(usr, 'flashtextures', 'ColorPackIcons');
    let icons = [];
    try { icons = fs.readdirSync(iconDir); } catch (e) { /* no busts in this copy */ }
    const byChar = {};
    icons.forEach(n => {
        const m = /^Colorpak(Default|01)_([A-Za-z]+)_\s*([A-Z]+)\.dds$/i.exec(n);
        if (!m) return;
        const k = charKey(m[2]), rank = (m[1].toLowerCase() === 'default' ? 0 : 2) + (m[3].toUpperCase() === 'A' ? 0 : 1);
        if (!byChar[k] || rank < byChar[k].rank) byChar[k] = { n, rank };
    });
    const keys = Object.keys(byChar);
    for (let i = 0; i < keys.length; i++) {
        step(T('Character faces {n} of {total}', { n: i + 1, total: keys.length }));
        if (i % 4 === 0) await tick();
        const img = decodeDds(fs.readFileSync(path.join(iconDir, byChar[keys[i]].n)));
        if (!img) continue;
        fs.writeFileSync(path.join(tmp, 'face', keys[i] + '.png'), png(img));
        out.faces.push(keys[i]);
    }
    step(T('Jingles'));
    Object.keys(SOUNDS).forEach(kind => {
        try {
            fs.writeFileSync(path.join(tmp, 'sound', kind + '.mp3'), stripMsf(fs.readFileSync(path.join(usr, 'Sound', 'BGM', SOUNDS[kind] + '.mp3'))));
            out.sounds.push(kind);
        } catch (e) { /* not in this copy */ }
    });
    if (!out.chars.length && !out.faces.length) throw new Error(T('no character art found'));
    // swap the new folder in
    rmTree(to);
    fs.renameSync(tmp, to);
    return out;
}

/* ------------------------------------------------------------------- the API */

const urls = new Map();                  // file -> blob URL
function urlOf(file) {
    if (urls.has(file)) return urls.get(file);
    let u = '';
    try { u = URL.createObjectURL(new Blob([fs.readFileSync(file)], { type: 'image/png' })); } catch (e) { u = ''; }
    urls.set(file, u);
    return u;
}
function forget() { urls.forEach(u => { try { if (u) URL.revokeObjectURL(u); } catch (e) { /* gone */ } }); urls.clear(); }

const guide = () => fc.modules.get('matchup-guide');
// only 3rd Strike's characters (the guide knows which roms are 3rd Strike, and its spellings)
function keyFor(rom, ch) {
    const g = guide(), game = g && g.gameOf ? g.gameOf(rom) : null;
    if (!game || game.id !== '3s') return '';
    const e = g.find(rom, ch);
    return charKey(e ? e.name : ch);
}
const has = (list, k) => !!(k && cfg && cfg.imported && (cfg.imported[list] || []).indexOf(k) >= 0);

const api = {
    ready: () => !!(cfg && cfg.imported),
    // a blob URL for that character's full-body art / bust ('' = none, or that use is switched off)
    full(rom, ch) { const k = keyFor(rom, ch); return cfg.screens !== false && has('chars', k) ? urlOf(path.join(OUT, 'full', k + '.png')) : ''; },
    face(rom, ch) { const k = keyFor(rom, ch); return cfg.faces !== false && has('faces', k) ? urlOf(path.join(OUT, 'face', k + '.png')) : ''; },
    // a sound file for the match screens: vs / win / lose / draw ('' = none)
    sound(kind) { return cfg && cfg.sounds !== false && has('sounds', kind) ? path.join(OUT, 'sound', kind + '.mp3') : ''; },
    get _config() { return cfg; }
};

/* -------------------------------------------------------------- settings */

let busy = '';
function pickFolder() {
    let remote = null;
    try { remote = require('electron').remote; } catch (e) { /* harness */ }
    if (!remote || !remote.dialog) { fc.ui.toast(T('Folders can only be picked inside Fightcade'), { icon: 'warn' }); return; }
    remote.dialog.showOpenDialog(remote.getCurrentWindow(), { title: T('Your 3rd Strike Online Edition folder'), properties: ['openDirectory'], defaultPath: cfg.dir || undefined })
        .then(r => { if (r && !r.canceled && r.filePaths && r.filePaths[0]) readFrom(r.filePaths[0]); })
        .catch(e => fc.log('folder picker:', e.message));
}
async function readFrom(dir) {
    if (busy) return;
    const usr = findUsrdir(dir);
    if (!usr) { fc.ui.toast(T('No 3rd Strike Online Edition in that folder (Fightcord looks for USRDIR/zip/mainmenu.zip)'), { icon: 'warn', kind: 'warning' }); return; }
    busy = T('Reading…');
    fc.settings.refresh('own-art');
    try {
        const r = await importFrom(usr, (t) => { busy = t; fc.settings.refresh('own-art'); });
        forget();
        cfg.dir = dir;
        cfg.imported = r;
        store.save();
        fc.ui.toast(T('Your 3rd Strike art is ready: {n} characters', { n: r.chars.length || r.faces.length }), { icon: 'check', kind: 'success' });
        fc.emit('own-art:changed', {});
    } catch (e) {
        fc.ui.toast(T('Reading the game didn’t work: {why}', { why: e.message }), { icon: 'warn', kind: 'danger' });
    }
    busy = '';
    fc.settings.refresh('own-art');
}
function removeAll() {
    forget();
    try { rmTree(OUT); } catch (e) { fc.log('own-art remove:', e.message); }
    cfg.imported = null;
    store.save();
    fc.emit('own-art:changed', {});
    fc.settings.refresh('own-art');
}

function stateHtml() {
    const im = cfg.imported;
    if (busy) return `<div class="oaState">${E(busy)}</div>`;
    if (!im) return `<div class="oaState">${E(T('Not set up'))}</div>`;
    const faces = (im.faces || []).slice(0, 12).map(k => `<img src="${E(urlOf(path.join(OUT, 'face', k + '.png')))}" alt="" title="${E(k)}">`).join('');
    return `<div class="oaState">${E(T('{n} characters and {s} jingles, read from {dir}', { n: (im.chars || []).length || (im.faces || []).length, s: (im.sounds || []).length, dir: im.from }))}</div><div class="oaFaces">${faces}</div>`;
}

const CSS = `
.oaState { margin: 8px 0; font-size: var(--fc-fs-sm); color: var(--fc-text); word-break: break-all; }
.oaFaces { display: flex; flex-wrap: wrap; margin: 0 -2px 8px; }
.oaFaces img { width: 36px; height: 36px; margin: 2px; border-radius: var(--fc-r1); object-fit: cover; object-position: 50% 0; background: var(--fc-tint-2); }
`;

function start(f) {
    fc = f;
    store = fc.config('own-art', { dir: '', imported: null, screens: true, faces: true, sounds: true });
    cfg = store.data;
    // the files went away (deleted by hand): nothing to use
    if (cfg.imported && !isDir(OUT)) { cfg.imported = null; store.save(); }
    fc.ui.style('oaStyle', CSS);
    fc.own(() => { fc.ui.style('oaStyle', null); forget(); });
    const on = (x) => !!x.imported;
    fc.settings.block({ id: 'own-art', section: 'match', title: 'Your 3rd Strike art', hint: '— from your own copy of 3rd Strike Online Edition', store, order: 60,
        fields: [
            { type: 'note', label: 'Point Fightcord at the game’s folder (in RPCS3: dev_hdd0/game/NPEB00554 or similar). Its character art and jingles then show on your screen only: on the VS and result screens, as character faces, and as match screen sounds. Nothing is uploaded or shared, and Fightcord ships none of it.' },
            { type: 'html', id: 'oa-state', html: () => stateHtml() },
            { type: 'button', act: 'oa-pick', label: 'The game’s folder', button: 'Choose the folder', onClick: () => pickFolder() },
            { type: 'button', act: 'oa-again', label: 'Read it again', hint: 'After an update of the game, or if something’s missing', button: 'Read it again', show: (x) => on(x) && !!x.dir, onClick: () => { if (cfg.dir) readFrom(cfg.dir); } },
            { type: 'button', act: 'oa-rm', label: 'Remove the copied art', hint: 'Deletes Fightcord’s copies (the game stays as it is)', button: 'Remove', kind: 'ghost', show: on, onClick: () => removeAll() },
            { key: 'screens', type: 'switch', label: 'On the VS and result screens', hint: 'Both characters’ full-body art, when Fightcord knows who you picked', show: on, onChange: () => fc.emit('own-art:changed', {}) },
            { key: 'faces', type: 'switch', label: 'As character faces', hint: 'Cards, the matchup guide and mains, instead of the wiki’s pictures', show: on, onChange: () => fc.emit('own-art:changed', {}) },
            { key: 'sounds', type: 'switch', label: 'Its jingles on the match screens', hint: 'VS, win, lose and draw. Your own files in the match-screens folder still come first', show: on }
        ] });
    fc.log(cfg.imported ? 'ready, ' + (cfg.imported.chars || []).length + ' characters' : 'not set up');
    return api;
}

module.exports = {
    id: 'own-art', name: 'Your 3rd Strike art', start,
    ddsInfo, decodeDds, opaqueBox, crop, png, crc32, zipEntries, zipRead, stripMsf, charKey, findUsrdir, importFrom, SOUNDS
};
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
