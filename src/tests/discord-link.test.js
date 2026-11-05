// node --test tests/      Discord challenges (discord-link.js): what the bot may ask, and the one accept
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const D = require('../discord-link.js');

// a Fightcord's side with a fake Fightcade
function side(over) {
    let now = 1000;
    const log = { said: [], sent: [], joined: [], selected: [], challenged: [], linked: [], unlinked: 0 };
    const users = { Bob: ['sfiii3nr1'] };
    const d = Object.assign({
        status: () => ({ name: 'Alice', ch: 'sfiii3nr1', chName: '3rd Strike', games: [], inMatch: false, away: false, off: false }),
        on: () => true, now: () => now,
        join: async (ch) => { log.joined.push(ch); return true; },
        select: (ch) => log.selected.push(ch),
        inGame: (name, ch) => (users[name] || []).includes(ch),
        wait: async (fn) => fn(),
        challenge: (name, ft, ch) => { log.challenged.push([name, ft, ch]); return { ok: true }; },
        gameName: (ch) => ch === 'sfiii3nr1' ? '3rd Strike' : ch,
        say: (kind, v) => log.said.push([kind, v.name]),
        linked: (who) => log.linked.push(who), unlinked: () => { log.unlinked++; },
        send: (m) => log.sent.push(m)
    }, over || {});
    return { a: D.Agent(d), log, users, tick: (ms) => { now += ms; } };
}
const ctx = (name, channel, extra) => Object.assign({ name, channel, id: 'c1', ranked: 3, warn: [], trusted: '' }, extra || {});

test('ping: who you are and what you have open', async () => {
    const { a } = side();
    const r = await a.handle({ t: 'ping', q: 'q1' });
    assert.equal(r.t, 'pong');
    assert.equal(r.q, 'q1');
    assert.equal(r.st.name, 'Alice');
    assert.equal((await side({ status: () => null }).a.handle({ t: 'ping', q: 'q2' })).st, null, 'not logged in');
    assert.equal(await a.handle(null), null);
    assert.equal(await a.handle({ t: 'run-this', code: 'x' }), null, 'nothing else does anything');
});

test('go send: join, wait for them, then challenge at the FT from Discord', async () => {
    const s = side();
    const r = await s.a.handle({ t: 'go', q: 'q', role: 'send', opp: 'Bob', ch: 'sfiii3nr1', ft: 3, cid: 'x' });
    assert.deepEqual(r, { q: 'q', t: 'done', ok: true });
    assert.deepEqual(s.log.joined, ['sfiii3nr1']);
    assert.deepEqual(s.log.challenged, [['Bob', 3, 'sfiii3nr1']]);
    // they never come
    const r2 = await s.a.handle({ t: 'go', q: 'q', role: 'send', opp: 'Carol', ch: 'sfiii3nr1', ft: 0 });
    assert.equal(r2.ok, false);
    assert.equal(r2.why, 'Carol didn\'t show up in 3rd Strike.');
    // Fightcade says no
    const s3 = side({ challenge: () => ({ ok: false, why: 'Bob is away' }) });
    assert.equal((await s3.a.handle({ t: 'go', role: 'send', opp: 'Bob', ch: 'sfiii3nr1', ft: 2 })).why, 'Bob is away');
});

