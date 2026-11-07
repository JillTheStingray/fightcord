/*
 * Emulator overlay skin (Fightcord).
 *
 * Fightcade's FBNeo draws its in-game bar (names, ranks, flags, the score, spectators) from
 * images in <Fightcade>\emulator\fbneo\ui. With this on, Fightcord draws its own bar and
 * spectators panel in your theme colour (on a canvas, nothing ships with it) and puts them
 * there. Fightcade's originals are kept in emu-ui-original\ and go back when it's turned off,
 * and when Fightcord is uninstalled. Files are only written while no emulator is open, and the
 * emulator itself is never touched. The overlay font can follow your theme's font too (a
 * redrawn bitmap font, see drawFont). Rank badges and flags stay Fightcade's.
 *
 * Chromium 80: no ||=, replaceAll, Path2D in workers (fine here, it's the page).
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, cfg = null;          // emu-skin-config.json
const N_ = (s) => s;                   // marks text translated where it's shown
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));

// what Fightcord replaces, and the exact sizes the emulator expects for the bar images
const SIZES = { 'background.png': [1220, 50], 'spectators.png': [135, 50] };
const RANK_FILES = [0, 1, 2, 3, 4, 5, 6].map(n => 'rank' + n + '.png');      // 38x38, from rank-icons.js
const FILES = ['background.png', 'spectators.png', 'font.fnt', 'font_0.png'].concat(RANK_FILES);
const BACKUP = 'emu-ui-original';

/* -------------------------------------------------------------- the files */

const sha = (buf) => require('crypto').createHash('sha256').update(buf).digest('hex');
function readOr(p) { try { return fs.readFileSync(p); } catch (e) { return null; } }

// Puts `want` ({ file: Buffer }) in place, or Fightcade's originals back when want is null.
// state = { written: {file: sha}, originals: {file: sha} } -> { state, changed: [files] }
// - a file that isn't the one Fightcord wrote is Fightcade's (the first time, or one a
//   Fightcade update brought): it's backed up before it's replaced
// - nothing is written for a file with no known original (it could never be put back)
// - turning off only puts back files that are still Fightcord's
function applyFiles(uiDir, backupDir, state, want) {
    const st = { written: Object.assign({}, state && state.written), originals: Object.assign({}, state && state.originals) };
    const changed = [];
    FILES.forEach(f => {
        const live = path.join(uiDir, f), bak = path.join(backupDir, f);
        const cur = readOr(live);
        const curHash = cur ? sha(cur) : null;
        const ours = !!curHash && curHash === st.written[f];
        if (want && want[f]) {
            if (cur && !ours) {
                fs.mkdirSync(backupDir, { recursive: true });
                fs.writeFileSync(bak, cur);
                st.originals[f] = curHash;
            }
            if (!st.originals[f] || !readOr(bak)) return;
            const h = sha(want[f]);
            if (h !== curHash) { fs.writeFileSync(live, want[f]); changed.push(f); }
            st.written[f] = h;
        } else {
            const orig = readOr(bak);
            if (ours && orig) { fs.writeFileSync(live, orig); changed.push(f); }
            delete st.written[f];
        }
    });
    return { state: st, changed };
}

/* ------------------------------------------------------------------ the art */

function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return [88, 101, 242];
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
}
const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
const CYAN = [34, 227, 242];
const NAVY_A = 0.84;                      // Fightcade's bar is 75% opaque; a touch more for the darker navy

// the panel both images share: navy, a fine diagonal texture, a neon line along the bottom
function panel(x, w, h, accent, ends) {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba([22, 25, 52], NAVY_A));
    g.addColorStop(1, rgba([11, 12, 26], NAVY_A));
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    // glow where the names sit
    if (ends) [0, w].forEach(cx => {
        const r = x.createRadialGradient(cx, h / 2, 0, cx, h / 2, Math.min(340, w / 2));
        r.addColorStop(0, rgba(accent, 0.34));
        r.addColorStop(1, rgba(accent, 0));
        x.fillStyle = r;
        x.fillRect(0, 0, w, h);
    });
    // a faint diagonal weave
    x.save();
    x.strokeStyle = 'rgba(255,255,255,0.035)';
    x.lineWidth = 1;
    for (let i = -h; i < w; i += 6) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.stroke(); }
    x.restore();
    // top hairline and the neon line along the bottom: accent at the ends, cyan in the middle
    x.fillStyle = 'rgba(255,255,255,0.10)';
    x.fillRect(0, 0, w, 1);
    const l = x.createLinearGradient(0, 0, w, 0);
    if (ends) {
        l.addColorStop(0, rgba(accent, 1));
        l.addColorStop(0.32, rgba(accent, 0.18));
        l.addColorStop(0.5, rgba(CYAN, 0.55));
        l.addColorStop(0.68, rgba(accent, 0.18));
        l.addColorStop(1, rgba(accent, 1));
    } else {
        l.addColorStop(0, rgba(accent, 1));
        l.addColorStop(1, rgba(CYAN, 0.7));
    }
    x.fillStyle = l;
    x.fillRect(0, h - 2, w, 2);
}

