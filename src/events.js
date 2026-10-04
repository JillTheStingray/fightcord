/**
 * Fightcord event reminders: never miss a Fightcade tournament
 *
 * Fightcade lists upcoming events (SSEU, Blue Wolves, monthlies…) on its home page and in each
 * game channel. This module remembers them and reminds you:
 *   - automatically for games you've joined or played in the last 30 days (switchable)
 *   - for any event you ring the bell on (Discover's event cards, a channel's event tiles)
 * A toast with "Open channel" and "Info" comes 30 minutes before (15 / 30 / 60, a setting) and
 * again when it starts. Not in the middle of your match: it waits until you're done.
 * /events lists what's coming up. Picked events live in events-config.json.
 */
'use strict';

let fc = null;
let store = null, cfg = null;
const DAY = 86400000, MIN = 60000;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);

/* ------------------------------------------------------------------- pure */

const chanName = (ev) => String((ev && ev.channel && (ev.channel.name || ev.channel)) || '');
const eventKey = (ev) => [ev.name || '', +ev.date || 0, chanName(ev) || ev.gameid || ''].join('|');

// one of yours: its game is one you've joined or played lately
function isMine(ev, roms, chans) {
    return !!((ev.gameid && roms.has(String(ev.gameid).replace(/^fc1_/, ''))) || (chanName(ev) && chans.has(chanName(ev))));
}

// which reminders are due now: 'soon' (lead minutes before) and 'start' (up to 30 min after it
// began). Missed the 'soon' one because Fightcade wasn't open? Then only 'start'.
function dueStages(ev, now, lead, fired) {
    const t = +ev.date, done = new Set(fired || []);
    if (!t) return [];
    if (now >= t + 30 * MIN) return [];
    if (now >= t) return done.has('start') ? [] : ['start'];
    if (now >= t - lead * MIN) return done.has('soon') ? [] : ['soon'];
    return [];
}

function normalise(ev, chOverride) {
    if (!ev || !ev.name) return null;
    const date = typeof ev.date === 'number' ? ev.date : Date.parse(ev.date);
    if (!date || isNaN(date)) return null;
    const out = { name: String(ev.name), date, region: ev.region || '', link: ev.link || '', image: ev.image || '',
        gameid: ev.gameid || '', channel: chOverride || chanName(ev) };
    out.key = eventKey(out);
    return out;
}

/* -------------------------------------------------------------- collecting */

const known = new Map();       // key -> event

function remember(ev) { if (ev) known.set(ev.key, Object.assign(known.get(ev.key) || {}, ev)); return ev; }

function collect() {
    const root = fc.app.root();
    const res = root && root.$refs && root.$refs['welcome-channel'] && root.$refs['welcome-channel'].results;
    if (Array.isArray(res)) res.forEach(sec => (sec && Array.isArray(sec.events) ? sec.events : []).forEach(e => remember(normalise(e))));
    document.querySelectorAll('.eventPreviewWrapper').forEach(card => remember(normalise(card.__vue__ && card.__vue__.event)));
    // a channel's event tiles: the real objects live on the message-of-the-day component
    document.querySelectorAll('.messageWrapper').forEach(mw => {
        const evs = mw.__vue__ && mw.__vue__.data && mw.__vue__.data.events;
        if (!Array.isArray(evs) || !evs.length) return;
        const ch = fc.app.channelOf(mw);
        evs.forEach(e => remember(normalise(e, chanName(e) || (ch && (ch.id || ch.name)) || '')));
    });
    const old = Date.now() - 4 * 3600000;
    known.forEach((ev, k) => { if (ev.date < old) known.delete(k); });
}

/* ------------------------------------------------------------- reminders */

function mineSets() {
    const roms = new Set(), chans = new Set();
    fc.app.joinedChannels().forEach(c => { if (c.gameid) roms.add(String(c.gameid).replace(/^fc1_/, '')); chans.add(c.id || c.name); });
    const since = Date.now() - 30 * DAY;
    fc.history.all().forEach(s => { if (s.at >= since && s.rom) roms.add(String(s.rom).replace(/^fc1_/, '')); });
    return { roms, chans };
}

