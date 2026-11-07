/**
 * Fightcord player count -- how many people have Fightcord, in total and this month
 *
 * Presence (presence.js) only knows who is online right now: its events are never stored. So every
 * few days each Fightcord also leaves one small stored mark on a few free public relays (nostr,
 * kind 30551, replaceable: a relay keeps only the newest one per key). The mark carries nothing but
 * a key made for this alone (from your Fightcord ID secret when there is one, so linked PCs count
 * once; it can't be tied to your ID or your name) and the time. Counting = the different keys seen.
 *
 * Each mark costs a little proof of work (16 bits, a fraction of a second once every few days), so
 * puffing the number up takes real effort. Marks are read without checking signatures (the relays
 * already did, and 300 checks would take seconds); the id and the work are checked.
 *
 * Settings -> Voice chat -> Fightcord player count: "Count me". Off, or "Show that I use Fightcord"
 * off, and nothing is sent (you still see the number).
 */
'use strict';

const path = require('path');
const crypto = (() => { try { return require('crypto'); } catch (e) { return null; } })();

let fc = null;
let store = null, cfg = null;            // headcount-config.json
let V = null;                            // voice.js (the signer)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const E = (s) => fc.fmt.esc(s);

const KIND = 30551;                      // parameterized replaceable (30000-39999)
const D = 'fightcord-count-v1';
const POW = 16;                          // leading zero bits of the id
const SINCE = 1793491200;                // 2026-11-01: no mark is older than this feature
const RELAYS = ['wss://relay.primal.net', 'wss://nostr.mom', 'wss://offchain.pub', 'wss://nos.lol', 'wss://relay.damus.io'];
const EVERY = 3 * 86400000;              // leave a fresh mark this often
const FRESH = 30 * 60000;                // the number is good for this long
const MONTH = 30 * 86400;                // seconds
const PAGE = 500, PAGES = 20, WAIT = 15000;

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const TOPIC = crypto ? sha(D).toString('hex') : '';

/* ================================================================ pure parts */

// leading zero bits of a hex id
function bitsOf(hex) {
    let n = 0;
    for (let i = 0; i < hex.length; i++) {
        const v = parseInt(hex[i], 16);
        if (v) return n + (Math.clz32(v) - 28);
        n += 4;
    }
    return n;
}
const idOf = (ev) => sha(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])).toString('hex');
const tag = (ev, k) => { const t = (ev.tags || []).find(x => Array.isArray(x) && x[0] === k); return t || null; };

// a mark worth counting: the right kind, d and topic, a real id with the work done, a sane time
function validMark(ev, nowSec) {
    try {
        if (!ev || ev.kind !== KIND || typeof ev.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(ev.pubkey) || typeof ev.id !== 'string') return false;
        if (!Number.isInteger(ev.created_at) || ev.created_at < SINCE || ev.created_at > nowSec + 600) return false;
        const d = tag(ev, 'd'), t = tag(ev, 't'), nonce = tag(ev, 'nonce');
        if (!d || d[1] !== D || !t || t[1] !== TOPIC || !nonce || +nonce[2] < POW) return false;
        if (bitsOf(ev.id) < POW) return false;
        return idOf(ev) === ev.id;
    } catch (e) { return false; }
}

// the marks (any number of copies from any number of relays) -> { total, month }
function tally(marks, nowSec, mine) {
    const newest = new Map();
    marks.forEach(ev => { const at = newest.get(ev.pubkey); if (!at || ev.created_at > at) newest.set(ev.pubkey, ev.created_at); });
    if (mine && mine.pk) { const at = newest.get(mine.pk); if (!at || mine.at > at) newest.set(mine.pk, mine.at); }
    let month = 0;
    newest.forEach(at => { if (nowSec - at <= MONTH) month++; });
    return { total: newest.size, month };
}

// time for a fresh mark?
const due = (c, now) => !c.pubAt || now - c.pubAt > EVERY || c.pubAt > now + 60000;