// 3.13 broadcast style, like the VS screen: your colour on the left, a second colour on the right,
// a dark plate in the middle (the score) with lit slanted edges, fine slanted stripes. Symmetric, so it
// works wherever the emulator puts the names.
const PINK = [255, 79, 163], GOLD = [240, 178, 50];
const SLANT = Math.tan(14 * Math.PI / 180);           // the VS screen's -14deg
// the right-hand colour: cyan, or pink when your accent is close to cyan already
function secondOf(a) { return Math.abs(a[0] - CYAN[0]) + Math.abs(a[1] - CYAN[1]) + Math.abs(a[2] - CYAN[2]) < 170 ? PINK : CYAN; }
function broadcast(x, w, h, a, b, plateW) {
    const k = h * SLANT, cx = w / 2, pl = cx - plateW / 2, pr = cx + plateW / 2;
    const poly = (pts) => { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); };
    x.fillStyle = 'rgba(8,8,12,0.86)';
    x.fillRect(0, 0, w, h);
    // the two panels: strongest at the outer ends, darker towards the plate and the bottom
    [[a, [[0, 0], [pl + k / 2, 0], [pl - k / 2, h], [0, h]], 0, pl], [b, [[pr + k / 2, 0], [w, 0], [w, h], [pr - k / 2, h]], w, pr]].forEach(([col, pts, outer, inner]) => {
        x.save();
        poly(pts); x.clip();
        const g = x.createLinearGradient(outer, 0, inner, 0);
        g.addColorStop(0, rgba(col, 0.78)); g.addColorStop(0.55, rgba(col, 0.5)); g.addColorStop(1, rgba(col, 0.36));
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        const v = x.createLinearGradient(0, 0, 0, h);
        v.addColorStop(0, 'rgba(255,255,255,0.16)'); v.addColorStop(0.35, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
        x.fillStyle = v; x.fillRect(0, 0, w, h);
        x.strokeStyle = 'rgba(255,255,255,0.07)'; x.lineWidth = 1;
        for (let i = -h; i < w + h; i += 7) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + k, 0); x.stroke(); }
        x.restore();
    });
    // the plate under the score, and its lit edges in each side's colour
    poly([[pl + k / 2, 0], [pr + k / 2, 0], [pr - k / 2, h], [pl - k / 2, h]]);
    x.fillStyle = 'rgba(7,7,11,0.95)'; x.fill();
    [[pl, a], [pr, b]].forEach(([ex, col]) => {
        x.save();
        x.strokeStyle = '#ffffff'; x.lineWidth = 2; x.shadowColor = rgba(col, 1); x.shadowBlur = 10;
        x.beginPath(); x.moveTo(ex + k / 2, 0); x.lineTo(ex - k / 2, h); x.stroke();
        x.restore();
    });
    // top hairline; along the bottom each side's colour with gold under the plate
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, 0, w, 1);
    const l = x.createLinearGradient(0, 0, w, 0);
    l.addColorStop(0, rgba(a, 1)); l.addColorStop(Math.max(0, pl / w - 0.02), rgba(a, 0.9));
    l.addColorStop(pl / w, rgba(GOLD, 1)); l.addColorStop(pr / w, rgba(GOLD, 1));
    l.addColorStop(Math.min(1, pr / w + 0.02), rgba(b, 0.9)); l.addColorStop(1, rgba(b, 1));
    x.fillStyle = l; x.fillRect(0, h - 3, w, 3);
}

function canvas(file) {
    const c = document.createElement('canvas');
    c.width = SIZES[file][0];
    c.height = SIZES[file][1];
    return c;
}

function drawBar(accent, style) {
    const c = canvas('background.png');
    const a = hexRgb(accent);
    if (style === 'neon') panel(c.getContext('2d'), c.width, c.height, a, true);
    else broadcast(c.getContext('2d'), c.width, c.height, a, secondOf(a), 640);
    return c;
}

// the eye where Fightcade's is (x 14-56, y 14-38); the emulator writes the count to its right
const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z';
function drawEye(accent, style) {
    const c = canvas('spectators.png');
    const x = c.getContext('2d');
    const a = hexRgb(accent);
    const bc = style !== 'neon';
    if (bc) {
        // the dark plate with your colour as a slanted tab at the front and gold along the bottom
        const h = c.height, k = h * SLANT;
        x.fillStyle = 'rgba(7,7,11,0.92)'; x.fillRect(0, 0, c.width, h);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(6 + k / 2, 0); x.lineTo(6 - k / 2, h); x.lineTo(0, h); x.closePath();
        x.fillStyle = rgba(a, 0.95); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(0, 0, c.width, 1);
        x.fillStyle = rgba(GOLD, 1); x.fillRect(0, h - 3, c.width, 3);
    } else panel(x, c.width, c.height, a, false);
    x.save();
    x.translate(35 - 12 * 2.1, 26 - 12 * 2.1);
    x.scale(2.1, 2.1);
    x.lineWidth = 2;
    x.lineJoin = 'round';
    x.strokeStyle = '#ffffff';
    x.shadowColor = rgba(a, 0.9);
    x.shadowBlur = 8;
    x.stroke(new Path2D(EYE));
    x.beginPath();
    x.arc(12, 12, 3, 0, Math.PI * 2);
    x.fillStyle = rgba(bc ? GOLD : CYAN, 1);
    x.fill();
    x.restore();
    return c;
}

