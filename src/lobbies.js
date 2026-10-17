/**
 * Fightcord private lobbies (Fightcord-only)
 *
 * Your own invite-only lobby, like a Discord server: a chat that keeps its history, a member list
 * (who's online, in a match, in voice) with a Challenge button, and a voice room for everyone.
 *   - Lobbies show up in the server rail under your game channels; "+" creates one or joins one
 *     with an invite code (FC-XXXXXX-XXXXXX-XXXXXX-XXXXXX). Only Fightcord can open them.
 *   - Everything goes through the same free public Nostr relays as voice chat, AES-GCM-encrypted
 *     with a key that only exists in the invite code. The relays keep the (encrypted) messages, so
 *     you see what was said while you were away. Each member signs with their own key per lobby.
 *   - Each lobby has one game: Challenge gets both players into that game's Fightcade channel (your
 *     Fightcord asks theirs to join it) and then sends Fightcade's own challenge.
 *   - The owner can remove someone: everyone left gets a new key (handed over encrypted to each
 *     member), so the removed player can't read anything new, and the invite code changes.
 *   - The voice room: every pair of players talks directly (WebRTC, like the 1-on-1 voice chat),
 *     up to 8 people, using the voice chat settings (mic, speakers, sensitivity, Ctrl+Shift+M).
 *
 * Epochs: a lobby starts at epoch 0 with seed S0; each new key is a new epoch with its own seed,
 * topic and key. The invite code is the current seed + the start of the owner's public key.
 */
'use strict';

const path = require('path');
const crypto = (() => { try { return require('crypto'); } catch (e) { return null; } })();

let fc = null;
let store = null, cfg = null;            // lobbies-config.json: the lobbies you're in, your secret
let cache = null;                        // lobbies-cache-config.json: recent events per lobby
let V = null;                            // voice.js (keys, signing, sealing, the WebRTC helpers)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const E = (s) => fc.fmt.esc(s);
const N_ = (s) => s;
const lc = (s) => String(s || '').toLowerCase();
const mod = (id) => fc.modules.get(id);
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');

const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://offchain.pub', 'wss://relay.damus.io'];
const KIND = 4551;                       // regular: relays keep it (the chat, joins, the lobby's info)
const LIVE = 25052;                      // ephemeral: who's online, the voice room's handshakes
const BEAT = 150000;                     // "here" this often
const TTL = 6 * 60000;                   // online if heard within this
const KEEP = 30 * 86400000;              // history asked for: the last 30 days
const MAX_VOICE = 8;
const MAX_TEXT = 2000;

