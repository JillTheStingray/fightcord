/**
 * Fightcord lobby feed: "What's happening" in your channels
 *
 * Built only from what Fightcade already shows you -- no server of our own:
 *   - players joining (grouped: "5 players joined") and leaving
 *   - matches starting, with Watch
 *   - upsets: when an interesting match ends (a rank gap of 2+, a friend in it, a top-100
 *     player), its result is looked up -- queued and spaced out, never more than 30 an hour
 *   - win streaks spotted this session, top-100 players arriving, your friends' activity
 *
 * Opened from the "Feed" pill in the channel header (with a count of what's new) or /feed.
 * Filters: everything / friends only / big moments only. The last 200 items survive a
 * restart (feed-history.json).
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, cfg = null;          // feed-config.json
const FILE = path.join(__dirname, 'feed-history.json');
const MAX = 200;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const mod = (id) => fc.modules.get(id);
const short = (n) => String(n || '').replace(/\s*\([^)]*\)\s*$/, '');

/* -------------------------------------------------------------------- items */

// { id, at, kind, ch, big, low, text (html), names: [], quark, watch }
let items = [];
let seq = 0;
let saveTimer = 0;

function load() {
    try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); items = Array.isArray(j.items) ? j.items.slice(-MAX) : []; }
    catch (e) { items = []; }
    seq = items.reduce((n, it) => Math.max(n, +String(it.id).slice(1) || 0), 0);
}
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = 0;
        fs.writeFile(FILE, JSON.stringify({ v: 1, items: items.slice(-MAX) }), () => {});
    }, 2000);
}

const isFriend = (n) => { const fr = mod('friends'); return !!(fr && fr.isFriend && fr.isFriend(n)); };
const nameHtml = (n) => `<b class="fdName" data-name="${E(n)}">${E(n)}</b>`;

function push(it) {
    it.id = 'f' + (++seq);
    it.at = it.at || Date.now();
    items.push(it);
    if (items.length > MAX) items.splice(0, items.length - MAX);
    save();
    fc.emit('feed:item', it);
    const st = fc.modules.get('streamer');
    if (it.big && cfg.toastBig && it.kind !== 'friend' && !(st && st.quiet && st.quiet())) fc.ui.toast(it.plain || T('Something happened'), { icon: ICON[it.kind] || 'bell', ms: 7000, onClick: () => open(it.ch) });
    render();
    refreshPills();
}

/* ------------------------------------------------------------------- watching */

const prevChans = new Map();       // name -> Set(channel ids)
const knownQuarks = new Map();     // quark -> { players, ch, rom, ranks, at }
const pendingJoins = new Map();    // ch -> { names: [], at }
const pendingLeaves = new Map();
const chanSince = new Map();       // ch -> when it became one of yours
let booted = false;

function myChannels() { return new Set(fc.app.joinedChannels().map(c => c.id || c.name)); }

function rankIn(u, ch) { return +((u && u.channelRank || {})[ch] || 0); }
function topPos(name, ch) {
    const c = fc.app.channel(ch);
    const board = c && c.gameid ? fc.api.cachedBoard(c.gameid) : null;
    const row = board && board.get(String(name).toLowerCase());
    return row ? row.pos : 0;
}

function scan() {
    if (!cfg.enabled) return;
    const users = fc.app.users(), me = fc.app.me();
    const mine = myChannels();
    if (!me || !mine.size) return;
    // a channel you just joined (or Fightcade just loaded) fills up with everyone already there: give it 20 s
    const t = Date.now();
    mine.forEach(c => { if (!chanSince.has(c)) chanSince.set(c, t); });
    chanSince.forEach((at, c) => { if (!mine.has(c)) chanSince.delete(c); });
    const settled = (c) => t - chanSince.get(c) > 20000;
    const seen = new Set();
    Object.keys(users).forEach(name => {
        if (name === me) return;
        seen.add(name);
        const u = users[name];
        const now = new Set((Array.isArray(u.channels) ? u.channels : []).filter(c => mine.has(c)));
        const was = prevChans.get(name) || new Set();
        if (booted) {
            now.forEach(c => { if (!was.has(c) && settled(c)) queueJoin(pendingJoins, c, name); });
            was.forEach(c => { if (!now.has(c) && mine.has(c) && settled(c)) queueJoin(pendingLeaves, c, name); });
        }
        prevChans.set(name, now);
    });
    // gone from every channel
    prevChans.forEach((was, name) => {
        if (seen.has(name)) return;
        if (booted) was.forEach(c => { if (mine.has(c) && settled(c)) queueJoin(pendingLeaves, c, name); });
        prevChans.delete(name);
    });
    scanMatches(users, mine);
    flushJoins();
    booted = true;
}

