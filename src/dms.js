/**
 * Fightcord friends + DMs (3.6, Fightcord-only)
 *
 * Real friends, the way Discord does them: you send a request, they accept, and you're friends on
 * both sides. Friends message each other (DMs that keep their history, pictures and GIFs included),
 * call each other (voice, straight between the two PCs) and challenge each other from the DM.
 * Someone who isn't your friend can still write to you: it shows up as a message request that you
 * accept, ignore or block (Settings -> Friends & DMs can turn those off).
 *
 *   - Who you are: your Fightcord ID, a key made on this PC (lobbies.js has it). Fightcade can't prove
 *     that a key belongs to a player, so accepting a request locks in that player's key: nobody can
 *     pose as them afterwards. If another Fightcord shows up under a friend's name, you get a warning.
 *   - Requests go through the same free public Nostr relays as lobbies, sealed so that only the two
 *     of you can read them (the relays keep them, so they reach you when you come online).
 *   - A DM is a two-person private lobby (lobbies.js draws it and keeps its history); this module has
 *     the friends, the requests and the DM page's Friends view, list and profile.
 *
 * Opened from the chat bubble at the top of the server rail, /friends or /dms, or a scout card.
 * Events: dms:changed.
 */
'use strict';

let fc = null;
let store = null, cfg = null;            // dms-config.json

const DEFAULTS = {
    enabled: true, from: 'requests', popups: true, desktop: true, sound: true,
    friends: [],             // [{ pk, n, g, since }]: both of you accepted
    out: [],                 // [{ pk, n, g, at }]: your requests, waiting
    in: [],                  // [{ pk, n, g, at, id }]: theirs, waiting for you
    reqs: [],                // [{ pk, n, g, at }]: message requests
    blocked: [],             // [{ pk, n, at }]
    hi: {},                  // pk -> when you first wrote to them (a message request went out)
    seen: {},                // presence hash -> { dk, at }: Fightcord IDs heard lately
    syncAt: {},              // pk -> when that player last changed (here or on your other PC)
    nicks: {},               // pk -> your nickname for them (3.8; only you see it)
    left: {},                // group id -> when you left it (an old invite doesn't put you back, 3.8)
    done: []                 // inbox event ids already handled (they come back on every start)
};
const T = (s, v) => (fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)));
const E = (s) => fc.fmt.esc(s);
const N_ = (s) => s;
const lc = (s) => String(s || '').toLowerCase();
const mod = (id) => fc.modules.get(id);
const isPk = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const cleanName = (n) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) : '');
const cleanG = (g) => (typeof g === 'string' && /^[0-9a-f]{1,64}$/i.test(g) ? g : '');
const SEEN_MAX = 800, DONE_MAX = 1500;

/* ================================================================ pure parts */

// the name you asked for, in their own spelling when it's the same name ("bob" -> "Bob"; never another name)
const spell = (asked, theirs) => (asked && theirs && lc(asked) === lc(theirs) ? theirs : asked || theirs);
const find = (list, pk) => (list || []).find(x => x.pk === pk) || null;
const drop = (list, pk) => (list || []).filter(x => x.pk !== pk);

// a message in your inbox -> what it changes. s: the state (cfg-shaped, changed in place);
// m: { id, from, at, b: { t, n, g } }; o: { from: 'requests' | 'friends', hasDm(pk) }
//   -> { what: '' | 'request' | 'accepted' | 'removed' | 'msgreq' | 'refresh', send: [{ to, t }], dm: [{ pk, n, g, req }] }
//   fr = a friend request, fa = an accept, fx = unfriend / a request taken back, hi = a DM from a non-friend
function onInbox(s, m, o) {
    const out = { what: '', send: [], dm: [] };
    const b = m && m.b;
    if (!b || !isPk(m.from) || !m.id) return out;
    if ((s.done || []).indexOf(m.id) >= 0 || find(s.blocked, m.from)) return out;
    s.done = (s.done || []).concat(m.id).slice(-DONE_MAX);
    const pk = m.from, at = +m.at || 0;
    const fr = find(s.friends, pk);
    // 3.8: a group DM's key: from a friend (they added you), or your other PC (you made / joined it there)
    if (b.t === 'gi') {
        const mine = !!(o && o.me && pk === o.me);
        if (!fr && !mine) return out;
        const left = (s.left || {})[b.id];
        if (left && left > at) return out;
        out.what = 'group';
        out.group = { s: b.s, prev: b.prev, o: b.o, id: b.id, nm: b.nm, by: mine ? '' : fr.n, mine };
        return out;
    }
    // a note from your own other PC: what changed there
    if (o && o.me && m.from === o.me) return onSync(s, m, out);
    const n = cleanName(b.n), g = cleanG(b.g);
    if (b.t === 'fr') {
        if (!n) return out;
        // someone you're friends with, from another Fightcord: a new PC (or someone pretending): ask
        const was = s.friends.find(f => f.pk !== pk && lc(f.n) === lc(n));
        if (was && !fr && !find(s.out, pk)) {
            const had = find(s.in, pk);
            if (had) { had.at = Math.max(had.at, at); out.what = 'refresh'; return out; }
            s.in.push({ pk, n: was.n, g: g || was.g || '', at, id: m.id, was: was.pk });
            out.what = 'newpc';
            return out;
        }
        // already friends: they may have lost their side (a new PC): say yes again
        if (fr) { if (at > fr.since) out.send.push({ to: pk, t: 'fa' }); return out; }
        // you asked them too: that's a yes from both
        if (find(s.out, pk)) {
            const mine = find(s.out, pk), nm = spell(mine.n, n);
            s.out = drop(s.out, pk);
            s.in = drop(s.in, pk);
            s.friends.push({ pk, n: nm, g: g || mine.g || '', since: at });
            out.send.push({ to: pk, t: 'fa' });
            out.dm.push({ pk, n: nm, g, req: false });
            out.what = 'accepted';
            return out;
        }
        const had = find(s.in, pk);
        if (had) { had.at = Math.max(had.at, at); had.n = n; if (g) had.g = g; out.what = 'refresh'; return out; }
        s.in.push({ pk, n, g, at, id: m.id });
        out.what = 'request';
        return out;
    }
    if (b.t === 'fa') {
        const mine = find(s.out, pk);
        if (!mine || fr) return out;                     // only a yes to a request you sent counts
        const nm = spell(mine.n, n);
        s.out = drop(s.out, pk);
        s.in = drop(s.in, pk);
        s.friends.push({ pk, n: nm, g: g || mine.g || '', since: at });
        out.dm.push({ pk, n: nm, g, req: false });
        out.what = 'accepted';
        return out;
    }
    if (b.t === 'fx') {
        let any = false;
        if (fr && at > fr.since) { s.friends = drop(s.friends, pk); any = true; out.what = 'removed'; }
        if (find(s.in, pk)) { s.in = drop(s.in, pk); any = true; if (!out.what) out.what = 'refresh'; }
        if (!any) return out;
        return out;
    }
    if (b.t === 'hi') {
        if (fr || find(s.reqs, pk) || (o && o.hasDm && o.hasDm(pk)) || (o && o.from === 'friends') || !n) return out;
        s.reqs.push({ pk, n, g, at });
        out.dm.push({ pk, n, g, req: true });
        out.what = 'msgreq';
        return out;
    }
    return out;
}

// your other PCs (the same ID) tell each other what they changed, through your own inbox:
//   b: { t: 'sync', op, pk, n, g, was }. The newest change per player wins (s.syncAt), so the order
//   the notes arrive in doesn't matter. -> out with what: 'sync', dm / drop / retire for lobbies.js
const SYNC_OPS = ['friend', 'unfriend', 'out', 'cancel', 'decline', 'block', 'unblock', 'reqok', 'reqno', 'replace', 'nick'];
function onSync(s, m, out) {
    const b = m.b, pk = b.pk, at = +m.at || 0;
    if (b.t !== 'sync' || !isPk(pk) || SYNC_OPS.indexOf(b.op) < 0) return out;
    s.syncAt = s.syncAt || {};
    // a nickname (3.8) has its own clock: it doesn't race the friend changes
    if (b.op === 'nick') {
        const k = 'n:' + pk;
        if ((s.syncAt[k] || 0) >= at) return out;
        s.syncAt[k] = at;
        s.nicks = s.nicks || {};
        const n = cleanName(b.n).slice(0, 32);
        if (n) s.nicks[pk] = n; else delete s.nicks[pk];
        out.what = 'sync';
        return out;
    }
    if ((s.syncAt[pk] || 0) >= at) return out;
    s.syncAt[pk] = at;
    const n = cleanName(b.n), g = cleanG(b.g);
    out.drop = []; out.retire = [];
    const gone = (k) => { s.friends = drop(s.friends, pk); s.out = drop(s.out, pk); s.in = drop(s.in, pk); s.reqs = drop(s.reqs, pk); if (k) s.blocked = drop(s.blocked, pk); };
    if (b.op === 'friend' || b.op === 'replace') {
        const prev = find(s.friends, pk);
        gone(true);
        if (b.op === 'replace' && isPk(b.was)) { s.friends = drop(s.friends, b.was); out.retire.push(b.was); }
        s.friends.push({ pk, n: n || (prev && prev.n) || '?', g, since: (prev && prev.since) || at });
        out.dm.push({ pk, n: n || '?', g, req: false });
    } else if (b.op === 'unfriend') s.friends = drop(s.friends, pk);
    else if (b.op === 'out') { if (!find(s.friends, pk) && !find(s.out, pk) && n) s.out.push({ pk, n, g, at }); }
    else if (b.op === 'cancel') s.out = drop(s.out, pk);
    else if (b.op === 'decline') s.in = drop(s.in, pk);
    else if (b.op === 'block') { gone(true); s.blocked.push({ pk, n: n || '?', at }); out.drop.push(pk); }
    else if (b.op === 'unblock') s.blocked = drop(s.blocked, pk);
    else if (b.op === 'reqok') { s.reqs = drop(s.reqs, pk); out.dm.push({ pk, n: n || '?', g, req: false, open: true }); }
    else if (b.op === 'reqno') { s.reqs = drop(s.reqs, pk); out.drop.push(pk); }
    out.what = 'sync';
    return out;
}

// a name you can't be sure of: another key already goes by it (a friend, or someone you're talking to)
//   -> the friend / DM that has it, or null
function clash(s, pk, name, dms) {
    const k = lc(name);
    if (!k) return null;
    const f = (s.friends || []).find(x => x.pk !== pk && lc(x.n) === k);
    if (f) return f;
    return (dms || []).find(x => x.pk !== pk && lc(x.n) === k) || null;
}

/* ================================================================== the state */

const L = () => mod('lobbies');
const P = () => mod('presence');
const F = () => mod('friends');
const me = () => fc.app.me() || '';
const now = () => Date.now();
const isFriendPk = (pk) => !!find(cfg.friends, pk);
const friendNamed = (name) => cfg.friends.find(f => lc(f.n) === lc(name)) || null;
const isBlocked = (pk) => !!find(cfg.blocked, pk);
let homeTab = 'online';
let addMsg = null;                       // { ok, text }: the Add friend tab's last answer
let quietFriends = false;                // (we're changing the star list ourselves: don't react to it)

function save() {
    store.save();
    fc.emit('dms:changed', {});
    refresh();
}
function refresh() {
    const lb = L();
    if (lb && lb.refresh && lb.shown && lb.shown() && (lb.shown() === lb.HOME || lb.dmList().some(d => d.id === lb.shown()))) lb.refresh();
    renderRail();
}

