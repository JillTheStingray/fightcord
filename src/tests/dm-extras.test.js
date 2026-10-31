// node --test tests/      3.8: edits and deletes, pins in DMs, forwards, group DMs (adds, names, removals),
// search, stickers, friend nicknames -- the rules, then three friends end to end over a fake relay
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const V = require('../voice.js');
const LB_FILE = path.join(__dirname, '..', 'lobbies.js');
const DM_FILE = path.join(__dirname, '..', 'dms.js');
const L = require(LB_FILE);
L._setVoice(V);
const D = require(DM_FILE);

let n = 0;
const id = () => 'e' + (n++);
const msg = (r, pk, x, at, extra) => { const i = id(); r.apply({ id: i, pk, at, b: Object.assign({ t: 'msg', x }, extra || {}) }); return i; };

/* ------------------------------------------------------------------ the rules */

test('edits: only the author’s count, the newest wins, in any order; unsigned ones don’t', () => {
    const r = L.Room({ pre: 'own' });
    // the edit arrives before its message (shuffled history)
    r.apply({ id: id(), pk: 'aa', at: 300, b: { t: 'ed', m: 'm1', x: 'gg wp (edited)' }, ok: true });
    r.apply({ id: 'm1', pk: 'aa', at: 100, b: { t: 'msg', x: 'gg wp' } });
    let m = r.visible().find(x => x.id === 'm1');
    assert.equal(m.x, 'gg wp (edited)');
    assert.equal(m.ed, 300, 'marked as edited');
    // someone else's edit, an unsigned one, an older one arriving late: nothing
    r.apply({ id: id(), pk: 'bb', at: 400, b: { t: 'ed', m: 'm1', x: 'I was hacked' }, ok: true });
    r.apply({ id: id(), pk: 'aa', at: 500, b: { t: 'ed', m: 'm1', x: 'unsigned' }, ok: false });
    assert.equal(r.apply({ id: id(), pk: 'aa', at: 200, b: { t: 'ed', m: 'm1', x: 'older' }, ok: true }), '');
    assert.equal(r.visible().find(x => x.id === 'm1').x, 'gg wp (edited)');
    assert.equal(r.apply({ id: id(), pk: 'aa', at: 600, b: { t: 'ed', m: 'm1', x: '   ' }, ok: true }), '', 'an empty edit');
    // the original stays in the room's own list (for the cache / a later delete)
    assert.equal(r.msgs.find(x => x.id === 'm1').x, 'gg wp');
});

test('deletes: the author always; a moderator over members (not the owner); nobody in a DM but the author', () => {
    const r = L.Room({ pre: 'own' });
    r.apply({ id: id(), pk: 'own1', at: 10, b: { t: 'info', name: 'FNF', mods: ['mod1'], members: [['own1', 'O'], ['mod1', 'M'], ['aa', 'A'], ['bb', 'B']] }, ok: true });
    const a = msg(r, 'aa', 'spam', 100), b = msg(r, 'bb', 'hello', 110), o = msg(r, 'own1', 'rules', 120), q = msg(r, 'bb', 'reply', 130, { re: 'x' });
    r.apply({ id: id(), pk: 'aa', at: 200, b: { t: 'del', m: a }, ok: true });
    assert.ok(!r.visible().some(x => x.id === a), 'the author deleted it');
    assert.ok(r.gone(a));
    r.apply({ id: id(), pk: 'aa', at: 210, b: { t: 'del', m: b }, ok: true });
    assert.ok(r.visible().some(x => x.id === b), 'a member can’t delete someone else’s');
    r.apply({ id: id(), pk: 'mod1', at: 220, b: { t: 'del', m: b }, ok: true });
    assert.ok(!r.visible().some(x => x.id === b), 'a moderator can');
    r.apply({ id: id(), pk: 'mod1', at: 230, b: { t: 'del', m: o }, ok: true });
    assert.ok(r.visible().some(x => x.id === o), 'not the owner’s');
    r.apply({ id: id(), pk: 'bb', at: 240, b: { t: 'del', m: q }, ok: false });
    assert.ok(r.visible().some(x => x.id === q), 'unsigned: no');
    // a pinned message that goes is unpinned
    r.apply({ id: id(), pk: 'own1', at: 250, b: { t: 'pin', m: q, on: true }, ok: true });
    assert.deepEqual(r.pinned().map(p => p.m), [q]);
    r.apply({ id: id(), pk: 'bb', at: 260, b: { t: 'del', m: q }, ok: true });
    assert.deepEqual(r.pinned(), []);
    assert.ok(!r.visible().some(x => x.sys === 'pin'), 'its "pinned a message" line goes too');

    const dm = L.Room({ flat: true });
    const d1 = msg(dm, 'aa', 'mine', 100);
    dm.apply({ id: id(), pk: 'bb', at: 110, b: { t: 'del', m: d1 }, ok: true });
    assert.ok(dm.visible().some(x => x.id === d1), 'a DM has no moderators');
});

