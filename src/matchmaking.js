/**
 * Fightcord matchmaking (3.12) -- a queue only Fightcord has
 *
 * In a game channel: Find a match → Matchmaking. Pick Ranked (and the FT) or Casual and press
 * Search. Every queued Fightcord says so on a free public relay (nostr, ephemeral: forwarded live,
 * never stored), and two that fit each other agree on a match between themselves, no server:
 *
 *   q      I'm queued here (every 15 s; gone after 40 s unheard)       bye    I left the queue
 *   offer  you and me? (only the one with the lower name hash asks)    ok     yes
 *   ready  I pressed Accept                                            no     I declined / timed out / am busy
 *
 * Both get a "Match found" pop-up with a 15 s timer. When both accept, the one who asked sends
 * Fightcade's challenge (the FT you both picked, or casual) and the other's Fightcord accepts that one
 * challenge for them. Whoever didn't accept leaves the queue; the other goes back in.
 *
 * Fit: the same channel and mode (and FT for ranked); in the channel, free, within Find a match's rank
 * range and ping; not something your challenge filters would decline; for ranked, Fightcade's ranked
 * setting on for both and a ranked channel. Names travel hashed, every message is signed with the
 * sender's Fightcord ID, and only the ID presence heard for that player counts, so nobody can queue or
 * answer as someone else. Connected only while you're queued or in a match-up.
 */
'use strict';

const path = require('path');
const crypto = (() => { try { return require('crypto'); } catch (e) { return null; } })();

let fc = null;
let store = null, cfg = null;          // matchmaking-config.json
let V = null;                          // voice.js (relays, verify)
let P = null;                          // presence.js's pure parts (hashOf: names travel hashed the same way)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const N_ = (s) => s;
const E = (s) => fc.fmt.esc(s);
const lc = (s) => String(s || '').toLowerCase();
const mod = (id) => fc.modules.get(id);
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');

const KIND = 25052;                    // ephemeral, next to presence's 25051 and voice's 25050
const TOPIC = 'fightcord-matchmaking-v1';
const BEAT = 15000;                    // say "q" this often while queued
const TTL = 40000;                     // an entry is gone when not heard for this long
const OFFER_MS = 8000;                 // an offer nobody answered
const FOUND_MS = 15000;                // the Accept pop-up
const START_MS = 35000;                // both accepted: the match has this long to start
const SKIP_MS = 10 * 60000;            // someone who didn't accept isn't offered again for this long
const FRESH_MS = 90000;                // messages older (or newer) than this are ignored
const FILTER_RETRY_MS = 20000;         // their filters said no: ask again after this (they may loosen)
const FTS = [2, 3, 5, 10];
const HASH = /^[0-9a-f]{32}$/;

/* ================================================================ pure parts */

// does a queued player fit you? me = { ch, mode, ft, myRank, chRanked, meRanked }
// them = { ch, mode, ft } (their "q"); u = their Fightcade user; o = { window, maxPing, skip(name) }
// 3.13.1: misfit says why not ('' = they fit): 'queue' (another game / mode / FT), 'ranked', 'channel',
// 'away', 'playing', 'rank', 'ping', 'filter'. Only 'rank' and 'ping' are yours to loosen (Match anyway).
function misfit(me, them, u, o) {
    const p = o || {};
    if (!me || !them || !u) return 'queue';
    if (them.ch !== me.ch || them.mode !== me.mode) return 'queue';
    if (me.mode === 'ranked') {
        if (them.ft !== me.ft) return 'queue';
        if (!me.chRanked || !me.meRanked || !(u.settings && u.settings.ranked)) return 'ranked';
    }
    // (Fightcade lists someone's channels by id or by name)
    const chans = Array.isArray(u.channels) ? u.channels : [];
    if (chans.indexOf(me.ch) < 0 && !(me.chName && chans.indexOf(me.chName) >= 0)) return 'channel';
    if (u.away) return 'away';
    if (u.playing && u.playing.quarkId) return 'playing';
    if (p.skip && p.skip(u.name || '')) return 'filter';
    const rk = u.channelRank || {};
    const rank = +(rk[me.chName] || rk[me.ch] || 0);
    if (p.window != null && me.myRank && (!rank || Math.abs(rank - me.myRank) > p.window)) return 'rank';
    if (p.maxPing && typeof u.ping === 'number' && u.ping > 0 && u.ping > p.maxPing) return 'ping';
    return '';
}
const compatible = (me, them, u, o) => !misfit(me, them, u, o);
// the reasons "Match anyway" lifts
const LOOSE = ['rank', 'ping'];

// the pair's asker: the lower hash, so two people never both ask
const asks = (mine, theirs) => String(mine) < String(theirs);

// what a message signs: every field that matters, in a fixed order
function signText(m) {
    return [TOPIC, m.t, m.h, m.ch || '', m.mode || '', m.ft || 0, m.id || '', m.to || '', m.why || '', m.ts || 0].join('|');
}
const digest = (m) => crypto.createHash('sha256').update(signText(m)).digest();