// a player's Fightcord ID: heard just now (presence), or lately
function idOf(name) {
    const p = P();
    if (!p || !name) return '';
    const live = p.info && p.info(name);
    if (live && isPk(live.dk)) return live.dk;
    const s = p.hashOf ? cfg.seen[p.hashOf(name)] : null;
    return s && isPk(s.dk) && now() - s.at < 30 * 86400000 ? s.dk : '';
}
// what to make of a request's name: 'seen' (presence heard that name with this key), 'clash' (another
// key already goes by it), '' (not confirmed either way)
function trustOf(pk, name) {
    const lb = L();
    if (clash(cfg, pk, name, lb ? lb.dmList() : [])) return 'clash';
    return idOf(name) === pk ? 'seen' : '';
}
// a friend's name now heard with another key: a new PC, or someone pretending
function warning(pk) {
    const f = find(cfg.friends, pk);
    const lb = L();
    const d = !f && lb ? lb.dmList().find(x => x.pk === pk) : null;
    const name = f ? f.n : d ? d.n : '';
    const p = P();
    const live = name && p && p.info ? p.info(name) : null;
    if (live && isPk(live.dk) && live.dk !== pk) return T('Another Fightcord is using the name {name} right now. It may be a new PC of theirs, or someone pretending to be them.', { name });
    return '';
}

/* ================================================================= actions */

function send(to, t) { const lb = L(); return !!(lb && lb.inboxSend && lb.inboxSend(to, { t })); }
const myPk = () => { const lb = L(); return lb && lb.myId ? lb.myId() : ''; };
// tell your other PCs (the same ID) what you changed here
function syncOut(op, pk, x) {
    const me = myPk(), lb = L();
    if (!me || !isPk(pk)) return;
    cfg.syncAt[op === 'nick' ? 'n:' + pk : pk] = now();
    if (lb && lb.inboxSend) lb.inboxSend(me, Object.assign({ t: 'sync', op, pk, n: '', g: '' }, x || {}));
}

// a friend request to a player, by name
function request(name) {
    const n = cleanName(name);
    if (!n) return { ok: false, text: T('Type a Fightcade name') };
    if (fc.app.isMe(n)) return { ok: false, text: T('That’s you!') };
    const f = friendNamed(n);
    if (f) return { ok: false, text: T('You’re already friends with {name}', { name: f.n }) };
    const pk = idOf(n);
    if (!pk) return { ok: false, text: T('{name} isn’t on Fightcord, or hasn’t been online lately. They need Fightcord 3.6 or newer (and “Show that I use Fightcord” on).', { name: n }) };
    if (isBlocked(pk)) return { ok: false, text: T('You blocked {name}. Unblock them first.', { name: n }) };
    // they asked you already: that's a yes
    if (find(cfg.in, pk)) { accept(pk); return { ok: true, text: T('You and {name} are friends now', { name: n }) }; }
    if (find(cfg.out, pk)) return { ok: true, text: T('Your request to {name} is still waiting', { name: n }) };
    const g = (fc.app.user(n)[1] || {}).gravatar || '';
    const exact = fc.app.user(n)[1] ? fc.app.user(n)[0] : n;
    if (!send(pk, 'fr')) return { ok: false, text: T('Not connected to the relays yet. Try again in a moment.') };
    cfg.out.push({ pk, n: exact, g: cleanG(g), at: now() });
    syncOut('out', pk, { n: exact, g: cleanG(g) });
    save();
    return { ok: true, text: T('Friend request sent to {name}', { name: exact }) };
}
function accept(pk) {
    const r = find(cfg.in, pk);
    if (!r) return;
    cfg.in = drop(cfg.in, pk);
    cfg.out = drop(cfg.out, pk);
    // their new PC: it takes the old one's place (the old DM stays readable, closed)
    const was = r.was && find(cfg.friends, r.was);
    if (was) { cfg.friends = drop(cfg.friends, r.was); const lb = L(); if (lb && lb.dmRetire) lb.dmRetire(r.was); }
    cfg.friends.push({ pk, n: r.n, g: r.g || '', since: was ? was.since : now() });
    send(pk, 'fa');
    becameFriends(pk, r.n, r.g);
    syncOut(was ? 'replace' : 'friend', pk, { n: r.n, g: r.g || '', was: was ? was.pk : '' });
    save();
    fc.ui.toast(T('You and {name} are friends now', { name: r.n }), { icon: 'users', actions: [{ label: T('Message'), fn: () => openDm(pk) }] });
}
function decline(pk) {
    if (!find(cfg.in, pk)) return;
    cfg.in = drop(cfg.in, pk);
    syncOut('decline', pk);
    save();
}
function cancel(pk) {
    if (!find(cfg.out, pk)) return;
    cfg.out = drop(cfg.out, pk);
    send(pk, 'fx');
    syncOut('cancel', pk);
    save();
}
function unfriend(pk, quiet) {
    const f = find(cfg.friends, pk);
    if (!f) return;
    cfg.friends = drop(cfg.friends, pk);
    send(pk, 'fx');
    unstar(f.n);
    syncOut('unfriend', pk);
    save();
    if (!quiet) fc.ui.toast(T('{name} isn’t your friend any more', { name: f.n }), { icon: 'users' });
}
function block(pk) {
    const lb = L();
    const d = lb ? lb.dmList().find(x => x.pk === pk) : null;
    const known = find(cfg.friends, pk) || find(cfg.in, pk) || find(cfg.out, pk) || find(cfg.reqs, pk) || d || {};
    if (find(cfg.friends, pk)) unfriend(pk, true);
    if (find(cfg.out, pk)) cancel(pk);
    cfg.in = drop(cfg.in, pk);
    cfg.reqs = drop(cfg.reqs, pk);
    if (!isBlocked(pk)) cfg.blocked.push({ pk, n: known.n || '?', at: now() });
    if (lb && lb.dmDrop) lb.dmDrop(pk);
    syncOut('block', pk, { n: known.n || '?' });
    save();
    fc.ui.toast(T('Blocked {name}', { name: known.n || '?' }), { icon: 'ban', sub: T('They can’t message or call you, and their requests don’t reach you.') });
}
function unblock(pk) { cfg.blocked = drop(cfg.blocked, pk); syncOut('unblock', pk); save(); }

// 3.8: your own name for a friend (only you see it; your other PCs get it too)
const nickOf = (pk) => (cfg && cfg.nicks && cfg.nicks[pk]) || '';
const callName = (pk, n) => nickOf(pk) || n;
function setNick(pk, nick) {
    const n = cleanName(nick).slice(0, 32);
    if (n) cfg.nicks[pk] = n; else delete cfg.nicks[pk];
    syncOut('nick', pk, { n });
    save();
}
function nickModal(pk) {
    const lb = L();
    const who = find(cfg.friends, pk) || (lb ? lb.dmList().find(x => x.pk === pk) : null);
    if (!who) return;
    const m = fc.ui.modal({
        title: nickOf(pk) ? T('Edit Friend Nickname') : T('Add Friend Nickname'), width: 420,
        body: `<div class="fclbForm"><label><span>${E(T('Friend nickname'))}</span><input class="fc-input" data-f="nick" maxlength="32" value="${E(nickOf(pk))}" placeholder="${E(who.n)}"></label>` +
            `<p class="fc-note">${E(T('Only you see it: {name} shows up as this in your DMs, group DMs and friends list.', { name: who.n }))}</p></div>`,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Save'), fn: (b) => setNick(pk, b.querySelector('[data-f="nick"]').value) }]
    });
    ['keydown', 'keypress', 'keyup'].forEach(ev => m.el.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'keydown' && e.key === 'Enter') { setNick(pk, m.body.querySelector('input').value); m.close(); }
    }));
    setTimeout(() => { const i = m.body.querySelector('input'); if (i) { i.focus(); i.select(); } }, 30);
}

// 3.8: a DM's / group DM's own settings: pinned to the top of the list, muted for a while
const MUTES = [[15, N_('For 15 Minutes')], [60, N_('For 1 Hour')], [180, N_('For 3 Hours')], [480, N_('For 8 Hours')], [1440, N_('For 24 Hours')], [-1, N_('Until I turn it back on')]];
function muteFor(id, mins) {
    const lb = L();
    if (!lb || !lb.dmSet) return;
    lb.dmSet(id, { mute: mins < 0 ? -1 : now() + mins * 60000 });
    renderRail();
}
function muteMenu(anchor, id) {
    fc.ui.menu(anchor, MUTES.map(([mins, label]) => ({ label: T(label), icon: mins < 0 ? 'bellOff' : 'clock', fn: () => muteFor(id, mins) })), { side: 'right' });
}
// right-click (or ⋯) on a DM in the list
function rowMenu(anchor, id) {
    const lb = L();
    const d = lb ? lb.dmList().find(x => x.id === id) : null;
    if (!d) return;
    const items = [];
    if (d.unread) items.push({ label: T('Mark As Read'), icon: 'check', fn: () => { lb.markRead(id); renderRail(); refresh(); } });
    items.push({ label: d.top ? T('Unpin from the top') : T('Pin to the top'), icon: 'pin', fn: () => lb.dmSet(id, { top: !d.top }) });
    if (d.muted) items.push({ label: d.group ? T('Unmute Group') : T('Unmute Conversation'), icon: 'bell', fn: () => { lb.dmSet(id, { mute: 0 }); renderRail(); } });
    else items.push({ label: d.group ? T('Mute Group…') : T('Mute Conversation…'), icon: 'bellOff', fn: () => setTimeout(() => muteMenu(anchor, id), 0) });
    items.push('sep');
    if (d.group) {
        items.push({ label: T('Edit Group'), icon: 'edit', fn: () => lb.groupEdit(id) });
        items.push({ label: T('Add friends to the group'), icon: 'userPlus', fn: () => groupPicker(anchor, { into: id }) });
        items.push('sep');
        items.push({ label: T('Leave Group'), icon: 'logout', danger: true, fn: () => lb.groupLeave(id) });
    } else {
        const f = find(cfg.friends, d.pk);
        const sc = mod('scout');
        if (sc && sc.openCard) items.push({ label: T('Scout card'), icon: 'search', fn: () => sc.openCard(d.n, anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null, 'beside') });
        if (f && !d.old) items.push({ label: T('Call'), icon: 'phone', fn: () => { lb.dmFor(d.pk, f.n, f.g, { show: true }); lb.call(d.pk); } });
        if (f) items.push({ label: nickOf(d.pk) ? T('Edit Friend Nickname') : T('Add Friend Nickname'), icon: 'edit', fn: () => nickModal(d.pk) });
        items.push('sep');
        items.push({ label: T('Close DM'), icon: 'close', fn: () => lb.dmHide(d.pk) });
    }
    fc.ui.menu(anchor, items, { side: 'right' });
}

