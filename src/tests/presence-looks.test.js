// 3.7 profile looks: your own avatar/banner pictures, theme colours, a frame and pronouns.
// The pure rules, then presence.js end to end: signed by the Fightcord ID, pinned per name,
// remembered while that player is away, and 3.6 still reading the text part.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const P = require('../presence.js');
const V = require('../voice.js');
const LK = require('../profile-looks.js');

const PIC = 'https://blossom.primal.net/' + 'a'.repeat(64) + '.webp';
const GIF = 'https://blossom.primal.net/' + 'b'.repeat(64) + '.gif';
const STILL = 'https://files.catbox.moe/abc123.webp';

test('looks: pictures only from the picture hosts, colours, frames and pronouns cleaned', () => {
    assert.equal(P.picUrl(PIC), PIC);
    assert.equal(P.picUrl(STILL), STILL);
    assert.equal(P.picUrl('http://blossom.primal.net/x.png'), '', 'https only');
    assert.equal(P.picUrl('https://evil.example/x.png'), '', 'not a picture host');
    assert.equal(P.picUrl('https://blossom.primal.net.evil.example/x.png'), '');
    assert.equal(P.picUrl('https://uguu.se/abc.png'), '', 'uguu deletes files after hours');
    assert.equal(P.picUrl('https://files.catbox.moe/a".png'), '');
    assert.equal(P.picUrl('https://files.catbox.moe/' + 'x'.repeat(300)), '');
    const l = P.cleanLook({ av: { u: GIF, s: STILL }, bn: { u: 'https://evil.example/b.png' }, th: ['#AABBCC', '#000000'], fr: 'flame', pn: '  she/her ‮  ' });
    assert.deepEqual(l, { av: { u: GIF, s: STILL }, th: ['#aabbcc', '#000000'], fr: 'flame', pn: 'she/her' });
    assert.deepEqual(P.cleanLook({ th: ['#abc', '#000000'], fr: 'sparkles', pn: 'x'.repeat(80), av: { u: PIC, s: PIC } }), { av: { u: PIC }, pn: 'x'.repeat(40) });
    assert.deepEqual(P.cleanLook({ th: ['#000000'] }), {});
});

test('versions: the text part keeps its 3.6 version, the looks have their own', () => {
    const text = { s: 'FT5s', a: 'Ken main', b: 'sfiii3nr1', bd: [] };
    const both = Object.assign({}, text, { av: { u: PIC }, fr: 'gold' });
    assert.equal(P.profileVersion(both), P.profileVersion(text), 'older Fightcords still accept it (they drop what they don’t know)');
    assert.notEqual(P.lookVersion(both), P.lookVersion(text));
    assert.notEqual(P.lookVersion(both), P.lookVersion(Object.assign({}, both, { fr: 'neon' })));
    assert.ok(P.hasLook(both) && !P.hasLook(text));
});

test('pinning: a friend only from their ID; anyone else from the first ID, another after 30 quiet days', () => {
    const a = 'a'.repeat(64), b = 'b'.repeat(64), DAY = 86400000;
    assert.equal(P.mayLook(null, a, '', 0), true, 'first seen');
    assert.equal(P.mayLook({ dk: a, at: 0 }, a, '', DAY), true);
    assert.equal(P.mayLook({ dk: a, at: 0 }, b, '', DAY), false, 'someone else using that name');
    assert.equal(P.mayLook({ dk: a, at: 0 }, b, '', 31 * DAY), true, 'a new PC, a month later');
    assert.equal(P.mayLook(null, b, a, 0), false, 'a friend: only the ID you accepted');
    assert.equal(P.mayLook({ dk: b, at: 0 }, a, a, DAY), true);
    assert.equal(P.mayLook(null, 'nope', '', 0), false);
});

