/**
 * Fightcord players -- who else in the lobby has Fightcord (and voice chat on)
 *
 * Every Fightcord says "here" on the same free public relays voice chat uses (nostr, ephemeral
 * events: forwarded live, never stored), every few minutes. Starting up it says "hi", and the
 * others answer, so the list fills in seconds. Names travel hashed, never in plain text.
 * Other modules ask info(name) / mark(name); voice chat asks check(name) before a set.
 *
 * Visible by default; Settings -> Voice chat -> "Show that I use Fightcord" turns it off
 * (you still see others). Voice chat needs it on, so your opponent can find you.
 */
'use strict';

const path = require('path');
const crypto = (() => { try { return require('crypto'); } catch (e) { return null; } })();

let fc = null;
let store = null, cfg = null;            // presence-config.json
let V = null;                            // voice.js (the signer + relays)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const E = (s) => fc.fmt.esc(s);
const lc = (s) => String(s || '').toLowerCase();

const KIND = 25051;                      // ephemeral, like voice chat's 25050
const TOPIC = 'fightcord-presence-v1';
const BEAT = 4 * 60000;                  // say "here" this often
const TTL = 10 * 60000;                  // gone if not heard for this long
const HASH = /^[0-9a-f]{32}$/;

/* ================================================================ pure parts */

const hashes = new Map();
function hashOf(name) {
    const k = lc(name);
    let h = hashes.get(k);
    // (no crypto = the dev harness, which never goes online)
    if (!h) { h = crypto ? crypto.createHash('sha256').update(TOPIC + '|' + k).digest('hex').slice(0, 32) : 'demo|' + k; hashes.set(k, h); }
    return h;
}

// the people heard from: hash -> { at, voice }
function Book(ttl) {
    const m = new Map();
    return {
        heard(h, voice, now) {
            const old = m.get(h);
            m.set(h, { at: now, voice: !!voice });
            if (m.size > 5000) m.delete(m.keys().next().value);
            return !old || old.voice !== !!voice || now - old.at > ttl;       // news?
        },
        gone(h) { return m.delete(h); },
        get(h, now) { const e = m.get(h); return e && now - e.at <= ttl ? e : null; },
        count(now) { let n = 0; m.forEach(e => { if (now - e.at <= ttl) n++; }); return n; }
    };
}

// what to do with a message: 'record' | 'record+reply' | 'forget' | 'reply' | 'reply-soon' | ''
//   hi = "I'm here, who else is?"; all = the same from someone hidden (no name); who = "is <hash> here?"
function react(msg, mine) {
    if (!msg || typeof msg !== 'object') return '';
    if (msg.t === 'who') return mine && msg.q === mine ? 'reply' : '';
    if (msg.t === 'all') return 'reply-soon';
    if (!HASH.test(String(msg.h || '')) || msg.h === mine) return '';
    if (msg.t === 'here') return 'record';
    if (msg.t === 'hi') return 'record+reply';
    if (msg.t === 'bye') return 'forget';
    return '';
}

module.exports = {
    id: 'presence', name: 'Fightcord players',
    start: (f) => start(f),
    hashOf, Book, react, KIND, TOPIC
};

/* ================================================================== browser */

let relays = null;
const book = Book(TTL);
let lastSent = 0, timers = [], said = false;
const waiting = [];                      // { h, done, timer }

const myHash = () => { const m = fc.app.me(); return m ? hashOf(m) : ''; };
function voiceOn() { const v = fc.modules.get('voice'); return !!(v && v.enabled && v.enabled()); }

// hidden: questions only, without our name
function send(t, extra) {
    if (!relays) return;
    const named = cfg.visible || t === 'bye';
    const h = named ? myHash() : '';
    if (named && !h) return;
    if (named) lastSent = Date.now();
    relays.send(Object.assign(named ? { t, h, voice: voiceOn() ? 1 : 0 } : { t }, extra));
}
function say(t) { if (cfg.visible) send(t); }

let changeT = 0;
function changed() {
    clearTimeout(changeT);
    changeT = setTimeout(() => fc.emit('presence:changed', {}), 300);
}

function onMsg(m) {
    const what = react(m, myHash());
    const now = Date.now();
    if (what === 'record' || what === 'record+reply') {
        if (book.heard(m.h, m.voice, now)) changed();
        for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].h === m.h) { const w = waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.done({ voice: !!m.voice }); }
    }
    if (what === 'forget' && book.gone(m.h)) changed();
    // answer a newcomer (spread out, and not if we just spoke) / a direct question (right away)
    if ((what === 'record+reply' || what === 'reply-soon') && cfg.visible && now - lastSent > 20000) timers.push(setTimeout(() => say('here'), 300 + Math.random() * 4000));
    if (what === 'reply' && cfg.visible && now - lastSent > 3000) say('here');
}

// first contact once we know who we are, then a heartbeat
function boot() {
    if (said || !relays) return;
    if (!fc.app.me()) { timers.push(setTimeout(boot, 3000)); return; }
    said = true;
    send(cfg.visible ? 'hi' : 'all');
    timers.push(setInterval(() => say('here'), BEAT + Math.round(Math.random() * 30000)));
}