// "Select Friends": a new DM (one friend) or group DM (two or more); o.with: who the DM is with already
// (adding friends to a DM makes a new group with them in it), o.into: a group to add friends to
function groupPicker(anchor, o) {
    const lb = L();
    if (!lb || !lb.createGroup) return;
    const p = o || {};
    const inGroup = p.into ? lb.groupMembers(p.into).map(x => x.pk) : [];
    const base = (p.with || []).filter(isPk);
    const room = p.into ? Math.max(0, 10 - inGroup.length) : 10 - 1 - base.length;
    const pool = cfg.friends.filter(f => inGroup.indexOf(f.pk) < 0 && base.indexOf(f.pk) < 0 && !isBlocked(f.pk))
        .sort((a, b) => lc(callName(a.pk, a.n)).localeCompare(lc(callName(b.pk, b.n))));
    const picked = new Set();
    const box = document.createElement('div');
    box.className = 'fcdmPick';
    const label = () => (p.into ? T('Add') : picked.size + base.length >= 2 ? T('Create Group DM') : T('Create DM'));
    const draw = () => {
        const q = lc(box.querySelector('.fcdmPickQ').value);
        const list = pool.filter(f => !q || lc(callName(f.pk, f.n)).indexOf(q) >= 0 || lc(f.n).indexOf(q) >= 0);
        const left = room - picked.size;
        fc.ui.setHtml(box.querySelector('.sub'), E(left > 0 ? fc.t.plural(left, 'You can add {n} more friend.', 'You can add {n} more friends.') : T('This group has no room for more friends.')));
        fc.ui.setHtml(box.querySelector('.l'), list.length ? list.map(f => {
            const st = statusFor(f.pk, f.n);
            return `<div class="r${picked.has(f.pk) ? ' on' : ''}" data-pick="${E(f.pk)}">${avatarOf(f.n, f.g, 32, st.on ? st.st : 'off')}<span class="nm"><b>${E(callName(f.pk, f.n))}</b>` +
                (nickOf(f.pk) ? `<small>${E(f.n)}</small>` : '') + `</span><i class="ck">${fc.ui.icon('check')}</i></div>`;
        }).join('') : `<div class="none">${E(pool.length ? T('No friends found') : p.into ? T('All your friends are in this group already') : T('Add friends first: a group DM is you and your Fightcord friends.'))}</div>`);
        const b = box.querySelector('.go');
        b.disabled = !picked.size && !base.length;
        b.textContent = label();
    };
    box.innerHTML = fc.ui.popHead({ icon: 'users', title: T('Select Friends'), sub: '' }) +
        `<div class="fc-pb"><div class="sub"></div><input class="fc-input fcdmPickQ" maxlength="40" placeholder="${E(T('Type the name of a friend'))}" spellcheck="false"><div class="l"></div>` +
        `<button type="button" class="fc-btn brand go">${E(label())}</button></div>`;
    box.addEventListener('click', (e) => {
        const r = e.target.closest('[data-pick]');
        if (r) {
            const pk = r.dataset.pick;
            if (picked.has(pk)) picked.delete(pk); else if (picked.size < room) picked.add(pk);
            else fc.ui.toast(T('A group DM can have {n} people', { n: 10 }), { icon: 'users' });
            draw();
            return;
        }
        if (!e.target.closest('.go')) return;
        const people = [...base, ...picked].map(pk => find(cfg.friends, pk)).filter(Boolean).map(f => ({ pk: f.pk, n: f.n, g: f.g || '' }));
        pop.close();
        if (p.into) {
            const why = people.map(x => lb.addToGroup(p.into, x)).filter(Boolean);
            if (why.length) fc.ui.toast(why[0], { icon: 'users', kind: 'warning' });
            return;
        }
        if (people.length === 1) { openDm(people[0].pk); return; }
        const id = lb.createGroup(people);
        if (!id) { fc.ui.toast(T('Couldn’t make the group'), { kind: 'warning', icon: 'users' }); return; }
        lb.open(id);
    });
    const q = box.querySelector('.fcdmPickQ');
    q.addEventListener('input', draw);
    ['keydown', 'keypress', 'keyup'].forEach(ev => q.addEventListener(ev, (e) => e.stopPropagation()));
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    const pop = fc.ui.popover(anchor, box, { side: 'bottom', width: 440, cls: 'fc-pop-card fcdmPickPop' });
    draw();
    setTimeout(() => q.focus(), 30);
}
// a message request: write back (not friends, just the DM)
function acceptReq(pk) {
    const r = find(cfg.reqs, pk);
    cfg.reqs = drop(cfg.reqs, pk);
    const lb = L();
    if (lb) lb.dmFor(pk, r ? r.n : '', r ? r.g : '', { req: false, show: true });
    syncOut('reqok', pk, { n: r ? r.n : '', g: r ? r.g : '' });
    save();
}
function ignoreReq(pk) {
    cfg.reqs = drop(cfg.reqs, pk);
    const lb = L();
    if (lb && lb.dmDrop) lb.dmDrop(pk);
    syncOut('reqno', pk);
    save();
}

// friends on both sides: their DM, and a ★ in your friends list (online / match alerts, the member list)
function becameFriends(pk, n, g) {
    const lb = L();
    if (lb) lb.dmFor(pk, n, g, { req: false });
    cfg.reqs = drop(cfg.reqs, pk);
    star(n);
}
function star(n) { const f = F(); if (!f || !f.isFriend || f.isFriend(n)) return; quietFriends = true; try { f.add(n); } finally { quietFriends = false; } }
function unstar(n) { const f = F(); if (!f || !f.isFriend || !f.isFriend(n)) return; quietFriends = true; try { f.remove(n); } finally { quietFriends = false; } }

function openDm(pk) {
    const lb = L();
    if (!lb) return;
    const f = find(cfg.friends, pk), d = lb.dmList().find(x => x.pk === pk);
    const who = f || d;
    if (!who) return;
    lb.openDm(pk, who.n, who.g || '');
}
// a scout card's "Message": a friend's DM, or a new one with someone on Fightcord
function openWith(name) {
    const lb = L();
    if (!lb || !cfg.enabled) return false;
    const f = friendNamed(name);
    if (f) { openDm(f.pk); return true; }
    const d = lb.dmList().find(x => lc(x.n) === lc(name));
    if (d) { lb.openDm(d.pk, d.n, d.g); return true; }
    const pk = idOf(name);
    if (!pk || isBlocked(pk)) { fc.ui.toast(T('{name} isn’t on Fightcord right now', { name }), { icon: 'chat', sub: T('DMs need Fightcord 3.6 or newer on both sides.') }); return false; }
    const g = (fc.app.user(name)[1] || {}).gravatar || '';
    const exact = fc.app.user(name)[1] ? fc.app.user(name)[0] : name;
    lb.openDm(pk, exact, g);
    return true;
}
const canDm = (name) => !!cfg && cfg.enabled && !!(friendNamed(name) || idOf(name));
// you can write in a DM unless you blocked them (who may write to *you* is your own setting)
const canWrite = (pk) => { const lb = L(); const d = lb ? lb.dmList().find(x => x.pk === pk) : null; return !isBlocked(pk) && !(d && d.old); };

function openHome(tab) {
    if (tab) homeTab = tab;
    const lb = L();
    if (lb && lb.openHome) lb.openHome();
}

/* ===================================================================== inbox */

function onInboxMsg(m) {
    const lb = L();
    const r = onInbox(cfg, m, { from: cfg.from, me: myPk(), hasDm: (pk) => !!(lb && lb.dmOf(pk)) });
    if (!r.what && !r.send.length) { store.save(); return; }
    // 3.8: a friend added you to a group DM (or you made / joined one on your other PC)
    if (r.what === 'group') {
        store.save();
        const id = lb && lb.joinGroup ? lb.joinGroup(r.group) : '';
        if (!id || r.group.mine || !(m.at > bootAt - 60000) || !cfg.popups || quiet()) return;
        const title = T('{name} added you to a group', { name: callName(m.from, r.group.by) });
        fc.ui.toast(title, { icon: 'users', sub: r.group.nm || '', actions: [{ label: T('Open'), fn: () => lb.open(id) }] });
        away(title, r.group.nm || '', () => lb.open(id), { n: r.group.by, tag: 'fcgi-' + id });
        if (cfg.sound) fc.sound.play('ping');
        return;
    }
    r.send.forEach(x => send(x.to, x.t));
    (r.retire || []).forEach(pk => { if (lb && lb.dmRetire) lb.dmRetire(pk); });
    (r.drop || []).forEach(pk => { if (lb && lb.dmDrop) lb.dmDrop(pk); });
    r.dm.forEach(x => {
        if (x.req) { if (lb) lb.dmFor(x.pk, x.n, x.g, { req: true }); }
        else if (x.open) { if (lb) lb.dmFor(x.pk, x.n, x.g, { req: false, show: true }); }
        else becameFriends(x.pk, x.n, x.g);
    });
    // your other PC only heard the yes if it knew about the request: tell it
    if (r.what === 'accepted') { const f = find(cfg.friends, m.from); if (f) syncOut('friend', f.pk, { n: f.n, g: f.g || '' }); }
    save();
    if (r.what === 'sync') return;
    const fresh = m.at > bootAt - 60000;
    const who = cleanName(m.b.n) || (find(cfg.friends, m.from) || {}).n || '?';
    const fr = F();
    if (r.what === 'newpc') {
        if (fr && fr.note) fr.note(T('{name} has a new PC', { name: who }), T('Accept their new friend request to keep talking'), who, 'request');
        if (fresh && cfg.popups && !quiet()) {
            fc.ui.toast(T('{name} has a new PC', { name: who }), { icon: 'userPlus', ms: 12000, sub: T('Accept their new friend request to keep talking'),
                actions: [{ label: T('Look'), fn: () => openHome('pending') }] });
            away(T('{name} has a new PC', { name: who }), T('Accept their new friend request to keep talking'), () => openHome('pending'), { n: who, tag: 'fcfr-' + m.from });
            if (cfg.sound) fc.sound.play('ping');
        }
    } else if (r.what === 'request') {
        if (fr && fr.note) fr.note(T('{name} sent you a friend request', { name: who }), T('Open Friends → Pending to accept'), who, 'request');
        if (fresh && cfg.popups && !quiet()) {
            fc.ui.toast(T('{name} sent you a friend request', { name: who }), { icon: 'userPlus', ms: 12000,
                actions: [{ label: T('Accept'), fn: () => accept(m.from) }, { label: T('Look'), kind: 'sec', fn: () => openHome('pending') }] });
            away(T('{name} sent you a friend request', { name: who }), T('Open Friends → Pending to accept'), () => openHome('pending'), { n: who, tag: 'fcfr-' + m.from });
            if (cfg.sound) fc.sound.play('ping');
        }
    } else if (r.what === 'accepted') {
        const f = find(cfg.friends, m.from);
        const name = f ? f.n : who;
        if (fr && fr.note) fr.note(T('{name} accepted your friend request', { name }), T('You can message and call each other now'), name, 'request');
        if (fresh && cfg.popups && !quiet()) {
            fc.ui.toast(T('{name} accepted your friend request', { name }), { icon: 'users', actions: [{ label: T('Message'), fn: () => openDm(m.from) }] });
            away(T('{name} accepted your friend request', { name }), T('You can message and call each other now'), () => openDm(m.from), { n: name, tag: 'fcfr-' + m.from });
            if (cfg.sound) fc.sound.play('ping');
        }
    } else if (r.what === 'msgreq' && fresh && cfg.popups && !quiet()) {
        fc.ui.toast(T('{name} wants to message you', { name: who }), { icon: 'chat', sub: T('A message request: they aren’t your friend.'),
            actions: [{ label: T('Look'), fn: () => openHome('reqs') }] });
        away(T('{name} wants to message you', { name: who }), T('A message request: they aren’t your friend.'), () => openHome('reqs'), { n: who, tag: 'fchi-' + m.from });
    }
}

