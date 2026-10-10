/**
 * Fightcord game hub
 *
 * The channel's Rankings, Replays, Events and a Profile, inside Fightcade: the channel banner's
 * buttons used to open fightcade.com in the browser. One page with four tabs:
 *   - Rankings  the game's leaderboard (100 at a time), you highlighted, search, "Jump to me"
 *   - Replays   recent matches in the game (All / Mine / Friends / Top 100), Watch = Fightcade's replay
 *   - Events    the game's upcoming events first, with countdowns and the reminder bell
 *   - Profile   you or any player: Fightcade's rank, matches and hours, plus Fightcord's own numbers
 * Everything goes through fc.api (one queue, cache and back-off for all of Fightcord). Each tab
 * keeps a link to the full page on fightcade.com.
 */
'use strict';

let fc = null;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
const ET = (s, v) => E(fc.t(s, v));
const N_ = (s) => s;
const mod = (id) => fc.modules.get(id);
const lc = (s) => String(s || '').toLowerCase();
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');

const TABS = [['rankings', N_('Rankings'), 'trophy'], ['replays', N_('Replays'), 'play'], ['events', N_('Events'), 'clock'], ['profile', N_('Profile'), 'user']];
const FILTERS = [['all', N_('All')], ['mine', N_('Mine')], ['friends', N_('Friends')], ['top', N_('Top 100')]];

/* --------------------------------------------------------------- pure parts */

// a Fightcade quark row -> what a replay row shows
function replayRow(r, rom) {
    const players = (Array.isArray(r && r.players) ? r.players : []).slice(0, 2).map(p => ({
        name: p.name || p.username || '?', score: typeof p.score === 'number' ? p.score : null,
        cc: lc((p.country && (p.country.iso_code || p.country)) || ''), rank: p.rank || 0
    }));
    const quark = (r && (r.quarkid || r.quarkId || r.id)) || '';
    const emu = (r && r.emulator) || '';
    const live = !!r && (r.live === true || (typeof r.status === 'string' && /live|progress|playing/i.test(r.status)));
    const [a, b] = players;
    const known = !!(a && b && a.score != null && b.score != null);
    const d = r && (r.date != null ? r.date : r.created);
    const at = d == null ? null : typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : Date.parse(d);
    return {
        quark, emu, live, players, at: isNaN(at) ? null : at,
        winner: known && a.score !== b.score ? (a.score > b.score ? 0 : 1) : -1,
        ft: typeof (r && r.ranked) === 'number' && r.ranked > 0 ? r.ranked : null,
        games: (r && r.num_matches) || null,
        dur: (r && r.duration) || null,
        replay: emu && quark && !live ? 'https://replay.fightcade.com/' + emu + '/' + ((r && r.gameid) || rom) + '/' + quark : ''
    };
}

// All / Mine / Friends / Top 100 -- ctx: { me, friends: Set(lowercase), top: Set(lowercase) }
function filterReplays(rows, filter, ctx) {
    const has = (row, set) => row.players.some(p => set.has(lc(p.name)));
    if (filter === 'mine') return rows.filter(r => r.players.some(p => lc(p.name) === lc(ctx.me)));
    if (filter === 'friends') return rows.filter(r => has(r, ctx.friends || new Set()));
    if (filter === 'top') return rows.filter(r => has(r, ctx.top || new Set()));
    return rows;
}

// the leaderboard rows that match a search
const searchRanks = (rows, q) => { const k = lc(q).trim(); return k ? rows.filter(r => lc(r.name).indexOf(k) >= 0) : rows; };

// a searchrankings row -> a leaderboard row
function rankRow(r, i, rom) {
    const gi = (r && r.gameinfo && r.gameinfo[rom]) || {};
    return {
        pos: i + 1, name: (r && r.name) || '?', cc: lc((r && r.country && (r.country.iso_code || r.country)) || ''),
        rank: gi.rank || 0, matches: gi.num_matches || 0, hours: gi.time_played ? Math.round(gi.time_played / 3600) : 0,
        gravatar: (r && (r.gravatar || (r.user && r.user.gravatar))) || ''
    };
}

/* -------------------------------------------------------------------- state */

// what you click on here waits out a slow-down pause (up to 2 minutes) instead of failing
const ASK = (ttl) => ({ ttl, priority: 'high', wait: 120000 });

