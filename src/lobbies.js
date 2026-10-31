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
const MAX_GROUP = 10;                    // a group DM: you and up to 9 friends, like Discord
const TYPING_MS = 6000;                  // "is typing…" lasts this long after the last key

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

/* ============================================== your Fightcord ID + DMs (3.6, pure) */

// Your Fightcord ID: one key per install, from the same secret as your lobby keys. A friend pins it
// when they accept you. A DM is a lobby of two whose seed both sides work out alone (ECDH between the
// two IDs): nobody else can read it, and nobody else can post in it either (only those two can make
// its key, so a message that opens came from one of them).
const ID_SALT = 'fightcord-id-v1';
const idKeyOf = (secret) => memberKey(secret, ID_SALT);
const isPk = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
function dmSeed(sk, theirPk) {
    return sha('fightcord-dm-v1|' + V.ecdh(sk, Buffer.from(theirPk, 'hex')).toString('hex')).slice(0, 9).toString('hex');
}
// where requests to an ID go: relays only ever see this
const inboxTopic = (pk) => sha('fightcord-dm-v1|inbox|' + pk).toString('hex').slice(0, 32);
// a friend request (and the like) to an ID: sealed with the key only the two of you can make
function inboxEvent(sk, toPk, body) {
    return V.makeEvent(sk, KIND, [['t', inboxTopic(toPk)]], V.seal(V.ecdh(sk, Buffer.from(toPk, 'hex')), Object.assign({ ms: Date.now() }, body)));
}
// a relay event -> { id, from, at, b } | null (not for this ID, or it doesn't open: then it isn't from that key)
function openInbox(sk, myPk, ev) {
    try {
        if (!ev || ev.kind !== KIND || typeof ev.content !== 'string' || !Array.isArray(ev.tags) || !isPk(ev.pubkey)) return null;
        if ((ev.tags.find(x => x[0] === 't') || [])[1] !== inboxTopic(myPk)) return null;
        const b = V.open([V.ecdh(sk, Buffer.from(ev.pubkey, 'hex'))], ev.content);
        if (!b || typeof b.t !== 'string') return null;
        // from yourself: only the notes your other PCs leave (3.6: friends changed there; 3.8: a group DM's key)
        if (ev.pubkey === myPk && b.t !== 'sync' && b.t !== 'gi') return null;
        return { id: ev.id, from: ev.pubkey, at: sentAt(ev, b), b };
    } catch (e) { return null; }
}

/* =================================================================== a room (pure) */

// Everything a lobby's events say, in any order (history arrives shuffled across relays):
//   ev = { id, pk, at, ep, b: body, ok: signature checked, own?: the owner's info a moderator carries, raw?: the signed event }
//
// Who may do what:
//   - the owner (signed): the lobby's settings (info: name, game, look, description, welcome, moderators),
//     its pictures (art), new keys (rekey)
//   - a moderator (signed, and listed in the owner's latest info): new keys (removing someone), and an info
//     that moves the key chain on, carrying the owner's own signed info (own) so newcomers can trust it;
//     mute, nickname, pin, plan and cancel events
//   - anyone with the key: join, leave, messages (with a reply), reactions, going / not going, set results
//   - the author (signed, 3.8): an edit or a delete of their own message (a moderator can delete members' too)
//   - a DM or a group DM (flat): everyone pins; in a group anyone adds people and names it (signed)
// What needs a moderator is kept with its signer and only counted while they are one (so the order
// history arrives in doesn't matter).
const MAX_DESC = 300, MAX_WELCOME = 600, ICON_MAX = 24000, BANNER_MAX = 72000, MAX_MODS = 20;
const isKey = (x) => typeof x === 'string' && /^[0-9a-z]{1,64}$/i.test(x);
const isId = (x) => typeof x === 'string' && /^[\w-]{1,80}$/.test(x);
const clip = (x, n) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, n) : '');
const cleanImg = (x, max) => (typeof x === 'string' && x.length <= max && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(x) ? x : '');
const cleanEmoji = (x) => (typeof x === 'string' && x.trim() && x.length <= 8 && !/[<>&"'\s]/.test(x) ? x.trim() : '');
const cleanCol = (x) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x.toLowerCase() : '');
const MOD_TYPES = ['mute', 'nick', 'pin', 'evt', 'evt-x'];
// the owner's settings out of an info body
function settingsOf(b, at) {
    return {
        name: String(b.name || '').slice(0, 40), rom: b.rom || '', ch: b.ch || '', id: b.id || '',
        col: cleanCol(b.col), emo: cleanEmoji(b.emo), desc: clip(b.desc, MAX_DESC), welcome: clip(b.welcome, MAX_WELCOME),
        mods: Array.isArray(b.mods) ? b.mods.filter(isKey).slice(0, MAX_MODS) : [], closed: !!b.closed, at
    };
}
function Room(o) {
    const r = {
        owner: (o && o.owner) || '', pre: (o && o.pre) || '',
        info: null, members: new Map(), out: new Map(), msgs: [], ids: new Set(), ends: {}, rekeys: [], closed: false,
        settings: null, chain: null, ownerRaw: null, art: null,
        modEvs: [], reacts: new Map(), rsvps: new Map(), sets: new Map(), pending: [],
        flat: !!(o && o.flat), edits: new Map(), dels: new Map(), gset: {}
    };
    r.isOwner = (pk) => !!pk && (r.owner ? pk === r.owner : !!r.pre && pk.startsWith(r.pre));
    r.isMod = (pk) => !!pk && !!r.settings && r.settings.mods.indexOf(pk) >= 0 && !r.out.has(pk);
    r.canMod = (pk) => r.isOwner(pk) || r.isMod(pk);
    r.canPin = (pk) => (r.flat ? !!pk && !r.out.has(pk) : r.canMod(pk));
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
    // what the rest of the code reads as the lobby's info: the owner's settings + the latest key chain
    function setInfo() {
        const s = r.settings || {}, c = r.chain || {};
        r.info = Object.assign({}, s, { id: c.id || s.id || '', epoch: c.epoch || 0, prev: c.prev || [], at: Math.max(s.at || 0, c.at || 0) });
        r.closed = !!s.closed;
    }
    function chainFrom(b, at) {
        if (r.chain && r.chain.at > at) return false;
        r.chain = { id: b.id || '', epoch: +b.epoch || 0, prev: Array.isArray(b.prev) ? b.prev : [], at };
        return true;
    }
    // rekeys that came before we knew their signer was a moderator
    function retry() {
        const p = r.pending;
        r.pending = [];
        p.forEach(ev => { r.ids.delete(ev.id); r.apply(ev); });
    }
    // -> what changed: 'info' | 'member' | 'msg' | 'rekey' | 'look' | 'mod' | 'react' | 'event' | 'board' | ''
    r.apply = (ev) => {
        const b = ev && ev.b;
        if (!b || !ev.id || !ev.pk || r.ids.has(ev.id)) return '';
        r.ids.add(ev.id);
        const ep = ev.ep || 0;
        if (b.t === 'info') {
            if (ev.ok && r.isOwner(ev.pk)) {
                const newest = !r.settings || r.settings.at <= ev.at;
                chainFrom(b, ev.at);
                if (newest) {
                    r.owner = ev.pk;
                    r.settings = settingsOf(b, ev.at);
                    if (ev.raw) r.ownerRaw = ev.raw;
                    if (Array.isArray(b.members)) b.members.forEach(x => Array.isArray(x) && member(x[0], x[1], x[2], ev.at, ep, true));
                }
                setInfo();
                if (newest) retry();
                return newest || r.chain.at === ev.at ? 'info' : '';
            }
            // a moderator moved the key chain on (after removing someone): it carries the owner's own info
            const own = ev.own;
            if (ev.ok && own && own.b && r.isOwner(own.pk) && Array.isArray(own.b.mods) && own.b.mods.indexOf(ev.pk) >= 0) {
                if (!r.settings || r.settings.at < own.at) { r.owner = own.pk; r.settings = settingsOf(own.b, own.at); if (own.raw) r.ownerRaw = own.raw; }
                const moved = chainFrom(b, ev.at);
                if (moved && Array.isArray(b.members)) b.members.forEach(x => Array.isArray(x) && member(x[0], x[1], x[2], ev.at, ep, true));
                setInfo();
                retry();
                return moved ? 'info' : '';
            }
            return '';
        }
        if (b.t === 'rekey') {
            if (!ev.ok) return '';
            const outs = Array.isArray(b.out) ? b.out : [];
            if (!r.isOwner(ev.pk)) {
                // a moderator's: never the owner or another moderator out
                if (!r.settings) { r.pending.push(ev); return ''; }
                if (!r.isMod(ev.pk) || outs.some(pk => r.canMod(pk))) return '';
            }
            r.rekeys.push({ at: ev.at, ep, epoch: +b.epoch || 0, keys: b.keys || {}, out: outs, by: ev.pk });
            if (r.ends[ep] == null || ev.at < r.ends[ep]) r.ends[ep] = ev.at;
            outs.forEach(pk => {
                const m = r.members.get(pk);
                r.out.set(pk, ep);
                if (m) { r.members.delete(pk); push({ id: ev.id + pk.slice(0, 6), sys: 'out', pk, n: m.n, at: ev.at, ep }); }
            });
            return 'rekey';
        }
        if (b.t === 'art') {
            if (!ev.ok || !r.isOwner(ev.pk) || (r.art && r.art.at > ev.at)) return '';
            r.art = { ic: cleanImg(b.ic, ICON_MAX), bn: cleanImg(b.bn, BANNER_MAX), at: ev.at };
            return 'look';
        }
        if (MOD_TYPES.indexOf(b.t) >= 0) {
            if (!ev.ok) return '';
            r.modEvs.push({ id: ev.id, pk: ev.pk, at: ev.at, ep, b });
            if (b.t === 'pin' && b.on && isId(b.m)) push({ id: ev.id, sys: 'pin', pk: ev.pk, m: b.m, at: ev.at, ep });
            return b.t === 'evt' || b.t === 'evt-x' ? 'event' : 'mod';
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
            const item = { id: ev.id, pk: ev.pk, n: m ? m.n : String(b.n || '?').slice(0, 40), g: (m && m.g) || '', x, at: ev.at, ep };
            if (isId(b.re)) item.re = b.re;
            // 3.8: forwarded from another chat (who wrote it, when)
            if (b.fw && typeof b.fw === 'object') item.fw = { n: clip(b.fw.n, 40) || '?', at: +b.fw.at || 0 };
            push(item);
            return 'msg';
        }
        // 3.8: an author's edit / delete (the latest edit wins; whose message it is gets checked when shown)
        if (b.t === 'ed' || b.t === 'del') {
            if (!ev.ok || !isId(b.m)) return '';
            if (b.t === 'ed') {
                const x = typeof b.x === 'string' ? b.x.slice(0, MAX_TEXT) : '';
                if (!x.trim()) return '';
                let per = r.edits.get(b.m);
                if (!per) { per = new Map(); r.edits.set(b.m, per); }
                const was = per.get(ev.pk);
                if (was && was.at >= ev.at) return '';
                per.set(ev.pk, { x, at: ev.at });
            } else {
                if (!r.dels.has(b.m)) r.dels.set(b.m, []);
                r.dels.get(b.m).push({ pk: ev.pk, at: ev.at });
            }
            return 'edit';
        }
        // 3.8 group DMs: someone added a member (so a new key reaches them even before they come online)
        if (b.t === 'add') {
            if (!ev.ok || !isKey(b.pk) || r.out.has(ev.pk) || b.pk === ev.pk) return '';
            const m = member(b.pk, b.n, '', ev.at, ep);
            if (!m) return '';
            push({ id: ev.id, sys: 'add', pk: ev.pk, to: b.pk, n: m.n, at: ev.at, ep });
            return 'member';
        }
        // ... and its name / picture (any member; the newest wins)
        if (b.t === 'gset') {
            if (!ev.ok || r.out.has(ev.pk)) return '';
            const what = b.name != null ? 'name' : b.ic != null ? 'ic' : '';
            if (!what) return '';
            const v = what === 'name' ? clip(b.name, 40).trim() : cleanImg(b.ic, ICON_MAX);
            if (!r.gset[what] || r.gset[what].at < ev.at) r.gset[what] = { v, at: ev.at, pk: ev.pk };
            push({ id: ev.id, sys: 'gset', pk: ev.pk, what, v: what === 'name' ? v : '', at: ev.at, ep });
            return 'look';
        }
        if (b.t === 'react') {
            const e = cleanEmoji(b.e);
            if (!isId(b.m) || !e) return '';
            let per = r.reacts.get(b.m);
            if (!per) { per = new Map(); r.reacts.set(b.m, per); }
            const k = ev.pk + ' ' + e, was = per.get(k);
            if (was && was.at > ev.at) return '';
            const kinds = new Set([...per.values()].filter(x => x.on).map(x => x.e));
            if (!kinds.has(e) && kinds.size >= 30) return '';
            per.set(k, { pk: ev.pk, e, on: !!b.on, at: ev.at });
            return 'react';
        }
        if (b.t === 'rsvp') {
            if (!isId(b.e)) return '';
            let per = r.rsvps.get(b.e);
            if (!per) { per = new Map(); r.rsvps.set(b.e, per); }
            const was = per.get(ev.pk);
            if (was && was.at > ev.at) return '';
            per.set(ev.pk, { go: !!b.go, at: ev.at });
            return 'event';
        }
        if (b.t === 'set') {
            const w = Math.floor(+b.w), l = Math.floor(+b.l);
            if (!isId(String(b.q || '')) || !isKey(b.o) || b.o === ev.pk || !(w >= 0 && w < 100) || !(l >= 0 && l < 100) || w === l) return '';
            let reps = r.sets.get(String(b.q));
            if (!reps) { reps = []; r.sets.set(String(b.q), reps); }
            if (reps.some(x => x.pk === ev.pk) || reps.length >= 2) return '';
            reps.push({ pk: ev.pk, o: b.o, w, l, at: ev.at });
            return 'board';
        }
        return '';
    };
    // a member is in unless they left after they last said something, or were removed
    r.active = () => [...r.members.values()].filter(m => !r.out.has(m.pk) && !(m.left && m.left > m.seen));
    // what moderators did, counting only while they are one (latest per target wins)
    const modded = (type) => r.modEvs.filter(x => x.b.t === type && r.canMod(x.pk));
    // a moderator can't mute or rename the owner or another moderator (the owner can)
    const over = (x) => r.isOwner(x.pk) || !r.canMod(x.b.pk);
    r.mutes = () => modded('mute').filter(x => isKey(x.b.pk) && !r.isOwner(x.b.pk) && over(x));
    // when each member was muted: [from, until) windows (an unmute ends the open one early)
    const muteWindows = () => {
        const w = new Map();
        r.mutes().sort((a, b) => a.at - b.at).forEach(x => {
            const list = w.get(x.b.pk) || [];
            const until = +x.b.until || 0;
            if (until > x.at) list.push([x.at, until]);
            else list.forEach(v => { if (v[1] > x.at) v[1] = x.at; });
            w.set(x.b.pk, list);
        });
        return w;
    };
    r.mutedAt = (pk, at, w) => ((w || muteWindows()).get(pk) || []).some(([a, b]) => a <= at && at < b);
    // muted at `at`? -> until when (0: not muted)
    r.muteEnd = (pk, at) => ((muteWindows().get(pk) || []).filter(([a, b]) => a <= at && at < b).map(x => x[1]).sort((x, y) => y - x)[0] || 0);
    r.nick = (pk) => {
        const list = modded('nick').filter(x => x.b.pk === pk && over(x)).sort((a, b) => b.at - a.at);
        return list.length ? clip(list[0].b.n, 32).trim() : '';
    };
    r.name = (pk) => { const m = r.members.get(pk); return r.nick(pk) || (m ? m.n : ''); };
    // 3.8: deleted by its author (or by a moderator, over a member's); its latest edit by its author
    const gone = (m) => { const d = r.dels.get(m.id); return !!d && d.some(x => x.pk === m.pk || (!r.flat && r.canMod(x.pk) && !r.isOwner(m.pk) && (r.isOwner(x.pk) || !r.canMod(m.pk)))); };
    const edited = (m) => { const per = r.edits.get(m.id), e = per && per.get(m.pk); return e && e.at >= m.at ? Object.assign({}, m, { x: e.x, ed: e.at }) : m; };
    r.gone = (mid) => { const m = r.msgs.find(y => y.id === mid); return !!m && !m.sys && gone(m); };
    r.pinned = () => {
        const last = new Map();
        r.modEvs.filter(x => x.b.t === 'pin' && r.canPin(x.pk) && isId(x.b.m)).sort((a, b) => a.at - b.at).forEach(x => last.set(x.b.m, x));
        return [...last.values()].filter(x => x.b.on).sort((a, b) => b.at - a.at)
            .map(x => { const y = r.msgs.find(z => z.id === x.b.m); return { m: x.b.m, at: x.at, by: x.pk, msg: y && !gone(y) ? edited(y) : null, gone: !!y && gone(y) }; })
            .filter(x => !x.gone).slice(0, 50);
    };
    r.reactions = (mid) => {
        const per = r.reacts.get(mid);
        if (!per) return [];
        const by = new Map();
        [...per.values()].sort((a, b) => a.at - b.at).forEach(x => { if (!x.on) return; if (!by.has(x.e)) by.set(x.e, []); by.get(x.e).push(x.pk); });
        return [...by].map(([e, pks]) => ({ e, pks })).slice(0, 30);
    };
    r.events = (t) => {
        const tnow = t || Date.now();
        const gone = new Set(modded('evt-x').map(x => String(x.b.e)));
        const seen = new Set();
        return modded('evt').filter(x => isId(x.b.e) && !gone.has(x.b.e) && +x.b.when > tnow - 3 * 3600000)
            .sort((a, b) => b.at - a.at).filter(x => !seen.has(x.b.e) && seen.add(x.b.e))
            .map(x => {
                const per = r.rsvps.get(x.b.e) || new Map();
                const going = [], not = [];
                per.forEach((v, pk) => (v.go ? going : not).push(pk));
                return { e: x.b.e, title: clip(x.b.title, 80) || '?', when: +x.b.when, ft: Math.min(99, Math.max(0, Math.floor(+x.b.ft || 0))), desc: clip(x.b.desc, MAX_DESC), by: x.pk, going, not };
            }).sort((a, b) => a.when - b.when).slice(0, 20);
    };
    // the lobby's leaderboard: sets between members (both players report; if they disagree it doesn't count)
    r.board = (since) => {
        const sets = [];
        r.sets.forEach((reps) => {
            const a = reps[0];
            const winOf = (x) => (x.w > x.l ? x.pk : x.o);
            const other = reps.find(x => x.pk === a.o && x.o === a.pk);
            if (reps.length > 1 && !other) return;
            const win = winOf(a);
            if (other && winOf(other) !== win) return;
            const at = Math.min(...reps.map(x => x.at));
            if (since && at < since) return;
            if (!r.members.has(a.pk) || !r.members.has(a.o)) return;
            sets.push({ at, a: a.pk, b: a.o, win });
        });
        sets.sort((x, y) => x.at - y.at);
        const st = new Map();
        const get = (pk) => { if (!st.has(pk)) st.set(pk, { pk, w: 0, l: 0, elo: 1000, streak: 0 }); return st.get(pk); };
        sets.forEach(x => {
            const A = get(x.a), B = get(x.b), aWon = x.win === x.a;
            const ea = 1 / (1 + Math.pow(10, (B.elo - A.elo) / 400));
            A.elo += 32 * ((aWon ? 1 : 0) - ea);
            B.elo += 32 * ((aWon ? 0 : 1) - (1 - ea));
            const W = aWon ? A : B, Lo = aWon ? B : A;
            W.w++; Lo.l++;
            W.streak = W.streak > 0 ? W.streak + 1 : 1;
            Lo.streak = Lo.streak < 0 ? Lo.streak - 1 : -1;
        });
        return [...st.values()].map(x => Object.assign(x, { elo: Math.round(x.elo), sets: x.w + x.l }))
            .sort((x, y) => y.elo - x.elo || y.w - x.w || x.l - y.l);
    };
    r.king = (since) => { const b = r.board(since).find(x => x.sets >= 5); return b ? b.pk : ''; };
    // the chat as shown: an old key's messages stop where that key was replaced; muted members' messages
    // (while muted) and pins by someone no longer a moderator are left out
    r.visible = () => {
        const w = muteWindows();
        const byId = r.dels.size ? new Map(r.msgs.map(m => [m.id, m])) : null;
        return r.msgs.filter(m => (r.ends[m.ep] == null || m.at <= r.ends[m.ep] + 60000) &&
            !(m.sys === 'pin' && (!r.canPin(m.pk) || (byId && byId.get(m.m) && gone(byId.get(m.m))))) && !(!m.sys && (r.mutedAt(m.pk, m.at, w) || gone(m))))
            .map(m => (m.sys ? m : edited(m)));
    };
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

// messages -> groups like Discord: one author, nothing else in between, within 7 minutes (a reply starts its own)
function groups(msgs) {
    const out = [];
    msgs.forEach(m => {
        const g = out[out.length - 1];
        if (!m.sys && !m.re && g && !g.sys && g.pk === m.pk && m.at - g.last < 7 * 60000 && sameDay(g.last, m.at)) { g.items.push(m); g.last = m.at; }
        else out.push(m.sys ? Object.assign({ items: [m] }, m) : { pk: m.pk, n: m.n, g: m.g, at: m.at, last: m.at, re: m.re || '', items: [m] });
    });
    return out;
}
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

module.exports = {
    id: 'lobbies', name: 'Private lobbies',
    start: (f) => start(f),
    // pure parts, for the tests
    encodeCode, decodeCode, derive, memberKey, wrapSeed, unwrapSeed, Room, mentions, groups, b32, unb32, KIND, LIVE,
    idKeyOf, dmSeed, inboxTopic, inboxEvent, openInbox, cleanLinkCode,
    parseQuery: (q) => parseQuery(q), matches: (m, o, who) => matches(m, o, who), isSticker: (x) => isSticker(x),
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
const lobbiesOnly = () => cfg.lobbies.filter(lb => !lb.dm && !lb.group);
// someone in a room: a member, or (a DM) your friend even before they've written
const whoIs = (L, pk) => L.room.members.get(pk) || (L.lb.dm && pk === L.lb.dm.pk ? { pk, n: L.lb.dm.n, g: L.lb.dm.g || '' } : null);
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
    L = { lb, room: Room({ owner: lb.owner, pre: lb.pre, flat: !!(lb.dm || lb.group) }), live: new Map(), sk: null, pk: '', sub: null, oldSubs: [], lastHere: 0 };
    // a DM signs with your ID (that's the key your friend pinned); a lobby with its own key
    if (lb.dm || lb.group) { const id = myId(); if (id) { L.sk = id.sk; L.pk = id.pk; } }
    else if (crypto && V && cfg.secret) { L.sk = memberKey(cfg.secret, lb.id); L.pk = V.pubkey(L.sk).toString('hex'); }
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
    // yours: what you post from another PC (the same ID, 3.6) counts; your own live signals don't
    if (!tk || (ev.pubkey === L.pk && ev.kind === LIVE)) return;
    // a DM: only your friend's ID and yours (and the name is the one you know them by, not what the event says)
    if (L.lb.dm && ev.pubkey !== L.lb.dm.pk && ev.pubkey !== L.pk) return;
    const b = V.open([tk.key], ev.content);
    if (!b || typeof b.t !== 'string') return;
    if (L.lb.dm && typeof b.n === 'string') b.n = ev.pubkey === L.pk ? me() || b.n : L.lb.dm.n;
    const sent = typeof b.ms === 'number' && Math.abs(b.ms - ev.created_at * 1000) < 120000 ? b.ms : ev.created_at * 1000;
    if (ev.kind === LIVE) { onLive(L, ev.pubkey, b, sent); return; }
    applyEv(L, recOf(ev, b, tk.ep, (t) => { const x = L.topics.get(t); return x ? x.key : null; }), true);
}

// what needs a role (the owner's or a moderator's) has its signature checked; the rest is sealed with the key
const AUTH = ['info', 'rekey', 'art', 'mute', 'nick', 'pin', 'evt', 'evt-x', 'ed', 'del', 'add', 'gset'];
const sentAt = (ev, b) => (typeof b.ms === 'number' && Math.abs(b.ms - ev.created_at * 1000) < 120000 ? b.ms : ev.created_at * 1000);
// a relay event + its opened body -> what Room.apply takes. keyOf(topic) -> that epoch's key (or null)
function recOf(ev, b, ep, keyOf) {
    const rec = { id: ev.id, pk: ev.pubkey, at: sentAt(ev, b), ep, b, ok: AUTH.indexOf(b.t) >= 0 ? V.checkEvent(ev) : false };
    if (b.t === 'info') {
        rec.raw = ev;
        if (b.own && typeof b.own === 'object') rec.own = openOwn(b.own, b, keyOf);
    }
    return rec;
}
// the owner's signed info a moderator carries: checked, then opened with the key of the epoch it was sent in
function openOwn(own, b, keyOf) {
    try {
        if (typeof own.content !== 'string' || !Array.isArray(own.tags) || own.kind !== KIND || !V.checkEvent(own)) return null;
        const t = (own.tags.find(x => x[0] === 't') || [])[1];
        let key = t && keyOf ? keyOf(t) : null;
        if (!key && Array.isArray(b.prev)) {
            const seed = b.prev.find(x => typeof x === 'string' && /^[0-9a-f]{18}$/.test(x) && derive(x).topic === t);
            if (seed) key = derive(seed).key;
        }
        const ob = key ? V.open([key], own.content) : null;
        return ob && ob.t === 'info' ? { pk: own.pubkey, at: sentAt(own, ob), b: ob, raw: own } : null;
    } catch (e) { return null; }
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
    if (what === 'rekey' || what === 'info') onRekey(L);
    // new moderators: ask for what they posted too
    if (what === 'info' && L.sub && staff(L).join(',') !== L.staffSig) { L.sub.close(); L.sub = null; subscribe(L); }
    if (what === 'look' || what === 'info') setTimeout(renderRail, 0);
    remember(L, rec);
    if (what === 'msg' && L.typing) L.typing.delete(rec.pk);
    if (what === 'msg' && fromNet) notify(L, rec);
    // a closed DM comes back to the list with a new message
    if (what === 'msg' && (L.lb.dm || L.lb.group) && L.lb.hidden) { L.lb.hidden = false; store.save(); }
    changed(L.lb.id);
}

// keep the recent events on disk (the relays may drop old ones)
function remember(L, rec) {
    const list = cache.data[L.lb.id] || (cache.data[L.lb.id] = []);
    const x = { id: rec.id, pk: rec.pk, at: rec.at, ep: rec.ep, b: rec.b, ok: rec.ok };
    if (rec.b.t === 'info' && rec.raw && L.room.isOwner(rec.pk)) x.raw = rec.raw;
    if (rec.own) x.own = { pk: rec.own.pk, at: rec.own.at, b: rec.own.b };
    // only the newest pictures are worth keeping (they're the big ones)
    if (rec.b.t === 'art') { for (let i = list.length - 1; i >= 0; i--) if (list[i].b.t === 'art' && list[i].at <= rec.at) list.splice(i, 1); }
    if (rec.b.t === 'gset' && rec.b.ic != null) { for (let i = list.length - 1; i >= 0; i--) if (list[i].b.t === 'gset' && list[i].b.ic != null && list[i].at <= rec.at) list.splice(i, 1); }
    // a deleted message leaves this PC too
    if (rec.b.t === 'del' && L.room.gone(rec.b.m)) { for (let i = list.length - 1; i >= 0; i--) if (list[i].id === rec.b.m) list.splice(i, 1); }
    list.push(x);
    if (list.length > 400) {
        // the lobby's info, keys, pictures, members, what moderators did and set results stay: the rest is history
        const KEEP_T = ['info', 'rekey', 'join', 'art', 'mute', 'nick', 'pin', 'evt', 'evt-x', 'set', 'ed', 'del', 'add', 'gset'];
        const keep = list.filter(y => KEEP_T.indexOf(y.b.t) >= 0);
        const rest = list.filter(y => KEEP_T.indexOf(y.b.t) < 0).slice(-300);
        cache.data[L.lb.id] = keep.slice(-200).concat(rest);
    }
    cache.save();
}

// the owner handed out a new key: take ours (or find out we were removed)
function onRekey(L) {
    const lb = L.lb;
    const rk = L.room.rekeys.find(x => x.ep === lb.epoch && x.epoch === lb.epoch + 1);
    if (!rk || L.pk === (rk.by || L.room.owner)) return;
    const blob = rk.keys[L.pk];
    const seed = blob ? unwrapSeed(L.sk, rk.by || L.room.owner, blob) : null;
    if (seed) {
        lb.seeds[lb.epoch + 1] = seed;
        lb.epoch++;
        store.save();
        resubscribe(L);
        fc.log('lobbies: new key for', lb.name, 'epoch', lb.epoch);
    } else if (!lb.removed) {
        lb.removed = true;
        store.save();
        fc.ui.toast(lb.group ? T('You were removed from {group}', { group: groupName(lb) }) : T('You were removed from {lobby}', { lobby: lb.name }), { icon: 'lock', kind: 'warning' });
        leaveVoiceIf(lb.id);
    }
}

// the owner and moderators: what they posted (the picture, pins, events, nicknames) is asked for on its own,
// so a busy chat's newest 300 messages don't push it out of reach for newcomers
const staff = (L) => [L.room.owner || L.lb.owner].concat((L.room.settings || {}).mods || []).filter(x => /^[0-9a-f]{64}$/.test(x || ''));
const staffFilter = (topic, who, limit) => (who.length ? [{ kinds: [KIND], '#t': [topic], authors: who, limit }] : []);
function subscribe(L) {
    if (!pool || L.sub || L.lb.removed) return;
    const topic = curTopic(L);
    const newest = L.room.msgs.length ? L.room.msgs[L.room.msgs.length - 1].at : 0;
    const who = staff(L);
    L.staffSig = who.join(',');
    L.sub = pool.sub(() => [
        { kinds: [KIND], '#t': [topic], since: Math.floor(Math.max(now() - KEEP, newest - 3600000) / 1000), limit: 300 }
    ].concat(staffFilter(topic, who, 150), [
        { kinds: [LIVE], '#t': [topic], since: Math.floor(now() / 1000) - 30 }
    ]), (ev) => onEvent(L, ev), (n) => { if (n === 1) { L.loaded = true; changed(L.lb.id); } });
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
    const who = staff(L);
    eps.forEach(ep => {
        const topic = derive(L.lb.seeds[ep]).topic;
        const s = pool.sub([{ kinds: [KIND], '#t': [topic], limit: 200 }].concat(staffFilter(topic, who, 100)), (ev) => onEvent(L, ev), (n) => { if (n >= 2) s.close(); });
        setTimeout(() => s.close(), 15000);
    });
}

// sealed with the current key, signed with our key for this lobby
function post(L, body, live, extra) {
    if (demo) { if (!live) demoApply(L, body); return null; }
    if (!pool || !L.sk || L.lb.removed) return null;
    const b = Object.assign({ ms: now() }, body);
    const ev = V.makeEvent(L.sk, live ? LIVE : KIND, [['t', curTopic(L)]], V.seal(curKey(L), b));
    pool.pub(ev, !live);
    if (!live) applyEv(L, Object.assign({ id: ev.id, pk: L.pk, at: b.ms, ep: L.lb.epoch, b, ok: true }, b.t === 'info' ? { raw: ev } : {}, extra || {}), false);
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
    const sending = inRoom && !vr.paused;
    return { t, n: me(), g: myGravatar(), st: L.lastSt, v: inRoom ? 1 : 0, vs: inRoom ? vr.sid : '', cam: sending && vr.cam ? 1 : 0, scr: sending && vr.scr ? 1 : 0, vx: 1 };
}

function onLive(L, pk, b, at) {
    if (L.room.out.has(pk) && !(L.room.members.has(pk))) return;
    // 3.8: this Fightcord takes video lines in a call (whatever signal says so first)
    if (b.vx) { if (!L.vx) L.vx = new Set(); L.vx.add(pk); }
    const n = L.lb.dm ? L.lb.dm.n : typeof b.n === 'string' ? b.n.slice(0, 40) : (L.room.members.get(pk) || {}).n;
    // a DM call: they rang (or turned it down)
    if (L.lb.dm && b.t === 'ring' && b.to === L.pk) { ringIn(L, at); return; }
    if (L.lb.dm && b.t === 'nope' && b.to === L.pk) { ringOff(L, true); return; }
    // a group call rings everyone in it
    if (L.lb.group && b.t === 'ring' && b.all) { ringIn(L, at, pk); return; }
    // 3.8: someone is typing (shown for 6 seconds, or until their message arrives)
    if (b.t === 'typ') {
        if (now() - at > 10000) return;
        if (!L.typing) L.typing = new Map();
        L.typing.set(pk, now());
        changed(L.lb.id);
        clearTimeout(L.typT);
        L.typT = setTimeout(() => changed(L.lb.id), TYPING_MS + 200);
        return;
    }
    if (b.t === 'hi' || b.t === 'here') {
        const was = L.live.get(pk);
        L.live.set(pk, { pk, n, g: b.g || '', st: b.st || 'on', v: !!b.v, vs: b.vs || '', cam: !!b.cam, scr: !!b.scr, vx: !!b.vx, at });
        if (b.t === 'hi' && now() - L.lastHere > 15000) timers.push(setTimeout(() => sayHere(L), 300 + Math.random() * 3000));
        if (vr && vr.id === L.lb.id && b.v && b.vs) voiceLink(pk, b.vs);
        if (vr && vr.id === L.lb.id && !b.v && vr.peers.has(pk)) closePeer(pk, true);
        if (!was || was.st !== b.st || was.v !== !!b.v || was.cam !== !!b.cam || was.scr !== !!b.scr) changed(L.lb.id);
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
    const st = L.room.settings || {};
    const out = new Set(L.room.out.keys());
    const look = { col: st.col || '', emo: st.emo || '', desc: st.desc || '', welcome: st.welcome || '', mods: (st.mods || []).filter(pk => !out.has(pk)) };
    return Object.assign({ t: 'info', id: lb.id, name: lb.name, rom: lb.rom, ch: lb.ch, epoch: lb.epoch, prev: lb.seeds.slice(0, lb.epoch), members }, look, extra);
}
// a moderator's info for a new epoch: the key chain, carrying the owner's own signed info
function modInfoBody(L) {
    const lb = L.lb;
    const members = L.room.active().map(m => [m.pk, m.n, m.g]);
    if (!members.find(x => x[0] === L.pk)) members.push([L.pk, me(), myGravatar()]);
    return { t: 'info', id: lb.id, epoch: lb.epoch, prev: lb.seeds.slice(0, lb.epoch), members, own: L.room.ownerRaw };
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
        // a busy lobby: its info is further back than one page of history, so page back (up to 6 pages)
        let page = 0, got = new Set(), oldest = Infinity, s = null, cap = 0;
        const ask = () => {
            got = new Set();
            const f = { kinds: [KIND], '#t': [d.topic], limit: 300 };
            if (page) f.until = oldest;
            const pg = page;
            s = pool.sub([f], onEv, (n) => { if (n >= Math.min(2, pool.open())) setTimeout(() => more(pg), 600); });
            clearTimeout(cap);
            cap = setTimeout(finish, 9000);
        };
        const more = (pg) => {
            if (finished || pg !== page) return;
            if (!room.info && got.size >= 250 && page < 5) { s.close(); page++; ask(); return; }
            finish();
        };
        const onEv = (ev) => {
            if (!ev || typeof ev.content !== 'string') return;
            got.add(ev.id);
            if (ev.created_at < oldest) oldest = ev.created_at;
            const b = V.open([d.key], ev.content);
            if (!b) return;
            if (b.t === 'join') joins.add(ev.pubkey);
            room.apply(recOf(ev, b, b.t === 'info' ? +b.epoch || 0 : 0, (t) => (t === d.topic ? d.key : null)));
        };
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
            done({ c, info: i, owner: room.owner, members: room.active().length || joins.size, art: room.art });
        };
        ask();
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
    const was = lobbyById(id);
    if (was && was.group) fc.emit('group:left', { id });
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
    if (!L || !L.room.canMod(L.pk)) return false;
    const asMod = L.pk !== L.room.owner;
    // a moderator carries the owner's signed info into the new epoch (newcomers trust it through that)
    if (asMod && (!L.room.ownerRaw || (out || []).some(pk => L.room.canMod(pk)))) return false;
    const seed = newSeed();
    const keys = {};
    L.room.active().forEach(m => { if (m.pk !== L.pk && (out || []).indexOf(m.pk) < 0) keys[m.pk] = wrapSeed(L.sk, m.pk, seed); });
    post(L, { t: 'rekey', epoch: L.lb.epoch + 1, keys, out: out || [] });
    L.lb.seeds[L.lb.epoch + 1] = seed;
    L.lb.epoch++;
    store.save();
    resubscribe(L);
    if (asMod) post(L, modInfoBody(L), false, { own: { pk: L.room.owner, at: L.room.settings.at, b: { t: 'info', mods: L.room.settings.mods } } });
    else post(L, infoBody(L));
    post(L, { t: 'join', n: me(), g: myGravatar() });
    return true;
}
function kick(id, pk) {
    const L = rooms.get(id);
    if (!L || pk === L.pk) return false;
    if (vr && vr.id === id) closePeer(pk, true);
    return rekey(id, [pk]);
}
// the owner: { name, ch, rom, col, emo, desc, welcome, mods } (what's left out stays)
function saveSettings(id, p) {
    const L = rooms.get(id);
    if (!L || L.pk !== L.room.owner) return false;
    if (p.name != null) L.lb.name = String(p.name).slice(0, 40) || L.lb.name;
    if (p.ch) { L.lb.ch = p.ch; L.lb.rom = p.rom || ''; }
    store.save();
    const st = L.room.settings || {};
    const keep = (k) => (p[k] != null ? p[k] : st[k]);
    post(L, infoBody(L, { col: keep('col') || '', emo: keep('emo') || '', desc: String(keep('desc') || '').slice(0, 300), welcome: String(keep('welcome') || '').slice(0, 600), mods: (keep('mods') || []).slice(0, 20) }));
    renderRail();
    return true;
}
// the owner: the lobby's picture and banner (data: URLs, already small: see shrinkImage). null = leave as is
function setArt(id, ic, bn) {
    const L = rooms.get(id);
    if (!L || L.pk !== L.room.owner) return false;
    const cur = L.room.art || {};
    post(L, { t: 'art', ic: ic == null ? cur.ic || '' : ic, bn: bn == null ? cur.bn || '' : bn });
    renderRail();
    return true;
}
function setMod(id, pk, on) {
    const L = rooms.get(id);
    if (!L || L.pk !== L.room.owner || pk === L.pk) return false;
    const mods = ((L.room.settings || {}).mods || []).filter(x => x !== pk);
    if (on) mods.push(pk);
    return saveSettings(id, { mods });
}
// the owner / moderators
const canMod = (L) => !!L && !!L.pk && L.room.canMod(L.pk) && !L.lb.removed && !L.lb.closed;
function modPost(id, body) { const L = rooms.get(id); if (!canMod(L)) return false; if (demo) { demoApply(L, body); return true; } return !!post(L, body); }
const mute = (id, pk, mins) => modPost(id, { t: 'mute', pk, until: mins ? now() + mins * 60000 : 0 });
const nick = (id, pk, n) => modPost(id, { t: 'nick', pk, n: String(n || '').slice(0, 32) });
// in a DM or a group DM anyone pins (3.8); in a lobby the owner and moderators
const canPin = (L) => !!L && !!L.pk && L.room.canPin(L.pk) && !L.lb.removed && !L.lb.closed;
const pin = (id, m, on) => { const L = rooms.get(id); if (!canPin(L)) return false; if (demo) { demoApply(L, { t: 'pin', m, on: !!on }); return true; } return !!post(L, { t: 'pin', m, on: !!on }); };
function planEvent(id, o) {
    const e = 'e' + now().toString(36) + Math.random().toString(36).slice(2, 6);
    return modPost(id, { t: 'evt', e, title: String(o.title || '').slice(0, 80), when: +o.when, ft: Math.max(0, Math.min(99, Math.floor(+o.ft || 0))), desc: String(o.desc || '').slice(0, 300) }) ? e : '';
}
const cancelEvent = (id, e) => modPost(id, { t: 'evt-x', e });
// anyone in the lobby
function memberPost(id, body) {
    const L = rooms.get(id);
    if (!L || L.lb.removed || L.lb.closed) return false;
    if (demo) { demoApply(L, body); return true; }
    return !!post(L, body);
}
const react = (id, m, e, on) => memberPost(id, { t: 'react', m, e, on: !!on });
const rsvp = (id, e, go) => memberPost(id, { t: 'rsvp', e, go: !!go });
// a set against someone from a lobby, in that lobby's game: both players report it (for the leaderboard)
function reportSet(set) {
    if (!set || !set.opp || set.quark == null || set.mine == null || set.theirs == null || set.mine === set.theirs) return;
    rooms.forEach(L => {
        if (L.lb.removed || L.lb.closed || !L.sk || L.lb.dm || L.lb.group) return;
        if (L.lb.rom && set.rom && L.lb.rom !== set.rom) return;
        const opp = L.room.active().find(m => m.pk !== L.pk && lc(m.n) === lc(set.opp));
        if (opp) post(L, { t: 'set', q: String(set.quark), o: opp.pk, w: set.mine, l: set.theirs });
    });
}
// made-up pictures for the harness's demo lobby (a synthwave banner, a gradient icon)
function demoArt() {
    const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c.toDataURL('image/webp', 0.85); };
    const ic = mk(128, 128, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, h);
        gr.addColorStop(0, '#eb459e'); gr.addColorStop(1, '#5865f2');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,.16)';
        for (let k = -w; k < w; k += 24) { g.beginPath(); g.moveTo(k, h); g.lineTo(k + h, 0); g.lineTo(k + h + 10, 0); g.lineTo(k + 10, h); g.fill(); }
        g.fillStyle = '#fff'; g.font = '900 44px Segoe UI, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('FNF', w / 2, h / 2 + 2);
    });
    const bn = mk(720, 240, (g, w, h) => {
        const sky = g.createLinearGradient(0, 0, 0, 150);
        sky.addColorStop(0, '#1b0b3a'); sky.addColorStop(1, '#7b2ff7');
        g.fillStyle = sky; g.fillRect(0, 0, w, 150);
        const sun = g.createLinearGradient(0, 60, 0, 150);
        sun.addColorStop(0, '#ffd319'); sun.addColorStop(1, '#ff2975');
        g.fillStyle = sun; g.beginPath(); g.arc(w * 0.68, 150, 78, Math.PI, 0); g.fill();
        g.fillStyle = '#12062a'; g.fillRect(0, 150, w, h - 150);
        g.strokeStyle = 'rgba(235,69,158,.7)'; g.lineWidth = 2;
        for (let y = 150, d = 6; y < h; y += d, d *= 1.35) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        for (let x = -w; x <= w * 2; x += 64) { g.beginPath(); g.moveTo(w / 2 + (x - w / 2) * 0.15, 150); g.lineTo(x, h); g.stroke(); }
    });
    return { ic, bn };
}
// the harness (no relays): what a post would do
let demoN = 0;
function demoApply(L, body) { applyEv(L, { id: 'dm' + (demoN++), pk: L.pk, at: now(), ep: 0, b: Object.assign({ ms: now() }, body), ok: true }, false); }
function closeLobby(id) {
    const L = rooms.get(id);
    if (!L || L.pk !== L.room.owner) return false;
    post(L, infoBody(L, { closed: true }));
    leave(id);
    return true;
}