// a DM came in (lobbies.js: not on screen right now)
function onMessage(pk, m) {
    if (isBlocked(pk)) return;
    const lb = L();
    const d = lb ? lb.dmList().find(x => x.pk === pk) : null;
    if (!d || d.req) return;                                 // a message request stays quiet
    if (!isFriendPk(pk) && cfg.from === 'friends') return;
    renderRail();
    if (d.muted || quiet() || (fc.ui.dnd && fc.ui.dnd())) return;
    const text = fc.fmt.short(String(m.x || ''), 120), name = callName(pk, d.n);
    if (cfg.popups) fc.ui.toast(name, { icon: 'chat', sub: text, actions: [{ label: T('Reply'), fn: () => openDm(pk) }] });
    away(name, text, () => openDm(pk), { n: d.n, g: d.g, tag: 'fcdm-' + pk });
    if (cfg.sound && (cfg.popups || cfg.desktop)) fc.sound.tone([[988, 0, .06], [1319, .07, .09]], { volume: .45 });
}
// a group DM's message (lobbies.js: not on screen right now)
function onGroupMessage(id, m) {
    const lb = L();
    const d = lb ? lb.dmList().find(x => x.id === id) : null;
    if (!d || isBlocked(m.pk)) return;
    renderRail();
    if (d.muted || quiet() || (fc.ui.dnd && fc.ui.dnd())) return;
    const who = callName(m.pk, m.n);
    const text = fc.fmt.short(who + ': ' + String(m.x || ''), 120);
    if (cfg.popups) fc.ui.toast(d.n, { icon: 'users', sub: text, actions: [{ label: T('Reply'), fn: () => lb.open(id) }] });
    away(d.n, text, () => lb.open(id), { n: m.n, g: m.g || '', tag: 'fcgp-' + id });
    if (cfg.sound && (cfg.popups || cfg.desktop)) fc.sound.tone([[988, 0, .06], [1319, .07, .09]], { volume: .45 });
}
// 3.6.1: Fightcade is behind a match or another app: flash the taskbar and tell Windows too
function away(title, body, open, who) {
    if (!cfg.desktop || !fc.ui.attention) return;
    fc.ui.attention(title, { body, tag: who.tag, icon: who.n ? fc.data.avatarUrl(who.n, who.g || '', 80) : '', onClick: open });
}
function quiet() { const st = mod('streamer'); return !!(st && st.quiet && st.quiet()); }

/* ============================================================ the DM page */

const ST_TEXT = { on: N_('Online'), away: N_('Away'), playing: N_('In a match'), off: N_('Offline') };
const avatarOf = (name, g, size, st) => fc.ui.avatar(name, { size, status: st || '' }).replace(/src="[^"]*"/, `src="${E(fc.data.avatarUrl(name, g, size * 2))}"`);
const shortGame = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');

// a friend's (or anyone's) status: Fightcade's own when we can see them, else the DM's live line
function statusFor(pk, name) {
    const u = fc.app.userInfo(name);
    const lb = L();
    const live = lb && lb.dmStatus ? lb.dmStatus(pk) : null;
    if (u && u.playing && u.playing.quarkId) return { st: 'playing', on: true, sub: T('In a match') + (u.playing.opp ? ' vs ' + u.playing.opp : '') };
    if (u) return { st: u.away ? 'away' : 'on', on: true, sub: T(u.away ? 'Away' : 'Online') + (u.channels && u.channels[0] ? ' · ' + shortGame(u.channels[0]) : '') };
    if (live && live.on) return { st: live.st, on: true, sub: live.v ? T('In the call') : T(ST_TEXT[live.st] || 'Online') };
    return { st: 'off', on: false, sub: T('Offline') };
}

function sideHtml(active) {
    const lb = L();
    const list = lb ? lb.dmList().filter(d => !d.hidden && !d.req && (d.group || !isBlocked(d.pk))) : [];
    const pend = cfg.in.length, reqs = cfg.reqs.length;
    const home = lb && active === lb.HOME;
    const nav = (tab, icon, label, n) => `<div class="fcdmNav${home && (tab === 'reqs' ? homeTab === 'reqs' : homeTab !== 'reqs') ? ' on' : ''}" data-dmx="${tab}">${fc.ui.icon(icon)}<span>${E(label)}</span>${n ? `<b>${n}</b>` : ''}</div>`;
    const row = (d) => {
        const st = d.group || d.old ? { on: false, st: 'off', sub: '' } : statusFor(d.pk, d.n);
        const name = d.group ? d.n : callName(d.pk, d.n);
        const sub = d.typing ? T('typing…') : d.old ? T('Their old PC') : d.voice ? T('In a call')
            : d.group ? fc.t.plural(d.members, '{n} member', '{n} members')
                : st.on ? st.sub : d.last ? (d.last.mine ? T('You: {text}', { text: d.last.x }) : d.last.x) : '';
        const pic = d.group ? d.icon : avatarOf(d.n, d.g, 32, st.on ? st.st : 'off');
        const marks = (d.top ? `<i class="mk" title="${E(T('Pinned to the top'))}">${fc.ui.icon('pin')}</i>` : '') + (d.muted ? `<i class="mk" title="${E(muteText(d))}">${fc.ui.icon('bellOff')}</i>` : '');
        return `<div class="fcdmRow${d.id === active ? ' on' : ''}${d.unread && !d.muted ? ' unread' : ''}${d.old ? ' old' : ''}${d.muted ? ' muted' : ''}${d.typing ? ' typ' : ''}" data-dm="${E(d.id)}" data-pk="${E(d.pk)}">${pic}` +
            `<span class="tx"><b><span>${E(name)}</span>${marks}</b>${sub ? `<small>${E(fc.fmt.short(sub.replace(/\s+/g, ' '), 60))}</small>` : ''}</span>` +
            (d.unread && !d.muted ? `<em>${d.unread > 9 ? '9+' : d.unread}</em>` : '') +
            `<i class="x more" data-dmx="rowmore" title="${E(T('More'))}">${fc.ui.icon('more')}</i>` +
            (d.group ? '' : `<i class="x" data-dmx="hide" title="${E(T('Close DM'))}">${fc.ui.icon('close')}</i>`) + '</div>';
    };
    return `<div class="fcdmFind" data-dmx="add">${E(T('Find or start a conversation'))}</div>` +
        nav('friends', 'users', T('Friends'), pend) + (reqs ? nav('reqs', 'chat', T('Message requests'), reqs) : '') +
        `<div class="fcdmCat"><span>${E(T('Direct messages'))}</span><i data-dmx="newdm" title="${E(T('Create DM'))}">${fc.ui.icon('plus')}</i></div>` +
        (list.length ? list.map(row).join('') : `<div class="fcdmNone">${E(T('Your DMs show up here.'))}</div>`);
}
const muteText = (d) => (d.mute === -1 ? T('Muted') : T('Muted until {time}', { time: new Date(d.mute).toLocaleTimeString(fc.t.locale ? fc.t.locale() : undefined, { hour: 'numeric', minute: '2-digit' }) }));

function homeTopHtml() {
    const tabs = [['online', N_('Online')], ['all', N_('All')], ['pending', N_('Pending'), cfg.in.length || null], ['blocked', N_('Blocked')]];
    return `<span class="ti">${fc.ui.icon('users')}<b>${E(T('Friends'))}</b></span><span class="fcdmTabs">${fc.ui.tabs(tabs, homeTab === 'reqs' || homeTab === 'add' ? '' : homeTab)}</span>` +
        `<span class="tl">${fc.ui.btn('Add friend', { kind: homeTab === 'add' ? 'ghost' : 'success', size: 'sm', icon: 'userPlus', act: 'none', attrs: 'data-dmx="add"' })}</span>`;
}

function friendRow(f) {
    const st = statusFor(f.pk, f.n);
    const warn = warning(f.pk);
    return `<div class="fcdmF" data-pk="${E(f.pk)}"${nickOf(f.pk) ? ` title="${E(f.n)}"` : ''}>${avatarOf(f.n, f.g, 36, st.on ? st.st : 'off')}<span class="tx"><b>${E(callName(f.pk, f.n))}${warn ? `<i class="w" title="${E(warn)}">${fc.ui.icon('warn')}</i>` : ''}</b><small>${E(st.sub)}</small></span>` +
        `<span class="ac"><i data-dmx="msg" title="${E(T('Message'))}">${fc.ui.icon('chat')}</i><i data-dmx="call" title="${E(T('Start a voice call'))}">${fc.ui.icon('phone')}</i>` +
        `<i data-dmx="more" title="${E(T('More'))}">${fc.ui.icon('more')}</i></span></div>`;
}

function homeHtml() {
    if (homeTab === 'add') return addHtml();
    if (homeTab === 'pending') return pendingHtml();
    if (homeTab === 'blocked') return blockedHtml();
    if (homeTab === 'reqs') return reqsHtml();
    const all = cfg.friends.slice().sort((a, b) => lc(callName(a.pk, a.n)).localeCompare(lc(callName(b.pk, b.n))));
    const rows = homeTab === 'online' ? all.filter(f => statusFor(f.pk, f.n).on) : all;
    const head = (t) => `<div class="fcdmH">${E(t)}</div>`;
    let html = '';
    if (rows.length) html += head(homeTab === 'online' ? T('Online — {n}', { n: rows.length }) : T('All friends — {n}', { n: rows.length })) + rows.map(friendRow).join('');
    else if (homeTab === 'online' && all.length) html += fc.ui.empty({ icon: 'users', title: N_('No friends online right now'), sub: N_('They show up here when they come online.') });
    else if (!all.length) html += fc.ui.empty({ icon: 'userPlus', title: N_('No Fightcord friends yet'), sub: N_('Add someone with their Fightcade name: they need Fightcord too.'), action: N_('Add friend'), act: 'dm-add' });
    // your starred players (the old, one-sided list): send them a request when they have Fightcord
    if (homeTab === 'all') {
        const fr = F();
        const stars = fr && fr.list ? fr.list().filter(n => !friendNamed(n)) : [];
        if (stars.length) {
            html += head(T('Starred players — {n}', { n: stars.length })) + `<p class="fcdmNote">${E(T('Players you starred. Only you see this list: send a friend request to the ones with Fightcord.'))}</p>` +
                stars.map(n => {
                    const pk = idOf(n), out = pk && find(cfg.out, pk);
                    const u = fc.app.userInfo(n);
                    return `<div class="fcdmF star" data-name="${E(n)}">${fc.ui.avatar(n, { size: 36, status: 'auto' })}<span class="tx"><b>${E(n)}</b><small>${E(u ? T('Online') : T('Offline'))}${pk ? ' · ' + E(T('has Fightcord')) : ''}</small></span><span class="ac">` +
                        (pk ? (out ? `<small class="pend">${E(T('Request sent'))}</small>` : fc.ui.btn('Send request', { kind: 'sec', size: 'sm', icon: 'userPlus', act: 'none', attrs: 'data-dmx="star-req"' })) : '') +
                        `<i data-dmx="scout" title="${E(T('Scout card'))}">${fc.ui.icon('search')}</i></span></div>`;
                }).join('');
        }
    }
    return html;
}

function addHtml() {
    const m = addMsg;
    return `<div class="fcdmAdd"><h3>${E(T('Add friend'))}</h3><p>${E(T('Add a Fightcord player with their Fightcade name. They get a request, and once they accept you can message, call and challenge each other.'))}</p>` +
        `<div class="fcdmAddBox${m ? (m.ok ? ' ok' : ' bad') : ''}"><input class="fcdmAddIn" maxlength="40" placeholder="${E(T('Their Fightcade name'))}" spellcheck="false">` +
        fc.ui.btn('Send friend request', { kind: 'brand', size: 'sm', act: 'none', attrs: 'data-dmx="send-req"' }) + '</div>' +
        (m ? `<div class="fcdmAddMsg${m.ok ? ' ok' : ' bad'}">${E(m.text)}</div>` : '') +
        `<p class="fcdmNote">${E(T('Fightcade can’t prove who is behind a name, so accepting a request locks in that player’s Fightcord: nobody can pose as them after that. If a request looks odd, ask them in Fightcade’s chat first.'))}</p></div>`;
}

