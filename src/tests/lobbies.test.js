// node --test tests/      private lobbies (lobbies.js): invite codes, keys, the room's rules, and
// whole lobbies end to end (create, join with a code, chat, remove someone) over a fake relay
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const V = require('../voice.js');
const LB_FILE = path.join(__dirname, '..', 'lobbies.js');
const L = require(LB_FILE);
L._setVoice(V);

test('invite codes: round trip, typo-tolerant, typos caught', () => {
    const seed = crypto.randomBytes(9).toString('hex');
    const pk = V.pubkey(crypto.randomBytes(32)).toString('hex');
    const code = L.encodeCode(seed, pk);
    assert.match(code, /^FC-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$/);
    assert.deepEqual(L.decodeCode(code), { seed, pre: pk.slice(0, 10) });
    assert.deepEqual(L.decodeCode(' ' + code.toLowerCase().replace(/-/g, ' ') + ' '), { seed, pre: pk.slice(0, 10) }, 'case / spaces');
    assert.deepEqual(L.decodeCode(code.slice(3)), { seed, pre: pk.slice(0, 10) }, 'without FC-');
    const bad = code.slice(0, 5) + (code[5] === '7' ? '8' : '7') + code.slice(6);
    assert.equal(L.decodeCode(bad), null, 'one wrong character');
    assert.equal(L.decodeCode('hello'), null);
    assert.deepEqual([...L.unb32(L.b32(Buffer.from([1, 2, 250, 9, 0])))], [1, 2, 250, 9, 0]);
});

test('keys: a topic and key per seed, a signing key per lobby, new seeds for one member only', () => {
    const a = L.derive('00112233445566778899'.slice(0, 18)), b = L.derive('ffeeddccbbaa998877'.slice(0, 18));
    assert.match(a.topic, /^[0-9a-f]{32}$/);
    assert.notEqual(a.topic, b.topic);
    assert.equal(a.key.length, 32);
    const secret = crypto.randomBytes(32).toString('hex');
    assert.deepEqual(L.memberKey(secret, 'lobby1'), L.memberKey(secret, 'lobby1'));
    assert.notDeepEqual(L.memberKey(secret, 'lobby1'), L.memberKey(secret, 'lobby2'), 'lobbies can’t be linked by key');
    const owner = crypto.randomBytes(32), member = crypto.randomBytes(32), other = crypto.randomBytes(32);
    const seed = crypto.randomBytes(9).toString('hex');
    const blob = L.wrapSeed(owner, V.pubkey(member).toString('hex'), seed);
    assert.equal(L.unwrapSeed(member, V.pubkey(owner).toString('hex'), blob), seed);
    assert.equal(L.unwrapSeed(other, V.pubkey(owner).toString('hex'), blob), null, 'someone else can’t open it');
});

test('the room: only the owner’s signed info counts, joins, messages, leaving', () => {
    const r = L.Room({ pre: 'aaaa' });
    assert.equal(r.apply({ id: '1', pk: 'bbbb11', at: 10, b: { t: 'info', name: 'Fake' }, ok: true }), '', 'not the owner');
    assert.equal(r.apply({ id: '2', pk: 'aaaa11', at: 10, b: { t: 'info', name: 'Real' }, ok: false }), '', 'unsigned');
    assert.equal(r.apply({ id: '3', pk: 'aaaa11', at: 10, b: { t: 'info', name: 'Real', members: [['aaaa11', 'Owner', '']] }, ok: true }), 'info');
    assert.equal(r.info.name, 'Real');
    assert.equal(r.owner, 'aaaa11');
    assert.equal(r.apply({ id: '4', pk: 'cc', at: 20, b: { t: 'join', n: 'Carol' } }), 'member');
    assert.equal(r.apply({ id: '4', pk: 'cc', at: 20, b: { t: 'join', n: 'Carol' } }), '', 'the same event twice');
    assert.equal(r.apply({ id: '5', pk: 'cc', at: 30, b: { t: 'msg', x: 'hello', n: 'Carol' } }), 'msg');
    assert.equal(r.apply({ id: '6', pk: 'dd', at: 25, b: { t: 'msg', x: 'early', n: 'Dan' } }), 'msg', 'a message is enough to be a member');
    assert.deepEqual(r.msgs.filter(m => !m.sys).map(m => m.x), ['early', 'hello'], 'in time order whatever the arrival');
    assert.equal(r.apply({ id: '7', pk: 'dd', at: 40, b: { t: 'msg', x: '   ' } }), '', 'empty');
    assert.equal(r.active().length, 3);
    r.apply({ id: '8', pk: 'cc', at: 50, b: { t: 'leave' } });
    assert.deepEqual(r.active().map(m => m.n).sort(), ['Dan', 'Owner']);
    r.apply({ id: '9', pk: 'cc', at: 60, b: { t: 'join', n: 'Carol' } });
    assert.equal(r.active().length, 3, 'back again');
});

