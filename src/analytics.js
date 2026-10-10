/**
 * Fightcord match analytics
 *
 * An "Analytics" tab on the Stats page: your win rate broken down by opponent rank, the rank
 * gap, ping, hour of day and weekday (a heatmap), first-to length, game and where a set falls
 * in your session -- plus a tilt check (how you do after losing twice in a row) and plain-
 * language insights ("you play best vs B-ranks under 100 ms").
 *
 * Works from fc.history. Sets recorded from 2.0 on carry the ranks, ping and FT; imported or
 * older sets only count where they have the data. Optional: a "take a break?" nudge after
 * three losses in a row.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // analytics-config.json

const RANKS = ['S', 'A', 'B', 'C', 'D', 'E'];
const RANK_OF = (n) => ['', 'E', 'D', 'C', 'B', 'A', 'S'][+n || 0] || '';
// translated text (plain English in the unit tests, which run without Fightcade)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
T.plural = (n, one, many, v) => T(n === 1 ? one : many, Object.assign({ n }, v));
const N_ = (s) => s;
const DAYS = [N_('Mon'), N_('Tue'), N_('Wed'), N_('Thu'), N_('Fri'), N_('Sat'), N_('Sun')];
const PING = [['<60', 0, 60], ['60–100', 60, 100], ['100–150', 100, 150], ['150+', 150, 1e9]];
const MIN_N = 5;                       // a bucket needs this many results before it's trusted

/* --------------------------------------------------------------- the maths */

const known = (s) => s && (s.result === 'won' || s.result === 'lost');
function rec() { return { w: 0, l: 0, n: 0, rate: null }; }
function add(r, s) { if (s.result === 'won') r.w++; else r.l++; r.n++; r.rate = r.w / r.n; }

// A session runs 5 AM -> 5 AM
function sessionKey(at) {
    const d = new Date(at);
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function pingBucket(ms) {
    if (typeof ms !== 'number' || !(ms > 0)) return '';
    const b = PING.find(p => ms >= p[1] && ms < p[2]);
    return b ? b[0] : '';
}

// every breakdown at once, from sets in any order
function analyze(input) {
    const sets = (input || []).filter(known).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    const out = {
        total: rec(), byOppRank: {}, byGap: {}, byPing: {}, byHour: [], heat: [], byFt: {}, byGame: {}, byMyChar: {}, byOppChar: {},
        byPos: { first: rec(), early: rec(), late: rec() },
        tilt: { after2: rec(), fresh: rec() }, withRanks: 0, withPing: 0
    };
    RANKS.concat('?').forEach(r => { out.byOppRank[r] = rec(); });
    for (let g = -3; g <= 3; g++) out.byGap[g] = rec();
    PING.forEach(p => { out.byPing[p[0]] = rec(); });
    for (let h = 0; h < 24; h++) out.byHour.push(rec());
    for (let d = 0; d < 7; d++) { out.heat.push([]); for (let h = 0; h < 24; h++) out.heat[d].push(rec()); }

    let lossRun = 0, lastSession = '', pos = 0;
    sets.forEach(s => {
        add(out.total, s);
        const opp = RANK_OF(s.oppRank);
        add(out.byOppRank[opp || '?'], s);
        if (opp) out.withRanks++;
        if (s.oppRank && s.myRank) add(out.byGap[Math.max(-3, Math.min(3, s.oppRank - s.myRank))], s);
        const pb = pingBucket(s.ping);
        if (pb) { add(out.byPing[pb], s); out.withPing++; }
        const d = new Date(s.at || 0);
        add(out.byHour[d.getHours()], s);
        add(out.heat[(d.getDay() + 6) % 7][d.getHours()], s);
        if (typeof s.ft === 'number') { const k = s.ft ? 'FT' + s.ft : 'casual'; add(out.byFt[k] || (out.byFt[k] = rec()), s); }
        const game = String(s.channel || s.game || '').replace(/\s*\([^)]*\)\s*$/, '') || N_('Unknown game');
        add(out.byGame[game] || (out.byGame[game] = rec()), s);
        if (s.myChar) add(out.byMyChar[s.myChar] || (out.byMyChar[s.myChar] = rec()), s);
        if (s.oppChar) add(out.byOppChar[s.oppChar] || (out.byOppChar[s.oppChar] = rec()), s);
        // where in the session
        const sk = sessionKey(s.at || 0);
        pos = sk === lastSession ? pos + 1 : 1;
        lastSession = sk;
        add(pos === 1 ? out.byPos.first : pos <= 5 ? out.byPos.early : out.byPos.late, s);
        // tilt: how sets go right after two (or more) losses in a row, within the session
        if (pos === 1) lossRun = 0;
        add(lossRun >= 2 ? out.tilt.after2 : out.tilt.fresh, s);
        lossRun = s.result === 'lost' ? lossRun + 1 : 0;
    });
    out.insights = insights(out, sets);
    return out;
}

