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
 * Events: match:accepted {opp, channel} (the VS screen), match:start {quark, opp}, match:end {quark, opp, result},
 * match:character, set:recorded (fc.history).
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
    vsTips: true,          // 3.5: the matchup guide's tips vs their character on the VS screen
    volume: 0.8,
    sessionClearedAt: 0
};

const E = (s) => fc.fmt.esc(s);
const N_ = (s) => s;          // translated where shown
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
const gameRom = () => { const c = fc.app.channel(activeChannelName()); return (c && c.gameid) || ''; };

// Characters for the VS screen: the emulator's own files once it shows them, else what the
// opponent played against you last time (character select usually comes after the VS screen)
function vsCharacters(me, opp) {
    const pl = fc.app.playing(me);
    const e = pl && fc.emu ? fc.emu.match(pl.quarkId) : null;
    const s = e ? fc.emu.sides(e, me) : null;
    if (s && (s.mine.char || s.theirs.char)) return { me: s.mine.char, opp: s.theirs.char, live: true };
    const last = H().vs(opp).filter(x => x.oppChar).pop();
    return { me: '', opp: last ? last.oppChar : '', live: false };
}

function card(name) {
    const u = fc.app.users()[name] || {};
    return {
        name,
        avatar: fc.data.avatarUrl(name, u.gravatar, 256),
        cc: ((u.country && u.country.iso_code) || '').toLowerCase(),
        country: (u.country && u.country.full_name) || '',
        rank: fc.data.rankLetter((u.channelRank || {})[activeChannelName()] || 0),
        color: fc.data.rankLetter((u.channelRank || {})[activeChannelName()] || 0)
            ? fc.data.rankColor((u.channelRank || {})[activeChannelName()]) : fc.data.hashColor(name)
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
    o.querySelectorAll('img').forEach(i => { if (!i.closest('.fc-mu-face')) i.onerror = () => { i.style.visibility = 'hidden'; }; });
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

/* --------------------------------------------------------- VS screen data */

// the characters picked most in these sets: [[char, sets], ...] (top 3)
function picksOf(sets, key) {
    const n = new Map();
    (sets || []).forEach(s => { const c = s && s[key]; if (c) n.set(c, (n.get(c) || 0) + 1); });
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
}

// the "tale of the tape" under the players: { rows: [[label, mine, theirs, better: 1 | -1 | 0]], odds } (pure: data = fc.data)
//   o: { myRank, oppRank (1-6), myElo, oppElo ({ elo, est } | null), vs: { w, l }, ft }
function tapeOf(o, data) {
    const d = data || fc.data;
    const rows = [];
    const L = (r) => d.rankLetter(r) || '—';
    if (o.myRank || o.oppRank) rows.push([N_('Rank'), L(o.myRank), L(o.oppRank), Math.sign((o.myRank || 0) - (o.oppRank || 0))]);
    if (o.myElo || o.oppElo) {
        rows.push([N_('ELO'), o.myElo ? d.fmtElo(o.myElo) : '—', o.oppElo ? d.fmtElo(o.oppElo) : '—',
            o.myElo && o.oppElo ? Math.sign(o.myElo.elo - o.oppElo.elo) : 0]);
    }
    const vs = o.vs || {};
    if (vs.w || vs.l) rows.push([N_('Head to head'), String(vs.w || 0), String(vs.l || 0), Math.sign((vs.w || 0) - (vs.l || 0))]);
    const ft = o.ft || 3;
    const odds = o.myElo && o.oppElo ? Object.assign(d.winOdds(o.myElo.elo, o.oppElo.elo, ft), { est: !!(o.myElo.est || o.oppElo.est) }) : null;
    return { rows, odds, ft };
}

// what the tape is made of, from what's on hand (the ranks shown on the badges)
function faceoff(meName, oppName, rom) {
    const me = card(meName), opp = card(oppName);
    const board = rom ? fc.api.cachedBoard(rom) : null;
    const myRank = fc.data.rankNum(me.rank), oppRank = fc.data.rankNum(opp.rank);
    return {
        myRank, oppRank,
        myElo: fc.data.eloFor(meName, myRank, board, fc.elo.value(meName, rom)),
        oppElo: fc.data.eloFor(oppName, oppRank, board, fc.elo.value(oppName, rom)),
        vs: recordVs(oppName), ft: knownFt(oppName)
    };
}

function tapeHtml(t, me, opp) {
    if (!t.rows.length && !t.odds) return '';
    const rows = t.rows.map(([k, a, b, better]) => `<div class="row"><span class="a${better > 0 ? ' up' : ''}">${E(a)}</span>` +
        `<span class="k">${E(T(k))}</span><span class="b${better < 0 ? ' up' : ''}">${E(b)}</span></div>`).join('');
    let odds = '';
    if (t.odds) {
        // never a flat 0% / 100%: these are odds (and often from estimates)
        const p = Math.min(99, Math.max(1, Math.round(t.odds.set * 100)));
        odds = `<div class="odds" style="--p:${(p / 100).toFixed(2)};--ca:${me.color};--cb:${opp.color}"><span class="pa">${p}%</span>` +
            `<div class="bar"><i class="ma"></i><i class="mb"></i></div><span class="pb">${100 - p}%</span>` +
            `<small>${E(T(t.odds.est ? 'Chance to win the set (FT{n}, estimated)' : 'Chance to win the set (FT{n})', { n: t.ft }))}</small></div>`;
    }
    return rows + odds;
}

/* ---------------------------------------------------------------- screens */

function playerHtml(p, side, o) {
    const picks = (o.picks || []).length ? `<div class="picks"><small>${E(o.picksLabel)}</small>${o.picks.map(([c, n]) => `<span>${E(c)}<i>${n}</i></span>`).join('')}</div>` : '';
    return `<div class="player ${side}">
        <div class="av"><img class="avatar" src="${E(p.avatar)}"></div>
        <div class="plate"><span class="pname">${E(p.name)}</span></div>
        <div class="pmeta">${p.cc ? `<img src="static/flags/${E(p.cc)}.png">` : ''}${E(p.country)}` +
            `${o.ping ? `<span class="ping">${E(o.ping + ' ms')}</span>` : ''}${p.rank ? `<span class="rank">${fc.ui.tag(p.rank)}</span>` : ''}</div>
        ${o.char ? `<div class="cplate">${o.charNote ? `<small>${E(o.charNote)}</small>` : ''}${o.face || ''}<b>${E(o.char)}</b></div>` : ''}
        ${picks}
    </div>`;
}

// the matchup guide's tips against their character (your own matchup note first)
function tipsHtml(rom, myChar, oppChar, n) {
    const mg = fc.modules.get('matchup-guide');
    const e = cfg.vsTips && mg && oppChar ? mg.find(rom, oppChar) : null;
    if (!e) return '';
    const nt = fc.modules.get('notes');
    const note = nt && nt.matchup ? nt.matchup(rom, oppChar) : null;
    const lines = mg.tips(rom, myChar, oppChar, n).slice(0, note ? n - 1 : n);
    return `<div class="mutips"><small>${E(T('How to beat {char}', { char: e.name }))}</small>` +
        (note ? `<p class="own">${fc.ui.ic('note')}${E(note.text)}</p>` : '') + lines.map(x => `<p>${E(x)}</p>`).join('') + '</div>';
}
const faceOf = (rom, ch) => { const mg = fc.modules.get('matchup-guide'); return mg && ch ? mg.faceHtml(rom, ch, 40) : ''; };

let vsShown = 0;                          // for tests: how many VS screens were opened
function showVs(meName, oppName) {
    if (!cfg.enabled || !cfg.vs) return;
    vsShown++;
    const me = card(meName), opp = card(oppName);
    const rom = gameRom();
    const ch = vsCharacters(meName, oppName);
    const t = recordOf(sessionSets());
    // most-used characters: yours in this game, theirs against you
    const inGame = (s) => !rom || !s.rom || s.rom === rom;
    const myPicks = picksOf(H().all().filter(inGame), 'myChar');
    const oppPicks = picksOf(H().vs(oppName).filter(inGame), 'oppChar');
    const myChar = ch.me || (myPicks[0] ? myPicks[0][0] : '');
    const oppChar = ch.opp || (oppPicks[0] ? oppPicks[0][0] : '');
    const u = fc.app.users()[oppName] || {};
    const face = faceoff(meName, oppName, rom);
    const tips = tipsHtml(rom, myChar, oppChar, 3);
    const sparks = Array.from({ length: 12 }, (x, i) => `<span class="spark" style="--a:${i * 30 + 8}deg;--d:${(26 + (i % 3) * 9)}vmin"></span>`).join('');
    openOverlay('vs', `
        ${rom ? `<div class="art" style="background-image:url('${E(fc.data.artUrl(rom, 'https://web.fightcade.com/'))}')"></div>` : ''}
        <div class="half l" style="--c:${me.color}"></div>
        <div class="half r" style="--c:${opp.color}"></div>
        ${playerHtml(me, 'l', { char: myChar, face: faceOf(rom, myChar), charNote: ch.me ? '' : myChar ? T('usually') : '', picks: myPicks, picksLabel: T('Your picks') })}
        ${playerHtml(opp, 'r', { char: oppChar, face: faceOf(rom, oppChar), charNote: ch.opp && ch.live ? '' : oppChar ? (ch.opp ? T('last time') : T('usually')) : '', picks: oppPicks,
            picksLabel: T('Their picks vs you'), ping: typeof u.ping === 'number' && u.ping > 0 ? Math.round(u.ping) : 0 })}
        <div class="sparks">${sparks}</div><div class="vsword">VS</div><div class="ring"></div>
        <div class="tape">${tapeHtml(tapeOf(face), me, opp)}</div>
        ${tips}
        <div class="game">${E(gameName())}${t.w || t.l || t.d ? `<small>${E(T('Tonight {record}', { record: fc.fmt.wl(t) }))}</small>` : ''}</div>`, tips ? 6600 : 4600);
    const o = document.getElementById('fcmsOverlay');
    if (o) o.dataset.opp = oppName;
    play('vs');
    // the scout can come back with exact ELO (Fightcade sends it for its supporters) while it's up:
    // those replace the estimates (an estimate of its own could disagree with the badges shown)
    const scout = fc.modules.get('scout');
    if (scout && scout.scoutData) {
        scout.scoutData(oppName).then(d => {
            const ov = document.getElementById('fcmsOverlay');
            if (!d || d.error || !ov || ov.dataset.opp !== oppName || ov.classList.contains('out')) return;
            const exact = (e) => (e && !e.est ? e : null);
            if (!exact(d.elo) && !exact(d.myElo)) return;
            const fresh = Object.assign({}, face, { myElo: exact(d.myElo) || face.myElo, oppElo: exact(d.elo) || face.oppElo });
            fc.ui.setHtml(ov.querySelector('.tape'), tapeHtml(tapeOf(fresh), me, opp));
        }).catch(() => {});
    }
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

// the set game by game: W / L plates, with the characters when they change
function gamesHtml(games) {
    if (!games || !games.length) return '';
    let last = '';
    return `<div class="games">${games.map((g, i) => {
        const pair = g.m || g.t ? (g.m || '?') + ' vs ' + (g.t || '?') : '';
        const show = pair && pair !== last;
        last = pair || last;
        return `<span class="g ${g.w ? 'w' : 'l'}" style="--i:${i}" title="${E(T('Game {n}', { n: i + 1 }) + (pair ? ' · ' + pair : ''))}"><b>${g.w ? 'W' : 'L'}</b>` +
            `${show ? `<small>${E(pair)}</small>` : ''}</span>`;
    }).join('')}</div>`;
}

// your ELO (counting from before to after when Fightcade sent both) and how far you are to the next rank
//   -> { html, from, to } (from / to: the numbers to count between, or null)
function eloPanel(ex) {
    const e = ex.elo;
    const rank = fc.data.rankNum(ex.rank);
    if (e) {
        const r0 = fc.data.rankOfElo(e.start), r1 = fc.data.rankOfElo(e.end);
        const p0 = fc.data.rankProgress(r0, e.start), p1 = fc.data.rankProgress(r1, e.end);
        const d = e.end - e.start, up = r1 > r0, down = r1 < r0;
        const a = up ? 0 : p0 ? p0.frac : 0, b = p1 ? p1.frac : 0;
        const next = p1 && p1.next ? T('{pct}% to {rank}', { pct: Math.round(b * 100), rank: fc.data.rankLetter(p1.next) }) : T('Top rank');
        return { from: e.start, to: e.end, html: `<div class="elo${up ? ' rankup' : ''}${down ? ' rankdown' : ''}" style="--a:${a.toFixed(3)};--b:${b.toFixed(3)};--c:${fc.data.rankColor(r1)}">` +
            `${fc.ui.tag(r1)}<div class="nums"><b class="n">${e.start.toLocaleString('en-US')}</b>` +
            `${d ? `<span class="d ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>` : ''}<small>ELO</small>${up ? `<span class="burst">${E(T('RANK UP!'))}</span>` : ''}</div>` +
            `<div class="bar"><i></i></div><span class="nx">${E(next)}</span></div>` };
    }
    // no exact ELO (most players): your rank, and where you sit in it from the leaderboard
    if (!rank) return { html: '', from: null, to: null };
    const est = fc.data.eloFor(fc.app.me(), rank, ex.rom ? fc.api.cachedBoard(ex.rom) : null);
    const p = est ? fc.data.rankProgress(rank, est.elo) : null;
    const b = p ? p.frac : 0;
    const next = p && p.next ? T('about {pct}% to {rank}', { pct: Math.round(b * 100), rank: fc.data.rankLetter(p.next) }) : T('Top rank');
    return { from: null, to: null, html: `<div class="elo est" style="--a:${b.toFixed(3)};--b:${b.toFixed(3)};--c:${fc.data.rankColor(rank)}">${fc.ui.tag(rank)}` +
        (est ? `<div class="nums"><b class="n">${E(fc.data.fmtElo(est))}</b><small>${E(T('ELO, estimated'))}</small></div>` : '') +
        `<div class="bar"><i></i></div><span class="nx">${E(next)}</span></div>` };
}

// the number climbing (or dropping) from before to after. Its text node changes, not the page's
// elements, so nothing else in Fightcord wakes up for it
function countUp(el, from, to, ms) {
    if (!el || from == null || to == null || from === to) return;
    if (document.documentElement.classList.contains('fc-still')) { el.firstChild.nodeValue = to.toLocaleString('en-US'); return; }
    const t0 = performance.now() + 900;            // after the title lands
    el.firstChild.nodeValue = from.toLocaleString('en-US');
    const step = (t) => {
        if (!el.isConnected) return;
        const k = Math.max(0, Math.min(1, (t - t0) / ms));
        const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
        el.firstChild.nodeValue = v.toLocaleString('en-US');
        if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// extras: { streak, hot, lines: ["You're 4–2 vs X", "Tonight 7–3"], rematch, myChar, oppChar, games, elo: { start, end }, rank, rom }
function showResult(kind, mine, theirs, oppName, game, extras) {
    if (!cfg.enabled || !cfg.result) return;
    const title = E(T({ won: 'YOU WON!', lost: 'YOU LOST!', draw: 'DRAW' }[kind]));
    const ex = extras || {};
    let bits = '';
    if (kind === 'won') {
        const colors = ['#ffd166', '#fff3c4', '#f0b232', '#ffffff', '#ff9f1c'];
        for (let i = 0; i < 36; i++) {
            const a = (i / 36) * Math.PI * 2, d = 30 + Math.random() * 30;
            bits += `<span class="bit" style="background:${colors[i % colors.length]};--x:${(Math.cos(a) * d).toFixed(1)}vmax;` +
                `--y:${(Math.sin(a) * d).toFixed(1)}vmax;--r:${Math.round(Math.random() * 720)}deg;animation-delay:${(0.15 + Math.random() * 0.2).toFixed(2)}s"></span>`;
        }
    }
    const rom = gameRom();
    const me = card(fc.app.me() || T('You')), opp = oppName ? card(oppName) : null;
    const known = mine != null && theirs != null;
    const side = (p, ch, cls) => p ? `<div class="side ${cls}"><img class="avatar" src="${E(p.avatar)}"><b>${E(p.name)}</b>${ch ? `<small>${E(ch)}</small>` : ''}</div>` : '';
    const ep = eloPanel(Object.assign({ rom }, ex, { rank: ex.rank || fc.data.rankNum(me.rank) }));
    openOverlay('res ' + kind, `
        ${rom ? `<div class="art" style="background-image:url('${E(fc.data.artUrl(rom, 'https://web.fightcade.com/'))}')"></div>` : ''}
        <div class="rays"></div>${bits}
        <div class="big"><span data-t="${title}">${title}</span>${kind === 'lost' ? '<svg class="crack" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M0 11 L14 9 L22 13 L31 7 L43 12 L52 8 L61 13 L70 9 L82 12 L90 8 L100 10"/></svg>' : ''}</div>
        <div class="stack"><div class="board">${side(me, ex.myChar, 'l')}<div class="score">${known ? `<span class="n${mine > theirs ? ' w' : ''}">${mine}</span><i>–</i><span class="n${theirs > mine ? ' w' : ''}">${theirs}</span>` : '<i>vs</i>'}</div>${side(opp, ex.oppChar, 'r')}</div>
        ${gamesHtml(ex.games)}
        ${ep.html}
        <div class="sub"><small>${E(game || '')}</small>
            ${ex.streak ? `<span class="streak ${kind === 'won' ? 'hot' : 'cold'}">${ex.hot ? fc.ui.ic('flame', 'fill') : ''}${E(ex.streak)}</span>` : ''}
            ${(ex.lines || []).length ? `<span class="extra">${ex.lines.map(E).join('  ·  ')}</span>` : ''}
            ${rematchHtml(ex.rematch)}
        </div></div>`, ex.rematch && ex.rematch.opp ? 8500 : 5600);
    wireRematch(ex.rematch);
    countUp(document.querySelector('#fcmsOverlay .elo .n'), ep.from, ep.to, 1100);
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

// Characters per set, from the emulator's files: when the games-won total goes up, the
// characters on screen played the game that just ended. c = { total, mine: {char: games}, theirs, lastMine, lastTheirs,
// games: [{ w: 1 | 0, m: my char, t: theirs }] in order, sm / st: the scores last seen }
function charStep(c, s) {
    if (!s) return c;
    const sm = s.mine.score || 0, st = s.theirs.score || 0, total = sm + st;
    if (!c) c = { total, mine: {}, theirs: {}, lastMine: '', lastTheirs: '', games: [], sm, st };
    if (total > c.total) {
        const n = total - c.total;
        if (s.mine.char) c.mine[s.mine.char] = (c.mine[s.mine.char] || 0) + n;
        if (s.theirs.char) c.theirs[s.theirs.char] = (c.theirs[s.theirs.char] || 0) + n;
        // game by game (two at once, between polls: yours first, the order isn't known)
        const add = (w, k) => { for (let i = 0; i < k && c.games.length < 99; i++) c.games.push({ w, m: s.mine.char || '', t: s.theirs.char || '' }); };
        add(1, Math.max(0, sm - c.sm));
        add(0, Math.max(0, st - c.st));
    }
    c.sm = Math.max(c.sm, sm);
    c.st = Math.max(c.st, st);
    c.total = Math.max(c.total, total);
    if (s.mine.char) c.lastMine = s.mine.char;
    if (s.theirs.char) c.lastTheirs = s.theirs.char;
    return c;
}

function trackEmu(m) {
    const e = fc.emu && fc.emu.match(m.quark);
    const s = e && fc.emu.sides(e, fc.app.me());
    if (!s) return;
    m.chars = charStep(m.chars, s);
    if (s.theirs.char && s.theirs.char !== m.oppCharSeen) {
        m.oppCharSeen = s.theirs.char;
        fc.emit('match:character', { quark: m.quark, opp: m.opp, rom: m.rom || e.rom || '', char: s.theirs.char });
    }
    m.emuScore = { mine: s.mine.score, theirs: s.theirs.score };
}

function recordSet(set) {
    H().add(set);
    refreshSessionPill();
}

// the lines under the score, built AFTER the set was recorded
function extrasFor(kind, opp, before, elo) {
    const ex = { lines: [] };
    if (elo && elo.start > 0 && elo.end > 0) ex.elo = { start: elo.start, end: elo.end };
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
        let pill = actions.querySelector('.fcmsPill');
        if (!cfg.enabled || !cfg.session || !sets.length) { if (pill) pill.remove(); return; }
        if (!pill) {
            pill = document.createElement('div');
            pill.className = 'fcmsPill';
            pill.title = T("Tonight's sets");
            pill.addEventListener('mousedown', (e) => e.stopPropagation());
            pill.addEventListener('click', (e) => { e.stopPropagation(); toggleSessionCard(pill); });
            fc.ui.header.place(actions, pill, 'session');
        }
        const st = streakOf(sets);
        const hot = st.kind === 'won' && st.n >= 2;
        const txt = fc.fmt.wl(r) + (hot ? String(st.n) : '');
        if (pill.textContent !== txt) pill.innerHTML = fc.ui.ic('trophy') + E(fc.fmt.wl(r)) + (hot ? `<span class="fcmsHot" title="${E(T('{n} WIN STREAK', { n: st.n }))}">${fc.ui.ic('flame', 'fill')}${st.n}</span>` : '');
        pill.classList.toggle('fcms-joined', !!actions.querySelector('.fcglPill'));
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
    const streak = st.n >= 2 ? `<span class="st ${st.kind === 'won' ? 'hot' : 'cold'}">${st.kind === 'won' ? fc.ui.ic('flame', 'fill') + E(T('{n} win streak', { n: st.n })) : E(T('{n} losses in a row', { n: st.n }))}</span>` : '';
    const nightly = nightHtml(sessionSets());
    box.innerHTML = fc.ui.popHead({ icon: 'trophy', title: T('Tonight'), extra: streak,
        sub: E(r.w + 'W · ' + r.l + 'L' + (r.d ? ' · ' + r.d + 'D' : '') + (r.unknown ? ' · ' + T('{n} unknown', { n: r.unknown }) : '')) }) +
        `<div class="fc-pb">${nightly}<table>${rows}</table></div>` +
        fc.ui.popFoot('',
            fc.ui.btn('Clear', { kind: 'ghost', size: 'sm', act: 'clear', title: 'Start a fresh session (the history is kept)' }) +
            (sets.length ? fc.ui.btn('Share', { kind: 'ghost', size: 'sm', icon: 'share', act: 'share' }) : '') +
            fc.ui.btn('All stats', { kind: 'sec', size: 'sm', icon: 'chart', act: 'all', title: T('History kept · {n} sets', { n: fc.fmt.num(H().all().length) }) }));
    box.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]');
        if (!a) return;
        e.stopPropagation();
        const act = a.getAttribute('data-act');
        if (act === 'pop-close') return;
        closeSessionCard();
        const stats = fc.modules.get('stats');
        if (act === 'share' && stats && stats.share) stats.share();
        else if (act === 'all' && stats && stats.open) stats.open();
        else if (act === 'clear') { cfg.sessionClearedAt = Date.now(); store.save(); refreshSessionPill(); }
    });
    const me = sessionPop = fc.ui.popover(anchor, box, { cls: 'fcmsPop fc-pop-card', width: 340, onClose: () => { if (sessionPop === me) sessionPop = null; } });
}

// the night at a glance (2.15): a line of your wins minus losses, the best win and the toughest opponent
function nightStats(sets) {
    const known = sets.filter(s => s.result === 'won' || s.result === 'lost');
    let run = 0;
    const points = [[0, 0]].concat(known.map((s, i) => [i + 1, run += s.result === 'won' ? 1 : -1]));
    const strength = (s) => (s.oppElo || 0) * 10 + (s.oppRank || 0);
    const wins = known.filter(s => s.result === 'won' && s.opp);
    const best = wins.length ? wins.reduce((a, b) => (strength(b) > strength(a) ? b : a)) : null;
    const per = new Map();
    known.forEach(s => {
        if (!s.opp) return;
        const k = s.opp.toLowerCase();
        const o = per.get(k) || { opp: s.opp, w: 0, l: 0 };
        if (s.result === 'won') o.w++; else o.l++;
        per.set(k, o);
    });
    const losers = [...per.values()].filter(o => o.l > 0).sort((a, b) => (b.l - b.w) - (a.l - a.w) || b.l - a.l);
    return { points, best, toughest: losers.length && losers[0].l > losers[0].w ? losers[0] : null, n: known.length };
}
function nightHtml(sets) {
    const ns = nightStats(sets);
    if (ns.n < 3) return '';
    const last = ns.points[ns.points.length - 1][1];
    const span = Math.max(1, ...ns.points.map(p => Math.abs(p[1])));        // 0 in the middle
    const chart = fc.ui.chart.line([{ points: ns.points, area: true, color: last >= 0 ? 'var(--fc-success)' : 'var(--fc-danger)' }], { w: 312, h: 64, pad: 6, grid: 2, yMin: -span, yMax: span, dots: ns.n <= 20 });
    const items = [];
    if (ns.best) {
        const sub = [ns.best.oppRank ? T('Rank {rank}', { rank: fc.data.rankLetter(ns.best.oppRank) }) : '', ns.best.oppElo ? fc.fmt.num(ns.best.oppElo) + ' ELO' : ''].filter(Boolean).join(' · ');
        items.push({ label: T('Best win'), value: E(ns.best.opp), sub: E(sub), tone: 'up' });
    }
    if (ns.toughest) items.push({ label: T('Toughest'), value: E(ns.toughest.opp), sub: E(ns.toughest.w + '–' + ns.toughest.l), tone: 'down' });
    return `<div class="fcmsNight">${chart}</div>${items.length ? fc.ui.stats(items) : ''}`;
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

// 3.7: the set's score from that row's own data (Fightcade sends it whether or not it shows ELO,
// and even if you closed the emulator the moment the set ended): { mine, theirs } or null
function scoreOf(e, opp) {
    if (!e || typeof e !== 'object' || !Array.isArray(e.scores)) return null;
    const them = String((e.opponent && e.opponent.name) || '');
    if (opp && them && them.toLowerCase() !== String(opp).toLowerCase()) return null;     // another set's row
    const side = e.playerId === 1 ? 1 : 0;
    const mine = e.scores[side], theirs = e.scores[1 - side];
    if (typeof mine !== 'number' || typeof theirs !== 'number' || !(mine + theirs > 0)) return null;
    return { mine, theirs };
}
function endgameScore(before, opp) {
    const fresh = endgameRows().filter(r => !before.has(r));
    for (let i = fresh.length - 1; i >= 0; i--) {
        const box = fresh[i].querySelector('.endgameMessageWrapper');
        const vm = box && box.__vue__;
        const s = vm && vm.data ? scoreOf(vm.data.endgame, opp) : null;
        if (s) return s;
    }
    return null;
}

// (the won/lost line is about ELO points; a fallback when the row has no score)
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
        trackEmu(m);
        const es = m.emuScore;
        if (mine == null && es && es.mine != null && es.theirs != null && (!v || verdict(es.mine, es.theirs) === v)) {
            mine = es.mine; theirs = es.theirs; v = v || verdict(mine, theirs);
        }
        const myChar = m.chars ? fc.data.mainChar(m.chars.mine, m.chars.lastMine) : '';
        const oppChar = m.chars ? fc.data.mainChar(m.chars.theirs, m.chars.lastTheirs) : '';
        // the games one by one, when the emulator showed every one of them
        const games = m.chars && m.chars.games && mine != null && m.chars.games.length === mine + theirs ? m.chars.games.slice() : [];
        const before = streakOf(H().all());
        const ft = knownFt(m.opp);
        // your exact ELO before / after, when Fightcade sent it for this match (supporters)
        const real = m.rom ? fc.elo.mine(m.rom) : null;
        const elo = real && real.start && real.end && Date.now() - real.at < 3 * 60000 ? real : null;
        recordSet({ at: Date.now(), opp: m.opp || '', game: m.game || '', channel: m.channel || '', rom: m.rom || '', result: v || null,
            mine: mine == null ? null : mine, theirs: theirs == null ? null : theirs, quark: m.quark, ft: ft == null ? undefined : ft,
            startedAt: m.at, durSec: Math.round((Date.now() - m.at) / 1000),
            oppRank: m.oppRank || undefined, myRank: m.myRank || undefined, ping: m.ping == null ? undefined : m.ping, oppElo: m.oppElo || undefined,
            eloStart: elo ? elo.start : undefined, eloEnd: elo ? elo.end : undefined, myChar: myChar || undefined, oppChar: oppChar || undefined,
            games: games.length ? games : undefined });
        fc.emit('match:end', { quark: m.quark, opp: m.opp, result: v || null, mine, theirs });
        if (v) whenFocused(() => showResult(v, mine, theirs, m.opp, m.game,
            Object.assign(extrasFor(v, m.opp, before, elo) || {}, { rematch: { opp: m.opp, channel: m.channel, ft }, myChar, oppChar, games, rank: m.myRank, rom: m.rom })), 60000);
    };
    // 1. Fightcade's own end-of-match message (up to ~8 s): its score, else its won/lost line
    for (let i = 0; i < 16; i++) {
        const s = endgameScore(m.endgameBefore, m.opp);
        if (s) return finish(verdict(s.mine, s.theirs), s.mine, s.theirs);
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
    lateResult(m);
}

// 3.7 (issue #2): still unknown -- Fightcade's row can come late, the API can take minutes. Keep
// looking for 5 minutes and fill the result in (streaks, goals and stats follow set:updated)
async function lateResult(m) {
    const me = fc.app.me();
    const fill = (mine, theirs) => {
        const v = verdict(mine, theirs);
        if (!v || !H().update(m.quark, { result: v, mine, theirs })) return false;
        fc.log('late result for', m.quark, v, mine + '-' + theirs);
        refreshSessionPill();
        return true;
    };
    for (const wait of [10000, 20000, 30000, 60000, 90000, 90000]) {
        await sleep(wait);
        if (!cfg || !cfg.enabled) return;
        const s = endgameScore(m.endgameBefore, m.opp);
        if (s && fill(s.mine, s.theirs)) return;
        const q = await quarkResult(m.quark, me, m.opp);
        if (q && q.mine != null && q.theirs != null && (q.mine || q.theirs) && fill(q.mine, q.theirs)) return;
    }
    fc.log('no result for', m.quark, 'after 5 minutes');
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
    fc.emit('match:accepted', { opp, channel: activeChannelName() });
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
    if (current && quark === current.quark) trackEmu(current);
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

/* ---------- VS (3.1: arcade) ---------- */
#fcmsOverlay.vs { background: #0b0a0d; }
/* the game's art behind everything, the slanted halves in the players' rank colours over it */
#fcmsOverlay .art { position: absolute; left: -4%; top: -4%; right: -4%; bottom: -4%; background-size: cover; background-position: center;
    image-rendering: pixelated; filter: saturate(1.2) brightness(.5); animation: fcms-art 4.6s ease-out both; }
@keyframes fcms-art { from { transform: scale(1.12); } to { transform: scale(1); } }
#fcmsOverlay.vs .half { position: absolute; top: -10%; bottom: -10%; width: 62%; opacity: .86; }
#fcmsOverlay.vs .half.l { left: -12%; background: linear-gradient(90deg, var(--c) 0%, var(--c) 45%, transparent 100%); transform: skewX(-14deg);
    animation: fcms-left .5s cubic-bezier(.2,.9,.2,1) both; }
#fcmsOverlay.vs .half.r { right: -12%; background: linear-gradient(270deg, var(--c) 0%, var(--c) 45%, transparent 100%); transform: skewX(-14deg);
    animation: fcms-right .5s cubic-bezier(.2,.9,.2,1) both; }
#fcmsOverlay.vs .half::after { content: ''; position: absolute; left: 0; top: 0; right: 0; bottom: 0;
    background: repeating-linear-gradient(0deg, rgba(0,0,0,.12) 0 2px, transparent 2px 6px), linear-gradient(180deg, rgba(0,0,0,0) 25%, rgba(0,0,0,.7)); }
