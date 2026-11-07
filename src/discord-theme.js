/**
 * Fightcord Discord theme
 *
 * Restyles Fightcade's lobby and chat after Discord's dark theme: a 72px icon rail for your
 * games, Discord's greys and blurple, avatar + name message headers, a rounded message box,
 * and a member list with status dots. Presets (dark / AMOLED / classic / FightCord neon) or
 * your own colours from the theme editor, an accent colour, a font and a chat background
 * picture. Local only -- nobody else sees it.
 *
 *   Ctrl+Shift+T          toggle on/off
 *   /theme on|off|art     same from chat (art = game artwork behind the chat)
 *   Settings -> Appearance
 *
 * The --dc-* colours set here are what the design system's --fc-* tokens are built on.
 * Built against snapshots of the real client (snapshot.js). Everything that depends on
 * Fightcade's markup is in the CSS below; if a Fightcade update moves things around, only
 * the layout layer is at risk (see SAFE MODE).
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, config = null;          // discord-theme-config.json
const FC_ORIGIN = 'https://web.fightcade.com/';

const DEFAULTS = {
    enabled: true,
    gameIcons: true,       // game artwork in the rail icons (initials otherwise)
    chatArt: false,        // keep Fightcade's game artwork faintly behind the chat
    cleanNames: true,      // the chat name line without the scout badge
    chatSize: 18,          // chat text px; Discord's default is 16, 18 matches a zoomed Discord
    preset: 'dark',        // dark | amoled | classic | neon | crt | strike | tokyo | oe | custom
    accent: '#5865f2',     // Discord blurple
    font: '',              // '' = Discord's gg sans / Noto Sans
    custom: { bg: '#1b1a1f', panel: '#1b1a1f', dark: '#131215', text: '#dfdfe2' },
    bgFile: '',            // chat background picture: a file next to the plugins (theme-background.*)
    bgDim: 0.6
};

const N_ = (s) => s;          // translated where shown
const PRESETS = { dark: N_('Dark'), ash: N_('Ash'), amoled: N_('Onyx'), classic: N_('Classic grey'), neon: N_('FightCord Neon'),
    crt: N_('Arcade CRT'), strike: N_('3rd Strike'), tokyo: N_('Neon Tokyo'), oe: N_('Online Edition'), custom: N_('Custom (theme editor)') };
// fonts from Google Fonts (free, open licence), loaded only when picked
const GFONTS = { "'Share Tech Mono', monospace": 'Share+Tech+Mono', "'Chakra Petch', sans-serif": 'Chakra+Petch:wght@400;500;600;700',
    "'Exo 2', sans-serif": 'Exo+2:wght@400;500;600;700' };
// Looks (2.11): a whole look in one click -- the theme's colours, accent and font, and (unless you
// keep your own) the animated background and the emulator overlay's font to go with it
const LOOKS = {
    dark: { name: N_('Discord'), desc: N_('The Discord look Fightcord started with'), preset: 'dark', accent: '#5865f2', font: '',
        bg: { style: 'particles', intensity: 0.5 }, emuFont: 'theme', sw: ['#131215', '#1b1a1f', '#dfdfe2'] },
    ash: { name: N_('Ash'), desc: N_('Discord’s greyer dark theme, easy on the eyes'), preset: 'ash', accent: '#5865f2', font: '',
        bg: { style: 'particles', intensity: 0.4 }, emuFont: 'theme', sw: ['#202125', '#323339', '#dbdee1'] },
    onyx: { name: N_('Onyx'), desc: N_('Deep black, made for OLED screens'), preset: 'amoled', accent: '#5865f2', font: '',
        bg: { style: 'particles', intensity: 0.35 }, emuFont: 'theme', sw: ['#000000', '#08080a', '#eeeef0'] },
    neon: { name: N_('FightCord Neon'), desc: N_('Deep navy, blurple and cyan, with a pulsing visualizer'), preset: 'neon', accent: '#5865f2', font: '',
        bg: { style: 'visualizer', look: 'pulse', intensity: 0.55 }, emuFont: 'theme', sw: ['#080a15', '#0d0f1f', '#22e3f2'] },
    crt: { name: N_('Arcade CRT'), desc: N_('Black glass, amber glow, scanlines and a terminal font'), preset: 'crt', accent: '#ffb000', font: "'Share Tech Mono', monospace",
        bg: { style: 'visualizer', look: 'bars', intensity: 0.45 }, emuFont: 'vt323', sw: ['#050705', '#0a0c0a', '#ffb000'] },
    strike: { name: N_('3rd Strike'), desc: N_('Charcoal and fight-poster orange, the game’s art drifting behind'), preset: 'strike', accent: '#f0923a', font: "'Chakra Petch', sans-serif",
        bg: { style: 'art', intensity: 0.55 }, emuFont: 'teko', sw: ['#0b0909', '#121010', '#f0923a'] },
    tokyo: { name: N_('Neon Tokyo'), desc: N_('Midnight indigo, hot pink and cyan, soft neon waves'), preset: 'tokyo', accent: '#eb459e', font: "'Exo 2', sans-serif",
        bg: { style: 'waves', intensity: 0.6 }, emuFont: 'orbitron', sw: ['#080616', '#0e0b1f', '#eb459e'] },
    // 3.11: made of your own copy of the game (own-art.js), so it's only offered once that's been read
    oe: { name: N_('Online Edition'), desc: N_('3rd Strike Online Edition’s own menus: concrete, yellow bars and its lettering'), preset: 'oe', accent: '#e2d51c', font: '',
        bg: { style: 'off' }, emuFont: 'teko', sw: ['#0b0c0b', '#1c1d1b', '#e2d51c'], own: true }
};
const FONTS = { '': 'Discord (gg sans)', "'Segoe UI', sans-serif": 'Segoe UI', "'Noto Sans', sans-serif": 'Noto Sans',
    "'Share Tech Mono', monospace": 'Share Tech Mono', "'Chakra Petch', sans-serif": 'Chakra Petch', "'Exo 2', sans-serif": 'Exo 2',
    'Arial, sans-serif': 'Arial', 'Verdana, sans-serif': 'Verdana', "'Trebuchet MS', sans-serif": 'Trebuchet MS' };
// swatch names: N_('Blurple') N_('Green') N_('Red') N_('Pink') N_('Orange') N_('Teal')
const SWATCHES = { Blurple: '#5865f2', Green: '#23a55a', Red: '#f23f43', Pink: '#eb459e', Orange: '#f0923a', Teal: '#1abc9c' };
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);

// a..b by t, as #rrggbb
function mixHex(a, b, t) {
    const x = hexRgb(a) || [0, 0, 0], y = hexRgb(b) || [0, 0, 0];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// #rrggbb -> [r, g, b], or null
function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
}

// 3.11: text on the accent colour: white, or a very dark shade of it on a light accent (yellow, mint, ...)
function onAccent(rgb) {
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    return lum > 0.4 ? '#' + rgb.map(v => Math.round(v * 0.09).toString(16).padStart(2, '0')).join('') : '#fff';
}

/* ---------------------------------------------------------------- the CSS */

// Two layers, each switched by a class on <html>:
//   dc-theme   colours + font (safe: mostly FC's own theme variables)
//   dc-layout  sizes/positions that depend on FC's markup
// SAFE MODE: dc-layout is only added when the anchors it relies on exist.
//
// FC's component CSS is scoped ([data-v-*] on every selector), so a plain
// class selector from us loses to it. Rather than mirror every FC selector,
// declarations are written normally and made !important by important() below.
// Chromium 80: no flex `gap`, no :is()/:where()/:has(), no aspect-ratio.

const COLORS = `
html.dc-theme {
    /* Discord's current dark theme, colour-picked from a real client screenshot */
    --dc-bg: #1b1a1f; --dc-bg2: #1b1a1f; --dc-bg3: #131215; --dc-input: #212327; --dc-input-edge: #242529;
    --dc-hover: #1f1e24; --dc-select: #2c2b30; --dc-active: #2c2b30; --dc-float: #111113;
    --dc-divider: #28272c;
    --dc-text: #dfdfe2; --dc-head: #f9f9f9; --dc-muted: #818189; --dc-faint: #65676b; --dc-icon: #a9aab1;
    /* --dc-blurple / --dc-blurple-h / --dc-accent-soft: the accent colour, set inline by applyClasses() */
    --dc-green: #23a55a; --dc-yellow: #f0b232;
    --dc-red: #f23f43; --dc-link: #00a8fc; --dc-btn: #2c2b30; --dc-btn-h: #37363c;
    --dc-font: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
}
/* Presets only redefine the palette above (dark = the defaults) */
html.dc-theme.dc-preset-ash {
    /* Discord's Ash (2025): its older greys, a touch lighter and cooler */
    --dc-bg: #323339; --dc-bg2: #2b2c31; --dc-bg3: #202125; --dc-input: #3a3b41; --dc-input-edge: #44454b;
    --dc-hover: #36373d; --dc-select: #3e3f45; --dc-active: #45464c; --dc-float: #1a1b1e;
    --dc-divider: #3f4046; --dc-text: #dbdee1; --dc-head: #f2f3f5; --dc-muted: #9b9ca3; --dc-faint: #6d6f78;
    --dc-icon: #b5b6bd; --dc-btn: #4a4b52; --dc-btn-h: #5a5b62;
}
html.dc-theme.dc-preset-amoled {
    /* Onyx: true black, like the user's AMOLED Discord */
    --dc-bg: #000000; --dc-bg2: #000000; --dc-bg3: #000000; --dc-input: #121214; --dc-input-edge: #1c1c1f;
    --dc-hover: #0a0a0b; --dc-select: #1c1c20; --dc-active: #1c1c20; --dc-float: #0b0b0c;
    --dc-divider: #1a1a1d; --dc-text: #eeeef0; --dc-head: #ffffff; --dc-muted: #9a9aa3;
    --dc-btn: #1c1c20; --dc-btn-h: #26262b;
}
html.dc-theme.dc-preset-classic {
    /* Discord's older, greyer dark theme */
    --dc-bg: #313338; --dc-bg2: #2b2d31; --dc-bg3: #1e1f22; --dc-input: #383a40; --dc-input-edge: #383a40;
    --dc-hover: #2e3035; --dc-select: #35373c; --dc-active: #404249; --dc-float: #111214;
    --dc-divider: #3f4147; --dc-text: #dbdee1; --dc-head: #f2f3f5; --dc-muted: #949ba4; --dc-faint: #6d6f78;
    --dc-icon: #b5bac1; --dc-btn: #4e5058; --dc-btn-h: #6d6f78;
}
html.dc-theme.dc-preset-neon {
    /* the FightCord installer: deep navy with neon blurple / cyan */
    --dc-bg: #0d0f1f; --dc-bg2: #111427; --dc-bg3: #080a15; --dc-input: #161a33; --dc-input-edge: #1f2446;
    --dc-hover: #151936; --dc-select: #1b2045; --dc-active: #232a5a; --dc-float: #070814;
    --dc-divider: #1e2344; --dc-text: #dde1f5; --dc-head: #ffffff; --dc-muted: #8a90b8; --dc-faint: #5d6390;
    --dc-icon: #a3a9d6; --dc-btn: #1d2247; --dc-btn-h: #283064; --dc-link: #22e3f2;
}
html.dc-theme.dc-preset-crt {
    /* Arcade CRT: black glass with a green cast, amber accent */
    --dc-bg: #0a0c0a; --dc-bg2: #0d100d; --dc-bg3: #050705; --dc-input: #121612; --dc-input-edge: #1c241c;
    --dc-hover: #111611; --dc-select: #172017; --dc-active: #1d281d; --dc-float: #040504;
    --dc-divider: #1a221a; --dc-text: #cfeccf; --dc-head: #ecffec; --dc-muted: #6f9a6f; --dc-faint: #4a6a4a;
    --dc-icon: #8fbf8f; --dc-btn: #162016; --dc-btn-h: #1f2c1f; --dc-link: #ffb000;
}
html.dc-theme.dc-preset-strike {
    /* 3rd Strike: charcoal with warm off-white, poster orange */
    --dc-bg: #121010; --dc-bg2: #161312; --dc-bg3: #0b0909; --dc-input: #1d1917; --dc-input-edge: #2a2421;
    --dc-hover: #1b1716; --dc-select: #241e1b; --dc-active: #2d2521; --dc-float: #080606;
    --dc-divider: #2a2320; --dc-text: #ece4dc; --dc-head: #fff6ec; --dc-muted: #a3938a; --dc-faint: #6e625c;
    --dc-icon: #c4b2a6; --dc-btn: #2a221e; --dc-btn-h: #3a2f29; --dc-link: #ffb46b;
}
html.dc-theme.dc-preset-tokyo {
    /* Neon Tokyo: midnight indigo, hot pink, cyan links */
    --dc-bg: #0e0b1f; --dc-bg2: #120e27; --dc-bg3: #080616; --dc-input: #1a1436; --dc-input-edge: #261d4a;
    --dc-hover: #1a1435; --dc-select: #241b47; --dc-active: #2e2259; --dc-float: #070513;
    --dc-divider: #231a45; --dc-text: #e6defc; --dc-head: #ffffff; --dc-muted: #9a8fc4; --dc-faint: #675d96;
    --dc-icon: #b6a9e8; --dc-btn: #241b4a; --dc-btn-h: #30245f; --dc-link: #22e3f2;
}
html.dc-theme.dc-preset-oe {
    /* Online Edition: the menus' near-black, warm off-white and select-bar yellow (the pictures: OE_CSS) */
    --dc-bg: #0f100f; --dc-bg2: #121311; --dc-bg3: #0b0c0b; --dc-input: #171816; --dc-input-edge: #2a2b28;
    --dc-hover: #161715; --dc-select: #20211e; --dc-active: #2a2b27; --dc-float: #070807;
    --dc-divider: #252623; --dc-text: #eeede6; --dc-head: #ffffff; --dc-muted: #a3a197; --dc-faint: #6c6b63;
    --dc-icon: #c9c7bd; --dc-btn: #22231f; --dc-btn-h: #30312c; --dc-link: #e2d51c;
}
/* a chat background picture (theme editor) */
html.dc-theme.dc-has-bg .channelContent {
    background-image: linear-gradient(var(--dc-bg-dim), var(--dc-bg-dim)), var(--dc-chat-bg); background-size: cover;
    background-position: center; background-repeat: no-repeat;
}
html.dc-theme.dc-has-bg .channelContent .chatWrapper, html.dc-theme.dc-has-bg .channelContent .chatContent { background: transparent; background-image: none; }
/* FC's own theme variables -- beats #app.theme-xxx on specificity. They point at
   the palette, so a preset or accent change reaches FC's own parts too. */
html.dc-theme #app {
    --mainColor: var(--dc-bg); --mainColor-dark: var(--dc-bg3); --mainColor-darker: var(--dc-float);
    --mainColor-light: var(--dc-select); --mainColor-lighter: var(--dc-faint); --mainColor-lightest: var(--dc-text);
    --mainColor-lightest-trans-hi: rgba(223,223,226,.7); --mainColor-lightest-trans-md: var(--dc-muted);
    --mainColor-dark-trans-lo: rgba(0,0,0,.3); --mainColor-darker-trans-hi: rgba(0,0,0,.85);
    --mainColor-darker-trans-lo: rgba(0,0,0,.3);
    /* accentColor2 is what FC uses for links and highlights -> Discord's link blue */
    --accentColor: var(--dc-blurple); --accentColor2: #00a8fc; --errorColor: #f23f43;
    --state-online: #23a55a; --state-away: #f0b232;
    font-family: var(--dc-font);
    color: var(--dc-text);
}
html.dc-theme body { background: var(--dc-bg3); }
html.dc-theme #app input, html.dc-theme #app select, html.dc-theme #app textarea, html.dc-theme #app button {
    font-family: var(--dc-font);
}
html.dc-theme ::-webkit-scrollbar { width: 8px; height: 8px; background: transparent; }
html.dc-theme ::-webkit-scrollbar-thumb { background: var(--dc-select); border-radius: var(--fc-r1); border: 0; }
html.dc-theme ::-webkit-scrollbar-track { background: transparent; }
html.dc-theme ::selection { background: var(--dc-accent-soft); }
`;