function queueJoin(map, ch, name) {
    const p = map.get(ch) || { names: [], at: Date.now() };
    if (!p.names.includes(name)) p.names.push(name);
    map.set(ch, p);
}

// joins / leaves come in bursts: one item per channel every 30 s
function flushJoins() {
    const t = Date.now();
    [[pendingJoins, 'join'], [pendingLeaves, 'leave']].forEach(([map, kind]) => {
        map.forEach((p, ch) => {
            if (t - p.at < 30000) return;
            map.delete(ch);
            const names = p.names;
            const friends = names.filter(isFriend);
            push({ kind, ch, text: groupLine(names, kind, nameHtml, T), names, low: kind === 'leave', friend: friends.length > 0, plain: groupLine(names, kind, null, T) });
            // a top-100 player arriving is worth its own line
            if (kind === 'join') names.forEach(n => {
                const pos = topPos(n, ch);
                if (pos && pos <= 100) push({ kind: 'top', ch, big: true, names: [n], text: T('{name} just arrived — {pos} on the leaderboard', { name: nameHtml(n), pos: '<span class="fdTag">#' + pos + '</span>' }), plain: T('{name} (#{pos}) just arrived', { name: n, pos }) });
            });
        });
    });
}

function scanMatches(users, mine) {
    const live = new Map();          // quark -> { players: [], ch, rom, port }
    Object.keys(users).forEach(name => {
        const p = users[name].playing;
        if (!p || !p.quarkId || !mine.has(p.channelId)) return;
        const m = live.get(p.quarkId) || { players: [], ch: p.channelId, rom: p.gameId, port: p.port };
        m.players.push(name);
        live.set(p.quarkId, m);
    });
    live.forEach((m, quark) => {
        if (knownQuarks.has(quark)) { const k = knownQuarks.get(quark); if (m.players.length > k.players.length) k.players = m.players; return; }
        const ranks = m.players.map(n => rankIn(users[n], m.ch));
        knownQuarks.set(quark, { players: m.players.slice(), ch: m.ch, rom: m.rom, ranks, at: Date.now() });
        if (!booted) return;
        const c = fc.app.channel(m.ch);
        const watch = c && c.spectators !== false && !m.players.includes(fc.app.me())
            ? fc.data.watchUrl({ emu: c.emulator, rom: m.rom, quark, port: m.port }) : '';
        const [a, b] = m.players;
        const friend = m.players.some(isFriend);
        push({ kind: 'match', ch: m.ch, quark, watch, names: m.players, friend,
            text: T('{players} started a match', { players: nameHtml(a) + (b ? ' vs ' + nameHtml(b) : '') }) + rankPair(ranks), plain: T('{players} started', { players: a + (b ? ' vs ' + b : '') }) });
    });
    // ended: no one is playing it any more
    knownQuarks.forEach((k, quark) => {
        if (live.has(quark)) return;
        knownQuarks.delete(quark);
        if (booted && interesting(k)) queueLookup(quark, k);
    });
}

const L = (r) => fc.data.rankLetter(r);
function rankPair(ranks) {
    return ranks.length === 2 && ranks[0] && ranks[1] ? ' <span class="fdTag">' + L(ranks[0]) + ' vs ' + L(ranks[1]) + '</span>' : '';
}

