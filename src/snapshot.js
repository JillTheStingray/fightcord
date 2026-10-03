/**
 * Fightcord snapshot helper (a developer tool, off by default)
 *
 * Press Ctrl+Shift+S (or send /snap in chat) to save what's on screen, so the UI
 * can be rebuilt offline (FC's devtools are disabled, and web.fightcade.com only
 * serves the app to the FC client). Writes:
 *
 *   inject/fightcord/fc-snapshots/<time>-<view>/
 *       dom.html        the page markup (chat trimmed to the last 40 messages)
 *       styles.css      FC's real stylesheet rules, urls made absolute
 *       vars.json       theme variables, stylesheet list, data *shapes* (key names/types)
 *       screenshot.png  what the window looked like
 *
 * Nothing is uploaded anywhere; the files stay next to the plugin.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'fc-snapshots');
const LOG_PATH = path.join(__dirname, 'snapshot.log');
const CHAT_KEEP = 40;

let fc = null;

function log(...a) {
    const line = new Date().toISOString() + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
    console.log('[Snapshot]', ...a);
    try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch (e) { /* ignore */ }
}

function toast(msg) {
    const lines = String(msg).split(/\n/);
    fc.ui.toast(lines[0], { icon: 'download', sub: lines.slice(1).join(' '), ms: 6000 });
}

/* ------------------------------------------------------------ what view */

function visible(sel) {
    const el = document.querySelector(sel);
    return !!(el && el.offsetParent !== null);
}

function viewName() {
    if (!document.querySelector('.chatInput') && document.querySelector('input[type="password"]')) return 'login';
    const parts = [];
    if (visible('.challengeWrapper, .challengeContent')) parts.push('challenge');
    // the settings panel is always in the DOM; FC shows it by flipping visibility
    const sw = document.querySelector('.settingsWrapper');
    if (sw && getComputedStyle(sw).visibility === 'visible') parts.push('settings');
    if (visible('.welcomeWrapper')) parts.push('browse-home');
    if (visible('.searchWrapper')) parts.push('browse-search');
    // (search results reuse the .channelWrapper class for their cards)
    if ([...document.querySelectorAll('.channelWrapper')].some(c => c.offsetWidth && !c.closest('.searchResultsGrid'))) {
        const name = document.querySelector('.channelInfo .name')?.textContent || 'channel';
        parts.push(name.replace(/\s*\([^)]*\)\s*$/, ''));
    }
    const s = (parts.join('-') || 'lobby').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return s.slice(0, 40) || 'view';
}

/* ---------------------------------------------------------------- DOM */

function captureDom() {
    // live and clone nodes are paired by index below, so nothing may be removed
    // from the clone until that pairing is done
    const clone = document.documentElement.cloneNode(true);

    // relative src/href would break once the file is opened from disk
    const live = document.documentElement.querySelectorAll('[src], link[href]');
    const copies = clone.querySelectorAll('[src], link[href]');
    copies.forEach((c, i) => {
        const o = live[i];
        if (!o) return;
        if (c.hasAttribute('src') && o.src) c.setAttribute('src', o.src);
        if (c.tagName === 'LINK' && o.href) c.setAttribute('href', o.href);
    });

    // input values are properties, not attributes -- keep what's typed / ticked
    const liveInputs = document.documentElement.querySelectorAll('input, select, textarea');
    clone.querySelectorAll('input, select, textarea').forEach((c, i) => {
        const o = liveInputs[i];
        if (!o) return;
        if (o.type === 'checkbox' || o.type === 'radio') { if (o.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
        else if (o.tagName === 'INPUT' && o.type !== 'password') c.setAttribute('value', o.value);
        else if (o.type === 'password') c.setAttribute('value', '');
    });

    clone.querySelectorAll('script, iframe, noscript').forEach(n => n.remove());
    // Fightcord's own toasts would otherwise end up in every snapshot
    clone.querySelectorAll('#fcToasts, #snapshotToast').forEach(n => n.remove());

    clone.querySelectorAll('.chatContent').forEach(chat => {
        const msgs = chat.querySelectorAll('.messageWrapper');
        for (let i = 0; i < msgs.length - CHAT_KEEP; i++) msgs[i].remove();
    });

    return '<!doctype html>\n' + clone.outerHTML;
}

/* -------------------------------------------------------------- styles */

function absolutizeUrls(css, base) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => {
        if (/^(data:|https?:|blob:|#)/i.test(u)) return m;
        try { return 'url("' + new URL(u, base).href + '")'; } catch (e) { return m; }
    });
}

function captureStyles() {
    const out = [];
    const external = [];
    for (const sheet of document.styleSheets) {
        const where = sheet.href || ('inline <' + (sheet.ownerNode?.tagName || '?').toLowerCase() +
            (sheet.ownerNode?.id ? '#' + sheet.ownerNode.id : '') + '>');
        let rules;
        try { rules = sheet.cssRules; } catch (e) {
            external.push(sheet.href);
            out.push('/* ---- ' + where + ' (cross-origin, linked instead) ---- */');
            continue;
        }
        const base = sheet.href || location.href;
        out.push('/* ---- ' + where + ' ---- */');
        for (const r of rules) out.push(absolutizeUrls(r.cssText, base));
    }
    return { css: out.join('\n'), external };
}

/* ---------------------------------------------------------------- vars */

function customProps() {
    const names = new Set();
    for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const r of rules) {
            if (!r.style) continue;
            for (let i = 0; i < r.style.length; i++) {
                if (r.style[i].startsWith('--')) names.add(r.style[i]);
            }
        }
    }
    const inline = document.documentElement.style;
    for (let i = 0; i < inline.length; i++) if (inline[i].startsWith('--')) names.add(inline[i]);

    const cs = getComputedStyle(document.documentElement);
    const vals = {};
    [...names].sort().forEach(n => { vals[n] = cs.getPropertyValue(n).trim(); });
    return vals;
}