test('the room: a removed member stays out (even if old history arrives later), their key stops counting', () => {
    const r = L.Room({ owner: 'own' });
    r.apply({ id: 'i0', pk: 'own', at: 1, ep: 0, b: { t: 'info', name: 'X', members: [['own', 'Owner'], ['bad', 'Mallory']] }, ok: true });
    r.apply({ id: 'm1', pk: 'bad', at: 5, ep: 0, b: { t: 'msg', x: 'before', n: 'Mallory' } });
    r.apply({ id: 'rk', pk: 'own', at: 10, ep: 0, b: { t: 'rekey', epoch: 1, keys: {}, out: ['bad'] }, ok: true });
    assert.ok(!r.active().find(m => m.pk === 'bad'));
    assert.ok(r.msgs.find(m => m.sys === 'out' && m.n === 'Mallory'));
    // with the old key, after being removed
    r.apply({ id: 'm2', pk: 'bad', at: 200000, ep: 0, b: { t: 'msg', x: 'after', n: 'Mallory' } });
    r.apply({ id: 'j2', pk: 'bad', at: 200001, ep: 0, b: { t: 'join', n: 'Mallory' } });
    assert.ok(!r.active().find(m => m.pk === 'bad'), 'the old key can’t rejoin');
    assert.deepEqual(r.visible().filter(m => !m.sys).map(m => m.x), ['before'], 'what the old key says later is hidden');
    // the old info again (shuffled history) doesn't bring them back
    r.apply({ id: 'i0b', pk: 'own', at: 2, ep: 0, b: { t: 'info', name: 'X', members: [['bad', 'Mallory']] }, ok: true });
    assert.ok(!r.active().find(m => m.pk === 'bad'));
    // invited back with a new code: joins in the new epoch
    r.apply({ id: 'j3', pk: 'bad', at: 300000, ep: 1, b: { t: 'join', n: 'Mallory' } });
    assert.ok(r.active().find(m => m.pk === 'bad'));
    // a rekey must be the owner's, signed
    assert.equal(r.apply({ id: 'rk2', pk: 'bad', at: 11, ep: 1, b: { t: 'rekey', epoch: 2, out: ['own'] }, ok: true }), '');
});

test('the room: a name used by two keys is flagged on the newer one', () => {
    const r = L.Room({ owner: 'o' });
    r.apply({ id: 'a', pk: 'k1', at: 10, b: { t: 'join', n: 'Daigo' } });
    r.apply({ id: 'b', pk: 'k2', at: 20, b: { t: 'join', n: 'daigo' } });
    assert.deepEqual([...r.dupes()], ['k2']);
});

test('mentions and message groups', () => {
    assert.equal(L.mentions('gg @ParryKing!', 'parryking'), true);
    assert.equal(L.mentions('gg ParryKing', 'ParryKing'), false, 'only with @');
    assert.equal(L.mentions('@ParryKing2 hi', 'ParryKing'), false, 'a longer name');
    assert.equal(L.mentions('mail@ParryKing', 'ParryKing'), false);
    assert.equal(L.mentions('hi @a.b', 'a.b'), true, 'regex characters in names');
    const t = Date.parse('2026-10-17T20:00:00');
    const g = L.groups([
        { id: 1, pk: 'a', at: t, x: '1' }, { id: 2, pk: 'a', at: t + 60000, x: '2' },
        { id: 3, pk: 'b', at: t + 70000, x: '3' }, { id: 4, pk: 'a', at: t + 80000, x: '4' },
        { id: 5, pk: 'a', at: t + 80000 + 8 * 60000, x: '5' },
        { id: 6, sys: 'join', pk: 'c', at: t + 81000 + 8 * 60000 }, { id: 7, pk: 'a', at: t + 82000 + 8 * 60000, x: '7' }
    ]);
    assert.deepEqual(g.map(x => x.items.length), [2, 1, 1, 1, 1, 1]);
    assert.equal(g[4].sys, 'join');
});

/* ------------------------------------------------------- end to end, fake relay */

