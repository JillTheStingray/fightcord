/**
 * Fightcord inbox
 *
 * Fightcade's bell panel, redone as a Discord-style inbox:
 *   - tabs: All · Mentions · Challenges · Friends (with counts)
 *   - a blue dot on everything that arrived since you last opened it
 *   - Clear all
 *   - Friends: your friends coming online / starting matches (from the friends module)
 * Fightcade's own entries stay its own -- clicking one still jumps to the message.
 */
'use strict';

let fc = null;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const N_ = (s) => s;          // marks text that's translated where it's shown
const mod = (id) => fc.modules.get(id);

let tab = 'all';
let wasOpen = false;
const seen = new Set();          // entries you've had in front of you
let friendsSeenAt = Date.now();

const txt = (el, sel) => { const x = el.querySelector(sel); return x ? x.textContent : ''; };
const entryKey = (el) => (el.className.split(' ')[0] + '|' + txt(el, '.header').trim() + '|' + txt(el, '.content').replace(/\s+/g, ' ').trim()).slice(0, 300);

function entries(sec) {
    return sec ? [...sec.querySelectorAll(':scope > .notification-mention, :scope > .notification-challenge')] : [];
}

function friendAlerts() {
    const fr = mod('friends');
    return fr && fr.alerts ? fr.alerts().slice().reverse() : [];
}

/* ------------------------------------------------------------------- header */

function ensureHeader(wrap) {
    let h = wrap.querySelector(':scope > #fcInbox');
    if (!h) {
        h = document.createElement('div');
        h.id = 'fcInbox';
        h.innerHTML = `<div class="ttl">${fc.ui.icon('bell', 'ic')}${E(T('Inbox'))}${fc.ui.btn('Clear all', { kind: 'ghost', size: 'sm', cls: 'clr', title: 'Remove everything from the list', attrs: 'data-ib="clear"' })}</div>
            <div class="tabs">${[['all', N_('All')], ['mentions', N_('Mentions')], ['challenges', N_('Challenges')], ['friends', N_('Friends')]]
                .map(([k, l]) => `<span class="tab" data-tab="${k}">${E(T(l))}<b></b></span>`).join('')}</div>
            <div class="msg"></div>`;
        h.addEventListener('click', onHeaderClick);
        h.addEventListener('mousedown', (e) => e.stopPropagation());
        wrap.appendChild(h);                                       // after Fightcade's own nodes: safe for Vue
        const list = document.createElement('div');
        list.id = 'fcInboxFriends';
        list.addEventListener('click', onFriendClick);
        list.addEventListener('mousedown', (e) => e.stopPropagation());
        wrap.appendChild(list);
        const empty = document.createElement('div');
        empty.id = 'fcInboxEmpty';
        wrap.appendChild(empty);
    }
    return h;
}

function onHeaderClick(e) {
    e.stopPropagation();
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; if (tab === 'friends') friendsSeenAt = Date.now(); render(); return; }
    if (e.target.closest('[data-ib="clear"]')) {
        const wrap = document.querySelector('.notificationsWrapper');
        const vm = wrap && wrap.__vue__;
        const msg = document.querySelector('#fcInbox .msg');
        if (vm && Array.isArray(vm.notifications)) {
            vm.notifications.splice(0);
            const fr = mod('friends');
            if (fr && fr._alerts) fr._alerts.splice(0);
            if (msg) msg.textContent = '';
        } else if (msg) msg.textContent = T('Couldn’t clear Fightcade’s list here.');
        setTimeout(render, 30);
    }
}

function onFriendClick(e) {
    e.stopPropagation();
    const row = e.target.closest('[data-name]');
    if (!row) return;
    const sc = mod('scout');
    if (e.target.closest('[data-act="scout"]') && sc && sc.openCard) sc.openCard(row.dataset.name, row.getBoundingClientRect(), 'right');
    else if (e.target.closest('[data-act="h2h"]')) { const st = mod('stats'); if (st && st.open) st.open({ opp: row.dataset.name }); }
}

/* ------------------------------------------------------------------- render */

