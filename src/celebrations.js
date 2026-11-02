/**
 * Fightcord celebrations (3.9): a small moment for the good stuff, only on your screen
 *
 *   - a win streak of 3, 5 or 10 (then every 5) in a session, and your name burns while it lasts
 *   - a new best ELO in a game (progress.js: elo:best)
 *   - a goal done (goals.js: goal:done)
 *   - a badge earned (100 / 500 / 1,000 sets, a 5 / 10 / 20 set win streak): the full-screen one
 *   - your first set win against someone who had beaten you 3 times or more
 *
 * One per set (the biggest), never mid-match: they wait for the result screen to close. Rank-ups have
 * their own full-screen moment (progress.js), and a set that ranked you up gets nothing else.
 */
'use strict';

let fc = null;
let store = null, cfg = null;
const N_ = (s) => s;
const T = (s, v) => fc.t(s, v);
const E = (s) => fc.fmt.esc(s);
const lc = (s) => String(s || '').toLowerCase();

/* ------------------------------------------------------------------ the rules */

// the bigger moment wins when one set brings several
const SIZE = { badge: 50, nemesis: 40, elo: 30, streak: 20, goal: 10 };
const STREAK_AT = (n) => n === 3 || n === 5 || n === 10 || (n > 10 && n % 5 === 0);

// wins in a row at the end of these sets (a set with no result doesn't break it, a loss or draw does)
function winRun(sets) {
    let n = 0;
    for (let i = (sets || []).length - 1; i >= 0; i--) {
        const r = sets[i] && sets[i].result;
        if (r === 'won') n++;
        else if (r === 'lost' || r === 'draw') break;
    }
    return n;
}
const streakMoment = (session) => { const n = winRun(session); return STREAK_AT(n) ? { kind: 'streak', n } : null; };

// your first set win against someone who had beaten you 3+ times (and never lost to you)
function nemesisMoment(before, set) {
    if (!set || set.result !== 'won' || !set.opp) return null;
    const vs = (before || []).filter(s => s && lc(s.opp) === lc(set.opp));
    const lost = vs.filter(s => s.result === 'lost').length;
    return lost >= 3 && !vs.some(s => s.result === 'won') ? { kind: 'nemesis', opp: set.opp, lost } : null;
}

// a badge you didn't have before this set
function badgeMoment(before, after) {
    const id = (after || []).find(b => (before || []).indexOf(b) < 0);
    return id ? { kind: 'badge', id } : null;
}

// everything one finished set is worth, the biggest first. c = { set, before (the sets before it),
// session (tonight's, with it), badgesBefore, badgesAfter, on: { streak, nemesis, badge } }
function momentsFor(c) {
    const on = c.on || {}, out = [];
    if (on.badge !== false) { const b = badgeMoment(c.badgesBefore, c.badgesAfter); if (b) out.push(b); }
    if (on.nemesis !== false) { const n = nemesisMoment(c.before, c.set); if (n) out.push(n); }
    if (on.streak !== false) { const s = streakMoment(c.session); if (s) out.push(s); }
    return out.sort((a, b) => SIZE[b.kind] - SIZE[a.kind]);
}

module.exports = { id: 'celebrations', name: 'Celebrations', start: (f) => start(f), winRun, streakMoment, nemesisMoment, badgeMoment, momentsFor, SIZE };

/* ================================================================== browser */

const mod = (id) => fc.modules.get(id);
const clearedAt = () => { const ms = mod('match-screens'); return ms && ms._config ? ms._config.sessionClearedAt : 0; };
const sessionSets = () => fc.history.session(Date.now(), clearedAt());
// your set and streak badges (the leaderboard ones don't come from a set)
const badges = (sets) => { const P = mod('presence'); return P && P.badgesFrom ? P.badgesFrom(sets, 0) : []; };

// what's waiting to be shown: moments collected for a moment after a set, the biggest goes out
let pending = [], collectTimer = 0, waitTimer = 0, rankedUpAt = 0, lastShown = 0;
// in a match right now (Fightcade's own "playing")
const playing = () => { const me = fc.app.me(), u = me && fc.app.users()[me]; return !!(u && u.playing && u.playing.quarkId); };
const done = new Set();                      // sets already looked at (a late result comes back as set:updated)

