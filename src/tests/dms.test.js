// node --test tests/      friends + DMs (3.6, dms.js on lobbies.js): the keys, the requests' rules, and two or
// three players end to end over a fake relay (request, accept, DMs while offline, message requests, block, calls)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const V = require('../voice.js');
const LB_FILE = path.join(__dirname, '..', 'lobbies.js');
const DM_FILE = path.join(__dirname, '..', 'dms.js');
const L = require(LB_FILE);
L._setVoice(V);
const D = require(DM_FILE);

const pkOf = (sk) => V.pubkey(sk).toString('hex');

test('DM keys: the same seed from both sides, a different one for anyone else', () => {
    const a = crypto.randomBytes(32), b = crypto.randomBytes(32), c = crypto.randomBytes(32);
    const ab = L.dmSeed(a, pkOf(b)), ba = L.dmSeed(b, pkOf(a));
    assert.match(ab, /^[0-9a-f]{18}$/);
    assert.equal(ab, ba, 'both sides work it out alone');
    assert.notEqual(L.dmSeed(a, pkOf(c)), ab);
    assert.notEqual(L.dmSeed(c, pkOf(b)), ab, 'a third key can’t make it');
    const secret = crypto.randomBytes(32).toString('hex');
    assert.deepEqual(L.idKeyOf(secret), L.idKeyOf(secret));
    assert.notDeepEqual(L.idKeyOf(secret), L.memberKey(secret, 'some-lobby'), 'your ID isn’t one of your lobby keys');
});

test('the inbox: only its owner opens a request, and only from the key that sealed it', () => {
    const a = crypto.randomBytes(32), b = crypto.randomBytes(32), m = crypto.randomBytes(32);
    const ev = L.inboxEvent(a, pkOf(b), { t: 'fr', n: 'Alice' });
    assert.ok(V.checkEvent(ev));
    const got = L.openInbox(b, pkOf(b), ev);
    assert.equal(got.from, pkOf(a));
    assert.equal(got.b.t, 'fr');
    assert.equal(got.b.n, 'Alice');
    assert.equal(L.openInbox(m, pkOf(m), ev), null, 'someone else’s inbox');
    // Mallory takes Alice's sealed content and signs it as herself: it no longer opens
    const forged = V.makeEvent(m, ev.kind, ev.tags, ev.content);
    assert.equal(L.openInbox(b, pkOf(b), forged), null, 'not from the key that sealed it');
    // or claims to be Alice with her own seal: Bob can't open it with Alice's key
    const fake = V.makeEvent(m, ev.kind, ev.tags, V.seal(V.ecdh(m, Buffer.from(pkOf(b), 'hex')), { t: 'fr', n: 'Alice' }));
    const opened = L.openInbox(b, pkOf(b), fake);
    assert.equal(opened && opened.from, pkOf(m), 'a stranger can write, but only as themselves');
    const bad = Object.assign({}, ev, { content: ev.content.slice(0, -4) + 'AAAA' });
    assert.equal(L.openInbox(b, pkOf(b), bad), null, 'tampered');
    assert.equal(L.openInbox(b, pkOf(b), Object.assign({}, ev, { tags: [['t', 'elsewhere']] })), null);
    assert.equal(L.inboxTopic(pkOf(b)), L.inboxTopic(pkOf(b)));
    assert.notEqual(L.inboxTopic(pkOf(a)), L.inboxTopic(pkOf(b)));
});

/* ------------------------------------------------------------------ the rules */

const blank = () => ({ friends: [], out: [], in: [], reqs: [], blocked: [], done: [] });
const K = (c) => crypto.createHash('sha256').update(c).digest('hex');      // a made-up ID per letter
let nid = 0;
const msg = (from, t, at, n, extra) => ({ id: 'ev' + (nid++), from, at, b: Object.assign({ t, n: n || 'Someone' }, extra) });

