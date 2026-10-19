/**
 * Fightcord profile popout
 *
 * Click your own avatar (bottom-left) and instead of Fightcade's small Online / Away menu
 * you get a Discord-style profile card: tonight's session, your all-time record, main game,
 * goals, friends online, the Online / Away switch and quick links. The status buttons and Log out
 * click Fightcade's own buttons, so nothing about how they work changes.
 *
 * Quick settings (2.15): the Look, voice chat, streamer mode, music and Do not disturb, without
 * opening Settings. The same block opens from the channel header's ⋯ menu.
 */
'use strict';

let fc = null;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const N_ = (s) => s;
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
const mod = (id) => fc.modules.get(id);
const store = (id) => fc.config(id, {});

/* --------------------------------------------------------------------- data */

function data() {
    const me = fc.app.me();
    const u = fc.app.user(me)[1] || fc.app.localUser() || {};
    const ms = mod('match-screens'), stats = mod('stats'), fr = mod('friends');
    const all = fc.history.all();
    const cleared = ms && ms._config ? ms._config.sessionClearedAt : 0;
    const tonight = fc.history.session(Date.now(), cleared);
    const tally = stats && stats._tally ? stats._tally(all) : null;
    const st = stats && stats._streaks ? stats._streaks(all) : null;
    const games = new Map();
    all.forEach(s => { const k = s.rom || s.game; if (!k) return; const g = games.get(k) || { n: 0, rom: s.rom, name: shortName(s.channel || s.game) }; g.n++; games.set(k, g); });
    const main = [...games.values()].sort((a, b) => b.n - a.n)[0] || null;
    const friends = fr && fr.list ? fr.list().filter(n => !!fc.app.user(n)[1]) : [];
    const status = u.playing && u.playing.quarkId ? 'live' : u.away ? 'away' : 'on';
    return { me, status, tonight: tonight.length, tRec: fc.data.recordOf(tonight), tStreak: fc.data.streakOf(tonight), tally, st, main, friends };
}

/* ----------------------------------------------------------- quick settings */

// what the switches do, and whether each is on (null = not available here)
const QUICK = [
    { id: 'voice', icon: 'mic', label: N_('Voice chat'), on: () => { const v = mod('voice'); return v && v.enabled ? v.enabled() : null; },
        set: (on) => { const s = store('voice'); s.data.enabled = on; s.save(); fc.emit('voice:changed', { on }); fc.settings.refresh('voice'); } },
    { id: 'streamer', icon: 'eye', label: N_('Streamer mode'), on: () => { const s = mod('streamer'); return s && s.active ? !!s.active() : null; },
        set: (on) => { const s = mod('streamer'); if (s && s.set) s.set(on); } },
    { id: 'music', icon: 'music', label: N_('Music'), on: () => { const m = mod('music'); return m && m._config && m._config.track ? !!m._config.enabled : null; },
        set: (on) => { const m = mod('music'); if (!m || !m._config) return; m._config.enabled = on; store('music').save(); if (m._tick) m._tick(); fc.settings.refresh('music'); } },
    { id: 'dnd', icon: 'ban', label: N_('Do not disturb'), on: () => fc.ui.dnd(), set: (on) => fc.ui.dnd(on) }
];

function currentLook() {
    const th = mod('discord-theme');
    if (!th || !th.looks) return '';
    const looks = th.looks(), d = store('discord-theme').data;
    return Object.keys(looks).find(k => looks[k].preset === d.preset && String(looks[k].accent).toLowerCase() === String(d.accent || '').toLowerCase()) || '';
}