const LAYOUT = `
/* ============================== server rail ============================== */
html.dc-layout .mainToolbarWrapper { position: relative; z-index: 30; }
html.dc-layout .mainToolbarWrapper .mainToolbar {
    width: 72px; min-width: 72px; background: var(--dc-bg3); background-image: none;
}
/* (they're placed against the 72px rail now, not the window: without a width their click-outside layer is 0px wide) */
html.dc-layout .settingsWrapper, html.dc-layout .notificationsWrapper { left: 72px; right: auto; width: calc(100vw - 72px); }
html.dc-layout .mainToolbar .logo { width: 40px; height: 40px; margin: 12px auto 0; }
html.dc-layout .mainToolbar .logo svg { width: 40px; height: 40px; }
html.dc-layout .mainToolbar .channelsList { padding-top: 0; }
html.dc-layout .mainToolbar .channelsList::before {
    content: ''; display: block; width: 32px; height: 2px; margin: 8px auto 8px; border-radius: 1px;
    background: var(--dc-select);
}
html.dc-layout .channelItemWrapper { margin: 0 0 8px; width: 72px; }
html.dc-layout .channelItemWrapper .channelItem {
    width: 40px; height: 40px; margin: 0 16px; border: 0; border-radius: var(--fc-r3);
    background-color: var(--dc-select); background-position: center; background-size: cover; background-repeat: no-repeat;
    transition: border-radius var(--fc-fast) ease-out, background-color var(--fc-fast) ease-out;
}
html.dc-layout .channelItemWrapper .channelItem:hover,
html.dc-layout .channelItemWrapper .channelItem.active { border-radius: var(--fc-r3); border: 0; }
html.dc-layout .channelItemWrapper .channelItem:not(.dc-art):hover,
html.dc-layout .channelItemWrapper .channelItem:not(.dc-art).active { background-color: var(--dc-blurple); }
html.dc-layout .channelItemWrapper .channelItem .channelItemName {
    font-size: 0; padding: 0; border-radius: inherit; color: var(--dc-text); text-transform: none;
}
html.dc-layout .channelItemWrapper .channelItem .channelItemName::before {
    content: attr(data-dc-initials); font-size: var(--fc-fs-sm); font-weight: 600; letter-spacing: 0; line-height: 1;
    color: var(--dc-text);
}
html.dc-layout .channelItemWrapper .channelItem:hover .channelItemName::before,
html.dc-layout .channelItemWrapper .channelItem.active .channelItemName::before { color: var(--fc-on-accent, #fff); }
html.dc-layout .channelItemWrapper .channelItem.dc-art .channelItemName::before { content: none; }
/* the white pill on the left edge */
html.dc-layout .channelItemWrapper .channelItem::before {
    content: ''; position: absolute; left: -16px; top: 50%; width: 4px; height: 0; margin-top: 0;
    background: var(--dc-head); border-radius: 0 var(--fc-r1) var(--fc-r1) 0;
    transition: height var(--fc-fast) ease-out, margin-top var(--fc-fast) ease-out;
}
html.dc-layout .channelItemWrapper .channelItem:hover::before { height: 20px; margin-top: -10px; }
html.dc-layout .channelItemWrapper .channelItem.active::before { height: 36px; margin-top: -18px; }
/* FC's glow ring becomes Discord's name tooltip */
html.dc-layout .channelItemWrapper .channelItem::after {
    content: attr(data-dc-name); display: block; box-shadow: 0 8px 16px var(--fc-scrim-1);
    position: absolute; left: 52px; top: 50%; width: auto; height: auto; transform: translateY(-50%);
    background: var(--dc-float); color: var(--dc-head); padding: 8px 12px; border-radius: var(--fc-r1);
    font-size: var(--fc-fs-chat); font-weight: 600; line-height: 1.25; white-space: nowrap; text-transform: none;
    opacity: 0; pointer-events: none; z-index: 1000; transition: opacity var(--fc-fast) ease-out;
}
html.dc-layout .channelItemWrapper .channelItem.active::after { box-shadow: 0 8px 16px var(--fc-scrim-1); opacity: 0; }
html.dc-layout .channelItemWrapper .channelItem:hover::after { opacity: 1; }
/* unread / mention / challenge markers */
html.dc-layout .channelItem .notificationsIndicatorsWrapper .notificationsIndicators { left: -16px; }
html.dc-layout .channelItem .notificationsIndicators .newMessages {
    width: 4px; height: 8px; border-radius: 0 var(--fc-r1) var(--fc-r1) 0; background-color: var(--dc-head); box-shadow: none;
}
html.dc-layout .channelItem .notificationsIndicators .newMentions { background-color: var(--dc-red); box-shadow: none; }
html.dc-layout .channelItem .notificationsIndicators .newChallenges { background-color: var(--dc-green); box-shadow: none; }
/* leave / mute: round badges on the icon's right corners, cut out of the rail like Discord's */
html.dc-layout .channelItemWrapper .leaveChannelItem,
html.dc-layout .channelItemWrapper .muteChannelItem {
    width: 20px; height: 20px; padding: 0; right: 10px; border-radius: 50%; box-sizing: border-box;
    border: 3px solid var(--dc-bg3); background: var(--dc-select); z-index: 2;
    display: flex; align-items: center; justify-content: center;
}
html.dc-layout .channelItemWrapper .leaveChannelItem { top: -5px; }
html.dc-layout .channelItemWrapper .muteChannelItem { bottom: -5px; }
html.dc-layout .channelItemWrapper .leaveChannelItem .icon,
html.dc-layout .channelItemWrapper .muteChannelItem .icon { width: 10px; height: 10px; fill: var(--dc-icon); filter: none; }
html.dc-layout .channelItemWrapper .leaveChannelItem:hover { background: var(--dc-red); }
html.dc-layout .channelItemWrapper .muteChannelItem:hover { background: var(--dc-blurple); }
html.dc-layout .channelItemWrapper .leaveChannelItem:hover .icon,
html.dc-layout .channelItemWrapper .muteChannelItem:hover .icon,
html.dc-layout .channelItemWrapper .muteChannelItem:hover .icon .icon-strike { fill: #fff; filter: none; }
/* muted channels keep the badge, in red */
html.dc-layout .channelItemWrapper .muteChannelItem.active { background: var(--dc-red); }
html.dc-layout .channelItemWrapper .muteChannelItem.active .icon,
html.dc-layout .channelItemWrapper .muteChannelItem.active .icon .icon-strike { fill: #fff; filter: none; }
/* browse games = Discord's green "explore" button */
html.dc-layout .mainToolbar .buttonItemWrapper { display: flex; justify-content: center; height: auto; padding: 0; margin: 0 0 8px; }
html.dc-layout .mainToolbar .buttonItemWrapper .searchIcon {
    width: 40px; height: 40px; padding: 10px; box-sizing: border-box; border-radius: var(--fc-r3);
    background: var(--dc-select); fill: var(--dc-green); filter: none;
    transition: border-radius var(--fc-fast) ease-out, background-color var(--fc-fast) ease-out;
}
html.dc-layout .mainToolbar .buttonItemWrapper .searchIcon path { fill: var(--dc-green); }
html.dc-layout .mainToolbar .buttonItemWrapper:hover .searchIcon,
html.dc-layout .mainToolbar .buttonItemWrapper.active .searchIcon,
html.dc-layout .mainToolbar .buttonItemWrapper.router-link-active .searchIcon { background: var(--dc-green); }
html.dc-layout .mainToolbar .buttonItemWrapper:hover .searchIcon path,
html.dc-layout .mainToolbar .buttonItemWrapper.active .searchIcon path,
html.dc-layout .mainToolbar .buttonItemWrapper.router-link-active .searchIcon path { fill: #fff; }
/* bottom buttons + you */
html.dc-layout .mainToolbar .buttonBar { width: 72px; padding: 8px 0 12px; margin-left: 0; margin-right: 0; }
html.dc-layout .mainToolbar .buttonBar .notificationsButton svg,
html.dc-layout .mainToolbar .buttonBar .settingsButton svg { width: 22px; height: 22px; filter: none; }
html.dc-layout .mainToolbar .buttonBar .notificationsButton path,
html.dc-layout .mainToolbar .buttonBar .settingsButton path { fill: var(--dc-icon); }
html.dc-layout .mainToolbar .buttonBar .notificationsButton:hover path,
html.dc-layout .mainToolbar .buttonBar .settingsButton:hover path { fill: var(--dc-head); }
html.dc-layout .mainToolbar .buttonBar .userButton .userAvatarWrapper { width: 40px; height: 40px; margin: 0 auto; }
html.dc-layout .mainToolbar .buttonBar .userButton .userAvatar { width: 40px; height: 40px; border-radius: 50%; }
html.dc-layout .mainToolbar .buttonBar .userButton .userState {
    width: 14px; height: 14px; right: -2px; bottom: -2px; border: 3px solid var(--dc-bg3); box-shadow: none;
}
html.dc-layout .mainToolbar .buttonBar .userButton .userStateMenu {
    background: var(--dc-float); border-radius: var(--fc-r2); box-shadow: var(--fc-elev-2); border: 0;
}

/* ============================== channel header ============================== */
html.dc-layout .channelToolbar {
    height: 48px; min-height: 48px; background: var(--dc-bg); padding: 0 8px 0 16px; position: relative; z-index: 3;
    box-shadow: var(--fc-elev-0); border-bottom: 1px solid var(--dc-divider); box-sizing: border-box;
}
html.dc-layout .channelToolbar .channelInfo { height: 48px; align-items: center; min-width: 0; flex: 1 1 auto; }
html.dc-layout .channelToolbar .channelInfo .name:not(.title) { flex: 0 0 auto; overflow: visible; }
html.dc-layout .channelToolbar .channelInfo .name {
    font-size: var(--fc-fs-ui); font-weight: 600; color: var(--dc-muted); text-transform: none; letter-spacing: 0;
    padding: 0 8px; line-height: 20px; height: auto;
}
html.dc-layout .channelToolbar .channelInfo .name.title {
    font-size: var(--fc-fs-lg); color: var(--dc-head); padding-left: 0; margin-right: 4px;
    border-right: 1px solid var(--dc-divider); padding-right: 12px;
    flex: 0 1 auto; min-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* the rom name is already in the title; Discord's header has no room for it */
html.dc-layout .channelToolbar .channelInfo .name[title="Rom name"] { display: none; }
html.dc-layout .channelToolbar .channelInfo .name.title::first-letter { color: var(--dc-faint); font-weight: 400; }
html.dc-layout .channelToolbar .channelInfo .name .link { color: var(--dc-icon); text-transform: none; font-weight: 500; font-size: var(--fc-fs-md); }
html.dc-layout .channelToolbar .channelInfo .name .link:hover { color: var(--dc-head); text-decoration: none; }
html.dc-layout .channelToolbar .rankedWrapper svg path { fill: var(--dc-icon); }
html.dc-layout .channelToolbar .channelActions { height: 48px; align-items: center; flex: 0 0 auto; }
html.dc-layout .button-alt {
    height: 32px; min-height: 32px; padding: 2px 16px; border: 0; border-radius: 3px; background: var(--dc-btn);
    color: #fff; font-size: var(--fc-fs-md); font-weight: 500; text-transform: none; letter-spacing: 0; margin-left: 8px;
    transition: background-color var(--fc-fast) ease;
}
html.dc-layout .button-alt:hover { background: var(--dc-btn-h); color: #fff; border: 0; }
html.dc-layout .button-alt::after { display: none; }
html.dc-layout .button-alt .icon, html.dc-layout .button-alt:hover .icon { width: 18px; height: 18px; fill: #fff; }
html.dc-layout .button-generic {
    border: 0; border-radius: 3px; background: var(--dc-blurple); color: var(--fc-on-accent, #fff); font-weight: 500;
    text-transform: none; box-shadow: none; letter-spacing: 0;
}
html.dc-layout .button-generic:hover { background: var(--dc-blurple-h); color: var(--fc-on-accent, #fff); }
html.dc-layout .button-generic::after { display: none; }

/* ============================== chat ============================== */
html.dc-layout .chatWrapper { background: var(--dc-bg); }
html.dc-layout:not(.dc-chat-art) .chatWrapperBg { background: var(--dc-bg); background-image: none; }
html.dc-layout.dc-chat-art .chatWrapperBg { opacity: .1; }
html.dc-layout .chatContent { padding-bottom: 8px; }
/* Sizes follow Discord's proportions off one text size, --dc-chat (set from the
   "Chat text size" option): line-height 1.375, .125em padding per line, name at
   text size, time at .75em. Avatar and the 72px text column stay fixed, as in Discord. */
html.dc-layout .chatContent .messageWrapper.chat { margin: 17px 0 0; padding: 0; background: none; border: 0; }
html.dc-layout .chatContent .message.chat { position: relative; padding: 0; margin: 0; background: none; border: 0; }
html.dc-layout .chatContent .message.chat header {
    display: flex; align-items: baseline; min-height: 0; height: auto; padding: .125em 48px 0 72px; margin: 0;
    font-size: var(--dc-chat, 18px); line-height: 1.375; background: none; border: 0;
}
html.dc-layout .chatContent .message.chat header .avatarWrapper {
    position: absolute; left: 16px; top: 2px; width: 40px; height: 40px; margin: 0; padding: 0; z-index: 1;
}
html.dc-layout .chatContent .message.chat header .avatar { width: 40px; height: 40px; border-radius: 50%; cursor: pointer; }
html.dc-layout .chatContent .message.chat header .authorAndTime { display: flex; align-items: center; min-width: 0; line-height: 1.375; font-size: 1em; }
html.dc-layout .chatContent .message.chat header .author {
    font-size: 1em; font-weight: 500; color: var(--dc-head); line-height: 1.375; letter-spacing: 0; text-transform: none;
}
html.dc-layout .chatContent .message.chat header .author:hover { text-decoration: underline; cursor: pointer; }
html.dc-layout .chatContent .message.chat header .time {
    font-size: .75em; font-weight: 400; color: var(--dc-muted); margin-left: .5em; line-height: 1.375; visibility: visible;
}
html.dc-layout .chatContent .message.chat .line {
    padding: .125em 48px .125em 16px; font-size: var(--dc-chat, 18px); line-height: 1.375; color: var(--dc-text); background: none;
}
html.dc-layout .chatContent .message.chat .line:hover { background: var(--dc-hover); }
html.dc-layout .chatContent .message.chat .line .time {
    width: 56px; padding-right: 12px; box-sizing: border-box; text-align: right;
    font-size: .6875em; color: var(--dc-muted); line-height: 2; white-space: nowrap; overflow: hidden;
}
html.dc-layout .chatContent .message.chat .blocksContainer { font-size: 1em; line-height: 1.375; color: var(--dc-text); }
html.dc-layout .chatContent .message.chat .blocks .regular { color: var(--dc-text); }
html.dc-layout .chatContent .blocks .user {
    background: var(--dc-accent-soft); color: var(--dc-head); border-radius: 3px; padding: 0 2px; font-weight: 500;
}
html.dc-layout .chatContent .blocks .user:hover { background: var(--dc-blurple); color: var(--fc-on-accent, #fff); }
html.dc-layout .chatContent .blocks a { color: var(--dc-link); }
/* FC's emphasis (.highlight -- NOT a mention) is bold accent-blue; Discord's bold is just bold */
html.dc-layout .chatContent .message.chat .blocks .highlight { color: var(--dc-head); font-weight: 700; }
/* the rules / resources message becomes an embed card */
html.dc-layout .chatContent .messageWrapper.motd { margin: 16px 48px 8px 72px; padding: 0; background: none; }
html.dc-layout .chatContent .messageWrapper.motd .motd {
    background: var(--dc-input); border: 0; border-left: 4px solid var(--dc-blurple); border-radius: var(--fc-r1);
    padding: 8px 16px 16px 12px; box-shadow: none;
}
html.dc-layout .chatContent .motd .line { padding: 0; }
html.dc-layout .chatContent .motd .line .time { display: none; }
html.dc-layout .chatContent .motd .blocksContainer { color: var(--dc-text); font-size: var(--fc-fs-md); line-height: 18px; }

/* ============================== system messages ============================== */
/* challenge results/errors, incoming challenges, end-of-match, bot/channel notices.
   FC draws these as shaded full-width bands with bold capitals; Discord draws
   system messages as a plain muted line in the text column. */
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) {
    position: relative; margin: 6px 0 0; padding: 3px 48px 3px 72px; min-height: 22px;
    background: none; box-shadow: none; border: 0; animation: none; font-size: var(--fc-fs-chat); line-height: 22px;
}
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd):hover { background: var(--dc-hover); }
/* the band is drawn twice: on the wrapper and again on the inner .message */
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) .message {
    padding: 0; margin: 0; background: none; box-shadow: none; border: 0; animation: none;
}
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) header { display: none; }
html.dc-layout .chatContent .messageWrapper.channel header { display: flex; padding: 0; min-height: 0; }
html.dc-layout .chatContent .messageWrapper.channel header .author { text-transform: none; font-size: var(--fc-fs-chat); }
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) .line { padding: 0; font-size: var(--fc-fs-chat); line-height: 22px; }
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) .line .time { display: none; }
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) .regular {
    font-weight: 400; text-transform: none; color: var(--dc-muted);
}
html.dc-layout .chatContent .messageWrapper.bot { font-style: normal; font-size: var(--fc-fs-md); color: var(--dc-muted); }
html.dc-layout .chatContent .message .challengeContainer,
html.dc-layout .chatContent .message .challengeWrapper { padding: 0; align-items: center; }
html.dc-layout .chatContent .message .challengeContainer .title,
html.dc-layout .chatContent .message .challengeWrapper .title {
    font-size: var(--fc-fs-chat); font-weight: 400; text-transform: none; letter-spacing: 0; line-height: 22px;
    color: var(--dc-muted); margin: 0 8px 0 0;
}
html.dc-layout .chatContent .message .challengeContainer .title strong,
html.dc-layout .chatContent .message .challengeWrapper .title strong { color: var(--dc-head); font-weight: 600; }
html.dc-layout .chatContent .message .wrapUpWrapper { font-weight: 500; }
html.dc-layout .chatContent .message .wrapUpWrapper.accepted { color: var(--dc-green); }
html.dc-layout .chatContent .message .wrapUpWrapper.declined { color: var(--dc-red); }
html.dc-layout .chatContent .message .challengeWrapper .challengeContent .userInfo { margin: 4px 16px 4px 0; }
html.dc-layout .chatContent .message .challengeWrapper .challengeContent .userInfo .name {
    font-size: var(--fc-fs-lg); font-weight: 600; color: var(--dc-head);
}
/* Accept / Decline / Cancel become Discord buttons */
html.dc-layout .chatContent .messageWrapper .buttons { margin: 4px 0 2px; text-transform: none; font-weight: 500; }
html.dc-layout .chatContent .messageWrapper .accept-challenge,
html.dc-layout .chatContent .messageWrapper .decline-challenge,
html.dc-layout .chatContent .messageWrapper .cancel-challenge,
html.dc-layout .chatContent .messageWrapper .rank-option {
    display: inline-flex; align-items: center; height: 28px; padding: 0 12px; margin: 0 8px 0 0;
    border-radius: var(--fc-r1); font-size: var(--fc-fs-md); font-weight: 500; text-transform: none; letter-spacing: 0;
    text-shadow: none; filter: none; cursor: pointer; user-select: none;
    background: var(--dc-btn); color: var(--dc-text); transition: background-color var(--fc-fast) ease;
}
html.dc-layout .chatContent .messageWrapper .accept-challenge { background: var(--dc-green); color: #fff; }
html.dc-layout .chatContent .messageWrapper .accept-challenge:hover { background: #1a8a4a; color: #fff; }
html.dc-layout .chatContent .messageWrapper .decline-challenge:hover,
html.dc-layout .chatContent .messageWrapper .cancel-challenge:hover,
html.dc-layout .chatContent .messageWrapper .rank-option.cancel:hover { background: var(--dc-red); color: #fff; text-shadow: none; filter: none; }
html.dc-layout .chatContent .messageWrapper .rank-option:hover { background: var(--dc-btn-h); color: #fff; filter: none; }
/* a challenge still waiting for an answer: Discord's mention highlight (tagged by JS) */
html.dc-layout .chatContent .messageWrapper.dc-live:not(.chat):not(.motd) {
    background: rgba(240,178,50,.08); box-shadow: inset 2px 0 0 var(--dc-yellow);
}
html.dc-layout .chatContent .messageWrapper.dc-live:not(.chat):not(.motd):hover { background: rgba(240,178,50,.12); }
html.dc-layout .chatContent .messageWrapper.dc-live:not(.chat):not(.motd) .title { color: var(--dc-text); }
/* end of match: an embed card, like the rules message */
html.dc-layout .chatContent .messageWrapper.endgame .endgameMessageWrapper {
    display: inline-block; max-width: 560px; margin: 2px 0; padding: 8px 16px 8px 12px; box-shadow: none; border: 0;
    border-left: 4px solid var(--dc-blurple); border-radius: var(--fc-r1); background: var(--dc-input);
}
html.dc-layout .chatContent .endgameMessageWrapper h3 {
    margin: 0 0 2px; font-size: var(--fc-fs-chat); font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--dc-head);
}
html.dc-layout .chatContent .endgameMessageWrapper p { margin: 0; font-size: var(--fc-fs-md); line-height: 20px; color: var(--dc-muted); }
html.dc-layout .chatContent .endgameMessageWrapper a { color: var(--dc-link); font-weight: 400; }
html.dc-layout .chatContent .endgameMessageWrapper .wrapUpWrapper.won { color: var(--dc-green); }
html.dc-layout .chatContent .endgameMessageWrapper .wrapUpWrapper.lost { color: var(--dc-red); }

/* ============================== cleaner name line ============================== */
/* name, flag, rank, time -- like Discord */
html.dc-layout.dc-clean-names .chatContent .message.chat header .fcScoutBadge { display: none; }
html.dc-layout.dc-clean-names .chatContent .message.chat header .author .flagWrapper { margin-left: 6px; }

/* ============================== message box ============================== */
html.dc-layout .chatInput { padding: 0 16px 12px; background: var(--dc-bg); border: 0; height: auto; }
html.dc-layout .chatInput input.input {
    height: 52px; background: var(--dc-input); color: var(--dc-text); border: 1px solid var(--dc-input-edge);
    border-radius: var(--fc-r2); padding: 14px 104px 14px 16px; font-size: var(--fc-fs-lg); line-height: 22px; box-shadow: none;
    box-sizing: border-box;
}
html.dc-layout .chatInput input.input::placeholder { color: var(--dc-faint); }
html.dc-layout .chatInput .emojiBtn, html.dc-layout .chatInput .fontStyleBtn {
    top: 26px; background: transparent; border: 0; color: var(--dc-icon); opacity: .8;
}
html.dc-layout .chatInput .fontStyleBtn { right: 28px; }
html.dc-layout .chatInput .emojiBtn { right: 60px; }
html.dc-layout .chatInput .emojiBtn:hover, html.dc-layout .chatInput .fontStyleBtn:hover { opacity: 1; color: var(--dc-head); }
/* Fightcade's "New messages · Discard · Go to first" bar (also mentions / challenges): Discord's bar on top of the box */
html.dc-layout .chatInput .notificationsHelpersWrapper { left: 16px !important; right: 16px !important; width: auto !important; bottom: 60px !important; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem {
    justify-content: space-between !important; padding: 5px 14px 9px !important; margin-bottom: -4px;
    border-radius: var(--fc-r2) var(--fc-r2) 0 0; box-shadow: none !important; text-transform: none !important; letter-spacing: 0;
    font: 600 var(--fc-fs-ui)/18px var(--dc-font, inherit) !important; color: #fff !important; background: var(--fc-accent, #5865f2) !important; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem + .notificationsHelpersItem { border-radius: 0; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem.mention { background: var(--fc-danger) !important; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem.challenge { background: var(--fc-success) !important; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem .title {
    width: auto !important; flex: 1 1 auto; margin: 0 !important; text-align: left !important; color: #fff !important;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem .options {
    width: auto !important; flex: none; display: flex; align-items: center; margin-left: 12px; font-size: var(--fc-fs-ui) !important; text-align: right !important; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem .options > * + * { margin-left: 16px !important; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem .options > * { margin: 0 !important; color: rgba(255,255,255,.85) !important; cursor: pointer; }
html.dc-layout .chatInput .notificationsHelpersWrapper .notificationsHelpersItem .options > *:hover { color: #fff !important; text-decoration: underline; }

/* ============================== member list ============================== */
html.dc-layout .usersListToolbar,
html.dc-layout .usersListToolbar .usersListWrapper { width: 300px; min-width: 300px; background: var(--dc-bg2); background-image: none; }
html.dc-layout .usersListToolbar .usersListWrapper { border-left: 1px solid var(--dc-divider); box-sizing: border-box; }
html.dc-layout .usersListWrapper .usersOnlineTitle,
html.dc-layout .usersListWrapper .usersAwayTitle,
html.dc-layout .usersListWrapper .usersIgnoredTitle,
html.dc-layout .usersListWrapper .matchesTitleWrapper {
    font-size: var(--fc-fs-md); font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--dc-muted);
    padding: 20px 8px 4px 16px; height: auto; min-height: 0; line-height: 18px; background: none; border: 0;
    box-shadow: none;
}
/* FC pins this panel (position: fixed; top: 60px) under its 60px header -- ours is 48px */
html.dc-layout .usersListToolbar .usersListWrapper { top: 48px; bottom: 0; padding-top: 16px; }
html.dc-layout .usersListWrapper .usersOnlineTitle { padding-top: 4px; display: flex; align-items: center; }
html.dc-layout .usersListWrapper .usersOnlineTitle > span:first-of-type,
html.dc-layout .usersListWrapper .usersAwayTitle > span:first-of-type,
html.dc-layout .usersListWrapper .usersIgnoredTitle > span:first-of-type {
    background: none; color: var(--dc-muted); font-size: var(--fc-fs-md); font-weight: 500; padding: 0; margin-left: 4px; min-width: 0;
}
html.dc-layout .usersListWrapper .usersOnlineTitle > span:first-of-type::before,
html.dc-layout .usersListWrapper .usersAwayTitle > span:first-of-type::before,
html.dc-layout .usersListWrapper .usersIgnoredTitle > span:first-of-type::before { content: '— '; }
html.dc-layout .usersListWrapper .userItem {
    display: flex; align-items: center; height: 42px; min-height: 42px; padding: 0 8px; margin: 0 8px 2px;
    border-radius: var(--fc-r1); background: none; border: 0; box-sizing: border-box;
}
html.dc-layout .usersListWrapper .userItem:hover { background: var(--dc-select); }
html.dc-layout .usersListWrapper .userItem .avatarWrapper {
    order: -1; position: relative; width: 32px; height: 32px; margin: 0 12px 0 0;
}
html.dc-layout .usersListWrapper .userItem .avatarWrapper .image { width: 32px; height: 32px; border-radius: 50%; }
html.dc-layout .usersListWrapper .userItem .avatarWrapper::after {
    content: ''; position: absolute; right: -3px; bottom: -3px; width: 10px; height: 10px; border-radius: 50%;
    border: 3px solid var(--dc-bg2); background: var(--dc-faint);
}
html.dc-layout .usersListWrapper .userItem:hover .avatarWrapper::after { border-color: var(--dc-select); }
html.dc-layout .usersListWrapper .usersOnlineList .userItem .avatarWrapper::after { background: var(--dc-green); }
html.dc-layout .usersListWrapper .usersAwayList .userItem .avatarWrapper::after { background: var(--dc-yellow); }
html.dc-layout .usersListWrapper .usersAwayList .userItem { opacity: .55; }
html.dc-layout .usersListWrapper .usersAwayList .userItem:hover { opacity: 1; }
html.dc-layout .usersListWrapper .userItem .nameAndGame { order: 0; flex: 1 1 auto; min-width: 0; }
html.dc-layout .usersListWrapper .userItem .playerName {
    font-size: var(--fc-fs-chat); font-weight: 500; color: var(--dc-muted); line-height: 20px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
html.dc-layout .usersListWrapper .userItem:hover .playerName { color: var(--dc-head); }
html.dc-layout .usersListWrapper .userItem .nameAndGame > :not(.playerName) { font-size: var(--fc-fs-sm); color: var(--dc-muted); line-height: 16px; }
html.dc-layout .usersListWrapper .userItem .flagWrapper { order: 1; width: 18px; height: 13px; margin: 0 0 0 6px; background-size: contain; }
html.dc-layout .usersListWrapper .userItem .rankWrapper { order: 2; margin: 0 0 0 6px; }
html.dc-layout .usersListWrapper .userItem .pingWrapper { order: 3; margin: 0 0 0 6px; }
html.dc-layout .usersListWrapper .matchesList .matchItem {
    background: var(--dc-bg); border: 0; border-radius: var(--fc-r2); margin: 0 8px 4px; box-shadow: none;
}

/* ============================== settings panel ============================== */
html.dc-layout .settingsWrapper .settingsSection { background: var(--dc-bg2); box-shadow: 0 0 0 1px var(--fc-scrim-1); }
html.dc-layout .settingsWrapper .settingsSection .label {
    font-size: var(--fc-fs-sm); font-weight: 700; text-transform: uppercase; letter-spacing: .02em; color: var(--dc-muted);
}
html.dc-layout .settingsWrapper .settingsSection .option .title { color: var(--dc-text); font-size: var(--fc-fs-md); }
html.dc-layout .settingsWrapper .settingsSection select,
html.dc-layout .settingsWrapper .settingsSection input[type="text"],
html.dc-layout .settingsWrapper .settingsSection input[type="password"],
html.dc-layout .settingsWrapper .settingsSection input.userEmail {
    background: var(--dc-bg3); color: var(--dc-text); border: 0; border-radius: var(--fc-r1); box-shadow: none;
}
/* checkboxes become Discord's toggle switches */
html.dc-layout .settingsWrapper .settingsSection .option .optionCheckboxWrapper .optionCheckbox {
    width: 40px; height: 24px; border: 0; border-radius: var(--fc-r3); background: #80848e; box-shadow: none;
    transition: background-color var(--fc-med) ease;
}
html.dc-layout .settingsWrapper .settingsSection .option .optionCheckboxWrapper:hover .optionCheckbox { box-shadow: none; }
html.dc-layout .settingsWrapper .settingsSection .option .optionCheckboxWrapper input[type="checkbox"] ~ .optionCheckbox::before {
    top: 3px; left: 3px; right: auto; bottom: auto; width: 18px; height: 18px; border-radius: 50%;
    background: #fff; opacity: 1; transition: transform var(--fc-med) ease;
}
html.dc-layout .settingsWrapper .settingsSection .option .optionCheckboxWrapper input[type="checkbox"]:checked ~ .optionCheckbox {
    background: var(--dc-green); box-shadow: none;
}
html.dc-layout .settingsWrapper .settingsSection .option .optionCheckboxWrapper input[type="checkbox"]:checked ~ .optionCheckbox::before {
    transform: translateX(16px);
}

/* ============================== browse / search ============================== */
html.dc-layout .welcomeWrapper, html.dc-layout .searchWrapper { background: var(--dc-bg); background-image: none; }
html.dc-layout .welcomeWrapper .text-filter, html.dc-layout .searchWrapper .text-filter {
    background: var(--dc-bg3); color: var(--dc-text); border: 0; border-radius: var(--fc-r1); box-shadow: none;
}
`;

