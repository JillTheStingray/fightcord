/**
 * Fightcord login screen: "attract mode"
 *
 * While Fightcade's log-in screen is up:
 *   - behind it, game art slowly pans and cross-fades (your own games first), under a neon
 *     tint, scan lines and drifting light
 *   - the FightCord mascot floats above a sleek card, which is Fightcade's own form restyled:
 *     the real inputs and buttons, so logging in works exactly as before
 *   - if Fightcord has seen you log in before: "Welcome back, <name>", your rank badge and
 *     your last session, all from files on this PC
 *   - a footer with the version, Fightcade's Code of Conduct link and a rotating tip
 * Everything goes away the moment you're in. Nothing is typed or filled in for you.
 *
 * Settings -> Appearance -> Login screen. It remembers only the name and avatar of the last
 * account that logged in (login-screen-config.json), for the greeting.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // login-screen-config.json

// translated text (plain English in the unit tests, which run without Fightcade)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const N_ = (s) => s;
const E = (s) => fc.fmt.esc(s);
const DAY = 86400000;

// well-known games for the backdrop when you haven't played much yet
const POPULAR = ['sfiii3nr1', 'kof98', 'ssf2xjr1', 'garou', 'vsav', 'sf2ce', 'kof2002', 'mvsc', 'jojobane', 'samsho2', 'sfa3', 'xmvsf', 'rbff2', 'msh', 'dstlk', 'kof97'];
const TIPS = [
    N_('Ctrl+, opens Fightcord’s settings any time.'),
    N_('Hold Shift while Fightcade starts to open it without Fightcord.'),
    N_('Find a match lists who’s free near your rank, on a good ping.'),
    N_('Ctrl+Shift+H turns on streamer mode.'),
    N_('Right-click anyone to add a friend or a note.'),
    N_('Type /help in chat for every Fightcord command.')
];

/* ------------------------------------------------------------------- pure */

// the games to show: the ones you play most, then popular ones -> roms
function artRoms(sets, limit) {
    const count = new Map();
    (sets || []).forEach(s => {
        const r = String((s && s.rom) || '').replace(/^fc1_/, '');
        if (r) count.set(r, (count.get(r) || 0) + 1);
    });
    const mine = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
    const out = [];
    mine.concat(POPULAR).forEach(r => { if (out.length < (limit || 10) && !out.includes(r)) out.push(r); });
    return out;
}

// your last session: the sets in the 8 hours up to your last one -> { w, l, game, at, rank } | null
function lastSession(sets) {
    const list = (sets || []).filter(s => s && s.at).sort((a, b) => a.at - b.at);
    if (!list.length) return null;
    const last = list[list.length - 1];
    const from = last.at - 8 * 3600000;
    const mine = list.filter(s => s.at > from);
    return {
        w: mine.filter(s => s.result === 'won').length,
        l: mine.filter(s => s.result === 'lost').length,
        game: String(last.game || last.channel || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/:.*$/, ''),
        at: last.at,
        rank: last.myRank || 0
    };
}

/* ----------------------------------------------------------------- layers */

let active = false, wasWorking = false;
let artList = [], artIdx = 0, artAt = 0, artLayer = 0, tipIdx = 0, tipAt = 0;

function loginEl() { return document.querySelector('#app .login'); }

function ensureBack() {
    let back = document.getElementById('fclBack');
    if (back) return back;
    back = document.createElement('div');
    back.id = 'fclBack';
    back.innerHTML = '<i class="art a0"></i><i class="art a1"></i><i class="tint"></i><i class="w w1"></i><i class="w w2"></i><i class="scan"></i><i class="vig"></i>';
    document.body.insertBefore(back, document.body.firstChild);
    artList = cfg.art === 'off' ? [] : artRoms(cfg.art === 'popular' ? [] : fc.history.all(), 10);
    artIdx = 0; artAt = 0;
    return back;
}

