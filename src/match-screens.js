/**
 * Fightcord match screens
 *
 *   Challenge accepted  ->  full-window cinematic  [You]  VS  [Opponent]
 *   Set finished        ->  YOU WON!  /  YOU LOST!  (or DRAW) with the score, streaks and Rematch
 *
 * Shown inside the Fightcade window. Local only.
 *
 * The result is only shown when it's actually known: Fightcade's own end-of-match
 * message (when it says won/lost), or the set score from Fightcade's API. If neither
 * answers, no result screen -- never a guess. Every set goes into fc.history
 * (match-history.json), with "🏆 7–3" for tonight in the channel header.
 *
 * Sounds are your own files, in the "match-screens" folder next to this plugin:
 *   vs.wav  win.wav  lose.wav  draw.wav   (.mp3 / .ogg work too)
 *
 *   /vs            help + where the sound folder is
 *   /vs test       preview the VS screen      /vs win · /vs lose · /vs draw
 *
 * Events: match:start {quark, opp}, match:end {quark, opp, result}, set:recorded (fc.history).
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, cfg = null;            // match-screens-config.json
const SOUND_DIR = path.join(__dirname, 'match-screens');

const DEFAULTS = {
    enabled: true,
    vs: true,
    result: true,
    session: true,         // "🏆 7–3" pill in the channel header
    rematch: true,         // Rematch on the result screen
    volume: 0.8,
    sessionClearedAt: 0
};

const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);

/* ------------------------------------------------------------ player cards */

// The visible channel's header carries the full name. On the game browser / settings no
// channel is visible: fall back to the last one seen, so a match started from there still
// gets its game name and ranks.
let lastChannelName = '';
function activeChannelName() {
    const w = fc.app.channelElement();
    const title = w && w.querySelector('.channelInfo .name.title');
    const name = title ? (title.getAttribute('title') || title.textContent.replace(/^#/, '')).trim() : '';
    if (name) lastChannelName = name;
    return name || lastChannelName;
}

const gameName = () => activeChannelName().replace(/\s*\([^)]*\)\s*$/, '');

function card(name) {
    const u = fc.app.users()[name] || {};
    return {
        name,
        avatar: fc.data.avatarUrl(name, u.gravatar, 256),
        cc: ((u.country && u.country.iso_code) || '').toLowerCase(),
        country: (u.country && u.country.full_name) || '',
        rank: fc.data.rankLetter((u.channelRank || {})[activeChannelName()] || 0),
        color: fc.data.hashColor(name)
    };
}

/* ------------------------------------------------------------------ sounds */

// The page is web.fightcade.com, so file:// audio is blocked: read the file and play it
// from a Blob URL. Re-read when the file changes, so a new clip needs no restart.
const soundCache = {};   // kind -> {file, mtime, url}
const MIME = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' };

function ensureSoundDir() {
    try {
        if (!fs.existsSync(SOUND_DIR)) fs.mkdirSync(SOUND_DIR, { recursive: true });
        const readme = path.join(SOUND_DIR, 'README.txt');
        if (!fs.existsSync(readme)) {
            fs.writeFileSync(readme, [
                'Sounds for the match screens (match-screens.js).',
                '',
                'Put your own clips here, named:',
                '  vs.wav    - plays with the VS screen when a challenge is accepted',
                '  win.wav   - YOU WON!',
                '  lose.wav  - YOU LOST!',
                '  draw.wav  - DRAW',
                '.mp3 and .ogg work too. Missing file = no sound. Changes apply on the next screen.',
                '',
                'Preview in Fightcade chat with /vs test, /vs win, /vs lose, /vs draw (never sent).'
            ].join('\r\n'));
        }
    } catch (e) { fc.log.warn('sound folder:', e.message); }
}

function soundUrl(kind) {
    for (const ext of ['wav', 'mp3', 'ogg']) {
        const file = path.join(SOUND_DIR, kind + '.' + ext);
        let st;
        try { st = fs.statSync(file); } catch (e) { continue; }
        const c = soundCache[kind];
        if (c && c.file === file && c.mtime === st.mtimeMs) return c.url;
        if (c) URL.revokeObjectURL(c.url);
        const url = URL.createObjectURL(new Blob([fs.readFileSync(file)], { type: MIME[ext] }));
        soundCache[kind] = { file, mtime: st.mtimeMs, url };
        return url;
    }
    return null;
}

function play(kind) {
    try {
        const url = soundUrl(kind);
        if (!url) return;
        const a = new Audio(url);
        a.volume = Math.max(0, Math.min(1, +cfg.volume || 0));
        a.play().catch(e => fc.log('sound', kind, e.message));
    } catch (e) { fc.log('sound', kind, e.message); }
}

/* ------------------------------------------------------------------ overlay */

let overlayTimer = null;
let unlayer = null;

function closeOverlay() {
    const o = document.getElementById('fcmsOverlay');
    if (!o || o.classList.contains('out')) return;
    o.classList.add('out');
    clearTimeout(overlayTimer);
    if (unlayer) { unlayer(); unlayer = null; }
    setTimeout(() => { o.remove(); fc.sound.duck(false); }, 450);
}

function openOverlay(cls, html, ms) {
    const old = document.getElementById('fcmsOverlay');
    if (old) old.remove();
    clearTimeout(overlayTimer);
    const o = document.createElement('div');
    o.id = 'fcmsOverlay';
    o.className = cls;
    o.innerHTML = '<div class="shake">' + html + '</div><div class="flash"></div><div class="hint">' + E(T('click or Esc to skip')) + '</div>';
    // our own element: a click here only closes it
    o.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    o.addEventListener('click', (e) => { e.stopPropagation(); closeOverlay(); });
    o.querySelectorAll('img').forEach(i => { i.onerror = () => { i.style.visibility = 'hidden'; }; });
    document.body.appendChild(o);
    fc.sound.duck(true);                        // background music dips under it
    if (!unlayer) unlayer = pushEsc(closeOverlay);
    overlayTimer = setTimeout(closeOverlay, ms);
}

// Esc closes it (keyup: Fightcade swallows Escape on keydown)
function pushEsc(fn) {
    const h = (e) => { if (e.key === 'Escape') fn(); };
    window.addEventListener('keyup', h, true);
    return () => window.removeEventListener('keyup', h, true);
}

function playerHtml(p, side) {
    return `<div class="player ${side}">
        <img class="avatar" src="${E(p.avatar)}">
        <div class="pname">${E(p.name)}</div>
        <div class="pmeta">${p.cc ? `<img src="static/flags/${E(p.cc)}.png">` : ''}${E(p.country)}` +
            `${p.rank ? `<span class="rank">${fc.ui.tag(p.rank)}</span>` : ''}</div>
    </div>`;
}

let vsShown = 0;                          // for tests: how many VS screens were opened
function showVs(meName, oppName) {
    if (!cfg.enabled || !cfg.vs) return;
    vsShown++;
    const me = card(meName), opp = card(oppName);
    openOverlay('vs', `
        <div class="half l" style="background:${me.color}"></div>
        <div class="half r" style="background:${opp.color}"></div>
        ${playerHtml(me, 'l')}${playerHtml(opp, 'r')}
        <div class="vsword">VS</div>
        <div class="game">${E(gameName())}</div>`, 3600);
    play('vs');
}

// Rematch on the result screen (same opponent, same channel, same FT when known)
function rematchHtml(rm) {
    if (!rm || !rm.opp || !cfg.rematch) return '';
    const st = challengeState(rm.opp, rm.channel);
    const label = T('Rematch') + (typeof rm.ft === 'number' ? (rm.ft ? ' FT' + rm.ft : ' ' + T('(casual)')) : '');
    return `<span class="rematch${st.ok ? '' : ' off'}" title="${E(st.ok ? T('Challenge {name} again', { name: rm.opp }) : st.why)}">${fc.ui.ic('swords')}${E(label)}</span>`;
}

function wireRematch(rm) {
    const b = document.querySelector('#fcmsOverlay .rematch');
    if (!b || !rm) return;
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.classList.contains('off')) return;
        const st = challenge(rm.opp, typeof rm.ft === 'number' ? rm.ft : undefined, rm.channel);
        if (st.ok) { b.innerHTML = fc.ui.ic('check') + E(T('Challenge sent')); b.classList.add('sent'); setTimeout(closeOverlay, 900); }
        else { b.textContent = st.why; b.classList.add('off'); }
    });
}

