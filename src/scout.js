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
    showQuits: true,         // warn about ranked sets they left unfinished
    cacheTtlMin: 5
};

const ttl = () => Math.max(1, +cfg.cacheTtlMin || 5) * 60000;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const mod = (id) => fc.modules.get(id);

/* --------------------------------------------------------------------- data */

// -> { form: {w,l}, h2h: {w,l,last}, recent: [{opp, mine, theirs, date, gameid}], scored }
function summariseQuarks(rows, name, me) {
    const lname = String(name || '').toLowerCase();
    const lme = String(me || '').toLowerCase();
    const out = { form: { w: 0, l: 0 }, h2h: { w: 0, l: 0, last: null }, recent: [], scored: 0, quits: { ranked: 0, unfinished: 0, behind: 0 } };
    for (const row of rows.slice(0, (cfg && cfg.historyLimit) || 25)) {
        const players = Array.isArray(row.players) ? row.players : [];
        const them = players.find(p => (p.name || '').toLowerCase() === lname);
        const opp = players.find(p => p !== them);
        if (!them || !opp) continue;
        const mine = typeof them.score === 'number' ? them.score : null;
        const theirs = typeof opp.score === 'number' ? opp.score : null;
        const date = fc ? fc.data.quarkDate(row) : (row.date || null);          // (no fc in the unit tests)
        out.recent.push({ opp: opp.name, mine, theirs, date, gameid: row.gameid || row.gameId || '' });
        // ranked = the FT (0 = casual): a ranked set where nobody reached it was left unfinished,
        // most likely by whoever was behind (or a disconnect)
        const ft = +row.ranked || 0;
        if (ft > 0 && mine !== null && theirs !== null) {
            out.quits.ranked++;
            if (Math.max(mine, theirs) < ft) {
                out.quits.unfinished++;
                if (mine < theirs) out.quits.behind++;
            }
        }
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
        card.__data = data;
        renderCard(card, name, data);
        // first look at this game: refine ELO / #spot once the leaderboard has landed
        if (data && data.boardPending) {
            fc.api.leaderboard(gameId()).then(() => loadScout(name)).then(d2 => { if (d2 && pop === me) renderCard(card, name, d2); }).catch(() => {});
        }
    });
    return card;
}

function stateOf(info) {
    return info && info.playing ? { k: 'playing', t: T('In a match') }
        : info && info.away ? { k: 'away', t: T('Not available') }
        : info ? { k: 'on', t: T('Looking to play') } : { k: 'off', t: T('Not in your channels') };
}

// "Left 3 of 12 ranked sets unfinished (2 while behind)" -- only once there's enough to go on
function quitsNote(q) {
    if (!q || (cfg && cfg.showQuits === false) || q.ranked < 4 || q.unfinished < 2) return '';
    const vars = { n: q.unfinished, total: q.ranked, behind: q.behind };
    return fc ? (q.behind ? T('Left {n} of {total} ranked sets unfinished ({behind} while behind)', vars) : T('Left {n} of {total} ranked sets unfinished', vars))
        : 'Left ' + q.unfinished + ' of ' + q.ranked + ' ranked sets unfinished' + (q.behind ? ' (' + q.behind + ' while behind)' : '');
}