// Pictures: Fightcade's rankings and replays name players without their picture. Players in
// your channels have one (their gravatar), so every one seen is remembered (no extra requests).
let seen = null, seenStore = null, seenDirty = false;
function rememberAvatars() {
    if (!seen) return;
    const all = fc.app.users();
    Object.keys(all).forEach(n => {
        const g = all[n] && all[n].gravatar;
        if (g && seen[lc(n)] !== g) { seen[lc(n)] = g; seenDirty = true; }
    });
    const keys = Object.keys(seen);
    if (keys.length > 6000) keys.slice(0, keys.length - 6000).forEach(k => { delete seen[k]; });
    if (seenDirty) { seenDirty = false; seenStore.save(); }
}
const gravatarOf = (name, given) => given || ((fc.app.user(name)[1] || {}).gravatar) || (seen && seen[lc(name)]) || '';
const ava = (name, size, given) => `<span class="fc-avatar" style="--sz:${size}px"><img src="${E(fc.data.avatarUrl(name, gravatarOf(name, given), size * 2))}" alt="" loading="lazy"></span>`;
// the fields Fightcade's rows have, logged once (Settings → Diagnostics)
const shapes = {};
function noteShape(kind, row) { if (shapes[kind] || !row) return; shapes[kind] = true; fc.log('api row fields', kind, Object.keys(row).join(', ')); }

const view = { tab: 'rankings', channel: '', rom: '', links: {}, who: '' };
const rk = { rows: [], done: false, busy: false, err: '', q: '', rom: '' };
const rp = { rows: [], done: false, busy: false, err: '', filter: 'all', rom: '' };
const pf = { name: '', user: null, busy: false, err: '' };
let page = null;

function resetFor(rom) {
    if (rk.rom !== rom) Object.assign(rk, { rows: [], done: false, busy: false, err: '', q: '', rom });
    if (rp.rom !== rom) Object.assign(rp, { rows: [], done: false, busy: false, err: '', rom });
}

/* ------------------------------------------------------------------ loading */

async function loadRanks(more) {
    if (rk.busy || (more && rk.done) || !view.rom) return;
    rk.busy = true; rk.err = ''; render();
    try {
        const rows = await fc.api.rankings(view.rom, rk.rows.length, 100, ASK(10 * 60000));
        noteShape('rankings', rows[0]);
        rk.rows = rk.rows.concat(rows.map((r, i) => rankRow(r, rk.rows.length + i, view.rom)));
        rk.done = rows.length < 100;
    } catch (e) { rk.err = e.message || 'error'; }
    rk.busy = false;
    render();
}

async function loadReplays(more) {
    if (rp.busy || (more && rp.done) || !view.rom) return;
    rp.busy = true; rp.err = ''; render();
    try {
        const me = fc.app.me();
        const q = rp.filter === 'mine' && me ? { username: me, gameid: view.rom, limit: 30, offset: more ? rp.rows.length : 0 }
            : { gameid: view.rom, limit: 50, offset: more ? rp.rows.length : 0 };
        const raw = await fc.api.quarks(q, ASK(5 * 60000));
        noteShape('quarks', raw[0]);
        noteShape('quark player', raw[0] && raw[0].players && raw[0].players[0]);
        const rows = raw.map(r => replayRow(r, view.rom));
        // Mine asks for your sets (any game); keep this game's
        const keep = rp.filter === 'mine' ? rows.filter(r => !r.replay || r.replay.indexOf('/' + view.rom + '/') >= 0) : rows;
        rp.rows = more ? rp.rows.concat(keep) : keep;
        rp.done = rows.length < (q.limit || 50);
    } catch (e) { rp.err = e.message || 'error'; }
    rp.busy = false;
    render();
}

async function loadProfile(name) {
    if (!name) return;
    if (pf.name === name && (pf.user || pf.busy)) return;
    Object.assign(pf, { name, user: null, busy: true, err: '' });
    render();
    try {
        const user = await fc.api.user(name, ASK(10 * 60000));
        noteShape('user', user);
        if (pf.name !== name) return;
        pf.user = user || {};
    } catch (e) { if (pf.name === name) pf.err = e.message || 'error'; }
    if (pf.name === name) pf.busy = false;
    render();
}

/* ------------------------------------------------------------------- render */

const flag = (cc) => cc ? fc.ui.flag(cc) : '';
const onlineDot = (name) => { const s = fc.app.status(name); return s === 'on' || s === 'playing' ? `<i class="ghDot ${s}"></i>` : ''; };
const waitNote = () => fc.api.blockedFor() > 0 ? `<div class="ghWait">${fc.ui.ic('clock')}<span>${ET('Fightcade asked to slow down — loading in {s}s', { s: Math.ceil(fc.api.blockedFor() / 1000) })}</span></div>` : '';
const shimmer = (n) => waitNote() + `<div class="ghSkel">${'<i></i>'.repeat(n || 6)}</div>`;
const failed = (msg, act) => `<div class="ghErr">${fc.ui.icon('warn')}<span>${ET('Fightcade didn’t answer')} (${E(msg)})</span>${fc.ui.btn('Try again', { kind: 'sec', size: 'sm', act })}</div>`;
const siteLink = (key) => view.links[key] ? `<span class="ghSite" data-site="${E(key)}">${fc.ui.ic('link')}${ET('Open on fightcade.com')}</span>` : '';

