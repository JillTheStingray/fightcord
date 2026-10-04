/**
 * Fightcord challenge card
 *
 * An incoming challenge becomes a Discord "incoming call" style card at the top of the
 * window: both avatars, their flag / rank / ping, ELO and your win odds, your record vs
 * them, your notes on them and any challenge-filter warnings -- with big Accept / Decline
 * buttons. Fightcade's own challenge in chat stays; the card just makes it hard to miss
 * and quick to answer. It closes itself when the challenge is accepted, declined or
 * cancelled anywhere.
 *
 * An 'after' step of the core's challenge pipeline (filters have already run: their
 * warnings come in ctx.warn). Accept / Decline call Fightcade's own root.acceptChallenge /
 * root.declineChallenge.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // challenge-card-config.json

const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
const mod = (id) => fc.modules.get(id);

/* -------------------------------------------------------------------- cards */

const cards = new Map();         // "channel|id" -> { el, d, timer }
const shown = [];                // for the harness
const MAX = 3;
const waiting = [];              // queue mode: challenges in arrival order, behind the card on screen

// Queue mode (its switch, or streamer mode): one card at a time, the rest wait their turn,
// and nothing pops up mid-match. -> 'show' | 'wait'
function decide(queueMode, visible, inMatch) {
    if (!queueMode) return 'show';
    return visible > 0 || inMatch ? 'wait' : 'show';
}
const streaming = () => { const s = mod('streamer'); return !!(s && s.active && s.active()); };
const queueMode = () => !!(cfg.queue || streaming());
const meInMatch = () => { try { return fc.app.inMatch(fc.app.me()); } catch (e) { return false; } };

function updateWaiting() {
    cards.forEach(c => {
        const q = c.el.querySelector('.ccQueue');
        if (q) { q.textContent = waiting.length ? T('{n} more waiting', { n: waiting.length }) : ''; q.hidden = !waiting.length; }
    });
}

// the next one in line (or, with queue mode off again, everyone still waiting)
function next() {
    if (!waiting.length) return;
    if (!queueMode()) { waiting.splice(0).forEach(d => show(d)); return; }
    if (cards.size || meInMatch()) return;
    show(waiting.shift(), true);
}

function stack() {
    let s = document.getElementById('ccStack');
    if (!s) {
        s = document.createElement('div');
        s.id = 'ccStack';
        document.body.appendChild(s);
    }
    return s;
}

function show(d, fromQueue) {
    if (!cfg.enabled || !d || !d.name) return;
    if (!d.demo && fc.app.isMe(d.name)) return;
    const k = d.channel + '|' + d.id;
    if (cards.has(k) || (!fromQueue && waiting.some(w => w.channel + '|' + w.id === k))) return;
    if (!d.demo && !fromQueue && decide(queueMode(), cards.size, meInMatch()) === 'wait') { waiting.push(d); updateWaiting(); return; }
    if (cards.size >= MAX) close([...cards.keys()][0]);
    const u = fc.app.user(d.name)[1] || {};
    const cc = u.country && u.country.iso_code ? String(u.country.iso_code).toLowerCase() : '';
    const rank = fc.data.rankLetter((u.channelRank && u.channelRank[d.channel]) || 0);
    const conn = fc.fmt.conn(fc.app.userInfo(d.name));
    const vs = fc.history.recordVs(d.name);
    const nt = mod('notes'), fr = mod('friends');
    const ft = +d.ranked || 0;
    const me = fc.app.me() || T('You');
    const el = document.createElement('div');
    el.className = 'ccCard';
    el.innerHTML = `
        <div class="ccGlow"></div>
        <div class="ccHead">${fc.ui.icon('sword', 'ccIco')}<span class="ccTitle">${E(T('Incoming challenge'))}</span>
            <span class="ccGame" title="${E(d.channel)}">${E(shortName(d.channel))}</span>
            <span class="ccQueue" hidden></span>
            <span class="ccFt ${ft ? 'ranked' : ''}">${E(ft ? T('FT{ft} ranked', { ft }) : T('Casual'))}</span>
            ${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'close', act: 'hide', title: 'Hide this card (the challenge stays in chat)', cls: 'ccX' })}</div>
        <div class="ccVs">
            <div class="ccP me">${fc.ui.avatar(me, { size: 44 })}<b>${E(me)}</b></div>
            <div class="ccVsTxt">VS</div>
            <div class="ccP them"><div class="ccRing">${fc.ui.avatar(d.name, { size: 56 })}</div>
                <b>${fc.ui.flag(cc)}${E(d.name)}${fr && fr.isFriend && fr.isFriend(d.name) ? ' <span class="ccStar">' + fc.ui.ic('star', 'fill') + '</span>' : ''}</b>
                <span class="ccMeta">${rank ? fc.ui.tag(rank) + ' ' : ''}${E(conn)}</span></div>
        </div>
        <div class="ccStats">
            <div class="ccStat"><span>ELO</span><b class="ccElo">…</b></div>
            <div class="ccStat odds"><span>${E(T('Your odds'))}</span><b class="ccOdds">…</b><div class="ccBar"><i></i></div></div>
            <div class="ccStat"><span>${E(T('You vs them'))}</span><b>${vs.w || vs.l ? vs.w + '–' + vs.l : E(T('first time'))}</b></div>
        </div>
        ${nt && nt.chips ? `<div class="ccNotes">${nt.chips(d.name)}</div>` : ''}
        ${(d.warn || []).length ? `<div class="ccWarn">${fc.ui.ic('warn')}${d.warn.map(w => E(T(w))).join(' · ')}</div>` : ''}
        <div class="ccBtns">
            <span class="ccBtn accept" data-cc="accept">${E(ft ? T('Accept FT{ft}', { ft }) : T('Accept'))}</span>
            <span class="ccBtn decline" data-cc="decline">${E(T('Decline'))}</span>
            <span class="ccBtn ghost" data-cc="scout">${E(T('Scout'))}</span>
        </div>`;
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick(k, e); });
    stack().appendChild(el);
    // Fightcade never expires a challenge; don't leave a forgotten card up forever
    cards.set(k, { el, d, timer: setTimeout(() => close(k), 5 * 60000) });
    shown.push({ name: d.name, channel: d.channel, id: d.id, ranked: d.ranked, at: Date.now() });
    if (shown.length > 50) shown.shift();
    setTimeout(() => el.classList.add('in'), 16);
    updateWaiting();
    if (cfg.sound && !d.silent) ring();
    fillOdds(el, d.name);
}

