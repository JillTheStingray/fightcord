/**
 * Fightcord member hover cards
 *
 * Rest the mouse on anyone in the member list and a Discord-style profile popout appears
 * next to it: avatar with status ring, rank, ping, what they're playing (with Watch), your
 * record vs them, your notes on them -- and Challenge / Friend / Notes / Head-to-head /
 * Scout buttons. It never clicks anything in Fightcade's list itself.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // hover-cards-config.json

const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
const mod = (id) => fc.modules.get(id);

/* --------------------------------------------------------------------- card */

let showT = 0, hideT = 0, current = '';
const opened = [];            // for the harness

function nameOf(row) {
    const n = row.querySelector('.playerName') || row.querySelector('.name');
    return n ? n.textContent.trim() : '';
}

function cardHtml(name, chanHint) {
    const all = fc.app.users();
    const u = all[name] || null;
    const isMe = fc.app.isMe(name);
    const ms = mod('match-screens'), fr = mod('friends'), nt = mod('notes');
    const chan = chanHint || fc.app.activeChannelId();
    const rank = fc.data.rankLetter((u && u.channelRank && u.channelRank[chan]) || 0);
    const conn = fc.fmt.conn(fc.app.userInfo(name));
    const cc = u && u.country ? String(u.country.iso_code || '').toLowerCase() : '';
    const playing = u && u.playing && u.playing.quarkId ? u.playing : null;
    const status = playing ? 'live' : u && u.away ? 'away' : u ? 'on' : 'off';
    let playLine = '';
    if (playing) {
        const opp = Object.keys(all).find(n => n !== name && all[n].playing && all[n].playing.quarkId === playing.quarkId) || '';
        const c = fc.app.channel(playing.channelId);
        const watch = c && c.spectators !== false && !isMe ? fc.data.watchUrl({ emu: c.emulator, rom: playing.gameId, quark: playing.quarkId, port: playing.port }) : '';
        playLine = `<div class="hcPlay"><div class="t">${E(T('In a match'))}${opp ? ' vs <b>' + E(opp) + '</b>' : ''}</div>
            <div class="g">${E(shortName(playing.channelId))}</div>${watch ? `<span class="hcWatch" data-watch="${E(watch)}">${fc.ui.ic('eye')}${E(T('Watch'))}</span>` : ''}</div>`;
    }
    const vs = !isMe ? fc.history.recordVs(name) : null;
    const isFr = !!(fr && fr.isFriend && fr.isFriend(name));
    const cst = !isMe && ms && ms.challengeState ? ms.challengeState(name) : null;
    const notes = nt && nt.chips ? nt.chips(name) : '';
    const pr = mod('presence');

    // 2.13: the shared card head; one line under it (in a match, else your record vs them)
    const marks = (isFr ? '<span class="hcStar" title="' + E(T('Friend')) + '">' + fc.ui.ic('star', 'fill') + '</span>' : '') + (pr && pr.mark ? pr.mark(name) : '');
    const meta = fc.ui.flag(cc) + (rank ? fc.ui.tag(rank) : '') +
        '<span>' + E([(u && u.country && (u.country.full_name || String(u.country.iso_code || '').toUpperCase())) || '', conn].filter(Boolean).join(' · ')) + '</span>';
    const vsLine = !playLine && vs && (vs.w || vs.l || vs.played)
        ? `<div class="hcVs"><span>${E(T('You vs {name}', { name }))}</span><b class="${vs.w > vs.l ? 'up' : vs.w < vs.l ? 'down' : ''}">${vs.w}–${vs.l}</b>${vs.played ? `<small>${E(T('{n} sets', { n: vs.played }))}</small>` : ''}</div>` : '';
    const banner = (pr && pr.bannerFor && pr.bannerFor(name)) || fc.data.hashColor(name);
    const prof = pr && pr.profileHtml ? pr.profileHtml(name, { about: false }) : '';
    return fc.ui.cardHead({ name, banner, avatar: fc.ui.avatar(name, { size: 64, status: status === 'live' ? 'playing' : status, ring: 'var(--fc-s0)' }), marks, meta }) +
        `<div class="hcBody">
            ${prof}${playLine}${vsLine}
            ${notes ? `<div class="hcNotes">${notes}</div>` : ''}
            ${isMe ? '' : `<div class="hcBtns">
                ${cst ? fc.ui.btn('Challenge', { size: 'sm', icon: 'sword', cls: 'hcGo', disabled: !cst.ok, title: cst.ok ? T('Challenge {name} (Fightcade asks for the FT)', { name }) : T(cst.why), attrs: 'data-hc="challenge"' }) : ''}
                ${fr ? fc.ui.btn('', { kind: 'sec', size: 'sm', icon: 'star', cls: isFr ? 'hcFr on' : 'hcFr', title: isFr ? T('Remove friend') : T('Add friend'), attrs: 'data-hc="friend"' }) : ''}
                ${nt ? fc.ui.btn('', { kind: 'sec', size: 'sm', icon: 'note', title: 'Notes & tags', attrs: 'data-hc="notes"' }) : ''}
                ${fc.ui.btn('', { kind: 'sec', size: 'sm', icon: 'search', title: 'Scout: ELO, odds, form, head-to-head', attrs: 'data-hc="scout"' })}
            </div>`}
        </div>`;
}