test('requests: in, accepted both ways, a yes only counts for a request you sent', () => {
    const s = blank();
    let r = D.onInbox(s, msg(K('a'), 'fr', 1000, 'Alice'), {});
    assert.equal(r.what, 'request');
    assert.deepEqual(s.in.map(x => x.n), ['Alice']);
    r = D.onInbox(s, msg(K('a'), 'fr', 1500, 'Alice'), {});
    assert.equal(s.in.length, 1, 'asking again keeps one request');
    // a yes nobody asked for doesn't make friends
    r = D.onInbox(s, msg(K('z'), 'fa', 2000, 'Zed'), {});
    assert.equal(r.what, '');
    assert.equal(s.friends.length, 0);
    // your request, then their yes
    s.out.push({ pk: K('b'), n: 'Bob', at: 2500 });
    r = D.onInbox(s, msg(K('b'), 'fa', 3000, 'Not Bob'), {});
    assert.equal(r.what, 'accepted');
    assert.deepEqual(s.friends.map(f => [f.n, f.since]), [['Bob', 3000]], 'the name you asked for, not the one in the answer');
    assert.deepEqual(r.dm, [{ pk: K('b'), n: 'Bob', g: '', req: false }]);
    assert.equal(s.out.length, 0);
    // both of you asked: friends, and they get a yes
    s.out.push({ pk: K('c'), n: 'Cara', at: 3500 });
    r = D.onInbox(s, msg(K('c'), 'fr', 3600, 'Cara'), {});
    assert.equal(r.what, 'accepted');
    assert.deepEqual(r.send, [{ to: K('c'), t: 'fa' }]);
    // a friend asking again (a new PC): another yes, still one friend
    r = D.onInbox(s, msg(K('c'), 'fr', 9000, 'Cara'), {});
    assert.deepEqual(r.send, [{ to: K('c'), t: 'fa' }]);
    assert.equal(s.friends.filter(f => f.pk === K('c')).length, 1);
});

test('requests: unfriending, replays, blocked players, message requests', () => {
    const s = blank();
    s.friends.push({ pk: K('a'), n: 'Alice', since: 5000 });
    // an old "unfriend" from before you were friends again doesn't count
    let r = D.onInbox(s, msg(K('a'), 'fx', 4000), {});
    assert.equal(s.friends.length, 1);
    r = D.onInbox(s, msg(K('a'), 'fx', 6000), {});
    assert.equal(r.what, 'removed');
    assert.equal(s.friends.length, 0);
    // the same event again (every start replays the inbox): nothing
    const ev = msg(K('d'), 'fr', 7000, 'Dee');
    D.onInbox(s, ev, {});
    s.in = [];
    assert.equal(D.onInbox(s, ev, {}).what, '', 'handled once');
    assert.equal(s.in.length, 0);
    // a request taken back
    D.onInbox(s, msg(K('e'), 'fr', 7100, 'Eve'), {});
    D.onInbox(s, msg(K('e'), 'fx', 7200), {});
    assert.equal(s.in.find(x => x.pk === K('e')), undefined);
    // blocked: nothing gets through
    s.blocked.push({ pk: K('m'), n: 'Mal' });
    assert.equal(D.onInbox(s, msg(K('m'), 'fr', 8000, 'Mal'), {}).what, '');
    assert.equal(D.onInbox(s, msg(K('m'), 'hi', 8001, 'Mal'), {}).what, '');
    // a DM from someone who isn't a friend: a message request (once), unless you only take friends'
    r = D.onInbox(s, msg(K('g'), 'hi', 9000, 'Gina'), { from: 'requests', hasDm: () => false });
    assert.equal(r.what, 'msgreq');
    assert.deepEqual(r.dm, [{ pk: K('g'), n: 'Gina', g: '', req: true }]);
    assert.equal(D.onInbox(s, msg(K('g'), 'hi', 9100, 'Gina'), {}).what, '', 'already waiting');
    assert.equal(D.onInbox(s, msg(K('h'), 'hi', 9200, 'Hal'), { from: 'friends' }).what, '', 'only friends');
    assert.equal(D.onInbox(s, msg(K('i'), 'hi', 9300, 'Ivy'), { hasDm: () => true }).what, '', 'already talking');
    assert.equal(D.onInbox(s, msg(K('j'), 'fr', 9400, '   '), {}).what, '', 'a request needs a name');
});

