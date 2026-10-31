/**
 * Fightcord: Find a match
 *
 * A "Find a match" pill in the channel header (and /find): who's around in this game
 * channel right now that you'd want to play -- free (not away, not in a match), near your
 * rank, on a good ping, and either new to you or close in your head-to-head. Each row has
 * your odds and a Challenge button that goes through Fightcade's own challenge (it asks for
 * the FT as usual).
 *
 * It never challenges anyone by itself, and skips players your challenge filters would
 * decline anyway (block list, VPN, country...).
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // find-match-config.json

// translated text (plain English in the unit tests, which run without Fightcade)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
T.plural = (n, one, many, v) => T(n === 1 ? one : many, Object.assign({ n }, v));
const E = (s) => fc.fmt.esc(s);
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
const mod = (id) => fc.modules.get(id);
const SHOW = 8;

/* ------------------------------------------------------------------- picking */

// window: max rank letters away from yours (null = any rank); maxPing in ms
// -> the people worth listing, best first: [{name, rank, ping, wlan, proxy, cc, ranked, h2h, odds, score}]
// users: Fightcade's globalUsers; opts: { me, channel, channelName, myRank, window, maxPing, rankedOnly,
//        skip(name) -> bool, h2h(name) -> {w, l} | null, odds(name, rank) -> 0..1 | null }
// ranked: their Fightcade "ranked" setting is on (3.8.1, Mushn1k): Fightcade only lets you pick an FT
// (a ranked set) when the channel is ranked and you both have it on; otherwise it's a casual set
function candidates(users, opts) {
    const o = opts || {};
    const me = String(o.me || '').toLowerCase();
    const out = [];
    Object.keys(users || {}).forEach(name => {
        const u = users[name];
        if (!u || !name || name.toLowerCase() === me) return;
        const chans = Array.isArray(u.channels) ? u.channels : [];
        if (!chans.includes(o.channel) && !(o.channelName && chans.includes(o.channelName))) return;
        if (u.away || (u.playing && u.playing.quarkId)) return;
        const rk = u.channelRank || {};
        const rank = +(rk[o.channelName] || rk[o.channel] || 0);
        if (o.window != null && o.myRank) {
            if (!rank || Math.abs(rank - o.myRank) > o.window) return;
        }
        const ranked = !!(u.settings && u.settings.ranked);
        if (o.rankedOnly && !ranked) return;
        const ping = typeof u.ping === 'number' && u.ping > 0 ? u.ping : null;
        if (ping != null && o.maxPing && ping > o.maxPing) return;
        if (o.skip && o.skip(name)) return;
        const h2h = o.h2h ? o.h2h(name) : null;
        const odds = o.odds ? o.odds(name, rank) : null;
        const c = { name, rank, ping, wlan: !!u.wlan, proxy: !!u.proxy, ranked,
            cc: String((u.country && u.country.iso_code) || '').toLowerCase(), h2h, odds };
        c.score = score(c, { myRank: o.myRank, maxPing: o.maxPing });
        out.push(c);
    });
    return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// higher = a better pick: a fair fight, a good connection, someone new or a close rivalry
function score(c, me) {
    const maxPing = (me && me.maxPing) || 150;
    let s = 0;
    // connection: up to 30 for a low ping, a little for an unknown one
    s += c.ping != null ? Math.max(0, 1 - c.ping / maxPing) * 30 : 5;
    if (c.proxy) s -= 8; else if (c.wlan) s -= 5;
    // a fair fight: odds near 50%, else rank distance
    if (typeof c.odds === 'number') s += (1 - Math.min(1, Math.abs(c.odds - 0.5) * 2)) * 30;
    else if (me && me.myRank && c.rank) s += Math.max(0, 15 - Math.abs(c.rank - me.myRank) * 7);
    // new to you, or a close head-to-head
    const h = c.h2h;
    if (!h || !(h.w + h.l)) s += 25;
    else {
        const gap = Math.abs(h.w - h.l);
        s += gap <= 2 ? 20 : Math.max(0, 15 - gap * 2);
    }
    return Math.round(s * 10) / 10;
}

/* ----------------------------------------------------------------- the list */

let api_h2h = null;                     // the API's recent opponents, when loaded
let widened = 0;

function context() {
    const ch = fc.app.activeChannel();
    if (!ch || !fc.app.isGameChannel(ch.id)) return null;
    const meName = fc.app.me();
    const meInfo = fc.app.userInfo(meName);
    const meUser = fc.app.users()[meName] || {};
    // a ranked channel (Fightcade's own flag, else its RANKED badge in the header) and your ranked setting
    const chRanked = ch.ranked != null ? !!ch.ranked : !!document.querySelector('.channelToolbar .channelInfo .rankedWrapper');
    return { ch, me: meName, myRank: (meInfo && meInfo.rank) || 0, rom: ch.gameid || fc.app.activeGameId(), chRanked, meRanked: !!(meUser.settings && meUser.settings.ranked) };
}
// ranked sets are on offer here at all (a ranked channel, your setting on)
const rankedHere = (ctx) => !!(ctx && ctx.chRanked && ctx.meRanked);

function list(ctx) {
    const filters = mod('challenge-filters');
    const board = fc.api.cachedBoard(ctx.rom);
    const mine = fc.elo.mine ? fc.elo.mine(ctx.rom) : null;
    const myElo = fc.data.eloFor(ctx.me, ctx.myRank, board, mine && mine.elo);
    const win = cfg.window === 'any' ? null : (+cfg.window || 1) + widened;
    return candidates(fc.app.users(), {
        me: ctx.me, channel: ctx.ch.id, channelName: ctx.ch.name, myRank: ctx.myRank,
        window: win != null && win > 2 ? null : win,
        maxPing: (+cfg.maxPing || 120) + widened * 60,
        rankedOnly: !!cfg.rankedOnly && rankedHere(ctx),
        // whatever your challenge filters would decline (except the FT, which you pick)
        skip: (name) => !!(filters && filters._check && filters._check(name, ctx.ch.name, 0).some(r => r.mode === 'decline' && r.rule !== 'ft')),
        h2h: (name) => {
            const r = fc.history.recordVs(name);
            if (r && r.w + r.l) return { w: r.w, l: r.l };
            const a = api_h2h && api_h2h.get(name.toLowerCase());
            return a && a.w + a.l ? { w: a.w, l: a.l } : null;
        },
        odds: (name, rank) => {
            if (!myElo) return null;
            const e = fc.data.eloFor(name, rank, board, fc.elo.value ? fc.elo.value(name, ctx.rom) : null);
            return e ? fc.data.winOdds(myElo.elo, e.elo, 3).set : null;
        }
    });
}

function rowHtml(c, ctx) {
    const h = c.h2h;
    const rec = !h ? `<span class="fcfmNew">${E(T('New'))}</span>` : `<span class="fcfmRec" title="${E(T('You vs them'))}">${h.w}–${h.l}</span>`;
    const odds = typeof c.odds === 'number' ? Math.round(c.odds * 100) : null;
    const conn = fc.fmt.conn({ ping: c.ping, wlan: c.wlan, proxy: c.proxy });
    const nt = mod('notes');
    const dots = nt && nt.dots ? nt.dots(c.name) : '';
    return `<div class="fcfmRow" data-name="${E(c.name)}">${fc.ui.avatar(c.name, { size: 32, status: 'auto' })}
        <div class="fcfmWho"><b class="fcfmName" data-scout="${E(c.name)}" title="${E(T('Open the scout card'))}">${fc.ui.flag(c.cc)}${E(c.name)}${dots}</b>
            <span>${c.rank ? fc.ui.tag(c.rank) + ' ' : ''}${rankedHere(ctx) ? (c.ranked ? `<i class="fcfmRk" title="${E(T('Ranked sets on: you pick the FT when you challenge'))}">${E(T('Ranked'))}</i>`
                : `<i class="fcfmCas" title="${E(T('Their ranked setting is off: Fightcade only offers a casual set, no FT to pick'))}">${E(T('Casual only'))}</i>`) : ''}${E(conn || T('ping unknown'))}</span></div>
        ${rec}
        ${odds != null ? `<span class="fcfmOdds ${odds >= 50 ? 'good' : 'bad'}" title="${E(T('Your odds in an FT3'))}">${odds}%</span>` : ''}
        ${fc.ui.btn('Challenge', { kind: 'success', size: 'sm', icon: 'sword', act: 'challenge', attrs: `data-who="${E(c.name)}"`, title: rankedHere(ctx) && !c.ranked ? T('A casual set: their ranked setting is off') : '' })}</div>`;
}

function render(box) {
    const ctx = context();
    if (!ctx) {
        box.innerHTML = fc.ui.popHead({ icon: 'target', title: T('Find a match') }) + `<div class="fc-pb">${fc.ui.empty({ title: T('Open a game channel first.'), icon: 'target' })}</div>`;
        return;
    }
    const all = list(ctx);
    const rankTxt = ctx.myRank ? fc.data.rankLetter(ctx.myRank) : '';
    const win = cfg.window === 'any' ? null : (+cfg.window || 1) + widened;
    const sub = [
        win == null || win > 2 || !rankTxt ? T('any rank') : T('near your rank ({rank})', { rank: rankTxt }),
        T('up to {ms} ms', { ms: (+cfg.maxPing || 120) + widened * 60 })
    ].join(' · ');
    // ranked only: a switch on top (only where ranked sets exist); why there's no FT when your setting is off
    const rk = rankedHere(ctx) ? `<div class="fcfmTop"><label class="fcfmSw" data-act="ranked-only"><input type="checkbox" class="fc-switch-in"${cfg.rankedOnly ? ' checked' : ''}><i class="fc-switch"></i>` +
        `<span>${E(T('Only players who take ranked sets'))}</span></label></div>`
        : ctx.chRanked && !ctx.meRanked ? `<div class="fcfmTop note">${fc.ui.ic('info')}<span>${E(T('Your ranked setting is off, so every set here is casual (Fightcade’s Settings → Ranked).'))}</span></div>` : '';
    box.innerHTML = fc.ui.popHead({ icon: 'target', title: T('Find a match'), sub: E(sub) + ' · ' + E(shortName(ctx.ch.name)) }) +
        `<div class="fc-pb">${rk}${all.length ? `<div class="fcfmList">${all.slice(0, SHOW).map(c => rowHtml(c, ctx)).join('')}</div>`
            : `${fc.ui.empty({ title: T('Nobody fits right now.'), sub: T('Free players in this channel show up here.'), icon: 'target' })}${widened < 2 ? `<div class="fcfmWiden">${fc.ui.btn('Widen the search', { kind: 'sec', size: 'sm', icon: 'search', act: 'widen' })}</div>` : ''}`}</div>` +
        fc.ui.popFoot(all.length > SHOW ? E(T('{n} more', { n: all.length - SHOW })) : '',
            fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'refresh', act: 'refresh', title: 'Refresh' }) + fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'gear', act: 'settings', title: 'Settings' }));
}