// extras: { streak: "🔥 3 WIN STREAK" | "Streak of 3 ended", lines: ["You're 4–2 vs X", "Tonight 7–3"], rematch }
function showResult(kind, mine, theirs, oppName, game, extras) {
    if (!cfg.enabled || !cfg.result) return;
    const title = E(T({ won: 'YOU WON!', lost: 'YOU LOST!', draw: 'DRAW' }[kind]));
    const ex = extras || {};
    const score = (mine != null && theirs != null) ? mine + ' – ' + theirs + ' ' : '';
    let bits = '';
    if (kind === 'won') {
        const colors = ['#ffd166', '#fff3c4', '#f0b232', '#ffffff', '#ff9f1c'];
        for (let i = 0; i < 36; i++) {
            const a = (i / 36) * Math.PI * 2, d = 30 + Math.random() * 30;
            bits += `<span class="bit" style="background:${colors[i % colors.length]};--x:${(Math.cos(a) * d).toFixed(1)}vmax;` +
                `--y:${(Math.sin(a) * d).toFixed(1)}vmax;--r:${Math.round(Math.random() * 720)}deg;animation-delay:${(0.15 + Math.random() * 0.2).toFixed(2)}s"></span>`;
        }
    }
    openOverlay('res ' + kind, `
        <div class="rays"></div>${bits}
        <div class="big">${title}</div>
        <div class="sub">${E(score)}${oppName ? 'vs ' + E(oppName) : ''}<small>${E(game || '')}</small>
            ${ex.streak ? `<span class="streak ${kind === 'won' ? 'hot' : 'cold'}">${ex.hot ? fc.ui.ic('flame', 'fill') : ''}${E(ex.streak)}</span>` : ''}
            ${(ex.lines || []).length ? `<span class="extra">${ex.lines.map(E).join('  ·  ')}</span>` : ''}
            ${rematchHtml(ex.rematch)}
        </div>`, ex.rematch && ex.rematch.opp ? 8000 : 4800);
    wireRematch(ex.rematch);
    play(kind === 'won' ? 'win' : kind === 'lost' ? 'lose' : 'draw');
}

/* ----------------------------------------------------------------- history */

// Every set you play goes into fc.history. Unknown results are kept (result: null): they
// count as played, not toward W/L or streaks.
const H = () => fc.history;
const sessionSets = (at) => H().session(at || Date.now(), cfg.sessionClearedAt);
const recordOf = (sets) => fc.data.recordOf(sets);
const streakOf = (sets) => fc.data.streakOf(sets);
const recordVs = (opp) => H().recordVs(opp);
const sessionStart = (at) => fc.data.sessionStart(at || Date.now(), cfg.sessionClearedAt);

function recordSet(set) {
    H().add(set);
    refreshSessionPill();
}