function quickHtml() {
    const th = mod('discord-theme');
    const looks = th && th.looks ? th.looks() : {};
    const cur = currentLook();
    const sw = Object.keys(looks).map(k => {
        const c = looks[k].sw || ['#111', '#222', '#5865f2'];
        return `<span class="qsLook${k === cur ? ' on' : ''}" data-qs-look="${E(k)}" title="${E(T(looks[k].name))}" style="background:linear-gradient(135deg,${c[0]} 0 45%,${c[1]} 45% 70%,${c[2]} 70%)"></span>`;
    }).join('');
    const toggles = QUICK.map(q => {
        const on = q.on();
        if (on == null) return '';
        return `<span class="qsTg${on ? ' on' : ''}${q.id === 'dnd' ? ' dnd' : ''}" data-qs="${q.id}" role="switch" aria-checked="${on}">${fc.ui.icon(q.icon)}<span>${E(T(q.label))}</span><i></i></span>`;
    }).join('');
    const m = mod('music');
    const vol = m && m._config && m._config.track && m._config.enabled
        ? `<label class="qsVol">${fc.ui.icon('music')}<input type="range" min="0" max="100" value="${Math.round((+m._config.volume || 0) * 100)}" data-qs-vol title="${E(T('Music volume'))}"></label>` : '';
    return `<div class="qs">${sw ? `<div class="qsLooks">${sw}</div>` : ''}<div class="qsTgs">${toggles}</div>${vol}</div>`;
}

function onQuick(e, redraw) {
    const look = e.target.closest('[data-qs-look]');
    if (look) {
        const th = mod('discord-theme');
        if (th && th.applyLook) th.applyLook(look.dataset.qsLook, true);
        fc.settings.refresh('discord-theme');
        setTimeout(redraw, 60);
        return true;
    }
    const tg = e.target.closest('[data-qs]');
    if (tg) {
        const q = QUICK.find(x => x.id === tg.dataset.qs);
        if (q) { q.set(!q.on()); setTimeout(redraw, 60); }
        return true;
    }
    return false;
}
function onQuickInput(e) {
    if (!e.target.matches || !e.target.matches('[data-qs-vol]')) return;
    const m = mod('music');
    if (!m || !m._config) return;
    m._config.volume = Math.max(0, Math.min(1, +e.target.value / 100));
    store('music').save();
    if (m._tick) m._tick();
}

// the same block from the channel header's ⋯ menu
let qsPop = null;
function openQuick(anchor) {
    if (qsPop) { qsPop.close(); return; }
    const box = document.createElement('div');
    const draw = () => { box.innerHTML = fc.ui.popHead({ icon: 'bolt', title: T('Quick settings') }) + `<div class="fc-pb">${quickHtml()}</div>` +
        fc.ui.popFoot('', fc.ui.btn('All settings', { kind: 'sec', size: 'sm', icon: 'gear', act: 'qs-all' })); };
    draw();
    box.addEventListener('click', (e) => {
        if (onQuick(e, draw)) return;
        if (e.target.closest('[data-act="qs-all"]')) { if (qsPop) qsPop.close(); const st = mod('fightcord'); if (st && st.open) st.open(); }
    });
    box.addEventListener('input', onQuickInput);
    const at = anchor || document.querySelector('.channelToolbar [data-hdr-core="more"]') || { x: window.innerWidth - 300, y: 60 };
    const me = qsPop = fc.ui.popover(at, box, { width: 280, cls: 'fc-pop-card fcQs', onClose: () => { if (qsPop === me) qsPop = null; } });
}

/* --------------------------------------------------------------------- card */

