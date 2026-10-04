/**
 * Fightcord friends
 *
 * Fightcade has no friends list, so this keeps one on your PC. Star anyone from their
 * scout card (or type a name on the Friends page) and you'll see:
 *   - who's online and in which game, and who's in a match (with Watch)
 *   - a toast + chime when a friend comes online or starts a match
 *   - a gold ★ next to friends in the member list
 *
 * Fightcade only tells us about players in channels you've joined. Friends elsewhere
 * show their latest match instead, looked up when you open the page (spaced out and
 * cached by fc.api, to stay clear of Fightcade's rate limit).
 *
 * Opened from the Discover sidebar ("Friends") or /friends in chat.
 * Events: friends:changed, friends:online (count), friends:alert.
 */
'use strict';

let fc = null;
let store = null, cfg = null;           // friends-config.json

const DEFAULTS = { friends: [], notify: true, sound: true };
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const key = (n) => String(n || '').toLowerCase();
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');

/* ------------------------------------------------------------------- friends */

const isFriend = (name) => !!name && !!cfg && cfg.friends.some(f => key(f.name) === key(name));
const list = () => cfg.friends.map(f => f.name);

function changed() {
    store.save();
    fc.emit('friends:changed');
    fc.settings.refresh('friends');
    render();
}

function add(name) {
    name = String(name || '').trim();
    if (!name || isFriend(name) || fc.app.isMe(name)) return false;
    // the exact spelling Fightcade has, when we can see them
    const exact = fc.app.user(name)[1] ? fc.app.user(name)[0] : name;
    cfg.friends.push({ name: exact, added: Date.now() });
    // no "came online" alert for someone who was already there when you added them
    const st = statusOf(exact);
    prev.set(key(exact), { online: st.online, quark: st.playing ? String(st.playing.quarkId) : '' });
    changed();
    return true;
}

function remove(name) {
    const before = cfg.friends.length;
    cfg.friends = cfg.friends.filter(f => key(f.name) !== key(name));
    store.data.friends = cfg.friends;
    if (cfg.friends.length !== before) changed();
}

function toggle(name) {
    if (isFriend(name)) { remove(name); return false; }
    return add(name);
}

/* -------------------------------------------------------------------- status */

function chanName(id) {
    const c = fc.app.channel(id);
    return c ? (c.name || c.id) : String(id || '');
}

// what we can see of a friend right now
function statusOf(name) {
    const [real, u] = fc.app.user(name);
    if (!u) return { name: real, online: false };
    const p = u.playing && u.playing.quarkId ? u.playing : null;
    const st = { name: real, u, online: true, away: !!u.away, playing: p };
    if (p) {
        st.game = shortName(chanName(p.channelId));
        const all = fc.app.users();
        st.opp = Object.keys(all).find(n => n !== real && all[n].playing && all[n].playing.quarkId === p.quarkId) || '';
    } else {
        const chans = Array.isArray(u.channels) ? u.channels : [];
        st.game = chans.length ? shortName(chanName(chans[0])) : '';
    }
    return st;
}

// exactly Fightcade's own spectate link (only for channels that allow spectators)
function watchUrl(st) {
    const p = st.playing;
    if (!p || fc.app.isMe(st.name)) return '';
    const c = fc.app.channel(p.channelId);
    if (!c || c.spectators === false) return '';
    return fc.data.watchUrl({ emu: c.emulator, rom: p.gameId, quark: p.quarkId, port: p.port });
}

function openUri(u) {
    try { (window.__fcdOpenUri || ((x) => window.location.assign(x)))(u); } catch (e) { fc.log.warn('open failed', e.message); }
}

/* -------------------------------------------------------------------- alerts */

const prev = new Map();          // key -> {online, quark}
const lastAlert = new Map();     // key -> time
const alerts = [];               // for the inbox
let booted = false;
let onlineCount = -1;
const ALERT_GAP = 10 * 60000;

