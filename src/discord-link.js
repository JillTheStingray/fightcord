/**
 * Discord challenges -- challenge people on Fightcade from your Discord server
 *
 * The server runs the Fightcord bot (fightcord-discord-bot, a Cloudflare Worker). You link once:
 * Settings -> Scout & challenges -> Discord shows a code, you type /link CODE in the server. After
 * that this Fightcord keeps one WebSocket to the bot, and the bot can ask it exactly two things:
 *   ping  -> who you are, the game channel you have open, your game channels, in a match / away
 *   go    -> 'send': join the game channel and challenge the opponent (a /challenge YOU typed)
 *            'take': join it and accept the opponent's challenge when it comes (a challenge YOU
 *            accepted in Discord) -- only that one: from them, in that channel, within 90 s
 * Fightcade then starts the match as usual. The bot can't make Fightcord do anything else.
 * The socket proves itself with an HMAC of the link secret, which only this PC and the bot know.
 */
'use strict';

const crypto = (() => { try { return require('crypto'); } catch (e) { return null; } })();

let fc = null;
let store = null, cfg = null;            // discord-link-config.json
const T = (s, v) => fc ? fc.t(s, v) : fill(s, v);
const N_ = (s) => s;
const lc = (s) => String(s || '').toLowerCase();
const mod = (id) => fc.modules.get(id);
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
// what goes back to the bot is shown in Discord: plain English, not translated
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));

// the server's bot (Settings can point at another one)
const BOT_URL = 'https://fightcord-bot.xavierthekotzebue.workers.dev';
const ARM_MS = 90000;                    // how long a Discord Accept waits for the challenge
const BEAT_MS = 45000;                   // keep-alive

/* ================================================================ pure parts */

const macOf = (s, id, t) => crypto.createHmac('sha256', Buffer.from(s, 'hex')).update(id + '|' + t).digest('hex');
function socketUrl(base, id, s, now) {
    const t = String(now);
    return String(base).replace(/\/+$/, '').replace(/^http/, 'ws') + '/ws?id=' + id + '&t=' + t + '&m=' + macOf(s, id, t);
}
const validBase = (u) => /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(String(u || ''));
// only the site part of the address: people paste the /interactions one meant for Discord
const siteOf = (u) => { const m = /^(https?:\/\/[^\s/?#]+)/.exec(String(u || '').trim()); return m ? m[1] : String(u || '').trim(); };

// One linked Fightcord's side of the conversation, without any network or DOM.
//   d: { status() -> st | null, on() -> bool, now(), join(ch) -> Promise<bool>, select(ch),
//        inGame(name, ch) -> bool, wait(test, ms) -> Promise<bool>, challenge(name, ft, ch) -> { ok, why },
//        gameName(ch), say(kind, vars) (a toast), linked(who), unlinked(), send(msg) }
// handle(m) -> Promise of the answer to send back (or null)
function Agent(d) {
    const a = { armed: null };
    const no = (why, v) => ({ t: 'done', ok: false, why: fill(why, v) });
    a.matches = (ctx) => {
        const w = a.armed;
        return !!(w && d.now() <= w.until && lc(ctx.name) === w.opp && (!ctx.channel || ctx.channel === w.ch));
    };
    // the challenge pipeline: the armed one is trusted (no filter declines it), then accepted
    a.filter = (ctx) => { if (a.matches(ctx)) ctx.trusted = 'discord'; };
    a.take = (ctx) => {
        if (ctx.trusted !== 'discord' || !a.matches(ctx)) return null;
        const w = a.armed;
        a.armed = null;
        d.send({ t: 'took', cid: w.cid });
        return w;
    };
    async function go(m) {
        const opp = String(m.opp || ''), ch = String(m.ch || ''), game = d.gameName(ch);
        if (!opp || !ch) return no('Something was missing.');
        if (!d.on()) return no('Challenges from Discord are off in Fightcord.');
        const st = d.status();
        if (!st) return no('Fightcade isn\'t logged in.');
        if (st.inMatch) return no('{name} is in a match right now.', { name: st.name });
        if (!(await d.join(ch))) return no('{name} couldn\'t join {game} in Fightcade.', { name: st.name, game });
        d.select(ch);
        if (m.role === 'take') {
            a.armed = { opp: lc(opp), ch, cid: String(m.cid || ''), until: d.now() + ARM_MS };
            d.say('take', { name: opp, game });
            return { t: 'done', ok: true };
        }
        if (m.role !== 'send') return no('Something was missing.');
        d.say('send', { name: opp, game });
        if (!(await d.wait(() => d.inGame(opp, ch), 9000))) return no('{name} didn\'t show up in {game}.', { name: opp, game });
        const r = d.challenge(opp, Number.isInteger(m.ft) ? m.ft : undefined, ch) || {};
        return r.ok ? { t: 'done', ok: true } : no(r.why || 'Fightcade didn\'t take the challenge.');
    }
    a.handle = async (m) => {
        if (!m || typeof m !== 'object') return null;
        if (m.t === 'ping') return { t: 'pong', q: m.q, st: d.status() };
        if (m.t === 'go') return Object.assign({ q: m.q }, await go(m));
        if (m.t === 'disarm') { if (a.armed && a.armed.cid === m.cid) a.armed = null; return null; }
        if (m.t === 'linked') { d.linked(String(m.who || '').slice(0, 40)); return null; }
        if (m.t === 'unlinked') { d.unlinked(); return null; }
        if (m.t === 'asked') { d.say('asked', { name: String(m.from || ''), game: String(m.game || ''), ft: m.ft }); return null; }
        if (m.t === 'news' && (m.kind === 'declined' || m.kind === 'expired')) { d.say(m.kind, { name: String(m.opp || '') }); return null; }
        return null;
    };
    return a;
}

/* ================================================================= the link */

let ws = null, wsTimer = 0, beat = 0, tries = 0, lastPong = 0, agent = null, pending = null;
const base = () => siteOf(cfg.url || BOT_URL || '');

function post(pathName, body) {
    return new Promise((resolve, reject) => {
        const url = base() + pathName;
        let mod2;
        try { mod2 = require(url.indexOf('http:') === 0 ? 'http' : 'https'); } catch (e) { reject(new Error('no network here')); return; }
        const data = JSON.stringify(body);
        const req = mod2.request(url, { method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': 'Fightcord' } }, (res) => {
            let s = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { s += c; });
            res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(new Error(res.statusCode === 200 ? 'that address isn\'t the bot' : 'the bot answered ' + res.statusCode)); } });
        });
        req.on('timeout', () => req.destroy(new Error('the bot didn\'t answer')));
        req.on('error', reject);
        req.end(data);
    });
}