test('pins in a DM / group DM: either of you; forwards keep who wrote it', () => {
    const r = L.Room({ flat: true });
    const m1 = msg(r, 'aa', 'FT10 tonight', 100, { fw: { n: 'ParryKing', at: 50, junk: 'x' } });
    assert.deepEqual(r.msgs.find(x => x.id === m1).fw, { n: 'ParryKing', at: 50 });
    r.apply({ id: id(), pk: 'bb', at: 120, b: { t: 'pin', m: m1, on: true }, ok: true });
    assert.deepEqual(r.pinned().map(p => p.m), [m1], 'anyone in it pins');
    assert.ok(r.canPin('bb'));
    const lobby = L.Room({ pre: 'own' });
    assert.ok(!lobby.canPin('bb'), 'a lobby: the owner and moderators only');
});

test('group DMs: adds bring members in (a key can reach them), names and icons newest-wins, removed people can’t', () => {
    const r = L.Room({ owner: 'own1', flat: true });
    r.apply({ id: id(), pk: 'own1', at: 10, b: { t: 'info', name: '', members: [['own1', 'Ann']] }, ok: true });
    assert.equal(r.apply({ id: id(), pk: 'own1', at: 20, b: { t: 'add', pk: 'bb', n: 'Ben' }, ok: true }), 'member');
    assert.ok(r.active().some(m => m.pk === 'bb' && m.n === 'Ben'), 'in before they’ve come online');
    assert.equal(r.apply({ id: id(), pk: 'own1', at: 21, b: { t: 'add', pk: 'cc', n: 'Cy' }, ok: false }), '', 'unsigned');
    assert.equal(r.apply({ id: id(), pk: 'bb', at: 22, b: { t: 'add', pk: 'bb', n: 'Me again' }, ok: true }), '', 'not yourself');
    const sys = r.visible().find(m => m.sys === 'add');
    assert.equal(sys.to, 'bb');
    r.apply({ id: id(), pk: 'bb', at: 40, b: { t: 'gset', name: 'Friday crew' }, ok: true });
    r.apply({ id: id(), pk: 'own1', at: 30, b: { t: 'gset', name: 'older name' }, ok: true });
    assert.equal(r.gset.name.v, 'Friday crew');
    r.apply({ id: id(), pk: 'own1', at: 50, b: { t: 'gset', ic: 'javascript:1' }, ok: true });
    assert.equal(r.gset.ic.v, '', 'not a picture');
    // removed (a new key without them): their name change doesn't count
    r.apply({ id: id(), pk: 'own1', at: 60, ep: 0, b: { t: 'rekey', epoch: 1, keys: {}, out: ['bb'] }, ok: true });
    r.apply({ id: id(), pk: 'bb', at: 70, b: { t: 'gset', name: 'hacked' }, ok: true });
    assert.equal(r.gset.name.v, 'Friday crew');
});

test('search: words, from:, has:', () => {
    const q = L.parseQuery('From:@Parry has:IMAGE FT10 tonight');
    assert.deepEqual(q, { words: ['ft10', 'tonight'], from: 'parry', has: 'image' });
    const who = (m) => [m.n];
    const m = (x, nm) => ({ id: id(), pk: 'a', n: nm || 'ParryKing', x });
    assert.ok(L.matches(m('ft10 TONIGHT https://x.com/a.png'), q, who));
    assert.ok(!L.matches(m('ft10 tonight'), q, who), 'no picture');
    assert.ok(!L.matches(m('ft10 tonight https://x.com/a.png', 'Urien'), q, who), 'someone else');
    assert.ok(L.matches(m('see https://klipy.com/stickers/hadouken-x'), L.parseQuery('has:sticker'), who));
    assert.ok(!L.matches(m('anything'), L.parseQuery(''), who), 'an empty search finds nothing');
    assert.ok(!L.matches({ sys: 'join', x: '' }, L.parseQuery('join'), who));
    assert.ok(L.isSticker(' https://klipy.com/stickers/weekend-happy-weekend-sticker '));
    assert.ok(!L.isSticker('look https://klipy.com/stickers/x'), 'a sticker is the whole message');
    assert.ok(!L.isSticker('https://klipy.com/gifs/x'));
});