@keyframes fcms-left { from { transform: translateX(calc(-100% * var(--fc-move, 1))) skewX(-14deg); } to { transform: translateX(0) skewX(-14deg); } }
@keyframes fcms-right { from { transform: translateX(calc(100% * var(--fc-move, 1))) skewX(-14deg); } to { transform: translateX(0) skewX(-14deg); } }

#fcmsOverlay.vs .player { position: absolute; top: 5vh; width: 40%; display: flex; flex-direction: column; align-items: center; text-align: center; }
#fcmsOverlay.vs .player.l { left: 4%; animation: fcms-inl .55s .3s cubic-bezier(.2,1.3,.4,1) both; }
#fcmsOverlay.vs .player.r { right: 4%; animation: fcms-inr .55s .3s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes fcms-inl { from { opacity: 0; transform: translateX(calc(-30vw * var(--fc-move, 1))); } to { opacity: 1; transform: none; } }
@keyframes fcms-inr { from { opacity: 0; transform: translateX(calc(30vw * var(--fc-move, 1))); } to { opacity: 1; transform: none; } }
#fcmsOverlay .av { overflow: hidden; padding: .9vmin; background: #fff; transform: skewX(-8deg); box-shadow: 0 1.4vmin 5vmin rgba(0,0,0,.6), 1.2vmin 1.2vmin 0 rgba(0,0,0,.35); }
#fcmsOverlay .av .avatar { display: block; width: 21vmin; height: 21vmin; object-fit: cover; background: #222; transform: skewX(8deg) scale(1.1); }
#fcmsOverlay .plate { position: relative; margin-top: 2.6vmin; max-width: 100%; padding: .4vmin 4vmin; background: #0b0a0d; transform: skewX(-14deg);
    box-shadow: inset 0 -.6vmin 0 rgba(255,255,255,.12), 1vmin 1vmin 0 rgba(0,0,0,.45); }
