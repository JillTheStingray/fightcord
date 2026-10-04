#!/usr/bin/env node
/**
 * Harness smoke run: loads every snapshot (plus the Discover home / search views) in a
 * headless Edge or Chrome, with all plugins, and fails on any script error, console.error,
 * or a Fightcord module that didn't start.
 *
 *   node dev-harness/smoke.js [--only <text>] [--wait 5000] [--keep]
 *
 * No dependencies: a tiny static server + the DevTools protocol over Node's own WebSocket
 * (Node 22+). Snapshots stay local (they hold real chat): this never uploads anything.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SNAP_DIR = path.join(__dirname, 'snapshots');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] || true) : def; };
const ONLY = opt('only', '');
const WAIT = +opt('wait', 5000);
const LANG = opt('lang', '');          // --lang pt / es: the harness in that language

const BROWSERS = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
];

// noise that isn't ours: avatars / flags / art from the real servers (unreachable or blocked here)
const IGNORE = [/Failed to load resource/i, /net::ERR_/i, /favicon/i, /Access to font at 'https:\/\/web\.fightcade\.com/i];

/* ------------------------------------------------------------------ server */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
function serve() {
    return new Promise(res => {
        const srv = http.createServer((req, rsp) => {
            const u = decodeURIComponent(req.url.split('?')[0]);
            const p = path.normalize(path.join(ROOT, u));
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

/* ----------------------------------------------------------------- browser */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function launch() {
    const exe = BROWSERS.find(b => fs.existsSync(b));
    if (!exe) throw new Error('no Edge / Chrome found');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fcsmoke-'));
    const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
        '--remote-debugging-port=0', '--window-size=1600,900', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
    const port = +fs.readFileSync(portFile, 'utf8').split('\n')[0];
    return {
        port, exe,
        close() { try { proc.kill(); } catch (e) { /* gone */ } setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked */ } }, 1500); }
    };
}

function cdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map(), handlers = [];
    ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
        else handlers.forEach(h => h(msg));
    };
    return new Promise((res, rej) => {
        ws.onerror = rej;
        ws.onopen = () => res({
            send: (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
            on: (h) => handlers.push(h),
            close: () => ws.close()
        });
    });
}

/* -------------------------------------------------------------------- run */

async function check(br, base, page) {
    const t = await (await fetch(`http://127.0.0.1:${br.port}/json/new?about:blank`, { method: 'PUT' })).json();
    const c = await cdp(t.webSocketDebuggerUrl);
    const problems = [];
    c.on((m) => {
        if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails;
            problems.push('exception: ' + ((d.exception && d.exception.description) || d.text).split('\n').slice(0, 3).join(' | '));
        } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            const text = m.params.args.map(a => a.value != null ? a.value : (a.description || a.type)).join(' ');
            if (!IGNORE.some(r => r.test(text))) problems.push('console.error: ' + text.split('\n').slice(0, 3).join(' | '));
        } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && m.params.entry.source !== 'network') {
            const text = m.params.entry.text;
            if (!IGNORE.some(r => r.test(text))) problems.push('log: ' + text);
        }
    });
    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.send('Page.enable');
    await c.send('Page.navigate', { url: base + page });
    await sleep(WAIT);
    const r = await c.send('Runtime.evaluate', { expression: 'JSON.stringify(window.fightcord ? fightcord.diag() : null)', returnByValue: true });
    const d = r.result && r.result.result && r.result.result.value ? JSON.parse(r.result.result.value) : null;
    if (!d) problems.push('Fightcord core did not start');
    else {
        d.modules.filter(m => m.state === 'failed').forEach(m => problems.push('module failed: ' + m.id + ' - ' + (m.error || '').split('\n')[0]));
        d.errors.filter(e => e.level === 'error').forEach(e => problems.push('fightcord log: [' + e.scope + '] ' + e.text.split('\n')[0]));
    }
    c.close();
    await fetch(`http://127.0.0.1:${br.port}/json/close/${t.id}`).catch(() => {});
    return { page, problems, modules: d ? d.modules.filter(m => m.state === 'running').length : 0 };
}

(async () => {
    const snaps = fs.existsSync(SNAP_DIR) ? fs.readdirSync(SNAP_DIR).filter(d => fs.existsSync(path.join(SNAP_DIR, d, 'dom.html'))).sort() : [];
    if (!snaps.length) { console.log('no snapshots in', SNAP_DIR); process.exit(0); }
    let pages = snaps.map(s => 'dev-harness/snapshot.html?s=' + encodeURIComponent(s));
    // the Discover views, on the first snapshot that has them
    const lobby = snaps.find(s => /lobby|browse/.test(s));
    if (lobby) pages.push('dev-harness/snapshot.html?s=' + encodeURIComponent(lobby) + '&view=home', 'dev-harness/snapshot.html?s=' + encodeURIComponent(lobby) + '&view=search');
    pages.push('dev-harness/styleguide.html');
    if (ONLY) pages = pages.filter(p => p.includes(ONLY));
    if (LANG) pages = pages.map(p => p.includes('snapshot.html') ? p + '&lang=' + LANG : p);

    const srv = await serve();
    const base = 'http://127.0.0.1:' + srv.address().port + '/';
    const br = await launch();
    console.log('smoke: ' + pages.length + ' pages in ' + path.basename(br.exe) + ', ' + WAIT + ' ms each\n');
    let bad = 0;
    for (const p of pages) {
        let res;
        try { res = await check(br, base, p); } catch (e) { res = { page: p, problems: ['harness: ' + e.message], modules: 0 }; }
        const label = decodeURIComponent(p.replace('dev-harness/snapshot.html?s=', '')).slice(0, 72);
        if (res.problems.length) {
            bad++;
            console.log('\u2717 ' + label);
            res.problems.slice(0, 12).forEach(x => console.log('    ' + x.slice(0, 300)));
        } else console.log('\u2713 ' + label + (res.modules ? '  (' + res.modules + ' modules)' : ''));
    }
    br.close();
    srv.close();
    console.log('\n' + (bad ? bad + ' of ' + pages.length + ' pages had problems' : 'all ' + pages.length + ' pages clean'));
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