function rankingsHtml() {
    const me = lc(fc.app.me());
    const rows = searchRanks(rk.rows, rk.q);
    const head = `<div class="ghBar"><input class="fc-input ghSearch" placeholder="${ET('Find a player…')}" value="${E(rk.q)}">` +
        fc.ui.btn('Jump to me', { kind: 'sec', size: 'sm', icon: 'user', act: 'jumpme' }) + `<span class="fc-grow"></span>${siteLink('rankings')}</div>`;
    if (!rk.rows.length && rk.busy) return head + shimmer(10);
    if (!rk.rows.length && rk.err) return head + failed(rk.err, 'rk-retry');
    const list = rows.map(r => `<div class="ghRow${lc(r.name) === me ? ' me' : ''}" data-name="${E(r.name)}">` +
        `<span class="pos${r.pos <= 3 ? ' top' + r.pos : ''}">${r.pos}</span>` +
        `<span class="who">${ava(r.name, 28, r.gravatar)}${onlineDot(r.name)}${flag(r.cc)}<b data-scout="${E(r.name)}">${E(r.name)}</b></span>` +
        `<span class="rk">${r.rank ? fc.ui.tag(r.rank) : ''}</span>` +
        `<span class="num">${r.matches.toLocaleString(fc.t.locale())}</span><span class="num">${r.hours ? r.hours.toLocaleString(fc.t.locale()) + ' h' : '—'}</span></div>`).join('');
    const none = rk.q && !rows.length ? `<div class="ghEmpty">${ET('No one called “{q}” in the loaded ranks.', { q: rk.q })} ${fc.ui.btn(T('Look up {name}', { name: rk.q }), { kind: 'sec', size: 'sm', act: 'lookup' })}</div>` : '';
    return head + `<div class="ghCols"><span>#</span><span>${ET('Player')}</span><span>${ET('Rank')}</span><span>${ET('Matches')}</span><span>${ET('Played')}</span></div>` +
        `<div class="ghList">${list}</div>${none}` +
        (!rk.done && !rk.q ? `<div class="ghMore">${rk.busy ? shimmer(2) : fc.ui.btn('Load more', { kind: 'sec', size: 'sm', act: 'rk-more' })}</div>` : '');
}

function replaysHtml() {
    const fr = mod('friends');
    const board = fc.api.cachedBoard(view.rom);
    const top = new Set();
    if (board) board.forEach((v, k) => { if (v.pos <= 100) top.add(k); });
    const ctx = { me: fc.app.me(), friends: new Set(fr && fr.list ? fr.list().map(lc) : []), top };
    const rows = filterReplays(rp.rows, rp.filter, ctx);
    const bar = `<div class="ghBar"><span class="ghSeg">${FILTERS.map(([k, l]) => `<span class="${rp.filter === k ? 'on' : ''}" data-filter="${k}">${ET(l)}</span>`).join('')}</span>` +
        `<span class="fc-grow"></span>${siteLink('replays')}</div>`;
    if (!rp.rows.length && rp.busy) return bar + shimmer(8);
    if (!rp.rows.length && rp.err) return bar + failed(rp.err, 'rp-retry');
    if (!rows.length) return bar + fc.ui.empty({ icon: 'play', title: rp.filter === 'friends' ? 'No replays with your friends here yet' : rp.filter === 'top' ? 'No top-100 players in these replays' : 'No replays yet' });
    const side = (p, win, right) => `<span class="pl${right ? ' r' : ''}${win ? ' win' : ''}">${right ? '' : flag(p.cc)}<b data-scout="${E(p.name)}">${E(p.name)}</b>${right ? flag(p.cc) : ''}</span>`;
    const list = rows.map(r => {
        const [a, b] = r.players;
        if (!a || !b) return '';
        const sc = a.score != null && b.score != null ? `${a.score} – ${b.score}` : 'vs';
        const when = r.live ? `<span class="live">● ${ET('LIVE')}</span>` : r.at ? E(fc.fmt.ago(r.at)) : '';
        const meta = [r.ft ? 'FT' + r.ft : '', r.dur ? Math.round(r.dur / 60) + ' min' : ''].filter(Boolean).join(' · ');
        return `<div class="ghRep">${side(a, r.winner === 0)}<span class="sc">${sc}</span>${side(b, r.winner === 1, true)}` +
            `<span class="meta">${E(meta)}</span><span class="when">${when}</span>` +
            (r.replay ? fc.ui.btn('Watch', { size: 'sm', icon: 'play', cls: 'ghWatch', attrs: `data-replay="${E(r.replay)}"`, title: 'Watch the replay in Fightcade' }) : '<span class="ghWatch none"></span>') + '</div>';
    }).join('');
    return bar + `<div class="ghList">${list}</div>` + (!rp.done ? `<div class="ghMore">${rp.busy ? shimmer(2) : fc.ui.btn('Load more', { kind: 'sec', size: 'sm', act: 'rp-more' })}</div>` : '');
}