/* ======================================================= invite codes (pure) */

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32(buf) {
    let bits = 0, v = 0, out = '';
    for (const byte of buf) {
        v = (v << 8) | byte; bits += 8;
        while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits) out += B32[(v << (5 - bits)) & 31];
    return out;
}
function unb32(str) {
    let bits = 0, v = 0;
    const out = [];
    for (const ch of str) {
        const i = B32.indexOf(ch);
        if (i < 0) return null;
        v = ((v << 5) | i) & 0xffff; bits += 5;
        if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest();

// seed (9 bytes, hex) + owner's public key (hex) -> 'FC-XXXXXX-XXXXXX-XXXXXX-XXXXXX'
function encodeCode(seed, ownerPk) {
    const body = Buffer.concat([Buffer.from(seed, 'hex'), Buffer.from(String(ownerPk).slice(0, 10), 'hex')]);
    const raw = Buffer.concat([body, sha(body).slice(0, 1)]);
    return 'FC-' + b32(raw).match(/.{6}/g).join('-');
}
// whatever was pasted -> { seed, pre } | null (typos: a wrong check byte)
function decodeCode(text) {
    let s = String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
    if (s.length === 26 && s.startsWith('FC')) s = s.slice(2);
    if (s.length !== 24) return null;
    const raw = unb32(s);
    if (!raw || raw.length !== 15) return null;
    const body = raw.slice(0, 14);
    if (sha(body)[0] !== raw[14]) return null;
    return { seed: body.slice(0, 9).toString('hex'), pre: body.slice(9).toString('hex') };
}
const newSeed = () => crypto.randomBytes(9).toString('hex');

// a seed -> the epoch's topic (what relays see) and key (what reads it)
function derive(seed) {
    return {
        topic: sha('fightcord-lobby-v1|t|' + seed).toString('hex').slice(0, 32),
        key: sha('fightcord-lobby-v1|k|' + seed)
    };
}

// your signing key in one lobby (a different one per lobby: lobbies can't be linked by key)
function memberKey(secret, lobbyId) {
    for (let i = 0; i < 16; i++) {
        const k = sha('fightcord-lobby-v1|me|' + secret + '|' + lobbyId + '|' + i);
        if (k[0] !== 0xff && k.some(b => b)) return k;          // < the curve order, not zero
    }
    throw new Error('no key');
}

// a new seed for one member only (ECDH between the owner's key and theirs)
function wrapSeed(sk, pk, seed) { return V.seal(V.ecdh(sk, Buffer.from(pk, 'hex')), { s: seed }); }
function unwrapSeed(sk, pk, blob) {
    try { const o = V.open([V.ecdh(sk, Buffer.from(pk, 'hex'))], blob); return o && /^[0-9a-f]{18}$/.test(o.s) ? o.s : null; }
    catch (e) { return null; }
}

/* =================================================================== a room (pure) */

// Everything a lobby's events say, in any order (history arrives shuffled across relays):
//   ev = { id, pk, at, ep, b: body, ok: signature checked }
function Room(o) {
    const r = {
        owner: (o && o.owner) || '', pre: (o && o.pre) || '',
        info: null, members: new Map(), out: new Map(), msgs: [], ids: new Set(), ends: {}, rekeys: [], closed: false
    };
    r.isOwner = (pk) => !!pk && (r.owner ? pk === r.owner : !!r.pre && pk.startsWith(r.pre));
    function member(pk, n, g, at, ep, trusted) {
        if (!pk || !n) return;
        const kicked = r.out.get(pk);
        if (kicked != null && !(ep > kicked)) return;
        if (kicked != null) r.out.delete(pk);
        let m = r.members.get(pk);
        if (!m) { m = { pk, n: String(n).slice(0, 40), g: '', at, seen: 0, left: 0 }; r.members.set(pk, m); }
        if (trusted) m.n = String(n).slice(0, 40);
        if (g && /^[0-9a-f]{1,64}$/i.test(g)) m.g = g;
        if (at < m.at) m.at = at;
        if (at > m.seen) m.seen = at;
        return m;
    }
    function push(item) {
        let i = r.msgs.length;
        while (i > 0 && (r.msgs[i - 1].at > item.at || (r.msgs[i - 1].at === item.at && r.msgs[i - 1].id > item.id))) i--;
        r.msgs.splice(i, 0, item);
        if (r.msgs.length > 600) r.msgs.splice(0, r.msgs.length - 600);
    }
    // -> what changed: 'info' | 'member' | 'msg' | 'rekey' | ''
    r.apply = (ev) => {
        const b = ev && ev.b;
        if (!b || !ev.id || !ev.pk || r.ids.has(ev.id)) return '';
        r.ids.add(ev.id);
        const ep = ev.ep || 0;
        if (b.t === 'info') {
            if (!ev.ok || !r.isOwner(ev.pk) || (r.info && r.info.at > ev.at)) return '';
            r.owner = ev.pk;
            r.info = { name: String(b.name || '').slice(0, 40), rom: b.rom || '', ch: b.ch || '', id: b.id || '', epoch: +b.epoch || 0, prev: Array.isArray(b.prev) ? b.prev : [], at: ev.at };
            if (Array.isArray(b.members)) b.members.forEach(x => Array.isArray(x) && member(x[0], x[1], x[2], ev.at, ep, true));
            r.closed = !!b.closed;
            return 'info';
        }
        if (b.t === 'rekey') {
            if (!ev.ok || !r.isOwner(ev.pk)) return '';
            r.rekeys.push({ at: ev.at, ep, epoch: +b.epoch || 0, keys: b.keys || {}, out: Array.isArray(b.out) ? b.out : [] });
            if (r.ends[ep] == null || ev.at < r.ends[ep]) r.ends[ep] = ev.at;
            (Array.isArray(b.out) ? b.out : []).forEach(pk => {
                const m = r.members.get(pk);
                r.out.set(pk, ep);
                if (m) { r.members.delete(pk); push({ id: ev.id + pk.slice(0, 6), sys: 'out', pk, n: m.n, at: ev.at, ep }); }
            });
            return 'rekey';
        }
        if (b.t === 'join') {
            const m = member(ev.pk, b.n, b.g, ev.at, ep);
            if (!m) return '';
            push({ id: ev.id, sys: 'join', pk: ev.pk, n: m.n, at: ev.at, ep });
            return 'member';
        }
        if (b.t === 'leave') {
            const m = r.members.get(ev.pk);
            if (m && ev.at > m.left) m.left = ev.at;
            if (m) push({ id: ev.id, sys: 'leave', pk: ev.pk, n: m.n, at: ev.at, ep });
            return 'member';
        }
        if (b.t === 'msg') {
            const x = typeof b.x === 'string' ? b.x.slice(0, MAX_TEXT) : '';
            if (!x.trim()) return '';
            const m = member(ev.pk, b.n, b.g, ev.at, ep) || r.members.get(ev.pk);
            push({ id: ev.id, pk: ev.pk, n: m ? m.n : String(b.n || '?').slice(0, 40), g: (m && m.g) || '', x, at: ev.at, ep });
            return 'msg';
        }
        return '';
    };
    // a member is in unless they left after they last said something, or were removed
    r.active = () => [...r.members.values()].filter(m => !r.out.has(m.pk) && !(m.left && m.left > m.seen));
    // the chat as shown: an old key's messages stop where that key was replaced
    r.visible = () => r.msgs.filter(m => r.ends[m.ep] == null || m.at <= r.ends[m.ep] + 60000);
    // a name claimed by two keys: the first one keeps it, the rest get flagged
    r.dupes = () => {
        const first = new Map(), out = new Set();
        [...r.members.values()].sort((a, b) => a.at - b.at).forEach(m => { const k = lc(m.n); if (first.has(k)) out.add(m.pk); else first.set(k, m.pk); });
        return out;
    };
    return r;
}

// "@name" anywhere, any case
function mentions(text, me) {
    if (!me) return false;
    const re = new RegExp('(^|[^\\w])@' + me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'i');
    return re.test(String(text || ''));
}

// messages -> groups like Discord: one author, nothing else in between, within 7 minutes
function groups(msgs) {
    const out = [];
    msgs.forEach(m => {
        const g = out[out.length - 1];
        if (!m.sys && g && !g.sys && g.pk === m.pk && m.at - g.last < 7 * 60000 && sameDay(g.last, m.at)) { g.items.push(m); g.last = m.at; }
        else out.push(m.sys ? Object.assign({ items: [m] }, m) : { pk: m.pk, n: m.n, g: m.g, at: m.at, last: m.at, items: [m] });
    });
    return out;
}
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

module.exports = {
    id: 'lobbies', name: 'Private lobbies',
    start: (f) => start(f),
    // pure parts, for the tests
    encodeCode, decodeCode, derive, memberKey, wrapSeed, unwrapSeed, Room, mentions, groups, b32, unb32, KIND, LIVE,
    _setVoice: (v) => { V = v; }
};

/* ========================================================== relays (the network) */

// One connection per relay for every lobby: subscriptions are re-sent when a relay comes back,
// and recent messages are re-sent too (relays drop duplicates by id).
function Pool(urls, W) {
    const socks = new Map(), subs = new Map(), out = [];
    let closed = false, n = 0;
    const tag = crypto.randomBytes(3).toString('hex');
    function req(ws, id, sub) { try { ws.send(JSON.stringify(['REQ', id].concat(sub.filters()))); } catch (e) { /* closing */ } }
    function connect(url) {
        const s = socks.get(url) || { tries: 0 };
        socks.set(url, s);
        let ws;
        try { ws = new W(url); } catch (e) { return; }
        s.ws = ws;
        ws.onopen = () => {
            s.tries = 0;
            subs.forEach((sub, id) => req(ws, id, sub));
            out.forEach(ev => { try { ws.send(JSON.stringify(['EVENT', ev])); } catch (e) { /* closing */ } });
        };
        ws.onmessage = (m) => {
            let d;
            try { d = JSON.parse(m.data); } catch (e) { return; }
            const sub = subs.get(d[1]);
            if (!sub) return;
            if (d[0] === 'EVENT' && d[2]) sub.onEvent(d[2]);
            else if (d[0] === 'EOSE' && !sub.eose.has(url)) { sub.eose.add(url); if (sub.onEose) sub.onEose(sub.eose.size); }
        };
        ws.onerror = () => {};
        ws.onclose = () => {
            if (closed || s.ws !== ws) return;
            s.tries++;
            setTimeout(() => { if (!closed) connect(url); }, Math.min(300000, 3000 * Math.pow(2, s.tries)));
        };
    }
    urls.forEach(connect);
    const each = (fn) => socks.forEach(s => { if (s.ws && s.ws.readyState === 1) fn(s.ws); });
    return {
        sub(filters, onEvent, onEose) {
            const id = 'fcl' + tag + (++n);
            const sub = { filters: typeof filters === 'function' ? filters : () => filters, onEvent, onEose, eose: new Set() };
            subs.set(id, sub);
            each(ws => req(ws, id, sub));
            return { close() { if (!subs.delete(id)) return; each(ws => { try { ws.send(JSON.stringify(['CLOSE', id])); } catch (e) { /* closing */ } }); } };
        },
        pub(ev, keep) {
            if (keep) { out.push(ev); if (out.length > 30) out.shift(); }
            each(ws => { try { ws.send(JSON.stringify(['EVENT', ev])); } catch (e) { /* closing */ } });
        },
        open: () => { let k = 0; each(() => k++); return k; },
        close() { closed = true; socks.forEach(s => { try { s.ws.close(); } catch (e) { /* gone */ } }); }
    };
}

/* ======================================================================= state */

let pool = null;
const rooms = new Map();                 // lobby id -> L: { lb, room, live: Map pk -> here, sk, pk, topics: Map topic -> {ep, key}, sub, oldSubs }
let timers = [];
let view = { id: '', page: null };       // the lobby on screen
let demo = false;
const bootAt = Date.now();

const now = () => Date.now();
const me = () => fc.app.me() || '';
const myGravatar = () => { const [, u] = fc.app.user(me()); return (u && u.gravatar) || ''; };
const lobbyById = (id) => cfg.lobbies.find(l => l.id === id) || null;
const gameName = (lb) => shortName(lb && lb.ch) || T('No game');

function keysFor(L) {
    L.topics = new Map();
    if (!crypto) return;
    L.lb.seeds.forEach((seed, ep) => { const d = derive(seed); L.topics.set(d.topic, { ep, key: d.key }); });
}
const curTopic = (L) => derive(L.lb.seeds[L.lb.epoch]).topic;
const curKey = (L) => derive(L.lb.seeds[L.lb.epoch]).key;

function roomFor(lb) {
    let L = rooms.get(lb.id);
    if (L) return L;
    L = { lb, room: Room({ owner: lb.owner, pre: lb.pre }), live: new Map(), sk: null, pk: '', sub: null, oldSubs: [], lastHere: 0 };
    if (crypto && V && cfg.secret) { L.sk = memberKey(cfg.secret, lb.id); L.pk = V.pubkey(L.sk).toString('hex'); }
    keysFor(L);
    (cache.data[lb.id] || []).forEach(ev => L.room.apply(ev));
    rooms.set(lb.id, L);
    return L;
}

// an event from a relay -> the room (or the voice room / presence)
function onEvent(L, ev) {
    if (!ev || typeof ev.content !== 'string' || !Array.isArray(ev.tags)) return;
    const t = (ev.tags.find(x => x[0] === 't') || [])[1];
    const tk = t && L.topics.get(t);
    if (!tk || ev.pubkey === L.pk) return;
    const b = V.open([tk.key], ev.content);
    if (!b || typeof b.t !== 'string') return;
    const sent = typeof b.ms === 'number' && Math.abs(b.ms - ev.created_at * 1000) < 120000 ? b.ms : ev.created_at * 1000;
    if (ev.kind === LIVE) { onLive(L, ev.pubkey, b, sent); return; }
    // only the owner's own info / new keys need a checked signature (the rest is sealed with the key)
    const needs = (b.t === 'info' || b.t === 'rekey') && L.room.isOwner(ev.pubkey);
    const rec = { id: ev.id, pk: ev.pubkey, at: sent, ep: tk.ep, b, ok: needs ? V.checkEvent(ev) : false };
    applyEv(L, rec, true);
}

function applyEv(L, rec, fromNet) {
    const what = L.room.apply(rec);
    if (!what) return;
    if (what === 'info' && L.room.info) {
        const i = L.room.info;
        if (!L.lb.owner) L.lb.owner = L.room.owner;
        if (i.name && i.name !== L.lb.name) L.lb.name = i.name;
        if (i.ch && i.ch !== L.lb.ch) { L.lb.ch = i.ch; L.lb.rom = i.rom; }
        if (L.room.closed && !L.lb.closed) { L.lb.closed = true; if (fromNet) fc.ui.toast(T('{lobby} was closed by its owner', { lobby: L.lb.name }), { icon: 'lock' }); }
        store.save();
    }
    if (what === 'rekey') onRekey(L);
    remember(L, rec);
    if (what === 'msg' && fromNet) notify(L, rec);
    changed(L.lb.id);
}

// keep the recent events on disk (the relays may drop old ones)
function remember(L, rec) {
    const list = cache.data[L.lb.id] || (cache.data[L.lb.id] = []);
    list.push({ id: rec.id, pk: rec.pk, at: rec.at, ep: rec.ep, b: rec.b, ok: rec.ok });
    if (list.length > 400) {
        // the owner's info and new keys stay: everything else is history
        const keep = list.filter(x => x.b.t === 'info' || x.b.t === 'rekey' || x.b.t === 'join');
        const rest = list.filter(x => !(x.b.t === 'info' || x.b.t === 'rekey' || x.b.t === 'join')).slice(-300);
        cache.data[L.lb.id] = keep.slice(-60).concat(rest);
    }
    cache.save();
}

// the owner handed out a new key: take ours (or find out we were removed)
function onRekey(L) {
    const lb = L.lb;
    const rk = L.room.rekeys.find(x => x.ep === lb.epoch && x.epoch === lb.epoch + 1);
    if (!rk || L.pk === L.room.owner) return;
    const blob = rk.keys[L.pk];
    const seed = blob ? unwrapSeed(L.sk, L.room.owner, blob) : null;
    if (seed) {
        lb.seeds[lb.epoch + 1] = seed;
        lb.epoch++;
        store.save();
        resubscribe(L);
        fc.log('lobbies: new key for', lb.name, 'epoch', lb.epoch);
    } else if (!lb.removed) {
        lb.removed = true;
        store.save();
        fc.ui.toast(T('You were removed from {lobby}', { lobby: lb.name }), { icon: 'lock', kind: 'warning' });
        leaveVoiceIf(lb.id);
    }
}

function subscribe(L) {
    if (!pool || L.sub || L.lb.removed) return;
    const topic = curTopic(L);
    const newest = L.room.msgs.length ? L.room.msgs[L.room.msgs.length - 1].at : 0;
    L.sub = pool.sub(() => [
        { kinds: [KIND], '#t': [topic], since: Math.floor(Math.max(now() - KEEP, newest - 3600000) / 1000), limit: 300 },
        { kinds: [LIVE], '#t': [topic], since: Math.floor(now() / 1000) - 30 }
    ], (ev) => onEvent(L, ev), (n) => { if (n === 1) { L.loaded = true; changed(L.lb.id); } });
}
function resubscribe(L) {
    if (L.sub) { L.sub.close(); L.sub = null; }
    keysFor(L);
    subscribe(L);
    setTimeout(() => sayHere(L, true), 800);
}
// the older keys' history, once, when the lobby opens
function loadOld(L) {
    if (!pool || L.oldDone) return;
    L.oldDone = true;
    const eps = L.lb.seeds.map((s, ep) => ep).filter(ep => ep < L.lb.epoch).slice(-3);
    eps.forEach(ep => {
        const topic = derive(L.lb.seeds[ep]).topic;
        const s = pool.sub([{ kinds: [KIND], '#t': [topic], limit: 200 }], (ev) => onEvent(L, ev), (n) => { if (n >= 2) s.close(); });
        setTimeout(() => s.close(), 15000);
    });
}

// sealed with the current key, signed with our key for this lobby
function post(L, body, live) {
    if (!pool || !L.sk || L.lb.removed) return null;
    const b = Object.assign({ ms: now() }, body);
    const ev = V.makeEvent(L.sk, live ? LIVE : KIND, [['t', curTopic(L)]], V.seal(curKey(L), b));
    pool.pub(ev, !live);
    if (!live) applyEv(L, { id: ev.id, pk: L.pk, at: b.ms, ep: L.lb.epoch, b, ok: true }, false);
    return ev;
}

/* ================================================================ who's online */

function myStatus() { return fc.app.status(me()) === 'off' ? 'on' : fc.app.status(me()); }
function sayHere(L, force) {
    if (!pool || !L.sk || L.lb.removed || L.lb.closed || !me()) return;
    if (!force && now() - L.lastHere < 20000) return;
    post(L, hereBody(L, 'here'), true);
}
// who we are, how we are, whether we're in its voice room
function hereBody(L, t) {
    L.lastHere = now();
    L.lastSt = myStatus();
    const inRoom = !!(vr && vr.id === L.lb.id);
    return { t, n: me(), g: myGravatar(), st: L.lastSt, v: inRoom ? 1 : 0, vs: inRoom ? vr.sid : '' };
}

function onLive(L, pk, b, at) {
    if (L.room.out.has(pk) && !(L.room.members.has(pk))) return;
    const n = typeof b.n === 'string' ? b.n.slice(0, 40) : (L.room.members.get(pk) || {}).n;
    if (b.t === 'hi' || b.t === 'here') {
        const was = L.live.get(pk);
        L.live.set(pk, { pk, n, g: b.g || '', st: b.st || 'on', v: !!b.v, vs: b.vs || '', at });
        if (b.t === 'hi' && now() - L.lastHere > 15000) timers.push(setTimeout(() => sayHere(L), 300 + Math.random() * 3000));
        if (vr && vr.id === L.lb.id && b.v && b.vs) voiceLink(pk, b.vs);
        if (vr && vr.id === L.lb.id && !b.v && vr.peers.has(pk)) closePeer(pk, true);
        if (!was || was.st !== b.st || was.v !== !!b.v) changed(L.lb.id);
        return;
    }
    if (b.t === 'bye') { L.live.delete(pk); if (vr && vr.id === L.lb.id) closePeer(pk, true); changed(L.lb.id); return; }
    if (b.t === 'come' && b.to === L.pk) { comeJoin(L, pk, b.ch); return; }
    if (vr && vr.id === L.lb.id) onVoiceMsg(L, pk, b);
}

function liveOf(L, pk, t) {
    const x = L.live.get(pk);
    return x && (t || now()) - x.at < TTL ? x : null;
}

function sweep() {
    const t = now();
    rooms.forEach(L => {
        let gone = false;
        L.live.forEach((x, pk) => { if (t - x.at > TTL) { L.live.delete(pk); gone = true; if (vr && vr.id === L.lb.id) closePeer(pk, true); } });
        if (gone) changed(L.lb.id);
        // our status changed (a match started / ended): tell the others now
        if (L.lastSt && L.lastSt !== myStatus()) sayHere(L, true);
    });
}

/* ================================================================== the lobbies */

function startLobby(lb) {
    const L = roomFor(lb);
    subscribe(L);
    timers.push(setTimeout(() => { if (pool && L.sk && !lb.removed && !lb.closed && me()) post(L, hereBody(L, 'hi'), true); }, 1500 + Math.random() * 1500));
    return L;
}

function infoBody(L, extra) {
    const lb = L.lb;
    const members = L.room.active().map(m => [m.pk, m.n, m.g]);
    if (!members.find(x => x[0] === L.pk)) members.push([L.pk, me(), myGravatar()]);
    return Object.assign({ t: 'info', id: lb.id, name: lb.name, rom: lb.rom, ch: lb.ch, epoch: lb.epoch, prev: lb.seeds.slice(0, lb.epoch), members }, extra);
}

function create(name, ch, rom) {
    if (!crypto || !V || !me()) return null;
    const seed = newSeed();
    const id = derive(seed).topic;
    const sk = memberKey(cfg.secret, id);
    const pk = V.pubkey(sk).toString('hex');
    const lb = { id, name: String(name).slice(0, 40), ch, rom, owner: pk, pre: pk.slice(0, 10), seeds: [seed], epoch: 0, joinedAt: now(), lastRead: now(), notify: 'mentions' };
    cfg.lobbies.push(lb);
    store.save();
    const L = startLobby(lb);
    post(L, infoBody(L));
    post(L, { t: 'join', n: me(), g: myGravatar() });
    renderRail();
    return lb;
}

// a code -> what the lobby says about itself, before joining (null: not found)
function lookup(code) {
    return new Promise((done) => {
        const c = decodeCode(code);
        if (!c) { done({ err: T('That isn’t a Fightcord invite code') }); return; }
        if (!pool) { done({ err: T('Not connected to the relays yet — try again in a moment') }); return; }
        const d = derive(c.seed);
        const room = Room({ pre: c.pre });
        let finished = false, joins = new Set();
        const finish = () => {
            if (finished) return;
            finished = true;
            s.close();
            clearTimeout(cap);
            if (!room.info) { done({ err: T('Couldn’t find that lobby. Check the code, or ask for a new one.') }); return; }
            if (room.closed) { done({ err: T('That lobby was closed by its owner') }); return; }
            const i = room.info;
            const replaced = room.rekeys.length > 0;
            if (replaced) { done({ err: T('That invite code was replaced. Ask for the new one.') }); return; }
            done({ c, info: i, owner: room.owner, members: room.active().length || joins.size });
        };
        const s = pool.sub([{ kinds: [KIND], '#t': [d.topic], limit: 300 }], (ev) => {
            if (!ev || typeof ev.content !== 'string') return;
            const b = V.open([d.key], ev.content);
            if (!b) return;
            if (b.t === 'join') joins.add(ev.pubkey);
            const needs = (b.t === 'info' || b.t === 'rekey') && room.isOwner(ev.pubkey);
            room.apply({ id: ev.id, pk: ev.pubkey, at: typeof b.ms === 'number' ? b.ms : ev.created_at * 1000, ep: b.t === 'info' ? +b.epoch || 0 : 0, b, ok: needs ? V.checkEvent(ev) : false });
        }, (n) => { if (n >= Math.min(2, pool.open())) setTimeout(finish, 600); });
        const cap = setTimeout(finish, 9000);
    });
}

function joinFound(found) {
    const i = found.info;
    if (!i.id || !/^[0-9a-f]{32}$/.test(i.id)) return null;
    const have = lobbyById(i.id);
    const seeds = (Array.isArray(i.prev) ? i.prev.slice() : []).concat(found.c.seed);
    if (seeds.some(x => !/^[0-9a-f]{18}$/.test(x))) return null;
    if (have) {
        // back in with a newer code (or after being removed)
        have.seeds = seeds; have.epoch = seeds.length - 1; have.removed = false; have.closed = false; have.owner = found.owner; have.pre = found.c.pre;
        const L0 = rooms.get(have.id);
        if (L0 && L0.sub) { L0.sub.close(); L0.sub = null; }
        rooms.delete(have.id);
    }
    const lb = have || { id: i.id, name: i.name || T('Lobby'), ch: i.ch, rom: i.rom, owner: found.owner, pre: found.c.pre, seeds, epoch: seeds.length - 1, joinedAt: now(), lastRead: 0, notify: 'mentions' };
    if (!have) cfg.lobbies.push(lb);
    store.save();
    const L = startLobby(lb);
    post(L, { t: 'join', n: me(), g: myGravatar() });
    renderRail();
    return lb;
}

function leave(id) {
    const L = rooms.get(id);
    leaveVoiceIf(id);
    if (L) {
        if (!L.lb.removed && !L.lb.closed) { post(L, { t: 'leave' }); post(L, { t: 'bye' }, true); }
        if (L.sub) L.sub.close();
        rooms.delete(id);
    }
    cfg.lobbies = cfg.lobbies.filter(l => l.id !== id);
    delete cache.data[id];
    store.save(); cache.save();
    if (view.id === id && view.page) view.page.close();
    renderRail();
}

// the owner: a new key for everyone except `out`
function rekey(id, out) {
    const L = rooms.get(id);
    if (!L || L.pk !== L.room.owner) return false;
    const seed = newSeed();
    const keys = {};
    L.room.active().forEach(m => { if (m.pk !== L.pk && (out || []).indexOf(m.pk) < 0) keys[m.pk] = wrapSeed(L.sk, m.pk, seed); });
    post(L, { t: 'rekey', epoch: L.lb.epoch + 1, keys, out: out || [] });
    L.lb.seeds[L.lb.epoch + 1] = seed;
    L.lb.epoch++;
    store.save();
    resubscribe(L);
    post(L, infoBody(L));
    post(L, { t: 'join', n: me(), g: myGravatar() });
    return true;
}
function kick(id, pk) {
    const L = rooms.get(id);
    if (!L || pk === L.pk) return false;
    if (vr && vr.id === id) closePeer(pk, true);
    return rekey(id, [pk]);
}
function editLobby(id, name, ch, rom) {
    const L = rooms.get(id);
    if (!L || L.pk !== L.room.owner) return false;
    L.lb.name = String(name).slice(0, 40) || L.lb.name;
    if (ch) { L.lb.ch = ch; L.lb.rom = rom; }
    store.save();
    post(L, infoBody(L));
    renderRail();
    return true;
}
function closeLobby(id) {
    const L = rooms.get(id);
    if (!L || L.pk !== L.room.owner) return false;
    post(L, infoBody(L, { closed: true }));
    leave(id);
    return true;
}

function send(id, text) {
    const L = rooms.get(id);
    const x = String(text || '').trim().slice(0, MAX_TEXT);
    if (!L || !x || L.lb.removed || L.lb.closed) return false;
    if (L.lastSend && now() - L.lastSend < 500) return false;
    L.lastSend = now();
    if (demo) { applyEv(L, { id: 'd' + now(), pk: L.pk, at: now(), ep: 0, b: { t: 'msg', x, n: me() || 'You' } }, false); return true; }
    return !!post(L, { t: 'msg', x, n: me(), g: myGravatar() });
}

/* =========================================================== unread + notifying */

function unread(L) {
    let n = 0, at = 0;
    const meName = me();
    L.room.visible().forEach(m => {
        if (m.sys || m.pk === L.pk || m.at <= (L.lb.lastRead || 0)) return;
        n++;
        if (mentions(m.x, meName)) at++;
    });
    return { n, at };
}
function markRead(id) {
    const lb = lobbyById(id);
    if (!lb) return;
    lb.lastRead = now();
    store.save();
    renderRail();
}

function notify(L, rec) {
    if (rec.pk === L.pk || rec.at < bootAt - 60000 || rec.at <= (L.lb.lastRead || 0)) return;
    const shown = view.id === L.lb.id && view.page && document.hasFocus && document.hasFocus();
    if (shown) { markRead(L.lb.id); return; }
    const m = L.room.msgs.find(x => x.id === rec.id);
    if (!m) return;
    const at = mentions(m.x, me());
    const how = L.lb.notify || 'mentions';
    if (how === 'none' || (how === 'mentions' && !at)) return;
    fc.ui.toast(T('{name} in {lobby}', { name: m.n, lobby: L.lb.name }), {
        icon: at ? 'at' : 'chat', sub: fc.fmt.short(m.x, 120),
        actions: [{ label: T('Open'), fn: () => openLobby(L.lb.id) }]
    });
    if (at) fc.sound.tone([[880, 0, .07], [1320, .08, .1]], { volume: .5 });
}

let changeT = 0;
const dirty = new Set();
function changed(id) {
    dirty.add(id);
    clearTimeout(changeT);
    changeT = setTimeout(() => {
        renderRail();
        if (view.page && dirty.has(view.id)) renderPage();
        dirty.clear();
        renderPill();
        fc.emit('lobbies:changed', {});
    }, 60);
}

/* =============================================================== challenges */

function joinGame(ch, keepView) {
    const r = fc.app.root();
    if (!r || typeof r.joinChannel !== 'function') return false;
    const prev = fc.app.activeChannelId();
    try { r.joinChannel(ch); } catch (e) { fc.log.warn('lobby join channel', e.message); return false; }
    // Fightcade may switch to the channel it joined: go back to where you were
    if (keepView && prev) setTimeout(() => { if (fc.app.activeChannelId() === ch && prev !== ch) fc.app.select(prev); }, 1200);
    return true;
}
const inGame = (name, ch) => { const u = fc.app.userInfo(name); return !!(u && u.channels.indexOf(ch) >= 0 && fc.app.channel(ch)); };
function waitFor(test, ms) {
    return new Promise(done => {
        const t0 = now();
        const tick = () => { if (test()) done(true); else if (now() - t0 > ms) done(false); else setTimeout(tick, 400); };
        tick();
    });
}

async function challenge(id, pk) {
    const L = rooms.get(id);
    const m = L && L.room.members.get(pk);
    if (!m) return;
    const ms = mod('match-screens');
    const ch = L.lb.ch;
    if (!ms || !ms.challenge) { fc.ui.toast(T('Match screens are off'), { kind: 'warning', icon: 'sword' }); return; }
    if (!ch) { fc.ui.toast(T('This lobby has no game yet'), { kind: 'warning', icon: 'sword' }); return; }
    if (!inGame(m.n, ch)) {
        if (!fc.app.channel(ch)) joinGame(ch, false);
        if (pool) post(L, { t: 'come', to: pk, ch }, true);
        const wait = fc.ui.toast(T('Getting {name} into {game}…', { name: m.n, game: shortName(ch) }), { icon: 'sword', ms: 16000 });
        const ok = await waitFor(() => inGame(m.n, ch), 15000);
        wait.close();
        if (!ok) { fc.ui.toast(T('{name} didn’t show up in {game}', { name: m.n, game: shortName(ch) }), { kind: 'warning', icon: 'sword', sub: T('They may be away, or not in Fightcade right now.') }); return; }
    }
    // Fightcade asks for the FT in the channel: show it
    if (view.page) view.page.close();
    fc.app.select(ch);
    setTimeout(() => {
        const st = ms.challenge(m.n, undefined, ch);
        if (!st.ok) fc.ui.toast(st.why || T('Couldn’t challenge'), { kind: 'warning', icon: 'sword' });
    }, 300);
}

// a member wants a set: get into the lobby's game so their challenge reaches us
function comeJoin(L, pk, ch) {
    const m = L.room.members.get(pk);
    if (!m || !ch || ch !== L.lb.ch) return;
    if (fc.app.channel(ch)) return;
    if (cfg.autoJoin) {
        joinGame(ch, true);
        fc.ui.toast(T('{name} wants a set in {game}', { name: m.n, game: shortName(ch) }), { icon: 'sword', sub: T('Joined the channel so their challenge can reach you.') });
    } else {
        fc.ui.toast(T('{name} wants a set in {game}', { name: m.n, game: shortName(ch) }), { icon: 'sword', ms: 15000,
            actions: [{ label: T('Join the channel'), fn: () => joinGame(ch, true) }, { label: T('Not now'), kind: 'sec', fn: () => {} }] });
    }
}

/* ============================================================== the voice room */

let vr = null;           // { id, sid, mic, micLevel, peers: Map pk -> { sid, pc, el, level, talking }, muted, gateSt, timer }
const rtc = () => (V && V.rtc) || null;

async function voiceJoin(id) {
    const L = rooms.get(id);
    if (!L || L.lb.removed || L.lb.closed) return;
    if (vr && vr.id === id) return;
    if (vr) voiceLeave();
    const R = rtc();
    if (!R || typeof RTCPeerConnection === 'undefined') { fc.ui.toast(T('Voice isn’t available here'), { kind: 'warning', icon: 'mic' }); return; }
    if (voiceCount(L) >= MAX_VOICE) { fc.ui.toast(T('The voice room is full ({n} people)', { n: MAX_VOICE }), { kind: 'warning', icon: 'mic' }); return; }
    const x = { id, sid: crypto.randomBytes(6).toString('hex'), peers: new Map(), muted: false, gateSt: {} };
    vr = x;
    try { x.mic = await R.getMic(); }
    catch (e) { if (vr === x) vr = null; fc.ui.toast(T('Microphone unavailable ({error})', { error: e.name || e.message }), { kind: 'danger', icon: 'mic' }); changed(id); return; }
    if (vr !== x) { x.mic.getTracks().forEach(t => t.stop()); return; }
    x.micLevel = R.meter(x.mic);
    x.timer = setInterval(voiceTick, 50);
    R.hotkey(true, 'lobby', voiceMute);
    post(L, { t: 'vj', vs: x.sid }, true);
    sayHere(L, true);
    L.live.forEach((p, pk) => { if (p.v && p.vs && liveOf(L, pk)) voiceLink(pk, p.vs); });
    fc.sound.tone([[523, 0, .07], [784, .08, .12]], { volume: .5 });
    changed(id);
}

function voiceLeave() {
    if (!vr) return;
    const x = vr;
    vr = null;
    const L = rooms.get(x.id);
    clearInterval(x.timer);
    x.peers.forEach((p, pk) => dropPeer(x, pk));
    if (x.mic) x.mic.getTracks().forEach(t => t.stop());
    if (x.micLevel && x.micLevel.stop) x.micLevel.stop();
    const R = rtc();
    if (R) R.hotkey(false, 'lobby');
    if (x.talking) fc.sound.duck(false);
    if (L) { post(L, { t: 'vl', vs: x.sid }, true); sayHere(L, true); }
    fc.sound.tone([[600, 0, .08], [400, .09, .12]], { volume: .5 });
    changed(x.id);
}
function leaveVoiceIf(id) { if (vr && vr.id === id) voiceLeave(); }

function voiceMute() {
    if (!vr) return;
    vr.muted = !vr.muted;
    fc.sound.tone(vr.muted ? [[700, 0, .07], [440, .08, .1]] : [[440, 0, .07], [700, .08, .1]], { volume: .7 });
    changed(vr.id);
}

function voiceCount(L) { let n = 0; L.live.forEach((p, pk) => { if (p.v && liveOf(L, pk)) n++; }); return n; }

// one direct line per member in the room; the smaller key calls (no glare)
function voiceLink(pk, theirSid) {
    if (!vr) return;
    const L = rooms.get(vr.id);
    if (!L || pk === L.pk) return;
    const cur = vr.peers.get(pk);
    if (cur && cur.sid === theirSid) return;
    if (cur) dropPeer(vr, pk);
    if (vr.peers.size >= MAX_VOICE - 1) return;
    const peer = { sid: theirSid, pc: null, state: 'new' };
    vr.peers.set(pk, peer);
    if (L.pk < pk) voiceOffer(L, pk, peer);
    else post(L, { t: 'vj', vs: vr.sid, to: pk }, true);         // they call: make sure they know our session
    changed(vr.id);
}

function makePeerPc(pk, peer) {
    const R = rtc(), set = R.settings();
    const pc = new RTCPeerConnection({ iceServers: R.ICE });
    peer.pc = pc;
    vr.mic.getAudioTracks().forEach(tr => pc.addTrack(tr, vr.mic));
    pc.ontrack = (e) => {
        if (!vr || vr.peers.get(pk) !== peer) return;
        const el = peer.el || (peer.el = new Audio());
        el.srcObject = e.streams[0];
        el.volume = Math.max(0, Math.min(1, +set.volume || 0.9));
        if (set.output && el.setSinkId) el.setSinkId(set.output).catch(() => {});
        el.play().catch(() => {});
        peer.level = R.meter(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
        if (!vr || vr.peers.get(pk) !== peer) return;
        peer.state = pc.connectionState;
        if (peer.state === 'failed') {
            const id = vr.id, sid = peer.sid;
            dropPeer(vr, pk);
            // once more after a moment (both sides retry; the caller's offer wins)
            setTimeout(() => { const L = rooms.get(id); const p = L && liveOf(L, pk); if (vr && vr.id === id && p && p.v && p.vs === sid && !vr.peers.has(pk)) voiceLink(pk, sid); }, 4000);
        }
        changed(vr.id);
    };
    return pc;
}

async function voiceOffer(L, pk, peer) {
    try {
        const pc = makePeerPc(pk, peer);
        await pc.setLocalDescription(await pc.createOffer());
        const sdp = await rtc().gathered(pc);
        if (vr && vr.peers.get(pk) === peer) post(L, { t: 'vo', to: pk, vs: vr.sid, ts: peer.sid, sdp: sdp.sdp }, true);
    } catch (e) { fc.log.warn('lobby voice offer', e.message); }
}

async function onVoiceMsg(L, pk, b) {
    if (b.to && b.to !== L.pk) return;
    if (b.t === 'vj' && b.vs) { voiceLink(pk, b.vs); return; }
    if (b.t === 'vl') { closePeer(pk, true); return; }
    if (b.t === 'vo' && b.ts === vr.sid && b.sdp) {
        let peer = vr.peers.get(pk);
        if (peer && peer.pc) dropPeer(vr, pk);
        if (vr.peers.size >= MAX_VOICE - 1 && !peer) return;
        peer = { sid: b.vs, pc: null, state: 'new' };
        vr.peers.set(pk, peer);
        try {
            const pc = makePeerPc(pk, peer);
            await pc.setRemoteDescription({ type: 'offer', sdp: b.sdp });
            await pc.setLocalDescription(await pc.createAnswer());
            const local = await rtc().gathered(pc);
            if (vr && vr.peers.get(pk) === peer) post(L, { t: 'va', to: pk, vs: vr.sid, ts: b.vs, sdp: local.sdp }, true);
        } catch (e) { fc.log.warn('lobby voice answer', e.message); }
        changed(vr.id);
        return;
    }
    if (b.t === 'va' && b.ts === vr.sid && b.sdp) {
        const peer = vr.peers.get(pk);
        if (peer && peer.pc && peer.sid === b.vs) { try { await peer.pc.setRemoteDescription({ type: 'answer', sdp: b.sdp }); } catch (e) { fc.log.warn('lobby voice accept', e.message); } }
    }
}

function dropPeer(x, pk) {
    const p = x.peers.get(pk);
    if (!p) return;
    x.peers.delete(pk);
    try { if (p.pc) p.pc.close(); } catch (e) { /* closed */ }
    if (p.level && p.level.stop) p.level.stop();
    if (p.el) { p.el.pause(); p.el.srcObject = null; }
}
function closePeer(pk) { if (!vr) return; dropPeer(vr, pk); changed(vr.id); }

// every 50 ms: the noise gate, who's talking (rings in the room list), music ducking
function voiceTick() {
    if (!vr || !vr.mic) return;
    const R = rtc(), set = R.settings();
    const t = now();
    const lvl = vr.micLevel ? vr.micLevel() : 0;
    const open = !vr.muted && R.gate(vr.gateSt, lvl, t, +set.gate || 0.08, 350);
    vr.mic.getAudioTracks().forEach(tr => { if (tr.enabled !== open) tr.enabled = open; });
    let any = false;
    const talking = [];
    if (open) talking.push('me');
    vr.peers.forEach((p, pk) => { const on = !!(p.level && p.level() > 0.06); if (on) { any = true; talking.push(pk); } p.talking = on; });
    if (any !== !!vr.talking) { vr.talking = any; fc.sound.duck(any); }
    const key = talking.join(',');
    if (key === vr.talkKey || typeof document === 'undefined') return;
    vr.talkKey = key;
    const L = rooms.get(vr.id);
    document.querySelectorAll('[data-vpk]').forEach(el => {
        const k = el.dataset.vpk;
        el.classList.toggle('talk', talking.indexOf(k === (L && L.pk) ? 'me' : k) >= 0);
    });
}

/* =================================================================== the rail */

function initials(name) {
    const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w.slice(0, 3).map(x => [...x][0]).join('') : [...(w[0] || '?')].slice(0, 2).join('')).toUpperCase();
}

function railHtml() {
    const icons = cfg.lobbies.map(lb => {
        const L = rooms.get(lb.id);
        const u = L ? unread(L) : { n: 0, at: 0 };
        const on = view.page && view.id === lb.id;
        const voice = vr && vr.id === lb.id;
        return `<div class="fclbIco${on ? ' on' : ''}${u.n ? ' unread' : ''}${lb.removed || lb.closed ? ' dead' : ''}" data-lb="${E(lb.id)}" title="${E(lb.name)}" style="--c:${fc.data.hashColor(lb.id)}">` +
            `<span class="in">${E(initials(lb.name))}</span><i class="lk">${fc.ui.icon(voice ? 'mic' : 'lock')}</i>${u.at ? `<b class="bd">${u.at > 9 ? '9+' : u.at}</b>` : ''}</div>`;
    }).join('');
    return `<div class="fclbSep"></div>${icons}<div class="fclbIco add" data-lb-add title="${E(T('Private lobbies (Fightcord)'))}">${fc.ui.icon('plus')}</div>`;
}
function renderRail() {
    if (typeof document === 'undefined' || !cfg) return;
    const list = document.querySelector('.mainToolbar .channelsList');
    let el = document.getElementById('fclbRail');
    if (!cfg.enabled || !list) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'fclbRail';
        el.className = 'fclbRail';
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('click', onRailClick);
    }
    if (el.parentNode !== list || list.lastElementChild !== el) list.appendChild(el);
    const html = railHtml();
    if (el.__html !== html) { el.__html = html; el.innerHTML = html; }
}
function onRailClick(e) {
    e.stopPropagation();
    const ic = e.target.closest('[data-lb]');
    if (ic) { openLobby(ic.dataset.lb); return; }
    if (e.target.closest('[data-lb-add]')) addMenu(e.target.closest('[data-lb-add]'));
}

function addMenu(anchor) {
    fc.ui.menu(anchor, [
        { label: T('Create a private lobby'), icon: 'plus', fn: () => createModal() },
        { label: T('Join with an invite code'), icon: 'link', fn: () => joinModal() }
    ], { side: 'right' });
}

/* =================================================================== modals */

function gameOptions(cur) {
    const list = fc.app.joinedChannels();
    const opts = list.map(c => `<option value="${E(c.name || c.id)}" data-rom="${E(c.gameid || '')}"${(c.name || c.id) === cur ? ' selected' : ''}>${E(shortName(c.name || c.id))}</option>`);
    if (cur && !list.find(c => (c.name || c.id) === cur)) opts.unshift(`<option value="${E(cur)}" selected>${E(shortName(cur))}</option>`);
    return opts.join('');
}

function createModal() {
    if (!crypto || !V) { fc.ui.toast(T('Private lobbies need Fightcade (they can’t run here)'), { kind: 'warning' }); return; }
    if (!fc.app.joinedChannels().length) { fc.ui.toast(T('Join a game channel first'), { sub: T('A lobby plays one game: pick it from the channels you’re in.'), kind: 'warning', icon: 'pad' }); return; }
    const act = fc.app.activeChannel();
    const body = `<div class="fclbForm">
        <label><span>${E(T('Lobby name'))}</span><input class="fc-input" data-f="name" maxlength="40" placeholder="${E(T('{name}’s lobby', { name: me() || 'My' }))}"></label>
        <label><span>${E(T('Game'))}</span><select class="fc-select" data-f="ch">${gameOptions(act && fc.app.isGameChannel(act.id) ? act.name : '')}</select></label>
        <p class="fc-note">${E(T('Invite-only: people need your code, and Fightcord, to get in. Messages are encrypted and kept on the free public relays Fightcord already uses.'))}</p></div>`;
    const m = fc.ui.modal({
        title: T('Create a private lobby'), body, width: 460,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Create'), fn: (b) => {
            const name = b.querySelector('[data-f="name"]').value.trim() || T('{name}’s lobby', { name: me() || 'My' });
            const sel = b.querySelector('[data-f="ch"]');
            const opt = sel.options[sel.selectedIndex];
            const lb = create(name, sel.value, (opt && opt.dataset.rom) || '');
            if (!lb) { fc.ui.toast(T('Couldn’t create the lobby'), { kind: 'danger' }); return false; }
            setTimeout(() => { openLobby(lb.id); inviteModal(lb.id); }, 50);
        } }]
    });
    keysInside(m.el);
    setTimeout(() => { const i = m.body.querySelector('input'); if (i) i.focus(); }, 30);
}

