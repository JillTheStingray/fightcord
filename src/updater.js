/**
 * Fightcord updater
 *
 * Keeps Fightcord current from inside Fightcade: nobody has to visit GitHub or run the
 * installer again.
 *   - The loader (inject.js) calls run() while Fightcade starts, before any module loads,
 *     so a new version is in place for that same start (its splash says "Updating…").
 *   - Settings -> Updates (fightcord.js) checks once a day for long sessions and installs
 *     the same way; that one needs a restart, offered right there.
 *
 * Source: GitHub Releases of JillTheStingray/fightcord. latest.json names the version, the
 * update zip and its sha256; the zip must match. What a zip may write:
 *   inject.js                       the loader (only a real Fightcord loader)
 *   fightcord/<name>.js             modules
 *   fightcord/node_modules/...      the Discord-status library (.js / .json / .md / LICENSE)
 * Never settings, history or anything outside Fightcord's folder. files.json in the zip lists
 * the modules of that version, so a module dropped from Fightcord is removed too.
 *
 * Also a module (id 'updater') so the core lists it; it has no settings of its own.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = 'JillTheStingray/fightcord';
const LATEST_URL = 'https://github.com/' + REPO + '/releases/latest/download/latest.json';
const STATE_FILE = 'fightcord-state.json';
const MANIFEST_FILE = 'fightcord.json';

/* ------------------------------------------------------------------ pure */

function newer(a, b) {
    const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
}

const NM_EXT = /\.(js|cjs|mjs|json|md|txt|ts|map)$|\/(LICENSE|LICENCE|README|CHANGELOG|AUTHORS)[^/]*$/i;

// where a zip entry may go (dir = the fightcord folder) -> absolute path, or null to skip it
function targetFor(name, dir) {
    const n = String(name || '').replace(/\\/g, '/');
    if (n === 'inject.js') return path.join(dir, '..', 'inject.js');
    if (/^fightcord\/[a-z0-9_.-]+\.js$/i.test(n)) return path.join(dir, n.slice('fightcord/'.length));
    if (/^fightcord\/node_modules\/[A-Za-z0-9_.@\/-]+$/.test(n) && NM_EXT.test(n) && !n.split('/').some(s => s === '..' || s === '.' || s === '')) {
        const t = path.join(dir, n.slice('fightcord/'.length));
        const root = path.join(dir, 'node_modules') + path.sep;
        return t.indexOf(root) === 0 ? t : null;
    }
    return null;
}

// modules the last version installed that this one no longer has -> file names to remove
function staleModules(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next) || !next.length) return [];
    const keep = new Set(next);
    return prev.filter(f => /^[a-z0-9_.-]+\.js$/i.test(f) && !keep.has(f) && f !== 'updater.js' && f !== 'fightcord-core.js' && f !== 'fightcord.js');
}

// Minimal ZIP reader: central directory -> {name: Buffer}, stored + deflate entries
function unzip(buf) {
    const zlib = require('zlib');
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const out = {};
    for (let k = 0; k < count; k++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
        const method = buf.readUInt16LE(p + 10);
        const csize = buf.readUInt32LE(p + 20);
        const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8').replace(/\\/g, '/');
        p += 46 + nlen + xlen + clen;
        if (name.endsWith('/')) continue;
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('bad zip entry');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const data = buf.slice(start, start + csize);
        if (method === 0) out[name] = data;
        else if (method === 8) out[name] = zlib.inflateRawSync(data);
        else throw new Error('unsupported zip method ' + method);
    }
    return out;
}

/* -------------------------------------------------------------------- IO */

function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
function writeJson(p, v) { try { fs.writeFileSync(p, JSON.stringify(v, null, 2)); return true; } catch (e) { return false; } }

const STATE_DEFAULTS = { autoInstall: true, lastCheck: 0, latest: null, status: '', ready: '' };
const readState = (dir) => Object.assign({}, STATE_DEFAULTS, readJson(path.join(dir, STATE_FILE), {}));
const writeState = (dir, st) => writeJson(path.join(dir, STATE_FILE), st);

