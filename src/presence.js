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
 *
 * Profiles (2.18): your status line, About me, banner game and badges. "here" carries a short
 * version of your profile (pv); whoever wants to show it asks "prof?" once per version and you
 * answer "prof". Text is cleaned and capped, a profile only counts if its version is the one that
 * player announced, and anyone can hide yours (or everyone's) on their side.
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
        heard(h, voice, now, pv) {
            const old = m.get(h);
            const v = typeof pv === 'string' && /^[0-9a-f]{8}$/.test(pv) ? pv : '';
            m.set(h, { at: now, voice: !!voice, pv: v });
            if (m.size > 5000) m.delete(m.keys().next().value);
            return !old || old.voice !== !!voice || old.pv !== v || now - old.at > ttl;       // news?
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

// --- profiles (2.18) ---
const BADGES = {
    sets100: { icon: 'trophy', label: '100 sets played', kind: 'sets' }, sets500: { icon: 'trophy', label: '500 sets played', kind: 'sets' },
    sets1000: { icon: 'trophy', label: '1,000 sets played', kind: 'sets' },
    streak5: { icon: 'flame', label: '5-set win streak', kind: 'streak' }, streak10: { icon: 'flame', label: '10-set win streak', kind: 'streak' },
    streak20: { icon: 'flame', label: '20-set win streak', kind: 'streak' },
    top100: { icon: 'star', label: 'Top 100 in a game', kind: 'top' }, top10: { icon: 'star', label: 'Top 10 in a game', kind: 'top' }
};
// N_('100 sets played') N_('500 sets played') N_('1,000 sets played') N_('5-set win streak') N_('10-set win streak') N_('20-set win streak') N_('Top 100 in a game') N_('Top 10 in a game')
// one line of plain text: no control characters, spaces squeezed, capped
function cleanText(t, max) {
    return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanProfile(p) {
    const o = p && typeof p === 'object' ? p : {};
    const bd = Array.isArray(o.bd) ? o.bd.filter((x, i, a) => typeof x === 'string' && BADGES[x] && a.indexOf(x) === i).slice(0, 12) : [];
    return { s: cleanText(o.s, 80), a: cleanText(o.a, 190), b: /^[a-z0-9_]{1,40}$/.test(String(o.b || '')) ? String(o.b) : '', bd };
}
const isEmptyProfile = (p) => !p || (!p.s && !p.a && !p.b && !(p.bd || []).length);
// a short fingerprint of a profile (FNV-1a), so others know when to ask again
function profileVersion(p) {
    const t = JSON.stringify(cleanProfile(p));
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
}
// your badges from your own history (sets in time order) and your best leaderboard spot
function badgesFrom(sets, bestSpot) {
    const out = [];
    const n = (sets || []).length;
    if (n >= 1000) out.push('sets1000'); else if (n >= 500) out.push('sets500'); else if (n >= 100) out.push('sets100');
    let run = 0, best = 0;
    (sets || []).forEach(x => { if (x.result === 'won') { run++; if (run > best) best = run; } else if (x.result === 'lost') run = 0; });
    if (best >= 20) out.push('streak20'); else if (best >= 10) out.push('streak10'); else if (best >= 5) out.push('streak5');
    if (bestSpot && bestSpot <= 10) out.push('top10'); else if (bestSpot && bestSpot <= 100) out.push('top100');
    return out;
}

module.exports = {
    id: 'presence', name: 'Fightcord players',
    start: (f) => start(f),
    hashOf, Book, react, KIND, TOPIC, BADGES, cleanText, cleanProfile, profileVersion, badgesFrom
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
    const msg = named ? { t, h, voice: voiceOn() ? 1 : 0 } : { t };
    const pv = named && t !== 'bye' ? myPv() : '';
    if (pv) msg.pv = pv;
    relays.send(Object.assign(msg, extra));
}
function say(t) { if (cfg.visible) send(t); }

let changeT = 0;
function changed() {
    clearTimeout(changeT);
    changeT = setTimeout(() => fc.emit('presence:changed', {}), 300);
}

function onMsg(m) {
    const now = Date.now();
    if (m && m.t === 'prof?') { answerProfile(m, now); return; }
    if (m && m.t === 'prof') { takeProfile(m, now); return; }
    const what = react(m, myHash());
    if (what === 'record' || what === 'record+reply') {
        if (book.heard(m.h, m.voice, now, m.pv)) changed();
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

/* ------------------------------------------------------------- profiles (2.18) */

const profiles = new Map();              // hash -> { pv, p }
const asked = new Map();                 // hash -> { pv, at }: what we last asked for, when
let lastAnswer = { pv: '', at: 0 }, badgeCache = { at: 0, list: [] };

function myBadges() {
    if (Date.now() - badgeCache.at < 10 * 60000) return badgeCache.list;
    let spot = 0;
    try {
        const me = lc(fc.app.me());
        const roms = new Set(fc.history.all().map(x => x.rom).filter(Boolean));
        roms.forEach(rom => { const b = fc.api.cachedBoard(rom); const e = b && b.get(me); if (e && e.pos && (!spot || e.pos < spot)) spot = e.pos; });
    } catch (e) { /* no boards yet */ }
    badgeCache = { at: Date.now(), list: badgesFrom(fc.history.all(), spot) };
    return badgeCache.list;
}
// what you share (badges included): cleaned the same way everyone else's is
function myProfile() { return cleanProfile(Object.assign({}, cfg.profile, { bd: cfg.showBadges === false ? [] : myBadges() })); }
function myPv() { if (!cfg || !cfg.shareProfile) return ''; const p = myProfile(); return isEmptyProfile(p) ? '' : profileVersion(p); }

function answerProfile(m, now) {
    if (!cfg.visible || !cfg.shareProfile || !HASH.test(String(m.q || '')) || m.q !== myHash()) return;
    // answers to the same version at most every 4 s (a new version always goes out)
    const pv = myPv();
    if (pv === lastAnswer.pv && now - lastAnswer.at < 4000) return;
    lastAnswer = { pv, at: now };
    send('prof', { p: myProfile() });
}
function takeProfile(m, now) {
    if (!HASH.test(String(m.h || '')) || m.h === myHash()) return;
    const e = book.get(m.h, now);
    // only the version that player announced (someone else answering for them doesn't count)
    if (!e || !e.pv || m.pv !== e.pv) return;
    const p = cleanProfile(m.p);
    if (profileVersion(p) !== e.pv) return;
    profiles.set(m.h, { pv: e.pv, p });
    if (profiles.size > 2000) profiles.delete(profiles.keys().next().value);
    changed();
    fc.emit('presence:profile', { h: m.h });
}

const isHidden = (name) => (cfg.hiddenProfiles || []).indexOf(lc(name)) >= 0;
// someone's profile: null until it's known (asking for it the first time), or when hidden
function profile(name) {
    if (!name || !cfg) return null;
    if (fc.app.isMe(name)) { const p = myProfile(); return isEmptyProfile(p) ? null : p; }
    if (!cfg.showProfiles || isHidden(name)) return null;
    const h = hashOf(name), now = Date.now();
    const e = book.get(h, now);
    if (!e || !e.pv) return null;
    const c = profiles.get(h);
    if (c && c.pv === e.pv) return c.p;
    // a new version: ask now; the same one again: not more than every 30 s
    const last = asked.get(h);
    if (relays && (!last || last.pv !== e.pv || now - last.at > 30000)) { asked.set(h, { pv: e.pv, at: now }); send('prof?', { q: h }); }
    return null;
}

function bannerFor(name) {
    const p = profile(name);
    return p && p.b ? `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.45)),url(&quot;${E(fc.data.artUrl(p.b, 'https://web.fightcade.com/'))}&quot;) center 30%/cover` : '';
}
function badgesHtml(p, mine) {
    if (!p || !(p.bd || []).length) return '';
    const tip = mine ? '' : ' · ' + T('from their Fightcord');
    return `<div class="fcBadges">${p.bd.map(id => `<span class="fcBadge ${BADGES[id].kind}" title="${E(T(BADGES[id].label) + tip)}">${fc.ui.ic(BADGES[id].icon, BADGES[id].kind === 'sets' ? '' : 'fill')}<span>${E(T(BADGES[id].label))}</span></span>`).join('')}</div>`;
}
// the status line, About me and badges for a card (opts.about: show About me)
function profileHtml(name, opts) {
    const p = profile(name);
    if (!p) return '';
    const o = opts || {};
    return `<div class="fcProf">${p.s ? `<div class="fcProfS">${fc.ui.ic('chat')}<span>${E(p.s)}</span></div>` : ''}` +
        (o.about !== false && p.a ? `<div class="fcProfA"><b>${E(T('About me'))}</b>${E(p.a)}</div>` : '') + badgesHtml(p, fc.app.isMe(name)) + '</div>';
}
function setProfile(p) {
    const c = cleanProfile(p);
    cfg.profile = { s: c.s, a: c.a, b: c.b };
    store.save();
    if (said) say('here');                // the new version goes out now
    changed();
    fc.emit('presence:profile', { me: true });
}
function hideProfile(name, on) {
    const k = lc(name);
    cfg.hiddenProfiles = (cfg.hiddenProfiles || []).filter(x => x !== k);
    if (on) cfg.hiddenProfiles.push(k);
    store.save();
    changed();
    fc.emit('presence:profile', { hidden: k });
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
.fcProf { margin-top: 8px; }
.fcProfS { display: flex; align-items: flex-start; padding: 6px 9px; border-radius: var(--fc-r2); background: var(--fc-s2); font: 13px/1.35 var(--fc-font); color: var(--fc-text); }
.fcProfS > .fc-ic { flex: none; width: 13px; height: 13px; margin: 2px 7px 0 0; color: var(--fc-muted); }
.fcProfS > span { min-width: 0; word-wrap: break-word; }
.fcProfA { margin-top: 8px; font: 12.5px/1.45 var(--fc-font); color: var(--fc-text); word-wrap: break-word; }
.fcProfA > b { display: block; margin-bottom: 2px; font: 700 11px/14px var(--fc-font); letter-spacing: .03em; text-transform: uppercase; color: var(--fc-muted); }
.fcBadges { display: flex; flex-wrap: wrap; margin: 8px -4px 0 0; }
.fcBadge { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; margin: 0 4px 4px 0; border-radius: 10px; background: var(--fc-s2);
    font: 600 11px/20px var(--fc-font); color: var(--fc-text); cursor: default; }
.fcBadge .fc-ic { width: 12px; height: 12px; margin-right: 4px; }
.fcBadge.sets .fc-ic { color: var(--fc-accent); }
.fcBadge.streak .fc-ic { color: #ff8a3d; }
.fcBadge.top .fc-ic { color: var(--fc-warning); }
`;

function start(f) {
    fc = f;
    store = fc.config('presence', { visible: true, shareProfile: true, showProfiles: true, showBadges: true, profile: { s: '', a: '', b: '' }, hiddenProfiles: [] });
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
            { key: 'shareProfile', type: 'switch', label: 'Share my profile', hint: 'Your status, About me, banner and badges, for Fightcord players (set them from your avatar, bottom-left)',
                show: (d) => d.visible, onChange: () => { if (said) say('here'); changed(); } },
            { key: 'showBadges', type: 'switch', label: 'Show my badges', hint: 'Sets played, win streaks and leaderboard spots, from your own history', show: (d) => d.visible && d.shareProfile,
                onChange: () => { badgeCache.at = 0; if (said) say('here'); changed(); } },
            { key: 'showProfiles', type: 'switch', label: 'Show other players’ profiles', hint: 'Their status and badges on hover and scout cards' },
            { type: 'note', label: 'Fightcord players find each other through the same free public relays as voice chat. Your name is sent hashed, and nothing is stored, but anyone listening who knows your name could tell you use Fightcord. A profile you share can be read by any Fightcord player.' }
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
    profile: (n) => profile(n),
    profileHtml: (n, o) => profileHtml(n, o),
    badgesHtml: (p, mine) => badgesHtml(p, mine),
    bannerFor: (n) => bannerFor(n),
    myProfile: () => myProfile(),
    rawProfile: () => Object.assign({ s: '', a: '', b: '' }, cfg && cfg.profile),
    setProfile: (p) => setProfile(p),
    hideProfile: (n, on) => hideProfile(n, on),
    isHidden: (n) => !!cfg && isHidden(n),
    sharing: () => !!(cfg && cfg.visible && cfg.shareProfile),
    // the dev harness: pretend someone shared a profile
    _profile(name, p) { const c = cleanProfile(p), h = hashOf(name), pv = profileVersion(c); book.heard(h, false, Date.now(), pv); profiles.set(h, { pv, p: c }); changed(); },
    count: () => book.count(Date.now()),
    // the dev harness: pretend we heard from someone
    _heard(name, voice) { if (book.heard(hashOf(name), voice, Date.now())) changed(); },
    _connected: () => (relays ? relays.open() : 0),
    _pvOf: (n) => { const e = book.get(hashOf(n), Date.now()); return e ? e.pv : null; },
    _myPv: () => myPv()
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
