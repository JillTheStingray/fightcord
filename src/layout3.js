/**
 * Fightcord 3.0 layout: Fightcade the way Discord looks since its 2025 refresh
 *
 *   - a title bar across the top: where you are, and Inbox / Help on the right
 *   - your panel floating at the bottom-left: avatar, name and status, then the mic (voice chat),
 *     headset (music) and gear (Fightcord settings)
 *   - the channel in a rounded panel beside the darker rail and title bar, a roomier message box
 *   - Density: Compact / Default / Spacious
 *
 * A layer on top of the Discord theme's layout (html.dc-refresh): it only applies while the
 * theme's layout layer is on, and Settings -> Appearance -> Layout -> Classic takes it off again,
 * back to the 2.x look. Fightcade's own buttons stay on the page (hidden): the panel and the title
 * bar click them, so everything they do still works the way Fightcade does it.
 */
'use strict';

let fc = null;
let store = null, cfg = null;            // layout3-config.json
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
const N_ = (s) => s;
const mod = (id) => fc.modules.get(id);

const TOP = 32;                          // the title bar's height
const DENSITY = { compact: N_('Compact'), default: N_('Default'), spacious: N_('Spacious') };
const STATUS = { on: N_('Online'), away: N_('Away'), dnd: N_('Do not disturb') };

/* ---------------------------------------------------------------- pure parts */

// what the title bar says for the view on screen
//   id: Fightcade's active channel id; name: its full name (game channels)
function whereLabel(id, name) {
    if (!id || id === 'welcome-channel') return { kind: 'home', text: N_('Home') };
    if (id === 'about-channel') return { kind: 'home', text: N_('Start') };
    if (id === 'patreon-channel') return { kind: 'home', text: 'Patreon' };
    if (id === 'search-channel') return { kind: 'search', text: N_('Browse games') };
    return { kind: 'channel', text: String(name || id).replace(/\s*\([^)]*\)\s*$/, '') };
}

// where your panel goes: over the rail + member list when the list is on the left, else over the list
//   -> { left, width } in px
function panelBox(o) {
    const rail = o.rail || 72, list = o.list || 0, vw = o.vw || 1440, m = 8;
    if (o.listLeft !== false || !list) return { left: m, width: rail + (list || 240) - 2 * m };
    return { left: vw - list + m, width: list - 2 * m };
}

// a..b by t, as #rrggbb (the side panels sit between the rail's and the chat's colours)
function mix(a, b, t) {
    const p = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const x = p(a), y = p(b);
    if (!x || !y) return '';
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ the parts */

const on = () => !!cfg && cfg.enabled !== false && document.documentElement.classList.contains('dc-layout');

let bar = null, panel = null;
function ensureParts() {
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'l3Title';
        bar.innerHTML = `<div class="l3Where"><span class="l3Ic"></span><b></b></div>
            <div class="l3Acts"><span class="l3Btn" data-l3="inbox"><span class="l3BI">${fc.ui.icon('bell')}</span><i class="l3Dot"></i></span>
            <span class="l3Btn" data-l3="help"><span class="l3BI">${fc.ui.icon('help')}</span></span></div>`;
        bar.addEventListener('mousedown', (e) => e.stopPropagation());
        bar.addEventListener('click', onClick);
        document.body.appendChild(bar);
    }
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'l3Panel';
        panel.innerHTML = `<div class="l3Me" data-l3="me"><span class="l3Av"><img alt=""><i class="l3St"></i></span><span class="l3Who"><b></b><small></small></span></div>
            <span class="l3Btn" data-l3="voice"><span class="l3BI">${fc.ui.icon('mic')}</span></span>
            <span class="l3Btn" data-l3="music"><span class="l3BI">${fc.ui.icon('headset')}</span></span>
            <span class="l3Btn" data-l3="settings"><span class="l3BI">${fc.ui.icon('gear')}</span></span>`;
        panel.addEventListener('mousedown', (e) => e.stopPropagation());
        panel.addEventListener('click', onClick);
        document.body.appendChild(panel);
    }
}
function removeParts() {
    if (bar) { bar.remove(); bar = null; }
    if (panel) { panel.remove(); panel = null; }
}

