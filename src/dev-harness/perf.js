#!/usr/bin/env node
/**
 * Where does Fightcord's time go? Loads a real channel snapshot in headless Edge (demo mode, every
 * module on, the animated background drawing as if Fightcade had focus), lets it run, and prints
 * how busy the page was and which files / functions took the time.
 *
 *   node dev-harness/perf.js [--secs 15] [--snap <snapshot>] [--chat]   (--chat: a chat line every 2 s)
 *   node dev-harness/perf.js --viz [pulse|bars|wave]   with the music visualizer on, at the screen rate
 *   node dev-harness/perf.js --bare        the same snapshot without Fightcord, to compare
 *
 * Headless numbers are for comparing, not absolute (no GPU; the real app's 140 Hz screen draws more).
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const SECS = +opt('secs', 15);
const SNAP = opt('snap', '2026-09-27T19-44-38-street-fighter-iii-3rd-strike-fight-for-');
const BARE = !!opt('bare', false), CHAT = !!opt('chat', false);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function serve() {
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    return new Promise(res => {
        const srv = http.createServer((req, rsp) => {
            const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
            if (!p.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
            fs.readFile(p, (err, buf) => {
                if (err) { rsp.writeHead(404); rsp.end(); return; }
                rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
                rsp.end(buf);
            });
        });
        srv.listen(0, '127.0.0.1', () => res(srv));
    });
}
function cdp(url) {
    const ws = new WebSocket(url);
    let id = 0;
    const pend = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
    return new Promise((res, rej) => { ws.onerror = rej; ws.onopen = () => res({ send: (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }), close: () => ws.close() }); });
}

(async () => {
    const srv = await serve();
    const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(f => fs.existsSync(f));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fcshots-perf-'));
    spawn(exe, ['--headless=new', '--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', '--window-size=1440,900', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
    process.on('exit', () => spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" + profile + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' }));
    const pf = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(pf); i++) await sleep(100);
    const port = +fs.readFileSync(pf, 'utf8').split('\n')[0];
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const c = await cdp(t.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Performance.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    // the page as if it had focus (headless never does: fc.tick and the background would pause)
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/dev-harness/snapshot.html?s=${encodeURIComponent(SNAP)}&demo=1${BARE ? '&plugins=0&theme=0' : ''}` });
    await sleep(9000);
    await c.send('Runtime.evaluate', { expression: `window.__fcbgAlwaysOn = true;
        ${opt('viz', false) ? "fightcord.modules.get('backgrounds').setLook({ style: 'visualizer', look: '" + (opt('viz') === true ? 'pulse' : opt('viz')) + "', fps: 'screen' }); __sim.music && __sim.music();" : ''}
        ${CHAT ? "window.__perfChat = setInterval(() => window.__sim && __sim.chat('PerfKid', 'gg that was close'), 2000);" : ''} 1` });
    await sleep(1500);
    const metrics = async () => { const r = await c.send('Performance.getMetrics'); const o = {}; r.result.metrics.forEach(m => { o[m.name] = m.value; }); return o; };
    const runs = async () => (await c.send('Runtime.evaluate', { returnByValue: true, expression: 'window.fightcord && fightcord.diag ? (d => ({ watch: d.watch.runs, tick: d.tick.runs }))(fightcord.diag()) : {}' })).result.result.value || {};
    // which parts of the page keep changing (each change wakes every fc.watch)
    await c.send('Runtime.evaluate', { expression: `window.__perfMut = new Map(); new MutationObserver((list) => list.forEach(m => {
        const t = m.target, d = (t.id ? '#' + t.id : '') + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') || t.nodeName;
        const p = t.parentElement, pd = p ? (p.id ? '#' + p.id : (p.className && typeof p.className === 'string' ? '.' + p.className.trim().split(/\\s+/)[0] : p.nodeName)) : '';
        const k = pd + ' > ' + d + ' (+' + m.addedNodes.length + ' -' + m.removedNodes.length + ')'; __perfMut.set(k, (__perfMut.get(k) || 0) + 1); })).observe(document.body, { childList: true, subtree: true }); 1` });
    const r0 = await runs();
    const m0 = await metrics();
    await c.send('Profiler.enable');
    await c.send('Profiler.setSamplingInterval', { interval: 250 });
    await c.send('Profiler.start');
    // frames drawn: count requestAnimationFrame callbacks over the run
    await c.send('Runtime.evaluate', { expression: `window.__perfFrames = 0; (function f() { window.__perfFrames++; requestAnimationFrame(f); })(); 1` });
    await sleep(SECS * 1000);
    const prof = (await c.send('Profiler.stop')).result.profile;
    const m1 = await metrics();
    const r1 = await runs();
    const frames = (await c.send('Runtime.evaluate', { expression: 'window.__perfFrames', returnByValue: true })).result.result.value;
    const info = (await c.send('Runtime.evaluate', { returnByValue: true, expression: `({ nodes: document.getElementsByTagName('*').length, users: document.querySelectorAll('.usersOnlineList .userItem').length,
        canvases: [...document.querySelectorAll('canvas')].filter(x => x.offsetParent || getComputedStyle(x).position === 'fixed').map(x => (x.id || x.className || 'canvas') + ' ' + x.width + 'x' + x.height),
        anims: document.getAnimations().length })` })).result.result.value;

    const d = (k) => (m1[k] || 0) - (m0[k] || 0);
    const pct = (s) => (s / SECS * 100).toFixed(1) + '%';
    console.log(`\n${BARE ? 'WITHOUT Fightcord' : 'With Fightcord'}  ·  ${SECS} s  ·  ${info.nodes} elements, ${info.users} member rows, ${info.anims} running animations`);
    console.log(`  main thread busy  ${pct(d('TaskDuration'))}   (script ${pct(d('ScriptDuration'))}, style ${pct(d('RecalcStyleDuration'))}, layout ${pct(d('LayoutDuration'))})`);
    console.log(`  style recalcs ${d('RecalcStyleCount')}, layouts ${d('LayoutCount')}, frames ~${Math.round(frames / SECS)}/s`);
    if (r0.watch != null) console.log('  page-change refreshes (all watchers) ' + ((r1.watch - r0.watch) / SECS).toFixed(1) + '/s, timer rounds ' + ((r1.tick - r0.tick) / SECS).toFixed(1) + '/s');
    const muts = (await c.send('Runtime.evaluate', { returnByValue: true, expression: '[...__perfMut].sort((a, b) => b[1] - a[1]).slice(0, 10)' })).result.result.value;
    if (muts.length) { console.log('  what keeps changing (child list changes over the run):'); muts.forEach(([k, n]) => console.log('   ' + String(n).padStart(6) + '  ' + k)); }
    if (info.canvases.length) console.log('  canvases: ' + info.canvases.join(', '));

    // self time per file and per function
    const byId = new Map(prof.nodes.map(n => [n.id, n]));
    const self = new Map();
    const dt = prof.timeDeltas;
    prof.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (dt[i] || 0)));
    const perFile = new Map(), perFn = new Map();
    self.forEach((us, id) => {
        const cf = byId.get(id).callFrame;
        const file = cf.url ? (cf.url.match(/fc\/([\w.-]+)$/) || [, cf.url.replace(/^.*\//, '') || '(page)'])[1] : '(' + (cf.functionName || 'native') + ')';
        perFile.set(file, (perFile.get(file) || 0) + us);
        if (cf.url) { const k = file + ' ' + (cf.functionName || '(anonymous)') + ':' + (cf.lineNumber + 1); perFn.set(k, (perFn.get(k) || 0) + us); }
    });
    // the same, but native work (querySelectorAll, style reads…) charged to the nearest of our functions that called it
    const parent = new Map();
    prof.nodes.forEach(n => (n.children || []).forEach(ch => parent.set(ch, n.id)));
    const charged = new Map(), chargedFn = new Map();
    self.forEach((us, id) => {
        let n = byId.get(id);
        while (n && !(n.callFrame.url && /fc\//.test(n.callFrame.url)) && parent.has(n.id)) n = byId.get(parent.get(n.id));
        if (!n || !/fc\//.test(n.callFrame.url)) return;
        const file = n.callFrame.url.match(/fc\/([\w.-]+)$/)[1];
        charged.set(file, (charged.get(file) || 0) + us);
        const k = file + ' ' + (n.callFrame.functionName || '(anonymous)') + ':' + (n.callFrame.lineNumber + 1);
        chargedFn.set(k, (chargedFn.get(k) || 0) + us);
    });
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
    console.log('\n  Fightcord files incl. the browser work they asked for (ms):');
    top(charged, 12).forEach(([k, us]) => console.log('   ' + (us / 1000).toFixed(0).padStart(7) + '  ' + k));
    console.log('\n  … and the functions:');
    top(chargedFn, 16).forEach(([k, us]) => console.log('   ' + (us / 1000).toFixed(0).padStart(7) + '  ' + k));
    console.log('\n  time by file (self, ms over the run):');
    top(perFile, 14).forEach(([k, us]) => console.log('   ' + (us / 1000).toFixed(0).padStart(7) + '  ' + k));
    console.log('\n  hottest functions:');
    top(perFn, 18).forEach(([k, us]) => console.log('   ' + (us / 1000).toFixed(0).padStart(7) + '  ' + k));
    // --callers <function>: who called it, with the time spent in it on their behalf
    const want = opt('callers', '');
    if (want) {
        const total = new Map();          // node id -> time in it and below
        const sum = (n) => { if (total.has(n.id)) return total.get(n.id); let t = self.get(n.id) || 0; (n.children || []).forEach(ch => { t += sum(byId.get(ch)); }); total.set(n.id, t); return t; };
        const by = new Map();
        prof.nodes.filter(n => n.callFrame.functionName === want).forEach(n => {
            let p = byId.get(parent.get(n.id)), chain = [];
            for (let k = 0; p && k < 3; k++, p = byId.get(parent.get(p.id))) chain.push((p.callFrame.url.match(/fc\/([\w.-]+)$/) || [, '?'])[1] + ' ' + (p.callFrame.functionName || '(anon)') + ':' + (p.callFrame.lineNumber + 1));
            const k = chain.join(' < ');
            by.set(k, (by.get(k) || 0) + sum(n));
        });
        console.log('\n  callers of ' + want + ':');
        top(by, 12).forEach(([k, us]) => console.log('   ' + (us / 1000).toFixed(0).padStart(7) + '  ' + k));
    }
    c.close();
    srv.close();
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
