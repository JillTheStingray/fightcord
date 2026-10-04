// node --test tests/      (plain Node, no page: the core never touches the DOM at require time)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require('../fightcord-core.js');
const T = core._test;
const { fmt, data } = T;

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fccore-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ----------------------------------------------------------------- fmt */

test('fmt.esc escapes html and quotes', () => {
    assert.equal(fmt.esc('<a href="x">\'&</a>'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
    assert.equal(fmt.esc(null), '');
});

test('fmt.ago buckets', () => {
    const t = 1_700_000_000_000;
    assert.equal(fmt.ago(t - 10e3, t), 'just now');
    assert.equal(fmt.ago(t - 5 * 60e3, t), '5m ago');
    assert.equal(fmt.ago(t - 3 * 3600e3, t), '3h ago');
    assert.equal(fmt.ago(t - 30 * 3600e3, t), 'yesterday');
    assert.equal(fmt.ago(t - 4 * 86400e3, t), '4d ago');
    assert.match(fmt.ago(t - 90 * 86400e3, t), /^\d{4}-\d\d-\d\d$/);
    assert.equal(fmt.ago(0, t), '');
});

test('fmt.duration / clock / short / pct / wl', () => {
    assert.equal(fmt.duration(9000), '9s');
    assert.equal(fmt.duration(12 * 60e3), '12m');
    assert.equal(fmt.duration(65 * 60e3), '1h 05m');
    assert.equal(fmt.clock(75e3), '1:15');
    assert.equal(fmt.clock(3725e3), '1:02:05');
    assert.equal(fmt.short('LongPlayerName1234', 10), 'LongPlaye…');
    assert.equal(fmt.short('Short', 10), 'Short');
    assert.equal(fmt.pct(0.756), '76%');
    assert.equal(fmt.wl({ w: 7, l: 3 }), '7–3');
    assert.equal(fmt.wl({ w: 1, l: 1, d: 2 }), '1–1–2');
});

/* ---------------------------------------------------------------- data */

test('ranks: letters, numbers, colours', () => {
    assert.equal(data.rankLetter(6), 'S');
    assert.equal(data.rankLetter('a'), 'A');
    assert.equal(data.rankLetter(0), '');
    assert.equal(data.rankLetter('Z'), '');
    assert.equal(data.rankNum('B'), 4);
    assert.equal(data.rankNum(3), 3);
    assert.equal(data.rankColor('S'), '#ef5a86');
    assert.equal(data.rankColor(null), '#9aa4b2');
});

test('ranks: Fightcade badge pictures (rank0 = unknown, rank1-6 = E-S)', () => {
    assert.equal(data.rankImg('S'), 'https://web.fightcade.com/static/ranks/rank6.png');
    assert.equal(data.rankImg(1), 'https://web.fightcade.com/static/ranks/rank1.png');
    assert.equal(data.rankImg('?'), 'https://web.fightcade.com/static/ranks/rank0.png');
    assert.equal(data.rankImg(0), 'https://web.fightcade.com/static/ranks/rank0.png');
});

test('urls: art strips fc1_, watch and replay links', () => {
    assert.equal(data.artUrl('fc1_sfiii3nr1', 'https://web.fightcade.com/'), 'https://web.fightcade.com/static/previews/sfiii3nr1.png');
    assert.equal(data.watchUrl({ emu: 'fbneo', rom: 'sfiii3nr1', quark: '123-456', port: 7001 }), 'fcade://stream/fbneo/sfiii3nr1/123-456.2,7001');
    assert.equal(data.watchUrl({ emu: 'fbneo', rom: 'x' }), '');
    assert.equal(data.replayUrl('fbneo', 'sfiii3nr1', 'q1'), 'https://replay.fightcade.com/fbneo/sfiii3nr1/q1');
    assert.match(data.avatarUrl('Bob', '', 48), /gravatar\.com\/avatar\/Bob\?s=48&d=retro&f=y$/);
    assert.match(data.avatarUrl('Bob', 'abc', 48), /avatar\/abc\?s=48&d=retro&r=g$/);
});

test('hashColor is stable', () => {
    assert.equal(data.hashColor('KenjiRival'), data.hashColor('KenjiRival'));
    assert.ok(data.PALETTE.includes(data.hashColor('x')));
});

test('API shape helpers', () => {
    assert.deepEqual(data.pickUser({ user: { name: 'a' } }), { name: 'a' });
    assert.deepEqual(data.pickUser({ results: { results: [{ name: 'b' }] } }), { name: 'b' });
    assert.equal(data.pickUser({}), null);
    assert.deepEqual(data.pickRows({ results: { results: [1, 2] } }), [1, 2]);
    assert.deepEqual(data.pickRows({ results: [3] }), [3]);
    assert.deepEqual(data.pickRows(null), []);
    assert.equal(data.quarkDate({ date: 1_700_000_000 }).getTime(), 1_700_000_000_000);
    assert.equal(data.quarkDate({}), null);
});

test('eloFor: real ELO, band middle, placement on the board', () => {
    assert.deepEqual(data.eloFor('x', 6, null, 2105.4), { elo: 2105, est: false });
    assert.deepEqual(data.eloFor('x', 4, null), { elo: 1450, est: true });
    assert.equal(data.eloFor('x', 0, null), null);
    const board = new Map([
        ['top', { name: 'Top', pos: 1, rank: 5 }],
        ['mid', { name: 'Mid', pos: 2, rank: 5 }],
        ['low', { name: 'Low', pos: 3, rank: 5 }]
    ]);
    assert.deepEqual(data.eloFor('Top', 0, board), { elo: 1900, est: true });
    assert.deepEqual(data.eloFor('Mid', 0, board), { elo: 1750, est: true });
    assert.deepEqual(data.eloFor('Low', 0, board), { elo: 1600, est: true });
    assert.equal(data.fmtElo({ elo: 1750, est: true }), '~1,750');
});

test('winOdds: even match, favourite, FT1 = one game', () => {
    const even = data.winOdds(1500, 1500, 3);
    assert.ok(Math.abs(even.game - 0.5) < 1e-9 && Math.abs(even.set - 0.5) < 1e-9);
    const fav = data.winOdds(1800, 1500, 3);
    assert.ok(fav.set > fav.game && fav.game > 0.5, 'longer sets favour the favourite');
    const ft1 = data.winOdds(1600, 1500, 1);
    assert.ok(Math.abs(ft1.set - ft1.game) < 1e-9);
    // P(win) + P(lose) = 1
    const a = data.winOdds(1700, 1400, 5).set, b = data.winOdds(1400, 1700, 5).set;
    assert.ok(Math.abs(a + b - 1) < 1e-9);
});

test('sessions run 5 AM to 5 AM; clearing starts a new one', () => {
    const late = new Date(2026, 9, 3, 2, 30).getTime();          // 02:30 belongs to the 2nd
    assert.equal(data.sessionStart(late), new Date(2026, 9, 2, 5, 0).getTime());
    const day = new Date(2026, 9, 3, 14, 0).getTime();
    assert.equal(data.sessionStart(day), new Date(2026, 9, 3, 5, 0).getTime());
    const cleared = new Date(2026, 9, 3, 12, 0).getTime();
    assert.equal(data.sessionStart(day, cleared), cleared);
});

test('recordOf / streakOf', () => {
    const s = (r) => ({ result: r });
    const sets = [s('won'), s('lost'), s(null), s('won'), s('won'), s(null)];
    assert.deepEqual(data.recordOf(sets), { w: 3, l: 1, d: 0, unknown: 2, played: 6 });
    assert.deepEqual(data.streakOf(sets), { kind: 'won', n: 2 });
    assert.deepEqual(data.streakOf([s('won'), s('draw'), s('lost')]), { kind: 'lost', n: 1 });
    assert.deepEqual(data.streakOf([]), { kind: null, n: 0 });
    assert.equal(data.winRate({ w: 3, l: 1 }), 0.75);
});

/* -------------------------------------------------------------- config */

test('config: defaults, nested merge, async save, migration, backup + restore', async () => {
    const dir = tmpDir();
    T.setDir(dir);
    fs.writeFileSync(path.join(dir, 'demo-config.json'), JSON.stringify({ a: 5, nested: { x: 9 }, old: true }));
    const owner = T.makeOwner('demo');
    const config = T.configFor(owner);
    const st = config('demo', { a: 1, b: 2, nested: { x: 1, y: 2 } }, {
        version: 2, migrate: (d, from) => { assert.equal(from, 0); delete d.old; d.migrated = true; return d; }
    });
    assert.deepEqual(st.data, { a: 5, b: 2, nested: { x: 9, y: 2 }, migrated: true });
    let notified = 0;
    st.on(() => notified++);
    st.set('b', 3);
    assert.equal(notified, 1);
    await sleep(700);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'demo-config.json'), 'utf8'));
    assert.equal(onDisk.b, 3);
    assert.equal(onDisk._v, 2);
    assert.ok(!fs.existsSync(path.join(dir, 'demo-config.json.tmp')), 'temp file renamed away');

    const backup = T.exportAll();
    assert.ok(backup.files['demo-config.json']);
    st.set('b', 99);
    T.flushStores();
    const n = T.importAll(backup);
    assert.equal(n, 1);
    assert.equal(st.data.b, 3, 'restored values reach the live store');
    assert.throws(() => T.importAll({ nope: 1 }));
    // only *-config.json names are ever written
    T.importAll({ files: { '../evil.json': {}, 'x.js': {} } });
    assert.ok(!fs.existsSync(path.join(dir, 'x.js')));
});

