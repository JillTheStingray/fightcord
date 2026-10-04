/**
 * Scout: who you're about to play
 *
 * A profile card with rank, ELO (real or estimated), your odds, recent form and your
 * head-to-head record. Fills the gap Fightcade leaves: it shows *who* someone is
 * (rank, ping, flag) but never *how they play*.
 *
 * Opens from: an incoming challenge (when the challenge card is off), the 🔍 badge next
 * to names, a left-click on a chat avatar (Discord theme), or /scout <name>
 * (/scout debug <name> logs the raw API answers).
 *
 * Runs on fightcord-core.js. Every Fightcade API call goes through fc.api (cached,
 * queued, backed off on 429 / Cloudflare).
 */
'use strict';

let fc = null;
let cfg = null;              // scout-config.json

const DEFAULTS = {
    enabled: true,
    onChallenge: true,       // pop the card when someone challenges you (if the challenge card is off)
    showBadges: true,        // 🔍 next to names
    historyLimit: 25,        // how many recent sets to summarise
    cacheTtlMin: 5
};

const ttl = () => Math.max(1, +cfg.cacheTtlMin || 5) * 60000;
const E = (s) => fc.fmt.esc(s);
const mod = (id) => fc.modules.get(id);

/* --------------------------------------------------------------------- data */

// -> { form: {w,l}, h2h: {w,l,last}, recent: [{opp, mine, theirs, date, gameid}], scored }
function summariseQuarks(rows, name, me) {
    const lname = String(name || '').toLowerCase();
    const lme = String(me || '').toLowerCase();
    const out = { form: { w: 0, l: 0 }, h2h: { w: 0, l: 0, last: null }, recent: [], scored: 0 };
    for (const row of rows.slice(0, (cfg && cfg.historyLimit) || 25)) {
        const players = Array.isArray(row.players) ? row.players : [];
        const them = players.find(p => (p.name || '').toLowerCase() === lname);
        const opp = players.find(p => p !== them);
        if (!them || !opp) continue;
        const mine = typeof them.score === 'number' ? them.score : null;
        const theirs = typeof opp.score === 'number' ? opp.score : null;
        const date = fc.data.quarkDate(row);
        out.recent.push({ opp: opp.name, mine, theirs, date, gameid: row.gameid || row.gameId || '' });
        if (mine === null || theirs === null || mine === theirs) continue;
        out.scored++;
        const won = mine > theirs;
        if (won) out.form.w++; else out.form.l++;
        if (lme && (opp.name || '').toLowerCase() === lme) {
            if (won) out.h2h.l++; else out.h2h.w++;            // counted from YOUR side
            if (!out.h2h.last || (date && date > out.h2h.last)) out.h2h.last = date;
        }
    }
    return out;
}

// Everyone you've recently played, from ONE request for your own sets
// -> Map(lowercased name -> {name, w, l, sets, last})
async function recentOpponents() {
    const me = fc.app.me();
    if (!me) return new Map();
    const rows = await fc.api.quarks({ username: me }, { ttl: ttl() });
    const lme = me.toLowerCase();
    const map = new Map();
    for (const row of rows) {
        const players = Array.isArray(row.players) ? row.players : [];
        const mine = players.find(p => (p.name || '').toLowerCase() === lme);
        const opp = players.find(p => p !== mine);
        if (!mine || !opp || !opp.name) continue;
        const key = opp.name.toLowerCase();
        const e = map.get(key) || { name: opp.name, w: 0, l: 0, sets: 0, last: null };
        e.sets++;
        if (typeof mine.score === 'number' && typeof opp.score === 'number' && mine.score !== opp.score) {
            if (mine.score > opp.score) e.w++; else e.l++;
        }
        const d = fc.data.quarkDate(row);
        if (d && (!e.last || d > e.last)) e.last = d;
        map.set(key, e);
    }
    return map;
}