// GET with redirects (GitHub release downloads bounce to a CDN) -> Buffer
function httpGet(url, timeout, hops) {
    hops = hops || 0;
    return new Promise((resolve, reject) => {
        const mod = url.indexOf('http:') === 0 ? require('http') : require('https');
        const req = mod.get(url, { headers: { 'User-Agent': 'Fightcord', Accept: '*/*' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
                res.resume();
                resolve(httpGet(new URL(res.headers.location, url).href, timeout, hops + 1));
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.setTimeout(timeout || 20000, () => req.destroy(new Error('timed out')));
        req.on('error', reject);
    });
}

async function fetchLatest(timeout) {
    return JSON.parse((await httpGet(LATEST_URL + '?t=' + Date.now(), timeout)).toString('utf8'));
}

// latest.json -> verified {name: Buffer}
async function download(latest, timeout) {
    if (!latest || !latest.zip) throw new Error('no update file named');
    const url = /^https:\/\//.test(latest.zip) ? latest.zip
        : 'https://github.com/' + REPO + '/releases/download/v' + latest.version + '/' + latest.zip;
    if (url.indexOf('https://github.com/' + REPO + '/') !== 0) throw new Error('unexpected download address');
    const buf = await httpGet(url, timeout);
    const hash = require('crypto').createHash('sha256').update(buf).digest('hex');
    if (!latest.sha256 || hash !== String(latest.sha256).toLowerCase()) throw new Error('download didn’t match its checksum');
    return unzip(buf);
}

function mkdirp(d) { if (!fs.existsSync(d)) { mkdirp(path.dirname(d)); fs.mkdirSync(d); } }

// stage everything, then move it into place; record the version and its module list
function apply(dir, files, version) {
    const plan = Object.keys(files).map(n => [n, targetFor(n, dir)]).filter(([n, t]) => t &&
        !(n === 'inject.js' && !files[n].toString('utf8').includes('/* Fightcord loader */')));
    if (!plan.some(([n]) => /^fightcord\/[^/]+\.js$/.test(n))) throw new Error('nothing to install in the update');
    const stage = path.join(dir, '.update');
    if (fs.existsSync(stage)) fs.readdirSync(stage).forEach(f => fs.unlinkSync(path.join(stage, f)));
    else fs.mkdirSync(stage);
    plan.forEach(([n], i) => fs.writeFileSync(path.join(stage, i + '.part'), files[n]));
    plan.forEach(([, t], i) => {
        mkdirp(path.dirname(t));
        if (fs.existsSync(t)) fs.unlinkSync(t);
        fs.renameSync(path.join(stage, i + '.part'), t);
    });
    fs.readdirSync(stage).forEach(f => fs.unlinkSync(path.join(stage, f)));
    const m = readJson(path.join(dir, MANIFEST_FILE), {});
    let list = null;
    try { list = JSON.parse(files['files.json'].toString('utf8')).modules; } catch (e) { list = null; }
    const removed = [];
    if (Array.isArray(list)) {
        staleModules(m.files, list).forEach(f => {
            try { if (fs.existsSync(path.join(dir, f))) { fs.unlinkSync(path.join(dir, f)); removed.push(f); } } catch (e) { /* in use: next time */ }
        });
        m.files = list;
    }
    m.version = version;
    writeJson(path.join(dir, MANIFEST_FILE), m);
    return { count: plan.length, removed };
}

/**
 * Check and, when there's something newer and updates are on, install it.
 * opts: { version (installed), force (ignore autoInstall), startup (the loader), checkTimeout, downloadTimeout,
 *         onStatus(text, phase), cancelled() -> true to stop before writing anything }
 * -> { latest, available, installed, version, error }
 */
async function run(dir, opts) {
    const o = opts || {};
    const say = (t, ph) => { if (o.onStatus) try { o.onStatus(t, ph); } catch (e) { /* ui gone */ } };
    const st = readState(dir);
    const current = o.version || readJson(path.join(dir, MANIFEST_FILE), {}).version || '0.0.0';
    st.lastCheck = Date.now();
    const out = { latest: null, available: false, installed: false, version: current, error: '' };
    try {
        say('Checking for updates…', 'check');
        const latest = await fetchLatest(o.checkTimeout || 15000);
        out.latest = st.latest = latest;
        const pending = st.ready && !newer(latest.version, st.ready);
        out.available = newer(latest.version, current) && !pending;
        if (out.available && (st.autoInstall !== false || o.force)) {
            say('Updating Fightcord to ' + latest.version + '…', 'download');
            const files = await download(latest, o.downloadTimeout || 30000);
            if (o.cancelled && o.cancelled()) throw new Error('cancelled');
            apply(dir, files, latest.version);
            out.installed = true;
            out.version = latest.version;
            say('Fightcord ' + latest.version + ' installed', 'done');
        }
    } catch (e) {
        out.error = /HTTP 404/.test(e.message) ? '' : e.message;
    }
    // cut short at startup: Fightcade opens and Settings -> Updates tries again shortly
    const save = out.error === 'cancelled' ? { latest: st.latest } : { lastCheck: st.lastCheck, latest: st.latest };
    // updated while Fightcade started: the modules load the new version, so nothing waits for a restart
    if (out.installed && o.startup) Object.assign(save, { justUpdated: { version: out.version, at: Date.now() }, ready: '' });
    writeState(dir, Object.assign(readState(dir), save));
    return out;
}

const api = { REPO, LATEST_URL, newer, targetFor, staleModules, unzip, readState, writeState, fetchLatest, download, apply, run };

module.exports = Object.assign({ id: 'updater', name: 'Updater', start() { return api; } }, api);
