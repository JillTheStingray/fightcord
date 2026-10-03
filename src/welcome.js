/**
 * Fightcord welcome: the first-run screen, the spotlight tour and "What's new"
 *
 * First start (nothing set up yet): five short steps -- the look (theme + accent, applied live),
 * which modules run (Lite / Full / Competitive), music, friends & notes, and a tour that
 * spotlights the real parts of Fightcade one by one.
 * After an update: a "What's new" card, once per version that has news.
 * Both can be replayed from Settings -> About (or /welcome, /tour).
 * People who already used Fightcord before this module existed skip the first-run screen and
 * just get "What's new".
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, cfg = null;          // welcome-config.json
const E = (s) => fc.fmt.esc(s);
const mod = (id) => fc.modules.get(id);

/* ---------------------------------------------------------------- versions */

// the news for each version that has some ('1.9' = the 2.0 betas, so they show it too)
const NEWS = [
    { v: '1.9', title: 'Fightcord 2.0', items: [
        ['bolt', 'Faster and lighter', 'One shared core instead of 24 separate plugins: one timer, one page watcher, one Fightcade API client.'],
        ['gear', 'New settings', 'Search every setting, one-click profiles, backup & restore, and a Diagnostics page. Ctrl+, opens it.'],
        ['trend', 'Rank & ELO history', 'Stats → Progress charts your rank over time — with a celebration when you rank up.'],
        ['target', 'Training goals', 'Win 5 sets, beat 3 A-ranks, play an hour… tracked live by the ring next to your session record.'],
        ['chart', 'Match analytics', 'Win rate by opponent rank, ping and hour of day, plus a tilt check. Stats → Analytics.'],
        ['bell', 'Lobby feed', 'The Feed button in every channel: joins, matches you can watch, upsets and streaks.']
    ] }
];

function cmpVer(a, b) {
    const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    return 0;
}
const version = () => { const s = mod('fightcord'); return (s && s.version && s.version()) || '0.0.0'; };
const minor = (v) => String(v).split('.').slice(0, 2).join('.');

// the newest news you haven't seen and that this version already has
function pendingNews(seen, current) {
    return NEWS.filter(n => cmpVer(n.v, seen) > 0 && cmpVer(n.v, minor(current)) <= 0).slice(-1)[0] || null;
}

// used Fightcord before this module came along?
function veteran() {
    if (fc.history.all().length) return true;
    return ['friends-config.json', 'discord-theme-config.json', 'scout-config.json'].some(f => fs.existsSync(path.join(__dirname, f)));
}

/* ------------------------------------------------------------- the welcome */

const STEPS = ['look', 'features', 'music', 'friends', 'tour'];
const STEP_LABEL = { look: 'Look', features: 'Features', music: 'Music', friends: 'Friends', tour: 'Tour' };
const PREVIEW = {
    dark: ['#1e1f22', '#2b2d31', '#313338'], amoled: ['#000000', '#0a0a0a', '#151515'],
    classic: ['#202225', '#2f3136', '#36393f'], neon: ['#0d0f1f', '#151833', '#1c2045']
};

let screen = null, step = 0, unlayer = null;

function lookHtml() {
    const th = mod('discord-theme');
    if (!th || !th.theme) return `<h2>Make it yours</h2><p class="lead">The Discord theme is switched off right now — you can turn it on later in Settings → Appearance.</p>`;
    const t = th.theme(), presets = th.presets(), sw = th.swatches();
    return `<h2>Make it yours</h2><p class="lead">Pick a look — it changes right away, behind this window too.</p>
        <div class="wlcGrid">${Object.keys(PREVIEW).filter(k => presets[k]).map(k => `<div class="wlcPick${t.enabled && t.preset === k ? ' on' : ''}" data-preset="${k}">
            <div class="wlcPrev">${PREVIEW[k].map(c => `<i style="background:${c}"></i>`).join('')}<b style="background:${E(t.accent)}"></b></div><span>${E(presets[k])}</span></div>`).join('')}</div>
        <h3>Accent colour</h3><div class="wlcSwatches">${Object.keys(sw).map(n => `<span class="wlcSw${sw[n] === t.accent ? ' on' : ''}" data-accent="${sw[n]}" title="${E(n)}" style="background:${sw[n]}"></span>`).join('')}</div>`;
}