// the FT someone challenged us at in the last 3 minutes (a later look is about a new set)
const pendingFt = new Map();     // lowercased name -> {ft, at}
function knownFt(lower) {
    const p = pendingFt.get(String(lower || '').toLowerCase());
    return p && Date.now() - p.at < 3 * 60000 ? p.ft : null;
}
const ftFor = (lower) => knownFt(lower) || 3;

// a game id for the channel on screen (also in casual rooms)
const gameId = () => fc.app.activeGameId() || null;

async function loadScout(name) {
    const gameid = gameId();
    const out = { game: null, form: { w: 0, l: 0 }, h2h: { w: 0, l: 0, last: null }, recent: [], scored: 0 };
    try {
        const me = fc.app.me();
        const req = (body) => fc.api.request(body, { ttl: ttl(), priority: 'high' });
        const [userJson, quarkJson, meJson] = await Promise.all([
            req({ req: 'getuser', username: name }).catch(e => ({ _err: e.message })),
            req({ req: 'searchquarks', username: name }).catch(e => ({ _err: e.message })),
            me && me !== name ? req({ req: 'getuser', username: me }).catch(() => null) : null
        ]);
        // the leaderboard only if it's already here; the card redraws when it lands
        const board = fc.api.cachedBoard(gameid);
        out.boardPending = !board && !!gameid;
        if (userJson && userJson._err && quarkJson && quarkJson._err) return { error: userJson._err };

        const u = fc.data.pickUser(userJson);
        const gi = u && u.gameinfo && gameid ? u.gameinfo[gameid] : null;
        if (gi) out.game = { rank: gi.rank || 0, elo: gi.elo || gi.rating || null, matches: gi.num_matches || gi.matches || 0 };

        // ELO (real, or estimated from rank + leaderboard spot) and the odds
        const lower = name.toLowerCase();
        const info = fc.app.userInfo(name);
        out.lb = board ? board.get(lower) || null : null;
        // a real number when Fightcade sent one (fc.elo: Patreon supporters), else estimated
        out.elo = fc.data.eloFor(name, (gi && gi.rank) || (info && info.rank) || 0, board, (gi && (gi.elo || gi.rating)) || fc.elo.value(name, gameid));
        if (me && me.toLowerCase() !== lower) {
            const mu = fc.data.pickUser(meJson);
            const mgi = mu && mu.gameinfo && gameid ? mu.gameinfo[gameid] : null;
            const mine = fc.app.userInfo(me);
            out.myElo = fc.data.eloFor(me, (mgi && mgi.rank) || (mine && mine.rank) || 0, board, (mgi && (mgi.elo || mgi.rating)) || fc.elo.value(me, gameid));
            if (out.elo && out.myElo) out.odds = fc.data.winOdds(out.myElo.elo, out.elo.elo, ftFor(lower));
        }
        const rows = fc.data.pickRows(quarkJson);
        if (rows.length) Object.assign(out, summariseQuarks(rows, name, me));
    } catch (e) {
        return { error: e.message };
    }
    return out;
}

/* --------------------------------------------------------------------- card */

let pop = null;              // the open card: { el, close }
let popAnchor = null, popSide = 'bottom';

function closeCard() {
    if (!pop) return;
    const p = pop;
    pop = null;
    p.close();
}

// side: 'below' (under a badge), 'beside' (next to an avatar, Discord style)
function openCard(name, anchorRect, side) {
    closeCard();
    const card = document.createElement('div');
    card.id = 'fcScoutCard';
    card.className = 'fcsc';
    popAnchor = anchorRect || { left: window.innerWidth / 2 - 160, right: window.innerWidth / 2 - 160, top: 70, bottom: 70, width: 0, height: 0 };
    popSide = anchorRect && side === 'beside' ? 'right' : 'bottom';
    renderCard(card, name, null);
    const me = pop = fc.ui.popover(popAnchor, card, { cls: 'fcsc-pop', width: 320, side: popSide, onClose: () => { if (pop === me) pop = null; } });
    loadScout(name).then(data => {
        if (pop !== me) return;
        renderCard(card, name, data);
        // first look at this game: refine ELO / #spot once the leaderboard has landed
        if (data && data.boardPending) {
            fc.api.leaderboard(gameId()).then(() => loadScout(name)).then(d2 => { if (d2 && pop === me) renderCard(card, name, d2); }).catch(() => {});
        }
    });
    return card;
}