// a message from the relay, cleaned: null when it's malformed or stale
function cleanMsg(m, now) {
    if (!m || typeof m !== 'object' || !HASH.test(String(m.h || ''))) return null;
    if (['q', 'bye', 'offer', 'ok', 'ready', 'no'].indexOf(m.t) < 0) return null;
    if (!/^[0-9a-f]{64}$/.test(String(m.dk || '')) || !/^[0-9a-f]{128}$/.test(String(m.sig || ''))) return null;
    if (!(Math.abs((now || Date.now()) - (+m.ts || 0)) <= FRESH_MS)) return null;
    const out = { t: m.t, h: m.h, ts: +m.ts, dk: m.dk, sig: m.sig };
    if (m.t === 'q') {
        if (typeof m.ch !== 'string' || !m.ch || m.ch.length > 80) return null;
        if (m.mode !== 'ranked' && m.mode !== 'casual') return null;
        out.ch = m.ch; out.mode = m.mode; out.ft = m.mode === 'ranked' ? (FTS.indexOf(+m.ft) >= 0 ? +m.ft : 0) : 0;
        if (m.mode === 'ranked' && !out.ft) return null;
    }
    if (m.t !== 'q' && m.t !== 'bye') {
        if (!/^[0-9a-z]{6,24}$/.test(String(m.id || ''))) return null;
        out.id = m.id;
    }
    if (m.t === 'offer') { if (!HASH.test(String(m.to || ''))) return null; out.to = m.to; }
    if (m.t === 'no') out.why = String(m.why || '').slice(0, 12);
    return out;
}

