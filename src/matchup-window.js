/**
 * Fightcord: matchup notes in their own window (3.16)
 *
 * The matchup guide and your note on a character, in a small window of its own that stays open
 * while you play (Mushn1k: "keep this open during matches, as a reference to the side"). Put the
 * emulator in a window and this next to it.
 *
 *   - opened with Pop out in a matchup's notes (the game hub's Matchups tab, the VS screen…)
 *   - follows your matches: when your opponent picks a character, it shows that one (can be off)
 *   - stays on top of the emulator (can be off), keeps its place and size, and comes back after
 *     Fightcade restarts if it was open
 *   - your note can be written right there, mid-set
 *
 * The window is a plain page with no access to anything: Fightcord fills it in and picks up what
 * you click in it a few times a second (no messages from the page to Fightcade itself).
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // matchup-window-config.json
const T = (s, v) => (fc && fc.t ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));

const TITLE = 'Fightcord matchup notes';
const W = 380, H = 640;

/* --------------------------------------------------------------- the page */

const PAGE_CSS = `
html, body { margin: 0; height: 100%; background: var(--fc-s1, #2b2d31); color: var(--fc-text, #dbdee1); font: 13px/1.4 var(--fc-font, 'Segoe UI', sans-serif); overflow: hidden; }
* { box-sizing: border-box; }
body { display: flex; flex-direction: column; box-shadow: inset 0 0 0 1px var(--fc-tint-2, rgba(255,255,255,.06)); }
.fc-ic { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
header { display: flex; align-items: center; height: 44px; padding: 0 6px 0 10px; background: var(--fc-s0, #1e1f22); -webkit-app-region: drag; flex: none; }
header select, header button, .opts label, main a, textarea, .row button { -webkit-app-region: no-drag; }
#face { flex: none; margin-right: 8px; }
#face .fc-mu-face { --s: 26px; }
.vs { color: var(--fc-muted, #949ba4); font-weight: 700; margin-right: 6px; }
select { min-width: 0; max-width: 170px; height: 28px; padding: 0 6px; border: 0; border-radius: var(--fc-r2, 6px); background: var(--fc-s2, #313338);
    color: var(--fc-head, #f2f3f5); font: 700 14px var(--fc-font, 'Segoe UI', sans-serif); outline: none; cursor: pointer; }
select:focus-visible { box-shadow: 0 0 0 2px var(--fc-accent, #f0b232); }
#rec { flex: 1; min-width: 0; margin-left: 8px; color: var(--fc-muted, #949ba4); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header button { display: grid; place-items: center; width: 30px; height: 30px; margin-left: 2px; border: 0; border-radius: var(--fc-r2, 6px); background: none;
    color: var(--fc-muted, #949ba4); cursor: pointer; }
header button:hover { background: var(--fc-tint-2, rgba(255,255,255,.06)); color: var(--fc-head, #f2f3f5); }
header button.on { color: var(--fc-accent, #f0b232); }
header button:focus-visible { outline: 2px solid var(--fc-accent, #f0b232); outline-offset: -2px; }
.opts { display: flex; align-items: center; padding: 6px 12px; color: var(--fc-muted, #949ba4); font-size: 12px; border-bottom: 1px solid var(--fc-tint-2, rgba(255,255,255,.06)); flex: none; }
.opts label { display: flex; align-items: center; cursor: pointer; }
.opts input { margin: 0 6px 0 0; accent-color: var(--fc-accent, #f0b232); }
#live { margin-left: auto; color: var(--fc-accent, #f0b232); font-weight: 700; }
main { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px; }
main::-webkit-scrollbar { width: 8px; }
main::-webkit-scrollbar-thumb { background: var(--fc-tint-3, rgba(255,255,255,.1)); border-radius: 4px; }
.empty { color: var(--fc-muted, #949ba4); }
.mine { flex: none; padding: 10px 14px 12px; border-top: 1px solid var(--fc-tint-2, rgba(255,255,255,.06)); background: var(--fc-s0, #1e1f22); }
.mine small { display: block; margin-bottom: 4px; color: var(--fc-muted, #949ba4); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; }
textarea { display: block; width: 100%; height: 64px; padding: 7px 9px; resize: none; border: 0; border-radius: var(--fc-r2, 6px); background: var(--fc-s2, #313338);
    color: var(--fc-text, #dbdee1); font: 13px/1.4 var(--fc-font, 'Segoe UI', sans-serif); outline: none; }
textarea:focus { box-shadow: 0 0 0 2px var(--fc-accent, #f0b232); }
.row { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; color: var(--fc-muted, #949ba4); font-size: 11px; }
.row button { height: 26px; padding: 0 12px; border: 0; border-radius: var(--fc-r2, 6px); background: var(--fc-accent, #f0b232); color: var(--fc-on-accent, #1e1f22);
    font: 700 12px var(--fc-font, 'Segoe UI', sans-serif); cursor: pointer; }
.row button[disabled] { opacity: .45; cursor: default; }
`;

