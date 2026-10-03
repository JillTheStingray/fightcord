/**
 * Fightcord profile popout
 *
 * Click your own avatar (bottom-left) and instead of Fightcade's small Online / Away menu
 * you get a Discord-style profile card: tonight's session, your all-time record, main game,
 * friends online, the Online / Away switch and quick links. The status rows and Log out
 * click Fightcade's own buttons, so nothing about how they work changes.
 */
'use strict';

let fc = null;
const E = (s) => fc.fmt.esc(s);
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
const mod = (id) => fc.modules.get(id);
const avatar = (name) => fc.data.avatarUrl(name, (fc.app.user(name)[1] || {}).gravatar, 160);

/* --------------------------------------------------------------------- data */

function data() {
    const me = fc.app.me();
    const u = fc.app.user(me)[1] || fc.app.localUser() || {};
    const ms = mod('match-screens'), stats = mod('stats'), fr = mod('friends');
    const all = fc.history.all();
    const cleared = ms && ms._config ? ms._config.sessionClearedAt : 0;
    const tonight = fc.history.session(Date.now(), cleared);
    const tally = stats && stats._tally ? stats._tally(all) : null;
    const st = stats && stats._streaks ? stats._streaks(all) : null;
    const games = new Map();
    all.forEach(s => { const k = s.rom || s.game; if (!k) return; const g = games.get(k) || { n: 0, rom: s.rom, name: shortName(s.channel || s.game) }; g.n++; games.set(k, g); });
    const main = [...games.values()].sort((a, b) => b.n - a.n)[0] || null;
    const friends = fr && fr.list ? fr.list().filter(n => !!fc.app.user(n)[1]) : [];
    const status = u.playing && u.playing.quarkId ? 'live' : u.away ? 'away' : 'on';
    return { me, status, tonight: tonight.length, tRec: fc.data.recordOf(tonight), tStreak: fc.data.streakOf(tonight), tally, st, main, friends };
}

/* --------------------------------------------------------------------- card */

function cardHtml() {
    const d = data();
    const t = d.tally;
    const statusText = { live: 'In a match', away: 'Away', on: 'Online' }[d.status];
    const art = d.main && d.main.rom ? fc.data.artUrl(d.main.rom, 'https://web.fightcade.com/') : '';
    return `<div class="pcBanner"${art ? ` style="background-image:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.45)),url(&quot;${E(art)}&quot;),var(--fc-brand)"` : ''}></div>
        <div class="pcAva ${d.status}"><img src="${E(avatar(d.me))}" alt="" onerror="this.style.visibility='hidden'"><i></i></div>
        <div class="pcBody">
            <div class="pcName">${E(d.me || 'You')}</div>
            <div class="pcStatus ${d.status}">${statusText}</div>
            <div class="pcGrid">
                <div class="pcBox"><span>Tonight</span><b>${d.tonight ? d.tRec.w + '–' + d.tRec.l : '—'}</b>
                    <small>${d.tStreak.n >= 2 ? (d.tStreak.kind === 'won' ? '🔥 ' + d.tStreak.n + ' win streak' : d.tStreak.n + ' losses in a row') : d.tonight ? fc.fmt.plural(d.tonight, 'set') : 'no sets yet'}</small></div>
                <div class="pcBox"><span>All time</span><b>${t ? t.w + '–' + t.l : '—'}</b>
                    <small>${t && t.rate != null ? Math.round(t.rate * 100) + '% · ' + t.n + ' sets' : 'play a set first'}</small></div>
                <div class="pcBox"><span>Best streak</span><b>${d.st && d.st.bestW ? d.st.bestW + 'W' : '—'}</b><small>longest run of wins</small></div>
                <div class="pcBox main"><span>Main game</span><b title="${E(d.main ? d.main.name : '')}">${E(d.main ? d.main.name : '—')}</b>
                    <small>${d.main ? fc.fmt.plural(d.main.n, 'set') : ''}</small></div>
            </div>
            ${(() => { const g = mod('goals'); return g && g.summaryHtml ? g.summaryHtml() : ''; })()}
            ${d.friends.length ? `<div class="pcFriends"><span>Friends online</span><div>${d.friends.slice(0, 6).map(n =>
                `<img src="${E(avatar(n))}" title="${E(n)}" alt="" onerror="this.style.visibility='hidden'">`).join('')}${d.friends.length > 6 ? `<em>+${d.friends.length - 6}</em>` : ''}</div></div>` : ''}
            <div class="pcSep"></div>
            <div class="pcRow ${d.status !== 'away' ? 'on' : ''}" data-pc="online"><i class="dot on"></i>Online</div>
            <div class="pcRow ${d.status === 'away' ? 'on' : ''}" data-pc="away"><i class="dot away"></i>Away</div>
            <div class="pcSep"></div>
            <div class="pcBtns">
                ${fc.ui.btn('Stats', { kind: 'sec', size: 'sm', icon: 'chart', attrs: 'data-pc="stats"' })}${fc.ui.btn('Friends', { kind: 'sec', size: 'sm', icon: 'users', attrs: 'data-pc="friends"' })}${fc.ui.btn('Settings', { kind: 'sec', size: 'sm', icon: 'gear', attrs: 'data-pc="settings"' })}
            </div>
            <div class="pcRow danger" data-pc="logout">↩ Log out</div>
        </div>`;
}