function cardHtml() {
    const d = data();
    const t = d.tally;
    const dnd = fc.ui.dnd();
    const st = d.status === 'live' ? 'playing' : d.status === 'away' ? 'away' : dnd ? 'dnd' : 'on';
    const statusText = T({ playing: 'In a match', away: 'Away', dnd: 'Do not disturb', on: 'Online' }[st]);
    const art = d.main && d.main.rom ? fc.data.artUrl(d.main.rom, 'https://web.fightcade.com/') : '';
    const banner = art ? `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.45)),url(&quot;${E(art)}&quot;) center 30%/cover,var(--fc-brand)`
        : 'linear-gradient(120deg,var(--fc-accent),#8b5cf6 60%,#22e3f2)';
    const streak = d.tStreak.n >= 2 ? (d.tStreak.kind === 'won' ? T('{n} win streak', { n: d.tStreak.n }) : T('{n} losses in a row', { n: d.tStreak.n })) : '';
    const stats = fc.ui.stats([
        { label: 'Tonight', value: d.tonight ? E(d.tRec.w + '–' + d.tRec.l) : '—',
            sub: (d.tStreak.n >= 2 && d.tStreak.kind === 'won' ? fc.ui.ic('flame', 'fill') : '') + E(streak || (d.tonight ? T.plural(d.tonight, '{n} set', '{n} sets') : T('no sets yet'))) },
        { label: 'All time', value: t ? E(t.w + '–' + t.l) : '—', sub: E(t && t.rate != null ? Math.round(t.rate * 100) + '% · ' + T.plural(t.n, '{n} set', '{n} sets') : T('play a set first')) },
        { label: 'Best streak', value: d.st && d.st.bestW ? E(d.st.bestW + 'W') : '—', sub: E(T('longest run of wins')) },
        { label: 'Main game', value: E(d.main ? d.main.name : '—'), sub: d.main ? E(T.plural(d.main.n, '{n} set', '{n} sets')) : '', title: d.main ? d.main.name : '' }
    ]);
    const g = mod('goals');
    return fc.ui.cardHead({
        name: d.me || T('You'), banner,
        avatar: fc.ui.avatar(d.me, { size: 72, status: st, ring: 'var(--fc-s0)' }),
        meta: `<span class="pcSt ${st}">${E(statusText)}</span>`
    }) + `<div class="pcBody">${stats}
        ${g && g.summaryHtml ? g.summaryHtml() : ''}
        ${d.friends.length ? `<div class="pcSec"><div class="fc-card-h">${E(T('Friends online'))}</div><div class="pcFriends">${d.friends.slice(0, 6).map(n =>
            `<img src="${E(fc.data.avatarUrl(n, (fc.app.user(n)[1] || {}).gravatar, 64))}" title="${E(n)}" alt="" onerror="this.style.visibility='hidden'">`).join('')}${d.friends.length > 6 ? `<em>+${d.friends.length - 6}</em>` : ''}</div></div>` : ''}
        <div class="pcSec"><div class="fc-card-h">${E(T('Quick settings'))}</div>${quickHtml()}</div>
        <div class="pcFoot">
            <span class="pcSeg"><span class="${d.status !== 'away' ? 'on' : ''}" data-pc="online"><i class="dot on"></i>${E(T('Online'))}</span><span class="${d.status === 'away' ? 'on' : ''}" data-pc="away"><i class="dot away"></i>${E(T('Away'))}</span></span>
            ${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'chart', title: 'Stats', attrs: 'data-pc="stats"' })}${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'users', title: 'Friends', attrs: 'data-pc="friends"' })}${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'gear', title: 'Settings', attrs: 'data-pc="settings"' })}${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'logout', title: 'Log out', cls: 'pcOut', attrs: 'data-pc="logout"' })}
        </div></div>`;
}

function redraw() { const c = document.getElementById('pcCard'); if (c) c.innerHTML = cardHtml(); }

function closeFc() {
    const r = fc.app.root();
    const tb = r && r.$refs && r.$refs.mainToolbar;
    if (tb && 'showGlobalStateMenu' in tb) tb.showGlobalStateMenu = false;
    const m = document.querySelector('.userStateMenu.active');
    if (m) m.classList.remove('active');
    hide();
}

