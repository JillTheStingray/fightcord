'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const M = require('../matchmaking.js');
const V = require('../voice.js');

const H = (c) => c.repeat(32);                     // a 32-char hex hash
const user = (o) => Object.assign({ name: 'Them', channels: ['sfiii3nr1'], channelRank: { 'SF3': 4 }, ping: 60, settings: { ranked: true } }, o);
const meAt = (o) => Object.assign({ ch: 'sfiii3nr1', chName: 'SF3', mode: 'casual', ft: 0, myRank: 4, chRanked: true, meRanked: true }, o);

test('who fits: mode, FT, rank range, ping, ranked setting, busy, filters', () => {
    const q = { ch: 'sfiii3nr1', mode: 'casual', ft: 0 };
    assert.equal(M.compatible(meAt(), q, user()), true);
    assert.equal(M.compatible(meAt(), Object.assign({}, q, { ch: 'kof98' }), user()), false, 'another game');
    assert.equal(M.compatible(meAt(), Object.assign({}, q, { mode: 'ranked', ft: 3 }), user()), false, 'another mode');
    // ranked: the same FT, ranked on for both, a ranked channel
    const rq = { ch: 'sfiii3nr1', mode: 'ranked', ft: 3 };
    assert.equal(M.compatible(meAt({ mode: 'ranked', ft: 3 }), rq, user()), true);
    assert.equal(M.compatible(meAt({ mode: 'ranked', ft: 5 }), rq, user()), false, 'another FT');
    assert.equal(M.compatible(meAt({ mode: 'ranked', ft: 3 }), rq, user({ settings: { ranked: false } })), false, 'their ranked setting is off');
    assert.equal(M.compatible(meAt({ mode: 'ranked', ft: 3, chRanked: false }), rq, user()), false, 'not a ranked channel');
    assert.equal(M.compatible(meAt({ mode: 'ranked', ft: 3, meRanked: false }), rq, user()), false, 'your ranked setting is off');
    // the channel, busy, away
    assert.equal(M.compatible(meAt(), q, user({ channels: ['kof98'] })), false, 'not in the channel');
    assert.equal(M.compatible(meAt(), q, user({ playing: { quarkId: 'x' } })), false, 'in a match');
    assert.equal(M.compatible(meAt(), q, user({ away: true })), false, 'away');
    // Find a match's rank range and ping
    assert.equal(M.compatible(meAt(), q, user({ channelRank: { SF3: 6 } }), { window: 1 }), false, 'two ranks up');
    assert.equal(M.compatible(meAt(), q, user({ channelRank: { SF3: 5 } }), { window: 1 }), true);
    assert.equal(M.compatible(meAt(), q, user({ channelRank: { SF3: 6 } }), { window: null }), true, 'any rank');
    assert.equal(M.compatible(meAt(), q, user({ ping: 180 }), { maxPing: 120 }), false, 'ping too high');
    assert.equal(M.compatible(meAt(), q, user({ ping: 0 }), { maxPing: 120 }), true, 'ping unknown is fine');
    assert.equal(M.compatible(meAt(), q, user(), { skip: (n) => n === 'Them' }), false, 'your filters would decline them');
});

test('only the lower hash asks', () => {
    assert.equal(M.asks(H('a'), H('b')), true);
    assert.equal(M.asks(H('b'), H('a')), false);
});

