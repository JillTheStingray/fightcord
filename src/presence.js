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

// --- newcomers (2.19) ---
// A fresh install says "I'm new" (nw = its day 1..7) for its first week: Fightcord players in its
// channel get a welcome line in their chat (days 1-3, once each), and its cards show a badge.
const DAY = 86400000, NEW_DAYS = 7, ANNOUNCE_DAYS = 3, ANNOUNCE_PER_HOUR = 3;
// days since a fresh install: 1..7 in the first week, else 0 (0 also = not a fresh install)
function newcomerDay(installedAt, now) {
    if (!installedAt || !(now >= installedAt)) return 0;
    const d = Math.floor((now - installedAt) / DAY) + 1;
    return d <= NEW_DAYS ? d : 0;
}
const validNw = (nw) => { const n = Math.floor(+nw); return n >= 1 && n <= NEW_DAYS ? n : 0; };
// a newcomer heard from -> 'announce' | 'wait' (not in the channel you're looking at, or enough for
// this hour) | 'skip' (announced already, or past their first days)
//   state: { announced: { hash: when }, recent: [when, ...] }   o: { h, nw, now, inChannel }
function announceDecision(state, o) {
    const nw = validNw(o && o.nw);
    if (!nw || nw > ANNOUNCE_DAYS || !o.h || (state.announced || {})[o.h]) return 'skip';
    if (!o.inChannel) return 'wait';
    const recent = (state.recent || []).filter(t => o.now - t < 3600000);
    return recent.length >= ANNOUNCE_PER_HOUR ? 'wait' : 'announce';
}

