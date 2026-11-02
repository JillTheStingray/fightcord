/**
 * Fightcord Wrapped (3.9): your month (or year) on Fightcade as a story
 *
 * Seven to ten full-screen slides out of your own match history -- sets, record, hours, your main,
 * your rival and your nemesis, your best night, your longest streak, your climb, your comebacks --
 * and a card at the end to share. Everything comes from match-history.json and rank-history.json,
 * so it's only as complete as what Fightcord saw.
 *
 *   - a toast in the first week of a month: last month's is ready (and in January, last year's)
 *   - Stats → Wrapped: any month or year with 5 sets or more
 */
'use strict';

let fc = null;
let store = null, cfg = null;
const N_ = (s) => s;
const T = (s, v) => fc.t(s, v);
const E = (s) => fc.fmt.esc(s);
const lc = (s) => String(s || '').toLowerCase();

/* ------------------------------------------------------------------ the numbers */

const MIN_SETS = 5;
const HOUR = 3600000;

// a night runs 5 AM -> 5 AM (stats.js and the 🏆 pill count the same way)
function nightKey(at) {
    const d = new Date(at - 5 * HOUR);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// [from, to) for a month (m: 0..11) or a whole year (m: null), local time
function range(y, m) {
    return m == null ? [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()] : [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()];
}
// the most common value -> [value, count] (the latest one on a tie)
function mode(list) {
    const n = new Map();
    let best = null, bn = 0;
    list.forEach(v => { if (!v) return; const c = (n.get(v) || 0) + 1; n.set(v, c); if (c >= bn) { best = v; bn = c; } });
    return best ? [best, bn] : null;
}

// a month or year of sets (and rank points) -> what the story tells, or null under 5 sets
function wrapUp(all, points, from, to) {
    const sets = (all || []).filter(s => s && s.at >= from && s.at < to).sort((a, b) => a.at - b.at);
    if (sets.length < MIN_SETS) return null;
    const won = sets.filter(s => s.result === 'won').length, lost = sets.filter(s => s.result === 'lost').length, draw = sets.filter(s => s.result === 'draw').length;
    const secs = sets.reduce((n, s) => n + (s.durSec > 0 ? s.durSec : 0), 0);
    // per opponent
    const opp = new Map();
    sets.forEach(s => {
        if (!s.opp) return;
        const k = lc(s.opp), o = opp.get(k) || { name: s.opp, n: 0, w: 0, l: 0, last: 0 };
        o.n++; o.name = s.opp; o.last = s.at;
        if (s.result === 'won') o.w++; else if (s.result === 'lost') o.l++;
        opp.set(k, o);
    });
    const opps = [...opp.values()];
    const pick = (list, score) => list.reduce((b, o) => (!b || score(o) > score(b) || (score(o) === score(b) && o.last > b.last) ? o : b), null);
    const rival = pick(opps.filter(o => o.n >= 2), o => o.n);
    const nemesis = pick(opps.filter(o => o.n >= 3 && o.l > o.w), o => o.l - o.w);
    const victim = pick(opps.filter(o => o.w >= 2 && o.w > o.l && (!rival || o !== rival)), o => o.w);
    // per night
    const nights = new Map();
    sets.forEach(s => { const k = nightKey(s.at), x = nights.get(k) || { key: k, at: s.at, n: 0, w: 0, l: 0 }; x.n++; if (s.result === 'won') x.w++; if (s.result === 'lost') x.l++; nights.set(k, x); });
    const best = [...nights.values()].reduce((b, x) => (!b || x.w > b.w || (x.w === b.w && x.l < b.l) ? x : b), null);
    // the longest run of set wins (a set without a result doesn't break it)
    let run = 0, streak = 0;
    sets.forEach(s => { if (s.result === 'won') { run++; streak = Math.max(streak, run); } else if (s.result === 'lost' || s.result === 'draw') run = 0; });
    // won after losing the first game
    const comebacks = sets.filter(s => s.result === 'won' && Array.isArray(s.games) && s.games.length && s.games[0].w === 0).length;
    const hour = mode(sets.map(s => String(new Date(s.at).getHours())));
    const main = mode(sets.map(s => s.myChar)), faced = mode(sets.map(s => s.oppChar));
    const game = mode(sets.map(s => s.rom));
    // the climb, in the game you played most
    let climb = null;
    if (game) {
        const ps = (points || []).filter(p => p && p.rom === game[0] && p.at >= from && p.at < to && p.elo > 0).sort((a, b) => a.at - b.at);
        if (ps.length >= 2) climb = { rom: game[0], from: ps[0].elo, to: ps[ps.length - 1].elo, peak: Math.max(...ps.map(p => p.elo)), rankFrom: ps[0].rank || 0, rankTo: ps[ps.length - 1].rank || 0 };
    }
    const named = sets.slice().reverse().find(s => s.rom === (game && game[0]) && (s.channel || s.game));
    return {
        from, to, sets: sets.length, won, lost, draw, rate: won + lost ? won / (won + lost) : null,
        hours: Math.round(secs / 3600 * 10) / 10, nights: nights.size, opponents: opps.length,
        rival, nemesis, victim, best, streak, comebacks,
        hour: hour ? +hour[0] : null, main: main ? { char: main[0], n: main[1] } : null, faced: faced ? { char: faced[0], n: faced[1] } : null,
        rom: game ? game[0] : '', game: named ? String(named.channel || named.game).replace(/\s*\([^)]*\)\s*$/, '').replace(/:\s.*$/, '') : '', climb
    };
}