// Written with its own !important: the data: URL has characters important() would split on.
const SWORDS = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' " +
    "stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E" +
    "%3Cpath d='M14.5 17.5L3 6V3h3l11.5 11.5'/%3E%3Cpath d='M13 19l6-6M16 16l4 4M19 21l2-2'/%3E" +
    "%3Cpath d='M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2'/%3E%3C/svg%3E\")";
const RAW = `
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd):not(.bot)::before {
    content: '' !important; position: absolute !important; left: 32px !important; top: 6px !important;
    width: 16px !important; height: 16px !important; background: var(--dc-faint) !important;
    -webkit-mask: ${SWORDS} center / contain no-repeat !important;
}
html.dc-layout .chatContent .messageWrapper.dc-live:not(.chat):not(.motd)::before { background: var(--dc-yellow) !important; }
`;


// 3.11: the Online Edition Look's pictures and lettering, from your own copy of the game (own-art.js;
// html.dc-oe-own only while they're there). The menus' concrete behind see-through panels, the yellow
// select bar on whatever is picked or pointed at, their dark panel on windows, faint scanlines, and the
// District lettering on titles, names and buttons (never the messages themselves).
const OE = 'html.dc-theme.dc-preset-oe.dc-oe-own';
const OE_DISPLAY = "'FC OE District', var(--dc-font, 'Noto Sans'), sans-serif";
const OE_BAR = 'var(--dc-oe-bar) 0 0 / 100% 100% no-repeat, #e2d51c';
const OE_CSS = `
${OE} body { background: transparent; }
${OE}.dc-oe-hero body::before { content: ''; position: fixed; right: 1vw; bottom: 0; width: 44vw; height: 96vh; z-index: -1; pointer-events: none;
    background: var(--dc-oe-hero) right bottom / contain no-repeat; opacity: .2; }
${OE} #app, ${OE} .mainWrapper, ${OE} .channelContent, ${OE} .chatWrapper, ${OE} .chatWrapperBg, ${OE} .chatInput,
${OE} .welcomeWrapper, ${OE} .searchWrapper { background: transparent; background-image: none; }
${OE} .usersListToolbar, ${OE} .usersListToolbar .usersListWrapper { background: rgba(0,0,0,.34); }
/* text stays easy to read on the lighter concrete */
${OE} .chatContent .message.chat header .author, ${OE} .usersListWrapper .userItem .playerName,
${OE} .fcm-gh, ${OE} .channelToolbar, ${OE} #fcordModal .fcordSide .item:not(.on) { text-shadow: 0 1px 0 rgba(0,0,0,.75); }
${OE} .usersListWrapper .userItem:hover .playerName { text-shadow: none; }
/* the select bar */
${OE} #fcordModal .fcordSide .item.on, ${OE} .fc-btn:not(.sec):not(.ghost):not(.danger):not(.success):not(.brand) {
    background: ${OE_BAR}; color: #141400; }
${OE} .usersListWrapper .userItem:hover .playerName, ${OE} .usersListWrapper .userItem:hover .nameAndGame > * { color: #141400; }
${OE} .fc-btn:not(.sec):not(.ghost):not(.danger):not(.success):not(.brand):hover { filter: brightness(1.1); }
${OE} #fcordModal .fcordSide .item .nb.n, ${OE} .chatContent .blocks .user:hover { background: #e2d51c; color: #141400; }
/* the bar's own shape (not Discord's round pills), a yellow tint on what's pointed at */
${OE} #fcordModal .fcordSide .item, ${OE} .fc-btn:not(.sec):not(.ghost):not(.danger):not(.success):not(.brand) { border-radius: 3px; }
${OE} #fcordModal .fcordSide .item:not(.on):hover { background: rgba(226,213,28,.09); color: #fff; }
/* Fightcord's own blue-purple (the Updates / My Fightcord card, brand buttons) in the menus' colours */
${OE} .fc-btn.brand, ${OE} #fcordModal .fcordHero .logo { background: ${OE_BAR}; color: #141400; box-shadow: 0 0 22px rgba(226,213,28,.28); }
${OE} #fcordModal .fcordHero { background: linear-gradient(120deg, rgba(226,213,28,.16), rgba(226,213,28,.04) 60%, transparent), rgba(0,0,0,.45);
    box-shadow: inset 3px 0 0 #e2d51c; }
${OE} #fcordModal h3 { font-family: ${OE_DISPLAY}; font-weight: 400; font-synthesis: none; text-transform: none; font-size: var(--fc-fs-lg); color: #e2d51c; }
/* the settings window on the concrete like the game's menu screens; pop-ups on its dark panel */
${OE} #fcordModal .fcordWin { background: linear-gradient(rgba(8,9,8,.42), rgba(8,9,8,.74)), var(--dc-oe-concrete) center / cover no-repeat, #0e0f0e; }
${OE} .fc-modal { background: linear-gradient(rgba(14,15,14,.55), rgba(14,15,14,.55)), var(--dc-oe-panel) center / 100% 100% no-repeat, #0e0f0e; }
${OE} #fcordModal .fcordSide { background: rgba(0,0,0,.36); }
${OE} #fcordModal .fcordHead > .fc-set, ${OE} #fcordModal .fc-set { background: rgba(10,11,10,.62); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
${OE} .dcLook { background: rgba(0,0,0,.4); }
/* the lettering */
${OE} .channelToolbar .channelInfo .name.title, ${OE} .chatContent .message.chat header .author, ${OE} .usersListWrapper .userItem .playerName,
${OE} .usersListWrapper .usersOnlineTitle, ${OE} .usersListWrapper .usersAwayTitle, ${OE} .usersListWrapper .usersIgnoredTitle, ${OE} .usersListWrapper .matchesTitleWrapper,
${OE} .chatContent .message .challengeWrapper .challengeContent .userInfo .name, ${OE} .chatContent .endgameMessageWrapper h3,
${OE} .fc-set-title, ${OE} .fc-field-text > b, ${OE} .fc-modal-h, ${OE} .fc-card-h, ${OE} .fc-tab, ${OE} .fc-btn, ${OE} .button-alt, ${OE} .button-generic,
${OE} .accept-challenge, ${OE} .decline-challenge, ${OE} .cancel-challenge, ${OE} .rank-option,
${OE} #fcordModal .fcordSide .item, ${OE} #fcordModal .fcordSide .sec, ${OE} #fcordModal .fcordHead h2, ${OE} .dcLook > b, ${OE} #l3Title, ${OE} #l3Panel .l3Me b,
${OE} .cbnName, ${OE} .fcm-gh {
    font-family: ${OE_DISPLAY}; font-weight: 400; font-synthesis: none; letter-spacing: .01em; }
${OE} .usersListWrapper .usersOnlineTitle, ${OE} .usersListWrapper .usersAwayTitle, ${OE} .usersListWrapper .usersIgnoredTitle,
${OE} .fc-card-h, ${OE} .fcm-gh { text-transform: none; font-size: 17px; letter-spacing: .01em; }
${OE} .channelToolbar .channelInfo .name.title, ${OE} .cbnName { font-size: 22px; }
/* the game's menus: big slanted items, the section names in yellow */
${OE} #fcordModal .fcordSide .item { font-size: 17px; padding: 8px 10px; white-space: nowrap; }
${OE} #fcordModal .fcordSide .item > span { overflow: hidden; text-overflow: ellipsis; }
${OE} #fcordModal .fcordSide .sec { text-transform: none; font-size: 17px; color: #e2d51c; }
${OE} #fcordModal .fcordHead h2 { font-size: 34px; line-height: 1; text-shadow: 0 3px 0 rgba(0,0,0,.55); }
${OE} .fc-set-title { font-size: 26px; }
${OE} .fc-field-text > b { font-size: 16px; }
${OE} .fc-btn { font-size: 15px; }
${OE} .fc-modal-h { font-size: 24px; }
${OE} .usersListWrapper .userItem .playerName { font-size: 16px; }
${OE} .usersListWrapper .userItem { border-radius: 3px; }
${OE} .usersListWrapper .usersOnlineTitle > span, ${OE} .usersListWrapper .usersAwayTitle > span, ${OE} .usersListWrapper .pingWrapper,
${OE} #fcordModal .fcordSide .item .nb.n { font-family: 'FC OE Numbers', ${OE_DISPLAY}; }

/* ---- the rest of the game's menu kit ---- */
/* the wall: the concrete on the page itself (so your main's art can sit between it and everything else). Two of
   the menus' graffiti tags, kept to the edges and under a darker veil so nothing sits behind the messages */
/* (3.12 speed: its own element on its own layer, painted once. It used to be the page's fixed background,
   which Chromium repaints -- three pictures, the concrete scaled to the window -- on every scroll of the chat
   or the member list. The faint scanlines live in it too, under the UI: a full-screen blended layer over
   everything made every change re-blend the whole window) */
${OE} { background: #0b0c0b; }
#dcOeWall { display: none; }
${OE} #dcOeWall { display: block; position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: -2; pointer-events: none;
    contain: strict; will-change: transform;
    background: linear-gradient(rgba(6,7,6,.34), rgba(6,7,6,.66)),
    var(--dc-oe-tag1) 97% 6% / 260px auto no-repeat, var(--dc-oe-tag3) 2% 96% / 240px auto no-repeat,
    var(--dc-oe-concrete) center / cover no-repeat, #0b0c0b; }
${OE} #dcOeWall > i { position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: var(--dc-oe-scan) 0 0 / 4px 4px; opacity: .05; }
/* a soft shade behind the messages, so they read on the concrete */
${OE} .channelContent .chatWrapper { background: linear-gradient(90deg, rgba(8,9,8,.42), rgba(8,9,8,.18) 70%, transparent); }
/* the title bar: the game's logo on the left, on a brushed band */
${OE} #l3Title { background: var(--dc-oe-line) center / 100% 100% no-repeat, rgba(0,0,0,.55); }
${OE} #l3Title::before { content: ''; position: absolute; left: 10px; top: 3px; width: 190px; height: 26px; pointer-events: none;
    background: var(--dc-oe-logo) left center / auto 26px no-repeat, var(--dc-oe-oe) 56px center / auto 17px no-repeat; }
/* the channel header on the same band */
${OE} .mainToolbarWrapper .mainToolbar { background: rgba(0,0,0,.42); }
${OE} .channelToolbar { background: var(--dc-oe-line) center / 100% 100% no-repeat, rgba(0,0,0,.3); border-bottom: 2px solid #e2d51c; }
/* the rail: the menus' yellow pointer marks the channel you're in */
${OE} .channelItemWrapper .channelItem.active::before { left: -15px; width: 13px; height: 16px; margin-top: -8px; border-radius: 0;
    background: var(--dc-oe-cursor) center / contain no-repeat; }
/* the member list: group names on the menus' olive bar, the pointer on the row under the mouse, the game's status lights */
${OE} .fcm-gh { margin: 12px 8px 4px; padding: 3px 10px 4px; border-radius: 2px; color: #eeede6;
    background: var(--dc-oe-row) 0 0 / 100% 100% no-repeat, rgba(41,43,19,.8); }
${OE} .usersListWrapper .userItem { position: relative; }
${OE} .usersListWrapper .userItem:hover::before { content: ''; position: absolute; left: -9px; top: 50%; width: 10px; height: 13px; margin-top: -6px;
    pointer-events: none; background: var(--dc-oe-cursor) center / contain no-repeat; }
${OE} .usersListWrapper .userItem .avatarWrapper::after { width: 12px; height: 12px; right: -3px; bottom: -3px; border: 0; border-radius: 50%;
    background: var(--dc-oe-dotOrange) center / cover no-repeat; }
${OE} .usersListWrapper .usersOnlineList .userItem .avatarWrapper::after { background: var(--dc-oe-dotGreen) center / cover no-repeat; }
${OE} .usersListWrapper .usersAwayList .userItem .avatarWrapper::after { background: var(--dc-oe-dotYellow) center / cover no-repeat; }
${OE} #l3Panel .l3St { box-shadow: none; background: var(--dc-oe-dotGreen) center / cover no-repeat; }
${OE} #l3Panel .l3St.away { background: var(--dc-oe-dotYellow) center / cover no-repeat; }
${OE} #l3Panel .l3St.dnd { background: var(--dc-oe-dotRed) center / cover no-repeat; }
/* your panel bottom-left and the message box on the menus' dark card and strip */
${OE} #l3Panel { background: none; box-shadow: none; border-image: var(--dc-oe-card) 28 fill / 12px / 0 stretch; border-radius: 4px; }
${OE} .chatInput input.input { background: var(--dc-oe-strip) 0 0 / 100% 100% no-repeat, rgba(0,0,0,.5); border: 0; border-radius: 3px; }
/* windows: the settings window keeps the concrete inside a grunge frame; pop-ups, toasts and menus are the frame itself */
${OE} #fcordModal .fcordWin { border-radius: 4px; border-image: var(--dc-oe-frame) 40 / 18px / 0 stretch; }
${OE} .fc-modal { border-radius: 4px; background: #121312; border-image: var(--dc-oe-frame) 40 fill / 18px / 0 stretch; }
${OE} .fc-toast, ${OE} .fc-pop { border-radius: 4px; background: #121312; box-shadow: 0 10px 30px rgba(0,0,0,.6); border-image: var(--dc-oe-card) 28 fill / 12px / 0 stretch; }
${OE} #hcCard, ${OE} #pcCard { border-radius: 4px; border-image: var(--dc-oe-card) 28 / 12px / 0 stretch; }
/* the settings window: the logo at the top of the menu, the pointer on the page you're on, the olive bar under the mouse */
${OE} #fcordModal .fcordSide::before { content: ''; display: block; height: 70px; margin: 16px 18px 0;
    background: var(--dc-oe-logo) center top / auto 48px no-repeat, var(--dc-oe-oe) center bottom / auto 18px no-repeat; }
${OE} #fcordModal .fcordSide .item { position: relative; }
${OE} #fcordModal .fcordSide .item.on .fc-ic { visibility: hidden; }
${OE} #fcordModal .fcordSide .item.on::before { content: ''; position: absolute; left: 9px; top: 50%; width: 15px; height: 18px; margin-top: -9px;
    pointer-events: none; background: var(--dc-oe-cursor) center / contain no-repeat; filter: brightness(0) opacity(.8); }
${OE} #fcordModal .fcordSide .item:not(.on):hover { background: var(--dc-oe-row) 0 0 / 100% 100% no-repeat, rgba(41,43,19,.8); }
/* section titles with a short yellow stroke under them, the chosen Look between two grunge corners */
${OE} .fc-set-title { padding-bottom: 8px; background: linear-gradient(#e2d51c, #e2d51c) left bottom / 44px 3px no-repeat; }
${OE} .dcLook { position: relative; }
${OE} .dcLook.on { box-shadow: inset 0 0 0 1px rgba(226,213,28,.5); }
${OE} .dcLook.on::before, ${OE} .dcLook.on::after { content: ''; position: absolute; width: 24px; height: 24px; pointer-events: none;
    background: var(--dc-oe-corner) center / contain no-repeat; }
${OE} .dcLook.on::before { top: -5px; right: -5px; }
${OE} .dcLook.on::after { bottom: -5px; left: -5px; transform: rotate(180deg); }
/* buttons: Accept / success on the green grunge bar, the quiet ones on the dark strip, switches on the yellow bar */
${OE} .fc-btn.success, ${OE} .chatContent .messageWrapper .accept-challenge { background: var(--dc-oe-green) 0 0 / 100% 100% no-repeat, #3f8f2c;
    color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.6); border-radius: 3px; }
${OE} .fc-btn.sec, ${OE} .chatContent .messageWrapper .decline-challenge, ${OE} .chatContent .messageWrapper .cancel-challenge {
    background: var(--dc-oe-strip) 0 0 / 100% 100% no-repeat, #232421; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); border-radius: 3px; }
${OE} .fc-btn.success:hover, ${OE} .fc-btn.sec:hover { filter: brightness(1.15); }
${OE} .fc-switch-in:checked + .fc-switch { background: ${OE_BAR}; }
/* waiting: the menus' grunge ring turning */
${OE} .fc-spin { border: 0; border-radius: 0; background: var(--dc-oe-ring) center / contain no-repeat; }

/* ---- Fightcord's own pages in the same kit: DMs + friends, lobbies, the game hub and the rest (3.11) ---- */
/* the page on the concrete (its own copy: a page is transformed, so the wall's fixed background can't show through) */
${OE} .fc-page { background: linear-gradient(rgba(6,7,6,.4), rgba(6,7,6,.72)), var(--dc-oe-concrete) center / cover no-repeat, #0b0c0b; }
${OE} .fc-page-h { background: var(--dc-oe-line) center / 100% 100% no-repeat, rgba(0,0,0,.5); border-bottom: 2px solid #e2d51c; }
${OE} .fc-page-h .tt { font-family: ${OE_DISPLAY}; font-weight: 400; font-synthesis: none; font-size: 20px; text-shadow: 0 2px 0 rgba(0,0,0,.6); }
/* lobbies and DMs: see-through columns like the main screen */
${OE} .fclbPage .fclbSide, ${OE} .fclbPage .fclbMem { background: rgba(0,0,0,.42); }
${OE} .fclbPage .fclbMain { background: rgba(8,9,8,.3); }
${OE} .fclbPage .fclbTop { background: rgba(0,0,0,.3); box-shadow: 0 1px 0 rgba(226,213,28,.35); }
${OE} .fclbPage .fclbBox { background: var(--dc-oe-strip) 0 0 / 100% 100% no-repeat, rgba(0,0,0,.5); border-radius: 3px; }
${OE} .fclbPage .fcdmFind { background: rgba(0,0,0,.5); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
/* what's picked: the yellow bar; what's under the mouse: the olive bar */
${OE} .fcdmNav.on, ${OE} .fcdmRow.on, ${OE} .fclbCh.on, ${OE} .ghTabBtn.on, ${OE} .fc-tab.on, ${OE} .fcmmSeg.on, ${OE} .fcmmFt.on {
    background: ${OE_BAR}; color: #141400; border-radius: 3px; text-shadow: none; }
${OE} .fcdmNav.on *, ${OE} .fcdmRow.on .tx b, ${OE} .fcdmRow.on .tx small, ${OE} .fclbCh.on *, ${OE} .ghTabBtn.on *, ${OE} .fc-tab.on * { color: #141400; }
${OE} .fcdmNav:not(.on):hover, ${OE} .fcdmRow:not(.on):hover, ${OE} .fclbCh:not(.on):hover, ${OE} .fclbM:hover, ${OE} .ghTabBtn:not(.on):hover, ${OE} .fcdmF:hover {
    background: var(--dc-oe-row) 0 0 / 100% 100% no-repeat, rgba(41,43,19,.8); border-radius: 3px; }
/* group names on the olive bar, like the member list's */
${OE} .fcdmCat, ${OE} .fclbCat, ${OE} .fclbMh, ${OE} .fcdmH { padding: 3px 10px 4px; border-radius: 2px; color: #eeede6; text-transform: none; letter-spacing: .01em;
    background: var(--dc-oe-row) 0 0 / 100% 100% no-repeat, rgba(41,43,19,.8); }
/* the lettering on the pages: titles, names, tabs and group names */
${OE} .fcdmCat, ${OE} .fclbCat, ${OE} .fclbMh, ${OE} .fcdmH, ${OE} .fcdmAct h3, ${OE} .fclbHd .nm, ${OE} .fclbTop .ti b, ${OE} .fclbHello h2,
${OE} .fclbG .hd b, ${OE} .fcdmRow .tx b, ${OE} .fcdmF .tx b, ${OE} .fclbM .tx b, ${OE} .fcdmNav > span, ${OE} .fclbCh > span, ${OE} .ghTabBtn, ${OE} .fc-tab,
${OE} .fc-ph .tt > b, ${OE} .fc-ch-name, ${OE} .fcfmName, ${OE} .fcdmQuiet > b, ${OE} .fcmmH b, ${OE} .fcmmOn b, ${OE} .fcmmVs b, ${OE} .fcmmSeg, ${OE} .fcmmFt {
    font-family: ${OE_DISPLAY}; font-weight: 400; font-synthesis: none; }
${OE} .fcdmCat, ${OE} .fclbCat, ${OE} .fclbMh, ${OE} .fcdmH { font-size: 15px; }
${OE} .fclbHd .nm, ${OE} .fclbTop .ti b, ${OE} .fcdmAct h3 { font-size: 19px; }
${OE} .fclbHello h2 { font-size: 34px; text-shadow: 0 3px 0 rgba(0,0,0,.55); }
${OE} .fclbG .hd b, ${OE} .fcdmRow .tx b, ${OE} .fcdmF .tx b, ${OE} .fclbM .tx b, ${OE} .fcdmNav > span, ${OE} .fclbCh > span, ${OE} .fcfmName { font-size: 16px; }
${OE} .fc-ph .tt > b, ${OE} .fc-ch-name { font-size: 19px; }
${OE} .fclbDay > span, ${OE} .fclbG .hd time, ${OE} .ghCols { font-family: 'FC OE Numbers', ${OE_DISPLAY}; }
/* text that sits on the concrete */
${OE} .fclbPage .fclbSide, ${OE} .fclbPage .fclbMem, ${OE} .fc-page-h, ${OE} .ghPage { text-shadow: 0 1px 0 rgba(0,0,0,.75); }
${OE} .fclbPage .fclbG .ln { color: #eeede6; }
/* everyone's status light: the game's own green / yellow / red lights inside the dark ring */
${OE} .fc-avatar > .st.on { background: var(--dc-oe-dotGreen) center / cover no-repeat, #3f8f2c; }
${OE} .fc-avatar > .st.away { background: var(--dc-oe-dotYellow) center / cover no-repeat, #e2d51c; }
${OE} .fc-avatar > .st.playing { background: var(--dc-oe-dotRed) center / cover no-repeat, #c8352a; }
/* profile cards: the card frame, the banner edged in yellow */
${OE} .fc-ch .fc-ch-banner { box-shadow: inset 0 -3px 0 #e2d51c; }
${OE} .fclbMem .fc-ch, ${OE} .fcdmProf { background: rgba(0,0,0,.35); }
/* the game hub: its table head on the olive bar */
${OE} .ghCols { background: var(--dc-oe-row) 0 0 / 100% 100% no-repeat, rgba(41,43,19,.8); border-radius: 2px; color: #eeede6; }
/* the main screen, a step closer to the game's menus: a bigger channel title, names a size up */
${OE} .channelToolbar .channelInfo .name.title, ${OE} .cbnName { font-size: 26px; text-shadow: 0 3px 0 rgba(0,0,0,.6); }
${OE} .chatContent .message.chat header .author { font-size: 16px; }

/* ---- motion, like the game's menus (all of it stops with Animations off: html.fc-still) ---- */
/* the yellow bar sweeps in from the left: under the mouse in the member list, on the page you open in settings */
${OE} .usersListWrapper .userItem { background: var(--dc-oe-bar) 0 0 / 0% 100% no-repeat; transition: background-size .16s cubic-bezier(.2,.8,.2,1); }
${OE} .usersListWrapper .userItem:hover { background: var(--dc-oe-bar) 0 0 / 100% 100% no-repeat; }
${OE} #fcordModal .fcordSide .item.on { background-color: transparent; animation: oeBarIn .24s cubic-bezier(.2,.8,.2,1) both; }
/* the pointers nudge, the way the game's cursor does */
/* (3.12 speed: a few nudges when it lands, not forever: an endless animation redraws the whole window every frame) */
${OE} .channelItemWrapper .channelItem.active::before, ${OE} #fcordModal .fcordSide .item.on::before { animation: oeNudge .9s ease-in-out 3; }
${OE} .usersListWrapper .userItem:hover::before { animation: oeNudge .9s ease-in-out infinite; }
/* a light glint runs over the logo now and then, and along the channel header's yellow edge */
${OE} #l3Title::after { content: ''; position: absolute; left: 10px; top: 3px; width: 54px; height: 26px; pointer-events: none;
    -webkit-mask: var(--dc-oe-logo) left center / auto 26px no-repeat;
    background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,.75) 50%, transparent 65%) 0 0 / 300% 100% no-repeat;
    animation: oeShine 7s ease-in-out 1.5s 2; }
${OE} .channelToolbar::after { content: ''; position: absolute; left: 0; right: 0; bottom: -2px; height: 2px; pointer-events: none;
    background: linear-gradient(90deg, transparent, #fffbd0, transparent) -200px 0 / 200px 2px no-repeat; animation: oeGlint 6s ease-in-out 2s 2; }
/* your main slides in, then breathes */
${OE}.dc-oe-hero body::before { will-change: transform; transform-origin: 80% 100%;
    animation: oeHeroIn .7s cubic-bezier(.2,.8,.2,1) both; }
/* a settings page's title wipes in; the chosen Look's corners pulse */
${OE} #fcordModal .fcordHead h2 { animation: oeWipe .32s cubic-bezier(.2,.8,.2,1) both; }
${OE} .dcLook.on::before { animation: oeCornerA 1.6s ease-in-out 3; }
${OE} .dcLook.on::after { animation: oeCornerB 1.6s ease-in-out 3; }
/* pop-ups land with a punch, toasts slide in, a challenge still waiting glows on Accept */
${OE} .fc-mask:not(.fc-out) > .fc-modal { animation: oeSlam .26s cubic-bezier(.2,.9,.3,1) both; }
${OE} .fc-toast:not(.out) { animation: oeToastIn .3s cubic-bezier(.2,.9,.3,1) both; }
/* (the glow fades a ready-made shadow in and out: opacity runs on the graphics card, an animated box-shadow repaints every frame) */
${OE} .chatContent .messageWrapper.dc-live .accept-challenge { position: relative; }
${OE} .chatContent .messageWrapper.dc-live .accept-challenge::after { content: ''; position: absolute; left: 0; top: 0; right: 0; bottom: 0; border-radius: 3px;
    pointer-events: none; box-shadow: 0 0 14px rgba(120,220,60,.75); animation: oeGlow 1.2s ease-in-out infinite alternate; }
/* Animations off: the rules above are more specific than the core's html.fc-still, so they get their own stop (two :not(#id) outrank any of them) */
${OE}.fc-still:not(#oe-a):not(#oe-b) *, ${OE}.fc-still:not(#oe-a):not(#oe-b) *::before, ${OE}.fc-still:not(#oe-a):not(#oe-b) *::after { animation: none; transition: none; }
`;
// (written as they are: important() would put !important inside @keyframes, where it isn't allowed)
const OE_KEYFRAMES = `
@keyframes oeBarIn { from { background-size: 0% 100%; } to { background-size: 100% 100%; } }
@keyframes oeNudge { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
@keyframes oeShine { 0% { background-position: 100% 0; } 22%, 100% { background-position: 0% 0; } }
@keyframes oeGlint { 0% { background-position: -200px 0; } 40%, 100% { background-position: calc(100% + 200px) 0; } }
@keyframes oeHeroIn { from { opacity: 0; transform: translateX(60px); } to { opacity: .2; transform: none; } }
@keyframes oeWipe { from { clip-path: inset(0 100% 0 0); transform: translateX(-14px); } to { clip-path: inset(0 0 0 0); transform: none; } }
@keyframes oeCornerA { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(2px, -2px); } }
@keyframes oeCornerB { 0%, 100% { transform: rotate(180deg) translate(0, 0); } 50% { transform: rotate(180deg) translate(2px, -2px); } }
@keyframes oeSlam { from { opacity: 0; transform: scale(1.07); filter: brightness(1.8); } 60% { opacity: 1; filter: brightness(1.15); } to { opacity: 1; transform: none; filter: none; } }
@keyframes oeToastIn { from { opacity: 0; transform: translateX(40px); clip-path: inset(0 0 0 100%); } to { opacity: 1; transform: none; clip-path: inset(0 0 0 0); } }
@keyframes oeGlow { from { opacity: 0; } to { opacity: 1; } }
`;

