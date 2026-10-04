/**
 * Fightcord training goals
 *
 * Set yourself goals and watch them fill up as you play:
 *   win N sets · play N sets · beat N players ranked X or higher · play N minutes ·
 *   keep a win rate of Y% over N sets · win N in a row
 * each per day, per session or per week (days and sessions run 5 AM to 5 AM).
 *
 *   - a progress ring next to the 🏆 session pill (click it for the list)
 *   - a toast + chime the moment one is done
 *   - next time you play: a summary of your last session, with its share card
 *
 * Works from fc.history (sets recorded from 2.0 on carry the opponent's rank). Settings ->
 * Goals to add or remove them. Event: goal:done {goal, period}.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // goals-config.json

const DAY = 86400000;
// translated text (plain English in the unit tests, which run without Fightcade)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
T.plural = (n, one, many, v) => T(n === 1 ? one : many, Object.assign({ n }, v));
const N_ = (s) => s;
const TYPES = {
    wins:     { label: 'Win sets', unit: N_('sets'), text: (g) => T(g.target === 1 ? 'Win {n} set' : 'Win {n} sets', { n: g.target }) },
    sets:     { label: 'Play sets', unit: N_('sets'), text: (g) => T(g.target === 1 ? 'Play {n} set' : 'Play {n} sets', { n: g.target }) },
    beatRank: { label: 'Beat ranked players', unit: N_('players'), text: (g) => T(g.target === 1 ? 'Beat {n} player ranked {rank} or higher' : 'Beat {n} players ranked {rank} or higher', { n: g.target, rank: g.rank || 'B' }) },
    minutes:  { label: 'Play minutes', unit: N_('min'), text: (g) => T('Play {n} minutes', { n: g.target }) },
    winrate:  { label: 'Keep a win rate', unit: N_('sets'), text: (g) => T('Win {rate}%+ over {n} sets', { rate: g.rate || 60, n: g.target }) },
    streak:   { label: 'Win in a row', unit: N_('wins'), text: (g) => T('Win {n} in a row', { n: g.target }) }
};
const SCOPES = { day: N_('today'), session: N_('this session'), week: N_('this week') };
const SUGGEST = [
    { type: 'wins', target: 5, scope: 'day' }, { type: 'minutes', target: 60, scope: 'day' },
    { type: 'beatRank', target: 2, scope: 'week', rank: 'A' }, { type: 'winrate', target: 10, scope: 'week', rate: 55 },
    { type: 'streak', target: 3, scope: 'session' }
];

/* --------------------------------------------------------------- the maths */

const RANKS = ['', 'E', 'D', 'C', 'B', 'A', 'S'];

// where the period started (5 AM days; sessions can also be cleared by hand; weeks start Monday)
function periodStart(scope, at, clearedAt) {
    const d = new Date(at);
    const five = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5).getTime();
    const day = d.getHours() < 5 ? five - DAY : five;
    if (scope === 'week') {
        const wd = (new Date(day).getDay() + 6) % 7;        // Monday = 0
        return day - wd * DAY;
    }
    if (scope === 'session') return Math.max(day, +clearedAt || 0);
    return day;
}

function bestStreak(sets) {
    let best = 0, run = 0;
    sets.forEach(s => { if (s.result === 'won') { run++; best = Math.max(best, run); } else if (s.result) run = 0; });
    return best;
}