#fcmsOverlay .player.l .plate { border-left: 1.4vmin solid #fff; }
#fcmsOverlay .player.r .plate { border-right: 1.4vmin solid #fff; }
#fcmsOverlay .pname { display: block; transform: skewX(14deg); color: #fff; font-weight: 900; font-style: italic; font-size: 6.6vmin; line-height: 1.15;
    letter-spacing: -.01em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 34vw;
    text-shadow: 0 .5vmin 0 rgba(0,0,0,.6); }
#fcmsOverlay .pmeta { display: flex; align-items: center; justify-content: center; margin-top: 1.6vmin; color: rgba(255,255,255,.9); font-size: 2.4vmin; font-weight: 700;
    text-shadow: 0 .3vmin .8vmin rgba(0,0,0,.6); }
#fcmsOverlay .pmeta > img { width: 3.4vmin; height: 2.4vmin; object-fit: cover; border-radius: .3vmin; margin-right: 1vmin; }
#fcmsOverlay .pmeta .ping { margin-left: 1.4vmin; padding: .2vmin 1vmin; border-radius: .6vmin; background: rgba(0,0,0,.45); font-size: 2vmin; }
#fcmsOverlay .rank { display: inline-flex; align-items: center; margin-left: 1.2vmin; }
#fcmsOverlay .rank .fc-tag { --sz: 4.4vmin; }
/* the character, on a big slanted plate */
#fcmsOverlay .cplate { position: relative; margin-top: 2.2vmin; padding: .6vmin 5vmin .8vmin; background: linear-gradient(180deg, #ffd166, #f0923a);
    transform: skewX(-14deg); box-shadow: 1vmin 1vmin 0 rgba(0,0,0,.45); animation: fcms-plate .45s .7s cubic-bezier(.2,1.6,.4,1) both; }