// the page queues what you do; Fightcord takes the queue (window.__take) a few times a second
const PAGE_JS = `
var q = [], dirty = false, st = null;
function $(id) { return document.getElementById(id); }
function send(c, v) { q.push({ c: c, v: v }); }
window.__take = function () { var o = q; q = []; return o; };
window.__set = function (s) {
    st = s;
    document.title = s.title;
    $('vars').textContent = ':root{' + s.vars + '}';
    $('face').innerHTML = s.face || '';
    $('vs').textContent = s.vsLabel;
    var sel = $('ch');
    if (sel.getAttribute('data-list') !== s.chars.join('|')) {
        sel.innerHTML = '';
        s.chars.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
        sel.setAttribute('data-list', s.chars.join('|'));
    }
    sel.value = s.ch;
    $('rec').textContent = s.rec || '';
    var pin = $('pin'); pin.className = s.pin ? 'on' : ''; pin.title = s.pinTitle; pin.setAttribute('aria-pressed', s.pin ? 'true' : 'false');
    pin.innerHTML = s.icPin; $('close').innerHTML = s.icClose; $('close').title = s.closeTitle;
    $('follow').checked = !!s.follow; $('followTx').textContent = s.followLabel; $('followL').title = s.followHint;
    $('live').textContent = s.live || '';
    var body = $('body');
    if (body.getAttribute('data-key') !== s.key) { body.innerHTML = s.html; body.scrollTop = 0; body.setAttribute('data-key', s.key); }
    else if (body.getAttribute('data-html') !== String(s.html.length)) body.innerHTML = s.html;
    body.setAttribute('data-html', String(s.html.length));
    $('mineL').textContent = s.noteLabel;
    var ta = $('note');
    ta.placeholder = s.notePh;
    if (!dirty || ta.getAttribute('data-key') !== s.key) { ta.value = s.note || ''; dirty = false; }
    ta.setAttribute('data-key', s.key);
    $('save').textContent = s.saveLabel; $('save').disabled = !dirty; $('hint').textContent = s.saveHint;
};
document.addEventListener('DOMContentLoaded', function () {
    $('ch').addEventListener('change', function (e) { send('char', e.target.value); });
    $('pin').addEventListener('click', function () { send('pin'); });
    $('close').addEventListener('click', function () { send('close'); });
    $('follow').addEventListener('change', function (e) { send('follow', e.target.checked); });
    var ta = $('note');
    ta.addEventListener('input', function () { dirty = true; $('save').disabled = false; });
    function save() { if (!dirty) return; send('save', ta.value); dirty = false; $('save').disabled = true; }
    $('save').addEventListener('click', save);
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); save(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.activeElement !== ta) send('close'); });
    // links open in your browser, never in this window
    document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        e.preventDefault();
        if (/^https?:/.test(a.href)) send('open', a.href);
    }, true);
});`;

