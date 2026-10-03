/**
 * Fightcord progress: your rank & ELO over time
 *
 * Once a day for every game you've played lately (and a minute after each set), Fightcord
 * asks Fightcade's API for your rank, ELO and matches in that game -- plus your spot on the
 * leaderboard when it's at hand -- and keeps one point per game per day in rank-history.json.
 *
 *   - a Progress tab on the Stats page: ELO line, rank timeline, leaderboard spot, best ever
 *   - a celebration when your rank goes up (and a quiet note when it goes down)
 *
 * ELO: Fightcade's own when it gives one, else an estimate from your rank and leaderboard
 * spot (marked "~"). Events: rank:changed {rom, from, to}.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, cfg = null;          // progress-config.json
const FILE = path.join(__dirname, 'rank-history.json');
const MAX_POINTS = 4000;
const DAY = 86400000;

/* --------------------------------------------------------------- the data */

const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

// Adds a point: one per game per day (a newer one that day replaces it), except a rank change
// always gets its own point. -> { points, changed: {from, to} | null }
function mergePoint(points, p) {
    const list = points.slice();
    let prev = null;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].rom === p.rom) { prev = list[i]; break; }
    const changed = prev && prev.rank && p.rank && prev.rank !== p.rank ? { from: prev.rank, to: p.rank } : null;
    if (prev && !changed && dayKey(prev.at) === dayKey(p.at)) list[list.lastIndexOf(prev)] = p;
    else list.push(p);
    if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
    return { points: list, changed };
}

// the facts for one game: latest, best ever, firsts
function summary(points, rom) {
    const ps = points.filter(p => p.rom === rom).sort((a, b) => a.at - b.at);
    if (!ps.length) return null;
    const last = ps[ps.length - 1], first = ps[0];
    const best = ps.reduce((b, p) => (p.rank > b.rank || (p.rank === b.rank && (p.elo || 0) > (b.elo || 0))) ? p : b, ps[0]);
    const bestPos = ps.filter(p => p.pos).reduce((b, p) => (!b || p.pos < b.pos) ? p : b, null);
    return { ps, last, first, best, bestPos, eloChange: last.elo != null && first.elo != null ? last.elo - first.elo : null,
        matchesSince: (last.matches || 0) - (first.matches || 0) };
}

let points = [];
let saveTimer = 0;
function load() {
    try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); points = Array.isArray(j.points) ? j.points : []; }
    catch (e) { points = []; }
}
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = 0;
        fs.writeFile(FILE, JSON.stringify({ v: 1, points }), (e) => { if (e) fc.log.warn('rank history save failed', e.message); });
    }, 500);
}

/* ---------------------------------------------------------------- snapshot */

const lastTry = new Map();              // rom -> when we last asked

async function snapshot(rom, why) {
    const me = fc.app.me();
    if (!rom || !me || !cfg.track) return null;
    const t = Date.now();
    if (why !== 'now' && t - (lastTry.get(rom) || 0) < 10 * 60000) return null;
    const prev = points.filter(p => p.rom === rom).pop();
    if (why === 'daily' && prev && dayKey(prev.at) === dayKey(t)) return null;
    lastTry.set(rom, t);
    let u;
    try { u = await fc.api.user(me, { priority: 'low', ttl: why === 'now' ? 0 : 5 * 60000 }); }
    catch (e) { fc.log('rank snapshot skipped:', e.message); return null; }
    const gi = u && u.gameinfo && u.gameinfo[rom];
    if (!gi || !gi.rank) return null;                                // not ranked in this game
    const board = fc.api.cachedBoard(rom);
    const spot = board && board.get(me.toLowerCase());
    const est = fc.data.eloFor(me, gi.rank, board, gi.elo || gi.rating);
    const p = { at: t, rom, rank: gi.rank, elo: est ? est.elo : null, est: est ? est.est : true, matches: gi.num_matches || 0, pos: spot ? spot.pos : null };
    const r = mergePoint(points, p);
    points = r.points;
    save();
    if (r.changed) rankChanged(rom, r.changed.from, r.changed.to);
    if (page()) page().rerender && refreshTab();
    return p;
}

// the games worth tracking: the one on screen + what you played in the last 30 days
function roms() {
    const since = Date.now() - 30 * DAY;
    const set = new Set();
    const g = fc.app.activeGameId();
    if (g) set.add(g);
    fc.history.all().forEach(s => { if (s.rom && s.at >= since) set.add(s.rom); });
    return [...set];
}

let dailyBusy = false;
async function daily() {
    if (dailyBusy) return;
    dailyBusy = true;
    try { for (const rom of roms()) await snapshot(rom, 'daily'); }
    finally { dailyBusy = false; }
}

