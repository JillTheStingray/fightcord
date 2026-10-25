// node --test tests/      private lobbies 3.0: look, welcome, moderators, reactions, replies, pins, events,
// the leaderboard -- and the 2.19 Room still reading a 3.0 lobby
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lobbies.js');
const { Room: Room219 } = require('./fixtures/room-2.19.js');

const IMG = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73/w==';
let n = 0;
const id = () => 'e' + (n++);
// the owner 'own1' (pre 'own'), moderator 'mod1', members 'aa', 'bb'
function lobby(extra) {
    const r = L.Room({ pre: 'own' });
    r.apply({ id: id(), pk: 'own1', at: 100, b: Object.assign({ t: 'info', name: 'FNF', mods: ['mod1'], members: [['own1', 'Owner'], ['mod1', 'Mo'], ['aa', 'Ann'], ['bb', 'Ben']] }, extra || {}), ok: true });
    return r;
}

test('look + welcome: only the owner sets them, values are cleaned', () => {
    const r = lobby({ col: '#EB459E', emo: '🥊', desc: 'Friday sets', welcome: 'Read the pins!', mods: ['mod1', 'bad key!'] });
    assert.equal(r.info.name, 'FNF');
    assert.equal(r.info.col, '#eb459e');
    assert.equal(r.info.emo, '🥊');
    assert.equal(r.info.desc, 'Friday sets');
    assert.equal(r.info.welcome, 'Read the pins!');
    assert.deepEqual(r.info.mods, ['mod1'], 'not a key: dropped');
    // a member can't change them
    assert.equal(r.apply({ id: id(), pk: 'aa', at: 200, b: { t: 'info', name: 'Hacked', col: '#000000' }, ok: true }), '');
    assert.equal(r.info.name, 'FNF');
    // bad values
    r.apply({ id: id(), pk: 'own1', at: 300, b: { t: 'info', name: 'FNF', col: 'red', emo: '<b>x</b>', desc: 'x'.repeat(900) }, ok: true });
    assert.equal(r.info.col, '');
    assert.equal(r.info.emo, '');
    assert.equal(r.info.desc.length, 300);
    // pictures: the owner's, the right kind, newest wins
    assert.equal(r.apply({ id: id(), pk: 'aa', at: 310, b: { t: 'art', ic: IMG }, ok: true }), '', 'a member can’t');
    assert.equal(r.apply({ id: id(), pk: 'own1', at: 320, b: { t: 'art', ic: IMG, bn: 'javascript:alert(1)' }, ok: true }), 'look');
    assert.equal(r.art.ic, IMG);
    assert.equal(r.art.bn, '', 'not a picture');
    assert.equal(r.apply({ id: id(), pk: 'own1', at: 315, b: { t: 'art', ic: '' }, ok: true }), '', 'an older one arriving late');
    assert.equal(r.art.ic, IMG);
    assert.equal(r.apply({ id: id(), pk: 'own1', at: 330, b: { t: 'art', ic: 'data:image/webp;base64,' + 'A'.repeat(30000) }, ok: true }), 'look');
    assert.equal(r.art.ic, '', 'too big: dropped');
});

test('moderators: their pins, mutes and nicknames count only while they are one, in any order', () => {
    const r = L.Room({ pre: 'own' });
    // a pin arrives before the owner's info (shuffled history)
    r.apply({ id: 'm1', pk: 'aa', at: 110, b: { t: 'msg', x: 'rules: FT5, be nice' } });
    r.apply({ id: id(), pk: 'mod1', at: 120, b: { t: 'pin', m: 'm1', on: true }, ok: true });
    assert.deepEqual(r.pinned(), [], 'not known as a moderator yet');
    r.apply({ id: id(), pk: 'own1', at: 100, b: { t: 'info', name: 'FNF', mods: ['mod1'], members: [['own1', 'Owner'], ['mod1', 'Mo'], ['aa', 'Ann']] }, ok: true });
    assert.deepEqual(r.pinned().map(p => p.m), ['m1'], 'counts once the owner’s info says so');
    assert.equal(r.pinned()[0].msg.x, 'rules: FT5, be nice');
    assert.ok(r.visible().some(m => m.sys === 'pin'), 'a "pinned a message" line');
    // a member's pin / an unsigned one don't count
    r.apply({ id: 'm2', pk: 'aa', at: 130, b: { t: 'msg', x: 'pin me' } });
    r.apply({ id: id(), pk: 'aa', at: 131, b: { t: 'pin', m: 'm2', on: true }, ok: true });
    r.apply({ id: id(), pk: 'mod1', at: 132, b: { t: 'pin', m: 'm2', on: true }, ok: false });
    assert.deepEqual(r.pinned().map(p => p.m), ['m1']);
    // nickname, then unpin
    r.apply({ id: id(), pk: 'mod1', at: 140, b: { t: 'nick', pk: 'aa', n: 'Annie' }, ok: true });
    assert.equal(r.name('aa'), 'Annie');
    r.apply({ id: id(), pk: 'own1', at: 150, b: { t: 'pin', m: 'm1', on: false }, ok: true });
    assert.deepEqual(r.pinned(), []);
    // the owner takes the moderator role away: what they did stops counting
    r.apply({ id: id(), pk: 'mod1', at: 160, b: { t: 'pin', m: 'm2', on: true }, ok: true });
    assert.equal(r.pinned().length, 1);
    r.apply({ id: id(), pk: 'own1', at: 170, b: { t: 'info', name: 'FNF', mods: [] }, ok: true });
    assert.equal(r.pinned().length, 0);
    assert.equal(r.name('aa'), 'Ann');
});