function status() {
    const me = fc.app.me();
    if (!me) return null;
    const [, u] = fc.app.user(me);
    const act = fc.app.activeChannel();
    return {
        name: me, ch: (act && act.id) || '', chName: shortName(act && act.name),
        games: fc.app.joinedChannels().slice(0, 25).map(c => ({ id: c.id, name: shortName(c.name) })),
        inMatch: fc.app.inMatch(me), away: !!(u && u.away), off: !cfg.challenges
    };
}

function joinGame(ch) {
    if (fc.app.channel(ch)) return Promise.resolve(true);
    const r = fc.app.root();
    if (!r || typeof r.joinChannel !== 'function') return Promise.resolve(false);
    try { r.joinChannel(ch); } catch (e) { fc.log.warn('discord join channel', e.message); return Promise.resolve(false); }
    return waitFor(() => !!fc.app.channel(ch), 5000);
}
function waitFor(test, ms) {
    return new Promise(done => {
        const t0 = Date.now();
        const tick = () => { if (test()) done(true); else if (Date.now() - t0 > ms) done(false); else setTimeout(tick, 400); };
        tick();
    });
}
const inGame = (name, ch) => { const u = fc.app.userInfo(name); return !!(u && u.channels.indexOf(ch) >= 0 && fc.app.channel(ch)); };

const SAY = {
    asked: [N_('{name} challenged you in Discord'), N_('{game} · press Accept there and Fightcade takes it from here')],
    take: [N_('You accepted {name} in Discord'), N_('{game}: their challenge is on its way and gets accepted for you')],
    send: [N_('Challenging {name} from Discord'), N_('{game}: waiting for them in the channel')],
    declined: [N_('{name} declined in Discord'), ''],
    expired: [N_('{name} didn’t answer in Discord'), N_('The challenge ran out after 2 minutes')]
};
function say(kind, v) {
    const s = SAY[kind];
    if (!s) return;
    const vars = Object.assign({}, v, { game: v.game || T('the game') });
    fc.ui.toast(T(s[0], vars), { icon: kind === 'declined' || kind === 'expired' ? 'close' : 'swords', ms: kind === 'asked' ? 12000 : 7000, sub: s[1] ? T(s[1], vars) : '' });
}