// two layers: the next picture loads, then fades in over the last one
function cycleArt(now) {
    const back = document.getElementById('fclBack');
    if (!back || !artList.length || (artAt && now - artAt < 7000)) return;
    artAt = now;
    const url = fc.data.artUrl(artList[artIdx++ % artList.length]);
    const img = new Image();
    img.onload = () => {
        if (!back.isConnected) return;
        artLayer = 1 - artLayer;
        const on = back.querySelector('.a' + artLayer), off = back.querySelector('.a' + (1 - artLayer));
        on.style.backgroundImage = 'url("' + url + '")';
        on.classList.remove('on');
        void on.offsetWidth;            // restart its pan
        on.classList.add('on');
        off.classList.remove('on');
    };
    img.onerror = () => { artAt = 0; };   // try the next one straight away
    img.src = url;
}

function welcomeHtml() {
    const u = cfg.lastUser;
    if (!u || !u.name) return '';
    const s = lastSession(fc.history.all());
    const when = s ? fc.fmt.ago(s.at) : '';
    const line = s && (s.w || s.l)
        ? T('Last session: {w}–{l} · {game} · {when}', { w: s.w, l: s.l, game: s.game, when })
        : T('Good to see you again.');
    return `<div id="fclHello"><img class="ava" src="${E(fc.data.avatarUrl(u.name, u.gravatar, 96))}" alt="">
        <div class="tx"><b>${E(T('Welcome back, {name}', { name: u.name }))}</b><span>${E(line)}</span></div>
        ${s && s.rank ? fc.ui.tag(s.rank, '', 28) : ''}</div>`;
}

function ensureCard(login) {
    const wrap = login.querySelector('.formWrapper');
    const form = login.querySelector('.formWrapper .form');
    if (wrap && !wrap.querySelector(':scope > #fclTop')) {
        const top = document.createElement('div');
        top.id = 'fclTop';
        let art = '';
        try { art = (fc.modules.get('splash-art') || require('./splash-art.js')).ART || ''; } catch (e) { art = ''; }
        top.innerHTML = art ? `<img src="${art}" alt="FightCord" draggable="false">` : '<div class="word">FightCord</div>';
        wrap.insertBefore(top, wrap.firstChild);
    }
    // only on the log-in form (not "Create an account"), and only when we know you
    const signIn = !login.querySelector('.input-area.email');
    const hello = form && form.querySelector(':scope > #fclHello');
    if (form && signIn && cfg.lastUser && cfg.lastUser.name) {
        if (!hello) form.insertAdjacentHTML('afterbegin', welcomeHtml());
    } else if (hello) hello.remove();
}

function ensureFoot(now) {
    let foot = document.getElementById('fclFoot');
    if (!foot) {
        foot = document.createElement('div');
        foot.id = 'fclFoot';
        foot.innerHTML = `<span class="v">Fightcord ${E(fc.version || '')}</span><span class="tip"></span>`;
        document.body.appendChild(foot);
        tipAt = 0;
    }
    if (!tipAt || now - tipAt > 6000) {
        tipAt = now;
        const tip = foot.querySelector('.tip');
        tip.classList.remove('in');
        void tip.offsetWidth;
        tip.textContent = T(TIPS[tipIdx++ % TIPS.length]);
        tip.classList.add('in');
    }
}

// Fightcade's own "working" flag: the Connect button shimmers while it logs in
function isWorking(login) {
    const vm = login.__vue__ || (login.parentNode && login.parentNode.__vue__);
    return !!(vm && vm.working);
}

function activate(login) {
    const now = Date.now();
    if (!active) {
        active = true;
        document.documentElement.classList.add('fcl-on');
    }
    ensureBack();
    ensureCard(login);
    ensureFoot(now);
    cycleArt(now);
    const working = isWorking(login);
    if (working !== wasWorking) { wasWorking = working; document.documentElement.classList.toggle('fcl-working', working); }
}

