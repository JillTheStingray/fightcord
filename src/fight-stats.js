/**
 * Fightcord fight stats (3.11)
 *
 * Counts what you do inside 3rd Strike matches: parries, red parries, super arts that land and
 * perfect rounds. Goals (goals.js) turn them into training goals ("Parry 10 times today").
 *
 * FBNeo runs no Lua during online matches, so a small reader looks at the emulator's memory from
 * outside, the way stream overlays do. It is READ-ONLY: it opens fcadefbneo.exe with
 * PROCESS_VM_READ only and never writes to it, so it can't change the game or cause a desync.
 * It runs only while you play a 3rd Strike set and only when you have a goal that needs it.
 *
 * The reader is C# compiled in memory by Windows PowerShell's Add-Type (every Windows has it), so
 * Fightcord ships no program. The memory map is the one the 3rd Strike training script uses.
 *
 * Event: fight:event { kind: 'parry' | 'red' | 'super' | 'perfect', at, quark }
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, cfg = null;          // fight-stats-config.json
const T = (s, v) => (fc && fc.t ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g,(m, k) => (v && v[k] != null ? v[k] : m)));

const KINDS = ['parry', 'red', 'super', 'perfect'];
const KEEP_MS = 9 * 86400000;          // a week of goals + a bit
const MAX_EVENTS = 6000;
const IS_3S = /^sfiii3/i;              // sfiii3nr1, sfiii3, sfiii3n ...

/* ---------------------------------------------------------------- the maths */

// events of one kind since a time
function count(events, kind, since) {
    let n = 0;
    (events || []).forEach(e => { if (e.k === kind && e.at >= (since || 0)) n++; });
    return n;
}

// keep the list short: drop old ones, cap the length
function prune(events, at) {
    const t = (at || Date.now()) - KEEP_MS;
    const kept = (events || []).filter(e => e && KINDS.indexOf(e.k) >= 0 && e.at >= t);
    return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
}

// one line from the reader -> { e, p, ... } or null
function parseLine(line) {
    const s = String(line || '').trim();
    if (!s || s[0] !== '{') return null;
    try { const o = JSON.parse(s); return o && typeof o.e === 'string' ? o : null; } catch (e) { return null; }
}

// which side you are in the emulator's files: 1, 2 or 0 (not in it / not known yet)
function sideOf(m, me) {
    const k = String(me || '').toLowerCase();
    if (!m || !k) return 0;
    if (m.p1 && String(m.p1.name || '').toLowerCase() === k) return 1;
    if (m.p2 && String(m.p2.name || '').toLowerCase() === k) return 2;
    return 0;
}

/* ------------------------------------------------------------------ reader */