function render() {
    const wrap = document.querySelector('.notificationsWrapper');
    if (!wrap) return;
    const open = wrap.classList.contains('active');
    if (!open && !wasOpen) return;                       // closed and nothing to remember: nothing to do
    const sec = wrap.querySelector(':scope > .notificationsSection');
    const list = entries(sec);
    // remember what you saw when the panel closes; mark what's new when it opens
    if (open && !wasOpen) list.forEach(el => el.classList.toggle('fcin-new', !seen.has(entryKey(el))));
    if (!open && wasOpen) { seen.clear(); list.forEach(el => { seen.add(entryKey(el)); el.classList.remove('fcin-new'); }); friendsSeenAt = Date.now(); }
    wasOpen = open;
    if (!open) return;
    document.documentElement.classList.add('fcin-on');
    const h = ensureHeader(wrap);
    // pin our header over the section (same width)
    const w = sec ? sec.offsetWidth : 456;
    [h, wrap.querySelector('#fcInboxFriends'), wrap.querySelector('#fcInboxEmpty')].forEach(x => { if (x && x.style.width !== w + 'px') x.style.width = w + 'px'; });
    list.forEach(el => { if (!el.classList.contains('fcin-new') && !seen.has(entryKey(el)) && !el.__fcinSeen) { el.classList.add('fcin-new'); } el.__fcinSeen = true; });
    ['all', 'mentions', 'challenges', 'friends'].forEach(k => wrap.classList.toggle('fcin-tab-' + k, tab === k));
    const mentions = list.filter(el => el.classList.contains('notification-mention')).length;
    const challenges = list.length - mentions;
    const alerts = friendAlerts();
    const newFriends = alerts.filter(a => a.at > friendsSeenAt).length;
    const counts = { all: list.length, mentions, challenges, friends: newFriends || alerts.length };
    h.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('on', t.dataset.tab === tab);
        const b = t.querySelector('b');
        const n = counts[t.dataset.tab];
        const s = n ? String(n) : '';
        if (b.textContent !== s) b.textContent = s;
        b.classList.toggle('hot', t.dataset.tab === 'friends' && newFriends > 0);
    });
    // Friends tab: our own list
    const fl = wrap.querySelector('#fcInboxFriends');
    const fhtml = tab !== 'friends' ? '' : alerts.length ? alerts.map(a => `<div class="fcinF${a.at > friendsSeenAt ? ' fcin-new' : ''}" data-name="${E(a.name)}">
            ${fc.ui.avatar(a.name, { size: 36 })}<div class="tx"><div class="t">${E(a.title)}</div>
            <div class="s">${E(a.sub || '')}${a.sub ? ' · ' : ''}${fc.fmt.ago(a.at)}</div></div>
            ${a.name ? fc.ui.btn('', { kind: 'sec', size: 'sm', icon: 'chart', act: 'h2h', title: 'Head-to-head' }) + fc.ui.btn('', { kind: 'sec', size: 'sm', icon: 'search', act: 'scout', title: 'Scout' }) : ''}</div>`).join('')
        : fc.ui.empty({ icon: 'users', title: 'No friend activity yet', sub: 'Add friends with ☆ on a scout card or the Friends page.' });
    if (fl.__html !== fhtml) { fl.__html = fhtml; fl.innerHTML = fhtml; }
    // an empty Mentions / Challenges tab says so
    const shown = tab === 'mentions' ? mentions : tab === 'challenges' ? challenges : -1;
    const em = wrap.querySelector('#fcInboxEmpty');
    const etxt = shown === 0 ? T(tab === 'mentions' ? 'No mentions — nobody @’d you yet.' : 'No challenges right now.') : '';
    if (em.textContent !== etxt) em.textContent = etxt;
    em.classList.toggle('on', !!etxt);
}

