/**
 * Fightcord core
 *
 * The shared plumbing every Fightcord module runs on. The loader (inject/inject.js)
 * loads this file first, then the modules, and starts them in dependency order:
 *
 *   module.exports = { id: 'stats', name: 'Stats', needs: ['history'],
 *                      start(fc) { ... return api; }, stop() { ... } };
 *
 * Plugins in the old shape (module.exports = function (FCADE) {...}) still load,
 * through a compatibility shim, so modules can move over one at a time.
 *
 * What a module gets as `fc` (each module its own copy, so everything it registers
 * is cleaned up if it's switched off or keeps crashing):
 *   fc.app       Fightcade's Vue app: root, me, users, channels, active channel, match state
 *   fc.modules   the module registry (get another module's API, on/off state)
 *   fc.events    one event bus  (on / once / emit)
 *   fc.tick      one shared timer (paused while the window is hidden, unless asked)
 *   fc.watch     one shared MutationObserver (debounced)
 *   fc.config    settings files: load, debounced async save, versions + migration
 *   fc.settings  settings sections and blocks (rendered once, patched on change)
 *   fc.cmd       /chat commands
 *   fc.api       the one Fightcade API client (queue, cache, backoff, timeouts)
 *   fc.hooks     the challenge pipeline and other hooks on Fightcade's methods
 *   fc.history   the match history store (match-history.json)
 *   fc.ui        the design system: icons, buttons, toasts, popovers, modals, pages, charts
 *   fc.sound     one AudioContext: chimes, sound effects, ducking under music
 *   fc.fmt / fc.data   formatting and Fightcade data helpers (pure)
 *   fc.log       a ring buffer of what happened, plus an optional debug file
 *
 * Chromium 80 / Electron 8: no flex gap, inset, :has, color-mix, aspect-ratio,
 * accent-color, replaceAll or ||= in here.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CORE_API = 1;
let DIR = __dirname;
const hasDom = () => typeof document !== 'undefined' && !!document.documentElement;
const now = () => Date.now();

/* =========================================================================== fmt */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const fmt = {
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]),

    // "LongPlayerName1234" -> "LongPlayerNa…"
    short(s, max) {
        const t = String(s == null ? '' : s);
        const n = max || 14;
        return t.length > n ? t.slice(0, n - 1) + '…' : t;
    },

    // 'just now', '5m ago', '3h ago', 'yesterday', '4d ago', '2026-03-01'
    ago(ts, at) {
        const t = typeof ts === 'number' ? ts : ts instanceof Date ? ts.getTime() : Date.parse(ts);
        if (!t || isNaN(t)) return '';
        const s = Math.max(0, Math.round(((at || now()) - t) / 1000));
        if (s < 45) return 'just now';
        if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
        if (s < 86400) return Math.round(s / 3600) + 'h ago';
        const d = Math.floor(s / 86400);
        if (d === 1) return 'yesterday';
        if (d < 30) return d + 'd ago';
        return new Date(t).toISOString().slice(0, 10);
    },

    // 3_900_000 -> '1h 05m', 720_000 -> '12m', 9_000 -> '9s'
    duration(ms) {
        const s = Math.max(0, Math.round((ms || 0) / 1000));
        if (s < 60) return s + 's';
        const m = Math.floor(s / 60);
        if (m < 60) return m + 'm';
        return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
    },

    // 75_000 -> '1:15', 3_725_000 -> '1:02:05'
    clock(ms) {
        const s = Math.max(0, Math.floor((ms || 0) / 1000));
        const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
        return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
    },

    // 'today', 'yesterday', '12d ago', '2026-03-01'
    day(d) {
        const t = d instanceof Date ? d.getTime() : typeof d === 'number' ? d : Date.parse(d);
        if (!t || isNaN(t)) return '';
        const days = Math.floor((now() - t) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 30) return days + 'd ago';
        return new Date(t).toISOString().slice(0, 10);
    },
    // "42 ms · Wi-Fi" from fc.app.userInfo() (Fightcade's own numbers)
    conn(info) {
        if (!info) return '';
        const bits = [];
        if (typeof info.ping === 'number' && info.ping > 0) bits.push(info.ping + ' ms');
        if (info.proxy) bits.push('VPN'); else if (info.wlan) bits.push('Wi-Fi');
        return bits.join(' · ');
    },
    pct: (x, digits) => (isFinite(x) ? (x * 100).toFixed(digits || 0) : '0') + '%',
    num: (n) => (+n || 0).toLocaleString('en-US'),
    plural: (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's')),
    wl: (r) => r.w + '–' + r.l + (r.d ? '–' + r.d : '')
};

/* ========================================================================== data */

const RANKS = ['', 'E', 'D', 'C', 'B', 'A', 'S'];            // Fightcade's rank numbers 1-6
const RANK_COLOR = { S: '#ffd166', A: '#ff7b72', B: '#c792ea', C: '#6aa9ff', D: '#6ee7a0', E: '#9aa4b2' };
const PALETTE = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#1abc9c', '#9b59b6', '#e67e22'];
// Rank letters stand for 300-point ELO bands (S is open-ended; 2300 caps the estimate).
const ELO_BANDS = { 1: [400, 700], 2: [700, 1000], 3: [1000, 1300], 4: [1300, 1600], 5: [1600, 1900], 6: [1900, 2300] };
const FC_ORIGIN = 'https://web.fightcade.com/';

const data = {
    RANKS, RANK_COLOR, PALETTE, ELO_BANDS, FC_ORIGIN,

    // 5 -> 'A', 'a' -> 'A', 0 / junk -> ''
    rankLetter(r) {
        if (typeof r === 'number') return RANKS[r] || '';
        const s = String(r || '').toUpperCase();
        return RANKS.indexOf(s) > 0 ? s : '';
    },
    rankNum(r) { return typeof r === 'number' ? (RANKS[r] ? r : 0) : Math.max(0, RANKS.indexOf(String(r || '').toUpperCase())); },
    rankColor(r) { return RANK_COLOR[data.rankLetter(r)] || '#9aa4b2'; },

    // the same name always gets the same colour
    hashColor(name, palette) {
        const p = palette || PALETTE;
        let h = 0;
        for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
        return p[h % p.length];
    },

    avatarUrl(name, gravatar, size) {
        const s = size || 64;
        return gravatar
            ? 'https://www.gravatar.com/avatar/' + encodeURIComponent(gravatar) + '?s=' + s + '&d=retro&r=g'
            : 'https://www.gravatar.com/avatar/' + encodeURIComponent(name || '?') + '?s=' + s + '&d=retro&f=y';
    },

    // game art; FC1 roms ('fc1_sfiii3') share the FC2 picture
    artUrl(rom, origin) {
        const o = origin || (typeof location !== 'undefined' && /fightcade\.com$/.test(location.hostname) ? location.origin + '/' : FC_ORIGIN);
        return o.replace(/\/?$/, '/') + 'static/previews/' + encodeURIComponent(String(rom || '').replace(/^fc1_/, '')) + '.png';
    },

    // spectate a running match in Fightcade
    watchUrl(m) {
        return m && m.emu && m.rom && m.quark && m.port != null
            ? 'fcade://stream/' + m.emu + '/' + m.rom + '/' + m.quark + '.2,' + m.port : '';
    },
    replayUrl(emu, rom, quark) {
        return emu && rom && quark ? 'https://replay.fightcade.com/' + emu + '/' + rom + '/' + quark : '';
    },

    // the API wraps payloads differently per request, so dig
    pickUser: (j) => (j && (j.user || (j.results && (j.results.user || (j.results.results && j.results.results[0]))))) || null,
    pickRows(j) {
        const r = j && ((j.results && j.results.results) || j.results || j.quarks);
        return Array.isArray(r) ? r : [];
    },
    quarkDate(row) {
        const d = row && (row.date != null ? row.date : row.created != null ? row.created : row.time != null ? row.time : row.timestamp);
        if (d == null) return null;
        const ms = typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : Date.parse(d);
        return isNaN(ms) ? null : new Date(ms);
    },

    // A real ELO when Fightcade gives one, else an estimate: the rank band, placed by where
    // the player sits among same-letter players on the leaderboard (ELO order).
    // board: Map(lowercased name -> {name, pos, rank}) -> { elo, est } or null
    eloFor(name, rank, board, realElo) {
        if (typeof realElo === 'number' && realElo > 0) return { elo: Math.round(realElo), est: false };
        const key = String(name || '').toLowerCase();
        const row = board && board.get(key);
        const r = +(rank || (row && row.rank) || 0);
        const band = ELO_BANDS[r];
        if (!band) return null;
        if (!row || !board) return { elo: Math.round((band[0] + band[1]) / 2), est: true };
        const same = [...board.values()].filter(x => +x.rank === r).sort((a, b) => a.pos - b.pos);
        const i = same.findIndex(x => x.name.toLowerCase() === key);
        const f = same.length > 1 && i >= 0 ? i / (same.length - 1) : 0.5;      // 0 = top of the band
        return { elo: Math.round(band[1] - f * (band[1] - band[0])), est: true };
    },
    fmtElo: (e) => e ? (e.est ? '~' : '') + e.elo.toLocaleString('en-US') : '',

    // chance to win one game (ELO expected score) and a first-to-n set built from it
    winOdds(myElo, oppElo, ft) {
        const p = 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
        const n = Math.max(1, +ft || 3);
        let set = 0, c = 1;                                  // c = C(n-1+k, k)
        for (let k = 0; k < n; k++) {
            if (k > 0) c = c * (n - 1 + k) / k;
            set += c * Math.pow(p, n) * Math.pow(1 - p, k);
        }
        return { game: p, set, ft: n };
    },

    // A session runs from 5 AM to 5 AM (a late night stays one session); clearedAt starts a fresh one.
    sessionStart(at, clearedAt) {
        const d = new Date(at || now());
        const five = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5, 0, 0, 0).getTime();
        return Math.max(d.getHours() < 5 ? five - 86400000 : five, +clearedAt || 0);
    },
    recordOf(sets) {
        const r = { w: 0, l: 0, d: 0, unknown: 0, played: (sets || []).length };
        (sets || []).forEach(s => { if (s.result === 'won') r.w++; else if (s.result === 'lost') r.l++; else if (s.result === 'draw') r.d++; else r.unknown++; });
        return r;
    },
    // current run of wins or losses over KNOWN results (unknowns skipped, a draw ends it)
    streakOf(sets) {
        let kind = null, n = 0;
        for (let i = (sets || []).length - 1; i >= 0; i--) {
            const r = sets[i].result;
            if (!r) continue;
            if (r === 'draw') break;
            if (!kind) kind = r;
            if (r !== kind) break;
            n++;
        }
        return { kind, n };
    },
    winRate: (r) => (r.w + r.l) ? r.w / (r.w + r.l) : 0
};

/* =========================================================================== log */

const RING = [];
const RING_MAX = 600;
let debugFile = false;
const logQueue = [];
let logBusy = false;

function flushLogFile() {
    if (logBusy || !logQueue.length) return;
    logBusy = true;
    const file = path.join(DIR, 'fightcord-debug.log');
    const text = logQueue.splice(0).join('');
    fs.stat(file, (err, st) => {
        const write = () => fs.appendFile(file, text, () => { logBusy = false; flushLogFile(); });
        if (!err && st.size > 400000) fs.writeFile(file, '', write);
        else write();
    });
}

function toText(x) {
    if (x instanceof Error) return x.stack || x.message;
    if (typeof x === 'string') return x;
    try { return JSON.stringify(x); } catch (e) { return String(x); }
}

function logPush(level, scope, args) {
    const text = args.map(toText).join(' ');
    RING.push({ at: now(), level, scope, text: text.length > 2000 ? text.slice(0, 2000) + '…' : text });
    if (RING.length > RING_MAX) RING.splice(0, RING.length - RING_MAX);
    const c = typeof console !== 'undefined' ? console : null;
    if (c) (level === 'error' ? c.error : level === 'warn' ? c.warn : c.log).call(c, '[' + scope + ']', ...args);
    if (debugFile) {
        logQueue.push(new Date().toISOString() + ' ' + level.toUpperCase() + ' [' + scope + '] ' + text + '\n');
        flushLogFile();
    }
}

function makeLog(scope) {
    const f = (...a) => logPush('info', scope, a);
    f.warn = (...a) => logPush('warn', scope, a);
    f.error = (...a) => logPush('error', scope, a);
    f.entries = (filter) => RING.filter(e => !filter || e.scope === filter || e.level === filter).slice();
    return f;
}
const LOG = makeLog('Fightcord');

/* ===================================================== owners + error boundaries */

// Everything a module registers is tagged with its owner record, so it can be undone.
// The core's own things belong to CORE (never switched off).
function makeOwner(id, name) {
    return { id, name: name || id, dead: false, errors: [], disposers: [], core: id === 'core' };
}
const CORE = makeOwner('core', 'Fightcord core');

function own(owner, dispose) {
    (owner || CORE).disposers.push(dispose);
    return dispose;
}

function disposeAll(owner) {
    const list = owner.disposers.splice(0);
    list.reverse().forEach(d => { try { d(); } catch (e) { /* already gone */ } });
}