// one in-memory relay: keeps regular events, forwards everything to matching subscriptions
function Relay() {
    const stored = [], conns = new Set();
    const match = (f, ev) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f['#t'] || ev.tags.some(t => t[0] === 't' && f['#t'].includes(t[1]))) && (!f.since || ev.created_at >= f.since);
    function WS() {
        const ws = { readyState: 0, subs: new Map(), sent: 0 };
        const deliver = (d) => setTimeout(() => { if (ws.readyState === 1 && ws.onmessage) ws.onmessage({ data: JSON.stringify(d) }); }, 0);
        ws.send = (text) => {
            const d = JSON.parse(text);
            if (d[0] === 'EVENT') {
                const ev = d[1];
                assert.ok(V.checkEvent(ev), 'every event is properly signed');
                if (!(ev.kind >= 20000 && ev.kind < 30000) && !stored.find(x => x.id === ev.id)) stored.push(ev);
                deliver(['OK', ev.id, true, '']);
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

// a Fightcord with just what lobbies.js uses, for one player
function client(name, relay) {
    delete require.cache[require.resolve(LB_FILE)];
    const mod = require(LB_FILE);
    const stores = {}, disposers = [], toasts = [];
    const fc = {
        config(id, defs) { return stores[id] || (stores[id] = { data: JSON.parse(JSON.stringify(defs)), save() {}, saveNow() {} }); },
        own: (f) => disposers.push(f),
        watch() {}, emit() {}, on() {},
        settings: { section() {}, block() {}, refresh() {} },
        modules: { get: () => null },
        t: Object.assign((s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)), { plural: (n, a, b) => (n === 1 ? a : b).replace('{n}', n), locale: () => 'en-US' }),
        fmt: { esc: (s) => String(s), short: (s) => String(s) },
        data: { hashColor: () => '#fff', avatarUrl: () => '', artUrl: () => '' },
        sound: { tone() {}, duck() {} },
        log: Object.assign(() => {}, { warn() {} }),
        ui: { style() {}, toast: (t, o) => { toasts.push(t + (o && o.sub ? ' / ' + o.sub : '')); return { close() {} }; }, header: { place() {} } },
        app: {
            me: () => name, user: (n) => [n, null], status: () => 'on', isMe: (n) => n === name,
            joinedChannels: () => [], activeChannel: () => null, activeChannelId: () => '', channel: () => null, root: () => null
        }
    };
    const realWS = global.WebSocket;
    global.WebSocket = function (url) { if (url !== 'wss://nos.lol') throw new Error('offline'); return relay.WS(url); };
    try { mod.start(fc); } finally { global.WebSocket = realWS; }
    return { mod, fc, toasts, stop: () => disposers.forEach(f => f()), cfg: stores.lobbies.data };
}
const settle = (ms) => new Promise(r => setTimeout(r, ms || 150));
async function until(fn, ms) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > (ms || 5000)) throw new Error('timed out'); await settle(30); } }

test('end to end: create, invite, chat, remove someone, old code refused, new code works', async () => {
    const relay = Relay();
    const alice = client('Alice', relay), bob = client('Bob', relay), carol = client('Carol', relay), dave = client('Dave', relay);
    try {
        await settle(50);
        const lb = alice.mod.create('Friday Fights', 'SF3 channel', 'sfiii3nr1');
        assert.ok(lb && lb.id);
        const code = alice.mod.code(lb.id);
        assert.match(code, /^FC-/);

        const found = await bob.mod.lookup(code);
        assert.equal(found.err, undefined, String(found.err));
        assert.equal(found.info.name, 'Friday Fights');
        assert.equal(found.info.ch, 'SF3 channel');
        assert.ok(bob.mod.join(found));
        assert.ok(carol.mod.join(await carol.mod.lookup(code)));
        await settle();

        assert.ok(alice.mod.send(lb.id, 'hey @Bob, FT5?'));
        await settle(600);
        assert.ok(bob.mod.send(lb.id, 'sure'));
        await until(() => alice.mod._room(lb.id).visible().some(m => m.x === 'sure'));
        const br = bob.mod._room(lb.id);
        await until(() => br.visible().some(m => m.x === 'hey @Bob, FT5?'));
        assert.deepEqual(alice.mod._room(lb.id).active().map(m => m.n).sort(), ['Alice', 'Bob', 'Carol']);

        // Alice removes Carol: Bob gets a new key, Carol finds out
        const carolPk = [...alice.mod._room(lb.id).members.values()].find(m => m.n === 'Carol').pk;
        assert.ok(alice.mod.kick(lb.id, carolPk));
        await until(() => bob.cfg.lobbies[0].epoch === 1);
        await until(() => carol.cfg.lobbies[0].removed === true);
        assert.ok(carol.toasts.some(t => /removed/.test(t)));
        await settle(600);
        assert.ok(alice.mod.send(lb.id, 'just us now'));
        await until(() => br.visible().some(m => m.x === 'just us now'));
        await settle(300);
        assert.ok(!carol.mod._room(lb.id).visible().some(m => m.x === 'just us now'), 'Carol can’t read new messages');
        assert.ok(!carol.mod.send(lb.id, 'let me back'), 'and can’t write');
        assert.ok(!alice.mod._room(lb.id).active().find(m => m.n === 'Carol'));

        // the old code is dead, the new one works (with the history from before)
        const old = await dave.mod.lookup(code);
        assert.match(String(old.err), /replaced/);
        const code2 = alice.mod.code(lb.id);
        assert.notEqual(code2, code);
        const f2 = await dave.mod.lookup(code2);
        assert.equal(f2.err, undefined, String(f2.err));
        assert.ok(dave.mod.join(f2));
        assert.equal(dave.cfg.lobbies[0].seeds.length, 2, 'got the older key too');
        dave.mod.open && dave.mod._loadOld(lb.id);
        await until(() => dave.mod._room(lb.id).visible().some(m => m.x === 'sure'), 4000);
        await until(() => dave.mod._room(lb.id).visible().some(m => m.x === 'just us now'), 4000);
        assert.equal(relay.stored.every(ev => !/Friday|sure|Bob/.test(ev.content)), true, 'the relay only sees ciphertext');
    } finally {
        [alice, bob, carol, dave].forEach(c => c.stop());
    }
});

