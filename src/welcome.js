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
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const ET = (s, v) => E(fc.t(s, v));
const mod = (id) => fc.modules.get(id);

/* ---------------------------------------------------------------- versions */

const N_ = (s) => s;          // translated where shown
// the news for each version that has some ('1.9' = the 2.0 betas, so they show it too)
const NEWS = [
    { v: '1.9', title: 'Fightcord 2.0', items: [
        ['bolt', N_('Faster and lighter'), N_('One shared core instead of 24 separate plugins: one timer, one page watcher, one Fightcade API client.')],
        ['gear', N_('New settings'), N_('Search every setting, one-click profiles, backup & restore, and a Diagnostics page. Ctrl+, opens it.')],
        ['trend', N_('Rank & ELO history'), N_('Stats → Progress charts your rank over time — with a celebration when you rank up.')],
        ['target', N_('Training goals'), N_('Win 5 sets, beat 3 A-ranks, play an hour… tracked live by the ring next to your session record.')],
        ['chart', N_('Match analytics'), N_('Win rate by opponent rank, ping and hour of day, plus a tilt check. Stats → Analytics.')],
        ['bell', N_('Lobby feed'), N_('The Feed button in every channel: joins, matches you can watch, upsets and streaks.')]
    ] },
    { v: '2.1', title: 'Fightcord 2.1', items: [
        ['warn', N_('Unfinished sets'), N_('The scout and challenge cards warn when someone often leaves ranked sets before the FT is reached.')],
        ['bell', N_('Event reminders'), N_('A heads-up before tournaments for your games start, with a button to open the channel. Ring the bell on any event card to add it.')],
        ['trend', N_('Exact ELO'), N_('Fightcade supporters now see their real ELO on the scout card, the Progress chart and after every set.')]
    ] },
    { v: '2.2', title: 'Fightcord 2.2', items: [
        ['globe', N_('Português e Español'), N_('Fightcord now speaks Brazilian Portuguese and Spanish, installer included. Settings → My Fightcord → Language (Automatic follows Windows).')],
        ['chat', N_('Chat translation in your language'), N_('The chat translator now translates other players into the language Fightcord is in, out of the box.')]
    ] },
    { v: '2.3', title: 'Fightcord 2.3', items: [
        ['target', N_('Find a match'), N_('The new button in the channel header lists who’s free near your rank, on a good ping, with your odds and a Challenge button. Or type /find.')],
        ['eye', N_('Streamer mode'), N_('Ctrl+Shift+H blurs other players’ names, avatars and chat, and lines challenges up one at a time. Settings → Streamer mode.')],
        ['play', N_('OBS overlay'), N_('A scoreboard for your stream: you vs your opponent, the score and tonight’s record. Switch it on under Settings → Streamer mode.')]
    ] },
    { v: '2.4', title: 'Fightcord 2.4', items: [
        ['download', N_('Updates itself as Fightcade starts'), N_('New versions now install while Fightcade opens, so you never need GitHub or the installer again.')],
        ['refresh', N_('Restart when it suits you'), N_('An update that arrives while Fightcade is open shows a green button in the left rail. Its notes are in Settings → Updates.')]
    ] },
    { v: '2.5', title: 'Fightcord 2.5', items: [
        ['play', N_('A new login screen'), N_('Game art, the FightCord mascot and a welcome back with your rank and last session. Settings → Appearance → Login screen.')],
        ['users', N_('Discover, made for you'), N_('Friends playing now, rivals who are free, this week’s events, and your rank and ELO on your games.')]
    ] },
    { v: '2.6', title: 'Fightcord 2.6', items: [
        ['play', N_('Live from the emulator'), N_('The OBS overlay’s score now updates the moment a game ends, with both characters under the names.')],
        ['trend', N_('Characters in your stats'), N_('Every set remembers who played which character: in your sets, head-to-heads, Analytics and the challenge card.')]
    ] },
    { v: '2.7', title: 'Fightcord 2.7', items: [
        ['play', N_('Your style in the emulator'), N_('The bar with the names and score in your matches, in your theme colour. Settings → Appearance → Emulator overlay.')],
        ['star', N_('Pick the emulator’s font'), N_('Twelve fonts for the names, score and chat in your matches — pixel, arcade, esports — each with a preview.')]
    ] },
    { v: '2.8', title: 'Fightcord 2.8', items: [
        ['music', N_('A music visualizer'), N_('Bars, a wave or a pulsing ring behind the chat that move with your background music, and punch on every kick. Settings → Appearance → Animated background.')],
        ['bolt', N_('Smooth as your screen'), N_('The visualizer runs at your monitor’s refresh rate (or 60 / 30 fps, your choice).')]
    ] },
    { v: '2.9', title: 'Fightcord 2.9', items: [
        ['users', N_('A calmer lobby'), N_('The member list sits left of the chat, one line per player, with one Filter button. Prefer it on the right? Settings → Member list → Side.')],
        ['target', N_('Goals at a glance'), N_('Tonight’s record, your win streak and a bar per goal in the top bar; a bar pulses when you make progress.')]
    ] },
    { v: '2.10', title: 'Fightcord 2.10', items: [
        ['trophy', N_('Rankings, replays and more, in Fightcade'), N_('The channel banner’s buttons open the game’s rankings, replays to watch, events and profiles right here.')],
        ['sword', N_('Fight night'), N_('A new VS screen with the game’s art, characters on your Discord status, and matchup notes per character in Analytics.')]
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
const STEP_LABEL = { look: N_('Look'), features: N_('Features'), music: N_('Music'), friends: N_('Friends'), tour: N_('Tour') };
const PREVIEW = {
    dark: ['#1e1f22', '#2b2d31', '#313338'], amoled: ['#000000', '#0a0a0a', '#151515'],
    classic: ['#202225', '#2f3136', '#36393f'], neon: ['#0d0f1f', '#151833', '#1c2045']
};

let screen = null, step = 0, unlayer = null;

function lookHtml() {
    const th = mod('discord-theme');
    if (!th || !th.theme) return `<h2>${ET('Make it yours')}</h2><p class="lead">${ET('The Discord theme is switched off right now — you can turn it on later in Settings → Appearance.')}</p>`;
    const t = th.theme(), presets = th.presets(), sw = th.swatches();
    return `<h2>${ET('Make it yours')}</h2><p class="lead">${ET('Pick a look — it changes right away, behind this window too.')}</p>
        <div class="wlcGrid">${Object.keys(PREVIEW).filter(k => presets[k]).map(k => `<div class="wlcPick${t.enabled && t.preset === k ? ' on' : ''}" data-preset="${k}">
            <div class="wlcPrev">${PREVIEW[k].map(c => `<i style="background:${c}"></i>`).join('')}<b style="background:${E(t.accent)}"></b></div><span>${ET(presets[k])}</span></div>`).join('')}</div>
        <h3>${ET('Accent colour')}</h3><div class="wlcSwatches">${Object.keys(sw).map(n => `<span class="wlcSw${sw[n] === t.accent ? ' on' : ''}" data-accent="${sw[n]}" title="${ET(n)}" style="background:${sw[n]}"></span>`).join('')}</div>`;
}

function featuresHtml() {
    const s = mod('fightcord');
    if (!s || !s.profiles) return `<h2>${ET('Features')}</h2><p class="lead">${ET('Choose which modules run in Settings → My Fightcord.')}</p>`;
    const P = s.profiles(), cur = s.profile();
    return `<h2>${ET('How much Fightcord?')}</h2><p class="lead">${ET('You can change this any time in Settings → My Fightcord, or switch single modules on and off.')}</p>
        <div class="wlcGrid three">${Object.keys(P).map(k => `<div class="wlcPick big${cur === k ? ' on' : ''}" data-profile="${k}">${fc.ui.icon(P[k].icon)}<b>${ET(P[k].label)}</b><span>${ET(P[k].desc)}</span></div>`).join('')}</div>
        <div class="wlcNote" data-note="profile">${cur ? '' : ET('Right now you’re on your own mix of modules.')}</div>`;
}

function musicHtml() {
    const m = mod('music');
    if (!m || !m.tracks) return `<h2>${ET('Lobby music')}</h2><p class="lead">${ET('Music is switched off in this profile. Turn the module on in Settings → My Fightcord if you want it.')}</p>`;
    const list = m.tracks(), cur = m.current();
    const s = mod('fightcord'), P = s && s.profiles ? s.profiles() : {}, prof = s && s.profile ? s.profile() : '';
    const offNext = prof && P[prof] && P[prof].off.includes('music.js');
    return `<h2>${ET('Lobby music')}</h2>${offNext ? `<div class="wlcNote">${ET('The {profile} profile you picked switches music off from the next start.', { profile: T(P[prof].label) })}</div>` : ''}<p class="lead">${ET('Fightcord can play a track on a loop while you’re in the lobby, and pause it during matches. It doesn’t come with any music — add your own mp3 or ogg.')}</p>
        <div class="wlcList">${list.map(f => `<div class="wlcRow${f === cur ? ' on' : ''}" data-track="${E(f)}">${fc.ui.icon('music')}<span>${E(f.replace(/\.[^.]+$/, ''))}</span></div>`).join('')}
            <div class="wlcRow${cur ? '' : ' on'}" data-track="">${fc.ui.icon('close')}<span>${ET('No music')}</span></div></div>
        <div class="wlcBtns">${fc.ui.btn('Add a track…', { kind: 'sec', icon: 'plus', act: 'add-track' })}</div>
        <input type="file" class="wlcFile" accept="audio/*,.mp3,.ogg,.wav,.m4a" style="display:none">`;
}

function friendsHtml() {
    const tip = (icon, b, s) => `<div class="wlcTip">${fc.ui.icon(icon)}<div><b>${ET(b)}</b><span>${ET(s)}</span></div></div>`;
    return `<h2>${ET('Friends & notes')}</h2><p class="lead">${ET('Fightcade has no friends list — Fightcord adds one, kept on your PC.')}</p>
        ${tip('star', N_('Right-click anyone → Add friend'), N_('You’ll hear when friends come online or start a match, with a button to watch.'))}
        ${tip('users', N_('/friends opens your list'), N_('Who’s online, what they’re playing, and your record against each of them.'))}
        ${tip('note', N_('Notes & tags'), N_('Right-click → Note (or /note name) to remember a player: “turtles”, “good games”. It shows on their challenge.'))}
        ${tip('bell', N_('The Feed'), N_('Every channel has a Feed button: who joined, matches to watch, upsets and streaks.'))}`;
}

function tourHtml() {
    return `<h2>${ET('You’re all set')}</h2><p class="lead">${ET('A 30-second tour shows where everything is. You can replay it from Settings → About.')}</p>
        <div class="wlcBtns center">${fc.ui.btn('Take the tour', { kind: 'brand', size: 'lg', icon: 'play', act: 'tour' })}</div>
        <div class="wlcKeys"><span><kbd>Ctrl</kbd>+<kbd>,</kbd> ${ET('settings')}</span><span><kbd>/help</kbd> ${ET('every command')}</span><span><kbd>/stats</kbd> ${ET('your stats')}</span></div>`;
}

const BODY = { look: lookHtml, features: featuresHtml, music: musicHtml, friends: friendsHtml, tour: tourHtml };

function render() {
    if (!screen) return;
    const id = STEPS[step];
    screen.querySelector('.wlcDots').innerHTML = STEPS.map((s, i) => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}" data-step="${i}">${ET(STEP_LABEL[s])}</span>`).join('');
    const body = screen.querySelector('.wlcBody');
    body.innerHTML = `<div class="wlcStep">${BODY[id]()}</div>`;
    screen.querySelector('[data-act="back"]').style.visibility = step ? '' : 'hidden';
    screen.querySelector('[data-act="next"]').innerHTML = ET(step === STEPS.length - 1 ? 'Finish' : 'Next');
    const file = body.querySelector('.wlcFile');
    if (file) file.addEventListener('change', () => addTrack(file));
}

async function addTrack(input) {
    const f = input.files && input.files[0];
    const m = mod('music');
    if (!f || !m) return;
    try { const name = await m.addTrack(f); m.pick(name); }
    catch (e) { fc.ui.toast(T('Couldn’t add that file'), { sub: e.message, kind: 'danger', icon: 'warn' }); }
    render();
}

function openWelcome(at) {
    closeTour();
    step = Math.max(0, Math.min(STEPS.length - 1, at || 0));
    if (!screen) {
        screen = document.createElement('div');
        screen.id = 'wlcScreen';
        screen.innerHTML = `<div class="wlcCard"><div class="wlcHead"><div class="wlcLogo">${fc.ui.icon('bolt')}</div>` +
            `<div class="wlcTitle"><b>${ET('Welcome to Fightcord')}</b><span>${ET('Discord-style Fightcade — let’s set it up')}</span></div>` +
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
                note.textContent = T('Saved — it takes effect the next time Fightcade starts.');
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
    const body = `<div class="wlcNews">${news.items.map(([icon, b, s]) => `<div class="wlcTip">${fc.ui.icon(icon)}<div><b>${ET(b)}</b><span>${ET(s)}</span></div></div>`).join('')}</div>`;
    newsModal = fc.ui.modal({
        title: T('What’s new in {version}', { version: news.title }), body, width: 520,
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
    tour.bubble.innerHTML = `<div class="n">${tour.i + 1} / ${n}</div><b>${ET(s.title)}</b><p>${ET(s.text)}</p>` +
        `<div class="wlcFoot">${tour.i ? fc.ui.btn('Back', { kind: 'ghost', size: 'sm', act: 'back' }) : fc.ui.btn('Close', { kind: 'ghost', size: 'sm', act: 'close' })}` +
        `<span class="sp"></span>${fc.ui.btn(T(tour.i === n - 1 ? 'Done' : 'Next'), { kind: 'brand', size: 'sm', act: 'next' })}</div>`;
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
