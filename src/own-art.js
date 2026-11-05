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
 * 3.11: also the character-select portraits, ovals and names and the VS background (zip\hirez.wad.zip,
 * PS3 GTF textures), the trial banners (zip\trials.wad.zip), and the Vault's concept art (a gallery; each
 * picture is read from the game when you open it, never copied). And the menus' look for the Online
 * Edition Look (discord-theme.js): the District font (zip\font.wad.zip, turned into TrueType here), the
 * select bar, a panel and the scanlines.
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
const N_ = (s) => s;                     // translated where it's shown

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

/* ------------------------------------------------------------ GTF, atlases */

// a DDS header around raw DXT blocks (the PS3 stores them the same way)
function makeDds(w, h, four, data) {
    const b = Buffer.alloc(128);
    b.write('DDS ', 0, 'ascii');
    b.writeUInt32LE(124, 4); b.writeUInt32LE(h, 12); b.writeUInt32LE(w, 16);
    b.writeUInt32LE(4, 80); b.write(four, 84, 'ascii');
    return Buffer.concat([b, data]);
}
// where pixel (x, y) is in an RSX-swizzled texture (Morton order; x first, then y, while each fits)
function mortonIndex(x, y, w, h) {
    let idx = 0, bit = 0;
    for (let k = 0; (1 << k) < w || (1 << k) < h; k++) {
        if ((1 << k) < w) idx |= ((x >> k) & 1) << bit++;
        if ((1 << k) < h) idx |= ((y >> k) & 1) << bit++;
    }
    return idx;
}
// PS3 textures: a 12-byte header (version, size, count) and 0x24-byte CellGcmTexture entries,
// big-endian -> [{ w, h, rgba }]. DXT1/3/5 and A8R8G8B8; anything else is left out
function decodeGtf(buf) {
    const out = [];
    if (!buf || buf.length < 12) return out;
    const n = buf.readUInt32BE(8);
    for (let i = 0; i < n && 12 + (i + 1) * 0x24 <= buf.length; i++) {
        const e = 12 + i * 0x24;
        const off = buf.readUInt32BE(e + 4), size = buf.readUInt32BE(e + 8);
        const fmt = buf[e + 12], w = buf.readUInt16BE(e + 20), h = buf.readUInt16BE(e + 22), pitch = buf.readUInt32BE(e + 28);
        const tex = buf.subarray(off, off + size), base = fmt & ~0x60, linear = !!(fmt & 0x20);
        if (!w || !h) continue;
        if (base >= 0x86 && base <= 0x88) {
            const bs = base === 0x86 ? 8 : 16, lvl = Math.ceil(w / 4) * Math.ceil(h / 4) * bs;
            const img = tex.length >= lvl ? decodeDds(makeDds(w, h, ['DXT1', 'DXT3', 'DXT5'][base - 0x86], tex.subarray(0, lvl))) : null;
            if (img) out.push(img);
        } else if (base === 0x85) {
            const row = linear && pitch ? pitch : w * 4;
            if (tex.length < (linear ? row * (h - 1) + w * 4 : w * h * 4)) continue;
            const rgba = new Uint8Array(w * h * 4);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                const p = linear ? y * row + x * 4 : mortonIndex(x, y, w, h) * 4, o = (y * w + x) * 4;
                rgba[o] = tex[p + 1]; rgba[o + 1] = tex[p + 2]; rgba[o + 2] = tex[p + 3]; rgba[o + 3] = tex[p];      // ARGB -> RGBA
            }
            out.push({ w, h, rgba });
        }
    }
    return out;
}

// the separate opaque shapes on a sheet (name plates, ovals) -> [{ x, y, w, h }], each a connected area
// of a 4x-smaller mask, then tightened to the real pixels. Specks under 4 mask cells don't count
function boxes(img, min) {
    const S = 4, t = min == null ? 16 : min, gw = Math.ceil(img.w / S), gh = Math.ceil(img.h / S);
    const mask = new Uint8Array(gw * gh);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.rgba[(y * img.w + x) * 4 + 3] > t) mask[((y / S) | 0) * gw + ((x / S) | 0)] = 1;
    const seen = new Uint8Array(gw * gh), out = [];
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || seen[i]) continue;
        let x0 = gw, y0 = gh, x1 = -1, y1 = -1, cells = 0;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
            const c = stack.pop(), cx = c % gw, cy = (c / gw) | 0;
            cells++;
            if (cx < x0) x0 = cx;
            if (cx > x1) x1 = cx;
            if (cy < y0) y0 = cy;
            if (cy > y1) y1 = cy;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = cx + dx, ny = cy + dy, ni = ny * gw + nx;
                if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && mask[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
            }
        }
        if (cells < 4) continue;
        const rough = { x: x0 * S, y: y0 * S, w: Math.min(img.w, (x1 + 1) * S) - x0 * S, h: Math.min(img.h, (y1 + 1) * S) - y0 * S };
        const tight = opaqueBox(crop(img, rough), t);
        out.push({ x: rough.x + tight.x, y: rough.y + tight.y, w: tight.w, h: tight.h });
    }
    return out;
}
// the names sheet: two columns of plates, top to bottom -> { key: box } (null when the count is off,
// so a name is never put on the wrong character)
function splitNames(img, left, right) {
    const bs = boxes(img), mid = img.w / 2;
    const L = bs.filter(b => b.x + b.w / 2 < mid).sort((a, b) => a.y - b.y), R = bs.filter(b => b.x + b.w / 2 >= mid).sort((a, b) => a.y - b.y);
    if (L.length !== left.length || R.length !== right.length) return null;
    const out = {};
    left.forEach((k, i) => { out[k] = L[i]; });
    right.forEach((k, i) => { out[k] = R[i]; });
    return out;
}
// the ovals sheet: rows, then left to right -> { key: box } (null when the count is off)
function splitOvals(img, order) {
    const bs = boxes(img).sort((a, b) => a.y - b.y), rows = [];
    bs.forEach(b => { const r = rows.find(r => b.y < r.y + r.h / 2); if (r) r.items.push(b); else rows.push({ y: b.y, h: b.h, items: [b] }); });
    const flat = [].concat(...rows.map(r => r.items.sort((a, b) => a.x - b.x)));
    if (flat.length !== order.length) return null;
    const out = {};
    order.forEach((k, i) => { out[k] = flat[i]; });
    return out;
}
// half the size (or less) by averaging, until it fits in max (for a concept picture used as a background)
function shrink(img, max) {
    let cur = img;
    while (Math.max(cur.w, cur.h) > max) {
        const w = Math.floor(cur.w / 2), h = Math.floor(cur.h / 2), o = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
            const p = (sx, sy) => cur.rgba[((2 * y + sy) * cur.w + 2 * x + sx) * 4 + c];
            o[(y * w + x) * 4 + c] = (p(0, 0) + p(1, 0) + p(0, 1) + p(1, 1)) >> 2;
        }
        cur = { w, h, rgba: o };
    }
    return cur;
}

