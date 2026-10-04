/**
 * Fightcord stats
 *
 * "Your stats": everything fc.history has recorded -- record and win rate, per game, win
 * rate over time, rivals, best / worst matchups, streaks, recent sessions, replays and
 * highlights -- plus a head-to-head page per opponent and a session share card.
 * "Import my Fightcade history" adds your older sets from Fightcade's own (public) match
 * list, merged by match id.
 *
 * Opened from the Discover sidebar ("Your stats"), the 🏆 session pill ("All stats"),
 * scout / hover cards (head-to-head) or /stats in chat.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const ET = (s, v) => E(fc.t(s, v));
const pct = (x) => Math.round(x * 100) + '%';
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
const mod = (id) => fc.modules.get(id);

/* --------------------------------------------------------------------- data */

const allSets = () => fc.history.all();
const gameOf = (s) => shortName(s.channel || s.game || '') || T('Unknown game');

function tally(sets) {
    const r = { w: 0, l: 0, d: 0, u: 0, n: sets.length, gw: 0, gl: 0, dur: 0 };
    sets.forEach(s => {
        if (s.result === 'won') r.w++; else if (s.result === 'lost') r.l++; else if (s.result === 'draw') r.d++; else r.u++;
        if (typeof s.mine === 'number' && typeof s.theirs === 'number') { r.gw += s.mine; r.gl += s.theirs; }
        if (s.dur) r.dur += s.dur;
    });
    r.rate = r.w + r.l ? r.w / (r.w + r.l) : null;
    return r;
}

// longest and current runs over KNOWN results (a draw breaks a run)
function streaks(sets) {
    let bestW = 0, bestL = 0, run = { kind: null, n: 0 };
    sets.forEach(s => {
        if (!s.result) return;
        if (s.result === 'draw') { run = { kind: null, n: 0 }; return; }
        run = run.kind === s.result ? { kind: s.result, n: run.n + 1 } : { kind: s.result, n: 1 };
        if (run.kind === 'won') bestW = Math.max(bestW, run.n); else bestL = Math.max(bestL, run.n);
    });
    return { bestW, bestL, cur: run };
}