function winBar(w, l) {
    const total = w + l;
    return total ? `<div class="fcsc-bar"><i style="width:${Math.round(w / total * 100)}%"></i></div>` : '';
}

function section(title, html) {
    return `<div class="fcsc-sec"><div class="fcsc-h">${title}</div>${html}</div>`;
}

function stateOf(info) {
    return info && info.playing ? { k: 'playing', t: 'In a match' }
        : info && info.away ? { k: 'away', t: 'Not available' }
        : info ? { k: 'on', t: 'Looking to play' } : { k: 'off', t: 'Not in your channels' };
}

function sectionsHtml(name, data) {
    if (!data) return `<div class="fcsc-sec fc-muted"><span class="fc-spin"></span> Loading…</div>`;
    if (data.error) return `<div class="fcsc-sec fc-muted">Match history unavailable — ${E(data.error)}</div>`;
    const gameid = gameId();
    const g = data.game, f = data.form, h = data.h2h, o = data.odds;
    const rank = g && g.rank
        ? fc.ui.tag(g.rank) + (data.elo ? ` <b>${E(fc.data.fmtElo(data.elo))}</b><span class="fc-muted"> ELO${data.elo.est ? ' est.' : ''}</span>` : '') +
          (g.matches ? `<span class="fc-muted"> · ${E(fc.fmt.num(g.matches))} matches</span>` : '') +
          (data.lb ? `<div class="fcsc-note">#${data.lb.pos} on the leaderboard${data.lb.hours ? ' · ' + fc.fmt.num(data.lb.hours) + 'h played' : ''}</div>` : '')
        : '<span class="fc-muted">Unranked</span>';
    const odds = o
        ? `<b>${fc.fmt.pct(o.game)}</b><span class="fc-muted"> per game · </span><b class="${o.set >= .5 ? 'up' : 'down'}">${fc.fmt.pct(o.set)}</b>` +
          `<span class="fc-muted"> to win an FT${o.ft}</span>${winBar(Math.round(o.set * 100), 100 - Math.round(o.set * 100))}` +
          `<div class="fcsc-note">You ${E(fc.data.fmtElo(data.myElo))} vs ${E(fc.data.fmtElo(data.elo))}${(data.elo.est || data.myElo.est) ? ' · estimated from rank and leaderboard spot' : ''}</div>`
        : '';
    const form = data.scored
        ? `<b>${f.w}W – ${f.l}L</b><span class="fc-muted"> in the last ${data.scored} sets</span>${winBar(f.w, f.l)}`
        : '<span class="fc-muted">No recent sets</span>';
    const vs = (h.w || h.l)
        ? `<b class="${h.w > h.l ? 'up' : h.w < h.l ? 'down' : ''}">${h.w} – ${h.l}</b><span class="fc-muted">${h.last ? ' · last ' + E(fc.fmt.day(h.last)) : ''}</span>${winBar(h.w, h.l)}`
        : '<span class="fc-muted">Never played</span>';
    const rows = data.recent.slice(0, 5).map(r => {
        const known = r.mine != null && r.theirs != null;
        const mark = known && r.mine > r.theirs ? '<b class="up">W</b>' : known && r.mine < r.theirs ? '<b class="down">L</b>' : '<span class="fc-muted">·</span>';
        return `<tr><td class="m">${mark}</td><td class="o">${E(r.opp)}</td><td class="s">${known ? r.mine + '–' + r.theirs : ''}</td>` +
            `<td class="d">${E(fc.fmt.day(r.date))}</td></tr>`;
    }).join('');
    return section('Rank' + (gameid ? ` <span class="fcsc-game">· ${E(gameid)}</span>` : ''), rank) +
        (odds ? section('Your odds', odds) : '') + section('Form', form) + section('Vs you', vs) +
        section('Recent sets', rows ? `<table class="fcsc-sets">${rows}</table>` : '<span class="fc-muted">Nothing recent</span>');
}