/* ------------------------------------------------- Scaleform font -> TrueType */

// 3.11: the menus' District font. font_lib.gfx is a Scaleform movie (a SWF with a GFX header) whose
// DefineFont3 tags hold every glyph as quadratic curves on a 1024 x 20 em -- the same curves TrueType
// stores, so they're written into a .ttf as they are.
function bitReader(b, at) {
    let bit = at * 8;
    const ub = (n) => { let v = 0; for (let i = 0; i < n; i++, bit++) v = v * 2 + ((b[bit >> 3] >> (7 - (bit & 7))) & 1); return v; };
    const sb = (n) => { const v = ub(n); return n && v >= 2 ** (n - 1) ? v - 2 ** n : v; };
    return { ub, sb, align: () => { bit = Math.ceil(bit / 8) * 8; }, get byte() { return bit >> 3; } };
}

// one glyph's SHAPE -> contours [[{ x, y, on }]] in font units (y up)
function glyphContours(b, at) {
    const r = bitReader(b, at), fb = r.ub(4), lb = r.ub(4), out = [];
    let x = 0, y = 0, cur = null;
    const pt = (px, py, on) => cur.push({ x: Math.round(px / 20), y: 0 - Math.round(py / 20), on });
    const begin = () => { cur = []; out.push(cur); pt(x, y, true); };
    for (let guard = 0; guard < 100000; guard++) {
        if (!r.ub(1)) {
            const fl = r.ub(5);
            if (!fl) break;
            if (fl & 1) { const n = r.ub(5); x = r.sb(n); y = r.sb(n); cur = null; }
            if (fl & 2) r.ub(fb);
            if (fl & 4) r.ub(fb);
            if (fl & 8) r.ub(lb);
            if (fl & 16) return out;           // new styles: not in a font
            continue;
        }
        if (!cur) begin();
        const straight = r.ub(1), n = r.ub(4) + 2;
        if (straight) {
            if (r.ub(1)) { x += r.sb(n); y += r.sb(n); } else if (r.ub(1)) y += r.sb(n); else x += r.sb(n);
            pt(x, y, true);
        } else {
            x += r.sb(n); y += r.sb(n); pt(x, y, false);
            x += r.sb(n); y += r.sb(n); pt(x, y, true);
        }
    }
    // closed by TrueType itself: the last point is the first one again
    return out.map(c => { const a = c[0], z = c[c.length - 1]; return c.length > 1 && a.x === z.x && a.y === z.y ? c.slice(0, -1) : c; })
        .filter(c => c.length > 2);
}

// a GFX / SWF movie -> its DefineFont3 fonts [{ name, italic, ascent, descent, leading, glyphs: [{ code, adv, contours }] }]
function gfxFonts(buf) {
    let b = buf;
    if (/^[CF]WS|^CFX/.test(b.toString('latin1', 0, 3))) b = Buffer.concat([b.subarray(0, 8), zl().inflateSync(b.subarray(8))]);
    else if (!/^(GFX|FWS)/.test(b.toString('latin1', 0, 3))) return [];
    let p = 8 + Math.ceil((5 + (b[8] >> 3) * 4) / 8) + 4;
    const fonts = [];
    while (p + 2 <= b.length) {
        const h = b.readUInt16LE(p); p += 2;
        const code = h >> 6;
        let len = h & 63;
        if (len === 63) { len = b.readUInt32LE(p); p += 4; }
        if (code === 0) break;
        if (code === 75) try { fonts.push(defineFont3(b, p)); } catch (e) { /* a broken font: skipped */ }
        p += len;
    }
    return fonts;
}
function defineFont3(b, p) {
    const fl = b[p + 2], nl = b[p + 4], wide = fl & 8;
    const name = b.toString('latin1', p + 5, p + 5 + nl).replace(/\0+$/, '');
    let q = p + 5 + nl;
    const n = b.readUInt16LE(q); q += 2;
    const ot = q, offs = [];
    for (let i = 0; i <= n; i++) { offs.push(wide ? b.readUInt32LE(q) : b.readUInt16LE(q)); q += wide ? 4 : 2; }
    let c = ot + offs[n];
    const glyphs = [];
    for (let i = 0; i < n; i++) { glyphs.push({ code: (fl & 4) ? b.readUInt16LE(c) : b[c], adv: 0, contours: glyphContours(b, ot + offs[i]) }); c += (fl & 4) ? 2 : 1; }
    const f = { name, italic: !!(fl & 2), ascent: 800, descent: 200, leading: 0, glyphs };
    if (fl & 0x80) {
        f.ascent = Math.round(b.readInt16LE(c) / 20); f.descent = Math.round(b.readInt16LE(c + 2) / 20); f.leading = Math.round(b.readInt16LE(c + 4) / 20);
        for (let i = 0; i < n; i++) glyphs[i].adv = Math.round(b.readInt16LE(c + 6 + i * 2) / 20);
    }
    return f;
}