// The match-up, without Fightcade or the relay (so the tests can run two of them against each other).
// d = { now(), myHash(), send(msg), fits(entry) -> bool, score(entry) -> number,
//       found(match), update(match), done(match, why), challenge(match) -> bool, arm(match), toast(kind, match) }
// match = { id, h, ch, mode, ft, asker, stage: 'offered'|'found'|'starting', meReady, themReady, until }
function Matcher(d) {
    const m = { queue: null, entries: new Map(), match: null, skips: new Map(), lastBeat: 0, outside: new Map() };     // outside: h -> until (their filters said no)
    const newId = () => (crypto ? crypto.randomBytes(6).toString('hex') : Math.random().toString(36).slice(2, 14));
    const skipped = (h) => (m.skips.get(h) || 0) > d.now();

    m.join = (q) => {
        m.queue = { ch: q.ch, mode: q.mode, ft: q.mode === 'ranked' ? q.ft : 0, since: d.now(), loose: !!q.loose };
        m.lastBeat = 0;
        m.tick();
    };
    m.leave = (why) => {
        const had = !!m.queue;
        if (m.match && m.match.stage !== 'starting') { d.send({ t: 'no', id: m.match.id, why: why || 'left' }); end(why || 'left'); }
        m.queue = null;
        if (had) d.send({ t: 'bye' });
    };
    function end(why) {
        const was = m.match;
        m.match = null;
        if (was) d.done(was, why);
    }
    // back in the queue after a match-up that didn't happen (you still want a match)
    function requeue(why) {
        const was = m.match;
        end(why);
        if (m.queue) { m.lastBeat = 0; if (was) d.toast('requeue', was); }
    }

    m.tick = () => {
        const now = d.now();
        m.entries.forEach((e, h) => { if (now - e.at > TTL) m.entries.delete(h); });
        m.skips.forEach((t, h) => { if (t <= now) m.skips.delete(h); });
        m.outside.forEach((t, h) => { if (t <= now || !m.entries.has(h)) m.outside.delete(h); });
        const x = m.match;
        if (x && now > x.until) {
            if (x.stage === 'offered') { m.match = null; }
            else if (x.stage === 'found') {
                if (!x.meReady) { d.send({ t: 'no', id: x.id, why: 'timeout' }); m.queue = null; d.send({ t: 'bye' }); end('timeout'); }
                else { m.skips.set(x.h, now + SKIP_MS); d.send({ t: 'no', id: x.id, why: 'timeout' }); requeue('them'); }
            } else if (x.stage === 'starting') { m.skips.set(x.h, now + SKIP_MS); requeue('nostart'); }
        }
        if (!m.queue) return;
        if (now - m.lastBeat >= BEAT) { m.lastBeat = now; d.send({ t: 'q', ch: m.queue.ch, mode: m.queue.mode, ft: m.queue.ft }); }
        if (m.match) return;
        // ask the best fit, if we're the asker of that pair
        let best = null, bestScore = -Infinity;
        m.entries.forEach((e, h) => {
            if (!asks(d.myHash(), h) || skipped(h) || !sameQueue(e)) return;
            if (!d.fits(e)) return;
            const s = d.score(e);
            if (s > bestScore || (s === bestScore && best && h < best.h)) { best = e; bestScore = s; }
        });
        if (best) {
            m.match = { id: newId(), h: best.h, ch: m.queue.ch, mode: m.queue.mode, ft: m.queue.ft, asker: true, stage: 'offered', meReady: false, themReady: false, until: now + OFFER_MS };
            d.send({ t: 'offer', to: best.h, id: m.match.id });
        }
    };
    const sameQueue = (e) => m.queue && e.ch === m.queue.ch && e.mode === m.queue.mode && (m.queue.mode !== 'ranked' || e.ft === m.queue.ft);

    function found(x) {
        x.stage = 'found';
        x.until = d.now() + FOUND_MS;
        d.found(x);
    }

    // a verified message from someone else
    m.receive = (msg) => {
        if (!msg || msg.h === d.myHash()) return;
        const now = d.now(), x = m.match;
        if (msg.t === 'q') { m.entries.set(msg.h, { h: msg.h, ch: msg.ch, mode: msg.mode, ft: msg.ft, at: now }); return; }
        if (msg.t === 'bye') {
            m.entries.delete(msg.h);
            if (x && x.h === msg.h && x.stage !== 'starting') requeue('them');
            return;
        }
        if (msg.t === 'offer') {
            if (msg.to !== d.myHash()) return;
            const e = m.entries.get(msg.h);
            const open = m.queue && !x && e && sameQueue(e) && !skipped(msg.h) && !asks(d.myHash(), msg.h);
            // (3.13.1: free, but outside your filters: say so, so their screen can tell them)
            if (!open || !d.fits(e)) { d.send({ t: 'no', id: msg.id, why: open ? 'filters' : 'busy' }); return; }
            m.match = { id: msg.id, h: msg.h, ch: m.queue.ch, mode: m.queue.mode, ft: m.queue.ft, asker: false, stage: 'found', meReady: false, themReady: false, until: 0 };
            d.send({ t: 'ok', id: msg.id });
            found(m.match);
            return;
        }
        if (!x || msg.id !== x.id || msg.h !== x.h) return;
        if (msg.t === 'ok' && x.stage === 'offered' && x.asker) { found(x); return; }
        if (msg.t === 'ready' && x.stage === 'found') { x.themReady = true; d.update(x); go(); return; }
        if (msg.t === 'no') {
            if (x.stage === 'offered') {
                m.match = null;
                // their filters: ask again in a bit (they may press Match anyway); anything else: leave them be
                if (msg.why === 'filters') { m.skips.set(x.h, now + FILTER_RETRY_MS); m.outside.set(x.h, now + TTL); }
                else if (msg.why !== 'busy') m.skips.set(x.h, now + SKIP_MS);
                return;
            }
            if (x.stage === 'found') {
                // their clock ran out first, and you hadn't accepted either: you're the one out, not them
                if (msg.why === 'timeout' && !x.meReady) { m.queue = null; d.send({ t: 'bye' }); end('timeout'); return; }
                m.skips.set(x.h, now + SKIP_MS);
                requeue(msg.why === 'timeout' ? 'them' : 'declined');
            }
        }
    };

    // your answer in the pop-up
    m.accept = () => {
        const x = m.match;
        if (!x || x.stage !== 'found' || x.meReady) return;
        x.meReady = true;
        d.send({ t: 'ready', id: x.id });
        // the one who doesn't ask takes that one challenge from now on (it can come before their "ready")
        if (!x.asker) d.arm(x);
        d.update(x);
        go();
    };
    m.decline = () => {
        const x = m.match;
        if (!x || x.stage === 'starting') return;
        d.send({ t: 'no', id: x.id, why: 'declined' });
        m.queue = null;
        d.send({ t: 'bye' });
        end('declined');
    };
    function go() {
        const x = m.match;
        if (!x || x.stage !== 'found' || !x.meReady || !x.themReady) return;
        x.stage = 'starting';
        x.until = d.now() + START_MS;
        d.update(x);
        if (x.asker && !d.challenge(x)) { d.send({ t: 'no', id: x.id, why: 'challenge' }); requeue('challenge'); }
    }
    // Fightcade started a set (this one or any other): the queue's job is done
    m.started = () => {
        const x = m.match;
        m.match = null;
        if (m.queue) { m.queue = null; d.send({ t: 'bye' }); }
        if (x) d.done(x, 'started');
    };
    // queued players heard in your queue (for "3 in the queue")
    m.count = () => { let n = 0; m.entries.forEach(e => { if (sameQueue(e)) n++; }); return n; };
    // 3.13.1: the others in your queue that nobody is matching with, and why -> [{ h, why }]
    //   why: a misfit reason from d.why(entry), or 'theirs' (their filters turned your offer down)
    m.stuck = () => {
        const out = [];
        if (!m.queue || m.match) return out;
        m.entries.forEach((e, h) => {
            if (!sameQueue(e)) return;
            if (m.outside.has(h)) { out.push({ h, why: 'theirs' }); return; }
            const w = d.why ? d.why(e) : (d.fits(e) ? '' : 'filter');
            if (w) out.push({ h, why: w });
        });
        return out;
    };
    m.loosen = () => { if (m.queue) { m.queue.loose = true; m.tick(); } };
    return m;
}

/* ================================================================== browser */

let relays = null, mm = null, modal = null, armed = null, uiTimer = 0;

const hashOf = (name) => (P && P.hashOf ? P.hashOf(name) : '');
const myHash = () => { const me = fc.app.me(); return me ? hashOf(me) : ''; };
// a hash -> the player in that channel (only the people there can be in its queue)
function nameIn(h, ch) {
    if (!P || !P.hashOf) return '';
    const users = fc.app.users() || {};
    const c = fc.app.channel(ch), chName = c ? c.name : '';
    for (const k of Object.keys(users)) {
        const u = users[k];
        if (u && Array.isArray(u.channels) && (u.channels.indexOf(ch) >= 0 || (chName && u.channels.indexOf(chName) >= 0)) && P.hashOf(k) === h) return k;
    }
    return '';
}