const interesting = (k) => worthLookup(k.players, k.ranks, isFriend, (n) => topPos(n, k.ch));

// pure: "A joined" / "A and B joined" / "A, B and 3 others joined" (wrap formats each name,
// tr translates: N_('{a} joined') N_('{a} left') N_('{a} and {b} joined') N_('{a} and {b} left')
// N_('{a}, {b} and 1 other joined') N_('{a}, {b} and 1 other left') N_('{a}, {b} and {n} others joined') N_('{a}, {b} and {n} others left'))
function groupLine(names, kind, wrap, tr) {
    const w = wrap || String;
    const f = tr || ((s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k]));
    const j = kind === 'join';
    const [a, b] = names.slice(0, 2).map(w);
    if (names.length === 1) return f(j ? '{a} joined' : '{a} left', { a });
    if (names.length === 2) return f(j ? '{a} and {b} joined' : '{a} and {b} left', { a, b });
    const n = names.length - 2;
    return n === 1 ? f(j ? '{a}, {b} and 1 other joined' : '{a}, {b} and 1 other left', { a, b })
        : f(j ? '{a}, {b} and {n} others joined' : '{a}, {b} and {n} others left', { a, b, n });
}

// pure: is a finished match worth looking up? a friend in it, a rank gap of 2+, or a top-100 player
function worthLookup(players, ranks, isFriendFn, posFn) {
    if (!players || players.length < 2) return false;
    if (players.some(isFriendFn)) return true;
    if (ranks[0] && ranks[1] && Math.abs(ranks[0] - ranks[1]) >= 2) return true;
    return players.some(n => { const p = posFn(n); return !!p && p <= 100; });
}

/* ------------------------------------------------------- result lookups */

const lookups = [];                // { quark, k, tries, due }
const lookupTimes = [];            // when we asked (the last hour)
const wins = new Map();            // lowercased name -> consecutive wins we've seen this session

function queueLookup(quark, k) {
    if (!cfg.results) return;
    lookups.push({ quark, k, tries: 0, due: Date.now() + 20000 });          // Fightcade needs a moment to file the result
    if (lookups.length > 20) lookups.shift();
}

async function pumpLookups() {
    const t = Date.now();
    while (lookupTimes.length && t - lookupTimes[0] > 3600000) lookupTimes.shift();
    if (lookupTimes.length >= 30 || fc.api.blocked()) return;
    const job = lookups.find(j => j.due <= t);
    if (!job) return;
    lookups.splice(lookups.indexOf(job), 1);
    lookupTimes.push(t);
    let rows = [];
    try { rows = await fc.api.quarks({ quarkid: job.quark }, { priority: 'low', ttl: 0 }); } catch (e) { /* try again below */ }
    const row = rows.find(r => String(r.quarkid || r.quarkId || r.id || '') === String(job.quark)) || rows[0];
    const players = row && Array.isArray(row.players) ? row.players.filter(p => typeof p.score === 'number') : [];
    if (players.length < 2 || players[0].score === players[1].score) {
        if (++job.tries < 3) { job.due = Date.now() + 60000; lookups.push(job); }
        return;
    }
    const [w, l] = players[0].score > players[1].score ? [players[0], players[1]] : [players[1], players[0]];
    result(job.k, w.name, l.name, w.score, l.score);
}