const CSS = `
html.fcin-on .notificationsWrapper .notificationsSection { padding: 104px 10px 12px !important; width: 440px !important;
    background: var(--fc-s2) !important; background-image: none !important; text-transform: none !important;
    box-shadow: 0 0 0 1px rgba(255,255,255,.04), 8px 0 24px rgba(0,0,0,.4) !important; font-family: var(--fc-font) !important; }
html.fcin-on .notificationsWrapper .notificationsMaskBg { background: rgba(0,0,0,.35) !important; }
#fcInbox { position: absolute; top: 0; left: 0; z-index: 3; box-sizing: border-box; padding: 14px 14px 0; height: 96px;
    background: var(--fc-s2); border-bottom: 1px solid var(--fc-divider);
    color: var(--fc-text); font-family: var(--fc-font); text-transform: none; }
.notificationsWrapper:not(.active) > #fcInbox, .notificationsWrapper:not(.active) > #fcInboxFriends, .notificationsWrapper:not(.active) > #fcInboxEmpty { display: none; }
#fcInbox .ttl { display: flex; align-items: center; font-size: 18px; font-weight: 800; color: var(--fc-head); }
#fcInbox .tabs { display: flex; margin-top: 12px; }
#fcInbox .tab { position: relative; display: inline-flex; align-items: center; margin-right: 6px; padding: 6px 10px; border-radius: 4px; cursor: pointer;
    font-size: 13px; font-weight: 600; color: var(--fc-muted); transition: background-color .1s ease, color .1s ease; }
#fcInbox .tab:hover { background: var(--fc-hover); color: var(--fc-text); }
#fcInbox .tab.on { background: var(--fc-s4); color: var(--fc-head); }
#fcInbox .tab b { margin-left: 6px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; font-size: 11px;
    line-height: 16px; text-align: center; color: var(--fc-text); background: rgba(255,255,255,.1); }
#fcInbox .tab b:empty { display: none; }
#fcInbox .tab b.hot { color: #fff; background: var(--fc-danger); }
#fcInbox .msg { position: absolute; right: 14px; bottom: 6px; font-size: 11px; color: var(--fc-danger); }
html.fcin-on .notificationsWrapper.fcin-tab-mentions .notification-challenge,
html.fcin-on .notificationsWrapper.fcin-tab-challenges .notification-mention,
html.fcin-on .notificationsWrapper.fcin-tab-friends .notificationsSection > * { display: none !important; }
html.fcin-on .notificationsWrapper:not(.fcin-tab-all) .notifications-empty { display: none !important; }
#fcInboxFriends { position: absolute; top: 104px; left: 0; bottom: 0; z-index: 2; box-sizing: border-box; padding: 0 10px 12px; overflow-y: auto; display: none;
    color: var(--fc-text); font-family: var(--fc-font); }
.notificationsWrapper.fcin-tab-friends > #fcInboxFriends { display: block; }
#fcInboxEmpty { position: absolute; top: 150px; left: 0; z-index: 2; display: none; text-align: center; font-size: 14px; color: var(--fc-muted);
    font-family: var(--fc-font); pointer-events: none; }
#fcInboxEmpty.on { display: block; }
/* entries as cards */
html.fcin-on .notificationsSection .notification-mention, html.fcin-on .notificationsSection .notification-challenge, #fcInboxFriends .fcinF {
    position: relative !important; margin: 0 0 8px !important; padding: 10px 12px 10px 14px !important; border-radius: 8px !important;
    background: var(--fc-s3) !important; background-image: none !important; border: 0 !important;
    box-shadow: 0 0 0 1px var(--fc-divider) !important; cursor: pointer !important;
    transition: background-color .1s ease, transform .1s ease !important; }
html.fcin-on .notificationsSection .notification-mention:hover, html.fcin-on .notificationsSection .notification-challenge:hover, #fcInboxFriends .fcinF:hover {
    background: var(--fc-hover) !important; transform: translateX(2px) !important; }
html.fcin-on .notificationsSection .notification-mention { box-shadow: inset 3px 0 0 #f0b232, 0 0 0 1px var(--fc-divider) !important; }
html.fcin-on .notificationsSection .notification-challenge { box-shadow: inset 3px 0 0 #23a55a, 0 0 0 1px var(--fc-divider) !important; }
html.fcin-on .notificationsSection .header { margin: 0 0 4px !important; padding: 0 !important; background: none !important; font-size: 12px !important;
    font-weight: 600 !important; text-transform: none !important; color: var(--fc-muted) !important; white-space: nowrap !important;
    overflow: hidden !important; text-overflow: ellipsis !important; }
html.fcin-on .notificationsSection .content { padding: 0 !important; background: none !important; font-size: 14px !important; font-weight: 400 !important;
    text-transform: none !important; color: var(--fc-text) !important; }
html.fcin-on .notificationsSection .content .name { font-weight: 700 !important; color: var(--fc-head) !important; }
html.fcin-on .notificationsSection .fcin-new::after, #fcInboxFriends .fcinF.fcin-new::after {
    content: ''; position: absolute; top: 12px; right: 12px; width: 8px; height: 8px; border-radius: 50%; background: var(--fc-accent);
    box-shadow: 0 0 8px var(--fc-accent); }
html.fcin-on .notificationsSection .notifications-empty { font-size: 0 !important; }
html.fcin-on .notificationsSection .notifications-empty > * { display: none !important; }
html.fcin-on .notificationsSection .notifications-empty::before { content: '🎉'; font-size: 44px; margin-bottom: 10px; }
html.fcin-on .notificationsSection .notifications-empty::after { content: 'You\\'re all caught up'; font-size: 16px; font-weight: 600; color: var(--fc-muted); }
#fcInboxFriends .fcinF { display: flex; align-items: center; }
#fcInboxFriends .fcinF .tx { flex: 1; min-width: 0; }
#fcInboxFriends .fcinF .t { font-size: 14px; font-weight: 600; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcInboxFriends .fcinF .s { margin-top: 2px; font-size: 12px; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcInboxFriends .fcinF.fcin-new::after { right: 84px; }
#fcInboxFriends .fcinNone { margin: 40px 20px; text-align: center; font-size: 14px; line-height: 1.5; color: var(--fc-muted); }
#fcInboxFriends .fcinNone .big { font-size: 40px; }
#fcInbox .ttl .ic { width: 20px; height: 20px; }
#fcInbox .clr { margin-left: auto; color: var(--fc-link); }
#fcInboxFriends .fcinF > .fc-avatar { margin-right: 10px; }
#fcInboxFriends .fcinF > .fc-btn { margin-left: 4px; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    window.__fcInboxLoaded = true;
    fc.ui.style('fcinStyle', CSS);
    fc.own(() => {
        fc.ui.style('fcinStyle', null);
        document.documentElement.classList.remove('fcin-on');
        ['#fcInbox', '#fcInboxFriends', '#fcInboxEmpty'].forEach(s => { const n = document.querySelector(s); if (n) n.remove(); });
        window.__fcInboxLoaded = false;
    });
    // the bell panel opens / closes with a class change (no new nodes): look a few times a second
    fc.tick(render, 250);
    fc.on('friends:alert', render);
    render();
    return api;
}

const api = { _render: () => render(), _setTab: (t) => { tab = t; render(); } };

module.exports = { id: 'inbox', name: 'Notification inbox', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