test('theme colours: text that reads on them; Fightcade pictures back to their owners', () => {
    assert.equal(LK.themeVars(['#101010', '#3a0ca3'])['--fc-head'], '#ffffff');
    assert.equal(LK.themeVars(['#f1f1f1', '#ffffff'])['--fc-head'], '#0e0f12');
    assert.equal(LK.themeVars(null), null);
    const map = new Map([['abcdef', 'Ken']]);
    assert.equal(LK.nameFromSrc('https://www.gravatar.com/avatar/ABCDEF?s=40&d=retro&r=g', map), 'Ken');
    assert.equal(LK.nameFromSrc('https://www.gravatar.com/avatar/Ryu?s=40&d=retro&f=y', map), 'Ryu', 'no gravatar: the name is the picture');
    assert.equal(LK.nameFromSrc('https://www.gravatar.com/avatar/zzz?s=40&d=retro&r=g', map), '');
    assert.equal(LK.nameFromSrc('https://example.com/x.png', map), '');
});

/* ------------------------------------------------- presence.js end to end */

const K = (s) => crypto.createHash('sha256').update('looks-test|' + s).digest();
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
// a fresh presence.js for one player (offline: no relay socket)
function client(me, stores, mods) {
    delete require.cache[require.resolve('../presence.js')];
    const pres = require('../presence.js');
    const f = fakeFc(me, stores || {}, mods || {});
    const real = global.WebSocket;
    global.WebSocket = function () { return { readyState: 0, send() {}, close() {}, addEventListener() {} }; };
    try { pres.start(f.fc); } finally { global.WebSocket = real; }
    return { pres, fc: f.fc, stop: f.stop };
}
// what a player with that ID key says: "here", then the signed answer
function says(name, sk, p) {
    const h = P.hashOf(name), dk = V.pubkey(sk).toString('hex');
    const full = P.cleanFull(p);
    const pv = P.profileVersion(full), lv = P.hasLook(full) ? P.lookVersion(full) : '';
    const sig = lv ? V.sign(crypto.createHash('sha256').update(P.lookMsg(h, lv)).digest(), sk, crypto.randomBytes(32)).toString('hex') : '';
    return { here: { t: 'here', h, voice: 0, pv, lv, dk }, prof: { t: 'prof', h, pv, lv, sig, p: full } };
}

test('end to end: signed looks show; someone else on that name gets the text only; still there while they’re away', () => {
    const stores = {};
    const me = client('Viewer', stores);
    try {
        const ken = K('ken');
        const look = { s: 'FT10 anyone', av: { u: GIF, s: STILL }, bn: { u: PIC }, th: ['#5865f2', '#eb459e'], fr: 'flame', pn: 'he/him' };
        const k = says('Ken', ken, look);
        me.pres._msg(k.here);
        assert.equal(me.pres.profile('Ken'), null, 'asked, not known yet');
        me.pres._msg(k.prof);
        const p = me.pres.profile('Ken');
        assert.deepEqual([p.s, p.av, p.fr, p.pn, p.th], ['FT10 anyone', { u: GIF, s: STILL }, 'flame', 'he/him', ['#5865f2', '#eb459e']]);
        assert.equal(me.pres.animOf(STILL), GIF, 'the GIF plays on hover');
        assert.match(me.pres.bannerFor('Ken'), /blossom\.primal\.net/);

        // a forged signature: the text, never the pictures
        const bad = says('Ryu', K('ryu'), look);
        bad.prof.sig = says('Ryu', K('other'), look).prof.sig;
        me.pres._msg(bad.here); me.pres._msg(bad.prof);
        const r = me.pres.profile('Ryu');
        assert.equal(r.s, 'FT10 anyone');
        assert.equal(r.av, undefined);

        // another Fightcord on Ken's name (a different ID): no pictures from it
        const fake = says('Ken', K('impostor'), Object.assign({}, look, { av: { u: PIC }, s: 'hi' }));
        me.pres._msg(fake.here); me.pres._msg(fake.prof);
        const f = me.pres.profile('Ken');
        assert.equal(f.av, undefined, 'pinned to the first ID');
        assert.equal(f.s, 'hi');

        // Ken comes back: his again; then he goes offline: still his
        me.pres._msg(k.here); me.pres._msg(k.prof);
        assert.deepEqual(me.pres.profile('Ken').av, { u: GIF, s: STILL });
        me.pres._forget('Ken');
        assert.deepEqual(me.pres.profile('Ken').av, { u: GIF, s: STILL }, 'remembered while away');
        // pictures off, or Ken hidden: gone
        stores.presence.data.showPics = false;
        assert.equal(me.pres.profile('Ken').av, undefined);
        assert.equal(me.pres.profile('Ken').fr, 'flame', 'the rest stays');
        stores.presence.data.showPics = true;
        me.pres.hideProfile('Ken', true);
        assert.equal(me.pres.profile('Ken'), null);
        me.pres.hideProfile('Ken', false);
    } finally { me.stop(); }

    // the next start: remembered from disk
    const again = client('Viewer', stores);
    try {
        assert.deepEqual(again.pres.profile('Ken').av, { u: GIF, s: STILL });
        assert.equal(again.pres.animOf(STILL), GIF);
    } finally { again.stop(); }
});