// -> { value, target, frac, done, text, detail }
function evaluate(goal, allSets, at, clearedAt) {
    const t0 = periodStart(goal.scope, at || Date.now(), clearedAt);
    const sets = (allSets || []).filter(s => (s.at || 0) >= t0).sort((a, b) => a.at - b.at);
    const target = Math.max(1, +goal.target || 1);
    const type = TYPES[goal.type] ? goal.type : 'wins';
    let value = 0, frac = 0, done = false, detail = '';
    if (type === 'wins') value = sets.filter(s => s.result === 'won').length;
    else if (type === 'sets') value = sets.length;
    else if (type === 'beatRank') {
        const min = Math.max(1, RANKS.indexOf(goal.rank || 'B'));
        value = new Set(sets.filter(s => s.result === 'won' && +s.oppRank >= min).map(s => String(s.opp || '').toLowerCase())).size;
    } else if (type === 'minutes') value = Math.floor(sets.reduce((n, s) => n + (+s.durSec || 0), 0) / 60);
    else if (type === 'streak') value = bestStreak(sets);
    else if (type === 'winrate') {
        const k = sets.filter(s => s.result === 'won' || s.result === 'lost');
        const w = k.filter(s => s.result === 'won').length;
        const rate = k.length ? w / k.length : 0;
        const need = (+goal.rate || 60) / 100;
        value = k.length;
        done = k.length >= target && rate >= need;
        frac = Math.min(1, k.length / target) * (rate >= need ? 1 : Math.max(0, rate / need));
        detail = T('{rate} over {n}/{target} sets', { rate: k.length ? Math.round(rate * 100) + '%' : '—', n: k.length, target });
        return { value, target, frac: done ? 1 : Math.min(0.99, frac), done, text: TYPES.winrate.text(goal), detail };
    }
    done = value >= target;
    frac = Math.min(1, value / target);
    detail = Math.min(value, target) + ' / ' + target + ' ' + T(TYPES[type].unit);
    return { value, target, frac, done, text: TYPES[type].text(goal), detail };
}

/* ------------------------------------------------------------------ state */

const E = (s) => fc.fmt.esc(s);
const clearedAt = () => { const ms = fc.modules.get('match-screens'); return ms && ms._config ? ms._config.sessionClearedAt : 0; };
const results = () => cfg.goals.map(g => ({ g, r: evaluate(g, fc.history.all(), Date.now(), clearedAt()) }));
const periodKey = (g) => g.scope + ':' + periodStart(g.scope, Date.now(), clearedAt());

// a goal just reached in this period: celebrate once
function check() {
    let changed = false;
    results().forEach(({ g, r }) => {
        const key = periodKey(g);
        if (r.done && cfg.done[g.id] !== key) {
            cfg.done[g.id] = key;
            changed = true;
            fc.emit('goal:done', { goal: g, period: key });
            if (cfg.notify) {
                fc.ui.toast(T('Goal done: {goal}', { goal: r.text + ' ' + T(SCOPES[g.scope]) }), { icon: 'trophy', kind: 'success', ms: 8000, sub: r.detail });
                fc.sound.play('success');
            }
        }
    });
    if (changed) store.save();
    refreshPill();
    fc.settings.refresh('goals');
}

/* --------------------------------------------------------- session summary */

// The first time you play after a session with 3+ sets: how it went, with its share card.
function lastSessionSummary() {
    if (!cfg.summary) return;
    const all = fc.history.all();
    if (!all.length) return;
    const nowKey = periodStart('day', Date.now(), 0);
    const prev = all.filter(s => periodStart('day', s.at, 0) < nowKey);
    if (!prev.length) return;
    const lastKey = periodStart('day', prev[prev.length - 1].at, 0);
    if (cfg.summarized === lastKey) return;
    const sets = prev.filter(s => periodStart('day', s.at, 0) === lastKey);
    cfg.summarized = lastKey;
    store.save();
    if (sets.length < 3) return;
    const r = fc.data.recordOf(sets);
    const goalsDone = cfg.goals.filter(g => g.scope !== 'week' && cfg.done[g.id] === g.scope + ':' + lastKey).length;
    const day = new Date(lastKey);
    const key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
    fc.ui.toast(T('Last session: {record} over {n} sets', { record: fc.fmt.wl(r), n: sets.length }), {
        icon: 'chart', ms: 15000,
        sub: day.toLocaleDateString(fc.t.locale(), { weekday: 'long', month: 'short', day: 'numeric' }) +
            (cfg.goals.length ? ' · ' + T(goalsDone === 1 ? '{n} goal reached' : '{n} goals reached', { n: goalsDone }) : ''),
        actions: [{ label: 'Share card', fn: () => { const st = fc.modules.get('stats'); if (st && st.share) st.share(key); } },
            { label: 'Stats', fn: () => { const st = fc.modules.get('stats'); if (st && st.open) st.open(); } }]
    });
}

