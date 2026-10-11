// node --test tests/      voice chat (voice.js): the crypto, the room and the handshake, without network or audio
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('../voice.js');
const H = (s) => Buffer.from(s, 'hex');

// from BIP340's test-vectors.csv
const VECTORS = [
    { sk: '0000000000000000000000000000000000000000000000000000000000000003', pk: 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9',
      aux: '0000000000000000000000000000000000000000000000000000000000000000', msg: '0000000000000000000000000000000000000000000000000000000000000000',
      sig: 'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0' },
    { sk: 'B7E151628AED2A6ABF7158809CF4F3C762E7160F38B4DA56A784D9045190CFEF', pk: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
      aux: '0000000000000000000000000000000000000000000000000000000000000001', msg: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
      sig: '6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A' }
];

test('voice: BIP340 Schnorr matches the official test vectors', () => {
    VECTORS.forEach(t => {
        assert.equal(v.pubkey(H(t.sk)).toString('hex').toUpperCase(), t.pk);
        const sig = v.sign(H(t.msg), H(t.sk), H(t.aux));
        assert.equal(sig.toString('hex').toUpperCase(), t.sig);
        assert.ok(v.verify(H(t.msg), H(t.pk), sig));
        const bad = Buffer.from(sig); bad[63] ^= 1;
        assert.equal(v.verify(H(t.msg), H(t.pk), bad), false);
    });
});

test('voice: signed nostr events check out, and tampering is caught', () => {
    const sk = require('crypto').randomBytes(32);
    const ev = v.makeEvent(sk, v.KIND, [['t', 'abc']], 'hello');
    assert.equal(ev.kind, 25050);
    assert.equal(ev.id.length, 64);
    assert.ok(v.checkEvent(ev));
    assert.equal(v.checkEvent(Object.assign({}, ev, { content: 'changed' })), false);
});

test('voice: the same room for both players, sealed messages open with today or yesterday’s key', () => {
    assert.equal(v.roomTopic('Alice', 'bob'), v.roomTopic('BOB', 'alice'));
    assert.notEqual(v.roomTopic('Alice', 'Bob'), v.roomTopic('Alice', 'Carol'));
    const now = Date.UTC(2026, 9, 11, 23, 59);
    const sealed = v.seal(v.roomKey('Alice', 'Bob', now), { t: 'hello', from: 'alice' });
    const tomorrow = now + 120000;
    assert.deepEqual(v.open([v.roomKey('bob', 'alice', tomorrow), v.roomKey('bob', 'alice', tomorrow - 86400000)], sealed), { t: 'hello', from: 'alice' });
    assert.equal(v.open([v.roomKey('Alice', 'Carol', now)], sealed), null);         // another pair can't read it
    assert.equal(v.open([v.roomKey('Alice', 'Bob', now)], 'garbage'), null);
});

test('voice: who calls, and when you join by yourself', () => {
    assert.equal(v.isCaller('alice', 'Bob'), true);
    assert.equal(v.isCaller('Bob', 'alice'), false);
    assert.equal(v.decide('ask', true), 'ask');
    assert.equal(v.decide('friends', true), 'auto');
    assert.equal(v.decide('friends', false), 'ask');
    assert.equal(v.decide('everyone', false), 'auto');
});

test('voice: the noise gate opens on a loud moment and holds briefly', () => {
    const st = {};
    assert.equal(v.gate(st, 0.02, 0, 0.08, 300), false);
    assert.equal(v.gate(st, 0.2, 100, 0.08, 300), true);
    assert.equal(v.gate(st, 0.01, 350, 0.08, 300), true);             // still inside the hold
    assert.equal(v.gate(st, 0.01, 450, 0.08, 300), false);
});

// two sessions talking through a fake relay
function wire(aOpts, bOpts) {
    const A = v.Session('Alice', 'Bob', aOpts), B = v.Session('Bob', 'Alice', bOpts);
    const log = { A: [], B: [] };
    const deliver = (from, to, toName, acts) => acts.forEach(x => {
        log[from === A ? 'A' : 'B'].push(Object.keys(x)[0] + (x.send ? ':' + x.send.t : ''));
        if (x.send) deliver(to, from, toName === 'A' ? 'B' : 'A', to.receive(x.send));
    });
    return { A, B, log, run: (who, acts) => deliver(who === 'A' ? A : B, who === 'A' ? B : A, who === 'A' ? 'B' : 'A', acts) };
}

test('voice: ask mode — nothing connects until both join; the earlier name calls', () => {
    const w = wire({ mode: 'ask' }, { mode: 'ask' });
    w.run('A', w.A.hello());
    w.run('B', w.B.hello());
    assert.equal(w.A.state, 'ask');
    assert.equal(w.B.state, 'ask');
    assert.ok(w.log.A.includes('ask') && w.log.B.includes('ask'));
    w.run('B', w.B.join());
    assert.ok(!w.log.A.includes('call') && !w.log.B.includes('call'), 'one join is not enough');
    w.run('A', w.A.join());
    assert.ok(w.log.A.includes('call'), 'Alice (sorts first) calls: ' + w.log.A.join(','));
    assert.ok(!w.log.B.includes('call'));
    // the offer / answer
    assert.deepEqual(w.B.receive(w.A.offerMsg('SDP-O')), [{ answer: 'SDP-O' }]);
    assert.deepEqual(w.A.receive(w.B.answerMsg('SDP-A')), [{ accept: 'SDP-A' }]);
    assert.equal(w.A.state, 'connected');
});

test('voice: auto-join with everyone connects without asking; leaving ends the other side', () => {
    const w = wire({ mode: 'everyone' }, { mode: 'friends', friend: true });
    w.run('A', w.A.hello());
    w.run('B', w.B.hello());
    assert.ok(!w.log.A.includes('ask') && !w.log.B.includes('ask'));
    assert.ok(w.log.A.includes('call'));
    const bye = w.B.leave();
    assert.deepEqual(w.A.receive(bye[0].send), [{ end: 'they left' }]);
    assert.equal(w.A.state, 'ended');
});

test('voice: messages from someone else, or after the end, are ignored', () => {
    const A = v.Session('Alice', 'Bob', { mode: 'everyone' });
    assert.deepEqual(A.receive({ t: 'hello', from: 'mallory', sid: 'x' }), []);
    A.leave();
    assert.deepEqual(A.receive({ t: 'hello', from: 'bob', sid: 'y' }), []);
});