// the lines under the score, built AFTER the set was recorded
function extrasFor(kind, opp, before, elo) {
    const ex = { lines: [] };
    if (elo) {
        const d = elo.end - elo.start;
        ex.lines.push('ELO ' + elo.end.toLocaleString('en-US') + (d ? ' (' + (d > 0 ? '+' : '−') + Math.abs(d) + ')' : ''));
    }
    const st = streakOf(H().all());
    if (kind === 'won' && st.kind === 'won' && st.n >= 2) { ex.streak = T('{n} WIN STREAK', { n: st.n }); ex.hot = true; }
    else if (kind === 'lost' && before.kind === 'won' && before.n >= 2) ex.streak = T('Streak of {n} ended', { n: before.n });
    const vs = recordVs(opp);
    if (opp && (vs.w || vs.l || vs.d)) ex.lines.push(T("You're {record} vs {name}", { record: fc.fmt.wl(vs), name: opp }));
    const t = recordOf(sessionSets());
    if (t.w || t.l || t.d) ex.lines.push(T('Tonight {record}', { record: fc.fmt.wl(t) }));
    return ex;
}

/* --------------------------------------------------------------- challenges */

// Challenge someone with Fightcade's own channel.challengeUser(user, ft):
// a number challenges straight away (0 = casual), no number lets Fightcade ask for the FT.
const lastFt = new Map();        // lowercased name -> FT of the last challenge we sent them

// -> { ok, why, user, comp, channel }
function challengeState(name, channel) {
    const r = fc.app.root();
    const me = fc.app.me();
    if (!name) return { ok: false, why: T('No opponent') };
    const [real, u] = fc.app.user(name);
    if (me && real.toLowerCase() === me.toLowerCase()) return { ok: false, why: T("That's you") };
    if (!u) return { ok: false, why: T('{name} isn’t in your channels right now', { name }) };
    if (u.playing && u.playing.quarkId) return { ok: false, why: T('{name} is in a match', { name: real }) };
    if (u.away) return { ok: false, why: T('{name} is away', { name: real }) };
    if (fc.app.inMatch(me)) return { ok: false, why: T("You're in a match") };
    const chans = Array.isArray(u.channels) ? u.channels : [];
    let ch = channel && chans.includes(channel) ? channel : '';
    if (!ch && r && chans.includes(r.activeChannelId)) ch = r.activeChannelId;
    if (!ch) ch = chans.find(c => fc.app.isGameChannel(c)) || '';
    const comp = ch && r && typeof r.getChannelComponentById === 'function' ? r.getChannelComponentById(ch) : null;
    if (!comp || typeof comp.challengeUser !== 'function') return { ok: false, why: T('Join {name}’s game channel first', { name: real }) };
    return { ok: true, user: u, name: real, comp, channel: ch };
}

function challenge(name, ft, channel) {
    const st = challengeState(name, channel);
    if (!st.ok) return st;
    try {
        if (typeof ft === 'number') { st.comp.challengeUser(st.user, ft); lastFt.set(st.name.toLowerCase(), ft); }
        else st.comp.challengeUser(st.user);
    } catch (e) { return { ok: false, why: e.message }; }
    return st;
}

// the FT a set was played at, when we know it
function knownFt(opp) {
    const k = String(opp || '').toLowerCase();
    if (lastFt.has(k)) return lastFt.get(k);
    const scout = fc.modules.get('scout');
    const f = scout && scout.knownFt ? scout.knownFt(k) : null;
    return typeof f === 'number' ? f : null;
}

/* ------------------------------------------------------- session tracker */

function fmtClock(ms) {
    const d = new Date(ms), h = d.getHours();
    return ((h % 12) || 12) + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
}

function refreshSessionPill() {
    const sets = sessionSets();
    const r = recordOf(sets);
    document.querySelectorAll('.channelToolbar .channelActions').forEach(actions => {
        let pill = actions.querySelector(':scope > .fcmsPill');
        if (!cfg.enabled || !cfg.session || !sets.length) { if (pill) pill.remove(); return; }
        if (!pill) {
            pill = document.createElement('div');
            pill.className = 'fcmsPill';
            pill.title = T("Tonight's sets");
            pill.addEventListener('mousedown', (e) => e.stopPropagation());
            pill.addEventListener('click', (e) => { e.stopPropagation(); toggleSessionCard(pill); });
            actions.insertBefore(pill, actions.firstChild);
        }
        const txt = fc.fmt.wl(r);
        if (pill.textContent !== txt) pill.innerHTML = fc.ui.ic('trophy') + E(txt);
    });
}

let sessionPop = null;
function closeSessionCard() { if (sessionPop) sessionPop.close(); }

function toggleSessionCard(anchor) {
    if (sessionPop) { closeSessionCard(); return; }
    const sets = sessionSets().slice().reverse();
    const r = recordOf(sets);
    const st = streakOf(sessionSets());
    const box = document.createElement('div');
    box.id = 'fcmsSession';
    const rows = sets.map(s => {
        const mark = s.result === 'won' ? '<b class="w">W</b>' : s.result === 'lost' ? '<b class="l">L</b>'
            : s.result === 'draw' ? '<b>D</b>' : '<b class="u">?</b>';
        const score = (s.mine != null && s.theirs != null) ? s.mine + '–' + s.theirs : '—';
        return `<tr><td>${mark}</td><td class="o">${E(s.opp || '?')}</td><td class="s">${score}</td><td class="t">${fmtClock(s.at)}</td></tr>`;
    }).join('');
    box.innerHTML = `
        <div class="h">${E(T('Tonight'))} <span>— ${r.w}W · ${r.l}L${r.d ? ' · ' + r.d + 'D' : ''}${r.unknown ? ' · ' + E(T('{n} unknown', { n: r.unknown })) : ''}</span></div>
        ${st.n >= 2 ? `<div class="st ${st.kind === 'won' ? 'hot' : 'cold'}">${st.kind === 'won' ? fc.ui.ic('flame', 'fill') + E(T('{n} win streak', { n: st.n })) : E(T('{n} losses in a row', { n: st.n }))}</div>` : ''}
        <table>${rows}</table>
        <div class="f">${fc.ui.btn('Clear', { kind: 'ghost', size: 'sm', act: 'clear', title: 'Start a fresh session (the history is kept)' })}` +
            `${sets.length ? fc.ui.btn('Share', { kind: 'ghost', size: 'sm', icon: 'share', act: 'share' }) : ''}` +
            `${fc.ui.btn('All stats', { kind: 'sec', size: 'sm', icon: 'chart', act: 'all' })}</div>
        <div class="n">${E(T('History kept · {n} sets', { n: fc.fmt.num(H().all().length) }))}</div>`;
    box.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        e.stopPropagation();
        const act = a.getAttribute('data-act');
        closeSessionCard();
        const stats = fc.modules.get('stats');
        if (act === 'share' && stats && stats.share) stats.share();
        else if (act === 'all' && stats && stats.open) stats.open();
        else if (act === 'clear') { cfg.sessionClearedAt = Date.now(); store.save(); refreshSessionPill(); }
    });
    const me = sessionPop = fc.ui.popover(anchor, box, { cls: 'fcmsPop', width: 320, onClose: () => { if (sessionPop === me) sessionPop = null; } });
}