/* ------------------------------------------------------------- history */

test('history: add, merge by quark, update, session, vs, cap', async () => {
    const dir = tmpDir();
    T.setDir(dir);
    const h = T.history;
    const t0 = Date.now();
    h.add({ at: t0 - 1000, opp: 'Ken', result: 'won', quark: 'q1' });
    h.add({ at: t0, opp: 'ken', result: 'lost', quark: 'q2' });
    assert.equal(h.merge([{ at: t0 - 5000, opp: 'Ryu', result: 'won', quark: 'q0' }, { quark: 'q1' }, null]), 1);
    assert.deepEqual(h.all().map(s => s.quark), ['q0', 'q1', 'q2']);
    assert.deepEqual(h.recordVs('KEN'), { w: 1, l: 1, d: 0, unknown: 0, played: 2 });
    assert.ok(h.update('q2', { star: true }));
    assert.equal(h.update('nope', {}), false);
    assert.equal(h.session(t0, t0 - 2000).length, 2);
    h.flush();
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'match-history.json'), 'utf8'));
    assert.equal(disk.v, 2);
    assert.equal(disk.sets.length, 3);
    assert.equal(disk.sets[2].star, true);
    // cap
    const many = Array.from({ length: h.MAX + 10 }, (_, i) => ({ at: i, quark: 'm' + i }));
    h.merge(many);
    assert.equal(h.all().length, h.MAX);
    h.flush();
});

