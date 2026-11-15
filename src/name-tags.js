/**
 * Fightcord: names in the game picture (3.15)
 *
 * During your FBNeo matches, each player's name, flag and rank sits in the game picture itself,
 * under the life bars, the way training scripts draw them. The emulator draws its own bar at a fixed
 * spot and runs no scripts online, so Fightcord shows the tags in a see-through window laid exactly
 * over the emulator's picture. Clicks go straight through it and the game is never touched.
 *
 *   - follows the emulator window (moved, resized, minimised) and hides when it isn't in front
 *   - works windowed and in borderless fullscreen; the emulator's exclusive fullscreen draws over
 *     every other window, so the tags can't show there
 *   - one layout for every game, an exact one for 3rd Strike, and your own per game (Settings ->
 *     Appearance -> Names in the game picture, with a preview over the open emulator)
 *
 * The window is found by a small read-only helper (C#, compiled by Windows PowerShell like the
 * goal reader in fight-stats.js) that only asks Windows where the emulator's window is.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, cfg = null;          // name-tags-config.json
const T = (s, v) => (fc && fc.t ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));

/* ------------------------------------------------------------------ layout */

// percentages of the game picture: x = from the side, y = the tag's top, size = the tag's height
const DEFAULT_LAYOUT = { x: 8, y: 14, size: 5 };
// games whose life bars are known (rom prefix -> layout); everything else starts from the default
const PRESETS = [
    [/^sfiii3/i, { x: 13, y: 20, size: 5 }]            // 3rd Strike: under the portrait boxes, like the training script
];
const LIMITS = { x: [0, 40], y: [0, 90], size: [3, 12] };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function cleanLayout(l) {
    const o = {};
    Object.keys(LIMITS).forEach(k => { const v = +(l && l[k]); o[k] = clamp(isFinite(v) ? Math.round(v) : DEFAULT_LAYOUT[k], LIMITS[k][0], LIMITS[k][1]); });
    return o;
}
// the layout for a game: yours, else its preset, else the default
function layoutFor(rom, mine) {
    const own = mine && rom && mine[String(rom).toLowerCase()];
    if (own) return cleanLayout(own);
    const p = PRESETS.find(x => x[0].test(String(rom || '')));
    return cleanLayout(p ? p[1] : DEFAULT_LAYOUT);
}

// where the game picture sits inside the emulator's client area (same units as client):
// FBNeo stretches it to fill ("allow stretching") or fits it at the game's shape, centred
function pictureRect(client, opts) {
    const c = client || {}, o = opts || {};
    const w = Math.max(0, +c.w || 0), h = Math.max(0, +c.h || 0);
    if (!w || !h) return null;
    if (o.stretch) return { x: +c.x || 0, y: +c.y || 0, w, h };
    const aspect = +o.aspect > 0 ? +o.aspect : 4 / 3;
    let pw = w, ph = w / aspect;
    if (ph > h) { ph = h; pw = h * aspect; }
    return { x: (+c.x || 0) + (w - pw) / 2, y: (+c.y || 0) + (h - ph) / 2, w: pw, h: ph };
}

// the two tags inside a picture of w x h: P1 on the left, P2 mirrored on the right
function tagSpots(w, h, layout) {
    const l = cleanLayout(layout);
    const th = Math.max(8, Math.round(h * l.size / 100));
    const top = Math.round(h * l.y / 100);
    const side = Math.round(w * l.x / 100);
    return { h: th, p1: { left: side, top }, p2: { right: side, top } };
}

// the emulator's ini -> { stretch } (FBNeo: bVidFullStretch 1 = fill the window, else keep the shape)
function iniPicture(text) {
    const t = String(text || '');
    return { stretch: /^[ \t]*bVidFullStretch[ \t]+1[ \t\r]*$/m.test(t) };
}

/* ----------------------------------------------------------- window helper */