const READER_CS = String.raw`using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Fightcord: counts parries, red parries, super arts and perfect rounds in 3rd Strike.
// READ-ONLY: opens the emulator with PROCESS_VM_READ only and never writes to it.
public static class FcFightReader {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr at, byte[] buf, IntPtr n, out IntPtr read);
    [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr at, out MBI m, IntPtr len);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint ms);
    [StructLayout(LayoutKind.Sequential)] struct MBI { public IntPtr Base, AllocBase; public uint AllocProt; public IntPtr Size; public uint State, Prot, Type; }

    const uint VM_READ = 0x0010, QUERY_LIMITED = 0x1000;
    const int RAM = 0x02000000, RAM_LEN = 0x80000;
    const int FRAME = 0x02007F00;                       // frame counter (dword)
    const int MS_AT = 0x020154A0, MS_LEN = 0x30;        // match state 0x020154A7, locks 0x020154C6 / C8
    const int PL_AT = 0x02068C6C, PL_LEN = 0xA00;       // both players + the super-freeze bytes
    static readonly int[] BASE = { 0x02068C6C, 0x02069104 };
    static readonly int[] FREEZE = { 0x02069520, 0x02069088 };

    static IntPtr h = IntPtr.Zero;
    static byte[] Read(long at, int n) {
        var b = new byte[n]; IntPtr r;
        return ReadProcessMemory(h, (IntPtr)at, b, (IntPtr)n, out r) && (long)r == n ? b : null;
    }
    static void Say(string json) { Console.Out.WriteLine(json); Console.Out.Flush(); }

    // a byte / word at a CPS3 address, from a block read at a 4-aligned CPS3 address
    // (FBNeo keeps the SH-2's big-endian RAM as host-order dwords: bytes ^3, words ^2)
    static int B(byte[] blk, int start, int a) { return blk[(a - start) ^ 3]; }
    static int W(byte[] blk, int start, int a) { return BitConverter.ToUInt16(blk, (a - start) ^ 2); }
    static uint D(byte[] blk, int start, int a) { return BitConverter.ToUInt32(blk, a - start); }

    static bool Ticks(long ram) {
        var a = Read(ram + (FRAME - RAM), 4); Thread.Sleep(150); var b = Read(ram + (FRAME - RAM), 4);
        if (a == null || b == null) return false;
        uint d = BitConverter.ToUInt32(b, 0) - BitConverter.ToUInt32(a, 0);
        return d >= 3 && d <= 20;
    }

    // the exe holds a pointer to the CPS3 work RAM; find it once (then Fightcord remembers where)
    static long FindRam(Process p, long hint, out long off) {
        long mb = (long)p.MainModule.BaseAddress; int ms = p.MainModule.ModuleMemorySize;
        off = -1;
        if (hint > 0) {
            var v = Read(mb + hint, 4);
            if (v != null) { long ram = BitConverter.ToUInt32(v, 0); if (ram != 0 && Ticks(ram)) { off = hint; return ram; } }
        }
        var regions = new List<long[]>(); long at = 0; MBI m;
        while (VirtualQueryEx(h, (IntPtr)at, out m, (IntPtr)Marshal.SizeOf(typeof(MBI))) != IntPtr.Zero) {
            long b = (long)m.Base, s = (long)m.Size;
            if (m.State == 0x1000 && (m.Prot == 0x04 || m.Prot == 0x40) && s >= RAM_LEN) regions.Add(new long[] { b, b + s });
            if (s <= 0) break; at = b + s; if (at >= 0xFFFFFFFFL) break;
        }
        var cand = new Dictionary<long, long>();          // pointer value -> where in the exe
        for (long a = mb; a < mb + ms; a += 0x10000) {
            var blk = Read(a, 0x10000); if (blk == null) continue;
            for (int o = 0; o + 4 <= blk.Length; o += 4) {
                long v = BitConverter.ToUInt32(blk, o);
                if (v == 0 || (v & 3) != 0 || cand.ContainsKey(v)) continue;
                foreach (var r in regions) if (v >= r[0] && v + RAM_LEN <= r[1]) { cand[v] = a + o - mb; break; }
            }
        }
        var first = new Dictionary<long, uint>();
        foreach (var kv in cand) { var f = Read(kv.Key + (FRAME - RAM), 4); if (f != null) first[kv.Key] = BitConverter.ToUInt32(f, 0); }
        Thread.Sleep(200);
        foreach (var kv in first) {
            var f = Read(kv.Key + (FRAME - RAM), 4); if (f == null) continue;
            uint d = BitConverter.ToUInt32(f, 0) - kv.Value;
            if (d >= 6 && d <= 24 && Ticks(kv.Key)) { off = cand[kv.Key]; return kv.Key; }
        }
        return 0;
    }

    class Pl {
        public int marker, hits, life, rec, freeze, startLife;
        public bool lastWasBlock, tookHit, superHit; public int superAt = -100000;
    }

    // recent events, to drop the copies a rollback replays
    static readonly List<int[]> recent = new List<int[]>();
    static bool Fresh(int kind, int side, int frame) {
        foreach (var e in recent) if (e[0] == kind && e[1] == side && Math.Abs(e[2] - frame) <= 3) return false;
        recent.Add(new[] { kind, side, frame }); if (recent.Count > 16) recent.RemoveAt(0);
        return true;
    }
    static void Emit(int kind, int side, int frame) {
        if (!Fresh(kind, side, frame)) return;
        string[] names = { "parry", "red", "super", "perfect" };
        Say("{\"e\":\"" + names[kind] + "\",\"p\":" + (side + 1) + ",\"f\":" + frame + "}");
    }

    static bool demo;
    static string lastNote = "";
    static string Esc(string s) {
        var sb = new System.Text.StringBuilder();
        foreach (char c in s) { if (c == '"' || c == '\\') sb.Append('\\').Append(c); else if (c < ' ' || c > '~') sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c); }
        return sb.Length > 200 ? sb.ToString(0, 200) : sb.ToString();
    }
    public static void Run(long hint) { Run(hint, false); }
    public static void Run(long hint, bool anyFight) {
        demo = anyFight;
        // Fightcord closes our input when it stops (or quits): stop with it
        var stdin = new Thread(delegate () { try { Console.In.ReadToEnd(); } catch (Exception) { } Environment.Exit(0); });
        stdin.IsBackground = true; stdin.Start();
        timeBeginPeriod(1);
        try { Loop(hint); } finally { timeEndPeriod(1); }
    }

    static void Loop(long hint) {
        DateTime lost = DateTime.UtcNow;
        while (true) {
            var ps = Process.GetProcessesByName("fcadefbneo");
            if (ps.Length == 0) {
                if ((DateTime.UtcNow - lost).TotalSeconds > 60) { Say("{\"e\":\"gone\"}"); return; }
                Thread.Sleep(1000); continue;
            }
            // (3.11.1: the emulator closes at the end of every set, often while we look at it -- its
            // module list or memory goes away mid-read. That's the normal end, not a failure: wait for it to go)
            try {
                h = OpenProcess(VM_READ | QUERY_LIMITED | 0x0400, false, ps[0].Id);
                if (h == IntPtr.Zero) { Say("{\"e\":\"err\",\"m\":\"open\"}"); return; }
                long off; long ram = 0;
                Say("{\"e\":\"found\",\"pid\":" + ps[0].Id + "}");
                for (int i = 0; i < 20 && ram == 0 && !ps[0].HasExited; i++) { ram = FindRam(ps[0], hint, out off); if (ram != 0) { Say("{\"e\":\"ready\",\"off\":" + off + "}"); hint = off; } else Thread.Sleep(3000); }
                if (ram == 0 && !ps[0].HasExited) { Say("{\"e\":\"err\",\"m\":\"ram\"}"); return; }
                if (ram != 0) Watch(ram);
            } catch (Exception ex) {
                // (3.14.3: say what went wrong, once per kind, so Settings can show it; then try again)
                string m = ex.GetType().Name + ": " + ex.Message;
                if (m != lastNote) { lastNote = m; Say("{\"e\":\"note\",\"m\":\"" + Esc(m) + "\"}"); }
                Thread.Sleep(1000);
            } finally {
                if (h != IntPtr.Zero) CloseHandle(h);
                h = IntPtr.Zero;
            }
            lost = DateTime.UtcNow;
        }
    }

    static void Watch(long ram) {
        var pl = new[] { new Pl(), new Pl() };
        // starts as "in a round" so a round already under way isn't taken as a fresh one (no false perfects)
        uint lastFrame = 0; bool inMatch = true; int[] lives = { 0, 0 };
        while (true) {
            var fr = Read(ram + (FRAME - RAM), 4);
            if (fr == null) return;                              // the emulator closed
            uint frame = BitConverter.ToUInt32(fr, 0);
            if (frame == lastFrame) { Thread.Sleep(2); continue; }
            lastFrame = frame;
            var ms = Read(ram + (MS_AT - RAM), MS_LEN);
            var blk = Read(ram + (PL_AT - RAM), PL_LEN);
            if (ms == null || blk == null) return;
            bool now = (demo || B(ms, MS_AT, 0x020154C6) == 0xFF || B(ms, MS_AT, 0x020154C8) == 0xFF) && B(ms, MS_AT, 0x020154A7) == 0x02;
            int f = (int)frame;
            for (int i = 0; i < 2; i++) {
                var p = pl[i]; int bs = BASE[i];
                int marker = W(blk, PL_AT, bs + 0x32E), hits = W(blk, PL_AT, bs + 0x33E);
                int life = B(blk, PL_AT, bs + 0x9F); if (life >= 0xF0) life = 0;
                int rec = B(blk, PL_AT, bs + 0x187), freeze = B(blk, PL_AT, FREEZE[i]);
                int hitDiff = p.hits == 0xFFFF ? 1 : hits - p.hits;
                bool connection = p.marker == 0 && marker != 0;
                p.tookHit = inMatch && now && hitDiff > 0;
                if (now && inMatch) {
                    if (connection && hitDiff == 0) {
                        if (marker == 0xFFF1) {
                            Emit(0, i, f);
                            if (p.rec > 0 && p.lastWasBlock) Emit(1, i, f);
                            p.lastWasBlock = false;
                        } else p.lastWasBlock = true;
                    }
                    if (hitDiff > 0) p.lastWasBlock = false;
                    if (p.freeze == 0 && freeze > 0) { p.superAt = f; p.superHit = false; }
                }
                p.marker = marker; p.hits = hits; p.life = life; p.rec = rec; p.freeze = freeze;
            }
            if (now) {
                // a super that lands: the other player takes a hit within 1.5 s of the freeze
                for (int i = 0; i < 2; i++) {
                    var me = pl[i]; var them = pl[1 - i];
                    if (!me.superHit && f - me.superAt >= 0 && f - me.superAt <= 90 && them.tookHit) { me.superHit = true; Emit(2, i, me.superAt); }
                }
            }
            if (now && !inMatch) { pl[0].startLife = pl[0].life; pl[1].startLife = pl[1].life; }
            if (!now && inMatch) {
                // the round just ended: a win at the life you started it with is a perfect round
                int a = lives[0], b = lives[1];
                if (a != b) { int w = a > b ? 0 : 1; if (pl[w].startLife > 0 && lives[w] == pl[w].startLife) Emit(3, w, f); }
                Say("{\"e\":\"round\",\"l1\":" + a + ",\"l2\":" + b + "}");
            }
            if (now) { lives[0] = pl[0].life; lives[1] = pl[1].life; }
            inMatch = now;
            Thread.Sleep(2);
        }
    }

}
`;

