/**
 * Fightcord streamer mode
 *
 * One switch (Ctrl+Shift+H, /streamer, or Settings -> Streamer mode) for streaming:
 *   - other players' names, avatars and chat messages are blurred (CSS only: Fightcade's own
 *     text is never changed), your e-mail is hidden; your own name and messages stay
 *   - feed and friend pop-ups (which name people) stay quiet
 *   - incoming challenges queue up, one card at a time, none mid-match (challenge-card.js)
 *   - a red LIVE pill in the channel header, click it to switch off
 *
 * Plus an optional OBS overlay: a tiny web server on 127.0.0.1 only (GET only) that serves a
 * scoreboard page -- you vs your opponent, ranks, the score and tonight's record -- to
 * add in OBS as a Browser Source.
 *
 * Event: 'streamer' (on: boolean). Other modules: fc.modules.get('streamer').active() / .quiet()
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // streamer-config.json

// translated text (plain English in the unit tests, which run without Fightcade)
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const E = (s) => fc.fmt.esc(s);
const mod = (id) => fc.modules.get(id);
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');

/* ------------------------------------------------------------------- hiding */

// other players' names: Fightcade's spots, then Fightcord's
const NAMES = [
    '.playerName', '.messageWrapper header .author', '.blocks .user', '.matchItem .playerName',
    '.challengeWrapper .title', '.challengeContent .userInfo .name', '.wrapUpWrapper', '.endgameMessageWrapper h3',
    '.challengeError .title', '.notification-challenge .challenger .name', '.notification-mention .header',
    '.floatingNotificationsWrapper .content',
    '.ccP.them b', '.fcsc-name', '.hcName', '.hcPlay b', '.fdName', '.frName', '.fcdLiveN b', '.fcdGSide b',
    '.fcsSet .o', '.fcsStats .who .nm', '.fcm-live', '.fcinF', '#fcmsSession td.o', '.fcfmName', '.ntEditWho'
];
const AVATARS = ['img.avatar', '.avatarWrapper img', '.fc-avatar img', '.matchItem img.image', '.pcFriends img'];
const OPP = ['#fcmsOverlay .player .pname', '#fcmsOverlay .sub'];