const TRACKER_CS = String.raw`using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Fightcord: where is the emulator's window? Only asks Windows about it; never touches the emulator.
public static class FcWinTracker {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);

    static void Say(string s) { Console.Out.WriteLine(s); Console.Out.Flush(); }

    public static void Run() {
        // Fightcord closes our input when it stops (or quits): stop with it
        var stdin = new Thread(delegate () { try { Console.In.ReadToEnd(); } catch (Exception) { } Environment.Exit(0); });
        stdin.IsBackground = true; stdin.Start();
        // real screen pixels, whatever the scaling of the monitor the emulator is on
        try { SetThreadDpiAwarenessContext((IntPtr)(-4)); } catch (Exception) { }
        string last = "";
        int pid = 0; IntPtr win = IntPtr.Zero; DateTime looked = DateTime.MinValue;
        while (true) {
            string now;
            try {
                if (win == IntPtr.Zero || (DateTime.UtcNow - looked).TotalSeconds > 2) {
                    looked = DateTime.UtcNow; win = IntPtr.Zero; pid = 0;
                    foreach (var p in Process.GetProcessesByName("fcadefbneo")) {
                        if (p.MainWindowHandle != IntPtr.Zero) { win = p.MainWindowHandle; pid = p.Id; break; }
                    }
                }
                RECT r; POINT o = new POINT();
                if (win == IntPtr.Zero || !IsWindowVisible(win) || !GetClientRect(win, out r) || !ClientToScreen(win, ref o)) now = "{\"none\":1}";
                else {
                    uint fgPid; GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
                    now = "{\"x\":" + o.X + ",\"y\":" + o.Y + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) +
                        ",\"fg\":" + (fgPid == (uint)pid ? 1 : 0) + ",\"min\":" + (IsIconic(win) ? 1 : 0) + "}";
                }
            } catch (Exception) { now = "{\"none\":1}"; win = IntPtr.Zero; }
            if (now != last) { last = now; Say(now); }
            Thread.Sleep(30);
        }
    }
}
`;

let tracker = null;                    // the PowerShell helper
let rect = null;                       // its last answer { x, y, w, h, fg, min } (screen pixels) or null

function csFile() {
    const f = path.join(__dirname, 'win-tracker.cs');
    let have = null;
    try { have = fs.readFileSync(f, 'utf8'); } catch (e) { /* not written yet */ }
    if (have !== TRACKER_CS) fs.writeFileSync(f, TRACKER_CS, 'utf8');
    return f;
}

function startTracker() {
    if (tracker) return;
    let cp = null;
    try { cp = require('child_process'); } catch (e) { return; }
    let cs;
    try { cs = csFile(); } catch (e) { fc.log('could not write the window helper', e && e.message); return; }
    const cmd = "Add-Type -Path '" + cs.replace(/'/g, "''") + "'; [FcWinTracker]::Run()";
    let c;
    try { c = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return; }
    tracker = c;
    let buf = '', err = '';
    c.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (line[0] !== '{') continue;
            try { const o = JSON.parse(line); rect = o.none ? null : o; } catch (e) { continue; }
            place();
        }
    });
    c.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    c.on('error', () => { if (tracker === c) tracker = null; });
    c.on('exit', (code) => { if (tracker === c) { tracker = null; rect = null; place(); } if (code) fc.log('window helper exited', code, err.trim()); });
}

function stopTracker() {
    const c = tracker;
    tracker = null; rect = null;
    if (!c) return;
    try { c.stdin.end(); } catch (e) { /* gone */ }
    setTimeout(() => { try { c.kill(); } catch (e) { /* gone */ } }, 3000);
}

/* ------------------------------------------------------------ the overlay */