function eventsHtml() {
    const ev = mod('events');
    const list = ev && ev.upcoming ? ev.upcoming() : [];
    const here = list.filter(e => e.gameid === view.rom || e.channel === view.channel);
    const rest = list.filter(e => here.indexOf(e) < 0);
    const now = Date.now();
    const card = (e) => {
        const d = new Date(e.date), live = e.date <= now;
        const left = live ? T('started') : T('in {t}', { t: countdown(e.date - now) });
        return `<div class="ghEv${e.why ? ' on' : ''}${live ? ' live' : ''}" data-ev="${E(e.key)}">` +
            `<div class="dt"><b>${E(d.toLocaleDateString(fc.t.locale(), { weekday: 'short' }))}</b><span>${d.getDate()}</span></div>` +
            (e.image ? `<div class="art" style="background-image:url('${E(e.image)}')"></div>` : '<div class="art none"></div>') +
            `<div class="tx"><b>${E(e.name)}</b><span>${E(d.toLocaleTimeString(fc.t.locale(), { hour: '2-digit', minute: '2-digit' }))}${e.region ? ' · ' + E(e.region) : ''}${e.channel && e.channel !== view.channel ? ' · ' + E(shortName(e.channel)) : ''}</span>` +
            `<em>${E(left)}</em></div>` +
            `<span class="bell${e.why ? ' on' : ''}" data-bell="${E(e.key)}" title="${ET(e.why ? 'Reminder on — click to turn it off' : 'Remind me')}">${fc.ui.ic('bell', e.why ? 'fill' : '')}</span>` +
            (e.channel && e.channel !== view.channel ? fc.ui.btn('Open channel', { kind: 'sec', size: 'sm', attrs: `data-open="${E(e.channel)}"` }) : '') +
            (e.link ? fc.ui.btn('Info', { kind: 'ghost', size: 'sm', attrs: `data-info="${E(e.link)}"` }) : '') + '</div>';
    };
    const bar = `<div class="ghBar"><span class="fc-grow"></span>${siteLink('events')}</div>`;
    if (!list.length) return bar + fc.ui.empty({ icon: 'clock', title: 'No upcoming events', sub: 'Fightcade lists tournaments on its home page and in game channels; they show up here.' });
    return bar + (here.length ? `<div class="ghH">${ET('In this game')}</div>${here.map(card).join('')}` : '') +
        (rest.length ? `<div class="ghH">${ET('Everything else')}</div>${rest.slice(0, 30).map(card).join('')}` : '');
}

function countdown(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.round(h / 24) + 'd';
}