test('go is refused when it\'s off, in a match, or the channel won\'t open', async () => {
    assert.match((await side({ on: () => false }).a.handle({ t: 'go', role: 'take', opp: 'Bob', ch: 'sfiii3nr1' })).why, /off in Fightcord/);
    const busy = side({ status: () => ({ name: 'Alice', inMatch: true }) });
    assert.equal((await busy.a.handle({ t: 'go', role: 'send', opp: 'Bob', ch: 'sfiii3nr1' })).why, 'Alice is in a match right now.');
    assert.match((await side({ join: async () => false }).a.handle({ t: 'go', role: 'take', opp: 'Bob', ch: 'kof98' })).why, /couldn't join kof98/);
    assert.equal((await side().a.handle({ t: 'go', role: 'take', opp: '', ch: 'sfiii3nr1' })).ok, false);
    assert.equal((await side().a.handle({ t: 'go', role: 'steal', opp: 'Bob', ch: 'sfiii3nr1' })).ok, false);
});

test('go take: only that challenge is trusted and accepted, once, in time', async () => {
    const s = side();
    await s.a.handle({ t: 'go', q: 'q', role: 'take', opp: 'Bob', ch: 'sfiii3nr1', ft: 3, cid: 'c9' });
    assert.deepEqual(s.log.said.at(-1), ['take', 'Bob']);
    const other = ctx('Mallory', 'sfiii3nr1');
    s.a.filter(other);
    assert.equal(other.trusted, '', 'someone else');
    assert.equal(s.a.take(other), null);
    const wrongCh = ctx('Bob', 'kof98');
    s.a.filter(wrongCh);
    assert.equal(wrongCh.trusted, '', 'another channel');
    const c = ctx('bob', 'sfiii3nr1');
    s.a.filter(c);
    assert.equal(c.trusted, 'discord', 'any case of their name');
    assert.ok(s.a.take(c));
    assert.deepEqual(s.log.sent, [{ t: 'took', cid: 'c9' }], 'the bot hears it was accepted');
    const again = ctx('Bob', 'sfiii3nr1');
    s.a.filter(again);
    assert.equal(again.trusted, '', 'only once');
    // too late
    await s.a.handle({ t: 'go', role: 'take', opp: 'Bob', ch: 'sfiii3nr1', cid: 'c10' });
    s.tick(D.ARM_MS + 1);
    const late = ctx('Bob', 'sfiii3nr1');
    s.a.filter(late);
    assert.equal(late.trusted, '');
    // the challenger's side failed: the bot disarms it
    await s.a.handle({ t: 'go', role: 'take', opp: 'Bob', ch: 'sfiii3nr1', cid: 'c11' });
    await s.a.handle({ t: 'disarm', cid: 'other' });
    assert.ok(s.a.armed, 'a different challenge doesn\'t disarm it');
    await s.a.handle({ t: 'disarm', cid: 'c11' });
    assert.equal(s.a.armed, null);
});

test('linked / unlinked / news from the bot', async () => {
    const s = side();
    await s.a.handle({ t: 'linked', who: 'jill' });
    await s.a.handle({ t: 'asked', from: 'Bob', game: '3rd Strike', ft: 3 });
    await s.a.handle({ t: 'news', kind: 'declined', opp: 'Bob' });
    await s.a.handle({ t: 'news', kind: 'whatever', opp: 'Bob' });
    await s.a.handle({ t: 'unlinked' });
    assert.deepEqual(s.log.linked, ['jill']);
    assert.equal(s.log.unlinked, 1);
    assert.deepEqual(s.log.said, [['asked', 'Bob'], ['declined', 'Bob']]);
});

test('the socket address carries an HMAC of the link secret', () => {
    const id = 'ab'.repeat(12), s = 'cd'.repeat(32);
    const u = new URL(D.socketUrl('https://bot.example.workers.dev/', id, s, 1234));
    assert.equal(u.protocol, 'wss:');
    assert.equal(u.pathname, '/ws');
    assert.equal(u.searchParams.get('t'), '1234');
    assert.equal(u.searchParams.get('m'), crypto.createHmac('sha256', Buffer.from(s, 'hex')).update(id + '|1234').digest('hex'));
    assert.equal(D.socketUrl('http://127.0.0.1:8787', id, s, 1).slice(0, 23), 'ws://127.0.0.1:8787/ws?');
    assert.equal(D.validBase('https://x.workers.dev'), true);
    assert.equal(D.validBase('javascript:alert(1)'), false);
    assert.equal(D.validBase(''), false);
    // the address pasted for Discord works too: only the site part is used
    assert.equal(D.siteOf(' https://x.workers.dev/interactions '), 'https://x.workers.dev');
    assert.equal(D.siteOf('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
});

// (the trusted challenge in the core's pipeline: core.test.js)