// a font from gfxFonts -> a TrueType file (Buffer) a browser's FontFace takes
function ttf(f, family) {
    const glyphs = [{ code: -1, adv: Math.round(f.ascent / 2), contours: [] }].concat(f.glyphs.filter(g => g.code > 0 && g.code < 0xffff));
    const fam = family || f.name;
    const u16 = (v) => { const x = Buffer.alloc(2); x.writeUInt16BE(v & 0xffff); return x; };
    const i16 = (v) => { const x = Buffer.alloc(2); x.writeInt16BE(Math.max(-32768, Math.min(32767, v))); return x; };
    const u32 = (v) => { const x = Buffer.alloc(4); x.writeUInt32BE(v >>> 0); return x; };
    const cat = (a) => Buffer.concat(a);
    // glyf + loca
    let maxPts = 0, maxCt = 0, xMin = 0, yMin = 0, xMax = 0, yMax = 0, advMax = 0, minR = 0;
    const glyf = [], loca = [0], metrics = [];
    glyphs.forEach(g => {
        const pts = [].concat(...g.contours);
        advMax = Math.max(advMax, g.adv);
        if (!pts.length) { metrics.push([g.adv, 0]); loca.push(loca[loca.length - 1]); return; }
        const gx0 = Math.min(...pts.map(p => p.x)), gy0 = Math.min(...pts.map(p => p.y)), gx1 = Math.max(...pts.map(p => p.x)), gy1 = Math.max(...pts.map(p => p.y));
        xMin = Math.min(xMin, gx0); yMin = Math.min(yMin, gy0); xMax = Math.max(xMax, gx1); yMax = Math.max(yMax, gy1);
        minR = Math.min(minR, g.adv - gx1);
        maxPts = Math.max(maxPts, pts.length); maxCt = Math.max(maxCt, g.contours.length);
        let end = -1, px = 0, py = 0;
        const parts = [i16(g.contours.length), i16(gx0), i16(gy0), i16(gx1), i16(gy1)];
        g.contours.forEach(c => { end += c.length; parts.push(u16(end)); });
        parts.push(u16(0));                    // no instructions
        parts.push(Buffer.from(pts.map(p => (p.on ? 1 : 0))));
        const xs = [], ys = [];
        pts.forEach(p => { xs.push(i16(p.x - px)); ys.push(i16(p.y - py)); px = p.x; py = p.y; });
        let data = cat(parts.concat(xs, ys));
        if (data.length % 2) data = cat([data, Buffer.alloc(1)]);
        glyf.push(data);
        loca.push(loca[loca.length - 1] + data.length);
        metrics.push([g.adv, gx0]);
    });
    // cmap: format 4, one segment per character (+ the closing 0xFFFF one)
    const map = glyphs.map((g, i) => [g.code, i]).filter(m => m[0] >= 0).sort((a, b) => a[0] - b[0]);
    const segs = map.map(m => [m[0], m[0], (m[1] - m[0]) & 0xffff]).concat([[0xffff, 0xffff, 1]]);
    const sc = segs.length, er = Math.floor(Math.log2(sc)), sr = 2 * 2 ** er;
    const sub = cat([u16(4), u16(16 + sc * 8), u16(0), u16(sc * 2), u16(sr), u16(er), u16(sc * 2 - sr),
        cat(segs.map(s => u16(s[1]))), u16(0), cat(segs.map(s => u16(s[0]))), cat(segs.map(s => u16(s[2]))), cat(segs.map(() => u16(0)))]);
    const cmap = cat([u16(0), u16(1), u16(3), u16(1), u32(12), sub]);
    const asc = f.ascent, desc = f.descent, n = glyphs.length;
    const head = cat([u32(0x10000), u32(0x10000), u32(0), u32(0x5f0f3cf5), u16(0x000b), u16(1024), Buffer.alloc(16),
        i16(xMin), i16(yMin), i16(xMax), i16(yMax), u16(f.italic ? 2 : 0), u16(8), i16(2), i16(1), i16(0)]);
    const hhea = cat([u32(0x10000), i16(asc), i16(-desc), i16(f.leading), u16(advMax), i16(Math.min(0, ...metrics.map(m => m[1]))), i16(minR), i16(xMax),
        i16(f.italic ? 1024 : 1), i16(f.italic ? 216 : 0), i16(0), Buffer.alloc(8), i16(0), u16(n)]);
    const hmtx = cat(metrics.map(m => cat([u16(m[0]), i16(m[1])])));
    const maxp = cat([u32(0x10000), u16(n), u16(maxPts), u16(maxCt), u16(0), u16(0), u16(2), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0)]);
    const avg = Math.round(metrics.reduce((s, m) => s + m[0], 0) / Math.max(1, metrics.filter(m => m[0]).length));
    const os2 = cat([u16(4), i16(avg), u16(400), u16(5), u16(0), i16(650), i16(600), i16(0), i16(75), i16(650), i16(600), i16(0), i16(350), i16(50), i16(250), i16(0),
        Buffer.alloc(10), u32(1), u32(0), u32(0), u32(0), Buffer.from('FCRD'), u16(f.italic ? 0x01 : 0x40),
        u16(map.length ? map[0][0] : 32), u16(map.length ? map[map.length - 1][0] : 32), i16(asc), i16(-desc), i16(f.leading), u16(Math.max(asc, yMax)), u16(Math.max(desc, -yMin)),
        u32(1), u32(0), i16(Math.round(asc * 0.55)), i16(Math.round(asc * 0.75)), u16(0), u16(32), u16(1)]);
    const names = [[1, fam], [2, f.italic ? 'Italic' : 'Regular'], [4, fam], [6, fam.replace(/[^A-Za-z0-9-]/g, '')]];
    const strs = names.map(nm => Buffer.from(nm[1], 'utf16le').swap16());
    let off = 0;
    const recs = names.map((nm, i) => { const r = cat([u16(3), u16(1), u16(0x409), u16(nm[0]), u16(strs[i].length), u16(off)]); off += strs[i].length; return r; });
    const name = cat([u16(0), u16(names.length), u16(6 + 12 * names.length), cat(recs), cat(strs)]);
    const post = cat([u32(0x30000), u32(f.italic ? ((-12 * 65536) >>> 0) : 0), i16(-100), i16(50), Buffer.alloc(20)]);
    const locaB = cat(loca.map(v => u32(v)));
    const tables = [['OS/2', os2], ['cmap', cmap], ['glyf', cat(glyf.length ? glyf : [Buffer.alloc(0)])], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['loca', locaB], ['maxp', maxp], ['name', name], ['post', post]];
    const sum = (d) => { let s = 0; const pad = cat([d, Buffer.alloc((4 - d.length % 4) % 4)]); for (let i = 0; i < pad.length; i += 4) s = (s + pad.readUInt32BE(i)) >>> 0; return s; };
    const nt = tables.length, te = Math.floor(Math.log2(nt)), ts = 16 * 2 ** te;
    let at = 12 + 16 * nt;
    const dir = [u32(0x10000), u16(nt), u16(ts), u16(te), u16(nt * 16 - ts)], body = [];
    tables.forEach(([tag, d]) => {
        dir.push(Buffer.from(tag, 'latin1'), u32(sum(d)), u32(at), u32(d.length));
        const pad = cat([d, Buffer.alloc((4 - d.length % 4) % 4)]);
        body.push(pad);
        at += pad.length;
    });
    const font = cat(dir.concat(body));
    // head.checkSumAdjustment (head is the 4th table)
    font.writeUInt32BE((0xb1b0afba - sum(font)) >>> 0, font.readUInt32BE(12 + 16 * 3 + 8) + 8);
    return font;
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
// what this Fightcord reads from the game (3: + the Online Edition Look, 4: all of its pictures); a copy read with less is read again
const READ_V = 4;
// the character-select sheets, in the game's order (Alex first). Basketball, SUV and Gouki (Akuma's
// Japanese name) are on them too: never shown
const OVAL_ORDER = ['alex', 'akuma', 'chunli', 'dudley', 'elena', 'gill', 'hugo', 'ibuki', 'ken', 'makoto', 'necro', 'oro', 'q', 'remy', 'ryu', 'sean', 'twelve', 'urien', 'yang', 'yun'];
const NAMES_LEFT = ['alex', 'akuma', 'basketball', 'chunli', 'dudley', 'elena', 'gill', 'hugo', 'ibuki', 'ken', 'makoto', 'gouki'];
const NAMES_RIGHT = ['necro', 'oro', 'q', 'remy', 'ryu', 'sean', 'suv', 'twelve', 'urien', 'yang', 'yun'];
const SKIP_CHARS = ['basketball', 'suv', 'gouki'];
const tick = () => new Promise(r => setTimeout(r, 0));