#fcmsOverlay .cplate b { display: block; transform: skewX(14deg); color: #1a0d00; font-weight: 900; font-style: italic; font-size: 5vmin; line-height: 1.05;
    letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
#fcmsOverlay .cplate small { position: absolute; left: 50%; top: -1.6vmin; transform: translateX(-50%) skewX(14deg); padding: .1vmin 1.2vmin; border-radius: .5vmin;
    background: #0b0a0d; color: #ffd166; font-size: 1.6vmin; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; }
@keyframes fcms-plate { from { opacity: 0; transform: skewX(-14deg) scale(calc(1 + .6 * var(--fc-move, 1))); } to { opacity: 1; transform: skewX(-14deg) scale(1); } }
#fcmsOverlay .cplate .fc-mu-face { position: absolute; left: -6vmin; top: 50%; width: 9vmin; height: 9vmin; margin-top: -4.5vmin; border-radius: .8vmin;
    transform: skewX(14deg); box-shadow: 0 0 0 .4vmin #0b0a0d, .6vmin .6vmin 0 rgba(0,0,0,.45); font-size: 3vmin; }
#fcmsOverlay .cplate .fc-mu-face b { font-size: 3.2vmin; }
/* beside the tape, under their side */
#fcmsOverlay .mutips { position: absolute; left: calc(50% + 35vmin); right: 3%; bottom: 13vh; max-width: 62vmin; margin-left: auto; padding: 1.4vmin 2.2vmin 1.5vmin; border-radius: .8vmin; background: rgba(8,7,12,.8); text-align: left;
    box-shadow: inset 0 0 0 .2vmin rgba(255,255,255,.14); animation: fcms-in .4s 1.1s both; }