let child = null, cur = null;          // cur = { quark, side, pending: [], at }
// seen = the reader found the emulator; note = the last thing it said went wrong; theirs = your opponent's events
const fresh = (quark) => ({ quark, side: 0, pending: [], at: Date.now(), events: 0, theirs: 0, rounds: 0, dropped: 0, names: '', ready: false, seen: false, note: '', err: '', failed: false });

function exePath() { return path.resolve(__dirname, '..', '..', '..', '..', '..', 'emulator', 'fbneo', 'fcadefbneo.exe'); }
function exeKey() { try { const st = fs.statSync(exePath()); return st.size + ':' + Math.round(st.mtimeMs); } catch (e) { return ''; } }

function csFile() {
    const f = path.join(__dirname, 'fight-reader.cs');
    let have = null;
    try { have = fs.readFileSync(f, 'utf8'); } catch (e) { /* not written yet */ }
    if (have !== READER_CS) fs.writeFileSync(f, READER_CS, 'utf8');
    return f;
}

function setStatus(ok, msg, detail, extra) {
    cfg.status = Object.assign({ at: Date.now(), ok: !!ok, msg: msg || '' }, extra || {});
    // what PowerShell said, for Settings (a line or two: enough to tell a blocked script from a missing .NET)
    if (!ok && detail) cfg.status.detail = String(detail).replace(/\s+/g, ' ').trim().slice(0, 220);
    store.save();
    fc.settings.refresh('goals');
}