function send(id, text, re, fw) {
    const L = rooms.get(id);
    const x = String(text || '').trim().slice(0, MAX_TEXT);
    if (!L || !x || L.lb.removed || L.lb.closed) return false;
    if (L.lastSend && now() - L.lastSend < 500) return false;
    L.lastSend = now();
    L.typAt = 0;
    const body = Object.assign({ t: 'msg', x, n: me() || 'You', g: myGravatar() }, re ? { re } : {}, fw ? { fw: { n: String(fw.n || '').slice(0, 40), at: +fw.at || 0 } } : {});
    if (demo) { applyEv(L, { id: 'd' + now() + (demoN++), pk: L.pk, at: now(), ep: 0, b: body }, false); return true; }
    const ok = !!post(L, body);
    // a DM to someone who isn't your friend yet: the DMs module lets them know (a message request)
    if (ok && L.lb.dm) fc.emit('dm:sent', { pk: L.lb.dm.pk });
    return ok;
}

// 3.8: your own message, changed or gone (a moderator can delete members' messages in a lobby). The
// relays are asked to drop a deleted message as well (NIP-09; the ones that keep it still can't read it)
function editMsg(id, mid, text) {
    const L = rooms.get(id);
    const x = String(text || '').trim().slice(0, MAX_TEXT);
    const m = L && L.room.msgs.find(y => y.id === mid);
    if (!L || !m || m.pk !== L.pk || !x || L.lb.removed || L.lb.closed) return false;
    if (demo) { demoApply(L, { t: 'ed', m: mid, x }); return true; }
    return !!post(L, { t: 'ed', m: mid, x });
}
const canDelete = (L, m) => !!L && !!m && !m.sys && !L.lb.removed && !L.lb.closed && (m.pk === L.pk || (!L.room.flat && canMod(L) && !L.room.isOwner(m.pk) && (L.pk === L.room.owner || !L.room.canMod(m.pk))));
function deleteMsg(id, mid) {
    const L = rooms.get(id);
    const m = L && L.room.msgs.find(y => y.id === mid);
    if (!canDelete(L, m)) return false;
    if (demo) { demoApply(L, { t: 'del', m: mid }); return true; }
    if (!post(L, { t: 'del', m: mid })) return false;
    if (m.pk === L.pk && pool) pool.pub(V.makeEvent(L.sk, 5, [['e', mid], ['k', String(KIND)]], ''), true);
    return true;
}
// someone is typing: at most every few seconds, live only (the relays don't keep it)
function typing(L) {
    if (!L || demo || !pool || !L.sk || L.lb.removed || L.lb.closed || L.lb.req || (L.lb.dm && L.lb.dm.old)) return;
    if (now() - (L.typAt || 0) < 4000) return;
    L.typAt = now();
    post(L, { t: 'typ' }, true);
}

/* =========================================================== DMs + your inbox (3.6) */

const HOME = '@home';                    // the DM page's Friends view (view.id)
let ids = null;                          // your Fightcord ID: { sk, pk }
function myId() {
    if (!ids && crypto && V && cfg && /^[0-9a-f]{64}$/.test(cfg.secret || '')) { const sk = idKeyOf(cfg.secret); ids = { sk, pk: V.pubkey(sk).toString('hex') }; }
    return ids;
}
const dmOf = (pk) => (cfg ? cfg.lobbies.find(l => l.dm && l.dm.pk === pk) : null) || null;

// the DM with an ID, made the first time (o.req: a message request, not accepted yet)
function dmFor(pk, n, g, o) {
    const id = myId();
    if (!id || !isPk(pk) || pk === id.pk) return null;
    const name = String(n || '').trim().slice(0, 40);
    let lb = dmOf(pk);
    if (lb) {
        if (name && lb.dm.n !== name) { lb.dm.n = name; lb.name = name; }
        if (g && /^[0-9a-f]{1,64}$/i.test(g)) lb.dm.g = g;
        if (o && o.req === false && lb.req) lb.req = false;
        if (o && o.show) lb.hidden = false;
        store.save();
        return lb;
    }
    const seed = dmSeed(id.sk, pk);
    lb = { id: derive(seed).topic, dm: { pk, n: name || '?', g: g && /^[0-9a-f]{1,64}$/i.test(g) ? g : '' }, name: name || '?', ch: '', rom: '', owner: '', pre: '',
        seeds: [seed], epoch: 0, joinedAt: now(), lastRead: now(), notify: 'all', req: !!(o && o.req), hidden: !!(o && o.hidden) };
    cfg.lobbies.push(lb);
    store.save();
    if (pool && !demo) startLobby(lb);
    return lb;
}
// a DM gone for good (blocked, a request turned down): its history leaves this PC too
function dmDrop(pk) {
    const lb = dmOf(pk);
    if (!lb) return;
    if (vr && vr.id === lb.id) voiceLeave();
    const L = rooms.get(lb.id);
    if (L && L.sub) L.sub.close();
    rooms.delete(lb.id);
    cfg.lobbies = cfg.lobbies.filter(l => l !== lb);
    delete cache.data[lb.id];
    store.save(); cache.save();
    if (view.id === lb.id && view.page) openLobby(HOME);
    changed(lb.id);
}
// the DM list (group DMs too, 3.8): pinned ones first, then newest first. A DM's n is the name you know
// them by (nick: your nickname for them, when there is one)
const muted = (lb) => !!lb && (lb.mute === -1 || (lb.mute > 0 && lb.mute > now()));
function dmList() {
    return cfg.lobbies.filter(lb => lb.dm || lb.group).map(lb => {
        const L = rooms.get(lb.id);
        const vis = L ? L.room.visible().filter(m => !m.sys) : [];
        const last = vis[vis.length - 1];
        const base = { id: lb.id, req: !!lb.req, hidden: !!lb.hidden, unread: L ? unread(L).n : 0, top: !!lb.top, muted: muted(lb), mute: lb.mute || 0,
            at: last ? last.at : lb.joinedAt || 0, voice: !!(vr && vr.id === lb.id), typing: L ? typingNow(L) : 0 };
        base.last = last ? { x: last.x, mine: last.pk === (L && L.pk), n: L ? nameOf(L, last.pk, last.n) : last.n } : null;
        if (lb.group) {
            const people = L ? L.room.active() : [];
            return Object.assign(base, { group: true, pk: '', n: groupName(lb), g: '', old: false, members: people.length, removed: !!lb.removed, owner: !!L && L.pk === L.room.owner,
                icon: L ? groupIcon(L, 32) : '', live: L ? people.filter(m => m.pk !== L.pk && liveOf(L, m.pk)).length : 0 });
        }
        const st = L ? statusOf(L, lb.dm.pk) : { on: false, st: 'off', v: false };
        const D = mod('dms');
        return Object.assign(base, { pk: lb.dm.pk, n: lb.dm.n, nick: (D && D.nick && D.nick(lb.dm.pk)) || '', g: lb.dm.g, old: !!lb.dm.old, st });
    }).sort((a, b) => (b.top - a.top) || b.at - a.at);
}
const typingNow = (L) => (L.typing ? [...L.typing].filter(([pk, at]) => pk !== L.pk && now() - at < TYPING_MS).length : 0);

// requests (and the like) to someone's ID; theirs to you come through onInbox
let inboxSub = null, inboxFn = null;
const inboxQ = [];
function inboxSend(toPk, body) {
    const id = myId();
    if (!id || !isPk(toPk) || demo) return false;
    if (!pool) return false;
    pool.pub(inboxEvent(id.sk, toPk, Object.assign({ n: me(), g: myGravatar() }, body)), true);
    return true;
}
function subscribeInbox() {
    const id = myId();
    if (!pool || inboxSub || !id) return;
    const since = Math.floor((now() - KEEP) / 1000);
    inboxSub = pool.sub([{ kinds: [KIND], '#t': [inboxTopic(id.pk)], since, limit: 300 }], (ev) => {
        const m = openInbox(id.sk, id.pk, ev);
        if (!m) return;
        if (inboxFn) inboxFn(m); else { inboxQ.push(m); if (inboxQ.length > 300) inboxQ.shift(); }
    });
}
function onInbox(fn) { inboxFn = fn; while (fn && inboxQ.length) fn(inboxQ.shift()); }

// a call in a DM: join its voice room and ring them (a group DM: everyone in it). video: with your camera on
let ringing = null;                      // { id, toast, timer, out }: a call ringing, theirs or ours
function call(id, video) {
    const L = rooms.get(id);
    if (!L || !(L.lb.dm || L.lb.group)) return;
    voiceJoin(id, video ? { cam: true } : null);
    post(L, L.lb.group ? { t: 'ring', all: 1, v: video ? 1 : 0 } : { t: 'ring', to: L.lb.dm.pk, v: video ? 1 : 0 }, true);
    ringOff(L);
    const t = setTimeout(() => { if (ringing && ringing.id === id) ringing = null; }, 30000);
    ringing = { id, out: true, timer: t };
    changed(id);
}
function ringIn(L, at, from) {
    if (now() - at > 40000 || (vr && vr.id === L.lb.id)) return;
    const D = mod('dms');
    const who = L.lb.group ? from : L.lb.dm.pk;
    if (D && D.blocked && D.blocked(who)) return;
    if (L.lb.group && (!L.room.active().some(m => m.pk === from) || muted(L.lb))) return;
    ringOff(L);
    const id = L.lb.id, name = L.lb.group ? nameOf(L, from) : dmName(L.lb);
    const title = L.lb.group ? T('{name} is calling {group}', { name, group: groupName(L.lb) }) : T('{name} is calling you', { name });
    const toast = fc.ui.toast(title, {
        icon: 'phone', sub: T('Voice call · Fightcord'), ms: 30000, urgent: true,
        actions: [{ label: T('Join'), fn: () => { ringOff(L); openLobby(id); voiceJoin(id); } },
            { label: T('Decline'), kind: 'sec', fn: () => { ringOff(L); if (L.lb.dm) post(L, { t: 'nope', to: L.lb.dm.pk }, true); } }]
    });
    const g = L.lb.dm ? L.lb.dm.g : ((L.room.members.get(from) || {}).g || '');
    if (D && D.away) D.away(title, T('Voice call · Fightcord'), () => openLobby(id), { n: L.lb.group ? (L.room.members.get(from) || {}).n || name : L.lb.dm.n, g, tag: 'fccall-' + id });
    let n = 0;
    const ring = () => { if (!ringing || ringing.id !== id || n++ > 8) return; fc.sound.tone([[660, 0, .12], [880, .16, .12], [660, .32, .12]], { volume: .45 }); ringing.timer = setTimeout(ring, 3000); };
    ringing = { id, toast, timer: 0 };
    ring();
    setTimeout(() => { if (ringing && ringing.id === id && ringing.toast === toast) ringOff(L); }, 30000);
    changed(id);
}
function ringOff(L, declined) {
    if (!ringing || (L && ringing.id !== L.lb.id)) return;
    const r = ringing;
    ringing = null;
    clearTimeout(r.timer);
    if (r.toast && r.toast.close) r.toast.close();
    if (declined && L && L.lb.dm) fc.ui.toast(T('{name} can’t talk right now', { name: dmName(L.lb) }), { icon: 'phone' });
    if (L) changed(L.lb.id);
}

/* ===================================================== group DMs (3.8) */

// A group DM is a private lobby of up to 10 people (you and friends), signed with Fightcord IDs like a DM.
// Whoever's in it adds their friends: the key goes to them sealed in their inbox (with the older keys, so
// they read what was said before), and an "add" in the group itself so the next new key reaches them too.
// Its maker can remove people (everyone left gets a new key); anyone names it or gives it a picture.
function createGroup(people) {
    const id = myId();
    if (!id || !me() || (!demo && (!crypto || !V))) return null;
    const list = (people || []).filter(x => x && isPk(x.pk) && x.pk !== id.pk).slice(0, MAX_GROUP - 1);
    if (!list.length) return null;
    // (the harness has no crypto: a made-up id)
    const seed = demo ? (Math.random().toString(16).slice(2) + '000000000000000000').slice(0, 18) : newSeed();
    const lb = { id: demo ? 'grp' + seed : derive(seed).topic, group: true, name: '', ch: '', rom: '', owner: id.pk, pre: id.pk.slice(0, 10), seeds: [seed], epoch: 0,
        joinedAt: now(), lastRead: now(), notify: 'all' };
    cfg.lobbies.push(lb);
    store.save();
    const L = demo ? demoGroupRoom(lb) : startLobby(lb);
    post(L, infoBody(L));
    post(L, { t: 'join', n: me(), g: myGravatar() });
    list.forEach(x => addToGroup(lb.id, x));
    // your other PCs (the same ID) get it too
    if (!demo) inboxSend(id.pk, { t: 'gi', s: seed, prev: [], o: id.pk, id: lb.id, nm: '' });
    changed(lb.id);
    return lb;
}
// someone (a friend of yours) into a group you're in -> '' | why not
function addToGroup(gid, x) {
    const L = rooms.get(gid);
    if (!L || !L.lb.group || L.lb.removed || !x || !isPk(x.pk)) return T('Couldn’t add them');
    if (L.room.active().some(m => m.pk === x.pk && m.pk !== L.pk)) return T('{name} is already in the group', { name: x.n || '?' });
    if (L.room.active().length >= MAX_GROUP) return T('A group DM can have {n} people', { n: MAX_GROUP });
    post(L, { t: 'add', pk: x.pk, n: String(x.n || '').slice(0, 40) });
    if (!demo) inboxSend(x.pk, { t: 'gi', s: L.lb.seeds[L.lb.epoch], prev: L.lb.seeds.slice(0, L.lb.epoch), o: L.room.owner || L.lb.owner, id: gid, nm: (L.room.gset.name || {}).v || '' });
    return '';
}
// a friend added you (their inbox note): the group, joined. -> the group's lobby, or null
function joinGroup(p) {
    const ok18 = (x) => typeof x === 'string' && /^[0-9a-f]{18}$/.test(x);
    if (!p || !ok18(p.s) || !isPk(p.o) || !Array.isArray(p.prev) || p.prev.length > 64 || !p.prev.every(ok18)) return null;
    const seeds = p.prev.concat(p.s);
    const gid = derive(seeds[0]).topic;
    if (p.id && p.id !== gid) return null;
    let lb = lobbyById(gid);
    if (lb && !lb.group) return null;
    if (lb && !lb.removed && seeds.length - 1 <= lb.epoch) return lb;                      // already in (an old note)
    if (lb) {
        // added back after being removed: the newer keys
        lb.seeds = seeds; lb.epoch = seeds.length - 1; lb.removed = false; lb.hidden = false;
        const L0 = rooms.get(gid);
        if (L0 && L0.sub) { L0.sub.close(); L0.sub = null; }
        rooms.delete(gid);
    } else {
        lb = { id: gid, group: true, name: clip(p.nm, 40), ch: '', rom: '', owner: p.o, pre: p.o.slice(0, 10), seeds, epoch: seeds.length - 1, joinedAt: now(), lastRead: now(), notify: 'all' };
        cfg.lobbies.push(lb);
    }
    store.save();
    const L = startLobby(lb);
    loadOld(L);
    post(L, { t: 'join', n: me(), g: myGravatar() });
    changed(gid);
    return lb;
}
function renameGroup(gid, name) {
    const L = rooms.get(gid);
    if (!L || !L.lb.group || L.lb.removed) return false;
    return !!post(L, { t: 'gset', name: String(name || '').trim().slice(0, 40) });
}
function setGroupIcon(gid, ic) {
    const L = rooms.get(gid);
    if (!L || !L.lb.group || L.lb.removed) return false;
    return !!post(L, { t: 'gset', ic: ic || '' });
}
// the harness has no relays: a group made up on the spot
function demoGroupRoom(lb) {
    const L = { lb, room: Room({ owner: lb.owner, flat: true }), live: new Map(), sk: null, pk: lb.owner, topics: new Map(), oldSubs: [], loaded: true, lastHere: 0 };
    rooms.set(lb.id, L);
    return L;
}

// a friend got a new PC (and you accepted it): their old DM stays readable here, but closed
function dmRetire(pk) {
    const lb = dmOf(pk);
    if (!lb) return;
    lb.dm.old = true;
    store.save();
    if (vr && vr.id === lb.id) voiceLeave();
    changed(lb.id);
}

/* ================================================== linking another PC (3.6) */

// Your Fightcord on a second PC, with the same ID (so friends don't have to add you again): this PC
// shows a code, the other one types it, this one asks you, then sends your ID's secret, your lobbies
// and (from the DMs module) your friends. Live events only (relays pass them on, don't keep them),
// sealed with a key made from the code; the code works while its window is open.
const linkTopic = (code) => sha('fightcord-link-v1|t|' + code).toString('hex').slice(0, 32);
const linkKey = (code) => sha('fightcord-link-v1|k|' + code);
const newLinkCode = () => b32(crypto.randomBytes(8)).slice(0, 12).match(/.{4}/g).join('-');
function cleanLinkCode(s) {
    const c = String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
    return c.length === 12 ? c.match(/.{4}/g).join('-') : '';
}
function linkChannel(code, onMsg) {
    if (!pool || !crypto || !V) return null;
    const topic = linkTopic(code), key = linkKey(code), sk = crypto.randomBytes(32);
    const mine = V.pubkey(sk).toString('hex');
    const sub = pool.sub([{ kinds: [LIVE], '#t': [topic], since: Math.floor(now() / 1000) - 30 }], (ev) => {
        if (!ev || ev.pubkey === mine || typeof ev.content !== 'string') return;
        const b = V.open([key], ev.content);
        if (b && typeof b.t === 'string') onMsg(b);
    });
    return { send: (b) => pool.pub(V.makeEvent(sk, LIVE, [['t', topic]], V.seal(key, b)), false), close: () => sub.close() };
}
// this PC: offer your Fightcord. onAsk(yes): the other PC asked; call yes(extra) to send it
function linkOffer(onAsk) {
    if (demo) return { code: 'K7QM-4XPA-93RD', close() {} };          // (the harness: no relays)
    const code = newLinkCode();
    let done = false;
    const ch = linkChannel(code, (b) => {
        if (b.t !== 'ask' || done) return;
        onAsk((extra) => {
            if (done) return;
            done = true;
            const keep = cfg.lobbies.map(lb => Object.assign({}, lb));
            ch.send({ t: 'give', secret: cfg.secret, lobbies: keep, extra: extra || {} });
        });
    });
    return ch ? { code, close: () => ch.close() } : null;
}
// the other PC: ask with the code -> Promise<{ secret, lobbies, extra }> (rejects: no answer in time)
function linkAsk(text) {
    const code = cleanLinkCode(text);
    if (!code) return Promise.reject(new Error(T('That isn’t a link code')));
    return new Promise((ok, no) => {
        let t = 0, n = 0;
        const ch = linkChannel(code, (b) => {
            if (b.t !== 'give' || !/^[0-9a-f]{64}$/.test(b.secret || '') || !Array.isArray(b.lobbies)) return;
            clearTimeout(t); ch.close(); ok(b);
        });
        if (!ch) { no(new Error(T('Not connected to the relays yet — try again in a moment'))); return; }
        const ask = () => { if (n++ > 40) { ch.close(); no(new Error(T('No answer: is the code still showing on your other PC?'))); return; } ch.send({ t: 'ask' }); t = setTimeout(ask, 3000); };
        setTimeout(ask, 600);
    });
}
// take over the other PC's Fightcord: its ID, its lobbies and DMs (this PC's own are replaced)
function adopt(p) {
    if (!p || !/^[0-9a-f]{64}$/.test(p.secret || '') || !Array.isArray(p.lobbies)) return false;
    const ok = (lb) => lb && typeof lb.id === 'string' && /^[\w-]{1,80}$/.test(lb.id) && Array.isArray(lb.seeds) && lb.seeds.every(s => /^[0-9a-f]{18}$/.test(s)) &&
        (!lb.dm || isPk(lb.dm.pk));
    voiceLeave();
    rooms.forEach(L => { if (L.sub) L.sub.close(); });
    rooms.clear();
    if (inboxSub) { inboxSub.close(); inboxSub = null; }
    ids = null;
    cfg.secret = p.secret;
    cfg.lobbies = p.lobbies.filter(ok).map(lb => Object.assign({}, lb, { lastRead: Math.min(+lb.lastRead || 0, now()) }));
    Object.keys(cache.data).forEach(k => delete cache.data[k]);
    store.save(); cache.save();
    if (view.page) view.page.close();
    boot();
    renderRail();
    fc.emit('lobbies:changed', {});
    return true;
}

// Challenge from a DM: the games to pick from (theirs and yours first, then what you played lately)
function dmGames(L) {
    const out = [], add = (ch) => { if (gameCh(ch) && out.indexOf(ch) < 0) out.push(ch); };
    const u = fc.app.userInfo(L.lb.dm.n);
    const mine = fc.app.joinedChannels().map(c => c.name || c.id);
    (u && u.channels || []).forEach(ch => { if (mine.indexOf(ch) >= 0) add(ch); });
    (u && u.channels || []).forEach(add);
    mine.forEach(add);
    try { (fc.history.all() || []).slice(-60).reverse().forEach(s => add(s.channel)); } catch (e) { /* no history */ }
    return out.slice(0, 8);
}
function dmChallenge(anchor, L) {
    const games = dmGames(L);
    if (!games.length) { fc.ui.toast(T('Join a game channel first'), { icon: 'sword', sub: T('Then you can challenge {name} in it.', { name: L.lb.dm.n }) }); return; }
    fc.ui.menu(anchor, games.map(ch => ({ label: shortName(ch), icon: 'pad', fn: () => challenge(L.lb.id, L.lb.dm.pk, ch) })), { side: 'bottom' });
}