// where you are: the channel, your rank, ranked on offer
function here(ch) {
    const c = fc.app.channel(ch);
    if (!c) return null;
    const me = fc.app.me();
    const info = fc.app.userInfo(me) || {};
    const meUser = (fc.app.users() || {})[me] || {};
    const act = fc.app.activeChannel();
    const chRanked = c.ranked != null ? !!c.ranked : !!(act && act.id === ch && document.querySelector('.channelToolbar .channelInfo .rankedWrapper'));
    const rk = meUser.channelRank || {};
    return { ch, chName: c.name, myRank: +(rk[c.name] || rk[ch] || info.rank || 0), chRanked, meRanked: !!(meUser.settings && meUser.settings.ranked) };
}

function fmOpts() {
    const f = mod('find-match');
    const fm = (f && f._config) || {};
    const filters = mod('challenge-filters');
    const win = fm.window === 'any' ? null : (fm.window != null ? +fm.window : 1);
    return {
        window: win, maxPing: +fm.maxPing || 120,
        skip: (name) => !!(filters && filters._check && fc.app.activeChannel() && filters._check(name, fc.app.activeChannel().name, 0).some(r => r.mode === 'decline' && r.rule !== 'ft'))
    };
}

function userFor(h, ch) {
    const name = nameIn(h, ch);
    if (!name) return null;
    const u = (fc.app.users() || {})[name];
    return u ? Object.assign({ name }, u) : null;
}

function why(e) {
    if (!mm || !mm.queue) return 'queue';
    const me = here(mm.queue.ch);
    const u = userFor(e.h, mm.queue.ch);
    if (!me || !u) return 'channel';
    const o = fmOpts();
    if (mm.queue.loose) { o.window = null; o.maxPing = 0; }                 // Match anyway: any rank, any ping
    return misfit(Object.assign({ mode: mm.queue.mode, ft: mm.queue.ft }, me), e, u, o);
}
const fits = (e) => !why(e);
function scoreOf(e) {
    const f = mod('find-match');
    const u = userFor(e.h, mm.queue.ch);
    if (!f || !f.score || !u) return 0;
    const me = here(mm.queue.ch) || {};
    const rk = u.channelRank || {};
    const r = fc.history.recordVs(u.name);
    return f.score({ ping: typeof u.ping === 'number' && u.ping > 0 ? u.ping : null, wlan: !!u.wlan, proxy: !!u.proxy,
        rank: +(rk[me.chName] || rk[mm.queue.ch] || 0), h2h: r && r.w + r.l ? { w: r.w, l: r.l } : null, odds: null }, { myRank: me.myRank, maxPing: fmOpts().maxPing });
}

// signed with your Fightcord ID; without one there's no matchmaking (Settings → Friends & DMs)
function send(msg) {
    const lb = mod('lobbies');
    const h = myHash();
    if (!relays || !h || !lb || !lb.myId || !lb.signId) return;
    const out = Object.assign({ h, ts: Date.now(), dk: lb.myId() }, msg);
    const sig = lb.signId(digest(out));
    if (!sig || !out.dk) return;
    out.sig = sig;
    relays.send(out);
}

function onMsg(raw) {
    if (!mm) return;
    const m = cleanMsg(raw, Date.now());
    if (!m || m.h === myHash()) return;
    // the sender: someone in your queue's channel, and the ID presence heard for them
    const ch = mm.queue ? mm.queue.ch : (mm.match ? mm.match.ch : '');
    const name = ch ? nameIn(m.h, ch) : '';
    if (!name) return;
    const p = mod('presence');
    const info = p && p.info ? p.info(name) : null;
    if (!info || !info.dk) { if (p && p.check) Promise.resolve(p.check(name, 4000)).catch(() => {}); return; }
    if (info.dk !== m.dk) return;
    let ok = false;
    try { ok = !!(V && V.verify && V.verify(digest(m), Buffer.from(m.dk, 'hex'), Buffer.from(m.sig, 'hex'))); } catch (e) { ok = false; }
    if (!ok) return;
    mm.receive(m);
    paint();
}

function connect() {
    if (relays || !crypto || !V || !V.Relays) return !!relays;
    const key = crypto.createHash('sha256').update(TOPIC + '|key').digest();
    relays = V.Relays(TOPIC, () => [key], crypto.randomBytes(32), onMsg, null, { kind: KIND, reconnect: true, replay: 0 });
    return true;
}
function disconnect() {
    if (!relays) return;
    const r = relays;
    relays = null;
    setTimeout(() => { try { r.close(); } catch (e) { /* gone */ } }, 600);
}

/* ------------------------------------------------------------- the queue */

// can you queue here at all? -> '' or why not
function blocker(ctx) {
    if (!cfg.enabled) return T('Matchmaking is off (Settings → Scout & challenges)');
    const lb = mod('lobbies'), p = mod('presence');
    if (!lb || !lb.myId || !lb.myId()) return T('Matchmaking needs your Fightcord ID: turn on Friends & DMs in Settings');
    if (!p || !p.info || !p.info(fc.app.me())) return T('Matchmaking needs “Show that I use Fightcord” on (Settings → Voice chat)');
    if (!ctx) return T('Open a game channel first.');
    return '';
}