// Every declaration gets !important (see the note above COLORS). Only touches "prop: value;"
// pairs, so selectors and at-rules are left as written.
function important(css) {
    return css.replace(/:\s*([^;{}]+?)\s*;/g, (m, v) => /!important$/.test(v) ? m : ': ' + v + ' !important;');
}

// the settings block's theme editor
const EDITOR_CSS = `
/* Looks (2.11): the cards */
.dcLooksHead { align-items: center; }
.dcKeep { display: inline-flex; align-items: center; font-size: var(--fc-fs-ui); color: var(--fc-muted); cursor: pointer; }
.dcKeep input { margin: 0 6px 0 0; }
.dcLooks { display: flex; flex-wrap: wrap; margin: 4px -5px 14px; }
.dcLook { width: calc(20% - 10px); min-width: 104px; margin: 5px; padding: 6px 6px 8px; border-radius: 10px; box-sizing: border-box; cursor: pointer;
    background: var(--fc-s2, rgba(255,255,255,.04)); box-shadow: inset 0 0 0 1px var(--fc-tint-2); transition: box-shadow var(--fc-fast), transform var(--fc-fast); }
.dcLook:hover { transform: translateY(-2px); }
.dcLook.on { box-shadow: inset 0 0 0 2px var(--fc-accent), 0 0 14px rgba(88,101,242,.25); }
.dcLook .pv { position: relative; height: 70px; border-radius: 7px; overflow: hidden; }
.dcLook .pv > i { position: absolute; left: 0; top: 0; bottom: 0; width: 18px; }
.dcLook .pv .msg { position: absolute; left: 26px; right: 6px; top: 16px; display: flex; align-items: flex-start; }
.dcLook .pv .av { flex: none; width: 22px; height: 22px; margin-right: 7px; border-radius: 50%; }
.dcLook .pv .msg > div { min-width: 0; }
.dcLook .pv .msg b { display: block; font-size: var(--fc-fs-sm); line-height: 14px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.dcLook .pv .msg span { display: block; font-size: var(--fc-fs-sm); line-height: 15px; color: rgba(255,255,255,.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dcLook .pv.dcLook-crt::after { content: ''; position: absolute; left: 0; top: 0; right: 0; bottom: 0; pointer-events: none;
    background: repeating-linear-gradient(0deg, var(--fc-scrim-2) 0 1px, transparent 1px 3px); }
.dcLook > b { display: block; margin-top: 7px; font-size: var(--fc-fs-ui); color: var(--fc-head); }
.dcLook > small { display: block; margin-top: 1px; font-size: var(--fc-fs-sm); line-height: 1.3; color: var(--fc-muted); }
@media (max-width: 1100px) { .dcLook { width: calc(33.333% - 10px); } }
/* Arcade CRT: faint scanlines over the whole window and a soft phosphor glow on text */
html.dc-theme.dc-preset-crt body::after { content: ''; position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 2147483600; pointer-events: none;
    background: repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 1px, transparent 1px 3px); }
html.dc-theme.dc-preset-crt .chatContent .message.chat .line { text-shadow: 0 0 6px rgba(120,255,140,.18); }
.dcSwatches { display: flex; align-items: center; }
.dcSwatch { flex: none; width: 20px; height: 20px; margin-left: 6px; border-radius: 50%; cursor: pointer; }
.dcSwatch.on { box-shadow: 0 0 0 2px var(--fc-s2), 0 0 0 4px var(--fc-head); }
.dcSwatches .fc-color { margin-left: 10px; height: 28px; width: 40px; }
.dcColors { display: flex; }
.dcColors label { display: flex; flex-direction: column; align-items: center; margin-left: 12px; font-size: var(--fc-fs-xs); color: var(--fc-muted); cursor: pointer; }
.dcColors .fc-color { height: 30px; margin-bottom: 2px; }
.dcCode { width: 220px; margin-right: 8px; height: 30px; font-size: var(--fc-fs-sm); }
.dcBlock .fc-field > .fc-btn + .fc-btn { margin-left: 8px; }
.dcEdMsg { min-height: 16px; margin-top: 6px; font-size: var(--fc-fs-sm); color: var(--fc-success); }
.dcEdMsg.bad { color: var(--fc-danger); }
`;