function onClick(e) {
    e.stopPropagation();
    if (onQuick(e, redraw)) return;
    const b = e.target.closest('[data-pc]');
    const a = b && b.dataset.pc;
    if (!a) return;
    const fcMenu = document.querySelector('.buttonBar .userButton .userStateMenu');
    if (a === 'online' || a === 'away') {
        const opts = fcMenu ? fcMenu.querySelectorAll('.optionWrapper') : [];
        const el = opts[a === 'online' ? 0 : 1];
        if (el) el.click();
        setTimeout(redraw, 120);
        return;
    }
    if (a === 'logout') {
        const lo = fcMenu && fcMenu.querySelector('.logOutWrapper .button');
        closeFc();
        if (lo) lo.click();
        return;
    }
    closeFc();
    const m = mod(a === 'settings' ? 'fightcord' : a);
    if (m && m.open) m.open();
}

let unlayer = null;
function show() {
    document.documentElement.classList.add('fcpc-on');
    let c = document.getElementById('pcCard');
    if (!c) {
        c = document.createElement('div');
        c.id = 'pcCard';
        c.addEventListener('click', onClick);
        c.addEventListener('input', onQuickInput);
        c.addEventListener('mousedown', (e) => e.stopPropagation());
        document.body.appendChild(c);
    }
    c.innerHTML = cardHtml();
    const rail = document.querySelector('.mainToolbarWrapper .mainToolbar');
    c.style.left = ((rail ? rail.getBoundingClientRect().right : 72) + 10) + 'px';
    setTimeout(() => c.classList.add('in'), 16);
    if (!unlayer) unlayer = fc.ui.layer(() => closeFc());
}

function hide() {
    const c = document.getElementById('pcCard');
    if (c) c.remove();
    if (unlayer) { unlayer(); unlayer = null; }
}

// follow Fightcade's own open / closed state of the status menu
let lastOpen = false;
function poll() {
    const open = !!document.querySelector('.buttonBar .userButton .userStateMenu.active');
    if (open !== lastOpen) { lastOpen = open; if (open) show(); else hide(); }
}