function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function connect() {
    disconnect();
    const l = cfg.link;
    if (!crypto || typeof WebSocket === 'undefined' || !l || !l.id || !l.s || !validBase(base())) return;
    let sock;
    try { sock = new WebSocket(socketUrl(base(), l.id, l.s, Date.now())); } catch (e) { retry(); return; }
    ws = sock;
    sock.onopen = () => { tries = 0; lastPong = Date.now(); refresh(); };
    sock.onmessage = async (e) => {
        if (e.data === 'pong') { lastPong = Date.now(); return; }
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        lastPong = Date.now();
        if (m && m.t === 'unknown') { forget(cfg.link && cfg.link.who ? 'gone' : 'expired'); return; }
        const answer = await agent.handle(m);
        if (answer && sock === ws) send(answer);
    };
    sock.onerror = () => {};
    sock.onclose = (e) => {
        if (sock !== ws) return;
        ws = null;
        // the bot doesn't know this link (unlinked while we were away, or a code that ran out)
        if (e && e.code === 4401) { forget(cfg.link && cfg.link.who ? 'gone' : 'expired'); return; }
        refresh();
        retry();
    };
    beat = setInterval(() => {
        if (!ws || ws.readyState !== 1) return;
        if (Date.now() - lastPong > BEAT_MS * 2.5) { try { ws.close(); } catch (e) { /* gone */ } return; }
        try { ws.send('ping'); } catch (e) { /* closing */ }
    }, BEAT_MS);
}
function retry() {
    clearTimeout(wsTimer);
    if (!cfg.link) return;
    wsTimer = setTimeout(connect, Math.min(300000, 5000 * Math.pow(2, tries++)));
}
function disconnect() {
    clearTimeout(wsTimer);
    clearInterval(beat);
    const s = ws;
    ws = null;
    if (s) try { s.close(1000); } catch (e) { /* gone */ }
}

// a new code: a fresh link id and secret, then the socket waits for /link
async function makeCode() {
    if (!crypto) return;
    if (!validBase(base())) { fc.ui.toast(T('Set the bot’s address first'), { kind: 'warning', icon: 'link' }); return; }
    const me = fc.app.me();
    if (!me) { fc.ui.toast(T('Log in to Fightcade first'), { kind: 'warning', icon: 'link' }); return; }
    const id = crypto.randomBytes(12).toString('hex'), s = crypto.randomBytes(32).toString('hex');
    pending = { busy: true };
    refresh();
    try {
        const r = await post('/offer', { id, s, name: me });
        if (!r || !r.code) throw new Error((r && r.error) || 'no code');
        if (cfg.link && cfg.link.who) unlinkHere(true);
        cfg.link = { id, s, who: '' };
        store.save();
        pending = { code: r.code, exp: r.exp };
        connect();
    } catch (e) {
        pending = null;
        fc.ui.toast(T('Couldn’t reach the Discord bot'), { kind: 'warning', icon: 'link', sub: e.message });
    }
    refresh();
}
// unlink from here: tell the bot (best effort), forget it here
function unlinkHere(quiet) {
    const l = cfg.link;
    if (l && l.who && validBase(base())) { const t = String(Date.now()); post('/unlink', { id: l.id, t, m: macOf(l.s, l.id, t) }).catch(() => {}); }
    cfg.link = null;
    pending = null;
    store.save();
    disconnect();
    if (!quiet) fc.ui.toast(T('Unlinked from Discord'), { icon: 'link' });
    refresh();
}
function forget(why) {
    cfg.link = null;
    pending = null;
    store.save();
    disconnect();
    if (why === 'gone') fc.ui.toast(T('Discord unlinked this Fightcord'), { icon: 'link', sub: T('Make a new code to link again') });
    refresh();
}
function linked(who) {
    if (!cfg.link) return;
    cfg.link.who = who || 'Discord';
    pending = null;
    store.save();
    fc.ui.toast(T('Linked to Discord as {name}', { name: cfg.link.who }), { kind: 'success', icon: 'link', sub: T('Challenge people there with /challenge') });
    refresh();
}

const refresh = () => { if (fc) fc.settings.refresh('discord-link'); };