const TITLE = 'Fightcord names';
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>' + TITLE + '</title><style>' +
    'html,body{margin:0;background:transparent;overflow:hidden;width:100%;height:100%;-webkit-user-select:none;user-select:none}' +
    'img{position:absolute;display:block;pointer-events:none}</style></head><body><img id="p1" hidden><img id="p2" hidden><script>' +
    'window.__set=function(s){["p1","p2"].forEach(function(k){var e=document.getElementById(k),t=s&&s[k];' +
    'if(!t){e.hidden=true;return;}if(e.getAttribute("src")!==t.src)e.src=t.src;e.style.height=t.h+"px";e.style.top=t.top+"px";' +
    'e.style.left=t.left!=null?t.left+"px":"auto";e.style.right=t.right!=null?t.right+"px":"auto";e.hidden=false;});};</script></body></html>';

let remote = null, win = null, winReady = false, pending = null;

function electron() {
    if (remote) return remote;
    try { remote = require('electron').remote || null; } catch (e) { remote = null; }
    return remote;
}

function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    const r = electron();
    if (!r || !r.BrowserWindow) return null;
    winReady = false;
    win = new r.BrowserWindow({
        width: 10, height: 10, show: false, frame: false, transparent: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
        hasShadow: false, alwaysOnTop: true, title: TITLE,
        webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false }
    });
    try { win.setIgnoreMouseEvents(true); } catch (e) { /* older */ }
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (e) { /* plain on-top then */ }
    const me = win;
    win.webContents.once('did-finish-load', () => { if (me !== win) return; winReady = true; if (pending) push(pending); });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
    return win;
}

function closeWindow() {
    const w = win;
    win = null; winReady = false; pending = null; shownState = '';
    try { if (w && !w.isDestroyed()) w.destroy(); } catch (e) { /* gone */ }
}

// a window left over from a page that reloaded (Fightcord restarting) would float there forever
function closeStale() {
    const r = electron();
    if (!r || !r.BrowserWindow) return;
    try { r.BrowserWindow.getAllWindows().forEach(w => { if (w !== win && !w.isDestroyed() && w.getTitle() === TITLE) w.destroy(); }); } catch (e) { /* fine */ }
}

let shownState = '';
function push(state) {
    pending = state;
    if (!win || win.isDestroyed() || !winReady) return;
    const s = JSON.stringify(state);
    if (s === shownState) return;
    shownState = s;
    win.webContents.executeJavaScript('window.__set(' + s + ')').catch(() => { /* reloading */ });
}

// screen pixels -> the units Electron places windows in
function toDip(r) {
    const e = electron();
    const sc = e && e.screen;
    if (sc && typeof sc.screenToDipRect === 'function') {
        try { return sc.screenToDipRect(null, { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) }); } catch (e2) { /* below */ }
    }
    const f = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return { x: Math.round(r.x / f), y: Math.round(r.y / f), width: Math.round(r.w / f), height: Math.round(r.h / f) };
}
function scaleAt(dip) {
    const e = electron();
    try { return e.screen.getDisplayMatching(dip).scaleFactor || 1; } catch (err) { return (typeof window !== 'undefined' && window.devicePixelRatio) || 1; }
}

/* ------------------------------------------------------------- the tags */

let names = null;                      // { p1: {name, rank, cc}, p2: {...} } for this match / preview
let preview = 0;                       // until when the preview shows
let match = null;                      // { quark, rom, game }
let pic = { stretch: false };          // from the emulator's ini
const imgCache = new Map();            // file -> Promise<HTMLImageElement | null>

function uiFile(rel) { return path.resolve(__dirname, '..', '..', '..', '..', '..', 'emulator', 'fbneo', 'ui', rel); }
function loadImg(rel) {
    if (imgCache.has(rel)) return imgCache.get(rel);
    const p = new Promise((resolve) => {
        let buf = null;
        try { buf = fs.readFileSync(uiFile(rel)); } catch (e) { resolve(null); return; }
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = 'data:image/png;base64,' + buf.toString('base64');
    });
    imgCache.set(rel, p);
    return p;
}

