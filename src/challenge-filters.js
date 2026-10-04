/**
 * Fightcord challenge filters
 *
 * Rules for incoming challenges, each Off / Warn / Decline:
 *   ping over N ms · Wi-Fi · VPN · country (allow list, or your continent) ·
 *   FT length · rank below a letter · players you haven't played · a block list
 *
 *   Decline -> declined the moment it arrives (Fightcade's own "reject"): no chat row,
 *              no sound, and a small toast says who and why.
 *   Warn    -> let through, with a "⚠ Wi-Fi · 190 ms" tag on the challenge in chat (and
 *              on the challenge card).
 *
 * Runs as the 'filter' step of the core's challenge pipeline (fc.hooks.challenge), so a
 * declined challenge never reaches Fightcade or the other modules.
 *
 *   /filters   the rules and this session's filtered challenges
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // challenge-filters-config.json

const N_ = (s) => s;          // translated where it's shown
const MODES = [['off', N_('Off')], ['warn', N_('Warn')], ['decline', N_('Decline')]];
const RANK_LETTERS = ['E', 'D', 'C', 'B', 'A', 'S'];          // rank number 1..6
const DEFAULT_RULES = {
    ping:    { mode: 'off', max: 150 },
    wifi:    { mode: 'off' },
    vpn:     { mode: 'off' },
    country: { mode: 'off', allow: '' },            // "nl be de" -- empty = your continent
    ft:      { mode: 'off', allow: [0, 2, 3, 5, 10] }, // 0 = casual
    rank:    { mode: 'off', min: 'D' },
    stranger:{ mode: 'off' },                        // never played them (your recent sets)
    block:   { mode: 'decline', names: '' }
};

const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const nameList = (txt) => String(txt || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);

/* -------------------------------------------------------------------- rules */

let recent = null;              // Map(lowercased name -> ...) of people you've played
let recentAt = 0;
function refreshRecent() {
    if (cfg.rules.stranger.mode === 'off' || Date.now() - recentAt < 10 * 60000) return;
    recentAt = Date.now();
    const scout = fc.modules.get('scout');
    if (scout && scout.recentOpponents) scout.recentOpponents().then(m => { recent = m; }).catch(() => {});
}

// -> list of reasons this challenge breaks, each {rule, mode, text}
function check(name, channel, ranked) {
    const out = [];
    if (!cfg.enabled || !name) return out;
    const R = cfg.rules;
    const u = fc.app.user(name)[1] || {};
    const add = (rule, text) => { if (R[rule].mode !== 'off') out.push({ rule, mode: R[rule].mode, text }); };
    const lower = name.toLowerCase();

    if (nameList(R.block.names).includes(lower)) add('block', T('on your block list'));
    if (typeof u.ping === 'number' && u.ping > 0 && u.ping > +R.ping.max) add('ping', u.ping + ' ms');
    if (u.proxy) add('vpn', 'VPN');
    else if (u.wlan) add('wifi', 'Wi-Fi');

    const cc = String((u.country && u.country.iso_code) || '').toLowerCase();
    if (cc && R.country.mode !== 'off') {
        const allow = nameList(R.country.allow);
        let ok;
        if (allow.length) ok = allow.includes(cc);
        else {
            const ml = fc.modules.get('member-list');
            const cont = ml && ml.continentOf;
            const meU = fc.app.user(fc.app.me())[1];
            const mine = String((fc.app.localUser().country && fc.app.localUser().country.iso_code) || (meU && meU.country && meU.country.iso_code) || '').toLowerCase();
            ok = !cont || !mine || !cont(mine) || cont(cc) === cont(mine);
        }
        if (!ok) add('country', (u.country && u.country.full_name) || cc.toUpperCase());
    }

    const ft = +ranked || 0;
    if (R.ft.mode !== 'off' && !R.ft.allow.map(Number).includes(ft)) add('ft', ft ? 'FT' + ft : T('casual'));

    const rank = +((u.channelRank || {})[channel] || 0);
    const min = RANK_LETTERS.indexOf(R.rank.min) + 1;
    if (rank && min && rank < min) add('rank', T('rank {rank}', { rank: RANK_LETTERS[rank - 1] }));

    if (R.stranger.mode !== 'off' && recent && !recent.has(lower)) add('stranger', T("haven't played"));
    return out;
}

/* --------------------------------------------------------------------- hook */

const filtered = [];            // this session's filtered challenges, newest first (not saved)