// 10 errors inside a minute switches a module off (for this session)
function fault(owner, e, where) {
    const o = owner || CORE;
    logPush('error', o.name, [(where ? where + ': ' : '') + toText(e)]);
    if (o.core || o.dead) return;
    const t = now();
    o.errors.push(t);
    while (o.errors.length && t - o.errors[0] > 60000) o.errors.shift();
    if (o.errors.length >= 10 && moduleCrash) moduleCrash(o, e);
}
let moduleCrash = null;       // set by the module registry below

function guard(owner, fn, where) {
    return function () {
        if (owner && owner.dead) return undefined;
        try { return fn.apply(this, arguments); } catch (e) { fault(owner, e, where); return undefined; }
    };
}

/* ======================================================================== events */

const listeners = new Map();        // name -> [{ fn, owner }]

function eventsFor(owner) {
    const on = (name, fn) => {
        const rec = { fn: guard(owner, fn, 'event ' + name), owner };
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(rec);
        return own(owner, () => {
            const l = listeners.get(name);
            const i = l ? l.indexOf(rec) : -1;
            if (i >= 0) l.splice(i, 1);
        });
    };
    return {
        on,
        once(name, fn) { const off = on(name, (p) => { off(); fn(p); }); return off; },
        emit
    };
}

function emit(name, payload) {
    const l = listeners.get(name);
    if (!l || !l.length) return 0;
    l.slice().forEach(r => r.fn(payload));
    return l.length;
}

/* ========================================================================== tick */

// One base timer for every periodic job. A job runs at most every `ms`, never while the
// window is hidden (unless whileHidden), never while you're in a match (if pauseInMatch).
const tasks = new Set();
let tickBase = 0;
let tickRuns = 0;

function runTasks() {
    if (!tasks.size) { clearInterval(tickBase); tickBase = 0; return; }
    const t = now();
    const hidden = hasDom() && document.hidden;
    let match = null;
    tasks.forEach(job => {
        if (t < job.due || job.owner.dead) return;
        if (hidden && !job.whileHidden) return;
        if (job.pauseInMatch) {
            if (match === null) match = app.inMatch();
            if (match) return;
        }
        job.due = t + job.ms;
        tickRuns++;
        job.fn();
    });
}

function tickFor(owner) {
    return function tick(fn, ms, opts) {
        const o = opts || {};
        const job = {
            fn: guard(owner, fn, 'timer'), ms: Math.max(100, +ms || 1000), owner,
            due: now() + (o.delay != null ? o.delay : (+ms || 1000)),
            whileHidden: !!o.whileHidden, pauseInMatch: !!o.pauseInMatch
        };
        tasks.add(job);
        if (!tickBase) tickBase = setInterval(runTasks, 100);
        return own(owner, () => tasks.delete(job));
    };
}

/* ========================================================================= watch */

// One MutationObserver on <body>, debounced: watchers run ~120 ms after the page changed
// (and once when added). opts.selector: only while that element exists. opts.sync: run
// right away, before the browser paints (for restyling something the moment it appears --
// keep those cheap). Watchers must be idempotent: "add X if it's missing".
const watchers = new Set();
let mo = null, moTimer = 0, moRuns = 0;

function flushWatchers(sync) {
    if (!sync) { moTimer = 0; moRuns++; }
    watchers.forEach(w => {
        if (w.owner.dead || !!w.sync !== !!sync) return;
        if (w.selector && !document.querySelector(w.selector)) return;
        w.fn();
    });
}
let syncWatchers = 0;