// the numbers: one 2x2 grid (ELO, your odds, vs you, form), one warning, recent sets folded away
function sectionsHtml(name, data) {
    if (!data) return `<div class="fcsc-wait fc-muted"><span class="fc-spin"></span> ${E(T('Loading…'))}</div>`;
    if (data.error) return `<div class="fcsc-wait fc-muted">${E(T('Match history unavailable — {error}', { error: data.error }))}</div>`;
    const g = data.game, f = data.form, h = data.h2h, o = data.odds;
    const elo = data.elo
        ? { label: 'ELO', value: E(fc.data.fmtElo(data.elo)) + (data.elo.est ? ` <em>${E(T('est.'))}</em>` : ''),
            sub: (g && g.rank ? fc.ui.tag(g.rank, '', 14) + ' ' : '') + (data.lb ? '<span title="' + E(T('#{n} on the leaderboard', { n: data.lb.pos })) + '">#' + data.lb.pos + '</span>' : g && g.matches ? E(T('{n} matches', { n: fc.fmt.num(g.matches) })) : '') }
        : { label: 'Rank', value: g && g.rank ? fc.ui.tag(g.rank) : E(T('Unranked')) };
    const odds = o
        ? { label: 'Your odds', value: fc.fmt.pct(o.set), tone: o.set >= .5 ? 'up' : 'down', sub: E(T('to win an FT{ft}', { ft: o.ft })),
            title: T('{pct} per game', { pct: fc.fmt.pct(o.game) }) + ' · ' + T('You {mine} vs {theirs}', { mine: fc.data.fmtElo(data.myElo), theirs: fc.data.fmtElo(data.elo) }) }
        : { label: 'Your odds', value: '—', sub: E(T('not enough to go on')) };
    const vs = (h.w || h.l)
        ? { label: 'Vs you', value: h.w + '–' + h.l, tone: h.w > h.l ? 'up' : h.w < h.l ? 'down' : '', sub: h.last ? E(T('last {when}', { when: fc.fmt.day(h.last) })) : '' }
        : { label: 'Vs you', value: E(T('first time')) };
    const form = data.scored
        ? { label: 'Form', value: E(T('{w}W – {l}L', { w: f.w, l: f.l })), tone: f.w > f.l ? 'up' : f.w < f.l ? 'down' : '', sub: E(T('in the last {n} sets', { n: data.scored })) }
        : { label: 'Form', value: '—', sub: E(T('No recent sets')) };
    const rows = data.recent.slice(0, 3).map(r => {
        const known = r.mine != null && r.theirs != null;
        const mark = known && r.mine > r.theirs ? '<b class="up">W</b>' : known && r.mine < r.theirs ? '<b class="down">L</b>' : '<span class="fc-muted">·</span>';
        return `<tr><td class="m">${mark}</td><td class="o">${E(r.opp)}</td><td class="s">${known ? r.mine + '–' + r.theirs : ''}</td>` +
            `<td class="d">${E(fc.fmt.day(r.date))}</td></tr>`;
    }).join('');
    return fc.ui.stats([elo, odds, vs, form]) +
        fc.ui.warn(quitsNote(data.quits), T('Ranked sets that ended before anyone reached the FT. Could also be disconnects.')) +
        (rows ? `<details class="fcsc-recent"><summary>${E(T('Recent sets'))}</summary><table class="fcsc-sets">${rows}</table></details>` : '');
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
    const pr = mod('presence');
    const marks = (isFriend ? `<span class="fcsc-star" title="${E(T('Friend'))}">${fc.ui.ic('star', 'fill')}</span>` : '') + (pr && pr.mark ? pr.mark(name) : '');
    // one meta line: flag · state · ping
    const meta = (info && info.country ? fc.ui.flag(info.country, info.countryName || '') : '') +
        `<span><i class="fcsc-dot ${st.k}"></i>${E(st.t)}${fc.fmt.conn(info) ? ' · ' + E(fc.fmt.conn(info)) : ''}</span>`;
    card.innerHTML = fc.ui.cardHead({ name, banner: fc.data.hashColor(name), avatar: fc.ui.avatar(name, { size: 72, status: st.k, ring: 'var(--fc-s0)' }), marks, meta, close: true }) +
        `<div class="fcsc-body">
            ${notes ? `<div class="fcsc-notes">${notes}</div>` : ''}
            <div class="fcsc-panel">${sectionsHtml(name, data)}</div>
            ${!me ? `<div class="fcsc-acts">
                ${chal ? fc.ui.btn('Challenge', { icon: 'sword', act: 'challenge', cls: 'fc-grow', disabled: !chal.ok, title: chal.ok ? T('Challenge {name} (Fightcade asks for the FT)', { name }) : T(chal.why) }) : ''}
                ${fc.ui.btn(chal ? '' : 'Mention', { kind: 'sec', icon: 'chat', act: 'mention', cls: chal ? '' : 'fc-grow', title: T('Put @{name} in the chat box', { name }) })}
                ${fc.ui.btn('', { kind: 'sec', icon: 'more', act: 'more', title: 'More' })}
            </div>` : ''}
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
    else if (act === 'more') {
        const fr = mod('friends'), nt = mod('notes'), st = mod('stats');
        const r = card.getBoundingClientRect();
        const items = [];
        if (nt) items.push({ label: T('Notes & tags'), icon: 'note', fn: () => nt.edit(name, { left: r.left, bottom: r.top + 60, top: r.top, right: r.right }) });
        if (st && st.open) items.push({ label: T('Head-to-head'), icon: 'chart', fn: () => { closeCard(); st.open({ opp: name }); } });
        if (fr && fr.isFriend) { const on = fr.isFriend(name); items.push({ label: T(on ? 'Remove friend' : 'Add friend'), icon: 'star', fn: () => { fr.toggle(name); renderCard(card, name, card.__data || null); } }); }
        if (items.length) fc.ui.menu(b, items, { side: 'bottom' });
    }
    else if (act === 'mention') { closeCard(); fc.app.mention(name); }
    else if (act === 'friend') {
        const fr = mod('friends');
        if (!fr) return;
        const on = fr.toggle(name) ? true : fr.isFriend(name);
        b.classList.toggle('on', on);
        b.lastChild.textContent = on ? T('Friend') : T('Add friend');
        b.title = on ? T('Remove friend') : T('Add friend');
    } else if (act === 'challenge') {
        const ms = mod('match-screens');
        const st = ms && ms.challenge ? ms.challenge(name) : null;
        if (st && st.ok) { b.lastChild.textContent = T('Sent'); setTimeout(closeCard, 700); }
        else if (st) { b.lastChild.textContent = T(st.why); b.disabled = true; }
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
.fcsc-body { padding: 0 16px 16px; }
.fcsc-dot { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; vertical-align: 1px; background: #80848e; }
.fcsc-dot.on { background: var(--fc-success); }
.fcsc-dot.away { background: var(--fc-warning); }
.fcsc-dot.playing { background: var(--fc-danger); }
.fcsc-star { color: var(--fc-warning); display: inline-flex; }
.fcsc-star .fc-ic { width: 14px; height: 14px; }
.fcsc-notes { margin-top: 10px; }
.fcsc-wait { padding: 16px 0 4px; font-size: 13px; }
.fcsc-panel .fc-stat em { font-style: normal; font-size: 11px; font-weight: 600; color: var(--fc-muted); }
.fcsc-panel .fc-stat .fc-tag { vertical-align: -2px; }
.fcsc b.up { color: var(--fc-success); }
.fcsc b.down { color: var(--fc-danger); }
.fcsc-recent { margin-top: 8px; font-size: 13px; }
.fcsc-recent > summary { cursor: pointer; font: 700 11px/18px var(--fc-font); letter-spacing: .03em; text-transform: uppercase; color: var(--fc-muted); outline: none; }
.fcsc-recent > summary:hover { color: var(--fc-text); }
.fcsc-sets { width: 100%; margin-top: 4px; border-collapse: collapse; table-layout: fixed; }
.fcsc-sets td { padding: 3px 0; }
.fcsc-sets .m { width: 16px; font-weight: 700; }
.fcsc-sets .o { padding-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fcsc-sets .s { width: 40px; text-align: right; color: var(--fc-head); }
.fcsc-sets .d { width: 70px; padding-left: 8px; text-align: right; font-size: 12px; color: var(--fc-muted); }
.fcsc-acts { display: flex; margin-top: 12px; }
.fcsc-acts > .fc-grow { flex: 1; }
.fcsc-acts > .fc-btn + .fc-btn { margin-left: 8px; }
.fcScoutBadge { cursor: pointer; opacity: .35; margin-left: 4px; }
.fcScoutBadge .fc-ic { width: 11px; height: 11px; vertical-align: -1px; }
.fcScoutBadge:hover { opacity: .9; }
.fcScoutOdds { display: inline-block; margin-left: 8px; padding: 1px 6px; border-radius: 4px; font-size: 12px; font-weight: 600; vertical-align: middle; }
.fcScoutOdds.up { color: var(--fc-success); background: rgba(35,165,90,.14); }
.fcScoutOdds.down { color: var(--fc-danger); background: rgba(242,63,67,.14); }
`;

/* ----------------------------------------------------------------- triggers */

const cleanName = (text) => String(text || '').trim().replace(/[:\s]+$/, '');

function addBadges() {
    if (!cfg.enabled || !cfg.showBadges) return;
    const badge = (name) => `<span class="fcScoutBadge" data-scout="${E(name)}" title="${E(T('Scout {name}', { name }))}">${fc.ui.icon('search')}</span>`;
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
        pill.title = T('Your odds: ~{game} per game, {set} to win the FT{ft}', { game: fc.fmt.pct(o.game), set: fc.fmt.pct(o.set), ft: o.ft }) +
            '\n' + T('You {mine} vs {theirs}', { mine: fc.data.fmtElo(d.myElo), theirs: fc.data.fmtElo(d.elo) }) + ((d.elo.est || d.myElo.est) ? ' ' + T('(estimated)') : '');
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
            { key: 'showBadges', type: 'switch', label: 'Name badges', hint: 'A magnifier next to names in chat and the member list', show: (d) => d.enabled },
            { key: 'showQuits', type: 'switch', label: 'Unfinished sets', hint: 'Warn when someone often leaves ranked sets before the FT is reached', show: (d) => d.enabled },
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
    quitsNote: (q) => quitsNote(q),
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