test('end to end: a friend’s looks only from the ID you accepted', () => {
    const friendKey = K('friend'), dk = V.pubkey(friendKey).toString('hex');
    const mods = { dms: { friends: () => [{ n: 'Chun', pk: dk }] } };
    const me = client('Viewer2', {}, mods);
    try {
        const other = says('Chun', K('not-chun'), { av: { u: PIC } });
        me.pres._msg(other.here); me.pres._msg(other.prof);
        assert.equal(me.pres.profile('Chun'), null, 'no text, and the pictures aren’t from her ID');
        const real = says('Chun', friendKey, { av: { u: PIC }, pn: 'she/her' });
        me.pres._msg(real.here); me.pres._msg(real.prof);
        assert.equal(me.pres.profile('Chun').pn, 'she/her');
    } finally { me.stop(); }
});

test('end to end: your answer is signed with your Fightcord ID; another Fightcord takes it, a 3.6 one reads its text', () => {
    const sk = K('me');
    const lobbies = { myId: () => V.pubkey(sk).toString('hex'), signId: (msg) => V.sign(msg, sk, crypto.randomBytes(32)).toString('hex') };
    const sender = client('Sender', {}, { lobbies });
    let ans;
    try {
        sender.pres.setProfile({ s: 'online', av: { u: PIC }, th: ['#000000', '#ffffff'], fr: 'neon', pn: 'they/them' });
        const mine = sender.pres.myProfile();
        assert.deepEqual([mine.fr, mine.pn], ['neon', 'they/them']);
        ans = sender.pres._answer();
    } finally { sender.stop(); }
    assert.equal(ans.dk, V.pubkey(sk).toString('hex'));
    assert.match(ans.sig, /^[0-9a-f]{128}$/);
    // someone with 3.7: the "here" (pv, lv, dk), then the answer
    const viewer = client('Viewer3', {});
    try {
        viewer.pres._msg({ t: 'here', h: ans.h, voice: 0, pv: ans.pv, lv: ans.lv, dk: ans.dk });
        viewer.pres._msg(ans);
        const p = viewer.pres.profile('Sender');
        assert.deepEqual([p.s, p.av, p.fr, p.pn], ['online', { u: PIC }, 'neon', 'they/them']);
    } finally { viewer.stop(); }
    // a 3.6 Fightcord: cleanProfile drops the looks, and the text's version still matches pv
    assert.equal(P.profileVersion(P.cleanProfile(ans.p)), ans.pv);
});

/* ------------------------------------------- 3.9: name styles and decorations */

test('extras: known styles and decorations only, colours that read on a dark panel', () => {
    assert.deepEqual(P.cleanExtras({ ns: { s: 'gradient', c: ['#FF73FA', '#7af0ff'] }, dc: 'crown' }), { ns: { s: 'gradient', c: ['#ff73fa', '#7af0ff'] }, dc: 'crown' });
    assert.deepEqual(P.cleanExtras({ ns: { s: 'fire', c: ['#000000'] } }), { ns: { s: 'fire' } }, 'fire brings its own colours');
    assert.deepEqual(P.cleanExtras({ ns: { s: 'gradient', c: ['#ff73fa', '#101010'] } }), {}, 'too dark to read');
    assert.deepEqual(P.cleanExtras({ ns: { s: 'comic-sans', c: ['#ffffff', '#ffffff'] }, dc: 'tophat' }), {}, 'unknown ones');
    assert.deepEqual(P.cleanExtras({ ns: { s: 'neon', c: ['#ffffff'] } }), {}, 'two colours');
    assert.deepEqual(P.cleanExtras(null), {});
    assert.equal(P.extrasVersion({}), '');
    assert.notEqual(P.extrasVersion({ dc: 'crown' }), P.extrasVersion({ dc: 'halo' }));
});

