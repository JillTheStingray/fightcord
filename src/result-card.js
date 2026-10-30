/**
 * Match result cards -- Fightcade's "Ranked match result - A 2 FT2 0 B" / "You have just finished
 * a game vs X" line (with its long replay URL) becomes a scoreboard: both players, the score big in
 * the middle, the characters you both played (when Fightcord saw them), Watch replay, Rematch and
 * Copy link. Only you see it; Settings -> Chat -> Match result cards turns it off.
 *
 * Fightcade's own message stays in the chat, hidden (match-screens.js reads its won/lost line).
 * The data comes from its component (__vue__.data.endgame), else from its text.
 */
'use strict';

let fc = null, store = null, cfg = null;
const mod = (id) => fc.modules.get(id);
const T = (s, v) => (fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));
const E = (s) => fc.fmt.esc(s);
const lc = (s) => String(s || '').toLowerCase();
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

/* ================================================================ pure parts */

// a replay link -> { emu, rom, quark }
function replayParts(url) {
    const m = /^https:\/\/replay\.fightcade\.com\/([a-z0-9_]+)\/([a-z0-9_]+)\/([0-9a-z_-]+)\/?$/i.exec(String(url || ''));
    return m ? { emu: m[1], rom: m[2], quark: m[3] } : { emu: '', rom: '', quark: '' };
}
// Fightcade's endgame data (or, without it, the message's text + replay link) -> what the card shows:
// { ranked, ft, me, opp, my, their, outcome: 'won'|'lost'|'draw'|'', quit, elo: { from, to }|null, replay, emu, rom, quark }
function parseEndgame(src, myName) {
    const out = { ranked: false, ft: 0, me: myName || '', opp: '', my: null, their: null, outcome: '', quit: false, elo: null, replay: '', emu: '', rom: '', quark: '' };
    const e = src && src.endgame;
    if (e && typeof e === 'object') {
        const side = e.playerId === 1 ? 1 : 0, sc = Array.isArray(e.scores) ? e.scores : [];
        out.me = String(e.name || myName || '');
        out.opp = String((e.opponent && e.opponent.name) || '');
        out.ft = num(e.ranked) || 0;
        out.ranked = out.ft > 0;
        out.my = num(sc[side]);
        out.their = num(sc[1 - side]);
        // Fightcade's rule: a ranked set nobody reached the FT in wasn't finished
        out.quit = out.ranked && out.my != null && out.their != null && out.ft > out.my && out.ft > out.their;
        const a = num(e.initialElo), b = num(e.finalElo);
        if (a > 0 && b > 0) out.elo = { from: a, to: b };
        out.replay = String(e.replayUrl || '');
    } else if (src && typeof src.text === 'string') {
        const t = src.text.replace(/\s+/g, ' ').trim();
        // "Ranked match result - P1 2 FT2 0 P2": you're whichever side has your name
        const r = /Ranked match result\s*-\s*(.+?)\s+(\d+)\s+FT(\d+)\s+(\d+)\s+(.+)$/i.exec(t);
        const c = /just finished a game vs\s+(.+)$/i.exec(t);
        if (r) {
            const p1 = r[1].trim(), p2 = r[5].trim(), s1 = +r[2], s2 = +r[4];
            const meFirst = !myName || lc(p1) === lc(myName) || lc(p2) !== lc(myName);
            out.ranked = true; out.ft = +r[3];
            out.me = meFirst ? p1 : p2; out.opp = meFirst ? p2 : p1;
            out.my = meFirst ? s1 : s2; out.their = meFirst ? s2 : s1;
            out.quit = out.ft > out.my && out.ft > out.their;
        } else if (c) out.opp = c[1].trim();
        else return null;
        out.replay = String(src.href || '');
    } else return null;
    if (!out.opp) return null;
    if (out.my != null && out.their != null && (out.my || out.their)) out.outcome = out.my > out.their ? 'won' : out.my < out.their ? 'lost' : 'draw';
    Object.assign(out, replayParts(out.replay));
    if (!out.quark) out.replay = /^https:\/\//.test(out.replay) ? out.replay : '';
    return out;
}
// the set Fightcord recorded for this message: the same match id, else the newest one vs them (15 min)
function setFor(sets, r, now) {
    const list = (sets || []).filter(s => s && lc(s.opp) === lc(r.opp));
    return (r.quark && list.find(s => String(s.quark || '') === r.quark)) ||
        list.filter(s => now - (s.at || 0) < 15 * 60000).pop() || null;
}