function ensureObserver() {
    if (mo || !hasDom() || !document.body) return;
    mo = new MutationObserver(() => {
        if (syncWatchers) flushWatchers(true);
        if (!moTimer) moTimer = setTimeout(flushWatchers, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });
}

function watchFor(owner) {
    return function watch(fn, opts) {
        const w = { fn: guard(owner, fn, 'watcher'), selector: (opts && opts.selector) || '', sync: !!(opts && opts.sync), owner };
        watchers.add(w);
        if (w.sync) syncWatchers++;
        ensureObserver();
        if (!mo && hasDom()) {            // no <body> yet
            const retry = setInterval(() => { ensureObserver(); if (mo) clearInterval(retry); }, 200);
        }
        setTimeout(() => { if (watchers.has(w) && (!w.selector || document.querySelector(w.selector))) w.fn(); }, 0);
        return own(owner, () => { if (watchers.delete(w) && w.sync) syncWatchers--; });
    };
}

/* ======================================================================== config */

// fc.config(id, defaults, { file, version, migrate(data, fromVersion) })
//   -> { data, save(), saveNow(), set(k, v), patch(obj), reset(), on(fn), file }
// Files live next to the plugins as <id>-config.json (the names the old plugins used).
// Saving is debounced and async (temp file + rename); pending saves are flushed on unload.
const stores = new Map();           // id -> store

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeJsonAsync(file, value, cb) {
    const text = JSON.stringify(value, null, 2);
    const tmp = file + '.tmp';
    fs.writeFile(tmp, text, (err) => {
        if (err) { fs.writeFile(file, text, () => cb && cb()); return; }
        fs.rename(tmp, file, (err2) => {
            // a virus scanner holding the file open: write it directly instead
            if (err2) fs.writeFile(file, text, () => { fs.unlink(tmp, () => {}); if (cb) cb(); });
            else if (cb) cb();
        });
    });
}

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

function mergeDefaults(defaults, saved) {
    const out = Object.assign({}, defaults);
    if (!isPlain(saved)) return out;
    Object.keys(saved).forEach(k => {
        out[k] = isPlain(defaults[k]) && isPlain(saved[k]) ? Object.assign({}, defaults[k], saved[k]) : saved[k];
    });
    return out;
}

function configFor(owner) {
    return function config(id, defaults, opts) {
        if (stores.has(id)) return stores.get(id);
        const o = opts || {};
        const file = path.join(o.dir || DIR, o.file || (id + '-config.json'));
        const defs = defaults || {};
        let saved = readJson(file, null);
        const version = o.version || 0;
        if (saved && version && (+saved._v || 0) < version && typeof o.migrate === 'function') {
            try { saved = o.migrate(saved, +saved._v || 0) || saved; } catch (e) { fault(owner, e, 'config migrate ' + id); }
        }
        const store = {
            id, file,
            data: mergeDefaults(defs, saved),
            _timer: 0, _subs: [],
            save() {
                clearTimeout(store._timer);
                store._timer = setTimeout(() => { store._timer = 0; store.saveNow(); }, 400);
                notify();
            },
            saveNow(sync) {
                clearTimeout(store._timer);
                store._timer = 0;
                if (version) store.data._v = version;
                if (sync) { try { fs.writeFileSync(file, JSON.stringify(store.data, null, 2)); } catch (e) { LOG.warn('save failed', file, e.message); } }
                else writeJsonAsync(file, store.data);
            },
            set(k, v) { store.data[k] = v; store.save(); },
            patch(obj) { Object.assign(store.data, obj || {}); store.save(); },
            reset() {
                Object.keys(store.data).forEach(k => { delete store.data[k]; });
                Object.assign(store.data, JSON.parse(JSON.stringify(defs)));
                store.save();
            },
            reload() {
                const fresh = readJson(file, null);
                Object.keys(store.data).forEach(k => { delete store.data[k]; });
                Object.assign(store.data, mergeDefaults(defs, fresh));
                notify();
            },
            on(fn) {
                const g = guard(owner, fn, 'config ' + id);
                store._subs.push(g);
                return own(owner, () => { const i = store._subs.indexOf(g); if (i >= 0) store._subs.splice(i, 1); });
            }
        };
        function notify() { store._subs.slice().forEach(f => f(store.data)); }
        stores.set(id, store);
        return store;
    };
}

function flushStores() {
    stores.forEach(s => { if (s._timer) s.saveNow(true); });
    if (historyTimer) saveHistoryNow(true);
}

// every settings file Fightcord has (registered or not), for backup / restore
function exportAll() {
    flushStores();
    const out = { fightcord: CORE_API, at: new Date().toISOString(), files: {} };
    let names = [];
    try { names = fs.readdirSync(DIR).filter(f => /-config\.json$/.test(f)); } catch (e) { /* none */ }
    names.forEach(f => { const v = readJson(path.join(DIR, f), null); if (v) out.files[f] = v; });
    return out;
}

function importAll(backup) {
    if (!backup || !isPlain(backup.files)) throw new Error('not a Fightcord settings backup');
    let n = 0;
    Object.keys(backup.files).forEach(f => {
        if (!/^[a-z0-9_.-]+-config\.json$/i.test(f)) return;          // only our own files
        try { fs.writeFileSync(path.join(DIR, f), JSON.stringify(backup.files[f], null, 2)); n++; } catch (e) { LOG.warn('restore', f, e.message); }
        stores.forEach(s => { if (path.basename(s.file) === f) s.reload(); });
    });
    emit('config:restored', { files: n });
    return n;
}

// plain files next to the plugins (big things stay out of the JSON configs)
const files = {
    path: (name) => path.join(DIR, name),
    exists(name) { try { fs.accessSync(path.join(DIR, name)); return true; } catch (e) { return false; } },
    read(name, enc) { return new Promise((res, rej) => fs.readFile(path.join(DIR, name), enc || null, (e, d) => e ? rej(e) : res(d))); },
    write(name, value) {
        return new Promise((res, rej) => {
            const p = path.join(DIR, name);
            fs.mkdir(path.dirname(p), { recursive: true }, () => fs.writeFile(p, value, (e) => e ? rej(e) : res(p)));
        });
    },
    remove(name) { return new Promise(res => fs.unlink(path.join(DIR, name), () => res())); },
    list(sub, re) {
        try { return fs.readdirSync(path.join(DIR, sub || '')).filter(f => !re || re.test(f)).sort((a, b) => a.localeCompare(b)); }
        catch (e) { return []; }
    }
};

/* =========================================================================== app */

// Fightcade's Vue root. The loader hands it over; plugins that start before #app
// existed still get it once it's there.
let FCADE = null;

const app = {
    root() {
        if (FCADE && (FCADE._data || FCADE.globalUsers)) return FCADE;
        if (!hasDom()) return FCADE;
        const el = document.getElementById('app');
        if (el && el.__vue__) FCADE = el.__vue__;
        return FCADE;
    },
    global() {
        const r = app.root();
        return (r && ((r._data && r._data.global) || (r.$data && r.$data.global) || r.global)) || {};
    },
    localUser: () => app.global().localUser || {},
    me: () => app.localUser().name || '',
    isMe(name) { const m = app.me(); return !!m && String(name || '').toLowerCase() === m.toLowerCase(); },
    users() { const r = app.root(); return (r && r.globalUsers) || {}; },

    // case-insensitive -> [real name, user] (user null when not in your channels)
    user(name) {
        const all = app.users();
        if (all[name]) return [name, all[name]];
        const low = String(name || '').toLowerCase();
        const k = Object.keys(all).find(n => n.toLowerCase() === low);
        return k ? [k, all[k]] : [name, null];
    },
    playing(name) {
        const u = app.user(name || app.me())[1];
        return u && u.playing && u.playing.quarkId ? u.playing : null;
    },
    // what Fightcade knows about someone in your channels (null when they aren't in any)
    // rank = their rank in the channel on screen (1-6, 0 = none)
    userInfo(name) {
        const [real, u] = app.user(name);
        if (!u) return null;
        const ch = app.activeChannel();
        const rk = u.channelRank || {};
        return {
            name: real, country: (u.country && u.country.iso_code) || '', countryName: (u.country && u.country.full_name) || '',
            away: !!u.away, ping: u.ping, rank: (ch && (rk[ch.name] || rk[ch.id])) || 0, ranks: rk,
            playing: u.playing && u.playing.quarkId ? u.playing : null, gravatar: u.gravatar || '',
            wlan: !!u.wlan, proxy: !!u.proxy, channels: Array.isArray(u.channels) ? u.channels : []
        };
    },
    // 'on' | 'away' | 'playing' | 'off'
    status(name) {
        const u = app.user(name)[1];
        return !u ? 'off' : (u.playing && u.playing.quarkId) ? 'playing' : u.away ? 'away' : 'on';
    },

    // the chat box of the channel on screen
    chatInput() {
        if (!hasDom()) return null;
        const all = [...document.querySelectorAll('.chatInput input.input, .chatInput input')];
        return all.find(i => i.offsetParent !== null) || all[0] || null;
    },
    setChatText(text, focus) {
        const input = app.chatInput();
        if (!input) return false;
        try { nativeValue().call(input, text); } catch (e) { input.value = text; }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (focus !== false) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
        return true;
    },
    // "@name " in front of whatever is in the chat box
    mention(name) {
        const input = app.chatInput();
        if (!input) return false;
        const tag = '@' + name + ' ';
        return app.setChatText(tag + (input.value.startsWith(tag) ? input.value.slice(tag.length) : input.value));
    },
    inMatch(name) { return !!app.playing(name); },

    channels() { const r = app.root(); return (r && r.channels) || []; },
    isGameChannel: (id) => !!id && !/-channel$/.test(id),
    channel(idOrName) {
        if (!idOrName) return null;
        return app.channels().find(c => c && (c.id === idOrName || c.name === idOrName)) || null;
    },
    joinedChannels() { return app.channels().filter(c => c && app.isGameChannel(c.id)); },
    activeChannelId() { const r = app.root(); return (r && r.activeChannelId) || ''; },
    activeChannel() { return app.channel(app.activeChannelId()); },

    // the rom of the channel on screen (also in casual rooms)
    activeGameId() {
        const c = app.activeChannel();
        if (c && c.gameid) return c.gameid;
        if (hasDom()) {
            const scope = app.channelElement() || document;
            const rom = scope.querySelector('.channelInfo .name[title="Rom name"]');
            if (rom && rom.textContent.trim()) return rom.textContent.trim();
        }
        return '';
    },

    // the visible game channel's wrapper (search results reuse .channelWrapper: skip those)
    channelElement() {
        if (!hasDom()) return null;
        const all = [...document.querySelectorAll('#app > .channelWrapper, .channelWrapper')].filter(cw => !cw.closest('.searchResultsGrid'));
        return all.find(cw => cw.style.display !== 'none' && cw.offsetParent !== null) || null;
    },
    // the channel an element sits in (by its header title)
    channelOf(el) {
        const w = el && el.closest && el.closest('.channelWrapper');
        const t = w && w.querySelector('.channelInfo .name.title');
        const name = t ? (t.getAttribute('title') || t.textContent.replace(/^#/, '')).trim() : '';
        return name ? (app.channel(name) || { id: name, name }) : null;
    },

    select(id, params) {
        const r = app.root();
        if (r && typeof r.selectChannel === 'function') { r.selectChannel(id, params); return true; }
        return false;
    },

    // Fightcade's version string, when it shows one
    version() { const g = app.global(); return g.version || g.appVersion || ''; }
};

// root.$watch with cleanup (falls back to polling in the harness)
function appWatchFor(owner) {
    return function watchRoot(expr, fn, opts) {
        const r = app.root();
        const g = guard(owner, fn, 'app.watch');
        if (r && typeof r.$watch === 'function') {
            const un = r.$watch(expr, g, opts || {});
            return own(owner, un);
        }
        const read = typeof expr === 'function' ? () => expr.call(r) : () => { const v = app.root(); return v && v[expr]; };
        let last = read();
        if (opts && opts.immediate) g(last);
        return tickFor(owner)(() => { const v = read(); if (v !== last) { const old = last; last = v; g(v, old); } }, 250, { whileHidden: true });
    };
}

/* ======================================================================= modules */

const mods = new Map();      // id -> rec
const order = [];            // registration order
let safeMode = false;

// one line for people: "SyntaxError: Unexpected token ';'" (the stack goes to the log)
const errText = (e) => e && e.name && e.message ? e.name + ': ' + e.message : toText(e).split(/\r?\n/)[0];
const idOf = (file) => String(file || '').replace(/\.js$/i, '');

function register(file, exp) {
    const id = (exp && typeof exp === 'object' && exp.id) || idOf(file);
    const legacy = typeof exp === 'function';
    const rec = mods.get(id) || Object.assign(makeOwner(id, (exp && exp.name) || id), { file, order: order.length });
    Object.assign(rec, {
        file, exports: exp, legacy, state: 'loaded', error: '',
        needs: (!legacy && exp && Array.isArray(exp.needs)) ? exp.needs.map(idOf) : [],
        essential: !!(exp && exp.essential)
    });
    if (!mods.has(id)) { mods.set(id, rec); order.push(id); }
    return rec;
}

function failed(file, e) {
    const rec = register(file, null);
    rec.state = 'failed';
    rec.error = errText(e);
    LOG.error(file + ' failed to load', e);
}

// dependency order; ties keep registration (file name) order
function startOrder() {
    const out = [], seen = new Set(), busy = new Set();
    const visit = (id) => {
        if (seen.has(id) || busy.has(id) || !mods.has(id)) return;
        busy.add(id);
        mods.get(id).needs.forEach(visit);
        busy.delete(id);
        seen.add(id);
        out.push(id);
    };
    order.forEach(visit);
    return out;
}

function startModule(rec) {
    if (rec.state === 'running' || rec.state === 'failed') return;
    const missing = rec.needs.filter(n => !mods.has(n) || mods.get(n).state !== 'running');
    if (missing.length) { rec.state = 'off'; rec.error = 'needs ' + missing.join(', '); LOG.warn(rec.id, rec.error); return; }
    rec.dead = false;
    rec.errors = [];
    try {
        if (rec.legacy) rec.exports(app.root());
        else if (rec.exports && typeof rec.exports.start === 'function') {
            const api = rec.exports.start(api_for(rec));
            if (api && typeof api === 'object') rec.api = api;
        }
        rec.state = 'running';
        rec.startedAt = now();
    } catch (e) {
        rec.state = 'failed';
        rec.error = errText(e);
        rec.dead = true;
        disposeAll(rec);
        LOG.error(rec.file + ' failed to start', e);
    }
}

function stopModule(rec, why) {
    if (!rec || rec.state !== 'running') return;
    rec.dead = true;
    try { if (!rec.legacy && rec.exports && typeof rec.exports.stop === 'function') rec.exports.stop(); }
    catch (e) { LOG.warn(rec.id, 'stop failed', e); }
    disposeAll(rec);
    rec.state = why ? 'failed' : 'off';
    if (why) rec.error = why;
    emit('module:stopped', { id: rec.id, why: why || '' });
}

moduleCrash = (rec, e) => {
    if (rec.legacy) return;                 // old plugins can't be cleaned up: just log
    stopModule(rec, 'kept failing: ' + errText(e));
    if (hasDom()) ui.toast('Fightcord had a problem with ' + rec.name, {
        sub: 'It’s switched off until Fightcade restarts.', kind: 'danger', ms: 9000,
        actions: [{ label: 'Copy details', fn: () => copyText(diagText()) }]
    });
};

const modules = {
    register, failed,
    startAll(opts) {
        const o = opts || {};
        const off = new Set((o.off || []).map(idOf));
        startOrder().forEach(id => {
            const rec = mods.get(id);
            if (off.has(id)) { rec.state = 'off'; return; }
            if (safeMode && !rec.essential && id !== 'fightcord') { rec.state = 'off'; rec.error = 'safe mode'; return; }
            startModule(rec);
        });
        emit('modules:started', modules.list());
        return modules.list();
    },
    // another module's API: new modules -> what start() returned (or the module object);
    // old plugins -> their exports (what plugin('x.js') gave before)
    get(id) {
        const rec = mods.get(idOf(id));
        if (!rec || rec.state !== 'running') return null;
        return rec.legacy ? rec.exports : (rec.api || rec.exports);
    },
    has: (id) => !!(mods.get(idOf(id)) && mods.get(idOf(id)).state === 'running'),
    list: () => order.map(id => {
        const r = mods.get(id);
        return { id, name: r.name, file: r.file, state: r.state, legacy: r.legacy, error: r.error, needs: r.needs.slice() };
    }),
    stop: (id) => stopModule(mods.get(idOf(id))),
    start: (id) => { const r = mods.get(idOf(id)); if (r && r.state !== 'running') { if (r.state === 'failed' && r.exports) r.state = 'off'; startModule(r); } }
};

/* ====================================================================== settings */

// Sections are the pages of the Fightcord settings screen; blocks are what modules put on
// them. A block is rendered once per open settings pane and patched (never rebuilt)
// when its values change.
//   fc.settings.block({ id, section, title, hint, store, fields: [...] })
//   fc.settings.block({ id, section, title, render(el), refresh(el) })     // custom
// fields: { key, type: 'switch'|'select'|'slider'|'text'|'number'|'color'|'button'|'note'|'html',
//           label, hint, options: [[value, label]], min, max, step, unit, act, show(data), onChange(v, data) }
const sections = new Map();
const blocks = new Map();

function settingsFor(owner) {
    return {
        section(id, label, icon, ord) {
            sections.set(id, { id, label, icon: icon || 'gear', order: ord == null ? sections.size * 10 : ord });
            emit('settings:sections');
            return own(owner, () => sections.delete(id));
        },
        block(def) {
            const b = Object.assign({ order: blocks.size * 10 }, def, { owner, els: [] });
            blocks.set(def.id, b);
            ensureSettingsWatcher();
            injectBlocks();
            return own(owner, () => { b.els.forEach(el => el.remove()); blocks.delete(def.id); });
        },
        refresh: refreshBlocks,
        sections: () => [...sections.values()].sort((a, b) => a.order - b.order),
        blocks: (section) => [...blocks.values()].filter(b => !section || b.section === section).sort((a, b) => a.order - b.order),
        // the settings screen (fightcord.js) mounts blocks here
        mount: mountSection
    };
}

let settingsWatching = false;
function ensureSettingsWatcher() {
    if (settingsWatching) return;
    settingsWatching = true;
    watchFor(CORE)(injectBlocks, { selector: '.fcordPane' });
}

// the settings screen's panes are .fcordPane[data-sec]; each block goes in its own section only
function injectBlocks() {
    if (!hasDom()) return;
    document.querySelectorAll('.fcordPane[data-sec]').forEach(pane => mountSection(pane, pane.getAttribute('data-sec')));
}

function mountSection(host, sectionId) {
    [...blocks.values()].filter(b => b.section === sectionId).sort((a, b) => a.order - b.order).forEach(b => {
        if (b.owner.dead || host.querySelector(':scope > [data-fc-block="' + b.id + '"]')) return;
        const el = document.createElement('div');
        el.className = 'option fcBlock fc-set';
        el.setAttribute('data-fc-block', b.id);
        el.addEventListener('click', (e) => e.stopPropagation());
        try {
            if (b.render) b.render(el, b);
            else { el.innerHTML = fieldsHtml(b); wireFields(el, b); }
        } catch (e) { fault(b.owner, e, 'settings ' + b.id); el.innerHTML = '<div class="fc-muted">This block couldn’t load.</div>'; }
        host.appendChild(el);
        b.els.push(el);
    });
}

function refreshBlocks(id) {
    blocks.forEach(b => {
        if (id && b.id !== id) return;
        b.els = b.els.filter(el => el.isConnected);
        b.els.forEach(el => {
            try { if (b.refresh) b.refresh(el, b); else if (!b.render) patchFields(el, b); }
            catch (e) { fault(b.owner, e, 'settings refresh ' + b.id); }
        });
    });
}

function fieldHtml(f, d) {
    const E = fmt.esc;
    const v = f.key ? d[f.key] : undefined;
    const text = `<span class="fc-field-text"><b>${E(f.label || '')}</b>${f.hint ? `<small>${E(f.hint)}</small>` : ''}</span>`;
    const k = f.key ? ` data-key="${E(f.key)}"` : '';
    switch (f.type) {
        case 'switch':
            return `<label class="fc-field"${k}>${text}<input type="checkbox" class="fc-switch-in"${v ? ' checked' : ''}><i class="fc-switch"></i></label>`;
        case 'select':
            return `<div class="fc-field"${k}>${text}<select class="fc-select">${(f.options || []).map(([ov, ol]) =>
                `<option value="${E(ov)}"${String(ov) === String(v) ? ' selected' : ''}>${E(ol)}</option>`).join('')}</select></div>`;
        case 'slider': {
            const scale = f.scale || 1;
            return `<div class="fc-field"${k}>${text}<input type="range" class="fc-slider" min="${f.min || 0}" max="${f.max == null ? 100 : f.max}" step="${f.step || 1}" value="${Math.round((+v || 0) * scale)}">` +
                `<span class="fc-slider-v">${Math.round((+v || 0) * scale)}${E(f.unit || '')}</span></div>`;
        }
        case 'text': case 'number': case 'color':
            return `<div class="fc-field"${k}>${text}<input type="${f.type}" class="fc-input${f.type === 'color' ? ' fc-color' : ''}" value="${E(v == null ? '' : v)}"${f.placeholder ? ` placeholder="${E(f.placeholder)}"` : ''}></div>`;
        case 'button':
            return `<div class="fc-field">${text}${ui.btn(f.button || f.label, { kind: f.kind || 'sec', size: 'sm', act: f.act })}</div>`;
        case 'note':
            return `<div class="fc-note">${E(f.label || '')}</div>`;
        case 'html':
            return `<div class="fc-field-html" data-html="${E(f.id || '')}">${typeof f.html === 'function' ? f.html(d) : (f.html || '')}</div>`;
        default:
            return '';
    }
}

function fieldsHtml(b) {
    const d = (b.store && b.store.data) || {};
    return `<div class="fc-set-title">${b.store && b.reset !== false ? ui.btn('Reset', { kind: 'ghost', size: 'sm', act: 'fc-reset', cls: 'fc-set-reset', title: 'Put this block back to its defaults' }) : ''}` +
        `${fmt.esc(b.title || '')}${b.hint ? ` <small>${fmt.esc(b.hint)}</small>` : ''}</div>` +
        (b.fields || []).map((f, i) => `<div class="fc-set-row" data-i="${i}"${f.show && !f.show(d) ? ' hidden' : ''}>${fieldHtml(f, d)}</div>`).join('');
}

function fieldFor(b, el) {
    const row = el.closest('.fc-set-row');
    return row ? (b.fields || [])[+row.getAttribute('data-i')] : null;
}

function wireFields(root, b) {
    const set = (f, v) => {
        if (!b.store) return;
        b.store.data[f.key] = v;
        b.store.save();
        if (f.onChange) guard(b.owner, f.onChange, 'setting ' + f.key)(v, b.store.data);
        refreshBlocks(b.id);
    };
    root.addEventListener('change', (e) => {
        const f = fieldFor(b, e.target);
        if (!f || !f.key) return;
        if (f.type === 'switch') set(f, e.target.checked);
        else if (f.type === 'select') { const o = (f.options || []).find(x => String(x[0]) === e.target.value); set(f, o ? o[0] : e.target.value); }
        else if (f.type === 'number') set(f, +e.target.value);
        else if (f.type === 'slider') set(f, +e.target.value / (f.scale || 1));
        else if (f.type === 'text' || f.type === 'color') set(f, e.target.value);
    });
    root.addEventListener('input', (e) => {
        const f = fieldFor(b, e.target);
        if (!f || f.type !== 'slider') return;
        const out = e.target.parentNode.querySelector('.fc-slider-v');
        if (out) out.textContent = e.target.value + (f.unit || '');
        if (f.live && b.store) { b.store.data[f.key] = +e.target.value / (f.scale || 1); guard(b.owner, f.live, 'setting ' + f.key)(b.store.data[f.key], b.store.data); }
    });
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (btn && btn.getAttribute('data-act') === 'fc-reset' && b.store) {
            ui.confirm('Reset “' + (b.title || b.id) + '”?', 'Its settings go back to the defaults.', { ok: 'Reset', danger: true }).then(ok => {
                if (!ok) return;
                b.store.reset();
                if (b.onReset) guard(b.owner, b.onReset, 'settings reset')(b.store.data);
                refreshBlocks(b.id);
                emit('settings:reset', b.id);
            });
            return;
        }
        const f = btn && fieldFor(b, btn);
        if (f && typeof f.onClick === 'function') guard(b.owner, f.onClick, 'setting button')(e, b.store && b.store.data);
    });
}

function patchFields(root, b) {
    const d = (b.store && b.store.data) || {};
    (b.fields || []).forEach((f, i) => {
        const row = root.querySelector(':scope > .fc-set-row[data-i="' + i + '"]');
        if (!row) return;
        const hide = !!(f.show && !f.show(d));
        if (row.hidden !== hide) row.hidden = hide;
        if (f.type === 'html') { const h = row.querySelector('.fc-field-html'); const html = typeof f.html === 'function' ? f.html(d) : (f.html || ''); if (h && h.innerHTML !== html) h.innerHTML = html; return; }
        if (!f.key) return;
        const input = row.querySelector('input, select');
        if (!input || input === document.activeElement) return;
        const v = d[f.key];
        if (f.type === 'switch') input.checked = !!v;
        else if (f.type === 'slider') {
            const sv = String(Math.round((+v || 0) * (f.scale || 1)));
            if (input.value !== sv) input.value = sv;
            const out = row.querySelector('.fc-slider-v');
            if (out) out.textContent = sv + (f.unit || '');
        } else if (input.value !== String(v == null ? '' : v)) input.value = v == null ? '' : v;
    });
}

/* =========================================================================== cmd */

// /name args  in the chat box -> handler(args, { input })
const cmds = new Map();
let cmdHooked = false;
const nativeValue = () => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

function clearInput(el) {
    try { nativeValue().call(el, ''); } catch (e) { el.value = ''; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function onCmdKey(e) {
    const el = e.target;
    if (e.key !== 'Enter' || e.shiftKey || !el || el.tagName !== 'INPUT' || !el.closest || !el.closest('.chatInput')) return;
    const m = /^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i.exec(el.value.trim());
    const c = m && cmds.get(m[1].toLowerCase());
    if (!c || c.owner.dead) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    clearInput(el);
    c.fn((m[2] || '').trim(), { input: el, name: c.name });
}

function cmdFor(owner) {
    const cmd = (name, desc, fn, opts) => {
        const key = String(name).replace(/^\//, '').toLowerCase();
        const rec = { name: key, desc: desc || '', args: (opts && opts.args) || '', fn: guard(owner, fn, '/' + key), owner };
        cmds.set(key, rec);
        if (!cmdHooked && hasDom()) { cmdHooked = true; window.addEventListener('keydown', onCmdKey, true); }
        return own(owner, () => { if (cmds.get(key) === rec) cmds.delete(key); });
    };
    cmd.list = () => [...cmds.values()].filter(c => !c.owner.dead).map(c => ({ name: c.name, desc: c.desc, args: c.args, module: c.owner.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
    cmd.run = (line) => {
        const m = /^\/?([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i.exec(String(line || '').trim());
        const c = m && cmds.get(m[1].toLowerCase());
        if (!c) return false;
        c.fn((m[2] || '').trim(), { input: null, name: c.name });
        return true;
    };
    return cmd;
}

/* =========================================================================== api */

// The one Fightcade API client: every request goes through a small queue (two at a time,
// spaced out), answers are cached, identical requests share one fetch, and Cloudflare /
// 429 answers back everybody off together. 'high' priority (a card you just opened) goes
// ahead of background work (imports, leaderboards).
const API_URL = 'https://web.fightcade.com/api/';
const PRI = { high: 0, normal: 1, low: 2 };
const apiState = {
    cache: new Map(), inflight: new Map(), queue: [], running: 0, lastStart: 0,
    blockedUntil: 0, fails: 0, stats: { requests: 0, cached: 0, errors: 0, blocked: 0 }
};
const API_GAP = 250, API_PARALLEL = 2, API_CACHE_MAX = 400;

function apiPump() {
    if (apiState.running >= API_PARALLEL || !apiState.queue.length) return;
    const wait = apiState.lastStart + API_GAP - now();
    if (wait > 0) { setTimeout(apiPump, wait); return; }
    apiState.queue.sort((a, b) => a.pri - b.pri || a.seq - b.seq);
    const job = apiState.queue.shift();
    apiState.running++;
    apiState.lastStart = now();
    apiFetch(job).then(job.resolve, job.reject).then(() => { apiState.running--; apiPump(); });
    apiPump();
}

async function apiFetch(job) {
    if (now() < apiState.blockedUntil) { apiState.stats.blocked++; throw new Error('rate limited'); }
    apiState.stats.requests++;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), job.timeout);
    let res;
    try {
        res = await globalThis.fetch(API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: job.key, signal: ctl ? ctl.signal : undefined
        });
    } catch (e) {
        apiState.stats.errors++;
        throw new Error(e && e.name === 'AbortError' ? 'Fightcade API timed out' : (e && e.message) || 'network error');
    } finally {
        clearTimeout(timer);
    }
    // Cloudflare serves an HTML challenge instead of JSON when it gets grumpy
    const text = await res.text();
    if (res.status === 429 || text.trim().charAt(0) === '<') {
        apiState.fails++;
        apiState.stats.errors++;
        apiState.blockedUntil = now() + Math.min(5 * 60000, 10000 * Math.pow(2, apiState.fails));
        throw new Error(res.status === 429 ? 'rate limited' : 'blocked by Cloudflare');
    }
    apiState.fails = 0;
    const json = JSON.parse(text);
    apiState.cache.set(job.key, { at: now(), data: json });
    if (apiState.cache.size > API_CACHE_MAX) apiState.cache.delete(apiState.cache.keys().next().value);
    return json;
}

let apiSeq = 0;
// fc.api.request(body, { ttl (ms, default 5 min), timeout (ms), priority: 'high'|'normal'|'low', fresh })
function apiRequest(body, opts) {
    const o = opts || {};
    const key = JSON.stringify(body);
    const ttl = o.ttl == null ? 5 * 60000 : o.ttl;
    const hit = apiState.cache.get(key);
    if (hit && !o.fresh && now() - hit.at < ttl) { apiState.stats.cached++; return Promise.resolve(hit.data); }
    // backing off: an old answer beats an error
    if (now() < apiState.blockedUntil) {
        if (hit) { apiState.stats.cached++; return Promise.resolve(hit.data); }
        apiState.stats.blocked++;
        return Promise.reject(new Error('rate limited'));
    }
    if (apiState.inflight.has(key)) return apiState.inflight.get(key);
    const p = new Promise((resolve, reject) => {
        apiState.queue.push({ key, pri: PRI[o.priority] == null ? 1 : PRI[o.priority], seq: apiSeq++, timeout: o.timeout || 10000, resolve, reject });
        apiPump();
    });
    apiState.inflight.set(key, p);
    const done = () => { if (apiState.inflight.get(key) === p) apiState.inflight.delete(key); };
    p.then(done, done);
    return p;
}

// The game's leaderboard (already in ELO order): the top 300, 3 pages one after another,
// kept 10 minutes per game. A page that fails keeps what came before it.
// -> Map(lowercased name -> {name, pos, rank, matches, hours, cc})
const boards = new Map();
const LB_PAGES = 3, LB_TTL = 10 * 60000;

const api = {
    request: apiRequest,
    blocked: () => now() < apiState.blockedUntil,
    stats: () => Object.assign({ queued: apiState.queue.length, running: apiState.running, cache: apiState.cache.size,
        blockedFor: Math.max(0, apiState.blockedUntil - now()) }, apiState.stats),
    clearCache: () => { apiState.cache.clear(); boards.clear(); },

    async user(name, opts) { return data.pickUser(await apiRequest({ req: 'getuser', username: name }, opts)); },
    async quarks(params, opts) { return data.pickRows(await apiRequest(Object.assign({ req: 'searchquarks' }, params), opts)); },
    async rankings(gameid, offset, limit, opts) {
        return data.pickRows(await apiRequest({ req: 'searchrankings', gameid, limit: limit || 100, offset: offset || 0, byElo: true, recent: true }, opts));
    },
    cachedBoard(gameid) {
        const hit = gameid && boards.get(gameid);
        return hit && hit.map && now() - hit.at < LB_TTL ? hit.map : null;
    },
    leaderboard(gameid) {
        if (!gameid) return Promise.resolve(new Map());
        const hit = boards.get(gameid);
        if (hit && hit.map && now() - hit.at < LB_TTL) return Promise.resolve(hit.map);
        if (hit && hit.pending) return hit.pending;
        if (api.blocked()) return Promise.resolve((hit && hit.map) || new Map());
        const pending = (async () => {
            const map = new Map();
            for (let page = 0; page < LB_PAGES; page++) {
                let rows;
                try { rows = await api.rankings(gameid, page * 100, 100, { priority: 'low', ttl: LB_TTL }); } catch (e) { break; }
                rows.forEach((r, i) => {
                    if (!r || !r.name) return;
                    const gi = (r.gameinfo && r.gameinfo[gameid]) || {};
                    const key = r.name.toLowerCase();
                    if (!map.has(key)) map.set(key, {
                        name: r.name, pos: page * 100 + i + 1, rank: gi.rank || 0, matches: gi.num_matches || 0,
                        hours: gi.time_played ? Math.round(gi.time_played / 3600) : 0,
                        cc: (r.country && (r.country.iso_code || r.country)) || ''
                    });
                });
                if (rows.length < 100) break;
            }
            boards.set(gameid, { at: now(), map });
            return map;
        })();
        boards.set(gameid, { pending, map: hit && hit.map, at: hit && hit.at });
        return pending;
    }
};

/* ========================================================================= hooks */

// The challenge pipeline: ONE wrapper on Fightcade's connectionCallbacks.onChallengeRequest.
//   phase 'filter' handlers run first and may ctx.decline('reason') (then Fightcade never
//   sees it); then Fightcade's own handler; then the 'after' handlers (scout, card, ...).
// ctx = { user, name, channel, id, ranked, ft, warn: [], decline(reason), declined }
// The wrapper only re-installs itself when Fightcade replaced the callback (it's no longer
// anywhere in the chain). Other wrappers may sit on top of it: it never fights them for the
// outermost spot (two wrappers doing that wrap each other forever). Fightcade's own handler
// is always inside ours, so a declined challenge never reaches it.
const chHandlers = [];
let chActive = null;
let chMaintained = false;

function inChain(fn, target) {
    for (let i = 0; fn && i < 60; i++, fn = fn.__fcPrev) if (fn === target) return true;
    return false;
}

function installChallengeHook() {
    const r = app.root();
    const cbs = r && r.connectionCallbacks;
    if (!cbs || typeof cbs.onChallengeRequest !== 'function') return false;
    const top = cbs.onChallengeRequest;
    if (chActive && inChain(top, chActive)) return true;
    const prev = top;
    const wrapped = function (user, channel, id, ranked) {
        if (wrapped !== chActive) return prev.apply(this, arguments);
        const name = String((user && (user.name || user.id)) || user || '');
        const ctx = {
            user, name, channel, id, ranked, ft: +ranked || 0, warn: [], declined: '',
            decline(reason) { if (!ctx.declined) ctx.declined = reason || 'filtered'; }
        };
        const mine = !name || app.isMe(name);
        const run = (phase) => chHandlers.filter(h => h.phase === phase && !h.owner.dead)
            .sort((a, b) => a.order - b.order).forEach(h => h.fn(ctx));
        if (!mine) run('filter');
        if (ctx.declined) {
            try {
                r.declineChallenge(channel, user && user.id ? user : { id: name, name }, id);
                emit('challenge:declined', ctx);
                return undefined;
            } catch (e) {
                LOG.warn('decline failed - letting the challenge through', e);      // never lose a challenge
                ctx.declined = '';
            }
        }
        const res = prev.apply(this, arguments);
        if (!mine) { run('after'); emit('challenge:incoming', ctx); }
        return res;
    };
    wrapped.__fcPrev = prev;
    wrapped.__fcCore = true;
    try { cbs.onChallengeRequest = wrapped; chActive = wrapped; } catch (e) { LOG.warn('could not hook challenges', e.message); return false; }
    return true;
}

// wrap a Fightcade method (kept wrapped when Fightcade swaps it): before/after get the arguments
const methodHooks = [];
function applyMethodHook(h) {
    const obj = h.target();
    if (!obj || typeof obj[h.name] !== 'function') return;
    if (inChain(obj[h.name], h.active)) return;
    const prev = obj[h.name];
    const wrapped = function () {
        if (wrapped !== h.active || h.owner.dead) return prev.apply(this, arguments);
        if (h.before) { const stop = h.before.apply(this, arguments); if (stop === false) return undefined; }
        const res = prev.apply(this, arguments);
        if (h.after) h.after.apply(this, [res].concat([].slice.call(arguments)));
        return res;
    };
    wrapped.__fcPrev = prev;
    try { obj[h.name] = wrapped; h.active = wrapped; } catch (e) { /* read-only */ }
}

function maintainHooks() {
    if (chMaintained) return;
    chMaintained = true;
    const keep = () => {
        if (chHandlers.some(h => !h.owner.dead)) installChallengeHook();
        methodHooks.forEach(h => { if (!h.owner.dead) applyMethodHook(h); });
    };
    keep();
    tickFor(CORE)(keep, 2000, { whileHidden: true });
}

function hooksFor(owner) {
    return {
        challenge(fn, opts) {
            const h = { fn: guard(owner, fn, 'challenge'), phase: (opts && opts.phase) || 'after', order: (opts && opts.order) || 0, owner };
            chHandlers.push(h);
            maintainHooks();
            installChallengeHook();
            return own(owner, () => { const i = chHandlers.indexOf(h); if (i >= 0) chHandlers.splice(i, 1); });
        },
        // fc.hooks.method(() => fc.app.root(), 'removeChallengeNotifications', { after(res, ...args) {} })
        method(target, name, fns) {
            const h = { target, name, owner, active: null,
                before: fns.before ? guard(owner, fns.before, name) : null, after: fns.after ? guard(owner, fns.after, name) : null };
            methodHooks.push(h);
            maintainHooks();
            applyMethodHook(h);
            return own(owner, () => { const i = methodHooks.indexOf(h); if (i >= 0) methodHooks.splice(i, 1); });
        },
        installed: () => !!chActive
    };
}

/* ======================================================================= history */

// match-history.json: { v: 2, sets: [{ at, opp, result: 'won'|'lost'|'draw'|null, mine, theirs,
//   game, channel, quark, emu, ft, ... }] } in time order, newest HISTORY_MAX kept.
// Also read by discord-rpc.js for "· 7–3 tonight".
const HISTORY_MAX = 5000;
let historyCache = null, historyMtime = 0, historyChecked = 0, historyTimer = 0;
const historyFile = () => path.join(DIR, 'match-history.json');

function loadHistory() {
    const t = now();
    // another writer (an old plugin) may have changed it: re-read when the file is newer
    if (historyCache && !historyTimer && t - historyChecked > 2000) {
        historyChecked = t;
        try { if (fs.statSync(historyFile()).mtimeMs > historyMtime + 1) historyCache = null; } catch (e) { /* no file */ }
    }
    if (historyCache) return historyCache;
    let h = readJson(historyFile(), null);
    if (!h || !Array.isArray(h.sets)) h = { v: 2, sets: [] };
    historyCache = h;
    try { historyMtime = fs.statSync(historyFile()).mtimeMs; } catch (e) { historyMtime = 0; }
    historyChecked = t;
    return h;
}

function saveHistoryNow(sync) {
    clearTimeout(historyTimer);
    historyTimer = 0;
    if (!historyCache) return;
    historyCache.v = 2;
    const done = () => { try { historyMtime = fs.statSync(historyFile()).mtimeMs; } catch (e) { /* ignore */ } };
    if (sync) { try { fs.writeFileSync(historyFile(), JSON.stringify(historyCache)); done(); } catch (e) { LOG.warn('history save failed', e.message); } }
    else {
        const text = JSON.stringify(historyCache);
        fs.writeFile(historyFile(), text, (e) => { if (e) LOG.warn('history save failed', e.message); done(); });
    }
}

function saveHistory() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => saveHistoryNow(false), 500);
}

function capHistory(h) { if (h.sets.length > HISTORY_MAX) h.sets.splice(0, h.sets.length - HISTORY_MAX); }

const history = {
    all: () => loadHistory().sets,
    add(set) {
        const h = loadHistory();
        if (set.emu == null) { const c = app.channel(set.channel); if (c && c.emulator) set.emu = c.emulator; }
        h.sets.push(set);
        capHistory(h);
        saveHistory();
        emit('set:recorded', set);
        return set;
    },
    // sets from elsewhere (an import): merged by quark id, kept in time order -> how many were new
    merge(list) {
        const h = loadHistory();
        const seen = new Set(h.sets.map(x => x.quark).filter(Boolean));
        let added = 0;
        (list || []).forEach(x => {
            if (!x || !x.quark || seen.has(x.quark)) return;
            seen.add(x.quark);
            h.sets.push(x);
            added++;
        });
        if (!added) return 0;
        h.sets.sort((a, b) => (a.at || 0) - (b.at || 0));
        capHistory(h);
        saveHistory();
        emit('history:merged', { added });
        return added;
    },
    update(quark, patch) {
        const s = quark && loadHistory().sets.find(x => x.quark === quark);
        if (!s) return false;
        Object.assign(s, patch);
        saveHistory();
        emit('set:updated', s);
        return true;
    },
    session(at, clearedAt) { const t0 = data.sessionStart(at || now(), clearedAt); return loadHistory().sets.filter(s => s.at >= t0); },
    vs(opp) { const k = String(opp || '').toLowerCase(); return loadHistory().sets.filter(s => String(s.opp || '').toLowerCase() === k); },
    recordVs(opp) { return data.recordOf(history.vs(opp)); },
    record: data.recordOf,
    streak: data.streakOf,
    flush: () => saveHistoryNow(true),
    MAX: HISTORY_MAX
};

/* ============================================================================ ui */

const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    pad: '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6.5 12h4M8.5 10v4"/><circle cx="15.5" cy="11" r=".6"/><circle cx="18" cy="13.5" r=".6"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    chart: '<path d="M3 21h18M6 17v-5M11 17V6M16 17v-8M20.5 17v-3"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6 6 0 0 1 3.5 5.8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    gear: '<path d="M18.94 10.08L21.38 10.47L21.38 13.53L18.94 13.92L18.26 15.55L19.71 17.55L17.55 19.71L15.55 18.26L13.92 18.94L13.53 21.38L10.47 21.38L10.08 18.94L8.45 18.26L6.45 19.71L4.29 17.55L5.74 15.55L5.06 13.92L2.62 13.53L2.62 10.47L5.06 10.08L5.74 8.45L4.29 6.45L6.45 4.29L8.45 5.74L10.08 5.06L10.47 2.62L13.53 2.62L13.92 5.06L15.55 5.74L17.55 4.29L19.71 6.45L18.26 8.45z"/><circle cx="12" cy="12" r="3"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 13v4M8 21h8M9 17h6v4H9z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5.5.8 1.2 1.5 1.8 2.5 2C12 7 12 5 12 3z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    note: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    heart: '<path d="M12 20s-7-4.5-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.5-9 9-9 9z"/>',
    rocket: '<path d="M12 15l-3-3c1.8-4.8 5.4-8.4 12-9-.6 6.6-4.2 10.2-9 12z"/><path d="M9 12H5l2.5-3.5H11M12 15v4l3.5-2.5V13M6 16c-1.5.5-2.5 3.5-2.5 4.5 1 0 4-1 4.5-2.5"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 8v12M7 13H3M21 13h-4M8 9 5 6M16 9l3-3M7 18l-3 2M17 18l3 2M9 5a3 3 0 0 1 6 0"/>'
};

const STYLE = `
:root {
  --fc-navy: #0d0f1f; --fc-blurple: #4f63f0; --fc-violet: #8b5cf6; --fc-cyan: #22e3f2;
  --fc-brand: linear-gradient(135deg, #4f63f0, #8b5cf6);
  --fc-accent: var(--dc-blurple, #5865f2); --fc-accent-h: var(--dc-blurple-h, #4752c4); --fc-accent-soft: var(--dc-accent-soft, rgba(88,101,242,.22));
  --fc-success: var(--dc-green, #23a55a); --fc-danger: var(--dc-red, #f23f43); --fc-warning: var(--dc-yellow, #f0b232); --fc-link: var(--dc-link, #00a8fc);
  --fc-s0: var(--dc-float, #111214); --fc-s1: var(--dc-bg3, #1e1f22); --fc-s2: var(--dc-bg2, #2b2d31); --fc-s3: var(--dc-bg, #313338); --fc-s4: var(--dc-select, #35373c);
  --fc-hover: var(--dc-hover, rgba(255,255,255,.04)); --fc-divider: var(--dc-divider, #3f4147); --fc-input: var(--dc-input, #1e1f22);
  --fc-btn: var(--dc-btn, #4e5058); --fc-btn-h: var(--dc-btn-h, #6d6f78);
  --fc-text: var(--dc-text, #dbdee1); --fc-head: var(--dc-head, #f2f3f5); --fc-muted: var(--dc-muted, #949ba4); --fc-faint: var(--dc-faint, #6d6f78);
  --fc-r1: 4px; --fc-r2: 8px; --fc-r3: 12px; --fc-r4: 16px; --fc-pill: 999px;
  --fc-sh1: 0 1px 3px rgba(0,0,0,.3); --fc-sh2: 0 4px 14px rgba(0,0,0,.35); --fc-sh3: 0 12px 40px rgba(0,0,0,.5); --fc-glow: 0 0 24px rgba(79,99,240,.45);
  --fc-z-page: 20; --fc-z-modal: 1000; --fc-z-pop: 100001; --fc-z-toast: 100004; --fc-z-top: 2147483000;
  --fc-fast: .12s; --fc-med: .2s; --fc-slow: .35s; --fc-ease: cubic-bezier(.2,.8,.2,1);
  --fc-font: var(--dc-font, 'gg sans', 'Noto Sans', 'Segoe UI', sans-serif);
}
html.fc-still *, html.fc-still *::before, html.fc-still *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }
@keyframes fcIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fcPop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
@keyframes fcRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes fcSlide { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes fcSpin { to { transform: rotate(360deg); } }

.fc-ic { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; vertical-align: middle; }
.fc-muted { color: var(--fc-muted); }
.fc-row { display: flex; align-items: center; }
.fc-row > * + * { margin-left: 8px; }
.fc-grow { flex: 1; min-width: 0; }
.fc-kbd { display: inline-block; padding: 0 5px; border-radius: 3px; font: 600 11px/16px var(--fc-font); background: var(--fc-s1); border: 1px solid var(--fc-divider); color: var(--fc-text); }
.fc-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--fc-s4); border-top-color: var(--fc-accent); animation: fcSpin .8s linear infinite; display: inline-block; }

.fc-btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 16px; border: 0; border-radius: var(--fc-r1);
  font: 500 14px/1 var(--fc-font); color: #fff; background: var(--fc-accent); cursor: pointer; white-space: nowrap; user-select: none;
  transition: background var(--fc-fast), color var(--fc-fast), opacity var(--fc-fast), box-shadow var(--fc-fast); text-decoration: none; }
.fc-btn:hover { background: var(--fc-accent-h); }
.fc-btn:active { transform: translateY(1px); }
.fc-btn > .fc-ic { width: 16px; height: 16px; margin-right: 6px; }
.fc-btn.sec { background: var(--fc-btn); }
.fc-btn.sec:hover { background: var(--fc-btn-h); }
.fc-btn.ghost { background: transparent; color: var(--fc-text); }
.fc-btn.ghost:hover { background: var(--fc-hover); color: var(--fc-head); }
.fc-btn.danger { background: var(--fc-danger); }
.fc-btn.danger:hover { background: #da373c; }
.fc-btn.success { background: var(--fc-success); }
.fc-btn.success:hover { background: #1a8d4b; }
.fc-btn.brand { background: var(--fc-brand); box-shadow: var(--fc-glow); }
.fc-btn.sm { height: 24px; padding: 0 10px; font-size: 12px; }
.fc-btn.sm > .fc-ic { width: 14px; height: 14px; margin-right: 4px; }
.fc-btn.lg { height: 40px; padding: 0 20px; font-size: 15px; }
.fc-btn.icon { width: 32px; padding: 0; }
.fc-btn.icon > .fc-ic { margin: 0; }
.fc-btn.sm.icon { width: 24px; }
.fc-btn[disabled], .fc-btn.is-off { opacity: .5; cursor: default; transform: none !important; }
.fc-btn[disabled]:hover { filter: none; }

.fc-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: var(--fc-pill); background: var(--fc-btn);
  color: var(--fc-text); font: 600 12px/1 var(--fc-font); white-space: nowrap; cursor: default; }
.fc-chip[data-act] { cursor: pointer; }
.fc-chip[data-act]:hover { background: var(--fc-btn-h); }
.fc-chip.on { background: var(--fc-accent-soft); color: var(--fc-head); box-shadow: inset 0 0 0 1px var(--fc-accent); }
.fc-chip > .fc-ic { width: 12px; height: 12px; margin-right: 4px; }
.fc-tag { display: inline-block; min-width: 18px; height: 18px; padding: 0 4px; border-radius: var(--fc-r1); text-align: center;
  font: 800 11px/18px var(--fc-font); color: #111; background: var(--c, #9aa4b2); vertical-align: middle; }
.fc-flag { width: 20px !important; height: 14px !important; object-fit: cover; border-radius: 2px; vertical-align: -2px; }
.fc-badge { display: inline-block; min-width: 16px; height: 16px; padding: 0 4px; border-radius: var(--fc-pill); text-align: center;
  font: 700 11px/16px var(--fc-font); color: #fff; background: var(--fc-danger); }

.fc-card { background: var(--fc-s2); border-radius: var(--fc-r2); padding: 16px; color: var(--fc-text); font-family: var(--fc-font); box-shadow: inset 0 0 0 1px var(--fc-divider); }
.fc-card.raised { box-shadow: inset 0 0 0 1px var(--fc-divider), var(--fc-sh2); }
.fc-card-h { display: flex; align-items: center; margin: 0 0 12px; font: 700 12px/1.2 var(--fc-font); letter-spacing: .02em; text-transform: uppercase; color: var(--fc-muted); }
.fc-card-h > .fc-ic { width: 14px; height: 14px; margin-right: 6px; }
.fc-tile { display: inline-block; vertical-align: top; min-width: 96px; padding: 12px 14px; border-radius: var(--fc-r2); background: var(--fc-s1); box-shadow: inset 0 0 0 1px var(--fc-divider); }
.fc-tile .v { font: 700 22px/1.1 var(--fc-font); color: var(--fc-head); }
.fc-tile .k { margin-top: 4px; font: 700 11px/1.2 var(--fc-font); letter-spacing: .02em; text-transform: uppercase; color: var(--fc-muted); }
.fc-tile .s { margin-top: 2px; font: 12px/1.3 var(--fc-font); color: var(--fc-muted); }
.fc-tile.up .v { color: var(--fc-success); }
.fc-tile.down .v { color: var(--fc-danger); }

.fc-tabs { display: flex; align-items: center; border-bottom: 1px solid var(--fc-divider); }
.fc-tab { position: relative; padding: 8px 2px; margin-right: 18px; font: 500 14px/1 var(--fc-font); color: var(--fc-muted); cursor: pointer; }
.fc-tab:hover { color: var(--fc-text); }
.fc-tab.on { color: var(--fc-head); }
.fc-tab.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; border-radius: 2px; background: var(--fc-accent); }
.fc-tab .n { margin-left: 6px; font-size: 12px; color: var(--fc-faint); }

.fc-switch-in { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.fc-switch { position: relative; flex: none; width: 40px; height: 24px; border-radius: 12px; background: #80848e; transition: background var(--fc-med); cursor: pointer; }
.fc-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff;
  transition: transform var(--fc-med) var(--fc-ease); box-shadow: 0 1px 2px rgba(0,0,0,.3); }
.fc-switch-in:checked + .fc-switch { background: var(--fc-success); }
.fc-switch-in:checked + .fc-switch::after { transform: translateX(16px); }
.fc-switch-in:focus + .fc-switch { box-shadow: 0 0 0 2px var(--fc-link); }
.fc-input, .fc-select { height: 36px; padding: 0 10px; border: 0; border-radius: var(--fc-r1); background: var(--fc-input); color: var(--fc-text);
  font: 14px var(--fc-font); outline: none; box-sizing: border-box; }
.fc-input:focus, .fc-select:focus { box-shadow: 0 0 0 2px var(--fc-accent); }
.fc-input.fc-color { width: 48px; padding: 2px; cursor: pointer; }
.fc-select { padding-right: 6px; cursor: pointer; }
.fc-slider { -webkit-appearance: none; width: 160px; height: 6px; border-radius: 3px; background: var(--fc-s4); outline: none; cursor: pointer; }
.fc-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 22px; border-radius: 3px; background: #fff; box-shadow: var(--fc-sh1); cursor: grab; }
.fc-slider-v { flex: none; width: 44px; margin-left: 8px; text-align: right; font: 12px var(--fc-font); color: var(--fc-muted); }

.fc-set { color: var(--fc-text); font-family: var(--fc-font); }
.fc-set-title { margin: 0 0 4px; font: 600 16px/1.3 var(--fc-font); color: var(--fc-head); }
.fc-set-reset { float: right; margin: -2px 0 0 8px; color: var(--fc-muted); }
.fc-set-title small { margin-left: 4px; font-size: 12px; font-weight: 400; color: var(--fc-muted); }
.fc-set-row[hidden], .fc-set [hidden] { display: none !important; }
.fc-field { position: relative; display: flex; align-items: center; min-height: 40px; padding: 8px 0; border-bottom: 1px solid var(--fc-divider); cursor: default; }
label.fc-field { cursor: pointer; }
.fc-set-row:last-child .fc-field { border-bottom: 0; }
.fc-field-text { flex: 1; min-width: 0; margin-right: 12px; }
.fc-field-text b { display: block; font: 500 14px/1.3 var(--fc-font); color: var(--fc-text); }
.fc-field-text small { display: block; margin-top: 2px; font: 12px/1.35 var(--fc-font); color: var(--fc-muted); }
.fc-note { margin: 8px 0; padding: 8px 12px; border-radius: var(--fc-r1); background: var(--fc-s1); font: 12px/1.45 var(--fc-font); color: var(--fc-muted); }

.fc-avatar { position: relative; display: inline-block; flex: none; width: var(--sz, 32px); height: var(--sz, 32px); vertical-align: middle; }
.fc-avatar > img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; background: var(--fc-s4); display: block; }
.fc-avatar > .st { position: absolute; right: -2px; bottom: -2px; width: 30%; height: 30%; min-width: 8px; min-height: 8px; border-radius: 50%;
  border: 3px solid var(--ring, var(--fc-s2)); background: #80848e; box-sizing: content-box; }
.fc-avatar > .st.on { background: var(--fc-success); }
.fc-avatar > .st.away { background: var(--fc-warning); }
.fc-avatar > .st.playing { background: var(--fc-danger); }

.fc-progress { position: relative; height: 6px; border-radius: var(--fc-pill); background: var(--fc-s4); overflow: hidden; }
.fc-progress > i { position: absolute; top: 0; left: 0; bottom: 0; border-radius: inherit; background: var(--c, var(--fc-accent)); transition: width var(--fc-slow) var(--fc-ease); }
.fc-ring { display: inline-block; vertical-align: middle; }
.fc-ring .bg { stroke: var(--fc-s4); }
.fc-ring .fg { stroke: var(--c, var(--fc-accent)); transition: stroke-dashoffset var(--fc-slow) var(--fc-ease); }
.fc-ring text { fill: var(--fc-head); font: 700 11px var(--fc-font); }

.fc-empty { padding: 32px 16px; text-align: center; color: var(--fc-muted); font-family: var(--fc-font); }
.fc-empty > .fc-ic { width: 40px; height: 40px; margin-bottom: 10px; stroke-width: 1.5; opacity: .7; }
.fc-empty .t { font: 600 16px/1.3 var(--fc-font); color: var(--fc-head); }
.fc-empty .s { margin-top: 4px; font: 13px/1.45 var(--fc-font); }
.fc-empty .fc-btn { margin-top: 14px; }

.fc-pop { position: fixed; z-index: var(--fc-z-pop); min-width: 180px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow: auto;
  padding: 8px; border-radius: var(--fc-r2); background: var(--fc-s0); color: var(--fc-text); box-shadow: var(--fc-sh3);
  font: 14px/1.4 var(--fc-font); animation: fcPop var(--fc-fast) var(--fc-ease) both; box-sizing: border-box; }
.fc-menu-item { display: flex; align-items: center; padding: 6px 8px; border-radius: 2px; cursor: pointer; color: var(--fc-text); }
.fc-menu-item:hover { background: var(--fc-accent); color: #fff; }
.fc-menu-item.danger { color: var(--fc-danger); }
.fc-menu-item.danger:hover { background: var(--fc-danger); color: #fff; }
.fc-menu-item > .fc-ic { width: 16px; height: 16px; margin-right: 8px; }
.fc-menu-sep { height: 1px; margin: 4px 6px; background: var(--fc-divider); }

.fc-mask { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: var(--fc-z-modal); display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.72); animation: fcIn var(--fc-med) ease both; }
.fc-modal { width: var(--w, 440px); max-width: calc(100vw - 32px); max-height: calc(100vh - 48px); display: flex; flex-direction: column;
  border-radius: var(--fc-r2); background: var(--fc-s3); color: var(--fc-text); box-shadow: var(--fc-sh3); overflow: hidden;
  font: 14px/1.45 var(--fc-font); animation: fcPop var(--fc-med) var(--fc-ease) both; }
.fc-modal-h { display: flex; align-items: center; padding: 16px 16px 8px; font: 700 20px/1.25 var(--fc-font); color: var(--fc-head); }
.fc-modal-h .fc-btn.icon { margin-left: auto; }
.fc-modal-b { padding: 8px 16px 16px; overflow: auto; }
.fc-modal-f { display: flex; justify-content: flex-end; padding: 16px; background: var(--fc-s2); }
.fc-modal-f > .fc-btn + .fc-btn { margin-left: 8px; }

.fc-page { position: fixed; top: 0; bottom: 0; right: 0; left: var(--fcd-left, 72px); z-index: var(--fc-z-page); display: flex; flex-direction: column;
  background: var(--fc-s3); color: var(--fc-text); font: 14px/1.45 var(--fc-font); animation: fcIn var(--fc-med) ease both; }
/* the Discover browse sidebar takes another 232px */
html.fcd-browse .fc-page { left: calc(var(--fcd-left, 72px) + 232px); }
.fc-page-h { flex: none; display: flex; align-items: center; height: 48px; padding: 0 16px; border-bottom: 1px solid var(--fc-divider); box-shadow: var(--fc-sh1); }
.fc-page-h .t { display: flex; align-items: center; font: 600 16px/1 var(--fc-font); color: var(--fc-head); }
.fc-page-h .t > .fc-ic { margin-right: 8px; color: var(--fc-muted); }
.fc-page-h .tools { display: flex; align-items: center; margin-left: auto; }
.fc-page-h .tools > * + * { margin-left: 8px; }
.fc-page-b { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px 32px; }

.fc-toasts { position: fixed; right: 24px; bottom: 24px; z-index: var(--fc-z-toast); display: flex; flex-direction: column-reverse; align-items: flex-end; pointer-events: none; }
.fc-toast { pointer-events: auto; width: 340px; max-width: calc(100vw - 48px); margin-top: 8px; padding: 12px 14px; box-sizing: border-box;
  border-radius: var(--fc-r2); border-left: 3px solid var(--c, var(--fc-accent)); background: var(--fc-s0); color: var(--fc-text);
  box-shadow: var(--fc-sh3); font: 14px/1.4 var(--fc-font); animation: fcSlide var(--fc-med) var(--fc-ease) both; cursor: pointer; }
.fc-toast.out { opacity: 0; transform: translateX(24px); transition: opacity var(--fc-med), transform var(--fc-med); }
.fc-toast.success { --c: var(--fc-success); }
.fc-toast.danger { --c: var(--fc-danger); }
.fc-toast.warning { --c: var(--fc-warning); }
.fc-toast .t { display: flex; align-items: center; font-weight: 600; color: var(--fc-head); }
.fc-toast .t > .fc-ic { margin-right: 8px; color: var(--c, var(--fc-accent)); }
.fc-toast .s { margin-top: 2px; font-size: 12px; color: var(--fc-muted); }
.fc-toast .a { display: flex; margin-top: 10px; }
.fc-toast .a > .fc-btn + .fc-btn { margin-left: 8px; }

.fc-chart { display: block; overflow: visible; font-family: var(--fc-font); }
.fc-chart .grid { stroke: var(--fc-divider); stroke-width: 1; }
.fc-chart .ln { fill: none; stroke: var(--c, var(--fc-accent)); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.fc-chart .area { fill: var(--c, var(--fc-accent)); opacity: .14; stroke: none; }
.fc-chart .dot { fill: var(--c, var(--fc-accent)); stroke: var(--fc-s2); stroke-width: 2; }
.fc-chart .bar { fill: var(--c, var(--fc-accent)); }
.fc-chart text { fill: var(--fc-muted); font-size: 10px; }
.fc-chart text.v { fill: var(--fc-head); font-weight: 700; }
`;

function ensureStyle() {
    if (!hasDom() || document.getElementById('fcCoreStyle')) return;
    const st = document.createElement('style');
    st.id = 'fcCoreStyle';
    st.textContent = STYLE;
    (document.head || document.documentElement).appendChild(st);
}

// Layers (popovers, modals, pages) close on Esc, topmost first (Fightcade handles keyup).
const layers = [];
let layerKeys = false;
function pushLayer(close) {
    layers.push(close);
    if (!layerKeys && hasDom()) {
        layerKeys = true;
        document.addEventListener('keyup', (e) => {
            if (e.key !== 'Escape' || !layers.length) return;
            e.stopPropagation();
            layers[layers.length - 1]();
        }, true);
    }
    return () => { const i = layers.indexOf(close); if (i >= 0) layers.splice(i, 1); };
}

function toEl(content) {
    if (content instanceof Element) return content;
    const d = document.createElement('div');
    d.innerHTML = content == null ? '' : String(content);
    return d;
}

function copyText(text) {
    try { require('electron').clipboard.writeText(String(text)); return true; } catch (e) { /* not Electron */ }
    try { if (navigator.clipboard) { navigator.clipboard.writeText(String(text)); return true; } } catch (e) { /* no clipboard */ }
    return false;
}

const ui = {
    ICONS,
    // join the Esc stack (topmost closes first) -> remove function
    layer: (close) => pushLayer(close),
    // a module's stylesheet: added once, replaced when the css changes (null removes it)
    style(id, css) {
        if (!hasDom()) return null;
        let st = document.getElementById(id);
        if (css == null) { if (st) st.remove(); return null; }
        if (!st) { st = document.createElement('style'); st.id = id; (document.head || document.documentElement).appendChild(st); }
        if (st.textContent !== css) st.textContent = css;
        return st;
    },
    icon(name, cls) { return `<svg class="fc-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`; },

    // fc.ui.btn('Save', { kind: 'sec'|'ghost'|'danger'|'success'|'brand', size: 'sm'|'lg', icon, act, title, attrs })
    btn(label, o) {
        const p = o || {};
        const cls = ['fc-btn', p.kind, p.size, label ? '' : 'icon', p.cls].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}"${p.act ? ` data-act="${fmt.esc(p.act)}"` : ''}${p.title ? ` title="${fmt.esc(p.title)}"` : ''}${p.disabled ? ' disabled' : ''}${p.attrs ? ' ' + p.attrs : ''}>` +
            (p.icon ? ui.icon(p.icon) : '') + (label ? fmt.esc(label) : '') + '</button>';
    },
    chip(label, o) {
        const p = o || {};
        return `<span class="fc-chip${p.on ? ' on' : ''}"${p.act ? ` data-act="${fmt.esc(p.act)}"` : ''}${p.title ? ` title="${fmt.esc(p.title)}"` : ''}>${p.icon ? ui.icon(p.icon) : ''}${fmt.esc(label)}</span>`;
    },
    // rank badge: 'S' / 6
    tag(rank, title) {
        const l = data.rankLetter(rank) || '?';
        return `<span class="fc-tag" style="--c:${data.rankColor(rank)}"${title ? ` title="${fmt.esc(title)}"` : ''}>${l}</span>`;
    },
    badge: (n) => n ? `<span class="fc-badge">${n > 99 ? '99+' : n}</span>` : '',
    // Fightcade's flag picture for a country code (a missing one just disappears)
    flag(cc, title) {
        if (!cc) return '';
        return `<img class="fc-flag" src="static/flags/${fmt.esc(String(cc).toLowerCase())}.png" alt=""${title ? ` title="${fmt.esc(title)}"` : ''} onerror="this.remove()">`;
    },
    // status: 'on' | 'away' | 'playing' | 'off' | '' (no dot); 'auto' reads Fightcade
    avatar(name, o) {
        const p = o || {};
        const [, u] = app.user(name);
        let st = p.status || '';
        if (st === 'auto') st = !u ? 'off' : (u.playing && u.playing.quarkId) ? 'playing' : u.away ? 'away' : 'on';
        return `<span class="fc-avatar" style="--sz:${p.size || 32}px${p.ring ? ';--ring:' + p.ring : ''}"><img src="${fmt.esc(data.avatarUrl(name, u && u.gravatar, (p.size || 32) * 2))}" alt="" loading="lazy">` +
            (st ? `<i class="st ${st}"></i>` : '') + '</span>';
    },
    tile(value, caption, o) {
        const p = o || {};
        return `<div class="fc-tile${p.trend ? ' ' + p.trend : ''}"><div class="v">${fmt.esc(value)}</div><div class="k">${fmt.esc(caption)}</div>${p.sub ? `<div class="s">${fmt.esc(p.sub)}</div>` : ''}</div>`;
    },
    tabs(items, active) {
        return `<div class="fc-tabs">${items.map(([id, label, n]) => `<span class="fc-tab${id === active ? ' on' : ''}" data-tab="${fmt.esc(id)}">${fmt.esc(label)}${n != null ? `<span class="n">${n}</span>` : ''}</span>`).join('')}</div>`;
    },
    empty(o) {
        const p = o || {};
        return `<div class="fc-empty">${ui.icon(p.icon || 'info')}<div class="t">${fmt.esc(p.title || 'Nothing here yet')}</div>` +
            (p.sub ? `<div class="s">${fmt.esc(p.sub)}</div>` : '') + (p.action ? ui.btn(p.action, { act: p.act || 'empty' }) : '') + '</div>';
    },
    progress(frac, color) {
        const w = Math.max(0, Math.min(1, +frac || 0)) * 100;
        return `<div class="fc-progress"${color ? ` style="--c:${color}"` : ''}><i style="width:${w.toFixed(1)}%"></i></div>`;
    },
    ring(frac, o) {
        const p = o || {};
        const size = p.size || 36, sw = p.stroke || 4, r = (size - sw) / 2, c = 2 * Math.PI * r;
        const f = Math.max(0, Math.min(1, +frac || 0));
        return `<svg class="fc-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"${p.color ? ` style="--c:${p.color}"` : ''}>` +
            `<circle class="bg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${sw}"/>` +
            `<circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${sw}" stroke-linecap="round" ` +
            `stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - f)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` +
            (p.label != null ? `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central">${fmt.esc(p.label)}</text>` : '') + '</svg>';
    },

    // fc.ui.toast('Saved', { sub, kind: 'success'|'danger'|'warning', icon, ms, actions: [{ label, fn, kind }], onClick })
    toast(title, o) {
        if (!hasDom()) return { close() {} };
        ensureStyle();
        const p = o || {};
        let host = document.getElementById('fcToasts');
        if (!host) { host = document.createElement('div'); host.id = 'fcToasts'; host.className = 'fc-toasts'; document.body.appendChild(host); }
        // the same toast again: bump it instead of stacking copies
        const key = title + '|' + (p.sub || '');
        const old = [...host.children].find(t => t.__fcKey === key);
        if (old && old.__fcClose) old.__fcClose(true);
        while (host.children.length >= 4) host.firstChild.remove();
        const el = document.createElement('div');
        el.className = 'fc-toast' + (p.kind ? ' ' + p.kind : '');
        el.__fcKey = key;
        const icon = p.icon || ({ success: 'check', danger: 'warn', warning: 'warn' })[p.kind] || '';
        el.innerHTML = `<div class="t">${icon ? ui.icon(icon) : ''}<span>${fmt.esc(title)}</span></div>` +
            (p.sub ? `<div class="s">${fmt.esc(p.sub)}</div>` : '') +
            ((p.actions || []).length ? `<div class="a">${p.actions.map((a, i) => ui.btn(a.label, { size: 'sm', kind: a.kind || (i ? 'sec' : ''), attrs: `data-i="${i}"` })).join('')}</div>` : '');
        let timer = 0;
        const close = (fast) => {
            clearTimeout(timer);
            if (fast) { el.remove(); return; }
            el.classList.add('out');
            setTimeout(() => el.remove(), 220);
        };
        el.__fcClose = close;
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-i]');
            if (b) { const a = p.actions[+b.getAttribute('data-i')]; try { a.fn(); } catch (err) { LOG.warn('toast action', err); } }
            else if (p.onClick) { try { p.onClick(); } catch (err) { LOG.warn('toast click', err); } }
            close();
        });
        el.addEventListener('mouseenter', () => clearTimeout(timer));
        el.addEventListener('mouseleave', () => { if (p.ms !== 0) timer = setTimeout(close, 2000); });
        host.appendChild(el);
        if (p.ms !== 0) timer = setTimeout(close, p.ms || 4500);
        return { el, close };
    },

    // fc.ui.popover(anchor (Element | DOMRect | {x, y}), content, { side: 'bottom'|'top'|'right'|'left', cls, width, onClose })
    popover(anchor, content, o) {
        ensureStyle();
        const p = o || {};
        const el = document.createElement('div');
        el.className = 'fc-pop' + (p.cls ? ' ' + p.cls : '');
        if (p.width) el.style.width = p.width + 'px';
        el.appendChild(toEl(content));
        document.body.appendChild(el);
        const rect = anchor instanceof Element ? anchor.getBoundingClientRect()
            : anchor && anchor.width != null ? anchor : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
        ui.place(el, rect, p.side || 'bottom');
        let closed = false;
        const outside = (e) => { if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) close(); };
        const unlayer = pushLayer(() => close());
        const close = () => {
            if (closed) return;
            closed = true;
            unlayer();
            document.removeEventListener('mousedown', outside, true);
            el.remove();
            if (p.onClose) p.onClose();
        };
        setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
        return { el, close };
    },

    // keep a floating element on screen next to a rect
    place(el, rect, side) {
        const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, m = 8;
        let x, y;
        if (side === 'right' || side === 'left') {
            x = side === 'right' ? rect.right + m : rect.left - w - m;
            if (x + w > vw - m) x = rect.left - w - m;
            if (x < m) x = Math.min(vw - w - m, rect.right + m);
            y = rect.top;
        } else {
            y = side === 'top' ? rect.top - h - m : rect.bottom + m;
            if (y + h > vh - m) y = rect.top - h - m;
            if (y < m) y = Math.min(vh - h - m, rect.bottom + m);
            x = rect.left;
        }
        el.style.left = Math.max(m, Math.min(vw - w - m, x)) + 'px';
        el.style.top = Math.max(m, Math.min(vh - h - m, y)) + 'px';
    },

    // a little menu: items [{ label, icon, fn, danger }] | 'sep'
    menu(anchor, items, o) {
        const box = document.createElement('div');
        box.innerHTML = items.map((it, i) => it === 'sep' ? '<div class="fc-menu-sep"></div>'
            : `<div class="fc-menu-item${it.danger ? ' danger' : ''}" data-i="${i}">${it.icon ? ui.icon(it.icon) : ''}${fmt.esc(it.label)}</div>`).join('');
        const pop = ui.popover(anchor, box, o);
        box.addEventListener('click', (e) => {
            const row = e.target.closest('[data-i]');
            if (!row) return;
            pop.close();
            try { items[+row.getAttribute('data-i')].fn(); } catch (err) { LOG.warn('menu', err); }
        });
        return pop;
    },

    // fc.ui.modal({ title, body, width, actions: [{ label, kind, fn, keep }], onClose })
    modal(o) {
        ensureStyle();
        const p = o || {};
        const mask = document.createElement('div');
        mask.className = 'fc-mask';
        mask.innerHTML = `<div class="fc-modal"${p.width ? ` style="--w:${p.width}px"` : ''}><div class="fc-modal-h"><span>${fmt.esc(p.title || '')}</span>` +
            ui.btn('', { kind: 'ghost', icon: 'close', act: 'close', title: 'Close' }) + '</div><div class="fc-modal-b"></div>' +
            ((p.actions || []).length ? `<div class="fc-modal-f">${p.actions.map((a, i) => ui.btn(a.label, { kind: a.kind || (i === p.actions.length - 1 ? '' : 'ghost'), attrs: `data-i="${i}"` })).join('')}</div>` : '') + '</div>';
        const body = mask.querySelector('.fc-modal-b');
        body.appendChild(toEl(p.body));
        let closed = false;
        const unlayer = pushLayer(() => close());
        const close = () => {
            if (closed) return;
            closed = true;
            unlayer();
            mask.remove();
            if (p.onClose) p.onClose();
        };
        mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
        mask.addEventListener('click', (e) => {
            if (e.target.closest('[data-act="close"]')) { close(); return; }
            const b = e.target.closest('.fc-modal-f [data-i]');
            if (!b) return;
            const a = p.actions[+b.getAttribute('data-i')];
            let keep = !!a.keep;
            try { if (a.fn && a.fn(body) === false) keep = true; } catch (err) { LOG.warn('modal action', err); }
            if (!keep) close();
        });
        document.body.appendChild(mask);
        return { el: mask, body, close };
    },

    confirm(title, text, o) {
        const p = o || {};
        return new Promise(res => {
            let answered = false;
            ui.modal({
                title, body: `<p style="margin:0">${fmt.esc(text || '')}</p>`, width: 420,
                actions: [{ label: p.cancel || 'Cancel', kind: 'ghost', fn: () => { answered = true; res(false); } },
                    { label: p.ok || 'OK', kind: p.danger ? 'danger' : '', fn: () => { answered = true; res(true); } }],
                onClose: () => { if (!answered) res(false); }
            });
        });
    },

    // a full page over the main area (like Stats / Friends): one per id
    // fc.ui.page('stats', { title, icon, tools: html, render(body, page), onClose }) -> { el, body, close, setTitle }
    page(id, o) {
        ensureStyle();
        const p = o || {};
        const existing = document.getElementById('fcPage-' + id);
        if (existing && existing.__fcPage) { existing.__fcPage.refresh(); return existing.__fcPage; }
        const el = document.createElement('div');
        el.id = 'fcPage-' + id;
        el.className = 'fc-page' + (p.cls ? ' ' + p.cls : '');
        el.innerHTML = `<div class="fc-page-h"><span class="t">${p.icon ? ui.icon(p.icon) : ''}<span class="tt">${fmt.esc(p.title || '')}</span></span>` +
            `<span class="tools">${p.tools || ''}${ui.btn('', { kind: 'ghost', icon: 'close', act: 'close', title: 'Close (Esc)' })}</span></div><div class="fc-page-b"></div>`;
        const body = el.querySelector('.fc-page-b');
        let closed = false;
        // onEsc() returning false keeps the page open (e.g. Esc steps back a level first)
        const unlayer = pushLayer(() => { if (p.onEsc && p.onEsc() === false) return; page.close(); });
        const page = {
            el, body,
            setTitle(t) { el.querySelector('.tt').textContent = t; },
            refresh() { if (p.render) { try { p.render(body, page); } catch (e) { LOG.warn('page ' + id, e); } } },
            close() {
                if (closed) return;
                closed = true;
                unlayer();
                el.remove();
                if (p.onClose) p.onClose();
            }
        };
        el.__fcPage = page;
        el.querySelector('.fc-page-h [data-act="close"]').addEventListener('click', () => page.close());
        document.body.appendChild(el);
        page.refresh();
        return page;
    },

    // SVG charts (strings). series: [{ points: [[x, y]], color, area }]
    chart: {
        line(series, o) {
            const p = Object.assign({ w: 480, h: 160, pad: 24, dots: false, grid: 4 }, o || {});
            const all = [].concat(...series.map(s => s.points));
            if (!all.length) return `<svg class="fc-chart" width="${p.w}" height="${p.h}"></svg>`;
            const xs = all.map(q => q[0]), ys = all.map(q => q[1]);
            const x0 = Math.min(...xs), x1 = Math.max(...xs);
            const y0 = p.yMin != null ? p.yMin : Math.min(...ys), y1 = p.yMax != null ? p.yMax : Math.max(...ys);
            const W = p.w - p.pad * 2, H = p.h - p.pad * 2;
            const X = (x) => p.pad + (x1 === x0 ? W / 2 : (x - x0) / (x1 - x0) * W);
            const Y = (y) => p.pad + H - (y1 === y0 ? H / 2 : (y - y0) / (y1 - y0) * H);
            let out = `<svg class="fc-chart" width="${p.w}" height="${p.h}" viewBox="0 0 ${p.w} ${p.h}">`;
            for (let i = 0; i <= p.grid; i++) {
                const gy = p.pad + H * i / p.grid;
                out += `<line class="grid" x1="${p.pad}" x2="${p.w - p.pad}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}"/>`;
                if (p.yLabel) out += `<text x="${p.pad - 4}" y="${(gy + 3).toFixed(1)}" text-anchor="end">${fmt.esc(p.yLabel(y1 - (y1 - y0) * i / p.grid))}</text>`;
            }
            series.forEach(s => {
                const pts = s.points.map(q => X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1));
                const style = s.color ? ` style="--c:${s.color}"` : '';
                if (s.area && pts.length > 1) out += `<path class="area"${style} d="M${X(s.points[0][0]).toFixed(1)},${p.pad + H} L${pts.join(' L')} L${X(s.points[s.points.length - 1][0]).toFixed(1)},${p.pad + H} Z"/>`;
                out += `<polyline class="ln"${style} points="${pts.join(' ')}"/>`;
                if (p.dots || s.points.length < 2) s.points.forEach(q => { out += `<circle class="dot"${style} cx="${X(q[0]).toFixed(1)}" cy="${Y(q[1]).toFixed(1)}" r="3.5"/>`; });
            });
            if (p.xLabels) p.xLabels.forEach(([x, label]) => { out += `<text x="${X(x).toFixed(1)}" y="${p.h - 6}" text-anchor="middle">${fmt.esc(label)}</text>`; });
            return out + '</svg>';
        },
        // bars: [{ label, value, color, title }]
        bars(bars, o) {
            const p = Object.assign({ w: 480, h: 160, pad: 20, gap: 6, values: true }, o || {});
            const max = p.max != null ? p.max : Math.max(1, ...bars.map(b => +b.value || 0));
            const W = p.w - p.pad * 2, H = p.h - p.pad * 2 - 12, n = Math.max(1, bars.length);
            const bw = Math.max(2, (W - p.gap * (n - 1)) / n);
            let out = `<svg class="fc-chart" width="${p.w}" height="${p.h}" viewBox="0 0 ${p.w} ${p.h}">`;
            bars.forEach((b, i) => {
                const v = Math.max(0, +b.value || 0), bh = H * v / max, x = p.pad + i * (bw + p.gap), y = p.pad + H - bh;
                out += `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="3"${b.color ? ` style="--c:${b.color}"` : ''}>` +
                    (b.title ? `<title>${fmt.esc(b.title)}</title>` : '') + '</rect>';
                if (p.values && b.text != null) out += `<text class="v" x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${fmt.esc(b.text)}</text>`;
                if (b.label != null) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${p.h - 4}" text-anchor="middle">${fmt.esc(b.label)}</text>`;
            });
            return out + '</svg>';
        }
    },

    copy: copyText
};