/* ----------------------------------------------------------------- apply */

// The anchors the layout layer is written against. If a Fightcade update drops any of them,
// fall back to colours only rather than half-moving a layout we no longer recognise.
const ANCHORS = ['.mainToolbarWrapper .mainToolbar', '.channelsList', '.buttonBar'];
const layoutSafe = () => ANCHORS.every(s => document.querySelector(s));

// The theme editor: 4 picked colours -> the whole --dc-* palette (set inline, so they win
// over the preset rules); font and chat background work with any preset.
const CUSTOM_VARS = ['--dc-bg', '--dc-bg2', '--dc-bg3', '--dc-input', '--dc-input-edge', '--dc-hover', '--dc-select', '--dc-active',
    '--dc-float', '--dc-divider', '--dc-text', '--dc-head', '--dc-muted', '--dc-faint', '--dc-icon', '--dc-btn', '--dc-btn-h'];
let customSig = '';
let bgUrl = '';                  // the background picture, read from its file once

function customPalette(c) {
    const bg = c.bg, text = c.text;
    return {
        '--dc-bg': bg, '--dc-bg2': c.panel, '--dc-bg3': c.dark,
        '--dc-input': mixHex(bg, text, 0.07), '--dc-input-edge': mixHex(bg, text, 0.1),
        '--dc-hover': mixHex(bg, text, 0.04), '--dc-select': mixHex(bg, text, 0.1), '--dc-active': mixHex(bg, text, 0.13),
        '--dc-float': mixHex(c.dark, '#000000', 0.35), '--dc-divider': mixHex(bg, text, 0.1),
        '--dc-text': text, '--dc-head': mixHex(text, '#ffffff', 0.6), '--dc-muted': mixHex(text, bg, 0.45),
        '--dc-faint': mixHex(text, bg, 0.6), '--dc-icon': mixHex(text, bg, 0.3),
        '--dc-btn': mixHex(bg, text, 0.12), '--dc-btn-h': mixHex(bg, text, 0.2)
    };
}