function css() {
    const me = fc.app.me();
    const q = me ? (window.CSS && CSS.escape ? CSS.escape(me) : me.replace(/["\\]/g, '\\$&')) : '';
    const blur = 'filter: blur(6px) !important; user-select: none !important;';
    const sel = (on, list) => list.map(s => 'html.fc-streamer.' + on + ' ' + s).join(',\n');
    // your own rows stay readable
    const mine = q ? `
html.fc-streamer [data-current-user="${q}"] .author, html.fc-streamer [data-current-user="${q}"] .playerName,
html.fc-streamer [data-current-user="${q}"] img, html.fc-streamer [data-current-user="${q}"] .blocksContainer,
html.fc-streamer .ccP.me img, html.fc-streamer .userAvatarWrapper img { filter: none !important; }` : '';
    return `
${sel('fc-st-names', NAMES)} { ${blur} }
${sel('fc-st-avatars', AVATARS)} { ${blur} }
${sel('fc-st-chat', ['.messageWrapper:not(.motd) .blocksContainer', '.fdText'])} { ${blur} }
${sel('fc-st-opp', OPP)} { ${blur} }
html.fc-streamer .userEmail, html.fc-streamer .userEmailWrapper { filter: blur(8px) !important; }
${mine}
.fcstPill { display: inline-flex; align-items: center; height: 32px; padding: 0 10px; margin-right: 8px; border-radius: var(--fc-r1);
    background: #d83c3e; color: #fff; font: 800 12px/32px var(--fc-font); letter-spacing: .06em; text-transform: uppercase; cursor: pointer; user-select: none; }
.fcstPill i { width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: #fff; animation: fcstBlink 1.6s ease-in-out infinite; }
@keyframes fcstBlink { 50% { opacity: .3; } }
.fcstUrl { display: flex; align-items: center; }
.fcstUrl code { flex: 1; min-width: 0; padding: 6px 8px; margin-right: 8px; border-radius: 6px; background: var(--fc-s2, rgba(0,0,0,.25)); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
.fcstErr { margin-top: 6px; font-size: 12.5px; color: var(--fc-danger); }
`;
}

const active = () => !!(cfg && cfg.on);
// pop-ups that name other players should stay quiet
const quiet = () => active() && cfg.muteToasts !== false;

function apply() {
    const h = document.documentElement;
    const on = active();
    h.classList.toggle('fc-streamer', on);
    h.classList.toggle('fc-st-names', on && cfg.names);
    h.classList.toggle('fc-st-avatars', on && cfg.avatars);
    h.classList.toggle('fc-st-chat', on && cfg.chat);
    h.classList.toggle('fc-st-opp', on && cfg.names && !cfg.keepOpp);
    fc.ui.style('fcstStyle', css());
    refreshPill();
}

function setOn(on, quietly) {
    cfg.on = !!on;
    store.save();
    apply();
    fc.emit('streamer', cfg.on);
    fc.settings.refresh('streamer');
    if (!quietly) fc.ui.toast(cfg.on ? T('Streamer mode on') : T('Streamer mode off'),
        { sub: cfg.on ? T('Names, avatars and chat are blurred. Ctrl+Shift+H to switch off.') : '', icon: 'eye', ms: 3500 });
}

function refreshPill() {
    document.querySelectorAll('.channelToolbar .channelActions').forEach(actions => {
        let pill = actions.querySelector(':scope > .fcstPill');
        if (!active()) { if (pill) pill.remove(); return; }
        if (pill) return;
        pill = document.createElement('div');
        pill.className = 'fcstPill';
        pill.title = T('Streamer mode is on — click to switch it off (Ctrl+Shift+H)');
        pill.innerHTML = `<i></i>${E(T('LIVE'))}`;
        pill.addEventListener('mousedown', (e) => e.stopPropagation());
        pill.addEventListener('click', (e) => { e.stopPropagation(); setOn(false); });
        actions.insertBefore(pill, actions.firstChild);
    });
}

function onKeyDown(e) {
    if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'H' || e.key === 'h' || e.code === 'KeyH')) {
        e.preventDefault();
        e.stopPropagation();
        setOn(!cfg.on);
    }
}

/* ------------------------------------------------------------- OBS overlay */

// what the overlay shows (pure, so it can be tested)
// m: { me, myRank, myCc, opp, oppRank, oppCc, game, ft, score: {mine, theirs} | null, session: {w, l}, showOpp }
function overlayState(m) {
    const o = m || {};
    const playing = !!o.opp;
    return {
        playing,
        game: o.game || '',
        ft: o.ft || null,
        me: { name: o.me || '', rank: o.myRank || '', cc: o.myCc || '' },
        opp: playing ? { name: o.showOpp === false ? T('Opponent') : o.opp, rank: o.oppRank || '', cc: o.showOpp === false ? '' : (o.oppCc || '') } : null,
        score: playing && o.score ? { mine: +o.score.mine || 0, theirs: +o.score.theirs || 0 } : null,
        session: o.session && (o.session.w || o.session.l) ? { w: o.session.w || 0, l: o.session.l || 0 } : null,
        labels: { tonight: T('Tonight'), waiting: T('Waiting for a match'), vs: 'VS' }
    };
}

const live = { quark: null, score: null, at: 0, busy: false };

function gather() {
    const me = fc.app.me();
    const meU = fc.app.user(me)[1] || {};
    const pl = fc.app.playing(me);
    const ch = pl ? fc.app.channel(pl.channelId) : null;
    const chName = ch ? ch.name : '';
    const rankOf = (u) => fc.data.rankLetter(+((u && u.channelRank) || {})[chName] || +((u && u.channelRank) || {})[pl && pl.channelId] || 0);
    let opp = null, oppU = null;
    if (pl) {
        const all = fc.app.users();
        opp = Object.keys(all).find(n => n !== me && all[n] && all[n].playing && all[n].playing.quarkId === pl.quarkId) || null;
        oppU = opp ? all[opp] : null;
    }
    const ms = mod('match-screens');
    let session = null;
    try {
        if (ms && ms._history) session = ms._history.recordOf(ms._history.sessionSets());
    } catch (e) { session = null; }
    const scout = mod('scout');
    const ft = opp && scout && scout.knownFt ? scout.knownFt(opp.toLowerCase()) : null;
    if (pl && live.quark !== pl.quarkId) { live.quark = pl.quarkId; live.score = null; live.at = 0; }
    return overlayState({
        me, myRank: pl ? rankOf(meU) : '', myCc: String((meU.country && meU.country.iso_code) || '').toLowerCase(),
        opp, oppRank: opp ? rankOf(oppU) : '', oppCc: String((oppU && oppU.country && oppU.country.iso_code) || '').toLowerCase(),
        game: shortName(chName), ft: typeof ft === 'number' && ft > 0 ? ft : null,
        score: pl && live.quark === pl.quarkId ? live.score : null,
        session, showOpp: cfg.overlayOpp !== false
    });
}

// the running set's score from Fightcade's match list, every 15 s (same as Discord status)
function pollScore() {
    if (!cfg.overlay || live.busy) return;
    const me = fc.app.me();
    const pl = fc.app.playing(me);
    if (!pl) return;
    if (live.quark !== pl.quarkId) { live.quark = pl.quarkId; live.score = null; live.at = 0; }
    if (Date.now() - live.at < 15000) return;
    live.busy = true;
    live.at = Date.now();
    const quark = pl.quarkId;
    fc.api.quarks({ quarkid: quark }, { ttl: 10000, priority: 'low' }).then(rows => {
        const row = rows && rows[0];
        const players = row && Array.isArray(row.players) ? row.players : [];
        const mine = players.find(p => fc.app.isMe(p.name));
        const theirs = players.find(p => p !== mine);
        if (mine && theirs && live.quark === quark) live.score = { mine: +mine.score || 0, theirs: +theirs.score || 0 };
    }).catch(() => {}).then(() => { live.busy = false; });
}

const OVERLAY_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Fightcord overlay</title><style>
html,body{margin:0;background:transparent;font-family:'Segoe UI',system-ui,sans-serif;color:#fff;overflow:hidden}
#b{display:inline-flex;flex-direction:column;align-items:stretch;margin:8px;padding:10px 14px;border-radius:12px;background:rgba(13,15,31,.82);box-shadow:0 0 0 1px rgba(255,255,255,.08),0 0 24px rgba(79,99,240,.35)}
.row{display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;white-space:nowrap}
.p{display:flex;align-items:center}
.r{display:inline-block;min-width:20px;margin:0 6px;padding:0 4px;border-radius:4px;background:#4f63f0;font-size:14px;line-height:20px;text-align:center}
.sc{margin:0 14px;padding:0 10px;border-radius:8px;background:rgba(255,255,255,.1);font-variant-numeric:tabular-nums}
.vs{margin:0 14px;color:#22e3f2;font-style:italic}
.sub{margin-top:4px;font-size:13px;font-weight:600;color:#a8aed6;text-align:center;white-space:nowrap}
.hide{display:none}
</style></head><body><div id="b"><div class="row"><span class="p" id="me"></span><span class="sc hide" id="sc"></span><span class="vs hide" id="vs">VS</span><span class="p" id="op"></span></div><div class="sub" id="sub"></div></div>
<script>
function side(el,p,rev){el.textContent='';if(!p)return;var n=document.createElement('span');n.textContent=p.name;var r=null;if(p.rank){r=document.createElement('span');r.className='r';r.textContent=p.rank}var parts=rev?[r,n]:[n,r];parts.forEach(function(x){if(x)el.appendChild(x)})}
function draw(s){side(document.getElementById('me'),s.me,true);side(document.getElementById('op'),s.opp,false);
var sc=document.getElementById('sc'),vs=document.getElementById('vs');
if(s.playing&&s.score){sc.textContent=s.score.mine+' \\u2013 '+s.score.theirs;sc.classList.remove('hide');vs.classList.add('hide')}
else if(s.playing){sc.classList.add('hide');vs.classList.remove('hide')}else{sc.classList.add('hide');vs.classList.add('hide')}
var bits=[];if(s.game)bits.push(s.game);if(s.playing&&s.ft)bits.push('FT'+s.ft);if(s.session)bits.push(s.labels.tonight+' '+s.session.w+'\\u2013'+s.session.l);if(!s.playing&&!s.session)bits.push(s.labels.waiting);
document.getElementById('sub').textContent=bits.join(' \\u00b7 ')}
function tick(){fetch('state.json',{cache:'no-store'}).then(function(r){return r.json()}).then(draw).catch(function(){}).then(function(){setTimeout(tick,1000)})}
tick();
</script></body></html>`;

let server = null, serverErr = '', serverPort = 0;

function hostOk(host, port) {
    return host === '127.0.0.1:' + port || host === 'localhost:' + port;
}

function handle(req, res) {
    // only this PC, only reads (and no page on the web can talk to it through a renamed host)
    if (req.method !== 'GET' || !hostOk(String(req.headers.host || ''), serverPort)) { res.writeHead(403); res.end(); return; }
    const url = String(req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(OVERLAY_HTML);
    } else if (url === '/state.json') {
        let body;
        try { body = JSON.stringify(gather()); } catch (e) { body = '{}'; }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(body);
    } else { res.writeHead(404); res.end(); }
}

function stopServer() {
    if (server) { try { server.close(); } catch (e) { /* already closed */ } }
    server = null;
    serverPort = 0;
}

function syncServer() {
    const want = cfg.overlay ? Math.max(1024, Math.min(65535, +cfg.port || 7979)) : 0;
    if (want === serverPort && (server || !want)) return;
    stopServer();
    serverErr = '';
    if (!want) { fc.settings.refresh('streamer'); return; }
    let http;
    try { http = require('http'); } catch (e) { serverErr = T('The overlay needs Fightcade’s desktop app.'); fc.settings.refresh('streamer'); return; }
    const s = http.createServer(handle);
    s.on('error', (e) => {
        serverErr = e && e.code === 'EADDRINUSE' ? T('Port {port} is already in use: pick another one.', { port: want }) : String((e && e.message) || e);
        if (server === s) { server = null; serverPort = 0; }
        fc.settings.refresh('streamer');
    });
    s.listen(want, '127.0.0.1', () => fc.settings.refresh('streamer'));
    server = s;
    serverPort = want;
}

const overlayUrl = () => 'http://127.0.0.1:' + (Math.max(1024, Math.min(65535, +cfg.port || 7979))) + '/';

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('streamer', {
        on: false, names: true, avatars: true, chat: true, keepOpp: true, muteToasts: true,
        overlay: false, port: 7979, overlayOpp: true
    });
    cfg = store.data;
    apply();
    window.addEventListener('keydown', onKeyDown, true);
    fc.own(() => {
        window.removeEventListener('keydown', onKeyDown, true);
        ['fc-streamer', 'fc-st-names', 'fc-st-avatars', 'fc-st-chat', 'fc-st-opp'].forEach(c => document.documentElement.classList.remove(c));
        fc.ui.style('fcstStyle', null);
        document.querySelectorAll('.fcstPill').forEach(p => p.remove());
        stopServer();
    });
    fc.watch(refreshPill, { selector: '.channelToolbar' });
    fc.tick(pollScore, 3000, { whileHidden: true });
    fc.cmd('streamer', 'Streamer mode on / off (blur names and chat)', () => setOn(!cfg.on));
    // my name can arrive after start: rebuild the "your own rows stay readable" rules
    setTimeout(apply, 4000);
    syncServer();

    fc.settings.section('streamer', 'Streamer mode', 'eye', 85);
    fc.settings.block({
        id: 'streamer', section: 'streamer', title: 'Streamer mode', hint: '— Ctrl+Shift+H',
        store, order: 10, onReset: () => { apply(); syncServer(); },
        fields: [
            { key: 'on', type: 'switch', label: 'Streamer mode', hint: 'Blur other players on screen while you stream', onChange: (v) => setOn(v, true) },
            { key: 'names', type: 'switch', label: 'Blur names', onChange: apply },
            { key: 'avatars', type: 'switch', label: 'Blur avatars', onChange: apply },
            { key: 'chat', type: 'switch', label: 'Blur chat messages', hint: 'Yours stay readable', onChange: apply },
            { key: 'keepOpp', type: 'switch', label: 'Show your opponent on the VS and result screens', show: (d) => d.names, onChange: apply },
            { key: 'muteToasts', type: 'switch', label: 'Mute feed and friend pop-ups', hint: 'They name other players' },
            { type: 'note', label: 'Challenges queue up while streamer mode is on: one card at a time, in the order they came in, and none mid-match.' }
        ]
    });
    fc.settings.block({
        id: 'streamer-overlay', section: 'streamer', title: 'OBS overlay', hint: '— a scoreboard for your stream',
        store, order: 20, reset: false,
        fields: [
            { key: 'overlay', type: 'switch', label: 'OBS overlay', hint: 'You vs your opponent, ranks, the score and tonight’s record', onChange: syncServer },
            { type: 'html', id: 'url', show: (d) => d.overlay, onClick: (e) => { if (e.target.closest('[data-act="copy"]')) { fc.ui.copy(overlayUrl()); fc.ui.toast(T('Copied'), { icon: 'copy', ms: 1500 }); } },
                html: () => `<div class="fcstUrl"><code>${E(overlayUrl())}</code>${fc.ui.btn('Copy', { kind: 'sec', size: 'sm', icon: 'copy', act: 'copy' })}</div>` +
                    `<div class="fc-note">${E(T('In OBS: Sources → + → Browser, paste the address, width 800, height 120. Only this PC can open it.'))}</div>` +
                    (serverErr ? `<div class="fcstErr">${E(serverErr)}</div>` : '') },
            { key: 'overlayOpp', type: 'switch', label: 'Show your opponent’s name', show: (d) => d.overlay },
            { key: 'port', type: 'number', label: 'Port', hint: 'Change it if another program uses 7979', show: (d) => d.overlay, onChange: syncServer }
        ]
    });
    return api;
}

const api = {
    active: () => active(),
    quiet: () => quiet(),
    set: (on) => setOn(on),
    overlayUrl: () => overlayUrl(),
    _state: () => gather(),
    _server: () => ({ port: serverPort, error: serverErr, running: !!server }),
    get _config() { return cfg; }
};

module.exports = { id: 'streamer', name: 'Streamer mode', start, overlayState, hostOk, NAMES };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