// a win streak worth showing: 3..999 sets in a row, else 0
const validWs = (n) => (Number.isInteger(n) && n >= 3 && n <= 999 ? n : 0);
// the people heard from: hash -> { at, voice, pv, nw, dk, lv }
function Book(ttl) {
    const m = new Map();
    const ver = (x) => (typeof x === 'string' && /^[0-9a-f]{8}$/.test(x) ? x : '');
    return {
        // dk (3.6): their Fightcord ID, for friend requests and DMs; lv (3.7): their looks' version;
        // xv (3.9): their name style and decoration's version; mc (3.9): their in-game chat is muted;
        // mv (3.9.1): their mains' version; ws (3.10): their win streak tonight (3+, else 0)
        heard(h, voice, now, pv, nw, dk, lv, xv, mc, mv, ws) {
            const old = m.get(h);
            const v = ver(pv), l = ver(lv), x = ver(xv), mn = ver(mv), st = validWs(ws);
            const d = typeof dk === 'string' && /^[0-9a-f]{64}$/.test(dk) ? dk : '';
            m.set(h, { at: now, voice: !!voice, pv: v, nw: validNw(nw), dk: d, lv: l, xv: x, mc: mc === 1, mv: mn, ws: st });
            if (m.size > 5000) m.delete(m.keys().next().value);
            return !old || old.voice !== !!voice || old.pv !== v || old.dk !== d || old.lv !== l || old.xv !== x || old.mc !== (mc === 1) || old.mv !== mn || old.ws !== st || now - old.at > ttl;       // news?
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
// a short fingerprint (FNV-1a), so others know when to ask again
function fnv(t) {
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
}
// (the text part only: 3.6 and older check this one, and they don't know the looks)
const profileVersion = (p) => fnv(JSON.stringify(cleanProfile(p)));

// --- looks (3.7): your own avatar and banner, two theme colours, an avatar frame, pronouns ---
// "here" carries lv, the version of all of it; the answer is signed with your Fightcord ID, and a
// name's pictures only count from the ID pinned to it (a friend's, else the first one seen)
const FRAMES = ['flame', 'neon', 'gold', 'sakura', 'frost', 'bolt', 'pixel', 'hearts', 'shadow', 'rainbow'];
// where pictures may live: the Blossom servers uploads.js uses, and catbox (never uguu: it deletes them)
const PIC_HOSTS = ['blossom.primal.net', 'nostr.download', 'cdn.nostrcheck.me', 'blossom.yakihonne.com', 'blossom.band', 'files.catbox.moe'];
function picUrl(u) {
    const t = String(u || '');
    // (the dev harness: its made-up players' pictures are local files)
    if (typeof window !== 'undefined' && window.__fcLocalPics && /^http:\/\/localhost:\d+\/[^\s"'<>()\\]+$/.test(t)) return t;
    if (t.length > 300 || !/^https:\/\/[^\s"'<>()\\]+$/.test(t)) return '';
    let host = '';
    try { host = new URL(t).hostname; } catch (e) { return ''; }
    return PIC_HOSTS.some(x => host === x || host.endsWith('.' + x)) ? t : '';
}
// { u, s }: the picture, and a still one when u moves (a GIF)
function cleanPic(x) {
    if (!x || typeof x !== 'object') return null;
    const u = picUrl(x.u);
    if (!u) return null;
    const s = picUrl(x.s);
    return s && s !== u ? { u, s } : { u };
}
function cleanLook(p) {
    const o = p && typeof p === 'object' ? p : {}, out = {};
    const av = cleanPic(o.av), bn = cleanPic(o.bn), pn = cleanText(o.pn, 40);
    if (av) out.av = av;
    if (bn) out.bn = bn;
    if (Array.isArray(o.th) && o.th.length === 2 && o.th.every(c => /^#[0-9a-f]{6}$/i.test(String(c)))) out.th = o.th.map(c => String(c).toLowerCase());
    if (FRAMES.indexOf(o.fr) >= 0) out.fr = o.fr;
    if (pn) out.pn = pn;
    return out;
}
const cleanFull = (p) => Object.assign(cleanProfile(p), cleanLook(p));
const hasLook = (p) => !!p && !!(p.av || p.bn || p.th || p.fr || p.pn);
const lookVersion = (p) => fnv('look|' + JSON.stringify(cleanFull(p)));
const lookMsg = (h, lv) => 'fightcord-look-v1|' + h + '|' + lv;

// --- 3.9: a name style and an avatar decoration ("extras") ---
// 3.7 / 3.8 work the looks' version out of the fields they know, so these stay out of it (lv): they
// have their own version (xv) and signature, and older Fightcords still show your pictures
const NAME_STYLES = ['gradient', 'neon', 'shimmer', 'toon', 'fire', 'rainbow'];
const NAME_COLOURED = ['gradient', 'neon', 'shimmer', 'toon'];              // (fire and rainbow have their own)
const DECOS = ['crown', 'halo', 'horns', 'catears', 'headphones', 'sparkles', 'snow', 'flames', 'hearts', 'bolts'];
// how bright a colour is, 0..1 (names sit on dark panels: too dark doesn't read)
function lum(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
const NAME_MIN_LUM = 0.12;
const readable = (c) => /^#[0-9a-f]{6}$/i.test(String(c)) && lum(c) >= NAME_MIN_LUM;
function cleanExtras(p) {
    const o = p && typeof p === 'object' ? p : {}, out = {};
    const ns = o.ns && typeof o.ns === 'object' ? o.ns : null;
    if (ns && NAME_STYLES.indexOf(ns.s) >= 0) {
        if (NAME_COLOURED.indexOf(ns.s) < 0) out.ns = { s: ns.s };
        else if (Array.isArray(ns.c) && ns.c.length === 2 && ns.c.every(readable)) out.ns = { s: ns.s, c: ns.c.map(c => String(c).toLowerCase()) };
    }
    if (DECOS.indexOf(o.dc) >= 0) out.dc = o.dc;
    return out;
}
const hasExtras = (p) => { const x = cleanExtras(p); return !!(x.ns || x.dc); };
const extrasVersion = (p) => hasExtras(p) ? fnv('look-x|' + JSON.stringify(cleanExtras(p))) : '';
// --- 3.9.1: your mains, per game ("3s": ["Yun", "Chun-Li"]) ---
// Like the status text they're not signed. Their own version (mv), outside p, so 3.9.0 never sees them.
const MAIN_GAME = /^[a-z0-9_]{1,24}$/;
function cleanMains(o) {
    const out = {};
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    Object.keys(o).filter(k => MAIN_GAME.test(k)).sort().slice(0, 8).forEach(k => {
        const cs = [];
        (Array.isArray(o[k]) ? o[k] : []).forEach(c => { const t = cleanText(c, 24); if (t && cs.indexOf(t) < 0 && cs.length < 3) cs.push(t); });
        if (cs.length) out[k] = cs;
    });
    return out;
}
const mainsVersion = (mn) => { const c = cleanMains(mn); return Object.keys(c).length ? fnv('mains|' + JSON.stringify(c)) : ''; };
const extrasMsg = (h, lv, xv) => 'fightcord-look-x1|' + h + '|' + (lv || '') + '|' + xv;
const PIN_QUIET = 30 * 86400000;
// may this Fightcord ID put pictures on that name? A friend: only the ID you accepted. Anyone else:
// the first ID seen with pictures for that name; another one once that one has been quiet 30 days
// (a new PC). pin = { dk, at } from earlier, friendPk = their friend record's ID ('' = not a friend)
function mayLook(pin, dk, friendPk, now) {
    if (!/^[0-9a-f]{64}$/.test(String(dk || ''))) return false;
    if (friendPk) return friendPk === dk;
    return !pin || pin.dk === dk || now - pin.at > PIN_QUIET;
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
    hashOf, Book, react, validWs, KIND, TOPIC, BADGES, cleanText, cleanProfile, profileVersion, badgesFrom, newcomerDay, announceDecision,
    FRAMES, PIC_HOSTS, picUrl, cleanPic, cleanLook, cleanFull, hasLook, lookVersion, lookMsg, mayLook,
    NAME_STYLES, NAME_COLOURED, DECOS, lum, readable, cleanExtras, hasExtras, extrasVersion, extrasMsg, cleanMains, mainsVersion
};

/* ================================================================== browser */

let relays = null;
const book = Book(TTL);
let lastSent = 0, timers = [], said = false;
let chatMuted = false;                   // the emulator's Mute chat
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
    const lv = named && t !== 'bye' ? myLv() : '';
    if (lv) msg.lv = lv;
    const xv = named && t !== 'bye' ? myXv() : '';
    if (xv) msg.xv = xv;
    const nw = named && (t === 'hi' || t === 'here') ? myNewDay() : 0;
    if (nw) msg.nw = nw;
    // your Fightcord ID (3.6): other Fightcords can send you a friend request with it
    const dk = named && t !== 'bye' ? myDk() : '';
    if (dk) msg.dk = dk;
    if (named && t !== 'bye' && chatMuted && cfg.shareChatOff !== false) msg.mc = 1;
    const mv = named && t !== 'bye' ? myMv() : '';
    if (mv) msg.mv = mv;
    // 3.10: your win streak tonight (celebrations.js; 0 = none, or you don't share it)
    const cl = named && t !== 'bye' ? fc.modules.get('celebrations') : null;
    const ws = cl && cl.streakNow ? validWs(cl.streakNow()) : 0;
    if (ws) msg.ws = ws;
    relays.send(Object.assign(msg, extra));
}
function myDk() {
    const lb = fc.modules.get('lobbies'), d = fc.modules.get('dms');
    return lb && lb.myId && (!d || !d.enabled || d.enabled()) ? lb.myId() : '';
}
// this install's day 1..7 when it's new and you share that (else 0)
function myNewDay() {
    if (!cfg || !cfg.visible || cfg.shareNew === false) return 0;
    const w = fc.modules.get('welcome');
    return newcomerDay(w && w.installedAt ? w.installedAt() : 0, Date.now());
}
function say(t) { if (cfg.visible) send(t); }

// The emulator saves Mute chat in its own settings; nothing tells us when, so look now and then
function readChatMuted() {
    return (fc.emu ? fc.emu.chatMuted() : Promise.resolve(false)).then(v => {
        if (v !== chatMuted) { chatMuted = v; if (said) say('here'); }
        return v;
    });
}

// Opponents without Fightcord can't get the "here" flag: one line in the lobby, if you turned that on.
// Once per opponent for 6 hours, and never over something you're typing.
const TOLD_MS = 6 * 3600000;
const told = new Map();
async function tellChatOff(opp) {
    if (!opp || cfg.chatOffLine !== true || !(await readChatMuted())) return;
    if (await check(opp, 3000)) return;  // they have Fightcord: their VS screen says it
    const key = String(opp).toLowerCase(), now = Date.now();
    if (now - (told.get(key) || 0) < TOLD_MS) return;
    const input = fc.app.chatInput();
    if (!input || input.value) return;
    told.set(key, now);
    fc.app.setChatText(T('@{name} my in-game chat is off, not ignoring you. GGs here after!', { name: opp }), false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
}

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
        if (book.heard(m.h, m.voice, now, m.pv, m.nw, m.dk, m.lv, m.xv, m.mc, m.mv, m.ws)) changed();
        if (m.dk && /^[0-9a-f]{64}$/.test(m.dk)) fc.emit('presence:id', { h: m.h, dk: m.dk });
        if (m.nw) newcomer(m.h, m.nw);
        for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].h === m.h) { const w = waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.done({ voice: !!m.voice, chatOff: m.mc === 1 }); }
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

/* ---------------------------------------------------------- newcomers (2.19) */

// "X just got Fightcord!" in your chat, once per newcomer, when they're in the channel you're looking at
const pendingNew = new Map();            // hash -> their day (heard, not announced yet)
const announcedRecent = [];              // when the last announcements went out (the hourly cap)
function newcomer(h, nw) {
    if (!cfg.welcomeNew || !validNw(nw) || (cfg.announced || {})[h]) return;
    pendingNew.set(h, validNw(nw));
    if (pendingNew.size > 200) pendingNew.delete(pendingNew.keys().next().value);
    announcePending();
}
// a hash -> the player's name, among the people Fightcade knows of
function nameForHash(h) {
    const users = fc.app.users();
    for (const k of Object.keys(users)) if (hashOf(k) === h) return (users[k] && users[k].name) || k;
    return '';
}
function announcePending() {
    if (!pendingNew.size || !cfg || !cfg.welcomeNew) return;
    const ch = fc.app.activeChannelId(), now = Date.now();
    pendingNew.forEach((nw, h) => {
        const name = nameForHash(h);
        const u = name && fc.app.user(name)[1];
        const inChannel = !!(ch && u && Array.isArray(u.channels) && u.channels.indexOf(ch) >= 0);
        const d = announceDecision({ announced: cfg.announced, recent: announcedRecent }, { h, nw, now, inChannel });
        if (d === 'skip') { pendingNew.delete(h); return; }
        if (d !== 'announce') return;
        pendingNew.delete(h);
        cfg.announced = cfg.announced || {};
        cfg.announced[h] = now;
        Object.keys(cfg.announced).forEach(k => { if (now - cfg.announced[k] > 30 * DAY) delete cfg.announced[k]; });
        store.save();
        announcedRecent.push(now);
        while (announcedRecent.length > 10) announcedRecent.shift();
        welcomeLine(name, ch);
    });
}
// Fightcade's own bot line in that channel's chat (only you see it); a toast if that isn't there
function welcomeLine(name, ch) {
    const text = '🎉 ' + T('{name} just got Fightcord! Say hi 👋', { name });
    const r = fc.app.root();
    const comp = r && typeof r.getChannelComponentById === 'function' ? r.getChannelComponentById(ch) : null;
    const chat = comp && comp.$refs && comp.$refs.chat;
    fc.emit('presence:newcomer', { name, channel: ch });
    if (chat && typeof chat.addBotMessage === 'function') {
        try { chat.addBotMessage(text); welcomeTexts.add(text); setTimeout(tagWelcomes, 60); return; } catch (e) { fc.log('newcomer line failed', e.message); }
    }
    fc.ui.toast(text, { icon: 'rocket' });
}
// Fightcade draws bot lines in muted grey: ours get a little colour (tagged by their text)
const welcomeTexts = new Set();
function tagWelcomes() {
    if (!welcomeTexts.size || typeof document === 'undefined') return;
    document.querySelectorAll('.chatContent .messageWrapper.bot:not(.fcNew)').forEach(w => {
        if (welcomeTexts.has(w.textContent.trim())) w.classList.add('fcNew');
    });
}

/* ------------------------------------------------------------- profiles (2.18) */

// 3.7: profiles you've seen stay (presence-profiles.json), so a card still looks right when that
// player is offline: hash -> { pv, lv, bad, p, at }; pins: hash -> { dk, at } (whose pictures count)
let seenStore = null, seen = { m: {}, pins: {} };
const SEEN_MAX = 1000, SEEN_DAYS = 90;
const asked = new Map();                 // hash -> { v, at }: what we last asked for, when
const anims = new Map();                 // a still picture -> its moving one (GIFs play on hover)
let lastAnswer = { v: '', at: 0 }, badgeCache = { at: 0, list: [] };

function noteAnims(p) { [p && p.av, p && p.bn].forEach(x => { if (x && x.s) { anims.set(x.s, x.u); if (anims.size > 3000) anims.delete(anims.keys().next().value); } }); }
function remember(h, x) {
    seen.m[h] = x;
    noteAnims(x.p);
    const keys = Object.keys(seen.m);
    if (keys.length > SEEN_MAX) keys.sort((a, b) => seen.m[a].at - seen.m[b].at).slice(0, keys.length - SEEN_MAX).forEach(k => delete seen.m[k]);
    if (seenStore) seenStore.save();
}
function pruneSeen(now) {
    Object.keys(seen.m).forEach(k => { const x = seen.m[k]; if (!x || !x.p || now - x.at > SEEN_DAYS * DAY) delete seen.m[k]; else noteAnims(x.p); });
    Object.keys(seen.pins).forEach(k => { if (now - seen.pins[k].at > 365 * DAY) delete seen.pins[k]; });
}
// the friend with that name hash: their accepted ID
function friendPkFor(h) {
    const d = fc.modules.get('dms');
    const f = d && d.friends ? d.friends().find(x => hashOf(x.n) === h) : null;
    return f ? f.pk : '';
}
function signLook(h, lv) {
    const lb = fc.modules.get('lobbies');
    if (!crypto || !lb || !lb.signId) return '';
    return lb.signId(crypto.createHash('sha256').update(lookMsg(h, lv)).digest());
}
function lookSigned(h, lv, dk, sig) {
    if (!crypto || !V || !V.verify || !/^[0-9a-f]{64}$/.test(String(dk || '')) || !/^[0-9a-f]{128}$/.test(String(sig || ''))) return false;
    try { return V.verify(crypto.createHash('sha256').update(lookMsg(h, lv)).digest(), Buffer.from(dk, 'hex'), Buffer.from(sig, 'hex')); }
    catch (e) { return false; }
}

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
// what you share (badges included): cleaned the same way everyone else's is (3.9: with the extras)
function myProfile() { const p = Object.assign(cleanFull(Object.assign({}, cfg.profile, { bd: cfg.showBadges === false ? [] : myBadges() })), cleanExtras(cfg.profile)); noteAnims(p); return p; }
function myPv() { if (!cfg || !cfg.shareProfile) return ''; const p = cleanProfile(myProfile()); return isEmptyProfile(p) ? '' : profileVersion(p); }
function myLv() { if (!cfg || !cfg.shareProfile) return ''; const p = myProfile(); return hasLook(p) ? lookVersion(p) : ''; }
function myXv() { if (!cfg || !cfg.shareProfile) return ''; return extrasVersion(cfg.profile); }
// your mains as shared: the ones you picked (Edit profile), and for your other games the characters
// you play most (notes.js; unless "fill them in" is off). Worked out at most once a minute
let mainsCache = { at: 0, v: null };
function myMains() {
    if (!cfg || !cfg.shareProfile || cfg.shareMains === false) return {};
    const now = Date.now();
    if (mainsCache.v && now - mainsCache.at < 60000) return mainsCache.v;
    const nt = fc.modules.get('notes');
    const auto = nt && nt.myAutoMains ? nt.myAutoMains() : {};
    const v = cleanMains(Object.assign({}, auto, cleanMains(cfg.mains)));
    mainsCache = { at: now, v };
    return v;
}
function myMv() { return mainsVersion(myMains()); }
function setMains(mn) {
    cfg.mains = cleanMains(mn);
    store.save();
    mainsCache.at = 0;
    if (said) say('here');
    changed();
    fc.emit('presence:profile', { me: true });
}
// someone's shared mains ({} when none, or their profile is hidden); asks for them like profile() does
function mainsOf(name) {
    if (!name || !cfg) return {};
    if (fc.app.isMe(name)) return myMains();
    if (!cfg.showProfiles || isHidden(name)) return {};
    profile(name, true);
    const h = hashOf(name), e = book.get(h, Date.now()), c = seen.m[h];
    if (e && !e.mv) return {};                          // here, and not sharing them (any more)
    return (c && c.mn) || {};
}
function signExtras(h, lv, xv) {
    const lb = fc.modules.get('lobbies');
    if (!crypto || !lb || !lb.signId) return '';
    return lb.signId(crypto.createHash('sha256').update(extrasMsg(h, lv, xv)).digest());
}
function extrasSigned(h, lv, xv, dk, sig) {
    if (!crypto || !V || !V.verify || !/^[0-9a-f]{64}$/.test(String(dk || '')) || !/^[0-9a-f]{128}$/.test(String(sig || ''))) return false;
    try { return V.verify(crypto.createHash('sha256').update(extrasMsg(h, lv, xv)).digest(), Buffer.from(dk, 'hex'), Buffer.from(sig, 'hex')); }
    catch (e) { return false; }
}

function answerProfile(m, now) {
    if (!cfg.visible || !cfg.shareProfile || !HASH.test(String(m.q || '')) || m.q !== myHash()) return;
    // answers to the same version at most every 4 s (a new version always goes out)
    const pv = myPv(), lv = myLv(), xv = myXv(), mv = myMv(), v = pv + lv + xv + mv;
    if (!v || (v === lastAnswer.v && now - lastAnswer.at < 4000)) return;
    lastAnswer = { v, at: now };
    send('prof', profAnswer());
}
// your profile for whoever asked: the looks signed with your Fightcord ID (3.6 only reads the text);
// 3.9: the extras signed on their own (over lv too, so they only go with these looks)
function profAnswer() {
    const lv = myLv(), xv = myXv(), h = myHash();
    const out = lv || xv ? { p: myProfile() } : { p: cleanProfile(myProfile()) };
    if (lv) { out.lv = lv; out.sig = signLook(h, lv); }
    if (xv) { out.xv = xv; out.xsig = signExtras(h, lv, xv); }
    const mv = myMv();
    if (mv) { out.mv = mv; out.mn = myMains(); }
    return out;
}
function takeProfile(m, now) {
    if (!HASH.test(String(m.h || '')) || m.h === myHash()) return;
    const e = book.get(m.h, now);
    if (!e) return;
    const full = cleanFull(m.p);
    let x = null;
    // the looks: the version they announced, signed by their Fightcord ID, and the ID that name is pinned to
    if (e.lv && m.lv === e.lv && lookVersion(full) === e.lv) {
        if (lookSigned(m.h, e.lv, e.dk, m.sig) && mayLook(seen.pins[m.h], e.dk, friendPkFor(m.h), now)) {
            seen.pins[m.h] = { dk: e.dk, at: now };
            x = { pv: e.pv, lv: e.lv, p: full, at: now };
        } else if (e.pv && profileVersion(full) === e.pv) x = { pv: e.pv, lv: '', bad: e.lv, p: cleanProfile(full), at: now };    // the text only
        else x = { pv: '', lv: '', bad: e.lv, p: {}, at: now };
    } else if (e.pv && m.pv === e.pv && profileVersion(full) === e.pv) {
        // only the version that player announced (someone else answering for them doesn't count)
        x = { pv: e.pv, lv: '', p: cleanProfile(full), at: now };
    }
    // 3.9: the name style and decoration -- the version they announced, signed by the ID that name is pinned to
    if (e.xv && m.xv === e.xv) {
        const ex = cleanExtras(m.p);
        const ok = extrasVersion(ex) === e.xv && extrasSigned(m.h, e.lv || '', e.xv, e.dk, m.xsig) && mayLook(seen.pins[m.h], e.dk, friendPkFor(m.h), now);
        if (!x) x = { pv: '', lv: '', p: {}, at: now };
        if (ok) { seen.pins[m.h] = { dk: e.dk, at: now }; x.xv = e.xv; Object.assign(x.p, ex); }
        else x.xbad = e.xv;
    }
    // 3.9.1: their mains, when they're the version they announced
    if (e.mv && m.mv === e.mv) {
        const mn = cleanMains(m.mn);
        if (mainsVersion(mn) === e.mv) { if (!x) x = { pv: '', lv: '', p: {}, at: now }; x.mv = e.mv; x.mn = mn; }
    }
    if (!x) return;
    remember(m.h, x);
    changed();
    fc.emit('presence:profile', { h: m.h });
}

const isHidden = (name) => (cfg.hiddenProfiles || []).indexOf(lc(name)) >= 0;
// others' pictures off (Settings): their avatar and banner go, the rest stays
function pics(p) {
    if (!p || cfg.showPics !== false || !(p.av || p.bn)) return p;
    const o = Object.assign({}, p);
    delete o.av; delete o.bn;
    return o;
}
// someone's profile: null until it's known (asking for it the first time), or when hidden;
// soft (the member list): ask once per version, never again every 30 s. 3.7: the last one seen
// while they're away
function profile(name, soft) {
    if (!name || !cfg) return null;
    if (fc.app.isMe(name)) { const p = myProfile(); return isEmptyProfile(p) && !hasLook(p) && !hasExtras(p) ? null : p; }
    if (!cfg.showProfiles || isHidden(name)) return null;
    const h = hashOf(name), now = Date.now();
    const e = book.get(h, now), c = seen.m[h] || null;
    const shown = c && (!isEmptyProfile(c.p) || hasLook(c.p) || hasExtras(c.p)) ? pics(c.p) : null;
    if (!e) return shown;
    if (!e.pv && !e.lv && !e.xv && !e.mv) return null;    // here, and sharing nothing (any more)
    const xok = !c || (e.xv ? c.xv === e.xv || c.xbad === e.xv : !c.xv);
    const mok = !c || (e.mv ? c.mv === e.mv : true);
    if (c && xok && mok && (e.lv ? c.lv === e.lv || c.bad === e.lv : !c.lv && (c.pv || '') === e.pv)) return shown;
    // a new version: ask now; the same one again: not more than every 30 s
    const v = e.pv + e.lv + (e.xv || '') + (e.mv || ''), last = asked.get(h);
    if (relays && (!last || last.v !== v || (!soft && now - last.at > 30000))) { asked.set(h, { v, at: now }); send('prof?', { q: h }); }
    return shown;                                          // (the old one meanwhile)
}

// a card's banner: their picture, else the game they picked (3.7: the still one; it plays on hover)
function bannerFor(name) {
    const p = profile(name);
    if (p && p.bn) return `linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.28)),url(&quot;${E(p.bn.s || p.bn.u)}&quot;) center/cover`;
    return p && p.b ? `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.45)),url(&quot;${E(fc.data.artUrl(p.b, 'https://web.fightcade.com/'))}&quot;) center 30%/cover` : '';
}
function badgesHtml(p, mine) {
    if (!p || !(p.bd || []).length) return '';
    const tip = mine ? '' : ' · ' + T('from their Fightcord');
    return `<div class="fcBadges">${p.bd.map(id => `<span class="fcBadge ${BADGES[id].kind}" title="${E(T(BADGES[id].label) + tip)}">${fc.ui.ic(BADGES[id].icon, BADGES[id].kind === 'sets' ? '' : 'fill')}<span>${E(T(BADGES[id].label))}</span></span>`).join('')}</div>`;
}
// their first week with Fightcord: 1..7, else 0 (from their "I'm new", not their profile: older
// Fightcords would turn down a profile with a badge they don't know)
function newDayOf(name) {
    if (!name || !cfg) return 0;
    if (fc.app.isMe(name)) return myNewDay();
    if (!cfg.showProfiles || isHidden(name)) return 0;
    const e = book.get(hashOf(name), Date.now());
    return e ? e.nw || 0 : 0;
}
function newbieHtml(name) {
    if (!newDayOf(name)) return '';
    const tip = T('New to Fightcord') + (fc.app.isMe(name) ? '' : ' · ' + T('from their Fightcord'));
    return `<span class="fcBadge new" title="${E(tip)}">${fc.ui.ic('rocket', 'fill')}<span>${E(T('New to Fightcord'))}</span></span>`;
}
// the status line, About me and badges for a card (opts.about / opts.status: false leaves them
// out; a card showing the status in its bubble passes status: false)
function profileHtml(name, opts) {
    const p = profile(name), nb = newbieHtml(name);
    if (!p) return nb ? `<div class="fcProf"><div class="fcBadges">${nb}</div></div>` : '';
    const o = opts || {};
    const badges = badgesHtml(p, fc.app.isMe(name));
    if (o.status === false && !(o.about !== false && p.a) && !badges && !nb) return '';
    return `<div class="fcProf">${p.s && o.status !== false ? `<div class="fcProfS">${fc.ui.ic('chat')}<span>${E(p.s)}</span></div>` : ''}` +
        (o.about !== false && p.a ? `<div class="fcProfA"><b>${E(T('About me'))}</b>${E(p.a)}</div>` : '') +
        (nb ? (badges ? badges.replace('<div class="fcBadges">', '<div class="fcBadges">' + nb) : `<div class="fcBadges">${nb}</div>`) : badges) + '</div>';
}
function setProfile(p) {
    const c = Object.assign(cleanFull(p), cleanExtras(p));
    delete c.bd;                          // (badges come from your history, every time)
    cfg.profile = c;
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
    return e ? { voice: e.voice, dk: e.dk || '', chatOff: !!e.mc, ws: e.ws || 0 } : null;
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
.fcPres { display: inline-flex; align-items: center; height: 15px; padding: 0 4px; margin: 0 0 0 5px; border-radius: var(--fc-r1); vertical-align: middle;
    background: var(--fc-accent); color: var(--fc-on-accent, #fff); font: 800 var(--fc-fs-2xs)/1 var(--fc-font); letter-spacing: 0; text-transform: none; flex: none; cursor: default; }
.fcPres > b { font-weight: 800; }
.fcPres > b + .fc-ic { margin-left: 2px; }
.fcPres .fc-ic { width: 10px; height: 11px; stroke-width: 3; }
.fcPres.v { background: var(--fc-success); }
.fcPres.big { height: 18px; padding: 0 5px; font-size: var(--fc-fs-sm); border-radius: 5px; }
.fcPres.big .fc-ic { width: 12px; height: 13px; }
.fcPresLine { display: flex; align-items: center; margin-top: 6px; font-size: var(--fc-fs-sm); color: var(--fc-muted); }
.fcPresLine .fcPres { margin: 0 6px 0 0; }
.fcProf { margin-top: 8px; }
.fcProfS { display: flex; align-items: flex-start; padding: 6px 9px; border-radius: var(--fc-r2); background: var(--fc-s2); font: var(--fc-fs-ui)/1.35 var(--fc-font); color: var(--fc-text); }
.fcProfS > .fc-ic { flex: none; width: 13px; height: 13px; margin: 2px 7px 0 0; color: var(--fc-muted); }
.fcProfS > span { min-width: 0; word-wrap: break-word; }
.fcProfA { margin-top: 8px; font: var(--fc-fs-ui)/1.45 var(--fc-font); color: var(--fc-text); word-wrap: break-word; }
.fcProfA > b { display: block; margin-bottom: 2px; font: 600 var(--fc-fs-ui)/16px var(--fc-font); color: var(--fc-head); }
.fcBadges { display: flex; flex-wrap: wrap; margin: 8px -4px 0 0; }
.fcBadge { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; margin: 0 4px 4px 0; border-radius: 10px; background: var(--fc-s2);
    font: 600 var(--fc-fs-xs)/20px var(--fc-font); color: var(--fc-text); cursor: default; }
.fcBadge .fc-ic { width: 12px; height: 12px; margin-right: 4px; }
.fcBadge.sets .fc-ic { color: var(--fc-accent); }
.fcBadge.streak .fc-ic { color: #ff8a3d; }
.fcBadge.top .fc-ic { color: var(--fc-warning); }
.fcBadge.new { background: linear-gradient(90deg, rgba(88,101,242,.35), rgba(235,69,158,.3)); }
.fcBadge.new .fc-ic { color: #fff; }
/* (beats the theme's plain system line: html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd)) */
html body .chatContent .messageWrapper.bot.fcNew:not(.chat):not(.motd), html.dc-layout body .chatContent .messageWrapper.bot.fcNew:not(.chat):not(.motd) { margin: 8px 48px 4px 72px !important; padding: 6px 12px !important; border-radius: 6px !important;
    background: linear-gradient(90deg, rgba(88,101,242,.22), rgba(235,69,158,.12)) !important; box-shadow: inset 3px 0 0 var(--fc-accent) !important; }
html body .chatContent .messageWrapper.bot.fcNew:not(.chat):not(.motd) .regular, html.dc-layout body .chatContent .messageWrapper.bot.fcNew:not(.chat):not(.motd) .regular { color: var(--fc-head) !important; font-weight: 600 !important; }
html body .chatContent .messageWrapper.bot.fcNew:not(.chat):not(.motd)::before, html.dc-layout body .chatContent .messageWrapper.bot.fcNew:not(.chat):not(.motd)::before { display: none !important; }
`;

function start(f) {
    fc = f;
    store = fc.config('presence', { visible: true, shareProfile: true, showProfiles: true, showPics: true, showBadges: true, profile: { s: '', a: '', b: '' }, hiddenProfiles: [],
        shareNew: true, welcomeNew: true, shareChatOff: true, chatOffLine: false, shareMains: true, mains: {}, announced: {} });
    cfg = store.data;
    seenStore = fc.config('presence-profiles', { m: {}, pins: {} });
    seen = seenStore.data;
    if (!seen.m || typeof seen.m !== 'object') seen.m = {};
    if (!seen.pins || typeof seen.pins !== 'object') seen.pins = {};
    pruneSeen(Date.now());
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
    readChatMuted();
    fc.tick(readChatMuted, 30000, { whileHidden: true });
    fc.on('match:accepted', (ev) => { tellChatOff(ev && ev.opp).catch(() => {}); });
    fc.settings.block({
        id: 'presence', section: 'voice', title: 'Fightcord players', hint: '— see who else has Fightcord', store, order: 5,
        fields: [
            { key: 'visible', type: 'switch', label: 'Show that I use Fightcord',
                hint: 'Others with Fightcord see an F next to your name. Voice chat needs this on.',
                onChange: (v) => { if (v) send('hi'); else send('bye'); changed(); } },
            { key: 'shareProfile', type: 'switch', label: 'Share my profile', hint: 'Your avatar, banner, colours, status, About me and badges, for Fightcord players (set them from your avatar, bottom-left)',
                show: (d) => d.visible, onChange: () => { if (said) say('here'); changed(); } },
            { key: 'shareMains', type: 'switch', label: 'Share my mains', hint: 'The characters you play, on your card for Fightcord players: the ones you pick in Edit profile, or the ones you play most',
                show: (d) => d.visible && d.shareProfile, onChange: () => { mainsCache.at = 0; if (said) say('here'); changed(); } },
            { key: 'showBadges', type: 'switch', label: 'Show my badges', hint: 'Sets played, win streaks and leaderboard spots, from your own history', show: (d) => d.visible && d.shareProfile,
                onChange: () => { badgeCache.at = 0; if (said) say('here'); changed(); } },
            { key: 'showProfiles', type: 'switch', label: 'Show other players’ profiles', hint: 'Their status and badges on hover and scout cards' },
            { key: 'showPics', type: 'switch', label: 'Show other players’ pictures', hint: 'The avatar and banner they picked, everywhere you see them', show: (d) => d.showProfiles,
                onChange: () => { changed(); fc.emit('presence:profile', { pics: true }); } },
            { key: 'shareNew', type: 'switch', label: 'Tell Fightcord players I’m new', hint: 'In your first week with Fightcord: a welcome line in their chat and a “New to Fightcord” badge on your card',
                show: (d) => d.visible, onChange: () => { if (said) say('here'); changed(); } },
            { key: 'shareChatOff', type: 'switch', label: 'Tell Fightcord opponents when my in-game chat is muted',
                hint: 'Uses the Mute chat setting of the emulator (FBNeo games). Their VS screen says you’ll talk in the lobby after the set.',
                show: (d) => d.visible, onChange: () => { if (said) say('here'); changed(); } },
            { key: 'chatOffLine', type: 'switch', label: 'Tell everyone else in the lobby chat',
                hint: 'When your in-game chat is muted and the opponent has no Fightcord, sends “@name my in-game chat is off, not ignoring you. GGs here after!” in the lobby. This is public, once per opponent every 6 hours.' },
            { key: 'welcomeNew', type: 'switch', label: 'Welcome new Fightcord players in the chat', hint: 'A line in your chat when someone in your channel just got Fightcord (only you see it)' },
            { type: 'note', label: 'Fightcord players find each other through the same free public relays as voice chat. Your name is sent hashed, and nothing is stored, but anyone listening who knows your name could tell you use Fightcord. A profile you share can be read by any Fightcord player, and your profile pictures are on public file hosts: anyone with the link can see them.' }
        ]
    });
    if (crypto) connect();
    // a newcomer heard while you were looking at another channel: when you open theirs
    fc.tick(() => { announcePending(); tagWelcomes(); }, 4000);
    // what Fightcord players see when someone new joins (with your name, only on your screen)
    fc.cmd('newcomer', 'Preview the welcome line Fightcord players see for someone new', () => {
        const ch = fc.app.activeChannelId();
        if (ch) welcomeLine(fc.app.me() || 'You', ch);
    });
    fc.watch(tagWelcomes, { selector: '.chatContent .messageWrapper.bot' });
    return api;
}

const api = {
    info: (n) => info(n),
    check: (n, ms) => check(n, ms),
    mark: (n, big) => mark(n, big),
    line: (n) => line(n),
    visible: () => !!(cfg && cfg.visible),
    profile: (n) => profile(n),
    softProfile: (n) => profile(n, true),
    profileHtml: (n, o) => profileHtml(n, o),
    badgesHtml: (p, mine) => badgesHtml(p, mine),
    bannerFor: (n) => bannerFor(n),
    myProfile: () => myProfile(),
    rawProfile: () => Object.assign({ s: '', a: '', b: '' }, cfg && cfg.profile),
    // 3.10: something you share changed (your win streak): say so now
    announce() { if (said && cfg && cfg.visible) say('here'); },
    // 3.9.1: mains
    mainsOf: (n) => mainsOf(n),
    myMainsSet: () => cleanMains(cfg && cfg.mains),
    setMains: (mn) => setMains(mn),
    setProfile: (p) => setProfile(p),
    hideProfile: (n, on) => hideProfile(n, on),
    isHidden: (n) => !!cfg && isHidden(n),
    sharing: () => !!(cfg && cfg.visible && cfg.shareProfile),
    // 3.7 looks: the moving picture behind a still one (or ''), the frame ids
    animOf: (url) => anims.get(url) || '',
    frames: () => FRAMES.slice(),
    cleanFull: (p) => cleanFull(p),
    // 3.9: name styles and decorations
    nameStyles: () => NAME_STYLES.slice(),
    decos: () => DECOS.slice(),
    readable: (c) => readable(c),
    // the dev harness: pretend someone shared a profile (looks too: not signed, it's only on your screen)
    _profile(name, p) {
        const c = Object.assign(cleanFull(p), cleanExtras(p)), h = hashOf(name), pv = isEmptyProfile(cleanProfile(c)) ? '' : profileVersion(c), lv = hasLook(c) ? lookVersion(c) : '', xv = extrasVersion(c);
        const mn = cleanMains(p.mn), mv = mainsVersion(mn);
        book.heard(h, false, Date.now(), pv, 0, '', lv, xv, 0, mv);
        remember(h, { pv, lv, xv, mv, mn, p: c, at: Date.now() });
        changed();
        fc.emit('presence:profile', { h });
    },
    _forget(name) { const h = hashOf(name); book.gone(h); changed(); },
    _msg: (m) => onMsg(m),                // tests: a message from the relays
    _answer: () => Object.assign({ t: 'prof', h: myHash(), pv: myPv(), lv: myLv(), xv: myXv(), dk: myDk() }, profAnswer()),
    count: () => book.count(Date.now()),
    // the dev harness: pretend we heard from someone (nw: a newcomer's day)
    _heard(name, voice, nw) { const h = hashOf(name); if (book.heard(h, voice, Date.now(), '', nw)) changed(); if (nw) newcomer(h, nw); },
    newDay: (n) => newDayOf(n),
    _connected: () => (relays ? relays.open() : 0),
    _pvOf: (n) => { const e = book.get(hashOf(n), Date.now()); return e ? e.pv : null; },
    _myPv: () => myPv()
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