const theme = () => { const th = fc.modules.get('discord-theme'); const t = th && th.theme ? th.theme() : null; return t && t.enabled !== false ? t : {}; };
const accent = () => theme().accent || '#5865f2';
const fontFamily = () => { const d = fc.modules.get('display-font'); return (d && d.family ? "'" + d.family + "', " : '') + "'Segoe UI', sans-serif"; };

// one tag as a picture: [accent edge][flag][name][rank], mirrored for P2. hp = its height in pixels
async function drawTag(p, side, hp) {
    const [flag, rank] = await Promise.all([p.cc ? loadImg('flags/' + p.cc + '.png') : null, loadImg('rank' + (fc.data.rankNum(p.rank) || 0) + '.png')]);
    const font = '600 ' + Math.round(hp * 0.62) + 'px ' + fontFamily();
    try { if (document.fonts && document.fonts.load) await document.fonts.load(font, p.name || 'A'); } catch (e) { /* system font */ }
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    x.font = font;
    const pad = Math.round(hp * 0.28), edge = Math.max(2, Math.round(hp * 0.1)), gap = Math.round(hp * 0.22);
    const fh = flag ? Math.round(hp * 0.46) : 0, fw = flag ? Math.round(fh * flag.width / flag.height) : 0;
    const rs = rank ? Math.round(hp * 0.74) : 0;
    const name = String(p.name || '');
    let nameW = Math.ceil(x.measureText(name).width);
    const maxName = hp * 9;
    let shown = name;
    if (nameW > maxName) {
        while (shown.length > 1 && x.measureText(shown + '…').width > maxName) shown = shown.slice(0, -1);
        shown += '…';
        nameW = Math.ceil(x.measureText(shown).width);
    }
    const w = edge + pad + (fw ? fw + gap : 0) + nameW + (rs ? gap + rs : 0) + pad;
    c.width = w; c.height = hp;
    x.font = font;
    // the plate: dark glass, the accent edge on the outside
    x.fillStyle = 'rgba(8, 10, 16, 0.82)';
    x.fillRect(0, 0, w, hp);
    x.fillStyle = accent();
    x.fillRect(side === 1 ? 0 : w - edge, 0, edge, hp);
    // the pieces in reading order, laid out from the outer edge inwards
    const parts = [];
    if (fw) parts.push({ w: fw, draw: (at) => x.drawImage(flag, at, Math.round((hp - fh) / 2), fw, fh) });
    parts.push({ w: nameW, draw: (at) => { x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = Math.round(hp * 0.06); x.fillText(shown, at, Math.round(hp * 0.53)); x.shadowBlur = 0; } });
    if (rs) parts.push({ w: rs, draw: (at) => x.drawImage(rank, at, Math.round((hp - rs) / 2), rs, rs) });
    if (side === 2) parts.reverse();
    let at = side === 1 ? edge + pad : pad;
    parts.forEach((pt, i) => { pt.draw(at); at += pt.w + (i < parts.length - 1 ? gap : 0); });
    return c.toDataURL('image/png');
}

let drawn = { key: '', p1: null, p2: null };
let drawing = null;
async function tagsFor(hp) {
    const key = JSON.stringify([names, hp, accent()]);
    if (drawn.key === key) return drawn;
    if (drawing && drawing.key === key) return drawing.p;
    const p = Promise.all([drawTag(names.p1, 1, hp), drawTag(names.p2, 2, hp)])
        .then(([a, b]) => { drawn = { key, p1: a, p2: b }; return drawn; });
    drawing = { key, p };
    return p;
}

const active = () => !!(cfg && cfg.enabled && names && (match || preview > Date.now()));