const K = (c) => require('crypto').createHash('sha256').update(c).digest('hex');
const blank = () => ({ friends: [], out: [], in: [], reqs: [], blocked: [], done: [], left: {}, nicks: {}, syncAt: {} });
test('a group’s key in your inbox: from a friend, or your own other PC; not from strangers, not after you left', () => {
    const s = blank();
    s.friends.push({ pk: K('a'), n: 'Ann', since: 1 });
    const gi = (from, at, gid) => ({ id: id(), from, at, b: { t: 'gi', s: '11'.repeat(9), prev: [], o: from, id: gid || 'g1', nm: 'Crew' } });
    let r = D.onInbox(s, gi(K('a'), 100), { me: K('me') });
    assert.equal(r.what, 'group');
    assert.equal(r.group.by, 'Ann');
    assert.equal(D.onInbox(s, gi(K('z'), 100), { me: K('me') }).what, '', 'a stranger can’t pull you in');
    r = D.onInbox(s, gi(K('me'), 100), { me: K('me') });
    assert.equal(r.what, 'group');
    assert.ok(r.group.mine, 'made on your other PC');
    s.left.g2 = 500;
    assert.equal(D.onInbox(s, gi(K('a'), 400, 'g2'), { me: K('me') }).what, '', 'from before you left');
    assert.equal(D.onInbox(s, gi(K('a'), 600, 'g2'), { me: K('me') }).what, 'group', 'added again after');
});

test('friend nicknames sync on their own clock (a friend change and a nickname, any order)', () => {
    const s = blank();
    const me = K('me'), pk = K('b');
    const note = (op, at, extra) => ({ id: id(), from: me, at, b: Object.assign({ t: 'sync', op, pk, n: '', g: '' }, extra) });
    D.onInbox(s, note('nick', 200, { n: 'Benny' }), { me });
    D.onInbox(s, note('friend', 100, { n: 'Ben' }), { me });
    assert.equal(s.nicks[pk], 'Benny');
    assert.ok(s.friends.some(f => f.pk === pk), 'the older friend note still counts');
    D.onInbox(s, note('nick', 150, { n: 'old' }), { me });
    assert.equal(s.nicks[pk], 'Benny', 'an older nickname arriving late');
    D.onInbox(s, note('nick', 300, { n: '' }), { me });
    assert.equal(s.nicks[pk], undefined, 'taken off');
});

/* ------------------------------------------------------- end to end, fake relay */

function Relay() {
    const stored = [], conns = new Set();
    const match = (f, ev) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f['#t'] || ev.tags.some(t => t[0] === 't' && f['#t'].includes(t[1]))) && (!f.since || ev.created_at >= f.since) &&
        (!f.until || ev.created_at <= f.until) && (!f.authors || f.authors.includes(ev.pubkey));
    function WS() {
        const ws = { readyState: 0, subs: new Map() };
        const deliver = (d) => setTimeout(() => { if (ws.readyState === 1 && ws.onmessage) ws.onmessage({ data: JSON.stringify(d) }); }, 0);
        ws.send = (text) => {
            const d = JSON.parse(text);
            if (d[0] === 'EVENT') {
                const ev = d[1];
                assert.ok(V.checkEvent(ev), 'every event is properly signed');
                // NIP-09: a deletion takes its author's events out
                if (ev.kind === 5) ev.tags.filter(t => t[0] === 'e').forEach(t => { const i = stored.findIndex(x => x.id === t[1] && x.pubkey === ev.pubkey); if (i >= 0) stored.splice(i, 1); });
                if (!(ev.kind >= 20000 && ev.kind < 30000) && !stored.find(x => x.id === ev.id)) stored.push(ev);
                conns.forEach(c => c.subs.forEach((fs, sid) => { if (fs.some(f => match(f, ev))) c.deliverEv(sid, ev); }));
            } else if (d[0] === 'REQ') {
                const [, sid, ...fs] = d;
                ws.subs.set(sid, fs);
                fs.forEach(f => {
                    if (f.kinds && f.kinds.every(k => k >= 20000 && k < 30000)) return;
                    stored.filter(ev => match(f, ev)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit || 500).forEach(ev => deliver(['EVENT', sid, ev]));
                });
                deliver(['EOSE', sid]);
            } else if (d[0] === 'CLOSE') ws.subs.delete(d[1]);
        };
        ws.deliverEv = (sid, ev) => deliver(['EVENT', sid, ev]);
        ws.close = () => { ws.readyState = 3; conns.delete(ws); };
        conns.add(ws);
        setTimeout(() => { ws.readyState = 1; if (ws.onopen) ws.onopen(); }, 0);
        return ws;
    }
    return { WS, stored };
}