function onSet(set) {
    if (!cfg.enabled || !set || !set.result) return;          // no result yet: set:updated brings it
    const key = set.quark || String(set.at);
    if (done.has(key)) return;
    done.add(key);
    const all = fc.history.all(), before = all.filter(s => s !== set && (s.quark ? s.quark !== set.quark : true));
    momentsFor({ set, before, session: sessionSets(), badgesBefore: badges(before), badgesAfter: badges(all), on: cfg })
        .forEach(m => add(m));
    hot();
}

function add(m) {
    pending.push(m);
    clearTimeout(collectTimer);
    collectTimer = setTimeout(flush, 3000);      // a goal or a rank-up from the same set comes in right after
}

// the biggest one, once nothing is in the way: no match, no result screen, Fightcade in front
function flush() {
    clearTimeout(waitTimer);
    if (!pending.length) return;
    if (Date.now() - rankedUpAt < 30000) { pending = []; return; }        // the rank-up had its moment
    const t0 = pending.t0 || (pending.t0 = Date.now());
    const busy = playing() || document.getElementById('fcmsOverlay') || document.getElementById('fcCeleb') || !document.hasFocus() || document.hidden;
    if (busy) {
        if (Date.now() - t0 > 5 * 60000) { pending = []; return; }
        waitTimer = setTimeout(flush, 1000);
        return;
    }
    const m = pending.sort((a, b) => SIZE[b.kind] - SIZE[a.kind])[0];
    pending = [];
    show(m);
}

const FIRE = ['#ff3d00', '#ffb300', '#ff6d00', '#ffca28', '#ffffff'];
function show(m) {
    lastShown = Date.now();
    if (m.kind === 'badge') {
        const P = mod('presence'), b = P && P.BADGES && P.BADGES[m.id];
        if (!b) return;
        fc.ui.celebrate({
            big: T('BADGE EARNED'), glow: '#f0b232', colors: ['#f0b232', '#fff3c4', '#ffffff', '#5865f2'], bigSize: '11vmin',
            mid: `<div class="fcclBadge">${fc.ui.icon(b.icon, 'fill')}<b>${E(T(b.label))}</b></div>`,
            sub: T('On your profile for other Fightcord players')
        });
        return;
    }
    if (m.kind === 'nemesis') {
        fc.ui.celebrate({ small: true, icon: 'sword', glow: '#eb459e', colors: ['#eb459e', '#5865f2', '#ffffff', '#fee75c'],
            big: T('Nemesis down'), mid: E(m.opp), sub: T('Your first set win vs them, after {n} losses', { n: m.lost }) });
        return;
    }
    if (m.kind === 'streak') {
        fc.ui.celebrate({ small: true, icon: 'flame', glow: '#ff6d00', colors: FIRE,
            big: T('{n} WIN STREAK', { n: m.n }), sub: m.n === 3 ? T('Your name burns until you drop a set') : T('Tonight, in a row') });
        return;
    }
    if (m.kind === 'elo') {
        const c = fc.ui.celebrate({ small: true, icon: 'trend', glow: '#23a55a', colors: ['#23a55a', '#57f287', '#ffffff', '#fee75c'],
            big: T('New best ELO'), mid: `<span class="fcclNum">${E(fc.fmt.num(m.prev))}</span>`, sub: gameName(m.rom) });
        const num = c && c.el && c.el.querySelector('.fcclNum');
        if (num) countUp(num, m.prev, m.elo, 1200);
        return;
    }
    if (m.kind === 'goal') {
        const G = mod('goals'), ty = G && G.TYPES && m.goal && G.TYPES[m.goal.type];
        fc.ui.celebrate({ small: true, quiet: true, icon: 'target', glow: '#5865f2', colors: ['#5865f2', '#57f287', '#ffffff', '#eb459e'],
            big: T('Goal done'), sub: ty ? ty.text(m.goal) : '' });
    }
}

function countUp(el, from, to, ms) {
    const t0 = Date.now();
    const step = () => {
        if (!el.isConnected) return;
        const k = Math.min(1, (Date.now() - t0) / ms), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fc.fmt.num(Math.round(from + (to - from) * e));
        if (k < 1) requestAnimationFrame(step);
    };
    setTimeout(step, 400);
}

function gameName(rom) {
    const s = fc.history.all().slice().reverse().find(x => x.rom === rom && (x.channel || x.game));
    return s ? String(s.channel || s.game).replace(/\s*\([^)]*\)\s*$/, '') : rom || '';
}