function closeFc() {
    const r = fc.app.root();
    const tb = r && r.$refs && r.$refs.mainToolbar;
    if (tb && 'showGlobalStateMenu' in tb) tb.showGlobalStateMenu = false;
    const m = document.querySelector('.userStateMenu.active');
    if (m) m.classList.remove('active');
    hide();
}

function onClick(e) {
    e.stopPropagation();
    const b = e.target.closest('[data-pc]');
    const a = b && b.dataset.pc;
    if (!a) return;
    const fcMenu = document.querySelector('.buttonBar .userButton .userStateMenu');
    if (a === 'online' || a === 'away') {
        const opts = fcMenu ? fcMenu.querySelectorAll('.optionWrapper') : [];
        const el = opts[a === 'online' ? 0 : 1];
        if (el) el.click();
        setTimeout(() => { const c = document.getElementById('pcCard'); if (c) c.innerHTML = cardHtml(); }, 120);
        return;
    }
    if (a === 'logout') {
        const lo = fcMenu && fcMenu.querySelector('.logOutWrapper .button');
        closeFc();
        if (lo) lo.click();
        return;
    }
    closeFc();
    const m = mod(a === 'settings' ? 'fightcord' : a);
    if (m && m.open) m.open();
}

function show() {
    document.documentElement.classList.add('fcpc-on');
    let c = document.getElementById('pcCard');
    if (!c) {
        c = document.createElement('div');
        c.id = 'pcCard';
        c.addEventListener('click', onClick);
        c.addEventListener('mousedown', (e) => e.stopPropagation());
        document.body.appendChild(c);
    }
    c.innerHTML = cardHtml();
    const rail = document.querySelector('.mainToolbarWrapper .mainToolbar');
    c.style.left = ((rail ? rail.getBoundingClientRect().right : 72) + 10) + 'px';
    setTimeout(() => c.classList.add('in'), 16);
}

function hide() {
    const c = document.getElementById('pcCard');
    if (c) c.remove();
}

// follow Fightcade's own open / closed state of the status menu
let lastOpen = false;
function poll() {
    const open = !!document.querySelector('.buttonBar .userButton .userStateMenu.active');
    if (open !== lastOpen) { lastOpen = open; if (open) show(); else hide(); }
}