function featuresHtml() {
    const s = mod('fightcord');
    if (!s || !s.profiles) return '<h2>Features</h2><p class="lead">Choose which modules run in Settings → My Fightcord.</p>';
    const P = s.profiles(), cur = s.profile();
    return `<h2>How much Fightcord?</h2><p class="lead">You can change this any time in Settings → My Fightcord, or switch single modules on and off.</p>
        <div class="wlcGrid three">${Object.keys(P).map(k => `<div class="wlcPick big${cur === k ? ' on' : ''}" data-profile="${k}">${fc.ui.icon(P[k].icon)}<b>${E(P[k].label)}</b><span>${E(P[k].desc)}</span></div>`).join('')}</div>
        <div class="wlcNote" data-note="profile">${cur ? '' : 'Right now you’re on your own mix of modules.'}</div>`;
}

function musicHtml() {
    const m = mod('music');
    if (!m || !m.tracks) return `<h2>Lobby music</h2><p class="lead">Music is switched off in this profile. Turn the module on in Settings → My Fightcord if you want it.</p>`;
    const list = m.tracks(), cur = m.current();
    const s = mod('fightcord'), P = s && s.profiles ? s.profiles() : {}, prof = s && s.profile ? s.profile() : '';
    const offNext = prof && P[prof] && P[prof].off.includes('music.js');
    return `<h2>Lobby music</h2>${offNext ? `<div class="wlcNote">The ${E(P[prof].label)} profile you picked switches music off from the next start.</div>` : ''}<p class="lead">Fightcord can play a track on a loop while you’re in the lobby, and pause it during matches.
        It doesn’t come with any music — add your own mp3 or ogg.</p>
        <div class="wlcList">${list.map(f => `<div class="wlcRow${f === cur ? ' on' : ''}" data-track="${E(f)}">${fc.ui.icon('music')}<span>${E(f.replace(/\.[^.]+$/, ''))}</span></div>`).join('')}
            <div class="wlcRow${cur ? '' : ' on'}" data-track="">${fc.ui.icon('close')}<span>No music</span></div></div>
        <div class="wlcBtns">${fc.ui.btn('Add a track…', { kind: 'sec', icon: 'plus', act: 'add-track' })}</div>
        <input type="file" class="wlcFile" accept="audio/*,.mp3,.ogg,.wav,.m4a" style="display:none">`;
}

function friendsHtml() {
    const tip = (icon, b, s) => `<div class="wlcTip">${fc.ui.icon(icon)}<div><b>${b}</b><span>${s}</span></div></div>`;
    return `<h2>Friends & notes</h2><p class="lead">Fightcade has no friends list — Fightcord adds one, kept on your PC.</p>
        ${tip('star', 'Right-click anyone → Add friend', 'You’ll hear when friends come online or start a match, with a button to watch.')}
        ${tip('users', '/friends opens your list', 'Who’s online, what they’re playing, and your record against each of them.')}
        ${tip('note', 'Notes & tags', 'Right-click → Note (or /note name) to remember a player: “turtles”, “good games”. It shows on their challenge.')}
        ${tip('bell', 'The Feed', 'Every channel has a Feed button: who joined, matches to watch, upsets and streaks.')}`;
}

function tourHtml() {
    return `<h2>You’re all set</h2><p class="lead">A 30-second tour shows where everything is. You can replay it from Settings → About.</p>
        <div class="wlcBtns center">${fc.ui.btn('Take the tour', { kind: 'brand', size: 'lg', icon: 'play', act: 'tour' })}</div>
        <div class="wlcKeys"><span><kbd>Ctrl</kbd>+<kbd>,</kbd> settings</span><span><kbd>/help</kbd> every command</span><span><kbd>/stats</kbd> your stats</span></div>`;
}

const BODY = { look: lookHtml, features: featuresHtml, music: musicHtml, friends: friendsHtml, tour: tourHtml };