// the filter step: decline, or attach warnings for the challenge card and the chat tag
function onChallenge(ctx) {
    const reasons = check(ctx.name, ctx.channel, ctx.ranked);
    ctx.filterReasons = reasons;
    if (!reasons.length) return;
    reasons.forEach(r => ctx.warn.push(r.text));
    if (reasons.some(r => r.mode === 'decline')) ctx.decline(reasons.map(r => r.text).join(' · '));
}

// after Fightcade showed it (warn only) / after the core declined it
function onPassed(ctx) {
    const reasons = ctx.filterReasons || [];
    if (!reasons.length) return;
    note(ctx.name, ctx.channel, ctx.ranked, reasons, false);
    setTimeout(() => tagRow(ctx.name, reasons), 60);
}

function onDeclined(ctx) {
    if (ctx.filterReasons && ctx.filterReasons.length) note(ctx.name, ctx.channel, ctx.ranked, ctx.filterReasons, true);
}

function note(name, channel, ranked, reasons, declined) {
    filtered.unshift({ at: Date.now(), name, channel, ft: +ranked || 0, why: reasons.map(r => r.text).join(' · '), declined });
    if (filtered.length > 100) filtered.pop();
    if (declined) fc.ui.toast(T('Declined {name}', { name }) + ' — ' + reasons.map(r => r.text).join(' · '), {
        kind: 'danger', icon: 'shield', ms: 7000, sub: 'They can challenge again. Filters: Settings → Scout & challenges, or /filters' });
    fc.settings.refresh('challenge-filters');
}

// Warn mode: a pill on the challenge in chat (inside its own .userInfo)
function tagRow(name, reasons) {
    const rows = [...document.querySelectorAll('.challengeWrapper .challengeContent .userInfo')]
        .filter(u => ((u.querySelector('.name') || {}).textContent || '').trim() === name);
    const row = rows[rows.length - 1];
    if (!row || row.querySelector('.fcfWarn')) return;
    const pill = document.createElement('span');
    pill.className = 'fcfWarn';
    pill.innerHTML = fc.ui.ic('warn') + fc.fmt.esc(reasons.map(r => r.text).join(' · '));
    pill.title = T('Challenge filters (warn only)');
    row.appendChild(pill);
}

/* ----------------------------------------------------------------- settings */

const RULE_LABELS = [
    ['ping', N_('Ping over')], ['wifi', 'Wi-Fi'], ['vpn', 'VPN'], ['country', N_('Country not allowed')],
    ['ft', N_('FT length not allowed')], ['rank', N_('Rank below')], ['stranger', N_("Players you haven't played")], ['block', N_('Block list')]
];
const FTS = [[0, 'casual'], [2, 'FT2'], [3, 'FT3'], [5, 'FT5'], [10, 'FT10']];

function ruleExtra(k) {
    const R = cfg.rules;
    if (k === 'ping') return `<input type="number" class="fc-input" data-k="ping.max" min="30" max="500" step="10" value="${E(R.ping.max)}" style="width:76px"><span class="fcfUnit">ms</span>`;
    if (k === 'country') return `<input type="text" class="fc-input" data-k="country.allow" placeholder="${E(T('your continent'))}" value="${E(R.country.allow)}" title="${E(T('ISO codes, e.g. nl be de fr - empty = players from your continent'))}" style="width:140px">`;
    if (k === 'rank') return `<select class="fc-select" data-k="rank.min">${RANK_LETTERS.map(l => `<option${l === R.rank.min ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    if (k === 'block') return `<input type="text" class="fc-input" data-k="block.names" placeholder="${E(T('names, comma-separated'))}" value="${E(R.block.names)}" style="width:200px">`;
    return '';
}

function logHtml() {
    return filtered.length
        ? '<b>' + E(T('Filtered this session')) + '</b>' + filtered.slice(0, 20).map(f =>
            `<div>${new Date(f.at).toLocaleTimeString(fc.t.locale(), { hour: '2-digit', minute: '2-digit' })} · ${E(T(f.declined ? 'declined {name}' : 'warned {name}', { name: f.name }))} — ${E(f.why)}</div>`).join('')
        : E(T('Nothing filtered this session.'));
}

function renderBlock(el) {
    const R = cfg.rules;
    const mode = (k) => `<select class="fc-select" data-mode="${k}">${MODES.map(([m, l]) => `<option value="${m}"${R[k].mode === m ? ' selected' : ''}>${E(T(l))}</option>`).join('')}</select>`;
    el.innerHTML = `<div class="fc-set-title">${E(T('Challenge filters'))} <small>— ${E(T('Warn tags the challenge, Decline turns it down quietly'))} · /filters</small></div>
        <label class="fc-field"><span class="fc-field-text"><b>${E(T('Filter challenges'))}</b></span><input type="checkbox" class="fc-switch-in" data-on="1"${cfg.enabled ? ' checked' : ''}><i class="fc-switch"></i></label>
        <div class="fcfRules"${cfg.enabled ? '' : ' hidden'}>
        ${RULE_LABELS.map(([k, label]) => `<div class="fc-field fcfRule"><span class="fc-field-text"><b>${E(T(label))}</b></span>${ruleExtra(k)}${mode(k)}</div>` +
            (k === 'ft' && R.ft.mode !== 'off' ? `<div class="fcfFt">${FTS.map(([v, l]) =>
                fc.ui.chip(l, { on: R.ft.allow.map(Number).includes(v), act: 'ft' + v, title: R.ft.allow.map(Number).includes(v) ? N_('Allowed') : N_('Not allowed') })).join('')}</div>` : '')).join('')}
        </div>
        <div class="fc-note fcfLog">${logHtml()}</div>`;
}

function wireBlock(el) {
    renderBlock(el);
    const changed = () => { store.save(); refreshRecent(); renderBlock(el); };
    el.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.on) { cfg.enabled = t.checked; changed(); return; }
        if (t.dataset.mode) { cfg.rules[t.dataset.mode].mode = t.value; changed(); return; }
        if (t.dataset.k) {
            const [rule, key] = t.dataset.k.split('.');
            cfg.rules[rule][key] = t.type === 'number' ? Math.max(30, +t.value || 150) : t.value.trim();
            changed();
        }
    });
    el.addEventListener('click', (e) => {
        const c = e.target.closest('[data-act^="ft"]');
        if (!c) return;
        const v = +c.getAttribute('data-act').slice(2);
        const allow = cfg.rules.ft.allow.map(Number);
        cfg.rules.ft.allow = allow.includes(v) ? allow.filter(x => x !== v) : allow.concat(v).sort((a, b) => a - b);
        changed();
    });
}