let pop = null;
function open(anchor) {
    if (pop) { pop.close(); return; }
    widened = 0;
    const box = document.createElement('div');
    box.className = 'fcfmPop';
    render(box);
    box.addEventListener('click', (e) => onClick(box, e));
    box.addEventListener('mouseover', onRowHover);
    box.addEventListener('mouseleave', hideNote);
    const me = pop = fc.ui.popover(anchor || { x: window.innerWidth - 420, y: 60 }, box, { width: 400, cls: 'fc-pop-card', onClose: () => { hideNote(); if (pop === me) pop = null; } });
    // better odds once the leaderboard is in, better head-to-head once your sets are
    const ctx = context();
    const again = () => { if (pop === me && box.isConnected) render(box); };
    if (ctx && ctx.rom && !fc.api.cachedBoard(ctx.rom)) fc.api.leaderboard(ctx.rom).then(again).catch(() => {});
    const scout = mod('scout');
    if (!api_h2h && scout && scout.recentOpponents) scout.recentOpponents().then(m => { api_h2h = m; again(); }).catch(() => {});
}

// 3.7 (Mushn1k's idea): your notes and tags on a player, beside their row while you hover it
let noteTip = null, noteFor = '';
function hideNote() { if (noteTip) noteTip.remove(); noteTip = null; noteFor = ''; }
function onRowHover(e) {
    const row = e.target.closest && e.target.closest('.fcfmRow[data-name]');
    const name = row ? row.dataset.name : '';
    if (name === noteFor) return;
    hideNote();
    const nt = mod('notes');
    const html = name && nt && nt.chips ? nt.chips(name) : '';
    if (!html) return;
    noteFor = name;
    noteTip = document.createElement('div');
    noteTip.className = 'fcfmNote';
    noteTip.innerHTML = `<div class="h">${fc.ui.ic('note')}<span>${E(T('Your notes on {name}', { name }))}</span></div>${html}`;
    document.body.appendChild(noteTip);
    fc.ui.place(noteTip, row.getBoundingClientRect(), 'left');
}