const directory = new Map();
function client(name, relay, stores) {
    [LB_FILE, DM_FILE].forEach(f => delete require.cache[require.resolve(f)]);
    const lobbies = require(LB_FILE), dms = require(DM_FILE);
    const st = stores || {}, disposers = [], toasts = [], handlers = new Map();
    const mods = new Map();
    const fc = {
        config(cid, defs) { return st[cid] || (st[cid] = { data: JSON.parse(JSON.stringify(defs)), save() {}, saveNow() {} }); },
        own: (f) => disposers.push(f),
        watch() {}, tick() {}, cmd() {},
        emit(ev, x) { (handlers.get(ev) || []).forEach(f => f(x)); },
        on(ev, f) { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(f); },
        settings: { section() {}, block() {}, refresh() {} },
        modules: { get: (mid) => mods.get(mid) || null },
        t: Object.assign((s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)), { plural: (k, a, b) => (k === 1 ? a : b).replace('{n}', k), locale: () => 'en-US' }),
        fmt: { esc: (s) => String(s), short: (s) => String(s), ago: () => 'now', plural: (k, w) => k + ' ' + w + (k === 1 ? '' : 's') },
        data: { hashColor: () => '#fff', avatarUrl: () => '', artUrl: () => '' },
        sound: { tone() {}, duck() {}, play() {} },
        log: Object.assign(() => {}, { warn() {} }),
        ui: { style() {}, toast: (t, o) => { toasts.push({ t, o: o || {} }); return { close() {} }; }, header: { place() {} }, dnd: () => false, attention: () => true, icon: () => '', copy: () => true },
        app: {
            me: () => name, user: (x) => [x, null], userInfo: () => null, status: () => 'on', isMe: (x) => x.toLowerCase() === name.toLowerCase(),
            joinedChannels: () => [], activeChannel: () => null, activeChannelId: () => '', channel: () => null, root: () => null
        }
    };
    mods.set('presence', { info: (x) => (directory.has(x.toLowerCase()) ? { voice: false, dk: directory.get(x.toLowerCase()) } : null), hashOf: (x) => x.toLowerCase().padEnd(32, '0').slice(0, 32) });
    const realWS = global.WebSocket;
    global.WebSocket = function (url) { if (url !== 'wss://nos.lol') throw new Error('offline'); return relay.WS(url); };
    try {
        lobbies._setVoice(V);
        mods.set('lobbies', lobbies.start(fc) && lobbies);
        mods.set('dms', dms.start(fc) && dms);
    } finally { global.WebSocket = realWS; }
    directory.set(name.toLowerCase(), lobbies.myId());
    return { lobbies, dms, fc, toasts, stores: st, stop: () => disposers.forEach(f => f()), id: lobbies.myId(), dm: () => st.dms.data };
}
const settle = (ms) => new Promise(r => setTimeout(r, ms || 150));
async function until(fn, ms) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > (ms || 6000)) throw new Error('timed out'); await settle(30); } }
const said = (c, re) => c.toasts.some(x => re.test(x.t));
async function befriend(a, b) {
    assert.equal(a.dms.request(b.fc.app.me()).ok, true);
    await until(() => b.dm().in.some(x => x.pk === a.id));
    b.dms.accept(a.id);
    await until(() => a.dm().friends.some(f => f.pk === b.id));
}
const groupOf = (c) => c.lobbies.dmList().find(d => d.group);
const roomOf = (c, gid) => c.lobbies._room(gid);
const sees = (c, gid, x) => { const r = roomOf(c, gid); return !!r && r.visible().some(m => m.x === x); };