function scan() {
    let online = 0;
    cfg.friends.forEach(f => {
        const st = statusOf(f.name);
        const k = key(f.name);
        const was = prev.get(k) || { online: false, quark: '' };
        const quark = st.playing ? String(st.playing.quarkId) : '';
        if (st.online) online++;
        // friends already here when Fightcade starts don't count as "came online"
        if (booted) {
            if (quark && quark !== was.quark) alert(k, T('{name} started a match', { name: st.name }), (st.opp ? 'vs ' + st.opp : '') + (st.game ? (st.opp ? ' · ' : '') + st.game : ''), st.name, 'match');
            else if (st.online && !was.online) alert(k, T('{name} is online', { name: st.name }), st.game ? T('in {game}', { game: st.game }) : '', st.name, 'online');
        }
        prev.set(k, { online: st.online, quark });
    });
    booted = true;
    if (online !== onlineCount) {
        onlineCount = online;
        fc.emit('friends:online', online);
    }
    if (page) render();
}

// always kept for the inbox; the toast + chime only when switched on
function alert(k, title, sub, name, kind) {
    const t = Date.now();
    if (t - (lastAlert.get(k) || 0) < ALERT_GAP) return;
    lastAlert.set(k, t);
    const a = { at: t, title, sub, name: name || '', kind: kind || '' };
    alerts.push(a);
    if (alerts.length > 100) alerts.shift();
    fc.emit('friends:alert', a);
    if (!cfg.notify) return;
    const st = fc.modules.get('streamer');
    if (st && st.quiet && st.quiet()) return;           // streaming: it would name them on screen
    fc.ui.toast(title, { sub, icon: 'star', kind: 'warning', ms: 7000, onClick: open,
        actions: kind === 'match' && watchUrl(statusOf(name)) ? [{ label: 'Watch', fn: () => openUri(watchUrl(statusOf(name))) }] : [] });
    if (cfg.sound) fc.sound.play('ping');
}

/* ----------------------------------------------------- latest match lookups */

const last = new Map();          // key -> {at, state: 'loading'|'ok'|'err', when, game, live, err}
const LOOKUP_TTL = 10 * 60000;
let lookupRunning = false;

async function lookupOffline() {
    if (lookupRunning) return;
    lookupRunning = true;
    try {
        const todo = cfg.friends.filter(f => {
            if (statusOf(f.name).online) return false;
            const l = last.get(key(f.name));
            return !l || (l.state !== 'loading' && Date.now() - l.at > LOOKUP_TTL);
        });
        for (let i = 0; i < todo.length && page; i++) {
            const k = key(todo[i].name);
            last.set(k, { at: Date.now(), state: 'loading' });
            render();
            try {
                const rows = await fc.api.quarks({ username: todo[i].name }, { priority: 'low', ttl: LOOKUP_TTL });
                const newest = rows.map(r => ({ r, t: +(fc.data.quarkDate(r) || 0) })).sort((a, b) => b.t - a.t)[0];
                last.set(k, newest
                    ? { at: Date.now(), state: 'ok', when: newest.t, game: shortName(newest.r.channelname || newest.r.gameid || ''),
                        live: newest.r.live === true || (typeof newest.r.status === 'string' && /live|progress|playing/i.test(newest.r.status)) }
                    : { at: Date.now(), state: 'ok', when: 0 });
            } catch (e) {
                last.set(k, { at: Date.now(), state: 'err', err: e.message });
                if (/rate limited|Cloudflare/i.test(e.message)) break;          // backing off: later
            }
            render();
        }
    } finally {
        lookupRunning = false;
        render();
    }
}

/* ---------------------------------------------------------------------- page */

let page = null;
let openedOn = '';