function renderCard(card, name, data) {
    const info = fc.app.userInfo(name);
    const st = stateOf(info);
    const me = fc.app.isMe(name);
    const fr = mod('friends');
    const isFriend = !!(fr && fr.isFriend && fr.isFriend(name));
    const nt = mod('notes');
    const notes = nt && nt.chips ? nt.chips(name) : '';
    const ms = mod('match-screens');
    const chal = !me && ms && ms.challengeState ? ms.challengeState(name) : null;
    card.innerHTML = `
        <div class="fcsc-banner" style="background:${fc.data.hashColor(name)}"></div>
        ${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'close', act: 'close', title: 'Close', cls: 'fcsc-x' })}
        <div class="fcsc-body">
            <div class="fcsc-av">${fc.ui.avatar(name, { size: 80, status: st.k, ring: 'var(--fc-s0)' })}</div>
            <div class="fcsc-name" title="${E(name)}">${E(name)}</div>
            ${info && info.country ? `<div class="fcsc-from">${fc.ui.flag(info.country)} ${E(info.countryName || info.country.toUpperCase())}</div>` : ''}
            <div class="fcsc-state"><i class="dot ${st.k}"></i>${E(st.t)}${fc.fmt.conn(info) ? ' · ' + E(fc.fmt.conn(info)) : ''}` +
                `${info && info.rank ? ' · channel rank ' + E(fc.data.rankLetter(info.rank)) : ''}</div>
            ${notes ? `<div class="fcsc-notes">${notes}</div>` : ''}
            <div class="fcsc-panel">${sectionsHtml(name, data)}</div>
            ${!me ? `<div class="fcsc-acts">
                ${chal ? fc.ui.btn('Challenge', { kind: 'sec', size: 'sm', icon: 'sword', act: 'challenge', disabled: !chal.ok, title: chal.ok ? 'Challenge ' + name + ' (Fightcade asks for the FT)' : chal.why }) : ''}
                ${nt ? fc.ui.btn('Notes', { kind: 'sec', size: 'sm', icon: 'note', act: 'notes', title: 'Private notes & tags' }) : ''}
                ${mod('stats') ? fc.ui.btn('H2H', { kind: 'sec', size: 'sm', icon: 'chart', act: 'h2h', title: 'Head-to-head stats' }) : ''}
            </div>` : ''}
            <div class="fcsc-main">
                ${fc.ui.btn('Mention', { act: 'mention', icon: 'chat', cls: 'fc-grow', title: 'Put @' + name + ' in the chat box' })}
                ${fr && fr.isFriend && !me ? fc.ui.btn(isFriend ? 'Friend' : 'Add friend', { kind: 'sec', icon: 'star', act: 'friend', cls: isFriend ? 'fcsc-fr on' : 'fcsc-fr', title: isFriend ? 'Remove friend' : 'Add friend' }) : ''}
            </div>
        </div>`;
    card.onclick = (e) => onCardClick(e, card, name);
    if (pop && pop.el.contains(card)) fc.ui.place(pop.el, popAnchor, popSide);
}