/* ----------------------------------------------------------------- api */

test('api: cache, shared in-flight requests, priority, Cloudflare backoff with stale answers', async () => {
    const calls = [];
    let mode = 'ok';
    globalThis.fetch = async (url, o) => {
        const body = JSON.parse(o.body);
        calls.push(body.username || body.req);
        await sleep(20);
        if (mode === 'cf') return { status: 200, text: async () => '<html>challenge</html>' };
        return { status: 200, text: async () => JSON.stringify({ res: 'OK', user: { name: body.username } }) };
    };
    const api = T.api;
    T.apiState.blockedUntil = 0; T.apiState.fails = 0; api.clearCache();

    const [a, b] = await Promise.all([api.user('Alice'), api.user('Alice')]);
    assert.equal(a.name, 'Alice');
    assert.equal(b.name, 'Alice');
    assert.deepEqual(calls, ['Alice'], 'one fetch for two identical requests');
    await api.user('Alice');
    assert.equal(calls.length, 1, 'cached');

    // a queue of low-priority work; a high-priority request jumps ahead of what's still waiting
    calls.length = 0;
    const lows = ['L1', 'L2', 'L3', 'L4'].map(n => api.user(n, { priority: 'low' }));
    const high = api.user('H', { priority: 'high' });
    await Promise.all(lows.concat(high));
    assert.ok(calls.indexOf('H') < calls.indexOf('L4'), 'high priority went first: ' + calls.join(','));

    // Cloudflare: everyone backs off, cached answers still come back
    mode = 'cf';
    await assert.rejects(api.user('Bob'), /Cloudflare/);
    assert.ok(api.blocked());
    await assert.rejects(api.user('Carol'), /rate limited/);
    assert.equal((await api.user('Alice', { ttl: 0 })).name, 'Alice', 'stale answer while blocked');
    T.apiState.blockedUntil = 0;
    mode = 'ok';
});