test('names: another key using a friend’s name is caught', () => {
    const s = blank();
    s.friends.push({ pk: K('a'), n: 'ParryKing', since: 1 });
    assert.equal(D.clash(s, K('b'), 'parryking', []).pk, K('a'));
    assert.equal(D.clash(s, K('a'), 'ParryKing', []), null, 'their own key is fine');
    assert.equal(D.clash(s, K('b'), 'Someone', [{ pk: K('c'), n: 'someone' }]).pk, K('c'), 'a DM partner too');
    assert.equal(D.clash(s, K('b'), 'Nobody', []), null);
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
                if (!(ev.kind >= 20000 && ev.kind < 30000) && !stored.find(x => x.id === ev.id)) stored.push(ev);
                conns.forEach(c => c.subs.forEach((fs, id) => { if (fs.some(f => match(f, ev))) c.deliverEv(id, ev); }));
            } else if (d[0] === 'REQ') {
                const [, id, ...fs] = d;
                ws.subs.set(id, fs);
                fs.forEach(f => {
                    if (f.kinds && f.kinds.every(k => k >= 20000 && k < 30000)) return;
                    stored.filter(ev => match(f, ev)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit || 500).forEach(ev => deliver(['EVENT', id, ev]));
                });
                deliver(['EOSE', id]);
            } else if (d[0] === 'CLOSE') ws.subs.delete(d[1]);
        };
        ws.deliverEv = (id, ev) => deliver(['EVENT', id, ev]);
        ws.close = () => { ws.readyState = 3; conns.delete(ws); };
        conns.add(ws);
        setTimeout(() => { ws.readyState = 1; if (ws.onopen) ws.onopen(); }, 0);
        return ws;
    }
    return { WS, stored };
}

// who's on Fightcord (what presence.js would have heard): lower-case name -> ID
const directory = new Map();
// a Fightcord with lobbies + dms, for one player; stores: pass the old ones to start the same PC again
function client(name, relay, stores) {
    [LB_FILE, DM_FILE].forEach(f => delete require.cache[require.resolve(f)]);
    const lobbies = require(LB_FILE), dms = require(DM_FILE);
    const st = stores || {}, disposers = [], toasts = [], alerts = [], handlers = new Map();
    const mods = new Map();
    const fc = {
        config(id, defs) { return st[id] || (st[id] = { data: JSON.parse(JSON.stringify(defs)), save() {}, saveNow() {} }); },
        own: (f) => disposers.push(f),
        watch() {}, tick() {}, cmd() {},
        emit(ev, x) { (handlers.get(ev) || []).forEach(f => f(x)); },
        on(ev, f) { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(f); },
        settings: { section() {}, block() {}, refresh() {} },
        modules: { get: (id) => mods.get(id) || null },
        t: Object.assign((s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)), { plural: (n, a, b) => (n === 1 ? a : b).replace('{n}', n), locale: () => 'en-US' }),
        fmt: { esc: (s) => String(s), short: (s) => String(s), ago: () => 'now', plural: (n, w) => n + ' ' + w + (n === 1 ? '' : 's') },
        data: { hashColor: () => '#fff', avatarUrl: () => '', artUrl: () => '' },
        sound: { tone() {}, duck() {}, play() {} },
        log: Object.assign(() => {}, { warn() {} }),
        ui: { style() {}, toast: (t, o) => { toasts.push({ t, o: o || {} }); return { close() {} }; }, header: { place() {} }, dnd: () => !!fc.dndOn, attention: (t, o) => { alerts.push({ t, o: o || {} }); return true; } },
        app: {
            me: () => name, user: (n) => [n, null], userInfo: () => null, status: () => 'on', isMe: (n) => n.toLowerCase() === name.toLowerCase(),
            joinedChannels: () => [], activeChannel: () => null, activeChannelId: () => '', channel: () => null, root: () => null
        }
    };
    mods.set('presence', { info: (n) => (directory.has(n.toLowerCase()) ? { voice: false, dk: directory.get(n.toLowerCase()) } : null), hashOf: (n) => n.toLowerCase().padEnd(32, '0').slice(0, 32) });
    const realWS = global.WebSocket;
    global.WebSocket = function (url) { if (url !== 'wss://nos.lol') throw new Error('offline'); return relay.WS(url); };
    try {
        lobbies._setVoice(V);
        mods.set('lobbies', lobbies.start(fc) && lobbies);
        mods.set('dms', dms.start(fc) && dms);
    } finally { global.WebSocket = realWS; }
    directory.set(name.toLowerCase(), lobbies.myId());
    return { lobbies, dms, fc, toasts, alerts, stores: st, stop: () => disposers.forEach(f => f()), id: lobbies.myId(), dm: () => st.dms.data };
}
const settle = (ms) => new Promise(r => setTimeout(r, ms || 150));
async function until(fn, ms) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > (ms || 5000)) throw new Error('timed out'); await settle(30); } }
const said = (c, re) => c.toasts.some(x => re.test(x.t));
const roomWith = (c, pk) => c.lobbies._room(c.lobbies.dmOf(pk));