test('mutes: a muted member’s messages are hidden while muted; an unmute ends it early', () => {
    const r = lobby();
    r.apply({ id: id(), pk: 'bb', at: 200, b: { t: 'msg', x: 'before' } });
    r.apply({ id: id(), pk: 'mod1', at: 300, b: { t: 'mute', pk: 'bb', until: 1000 }, ok: true });
    r.apply({ id: id(), pk: 'bb', at: 400, b: { t: 'msg', x: 'spam' } });
    r.apply({ id: id(), pk: 'mod1', at: 500, b: { t: 'mute', pk: 'bb', until: 0 }, ok: true });
    r.apply({ id: id(), pk: 'bb', at: 600, b: { t: 'msg', x: 'sorry' } });
    assert.deepEqual(r.visible().filter(m => !m.sys).map(m => m.x), ['before', 'sorry']);
    // nobody mutes the owner
    r.apply({ id: id(), pk: 'mod1', at: 700, b: { t: 'mute', pk: 'own1', until: 99999 }, ok: true });
    r.apply({ id: id(), pk: 'own1', at: 800, b: { t: 'msg', x: 'still here' } });
    assert.ok(r.visible().some(m => m.x === 'still here'));
});

test('moderator kicks: never the owner or another moderator; one that came too early waits for the info', () => {
    const r = L.Room({ pre: 'own' });
    assert.equal(r.apply({ id: 'rk1', pk: 'mod1', at: 150, b: { t: 'rekey', epoch: 1, keys: {}, out: ['bb'] }, ok: true }), '', 'not known yet');
    r.apply({ id: id(), pk: 'own1', at: 100, b: { t: 'info', name: 'FNF', mods: ['mod1'], members: [['own1', 'Owner'], ['mod1', 'Mo'], ['bb', 'Ben']] }, ok: true });
    assert.ok(!r.active().some(m => m.pk === 'bb'), 'applied once the info came');
    assert.equal(r.rekeys[0].by, 'mod1');
    assert.equal(r.apply({ id: id(), pk: 'mod1', at: 160, b: { t: 'rekey', epoch: 2, keys: {}, out: ['own1'] }, ok: true }), '', 'not the owner');
    assert.equal(r.apply({ id: id(), pk: 'aa', at: 170, b: { t: 'rekey', epoch: 2, keys: {}, out: ['mod1'] }, ok: true }), '', 'a member can’t');
});

test('a moderator moves the key chain on: trusted only with the owner’s own info listing them', () => {
    const ownInfo = { pk: 'own1', at: 100, b: { t: 'info', name: 'FNF', col: '#5865f2', mods: ['mod1'] } };
    // a newcomer's view (lookup): only the new epoch's events
    const r = L.Room({ pre: 'own' });
    assert.equal(r.apply({ id: id(), pk: 'mod1', at: 200, ep: 1, b: { t: 'info', id: 'x', epoch: 1, prev: ['s0'], members: [['mod1', 'Mo']] }, ok: true }), '', 'no owner info: not trusted');
    assert.equal(r.apply({ id: id(), pk: 'mod1', at: 201, ep: 1, b: { t: 'info', id: 'x', epoch: 1, prev: ['s0'] }, ok: true, own: { pk: 'own1', at: 100, b: { t: 'info', mods: [] } } }), '', 'the owner didn’t make them a moderator');
    assert.equal(r.apply({ id: id(), pk: 'mod1', at: 202, ep: 1, b: { t: 'info', id: 'x', epoch: 1, prev: ['s0'] }, ok: true, own: { pk: 'zzz9', at: 100, b: ownInfo.b } }), '', 'not the owner’s key');
    assert.equal(r.apply({ id: id(), pk: 'mod1', at: 203, ep: 1, b: { t: 'info', id: 'x', epoch: 1, prev: ['s0'], name: 'Mine now', members: [['mod1', 'Mo']] }, ok: true, own: ownInfo }), 'info');
    assert.equal(r.info.name, 'FNF', 'the settings are the owner’s, not the moderator’s');
    assert.equal(r.info.col, '#5865f2');
    assert.equal(r.info.epoch, 1);
    assert.deepEqual(r.info.prev, ['s0']);
    assert.equal(r.owner, 'own1');
});