// reads the game once into OUT (or dest) -> { from, at, chars: [key], faces: [key], sounds: [kind] }
// each piece on its own: what this copy doesn't have just stays out
// the Online Edition Look's pictures: key -> [zip, texture names (the first one found), how it's kept]
//   crop: cut to its opaque part; max: shrunk to fit; fade: made see-through (the graffiti on the wall)
const S = 'startscreen.wad.zip', F = 'screens.zip';
const THEME_PIECES = {
    bar: [S, ['genericPopup_I33']],                        // the yellow select bar
    row: [S, ['genericPopup_I30']],                        // the dark olive bar under menu items
    frame: [S, ['genericPopup_I3']],                       // the grunge window frame
    ring: [S, ['genericPopup_I21']],                       // the grunge ring (waiting)
    logo: [S, ['startscreen_I30'], { crop: true, max: 512 }],
    oe: [S, ['startscreen_I48'], { crop: true }],          // "ONLINE EDITION / Fight for the Future"
    strip: [S, ['startscreen_I51']],                       // a dark grunge strip (the message box)
    line: [S, ['startscreen_I4C'], { max: 1024 }],         // a long dark brushed band (the channel header)
    panel: [F, ['howToPlay_I5B', 'leaderboards_I24'], { max: 1280 }],
    card: [F, ['matchLobby_I25']],                         // the lobby's dark card
    cursor: [F, ['matchLobby_I12', 'options_I13'], { crop: true }],   // the menus' yellow pointer
    corner: [F, ['options_I3E'], { crop: true }],          // a grunge corner bracket
    brush: [F, ['frontend_I2D']],                          // a black brush stroke (under titles)
    green: [F, ['notifications_IC']],                      // the green grunge bar
    dotRed: [F, ['matchLobby_I3F']], dotOrange: [F, ['matchLobby_I41']], dotYellow: [F, ['matchLobby_I43']], dotGreen: [F, ['matchLobby_I45']],
    tag1: [F, ['frontend_I43'], { fade: 0.55 }], tag2: [F, ['frontend_I45'], { fade: 0.55 }], tag3: [F, ['frontend_I44'], { fade: 0.5 }]
};
function fade(img, a) {
    const o = new Uint8Array(img.rgba);
    for (let i = 3; i < o.length; i += 4) o[i] = Math.round(o[i] * a);
    return { w: img.w, h: img.h, rgba: o };
}
function readTheme(usr, tmp, got) {
    const zips = {};
    const zipped = (zipName, names) => {
        if (!(zipName in zips)) { try { const b = fs.readFileSync(path.join(usr, 'zip', zipName)); zips[zipName] = { b, es: zipEntries(b) }; } catch (e) { zips[zipName] = null; } }
        const z = zips[zipName];
        if (!z) return null;
        for (const n of names) {
            const en = z.es.find(e => e.name.replace(/\\/g, '/').split('/').pop().toLowerCase() === n.toLowerCase());
            if (en) return zipRead(z.b, en);
        }
        return null;
    };
    const put = (k, file, data) => { if (data) { fs.writeFileSync(path.join(tmp, 'theme', file), data); got[k] = true; } };
    const gfx = zipped('font.wad.zip', ['font_lib.gfx']);
    if (gfx) {
        let fonts = [];
        try { fonts = gfxFonts(gfx); } catch (e) { fonts = []; }
        const it = fonts.find(f => /^DistrictTF-RegularItalic$/i.test(f.name)), num = fonts.find(f => /^DistrictTF-Regular$/i.test(f.name));
        if (it) put('font', 'district.ttf', ttf(it, 'FC OE District'));
        if (num) put('num', 'district-num.ttf', ttf(num, 'FC OE Numbers'));
    }
    Object.keys(THEME_PIECES).forEach(k => {
        const [zipName, names, how] = THEME_PIECES[k], o = how || {};
        let img = null;
        try { const b = zipped(zipName, names.map(n => n + '.dds')); img = b && decodeDds(b); } catch (e) { img = null; }
        if (!img) return;
        if (o.crop) img = crop(img, opaqueBox(img));
        if (o.max) img = shrink(img, o.max);
        if (o.fade) img = fade(img, o.fade);
        put(k, k + '.png', png(img));
    });
    let scan = null;
    try { scan = decodeGtf(fs.readFileSync(path.join(usr, 'textures', 'scanlines.gtf')))[0] || null; } catch (e) { scan = null; }
    if (scan) put('scan', 'scan.png', png(scan));
}