/* --------------------------------------------------------------------- pill */

function overall() {
    const rs = results();
    if (!rs.length) return null;
    return { done: rs.filter(x => x.r.done).length, total: rs.length, frac: rs.reduce((n, x) => n + x.r.frac, 0) / rs.length };
}

function refreshPill() {
    const o = cfg.pill ? overall() : null;
    document.querySelectorAll('.channelToolbar .channelActions').forEach(actions => {
        let pill = actions.querySelector(':scope > .fcglPill');
        if (!o) { if (pill) pill.remove(); return; }
        if (!pill) {
            pill = document.createElement('div');
            pill.className = 'fcglPill';
            pill.addEventListener('mousedown', (e) => e.stopPropagation());
            pill.addEventListener('click', (e) => { e.stopPropagation(); togglePop(pill); });
            const after = actions.querySelector(':scope > .fcmsPill');
            if (after) after.insertAdjacentElement('afterend', pill); else actions.insertBefore(pill, actions.firstChild);
        }
        const html = fc.ui.ring(o.frac, { size: 22, stroke: 3, color: o.done === o.total ? 'var(--fc-success)' : 'var(--fc-accent)' }) + `<span>${o.done}/${o.total}</span>`;
        if (pill.__html !== html) { pill.__html = html; pill.innerHTML = html; pill.title = T('{n} of {total} goals done', { n: o.done, total: o.total }); }
    });
}

function listHtml(small) {
    const rs = results();
    if (!rs.length) return '';
    return rs.map(({ g, r }) => `<div class="fcglRow${r.done ? ' done' : ''}">${fc.ui.ring(r.frac, { size: small ? 30 : 36, stroke: 4, color: r.done ? 'var(--fc-success)' : 'var(--fc-accent)', label: r.done ? '✓' : Math.round(r.frac * 100) + '%' })}` +
        `<div class="tx"><b>${E(r.text)}</b><span>${E(T(SCOPES[g.scope]))} · ${E(r.detail)}</span></div></div>`).join('');
}

// for the profile popout
function summaryHtml() {
    const o = overall();
    if (!o) return '';
    return `<div class="fcglSum"><span>${E(T('Goals'))}</span>${listHtml(true)}</div>`;
}

let pop = null;
function togglePop(anchor) {
    if (pop) { pop.close(); return; }
    const box = document.createElement('div');
    box.className = 'fcglPop';
    box.innerHTML = `<div class="h">${E(T('Your goals'))}</div>${listHtml()}<div class="f">${fc.ui.btn('Edit goals', { kind: 'sec', size: 'sm', icon: 'edit', act: 'edit' })}</div>`;
    box.addEventListener('click', (e) => {
        if (!e.target.closest('[data-act="edit"]')) return;
        if (pop) pop.close();
        const st = fc.modules.get('fightcord');
        if (st && st.open) st.open('goals');
    });
    const me = pop = fc.ui.popover(anchor, box, { width: 320, onClose: () => { if (pop === me) pop = null; } });
}

/* ----------------------------------------------------------------- settings */