function trustLine(r) {
    const t = trustOf(r.pk, r.n);
    if (t === 'clash') return `<small class="w">${fc.ui.icon('warn')}${E(T('Careful: another Fightcord already goes by this name'))}</small>`;
    if (t === 'seen') return `<small class="ok">${fc.ui.icon('check')}${E(T('Seen online with this Fightcord'))}</small>`;
    return `<small>${E(T('Not confirmed yet: accept only if you know it’s them'))}</small>`;
}
function pendingHtml() {
    if (!cfg.in.length && !cfg.out.length) return fc.ui.empty({ icon: 'userPlus', title: N_('No pending requests'), sub: N_('Friend requests you send or get wait here.') });
    const rowIn = (r) => `<div class="fcdmF${r.was ? ' newpc' : ''}" data-pk="${E(r.pk)}">${avatarOf(r.n, r.g, 36)}<span class="tx"><b>${E(r.n)}</b>` +
        (r.was ? `<small>${E(T('{name} on a new PC', { name: r.n }))} · ${E(fc.fmt.ago(r.at))}</small><small class="w">${fc.ui.icon('warn')}${E(T('Accepting moves {name} to this Fightcord; your old DMs stay here. If they didn’t get a new PC, it may be someone else: ask them first.', { name: r.n }))}</small>`
            : `<small>${E(T('Incoming friend request'))} · ${E(fc.fmt.ago(r.at))}</small>${trustLine(r)}`) + '</span>' +
        `<span class="ac"><i class="yes" data-dmx="accept" title="${E(T('Accept'))}">${fc.ui.icon('check')}</i><i class="no" data-dmx="decline" title="${E(T('Ignore'))}">${fc.ui.icon('close')}</i>` +
        `<i data-dmx="block" title="${E(T('Block'))}">${fc.ui.icon('ban')}</i></span></div>`;
    const rowOut = (r) => `<div class="fcdmF" data-pk="${E(r.pk)}">${avatarOf(r.n, r.g, 36)}<span class="tx"><b>${E(r.n)}</b><small>${E(T('Outgoing friend request'))} · ${E(fc.fmt.ago(r.at))}</small></span>` +
        `<span class="ac"><i class="no" data-dmx="cancel" title="${E(T('Take back'))}">${fc.ui.icon('close')}</i></span></div>`;
    return (cfg.in.length ? `<div class="fcdmH">${E(T('Incoming — {n}', { n: cfg.in.length }))}</div>` + cfg.in.slice().sort((a, b) => b.at - a.at).map(rowIn).join('') : '') +
        (cfg.out.length ? `<div class="fcdmH">${E(T('Outgoing — {n}', { n: cfg.out.length }))}</div>` + cfg.out.slice().sort((a, b) => b.at - a.at).map(rowOut).join('') : '');
}
function reqsHtml() {
    if (!cfg.reqs.length) return fc.ui.empty({ icon: 'chat', title: N_('No message requests'), sub: N_('Messages from Fightcord players who aren’t your friends wait here.') });
    return `<div class="fcdmH">${E(T('Message requests — {n}', { n: cfg.reqs.length }))}</div>` + cfg.reqs.slice().sort((a, b) => b.at - a.at).map(r => {
        const lb = L();
        const d = lb ? lb.dmList().find(x => x.pk === r.pk) : null;
        const last = d && d.last ? d.last.x : '';
        return `<div class="fcdmF" data-pk="${E(r.pk)}" data-dm="${E(d ? d.id : '')}">${avatarOf(r.n, r.g, 36)}<span class="tx"><b>${E(r.n)}</b><small>${E(last ? fc.fmt.short(last, 80) : fc.fmt.ago(r.at))}</small>${trustLine(r)}</span>` +
            `<span class="ac"><i class="yes" data-dmx="req-ok" title="${E(T('Accept'))}">${fc.ui.icon('check')}</i><i class="no" data-dmx="req-no" title="${E(T('Ignore'))}">${fc.ui.icon('close')}</i>` +
            `<i data-dmx="block" title="${E(T('Block'))}">${fc.ui.icon('ban')}</i></span></div>`;
    }).join('');
}
function blockedHtml() {
    if (!cfg.blocked.length) return fc.ui.empty({ icon: 'ban', title: N_('Nobody blocked'), sub: N_('Blocked players can’t message or call you, and their requests don’t reach you.') });
    return `<div class="fcdmH">${E(T('Blocked — {n}', { n: cfg.blocked.length }))}</div>` + cfg.blocked.map(b => `<div class="fcdmF" data-pk="${E(b.pk)}">${fc.ui.avatar(b.n, { size: 36 })}<span class="tx"><b>${E(b.n)}</b><small>${E(T('Blocked'))}</small></span>` +
        `<span class="ac">${fc.ui.btn('Unblock', { kind: 'sec', size: 'sm', act: 'none', attrs: 'data-dmx="unblock"' })}</span></div>`).join('');
}

// the Friends view's right column: who's playing right now
function activeHtml() {
    const busy = cfg.friends.map(f => ({ f, u: fc.app.userInfo(f.n) })).filter(x => x.u && x.u.playing && x.u.playing.quarkId);
    return `<div class="fcdmAct"><h3>${E(T('Active now'))}</h3>` + (busy.length ? busy.map(({ f, u }) => `<div class="fcdmCard" data-pk="${E(f.pk)}">${avatarOf(f.n, f.g, 32, 'playing')}` +
        `<span class="tx"><b>${E(f.n)}</b><small>${E(T('In a match'))}${u.playing.opp ? ' vs ' + E(u.playing.opp) : ''}</small></span></div>`).join('')
        : `<div class="fcdmQuiet"><b>${E(T('It’s quiet for now…'))}</b><small>${E(T('When a friend starts a match, it shows up here.'))}</small></div>`) + '</div>';
}

// a DM's right column: who they are to you
function profileHtml(pk) {
    const lb = L();
    const d = lb ? lb.dmList().find(x => x.pk === pk) : null;
    const f = find(cfg.friends, pk);
    const name = (f && f.n) || (d && d.n) || '?', g = (f && f.g) || (d && d.g) || '';
    const st = statusFor(pk, name);
    const p = P();
    const banner = (p && p.bannerFor && p.bannerFor(name)) || fc.ui.cardBanner('', fc.data.hashColor(name));
    const prof = p && p.profileHtml ? p.profileHtml(name, { status: true }) : '';
    const warn = warning(pk);
    const rel = f ? T('Friends since {date}', { date: new Date(f.since).toLocaleDateString(fc.t.locale ? fc.t.locale() : undefined, { year: 'numeric', month: 'short', day: 'numeric' }) })
        : find(cfg.out, pk) ? T('Friend request sent') : T('Not friends');
    const nk = nickOf(pk);
    return `<div class="fcdmProf">${fc.ui.cardHead({ name: nk || name, banner, avatar: avatarOf(name, g, 80, st.on ? st.st : 'off'), marks: '', meta: (nk ? `<span>${E(name)}</span> · ` : '') + `<span>${E(st.sub)}</span>` })}` +
        `<div class="fcdmProfB">${warn ? `<div class="fcdmWarn">${fc.ui.icon('warn')}<span>${E(warn)}</span></div>` : ''}${prof}` +
        `<div class="fcdmRel">${fc.ui.icon(f ? 'users' : 'user')}<span>${E(rel)}</span></div>` +
        `<div class="fcdmProfA">${!f && !find(cfg.out, pk) && !isBlocked(pk) ? fc.ui.btn('Add friend', { kind: 'success', size: 'sm', icon: 'userPlus', act: 'none', attrs: 'data-dmx="add-pk"' }) : ''}` +
        (f ? fc.ui.btn(nk ? 'Edit nickname' : 'Add nickname', { kind: 'sec', size: 'sm', icon: 'edit', act: 'none', attrs: 'data-dmx="nick-pk"' }) : '') +
        fc.ui.btn('Scout card', { kind: 'sec', size: 'sm', icon: 'search', act: 'none', attrs: 'data-dmx="scout-pk"' }) + '</div></div></div>';
}

// the page's clicks that are ours -> true
function pageClick(e, viewId) {
    const lb = L();
    if (!lb) return false;
    const tab = e.target.closest('.fcdmTabs .fc-tab[data-tab]');
    if (tab) { homeTab = tab.dataset.tab; addMsg = null; if (viewId !== lb.HOME) lb.openHome(); else lb.refresh(); return true; }
    if (e.target.closest('[data-act="dm-add"]')) { openHome('add'); focusAdd(); return true; }
    const x = e.target.closest('[data-dmx]');
    const row = e.target.closest('[data-pk]');
    const pk = row && row.dataset.pk;
    if (x) {
        const what = x.dataset.dmx;
        if (what === 'friends') { if (homeTab === 'reqs' || homeTab === 'add') homeTab = 'online'; openHome(); return true; }
        if (what === 'reqs') { openHome('reqs'); return true; }
        if (what === 'add') { addMsg = null; openHome('add'); focusAdd(); return true; }
        if (what === 'hide' && pk) { e.stopPropagation(); lb.dmHide(pk); return true; }
        if (what === 'rowmore') { e.stopPropagation(); const r = x.closest('[data-dm]'); if (r) rowMenu(x, r.dataset.dm); return true; }
        if (what === 'newdm') { groupPicker(x, {}); return true; }
        if (what === 'send-req') { submitAdd(); return true; }
        if (what === 'msg' && pk) { openDm(pk); return true; }
        if (what === 'call' && pk) { const f = find(cfg.friends, pk); if (f) { lb.dmFor(pk, f.n, f.g, { show: true }); lb.call(pk); } return true; }
        if (what === 'more' && pk) { friendMenu(x, pk); return true; }
        if (what === 'accept' && pk) { accept(pk); return true; }
        if (what === 'decline' && pk) { decline(pk); return true; }
        if (what === 'cancel' && pk) { cancel(pk); return true; }
        if (what === 'block' && pk) { confirmBlock(pk); return true; }
        if (what === 'unblock' && pk) { unblock(pk); return true; }
        if (what === 'req-ok' && pk) { acceptReq(pk); openDm(pk); return true; }
        if (what === 'req-no' && pk) { ignoreReq(pk); return true; }
        if (what === 'nick-pk' && pk) { nickModal(pk); return true; }
        if (what === 'add-pk' && pk) { const d = lb.dmList().find(y => y.pk === pk); if (d) { const r = request(d.n); fc.ui.toast(r.text, { icon: 'userPlus', kind: r.ok ? '' : 'warning' }); } return true; }
        if (what === 'scout-pk' && pk) { const d = lb.dmList().find(y => y.pk === pk) || find(cfg.friends, pk); const sc = mod('scout'); if (d && sc && sc.openCard) sc.openCard(d.n, x.getBoundingClientRect(), 'beside'); return true; }
        if (what === 'star-req') { const n = e.target.closest('[data-name]'); if (n) { const r = request(n.dataset.name); fc.ui.toast(r.text, { icon: 'userPlus', kind: r.ok ? '' : 'warning' }); } return true; }
        if (what === 'scout') { const n = e.target.closest('[data-name]'); const sc = mod('scout'); if (n && sc && sc.openCard) sc.openCard(n.dataset.name, x.getBoundingClientRect(), 'beside'); return true; }
        return true;
    }
    // a DM in the list / a request: open it
    const dm = e.target.closest('[data-dm]');
    if (dm && dm.dataset.dm && (dm.classList.contains('fcdmRow') || dm.classList.contains('fcdmF'))) { lb.open(dm.dataset.dm); return true; }
    const fr = e.target.closest('.fcdmF[data-pk], .fcdmCard[data-pk]');
    if (fr && find(cfg.friends, fr.dataset.pk)) { openDm(fr.dataset.pk); return true; }
    return false;
}
// a right-click: a DM in the list, a friend in the Friends view -> true
function pageContext(e) {
    const at = { x: e.clientX, y: e.clientY };
    const r = e.target.closest('.fcdmRow[data-dm]');
    if (r) { rowMenu(at, r.dataset.dm); return true; }
    const f = e.target.closest('.fcdmF[data-pk]');
    if (f && find(cfg.friends, f.dataset.pk)) { friendMenu(at, f.dataset.pk); return true; }
    return false;
}
function pageKey(e) {
    if (!e.target.classList || !e.target.classList.contains('fcdmAddIn')) return false;
    if (e.key === 'Enter') { e.preventDefault(); submitAdd(); }
    return true;
}
function focusAdd() { setTimeout(() => { const i = document.querySelector('.fcdmAddIn'); if (i) i.focus(); }, 40); }
function submitAdd() {
    const i = document.querySelector('.fcdmAddIn');
    if (!i) return;
    const v = i.value;
    addMsg = request(v);
    refresh();
    setTimeout(() => { const j = document.querySelector('.fcdmAddIn'); if (j) { j.value = addMsg && addMsg.ok ? '' : v; j.focus(); } }, 30);
}
function confirmBlock(pk) {
    const lb = L();
    const who = find(cfg.friends, pk) || find(cfg.in, pk) || find(cfg.reqs, pk) || (lb ? lb.dmList().find(x => x.pk === pk) : null) || { n: '?' };
    fc.ui.confirm(T('Block {name}?', { name: who.n }), T('They can’t message or call you any more, and your DM with them is deleted from this PC. They aren’t told.'), { ok: T('Block'), danger: true })
        .then(ok => { if (ok) block(pk); });
}
function friendMenu(anchor, pk) {
    const f = find(cfg.friends, pk);
    if (!f) return;
    const sc = mod('scout');
    const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
    const items = [{ label: T('Message'), icon: 'chat', fn: () => openDm(pk) }, { label: T('Start a voice call'), icon: 'phone', fn: () => { const lb = L(); lb.dmFor(pk, f.n, f.g, { show: true }); lb.call(pk); } },
        { label: T('Start a video call'), icon: 'video', fn: () => { const lb = L(); lb.dmFor(pk, f.n, f.g, { show: true }); lb.call(pk, true); } }];
    if (sc && sc.openCard) items.push({ label: T('Scout card'), icon: 'search', fn: () => sc.openCard(f.n, rect, 'beside') });
    items.push({ label: nickOf(pk) ? T('Edit Friend Nickname') : T('Add Friend Nickname'), icon: 'edit', fn: () => nickModal(pk) });
    items.push('sep');
    items.push({ label: T('Remove friend'), icon: 'close', danger: true, fn: () => fc.ui.confirm(T('Remove {name}?', { name: f.n }), T('You won’t be friends on either side any more. Your DM stays.'), { ok: T('Remove friend'), danger: true }).then(ok => { if (ok) unfriend(pk); }) });
    items.push({ label: T('Block'), icon: 'ban', danger: true, fn: () => confirmBlock(pk) });
    fc.ui.menu(anchor, items, { side: anchor.getBoundingClientRect ? 'left' : 'right' });
}
// lobbies.js's DM box buttons (request bar, "add friend")
function act(what, pk) {
    if (what === 'accept') acceptReq(pk);
    else if (what === 'ignore') ignoreReq(pk);
    else if (what === 'block') confirmBlock(pk);
    else if (what === 'addfriend') { const lb = L(); const d = lb && lb.dmList().find(x => x.pk === pk); if (d) { const r = request(d.n); fc.ui.toast(r.text, { icon: 'userPlus', kind: r.ok ? '' : 'warning' }); } }
}