function deactivate(loggedIn) {
    if (!active) return;
    active = false;
    const h = document.documentElement;
    h.classList.remove('fcl-on', 'fcl-working');
    ['fclBack', 'fclFoot'].forEach(id => { const n = document.getElementById(id); if (n) n.remove(); });
    document.querySelectorAll('#fclTop, #fclHello').forEach(n => n.remove());
    // in: a short flash on the way into the lobby
    if (loggedIn && !h.classList.contains('fc-still')) {
        const f = document.createElement('div');
        f.id = 'fclSlam';
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 700);
    }
    wasWorking = false;
}

// the account that just logged in, for next time's greeting (name + avatar only)
function rememberUser() {
    const name = fc.app.me();
    if (!name) return;
    const g = (fc.app.localUser() || {}).gravatar || '';
    if (!cfg.lastUser || cfg.lastUser.name !== name || cfg.lastUser.gravatar !== g) {
        cfg.lastUser = { name, gravatar: g };
        store.save();
    }
}

function tick() {
    const login = loginEl();
    if (login && cfg.enabled) activate(login);
    else deactivate(!login && !!fc.app.me());
    if (!login) rememberUser();
}

/* ------------------------------------------------------------------ style */

function important(css) {
    return css.replace(/:\s*([^;{}]+?)\s*;/g, (m, v) => /!important$/.test(v) ? m : ': ' + v + ' !important;');
}