/* ========================================================================= sound */

// One AudioContext for every little sound. Music (music.js) listens to 'sound:duck'.
let actx = null;
const SOUNDS = {
    ping: [[880, 0, .12], [1320, .09, .18]],
    ring: [[660, 0, .16], [880, .16, .16], [660, .32, .16], [880, .48, .22]],
    success: [[523, 0, .12], [659, .1, .12], [784, .2, .26]],
    fail: [[392, 0, .18], [311, .16, .3]],
    click: [[1200, 0, .04]],
    chime: [[660, 0, .3], [880, .18, .35]]
};

const sound = {
    ctx() {
        if (!actx) { const C = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (C) actx = new C(); }
        if (actx && actx.state === 'suspended') actx.resume();
        return actx;
    },
    volume: () => coreStore ? Math.max(0, Math.min(1, +coreStore.data.sfxVolume || 0)) : .6,
    // notes: [[freq, startSec, durSec, type?]]
    tone(notes, o) {
        const c = sound.ctx();
        if (!c) return false;
        const p = o || {};
        const vol = (p.volume != null ? p.volume : 1) * sound.volume() * .5;
        if (vol <= 0) return false;
        const t = c.currentTime;
        notes.forEach(([f, d, len, type]) => {
            const osc = c.createOscillator(), g = c.createGain();
            osc.type = type || 'sine';
            osc.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t + d);
            g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + d + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, t + d + len);
            osc.connect(g);
            g.connect(c.destination);
            osc.start(t + d);
            osc.stop(t + d + len + 0.05);
        });
        return true;
    },
    play(name, o) { return SOUNDS[name] ? sound.tone(SOUNDS[name], o) : false; },
    // an audio file / blob URL through the same volume
    file(url, o) {
        try {
            const a = new Audio(url);
            a.volume = Math.max(0, Math.min(1, ((o && o.volume) != null ? o.volume : 1) * sound.volume()));
            a.play().catch(() => {});
            return a;
        } catch (e) { return null; }
    },
    duck(on) { emit('sound:duck', !!on); },
    names: () => Object.keys(SOUNDS)
};