function blockHtml() {
    const rs = results();
    const types = Object.keys(TYPES).map(k => `<option value="${k}">${E(T(TYPES[k].label))}</option>`).join('');
    const scopes = Object.keys(SCOPES).map(k => `<option value="${k}">${E(T(SCOPES[k]))}</option>`).join('');
    return `<div class="fc-set-title">${E(T('Training goals'))} <small>— ${E(T('days and sessions run 5 AM to 5 AM'))}</small></div>
        ${rs.length ? `<div class="fcglList">${rs.map(({ g, r }) => `<div class="fcglRow${r.done ? ' done' : ''}">${fc.ui.ring(r.frac, { size: 36, stroke: 4, color: r.done ? 'var(--fc-success)' : 'var(--fc-accent)', label: r.done ? '✓' : Math.round(r.frac * 100) + '%' })}` +
            `<div class="tx"><b>${E(r.text)}</b><span>${E(T(SCOPES[g.scope]))} · ${E(r.detail)}</span></div>${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'trash', title: 'Remove this goal', attrs: `data-del="${E(g.id)}"` })}</div>`).join('')}</div>`
            : `<div class="fc-note">${E(T('No goals yet. Pick one below or make your own.'))}</div>`}
        <div class="fcglSuggest">${SUGGEST.filter(s => !cfg.goals.some(g => g.type === s.type && g.scope === s.scope)).map((s, i) =>
            fc.ui.chip('+ ' + TYPES[s.type].text(s) + ' ' + T(SCOPES[s.scope]), { act: 'sug' + SUGGEST.indexOf(s) })).join('')}</div>
        <div class="fc-field fcglAdd"><select class="fc-select" data-f="type">${types}</select>
            <input class="fc-input" type="number" min="1" max="999" value="5" data-f="target" title="${E(T('How many'))}">
            <select class="fc-select" data-f="rank" title="${E(T('Rank or higher'))}" hidden>${['S', 'A', 'B', 'C', 'D'].map(r => `<option${r === 'B' ? ' selected' : ''}>${r}</option>`).join('')}</select>
            <input class="fc-input" type="number" min="10" max="100" value="60" data-f="rate" title="${E(T('Win rate %'))}" hidden>
            <select class="fc-select" data-f="scope">${scopes}</select>${fc.ui.btn('Add', { kind: 'success', size: 'sm', icon: 'plus', act: 'add' })}</div>
        <label class="fc-field"><span class="fc-field-text"><b>${E(T('Pop-up when a goal is done'))}</b><small>${E(T('With a chime'))}</small></span><input type="checkbox" class="fc-switch-in" data-opt="notify"${cfg.notify ? ' checked' : ''}><i class="fc-switch"></i></label>
        <label class="fc-field"><span class="fc-field-text"><b>${E(T('Ring by the session pill'))}</b></span><input type="checkbox" class="fc-switch-in" data-opt="pill"${cfg.pill ? ' checked' : ''}><i class="fc-switch"></i></label>
        <label class="fc-field"><span class="fc-field-text"><b>${E(T('Last-session summary'))}</b><small>${E(T('The first time you play after a session, with its share card'))}</small></span><input type="checkbox" class="fc-switch-in" data-opt="summary"${cfg.summary ? ' checked' : ''}><i class="fc-switch"></i></label>`;
}

function addGoal(g) {
    const goal = { id: 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e3), type: g.type, target: Math.max(1, Math.min(999, +g.target || 1)), scope: SCOPES[g.scope] ? g.scope : 'day' };
    if (g.type === 'beatRank') goal.rank = g.rank || 'B';
    if (g.type === 'winrate') goal.rate = Math.max(10, Math.min(100, +g.rate || 60));
    cfg.goals.push(goal);
    // already reached in this period: no "done" pop-up for something you didn't just do
    if (evaluate(goal, fc.history.all(), Date.now(), clearedAt()).done) cfg.done[goal.id] = periodKey(goal);
    store.save();
    check();
}

function render(el) { el.innerHTML = blockHtml(); syncAdd(el); }
function syncAdd(el) {
    const type = el.querySelector('[data-f="type"]');
    if (!type) return;
    el.querySelector('[data-f="rank"]').hidden = type.value !== 'beatRank';
    el.querySelector('[data-f="rate"]').hidden = type.value !== 'winrate';
}