// months (and years) with enough sets for a Wrapped, newest first -> [{ y, m (null = the year) }]
function periods(all, now) {
    const count = new Map();
    (all || []).forEach(s => { if (!s || !(s.at > 0)) return; const d = new Date(s.at), k = d.getFullYear() + '-' + d.getMonth(); count.set(k, (count.get(k) || 0) + 1); });
    const out = [], years = new Map();
    [...count.entries()].forEach(([k, n]) => { const [y, m] = k.split('-').map(Number); years.set(y, (years.get(y) || 0) + n); if (n >= MIN_SETS) out.push({ y, m }); });
    years.forEach((n, y) => { if (n >= MIN_SETS) out.push({ y, m: null }); });
    const t = now || Date.now();
    return out.filter(p => range(p.y, p.m)[0] <= t).sort((a, b) => (b.y - a.y) || ((b.m == null ? 12 : b.m) - (a.m == null ? 12 : a.m)));
}

module.exports = { id: 'wrapped', name: 'Fightcord Wrapped', start: (f) => start(f), wrapUp, periods, range, nightKey, MIN_SETS };

/* ================================================================== browser */

const mod = (id) => fc.modules.get(id);
const points = () => { try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'rank-history.json'), 'utf8')).points || []; } catch (e) { return []; } };
const monthName = (p) => p.m == null ? String(p.y) : new Date(p.y, p.m, 1).toLocaleDateString(fc.t.locale(), { month: 'long', year: 'numeric' });
const monthOnly = (p) => p.m == null ? String(p.y) : new Date(p.y, p.m, 1).toLocaleDateString(fc.t.locale(), { month: 'long' });
const hourName = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(fc.t.locale(), { hour: 'numeric' });
const face = (rom, ch) => { const mg = mod('matchup-guide'); const e = ch && mg && mg.find ? mg.find(rom, ch) : null; return e && e.face ? e.face : ''; };
const pct = (r) => r == null ? '—' : Math.round(r * 100) + '%';