function joinModal(prefill) {
    if (!crypto || !V) { fc.ui.toast(T('Private lobbies need Fightcade (they can’t run here)'), { kind: 'warning' }); return; }
    const body = `<div class="fclbForm"><label><span>${E(T('Invite code'))}</span><input class="fc-input fclbCode" data-f="code" placeholder="FC-XXXXXX-XXXXXX-XXXXXX-XXXXXX" value="${E(prefill || '')}"></label>
        <div class="fclbFound"></div></div>`;
    let found = null, busy = false;
    const m = fc.ui.modal({
        title: T('Join a private lobby'), body, width: 460,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Join'), fn: (b) => {
            if (found) {
                const have = lobbyById(found.info.id);
                if (have && !have.removed && !have.closed) { setTimeout(() => openLobby(have.id), 50); return; }
                const lb = joinFound(found); if (!lb) { fc.ui.toast(T('Couldn’t join that lobby'), { kind: 'danger' }); return false; } setTimeout(() => openLobby(lb.id), 50); return; }
            if (busy) return false;
            const out = b.querySelector('.fclbFound');
            busy = true;
            out.innerHTML = `<div class="fclbLook">${E(T('Looking for the lobby…'))}</div>`;
            lookup(b.querySelector('[data-f="code"]').value).then(r => {
                busy = false;
                if (r.err) { out.innerHTML = `<div class="fclbErr">${fc.ui.icon('warn')}${E(r.err)}</div>`; return; }
                found = r;
                const have = lobbyById(r.info.id);
                out.innerHTML = `<div class="fclbHit" style="--c:${fc.data.hashColor(r.info.id)}"><span class="ico">${E(initials(r.info.name))}</span><span class="tx"><b>${E(r.info.name)}</b>` +
                    `<small>${E(shortName(r.info.ch) || T('No game'))} · ${E(fc.t.plural(r.members, '{n} member', '{n} members'))}</small></span></div>` +
                    (have && !have.removed ? `<div class="fclbLook">${E(T('You’re already in this lobby.'))}</div>` : '');
                const btn = m.el.querySelector('.fc-modal-f [data-i="1"]');
                if (btn) btn.textContent = have && !have.removed ? T('Open') : T('Join {lobby}', { lobby: fc.fmt.short(r.info.name, 22) });
            });
            return false;
        } }]
    });
    keysInside(m.el);
    m.body.querySelector('input').addEventListener('input', () => { found = null; m.body.querySelector('.fclbFound').innerHTML = ''; const btn = m.el.querySelector('.fc-modal-f [data-i="1"]'); if (btn) btn.textContent = T('Join'); });
    setTimeout(() => { const i = m.body.querySelector('input'); if (i) i.focus(); }, 30);
}