const png = (c) => Buffer.from(c.toDataURL('image/png').split(',')[1], 'base64');

/* ------------------------------------------------------------------ the font */

// The overlay and chat font is an AngelCode BMFont: font.fnt (binary v3) + one 512x512 page,
// font_0.png. Fightcade's is Source Sans Pro, 36 px, white with a 3 px black outline (the
// emulator tints the white: cyan scores, the orange FT). Fightcord draws the same characters in
// your theme's font, keeps the line height and baseline, and measures the new kerning.
// blocks: 1 info, 2 common, 3 pages, 4 chars (20 bytes each), 5 kerning pairs (10 bytes each)
function parseFnt(buf) {
    if (!buf || buf.length < 4 || buf.toString('latin1', 0, 3) !== 'BMF' || buf[3] !== 3) return null;
    const out = { blocks: {}, chars: [], kerning: [] };
    for (let p = 4; p + 5 <= buf.length;) {
        const type = buf[p], n = buf.readUInt32LE(p + 1);
        const d = buf.slice(p + 5, p + 5 + n);
        out.blocks[type] = d;
        if (type === 4) for (let o = 0; o + 20 <= d.length; o += 20) {
            out.chars.push({ id: d.readUInt32LE(o), x: d.readUInt16LE(o + 4), y: d.readUInt16LE(o + 6), w: d.readUInt16LE(o + 8), h: d.readUInt16LE(o + 10),
                xo: d.readInt16LE(o + 12), yo: d.readInt16LE(o + 14), xa: d.readInt16LE(o + 16), page: d[o + 18], chnl: d[o + 19] });
        }
        if (type === 5) for (let o = 0; o + 10 <= d.length; o += 10) out.kerning.push({ a: d.readUInt32LE(o), b: d.readUInt32LE(o + 4), amt: d.readInt16LE(o + 8) });
        p += 5 + n;
    }
    if (!out.blocks[1] || !out.blocks[2] || !out.blocks[3] || !out.chars.length) return null;
    out.fontSize = out.blocks[1].readInt16LE(0);
    out.outline = out.blocks[1][13];
    out.lineHeight = out.blocks[2].readUInt16LE(0);
    out.base = out.blocks[2].readUInt16LE(2);
    out.scaleW = out.blocks[2].readUInt16LE(4);
    out.scaleH = out.blocks[2].readUInt16LE(6);
    return out;
}

// the original's info / common / pages blocks with new characters, kerning and font name
function buildFnt(src, chars, kerning, name) {
    const block = (type, d) => { const h = Buffer.alloc(5); h[0] = type; h.writeUInt32LE(d.length, 1); return Buffer.concat([h, d]); };
    const info = Buffer.concat([src.blocks[1].slice(0, 14), Buffer.from(String(name || '').replace(/[^\x20-\x7e]/g, '') + '\0', 'latin1')]);
    const cb = Buffer.alloc(chars.length * 20);
    chars.forEach((c, i) => {
        const o = i * 20;
        cb.writeUInt32LE(c.id, o); cb.writeUInt16LE(c.x, o + 4); cb.writeUInt16LE(c.y, o + 6); cb.writeUInt16LE(c.w, o + 8); cb.writeUInt16LE(c.h, o + 10);
        cb.writeInt16LE(c.xo, o + 12); cb.writeInt16LE(c.yo, o + 14); cb.writeInt16LE(c.xa, o + 16); cb[o + 18] = 0; cb[o + 19] = 15;
    });
    const parts = [Buffer.from([0x42, 0x4d, 0x46, 3]), block(1, info), block(2, src.blocks[2]), block(3, src.blocks[3]), block(4, cb)];
    if (kerning.length) {
        const kb = Buffer.alloc(kerning.length * 10);
        kerning.forEach((k, i) => { kb.writeUInt32LE(k.a, i * 10); kb.writeUInt32LE(k.b, i * 10 + 4); kb.writeInt16LE(k.amt, i * 10 + 8); });
        parts.push(block(5, kb));
    }
    return Buffer.concat(parts);
}