// the slides that have something to say: [{ cls, html }]
function slides(w, p) {
    const me = fc.app.me() || T('You');
    const out = [];
    const S = (cls, html) => out.push({ cls, html });
    const when = monthOnly(p);
    S('intro', `<div class="k">${E(T('Fightcord Wrapped'))}</div><div class="big">${E(p.m == null ? T('Your {year}', { year: p.y }) : T('Your {month}', { month: when }))}</div>` +
        `<div class="sub">${E(T('{n} sets · {h} hours · {nights} nights', { n: fc.fmt.num(w.sets), h: w.hours, nights: w.nights }))}</div><div class="who">${fc.ui.avatar(me, { size: 72 })}<b>${E(me)}</b></div>`);
    S('record', `<div class="k">${E(T('Your record'))}</div><div class="big num"><span class="w">${w.won}</span><i>–</i><span class="l">${w.lost}</span></div>` +
        `<div class="sub">${E(T('{rate} of your sets won, against {n} different players', { rate: pct(w.rate), n: w.opponents }))}</div>`);
    if (w.main) {
        const f = face(w.rom, w.main.char);
        S('main', `<div class="k">${E(T('Your main'))}</div>${f ? `<div class="face"><img src="${E(f)}" alt="" onerror="this.parentNode.remove()"></div>` : ''}<div class="big">${E(w.main.char)}</div>` +
            `<div class="sub">${E(T('In {n} of your {total} sets', { n: w.main.n, total: w.sets }))}${w.faced ? ' · ' + E(T('you met {char} the most', { char: w.faced.char })) : ''}</div>`);
    }
    if (w.rival) S('rival', `<div class="k">${E(T('Your rival'))}</div><div class="who big">${fc.ui.avatar(w.rival.name, { size: 96 })}<b>${E(w.rival.name)}</b></div>` +
        `<div class="sub">${E(T('{n} sets together · {w}–{l}', { n: w.rival.n, w: w.rival.w, l: w.rival.l }))}</div>`);
    if (w.nemesis && (!w.rival || w.nemesis.name !== w.rival.name)) S('nemesis', `<div class="k">${E(T('Your nemesis'))}</div><div class="who big">${fc.ui.avatar(w.nemesis.name, { size: 96 })}<b>${E(w.nemesis.name)}</b></div>` +
        `<div class="sub">${E(T('{w}–{l}. Next month, maybe.', { w: w.nemesis.w, l: w.nemesis.l }))}</div>`);
    if (w.best && w.best.w >= 2) S('night', `<div class="k">${E(T('Your best night'))}</div><div class="big">${E(new Date(w.best.at).toLocaleDateString(fc.t.locale(), { weekday: 'long', day: 'numeric', month: 'long' }))}</div>` +
        `<div class="sub">${E(T('{w} sets won, {l} lost', { w: w.best.w, l: w.best.l }))}</div>`);
    if (w.streak >= 2) S('streak', `<div class="k">${E(T('Your longest streak'))}</div><div class="big num">${fc.ui.ic('flame', 'fill')}${w.streak}</div><div class="sub">${E(T('sets in a row, no losses'))}</div>`);
    if (w.climb && w.climb.to !== w.climb.from) {
        const up = w.climb.to > w.climb.from;
        S('climb ' + (up ? 'up' : 'down'), `<div class="k">${E(up ? T('You climbed') : T('A tough stretch'))}</div><div class="big num">${fc.fmt.num(w.climb.from)}<i>→</i>${fc.fmt.num(w.climb.to)}</div>` +
            `<div class="sub">${E(T('ELO in {game} · best {peak}', { game: w.game || w.rom, peak: fc.fmt.num(w.climb.peak) }))}</div>`);
    }
    if (w.comebacks) S('comeback', `<div class="k">${E(T('Comebacks'))}</div><div class="big num">${w.comebacks}</div><div class="sub">${E(T('sets won after losing the first game'))}</div>`);
    if (w.hour != null) S('hour', `<div class="k">${E(T('Prime time'))}</div><div class="big">${E(hourName(w.hour))}</div><div class="sub">${E(T('when you played the most'))}</div>`);
    S('outro', `<div class="k">${E(T('That was your {month}', { month: when }))}</div><div class="big">${E(T('GG'))}</div>` +
        `<div class="acts">${fc.ui.btn('Share card', { icon: 'image', act: 'wr-share' })}${fc.ui.btn('Close', { kind: 'sec', act: 'wr-close' })}</div>`);
    return out;
}