/* =================================================================== diagnostics */

function anchors() {
    const r = app.root();
    const has = (v) => v != null;
    return {
        app: !!r,
        global: !!(r && app.global().localUser),
        me: !!app.me(),
        globalUsers: !!(r && has(r.globalUsers)),
        channels: !!(r && Array.isArray(r.channels)),
        connectionCallbacks: !!(r && r.connectionCallbacks && typeof r.connectionCallbacks.onChallengeRequest === 'function'),
        selectChannel: !!(r && typeof r.selectChannel === 'function'),
        getChannelComponentById: !!(r && typeof r.getChannelComponentById === 'function'),
        acceptChallenge: !!(r && typeof r.acceptChallenge === 'function'),
        declineChallenge: !!(r && typeof r.declineChallenge === 'function'),
        $watch: !!(r && typeof r.$watch === 'function'),
        settingsPage: hasDom() && !!document.querySelector('.frontendOptions, .settingsWrapper')
    };
}

function diag() {
    let counts = 0;
    listeners.forEach(l => { counts += l.length; });
    return {
        core: CORE_API, fightcord: bootInfo.version || '', fightcade: app.version(), safeMode,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
        modules: modules.list(),
        tick: { jobs: tasks.size, runs: tickRuns, base: !!tickBase },
        watch: { watchers: watchers.size, runs: moRuns, observing: !!mo },
        events: counts, commands: cmds.size, settingsBlocks: blocks.size, configs: [...stores.keys()],
        hooks: { challenge: !!chActive, handlers: chHandlers.length, methods: methodHooks.length },
        api: api.stats(),
        history: historyCache ? historyCache.sets.length : null,
        anchors: anchors(),
        errors: RING.filter(e => e.level !== 'info').slice(-25)
    };
}

