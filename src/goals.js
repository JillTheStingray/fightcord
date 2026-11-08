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
 * 3.11: 3rd Strike goals too (parries, red parries, super arts, perfect rounds), counted inside
 * matches by fight-stats.js.
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
    streak:   { label: 'Win in a row', unit: N_('wins'), text: (g) => T('Win {n} in a row', { n: g.target }) },
    // counted inside 3rd Strike matches (fight-stats.js)
    parries:  { label: 'Parry', unit: N_('parries'), fight: 'parry', text: (g) => T(g.target === 1 ? 'Parry {n} time' : 'Parry {n} times', { n: g.target }) },
    reds:     { label: 'Red parry', unit: N_('red parries'), fight: 'red', text: (g) => T(g.target === 1 ? 'Red parry {n} time' : 'Red parry {n} times', { n: g.target }) },
    supers:   { label: 'Land super arts', unit: N_('super arts'), fight: 'super', text: (g) => T(g.target === 1 ? 'Land {n} super art' : 'Land {n} super arts', { n: g.target }) },
    perfects: { label: 'Win perfect rounds', unit: N_('rounds'), fight: 'perfect', text: (g) => T(g.target === 1 ? 'Win {n} perfect round' : 'Win {n} perfect rounds', { n: g.target }) }
};
const isFight = (type) => !!(TYPES[type] && TYPES[type].fight);
const SCOPES = { day: N_('today'), session: N_('this session'), week: N_('this week') };
const SUGGEST = [
    { type: 'wins', target: 5, scope: 'day' }, { type: 'minutes', target: 60, scope: 'day' },
    { type: 'beatRank', target: 2, scope: 'week', rank: 'A' }, { type: 'winrate', target: 10, scope: 'week', rate: 55 },
    { type: 'streak', target: 3, scope: 'session' }, { type: 'parries', target: 10, scope: 'day' }
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

// -> { value, target, frac, done, text, detail }; fights = fight-stats events [{ at, k }]
function evaluate(goal, allSets, at, clearedAt, fights) {
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
    else if (TYPES[type].fight) { const k = TYPES[type].fight; value = (fights || []).filter(e => e && e.k === k && e.at >= t0).length; }
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
const fights = () => { const m = fc.modules.get('fight-stats'); return m && m.events ? m.events() : []; };
const results = () => { const all = fc.history.all(), ev = fights(); return cfg.goals.map(g => ({ g, r: evaluate(g, all, Date.now(), clearedAt(), ev) })); };
const periodKey = (g) => g.scope + ':' + periodStart(g.scope, Date.now(), clearedAt());

// a goal just reached in this period: celebrate once
function check() {
    if (fc.app && !fc.app.me()) return;      // Fightcade's log-in screen: nothing to report yet
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
        let pill = actions.querySelector('.fcglPill');
        if (!o) { if (pill) pill.remove(); return; }
        if (!pill) {
            pill = document.createElement('div');
            pill.className = 'fcglPill';
            pill.addEventListener('mousedown', (e) => e.stopPropagation());
            pill.addEventListener('click', (e) => { e.stopPropagation(); togglePop(pill); });
            fc.ui.header.place(actions, pill, 'goals');
        }
        const html = hudHtml();
        if (pill.__html !== html) { pill.__html = html; pill.innerHTML = html; pill.title = T('{n} of {total} goals done', { n: o.done, total: o.total }); }
        pulse(pill);
        // joined to tonight's record (match-screens.js) as one strip
        const rec = actions.querySelector('.fcmsPill');
        if (rec) rec.classList.add('fcms-joined');
        pill.classList.toggle('fcgl-joined', !!rec);
    });
}

// the HUD (2.9): one thin bar per goal (up to 3, the rest in the list), next to tonight's record
function hudHtml() {
    const rs = results();
    const o = overall();
    return `<span class="fcglBars">${rs.slice(0, 3).map(({ g, r }) =>
        `<i class="${r.done ? 'done' : ''}" data-g="${E(g.id)}" title="${E(r.text + ' · ' + r.detail)}"><u style="width:${Math.round(Math.min(1, r.frac) * 100)}%"></u></i>`).join('')}</span>` +
        `<span class="fcglNum">${o.done}/${o.total}</span>`;
}