function profileHtml() {
    const name = pf.name || fc.app.me() || '';
    const isMe = lc(name) === lc(fc.app.me());
    if (!pf.user && pf.busy) return shimmer(6);
    if (!pf.user && pf.err) return failed(pf.err, 'pf-retry');
    const u = pf.user || {};
    const gi = (u.gameinfo && u.gameinfo[view.rom]) || {};
    const board = fc.api.cachedBoard(view.rom);
    const spot = (board && board.get(lc(name))) || rk.rows.find(r => lc(r.name) === lc(name)) || null;
    const info = fc.app.userInfo(name);
    const cc = lc((u.country && (u.country.iso_code || u.country)) || (info && info.country) || '');
    const sets = isMe ? fc.history.all().filter(s => s.rom === view.rom || s.channel === view.channel) : fc.history.vs(name);
    const rec = fc.data.recordOf(sets);
    const chars = {};
    sets.forEach(s => { const c = isMe ? s.myChar : s.oppChar; if (c) chars[c] = (chars[c] || 0) + 1; });
    const topChars = Object.keys(chars).sort((a, b) => chars[b] - chars[a]).slice(0, 3);
    const pr = isMe ? mod('progress') : null;
    const sum = pr && pr.summary ? pr.summary(view.rom) : null;
    const elo = sum ? sum.ps.filter(p => p.elo).map(p => [p.at, p.elo]) : [];
    const tiles = [
        [gi.rank ? fc.ui.tag(gi.rank, '', 30) : '—', ET('Fightcade rank')],
        [E((gi.num_matches || 0).toLocaleString(fc.t.locale())), ET('matches')],
        [gi.time_played ? E(Math.round(gi.time_played / 3600).toLocaleString(fc.t.locale())) + ' h' : '—', ET('played')],
        [spot ? '#' + spot.pos : '—', ET('leaderboard')],
        [rec.w || rec.l ? E(fc.fmt.wl(rec)) : '—', isMe ? ET('your sets here') : ET('you vs them')]
    ];
    const nt = mod('notes');
    return `<div class="ghProf">
        <div class="hd">${ava(name, 84, u.gravatar || (u.user && u.user.gravatar))}
            <div class="who"><div class="nm">${flag(cc)}${E(name)}</div>
                <div class="sub">${E(shortName(view.channel))}${topChars.length ? ' · ' + E((isMe ? T('you play') : T('plays vs you')) + ' ' + topChars.join(', ')) : ''}</div>
                ${!isMe && nt && nt.chips ? nt.chips(name) : ''}</div>
            <div class="acts">${!isMe ? fc.ui.btn('Challenge', { kind: 'success', size: 'sm', icon: 'sword', act: 'challenge' }) : ''}
                ${fc.ui.btn(isMe ? 'Your stats' : 'Head-to-head', { kind: 'sec', size: 'sm', icon: 'chart', act: 'h2h' })}
                ${!isMe && nt ? fc.ui.btn('Notes', { kind: 'sec', size: 'sm', icon: 'note', act: 'notes' }) : ''}
                ${isMe ? siteLink('profile') : `<span class="ghSite" data-url="${E('https://www.fightcade.com/id/' + encodeURIComponent(name))}">${fc.ui.ic('link')}${ET('Open on fightcade.com')}</span>`}</div></div>
        <div class="tiles">${tiles.map(([v, k]) => `<div class="fc-tile"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')}</div>
        ${elo.length > 1 ? `<div class="fc-card ghElo"><h4>${ET('Your ELO in this game')}</h4>${fc.ui.chart.line([{ points: elo, color: 'var(--fc-accent)' }], { w: 760, h: 150 })}</div>` : ''}
        <div class="ghFind"><input class="fc-input ghWho" placeholder="${ET('Look up another player…')}">${fc.ui.btn('Show', { kind: 'sec', size: 'sm', act: 'who' })}</div>
    </div>`;
}

function render() {
    if (!page) return;
    page.setTitle(shortName(view.channel) || T('Game'));
    page.el.querySelectorAll('.ghTabs [data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === view.tab));
    let inner = '';
    try {
        inner = view.tab === 'replays' ? replaysHtml() : view.tab === 'events' ? eventsHtml() : view.tab === 'profile' ? profileHtml() : rankingsHtml();
    } catch (e) {
        fc.log.error('game hub ' + view.tab, e);
        inner = fc.ui.empty({ icon: 'warn', title: 'This tab couldn’t load', sub: e.message });
    }
    // keep typing in the search box when the list redraws
    const s = page.body.querySelector('.ghSearch');
    const had = s && document.activeElement === s ? s.selectionStart : null;
    page.body.innerHTML = `<div class="ghTab ${view.tab}">${inner}</div>`;
    if (had != null) { const n = page.body.querySelector('.ghSearch'); if (n) { n.focus(); n.setSelectionRange(had, had); } }
}

function showTab(tab) {
    view.tab = tab;
    if (tab === 'rankings' && !rk.rows.length) loadRanks(false);
    if (tab === 'replays' && !rp.rows.length) loadReplays(false);
    if (tab === 'profile') loadProfile(view.who || pf.name || fc.app.me());
    render();
}

/* ------------------------------------------------------------------ actions */

function openUri(u) { try { window.open(u, '_blank'); } catch (e) { /* ignore */ } }

async function jumpToMe() {
    const me = lc(fc.app.me());
    if (!me) return;
    rk.q = '';
    for (let i = 0; i < 5 && !rk.rows.some(r => lc(r.name) === me) && !rk.done; i++) await loadRanks(true);
    render();
    const el = page && page.body.querySelector('.ghRow.me');
    if (el) el.scrollIntoView({ block: 'center' });
    else fc.ui.toast(T('You’re not in the top {n} of this game yet', { n: rk.rows.length }), { icon: 'trophy' });
}

function onClick(e) {
    const t = e.target;
    const tab = t.closest('.ghTabs [data-tab]');
    if (tab) { showTab(tab.dataset.tab); return; }
    const sc = t.closest('[data-scout]');
    if (sc) { const s = mod('scout'); if (s && s.openCard) s.openCard(sc.dataset.scout, sc.getBoundingClientRect(), 'right'); return; }
    const row = t.closest('.ghRow[data-name]');
    if (row) { view.who = row.dataset.name; showTab('profile'); return; }
    const f = t.closest('[data-filter]');
    if (f) { if (rp.filter !== f.dataset.filter) { rp.filter = f.dataset.filter; rp.rows = []; rp.done = false; loadReplays(false); } return; }
    const rpl = t.closest('[data-replay]');
    if (rpl) { openUri(rpl.dataset.replay); return; }
    const site = t.closest('[data-site]');
    if (site) { openUri(view.links[site.dataset.site]); return; }
    const url = t.closest('[data-url]');
    if (url) { openUri(url.dataset.url); return; }
    const bell = t.closest('[data-bell]');
    if (bell) { const ev = mod('events'); if (ev && ev.toggle) { ev.toggle(bell.dataset.bell); render(); } return; }
    const op = t.closest('[data-open]');
    if (op) { const r = fc.app.root(); if (r && r.selectChannel) { close(); try { r.selectChannel(op.dataset.open); } catch (err) { /* ignore */ } } return; }
    const info = t.closest('[data-info]');
    if (info) { if (/^https?:\/\//i.test(info.dataset.info)) openUri(info.dataset.info); return; }
    const a = t.closest('[data-act]');
    const act = a && a.getAttribute('data-act');
    if (!act) return;
    if (act === 'rk-more') loadRanks(true);
    else if (act === 'rk-retry') { rk.rows = []; loadRanks(false); }
    else if (act === 'rp-more') loadReplays(true);
    else if (act === 'rp-retry') { rp.rows = []; loadReplays(false); }
    else if (act === 'pf-retry') { const n = pf.name; pf.name = ''; loadProfile(n); }
    else if (act === 'jumpme') jumpToMe();
    else if (act === 'lookup') { view.who = rk.q.trim(); showTab('profile'); }
    else if (act === 'who') { const v = page.body.querySelector('.ghWho').value.trim(); if (v) { view.who = v; pf.name = ''; showTab('profile'); } }
    else if (act === 'challenge') { const ms = mod('match-screens'); if (ms && ms.challenge) ms.challenge(pf.name); }
    else if (act === 'h2h') { const st = mod('stats'); close(); if (st && st.open) st.open(lc(pf.name) === lc(fc.app.me()) ? { game: shortName(view.channel) } : { opp: pf.name }); }
    else if (act === 'notes') { const nt = mod('notes'); if (nt && nt.edit) nt.edit(pf.name, a.getBoundingClientRect()); }
}

function onInput(e) {
    if (e.target.classList.contains('ghSearch')) { rk.q = e.target.value; render(); }
}
function onKey(e) {
    e.stopPropagation();                       // Fightcade's chat shortcuts stay out of the page
    if (e.key === 'Enter' && e.target.classList.contains('ghWho')) { const v = e.target.value.trim(); if (v) { view.who = v; pf.name = ''; showTab('profile'); } }
}

// opts: { tab, channel, rom, links, who }
function open(opts) {
    const o = opts || {};
    view.channel = o.channel || view.channel;
    view.rom = o.rom || view.rom;
    view.links = o.links || view.links || {};
    view.who = o.who || '';
    if (o.who) pf.name = '';
    resetFor(view.rom);
    if (!page) {
        page = fc.ui.page('game-hub', {
            title: shortName(view.channel), icon: 'pad', cls: 'ghPage',
            tools: `<span class="ghTabs">${TABS.map(([id, label, icon]) => `<span class="ghTabBtn" data-tab="${id}">${fc.ui.ic(icon)}${ET(label)}</span>`).join('')}</span>`,
            onClose: () => { page = null; }
        });
        page.el.id = 'ghHub';
        page.el.addEventListener('click', onClick);
        page.el.addEventListener('input', onInput);
        page.el.addEventListener('keydown', onKey);
        page.el.addEventListener('mousedown', (e) => e.stopPropagation());
        if (view.rom) {
            const head = page.el.querySelector('.fc-page-h');
            if (head) head.style.setProperty('--gh-art', 'url("' + fc.data.artUrl(view.rom, 'https://web.fightcade.com/') + '")');
        }
    }
    showTab(o.tab || view.tab || 'rankings');
}

function close() { if (page) page.close(); }

/* -------------------------------------------------------------------- style */

const CSS = `
#ghHub .fc-page-h { position: relative; overflow: hidden; }
#ghHub .fc-page-h::before { content: ''; position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: var(--gh-art) center 30% / cover;
    opacity: .16; filter: saturate(1.2); pointer-events: none; image-rendering: pixelated; }