// The fonts on offer: all free (SIL Open Font License) from Google Fonts, loaded when needed --
// nothing ships with Fightcord. Characters a font lacks come from Noto Sans. Pixel fonts keep
// whole-pixel sizes (`grid`) so they stay sharp; `weight` is the one the font really has.
const FONTS = [
    { id: 'theme', name: N_('Your theme font'), style: N_('Follows Appearance → Theme'), weight: 700 },
    { id: 'fightcade', name: N_('Fightcade’s own'), style: N_('Source Sans Pro, as it comes'), card: 'Source Sans 3', gf: 'Source+Sans+3:wght@700' },
    { id: 'anton', name: 'Anton', style: N_('Broadcast, like the VS screen'), family: 'FC Display', weight: 400, embedded: true },
    { id: 'press-start', name: 'Press Start 2P', style: N_('Arcade pixel'), family: 'Press Start 2P', gf: 'Press+Start+2P', weight: 400, grid: 8 },
    { id: 'pixelify', name: 'Pixelify Sans', style: N_('Modern pixel'), family: 'Pixelify Sans', gf: 'Pixelify+Sans:wght@700', weight: 700 },
    { id: 'silkscreen', name: 'Silkscreen', style: N_('Tiny pixel capitals'), family: 'Silkscreen', gf: 'Silkscreen:wght@700', weight: 700 },
    { id: 'vt323', name: 'VT323', style: N_('Old terminal'), family: 'VT323', gf: 'VT323', weight: 400 },
    { id: 'teko', name: 'Teko', style: N_('Tall esports'), family: 'Teko', gf: 'Teko:wght@600', weight: 600 },
    { id: 'russo', name: 'Russo One', style: N_('Blocky and sporty'), family: 'Russo One', gf: 'Russo+One', weight: 400 },
    { id: 'chakra', name: 'Chakra Petch', style: N_('Angular tech'), family: 'Chakra Petch', gf: 'Chakra+Petch:wght@700', weight: 700 },
    { id: 'orbitron', name: 'Orbitron', style: N_('Sci-fi'), family: 'Orbitron', gf: 'Orbitron:wght@700', weight: 700 },
    { id: 'audiowide', name: 'Audiowide', style: N_('Racing'), family: 'Audiowide', gf: 'Audiowide', weight: 400 },
    { id: 'exo', name: 'Exo 2', style: N_('Clean futuristic'), family: 'Exo 2', gf: 'Exo+2:wght@700', weight: 700 }
];
const FALLBACK = "'Noto Sans', sans-serif";
const fontById = (id) => FONTS.find(f => f.id === id) || FONTS[0];
// the CSS font stack and weight for a choice; null = Fightcade's own font
function fontSpec(id) {
    const f = fontById(id);
    if (f.id === 'fightcade') return null;
    if (f.id === 'theme') return { id: f.id, family: family(), weight: 700 };
    return { id: f.id, family: "'" + f.family + "', " + FALLBACK, weight: f.weight, grid: f.grid || 0 };
}

// Draws every character of the original font -> { fnt, page } (Buffers), or null. Sized so
// capitals are as tall as Fightcade's; a font too wide for the one 512x512 page is drawn a bit
// smaller (pixel fonts a whole step smaller), first without the 1 px of air around characters.
function drawFont(src, spec) {
    const OUT = src.outline || 0;
    const cap = src.chars.find(ch => ch.id === 72) || src.chars.find(ch => ch.id === 65);
    const targetCap = cap ? cap.h - 2 * OUT : Math.round(src.fontSize * 0.55);
    const x = document.createElement('canvas').getContext('2d');
    x.font = spec.weight + ' 100px ' + spec.family;
    const capAt100 = x.measureText('H').actualBoundingBoxAscent || 70;
    let px = 100 * targetCap / capAt100;
    px = spec.grid ? Math.max(spec.grid, Math.round(px / spec.grid) * spec.grid) : Math.round(px * 2) / 2;
    const min = px * 0.6;
    while (px >= min) {
        const r = drawFontAt(src, spec, px, 1) || drawFontAt(src, spec, px, 0);
        if (r) return Object.assign(r, { px });
        px = spec.grid ? px - spec.grid : Math.round(px * 0.92 * 2) / 2;
    }
    return null;
}