const pct = (x) => Math.round(x * 100) + '%';

// plain-language findings, strongest first (only from buckets with enough results)
function insights(a, sets) {
    const out = [];
    const overall = a.total.rate;
    if (a.total.n < MIN_N) return out;
    // tilt
    const t = a.tilt.after2;
    if (t.n >= MIN_N && t.rate < overall - 0.08)
        out.push({ kind: 'tilt', score: overall - t.rate, text: T('After two losses in a row you win {rate} (usually {usual}) — a short break may help.', { rate: pct(t.rate), usual: pct(overall) }) });
    else if (t.n >= MIN_N && t.rate >= overall)
        out.push({ kind: 'tilt', score: 0.05, text: T('You bounce back well: {rate} after two losses in a row.', { rate: pct(t.rate) }) });
    // warm-up
    const f = a.byPos.first, later = rec();
    [a.byPos.early, a.byPos.late].forEach(r => { later.w += r.w; later.l += r.l; later.n += r.n; });
    later.rate = later.n ? later.w / later.n : null;
    if (f.n >= MIN_N && later.n >= MIN_N && later.rate - f.rate >= 0.1)
        out.push({ kind: 'warmup', score: later.rate - f.rate, text: T('Your first set of a session: {first}, later ones: {later} — warm up in training mode first?', { first: pct(f.rate), later: pct(later.rate) }) });
    // time of day (3-hour blocks)
    const blocks = [];
    for (let b = 0; b < 8; b++) {
        const r = rec();
        for (let h = b * 3; h < b * 3 + 3; h++) { r.w += a.byHour[h].w; r.l += a.byHour[h].l; r.n += a.byHour[h].n; }
        r.rate = r.n ? r.w / r.n : null;
        if (r.n >= MIN_N) blocks.push({ from: b * 3, r });
    }
    if (blocks.length >= 2) {
        blocks.sort((x, y) => y.r.rate - x.r.rate);
        const best = blocks[0], worst = blocks[blocks.length - 1];
        const label = (h) => String(h).padStart(2, '0') + ':00–' + String((h + 3) % 24).padStart(2, '0') + ':00';
        if (best.r.rate - worst.r.rate >= 0.1) {
            out.push({ kind: 'time', score: best.r.rate - worst.r.rate, text: T('You play best {best} ({bestRate}) and worst {worst} ({worstRate}).', { best: label(best.from), bestRate: pct(best.r.rate), worst: label(worst.from), worstRate: pct(worst.r.rate) }) });
        }
    }
    // the matchup you're best at: opponent rank x ping
    let bestCombo = null;
    RANKS.forEach(rk => PING.forEach(([pb, lo, hi]) => {
        const r = rec();
        sets.forEach(s => { if (RANK_OF(s.oppRank) === rk && s.ping >= lo && s.ping < hi) add(r, s); });
        if (r.n >= MIN_N + 3 && (!bestCombo || r.rate > bestCombo.r.rate)) bestCombo = { rk, pb, r };          // a narrow slice: wants more sets
    }));
    if (bestCombo && bestCombo.r.rate > overall + 0.05)
        out.push({ kind: 'combo', score: bestCombo.r.rate - overall, text: T('You play best vs {rank}-ranks at {ping} ms: {rate} over {n} sets.', { rank: bestCombo.rk, ping: bestCombo.pb, rate: pct(bestCombo.r.rate), n: bestCombo.r.n }) });
    // ping
    const lowP = a.byPing['<60'], highP = a.byPing['150+'];
    if (lowP.n >= MIN_N && highP.n >= MIN_N && lowP.rate - highP.rate >= 0.12)
        out.push({ kind: 'ping', score: lowP.rate - highP.rate, text: T('Lag costs you: {low} under 60 ms, {high} over 150 ms — the ping filter can warn you.', { low: pct(lowP.rate), high: pct(highP.rate) }) });
    // stepping up
    const up = rec();
    [1, 2, 3].forEach(g => { const r = a.byGap[g]; up.w += r.w; up.l += r.l; up.n += r.n; });
    up.rate = up.n ? up.w / up.n : null;
    if (up.n >= MIN_N) out.push({ kind: 'gap', score: 0.04, text: T('Against higher ranks you win {rate} ({w}–{l}).', { rate: pct(up.rate), w: up.w, l: up.l }) });
    // first-to length
    const fts = Object.keys(a.byFt).filter(k => a.byFt[k].n >= MIN_N).sort((x, y) => a.byFt[y].rate - a.byFt[x].rate);
    if (fts.length >= 2 && a.byFt[fts[0]].rate - a.byFt[fts[fts.length - 1]].rate >= 0.1)
        out.push({ kind: 'ft', score: 0.03, text: T('Your best set length is {best} ({bestRate}); {worst} is your weakest ({worstRate}).', { best: T(fts[0]), bestRate: pct(a.byFt[fts[0]].rate), worst: T(fts[fts.length - 1]), worstRate: pct(a.byFt[fts[fts.length - 1]].rate) }) });
    return out.sort((x, y) => y.score - x.score);
}