// a goal that moved since last time pulses; one that just finished flashes green
const lastFrac = {};
function pulse(pill) {
    results().slice(0, 3).forEach(({ g, r }) => {
        const before = lastFrac[g.id];
        lastFrac[g.id] = r.frac;
        if (before == null || r.frac <= before) return;
        const bar = pill.querySelector('.fcglBars > i[data-g="' + g.id + '"]');
        if (!bar) return;
        const cls = r.done ? 'win' : 'up';
        bar.classList.remove('up', 'win');
        void bar.offsetWidth;                         // restart the animation
        bar.classList.add(cls);
        setTimeout(() => bar.classList.remove(cls), 1600);
    });
}

function listHtml(small, max) {
    const all = results();
    if (!all.length) return '';
    const rs = max ? all.slice(0, max) : all;
    const more = all.length - rs.length;
    return rs.map(({ g, r }) => `<div class="fcglRow${r.done ? ' done' : ''}">${fc.ui.ring(r.frac, { size: small ? 30 : 36, stroke: 4, color: r.done ? 'var(--fc-success)' : 'var(--fc-accent)', label: r.done ? '✓' : Math.round(r.frac * 100) + '%' })}` +
        `<div class="tx"><b>${E(r.text)}</b><span>${E(T(SCOPES[g.scope]))} · ${E(r.detail)}</span></div></div>`).join('') +
        (more > 0 ? `<div class="fcglMore">${E(T('+{n} more', { n: more }))}</div>` : '');
}

// for the profile popout
function summaryHtml() {
    const o = overall();
    if (!o) return '';
    return `<div class="fcglSum"><span>${E(T('Goals'))}</span>${listHtml(true, 3)}</div>`;      // the top 3 (2.13)
}

let pop = null;
function togglePop(anchor) {
    if (pop) { pop.close(); return; }
    const box = document.createElement('div');
    box.className = 'fcglPop';
    const o = overall();
    box.innerHTML = fc.ui.popHead({ icon: 'target', title: T('Your goals'), sub: o ? E(T('{done} of {total} done', { done: o.done, total: o.total })) : '' }) +
        `<div class="fc-pb">${listHtml()}</div>` + fc.ui.popFoot('', fc.ui.btn('Edit goals', { kind: 'sec', size: 'sm', icon: 'edit', act: 'edit' }));
    box.addEventListener('click', (e) => {
        if (!e.target.closest('[data-act="edit"]')) return;
        if (pop) pop.close();
        const st = fc.modules.get('fightcord');
        if (st && st.open) st.open('goals');
    });
    const me = pop = fc.ui.popover(anchor, box, { width: 320, cls: 'fc-pop-card', onClose: () => { if (pop === me) pop = null; } });
}

/* ----------------------------------------------------------------- settings */

function blockHtml() {
    const rs = results();
    const opt = (k) => `<option value="${k}">${E(T(TYPES[k].label))}</option>`;
    const types = Object.keys(TYPES).filter(k => !isFight(k)).map(opt).join('') +
        `<optgroup label="${E(T('In 3rd Strike matches'))}">${Object.keys(TYPES).filter(isFight).map(opt).join('')}</optgroup>`;
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
        <div class="fc-note fcglFight" hidden>${E(T('3rd Strike only. Fightcord counts these during your matches by reading the game from outside, like a stream overlay. It only reads, so it can’t change the game or cause a desync.'))}</div>
        ${fightStatus()}
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
    if (evaluate(goal, fc.history.all(), Date.now(), clearedAt(), fights()).done) cfg.done[goal.id] = periodKey(goal);
    store.save();
    check();
}

function render(el) { el.innerHTML = blockHtml(); syncAdd(el); }
function syncAdd(el) {
    const type = el.querySelector('[data-f="type"]');
    if (!type) return;
    el.querySelector('[data-f="rank"]').hidden = type.value !== 'beatRank';
    el.querySelector('[data-f="rate"]').hidden = type.value !== 'winrate';
    const note = el.querySelector('.fcglFight');
    if (note) note.hidden = !isFight(type.value);
}

const wantsFight = () => !!(cfg && cfg.goals.some(g => isFight(g.type)));