/* -------------------------------------------------------------- rank change */

function gameName(rom) {
    const s = fc.history.all().slice().reverse().find(x => x.rom === rom && (x.channel || x.game));
    return s ? String(s.channel || s.game).replace(/\s*\([^)]*\)\s*$/, '') : rom;
}

function rankChanged(rom, from, to) {
    const up = to > from;
    const F = fc.data.rankLetter(from), T = fc.data.rankLetter(to);
    fc.emit('rank:changed', { rom, from, to });
    fc.log('rank changed in', rom, F, '->', T);
    if (!cfg.celebrate) return;
    if (!up) {
        fc.ui.toast('Rank ' + F + ' → ' + T + ' in ' + gameName(rom), { icon: 'trend', ms: 8000, sub: 'It happens. Your progress tab shows the long run.', onClick: () => openTab() });
        return;
    }
    celebrate(F, T, gameName(rom));
}

function celebrate(F, T, game) {
    const old = document.getElementById('prgOverlay');
    if (old) old.remove();
    const o = document.createElement('div');
    o.id = 'prgOverlay';
    let bits = '';
    const cols = [fc.data.rankColor(T), '#fff3c4', '#ffffff', fc.data.rankColor(F)];
    for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2, d = 30 + Math.random() * 30;
        bits += `<span class="bit" style="background:${cols[i % cols.length]};--x:${(Math.cos(a) * d).toFixed(1)}vmax;--y:${(Math.sin(a) * d).toFixed(1)}vmax;` +
            `--r:${Math.round(Math.random() * 720)}deg;animation-delay:${(0.2 + Math.random() * 0.2).toFixed(2)}s"></span>`;
    }
    o.innerHTML = `<div class="glow" style="--c:${fc.data.rankColor(T)}"></div>${bits}
        <div class="big">RANK UP!</div>
        <div class="ranks"><span class="r from" style="--c:${fc.data.rankColor(F)}">${F}</span><span class="arrow">→</span><span class="r to" style="--c:${fc.data.rankColor(T)}">${T}</span></div>
        <div class="game">${fc.fmt.esc(game)}</div><div class="hint">click to close</div>`;
    o.addEventListener('mousedown', (e) => e.stopPropagation());
    o.addEventListener('click', (e) => { e.stopPropagation(); o.classList.add('out'); setTimeout(() => o.remove(), 400); });
    document.body.appendChild(o);
    fc.sound.duck(true);
    fc.sound.play('success');
    setTimeout(() => { if (o.isConnected) { o.classList.add('out'); setTimeout(() => o.remove(), 400); } fc.sound.duck(false); }, 6000);
}

/* --------------------------------------------------------------------- tab */

let tabRom = '';
let tabCtx = null;
const page = () => tabCtx;
function refreshTab() { if (tabCtx && tabCtx.rerender) tabCtx.rerender(); }
function openTab() { const s = fc.modules.get('stats'); if (s && s.open) s.open({ tab: 'progress' }); }