/* --------------------------------------------------------------------- tab */

const E = (s) => fc.fmt.esc(s);
const rateColor = (r) => r == null ? 'var(--fc-s4)' : r >= 0.6 ? '#23a55a' : r >= 0.5 ? '#7bc96f' : r >= 0.4 ? '#f0b232' : '#f23f43';

function bars(entries, opts) {
    const o = opts || {};
    const list = entries.filter(([, r]) => r.n > 0);
    if (!list.length) return '<div class="fc-muted">' + E(T('No sets with this information yet.')) + '</div>';
    return fc.ui.chart.bars(list.map(([label, r]) => ({
        label: T(label), value: Math.round(r.rate * 100), text: Math.round(r.rate * 100) + '%',
        color: o.color ? o.color(label, r) : (r.n < MIN_N ? 'var(--fc-faint)' : rateColor(r.rate)),
        title: T(label) + ': ' + r.w + '–' + r.l + ' (' + T.plural(r.n, '{n} set', '{n} sets') + ')' + (r.n < MIN_N ? ' — ' + T('too few to trust yet') : '')
    })), { w: o.w || 440, h: 160, max: 100 });
}

function heatHtml(a) {
    let max = 1;
    a.heat.forEach(row => row.forEach(r => { max = Math.max(max, r.n); }));
    const cell = (r, d, h) => `<i style="background:${r.n ? rateColor(r.rate) : 'transparent'};opacity:${r.n ? (0.35 + 0.65 * r.n / max).toFixed(2) : 1}" ` +
        `title="${E(T(DAYS[d]))} ${String(h).padStart(2, '0')}:00 — ${r.n ? r.w + '–' + r.l + ' (' + pct(r.rate) + ')' : E(T('no sets'))}"></i>`;
    return `<div class="anHeat">${a.heat.map((row, d) => `<div class="row"><b>${E(T(DAYS[d]))}</b>${row.map((r, h) => cell(r, d, h)).join('')}</div>`).join('')}` +
        `<div class="row hours"><b></b>${[0, 3, 6, 9, 12, 15, 18, 21].map(h => `<span>${String(h).padStart(2, '0')}</span>`).join('')}</div></div>`;
}

// your matchups: record vs each character they played, and your note (click to write one)
function matchupCard(sets, card) {
    const nt = fc.modules.get('notes');
    const by = {};
    sets.forEach(s => {
        if (!s.oppChar) return;
        const k = (s.rom || '') + '|' + s.oppChar;
        (by[k] || (by[k] = { rom: s.rom || '', char: s.oppChar, sets: [] })).sets.push(s);
    });
    const rows = Object.keys(by).map(k => Object.assign(by[k], { r: fc.data.recordOf(by[k].sets) })).sort((x, y) => y.sets.length - x.sets.length).slice(0, 10);
    if (!rows.length) return '';
    return card(E(T('Matchups')) + ' <small>— ' + E(T('click one for your notes')) + '</small>', rows.map(m => {
        const note = nt && nt.matchup ? nt.matchup(m.rom, m.char) : null;
        const rate = m.r.w + m.r.l ? m.r.w / (m.r.w + m.r.l) : null;
        return `<div class="anMu" data-mu="${E(m.rom + '|' + m.char)}" title="${E(T('Matchup notes vs {char}', { char: m.char }))}">` +
            `<b>${E(m.char)}</b><span class="r ${rate == null ? '' : rate >= 0.5 ? 'good' : 'bad'}">${E(fc.fmt.wl(m.r))}</span>` +
            `<span class="n${note ? '' : ' empty'}">${E(note ? note.text : T('Add a note'))}</span></div>`;
    }).join(''), true);
}