/* ============================================== another PC, the same Fightcord */

// this PC: show a code; the other PC types it; you say yes here; it gets your ID, friends, DMs and lobbies
function linkShow() {
    const lb = L();
    if (!lb || !lb.linkOffer) return;
    let asked = false;
    const offer = lb.linkOffer((yes) => {
        if (asked) return;
        asked = true;
        fc.ui.confirm(T('Send your Fightcord to the other PC?'), T('A PC typed your code. Only say yes if it’s yours: it gets your friends, DMs and lobbies, and can talk as you.'), { ok: T('Send it') })
            .then(ok => {
                if (!ok) { asked = false; return; }
                yes({ dms: { friends: cfg.friends, out: cfg.out, in: cfg.in, reqs: cfg.reqs, blocked: cfg.blocked, hi: cfg.hi, syncAt: cfg.syncAt, nicks: cfg.nicks, left: cfg.left } });
                const st = m.body.querySelector('.fcdmLinkSt');
                if (st) st.innerHTML = `<div class="ok">${fc.ui.icon('check')}${E(T('Sent. Your other PC uses this Fightcord now: friends, DMs and lobbies on both.'))}</div>`;
            });
    });
    if (!offer) { fc.ui.toast(T('Not connected to the relays yet. Try again in a moment.'), { kind: 'warning', icon: 'warn' }); return; }
    const m = fc.ui.modal({
        title: T('Use Fightcord on another PC'), width: 470,
        body: `<div class="fcdmLink"><p>${E(T('On the other PC: Settings → Friends & DMs → Enter a code, and type this:'))}</p>` +
            `<div class="fcdmCode">${E(offer.code)}</div>` +
            `<p class="fcdmNote">${E(T('It works while this window is open. Your friends don’t have to add you again, and both PCs keep working.'))}</p><div class="fcdmLinkSt"></div></div>`,
        actions: [{ label: T('Done'), kind: 'ghost' }],
        onClose: () => offer.close()
    });
}
// this PC: type the code from your other PC
function linkEnter() {
    const lb = L();
    if (!lb || !lb.linkAsk) return;
    const mine = cfg.friends.length + lb.dmList().length + ((lb.list && lb.list().length) || 0);
    let busy = false;
    const m = fc.ui.modal({
        title: T('Use the Fightcord from your other PC'), width: 470,
        body: `<div class="fcdmLink"><p>${E(T('On your other PC: Settings → Friends & DMs → Link a PC. Type the code it shows:'))}</p>` +
            `<input class="fc-input fcdmLinkIn" maxlength="20" placeholder="XXXX-XXXX-XXXX" spellcheck="false">` +
            (mine ? `<p class="fcdmWarn">${fc.ui.icon('warn')}<span>${E(T('This PC’s own friends, DMs and lobbies are replaced by the other PC’s.'))}</span></p>` : '') +
            `<div class="fcdmLinkSt"></div></div>`,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Link'), fn: (b) => {
            if (busy) return false;
            const st = b.querySelector('.fcdmLinkSt');
            busy = true;
            st.innerHTML = `<div>${E(T('Waiting for your other PC… say yes there.'))}</div>`;
            lb.linkAsk(b.querySelector('.fcdmLinkIn').value).then(p => {
                adoptAll(p);
                m.close();
                fc.ui.toast(T('This PC uses your Fightcord now'), { icon: 'check', sub: T('The same ID, friends, DMs and lobbies as your other PC.') });
            }, (e) => { busy = false; st.innerHTML = `<div class="bad">${fc.ui.icon('warn')}${E(e.message)}</div>`; });
            return false;
        } }]
    });
    ['keydown', 'keypress', 'keyup'].forEach(ev => m.el.addEventListener(ev, (e) => e.stopPropagation()));
    setTimeout(() => { const i = m.body.querySelector('input'); if (i) i.focus(); }, 30);
}
// the other PC's Fightcord, here
function adoptAll(p) {
    const lb = L();
    if (!lb || !lb.adopt(p)) throw new Error(T('That didn’t work. Try a new code.'));
    const d = (p.extra && p.extra.dms) || {};
    const list = (x) => (Array.isArray(x) ? x.filter(y => y && isPk(y.pk)).map(y => Object.assign({}, y, { n: cleanName(y.n) || '?', g: cleanG(y.g) })) : []);
    cfg.friends = list(d.friends); cfg.out = list(d.out); cfg.in = list(d.in); cfg.reqs = list(d.reqs); cfg.blocked = list(d.blocked);
    cfg.hi = d.hi && typeof d.hi === 'object' ? d.hi : {};
    cfg.syncAt = d.syncAt && typeof d.syncAt === 'object' ? d.syncAt : {};
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    cfg.nicks = {}; Object.keys(obj(d.nicks)).forEach(pk => { const n = isPk(pk) && cleanName(d.nicks[pk]).slice(0, 32); if (n) cfg.nicks[pk] = n; });
    cfg.left = obj(d.left);
    cfg.done = [];
    cfg.friends.forEach(f => star(f.n));
    save();
}

/* ===================================================================== the rail */

// (a muted DM or group DM still counts as unread in its row, not in the badges, like Discord)
const unreadDms = (list) => list.filter(d => d.unread && !d.req && !d.hidden && !d.muted && (d.group || (!isBlocked(d.pk) && (isFriendPk(d.pk) || cfg.from !== 'friends'))));
const railCount = (list) => cfg.in.length + cfg.reqs.length + unreadDms(list).reduce((n, d) => n + d.unread, 0);

// a chat bubble at the top of the server rail (the DM page), then unread DMs as avatars, like Discord
function railHtml() {
    const lb = L();
    if (!lb) return '';
    const shown = lb.shown();
    const list = lb.dmList();
    const onPage = shown && (shown === lb.HOME || list.some(d => d.id === shown));
    const unread = unreadDms(list);
    const badge = railCount(list);
    return `<div class="fclbIco fcdmHome${onPage ? ' on' : ''}" data-dmr="home" title="${E(T('Direct messages and friends'))}">${fc.ui.icon('chat')}` +
        (badge ? `<b class="bd">${badge > 9 ? '9+' : badge}</b>` : '') + '</div>' +
        unread.slice(0, 5).map(d => `<div class="fclbIco hasPic fcdmBub${d.id === shown ? ' on' : ''}${d.group ? ' gp' : ''} unread" data-dmr="${E(d.id)}" title="${E(d.group ? d.n : callName(d.pk, d.n))}">` +
            (d.group ? d.icon.replace(/--s:\d+px/, '--s:40px') : `<img class="pic" src="${E(fc.data.avatarUrl(d.n, d.g, 80))}" alt="">`) + `<b class="bd">${d.unread > 9 ? '9+' : d.unread}</b></div>`).join('') +
        '<div class="fclbSep"></div>';
}
function renderRail() {
    if (typeof document === 'undefined' || !cfg) return;
    const list = document.querySelector('.mainToolbar .channelsList');
    let el = document.getElementById('fcdmRail');
    if (fc.ui.taskbar) fc.ui.taskbar(cfg.enabled && cfg.desktop && L() ? railCount(L().dmList()) : 0);
    if (!cfg.enabled || !list || !L()) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'fcdmRail';
        el.className = 'fclbRail fcdmRail';
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const b = e.target.closest('[data-dmr]');
            if (!b) return;
            const lb = L();
            if (b.dataset.dmr === 'home') { const s = lb.shown(); if (s === lb.HOME || lb.dmList().some(d => d.id === s)) return; openHome(); }
            else lb.open(b.dataset.dmr);
        });
    }
    if (el.parentNode !== list || list.firstElementChild !== el) list.insertBefore(el, list.firstChild);
    const html = railHtml();
    if (el.__html !== html) { el.__html = html; el.innerHTML = html; }
}

/* ===================================================================== start */

const bootAt = Date.now();
function onPresenceId(x) {
    if (!x || !/^[0-9a-f]{32}$/.test(x.h || '') || !isPk(x.dk)) return;
    const was = cfg.seen[x.h];
    if (was && was.dk === x.dk && now() - was.at < 3600000) return;
    cfg.seen[x.h] = { dk: x.dk, at: now() };
    const keys = Object.keys(cfg.seen);
    if (keys.length > SEEN_MAX) keys.sort((a, b) => cfg.seen[a].at - cfg.seen[b].at).slice(0, keys.length - SEEN_MAX).forEach(k => delete cfg.seen[k]);
    store.save();
}