function rowHtml(st) {
    const cc = st.u && st.u.country && st.u.country.iso_code;
    let sub, status;
    if (st.playing) { sub = `<b class="live">● ${E(T('In a match'))}</b>${st.opp ? ' vs ' + E(st.opp) : ''}${st.game ? ' · ' + E(st.game) : ''}`; status = 'playing'; }
    else if (st.online) { sub = E(T(st.away ? 'Away' : 'Online')) + (st.game ? ' · ' + E(st.game) : ''); status = st.away ? 'away' : 'on'; }
    else {
        status = 'off';
        const l = last.get(key(st.name));
        sub = !l ? E(T('Not in your channels'))
            : l.state === 'loading' ? E(T('Looking up their latest match…'))
            : l.state === 'err' ? E(T('Not in your channels · couldn’t look up ({error})', { error: l.err }))
            : l.live ? `<b class="live">● ${E(T('LIVE'))}</b> ${E(T('in {game} (a channel you haven\'t joined)', { game: l.game || T('a match') }))}`
            : l.when ? E(T('Last played {when}', { when: fc.fmt.ago(l.when) })) + (l.game ? ' · ' + E(l.game) : '')
            : E(T('No recent matches'));
    }
    const w = watchUrl(st);
    return `<div class="frRow" data-name="${E(st.name)}">
        ${fc.ui.avatar(st.name, { size: 40, status, ring: 'var(--fc-s3)' })}
        <div class="frText"><div class="frName">${fc.ui.flag(cc)}${E(st.name)}</div><div class="frSub">${sub}</div></div>
        ${w ? fc.ui.btn('Watch', { kind: 'danger', size: 'sm', icon: 'eye', attrs: `data-watch="${E(w)}"` }) : ''}
        ${fc.ui.btn('Scout', { kind: 'sec', size: 'sm', act: 'scout' })}
        ${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'close', act: 'remove', title: 'Remove friend', cls: 'frX' })}
    </div>`;
}

function render() {
    if (!page) return;
    const all = cfg.friends.map(f => statusOf(f.name));
    const on = all.filter(s => s.online).sort((a, b) => (b.playing ? 1 : 0) - (a.playing ? 1 : 0) || a.name.localeCompare(b.name));
    const off = all.filter(s => !s.online).sort((a, b) => a.name.localeCompare(b.name));
    const body = `<div class="frAddRow"><input class="fc-input frInput" type="text" placeholder="${E(T('Add a friend by Fightcade name'))}" spellcheck="false">` +
        fc.ui.btn('Add', { kind: 'success', act: 'add' }) + `<span class="frNote"></span></div>` +
        (!all.length
            ? fc.ui.empty({ icon: 'users', title: 'No friends yet', sub: 'Add someone with the box above, or hit ☆ Add friend on anyone’s scout card.' })
            : `<h4>${E(T('Online'))} — ${on.length}</h4>${on.length ? on.map(rowHtml).join('') : '<div class="fc-muted frMuted">' + E(T('Nobody in your channels right now.')) + '</div>'}` +
              (off.length ? `<h4>${E(T('Not in your channels'))} — ${off.length}</h4>${off.map(rowHtml).join('')}` : ''));
    const box = page.body;
    // keep what's being typed in the add box
    const inp = box.querySelector('.frInput');
    const typed = inp ? inp.value : '', focused = inp && inp === document.activeElement, note = (box.querySelector('.frNote') || {}).textContent || '';
    if (box.__html === body) return;
    box.innerHTML = body;
    box.__html = body;
    const ni = box.querySelector('.frInput');
    ni.value = typed;
    box.querySelector('.frNote').textContent = note;
    if (focused) ni.focus();
}

function onPageClick(e) {
    const btn = e.target.closest('[data-act], [data-watch]');
    if (!btn) return;
    if (btn.dataset.watch) { openUri(btn.dataset.watch); return; }
    const act = btn.getAttribute('data-act');
    if (act === 'add') { submitAdd(); return; }
    const row = btn.closest('.frRow');
    if (!row) return;
    const name = row.dataset.name;
    if (act === 'remove') remove(name);
    else if (act === 'scout') {
        const scout = fc.modules.get('scout');
        if (scout && scout.openCard) scout.openCard(name, row.getBoundingClientRect(), 'left');
    }
}

function submitAdd() {
    const inp = page && page.body.querySelector('.frInput');
    if (!inp) return;
    const name = inp.value.trim();
    if (!name) return;
    const say = (t) => { const n = page && page.body.querySelector('.frNote'); if (n) n.textContent = t; };
    if (isFriend(name)) { say(T('{name} is already a friend.', { name })); return; }
    if (add(name)) { inp.value = ''; say(T('Added {name}.', { name })); lookupOffline(); }
    else say(T('That name can’t be added.'));
}