test('reactions and replies', () => {
    const r = lobby();
    r.apply({ id: 'mx', pk: 'aa', at: 200, b: { t: 'msg', x: 'gg!' } });
    r.apply({ id: 'my', pk: 'bb', at: 210, b: { t: 'msg', x: 'ggs', re: 'mx' } });
    assert.equal(r.msgs.find(m => m.id === 'my').re, 'mx');
    r.apply({ id: id(), pk: 'bb', at: 220, b: { t: 'react', m: 'mx', e: '🔥', on: true } });
    r.apply({ id: id(), pk: 'own1', at: 221, b: { t: 'react', m: 'mx', e: '🔥', on: true } });
    r.apply({ id: id(), pk: 'own1', at: 222, b: { t: 'react', m: 'mx', e: '👍', on: true } });
    r.apply({ id: id(), pk: 'own1', at: 230, b: { t: 'react', m: 'mx', e: '👍', on: false } });
    r.apply({ id: id(), pk: 'own1', at: 225, b: { t: 'react', m: 'mx', e: '👍', on: true } });     // older, arriving late
    assert.deepEqual(r.reactions('mx'), [{ e: '🔥', pks: ['bb', 'own1'] }]);
    assert.equal(r.apply({ id: id(), pk: 'aa', at: 240, b: { t: 'react', m: 'mx', e: '<img>', on: true } }), '', 'not an emoji');
    for (let i = 0; i < 40; i++) r.apply({ id: id(), pk: 'aa', at: 300 + i, b: { t: 'react', m: 'mx', e: 'e' + i, on: true } });
    assert.equal(r.reactions('mx').length, 30, 'at most 30 kinds per message');
});

test('events: planned by the owner / moderators, going or not, cancelled, old ones drop', () => {
    const r = lobby();
    const t = 1e12;
    r.apply({ id: id(), pk: 'mod1', at: 200, b: { t: 'evt', e: 'ev1', title: 'FT10 night', when: t + 3600000, ft: 10, desc: 'bring snacks' }, ok: true });
    r.apply({ id: id(), pk: 'aa', at: 210, b: { t: 'evt', e: 'ev2', title: 'my own', when: t + 7200000 }, ok: true });
    r.apply({ id: id(), pk: 'aa', at: 220, b: { t: 'rsvp', e: 'ev1', go: true } });
    r.apply({ id: id(), pk: 'bb', at: 221, b: { t: 'rsvp', e: 'ev1', go: false } });
    r.apply({ id: id(), pk: 'bb', at: 230, b: { t: 'rsvp', e: 'ev1', go: true } });
    let ev = r.events(t);
    assert.deepEqual(ev.map(x => x.title), ['FT10 night'], 'a member can’t plan one');
    assert.equal(ev[0].ft, 10);
    assert.deepEqual(ev[0].going.sort(), ['aa', 'bb']);
    assert.equal(r.events(t + 5 * 3600000).length, 0, 'long past: gone');
    r.apply({ id: id(), pk: 'own1', at: 240, b: { t: 'evt-x', e: 'ev1' }, ok: true });
    assert.equal(r.events(t).length, 0, 'cancelled');
});

test('the leaderboard: both players agree or it doesn’t count; ELO order; king after 5 sets', () => {
    const r = lobby();
    const set = (q, pk, o, w, l, at) => r.apply({ id: id(), pk, at, b: { t: 'set', q, o, w, l } });
    // Ann beats Ben, both report it
    set('q1', 'aa', 'bb', 3, 1, 1000); set('q1', 'bb', 'aa', 1, 3, 1001);
    // only Ben reports a win: counts (one report is enough)
    set('q2', 'bb', 'aa', 3, 2, 2000);
    // they disagree: doesn't count
    set('q3', 'aa', 'bb', 3, 0, 3000); set('q3', 'bb', 'aa', 3, 0, 3001);
    // a third report, a draw, a stranger, the same report twice: ignored
    assert.equal(set('q1', 'own1', 'aa', 3, 0, 1002), '');
    assert.equal(set('q4', 'aa', 'bb', 2, 2, 4000), '');
    set('q5', 'aa', 'zz', 3, 0, 5000);
    let b = r.board();
    assert.deepEqual(b.map(x => [x.pk, x.w, x.l]), [['aa', 1, 1], ['bb', 1, 1]].sort((x, y) => (x[0] === b[0].pk ? -1 : 1)));
    assert.equal(r.king(), '', 'nobody has 5 sets');
    for (let i = 0; i < 5; i++) set('k' + i, 'aa', 'bb', 3, 0, 10000 + i);
    b = r.board();
    assert.equal(b[0].pk, 'aa');
    assert.equal(b[0].w, 6);
    assert.equal(b[0].streak, 5);
    assert.ok(b[0].elo > 1000 && b[1].elo < 1000);
    assert.equal(r.king(), 'aa');
    assert.deepEqual(r.board(10002).map(x => x.sets), [3, 3], 'since a date');
});