function wire(el) {
    render(el);
    el.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.opt) { cfg[t.dataset.opt] = t.checked; store.save(); refreshPill(); }
        else if (t.dataset.f === 'type') syncAdd(el);
    });
    el.addEventListener('click', (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { cfg.goals = cfg.goals.filter(g => g.id !== del.dataset.del); store.data.goals = cfg.goals; delete cfg.done[del.dataset.del]; store.save(); check(); return; }
        const a = e.target.closest('[data-act]');
        const act = a && a.getAttribute('data-act');
        if (!act) return;
        if (act.indexOf('sug') === 0) addGoal(SUGGEST[+act.slice(3)]);
        else if (act === 'add') {
            const v = (f) => el.querySelector('[data-f="' + f + '"]').value;
            addGoal({ type: v('type'), target: v('target'), scope: v('scope'), rank: v('rank'), rate: v('rate') });
        }
    });
    el.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') e.stopPropagation(); }, true);
}

const CSS = `
.fcglPill { display: inline-flex; align-items: center; height: 32px; padding: 0 10px 0 6px; margin-right: 8px; border-radius: var(--fc-r1);
    background: var(--fc-btn); color: #fff; font: 600 14px/32px var(--fc-font); cursor: pointer; user-select: none; }
.fcglPill:hover { background: var(--fc-btn-h); }
.fcglPill .fc-ring { margin-right: 6px; }
.fcglPop .h { margin-bottom: 6px; font-size: 16px; font-weight: 700; color: var(--fc-head); }
.fcglPop .f { display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--fc-divider); }
.fcglRow { display: flex; align-items: center; padding: 6px 0; }
.fcglRow .fc-ring { flex: none; margin-right: 10px; }
.fcglRow .tx { flex: 1; min-width: 0; }
.fcglRow b { display: block; font-size: 14px; font-weight: 600; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcglRow span { display: block; font-size: 12px; color: var(--fc-muted); }
.fcglRow.done b { color: var(--fc-success); }
.fcglList { margin: 6px 0; }
.fcglSuggest { display: flex; flex-wrap: wrap; margin: 8px 0 4px; }
.fcglSuggest .fc-chip { margin: 0 6px 6px 0; }
.fcglAdd > * { margin-right: 6px; height: 30px; font-size: 13px; }
.fcglAdd input[type="number"] { width: 70px; }
.fcglAdd [hidden] { display: none; }
.fcglSum { margin-top: 10px; }
.fcglSum > span { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--fc-muted); }
.fcglSum .fcglRow { padding: 3px 0; }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('goals', { goals: [], notify: true, pill: true, summary: true, done: {}, summarized: 0 });
    cfg = store.data;
    if (!Array.isArray(cfg.goals)) cfg.goals = [];
    if (!cfg.done || typeof cfg.done !== 'object') cfg.done = {};
    fc.ui.style('fcglStyle', CSS);
    fc.own(() => { fc.ui.style('fcglStyle', null); document.querySelectorAll('.fcglPill').forEach(p => p.remove()); if (pop) pop.close(); });
    fc.settings.section('goals', 'Goals', 'target', 65);
    fc.settings.block({ id: 'goals', section: 'goals', order: 10, render: wire, refresh: render });
    fc.on('set:recorded', () => setTimeout(check, 50));
    fc.on('history:merged', check);
    fc.watch(refreshPill, { selector: '.channelToolbar' });
    fc.tick(check, 60000);                         // a new day / week starts on its own
    setTimeout(() => { check(); lastSessionSummary(); }, 8000);
    return api;
}

const api = {
    evaluate: (g, sets, at, cl) => evaluate(g, sets, at, cl),
    results: () => results(),
    summaryHtml: () => summaryHtml(),
    add: (g) => addGoal(g),
    _check: () => check(),
    _summary: () => lastSessionSummary()
};

module.exports = { id: 'goals', name: 'Training goals', start, evaluate, periodStart, TYPES };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