test('end to end: a friend request, accepted; DMs both ways, also while one of you is away', async () => {
    const relay = Relay();
    let alice = client('Alice', relay), bob = client('Bob', relay);
    try {
        await settle(80);
        const r = alice.dms.request('bob');
        assert.equal(r.ok, true, r.text);
        await until(() => bob.dm().in.length === 1);
        assert.equal(bob.dm().in[0].n, 'Alice');
        assert.equal(bob.dm().in[0].pk, alice.id);
        assert.ok(said(bob, /Alice sent you a friend request/));
        bob.dms.accept(alice.id);
        await until(() => alice.dm().friends.length === 1);
        assert.equal(alice.dm().friends[0].pk, bob.id);
        assert.equal(bob.dm().friends[0].pk, alice.id);
        assert.ok(said(alice, /Bob accepted your friend request/), JSON.stringify(alice.toasts.map(x => x.t)));
        // both have the DM, with the same id (the same seed)
        assert.ok(alice.lobbies.dmOf(bob.id));
        assert.equal(alice.lobbies.dmOf(bob.id), bob.lobbies.dmOf(alice.id));
        assert.ok(!alice.lobbies.list().length, 'a DM isn’t one of your lobbies');

        assert.ok(alice.lobbies.send(alice.lobbies.dmOf(bob.id), 'gg! rematch?'));
        await until(() => roomWith(bob, alice.id).visible().some(m => m.x === 'gg! rematch?'));
        await settle(600);
        assert.ok(bob.lobbies.send(bob.lobbies.dmOf(alice.id), 'FT10, now'));
        await until(() => roomWith(alice, bob.id).visible().some(m => m.x === 'FT10, now'));
        assert.equal(roomWith(bob, alice.id).visible().find(m => m.x === 'gg! rematch?').n, 'Alice');

        // Bob closes Fightcade; Alice writes; Bob comes back and finds it
        bob.stop();
        await settle(50);
        assert.ok(alice.lobbies.send(alice.lobbies.dmOf(bob.id), 'you there?'));
        await settle(100);
        bob = client('Bob', relay, bob.stores);
        await until(() => { const rm = roomWith(bob, alice.id); return rm && rm.visible().some(m => m.x === 'you there?'); });
        assert.equal(bob.dm().friends.length, 1, 'still friends after a restart');
        assert.equal(bob.dm().in.length, 0, 'the old request doesn’t come back');
        assert.ok(relay.stored.every(ev => !/rematch|FT10|you there|Alice|Bob/.test(ev.content)), 'the relay only sees ciphertext');
    } finally {
        [alice, bob].forEach(c => c.stop());
    }
});