function tabHtml(ctx) {
    tabCtx = ctx;
    const E = fc.fmt.esc;
    const romsWith = [...new Set(points.map(p => p.rom))];
    if (!romsWith.length) return fc.ui.empty({ icon: 'trend', title: 'Your rank history starts now',
        sub: 'Fightcord checks your rank and ELO once a day and after each set, for every game you play ranked. Come back after a few sessions.',
        action: cfg.track ? 'Check my rank now' : '', act: 'prg-now' });
    if (!romsWith.includes(tabRom)) {
        const latest = points.slice().sort((a, b) => b.at - a.at)[0];
        tabRom = latest.rom;
    }
    const s = summary(points, tabRom);
    const L = (r) => fc.data.rankLetter(r);
    const elo = s.ps.filter(p => p.elo != null);
    const chart = (pts, opts) => `<div class="prgChart">${fc.ui.chart.line([{ points: pts, area: true }], Object.assign({ w: 680, h: 180, dots: pts.length < 40 }, opts))}</div>`;
    const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const xl = (ps) => ps.length > 1 ? [[ps[0].at, day(ps[0].at)], [ps[ps.length - 1].at, day(ps[ps.length - 1].at)]] : [];
    const posPts = s.ps.filter(p => p.pos);
    // rank timeline: one coloured segment per stretch at a rank
    const t0 = s.first.at, t1 = Math.max(s.last.at, t0 + 1);
    const segs = [];
    s.ps.forEach((p, i) => {
        const end = i + 1 < s.ps.length ? s.ps[i + 1].at : Date.now();
        const lastSeg = segs[segs.length - 1];
        if (lastSeg && lastSeg.rank === p.rank) lastSeg.end = end;
        else segs.push({ rank: p.rank, start: p.at, end });
    });
    const span = Math.max(1, Date.now() - t0);
    const card = (title, body, wide) => `<div class="fc-card fcsCard${wide ? ' wide' : ''}"><h4>${title}</h4>${body}</div>`;
    return `<div class="prgGames">${romsWith.map(r => fc.ui.chip(gameName(r), { on: r === tabRom, act: 'prg-rom:' + r })).join('')}
            ${cfg.track ? fc.ui.btn('Check now', { kind: 'ghost', size: 'sm', icon: 'refresh', act: 'prg-now', title: 'Ask Fightcade for your rank in this game now' }) : ''}</div>
        <div class="fcsTop">
            <div class="fc-tile fcsBig"><div class="v">${fc.ui.tag(s.last.rank)} ${s.last.elo != null ? (s.last.est ? '~' : '') + fc.fmt.num(s.last.elo) : ''}</div><div class="k">now${s.last.elo != null ? ' · ELO' + (s.last.est ? ' (estimated)' : '') : ''}</div></div>
            <div class="fc-tile fcsBig"><div class="v">${fc.ui.tag(s.best.rank)}</div><div class="k">best ever · ${day(s.best.at)}</div></div>
            <div class="fc-tile fcsBig${s.eloChange > 0 ? ' up' : s.eloChange < 0 ? ' down' : ''}"><div class="v">${s.eloChange == null ? '—' : (s.eloChange > 0 ? '+' : '') + s.eloChange}</div><div class="k">ELO since ${day(s.first.at)}</div></div>
            <div class="fc-tile fcsBig"><div class="v">${s.last.pos ? '#' + s.last.pos : '—'}</div><div class="k">leaderboard${s.bestPos ? ' · best #' + s.bestPos.pos : ''}</div></div>
            <div class="fc-tile fcsBig"><div class="v">${fc.fmt.num(s.matchesSince)}</div><div class="k">matches since ${day(s.first.at)}</div></div>
        </div>
        <div class="fcsGrid">
            ${card('ELO over time' + (s.last.est ? ' <small>— estimated from rank and leaderboard spot</small>' : ''),
                elo.length > 1 ? chart(elo.map(p => [p.at, p.elo]), { yLabel: (v) => Math.round(v), xLabels: xl(elo) }) : '<div class="fc-muted">One point so far — the line starts tomorrow.</div>', true)}
            ${card('Rank', `<div class="prgRanks">${segs.map(g => `<i style="width:${((g.end - g.start) / span * 100).toFixed(2)}%;background:${fc.data.rankColor(g.rank)}" title="${L(g.rank)} · ${day(g.start)} – ${day(g.end)}">${(g.end - g.start) / span > 0.06 ? L(g.rank) : ''}</i>`).join('')}</div>` +
                `<div class="prgAxis"><span>${day(t0)}</span><span>today</span></div>`, true)}
            ${posPts.length > 1 ? card('Leaderboard spot <small>— higher is better</small>', chart(posPts.map(p => [p.at, -p.pos]), { yLabel: (v) => '#' + Math.round(-v), xLabels: xl(posPts) }), true) : ''}
        </div>`;
}

function tabAfter(el) {
    el.onclick = (e) => {
        const a = e.target.closest('[data-act]');
        const act = a && a.getAttribute('data-act');
        if (!act) return;
        e.stopPropagation();
        if (act.indexOf('prg-rom:') === 0) { tabRom = act.slice(8); refreshTab(); }
        else if (act === 'prg-now' || act === 'empty') {
            a.disabled = true;
            const rom = tabRom || fc.app.activeGameId() || roms()[0];
            snapshot(rom, 'now').then(p => {
                if (!p) fc.ui.toast('No rank to show yet', { icon: 'info', sub: 'Fightcade has no ranked matches for you in ' + gameName(rom) + '.' });
                refreshTab();
            });
        }
    };
}