function signedSender(name, sk, profile) {
    const lobbies = { myId: () => V.pubkey(sk).toString('hex'), signId: (msg) => V.sign(msg, sk, crypto.randomBytes(32)).toString('hex') };
    const s = client(name, {}, { lobbies });
    try { s.pres.setProfile(profile); return s.pres._answer(); } finally { s.stop(); }
}

test('end to end: a 3.9 sender’s extras are signed on their own; 3.8 still sees the pictures', () => {
    const sk = K('styled');
    const ans = signedSender('Styled', sk, { s: 'hi', av: { u: PIC }, fr: 'gold', ns: { s: 'neon', c: ['#7af0ff', '#ff73fa'] }, dc: 'halo' });
    assert.match(ans.xv, /^[0-9a-f]{8}$/);
    assert.match(ans.xsig, /^[0-9a-f]{128}$/);
    // what 3.7 / 3.8 work out: the looks' version from the fields they know -- it still matches
    assert.equal(P.lookVersion(P.cleanFull(ans.p)), ans.lv, '3.8 keeps showing the pictures');
    // a 3.9 viewer: all of it
    const v = client('Viewer4', {});
    try {
        v.pres._msg({ t: 'here', h: ans.h, voice: 0, pv: ans.pv, lv: ans.lv, xv: ans.xv, dk: ans.dk });
        v.pres._msg(ans);
        const p = v.pres.profile('Styled');
        assert.deepEqual([p.av, p.fr, p.ns, p.dc], [{ u: PIC }, 'gold', { s: 'neon', c: ['#7af0ff', '#ff73fa'] }, 'halo']);
    } finally { v.stop(); }
    // a "here" without xv (how 3.8 announces): the looks, no extras
    const old = client('Viewer5', {});
    try {
        old.pres._msg({ t: 'here', h: ans.h, voice: 0, pv: ans.pv, lv: ans.lv, dk: ans.dk });
        old.pres._msg(Object.assign({}, ans, { xv: undefined, xsig: undefined }));
        const p = old.pres.profile('Styled');
        assert.deepEqual([p.av, p.ns, p.dc], [{ u: PIC }, undefined, undefined]);
    } finally { old.stop(); }
});

test('end to end: someone with only a name style (no pictures, no text) still shows it', () => {
    const ans = signedSender('JustStyle', K('juststyle'), { ns: { s: 'rainbow' } });
    assert.equal(ans.lv, '', 'nothing for 3.8 to show');
    const v = client('Viewer7', {});
    try {
        v.pres._msg({ t: 'here', h: ans.h, voice: 0, pv: ans.pv, lv: ans.lv, xv: ans.xv, dk: ans.dk });
        v.pres._msg(ans);
        assert.deepEqual(v.pres.profile('JustStyle').ns, { s: 'rainbow' });
    } finally { v.stop(); }
});

test('end to end: extras with a forged signature, or from another ID on that name, are dropped', () => {
    const real = signedSender('Rose', K('rose'), { av: { u: PIC }, dc: 'crown' });
    const other = signedSender('Rose', K('impostor'), { av: { u: PIC }, dc: 'horns' });
    const v = client('Viewer6', {});
    try {
        // a forged extras signature: the looks stay, the decoration doesn't
        v.pres._msg({ t: 'here', h: real.h, voice: 0, pv: real.pv, lv: real.lv, xv: real.xv, dk: real.dk });
        v.pres._msg(Object.assign({}, real, { xsig: other.xsig }));
        let p = v.pres.profile('Rose');
        assert.deepEqual([p.av, p.dc], [{ u: PIC }, undefined]);
        // the real one
        v.pres._msg(real);
        assert.equal(v.pres.profile('Rose').dc, 'crown');
        // someone else's Fightcord on Rose's name, properly signed with its own ID: not Rose's pin
        v.pres._msg({ t: 'here', h: other.h, voice: 0, pv: other.pv, lv: other.lv, xv: other.xv, dk: other.dk });
        v.pres._msg(other);
        p = v.pres.profile('Rose');
        assert.ok(!p || p.dc !== 'horns', 'not from an ID that isn’t pinned to that name');
    } finally { v.stop(); }
});
