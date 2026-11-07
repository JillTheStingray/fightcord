// node --test tests/      Fightcord player count (headcount.js): marks, the tally, reading relays page by page
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const h = require('../headcount.js');

const NOW = h.SINCE + 40 * 86400;                 // seconds
const key = () => { let k; do { k = crypto.randomBytes(32); } while (k[0] === 0xff); return k; };

test('bitsOf counts leading zero bits of a hex id', () => {
    assert.equal(h.bitsOf('ffff'), 0);
    assert.equal(h.bitsOf('7fff'), 1);
    assert.equal(h.bitsOf('0fff'), 4);
    assert.equal(h.bitsOf('0001'), 15);
    assert.equal(h.bitsOf('0000'), 16);
});

test('a mark: the work is done, it checks out, and anything tampered with does not', async () => {
    const ev = await h.makeMark(key(), NOW, h.POW);
    assert.equal(ev.kind, h.KIND);
    assert.ok(h.bitsOf(ev.id) >= h.POW);
    assert.equal(ev.content, '');
    assert.deepEqual(ev.tags.slice(0, 2), [['d', h.D], ['t', h.TOPIC]]);
    assert.equal(h.validMark(ev, NOW), true);
    assert.equal(h.validMark(Object.assign({}, ev, { created_at: ev.created_at + 1 }), NOW), false, 'id no longer matches');
    assert.equal(h.validMark(Object.assign({}, ev, { kind: 1 }), NOW), false);
    assert.equal(h.validMark(ev, h.SINCE - 86400), false, 'from the future');
    const old = await h.makeMark(key(), h.SINCE - 10, h.POW);
    assert.equal(h.validMark(old, NOW), false, 'older than the feature');
    const lazy = await h.makeMark(key(), NOW, 4);
    if (h.bitsOf(lazy.id) < h.POW) assert.equal(h.validMark(lazy, NOW), false, 'not enough work');
    assert.equal(h.validMark(null, NOW), false);
    assert.equal(h.validMark({ kind: h.KIND, pubkey: 'x', id: 'y', tags: 5 }, NOW), false);
});

test('tally: each key once (its newest mark), this month = marked in the last 30 days, you count too', () => {
    const m = (pk, at) => ({ pubkey: pk, created_at: at });
    const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
    const marks = [m(a, NOW - 40 * 86400), m(a, NOW - 86400), m(a, NOW - 86400), m(b, NOW - 31 * 86400), m(c, NOW)];
    assert.deepEqual(h.tally(marks, NOW), { total: 3, month: 2 });
    assert.deepEqual(h.tally(marks, NOW, { pk: b, at: NOW }), { total: 3, month: 3 }, 'your fresh mark, even if no relay took it');
    assert.deepEqual(h.tally([], NOW, { pk: a, at: NOW }), { total: 1, month: 1 });
    assert.deepEqual(h.tally([], NOW), { total: 0, month: 0 });
});

test('due: a fresh mark every few days, and after a clock jump', () => {
    const now = Date.now();
    assert.equal(h.due({}, now), true);
    assert.equal(h.due({ pubAt: now - 86400000 }, now), false);
    assert.equal(h.due({ pubAt: now - 4 * 86400000 }, now), true);
    assert.equal(h.due({ pubAt: now + 86400000 }, now), true);
});

// a relay in memory: stores what it's sent (replaceable: newest per key), answers REQ newest first, capped
function fakeRelays(cap, opts) {
    const o = opts || {};
    const stores = {};
    class WS {
        constructor(url) {
            this.url = url; this.readyState = 0;
            const st = stores[url] = stores[url] || new Map();
            this.st = st;
            setTimeout(() => {
                if (o.down && o.down.includes(url)) { this.readyState = 3; if (this.onclose) this.onclose(); return; }
                this.readyState = 1; if (this.onopen) this.onopen();
            }, 1);
        }
        send(raw) {
            const d = JSON.parse(raw);
            if (d[0] === 'EVENT') {
                const ev = d[1], key = ev.pubkey + '|' + ev.kind;
                const old = this.st.get(key);
                if (!old || old.created_at < ev.created_at) this.st.set(key, ev);
            } else if (d[0] === 'REQ') {
                const f = d[2];
                const all = Array.from(this.st.values()).filter(ev => ev.kind === f.kinds[0] && ev.tags.some(t => t[0] === 't' && t[1] === f['#t'][0]) && (!f.until || ev.created_at <= f.until))
                    .sort((x, y) => y.created_at - x.created_at).slice(0, Math.min(cap, f.limit));
                setTimeout(() => {
                    all.forEach(ev => this.onmessage && this.onmessage({ data: JSON.stringify(['EVENT', d[1], ev]) }));
                    if (this.onmessage) this.onmessage({ data: JSON.stringify(['EOSE', d[1]]) });
                }, 1);
            }
        }
        close() { this.readyState = 3; }
    }
    return { WS, stores };
}

test('count: pages back past a relay cap, merges relays, ignores junk, a down relay is fine', async () => {
    const R = fakeRelays(7, { down: ['wss://c'] });
    const relays = ['wss://a', 'wss://b', 'wss://c'];
    const marks = [];
    for (let i = 0; i < 23; i++) marks.push(await h.makeMark(key(), NOW - i * 3600, h.POW));
    // a and b each hold part of them (overlapping), plus junk
    const put = (url, ev) => { (R.stores[url] = R.stores[url] || new Map()).set(ev.pubkey + '|' + ev.kind, ev); };
    marks.forEach((ev, i) => { if (i < 15) put('wss://a', ev); if (i >= 10) put('wss://b', ev); });
    put('wss://a', Object.assign({}, marks[0], { pubkey: 'f'.repeat(64) }));             // a forged copy: id doesn't match
    const r = await h.count({ WS: R.WS, now: NOW * 1000, relays, wait: 3000 });
    assert.equal(r.total, 23);
    assert.equal(r.month, 23);
    assert.equal(r.relays, 2);
});

test('count: your mark goes to every relay, and counts', async () => {
    const R = fakeRelays(500);
    const sk = key();
    const mark = await h.makeMark(sk, NOW, h.POW);
    const r = await h.count({ WS: R.WS, now: NOW * 1000, relays: ['wss://a', 'wss://b'], mark, wait: 3000 });
    assert.equal(r.total, 1);
    assert.equal(R.stores['wss://a'].size, 1);
    assert.equal(R.stores['wss://b'].size, 1);
    // a newer mark replaces the old one: still one person
    const again = await h.makeMark(sk, NOW + 60, h.POW);
    const r2 = await h.count({ WS: R.WS, now: (NOW + 60) * 1000, relays: ['wss://a', 'wss://b'], mark: again, wait: 3000 });
    assert.equal(r2.total, 1);
});

test('count: no relay answers -> relays 0 (the module keeps its last number)', async () => {
    const R = fakeRelays(500, { down: ['wss://a'] });
    const r = await h.count({ WS: R.WS, now: NOW * 1000, relays: ['wss://a'], wait: 500 });
    assert.deepEqual(r, { total: 0, month: 0, relays: 0 });
});