// the mark itself: the work is done in slices so Fightcade never stalls
async function makeMark(sk, at, pow) {
    const pk = V.pubkey(sk).toString('hex');
    const base = crypto.randomBytes(4).readUInt32BE(0);
    for (let i = 0; ; i++) {
        const tags = [['d', D], ['t', TOPIC], ['nonce', String(base + i), String(pow)]];
        const ev = { pubkey: pk, created_at: at, kind: KIND, tags, content: '' };
        const id = idOf(ev);
        if (bitsOf(id) >= pow) return Object.assign({ id, sig: V.sign(Buffer.from(id, 'hex'), sk, crypto.randomBytes(32)).toString('hex') }, ev);
        if (i % 4096 === 4095) await new Promise(r => setTimeout(r, 0));
    }
}

/* ================================================================ the relays */

// one relay: send the mark (if any), then read every mark, paging back with `until`
function readRelay(url, W, mark, nowSec, wait) {
    return new Promise((resolve) => {
        const got = new Map();
        let ws, pages = 0, fresh = 0, oldest = 0, finished = false, sub = '';
        const finish = (ok) => {
            if (finished) return;
            finished = true; clearTimeout(timer);
            try { if (sub && ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', sub])); ws.close(); } catch (e) { /* gone */ }
            resolve({ url, ok, marks: Array.from(got.values()) });
        };
        const timer = setTimeout(() => finish(got.size > 0), wait || WAIT);
        const ask = () => {
            sub = 'fchc' + (++pages);
            fresh = 0;
            const f = { kinds: [KIND], '#t': [TOPIC], limit: PAGE };
            if (oldest) f.until = oldest;
            ws.send(JSON.stringify(['REQ', sub, f]));
        };
        try { ws = new W(url); } catch (e) { return finish(false); }
        ws.onopen = () => {
            try {
                if (mark) ws.send(JSON.stringify(['EVENT', mark]));
                ask();
            } catch (e) { finish(false); }
        };
        ws.onmessage = (m) => {
            let d;
            try { d = JSON.parse(m.data); } catch (e) { return; }
            if (d[1] !== sub) return;
            if (d[0] === 'EVENT') {
                const ev = d[2];
                if (ev && typeof ev.id === 'string' && !got.has(ev.id) && validMark(ev, nowSec)) {
                    got.set(ev.id, ev); fresh++;
                    if (!oldest || ev.created_at < oldest) oldest = ev.created_at;
                }
            } else if (d[0] === 'EOSE') {
                // a page with something new on it: there may be older ones (relays cap `limit` their own way)
                if (fresh && pages < PAGES) { try { ws.send(JSON.stringify(['CLOSE', sub])); ask(); } catch (e) { finish(true); } }
                else finish(true);
            } else if (d[0] === 'CLOSED') finish(got.size > 0);
        };
        ws.onerror = () => {};
        ws.onclose = () => finish(got.size > 0);
    });
}

// every relay at once; a mark seen on any of them counts
async function count(o) {
    const W = o.WS, nowSec = Math.floor(o.now / 1000);
    const res = await Promise.all((o.relays || RELAYS).map(url => readRelay(url, W, o.mark, nowSec, o.wait)));
    const marks = [].concat.apply([], res.map(r => r.marks));
    return Object.assign(tally(marks, nowSec, o.mine), { relays: res.filter(r => r.ok).length });
}

/* ================================================================ the module */

let busy = null;

function presence() { return fc.modules.get('presence'); }
function sharing() { const p = presence(); return !!(cfg.countMe && p && p.visible && p.visible()); }

// the key that counts as you: from your Fightcord ID secret (so linked PCs are one person), else our own
function myKey() {
    const L = fc.modules.get('lobbies');
    const k = L && L.countKey ? L.countKey() : null;
    if (k) return k;
    if (!/^[0-9a-f]{64}$/.test(cfg.sk || '')) { cfg.sk = crypto.randomBytes(32).toString('hex'); store.save(); }
    const sk = Buffer.from(cfg.sk, 'hex');
    return sk[0] === 0xff ? sha(cfg.sk) : sk;
}

function stats() {
    const p = presence();
    const online = (p && p.count ? p.count() : 0) + (p && p.visible && p.visible() ? 1 : 0);
    return { total: cfg.total || 0, month: cfg.month || 0, online, at: cfg.at || 0, busy: !!busy };
}

function refresh(force) {
    if (busy) return busy;
    if (!crypto || !V || typeof WebSocket === 'undefined') return Promise.resolve(stats());
    const now = Date.now();
    if (!force && cfg.at && now - cfg.at < FRESH && !(sharing() && due(cfg, now))) return Promise.resolve(stats());
    busy = (async () => {
        let mark = null, mine = null;
        if (sharing()) {
            const sk = myKey(), at = Math.floor(now / 1000);
            mine = { pk: V.pubkey(sk).toString('hex'), at };
            if (due(cfg, now)) mark = await makeMark(sk, at, POW);
        }
        const r = await count({ WS: WebSocket, now, mark, mine });
        if (!r.relays) return;                          // offline: keep the last number
        if (mark) cfg.pubAt = now;
        // fewer relays answered than last time: don't let the number drop because one was slow
        const short = r.relays < (cfg.relays || 0) && now - cfg.at < 86400000;
        cfg.total = short ? Math.max(r.total, cfg.total || 0) : r.total;
        cfg.month = short ? Math.max(r.month, cfg.month || 0) : r.month;
        cfg.at = now; cfg.relays = r.relays;
        store.save();
    })().catch(e => fc.log('headcount: ' + (e && e.message))).then(() => { busy = null; fc.emit('headcount:changed', stats()); return stats(); });
    fc.emit('headcount:changed', stats());
    return busy;
}

// the three numbers, for the My Fightcord page
function tilesHtml() {
    const s = stats(), n = (x) => (x ? x.toLocaleString(fc.t.locale()) : '…');
    const when = s.busy ? T('Counting…') : s.at ? T('Updated {when}', { when: new Date(s.at).toLocaleTimeString(fc.t.locale(), { hour: '2-digit', minute: '2-digit' }) }) : T('Not counted yet');
    return `<div class="fchcTiles">${fc.ui.tile(n(s.total), 'Have Fightcord')}${fc.ui.tile(n(s.month), 'This month')}${fc.ui.tile(n(s.online), 'Online now')}</div>` +
        `<div class="fchcNote">${E(when)} · ${E(T('Counted from anonymous marks on public relays'))}</div>`;
}

function start(f) {
    fc = f;
    store = fc.config('headcount', { countMe: true, total: 0, month: 0, at: 0, pubAt: 0, relays: 0 });
    cfg = store.data;
    try { V = require(path.join(__dirname, 'voice.js')); } catch (e) { V = null; }
    fc.settings.section('voice', 'Voice chat', 'mic', 75);
    fc.settings.block({
        id: 'headcount', section: 'voice', title: 'Fightcord player count', hint: '— how many people have Fightcord', store, order: 6,
        fields: [
            { key: 'countMe', type: 'switch', label: 'Count me', hint: 'Every few days, an anonymous mark on public relays: a random key and the time, no name. Needs “Show that I use Fightcord”.' },
            { type: 'note', label: 'Fightcord counts the different marks it finds. Someone who uses Fightcord on two linked PCs counts once.' }
        ]
    });
    fc.cmd('players', 'How many people have Fightcord', async () => {
        const s = await refresh(true);
        fc.ui.toast(fc.t.plural(s.total, '{n} person has Fightcord', '{n} people have Fightcord'),
            { icon: 'users', sub: T('{month} this month · {online} online now', { month: s.month, online: s.online }) });
    });
    // a little after start-up (the ID secret and presence are ready by then), then now and then
    const t = setTimeout(() => refresh(), 25000 + Math.random() * 20000);
    fc.own(() => clearTimeout(t));
    fc.tick(() => refresh(), 3600000);
    return api;
}

const api = {
    stats: () => stats(),
    refresh: (force) => refresh(force),
    tilesHtml: () => tilesHtml(),
    // the dev harness: made-up numbers (it has no relays)
    _demo(o) { Object.assign(cfg, { total: o.total || 0, month: o.month || 0, at: o.at || Date.now() }); fc.emit('headcount:changed', stats()); }
};

module.exports = {
    id: 'headcount', name: 'Fightcord player count',
    start: (f) => start(f),
    // pure parts, for the tests
    bitsOf, validMark, tally, due, makeMark: (sk, at, pow) => { if (!V) V = require(path.join(__dirname, 'voice.js')); return makeMark(sk, at, pow); },
    readRelay, count, KIND, D, TOPIC, POW, SINCE, RELAYS
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
