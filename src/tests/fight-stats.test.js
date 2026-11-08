'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const F = require('../fight-stats.js');
const G = require('../goals.js');

const at = (day, hour) => new Date(2026, 10, 4 + day, hour).getTime();      // 2026-11-04 is a Wednesday

test('reader lines: JSON events only', () => {
    assert.deepEqual(F.parseLine('{"e":"parry","p":1,"f":20091}\r'), { e: 'parry', p: 1, f: 20091 });
    assert.equal(F.parseLine(''), null);
    assert.equal(F.parseLine('Add-Type : error'), null);
    assert.equal(F.parseLine('{"x":1}'), null);
    assert.equal(F.parseLine('{broken'), null);
});

test('your side from the emulator files', () => {
    const m = { p1: { name: 'Alpha' }, p2: { name: 'Beta' } };
    assert.equal(F.sideOf(m, 'alpha'), 1);
    assert.equal(F.sideOf(m, 'BETA'), 2);
    assert.equal(F.sideOf(m, 'gamma'), 0, 'spectating or someone else');
    assert.equal(F.sideOf(null, 'alpha'), 0);
});

test('count and prune', () => {
    const ev = [{ at: at(0, 20), k: 'parry' }, { at: at(0, 21), k: 'parry' }, { at: at(0, 21), k: 'red' }, { at: at(-20, 21), k: 'parry' }, { at: at(0, 21), k: 'junk' }];
    assert.equal(F.count(ev, 'parry', at(0, 5)), 2);
    assert.equal(F.count(ev, 'parry', 0), 3);
    const kept = F.prune(ev, at(0, 22));
    assert.equal(kept.length, 3, 'old ones and unknown kinds go');
    const many = Array.from({ length: 7000 }, (x, i) => ({ at: at(0, 20) + i, k: 'parry' }));
    assert.equal(F.prune(many, at(0, 22)).length, 6000);
});

test('goals: parries, red parries, supers and perfect rounds', () => {
    const now = at(0, 22);
    const ev = [{ at: at(0, 20), k: 'parry' }, { at: at(0, 20), k: 'parry' }, { at: at(0, 20), k: 'red' }, { at: at(0, 21), k: 'super' },
        { at: at(0, 21), k: 'perfect' }, { at: at(-1, 21), k: 'parry' }];
    const r = G.evaluate({ type: 'parries', target: 3, scope: 'day' }, [], now, 0, ev);
    assert.equal(r.value, 2);
    assert.equal(r.done, false);
    assert.equal(r.text, 'Parry 3 times');
    assert.equal(r.detail, '2 / 3 parries');
    assert.equal(G.evaluate({ type: 'parries', target: 3, scope: 'week' }, [], now, 0, ev).done, true, 'Monday counts this week');
    assert.equal(G.evaluate({ type: 'reds', target: 1, scope: 'day' }, [], now, 0, ev).done, true);
    assert.equal(G.evaluate({ type: 'reds', target: 1, scope: 'day' }, [], now, 0, ev).text, 'Red parry 1 time');
    assert.equal(G.evaluate({ type: 'supers', target: 2, scope: 'day' }, [], now, 0, ev).value, 1);
    assert.equal(G.evaluate({ type: 'perfects', target: 1, scope: 'session' }, [], now, at(0, 21) + 1, ev).value, 0, 'a cleared session starts again');
    assert.equal(G.evaluate({ type: 'perfects', target: 1, scope: 'day' }, [], now, 0).value, 0, 'no fight stats yet');
    assert.ok(G.isFight('parries') && !G.isFight('wins'));
});