function onClick(box, e) {
    const sc = e.target.closest('[data-scout]');
    if (sc) {
        const scout = mod('scout');
        if (scout && scout.openCard) scout.openCard(sc.dataset.scout, sc.getBoundingClientRect(), 'left');
        return;
    }
    const a = e.target.closest('[data-act]');
    const act = a && a.getAttribute('data-act');
    if (!act) return;
    if (act === 'ranked-only') { e.preventDefault(); cfg.rankedOnly = !cfg.rankedOnly; store.save(); render(box); return; }
    if (act === 'refresh') render(box);
    else if (act === 'widen') { widened++; render(box); }
    else if (act === 'settings') { if (pop) pop.close(); const st = mod('fightcord'); if (st && st.open) st.open('challenges'); }
    else if (act === 'challenge') {
        const ms = mod('match-screens');
        const st = ms && ms.challenge ? ms.challenge(a.dataset.who) : { ok: false, why: T('Match screens are off') };
        if (st.ok) {
            a.disabled = true;
            a.textContent = T('Sent');
        } else fc.ui.toast(st.why || T('Couldn’t challenge'), { kind: 'warning', icon: 'sword' });
    }
}

/* --------------------------------------------------------------- the pill */

function refreshPill() {
    document.querySelectorAll('.channelToolbar .channelActions').forEach(actions => {
        let pill = actions.querySelector('.fcfmPill');
        if (!cfg.enabled || !cfg.pill) { if (pill) pill.remove(); return; }
        if (pill) return;
        pill = document.createElement('div');
        pill.className = 'fcfmPill';
        pill.title = T('Who’s free near your rank, on a good ping');
        pill.innerHTML = fc.ui.icon('target') + `<span>${E(T('Find a match'))}</span>`;
        pill.addEventListener('mousedown', (e) => e.stopPropagation());
        pill.addEventListener('click', (e) => { e.stopPropagation(); open(pill); });
        fc.ui.header.place(actions, pill, 'findmatch');
    });
}