function inviteModal(id) {
    const lb = lobbyById(id);
    const L = rooms.get(id);
    if (!lb || !L) return;
    const code = demo ? 'FC-7KQ2M9-XAPV3D-HT8W1C-NB4RZE' : encodeCode(lb.seeds[lb.epoch], L.room.owner || lb.owner || L.pk);
    const m = fc.ui.modal({
        title: T('Invite people to {lobby}', { lobby: lb.name }), width: 480,
        body: `<div class="fclbInv"><p>${E(T('Send this code to people you want in. They need Fightcord: + in the server list → Join with an invite code.'))}</p>` +
            `<div class="fclbCodeBox"><code>${E(code)}</code>${fc.ui.btn('Copy', { kind: 'brand', size: 'sm', icon: 'copy', act: 'copy' })}</div>` +
            `<p class="fc-note">${E(T('Anyone with the code can join and read the chat. If it gets around, the owner can make a new one (the old one stops working).'))}</p></div>`,
        actions: [{ label: T('Done') }]
    });
    m.el.addEventListener('click', (e) => {
        if (!e.target.closest('[data-act="copy"]')) return;
        fc.ui.copy(code);
        const b = e.target.closest('[data-act="copy"]');
        b.lastChild.textContent = T('Copied');
    });
}

function editModal(id) {
    const lb = lobbyById(id);
    if (!lb) return;
    const body = `<div class="fclbForm"><label><span>${E(T('Lobby name'))}</span><input class="fc-input" data-f="name" maxlength="40" value="${E(lb.name)}"></label>
        <label><span>${E(T('Game'))}</span><select class="fc-select" data-f="ch">${gameOptions(lb.ch)}</select></label></div>`;
    const m = fc.ui.modal({
        title: T('Lobby settings'), body, width: 460,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Save'), fn: (b) => {
            const sel = b.querySelector('[data-f="ch"]');
            const opt = sel.options[sel.selectedIndex];
            editLobby(id, b.querySelector('[data-f="name"]').value.trim(), sel.value, (opt && opt.dataset.rom) || lb.rom);
            changed(id);
        } }]
    });
    keysInside(m.el);
}