test('messages: clean, fresh, and signed by the ID that sent them', () => {
    const now = 1793900000000;
    const sk = crypto.randomBytes(32), dk = V.pubkey(sk).toString('hex');
    const base = { t: 'q', h: H('a'), ch: 'sfiii3nr1', mode: 'ranked', ft: 3, ts: now, dk };
    const dig = (m) => crypto.createHash('sha256').update(M.signText(m)).digest();
    const msg = Object.assign({ sig: V.sign(dig(base), sk, crypto.randomBytes(32)).toString('hex') }, base);
    const c = M.cleanMsg(msg, now);
    assert.equal(c.ft, 3);
    assert.ok(V.verify(dig(c), Buffer.from(c.dk, 'hex'), Buffer.from(c.sig, 'hex')), 'a real signature checks out');
    // someone changing a field breaks it
    const forged = Object.assign({}, c, { ft: 10 });
    assert.equal(V.verify(dig(forged), Buffer.from(c.dk, 'hex'), Buffer.from(c.sig, 'hex')), false, 'a changed FT doesn’t');
    // another key can't sign as that ID
    const other = V.sign(dig(base), crypto.randomBytes(32), crypto.randomBytes(32)).toString('hex');
    assert.equal(V.verify(dig(c), Buffer.from(c.dk, 'hex'), Buffer.from(other, 'hex')), false);
    // malformed or stale
    assert.equal(M.cleanMsg(Object.assign({}, msg, { ts: now - 5 * 60000 }), now), null, 'too old');
    assert.equal(M.cleanMsg(Object.assign({}, msg, { mode: 'ranked', ft: 7 }), now), null, 'not an FT you can pick');
    assert.equal(M.cleanMsg(Object.assign({}, msg, { t: 'hack' }), now), null);
    assert.equal(M.cleanMsg(Object.assign({}, msg, { h: 'x' }), now), null);
    assert.equal(M.cleanMsg({ t: 'offer', h: H('a'), ts: now, dk, sig: msg.sig, id: 'abc123def456' }, now), null, 'an offer needs a "to"');
    assert.equal(M.cleanMsg({ t: 'casual', h: H('a'), ts: now, dk, sig: msg.sig }, now), null);
});

// two (or three) Fightcords on a fake relay, with a fake clock
function world() {
    let t = 1793900000000;
    const peers = [];
    const log = [];
    function peer(h, o) {
        const p = { h, events: [], challenges: [], armed: null, fits: () => true };
        Object.assign(p, o || {});
        p.m = M.Matcher({
            now: () => t, myHash: () => h,
            send: (msg) => { const out = Object.assign({ h }, msg); log.push(out); peers.forEach(q => { if (q !== p) q.m.receive(out); }); },
            fits: (e) => p.fits(e), score: () => 1,
            found: (x) => p.events.push('found'), update: () => {}, done: (x, why) => p.events.push('done:' + why),
            toast: (k) => p.events.push('toast:' + k),
            challenge: (x) => { p.challenges.push({ ft: x.mode === 'ranked' ? x.ft : 0, to: x.h }); return true; },
            arm: (x) => { p.armed = x.h; }
        });
        peers.push(p);
        return p;
    }
    return { peer, log, step: (ms) => { t += ms; peers.forEach(p => p.m.tick()); }, now: () => t };
}

test('both accept: one challenge with the right FT, and the other side takes it', () => {
    const w = world();
    const a = w.peer(H('a')), b = w.peer(H('b'));
    b.m.join({ ch: 'sfiii3nr1', mode: 'ranked', ft: 5 });
    a.m.join({ ch: 'sfiii3nr1', mode: 'ranked', ft: 5 });
    w.step(1000);
    assert.equal(w.log.filter(m => m.t === 'offer').length, 1, 'only A (the lower hash) asks');
    assert.deepEqual(a.events, ['found']);
    assert.deepEqual(b.events, ['found']);
    b.m.accept();
    assert.equal(b.armed, H('a'), 'B takes A’s challenge from now on');
    assert.equal(a.challenges.length, 0, 'not until both accepted');
    a.m.accept();
    assert.deepEqual(a.challenges, [{ ft: 5, to: H('b') }]);
    assert.equal(b.challenges.length, 0, 'only the asker sends it');
    a.m.started(); b.m.started();
    assert.equal(a.m.queue, null);
    assert.equal(b.m.queue, null);
});

test('casual sets are FT 0 (casual), and someone else’s FT never matches', () => {
    const w = world();
    const a = w.peer(H('a')), b = w.peer(H('b')), c = w.peer(H('c'));
    c.m.join({ ch: 'sfiii3nr1', mode: 'ranked', ft: 3 });
    b.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    a.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    w.step(1000);
    assert.equal(a.m.match.h, H('b'), 'A gets B, not C (ranked)');
    assert.equal(c.events.length, 0);
    a.m.accept(); b.m.accept();
    assert.deepEqual(a.challenges, [{ ft: 0, to: H('b') }]);
});