const CSS = `
.fcfmPill { display: inline-flex; align-items: center; height: 32px; padding: 0 10px; margin-right: 8px; border-radius: var(--fc-r1);
    background: var(--fc-btn); color: #fff; font: 600 14px/32px var(--fc-font); cursor: pointer; user-select: none; white-space: nowrap; text-transform: none; letter-spacing: normal; }
.fcfmPill:hover { background: var(--fc-btn-h); }
/* 2.13: the one accent button in the header (the thing to do next) */
.fcHdr .fcfmPill { background: var(--fc-accent); color: #fff; }
.fcHdr .fcfmPill:hover { background: var(--fc-accent-h, var(--fc-accent)); filter: brightness(1.1); }
.cbn-merged .fcHdr .fcfmPill { box-shadow: 0 2px 10px rgba(0,0,0,.35); }
.fcfmPill svg { width: 16px; height: 16px; margin-right: 6px; }
.fcfmRow { display: flex; align-items: center; padding: 6px 4px; border-radius: 8px; }
.fcfmRow:hover { background: rgba(255,255,255,.04); }
.fcfmNote { position: fixed; z-index: var(--fc-z-pop); width: 230px; padding: 10px 12px; border-radius: 10px; pointer-events: none; box-sizing: border-box;
    background: var(--fc-s0); color: var(--fc-text); box-shadow: 0 0 0 1px var(--fc-divider), var(--fc-sh3); font: 13px/1.4 var(--fc-font); animation: fcPop var(--fc-fast) var(--fc-ease) both; }
.fcfmNote .h { display: flex; align-items: center; margin-bottom: 6px; font: 700 11px/14px var(--fc-font); letter-spacing: .03em; text-transform: uppercase; color: var(--fc-muted); }
.fcfmNote .h .fc-ic { width: 13px; height: 13px; margin-right: 5px; }
.fcfmNote .h span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fcfmRow .fc-avatar { flex: none; margin-right: 10px; }
.fcfmWho { flex: 1; min-width: 0; }
.fcfmWho b { display: block; font-size: 14px; font-weight: 600; color: var(--fc-head); cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcfmWho b:hover { text-decoration: underline; }
.fcfmWho b .fc-flag { margin-right: 5px; }
.fcfmWho span { display: flex; align-items: center; font-size: 12px; color: var(--fc-muted); white-space: nowrap; }
.fcfmWho span .fc-tag { margin-right: 5px; }
.fcfmNew, .fcfmRec, .fcfmOdds { flex: none; margin-left: 6px; padding: 1px 7px; border-radius: 10px; font-size: 12px; font-weight: 700; }
.fcfmNew { background: var(--fc-accent-soft); color: var(--fc-head); }
.fcfmRec { background: rgba(255,255,255,.07); color: var(--fc-text); }
.fcfmOdds.good { color: var(--fc-success); } .fcfmOdds.bad { color: var(--fc-danger); }
.fcfmRow .fc-btn { flex: none; margin-left: 8px; }
.fcfmWiden { display: flex; justify-content: center; margin-top: 4px; }
/* 3.8.1: ranked or casual only */
.fcfmWho span i { flex: none; margin-right: 6px; padding: 0 5px; border-radius: 4px; font: 700 10px/16px var(--fc-font); font-style: normal; letter-spacing: .02em; text-transform: uppercase; }
.fcfmRk { background: rgba(240,178,50,.16); color: var(--fc-warning); }
.fcfmCas { background: rgba(255,255,255,.07); color: var(--fc-muted); }
.fcfmTop { display: flex; align-items: center; margin: -2px 0 8px; padding: 0 4px 8px; border-bottom: 1px solid var(--fc-divider); color: var(--fc-text); font: 13px/1.35 var(--fc-font); }
.fcfmTop.note { color: var(--fc-muted); }
.fcfmTop.note .fc-ic { flex: none; margin-right: 6px; }
.fcfmSw { display: flex; align-items: center; cursor: pointer; }
.fcfmSw .fc-switch { margin-right: 8px; }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('find-match', { enabled: true, pill: true, maxPing: 120, window: '1', rankedOnly: false });
    cfg = store.data;
    fc.ui.style('fcfmStyle', CSS);
    fc.own(() => { fc.ui.style('fcfmStyle', null); document.querySelectorAll('.fcfmPill').forEach(p => p.remove()); hideNote(); if (pop) pop.close(); });
    fc.watch(refreshPill, { selector: '.channelToolbar' });
    fc.cmd('find', 'Find someone to play: free, near your rank, good ping', () => { if (cfg.enabled) open(document.querySelector('.fcfmPill')); });
    fc.settings.block({
        id: 'find-match', section: 'challenges', title: 'Find a match', hint: '— who’s free near your rank, on a good ping',
        store, order: 15,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Find a match', onChange: refreshPill },
            { key: 'pill', type: 'switch', label: 'Button in the channel header', hint: 'Or type /find', show: (d) => d.enabled, onChange: refreshPill },
            { key: 'maxPing', type: 'slider', label: 'Highest ping', min: 40, max: 250, step: 10, unit: ' ms', show: (d) => d.enabled },
            { key: 'window', type: 'select', label: 'Rank range', show: (d) => d.enabled,
                options: [['0', 'Your rank only'], ['1', 'One rank up or down'], ['2', 'Two ranks up or down'], ['any', 'Any rank']] },
            { key: 'rankedOnly', type: 'switch', label: 'Only players who take ranked sets', hint: 'Players with Fightcade’s ranked setting off only get a casual set (no FT to pick)', show: (d) => d.enabled }
        ]
    });
    return api;
}

const api = {
    open: (anchor) => open(anchor),
    candidates: (users, o) => candidates(users, o),
    _list: () => { const c = context(); return c ? list(c) : []; },
    get _config() { return cfg; }
};

module.exports = { id: 'find-match', name: 'Find a match', needs: ['match-screens'], start, candidates, score };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