// Fightcade's chat shortcuts stay out of our inputs
function keysInside(el) { el.addEventListener('keydown', (e) => e.stopPropagation()); el.addEventListener('keypress', (e) => e.stopPropagation()); }

/* =================================================================== the page */

function openLobby(id) {
    const lb = lobbyById(id);
    if (!lb) return;
    view.id = id;
    const L = roomFor(lb);
    loadOld(L);
    if (!view.page) {
        view.page = fc.ui.page('lobby', {
            title: lb.name, icon: 'lock', cls: 'fclbPage',
            tools: fc.ui.btn('Invite', { kind: 'brand', size: 'sm', icon: 'plus', act: 'lb-invite' }),
            onClose: () => { view.page = null; renderRail(); }
        });
        const el = view.page.el;
        el.addEventListener('click', onPageClick);
        el.addEventListener('keydown', onPageKey);
        el.addEventListener('keypress', (e) => e.stopPropagation());
        el.addEventListener('input', onPageInput);
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('scroll', onLogScroll, true);
    }
    view.page.setTitle(lb.name);
    view.stick = true;
    renderPage(true);
    markRead(id);
    renderRail();
    setTimeout(() => { const t = view.page && view.page.el.querySelector('.fclbIn'); if (t) t.focus(); }, 40);
}

function statusOf(L, pk) {
    if (pk === L.pk) return { on: true, st: myStatus(), v: !!(vr && vr.id === L.lb.id) };
    const x = liveOf(L, pk);
    const m = L.room.members.get(pk);
    const fcSt = m ? fc.app.status(m.n) : 'off';
    if (!x) return { on: false, st: 'off', v: false };
    return { on: true, st: fcSt === 'playing' ? 'playing' : x.st || 'on', v: !!x.v };
}
const ST_TEXT = { on: N_('Online'), away: N_('Away'), playing: N_('In a match'), off: N_('Offline') };

function when(at) {
    const d = new Date(at);
    const time = d.toLocaleTimeString(fc.t.locale ? fc.t.locale() : undefined, { hour: 'numeric', minute: '2-digit' });
    if (sameDay(at, now())) return T('Today at {time}', { time });
    if (sameDay(at, now() - 86400000)) return T('Yesterday at {time}', { time });
    return d.toLocaleDateString(fc.t.locale ? fc.t.locale() : undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + time;
}

// text -> html: escaped, links, @you highlighted
function richText(x, meName) {
    let h = E(x);
    h = h.replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a class="fclbA" data-href="${u}">${u}</a>`);
    h = h.replace(/(^|[^\w])@([^\s@<>&]{2,40})/g, (all, pre, n) => `${pre}<span class="fclbAt${lc(n) === lc(meName) ? ' me' : ''}">@${n}</span>`);
    return h.replace(/\n/g, '<br>');
}

function sideHtml(L) {
    const lb = L.lb;
    const owner = L.pk && L.pk === L.room.owner;
    const inVoice = vr && vr.id === lb.id;
    const voices = [];
    if (inVoice) voices.push({ pk: L.pk, n: me(), g: myGravatar(), self: true });
    L.live.forEach((p, pk) => { if (p.v && liveOf(L, pk) && pk !== L.pk) voices.push({ pk, n: (L.room.members.get(pk) || p).n, g: (L.room.members.get(pk) || {}).g || p.g, peer: inVoice ? vr.peers.get(pk) : null }); });
    const art = lb.rom ? fc.data.artUrl(lb.rom, 'https://web.fightcade.com/') : '';
    return `<div class="fclbHd" data-act="lb-menu"><span class="nm">${E(lb.name)}</span>${owner ? `<span class="ow" title="${E(T('You own this lobby'))}">${fc.ui.icon('star', 'fill')}</span>` : ''}${fc.ui.icon('more')}</div>` +
        `<div class="fclbGame"${art ? ` style="--art:url('${E(art)}')"` : ''}><span>${fc.ui.icon('pad')}${E(gameName(lb))}</span></div>` +
        `<div class="fclbCat">${E(T('Text'))}</div><div class="fclbCh on">${fc.ui.icon('hash')}<span>${E(T('chat'))}</span></div>` +
        `<div class="fclbCat">${E(T('Voice'))}</div>` +
        `<div class="fclbCh vc${inVoice ? ' joined' : ''}" data-act="lb-voice" title="${E(inVoice ? T('You’re in the voice room') : T('Join the voice room'))}">${fc.ui.icon('speaker')}<span>${E(T('Voice room'))}</span>${voices.length ? `<small>${voices.length}/${MAX_VOICE}</small>` : ''}</div>` +
        voices.map(v => `<div class="fclbVp" data-vpk="${E(v.pk)}">${fc.ui.avatar(v.n, { size: 24 }).replace(/src="[^"]*"/, `src="${E(fc.data.avatarUrl(v.n, v.g, 48))}"`)}<span class="nm">${E(v.n)}</span>` +
            (v.self && vr.muted ? `<i class="mu" title="${E(T('Muted'))}">${fc.ui.icon('ban')}</i>` : '') +
            (v.peer && v.peer.state !== 'connected' ? `<i class="cn" title="${E(T('Connecting…'))}">…</i>` : '') + '</div>').join('') +
        (inVoice ? `<div class="fclbVbar"><div class="tx"><b>${fc.ui.icon('wifi')}${E(T('Voice connected'))}</b><small>${E(lb.name)}</small></div>` +
            fc.ui.btn('', { kind: vr.muted ? 'danger' : 'ghost', size: 'sm', icon: 'mic', act: 'lb-mute', title: vr.muted ? T('Unmute (Ctrl+Shift+M)') : T('Mute (Ctrl+Shift+M)') }) +
            fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'logout', act: 'lb-vleave', title: T('Leave the voice room') }) + '</div>' : '');
}