#fcmsOverlay .mutips small { display: block; margin-bottom: .6vmin; color: #ffd166; font-size: 1.6vmin; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
#fcmsOverlay .mutips p { position: relative; margin: .5vmin 0 0; padding-left: 2vmin; color: #fff; font-size: 2.1vmin; font-weight: 600; line-height: 1.3; }
#fcmsOverlay .mutips p::before { content: ''; position: absolute; left: .2vmin; top: .8vmin; width: .8vmin; height: .8vmin; border-radius: 50%; background: #ffd166; }
#fcmsOverlay .mutips p.own { padding-left: 2.8vmin; color: #ffd166; }
#fcmsOverlay .mutips p.own::before { display: none; }
#fcmsOverlay .mutips p.own svg { position: absolute; left: 0; top: .3vmin; width: 2vmin; height: 2vmin; }
#fcmsOverlay .picks { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; margin-top: 1.8vmin; animation: fcms-in .4s .95s both; }
#fcmsOverlay .picks small { width: 100%; margin-bottom: .8vmin; color: rgba(255,255,255,.75); font-size: 1.7vmin; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; }
#fcmsOverlay .picks span { display: inline-flex; align-items: center; margin: 0 .5vmin .6vmin; padding: .35vmin 1.2vmin; border-radius: .6vmin; background: rgba(0,0,0,.5);
    color: #fff; font-size: 2.1vmin; font-weight: 800; box-shadow: inset 0 0 0 .2vmin rgba(255,255,255,.18); }
#fcmsOverlay .picks span i { margin-left: .9vmin; font-style: normal; color: #ffd166; }

#fcmsOverlay .vsword { position: absolute; left: 50%; top: 33vh; font-weight: 900; font-style: italic; font-size: 22vmin;
    line-height: 1; color: #fff; transform: translate(-50%,-50%);
    text-shadow: 0 0 3vmin #fff, 0 0 8vmin #f0b232, .8vmin 1vmin 0 #b3261e, -.4vmin -.4vmin 0 #22e3f2;
    animation: fcms-slam .42s .7s cubic-bezier(.3,1.6,.5,1) both; }
@keyframes fcms-slam { from { opacity: 0; transform: translate(-50%,-50%) scale(calc(1 + 2.2 * var(--fc-move, 1))) rotate(-10deg); }
                       to { opacity: 1; transform: translate(-50%,-50%) scale(1) rotate(0); } }
#fcmsOverlay.vs .ring { position: absolute; left: 50%; top: 33vh; width: 30vmin; height: 30vmin; margin: -15vmin 0 0 -15vmin; border-radius: 50%;
    border: 1vmin solid #fff; opacity: 0; pointer-events: none; animation: fcms-ring .7s .9s ease-out both; }