function stop(why) {
    if (!child) return;
    const c = child;
    child = null;
    try { c.stdin.end(); } catch (e) { /* gone */ }
    setTimeout(() => { try { c.kill(); } catch (e) { /* gone */ } }, 3000);
    endMatch();
    fc.log('reader stopped', why || '');
}

// 3.13.1: the match is over: say how it went, so Settings -> Goals can tell why nothing counted
function endMatch() {
    if (!cur) return;
    flush(true);
    const m = cur;
    cur = null;
    if (!m.ready) {
        // never found the game. The reader's own error (set during this match) already says why;
        // (3.14.3) if it said nothing -- still looking, or stuck retrying -- say that, with its last note
        if (!m.failed) setStatus(false, m.seen ? 'notready' : 'noemu', m.note || m.err || '');
        return;
    }
    if (m.dropped) setStatus(false, 'side', m.names, { n: m.dropped });
    else if (!m.rounds && !m.events) setStatus(false, 'norounds', m.note || '');
    else setStatus(true, 'counted', '', { n: m.events, rounds: m.rounds, theirs: m.theirs });
}

function wanted() {
    if (!cfg.enabled) return false;
    const g = fc.modules.get('goals');
    return !!(g && g.wantsFight && g.wantsFight());
}

function begin(ev) {
    if (!ev || !ev.quark || !IS_3S.test(String(ev.rom || ''))) return;
    if (!wanted()) return;
    if (child) stop('new match');
    let cp = null;
    try { cp = require('child_process'); } catch (e) { return; }
    let cs;
    try { cs = csFile(); } catch (e) { fc.log('could not write the reader', e && e.message); return; }
    const key = exeKey();
    const hint = cfg.base && cfg.base.key === key ? +cfg.base.off || 0 : 0;
    const match = cur = fresh(ev.quark);
    const cmd = "Add-Type -Path '" + cs.replace(/'/g, "''") + "'; [FcFightReader]::Run(" + hint + ')';
    let c;
    try {
        c = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { setStatus(false, 'start'); return; }
    child = c;
    let buf = '', err = '';
    c.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const o = parseLine(line); if (o && o.e === 'ready') c.__ready = true; onLine(o, key); }
    });
    c.stderr.on('data', (d) => { err = (err + d).slice(-400); if (cur) cur.err = err; });
    c.on('error', () => { if (child === c) { child = null; setStatus(false, 'start'); } });
    c.on('exit', (code) => {
        if (child === c) child = null;
        // (3.11.1: only a reader that never found the game counts as a failure. One that counted and then
        // stopped -- the set is over, Fightcord stopped it -- is fine, whatever its exit code)
        if (code && !c.__ready) {
            fc.log('reader exited', code, err.trim());
            match.failed = true;
            setStatus(false, /malicious|antivirus|virus|blocked by/i.test(err) ? 'av' : /Add-Type|error CS\d+/.test(err) ? 'compile' : 'start', err);
        }
        // it stopped by itself (the emulator closed long ago): the match is over too
        if (!child) endMatch();
    });
    fc.log('reader started for', ev.quark);
}