function result(k, winner, loser, ws, ls) {
    const rank = (n) => k.ranks[k.players.findIndex(p => p.toLowerCase() === String(n).toLowerCase())] || 0;
    const rw = rank(winner), rl = rank(loser);
    const upset = rw && rl && rl - rw >= 2;
    const friend = isFriend(winner) || isFriend(loser);
    const score = ' <span class="fdTag">' + ws + '–' + ls + '</span>';
    if (upset) push({ kind: 'upset', ch: k.ch, big: true, friend, names: [winner, loser],
        text: '<span class="fdHot">' + E(T('Upset!')) + '</span> ' + T('{winner} beat {loser}', { winner: (rw ? T('{rank}-ranked', { rank: L(rw) }) + ' ' : '') + nameHtml(winner), loser: (rl ? T('{rank}-ranked', { rank: L(rl) }) + ' ' : '') + nameHtml(loser) }) + score,
        plain: T('Upset!') + ' ' + T('{winner} beat {loser}', { winner, loser }) + ' ' + ws + '–' + ls });
    else push({ kind: 'result', ch: k.ch, friend, names: [winner, loser], text: T('{winner} beat {loser}', { winner: nameHtml(winner), loser: nameHtml(loser) }) + score, plain: T('{winner} beat {loser}', { winner, loser }) });
    // streaks from the results we've seen
    const kw = winner.toLowerCase();
    wins.set(kw, (wins.get(kw) || 0) + 1);
    wins.set(loser.toLowerCase(), 0);
    const n = wins.get(kw);
    if (n >= 3) push({ kind: 'streak', ch: k.ch, big: true, friend: isFriend(winner), names: [winner],
        text: T('{name} has won {n} in a row', { name: nameHtml(winner), n: '<b>' + n + '</b>' }), plain: T('{name} has won {n} in a row', { name: winner, n }) });
}

/* --------------------------------------------------------------------- panel */

const ICON = { join: 'users', leave: 'user', match: 'sword', result: 'check', upset: 'flame', streak: 'trend', top: 'trophy', friend: 'star' };
let panel = null, panelCh = '';
const lastOpened = {};             // ch -> time (this session)

function visible(it, ch) {
    if (it.ch !== ch && it.ch !== '*') return false;
    if (cfg.filter === 'friends') return !!it.friend || it.kind === 'friend';
    if (cfg.filter === 'big') return !!it.big || it.kind === 'friend';
    if (it.low && !cfg.leaves) return false;
    return true;
}

function unread(ch) {
    const since = lastOpened[ch] || 0;
    return items.filter(it => it.at > since && visible(it, ch) && !it.low && it.kind !== 'join').length;
}

function itemHtml(it) {
    const stillLive = it.watch && it.quark && Object.keys(fc.app.users()).some(n => { const p = fc.app.users()[n].playing; return p && p.quarkId === it.quark; });
    return `<div class="fdItem ${it.kind}${it.big ? ' big' : ''}">${fc.ui.icon(ICON[it.kind] || 'bell')}<div class="tx"><div class="t">${it.text}</div>` +
        `<div class="s">${E(fc.fmt.ago(it.at))}</div></div>` +
        (stillLive ? fc.ui.btn('Watch', { kind: 'danger', size: 'sm', icon: 'eye', attrs: `data-watch="${E(it.watch)}"` }) : '') + '</div>';
}

function render() {
    if (!panel) return;
    const ch = panelCh;
    const list = items.filter(it => visible(it, ch)).slice(-80).reverse();
    const head = panel.querySelector('.fdHead .ch');
    if (head) head.textContent = short(ch);
    panel.querySelectorAll('.fdFilters [data-f]').forEach(c => c.classList.toggle('on', c.dataset.f === cfg.filter));
    const html = list.length ? list.map(itemHtml).join('')
        : fc.ui.empty({ icon: 'bell', title: 'Quiet for now', sub: T(cfg.filter === 'all' ? 'Joins, matches, upsets and streaks in this channel show up here.' : 'Nothing that matches this filter yet.') });
    const body = panel.querySelector('.fdBody');
    if (body.__html !== html) { body.__html = html; body.innerHTML = html; }
    lastOpened[ch] = Date.now();
    refreshPills();
}

