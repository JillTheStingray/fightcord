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
    cleanNames: true,      // hide Cerberus' extras on the chat name line (thumbs, dot, ping)
    chatSize: 18,          // chat text px; Discord's default is 16, 18 matches a zoomed Discord
    preset: 'dark',        // dark | amoled | classic | neon | custom
    accent: '#5865f2',     // Discord blurple
    font: '',              // '' = Discord's gg sans / Noto Sans
    custom: { bg: '#1b1a1f', panel: '#1b1a1f', dark: '#131215', text: '#dfdfe2' },
    bgFile: '',            // chat background picture: a file next to the plugins (theme-background.*)
    bgDim: 0.6
};

const N_ = (s) => s;          // translated where shown
const PRESETS = { dark: N_('Dark'), amoled: N_('AMOLED black'), classic: N_('Classic grey'), neon: N_('FightCord Neon'), custom: N_('Custom (theme editor)') };
const FONTS = { '': 'Discord (gg sans)', "'Segoe UI', sans-serif": 'Segoe UI', "'Noto Sans', sans-serif": 'Noto Sans',
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
html.dc-theme.dc-preset-amoled {
    /* true black, like the user's AMOLED Discord */
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
html.dc-theme ::-webkit-scrollbar-thumb { background: var(--dc-select); border-radius: 4px; border: 0; }
html.dc-theme ::-webkit-scrollbar-track { background: transparent; }
html.dc-theme ::selection { background: var(--dc-accent-soft); }
`;

const LAYOUT = `
/* ============================== server rail ============================== */
html.dc-layout .mainToolbarWrapper { position: relative; z-index: 30; }
html.dc-layout .mainToolbarWrapper .mainToolbar {
    width: 72px; min-width: 72px; background: var(--dc-bg3); background-image: none;
}
html.dc-layout .settingsWrapper, html.dc-layout .notificationsWrapper { left: 72px; }
html.dc-layout .mainToolbar .logo { width: 40px; height: 40px; margin: 12px auto 0; }
html.dc-layout .mainToolbar .logo svg { width: 40px; height: 40px; }
html.dc-layout .mainToolbar .channelsList { padding-top: 0; }
html.dc-layout .mainToolbar .channelsList::before {
    content: ''; display: block; width: 32px; height: 2px; margin: 8px auto 8px; border-radius: 1px;
    background: var(--dc-select);
}
html.dc-layout .channelItemWrapper { margin: 0 0 8px; width: 72px; }
html.dc-layout .channelItemWrapper .channelItem {
    width: 40px; height: 40px; margin: 0 16px; border: 0; border-radius: 12px;
    background-color: var(--dc-select); background-position: center; background-size: cover; background-repeat: no-repeat;
    transition: border-radius .15s ease-out, background-color .15s ease-out;
}
html.dc-layout .channelItemWrapper .channelItem:hover,
html.dc-layout .channelItemWrapper .channelItem.active { border-radius: 12px; border: 0; }
html.dc-layout .channelItemWrapper .channelItem:not(.dc-art):hover,
html.dc-layout .channelItemWrapper .channelItem:not(.dc-art).active { background-color: var(--dc-blurple); }
html.dc-layout .channelItemWrapper .channelItem .channelItemName {
    font-size: 0; padding: 0; border-radius: inherit; color: var(--dc-text); text-transform: none;
}
html.dc-layout .channelItemWrapper .channelItem .channelItemName::before {
    content: attr(data-dc-initials); font-size: 12px; font-weight: 600; letter-spacing: 0; line-height: 1;
    color: var(--dc-text);
}
html.dc-layout .channelItemWrapper .channelItem:hover .channelItemName::before,
html.dc-layout .channelItemWrapper .channelItem.active .channelItemName::before { color: #fff; }
html.dc-layout .channelItemWrapper .channelItem.dc-art .channelItemName::before { content: none; }
/* the white pill on the left edge */
html.dc-layout .channelItemWrapper .channelItem::before {
    content: ''; position: absolute; left: -16px; top: 50%; width: 4px; height: 0; margin-top: 0;
    background: var(--dc-head); border-radius: 0 4px 4px 0;
    transition: height .15s ease-out, margin-top .15s ease-out;
}
html.dc-layout .channelItemWrapper .channelItem:hover::before { height: 20px; margin-top: -10px; }
html.dc-layout .channelItemWrapper .channelItem.active::before { height: 36px; margin-top: -18px; }
/* FC's glow ring becomes Discord's name tooltip */
html.dc-layout .channelItemWrapper .channelItem::after {
    content: attr(data-dc-name); display: block; box-shadow: 0 8px 16px rgba(0,0,0,.24);
    position: absolute; left: 52px; top: 50%; width: auto; height: auto; transform: translateY(-50%);
    background: var(--dc-float); color: var(--dc-head); padding: 8px 12px; border-radius: 4px;
    font-size: 15px; font-weight: 600; line-height: 1.25; white-space: nowrap; text-transform: none;
    opacity: 0; pointer-events: none; z-index: 1000; transition: opacity .1s ease-out;
}
html.dc-layout .channelItemWrapper .channelItem.active::after { box-shadow: 0 8px 16px rgba(0,0,0,.24); opacity: 0; }
html.dc-layout .channelItemWrapper .channelItem:hover::after { opacity: 1; }
/* unread / mention / challenge markers */
html.dc-layout .channelItem .notificationsIndicatorsWrapper .notificationsIndicators { left: -16px; }
html.dc-layout .channelItem .notificationsIndicators .newMessages {
    width: 4px; height: 8px; border-radius: 0 4px 4px 0; background-color: var(--dc-head); box-shadow: none;
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
    width: 40px; height: 40px; padding: 10px; box-sizing: border-box; border-radius: 12px;
    background: var(--dc-select); fill: var(--dc-green); filter: none;
    transition: border-radius .15s ease-out, background-color .15s ease-out;
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
    background: var(--dc-float); border-radius: 8px; box-shadow: 0 8px 16px rgba(0,0,0,.24); border: 0;
}

/* ============================== channel header ============================== */
html.dc-layout .channelToolbar {
    height: 48px; min-height: 48px; background: var(--dc-bg); padding: 0 8px 0 16px; position: relative; z-index: 3;
    box-shadow: none; border-bottom: 1px solid var(--dc-divider); box-sizing: border-box;
}
html.dc-layout .channelToolbar .channelInfo { height: 48px; align-items: center; min-width: 0; flex: 1 1 auto; }
html.dc-layout .channelToolbar .channelInfo .name:not(.title) { flex: 0 0 auto; overflow: visible; }
html.dc-layout .channelToolbar .channelInfo .name {
    font-size: 13px; font-weight: 600; color: var(--dc-muted); text-transform: none; letter-spacing: 0;
    padding: 0 8px; line-height: 20px; height: auto;
}
html.dc-layout .channelToolbar .channelInfo .name.title {
    font-size: 16px; color: var(--dc-head); padding-left: 0; margin-right: 4px;
    border-right: 1px solid var(--dc-divider); padding-right: 12px;
    flex: 0 1 auto; min-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* the rom name is already in the title; Discord's header has no room for it */
html.dc-layout .channelToolbar .channelInfo .name[title="Rom name"] { display: none; }
html.dc-layout .channelToolbar .channelInfo .name.title::first-letter { color: var(--dc-faint); font-weight: 400; }
html.dc-layout .channelToolbar .channelInfo .name .link { color: var(--dc-icon); text-transform: none; font-weight: 500; font-size: 14px; }
html.dc-layout .channelToolbar .channelInfo .name .link:hover { color: var(--dc-head); text-decoration: none; }
html.dc-layout .channelToolbar .rankedWrapper svg path { fill: var(--dc-icon); }
html.dc-layout .channelToolbar .channelActions { height: 48px; align-items: center; flex: 0 0 auto; }
html.dc-layout .button-alt {
    height: 32px; min-height: 32px; padding: 2px 16px; border: 0; border-radius: 3px; background: var(--dc-btn);
    color: #fff; font-size: 14px; font-weight: 500; text-transform: none; letter-spacing: 0; margin-left: 8px;
    transition: background-color .17s ease;
}
html.dc-layout .button-alt:hover { background: var(--dc-btn-h); color: #fff; border: 0; }
html.dc-layout .button-alt::after { display: none; }
html.dc-layout .button-alt .icon, html.dc-layout .button-alt:hover .icon { width: 18px; height: 18px; fill: #fff; }
html.dc-layout .button-generic {
    border: 0; border-radius: 3px; background: var(--dc-blurple); color: #fff; font-weight: 500;
    text-transform: none; box-shadow: none; letter-spacing: 0;
}
html.dc-layout .button-generic:hover { background: var(--dc-blurple-h); color: #fff; }
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
html.dc-layout .chatContent .blocks .user:hover { background: var(--dc-blurple); color: #fff; }
html.dc-layout .chatContent .blocks a { color: var(--dc-link); }
/* FC's emphasis (.highlight -- NOT a mention) is bold accent-blue; Discord's bold is just bold */
html.dc-layout .chatContent .message.chat .blocks .highlight { color: var(--dc-head); font-weight: 700; }
/* the rules / resources message becomes an embed card */
html.dc-layout .chatContent .messageWrapper.motd { margin: 16px 48px 8px 72px; padding: 0; background: none; }
html.dc-layout .chatContent .messageWrapper.motd .motd {
    background: var(--dc-input); border: 0; border-left: 4px solid var(--dc-blurple); border-radius: 4px;
    padding: 8px 16px 16px 12px; box-shadow: none;
}
html.dc-layout .chatContent .motd .line { padding: 0; }
html.dc-layout .chatContent .motd .line .time { display: none; }
html.dc-layout .chatContent .motd .blocksContainer { color: var(--dc-text); font-size: 14px; line-height: 18px; }

/* ============================== system messages ============================== */
/* challenge results/errors, incoming challenges, end-of-match, bot/channel notices.
   FC draws these as shaded full-width bands with bold capitals; Discord draws
   system messages as a plain muted line in the text column. */
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) {
    position: relative; margin: 6px 0 0; padding: 3px 48px 3px 72px; min-height: 22px;
    background: none; box-shadow: none; border: 0; animation: none; font-size: 15px; line-height: 22px;
}
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd):hover { background: var(--dc-hover); }
/* the band is drawn twice: on the wrapper and again on the inner .message */
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) .message {
    padding: 0; margin: 0; background: none; box-shadow: none; border: 0; animation: none;
}
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) header { display: none; }
html.dc-layout .chatContent .messageWrapper.channel header { display: flex; padding: 0; min-height: 0; }
html.dc-layout .chatContent .messageWrapper.channel header .author { text-transform: none; font-size: 15px; }
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) .line { padding: 0; font-size: 15px; line-height: 22px; }
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) .line .time { display: none; }
html.dc-layout .chatContent .messageWrapper:not(.chat):not(.motd) .regular {
    font-weight: 400; text-transform: none; color: var(--dc-muted);
}
html.dc-layout .chatContent .messageWrapper.bot { font-style: normal; font-size: 14px; color: var(--dc-muted); }
html.dc-layout .chatContent .message .challengeContainer,
html.dc-layout .chatContent .message .challengeWrapper { padding: 0; align-items: center; }
html.dc-layout .chatContent .message .challengeContainer .title,
html.dc-layout .chatContent .message .challengeWrapper .title {
    font-size: 15px; font-weight: 400; text-transform: none; letter-spacing: 0; line-height: 22px;
    color: var(--dc-muted); margin: 0 8px 0 0;
}
html.dc-layout .chatContent .message .challengeContainer .title strong,
html.dc-layout .chatContent .message .challengeWrapper .title strong { color: var(--dc-head); font-weight: 600; }
html.dc-layout .chatContent .message .wrapUpWrapper { font-weight: 500; }
html.dc-layout .chatContent .message .wrapUpWrapper.accepted { color: var(--dc-green); }
html.dc-layout .chatContent .message .wrapUpWrapper.declined { color: var(--dc-red); }
html.dc-layout .chatContent .message .challengeWrapper .challengeContent .userInfo { margin: 4px 16px 4px 0; }
html.dc-layout .chatContent .message .challengeWrapper .challengeContent .userInfo .name {
    font-size: 16px; font-weight: 600; color: var(--dc-head);
}
/* Accept / Decline / Cancel become Discord buttons */
html.dc-layout .chatContent .messageWrapper .buttons { margin: 4px 0 2px; text-transform: none; font-weight: 500; }
html.dc-layout .chatContent .messageWrapper .accept-challenge,
html.dc-layout .chatContent .messageWrapper .decline-challenge,
html.dc-layout .chatContent .messageWrapper .cancel-challenge,
html.dc-layout .chatContent .messageWrapper .rank-option {
    display: inline-flex; align-items: center; height: 28px; padding: 0 12px; margin: 0 8px 0 0;
    border-radius: 4px; font-size: 14px; font-weight: 500; text-transform: none; letter-spacing: 0;
    text-shadow: none; filter: none; cursor: pointer; user-select: none;
    background: var(--dc-btn); color: var(--dc-text); transition: background-color .17s ease;
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
    border-left: 4px solid var(--dc-blurple); border-radius: 4px; background: var(--dc-input);
}
html.dc-layout .chatContent .endgameMessageWrapper h3 {
    margin: 0 0 2px; font-size: 15px; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--dc-head);
}
html.dc-layout .chatContent .endgameMessageWrapper p { margin: 0; font-size: 14px; line-height: 20px; color: var(--dc-muted); }
html.dc-layout .chatContent .endgameMessageWrapper a { color: var(--dc-link); font-weight: 400; }
html.dc-layout .chatContent .endgameMessageWrapper .wrapUpWrapper.won { color: var(--dc-green); }
html.dc-layout .chatContent .endgameMessageWrapper .wrapUpWrapper.lost { color: var(--dc-red); }

/* ============================== cleaner name line ============================== */
/* name, flag, rank, time -- like Discord. Hidden, not removed: Cerberus keeps working. */
html.dc-layout.dc-clean-names .chatContent .message.chat header .cerb-chat-trigger,
html.dc-layout.dc-clean-names .chatContent .message.chat header .cerberus-injected-status,
html.dc-layout.dc-clean-names .chatContent .message.chat header .cerberus-injected-pingbar,
html.dc-layout.dc-clean-names .chatContent .message.chat header .cerberus-injected-pingtext,
html.dc-layout.dc-clean-names .chatContent .message.chat header .fcScoutBadge { display: none; }
html.dc-layout.dc-clean-names .chatContent .message.chat header .author .flagWrapper { margin-left: 6px; }

/* ============================== message box ============================== */
html.dc-layout .chatInput { padding: 0 16px 12px; background: var(--dc-bg); border: 0; height: auto; }
html.dc-layout .chatInput input.input {
    height: 52px; background: var(--dc-input); color: var(--dc-text); border: 1px solid var(--dc-input-edge);
    border-radius: 8px; padding: 14px 104px 14px 16px; font-size: 16px; line-height: 22px; box-shadow: none;
    box-sizing: border-box;
}
html.dc-layout .chatInput input.input::placeholder { color: var(--dc-faint); }
html.dc-layout .chatInput .emojiBtn, html.dc-layout .chatInput .fontStyleBtn {
    top: 26px; background: transparent; border: 0; color: var(--dc-icon); opacity: .8;
}
html.dc-layout .chatInput .fontStyleBtn { right: 28px; }
html.dc-layout .chatInput .emojiBtn { right: 60px; }
html.dc-layout .chatInput .emojiBtn:hover, html.dc-layout .chatInput .fontStyleBtn:hover { opacity: 1; color: var(--dc-head); }

/* ============================== member list ============================== */
html.dc-layout .usersListToolbar,
html.dc-layout .usersListToolbar .usersListWrapper { width: 300px; min-width: 300px; background: var(--dc-bg2); background-image: none; }
html.dc-layout .usersListToolbar .usersListWrapper { border-left: 1px solid var(--dc-divider); box-sizing: border-box; }
html.dc-layout .usersListWrapper .usersOnlineTitle,
html.dc-layout .usersListWrapper .usersAwayTitle,
html.dc-layout .usersListWrapper .usersIgnoredTitle,
html.dc-layout .usersListWrapper .matchesTitleWrapper {
    font-size: 14px; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--dc-muted);
    padding: 20px 8px 4px 16px; height: auto; min-height: 0; line-height: 18px; background: none; border: 0;
    box-shadow: none;
}
/* FC pins this panel (position: fixed; top: 60px) under its 60px header -- ours is 48px */
html.dc-layout .usersListToolbar .usersListWrapper { top: 48px; bottom: 0; padding-top: 16px; }
html.dc-layout .usersListWrapper .usersOnlineTitle { padding-top: 4px; display: flex; align-items: center; }
html.dc-layout .usersListWrapper .usersOnlineTitle > span:first-of-type,
html.dc-layout .usersListWrapper .usersAwayTitle > span:first-of-type,
html.dc-layout .usersListWrapper .usersIgnoredTitle > span:first-of-type {
    background: none; color: var(--dc-muted); font-size: 14px; font-weight: 500; padding: 0; margin-left: 4px; min-width: 0;
}
html.dc-layout .usersListWrapper .usersOnlineTitle > span:first-of-type::before,
html.dc-layout .usersListWrapper .usersAwayTitle > span:first-of-type::before,
html.dc-layout .usersListWrapper .usersIgnoredTitle > span:first-of-type::before { content: '— '; }
html.dc-layout #cerbPlayerSearchContainer { padding: 0 8px; height: auto; background: none; }
html.dc-layout #cerbPlayerSearchInput {
    background: var(--dc-bg3); border: 1px solid var(--dc-divider); border-radius: 8px; height: 30px; color: var(--dc-text);
    padding: 0 8px; font-size: 14px; box-shadow: none; width: 100%; box-sizing: border-box;
}
html.dc-layout .usersListWrapper .userItem {
    display: flex; align-items: center; height: 42px; min-height: 42px; padding: 0 8px; margin: 0 8px 2px;
    border-radius: 4px; background: none; border: 0; box-sizing: border-box;
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
    font-size: 15px; font-weight: 500; color: var(--dc-muted); line-height: 20px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
html.dc-layout .usersListWrapper .userItem:hover .playerName { color: var(--dc-head); }
html.dc-layout .usersListWrapper .userItem .nameAndGame > :not(.playerName) { font-size: 12px; color: var(--dc-muted); line-height: 16px; }
html.dc-layout .usersListWrapper .userItem .flagWrapper { order: 1; width: 18px; height: 13px; margin: 0 0 0 6px; background-size: contain; }
html.dc-layout .usersListWrapper .userItem .rankWrapper { order: 2; margin: 0 0 0 6px; }
html.dc-layout .usersListWrapper .userItem .pingWrapper { order: 3; margin: 0 0 0 6px; }
html.dc-layout .usersListWrapper .matchesList .matchItem {
    background: var(--dc-bg); border: 0; border-radius: 8px; margin: 0 8px 4px; box-shadow: none;
}

/* ============================== settings panel ============================== */
html.dc-layout .settingsWrapper .settingsSection { background: var(--dc-bg2); box-shadow: 0 0 0 1px rgba(0,0,0,.2); }
html.dc-layout .settingsWrapper .settingsSection .label {
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; color: var(--dc-muted);
}
html.dc-layout .settingsWrapper .settingsSection .option .title { color: var(--dc-text); font-size: 14px; }
html.dc-layout .settingsWrapper .settingsSection select,
html.dc-layout .settingsWrapper .settingsSection input[type="text"],
html.dc-layout .settingsWrapper .settingsSection input[type="password"],
html.dc-layout .settingsWrapper .settingsSection input.userEmail {
    background: var(--dc-bg3); color: var(--dc-text); border: 0; border-radius: 4px; box-shadow: none;
}
/* checkboxes become Discord's toggle switches */
html.dc-layout .settingsWrapper .settingsSection .option .optionCheckboxWrapper .optionCheckbox {
    width: 40px; height: 24px; border: 0; border-radius: 12px; background: #80848e; box-shadow: none;
    transition: background-color .2s ease;
}
html.dc-layout .settingsWrapper .settingsSection .option .optionCheckboxWrapper:hover .optionCheckbox { box-shadow: none; }
html.dc-layout .settingsWrapper .settingsSection .option .optionCheckboxWrapper input[type="checkbox"] ~ .optionCheckbox::before {
    top: 3px; left: 3px; right: auto; bottom: auto; width: 18px; height: 18px; border-radius: 50%;
    background: #fff; opacity: 1; transition: transform .2s ease;
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
    background: var(--dc-bg3); color: var(--dc-text); border: 0; border-radius: 4px; box-shadow: none;
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


// Every declaration gets !important (see the note above COLORS). Only touches "prop: value;"
// pairs, so selectors and at-rules are left as written.
function important(css) {
    return css.replace(/:\s*([^;{}]+?)\s*;/g, (m, v) => /!important$/.test(v) ? m : ': ' + v + ' !important;');
}

// the settings block's theme editor
const EDITOR_CSS = `
.dcSwatches { display: flex; align-items: center; }
.dcSwatch { flex: none; width: 20px; height: 20px; margin-left: 6px; border-radius: 50%; cursor: pointer; }
.dcSwatch.on { box-shadow: 0 0 0 2px var(--fc-s2), 0 0 0 4px var(--fc-head); }
.dcSwatches .fc-color { margin-left: 10px; height: 28px; width: 40px; }
.dcColors { display: flex; }
.dcColors label { display: flex; flex-direction: column; align-items: center; margin-left: 12px; font-size: 11px; color: var(--fc-muted); cursor: pointer; }
.dcColors .fc-color { height: 30px; margin-bottom: 2px; }
.dcCode { width: 220px; margin-right: 8px; height: 30px; font-size: 12px; }
.dcBlock .fc-field > .fc-btn + .fc-btn { margin-left: 8px; }
.dcEdMsg { min-height: 16px; margin-top: 6px; font-size: 12px; color: var(--fc-success); }
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
    if (on && config.font) html.style.setProperty('--dc-font', config.font, 'important');
    else html.style.removeProperty('--dc-font');
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
    }
    applyCustom(html, on);
    const size = Math.min(24, Math.max(12, +config.chatSize || 18)) + 'px';
    if (html.style.getPropertyValue('--dc-chat') !== size) html.style.setProperty('--dc-chat', size);
    if (on && safe !== lastSafe && document.querySelector('#app')) {
        fc.log(safe ? 'layout layer on' : 'SAFE MODE: layout anchors missing, colours only');
        lastSafe = safe;
    }
}

function ensureStyle() {
    fc.ui.style('dcThemeStyle', important(COLORS) + important(LAYOUT) + RAW + EDITOR_CSS);
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
        ${sel('preset', 'Theme', Object.keys(PRESETS).map(k => [k, PRESETS[k]]))}
        <div class="fc-field"><span class="fc-field-text"><b>${E(T('Accent colour'))}</b></span><span class="dcSwatches">
            ${Object.keys(SWATCHES).map(n => `<span class="dcSwatch${SWATCHES[n] === config.accent ? ' on' : ''}" data-hex="${SWATCHES[n]}" title="${E(T(n))}" style="background:${SWATCHES[n]}"></span>`).join('')}
            <input type="color" class="fc-input fc-color" data-opt="accent" value="${E(config.accent)}" title="${E(T('Pick any colour'))}"></span></div>
        ${sel('chatSize', 'Chat text size', [14, 15, 16, 17, 18, 20, 22].map(n => [n, n + 'px']), N_('Discord’s default is 16'))}
        ${sw('gameIcons', 'Game artwork icons', 'In the left rail')}
        ${sw('chatArt', 'Artwork behind chat', 'Fightcade’s game picture, faded')}
        ${sw('cleanNames', 'Cleaner name line', 'Hide thumbs-up / dot / ping next to names')}
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
        } else if (t.dataset.c) { store.save(); refresh(); }
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
        ['dc-theme', 'dc-layout', 'dc-chat-art', 'dc-clean-names', 'dc-has-bg'].concat(Object.keys(PRESETS).map(p => 'dc-preset-' + p)).forEach(c => html.classList.remove(c));
        clearRail();
        window.__fcDiscordThemeLoaded = false;
    });
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
    swatches: () => Object.assign({}, SWATCHES),
    theme: () => ({ enabled: config.enabled, preset: config.preset, accent: config.accent, font: config.font }),
    setTheme(t) {
        if (t.preset && PRESETS[t.preset]) config.preset = t.preset;
        if (t.accent && hexRgb(t.accent)) config.accent = String(t.accent).toLowerCase();
        if (t.enabled != null) config.enabled = !!t.enabled;
        store.save();
        refresh();
    },
    _css: () => important(COLORS) + important(LAYOUT) + RAW,
    _exportCode: () => exportCode(),
    _importCode: (c) => importCode(c),
    _refresh: () => refresh(),
    get _config() { return config; }
};

module.exports = { id: 'discord-theme', name: 'Discord theme', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