const CSS = `
html.fcpc-on .buttonBar .userButton .userStateMenu { opacity: 0 !important; pointer-events: none !important; }
#pcCard { position: fixed; bottom: 12px; z-index: 100005; width: 320px; overflow: hidden; border-radius: 12px;
    background: var(--fc-s0); color: var(--fc-text); font: 14px/1.35 var(--fc-font);
    box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 16px 40px rgba(0,0,0,.6); opacity: 0; transform: translateY(10px) scale(.98);
    transition: opacity .15s ease, transform .18s cubic-bezier(.2,.9,.3,1.2); }
#pcCard.in { opacity: 1; transform: none; }
#pcCard .pcBanner { height: 72px; background: linear-gradient(120deg, var(--fc-accent), #8b5cf6 60%, #22e3f2);
    background-size: cover; background-position: center 30%; image-rendering: pixelated; }
#pcCard .pcAva { position: absolute; top: 30px; left: 14px; width: 84px; height: 84px; border-radius: 50%; padding: 6px; box-sizing: border-box;
    background: var(--fc-s0); }
#pcCard .pcAva img { width: 72px; height: 72px; border-radius: 50%; display: block; background: var(--fc-s1); }
#pcCard .pcAva i { position: absolute; right: 3px; bottom: 3px; width: 20px; height: 20px; border-radius: 50%; box-sizing: border-box;
    border: 4px solid var(--fc-s0); background: #23a55a; }
#pcCard .pcAva.away i { background: #f0b232; } #pcCard .pcAva.live i { background: #f23f43; }
#pcCard .pcBody { padding: 48px 14px 12px; }
#pcCard .pcName { font-size: 20px; font-weight: 800; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#pcCard .pcStatus { font-size: 13px; color: #23a55a; }
#pcCard .pcStatus.away { color: #f0b232; } #pcCard .pcStatus.live { color: #f23f43; }
#pcCard .pcGrid { display: flex; flex-wrap: wrap; margin: 10px -4px 0; }
#pcCard .pcBox { flex: 1 1 40%; margin: 4px; padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,.05); min-width: 0; }
#pcCard .pcBox span { display: block; font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--fc-muted); }
#pcCard .pcBox b { display: block; margin-top: 2px; font-size: 18px; font-weight: 800; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#pcCard .pcBox.main b { font-size: 13px; line-height: 22px; }
#pcCard .pcBox small { display: block; font-size: 11px; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#pcCard .pcFriends { margin-top: 10px; }
#pcCard .pcFriends span { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--fc-muted); }
#pcCard .pcFriends div { display: flex; align-items: center; margin-top: 6px; }
#pcCard .pcFriends img { width: 28px; height: 28px; margin-right: -6px; border-radius: 50%; box-shadow: 0 0 0 3px var(--fc-s0); background: var(--fc-s1); }
#pcCard .pcFriends em { margin-left: 12px; font-style: normal; font-size: 12px; color: var(--fc-muted); }
#pcCard .pcSep { height: 1px; margin: 10px 0 6px; background: var(--fc-divider); }
#pcCard .pcRow { display: flex; align-items: center; height: 32px; padding: 0 8px; border-radius: 4px; cursor: pointer; font-weight: 500; }
#pcCard .pcRow:hover { background: var(--fc-accent); color: #fff; }
#pcCard .pcRow.on { font-weight: 700; color: var(--fc-head); }
#pcCard .pcRow.on::after { content: '✓'; margin-left: auto; }
#pcCard .pcRow .dot { width: 10px; height: 10px; margin-right: 10px; border-radius: 50%; }
#pcCard .pcRow .dot.on { background: #23a55a; } #pcCard .pcRow .dot.away { background: #f0b232; }
#pcCard .pcRow.danger { margin-top: 4px; color: #f23f43; }
#pcCard .pcRow.danger:hover { background: #f23f43; color: #fff; }
#pcCard .pcBtns { display: flex; margin: 2px -3px 0; }
#pcCard .pcBtns > .fc-btn { flex: 1; margin: 3px; height: 32px; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    window.__fcProfileLoaded = true;
    fc.ui.style('pcStyle', CSS);
    document.documentElement.classList.add('fcpc-on');       // the card replaces Fightcade's small menu
    fc.own(() => { fc.ui.style('pcStyle', null); hide(); document.documentElement.classList.remove('fcpc-on'); window.__fcProfileLoaded = false; });
    fc.tick(poll, 150);
    return api;
}

const api = { _show: () => show(), _hide: () => hide(), _data: () => data() };

module.exports = { id: 'profile-card', name: 'Profile popout', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