// A session runs 5 AM -> 5 AM (same rule as the 🏆 pill)
function sessionKey(at) {
    const d = new Date(at);
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// daily points for a week, weekly otherwise
function buckets(sets, days) {
    const step = days && days <= 7 ? 86400000 : 7 * 86400000;
    const map = new Map();
    sets.forEach(s => {
        if (!s.result || s.result === 'draw') return;
        const k = Math.floor(s.at / step);
        const b = map.get(k) || { k, w: 0, l: 0 };
        if (s.result === 'won') b.w++; else b.l++;
        map.set(k, b);
    });
    return { step, list: [...map.values()].sort((a, b) => a.k - b.k) };
}

/* ------------------------------------------------------------------ replays */

// A replay link needs the emulator: stored on new sets, else the joined channel or what
// Discover has seen of it. Unknown -> no Replay button (never guessed).
function emuFor(s) {
    if (s.emu) return s.emu;
    const c = fc.app.channel(s.channel);
    if (c && c.emulator) return c.emulator;
    const d = mod('discover');
    const info = d && d.channelInfo ? d.channelInfo(s.channel) : null;
    return (info && info.emulator) || '';
}

const replayUrl = (s) => fc.data.replayUrl(emuFor(s), s.rom, s.quark);

function when(t) {
    const d = new Date(t);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setRow(s) {
    const mark = s.result === 'won' ? '<b class="w">W</b>' : s.result === 'lost' ? '<b class="l">L</b>'
        : s.result === 'draw' ? '<b class="d">D</b>' : '<b class="u">?</b>';
    const score = s.mine != null && s.theirs != null ? s.mine + '–' + s.theirs : '—';
    const url = replayUrl(s);
    return `<div class="fcsSet">${mark}<span class="o" ${s.opp ? `data-opp="${E(s.opp)}"` : ''} title="${s.opp ? ET('Head-to-head with {name}', { name: s.opp }) : ''}">${E(s.opp || '?')}</span><span class="sc">${score}</span>
        <span class="g" title="${E(s.channel || s.game || '')}">${E(gameOf(s))}</span><span class="t">${when(s.at)}</span>
        ${url ? fc.ui.btn('Replay', { size: 'sm', icon: 'play', cls: 'fcsRp', title: 'Watch the replay in Fightcade', attrs: `data-replay="${E(url)}"` }) : '<span class="fcsRp none"></span>'}
        ${s.quark ? `<span class="fcsStar${s.star ? ' on' : ''}" data-star="${E(s.quark)}" title="${ET(s.star ? 'Remove from highlights' : 'Keep in highlights')}">${s.star ? fc.ui.ic('star', 'fill') : fc.ui.ic('star')}</span>` : '<span class="fcsStar none"></span>'}
    </div>`;
}

/* --------------------------------------------------------------------- view */

const view = { period: 'all', game: '', busy: false, note: '', opp: '', tab: 'overview' };

// other modules add tabs (analytics, progress): { id, label, order, html(ctx), after(el, ctx) }
const tabs = [{ id: 'overview', label: 'Overview', order: 0 }];          // labels go through fc.ui.tabs (translated)
function addTab(t) {
    const i = tabs.findIndex(x => x.id === t.id);
    if (i >= 0) tabs.splice(i, 1);
    tabs.push(t);
    tabs.sort((a, b) => (a.order || 0) - (b.order || 0));
    if (page) render();
    return () => { const j = tabs.indexOf(t); if (j >= 0) tabs.splice(j, 1); if (view.tab === t.id) view.tab = 'overview'; if (page) render(); };
}
const tabCtx = () => ({ sets: filteredSets(), all: allSets(), game: view.game, period: view.period, gameOf, tally, streaks, sessionKey,
    rerender: () => render(), openH2H: (name) => { view.opp = name; view.note = ''; render(); } });
let page = null;

function filteredSets() {
    const now = Date.now();
    const days = view.period === '7' ? 7 : view.period === '30' ? 30 : 0;
    return allSets().filter(s => (!days || s.at >= now - days * 86400000) && (!view.game || gameOf(s) === view.game));
}

const card = (title, body, wide) => `<div class="fc-card fcsCard${wide ? ' wide' : ''}"><h4>${title}</h4>${body}</div>`;
const bar = (rate) => rate == null ? '' : `<div class="fcsBar"><i style="width:${Math.round(rate * 100)}%"></i></div>`;
const rec = (x) => `${x.w}–${x.l}${x.d ? '–' + x.d : ''}`;
const tile = (v, label, cls) => `<div class="fc-tile fcsBig"><div class="v${cls ? ' ' + cls : ''}">${v}</div><div class="k">${label}</div></div>`;

function lineChart(sets) {
    const days = view.period === '7' ? 7 : view.period === '30' ? 30 : 0;
    const b = buckets(sets, days);
    if (b.list.length < 2) return '<div class="fc-muted">' + ET('Play a few more sessions to see a trend.') + '</div>';
    const W = 600, H = 160, P = 8;
    const x = (i) => P + i * (W - 2 * P) / (b.list.length - 1);
    const y = (r) => P + (1 - r) * (H - 2 * P);
    const pts = b.list.map((p, i) => [x(i), y(p.w / (p.w + p.l)), p]);
    const line = pts.map(([px, py]) => px.toFixed(1) + ',' + py.toFixed(1)).join(' ');
    const area = `${P},${H - P} ${line} ${(W - P)},${H - P}`;
    const day = (k) => new Date(k * b.step).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<svg class="fcsChart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="fcsFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="var(--fc-accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--fc-accent)" stop-opacity="0"/></linearGradient></defs>
        ${[0.25, 0.5, 0.75].map(r => `<line x1="${P}" x2="${W - P}" y1="${y(r)}" y2="${y(r)}" class="${r === .5 ? 'mid' : 'grid'}"/>`).join('')}
        <polygon points="${area}" fill="url(#fcsFill)"/>
        <polyline points="${line}" class="ln"/>
        ${pts.map(([px, py, p]) => `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" class="pt"><title>${day(p.k)}: ${p.w}–${p.l} (${pct(p.w / (p.w + p.l))})</title></circle>`).join('')}
    </svg>
    <div class="fcsAxis"><span>${day(b.list[0].k)}</span><span>50%</span><span>${day(b.list[b.list.length - 1].k)}</span></div>`;
}

/* ------------------------------------------------------------- head-to-head */

function h2hHtml() {
    const name = view.opp;
    const lk = name.toLowerCase();
    const sets = filteredSets().filter(s => (s.opp || '').toLowerCase() === lk);
    const t = tally(sets), st = streaks(sets);
    const info = fc.app.userInfo(name);
    const fr = mod('friends'), nt = mod('notes'), ms = mod('match-screens');
    const isFr = !!(fr && fr.isFriend && fr.isFriend(name));
    const cst = ms && ms.challengeState ? ms.challengeState(name) : null;
    const status = fc.app.status(name);
    const statusText = { off: ET('Not in your channels'), playing: '● ' + ET('In a match'), away: ET('Away'), on: '● ' + ET('Online') }[status];
    const byTime = sets.slice().sort((a, b) => a.at - b.at);
    const first = byTime[0], last = byTime[byTime.length - 1];
    const cur = st.cur.n ? (st.cur.kind === 'won' ? fc.ui.ic('flame', 'fill') + st.cur.n + 'W' : st.cur.n + 'L') : '—';
    const md = (s) => s ? new Date(s.at).toLocaleDateString(fc.t.locale(), { month: 'short', day: 'numeric' }) : '—';
    return `<div class="fcsHH">
        ${fc.ui.btn('All stats', { kind: 'ghost', size: 'sm', icon: 'arrowLeft', act: 'back', cls: 'fcsBack' })}
        <div class="fcsHHead">
            ${fc.ui.avatar(name, { size: 72, status, ring: 'var(--fc-s2)' })}
            <div class="who"><div class="nm">${info ? fc.ui.flag(info.country) : ''}${E(name)}${isFr ? ' <span class="fr">' + fc.ui.ic('star', 'fill') + '</span>' : ''}</div>
                <div class="st ${status}">${statusText}</div>
                ${nt && nt.chips ? nt.chips(name) : ''}</div>
            <div class="acts">
                ${cst ? fc.ui.btn('Challenge', { kind: 'success', size: 'sm', icon: 'sword', act: 'challenge', disabled: !cst.ok, title: cst.ok ? T('Challenge {name}', { name }) : cst.why }) : ''}
                ${fr ? fc.ui.btn(T(isFr ? 'Friend' : 'Add friend'), { kind: 'sec', size: 'sm', icon: 'star', act: 'friend' }) : ''}
                ${nt ? fc.ui.btn('Notes', { kind: 'sec', size: 'sm', icon: 'note', act: 'notes' }) : ''}
                ${fc.ui.btn('Scout', { kind: 'sec', size: 'sm', icon: 'search', act: 'scout' })}
            </div>
        </div>
        ${sets.length ? `<div class="fcsTop">
            ${tile(rec(t), ET('record vs {name}', { name }), t.rate == null ? '' : t.rate >= .5 ? 'good' : 'bad')}
            ${tile(t.rate == null ? '—' : pct(t.rate), ET('win rate') + bar(t.rate))}
            ${tile(t.gw + '–' + t.gl, ET('games won–lost'))}
            ${tile(st.bestW + 'W', ET('longest win streak vs them'))}
            ${tile(cur, ET('current streak'))}
            ${tile(md(first), ET('first set · last {when}', { when: md(last) }))}
        </div>
        <div class="fcsGrid">
            ${card(ET('Win rate vs {name} over time', { name }), lineChart(sets), true)}
            ${card(ET('Every set') + ' <small>— ' + sets.length + '</small>', byTime.slice().reverse().map(setRow).join(''), true)}
        </div>` : fc.ui.empty({ icon: 'users', title: T('No sets against {name} yet', { name }), sub: view.game || view.period !== 'all' ? T('Try other filters.') : '' })}
    </div>`;
}

function onH2HAction(act, el) {
    const name = view.opp;
    if (act === 'challenge') {
        const ms = mod('match-screens');
        const st = ms && ms.challenge ? ms.challenge(name) : null;
        view.note = st ? (st.ok ? T('Challenge sent to {name} — Fightcade asks for the FT.', { name }) : st.why) : '';
        render();
    } else if (act === 'friend') {
        const fr = mod('friends');
        if (fr) fr.toggle(name);
        render();
    } else if (act === 'notes') {
        const nt = mod('notes');
        if (nt) nt.edit(name, el.getBoundingClientRect());
    } else if (act === 'scout') {
        const sc = mod('scout');
        if (sc && sc.openCard) sc.openCard(name, el.getBoundingClientRect(), 'left');
    }
}

/* ------------------------------------------------------------------ overview */

function overviewHtml() {
    const all = allSets();
    if (!all.length) return fc.ui.empty({ icon: 'chart', title: 'No sets recorded yet',
        sub: 'They’re saved as you play (the session tracker), or bring in your recent Fightcade matches.', action: 'Import my Fightcade history', act: 'import' });
    const sets = filteredSets();
    const t = tally(sets);
    const st = streaks(sets);

    const group = (keyOf) => {
        const m = new Map();
        sets.forEach(s => { const k = keyOf(s); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
        return m;
    };
    const gameRows = [...group(gameOf).entries()].map(([g, list]) => [g, tally(list)]).sort((a, b) => b[1].n - a[1].n);
    const opps = [...group(s => s.opp).entries()].map(([o, list]) => ({ o, t: tally(list) }));
    const rivals = opps.slice().sort((a, b) => b.t.n - a.t.n).slice(0, 8);
    const rated = opps.filter(x => x.t.w + x.t.l >= 3);
    const best = rated.slice().sort((a, b) => b.t.rate - a.t.rate || b.t.n - a.t.n).slice(0, 3);
    const worst = rated.slice().sort((a, b) => a.t.rate - b.t.rate || b.t.n - a.t.n).slice(0, 3);
    const sessions = [...group(s => sessionKey(s.at)).entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-14).map(([k, list]) => [k, tally(list)]);
    const maxS = Math.max(1, ...sessions.map(([, x]) => x.w + x.l));
    const recent = sets.slice().sort((a, b) => b.at - a.at).slice(0, 25);
    const highlights = all.filter(x => x.star).sort((a, b) => b.at - a.at);

    const oppRow = (x) => `<div class="fcsRow"><span class="n" data-opp="${E(x.o)}" title="${ET('Head-to-head with {name}', { name: x.o })}">${E(x.o)}</span><span class="r">${rec(x.t)}</span>
        <span class="p ${x.t.rate == null ? '' : x.t.rate >= .5 ? 'good' : 'bad'}">${x.t.rate == null ? '—' : pct(x.t.rate)}</span></div>`;
    const none = '<div class="fc-muted">—</div>', few = '<div class="fc-muted">' + ET('Not enough sets against anyone yet.') + '</div>';
    return `<div class="fcsTop">
            ${tile(rec(t), ET('record') + (t.u ? ' · ' + ET('{n} unknown', { n: t.u }) : ''))}
            ${tile(t.rate == null ? '—' : pct(t.rate), ET('win rate') + bar(t.rate))}
            ${tile(fc.fmt.num(t.n), ET('sets played'))}
            ${tile(t.gw + '–' + t.gl, ET('games won–lost'))}
            ${tile(st.cur.n ? (st.cur.kind === 'won' ? fc.ui.ic('flame', 'fill') : '') + st.cur.n + (st.cur.kind === 'won' ? 'W' : 'L') : '—', ET('current streak'))}
            ${tile(st.bestW + 'W', ET('longest win streak'))}
        </div>
        <div class="fcsGrid">
            ${card(ET('Win rate over time'), lineChart(sets), true)}
            ${card(ET('Per game'), gameRows.length ? gameRows.map(([g, x]) => `<div class="fcsRow"><span class="n" title="${E(g)}">${E(g)}</span>
                <span class="r">${rec(x)}</span><span class="p">${x.rate == null ? '—' : pct(x.rate)}</span></div>${bar(x.rate)}`).join('') : none)}
            ${card(ET('Rivals'), rivals.length ? rivals.map(oppRow).join('') : none)}
            ${card(ET('Best matchups') + ' <small>' + ET('(3+ sets)') + '</small>', best.length ? best.map(oppRow).join('') : few)}
            ${card(ET('Toughest matchups') + ' <small>' + ET('(3+ sets)') + '</small>', worst.length ? worst.map(oppRow).join('') : few)}
            ${card(ET('Last sessions') + ' <small>— ' + ET('click a day to share it') + '</small>', sessions.length ? `<div class="fcsSessions">${sessions.map(([k, x]) => `
                <div class="s" data-share="${E(k)}" title="${E(k)}: ${rec(x)} — ${ET('click to share')}"><div class="bars">
                    <i class="l" style="height:${Math.round(x.l / maxS * 100)}%"></i><i class="w" style="height:${Math.round(x.w / maxS * 100)}%"></i></div>
                    <span>${new Date(k + 'T12:00:00').toLocaleDateString(fc.t.locale(), { month: 'numeric', day: 'numeric' })}</span></div>`).join('')}</div>` : none, true)}
            ${highlights.length ? card(ET('Highlights') + ' <small>— ' + ET('your starred sets') + '</small>', highlights.map(setRow).join(''), true) : ''}
            ${card(ET('Recent sets') + ' <small>— ' + ET('the star keeps one in Highlights') + '</small>', recent.length ? recent.map(setRow).join('') : none, true)}
        </div>`;
}

function render() {
    if (!page) return;
    page.el.classList.toggle('h2h', !!view.opp);
    page.setTitle(view.opp ? T('You vs {name}', { name: view.opp }) : T('Your stats'));
    syncHead();
    if (view.opp) { page.body.innerHTML = `<div class="fcsNote">${E(view.note)}</div>` + h2hHtml(); return; }
    const t = tabs.find(x => x.id === view.tab) || tabs[0];
    const ctx = tabCtx();
    let inner;
    try { inner = t.id === 'overview' ? overviewHtml() : t.html(ctx); }
    catch (e) { fc.log.error('stats tab ' + t.id, e); inner = fc.ui.empty({ icon: 'warn', title: 'This tab couldn’t load', sub: e.message }); }
    page.body.innerHTML = `<div class="fcsNote">${E(view.note)}</div>` +
        (tabs.length > 1 ? `<div class="fcsTabs">${fc.ui.tabs(tabs.map(x => [x.id, x.label]), t.id)}</div>` : '') + `<div class="fcsTab">${inner}</div>`;
    if (t.after) { try { t.after(page.body.querySelector('.fcsTab'), ctx); } catch (e) { fc.log.error('stats tab ' + t.id, e); } }
}

function syncHead() {
    let games = [...new Set(allSets().map(gameOf))].sort();
    // a game picked from elsewhere (the channel banner) stays visible even with no sets yet
    if (view.game && !games.includes(view.game)) games = games.concat(view.game);
    const head = page.el.querySelector('.fc-page-h');
    const gsel = head.querySelector('.fcsGame');
    const opts = '<option value="">' + ET('All games') + '</option>' + games.map(g => `<option${g === view.game ? ' selected' : ''}>${E(g)}</option>`).join('');
    if (gsel.__opts !== opts) { gsel.innerHTML = opts; gsel.__opts = opts; }
    gsel.value = view.game;
    head.querySelectorAll('.fcsSeg [data-p]').forEach(s => s.classList.toggle('on', s.dataset.p === view.period));
    const imp = head.querySelector('[data-act="import"]');
    imp.lastChild.textContent = T(view.busy ? 'Importing…' : 'Import history');
    imp.disabled = view.busy;
}

/* ------------------------------------------------------------------- import */

async function importHistory() {
    const me = fc.app.me();
    if (!me) { view.note = T('Log in first.'); render(); return; }
    view.busy = true; view.note = ''; render();
    const lme = me.toLowerCase();
    const byRom = fc.app.global().channelByGameId || {};
    const found = [];
    const seen = new Set();
    let stopped = '';
    try {
        // big pages of match history are slow on Fightcade's side: ask for 50 at a time,
        // wait up to 30 s, and retry a slow page with half the size
        let offset = 0, limit = 50;
        for (let n = 0; n < 40 && offset < 1000; n++) {
            let rows;
            try {
                rows = await fc.api.quarks({ username: me, limit, offset }, { timeout: 30000, priority: 'low', ttl: 60000 });
            } catch (e) {
                if (/timed out/.test(e.message) && limit > 10) { limit = Math.max(10, limit >> 1); continue; }
                throw e;
            }
            // a page with nothing new: Fightcade ignored the offset, or that's everything
            const fresh = rows.filter(r => { const id = r.quarkid || r.quarkId || r.id; return id && !seen.has(id); });
            if (!fresh.length) break;
            fresh.forEach(r => seen.add(r.quarkid || r.quarkId || r.id));
            fresh.forEach(r => {
                const players = Array.isArray(r.players) ? r.players : [];
                const mine = players.find(p => (p.name || '').toLowerCase() === lme);
                const opp = players.find(p => p !== mine);
                if (!mine || !opp || r.num_matches === 0) return;
                const d = fc.data.quarkDate(r);
                if (!d) return;
                const a = typeof mine.score === 'number' ? mine.score : null, b = typeof opp.score === 'number' ? opp.score : null;
                const channel = r.channelname || byRom[r.gameid] || '';
                found.push({ at: d.getTime(), opp: opp.name || '', game: shortName(channel) || r.gameid || '', channel, rom: r.gameid || '',
                    result: a == null || b == null ? null : a > b ? 'won' : a < b ? 'lost' : 'draw',
                    mine: a, theirs: b, quark: r.quarkid || r.quarkId || r.id, dur: r.duration || 0, emu: r.emulator || '', imported: true });
            });
            offset += rows.length;
            if (rows.length < limit) break;
        }
    } catch (e) {
        stopped = e.message;            // keep what came in before the failure
    }
    const added = fc.history.merge(found);
    if (stopped && !found.length) view.note = T('Import failed: {error}.', { error: stopped });
    else view.note = (added ? T('Imported {n} sets from Fightcade', { n: added }) : T('Up to date — nothing new to import ({n} checked)', { n: found.length })) +
        (stopped ? '; ' + T('stopped early: {error}. Try again later for the rest.', { error: stopped }) : '.');
    view.busy = false;
    render();
}

/* --------------------------------------------------------------- share card */

const FONT = "'gg sans', 'Noto Sans', 'Segoe UI', sans-serif";

function loadImg(src) {
    return new Promise(res => {
        if (!src) { res(null); return; }
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = src;
    });
}

function rr(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
}

function cover(x, img, px, py, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const iw = img.width * s, ih = img.height * s;
    x.drawImage(img, px + (w - iw) / 2, py + (h - ih) / 2, iw, ih);
}

function glow(x, cx, cy, r, col) {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function fit(x, text, maxW) {
    let t = String(text);
    if (x.measureText(t).width <= maxW) return t;
    while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
}

const daySets = (k) => allSets().filter(s => sessionKey(s.at) === k).sort((a, b) => a.at - b.at);

// 1200 x 630 (the size Discord / Twitter show large)
async function drawShare(k, withArt) {
    const sets = daySets(k);
    const t = tally(sets), st = streaks(sets);
    const W = 1200, H = 630;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const count = new Map();
    sets.forEach(s => { if (s.rom) count.set(s.rom, (count.get(s.rom) || 0) + 1); });
    const rom = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    const games = [...new Set(sets.map(gameOf))];
    const art = withArt && rom ? await loadImg(fc.data.artUrl(rom[0])) : null;
    const br = mod('branding');
    const logo = await loadImg(br && br.LOGO);

    x.fillStyle = '#0d0f1f';
    x.fillRect(0, 0, W, H);
    if (art) {
        x.save();
        x.filter = 'blur(24px) brightness(.5) saturate(1.4)';
        cover(x, art, -80, -80, W + 160, H + 160);
        x.restore();
    }
    const shade = x.createLinearGradient(0, 0, W, 0);
    shade.addColorStop(0, 'rgba(10,11,24,.94)');
    shade.addColorStop(0.62, 'rgba(10,11,24,.74)');
    shade.addColorStop(1, 'rgba(10,11,24,.4)');
    x.fillStyle = shade;
    x.fillRect(0, 0, W, H);
    glow(x, 1040, 110, 420, 'rgba(79,99,240,.38)');
    glow(x, 120, 640, 360, 'rgba(139,92,246,.28)');
    glow(x, 1180, 600, 260, 'rgba(34,227,242,.16)');

    // the game, sharp, top right
    if (art) {
        x.save();
        rr(x, 856, 48, 296, 222, 14);
        x.clip();
        x.imageSmoothingEnabled = false;
        cover(x, art, 856, 48, 296, 222);
        x.restore();
        x.strokeStyle = 'rgba(255,255,255,.16)';
        x.lineWidth = 2;
        rr(x, 856, 48, 296, 222, 14);
        x.stroke();
    }

    if (logo) x.drawImage(logo, 60, 50, 230, 230 * logo.height / logo.width);
    else { x.font = '800 40px ' + FONT; x.fillStyle = '#4f63f0'; x.fillText('FightCord', 60, 88); }

    const date = new Date(k + 'T12:00:00').toLocaleDateString(fc.t.locale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    x.textBaseline = 'alphabetic';
    x.font = '700 20px ' + FONT;
    x.fillStyle = '#22e3f2';
    x.fillText(T('SESSION') + '  ·  ' + date.toUpperCase(), 60, 148);
    x.font = '800 58px ' + FONT;
    x.fillStyle = '#ffffff';
    x.fillText(fit(x, fc.app.me() || 'Me', 770), 60, 212);
    x.font = '500 24px ' + FONT;
    x.fillStyle = '#c9cdf0';
    x.fillText(fit(x, games.slice(0, 2).join('  ·  ') + (games.length > 2 ? '  +' + (games.length - 2) : ''), 770), 60, 252);

    // stat tiles
    const tiles = [
        [t.w + '–' + t.l + (t.d ? '–' + t.d : ''), T('RECORD'), t.w >= t.l ? '#2dd48f' : '#f24b5a'],
        [t.rate == null ? '—' : Math.round(t.rate * 100) + '%', T('WIN RATE'), '#ffffff'],
        [st.bestW ? st.bestW + 'W' : '—', T('BEST STREAK'), '#f5b83d'],
        [String(t.n), T('SETS PLAYED'), '#ffffff']
    ];
    tiles.forEach(([v, label, col], i) => {
        const px = 60 + i * 276, py = 292;
        rr(x, px, py, 258, 118, 16);
        x.fillStyle = 'rgba(255,255,255,.06)';
        x.fill();
        x.strokeStyle = 'rgba(255,255,255,.1)';
        x.lineWidth = 1.5;
        x.stroke();
        x.font = '800 50px ' + FONT;
        x.fillStyle = col;
        x.fillText(fit(x, v, 226), px + 22, py + 66);
        x.font = '700 15px ' + FONT;
        x.fillStyle = '#8a90b8';
        x.fillText(label, px + 22, py + 98);
    });

    // the sets, newest first
    sets.slice().reverse().slice(0, 6).forEach((s, i) => {
        const px = 60 + (i % 3) * 368, py = 440 + Math.floor(i / 3) * 76;
        const col = s.result === 'won' ? '#2dd48f' : s.result === 'lost' ? '#f24b5a' : '#8a90b8';
        rr(x, px, py, 352, 62, 12);
        x.fillStyle = 'rgba(255,255,255,.05)';
        x.fill();
        x.fillStyle = col;
        rr(x, px, py, 6, 62, 3);
        x.fill();
        const mark = s.result === 'won' ? 'W' : s.result === 'lost' ? 'L' : s.result === 'draw' ? 'D' : '?';
        const score = s.mine != null && s.theirs != null ? ' ' + s.mine + '–' + s.theirs : '';
        x.font = '800 24px ' + FONT;
        x.fillStyle = col;
        x.fillText(mark + score, px + 22, py + 40);
        const w0 = x.measureText(mark + score).width;
        x.font = '600 20px ' + FONT;
        x.fillStyle = '#dde1f5';
        x.fillText(fit(x, 'vs ' + (s.opp || '?'), 352 - 44 - w0), px + 34 + w0, py + 39);
    });
    if (sets.length > 6) {
        x.font = '600 16px ' + FONT;
        x.fillStyle = '#8a90b8';
        x.textAlign = 'right';
        x.fillText(T('+{n} more sets', { n: sets.length - 6 }), W - 48, 612);
        x.textAlign = 'left';
    }
    return c;
}

async function share(k) {
    k = k || sessionKey(Date.now());
    if (!daySets(k).length) {
        fc.ui.toast('No sets recorded for that session', { kind: 'warning' });
        return;
    }
    let url = '', savedFile = '';
    const say = (html) => { const m = modal.body.querySelector('.msg'); if (m) m.innerHTML = html; };
    const modal = fc.ui.modal({
        title: 'Share your session', width: 880, cls: 'fcsShare',
        body: '<div class="fcsPv"><div class="ld"><span class="fc-spin"></span> ' + ET('Drawing…') + '</div></div><div class="msg"></div>',
        actions: [
            { label: 'Save PNG', kind: 'sec', keep: true, fn: () => {
                if (!url) return;
                try {
                    const dir = path.join(require('os').homedir(), 'Pictures', 'Fightcord');
                    fs.mkdirSync(dir, { recursive: true });
                    savedFile = path.join(dir, 'session-' + k + '.png');
                    fs.writeFileSync(savedFile, Buffer.from(url.split(',')[1], 'base64'));
                    say(ET('Saved to {file}', { file: savedFile }) + ' · <span class="lnk" data-show="1">' + ET('Show in folder') + '</span>');
                } catch (err) { say(ET('Couldn’t save ({error}).', { error: err.message })); }
            } },
            { label: 'Copy image', keep: true, fn: async () => {
                if (!url) return;
                try {
                    const { clipboard, nativeImage } = require('electron');
                    clipboard.writeImage(nativeImage.createFromDataURL(url));
                    say(ET('Copied — paste it into Discord with Ctrl+V.'));
                } catch (err) {
                    try {
                        const blob = await (await fetch(url)).blob();
                        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
                        say(ET('Copied — paste it into Discord with Ctrl+V.'));
                    } catch (err2) { say(ET('Couldn’t copy ({error}) — use Save PNG.', { error: err2.message })); }
                }
            } }
        ]
    });
    modal.body.addEventListener('click', (e) => {
        if (e.target.closest('[data-show]') && savedFile) { try { require('electron').shell.showItemInFolder(savedFile); } catch (err) { /* harness */ } }
    });
    let canvas;
    // Fightcade's art is same-origin in the app; anywhere else it taints the canvas -> draw without it
    try { canvas = await drawShare(k, true); url = canvas.toDataURL('image/png'); }
    catch (e) { canvas = await drawShare(k, false); url = canvas.toDataURL('image/png'); }
    const pv = modal.body.querySelector('.fcsPv');
    if (pv) pv.innerHTML = `<img src="${url}" alt="">`;
}

/* --------------------------------------------------------------------- page */

let openedOn = '';          // the view the page was opened over

function onPageClick(e) {
    const tb = e.target.closest('.fcsTabs [data-tab]');
    if (tb) { view.tab = tb.getAttribute('data-tab'); render(); page.body.scrollTop = 0; return; }
    const seg = e.target.closest('[data-p]');
    if (seg) { view.period = seg.dataset.p; render(); return; }
    const rp = e.target.closest('[data-replay]');
    if (rp) { window.open(rp.dataset.replay, '_blank'); return; }
    const a = e.target.closest('[data-act]');
    const act = a && a.getAttribute('data-act');
    if (act === 'import' || act === 'empty') { if (!view.busy) importHistory(); return; }
    if (act === 'back') { view.opp = ''; view.note = ''; render(); page.body.scrollTop = 0; return; }
    if (act && view.opp) { if (!a.disabled) onH2HAction(act, a); return; }
    const op = e.target.closest('[data-opp]');
    if (op) { view.opp = op.dataset.opp; view.note = ''; render(); page.body.scrollTop = 0; return; }
    const star = e.target.closest('[data-star]');
    if (star && star.dataset.star) {
        const set = allSets().find(x => x.quark === star.dataset.star);
        if (set) { fc.history.update(set.quark, { star: !set.star }); render(); }
        return;
    }
    const sh = e.target.closest('[data-share]');
    if (sh) share(sh.dataset.share);
}

// opts: { opp: 'name' } opens the head-to-head, { game: 'short game name' } pre-filters
function open(opts) {
    const o = opts || {};
    view.opp = o.opp || '';
    if (o.tab) view.tab = o.tab;
    if (o.game !== undefined) view.game = o.game;
    view.note = '';
    openedOn = fc.app.activeChannelId();
    const fr = mod('friends');
    if (fr && fr.close) fr.close();
    if (!page) {
        page = fc.ui.page('stats', {
            title: 'Your stats', icon: 'chart', cls: 'fcsPage',
            tools: `<span class="fcsSeg"><span data-p="7">${ET('7 days')}</span><span data-p="30">${ET('30 days')}</span><span data-p="all">${ET('All time')}</span></span>` +
                `<select class="fc-select fcsGame"></select>` + fc.ui.btn('Import history', { kind: 'sec', size: 'sm', icon: 'download', act: 'import', title: 'Add your older sets from Fightcade’s match list' }),
            onEsc: () => { if (view.opp) { view.opp = ''; render(); return false; } return true; },
            onClose: () => { page = null; }
        });
        page.el.id = 'fcsStats';
        page.el.addEventListener('click', onPageClick);
        page.el.addEventListener('mousedown', (e) => e.stopPropagation());
        page.el.querySelector('.fcsGame').addEventListener('change', (e) => { view.game = e.target.value; render(); });
    }
    render();
}

function close() { if (page) page.close(); }

const CSS = `
#fcsStats .fc-page-b { padding-top: 8px; }
#fcsStats .fcsSeg { display: flex; padding: 3px; border-radius: var(--fc-r2); background: var(--fc-s1); }
#fcsStats .fcsSeg span { padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; color: var(--fc-muted); cursor: pointer; }
#fcsStats .fcsSeg span.on { background: var(--fc-s4); color: var(--fc-head); }
#fcsStats .fcsGame { height: 30px; font-size: 13px; max-width: 220px; }
#fcsStats .fcsTabs { margin: 0 0 12px; }
#fcsStats .fcsNote { min-height: 18px; font-size: 13px; color: var(--fc-success); }
#fcsStats .fcsTop { display: flex; flex-wrap: wrap; margin: 4px -6px 0; }
#fcsStats .fcsBig { flex: 1 1 140px; margin: 6px; padding: 14px 16px; }
#fcsStats .fcsBig .v { font-size: 24px; font-weight: 800; }
#fcsStats .fcsBig .v.good { color: var(--fc-success); } #fcsStats .fcsBig .v.bad { color: var(--fc-danger); }
#fcsStats .fcsBig .k { text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 12px; }
#fcsStats .fcsGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); grid-gap: 12px; margin-top: 12px; }
#fcsStats .fcsCard { padding: 14px 16px; }
#fcsStats .fcsCard.wide { grid-column: 1 / -1; }
#fcsStats h4 { margin: 0 0 10px; font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--fc-muted); }
#fcsStats h4 small { text-transform: none; font-weight: 500; letter-spacing: 0; }
#fcsStats .fcsRow { display: flex; align-items: center; padding: 4px 0; font-size: 14px; }
#fcsStats .fcsRow .n { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--fc-head); font-weight: 600; }
#fcsStats .fcsRow .r { flex: none; margin-left: 10px; font-variant-numeric: tabular-nums; }
#fcsStats .fcsRow .p { flex: none; width: 48px; text-align: right; font-weight: 700; color: var(--fc-muted); }
#fcsStats .fcsRow .p.good { color: var(--fc-success); } #fcsStats .fcsRow .p.bad { color: var(--fc-danger); }
#fcsStats .fcsBar { height: 4px; margin: 4px 0 6px; border-radius: 2px; background: rgba(242,63,67,.35); overflow: hidden; }
#fcsStats .fcsBar i { display: block; height: 100%; background: var(--fc-success); }
#fcsStats .fcsChart { display: block; width: 100%; height: 160px; }
#fcsStats .fcsChart .grid { stroke: rgba(255,255,255,.06); stroke-width: 1; }
#fcsStats .fcsChart .mid { stroke: rgba(255,255,255,.18); stroke-width: 1; stroke-dasharray: 4 4; }
#fcsStats .fcsChart .ln { fill: none; stroke: var(--fc-accent); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
#fcsStats .fcsChart .pt { fill: var(--fc-accent); stroke: var(--fc-s2); stroke-width: 2; vector-effect: non-scaling-stroke; }
#fcsStats .fcsAxis { display: flex; justify-content: space-between; font-size: 11px; color: var(--fc-muted); margin-top: 4px; }
#fcsStats .fcsSessions { display: flex; align-items: flex-end; height: 130px; }
#fcsStats .fcsSessions .s { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; cursor: pointer; border-radius: 6px; }
#fcsStats .fcsSessions .s:hover { background: rgba(255,255,255,.05); }
#fcsStats .fcsSessions .bars { flex: 1; width: 60%; max-width: 34px; display: flex; flex-direction: column-reverse; justify-content: flex-start; }
#fcsStats .fcsSessions i { display: block; width: 100%; }
#fcsStats .fcsSessions i.w { background: var(--fc-success); border-radius: 3px 3px 0 0; }
#fcsStats .fcsSessions i.l { background: var(--fc-danger); }
#fcsStats .fcsSessions span { margin-top: 4px; font-size: 11px; color: var(--fc-muted); }
#fcsStats [data-opp] { cursor: pointer; }
#fcsStats .fcsRow [data-opp]:hover, #fcsStats .fcsSet .o[data-opp]:hover { text-decoration: underline; }
#fcsStats .fcsBack { margin: 4px 0 8px -8px; }
#fcsStats .fcsHHead { display: flex; align-items: center; flex-wrap: wrap; padding: 18px 20px; border-radius: var(--fc-r3);
    background: linear-gradient(120deg, var(--fc-accent-soft), transparent 70%), var(--fc-s2); }
#fcsStats .fcsHHead > .fc-avatar { margin-right: 16px; }
#fcsStats .fcsHHead .who { flex: 1; min-width: 200px; }
#fcsStats .fcsHHead .nm { font-size: 24px; font-weight: 800; color: var(--fc-head); }
#fcsStats .fcsHHead .nm .fc-flag { margin-right: 8px; }
#fcsStats .fcsHHead .nm .fr { color: var(--fc-warning); font-size: 18px; }
#fcsStats .fcsHHead .st { margin: 2px 0 4px; font-size: 13px; color: var(--fc-muted); }
#fcsStats .fcsHHead .st.on { color: var(--fc-success); } #fcsStats .fcsHHead .st.playing { color: var(--fc-danger); }
#fcsStats .fcsHHead .acts { display: flex; flex-wrap: wrap; }
#fcsStats .fcsHHead .acts > .fc-btn { margin: 4px 0 4px 8px; }
#fcsStats .fcsSet { display: flex; align-items: center; min-height: 36px; padding: 4px 8px; margin: 0 -8px; border-radius: 6px; font-size: 14px; }
#fcsStats .fcsSet:hover { background: var(--fc-hover); }
#fcsStats .fcsSet > b { flex: none; width: 22px; height: 22px; margin-right: 10px; border-radius: 5px; display: flex; align-items: center;
    justify-content: center; font-size: 12px; font-weight: 800; color: #fff; background: var(--fc-s4); }
#fcsStats .fcsSet > b.w { background: var(--fc-success); } #fcsStats .fcsSet > b.l { background: var(--fc-danger); }
#fcsStats .fcsSet .o { flex: 1 1 30%; min-width: 0; font-weight: 600; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcsStats .fcsSet .sc { flex: none; width: 48px; font-weight: 700; font-variant-numeric: tabular-nums; }
#fcsStats .fcsSet .g { flex: 1 1 30%; min-width: 0; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcsStats .fcsSet .t { flex: none; width: 128px; text-align: right; color: var(--fc-muted); font-size: 12px; }
#fcsStats .fcsRp { flex: none; width: 82px; margin-left: 12px; }
#fcsStats span.fcsRp.none { display: inline-block; }
#fcsStats .fcsStar { flex: none; width: 28px; margin-left: 6px; text-align: center; font-size: 17px; color: var(--fc-muted); cursor: pointer; }
#fcsStats .fcsStar.on, #fcsStats .fcsStar:hover { color: var(--fc-warning); }
#fcsStats .fcsStar.none { cursor: default; }
.fcsPv { border-radius: var(--fc-r2); overflow: hidden; background: #0d0f1f; }
.fcsPv img { display: block; width: 100%; }
.fcsPv .ld { padding: 120px 0; text-align: center; color: var(--fc-muted); }
.fc-modal .msg { min-height: 18px; margin-top: 10px; font-size: 13px; color: var(--fc-success); }
.fc-modal .msg .lnk { color: var(--fc-link); cursor: pointer; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    window.__fcStatsLoaded = true;
    fc.ui.style('fcsStyle', CSS);
    fc.own(() => { fc.ui.style('fcsStyle', null); close(); window.__fcStatsLoaded = false; });
    fc.cmd('stats', 'Your stats', () => open());
    // switching to another channel / page closes it (opening it FROM a channel -- the 🏆
    // pill, /stats -- must not)
    const onNav = () => close();
    fc.on('nav', onNav);
    const reH2H = () => { if (page && view.opp) render(); };
    fc.on('notes:changed', reH2H);
    fc.on('friends:changed', reH2H);
    fc.on('set:recorded', () => { if (page) render(); });
    fc.tick(() => { if (page && fc.app.activeChannelId() !== openedOn) close(); }, 500);
    return api;
}

const api = {
    addTab: (t) => addTab(t),
    open: (opts) => open(opts),
    close: () => close(),
    share: (k) => share(k),
    _tally: tally,
    _streaks: streaks,
    _drawShare: (k, art) => drawShare(k, art),
    _replayUrl: (s) => replayUrl(s),
    _sessionKey: sessionKey
};

module.exports = { id: 'stats', name: 'Stats, head-to-head & share card', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