function open() {
    openedOn = fc.app.activeChannelId();
    const stats = fc.modules.get('stats');
    if (stats && stats.close) stats.close();
    if (!page) {
        page = fc.ui.page('friends', { title: 'Friends', icon: 'users', cls: 'frPage', onClose: () => { page = null; } });
        page.el.id = 'frPage';                    // the id other plugins know
        page.body.addEventListener('click', onPageClick);
        page.el.addEventListener('mousedown', (e) => e.stopPropagation());
        page.body.addEventListener('keydown', (e) => {
            if (!e.target.classList.contains('frInput')) return;
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); submitAdd(); }
        }, true);
    }
    render();
    lookupOffline();
}

function close() { if (page) page.close(); }

const CSS = `
#frPage .frAddRow { display: flex; align-items: center; margin-bottom: 8px; }
#frPage .frInput { width: 280px; margin-right: 8px; }
#frPage .frNote { margin-left: 12px; font-size: 13px; color: var(--fc-success); }
#frPage h4 { margin: 18px 0 6px; font: 700 12px/1.2 var(--fc-font); letter-spacing: .04em; text-transform: uppercase; color: var(--fc-muted); }
#frPage .frRow { display: flex; align-items: center; min-height: 60px; padding: 8px 10px; margin: 0 -10px; border-radius: var(--fc-r2);
    border-top: 1px solid var(--fc-divider); transition: background-color var(--fc-fast); }
#frPage .frRow:hover { background: var(--fc-hover); }
#frPage .frRow > .fc-avatar { margin-right: 12px; }
#frPage .frRow > .fc-btn { margin-left: 8px; }
#frPage .frText { flex: 1; min-width: 0; }
#frPage .frName { font-size: 15px; font-weight: 600; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#frPage .frName .fc-flag { margin-right: 6px; }
#frPage .frSub { margin-top: 2px; font-size: 13px; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#frPage .frSub .live { color: var(--fc-danger); font-weight: 700; }
#frPage .frX { opacity: 0; }
#frPage .frRow:hover .frX { opacity: 1; }
#frPage .frX:hover { color: var(--fc-danger); }
#frPage .frMuted { padding: 6px 0; font-size: 13px; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('friends', DEFAULTS);
    cfg = store.data;
    if (!Array.isArray(cfg.friends)) cfg.friends = [];
    window.__fcFriendsLoaded = true;          // the Discover sidebar shows "Friends" when this is set
    fc.ui.style('frStyle', CSS);
    fc.own(() => { fc.ui.style('frStyle', null); close(); window.__fcFriendsLoaded = false; });

    fc.tick(() => {
        scan();
        if (page && fc.app.activeChannelId() !== openedOn) close();
    }, 2000, { delay: 1500, whileHidden: true });
    const onNav = () => close();
    fc.on('nav', onNav);

    fc.cmd('friends', 'Open your friends list', open);
    fc.cmd('friend', 'Open your friends list', open);

    fc.settings.block({
        id: 'friends', section: 'members', title: 'Friends', store, order: 20,
        hint: '— only on your PC · /friends in chat',
        fields: [
            { type: 'html', html: () => `<div class="fc-note">${fc.fmt.plural(cfg.friends.length, 'friend')} saved.</div>` },
            { key: 'notify', type: 'switch', label: 'Pop-up when a friend comes online or starts a match' },
            { key: 'sound', type: 'switch', label: 'Play a chime with it', show: (d) => d.notify, onChange: (v) => { if (v) fc.sound.play('ping'); } },
            { type: 'button', label: 'Friends page', button: 'Open', act: 'open', onClick: () => { const s = fc.modules.get('fightcord'); if (s && s.close) s.close(); open(); } }
        ]
    });
    fc.log('ready,', cfg.friends.length, 'friends');
    return api;
}

const api = {
    isFriend, toggle, add, remove, list,
    open: () => open(),
    close: () => close(),
    onlineCount: () => Math.max(0, onlineCount),
    alerts: () => alerts.slice(),
    _scan: () => scan(),
    _alerts: alerts,
    get _config() { return cfg; }
};

module.exports = { id: 'friends', name: 'Friends', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
