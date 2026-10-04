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
const mod = (id) => fc.modules.get(id);
const SHOW = 8;

/* ------------------------------------------------------------------- picking */

// window: max rank letters away from yours (null = any rank); maxPing in ms
// -> the people worth listing, best first: [{name, rank, ping, wlan, proxy, cc, h2h, odds, score}]
// users: Fightcade's globalUsers; opts: { me, channel, channelName, myRank, window, maxPing,
//        skip(name) -> bool, h2h(name) -> {w, l} | null, odds(name, rank) -> 0..1 | null }
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
        const ping = typeof u.ping === 'number' && u.ping > 0 ? u.ping : null;
        if (ping != null && o.maxPing && ping > o.maxPing) return;
        if (o.skip && o.skip(name)) return;
        const h2h = o.h2h ? o.h2h(name) : null;
        const odds = o.odds ? o.odds(name, rank) : null;
        const c = { name, rank, ping, wlan: !!u.wlan, proxy: !!u.proxy,
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
    return { ch, me: meName, myRank: (meInfo && meInfo.rank) || 0, rom: ch.gameid || fc.app.activeGameId() };
}

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

function rowHtml(c) {
    const h = c.h2h;
    const rec = !h ? `<span class="fcfmNew">${E(T('New'))}</span>` : `<span class="fcfmRec" title="${E(T('You vs them'))}">${h.w}–${h.l}</span>`;
    const odds = typeof c.odds === 'number' ? Math.round(c.odds * 100) : null;
    const conn = fc.fmt.conn({ ping: c.ping, wlan: c.wlan, proxy: c.proxy });
    return `<div class="fcfmRow" data-name="${E(c.name)}">${fc.ui.avatar(c.name, { size: 32, status: 'auto' })}
        <div class="fcfmWho"><b class="fcfmName" data-scout="${E(c.name)}" title="${E(T('Open the scout card'))}">${fc.ui.flag(c.cc)}${E(c.name)}</b>
            <span>${c.rank ? fc.ui.tag(fc.data.rankLetter(c.rank)) + ' ' : ''}${E(conn || T('ping unknown'))}</span></div>
        ${rec}
        ${odds != null ? `<span class="fcfmOdds ${odds >= 50 ? 'good' : 'bad'}" title="${E(T('Your odds in an FT3'))}">${odds}%</span>` : ''}
        ${fc.ui.btn('Challenge', { kind: 'success', size: 'sm', icon: 'sword', act: 'challenge', attrs: `data-who="${E(c.name)}"` })}</div>`;
}

function render(box) {
    const ctx = context();
    if (!ctx) {
        box.innerHTML = `<div class="h">${E(T('Find a match'))}</div>${fc.ui.empty({ title: T('Open a game channel first.'), icon: 'target' })}`;
        return;
    }
    const all = list(ctx);
    const rankTxt = ctx.myRank ? fc.data.rankLetter(ctx.myRank) : '';
    const win = cfg.window === 'any' ? null : (+cfg.window || 1) + widened;
    const sub = [
        win == null || win > 2 || !rankTxt ? T('any rank') : T('near your rank ({rank})', { rank: rankTxt }),
        T('up to {ms} ms', { ms: (+cfg.maxPing || 120) + widened * 60 })
    ].join(' · ');
    box.innerHTML = `<div class="h">${E(T('Find a match'))}<small>${E(ctx.ch.name)}</small></div><div class="s">${E(sub)}</div>
        ${all.length ? `<div class="fcfmList">${all.slice(0, SHOW).map(rowHtml).join('')}</div>`
            : `${fc.ui.empty({ title: T('Nobody fits right now.'), sub: T('Free players in this channel show up here.'), icon: 'target' })}${widened < 2 ? `<div class="fcfmWiden">${fc.ui.btn('Widen the search', { kind: 'sec', size: 'sm', icon: 'search', act: 'widen' })}</div>` : ''}`}
        <div class="f"><span>${all.length > SHOW ? E(T('{n} more', { n: all.length - SHOW })) : ''}</span>${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'refresh', act: 'refresh', title: 'Refresh' })}${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'gear', act: 'settings', title: 'Settings' })}</div>`;
}

let pop = null;
function open(anchor) {
    if (pop) { pop.close(); return; }
    widened = 0;
    const box = document.createElement('div');
    box.className = 'fcfmPop';
    render(box);
    box.addEventListener('click', (e) => onClick(box, e));
    const me = pop = fc.ui.popover(anchor || { x: window.innerWidth - 420, y: 60 }, box, { width: 400, onClose: () => { if (pop === me) pop = null; } });
    // better odds once the leaderboard is in, better head-to-head once your sets are
    const ctx = context();
    const again = () => { if (pop === me && box.isConnected) render(box); };
    if (ctx && ctx.rom && !fc.api.cachedBoard(ctx.rom)) fc.api.leaderboard(ctx.rom).then(again).catch(() => {});
    const scout = mod('scout');
    if (!api_h2h && scout && scout.recentOpponents) scout.recentOpponents().then(m => { api_h2h = m; again(); }).catch(() => {});
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
        let pill = actions.querySelector(':scope > .fcfmPill');
        if (!cfg.enabled || !cfg.pill) { if (pill) pill.remove(); return; }
        if (pill) return;
        pill = document.createElement('div');
        pill.className = 'fcfmPill';
        pill.title = T('Who’s free near your rank, on a good ping');
        pill.innerHTML = fc.ui.icon('target') + `<span>${E(T('Find a match'))}</span>`;
        pill.addEventListener('mousedown', (e) => e.stopPropagation());
        pill.addEventListener('click', (e) => { e.stopPropagation(); open(pill); });
        const after = actions.querySelector(':scope > .fcglPill') || actions.querySelector(':scope > .fcmsPill');
        if (after) after.insertAdjacentElement('afterend', pill); else actions.insertBefore(pill, actions.firstChild);
    });
}

const CSS = `
.fcfmPill { display: inline-flex; align-items: center; height: 32px; padding: 0 10px; margin-right: 8px; border-radius: var(--fc-r1);
    background: var(--fc-btn); color: #fff; font: 600 14px/32px var(--fc-font); cursor: pointer; user-select: none; white-space: nowrap; text-transform: none; letter-spacing: normal; }
.fcfmPill:hover { background: var(--fc-btn-h); }
.fcfmPill svg { width: 16px; height: 16px; margin-right: 6px; }
.fcfmPop .h { display: flex; align-items: baseline; font-size: 16px; font-weight: 700; color: var(--fc-head); }
.fcfmPop .h small { flex: 1; min-width: 0; margin-left: 8px; font-size: 12px; font-weight: 500; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcfmPop .s { margin: 2px 0 8px; font-size: 12px; color: var(--fc-muted); }
.fcfmRow { display: flex; align-items: center; padding: 6px 4px; border-radius: 8px; }
.fcfmRow:hover { background: rgba(255,255,255,.04); }
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
.fcfmPop .f { display: flex; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--fc-divider); font-size: 12px; color: var(--fc-muted); }
.fcfmPop .f > span { flex: 1; }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('find-match', { enabled: true, pill: true, maxPing: 120, window: '1' });
    cfg = store.data;
    fc.ui.style('fcfmStyle', CSS);
    fc.own(() => { fc.ui.style('fcfmStyle', null); document.querySelectorAll('.fcfmPill').forEach(p => p.remove()); if (pop) pop.close(); });
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
                options: [['0', 'Your rank only'], ['1', 'One rank up or down'], ['2', 'Two ranks up or down'], ['any', 'Any rank']] }
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