function fillOdds(el, name) {
    const scout = mod('scout');
    const setTxt = (sel, t) => { const x = el.querySelector(sel); if (x) x.textContent = t; };
    if (!scout || !scout.scoutData) { setTxt('.ccElo', '—'); setTxt('.ccOdds', '—'); return; }
    scout.scoutData(name).then(data => {
        if (!el.isConnected) return;
        setTxt('.ccElo', data && data.elo ? fc.data.fmtElo(data.elo) + (data.elo.est ? ' est.' : '') : '—');
        if (data && data.odds) {
            const p = Math.round(data.odds.set * 100);
            setTxt('.ccOdds', p + '%');
            const odds = el.querySelector('.ccStat.odds');
            odds.classList.add(p >= 50 ? 'good' : 'bad');
            odds.title = T('~{game}% per game, {set}% to win the FT{ft}', { game: Math.round(data.odds.game * 100), set: p, ft: data.odds.ft });
            el.querySelector('.ccBar i').style.width = p + '%';
        } else setTxt('.ccOdds', '—');
        // they often leave ranked sets unfinished (1 in 5 or more): say so before you accept
        const q = data && data.quits;
        if (q && scout.quitsNote && scout.quitsNote(q) && q.unfinished / q.ranked >= 0.2) {
            const w = document.createElement('div');
            w.className = 'ccWarn ccQuits';
            w.title = scout.quitsNote(q) + '. ' + T('Could also be disconnects.');
            w.innerHTML = fc.ui.ic('warn') + E(T('Leaves sets unfinished: {n} of {total} ranked', { n: q.unfinished, total: q.ranked }));
            const btns = el.querySelector('.ccBtns');
            if (btns && !el.querySelector('.ccQuits')) btns.parentNode.insertBefore(w, btns);
        }
    }).catch(() => { setTxt('.ccElo', '—'); setTxt('.ccOdds', '—'); });
}

function close(k) {
    const c = cards.get(k);
    if (!c) return;
    cards.delete(k);
    clearTimeout(c.timer);
    c.el.classList.remove('in');
    c.el.classList.add('out');
    setTimeout(() => c.el.remove(), 260);
    if (waiting.length) setTimeout(next, 300);
}

// a challenge that was cancelled before its turn came
function drop(k) {
    const i = waiting.findIndex(w => w.channel + '|' + w.id === k);
    if (i >= 0) { waiting.splice(i, 1); updateWaiting(); }
    close(k);
}

function userObj(d) {
    const all = fc.app.users();
    const u = d.user && d.user.id ? all[d.user.id] : null;
    return u || all[d.name] || d.user || { id: d.name, name: d.name };
}