// put everything where it belongs (called on every change of the window, the names or the layout)
let placing = 0;
function place() {
    if (!fc) return;
    const visible = active() && rect && rect.fg && !rect.min && rect.w > 40 && rect.h > 40;
    if (!visible) { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); return; }
    const p = pictureRect(rect, pic);
    if (!p) return;
    const dip = toDip(p);
    const w = ensureWindow();
    if (!w) return;
    const b = w.getBounds();
    if (b.x !== dip.x || b.y !== dip.y || b.width !== dip.width || b.height !== dip.height) w.setBounds(dip);
    const spots = tagSpots(dip.width, dip.height, layoutFor(cfg.rom, cfg.layouts));
    const scale = scaleAt(dip);
    const run = ++placing;
    tagsFor(Math.round(spots.h * scale)).then((t) => {
        if (run !== placing || !win || win.isDestroyed()) return;
        push({ p1: { src: t.p1, h: spots.h, top: spots.p1.top, left: spots.p1.left }, p2: { src: t.p2, h: spots.h, top: spots.p2.top, right: spots.p2.right } });
        if (!win.isVisible()) win.showInactive();
    }).catch((e) => fc.log.warn('name tags', e && e.message));
}

/* -------------------------------------------------------------- matches */

function readIni() {
    return new Promise((resolve) => {
        const f = path.resolve(__dirname, '..', '..', '..', '..', '..', 'emulator', 'fbneo', 'config', 'fcadefbneo.ini');
        fs.readFile(f, 'latin1', (e, text) => { pic = iniPicture(e ? '' : text); resolve(pic); });
    });
}

const isFbneo = (ev) => {
    const c = ev && ev.channel ? fc.app.channel(ev.channel) : null;
    return c && c.emulator ? /fbneo/i.test(c.emulator) : !!(ev && ev.rom);
};
const gameOf = (ev) => { const c = ev && ev.channel ? fc.app.channel(ev.channel) : null; return (c && c.name) || (ev && ev.rom) || ''; };

function useRom(rom, game) {
    if (!rom) return;
    const r = String(rom).toLowerCase();
    if (cfg.rom === r && (!game || cfg.game === game)) return;
    cfg.rom = r;
    if (game) cfg.game = game;
    Object.assign(cfg, layoutFor(r, cfg.layouts));
    store.save();
    fc.settings.refresh('name-tags');
}

let nameTimer = null;
function begin(ev) {
    if (!cfg.enabled || !ev || !ev.quark || !isFbneo(ev)) return;
    match = { quark: ev.quark };
    names = null;
    useRom(ev.rom, gameOf(ev));
    readIni().then(() => { startTracker(); closeStale(); });
    // the emulator writes its match files a moment after it starts
    clearInterval(nameTimer);
    let tries = 0;
    nameTimer = setInterval(() => {
        const m = fc.emu.match(match ? match.quark : null);
        if (m && m.p1 && m.p1.name && m.p2 && m.p2.name) {
            names = { p1: { name: m.p1.name, rank: m.p1.rank, cc: m.p1.cc }, p2: { name: m.p2.name, rank: m.p2.rank, cc: m.p2.cc } };
            clearInterval(nameTimer); nameTimer = null;
            place();
        } else if (++tries > 90 || !match) { clearInterval(nameTimer); nameTimer = null; }
    }, 1000);
}

function end() {
    match = null;
    clearInterval(nameTimer); nameTimer = null;
    if (preview > Date.now()) { place(); return; }
    names = null;
    closeWindow();
    stopTracker();
}

// Settings: sample tags over the open emulator for a minute, to set the position
let previewTimer = null;
function showPreview() {
    if (!electron()) { fc.ui.toast(T('The preview only works inside Fightcade'), { icon: 'warn' }); return; }
    const meU = fc.app.localUser() || {};
    const cc = String((meU.country && meU.country.iso_code) || 'us').toLowerCase();
    if (!match) names = { p1: { name: fc.app.me() || T('Player 1'), rank: 'B', cc }, p2: { name: T('Player 2'), rank: 'A', cc: cc === 'br' ? 'jp' : 'br' } };
    preview = Date.now() + 60000;
    readIni().then(() => { startTracker(); closeStale(); place(); });
    fc.emu.running().then((r) => { if (r === false) fc.ui.toast(T('Open the emulator to see the preview (training mode works too)'), { icon: 'info', ms: 7000 }); });
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { preview = 0; if (!match) end(); else place(); }, 60500);
}