let ov = null;
const SLIDE_MS = 6000;
function open(p) {
    const all = fc.history.all();
    const [from, to] = range(p.y, p.m);
    const w = wrapUp(all, points(), from, to);
    if (!w) { fc.ui.toast(T('Not enough sets for a Wrapped yet'), { icon: 'info', sub: T('It needs {n} sets in that month', { n: MIN_SETS }) }); return; }
    close();
    const list = slides(w, p);
    let i = 0, timer = 0, held = false;
    const el = document.createElement('div');
    el.id = 'fcwrOverlay';
    el.innerHTML = `<div class="bars">${list.map(() => '<i><u></u></i>').join('')}</div><div class="stage"></div><span class="x" data-act="wr-close" title="${E(T('Close'))}">${fc.ui.icon('close')}</span>`;
    const show = (n) => {
        i = Math.max(0, Math.min(list.length - 1, n));
        const s = list[i];
        el.dataset.k = s.cls.split(' ')[0];
        el.querySelector('.stage').innerHTML = `<div class="slide ${s.cls}">${s.html}</div>`;
        el.querySelectorAll('.bars > i').forEach((b, k) => { b.className = k < i ? 'done' : k === i ? 'on' : ''; });
        clearTimeout(timer);
        if (i < list.length - 1) timer = setTimeout(() => { if (!held) show(i + 1); }, SLIDE_MS);
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
        else if (e.key === 'ArrowRight' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); show(i + 1); }
        else if (e.key === 'ArrowLeft') { e.stopPropagation(); show(i - 1); }
    };
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); held = true; });
    el.addEventListener('mouseup', () => { held = false; });
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = e.target.closest('[data-act]');
        if (a && a.dataset.act === 'wr-close') { close(); return; }
        if (a && a.dataset.act === 'wr-share') { close(); shareCard(w, p); return; }         // (the story sits over every modal)
        if (e.target.closest('.acts')) return;
        if (e.clientX < window.innerWidth / 3) show(i - 1); else show(i + 1);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(el);
    ov = { el, stop: () => { clearTimeout(timer); document.removeEventListener('keydown', onKey, true); } };
    show(0);
    if (cfg) { cfg.seen = cfg.seen || {}; cfg.seen[p.y + '-' + (p.m == null ? 'y' : p.m)] = Date.now(); store.save(); }
}
function close() {
    if (!ov) return;
    const o = ov;
    ov = null;
    o.stop();
    o.el.classList.add('out');
    setTimeout(() => o.el.remove(), 300);
}

/* ---------------------------------------------------------------- share card */