function search(ctx) {
    const why = blocker(ctx);
    if (why) { fc.ui.toast(why, { kind: 'warning', icon: 'target' }); return false; }
    const ranked = cfg.mode === 'ranked' && ctx.chRanked && ctx.meRanked;
    if (!connect()) { fc.ui.toast(T('Couldn’t reach the matchmaking relays'), { kind: 'warning', icon: 'target' }); return false; }
    mm.join({ ch: ctx.ch, mode: ranked ? 'ranked' : 'casual', ft: cfg.ft });
    fc.log('queued', ctx.ch, ranked ? 'ranked FT' + cfg.ft : 'casual');
    startUi();
    paint();
    return true;
}
function cancel(why) {
    if (!mm) return;
    mm.leave(why || 'cancel');
    closeModal();
    paint();
    if (!mm.queue && !mm.match) { stopUi(); disconnect(); }
}

function startUi() { if (!uiTimer) uiTimer = setInterval(() => { tick(); }, 1000); }
function stopUi() { if (uiTimer) clearInterval(uiTimer); uiTimer = 0; }
function tick() {
    if (!mm) return;
    // you went away, left the channel, or Fightcade logged out: out of the queue
    if (mm.queue) {
        const me = fc.app.me(), u = me ? (fc.app.users() || {})[me] : null;
        if (!me || !fc.app.channel(mm.queue.ch)) cancel('left');
        else if (u && u.away && !mm.match) cancel('away');
    }
    mm.tick();
    paint();
    if (!mm.queue && !mm.match) { stopUi(); disconnect(); }
}

const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// the header pill and the strip in Find a match, kept current
function paint() {
    const q = mm && mm.queue;
    document.querySelectorAll('.fcfmPill').forEach(p => {
        const span = p.querySelector('span');
        if (!span) return;
        if (q) {
            if (!p.__mmLabel) p.__mmLabel = span.textContent;
            p.classList.add('fcmm-q');
            span.textContent = T('Searching {t}', { t: clock(Date.now() - q.since) });
        } else if (p.__mmLabel) {
            p.classList.remove('fcmm-q');
            span.textContent = p.__mmLabel;
            p.__mmLabel = '';
        }
    });
    document.querySelectorAll('.fcmmStrip').forEach(s => {
        const f = mod('find-match');
        const html = stripInner(f && f._context ? f._context() : null);
        if (s.__html !== html) { s.__html = html; s.innerHTML = html; }
    });
    paintModal();
}

/* ------------------------------------------------- the strip (Find a match) */

function stripInner(ctx) {
    const q = mm && mm.queue;
    if (q) {
        const n = mm.count();
        const what = q.mode === 'ranked' ? T('Ranked FT{n}', { n: q.ft }) : T('Casual');
        return `<div class="fcmmOn"><span class="fc-spin"></span><div class="tx"><b>${E(T('Searching… {t}', { t: clock(Date.now() - q.since) }))}</b>` +
            `<span>${E(what)} · ${E(n === 1 ? T('1 other in the queue for this game') : T('{n} others in the queue for this game', { n }))}</span></div>` +
            fc.ui.btn('Cancel', { kind: 'sec', size: 'sm', act: 'mm-cancel' }) + '</div>' + stuckHtml(q);
    }
    const why = blocker(ctx);
    if (why && why !== T('Open a game channel first.')) return `<div class="fcmmNote">${fc.ui.ic('info')}<span>${E(why)}</span></div>`;
    if (!ctx) return '';
    const rankedOk = ctx.chRanked && ctx.meRanked;
    const mode = rankedOk && cfg.mode === 'ranked' ? 'ranked' : 'casual';
    const seg = (m, label) => `<span class="fcmmSeg${mode === m ? ' on' : ''}${m === 'ranked' && !rankedOk ? ' off' : ''}" data-act="mm-mode" data-mode="${m}">${E(T(label))}</span>`;
    const fts = mode === 'ranked' ? `<span class="fcmmFts">${FTS.map(n => `<span class="fcmmFt${cfg.ft === n ? ' on' : ''}" data-act="mm-ft" data-ft="${n}">FT${n}</span>`).join('')}</span>` : '';
    // (a ranked channel with your setting off: Find a match's own note right below already says why)
    const note = !ctx.chRanked ? `<small>${E(T('This channel has no ranked sets'))}</small>` : '';
    return `<div class="fcmmPick"><div class="fcmmH"><b>${E(T('Matchmaking'))}</b><span>${E(T('Fightcord players queue up and get matched'))}</span></div>` +
        `<div class="fcmmRow"><span class="fcmmSegs">${seg('ranked', N_('Ranked'))}${seg('casual', N_('Casual'))}</span>${fts}` +
        fc.ui.btn('Search', { kind: 'success', size: 'sm', icon: 'search', act: 'mm-search' }) + `</div>${note}</div>`;
}
// 3.13.1: someone's in the queue but nothing happens: say why (it used to just wait)
function stuckHtml(q) {
    const st = mm.stuck();
    if (!st.length) return '';
    const name = (h) => nameIn(h, q.ch) || T('a Fightcord player');
    const u = (h) => (fc.app.users() || {})[nameIn(h, q.ch)] || {};
    const line = (x) => {
        const n = name(x.h);
        if (x.why === 'ping') return T('{name}: {ping} ms, over your limit of {max} ms', { name: n, ping: u(x.h).ping, max: fmOpts().maxPing });
        if (x.why === 'rank') return T('{name}: outside your rank range', { name: n });
        if (x.why === 'theirs') return T('{name}: you’re outside their Find a match filters (they can press Match anyway)', { name: n });
        if (x.why === 'away') return T('{name}: away', { name: n });
        if (x.why === 'playing') return T('{name}: in a match', { name: n });
        if (x.why === 'filter') return T('{name}: your challenge filters decline them', { name: n });
        if (x.why === 'ranked') return T('{name}: ranked is off for one of you', { name: n });
        return T('{name}: not in this channel', { name: n });
    };
    const mine = st.some(x => LOOSE.indexOf(x.why) >= 0) && !q.loose;
    return `<div class="fcmmWhy">${fc.ui.ic('info')}<div><b>${E(T('Not matched yet, because:'))}</b>` +
        st.slice(0, 4).map(x => `<span>${E(line(x))}</span>`).join('') + '</div>' +
        (mine ? fc.ui.btn('Match anyway', { size: 'sm', act: 'mm-loose', title: 'Ignore your rank range and ping limit for this search' }) : '') + '</div>';
}
function stripHtml(ctx) { return cfg && cfg.enabled ? `<div class="fcmmStrip">${stripInner(ctx)}</div>` : ''; }

