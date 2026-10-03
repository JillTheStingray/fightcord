#!/usr/bin/env node
/**
 * README screenshots from the harness in demo mode (demo.js: made-up names, chat, avatars and
 * history in place of the real ones from your snapshots).
 *
 *   node dev-harness/shots.js [--out <dir>] [--only <scene>]
 *
 * A screenshot is only written when window.__demoLeaks() finds none of the snapshot's real
 * names or avatar hashes left on the page. Look at every picture before publishing anyway.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] || true) : def; };
const OUT = path.resolve(opt('out', path.join(ROOT, '..', 'fightcord', 'repo', 'docs', 'screenshots')));
const ONLY = opt('only', '');
const W = 1440, H = 900;

const CHANNEL = '2026-09-27T19-44-38-street-fighter-iii-3rd-strike-fight-for-';
const LOBBY = '2026-09-27T16-53-42-lobby';

// run: code evaluated in the page once it has settled (await-able; sleep(ms) is there)
const SCENES = [
    { name: 'channel', snap: CHANNEL, run: '' },
    { name: 'discover', snap: LOBBY, view: 'home', run: '' },
    { name: 'scout', snap: CHANNEL, run: `
        // a B-ranked player near you (the harness API rates names 120-219 as B), on a normal connection
        const n = Object.keys(fightcord.app.users())[123];
        Object.assign(fightcord.app.users()[n], { ping: 45, wlan: false, proxy: false });
        __sim.challenge(n, { ranked: 5 });
        await sleep(3000);` },
    { name: 'progress', snap: CHANNEL, run: `fightcord.modules.get('stats').open({ tab: 'progress' }); await sleep(1200);` },
    { name: 'analytics', snap: CHANNEL, run: `fightcord.modules.get('stats').open({ tab: 'analytics' }); await sleep(1200);` },
    { name: 'feed', snap: CHANNEL, wait: 24000, run: `
        const F = fightcord.modules.get('feed'), S = __sim;
        const ch = fightcord.app.joinedChannels()[0].id;
        ['NeoRookie', 'GaugeMonk', 'TigerChef', 'ParryPilot'].forEach((n, i) => S.join(n, { rank: [2, 3, 5, 4][i] }));
        F._scan(); F._flush();
        const q1 = S.matchStart('GaugeMonk', 'TigerChef'); F._scan();
        const users = Object.keys(fightcord.app.users());
        const q2 = S.matchStart(users[12], users[13]); F._scan();
        F._result({ players: ['NeoRookie', 'ParryPilot'], ranks: [2, 5], ch }, 'NeoRookie', 'ParryPilot', 3, 1);
        F._result({ players: ['NeoRookie', 'TigerChef'], ranks: [2, 4], ch }, 'NeoRookie', 'TigerChef', 3, 2);
        F._result({ players: ['NeoRookie', users[20]], ranks: [2, 3], ch }, 'NeoRookie', users[20], 2, 0);
        F.open(ch);
        await sleep(800);` },
    { name: 'goals', snap: CHANNEL, run: `document.querySelector('.fcglPill').click(); await sleep(800);` },
    { name: 'welcome', snap: CHANNEL, run: `fightcord.modules.get('welcome').open(0); await sleep(1000);` },
    { name: 'settings', snap: CHANNEL, run: `fightcord.modules.get('fightcord').open('home'); await sleep(1000);` }
];

// every scene: the made-up chat in view (scrolled to the bottom), no leftover toasts
const PRELUDE = `
    const w = fightcord.app.channelElement();
    if (w) w.querySelectorAll('.chatContent, .chatContent *').forEach(el => { if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight; });
    document.querySelectorAll('#fcToasts > *').forEach(t => t.remove());
    await sleep(300);`;

/* ------------------------------------------------------- server + browser */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
function serve() {
    return new Promise(res => {
        const srv = http.createServer((req, rsp) => {
            const p = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0])));
            if (!p.startsWith(ROOT)) { rsp.writeHead(403); rsp.end(); return; }
            fs.readFile(p, (err, buf) => {
                if (err) { rsp.writeHead(404); rsp.end('not found'); return; }
                rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
                rsp.end(buf);
            });
        });
        srv.listen(0, '127.0.0.1', () => res(srv));
    });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
async function launch() {
    const exe = BROWSERS.find(b => fs.existsSync(b));
    if (!exe) throw new Error('no Edge / Chrome found');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fcshots-'));
    const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
        '--remote-debugging-port=0', `--window-size=${W},${H}`, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
    return { port: +fs.readFileSync(portFile, 'utf8').split('\n')[0], close() { try { proc.kill(); } catch (e) { /* gone */ } } };
}
function cdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
    return new Promise((res, rej) => {
        ws.onerror = rej;
        ws.onopen = () => res({
            send: (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
            close: () => ws.close()
        });
    });
}

/* -------------------------------------------------------------------- run */

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const srv = await serve();
    const base = 'http://127.0.0.1:' + srv.address().port + '/dev-harness/snapshot.html';
    const br = await launch();
    let bad = 0;
    try {
        for (const sc of SCENES.filter(s => !ONLY || s.name === ONLY)) {
            const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: 'PUT' })).json();
            const c = await cdp(t.webSocketDebuggerUrl);
            await c.send('Page.enable');
            await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
            await c.send('Page.navigate', { url: base + '?s=' + encodeURIComponent(sc.snap) + '&demo=1' + (sc.view ? '&view=' + sc.view : '') });
            await sleep(sc.wait || 6000);
            const code = `(async () => { const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                ${PRELUDE}
                ${sc.run}
                document.querySelectorAll('#fcToasts > *').forEach(t => t.remove());
                document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} });
                await sleep(400);
                return JSON.stringify(window.__demoLeaks ? window.__demoLeaks() : ['demo mode did not load']); })()`;
            const r = await c.send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true });
            const err = r.result && r.result.exceptionDetails;
            const leaks = err ? ['scene failed: ' + (err.exception && err.exception.description || err.text)] : JSON.parse(r.result.result.value);
            if (leaks.length) {
                bad++;
                console.log('✗ ' + sc.name + ': NOT saved - ' + leaks.slice(0, 5).join(', '));
            } else {
                const shot = await c.send('Page.captureScreenshot', { format: 'png' });
                const file = path.join(OUT, sc.name + '.png');
                fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
                console.log('✓ ' + sc.name + '  ' + Math.round(fs.statSync(file).size / 1024) + ' KB');
            }
            c.close();
            await fetch(`http://127.0.0.1:${br.port}/json/close/${t.id}`).catch(() => {});
        }
    } finally {
        br.close();
        srv.close();
    }
    await sleep(500);
    process.exit(bad ? 1 : 0);
})();