async function shareCard(w, p) {
    const st = mod('stats');
    if (!st || !st.shareImage || !st.draw) return;
    const { FONT, loadImg, rr, glow, fit } = st.draw;
    const draw = async (withArt) => {
        const W = 1200, H = 630;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d');
        const bg = x.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#1b1140'); bg.addColorStop(0.55, '#0d0f1f'); bg.addColorStop(1, '#2a0f2e');
        x.fillStyle = bg; x.fillRect(0, 0, W, H);
        glow(x, 1060, 90, 420, 'rgba(235,69,158,.35)');
        glow(x, 120, 620, 380, 'rgba(88,101,242,.35)');
        const br = mod('branding');
        const logo = await loadImg(br && br.LOGO);
        if (logo) x.drawImage(logo, 60, 48, 200, 200 * logo.height / logo.width);
        const main = withArt && w.main ? await loadImg(face(w.rom, w.main.char)) : null;
        if (main) {
            x.save(); rr(x, 900, 60, 240, 320, 18); x.clip();
            const s = Math.max(240 / main.width, 320 / main.height);
            x.drawImage(main, 900 + (240 - main.width * s) / 2, 60, main.width * s, main.height * s);
            x.restore();
            x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 2; rr(x, 900, 60, 240, 320, 18); x.stroke();
        }
        const tw = main ? 800 : 1080;
        x.textBaseline = 'alphabetic';
        x.font = '800 22px ' + FONT; x.fillStyle = '#ff73fa';
        x.fillText((T('Wrapped') + '  ·  ' + monthName(p)).toUpperCase(), 60, 150);
        x.font = '900 64px ' + FONT; x.fillStyle = '#ffffff';
        x.fillText(fit(x, fc.app.me() || 'Me', tw - 60), 60, 218);
        x.font = '500 24px ' + FONT; x.fillStyle = '#c9cdf0';
        x.fillText(fit(x, w.game ? w.game + (w.main ? '  ·  ' + w.main.char : '') : '', tw - 60), 60, 258);
        const tiles = [
            [w.won + '–' + w.lost, T('RECORD'), w.won >= w.lost ? '#2dd48f' : '#f24b5a'],
            [String(w.sets), T('SETS'), '#ffffff'],
            [String(w.hours), T('HOURS'), '#ffffff'],
            [w.streak ? w.streak + 'W' : '—', T('BEST STREAK'), '#f5b83d']
        ];
        const tW = main ? 196 : 258, gap = main ? 12 : 18;
        tiles.forEach(([v, label, col], k) => {
            const px = 60 + k * (tW + gap), py = 290;
            rr(x, px, py, tW, 112, 16); x.fillStyle = 'rgba(255,255,255,.07)'; x.fill();
            x.font = '800 44px ' + FONT; x.fillStyle = col; x.fillText(fit(x, v, tW - 36), px + 18, py + 62);
            x.font = '700 14px ' + FONT; x.fillStyle = '#8a90b8'; x.fillText(label, px + 18, py + 94);
        });
        const lines = [];
        if (w.rival) lines.push([T('Rival'), w.rival.name + '  ' + w.rival.w + '–' + w.rival.l]);
        if (w.nemesis && (!w.rival || w.nemesis.name !== w.rival.name)) lines.push([T('Nemesis'), w.nemesis.name + '  ' + w.nemesis.w + '–' + w.nemesis.l]);
        if (w.best && w.best.w >= 2) lines.push([T('Best night'), new Date(w.best.at).toLocaleDateString(fc.t.locale(), { day: 'numeric', month: 'short' }) + '  ·  ' + T('{n} wins', { n: w.best.w })]);
        if (w.climb && w.climb.to !== w.climb.from) lines.push(['ELO', fc.fmt.num(w.climb.from) + ' → ' + fc.fmt.num(w.climb.to)]);
        lines.slice(0, 4).forEach(([k, v], n) => {
            const px = 60 + (n % 2) * 420, py = 452 + Math.floor(n / 2) * 66;
            x.font = '700 15px ' + FONT; x.fillStyle = '#8a90b8'; x.fillText(String(k).toUpperCase(), px, py);
            x.font = '700 24px ' + FONT; x.fillStyle = '#eef0ff'; x.fillText(fit(x, v, 400), px, py + 30);
        });
        x.font = '600 15px ' + FONT; x.fillStyle = '#6d7299'; x.textAlign = 'right';
        x.fillText('fightcord.pages.dev', W - 48, H - 32); x.textAlign = 'left';
        return c;
    };
    st.shareImage({ title: T('Share your Wrapped'), file: 'wrapped-' + p.y + (p.m == null ? '' : '-' + String(p.m + 1).padStart(2, '0')) + '.png', draw });
}

/* ------------------------------------------------------------- when to offer */

// in the first week of a month: last month's (and in January, last year's), once each
function offer() {
    if (!cfg.enabled || !cfg.offer || !fc.app.me()) return;
    const d = new Date();
    if (d.getDate() > 7) return;
    const all = fc.history.all();
    const last = d.getMonth() === 0 ? { y: d.getFullYear() - 1, m: 11 } : { y: d.getFullYear(), m: d.getMonth() - 1 };
    const tries = [last];
    if (d.getMonth() === 0) tries.unshift({ y: d.getFullYear() - 1, m: null });
    cfg.offered = cfg.offered || {};
    for (const p of tries) {
        const key = p.y + '-' + (p.m == null ? 'y' : p.m);
        if (cfg.offered[key]) continue;
        const [from, to] = range(p.y, p.m);
        if (all.filter(s => s.at >= from && s.at < to).length < MIN_SETS) { cfg.offered[key] = -1; store.save(); continue; }
        cfg.offered[key] = Date.now();
        store.save();
        fc.ui.toast(p.m == null ? T('Your {year} Wrapped is ready', { year: p.y }) : T('Your {month} Wrapped is ready', { month: monthOnly(p) }), {
            icon: 'wrapped', ms: 20000, sub: T('Your sets, rivals and best nights, as a story'),
            actions: [{ label: T('Open'), fn: () => open(p) }]
        });
        return;
    }
}