function diagText() {
    const d = diag();
    const lines = [
        'Fightcord ' + (d.fightcord || '?') + ' (core ' + d.core + ')' + (d.safeMode ? ' SAFE MODE' : ''),
        'Fightcade ' + (d.fightcade || '?') + ' · ' + d.userAgent,
        '',
        'Modules:',
        ...d.modules.map(m => '  ' + (m.state === 'running' ? '✓' : m.state === 'failed' ? '✗' : '–') + ' ' + m.id + (m.legacy ? ' (old)' : '') + (m.error ? ' — ' + m.error.split('\n')[0] : '')),
        '',
        'Timers ' + d.tick.jobs + ' · watchers ' + d.watch.watchers + ' · listeners ' + d.events + ' · commands ' + d.commands,
        'API: ' + JSON.stringify(d.api),
        'Missing Fightcade anchors: ' + (Object.keys(d.anchors).filter(k => !d.anchors[k]).join(', ') || 'none'),
        '',
        'Recent problems:',
        ...(d.errors.length ? d.errors.map(e => '  ' + new Date(e.at).toISOString().slice(11, 19) + ' ' + e.level + ' [' + e.scope + '] ' + e.text.split('\n')[0]) : ['  none'])
    ];
    return lines.join('\n');
}

/* ===================================================================== assembly */

