// node --test tests/      3.9.1: your mains, shared with Fightcord players (presence.js mv / mn)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../presence.js');

function fakeFc(me, stores, mods) {
    const handlers = new Map(), disposers = [];
    const fc = {
        config(id, defs) { return stores[id] || (stores[id] = { data: JSON.parse(JSON.stringify(defs)), save() {}, saveNow() {} }); },
        own: (f) => disposers.push(f), watch() {}, tick() {}, cmd() {},
        emit(ev, x) { (handlers.get(ev) || []).forEach(f => f(x)); },
        on(ev, f) { if (!handlers.has(ev)) handlers.set(ev, []); handlers.get(ev).push(f); },
        settings: { section() {}, block() {} },
        modules: { get: (id) => mods[id] || null },
        t: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)),
        fmt: { esc: (s) => String(s) },
        ui: { style() {}, ic: () => '', toast() {} },
        data: { artUrl: (r) => 'art:' + r },
        history: { all: () => [] }, api: { cachedBoard: () => null },
        app: { me: () => me, isMe: (n) => String(n).toLowerCase() === me.toLowerCase(), users: () => ({}), user: () => [null, null], activeChannelId: () => '', root: () => null },
        log() {}
    };
    return { fc, stop: () => disposers.forEach(f => f()) };
}
function client(me, mods) {
    delete require.cache[require.resolve('../presence.js')];
    const pres = require('../presence.js');
    const stores = {}, f = fakeFc(me, stores, mods || {});
    const real = global.WebSocket;
    global.WebSocket = function () { return { readyState: 0, send() {}, close() {}, addEventListener() {} }; };
    try { pres.start(f.fc); } finally { global.WebSocket = real; }
    return { pres, fc: f.fc, stop: f.stop, stores };
}

test('mains: game keys and names cleaned, 3 a game, 8 games, the same version whatever the order', () => {
    assert.deepEqual(P.cleanMains({ '3s': ['Yun', 'Yun', 'Chun-Li', 'Makoto', 'Q'], 'BAD KEY': ['Ken'], st: [], vsav: 'Morrigan', sfa3: [' ', 7] }),
        { '3s': ['Yun', 'Chun-Li', 'Makoto'], sfa3: ['7'] });
    assert.deepEqual(P.cleanMains(['Ken']), {});
    assert.equal(Object.keys(P.cleanMains(Object.fromEntries('abcdefghij'.split('').map(k => [k, ['X']])))).length, 8);
    assert.equal(P.cleanMains({ '3s': ['x'.repeat(40)] })['3s'][0].length, 24);
    assert.equal(P.mainsVersion({}), '');
    assert.match(P.mainsVersion({ '3s': ['Yun'] }), /^[0-9a-f]{8}$/);
    assert.equal(P.mainsVersion({ '3s': ['Yun'], st: ['Ryu'] }), P.mainsVersion({ st: ['Ryu'], '3s': ['Yun'] }));
    assert.notEqual(P.mainsVersion({ '3s': ['Yun', 'Ken'] }), P.mainsVersion({ '3s': ['Ken', 'Yun'] }), 'the order is yours');
});

test('end to end: your picks win over the ones you play most; another Fightcord gets them; a 3.9.0 one never sees them', () => {
    const notes = { myAutoMains: () => ({ '3s': ['Ken'], st: ['Ryu'] }) };
    const s = client('Picker', { notes });
    let ans;
    try {
        s.pres.setMains({ '3s': ['Yun', 'Chun-Li'] });
        assert.deepEqual(s.pres.mainsOf('Picker'), { '3s': ['Yun', 'Chun-Li'], st: ['Ryu'] });
        s.pres.setProfile({ s: 'hi' });
        ans = s.pres._answer();
    } finally { s.stop(); }
    assert.match(ans.mv, /^[0-9a-f]{8}$/);
    assert.deepEqual(ans.mn, { '3s': ['Yun', 'Chun-Li'], st: ['Ryu'] });
    assert.equal(ans.p.mn, undefined, 'outside the profile: 3.9.0 checks its versions over p');
    const v = client('Viewer');
    try {
        v.pres._msg({ t: 'here', h: ans.h, voice: 0, pv: ans.pv, lv: ans.lv, dk: ans.dk, mv: ans.mv });
        v.pres._msg(ans);
        assert.deepEqual(v.pres.mainsOf('Picker'), { '3s': ['Yun', 'Chun-Li'], st: ['Ryu'] });
        assert.equal(v.pres.profile('Picker').s, 'hi', 'the profile as before');
        // a "here" with another version than the answer: not taken
        v.pres._msg({ t: 'here', h: ans.h, voice: 0, pv: ans.pv, lv: ans.lv, dk: ans.dk, mv: 'deadbeef' });
        v.pres._msg(Object.assign({}, ans, { mn: { '3s': ['Akuma'] }, mv: 'deadbeef' }));
        assert.equal(v.pres.mainsOf('Picker')['3s'], undefined, 'mn that doesn’t match its version is dropped');
        // they stopped sharing: gone
        v.pres._msg({ t: 'here', h: ans.h, voice: 0, pv: ans.pv, lv: ans.lv, dk: ans.dk });
        assert.deepEqual(v.pres.mainsOf('Picker'), {});
    } finally { v.stop(); }
});

test('sharing off, or "share my mains" off: nothing goes out', () => {
    const notes = { myAutoMains: () => ({ '3s': ['Ken'] }) };
    const s = client('Quiet', { notes });
    try {
        s.pres.setProfile({ s: 'hi' });
        assert.ok(s.pres._answer().mv);
        s.stores.presence.data.shareMains = false;
        s.pres.setMains({});
        assert.equal(s.pres._answer().mv, undefined);
        assert.deepEqual(s.pres.mainsOf('Quiet'), {});
    } finally { s.stop(); }
});