// the reader, fed lines by hand: only your side is kept, and only once your side is known
test('fight-stats module keeps your side only', () => {
    const saved = [];
    const events = [];
    let match = null;
    const fake = {
        config: () => ({ data: { enabled: true, events: [], base: null, status: null }, save: () => saved.push(1) }),
        on: () => {}, tick: () => {}, own: () => {}, log: () => {},
        emit: (name, ev) => events.push(ev),
        settings: { refresh: () => {} },
        modules: { get: () => null },
        emu: { match: () => match },
        app: { me: () => 'Alpha' }
    };
    const api = F.start(fake);
    // no reader running: lines are ignored
    api._line('{"e":"parry","p":1}');
    assert.equal(api.events().length, 0);
    // a match: the emulator's files aren't there yet, so events wait
    api._fake('q1');
    api._line('{"e":"ready","off":123}');
    assert.equal(api.status().ok, true);
    api._line('{"e":"parry","p":2,"f":10}');
    api._line('{"e":"parry","p":1,"f":20}');
    assert.equal(api.events().length, 0, 'side not known yet');
    match = { p1: { name: 'Beta' }, p2: { name: 'alpha' } };          // you're player 2
    api._line('{"e":"red","p":2,"f":30}');
    assert.deepEqual(api.events().map(e => e.k), ['parry', 'red'], 'only player 2’s, in order');
    assert.equal(events.length, 2);
    api._line('{"e":"super","p":1,"f":40}');
    api._end();
    assert.equal(api.events().length, 2, 'the opponent’s super isn’t yours');
    // a match where you never show up in the files (spectating): nothing is kept
    match = { p1: { name: 'Beta' }, p2: { name: 'Gamma' } };
    api._fake('q2');
    api._line('{"e":"parry","p":1,"f":50}');
    api._end();
    assert.equal(api.events().length, 2);
});

test('the reader compiles (Windows PowerShell)', { skip: process.platform !== 'win32' }, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'fight-stats.js'), 'utf8');
    const cs = /String\.raw`([\s\S]*?)`;/.exec(src)[1];
    assert.ok(/PROCESS_VM_READ|VM_READ = 0x0010/.test(cs), 'opens for reading only');
    assert.ok(!/WriteProcessMemory|VirtualProtectEx|CreateRemoteThread/.test(cs), 'never writes to the emulator');
    const f = path.join(os.tmpdir(), 'fcfr-test-' + process.pid + '.cs');
    fs.writeFileSync(f, cs);
    try {
        const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -Path '" + f + "'; [FcFightReader].FullName"], { encoding: 'utf8', timeout: 60000, windowsHide: true });
        assert.equal(out.trim(), 'FcFightReader');
    } finally { fs.unlinkSync(f); }
});

// 3.11.1: the emulator closes at the end of every set; a reader that counted and then exits isn't a failure
test('a reader that worked and then exits is not reported as a failure', () => {
    const EventEmitter = require('events');
    const cpMod = require('child_process');
    const realSpawn = cpMod.spawn;
    const kids = [];
    cpMod.spawn = () => {
        const k = new EventEmitter();
        k.stdout = new EventEmitter(); k.stderr = new EventEmitter();
        k.stdin = { end() {} }; k.kill = () => {};
        kids.push(k);
        return k;
    };
    try {
        const handlers = {};
        const data = { enabled: true, events: [], base: null, status: null };
        const fake = {
            config: () => ({ data, save() {} }),
            on: (n, fn) => { handlers[n] = fn; }, tick() {}, own() {}, log: Object.assign(() => {}, { warn() {} }),
            emit() {}, settings: { refresh() {} },
            modules: { get: (id) => (id === 'goals' ? { wantsFight: () => true } : null) },
            emu: { match: () => ({ p1: { name: 'Me' }, p2: { name: 'Them' } }) },
            app: { me: () => 'Me' }
        };
        const F2 = require('../fight-stats.js');
        F2.start(fake);
        // a set: the reader finds the game, counts a parry, then the emulator closes and it exits with 1
        handlers['match:start']({ quark: 'q1', rom: 'sfiii3nr1' });
        const k = kids[0];
        k.stdout.emit('data', '{"e":"ready","off":112691444}\n{"e":"parry","p":1,"f":10}\n');
        k.stderr.emit('data', 'Exception calling "Run": Only part of a ReadProcessMemory request was completed');
        k.emit('exit', 1);
        assert.equal(data.status.ok, true, 'still fine');
        assert.equal(data.events.length, 1);
        // a reader that dies before it finds the game: that is a failure, with what PowerShell said
        handlers['match:start']({ quark: 'q2', rom: 'sfiii3nr1' });
        const k2 = kids[1];
        k2.stderr.emit('data', 'Add-Type : Cannot add type. Compilation errors occurred.');
        k2.emit('exit', 1);
        assert.equal(data.status.ok, false);
        assert.equal(data.status.msg, 'compile');
        assert.ok(/Compilation errors/.test(data.status.detail));
    } finally {
        cpMod.spawn = realSpawn;
        // (starting a set writes fight-reader.cs next to the module: not in the project)
        try { fs.unlinkSync(path.join(__dirname, '..', 'fight-reader.cs')); } catch (e) { /* not written */ }
    }
});