/* ----------------------------------------------------------------- results */

function scoreFromRow(row, me, opp) {
    const players = Array.isArray(row && row.players) ? row.players : [];
    const lme = me.toLowerCase(), lopp = (opp || '').toLowerCase();
    let mine = null, theirs = null;
    for (const p of players) {
        if (!p || typeof p.score !== 'number') continue;
        const n = (p.name || '').toLowerCase();
        if (n === lme) mine = p.score;
        else if (!lopp || n === lopp || theirs == null) theirs = p.score;
    }
    return { mine, theirs, games: row && (row.num_matches || 0) };
}

// no cache: a finished set may take a moment to show up. -> {mine, theirs, games} or null
async function quarkResult(quarkId, me, opp) {
    const q = (body) => fc.api.quarks(body, { ttl: 0, priority: 'high' }).catch(() => null);
    let rows = await q({ quarkid: quarkId });
    let row = rows && rows[0];
    if (!row || !row.players) {
        // not listed by id (yet): look for it among my own recent sets
        rows = await q({ username: me });
        row = (rows || []).find(r => String(r.quarkid || r.quarkId || r.id || '') === String(quarkId));
    }
    return row ? scoreFromRow(row, me, opp) : null;
}

function verdict(mine, theirs) {
    if (mine == null || theirs == null) return null;
    return mine > theirs ? 'won' : mine < theirs ? 'lost' : 'draw';
}

// Fightcade's own end-of-match row, when it states the result (.wrapUpWrapper.won/.lost/.same).
// Only rows that weren't there when the match started count -- tracked by element, not by
// position, so clearing the chat mid-match doesn't hide the new one.
const endgameRows = () => [...document.querySelectorAll('.chatContent .messageWrapper.endgame')];

function endgameVerdict(before) {
    const fresh = endgameRows().filter(r => !before.has(r));
    for (let i = fresh.length - 1; i >= 0; i--) {
        const w = fresh[i].querySelector('.wrapUpWrapper.won, .wrapUpWrapper.lost, .wrapUpWrapper.same');
        if (w) return w.classList.contains('won') ? 'won' : w.classList.contains('lost') ? 'lost' : 'draw';
        if (fresh[i].querySelector('.endgameMessageWrapper')) return 'seen';    // arrived, no verdict in it
    }
    return null;
}