/* =========================================================== unread + notifying */

function unread(L) {
    let n = 0, at = 0;
    const meName = me();
    const mine = new Set(L.room.msgs.filter(m => m.pk === L.pk).map(m => m.id));
    L.room.visible().forEach(m => {
        if (m.sys || m.pk === L.pk || m.at <= (L.lb.lastRead || 0)) return;
        n++;
        if (mentions(m.x, meName) || (m.re && mine.has(m.re))) at++;
    });
    return { n, at };
}
function markRead(id) {
    const lb = lobbyById(id);
    if (!lb) return;
    lb.lastRead = now();
    store.save();
    renderRail();
    // the DM list (and its bubble in the rail) count unread too
    if (lb.dm || lb.group) changed(id);
}

function notify(L, rec) {
    if (rec.pk === L.pk || rec.at < bootAt - 60000 || rec.at <= (L.lb.lastRead || 0)) return;
    const shown = view.id === L.lb.id && view.page && document.hasFocus && document.hasFocus();
    if (shown) { if (view.hold !== L.lb.id) markRead(L.lb.id); return; }
    const m = L.room.msgs.find(x => x.id === rec.id);
    if (!m) return;
    // a DM: the DMs module knows your pop-up / sound settings (and keeps message requests quiet)
    if (L.lb.dm) { const D = mod('dms'); if (D && D.onMessage) D.onMessage(L.lb.dm.pk, m); return; }
    if (L.lb.group) { const D = mod('dms'); if (D && D.onGroupMessage) D.onGroupMessage(L.lb.id, m); return; }
    const re = m.re && L.room.msgs.find(x => x.id === m.re);
    const at = mentions(m.x, me()) || !!(re && re.pk === L.pk);
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
        // the DM page's list on the left shows every DM (its last message, unread, typing, muted)
        const dmPage = view.mode === 'dm' && [...dirty].some(id => { const lb = lobbyById(id); return lb && (lb.dm || lb.group); });
        if (view.page && (dirty.has(view.id) || dmPage)) renderPage();
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

async function challenge(id, pk, chosen) {
    const L = rooms.get(id);
    const m = L && whoIs(L, pk);
    if (!m) return;
    const ms = mod('match-screens');
    const ch = chosen || L.lb.ch;
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

// a member wants a set: get into the lobby's game so their challenge reaches us (a friend in a DM picks
// the game: any of Fightcade's game channels)
const gameCh = (ch) => typeof ch === 'string' && ch.length > 2 && ch.length < 200 && !/-channel$/.test(ch);
function comeJoin(L, pk, ch) {
    const m = whoIs(L, pk);
    if (!m || !gameCh(ch) || (!L.lb.dm && ch !== L.lb.ch)) return;
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

const voiceMax = (L) => (L && L.lb.group ? MAX_GROUP : MAX_VOICE);
async function voiceJoin(id, o) {
    const L = rooms.get(id);
    if (!L || L.lb.removed || L.lb.closed) return;
    if (vr && vr.id === id) { if (o && o.cam && !vr.cam) setCam(true); return; }
    if (vr) voiceLeave();
    const R = rtc();
    if (!R || typeof RTCPeerConnection === 'undefined') { fc.ui.toast(T('Voice isn’t available here'), { kind: 'warning', icon: 'mic' }); return; }
    if (voiceCount(L) >= voiceMax(L)) { fc.ui.toast(T('The voice room is full ({n} people)', { n: voiceMax(L) }), { kind: 'warning', icon: 'mic' }); return; }
    const x = { id, sid: crypto.randomBytes(6).toString('hex'), peers: new Map(), muted: false, gateSt: {}, cam: null, scr: null, paused: false, els: new Map(), focus: '' };
    vr = x;
    try { x.mic = await R.getMic(); }
    catch (e) { if (vr === x) vr = null; fc.ui.toast(T('Microphone unavailable ({error})', { error: e.name || e.message }), { kind: 'danger', icon: 'mic' }); changed(id); return; }
    if (vr !== x) { x.mic.getTracks().forEach(t => t.stop()); return; }
    x.micLevel = R.meter(x.mic);
    x.timer = setInterval(voiceTick, 50);
    R.hotkey(true, 'lobby', voiceMute);
    post(L, { t: 'vj', vs: x.sid, vx: 1 }, true);
    sayHere(L, true);
    L.live.forEach((p, pk) => { if (p.v && p.vs && liveOf(L, pk)) voiceLink(pk, p.vs); });
    fc.sound.tone([[523, 0, .07], [784, .08, .12]], { volume: .5 });
    if (o && o.cam) setCam(true);
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
    [x.cam, x.scr].forEach(s => { if (s) s.getTracks().forEach(t => t.stop()); });
    (x.els || new Map()).forEach(v => { try { v.srcObject = null; v.remove(); } catch (e) { /* gone */ } });
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
    if (vr.peers.size >= voiceMax(L) - 1) return;
    const peer = { sid: theirSid, pc: null, state: 'new' };
    vr.peers.set(pk, peer);
    if (L.pk < pk) voiceOffer(L, pk, peer);
    else post(L, { t: 'vj', vs: vr.sid, to: pk, vx: 1 }, true);  // they call: make sure they know our session
    changed(vr.id);
}

// offer: the caller's side. 3.8: two video lines (camera, screen) go in from the start, empty until
// one is on, so turning a camera on is a track swap, not a new offer. Only to a Fightcord that said it
// takes them (vx): 3.7 would play a video track in place of the call's audio
function makePeerPc(pk, peer, offer) {
    const R = rtc(), set = R.settings();
    const pc = new RTCPeerConnection({ iceServers: R.ICE });
    peer.pc = pc;
    vr.mic.getAudioTracks().forEach(tr => pc.addTrack(tr, vr.mic));
    const L = rooms.get(vr.id);
    if (offer && pc.addTransceiver && L && L.vx && L.vx.has(pk)) { try { pc.addTransceiver('video', { direction: 'sendrecv' }); pc.addTransceiver('video', { direction: 'sendrecv' }); } catch (e) { /* no video */ } }
    pc.ontrack = (e) => {
        if (!vr || vr.peers.get(pk) !== peer) return;
        if (e.track.kind === 'video') {
            const k = videoTx(pc).indexOf(e.transceiver);
            if (k < 0 || k > 1) return;
            peer.vid = peer.vid || [];
            peer.vid[k] = new MediaStream([e.track]);
            e.track.onunmute = () => { if (vr) changed(vr.id); };
            changed(vr.id);
            return;
        }
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
        if (peer.state === 'connected') sendVideo(peer);
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
        const pc = makePeerPc(pk, peer, true);
        await pc.setLocalDescription(await pc.createOffer());
        sendVideo(peer);
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
            // their video lines (3.8): ours go back on them
            videoTx(pc).forEach(t => { try { t.direction = 'sendrecv'; } catch (e) { /* stopped */ } });
            await pc.setLocalDescription(await pc.createAnswer());
            sendVideo(peer);
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

/* ============================================ 3.8: camera + screen share in a call */

// a peer line's two video lines in order: [camera, screen]
const videoTx = (pc) => (pc.getTransceivers ? pc.getTransceivers() : [])
    .filter(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video' && !t.stopped)
    .sort((a, b) => (a.mid == null ? 99 : +a.mid) - (b.mid == null ? 99 : +b.mid));
const CAM_RATE = 700000, SCR_RATE = 2500000;
// what we send on a peer's video lines right now (nothing while paused for a match)
function sendVideo(peer) {
    if (!vr || !peer || !peer.pc) return;
    const want = [vr.cam && !vr.paused ? vr.cam.getVideoTracks()[0] : null, vr.scr && !vr.paused ? vr.scr.getVideoTracks()[0] : null];
    videoTx(peer.pc).slice(0, 2).forEach((t, i) => {
        const tr = want[i] || null;
        if (t.sender.track !== tr) t.sender.replaceTrack(tr).catch(() => {});
        if (tr) capRate(t.sender, i ? SCR_RATE : CAM_RATE);
    });
}
// keep video's share of your upload small (Fightcade's netplay needs the rest)
function capRate(sender, max) {
    try {
        const p = sender.getParameters();
        if (!p.encodings || !p.encodings.length || p.encodings[0].maxBitrate === max) return;
        p.encodings[0].maxBitrate = max;
        sender.setParameters(p).catch(() => {});
    } catch (e) { /* not yet */ }
}
const videoOn = () => !!(vr && (vr.cam || vr.scr));
function videoChanged() {
    if (!vr) return;
    vr.peers.forEach(p => sendVideo(p));
    const L = rooms.get(vr.id);
    if (L) sayHere(L, true);
    changed(vr.id);
}
async function setCam(on) {
    if (!vr) return;
    const x = vr;
    if (on && !x.cam) {
        let s;
        try { s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } } }); }
        catch (e) { fc.ui.toast(T('Camera unavailable ({error})', { error: e.name || e.message }), { kind: 'danger', icon: 'video' }); return; }
        if (vr !== x) { s.getTracks().forEach(t => t.stop()); return; }
        x.cam = s;
    } else if (!on && x.cam) { x.cam.getTracks().forEach(t => t.stop()); x.cam = null; if (x.focus === 'cam:me') x.focus = ''; }
    videoChanged();
}
// a screen or a window: Electron's own picker list (Fightcade's Electron 9 has no getDisplayMedia)
async function setScreen(on) {
    if (!vr) return;
    const x = vr;
    if (!on) { if (x.scr) { x.scr.getTracks().forEach(t => t.stop()); x.scr = null; if (x.focus === 'scr:me') x.focus = ''; videoChanged(); } return; }
    let dc = null;
    try { dc = require('electron').desktopCapturer; } catch (e) { /* not Electron */ }
    if (!dc || !dc.getSources) { fc.ui.toast(T('Screen share isn’t available here'), { kind: 'warning', icon: 'screen' }); return; }
    let sources = [];
    try { sources = await dc.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }); }
    catch (e) { fc.ui.toast(T('Couldn’t list your screens ({error})', { error: e.message }), { kind: 'danger', icon: 'screen' }); return; }
    const pick = await screenPicker(sources);
    if (!pick || vr !== x) return;
    let s;
    try {
        s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: pick.id,
            maxWidth: pick.hd ? 1920 : 1280, maxHeight: pick.hd ? 1080 : 720, maxFrameRate: pick.hd ? 15 : 30 } } });
    } catch (e) { fc.ui.toast(T('Couldn’t share that ({error})', { error: e.name || e.message }), { kind: 'danger', icon: 'screen' }); return; }
    if (vr !== x) { s.getTracks().forEach(t => t.stop()); return; }
    if (x.scr) x.scr.getTracks().forEach(t => t.stop());
    x.scr = s;
    const tr = s.getVideoTracks()[0];
    if (tr) { try { tr.contentHint = pick.hd ? 'text' : 'motion'; } catch (e) { /* old */ } tr.onended = () => { if (vr === x && x.scr === s) setScreen(false); }; }
    x.focus = 'scr:me';
    videoChanged();
}
// Discord's "Screen Share" picker: Applications / Screens, and the quality
function screenPicker(sources) {
    return new Promise((done) => {
        let tab = sources.some(s => /^window:/.test(s.id)) ? 'window' : 'screen', hd = false, answered = false;
        const box = document.createElement('div');
        box.className = 'fclbScr';
        const draw = () => {
            const list = sources.filter(s => (tab === 'screen') === /^screen:/.test(s.id));
            fc.ui.setHtml(box, fc.ui.tabs([['window', N_('Applications')], ['screen', N_('Screens')]], tab) +
                `<div class="g">${list.map(s => `<div class="it" data-src="${E(s.id)}"><div class="th"><img src="${E(s.thumbnail && s.thumbnail.toDataURL ? s.thumbnail.toDataURL() : '')}" alt=""></div><span>${E(s.name)}</span></div>`).join('') ||
                    `<div class="fclbLook">${E(T('Nothing to share here'))}</div>`}</div>` +
                `<div class="q"><span>${E(T('Quality'))}</span>${fc.ui.tabs([['smooth', N_('Smoother video (720p 30)')], ['sharp', N_('Sharper text (1080p 15)')]], hd ? 'sharp' : 'smooth')}</div>` +
                `<p class="fc-note">${E(T('Sharing uses your upload. Fightcord pauses it during your matches (Settings → Private lobbies).'))}</p>`);
        };
        draw();
        box.addEventListener('click', (e) => {
            const t = e.target.closest('.fc-tab[data-tab]');
            if (t) { if (t.dataset.tab === 'smooth' || t.dataset.tab === 'sharp') hd = t.dataset.tab === 'sharp'; else tab = t.dataset.tab; draw(); return; }
            const it = e.target.closest('[data-src]');
            if (it) { answered = true; m.close(); done({ id: it.dataset.src, hd }); }
        });
        const m = fc.ui.modal({ title: T('Screen Share'), body: box, width: 640, actions: [{ label: T('Cancel'), kind: 'ghost' }], onClose: () => { if (!answered) done(null); } });
    });
}

// the call area on top of a DM / group DM (and a lobby's chat when someone's video is on): who's in the
// call, their cameras and screens, and the buttons. Video elements are made once and moved in
function callTiles(L) {
    const inCall = !!(vr && vr.id === L.lb.id);
    if (!inCall) return [];
    const tiles = [];
    const meCam = vr.cam && !vr.paused;
    tiles.push({ key: 'cam:me', pk: L.pk, n: me(), g: myGravatar(), video: meCam ? vr.cam : null, self: true, muted: vr.muted });
    vr.peers.forEach((p, pk) => {
        const lv = L.live.get(pk) || {};
        const m = whoIs(L, pk) || { n: lv.n || '?', g: lv.g || '' };
        tiles.push({ key: 'cam:' + pk, pk, n: m.n, name: nameOf(L, pk, m.n), g: m.g || lv.g || '', video: lv.cam && p.vid && p.vid[0] ? p.vid[0] : null, wait: p.state !== 'connected' });
        if (lv.scr && p.vid && p.vid[1]) tiles.push({ key: 'scr:' + pk, pk, n: m.n, name: nameOf(L, pk, m.n), g: m.g || '', video: p.vid[1], screen: true });
    });
    if (vr.scr && !vr.paused) tiles.push({ key: 'scr:me', pk: L.pk, n: me(), name: me(), g: myGravatar(), video: vr.scr, screen: true, self: true });
    return tiles;
}
function renderStage(el, L) {
    if (!el) return;
    const tiles = callTiles(L);
    const dmLike = !!(L.lb.dm || L.lb.group);
    // a lobby's voice room has its own list on the left: the stage only for video
    if (!tiles.length || (!dmLike && !tiles.some(t => t.video))) { if (el.__fcHtml) fc.ui.setHtml(el, ''); el.classList.remove('on', 'vid'); return; }
    if (!vr.els) vr.els = new Map();
    if (vr.focus && !tiles.some(t => t.key === vr.focus && t.video)) vr.focus = '';
    const any = tiles.some(t => t.video);
    const big = vr.focus ? tiles.find(t => t.key === vr.focus) : null;
    const tile = (t, cls) => `<div class="tile${t.video ? ' v' : ''}${t.screen ? ' scr' : ''}${cls ? ' ' + cls : ''}" data-cb="focus" data-tile="${E(t.key)}">` +
        (t.video ? `<div class="vs" data-vs="${E(t.key)}"></div>` : `<span class="av" data-vpk="${E(t.self ? L.pk : t.pk)}">${avatarOf(t.n, t.g, cls === 'mini' ? 40 : 80)}</span>`) +
        `<span class="nm">${t.screen ? fc.ui.icon('screen') : ''}${E(t.screen ? T('{name}’s screen', { name: t.name || t.n }) : (t.name || t.n))}${t.muted ? fc.ui.icon('ban') : ''}${t.wait ? ' …' : ''}</span>` +
        (t.video ? `<span class="fs" data-cb="full" data-tile="${E(t.key)}" title="${E(T('Full screen'))}">${fc.ui.icon('expand')}</span>` : '') + '</div>';
    const btn = (k, icon, on, title, cls) => `<span class="cbb${on ? ' on' : ''}${cls ? ' ' + cls : ''}" data-cb="${k}" title="${E(title)}">${fc.ui.icon(icon)}</span>`;
    const bar = `<div class="bar">` +
        btn('mute', 'mic', vr.muted, vr.muted ? T('Unmute (Ctrl+Shift+M)') : T('Mute (Ctrl+Shift+M)'), vr.muted ? 'bad' : '') +
        btn('cam', vr.cam ? 'video' : 'videoOff', !!vr.cam, vr.cam ? T('Turn off camera') : T('Turn on camera')) +
        btn('scr', 'screen', !!vr.scr, vr.scr ? T('Stop sharing') : T('Share your screen')) +
        btn('leave', 'phoneOff', false, T('Leave the call'), 'end') + '</div>' +
        (vr.paused ? `<div class="paused">${fc.ui.icon('pause')}${E(T('Your camera and screen are paused while you’re in a match'))}</div>` : '');
    const html = big
        ? `<div class="focus">${tile(big, 'big')}</div><div class="strip">${tiles.filter(t => t !== big).map(t => tile(t, 'mini')).join('')}</div>${bar}`
        : `<div class="grid n${Math.min(tiles.length, 6)}">${tiles.map(t => tile(t)).join('')}</div>${bar}`;
    el.classList.add('on');
    el.classList.toggle('vid', any);
    el.classList.toggle('big', !!big);
    fc.ui.setHtml(el, html);
    // the video elements, into their slots
    const live = new Set();
    tiles.filter(t => t.video).forEach(t => {
        live.add(t.key);
        let v = vr.els.get(t.key);
        if (!v) { v = document.createElement('video'); v.autoplay = true; v.muted = true; v.playsInline = true; vr.els.set(t.key, v); }
        if (v.srcObject !== t.video) { v.srcObject = t.video; v.play().catch(() => {}); }
        v.classList.toggle('mirror', t.key === 'cam:me');
        const slot = el.querySelector(`[data-vs="${t.key}"]`);
        if (slot && v.parentNode !== slot) slot.appendChild(v);
    });
    vr.els.forEach((v, k) => { if (!live.has(k)) { v.srcObject = null; v.remove(); vr.els.delete(k); } });
    voiceTickClasses();
}
function callBarClick(b, L) {
    const k = b.dataset.cb;
    if (!vr || vr.id !== L.lb.id) return;
    if (k === 'mute') voiceMute();
    else if (k === 'cam') setCam(!vr.cam);
    else if (k === 'scr') setScreen(!vr.scr);
    else if (k === 'leave') voiceLeave();
    else if (k === 'full') { const v = vr.els.get(b.dataset.tile); if (v && v.requestFullscreen) v.requestFullscreen().catch(() => {}); }
    else if (k === 'focus') { const key = b.dataset.tile; const t = callTiles(L).find(x => x.key === key); vr.focus = vr.focus === key || !(t && t.video) ? '' : key; changed(L.lb.id); }
}
// in a match: stop sending video (netplay first), and send it again after
let pauseN = 0;
function pauseTick() {
    if (!vr || ++pauseN % 40) return;
    const want = !!(videoOn() && cfg.pauseVideo !== false && myStatus() === 'playing');
    if (want === !!vr.paused) return;
    vr.paused = want;
    if (want) fc.ui.toast(T('Camera and screen share paused'), { icon: 'pause', sub: T('Your match gets all of your upload. They come back after it.') });
    videoChanged();
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
    pauseTick();
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

/* =================================================================== the look */

// the owner's colour / emoji / words, and the lobby's pictures
function lookOf(L) {
    const s = (L && L.room.settings) || {}, a = (L && L.room.art) || {};
    return { col: s.col || '', emo: s.emo || '', ic: a.ic || '', bn: a.bn || '', desc: s.desc || '', welcome: s.welcome || '' };
}
const colOf = (id, look) => (look && look.col) || fc.data.hashColor(id);
// the lobby's icon: its picture, else its emoji, else its initials
function iconInner(name, look) {
    if (look && look.ic) return `<img class="pic" src="${E(look.ic)}" alt="" draggable="false">`;
    if (look && look.emo) return `<span class="em">${E(look.emo)}</span>`;
    return `<span class="in">${E(initials(name))}</span>`;
}
// the banner: the owner's picture, else the game's art
const bannerOf = (rom, look) => (look && look.bn ? look.bn : rom ? fc.data.artUrl(rom, 'https://web.fightcade.com/') : '');
// the owner's crown, a moderator's shield, the king of the leaderboard's trophy
function marks(L, pk, king) {
    let h = '';
    if (L.lb.group) return '';                       // a group DM: the crown is in its member list only
    if (pk === L.room.owner) h += `<i class="mk ow" title="${E(T('Lobby owner'))}">${fc.ui.icon('crown', 'fill')}</i>`;
    else if (L.room.isMod(pk)) h += `<i class="mk md" title="${E(T('Moderator'))}">${fc.ui.icon('shield', 'fill')}</i>`;
    if (king && pk === king) h += `<i class="mk kg" title="${E(T('King of the lobby: top of the leaderboard'))}">${fc.ui.icon('trophy')}</i>`;
    return h;
}
// the name shown in the lobby: its nickname, else the Fightcade name
// (a DM / group DM is signed with Fightcord IDs: a friend there goes by your nickname for them, else the
// name you know them by, 3.8)
const friendName = (pk) => { const D = mod('dms'); return (D && D.nameFor && D.nameFor(pk)) || ''; };
const nameOf = (L, pk, fallback) => (L.lb.dm && pk === L.lb.dm.pk ? dmName(L.lb) : '') || (L.lb.group && pk !== L.pk ? friendName(pk) : '') ||
    L.room.name(pk) || (pk === L.pk ? me() : '') || fallback || '?';
const dmName = (lb) => (lb && lb.dm ? friendName(lb.dm.pk) || lb.dm.n : '');
// a group DM: its name, else who's in it ("ParryKing, UrienMain, DashKaiser")
function groupName(lb) {
    const L = lb && rooms.get(lb.id);
    const g = L && L.room.gset.name;
    if (g && g.v) return g.v;
    const names = L ? L.room.active().filter(m => m.pk !== L.pk).map(m => nameOf(L, m.pk, m.n)).sort((a, b) => lc(a).localeCompare(lc(b))) : [];
    if (!names.length) return (lb && lb.name) || T('Group');
    return names.slice(0, 4).join(', ') + (names.length > 4 ? ' +' + (names.length - 4) : '');
}
// its picture, else a coloured circle with people on it
function groupIcon(L, size) {
    const ic = L && L.room.gset.ic && L.room.gset.ic.v;
    if (ic) return `<img class="fclbGi pic" src="${E(ic)}" alt="" width="${size}" height="${size}" style="--s:${size}px">`;
    return `<span class="fclbGi" style="--s:${size}px;--c:${fc.data.hashColor(L ? L.lb.id : 'g')}">${fc.ui.icon('users')}</span>`;
}
const avatarOf = (name, g, size) => fc.ui.avatar(name, { size }).replace(/src="[^"]*"/, `src="${E(fc.data.avatarUrl(name, g, size * 2))}"`);
// a translated line with one {key} filled with html
function Th(s, key, html, v) {
    const mark = '\u0001';
    return E(T(s, Object.assign({}, v, { [key]: mark }))).replace(mark, html);
}

// pictures go inside the lobby's own (encrypted) events. nos.lol, nostr.mom and offchain.pub refuse events
// over 64 KB (tested 2026-10-25: an icon + a banner, base64, then sealed, come to ~59 KB at these sizes;
// offchain.pub also refuses big events from keys it doesn't know, so pictures live on the other four)
const ICON_SEND = 12000, BANNER_SEND = 32000;
function pickImage() {
    return new Promise((done) => {
        const i = document.createElement('input');
        i.type = 'file';
        i.accept = 'image/png,image/jpeg,image/webp,image/gif';
        i.onchange = () => done((i.files && i.files[0]) || null);
        i.click();
    });
}
// a picture -> a w x h data: URL (cropped to fill, like a cover), quality lowered until it fits in max
function shrinkImage(file, w, h, max) {
    return new Promise((done, fail) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            let W = w, H = h;
            for (let round = 0; round < 4; round++) {
                const c = document.createElement('canvas');
                c.width = W; c.height = H;
                const g = c.getContext('2d');
                const s = Math.max(W / img.width, H / img.height);
                g.imageSmoothingQuality = 'high';
                g.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
                for (const q of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
                    let out = c.toDataURL('image/webp', q);
                    if (!/^data:image\/webp/.test(out)) out = c.toDataURL('image/jpeg', q);
                    if (out.length <= max) { done(out); return; }
                }
                W = Math.round(W * 0.8); H = Math.round(H * 0.8);
            }
            fail(new Error('too big'));
        };
        img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('not a picture')); };
        img.src = url;
    });
}

/* =================================================================== the rail */

function initials(name) {
    const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w.slice(0, 3).map(x => [...x][0]).join('') : [...(w[0] || '?')].slice(0, 2).join('')).toUpperCase();
}

function railHtml() {
    const icons = lobbiesOnly().map(lb => {
        const L = rooms.get(lb.id);
        const look = lookOf(L);
        const u = L ? unread(L) : { n: 0, at: 0 };
        const on = view.page && view.id === lb.id;
        const voice = vr && vr.id === lb.id;
        return `<div class="fclbIco${on ? ' on' : ''}${u.n ? ' unread' : ''}${lb.removed || lb.closed ? ' dead' : ''}${look.ic ? ' hasPic' : ''}" data-lb="${E(lb.id)}" title="${E(lb.name)}" style="--c:${colOf(lb.id, look)}">` +
            `${iconInner(lb.name, look)}<i class="lk">${fc.ui.icon(voice ? 'mic' : 'lock')}</i>${u.at ? `<b class="bd">${u.at > 9 ? '9+' : u.at}</b>` : ''}</div>`;
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
                out.innerHTML = hitHtml(r);
                const have = lobbyById(r.info.id);
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
// what an invite code leads to: the lobby's banner, icon, name, game, members and description
function hitHtml(r) {
    const i = r.info, look = { ic: r.art && r.art.ic, bn: r.art && r.art.bn, emo: i.emo, col: i.col };
    const have = lobbyById(i.id);
    const bn = bannerOf(i.rom, look);
    return `<div class="fclbHit" style="--c:${colOf(i.id, look)}">${bn ? `<div class="bn${look.bn ? ' own' : ''}" style="--art:url('${E(bn)}')"></div>` : ''}` +
        `<div class="row"><span class="ico">${iconInner(i.name, look)}</span><span class="tx"><b>${E(i.name)}</b>` +
        `<small>${E(shortName(i.ch) || T('No game'))} · ${E(fc.t.plural(r.members, '{n} member', '{n} members'))}</small></span></div>` +
        (i.desc ? `<p class="ds">${E(fc.fmt.short(i.desc, 200))}</p>` : '') + '</div>' +
        (have && !have.removed ? `<div class="fclbLook">${E(T('You’re already in this lobby.'))}</div>` : '');
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

// the owner's lobby settings: Overview (look + words), Welcome, Moderators
const SWATCHES = ['', '#5865f2', '#eb459e', '#ed4245', '#f26522', '#f0b232', '#57f287', '#1abc9c', '#3498db', '#9b59b6', '#95a5a6'];
function settingsModal(id, tab) {
    const lb = lobbyById(id), L = rooms.get(id);
    if (!lb || !L || L.pk !== L.room.owner || lb.removed || lb.closed) return null;
    const look = lookOf(L), st = L.room.settings || {};
    const d = { name: lb.name, ch: lb.ch, rom: lb.rom, col: look.col, emo: look.emo, desc: look.desc, welcome: look.welcome, mods: (st.mods || []).slice(), ic: look.ic, bn: look.bn };
    let cur = tab || 'look', artChanged = false;
    const box = document.createElement('div');
    box.className = 'fclbSet fclbForm';
    const draw = () => fc.ui.setHtml(box, fc.ui.tabs([['look', N_('Overview')], ['welcome', N_('Welcome')], ['mods', N_('Moderators'), d.mods.length || null]], cur) +
        `<div class="pane">${cur === 'welcome' ? setWelcomeHtml(d) : cur === 'mods' ? setModsHtml(L, d) : setLookHtml(lb, d)}</div>`);
    draw();
    const onField = (e) => {
        const t = e.target;
        if (t.dataset && t.dataset.mod) {
            d.mods = d.mods.filter(x => x !== t.dataset.mod);
            if (t.checked && d.mods.length < MAX_MODS) d.mods.push(t.dataset.mod);
            const n = box.querySelector('.fc-tab[data-tab="mods"]');
            if (n) n.innerHTML = E(T('Moderators')) + (d.mods.length ? `<span class="n">${d.mods.length}</span>` : '');
            return;
        }
        const f = t.dataset && t.dataset.f;
        if (!f) return;
        if (f === 'ch') { const o = t.options[t.selectedIndex]; d.ch = t.value; d.rom = (o && o.dataset.rom) || d.rom; } else d[f] = t.value;
        const c = box.querySelector(`[data-cnt="${f}"]`);
        if (c) c.textContent = d[f].length + ' / ' + (f === 'desc' ? MAX_DESC : MAX_WELCOME);
        if (f === 'emo' || f === 'name') { const pv = box.querySelector('.pv'); if (pv) fc.ui.setHtml(pv, iconInner(d.name, { ic: d.ic, emo: cleanEmoji(d.emo) })); }
    };
    box.addEventListener('input', onField);
    box.addEventListener('change', onField);
    box.addEventListener('click', (e) => {
        const t = e.target.closest('.fc-tab[data-tab]');
        if (t) { cur = t.dataset.tab; draw(); return; }
        const s = e.target.closest('[data-col]');
        if (s) {
            d.col = s.dataset.col;
            box.querySelectorAll('[data-col]').forEach(x => x.classList.toggle('on', x === s));
            const pv = box.querySelector('.pv');
            if (pv) pv.style.setProperty('--c', colOf(lb.id, d));
            return;
        }
        const a = e.target.closest('[data-act]');
        const act = a && a.dataset.act;
        if (act === 'set-ic' || act === 'set-bn') {
            const ic = act === 'set-ic';
            pickImage().then(f => (f ? shrinkImage(f, ic ? 128 : 720, ic ? 128 : 240, ic ? ICON_SEND : BANNER_SEND) : '')).then(url => {
                if (!url) return;
                d[ic ? 'ic' : 'bn'] = url;
                artChanged = true;
                draw();
            }).catch(() => fc.ui.toast(T('Couldn’t use that picture'), { sub: T('Try a PNG, JPG or WebP image.'), kind: 'warning' }));
        }
        if (act === 'set-ic-x') { d.ic = ''; artChanged = true; draw(); }
        if (act === 'set-bn-x') { d.bn = ''; artChanged = true; draw(); }
    });
    const m = fc.ui.modal({
        title: T('Lobby settings'), body: box, width: 520,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Save'), fn: () => {
            saveSettings(id, { name: d.name.trim(), ch: d.ch, rom: d.rom, col: d.col, emo: cleanEmoji(d.emo), desc: d.desc.trim(), welcome: d.welcome.trim(), mods: d.mods });
            if (artChanged) setArt(id, d.ic, d.bn);
            fc.ui.toast(T('Lobby settings saved'), { kind: 'success' });
            changed(id);
        } }]
    });
    keysInside(m.el);
    return m;
}
function setLookHtml(lb, d) {
    const bn = bannerOf(d.rom, d);
    return `<div class="fclbSetTop"><div class="pv" style="--c:${colOf(lb.id, d)}">${iconInner(d.name, { ic: d.ic, emo: cleanEmoji(d.emo) })}</div><div class="ctl">` +
        `<span class="lbl">${E(T('Lobby picture'))}</span><div class="bt">${fc.ui.btn('Upload picture', { kind: 'sec', size: 'sm', icon: 'image', act: 'set-ic' })}` +
        (d.ic ? fc.ui.btn('Remove', { kind: 'ghost', size: 'sm', act: 'set-ic-x' }) : '') + '</div>' +
        `<label class="em"><span>${E(T('Or an emoji'))}</span><input class="fc-input" data-f="emo" maxlength="8" value="${E(d.emo)}" placeholder="🥊"></label></div></div>` +
        `<span class="lbl">${E(T('Banner'))}</span><div class="fclbSetBn${d.bn ? ' own' : ''}"${bn ? ` style="--art:url('${E(bn)}')"` : ''}>` +
        (d.bn ? '' : `<small>${E(T('The game’s art, until you upload one'))}</small>`) +
        `<div class="bt">${fc.ui.btn('Upload banner', { kind: 'sec', size: 'sm', icon: 'image', act: 'set-bn' })}${d.bn ? fc.ui.btn('Remove', { kind: 'sec', size: 'sm', act: 'set-bn-x' }) : ''}</div></div>` +
        `<label><span>${E(T('Lobby name'))}</span><input class="fc-input" data-f="name" maxlength="40" value="${E(d.name)}"></label>` +
        `<label><span>${E(T('Game'))}</span><select class="fc-select" data-f="ch">${gameOptions(d.ch)}</select></label>` +
        `<span class="lbl">${E(T('Colour'))}</span><div class="fclbSw">` +
        SWATCHES.map(c => `<span class="s${c === d.col ? ' on' : ''}${c ? '' : ' auto'}" data-col="${c}" style="--s:${c || fc.data.hashColor(lb.id)}" title="${E(c || T('Automatic'))}"></span>`).join('') + '</div>' +
        `<label><span>${E(T('Description'))}</span><textarea class="fc-input" data-f="desc" maxlength="${MAX_DESC}" rows="3" placeholder="${E(T('What’s this lobby about?'))}">${E(d.desc)}</textarea>` +
        `<small class="cnt" data-cnt="desc">${d.desc.length} / ${MAX_DESC}</small></label>`;
}
function setWelcomeHtml(d) {
    return `<p class="fc-note">${E(T('Shown once to everyone who joins, with the description and the pinned messages.'))}</p>` +
        `<label><span>${E(T('Welcome message'))}</span><textarea class="fc-input" data-f="welcome" maxlength="${MAX_WELCOME}" rows="7" placeholder="${E(T('Welcome! FT5 by default, be nice, bracket links go in chat.'))}">${E(d.welcome)}</textarea>` +
        `<small class="cnt" data-cnt="welcome">${d.welcome.length} / ${MAX_WELCOME}</small></label>`;
}
function setModsHtml(L, d) {
    const list = L.room.active().filter(m => m.pk !== L.pk).sort((a, b) => lc(nameOf(L, a.pk, a.n)).localeCompare(lc(nameOf(L, b.pk, b.n))));
    return `<p class="fc-note">${E(T('Moderators can remove and mute members, change nicknames, pin messages and plan events. They can’t change these settings or close the lobby.'))}</p>` +
        (list.length ? list.map(m => `<div class="fclbModR">${avatarOf(m.n, m.g, 32)}<span class="nm"><b>${E(nameOf(L, m.pk, m.n))}</b>${L.room.nick(m.pk) ? `<small>${E(m.n)}</small>` : ''}</span>` +
            `<label class="sw"><input type="checkbox" class="fc-switch-in" data-mod="${E(m.pk)}"${d.mods.indexOf(m.pk) >= 0 ? ' checked' : ''}><i class="fc-switch"></i></label></div>`).join('')
            : `<div class="fclbLook">${E(T('Nobody else is in the lobby yet.'))}</div>`);
}

function nickModal(id, pk) {
    const L = rooms.get(id);
    const m0 = L && L.room.members.get(pk);
    if (!m0) return;
    const body = `<div class="fclbForm"><label><span>${E(T('Nickname in this lobby'))}</span><input class="fc-input" data-f="nick" maxlength="32" value="${E(L.room.nick(pk))}" placeholder="${E(m0.n)}"></label>` +
        `<p class="fc-note">${E(T('Everyone in the lobby sees it instead of {name}. Leave it empty to go back to the Fightcade name.', { name: m0.n }))}</p></div>`;
    const m = fc.ui.modal({
        title: T('Change {name}’s nickname', { name: m0.n }), body, width: 420,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Save'), fn: (b) => { nick(id, pk, b.querySelector('[data-f="nick"]').value.trim()); } }]
    });
    keysInside(m.el);
    setTimeout(() => { const i = m.body.querySelector('input'); if (i) { i.focus(); i.select(); } }, 30);
}

function muteMenu(rect, L, pk, name) {
    const id = L.lb.id;
    const go = (mins, label) => { if (mute(id, pk, mins)) fc.ui.toast(T('{name} is muted {how}', { name, how: label }), { icon: 'ban' }); };
    const opts = [[10, N_('for 10 minutes')], [60, N_('for 1 hour')], [24 * 60, N_('for 24 hours')], [7 * 24 * 60, N_('for a week')]];
    fc.ui.menu(rect, opts.map(([mins, label]) => ({ label: T('Mute {how}', { how: T(label) }), icon: 'clock', fn: () => go(mins, T(label)) })), { side: 'left' });
}

function planModal(id) {
    const L = rooms.get(id);
    if (!canMod(L)) return;
    const d = new Date(now() + 3600000);
    d.setMinutes(0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const fts = [0, 2, 3, 5, 7, 10];
    const body = `<div class="fclbForm">
        <label><span>${E(T('What'))}</span><input class="fc-input" data-f="title" maxlength="80" placeholder="${E(T('Friday FT10s'))}"></label>
        <div class="fclbTwo"><label><span>${E(T('Day'))}</span><input class="fc-input" type="date" data-f="date" value="${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}"></label>
        <label><span>${E(T('Time'))}</span><input class="fc-input" type="time" data-f="time" value="${pad(d.getHours())}:00"></label>
        <label><span>${E(T('Sets'))}</span><select class="fc-select" data-f="ft">${fts.map(n => `<option value="${n}">${n ? 'FT' + n : E(T('Any'))}</option>`).join('')}</select></label></div>
        <label><span>${E(T('Note'))}</span><textarea class="fc-input" data-f="desc" maxlength="${MAX_DESC}" rows="3" placeholder="${E(T('Rules, the bracket link, who brings what…'))}"></textarea></label>
        <p class="fc-note">${E(T('Everyone who says they’re going gets a reminder 15 minutes before, and when it starts.'))}</p></div>`;
    const m = fc.ui.modal({
        title: T('Plan an event'), body, width: 480,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Plan it'), fn: (b) => {
            const v = (k) => b.querySelector(`[data-f="${k}"]`).value;
            const title = v('title').trim();
            const when = new Date(v('date') + 'T' + (v('time') || '00:00')).getTime();
            if (!title) { b.querySelector('[data-f="title"]').focus(); return false; }
            if (!(when > now() - 5 * 60000)) { fc.ui.toast(T('Pick a time that hasn’t passed yet'), { kind: 'warning', icon: 'clock' }); return false; }
            const e = planEvent(id, { title, when, ft: +v('ft') || 0, desc: v('desc').trim() });
            if (!e) { fc.ui.toast(T('Couldn’t plan the event'), { kind: 'danger' }); return false; }
            rsvp(id, e, true);
            view.tab = 'events';
            changed(id);
        } }]
    });
    keysInside(m.el);
    setTimeout(() => { const i = m.body.querySelector('input'); if (i) i.focus(); }, 30);
}