function stateHtml() {
    const E = (s) => fc.fmt.esc(s);
    const l = cfg.link;
    if (pending && pending.busy) return `<div class="fc-note">${E(T('Asking the bot for a code…'))}</div>`;
    if (pending && pending.code && pending.exp > Date.now()) {
        return `<div class="dlCode"><b>${E(pending.code)}</b><span>${E(T('In your Discord server, type /link {code}. The code lasts 10 minutes.', { code: pending.code }))}</span></div>`;
    }
    if (l && l.who) {
        const on = ws && ws.readyState === 1;
        return `<div class="fc-note">${E(T('Linked to {name}', { name: l.who }))} · <span class="${on ? 'dlOn' : 'dlOff'}">${E(T(on ? 'connected' : 'not connected right now'))}</span></div>`;
    }
    return `<div class="fc-note">${E(T('Not linked'))}</div>`;
}

const CSS = `
.dlCode { display: flex; align-items: center; margin: 8px 0; }
.dlCode b { font: 700 20px/1 var(--fc-font-mono, monospace); letter-spacing: 2px; padding: 8px 12px; margin-right: 12px; border-radius: var(--fc-r2); background: var(--fc-tint-2); color: var(--fc-text); user-select: all; }
.dlCode span { font-size: var(--fc-fs-sm); color: var(--fc-muted); }
.dlOn { color: var(--fc-success); }
.dlOff { color: var(--fc-muted); }
`;

function start(f) {
    fc = f;
    store = fc.config('discord-link', { url: '', link: null, challenges: true });
    cfg = store.data;
    agent = Agent({
        status, on: () => !!cfg.challenges, now: () => Date.now(), join: joinGame, select: (ch) => fc.app.select(ch),
        inGame, wait: waitFor,
        challenge: (name, ft, ch) => { const ms = mod('match-screens'); return ms && ms.challenge ? ms.challenge(name, ft, ch) : { ok: false, why: 'Match screens are off in Fightcord.' }; },
        gameName: (ch) => { const c = fc.app.channel(ch); return shortName(c ? c.name : ch); },
        say, linked, unlinked: () => forget('gone'), send
    });
    fc.ui.style('dlStyle', CSS);
    fc.own(() => { fc.ui.style('dlStyle', null); disconnect(); });

    // the one challenge you accepted in Discord: no filter declines it, and it's accepted for you
    fc.hooks.challenge((ctx) => agent.filter(ctx), { phase: 'filter', order: -1000 });
    fc.hooks.challenge((ctx) => {
        if (!agent.take(ctx)) return;
        setTimeout(() => {
            const r = fc.app.root(), all = fc.app.users();
            const user = (ctx.user && ctx.user.id && all[ctx.user.id]) || all[ctx.name] || ctx.user || { id: ctx.name, name: ctx.name };
            try { r.acceptChallenge(ctx.channel, user, ctx.id, ctx.ranked); } catch (e) { fc.log.warn('discord accept failed', e.message); }
        }, 200);
    }, { order: -100 });

    const has = (x) => !!(x.link && x.link.who);
    fc.settings.block({ id: 'discord-link', section: 'challenges', title: 'Discord', hint: '— challenge people from your Discord server with /challenge', store, order: 40,
        fields: [
            { type: 'note', label: 'Needs your server’s Fightcord bot. Link once, then /challenge someone in Discord: when they press Accept, both Fightcades join the game and the match starts. Fightcord only sends and accepts challenges you made or accepted there.' },
            { type: 'html', id: 'dl-state', html: () => stateHtml() },
            { type: 'button', act: 'dl-code', label: 'Link Discord', hint: 'Shows a code to type in your server', button: 'Get a code', show: (x) => !has(x) && validBase((x.url || BOT_URL).trim()), onClick: () => makeCode() },
            { type: 'button', act: 'dl-unlink', label: 'Unlink', hint: 'This Fightcord stops listening to the bot', button: 'Unlink', kind: 'ghost', show: has, onClick: () => unlinkHere(false) },
            { key: 'challenges', type: 'switch', label: 'Challenges from Discord', hint: 'Off: the bot tells people you’re not taking them right now', show: has },
            { key: 'url', type: 'text', label: 'The bot’s address', hint: 'Only if your server runs its own bot', placeholder: BOT_URL || 'https://…workers.dev', onChange: () => { if (cfg.link) connect(); } }
        ] });
    if (cfg.link) setTimeout(connect, 4000);
    fc.log(cfg.link && cfg.link.who ? 'linked to ' + cfg.link.who : 'not linked');
    return { linked: () => !!(cfg.link && cfg.link.who), connected: () => !!(ws && ws.readyState === 1) };
}

module.exports = { id: 'discord-link', name: 'Discord challenges', start, Agent, macOf, socketUrl, validBase, siteOf, ARM_MS };