function chatHtml(L) {
    const lb = L.lb;
    const meName = me();
    const dupes = L.room.dupes();
    const msgs = L.room.visible().slice(-250);
    let out = '', lastDay = '';
    const begin = `<div class="fclbHello"><div class="ic">${fc.ui.icon('hash')}</div><h2>${E(T('Welcome to {lobby}', { lobby: lb.name }))}</h2>` +
        `<p>${E(T('This is the start of the lobby. Only people with an invite code (and Fightcord) can read it.'))}</p>` +
        fc.ui.btn('Invite people', { kind: 'sec', size: 'sm', icon: 'plus', act: 'lb-invite' }) + '</div>';
    if (msgs.length < 250) out += begin;
    groups(msgs).forEach(g => {
        const day = new Date(g.at).toDateString();
        if (day !== lastDay) { lastDay = day; out += `<div class="fclbDay"><span>${E(new Date(g.at).toLocaleDateString(fc.t.locale ? fc.t.locale() : undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</span></div>`; }
        if (g.sys) {
            const txt = g.sys === 'join' ? T('{name} joined the lobby', { name: g.n }) : g.sys === 'leave' ? T('{name} left the lobby', { name: g.n }) : T('{name} was removed from the lobby', { name: g.n });
            out += `<div class="fclbSys ${g.sys}">${fc.ui.icon(g.sys === 'join' ? 'plus' : 'logout')}<span>${E(txt)}</span><time>${E(when(g.at))}</time></div>`;
            return;
        }
        const m = L.room.members.get(g.pk);
        const name = m ? m.n : g.n;
        const own = g.pk === L.room.owner;
        out += `<div class="fclbG"><span class="av" data-who="${E(g.pk)}">${fc.ui.avatar(name, { size: 40 }).replace(/src="[^"]*"/, `src="${E(fc.data.avatarUrl(name, (m && m.g) || g.g, 80))}"`)}</span><div class="bd">` +
            `<div class="hd"><b data-who="${E(g.pk)}" style="color:${fc.data.hashColor(name)}">${E(name)}</b>` +
            (own ? `<span class="ow" title="${E(T('Lobby owner'))}">${fc.ui.icon('star', 'fill')}</span>` : '') +
            (dupes.has(g.pk) ? `<span class="dup" title="${E(T('Another member uses this name too — this may not be who you think'))}">${fc.ui.icon('warn')}</span>` : '') +
            `<time>${E(when(g.at))}</time></div>` +
            g.items.map(it => `<div class="ln${mentions(it.x, meName) ? ' at' : ''}" title="${E(when(it.at))}">${richText(it.x, meName)}</div>`).join('') + '</div></div>';
    });
    return out;
}

function boxHtml(L) {
    const lb = L.lb;
    if (lb.removed) return `<div class="fclbGone">${fc.ui.icon('lock')}${E(T('You were removed from this lobby. You can still read what was said before.'))}${fc.ui.btn('Leave', { kind: 'sec', size: 'sm', act: 'lb-leave' })}</div>`;
    if (lb.closed) return `<div class="fclbGone">${fc.ui.icon('lock')}${E(T('The owner closed this lobby.'))}${fc.ui.btn('Leave', { kind: 'sec', size: 'sm', act: 'lb-leave' })}</div>`;
    return `<div class="fclbBox"><textarea class="fclbIn" rows="1" maxlength="${MAX_TEXT}" placeholder="${E(T('Message {lobby}', { lobby: lb.name }))}"></textarea></div>`;
}

function membersHtml(L) {
    const dupes = L.room.dupes();
    const list = L.room.active().map(m => Object.assign({ m }, statusOf(L, m.pk)));
    if (L.pk && !list.find(x => x.m.pk === L.pk) && !L.lb.removed) list.push(Object.assign({ m: { pk: L.pk, n: me(), g: myGravatar() } }, statusOf(L, L.pk)));
    const sort = (a, b) => (b.m.pk === L.room.owner) - (a.m.pk === L.room.owner) || lc(a.m.n).localeCompare(lc(b.m.n));
    const on = list.filter(x => x.on).sort(sort), off = list.filter(x => !x.on).sort(sort);
    const row = (x) => {
        const m = x.m, own = m.pk === L.room.owner;
        const sub = x.v ? T('In the voice room') : T(ST_TEXT[x.st] || 'Online');
        return `<div class="fclbM${x.on ? '' : ' off'}" data-who="${E(m.pk)}">` +
            fc.ui.avatar(m.n, { size: 32, status: x.on ? x.st : '' }).replace(/src="[^"]*"/, `src="${E(fc.data.avatarUrl(m.n, m.g, 64))}"`) +
            `<span class="tx"><b>${E(m.n)}${own ? `<i class="ow" title="${E(T('Lobby owner'))}">${fc.ui.icon('star', 'fill')}</i>` : ''}${dupes.has(m.pk) ? `<i class="dup" title="${E(T('Another member uses this name too — this may not be who you think'))}">${fc.ui.icon('warn')}</i>` : ''}</b>` +
            (x.on ? `<small>${x.v ? fc.ui.icon('speaker') : ''}${E(sub)}</small>` : '') + '</span></div>';
    };
    return `<div class="fclbMh">${E(T('Online — {n}', { n: on.length }))}</div>${on.map(row).join('')}` +
        (off.length ? `<div class="fclbMh">${E(T('Offline — {n}', { n: off.length }))}</div>${off.map(row).join('')}` : '');
}

function renderPage(first) {
    if (!view.page) return;
    const L = rooms.get(view.id);
    if (!L) { view.page.close(); return; }
    const body = view.page.body;
    if (!body.querySelector('.fclbWrap')) {
        body.innerHTML = `<div class="fclbWrap"><div class="fclbSide"></div><div class="fclbMain"><div class="fclbLog"></div><div class="fclbFoot"></div></div><div class="fclbMem"></div></div>`;
    }
    const set = (sel, html) => { const el = body.querySelector(sel); if (el.__html !== html) { el.__html = html; el.innerHTML = html; } return el; };
    view.page.setTitle(L.lb.name);
    set('.fclbSide', sideHtml(L));
    set('.fclbMem', membersHtml(L));
    const foot = body.querySelector('.fclbFoot');
    const want = L.lb.removed ? 'removed' : L.lb.closed ? 'closed' : 'box:' + L.lb.id;
    if (foot.__k !== want) { foot.__k = want; foot.innerHTML = boxHtml(L); }
    const log = body.querySelector('.fclbLog');
    const html = chatHtml(L) + (!L.loaded && pool ? `<div class="fclbLoad">${E(T('Loading messages…'))}</div>` : '');
    if (log.__html !== html) {
        log.__html = html;
        log.innerHTML = html;
        if (first || view.stick) log.scrollTop = log.scrollHeight;
    }
    if (view.page.el.contains(document.activeElement) || first) markReadQuiet(L);
    voiceTickClasses();
}
function markReadQuiet(L) { if (unread(L).n) { L.lb.lastRead = now(); store.save(); setTimeout(renderRail, 0); } }
function voiceTickClasses() { if (vr) vr.talkKey = null; }

function onLogScroll(e) {
    const log = e.target;
    if (!log.classList || !log.classList.contains('fclbLog')) return;
    view.stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
}

function onPageInput(e) {
    const t = e.target;
    if (!t.classList.contains('fclbIn')) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 220) + 'px';
}
function onPageKey(e) {
    e.stopPropagation();                              // Fightcade's chat shortcuts stay out
    const t = e.target;
    if (!t.classList || !t.classList.contains('fclbIn')) return;
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (send(view.id, t.value)) { t.value = ''; t.style.height = 'auto'; view.stick = true; }
    }
}

function onPageClick(e) {
    const L = rooms.get(view.id);
    if (!L) return;
    const a = e.target.closest('[data-act]');
    const act = a && a.dataset.act;
    if (act === 'lb-invite') { inviteModal(L.lb.id); return; }
    if (act === 'lb-menu') { lobbyMenu(a, L); return; }
    if (act === 'lb-voice') { if (!(vr && vr.id === L.lb.id)) voiceJoin(L.lb.id); return; }
    if (act === 'lb-mute') { voiceMute(); return; }
    if (act === 'lb-vleave') { voiceLeave(); return; }
    if (act === 'lb-leave') { leave(L.lb.id); return; }
    const link = e.target.closest('[data-href]');
    if (link) { const u = link.dataset.href; if (/^https?:\/\//.test(u)) { try { require('electron').shell.openExternal(u); } catch (err) { window.open(u, '_blank'); } } return; }
    const who = e.target.closest('[data-who]');
    if (who) memberMenu(who, L, who.dataset.who);
}

function lobbyMenu(anchor, L) {
    const lb = L.lb, owner = L.pk && L.pk === L.room.owner;
    const NOTIFY = { mentions: N_('Only @mentions'), all: N_('All messages'), none: N_('Nothing') };
    const items = [{ label: T('Invite people'), icon: 'plus', fn: () => inviteModal(lb.id) }];
    if (owner && !lb.removed && !lb.closed) {
        items.push({ label: T('Lobby settings'), icon: 'gear', fn: () => editModal(lb.id) });
        items.push({ label: T('New invite code'), icon: 'refresh', fn: () => fc.ui.confirm(T('Make a new invite code?'), T('The old code stops working for new people. Everyone already in stays in.'), { ok: T('New code') }).then(ok => { if (ok && rekey(lb.id, [])) inviteModal(lb.id); }) });
    }
    items.push({ label: T('Notify me: {what}', { what: T(NOTIFY[lb.notify || 'mentions']) }), icon: 'bell', fn: () => {
        const order = ['mentions', 'all', 'none'];
        lb.notify = order[(order.indexOf(lb.notify || 'mentions') + 1) % order.length];
        store.save();
        fc.ui.toast(T('{lobby}: notify me about {what}', { lobby: lb.name, what: lc(T(NOTIFY[lb.notify])) }), { icon: 'bell' });
    } });
    items.push('sep');
    if (owner && !lb.closed) items.push({ label: T('Close the lobby for everyone'), icon: 'trash', danger: true, fn: () => fc.ui.confirm(T('Close {lobby}?', { lobby: lb.name }), T('Nobody can write in it any more, and it leaves everyone’s list when they leave it. This can’t be undone.'), { ok: T('Close it'), danger: true }).then(ok => { if (ok) closeLobby(lb.id); }) });
    else items.push({ label: T('Leave the lobby'), icon: 'logout', danger: true, fn: () => fc.ui.confirm(T('Leave {lobby}?', { lobby: lb.name }), T('You can come back with an invite code.'), { ok: T('Leave'), danger: true }).then(ok => { if (ok) leave(lb.id); }) });
    fc.ui.menu(anchor, items);
}

function memberMenu(anchor, L, pk) {
    const m = L.room.members.get(pk) || (pk === L.pk ? { pk, n: me() } : null);
    if (!m) return;
    const owner = L.pk && L.pk === L.room.owner;
    const self = pk === L.pk;
    const items = [];
    if (!self) {
        const st = statusOf(L, pk);
        if (st.on) items.push({ label: T('Challenge in {game}', { game: fc.fmt.short(gameName(L.lb), 24) }), icon: 'sword', fn: () => challenge(L.lb.id, pk) });
    }
    const scout = mod('scout');
    if (scout && scout.openCard) items.push({ label: T('Scout card'), icon: 'search', fn: () => scout.openCard(m.n, null) });
    const box = view.page && view.page.el.querySelector('.fclbIn');
    if (!self && box) items.push({ label: T('Mention'), icon: 'at', fn: () => { box.value = '@' + m.n + ' ' + box.value; box.focus(); } });
    if (owner && !self && !L.lb.removed && !L.lb.closed) {
        items.push('sep');
        items.push({ label: T('Remove {name} from the lobby', { name: m.n }), icon: 'ban', danger: true, fn: () => fc.ui.confirm(T('Remove {name}?', { name: m.n }), T('Everyone else gets a new key automatically, so {name} can’t read anything new. Your invite code changes too.', { name: m.n }), { ok: T('Remove'), danger: true }).then(ok => { if (ok && kick(L.lb.id, pk)) fc.ui.toast(T('{name} was removed', { name: m.n }), { icon: 'ban' }); }) });
    }
    if (items.length) fc.ui.menu(anchor, items, { side: anchor.classList.contains('fclbM') ? 'left' : 'right' });
}

/* ========================================================= the header pill */

// in the channel bar while you're in a lobby's voice room (like the 1-on-1 pill)
function renderPill() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.channelToolbar .channelActions').forEach(a => {
        let p = a.querySelector('.fclbPill');
        if (!vr) { if (p) p.remove(); return; }
        const lb = lobbyById(vr.id);
        if (!p) {
            p = document.createElement('div');
            p.className = 'fcvPill fclbPill';
            p.addEventListener('mousedown', (e) => e.stopPropagation());
            p.addEventListener('click', (e) => {
                e.stopPropagation();
                const b = e.target.closest('[data-v]');
                if (!vr) return;
                if (!b) openLobby(vr.id);
                else if (b.dataset.v === 'mute') voiceMute();
                else if (b.dataset.v === 'leave') voiceLeave();
            });
            fc.ui.header.place(a, p, 'voice', 21);
        }
        const n = vr.peers.size + 1;
        const html = `<span class="ic">${fc.ui.ic('speaker')}</span><span class="tx"><b>${E(lb ? lb.name : '')}</b><small>${E(vr.muted ? T('You’re muted') : fc.t.plural(n, '{n} in voice', '{n} in voice'))}</small></span>` +
            `<span class="b" data-v="mute" title="${E(T('Mute / unmute (Ctrl+Shift+M, works in the emulator too)'))}">${fc.ui.ic(vr.muted ? 'close' : 'mic')}</span>` +
            `<span class="b x" data-v="leave" title="${E(T('Leave the voice room'))}">${fc.ui.ic('logout')}</span>`;
        p.classList.toggle('muted', !!vr.muted);
        if (p.__html !== html) { p.__html = html; p.innerHTML = html; }
    });
}