const L = 'html.fcl-on #app .login';
const CSS = important(`
html.fcl-on, html.fcl-on body, html.fcl-on #app { background: #070813; }
html.fcl-on #app { position: relative; z-index: 1; background: transparent; }
${L} { position: relative; z-index: 1; background: transparent; }
${L} .logoWrapper { display: none; }
${L} .formWrapper { background: transparent; background-image: none; justify-content: flex-start; padding: 24px 16px 72px; min-height: 100vh; }
${L} .formWrapper > :last-child { margin-bottom: auto; }

#fclBack { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 0; overflow: hidden; pointer-events: none; background: #070813; }
#fclBack i { position: absolute; display: block; }
#fclBack .art { top: -8%; left: -8%; right: -8%; bottom: -8%; background-size: cover; background-position: center; opacity: 0;
    filter: saturate(1.2) brightness(.5) blur(1px); transition: opacity 1.8s ease; }
#fclBack .art.on { opacity: 1; }
#fclBack .tint { top: 0; left: 0; right: 0; bottom: 0;
    background: radial-gradient(ellipse at 20% 15%, rgba(79,99,240,.45), transparent 55%), radial-gradient(ellipse at 85% 85%, rgba(139,92,246,.4), transparent 55%),
    linear-gradient(180deg, rgba(7,8,19,.35), rgba(7,8,19,.85)); }
#fclBack .w { width: 120%; height: 120%; left: -10%; top: -10%; border-radius: 45%; filter: blur(50px); opacity: .22; }
#fclBack .w1 { background: radial-gradient(ellipse at 30% 70%, #22e3f2, transparent 50%); }
#fclBack .w2 { background: radial-gradient(ellipse at 70% 30%, #8b5cf6, transparent 50%); }
#fclBack .scan { top: 0; left: 0; right: 0; bottom: 0; opacity: .5; background: repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0, rgba(255,255,255,.035) 1px, transparent 1px, transparent 3px); }
#fclBack .vig { top: 0; left: 0; right: 0; bottom: 0; box-shadow: inset 0 0 220px rgba(0,0,0,.85); }

#fclTop { position: relative; margin: auto 0 6px; text-align: center; }
#fclTop img { width: 190px; height: 190px; filter: drop-shadow(0 0 22px rgba(79,99,240,.55)); }
#fclTop .word { font: 900 52px/1 var(--fc-font); color: #4f63f0; text-shadow: 0 0 30px rgba(79,99,240,.7); }

${L} .formWrapper h2 { margin: 0 0 12px; font-size: 13px; letter-spacing: .24em; color: #a8aed6; }
${L} .formWrapper .form { position: relative; width: 420px; max-width: calc(100vw - 32px); margin: 0 0 18px; padding: 26px 30px 20px; border-radius: 16px; text-align: left;
    background: rgba(13,15,31,.88); box-shadow: 0 0 0 1px rgba(255,255,255,.07), 0 24px 60px rgba(0,0,0,.6), 0 0 70px rgba(79,99,240,.22); }
${L} .formWrapper .form::before { content: ''; position: absolute; top: 0; left: 24px; right: 24px; height: 2px; border-radius: 2px;
    background: linear-gradient(90deg, transparent, #22e3f2, #4f63f0, #8b5cf6, transparent); }
${L} .formWrapper .form > .title.error { margin: 0 0 12px; font-size: 13px; text-align: center; }
${L} .formWrapper .form .input-area { margin: 0 0 16px; }
${L} .formWrapper .form .input-area .title { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; }
${L} .formWrapper .form .input-area .title span { display: inline; color: #8a90b8; }
${L} .formWrapper .form .input-area .title span:last-child { margin-left: 8px; color: #f24b5a; font-size: 11.5px; letter-spacing: 0; }
${L} .formWrapper .form .input-area input { height: 44px; padding: 0 14px; border: 1px solid #272c55; border-radius: 10px; text-align: left; font-size: 15px;
    color: #fff; background: #0a0c1a; transition: border-color .15s ease, box-shadow .15s ease; }
${L} .formWrapper .form .input-area input:hover { border-color: #3a4180; }
${L} .formWrapper .form .input-area input:focus { border-color: #4f63f0; box-shadow: 0 0 0 3px rgba(79,99,240,.28); }
${L} .formWrapper .form .input-area .error ~ input { border-color: #f24b5a; box-shadow: 0 0 0 3px rgba(242,75,90,.2); }
${L} .formWrapper .form .button-generic { display: flex; align-items: center; justify-content: center; width: 100%; height: 46px; margin: 6px 0 0; padding: 0;
    border: 0; border-radius: 10px; color: #fff; font-size: 15px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; cursor: pointer;
    background: linear-gradient(135deg, #4f63f0, #8b5cf6); background-size: 200% 100%; box-shadow: 0 8px 26px rgba(79,99,240,.45); transition: filter .15s ease, transform .15s ease; }
${L} .formWrapper .form .button-generic:hover { filter: brightness(1.12); transform: translateY(-1px); }
html.fcl-on.fcl-working #app .login .formWrapper .form .button-generic { background: linear-gradient(90deg, #4f63f0, #22e3f2, #8b5cf6, #4f63f0); background-size: 300% 100%; }
${L} .formWrapper .form .forgotPassword { margin: 12px 0 0; text-align: center; font-size: 12.5px; }
${L} .formWrapper .form .forgotPassword a { color: #8a90b8; }
${L} .formWrapper .form .forgotPassword a:hover { color: #fff; }
${L} .coc { margin: 14px 0 0; text-align: center; font-size: 12px; color: #6f7cd6; }
${L} .coc a { color: #22e3f2; }
${L} .formWrapper > h3 { margin: 4px 0 8px; font-size: 13px; font-weight: 600; color: #a8aed6; }
${L} .formWrapper > .button-generic { height: 34px; line-height: 34px; padding: 0 18px; border: 1px solid #272c55; border-radius: 999px; font-size: 12.5px;
    color: #dde1f5; background: rgba(13,15,31,.75); box-shadow: none; }
${L} .formWrapper > .button-generic:hover { border-color: #4f63f0; color: #fff; }
${L} .formWrapper .notificationWrapper { border-radius: 12px; background: #15182f; box-shadow: 0 0 0 1px #272c55, 0 12px 30px rgba(0,0,0,.5); }

#fclHello { display: flex; align-items: center; margin: 0 0 18px; padding: 0 0 16px; border-bottom: 1px solid rgba(255,255,255,.07); }
#fclHello .ava { width: 44px; height: 44px; margin-right: 12px; border-radius: 50%; box-shadow: 0 0 0 2px #4f63f0; }
#fclHello .tx { flex: 1; min-width: 0; }
#fclHello b { display: block; font-size: 16px; font-weight: 800; color: #fff; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fclHello span { display: block; margin-top: 2px; font-size: 12.5px; color: #8a90b8; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fclHello .fc-tag { margin-left: 10px; }

#fclFoot { position: fixed; left: 0; right: 0; bottom: 14px; z-index: 2; text-align: center; font: 12px/1.4 var(--fc-font); color: rgba(168,174,214,.65); pointer-events: none; }
#fclFoot .v { margin-right: 10px; color: rgba(168,174,214,.4); }
#fclSlam { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2147483000; pointer-events: none;
    background: radial-gradient(circle at 50% 50%, rgba(255,255,255,.9), rgba(79,99,240,.6) 30%, transparent 70%); }
`) + `
html.fcl-on:not(.fc-still) #fclBack .art.on { animation: fclKen 16s ease-in-out both; }
html.fcl-on:not(.fc-still) #fclBack .w1 { animation: fclW1 24s ease-in-out infinite alternate; }
html.fcl-on:not(.fc-still) #fclBack .w2 { animation: fclW2 30s ease-in-out infinite alternate; }
html.fcl-on:not(.fc-still) #fclTop img { animation: fclPop .6s cubic-bezier(.2,1.4,.4,1) both, fclFloat 3.4s 0.6s ease-in-out infinite, fclGlow 2.6s ease-in-out infinite; }
html.fcl-on:not(.fc-still) #app .login .formWrapper .form { animation: fclRise .55s .1s cubic-bezier(.2,.9,.3,1.1) both; }
html.fcl-on.fcl-working:not(.fc-still) #app .login .formWrapper .form .button-generic { animation: fclShimmer 1.2s linear infinite; }
html.fcl-on:not(.fc-still) #fclFoot .tip.in { animation: fclTip .5s ease both; }
#fclSlam { animation: fclSlam .7s ease-out both; }
@keyframes fclKen { from { transform: scale(1.04) translate(-1.5%, -1%); } to { transform: scale(1.14) translate(1.5%, 1%); } }
@keyframes fclW1 { from { transform: translate(-5%, -3%) rotate(0deg); } to { transform: translate(5%, 4%) rotate(20deg); } }
@keyframes fclW2 { from { transform: translate(4%, 3%) rotate(0deg); } to { transform: translate(-5%, -4%) rotate(-25deg); } }
@keyframes fclPop { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: none; } }
@keyframes fclFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
@keyframes fclGlow { 0%, 100% { filter: drop-shadow(0 0 18px rgba(79,99,240,.55)); } 50% { filter: drop-shadow(0 0 32px rgba(34,227,242,.6)); } }
@keyframes fclRise { from { opacity: 0; transform: translateY(18px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes fclShimmer { from { background-position: 0% 0; } to { background-position: 300% 0; } }
@keyframes fclTip { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes fclSlam { 0% { opacity: 0; } 25% { opacity: 1; } 100% { opacity: 0; } }
`;

/* ----------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('login-screen', { enabled: true, art: 'mine', lastUser: null });
    cfg = store.data;
    fc.ui.style('fclStyle', CSS);
    fc.own(() => { deactivate(false); fc.ui.style('fclStyle', null); });
    fc.watch(tick, { selector: '#app' });
    fc.tick(tick, 500, { whileHidden: true });
    fc.settings.block({
        id: 'login-screen', section: 'appearance', title: 'Login screen', hint: '— the screen before you log in',
        store, order: 60,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Fightcord login screen', hint: 'Game art, the mascot and a welcome back. Off = Fightcade’s own' },
            { key: 'art', type: 'select', label: 'Background art', show: (d) => d.enabled,
                options: [['mine', 'Your games first'], ['popular', 'Popular games'], ['off', 'No art']] },
            { type: 'note', label: 'It remembers only the name and avatar of the last account that logged in, for the greeting.' }
        ]
    });
    tick();
    return api;
}

const api = {
    _tick: () => tick(),
    _active: () => active,
    get _config() { return cfg; }
};

module.exports = { id: 'login-screen', name: 'Login screen', start, artRoms, lastSession, POPULAR };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