// Stats → Wrapped: the months and years there's one for
function pickMenu(anchor) {
    const list = periods(fc.history.all(), Date.now()).slice(0, 14);
    if (!list.length) { fc.ui.toast(T('Not enough sets for a Wrapped yet'), { icon: 'info', sub: T('It needs {n} sets in that month', { n: MIN_SETS }) }); return; }
    fc.ui.menu(anchor, list.map(p => ({ label: monthName(p), icon: p.m == null ? 'star' : 'wrapped', fn: () => open(p) })), { side: 'bottom' });
}

const CSS = `
#fcwrOverlay { position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: var(--fc-z-top); overflow: hidden; cursor: pointer; user-select: none;
    font-family: 'gg sans', 'Noto Sans', 'Segoe UI', sans-serif; color: #fff; background: var(--fc-navy); transition: background .6s; animation: fcwrIn .35s ease-out both; }
#fcwrOverlay.out { opacity: 0; transition: opacity var(--fc-slow); }
@keyframes fcwrIn { from { opacity: 0; } }
#fcwrOverlay[data-k="intro"] { background: radial-gradient(ellipse at 30% 20%, #5865f2 0%, #1b1140 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="record"] { background: radial-gradient(ellipse at 70% 30%, #1f8b5a 0%, #0f2a22 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="main"] { background: radial-gradient(ellipse at 50% 30%, #eb459e 0%, #3a0f2e 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="rival"] { background: radial-gradient(ellipse at 30% 70%, #f0b232 0%, #3a2a0a 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="nemesis"] { background: radial-gradient(ellipse at 70% 70%, #da373c 0%, #3a0f12 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="night"] { background: radial-gradient(ellipse at 50% 20%, #7a5cff 0%, #1b1140 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="streak"] { background: radial-gradient(ellipse at 50% 60%, #ff6d00 0%, #3a1a00 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="climb"] { background: radial-gradient(ellipse at 40% 30%, #00b4d8 0%, #022a3a 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="comeback"] { background: radial-gradient(ellipse at 60% 40%, var(--fc-arc-win) 0%, #0f3a1f 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="hour"] { background: radial-gradient(ellipse at 50% 80%, #3a0ca3 0%, #12082e 55%, var(--fc-navy) 100%); }
#fcwrOverlay[data-k="outro"] { background: radial-gradient(ellipse at 50% 40%, #ff73fa 0%, #2a0f2e 50%, var(--fc-navy) 100%); }
#fcwrOverlay .bars { position: absolute; left: 24px; right: 24px; top: 18px; display: flex; }
#fcwrOverlay .bars > i { flex: 1; height: 4px; margin: 0 3px; border-radius: 2px; background: rgba(255,255,255,.25); overflow: hidden; }
#fcwrOverlay .bars > i > u { display: block; height: 100%; width: 0; background: #fff; }
#fcwrOverlay .bars > i.done > u { width: 100%; }
#fcwrOverlay .bars > i.on > u { animation: fcwrBar ${SLIDE_MS}ms linear both; }
#fcwrOverlay:active .bars > i.on > u { animation-play-state: paused; }
@keyframes fcwrBar { from { width: 0; } to { width: 100%; } }
#fcwrOverlay .x { position: absolute; right: 22px; top: 36px; display: flex; padding: 8px; border-radius: 50%; color: rgba(255,255,255,.8); }
#fcwrOverlay .x:hover { background: rgba(255,255,255,.12); color: #fff; }
#fcwrOverlay .stage { position: absolute; left: 0; right: 0; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center; padding: 0 8vw; }
#fcwrOverlay .slide { display: flex; flex-direction: column; align-items: center; text-align: center; max-width: 900px; }
#fcwrOverlay .slide > * { animation: fcwrRise .6s cubic-bezier(.2,1.2,.4,1) both; }
#fcwrOverlay .slide > *:nth-child(2) { animation-delay: .25s; }
#fcwrOverlay .slide > *:nth-child(3) { animation-delay: .6s; }
#fcwrOverlay .slide > *:nth-child(4) { animation-delay: .9s; }
@keyframes fcwrRise { from { opacity: 0; transform: translateY(calc(30px * var(--fc-move, 1))) scale(calc(1 - .08 * var(--fc-move, 1))); } }
#fcwrOverlay .k { font-size: 2.6vmin; font-weight: 800; letter-spacing: .3em; text-transform: uppercase; color: rgba(255,255,255,.75); }
#fcwrOverlay .big { margin-top: 2vmin; font-size: 11vmin; line-height: 1.05; font-weight: 900; font-style: italic; letter-spacing: -.02em; text-shadow: 0 1vmin 4vmin rgba(0,0,0,.45); }
#fcwrOverlay .big.num { display: flex; align-items: center; font-size: 16vmin; font-variant-numeric: tabular-nums; }
#fcwrOverlay .big.num i { margin: 0 2vmin; font-style: normal; opacity: .5; font-size: .6em; }
#fcwrOverlay .big.num .w { color: var(--fc-arc-win); } #fcwrOverlay .big.num .l { color: var(--fc-arc-lose); }
#fcwrOverlay .big.num .fc-ic { width: 12vmin; height: 12vmin; margin-right: 2vmin; color: #ffb300; }
#fcwrOverlay .sub { margin-top: 3vmin; font-size: 3vmin; font-weight: 600; color: rgba(255,255,255,.82); }
#fcwrOverlay .who { display: flex; flex-direction: column; align-items: center; margin-top: 4vmin; }
#fcwrOverlay .who b { margin-top: 1.6vmin; font-size: 3.4vmin; font-weight: 800; font-style: normal; }
#fcwrOverlay .who.big b { font-size: 9vmin; font-style: italic; }
#fcwrOverlay .face { width: 24vmin; height: 32vmin; margin-top: 3vmin; border-radius: 2vmin; overflow: hidden; box-shadow: 0 2vmin 6vmin rgba(0,0,0,.5), 0 0 0 .4vmin rgba(255,255,255,.2); }
#fcwrOverlay .face img { width: 100%; height: 100%; object-fit: cover; }
#fcwrOverlay .acts { display: flex; margin-top: 5vmin; }
#fcwrOverlay .acts .fc-btn { margin: 0 8px; }
`;