test('a decline: the one who declined leaves, the other is back in the queue and skips them', () => {
    const w = world();
    const a = w.peer(H('a')), b = w.peer(H('b'));
    a.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    b.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    w.step(1000);
    a.m.accept();
    b.m.decline();
    assert.equal(b.m.queue, null, 'B left the queue');
    assert.ok(a.m.queue, 'A is still queued');
    assert.equal(a.m.match, null);
    assert.ok(a.events.includes('toast:requeue'));
    // B queues again a minute later: A doesn't ask B again for 10 minutes
    b.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    w.step(60000);
    assert.equal(a.m.match, null, 'skipped');
    w.step(10 * 60000);
    w.step(1000);                                  // (Fightcord ticks every second; one more after the jump)
    assert.ok(a.m.match && a.m.match.h === H('b'), 'asked again after the 10 minutes');
});

test('a timeout: whoever didn’t accept leaves the queue', () => {
    const w = world();
    const a = w.peer(H('a')), b = w.peer(H('b'));
    a.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    b.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    w.step(1000);
    a.m.accept();
    w.step(M.TIMES.FOUND_MS + 1000);
    assert.equal(b.m.queue, null, 'B didn’t accept: out');
    assert.ok(b.events.includes('done:timeout'));
    assert.ok(a.m.queue, 'A is back in the queue');
    assert.equal(a.m.match, null);
});

test('busy: a third player’s offer during a match-up is answered no', () => {
    const w = world();
    const a = w.peer(H('a')), b = w.peer(H('b')), c = w.peer(H('c'));
    a.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    b.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    w.step(1000);
    assert.equal(a.m.match.h, H('b'));
    // C joins; B (in a match-up with A) is the lower hash for C, so B would ask C... but B is busy
    c.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    w.step(1000);
    assert.equal(c.m.match, null, 'nobody takes C while A and B decide');
    assert.equal(b.m.match.h, H('a'));
    // an offer straight to someone busy gets a no
    const before = w.log.length;
    b.m.receive({ t: 'offer', h: H('0'), to: H('b'), id: 'zzzzzz111111' });
    assert.ok(w.log.slice(before).some(m => m.t === 'no' && m.h === H('b')));
});

test('someone who doesn’t fit is never asked; someone leaving the queue drops the match-up', () => {
    const w = world();
    const a = w.peer(H('a'), { fits: () => false }), b = w.peer(H('b'));
    a.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    b.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    w.step(1000);
    assert.equal(a.m.match, null);
    a.fits = () => true;
    w.step(1000);
    assert.ok(a.m.match);
    b.m.leave('cancel');
    assert.equal(a.m.match, null);
    assert.ok(a.m.queue);
    assert.equal(a.m.count(), 0, 'B is out of A’s queue count');
});

test('entries go stale; the queue count is per game and mode', () => {
    const w = world();
    const a = w.peer(H('a'), { fits: () => false }), b = w.peer(H('b'), { fits: () => false }), c = w.peer(H('c'), { fits: () => false });
    a.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    b.m.join({ ch: 'sfiii3nr1', mode: 'casual' });
    c.m.join({ ch: 'kof98', mode: 'casual' });
    assert.equal(a.m.count(), 1);
    // B goes quiet (closed Fightcade without a bye)
    b.m.queue = null;
    w.step(M.TIMES.TTL + 1000);
    assert.equal(a.m.count(), 0);
});