function onCardClick(e, card, name) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.stopPropagation();
    const act = b.getAttribute('data-act');
    if (act === 'close') closeCard();
    else if (act === 'mention') { closeCard(); fc.app.mention(name); }
    else if (act === 'friend') {
        const fr = mod('friends');
        if (!fr) return;
        const on = fr.toggle(name) ? true : fr.isFriend(name);
        b.classList.toggle('on', on);
        b.lastChild.textContent = on ? 'Friend' : 'Add friend';
        b.title = on ? 'Remove friend' : 'Add friend';
    } else if (act === 'challenge') {
        const ms = mod('match-screens');
        const st = ms && ms.challenge ? ms.challenge(name) : null;
        if (st && st.ok) { b.lastChild.textContent = 'Sent'; setTimeout(closeCard, 700); }
        else if (st) { b.lastChild.textContent = st.why; b.disabled = true; }
    } else if (act === 'notes') {
        const nt = mod('notes');
        const r = card.getBoundingClientRect();
        if (nt) nt.edit(name, { left: r.left, bottom: r.top + 60, top: r.top, right: r.right });
    } else if (act === 'h2h') {
        const st = mod('stats');
        closeCard();
        if (st && st.open) st.open({ opp: name });
    }
}

const CSS = `
.fc-pop.fcsc-pop { padding: 0; overflow-x: hidden; }
.fcsc { position: relative; width: 320px; }
.fcsc-banner { height: 60px; }
.fcsc .fcsc-x { position: absolute; top: 8px; right: 8px; color: #fff; background: rgba(0,0,0,.35); }
.fcsc .fcsc-x:hover { background: rgba(0,0,0,.55); }
.fcsc-body { position: relative; padding: 48px 16px 16px; }
.fcsc-av { position: absolute; left: 12px; top: -44px; line-height: 0; padding: 4px; border-radius: 50%; background: var(--fc-s0); }
.fcsc-av .fc-avatar > .st { border-width: 4px; }
.fcsc-name { font: 700 20px/24px var(--fc-font); color: var(--fc-head); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fcsc-from { margin-top: 2px; font-size: 14px; }
.fcsc-from .fc-flag { margin-right: 4px; }
.fcsc-state { margin-top: 6px; font-size: 13px; color: var(--fc-muted); }
.fcsc-state .dot { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; vertical-align: 1px; background: #80848e; }
.fcsc-state .dot.on { background: var(--fc-success); }
.fcsc-state .dot.away { background: var(--fc-warning); }
.fcsc-state .dot.playing { background: var(--fc-danger); }
.fcsc-notes { margin-top: 10px; }
.fcsc-panel { margin-top: 12px; padding: 0 12px 12px; border-radius: var(--fc-r2); background: var(--fc-s2); }
.fcsc-sec { padding-top: 12px; font-size: 13px; }
.fcsc-h { margin-bottom: 4px; font: 700 12px/1.2 var(--fc-font); letter-spacing: .02em; text-transform: uppercase; color: var(--fc-muted); }
.fcsc-game { text-transform: none; font-weight: 400; }
.fcsc b { color: var(--fc-head); font-weight: 600; }
.fcsc b.up { color: var(--fc-success); }
.fcsc b.down { color: var(--fc-danger); }
.fcsc-note { margin-top: 3px; font-size: 11px; color: var(--fc-muted); }
.fcsc-bar { height: 4px; margin-top: 6px; border-radius: 2px; overflow: hidden; background: rgba(242,63,67,.5); }
.fcsc-bar > i { display: block; height: 100%; background: var(--fc-success); }
.fcsc-sets { width: 100%; border-collapse: collapse; table-layout: fixed; }
.fcsc-sets td { padding: 3px 0; }
.fcsc-sets .m { width: 16px; font-weight: 700; }
.fcsc-sets .o { padding-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fcsc-sets .s { width: 36px; text-align: right; color: var(--fc-head); }
.fcsc-sets .d { width: 70px; padding-left: 8px; text-align: right; font-size: 12px; color: var(--fc-muted); }
.fcsc-acts { display: flex; margin-top: 10px; }
.fcsc-acts > .fc-btn { flex: 1; }
.fcsc-acts > .fc-btn + .fc-btn { margin-left: 8px; }
.fcsc-main { display: flex; margin-top: 8px; }
.fcsc-main > .fc-btn + .fc-btn { margin-left: 8px; }
.fcsc-fr.on { color: var(--fc-warning); }
.fcScoutBadge { cursor: pointer; opacity: .35; margin-left: 4px; font-size: 10px; }
.fcScoutBadge:hover { opacity: .9; }
.fcScoutOdds { display: inline-block; margin-left: 8px; padding: 1px 6px; border-radius: 4px; font-size: 12px; font-weight: 600; vertical-align: middle; }
.fcScoutOdds.up { color: var(--fc-success); background: rgba(35,165,90,.14); }
.fcScoutOdds.down { color: var(--fc-danger); background: rgba(242,63,67,.14); }
`;