function onClick(k, e) {
    const hit = e.target.closest('[data-cc], [data-act]');
    const act = hit && (hit.dataset.cc || hit.getAttribute('data-act'));
    const c = cards.get(k);
    if (!act || !c) return;
    const d = c.d, r = fc.app.root();
    if (act === 'hide') { close(k); return; }
    if (act === 'scout') {
        const sc = mod('scout');
        if (sc && sc.openCard) sc.openCard(d.name, c.el.getBoundingClientRect(), 'right');
        return;
    }
    if (d.demo) { close(k); return; }
    try {
        if (act === 'accept') r.acceptChallenge(d.channel, userObj(d), d.id, d.ranked);
        else if (act === 'decline') r.declineChallenge(d.channel, userObj(d), d.id);
    } catch (err) { fc.log.warn(act + ' failed', err.message); }
    close(k);
}

// three two-note rings
function ring() {
    const notes = [];
    for (let r = 0; r < 3; r++) notes.push([784, r * 0.8, 0.42, 'triangle'], [1047, r * 0.8 + 0.16, 0.42, 'triangle']);
    fc.sound.tone(notes, { volume: 0.5 });
}

// a dry run from the settings block
function preview() {
    const me = fc.app.me();
    const name = Object.keys(fc.app.users()).find(n => n !== me) || T('Challenger');
    show({ demo: true, name, channel: fc.app.activeChannelId() || 'Street Fighter III 3rd Strike', id: 'demo' + Date.now(), ranked: 3, warn: [] });
}