function start(f) {
    fc = f;
    store = fc.config('wrapped', { enabled: true, offer: true, offered: {}, seen: {} });
    cfg = store.data;
    fc.ui.style('fcwrStyle', CSS);
    fc.own(() => { fc.ui.style('fcwrStyle', null); close(); });
    fc.tick(offer, 30 * 60000, { delay: 45000 });
    fc.settings.block({
        id: 'wrapped', section: 'match', title: 'Fightcord Wrapped', hint: '— your month on Fightcade, as a story', store, order: 26,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Fightcord Wrapped', hint: 'Stats → Wrapped: any month or year with 5 sets or more' },
            { key: 'offer', type: 'switch', label: 'Tell me when last month’s is ready', hint: 'A pop-up in the first week of the month', show: (d) => d.enabled },
            { type: 'button', label: 'See your latest Wrapped', button: 'Open', act: 'open', show: (d) => d.enabled,
                onClick: () => { const p = periods(fc.history.all(), Date.now())[0]; if (p) { const st = mod('fightcord'); if (st && st.close) st.close(); open(p); } else fc.ui.toast(T('Not enough sets for a Wrapped yet'), { icon: 'info' }); } }
        ]
    });
    return api;
}

const api = {
    open: (p) => open(p),
    close: () => close(),
    pick: (anchor) => { if (cfg && cfg.enabled) pickMenu(anchor); },
    enabled: () => !!(cfg && cfg.enabled),
    _wrap: (y, m) => { const [a, b] = range(y, m); return wrapUp(fc.history.all(), points(), a, b); }
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