/* ----------------------------------------------------------------- triggers */

const cleanName = (text) => String(text || '').trim().replace(/[:\s]+$/, '');

function addBadges() {
    if (!cfg.enabled || !cfg.showBadges) return;
    const badge = (name) => `<span class="fcScoutBadge" data-scout="${E(name)}" title="Scout ${E(name)}">🔍</span>`;
    document.querySelectorAll('.chatContent span.author:not([data-scout-done]), .usersListWrapper .userItem .playerName:not([data-scout-done])').forEach(el => {
        el.dataset.scoutDone = '1';
        const name = cleanName(el.classList.contains('author') ? el.firstChild && el.firstChild.textContent : el.textContent);
        if (name) el.insertAdjacentHTML('afterend', badge(name));
    });
}

// Chat AVATARS only. Names and the member list are left alone on purpose: Fightcade opens
// its own Challenge/Profile/Spectate menu there on mousedown, with the Challenge button
// right under the cursor -- a click handler can't stop that (2026-09-27).
function clickedPlayer(t) {
    const hit = t.closest('.chatContent .message.chat header .avatarWrapper');
    if (!hit) return null;
    const w = hit.closest('.messageWrapper');
    const author = w && w.querySelector('header .author');
    const name = (w && w.dataset.currentUser) || cleanName(author && author.firstChild && author.firstChild.textContent);
    return name ? { name, el: hit.querySelector('img') || hit } : null;
}

function onDocumentClick(e) {
    const b = e.target.closest && e.target.closest('.fcScoutBadge');
    if (b) {
        e.preventDefault();
        e.stopPropagation();
        openCard(b.dataset.scout, b.getBoundingClientRect());
        return;
    }
    // Discord behaviour: left-click a chat avatar for the profile card
    if (e.button !== 0 || !cfg.enabled || !document.documentElement.classList.contains('dc-theme') || !e.target.closest) return;
    const hit = clickedPlayer(e.target);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    openCard(hit.name, hit.el.getBoundingClientRect(), 'beside');
}

// "71% · FT5" on the incoming challenge in chat (inside its own .userInfo box)
function oddsPill(name) {
    loadScout(name).then(d => {
        if (!d || !d.odds) return;
        const rows = [...document.querySelectorAll('.challengeWrapper .challengeContent .userInfo')]
            .filter(u => ((u.querySelector('.name') || {}).textContent || '').trim() === name);
        const row = rows[rows.length - 1];
        if (!row || row.querySelector('.fcScoutOdds')) return;
        const o = d.odds;
        const pill = document.createElement('span');
        pill.className = 'fcScoutOdds ' + (o.set >= .5 ? 'up' : 'down');
        pill.textContent = fc.fmt.pct(o.set) + ' · FT' + o.ft;
        pill.title = 'Your odds: ~' + fc.fmt.pct(o.game) + ' per game, ' + fc.fmt.pct(o.set) + ' to win the FT' + o.ft +
            '\nYou ' + fc.data.fmtElo(d.myElo) + ' vs ' + fc.data.fmtElo(d.elo) + ((d.elo.est || d.myElo.est) ? ' (estimated)' : '');
        row.appendChild(pill);
    }).catch(() => {});
}