function drawFontAt(src, spec, px, PAD) {
    const OUT = src.outline || 0, W = src.scaleW || 512, H = src.scaleH || 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.font = spec.weight + ' ' + px + 'px ' + spec.family;
    x.textBaseline = 'alphabetic';
    // measure, then shelf-pack tallest first
    const glyphs = src.chars.map(ch => {
        const s = String.fromCodePoint(ch.id);
        const m = x.measureText(s);
        const left = Math.ceil(m.actualBoundingBoxLeft || 0), right = Math.ceil(m.actualBoundingBoxRight || 0);
        const asc = Math.ceil(m.actualBoundingBoxAscent || 0), desc = Math.ceil(m.actualBoundingBoxDescent || 0);
        const empty = left + right <= 0 || asc + desc <= 0;
        return { id: ch.id, s, m, left, asc, empty, w: empty ? 1 : left + right + 2 * (OUT + PAD), h: empty ? 1 : asc + desc + 2 * (OUT + PAD) };
    });
    const order = glyphs.slice().sort((a, b) => b.h - a.h);
    let cx = 0, cy = 0, row = 0;
    for (const g of order) {
        if (cx + g.w > W) { cx = 0; cy += row + 1; row = 0; }
        if (cy + g.h > H) return null;
        g.x = cx; g.y = cy;
        cx += g.w + 1;
        row = Math.max(row, g.h);
    }
    x.lineJoin = spec.grid ? 'miter' : 'round';
    x.lineWidth = OUT * 2;
    x.strokeStyle = '#000';
    x.fillStyle = '#fff';
    glyphs.forEach(g => {
        if (g.empty) return;
        const ox = g.x + OUT + PAD + g.left, oy = g.y + OUT + PAD + g.asc;
        if (OUT) x.strokeText(g.s, ox, oy);
        x.fillText(g.s, ox, oy);
    });
    const chars = glyphs.map(g => ({ id: g.id, x: g.x, y: g.y, w: g.w, h: g.h, xa: Math.round(g.m.width),
        xo: g.empty ? 0 : -(g.left + OUT + PAD), yo: g.empty ? 0 : src.base - g.asc - OUT - PAD }));
    // kerning for the pairs Fightcade's font had, measured in the new one
    const wid = {};
    glyphs.forEach(g => { wid[g.id] = g.m.width; });
    const kerning = [];
    src.kerning.forEach(k => {
        if (wid[k.a] == null || wid[k.b] == null) return;
        const amt = Math.round(x.measureText(String.fromCodePoint(k.a) + String.fromCodePoint(k.b)).width - wid[k.a] - wid[k.b]);
        if (amt) kerning.push({ a: k.a, b: k.b, amt });
    });
    const name = (String(spec.family).split(',')[0] || '').replace(/['"]/g, '').trim();
    return { fnt: buildFnt(src, chars, kerning, name), page: png(c), canvas: c, chars, kerning };
}

// Text drawn the way the emulator does it: glyphs cut from the page, tinted, kerned.
// parts: [[text, colour], ...] -> a canvas w x h over `bar`
function renderLine(font, page, bar, parts, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(bar, 0, 0, w, h);
    const by = {}, kern = {};
    font.chars.forEach(g => { by[g.id] = g; });
    font.kerning.forEach(k => { kern[k.a + ',' + k.b] = k.amt; });
    const scale = h / (font.lineHeight || 36) * 0.92;
    const tint = (col) => {
        const t = document.createElement('canvas');
        t.width = page.width; t.height = page.height;
        const tx = t.getContext('2d');
        tx.drawImage(page, 0, 0);
        tx.globalCompositeOperation = 'multiply';
        tx.fillStyle = col;
        tx.fillRect(0, 0, t.width, t.height);
        tx.globalCompositeOperation = 'destination-in';
        tx.drawImage(page, 0, 0);
        return t;
    };
    const widthOf = (s) => { let p = 0, prev = 0; for (const ch of s) { const id = ch.codePointAt(0), g = by[id]; if (!g) continue; if (prev) p += kern[prev + ',' + id] || 0; p += g.xa; prev = id; } return p * scale; };
    const gap = 26 * scale;
    const total = parts.reduce((s, p) => s + widthOf(p[0]), 0) + gap * (parts.length - 1);
    let pen = (w - total) / 2;
    const top = (h - (font.lineHeight || 36) * scale) / 2;
    x.imageSmoothingEnabled = !font.pixel;
    parts.forEach(([txt, col]) => {
        const t = tint(col);
        let prev = 0;
        for (const ch of txt) {
            const id = ch.codePointAt(0), g = by[id];
            if (!g) continue;
            if (prev) pen += (kern[prev + ',' + id] || 0) * scale;
            if (g.w > 1) x.drawImage(t, g.x, g.y, g.w, g.h, pen + g.xo * scale, top + g.yo * scale, g.w * scale, g.h * scale);
            pen += g.xa * scale;
            prev = id;
        }
        pen += gap;
    });
    return c;
}

/* ------------------------------------------------------------------ syncing */

const theme = () => { const th = fc.modules.get('discord-theme'); const t = th && th.theme ? th.theme() : null; return t && t.enabled !== false ? t : {}; };
const accent = () => theme().accent || '#5865f2';
// the theme's font ('' = Discord's look: gg sans when installed, else Noto Sans)
const family = () => theme().font || "'gg sans', 'Noto Sans', sans-serif";

// Google Fonts stylesheets, once each (Noto Sans is also what any missing character falls back to)
function linkFont(id, query) {
    const lid = 'fcesFont-' + id;
    if (document.getElementById(lid)) return;
    const l = document.createElement('link');
    l.id = lid; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?' + query + '&display=swap';
    document.head.appendChild(l);
}
function linkFonts(list) {
    if (!document.getElementById('dcThemeFont')) linkFont('noto', 'family=Noto+Sans:wght@400;700');
    list.forEach(f => { if (f.gf) linkFont(f.id, 'family=' + f.gf); });
}

// wait for a font before drawing it, so the emulator doesn't get the fallback baked in.
// Web fonts come in unicode-range pieces: ask for Latin and the accented ones. -> ready?
async function fontReady(spec) {
    const f = fontById(spec.id);
    linkFonts(f.gf ? [f] : []);
    const css = spec.weight + ' 36px ' + spec.family, sample = 'AaZz09ÇçÑñŁłŞş€';
    try { await Promise.race([document.fonts.load(css, sample), new Promise(r => setTimeout(r, 6000))]); } catch (e) { return false; }
    const name = f.family || (/Noto Sans/.test(spec.family) ? 'Noto Sans' : '');
    if (name && [...document.fonts].some(ff => ff.family.replace(/['"]/g, '') === name && ff.status === 'error')) return false;
    if (name && ![...document.fonts].some(ff => ff.family.replace(/['"]/g, '') === name && ff.status === 'loaded')) return false;
    return document.fonts.check(css, sample);
}

// Fightcade's own copy of a file: the one there, or the backup when the one there is ours
function originalFile(name) {
    const live = readOr(path.join(uiDir(), name));
    if (live && sha(live) !== (cfg.written || {})[name]) return live;
    return readOr(path.join(backupDir(), name));
}
const originalFnt = () => parseFnt(originalFile('font.fnt'));

let busy = false, lastKey = '', pending = false, noUi = false;
const uiDir = () => fc.emu.uiDir();
const backupDir = () => fc.files.path(BACKUP);
const ranksOn = () => { const ri = fc.modules.get('rank-icons'); return !!(ri && ri.enabled && ri.enabled()); };
const wantKey = () => {
    if (!cfg.enabled && !ranksOn()) return null;
    const s = fontSpec(cfg.fontChoice);
    return (cfg.enabled ? accent() + '|' + (cfg.style || 'broadcast') + '|' + (s ? s.id + ':' + s.family : 'fightcade') : 'bar-off') + (ranksOn() ? '|ranks' : '');
};

// Brings the files in line with the setting; waits while an emulator is open (or can't tell)
async function sync(force) {
    if (busy) { pending = true; return; }
    const want = wantKey();
    const isOn = Object.keys(cfg.written || {}).length > 0;
    if (!want && !isOn) { lastKey = want; return; }          // off and nothing of ours there
    if (!force && want === lastKey && isOn) return;
    if (noUi) return;
    busy = true;
    try {
        if (!fs.existsSync(path.join(uiDir(), 'background.png'))) { noUi = true; fc.log('no emulator ui folder at', uiDir()); return; }
        const run = await fc.emu.running();
        if (run !== false) return;              // an emulator is open (or can't tell): after the match
        let files = null;
        if (want && cfg.enabled) {
            const a = accent();
            files = { 'background.png': png(drawBar(a, cfg.style)), 'spectators.png': png(drawEye(a, cfg.style)) };
            const spec = fontSpec(cfg.fontChoice);
            if (spec) {
                const src = originalFnt();
                if (!(await fontReady(spec))) { fc.log('font not loaded yet:', spec.family); return; }
                const f = src && drawFont(src, spec);
                if (f) { files['font.fnt'] = f.fnt; files['font_0.png'] = f.page; }
                else fc.log('emulator font: ' + (src ? 'too big for the page' : 'no original font.fnt') + ', kept Fightcade’s');
            }
        }
        // Fightcord's rank icons in the bar (their own switch, with or without the rest of the skin)
        if (want && ranksOn()) {
            const ri = fc.modules.get('rank-icons');
            const rf = ri && ri.emuFiles ? await ri.emuFiles(38) : null;
            if (rf) files = Object.assign(files || {}, rf);
        }
        const r = applyFiles(uiDir(), backupDir(), cfg, files);
        cfg.written = r.state.written;
        cfg.originals = r.state.originals;
        store.save();
        lastKey = want;
        if (r.changed.length) fc.log('emulator files', want ? 'skinned:' : 'restored:', r.changed.join(', '));
    } catch (e) {
        fc.log('emulator skin failed:', e.message);
    } finally {
        busy = false;
        if (pending) { pending = false; setTimeout(() => sync(), 0); }
    }
}

/* ------------------------------------------------------------------ settings */

const sampleParts = () => [[fc.app.me() || 'TurtleTime', '#ffffff'], ['3', '#22e3f2'], ['FT3', '#f0b232'], ['2', '#22e3f2'], ['Rival', '#ffffff']];

// The big preview: the chosen font drawn exactly as the emulator will (cut from the page it gets),
// over your bar. Built after the font has loaded; cached per choice + accent.
const shot = { key: '', url: '', busy: false };
async function buildShot() {
    const key = wantKey();
    if (!key || shot.busy || shot.key === key) return;
    shot.busy = true;
    try {
        const bar = drawBar(accent(), cfg.style);
        const spec = fontSpec(cfg.fontChoice);
        let font = null, page = null;
        const src = originalFnt();
        if (spec && src && await fontReady(spec)) {
            const f = drawFont(src, spec);
            if (f) { font = { chars: f.chars, kerning: f.kerning, lineHeight: src.lineHeight, pixel: !!spec.grid }; page = f.canvas; }
        } else if (!spec && src) {
            const buf = originalFile('font_0.png');
            const img = buf && await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'data:image/png;base64,' + buf.toString('base64'); });
            if (img) { font = { chars: src.chars, kerning: src.kerning, lineHeight: src.lineHeight }; page = img; }
        }
        shot.url = font && page ? renderLine(font, page, bar, sampleParts(), 610, 25).toDataURL('image/png') : '';
        shot.key = key;
        fc.settings.refresh('emu-skin');
    } catch (e) {
        fc.log('preview failed:', e.message);
    } finally {
        shot.busy = false;
    }
}

let barUrl = '', barFor = '';
function previewHtml(d) {
    if (!d.enabled) return '';
    const a = accent(), bk = a + '|' + (d.style || 'broadcast');
    if (barFor !== bk) { barFor = bk; barUrl = drawBar(a, d.style).toDataURL('image/png'); }
    const choice = fontById(d.fontChoice);
    if (shot.key !== wantKey()) setTimeout(buildShot, 0);
    // until the exact one is drawn (or without Fightcade's font files, e.g. the dev harness): CSS text
    const exact = shot.key === wantKey() && shot.url;
    const parts = sampleParts();
    const lineText = parts.map(p => p[0]).join('    ');
    const cssText = `<div class="fcesLine" style="${cssFont(choice)};font-size:${cardSize(choice, lineText, 15, 520) || 20}px">${parts.map(p => `<span style="color:${p[1]}">${fc.fmt.esc(p[0])}</span>`).join('')}</div>`;
    return `<div class="fcesPrev">${exact ? `<img src="${shot.url}" alt="">` : `<img src="${barUrl}" alt="">${cssText}`}</div>`;
}

// how a choice is shown in the settings: { family: CSS stack, weight }
const shownFont = (f) => {
    if (f.id === 'fightcade') return { family: "'Source Sans Pro', 'Source Sans 3', 'Segoe UI', sans-serif", weight: 700 };
    if (f.id === 'theme') return { family: family(), weight: 700 };
    return { family: "'" + f.family + "', " + FALLBACK, weight: f.weight };
};
const cssFont = (f) => { const s = shownFont(f); return 'font-family:' + fc.fmt.esc(s.family) + ';font-weight:' + s.weight; };

// font-size that gives capitals `cap` px tall, no wider than `maxW` for `text` (once the font is in)
const sizeCache = {};
function cardSize(f, text, cap, maxW) {
    const s = shownFont(f);
    const spec = s.weight + ' 100px ' + s.family;
    const k = spec + '|' + text + '|' + cap + '|' + maxW;
    if (sizeCache[k]) return sizeCache[k];
    try { if (!document.fonts.check(spec, text)) return 0; } catch (e) { return 0; }
    const x = document.createElement('canvas').getContext('2d');
    x.font = spec;
    const h = x.measureText('H').actualBoundingBoxAscent || 70, w = x.measureText(text).width || 100;
    return (sizeCache[k] = Math.max(8, Math.min(100 * cap / h, 100 * maxW / w)).toFixed(1));
}

// 3.13: the bar's look: Broadcast (like the VS screen) or the 2.7 neon bar
const STYLES = [{ id: 'broadcast', name: N_('Broadcast'), style: N_('Like the VS screen') }, { id: 'neon', name: N_('Neon'), style: N_('The neon bar from 2.7') }];
const styleUrls = {};
function stylesHtml(d) {
    if (!d.enabled) return '';
    const a = accent();
    return `<div class="fcesStyles">${STYLES.map(st => {
        const k = a + '|' + st.id;
        if (!styleUrls[k]) styleUrls[k] = drawBar(a, st.id).toDataURL('image/png');
        return `<div class="fcesFont fcesStyle${st.id === (d.style || 'broadcast') ? ' on' : ''}" data-style="${st.id}"><div class="smp" style="background-image:url(${styleUrls[k]})"></div>` +
            `<b>${fc.fmt.esc(T(st.name))}</b><small>${fc.fmt.esc(T(st.style))}</small></div>`;
    }).join('')}</div>`;
}

function pickerHtml(d) {
    if (!d.enabled) return '';
    return `<div class="fcesFonts">${FONTS.map(f => `<div class="fcesFont${f.id === (d.fontChoice || 'theme') ? ' on' : ''}" data-font="${f.id}" title="${fc.fmt.esc(T(f.name))}">
        <div class="smp" style="background-image:url(${barUrl})"><span style="${cssFont(f)};font-size:${cardSize(f, T('Ready? Fight!'), 11, 150) || 15}px">${fc.fmt.esc(T('Ready? Fight!'))}</span></div>
        <b>${fc.fmt.esc(T(f.name))}</b><small>${fc.fmt.esc(T(f.style))}</small></div>`).join('')}</div>`;
}

// the gallery shows every font: load them (once) when the settings open
let galleryLoaded = false;
function onSettingsClick(e) {
    const st = e.target.closest && e.target.closest('.fcesStyle[data-style]');
    if (st) { cfg.style = st.getAttribute('data-style') === 'neon' ? 'neon' : 'broadcast'; store.save(); fc.settings.refresh('emu-skin'); sync(true); return; }
    const card = e.target.closest && e.target.closest('.fcesFont[data-font]');
    if (!card) return;
    cfg.fontChoice = card.getAttribute('data-font');
    store.save();
    fc.settings.refresh('emu-skin');
    sync(true);
}

const CSS = `
.fcesPrev { position: relative; height: 50px; margin: 6px 0 2px; border-radius: 6px; overflow: hidden;
    background: repeating-linear-gradient(45deg, #3b2a52 0 10px, #2c3a5a 10px 20px); }
.fcesPrev img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; image-rendering: auto; }
.fcesLine { position: absolute; left: 0; right: 0; top: 0; line-height: 50px; text-align: center; font-size: var(--fc-fs-2xl); white-space: nowrap; }
.fcesLine span, .fcesFont .smp span { text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 2px 0 #000, 0 -2px 0 #000, 2px 0 0 #000, -2px 0 0 #000; }
.fcesLine span { margin: 0 12px; }
.fcesStyles { display: flex; margin: 8px -4px 0; }
.fcesStyles .fcesStyle { width: calc(50% - 8px); }
.fcesStyles .smp { height: 30px; }
.fcesFonts { display: flex; flex-wrap: wrap; margin: 8px -4px 0; }
.fcesFont { width: calc(33.333% - 8px); margin: 4px; padding: 6px 6px 8px; border-radius: var(--fc-r2); box-sizing: border-box; cursor: pointer;
    background: var(--fc-s2, rgba(255,255,255,.04)); box-shadow: inset 0 0 0 1px var(--fc-tint-2); transition: box-shadow var(--fc-fast), background var(--fc-fast); }
.fcesFont:hover { background: var(--fc-hover, rgba(255,255,255,.07)); }
.fcesFont.on { box-shadow: inset 0 0 0 2px var(--fc-blurple, #5865f2), 0 0 14px rgba(88,101,242,.25); }
.fcesFont .smp { height: 34px; border-radius: 5px; background-size: 100% 100%; overflow: hidden; text-align: center; line-height: 34px; white-space: nowrap; }
.fcesFont .smp span { color: #fff; font-size: var(--fc-fs-lg); }
.fcesFont b { display: block; margin-top: 6px; font-size: var(--fc-fs-ui); color: var(--fc-head, #fff); }
.fcesFont small { display: block; font-size: var(--fc-fs-sm); color: var(--fc-muted, #949ba4); }
@media (max-width: 760px) { .fcesFont { width: calc(50% - 8px); } }
`;

/* ------------------------------------------------------------------ module */

function start(f) {
    fc = f;
    store = fc.config('emu-skin', { enabled: false, fontChoice: 'anton', style: 'broadcast', written: {}, originals: {} });
    cfg = store.data;
    if (!cfg.v313) { if (cfg.fontChoice === 'theme') cfg.fontChoice = 'anton'; if (!cfg.style) cfg.style = 'broadcast'; cfg.v313 = true; }
    // 2.7 test builds had a font switch
    if (cfg.font === false && !cfg.fontChoice) cfg.fontChoice = 'fightcade';
    if (!cfg.fontChoice || !FONTS.some(x => x.id === cfg.fontChoice)) cfg.fontChoice = 'theme';
    delete cfg.font;
    fc.ui.style('fcesStyle', CSS);
    fc.own(() => fc.ui.style('fcesStyle', null));
    if (typeof document !== 'undefined') {
        document.addEventListener('click', onSettingsClick, true);
        fc.own(() => document.removeEventListener('click', onSettingsClick, true));
    }
    // the theme has no change event: compare the accent now and then (cheap), and catch
    // up after a match, when the files are free again
    fc.tick(() => sync(), 5000, { whileHidden: true });
    fc.on('match:end', () => setTimeout(() => sync(true), 8000));
    fc.on('ranks:changed', () => setTimeout(() => sync(true), 200));
    fc.settings.block({
        id: 'emu-skin', section: 'appearance', title: 'Emulator overlay', hint: '— the bar with names and the score in your matches',
        store, order: 65,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Fightcord style for the in-game bar', hint: 'Drawn in your theme colour. Fightcade’s rank badges and flags stay',
                onChange: () => sync(true) },
            { type: 'html', id: 'emu-skin-styles', html: stylesHtml },
            { type: 'html', id: 'emu-skin-preview', html: previewHtml },
            { type: 'html', id: 'emu-skin-fonts', html: (d) => {
                if (d.enabled && !galleryLoaded && typeof document !== 'undefined') {
                    galleryLoaded = true;
                    linkFonts(FONTS);
                    Promise.all(FONTS.map(x => document.fonts.load(shownFont(x).weight + ' 20px ' + shownFont(x).family, T('Ready? Fight!')).catch(() => null)))
                        .then(() => fc.settings.refresh('emu-skin'));
                }
                return pickerHtml(d);
            } },
            { type: 'note', label: 'Every font is free (open licence): Anton comes with Fightcord, the others load from Google Fonts. Changes apply to your next match; Fightcade’s own files are kept and put back when you turn this off.' }
        ]
    });
    sync(true);
    return api;
}

const api = {
    sync: (force) => sync(force),
    // a Look picks the emulator font that goes with it (used once the overlay skin is on)
    setFont(id) {
        if (!cfg || !FONTS.some(x => x.id === id)) return;
        cfg.fontChoice = id;
        store.save();
        fc.settings.refresh('emu-skin');
        sync(true);
    },
    _draw: { bar: (a, st) => drawBar(a || accent(), st || cfg.style), eye: (a, st) => drawEye(a || accent(), st || cfg.style), font: (src, id) => drawFont(src, fontSpec(id || cfg.fontChoice)), line: renderLine },
    _fontReady: (id) => fontReady(fontSpec(id || cfg.fontChoice)),
    parseFnt,
    FONTS,
    get _config() { return cfg; }
};

module.exports = { id: 'emu-skin', name: 'Emulator overlay', start, applyFiles, hexRgb, parseFnt, buildFnt, SIZES, FILES, FONTS, BACKUP, STYLES, secondOf };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