// how the counting went last time, once you have a 3rd Strike goal
function fightStatus() {
    if (!wantsFight()) return '';
    const m = fc.modules.get('fight-stats');
    const st = m && m.status ? m.status() : null;
    if (!st) return `<div class="fc-note">${E(T('Parries and the rest are counted from your next 3rd Strike match.'))}</div>`;
    if (st.ok && st.msg === 'counted' && !st.n && st.rounds) {
        // 3.14.3: it read the match but saw nothing of yours -- that isn't "works"
        const them = st.theirs ? ' ' + fc.t.plural(st.theirs, 'It did see {n} from your opponent.', 'It did see {n} from your opponent.') : '';
        return `<div class="fc-note fcglWarn">${E(fc.t.plural(st.rounds, 'Fightcord watched {n} round of your last match but saw no parries, supers or perfect rounds from you.',
            'Fightcord watched {n} rounds of your last match but saw no parries, supers or perfect rounds from you.') + them)}</div>`;
    }
    if (st.ok) {
        const n = st.msg === 'counted' && st.n != null ? ' ' + fc.t.plural(st.n, '{n} counted in that match.', '{n} counted in that match.') : '';
        return `<div class="fc-note">${E(T('Counting works: last checked {when}.', { when: fc.fmt.ago(st.at) }) + n)}</div>`;
    }
    // 3.13.1: why nothing counted, in words (what PowerShell or the emulator said goes in the small print)
    const why = {
        side: fc.t.plural(st.n || 0, 'Fightcord read 3rd Strike, but couldn’t tell which player you were, so {n} wasn’t counted.',
            'Fightcord read 3rd Strike, but couldn’t tell which player you were, so {n} weren’t counted.'),
        norounds: T('Fightcord watched your last match but never saw a round being played, so nothing was counted.'),
        av: T('Your antivirus blocked the part of Fightcord that reads 3rd Strike, so nothing was counted. Allowing Fightcord there fixes it.'),
        open: T('Windows didn’t let Fightcord look at the emulator, so nothing was counted. Antivirus, or the emulator running as administrator, can cause this.'),
        ram: T('Fightcord couldn’t find 3rd Strike inside the emulator, so nothing was counted.'),
        compile: T('PowerShell couldn’t build the part of Fightcord that reads 3rd Strike, so nothing was counted.'),
        start: T('Fightcord couldn’t start PowerShell to read 3rd Strike, so nothing was counted.'),
        notready: T('Fightcord was still looking for 3rd Strike inside the emulator when your match ended, so nothing was counted.'),
        noemu: T('Fightcord never saw the emulator running during your last match, so nothing was counted.')
    }[st.msg] || T('Couldn’t read 3rd Strike during your last match, so nothing was counted.');
    return `<div class="fc-note fcglWarn">${E(why + ' ' + T('It tries again next match.'))}` +
        (st.detail ? `<small class="fcglWhy">${E(st.detail)}</small>` : '') + '</div>';
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
.fcglMore { margin-top: 4px; font-size: var(--fc-fs-sm); color: var(--fc-muted); }
.fcglPill { display: inline-flex; align-items: center; height: 32px; padding: 0 10px 0 6px; margin-right: 8px; border-radius: var(--fc-r1);
    background: var(--fc-btn); color: #fff; font: 600 var(--fc-fs-md)/32px var(--fc-font); cursor: pointer; user-select: none; }
.fcglPill:hover { background: var(--fc-btn-h); }
.fcglPill .fc-ring { margin-right: 6px; }
.fcglBars { display: inline-flex; flex-direction: column; justify-content: center; height: 32px; margin-right: 8px; }
.fcglBars > i { position: relative; display: block; width: 46px; height: 4px; margin: 1.5px 0; border-radius: 2px; background: var(--fc-tint-4); overflow: hidden; }
.fcglBars > i > u { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--fc-accent); transition: width .6s cubic-bezier(.2,.8,.2,1); }
.fcglBars > i.done > u { background: var(--fc-success); }
.fcglBars > i.up { animation: fcglUp 1.4s ease-out; }
.fcglBars > i.win { animation: fcglWin 1.5s ease-out; }
@keyframes fcglUp { 0% { box-shadow: 0 0 0 0 var(--fc-accent); } 30% { box-shadow: 0 0 10px 2px var(--fc-accent); } 100% { box-shadow: 0 0 0 0 transparent; } }
@keyframes fcglWin { 0%, 40% { box-shadow: 0 0 12px 3px var(--fc-success); transform: scaleY(1.6); } 100% { box-shadow: 0 0 0 0 transparent; transform: none; } }
html.fc-still .fcglBars > i { animation: none !important; }
.fcglNum { font-variant-numeric: tabular-nums; }
/* the HUD: tonight's record and the goals as one joined strip */
.fcglPill.fcgl-joined { margin-left: -8px; border-top-left-radius: 0; border-bottom-left-radius: 0; box-shadow: inset 1px 0 0 var(--fc-tint-3); }

.fcglRow { display: flex; align-items: center; padding: 6px 0; }
.fcglRow .fc-ring { flex: none; margin-right: 10px; }
.fcglRow .tx { flex: 1; min-width: 0; }
.fcglRow b { display: block; font-size: var(--fc-fs-md); font-weight: 600; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcglRow span { display: block; font-size: var(--fc-fs-sm); color: var(--fc-muted); }
.fcglRow.done b { color: var(--fc-success); }
.fcglList { margin: 6px 0; }
.fcglSuggest { display: flex; flex-wrap: wrap; margin: 8px 0 4px; }
.fcglSuggest .fc-chip { margin: 0 6px 6px 0; }
.fcglAdd > * { margin-right: 6px; height: 30px; font-size: var(--fc-fs-ui); }
.fcglAdd input[type="number"] { width: 70px; }
.fcglAdd [hidden], .fcglFight[hidden] { display: none; }
.fcglWarn { color: var(--fc-warning); }
.fcglWhy { display: block; margin-top: 4px; color: var(--fc-muted); font: var(--fc-fs-xs)/1.35 var(--fc-mono, monospace); word-break: break-word; }
.fcglSum { margin-top: 10px; }
.fcglSum > span { font: 600 var(--fc-fs-ui)/1.2 var(--fc-font); color: var(--fc-muted); }
.fcglSum .fcglRow { padding: 3px 0; }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('goals', { goals: [], notify: true, pill: true, summary: false, done: {}, summarized: 0 });
    // 2.13: the "Last session" pop-up is off by default; switch it off once for anyone still on the old default
    if (!store.data.v) { store.data.v = 2; if (store.data.summary === true) store.data.summary = false; store.save(); }
    cfg = store.data;
    if (!Array.isArray(cfg.goals)) cfg.goals = [];
    if (!cfg.done || typeof cfg.done !== 'object') cfg.done = {};
    fc.ui.style('fcglStyle', CSS);
    fc.own(() => { fc.ui.style('fcglStyle', null); document.querySelectorAll('.fcglPill').forEach(p => p.remove()); if (pop) pop.close(); });
    fc.settings.section('goals', 'Goals', 'target', 65);
    fc.settings.block({ id: 'goals', section: 'goals', order: 10, render: wire, refresh: render });
    fc.on('set:recorded', () => setTimeout(check, 50));
    fc.on('set:updated', () => setTimeout(check, 50));          // a result found late (3.7)
    fc.on('history:merged', check);
    let fightT = 0;                                      // a parry etc. (fight-stats.js): a few a second at most
    fc.on('fight:event', () => { clearTimeout(fightT); fightT = setTimeout(check, 300); });
    fc.watch(refreshPill, { selector: '.channelToolbar' });
    fc.tick(check, 60000);                         // a new day / week starts on its own
    // after you've logged in (not on Fightcade's log-in screen)
    const later = () => { if (fc.app.me()) { check(); lastSessionSummary(); } else setTimeout(later, 3000); };
    setTimeout(later, 8000);
    return api;
}

const api = {
    evaluate: (g, sets, at, cl) => evaluate(g, sets, at, cl),
    results: () => results(),
    summaryHtml: () => summaryHtml(),
    add: (g) => addGoal(g),
    wantsFight: () => wantsFight(),
    _check: () => check(),
    _summary: () => lastSessionSummary()
};

module.exports = { id: 'goals', name: 'Training goals', start, evaluate, periodStart, TYPES, isFight };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