test('end to end: a message request, someone posing in a DM, blocking, unfriending, a call ringing', async () => {
    const relay = Relay();
    const alice = client('Alice2', relay), bob = client('Bob2', relay), carol = client('Carol2', relay);
    try {
        await settle(80);
        // Carol isn't Bob's friend: her DM is a message request on his side
        carol.lobbies.dmFor(bob.id, 'Bob2', '');
        assert.ok(carol.lobbies.send(carol.lobbies.dmOf(bob.id), 'hey, FT5 sometime?'));
        await until(() => bob.dm().reqs.length === 1);
        assert.equal(bob.dm().reqs[0].n, 'Carol2');
        const req = bob.lobbies.dmList().find(d => d.pk === carol.id);
        assert.ok(req && req.req, 'a request, not in the DM list');
        await until(() => roomWith(bob, carol.id).visible().some(m => m.x === 'hey, FT5 sometime?'));
        assert.ok(!bob.toasts.some(x => /FT5 sometime/.test(x.o.sub || '')), 'a request stays quiet');
        const before = roomWith(bob, carol.id).msgs.length;
        // Bob blocks Carol: her DM goes, and her next requests don't arrive
        bob.dms.block(carol.id);
        assert.equal(bob.lobbies.dmOf(carol.id), '');
        assert.equal(bob.dm().reqs.length, 0);
        assert.ok(before >= 1);
        carol.dms.request('Bob2');
        await settle(400);
        assert.equal(bob.dm().in.length, 0, 'blocked');

        // Alice and Bob: friends, then a call, then Bob removes her
        assert.equal(alice.dms.request('bob2').ok, true);
        await until(() => bob.dm().in.length === 1);
        bob.dms.accept(alice.id);
        await until(() => alice.dm().friends.length === 1);
        alice.lobbies._call(alice.lobbies.dmOf(bob.id));
        await until(() => said(bob, /Alice2 is calling you/));
        bob.dms.unfriend(alice.id);
        await until(() => alice.dm().friends.length === 0);
        assert.equal(bob.dm().friends.length, 0);
    } finally {
        [alice, bob, carol].forEach(c => c.stop());
    }
});

test('a DM room only takes your friend’s ID, whatever key someone else has', async () => {
    const relay = Relay();
    const alice = client('Alice3', relay), bob = client('Bob3', relay);
    try {
        await settle(80);
        alice.dms.request('Bob3');
        await until(() => bob.dm().in.length === 1);
        bob.dms.accept(alice.id);
        await until(() => alice.dm().friends.length === 1);
        // Mallory somehow has the DM's key (it never leaves the two PCs) and posts with her own ID
        const mal = crypto.randomBytes(32);
        const lbId = bob.lobbies.dmOf(alice.id);
        const lb = bob.stores.lobbies.data.lobbies.find(x => x.id === lbId);
        const d = L.derive(lb.seeds[0]);
        const ev = V.makeEvent(mal, L.KIND, [['t', d.topic]], V.seal(d.key, { t: 'msg', x: 'I am Alice, trust me', n: 'Alice3', ms: Date.now() }));
        const ws = relay.WS('wss://nos.lol');
        await settle(20);
        ws.send(JSON.stringify(['EVENT', ev]));
        assert.ok(alice.lobbies.send(alice.lobbies.dmOf(bob.id), 'the real me'));
        await until(() => roomWith(bob, alice.id).visible().some(m => m.x === 'the real me'));
        await settle(200);
        assert.ok(!roomWith(bob, alice.id).visible().some(m => /trust me/.test(m.x)), 'not from your friend’s ID: ignored');
    } finally {
        [alice, bob].forEach(c => c.stop());
    }
});

/* ------------------------------------------------- the same Fightcord on two PCs */

test('your other PC’s notes: the newest change per player wins, in any order', () => {
    const me = K('me');
    const s = Object.assign(blank(), { syncAt: {} });
    const note = (op, pk, at, x) => ({ id: 'sy' + (nid++), from: me, at, b: Object.assign({ t: 'sync', op, pk, n: 'Bob', g: '' }, x) });
    let r = D.onInbox(s, note('friend', K('b'), 100), { me });
    assert.equal(r.what, 'sync');
    assert.deepEqual(s.friends.map(f => f.n), ['Bob']);
    assert.deepEqual(r.dm, [{ pk: K('b'), n: 'Bob', g: '', req: false }]);
    // an older note arriving late changes nothing
    D.onInbox(s, note('unfriend', K('b'), 50), { me });
    assert.equal(s.friends.length, 1);
    D.onInbox(s, note('unfriend', K('b'), 200), { me });
    assert.equal(s.friends.length, 0);
    // block: gone everywhere, and the DM goes
    s.in.push({ pk: K('c'), n: 'Cy', at: 1 });
    r = D.onInbox(s, note('block', K('c'), 300, { n: 'Cy' }), { me });
    assert.deepEqual(s.in, []);
    assert.deepEqual(s.blocked.map(b => b.n), ['Cy']);
    assert.deepEqual(r.drop, [K('c')]);
    // a request you sent from the other PC: its yes counts here too
    D.onInbox(s, note('out', K('d'), 400, { n: 'Dee' }), { me });
    assert.equal(D.onInbox(s, msg(K('d'), 'fa', 500, 'Dee'), { me }).what, 'accepted');
    // a friend's new PC accepted there: the old ID goes, its DM is kept but closed
    s.friends.push({ pk: K('old'), n: 'Eve', since: 1 });
    r = D.onInbox(s, note('replace', K('new'), 600, { n: 'Eve', was: K('old') }), { me });
    assert.deepEqual(s.friends.filter(f => f.n === 'Eve').map(f => f.pk), [K('new')]);
    assert.deepEqual(r.retire, [K('old')]);
    // someone else can't make notes look like yours
    assert.equal(D.onInbox(s, { id: 'fake', from: K('x'), at: 700, b: { t: 'sync', op: 'friend', pk: K('x'), n: 'X' } }, { me }).what, '');
    assert.equal(s.friends.find(f => f.pk === K('x')), undefined);
    assert.equal(L.cleanLinkCode(' abcd efgh-ijkl '), 'ABCD-EFGH-1JK1');
    assert.equal(L.cleanLinkCode('short'), '');
});