function open(ch) {
    panelCh = ch || fc.app.activeChannelId();
    if (!panelCh) return;
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'fdPanel';
        panel.innerHTML = `<div class="fdHead">${fc.ui.icon('bell')}<div class="tt"><b>${E(T('What’s happening'))}</b><span class="ch"></span></div>` +
            `${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'close', act: 'close', title: 'Close (Esc)' })}</div>` +
            `<div class="fdFilters">${[['all', T('Everything')], ['friends', T('Friends')], ['big', T('Big moments')]].map(([k, l]) => `<span class="fc-chip" data-f="${k}" data-act="f">${E(l)}</span>`).join('')}</div>` +
            `<div class="fdBody"></div>`;
        panel.addEventListener('mousedown', (e) => e.stopPropagation());
        panel.addEventListener('click', (e) => {
            e.stopPropagation();
            const w = e.target.closest('[data-watch]');
            if (w) { try { (window.__fcdOpenUri || ((x) => window.location.assign(x)))(w.dataset.watch); } catch (err) { /* ignore */ } return; }
            const f = e.target.closest('[data-f]');
            if (f) { cfg.filter = f.dataset.f; store.save(); render(); return; }
            const n = e.target.closest('[data-name]');
            if (n) { const sc = mod('scout'); if (sc && sc.openCard) sc.openCard(n.dataset.name, n.getBoundingClientRect(), 'left'); return; }
            if (e.target.closest('[data-act="close"]')) close();
        });
        document.body.appendChild(panel);
        panel.__unlayer = fc.ui.layer(() => close());
    }
    render();
}

function close() {
    if (!panel) return;
    if (panel.__unlayer) panel.__unlayer();
    panel.remove();
    panel = null;
}

function refreshPills() {
    document.querySelectorAll('.channelToolbar .channelActions').forEach(actions => {
        let pill = actions.querySelector(':scope > .fdPill');
        const c = cfg.enabled ? fc.app.channelOf(actions) : null;
        if (!c) { if (pill) pill.remove(); return; }
        const ch = c.id || c.name;
        if (!pill) {
            pill = document.createElement('div');
            pill.className = 'fdPill';
            pill.title = T('What’s happening in this channel');
            pill.addEventListener('mousedown', (e) => e.stopPropagation());
            pill.addEventListener('click', (e) => { e.stopPropagation(); if (panel && panelCh === pill.dataset.ch) close(); else open(pill.dataset.ch); });
            actions.insertBefore(pill, actions.firstChild);
        }
        pill.dataset.ch = ch;
        const n = panel && panelCh === ch ? 0 : unread(ch);
        const html = fc.ui.icon('bell') + '<span>' + E(T('Feed')) + '</span>' + (n ? fc.ui.badge(n) : '');
        if (pill.__html !== html) { pill.__html = html; pill.innerHTML = html; }
    });
}