test('api: timeouts', async () => {
    globalThis.fetch = (url, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); });
    T.apiState.blockedUntil = 0;
    await assert.rejects(T.api.request({ req: 'slow' }, { timeout: 50, ttl: 0 }), /timed out/);
});

test('api: leaderboard pages into one map', async () => {
    T.api.clearCache();
    globalThis.fetch = async (url, o) => {
        const b = JSON.parse(o.body);
        const rows = b.offset >= 200 ? [] : Array.from({ length: 100 }, (_, i) => ({ name: 'P' + (b.offset + i), gameinfo: { g: { rank: 5, num_matches: 10 } } }));
        return { status: 200, text: async () => JSON.stringify({ results: { results: rows } }) };
    };
    const map = await T.api.leaderboard('g');
    assert.equal(map.size, 200);
    assert.equal(map.get('p150').pos, 151);
    assert.equal(T.api.cachedBoard('g'), map);
});

/* ------------------------------------------------------------- modules */

test('modules: dependency order, legacy plugins, a failing start is isolated', () => {
    T.reset();
    const started = [];
    const M = T.modules;
    M.register('stats.js', { id: 'stats', needs: ['history'], start() { started.push('stats'); return { hi: 1 }; } });
    M.register('broken.js', { id: 'broken', start() { throw new Error('boom'); } });
    M.register('history.js', { id: 'history', start() { started.push('history'); } });
    M.register('old.js', function () { started.push('old'); });
    M.register('needsbroken.js', { id: 'needsbroken', needs: ['broken'], start() { started.push('nb'); } });
    const list = M.startAll({ off: ['nothing.js'] });
    assert.deepEqual(started, ['history', 'stats', 'old']);
    const st = (id) => list.find(m => m.id === id).state;
    assert.equal(st('broken'), 'failed');
    assert.equal(st('needsbroken'), 'off');
    assert.equal(st('old'), 'running');
    assert.deepEqual(M.get('stats'), { hi: 1 });
    assert.equal(typeof M.get('old.js'), 'function');
    assert.equal(M.get('broken'), null);
});

test('modules: 10 errors in a minute switch a module off and undo what it registered', () => {
    T.reset();
    let disposed = 0, stopped = 0;
    T.modules.register('flaky.js', {
        id: 'flaky',
        start(fc) {
            fc.own(() => disposed++);
            fc.on('ping', () => { throw new Error('nope'); });
        },
        stop() { stopped++; }
    });
    T.modules.startAll();
    for (let i = 0; i < 12; i++) T.emit('ping');
    const m = T.modules.list().find(x => x.id === 'flaky');
    assert.equal(m.state, 'failed');
    assert.match(m.error, /kept failing/);
    assert.equal(stopped, 1);
    assert.ok(disposed >= 1);
    assert.equal(T.emit('ping'), 0, 'its listener is gone');
});

test('events: a throwing listener does not stop the others', () => {
    const ev = T.eventsFor(T.makeOwner('core'));
    let got = 0;
    ev.on('x', () => { throw new Error('bad'); });
    ev.on('x', (v) => { got = v; });
    ev.emit('x', 7);
    assert.equal(got, 7);
    let once = 0;
    ev.once('y', () => once++);
    ev.emit('y'); ev.emit('y');
    assert.equal(once, 1);
});