// a new member's first look: banner, icon, name, description, the owner's welcome
function welcomeCard(L) {
    const lb = L.lb, look = lookOf(L);
    lb.welcomed = true;
    store.save();
    const bn = bannerOf(lb.rom, look);
    const pins = L.room.pinned().length, evs = L.room.events().length;
    const facts = [gameName(lb), fc.t.plural(L.room.active().length, '{n} member', '{n} members')];
    if (pins) facts.push(fc.t.plural(pins, '{n} pinned message', '{n} pinned messages'));
    if (evs) facts.push(fc.t.plural(evs, '{n} event planned', '{n} events planned'));
    const body = `<div class="fclbWel" style="--c:${colOf(lb.id, look)}"><div class="bn${look.bn ? ' own' : ''}"${bn ? ` style="--art:url('${E(bn)}')"` : ''}></div>` +
        `<div class="ico">${iconInner(lb.name, look)}</div><h2>${E(T('Welcome to {lobby}', { lobby: lb.name }))}</h2>` +
        `<div class="facts">${facts.map(E).join(' · ')}</div>` +
        (look.desc ? `<p class="ds">${richText(look.desc, '')}</p>` : '') +
        (look.welcome ? `<div class="wm"><div class="by">${marks(L, L.room.owner)}<b>${E(nameOf(L, L.room.owner, T('The owner')))}</b></div>${richText(look.welcome, '')}</div>` : '') + '</div>';
    const m = fc.ui.modal({ title: '', body, width: 460, actions: [{ label: T('Got it') }] });
    m.el.classList.add('fclbWelM');
    return m;
}

// Fightcade's chat shortcuts stay out of our inputs
function keysInside(el) { el.addEventListener('keydown', (e) => e.stopPropagation()); el.addEventListener('keypress', (e) => e.stopPropagation()); }

/* =================================================================== the page */

// a lobby, a DM, or (HOME) the DM page's Friends view. DMs and the Friends view share one page
// (Discord's Home): the DM list on the left, from the DMs module
function openLobby(id) {
    const home = id === HOME;
    const lb = home ? null : lobbyById(id);
    if (!home && !lb) return;
    const mode = home || lb.dm || lb.group ? 'dm' : 'lobby';
    if (view.page && view.mode !== mode) view.page.close();
    if (view.id !== id) {
        view.tab = 'chat'; view.re = ''; view.rx = null; view.limit = 0; view.ed = ''; view.q = ''; view.hold = '';
        if (view.srch) view.srch.querySelector('input').value = '';
        // the "New" line: where you'd stopped reading
        view.newAt = lb && unread(roomFor(lb)).n ? lb.lastRead || 0 : 0;
    }
    view.id = id;
    view.mode = mode;
    const L = home ? null : roomFor(lb);
    if (L) loadOld(L);
    if (!view.page) {
        const page = fc.ui.page(mode === 'dm' ? 'dms' : 'lobby', {
            title: home ? T('Friends') : lb.name, icon: mode === 'dm' ? 'chat' : 'lock', cls: 'fclbPage' + (mode === 'dm' ? ' fclbDmPage' : ''),
            tools: mode === 'dm' ? '' : fc.ui.btn('Invite', { kind: 'brand', size: 'sm', icon: 'plus', act: 'lb-invite' }),
            onEsc: () => {
                if (view.ed) { stopEdit(); return false; }
                if (view.q) { clearSearch(); return false; }
                if (view.re) { view.re = ''; renderPage(); return false; }
                if (view.tab !== 'chat') { view.tab = 'chat'; renderPage(); return false; }
            },
            onClose: () => { if (view.page === page) { view.page = null; view.hold = ''; view.ed = ''; view.q = ''; } renderRail(); fc.emit('lobbies:changed', {}); }
        });
        view.page = page;
        const el = view.page.el;
        el.addEventListener('click', onPageClick);
        el.addEventListener('contextmenu', onPageContext);
        el.addEventListener('keydown', onPageKey);
        el.addEventListener('keypress', (e) => e.stopPropagation());
        el.addEventListener('input', onPageInput);
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('mouseover', onPageOver);
        el.addEventListener('scroll', onLogScroll, true);
    }
    view.page.setTitle(home ? T('Friends') : lb.name);
    view.stick = true;
    renderPage(true);
    if (!home) markRead(id);
    renderRail();
    fc.emit('lobbies:changed', {});
    setTimeout(() => { const t = view.page && view.page.el.querySelector('.fclbIn'); if (t) t.focus(); }, 40);
}

function statusOf(L, pk) {
    if (pk === L.pk) return { on: true, st: myStatus(), v: !!(vr && vr.id === L.lb.id) };
    const x = liveOf(L, pk);
    const m = whoIs(L, pk);
    const fcSt = m ? fc.app.status(m.n) : 'off';
    if (!x) return { on: false, st: 'off', v: false };
    return { on: true, st: fcSt === 'playing' ? 'playing' : x.st || 'on', v: !!x.v };
}
const ST_TEXT = { on: N_('Online'), away: N_('Away'), playing: N_('In a match'), off: N_('Offline') };

const locale = () => (fc.t.locale ? fc.t.locale() : undefined);
function when(at) {
    const d = new Date(at);
    const time = d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
    if (sameDay(at, now())) return T('Today at {time}', { time });
    if (sameDay(at, now() - 86400000)) return T('Yesterday at {time}', { time });
    return d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + time;
}
// an event's time: "Fri 21:00", "Today 21:00", "Tomorrow 21:00"
function whenEv(at) {
    const d = new Date(at);
    const time = d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
    if (sameDay(at, now())) return T('Today {time}', { time });
    if (sameDay(at, now() + 86400000)) return T('Tomorrow {time}', { time });
    return d.toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time;
}
// "in 25 min" / "in 3 h" / "happening now"
function soonText(at) {
    const left = at - now();
    if (left <= 0) return T('happening now');
    if (left < 3600000) return T('in {n} min', { n: Math.max(1, Math.round(left / 60000)) });
    if (left < 36 * 3600000) return T('in {n} h', { n: Math.round(left / 3600000) });
    return T('in {n} days', { n: Math.round(left / 86400000) });
}

// a message's first link -> where its picture / GIF / video / preview goes (chat-extras fills it in: fillEmbeds)
const URL_IN = /https?:\/\/[^\s<>"']+/;
function embSlot(it) {
    const m = String(it.x || '').match(URL_IN);
    return m ? `<div class="fclbEmb" data-emb="${E(m[0])}" data-k="${E(it.id)}"${it.x.trim() === m[0] ? ' data-only="1"' : ''}></div>` : '';
}
// the embeds are made once per message and moved into each new render (no reloading pictures)
const embeds = new Map();                // message id + link -> Promise<element|null>
function fillEmbeds(log) {
    const cx = mod('chat-extras');
    if (!cx || !cx.embed) return;
    log.querySelectorAll('.fclbEmb[data-emb]').forEach(slot => {
        const url = slot.dataset.emb, k = slot.dataset.k + ' ' + url;
        let p = embeds.get(k);
        if (!p) { p = cx.embed(url); embeds.set(k, p); if (embeds.size > 300) embeds.delete(embeds.keys().next().value); }
        p.then(el => {
            if (!el || !slot.isConnected || slot.firstChild) return;
            slot.appendChild(el);
            // a picture: the link itself goes (all of the message when it was only the link), like Discord
            if (el.dataset.media) {
                const ln = slot.closest('.ln');
                if (slot.dataset.only) ln.classList.add('only');
                else ln.querySelectorAll('.tx .fclbA').forEach(a => { if (a.dataset.href === url) a.classList.add('gone'); });
            }
            const stick = () => { const lg = slot.closest('.fclbLog'); if (lg && view.stick) lg.scrollTop = lg.scrollHeight; };
            stick();
            el.querySelectorAll('img, video').forEach(m => { m.addEventListener('load', stick, { once: true }); m.addEventListener('loadedmetadata', stick, { once: true }); });
        });
    });
}

// 3.8: a link to one message (Copy Message Link): it opens that chat at that message, for anyone in it
const MSG_LINK = /fightcord:\/\/m\/([\w-]{1,80})\/([\w-]{1,80})/g;
const msgLink = (id, mid) => 'fightcord://m/' + id + '/' + mid;
function chatLabel(lb) {
    if (!lb) return T('a chat you aren’t in');
    if (lb.dm) return '@' + dmName(lb);
    if (lb.group) return groupName(lb);
    return '#' + lb.name;
}
// text -> html: escaped, links, @you highlighted
function richText(x, meName) {
    let h = E(x);
    h = h.replace(MSG_LINK, (all, id, mid) => `<a class="fclbMl${lobbyById(id) ? '' : ' no'}" data-ml="${id}/${mid}">${E(chatLabel(lobbyById(id)))} <span>›</span> ${fc.ui.icon('chat')}</a>`);
    h = h.replace(/https?:\/\/[^\s<>"']+/g, (u) => `<a class="fclbA" data-href="${u}">${u}</a>`);
    h = h.replace(/(^|[^\w])@([^\s@<>&]{2,40})/g, (all, pre, n) => `${pre}<span class="fclbAt${meName && lc(n) === lc(meName) ? ' me' : ''}">@${n}</span>`);
    return h.replace(/\n/g, '<br>');
}

function sideHtml(L) {
    const lb = L.lb, look = lookOf(L);
    const inVoice = vr && vr.id === lb.id;
    const voices = [];
    if (inVoice) voices.push({ pk: L.pk, n: me(), g: myGravatar(), self: true, cam: !!vr.cam && !vr.paused, scr: !!vr.scr && !vr.paused });
    L.live.forEach((p, pk) => { if (p.v && liveOf(L, pk) && pk !== L.pk) voices.push({ pk, n: nameOf(L, pk, p.n), g: (L.room.members.get(pk) || {}).g || p.g, peer: inVoice ? vr.peers.get(pk) : null, cam: p.cam, scr: p.scr }); });
    const bn = bannerOf(lb.rom, look);
    const next = L.room.events()[0];
    const pins = L.room.pinned().length, evs = L.room.events().length;
    const row = (tab, icon, label, n) => `<div class="fclbCh${view.tab === tab ? ' on' : ''}" data-act="lb-tab" data-tab="${tab}">${fc.ui.icon(icon)}<span>${E(label)}</span>${n ? `<small>${n}</small>` : ''}</div>`;
    return `<div class="fclbHd" data-act="lb-menu"><span class="nm">${E(lb.name)}</span>${L.pk ? marks(L, L.pk) : ''}${fc.ui.icon('chevronDown')}</div>` +
        `<div class="fclbGame${look.bn ? ' own' : ''}"${bn ? ` style="--art:url('${E(bn)}')"` : ''}><span class="ico" style="--c:${colOf(lb.id, look)}">${iconInner(lb.name, look)}</span>` +
        `<span class="gn">${fc.ui.icon('pad')}${E(gameName(lb))}</span></div>` +
        (look.desc ? `<div class="fclbDesc">${richText(look.desc, '')}</div>` : '') +
        (next ? `<div class="fclbNext" data-act="lb-tab" data-tab="events">${fc.ui.icon('calendar')}<span class="tx"><b>${E(next.title)}</b>` +
            `<small>${E([whenEv(next.when), next.ft ? 'FT' + next.ft : '', fc.t.plural(next.going.length, '{n} going', '{n} going')].filter(Boolean).join(' · '))}</small></span></div>` : '') +
        `<div class="fclbCat">${E(T('Text'))}</div>` + row('chat', 'hash', T('chat')) +
        `<div class="fclbCh" data-act="lb-pins">${fc.ui.icon('pin')}<span>${E(T('Pinned messages'))}</span>${pins ? `<small>${pins}</small>` : ''}</div>` +
        row('events', 'calendar', T('Events'), evs) + row('board', 'trophy', T('Leaderboard')) +
        `<div class="fclbCat">${E(T('Voice'))}</div>` +
        `<div class="fclbCh vc${inVoice ? ' joined' : ''}" data-act="lb-voice" title="${E(inVoice ? T('You’re in the voice room') : T('Join the voice room'))}">${fc.ui.icon('speaker')}<span>${E(T('Voice room'))}</span>${voices.length ? `<small>${voices.length}/${MAX_VOICE}</small>` : ''}</div>` +
        voices.map(v => `<div class="fclbVp" data-vpk="${E(v.pk)}">${avatarOf(v.n, v.g, 24)}<span class="nm">${E(v.n)}</span>` +
            (v.cam ? `<i title="${E(T('Camera on'))}">${fc.ui.icon('video')}</i>` : '') + (v.scr ? `<i class="lv" title="${E(T('Sharing their screen'))}">${E(T('LIVE'))}</i>` : '') +
            (v.self && vr.muted ? `<i class="mu" title="${E(T('Muted'))}">${fc.ui.icon('ban')}</i>` : '') +
            (v.peer && v.peer.state !== 'connected' ? `<i class="cn" title="${E(T('Connecting…'))}">…</i>` : '') + '</div>').join('') +
        (inVoice ? `<div class="fclbVbar"><div class="tx"><b>${fc.ui.icon('wifi')}${E(T('Voice connected'))}</b><small>${E(lb.name)}</small></div>` +
            fc.ui.btn('', { kind: vr.muted ? 'danger' : 'ghost', size: 'sm', icon: 'mic', act: 'lb-mute', title: vr.muted ? T('Unmute (Ctrl+Shift+M)') : T('Mute (Ctrl+Shift+M)') }) +
            fc.ui.btn('', { kind: vr.cam ? 'success' : 'ghost', size: 'sm', icon: vr.cam ? 'video' : 'videoOff', act: 'lb-cam', title: vr.cam ? T('Turn off camera') : T('Turn on camera') }) +
            fc.ui.btn('', { kind: vr.scr ? 'success' : 'ghost', size: 'sm', icon: 'screen', act: 'lb-scr', title: vr.scr ? T('Stop sharing') : T('Share your screen') }) +
            fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'logout', act: 'lb-vleave', title: T('Leave the voice room') }) + '</div>' : '');
}

// the main column's bar: what's on screen, and its tools
function topHtml(L) {
    if (view.tab === 'events') {
        return `<span class="ti">${fc.ui.icon('calendar')}<b>${E(T('Events'))}</b></span><span class="sub">${E(T('Sets and meetups planned in this lobby'))}</span>` +
            `<span class="tl">${canMod(L) ? fc.ui.btn('Plan an event', { kind: 'brand', size: 'sm', icon: 'plus', act: 'lb-plan' }) : ''}</span>`;
    }
    if (view.tab === 'board') {
        return `<span class="ti">${fc.ui.icon('trophy')}<b>${E(T('Leaderboard'))}</b></span><span class="sub">${E(gameName(L.lb))}</span>` +
            `<span class="tl">${fc.ui.tabs([['all', N_('All time')], ['month', N_('This month')]], view.range || 'all')}</span>`;
    }
    const look = lookOf(L);
    return `<span class="ti">${fc.ui.icon('hash')}<b>${E(T('chat'))}</b></span><span class="sub"${look.desc ? ` title="${E(look.desc)}"` : ''}>${E(look.desc.replace(/\s+/g, ' '))}</span>` +
        `<span class="tl">${pinsBtn(L)}<span class="fclbSrchSlot"></span></span>`;
}
const pinsBtn = (L) => { const n = L.room.pinned().length; return `<span class="fclbTopB${n ? ' n' : ''}" data-act="lb-pins" title="${E(T('Pinned messages'))}">${fc.ui.icon('pin')}${n ? `<b>${n}</b>` : ''}</span>`; };
const topB = (act, icon, title, cls) => `<span class="fclbTopB${cls ? ' ' + cls : ''}" data-act="${act}" title="${E(title)}">${fc.ui.icon(icon)}</span>`;

// a group DM's bar: its picture and name (click to rename), how many, and Call / Video / Pins / Add friends
function groupTopHtml(L) {
    const lb = L.lb, inCall = !!(vr && vr.id === lb.id), live = !lb.removed;
    const n = L.room.active().length;
    const callers = [...L.live].filter(([pk, p]) => p.v && liveOf(L, pk)).length;
    return `<span class="ti dm gp" data-act="${live ? 'gp-name' : ''}" title="${E(live ? T('Change the group’s name') : '')}">${groupIcon(L, 24)}<b>${E(groupName(lb))}</b></span>` +
        `<span class="sub">${E(fc.t.plural(n, '{n} member', '{n} members'))}${callers && !inCall ? ' · ' + E(T('a call is on')) : ''}</span><span class="tl">` +
        (live && !inCall ? topB('dm-call', 'phone', callers ? T('Join the call') : T('Start a voice call')) + topB('dm-video', 'video', T('Start a video call')) : '') +
        pinsBtn(L) + (live ? topB('gp-add', 'userPlus', T('Add friends to the group')) : '') + `<span class="fclbSrchSlot"></span></span>`;
}
// a group DM's right column: who's in it (its maker first, with a crown)
function groupMembersHtml(L) {
    const D = mod('dms');
    const list = L.room.active().map(m => Object.assign({ m }, statusOf(L, m.pk)));
    if (L.pk && !list.find(x => x.m.pk === L.pk) && !L.lb.removed) list.push(Object.assign({ m: { pk: L.pk, n: me(), g: myGravatar() } }, statusOf(L, L.pk)));
    const sort = (a, b) => (b.m.pk === L.room.owner) - (a.m.pk === L.room.owner) || (b.on - a.on) || lc(nameOf(L, a.m.pk, a.m.n)).localeCompare(lc(nameOf(L, b.m.pk, b.m.n)));
    const row = (x) => {
        const m = x.m, name = nameOf(L, m.pk, m.n);
        const friend = !!(D && D.isFriendPk && D.isFriendPk(m.pk));
        const sub = x.v ? T('In the call') : x.on ? T(ST_TEXT[x.st] || 'Online') : '';
        return `<div class="fclbM${x.on ? '' : ' off'}" data-who="${E(m.pk)}"${name !== m.n ? ` title="${E(m.n)}"` : ''}>` +
            fc.ui.avatar(m.n, { size: 32, status: x.on ? x.st : '' }).replace(/src="[^"]*"/, `src="${E(fc.data.avatarUrl(m.n, m.g, 64))}"`) +
            `<span class="tx"><b><span class="nm">${E(name)}</span>${m.pk === L.room.owner ? `<i class="mk ow" title="${E(T('Group owner'))}">${fc.ui.icon('crown', 'fill')}</i>` : ''}` +
            (m.pk !== L.pk && !friend ? `<i class="mk nf" title="${E(T('Not your friend'))}">${fc.ui.icon('user')}</i>` : '') + '</b>' +
            (sub ? `<small>${x.v ? fc.ui.icon('speaker') : ''}${E(sub)}</small>` : '') + '</span></div>';
    };
    return `<div class="fclbMh">${E(T('Members — {n}', { n: list.length }))}</div>${list.sort(sort).map(row).join('')}`;
}
// someone in a group DM: message them, see their card, add them, remove them (its maker)
function groupMemberMenu(anchor, L, pk) {
    const m = L.room.members.get(pk) || (pk === L.pk ? { pk, n: me() } : null);
    if (!m) return;
    const D = mod('dms');
    const name = nameOf(L, pk, m.n), self = pk === L.pk, items = [];
    const sc = mod('scout');
    if (!self && D && D.openDm && D.isFriendPk && D.isFriendPk(pk)) items.push({ label: T('Message'), icon: 'chat', fn: () => D.openDm(pk) });
    if (sc && sc.openCard) items.push({ label: T('Scout card'), icon: 'search', fn: () => sc.openCard(m.n, anchor.getBoundingClientRect(), 'beside') });
    if (!self && D && D.isFriendPk && !D.isFriendPk(pk) && D.request) items.push({ label: T('Add friend'), icon: 'userPlus', fn: () => { const r = D.request(m.n); fc.ui.toast(r.text, { icon: 'userPlus', kind: r.ok ? '' : 'warning' }); } });
    if (!self && L.pk === L.room.owner && !L.lb.removed && L.room.members.has(pk)) {
        items.push('sep');
        items.push({ label: T('Remove {name} from the group', { name }), icon: 'ban', danger: true, fn: () => fc.ui.confirm(T('Remove {name}?', { name }), T('Everyone else gets a new key, so {name} can’t read anything new.', { name }), { ok: T('Remove'), danger: true }).then(ok => {
            if (ok && !kick(L.lb.id, pk)) fc.ui.toast(T('Couldn’t remove {name} yet', { name }), { kind: 'warning' });
        }) });
    }
    if (self && !L.lb.removed) { items.push('sep'); items.push({ label: T('Leave Group'), icon: 'logout', danger: true, fn: () => leaveGroupAsk(L) }); }
    if (items.length) fc.ui.menu(anchor, items, { side: anchor.classList && anchor.classList.contains('fclbM') ? 'left' : 'right' });
}
function leaveGroupAsk(L) {
    fc.ui.confirm(T('Leave “{group}”?', { group: groupName(L.lb) }), T('You won’t see it any more, and you can only come back if someone in it adds you again.'), { ok: T('Leave Group'), danger: true })
        .then(ok => { if (ok) { leave(L.lb.id); openLobby(HOME); } });
}
function renameModal(L) {
    const cur = (L.room.gset.name || {}).v || '';
    const body = `<div class="fclbForm"><label><span>${E(T('Group name'))}</span><input class="fc-input" data-f="name" maxlength="40" value="${E(cur)}" placeholder="${E(groupName(Object.assign({}, L.lb)))}"></label>` +
        `<div class="fclbGiRow">${groupIcon(L, 56)}<div>${fc.ui.btn('Change icon', { kind: 'sec', size: 'sm', icon: 'image', act: 'gp-icon' })}` +
        (L.room.gset.ic && L.room.gset.ic.v ? fc.ui.btn('Remove', { kind: 'ghost', size: 'sm', act: 'gp-icon-x' }) : '') + '</div></div>' +
        `<p class="fc-note">${E(T('Everyone in the group sees the new name and icon.'))}</p></div>`;
    const m = fc.ui.modal({
        title: T('Edit Group'), body, width: 420,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Save'), fn: (b) => { const v = b.querySelector('[data-f="name"]').value.trim(); if (v !== cur) renameGroup(L.lb.id, v); } }]
    });
    m.el.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'gp-icon-x') { setGroupIcon(L.lb.id, ''); m.close(); return; }
        if (a.dataset.act !== 'gp-icon') return;
        pickImage().then(f => (f ? shrinkImage(f, 128, 128, ICON_SEND) : '')).then(url => { if (url) { setGroupIcon(L.lb.id, url); m.close(); } })
            .catch(() => fc.ui.toast(T('Couldn’t use that picture'), { sub: T('Try a PNG, JPG or WebP image.'), kind: 'warning' }));
    });
    keysInside(m.el);
    setTimeout(() => { const i = m.body.querySelector('input'); if (i) { i.focus(); i.select(); } }, 30);
}