module.exports = { id: 'result-card', name: 'Match result cards', start: (f) => start(f), parseEndgame, replayParts, setFor };

/* ================================================================== browser */

// what Fightcade put in the row
function readRow(row) {
    const box = row.querySelector('.endgameMessageWrapper');
    if (!box) return null;
    const vm = box.__vue__;
    if (vm && vm.data && vm.data.endgame) return parseEndgame(vm.data, fc.app.me());
    const h = box.querySelector('h3'), a = box.querySelector('a[href]');
    return parseEndgame({ text: h ? h.textContent : '', href: a ? a.getAttribute('href') : '' }, fc.app.me());
}
const chanOf = (row) => { const w = row.closest('.channelWrapper'); return (w && w.__vue__ && w.__vue__.channel && w.__vue__.channel.name) || fc.app.activeChannelId() || ''; };
const shortGame = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');

// one side: their character's face (when we know it), their avatar on its corner, name, flag, rank, WIN/LOSS
function sideHtml(name, ch, rom, res, right, chan) {
    const mg = mod('matchup-guide');
    const e = ch && mg && mg.find ? mg.find(rom, ch) : null;
    const [, u] = fc.app.user(name);
    const rank = u && u.channelRank && u.channelRank[chan] ? fc.data.rankLetter(u.channelRank[chan]) : '';
    const face = e && e.face
        ? `<div class="fcrcFace" title="${E(e.name || ch)}"><img src="${E(e.face)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('none')"><span>${E(e.name || ch)}</span></div>`
        : '';
    const av = fc.ui.avatar(name, { size: face ? 30 : 56, ring: 'var(--fcrc-bg)' });
    const label = res === 'won' ? T('Win') : res === 'lost' ? T('Loss') : res === 'draw' ? T('Draw') : '';
    return `<div class="fcrcSide${right ? ' r' : ''}${face ? ' hasFace' : ''}">` +
        `<div class="fcrcPics">${face}<div class="fcrcAv">${av}</div></div>` +
        `<div class="fcrcWho"><b class="fcrcName" title="${E(name)}">${E(name)}</b>` +
        `<div class="fcrcMeta">${u && u.country ? fc.ui.flag(u.country.iso_code || u.country, u.country.full_name || '') : ''}${rank ? fc.ui.tag(rank) : ''}` +
        (label ? `<span class="fcrcRes ${res}">${E(label)}</span>` : '') + `</div></div></div>`;
}