// by character, once sets carry them (from 2.6 on); the most-played six of each
function charCards(a, card) {
    const top = (o) => Object.keys(o).sort((x, y) => o[y].n - o[x].n).slice(0, 6).map(k => [k.length > 14 ? k.slice(0, 13) + '…' : k, o[k]]);
    return (Object.keys(a.byMyChar).length ? card(E(T('By your character')), bars(top(a.byMyChar))) : '') +
        (Object.keys(a.byOppChar).length ? card(E(T('By their character')), bars(top(a.byOppChar))) : '');
}

function tabHtml(ctx) {
    const a = analyze(ctx.sets);
    if (a.total.n < MIN_N) return fc.ui.empty({ icon: 'trend', title: 'Not enough sets yet',
        sub: T(ctx.game || ctx.period !== 'all' ? 'Analytics needs at least {n} sets with a known result in these filters. Keep playing — or import your history.' : 'Analytics needs at least {n} sets with a known result. Keep playing — or import your history.', { n: MIN_N }) });
    const card = (title, body, wide) => `<div class="fc-card fcsCard${wide ? ' wide' : ''}"><h4>${title}</h4>${body}</div>`;
    const t = a.tilt.after2;
    const bestHour = a.byHour.map((r, h) => ({ h, r })).filter(x => x.r.n >= MIN_N).sort((x, y) => y.r.rate - x.r.rate)[0];
    const missing = a.total.n - a.withRanks;
    return `<div class="fcsTop">
            ${fc.ui.tile(String(a.total.n), 'sets analysed', { sub: missing ? T('{n} without ranks (older / imported)', { n: missing }) : '' })}
            ${fc.ui.tile(pct(a.total.rate), 'win rate')}
            ${fc.ui.tile(t.n ? pct(t.rate) : '—', 'after 2 losses in a row', { trend: t.n >= MIN_N ? (t.rate < a.total.rate - 0.08 ? 'down' : 'up') : '' })}
            ${fc.ui.tile(bestHour ? String(bestHour.h).padStart(2, '0') + ':00' : '—', 'your best hour', { sub: bestHour ? T('{rate} over {n} sets', { rate: pct(bestHour.r.rate), n: bestHour.r.n }) : T('needs more sets') })}
        </div>
        <div class="fcsGrid">
            ${card(E(T('What stands out')), a.insights.length ? a.insights.map(i => `<div class="anIns ${i.kind}">${fc.ui.icon({ tilt: 'flame', warmup: 'clock', time: 'clock', combo: 'target', ping: 'bolt', gap: 'trend', ft: 'sword' }[i.kind] || 'info')}<span>${E(i.text)}</span></div>`).join('')
                : '<div class="fc-muted">' + E(T('Nothing stands out yet — your results look even across the board.')) + '</div>', true)}
            ${card(E(T('By opponent rank')), bars(RANKS.concat('?').map(r => [r, a.byOppRank[r]]), { color: (l, r) => r.n < MIN_N ? 'var(--fc-faint)' : (l === '?' ? '#80848e' : fc.data.rankColor(l)) }))}
            ${card(E(T('By rank gap')) + ' <small>— ' + E(T('them minus you')) + '</small>', bars([-3, -2, -1, 0, 1, 2, 3].map(g => [(g > 0 ? '+' : '') + g, a.byGap[g]])))}
            ${card(E(T('By ping')), bars(PING.map(p => [p[0], a.byPing[p[0]]])))}
            ${card(E(T('By set length')), bars(Object.keys(a.byFt).sort().map(k => [k, a.byFt[k]])))}
            ${card(E(T('Where in the session')), bars([[N_('1st set'), a.byPos.first], [N_('2nd–5th'), a.byPos.early], [N_('6th+'), a.byPos.late]]))}
            ${card(E(T('By game')), bars(Object.keys(a.byGame).sort((x, y) => a.byGame[y].n - a.byGame[x].n).slice(0, 6).map(k => [k.length > 14 ? k.slice(0, 13) + '…' : k, a.byGame[k]])))}
            ${charCards(a, card)}
            ${matchupCard(ctx.sets, card)}
            ${card(E(T('When you win')) + ' <small>— ' + E(T('weekday × hour, greener = better, brighter = more sets')) + '</small>', heatHtml(a), true)}
        </div>`;
}