function onChallenge(ctx) {
    const lower = ctx.name.toLowerCase();
    // only the last few minutes matter: drop the stale entries
    for (const [k, p] of pendingFt) if (Date.now() - p.at > 3 * 60000) pendingFt.delete(k);
    pendingFt.set(lower, { ft: ctx.ft || 3, at: Date.now() });
    if (!cfg.enabled) return;
    setTimeout(() => oddsPill(ctx.name), 300);
    // the challenge card already shows all of this: no second popup
    const card = mod('challenge-card');
    const cardOn = !!(card && (card._config || {}).enabled);
    if (cfg.onChallenge && !cardOn) setTimeout(() => openCard(ctx.name, null), 250);
}

/* --------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    cfg = fc.config('scout', DEFAULTS).data;
    window.__fcScoutLoaded = true;           // for plugins not on the core yet
    fc.ui.style('fcscStyle', CSS);
    fc.own(() => { fc.ui.style('fcscStyle', null); closeCard(); window.__fcScoutLoaded = false; });

    document.addEventListener('click', onDocumentClick, true);
    fc.own(() => document.removeEventListener('click', onDocumentClick, true));
    fc.watch(addBadges, { selector: '.chatContent, .usersListWrapper' });
    fc.hooks.challenge(onChallenge);

    fc.cmd('scout', 'Open someone’s scout card', (arg) => {
        if (/^debug\b/i.test(arg)) {
            const who = arg.replace(/^debug\s*/i, '') || fc.app.me();
            fc.log('debug: raw API for', who);
            fc.api.request({ req: 'getuser', username: who }, { ttl: 0 }).then(j => fc.log('getuser ->', j)).catch(er => fc.log('getuser failed:', er.message));
            fc.api.request({ req: 'searchquarks', username: who }, { ttl: 0 }).then(j => fc.log('searchquarks ->', j)).catch(er => fc.log('searchquarks failed:', er.message));
            return;
        }
        openCard(arg || fc.app.me(), null);
    }, { args: '<name>' });

    fc.settings.block({
        id: 'scout', section: 'challenges', title: 'Opponent scout', hint: '— rank, ELO, form, head-to-head',
        store: fc.config('scout'), order: 10,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Scout cards', hint: 'Profile cards with rank, ELO, odds and your record' },
            { key: 'onChallenge', type: 'switch', label: 'Open on a challenge', hint: 'Only when the challenge card is off', show: (d) => d.enabled },
            { key: 'showBadges', type: 'switch', label: 'Name badges', hint: '🔍 next to names in chat and the member list', show: (d) => d.enabled },
            { type: 'note', label: 'Or type /scout <name> in chat.' }
        ]
    });
    return api;
}

// what other modules use (also on module.exports, for plugins that require() this file)
const api = {
    openCard: (name, rect, side) => openCard(name, rect, side),
    closeCard,
    mention: (name) => fc.app.mention(name),
    scoutData: (name) => loadScout(name),
    recentOpponents,
    leaderboard: (g) => fc.api.leaderboard(g),
    knownFt,
    summariseQuarks,
    // old names, kept until every module is on the core
    localUserInfo: (name) => fc.app.userInfo(name),
    connText: (info) => fc.fmt.conn(info),
    eloFor: (...a) => fc.data.eloFor(...a),
    winOdds: (...a) => fc.data.winOdds(...a),
    fmtElo: (e) => fc.data.fmtElo(e),
    rankColor: (letter) => fc.data.RANK_COLOR[letter] || '',
    shortDate: (d) => fc.fmt.day(d),
    fcApi: (body, opts) => fc.api.request(body, Object.assign({ ttl: ttl() }, opts || {})),
    pickRows: (j) => fc.data.pickRows(j),
    pickUser: (j) => fc.data.pickUser(j),
    get _config() { return cfg; }
};

module.exports = {
    id: 'scout',
    name: 'Scout card, ELO & odds',
    start,
    stop() { /* everything registered through fc is undone by the core */ }
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