function cardHtml(r, set, row) {
    const rom = r.rom || (set && set.rom) || '';
    const ch = fc.app.channel ? fc.app.channel(chanOf(row)) : null;
    const game = shortGame((set && (set.game || set.channel)) || (ch && ch.name) || '');
    const mine = r.my != null ? r.my : set && set.mine != null ? set.mine : null;
    const theirs = r.their != null ? r.their : set && set.theirs != null ? set.theirs : null;
    const outcome = r.outcome || (set && set.result) || (mine != null && theirs != null && (mine || theirs) ? (mine > theirs ? 'won' : mine < theirs ? 'lost' : 'draw') : '');
    const opp = outcome === 'won' ? 'lost' : outcome === 'lost' ? 'won' : outcome;
    const ft = r.ft || (set && set.ft) || 0;
    const pill = r.ranked ? T('Ranked') + ' · FT' + ft : ft ? T('Casual') + ' · FT' + ft : T('Casual');
    const score = mine != null && theirs != null
        ? `<div class="fcrcScore"><b class="${mine > theirs ? 'hi' : ''}">${mine}</b><i>–</i><b class="${theirs > mine ? 'hi' : ''}">${theirs}</b></div>`
        : `<div class="fcrcScore vs">${E(T('vs'))}</div>`;
    const ms = mod('match-screens');
    const cs = ms && ms.challengeState ? ms.challengeState(r.opp, chanOf(row)) : null;
    const notes = [];
    if (r.quit) notes.push(`<span class="warn">${fc.ui.ic('warn')}${E(T('Not finished: unfinished ranked sets can lower your rank'))}</span>`);
    if (r.elo) notes.push(`<span>${E(T('Your ELO: {elo}', { elo: r.elo.to.toLocaleString() }))}</span>`);
    const art = rom ? `url(&quot;${E(fc.data.artUrl(rom, 'https://web.fightcade.com/'))}&quot;)` : 'none';
    return `<div class="fcrc ${outcome || 'none'}" style="--fcrc-art:${art}">` +
        `<div class="fcrcTop"><span class="fcrcPill${r.ranked ? ' ranked' : ''}">${E(pill)}</span>${game ? `<span class="fcrcGame">${E(game)}</span>` : ''}</div>` +
        `<div class="fcrcMid">${sideHtml(r.me || fc.app.me(), set && set.myChar, rom, outcome, false, chanOf(row))}${score}${sideHtml(r.opp, set && set.oppChar, rom, opp, true, chanOf(row))}</div>` +
        (notes.length ? `<div class="fcrcNotes">${notes.join('')}</div>` : '') +
        `<div class="fcrcBtns">` +
        (r.replay ? fc.ui.btn('Watch replay', { size: 'sm', icon: 'play', attrs: 'data-rc="replay"' }) : '') +
        (cs ? fc.ui.btn('Rematch', { size: 'sm', kind: 'sec', icon: 'swords', disabled: !cs.ok, title: cs.ok ? T('Challenge {name} again', { name: r.opp }) : T(cs.why), attrs: 'data-rc="rematch"' }) : '') +
        (r.replay ? fc.ui.btn('Copy link', { size: 'sm', kind: 'ghost', icon: 'copy', attrs: 'data-rc="copy"' }) : '') +
        `</div></div>`;
}

// which message the row holds right now: Fightcade reuses its rows for other messages as chat moves on
function rowSig(row) {
    const box = row.querySelector('.endgameMessageWrapper');
    if (!box) return null;
    const vm = box.__vue__;
    return vm && vm.data && vm.data.endgame ? vm.data.endgame : box.textContent;
}
function unpaint(row) {
    const c = row.querySelector(':scope > .fcrc');
    if (c) c.remove();
    row.classList.remove('fcrc-on');
    row.__fcrc = null;
}

// draw (or redraw, once the characters are known) one row's card
function paintRow(row, now) {
    const sig = rowSig(row);
    let r = row.__fcrc;
    if (!r || r.sig !== sig) r = row.__fcrc = { at: now, sig, data: readRow(row) };
    if (!r.data) { unpaint(row); row.__fcrc = r; return; }
    const set = setFor(fc.history.all(), r.data, now);
    const key = set ? [set.quark, set.myChar, set.oppChar, set.mine, set.theirs].join('|') : '';
    let card = row.querySelector(':scope > .fcrc');
    if (card && r.key === key) { row.classList.add('fcrc-on'); return; }
    // the set is written a moment after this line arrives: look again for half a minute
    if (!set && card && r.key != null && now - r.at < 30000) return;
    r.key = key;
    const html = cardHtml(r.data, set, row);
    if (!card) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        card = tmp.firstChild;
        row.appendChild(card);
    } else card.outerHTML = html;
    row.classList.add('fcrc-on');
}
function paint() {
    if (typeof document === 'undefined' || !cfg) return;
    const on = !!cfg.enabled, now = Date.now();
    // cards left behind in rows that now hold someone's normal message
    document.querySelectorAll('.chatContent .fcrc').forEach(c => {
        const row = c.parentNode;
        if (!on || !row || !row.matches || !row.matches('.messageWrapper.endgame')) { if (row && row.classList) unpaint(row); else c.remove(); }
    });
    if (!on) return;
    document.querySelectorAll('.chatContent .messageWrapper.endgame').forEach(row => {
        try { paintRow(row, now); } catch (e) { fc.log('result card', e.message); }
    });
}