const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>' + TITLE + '</title><style id="vars"></style><style id="mu"></style><style>' + PAGE_CSS +
    '</style></head><body>' +
    '<header><span id="face"></span><span class="vs" id="vs"></span><select id="ch" aria-label="Character"></select><span id="rec"></span>' +
    '<button id="pin" type="button"></button><button id="close" type="button"></button></header>' +
    '<div class="opts"><label id="followL"><input type="checkbox" id="follow"><span id="followTx"></span></label><span id="live"></span></div>' +
    '<main id="body"></main>' +
    '<section class="mine"><small id="mineL"></small><textarea id="note" maxlength="500"></textarea>' +
    '<div class="row"><span id="hint"></span><button id="save" type="button" disabled></button></div></section>' +
    '<script>' + PAGE_JS + '</script></body></html>';

/* -------------------------------------------------------- where it goes */

// a saved place that still lands on a screen, else the right side of Fightcade's window
// (saved / fcBounds: {x, y, width, height}; areas: the screens' work areas)
function placeFor(saved, areas, fcBounds) {
    const ok = (b) => b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 260 && b.height >= 260;
    const visible = (b) => (areas || []).some(a => b.x + 80 <= a.x + a.width && b.x + b.width - 80 >= a.x && b.y >= a.y - 10 && b.y + 40 <= a.y + a.height);
    if (ok(saved) && visible(saved)) return { x: Math.round(saved.x), y: Math.round(saved.y), width: Math.round(saved.width), height: Math.round(saved.height) };
    const f = ok(fcBounds) ? fcBounds : (areas && areas[0]) || { x: 0, y: 0, width: 1280, height: 720 };
    const a = (areas || []).find(z => f.x + f.width / 2 >= z.x && f.x + f.width / 2 < z.x + z.width) || (areas && areas[0]) || f;
    const height = Math.min(H, a.height - 40);
    return { x: Math.round(Math.min(f.x + f.width - W - 24, a.x + a.width - W - 8)), y: Math.round(Math.max(a.y + 8, f.y + 64)), width: W, height: Math.round(height) };
}

/* -------------------------------------------------------------- the window */

let remote = null, win = null, ready = false, timer = 0, lastBounds = '';
let view = null;                       // { rom, ch, as, live }

function electron() {
    if (remote) return remote;
    try { remote = require('electron').remote || null; } catch (e) { remote = null; }
    return remote;
}
const alive = () => !!(win && !win.isDestroyed());

// a window left behind by a page that reloaded (Fightcord restarting) is closed; ours opens again
function closeStale() {
    const r = electron();
    if (!r || !r.BrowserWindow) return;
    try { r.BrowserWindow.getAllWindows().forEach(w => { if (w !== win && !w.isDestroyed() && w.getTitle().indexOf(TITLE) === 0) w.destroy(); }); } catch (e) { /* fine */ }
}