// voice chat / music on and off, the same way the profile card's quick settings do it
const voiceOn = () => { const v = mod('voice'); return v && v.enabled ? !!v.enabled() : null; };
const musicOn = () => { const m = mod('music'); return m && m._config && m._config.track ? !!m._config.enabled : null; };
function setVoice(v) { const s = fc.config('voice', {}); s.data.enabled = v; s.save(); fc.emit('voice:changed', { on: v }); fc.settings.refresh('voice'); }
function setMusic(v) { const m = mod('music'); if (!m || !m._config) return; m._config.enabled = v; fc.config('music', {}).save(); if (m._tick) m._tick(); fc.settings.refresh('music'); }

function fcButton(sel) { return document.querySelector('.mainToolbar .buttonBar ' + sel); }

function onClick(e) {
    const b = e.target.closest('[data-l3]');
    if (!b) return;
    e.stopPropagation();
    const a = b.dataset.l3;
    if (a === 'inbox') { const n = fcButton('.notificationsButton'); if (n) n.click(); }
    else if (a === 'help') helpMenu(b);
    else if (a === 'me') { const u = fcButton('.userButton .userAvatarWrapper') || fcButton('.userButton'); if (u) u.click(); }
    else if (a === 'voice') { const v = voiceOn(); if (v != null) setVoice(!v); }
    else if (a === 'music') { const m = musicOn(); if (m != null) setMusic(!m); }
    else if (a === 'settings') { const s = mod('fightcord'); if (s && s.open) s.open(); }
    setTimeout(update, 50);
}

function helpMenu(anchor) {
    const w = mod('welcome');
    fc.ui.menu(anchor, [
        { label: T('Take the tour'), icon: 'target', fn: () => w && w.tour && w.tour() },
        { label: T('What’s new'), icon: 'star', fn: () => w && w.news && w.news() },
        { label: T('Fightcord settings'), icon: 'gear', fn: () => { const s = mod('fightcord'); if (s && s.open) s.open(); } },
        { label: T('Fightcade settings'), icon: 'gear', fn: () => { const s = fcButton('.settingsButton'); if (s) s.click(); } }
    ], { side: 'bottom', cls: 'l3HelpMenu' });
}

/* ------------------------------------------------------------------- update */