function show(row) {
    const name = nameOf(row);
    if (!name) return;
    let card = document.getElementById('hcCard');
    if (!card) {
        card = document.createElement('div');
        card.id = 'hcCard';
        card.addEventListener('mouseenter', () => clearTimeout(hideT));
        card.addEventListener('mouseleave', () => scheduleHide());
        card.addEventListener('mousedown', (e) => e.stopPropagation());
        card.addEventListener('click', onClick);
        document.body.appendChild(card);
    }
    current = name;
    card.dataset.name = name;
    // the channel this member list belongs to (its rank is per channel)
    const cw = row.closest('.channelWrapper');
    const t = cw && cw.querySelector('.channelToolbar .channelInfo .name.title');
    card.dataset.chan = t ? (t.getAttribute('title') || t.textContent.replace(/^#/, '')).trim() : '';
    card.innerHTML = cardHtml(name, card.dataset.chan);
    const r = row.getBoundingClientRect();
    card.style.left = (r.left > 320 ? r.left - 300 - 10 : Math.min(window.innerWidth - 308, r.right + 10)) + 'px';
    card.classList.remove('in');
    card.style.top = '0px';
    const h = card.offsetHeight;
    card.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top - 12)) + 'px';
    setTimeout(() => card.classList.add('in'), 16);
    opened.push(name);
    if (opened.length > 50) opened.shift();
}

function refreshOpen() {
    const card = document.getElementById('hcCard');
    if (!card || !current || card.dataset.name !== current) return;
    const html = cardHtml(current, card.dataset.chan);
    if (card.__html !== html) { card.__html = html; card.innerHTML = html; }
}

function hide() {
    const card = document.getElementById('hcCard');
    if (card) card.remove();
    current = '';
}

function scheduleHide() {
    clearTimeout(hideT);
    hideT = setTimeout(hide, 220);
}

function onClick(e) {
    e.stopPropagation();
    const card = e.currentTarget;
    const name = card.dataset.name;
    const w = e.target.closest('[data-watch]');
    if (w) { try { (window.__fcdOpenUri || ((x) => window.location.assign(x)))(w.dataset.watch); } catch (err) { /* ignore */ } return; }
    const b = e.target.closest('[data-hc]');
    if (!b || b.disabled) return;
    const act = b.dataset.hc;
    if (act === 'challenge') {
        const ms = mod('match-screens');
        const st = ms && ms.challenge ? ms.challenge(name) : null;
        b.lastChild.textContent = st && st.ok ? T('Sent') : T(st ? st.why : 'Unavailable');
        b.disabled = true;
        if (st && st.ok) setTimeout(hide, 700);
    } else if (act === 'friend') {
        const fr = mod('friends');
        if (fr) fr.toggle(name);
        card.innerHTML = cardHtml(name, card.dataset.chan);
    } else if (act === 'notes') {
        const nt = mod('notes');
        const r = card.getBoundingClientRect();
        hide();
        if (nt) nt.edit(name, { left: r.left, top: r.top, bottom: r.top + 40, right: r.right });
    } else if (act === 'h2h') {
        hide();
        const st = mod('stats');
        if (st && st.open) st.open({ opp: name });
    } else if (act === 'scout') {
        const r = card.getBoundingClientRect();
        hide();
        const sc = mod('scout');
        if (sc && sc.openCard) sc.openCard(name, r, 'left');
    }
}

function onOver(e) {
    if (!cfg.enabled) return;
    const row = e.target && e.target.closest ? e.target.closest('.usersListWrapper .userItem') : null;
    if (!row) return;
    clearTimeout(hideT);
    const name = nameOf(row);
    if (name && name === current && document.getElementById('hcCard')) return;
    clearTimeout(showT);
    showT = setTimeout(() => { if (row.matches(':hover') || row.__hcForce) show(row); }, cfg.delay);
}