const CSS = `
.fcsTab .fcsCard svg.fc-chart { width: 100%; height: auto; }
.anMu { display: flex; align-items: baseline; padding: 7px 8px; margin: 0 -8px; border-radius: 6px; cursor: pointer; font-size: 14px; }
.anMu:hover { background: var(--fc-hover); }
.anMu b { flex: none; width: 120px; color: var(--fc-head); font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.anMu .r { flex: none; width: 64px; font-weight: 700; font-variant-numeric: tabular-nums; }
.anMu .r.good { color: var(--fc-success); } .anMu .r.bad { color: var(--fc-danger); }
.anMu .n { flex: 1; min-width: 0; font-style: italic; color: var(--fc-text); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.anMu .n.empty { font-style: normal; color: var(--fc-muted); }
.anIns { display: flex; align-items: flex-start; padding: 8px 0; border-top: 1px solid var(--fc-divider); font-size: 14px; }
.anIns:first-of-type { border-top: 0; }
.anIns .fc-ic { flex: none; width: 18px; height: 18px; margin: 1px 10px 0 0; color: var(--fc-accent); }
.anIns.tilt .fc-ic { color: var(--fc-danger); }
.anHeat { overflow-x: auto; }
.anHeat .row { display: flex; align-items: center; height: 18px; margin-bottom: 3px; }
.anHeat .row b { flex: none; width: 36px; font-size: 11px; font-weight: 600; color: var(--fc-muted); }
.anHeat .row i { flex: 1 1 0; min-width: 10px; height: 16px; margin-right: 3px; border-radius: 3px; box-shadow: inset 0 0 0 1px var(--fc-divider); }
.anHeat .row.hours span { flex: 3 1 0; font-size: 10px; color: var(--fc-muted); }
`;

/* -------------------------------------------------------------------- nudge */

let nudgedAt = 0;
function onSet() {
    if (!cfg.tiltNudge) return;
    const last = fc.history.all().slice(-3);
    if (last.length === 3 && last.every(s => s.result === 'lost') && Date.now() - nudgedAt > 30 * 60000) {
        nudgedAt = Date.now();
        fc.ui.toast('Three losses in a row', { icon: 'flame', kind: 'warning', ms: 9000,
            sub: 'Your stats say you play better after a short break. Stretch, drink some water, come back fresh.' });
    }
}

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('analytics', { tiltNudge: false });
    cfg = store.data;
    fc.ui.style('anStyle', CSS);
    fc.own(() => fc.ui.style('anStyle', null));
    const stats = fc.modules.get('stats');
    if (stats && stats.addTab) fc.own(stats.addTab({ id: 'analytics', label: 'Analytics', order: 10, html: tabHtml }));
    fc.on('set:recorded', onSet);
    fc.settings.block({
        id: 'analytics', section: 'match', title: 'Match analytics', hint: '— the Analytics tab on your stats page', store, order: 30,
        fields: [
            { key: 'tiltNudge', type: 'switch', label: '“Take a break?” after three losses in a row', hint: 'A gentle reminder, at most every 30 minutes' },
            { type: 'button', label: 'See your analytics', button: 'Open', act: 'open', onClick: () => { const s = fc.modules.get('stats'); const st = fc.modules.get('fightcord'); if (st) st.close(); if (s) s.open({ tab: 'analytics' }); } }
        ]
    });
    return api;
}

const api = { analyze, pingBucket, sessionKey, MIN_N };

module.exports = { id: 'analytics', name: 'Match analytics', needs: ['stats'], start, analyze, pingBucket, sessionKey, MIN_N };