function wanted(ev, mine) {
    if (cfg.picked[ev.key]) return 'picked';
    if (cfg.muted[ev.key]) return '';
    return cfg.auto && isMine(ev, mine.roms, mine.chans) ? 'auto' : '';
}

function upcoming() {
    collect();
    const mine = mineSets();
    const all = new Map(known);
    Object.keys(cfg.picked).forEach(k => { if (!all.has(k)) all.set(k, cfg.picked[k]); });
    const now = Date.now();
    return [...all.values()].filter(ev => ev.date > now - 30 * MIN)
        .map(ev => Object.assign({}, ev, { why: wanted(ev, mine) })).sort((a, b) => a.date - b.date);
}

function check() {
    const now = Date.now();
    const inMatch = fc.app.inMatch(fc.app.me());
    let changed = false;
    upcoming().forEach(ev => {
        if (!ev.why) return;
        const stages = dueStages(ev, now, cfg.lead, cfg.fired[ev.key]);
        if (!stages.length) return;
        // mid-match: wait, unless it has already started (then it's now or never)
        if (inMatch && stages[0] === 'soon') return;
        fire(ev, stages[0]);
        cfg.fired[ev.key] = (cfg.fired[ev.key] || []).concat(stages[0] === 'start' ? ['soon', 'start'] : ['soon']);
        changed = true;
    });
    // forget what's long over
    Object.keys(cfg.fired).forEach(k => { const t = +k.split('|')[1]; if (!t || t < now - DAY) { delete cfg.fired[k]; changed = true; } });
    Object.keys(cfg.picked).forEach(k => { if (cfg.picked[k].date < now - DAY) { delete cfg.picked[k]; changed = true; } });
    Object.keys(cfg.muted).forEach(k => { const t = +k.split('|')[1]; if (!t || t < now - DAY) { delete cfg.muted[k]; changed = true; } });
    if (changed) store.save();
}