const CSS = `
.fcfWarn { display: inline-block; margin-left: 8px; padding: 1px 6px; border-radius: 4px; font-size: 12px; font-weight: 600;
    color: var(--fc-warning); background: rgba(240,178,50,.14); vertical-align: middle; }
.fcfRules[hidden] { display: none; }
.fcfRule > .fc-input, .fcfRule > .fc-select { height: 30px; margin-left: 8px; font-size: 13px; }
.fcfRule .fcfUnit { margin-left: 4px; font-size: 12px; color: var(--fc-muted); }
.fcfFt { padding: 6px 0 8px; border-bottom: 1px solid var(--fc-divider); }
.fcfFt .fc-chip { margin: 0 6px 4px 0; }
.fcfLog { max-height: 140px; overflow-y: auto; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('challenge-filters', { enabled: true, rules: JSON.parse(JSON.stringify(DEFAULT_RULES)) });
    cfg = store.data;
    // rules saved by an older version may miss keys: fill them in
    Object.keys(DEFAULT_RULES).forEach(k => { cfg.rules[k] = Object.assign({}, DEFAULT_RULES[k], cfg.rules[k] || {}); });
    window.__fcFiltersLoaded = true;
    fc.ui.style('fcfStyle', CSS);
    fc.own(() => { fc.ui.style('fcfStyle', null); window.__fcFiltersLoaded = false; });

    fc.hooks.challenge(onChallenge, { phase: 'filter' });
    fc.hooks.challenge(onPassed, { order: -10 });
    fc.on('challenge:declined', onDeclined);
    fc.tick(refreshRecent, 60000, { delay: 3000 });

    fc.cmd('filters', 'Challenge filters: the rules and what they filtered', () => {
        const on = Object.keys(cfg.rules).filter(k => cfg.rules[k].mode !== 'off').map(k => k + ': ' + cfg.rules[k].mode);
        fc.ui.toast(T(cfg.enabled ? 'Challenge filters on' : 'Challenge filters off'), { icon: 'filter', ms: 8000,
            sub: (on.length ? on.join(' · ') : T('no rules set')) + (filtered.length ? ' — ' + T('filtered {n} this session', { n: filtered.length }) : '') });
    });
    fc.cmd('filter', 'Challenge filters', () => fc.cmd.run('filters'));

    fc.settings.block({ id: 'challenge-filters', section: 'challenges', order: 30, render: wireBlock,
        refresh: (el) => { const log = el.querySelector('.fcfLog'); if (log) log.innerHTML = logHtml(); } });
    return api;
}

const api = {
    _check: (n, c, r) => check(n, c, r),
    _filtered: filtered,
    get _config() { return cfg; }
};

module.exports = { id: 'challenge-filters', name: 'Challenge filters', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
