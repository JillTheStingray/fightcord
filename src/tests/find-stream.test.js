// node --test tests/      Find a match (find-match.js), streamer overlay (streamer.js), challenge queue (challenge-card.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const fm = require('../find-match.js');
const st = require('../streamer.js');
const cc = require('../challenge-card.js');

const CH = 'sfiii3nr1', NAME = 'Street Fighter III 3rd Strike';
const user = (rank, ping, more) => Object.assign({ channels: [CH], channelRank: { [NAME]: rank }, ping, country: { iso_code: 'BR' } }, more);
const USERS = {
    Me: user(4, 0),
    Close: user(4, 40),
    OneUp: user(5, 60),
    TwoUp: user(6, 50),
    Laggy: user(4, 200),
    Away: user(4, 30, { away: true }),
    Busy: user(4, 30, { playing: { quarkId: 'q1' } }),
    Elsewhere: Object.assign(user(4, 30), { channels: ['kof98'] }),
    Blocked: user(4, 30),
    NoPing: user(4, undefined),
    Unranked: user(0, 30)
};
const base = { me: 'Me', channel: CH, channelName: NAME, myRank: 4, window: 1, maxPing: 120 };

test('find a match: only free players in this channel, in range, on a good ping', () => {
    const names = fm.candidates(USERS, Object.assign({}, base, { skip: (n) => n === 'Blocked' })).map(c => c.name).sort();
    assert.deepEqual(names, ['Close', 'NoPing', 'OneUp']);
});

test('find a match: rank window "any" and a wider ping let more in', () => {
    const names = fm.candidates(USERS, Object.assign({}, base, { window: null, maxPing: 250 })).map(c => c.name).sort();
    assert.deepEqual(names, ['Blocked', 'Close', 'Laggy', 'NoPing', 'OneUp', 'TwoUp', 'Unranked']);
});

test('find a match: someone new beats a lopsided record, a low ping beats an unknown one', () => {
    const fresh = fm.score({ ping: 50, rank: 4, h2h: null }, { myRank: 4, maxPing: 120 });
    const lopsided = fm.score({ ping: 50, rank: 4, h2h: { w: 9, l: 1 } }, { myRank: 4, maxPing: 120 });
    const close = fm.score({ ping: 50, rank: 4, h2h: { w: 4, l: 3 } }, { myRank: 4, maxPing: 120 });
    const unknownPing = fm.score({ ping: null, rank: 4, h2h: null }, { myRank: 4, maxPing: 120 });
    assert.ok(fresh > lopsided && close > lopsided, 'new or close > lopsided');
    assert.ok(fresh > unknownPing, 'known low ping > unknown');
    assert.ok(fm.score({ ping: 50, odds: 0.5 }, { maxPing: 120 }) > fm.score({ ping: 50, odds: 0.9 }, { maxPing: 120 }), 'a fair fight first');
});

test('find a match: the list comes best first', () => {
    const list = fm.candidates(USERS, Object.assign({}, base, { skip: (n) => n === 'Blocked', h2h: (n) => (n === 'Close' ? { w: 10, l: 0 } : null) }));
    assert.equal(list[0].name, 'OneUp');
    assert.ok(list.every((c, i) => i === 0 || list[i - 1].score >= c.score));
});

test('streamer overlay: playing, hidden opponent, idle with a record', () => {
    const s = st.overlayState({ me: 'Me', myRank: 'B', opp: 'Them', oppRank: 'A', oppCc: 'jp', game: '3rd Strike', ft: 3, score: { mine: 2, theirs: 1 }, session: { w: 5, l: 2 } });
    assert.equal(s.playing, true);
    assert.deepEqual(s.score, { mine: 2, theirs: 1 });
    assert.equal(s.opp.name, 'Them');
    const hidden = st.overlayState({ me: 'Me', opp: 'Them', oppCc: 'jp', showOpp: false });
    assert.equal(hidden.opp.name, 'Opponent');
    assert.equal(hidden.opp.cc, '');
    const idle = st.overlayState({ me: 'Me', session: { w: 1, l: 0 }, score: { mine: 9, theirs: 9 } });
    assert.equal(idle.playing, false);
    assert.equal(idle.opp, null);
    assert.equal(idle.score, null, 'no score without a match');
    assert.deepEqual(idle.session, { w: 1, l: 0 });
    assert.equal(st.overlayState({ me: 'Me', session: { w: 0, l: 0 } }).session, null);
});

test('streamer overlay: only answers to this PC', () => {
    assert.equal(st.hostOk('127.0.0.1:7979', 7979), true);
    assert.equal(st.hostOk('localhost:7979', 7979), true);
    assert.equal(st.hostOk('evil.example:7979', 7979), false);
    assert.equal(st.hostOk('127.0.0.1:8000', 7979), false);
});

test('challenge queue: one card at a time, nothing mid-match, off = as before', () => {
    assert.equal(cc.decide(false, 2, true), 'show');
    assert.equal(cc.decide(true, 0, false), 'show');
    assert.equal(cc.decide(true, 1, false), 'wait');
    assert.equal(cc.decide(true, 0, true), 'wait');
});