@keyframes fcms-ring { 0% { opacity: .9; transform: scale(.3); } 100% { opacity: 0; transform: scale(3.2); } }
#fcmsOverlay .sparks { position: absolute; left: 50%; top: 33vh; width: 0; height: 0; pointer-events: none; }
#fcmsOverlay .spark { position: absolute; left: 0; top: 0; width: 16vmin; height: .6vmin; margin-top: -.3vmin; border-radius: .3vmin; transform-origin: 0 50%;
    background: linear-gradient(90deg, #fff, #ffd166 40%, transparent); opacity: 0; animation: fcms-spark .55s .9s ease-out both; }
@keyframes fcms-spark { 0% { opacity: 1; transform: rotate(var(--a)) translateX(6vmin) scaleX(.2); }
                        100% { opacity: 0; transform: rotate(var(--a)) translateX(var(--d)) scaleX(1); } }
#fcmsOverlay .flash { position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: #fff; opacity: 0; pointer-events: none;
    animation: fcms-flash .5s .9s ease-out both; }
@keyframes fcms-flash { 0% { opacity: .85; } 100% { opacity: 0; } }
#fcmsOverlay.vs .shake { animation: fcms-shake .4s .9s linear both; }
@keyframes fcms-shake { 0%,100% { transform: translate(0,0); } 20% { transform: translate(calc(-1.2vmin * var(--fc-move, 1)), calc(.8vmin * var(--fc-move, 1))); }
    40% { transform: translate(calc(1vmin * var(--fc-move, 1)), calc(-.8vmin * var(--fc-move, 1))); } 60% { transform: translate(calc(-.8vmin * var(--fc-move, 1)), calc(-.4vmin * var(--fc-move, 1))); }
    80% { transform: translate(calc(.6vmin * var(--fc-move, 1)), calc(.6vmin * var(--fc-move, 1))); } }

/* the tale of the tape */
#fcmsOverlay .tape { position: absolute; left: 50%; bottom: 13vh; width: 64vmin; transform: translateX(-50%); padding: 1.6vmin 2.6vmin 1.4vmin;
    background: rgba(8,7,12,.82); box-shadow: inset 0 0 0 .2vmin rgba(255,255,255,.14), 0 2vmin 6vmin rgba(0,0,0,.5);
    clip-path: polygon(3vmin 0, 100% 0, calc(100% - 3vmin) 100%, 0 100%); animation: fcms-tape .45s 1.05s cubic-bezier(.2,1.2,.4,1) both; }
#fcmsOverlay .tape:empty { display: none; }
@keyframes fcms-tape { from { opacity: 0; transform: translateX(-50%) translateY(calc(4vmin * var(--fc-move, 1))); } to { opacity: 1; transform: translateX(-50%); } }
#fcmsOverlay .tape .row { display: flex; align-items: center; height: 4.4vmin; border-bottom: .15vmin solid rgba(255,255,255,.08); }
#fcmsOverlay .tape .row span { flex: 1; font-weight: 900; font-size: 3vmin; color: rgba(255,255,255,.88); font-style: italic; }
#fcmsOverlay .tape .row .a { text-align: left; }
#fcmsOverlay .tape .row .b { text-align: right; }
#fcmsOverlay .tape .row .k { flex: none; width: 22vmin; text-align: center; color: rgba(255,255,255,.55); font-size: 1.8vmin; font-style: normal; font-weight: 800;
    letter-spacing: .22em; text-transform: uppercase; }
#fcmsOverlay .tape .row .up { color: #ffd166; }
#fcmsOverlay .odds { display: flex; flex-wrap: wrap; align-items: center; margin-top: 1.4vmin; }
#fcmsOverlay .odds .pa, #fcmsOverlay .odds .pb { width: 8vmin; font-size: 3vmin; font-weight: 900; font-style: italic; color: #fff; }
#fcmsOverlay .odds .pb { text-align: right; }
#fcmsOverlay .odds .bar { position: relative; flex: 1; height: 2.2vmin; overflow: hidden; background: rgba(255,255,255,.1); transform: skewX(-14deg); }
#fcmsOverlay .odds .bar i { position: absolute; top: 0; bottom: 0; width: 100%; }
#fcmsOverlay .odds .ma { left: 0; background: var(--ca); transform-origin: 0 50%; transform: scaleX(var(--p)); animation: fcms-oddsa .9s 1.3s cubic-bezier(.2,.9,.2,1) both; }
#fcmsOverlay .odds .mb { right: 0; background: var(--cb); transform-origin: 100% 50%; transform: scaleX(calc(1 - var(--p))); animation: fcms-oddsb .9s 1.3s cubic-bezier(.2,.9,.2,1) both; }
@keyframes fcms-oddsa { from { transform: scaleX(.5); } to { transform: scaleX(var(--p)); } }
@keyframes fcms-oddsb { from { transform: scaleX(.5); } to { transform: scaleX(calc(1 - var(--p))); } }
#fcmsOverlay .odds small { width: 100%; margin-top: .8vmin; text-align: center; color: rgba(255,255,255,.55); font-size: 1.6vmin; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
#fcmsOverlay .game { position: absolute; left: 0; right: 0; bottom: 4.5vh; text-align: center; color: rgba(255,255,255,.8);
    font-size: 2.4vmin; font-weight: 700; letter-spacing: .4em; text-transform: uppercase; animation: fcms-in .5s 1.1s both; }
#fcmsOverlay .game small { display: block; margin-top: 1vmin; font-size: 2vmin; letter-spacing: .08em; text-transform: none; color: rgba(255,255,255,.9); }
html.fc-still #fcmsOverlay .art, html.fc-still #fcmsOverlay .ring, html.fc-still #fcmsOverlay .spark { animation: none !important; }

/* ---------- results (3.1: arcade) ---------- */
#fcmsOverlay.res .art { filter: saturate(1.1) brightness(.26) blur(.4vmin); }
#fcmsOverlay.res .rays { position: absolute; left: 50%; top: 19vh; width: 220vmax; height: 220vmax; margin: -110vmax 0 0 -110vmax;
    opacity: .35; animation: fcms-spin 14s linear infinite; }
@keyframes fcms-spin { to { transform: rotate(360deg); } }
#fcmsOverlay.res .big { position: absolute; left: 0; right: 0; top: 19vh; text-align: center; transform: translateY(-50%); }
#fcmsOverlay.res .stack { position: absolute; left: 0; right: 0; top: 33vh; display: flex; flex-direction: column; align-items: center; }
#fcmsOverlay.res .big span { display: inline-block; font-weight: 900; font-style: italic; font-size: 16vmin; line-height: 1.05; letter-spacing: -.02em; white-space: nowrap;
    padding: 0 3vmin; transform: skewX(-6deg); -webkit-background-clip: text; background-clip: text; color: transparent; }
#fcmsOverlay.res .board { display: flex; align-items: center; animation: fcms-in .4s .55s both; }
#fcmsOverlay.res .side { display: flex; flex-direction: column; align-items: center; width: 24vmin; color: #fff; }
#fcmsOverlay.res .side .avatar { width: 9vmin; height: 9vmin; object-fit: cover; background: #222; border: .5vmin solid #fff; transform: skewX(-8deg); box-shadow: .8vmin .8vmin 0 rgba(0,0,0,.4); }
#fcmsOverlay.res .side b { margin-top: 1.2vmin; max-width: 24vmin; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 3vmin; font-weight: 900; font-style: italic; text-transform: uppercase; }
#fcmsOverlay.res .side small { margin-top: .4vmin; color: #ffd166; font-size: 2vmin; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
#fcmsOverlay.res .score { display: flex; align-items: center; margin: 0 2vmin; }
#fcmsOverlay.res .score .n { display: inline-block; min-width: 11vmin; padding: .5vmin 2vmin; text-align: center; background: rgba(0,0,0,.6); color: rgba(255,255,255,.7);
    font-size: 11vmin; font-weight: 900; font-style: italic; line-height: 1; transform: skewX(-12deg); box-shadow: inset 0 0 0 .3vmin rgba(255,255,255,.15), 1vmin 1vmin 0 rgba(0,0,0,.4); }