function start(f) {
    fc = f;
    store = fc.config('dms', DEFAULTS);
    cfg = store.data;
    ['friends', 'out', 'in', 'reqs', 'blocked', 'done'].forEach(k => { if (!Array.isArray(cfg[k])) cfg[k] = []; });
    ['hi', 'seen', 'syncAt', 'nicks', 'left'].forEach(k => { if (!cfg[k] || typeof cfg[k] !== 'object' || Array.isArray(cfg[k])) cfg[k] = {}; });
    fc.ui.style('fcdmStyle', CSS);
    const lb = L();
    if (lb && lb.setDms) lb.setDms(cfg.enabled);
    if (lb && lb.onInbox) lb.onInbox((m) => { if (cfg.enabled) onInboxMsg(m); });
    fc.own(() => {
        const l = L();
        if (l && l.onInbox) l.onInbox(null);
        if (l && l.setDms) l.setDms(false);
        fc.ui.style('fcdmStyle', null);
        const r = typeof document !== 'undefined' && document.getElementById('fcdmRail'); if (r) r.remove();
    });
    fc.watch(renderRail, { selector: '.mainToolbar .channelsList' });
    fc.on('lobbies:changed', renderRail);
    fc.on('presence:changed', () => { if (L() && L().shown()) refresh(); });
    fc.on('presence:id', onPresenceId);
    // you left a group DM: an old invite to it (the inbox keeps 30 days) doesn't put you back
    fc.on('group:left', (x) => { if (x && x.id) { cfg.left[x.id] = now(); store.save(); } });
    // you wrote to someone who isn't your friend: they get a message request (once)
    fc.on('dm:sent', (x) => {
        if (!x || !isPk(x.pk) || isFriendPk(x.pk) || cfg.hi[x.pk]) return;
        if (send(x.pk, 'hi')) { cfg.hi[x.pk] = now(); store.save(); }
    });
    // ★ someone with Fightcord: that's a friend request; un-★ a friend: you aren't friends any more
    fc.on('friends:added', (x) => {
        if (quietFriends || !cfg.enabled || !x || !x.name || friendNamed(x.name)) return;
        const pk = idOf(x.name);
        if (!pk || find(cfg.out, pk) || isBlocked(pk)) return;
        const r = request(x.name);
        if (r.ok) fc.ui.toast(r.text, { icon: 'userPlus', sub: T('{name} has Fightcord: once they accept, you can message and call each other.', { name: x.name }) });
    });
    fc.on('friends:removed', (x) => { if (quietFriends || !x || !x.name) return; const fr = friendNamed(x.name); if (fr) unfriend(fr.pk); });
    fc.tick(renderRail, 5000, { delay: 1200, whileHidden: true });
    fc.cmd('dms', 'Open your DMs and friends', () => openHome());
    fc.cmd('link', 'Use your Fightcord on another PC', () => linkShow());
    fc.cmd('dm', 'Send a player a direct message', (arg) => { if (arg && arg.trim()) openWith(arg.trim()); else openHome(); }, { args: 'name' });

    fc.settings.block({
        id: 'dms', section: 'members', title: 'Friends & DMs', store, order: 19,
        hint: '— friend requests, DMs and calls between Fightcord players',
        fields: [
            { key: 'enabled', type: 'switch', label: 'Friends and DMs', hint: 'The chat bubble at the top of the server list',
                onChange: (v) => { const l = L(); if (l && l.setDms) l.setDms(v); renderRail(); } },
            { key: 'from', type: 'select', label: 'Who can message you', options: [['requests', 'Friends, and message requests from others'], ['friends', 'Only friends']], show: (d) => d.enabled },
            { key: 'popups', type: 'switch', label: 'Pop-ups for DMs and requests', hint: 'Do not disturb and streamer mode keep them quiet', show: (d) => d.enabled },
            { key: 'desktop', type: 'switch', label: 'Windows notifications', hint: 'When Fightcade is behind a match or another app: a notification, the taskbar button flashes, and a red count on its icon', show: (d) => d.enabled,
                onChange: () => renderRail() },
            { key: 'sound', type: 'switch', label: 'Play a sound with them', show: (d) => d.enabled && (d.popups || d.desktop) },
            { type: 'html', show: (d) => d.enabled, html: () => `<div class="fc-note">${E(fc.fmt.plural(cfg.friends.length, 'friend'))} · ${E(fc.fmt.plural(cfg.blocked.length, 'blocked player'))}. ` +
                `${E(T('Your Fightcord ID: {id}', { id: (L() && L().myId ? L().myId() : '').slice(0, 8) || '—' }))}</div>` },
            { type: 'button', label: 'Friends and DMs', button: 'Open', act: 'open', show: (d) => d.enabled, onClick: () => { const s = mod('fightcord'); if (s && s.close) s.close(); openHome(); } },
            { type: 'button', label: 'Use Fightcord on another PC', hint: 'Shows a code for the other PC: it gets your Fightcord ID, friends, DMs and lobbies, so nobody has to add you again', button: 'Link a PC', act: 'link', show: (d) => d.enabled, onClick: () => linkShow() },
            { type: 'button', label: 'Use the Fightcord from my other PC', hint: 'Type the code your other PC shows', button: 'Enter a code', act: 'link-in', show: (d) => d.enabled, onClick: () => linkEnter() },
            { type: 'note', label: 'Requests and DMs go through the same free public relays as private lobbies, encrypted so only the two of you can read them. Accepting a request locks in that player’s Fightcord, so nobody can pose as them afterwards. Calls go straight between the two PCs.' }
        ]
    });
    renderRail();
    fc.log('ready,', cfg.friends.length, 'friends');
    return api;
}

const CSS = `
.fcdmRail { padding-bottom: 0; }
.fcdmHome .fc-ic { width: 22px; height: 22px; }
.fcdmHome:hover, .fcdmHome.on { background: var(--fc-accent); color: #fff; }
.fcdmBub .bd, .fcdmHome .bd { background: var(--fc-danger, #f23f43); color: #fff; }
.fclbDmPage .fclbSide { padding: 8px 0; }
.fcdmFind { margin: 0 10px 8px; padding: 0 8px; height: 28px; border-radius: 4px; background: var(--fc-s1); color: var(--fc-muted); font: 13px/28px var(--fc-font); cursor: pointer;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdmFind:hover { color: var(--fc-text); }
.fcdmNav { display: flex; align-items: center; height: 42px; margin: 1px 8px; padding: 0 10px; border-radius: 4px; color: var(--fc-muted); font: 500 15px/1 var(--fc-font); cursor: pointer; }
.fcdmNav:hover { background: var(--fc-hover); color: var(--fc-text); }
.fcdmNav.on { background: var(--fc-s4); color: var(--fc-head); }
.fcdmNav .fc-ic { width: 22px; height: 22px; margin-right: 12px; flex: none; }
.fcdmNav span { flex: 1; }
.fcdmNav b, .fcdmRow em { min-width: 16px; height: 16px; padding: 0 5px; box-sizing: border-box; border-radius: 8px; background: var(--fc-danger, #f23f43); color: #fff; font: 700 11px/16px var(--fc-font); font-style: normal; text-align: center; }
.fcdmCat { display: flex; align-items: center; margin: 14px 8px 4px 18px; color: var(--fc-muted); font: 600 12px/1 var(--fc-font); }
.fcdmCat span { flex: 1; }
.fcdmCat i { display: flex; padding: 2px; cursor: pointer; }
.fcdmCat i:hover { color: var(--fc-head); }
.fcdmCat .fc-ic { width: 16px; height: 16px; }
.fcdmRow { position: relative; display: flex; align-items: center; height: 42px; margin: 1px 8px; padding: 0 8px; border-radius: 4px; color: var(--fc-muted); cursor: pointer; }
.fcdmRow:hover { background: var(--fc-hover); color: var(--fc-text); }
.fcdmRow.on { background: var(--fc-s4); color: var(--fc-head); }
.fcdmRow.unread { color: var(--fc-head); }
.fcdmRow.old { opacity: .55; }
.fcdmRow .tx { flex: 1; min-width: 0; margin-left: 12px; }
.fcdmRow .tx b { display: block; font: 500 15px/1.2 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdmRow .tx small { display: block; margin-top: 1px; font: 12px/1.2 var(--fc-font); color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdmRow em { margin-left: 4px; }
.fcdmRow .x { display: none; padding: 2px; color: var(--fc-muted); }
.fcdmRow:hover .x { display: flex; }
.fcdmRow:hover em { display: none; }
.fcdmRow .x:hover { color: var(--fc-head); }
.fcdmRow .x .fc-ic { width: 16px; height: 16px; }
.fcdmNone { margin: 8px 18px; color: var(--fc-muted); font: 13px/1.4 var(--fc-font); }
.fcdmTabs { flex: 1; min-width: 0; margin-left: 12px; padding-left: 4px; border-left: 1px solid var(--fc-divider); }
.fcdmTabs .fc-tabs { border-bottom: 0; }
.fcdmTabs .fc-tab { margin: 0 0 0 12px; }
.fclbDmPage .fclbPane { padding: 8px 20px 16px 30px; }
.fcdmH { margin: 16px 0 8px; color: var(--fc-muted); font: 600 12px/1 var(--fc-font); letter-spacing: .02em; text-transform: uppercase; }
.fcdmNote { margin: 0 0 8px; color: var(--fc-muted); font: 13px/1.45 var(--fc-font); }
.fcdmF { display: flex; align-items: center; height: 62px; padding: 0 10px; margin: 0 -10px; border-top: 1px solid var(--fc-divider); border-radius: 8px; cursor: pointer; }
.fcdmF:hover { background: var(--fc-hover); border-top-color: transparent; }
.fcdmF:hover + .fcdmF { border-top-color: transparent; }
.fcdmF .tx { flex: 1; min-width: 0; margin-left: 12px; }
.fcdmF .tx b { display: flex; align-items: center; color: var(--fc-head); font: 600 15px/1.25 var(--fc-font); }
.fcdmF .tx b .w { display: flex; margin-left: 6px; color: var(--fc-warning); }
.fcdmF .tx b .w .fc-ic { width: 14px; height: 14px; }
.fcdmF .tx small { display: flex; align-items: center; margin-top: 2px; color: var(--fc-muted); font: 13px/1.3 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdmF .tx small .fc-ic { width: 13px; height: 13px; margin-right: 4px; flex: none; }
.fcdmF .tx small.ok { color: var(--fc-success); }
.fcdmF .tx small.w { color: var(--fc-warning); }
.fcdmF.newpc { height: auto; min-height: 62px; padding-top: 8px; padding-bottom: 8px; }
.fcdmF.newpc .tx small.w { white-space: normal; align-items: flex-start; }
.fcdmF.newpc .tx small.w .fc-ic { margin-top: 2px; }
.fcdmF .ac { display: flex; align-items: center; flex: none; }
.fcdmF .ac > i { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; margin-left: 8px; border-radius: 50%; background: var(--fc-s2); color: var(--fc-muted); }
.fcdmF .ac > i:hover { color: var(--fc-head); }
.fcdmF .ac > i.yes:hover { color: var(--fc-success); }
.fcdmF .ac > i.no:hover { color: var(--fc-danger, #f23f43); }
.fcdmF .ac > i .fc-ic { width: 18px; height: 18px; }
.fcdmF .ac .pend { color: var(--fc-muted); font: 12px/1 var(--fc-font); }
.fcdmF .ac .fc-btn { margin-left: 8px; }
.fcdmAdd { padding-top: 12px; }
.fcdmAdd h3 { margin: 4px 0 6px; color: var(--fc-head); font: 700 16px/1.2 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
.fcdmAdd > p { margin: 0 0 14px; color: var(--fc-muted); font: 14px/1.45 var(--fc-font); }
.fcdmAddBox { display: flex; align-items: center; padding: 0 12px 0 14px; height: 50px; border-radius: 8px; background: var(--fc-s1); box-shadow: inset 0 0 0 1px var(--fc-divider); }
.fcdmAddBox:focus-within { box-shadow: inset 0 0 0 1px var(--fc-accent); }
.fcdmAddBox.ok { box-shadow: inset 0 0 0 1px var(--fc-success); }
.fcdmAddBox.bad { box-shadow: inset 0 0 0 1px var(--fc-danger, #f23f43); }
.fcdmAddIn { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; color: var(--fc-text); font: 15px/1 var(--fc-font); }
.fcdmAddMsg { margin: 8px 2px 0; font: 13px/1.4 var(--fc-font); }
.fcdmAddMsg.ok { color: var(--fc-success); }
.fcdmAddMsg.bad { color: var(--fc-danger, #f23f43); }
.fcdmAdd .fcdmNote { margin-top: 18px; }
.fclbDmPage .fclbMem { width: 340px; padding: 0; }
.fcdmAct { padding: 16px; }
.fcdmAct h3 { margin: 0 0 14px; color: var(--fc-head); font: 800 20px/1.2 var(--fc-font); }
.fcdmQuiet { padding: 16px 8px; text-align: center; }
.fcdmQuiet b { display: block; color: var(--fc-head); font: 600 16px/1.3 var(--fc-font); }
.fcdmQuiet small { display: block; margin-top: 4px; color: var(--fc-muted); font: 13px/1.4 var(--fc-font); }
.fcdmCard { display: flex; align-items: center; padding: 12px; margin-bottom: 8px; border-radius: 8px; background: var(--fc-s2); box-shadow: inset 0 0 0 1px var(--fc-divider); cursor: pointer; }
.fcdmCard:hover { background: var(--fc-hover); }
.fcdmCard .tx { flex: 1; min-width: 0; margin-left: 10px; }
.fcdmCard .tx b { display: block; color: var(--fc-head); font: 600 14px/1.3 var(--fc-font); }
.fcdmCard .tx small { display: block; color: var(--fc-muted); font: 12px/1.3 var(--fc-font); }
.fcdmProf { min-height: 100%; background: var(--fc-s2); }
.fcdmProfB { padding: 0 16px 16px; }
.fcdmRel { display: flex; align-items: center; margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: var(--fc-s1); color: var(--fc-text); font: 13px/1.3 var(--fc-font); }
.fcdmRel .fc-ic { width: 16px; height: 16px; margin-right: 8px; color: var(--fc-muted); }
.fcdmWarn { display: flex; margin: 8px 0 4px; padding: 10px 12px; border-radius: 8px; background: rgba(240,178,50,.14); color: var(--fc-warning); font: 13px/1.4 var(--fc-font); }
.fcdmWarn .fc-ic { width: 16px; height: 16px; margin: 1px 8px 0 0; flex: none; }
.fcdmProfA { display: flex; flex-wrap: wrap; margin-top: 12px; }
.fcdmLink p { margin: 0 0 12px; color: var(--fc-text); font: 14px/1.45 var(--fc-font); }
.fcdmLink .fcdmNote { color: var(--fc-muted); font-size: 13px; }
.fcdmCode { margin: 4px 0 14px; padding: 14px; border-radius: 8px; background: var(--fc-s1); color: var(--fc-head); font: 700 26px/1 ui-monospace, Consolas, monospace; letter-spacing: .12em; text-align: center; user-select: all; }
.fcdmLinkIn { width: 100%; box-sizing: border-box; font: 600 18px/1 ui-monospace, Consolas, monospace; letter-spacing: .08em; text-transform: uppercase; }
.fcdmLink .fcdmWarn { margin-top: 12px; }
.fcdmLinkSt > div { display: flex; align-items: center; margin-top: 12px; color: var(--fc-muted); font: 13px/1.4 var(--fc-font); }
.fcdmLinkSt .ok { color: var(--fc-success); }
.fcdmLinkSt .bad { color: var(--fc-danger, #f23f43); }
.fcdmLinkSt .fc-ic { width: 16px; height: 16px; margin-right: 6px; flex: none; }
.fcdmProfA .fc-btn { margin: 0 8px 8px 0; }
/* 3.8: group DMs, pinned / muted DMs, typing, the Select Friends picker */
.fcdmRow .tx b { display: flex; align-items: center; }
.fcdmRow .tx b > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdmRow .tx b .mk { display: flex; flex: none; margin-left: 4px; color: var(--fc-muted); }
.fcdmRow .tx b .mk .fc-ic { width: 12px; height: 12px; }
.fcdmRow.muted { opacity: .6; }
.fcdmRow.muted:hover, .fcdmRow.muted.on { opacity: 1; }
.fcdmRow.typ .tx small { color: var(--fc-text); font-style: italic; }
.fcdmRow > .fclbGi { flex: none; }
.fcdmRow .x.more { margin-left: 2px; }
.fcdmBub.gp .fclbGi { width: 40px; height: 40px; border-radius: inherit; }
.fcdmBub.gp img.fclbGi { position: absolute; left: 0; top: 0; }
.fcdmPick .sub { margin: -2px 0 10px; color: var(--fc-muted); font: 12px/1.3 var(--fc-font); }
.fcdmPickQ { width: 100%; box-sizing: border-box; }
.fcdmPick .l { height: 260px; margin: 10px -6px; overflow-y: auto; }
.fcdmPick .r { display: flex; align-items: center; height: 44px; padding: 0 8px; border-radius: 6px; cursor: pointer; }
.fcdmPick .r:hover { background: var(--fc-hover); }
.fcdmPick .r .fc-avatar { margin-right: 10px; flex: none; }
.fcdmPick .r .nm { flex: 1; min-width: 0; }
.fcdmPick .r .nm b { display: block; color: var(--fc-head); font: 500 15px/1.2 var(--fc-font); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdmPick .r .nm small { display: block; color: var(--fc-muted); font: 12px/1.2 var(--fc-font); }
.fcdmPick .r .ck { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; box-shadow: inset 0 0 0 2px var(--fc-muted); color: transparent; }
.fcdmPick .r.on .ck { background: var(--fc-accent); box-shadow: none; color: #fff; }
.fcdmPick .r .ck .fc-ic { width: 14px; height: 14px; stroke-width: 3; }
.fcdmPick .none { padding: 24px 12px; color: var(--fc-muted); font: 13px/1.45 var(--fc-font); text-align: center; }
.fcdmPick .go { width: 100%; justify-content: center; }
`;

