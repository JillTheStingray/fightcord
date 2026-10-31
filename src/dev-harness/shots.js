#!/usr/bin/env node
/**
 * README screenshots from the harness in demo mode (demo.js: made-up names, chat, avatars and
 * history in place of the real ones from your snapshots).
 *
 *   node dev-harness/shots.js [--out <dir>] [--only <scene>]
 *
 * A screenshot is only written when window.__demoLeaks() finds none of the snapshot's real
 * names or avatar hashes left on the page. Look at every picture before publishing anyway.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] || true) : def; };
const OUT = path.resolve(opt('out', path.join(ROOT, '..', 'fightcord', 'repo', 'docs', 'screenshots')));
const ONLY = opt('only', '');
const LANG = opt('lang', '');          // --lang pt / es
const W = 1440, H = 900;

const CHANNEL = '2026-09-27T19-44-38-street-fighter-iii-3rd-strike-fight-for-';
const LOBBY = '2026-09-27T16-53-42-lobby';
const BROWSE = '2026-09-28T22-53-10-browse-search';      // has Fightcade's full home rows

// run: code evaluated in the page once it has settled (await-able; sleep(ms) is there)
const SCENES = [
    { name: 'channel', snap: CHANNEL, run: '' },
    { name: 'discover', snap: BROWSE, view: 'home', wait: 9000, run: `
        // a few friends, three events, rivals from the demo history
        const F = fightcord, us = Object.keys(F.app.users()), fr = F.modules.get('friends');
        const free = us.filter(n => !F.app.playing(n) && !F.app.users()[n].away && !F.app.isMe(n));
        [us.find(n => F.app.playing(n)), free[3], free[7]].forEach(n => n && fr.add(n));
        __sim.event('Saturday Showdown', 95); __sim.event('Blue Wolves #260', 60 * 26); __sim.event('SSEU #208', 60 * 50);
        F.modules.get('discover')._tick();
        await sleep(1500);
        document.querySelector('.welcomeWrapper > .contentWrapper').scrollTop = 0;
        await sleep(400);` },
    { name: 'discover-foryou', snap: BROWSE, view: 'home', wait: 9000, run: `
        const F = fightcord, us = Object.keys(F.app.users()), fr = F.modules.get('friends');
        const free = us.filter(n => !F.app.playing(n) && !F.app.users()[n].away && !F.app.isMe(n));
        [us.find(n => F.app.playing(n)), free[3], free[7]].forEach(n => n && fr.add(n));
        __sim.event('Saturday Showdown', 95); __sim.event('Blue Wolves #260', 60 * 26); __sim.event('SSEU #208', 60 * 50);
        F.modules.get('discover')._tick();
        await sleep(1500);
        document.getElementById('fcdYours').scrollIntoView({ block: 'start' });
        await sleep(500);` },
    { name: 'login', snap: CHANNEL, q: 'login=1&known=1', wait: 6000, run: `await sleep(2500);` },
    { name: 'scout', snap: CHANNEL, run: `
        // a B-ranked player near you (the harness API rates names 120-219 as B), on a normal connection
        const n = Object.keys(fightcord.app.users())[123];
        Object.assign(fightcord.app.users()[n], { ping: 45, wlan: false, proxy: false });
        __sim.challenge(n, { ranked: 5 });
        await sleep(3000);` },
    { name: 'progress', snap: CHANNEL, run: `fightcord.modules.get('stats').open({ tab: 'progress' }); await sleep(1200);` },
    { name: 'analytics', snap: CHANNEL, run: `fightcord.modules.get('stats').open({ tab: 'analytics' }); await sleep(1200);` },
    { name: 'feed', snap: CHANNEL, wait: 24000, run: `
        const F = fightcord.modules.get('feed'), S = __sim;
        const ch = fightcord.app.joinedChannels()[0].id;
        ['NeoRookie', 'GaugeMonk', 'TigerChef', 'ParryPilot'].forEach((n, i) => S.join(n, { rank: [2, 3, 5, 4][i] }));
        F._scan(); F._flush();
        const q1 = S.matchStart('GaugeMonk', 'TigerChef'); F._scan();
        const users = Object.keys(fightcord.app.users());
        const q2 = S.matchStart(users[12], users[13]); F._scan();
        F._result({ players: ['NeoRookie', 'ParryPilot'], ranks: [2, 5], ch }, 'NeoRookie', 'ParryPilot', 3, 1);
        F._result({ players: ['NeoRookie', 'TigerChef'], ranks: [2, 4], ch }, 'NeoRookie', 'TigerChef', 3, 2);
        F._result({ players: ['NeoRookie', users[20]], ranks: [2, 3], ch }, 'NeoRookie', users[20], 2, 0);
        F.open(ch);
        await sleep(800);` },
    { name: 'goals', snap: CHANNEL, run: `document.querySelector('.fcglPill').click(); await sleep(800);` },
    { name: 'findmatch', snap: CHANNEL, run: `
        // a believable mix: pings, a Wi-Fi player, ranks around yours
        const fm = fightcord.modules.get('find-match');
        const ch = fightcord.app.activeChannel().name;
        fm._list().forEach((c, i) => Object.assign(fightcord.app.users()[c.name], {
            ping: [38, 52, 61, 74, 45, 88, 97, 66, 41, 58, 83, 70][i % 12], wlan: i === 5, proxy: false,
            channelRank: { [ch]: [2, 3, 2, 1, 3, 2, 2, 1, 3, 2, 2, 3][i % 12] } }));
        // a couple of close rivalries from your history
        ['HadoKid', 'Low_Kid'].forEach((n, i) => { const u = fightcord.app.users()[n]; if (u) Object.assign(u, { ping: [48, 57][i], away: false, playing: undefined, channelRank: { [ch]: 2 } }); });
        // real-looking ELOs instead of the same rank estimate for everyone
        __sim.elo(null, 862, false);
        fm._list().forEach((c, i) => __sim.elo(c.name, [905, 831, 874, 948, 812, 889, 790, 856, 921, 843, 877, 802, 866, 899][i % 14], false));
        document.querySelector('.fcfmPill').click();
        await sleep(1200);` },
    { name: 'streamer', snap: CHANNEL, run: `
        fightcord.modules.get('streamer').set(true);
        document.querySelectorAll('#fcToasts > *').forEach(t => t.remove());
        const free = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n));
        __sim.challenge(free[40], { ranked: 3 });
        await sleep(300);
        __sim.challenge(free[41], { ranked: 3 });
        __sim.challenge(free[42], { ranked: 2 });
        await sleep(2500);` },
    { name: 'events', snap: '2026-09-28T22-53-10-browse-search', view: 'home', keepToasts: true, run: `
        // static captures have no Vue data: give the event cards their events (odd ones = your game)
        [...document.querySelectorAll('.eventPreviewWrapper')].forEach((c, i) => { c.__vue__ = { event: {
            name: c.querySelector('.name').textContent.trim(), date: Date.now() + (i + 1) * 5 * 3600e3, region: 'EU',
            link: 'https://example.com', gameid: i % 2 ? 'sfiii3nr1' : 'garou', channel: { name: 'Game ' + i } } }; });
        document.body.appendChild(document.createElement('i'));
        await sleep(800);
        const card = document.querySelector('.eventPreviewWrapper');
        if (card) card.scrollIntoView({ block: 'center' });
        fightcord.modules.get('events')._check();
        __sim.event('Saturday Showdown', 29);
        fightcord.modules.get('events')._check();
        await sleep(600);` },
    { name: 'welcome', snap: CHANNEL, run: `fightcord.modules.get('welcome').open(0); await sleep(1000);` },
    // the website (fightcord-site): Looks, voice chat, the game hub, the VS screen, the emulator bar, the visualizer
    ...['dark', 'ash', 'onyx', 'neon', 'crt', 'strike', 'tokyo'].map(k => ({ name: 'look-' + k, snap: CHANNEL, wait: 7000, run: `
        __sim.music();
        fightcord.modules.get('discord-theme').applyLook('${k}', true);
        await sleep(3500);` })),
    { name: 'voice', snap: CHANNEL, run: `
        // made-up opponents with Fightcord (+ voice), an incoming challenge, a live voice pill
        const pr = fightcord.modules.get('presence'), vs = fightcord.config('voice');
        vs.data.enabled = true; vs.save();
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n));
        [0, 5, 9, 14, 17].forEach((i, j) => pr._heard(others[i], j % 2 === 0));
        __sim.elo(null, 1512, false); __sim.elo(others[0], 1546, false);           // a close set, not a 1% one
        await sleep(800);
        fightcord.modules.get('voice')._demo(others[9], 'connected');
        fightcord.modules.get('challenge-card').show({ name: others[0], channel: fightcord.app.activeChannelId(), id: 'demo1', ranked: 3, demo: true });
        await sleep(1500);` },
    ...['rankings', 'replays', 'profile'].map(tab => ({ name: 'hub-' + tab, snap: CHANNEL, run: `
        const ch = fightcord.app.channel(fightcord.app.activeChannelId());
        fightcord.modules.get('game-hub').open({ tab: '${tab}', channel: ch.name, rom: ch.gameid${tab === 'profile' ? ", who: fightcord.app.me()" : ''} });
        await sleep(3500);` })),
    { name: 'vs', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n));
        fightcord.modules.get('match-screens')._showVs(fightcord.app.me(), others[3]);
        await sleep(1400);` },
    // 3.1 result screens: a win that crosses into the next rank (exact ELO), game by game; a loss with
    // nothing from the emulator or Fightcade's ELO; a draw
    { name: 'res-won', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n));
        const G = (w, m, t) => ({ w, m, t });
        fightcord.modules.get('match-screens')._showResult('won', 3, 1, others[3], 'Street Fighter III 3rd Strike', {
            streak: '3 WIN STREAK', hot: true, myChar: 'Ken', oppChar: 'Chun-Li', elo: { start: 1588, end: 1607 },
            games: [G(1, 'Ken', 'Yun'), G(0, 'Ken', 'Yun'), G(1, 'Ken', 'Chun-Li'), G(1, 'Ken', 'Chun-Li')],
            lines: ["You're 4–2 vs " + others[3], 'Tonight 5–2'], rematch: { opp: others[3], ft: 3 } });
        await sleep(2800);` },
    { name: 'res-lost', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n));
        fightcord.modules.get('match-screens')._showResult('lost', 1, 3, others[3], 'Street Fighter III 3rd Strike', {
            streak: 'Streak of 3 ended', lines: ["You're 4–3 vs " + others[3], 'Tonight 5–3'], rematch: { opp: others[3], ft: 3 } });
        await sleep(2800);` },
    { name: 'res-draw', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n));
        fightcord.modules.get('match-screens')._showResult('draw', 2, 2, others[3], 'Street Fighter III 3rd Strike', {});
        await sleep(2400);` },
    { name: 'emulator', snap: CHANNEL, run: `
        const st = fightcord.config('emu-skin'); st.data.enabled = true; st.save();
        fightcord.modules.get('fightcord').open('appearance');
        await sleep(1500);
        fightcord.settings.refresh('emu-skin');
        await sleep(1500);
        const t = document.querySelector('[data-fc-block="emu-skin"]');
        if (t) t.scrollIntoView({ block: 'start' });
        await sleep(1500);` },
    { name: 'visualizer', snap: CHANNEL, run: `
        __sim.music();
        fightcord.modules.get('backgrounds').setLook({ style: 'visualizer', look: 'bars', intensity: 0.85 });
        await sleep(3000);` },
    { name: 'settings', snap: CHANNEL, run: `fightcord.modules.get('fightcord').open('home'); await sleep(1000);` },
    // private lobbies: made-up members and chat (the harness has no relays)
    // (3.0: the lobby's picture, banner, roles, reactions, a reply, a pin, the voice room, the hover toolbar)
    { name: 'lobby', snap: CHANNEL, run: `fightcord.modules.get('lobbies')._demo({ v3: true, voice: true, more: [{ id: 'demo1', name: 'Parry Club', seeds: ['0'], epoch: 0, lastRead: 0 }] }); await sleep(1500);
        const ln = [...document.querySelectorAll('.fclbLog .ln[data-mid]')].slice(-2)[0];
        ln.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await sleep(300);` },
    { name: 'lobby-voice', snap: CHANNEL, run: `fightcord.modules.get('lobbies')._demo({ voice: true }); await sleep(1500);` },
    // 2.15 pop-ups: the profile popout with quick settings, Tonight, quick settings from the ⋯ menu, notes
    { name: 'pop-profile', snap: CHANNEL, run: `fightcord.modules.get('profile-card')._show(); await sleep(900);` },
    { name: 'pop-tonight', snap: CHANNEL, run: `document.querySelector('.fcmsPill').click(); await sleep(900);` },
    { name: 'pop-quick', snap: CHANNEL, run: `fightcord.modules.get('profile-card').openQuick(); await sleep(900);` },
    // 3.5 matchup guide: the guide above your own note (icons from the wiki)
    { name: 'mu-note', snap: CHANNEL, run: `fightcord.modules.get('notes').editMatchup('sfiii3nr1', 'Chun-Li'); await sleep(2500);` },
    // friends + DMs (3.6): the Friends view, pending requests, a DM, a message request, a call ringing
    { name: 'dm-home', snap: CHANNEL, run: `fightcord.modules.get('dms')._demo({ tab: 'online' }); await sleep(900);` },
    { name: 'dm-pending', snap: CHANNEL, run: `fightcord.modules.get('dms')._demo({ tab: 'pending' }); await sleep(900);` },
    { name: 'dm-add', snap: CHANNEL, run: `fightcord.modules.get('dms')._demo({ tab: 'add' }); await sleep(900);` },
    { name: 'dm-chat', snap: CHANNEL, run: `fightcord.modules.get('dms')._demo({ open: 'dm' }); await sleep(5000);` },
    { name: 'dm-req', snap: CHANNEL, run: `const ids = fightcord.modules.get('dms')._demo({ open: false }); fightcord.modules.get('lobbies').open(ids[ids.length - 1]); await sleep(2500);` },
    { name: 'dm-link', snap: CHANNEL, run: `fightcord.modules.get('dms')._demo({ open: false }); fightcord.modules.get('dms').linkShow(); await sleep(900);` },
    { name: 'dm-link-in', snap: CHANNEL, run: `fightcord.modules.get('dms')._demo({ open: false }); fightcord.modules.get('dms').linkEnter(); await sleep(900);` },
    { name: 'dm-ring', snap: CHANNEL, keepToasts: true, run: `const ids = fightcord.modules.get('dms')._demo({ open: false }); fightcord.modules.get('lobbies')._ring(ids[0]); await sleep(900);` },
    { name: 'pop-notes', snap: CHANNEL, run: `const n = Object.keys(fightcord.app.users()).filter(x => !fightcord.app.isMe(x))[4]; fightcord.modules.get('notes').edit(n); await sleep(800);` },
    // pictures in chat: a message that's only a GIF link, and the upload card for a pasted picture
    { name: 'chat-media', snap: CHANNEL, wait: 9000, run: `
        const lines = [...fightcord.app.channelElement().querySelectorAll('.messageWrapper.chat .line')];
        const ln = lines[lines.length - 1];
        const bc = ln.querySelector('.blocksContainer');
        [...bc.childNodes].forEach(n => { if (!(n.classList && n.classList.contains('fcxEmbed'))) n.remove(); });
        const sp = document.createElement('span'); sp.className = 'regular'; sp.textContent = 'https://giphy.com/gifs/street-fighter-ryu-3o7TKSjRrfIPjeiVyM'; bc.appendChild(sp);
        delete ln.dataset.fcxUrl;
        fightcord.modules.get('chat-extras')._sweep();
        await sleep(4000);
        const cw = fightcord.app.channelElement(); cw.querySelectorAll('.chatContent, .chatContent *').forEach(el => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; });
        await sleep(500);` },
    { name: 'upload-card', snap: CHANNEL, run: `
        const c = document.createElement('canvas'); c.width = 640; c.height = 360;
        const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 640, 360); gr.addColorStop(0, '#5865f2'); gr.addColorStop(1, '#eb459e');
        g.fillStyle = gr; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = 'bold 96px sans-serif'; g.textAlign = 'center'; g.fillText('GG 3-2', 320, 210);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const up = fightcord.modules.get('uploads');
        up.offer(new File([blob], 'gg-3-2.png', { type: 'image/png' }), fightcord.app.chatInput());
        // a second one, marked as a spoiler, and the toolbar of the first shown as on hover
        const c2 = document.createElement('canvas'); c2.width = 360; c2.height = 640; const g2 = c2.getContext('2d'); g2.fillStyle = '#23a55a'; g2.fillRect(0, 0, 360, 640);
        up.offer(new File([await new Promise(r => c2.toBlob(r, 'image/png'))], 'combo-route.png', { type: 'image/png' }), fightcord.app.chatInput());
        await sleep(300);
        const sp = document.querySelectorAll('.fcupTile [data-tray="spoiler"]')[1]; if (sp) sp.click();
        fightcord.app.setChatText('look at this');
        await sleep(900);` },
    { name: 'gif-favs', snap: CHANNEL, run: `
        const up = fightcord.modules.get('uploads');
        ['3o7TKSjRrfIPjeiVyM', 'l0HlNQ03J5JxX6lva', '3o6Zt481isNVuQI1l6', 'xT9IgG50Fb7Mi0prBC'].forEach((id, i) => up.toggleFav({ link: 'https://giphy.com/gifs/fight-' + id, src: 'https://media.giphy.com/media/' + id + '/giphy.mp4', kind: 'gifv' }));
        document.querySelectorAll('#fcToasts > *').forEach(t => t.remove());
        const btn = fightcord.app.channelElement().querySelector('.fcupGifBtn');
        up.openPicker(btn, fightcord.app.chatInput());
        await sleep(3500);` },
    { name: 'gif-search', snap: CHANNEL, run: `
        const data = atob('eyJ1bml2ZXJzYWwiOnsic2VhcmNoIjp7InEiOnsicmVzdWx0cyI6W3siaXRlbXVybCI6Imh0dHBzOi8vdGVub3IuY29tL3ZpZXcvcnl1LXN0cmVldC1maWdodGVyLXBpeGVscy1zcHJpdGUtYXR0YWNrLWdpZi0xNzAxNTE3MCIsImgxX3RpdGxlIjoiUnl1IFN0cmVldCBGaWdodGVyIiwibWVkaWFfZm9ybWF0cyI6eyJ0aW55bXA0Ijp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tLzV3ZHNsSkJzYVZjQUFBUDEvcnl1LXN0cmVldC1maWdodGVyLm1wNCJ9LCJ0aW55Z2lmIjp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tLzV3ZHNsSkJzYVZjQUFBQU0vcnl1LXN0cmVldC1maWdodGVyLmdpZiJ9fX0seyJpdGVtdXJsIjoiaHR0cHM6Ly90ZW5vci5jb20vdmlldy9yeXUtc3RyZWV0LWZpZ2h0ZXItYW5pbWUtaGFkb3VrZW4tZ2lmLTI0NzkwMjA5IiwiaDFfdGl0bGUiOiJSeXUgU3RyZWV0IEZpZ2h0ZXIgQW5pbWUiLCJtZWRpYV9mb3JtYXRzIjp7InRpbnltcDQiOnsidXJsIjoiaHR0cHM6Ly9tZWRpYS50ZW5vci5jb20vWmdGTnVEZExkaklBQUFQMS9yeXUtc3RyZWV0LWZpZ2h0ZXItYW5pbWUubXA0In0sInRpbnlnaWYiOnsidXJsIjoiaHR0cHM6Ly9tZWRpYS50ZW5vci5jb20vWmdGTnVEZExkaklBQUFBTS9yeXUtc3RyZWV0LWZpZ2h0ZXItYW5pbWUuZ2lmIn19fSx7Iml0ZW11cmwiOiJodHRwczovL3Rlbm9yLmNvbS92aWV3L3N1cGVyLXN0cmVldC1maWdodGVyLWlpLS0tc2hvcnQtaW50cm8tc2YyLWdpZi0xNjIzNjk4ODU4MjIwODU2NDg5NiIsImgxX3RpdGxlIjoiU3VwZXIgU3RyZWV0IEZpZ2h0ZXIgSWkgLSBTaG9ydCBJbnRybyBTZjIiLCJtZWRpYV9mb3JtYXRzIjp7InRpbnltcDQiOnsidXJsIjoiaHR0cHM6Ly9tZWRpYS50ZW5vci5jb20vNFZWZkZwaWRicUFBQUFQMS9zdXBlci1zdHJlZXQtZmlnaHRlci1paS0tLXNob3J0LWludHJvLXNmMi5tcDQifSwidGlueWdpZiI6eyJ1cmwiOiJodHRwczovL21lZGlhLnRlbm9yLmNvbS80VlZmRnBpZGJxQUFBQUFNL3N1cGVyLXN0cmVldC1maWdodGVyLWlpLS0tc2hvcnQtaW50cm8tc2YyLmdpZiJ9fX0seyJpdGVtdXJsIjoiaHR0cHM6Ly90ZW5vci5jb20vdmlldy9yeXUtc3RyZWV0LWZpZ2h0ZXItaGFkb3VrZW4tc2hpbmt1dS1maXJlLWJhbGwtZ2lmLTQ5ODY3MzUiLCJoMV90aXRsZSI6IlJ5dSBDaGFyZ2luZyBVcCBUaGF0IFNoaW5rdXUiLCJtZWRpYV9mb3JtYXRzIjp7InRpbnltcDQiOnsidXJsIjoiaHR0cHM6Ly9tZWRpYS50ZW5vci5jb20vYlJaa1I4ZjFuSkFBQUFQMS9yeXUtc3RyZWV0LWZpZ2h0ZXIubXA0In0sInRpbnlnaWYiOnsidXJsIjoiaHR0cHM6Ly9tZWRpYS50ZW5vci5jb20vYlJaa1I4ZjFuSkFBQUFBTS9yeXUtc3RyZWV0LWZpZ2h0ZXIuZ2lmIn19fSx7Iml0ZW11cmwiOiJodHRwczovL3Rlbm9yLmNvbS92aWV3L3J5dS1oYWRvdWtlbi1zdHJlZXQtZmlnaHRlci1wb3dlci1naWYtOTM1Mjc4NyIsImgxX3RpdGxlIjoiUnl1IEhhZG91a2VuIiwibWVkaWFfZm9ybWF0cyI6eyJ0aW55bXA0Ijp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tL2hRQTZqazJGeHdRQUFBUDEvcnl1LWhhZG91a2VuLm1wNCJ9LCJ0aW55Z2lmIjp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tL2hRQTZqazJGeHdRQUFBQU0vcnl1LWhhZG91a2VuLmdpZiJ9fX0seyJpdGVtdXJsIjoiaHR0cHM6Ly90ZW5vci5jb20vdmlldy9yeXUtaGFkb3VrZW4tdHJhbnNwYXJlbnQtZ2lmLWdpZi02ODgxNjYwMTQ4NDU0OTg1ODYxIiwiaDFfdGl0bGUiOiJSeXUgSGFkb3VrZW4gU3RpY2tlciIsIm1lZGlhX2Zvcm1hdHMiOnsidGlueW1wNCI6eyJ1cmwiOiJodHRwczovL21lZGlhLnRlbm9yLmNvbS9YNENSY2NXZkVJVUFBQVAxL3J5dS1oYWRvdWtlbi5tcDQifSwidGlueWdpZiI6eyJ1cmwiOiJodHRwczovL21lZGlhLnRlbm9yLmNvbS9YNENSY2NXZkVJVUFBQUFNL3J5dS1oYWRvdWtlbi5naWYifX19LHsiaXRlbXVybCI6Imh0dHBzOi8vdGVub3IuY29tL3ZpZXcva2l0a2F0LWhhZG91a2VuLWZyaWVuZHpvbmVkLXJ5dS1naWYtOTE4MzA3ODg0MzI5NTc3MzE3OCIsImgxX3RpdGxlIjoiS2l0a2F0IEhhZG91a2VuIiwibWVkaWFfZm9ybWF0cyI6eyJ0aW55bXA0Ijp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tL2YzRFpqYzhNc2ZvQUFBUDEva2l0a2F0LWhhZG91a2VuLm1wNCJ9LCJ0aW55Z2lmIjp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tL2YzRFpqYzhNc2ZvQUFBQU0va2l0a2F0LWhhZG91a2VuLmdpZiJ9fX0seyJpdGVtdXJsIjoiaHR0cHM6Ly90ZW5vci5jb20vdmlldy9yeGQtcmFkaWFudC1ibG9ja2NoYWluLXJhZGlhbnQtZ2lmLTE3NTkxMDU3MDM2MTc4MzExMzIxIiwiaDFfdGl0bGUiOiJSeGQgUmFkaWFudCBCbG9ja2NoYWluIiwibWVkaWFfZm9ybWF0cyI6eyJ0aW55bXA0Ijp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tLzlCXzlMRWtMU0prQUFBUDEvcnhkLXJhZGlhbnQtYmxvY2tjaGFpbi5tcDQifSwidGlueWdpZiI6eyJ1cmwiOiJodHRwczovL21lZGlhLnRlbm9yLmNvbS85Ql85TEVrTFNKa0FBQUFNL3J4ZC1yYWRpYW50LWJsb2NrY2hhaW4uZ2lmIn19fSx7Iml0ZW11cmwiOiJodHRwczovL3Rlbm9yLmNvbS92aWV3L2tlbi1tYXN0ZXJzLXN0cmVldC1maWdodGVyLWtlbi1jYXBjb20tZ2lmLTU1MDg2NjUiLCJoMV90aXRsZSI6IktlbiBNYXN0ZXJzIFN0cmVldCBGaWdodGVyIiwibWVkaWFfZm9ybWF0cyI6eyJ0aW55bXA0Ijp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tL204aGpQaXZtVWdvQUFBUDEva2VuLW1hc3RlcnMtc3RyZWV0LWZpZ2h0ZXIubXA0In0sInRpbnlnaWYiOnsidXJsIjoiaHR0cHM6Ly9tZWRpYS50ZW5vci5jb20vbThoalBpdm1VZ29BQUFBTS9rZW4tbWFzdGVycy1zdHJlZXQtZmlnaHRlci5naWYifX19LHsiaXRlbXVybCI6Imh0dHBzOi8vdGVub3IuY29tL3ZpZXcvc3VwZXItbmludGVuZG8tc3RyZWV0LWZpZ2h0ZXItMi1zdHJlZXQtZmlnaHRlci1paS1yeXUtaGFkb2tlbi1naWYtMjQzNTk1ODkiLCJoMV90aXRsZSI6IlN1cGVyIE5pbnRlbmRvIFN0cmVldCBGaWdodGVyIDIiLCJtZWRpYV9mb3JtYXRzIjp7InRpbnltcDQiOnsidXJsIjoiaHR0cHM6Ly9tZWRpYS50ZW5vci5jb20vVFVFUlktVGtEOThBQUFQMS9zdXBlci1uaW50ZW5kby1zdHJlZXQtZmlnaHRlci0yLm1wNCJ9LCJ0aW55Z2lmIjp7InVybCI6Imh0dHBzOi8vbWVkaWEudGVub3IuY29tL1RVRVJZLVRrRDk4QUFBQU0vc3VwZXItbmludGVuZG8tc3RyZWV0LWZpZ2h0ZXItMi5naWYifX19XX19fX0=');
        window.__fcupGet = async () => '<html><script type="text/x-cache">' + data + '</' + 'script></html>';
        const up = fightcord.modules.get('uploads');
        up.toggleFav({ link: 'https://giphy.com/gifs/fight-3o7TKSjRrfIPjeiVyM', src: 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.mp4', kind: 'gifv' });
        document.querySelectorAll('#fcToasts > *').forEach(t => t.remove());
        up.openPicker(fightcord.app.channelElement().querySelector('.fcupGifBtn'), fightcord.app.chatInput());
        await sleep(300);
        const s = document.querySelector('.fcupSearch'); s.value = 'ryu hadouken'; s.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(4500);` },
    // the website: a GIF in the chat and the GIF picker with KLIPY results
    { name: 'site-gifs', snap: CHANNEL, wait: 9000, run: `
        const lines = [...fightcord.app.channelElement().querySelectorAll('.messageWrapper.chat .line')];
        const ln = lines[lines.length - 1];
        const bc = ln.querySelector('.blocksContainer');
        [...bc.childNodes].forEach(n => { if (!(n.classList && n.classList.contains('fcxEmbed'))) n.remove(); });
        const sp = document.createElement('span'); sp.className = 'regular'; sp.textContent = 'https://static.klipy.com/ii/4e7bea9f7a3371424e6c16ebc93252fe/4b/32/O9HFXrmoebzGM3.gif'; bc.appendChild(sp);
        delete ln.dataset.fcxUrl;
        fightcord.modules.get('chat-extras')._sweep();
        await sleep(3000);
        const cw = fightcord.app.channelElement(); cw.querySelectorAll('.chatContent, .chatContent *').forEach(el => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; });
        const data = atob('eyJyZXN1bHQiOnRydWUsImRhdGEiOnsiZGF0YSI6W3sic2x1ZyI6InN0cmVldC1maWdodGVyLXVwcGVyY3V0LS1rR2V6cGhyNlciLCJ0aXRsZSI6IlN0cmVldCBGaWdodGVyOiBLZW4ncyBVcHBlcmN1dCBvbiBSeXUiLCJmaWxlIjp7InNtIjp7Im1wNCI6eyJ1cmwiOiJodHRwczovL3N0YXRpYy5rbGlweS5jb20vaWkvNGU3YmVhOWY3YTMzNzE0MjRlNmMxNmViYzkzMjUyZmUvNGIvMzIvQUUzWHp5Z2xzMzB2VUoxLm1wNCJ9LCJqcGciOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzRlN2JlYTlmN2EzMzcxNDI0ZTZjMTZlYmM5MzI1MmZlLzRiLzMyLzgxQXduOTVIaW1RWTl4V0JHaS5qcGcifX19fSx7InNsdWciOiJ6YW5naWVmLXphbmdpZWYtYXBwcm92ZXMtLWtHZXpwaHI2VyIsInRpdGxlIjoiWmFuZ2llZiBBcHByb3ZlcyIsImZpbGUiOnsic20iOnsibXA0Ijp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80ZTdiZWE5ZjdhMzM3MTQyNGU2YzE2ZWJjOTMyNTJmZS85OC9hZi84YVBMUk9Td0tHZURGazlYcS5tcDQifSwianBnIjp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80ZTdiZWE5ZjdhMzM3MTQyNGU2YzE2ZWJjOTMyNTJmZS85OC9hZi85SDJ3R2tZRjZnQmRyTS5qcGcifX19fSx7InNsdWciOiJzdHJlZXQtZmlnaHRlci1rZW4tbWFzdGVycy1wcm9wYWdhbmRhLS1rR2V6cGhyNlciLCJ0aXRsZSI6IlN0cmVldCBGaWdodGVyIEtlbiBNYXN0ZXJzIFByb3BhZ2FuZGEiLCJmaWxlIjp7InNtIjp7Im1wNCI6eyJ1cmwiOiJodHRwczovL3N0YXRpYy5rbGlweS5jb20vaWkvNDQ5MzMyNTAwOGQzNGI3YmY4Y2Q2ODEzY2Q1YzE2MTkvOGQvYTAvZm1KWkIxdklMT1hLd2NQLm1wNCJ9LCJqcGciOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzQ0OTMzMjUwMDhkMzRiN2JmOGNkNjgxM2NkNWMxNjE5LzhkL2EwL0pvRG5pVVdNcFZxRlpRVk0uanBnIn19fX0seyJzbHVnIjoidHdlbHZlLXN0cmVldC1maWdodGVyLTEtLWtHZXpwaHI2VyIsInRpdGxlIjoiVHdlbHZlIFN0cmVldCBGaWdodGVyIiwiZmlsZSI6eyJzbSI6eyJtcDQiOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzQ0OTMzMjUwMDhkMzRiN2JmOGNkNjgxM2NkNWMxNjE5Lzg0L2JlL2gzblU3b0YyRU5JMzNaOE1hRy5tcDQifSwianBnIjp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80NDkzMzI1MDA4ZDM0YjdiZjhjZDY4MTNjZDVjMTYxOS84NC9iZS9TN2xscUtVWEpwOThyc2FVb2NSOS5qcGcifX19fSx7InNsdWciOiJzdHJlZXQtZmlnaHRlci1paS1ndWlsZS13aW5zLXNmMi0ta0dlenBocjZXIiwidGl0bGUiOiJTdHJlZXQgRmlnaHRlciBJaSAtIEd1aWxlIFdpbnMgU2YyIiwiZmlsZSI6eyJzbSI6eyJtcDQiOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzQ0OTMzMjUwMDhkMzRiN2JmOGNkNjgxM2NkNWMxNjE5LzA3LzhmLzdZZE5MbnVkYW9DYUpNYy5tcDQifSwianBnIjp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80NDkzMzI1MDA4ZDM0YjdiZjhjZDY4MTNjZDVjMTYxOS8wNy84Zi9uVzJyMXFTQmZEM21IYUpISWNaNi5qcGcifX19fSx7InNsdWciOiJkaGFsc2ltLXN0cmVldC1maWdodGVyLS1rR2V6cGhyNlciLCJ0aXRsZSI6IkRoYWxzaW0gU3RyZWV0IEZpZ2h0ZXIgVmljdG9yeSBEYW5jZSIsImZpbGUiOnsic20iOnsibXA0Ijp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80ZTdiZWE5ZjdhMzM3MTQyNGU2YzE2ZWJjOTMyNTJmZS9hZi9hNS9GcGhNb2M3ZEcxVURyeFh1Ui5tcDQifSwianBnIjp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80ZTdiZWE5ZjdhMzM3MTQyNGU2YzE2ZWJjOTMyNTJmZS9hZi9hNS9LZW1PMFVtdk9wMlguanBnIn19fX0seyJzbHVnIjoic2FnYXQtc2FrdXJhLS1rR2V6cGhyNlciLCJ0aXRsZSI6IlNhZ2F0IHZzLiBTYWt1cmE6IFN0cmVldCBGaWdodGVyIEFscGhhIEJhdHRsZSIsImZpbGUiOnsic20iOnsibXA0Ijp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80ZTdiZWE5ZjdhMzM3MTQyNGU2YzE2ZWJjOTMyNTJmZS84MS8zYi96NmhYa0g1aURrQm5wS1o5amlZVy5tcDQifSwianBnIjp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80ZTdiZWE5ZjdhMzM3MTQyNGU2YzE2ZWJjOTMyNTJmZS84MS8zYi9mTFB5S3FPRHlpcG1Ec3lyM0QuanBnIn19fX0seyJzbHVnIjoic3RyZWV0LWZpZ2h0ZXItY2h1bi1saS0xLS1rR2V6cGhyNlciLCJ0aXRsZSI6IlN0cmVldCBGaWdodGVyIENodW4gTGkgRmFuYXJ0IGluIFJhaW4iLCJmaWxlIjp7InNtIjp7Im1wNCI6eyJ1cmwiOiJodHRwczovL3N0YXRpYy5rbGlweS5jb20vaWkvNGU3YmVhOWY3YTMzNzE0MjRlNmMxNmViYzkzMjUyZmUvZGQvOGEvRjhnbHVlWVVvT2t6Lm1wNCJ9LCJqcGciOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzRlN2JlYTlmN2EzMzcxNDI0ZTZjMTZlYmM5MzI1MmZlL2RkLzhhLzNEM0w5MjhyY0VObDFoLmpwZyJ9fX19LHsic2x1ZyI6ImZpZ2h0LXRocm93LTEtLWtHZXpwaHI2VyIsInRpdGxlIjoiUGl4ZWwgQXJ0IEZpZ2h0IFRocm93IiwiZmlsZSI6eyJzbSI6eyJtcDQiOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzRlN2JlYTlmN2EzMzcxNDI0ZTZjMTZlYmM5MzI1MmZlLzJlLzc0L3RLNGNjZ1hBSjJkZFJ3TFZ3QzMubXA0In0sImpwZyI6eyJ1cmwiOiJodHRwczovL3N0YXRpYy5rbGlweS5jb20vaWkvNGU3YmVhOWY3YTMzNzE0MjRlNmMxNmViYzkzMjUyZmUvMmUvNzQvVDF5R2pZSFBtSU5JLmpwZyJ9fX19LHsic2x1ZyI6ImNhbW15LXNmNi0ta0dlenBocjZXIiwidGl0bGUiOiJDYW1teSBTRjYgRHluYW1pYyBTdHJldGNoIiwiZmlsZSI6eyJzbSI6eyJtcDQiOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzRlN2JlYTlmN2EzMzcxNDI0ZTZjMTZlYmM5MzI1MmZlL2FjLzM0L3pSUWptcXB4UHlDYXJWY0RISjVQLm1wNCJ9LCJqcGciOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzRlN2JlYTlmN2EzMzcxNDI0ZTZjMTZlYmM5MzI1MmZlL2FjLzM0L0Y5WjZiYVFjMlVXcU0uanBnIn19fX0seyJzbHVnIjoia2VuLWtlbi1tYXN0ZXJzLTMtLWtHZXpwaHI2VyIsInRpdGxlIjoiS2VuIE1hc3RlcnM6IFN0cmVldCBGaWdodGVyIEFscGhhIFBvd2VyIiwiZmlsZSI6eyJzbSI6eyJtcDQiOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzRlN2JlYTlmN2EzMzcxNDI0ZTZjMTZlYmM5MzI1MmZlL2RkLzM0L1MyeHA4Tm96aWN0QU5VZy5tcDQifSwianBnIjp7InVybCI6Imh0dHBzOi8vc3RhdGljLmtsaXB5LmNvbS9paS80ZTdiZWE5ZjdhMzM3MTQyNGU2YzE2ZWJjOTMyNTJmZS9kZC8zNC9aSkNsYU1pQUQ4OUhrd080ZWQuanBnIn19fX0seyJzbHVnIjoicnl1LWN5Y2xvcHMtMi0ta0dlenBocjZXIiwidGl0bGUiOiJSeXUgYW5kIEN5Y2xvcHM6IEZyb20gQmF0dGxlIHRvIEJyb3RoZXJob29kIiwiZmlsZSI6eyJzbSI6eyJtcDQiOnsidXJsIjoiaHR0cHM6Ly9zdGF0aWMua2xpcHkuY29tL2lpLzRlN2JlYTlmN2EzMzcxNDI0ZTZjMTZlYmM5MzI1MmZlL2EyL2U5LzFMakJlajlpRGNUZWNJMG4ubXA0In0sImpwZyI6eyJ1cmwiOiJodHRwczovL3N0YXRpYy5rbGlweS5jb20vaWkvNGU3YmVhOWY3YTMzNzE0MjRlNmMxNmViYzkzMjUyZmUvYTIvZTkvZWh1SkVrQ1RJWXZrSXJiSjZwLmpwZyJ9fX19XX19');
        window.__fcupGet = async () => data;
        const up = fightcord.modules.get('uploads');
        document.querySelectorAll('#fcToasts > *').forEach(t => t.remove());
        up.openPicker(cw.querySelector('.fcupGifBtn'), fightcord.app.chatInput());
        await sleep(300);
        const s = document.querySelector('.fcupSearch'); s.value = 'street fighter'; s.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(5000);` },
    // the VS the moment a set is agreed: you accept (the challenge card calls this), or they accept yours
    { name: 'vs-accept-mine', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n));
        const opp = others[6], ms = fightcord.modules.get('match-screens'), before = ms._vsShown();
        fightcord.app.root().acceptChallenge(fightcord.app.activeChannelId(), fightcord.app.users()[opp], 'demo1', 3);
        await sleep(900);
        if (ms._vsShown() !== before + 1) throw new Error('no VS screen right after the accept');` },
    { name: 'vs-accept-theirs', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n));
        const opp = others[6], ms = fightcord.modules.get('match-screens'), before = ms._vsShown();
        fightcord.app.root().connectionCallbacks.onChallengeAccept({ name: opp, id: opp }, fightcord.app.activeChannelId(), 'demo2');
        await sleep(900);
        if (ms._vsShown() !== before + 1) throw new Error('no VS screen right after the accept');` },
    // 2.16 member list: a lobby group, a folded rank group, the ⚔ on the row you point at; and the search
    { name: 'members', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n));
        fightcord.modules.get('lobbies')._demo({ people: [[others[10], 'k1'], [others[15], 'k2'], [others[22], 'k3']], open: false, live: [] });
        const ml = fightcord.modules.get('member-list');
        ml._config.folded = { 'rank-B': true };
        await sleep(2500);
        const st = document.createElement('style'); st.textContent = 'html body .usersListWrapper .userItem.fc-hov > .fcm-qc { display: inline-flex !important; } html body .usersListWrapper .userItem.fc-hov { background: var(--fc-hover, rgba(255,255,255,.05)) !important; }'; document.head.appendChild(st);
        const row = [...document.querySelectorAll('.usersOnlineList .userItem')].find(r => r.querySelector('.fcm-qc') && r.offsetHeight > 20 && !r.classList.contains('fcm-playing')); if (row) row.classList.add('fc-hov');
        const bh = document.querySelector('.usersOnlineList .fcm-gh.folded'); if (bh) bh.scrollIntoView({ block: 'center' });
        await sleep(500);` },
    { name: 'members-search', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n));
        fightcord.modules.get('lobbies')._demo({ people: [[others[10], 'k1'], [others[15], 'k2'], [others[22], 'k3']], open: false, live: [] });
        const ml = fightcord.modules.get('member-list');
        await sleep(1500);
        ml.search('kid');
        await sleep(1500);` },
    // 2.17 settings: the Changed settings page, NEW badges on settings that came with an update
    { name: 'settings-changed', snap: CHANNEL, run: `
        const set = (id, k, v) => { const st = fightcord.config(id); st.data[k] = v; st.save(); };
        set('member-list', 'side', 'right'); set('chat-extras', 'blurMedia', true); set('find-match', 'maxPing', 150); set('hover-cards', 'delay', 600);
        fightcord.modules.get('fightcord').open('changed');
        await sleep(1200);` },
    { name: 'settings-new', snap: CHANNEL, run: `
        fightcord.settings.initSeen();
        const seen = fightcord.config('fightcord-core').data.seenSettings;
        Object.keys(seen).filter(k => /uploads/.test(k)).forEach(k => delete seen[k]);
        fightcord.settings.refresh();
        fightcord.modules.get('fightcord').open('chat');
        await sleep(600);
        const b = document.querySelector('[data-fc-block="uploads"]'); if (b) b.scrollIntoView({ block: 'center' });
        await sleep(800);` },
    // 2.18 profiles: yours in the popout, someone else's on the scout card, the editor
    { name: 'profile-mine', snap: CHANNEL, run: `
        fightcord.modules.get('presence').setProfile({ s: 'Grinding 3rd Strike tonight, FT5s welcome', a: 'Yun main from the Netherlands. Working on my parry timing, always up for long sets.', b: fightcord.app.activeGameId() });
        fightcord.modules.get('profile-card')._show(); await sleep(1200);` },
    { name: 'profile-scout', snap: CHANNEL, run: `
        const n = Object.keys(fightcord.app.users()).filter(x => !fightcord.app.isMe(x) && !fightcord.app.playing(x))[5];
        fightcord.modules.get('presence')._profile(n, { s: 'Looking for Urien players to lab with', a: 'Urien main, 4 years on 3rd Strike. EU, wired.', b: fightcord.app.activeGameId(), bd: ['sets500', 'streak10', 'top100'] });
        fightcord.modules.get('scout').openCard(n, { left: 420, right: 420, top: 90, bottom: 90, width: 0, height: 0 });
        await sleep(1500);` },
    { name: 'profile-edit', snap: CHANNEL, run: `
        fightcord.modules.get('presence').setProfile({ s: 'Grinding 3rd Strike tonight, FT5s welcome', a: 'Yun main from the Netherlands. Working on my parry timing, always up for long sets.', b: fightcord.app.activeGameId() });
        fightcord.modules.get('profile-card')._edit(); await sleep(900);` },
    // 3.7: Edit profile with a look (made-up pictures from static/looks), and a match result card
    { name: 'looks-edit', snap: CHANNEL, run: `
        window.__fcLocalPics = true;
        const o = location.origin.replace('127.0.0.1', 'localhost') + '/dev-harness/static/looks/';
        fightcord.modules.get('presence').setProfile({ s: 'Grinding 3rd Strike tonight, FT5s welcome', a: 'Yun main. Working on my parry timing, always up for long sets.', b: fightcord.app.activeGameId(),
            av: { u: o + 'av-kai.svg' }, bn: { u: o + 'bn-sunset.svg' }, th: ['#ff7a59', '#7c3aed'], fr: 'flame', pn: 'they/them' });
        fightcord.modules.get('profile-card')._edit(); await sleep(1800);` },
    { name: 'result-card', snap: CHANNEL, wait: 7000, run: `
        window.__fcLocalPics = true;
        const o = location.origin.replace('127.0.0.1', 'localhost') + '/dev-harness/static/looks/';
        const me = fightcord.app.me(), opp = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n))[5];
        fightcord.modules.get('presence').setProfile({ av: { u: o + 'av-kai.svg' }, fr: 'flame' });
        fightcord.modules.get('presence')._profile(opp, { s: '', av: { u: o + 'av-mira.svg' }, fr: 'neon' });
        const quark = '1793300094615-4242';
        fightcord.history.add({ opp, quark, at: Date.now() - 60000, rom: 'sfiii3nr1', channel: fightcord.app.activeChannelId(), myChar: 'Ken', oppChar: 'Chun-Li', mine: 3, theirs: 2, ft: 3, result: 'won', ranked: true });
        const list = fightcord.app.channelElement().querySelector('.chatContent .messageWrapper:last-child').parentNode;
        const row = document.createElement('div'); row.className = 'messageWrapper endgame';
        row.innerHTML = '<div class="endgameMessageWrapper"><h3>Ranked match result</h3></div>';
        row.firstChild.__vue__ = { data: { endgame: { name: me, opponent: { name: opp }, playerId: 0, scores: [3, 2], ranked: 3, initialElo: 1488, finalElo: 1503, replayUrl: 'https://replay.fightcade.com/fbneo/sfiii3nr1/' + quark } } };
        list.appendChild(row);
        fightcord.modules.get('result-card').refresh();
        await sleep(4000);
        const cw = fightcord.app.channelElement(); cw.querySelectorAll('.chatContent, .chatContent *').forEach(el => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; });
        await sleep(500);` },
    // the website: someone's profile on their scout card; the member list with search, a lobby group, folded groups and the ⚔
    { name: 'site-profiles', snap: CHANNEL, run: `
        const n = Object.keys(fightcord.app.users()).filter(x => !fightcord.app.isMe(x) && !fightcord.app.playing(x))[5];
        fightcord.modules.get('presence')._profile(n, { s: 'Looking for Urien players to lab with', a: 'Urien main, 4 years on 3rd Strike. Always up for long sets.', b: fightcord.app.activeGameId(), bd: ['sets500', 'streak10', 'top100'] });
        fightcord.modules.get('scout').openCard(n, { left: 420, right: 420, top: 90, bottom: 90, width: 0, height: 0 });
        await sleep(1500);` },
    { name: 'site-members', snap: CHANNEL, run: `
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n));
        fightcord.modules.get('lobbies')._demo({ people: [[others[10], 'k1'], [others[15], 'k2'], [others[22], 'k3']], open: false, live: [] });
        fightcord.modules.get('member-list')._config.folded = { playing: true, 'rank-A': true };
        await sleep(2500);
        const st = document.createElement('style'); st.textContent = 'html body .usersListWrapper .userItem.fc-hov > .fcm-qc { display: inline-flex !important; } html body .usersListWrapper .userItem.fc-hov { background: var(--fc-hover, rgba(255,255,255,.05)) !important; }'; document.head.appendChild(st);
        document.querySelectorAll('.usersOnlineList, .usersOnlineList *').forEach(el => { if (el.scrollTop) el.scrollTop = 0; });
        await sleep(300);
        // the ⚔ on the second row on screen (rows are reordered with CSS, so go by position)
        const rows = [...document.querySelectorAll('.usersOnlineList .userItem')].filter(r => r.querySelector('.fcm-qc') && r.offsetHeight > 20 && !r.classList.contains('fcm-playing'))
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        if (rows[1]) rows[1].classList.add('fc-hov');
        await sleep(300);` },
    // 2.17: an audio file (playing) and a video clip (a real player, no star) in the chat
    { name: 'chat-audio', snap: CHANNEL, run: `
        const cx = fightcord.modules.get('chat-extras'), up = fightcord.modules.get('uploads');
        // made-up sounds: a few tones as a wav, and a 2 s coloured clip recorded from a canvas
        const sr = 22050, oc = new OfflineAudioContext(1, sr * 6, sr);
        [220, 330, 262, 392].forEach((f, i) => { const o = oc.createOscillator(), g = oc.createGain(); o.frequency.value = f; o.connect(g); g.connect(oc.destination);
            g.gain.setValueAtTime(0, i * 1.5); g.gain.linearRampToValueAtTime(0.4, i * 1.5 + 0.05); g.gain.linearRampToValueAtTime(0, i * 1.5 + 1.4); o.start(i * 1.5); o.stop(i * 1.5 + 1.45); });
        const buf = await oc.startRendering(), pcm = buf.getChannelData(0);
        const wav = new DataView(new ArrayBuffer(44 + pcm.length * 2));
        const str = (o, s) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
        str(0, 'RIFF'); wav.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
        wav.setUint32(24, sr, true); wav.setUint32(28, sr * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); str(36, 'data'); wav.setUint32(40, pcm.length * 2, true);
        pcm.forEach((v, i) => wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 32767, true));
        const au = URL.createObjectURL(new Blob([wav.buffer], { type: 'audio/wav' }));
        const cv = document.createElement('canvas'); cv.width = 480; cv.height = 270; const g2 = cv.getContext('2d');
        const mr = new MediaRecorder(cv.captureStream(30), { mimeType: 'video/webm' }), parts = [];
        mr.ondataavailable = (e) => parts.push(e.data);
        let k = 0; const draw = setInterval(() => { g2.fillStyle = 'hsl(' + (k * 6 % 360) + ',60%,35%)'; g2.fillRect(0, 0, 480, 270); g2.fillStyle = '#fff'; g2.font = 'bold 40px sans-serif'; g2.fillText('Round 2', 150, 150); k++; }, 33);
        mr.start(); await sleep(2000); mr.stop(); await sleep(300); clearInterval(draw);
        const vid = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }));
        const lines = [...fightcord.app.channelElement().querySelectorAll('.messageWrapper.chat .line')].slice(-2);
        const put = (ln, text, p) => { const bc = ln.querySelector('.blocksContainer');
            [...bc.childNodes].forEach(n => { if (!(n.classList && n.classList.contains('fcTr'))) n.remove(); });
            const sp = document.createElement('span'); sp.className = 'regular'; sp.textContent = text; bc.appendChild(sp);
            ln.dataset.fcxUrl = text; cx._render(ln, p); };
        put(lines[0], 'https://files.catbox.moe/k3n9td.mp3#Training%20mode%20loop', { kind: 'audio', url: au, name: 'Training mode loop.mp3' });
        put(lines[1], 'https://files.catbox.moe/r2clip.mp4', { kind: 'clip', url: vid });
        await sleep(800);
        lines[0].querySelector('.fcxPlay').click();
        await sleep(2300);
        const cw = fightcord.app.channelElement(); cw.querySelectorAll('.chatContent, .chatContent *').forEach(el => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; });
        lines[1].querySelector('.fcxEmbed').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        if (lines[1].querySelector('.fcxFav')) throw new Error('a clip got a favorite star');
        await sleep(300);` },
    // 2.18: Shift+Enter opens the taller box (the picture), then a check of the sending: one message per line,
    // and a "stop spamming" answer keeps the rest
    { name: 'multiline', snap: CHANNEL, run: `
        const input = fightcord.app.chatInput();
        fightcord.app.setChatText('Looking for long sets tonight:');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
        const ml = fightcord.modules.get('chat-extras')._multi();
        if (!ml) throw new Error('Shift+Enter did not open the taller box');
        ml.ta.value += '3rd Strike, FT5 or FT10\\nEU, wired, any rank\\nPing me or just send a challenge';
        ml.ta.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(500);` },
    { name: 'multiline-send', snap: CHANNEL, run: `
        const input = fightcord.app.chatInput(), cx = fightcord.modules.get('chat-extras');
        // stand-in for Fightcade: Enter sends what's in the box; the third message gets "stop spamming"
        const BR = String.fromCharCode(92) + 'n', NL = String.fromCharCode(10);
        let sent = [], spamAt = 0;
        input.addEventListener('keydown', (e) => { if (e.key !== 'Enter' || e.shiftKey) return; sent.push(input.value);
            if (sent.length === spamAt) { const sp = document.createElement('span'); sp.className = 'spam'; sp.textContent = 'Message not sent. Please stop spamming.';
                fightcord.app.channelElement().querySelector('.chatContent .blocksContainer').appendChild(sp); }
            fightcord.app.setChatText('', false); });
        // a few lines: ONE message, the lines joined with Fightcade's \\n
        cx.openMulti(['one', '', 'two', 'three'].join(NL));
        if (input.style.visibility !== 'hidden') throw new Error('the one-line box should hide');
        cx._multi().ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(700);
        if (sent.length !== 1 || sent[0] !== ['one', '', 'two', 'three'].join(BR)) throw new Error('sent: ' + JSON.stringify(sent));
        if (cx._multi()) throw new Error('the box should close after sending');
        // past 500 characters: more than one message; "stop spamming" on the second keeps the rest
        sent = []; spamAt = 2;
        cx.openMulti(Array.from({ length: 70 }, (_, i) => 'line number ' + i).join(NL));
        cx._multi().ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(2600);
        if (sent.length !== 2) throw new Error('sent ' + sent.length);
        const m = cx._multi();
        if (!m || m.ta.value.split(NL)[0] !== sent[1].split(BR)[0]) throw new Error('the refused message should stay: ' + (m && m.ta.value.slice(0, 40)));
        // Esc: back to one line, the lines kept with \\n
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
        await sleep(200);
        if (cx._multi() || input.style.visibility === 'hidden') throw new Error('Esc did not close it');
        if (input.value !== m.ta.value.split(NL).join(BR)) throw new Error('one-line text: ' + input.value.slice(0, 60));
        // Shift+Enter in a one-line box holding a \\n: a real line in the tall box
        fightcord.app.setChatText('a' + BR + 'b');
        input.setSelectionRange(input.value.length, input.value.length);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
        if (!cx._multi() || cx._multi().ta.value !== ['a', 'b', ''].join(NL)) throw new Error('reopen: ' + JSON.stringify(cx._multi() && cx._multi().ta.value));` },
    // Fightcade's settings open: a click right of the panel must land on Fightcade's .settingsMask (that closes it)
    { name: 'settings-mask', snap: '2026-09-27T16-41-30-settings-street-fighter-iii-3rd-strike-f', run: `
        const sw = document.querySelector('.settingsWrapper'); sw.classList.add('active');
        await sleep(600);
        const desc = (el) => { const out = []; for (let n = el; n && n !== document.body && out.length < 6; n = n.parentElement) out.push(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')); return out.join(' < '); };
        const pts = [[1000, 400], [700, 300], [1200, 700], [900, 150], [1300, 60]];
        const res = pts.map(([x, y]) => x + ',' + y + ': ' + desc(document.elementFromPoint(x, y)));
        if (pts.some(([x, y]) => !document.elementFromPoint(x, y).closest('.settingsMask'))) throw new Error(String.fromCharCode(10) + res.join(String.fromCharCode(10)));` },
    // 2.19 newcomers: a Fightcord player in your channel installed it yesterday -> one welcome line (not twice,
    // and not for someone on their 5th day), and a "New to Fightcord" badge on their card
    { name: 'newcomer-card', snap: CHANNEL, run: `
        const pr = fightcord.modules.get('presence'), ch = fightcord.app.activeChannelId();
        const here = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && (fightcord.app.users()[n].channels || []).indexOf(ch) >= 0);
        const nu = here[4], old = here[9];
        pr._heard(nu, false, 2);
        pr._heard(nu, false, 2);
        pr._heard(old, false, 5);
        await sleep(400);
        if (__spy.bot.length !== 1) throw new Error('bot lines: ' + JSON.stringify(__spy.bot));
        if (__spy.bot[0][0] !== ch || __spy.bot[0][1].indexOf(nu) < 0) throw new Error('wrong line: ' + JSON.stringify(__spy.bot[0]));
        if (!document.querySelector('.chatContent .messageWrapper.bot.fcNew')) throw new Error('the line was not tagged');
        if (pr.newDay(nu) !== 2 || pr.newDay(old) !== 5) throw new Error('days: ' + pr.newDay(nu) + ' ' + pr.newDay(old));
        const cw = fightcord.app.channelElement(); cw.querySelectorAll('.chatContent, .chatContent *').forEach(el => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; });
        fightcord.modules.get('scout').openCard(nu, { left: 900, right: 900, top: 90, bottom: 90, width: 0, height: 0 });
        await sleep(1200);
        if (!document.querySelector('#fcScoutCard .fcBadge.new, .fcBadge.new')) throw new Error('no New to Fightcord badge on the card');` },
    { name: 'thanks', snap: CHANNEL, run: `
        fightcord.modules.get('presence')._heard('SomeoneElse1', false); fightcord.modules.get('presence')._heard('SomeoneElse2', true);
        fightcord.modules.get('welcome')._thankYou();
        await sleep(1600);
        if (!document.getElementById('fcCeleb')) throw new Error('no thank-you');`, keepToasts: true },
    { name: 'rank-up', snap: CHANNEL, run: `
        fightcord.modules.get('progress')._celebrate('C', 'B', 'Street Fighter III 3rd Strike');
        await sleep(1600);
        if (!document.querySelector('#fcCeleb .prgUp .fc-tag')) throw new Error('no rank-up');`, keepToasts: true },
    // 3.0: the new layout (the default now), and Classic for comparison
    // 3.2: the member list with Fightcord statuses, the hover card and the scout card on the new card head
    { name: 'm32-list', snap: CHANNEL, run: `
        const pr = fightcord.modules.get('presence');
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n));
        [[1, 'FT5s only tonight'], [2, 'labbing Urien resets'], [4, 'back from Evo, rusty'], [7, 'Japan server, sorry for the lag']].forEach(([i, s]) => pr._profile(others[i], { s, a: '', b: '' }));
        await sleep(1500);
        const row = document.querySelector('.usersOnlineList .userItem.fcm-row:not(.fcm-playing) .fcm-st');
        if (row) row.closest('.userItem').scrollIntoView({ block: 'center' });
        await sleep(600);` },
    { name: 'm32-hover', snap: CHANNEL, run: `
        const pr = fightcord.modules.get('presence');
        const others = Object.keys(fightcord.app.users()).filter(n => !fightcord.app.isMe(n) && !fightcord.app.playing(n));
        pr._profile(others[5], { s: 'Looking for Urien players to lab with', a: 'Urien main, 4 years on 3rd Strike. EU, wired.', b: '', bd: ['sets500', 'streak10'] });
        await sleep(800);
        const row = [...document.querySelectorAll('.usersOnlineList .userItem')].find(r => ((r.querySelector('.playerName') || {}).textContent || '').trim() === others[5]);
        if (row) { row.scrollIntoView({ block: 'center' }); await sleep(300); fightcord.modules.get('hover-cards')._show(row); }
        await sleep(1200);` },
    { name: 'v3-main', snap: CHANNEL, run: `await sleep(300);` },
    { name: 'v3-classic', snap: CHANNEL, run: `
        const l3 = fightcord.config('layout3'); l3.data.enabled = false; fightcord.modules.get('layout3').update(); await sleep(400);
        if (document.documentElement.classList.contains('dc-refresh') || document.getElementById('l3Title')) throw new Error('Classic still shows the new layout');` },
    { name: 'v3-ash', snap: CHANNEL, run: `fightcord.modules.get('discord-theme').applyLook('ash', false); fightcord.modules.get('layout3').update(); await sleep(600);` },
    { name: 'v3-onyx', snap: CHANNEL, run: `fightcord.modules.get('discord-theme').applyLook('onyx', false); fightcord.modules.get('layout3').update(); await sleep(600);` },
    { name: 'v3-compact', snap: CHANNEL, run: `const l3 = fightcord.config('layout3'); l3.data.density = 'compact'; fightcord.modules.get('layout3').update(); await sleep(500);` },
    // Fightcade's start page: "Start" in the title bar, your panel shrunk to your avatar (no side column under it)
    { name: 'v3-start', snap: LOBBY, run: `
        // (on the start page Fightcade hides the channels, like this)
        document.querySelectorAll('#app > .channelWrapper').forEach(w => { w.style.display = 'none'; });
        fightcord.app.root().activeChannelId = 'about-channel'; fightcord.modules.get('layout3').update(); await sleep(400);
        if (document.querySelector('#l3Title .l3Where b').textContent !== 'Start') throw new Error('title: ' + document.querySelector('#l3Title .l3Where b').textContent);
        if (!document.documentElement.classList.contains('l3-panel-mini')) throw new Error('the panel should be just the avatar here');` },
    { name: 'v3-help', snap: CHANNEL, run: `document.querySelector('#l3Title [data-l3="help"]').click(); await sleep(400);` },
    { name: 'v3-profile', snap: CHANNEL, run: `document.querySelector('#l3Panel [data-l3="me"]').click(); await sleep(300); fightcord.modules.get('profile-card')._show(); await sleep(900);` },
    { name: 'lobby-invite', snap: CHANNEL, run: `const lb = fightcord.modules.get('lobbies'); const id = lb._demo({}); await sleep(600); lb._invite(id); await sleep(800);` },
    // 3.0 lobbies: picture + banner + colour, roles, reactions, a reply, a pin, the hover toolbar
    { name: 'lb3-main', snap: CHANNEL, run: `fightcord.modules.get('lobbies')._demo({ v3: true }); await sleep(900);
        const ln = [...document.querySelectorAll('.fclbLog .ln[data-mid]')].slice(-2)[0];
        ln.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await sleep(300);
        if (!document.querySelector('.fclbTb.on')) throw new Error('no toolbar on hover');
        if (!document.querySelector('.fclbG .rx')) throw new Error('no reactions');
        if (!document.querySelector('.fclbG .rq')) throw new Error('no reply quote');
        if (!document.querySelector('#fclbRail .fclbIco.hasPic')) throw new Error('no lobby picture in the rail');` },
    { name: 'lb3-reply', snap: CHANNEL, run: `fightcord.modules.get('lobbies')._demo({ v3: true }); await sleep(900);
        const ln = [...document.querySelectorAll('.fclbLog .ln[data-mid]')].slice(-1)[0];
        ln.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await sleep(200);
        document.querySelector('.fclbTb [data-tb="reply"]').click(); await sleep(400);
        if (!document.querySelector('.fclbReBar')) throw new Error('no reply bar');
        document.querySelector('.fclbIn').value = 'bring it, I have the bracket ready'; ` },
    { name: 'lb3-pins', snap: CHANNEL, run: `const lb = fightcord.modules.get('lobbies'); lb._demo({ v3: true }); await sleep(900); lb._pins(); await sleep(500);` },
    { name: 'lb3-events', snap: CHANNEL, run: `const lb = fightcord.modules.get('lobbies'); lb._demo({ v3: true }); await sleep(900); lb._tab('events'); await sleep(600);
        if (document.querySelectorAll('.fclbEv').length !== 2) throw new Error('events: ' + document.querySelectorAll('.fclbEv').length);` },
    { name: 'lb3-plan', snap: CHANNEL, run: `const lb = fightcord.modules.get('lobbies'); lb._demo({ v3: true }); await sleep(900); lb._tab('events'); lb._plan(); await sleep(300);
        document.querySelector('.fc-modal [data-f="title"]').value = 'Saturday Oro mirror night'; await sleep(400);` },
    { name: 'lb3-board', snap: CHANNEL, run: `const lb = fightcord.modules.get('lobbies'); lb._demo({ v3: true }); await sleep(900); lb._tab('board'); await sleep(600);
        if (!document.querySelector('.fclbBoard .r.top1 .mk.kg')) throw new Error('no king on top');` },
    { name: 'lb3-settings', snap: CHANNEL, run: `const lb = fightcord.modules.get('lobbies'); lb._demo({ v3: true }); await sleep(900); lb._settings(null, 'look'); await sleep(600);` },
    { name: 'lb3-mods', snap: CHANNEL, run: `const lb = fightcord.modules.get('lobbies'); lb._demo({ v3: true }); await sleep(900); lb._settings(null, 'mods'); await sleep(600);` },
    { name: 'lb3-welcome', snap: CHANNEL, run: `const lb = fightcord.modules.get('lobbies'); lb._demo({ v3: true }); await sleep(900); lb._welcome(); await sleep(900);` },
    { name: 'lb3-member', snap: CHANNEL, run: `fightcord.modules.get('lobbies')._demo({ v3: true }); await sleep(900);
        document.querySelector('.fclbM[data-who="k2"]').click(); await sleep(500);` }
];

// every scene: the made-up chat in view (scrolled to the bottom), no leftover toasts
const PRELUDE = `
    window.__fcbgAlwaysOn = true;          // headless never has focus: keep the animated background drawing
    const w = fightcord.app.channelElement();
    if (w) w.querySelectorAll('.chatContent, .chatContent *').forEach(el => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; });
    document.querySelectorAll('#fcToasts > *').forEach(t => t.remove());
    await sleep(300);`;

/* ------------------------------------------------------- server + browser */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
function serve() {
    return new Promise(res => {
        const srv = http.createServer((req, rsp) => {
            const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
            if (!p.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
            fs.readFile(p, (err, buf) => {
                if (err) { rsp.writeHead(404); rsp.end('not found'); return; }
                rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
                rsp.end(buf);
            });
        });
        srv.listen(0, '127.0.0.1', () => res(srv));
    });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
// Edge relaunches itself from its launcher, so killing the launcher's tree misses the real browser
// (Windows): end every process started with this run's own profile folder
function killTree(proc, profile) {
    try {
        if (process.platform !== 'win32') { proc.kill(); return; }
        const dir = String(profile || '').replace(/'/g, "''");
        require('child_process').spawnSync('powershell', ['-NoProfile', '-Command',
            "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" + dir + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' });
    } catch (e) { /* gone */ }
}

async function launch() {
    const exe = BROWSERS.find(b => fs.existsSync(b));
    if (!exe) throw new Error('no Edge / Chrome found');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fcshots-'));
    const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars',
        '--remote-debugging-port=0', `--window-size=${W},${H}`, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
    // a crash mid-run must not leave the browser behind
    let closed = false;
    const close = () => { if (!closed) { closed = true; killTree(proc, profile); } };
    process.on('exit', close);
    process.on('uncaughtException', (e) => { console.error(e); close(); process.exit(1); });
    return { port: +fs.readFileSync(portFile, 'utf8').split('\n')[0], close };
}
function cdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
    return new Promise((res, rej) => {
        ws.onerror = rej;
        ws.onopen = () => res({
            send: (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
            close: () => ws.close()
        });
    });
}

/* -------------------------------------------------------------------- run */

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const srv = await serve();
    const base = 'http://127.0.0.1:' + srv.address().port + '/dev-harness/snapshot.html';
    const br = await launch();
    let bad = 0;
    try {
        for (const sc of SCENES.filter(s => !ONLY || s.name === ONLY)) {
            const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: 'PUT' })).json();
            const c = await cdp(t.webSocketDebuggerUrl);
            await c.send('Page.enable');
            await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
            await c.send('Page.navigate', { url: base + '?s=' + encodeURIComponent(sc.snap) + '&demo=1' + (sc.view ? '&view=' + sc.view : '') + (sc.q ? '&' + sc.q : '') + (LANG ? '&lang=' + LANG : '') });
            await sleep(sc.wait || 6000);
            const code = `(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                ${PRELUDE}
                ${sc.run}
                ${sc.keepToasts ? '' : "document.querySelectorAll('#fcToasts > *').forEach(t => t.remove()); { const s = document.createElement('style'); s.textContent = '#fcToasts { display: none !important; }'; document.head.appendChild(s); }"}
                document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} });
                await sleep(400);
                return JSON.stringify(window.__demoLeaks ? window.__demoLeaks() : ['demo mode did not load']); })()`;
            const r = await c.send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
            const err = r.result && r.result.exceptionDetails;
            const leaks = err ? ['scene failed: ' + (err.exception && err.exception.description || err.text)] : JSON.parse(r.result.result.value);
            if (leaks.length) {
                bad++;
                console.log('✗ ' + sc.name + ': NOT saved - ' + leaks.slice(0, 5).join(', '));
            } else {
                const shot = await c.send('Page.captureScreenshot', { format: 'png' });
                const file = path.join(OUT, sc.name + '.png');
                fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
                console.log('✓ ' + sc.name + '  ' + Math.round(fs.statSync(file).size / 1024) + ' KB');
            }
            c.close();
            await fetch(`http://127.0.0.1:${br.port}/json/close/${t.id}`).catch(() => {});
        }
    } finally {
        br.close();
        srv.close();
    }
    await sleep(500);
    process.exit(bad ? 1 : 0);
})();