function applyCustom(html, on) {
    const c = config.custom || {};
    const custom = on && config.preset === 'custom' && ['bg', 'panel', 'dark', 'text'].every(k => hexRgb(c[k]));
    const sig = [custom, JSON.stringify(c), on && config.font, on && bgUrl ? bgUrl.length + ':' + bgUrl.slice(-24) : '', config.bgDim].join('|');
    if (sig === customSig) return;
    customSig = sig;
    if (custom) Object.keys(customPalette(c)).forEach(k => html.style.setProperty(k, customPalette(c)[k], 'important'));
    else CUSTOM_VARS.forEach(k => html.style.removeProperty(k));
    if (on && config.font) html.style.setProperty('--dc-font', config.font + ', \'Noto Sans\', sans-serif', 'important');
    else html.style.removeProperty('--dc-font');
    const gf = on && GFONTS[config.font];
    let gl = document.getElementById('dcThemeFontPick');
    if (gf) {
        if (!gl) { gl = document.createElement('link'); gl.id = 'dcThemeFontPick'; gl.rel = 'stylesheet'; document.head.appendChild(gl); }
        const href = 'https://fonts.googleapis.com/css2?family=' + gf + '&display=swap';
        if (gl.getAttribute('href') !== href) gl.setAttribute('href', href);
    } else if (gl) gl.remove();
    const bg = on && bgUrl;
    html.classList.toggle('dc-has-bg', !!bg);
    if (bg) {
        html.style.setProperty('--dc-chat-bg', 'url("' + bgUrl + '")');
        html.style.setProperty('--dc-bg-dim', 'rgba(0,0,0,' + Math.min(0.95, Math.max(0, +config.bgDim || 0)) + ')');
    } else { html.style.removeProperty('--dc-chat-bg'); html.style.removeProperty('--dc-bg-dim'); }
}