function onOut(e) {
    const row = e.target && e.target.closest ? e.target.closest('.usersListWrapper .userItem') : null;
    if (!row) return;
    const to = e.relatedTarget;
    if (to && to.closest && (to.closest('#hcCard') || to.closest('.usersListWrapper .userItem') === row)) return;
    clearTimeout(showT);
    scheduleHide();
}

// scrolling the member list moves the row away; chat scrolling doesn't matter
function onScroll(e) {
    const t = e.target;
    if (t && t.closest && (t.closest('.usersListWrapper') || (t.querySelector && t.querySelector(':scope > .usersListWrapper, .usersListWrapper .userItem')))) hide();
}

const CSS = `
#hcCard { position: fixed; z-index: 100001; width: 300px; overflow: hidden; border-radius: var(--fc-r3); pointer-events: auto;
    background: var(--fc-s0); color: var(--fc-text); font: 14px/1.35 var(--fc-font);
    box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 12px 32px rgba(0,0,0,.55);
    opacity: 0; transform: translateX(8px) scale(.98); transition: opacity .14s ease, transform .16s ease; }
#hcCard.in { opacity: 1; transform: none; }
#hcCard .hcBody { padding: 0 14px 14px; }
#hcCard .hcStar { color: var(--fc-warning); display: inline-flex; }
#hcCard .hcStar .fc-ic { width: 14px; height: 14px; }
#hcCard .fc-ch-meta > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
#hcCard .hcPlay { position: relative; margin-top: 10px; padding: 8px 10px; border-radius: var(--fc-r2); background: rgba(242,63,67,.1);
    box-shadow: inset 3px 0 0 var(--fc-danger); }
#hcCard .hcPlay .t { font-size: 12px; font-weight: 700; color: var(--fc-danger); text-transform: uppercase; letter-spacing: .03em; }
#hcCard .hcPlay .t b { color: var(--fc-head); text-transform: none; letter-spacing: 0; }
#hcCard .hcPlay .g { margin-top: 2px; font-size: 13px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding-right: 70px; }
#hcCard .hcWatch { position: absolute; right: 8px; top: 50%; margin-top: -13px; height: 26px; padding: 0 10px; border-radius: 4px;
    display: flex; align-items: center; font-size: 12px; font-weight: 700; color: #fff; background: var(--fc-danger); cursor: pointer; }
#hcCard .hcVs { display: flex; align-items: baseline; margin-top: 10px; padding: 8px 10px; border-radius: var(--fc-r2); background: var(--fc-s2); }
#hcCard .hcVs span { flex: 1; font-size: 12px; color: var(--fc-muted); }
#hcCard .hcVs b { font-size: 16px; font-weight: 800; color: var(--fc-head); }
#hcCard .hcVs b.up { color: var(--fc-success); }
#hcCard .hcVs b.down { color: var(--fc-danger); }
#hcCard .hcVs small { margin-left: 6px; font-size: 11px; color: var(--fc-muted); }
#hcCard .hcNotes { margin-top: 10px; }
#hcCard .hcBtns { display: flex; margin-top: 12px; }
#hcCard .hcBtns > .fc-btn { margin-left: 6px; }
#hcCard .hcBtns > .fc-btn:first-child { margin-left: 0; }
#hcCard .hcBtns > .hcGo { flex: 1; min-width: 0; }
#hcCard .hcFr.on { color: var(--fc-warning); }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    fc.on('presence:profile', () => refreshOpen());
    store = fc.config('hover-cards', { enabled: true, delay: 350 });
    cfg = store.data;
    window.__fcHoverLoaded = true;
    fc.ui.style('hcStyle', CSS);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    window.addEventListener('scroll', onScroll, true);
    fc.own(() => {
        fc.ui.style('hcStyle', null);
        hide();
        document.removeEventListener('mouseover', onOver, true);
        document.removeEventListener('mouseout', onOut, true);
        window.removeEventListener('scroll', onScroll, true);
        window.__fcHoverLoaded = false;
    });
    fc.settings.block({
        id: 'hover-cards', section: 'members', title: 'Hover cards', hint: '— a profile popout when you rest the mouse on someone in the member list',
        store, order: 15,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Show hover cards', onChange: (v) => { if (!v) hide(); } },
            { key: 'delay', type: 'slider', label: 'Delay', min: 100, max: 1000, step: 50, unit: ' ms', show: (d) => d.enabled }
        ]
    });
    return api;
}

const api = {
    _show: (row) => show(row),
    _hide: () => hide(),
    _opened: opened,
    get _config() { return cfg; }
};

module.exports = { id: 'hover-cards', name: 'Member hover cards', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