const CSS = `
.prgGames { display: flex; flex-wrap: wrap; align-items: center; margin-bottom: 4px; }
.prgGames .fc-chip { margin: 0 6px 6px 0; }
.prgGames .fc-btn { margin: 0 0 6px auto; }
.prgChart svg { width: 100%; height: auto; }
.prgRanks { display: flex; height: 28px; border-radius: var(--fc-r1); overflow: hidden; background: var(--fc-s1); }
.prgRanks i { display: flex; align-items: center; justify-content: center; font: 800 12px var(--fc-font); font-style: normal; color: #111; min-width: 2px; }
.prgAxis { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--fc-muted); }
#prgOverlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: var(--fc-z-top); display: flex; flex-direction: column; align-items: center;
    justify-content: center; overflow: hidden; cursor: pointer; background: radial-gradient(ellipse at 50% 45%, #2a1d4a 0%, #0d0f1f 70%);
    font-family: var(--fc-font); animation: fcIn .3s ease both; }
#prgOverlay.out { opacity: 0; transition: opacity .4s ease; }
#prgOverlay .glow { position: absolute; width: 70vmin; height: 70vmin; border-radius: 50%; background: radial-gradient(circle, var(--c), transparent 65%); opacity: .35;
    animation: prgPulse 1.6s ease-in-out infinite alternate; }
@keyframes prgPulse { to { transform: scale(1.15); opacity: .55; } }
#prgOverlay .big { position: relative; font-size: 14vmin; font-weight: 900; font-style: italic; color: #fff; letter-spacing: -.02em;
    text-shadow: 0 0 4vmin rgba(79,99,240,.8), 0 1vmin 0 #2b2f8a; animation: prgPunch .6s .1s cubic-bezier(.2,1.7,.4,1) both; }
@keyframes prgPunch { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: none; } }
#prgOverlay .ranks { position: relative; display: flex; align-items: center; margin-top: 3vmin; animation: fcRise .5s .5s both; }
#prgOverlay .r { width: 14vmin; height: 14vmin; border-radius: 3vmin; display: flex; align-items: center; justify-content: center;
    font-size: 9vmin; font-weight: 900; color: #111; background: var(--c); box-shadow: 0 0 5vmin var(--c); }
#prgOverlay .r.from { opacity: .45; transform: scale(.8); }
#prgOverlay .arrow { margin: 0 4vmin; font-size: 7vmin; color: #fff; }
#prgOverlay .game { position: relative; margin-top: 3vmin; font-size: 2.6vmin; font-weight: 700; letter-spacing: .3em; text-transform: uppercase; color: rgba(255,255,255,.75); }
#prgOverlay .hint { position: absolute; right: 2.4vmin; bottom: 2vmin; font-size: 1.6vmin; color: rgba(255,255,255,.35); }
#prgOverlay .bit { position: absolute; left: 50%; top: 45%; width: 1.6vmin; height: 1.6vmin; border-radius: .3vmin;
    animation: prgBurst 1.8s cubic-bezier(.1,.8,.3,1) both; }
@keyframes prgBurst { from { transform: translate(0,0) rotate(0); opacity: 1; } to { transform: translate(var(--x), var(--y)) rotate(var(--r)); opacity: 0; } }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('progress', { track: true, celebrate: true });
    cfg = store.data;
    load();
    fc.ui.style('prgStyle', CSS);
    fc.own(() => { fc.ui.style('prgStyle', null); if (saveTimer) { clearTimeout(saveTimer); fs.writeFileSync(FILE, JSON.stringify({ v: 1, points })); } });
    const stats = fc.modules.get('stats');
    if (stats && stats.addTab) fc.own(stats.addTab({ id: 'progress', label: 'Progress', order: 20, html: tabHtml, after: tabAfter }));
    // after a set, Fightcade updates your rank within a minute or so
    fc.on('set:recorded', (s) => { if (s && s.rom) setTimeout(() => snapshot(s.rom, 'set'), 60000); });
    fc.tick(daily, 30 * 60000, { delay: 25000, whileHidden: true });
    fc.settings.block({
        id: 'progress', section: 'match', title: 'Rank & ELO history', hint: '— the Progress tab on your stats page', store, order: 20,
        fields: [
            { key: 'track', type: 'switch', label: 'Keep a rank history', hint: 'Once a day per game you play, and after each set' },
            { key: 'celebrate', type: 'switch', label: 'Celebrate a rank-up', hint: 'A full-screen moment when your rank goes up', show: (d) => d.track },
            { type: 'html', html: () => `<div class="fc-note">${fc.fmt.plural(points.length, 'point')} saved for ${fc.fmt.plural(new Set(points.map(p => p.rom)).size, 'game')}.</div>` },
            { type: 'button', label: 'See your progress', button: 'Open', act: 'open', onClick: () => { const st = fc.modules.get('fightcord'); if (st) st.close(); openTab(); } },
            { type: 'button', label: 'Preview the rank-up screen', button: 'Preview', act: 'preview', onClick: () => celebrate('B', 'A', 'Street Fighter III 3rd Strike') }
        ]
    });
    return api;
}

const api = {
    snapshot: (rom, why) => snapshot(rom, why || 'now'),
    points: () => points.slice(),
    summary: (rom) => summary(points, rom),
    _celebrate: (a, b, g) => celebrate(a, b, g),
    _rankChanged: (rom, from, to) => rankChanged(rom, from, to)
};

module.exports = { id: 'progress', name: 'Rank & ELO history', needs: ['stats'], start, mergePoint, summarize: summary };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