// Result screens wait until Fightcade is in front again, so they aren't missed behind the emulator.
function whenFocused(fn, maxMs) {
    const t0 = Date.now();
    const step = () => {
        if (document.hasFocus() && !document.hidden) return fn();
        if (Date.now() - t0 > maxMs) return;
        setTimeout(step, 500);
    };
    step();
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function resolveResult(m) {
    const me = fc.app.me();
    // record first (streaks / tonight's record include this set), then show
    const finish = (v, mine, theirs) => {
        const before = streakOf(H().all());
        const ft = knownFt(m.opp);
        // your exact ELO before / after, when Fightcade sent it for this match (supporters)
        const real = m.rom ? fc.elo.mine(m.rom) : null;
        const elo = real && real.start && real.end && Date.now() - real.at < 3 * 60000 ? real : null;
        recordSet({ at: Date.now(), opp: m.opp || '', game: m.game || '', channel: m.channel || '', rom: m.rom || '', result: v || null,
            mine: mine == null ? null : mine, theirs: theirs == null ? null : theirs, quark: m.quark, ft: ft == null ? undefined : ft,
            startedAt: m.at, durSec: Math.round((Date.now() - m.at) / 1000),
            oppRank: m.oppRank || undefined, myRank: m.myRank || undefined, ping: m.ping == null ? undefined : m.ping, oppElo: m.oppElo || undefined,
            eloStart: elo ? elo.start : undefined, eloEnd: elo ? elo.end : undefined });
        fc.emit('match:end', { quark: m.quark, opp: m.opp, result: v || null, mine, theirs });
        if (v) whenFocused(() => showResult(v, mine, theirs, m.opp, m.game,
            Object.assign(extrasFor(v, m.opp, before, elo) || {}, { rematch: { opp: m.opp, channel: m.channel, ft } })), 60000);
    };
    // 1. Fightcade's own end-of-match message (up to ~8 s)
    for (let i = 0; i < 16; i++) {
        const v = endgameVerdict(m.endgameBefore);
        if (v && v !== 'seen') return finish(v, null, null);
        if (v === 'seen') break;
        await sleep(500);
    }
    // 2. the set score from the API, retried while it shows up
    for (const wait of [2000, 6000, 12000]) {
        await sleep(wait);
        const s = await quarkResult(m.quark, me, m.opp);
        if (s && s.games === 0 && s.mine === 0 && s.theirs === 0) { fc.log('no games played'); return; }
        const v = s && verdict(s.mine, s.theirs);
        if (v) return finish(v, s.mine, s.theirs);
    }
    fc.log('result unknown for', m.quark, '- no screen');
    finish(null, null, null);                   // still counts as a set played tonight
}

/* --------------------------------------------------------------- detection */

let current = null;              // { quark, opp, game, endgameBefore, at, oppRank, myRank, ping, oppElo }

// what's known about the set when it starts, for the analytics: both ranks in that
// channel, the opponent's ping, and their ELO (real or estimated from the leaderboard)
function setFacts(opp, channel, rom) {
    if (!opp) return {};
    const u = fc.app.users()[opp] || {}, me = fc.app.users()[fc.app.me()] || {};
    const oppRank = +((u.channelRank || {})[channel] || 0);
    const est = fc.data.eloFor(opp, oppRank, fc.api.cachedBoard(rom));
    return { oppRank, myRank: +((me.channelRank || {})[channel] || 0), ping: typeof u.ping === 'number' && u.ping > 0 ? u.ping : null,
        oppElo: est ? est.elo : null };
}
let lastVs = { opp: '', at: 0 };

function findOpponent(all, me, quark) {
    for (const n of Object.keys(all)) {
        const u = all[n];
        if (n !== me && u && u.playing && u.playing.quarkId === quark) return n;
    }
    return '';
}

// One VS per match. Up to four signals fire for the same match (your Accept click, the
// "accepts the challenge" row, the quark appearing, a late-found opponent) and the emulator
// can take well over 30 s to start -- so the same opponent stays blocked until that match
// has ENDED (then a rematch gets its own VS), or for 3 minutes if it never starts.
const VS_HOLD_MS = 3 * 60000;
function vsOnce(opp) {
    const key = opp.toLowerCase();
    const t = Date.now();
    if (current && current.opp && current.opp.toLowerCase() !== key) return;     // mid-match: not now
    if (lastVs.opp === key && !lastVs.released &&
        (t - lastVs.at < VS_HOLD_MS || (current && current.opp.toLowerCase() === key))) return;
    lastVs = { opp: key, at: t, released: false };
    showVs(fc.app.me(), opp);
}

function poll() {
    if (!cfg.enabled) return;
    const me = fc.app.me();
    if (!me) return;
    const all = fc.app.users();
    const quark = (all[me] && all[me].playing && all[me].playing.quarkId) || null;

    // A reconnect blip can drop "playing" for a moment mid-set: only call the set over once
    // the quark has been gone for 5 s, and pick up again if it returns.
    if (current && !quark) {
        if (!current.goneAt) current.goneAt = Date.now();
        if (Date.now() - current.goneAt < 5000) return;
    } else if (current && quark === current.quark) {
        current.goneAt = 0;
    }

    if (quark && (!current || current.quark !== quark)) {
        const opp = findOpponent(all, me, quark);
        const pl = all[me].playing;
        current = { quark, opp, game: gameName(), channel: pl.channelId || '', rom: pl.gameId || '',
            endgameBefore: new Set(endgameRows()), at: Date.now() };
        Object.assign(current, setFacts(opp, current.channel, current.rom));
        if (opp) vsOnce(opp);
        fc.emit('match:start', { quark, opp });
        fc.log('match started', quark, 'vs', opp || '?');
    } else if (quark && current && !current.opp && Date.now() - current.at < 15000) {
        // the opponent's own "playing" can land a poll or two after ours
        const opp = findOpponent(all, me, quark);
        if (opp) { current.opp = opp; Object.assign(current, setFacts(opp, current.channel, current.rom)); vsOnce(opp); fc.log('opponent', opp); }
    } else if (!quark && current) {
        const m = current;
        current = null;
        lastVs.released = true;               // a rematch may have its own VS
        fc.log('match ended', m.quark);
        resolveResult(m);
    }
}

// Earlier than the quark: "X accepts the challenge" in chat, or you clicking Accept.
// Keyed by what the row SAYS, not by element: Fightcade re-draws chat rows, and a re-drawn
// "X accepts the challenge" is a new element with old news. Only rows at the bottom count.
const seenAccepted = new WeakSet();
const acceptedText = new Map();          // "x accepts the challenge" -> when first seen
let acceptedReady = false;
function scanAccepted() {
    if (!cfg.enabled) return;
    const t = Date.now();
    for (const [k, at] of acceptedText) if (t - at > 10 * 60000) acceptedText.delete(k);
    document.querySelectorAll('.chatContent .wrapUpWrapper.accepted').forEach(el => {
        if (seenAccepted.has(el)) return;
        seenAccepted.add(el);
        const text = el.textContent.trim().toLowerCase();
        const fresh = !acceptedText.has(text);
        acceptedText.set(text, acceptedText.get(text) || t);
        if (!acceptedReady || !fresh) return;                   // startup history / seen before
        const wrap = el.closest('.messageWrapper');
        const rows = wrap && wrap.parentNode ? [...wrap.parentNode.querySelectorAll(':scope > .messageWrapper')] : [];
        if (rows.indexOf(wrap) < rows.length - 3) return;       // not at the bottom: old row re-drawn
        const m = el.textContent.trim().match(/^(.+?)\s+accepts the challenge/i);
        if (m && !fc.app.isMe(m[1])) vsOnce(m[1]);
    });
    acceptedReady = true;
}

function onAcceptClick(e) {
    const btn = e.target && e.target.closest && e.target.closest('.accept-challenge');
    if (!btn || !cfg.enabled) return;
    // passive: never cancels the click, Fightcade still accepts as normal
    const wrap = btn.closest('.messageWrapper');
    const name = wrap && ((wrap.querySelector('.userInfo .name') || {}).textContent ||
        ((wrap.querySelector('.title strong') || {}).textContent) ||
        (((wrap.querySelector('.title') || {}).textContent || '').match(/with\s+(.+?)!?\s*$/i) || [])[1]);
    if (name && name.trim()) setTimeout(() => vsOnce(name.trim()), 50);
}

/* --------------------------------------------------------------------- style */

const CSS = `
#fcmsOverlay { position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 2147483000; overflow: hidden;
    cursor: pointer; user-select: none; font-family: 'Noto Sans', 'Segoe UI', system-ui, sans-serif;
    animation: fcms-in .25s ease-out both; }
#fcmsOverlay.out { animation: fcms-out .45s ease-in both; }
@keyframes fcms-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes fcms-out { from { opacity: 1; } to { opacity: 0; } }
#fcmsOverlay .shake { position: absolute; left: 0; top: 0; right: 0; bottom: 0; }

/* ---------- VS ---------- */
#fcmsOverlay.vs { background: #0b0a0d; }
#fcmsOverlay.vs .half { position: absolute; top: 0; bottom: 0; width: 60%; }
#fcmsOverlay.vs .half.l { left: -10%; transform: skewX(-12deg); animation: fcms-left .55s cubic-bezier(.2,.9,.2,1) both; }
#fcmsOverlay.vs .half.r { right: -10%; transform: skewX(-12deg); animation: fcms-right .55s cubic-bezier(.2,.9,.2,1) both; }
@keyframes fcms-left { from { transform: translateX(-100%) skewX(-12deg); } to { transform: translateX(0) skewX(-12deg); } }
@keyframes fcms-right { from { transform: translateX(100%) skewX(-12deg); } to { transform: translateX(0) skewX(-12deg); } }
#fcmsOverlay.vs .half::after { content: ''; position: absolute; left: 0; top: 0; right: 0; bottom: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.65)); }
#fcmsOverlay.vs .player { position: absolute; top: 50%; width: 40%; text-align: center; transform: translateY(-50%);
    animation: fcms-pop .5s .35s cubic-bezier(.2,1.4,.4,1) both; }
#fcmsOverlay.vs .player.l { left: 5%; }
#fcmsOverlay.vs .player.r { right: 5%; }
@keyframes fcms-pop { from { opacity: 0; transform: translateY(-50%) scale(.6); } to { opacity: 1; transform: translateY(-50%) scale(1); } }
#fcmsOverlay .avatar { width: 30vmin; height: 30vmin; border-radius: 50%; border: .9vmin solid #fff; object-fit: cover;
    box-shadow: 0 1vmin 5vmin rgba(0,0,0,.6); background: #222; display: block; margin: 0 auto; }
#fcmsOverlay .pname { margin-top: 3vmin; color: #fff; font-weight: 900; font-size: 7vmin; line-height: 1;
    letter-spacing: -.02em; text-transform: uppercase; text-shadow: 0 .6vmin 0 rgba(0,0,0,.55), 0 0 4vmin rgba(0,0,0,.6);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#fcmsOverlay .pmeta { margin-top: 1.6vmin; color: rgba(255,255,255,.85); font-size: 2.6vmin; font-weight: 600; }
#fcmsOverlay .pmeta > img { width: 3.4vmin; height: 2.4vmin; object-fit: cover; border-radius: .3vmin; vertical-align: -.3vmin; margin-right: 1vmin; }
#fcmsOverlay .rank { display: inline-flex; align-items: center; margin-left: 1.2vmin; }
#fcmsOverlay .rank .fc-tag { --sz: 4.6vmin; }
#fcmsOverlay .vsword { position: absolute; left: 50%; top: 50%; font-weight: 900; font-style: italic; font-size: 24vmin;
    line-height: 1; color: #fff; transform: translate(-50%,-50%);
    text-shadow: 0 0 3vmin #fff, 0 0 8vmin #f0b232, 0 1vmin 0 #b3261e;
    animation: fcms-slam .45s .75s cubic-bezier(.3,1.6,.5,1) both; }
@keyframes fcms-slam { from { opacity: 0; transform: translate(-50%,-50%) scale(3.2) rotate(-8deg); }
                       to { opacity: 1; transform: translate(-50%,-50%) scale(1) rotate(0); } }
#fcmsOverlay .flash { position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: #fff; opacity: 0; pointer-events: none;
    animation: fcms-flash .5s .95s ease-out both; }
@keyframes fcms-flash { 0% { opacity: .85; } 100% { opacity: 0; } }
#fcmsOverlay.vs .shake { animation: fcms-shake .4s .95s linear both; }
@keyframes fcms-shake { 0%,100% { transform: translate(0,0); } 20% { transform: translate(-1.2vmin,.8vmin); }
    40% { transform: translate(1vmin,-.8vmin); } 60% { transform: translate(-.8vmin,-.4vmin); } 80% { transform: translate(.6vmin,.6vmin); } }
#fcmsOverlay .game { position: absolute; left: 0; right: 0; bottom: 7vmin; text-align: center; color: rgba(255,255,255,.8);
    font-size: 2.6vmin; font-weight: 700; letter-spacing: .4em; text-transform: uppercase;
    animation: fcms-in .5s 1.1s both; }

/* ---------- results ---------- */
#fcmsOverlay.res .rays { position: absolute; left: 50%; top: 45%; width: 220vmax; height: 220vmax; margin: -110vmax 0 0 -110vmax;
    opacity: .35; animation: fcms-spin 14s linear infinite; }
@keyframes fcms-spin { to { transform: rotate(360deg); } }
#fcmsOverlay.res .big { position: absolute; left: 0; right: 0; top: 45%; text-align: center; transform: translateY(-50%);
    font-weight: 900; font-style: italic; font-size: 17vmin; line-height: 1; letter-spacing: -.02em; white-space: nowrap; }
#fcmsOverlay.res .sub { position: absolute; left: 0; right: 0; top: 64%; text-align: center; color: rgba(255,255,255,.92);
    font-size: 4vmin; font-weight: 800; animation: fcms-in .5s .6s both; }
#fcmsOverlay.res .sub small { display: block; margin-top: 1.2vmin; font-size: 2.2vmin; font-weight: 700; letter-spacing: .35em;
    text-transform: uppercase; color: rgba(255,255,255,.6); }

#fcmsOverlay.won { background: radial-gradient(ellipse at 50% 45%, #6b4a00 0%, #2a1c00 45%, #0c0800 100%); }
#fcmsOverlay.won .rays { background: repeating-conic-gradient(from 0deg, rgba(255,209,102,.45) 0deg 6deg, transparent 6deg 18deg); }
#fcmsOverlay.won .big { color: #ffd166; -webkit-text-stroke: .35vmin #5a3a00;
    text-shadow: 0 0 1vmin rgba(255,243,196,.8), 0 0 4vmin rgba(240,178,50,.7), 0 1.2vmin 0 #5a3a00;
    animation: fcms-punch .6s .15s cubic-bezier(.2,1.7,.4,1) both, fcms-glow 1.6s .8s ease-in-out infinite alternate; }
@keyframes fcms-punch { from { opacity: 0; transform: translateY(-50%) scale(.2); } to { opacity: 1; transform: translateY(-50%) scale(1); } }
@keyframes fcms-glow { to { text-shadow: 0 0 1.5vmin rgba(255,243,196,.9), 0 0 6vmin rgba(255,209,102,.8), 0 1.2vmin 0 #5a3a00; } }
#fcmsOverlay.won .bit { position: absolute; left: 50%; top: 45%; width: 1.6vmin; height: 1.6vmin; border-radius: .3vmin;
    animation: fcms-burst 1.6s .2s cubic-bezier(.1,.8,.3,1) both; }
@keyframes fcms-burst { from { transform: translate(0,0) rotate(0); opacity: 1; }
                        to { transform: translate(var(--x), var(--y)) rotate(var(--r)); opacity: 0; } }

#fcmsOverlay.lost { background: radial-gradient(ellipse at 50% 45%, #5a0d10 0%, #26070a 50%, #0a0203 100%); }
#fcmsOverlay.lost .rays { background: repeating-conic-gradient(from 0deg, rgba(242,63,67,.25) 0deg 4deg, transparent 4deg 20deg); opacity: .25; }
#fcmsOverlay.lost .big { color: #f23f43; text-shadow: 0 0 5vmin #8b0000, 0 1.2vmin 0 #3a0003;
    animation: fcms-drop .5s .1s cubic-bezier(.5,0,.8,.4) both; }
@keyframes fcms-drop { from { opacity: 0; transform: translateY(-160%) scale(1.4); } to { opacity: 1; transform: translateY(-50%) scale(1); } }
#fcmsOverlay.lost .shake { animation: fcms-shake .45s .6s linear both; }

#fcmsOverlay.draw { background: radial-gradient(ellipse at 50% 45%, #1f2c4a 0%, #0f1526 55%, #06080f 100%); }
#fcmsOverlay.draw .rays { background: repeating-conic-gradient(from 0deg, rgba(160,180,220,.25) 0deg 5deg, transparent 5deg 20deg); }
#fcmsOverlay.draw .big { color: #cfd8ea; text-shadow: 0 0 5vmin #5865f2, 0 1.2vmin 0 #20263a;
    animation: fcms-punch .6s .15s cubic-bezier(.2,1.5,.4,1) both; }
#fcmsOverlay.res .streak { display: inline-block; margin-top: 2.4vmin; padding: .6vmin 2vmin; border-radius: 3vmin;
    font-size: 2.6vmin; font-weight: 900; letter-spacing: .08em; animation: fcms-pop2 .5s 1s cubic-bezier(.2,1.6,.4,1) both; }
#fcmsOverlay.res .streak.hot { background: #ffd166; color: #3a2400; box-shadow: 0 0 3vmin rgba(255,209,102,.6); }
#fcmsOverlay.res .streak.cold { background: rgba(255,255,255,.12); color: rgba(255,255,255,.85); }
@keyframes fcms-pop2 { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
#fcmsOverlay.res .rematch { display: inline-block; margin-top: 2.6vmin; padding: 1.2vmin 3.2vmin; border-radius: 1vmin; cursor: pointer;
    font-size: 2.4vmin; font-weight: 800; letter-spacing: .04em; color: #fff; background: rgba(88,101,242,.92);
    box-shadow: 0 0 0 1px rgba(255,255,255,.25), 0 0 2.4vmin rgba(88,101,242,.6); pointer-events: auto; transition: transform .12s ease, filter .12s ease; }
#fcmsOverlay.res .rematch:hover { transform: translateY(-2px) scale(1.03); filter: brightness(1.12); }
#fcmsOverlay.res .rematch.off { background: rgba(255,255,255,.12); box-shadow: none; cursor: default; font-size: 1.9vmin; transform: none; }
#fcmsOverlay.res .rematch.sent { background: #248046; box-shadow: 0 0 2.4vmin rgba(36,128,70,.6); }
#fcmsOverlay.res .extra { display: block; margin-top: 1.8vmin; font-size: 2.2vmin; font-weight: 700; color: rgba(255,255,255,.75);
    animation: fcms-in .5s 1.2s both; }
#fcmsOverlay .hint { position: absolute; right: 2.4vmin; bottom: 2vmin; font-size: 1.6vmin; color: rgba(255,255,255,.35); }
.fcmsPill { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; margin-right: 8px; border-radius: var(--fc-r1);
    background: var(--fc-btn); color: #fff; font: 600 14px/32px var(--fc-font); cursor: pointer; user-select: none; white-space: nowrap; }
.fcmsPill:hover { background: var(--fc-btn-h); }
.fc-pop.fcmsPop { padding: 14px 16px 10px; max-height: 70vh; }
#fcmsSession .h { font-size: 16px; font-weight: 700; color: var(--fc-head); }
#fcmsSession .h span { font-weight: 500; color: var(--fc-muted); font-size: 14px; }
#fcmsSession .st { display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 700; }
#fcmsSession .st.hot { background: #ffd166; color: #3a2400; }
#fcmsSession .st.cold { background: rgba(242,63,67,.15); color: var(--fc-danger); }
#fcmsSession table { width: 100%; margin-top: 10px; border-collapse: collapse; table-layout: fixed; }
#fcmsSession td { padding: 4px 0; font-size: 13px; }
#fcmsSession td:first-child { width: 20px; }
#fcmsSession td.o { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px; }
#fcmsSession td.s { width: 44px; text-align: right; color: var(--fc-head); }
#fcmsSession td.t { width: 70px; text-align: right; color: var(--fc-muted); font-size: 12px; }
#fcmsSession b.w { color: var(--fc-success); } #fcmsSession b.l { color: var(--fc-danger); } #fcmsSession b.u { color: #80848e; }
#fcmsSession .f { display: flex; justify-content: flex-end; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--fc-divider); }
#fcmsSession .f > .fc-btn { margin-left: 6px; }
#fcmsSession .f > .fc-btn:first-child { margin: 0 auto 0 0; }
#fcmsSession .n { margin-top: 6px; font-size: 11px; color: var(--fc-faint); text-align: right; }
`;

/* -------------------------------------------------------------------- module */

function standIn() {
    const me = fc.app.me();
    return Object.keys(fc.app.users()).find(x => x !== me) || T('Opponent');
}

function start(f) {
    fc = f;
    store = fc.config('match-screens', DEFAULTS);
    cfg = store.data;
    window.__fcMatchScreensLoaded = true;
    ensureSoundDir();
    fc.ui.style('fcmsStyle', CSS);
    fc.own(() => { fc.ui.style('fcmsStyle', null); closeOverlay(); closeSessionCard(); document.querySelectorAll('.fcmsPill').forEach(p => p.remove()); window.__fcMatchScreensLoaded = false; });

    document.addEventListener('click', onAcceptClick, true);
    fc.own(() => document.removeEventListener('click', onAcceptClick, true));
    fc.watch(() => { scanAccepted(); refreshSessionPill(); });
    fc.tick(poll, 500, { whileHidden: true });
    fc.on('set:recorded', refreshSessionPill);
    fc.on('history:merged', refreshSessionPill);

    fc.cmd('vs', 'Match screens: previews and help', (arg) => {
        const a = String(arg || '').toLowerCase();
        const opp = standIn(), game = gameName();
        if (a === 'test') showVs(fc.app.me() || T('You'), opp);
        else if (a === 'win') showResult('won', 3, 1, opp, game, { streak: T('{n} WIN STREAK', { n: 3 }), hot: true, lines: [T("You're {record} vs {name}", { record: '4–2', name: opp }), T('Tonight {record}', { record: '7–3' })] });
        else if (a === 'lose') showResult('lost', 1, 3, opp, game, { streak: T('Streak of {n} ended', { n: 3 }), lines: [T("You're {record} vs {name}", { record: '4–3', name: opp }), T('Tonight {record}', { record: '7–4' })] });
        else if (a === 'draw') showResult('draw', 2, 2, opp, game);
        else fc.ui.toast(T(cfg.enabled ? 'Match screens: on' : 'Match screens: off'), { icon: 'sword', ms: 9000,
            sub: T('/vs test · /vs win · /vs lose · /vs draw (previews). Sounds: vs / win / lose / draw .wav in {dir}', { dir: SOUND_DIR }) });
    }, { args: 'test|win|lose|draw' });

    fc.settings.block({
        id: 'match-screens', section: 'match', title: 'Match screens', hint: '— only you see these · /vs test to preview',
        store, order: 10,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Match screens', onChange: refreshSessionPill },
            { key: 'vs', type: 'switch', label: 'VS screen', hint: 'When a challenge is accepted', show: (d) => d.enabled },
            { key: 'result', type: 'switch', label: 'Result screen', hint: 'YOU WON! / YOU LOST! after the set', show: (d) => d.enabled },
            { key: 'rematch', type: 'switch', label: 'Rematch button', hint: 'On the result screen, same FT when known', show: (d) => d.enabled && d.result },
            { key: 'session', type: 'switch', label: 'Session tracker', hint: 'Tonight’s record in the channel header', show: (d) => d.enabled, onChange: refreshSessionPill },
            { key: 'volume', type: 'slider', label: 'Volume', scale: 100, unit: '%', onChange: () => play('vs') },
            { type: 'note', label: T('Sounds: vs / win / lose / draw (.wav .mp3 .ogg) in {dir}', { dir: SOUND_DIR }) }
        ]
    });
    refreshSessionPill();
    scanAccepted();
    fc.log('ready - sounds in', SOUND_DIR);
    return api;
}

const api = {
    challenge: (name, ft, channel) => challenge(name, ft, channel),
    challengeState: (name, channel) => challengeState(name, channel),
    knownFt,
    // the match history lives in fc.history now; these stay for plugins not on the core yet
    historySets: () => H().all(),
    mergeSets: (list) => H().merge(list),
    updateSet: (quark, patch) => H().update(quark, patch),
    _history: { recordSet: (s) => recordSet(s), sessionStart: (t) => sessionStart(t), sessionSets: (t) => sessionSets(t), recordOf, streakOf,
        recordVs: (o) => recordVs(o), extrasFor: (k, o, b, e) => extrasFor(k, o, b, e), load: () => ({ sets: H().all() }) },
    _showVs: (a, b) => showVs(a, b),
    _showResult: (...a) => showResult(...a),
    _quarkResult: (...a) => quarkResult(...a),
    _poll: () => poll(),
    _vsOnce: (n) => vsOnce(n),
    _vsShown: () => vsShown,
    get _config() { return cfg; }
};

module.exports = { id: 'match-screens', name: 'Match screens & session tracker', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