test('tick: one base timer, jobs run when due, disposal', () => {
    const owner = T.makeOwner('t');
    const tick = T.tickFor(owner);
    let n = 0;
    const stop = tick(() => n++, 1000);
    T.tasks.forEach(j => { j.due = 0; });
    T.runTasks();
    assert.equal(n, 1);
    T.runTasks();
    assert.equal(n, 1, 'not due again yet');
    stop();
    T.tasks.forEach(j => { j.due = 0; });
    T.runTasks();
    assert.equal(n, 1);
    T.tasks.clear();
});

/* --------------------------------------------------------------- hooks */

function fakeRoot() {
    const seen = { fc: [], declined: [] };
    const r = {
        _data: { global: { localUser: { name: 'Me' } } }, globalUsers: {},
        connectionCallbacks: { onChallengeRequest(user, ch, id, ranked) { seen.fc.push([user.name, ranked]); } },
        declineChallenge(ch, user, id) { seen.declined.push([user.name, id]); }
    };
    return { r, seen };
}

test('challenge pipeline: filters decline before Fightcade, after-handlers run after it', () => {
    T.reset();
    const { r, seen } = fakeRoot();
    T.setRoot(r);
    const owner = T.makeOwner('ch');
    const hooks = T.hooksFor(owner);
    const order = [];
    hooks.challenge((ctx) => { order.push('filter'); if (ctx.name === 'Troll') ctx.decline('blocked'); }, { phase: 'filter' });
    hooks.challenge((ctx) => { order.push('after:' + ctx.ft); });
    r.connectionCallbacks.onChallengeRequest({ name: 'Troll', id: 't' }, 'chan', 1, 3);
    assert.deepEqual(seen.fc, []);
    assert.deepEqual(seen.declined, [['Troll', 1]]);
    r.connectionCallbacks.onChallengeRequest({ name: 'Friend' }, 'chan', 2, 5);
    assert.deepEqual(seen.fc, [['Friend', 5]]);
    assert.deepEqual(order, ['filter', 'filter', 'after:5']);
    // challenges you send yourself skip the pipeline
    r.connectionCallbacks.onChallengeRequest({ name: 'Me' }, 'chan', 3, 3);
    assert.deepEqual(order, ['filter', 'filter', 'after:5']);
});

test('challenge pipeline: never fights another wrapper, re-hooks when Fightcade replaces it', () => {
    T.reset();
    const { r, seen } = fakeRoot();
    T.setRoot(r);
    T.hooksFor(T.makeOwner('ch2')).challenge(() => {});
    // a rival that also insists on being outermost (re-wraps whenever it isn't on top)
    let rival = null;
    const rivalHook = () => {
        const cbs = r.connectionCallbacks;
        if (cbs.onChallengeRequest === rival) return;
        const prev = cbs.onChallengeRequest;
        const w = function () { return prev.apply(this, arguments); };
        w.__fcPrev = prev;
        cbs.onChallengeRequest = rival = w;
    };
    for (let i = 0; i < 50; i++) { rivalHook(); T.installChallengeHook(); }
    let depth = 0;
    for (let fn = r.connectionCallbacks.onChallengeRequest; fn; fn = fn.__fcPrev) depth++;
    assert.ok(depth < 12, 'chain stayed short: ' + depth);
    r.connectionCallbacks.onChallengeRequest({ name: 'X' }, 'c', 1, 3);
    assert.equal(seen.fc.length, 1, 'Fightcade saw it exactly once');
    // Fightcade replaces the callbacks object: we hook the new one
    r.connectionCallbacks = { onChallengeRequest() { seen.fc.push(['new']); } };
    T.installChallengeHook();
    assert.ok(r.connectionCallbacks.onChallengeRequest.__fcCore);
});

test('diagnostics text lists modules and problems', () => {
    const txt = T.diagText();
    assert.match(txt, /Modules:/);
    assert.match(txt, /Recent problems:/);
});