test('a friend on a new PC: their request says so, and accepting it replaces the old ID', () => {
    const s = blank();
    s.friends.push({ pk: K('a1'), n: 'Alice', since: 1 });
    const r = D.onInbox(s, msg(K('a2'), 'fr', 100, 'alice'), {});
    assert.equal(r.what, 'newpc');
    assert.deepEqual(s.in.map(x => [x.pk, x.n, x.was]), [[K('a2'), 'Alice', K('a1')]]);
    assert.equal(s.friends.length, 1, 'not friends with the new one until you accept');
});

test('a DM from a friend: a pop-up, and Windows hears too (Fightcade may be behind a match); the switch and Do not disturb quiet it', async () => {
    const relay = Relay();
    const alice = client('AliceW', relay), bob = client('BobW', relay);
    try {
        await settle(80);
        alice.dms.request('BobW');
        await until(() => bob.dm().in.length === 1);
        assert.ok(bob.alerts.some(a => /AliceW sent you a friend request/.test(a.t)), 'a request reaches Windows');
        bob.dms.accept(alice.id);
        await until(() => alice.dm().friends.length === 1);
        await settle(200);
        const room = () => roomWith(bob, alice.id);
        const sendAndWait = async (x) => { await settle(700); assert.ok(alice.lobbies.send(alice.lobbies.dmOf(bob.id), x)); await until(() => room().visible().some(m => m.x === x)); await settle(60); };
        bob.toasts.length = bob.alerts.length = 0;
        await sendAndWait('you there?');
        assert.deepEqual(bob.toasts.map(x => [x.t, x.o.sub]), [['AliceW', 'you there?']]);
        assert.deepEqual(bob.alerts.map(x => [x.t, x.o.body]), [['AliceW', 'you there?']]);
        assert.equal(typeof bob.alerts[0].o.onClick, 'function', 'clicking it opens the DM');
        // the switch off: the pop-up stays, Windows doesn't hear
        bob.dm().desktop = false;
        bob.alerts.length = 0;
        await sendAndWait('hello?');
        assert.equal(bob.alerts.length, 0);
        assert.ok(bob.toasts.some(x => x.o.sub === 'hello?'));
        // Do not disturb: nothing at all
        bob.dm().desktop = true;
        bob.fc.dndOn = true;
        bob.toasts.length = bob.alerts.length = 0;
        await sendAndWait('ok I give up');
        assert.equal(bob.toasts.length + bob.alerts.length, 0);
    } finally { alice.stop(); bob.stop(); }
});