let coreStore = null;
const bootInfo = { version: '', at: 0 };

// the `fc` a module gets: the shared parts plus registration functions tagged with it
function api_for(owner) {
    const ev = eventsFor(owner);
    const config = configFor(owner);
    config.exportAll = exportAll;
    config.importAll = importAll;
    config.flush = flushStores;
    const watch = watchFor(owner);
    const appScoped = Object.assign(Object.create(app), { watch: appWatchFor(owner) });
    return {
        id: owner.id, core: CORE_API,
        get safeMode() { return safeMode; },
        get version() { return bootInfo.version; },
        app: appScoped,
        modules,
        events: ev, on: ev.on, emit,
        tick: tickFor(owner),
        watch,
        config, files,
        settings: settingsFor(owner),
        cmd: cmdFor(owner),
        api,
        hooks: hooksFor(owner),
        history,
        ui, sound, fmt, data,
        log: makeLog(owner.name),
        guard: (fn, where) => guard(owner, fn, where),
        own: (dispose) => own(owner, dispose),
        diag, diagText
    };
}

const fc = api_for(CORE);

function applyCoreSettings() {
    if (!coreStore || !hasDom()) return;
    debugFile = !!coreStore.data.debugLog;
    document.documentElement.classList.toggle('fc-still', coreStore.data.animations === false);
}