/* ==================================================================== style */

const CSS = `
.fclbRail { display: flex; flex-direction: column; align-items: center; width: 100%; padding-bottom: 8px; }
.fclbSep { width: 32px; height: 2px; margin: 4px auto 8px; border-radius: 1px; background: var(--fc-s4); }
.fclbIco { position: relative; display: flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; margin: 0 auto 8px;
    border-radius: 12px; background: var(--fc-s3); color: var(--fc-text); font: 700 13px/1 var(--fc-font); cursor: pointer; user-select: none;
    transition: background-color .15s ease-out, color .15s ease-out; }
.fclbIco:hover, .fclbIco.on { background: var(--c, var(--fc-accent)); color: #fff; }
.fclbIco .in { pointer-events: none; letter-spacing: 0; }
.fclbIco .lk { position: absolute; right: -4px; bottom: -4px; display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%;
    background: var(--fc-s1); color: var(--fc-muted); box-shadow: 0 0 0 2px var(--fc-s1); }
.fclbIco .lk .fc-ic { width: 10px; height: 10px; stroke-width: 2.6; }
.fclbIco .bd { position: absolute; right: -6px; top: -4px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px;
    background: var(--fc-danger); color: #fff; font: 700 11px/16px var(--fc-font); text-align: center; box-shadow: 0 0 0 3px var(--fc-s1); }
.fclbIco.unread::before { content: ''; position: absolute; left: -12px; top: 50%; width: 4px; height: 8px; margin-top: -4px; border-radius: 0 4px 4px 0; background: var(--fc-head); }
.fclbIco.on::before { content: ''; position: absolute; left: -12px; top: 50%; width: 4px; height: 36px; margin-top: -18px; border-radius: 0 4px 4px 0; background: var(--fc-head); }
.fclbIco.dead { opacity: .45; }
.fclbIco.add { background: var(--fc-s3); color: var(--fc-success); }
.fclbIco.add:hover { background: var(--fc-success); color: #fff; }
.fclbIco.add .fc-ic { width: 20px; height: 20px; }

#fcPage-lobby .fc-page-b { padding: 0; overflow: hidden; display: flex; }
.fclbWrap { display: flex; flex: 1; min-width: 0; min-height: 0; }
.fclbSide { flex: none; display: flex; flex-direction: column; width: 232px; background: var(--fc-s2); border-right: 1px solid var(--fc-divider); overflow: auto; }
.fclbMain { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--fc-s3); }
.fclbMem { flex: none; width: 240px; padding: 8px 8px 16px; box-sizing: border-box; background: var(--fc-s2); border-left: 1px solid var(--fc-divider); overflow: auto; }

.fclbHd { display: flex; align-items: center; height: 48px; flex: none; padding: 0 12px 0 16px; border-bottom: 1px solid var(--fc-divider); cursor: pointer; color: var(--fc-head); font: 600 15px/1 var(--fc-font); }
.fclbHd:hover { background: var(--fc-hover); }
.fclbHd .nm { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbHd .ow { display: inline-flex; margin: 0 6px; color: var(--fc-warning); }
.fclbHd .ow .fc-ic { width: 14px; height: 14px; }
.fclbHd > .fc-ic { width: 18px; height: 18px; color: var(--fc-muted); }
.fclbGame { position: relative; flex: none; height: 84px; margin: 8px; border-radius: var(--fc-r2, 8px); overflow: hidden; background: var(--fc-s1) var(--art, none) center 30% / cover; image-rendering: pixelated; }
.fclbGame::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 60%; background: linear-gradient(transparent, rgba(0,0,0,.75)); }
.fclbGame > span { position: absolute; left: 10px; right: 10px; bottom: 8px; z-index: 1; display: flex; align-items: center; color: #fff; font: 600 13px/1.2 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbGame > span .fc-ic { width: 15px; height: 15px; margin-right: 6px; flex: none; }
.fclbCat { padding: 16px 8px 4px 16px; color: var(--fc-muted); font: 600 12px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
.fclbCh { display: flex; align-items: center; height: 32px; margin: 1px 8px; padding: 0 8px; border-radius: 4px; color: var(--fc-muted); font: 500 15px/1 var(--fc-font); cursor: pointer; }
.fclbCh:hover { background: var(--fc-hover); color: var(--fc-text); }
.fclbCh.on, .fclbCh.joined { background: var(--fc-s4); color: var(--fc-head); }
.fclbCh .fc-ic { width: 18px; height: 18px; margin-right: 6px; flex: none; }
.fclbCh span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbCh small { font-size: 12px; color: var(--fc-muted); }
.fclbVp { display: flex; align-items: center; height: 30px; margin: 0 8px 0 32px; padding: 0 6px; border-radius: 4px; color: var(--fc-text); font: 500 14px/1 var(--fc-font); }
.fclbVp:hover { background: var(--fc-hover); }
.fclbVp .fc-avatar { margin-right: 8px; border-radius: 50%; transition: box-shadow .08s; }
.fclbVp.talk .fc-avatar { box-shadow: 0 0 0 2px var(--fc-success); }
.fclbVp .nm { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbVp i { font-style: normal; color: var(--fc-muted); margin-left: 4px; }
.fclbVp i.mu { color: var(--fc-danger); }
.fclbVp i .fc-ic { width: 14px; height: 14px; }
.fclbVbar { display: flex; align-items: center; margin-top: auto; padding: 8px; background: var(--fc-s1); border-top: 1px solid var(--fc-divider); }
.fclbVbar .tx { flex: 1; min-width: 0; margin-right: 4px; }
.fclbVbar .tx b { display: flex; align-items: center; color: var(--fc-success); font: 600 14px/1.2 var(--fc-font); }
.fclbVbar .tx b .fc-ic { width: 15px; height: 15px; margin-right: 5px; }
.fclbVbar .tx small { display: block; margin-top: 2px; color: var(--fc-muted); font: 12px/1.2 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbVbar .fc-btn { margin-left: 4px; }

.fclbLog { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0 16px; }
.fclbHello { padding: 32px 16px 8px; }
.fclbHello .ic { display: flex; align-items: center; justify-content: center; width: 68px; height: 68px; border-radius: 50%; background: var(--fc-s4); color: var(--fc-head); }
.fclbHello .ic .fc-ic { width: 40px; height: 40px; }
.fclbHello h2 { margin: 8px 0; color: var(--fc-head); font: 700 28px/1.2 var(--fc-font); }
.fclbHello p { margin: 0 0 12px; color: var(--fc-muted); font: 15px/1.4 var(--fc-font); }
.fclbDay { display: flex; align-items: center; margin: 24px 16px 8px; color: var(--fc-muted); font: 600 12px/1 var(--fc-font); }
.fclbDay::before, .fclbDay::after { content: ''; flex: 1; height: 1px; background: var(--fc-divider); }
.fclbDay span { padding: 0 8px; }
.fclbG { display: flex; padding: 2px 48px 2px 16px; margin-top: 16px; }
.fclbG:hover { background: var(--fc-hover); }
.fclbG .av { flex: none; margin: 2px 16px 0 0; cursor: pointer; height: 40px; }
.fclbG .bd { flex: 1; min-width: 0; }
.fclbG .hd { display: flex; align-items: baseline; margin-bottom: 2px; }
.fclbG .hd b { font: 600 15px/1.375 var(--fc-font); cursor: pointer; }
.fclbG .hd b:hover { text-decoration: underline; }
.fclbG .hd .ow, .fclbG .hd .dup { display: inline-flex; margin-left: 4px; align-self: center; }
.fclbG .hd .ow { color: var(--fc-warning); }
.fclbG .hd .dup { color: var(--fc-danger); }
.fclbG .hd .fc-ic { width: 13px; height: 13px; }
.fclbG .hd time { margin-left: 8px; color: var(--fc-muted); font: 12px/1 var(--fc-font); }
.fclbG .ln { color: var(--fc-text); font: 15px/1.375 var(--fc-font); white-space: pre-wrap; word-wrap: break-word; user-select: text; }
.fclbG .ln.at { margin: 0 -48px 0 -72px; padding: 0 48px 0 70px; border-left: 2px solid var(--fc-warning); background: rgba(240,178,50,.08); }
.fclbA { color: var(--fc-link); cursor: pointer; }
.fclbA:hover { text-decoration: underline; }
.fclbAt { padding: 0 2px; border-radius: 3px; background: var(--fc-accent-soft); color: var(--fc-head); font-weight: 500; }
.fclbAt.me { background: rgba(240,178,50,.25); }
.fclbSys { display: flex; align-items: center; margin-top: 12px; padding: 2px 16px 2px 28px; color: var(--fc-muted); font: 14px/1.375 var(--fc-font); }
.fclbSys .fc-ic { width: 16px; height: 16px; margin-right: 16px; color: var(--fc-success); }
.fclbSys.leave .fc-ic, .fclbSys.out .fc-ic { color: var(--fc-danger); }
.fclbSys time { margin-left: 8px; font-size: 12px; }
.fclbLoad { padding: 8px 16px; color: var(--fc-muted); font: 13px/1 var(--fc-font); }
.fclbFoot { flex: none; padding: 0 16px 20px; }
.fclbBox { display: flex; align-items: flex-end; padding: 0 16px; border-radius: 8px; background: var(--fc-s4); }
.fclbIn { flex: 1; min-height: 44px; max-height: 220px; padding: 11px 0; box-sizing: border-box; border: 0; outline: none; resize: none; background: transparent;
    color: var(--fc-text); font: 15px/1.375 var(--fc-font); }
.fclbIn::placeholder { color: var(--fc-muted); }
.fclbGone { display: flex; align-items: center; padding: 12px 16px; border-radius: 8px; background: var(--fc-s1); color: var(--fc-muted); font: 14px/1.3 var(--fc-font); }
.fclbGone > .fc-ic { width: 18px; height: 18px; margin-right: 10px; flex: none; }
.fclbGone .fc-btn { margin-left: auto; flex: none; }

.fclbMh { padding: 16px 8px 6px; color: var(--fc-muted); font: 600 12px/1 var(--fc-font); }
.fclbM { display: flex; align-items: center; padding: 5px 8px; margin: 1px 0; border-radius: 4px; cursor: pointer; }
.fclbM:hover { background: var(--fc-hover); }
.fclbM.off { opacity: .4; }
.fclbM.off:hover { opacity: 1; }
.fclbM .fc-avatar { margin-right: 12px; }
.fclbM .tx { flex: 1; min-width: 0; }
.fclbM .tx b { display: flex; align-items: center; color: var(--fc-text); font: 500 15px/1.25 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbM .tx b i { display: inline-flex; margin-left: 4px; font-style: normal; }
.fclbM .tx b i.ow { color: var(--fc-warning); }
.fclbM .tx b i.dup { color: var(--fc-danger); }
.fclbM .tx b .fc-ic { width: 13px; height: 13px; }
.fclbM .tx small { display: flex; align-items: center; color: var(--fc-muted); font: 12px/1.3 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbM .tx small .fc-ic { width: 12px; height: 12px; margin-right: 4px; color: var(--fc-success); }

.fclbForm label { display: block; margin-bottom: 14px; }
.fclbForm label > span { display: block; margin-bottom: 6px; color: var(--fc-muted); font: 700 12px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
.fclbForm .fc-input, .fclbForm .fc-select { width: 100%; box-sizing: border-box; }
.fclbCode { font-family: Consolas, 'Courier New', monospace !important; letter-spacing: .04em; text-transform: uppercase; }
.fclbLook { margin-top: 8px; color: var(--fc-muted); font: 13px/1.3 var(--fc-font); }
.fclbErr { display: flex; align-items: center; color: var(--fc-danger); font: 13px/1.3 var(--fc-font); }
.fclbErr .fc-ic { width: 16px; height: 16px; margin-right: 6px; flex: none; }
.fclbHit { display: flex; align-items: center; padding: 10px; border-radius: 8px; background: var(--fc-s1); }
.fclbHit .ico { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin-right: 12px; border-radius: 14px; background: var(--c); color: #fff; font: 700 15px/1 var(--fc-font); flex: none; }
.fclbHit .tx b { display: block; color: var(--fc-head); font: 600 16px/1.2 var(--fc-font); }
.fclbHit .tx small { color: var(--fc-muted); font: 13px/1.3 var(--fc-font); }
.fclbInv p { margin: 0 0 12px; color: var(--fc-text); font: 14px/1.45 var(--fc-font); }
.fclbCodeBox { display: flex; align-items: center; padding: 6px 6px 6px 12px; margin-bottom: 12px; border-radius: 8px; background: var(--fc-input); }
.fclbCodeBox code { flex: 1; color: var(--fc-head); font: 600 15px/1.2 Consolas, 'Courier New', monospace; letter-spacing: .04em; user-select: all; }
.fclbPill { cursor: pointer; }
`;