const api = {
    enabled: () => !!cfg && cfg.enabled,
    request: (name) => request(name),
    accept: (pk) => accept(pk), decline: (pk) => decline(pk), cancel: (pk) => cancel(pk),
    unfriend: (pk) => unfriend(pk), block: (pk) => block(pk), unblock: (pk) => unblock(pk),
    blocked: (pk) => !!cfg && isBlocked(pk),
    friends: () => (cfg ? cfg.friends.slice() : []),
    isFriend: (name) => !!cfg && !!friendNamed(name),
    canDm: (name) => canDm(name),
    canWrite: (pk) => !!cfg && canWrite(pk),
    openWith: (name) => openWith(name),
    openDm: (pk) => openDm(pk),
    openHome: (tab) => openHome(tab),
    warning: (pk) => (cfg ? warning(pk) : ''),
    // lobbies.js draws the DM page with these
    sideHtml: (active) => sideHtml(active), homeTopHtml: () => homeTopHtml(), homeHtml: () => homeHtml(), activeHtml: () => activeHtml(),
    profileHtml: (pk) => profileHtml(pk), pageClick: (e, id) => pageClick(e, id), pageKey: (e) => pageKey(e), act: (what, pk) => act(what, pk),
    onMessage: (pk, m) => onMessage(pk, m),
    onGroupMessage: (id, m) => onGroupMessage(id, m),
    pageContext: (e) => pageContext(e),
    // 3.8: your nicknames for friends; the names lobbies.js shows in DMs and group DMs
    nick: (pk) => nickOf(pk),
    nameFor: (pk) => { if (!cfg) return ''; const f = find(cfg.friends, pk); return nickOf(pk) || (f ? f.n : ''); },
    setNick: (pk, n) => setNick(pk, n),
    isFriendPk: (pk) => !!cfg && isFriendPk(pk),
    groupPicker: (anchor, o) => groupPicker(anchor, o),
    rowMenu: (anchor, id) => rowMenu(anchor, id),
    away: (title, body, open, who) => away(title, body, open, who || {}),
    _onInbox: (m) => onInboxMsg(m),
    linkShow: () => linkShow(), linkEnter: () => linkEnter(), _adopt: (p) => adoptAll(p),
    _tab: (t) => { homeTab = t; refresh(); },
    // the dev harness: made-up friends, requests and DMs (made-up names: no real players)
    _demo(o) {
        const p = o || {};
        const pk = (c) => c.repeat(64);
        const t = now();
        // (made-up chat, not shown text: kept out of the translations)
        cfg.friends = [{ pk: pk('a'), n: 'ParryKing', g: '', since: t - 20 * 86400000 }, { pk: pk('b'), n: 'UrienMain', g: '', since: t - 9 * 86400000 },
            { pk: pk('c'), n: 'DashKaiser', g: '', since: t - 3 * 86400000 }, { pk: pk('d'), n: 'OroSensei', g: '', since: t - 86400000 }];
        cfg.in = [{ pk: pk('e'), n: 'ChunLeaf', g: '', at: t - 40 * 60000, id: 'x1' }, { pk: pk('7'), n: 'OroSensei', g: '', at: t - 8 * 60000, id: 'x2', was: pk('d') }];
        cfg.out = [{ pk: pk('f'), n: 'TwelveTwelve', g: '', at: t - 5 * 3600000 }];
        cfg.reqs = [{ pk: pk('9'), n: 'GenieDive', g: '', at: t - 15 * 60000 }];
        cfg.blocked = [];
        const lb = L();
        cfg.nicks = p.nicks || { [pk('d')]: 'Sensei' };
        const ids = lb._demoDms(p.dms || [
            { pk: pk('a'), n: 'ParryKing', st: 'on', unread: 2, top: true, typing: p.typing ? [pk('a')] : null, msgs: [['them', 'gg last night, that game 5 was crazy', 600, 'g5', { rx: [['me', '🔥']] }], ['me', 'that parry into SA though 😭', 590],
                ['them', 'running it back tonight?', 12], ['them', 'FT10, no excuses', 11, 'ft', { ed: 'FT10, no excuses. winner picks the stage', pin: true }],
                ['me', 'you\'re on https://static.klipy.com/ii/4e7bea9f7a3371424e6c16ebc93252fe/4b/32/O9HFXrmoebzGM3.gif', 2]] },
            { group: { members: [[pk('a'), 'ParryKing'], [pk('b'), 'UrienMain'], [pk('c'), 'DashKaiser']], name: 'Friday crew', live: [[pk('a'), 'on'], [pk('b'), 'playing']] }, unread: 1,
                msgs: [[pk('b'), 'who\'s bracket is it this week', 90], [pk('c'), 'mine. same rules as last time', 80, 'rules', { pin: true }],
                    ['me', 'the stream overlay is pinned in the lobby too', 60, '', { fw: { n: 'OroSensei', at: now() - 26 * 3600000 } }], [pk('a'), 'I\'m warming up, 10 min', 5, '', { re: 'rules' }]] },
            { pk: pk('b'), n: 'UrienMain', st: 'playing', msgs: [['me', 'how do you even block the aegis loop', 200], ['them', 'you don\'t, you just pray 🙏', 190]] },
            { pk: pk('c'), n: 'DashKaiser', st: 'away', mute: -1, msgs: [['them', 'check this out https://example.com/clip', 3000]] },
            { pk: pk('d'), n: 'OroSensei', msgs: [['them', 'ty for the sets!', 4000]] },
            { pk: pk('9'), n: 'GenieDive', req: true, msgs: [['them', 'hey, saw you in the 3S channel. want some FT5s sometime?', 15]] }
        ]);
        homeTab = p.tab || 'online';
        if (p.open === 'dm') lb.open(ids[0]); else if (p.open === 'group') lb.open(ids[1]); else if (p.open !== false) openHome();
        renderRail();
        return ids;
    },
    get _config() { return cfg; }
};

module.exports = { id: 'dms', name: 'Friends & DMs', needs: ['lobbies'], start, onInbox, onSync, clash };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