function makeWindow() {
    const r = electron();
    if (!r || !r.BrowserWindow) return null;
    let fcB = null, areas = [];
    try { fcB = r.getCurrentWindow().getBounds(); } catch (e) { /* none */ }
    try { areas = r.screen.getAllDisplays().map(d => d.workArea); } catch (e) { /* none */ }
    const b = placeFor(cfg.bounds, areas, fcB);
    ready = false;
    win = new r.BrowserWindow(Object.assign(b, {
        show: false, frame: false, resizable: true, minWidth: 280, minHeight: 300, maximizable: false, fullscreenable: false,
        alwaysOnTop: cfg.pin !== false, title: TITLE, backgroundColor: '#2b2d31',
        webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false }
    }));
    if (cfg.pin !== false) { try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (e) { /* plain on-top */ } }
    const me = win;
    win.webContents.once('did-finish-load', () => {
        if (me !== win || !alive()) return;
        ready = true;
        try { win.webContents.executeJavaScript('document.getElementById("mu").textContent=' + JSON.stringify(muCss())); } catch (e) { /* closing */ }
        render();
        try { win.showInactive(); } catch (e) { win.show(); }
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
    return win;
}

// the guide's own CSS, so the guide looks the same in here
function muCss() {
    const el = document.getElementById('fcMuStyle');
    return el ? el.textContent : '';
}

const VARS = ['--fc-font', '--fc-text', '--fc-head', '--fc-muted', '--fc-link', '--fc-accent', '--fc-on-accent', '--fc-s0', '--fc-s1', '--fc-s2', '--fc-s3',
    '--fc-tint-2', '--fc-tint-3', '--fc-r2', '--fc-r3'];
function varsCss() {
    let cs = null;
    try { cs = getComputedStyle(document.documentElement); } catch (e) { return ''; }
    return VARS.map(v => { const x = cs.getPropertyValue(v).trim(); return x ? v + ':' + x + ';' : ''; }).join('');
}

// your own 3rd Strike art lives at blob: addresses only Fightcade's page can open: copy them over
const dataUrls = new Map();
function inlineBlobs(html) {
    const blobs = Array.from(new Set((html.match(/src="blob:[^"]+"/g) || []).map(s => s.slice(5, -1))));
    if (!blobs.length) return Promise.resolve(html);
    return Promise.all(blobs.map(u => dataUrls.has(u) ? Promise.resolve() : new Promise((res) => {
        const img = new Image();
        img.onload = () => {
            try { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); dataUrls.set(u, c.toDataURL('image/png')); } catch (e) { dataUrls.set(u, ''); }
            res();
        };
        img.onerror = () => { dataUrls.set(u, ''); res(); };
        img.src = u;
    }))).then(() => blobs.reduce((h, u) => h.split(u).join(dataUrls.get(u) || ''), html));
}

const mods = (id) => (fc.modules ? fc.modules.get(id) : null);

function state() {
    const mg = mods('matchup-guide'), nt = mods('notes');
    const { rom, ch, as } = view;
    const g = mg && mg.gameOf ? mg.gameOf(rom) : null;
    const e = mg && mg.find ? mg.find(rom, ch) : null;
    const name = e ? e.name : ch;
    const list = mg && mg.charsOf ? mg.charsOf(rom) : [];
    const rec = nt && nt.matchupRecord ? nt.matchupRecord(rom, name) : null;
    const note = nt && nt.matchup ? nt.matchup(rom, name) : null;
    const card = mg && mg.cardHtml ? mg.cardHtml(rom, name, as || (nt && nt.myMain ? nt.myMain(rom) : '')) : '';
    const fe = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return {
        title: TITLE + ': ' + name,
        key: rom + '|' + name + '|' + (as || ''),
        vars: varsCss(),
        face: mg && mg.faceHtml ? mg.faceHtml(rom, name, 26) : '',
        vsLabel: T('vs'),
        chars: list.length ? (list.indexOf(name) >= 0 ? list : list.concat(name)) : [name],
        ch: name,
        rec: rec && (rec.w || rec.l) ? T('Your record: {wl}', { wl: fc.fmt.wl(rec) }) : (g ? g.name : ''),
        pin: cfg.pin !== false, pinTitle: T('Keep on top of the game'),
        icPin: fc.ui.ic('pin'), icClose: fc.ui.ic('close'), closeTitle: T('Close'),
        follow: cfg.follow !== false, followLabel: T('Follow my matches'), followHint: T('Shows your opponent’s character when they pick one'),
        live: view.live ? T('In your match') : '',
        html: card || `<p class="empty">${fe(T('No guide for this game yet: your note is below'))}</p>`,
        noteLabel: T('Your note'), note: note ? note.text : '', notePh: T('What works against {char}…', { char: name }),
        saveLabel: T('Save'), saveHint: T('Enter saves, Shift+Enter for a new line')
    };
}

let renderSeq = 0;
function render() {
    if (!alive() || !ready || !view) return;
    const s = state(), seq = ++renderSeq;
    Promise.all([inlineBlobs(s.html), inlineBlobs(s.face)]).then(([html, face]) => {
        if (seq !== renderSeq || !alive()) return;
        s.html = html; s.face = face;
        win.webContents.executeJavaScript('window.__set(' + JSON.stringify(s) + ')').catch(() => { /* reloading */ });
    });
}

function tick() {
    if (!alive()) { stopTimer(); win = null; if (cfg.open) { cfg.open = false; store.save(); } return; }
    if (!ready) return;
    try {
        const b = JSON.stringify(win.getBounds());
        if (b !== lastBounds) { lastBounds = b; cfg.bounds = JSON.parse(b); store.save(); }
    } catch (e) { /* closing */ }
    win.webContents.executeJavaScript('window.__take ? window.__take() : []').then((cmds) => (cmds || []).forEach(run)).catch(() => { /* closing */ });
}
function stopTimer() { if (timer) clearInterval(timer); timer = 0; }

function run(cmd) {
    if (!cmd || !view) return;
    const nt = mods('notes');
    if (cmd.c === 'close') close();
    else if (cmd.c === 'pin') {
        cfg.pin = cfg.pin === false;
        store.save();
        try { win.setAlwaysOnTop(cfg.pin, 'screen-saver'); } catch (e) { /* closing */ }
        render();
    } else if (cmd.c === 'follow') { cfg.follow = !!cmd.v; store.save(); render(); }
    else if (cmd.c === 'char' && cmd.v) { view = Object.assign({}, view, { ch: String(cmd.v), live: false }); remember(); render(); }
    else if (cmd.c === 'save' && nt && nt.setMatchup) nt.setMatchup(view.rom, view.ch, String(cmd.v || ''));     // -> notes:changed -> render
    else if (cmd.c === 'open' && /^https?:\/\//.test(cmd.v || '')) { try { require('electron').shell.openExternal(cmd.v); } catch (e) { window.open(cmd.v, '_blank'); } }
}

function remember() { cfg.last = { rom: view.rom, ch: view.ch, as: view.as || '' }; store.save(); }

// open (or bring up) the window on a character. as: the character you play, for your own tips
function open(rom, ch, as) {
    if (!cfg || !ch) return false;
    view = { rom: rom || '', ch: String(ch), as: as || '', live: false };
    remember();
    if (!cfg.open) { cfg.open = true; store.save(); }
    if (alive()) { render(); try { win.showInactive(); } catch (e) { /* fine */ } return true; }
    closeStale();
    if (!makeWindow()) return false;
    if (!timer) timer = setInterval(tick, 300);
    fc.emit('matchup-window:open', { rom, ch });
    return true;
}

function close(keepOpen) {
    stopTimer();
    const w = win;
    win = null; ready = false; lastBounds = '';
    try { if (w && !w.isDestroyed()) { cfg.bounds = w.getBounds(); w.destroy(); } } catch (e) { /* gone */ }
    if (!keepOpen) cfg.open = false;
    if (store) store.save();
}

// your opponent picked: show that character (when following)
function onCharacter(ev) {
    if (!alive() || !ev || !ev.char || cfg.follow === false) return;
    const mg = mods('matchup-guide'), e = mg && mg.find ? mg.find(ev.rom, ev.char) : null;
    view = { rom: ev.rom || view.rom, ch: e ? e.name : ev.char, as: ev.mine || view.as, live: true };
    remember();
    render();
}

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('matchup-window', { pin: true, follow: true, open: false, bounds: null, last: null });
    cfg = store.data;
    fc.on('match:character', onCharacter);
    fc.on('notes:changed', () => render());
    fc.on('match:end', () => { if (view && view.live) { view.live = false; render(); } });
    closeStale();
    // it was open when Fightcade closed: it comes back
    if (cfg.open && cfg.last && cfg.last.ch) setTimeout(() => { if (cfg.open && !alive()) open(cfg.last.rom, cfg.last.ch, cfg.last.as); }, 1500);
    fc.own(() => close(true));
    return api;
}

const api = { open, close: () => close(), isOpen: alive };

module.exports = { id: 'matchup-window', name: 'Matchup window', start, _test: { placeFor, PAGE, PAGE_JS } };