const CSS = `
html.fcpc-on .buttonBar .userButton .userStateMenu { opacity: 0 !important; pointer-events: none !important; }
#pcCard { position: fixed; bottom: 12px; z-index: calc(var(--fc-z-pop) + 4); width: 320px; max-height: calc(100vh - 24px); overflow-x: hidden; overflow-y: auto;
    border-radius: var(--fc-r3); background: var(--fc-s0); color: var(--fc-text); font: 14px/1.35 var(--fc-font);
    box-shadow: 0 0 0 1px var(--fc-divider), var(--fc-sh3); opacity: 0; transform: translateY(10px) scale(.98);
    transition: opacity var(--fc-fast) ease, transform var(--fc-med) var(--fc-ease); }
#pcCard.in { opacity: 1; transform: none; }
#pcCard .fc-ch-banner { height: 64px; image-rendering: pixelated; }
#pcCard .fc-ch-body { padding-top: 44px; }
#pcCard .fc-ch-av { top: -44px; }
.fc-avatar > .st.dnd { background: var(--fc-danger); }
#pcCard .pcSt { font-weight: 600; color: var(--fc-success); }
#pcCard .pcSt.away { color: var(--fc-warning); } #pcCard .pcSt.playing, #pcCard .pcSt.dnd { color: var(--fc-danger); }
#pcCard .pcBody { padding: 0 16px 12px; }
#pcCard .fc-stat > small .fc-ic { margin-right: 3px; color: var(--fc-warning); }
#pcCard .pcSec { margin-top: 10px; }
#pcCard .pcSec .fc-card-h { margin-bottom: 6px; font-size: 11px; }
#pcCard .fcglSum { margin-top: 6px; }
#pcCard .pcFriends { display: flex; align-items: center; }
#pcCard .pcFriends img { width: 28px; height: 28px; margin-right: -6px; border-radius: 50%; box-shadow: 0 0 0 3px var(--fc-s0); background: var(--fc-s1); }
#pcCard .pcFriends em { margin-left: 12px; font-style: normal; font-size: 12px; color: var(--fc-muted); }
#pcCard .pcFoot { display: flex; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--fc-divider); }
#pcCard .pcFoot > .fc-btn { margin-left: 2px; }
#pcCard .pcFoot > .pcOut:hover { background: var(--fc-danger); color: #fff; }
#pcCard .pcSeg { display: flex; flex: 1; margin-right: 6px; padding: 2px; border-radius: var(--fc-r2); background: var(--fc-s1); }
#pcCard .pcSeg > span { display: flex; align-items: center; justify-content: center; flex: 1; height: 26px; border-radius: 6px; cursor: pointer;
    font-size: 12.5px; font-weight: 600; color: var(--fc-muted); }
#pcCard .pcSeg > span:hover { color: var(--fc-text); }
#pcCard .pcSeg > span.on { background: var(--fc-s3); color: var(--fc-head); }
#pcCard .pcSeg .dot { width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; }
#pcCard .pcSeg .dot.on { background: var(--fc-success); } #pcCard .pcSeg .dot.away { background: var(--fc-warning); }

/* quick settings (also in the ⋯ menu pop-up) */
.qsLooks { display: flex; margin-bottom: 8px; }
.qsLook { width: 28px; height: 28px; margin-right: 8px; border-radius: 50%; cursor: pointer; box-shadow: 0 0 0 1px rgba(255,255,255,.12);
    transition: transform var(--fc-fast); }
.qsLook:hover { transform: scale(1.1); }
.qsLook.on { box-shadow: 0 0 0 2px var(--fc-s0), 0 0 0 4px var(--fc-accent); }
.qsTgs { display: flex; flex-wrap: wrap; margin: 0 -3px; }
.qsTg + .qsTg { margin-top: 0; }
.qsTg { display: flex; align-items: center; flex: 1 1 100%; min-width: 0; box-sizing: border-box; margin: 3px; padding: 6px 8px;
    border-radius: var(--fc-r2); background: var(--fc-s2); cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--fc-text); user-select: none; }
.qsTg:hover { background: var(--fc-s3); }
.qsTg > .fc-ic { width: 15px; height: 15px; flex: none; margin-right: 6px; color: var(--fc-muted); }
.qsTg > span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.qsTg > i { position: relative; flex: none; width: 24px; height: 14px; margin-left: 6px; border-radius: 7px; background: var(--fc-s4); transition: background var(--fc-fast); }
.qsTg > i::after { content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; transition: left var(--fc-fast); }
.qsTg.on > i { background: var(--fc-success); }
.qsTg.on > i::after { left: 12px; }
.qsTg.on > .fc-ic { color: var(--fc-success); }
.qsTg.dnd.on > i { background: var(--fc-danger); }
.qsTg.dnd.on > .fc-ic { color: var(--fc-danger); }
.qsVol { display: flex; align-items: center; margin-top: 6px; padding: 0 4px; color: var(--fc-muted); }
.qsVol .fc-ic { width: 14px; height: 14px; flex: none; margin-right: 8px; }
.qsVol input { flex: 1; min-width: 0; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    window.__fcProfileLoaded = true;
    fc.ui.style('pcStyle', CSS);
    document.documentElement.classList.add('fcpc-on');       // the card replaces Fightcade's small menu
    fc.own(() => { fc.ui.style('pcStyle', null); hide(); if (qsPop) qsPop.close(); document.documentElement.classList.remove('fcpc-on'); window.__fcProfileLoaded = false; });
    fc.tick(poll, 150);
    fc.on('dnd:changed', () => redraw());
    fc.own(fc.ui.header.more({ id: 'quick-settings', label: N_('Quick settings'), icon: 'bolt', order: 90, fn: () => setTimeout(() => openQuick(), 0) }));
    return api;
}

const api = { _show: () => show(), _hide: () => hide(), _data: () => data(), openQuick: (a) => openQuick(a), _quick: () => QUICK.map(q => ({ id: q.id, on: q.on() })) };

module.exports = { id: 'profile-card', name: 'Profile popout', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