function render() {
    if (!screen) return;
    const id = STEPS[step];
    screen.querySelector('.wlcDots').innerHTML = STEPS.map((s, i) => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}" data-step="${i}">${E(STEP_LABEL[s])}</span>`).join('');
    const body = screen.querySelector('.wlcBody');
    body.innerHTML = `<div class="wlcStep">${BODY[id]()}</div>`;
    screen.querySelector('[data-act="back"]').style.visibility = step ? '' : 'hidden';
    screen.querySelector('[data-act="next"]').innerHTML = step === STEPS.length - 1 ? 'Finish' : 'Next';
    const file = body.querySelector('.wlcFile');
    if (file) file.addEventListener('change', () => addTrack(file));
}

async function addTrack(input) {
    const f = input.files && input.files[0];
    const m = mod('music');
    if (!f || !m) return;
    try { const name = await m.addTrack(f); m.pick(name); }
    catch (e) { fc.ui.toast('Couldn’t add that file', { sub: e.message, kind: 'danger', icon: 'warn' }); }
    render();
}

function openWelcome(at) {
    closeTour();
    step = Math.max(0, Math.min(STEPS.length - 1, at || 0));
    if (!screen) {
        screen = document.createElement('div');
        screen.id = 'wlcScreen';
        screen.innerHTML = `<div class="wlcCard"><div class="wlcHead"><div class="wlcLogo">${fc.ui.icon('bolt')}</div>` +
            `<div class="wlcTitle"><b>Welcome to Fightcord</b><span>Discord-style Fightcade — let’s set it up</span></div>` +
            `${fc.ui.btn('Skip', { kind: 'ghost', size: 'sm', act: 'skip', title: 'Skip — you can replay this from Settings → About' })}</div>` +
            `<div class="wlcDots"></div><div class="wlcBody"></div>` +
            `<div class="wlcFoot">${fc.ui.btn('Back', { kind: 'ghost', act: 'back' })}<span class="sp"></span>${fc.ui.btn('Next', { kind: 'brand', act: 'next' })}</div></div>`;
        screen.addEventListener('mousedown', (e) => e.stopPropagation());
        screen.addEventListener('click', onClick);
        document.body.appendChild(screen);
        unlayer = fc.ui.layer(() => finish());
    }
    render();
}

function onClick(e) {
    e.stopPropagation();
    const t = e.target;
    const d = t.closest('[data-step]');
    if (d) { step = +d.dataset.step; render(); return; }
    const pr = t.closest('[data-preset]');
    if (pr) { mod('discord-theme').setTheme({ preset: pr.dataset.preset, enabled: true }); render(); return; }
    const ac = t.closest('[data-accent]');
    if (ac) { mod('discord-theme').setTheme({ accent: ac.dataset.accent }); render(); return; }
    const pf = t.closest('[data-profile]');
    if (pf) {
        const s = mod('fightcord');
        const was = s.profile();
        if (s.applyProfile(pf.dataset.profile)) {
            render();
            if (was !== pf.dataset.profile) {
                const note = screen.querySelector('[data-note="profile"]');
                note.textContent = 'Saved — it takes effect the next time Fightcade starts.';
                note.classList.add('ok');
            }
        }
        return;
    }
    const tr = t.closest('[data-track]');
    if (tr) { mod('music').pick(tr.dataset.track); render(); return; }
    const a = t.closest('[data-act]');
    const act = a && a.getAttribute('data-act');
    if (act === 'add-track') screen.querySelector('.wlcFile').click();
    else if (act === 'back') { step = Math.max(0, step - 1); render(); }
    else if (act === 'next') { if (step < STEPS.length - 1) { step++; render(); } else finish(); }
    else if (act === 'skip') finish();
    else if (act === 'tour') { finish(); setTimeout(startTour, 250); }
}

function finish() {
    cfg.firstRunDone = true;
    cfg.seen = maxSeen(cfg.seen, minor(version()));
    store.save();
    if (unlayer) { unlayer(); unlayer = null; }
    if (screen) { screen.remove(); screen = null; }
}
const maxSeen = (a, b) => (cmpVer(a, b) >= 0 ? a : b);