/* ------------------------------------------------------------------ module */

function start(f) {
    fc = f;
    store = fc.config('name-tags', Object.assign({ enabled: false, rom: '', game: '', layouts: {} }, DEFAULT_LAYOUT));
    cfg = store.data;
    if (!cfg.layouts || typeof cfg.layouts !== 'object') cfg.layouts = {};
    closeStale();
    fc.on('match:start', (ev) => begin(ev));
    fc.on('match:end', () => setTimeout(() => { if (!match || !fc.app.inMatch(fc.app.me())) end(); }, 1500));
    fc.own(() => { preview = 0; match = null; clearInterval(nameTimer); clearTimeout(previewTimer); closeWindow(); stopTracker(); });

    // the sliders edit the game you played last (cfg.x / y / size); each change is kept for that game
    const keep = () => {
        if (!cfg.rom) return;
        cfg.layouts[cfg.rom] = cleanLayout(cfg);
        store.save();
        place();
    };
    const slider = (key, label, hint) => ({ key, type: 'slider', label, hint, min: LIMITS[key][0], max: LIMITS[key][1], unit: '%', live: keep, onChange: keep, show: (d) => d.enabled && !!d.rom });
    fc.settings.block({
        id: 'name-tags', section: 'appearance', title: 'Names in the game picture', hint: '— each player’s name, flag and rank under the life bars in FBNeo games',
        store, order: 66,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Show names in the game picture', hint: 'Over the emulator’s picture while you play. Clicks go through to the game',
                onChange: (v) => { if (!v) end(); } },
            { type: 'html', id: 'name-tags-game', show: (d) => d.enabled, html: (d) => `<div class="fc-note">${fc.fmt.esc(d.rom
                ? T('The position below is for {game}. Every game remembers its own.', { game: d.game || d.rom })
                : T('Play an FBNeo match first: the position is set per game.'))}</div>` },
            slider('y', 'Height', 'From the top of the picture'),
            slider('x', 'Side margin', 'From the left and right edges'),
            slider('size', 'Size', 'Of the picture’s height'),
            { type: 'button', label: 'See it over the emulator', hint: 'Shows sample names for a minute while you move the sliders', button: 'Preview', act: 'nt-preview',
                show: (d) => d.enabled, onClick: () => showPreview() },
            { type: 'button', label: 'Default position for this game', button: 'Reset position', act: 'nt-reset',
                show: (d) => d.enabled && !!d.rom, onClick: () => { delete cfg.layouts[cfg.rom]; Object.assign(cfg, layoutFor(cfg.rom, cfg.layouts)); store.save(); fc.settings.refresh('name-tags'); place(); } },
            { type: 'note', label: 'Works with the emulator in a window or in borderless fullscreen. Its default fullscreen draws over every other window, so the names can’t show there.', show: (d) => d.enabled }
        ]
    });
    return api;
}

const api = {
    showPreview,
    running: () => !!tracker,
    diag: () => [
        'Name tags: ' + (cfg && cfg.enabled ? 'on' : 'off') + ', window helper ' + (tracker ? 'running' : 'stopped') + ', overlay ' + (win && !win.isDestroyed() ? (win.isVisible() ? 'shown' : 'hidden') : 'none'),
        '  emulator window: ' + JSON.stringify(rect) + ', stretch ' + !!pic.stretch + ', game ' + (cfg ? cfg.rom || '-' : '-')
    ]
};

module.exports = { id: 'name-tags', name: 'Names in the game picture', start, layoutFor, cleanLayout, pictureRect, tagSpots, iniPicture, DEFAULT_LAYOUT, PRESETS, TRACKER_CS };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