const CSS = `
#ccStack { position: fixed; top: 64px; left: 50%; z-index: 100002; width: 420px; margin-left: -210px; pointer-events: none; }
.ccCard { position: relative; overflow: hidden; margin-bottom: 12px; padding: 14px 16px 16px; border-radius: var(--fc-r4); pointer-events: auto;
    background: var(--fc-s0); color: var(--fc-text); font: 14px/1.35 var(--fc-font);
    box-shadow: 0 0 0 1px rgba(255,255,255,.07), 0 18px 48px rgba(0,0,0,.6), 0 0 42px var(--fc-accent-soft);
    opacity: 0; transform: translateY(-18px) scale(.96); transition: opacity .22s ease, transform .26s cubic-bezier(.2,.9,.3,1.2); }
.ccCard.in { opacity: 1; transform: none; }
.ccCard.out { opacity: 0; transform: translateY(-10px) scale(.97); transition: opacity .2s ease, transform .2s ease; }
.ccGlow { position: absolute; top: -60px; left: -40px; right: -40px; height: 140px; pointer-events: none;
    background: radial-gradient(ellipse at center, var(--fc-accent-soft), transparent 70%); }
.ccHead { position: relative; display: flex; align-items: center; font-size: 12px; color: var(--fc-muted); }
.ccHead .ccIco { width: 14px; height: 14px; margin-right: 6px; color: var(--fc-head); }
.ccTitle { font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--fc-head); }
.ccGame { flex: 1; min-width: 0; margin-left: 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ccQueue { flex: none; margin-left: 8px; padding: 2px 8px; border-radius: 10px; font-weight: 700; background: var(--fc-accent-soft); color: var(--fc-head); }
.ccQueue[hidden] { display: none; }
.ccFt { flex: none; margin-left: 8px; padding: 2px 8px; border-radius: 10px; font-weight: 700; background: rgba(255,255,255,.08); color: var(--fc-text); }
.ccFt.ranked { background: rgba(240,178,50,.16); color: var(--fc-warning); }
.ccHead .ccX { margin-left: 6px; }
.ccVs { position: relative; display: flex; align-items: center; justify-content: space-between; margin: 14px 4px 10px; }
.ccP { width: 150px; display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 0; }
.ccP.me .fc-avatar { margin: 6px 0; opacity: .8; }
.ccP b { margin-top: 6px; max-width: 150px; font-size: 16px; font-weight: 800; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ccP b .fc-flag { margin-right: 6px; }
.ccP.me b { font-size: 13px; font-weight: 600; color: var(--fc-muted); }
.ccRing { position: relative; line-height: 0; border-radius: 50%; padding: 3px; background: var(--fc-accent); }
.ccRing::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 50%; animation: ccPulse 1.4s ease-out infinite; }
@keyframes ccPulse { 0% { box-shadow: 0 0 0 0 var(--fc-accent); opacity: .9; } 100% { box-shadow: 0 0 0 16px var(--fc-accent); opacity: 0; } }
.ccStar { color: var(--fc-warning); }
.ccMeta { margin-top: 3px; display: flex; align-items: center; font-size: 12px; color: var(--fc-muted); }
.ccMeta .fc-tag { margin-right: 6px; }
.ccVsTxt { font-size: 28px; font-weight: 900; font-style: italic; color: var(--fc-head); text-shadow: 0 0 18px var(--fc-accent); }
.ccStats { position: relative; display: flex; margin: 0 -4px; }
.ccStat { flex: 1; margin: 0 4px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.05); min-width: 0; }
.ccStat span { display: block; font-size: 11px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--fc-muted); }
.ccStat b { display: block; margin-top: 2px; font-size: 16px; font-weight: 800; color: var(--fc-head); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ccStat.good b { color: var(--fc-success); } .ccStat.bad b { color: var(--fc-danger); }
.ccBar { height: 4px; margin-top: 4px; border-radius: 2px; background: rgba(242,63,67,.35); overflow: hidden; }
.ccBar i { display: block; height: 100%; width: 0; background: var(--fc-success); transition: width .5s ease; }
.ccNotes { margin-top: 10px; }
.ccNotes:empty { display: none; }
.ccWarn { margin-top: 10px; padding: 6px 10px; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: var(--fc-warning); background: rgba(240,178,50,.12); }
.ccBtns { position: relative; display: flex; margin-top: 14px; }
.ccBtn { flex: 1; height: 40px; margin-right: 8px; border-radius: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer;
    font-weight: 800; font-size: 14px; color: #fff; user-select: none; transition: transform .12s ease, filter .12s ease, box-shadow .12s ease; }
.ccBtn:last-child { margin-right: 0; }
.ccBtn:hover { transform: translateY(-1px); filter: brightness(1.1); }
.ccBtn.accept { flex: 1.5; background: linear-gradient(180deg, #2dc770, #1f8b4c); box-shadow: 0 0 18px rgba(35,165,90,.45); }
.ccBtn.decline { background: rgba(242,63,67,.14); color: var(--fc-danger); box-shadow: inset 0 0 0 1.5px rgba(242,63,67,.6); }
.ccBtn.decline:hover { background: var(--fc-danger); color: #fff; }
.ccBtn.ghost { flex: .8; background: rgba(255,255,255,.08); color: var(--fc-text); }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('challenge-card', { enabled: true, sound: true, queue: false });
    cfg = store.data;
    window.__fcCardLoaded = true;
    fc.ui.style('ccStyle', CSS);
    fc.own(() => { fc.ui.style('ccStyle', null); waiting.length = 0; [...cards.keys()].forEach(close); window.__fcCardLoaded = false; });

    // after the filters (their warnings are in ctx.warn) and Fightcade's own handler
    fc.hooks.challenge((ctx) => show({ user: ctx.user, name: ctx.name, channel: ctx.channel, id: ctx.id, ranked: ctx.ranked, warn: ctx.warn.slice() }), { order: 10 });
    // accepted / declined / cancelled anywhere -> Fightcade clears its notifications -> close our card
    fc.hooks.method(() => fc.app.root(), 'removeChallengeNotifications', { before(user, channel, id) { drop(channel + '|' + id); } });
    // finished a match: the first one waiting gets its card
    fc.on('match:end', () => setTimeout(next, 1500));
    fc.tick(() => { if (waiting.length && !cards.size) next(); }, 3000, { whileHidden: true });     // the match:end event can lag the score lookup
    fc.on('streamer', () => setTimeout(next, 50));

    fc.settings.block({
        id: 'challenge-card', section: 'challenges', title: 'Challenge card', hint: '— a big Accept / Decline card for incoming challenges',
        store, order: 20,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Show the challenge card' },
            { key: 'sound', type: 'switch', label: 'Ring when a challenge comes in', show: (d) => d.enabled, onChange: (v) => { if (v) ring(); } },
            { key: 'queue', type: 'switch', label: 'Queue challenges', hint: 'One card at a time in the order they came in, none mid-match (always on in streamer mode)', show: (d) => d.enabled, onChange: () => next() },
            { type: 'button', label: 'Preview the card', button: 'Preview', act: 'preview', onClick: preview }
        ]
    });
    return api;
}

const api = {
    show: (d) => show(d),
    preview: () => preview(),
    _cards: cards,
    _waiting: waiting,
    _next: () => next(),
    _shown: shown,
    get _config() { return cfg; }
};

module.exports = { id: 'challenge-card', name: 'Challenge card', start, decide };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