async function importFrom(usr, onStep, dest) {
    const to = dest || OUT;
    const step = (t) => { if (onStep) onStep(t); };
    const tmp = to + '.new';
    rmTree(tmp);
    ['full', 'face', 'sound', 'portrait', 'oval', 'name', 'banner', 'bg', 'vault', 'theme'].forEach(d => fs.mkdirSync(path.join(tmp, d), { recursive: true }));
    const out = { v: READ_V, from: usr, at: Date.now(), chars: [], faces: [], sounds: [], portraits: [], ovals: [], names: [], banners: [], vsbg: false, vault: [], theme: {} };
    const save = (dir, k, img) => fs.writeFileSync(path.join(tmp, dir, k + '.png'), png(img));
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
    // 3.11: character select (zip\hirez.wad.zip, PS3 textures)
    let hz = null;
    try { hz = fs.readFileSync(path.join(usr, 'zip', 'hirez.wad.zip')); } catch (e) { /* not in this copy */ }
    if (hz) {
        const ents = zipEntries(hz), one = (re) => ents.find(e => re.test(e.name));
        const gtf = (en) => { try { return decodeGtf(zipRead(hz, en) || Buffer.alloc(0))[0] || null; } catch (e) { return null; } };
        const ports = ents.filter(e => /^hirez[\/]cs_portraits[\/]204_[^/\\]+\.gtf$/i.test(e.name));
        for (let i = 0; i < ports.length; i++) {
            const k = charKey(/204_([^/\\]+)\.gtf$/i.exec(ports[i].name)[1]);
            if (SKIP_CHARS.indexOf(k) >= 0) continue;
            step(T('Portraits {n} of {total}', { n: i + 1, total: ports.length }));
            await tick();
            const img = gtf(ports[i]);
            if (!img) continue;
            save('portrait', k, crop(img, opaqueBox(img)));
            out.portraits.push(k);
        }
        step(T('Character select'));
        await tick();
        // the menus' concrete backdrop (textures\background.gtf); character select's own VS one without it
        let bgi = null;
        try { bgi = decodeGtf(fs.readFileSync(path.join(usr, 'textures', 'background.gtf')))[0] || null; } catch (e) { /* not in this copy */ }
        const bg = !bgi && one(/^hirez[\/]cs_misc[\/]background_vs\.gtf$/i);
        if (bg) bgi = gtf(bg);
        if (bgi) { save('bg', 'vs', bgi); out.vsbg = true; }
        const ov = one(/^hirez[\/]charsel[\/]Thumbnail_atlas\.gtf$/i), ovi = ov && gtf(ov), ovs = ovi && splitOvals(ovi, OVAL_ORDER);
        if (ovs) Object.keys(ovs).forEach(k => { save('oval', k, crop(ovi, ovs[k])); out.ovals.push(k); });
        await tick();
        const nm = one(/^hirez[\/]charsel[\/]Names_atlas\.gtf$/i), nmi = nm && gtf(nm), nms = nmi && splitNames(nmi, NAMES_LEFT, NAMES_RIGHT);
        if (nms) Object.keys(nms).forEach(k => { if (SKIP_CHARS.indexOf(k) < 0) { save('name', k, crop(nmi, nms[k])); out.names.push(k); } });
    }
    // the menus' look, for the Online Edition Look: the District font, the yellow select bar, the dark
    // panel and the scanlines (the concrete is bg/vs.png above)
    step(T('The menus’ look'));
    await tick();
    readTheme(usr, tmp, out.theme);
    // the trial banners
    let tz = null;
    try { tz = fs.readFileSync(path.join(usr, 'zip', 'trials.wad.zip')); } catch (e) { /* not in this copy */ }
    if (tz) {
        step(T('Banners'));
        await tick();
        zipEntries(tz).filter(e => /^flashtextures[\/]trials[\/][^/\\]+\.dds$/i.test(e.name)).forEach(en => {
            const k = charKey(path.basename(en.name.replace(/\\/g, '/'), path.extname(en.name)));
            if (/^(handicap|music|parry)$/.test(k)) return;
            const img = decodeDds(zipRead(tz, en) || Buffer.alloc(0));
            if (!img) return;
            save('banner', k, crop(img, opaqueBox(img)));
            out.banners.push(k);
        });
    }
    // the Vault: the thumbnails only (each concept is read from the game when it's opened)
    const vdir = path.join(usr, 'flashtextures', 'vault');
    let ids = [];
    try { ids = fs.readdirSync(path.join(vdir, 'concepts')).filter(n => /\.dds$/i.test(n)).map(n => n.replace(/\.dds$/i, '')); } catch (e) { /* none */ }
    for (let i = 0; i < ids.length; i++) {
        if (i % 20 === 0) { step(T('Concept art {n} of {total}', { n: i + 1, total: ids.length })); await tick(); }
        let img = null;
        try { img = decodeDds(fs.readFileSync(path.join(vdir, 'thumbs', ids[i] + '.dds'))); } catch (e) { img = null; }
        if (!img || !/^[A-Za-z0-9_-]{1,40}$/.test(ids[i])) continue;
        save('vault', ids[i], img);
        out.vault.push(ids[i]);
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
function forget() {
    urls.forEach(u => { try { if (u) URL.revokeObjectURL(u); } catch (e) { /* gone */ } });
    urls.clear();
    concepts.forEach(v => { try { URL.revokeObjectURL(v.url); } catch (e) { /* gone */ } });
    concepts.clear();
}

const guide = () => fc.modules.get('matchup-guide');
// only 3rd Strike's characters (the guide knows which roms are 3rd Strike, and its spellings)
function keyFor(rom, ch) {
    const g = guide(), game = g && g.gameOf ? g.gameOf(rom) : null;
    if (!game || game.id !== '3s') return '';
    const e = g.find(rom, ch);
    return charKey(e ? e.name : ch);
}
const has = (list, k) => !!(k && cfg && cfg.imported && (cfg.imported[list] || []).indexOf(k) >= 0);
const is3s = (rom) => { const g = guide(), game = g && g.gameOf ? g.gameOf(rom) : null; return !!(game && game.id === '3s'); };

// one concept picture, read from the game -> { url (blob), png (bytes) }; the last few are kept
const concepts = new Map();
async function concept(id) {
    if (concepts.has(id)) return concepts.get(id);
    if (!cfg.imported || api.vault().indexOf(id) < 0) throw new Error(T('not in the Vault'));
    await tick();
    const img = decodeDds(fs.readFileSync(path.join(cfg.imported.from, 'flashtextures', 'vault', 'concepts', id + '.dds')));
    if (!img) throw new Error(T('that picture didn’t open'));
    const bytes = png(shrink(img, 1920));
    const r = { url: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), png: bytes };
    concepts.set(id, r);
    if (concepts.size > 4) { const [k, v] = concepts.entries().next().value; URL.revokeObjectURL(v.url); concepts.delete(k); }
    return r;
}

// the Vault: every concept as a thumbnail; one big, with "Use as chat background"
function openVault() {
    const ids = api.vault();
    if (!ids.length) { fc.ui.toast(T('Read your game again to get the concept art (Settings → Match screens)'), { icon: 'image' }); return; }
    const grid = () => `<div class="oaVault">${ids.map(id => `<img data-v="${E(id)}" src="${E(urlOf(path.join(OUT, 'vault', id + '.png')))}" alt="" loading="lazy">`).join('')}</div>`;
    const m = fc.ui.modal({ title: T('3rd Strike concept art'), body: grid(), width: 900, actions: [{ label: T('Close'), kind: 'ghost' }] });
    let at = 0;
    m.body.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-v], [data-oa]');
        if (!t) return;
        if (t.dataset.oa === 'back') { fc.ui.setHtml(m.body, grid()); m.body.scrollTop = at; return; }
        if (t.dataset.oa === 'bg') {
            const th = fc.modules.get('discord-theme'), r = concepts.get(t.dataset.id);
            if (!th || !th.setPicture || !r) return;
            th.setPicture('data:image/png;base64,' + Buffer.from(r.png).toString('base64'));
            fc.ui.toast(T('Chat background set (Settings → Appearance to change it)'), { icon: 'image', kind: 'success' });
            return;
        }
        const id = t.dataset.v;
        at = m.body.scrollTop;
        fc.ui.setHtml(m.body, `<div class="oaBig"><div class="oaWait">${E(T('Loading…'))}</div></div>`);
        try {
            const r = await concept(id);
            if (!m.el.isConnected) return;
            fc.ui.setHtml(m.body, `<div class="oaBig"><img src="${E(r.url)}" alt=""><div class="oaBigActs">${fc.ui.btn('Back', { kind: 'sec', size: 'sm', icon: 'arrowLeft', attrs: 'data-oa="back"' })}` +
                `${fc.ui.btn('Use as chat background', { size: 'sm', icon: 'image', attrs: `data-oa="bg" data-id="${E(id)}"` })}</div></div>`);
        } catch (err) {
            fc.ui.setHtml(m.body, `<div class="oaBig"><div class="oaWait">${E(err.message)}</div><div class="oaBigActs">${fc.ui.btn('Back', { kind: 'sec', size: 'sm', attrs: 'data-oa="back"' })}</div></div>`);
        }
    });
}