// the module itself: what it sends is signed with your Fightcord ID, and what it hears only counts from
// the ID presence heard for that player
test('the module signs what it sends and checks who sent what it hears', () => {
    const P = require('../presence.js');
    const mySk = crypto.randomBytes(32), myDk = V.pubkey(mySk).toString('hex');
    const theirSk = crypto.randomBytes(32), theirDk = V.pubkey(theirSk).toString('hex');
    const users = {
        Me: { name: 'Me', channels: ['sfiii3nr1'], channelRank: { SF3: 4 }, settings: { ranked: true } },
        Them: { name: 'Them', channels: ['sfiii3nr1'], channelRank: { SF3: 4 }, ping: 50, settings: { ranked: true } }
    };
    const presenceIds = { Me: myDk, Them: theirDk };
    const mods = {
        lobbies: { myId: () => myDk, signId: (msg) => V.sign(msg, mySk, crypto.randomBytes(32)).toString('hex') },
        presence: { info: (n) => (presenceIds[n] ? { dk: presenceIds[n] } : null), check: () => Promise.resolve(null) },
        'find-match': { _config: { window: '1', maxPing: 120 }, score: () => 1, _context: () => null }
    };
    const fake = {
        config: () => ({ data: { enabled: true, mode: 'casual', ft: 3, alert: false }, save() {} }),
        t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)),
        fmt: { esc: (s) => String(s) }, log: Object.assign(() => {}, { warn() {} }),
        ui: { style() {}, toast() {} }, own() {}, on() {}, cmd() {}, settings: { block() {} },
        hooks: { challenge() {} }, sound: { play() {} },
        modules: { get: (id) => mods[id] || null },
        history: { recordVs: () => null },
        app: { me: () => 'Me', users: () => users, channel: (id) => (id === 'sfiii3nr1' ? { id, name: 'SF3' } : null), activeChannel: () => ({ id: 'sfiii3nr1', name: 'SF3' }), userInfo: () => ({ rank: 4 }), root: () => null }
    };
    if (typeof global.document === 'undefined') global.document = { querySelectorAll: () => [], querySelector: () => null };
    const api = M.start(fake);
    const sent = [];
    api._relays({ send: (m) => sent.push(m), close() {} });
    api._mm.join({ ch: 'sfiii3nr1', mode: 'casual' });
    // what we sent: a "q" with our hash, our ID and a signature that checks out
    const q = sent.find(m => m.t === 'q');
    assert.equal(q.h, P.hashOf('Me'));
    assert.equal(q.dk, myDk);
    const dig = (m) => crypto.createHash('sha256').update(M.signText(m)).digest();
    assert.ok(V.verify(dig(q), Buffer.from(q.dk, 'hex'), Buffer.from(q.sig, 'hex')));
    // a "q" from Them, signed with their ID: they're in the queue
    const signed = (m, sk, dk) => { const o = Object.assign({ ts: Date.now(), dk }, m); o.sig = V.sign(dig(o), sk, crypto.randomBytes(32)).toString('hex'); return o; };
    api._onMsg(signed({ t: 'q', h: P.hashOf('Them'), ch: 'sfiii3nr1', mode: 'casual', ft: 0 }, theirSk, theirDk));
    assert.equal(api._mm.count(), 1);
    // someone else signing as Them (their own key, not the ID presence heard for Them): ignored
    api._mm.entries.clear();
    const evilSk = crypto.randomBytes(32), evilDk = V.pubkey(evilSk).toString('hex');
    api._onMsg(signed({ t: 'q', h: P.hashOf('Them'), ch: 'sfiii3nr1', mode: 'casual', ft: 0 }, evilSk, evilDk));
    assert.equal(api._mm.count(), 0, 'not Them’s ID');
    // Them's ID, but a field changed after signing: ignored
    const tampered = signed({ t: 'q', h: P.hashOf('Them'), ch: 'sfiii3nr1', mode: 'casual', ft: 0 }, theirSk, theirDk);
    tampered.mode = 'ranked'; tampered.ft = 10;
    api._onMsg(tampered);
    assert.equal(api._mm.count(), 0, 'a changed message');
    // nobody in your channel has that hash: ignored
    api._onMsg(signed({ t: 'q', h: P.hashOf('Ghost'), ch: 'sfiii3nr1', mode: 'casual', ft: 0 }, theirSk, theirDk));
    assert.equal(api._mm.count(), 0);
    api._mm.leave('test');
    assert.ok(sent.some(m => m.t === 'bye'));
});

test('a channel listed by name counts too', () => {
    const q = { ch: 'sfiii3nr1', mode: 'casual', ft: 0 };
    assert.equal(M.compatible(meAt(), q, user({ channels: ['SF3'] })), true);
});