#ghHub .fc-page-h > * { position: relative; }
#ghHub .ghTabs { display: inline-flex; margin-right: 12px; }
#ghHub .ghTabBtn { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; margin-left: 4px; border-radius: 6px; cursor: pointer;
    font: 600 13px/30px var(--fc-font); color: var(--fc-text); }
#ghHub .ghTabBtn .fc-ic { width: 15px; height: 15px; margin-right: 6px; }
#ghHub .ghTabBtn:hover { background: var(--fc-hover); }
#ghHub .ghTabBtn.on { background: var(--fc-accent); color: #fff; }
#ghHub .ghTab { max-width: 980px; margin: 0 auto; }
#ghHub .ghBar { display: flex; align-items: center; margin-bottom: 12px; }
#ghHub .ghBar > * + * { margin-left: 8px; }
#ghHub .ghSearch { width: 240px; height: 32px; }
#ghHub .ghSite { display: inline-flex; align-items: center; font-size: 12.5px; color: var(--fc-muted); cursor: pointer; }
#ghHub .ghSite:hover { color: var(--fc-text); text-decoration: underline; }
#ghHub .ghSite .fc-ic { width: 13px; height: 13px; margin-right: 5px; }
#ghHub .ghSeg { display: inline-flex; border-radius: 8px; overflow: hidden; background: var(--fc-btn); }
#ghHub .ghSeg span { padding: 0 12px; line-height: 30px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--fc-text); }
#ghHub .ghSeg span.on { background: var(--fc-accent); color: #fff; }
#ghHub .ghCols, #ghHub .ghRow { display: grid; grid-template-columns: 56px 1fr 70px 100px 90px; align-items: center; }
#ghHub .ghCols { padding: 0 10px 6px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fc-muted); }
#ghHub .ghRow { min-height: 44px; padding: 0 10px; border-radius: 8px; cursor: pointer; }
#ghHub .ghRow:hover { background: var(--fc-hover); }
#ghHub .ghRow.me { background: rgba(88,101,242,.16); box-shadow: inset 3px 0 0 var(--fc-accent); }
#ghHub .ghRow .pos { font-weight: 800; font-variant-numeric: tabular-nums; color: var(--fc-muted); }
#ghHub .ghRow .pos.top1 { color: #f0b232; } #ghHub .ghRow .pos.top2 { color: #c9d1d9; } #ghHub .ghRow .pos.top3 { color: #d08a4e; }
#ghHub .ghRow .who { position: relative; display: flex; align-items: center; min-width: 0; }
#ghHub .ghRow .who .fc-avatar { margin-right: 10px; }
#ghHub .ghRow .who .fc-flag { margin-right: 6px; }
#ghHub .ghRow .who b, #ghHub .ghRep b { font-weight: 700; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#ghHub .ghRow .who b:hover, #ghHub .ghRep b:hover { text-decoration: underline; }
#ghHub .ghDot { position: absolute; left: 20px; top: 22px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--fc-s1, #2b2d31); }
#ghHub .ghDot.on { background: var(--fc-success); } #ghHub .ghDot.playing { background: var(--fc-danger); }
#ghHub .ghRow .num { font-variant-numeric: tabular-nums; color: var(--fc-text); }
#ghHub .ghMore { display: flex; justify-content: center; padding: 14px 0; }
#ghHub .ghEmpty { padding: 18px 10px; color: var(--fc-muted); }
#ghHub .ghEmpty .fc-btn { margin-left: 8px; }
#ghHub .ghRep { display: grid; grid-template-columns: 1fr 70px 1fr 110px 90px 92px; align-items: center; min-height: 44px; padding: 0 10px; border-radius: 8px; }
#ghHub .ghRep:hover { background: var(--fc-hover); }
#ghHub .ghRep .pl { display: flex; align-items: center; min-width: 0; color: var(--fc-text); }
#ghHub .ghRep .pl.r { justify-content: flex-end; }
#ghHub .ghRep .pl .fc-flag { margin: 0 6px; }
#ghHub .ghRep .pl b { cursor: pointer; font-weight: 600; color: var(--fc-muted); }
#ghHub .ghRep .pl.win b { font-weight: 800; color: var(--fc-head); }
#ghHub .ghRep .sc { text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; }
#ghHub .ghRep .meta, #ghHub .ghRep .when { font-size: 12.5px; color: var(--fc-muted); text-align: right; }
#ghHub .ghRep .live { color: var(--fc-danger); font-weight: 700; }
#ghHub .ghWatch { justify-self: end; }
#ghHub .ghH { margin: 18px 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fc-muted); }
#ghHub .ghEv { display: flex; align-items: center; padding: 10px; margin-bottom: 8px; border-radius: 10px; background: var(--fc-s2, rgba(255,255,255,.04)); }
#ghHub .ghEv.on { box-shadow: inset 0 0 0 1px rgba(240,178,50,.45); }
#ghHub .ghEv .dt { flex: none; width: 52px; text-align: center; }
#ghHub .ghEv .dt b { display: block; font-size: 11px; text-transform: uppercase; color: var(--fc-warning); }
#ghHub .ghEv .dt span { font-size: 22px; font-weight: 800; color: var(--fc-head); }
#ghHub .ghEv .art { flex: none; width: 96px; height: 54px; margin: 0 12px 0 6px; border-radius: 6px; background: center / cover; background-color: rgba(0,0,0,.3); }
#ghHub .ghEv .tx { flex: 1; min-width: 0; }
#ghHub .ghEv .tx b { display: block; font-size: 15px; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#ghHub .ghEv .tx span { display: block; font-size: 12.5px; color: var(--fc-muted); }
#ghHub .ghEv .tx em { font-style: normal; font-size: 12.5px; font-weight: 700; color: var(--fc-warning); }
#ghHub .ghEv.live .tx em { color: var(--fc-danger); }
#ghHub .ghEv .bell { flex: none; width: 32px; height: 32px; margin: 0 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--fc-muted); background: rgba(255,255,255,.06); }
#ghHub .ghEv .bell.on { color: #1a1300; background: var(--fc-warning); }
#ghHub .ghEv .fc-btn { margin-left: 6px; }
#ghHub .ghProf .hd { display: flex; align-items: center; padding: 6px 0 16px; }
#ghHub .ghProf .who { flex: 1; min-width: 0; margin-left: 16px; }
#ghHub .ghProf .nm { display: flex; align-items: center; font-size: 26px; font-weight: 800; color: var(--fc-head); }
#ghHub .ghProf .nm .fc-flag { margin-right: 10px; }
#ghHub .ghProf .sub { margin-top: 2px; color: var(--fc-muted); }
#ghHub .ghProf .acts { display: flex; align-items: center; }
#ghHub .ghProf .acts > * { margin-left: 8px; }
#ghHub .ghProf .tiles { display: grid; grid-template-columns: repeat(5, 1fr); grid-gap: 10px; }
#ghHub .ghElo { margin-top: 14px; }
#ghHub .ghElo svg { width: 100%; height: auto; }
#ghHub .ghFind { display: flex; margin-top: 16px; }
#ghHub .ghFind .ghWho { width: 260px; height: 32px; margin-right: 8px; }
#ghHub .ghWait { display: flex; align-items: center; padding: 10px 14px; margin-bottom: 10px; border-radius: 8px; background: rgba(240,178,50,.1); color: var(--fc-warning); font-size: 13px; font-weight: 600; }
#ghHub .ghWait .fc-ic { width: 15px; height: 15px; margin-right: 8px; }
#ghHub .ghErr { display: flex; align-items: center; padding: 16px; border-radius: 8px; background: rgba(242,63,67,.08); color: var(--fc-text); }
#ghHub .ghErr .fc-ic { color: var(--fc-danger); margin-right: 8px; }
#ghHub .ghErr .fc-btn { margin-left: auto; }
#ghHub .ghSkel i { display: block; height: 40px; margin-bottom: 6px; border-radius: 8px;
    background: linear-gradient(90deg, rgba(255,255,255,.03), rgba(255,255,255,.08), rgba(255,255,255,.03)); background-size: 200% 100%; animation: ghShim 1.2s linear infinite; }
@keyframes ghShim { from { background-position: 200% 0; } to { background-position: -200% 0; } }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    fc.ui.style('ghStyle', CSS);
    seenStore = fc.config('game-hub', { avatars: {} });
    seen = seenStore.data.avatars || (seenStore.data.avatars = {});
    fc.tick(rememberAvatars, 30000, { delay: 5000 });
    // while something waits out a pause: count down in place (no redraw, the list keeps its scroll)
    fc.tick(() => {
        if (!page) return;
        page.body.querySelectorAll('.ghWait span').forEach(s => { const t = Math.ceil(fc.api.blockedFor() / 1000); s.textContent = t > 0 ? T('Fightcade asked to slow down — loading in {s}s', { s: t }) : T('Loading…'); });
    }, 1000, { whileHidden: true });
    fc.own(() => { fc.ui.style('ghStyle', null); close(); });
    return api;
}

const api = {
    open: (o) => open(o),
    close: () => close(),
    _view: () => Object.assign({}, view, { ranks: rk.rows.length, replays: rp.rows.length, profile: pf.name })
};

module.exports = { id: 'game-hub', name: 'Game hub', start, replayRow, filterReplays, searchRanks, rankRow };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