function openChannel(name) {
    if (!name) return;
    if (fc.app.joinedChannels().some(c => (c.id || c.name) === name)) { fc.app.select(name); return; }
    const r = fc.app.root();
    if (r && typeof r.joinChannel === 'function') { try { r.joinChannel(name); } catch (e) { fc.log.warn('join failed', e.message); } }
}
function openLink(url) {
    if (!/^https?:\/\//i.test(url || '')) return;
    try { (window.__fcdOpenUri || ((x) => window.open(x, '_blank')))(url); } catch (e) { fc.log.warn('open failed', e.message); }
}

function fire(ev, stage) {
    const mins = Math.max(1, Math.round((ev.date - Date.now()) / MIN));
    const title = stage === 'start' ? T('{name} is starting', { name: ev.name })
        : T('{name} starts in {time}', { name: ev.name, time: mins >= 60 ? T('{n} h', { n: Math.round(mins / 60) }) : T('{n} min', { n: mins }) });
    const actions = [];
    if (ev.channel) actions.push({ label: 'Open channel', fn: () => openChannel(ev.channel) });
    if (ev.link) actions.push({ label: 'Info', kind: 'sec', fn: () => openLink(ev.link) });
    fc.ui.toast(title, { sub: [clockOf(ev.date), ev.region].filter(Boolean).join(' · '), icon: 'bell', kind: 'warning', ms: 20000, actions });
    fc.sound.play('ping');
    fc.emit('event:reminder', { event: ev, stage });
}
const clockOf = (t) => new Date(t).toLocaleTimeString(fc.t.locale(), { hour: 'numeric', minute: '2-digit' });

/* ------------------------------------------------------------- the bells */

function toggle(ev) {
    const mine = mineSets();
    const on = !!wanted(ev, mine);
    if (on) {
        delete cfg.picked[ev.key];
        if (cfg.auto && isMine(ev, mine.roms, mine.chans)) cfg.muted[ev.key] = 1;
    } else {
        delete cfg.muted[ev.key];
        if (!(cfg.auto && isMine(ev, mine.roms, mine.chans))) cfg.picked[ev.key] = ev;
    }
    store.save();
    decorate();
    fc.settings.refresh('events');
    document.querySelectorAll('.evPop .evList').forEach(l => { l.innerHTML = listHtml(12); });
    fc.ui.toast(T(on ? 'Reminder off' : 'Reminder set'), { sub: ev.name, icon: 'bell', ms: 2500 });
}

function bellHtml(on) {
    return `<span class="evBell${on ? ' on' : ''}" title="${E(T(on ? 'Reminder set — click to remove' : 'Remind me'))}">${fc.ui.icon('bell')}</span>`;
}

// a bell on every event card (Discover) and event tile (channels)
function decorate() {
    if (!cfg.bells) { document.querySelectorAll('.evBell').forEach(b => b.remove()); return; }
    const mine = mineSets();
    const place = (host, ev) => {
        if (!host || !ev) return;
        let b = host.querySelector(':scope > .evBell');
        const on = !!wanted(ev, mine);
        if (!b) {
            host.insertAdjacentHTML('beforeend', bellHtml(on));
            b = host.querySelector(':scope > .evBell');
            b.addEventListener('mousedown', (e) => e.stopPropagation());
            b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); const k = b.dataset.key; const cur = known.get(k) || cfg.picked[k]; if (cur) toggle(cur); });
        } else if (b.classList.contains('on') !== on) {
            b.classList.toggle('on', on);
            b.title = T(on ? 'Reminder set — click to remove' : 'Remind me');
        }
        b.dataset.key = ev.key;
    };
    document.querySelectorAll('.eventPreviewWrapper').forEach(card => {
        const ev = remember(normalise(card.__vue__ && card.__vue__.event));
        place(card, ev);
    });
    document.querySelectorAll('.messageWrapper').forEach(mw => {
        const evs = mw.__vue__ && mw.__vue__.data && mw.__vue__.data.events;
        if (!Array.isArray(evs) || !evs.length) return;
        const ch = fc.app.channelOf(mw);
        const byName = new Map(evs.map(e => [String(e.name), normalise(e, chanName(e) || (ch && (ch.id || ch.name)) || '')]));
        mw.querySelectorAll('.eventsItem').forEach(tile => {
            const nm = tile.querySelector('.name');
            place(tile, remember(byName.get(nm ? nm.textContent.trim() : '')));
        });
    });
}

/* --------------------------------------------------------------- the list */

function listHtml(max) {
    const list = upcoming().filter(e => e.why).slice(0, max || 20);
    if (!list.length) return fc.ui.empty({ icon: 'bell', title: 'No reminders yet', sub: 'Events for your games show up here; ring the bell on any other event to add it.' });
    return list.map(ev => `<div class="evRow" data-key="${E(ev.key)}">${fc.ui.icon('bell')}<div class="tx"><b>${E(ev.name)}</b>` +
        `<span>${E(new Date(ev.date).toLocaleString(fc.t.locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${ev.region ? ' · ' + E(ev.region) : ''}` +
        `${ev.why === 'auto' ? ' · ' + E(T('your game')) : ''}</span></div>` +
        `${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'close', title: 'Remove this reminder', attrs: 'data-ev="off"' })}</div>`).join('');
}

// the remove buttons in the list (settings and /events), wherever it's shown
function onListClick(e) {
    const b = e.target.closest && e.target.closest('.evRow [data-ev="off"]');
    if (!b) return;
    e.stopPropagation();
    const k = b.closest('.evRow').dataset.key;
    const ev = known.get(k) || cfg.picked[k];
    if (ev) toggle(ev);
}