// the picture lives in its own file (the config stays small): read it as a data URL
function loadBackground() {
    bgUrl = '';
    if (!config.bgFile) return;
    try {
        const buf = fs.readFileSync(fc.files.path(config.bgFile));
        const ext = (config.bgFile.match(/\.(\w+)$/) || [])[1] || 'png';
        bgUrl = 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + buf.toString('base64');
    } catch (e) { fc.log.warn('background picture missing', config.bgFile); }
}

function saveBackground(dataUrl) {
    const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(dataUrl || '');
    if (!m) return false;
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    // one picture at a time
    fc.files.list('', /^theme-background\./).forEach(f => { try { fs.unlinkSync(fc.files.path(f)); } catch (e) { /* gone */ } });
    const name = 'theme-background.' + ext;
    fs.writeFileSync(fc.files.path(name), Buffer.from(m[2], 'base64'));
    config.bgFile = name;
    return true;
}

// share a theme as text: FCTHEME:<base64 json> (without the background picture)
function exportCode() {
    const t = { v: 1, preset: config.preset, accent: config.accent, font: config.font, custom: config.custom, bgDim: config.bgDim };
    return 'FCTHEME:' + btoa(unescape(encodeURIComponent(JSON.stringify(t))));
}

function importCode(code) {
    const m = String(code || '').trim().match(/^FCTHEME:([A-Za-z0-9+/=]+)$/);
    if (!m) return T('That isn’t a Fightcord theme code (it starts with FCTHEME:).');
    let t;
    try { t = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { return T('That theme code is damaged.'); }
    if (!t || !PRESETS[t.preset] || !hexRgb(t.accent)) return T('That theme code is damaged.');
    if (t.custom && !['bg', 'panel', 'dark', 'text'].every(k => hexRgb(t.custom[k]))) return T('That theme code has bad colours.');
    config.preset = t.preset;
    config.accent = t.accent.toLowerCase();
    config.font = FONTS[t.font] !== undefined ? t.font : '';
    if (t.custom) config.custom = { bg: t.custom.bg, panel: t.custom.panel, dark: t.custom.dark, text: t.custom.text };
    if (typeof t.bgDim === 'number') config.bgDim = Math.min(0.95, Math.max(0, t.bgDim));
    store.save();
    refresh();
    return '';
}

// 3.11: the Online Edition Look's pieces from own-art.js (undefined = not asked yet, null = none)
let own;
let ownFonts = null;                 // the FontFaces added for it
function ownTheme() {
    if (own !== undefined) return own;
    const oa = fc.modules.get('own-art');
    if (!oa || !oa.theme) return null;   // (not started yet: asked again later)
    own = oa.theme() || null;
    return own;
}
// a Look is offered when it needs nothing, its files are there, or it's the one you have on
const offered = (k) => !LOOKS[k].own || !!ownTheme() || config.preset === LOOKS[k].preset;
function dropOwnFonts() {
    if (ownFonts) ownFonts.forEach(f => { try { document.fonts.delete(f); } catch (e) { /* gone */ } });
    ownFonts = null;
}
function applyOwn(html, on) {
    const t = on && config.preset === 'oe' ? ownTheme() : null;
    html.classList.toggle('dc-oe-own', !!t);
    if (!t) dropOwnFonts();
    else if (!ownFonts && typeof FontFace === 'function' && document.fonts) {
        ownFonts = [['FC OE District', t.font], ['FC OE Numbers', t.num]].filter(f => f[1]).map(([family, buf]) => {
            const face = new FontFace(family, new Uint8Array(buf), { display: 'block' });
            document.fonts.add(face);
            face.load().catch(e => fc.log.warn('Online Edition font', family, e && e.message));
            return face;
        });
    }
    oeWall(!!t);
    const hero = t ? ownHero() : '';
    html.classList.toggle('dc-oe-hero', !!hero);
    // every picture as --dc-oe-<key> (none when this copy doesn't have it)
    const pics = Object.assign({}, t || {}, { hero });
    delete pics.font; delete pics.num;
    OE_PICS.concat(Object.keys(pics)).filter((k, i, a) => a.indexOf(k) === i).forEach(k => {
        const val = pics[k] ? 'url("' + pics[k] + '")' : 'none';
        if (html.style.getPropertyValue('--dc-oe-' + k) !== val) html.style.setProperty('--dc-oe-' + k, val);
    });
}
// the wall behind everything (3.12): one element, so it gets its own layer and is painted once
function oeWall(on) {
    let w = document.getElementById('dcOeWall');
    if (!on) { if (w) w.remove(); return; }
    if (w || !document.body) return;
    w = document.createElement('div');
    w.id = 'dcOeWall';
    w.setAttribute('aria-hidden', 'true');
    w.appendChild(document.createElement('i'));
    document.body.insertBefore(w, document.body.firstChild);
}
// the pictures the CSS uses (so a missing one is 'none', never an unset var)
const OE_PICS = ['concrete', 'hero', 'bar', 'row', 'frame', 'ring', 'logo', 'oe', 'strip', 'line', 'panel', 'card', 'cursor', 'corner', 'brush', 'green',
    'dotRed', 'dotOrange', 'dotYellow', 'dotGreen', 'tag1', 'tag2', 'tag3', 'scan'];
// your main's HD art (own-art.js) behind a 3rd Strike channel, like the game's main menu; '' = none.
// Looked up again when the channel changes, or every half minute (a new main from your sets)
let heroKey = '', heroUrl = '';
function ownHero() {
    const rom = fc.app.activeGameId() || '', me = fc.app.me() || '';
    const k = rom + '|' + me + '|' + Math.floor(Date.now() / 30000);
    if (k === heroKey) return heroUrl;
    heroKey = k;
    const oa = fc.modules.get('own-art'), nt = fc.modules.get('notes');
    const m = rom && me && nt && nt.mains ? nt.mains(me, rom) : null;
    heroUrl = (m && m.chars && m.chars[0] && oa && oa.full ? oa.full(rom, m.chars[0]) : '') || '';
    return heroUrl;
}
function ownChanged() { own = undefined; heroKey = ''; dropOwnFonts(); refresh(); }

let lastSafe = null;
function applyClasses() {
    const html = document.documentElement;
    const on = !!config.enabled;
    const safe = on && layoutSafe();
    html.classList.toggle('dc-theme', on);
    html.classList.toggle('dc-layout', safe);
    html.classList.toggle('dc-chat-art', on && !!config.chatArt);
    html.classList.toggle('dc-clean-names', on && !!config.cleanNames);
    Object.keys(PRESETS).forEach(p => html.classList.toggle('dc-preset-' + p, on && config.preset === p));
    const rgb = hexRgb(config.accent) || [88, 101, 242];
    const hex = '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
    const dark = '#' + rgb.map(v => Math.round(v * 0.8).toString(16).padStart(2, '0')).join('');
    if (html.style.getPropertyValue('--dc-blurple') !== hex) {
        html.style.setProperty('--dc-blurple', hex, 'important');
        html.style.setProperty('--dc-blurple-h', dark, 'important');
        html.style.setProperty('--dc-accent-soft', 'rgba(' + rgb.join(',') + ',.3)', 'important');
        html.style.setProperty('--dc-on-accent', onAccent(rgb), 'important');
    }
    applyCustom(html, on);
    applyOwn(html, on);
    const size =Math.min(24, Math.max(12, +config.chatSize || 18)) + 'px';
    if (html.style.getPropertyValue('--dc-chat') !== size) html.style.setProperty('--dc-chat', size);
    if (on && safe !== lastSafe && document.querySelector('#app')) {
        fc.log(safe ? 'layout layer on' : 'SAFE MODE: layout anchors missing, colours only');
        lastSafe = safe;
    }
}

function ensureStyle() {
    fc.ui.style('dcThemeStyle', important(COLORS) + important(LAYOUT) + RAW + important(OE_CSS) + OE_KEYFRAMES + EDITOR_CSS);
    if (config.enabled && !document.getElementById('dcThemeFont')) {
        const l = document.createElement('link');
        l.id = 'dcThemeFont';
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&display=swap';
        document.head.appendChild(l);
    }
}

/* ------------------------------------------------------------ rail icons */

function initials(name) {
    const words = name.replace(/\s*[\(\[].*$/, '').replace(/[:\-–]/g, ' ').split(/\s+/).filter(Boolean);
    let s = words.map(w => /^\d/.test(w) ? w.match(/^\d+/)[0] : w[0]).join('');
    if (s.length > 5) s = s.slice(0, 5);
    return s || '?';
}

// Channel full name -> rom name, read off each channel's own header (".name[title='Rom name']").
function romByChannelName() {
    const map = {};
    document.querySelectorAll('.channelWrapper .channelInfo').forEach(info => {
        const title = info.querySelector('.name.title');
        const rom = info.querySelector('.name[title="Rom name"]');
        const full = title && (title.getAttribute('title') || title.textContent.replace(/^#/, '')).trim();
        if (full && rom) map[full] = rom.textContent.trim();
    });
    return map;
}

const artState = {};   // rom -> 'loading' | 'ok' | 'fail'

function decorateRail() {
    const roms = config.gameIcons ? romByChannelName() : {};
    document.querySelectorAll('.channelItemWrapper .channelItem').forEach(item => {
        const full = (item.getAttribute('title') || '').trim();
        if (!full) return;
        const short = full.replace(/\s*\([^)]*\)\s*$/, '');
        if (item.dataset.dcName !== short) item.dataset.dcName = short;
        const nameEl = item.querySelector('.channelItemName');
        const ini = initials(full);
        if (nameEl && nameEl.dataset.dcInitials !== ini) nameEl.dataset.dcInitials = ini;
        const rom = roms[full];
        if (!config.gameIcons || !rom) {
            if (item.classList.contains('dc-art')) { item.classList.remove('dc-art'); item.style.removeProperty('background-image'); }
            return;
        }
        const url = fc.data.artUrl(rom, FC_ORIGIN);
        if (artState[rom] === 'ok') {
            if (!item.classList.contains('dc-art')) {
                item.style.setProperty('background-image', 'url("' + url + '")', 'important');
                item.classList.add('dc-art');
            }
        } else if (!artState[rom]) {
            // only switch to artwork once it has actually loaded
            artState[rom] = 'loading';
            const img = new Image();
            img.onload = () => { artState[rom] = 'ok'; decorateRail(); };
            img.onerror = () => { artState[rom] = 'fail'; };
            img.src = url;
        }
    });
}

// Challenges that still wait for an answer carry buttons; resolved ones keep the same class
// but lose them. :has() isn't in Chromium 80, so tag them here.
const LIVE_SEL = '.accept-challenge, .decline-challenge, .cancel-challenge, .rank-option';
function markLiveChallenges() {
    document.querySelectorAll('.chatContent .messageWrapper:not(.chat):not(.motd)').forEach(w => {
        const live = !!w.querySelector(LIVE_SEL);
        if (w.classList.contains('dc-live') !== live) w.classList.toggle('dc-live', live);
    });
}

function clearRail() {
    document.querySelectorAll('.channelItemWrapper .channelItem.dc-art').forEach(item => {
        item.classList.remove('dc-art');
        item.style.removeProperty('background-image');
    });
}

/* ------------------------------------------------------------- controls */

function setOption(key, value, msg) {
    config[key] = value;
    store.save();
    refresh();
    if (msg) fc.ui.toast(msg, { icon: 'palette', ms: 2500 });
}

function refresh() {
    ensureStyle();
    applyClasses();
    if (config.enabled) { decorateRail(); markLiveChallenges(); } else clearRail();
    fc.settings.refresh('discord-theme');
}

function onKeyDown(e) {
    if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        e.stopPropagation();
        setOption('enabled', !config.enabled, T(!config.enabled ? 'Discord theme on' : 'Discord theme off'));
    }
}

function onThemeCmd(arg) {
    const m = String(arg || '').match(/^(\w*)\s*(\S*)$/);
    const a = (m ? m[1] : '').toLowerCase(), v = m ? m[2] : '';
    if (a === 'on' || a === 'off') setOption('enabled', a === 'on', T(a === 'on' ? 'Discord theme on' : 'Discord theme off'));
    else if (a === 'art') setOption('chatArt', !config.chatArt, T(!config.chatArt ? 'Game artwork behind chat on' : 'Game artwork behind chat off'));
    else if (a === 'icons') setOption('gameIcons', !config.gameIcons, T(!config.gameIcons ? 'Game artwork icons on' : 'Game artwork icons off'));
    else if (a === 'names') setOption('cleanNames', !config.cleanNames, T(!config.cleanNames ? 'Cleaner name line on' : 'Cleaner name line off'));
    else if (a === 'size' && /^\d+$/.test(v)) { const px = Math.min(24, Math.max(12, +v)); setOption('chatSize', px, T('Chat text size {n}px', { n: px })); }
    else if (a === 'preset' && PRESETS[v.toLowerCase()]) setOption('preset', v.toLowerCase(), T('Theme: {name}', { name: T(PRESETS[v.toLowerCase()]) }));
    else if (a === 'accent' && (hexRgb(v) || SWATCHES[v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()])) {
        const hex = hexRgb(v) ? '#' + v.replace(/^#/, '').toLowerCase() : SWATCHES[v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()];
        setOption('accent', hex, T('Accent colour {hex}', { hex }));
    } else fc.ui.toast(T(config.enabled ? 'Discord theme on' : 'Discord theme off') + (document.documentElement.classList.contains('dc-layout') ? '' : ' ' + T('(safe mode: colours only)')), {
        icon: 'palette', ms: 9000, sub: '/theme on|off · art · icons · names · size 18 · preset amoled · accent pink · Ctrl+Shift+T' });
}

/* ------------------------------------------------------------- settings */

function blockHtml() {
    const sw = (key, label, hint) => `<label class="fc-field"><span class="fc-field-text"><b>${E(T(label))}</b>${hint ? `<small>${E(T(hint))}</small>` : ''}</span>` +
        `<input type="checkbox" class="fc-switch-in" data-opt="${key}"${config[key] ? ' checked' : ''}><i class="fc-switch"></i></label>`;
    const sel = (key, label, opts, hint) => `<div class="fc-field"><span class="fc-field-text"><b>${E(T(label))}</b>${hint ? `<small>${E(T(hint))}</small>` : ''}</span>` +
        `<select class="fc-select" data-opt="${key}">${opts.map(([v, l]) => `<option value="${E(v)}"${String(v) === String(config[key]) ? ' selected' : ''}>${E(T(l))}</option>`).join('')}</select></div>`;
    const c = config.custom || {};
    return `<div class="fc-set-title">${E(T('Discord theme'))} <small>— ${E(T('only you see it'))} · Ctrl+Shift+T</small></div>
        ${sw('enabled', 'Discord theme')}
        <div class="dcRest"${config.enabled ? '' : ' hidden'}>
        <div class="fc-field dcLooksHead"><span class="fc-field-text"><b>${E(T('Looks'))}</b><small>${E(T('A whole look in one click'))}</small></span>
            <label class="dcKeep"><input type="checkbox" class="dcKeepIn"${lookAll ? ' checked' : ''}><span>${E(T('Also set the background and emulator font'))}</span></label></div>
        <div class="dcLooks">${Object.keys(LOOKS).filter(offered).map(k => lookCard(k)).join('')}</div>
        ${sel('preset', 'Theme', Object.keys(PRESETS).filter(k => !LOOKS[k] || offered(k)).map(k => [k, PRESETS[k]]))}
        <div class="fc-field"><span class="fc-field-text"><b>${E(T('Accent colour'))}</b></span><span class="dcSwatches">
            ${Object.keys(SWATCHES).map(n => `<span class="dcSwatch${SWATCHES[n] === config.accent ? ' on' : ''}" data-hex="${SWATCHES[n]}" title="${E(T(n))}" style="background:${SWATCHES[n]}"></span>`).join('')}
            <input type="color" class="fc-input fc-color" data-opt="accent" value="${E(config.accent)}" title="${E(T('Pick any colour'))}"></span></div>
        ${sel('chatSize', 'Chat text size', [12, 13, 14, 15, 16, 17, 18, 20, 22].map(n => [n, n + 'px']), N_('Discord’s default is 16'))}
        ${sw('gameIcons', 'Game artwork icons', 'In the left rail')}
        ${sw('chatArt', 'Artwork behind chat', 'Fightcade’s game picture, faded')}
        ${sw('cleanNames', 'Cleaner name line', 'Hide the 🔍 scout badge next to names')}
        <div class="fc-set-title" style="margin-top:16px">${E(T('Theme editor'))} <small>— ${E(T('pick colours to make your own (switches to Custom)'))}</small></div>
        <div class="fc-field"><span class="fc-field-text"><b>${E(T('Colours'))}</b></span><span class="dcColors">${[['bg', N_('Background')], ['panel', N_('Panels')], ['dark', N_('Darkest')], ['text', N_('Text')]].map(([k, l]) =>
            `<label><input type="color" class="fc-input fc-color" data-c="${k}" value="${E(c[k] || '#000000')}"><span>${E(T(l))}</span></label>`).join('')}</span></div>
        ${sel('font', 'Font', Object.keys(FONTS).map(k => [k, FONTS[k]]))}
        <div class="fc-field"><span class="fc-field-text"><b>${E(T('Chat background'))}</b><small>${E(T(config.bgFile ? 'A picture is set' : 'Any picture up to 3 MB'))}</small></span>
            ${fc.ui.btn('Choose picture…', { kind: 'sec', size: 'sm', act: 'pick' })}${config.bgFile ? fc.ui.btn('Remove', { kind: 'ghost', size: 'sm', act: 'nopic' }) : ''}
            <input type="file" class="dcFile" accept="image/*" style="display:none"></div>
        <div class="fc-field"${config.bgFile ? '' : ' hidden'}><span class="fc-field-text"><b>${E(T('Darken picture'))}</b></span>
            <input type="range" class="fc-slider" data-dim="1" min="0" max="90" value="${Math.round((+config.bgDim || 0) * 100)}"><span class="fc-slider-v">${Math.round((+config.bgDim || 0) * 100)}%</span></div>
        <div class="fc-field"><span class="fc-field-text"><b>${E(T('Share'))}</b><small>${E(T('A theme code for friends (without the picture)'))}</small></span>
            <input type="text" class="fc-input dcCode" placeholder="${E(T('Paste a FCTHEME: code'))}">${fc.ui.btn('Import', { kind: 'sec', size: 'sm', act: 'import' })}${fc.ui.btn('Copy mine', { size: 'sm', icon: 'copy', act: 'export' })}</div>
        <div class="dcEdMsg"></div>
        </div>`;
}

// a Look's card: its colours, a sample message in its font, its name
let lookAll = true;
function lookCard(k) {
    const L = LOOKS[k];
    const on = config.preset === L.preset && config.accent === L.accent && config.font === L.font;
    const font = (L.font || "'gg sans', 'Noto Sans', sans-serif").replace(/"/g, '&quot;');
    return `<div class="dcLook${on ? ' on' : ''}" data-look="${k}" title="${E(T(L.desc))}">
        <div class="pv dcLook-${k}" style="background:${L.sw[1]};font-family:${font}"><i style="background:${L.sw[0]}"></i>
            <div class="msg"><span class="av" style="background:${L.accent}"></span><div><b style="color:${L.accent}">TurtleTime</b><span>${E(T('gg, one more?'))}</span></div></div></div>
        <b>${E(T(L.name))}</b><small>${E(T(L.desc))}</small></div>`;
}

// apply a Look: the theme, then (unless kept) the background and the emulator font
function applyLook(k, all) {
    const L = LOOKS[k];
    if (!L) return;
    config.enabled = true;
    config.preset = L.preset;
    config.accent = L.accent;
    config.font = L.font;
    store.save();
    refresh();
    if (all !== false) {
        const bg = fc.modules.get('backgrounds');
        if (bg && bg.setLook) bg.setLook(L.bg);
        const es = fc.modules.get('emu-skin');
        if (es && es.setFont) es.setFont(L.emuFont);
    }
    fc.log('look applied:', k, all !== false ? '(with background + emulator font)' : '');
}

function render(el) { el.classList.add('dcBlock'); el.innerHTML = blockHtml(); }

function wire(el) {
    render(el);
    const msg = (t, bad) => { const m = el.querySelector('.dcEdMsg'); if (m) { m.textContent = t; m.classList.toggle('bad', !!bad); } };
    el.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.opt) {
            const k = t.dataset.opt;
            const v = t.type === 'checkbox' ? t.checked : k === 'chatSize' ? +t.value : k === 'accent' ? t.value.toLowerCase() : t.value;
            setOption(k, v);
        } else if (t.classList.contains('dcKeepIn')) { lookAll = t.checked; }
        else if (t.dataset.c) { store.save(); refresh(); }
        else if (t.dataset.dim) store.save();
        else if (t.classList.contains('dcFile')) {
            const f = t.files && t.files[0];
            if (!f) return;
            if (f.size > 3 * 1024 * 1024) { msg(T('That picture is over 3 MB — pick a smaller one.'), true); return; }
            const rd = new FileReader();
            rd.onload = () => {
                try { if (!saveBackground(String(rd.result))) throw new Error('not a picture'); loadBackground(); store.save(); refresh(); msg(T('Background set.')); }
                catch (err) { msg(T('Couldn’t use that picture ({error}).', { error: err.message }), true); }
            };
            rd.onerror = () => msg(T('Couldn’t read that picture.'), true);
            rd.readAsDataURL(f);
        }
    });
    el.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.c) {                     // live preview while dragging
            config.custom = Object.assign({}, config.custom, { [t.dataset.c]: t.value.toLowerCase() });
            config.preset = 'custom';
            applyClasses();
        } else if (t.dataset.dim) {
            config.bgDim = +t.value / 100;
            const out = t.parentNode.querySelector('.fc-slider-v');
            if (out) out.textContent = t.value + '%';
            applyClasses();
        }
    });
    el.addEventListener('keydown', (e) => { if (e.target.classList.contains('dcCode')) e.stopPropagation(); }, true);
    el.addEventListener('click', (e) => {
        const s = e.target.closest('.dcSwatch');
        if (s) { setOption('accent', s.dataset.hex); return; }
        const lk = e.target.closest('[data-look]');
        if (lk) { applyLook(lk.dataset.look, lookAll); return; }
        const a = e.target.closest('[data-act]');
        const act = a && a.getAttribute('data-act');
        if (act === 'pick') el.querySelector('.dcFile').click();
        else if (act === 'nopic') {
            fc.files.list('', /^theme-background\./).forEach(f => { try { fs.unlinkSync(fc.files.path(f)); } catch (err) { /* gone */ } });
            config.bgFile = '';
            bgUrl = '';
            store.save();
            refresh();
            msg(T('Background removed.'));
        } else if (act === 'export') {
            const code = exportCode();
            el.querySelector('.dcCode').value = code;
            msg(T(fc.ui.copy(code) ? 'Theme code copied — send it to a friend.' : 'Copy the code from the box.'));
        } else if (act === 'import') {
            const err = importCode(el.querySelector('.dcCode').value);
            msg(err || T('Theme imported.'), !!err);
        }
    });
}