let sideFor = '';
function update() {
    const html = document.documentElement;
    const live = on();
    html.classList.toggle('dc-refresh', live);
    html.classList.toggle('l3-tb', live);
    html.classList.toggle('l3-panel', live);
    Object.keys(DENSITY).forEach(d => html.classList.toggle('dc-dens-' + d, live && cfg.density === d && d !== 'default'));
    if (!live) { removeParts(); return; }
    ensureParts();
    // the side panels' colour: between the rail's (darkest) and the chat's (per theme)
    const cs = getComputedStyle(html);
    const sig = cs.getPropertyValue('--dc-bg').trim() + cs.getPropertyValue('--dc-bg3').trim();
    if (sig !== sideFor) {
        sideFor = sig;
        const side = mix(cs.getPropertyValue('--dc-bg3').trim(), cs.getPropertyValue('--dc-bg').trim(), 0.45);
        if (side) html.style.setProperty('--l3-side', side); else html.style.removeProperty('--l3-side');
    }

    // where you are
    const r = fc.app.root();
    const id = (r && r.activeChannelId) || '';
    const ch = id ? fc.app.channel(id) : null;
    const w = whereLabel(id, ch && ch.name);
    // a Fightcord page over the channel (a lobby, Stats...): its title
    const pg = [...document.querySelectorAll('.fc-page:not(.fc-out)')].pop();
    const pgIc = pg && pg.querySelector('.fc-page-h .t > .fc-ic');
    if (pg) { w.kind = 'page'; w.text = (pg.querySelector('.fc-page-h .tt') || {}).textContent || ''; }
    const rail = document.querySelector('.channelItemWrapper .channelItem.active');
    const art = w.kind === 'channel' && rail ? rail.style.backgroundImage : '';
    const ic = bar.querySelector('.l3Ic');
    fc.ui.setHtml(ic, art ? '' : pg ? (pgIc ? pgIc.outerHTML : fc.ui.icon('hash')) : fc.ui.icon(w.kind === 'home' ? 'home' : w.kind === 'search' ? 'search' : 'hash'));
    if (ic.style.backgroundImage !== (art || '')) ic.style.backgroundImage = art || '';
    ic.classList.toggle('art', !!art);
    const label = w.kind === 'channel' || w.kind === 'page' ? w.text : T(w.text);
    const nb = bar.querySelector('.l3Where b');
    if (nb.textContent !== label) {
        nb.textContent = label;
        // a new place: the title slides in again
        const wh = bar.querySelector('.l3Where');
        wh.classList.remove('l3Chg'); void wh.offsetWidth; wh.classList.add('l3Chg');
    }
    // Fightcade's own unread marker on its bell
    const ind = fcButton('.notificationsIndicator');
    bar.querySelector('[data-l3="inbox"]').classList.toggle('unread', !!(ind && ind.style.display !== 'none' && getComputedStyle(ind).display !== 'none'));
    setTip(bar.querySelector('[data-l3="inbox"]'), T('Inbox'));
    setTip(bar.querySelector('[data-l3="help"]'), T('Help'));

    // you
    const me = fc.app.me() || '';
    const u = fc.app.user(me)[1] || fc.app.localUser() || {};
    const img = panel.querySelector('.l3Av img');
    const src = me ? fc.data.avatarUrl(me, u.gravatar, 64) : '';
    if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
    const st = fc.ui.dnd && fc.ui.dnd() ? 'dnd' : fc.app.status(me) === 'away' ? 'away' : 'on';
    const sd = panel.querySelector('.l3St');
    if (sd.className !== 'l3St ' + st) sd.className = 'l3St ' + st;
    const pr = mod('presence');
    const p = pr && pr.rawProfile ? pr.rawProfile() : null;
    const sub = (p && p.s) || T(STATUS[st]);
    const wb = panel.querySelector('.l3Who b'), ws = panel.querySelector('.l3Who small');
    if (wb.textContent !== me) wb.textContent = me;
    if (ws.textContent !== sub) ws.textContent = sub;
    setTip(panel.querySelector('[data-l3="me"]'), T('Your profile and status'));
    const v = voiceOn(), m = musicOn();
    toggleBtn('voice', v, T(v ? 'Voice chat: on' : 'Voice chat: off'));
    toggleBtn('music', m, T(m ? 'Music: on' : 'Music: off'));
    setTip(panel.querySelector('[data-l3="settings"]'), T('Fightcord settings'));

    // over the rail + member list (list on the left), or over the list (on the right)
    const list = document.querySelector('.channelWrapper:not([style*="none"]) .usersListToolbar');
    const lw = list && list.offsetWidth ? list.offsetWidth : 0;
    // no side column under it (Fightcade's start page, Patreon): just your avatar, at the foot of the rail
    const side = lw > 0 || html.classList.contains('fcd-browse');
    html.classList.toggle('l3-panel-mini', !side);
    const box = side ? panelBox({ rail: 72, list: lw, vw: window.innerWidth, listLeft: html.classList.contains('fcm-left') }) : { left: 8, width: 56 };
    if (panel.style.left !== box.left + 'px') panel.style.left = box.left + 'px';
    if (panel.style.width !== box.width + 'px') panel.style.width = box.width + 'px';
    html.classList.toggle('l3-panel-right', box.left > 72);
    // Fightcade's own settings / notifications cover the window (like Discord's settings): the panel steps aside
    html.classList.toggle('l3-covered', !!document.querySelector('.settingsWrapper.active, .notificationsWrapper.active'));
}
function toggleBtn(id, state, tip) {
    const b = panel.querySelector('[data-l3="' + id + '"]');
    const hide = state == null;
    if (b.hidden !== hide) b.hidden = hide;
    b.classList.toggle('off', state === false);
    setTip(b, tip);
}
function setTip(el, t) { if (el && el.title !== t) el.title = t; }