test('a Fightcord 2.19 in the same lobby: the 3.0 events don’t disturb its chat', () => {
    const old = Room219({ pre: 'own' });
    const evs = [
        { id: 'a', pk: 'own1', at: 100, b: { t: 'info', name: 'FNF', col: '#5865f2', emo: '🥊', desc: 'x', welcome: 'y', mods: ['mod1'], members: [['own1', 'Owner'], ['aa', 'Ann']] }, ok: true },
        { id: 'b', pk: 'own1', at: 110, b: { t: 'art', ic: IMG }, ok: true },
        { id: 'c', pk: 'aa', at: 120, b: { t: 'msg', x: 'hi', re: 'zz' } },
        { id: 'd', pk: 'mod1', at: 130, b: { t: 'pin', m: 'c', on: true }, ok: true },
        { id: 'e', pk: 'aa', at: 140, b: { t: 'react', m: 'c', e: '🔥', on: true } },
        { id: 'f', pk: 'mod1', at: 150, b: { t: 'evt', e: 'ev', title: 'x', when: 1 }, ok: true },
        { id: 'g', pk: 'aa', at: 160, b: { t: 'set', q: 'q', o: 'own1', w: 3, l: 1 } },
        { id: 'h', pk: 'mod1', at: 170, b: { t: 'mute', pk: 'aa', until: 999 }, ok: true }
    ];
    evs.forEach(e => old.apply(e));
    assert.equal(old.info.name, 'FNF');
    assert.deepEqual(old.visible().filter(m => !m.sys).map(m => m.x), ['hi']);
    assert.deepEqual(old.active().map(m => m.n).sort(), ['Ann', 'Owner']);
});

test('a moderator can’t mute or rename the owner or another moderator; the owner can', () => {
    const r = lobby({ mods: ['mod1', 'mod2'], members: [['own1', 'Owner'], ['mod1', 'Mo'], ['mod2', 'Mia'], ['aa', 'Ann']] });
    r.apply({ id: id(), pk: 'mod1', at: 200, b: { t: 'nick', pk: 'mod2', n: 'Sleepy' }, ok: true });
    r.apply({ id: id(), pk: 'mod1', at: 210, b: { t: 'mute', pk: 'mod2', until: 5000 }, ok: true });
    r.apply({ id: id(), pk: 'mod1', at: 220, b: { t: 'nick', pk: 'own1', n: 'Boss' }, ok: true });
    assert.equal(r.nick('mod2'), '');
    assert.equal(r.muteEnd('mod2', 300), 0);
    assert.equal(r.nick('own1'), '');
    r.apply({ id: id(), pk: 'own1', at: 230, b: { t: 'nick', pk: 'mod2', n: 'Mia the Great' }, ok: true });
    r.apply({ id: id(), pk: 'own1', at: 240, b: { t: 'mute', pk: 'mod2', until: 5000 }, ok: true });
    assert.equal(r.name('mod2'), 'Mia the Great');
    assert.equal(r.muteEnd('mod2', 300), 5000);
    // members are fair game for moderators
    r.apply({ id: id(), pk: 'mod1', at: 250, b: { t: 'mute', pk: 'aa', until: 900 }, ok: true });
    assert.equal(r.muteEnd('aa', 260), 900);
    assert.equal(r.muteEnd('aa', 900), 0, 'over');
    r.apply({ id: id(), pk: 'mod1', at: 270, b: { t: 'mute', pk: 'aa', until: 0 }, ok: true });
    assert.equal(r.muteEnd('aa', 280), 0, 'unmuted early');
});

test('message groups: a reply starts its own group (its quote goes on top)', () => {
    const g = L.groups([
        { id: 'a', pk: 'aa', n: 'Ann', x: 'one', at: 1000 },
        { id: 'b', pk: 'aa', n: 'Ann', x: 'two', at: 2000 },
        { id: 'c', pk: 'aa', n: 'Ann', x: 'three', at: 3000, re: 'zz' },
        { id: 'd', pk: 'aa', n: 'Ann', x: 'four', at: 4000 }
    ]);
    assert.deepEqual(g.map(x => x.items.map(i => i.x)), [['one', 'two'], ['three', 'four']]);
    assert.equal(g[1].re, 'zz');
    assert.equal(g[0].re, '');
});