/* ---------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('discord-theme', DEFAULTS, {
        version: 2,
        // v1 kept the background picture inside the JSON (up to 3 MB): move it to a file
        migrate: (d) => {
            if (d.bgImage) {
                try {
                    const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(d.bgImage);
                    if (m) {
                        const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
                        fs.writeFileSync(path.join(__dirname, 'theme-background.' + ext), Buffer.from(m[2], 'base64'));
                        d.bgFile = 'theme-background.' + ext;
                    }
                } catch (e) { /* keep going without it */ }
                delete d.bgImage;
            }
            return d;
        }
    });
    config = store.data;
    if (config.bgImage) delete config.bgImage;
    store.saveNow();                         // writes the migrated (small) config right away
    window.__fcDiscordThemeLoaded = true;
    loadBackground();
    window.addEventListener('keydown', onKeyDown, true);
    fc.own(() => {
        window.removeEventListener('keydown', onKeyDown, true);
        fc.ui.style('dcThemeStyle', null);
        const html = document.documentElement;
        ['dc-theme', 'dc-layout', 'dc-chat-art', 'dc-clean-names', 'dc-has-bg', 'dc-oe-own', 'dc-oe-hero'].concat(Object.keys(PRESETS).map(p => 'dc-preset-' + p)).forEach(c => html.classList.remove(c));
        oeWall(false);
        OE_PICS.forEach(k => html.style.removeProperty('--dc-oe-' + k));
        dropOwnFonts();
        const gl = document.getElementById('dcThemeFontPick'); if (gl) gl.remove();
        clearRail();
        window.__fcDiscordThemeLoaded = false;
    });
    // the Online Edition Look's files: read (again) or removed, and own-art.js started after this
    fc.on('own-art:changed', ownChanged);
    fc.on('modules:started', () => { if (own === undefined || own === null) ownChanged(); });
    refresh();
    fc.watch(() => { applyClasses(); if (config.enabled) { decorateRail(); markLiveChallenges(); } });
    fc.cmd('theme', 'Discord theme: on / off / preset / accent / size', onThemeCmd, { args: 'on|off|art|icons|names|size N|preset X|accent X' });
    fc.settings.block({ id: 'discord-theme', section: 'appearance', order: 1, render: wire, refresh: render });
    fc.log('ready -', config.enabled ? 'on' : 'off');
    return api;
}

const api = {
    // for the welcome screen
    presets: () => Object.assign({}, PRESETS),
    looks: () => Object.keys(LOOKS).filter(offered).reduce((o, k) => { o[k] = LOOKS[k]; return o; }, {}),
    applyLook: (k, all) => applyLook(k, all),
    swatches: () => Object.assign({}, SWATCHES),
    theme: () => ({ enabled: config.enabled, preset: config.preset, accent: config.accent, font: config.font }),
    setTheme(t) {
        if (t.preset && PRESETS[t.preset]) config.preset = t.preset;
        if (t.accent && hexRgb(t.accent)) config.accent = String(t.accent).toLowerCase();
        if (t.enabled != null) config.enabled = !!t.enabled;
        store.save();
        refresh();
    },
    // 3.11: a picture as the chat background (own-art.js's concept art): a data: URL -> true when set
    setPicture(dataUrl) {
        if (!saveBackground(dataUrl)) return false;
        loadBackground();
        store.save();
        refresh();
        return true;
    },
    _css: () => important(COLORS) + important(LAYOUT) + RAW + important(OE_CSS) + OE_KEYFRAMES,
    _exportCode: () => exportCode(),
    _importCode: (c) => importCode(c),
    _refresh: () => refresh(),
    get _config() { return config; }
};

module.exports = { id: 'discord-theme', name: 'Discord theme', start, PRESETS, FONTS, GFONTS, LOOKS, onAccent };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