// your name burns while you're on a streak of 3+ tonight (only on your screen)
function hot() {
    const me = fc.app.me();
    const on = cfg.enabled && cfg.streak && cfg.hotName && me && winRun(sessionSets()) >= 3;
    if (!on) { fc.ui.style('fcclHot', null); return; }
    const q = '"' + String(me).replace(/["\\]/g, '\\$&') + '" i';
    fc.ui.style('fcclHot', `
.messageWrapper[data-current-user=${q}] header .author, [data-current-user=${q}] .playerName, #l3Panel .l3Me .l3Who b {
    background: linear-gradient(90deg, #ff3d00, #ffb300, #ff6d00, #ffca28, #ff3d00) 0 0 / 200% 100%; -webkit-background-clip: text; background-clip: text;
    color: transparent !important; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 4px rgba(255,109,0,.5)); animation: fcclFire 2.4s linear infinite; }
@keyframes fcclFire { to { background-position: -200% 0; } }`);
}

const CSS = `
#fcCeleb .fcclBadge { display: flex; flex-direction: column; align-items: center; color: #f0b232; }
#fcCeleb .fcclBadge .fc-ic { width: 12vmin; height: 12vmin; filter: drop-shadow(0 0 3vmin rgba(240,178,50,.7)); animation: fcCelebPunch .6s .4s cubic-bezier(.2,1.7,.4,1) both; }
#fcCeleb .fcclBadge b { margin-top: 2vmin; font-size: 4vmin; font-weight: 800; color: #fff; }
#fcCelebS .fcclNum { font-size: var(--fc-fs-2xl); font-weight: 900; font-variant-numeric: tabular-nums; }
`;

function start(f) {
    fc = f;
    store = fc.config('celebrations', { enabled: true, streak: true, hotName: true, elo: true, goal: true, badge: true, nemesis: true });
    cfg = store.data;
    fc.ui.style('fcclStyle', CSS);
    fc.own(() => { fc.ui.style('fcclStyle', null); fc.ui.style('fcclHot', null); clearTimeout(collectTimer); clearTimeout(waitTimer); });
    fc.on('set:recorded', (s) => setTimeout(() => onSet(s), 30));
    fc.on('set:updated', (s) => setTimeout(() => onSet(s), 30));
    fc.on('rank:changed', (r) => { if (r && r.to > r.from) rankedUpAt = Date.now(); });
    // a best ELO comes a minute after the set (progress.js asks then): its own moment, unless one just played
    fc.on('elo:best', (b) => { if (cfg.enabled && cfg.elo && b && Date.now() - lastShown > 20000) add({ kind: 'elo', rom: b.rom, elo: b.elo, prev: b.prev }); });
    fc.on('goal:done', (g) => { if (cfg.enabled && cfg.goal && g) add({ kind: 'goal', goal: g.goal }); });
    fc.tick(hot, 60000);             // (one style rule: it reaches rows drawn later by itself)
    fc.settings.block({
        id: 'celebrations', section: 'match', title: 'Celebrations', hint: '— small moments for the good stuff, only on your screen', store, order: 25,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Celebrations', hint: 'One per set at most, and never during a match', onChange: () => hot() },
            { key: 'streak', type: 'switch', label: 'Win streaks', hint: '3, 5 and 10 sets in a row in a session', show: (d) => d.enabled, onChange: () => hot() },
            { key: 'hotName', type: 'switch', label: 'My name burns during a streak', hint: 'In chat and the member list, while you’re on 3 or more wins in a row (only you see it)', show: (d) => d.enabled && d.streak, onChange: () => hot() },
            { key: 'elo', type: 'switch', label: 'A new best ELO', hint: 'Above your best real ELO in that game', show: (d) => d.enabled },
            { key: 'goal', type: 'switch', label: 'Goals done', show: (d) => d.enabled },
            { key: 'badge', type: 'switch', label: 'Badges earned', hint: '100, 500 and 1,000 sets, and long win streaks', show: (d) => d.enabled },
            { key: 'nemesis', type: 'switch', label: 'Beating a nemesis', hint: 'Your first set win against someone who had beaten you 3 times or more', show: (d) => d.enabled },
            { type: 'button', label: 'Preview a celebration', button: 'Preview', act: 'preview', show: (d) => d.enabled, onClick: () => show({ kind: 'streak', n: 3 }) }
        ]
    });
    return api;
}

const api = {
    // the harness: any moment, now
    _show: (m) => show(m),
    _onSet: (s) => onSet(s),
    _flush: () => flush()
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