// a click in Find a match's pop-over: true when it was ours
function click(act, el, ctx) {
    if (act === 'mm-mode') { if (el.classList.contains('off')) return true; cfg.mode = el.dataset.mode === 'ranked' ? 'ranked' : 'casual'; store.save(); paint(); return true; }
    if (act === 'mm-ft') { const n = +el.dataset.ft; if (FTS.indexOf(n) >= 0) { cfg.ft = n; store.save(); paint(); } return true; }
    if (act === 'mm-search') { search(ctx); return true; }
    if (act === 'mm-cancel') { cancel('cancel'); return true; }
    if (act === 'mm-loose') { if (mm) { mm.loosen(); paint(); } return true; }
    return false;
}

/* --------------------------------------------------------- Match found */

function opponent(x) {
    const name = nameIn(x.h, x.ch) || x.name || T('a Fightcord player');
    const u = (fc.app.users() || {})[name] || {};
    return { name, u };
}

function modalBody(x) {
    const { name, u } = opponent(x);
    const c = fc.app.channel(x.ch);
    const rk = (u.channelRank || {})[c ? c.name : ''] || (u.channelRank || {})[x.ch] || 0;
    const r = fc.history.recordVs(name);
    const conn = fc.fmt.conn({ ping: u.ping, wlan: u.wlan, proxy: u.proxy });
    const left = Math.max(0, x.until - Date.now());
    const frac = x.stage === 'found' ? left / FOUND_MS : 1;
    const state = x.stage === 'starting' ? T('Both accepted: starting the match…')
        : x.meReady ? T('Waiting for {name}…', { name }) : T('Accept before the time runs out');
    return `<div class="fcmmFound">${fc.ui.avatar(name, { size: 72, status: 'auto' })}` +
        `<div class="fcmmVs"><b>${fc.ui.flag(lc((u.country && u.country.iso_code) || ''))}${E(name)}</b>` +
        `<span>${rk ? fc.ui.tag(rk) + ' ' : ''}${conn ? fc.fmt.connHtml({ ping: u.ping, wlan: u.wlan, proxy: u.proxy }) : ''}</span>` +
        `<span>${E(x.mode === 'ranked' ? T('Ranked FT{n}', { n: x.ft }) : T('Casual'))} · ${E(shortName(c ? c.name : ''))}</span>` +
        `<span>${r && r.w + r.l ? E(T('You vs them: {w}–{l}', { w: r.w, l: r.l })) : E(T('You haven’t played them yet'))}</span></div>` +
        `<div class="fcmmTimer">${fc.ui.ring(frac, { size: 54, stroke: 5, color: x.meReady ? 'var(--fc-success)' : 'var(--fc-accent)', label: x.stage === 'found' ? String(Math.ceil(left / 1000)) : '✓' })}</div></div>` +
        `<div class="fcmmState${x.meReady ? ' ok' : ''}">${E(state)}</div>`;
}

function showModal(x) {
    closeModal();
    const m = fc.ui.modal({
        title: T('Match found'), width: 460, body: '<div class="fcmmBody"></div>',
        actions: [{ label: T('Decline'), kind: 'ghost', fn: () => { if (mm) mm.decline(); paint(); } },
            { label: T('Accept'), kind: 'success', keep: true, fn: () => { if (mm) mm.accept(); paint(); return false; } }],
        onClose: () => { if (modal === m) { modal = null; if (mm && mm.match && mm.match.stage === 'found' && !mm.match.meReady) { mm.decline(); paint(); } } }
    });
    m.el.classList.add('fcmmModal');
    modal = m;
    paintModal();
}
function closeModal() { const m = modal; modal = null; if (m) m.close(); }
function paintModal() {
    if (!modal) return;
    const x = mm && mm.match;
    if (!x || x.stage === 'offered') { closeModal(); return; }
    const b = modal.body.querySelector('.fcmmBody');
    const html = modalBody(x);
    if (b && b.__html !== html) { b.__html = html; b.innerHTML = html; }
    const acc = modal.el.querySelector('.fc-modal-f [data-i="1"]');
    if (acc) { acc.disabled = !!x.meReady; acc.textContent = x.meReady ? T('Accepted') : T('Accept'); }
}

/* --------------------------------------------- the one challenge you take */