function onLine(o, key) {
    if (!o || !cur) return;
    if (o.e === 'ready') {
        if (!cfg.base || cfg.base.key !== key || cfg.base.off !== o.off) { cfg.base = { key, off: o.off }; store.save(); }
        cur.ready = true;
        setStatus(true, 'ready');
    } else if (o.e === 'found') {
        cur.seen = true;
    } else if (o.e === 'note') {
        cur.note = String(o.m || '');
        fc.log('reader note', cur.note);
    } else if (o.e === 'round') {
        cur.rounds++;
    } else if (o.e === 'err') {
        cur.failed = true;
        setStatus(false, o.m || 'err');
    } else if (KINDS.indexOf(o.e) >= 0 && (o.p === 1 || o.p === 2)) {
        cur.pending.push({ k: o.e, p: o.p, at: Date.now() });
        flush(false);
    }
}

// events wait until we know which side you are (the emulator writes its files a moment after the start)
function flush(final) {
    if (!cur || !cur.pending.length) return;
    const mf = cur.side ? null : fc.emu.match(cur.quark);
    if (!cur.side) cur.side = sideOf(mf, fc.app.me());
    if (!cur.side) {
        if (final) {
            fc.log('dropped', cur.pending.length, 'fight events: side unknown');
            cur.dropped += cur.pending.length;
            cur.pending = [];
            const nm = (p) => (p && p.name) || '?';
            cur.names = mf ? T('The emulator’s match file says {p1} vs {p2}; on Fightcade you’re {me}.', { p1: nm(mf.p1), p2: nm(mf.p2), me: fc.app.me() || '?' })
                : T('The emulator didn’t leave a match file for this set.');
        }
        return;
    }
    const mine = cur.pending.filter(e => e.p === cur.side);
    cur.theirs += cur.pending.length - mine.length;
    cur.pending = [];
    if (mine.length) {
        mine.forEach(e => { cfg.events.push({ at: e.at, k: e.k, q: String(cur.quark) }); fc.emit('fight:event', { kind: e.k, at: e.at, quark: cur.quark }); });
        cfg.events = prune(cfg.events);
        cur.events += mine.length;
        store.save();
    }
}

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('fight-stats', { enabled: true, events: [], base: null, status: null });
    cfg = store.data;
    if (!Array.isArray(cfg.events)) cfg.events = [];
    cfg.events = prune(cfg.events);
    fc.on('match:start', (ev) => begin(ev));
    // a little later, so the last round's end still counts; not if the next set has started
    fc.on('match:end', () => { const c = child; setTimeout(() => { if (c && child === c) stop('match over'); }, 4000); });
    fc.tick(() => { if (cur && cur.pending.length) flush(false); }, 2000);
    fc.own(() => stop('Fightcord stopped'));
    return api;
}

const api = {
    events: () => (cfg ? cfg.events.slice() : []),
    status: () => (cfg ? cfg.status : null),
    running: () => !!child,
    // 3.14.3: for Settings -> Diagnostics -> Copy debug info
    diag: () => {
        if (!cfg) return [];
        const g = fc.modules.get('goals');
        const by = {};
        cfg.events.forEach(e => { by[e.k] = (by[e.k] || 0) + 1; });
        return ['Fight stats: ' + (cfg.enabled ? 'on' : 'OFF') + ', 3rd Strike goal ' + (g && g.wantsFight && g.wantsFight() ? 'yes' : 'no') + ', reader ' + (child ? 'running' : 'stopped'),
            '  last: ' + JSON.stringify(cfg.status || null),
            '  offset: ' + JSON.stringify(cfg.base || null) + ', exe ' + (exeKey() || 'not found'),
            '  events this week: ' + JSON.stringify(by)];
    },
    // for the tests and the dev harness: a match as if the reader were running, fed line by line
    _fake: (quark) => { cur = fresh(quark); },
    _line: (line) => onLine(parseLine(line), exeKey()),
    _end: () => endMatch()
};

module.exports = { id: 'fight-stats', name: 'Fight stats', start, count, prune, parseLine, sideOf, KINDS, IS_3S };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