/* -------------------------------------------------------------------- style */

const CSS = `
/* ---- the title bar */
#l3Title { display: none; }
html.l3-tb #l3Title { position: fixed; top: 0; left: 0; right: 0; height: ${TOP}px; z-index: 45; display: flex; align-items: center; justify-content: center;
    background: var(--dc-bg3); color: var(--dc-muted); font: 600 13px/${TOP}px var(--fc-font); user-select: none; }
#l3Title .l3Where { display: flex; align-items: center; min-width: 0; max-width: 50vw; }
#l3Title .l3Where.l3Chg { animation: fcRise var(--fc-med) var(--fc-ease) both; }
#l3Title .l3Where b { font-weight: 600; color: var(--dc-text); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#l3Title .l3Ic { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; margin-right: 8px; border-radius: 5px;
    background: center / cover no-repeat; color: var(--dc-icon); image-rendering: pixelated; }
#l3Title .l3Ic .fc-ic { width: 16px; height: 16px; }
#l3Title .l3Acts { position: absolute; right: 10px; top: 0; height: ${TOP}px; display: flex; align-items: center; }
/* ---- small icon buttons (title bar + your panel) */
.l3Btn { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px;
    color: var(--dc-icon); cursor: pointer; transition: background-color var(--fc-fast) ease, color var(--fc-fast) ease; }
#l3Title .l3Btn { width: 28px; height: 24px; margin-left: 4px; border-radius: 6px; }
.l3Btn:hover { background: var(--dc-hover-2, rgba(255,255,255,.07)); color: var(--dc-head); }
.l3Btn:active .l3BI { transform: scale(.88); }
.l3BI { display: inline-flex; transition: transform var(--fc-fast) var(--fc-ease); }
.l3Btn .fc-ic { width: 20px; height: 20px; }
#l3Title .l3Btn .fc-ic { width: 18px; height: 18px; }
.l3Btn[hidden] { display: none; }
.l3Dot { position: absolute; top: 3px; right: 5px; width: 8px; height: 8px; border-radius: 50%; background: var(--dc-red); box-shadow: 0 0 0 2px var(--dc-bg3);
    transform: scale(0); transition: transform var(--fc-med) cubic-bezier(.3,1.6,.5,1); }
.l3Btn.unread .l3Dot { transform: scale(1); }
/* off: struck through in red, like Discord's muted mic */
.l3Btn.off { color: var(--dc-red); }
.l3Btn.off::after { content: ''; position: absolute; left: 50%; top: 50%; width: 22px; height: 2px; margin: -1px 0 0 -11px; border-radius: 1px;
    background: currentColor; box-shadow: 0 0 0 2px var(--l3-panel-bg, var(--dc-bg3)); transform: rotate(-45deg); }
.l3Btn.off:hover { background: rgba(242,63,67,.12); color: var(--dc-red); }

/* ---- your panel */
#l3Panel { display: none; }
html.l3-panel #l3Panel { position: fixed; bottom: 8px; left: 8px; height: 52px; z-index: 46; display: flex; align-items: center; padding: 0 8px 0 6px; box-sizing: border-box;
    --l3-panel-bg: var(--dc-input, #222327);
    border-radius: 10px; background: var(--l3-panel-bg); box-shadow: 0 0 0 1px var(--dc-divider), 0 6px 18px rgba(0,0,0,.35); font-family: var(--fc-font);
    animation: l3Up var(--fc-slow) var(--fc-ease) both; }
@keyframes l3Up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
html.l3-panel.l3-covered #l3Panel { opacity: 0; transform: translateY(12px); pointer-events: none; transition: opacity var(--fc-fast) ease, transform var(--fc-med) var(--fc-ease); }
html.l3-panel #l3Panel { transition: opacity var(--fc-fast) ease, transform var(--fc-med) var(--fc-ease); }
#l3Panel .l3Me { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; height: 40px; padding: 0 6px 0 4px; margin-right: 4px; border-radius: 8px; cursor: pointer;
    transition: background-color var(--fc-fast) ease; }
#l3Panel .l3Me:hover { background: rgba(255,255,255,.06); }
#l3Panel .l3Av { position: relative; flex: none; width: 32px; height: 32px; margin-right: 8px; }
#l3Panel .l3Av img { width: 32px; height: 32px; border-radius: 50%; display: block; background: var(--dc-bg3); }
#l3Panel .l3St { position: absolute; right: -2px; bottom: -2px; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 3px var(--l3-panel-bg); background: var(--dc-green); }
#l3Panel .l3St.away { background: var(--dc-yellow); }
#l3Panel .l3St.dnd { background: var(--dc-red); }
/* only your avatar (no side column under the panel) */
html.l3-panel-mini #l3Panel { padding: 0; justify-content: center; }
html.l3-panel-mini #l3Panel .l3Who, html.l3-panel-mini #l3Panel > .l3Btn { display: none; }
html.l3-panel-mini #l3Panel .l3Me { flex: none; margin: 0; padding: 0 4px; }
html.l3-panel-mini #l3Panel .l3Av { margin: 0; }
#l3Panel .l3Who { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
#l3Panel .l3Who b { font-size: 14px; font-weight: 600; color: var(--dc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#l3Panel .l3Who small { font-size: 12px; color: var(--dc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

/* ---- the window: everything moves under the title bar */
html.l3-tb #app { position: relative !important; top: ${TOP}px !important; height: calc(100% - ${TOP}px) !important; }
html.l3-tb .fc-page { top: ${TOP}px !important; }
html.l3-tb #fcdNav { top: ${TOP}px !important; }
html.l3-panel #fcdNav { padding-bottom: 68px !important; box-sizing: border-box !important; }
html.dc-refresh .mainToolbarWrapper { flex: none !important; }
/* Fightcade's bell / gear / avatar stay on the page for the panel and the title bar to click; the rail ends above the panel */
html.l3-panel .mainToolbar .buttonBar { height: 68px !important; min-height: 0 !important; padding: 0 !important; overflow: hidden !important; visibility: hidden !important; }
html.l3-panel .mainToolbar .buttonBar .userButton .userStateMenu { visibility: hidden !important; }
/* your profile card opens above your panel */
html.l3-panel #pcCard { left: 8px !important; bottom: 68px !important; max-height: calc(100vh - 80px) !important; }
html.l3-panel.l3-tb #pcCard { max-height: calc(100vh - ${80 + TOP}px) !important; }
html.l3-panel.l3-panel-right #pcCard { left: auto !important; right: 8px !important; }

/* ---- the side panels (rail = title bar colour, member list a step lighter, the channel lightest) */
html.dc-refresh body .usersListToolbar, html.dc-refresh body .usersListToolbar .usersListWrapper { background: var(--l3-side, var(--dc-bg2)) !important; }
html.l3-tb.dc-layout body .usersListToolbar .usersListWrapper { top: ${48 + TOP}px !important; }
/* the list ends above your panel (its column's colour carries on behind the panel, like Discord's sidebar) */
html.l3-panel.fcm-left.dc-layout body .usersListToolbar .usersListWrapper,
html.l3-panel.l3-panel-right.dc-layout body .usersListToolbar .usersListWrapper { bottom: 68px !important; }
html.l3-panel .mainToolbar .channelsList { border-bottom: 0 !important; }
/* the channel in a rounded panel against the rail and the title bar */
html.dc-refresh body #app > .channelWrapper { border-top-left-radius: 12px; overflow: hidden; box-shadow: inset 1px 1px 0 var(--dc-divider); }
html.dc-refresh body .cbnBanner { border-top-left-radius: 12px; }
html.dc-refresh.fcm-left.dc-layout body .usersListToolbar .usersListWrapper { border-top-left-radius: 12px; border-right: 1px solid var(--dc-divider) !important; }

/* ---- the message box: bigger, rounder, no border */
html.dc-refresh body .chatInput input.input { height: 54px !important; border: 0 !important; border-radius: 10px !important; background: var(--dc-input) !important;
    box-shadow: 0 0 0 1px transparent !important; transition: box-shadow var(--fc-fast) ease !important; }
html.dc-refresh body .chatInput input.input:focus { box-shadow: 0 0 0 1px var(--dc-input-edge) !important; }
html.dc-refresh body .chatInput { padding: 0 16px 16px !important; }

/* ---- small motions: hovers fade instead of snapping */
html.dc-refresh body .chatContent .message.chat .line,
html.dc-refresh body .usersListWrapper .userItem { transition: background-color var(--fc-fast) ease !important; }
html.dc-refresh body .channelItemWrapper .channelItem { transition: border-radius var(--fc-med) var(--fc-ease), background-color var(--fc-fast) ease, transform var(--fc-fast) var(--fc-ease) !important; }
html.dc-refresh body .channelItemWrapper .channelItem:active { transform: translateY(1px) scale(.96); }

/* ---- density: how much room messages and rows get */
html.dc-dens-compact body .chatContent .messageWrapper.chat { margin-top: 6px !important; }
html.dc-dens-compact body .usersListWrapper .userItem { height: 34px !important; min-height: 34px !important; }
html.dc-dens-spacious body .chatContent .messageWrapper.chat { margin-top: 24px !important; }
html.dc-dens-spacious body .chatContent .message.chat .line { padding-top: .25em !important; padding-bottom: .25em !important; }
html.dc-dens-spacious body .usersListWrapper .userItem { height: 48px !important; min-height: 48px !important; margin-bottom: 4px !important; }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('layout3', { enabled: true, density: 'default' });
    cfg = store.data;
    if (!DENSITY[cfg.density]) cfg.density = 'default';
    fc.ui.style('l3Style', CSS);
    fc.own(() => {
        removeParts();
        fc.ui.style('l3Style', null);
        const html = document.documentElement;
        ['dc-refresh', 'l3-tb', 'l3-panel', 'l3-panel-right', 'l3-covered', 'l3-panel-mini', 'dc-dens-compact', 'dc-dens-spacious'].forEach(c => html.classList.remove(c));
        html.style.removeProperty('--l3-side');
    });
    fc.watch(update, { selector: '#app' });
    fc.tick(update, 1500);
    ['voice:changed', 'presence:profile', 'presence:changed', 'friends:changed'].forEach(ev => fc.on(ev, () => setTimeout(update, 30)));
    window.addEventListener('resize', update);
    fc.own(() => window.removeEventListener('resize', update));
    // opening / closing Fightcade's settings or notifications only flips a class: look again right after a click
    const soon = () => setTimeout(update, 80);
    document.addEventListener('click', soon, true);
    fc.own(() => document.removeEventListener('click', soon, true));
    fc.settings.block({
        id: 'layout3', section: 'appearance', title: 'Layout', hint: '— how the window is laid out', store, order: 2,
        fields: [
            { key: 'enabled', type: 'select', label: 'Layout', hint: 'New: like Discord since 2025 (a title bar, your panel at the bottom-left). Classic: the 2.x look',
                options: [[true, N_('New (Fightcord 3.0)')], [false, N_('Classic')]], onChange: () => update() },
            { key: 'density', type: 'select', label: 'Density', hint: 'How much room messages and the member list get',
                options: Object.keys(DENSITY).map(k => [k, DENSITY[k]]), show: (d) => d.enabled !== false, onChange: () => update() }
        ]
    });
    update();
    return api;
}

const api = {
    update: () => update(),
    active: () => on(),
    _parts: () => ({ bar, panel })
};

module.exports = { id: 'layout3', name: 'Fightcord 3.0 layout', needs: ['discord-theme'], start, whereLabel, panelBox, mix, TOP, DENSITY };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