const CSS = `
.evBell { position: absolute; top: 8px; right: 8px; z-index: 3; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; cursor: pointer; background: rgba(0,0,0,.55); color: #fff; opacity: .75; transition: opacity var(--fc-fast), background var(--fc-fast); }
.evBell:hover { opacity: 1; }
.evBell.on { opacity: 1; background: var(--fc-accent); }
.evBell .fc-ic { width: 15px; height: 15px; }
.eventsItem { position: relative; }
.evList { margin-top: 8px; border-radius: var(--fc-r2); background: var(--fc-s1); overflow: hidden; }
.evRow { display: flex; align-items: center; padding: 8px 8px 8px 12px; }
.evRow + .evRow { border-top: 1px solid var(--fc-divider); }
.evRow > .fc-ic { flex: none; width: 16px; height: 16px; margin-right: 10px; color: var(--fc-accent); }
.evRow .tx { flex: 1; min-width: 0; }
.evRow b { display: block; color: var(--fc-head); font-size: 13.5px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.evRow span { font-size: 12px; color: var(--fc-muted); }
.evPop { width: 340px; max-height: 420px; overflow-y: auto; }
`;

/* ------------------------------------------------------------------ module */

function start(f) {
    fc = f;
    store = fc.config('events', { enabled: true, auto: true, bells: true, lead: 30, picked: {}, muted: {}, fired: {} });
    cfg = store.data;
    ['picked', 'muted', 'fired'].forEach(k => { if (!cfg[k] || typeof cfg[k] !== 'object') cfg[k] = {}; });
    fc.ui.style('evStyle', CSS);
    document.addEventListener('click', onListClick, true);
    fc.own(() => { document.removeEventListener('click', onListClick, true); document.querySelectorAll('.evBell').forEach(b => b.remove()); fc.ui.style('evStyle', null); });
    fc.tick(() => { if (cfg.enabled) check(); }, 30000, { delay: 8000, whileHidden: true });
    fc.tick(() => { if (cfg.enabled) collect(); }, 10 * MIN, { delay: 5000, whileHidden: true });
    fc.watch(() => { if (cfg.enabled) decorate(); }, { selector: '.eventPreviewWrapper, .eventsItem' });
    fc.on('match:end', () => { if (cfg.enabled) setTimeout(check, 3000); });
    fc.cmd('events', 'Upcoming events you get reminded about', (arg, ctx) => {
        const box = document.createElement('div');
        box.className = 'evPop';
        box.innerHTML = `<div class="evList">${listHtml(12)}</div>`;
        const r = ctx && ctx.input ? ctx.input.getBoundingClientRect() : null;
        fc.ui.popover(r || document.body, box, { side: 'top' });
    });
    fc.settings.block({
        id: 'events', section: 'search', title: 'Event reminders', hint: '— Fightcade tournaments · /events', store, order: 30,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Event reminders', hint: 'A pop-up before a tournament starts, with a button to open its channel' },
            { key: 'auto', type: 'switch', label: 'Remind me about events for my games', hint: 'Games you’ve joined or played in the last 30 days', show: (d) => d.enabled },
            { key: 'lead', type: 'select', label: 'How early', options: [[15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before']], show: (d) => d.enabled },
            { key: 'bells', type: 'switch', label: 'Bells on event cards', hint: 'Click one to add or remove a reminder', show: (d) => d.enabled, onChange: decorate },
            { type: 'html', html: () => `<div class="evList">${listHtml()}</div>`, show: (d) => d.enabled }
        ]
    });
    return api;
}

const api = {
    upcoming: () => upcoming(),
    toggle: (key) => { const ev = known.get(key) || cfg.picked[key]; if (ev) toggle(ev); },
    _check: () => check(),
    _collect: () => collect(),
    _remember: (ev) => remember(normalise(ev))
};

module.exports = { id: 'events', name: 'Event reminders', start, eventKey, dueStages, isMine, normalise };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