/* =================================================================== start */

function start(f) {
    fc = f;
    store = fc.config('lobbies', { enabled: true, secret: '', autoJoin: true, lobbies: [] });
    cfg = store.data;
    if (!Array.isArray(cfg.lobbies)) cfg.lobbies = [];
    cache = fc.config('lobbies-cache', {});
    try { V = require(path.join(__dirname, 'voice.js')); } catch (e) { V = null; }
    if (crypto && !/^[0-9a-f]{64}$/.test(cfg.secret)) { cfg.secret = crypto.randomBytes(32).toString('hex'); store.save(); }
    fc.ui.style('fclbStyle', CSS);
    fc.own(() => {
        voiceLeave();
        rooms.forEach(L => { if (pool && L.sk && !L.lb.removed) { try { post(L, { t: 'bye' }, true); } catch (e) { /* closing */ } } if (L.sub) L.sub.close(); });
        rooms.clear();
        timers.forEach(t => { clearTimeout(t); clearInterval(t); });
        timers = [];
        const p = pool; pool = null;
        if (p) setTimeout(() => p.close(), 400);
        if (view.page) view.page.close();
        if (typeof document !== 'undefined') {
            const r = document.getElementById('fclbRail'); if (r) r.remove();
            document.querySelectorAll('.fclbPill').forEach(x => x.remove());
        }
        fc.ui.style('fclbStyle', null);
    });
    fc.watch(renderRail, { selector: '.mainToolbar .channelsList' });
    fc.watch(renderPill, { selector: '.channelToolbar' });
    if (typeof window !== 'undefined') {
        const bye = () => rooms.forEach(L => { if (pool && L.sk && !L.lb.removed) post(L, { t: 'bye' }, true); });
        window.addEventListener('beforeunload', bye);
        fc.own(() => window.removeEventListener('beforeunload', bye));
    }
    fc.settings.section('lobbies', N_('Private lobbies'), 'lock', 76);
    fc.settings.block({
        id: 'lobbies', section: 'lobbies', title: 'Private lobbies', hint: '— invite-only lobbies for Fightcord players', store, order: 10,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Private lobbies', hint: 'Your lobbies in the server list, with a + to create or join one',
                onChange: (v) => { if (v) boot(); else { voiceLeave(); if (view.page) view.page.close(); } renderRail(); } },
            { key: 'autoJoin', type: 'switch', label: 'Join the game channel when a member challenges me', hint: 'Fightcade only lets challenges through inside a game’s channel', show: (d) => d.enabled },
            { type: 'note', label: 'Lobbies go through the same free public relays as voice chat. Messages are encrypted with a key that only exists in the invite code, and the relays keep them (encrypted) so you see what you missed. Removing someone gives everyone else a new key. The voice room goes straight between players, like voice chat.' }
        ]
    });
    boot();
    timers.push(setInterval(sweep, 30000));
    timers.push(setInterval(() => rooms.forEach(L => sayHere(L)), BEAT + Math.round(Math.random() * 20000)));
    return api;
}

function boot() {
    if (!cfg.enabled || demo) return;
    if (!pool && crypto && V && typeof WebSocket !== 'undefined') pool = Pool(RELAYS, WebSocket);
    cfg.lobbies.forEach(lb => { const L = startLobby(lb); if (!L.sub) subscribe(L); });
    renderRail();
}

/* ===================================================================== API */

const api = {
    list: () => cfg.lobbies.map(lb => ({ id: lb.id, name: lb.name, game: lb.ch, owner: !!(rooms.get(lb.id) && rooms.get(lb.id).pk === lb.owner) })),
    open: (id) => openLobby(id),
    create: (name, ch, rom) => create(name, ch, rom),
    lookup: (code) => lookup(code),
    join: (found) => joinFound(found),
    send: (id, text) => send(id, text),
    leave: (id) => leave(id),
    kick: (id, pk) => kick(id, pk),
    code: (id) => { const lb = lobbyById(id), L = rooms.get(id); return lb && L ? encodeCode(lb.seeds[lb.epoch], L.room.owner || lb.owner) : ''; },
    inVoice: () => (vr ? vr.id : ''),
    joinVoice: (id) => voiceJoin(id),
    leaveVoice: () => voiceLeave(),
    _voicePeers: () => (vr ? [...vr.peers].map(([pk, p]) => ({ pk, state: p.state })) : []),
    _me: (id) => { const L = rooms.get(id); return L ? L.pk : ''; },
    _relays: () => (pool ? pool.open() : 0),
    _room: (id) => { const L = rooms.get(id); return L ? L.room : null; },
    _invite: (id) => inviteModal(id),
    _loadOld: (id) => { const L = rooms.get(id); if (L) loadOld(L); },
    // the dev harness has no crypto / relays: a made-up lobby to draw
    _demo(o) {
        demo = true;
        const p = o || {};
        const meName = me() || 'You';
        const lb = { id: 'demo0000000000000000000000000000', name: p.name || 'Friday Night Fights', ch: p.ch || 'Street Fighter III 3rd Strike: Fight for the Future (Japan 990512, NO CD)', rom: p.rom || 'sfiii3nr1',
            owner: 'me', pre: 'me', seeds: ['0'], epoch: 0, joinedAt: now(), lastRead: now(), notify: 'mentions' };
        cfg.lobbies = [lb].concat(p.more || []);
        rooms.clear();
        const L = { lb, room: Room({ owner: 'me' }), live: new Map(), sk: null, pk: 'me', topics: new Map(), oldSubs: [], loaded: true, lastHere: 0 };
        rooms.set(lb.id, L);
        const t0 = now() - 3 * 3600000;
        const people = p.people || [['ParryKing', 'k1'], ['UrienMain', 'k2'], ['DashKaiser', 'k3'], ['OroSensei', 'k4'], ['ChunLeaf', 'k5']];
        let i = 0;
        const ev = (pk, b, at) => L.room.apply({ id: 'e' + (i++).toString().padStart(4, '0'), pk, at, ep: 0, b, ok: true });
        ev('me', { t: 'info', name: lb.name, rom: lb.rom, ch: lb.ch, epoch: 0, prev: [], members: [['me', meName, '']] }, t0);
        ev('me', { t: 'join', n: meName }, t0 + 1000);
        people.forEach(([n, pk], k) => ev(pk, { t: 'join', n }, t0 + 60000 * (k + 1)));
        (p.msgs || [
            ['k1', 'anyone up for some FT5s tonight?', 70],
            ['k2', 'yes! give me 10 min, warming up in training', 69],
            ['k2', 'my parries are rusty lol', 68.5],
            ['k3', 'I\'m in. @' + meName + ' you said you wanted the Urien rematch 👀', 60],
            ['me', 'oh it\'s happening. after this set', 58],
            ['k4', 'I\'ll hop in voice in a bit', 30],
            ['k1', 'GGs everyone, that last set was crazy', 4],
            ['k5', 'next week same time? I\'ll bring the tournament bracket https://example.com/bracket', 2]
        ]).forEach(([pk, x, minAgo]) => ev(pk, { t: 'msg', x, n: pk === 'me' ? meName : (people.find(q => q[1] === pk) || [])[0] }, now() - minAgo * 60000));
        const live = p.live || [['k1', 'on', 1], ['k2', 'playing', 0], ['k3', 'on', 1], ['k4', 'away', 0]];
        live.forEach(([pk, st, v]) => L.live.set(pk, { pk, n: (people.find(q => q[1] === pk) || [])[0], st, v: !!v, vs: v ? 'vs' + pk : '', at: now() }));
        if (p.voice) {
            vr = { id: lb.id, sid: 'me', peers: new Map(), muted: !!p.muted, gateSt: {}, mic: null };
            live.filter(x => x[2]).forEach(([pk]) => vr.peers.set(pk, { sid: 'vs' + pk, state: 'connected', talking: pk === 'k1' }));
        }
        lb.lastRead = now() - 5 * 60000;
        renderRail();
        if (p.open !== false) openLobby(lb.id);
        if (p.voice) setTimeout(() => { document.querySelectorAll('[data-vpk="k1"]').forEach(el => el.classList.add('talk')); renderPill(); }, 50);
        return lb.id;
    }
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