function onClick(e) {
    const b = e.target.closest && e.target.closest('.fcrc [data-rc]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const row = b.closest('.messageWrapper.endgame');
    const r = row && row.__fcrc && row.__fcrc.data;
    if (!r || b.disabled) return;
    const what = b.dataset.rc;
    const label = (t) => { b.lastChild.textContent = t; };
    if (what === 'replay') { try { window.open(r.replay, '_blank'); } catch (err) { /* blocked */ } }
    else if (what === 'copy') { label(fc.ui.copy(r.replay) ? T('Copied') : T('Copy failed')); setTimeout(() => label(T('Copy link')), 1500); }
    else if (what === 'rematch') {
        const ms = mod('match-screens');
        const set = setFor(fc.history.all(), r, Date.now());
        const ft = r.ft || (set && set.ft) || undefined;
        const st = ms && ms.challenge ? ms.challenge(r.opp, ft, chanOf(row)) : null;
        label(st && st.ok ? T('Sent') : T(st ? st.why : 'Unavailable'));
        b.disabled = true;
    }
}

const CSS = `
html .chatContent .messageWrapper.endgame.fcrc-on > :not(.fcrc) { display: none !important; }
html .chatContent .messageWrapper.endgame.fcrc-on { padding: 4px 16px 4px 72px !important; background: none !important; }
.fcrc { --fcrc-bg: #1e1f24; --fcrc-glow: rgba(148,155,164,.35); position: relative; max-width: 560px; overflow: hidden; border-radius: 12px;
    background: linear-gradient(90deg, rgba(20,21,25,.96) 0%, rgba(20,21,25,.86) 45%, rgba(20,21,25,.96) 100%), var(--fcrc-art) center 30%/cover, var(--fcrc-bg);
    box-shadow: 0 0 0 1px rgba(255,255,255,.07), inset 3px 0 0 var(--fcrc-glow), 0 6px 22px -14px var(--fcrc-glow); font-family: var(--fc-font); color: #f2f3f5; }
.fcrc.won { --fcrc-glow: #23a55a; }
.fcrc.lost { --fcrc-glow: #f23f43; }
.fcrc::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 45%; pointer-events: none; background: radial-gradient(120% 90% at 0% 50%, var(--fcrc-glow), transparent 70%); opacity: .16; }
.fcrcTop { position: relative; display: flex; align-items: center; padding: 10px 14px 0; }
.fcrcPill { padding: 2px 8px; border-radius: 6px; background: rgba(255,255,255,.1); font: 800 11px/16px var(--fc-font); letter-spacing: .06em; text-transform: uppercase; color: #dbdee1; }
.fcrcPill.ranked { background: linear-gradient(90deg, #5865f2, #8a5cf6); color: #fff; }
.fcrcGame { margin-left: 8px; font-size: 12px; color: rgba(255,255,255,.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fcrcMid { position: relative; display: flex; align-items: center; padding: 10px 14px 4px; }
.fcrcSide { flex: 1; min-width: 0; display: flex; align-items: center; }
.fcrcSide.r { flex-direction: row-reverse; text-align: right; }
.fcrcPics { position: relative; flex: none; }
.fcrcFace { position: relative; width: 62px; height: 82px; overflow: hidden; border-radius: 10px; background: rgba(255,255,255,.06); box-shadow: 0 0 0 1px rgba(255,255,255,.1); }
.fcrcFace img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.fcrcFace span { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 3px 3px; background: linear-gradient(180deg, transparent, rgba(0,0,0,.85));
    font: 700 10px/12px var(--fc-font); text-align: center; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fcrcFace.none img { display: none; }
.fcrcSide.hasFace .fcrcFace span { padding-right: 16px; text-align: left; }
.fcrcSide.r.hasFace .fcrcFace span { padding: 10px 3px 3px 16px; text-align: right; }
.fcrcSide.hasFace .fcrcAv { position: absolute; right: -15px; bottom: -8px; line-height: 0; }
.fcrcSide.r.hasFace .fcrcAv { right: auto; left: -15px; }
.fcrcSide.hasFace .fcrcWho { margin-left: 22px; }
.fcrcSide.r.hasFace .fcrcWho { margin: 0 22px 0 0; }
.fcrcWho { min-width: 0; margin: 0 0 0 14px; }
.fcrcSide.r .fcrcWho { margin: 0 14px 0 0; }
.fcrcName { display: block; font: 800 15px/20px var(--fc-font); color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fcrcMeta { display: flex; align-items: center; margin-top: 3px; }
.fcrcSide.r .fcrcMeta { justify-content: flex-end; }
.fcrcMeta > * { margin-right: 6px; }
.fcrcSide.r .fcrcMeta > * { margin: 0 0 0 6px; }
.fcrcRes { padding: 1px 6px; border-radius: 4px; font: 800 10.5px/15px var(--fc-font); letter-spacing: .08em; text-transform: uppercase; }
.fcrcRes.won { background: rgba(35,165,90,.22); color: #3ddc84; }
.fcrcRes.lost { background: rgba(242,63,67,.2); color: #ff6b6e; }
.fcrcRes.draw { background: rgba(255,255,255,.12); color: #dbdee1; }
.fcrcScore { flex: none; display: flex; align-items: baseline; padding: 0 14px; font: 900 34px/1 var(--fc-font); color: rgba(255,255,255,.45); font-variant-numeric: tabular-nums; }
.fcrcScore b.hi { color: #fff; text-shadow: 0 0 18px var(--fcrc-glow); }
.fcrcScore i { margin: 0 8px; font-style: normal; font-weight: 400; color: rgba(255,255,255,.3); }
.fcrcScore.vs { font-size: 16px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.fcrcNotes { position: relative; display: flex; flex-wrap: wrap; padding: 4px 14px 0; font-size: 12px; color: rgba(255,255,255,.65); }
.fcrcNotes > span { display: inline-flex; align-items: center; margin-right: 12px; }
.fcrcNotes .warn { color: #f0b232; }
.fcrcNotes .fc-ic { width: 13px; height: 13px; margin-right: 5px; }
.fcrcBtns { position: relative; display: flex; flex-wrap: wrap; padding: 10px 14px 12px; }
.fcrcBtns .fc-btn { margin-right: 8px; }
`;

function start(f) {
    fc = f;
    store = fc.config('result-card', { enabled: true });
    cfg = store.data;
    fc.ui.style('fcrcStyle', CSS);
    fc.own(() => { fc.ui.style('fcrcStyle', null); cfg = null; });
    fc.settings.block({
        id: 'result-card', section: 'chat', title: 'Match result cards', hint: '— only you see these', store, order: 12,
        fields: [{ key: 'enabled', type: 'switch', label: 'Match result cards', hint: 'After your sets: the score, the characters you both played, Watch replay, Rematch and Copy link', onChange: () => paint() }]
    });
    if (typeof document !== 'undefined') {
        document.addEventListener('click', onClick, true);
        fc.own(() => document.removeEventListener('click', onClick, true));
    }
    fc.watch(paint, { selector: '.chatContent .messageWrapper.endgame, .chatContent .fcrc' });
    fc.on('match:end', () => setTimeout(paint, 300));
    fc.tick(paint, 3000);
    return api;
}

const api = { refresh: () => paint() };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