test('end to end: a group DM of three friends; edits, deletes, a name, a removal (the removed one reads nothing new)', async () => {
    const relay = Relay();
    const ann = client('Ann8', relay), ben = client('Ben8', relay), cy = client('Cy8', relay);
    try {
        await settle(80);
        await befriend(ann, ben);
        await befriend(ann, cy);
        const gid = ann.lobbies.createGroup([{ pk: ben.id, n: 'Ben8' }, { pk: cy.id, n: 'Cy8' }]);
        assert.ok(gid);
        await until(() => groupOf(ben) && groupOf(cy));
        assert.equal(groupOf(ben).id, gid, 'the same group');
        assert.ok(said(ben, /Ann8 added you to a group/), JSON.stringify(ben.toasts.map(x => x.t)));
        // Ben and Cy aren't friends with each other: still in the same group
        assert.equal(roomOf(ann, gid).active().length, 3);

        assert.ok(ann.lobbies.send(gid, 'FT5s at 9?'));
        await until(() => sees(ben, gid, 'FT5s at 9?') && sees(cy, gid, 'FT5s at 9?'));
        assert.ok(ben.lobbies.send(gid, 'im in, bring the urien'));
        await until(() => sees(cy, gid, 'im in, bring the urien'));
        const mid = roomOf(ben, gid).visible().find(m => m.x === 'im in, bring the urien').id;
        // an edit, then a delete, by the author; Ann can't delete Ben's message (a group has no moderators)
        assert.ok(ben.lobbies.edit(gid, mid, 'im in, bring the URIEN'));
        await until(() => sees(cy, gid, 'im in, bring the URIEN'));
        assert.ok(roomOf(cy, gid).visible().find(m => m.id === mid).ed, 'shown as edited');
        assert.equal(ann.lobbies.del(gid, mid), false, 'not hers to delete');
        assert.ok(ben.lobbies.del(gid, mid));
        await until(() => !roomOf(cy, gid).visible().some(m => m.id === mid) && !roomOf(ann, gid).visible().some(m => m.id === mid));
        assert.ok(!relay.stored.some(ev => ev.id === mid), 'the relay was asked to drop it (NIP-09)');
        assert.ok(!(ben.stores['lobbies-cache'].data[gid] || []).some(x => x.id === mid), 'and it left Ben’s PC');

        // anyone names it
        assert.ok(cy.lobbies.rename(gid, 'Friday crew'));
        await until(() => ann.lobbies.groupName(gid) === 'Friday crew' && ben.lobbies.groupName(gid) === 'Friday crew');

        // Ann made it: she removes Cy. Ben gets the new key, Cy doesn't
        assert.ok(ann.lobbies.kick(gid, cy.id));
        await until(() => cy.stores.lobbies.data.lobbies.find(l => l.id === gid).removed);
        await until(() => ben.stores.lobbies.data.lobbies.find(l => l.id === gid).epoch === 1);
        assert.ok(ann.lobbies.send(gid, 'just us now'));
        await until(() => sees(ben, gid, 'just us now'));
        await settle(300);
        assert.ok(!sees(cy, gid, 'just us now'), 'the removed one reads nothing new');
        assert.ok(relay.stored.every(ev => !/FT5s|urien|Friday crew|just us/i.test(ev.content)), 'the relay only sees ciphertext');
    } finally {
        [ann, ben, cy].forEach(c => c.stop());
    }
});

test('end to end: typing reaches the other side live, and nobody can add a stranger’s key through a friend', async () => {
    const relay = Relay();
    const ann = client('Ann9', relay), ben = client('Ben9', relay), eve = client('Eve9', relay);
    try {
        await settle(80);
        await befriend(ann, ben);
        const dmA = ann.lobbies.dmOf(ben.id);
        await until(() => ben.lobbies.dmOf(ann.id));
        // a live "typing" (lobbies.js sends it from the box; here straight from the room)
        const relayLive = () => relay.stored.length;
        assert.ok(relayLive() >= 0);
        ann.lobbies._typingSend(dmA);
        await until(() => ben.lobbies.dmList().find(d => d.pk === ann.id).typing === 1);
        // Eve isn't Ben's friend: her group's key doesn't pull him in
        await befriend(eve, ann);
        const g = eve.lobbies.createGroup([{ pk: ann.id, n: 'Ann9' }, { pk: ben.id, n: 'Ben9' }]);
        assert.ok(g);
        await until(() => groupOf(ann));
        await settle(400);
        assert.ok(!groupOf(ben), 'not a friend of Eve: not added');
    } finally {
        [ann, ben, eve].forEach(c => c.stop());
    }
});