const CSS = `
.fdPill { display: inline-flex; align-items: center; height: 32px; padding: 0 10px; margin-right: 8px; border-radius: var(--fc-r1);
    background: var(--fc-btn); color: #fff; font: 600 14px/32px var(--fc-font); cursor: pointer; user-select: none; }
.fdPill:hover { background: var(--fc-btn-h); }
.fdPill span { text-transform: none; }
.fdPill .fc-ic { width: 16px; height: 16px; margin-right: 6px; }
.fdPill .fc-badge { margin-left: 6px; }
#fdPanel { position: fixed; top: 56px; right: 12px; bottom: 12px; width: 360px; z-index: calc(var(--fc-z-page) + 5); display: flex; flex-direction: column;
    border-radius: var(--fc-r3); background: var(--fc-s0); color: var(--fc-text); box-shadow: 0 0 0 1px var(--fc-divider), var(--fc-sh3);
    font: 14px/1.4 var(--fc-font); animation: fcSlide var(--fc-med) var(--fc-ease) both; }
#fdPanel .fdHead { display: flex; align-items: center; padding: 14px 12px 8px 16px; }
#fdPanel .fdHead > .fc-ic { color: var(--fc-accent); margin-right: 10px; }
#fdPanel .fdHead .tt { flex: 1; min-width: 0; }
#fdPanel .fdHead b { display: block; font-size: 16px; color: var(--fc-head); }
#fdPanel .fdHead .ch { display: block; font-size: 12px; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fdPanel .fdFilters { display: flex; padding: 0 16px 8px; border-bottom: 1px solid var(--fc-divider); }
#fdPanel .fdFilters .fc-chip { margin-right: 6px; }
#fdPanel .fdBody { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 8px 12px; }
#fdPanel .fdItem { display: flex; align-items: flex-start; padding: 8px; border-radius: var(--fc-r2); }
#fdPanel .fdItem:hover { background: var(--fc-hover); }
#fdPanel .fdItem > .fc-ic { flex: none; width: 18px; height: 18px; margin: 2px 10px 0 0; color: var(--fc-muted); }
#fdPanel .fdItem.big { background: var(--fc-accent-soft); }
#fdPanel .fdItem.upset > .fc-ic, #fdPanel .fdItem.streak > .fc-ic { color: var(--fc-warning); }
#fdPanel .fdItem.top > .fc-ic { color: #ffd166; }
#fdPanel .fdItem.match > .fc-ic { color: var(--fc-danger); }
#fdPanel .fdItem.friend > .fc-ic { color: var(--fc-warning); }
#fdPanel .fdItem .tx { flex: 1; min-width: 0; }
#fdPanel .fdItem .t { color: var(--fc-text); }
#fdPanel .fdItem .s { margin-top: 2px; font-size: 11px; color: var(--fc-faint); }
#fdPanel .fdItem > .fc-btn { margin-left: 8px; }
#fdPanel .fdName { color: var(--fc-head); cursor: pointer; }
#fdPanel .fdName:hover { text-decoration: underline; }
#fdPanel .fdTag { display: inline-block; padding: 0 5px; border-radius: 4px; font-size: 11px; font-weight: 700; background: var(--fc-s4); color: var(--fc-text); }
#fdPanel .fdHot { font-weight: 800; color: var(--fc-warning); }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('feed', { enabled: true, filter: 'all', leaves: false, results: true, toastBig: false });
    cfg = store.data;
    load();
    fc.ui.style('fdStyle', CSS);
    fc.own(() => { close(); document.querySelectorAll('.fdPill').forEach(p => p.remove()); fc.ui.style('fdStyle', null); });
    fc.tick(scan, 2000, { delay: 4000, whileHidden: true });
    fc.tick(pumpLookups, 5000, { whileHidden: true });
    fc.tick(() => { if (panel) render(); else refreshPills(); }, 30000);
    fc.watch(refreshPills, { selector: '.channelToolbar' });
    fc.on('friends:alert', (a) => push({ kind: 'friend', ch: '*', friend: true, names: a.name ? [a.name] : [],
        text: (a.name ? nameHtml(a.name) + E(a.title.slice(a.name.length)) : E(a.title)) + (a.sub ? ' <span class="fdTag">' + E(a.sub) + '</span>' : ''), plain: a.title }));
    fc.on('nav', () => close());
    fc.cmd('feed', 'What’s happening in this channel', () => open());
    fc.settings.block({
        id: 'feed', section: 'members', title: 'Lobby feed', hint: '— the Feed pill in each channel header · /feed', store, order: 25,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Lobby feed', hint: 'Joins, matches, upsets, streaks and your friends, per channel', onChange: refreshPills },
            { key: 'results', type: 'switch', label: 'Look up results of interesting matches', hint: 'Rank gap 2+, friends, top-100 players — at most 30 lookups an hour', show: (d) => d.enabled },
            { key: 'leaves', type: 'switch', label: 'Show players leaving', show: (d) => d.enabled },
            { key: 'toastBig', type: 'switch', label: 'Pop-up for big moments', hint: 'Upsets, streaks, top-100 arrivals', show: (d) => d.enabled }
        ]
    });
    return api;
}

const api = {
    open: (ch) => open(ch),
    close: () => close(),
    items: () => items.slice(),
    _scan: () => scan(),
    _flush: () => { pendingJoins.forEach(p => { p.at = 0; }); pendingLeaves.forEach(p => { p.at = 0; }); flushJoins(); },
    _result: (k, w, l, ws, ls) => result(k, w, l, ws, ls),
    _lookups: () => lookups.slice(),
    _pump: () => pumpLookups()
};

module.exports = { id: 'feed', name: 'Lobby feed', start, groupLine, worthLookup };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