/* -------------------------------------------------------------- what's new */

let newsModal = null;
function openNews(n) {
    const news = n || NEWS[NEWS.length - 1];
    if (!news || newsModal) return;
    const body = `<div class="wlcNews">${news.items.map(([icon, b, s]) => `<div class="wlcTip">${fc.ui.icon(icon)}<div><b>${E(b)}</b><span>${E(s)}</span></div></div>`).join('')}</div>`;
    newsModal = fc.ui.modal({
        title: 'What’s new in ' + news.title, body, width: 520,
        actions: [{ label: 'Take the tour', kind: 'ghost', fn: () => { setTimeout(startTour, 250); } }, { label: 'Got it' }],
        onClose: () => {
            newsModal = null;
            cfg.seen = maxSeen(cfg.seen, news.v);
            store.save();
        }
    });
}

/* -------------------------------------------------------------------- tour */

// (offsetParent is null for position: fixed, so look at the box instead)
const shown = (el) => !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
const visibleEl = (els) => [...els].find(shown) || null;
// several elements as one box
function union(els) {
    const rs = [...els].filter(shown).map(el => el.getBoundingClientRect());
    if (!rs.length) return null;
    const r = { left: Math.min(...rs.map(x => x.left)), top: Math.min(...rs.map(x => x.top)), right: Math.max(...rs.map(x => x.right)), bottom: Math.max(...rs.map(x => x.bottom)) };
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    return { getBoundingClientRect: () => r };
}
const STOPS = [
    { title: 'Your channels', text: 'The games you’ve joined. A channel glows when someone challenges you there.',
        find: () => union(document.querySelectorAll('.channelItemWrapper')), side: 'right' },
    { title: 'Channel tools', text: 'The Feed shows what’s happening here. Next to it: tonight’s record and the ring for your goals.',
        find: () => { const w = fc.app.channelElement(); const a = w && w.querySelector('.channelToolbar .channelActions'); return shown(a) ? a : null; }, side: 'bottom' },
    { title: 'Member list', text: 'Ranks, flags and who’s playing. Rest the mouse on someone for their card; right-click for friends, notes and more.',
        find: () => visibleEl(document.querySelectorAll('.usersListWrapper')), side: 'left' },
    { title: 'Chat commands', text: 'Type /help for every command: /stats, /feed, /friends, /theme, /goals…',
        find: () => { const c = fc.app.chatInput(); return shown(c) ? c : null; }, side: 'top' },
    { title: 'Settings, any time', text: 'Ctrl+, (or /fightcord) opens Fightcord’s settings. Replay this tour from Settings → About.', find: () => null }
];

let tour = null;     // { stops, i, spot, bubble, unlayer }

function startTour() {
    closeTour();
    const stops = STOPS.filter((s, i) => i === STOPS.length - 1 || s.find());
    const spot = document.createElement('div');
    spot.id = 'wlcSpot';
    const bubble = document.createElement('div');
    bubble.id = 'wlcBubble';
    bubble.addEventListener('mousedown', (e) => e.stopPropagation());
    bubble.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = e.target.closest('[data-act]');
        const act = a && a.getAttribute('data-act');
        if (act === 'next') { if (tour.i < tour.stops.length - 1) { tour.i++; place(); } else closeTour(); }
        else if (act === 'back') { tour.i = Math.max(0, tour.i - 1); place(); }
        else if (act === 'close') closeTour();
    });
    document.body.appendChild(spot);
    document.body.appendChild(bubble);
    tour = { stops, i: 0, spot, bubble, unlayer: fc.ui.layer(() => closeTour()) };
    window.addEventListener('resize', place);
    place();
}