test('the voice room: everyone gets one line to everyone else (fake WebRTC)', async () => {
    const relay = Relay();
    const pcs = [];
    class FakePc {
        constructor() { this.connectionState = 'new'; this.localDescription = null; this.remote = null; pcs.push(this); }
        addTrack() {}
        async createOffer() { return { type: 'offer', sdp: 'offer-' + pcs.indexOf(this) }; }
        async createAnswer() { return { type: 'answer', sdp: 'answer-' + pcs.indexOf(this) }; }
        async setLocalDescription(d) { this.localDescription = d; this.check(); }
        async setRemoteDescription(d) { this.remote = d; this.check(); }
        check() { if (this.localDescription && this.remote && this.connectionState !== 'connected') { this.connectionState = 'connected'; if (this.onconnectionstatechange) this.onconnectionstatechange(); } }
        close() { this.connectionState = 'closed'; }
    }
    const track = { enabled: true, stop() {} };
    const fakeRtc = { getMic: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }), meter: () => Object.assign(() => 0, { stop() {} }),
        gathered: async (pc) => pc.localDescription, gate: V.gate, ICE: [], settings: () => ({}), hotkey() {} };
    const realRtc = V.rtc;
    V.rtc = fakeRtc;
    global.RTCPeerConnection = FakePc;
    const people = ['Ann', 'Ben', 'Cid'].map(n => client(n, relay));
    try {
        await settle(50);
        const [a, b, c] = people;
        const lb = a.mod.create('Voice test', 'SF3', 'sfiii3nr1');
        const code = a.mod.code(lb.id);
        b.mod.join(await b.mod.lookup(code));
        c.mod.join(await c.mod.lookup(code));
        await settle(300);
        for (const p of people) { await p.mod.joinVoice(lb.id); await settle(200); }
        await until(() => people.every(p => p.mod._voicePeers().length === 2 && p.mod._voicePeers().every(x => x.state === "connected")), 8000).catch(e => { people.forEach(p => console.log(p.fc.app.me(), p.mod.inVoice().slice(0,4), p.toasts.join("; "), p.mod._me(lb.id).slice(0, 6), JSON.stringify(p.mod._voicePeers().map(x => [x.pk.slice(0, 6), x.state])))); throw e; });
        const pkOf = (p) => p.mod._me(lb.id);
        people.forEach(p => assert.deepEqual(p.mod._voicePeers().map(x => x.pk).sort(), people.filter(q => q !== p).map(pkOf).sort()));
        assert.equal(pcs.filter(pc => pc.connectionState === 'connected').length, 6, 'three pairs, a connection on each side');
        b.mod.leaveVoice();
        await until(() => a.mod._voicePeers().length === 1 && c.mod._voicePeers().length === 1, 4000);
    } finally {
        people.forEach(p => { p.mod.leaveVoice(); p.stop(); });
        V.rtc = realRtc;
        delete global.RTCPeerConnection;
    }
});