// 3.13.1: when nothing counted, the status says why
test('fight-stats says why a match counted nothing', () => {
    const data = { enabled: true, events: [], base: null, status: null };
    let match = { p1: { name: 'Beta' }, p2: { name: 'Gamma' } };
    const fake = {
        config: () => ({ data, save() {} }), on() {}, tick() {}, own() {}, log() {}, emit() {},
        t: (s, v) => String(s).replace(/\{(\w+)\}/g,(m, k) => (v && v[k] != null ? v[k] : m)),
        settings: { refresh() {} }, modules: { get: () => null }, emu: { match: () => match }, app: { me: () => 'Alpha' }
    };
    const api = F.start(fake);
    api._fake('q1'); api._line('{"e":"ready","off":1}'); api._line('{"e":"parry","p":1,"f":5}'); api._line('{"e":"round","l1":1,"l2":0}'); api._end();
    assert.equal(data.status.ok, false);
    assert.equal(data.status.msg, 'side');
    assert.equal(data.status.n, 1);
    assert.match(data.status.detail, /Beta vs Gamma; on Fightcade you’re Alpha/);
    match = null;
    api._fake('q2'); api._line('{"e":"ready","off":1}'); api._line('{"e":"parry","p":1,"f":5}'); api._end();
    assert.match(data.status.detail, /didn’t leave a match file/);
    api._fake('q3'); api._line('{"e":"ready","off":1}'); api._end();
    assert.equal(data.status.msg, 'norounds');
    match = { p1: { name: 'alpha' }, p2: { name: 'Beta' } };
    api._fake('q4'); api._line('{"e":"ready","off":1}'); api._line('{"e":"round","l1":1,"l2":0}'); api._line('{"e":"parry","p":1,"f":5}'); api._line('{"e":"parry","p":2,"f":6}'); api._end();
    assert.deepEqual([data.status.ok, data.status.msg, data.status.n, data.status.rounds], [true, 'counted', 1, 1]);
    assert.equal(data.status.theirs, 1, 'your opponent’s count is kept for the diagnostics');
    // 3.14.3: a reader that never found the game always leaves a reason
    api._fake('q5'); api._end();
    assert.equal(data.status.msg, 'noemu', 'never saw the emulator');
    api._fake('q6'); api._line('{"e":"found","pid":4}'); api._line('{"e":"note","m":"Win32Exception: Access is denied"}'); api._end();
    assert.deepEqual([data.status.ok, data.status.msg, data.status.detail], [false, 'notready', 'Win32Exception: Access is denied']);
    // ...but its own error from this match stays
    api._fake('q7'); api._line('{"e":"found","pid":4}'); api._line('{"e":"err","m":"ram"}'); api._end();
    assert.equal(data.status.msg, 'ram', 'the reader’s own error from this match stays');
    assert.ok(api.diag().some(l => /last: .*"ram"/.test(l)), 'Copy debug info carries the last status');
});