const matchesArmed = (ctx) => !!(armed && Date.now() <= armed.until && lc(ctx.name) === armed.opp && (!ctx.channel || ctx.channel === armed.ch));

/* ------------------------------------------------------------------- module */

const CSS = `
.fcmmStrip { margin: -2px 0 10px; padding: 0 4px 10px; border-bottom: 1px solid var(--fc-divider); }
.fcmmH { display: flex; align-items: baseline; margin-bottom: 6px; }
.fcmmH b { font: 700 var(--fc-fs-md)/1.2 var(--fc-font); color: var(--fc-head); margin-right: 8px; }
.fcmmH span { font-size: var(--fc-fs-sm); color: var(--fc-muted); }
.fcmmRow { display: flex; align-items: center; }
.fcmmRow .fc-btn { margin-left: auto; }
.fcmmSegs, .fcmmFts { display: inline-flex; border-radius: var(--fc-r1); background: var(--fc-tint-2); padding: 2px; margin-right: 8px; }
.fcmmSeg, .fcmmFt { padding: 3px 10px; border-radius: 3px; font: 600 var(--fc-fs-sm)/18px var(--fc-font); color: var(--fc-muted); cursor: pointer; user-select: none; }
.fcmmFt { padding: 3px 7px; }
.fcmmSeg:hover, .fcmmFt:hover { color: var(--fc-head); }
.fcmmSeg.on, .fcmmFt.on { background: var(--fc-accent); color: var(--fc-on-accent, #fff); }
.fcmmSeg.off { opacity: .45; cursor: default; }
.fcmmPick small { display: block; margin-top: 5px; font-size: var(--fc-fs-sm); color: var(--fc-muted); }
.fcmmNote { display: flex; align-items: center; color: var(--fc-muted); font: var(--fc-fs-ui)/1.35 var(--fc-font); }
.fcmmNote .fc-ic { flex: none; margin-right: 6px; }
.fcmmOn { display: flex; align-items: center; }
.fcmmWhy { display: flex; align-items: flex-start; margin-top: 10px; padding: 8px 10px; border-radius: var(--fc-r2); background: var(--fc-tint-1); font-size: var(--fc-fs-sm); color: var(--fc-text); }
.fcmmWhy > .fc-ic { flex: none; margin: 2px 8px 0 0; color: var(--fc-warning); }
.fcmmWhy > div { flex: 1; min-width: 0; }
.fcmmWhy b { display: block; color: var(--fc-head); }
.fcmmWhy span { display: block; color: var(--fc-muted); overflow-wrap: anywhere; }
.fcmmWhy .fc-btn { flex: none; margin-left: 8px; align-self: center; }
.fcmmOn .fc-spin { flex: none; width: 22px; height: 22px; margin-right: 10px; }
.fcmmOn .tx { flex: 1; min-width: 0; }
.fcmmOn b { display: block; font: 700 var(--fc-fs-md)/1.25 var(--fc-font); color: var(--fc-head); font-variant-numeric: tabular-nums; }
.fcmmOn span { display: block; font-size: var(--fc-fs-sm); color: var(--fc-muted); }
/* the header pill while you're in the queue */
.fcfmPill.fcmm-q { font-variant-numeric: tabular-nums; animation: fcmmPulse 1.6s ease-in-out infinite; }
@keyframes fcmmPulse { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 3px var(--fc-accent-soft); } }
html.fc-still .fcfmPill.fcmm-q { animation: none; }
/* Match found */
.fcmmFound { display: flex; align-items: center; }
.fcmmFound > .fc-avatar { flex: none; margin-right: 14px; }
.fcmmVs { flex: 1; min-width: 0; }
.fcmmVs b { display: flex; align-items: center; font: 700 20px/1.2 var(--fc-font); color: var(--fc-head); margin-bottom: 3px; }
.fcmmVs b .fc-flag { margin-right: 7px; }
.fcmmVs span { display: flex; align-items: center; font-size: var(--fc-fs-sm); color: var(--fc-muted); margin-top: 2px; }
.fcmmVs span .fc-tag { margin-right: 6px; }
.fcmmTimer { flex: none; margin-left: 10px; }
.fcmmTimer text { font: 700 16px var(--fc-font); fill: var(--fc-head); }
.fcmmState { margin-top: 12px; text-align: center; font: 600 var(--fc-fs-ui)/1.3 var(--fc-font); color: var(--fc-muted); }
.fcmmState.ok { color: var(--fc-success); }
`;