function chatHtml(L) {
    const lb = L.lb;
    const meName = me();
    const dupes = L.room.dupes();
    // (a group DM hides what players you blocked say, like Discord)
    const D = lb.group ? mod('dms') : null;
    const vis = L.room.visible().filter(m => !(D && D.blocked && !m.sys && D.blocked(m.pk)));
    const limit = Math.max(250, view.limit || 0);
    const msgs = vis.slice(-limit);
    const byId = new Map(vis.map(m => [m.id, m]));
    const pinned = new Set(L.room.pinned().map(p => p.m));
    const king = L.room.king();
    const seen = view.rx || new Set();
    const fresh = new Set();
    let out = '', lastDay = '', newShown = false;
    const look = lookOf(L), own = !!(look.ic || look.emo);
    const begin = lb.dm
        ? `<div class="fclbHello dm"><span class="av">${avatarOf(lb.dm.n, lb.dm.g, 80)}</span><h2>${E(dmName(lb))}</h2>` +
            `<p>${E(T('This is the beginning of your direct messages with {name}. Only the two of you can read them.', { name: dmName(lb) }))}</p></div>`
        : lb.group
            ? `<div class="fclbHello dm"><span class="av">${groupIcon(L, 80)}</span><h2>${E(groupName(lb))}</h2>` +
                `<p>${E(T('Welcome to the beginning of the {name} group. Only the people in it can read it.', { name: groupName(lb) }))}</p></div>`
            : `<div class="fclbHello"><div class="ic${own ? ' own' : ''}" style="--c:${colOf(lb.id, look)}">${own ? iconInner(lb.name, look) : fc.ui.icon('hash')}</div><h2>${E(T('Welcome to {lobby}', { lobby: lb.name }))}</h2>` +
                `<p>${E(T('This is the start of the lobby. Only people with an invite code (and Fightcord) can read it.'))}</p>` +
                fc.ui.btn('Invite people', { kind: 'sec', size: 'sm', icon: 'plus', act: 'lb-invite' }) + '</div>';
    if (msgs.length < limit) out += begin;
    const rxHtml = (mid) => {
        const list = L.room.reactions(mid);
        if (!list.length) return '';
        return `<div class="rxs">${list.map(x => {
            const k = mid + x.e + x.pks.length;
            fresh.add(k);
            const who = x.pks.map(pk => nameOf(L, pk)).slice(0, 3).join(', ') + (x.pks.length > 3 ? ' ' + T('and {n} more', { n: x.pks.length - 3 }) : '');
            return `<span class="rx${x.pks.indexOf(L.pk) >= 0 ? ' me' : ''}${view.rx && !seen.has(k) ? ' new' : ''}" data-rx="${E(x.e)}" title="${E(T('{who} reacted with {emoji}', { who, emoji: x.e }))}">${E(x.e)}<b>${x.pks.length}</b></span>`;
        }).join('')}</div>`;
    };
    // where the messages you haven't read start ("New", like Discord)
    const newAt = view.newAt || 0;
    groups(msgs).forEach(g => {
        const day = new Date(g.at).toDateString();
        if (day !== lastDay) { lastDay = day; out += `<div class="fclbDay"><span>${E(new Date(g.at).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' }))}</span></div>`; }
        if (!newShown && newAt && !g.sys && g.pk !== L.pk && g.items.some(it => it.at > newAt)) { newShown = true; out += `<div class="fclbNew"><span>${E(T('New'))}</span></div>`; }
        if (g.sys) {
            const n = nameOf(L, g.pk, g.n);
            if (g.sys === 'pin') {
                out += `<div class="fclbSys pin">${fc.ui.icon('pin')}<span>${Th('{name} pinned a message.', 'name', `<b>${E(n)}</b>`)} ` +
                    `<a data-jump="${E(g.m)}">${E(T('Jump to it'))}</a> · <a data-act="lb-pins">${E(T('See all pinned messages'))}</a></span><time>${E(when(g.at))}</time></div>`;
                return;
            }
            // a group DM's own lines
            if (g.sys === 'add') {
                const to = nameOf(L, g.to, g.n);
                out += `<div class="fclbSys join">${fc.ui.icon('arrowRight')}<span>${Th('{name} added {who} to the group.', 'name', `<b>${E(n)}</b>`, { who: '\u0002' }).replace('\u0002', `<b>${E(to)}</b>`)}</span><time>${E(when(g.at))}</time></div>`;
                return;
            }
            if (g.sys === 'gset') {
                const txt = g.what === 'name' ? (g.v ? Th('{name} changed the group name: {group}', 'name', `<b>${E(n)}</b>`, { group: g.v }) : Th('{name} removed the group name.', 'name', `<b>${E(n)}</b>`))
                    : Th('{name} changed the group icon.', 'name', `<b>${E(n)}</b>`);
                out += `<div class="fclbSys pin">${fc.ui.icon(g.what === 'name' ? 'edit' : 'image')}<span>${txt}</span><time>${E(when(g.at))}</time></div>`;
                return;
            }
            const v = { name: n };
            const txt = lb.group
                ? (g.sys === 'join' ? T('{name} joined the group', v) : g.sys === 'leave' ? T('{name} left the group', v) : T('{name} was removed from the group', v))
                : (g.sys === 'join' ? T('{name} joined the lobby', v) : g.sys === 'leave' ? T('{name} left the lobby', v) : T('{name} was removed from the lobby', v));
            out += `<div class="fclbSys ${g.sys}">${fc.ui.icon(g.sys === 'join' ? 'plus' : 'logout')}<span>${E(txt)}</span><time>${E(when(g.at))}</time></div>`;
            return;
        }
        const m = L.room.members.get(g.pk);
        const real = m ? m.n : g.n;
        const name = nameOf(L, g.pk, real);
        let quote = '';
        if (g.re) {
            const o = byId.get(g.re);
            const on = o && nameOf(L, o.pk, o.n);
            quote = o ? `<div class="rq" data-jump="${E(g.re)}">${avatarOf(on, (L.room.members.get(o.pk) || {}).g || o.g, 16)}<b style="color:${fc.data.hashColor(on)}">${E(on)}</b><span>${E(fc.fmt.short(o.x.replace(/\s+/g, ' '), 100))}</span></div>`
                : `<div class="rq gone">${fc.ui.icon('reply')}<span>${E(L.room.gone(g.re) ? T('Original message was deleted') : T('The original message isn’t here any more'))}</span></div>`;
        }
        const line = (it) => {
            const mine = it.pk === L.pk, editing = view.ed === it.id;
            const body = editing ? '<div class="fclbEdSlot"></div>'
                : it.fw ? `<div class="fwd"><div class="fwl">${fc.ui.icon('forward')}<i>${E(T('Forwarded'))}</i></div><div class="fwb"><span class="tx">${richText(it.x, meName)}</span>${embSlot(it)}` +
                    `<small>${E(it.fw.n)}${it.fw.at ? ' · ' + E(when(it.fw.at)) : ''}</small></div></div>`
                : `<span class="tx">${richText(it.x, meName)}${it.ed ? `<span class="edt" title="${E(when(it.ed))}"> (${E(T('edited'))})</span>` : ''}</span>${embSlot(it)}`;
            return `<div class="ln${mentions(it.x, meName) ? ' at' : ''}${pinned.has(it.id) ? ' pinned' : ''}${editing ? ' editing' : ''}${isSticker(it.x) ? ' stk' : ''}" data-mid="${E(it.id)}"${mine ? ' data-own="1"' : ''} title="${E(when(it.at))}">` +
                `${body}${rxHtml(it.id)}</div>`;
        };
        out += `<div class="fclbG${g.re ? ' re' : ''}">${quote}<div class="gr"><span class="av" data-who="${E(g.pk)}">${avatarOf(real, (m && m.g) || g.g, 40)}</span><div class="bd">` +
            `<div class="hd"><b data-who="${E(g.pk)}" style="color:${fc.data.hashColor(real)}"${name !== real ? ` title="${E(real)}"` : ''}>${E(name)}</b>${marks(L, g.pk, king)}` +
            (dupes.has(g.pk) ? `<i class="mk dup" title="${E(T('Another member uses this name too — this may not be who you think'))}">${fc.ui.icon('warn')}</i>` : '') +
            `<time>${E(when(g.at))}</time></div>` +
            g.items.map(line).join('') +
            '</div></div></div>';
    });
    view.rx = fresh;
    return out;
}

// the hover toolbar's buttons (one toolbar, moved to the message under the mouse)
const QUICK = ['👍', '❤️', '😂', '🔥'];
function toolbarHtml(L) {
    if (L.lb.removed || L.lb.closed || !L.pk) return '';
    const em = mod('emoji');
    return QUICK.map(e => `<span class="b q" data-tb="react" data-e="${E(e)}" title="${E(T('React with {emoji}', { emoji: e }))}">${E(e)}</span>`).join('') +
        (em && em.pick ? `<span class="b" data-tb="pick" title="${E(T('Add a reaction'))}">${fc.ui.icon('smile')}</span>` : '') +
        `<span class="b" data-tb="edit" title="${E(T('Edit'))}">${fc.ui.icon('edit')}</span>` +
        `<span class="b" data-tb="reply" title="${E(T('Reply'))}">${fc.ui.icon('reply')}</span>` +
        `<span class="b" data-tb="fwd" title="${E(T('Forward'))}">${fc.ui.icon('forward')}</span>` +
        (canPin(L) ? `<span class="b" data-tb="pin" title="${E(T('Pin message'))}">${fc.ui.icon('pin')}</span>` : '') +
        `<span class="b" data-tb="more" title="${E(T('More'))}">${fc.ui.icon('more')}</span>`;
}
const isSticker = (x) => /^\s*https:\/\/(www\.)?klipy\.com\/stickers\/[\w-]+\/?\s*$/.test(String(x || ''));

function replyHtml(L) {
    if (!view.re || view.tab !== 'chat') return '';
    const m = L.room.msgs.find(x => x.id === view.re);
    if (!m) return '';
    return `<div class="fclbReBar">${fc.ui.icon('reply')}<span>${Th('Replying to {name}', 'name', `<b>${E(nameOf(L, m.pk, m.n))}</b>`)}</span>` +
        `<span class="x" data-act="lb-reno" title="${E(T('Cancel the reply (Esc)'))}">${fc.ui.icon('close')}</span></div>`;
}

function boxHtml(L) {
    const lb = L.lb;
    if (lb.removed && lb.group) return `<div class="fclbGone">${fc.ui.icon('lock')}${E(T('You were removed from this group. You can still read what was said before.'))}${fc.ui.btn('Close', { kind: 'sec', size: 'sm', act: 'lb-leave' })}</div>`;
    if (lb.removed) return `<div class="fclbGone">${fc.ui.icon('lock')}${E(T('You were removed from this lobby. You can still read what was said before.'))}${fc.ui.btn('Leave', { kind: 'sec', size: 'sm', act: 'lb-leave' })}</div>`;
    if (lb.closed) return `<div class="fclbGone">${fc.ui.icon('lock')}${E(T('The owner closed this lobby.'))}${fc.ui.btn('Leave', { kind: 'sec', size: 'sm', act: 'lb-leave' })}</div>`;
    const until = L.pk ? L.room.muteEnd(L.pk, now()) : 0;
    if (until) return `<div class="fclbGone">${fc.ui.icon('ban')}${E(T('A moderator muted you until {time}. Nobody sees what you write until then.', { time: whenEv(until) }))}</div>`;
    // a message request: accept it (or not) before writing back
    if (lb.dm && lb.req) {
        return `<div class="fclbReq"><div class="tx"><b>${E(T('{name} wants to message you', { name: lb.dm.n }))}</b>` +
            `<small>${E(T('They aren’t your friend yet. Accept to write back, or ignore it: they won’t be told either way.'))}</small></div>` +
            fc.ui.btn('Accept', { kind: 'brand', size: 'sm', icon: 'check', act: 'dm-accept' }) + fc.ui.btn('Ignore', { kind: 'sec', size: 'sm', act: 'dm-ignore' }) +
            fc.ui.btn('Block', { kind: 'danger', size: 'sm', icon: 'ban', act: 'dm-block' }) + '</div>';
    }
    const D = lb.dm ? mod('dms') : null;
    if (D && D.canWrite && !D.canWrite(lb.dm.pk)) {
        if (lb.dm.old) return `<div class="fclbGone">${fc.ui.icon('lock')}${E(T('This was {name}’s old PC. Write to them in their new DM.', { name: lb.dm.n }))}</div>`;
        return `<div class="fclbGone">${fc.ui.icon('lock')}${E(T('You can’t message {name} any more: you aren’t friends.', { name: lb.dm.n }))}${fc.ui.btn('Add friend', { kind: 'brand', size: 'sm', icon: 'userPlus', act: 'dm-addfriend' })}</div>`;
    }
    const up = mod('uploads');
    const tools = up && up.offer ? [`<span class="fclbBt plus" data-act="lb-file" title="${E(T('Send a picture, GIF, clip or audio file'))}">${fc.ui.icon('plus')}</span>`,
        `<span class="fclbBt gif" data-act="lb-gif" title="${E(T('GIFs and favorites'))}">GIF</span>`] : ['', ''];
    const em = mod('emoji');
    const smile = em && em.pick ? `<span class="fclbBt" data-act="lb-emoji" title="${E(T('Emoji'))}">${fc.ui.icon('smile')}</span>` : '';
    const stk = up && up.openPicker ? `<span class="fclbBt" data-act="lb-sticker" title="${E(T('Stickers'))}">${fc.ui.icon('sticker')}</span>` : '';
    const ph = lb.dm ? T('Message @{name}', { name: dmName(lb) }) : lb.group ? T('Message {group}', { group: groupName(lb) }) : T('Message {lobby}', { lobby: lb.name });
    return `<div class="fclbBox fcupHost">${tools[0]}<textarea class="fclbIn" rows="1" maxlength="${MAX_TEXT}" placeholder="${E(ph)}"></textarea>${tools[1]}${stk}${smile}</div>`;
}
// the box's Enter for uploads (uploads.js sends what you typed with the file's link through this)
function wireBox(foot) {
    const t = foot.querySelector('.fclbIn');
    if (!t) return;
    t.fcupSend = (text) => {
        if (!send(view.id, text, view.re)) return;
        t.value = ''; t.style.height = 'auto'; view.stick = true;
        if (view.re) { view.re = ''; renderPage(); }
    };
}

// the DM's bar: who, how they are, and Call / Challenge
function dmTopHtml(L) {
    const d = L.lb.dm, st = statusOf(L, d.pk);
    const inCall = !!(vr && vr.id === L.lb.id);
    const out = !!(ringing && ringing.id === L.lb.id && ringing.out);
    const D = mod('dms');
    const warn = D && D.warning ? D.warning(d.pk) : '';
    const sub = st.v ? T('In the call') : T(ST_TEXT[st.st] || 'Offline');
    const name = dmName(L.lb), can = !L.lb.req && !d.old;
    return `<span class="ti dm" data-who="${E(d.pk)}">${fc.ui.avatar(d.n, { size: 24, status: st.on ? st.st : 'off' }).replace(/src="[^"]*"/, `src="${E(fc.data.avatarUrl(d.n, d.g, 48))}"`)}<b>${E(name)}</b>` +
        (warn ? `<i class="mk dup" title="${E(warn)}">${fc.ui.icon('warn')}</i>` : '') + `</span><span class="sub">${E(inCall && out && !st.v ? T('Calling…') : sub)}</span>` +
        `<span class="tl">` +
        (can && !inCall ? topB('dm-call', 'phone', st.v ? T('Join the call') : T('Start a voice call')) + topB('dm-video', 'video', T('Start a video call')) : '') +
        pinsBtn(L) + (can && D && D.isFriendPk && D.isFriendPk(d.pk) ? topB('dm-group', 'userPlus', T('Add friends to DM')) : '') +
        (L.lb.req ? '' : fc.ui.btn('Challenge', { kind: 'sec', size: 'sm', icon: 'sword', act: 'dm-chal', title: T('Challenge {name} to a set', { name }) })) +
        `<span class="fclbSrchSlot"></span></span>`;
}

function membersHtml(L) {
    const dupes = L.room.dupes();
    const king = L.room.king();
    const list = L.room.active().map(m => Object.assign({ m }, statusOf(L, m.pk)));
    if (L.pk && !list.find(x => x.m.pk === L.pk) && !L.lb.removed) list.push(Object.assign({ m: { pk: L.pk, n: me(), g: myGravatar() } }, statusOf(L, L.pk)));
    const rank = (pk) => (pk === L.room.owner ? 0 : L.room.isMod(pk) ? 1 : 2);
    const sort = (a, b) => rank(a.m.pk) - rank(b.m.pk) || lc(nameOf(L, a.m.pk, a.m.n)).localeCompare(lc(nameOf(L, b.m.pk, b.m.n)));
    const on = list.filter(x => x.on).sort(sort), off = list.filter(x => !x.on).sort(sort);
    const row = (x) => {
        const m = x.m, name = nameOf(L, m.pk, m.n);
        const sub = x.v ? T('In the voice room') : T(ST_TEXT[x.st] || 'Online');
        return `<div class="fclbM${x.on ? '' : ' off'}" data-who="${E(m.pk)}"${name !== m.n ? ` title="${E(m.n)}"` : ''}>` +
            fc.ui.avatar(m.n, { size: 32, status: x.on ? x.st : '' }).replace(/src="[^"]*"/, `src="${E(fc.data.avatarUrl(m.n, m.g, 64))}"`) +
            `<span class="tx"><b><span class="nm">${E(name)}</span>${marks(L, m.pk, king)}${dupes.has(m.pk) ? `<i class="mk dup" title="${E(T('Another member uses this name too — this may not be who you think'))}">${fc.ui.icon('warn')}</i>` : ''}</b>` +
            (x.on ? `<small>${x.v ? fc.ui.icon('speaker') : ''}${E(sub)}</small>` : '') + '</span></div>';
    };
    return `<div class="fclbMh">${E(T('Online — {n}', { n: on.length }))}</div>${on.map(row).join('')}` +
        (off.length ? `<div class="fclbMh">${E(T('Offline — {n}', { n: off.length }))}</div>${off.map(row).join('')}` : '');
}

function eventsHtml(L) {
    const list = L.room.events();
    const mod = canMod(L);
    if (!list.length) {
        return fc.ui.empty({ icon: 'calendar', title: N_('No events planned'), sub: mod ? N_('Plan one: everyone who says they’re going gets a reminder.') : N_('The owner and moderators can plan events here.'),
            action: mod ? N_('Plan an event') : '', act: 'lb-plan' });
    }
    return list.map(ev => {
        const d = new Date(ev.when);
        const mine = ev.going.indexOf(L.pk) >= 0 ? true : ev.not.indexOf(L.pk) >= 0 ? false : null;
        const live = ev.when <= now();
        const faces = ev.going.slice(0, 6).map(pk => { const m = L.room.members.get(pk) || (pk === L.pk ? { n: me(), g: myGravatar() } : null); return m ? `<span title="${E(nameOf(L, pk, m.n))}">${avatarOf(m.n, m.g, 24)}</span>` : ''; }).join('');
        return `<div class="fclbEv${live ? ' live' : ''}" data-ev="${E(ev.e)}"><div class="dt"><small>${E(d.toLocaleDateString(locale(), { weekday: 'short' }))}</small><b>${d.getDate()}</b>` +
            `<small>${E(d.toLocaleDateString(locale(), { month: 'short' }))}</small></div><div class="bd">` +
            `<div class="tt"><b>${E(ev.title)}</b>${ev.ft ? `<span class="ft">FT${ev.ft}</span>` : ''}${live ? `<span class="lv">${E(T('Happening now'))}</span>` : ''}</div>` +
            `<div class="wh">${fc.ui.icon('clock')}${E(whenEv(ev.when))} · ${E(soonText(ev.when))} · ${Th('by {name}', 'name', E(nameOf(L, ev.by)))}</div>` +
            (ev.desc ? `<p>${richText(ev.desc, '')}</p>` : '') +
            `<div class="go">${faces}<span class="cnt">${E(fc.t.plural(ev.going.length, '{n} going', '{n} going'))}</span></div></div><div class="ac">` +
            fc.ui.btn('Going', { kind: mine === true ? 'success' : 'sec', size: 'sm', icon: 'check', act: 'lb-rsvp', attrs: `data-e="${E(ev.e)}" data-go="1"` }) +
            fc.ui.btn('Can’t make it', { kind: mine === false ? 'danger' : 'ghost', size: 'sm', act: 'lb-rsvp', attrs: `data-e="${E(ev.e)}" data-go="0"` }) +
            (mod ? fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'trash', act: 'lb-evx', title: 'Cancel the event', attrs: `data-e="${E(ev.e)}"` }) : '') + '</div></div>';
    }).join('');
}

function monthStart() { const d = new Date(now()); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function boardHtml(L) {
    const since = view.range === 'month' ? monthStart() : 0;
    const rows = L.room.board(since);
    const king = L.room.king();
    const note = `<p class="fclbBoardNote">${E(T('Sets between lobby members in {game} count by themselves, once both players report the same result (both need Fightcord 3.0). King of the lobby: the top player with 5 or more sets.', { game: gameName(L.lb) }))}</p>`;
    if (!rows.length) return `<div class="fc-empty">${fc.ui.icon('trophy')}<div class="t">${E(view.range === 'month' ? T('No sets this month yet') : T('No sets yet'))}</div></div>` + note;
    return `<div class="fclbBoard"><div class="hr"><span class="n">#</span><span class="p">${E(T('Player'))}</span><span>${E(T('W–L'))}</span><span>${E(T('Win %'))}</span><span>${E(T('Streak'))}</span><span>${E(T('Rating'))}</span></div>` +
        rows.map((x, i) => {
            const m = L.room.members.get(x.pk) || {};
            const name = nameOf(L, x.pk, m.n);
            const streak = x.streak >= 2 ? `<span class="hot">${fc.ui.icon('flame')}${x.streak}</span>` : x.streak <= -2 ? `<span class="cold">${E(T('{n} lost', { n: -x.streak }))}</span>` : '—';
            return `<div class="r${i < 3 ? ' top' + (i + 1) : ''}${x.pk === L.pk ? ' me' : ''}" data-who="${E(x.pk)}"><span class="n">${i + 1}</span><span class="p">${avatarOf(m.n || name, m.g, 28)}<b>${E(name)}</b>${marks(L, x.pk, king)}</span>` +
                `<span>${x.w}–${x.l}</span><span>${Math.round(100 * x.w / Math.max(1, x.sets))}%</span><span>${streak}</span><span class="elo">${x.elo}</span></div>`;
        }).join('') + '</div>' + note;
}

function renderPage(first) {
    if (!view.page) return;
    const home = view.id === HOME;
    const L = home ? null : rooms.get(view.id);
    if (!home && !L) { view.page.close(); return; }
    const D = mod('dms');
    const dm = view.mode === 'dm';
    const body = view.page.body;
    if (!body.querySelector('.fclbWrap')) {
        body.innerHTML = `<div class="fclbWrap"><div class="fclbSide" data-l3-dock="1"></div><div class="fclbMain fcupArea"><div class="fclbTop"></div><div class="fclbStage"></div><div class="fclbLog"></div><div class="fclbPane"></div>` +
            `<div class="fclbReply"></div><div class="fclbFoot"></div><div class="fclbTyp"></div><div class="fclbHl"></div><div class="fclbTb"></div></div><div class="fclbMem"></div></div>`;
    }
    // what had the keyboard (the editor and the search box are kept between renders)
    const act = typeof document !== 'undefined' ? document.activeElement : null;
    const edFocus = view.edEl && act && view.edEl.contains(act) ? { start: act.selectionStart, end: act.selectionEnd } : null;
    const srFocus = !!(view.srch && act && view.srch.contains(act));
    const set = (sel, html) => { const el = body.querySelector(sel); fc.ui.setHtml(el, html); return el; };
    const tab = home ? 'home' : view.tab || 'chat';
    view.page.setTitle(home ? T('Friends') : L.lb.name);
    const main = body.querySelector('.fclbMain');
    if (main.dataset.tab !== tab) { main.dataset.tab = tab; hideTb(); }
    body.querySelector('.fclbWrap').classList.toggle('dm', dm);
    // the DM page: the DM list on the left; the Friends view (HOME) or a DM on the right
    if (dm) set('.fclbSide', D && D.sideHtml ? D.sideHtml(view.id) : '');
    if (home) {
        set('.fclbTop', D && D.homeTopHtml ? D.homeTopHtml() : '');
        set('.fclbPane', D && D.homeHtml ? D.homeHtml() : '');
        set('.fclbMem', D && D.activeHtml ? D.activeHtml() : '');
        set('.fclbTb', ''); set('.fclbReply', ''); set('.fclbTyp', ''); set('.fclbStage', '');
        body.querySelector('.fclbWrap').classList.remove('srch');
        const f = body.querySelector('.fclbFoot');
        if (f.__k !== 'home') { f.__k = 'home'; f.innerHTML = ''; }
        return;
    }
    main.style.setProperty('--lc', L.lb.dm ? fc.data.hashColor(L.lb.dm.n) : colOf(L.lb.id, lookOf(L)));
    if (!dm) set('.fclbSide', sideHtml(L));
    const searching = !!view.q && tab === 'chat';
    body.querySelector('.fclbWrap').classList.toggle('srch', searching);
    set('.fclbMem', searching ? searchHtml(L) : L.lb.dm ? (D && D.profileHtml ? D.profileHtml(L.lb.dm.pk) : '') : L.lb.group ? groupMembersHtml(L) : membersHtml(L));
    placeSearch(set('.fclbTop', L.lb.dm ? dmTopHtml(L) : L.lb.group ? groupTopHtml(L) : topHtml(L)), srFocus);
    set('.fclbTb', toolbarHtml(L));
    set('.fclbReply', replyHtml(L));
    set('.fclbTyp', tab === 'chat' ? typingHtml(L) : '');
    renderStage(body.querySelector('.fclbStage'), L);
    const foot = body.querySelector('.fclbFoot');
    const until = L.pk ? L.room.muteEnd(L.pk, now()) : 0;
    view.muteEnd = until;
    const want = L.lb.removed ? 'removed' : L.lb.closed ? 'closed' : until ? 'muted:' + until : L.lb.req ? 'req:' + L.lb.id : 'box:' + L.lb.id + (L.lb.dm && D && D.canWrite && !D.canWrite(L.lb.dm.pk) ? ':no' : '');
    if (foot.__k !== want) { foot.__k = want; foot.innerHTML = boxHtml(L); wireBox(foot); }
    if (tab === 'chat') {
        const log = body.querySelector('.fclbLog');
        const html = chatHtml(L) + (!L.loaded && pool ? `<div class="fclbLoad">${E(T('Loading messages…'))}</div>` : '');
        if (log.__html !== html) { log.__html = html; log.innerHTML = html; }
        fillEmbeds(log);
        placeEditor(log, edFocus);
        // at the bottom stays at the bottom (also when the reply bar takes some room)
        if ((first || view.stick) && log.scrollTop < log.scrollHeight - log.clientHeight) log.scrollTop = log.scrollHeight;
    } else set('.fclbPane', tab === 'events' ? eventsHtml(L) : boardHtml(L));
    if (view.page.el.contains(document.activeElement) || first) markReadQuiet(L);
    voiceTickClasses();
    // a new member's first look at the lobby (once the owner's welcome has arrived)
    if (!L.lb.welcomed && L.loaded && L.pk && L.pk !== L.room.owner && L.room.settings && L.room.settings.welcome && view.welcomed !== L.lb.id) {
        view.welcomed = L.lb.id;
        setTimeout(() => { if (view.page && view.id === L.lb.id) welcomeCard(L); }, 300);
    }
}
function markReadQuiet(L) { if (view.hold === L.lb.id) return; if (unread(L).n) { L.lb.lastRead = now(); store.save(); setTimeout(renderRail, 0); } }

// "{name} is typing…" under the box
function typingHtml(L) {
    if (!L.typing || !L.typing.size) return '';
    const t = now();
    const D = mod('dms');
    const who = [...L.typing].filter(([pk, at]) => pk !== L.pk && t - at < TYPING_MS && !(D && D.blocked && D.blocked(pk))).map(([pk]) => nameOf(L, pk));
    if (!who.length) return '';
    const b = (n) => `<b>${E(n)}</b>`;
    const txt = who.length === 1 ? Th('{name} is typing…', 'name', b(who[0]))
        : who.length === 2 ? Th('{a} and {b} are typing…', 'a', b(who[0]), { b: '\u0002' }).replace('\u0002', b(who[1]))
            : who.length === 3 ? Th('{a}, {b} and {c} are typing…', 'a', b(who[0]), { b: '\u0002', c: '\u0003' }).replace('\u0002', b(who[1])).replace('\u0003', b(who[2]))
                : E(T('Several people are typing…'));
    return `<span class="dots"><i></i><i></i><i></i></span><span>${txt}</span>`;
}
function voiceTickClasses() { if (vr) vr.talkKey = null; }

function onLogScroll(e) {
    const log = e.target;
    if (!log.classList || !log.classList.contains('fclbLog')) return;
    view.stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
    hideTb();
}

// the toolbar (and the hover shade behind the message) follow the mouse over messages: moved, not
// re-made, so nothing new goes into the page
function onPageOver(e) {
    if (!view.page) return;
    const tb = view.page.body.querySelector('.fclbTb');
    if (!tb || e.target.closest('.fclbTb')) return;
    const ln = e.target.closest('.fclbLog .ln[data-mid]');
    if (!ln || ln.classList.contains('editing')) { hideTb(); return; }
    if (tb.dataset.mid === ln.dataset.mid) return;
    const main = tb.parentNode, r = ln.getBoundingClientRect(), mr = main.getBoundingClientRect();
    const log = main.querySelector('.fclbLog').getBoundingClientRect();
    // the first message of a group takes its name line (and reply) along
    const first = ln.parentNode.querySelector('.ln') === ln;
    const top = (first ? ln.closest('.fclbG').getBoundingClientRect().top : r.top - 2) - mr.top;
    const hl = main.querySelector('.fclbHl');
    const y0 = Math.max(top, log.top - mr.top), y1 = Math.min(r.bottom + 2 - mr.top, log.bottom - mr.top);
    hl.style.top = y0 + 'px';
    hl.style.height = Math.max(0, y1 - y0) + 'px';
    hl.classList.add('on');
    tb.dataset.mid = ln.dataset.mid;
    if (!tb.firstChild) return;
    tb.style.top = Math.max(top - 16, log.top - mr.top + 4) + 'px';
    tb.classList.add('on');
    const pinned = ln.classList.contains('pinned');
    const p = tb.querySelector('[data-tb="pin"]');
    if (p) { p.classList.toggle('on', pinned); p.title = pinned ? T('Unpin message') : T('Pin message'); }
    // your own message: Edit (in place of nothing); someone else's: no Edit
    const ed = tb.querySelector('[data-tb="edit"]');
    if (ed) ed.classList.toggle('hid', !ln.dataset.own);
}
function hideTb() {
    if (!view.page) return;
    const tb = view.page.body.querySelector('.fclbTb');
    if (tb) { tb.classList.remove('on'); tb.dataset.mid = ''; }
    const hl = view.page.body.querySelector('.fclbHl');
    if (hl) hl.classList.remove('on');
}

function onPageInput(e) {
    const t = e.target;
    if (t.classList.contains('fclbSrchIn')) { clearTimeout(view.qT); view.qT = setTimeout(() => setSearch(t.value), 250); return; }
    if (t.classList.contains('fclbEdIn')) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 300) + 'px'; return; }
    if (!t.classList.contains('fclbIn')) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 220) + 'px';
    if (t.value.trim() && t.value[0] !== '/') typing(rooms.get(view.id));
}
function onPageKey(e) {
    e.stopPropagation();                              // Fightcade's chat shortcuts stay out
    const t = e.target;
    if (view.mode === 'dm') { const D = mod('dms'); if (D && D.pageKey && D.pageKey(e)) return; }
    if (!t.classList) return;
    if (t.classList.contains('fclbSrchIn')) {
        if (e.key === 'Enter') { e.preventDefault(); clearTimeout(view.qT); setSearch(t.value); }
        else if (e.key === 'Escape' && t.value) { e.preventDefault(); clearSearch(); }
        return;
    }
    if (t.classList.contains('fclbEdIn')) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); stopEdit(); }
        return;
    }
    if (!t.classList.contains('fclbIn')) return;
    // ↑ in an empty box: edit your last message, like Discord
    if (e.key === 'ArrowUp' && !t.value) {
        const L = rooms.get(view.id);
        const last = L && L.room.visible().filter(m => !m.sys && m.pk === L.pk).pop();
        if (last) { e.preventDefault(); startEdit(L, last.id); }
        return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (send(view.id, t.value, view.re)) {
            t.value = ''; t.style.height = 'auto'; view.stick = true; view.limit = 0;
            // writing reads the chat (a Mark Unread ends here)
            if (view.hold === view.id) { view.hold = ''; markRead(view.id); }
            if (view.re) { view.re = ''; renderPage(); }
        }
    }
}
// a right-click on a message: its menu
function onPageContext(e) {
    if (view.mode === 'dm') { const D = mod('dms'); if (D && D.pageContext && D.pageContext(e)) { e.preventDefault(); return; } }
    const ln = e.target.closest('.fclbLog .ln[data-mid]');
    const L = rooms.get(view.id);
    if (!ln || !L || ln.classList.contains('editing') || e.target.closest('a, img, video, textarea')) return;
    e.preventDefault();
    msgMenu({ x: e.clientX, y: e.clientY }, L, ln.dataset.mid);
}

// a message link: that chat, at that message
function openMsgLink(s) {
    const [id, mid] = String(s || '').split('/');
    const lb = lobbyById(id);
    if (!lb) { fc.ui.toast(T('You aren’t in that chat'), { icon: 'lock', sub: T('Message links only open for people in the chat.') }); return; }
    if (view.id !== id || !view.page) openLobby(id);
    setTimeout(() => jumpTo(mid), 80);
}

/* ================================================================ 3.8: search */

