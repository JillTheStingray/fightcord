/**
 * Profile looks (3.7) -- the avatar, banner, theme colours, frame and pronouns Fightcord players pick
 * in Edit profile, drawn wherever you see that player: cards, the member list, Fightcade's chat,
 * DMs, lobbies, Find match. Players without Fightcord see plain Fightcade.
 *
 * presence.js carries and checks the profiles (signed with the Fightcord ID, remembered while
 * they're away); this draws them:
 *  - avatars: fc.data.avatarUrl asks us first (everything Fightcord draws), and one pass swaps the
 *    pictures Fightcade draws itself (its chat and lists), putting them back when that goes;
 *  - GIFs show still and play while you hover the avatar or the card, like Discord;
 *  - frames: a ring around the avatar, all drawn here in CSS (no pictures);
 *  - theme colours: the card becomes a gradient of the two, with text that stays readable.
 */
'use strict';

let fc = null;
const mod = (id) => fc.modules.get(id);
const N_ = (s) => s;

// the frames, in the editor's order (ids: presence.js FRAMES)
const FRAME_NAMES = { flame: N_('Flame'), neon: N_('Neon'), gold: N_('Gold'), sakura: N_('Sakura'), frost: N_('Frost'), bolt: N_('Lightning'),
    pixel: N_('Pixel'), hearts: N_('Hearts'), shadow: N_('Shadow'), rainbow: N_('Rainbow') };
// theme presets for the editor: [top, bottom]
const THEMES = [['#5865f2', '#eb459e'], ['#ff6b35', '#7b1fa2'], ['#00b4d8', '#023e8a'], ['#2ec27e', '#0b3d2e'], ['#f9c74f', '#f3722c'],
    ['#e63946', '#1d1d1f'], ['#cdb4db', '#a2d2ff'], ['#f1f1f1', '#9aa0a6'], ['#3a0ca3', '#000000'], ['#ffafcc', '#ff5d8f']];

/* ================================================================ pure parts */