const api = {
    ready: () => !!(cfg && cfg.imported),
    // a blob URL for that character's full-body art / bust ('' = none, or that use is switched off)
    full(rom, ch) { const k = keyFor(rom, ch); return cfg.screens !== false && has('chars', k) ? urlOf(path.join(OUT, 'full', k + '.png')) : ''; },
    // (3.11: the character-select oval first, the sprite bust when there's none)
    face(rom, ch) {
        const k = keyFor(rom, ch);
        if (cfg.faces === false) return '';
        return has('ovals', k) ? urlOf(path.join(OUT, 'oval', k + '.png')) : has('faces', k) ? urlOf(path.join(OUT, 'face', k + '.png')) : '';
    },
    isOval(rom, ch) { return cfg.faces !== false && has('ovals', keyFor(rom, ch)); },
    // 3.11: character select's portrait / the name in the game's lettering / the VS background / a trial banner
    portrait(rom, ch) { const k = keyFor(rom, ch); return cfg.screens !== false && has('portraits', k) ? urlOf(path.join(OUT, 'portrait', k + '.png')) : ''; },
    nameArt(rom, ch) { const k = keyFor(rom, ch); return cfg.screens !== false && has('names', k) ? urlOf(path.join(OUT, 'name', k + '.png')) : ''; },
    vsBackground(rom) { return cfg.screens !== false && cfg.imported && cfg.imported.vsbg && is3s(rom) ? urlOf(path.join(OUT, 'bg', 'vs.png')) : ''; },
    banner(rom, ch) { const k = keyFor(rom, ch); return cfg.banners !== false && has('banners', k) ? urlOf(path.join(OUT, 'banner', k + '.png')) : ''; },
    // a card's banner (scout / hover cards): the trial banner of their main in this game ('' = none)
    cardBanner(name, rom) {
        const r = rom || fc.app.activeGameId(), nt = fc.modules.get('notes');
        const m = r && nt && nt.mains ? nt.mains(name, r) : null, u = m && m.chars[0] ? api.banner(r, m.chars[0]) : '';
        return u ? `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.45)),url(&quot;${E(u)}&quot;) center 30%/cover,var(--fc-s3)` : '';
    },
    // the Online Edition Look's pieces: { font, num (TrueType Buffers), concrete, bar, panel, scan (blob URLs) },
    // anything missing is null; null as a whole until the game's font has been read
    // (and every other picture read: row, frame, ring, logo, oe, strip, line, card, cursor, corner, brush, green, dot*, tag*)
    theme() {
        const t = cfg && cfg.imported && cfg.imported.theme;
        if (!t || !t.font) return null;
        const file = (f) => path.join(OUT, 'theme', f), buf = (f) => { try { return fs.readFileSync(file(f)); } catch (e) { return null; } };
        const font = buf('district.ttf');
        if (!font) return null;
        const r = { font, num: t.num ? buf('district-num.ttf') : null, concrete: cfg.imported.vsbg ? urlOf(path.join(OUT, 'bg', 'vs.png')) || null : null };
        Object.keys(t).forEach(k => { if (k !== 'font' && k !== 'num' && t[k]) r[k] = urlOf(file(k + '.png')) || null; });
        return r;
    },
    vault: () => (cfg && cfg.imported && cfg.imported.vault) || [],
    concept: (id) => concept(id),
    openVault: () => openVault(),
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
// by itself: a copy an older Fightcord read is read again when Fightcade starts (quietly: a toast
// only when it worked, and a copy that fails isn't tried again until the next new version)
async function readFrom(dir, auto) {
    if (busy) return;
    const usr = findUsrdir(dir);
    if (!usr) {
        if (auto) fc.log('own-art: the game folder isn’t there right now', dir);
        else fc.ui.toast(T('No 3rd Strike Online Edition in that folder (Fightcord looks for USRDIR/zip/mainmenu.zip)'), { icon: 'warn', kind: 'warning' });
        return;
    }
    busy = T('Reading…');
    fc.settings.refresh('own-art');
    try {
        const r = await importFrom(usr, (t) => { busy = t; fc.settings.refresh('own-art'); });
        forget();
        cfg.dir = dir;
        cfg.imported = r;
        store.save();
        if (auto) fc.ui.toast(T('Your 3rd Strike art is up to date'), { icon: 'check', kind: 'success', sub: r.theme && r.theme.font ? T('New: the Online Edition Look (Settings → Appearance → Looks)') : '' });
        else fc.ui.toast(T('Your 3rd Strike art is ready: {n} characters', { n: r.chars.length || r.faces.length }), { icon: 'check', kind: 'success' });
        fc.emit('own-art:changed', {});
    } catch (e) {
        if (auto) { fc.log.warn('own-art: reading the game again didn’t work:', e.message); cfg.tried = READ_V; store.save(); }
        else fc.ui.toast(T('Reading the game didn’t work: {why}', { why: e.message }), { icon: 'warn', kind: 'danger' });
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
    const list = (im.ovals || []).length ? im.ovals : im.faces || [], dir = (im.ovals || []).length ? 'oval' : 'face';
    const faces = list.slice(0, 12).map(k => `<img src="${E(urlOf(path.join(OUT, dir, k + '.png')))}" alt="" title="${E(k)}">`).join('');
    const old = !im.v || im.v < READ_V ?`<div class="oaState oaOld">${E(T('This Fightcord can read more of the game now: press Read it again (for the Online Edition Look, among others).'))}</div>` : '';
    return `<div class="oaState">${E(T('{n} characters and {s} jingles, read from {dir}', { n: (im.chars || []).length || (im.faces || []).length, s: (im.sounds || []).length, dir: im.from }))}</div><div class="oaFaces">${faces}</div>${old}`;
}

const CSS = `
.oaState { margin: 8px 0; font-size: var(--fc-fs-sm); color: var(--fc-text); word-break: break-all; }
.oaFaces { display: flex; flex-wrap: wrap; margin: 0 -2px 8px; }
.oaOld { color: var(--fc-warning); }
.oaVault { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); grid-gap: 8px; max-height: 64vh; overflow-y: auto; padding: 2px; }
.oaVault img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--fc-r2); cursor: pointer; background: var(--fc-tint-2); transition: transform var(--fc-fast), box-shadow var(--fc-fast); }
.oaVault img:hover { transform: scale(1.04); box-shadow: 0 0 0 2px var(--fc-accent); }
.oaBig { display: flex; flex-direction: column; align-items: center; }
.oaBig img { max-width: 100%; max-height: 62vh; object-fit: contain; border-radius: var(--fc-r2); }
.oaBigActs { display: flex; margin-top: 10px; }
.oaBigActs .fc-btn + .fc-btn { margin-left: 8px; }
.oaWait { padding: 40px; color: var(--fc-muted); }
.oaFaces img { width: 36px; height: 36px; margin: 2px; border-radius: var(--fc-r1); object-fit: cover; object-position: 50% 0; background: var(--fc-tint-2); }
`;

function start(f) {
    fc = f;
    store = fc.config('own-art', { dir: '', imported: null, screens: true, faces: true, sounds: true, banners: true });
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
            { key: 'screens', type: 'switch', label: 'On the VS and result screens', hint: 'Character select’s portraits, names and background on the VS screen, the full-body art on the result screen, when Fightcord knows who you picked', show: on, onChange: () => fc.emit('own-art:changed', {}) },
            { key: 'faces', type: 'switch', label: 'As character faces', hint: 'Cards, the matchup guide and mains, instead of the wiki’s pictures', show: on, onChange: () => fc.emit('own-art:changed', {}) },
            { key: 'sounds', type: 'switch', label: 'Its jingles on the match screens', hint: 'VS, win, lose and draw. Your own files in the match-screens folder still come first', show: on },
            { key: 'banners', type: 'switch', label: 'Trial banners on cards', hint: 'On scout and hover cards: the banner of their main, when they have no banner of their own', show: on },
            { type: 'button', act: 'oa-vault', label: 'The Vault', hint: 'The game’s concept art; any of it can be your chat background', button: 'Browse the concept art', show: (x) => on(x) && !!(x.imported.vault || []).length, onClick: () => openVault() }
        ] });
    // the header's ⋯ menu, in 3rd Strike channels
    fc.own(fc.ui.header.more({ id: 'oa-vault', label: N_('3rd Strike concept art'), icon: 'image', order: 30, fn: () => openVault(),
        show: (ctx) => !!(ctx && is3s(ctx.rom) && api.vault().length) }));
    fc.log(cfg.imported ? 'ready, ' + (cfg.imported.chars || []).length + ' characters' : 'not set up');
    // read by an older Fightcord: read again by itself, a little after Fightcade has started
    if (cfg.imported && cfg.dir && (cfg.imported.v || 1) < READ_V && cfg.tried !== READ_V) {
        const t = setTimeout(() => readFrom(cfg.dir, true), 8000);
        fc.own(() => clearTimeout(t));
    }
    return api;
}

module.exports = {
    id: 'own-art', name: 'Your 3rd Strike art', start,
    ddsInfo, decodeDds, opaqueBox, crop, png, crc32, zipEntries, zipRead, stripMsf, charKey, findUsrdir, importFrom, SOUNDS,
    decodeGtf, mortonIndex, boxes, splitNames, splitOvals, shrink, OVAL_ORDER, NAMES_LEFT, NAMES_RIGHT,
    gfxFonts, glyphContours, ttf
};
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