function start(f) {
    fc = f;
    store = fc.config('matchmaking', { enabled: true, mode: 'casual', ft: 3, alert: true });
    cfg = store.data;
    if (FTS.indexOf(cfg.ft) < 0) cfg.ft = 3;
    try { V = require(path.join(__dirname, 'voice.js')); } catch (e) { V = null; }
    try { P = require(path.join(__dirname, 'presence.js')); } catch (e) { P = null; }
    mm = Matcher({
        now: () => Date.now(), myHash, send,
        fits, why, score: scoreOf,
        found: (x) => {
            showModal(x);
            const { name } = opponent(x);
            if (cfg.alert) {
                fc.sound.play('chime');
                fc.ui.attention(T('Match found'), { body: T('vs {name} · accept in Fightcade', { name }), tag: 'fcmm' });
            }
        },
        update: () => paintModal(),
        done: (x, why) => {
            if (why === 'started' || why === 'left' || why === 'cancel') { closeModal(); return; }
            closeModal();
            if (why === 'declined' && x && mm && !mm.queue) return;          // you declined: nothing to say
            if (why === 'timeout' && mm && !mm.queue) fc.ui.toast(T('You didn’t accept in time, so you left the queue'), { kind: 'warning', icon: 'target' });
        },
        toast: (kind, x) => {
            const { name } = opponent(x);
            fc.ui.toast(T('{name} didn’t accept, back in the queue', { name }), { icon: 'target', ms: 5000 });
        },
        challenge: (x) => {
            const { name } = opponent(x);
            const ms = mod('match-screens');
            if (ms && ms.hint) ms.hint(name, { via: 'matchmaking', ft: x.mode === 'ranked' ? x.ft : 0 });      // for the VS banner
            const st = ms && ms.challenge ? ms.challenge(name, x.mode === 'ranked' ? x.ft : 0, x.ch) : { ok: false };
            if (!st.ok) fc.log.warn('matchmaking challenge failed', st.why || '');
            return !!st.ok;
        },
        arm: (x) => { const { name } = opponent(x); const ms = mod('match-screens'); if (ms && ms.hint) ms.hint(name, { via: 'matchmaking', ft: x.mode === 'ranked' ? x.ft : 0 }); armed = { opp: lc(name), ch: x.ch, until: Date.now() + FOUND_MS + START_MS }; }
    });
    fc.ui.style('fcmmStyle', CSS);
    fc.own(() => { fc.ui.style('fcmmStyle', null); if (mm) mm.leave('quit'); closeModal(); stopUi(); disconnect(); });

    // the challenge from the player you were matched with: no filter declines it, and it's accepted for you
    fc.hooks.challenge((ctx) => { if (matchesArmed(ctx)) ctx.trusted = 'matchmaking'; }, { phase: 'filter', order: -999 });
    fc.hooks.challenge((ctx) => {
        if (ctx.trusted !== 'matchmaking' || !matchesArmed(ctx)) return;
        armed = null;
        setTimeout(() => {
            const r = fc.app.root(), all = fc.app.users();
            const user = (ctx.user && ctx.user.id && all[ctx.user.id]) || all[ctx.name] || ctx.user || { id: ctx.name, name: ctx.name };
            try { r.acceptChallenge(ctx.channel, user, ctx.id, ctx.ranked); } catch (e) { fc.log.warn('matchmaking accept failed', e.message); }
        }, 200);
    }, { order: -99 });
    // any set starting ends the queue
    fc.on('match:start', () => { if (mm && (mm.queue || mm.match)) { mm.started(); armed = null; paint(); setTimeout(tick, 50); } });

    fc.cmd('queue', 'Matchmaking: queue for a match in this game', () => {
        const fm = mod('find-match');
        if (fm && fm.open) fm.open(document.querySelector('.fcfmPill'));
    });
    fc.settings.block({
        id: 'matchmaking', section: 'challenges', title: 'Matchmaking', hint: '— queue up and get matched with another Fightcord player',
        store, order: 16,
        fields: [
            { type: 'note', label: 'In Find a match: pick Ranked (and the FT) or Casual and press Search. When another Fightcord player in the same game fits (Find a match’s rank range and ping), you both get a pop-up; when you both accept, the match starts. Only Fightcord players are in the queue.' },
            { key: 'enabled', type: 'switch', label: 'Matchmaking', onChange: () => { if (!cfg.enabled) cancel('off'); paint(); } },
            { key: 'alert', type: 'switch', label: 'Chime and notification when a match is found', show: (d) => d.enabled }
        ]
    });
    return api;
}

const api = {
    stripHtml: (ctx) => stripHtml(ctx),
    click: (act, el, ctx) => click(act, el, ctx),
    queued: () => !!(mm && mm.queue),
    cancel: () => cancel('cancel'),
    // for the dev harness: a match found with someone, without the relay
    _demo: (name, o) => {
        if (!mm) return;
        const ch = (fc.app.activeChannel() || {}).id || '';
        const h = hashOf(name) || 'demo';
        mm.queue = mm.queue || { ch, mode: (o && o.mode) || 'casual', ft: (o && o.ft) || 0, since: Date.now() - 23000 };
        mm.match = { id: 'demo' + Date.now().toString(36), h, name, ch, mode: mm.queue.mode, ft: mm.queue.ft, asker: true, stage: 'found', meReady: false, themReady: false, until: Date.now() + FOUND_MS };
        startUi();
        showModal(mm.match);
    },
    _queue: (mode, ft) => { if (!mm) return; const ch = (fc.app.activeChannel() || {}).id || ''; mm.queue = { ch, mode: mode || 'casual', ft: ft || 0, since: Date.now() - 42000 }; startUi(); paint(); },
    // for the tests: a stand-in relay, and a message as if it came from one
    _relays: (r) => { relays = r; },
    _onMsg: (raw) => onMsg(raw),
    get _mm() { return mm; }
};

module.exports = { id: 'matchmaking', name: 'Matchmaking', needs: ['match-screens', 'find-match'], start, compatible, misfit, asks, cleanMsg, signText, Matcher, KIND, TOPIC, FTS,
    TIMES: { BEAT, TTL, OFFER_MS, FOUND_MS, START_MS, SKIP_MS } };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