// relative luminance of #rrggbb, 0..1
function lum(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
// a theme -> the card's CSS variables: the two colours, and panels/text that read on top of them
function themeVars(th) {
    if (!Array.isArray(th) || th.length !== 2) return null;
    const light = (lum(th[0]) + lum(th[1])) / 2 > 0.45;
    return Object.assign({ '--th1': th[0], '--th2': th[1], '--fc-s0': th[0] }, light
        ? { '--fc-head': '#0e0f12', '--fc-text': '#1b1c20', '--fc-muted': 'rgba(14,15,18,.68)', '--fc-s1': 'rgba(255,255,255,.42)', '--fc-s2': 'rgba(255,255,255,.52)',
            '--fc-s3': 'rgba(255,255,255,.66)', '--fc-s4': 'rgba(255,255,255,.78)', '--fc-divider': 'rgba(0,0,0,.14)' }
        : { '--fc-head': '#ffffff', '--fc-text': '#f2f3f5', '--fc-muted': 'rgba(255,255,255,.72)', '--fc-s1': 'rgba(0,0,0,.3)', '--fc-s2': 'rgba(0,0,0,.34)',
            '--fc-s3': 'rgba(0,0,0,.44)', '--fc-s4': 'rgba(0,0,0,.52)', '--fc-divider': 'rgba(255,255,255,.14)' });
}
// a Fightcade avatar picture -> whose it is: its gravatar hash (byHash: hash -> name), or the name
// itself (players without a gravatar get one made from their name: ?...&f=y)
function nameFromSrc(src, byHash) {
    const m = /gravatar\.com\/avatar\/([^?&#/]+)/.exec(String(src || ''));
    if (!m) return '';
    let k = m[1];
    try { k = decodeURIComponent(k); } catch (e) { /* as it is */ }
    return (byHash && byHash.get(k.toLowerCase())) || (/[?&]f=y\b/.test(src) && !/^[0-9a-f]{32}$/i.test(k) ? k : '');
}

module.exports = { id: 'profile-looks', name: 'Profile looks', needs: ['presence'], start: (f) => start(f), lum, themeVars, nameFromSrc, FRAME_NAMES, THEMES };

/* ================================================================== browser */

const P = () => mod('presence');
function look(name) { const p = P(); return p && name ? p.softProfile(name) : null; }
function avatarFor(name) { const l = look(name); return l && l.av ? l.av.s || l.av.u : ''; }

// a card (or the editor's preview) in its theme colours; th null = back to normal
function applyTheme(el, th) {
    if (!el) return;
    const vars = themeVars(th), key = vars ? th.join() : '';
    if (el.__fcTh === key) return;
    (el.__fcThVars || []).forEach(k => el.style.removeProperty(k));
    el.__fcThVars = vars ? Object.keys(vars) : [];
    el.__fcTh = key;
    if (vars) Object.keys(vars).forEach(k => el.style.setProperty(k, vars[k]));
    el.classList.toggle('fclkTheme', !!vars);
}
const setFrame = (el, fr) => { if (!el) return; const v = fr && FRAME_NAMES[fr] ? fr : ''; if ((el.dataset.fcfr || '') !== v) { if (v) el.dataset.fcfr = v; else delete el.dataset.fcfr; } };

// gravatar hash -> name, for the pictures Fightcade draws (rebuilt when its user list changes)
let byHash = new Map(), usersSig = '';
function hashMap() {
    const users = fc.app.users() || {};
    const keys = Object.keys(users);
    const sig = keys.length + '|' + (keys[0] || '') + '|' + (keys[keys.length - 1] || '');
    if (sig === usersSig) return byHash;
    usersSig = sig;
    const m = new Map();
    keys.forEach(k => { const u = users[k]; if (u && u.gravatar) m.set(String(u.gravatar).toLowerCase(), (u && u.name) || k); });
    byHash = m;
    return m;
}

// one picture: theirs while they have one (keeping Fightcade's to put back), else Fightcade's
function swapImg(img, name) {
    if (img.__fcPlay) return;
    const cur = img.getAttribute('src') || '';
    if (img.__fcSet && cur !== img.__fcSet) { img.__fcSet = ''; img.__fcOrig = ''; }     // the page drew a new one there
    const want = avatarFor(name);
    if (want) {
        if (cur === want) return;
        if (!img.__fcSet) img.__fcOrig = cur;
        img.__fcSet = want;
        img.setAttribute('src', want);
    } else if (img.__fcSet) {
        img.setAttribute('src', img.__fcOrig);
        img.__fcSet = '';
    } else if (img.__fcMine && cur === img.__fcMine) {
        // drawn by Fightcord with their picture, which they took away (or you hid): Fightcade's again
        const u = fc.app.user(name)[1];
        img.setAttribute('src', fc.data.avatarUrl(name, u && u.gravatar, 80, true));
    }
}

function paint() {
    if (typeof document === 'undefined' || !P()) return;
    const map = hashMap();
    // what Fightcord draws (it knows whose)
    document.querySelectorAll('.fc-avatar[data-av]').forEach(el => {
        const name = el.dataset.av, img = el.querySelector('img');
        if (img) { if (!img.__fcMine && !img.__fcSet && /^https:/.test(img.getAttribute('src') || '') && !/gravatar\.com/.test(img.getAttribute('src'))) img.__fcMine = img.getAttribute('src'); swapImg(img, name); }
        const l = look(name);
        setFrame(el, l && l.fr);
    });
    // what Fightcade draws: its chat, lists and profile pictures
    document.querySelectorAll('img[src*="gravatar.com/avatar/"], img.fclkSwapped').forEach(img => {
        if (img.closest('.fc-avatar')) return;
        // whose: Fightcade marks its chat messages and member rows with the name; else from the picture
        const src = img.getAttribute('src') || '';
        const who = img.closest('[data-current-user]');
        const name = (who && who.getAttribute('data-current-user')) || (/gravatar\.com\/avatar\//.test(src) ? nameFromSrc(src, map) : img.__fcName || '');
        if (!name) return;
        img.__fcName = name;
        swapImg(img, name);
        img.classList.toggle('fclkSwapped', !!img.__fcSet);
        const wrap = img.parentElement && img.parentElement.matches('.avatarWrapper, .userAvatarWrapper') ? img.parentElement : null;
        const l = look(name);
        if (wrap) setFrame(wrap, l && l.fr);
    });
    // you, bottom-left (layout3's panel)
    const mine = document.querySelector('.l3Av');
    if (mine) { const l = look(fc.app.me()); setFrame(mine, l && l.fr); }
    // cards in their owner's colours
    document.querySelectorAll('.fc-ch[data-fclook]').forEach(head => {
        const box = head.closest('.fc-cardpop, .fc-pop, .fcdmProf, #pcCard') || head.parentElement;
        if (box.classList.contains('fclkPrev')) return;          // the editor paints its own
        const l = look(head.dataset.fclook);
        applyTheme(box, l && l.th);
    });
}

/* --------------------------------------------- GIFs: still, playing on hover */

// a whole card (its banner too) or a chat message / DM row, else just the avatar under the mouse
const PLAY_BIG = '.fc-cardpop, .fc-pop, .fcdmProf, .fclkPrev, .fcdmRow, .messageWrapper', PLAY_AV = '.fc-avatar, .avatarWrapper, .userAvatarWrapper';
let playing = null, swapped = [];
function play(root) {
    const p = P();
    if (!p || !p.animOf) return;
    const imgs = root.tagName === 'IMG' ? [root] : root.querySelectorAll('img');
    imgs.forEach(img => {
        const s = img.getAttribute('src'), a = s && p.animOf(s);
        if (!a) return;
        img.__fcPlay = true;
        img.setAttribute('src', a);
        swapped.push(() => { img.setAttribute('src', s); img.__fcPlay = false; });
    });
    root.querySelectorAll('.fc-ch-banner').forEach(b => {
        const bg = b.style.background || '', m = /url\("?([^")]+)"?\)/.exec(bg), a = m && p.animOf(m[1]);
        if (!a) return;
        b.style.background = bg.replace(m[1], a);
        swapped.push(() => { b.style.background = bg; });
    });
    playing = root;
}
function stop() { swapped.forEach(f => { try { f(); } catch (e) { /* gone */ } }); swapped = []; playing = null; }
function onOver(e) {
    const t = e.target && e.target.closest ? e.target : null;
    const root = t ? t.closest(PLAY_BIG) || t.closest(PLAY_AV) : null;
    if (root === playing || (playing && root && playing.contains(root))) return;
    stop();
    if (root) play(root);
}
function onOut(e) { if (playing && !(e.relatedTarget && playing.contains(e.relatedTarget))) stop(); }

/* --------------------------------------------------------------------- CSS */

// a frame: a ring a little bigger than the avatar (a mask cuts the middle out), drawn over its edge
const RING = (bg, glow) => `background: ${bg};${glow ? ` filter: drop-shadow(0 0 3px ${glow});` : ''}`;
const CSS = `
[data-fcfr] { position: relative; overflow: visible !important; }
[data-fcfr]::after { content: ''; position: absolute; top: -13%; left: -13%; right: -13%; bottom: -13%; border-radius: 50%; pointer-events: none; z-index: 2;
    -webkit-mask: radial-gradient(circle closest-side, transparent 74%, #000 75.5%, #000 98%, transparent 100%); }
[data-fcfr] > .st { z-index: 3; }
[data-fcfr="flame"]::after { ${RING('conic-gradient(#ff3d00, #ffb300, #ff6d00, #ff1744, #ffca28, #ff6d00, #ff3d00)', '#ff6d00')} }
[data-fcfr="neon"]::after { ${RING('conic-gradient(#00e5ff, #d500f9, #00e5ff, #d500f9, #00e5ff)', '#00e5ff')} }
[data-fcfr="gold"]::after { ${RING('conic-gradient(#8a6d1d, #ffe08a, #b8892b, #fff3c4, #9c7a22, #ffe08a, #8a6d1d)', 'rgba(255,214,102,.6)')} }
[data-fcfr="sakura"]::after { ${RING('repeating-conic-gradient(#ffb7d5 0 18deg, #ff7eb6 18deg 30deg, #fff0f6 30deg 36deg)', 'rgba(255,126,182,.55)')} }
[data-fcfr="frost"]::after { ${RING('conic-gradient(#e0f7ff, #7fd3ff, #ffffff, #4fb3ff, #e0f7ff, #b3e5ff, #e0f7ff)', '#7fd3ff')} }
[data-fcfr="bolt"]::after { ${RING('repeating-conic-gradient(#ffd60a 0 22deg, #3a2f00 22deg 30deg)', '#ffd60a')} }
[data-fcfr="pixel"]::after { ${RING('repeating-conic-gradient(#39ff14 0 15deg, #0b5d00 15deg 30deg)', '')} border-radius: 22%; -webkit-mask: none;
    box-shadow: inset 0 0 0 3px #39ff14; background: transparent; outline: 2px dashed #0b5d00; outline-offset: -5px; }
[data-fcfr="hearts"]::after { ${RING('repeating-conic-gradient(#ff4d8d 0 20deg, #ffc2d9 20deg 26deg, #ff85b3 26deg 40deg)', 'rgba(255,77,141,.6)')} }
[data-fcfr="shadow"]::after { ${RING('conic-gradient(#12001f, #6a00ff, #12001f, #3d0066, #9d4dff, #12001f)', '#6a00ff')} }
[data-fcfr="rainbow"]::after { ${RING('conic-gradient(#ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #af52de, #ff3b30)', 'rgba(255,255,255,.35)')} }
@keyframes fclkSpin { to { transform: rotate(360deg); } }
@keyframes fclkPulse { 50% { opacity: .55; } }
[data-fcfr]:hover::after, .fc-cardpop:hover [data-fcfr]::after, .fc-pop:hover [data-fcfr]::after, .fcdmProf:hover [data-fcfr]::after, .fclkPrev [data-fcfr]::after { animation: fclkSpin 4s linear infinite; }
[data-fcfr="neon"]:hover::after, .fc-cardpop:hover [data-fcfr="neon"]::after, .fc-pop:hover [data-fcfr="neon"]::after, .fcdmProf:hover [data-fcfr="neon"]::after, .fclkPrev [data-fcfr="neon"]::after,
[data-fcfr="pixel"]:hover::after, .fc-cardpop:hover [data-fcfr="pixel"]::after, .fc-pop:hover [data-fcfr="pixel"]::after, .fcdmProf:hover [data-fcfr="pixel"]::after, .fclkPrev [data-fcfr="pixel"]::after { animation: fclkPulse 1.4s ease-in-out infinite; }
/* the card in its owner's colours (the panels and text follow, from themeVars) */
.fclkTheme { background: linear-gradient(180deg, var(--th1), var(--th2)) !important; }
.fclkTheme .fc-ch-av { background: var(--th1); }
.fclkTheme .fc-cmsg, .fclkTheme .fc-input { background: var(--fc-s2) !important; color: var(--fc-text); }
/* green/red status words don't read on every colour: they follow the theme's text */
.fclkTheme .fc-ch-meta, .fclkTheme .fc-ch-meta span, .fclkTheme .pcSt, .fclkTheme .pcShare { color: var(--fc-text) !important; }
`;

function start(f) {
    fc = f;
    fc.ui.style('fclkStyle', CSS);
    fc.data.setAvatarHook((name) => avatarFor(name));
    fc.data.setLookHook((name, what) => { const l = what === 'pn' ? look(name) : null; return (l && l.pn) || ''; });
    fc.own(() => { fc.data.setAvatarHook(null); fc.data.setLookHook(null); fc.ui.style('fclkStyle', null); stop(); });
    if (typeof document !== 'undefined') {
        document.addEventListener('mouseover', onOver, true);
        document.addEventListener('mouseout', onOut, true);
        fc.own(() => { document.removeEventListener('mouseover', onOver, true); document.removeEventListener('mouseout', onOut, true); });
    }
    let t = 0;
    const soon = () => { clearTimeout(t); t = setTimeout(paint, 60); };
    fc.on('presence:profile', soon);
    fc.on('presence:changed', soon);
    fc.watch(paint, { selector: 'img[src*="gravatar.com/avatar/"], .fc-avatar[data-av], .fc-ch[data-fclook]' });
    fc.tick(paint, 5000);
    return api;
}

const api = {
    themeVars: (th) => themeVars(th),
    applyTheme: (el, th) => applyTheme(el, th),
    setFrame: (el, fr) => setFrame(el, fr),
    frameNames: () => Object.assign({}, FRAME_NAMES),
    themes: () => THEMES.map(x => x.slice()),
    refresh: () => paint()
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