// called by the loader (or by an old loader as if this were a plugin)
function boot(fcade, opts) {
    const o = opts || {};
    if (fcade) FCADE = fcade;
    if (bootInfo.at) return fc;
    bootInfo.at = now();
    bootInfo.version = o.version || readJson(path.join(DIR, 'fightcord.json'), {}).version || '';
    safeMode = !!o.safe;
    coreStore = configFor(CORE)('fightcord-core', { animations: true, sfxVolume: 0.6, debugLog: false, profile: 'full' });
    coreStore.on(applyCoreSettings);
    applyCoreSettings();
    if (hasDom()) {
        ensureStyle();
        window.fightcord = fc;
        window.addEventListener('beforeunload', flushStores);
        if (safeMode) setTimeout(() => ui.toast('Fightcord is in safe mode', {
            sub: 'Only the settings are on. Restart Fightcade to start normally.', kind: 'warning', icon: 'shield', ms: 12000
        }), 1500);
    }
    LOG('core ready' + (safeMode ? ' (safe mode)' : ''));
    return fc;
}

module.exports = (fcade) => boot(fcade);
module.exports.boot = boot;
module.exports.fc = fc;
module.exports.isCore = true;
module.exports.CORE_API = CORE_API;
// for the tests (plain Node, no page)
module.exports._test = {
    fmt, data, history, api, apiState, modules, makeOwner, fault, guard, emit, eventsFor, configFor, tickFor, runTasks, tasks,
    exportAll, importAll, flushStores, inChain, installChallengeHook, hooksFor, diag, diagText, ui,
    setDir(d) { DIR = d; historyCache = null; stores.clear(); },
    setRoot(r) { FCADE = r; },
    reset() { mods.clear(); order.length = 0; chHandlers.length = 0; chActive = null; tasks.clear(); }
};