// Types and key names only -- we want to know what FC *has* (avatars? status
// fields?), not everybody's data.
function shape(v, depth) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return v.length ? ['array(' + v.length + ') of', shape(v[0], depth + 1)] : 'array(0)';
    if (typeof v !== 'object') return typeof v;
    if (depth > 2) return 'object';
    const keys = Object.keys(v).filter(k => !k.startsWith('_') && !k.startsWith('$'));
    // maps keyed by player/channel name (globalUsers, ...): the keys ARE the
    // data, so report a count and one value's shape instead of listing them
    if (keys.length > 6 && keys.every(k => v[k] && typeof v[k] === 'object')) {
        return ['map(' + keys.length + ') of', shape(v[keys[0]], depth + 1)];
    }
    const o = {};
    keys.slice(0, 60).forEach(k => {
        if (k.startsWith('_') || k.startsWith('$')) return;
        try { o[k] = shape(v[k], depth + 1); } catch (e) { o[k] = '?'; }
    });
    return o;
}

function captureVars() {
    const root = fc.app.root();
    const data = { view: viewName(), url: location.href, window: [innerWidth, innerHeight],
        htmlClass: document.documentElement.className, bodyClass: document.body.className,
        htmlStyle: document.documentElement.getAttribute('style') || '', customProps: customProps() };

    if (root) {
        const top = {};
        Object.keys(root).forEach(k => {
            if (k.startsWith('_') || k.startsWith('$')) return;
            try { top[k] = typeof root[k] === 'function' ? 'function' : shape(root[k], 2); } catch (e) { top[k] = '?'; }
        });
        data.fcadeTopLevel = top;

        const users = root.globalUsers || {};
        const names = Object.keys(users);
        data.globalUsersCount = names.length;
        const me = root._data?.global?.localUser?.name || root.$data?.global?.localUser?.name;
        const sample = users[me] || users[names[0]];
        if (sample) {
            data.userShape = shape(sample, 0);
            // image-ish fields: keep the value so we learn the avatar URL format
            data.userImageFields = {};
            Object.keys(sample).forEach(k => {
                if (/avatar|img|image|pic|photo/i.test(k)) data.userImageFields[k] = sample[k];
            });
        }
    }
    return data;
}

/* ---------------------------------------------------------- screenshot */

// The capture goes through electron.remote; if that call never settles, the
// whole snapshot must not hang with it -- give up on the picture after 4s.
async function captureScreenshot() {
    try {
        const electron = require('electron');
        const win = electron.remote && electron.remote.getCurrentWindow();
        if (!win) { log('screenshot unavailable: no electron.remote'); return null; }
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('capturePage timed out')), 4000));
        const img = await Promise.race([win.capturePage(), timeout]);
        return img.toPNG();
    } catch (e) {
        log('screenshot unavailable:', String(e && e.message || e));
        return null;
    }
}

/* ---------------------------------------------------------------- main */

let busy = false;
async function takeSnapshot() {
    if (busy) { log('hotkey ignored: previous snapshot still running'); return; }
    busy = true;
    log('hotkey received');
    try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const dir = path.join(OUT_DIR, stamp + '-' + viewName());
        fs.mkdirSync(dir, { recursive: true });

        // text files first: a screenshot problem must not cost the useful part
        const { css, external } = captureStyles();
        const vars = captureVars();
        vars.externalStylesheets = external;
        fs.writeFileSync(path.join(dir, 'dom.html'), captureDom());
        fs.writeFileSync(path.join(dir, 'styles.css'), css);
        fs.writeFileSync(path.join(dir, 'vars.json'), JSON.stringify(vars, null, 2));
        log('text files written', dir);

        // no toast is up yet, so the picture shows the real UI
        const png = await captureScreenshot();
        if (png) fs.writeFileSync(path.join(dir, 'screenshot.png'), png);

        log('saved', dir);
        toast('Snapshot saved' + (png ? '' : ' (no screenshot)') + '\n' + dir);
    } catch (e) {
        log('snapshot failed:', String(e && e.stack || e));
        toast('Snapshot failed: ' + (e && e.message || e));
    } finally {
        busy = false;
    }
}

function onKeyDown(e) {
    if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        takeSnapshot();
    }
}

function start(f) {
    fc = f;
    window.addEventListener('keydown', onKeyDown, true);
    fc.own(() => window.removeEventListener('keydown', onKeyDown, true));
    // backup trigger: "/snap" in the chat box (never sent to the channel)
    fc.cmd('snap', 'Save a snapshot of the screen (developer tool)', () => takeSnapshot());
    log('ready - Ctrl+Shift+S saves to', OUT_DIR);
    return { takeSnapshot };
}

module.exports = { id: 'snapshot', name: 'Snapshot tool (dev)', start, takeSnapshot: () => takeSnapshot() };