function connect() {
    if (relays || !crypto || !V || !V.Relays) return;
    const key = crypto.createHash('sha256').update(TOPIC + '|key').digest();
    relays = V.Relays(TOPIC, () => [key], crypto.randomBytes(32), onMsg, null, { kind: KIND, reconnect: true, replay: 1 });
    timers.push(setTimeout(boot, 1500));
}
function disconnect() {
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    timers = [];
    if (relays) { say('bye'); const r = relays; setTimeout(() => r.close(), 400); }
    relays = null;
    said = false;
}

/* ---------------------------------------------------------------- the API */

// null = not seen (no Fightcord, or hidden); { voice } otherwise
function info(name) {
    if (!name) return null;
    if (fc.app.isMe(name)) return cfg.visible ? { voice: voiceOn() } : null;
    const e = book.get(hashOf(name), Date.now());
    return e ? { voice: e.voice } : null;
}

// ask one player directly (a set is starting and they're not in the book yet)
function check(name, ms) {
    const known = info(name);
    if (known || !relays || !crypto) return Promise.resolve(known);
    const h = hashOf(name);
    return new Promise(done => {
        const w = { h, done, timer: setTimeout(() => { const i = waiting.indexOf(w); if (i >= 0) waiting.splice(i, 1); done(null); }, ms || 4000) };
        waiting.push(w);
        send('who', { q: h });
    });
}

function mark(name, big) {
    const i = info(name);
    if (!i) return '';
    const tip = i.voice ? T('Uses Fightcord · voice chat on') : T('Uses Fightcord');
    return `<span class="fcPres${i.voice ? ' v' : ''}${big ? ' big' : ''}" title="${E(tip)}"><b>F</b>${i.voice ? fc.ui.ic('mic') : ''}</span>`;
}
function line(name) {
    const i = info(name);
    if (!i) return '';
    return `<div class="fcPresLine">${mark(name)}<span>${E(i.voice ? T('Uses Fightcord · voice chat on') : T('Uses Fightcord'))}</span></div>`;
}

const CSS = `
.fcPres { display: inline-flex; align-items: center; height: 15px; padding: 0 4px; margin: 0 0 0 5px; border-radius: 4px; vertical-align: middle;
    background: var(--fc-accent); color: #fff; font: 800 9.5px/1 var(--fc-font); letter-spacing: 0; text-transform: none; flex: none; cursor: default; }
.fcPres > b { font-weight: 800; }
.fcPres > b + .fc-ic { margin-left: 2px; }
.fcPres .fc-ic { width: 10px; height: 11px; stroke-width: 3; }
.fcPres.v { background: var(--fc-success); }
.fcPres.big { height: 18px; padding: 0 5px; font-size: 11.5px; border-radius: 5px; }
.fcPres.big .fc-ic { width: 12px; height: 13px; }
.fcPresLine { display: flex; align-items: center; margin-top: 6px; font-size: 12px; color: var(--fc-muted); }
.fcPresLine .fcPres { margin: 0 6px 0 0; }
`;

function start(f) {
    fc = f;
    store = fc.config('presence', { visible: true });
    cfg = store.data;
    try { V = require(path.join(__dirname, 'voice.js')); } catch (e) { V = null; }
    fc.ui.style('fcPresStyle', CSS);
    fc.own(() => { disconnect(); fc.ui.style('fcPresStyle', null); });
    fc.on('voice:changed', () => { if (said) say('here'); changed(); });
    if (typeof window !== 'undefined') {
        const bye = () => { if (relays && cfg.visible) send('bye'); };
        window.addEventListener('beforeunload', bye);
        fc.own(() => window.removeEventListener('beforeunload', bye));
    }
    fc.settings.section('voice', 'Voice chat', 'mic', 75);       // shared with voice.js
    fc.settings.block({
        id: 'presence', section: 'voice', title: 'Fightcord players', hint: '— see who else has Fightcord', store, order: 5,
        fields: [
            { key: 'visible', type: 'switch', label: 'Show that I use Fightcord',
                hint: 'Others with Fightcord see an F next to your name. Voice chat needs this on.',
                onChange: (v) => { if (v) send('hi'); else send('bye'); changed(); } },
            { type: 'note', label: 'Fightcord players find each other through the same free public relays as voice chat. Your name is sent hashed, and nothing is stored, but anyone listening who knows your name could tell you use Fightcord.' }
        ]
    });
    if (crypto) connect();
    return api;
}

const api = {
    info: (n) => info(n),
    check: (n, ms) => check(n, ms),
    mark: (n, big) => mark(n, big),
    line: (n) => line(n),
    visible: () => !!(cfg && cfg.visible),
    count: () => book.count(Date.now()),
    // the dev harness: pretend we heard from someone
    _heard(name, voice) { if (book.heard(hashOf(name), voice, Date.now())) changed(); },
    _connected: () => (relays ? relays.open() : 0)
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