// "from:name has:image words" -> { words, from, has }
function parseQuery(q) {
    const o = { words: [], from: '', has: '' };
    String(q || '').trim().split(/\s+/).forEach(w => {
        const m = w.match(/^(from|has):(.+)$/i);
        if (m) o[m[1].toLowerCase()] = m[2].toLowerCase().replace(/^@/, '');
        else if (w) o.words.push(w.toLowerCase());
    });
    return o;
}
const HAS = {
    link: (u) => !!u,
    image: (u) => /\.(png|jpe?g|gif|webp)(\?|#|$)|klipy\.com\/gifs|tenor\.com|giphy\.com/i.test(u),
    video: (u) => /\.(mp4|webm|mov)(\?|#|$)|youtu\.?be|streamable\.com|twitch\.tv/i.test(u),
    file: (u) => /catbox\.moe|uguu\.se|\.(mp3|ogg|wav|m4a|flac|zip|7z|rar)(\?|#|$)/i.test(u),
    sticker: (u) => /klipy\.com\/stickers\//i.test(u)
};
HAS.gif = HAS.image; HAS.embed = HAS.link; HAS.audio = HAS.file;
// one message against a parsed search; who(m) -> the names it goes by
function matches(m, o, who) {
    if (!m || m.sys) return false;
    if (!o.words.length && !o.from && !o.has) return false;
    const x = lc(m.x);
    if (o.from && !who(m).some(n => lc(n).indexOf(o.from) >= 0)) return false;
    if (o.has) { const test = HAS[o.has]; const u = (String(m.x).match(URL_IN) || [])[0] || ''; if (!test || !test(u)) return false; }
    return o.words.every(w => x.indexOf(w) >= 0);
}
function setSearch(q) {
    const v = String(q || '').trim();
    if (v === (view.q || '')) return;
    view.q = v;
    renderPage();
}
function clearSearch() {
    view.q = '';
    if (view.srch) view.srch.querySelector('input').value = '';
    renderPage();
}
function searchHtml(L) {
    const o = parseQuery(view.q);
    const who = (m) => [nameOf(L, m.pk, m.n), m.n];
    const hits = L.room.visible().filter(m => matches(m, o, who)).reverse().slice(0, 100);
    const mark = (s) => { let h = E(fc.fmt.short(s.replace(/\s+/g, ' '), 300)); o.words.forEach(w => { const re = new RegExp('(' + E(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'); h = h.replace(re, '<mark>$1</mark>'); }); return h; };
    let lastDay = '';
    const rows = hits.map(m => {
        const day = new Date(m.at).toLocaleDateString(locale(), { year: 'numeric', month: 'long', day: 'numeric' });
        const head = day !== lastDay ? `<div class="sd">${E(day)}</div>` : '';
        lastDay = day;
        const name = nameOf(L, m.pk, m.n);
        return head + `<div class="hit" data-sr="${E(m.id)}">${avatarOf(m.n, (L.room.members.get(m.pk) || {}).g || m.g, 32)}<div class="bd"><div class="hd"><b style="color:${fc.data.hashColor(m.n)}">${E(name)}</b>` +
            `<time>${E(when(m.at))}</time></div><div class="tx">${mark(m.x)}</div></div></div>`;
    }).join('');
    return `<div class="fclbRes"><div class="rh"><b>${E(fc.t.plural(hits.length, '{n} result', '{n} results'))}</b><span class="x" data-sr="x" title="${E(T('Clear the search'))}">${fc.ui.icon('close')}</span></div>` +
        (hits.length ? rows : fc.ui.empty({ icon: 'search', title: N_('No results'), sub: N_('Try other words, from:name or has:link, image, video, file or sticker.') })) +
        (L.room.msgs.length >= 600 ? `<p class="more">${E(T('Searches the messages loaded on this PC (the newest 600).'))}</p>` : '') + '</div>';
}
// the search box: one element, kept between renders (it would lose what you typed)
function searchBox() {
    if (!view.srch) {
        const s = document.createElement('label');
        s.className = 'fclbSrch';
        s.innerHTML = `<input class="fclbSrchIn" maxlength="120" spellcheck="false" placeholder="${E(T('Search'))}">${fc.ui.icon('search')}`;
        view.srch = s;
    }
    return view.srch;
}
function placeSearch(top, focused) {
    const slot = top.querySelector('.fclbSrchSlot');
    if (!slot) return;
    const s = searchBox();
    if (s.parentNode !== slot) slot.appendChild(s);
    if (focused) s.querySelector('input').focus();
}

function toggleReact(L, mid, e) {
    const x = L.room.reactions(mid).find(r => r.e === e);
    react(L.lb.id, mid, e, !(x && x.pks.indexOf(L.pk) >= 0));
}
function jumpTo(mid) {
    if (view.tab !== 'chat') { view.tab = 'chat'; renderPage(); }
    const find = () => { const log = view.page && view.page.body.querySelector('.fclbLog'); return log && [...log.querySelectorAll('.ln[data-mid]')].find(x => x.dataset.mid === mid); };
    let ln = find();
    // further back than what's drawn (search, a message link): draw back to it
    const L = rooms.get(view.id);
    if (!ln && L) {
        const vis = L.room.visible(), i = vis.findIndex(m => m.id === mid);
        if (i >= 0) { view.limit = vis.length - i + 20; renderPage(); ln = find(); }
    }
    if (!ln) { fc.ui.toast(T('That message is too far back to show'), { icon: 'info' }); return; }
    view.stick = false;
    ln.scrollIntoView({ block: 'center' });
    ln.classList.remove('flash');
    void ln.offsetWidth;
    ln.classList.add('flash');
    setTimeout(() => ln.classList.remove('flash'), 1800);
}

function onPageClick(e) {
    // the DM list, the Friends view, the profile: the DMs module's
    if (view.mode === 'dm') { const D = mod('dms'); if (D && D.pageClick && D.pageClick(e, view.id)) return; }
    const L = rooms.get(view.id);
    if (!L) return;
    const bt = e.target.closest('[data-act]');
    const act0 = bt && bt.dataset.act;
    if (act0 === 'lb-file' || act0 === 'lb-gif' || act0 === 'lb-emoji' || act0 === 'lb-sticker') {
        const t = view.page.body.querySelector('.fclbIn'), up = mod('uploads');
        if (!t) return;
        if (act0 === 'lb-file' && up && up.pick) up.pick(t);
        else if (act0 === 'lb-gif' && up && up.openPicker) up.openPicker(bt, t);
        else if (act0 === 'lb-sticker' && up && up.openPicker) up.openPicker(bt, t, 'stickers');
        else if (act0 === 'lb-emoji') { const em = mod('emoji'); if (em && em.pick) em.pick(bt, (emoji) => { t.value += emoji; t.focus(); }); }
        return;
    }
    // the call bar (3.8): camera, screen, mute, leave, a tile to watch big
    const cb = e.target.closest('[data-cb]');
    if (cb) { callBarClick(cb, L); return; }
    if (L.lb.dm || L.lb.group) {
        if (act0 === 'dm-call' || act0 === 'dm-video') { call(L.lb.id, act0 === 'dm-video'); return; }
        const D = mod('dms');
        if (act0 === 'dm-group' && L.lb.dm) { if (D && D.groupPicker) D.groupPicker(bt, { with: [L.lb.dm.pk] }); return; }
        if (act0 === 'gp-add') { if (D && D.groupPicker) D.groupPicker(bt, { into: L.lb.id }); return; }
        if (act0 === 'gp-name') { renameModal(L); return; }
        if (act0 === 'lb-leave' && L.lb.group) { leave(L.lb.id); openLobby(HOME); return; }
        if (L.lb.group) {
            const gw = e.target.closest('[data-who]');
            if (gw && !e.target.closest('[data-act]')) { groupMemberMenu(gw, L, gw.dataset.who); return; }
        }
    }
    if (L.lb.dm) {
        if (act0 === 'dm-chal') { dmChallenge(bt, L); return; }
        if (/^dm-(accept|ignore|block|addfriend)$/.test(act0 || '')) { const D = mod('dms'); if (D && D.act) D.act(act0.slice(3), L.lb.dm.pk); return; }
        const w = e.target.closest('[data-who]');
        if (w && !e.target.closest('[data-cb]')) { const sc = mod('scout'); const n = w.dataset.who === L.pk ? me() : L.lb.dm.n; if (sc && sc.openCard) sc.openCard(n, w.getBoundingClientRect(), 'beside'); return; }
    }
    const tb = e.target.closest('[data-tb]');
    if (tb) { toolbarClick(L, tb); return; }
    const rx = e.target.closest('[data-rx]');
    if (rx) { const ln = rx.closest('.ln[data-mid]'); if (ln) toggleReact(L, ln.dataset.mid, rx.dataset.rx); return; }
    const j = e.target.closest('[data-jump]');
    if (j) { jumpTo(j.dataset.jump); return; }
    const ml = e.target.closest('[data-ml]');
    if (ml) { openMsgLink(ml.dataset.ml); return; }
    const sr = e.target.closest('[data-sr]');
    if (sr) { if (sr.dataset.sr === 'x') clearSearch(); else jumpTo(sr.dataset.sr); return; }
    const tab = e.target.closest('.fclbTop .fc-tab[data-tab]');
    if (tab) { view.range = tab.dataset.tab; renderPage(); return; }
    const a = e.target.closest('[data-act]');
    const act = a && a.dataset.act;
    if (act === 'lb-invite') { inviteModal(L.lb.id); return; }
    if (act === 'lb-menu') { lobbyMenu(a, L); return; }
    if (act === 'lb-tab') { view.tab = a.dataset.tab; renderPage(); if (view.tab === 'chat') { const log = view.page.body.querySelector('.fclbLog'); log.scrollTop = log.scrollHeight; } return; }
    if (act === 'lb-pins') { pinsPop(a, L); return; }
    if (act === 'lb-plan' || act === 'empty') { planModal(L.lb.id); return; }
    if (act === 'lb-rsvp') { rsvp(L.lb.id, a.dataset.e, a.dataset.go === '1'); return; }
    if (act === 'lb-evx') {
        const ev = L.room.events().find(x => x.e === a.dataset.e);
        fc.ui.confirm(T('Cancel {event}?', { event: ev ? ev.title : '' }), T('It disappears for everyone, and nobody gets a reminder.'), { ok: T('Cancel the event'), danger: true, cancel: T('Keep it') })
            .then(ok => { if (ok) cancelEvent(L.lb.id, a.dataset.e); });
        return;
    }
    if (act === 'lb-reno') { view.re = ''; renderPage(); return; }
    if (act === 'lb-voice') { if (!(vr && vr.id === L.lb.id)) voiceJoin(L.lb.id); return; }
    if (act === 'lb-mute') { voiceMute(); return; }
    if (act === 'lb-cam') { setCam(!(vr && vr.cam)); return; }
    if (act === 'lb-scr') { setScreen(!(vr && vr.scr)); return; }
    if (act === 'lb-vleave') { voiceLeave(); return; }
    if (act === 'lb-leave') { leave(L.lb.id); return; }
    const link = e.target.closest('[data-href]');
    if (link) { const u = link.dataset.href; if (/^https?:\/\//.test(u)) { try { require('electron').shell.openExternal(u); } catch (err) { window.open(u, '_blank'); } } return; }
    const who = e.target.closest('[data-who]');
    if (who) memberMenu(who, L, who.dataset.who);
}

function toolbarClick(L, b) {
    const mid = b.closest('.fclbTb').dataset.mid;
    if (!mid) return;
    const what = b.dataset.tb;
    if (what === 'react') toggleReact(L, mid, b.dataset.e);
    else if (what === 'pick') { const em = mod('emoji'); if (em && em.pick) em.pick(b, (emoji) => toggleReact(L, mid, emoji)); }
    else if (what === 'reply') {
        view.re = mid;
        hideTb();
        renderPage();
        const t = view.page.body.querySelector('.fclbIn');
        if (t) t.focus();
    } else if (what === 'pin') {
        togglePin(L, mid);
        hideTb();
    } else if (what === 'edit') { hideTb(); startEdit(L, mid); }
    else if (what === 'fwd') { hideTb(); forwardModal(L, mid); }
    else if (what === 'more') msgMenu(b, L, mid);
}
function togglePin(L, mid) {
    const on = !L.room.pinned().some(p => p.m === mid);
    if (pin(L.lb.id, mid, on)) fc.ui.toast(on ? T('Message pinned') : T('Message unpinned'), { icon: 'pin' });
}

/* ================================================ 3.8: what you can do with a message */

// Discord's message menu (the ⋯ on the toolbar, or a right-click on the message)
function msgMenu(anchor, L, mid) {
    const m = L.room.visible().find(x => x.id === mid);
    if (!m || m.sys) return;
    const id = L.lb.id, mine = m.pk === L.pk, live = !L.lb.removed && !L.lb.closed && !!L.pk;
    const em = mod('emoji');
    const items = [];
    if (live && em && em.pick) items.push({ label: T('Add Reaction'), icon: 'smile', fn: () => em.pick(anchor, (emoji) => toggleReact(L, mid, emoji)) });
    if (live && mine) items.push({ label: T('Edit Message'), icon: 'edit', fn: () => startEdit(L, mid) });
    if (live) items.push({ label: T('Reply'), icon: 'reply', fn: () => { view.re = mid; renderPage(); const t = view.page.body.querySelector('.fclbIn'); if (t) t.focus(); } });
    items.push({ label: T('Forward'), icon: 'forward', fn: () => forwardModal(L, mid) });
    items.push({ label: T('Copy Text'), icon: 'copy', fn: () => { fc.ui.copy(m.x); fc.ui.toast(T('Copied'), { icon: 'copy' }); } });
    if (canPin(L)) { const on = L.room.pinned().some(p => p.m === mid); items.push({ label: on ? T('Unpin Message') : T('Pin Message'), icon: 'pin', fn: () => togglePin(L, mid) }); }
    if (!mine) items.push({ label: T('Mark Unread'), icon: 'unread', fn: () => markUnread(L, mid) });
    items.push({ label: T('Copy Message Link'), icon: 'link', fn: () => { fc.ui.copy(msgLink(id, mid)); fc.ui.toast(T('Message link copied'), { icon: 'link', sub: T('It opens this message for anyone in this chat (with Fightcord 3.8).') }); } });
    if (canDelete(L, m)) { items.push('sep'); items.push({ label: T('Delete Message'), icon: 'trash', danger: true, fn: () => confirmDelete(L, mid) }); }
    hideTb();
    fc.ui.menu(anchor, items, { side: anchor.getBoundingClientRect ? 'left' : 'bottom' });
}

function confirmDelete(L, mid, quick) {
    const m = L.room.visible().find(x => x.id === mid);
    if (!m) return;
    const go = () => { if (deleteMsg(L.lb.id, mid)) { if (view.ed === mid) stopEdit(); changed(L.lb.id); } };
    if (quick) { go(); return; }
    const who = nameOf(L, m.pk, m.n);
    const body = `<p class="fclbDelQ">${E(T('Are you sure you want to delete this message?'))}</p><div class="fclbDelP">${avatarOf(m.n, m.g, 40)}<div class="bd"><div class="hd"><b style="color:${fc.data.hashColor(m.n)}">${E(who)}</b><time>${E(when(m.at))}</time></div>` +
        `<div class="tx">${richText(fc.fmt.short(m.x, 400), me())}</div></div></div>`;
    fc.ui.modal({ title: T('Delete Message'), body, width: 440, actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Delete'), kind: 'danger', fn: go }] });
}

// edit in place: one editor, moved into the message's slot after every render (so what you type stays)
function startEdit(L, mid) {
    const m = L.room.visible().find(x => x.id === mid);
    if (!m || m.pk !== L.pk || L.lb.removed || L.lb.closed) return;
    view.ed = mid;
    if (!view.edEl) {
        const box = document.createElement('div');
        box.className = 'fclbEditor';
        box.innerHTML = `<div class="fclbBox"><textarea class="fclbEdIn" rows="1" maxlength="${MAX_TEXT}"></textarea></div>` +
            `<div class="hint">${E(T('Esc to'))} <a data-ed="x">${E(T('cancel'))}</a> · ${E(T('Enter to'))} <a data-ed="ok">${E(T('save'))}</a></div>`;
        box.addEventListener('click', (e) => { const a = e.target.closest('[data-ed]'); if (!a) return; e.stopPropagation(); if (a.dataset.ed === 'ok') saveEdit(); else stopEdit(); });
        view.edEl = box;
    }
    const ta = view.edEl.querySelector('textarea');
    ta.value = m.x;
    renderPage();
    setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 300) + 'px';
        const ln = ta.closest('.ln'); if (ln && ln.scrollIntoView) ln.scrollIntoView({ block: 'nearest' });
    }, 0);
}
function stopEdit() {
    if (!view.ed) return;
    view.ed = '';
    if (view.edEl && view.edEl.parentNode) view.edEl.parentNode.removeChild(view.edEl);
    renderPage();
    const t = view.page && view.page.body.querySelector('.fclbIn');
    if (t) t.focus();
}
function saveEdit() {
    const L = rooms.get(view.id), mid = view.ed;
    if (!L || !mid || !view.edEl) return;
    const x = view.edEl.querySelector('textarea').value.trim();
    const m = L.room.visible().find(y => y.id === mid);
    // emptied: that's a delete, like Discord asks
    if (!x) { stopEdit(); confirmDelete(L, mid); return; }
    if (m && x !== m.x) editMsg(L.lb.id, mid, x);
    stopEdit();
}
// after a render: the editor back in its message (focused again when it was)
function placeEditor(log, focused) {
    if (!view.ed || !view.edEl) return;
    const slot = log.querySelector('.fclbEdSlot');
    if (!slot) { if (!rooms.get(view.id) || !rooms.get(view.id).room.visible().some(m => m.id === view.ed)) view.ed = ''; return; }
    if (view.edEl.parentNode !== slot) slot.appendChild(view.edEl);
    if (focused) { const ta = view.edEl.querySelector('textarea'); const a = focused.start, b = focused.end; ta.focus(); try { ta.setSelectionRange(a, b); } catch (e) { /* fine */ } }
}

// Mark Unread: from this message on, until you leave the chat
function markUnread(L, mid) {
    const m = L.room.msgs.find(x => x.id === mid);
    if (!m) return;
    L.lb.lastRead = m.at - 1;
    view.hold = L.lb.id;
    view.newAt = m.at - 1;
    store.save();
    changed(L.lb.id);
}

// Forward: the message (with who wrote it) to up to 5 chats, and a note of yours if you like
function forwardTargets() {
    const D = mod('dms');
    return cfg.lobbies.filter(lb => !lb.removed && !lb.closed && !lb.req && !(lb.dm && (lb.dm.old || (D && D.blocked && D.blocked(lb.dm.pk))))).map(lb => {
        const L = rooms.get(lb.id);
        const last = L ? (L.room.msgs.filter(m => !m.sys).slice(-1)[0] || {}).at || 0 : 0;
        return { id: lb.id, lb, label: chatLabel(lb), at: Math.max(last, lb.joinedAt || 0), kind: lb.dm ? 'dm' : lb.group ? 'group' : 'lobby' };
    }).sort((a, b) => b.at - a.at);
}
function forwardModal(L, mid) {
    const m = L.room.visible().find(x => x.id === mid);
    if (!m) return;
    const all = forwardTargets();
    const picked = new Set();
    const box = document.createElement('div');
    box.className = 'fclbFwd';
    const rowIcon = (t) => {
        if (t.lb.dm) return avatarOf(t.lb.dm.n, t.lb.dm.g, 32);
        if (t.lb.group) { const G = rooms.get(t.id); return G ? groupIcon(G, 32) : fc.ui.icon('users'); }
        const look = lookOf(rooms.get(t.id));
        return `<span class="lic" style="--c:${colOf(t.id, look)}">${iconInner(t.lb.name, look)}</span>`;
    };
    const draw = () => {
        const q = lc(box.querySelector('.fclbFwdQ') ? box.querySelector('.fclbFwdQ').value : '');
        const list = all.filter(t => !q || lc(t.label).indexOf(q) >= 0);
        fc.ui.setHtml(box.querySelector('.l'), list.length ? list.map(t => `<label class="r${picked.has(t.id) ? ' on' : ''}" data-fw="${E(t.id)}">${rowIcon(t)}<span class="nm">${E(t.label)}</span>` +
            `<small>${E(t.kind === 'dm' ? T('Direct message') : t.kind === 'group' ? T('Group DM') : T('Private lobby'))}</small><i class="ck">${fc.ui.icon('check')}</i></label>`).join('')
            : `<div class="fclbLook">${E(T('No chats found'))}</div>`);
        const b = mm.el.querySelector('.fc-modal-f [data-i="1"]');
        if (b) { b.disabled = !picked.size; b.textContent = picked.size > 1 ? T('Send to {n}', { n: picked.size }) : T('Send'); }
    };
    box.innerHTML = `<input class="fc-input fclbFwdQ" placeholder="${E(T('Search'))}"><div class="l"></div>` +
        `<div class="fclbFwdP"><div class="fwl">${fc.ui.icon('forward')}<i>${E(T('Forwarded'))}</i></div><div class="tx">${E(fc.fmt.short(m.x.replace(/\s+/g, ' '), 160))}</div></div>` +
        `<input class="fc-input fclbFwdN" maxlength="${MAX_TEXT}" placeholder="${E(T('Add an optional message…'))}">`;
    box.addEventListener('click', (e) => {
        const r = e.target.closest('[data-fw]');
        if (!r) return;
        e.preventDefault();
        if (picked.has(r.dataset.fw)) picked.delete(r.dataset.fw); else if (picked.size < 5) picked.add(r.dataset.fw);
        else fc.ui.toast(T('You can forward to 5 chats at once'), { icon: 'forward' });
        draw();
    });
    box.addEventListener('input', (e) => { if (e.target.classList.contains('fclbFwdQ')) draw(); });
    const fw = { n: nameOf(L, m.pk, m.n), at: m.at };
    const mm = fc.ui.modal({
        title: T('Forward To'), body: box, width: 460,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Send'), fn: (b) => {
            if (!picked.size) return false;
            const note = b.querySelector('.fclbFwdN').value.trim();
            let n = 0;
            picked.forEach(id => {
                if (send(id, m.x, '', fw)) n++;
                // (right after: past send's 500 ms limit, which is for typing too fast)
                if (note) setTimeout(() => { const R = rooms.get(id); if (R) R.lastSend = 0; send(id, note); }, 50);
            });
            fc.ui.toast(n ? T('Message forwarded') : T('Couldn’t forward the message'), { icon: 'forward', kind: n ? '' : 'warning' });
        } }]
    });
    keysInside(mm.el);
    draw();
    setTimeout(() => { const i = box.querySelector('.fclbFwdQ'); if (i) i.focus(); }, 30);
}

function pinsPop(anchor, L) {
    const list = L.room.pinned();
    const box = document.createElement('div');
    box.className = 'fclbPins';
    const mod = canMod(L);
    box.innerHTML = `<div class="h">${fc.ui.icon('pin')}<b>${E(T('Pinned messages'))}</b></div><div class="l">` + (list.length ? list.map(p => {
        const m = p.msg;
        if (!m) return `<div class="pi gone"><span>${E(T('A pinned message from before you joined'))}</span>${mod ? `<span class="x" data-unpin="${E(p.m)}" title="${E(T('Unpin'))}">${fc.ui.icon('close')}</span>` : ''}</div>`;
        const mm = L.room.members.get(m.pk) || {};
        const name = nameOf(L, m.pk, m.n);
        return `<div class="pi" data-jump="${E(p.m)}">${avatarOf(mm.n || m.n, mm.g || m.g, 32)}<div class="bd"><div class="hd"><b style="color:${fc.data.hashColor(mm.n || m.n)}">${E(name)}</b><time>${E(when(m.at))}</time></div>` +
            `<div class="tx">${richText(fc.fmt.short(m.x, 300), me())}</div></div>${mod ? `<span class="x" data-unpin="${E(p.m)}" title="${E(T('Unpin'))}">${fc.ui.icon('close')}</span>` : ''}</div>`;
    }).join('') : fc.ui.empty({ icon: 'pin', title: N_('No pinned messages yet'), sub: mod ? N_('Hover a message and press the pin to keep it here.') : N_('The owner and moderators can pin messages here.') })) + '</div>';
    const pop = fc.ui.popover(anchor, box, { side: anchor.closest('.fclbSide') ? 'right' : 'bottom', width: 380 });
    box.addEventListener('click', (e) => {
        const x = e.target.closest('[data-unpin]');
        if (x) { e.stopPropagation(); pin(L.lb.id, x.dataset.unpin, false); pop.close(); return; }
        const j = e.target.closest('[data-jump]');
        if (j) { pop.close(); jumpTo(j.dataset.jump); }
    });
}

function lobbyMenu(anchor, L) {
    const lb = L.lb, owner = L.pk && L.pk === L.room.owner;
    const NOTIFY = { mentions: N_('Only @mentions'), all: N_('All messages'), none: N_('Nothing') };
    const items = [{ label: T('Invite people'), icon: 'plus', fn: () => inviteModal(lb.id) }];
    if (owner && !lb.removed && !lb.closed) {
        items.push({ label: T('Lobby settings'), icon: 'gear', fn: () => settingsModal(lb.id) });
        items.push({ label: T('New invite code'), icon: 'refresh', fn: () => fc.ui.confirm(T('Make a new invite code?'), T('The old code stops working for new people. Everyone already in stays in.'), { ok: T('New code') }).then(ok => { if (ok && rekey(lb.id, [])) inviteModal(lb.id); }) });
    }
    if (canMod(L)) items.push({ label: T('Plan an event'), icon: 'calendar', fn: () => planModal(lb.id) });
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
    const id = L.lb.id;
    const iOwn = L.pk && L.pk === L.room.owner;
    const self = pk === L.pk;
    const name = nameOf(L, pk, m.n);
    const rect = anchor.getBoundingClientRect();
    const items = [];
    if (!self) {
        const st = statusOf(L, pk);
        if (st.on) items.push({ label: T('Challenge in {game}', { game: fc.fmt.short(gameName(L.lb), 24) }), icon: 'sword', fn: () => challenge(id, pk) });
    }
    const scout = mod('scout');
    if (scout && scout.openCard) items.push({ label: T('Scout card'), icon: 'search', fn: () => scout.openCard(m.n, null) });
    const box = view.page && view.page.el.querySelector('.fclbIn');
    if (!self && box) items.push({ label: T('Mention'), icon: 'at', fn: () => { box.value = '@' + m.n + ' ' + box.value; box.focus(); } });
    // the owner over everyone; a moderator over members (not the owner or other moderators)
    if (!self && canMod(L) && (iOwn || !L.room.canMod(pk)) && L.room.members.has(pk)) {
        items.push('sep');
        if (iOwn) {
            const isMod = L.room.isMod(pk);
            items.push({ label: isMod ? T('Remove as moderator') : T('Make moderator'), icon: 'shield', fn: () => {
                if (setMod(id, pk, !isMod)) fc.ui.toast(isMod ? T('{name} isn’t a moderator any more', { name }) : T('{name} is a moderator now', { name }), { icon: 'shield' });
            } });
        }
        items.push({ label: T('Change nickname'), icon: 'edit', fn: () => nickModal(id, pk) });
        if (L.room.muteEnd(pk, now())) items.push({ label: T('Unmute {name}', { name }), icon: 'mic', fn: () => { if (mute(id, pk, 0)) fc.ui.toast(T('{name} can write again', { name }), { icon: 'mic' }); } });
        else items.push({ label: T('Mute {name}…', { name }), icon: 'ban', fn: () => setTimeout(() => muteMenu(rect, L, pk, name), 0) });
        items.push({ label: T('Remove {name} from the lobby', { name }), icon: 'ban', danger: true, fn: () => fc.ui.confirm(T('Remove {name}?', { name }), T('Everyone else gets a new key automatically, so {name} can’t read anything new. Your invite code changes too.', { name }), { ok: T('Remove'), danger: true }).then(ok => {
            if (!ok) return;
            if (kick(id, pk)) fc.ui.toast(T('{name} was removed', { name }), { icon: 'ban' });
            else fc.ui.toast(T('Couldn’t remove {name} yet', { name }), { sub: T('The lobby’s settings are still loading. Try again in a moment.'), kind: 'warning' });
        }) });
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
.fclbIco .em { pointer-events: none; font-size: 22px; line-height: 1; }
.fclbIco .pic { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; pointer-events: none; }
.fclbIco.hasPic { background: var(--fc-s1); }
.fclbIco.hasPic:hover, .fclbIco.hasPic.on { box-shadow: 0 0 0 2px var(--c); }
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

#fcPage-lobby .fc-page-b, #fcPage-dms .fc-page-b { padding: 0; overflow: hidden; display: flex; }
.fclbWrap { display: flex; flex: 1; min-width: 0; min-height: 0; }
.fclbSide { flex: none; display: flex; flex-direction: column; width: 232px; background: var(--fc-s2); border-right: 1px solid var(--fc-divider); overflow: auto; }
.fclbMain { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--fc-s3); }
.fclbTop { display: flex; align-items: center; flex: none; height: 48px; padding: 0 12px 0 16px; box-sizing: border-box; border-bottom: 1px solid var(--fc-divider); }
.fclbTop .ti { display: flex; align-items: center; flex: none; color: var(--fc-head); font: 600 16px/1 var(--fc-font); }
.fclbTop .ti .fc-ic { width: 22px; height: 22px; margin-right: 8px; color: var(--fc-muted); }
.fclbTop .sub { flex: 1; min-width: 0; margin-left: 12px; padding-left: 12px; border-left: 1px solid var(--fc-divider); color: var(--fc-muted); font: 13px/18px var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbTop .sub:empty { border-left: 0; }
.fclbTop .tl { flex: none; display: flex; align-items: center; margin-left: 12px; }
.fclbTop .fc-tabs { border-bottom: 0; }
.fclbTop .fc-tab { margin: 0 0 0 16px; }
.fclbTopB { position: relative; display: flex; padding: 6px; border-radius: 6px; color: var(--fc-muted); cursor: pointer; }
.fclbTopB:hover { color: var(--fc-head); background: var(--fc-hover); }
.fclbTopB .fc-ic { width: 22px; height: 22px; }
.fclbTopB b { position: absolute; right: 0; bottom: 1px; min-width: 15px; height: 15px; padding: 0 3px; box-sizing: border-box; border-radius: 8px; background: var(--lc, var(--fc-accent));
    color: #fff; font: 700 10px/15px var(--fc-font); text-align: center; box-shadow: 0 0 0 2px var(--fc-s3); }
.fclbPane { display: none; flex: 1; min-height: 0; overflow-y: auto; padding: 16px; box-sizing: border-box; }
.fclbMain:not([data-tab="chat"]) .fclbPane { display: block; }
.fclbMain:not([data-tab="chat"]) .fclbLog, .fclbMain:not([data-tab="chat"]) .fclbFoot, .fclbMain:not([data-tab="chat"]) .fclbReply,
.fclbMain:not([data-tab="chat"]) .fclbTb, .fclbMain:not([data-tab="chat"]) .fclbHl { display: none; }
.fclbHl { position: absolute; left: 0; right: 0; z-index: 0; display: none; background: var(--fc-hover); pointer-events: none; }
.fclbHl.on { display: block; }
.fclbTb { position: absolute; right: 20px; z-index: 3; display: none; align-items: center; padding: 2px; border-radius: 8px; background: var(--fc-s2);
    box-shadow: 0 0 0 1px var(--fc-divider), 0 4px 12px rgba(0,0,0,.25); }
.fclbTb.on { display: flex; animation: fcPop .12s var(--fc-ease, ease-out) both; }
.fclbTb .b { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; color: var(--fc-muted); cursor: pointer;
    font: 18px/1 'Segoe UI Emoji', var(--fc-font); transition: transform .15s var(--fc-spring, ease-out), background-color .12s; }
.fclbTb .b:hover { background: var(--fc-hover); color: var(--fc-head); transform: scale(calc(1 + .12 * var(--fc-move, 1))); }
.fclbTb .b.on { color: var(--fc-danger); }
.fclbTb .b .fc-ic { width: 20px; height: 20px; }
.fclbMem { flex: none; width: 240px; padding: 8px 8px 16px; box-sizing: border-box; background: var(--fc-s2); border-left: 1px solid var(--fc-divider); overflow: auto; }

.fclbHd { display: flex; align-items: center; height: 48px; flex: none; padding: 0 12px 0 16px; border-bottom: 1px solid var(--fc-divider); cursor: pointer; color: var(--fc-head); font: 600 15px/1 var(--fc-font); }
.fclbHd:hover { background: var(--fc-hover); }
.fclbHd .nm { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbHd > .fc-ic { width: 18px; height: 18px; color: var(--fc-muted); }
.fclbGame { position: relative; flex: none; height: 96px; margin: 8px; border-radius: var(--fc-r2, 8px); overflow: hidden; background: var(--fc-s1) var(--art, none) center 30% / cover; image-rendering: pixelated; }
.fclbGame::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 60%; background: linear-gradient(transparent, rgba(0,0,0,.75)); }
.fclbGame.own { image-rendering: auto; background-position: center; }
.fclbGame .ico { position: absolute; left: 10px; bottom: 10px; z-index: 1; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 12px;
    overflow: hidden; background: var(--c); color: #fff; font: 700 13px/1 var(--fc-font); box-shadow: 0 0 0 2px rgba(0,0,0,.35); }
.fclbGame .ico .pic { width: 100%; height: 100%; object-fit: cover; }
.fclbGame .ico .em { font-size: 20px; line-height: 1; }
.fclbGame .gn { position: absolute; left: 56px; right: 10px; bottom: 19px; z-index: 1; display: flex; align-items: center; color: #fff; font: 600 13px/1.2 var(--fc-font);
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.fclbGame .gn .fc-ic { width: 15px; height: 15px; margin-right: 6px; flex: none; }
.fclbDesc { margin: 0 16px 4px; color: var(--fc-muted); font: 13px/1.4 var(--fc-font); word-wrap: break-word; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.fclbNext { display: flex; align-items: center; margin: 6px 8px 0; padding: 8px 10px; border-radius: 8px; background: var(--fc-s1); cursor: pointer; transition: background-color .15s; }
.fclbNext:hover { background: var(--fc-hover); }
.fclbNext > .fc-ic { width: 18px; height: 18px; margin-right: 10px; flex: none; color: var(--fc-success); }
.fclbNext .tx { min-width: 0; }
.fclbNext b { display: block; color: var(--fc-head); font: 600 13px/1.25 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbNext small { display: block; color: var(--fc-muted); font: 12px/1.3 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbCat { padding: 16px 8px 4px 16px; color: var(--fc-muted); font: 600 12px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
.fclbCh { display: flex; align-items: center; height: 32px; margin: 1px 8px; padding: 0 8px; border-radius: 4px; color: var(--fc-muted); font: 500 15px/1 var(--fc-font); cursor: pointer; }
.fclbCh:hover { background: var(--fc-hover); color: var(--fc-text); }
.fclbCh.on, .fclbCh.joined { background: var(--fc-s4); color: var(--fc-head); }
.fclbCh .fc-ic { width: 18px; height: 18px; margin-right: 6px; flex: none; }
.fclbCh span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbCh small { margin-left: 4px; padding: 0 6px; border-radius: 8px; background: var(--fc-s4); font: 600 11px/16px var(--fc-font); color: var(--fc-text); }
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
/* 3.8: four buttons now (mute, camera, screen, leave): they get their own row */
.fclbVbar { flex-wrap: wrap; }
.fclbVbar .tx { flex: 1 1 100%; margin: 0 0 6px; }
.fclbVbar .fc-btn { flex: 1; margin: 0 2px; justify-content: center; }

.fclbLog { position: relative; z-index: 1; flex: 1; min-height: 0; overflow-y: auto; padding: 0 0 16px; }
.fclbHello { padding: 32px 16px 8px; }
.fclbHello .ic { display: flex; align-items: center; justify-content: center; width: 68px; height: 68px; border-radius: 50%; overflow: hidden; background: var(--fc-s4); color: var(--fc-head); }
.fclbHello .ic.own { border-radius: 22px; background: var(--c); color: #fff; font: 700 22px/1 var(--fc-font); }
.fclbHello .ic .pic { width: 100%; height: 100%; object-fit: cover; }
.fclbHello .ic .em { font-size: 36px; line-height: 1; }
.fclbHello .ic .fc-ic { width: 40px; height: 40px; }
.fclbHello h2 { margin: 8px 0; color: var(--fc-head); font: 700 28px/1.2 var(--fc-font); }
.fclbHello p { margin: 0 0 12px; color: var(--fc-muted); font: 15px/1.4 var(--fc-font); }
.fclbDay { display: flex; align-items: center; margin: 24px 16px 8px; color: var(--fc-muted); font: 600 12px/1 var(--fc-font); }
.fclbDay::before, .fclbDay::after { content: ''; flex: 1; height: 1px; background: var(--fc-divider); }
.fclbDay span { padding: 0 8px; }
.fclbG { padding: 2px 48px 2px 16px; margin-top: 16px; }
.fclbG .gr { display: flex; }
.fclbG .rq { position: relative; display: flex; align-items: center; height: 20px; margin: 0 0 2px 56px; color: var(--fc-muted); font: 13px/1 var(--fc-font); cursor: pointer; white-space: nowrap; }
.fclbG .rq::before { content: ''; position: absolute; left: -36px; top: 9px; width: 30px; height: 12px; border-left: 2px solid var(--fc-s4); border-top: 2px solid var(--fc-s4); border-top-left-radius: 6px; box-sizing: border-box; }
.fclbG .rq .fc-avatar { margin-right: 4px; }
.fclbG .rq b { flex: none; margin-right: 4px; font-weight: 600; }
.fclbG .rq span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.fclbG .rq:hover span { color: var(--fc-text); }
.fclbG .rq.gone { cursor: default; font-style: italic; }
.fclbG .rq.gone .fc-ic { width: 14px; height: 14px; margin-right: 4px; }
.fclbG .av { flex: none; margin: 2px 16px 0 0; cursor: pointer; height: 40px; }
.fclbG .bd { flex: 1; min-width: 0; }
.fclbG .hd { display: flex; align-items: baseline; margin-bottom: 2px; }
.fclbG .hd b { font: 600 15px/1.375 var(--fc-font); cursor: pointer; }
.fclbG .hd b:hover { text-decoration: underline; }
.fclbWrap i.mk, .fclbWel i.mk { display: inline-flex; flex: none; margin-left: 4px; align-self: center; font-style: normal; }
.fclbWrap i.mk .fc-ic, .fclbWel i.mk .fc-ic { width: 14px; height: 14px; }
i.mk.ow { color: var(--fc-warning); }
i.mk.md { color: #7289ff; }
i.mk.kg { color: #f0b232; }
i.mk.dup { color: var(--fc-danger); }
.fclbG .hd time { margin-left: 8px; color: var(--fc-muted); font: 12px/1 var(--fc-font); }
.fclbG .ln { color: var(--fc-text); font: 15px/1.375 var(--fc-font); white-space: pre-wrap; word-wrap: break-word; user-select: text; }
.fclbG .ln.at { margin: 0 -48px 0 -72px; padding: 0 48px 0 70px; border-left: 2px solid var(--fc-warning); background: rgba(240,178,50,.08); }
.fclbG .ln.flash { animation: fclbFlash 1.8s ease-out; }
@keyframes fclbFlash { 0%, 35% { background-color: rgba(240,178,50,.2); } 100% { background-color: transparent; } }
.fclbG .rxs { display: flex; flex-wrap: wrap; margin: 4px 0 2px; white-space: normal; }
.fclbG .rx { display: inline-flex; align-items: center; height: 24px; margin: 0 4px 4px 0; padding: 0 7px; box-sizing: border-box; border: 1px solid transparent; border-radius: 8px;
    background: var(--fc-s2); color: var(--fc-muted); font: 14px/1 'Segoe UI Emoji', var(--fc-font); cursor: pointer; user-select: none; transition: border-color .12s, background-color .12s; }
.fclbG .rx b { margin-left: 5px; font: 600 13px/1 var(--fc-font); }
.fclbG .rx:hover { border-color: var(--fc-s4); }
.fclbG .rx.me { border-color: var(--lc, var(--fc-accent)); background: var(--fc-accent-soft); color: var(--fc-head); }
.fclbG .rx.new { animation: fclbRx .4s var(--fc-spring, ease-out) both; }
@keyframes fclbRx { from { opacity: 0; transform: scale(calc(1 - .6 * var(--fc-move, 1))); } }
.fclbA { color: var(--fc-link); cursor: pointer; }
.fclbA:hover { text-decoration: underline; }
.fclbAt { padding: 0 2px; border-radius: 3px; background: var(--fc-accent-soft); color: var(--fc-head); font-weight: 500; }
.fclbAt.me { background: rgba(240,178,50,.25); }
.fclbSys { display: flex; align-items: center; margin-top: 12px; padding: 2px 16px 2px 28px; color: var(--fc-muted); font: 14px/1.375 var(--fc-font); }
.fclbSys .fc-ic { width: 16px; height: 16px; margin-right: 16px; color: var(--fc-success); }
.fclbSys.leave .fc-ic, .fclbSys.out .fc-ic { color: var(--fc-danger); }
.fclbSys time { margin-left: 8px; font-size: 12px; }
.fclbSys.pin .fc-ic { color: var(--fc-muted); }
.fclbSys b { color: var(--fc-head); font-weight: 600; }
.fclbSys a { color: var(--fc-head); font-weight: 500; cursor: pointer; }
.fclbSys a:hover { text-decoration: underline; }
.fclbLoad { padding: 8px 16px; color: var(--fc-muted); font: 13px/1 var(--fc-font); }
.fclbFoot { flex: none; padding: 0 16px 20px; }
.fclbReply { flex: none; padding: 0 16px; }
.fclbReBar { display: flex; align-items: center; height: 34px; padding: 0 8px 0 14px; border-radius: 8px 8px 0 0; background: var(--fc-s2); color: var(--fc-muted); font: 13px/1 var(--fc-font);
    animation: fcRise .15s var(--fc-ease, ease-out) both; }
.fclbReBar > .fc-ic { width: 16px; height: 16px; margin-right: 8px; flex: none; }
.fclbReBar b { color: var(--fc-head); font-weight: 600; }
.fclbReBar .x { display: flex; margin-left: auto; padding: 4px; border-radius: 50%; color: var(--fc-muted); cursor: pointer; }
.fclbReBar .x:hover { color: var(--fc-head); background: var(--fc-hover); }
.fclbReBar .x .fc-ic { width: 14px; height: 14px; }
.fclbReply:not(:empty) + .fclbFoot .fclbBox { border-top-left-radius: 0; border-top-right-radius: 0; }
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
.fclbM .tx b .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.fclbM .tx small { display: flex; align-items: center; color: var(--fc-muted); font: 12px/1.3 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbM .tx small .fc-ic { width: 12px; height: 12px; margin-right: 4px; color: var(--fc-success); }

.fclbForm label { display: block; margin-bottom: 14px; }
.fclbForm label > span { display: block; margin-bottom: 6px; color: var(--fc-muted); font: 700 12px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
.fclbForm .fc-input, .fclbForm .fc-select { width: 100%; box-sizing: border-box; }
.fclbForm textarea.fc-input { display: block; height: auto; min-height: 64px; padding: 8px 10px; resize: vertical; font: 14px/1.4 var(--fc-font); }
.fclbForm .cnt { display: block; margin-top: 4px; text-align: right; color: var(--fc-muted); font: 11px/1 var(--fc-font); }
.fclbForm input[type=date]::-webkit-calendar-picker-indicator, .fclbForm input[type=time]::-webkit-calendar-picker-indicator { filter: invert(.8); cursor: pointer; }
.fclbTwo { display: flex; }
.fclbTwo label { flex: 1; min-width: 0; margin-right: 10px; }
.fclbTwo label:last-child { margin-right: 0; }
.fclbCode { font-family: Consolas, 'Courier New', monospace !important; letter-spacing: .04em; text-transform: uppercase; }
.fclbLook { margin-top: 8px; color: var(--fc-muted); font: 13px/1.3 var(--fc-font); }
.fclbErr { display: flex; align-items: center; color: var(--fc-danger); font: 13px/1.3 var(--fc-font); }
.fclbErr .fc-ic { width: 16px; height: 16px; margin-right: 6px; flex: none; }
.fclbHit { border-radius: 10px; overflow: hidden; background: var(--fc-s1); animation: fcRise .2s var(--fc-ease, ease-out) both; }
.fclbHit .bn { height: 72px; background: var(--c) var(--art, none) center 30% / cover; image-rendering: pixelated; }
.fclbHit .bn.own { image-rendering: auto; background-position: center; }
.fclbHit .row { position: relative; display: flex; align-items: center; padding: 10px; }
.fclbHit .bn + .row { align-items: flex-end; margin-top: -26px; }
.fclbHit .ico { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin-right: 12px; border-radius: 16px; overflow: hidden; background: var(--c); color: #fff;
    font: 700 15px/1 var(--fc-font); flex: none; box-shadow: 0 0 0 4px var(--fc-s1); }
.fclbHit .ico .pic { width: 100%; height: 100%; object-fit: cover; }
.fclbHit .ico .em { font-size: 26px; line-height: 1; }
.fclbHit .ds { margin: 0 12px 12px; color: var(--fc-text); font: 13px/1.4 var(--fc-font); }
.fclbHit .tx b { display: block; color: var(--fc-head); font: 600 16px/1.2 var(--fc-font); }
.fclbHit .tx small { color: var(--fc-muted); font: 13px/1.3 var(--fc-font); }
.fclbInv p { margin: 0 0 12px; color: var(--fc-text); font: 14px/1.45 var(--fc-font); }
.fclbCodeBox { display: flex; align-items: center; padding: 6px 6px 6px 12px; margin-bottom: 12px; border-radius: 8px; background: var(--fc-input); }
.fclbCodeBox code { flex: 1; color: var(--fc-head); font: 600 15px/1.2 Consolas, 'Courier New', monospace; letter-spacing: .04em; user-select: all; }
.fclbPill { cursor: pointer; }

/* 3.0: lobby settings */
.fclbSet .fc-tabs { margin-bottom: 14px; }
.fclbSet .lbl { display: block; margin-bottom: 6px; color: var(--fc-muted); font: 700 12px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
.fclbSet .pane { animation: fcIn .15s ease both; }
.fclbSet .bt { display: flex; align-items: center; }
.fclbSet .bt .fc-btn { margin-right: 8px; }
.fclbSetTop { display: flex; align-items: center; margin-bottom: 16px; }
.fclbSetTop .pv { flex: none; display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; margin-right: 16px; border-radius: 24px; overflow: hidden;
    background: var(--c); color: #fff; font: 700 24px/1 var(--fc-font); transition: background-color .2s; }
.fclbSetTop .pv .pic { width: 100%; height: 100%; object-fit: cover; }
.fclbSetTop .pv .em { font-size: 40px; line-height: 1; }
.fclbSetTop .ctl { flex: 1; min-width: 0; }
.fclbForm .fclbSetTop label.em { display: flex; align-items: center; margin: 10px 0 0; }
.fclbForm .fclbSetTop label.em > span { display: inline; margin: 0 10px 0 0; color: var(--fc-muted); font: 13px/1 var(--fc-font); text-transform: none; letter-spacing: 0; }
.fclbForm .fclbSetTop label.em .fc-input { width: 64px; text-align: center; font-size: 18px; }
.fclbSetBn { position: relative; height: 120px; margin-bottom: 16px; border-radius: 8px; overflow: hidden; background: var(--fc-s1) var(--art, none) center 30% / cover; image-rendering: pixelated; }
.fclbSetBn.own { image-rendering: auto; background-position: center; }
.fclbSetBn small { position: absolute; left: 8px; top: 8px; padding: 3px 6px; border-radius: 4px; background: rgba(0,0,0,.6); color: #fff; font: 12px/1.2 var(--fc-font); }
.fclbSet .fclbSetBn .bt { position: absolute; right: 8px; bottom: 8px; }
.fclbSet .fclbSetBn .bt .fc-btn { margin: 0 0 0 8px; }
.fclbSw { display: flex; flex-wrap: wrap; margin-bottom: 8px; }
.fclbSw .s { width: 32px; height: 32px; margin: 0 8px 8px 0; border-radius: 8px; background: var(--s); cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
    transition: transform .15s var(--fc-spring, ease-out), box-shadow .15s; }
.fclbSw .s:hover { transform: scale(calc(1 + .1 * var(--fc-move, 1))); }
.fclbSw .s.auto { background-image: linear-gradient(135deg, transparent 44%, rgba(255,255,255,.75) 44%, rgba(255,255,255,.75) 56%, transparent 56%); }
.fclbSw .s.on { box-shadow: 0 0 0 2px var(--fc-s3), 0 0 0 4px var(--fc-head); }
.fclbModR { display: flex; align-items: center; padding: 8px 4px; border-bottom: 1px solid var(--fc-divider); }
.fclbModR:last-child { border-bottom: 0; }
.fclbModR .fc-avatar { margin-right: 10px; }
.fclbModR .nm { flex: 1; min-width: 0; }
.fclbModR .nm b { display: block; color: var(--fc-head); font: 600 14px/1.25 var(--fc-font); }
.fclbModR .nm small { color: var(--fc-muted); font: 12px/1.2 var(--fc-font); }
.fclbForm .fclbModR label.sw { display: flex; margin: 0; cursor: pointer; }

/* 3.0: the welcome card */
.fclbWelM .fc-modal { position: relative; }
.fclbWelM .fc-modal-h { position: absolute; right: 0; top: 0; z-index: 2; padding: 8px; }
.fclbWelM .fc-modal-h > span { display: none; }
.fclbWelM .fc-modal-h .fc-btn { background: rgba(0,0,0,.45); color: #fff; }
.fclbWel { margin: -8px -16px 0; text-align: center; }
.fclbWel .bn { height: 132px; background: var(--c) var(--art, none) center 30% / cover; image-rendering: pixelated; }
.fclbWel .bn.own { image-rendering: auto; background-position: center; }
.fclbWel .ico { position: relative; display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; margin: -40px auto 0; border-radius: 24px; overflow: hidden;
    background: var(--c); color: #fff; font: 700 26px/1 var(--fc-font); box-shadow: 0 0 0 6px var(--fc-s3); animation: fcPop .45s var(--fc-spring, ease-out) .1s both; }
.fclbWel .ico .pic { width: 100%; height: 100%; object-fit: cover; }
.fclbWel .ico .em { font-size: 42px; line-height: 1; }
.fclbWel h2 { margin: 14px 16px 4px; color: var(--fc-head); font: 700 22px/1.25 var(--fc-font); animation: fcRise .3s var(--fc-ease, ease-out) .15s both; }
.fclbWel .facts { margin: 0 16px; color: var(--fc-muted); font: 13px/1.4 var(--fc-font); }
.fclbWel .ds { margin: 12px 24px 0; color: var(--fc-text); font: 14px/1.45 var(--fc-font); }
.fclbWel .wm { margin: 16px 16px 0; padding: 12px 14px; border-left: 3px solid var(--c); border-radius: 8px; background: var(--fc-s1); text-align: left; color: var(--fc-text);
    font: 14px/1.45 var(--fc-font); word-wrap: break-word; animation: fcRise .3s var(--fc-ease, ease-out) .25s both; }
.fclbWel .wm .by { display: flex; align-items: center; margin-bottom: 6px; color: var(--fc-head); font: 600 13px/1 var(--fc-font); }
.fclbWel .wm .by i.mk { margin: 0 6px 0 0; }

/* 3.0: pinned messages */
.fclbPins { margin: -8px; }
.fclbPins .h { display: flex; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--fc-divider); color: var(--fc-head); font: 600 15px/1 var(--fc-font); }
.fclbPins .h .fc-ic { width: 18px; height: 18px; margin-right: 8px; }
.fclbPins .l { max-height: 420px; overflow-y: auto; padding: 8px; }
.fclbPins .pi { position: relative; display: flex; padding: 10px; margin-bottom: 6px; border-radius: 8px; background: var(--fc-s2); cursor: pointer; transition: background-color .12s; }
.fclbPins .pi:last-child { margin-bottom: 0; }
.fclbPins .pi:hover { background: var(--fc-s3); }
.fclbPins .pi .fc-avatar { margin-right: 10px; }
.fclbPins .pi .bd { flex: 1; min-width: 0; }
.fclbPins .pi .hd { display: flex; align-items: baseline; }
.fclbPins .pi .hd b { font: 600 14px/1.3 var(--fc-font); }
.fclbPins .pi .hd time { margin-left: 6px; color: var(--fc-muted); font: 11px/1 var(--fc-font); }
.fclbPins .pi .tx { color: var(--fc-text); font: 14px/1.375 var(--fc-font); word-wrap: break-word; }
.fclbPins .pi .x { position: absolute; right: 6px; top: 6px; display: none; padding: 3px; border-radius: 50%; background: var(--fc-s1); color: var(--fc-muted); cursor: pointer; }
.fclbPins .pi:hover .x { display: flex; }
.fclbPins .pi .x:hover { color: var(--fc-danger); }
.fclbPins .pi .x .fc-ic { width: 12px; height: 12px; }
.fclbPins .pi.gone { color: var(--fc-muted); font: italic 13px/1.3 var(--fc-font); cursor: default; }
.fclbPins .fc-empty { padding: 24px 12px; }

/* 3.0: events */
.fclbEv { display: flex; align-items: flex-start; padding: 14px; margin-bottom: 10px; border: 1px solid var(--fc-divider); border-radius: 10px; background: var(--fc-s2);
    animation: fcRise .25s var(--fc-ease, ease-out) both; }
.fclbEv.live { border-color: var(--fc-success); }
.fclbEv .dt { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 56px; height: 64px; margin-right: 14px; border-radius: 8px; background: var(--fc-s1); }
.fclbEv .dt small { color: var(--lc, var(--fc-accent)); font: 700 11px/1.1 var(--fc-font); text-transform: uppercase; }
.fclbEv .dt b { color: var(--fc-head); font: 700 24px/1.1 var(--fc-font); }
.fclbEv .bd { flex: 1; min-width: 0; }
.fclbEv .tt { display: flex; align-items: center; flex-wrap: wrap; }
.fclbEv .tt b { margin-right: 8px; color: var(--fc-head); font: 600 16px/1.3 var(--fc-font); }
.fclbEv .ft, .fclbEv .lv { margin-right: 6px; padding: 2px 6px; border-radius: 4px; font: 700 11px/1.3 var(--fc-font); }
.fclbEv .ft { background: var(--fc-s4); color: var(--fc-text); }
.fclbEv .lv { background: var(--fc-success); color: #fff; }
.fclbEv .wh { display: flex; align-items: center; margin-top: 4px; color: var(--fc-muted); font: 13px/1.3 var(--fc-font); }
.fclbEv .wh .fc-ic { width: 14px; height: 14px; margin-right: 5px; flex: none; }
.fclbEv p { margin: 8px 0 0; color: var(--fc-text); font: 14px/1.4 var(--fc-font); word-wrap: break-word; }
.fclbEv .go { display: flex; align-items: center; margin-top: 10px; color: var(--fc-muted); font: 13px/1 var(--fc-font); }
.fclbEv .go > span[title] { margin-right: -6px; }
.fclbEv .go .fc-avatar { border-radius: 50%; box-shadow: 0 0 0 2px var(--fc-s2); }
.fclbEv .go .cnt { margin-left: 14px; }
.fclbEv .go > .cnt:first-child { margin-left: 0; }
.fclbEv .ac { flex: none; display: flex; flex-direction: column; align-items: stretch; margin-left: 12px; }
.fclbEv .ac .fc-btn { margin-bottom: 6px; }

/* 3.0: the leaderboard */
.fclbBoard { overflow: hidden; border: 1px solid var(--fc-divider); border-radius: 10px; background: var(--fc-s2); }
.fclbBoard .hr, .fclbBoard .r { display: flex; align-items: center; padding: 0 14px; }
.fclbBoard .hr { height: 36px; border-bottom: 1px solid var(--fc-divider); color: var(--fc-muted); font: 700 11px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .03em; }
.fclbBoard .r { height: 48px; border-bottom: 1px solid var(--fc-divider); color: var(--fc-text); font: 500 14px/1 var(--fc-font); cursor: pointer; animation: fcRise .25s var(--fc-ease, ease-out) both; }
.fclbBoard .r:last-child { border-bottom: 0; }
.fclbBoard .r:hover { background: var(--fc-hover); }
.fclbBoard .r.me { background: var(--fc-accent-soft); }
.fclbBoard .hr > span, .fclbBoard .r > span { flex: 0 0 72px; text-align: right; }
.fclbBoard .hr > .n, .fclbBoard .r > .n { flex: 0 0 28px; text-align: left; color: var(--fc-muted); font-weight: 700; }
.fclbBoard .hr > .p, .fclbBoard .r > .p { flex: 1; min-width: 0; display: flex; align-items: center; text-align: left; }
.fclbBoard .p .fc-avatar { margin-right: 10px; }
.fclbBoard .p b { color: var(--fc-head); font-weight: 600; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbBoard .r.top1 > .n { color: #f0b232; }
.fclbBoard .r.top2 > .n { color: #c0c6cf; }
.fclbBoard .r.top3 > .n { color: #cd7f32; }
.fclbBoard .elo { color: var(--fc-head); font-weight: 700; }
.fclbBoard .hot { display: inline-flex; align-items: center; color: #f26522; font-weight: 700; }
.fclbBoard .hot .fc-ic { width: 14px; height: 14px; margin-right: 2px; }
.fclbBoard .cold { color: var(--fc-muted); }
.fclbBoardNote { margin: 12px 2px 0; color: var(--fc-muted); font: 12px/1.45 var(--fc-font); }
/* 3.6: the box's buttons, pictures in the chat, DMs */
.fclbBox.fcupHost { position: relative; padding: 0 8px 0 4px; }
.fclbBt { display: flex; align-items: center; justify-content: center; flex: none; height: 44px; min-width: 32px; padding: 0 4px; box-sizing: border-box; color: var(--fc-muted); cursor: pointer; }
.fclbBt:hover { color: var(--fc-head); }
.fclbBt .fc-ic { width: 22px; height: 22px; }
.fclbBt.plus .fc-ic { width: 16px; height: 16px; padding: 3px; border-radius: 50%; background: var(--fc-muted); color: var(--fc-s4); }
.fclbBt.plus:hover .fc-ic { background: var(--fc-head); }
.fclbBt.gif { margin-right: 2px; font: 800 11px/1 var(--fc-font); letter-spacing: .02em; }
.fclbEmb:empty { display: none; }
.fclbEmb { margin: 2px 0 4px; }
.fclbEmb .fcxEmbed { margin: 0; }
.fclbLog .ln.only > .tx { display: none; }
.fclbLog .ln .tx .fclbA.gone { display: none; }
.fclbReq { display: flex; align-items: center; padding: 12px 12px 12px 16px; border-radius: 8px; background: var(--fc-s1); box-shadow: inset 0 0 0 1px var(--fc-divider); }
.fclbReq .tx { flex: 1; min-width: 0; margin-right: 8px; }
.fclbReq b { display: block; color: var(--fc-head); font: 600 15px/1.3 var(--fc-font); }
.fclbReq small { display: block; margin-top: 2px; color: var(--fc-muted); font: 13px/1.35 var(--fc-font); }
.fclbReq .fc-btn { margin-left: 8px; }
.fclbGone .fc-btn { margin-left: auto; }
.fclbTop .ti.dm { cursor: pointer; }
.fclbTop .ti.dm .fc-avatar { margin-right: 8px; }
.fclbTop .ti.dm b { font-weight: 600; }
.fclbTop .tl .fc-btn { margin-left: 6px; }
.fclbCall { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 14px; background: rgba(35,165,90,.18); color: var(--fc-green, #23a55a); font: 600 13px/1 var(--fc-font); }
.fclbCall .fc-ic { width: 16px; height: 16px; margin-right: 6px; }
.fclbHello.dm .av { display: inline-block; line-height: 0; }
.fclbHello.dm .av img { width: 80px; height: 80px; border-radius: 50%; }

/* 3.8: edits, forwards, the editor, "New", typing, message links, search, the delete box */
.fclbG .ln .edt { color: var(--fc-muted); font-size: 10px; cursor: default; }
.fclbTb .b.hid { display: none; }
.fclbG .fwd { margin: 2px 0; }
.fclbG .fwl { display: flex; align-items: center; color: var(--fc-muted); font: italic 13px/1.4 var(--fc-font); }
.fclbG .fwl .fc-ic, .fclbFwdP .fwl .fc-ic { width: 14px; height: 14px; margin-right: 4px; }
.fclbG .fwb { margin-top: 2px; padding: 2px 0 2px 12px; border-left: 4px solid var(--fc-s4); border-radius: 2px; }
.fclbG .fwb small { display: block; margin-top: 2px; color: var(--fc-muted); font: 12px/1.3 var(--fc-font); white-space: normal; }
.fclbEditor { margin: 4px 0 6px; }
.fclbEditor .fclbBox { padding: 0 12px; }
.fclbEdIn { flex: 1; min-height: 40px; max-height: 300px; padding: 10px 0; box-sizing: border-box; border: 0; outline: none; resize: none; background: transparent; color: var(--fc-text); font: 15px/1.375 var(--fc-font); }
.fclbEditor .hint { margin-top: 4px; color: var(--fc-muted); font: 12px/1.3 var(--fc-font); white-space: normal; }
.fclbEditor .hint a { color: var(--fc-link); cursor: pointer; }
.fclbEditor .hint a:hover { text-decoration: underline; }
.fclbG .ln.editing { background: var(--fc-hover); margin: 0 -48px 0 -72px; padding: 0 48px 0 72px; }
.fclbNew { display: flex; align-items: center; margin: 16px 16px 0; height: 0; border-top: 1px solid var(--fc-danger); }
.fclbNew span { margin-left: auto; padding: 0 4px; border-radius: 0 4px 4px 0; background: var(--fc-danger); color: #fff; font: 700 10px/14px var(--fc-font); text-transform: uppercase; transform: translateY(-1px); }
.fclbTyp { position: absolute; left: 16px; right: 16px; bottom: 1px; z-index: 2; display: flex; align-items: center; height: 18px; color: var(--fc-text); font: 12px/18px var(--fc-font);
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; pointer-events: none; }
.fclbTyp b { font-weight: 700; }
.fclbTyp .dots { display: inline-flex; align-items: center; margin-right: 6px; }
.fclbTyp .dots i { width: 5px; height: 5px; margin-right: 2px; border-radius: 50%; background: var(--fc-text); animation: fclbDot 1.2s infinite ease-in-out both; }
.fclbTyp .dots i:nth-child(2) { animation-delay: .15s; }
.fclbTyp .dots i:nth-child(3) { animation-delay: .3s; }
@keyframes fclbDot { 0%, 80%, 100% { opacity: .3; transform: scale(.75); } 40% { opacity: 1; transform: scale(1); } }
.fclbMain:not([data-tab="chat"]) .fclbTyp, .fclbMain:not([data-tab="chat"]) .fclbStage { display: none; }
.fclbMl { display: inline-flex; align-items: center; padding: 0 4px; border-radius: 4px; background: var(--fc-accent-soft); color: var(--fc-head); font-weight: 500; cursor: pointer; vertical-align: baseline; }
.fclbMl:hover { background: var(--fc-accent); color: #fff; }
.fclbMl span { margin: 0 3px; opacity: .7; }
.fclbMl .fc-ic { width: 14px; height: 14px; }
.fclbMl.no { opacity: .6; }
.fclbSrch { position: relative; display: flex; align-items: center; width: 150px; height: 26px; margin-left: 8px; padding: 0 6px 0 8px; border-radius: 4px; background: var(--fc-s1);
    transition: width .2s var(--fc-ease, ease-out); cursor: text; box-sizing: border-box; }
.fclbSrch:focus-within, .fclbWrap.srch .fclbSrch { width: 220px; }
.fclbTop { overflow: hidden; }
.fclbTop .tl { min-width: 0; flex-shrink: 1; }
.fclbSrchSlot { display: flex; min-width: 0; flex-shrink: 1; }
@media (max-width: 1100px) { .fclbSrch { width: 110px; } .fclbSrch:focus-within, .fclbWrap.srch .fclbSrch { width: 160px; } }
.fclbSrchIn { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--fc-text); font: 13px/1 var(--fc-font); }
.fclbSrch .fc-ic { width: 16px; height: 16px; color: var(--fc-muted); flex: none; }
.fclbWrap.srch .fclbMem { width: 400px; padding: 0; }
.fclbRes .rh { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; height: 48px; padding: 0 12px 0 16px; box-sizing: border-box; background: var(--fc-s1); border-bottom: 1px solid var(--fc-divider); }
.fclbRes .rh b { flex: 1; color: var(--fc-head); font: 600 14px/1 var(--fc-font); }
.fclbRes .rh .x { display: flex; padding: 4px; border-radius: 50%; color: var(--fc-muted); cursor: pointer; }
.fclbRes .rh .x:hover { color: var(--fc-head); background: var(--fc-hover); }
.fclbRes .rh .x .fc-ic { width: 16px; height: 16px; }
.fclbRes .sd { margin: 12px 16px 6px; color: var(--fc-muted); font: 600 12px/1 var(--fc-font); }
.fclbRes .hit { display: flex; margin: 0 8px 6px; padding: 10px; border-radius: 8px; background: var(--fc-s3); cursor: pointer; box-shadow: inset 0 0 0 1px var(--fc-divider); }
.fclbRes .hit:hover { background: var(--fc-hover); }
.fclbRes .hit .fc-avatar { margin-right: 10px; flex: none; }
.fclbRes .hit .bd { flex: 1; min-width: 0; }
.fclbRes .hit .hd { display: flex; align-items: baseline; }
.fclbRes .hit .hd b { font: 600 14px/1.3 var(--fc-font); }
.fclbRes .hit .hd time { margin-left: 6px; color: var(--fc-muted); font: 11px/1 var(--fc-font); }
.fclbRes .hit .tx { color: var(--fc-text); font: 14px/1.375 var(--fc-font); word-wrap: break-word; }
.fclbRes mark { padding: 0 1px; border-radius: 2px; background: rgba(240,178,50,.35); color: var(--fc-head); }
.fclbRes .more { margin: 10px 16px; color: var(--fc-muted); font: 12px/1.4 var(--fc-font); }
.fclbRes .fc-empty { padding: 32px 16px; }
.fclbDelQ { margin: 0 0 12px; color: var(--fc-text); font: 14px/1.4 var(--fc-font); }
.fclbDelP { display: flex; padding: 10px 12px; border-radius: 8px; background: var(--fc-s1); box-shadow: 0 0 0 1px var(--fc-divider); }
.fclbDelP .fc-avatar { margin-right: 12px; flex: none; }
.fclbDelP .bd { flex: 1; min-width: 0; }
.fclbDelP .hd { display: flex; align-items: baseline; }
.fclbDelP .hd b { font: 600 15px/1.3 var(--fc-font); }
.fclbDelP .hd time { margin-left: 8px; color: var(--fc-muted); font: 12px/1 var(--fc-font); }
.fclbDelP .tx { color: var(--fc-text); font: 14px/1.4 var(--fc-font); word-wrap: break-word; }
/* forward */
.fclbFwd .fclbFwdQ, .fclbFwd .fclbFwdN { width: 100%; box-sizing: border-box; }
.fclbFwd .l { height: 280px; margin: 10px -6px; overflow-y: auto; }
.fclbFwd .r { display: flex; align-items: center; height: 44px; padding: 0 8px; border-radius: 6px; cursor: pointer; }
.fclbFwd .r:hover { background: var(--fc-hover); }
.fclbFwd .r .fc-avatar, .fclbFwd .r .fclbGi, .fclbFwd .r .lic { margin-right: 10px; flex: none; }
.fclbFwd .r .lic { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 10px; overflow: hidden; background: var(--c); color: #fff; font: 700 11px/1 var(--fc-font); }
.fclbFwd .r .lic .pic { width: 100%; height: 100%; object-fit: cover; }
.fclbFwd .r .nm { flex: 1; min-width: 0; color: var(--fc-head); font: 500 15px/1.2 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbFwd .r small { margin: 0 10px; color: var(--fc-muted); font: 12px/1 var(--fc-font); }
.fclbFwd .r .ck { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; box-shadow: inset 0 0 0 2px var(--fc-muted); color: transparent; }
.fclbFwd .r.on .ck { background: var(--fc-accent); box-shadow: none; color: #fff; }
.fclbFwd .r .ck .fc-ic { width: 14px; height: 14px; stroke-width: 3; }
.fclbFwdP { margin-bottom: 10px; padding: 8px 12px; border-left: 4px solid var(--fc-s4); border-radius: 4px; background: var(--fc-s1); }
.fclbFwdP .fwl { display: flex; align-items: center; color: var(--fc-muted); font: italic 12px/1.3 var(--fc-font); }
.fclbFwdP .tx { margin-top: 2px; color: var(--fc-text); font: 14px/1.375 var(--fc-font); word-wrap: break-word; }
/* stickers: the picture by itself, no box */
.fclbLog .ln.stk .fclbEmb .fcxEmbed, .fclbLog .ln.stk .fclbEmb .fcxMedia { background: transparent !important; box-shadow: none !important; border: 0 !important; padding: 0 !important; }
.fclbLog .ln.stk .fclbEmb img { max-width: 160px !important; max-height: 160px !important; width: auto; height: auto; border-radius: 0 !important; }
/* group DMs */
.fclbGi { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--s, 32px); height: var(--s, 32px); border-radius: 50%; background: var(--c, var(--fc-accent)); color: #fff; }
.fclbGi .fc-ic { width: calc(var(--s, 32px) * .55); height: calc(var(--s, 32px) * .55); }
img.fclbGi { object-fit: cover; background: var(--fc-s1); }
.fclbTop .ti.gp { cursor: pointer; border-radius: 4px; padding: 2px 4px; margin-left: -4px; }
.fclbTop .ti.gp:hover { background: var(--fc-hover); }
.fclbTop .ti.gp .fclbGi { margin-right: 8px; }
.fclbHello.dm .av .fclbGi { width: 80px; height: 80px; }
i.mk.nf { color: var(--fc-muted); }
.fclbGiRow { display: flex; align-items: center; margin-bottom: 12px; }
.fclbGiRow > .fclbGi { margin-right: 14px; }
.fclbGiRow .fc-btn { margin-right: 8px; }
.fclbVp i.lv { padding: 0 4px; border-radius: 3px; background: var(--fc-danger); color: #fff; font: 700 9px/14px var(--fc-font); }
/* the call: tiles, video, the buttons */
.fclbStage { display: none; }
.fclbStage.on { position: relative; display: flex; flex-direction: column; flex: none; height: 210px; padding: 12px 12px 8px; box-sizing: border-box; background: #000;
    border-bottom: 1px solid var(--fc-divider); animation: fcIn .2s ease both; }
.fclbStage.on.vid { height: 340px; }
.fclbStage.on.big { height: 460px; }
.fclbStage .grid { flex: 1; min-height: 0; display: flex; flex-wrap: wrap; align-content: center; justify-content: center; }
.fclbStage .tile { position: relative; display: flex; align-items: center; justify-content: center; margin: 4px; border-radius: 8px; overflow: hidden; background: var(--fc-s2); cursor: pointer;
    flex: 0 1 calc(50% - 8px); max-width: 360px; height: calc(100% - 8px); }
.fclbStage .grid.n3 .tile, .fclbStage .grid.n4 .tile { flex-basis: calc(33% - 8px); height: calc(50% - 8px); }
.fclbStage .grid.n5 .tile, .fclbStage .grid.n6 .tile { flex-basis: calc(33% - 8px); height: calc(50% - 8px); }
.fclbStage:not(.vid) .tile { flex: 0 0 160px; height: 120px; background: var(--fc-s2); }
.fclbStage .tile .vs, .fclbStage .tile .vs video { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.fclbStage .tile video { object-fit: cover; background: #000; }
.fclbStage .tile.scr video { object-fit: contain; }
.fclbStage video.mirror { transform: scaleX(-1); }
.fclbStage .tile .av { line-height: 0; border-radius: 50%; transition: box-shadow .08s; }
.fclbStage .tile .av.talk { box-shadow: 0 0 0 3px var(--fc-success); }
.fclbStage .tile .av img { border-radius: 50%; }
.fclbStage .tile .nm { position: absolute; left: 8px; bottom: 8px; display: flex; align-items: center; max-width: calc(100% - 16px); padding: 3px 8px; border-radius: 4px;
    background: rgba(0,0,0,.6); color: #fff; font: 600 12px/1.2 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbStage .tile .nm .fc-ic { width: 13px; height: 13px; margin: 0 4px 0 0; }
.fclbStage .tile .nm .fc-ic:last-child:not(:first-child) { margin: 0 0 0 4px; color: var(--fc-danger); }
.fclbStage .tile .fs { position: absolute; right: 8px; top: 8px; display: none; padding: 5px; border-radius: 6px; background: rgba(0,0,0,.6); color: #fff; }
.fclbStage .tile:hover .fs { display: flex; }
.fclbStage .tile .fs .fc-ic { width: 16px; height: 16px; }
.fclbStage .tile:hover { box-shadow: inset 0 0 0 2px var(--fc-accent); }
.fclbStage .focus { flex: 1; min-height: 0; display: flex; }
.fclbStage .focus .tile { flex: 1; max-width: none; height: auto; margin: 0 0 6px; }
.fclbStage .strip { display: flex; justify-content: center; flex: none; height: 72px; margin-bottom: 4px; }
.fclbStage .strip .tile { flex: 0 0 120px; height: 68px; margin: 0 3px; }
.fclbStage .strip .tile .nm { font-size: 10px; padding: 1px 5px; left: 4px; bottom: 4px; }
.fclbStage .bar { display: flex; justify-content: center; flex: none; margin-top: 4px; }
.fclbStage .cbb { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin: 0 6px; border-radius: 50%; background: #2b2d31; color: #fff; cursor: pointer;
    transition: background-color .12s, transform .15s var(--fc-spring, ease-out); }
.fclbStage .cbb:hover { background: #404249; transform: scale(calc(1 + .06 * var(--fc-move, 1))); }
.fclbStage .cbb.on { background: #fff; color: #000; }
.fclbStage .cbb.bad { background: #fff; color: var(--fc-danger); }
.fclbStage .cbb.end { background: var(--fc-danger); }
.fclbStage .cbb.end:hover { background: #a12828; }
.fclbStage .cbb .fc-ic { width: 22px; height: 22px; }
.fclbStage .paused { position: absolute; left: 50%; top: 10px; display: flex; align-items: center; padding: 6px 10px; border-radius: 6px; background: rgba(240,178,50,.92); color: #111;
    font: 600 12px/1.2 var(--fc-font); transform: translateX(-50%); }
.fclbStage .paused .fc-ic { width: 14px; height: 14px; margin-right: 6px; }
/* Screen Share */
.fclbScr .g { display: flex; flex-wrap: wrap; height: 300px; margin: 8px -6px; overflow-y: auto; align-content: flex-start; }
.fclbScr .it { width: calc(33.33% - 12px); margin: 6px; cursor: pointer; }
.fclbScr .it .th { height: 108px; border-radius: 8px; overflow: hidden; background: #000; box-shadow: 0 0 0 1px var(--fc-divider); line-height: 0; }
.fclbScr .it .th img { width: 100%; height: 100%; object-fit: contain; }
.fclbScr .it:hover .th { box-shadow: 0 0 0 2px var(--fc-accent); }
.fclbScr .it span { display: block; margin-top: 6px; color: var(--fc-text); font: 13px/1.3 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fclbScr .q { display: flex; align-items: center; margin-top: 4px; }
.fclbScr .q > span { margin-right: 12px; color: var(--fc-muted); font: 700 12px/1 var(--fc-font); text-transform: uppercase; }
.fclbScr .q .fc-tabs { border-bottom: 0; }
`;

/* =================================================================== start */

function start(f) {
    fc = f;
    store = fc.config('lobbies', { enabled: true, secret: '', autoJoin: true, pauseVideo: true, lobbies: [] });
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
        if (inboxSub) { inboxSub.close(); inboxSub = null; }
        ringOff(null);
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
            { key: 'pauseVideo', type: 'switch', label: 'Pause my camera and screen share during matches', hint: 'In calls (lobbies and DMs): your match gets all of your upload, and they come back after it' },
            { type: 'note', label: 'Lobbies go through the same free public relays as voice chat. Messages are encrypted with a key that only exists in the invite code, and the relays keep them (encrypted) so you see what you missed. Removing someone gives everyone else a new key. The voice room goes straight between players, like voice chat.' }
        ]
    });
    boot();
    // sets against lobby members count on the lobby's leaderboard
    fc.on('set:recorded', (set) => { if (!demo) reportSet(set); });
    timers.push(setInterval(remindTick, 20000));
    timers.push(setInterval(sweep, 30000));
    timers.push(setInterval(() => rooms.forEach(L => sayHere(L)), BEAT + Math.round(Math.random() * 20000)));
    return api;
}

// events you said you're going to: a reminder 15 minutes before and when they start; a mute running out
const reminded = new Set();
function remindTick() {
    const t = now();
    rooms.forEach(L => {
        if (!L.pk || L.lb.removed || L.lb.closed) return;
        L.room.events(t).forEach(ev => {
            if (ev.going.indexOf(L.pk) < 0) return;
            const left = ev.when - t;
            let title = '';
            if (left > 0 && left <= 15 * 60000 && !reminded.has(ev.e + ':soon')) { reminded.add(ev.e + ':soon'); title = T('{event} starts in {n} min', { event: ev.title, n: Math.max(1, Math.round(left / 60000)) }); }
            if (left <= 0 && left > -10 * 60000 && !reminded.has(ev.e + ':now')) { reminded.add(ev.e + ':now'); reminded.add(ev.e + ':soon'); title = T('{event} is starting', { event: ev.title }); }
            if (!title) return;
            fc.ui.toast(title, { icon: 'calendar', sub: L.lb.name + (ev.ft ? ' · FT' + ev.ft : ''), ms: 12000,
                actions: [{ label: T('Open'), fn: () => { openLobby(L.lb.id); view.tab = 'events'; renderPage(); } }] });
            fc.sound.tone([[660, 0, .08], [880, .1, .08], [1320, .2, .12]], { volume: .5 });
        });
        if (view.page && view.id === L.lb.id && view.muteEnd && t >= view.muteEnd) changed(L.lb.id);
    });
}

// lobbies and DMs go on and off on their own switches (the DMs module says whether DMs are on)
let dmsOn = false;
function boot() {
    if (demo || !(cfg.enabled || dmsOn)) return;
    if (!pool && crypto && V && typeof WebSocket !== 'undefined') pool = Pool(RELAYS, WebSocket);
    cfg.lobbies.forEach(lb => { if (lb.dm || lb.group ? !dmsOn : !cfg.enabled) return; const L = startLobby(lb); if (!L.sub) subscribe(L); });
    if (dmsOn) subscribeInbox();
    renderRail();
}

/* ===================================================================== API */

const api = {
    list: () => lobbiesOnly().map(lb => ({ id: lb.id, name: lb.name, game: lb.ch, owner: !!(rooms.get(lb.id) && rooms.get(lb.id).pk === lb.owner) })),
    open: (id) => openLobby(id),
    create: (name, ch, rom) => create(name, ch, rom),
    lookup: (code) => lookup(code),
    join: (found) => joinFound(found),
    send: (id, text, re) => send(id, text, re),
    leave: (id) => leave(id),
    kick: (id, pk) => kick(id, pk),
    saveSettings: (id, p) => saveSettings(id, p),
    setArt: (id, ic, bn) => setArt(id, ic, bn),
    setMod: (id, pk, on) => setMod(id, pk, on),
    mute: (id, pk, mins) => mute(id, pk, mins),
    nick: (id, pk, n) => nick(id, pk, n),
    pin: (id, m, on) => pin(id, m, on),
    react: (id, m, e, on) => react(id, m, e, on),
    planEvent: (id, o) => planEvent(id, o),
    cancelEvent: (id, e) => cancelEvent(id, e),
    rsvp: (id, e, go) => rsvp(id, e, go),
    reportSet: (set) => reportSet(set),
    code: (id) => { const lb = lobbyById(id), L = rooms.get(id); return lb && L ? encodeCode(lb.seeds[lb.epoch], L.room.owner || lb.owner) : ''; },
    inVoice: () => (vr ? vr.id : ''),
    // who's in your lobbies: lower-case name -> the lobbies' names (for the member list)
    mates() {
        const out = new Map();
        rooms.forEach(L => {
            if (L.lb.removed || L.lb.closed || L.lb.dm || L.lb.group) return;
            L.room.active().forEach(m => {
                if (m.pk === L.pk || !m.n) return;
                const k = lc(m.n);
                if (!out.has(k)) out.set(k, []);
                if (out.get(k).indexOf(L.lb.name) < 0) out.get(k).push(L.lb.name);
            });
        });
        return out;
    },
    joinVoice: (id) => voiceJoin(id),
    leaveVoice: () => voiceLeave(),
    // friends + DMs (3.6): the DMs module drives these
    myId: () => { const id = myId(); return id ? id.pk : ''; },
    // 3.7: your profile's looks are signed with your ID (a 32-byte hash in, the signature's hex out)
    signId: (msg) => { const id = myId(); return id && V && V.sign && crypto ? V.sign(msg, id.sk, crypto.randomBytes(32)).toString('hex') : ''; },
    setDms(on) { dmsOn = !!on; if (dmsOn) boot(); else { rooms.forEach(L => { if ((L.lb.dm || L.lb.group) && L.sub) { L.sub.close(); L.sub = null; } }); if (view.mode === 'dm' && view.page) view.page.close(); } },
    dmFor: (pk, n, g, o) => { const lb = dmFor(pk, n, g, o); return lb ? lb.id : ''; },
    dmOf: (pk) => { const lb = dmOf(pk); return lb ? lb.id : ''; },
    dmList: () => (cfg ? dmList() : []),
    dmDrop: (pk) => dmDrop(pk),
    dmRetire: (pk) => dmRetire(pk),
    // another PC with the same Fightcord (3.6)
    linkOffer: (onAsk) => linkOffer(onAsk),
    linkAsk: (code) => linkAsk(code),
    adopt: (p) => adopt(p),
    dmHide(pk) {
        const lb = dmOf(pk);
        if (!lb) return;
        lb.hidden = true;
        store.save();
        if (view.id === lb.id && view.page) openLobby(HOME);
        changed(lb.id);
    },
    openDm(pk, n, g, o) { const lb = dmFor(pk, n, g, Object.assign({ show: true }, o || {})); if (lb) openLobby(lb.id); return !!lb; },
    openHome() { openLobby(HOME); },
    shown: () => (view.page ? view.id : ''),
    HOME,
    refresh() { if (view.page) renderPage(); },
    call: (pk, video) => { const lb = dmOf(pk); if (!lb) return; openLobby(lb.id); call(lb.id, video); },
    callIn: (id, video) => { if (!lobbyById(id)) return; openLobby(id); call(id, video); },
    // 3.8: group DMs, edits, the DM list's own settings (pinned to the top, muted until), calls with video
    createGroup: (people) => { const lb = createGroup(people); return lb ? lb.id : ''; },
    addToGroup: (gid, x) => addToGroup(gid, x),
    joinGroup: (p) => { const lb = joinGroup(p); return lb ? lb.id : ''; },
    groupMembers: (gid) => { const L = rooms.get(gid); return L && L.lb.group ? L.room.active().map(m => ({ pk: m.pk, n: m.n })) : []; },
    groupName: (gid) => groupName(lobbyById(gid)),
    groupEdit: (gid) => { const L = rooms.get(gid); if (L && L.lb.group) renameModal(L); },
    groupLeave: (gid) => { const L = rooms.get(gid); if (L && L.lb.group) leaveGroupAsk(L); },
    rename: (gid, name) => renameGroup(gid, name),
    edit: (id, mid, x) => editMsg(id, mid, x),
    del: (id, mid) => deleteMsg(id, mid),
    dmSet(id, p) {
        const lb = lobbyById(id);
        if (!lb || !(lb.dm || lb.group) || !p) return;
        if (p.top != null) lb.top = !!p.top;
        if (p.mute != null) lb.mute = +p.mute || 0;
        store.save();
        changed(id);
    },
    markRead: (id) => { if (view.hold === id) view.hold = ''; markRead(id); },
    muted: (id) => muted(lobbyById(id)),
    camera: (on) => setCam(on),
    screen: (on) => setScreen(on),
    parseQuery: (q) => parseQuery(q),
    inboxSend: (pk, body) => inboxSend(pk, body),
    onInbox: (fn) => onInbox(fn),
    dmStatus(pk) { const lb = dmOf(pk), L = lb && rooms.get(lb.id); return L ? statusOf(L, pk) : null; },
    _voicePeers: () => (vr ? [...vr.peers].map(([pk, p]) => ({ pk, state: p.state })) : []),
    _me: (id) => { const L = rooms.get(id); return L ? L.pk : ''; },
    _relays: () => (pool ? pool.open() : 0),
    _room: (id) => { const L = rooms.get(id); return L ? L.room : null; },
    _invite: (id) => inviteModal(id),
    _loadOld: (id) => { const L = rooms.get(id); if (L) loadOld(L); },
    // the harness: open a view / a modal straight away
    _tab: (t, range) => { view.tab = t || 'chat'; if (range) view.range = range; renderPage(); },
    _settings: (id, tab) => settingsModal(id || view.id, tab),
    _welcome: (id) => { const L = rooms.get(id || view.id); return L ? welcomeCard(L) : null; },
    _plan: (id) => planModal(id || view.id),
    _pins: () => { const a = view.page && view.page.el.querySelector('.fclbTopB'); const L = rooms.get(view.id); if (a && L) pinsPop(a, L); },
    _remind: () => remindTick(),
    _shrink: (file, banner) => shrinkImage(file, banner ? 720 : 128, banner ? 240 : 128, banner ? BANNER_SEND : ICON_SEND),
    // the dev harness (no crypto / relays): made-up DMs. list: [{ pk, n, g, st, req, unread, msgs: [[who ('me' | 'them'), text, minutes ago]] }]
    _demoDms(list) {
        demo = true;
        dmsOn = true;
        ids = { sk: null, pk: 'me' };
        const meName = me() || 'You';
        cfg.lobbies = cfg.lobbies.filter(lb => !lb.dm && !lb.group);
        [...rooms.keys()].forEach(id => { if (/^(dm|grp)/.test(id)) rooms.delete(id); });
        // d.group: { members: [[pk, name], ...], name }: a group DM (its messages' who: 'me' or a member's pk)
        (list || []).forEach((d, k) => {
            const lb = d.group ? { id: 'grp' + String(k).padStart(29, '0'), group: true, name: '', ch: '', rom: '', owner: d.group.owner || 'me', pre: '', seeds: ['0'], epoch: 0,
                joinedAt: now() - 7 * 86400000, lastRead: now(), notify: 'all', top: !!d.top, mute: d.mute || 0 }
                : { id: 'dm' + String(k).padStart(30, '0'), dm: { pk: d.pk, n: d.n, g: d.g || '' }, name: d.n, ch: '', rom: '', owner: '', pre: '', seeds: ['0'], epoch: 0,
                    joinedAt: now() - 7 * 86400000, lastRead: now(), notify: 'all', req: !!d.req, hidden: !!d.hidden, top: !!d.top, mute: d.mute || 0 };
            cfg.lobbies.push(lb);
            const L = { lb, room: Room({ owner: lb.owner, flat: true }), live: new Map(), sk: null, pk: 'me', topics: new Map(), oldSubs: [], loaded: true, lastHere: 0 };
            rooms.set(lb.id, L);
            let n = 0;
            const ev = (pk, b, at) => L.room.apply({ id: 'm' + k + '-' + (n++), pk, at, ep: 0, b, ok: true });
            const nameIn = (pk) => (pk === 'me' ? meName : d.group ? ((d.group.members.find(x => x[0] === pk) || [])[1] || '?') : d.n);
            if (d.group) {
                ev(lb.owner, { t: 'info', name: '', epoch: 0, prev: [], members: [] }, now() - 7 * 86400000);
                ev('me', { t: 'join', n: meName }, now() - 7 * 86400000 + 1000);
                d.group.members.forEach(([pk, nm], i) => ev(lb.owner === pk ? 'me' : lb.owner, { t: 'add', pk, n: nm }, now() - 7 * 86400000 + 2000 + i));
                if (d.group.name) ev(d.group.members[0][0], { t: 'gset', name: d.group.name }, now() - 6 * 86400000);
            }
            const ids = {};
            (d.msgs || []).forEach(([who, x, minAgo, key, more]) => {
                const pk = who === 'me' ? 'me' : d.group ? who : d.pk;
                const id = 'm' + k + '-' + n;
                ev(pk, Object.assign({ t: 'msg', x, n: nameIn(pk) }, more && more.re ? { re: ids[more.re] } : {}, more && more.fw ? { fw: more.fw } : {}), now() - minAgo * 60000);
                if (key) ids[key] = id;
                if (more && more.ed) ev(pk, { t: 'ed', m: id, x: more.ed }, now() - minAgo * 60000 + 30000);
                if (more && more.rx) more.rx.forEach(([rpk, e], i) => ev(rpk, { t: 'react', m: id, e, on: true }, now() - minAgo * 60000 + 1000 + i));
                if (more && more.pin) ev('me', { t: 'pin', m: id, on: true }, now() - minAgo * 60000 + 2000);
            });
            if (d.unread) lb.lastRead = now() - (Math.max(...(d.msgs || [[0, 0, 0]]).filter(m => m[0] !== 'me').slice(-d.unread).map(m => m[2]), 0) + 0.5) * 60000;
            if (d.st) L.live.set(d.pk, { pk: d.pk, n: d.n, st: d.st, v: !!d.v, vs: d.v ? 'vs' + d.pk : '', at: now() });
            if (d.group) (d.group.live || []).forEach(([pk, st]) => L.live.set(pk, { pk, n: nameIn(pk), st, v: false, vs: '', at: now() }));
            if (d.typing) { L.typing = new Map(d.typing.map(pk => [pk, now() + 3600000])); }
        });
        renderRail();
        fc.emit('lobbies:changed', {});
        return cfg.lobbies.filter(lb => lb.dm || lb.group).map(lb => lb.id);
    },
    // the harness: someone typing, a call with made-up video tiles (canvas streams)
    _typing: (id, pk) => { const L = rooms.get(id || view.id); if (!L) return; if (!L.typing) L.typing = new Map(); L.typing.set(pk, now() + 3600000); changed(L.lb.id); },
    _demoCall(id, o) {
        const L = rooms.get(id || view.id);
        if (!L || typeof document === 'undefined') return;
        const p = o || {};
        const fake = (label, hue, w, h) => {
            const c = document.createElement('canvas'); c.width = w || 640; c.height = h || 360;
            const g = c.getContext('2d');
            let t = 0;
            const draw = () => {
                const gr = g.createLinearGradient(0, 0, c.width, c.height);
                gr.addColorStop(0, `hsl(${hue},55%,${28 + 4 * Math.sin(t / 20)}%)`); gr.addColorStop(1, `hsl(${(hue + 60) % 360},60%,14%)`);
                g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
                g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 ' + Math.round(c.height / 9) + 'px Segoe UI, Arial'; g.textAlign = 'center'; g.fillText(label, c.width / 2, c.height / 2);
                t++;
            };
            draw(); const iv = setInterval(draw, 100); timers.push(iv);
            return c.captureStream ? c.captureStream(10) : null;
        };
        vr = { id: L.lb.id, sid: 'me', peers: new Map(), muted: !!p.muted, gateSt: {}, mic: null, cam: p.cam ? fake(me() || 'You', 200) : null, scr: p.scr ? fake('Screen', 280, 1280, 720) : null, paused: false, els: new Map(), focus: p.focus || '' };
        (p.peers || []).forEach(([pk, cam, scr]) => {
            const m = whoIs(L, pk) || {};
            vr.peers.set(pk, { sid: 'vs' + pk, state: 'connected', vid: [cam ? fake(m.n || '?', 330) : null, scr ? fake((m.n || '?') + ' · 3rd Strike', 20, 1280, 720) : null] });
            L.live.set(pk, Object.assign({}, L.live.get(pk) || { pk, n: m.n, g: '', st: 'on' }, { v: true, vs: 'vs' + pk, cam: !!cam, scr: !!scr, at: now() + 3600000 }));
        });
        changed(L.lb.id);
    },
    _ring: (id) => { const L = rooms.get(id); if (L) ringIn(L, now()); },
    _typingSend: (id) => typing(rooms.get(id)),
    _call: (id) => call(id),
    // the dev harness has no crypto / relays: a made-up lobby to draw. { v3: true } adds 3.0's pictures, roles,
    // reactions, a reply, a pin, events and a leaderboard
    _demo(o) {
        demo = true;
        const p = o || {};
        const meName = me() || 'You';
        const lb = { id: 'demo0000000000000000000000000000', name: p.name || 'Friday Night Fights', ch: p.ch || 'Street Fighter III 3rd Strike: Fight for the Future (Japan 990512, NO CD)', rom: p.rom || 'sfiii3nr1',
            owner: 'me', pre: 'me', seeds: ['0'], epoch: 0, joinedAt: now(), lastRead: now(), notify: 'mentions', welcomed: true };
        cfg.lobbies = [lb].concat(p.more || []);
        rooms.clear();
        const L = { lb, room: Room({ owner: 'me' }), live: new Map(), sk: null, pk: 'me', topics: new Map(), oldSubs: [], loaded: true, lastHere: 0 };
        rooms.set(lb.id, L);
        view.id = ''; view.rx = null;
        const t0 = now() - 3 * 3600000;
        const people = p.people || [['ParryKing', 'k1'], ['UrienMain', 'k2'], ['DashKaiser', 'k3'], ['OroSensei', 'k4'], ['ChunLeaf', 'k5']];
        let i = 0;
        const ev = (pk, b, at) => { const id = 'e' + (i++).toString().padStart(4, '0'); L.room.apply({ id, pk, at, ep: 0, b, ok: true }); return id; };
        const v3 = p.v3 ? (typeof p.v3 === 'object' ? p.v3 : {}) : null;
        // (made-up chat, not shown text: kept out of the translations)
        const words = ['Weekly 3rd Strike sets with the crew. FT5 by default, FT10 on Fridays.', 'Welcome in! Say hi, hop in voice whenever, and check the pinned messages for the bracket. GGs both ways.'];
        const look = v3 ? { col: '#eb459e', emo: '🥊', mods: ['k3'], desc: words[0], welcome: words[1] } : {};
        ev('me', Object.assign({ t: 'info', name: lb.name, rom: lb.rom, ch: lb.ch, epoch: 0, prev: [], members: [['me', meName, '']] }, look), t0);
        if (v3 && v3.art !== false && typeof document !== 'undefined') { const art = demoArt(); ev('me', { t: 'art', ic: v3.icon === false ? '' : art.ic, bn: art.bn }, t0 + 500); }
        ev('me', { t: 'join', n: meName }, t0 + 1000);
        people.forEach(([n, pk], k) => ev(pk, { t: 'join', n }, t0 + 60000 * (k + 1)));
        const ids = {};
        (p.msgs || [
            ['k1', 'anyone up for some FT5s tonight?', 70],
            ['k2', 'yes! give me 10 min, warming up in training', 69],
            ['k2', 'my parries are rusty lol', 68.5],
            ['k3', 'I\'m in. @' + meName + ' you said you wanted the Urien rematch 👀', 60, 'rem'],
            ['me', 'oh it\'s happening. after this set', 58, 'hap', 'rem'],
            ['k4', 'I\'ll hop in voice in a bit', 30],
            ['k1', 'GGs everyone, that last set was crazy', 4, 'gg'],
            ['k5', 'next week same time? I\'ll bring the tournament bracket https://example.com/bracket', 2, 'br']
        ]).forEach(([pk, x, minAgo, key, re]) => {
            const id = ev(pk, { t: 'msg', x, n: pk === 'me' ? meName : (people.find(q => q[1] === pk) || [])[0], re: v3 && re ? ids[re] : undefined }, now() - minAgo * 60000);
            if (key) ids[key] = id;
        });
        if (v3) {
            [['k2', 'gg', '🔥'], ['k3', 'gg', '🔥'], ['k4', 'gg', '🔥'], ['me', 'gg', '❤️'], ['k1', 'br', '👍'], ['k2', 'br', '👍'], ['k3', 'rem', '😂'], ['k1', 'rem', '😂']]
                .forEach(([pk, k, e], n) => ids[k] && ev(pk, { t: 'react', m: ids[k], e, on: true }, now() - 60000 + n));
            if (ids.br) ev('me', { t: 'pin', m: ids.br, on: true }, now() - 90000);
            ev('k3', { t: 'nick', pk: 'k4', n: 'Sensei' }, t0 + 900000);
            [['me', 'evfri', 'Friday FT10s', 2 * 3600000 + 25 * 60000, 10, 'Winner stays on. Bring your best Urien.'], ['k3', 'evsun', 'Sunday bracket', 3 * 86400000, 3, 'Double elimination, the bracket link is pinned.']]
                .forEach(([pk, e, name, inMs, ft, note], n) => ev(pk, { t: 'evt', e, title: name, when: now() + inMs, ft, desc: note }, now() - 3600000 + n));
            [['me', 'evfri', 1], ['k1', 'evfri', 1], ['k2', 'evfri', 1], ['k3', 'evfri', 1], ['k5', 'evfri', 0], ['k1', 'evsun', 1], ['k4', 'evsun', 1]]
                .forEach(([pk, e, go], n) => ev(pk, { t: 'rsvp', e, go: !!go }, now() - 3000000 + n));
            // sets: both players report the same result
            const sets = [['k1', 'k2', 3, 1], ['k1', 'k3', 3, 2], ['me', 'k1', 2, 3], ['k2', 'me', 1, 3], ['k1', 'k4', 3, 0], ['k1', 'k5', 3, 1], ['me', 'k3', 3, 2],
                ['k3', 'k2', 3, 0], ['me', 'k4', 3, 1], ['k1', 'me', 3, 2], ['k5', 'k4', 3, 2], ['k2', 'k5', 3, 1]];
            sets.forEach(([a, b, w, l], n) => { const at = now() - (sets.length - n) * 5 * 3600000; ev(a, { t: 'set', q: 'q' + n, o: b, w, l }, at); ev(b, { t: 'set', q: 'q' + n, o: a, w: l, l: w }, at + 1000); });
        }
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