#fcmsOverlay.res .score .n.w { color: #fff; box-shadow: inset 0 0 0 .4vmin rgba(255,255,255,.6), 1vmin 1vmin 0 rgba(0,0,0,.4), 0 0 4vmin var(--glow, rgba(255,209,102,.5)); }
#fcmsOverlay.res .score i { margin: 0 2vmin; color: rgba(255,255,255,.6); font-size: 6vmin; font-weight: 900; font-style: italic; }
/* game by game */
#fcmsOverlay.res .games { display: flex; flex-wrap: wrap; justify-content: center; max-width: 88vw; margin-top: 3vmin; }
#fcmsOverlay.res .games .g { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 5.4vmin; margin: 0 .5vmin .8vmin; padding: .4vmin 1vmin;
    transform: skewX(-12deg); font-style: italic; animation: fcms-game .35s calc(.9s + var(--i) * .09s) cubic-bezier(.2,1.6,.4,1) both; }
#fcmsOverlay.res .games .g b { transform: skewX(12deg); font-size: 3.2vmin; font-weight: 900; line-height: 1.1; }
#fcmsOverlay.res .games .g small { transform: skewX(12deg); font-size: 1.4vmin; font-weight: 800; font-style: normal; white-space: nowrap; opacity: .85; }
#fcmsOverlay.res .games .g.w { background: #ffd166; color: #2a1a00; }
#fcmsOverlay.res .games .g.l { background: rgba(242,63,67,.85); color: #fff; }
@keyframes fcms-game { from { opacity: 0; transform: skewX(-12deg) translateY(calc(2vmin * var(--fc-move, 1))) scale(.6); } to { opacity: 1; transform: skewX(-12deg); } }
/* ELO + rank progress */
#fcmsOverlay.res .elo { display: flex; flex-wrap: wrap; align-items: center; width: 56vmin; margin-top: 3vmin; color: #fff; animation: fcms-in .4s .8s both; }
#fcmsOverlay.res .elo > .fc-tag { --sz: 6vmin; margin-right: 2vmin; }
#fcmsOverlay.res .elo .nums { display: flex; align-items: baseline; flex: 1; }
#fcmsOverlay.res .elo .nums .n { font-size: 5vmin; font-weight: 900; font-style: italic; }
#fcmsOverlay.res .elo .nums small { margin-left: 1.2vmin; color: rgba(255,255,255,.6); font-size: 1.8vmin; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
#fcmsOverlay.res .elo .d { margin-left: 1.4vmin; padding: .2vmin 1vmin; border-radius: .6vmin; font-size: 2.6vmin; font-weight: 900; animation: fcms-in .3s 2s both; }
#fcmsOverlay.res .elo .d.up { background: #248046; }
#fcmsOverlay.res .elo .d.dn { background: #b3261e; }
#fcmsOverlay.res .elo .bar { position: relative; width: 100%; height: 1.6vmin; margin-top: 1vmin; overflow: hidden; background: rgba(255,255,255,.12); transform: skewX(-14deg); }
#fcmsOverlay.res .elo .bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: var(--c); transform-origin: 0 50%; transform: scaleX(var(--b));
    animation: fcms-rank 1.1s .9s cubic-bezier(.2,.9,.2,1) both; }
@keyframes fcms-rank { from { transform: scaleX(var(--a)); } to { transform: scaleX(var(--b)); } }
#fcmsOverlay.res .elo .nx { width: 100%; margin-top: .8vmin; text-align: right; color: rgba(255,255,255,.65); font-size: 1.8vmin; font-weight: 700; }
#fcmsOverlay.res .elo .burst { margin-left: auto; padding: .4vmin 1.6vmin; background: #ffd166; color: #2a1a00; transform: rotate(-8deg);
    font-size: 2.8vmin; font-weight: 900; font-style: italic; box-shadow: 0 0 3vmin rgba(255,209,102,.7); animation: fcms-pop3 .5s 2s cubic-bezier(.2,1.6,.4,1) both; }
#fcmsOverlay.res .sub { margin-top: 3vmin; text-align: center; color: rgba(255,255,255,.92);
    font-size: 3vmin; font-weight: 800; animation: fcms-in .5s 1s both; }
#fcmsOverlay.res .sub small { display: block; font-size: 2vmin; font-weight: 700; letter-spacing: .35em; text-transform: uppercase; color: rgba(255,255,255,.55); }

#fcmsOverlay.won { background: radial-gradient(ellipse at 50% 30%, #6b4a00 0%, #2a1c00 45%, #0c0800 100%); }
#fcmsOverlay.won .rays { background: repeating-conic-gradient(from 0deg, rgba(255,209,102,.45) 0deg 6deg, transparent 6deg 18deg); }
#fcmsOverlay.won .big span { background-image: linear-gradient(180deg, #fffbe6 0%, #ffd166 38%, #f0923a 52%, #ffe9a8 66%, #f0b232 100%);
    -webkit-text-stroke: .35vmin #5a3a00; filter: drop-shadow(0 1.2vmin 0 #5a3a00) drop-shadow(0 0 3vmin rgba(240,178,50,.6));
    animation: fcms-punch .55s .1s cubic-bezier(.2,1.7,.4,1) both; }
@keyframes fcms-punch { from { opacity: 0; transform: skewX(-6deg) scale(calc(1 - .8 * var(--fc-move, 1))); } to { opacity: 1; transform: skewX(-6deg) scale(1); } }
#fcmsOverlay.won .shake { animation: fcms-shake .35s .55s linear both; }
#fcmsOverlay.won .bit { position: absolute; left: 50%; top: 19vh; width: 1.6vmin; height: 1.6vmin; border-radius: .3vmin;
    animation: fcms-burst 1.6s .2s cubic-bezier(.1,.8,.3,1) both; }
@keyframes fcms-burst { from { transform: translate(0,0) rotate(0); opacity: 1; }
                        to { transform: translate(var(--x), var(--y)) rotate(var(--r)); opacity: 0; } }
#fcmsOverlay.won .flash { animation: fcms-flash .45s .5s ease-out both; }

#fcmsOverlay.lost { background: radial-gradient(ellipse at 50% 30%, #5a0d10 0%, #26070a 50%, #0a0203 100%); }
#fcmsOverlay.lost .rays { background: repeating-conic-gradient(from 0deg, rgba(242,63,67,.25) 0deg 4deg, transparent 4deg 20deg); opacity: .22; }
#fcmsOverlay.lost .big span { background-image: linear-gradient(180deg, #ffd0d0 0%, #f23f43 40%, #8b0000 60%, #f23f43 100%);
    -webkit-text-stroke: .3vmin #2a0003; filter: drop-shadow(0 1.2vmin 0 #3a0003) drop-shadow(0 0 4vmin rgba(139,0,0,.8)) saturate(.85);
    animation: fcms-drop .5s .1s cubic-bezier(.5,0,.8,.4) both; }
@keyframes fcms-drop { from { opacity: 0; transform: skewX(-6deg) translateY(calc(-40vh * var(--fc-move, 1))) scale(1.3); } to { opacity: 1; transform: skewX(-6deg); } }
#fcmsOverlay.lost .crack { position: absolute; left: 50%; top: 50%; width: 70vmin; height: 6vmin; margin: -3vmin 0 0 -35vmin; overflow: visible; pointer-events: none; }
#fcmsOverlay.lost .crack path { fill: none; stroke: rgba(255,255,255,.85); stroke-width: .6; vector-effect: non-scaling-stroke; stroke-dasharray: 140; stroke-dashoffset: 140;
    animation: fcms-crack .35s .6s ease-out both; }
@keyframes fcms-crack { to { stroke-dashoffset: 0; } }
#fcmsOverlay.lost .shake { animation: fcms-shake .45s .6s linear both; }
#fcmsOverlay.lost .score .n.w { --glow: rgba(242,63,67,.5); }