function place() {
    if (!tour) return;
    const s = tour.stops[tour.i], n = tour.stops.length;
    const el = s.find();
    tour.bubble.innerHTML = `<div class="n">${tour.i + 1} / ${n}</div><b>${E(s.title)}</b><p>${E(s.text)}</p>` +
        `<div class="wlcFoot">${tour.i ? fc.ui.btn('Back', { kind: 'ghost', size: 'sm', act: 'back' }) : fc.ui.btn('Close', { kind: 'ghost', size: 'sm', act: 'close' })}` +
        `<span class="sp"></span>${fc.ui.btn(tour.i === n - 1 ? 'Done' : 'Next', { kind: 'brand', size: 'sm', act: 'next' })}</div>`;
    const r = el && el.getBoundingClientRect();
    if (r && r.width) {
        const pad = 6;
        Object.assign(tour.spot.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
        tour.spot.classList.remove('none');
        fc.ui.place(tour.bubble, { left: r.left - pad, right: r.right + pad, top: r.top - pad, bottom: r.bottom + pad }, s.side);
    } else {
        tour.spot.classList.add('none');
        tour.bubble.style.left = Math.round((window.innerWidth - tour.bubble.offsetWidth) / 2) + 'px';
        tour.bubble.style.top = Math.round((window.innerHeight - tour.bubble.offsetHeight) / 2) + 'px';
    }
}

function closeTour() {
    if (!tour) return;
    tour.unlayer();
    tour.spot.remove();
    tour.bubble.remove();
    window.removeEventListener('resize', place);
    tour = null;
}

/* ------------------------------------------------------------------- style */

const CSS = `
#wlcScreen { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: var(--fc-z-modal); display: flex; align-items: center; justify-content: center;
    background: radial-gradient(ellipse at 30% 0%, rgba(79,99,240,.35), transparent 60%), radial-gradient(ellipse at 90% 100%, rgba(139,92,246,.3), transparent 55%), rgba(8,9,20,.88);
    font: 14px/1.45 var(--fc-font); color: var(--fc-text); animation: fcIn var(--fc-med) var(--fc-ease) both; }
#wlcScreen .wlcCard { width: 720px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
    border-radius: var(--fc-r4); background: var(--fc-s0); box-shadow: 0 0 0 1px var(--fc-divider), var(--fc-sh3), 0 0 80px rgba(79,99,240,.25);
    animation: fcPop var(--fc-slow) var(--fc-ease) both; }
#wlcScreen .wlcHead { display: flex; align-items: center; padding: 20px 20px 12px 24px; }
#wlcScreen .wlcLogo { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; margin-right: 14px; flex: none;
    background: linear-gradient(135deg, #4f63f0, #8b5cf6); color: #fff; box-shadow: 0 0 24px rgba(34,227,242,.25); }
#wlcScreen .wlcLogo .fc-ic { width: 24px; height: 24px; }
#wlcScreen .wlcTitle { flex: 1; min-width: 0; }
#wlcScreen .wlcTitle b { display: block; font-size: 20px; color: var(--fc-head); }
#wlcScreen .wlcTitle span { color: var(--fc-muted); font-size: 13px; }
#wlcScreen .wlcDots { display: flex; padding: 0 24px 14px; border-bottom: 1px solid var(--fc-divider); }
#wlcScreen .wlcDots span { flex: 1; margin-right: 8px; padding-top: 8px; border-top: 3px solid var(--fc-s4); font-size: 12px; font-weight: 600; color: var(--fc-faint); cursor: pointer; }
#wlcScreen .wlcDots span:last-child { margin-right: 0; }
#wlcScreen .wlcDots span.done { border-top-color: var(--fc-accent-soft); color: var(--fc-muted); }
#wlcScreen .wlcDots span.on { border-top-color: var(--fc-accent); color: var(--fc-head); }
#wlcScreen .wlcBody { flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px; }
#wlcScreen .wlcStep { animation: fcRise var(--fc-med) var(--fc-ease) both; }
#wlcScreen h2 { margin: 0 0 4px; font-size: 18px; color: var(--fc-head); }
#wlcScreen h3 { margin: 18px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--fc-muted); }
#wlcScreen .lead { margin: 0 0 16px; color: var(--fc-muted); }
#wlcScreen .wlcGrid { display: flex; flex-wrap: wrap; margin: 0 -6px; }
#wlcScreen .wlcPick { width: calc(25% - 12px); margin: 0 6px 12px; padding: 8px; border-radius: var(--fc-r3); background: var(--fc-s1); cursor: pointer;
    box-shadow: inset 0 0 0 1px var(--fc-divider); transition: box-shadow var(--fc-fast), transform var(--fc-fast); box-sizing: border-box; }
#wlcScreen .wlcGrid.three .wlcPick { width: calc(33.33% - 12px); }
#wlcScreen .wlcPick:hover { transform: translateY(-2px); }
#wlcScreen .wlcPick.on { box-shadow: inset 0 0 0 2px var(--fc-accent); }
#wlcScreen .wlcPick > span { display: block; margin-top: 6px; font-weight: 600; color: var(--fc-head); }
#wlcScreen .wlcPick.big { padding: 14px; }
#wlcScreen .wlcPick.big .fc-ic { width: 24px; height: 24px; color: var(--fc-accent); }
#wlcScreen .wlcPick.big b { display: block; margin: 8px 0 4px; font-size: 15px; color: var(--fc-head); }
#wlcScreen .wlcPick.big span { font-weight: 400; margin: 0; color: var(--fc-muted); font-size: 13px; }
#wlcScreen .wlcPrev { position: relative; display: flex; height: 64px; border-radius: var(--fc-r2); overflow: hidden; }
#wlcScreen .wlcPrev i { flex: 1; }
#wlcScreen .wlcPrev i:last-of-type { flex: 3; }
#wlcScreen .wlcPrev b { position: absolute; right: 10px; bottom: 10px; width: 36px; height: 12px; border-radius: 6px; }
#wlcScreen .wlcSwatches { display: flex; }
#wlcScreen .wlcSw { width: 32px; height: 32px; margin-right: 10px; border-radius: 50%; cursor: pointer; box-shadow: inset 0 0 0 2px rgba(0,0,0,.2); }
#wlcScreen .wlcSw.on { box-shadow: 0 0 0 2px var(--fc-s0), 0 0 0 4px var(--fc-head); }
#wlcScreen .wlcList { border-radius: var(--fc-r2); background: var(--fc-s1); overflow: hidden; }
#wlcScreen .wlcRow { display: flex; align-items: center; height: 40px; padding: 0 12px; cursor: pointer; }
#wlcScreen .wlcRow:hover { background: var(--fc-hover); }
#wlcScreen .wlcRow.on { background: var(--fc-accent-soft); color: var(--fc-head); }
#wlcScreen .wlcRow .fc-ic { width: 16px; height: 16px; margin-right: 10px; color: var(--fc-muted); }
#wlcScreen .wlcBtns { margin-top: 12px; }
#wlcScreen .wlcBtns.center { text-align: center; margin: 24px 0; }
#wlcScreen .wlcNote { min-height: 18px; color: var(--fc-muted); font-size: 13px; }
#wlcScreen .wlcNote.ok { color: var(--fc-success); }
.wlcTip { display: flex; align-items: flex-start; padding: 10px 0; }
.wlcTip > .fc-ic { flex: none; width: 22px; height: 22px; margin: 1px 14px 0 0; color: var(--fc-accent); }
.wlcTip b { display: block; color: var(--fc-head); }
.wlcTip span { color: var(--fc-muted); font-size: 13px; }
#wlcScreen .wlcKeys { display: flex; justify-content: center; color: var(--fc-muted); font-size: 13px; }
#wlcScreen .wlcKeys span { margin: 0 12px; }
#wlcScreen kbd, #wlcBubble kbd { display: inline-block; padding: 1px 6px; border-radius: 4px; background: var(--fc-s4); color: var(--fc-head); font: 600 12px var(--fc-font); }
#wlcScreen .wlcFoot, #wlcBubble .wlcFoot { display: flex; align-items: center; }
#wlcScreen .wlcFoot { padding: 14px 20px; border-top: 1px solid var(--fc-divider); }
.wlcFoot .sp { flex: 1; }
#wlcSpot { position: fixed; z-index: var(--fc-z-modal); border-radius: var(--fc-r3); pointer-events: none;
    box-shadow: 0 0 0 2px var(--fc-accent), 0 0 0 9999px rgba(5,6,14,.72); transition: left var(--fc-med) var(--fc-ease), top var(--fc-med) var(--fc-ease), width var(--fc-med) var(--fc-ease), height var(--fc-med) var(--fc-ease); }
#wlcSpot.none { left: 50% !important; top: 50% !important; width: 0 !important; height: 0 !important; box-shadow: 0 0 0 9999px rgba(5,6,14,.72); }
#wlcBubble { position: fixed; z-index: calc(var(--fc-z-modal) + 1); width: 300px; padding: 14px 16px 12px; border-radius: var(--fc-r3);
    background: var(--fc-s0); color: var(--fc-text); box-shadow: 0 0 0 1px var(--fc-divider), var(--fc-sh3); font: 14px/1.45 var(--fc-font); }
#wlcBubble .n { font-size: 11px; font-weight: 700; color: var(--fc-accent); text-transform: uppercase; letter-spacing: .05em; }
#wlcBubble b { display: block; margin: 2px 0 4px; font-size: 16px; color: var(--fc-head); }
#wlcBubble p { margin: 0 0 12px; color: var(--fc-muted); font-size: 13px; }
`;

/* ------------------------------------------------------------------ module */

let decided = false;
function maybeShow() {
    if (decided) return;
    // wait for Fightcade to be logged in and on screen, the splash gone, and you not in a match
    if (!fc.app.me() || document.getElementById('fcordSplash') || fc.app.inMatch(fc.app.me())) return;
    if (!document.querySelector('.channelItemWrapper, .usersListWrapper')) return;
    decided = true;
    if (!cfg.firstRunDone && veteran()) { cfg.firstRunDone = true; store.save(); }
    if (!cfg.firstRunDone) { setTimeout(() => openWelcome(0), 1200); return; }
    const n = pendingNews(cfg.seen, version());
    if (n && cfg.news) setTimeout(() => openNews(n), 2000);
}

function start(f) {
    fc = f;
    store = fc.config('welcome', { firstRunDone: false, seen: '', news: true });
    cfg = store.data;
    fc.ui.style('wlcStyle', CSS);
    fc.own(() => { closeTour(); if (screen) { screen.remove(); screen = null; } if (unlayer) unlayer(); if (newsModal) newsModal.close(); fc.ui.style('wlcStyle', null); });
    const stop = fc.tick(() => { maybeShow(); if (decided) stop(); }, 1000, { delay: 1500, whileHidden: true });
    fc.cmd('welcome', 'The Fightcord welcome screen', () => openWelcome(0));
    fc.cmd('tour', 'A quick tour of Fightcord', () => startTour());
    fc.settings.block({
        id: 'welcome', section: 'about', title: 'Welcome & tour', store, order: 10,
        fields: [
            { type: 'button', label: 'The welcome screen', hint: 'Look, features, music and friends — the first-start setup', button: 'Open', act: 'welcome',
                onClick: () => { const s = mod('fightcord'); if (s && s.close) s.close(); openWelcome(0); } },
            { type: 'button', label: 'Tour', hint: 'Spotlights the parts of Fightcade that Fightcord changes', button: 'Start', act: 'tour',
                onClick: () => { const s = mod('fightcord'); if (s && s.close) s.close(); setTimeout(startTour, 200); } },
            { type: 'button', label: 'What’s new', button: 'Show', act: 'news',
                onClick: () => { const s = mod('fightcord'); if (s && s.close) s.close(); openNews(); } },
            { key: 'news', type: 'switch', label: 'Show what’s new after an update' }
        ]
    });
    return api;
}

const api = {
    open: (at) => openWelcome(at),
    tour: () => startTour(),
    news: () => openNews(),
    _cmpVer: cmpVer,
    _pendingNews: pendingNews,
    _step: () => (screen ? STEPS[step] : ''),
    _tourStop: () => (tour ? tour.stops[tour.i].title : '')
};

module.exports = { id: 'welcome', name: 'Welcome & tour', start, cmpVer, pendingNews, NEWS };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