test('end to end: link a second PC; both PCs get the DMs, see each other’s messages and follow friend changes', async () => {
    const relay = Relay();
    const pc1 = client('Lin', relay), bob = client('BobL', relay), cara = client('CaraL', relay);
    let pc2 = null;
    try {
        await settle(80);
        assert.equal(pc1.dms.request('BobL').ok, true);
        await until(() => bob.dm().in.length === 1);
        bob.dms.accept(pc1.id);
        await until(() => pc1.dm().friends.length === 1);
        assert.ok(pc1.lobbies.send(pc1.lobbies.dmOf(bob.id), 'from my first PC'));
        await settle(300);

        // the second PC: a fresh install, then the code from the first one
        pc2 = client('Lin', relay);
        assert.notEqual(pc2.id, pc1.id, 'a fresh install has its own ID');
        let asked = 0;
        const offer = pc1.lobbies.linkOffer((yes) => { asked++; yes({ dms: { friends: pc1.dm().friends, out: [], in: [], reqs: [], blocked: [], hi: {}, syncAt: pc1.dm().syncAt } }); });
        const got = await pc2.lobbies.linkAsk(offer.code.toLowerCase());
        offer.close();
        assert.equal(asked, 1, 'the first PC is asked');
        pc2.dms._adopt(got);
        directory.set('lin', pc1.id);
        assert.equal(pc2.lobbies.myId(), pc1.id, 'the same ID');
        assert.deepEqual(pc2.dm().friends.map(f => f.n), ['BobL']);
        await until(() => { const rm = roomWith(pc2, bob.id); return rm && rm.visible().some(m => m.x === 'from my first PC'); });

        // Bob writes: both PCs have it; the second PC writes: the first one sees it too
        await settle(600);
        assert.ok(bob.lobbies.send(bob.lobbies.dmOf(pc1.id), 'which PC is this'));
        await until(() => roomWith(pc1, bob.id).visible().some(m => m.x === 'which PC is this'));
        await until(() => roomWith(pc2, bob.id).visible().some(m => m.x === 'which PC is this'));
        assert.ok(pc2.lobbies.send(pc2.lobbies.dmOf(bob.id), 'the second one'));
        await until(() => roomWith(pc1, bob.id).visible().some(m => m.x === 'the second one'));
        await until(() => roomWith(bob, pc1.id).visible().some(m => m.x === 'the second one'));

        // a friend accepted on the second PC shows up on the first
        assert.equal(cara.dms.request('Lin').ok, true);
        await until(() => pc2.dm().in.length === 1 && pc1.dm().in.length === 1);
        pc2.dms.accept(cara.id);
        await until(() => pc1.dm().friends.some(f => f.pk === cara.id));
        assert.equal(pc1.dm().in.length, 0, 'the request is gone there too');
        // and a friend removed on the first PC is gone on the second
        pc1.dms.unfriend(bob.id);
        await until(() => !pc2.dm().friends.some(f => f.pk === bob.id));
        await until(() => bob.dm().friends.length === 0);
    } finally {
        [pc1, bob, cara].concat(pc2 ? [pc2] : []).forEach(c => c.stop());
    }
});

test('end to end: a friend lost their PC; their new one asks, you accept, the old DM stays but closes', async () => {
    const relay = Relay();
    const old = client('Nia', relay), bob = client('BobN', relay);
    let fresh = null;
    try {
        await settle(80);
        old.dms.request('BobN');
        await until(() => bob.dm().in.length === 1);
        bob.dms.accept(old.id);
        await until(() => old.dm().friends.length === 1);
        assert.ok(old.lobbies.send(old.lobbies.dmOf(bob.id), 'before the crash'));
        await until(() => roomWith(bob, old.id).visible().some(m => m.x === 'before the crash'));
        old.stop();

        fresh = client('Nia', relay);                    // no link code: a new ID
        assert.equal(fresh.dms.request('BobN').ok, true);
        await until(() => bob.dm().in.length === 1);
        assert.equal(bob.dm().in[0].was, old.id, 'marked as their new PC');
        assert.ok(said(bob, /Nia has a new PC/));
        bob.dms.accept(fresh.id);
        assert.deepEqual(bob.dm().friends.map(f => f.pk), [fresh.id], 'one Nia, the new one');
        const oldDm = bob.lobbies.dmList().find(d => d.pk === old.id);
        assert.ok(oldDm && oldDm.old, 'the old DM is kept, marked');
        assert.equal(bob.dms.canWrite(old.id), false, 'and closed');
        assert.ok(roomWith(bob, old.id).visible().some(m => m.x === 'before the crash'), 'still readable');
        await until(() => fresh.dm().friends.length === 1);
    } finally {
        [bob].concat(fresh ? [fresh] : []).forEach(c => c.stop());
    }
});