#fcmsOverlay.draw { background: radial-gradient(ellipse at 50% 30%, #1f2c4a 0%, #0f1526 55%, #06080f 100%); }
#fcmsOverlay.draw .rays { background: repeating-conic-gradient(from 0deg, rgba(160,180,220,.25) 0deg 5deg, transparent 5deg 20deg); }
#fcmsOverlay.draw .big span { background-image: linear-gradient(180deg, #ffffff 0%, #cfd8ea 45%, #7f8db0 60%, #dfe6f5 100%);
    -webkit-text-stroke: .3vmin #20263a; filter: drop-shadow(0 1.2vmin 0 #20263a) drop-shadow(0 0 4vmin rgba(88,101,242,.6));
    animation: fcms-punch .55s .1s cubic-bezier(.2,1.5,.4,1) both; }
#fcmsOverlay.draw .score .n { --glow: rgba(160,180,220,.4); }
#fcmsOverlay.res .streak { display: inline-block; margin-top: 1.8vmin; padding: .6vmin 2.4vmin; font-size: 2.6vmin; font-weight: 900; font-style: italic; letter-spacing: .08em;
    transform: skewX(-12deg); animation: fcms-pop2 .5s 1.2s cubic-bezier(.2,1.6,.4,1) both; }
#fcmsOverlay.res .streak.hot { background: #ffd166; color: #3a2400; box-shadow: 0 0 3vmin rgba(255,209,102,.6); }
#fcmsOverlay.res .streak.cold { background: rgba(255,255,255,.12); color: rgba(255,255,255,.85); }
@keyframes fcms-pop2 { from { opacity: 0; transform: skewX(-12deg) scale(.4); } to { opacity: 1; transform: skewX(-12deg) scale(1); } }
@keyframes fcms-pop3 { from { opacity: 0; transform: rotate(-8deg) scale(.4); } to { opacity: 1; transform: rotate(-8deg) scale(1); } }
#fcmsOverlay.res .rematch { display: inline-block; margin: 1.8vmin 0 0 1.6vmin; padding: 1.1vmin 3.4vmin; cursor: pointer; transform: skewX(-12deg);
    font-size: 2.4vmin; font-weight: 900; font-style: italic; letter-spacing: .04em; color: #fff; background: rgba(88,101,242,.95);
    box-shadow: 0 0 0 .2vmin rgba(255,255,255,.3), .8vmin .8vmin 0 rgba(0,0,0,.4), 0 0 2.4vmin rgba(88,101,242,.6); pointer-events: auto; transition: transform .12s ease, filter .12s ease; }
#fcmsOverlay.res .rematch:hover { transform: skewX(-12deg) translateY(-2px) scale(1.04); filter: brightness(1.12); }
#fcmsOverlay.res .rematch.off { background: rgba(255,255,255,.12); box-shadow: none; cursor: default; font-size: 1.9vmin; transform: skewX(-12deg); }
#fcmsOverlay.res .rematch.sent { background: #248046; box-shadow: 0 0 2.4vmin rgba(36,128,70,.6); }
#fcmsOverlay.res .extra { display: block; margin-top: 1.4vmin; font-size: 2.2vmin; font-weight: 700; color: rgba(255,255,255,.75); animation: fcms-in .5s 1.3s both; }
#fcmsOverlay .hint { position: absolute; right: 2.4vmin; bottom: 2vmin; font-size: 1.6vmin; color: rgba(255,255,255,.35); }
.fcmsPill { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; margin-right: 8px; border-radius: var(--fc-r1);
    background: var(--fc-btn); color: #fff; font: 600 14px/32px var(--fc-font); cursor: pointer; user-select: none; white-space: nowrap; }
.fcmsPill:hover { background: var(--fc-btn-h); }
.fcmsPill.fcms-joined { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.fcmsPill .fcmsHot { display: inline-flex; align-items: center; margin-left: 8px; color: #ff8a3d; font-weight: 800; }
.fcmsPill .fcmsHot .fc-ic { width: 14px; height: 14px; margin-right: 2px; }
.fc-pop.fcmsPop { max-height: 70vh; }
#fcmsSession .st { display: inline-flex; align-items: center; margin-right: 4px; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 700; white-space: nowrap; }
#fcmsSession .st .fc-ic { margin-right: 3px; }
#fcmsSession .fcmsNight { margin: 2px 0 0; padding: 6px 4px 2px; border-radius: var(--fc-r2); background: var(--fc-s1); line-height: 0; }
#fcmsSession .fcmsNight .fc-chart { width: 100%; height: auto; }
#fcmsSession .fc-stats { margin-top: 8px; }
#fcmsSession .st.hot { background: #ffd166; color: #3a2400; }
#fcmsSession .st.cold { background: rgba(242,63,67,.15); color: var(--fc-danger); }
#fcmsSession table { width: 100%; margin-top: 4px; border-collapse: collapse; table-layout: fixed; }
#fcmsSession td { padding: 4px 0; font-size: 13px; }
#fcmsSession td:first-child { width: 20px; }
#fcmsSession td.o { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px; }
#fcmsSession td.s { width: 44px; text-align: right; color: var(--fc-head); }
#fcmsSession td.t { width: 70px; text-align: right; color: var(--fc-muted); font-size: 12px; }
#fcmsSession b.w { color: var(--fc-success); } #fcmsSession b.l { color: var(--fc-danger); } #fcmsSession b.u { color: #80848e; }

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
    // The VS the moment a set is agreed (2.16), not when the emulator's match shows up:
    //   you accept: Fightcade's root.acceptChallenge (its own button AND Fightcord's challenge card)
    //   they accept yours: Fightcade's onChallengeAccept callback, before the chat row is drawn
    const nameOf = (u) => String((u && (u.name || u.id)) || u || '').trim();
    const accepted = (who) => { const n = nameOf(who); if (n && !fc.app.isMe(n) && !fc.app.inMatch(fc.app.me())) vsOnce(n); };
    fc.hooks.method(() => fc.app.root(), 'acceptChallenge', { before(channel, user) { accepted(user); } });
    ['connectionCallbacks', 'genericCallbacks'].forEach(k => fc.hooks.method(() => { const r = fc.app.root(); return r && r[k]; }, 'onChallengeAccept', { before(user) { accepted(user); } }));
    fc.watch(() => { scanAccepted(); refreshSessionPill(); });
    fc.tick(poll, 500, { whileHidden: true });
    fc.on('set:recorded', refreshSessionPill);
    fc.on('history:merged', refreshSessionPill);

    fc.cmd('vs', 'Match screens: previews and help', (arg) => {
        const a = String(arg || '').toLowerCase();
        const opp = standIn(), game = gameName();
        // made-up games for the previews (W / L in order), and your rank in this channel
        const games = (wl) => wl.split('').map(c => ({ w: c === 'W' ? 1 : 0, m: '', t: '' }));
        const rank = fc.data.rankNum(card(fc.app.me() || '').rank) || 4;
        if (a === 'test') showVs(fc.app.me() || T('You'), opp);
        else if (a === 'win') showResult('won', 3, 1, opp, game, { streak: T('{n} WIN STREAK', { n: 3 }), hot: true, games: games('WLWW'), elo: { start: 1582, end: 1601 }, rank,
            lines: [T("You're {record} vs {name}", { record: '4–2', name: opp }), T('Tonight {record}', { record: '7–3' })] });
        else if (a === 'lose') showResult('lost', 1, 3, opp, game, { streak: T('Streak of {n} ended', { n: 3 }), games: games('LWLL'), rank,
            lines: [T("You're {record} vs {name}", { record: '4–3', name: opp }), T('Tonight {record}', { record: '7–4' })] });
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
            { key: 'vsTips', type: 'switch', label: 'Matchup tips on the VS screen', hint: 'How to beat the character they play, from the matchup guide', show: (d) => d.enabled && d.vs },
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
    charStep,
    // the running match from the emulator: { quark, mine: {name, rank, score, char}, theirs } or null
    live() { if (!current) return null; const e = fc.emu.match(current.quark); const s = e && fc.emu.sides(e, fc.app.me()); return s ? Object.assign({ quark: current.quark }, s) : null; },
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
    picksOf, tapeOf,
    _quarkResult: (...a) => quarkResult(...a),
    _poll: () => poll(),
    _vsOnce: (n) => vsOnce(n),
    _vsShown: () => vsShown,
    get _config() { return cfg; }
};

module.exports = { id: 'match-screens', name: 'Match screens & session tracker', start, nightStats, scoreOf };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
