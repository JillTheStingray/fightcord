/**
 * Fightcord image uploads (Fightcord-only)
 *
 * Paste an image into the chat box, drag one onto the chat, or click the + next to the message
 * box: you see it first, then Upload sends it. Fightcade's chat only carries text, so the file goes
 * to a free picture server and the message is its link. Everyone with Fightcord sees the
 * picture / GIF / clip in the chat (chat-extras.js); everyone else sees the link.
 *   - 3.4: Blossom servers first (Nostr's picture servers: the upload is signed with a fresh
 *     throwaway key each time, the file is named by its SHA-256, and a copy goes to a second server
 *     so the picture still shows when one is down); catbox.moe, then uguu.se, only if none take it.
 *   - Pictures, GIFs (still animated) and short clips (mp4 / webm / mov), up to 200 MB.
 *   - Photos are redrawn before they go, which drops their hidden details (location, camera).
 *     GIFs and clips go as they are.
 *   - Nothing is uploaded without your click; uploads are public to anyone with the link.
 * Favorites (like Discord's): the star on a GIF / picture in the chat saves it; the GIF button in the
 * message box lists them (searchable by name) and sends one with a click. Kept on this PC.
 * GIF search: the GIF button searches KLIPY (the GIF service Discord uses; Fightcord's own app key),
 * and Tenor's search page if KLIPY can't answer. Only when you type a search (after you stop
 * typing), each search kept for a while. A GIF goes out as its KLIPY / Tenor link, which every
 * Fightcord shows as the GIF.
 */
'use strict';

let fc = null;
let store = null, cfg = null;
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const E = (s) => fc.fmt.esc(s);

const API = 'https://catbox.moe/user/api.php';
const MAX = 200 * 1024 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/aac': 'aac', 'audio/opus': 'opus', 'audio/webm': 'webm' };
// files Windows hands over without a type (or an odd one): go by the name
const BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/opus' };

/* ---------------------------------------------------------------- pure parts */

// a file -> the type it goes as ('' = not one we send)
function typeOf(f) {
    if (!f) return '';
    if (TYPES[f.type]) return f.type;
    const ext = (String(f.name || '').match(/\.([a-z0-9]{2,5})$/i) || [])[1];
    return (ext && BY_EXT[ext.toLowerCase()]) || '';
}
const isAudio = (type) => /^audio\//.test(type || '');
// a file -> '' if it can go, else why not
function checkFile(f) {
    if (!f) return T('Nothing to upload');
    if (!typeOf(f)) return T('Only pictures, GIFs, clips and audio (png, jpg, gif, webp, mp4, webm, mov, mp3, ogg, wav, m4a, flac)');
    if (!(f.size > 0)) return T('That file is empty');
    if (f.size > MAX) return T('Too big: up to {mb} MB', { mb: MAX / 1048576 });
    return '';
}
// an audio file's name rides along after the link's # (catbox renames files), so the chat can show it
function audioTag(name) {
    const base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\u0000-\u001f#]/g, '').trim().slice(0, 60);
    return base ? '#' + encodeURIComponent(base).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()) : '';
}
// what catbox answers -> the link, or null (it answers errors as plain text too)
function catboxUrl(text) {
    const t = String(text || '').trim();
    return /^https:\/\/files\.catbox\.moe\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{2,5}$/.test(t) ? t : null;
}
// what uguu.se answers ({ success, files: [{ url }] }) -> the link, or null
function uguuUrl(text) {
    let j = null;
    try { j = JSON.parse(String(text || '')); } catch (e) { return null; }
    const u = j && j.success && Array.isArray(j.files) && j.files[0] && j.files[0].url;
    return /^https:\/\/([a-z0-9-]+\.)?uguu\.se\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{2,5}$/.test(u || '') ? u : null;
}
/* ------------------------------------------------------------------- Blossom */

// bigger files skip the Blossom servers (they cap uploads well below catbox's 200 MB)
const BLOSSOM_MAX = 50 * 1024 * 1024;
let V = null;                    // voice.js: its Nostr signer
function signer() {
    if (!V) { try { V = require(require('path').join(__dirname, 'voice.js')); } catch (e) { V = null; } }
    return V;
}
const sha256 = (data) => require('crypto').createHash('sha256').update(data).digest('hex');
// the "Authorization: Nostr …" header for one upload to one server (BUD-11): a fresh key every time,
// so nothing links your uploads together. Standard base64: Primal turns down the URL-safe kind.
function blossomAuth(hash, server, now, sv) {
    const t = Math.floor((now || Date.now()) / 1000);
    const ev = (sv || signer()).makeEvent(require('crypto').randomBytes(32), 24242,
        [['t', 'upload'], ['x', hash], ['expiration', String(t + 300)], ['server', server]], 'Upload a file', t - 5);
    return 'Nostr ' + Buffer.from(JSON.stringify(ev)).toString('base64');
}
// what a Blossom server answers (its blob descriptor) -> the link, only if it's the file we sent
function blossomUrl(text, hash) {
    let d = null;
    try { d = JSON.parse(String(text || '')); } catch (e) { return null; }
    const u = d && typeof d.url === 'string' ? d.url : '';
    return /^https:\/\/[^\s"<>]+$/.test(u) && u.indexOf(hash) > 0 && (!d.sha256 || d.sha256 === hash) ? u : null;
}

// where files go when no Blossom server takes them: catbox (kept), then uguu.se when catbox is down (kept 3 hours)
const HOSTS = {
    catbox: { name: 'catbox.moe', api: API, field: 'fileToUpload', fields: { reqtype: 'fileupload' }, parse: catboxUrl },
    uguu: { name: 'uguu.se', api: 'https://uguu.se/upload', field: 'files[]', fields: {}, parse: uguuUrl }
};
// what's typed + the link (the link last, so the picture follows the words)
function joinText(cur, url) {
    const c = String(cur || '').trim();
    return c ? c + ' ' + url : url;
}
// multipart/form-data: the fields, then the file
function multipart(boundary, fields, file) {
    const parts = [];
    Object.keys(fields).forEach(k => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${fields[k]}\r\n`)));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field || 'fileToUpload'}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.data);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    return Buffer.concat(parts);
}
// a favourite's name, for search: Tenor / Giphy links carry one ("fighting-stance-ken-masters-gif-123")
function nameOf(link) {
    try {
        const u = new URL(link);
        const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
        let n = '';
        if (/tenor\.com$/.test(u.hostname) && /^\/view\//.test(u.pathname)) n = seg.replace(/-gif-\d+$/i, '').replace(/-\d+$/, '');
        else if (/giphy\.com$/.test(u.hostname) && /^\/(gifs|stickers)\//.test(u.pathname)) n = seg.replace(/-?[A-Za-z0-9]{8,}$/, '');
        else if (/klipy\.com$/.test(u.hostname)) n = seg.replace(/-+[A-Za-z0-9]{6,}$/, '').replace(/-\d+$/, '');
        else if (!/catbox\.moe$/.test(u.hostname)) n = seg.replace(/\.[a-z0-9]{2,5}$/i, '');
        return n.replace(/[-_]+/g, ' ').trim().slice(0, 60);
    } catch (e) { return ''; }
}
// favourites matching a search (every word, in the name or the link)
function searchFavs(list, q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list.slice();
    return list.filter(f => { const hay = ((f.name || '') + ' ' + f.link).toLowerCase(); return words.every(w => hay.indexOf(w) >= 0); });
}
const FAV_MAX = 300;

// KLIPY: Fightcord's app key (KLIPY app keys are meant to ship inside apps)
const KLIPY = 'https://api.klipy.com/api/v1/xROwvw8AA68Tk2IEoD5WXxiTjj3D2ZtE1l68QsD7KVwUnLlBKQPJqCNq5o5Vx7r0';
// klipy.com/gifs/<slug> (or /stickers/<slug>) -> { type, slug } | null
function klipySlug(link) {
    try {
        const u = new URL(link);
        if (u.hostname.replace(/^www\./, '') !== 'klipy.com') return null;
        const m = u.pathname.match(/^\/(gifs|stickers)\/([A-Za-z0-9_-]{2,120})\/?$/);
        return m && m[2] !== 'search' ? { type: m[1], slug: m[2] } : null;
    } catch (e) { return null; }
}
// one KLIPY item -> a tile / preview: its small looping mp4 (+ a still), and its page as the link
function klipyPick(it, type) {
    const f = (it && it.file) || {};
    const size = f.sm || f.md || f.hd || f.xs || {};
    const vid = (size.mp4 || {}).url || ((f.md || {}).mp4 || {}).url, still = (size.jpg || size.webp || {}).url || '';
    const ok = (u) => /^https:\/\/([a-z0-9-]+\.)*klipy\.com\//.test(u || '');
    if (!it || !it.slug || !ok(vid)) return null;
    return { link: 'https://klipy.com/' + (type || 'gifs') + '/' + it.slug, src: vid, still: ok(still) ? still : '', kind: 'gifv', name: String(it.title || '').slice(0, 80) };
}
// a KLIPY answer ({ result, data: { data: [...] } }) -> tiles
function parseKlipy(json, type) {
    const list = json && json.data && Array.isArray(json.data.data) ? json.data.data : [];
    return list.map(it => klipyPick(it, type)).filter(Boolean);
}

// a search -> Tenor's search page for it
function tenorSearchUrl(q) {
    const words = String(q || '').toLowerCase().replace(/[\s_]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 8);
    return words.length ? 'https://tenor.com/search/' + words.map(w => encodeURIComponent(w.replace(/[/#?%\\]/g, ''))).filter(Boolean).join('-') + '-gifs' : '';
}
// Tenor's search page -> [{ link (the Tenor page, what gets sent), src (small mp4), still, name }]
// (the page carries its results as JSON in a <script type="text/x-cache">)
function parseTenor(html) {
    const out = [];
    const re = /<script[^>]*type="text\/x-cache"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(String(html || '')))) {
        let data;
        try { data = JSON.parse(m[1]); } catch (e) { continue; }
        const searches = data && data.universal && data.universal.search;
        if (!searches) continue;
        Object.keys(searches).forEach(k => (searches[k].results || []).forEach(r => {
            const mf = r.media_formats || {};
            const vid = (mf.tinymp4 || mf.mp4 || {}).url, still = (mf.tinygif || mf.gifpreview || {}).url;
            const link = r.itemurl;
            if (!/^https:\/\/media\d*\.tenor\.com\//.test(vid || '') || !/^https:\/\/tenor\.com\/view\//.test(link || '') || out.some(x => x.link === link)) return;
            out.push({ link, src: vid, still: /^https:\/\/media\d*\.tenor\.com\//.test(still || '') ? still : '', kind: 'gifv',
                name: String(r.h1_title || r.content_description || '').replace(/\s*GIF$/i, '').slice(0, 80) });
        }));
    }
    return out;
}

const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

/* ------------------------------------------------------------------ uploading */

// -> { promise, cancel }. opts.host: 'catbox' (default) | 'uguu'; opts.blossom: a Blossom server's
// name (then opts.host is ignored); opts.request: https.request (the tests pass a fake)
function upload(data, type, onProgress, opts) {
    const o = opts || {};
    const bl = o.blossom ? { name: o.blossom, hash: o.hash || sha256(data) } : null;
    const host = bl ? { name: bl.name, parse: (t) => blossomUrl(t, bl.hash) } : HOSTS[o.host] || HOSTS.catbox;
    const request = o.request || require('https').request;
    const boundary = '----fightcord' + Math.random().toString(16).slice(2);
    const name = 'fightcord.' + (TYPES[type] || 'bin');
    const body = bl ? data : multipart(boundary, host.fields, { name, type, data, field: host.field });
    const headers = bl
        ? { 'Content-Type': type, 'Content-Length': body.length, 'X-SHA-256': bl.hash, Authorization: blossomAuth(bl.hash, bl.name, 0, o.signer), 'User-Agent': 'Fightcord' }
        : { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, 'User-Agent': 'Fightcord' };
    let req = null, cancelled = false;
    const promise = new Promise((resolve, reject) => {
        req = request(o.url || (bl ? 'https://' + bl.name + '/upload' : host.api), { method: bl ? 'PUT' : 'POST', timeout: 120000, headers }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; if (text.length > 4096) req.destroy(); });
            res.on('end', () => {
                const url = host.parse(text);
                // a Blossom server: 201 stored, 200 had it already; anything else, the next server
                if (bl) return url && (res.statusCode === 200 || res.statusCode === 201) ? resolve(url)
                    : reject(Object.assign(new Error((res.headers && res.headers['x-reason']) || 'HTTP ' + res.statusCode), { busy: true }));
                if (res.statusCode === 200 && url) return resolve(url);
                // when catbox is overloaded it answers 200 with nothing (or a 5xx): worth another try
                if (!text.trim() || res.statusCode >= 500 || res.statusCode === 429 || (res.statusCode === 200 && host !== HOSTS.catbox)) return reject(busyError(host));
                reject(new Error(text.trim().slice(0, 120) || 'HTTP ' + res.statusCode));
            });
        });
        req.on('timeout', () => req.destroy(new Error('timed out')));
        req.on('error', (e) => reject(cancelled ? new Error('cancelled') : /ECONNRESET|socket hang up/i.test(e.code + ' ' + e.message) ? busyError(host) : e));
        // in pieces, so the bar moves
        let off = 0;
        const CH = 64 * 1024;
        const pump = () => {
            while (off < body.length) {
                const piece = body.slice(off, off + CH);
                off += piece.length;
                if (onProgress) onProgress(off / body.length);
                if (!req.write(piece)) { req.once('drain', pump); return; }
            }
            req.end();
        };
        pump();
    });
    return { promise, cancel() { cancelled = true; if (req) req.destroy(new Error('cancelled')); } };
}
function busyError(host) {
    const e = new Error(T('{host} didn’t take the file: it’s busy or down right now', { host: (host || HOSTS.catbox).name }));
    e.busy = true;
    return e;
}
// a link the host handed out -> does it really hold the file? (when it's in trouble it keeps 0 bytes)
// true / false, or null when it can't tell (then the link goes out as before)
function stored(url, size, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
        let req;
        try {
            req = (o.head || require('https').request)(url, { method: 'HEAD', timeout: 8000, headers: { 'User-Agent': 'Fightcord' } }, (res) => {
                res.resume();
                const len = res.headers && res.headers['content-length'];
                resolve(res.statusCode === 200 && len != null ? +len === size : res.statusCode === 404 ? false : null);
            });
        } catch (e) { resolve(null); return; }
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
        req.end();
    });
}
function lostError(host) {
    const e = new Error(T('{host} didn’t keep the file: it’s having trouble right now', { host: (host || HOSTS.catbox).name }));
    e.busy = true;
    return e;
}
// the Blossom servers in turn (3.4); none takes it -> catbox, trying again (after 2 s, then 6 s) while
// it's busy; still busy -> uguu.se once
// -> { promise (resolves { url, host } + server, hash for Blossom), cancel }. opts.onRetry(n, hostName);
// opts.blossom: the servers to try (default Fightcord's list; none when the core isn't there)
function uploadRetry(data, type, onProgress, opts) {
    const o = opts || {}, waits = o.waits || [2000, 6000];
    const servers = data.length > BLOSSOM_MAX || !(o.signer || signer()) ? [] : o.blossom || (fc ? fc.data.BLOSSOM : []);
    let job = null, timer = 0, wake = null, cancelled = false;
    const once = async (hostKey) => {
        job = upload(data, type, onProgress, Object.assign({}, o, { host: hostKey, blossom: null }));
        const url = await job.promise;
        if (await stored(url, data.length, o) === false) throw lostError(HOSTS[hostKey]);
        return { url, host: hostKey };
    };
    const hash = servers.length ? sha256(data) : '';
    const promise = (async () => {
        for (const server of servers) {
            if (cancelled) throw new Error('cancelled');
            try {
                job = upload(data, type, onProgress, Object.assign({}, o, { blossom: server, hash }));
                const url = await job.promise;
                if (await stored(url, data.length, o) === false) throw lostError({ name: server });
                return { url, host: 'blossom', server, hash };
            } catch (e) {
                if (cancelled) throw new Error('cancelled');
                if (fc) fc.log('upload: ' + server + ' didn’t take it (' + e.message + ')');
                if (onProgress) onProgress(0);
            }
        }
        for (let i = 0; ; i++) {
            if (cancelled) throw new Error('cancelled');
            try { return await once('catbox'); }
            catch (e) {
                if (cancelled) throw new Error('cancelled');
                if (!e.busy) throw e;
                if (i >= waits.length) {
                    if (o.fallback === false) throw e;
                    if (o.onRetry) o.onRetry(i + 1, HOSTS.uguu.name);
                    try { return await once('uguu'); }
                    catch (e2) { throw cancelled ? new Error('cancelled') : e2.busy ? Object.assign(new Error(servers.length ? T('None of the picture servers took the file right now. Try again later.') : T('catbox.moe and uguu.se are both having trouble right now. Try again later.')), { busy: true }) : e2; }
                }
                if (o.onRetry) o.onRetry(i + 1, HOSTS.catbox.name);
                await new Promise(r => { wake = r; timer = setTimeout(r, waits[i]); });
            }
        }
    })();
    return { promise, cancel() { cancelled = true; clearTimeout(timer); if (wake) wake(); if (job) job.cancel(); } };
}

// a copy of a Blossom upload on the next server that takes it (quietly; nothing waits for it).
// The link stays the first server's: other Fightcords find the copy by the file's hash.
function mirror(data, type, got, opts) {
    const o = opts || {};
    const list = o.blossom || (fc ? fc.data.BLOSSOM : []);
    const rest = list.filter(h => h !== got.server);
    return (async () => {
        for (const server of rest) {
            try {
                const url = await upload(data, type, null, Object.assign({}, o, { blossom: server, hash: got.hash })).promise;
                if (await stored(url, data.length, o) !== false) return server;
            } catch (e) { /* the next one */ }
        }
        return null;
    })();
}

// photos lose their hidden details (EXIF: location, camera) by being redrawn; GIFs / clips go as they are
async function prepare(file) {
    const type = typeOf(file);
    if (!/^image\/(png|jpeg|webp)$/.test(type) || typeof createImageBitmap !== 'function') return { data: Buffer.from(await file.arrayBuffer()), type };
    try {
        const bmp = await createImageBitmap(file);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        const blob = await new Promise(r => c.toBlob(r, file.type, 0.92));
        if (blob && blob.size) return { data: Buffer.from(await blob.arrayBuffer()), type: blob.type || file.type };
    } catch (e) { fc.log('redraw failed, sending as is', e.message); }
    return { data: Buffer.from(await file.arrayBuffer()), type: file.type };
}

/* ------------------------------------------------------------------------ UI */

// 3.4: files wait in a tray on top of the message box, like Discord's: a tile each (eye = spoiler,
// pencil = name, bin = remove). Enter sends them with what you typed; nothing goes up before that.
const TRAY_MAX = 5;
let tray = null;          // { wrap, input, el, items: [{ id, file, type, url (object URL), name, spoiler, job, el }], busy }
let trayId = 0;

function chatInputOf(el) {
    const w = el && el.closest ? el.closest('.chatInput') : null;
    return (w && w.querySelector('input.input, input')) || fc.app.chatInput();
}

// the name and the spoiler mark ride after the link's # (Discord marks spoilers with SPOILER_ too);
// an audio file always carries its name (the player shows it)
function fragment(it) {
    const tag = audioTag(it.name);
    const named = isAudio(it.type) || it.renamed;
    return it.spoiler ? '#SPOILER_' + (named ? tag.slice(1) : '') : named ? tag : '';
}

function tileHtml(it) {
    const clip = /^video\//.test(it.type), audio = isAudio(it.type);
    const th = audio ? `<div class="au">${fc.ui.icon('music')}</div>`
        : clip ? `<video src="${E(it.url)}" muted autoplay loop playsinline></video>` : `<img src="${E(it.url)}" alt="">`;
    return `<div class="th">${th}${it.spoiler ? `<span class="sp">${E(T('Spoiler'))}</span>` : ''}<i class="bar"><b></b></i></div>` +
        `<div class="nm" title="${E(it.name)}">${E(it.name)}</div>` +
        `<div class="fcupTb">` +
        `<span data-tray="spoiler" title="${E(T(it.spoiler ? 'Remove spoiler' : 'Mark as spoiler'))}">${fc.ui.icon(it.spoiler ? 'eyeOff' : 'eye')}</span>` +
        `<span data-tray="edit" title="${E(T('Change the name'))}">${fc.ui.icon('edit')}</span>` +
        `<span data-tray="remove" class="bad" title="${E(T('Remove'))}">${fc.ui.icon('trash')}</span></div>`;
}

function renderTray() {
    if (!tray) return;
    tray.el.innerHTML = tray.items.map(it => `<div class="fcupTile${it.spoiler ? ' spoiler' : ''}${it.err ? ' err' : ''}" data-id="${it.id}">${tileHtml(it)}</div>`).join('') +
        `<div class="fcupTrayNote">${E(T('Enter sends · public to anyone with the link'))}</div>`;
    tray.items.forEach(it => { it.el = tray.el.querySelector('[data-id="' + it.id + '"]'); });
    placeTray();
}

// on top of the message box, as wide as it (the box squares its top corners to join it)
function placeTray() {
    if (!tray) return;
    const { wrap, input, el } = tray;
    if (!input.isConnected) { closeTray(); return; }
    const bottom = wrap.clientHeight - input.offsetTop;
    Object.assign(el.style, { left: input.offsetLeft + 'px', width: input.offsetWidth + 'px', bottom: bottom + 'px' });
}

function closeTray() {
    if (!tray) return;
    const t = tray;
    tray = null;
    t.items.forEach(it => { if (it.job) it.job.cancel(); URL.revokeObjectURL(it.url); });
    t.el.remove();
    t.wrap.classList.remove('fcupTrayOn');
    window.removeEventListener('resize', placeTray);
}

function offer(file, input) {
    if (!cfg.enabled) return;
    const why = checkFile(file);
    if (why) { fc.ui.toast(why, { kind: 'warning', icon: 'warn' }); return; }
    const box = (input && input.isConnected && input) || fc.app.chatInput();
    const wrap = box && box.closest('.chatInput');
    if (!wrap) { fc.ui.toast(T('Open a chat first'), { icon: 'warn' }); return; }
    if (tray && tray.input !== box) closeTray();
    if (!tray) {
        if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
        const el = document.createElement('div');
        el.className = 'fcupTray';
        el.addEventListener('mousedown', (e) => e.stopPropagation());
        el.addEventListener('click', onTrayClick);
        wrap.appendChild(el);
        wrap.classList.add('fcupTrayOn');
        tray = { wrap, input: box, el, items: [], busy: false };
        window.addEventListener('resize', placeTray);
    }
    if (tray.busy) { fc.ui.toast(T('Wait for the files on their way'), { icon: 'clock' }); return; }
    if (tray.items.length >= TRAY_MAX) { fc.ui.toast(T('Up to {n} files at once', { n: TRAY_MAX }), { kind: 'warning', icon: 'warn' }); return; }
    tray.items.push({ id: ++trayId, file, type: typeOf(file), url: URL.createObjectURL(file), name: file.name || 'image.' + (TYPES[typeOf(file)] || 'png'), spoiler: false });
    renderTray();
    box.focus();
}

function onTrayClick(e) {
    e.stopPropagation();
    const b = e.target.closest('[data-tray]');
    const tile = e.target.closest('.fcupTile');
    const it = tile && tray && tray.items.find(x => x.id === +tile.dataset.id);
    if (!b || !it || tray.busy) return;
    const act = b.dataset.tray;
    if (act === 'remove') {
        URL.revokeObjectURL(it.url);
        tray.items = tray.items.filter(x => x !== it);
        if (!tray.items.length) { closeTray(); return; }
        renderTray();
    } else if (act === 'spoiler') {
        it.spoiler = !it.spoiler;
        renderTray();
    } else if (act === 'edit') {
        editTile(it, b);
    }
}

// the pencil: the file's name and the spoiler mark, Discord's "Modify attachment"
function editTile(it, anchor) {
    const box = document.createElement('div');
    box.innerHTML = fc.ui.popHead({ icon: 'edit', title: T('Change the file'), sub: E(fmtSize(it.file.size) + ' · ' + (TYPES[it.type] || '').toUpperCase()) }) +
        `<div class="fc-pb"><input class="fc-input fcupName" maxlength="60" value="${E(it.name)}">` +
        `<label class="fcupSp"><input type="checkbox"${it.spoiler ? ' checked' : ''}> ${E(T('Mark as spoiler'))}</label></div>` +
        fc.ui.popFoot('', fc.ui.btn('Cancel', { kind: 'ghost', size: 'sm', act: 'tr-cancel' }) + fc.ui.btn('Save', { size: 'sm', act: 'tr-save' }));
    const pop = fc.ui.popover(anchor, box, { side: 'top', width: 300, cls: 'fc-pop-card' });
    const name = box.querySelector('.fcupName');
    const save = () => {
        const n = name.value.trim();
        if (n && n !== it.name) { it.name = n; it.renamed = true; }
        it.spoiler = box.querySelector('.fcupSp input').checked;
        pop.close();
        renderTray();
    };
    ['keydown', 'keypress', 'keyup'].forEach(ev => name.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Enter') save(); }));
    box.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="tr-cancel"]')) pop.close();
        else if (e.target.closest('[data-act="tr-save"]')) save();
    });
    setTimeout(() => { name.focus(); name.select(); }, 30);
}

// Enter: every file goes up in turn (its tile fills), then out: what you typed with the first link,
// the others after it (Fightcade turns down messages sent too fast)
async function go() {
    const t = tray;
    if (!t || t.busy || !t.items.length) return;
    t.busy = true;
    t.el.classList.add('busy');
    const links = [];
    for (const it of t.items.slice()) {
        if (tray !== t) return;
        it.err = false;
        if (it.el) it.el.classList.add('up');
        const bar = it.el && it.el.querySelector('.bar > b');
        try {
            const p = await prepare(it.file);
            it.job = uploadRetry(p.data, p.type, (f) => { if (bar) bar.style.width = Math.round(f * 100) + '%'; },
                { onRetry: (n, host) => fc.log('upload: trying ' + host + ' again (' + n + ')') });
            const got = await it.job.promise;
            it.job = null;
            if (got.host === 'uguu') fc.ui.toast(T('Sent through uguu.se: catbox.moe is down'), { icon: 'share', sub: T('This one disappears after 3 hours.') });
            if (got.host === 'blossom') mirror(p.data, p.type, got).then(m => fc.log('upload: copy on ' + (m || 'no other server')));
            links.push(got.url + fragment(it));
            URL.revokeObjectURL(it.url);
            t.items = t.items.filter(x => x !== it);
            if (it.el) it.el.remove();
        } catch (e) {
            it.job = null;
            if (tray !== t || /cancelled/.test(e.message)) return;
            it.err = true;
            fc.ui.toast(T('Upload failed'), { kind: 'danger', icon: 'warn', sub: e.message });
            break;
        }
    }
    if (tray === t) {
        t.busy = false;
        t.el.classList.remove('busy');
        if (t.items.length) renderTray(); else closeTray();
    }
    for (let i = 0; i < links.length; i++) {
        if (i) await new Promise(r => setTimeout(r, 1100));
        send(t.input, links[i]);
    }
}

// the link into the chat box, then Enter (the same way chat macros send)
function send(input, link) {
    const el = input && input.isConnected ? input : fc.app.chatInput();
    if (!el) { fc.ui.copy(link); fc.ui.toast(T('Uploaded: the link is copied'), { icon: 'link' }); return; }
    fc.app.setChatText(joinText(el.value, link));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
}

/* -------------------------------------------------------- paste, drop, + button */

// clipboard items / dropped files -> the first real file (pasted text is no file: Fightcade pastes it)
function fileFrom(list) {
    const files = [...(list || [])].map(it => (it && typeof it.getAsFile === 'function' ? (it.kind === 'file' ? it.getAsFile() : null) : it))
        .filter(f => f && typeof f.size === 'number' && typeof f.type === 'string');
    return files.find(f => typeOf(f)) || files[0] || null;
}

function onPaste(e) {
    const input = e.target && e.target.closest && e.target.closest('.chatInput') ? e.target : null;
    if (!input || !cfg.enabled || !e.clipboardData) return;
    const f = fileFrom(e.clipboardData.items);
    if (!f) return;                                       // plain text: Fightcade's paste
    e.preventDefault();
    e.stopPropagation();
    offer(f, input);
}

// Enter in the message box with files in the tray: they go up, then out with what you typed
// (only real key presses: the Enter that sends the link is ours)
function onKey(e) {
    if (!tray || !tray.items.length || !e.isTrusted || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    if (!(e.target && e.target.closest && e.target.closest('.chatInput') === tray.wrap)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    go();
}

let dropEl = null, dragDepth = 0;
const hasFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].indexOf('Files') >= 0);
function chatArea(e) { return e.target && e.target.closest ? e.target.closest('.chatWrapper, .channelContent') : null; }
function showDrop(area) {
    if (!dropEl) {
        dropEl = document.createElement('div');
        dropEl.id = 'fcupDrop';
        dropEl.innerHTML = `<div>${fc.ui.icon('share')}<b>${E(T('Drop to send to the chat'))}</b><span>${E(T('Pictures, GIFs, clips and audio · Fightcord players see them'))}</span></div>`;
        document.body.appendChild(dropEl);
    }
    const r = area.getBoundingClientRect();
    Object.assign(dropEl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', display: 'flex' });
}
function hideDrop() { if (dropEl) dropEl.style.display = 'none'; dragDepth = 0; }
function onDragEnter(e) { if (!cfg.enabled || !hasFiles(e)) return; const a = chatArea(e); if (!a) return; dragDepth++; showDrop(a); }
function onDragOver(e) { if (!cfg.enabled || !hasFiles(e) || !chatArea(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
function onDragLeave(e) { if (!dropEl || !hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hideDrop(); }
function onDrop(e) {
    if (!cfg.enabled || !hasFiles(e)) return;
    const a = chatArea(e);
    hideDrop();
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const w = a.closest('.channelWrapper') || document;
    const box = w.querySelector('.chatInput input.input') || fc.app.chatInput();
    [...(e.dataTransfer.files || [])].slice(0, TRAY_MAX).forEach(f => offer(f, box));
}

// the + on the left of the message box, like Discord's
function ensureButtons() {
    document.querySelectorAll('.chatInput').forEach(wrap => {
        let btn = wrap.querySelector('.fcupBtn');
        if (!cfg.enabled) { if (btn) btn.remove(); return; }
        const input = wrap.querySelector('input.input');
        if (!input) return;
        if (!btn) {
            if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
            btn = document.createElement('div');
            btn.className = 'fcupBtn';
            btn.title = T('Send a picture, GIF or clip');
            btn.innerHTML = fc.ui.icon('plus');
            btn.addEventListener('mousedown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => { e.stopPropagation(); pick(input); });
            wrap.appendChild(btn);
        }
        const left = input.offsetLeft + 10;
        if (btn.style.left !== left + 'px') btn.style.left = left + 'px';
        if (parseFloat(getComputedStyle(input).paddingLeft) < 44) input.style.setProperty('padding-left', '48px', 'important');
        // the GIF button: left of the emoji (and font style) buttons, whichever of those sits
        // furthest left (where they really are)
        const wr = wrap.getBoundingClientRect();
        const lefts = [...wrap.querySelectorAll('.emojiBtn, .fontStyleBtn')].map(b => b.getBoundingClientRect()).filter(r => r.width).map(r => r.left);
        let right = Math.round(lefts.length ? wr.right - Math.min(...lefts) + 6 : 12);
        const place = (cls, on, make) => {
            let el = wrap.querySelector('.' + cls);
            if (!on) { if (el) el.remove(); return; }
            if (!el) {
                el = make();
                el.className = cls;
                el.addEventListener('mousedown', (e) => e.stopPropagation());
                wrap.appendChild(el);
            }
            if (el.style.right !== right + 'px') el.style.right = right + 'px';
            right += el.offsetWidth + 8;
        };
        place('fcupGifBtn', cfg.gifButton, () => {
            const gif = document.createElement('div');
            gif.textContent = 'GIF';
            gif.title = T('Your favorite GIFs');
            gif.addEventListener('click', (e) => { e.stopPropagation(); openPicker(gif, wrap.querySelector('input.input')); });
            return gif;
        });
        if (parseFloat(getComputedStyle(input).paddingRight) < right) input.style.setProperty('padding-right', right + 'px', 'important');
    });
}

/* ------------------------------------------------------------- GIF search */

function getPage(url, redirects) {
    return new Promise((resolve, reject) => {
        let https = null;
        try { https = require('https'); } catch (e) { reject(new Error('no network here')); return; }
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'en' }, timeout: 10000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 3) {
                res.resume();
                const next = new URL(res.headers.location, url);
                if (next.hostname !== new URL(url).hostname) { reject(new Error('redirected away')); return; }
                resolve(getPage(next.href, (redirects || 0) + 1));
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; if (body.length > 3 * 1024 * 1024) req.destroy(); });
            res.on('end', () => resolve(body));
            res.on('close', () => resolve(body));
        });
        req.on('timeout', () => req.destroy(new Error('timed out')));
        req.on('error', reject);
    });
}

// a per-install id for KLIPY's searches (they ask for one; random, nothing about you)
function klipyUser() {
    if (!cfg.klipyId) {
        let id = '';
        try { id = require('crypto').randomBytes(8).toString('hex'); } catch (e) { for (let i = 0; i < 16; i++) id += Math.floor(Math.random() * 16).toString(16); }
        cfg.klipyId = id;
        store.save();
    }
    return cfg.klipyId;
}

const searchCache = new Map();          // search -> { at, source, results }
// -> { source: 'klipy' | 'tenor', results }. KLIPY first; Tenor's page if KLIPY fails
function searchGifs(q, get) {
    const words = String(q || '').trim().replace(/\s+/g, ' ');
    if (!words) return Promise.resolve({ source: '', results: [] });
    const key = words.toLowerCase();
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60000) return Promise.resolve(hit);
    // (the dev harness has no network module: it hands in window.__fcupGet)
    const fetch_ = get || (typeof window !== 'undefined' && window.__fcupGet) || getPage;
    const keep = (r) => { searchCache.set(key, Object.assign({ at: Date.now() }, r)); if (searchCache.size > 40) searchCache.delete(searchCache.keys().next().value); return r; };
    const fromTenor = () => fetch_(tenorSearchUrl(words)).then(html => keep({ source: 'tenor', results: parseTenor(html) }));
    const klipyUrl = KLIPY + '/gifs/search?page=1&per_page=40&q=' + encodeURIComponent(words) + '&customer_id=' + (cfg ? klipyUser() : 'test') + '&content_filter=medium';
    return fetch_(klipyUrl).then(text => {
        const json = JSON.parse(text);
        if (!json || json.result !== true) throw new Error('KLIPY said no');
        return keep({ source: 'klipy', results: parseKlipy(json, 'gifs') });
    }).catch(e => { if (typeof fc !== 'undefined' && fc) fc.log('KLIPY search failed, trying Tenor:', e.message); return fromTenor(); });
}
// KLIPY asks apps to say when one of its GIFs is shared (helps their ranking); fire and forget
function klipyShared(link, q) {
    const k = klipySlug(link);
    if (!k) return;
    try {
        const body = JSON.stringify({ customer_id: klipyUser(), q: q || '' });
        const req = require('https').request(KLIPY + '/' + k.type + '/share/' + encodeURIComponent(k.slug), { method: 'POST', timeout: 8000,
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => res.resume());
        req.on('error', () => {});
        req.on('timeout', () => req.destroy());
        req.end(body);
    } catch (e) { /* not important */ }
}

/* ---------------------------------------------------------------- favorites */

const isFav = (link) => !!link && cfg.favorites.some(f => f.link === link);
// item: { link (what gets sent), src (what shows), kind: 'image' | 'gifv', still } (videos and audio aren't GIFs: no favorites)
function toggleFav(item) {
    if (!item || !item.link || !item.src || (item.kind && item.kind !== 'image' && item.kind !== 'gifv')) return false;
    const on = !isFav(item.link);
    cfg.favorites = cfg.favorites.filter(f => f.link !== item.link);
    if (on) cfg.favorites.unshift({ link: item.link, src: item.src, kind: item.kind || 'image', still: item.still || '', name: nameOf(item.link), at: Date.now() });
    if (cfg.favorites.length > FAV_MAX) cfg.favorites.length = FAV_MAX;
    store.save();
    fc.emit('gifs:changed', { link: item.link, on });
    if (on) fc.ui.toast(T('Added to your favorites'), { icon: 'star', sub: T('The GIF button in the message box has them') });
    return on;
}

// one tile: a favourite or a search result (i = its place in the picker's list)
function favHtml(f, i) {
    const media = f.kind === 'gifv'
        ? `<video src="${E(f.src)}" autoplay muted loop playsinline${f.still ? ` poster="${E(f.still)}"` : ''}></video>`
        : `<img src="${E(f.src)}" alt="" loading="lazy">`;
    const on = isFav(f.link);
    return `<div class="fcupFav${on ? ' on' : ''}" data-fav="${i}" title="${E(f.name || T('Send'))}">${media}<span class="star" data-unfav="${i}" title="${E(T(on ? 'Remove from favorites' : 'Add to favorites'))}">${fc.ui.icon('star', on ? 'fill' : '')}</span></div>`;
}

let picker = null;
function openPicker(btn, input) {
    if (picker) { picker.close(); return; }
    const box = document.createElement('div');
    box.className = 'fcupPicker';
    let shown = [], found = null, busy = false, err = '', timer = 0, ask = 0;
    // the list: favourites matching the search, then (for a search) Tenor's results
    const draw = () => {
        const q = search.value.trim();
        const favs = searchFavs(cfg.favorites, q);
        const more = q && found ? found.results.filter(r => !favs.some(x => x.link === r.link)) : [];
        shown = favs.concat(more);
        const sec = (title, from, list) => `<div class="fcupSec">${E(title)}</div><div class="fcupGrid">${list.map((x, k) => favHtml(x, from + k)).join('')}</div>`;
        let html = '';
        if (favs.length) html += sec(T('Favorites'), 0, favs);
        else if (!q) html += fc.ui.empty({ icon: 'star', title: T('No favorites yet'), sub: T('Hover a GIF or picture in the chat and click its star, or search for GIFs above.') });
        if (q) {
            if (more.length) html += sec(found.source === 'klipy' ? 'KLIPY' : 'Tenor', favs.length, more);
            else if (busy) html += `<div class="fcupMsg">${E(T('Searching GIFs…'))}</div>`;
            else if (err) html += `<div class="fcupMsg bad">${E(T('Couldn’t search GIFs ({error})', { error: err }))}</div>`;
            else if (found && !favs.length) html += fc.ui.empty({ icon: 'search', title: T('No GIFs found') });
        }
        box.querySelector('.fcupList').innerHTML = html;
    };
    const run = () => {
        const q = search.value.trim();
        const mine = ++ask;
        found = null; err = ''; busy = !!q;
        draw();
        if (!q) return;
        searchGifs(q).then(r => { if (mine !== ask) return; found = r; busy = false; draw(); })
            .catch(e => { if (mine !== ask) return; busy = false; err = e.message; draw(); });
    };
    box.innerHTML = fc.ui.popHead({ icon: 'star', title: T('GIFs'), sub: E(fc.t.plural(cfg.favorites.length, '{n} favorite', '{n} favorites')) }) +
        `<div class="fc-pb"><input class="fc-input fcupSearch" placeholder="${E(T('Search KLIPY and your favorites'))}"><div class="fcupList"></div><div class="fcupBy">Powered by KLIPY</div></div>`;
    const search = box.querySelector('.fcupSearch');
    draw();
    // favourites filter as you type; Tenor once you stop typing
    search.addEventListener('input', () => { clearTimeout(timer); found = null; err = ''; busy = !!search.value.trim(); draw(); timer = setTimeout(run, 450); });
    search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && shown[0]) { sendFav(shown[0]); } });
    search.addEventListener('keypress', (e) => e.stopPropagation());
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
        const un = e.target.closest('[data-unfav]');
        if (un) { e.stopPropagation(); const f = shown[+un.dataset.unfav]; if (f) { toggleFav(f); draw(); } return; }
        const it = e.target.closest('[data-fav]');
        if (it) { const f = shown[+it.dataset.fav]; if (f) sendFav(f); }
    });
    const sendFav = (f) => { const q = search.value.trim(); if (picker) picker.close(); send(input, f.link); klipyShared(f.link, q); };
    const me = picker = fc.ui.popover(btn, box, { side: 'top', width: 420, cls: 'fc-pop-card fcupPick', onClose: () => { clearTimeout(timer); ask++; if (picker === me) picker = null; } });
    setTimeout(() => search.focus(), 30);
}

function pick(input) {
    const f = document.createElement('input');
    f.type = 'file';
    f.accept = Object.keys(TYPES).concat(Object.keys(BY_EXT).map(x => '.' + x)).join(',');
    f.multiple = true;
    f.addEventListener('change', () => { [...(f.files || [])].slice(0, TRAY_MAX).forEach(x => offer(x, input)); });
    f.click();
}

const CSS = `
.fcupBtn { position: absolute; top: 50%; z-index: 50; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
    margin-top: -12px; border-radius: 50%; cursor: pointer; background: var(--fc-muted); color: var(--fc-s2); transition: background var(--fc-fast); }
.fcupBtn:hover { background: var(--fc-head); }
.fcupGifBtn { position: absolute; top: 50%; z-index: 50; height: 20px; margin-top: -10px; padding: 0 5px; border-radius: 4px; cursor: pointer; user-select: none;
    background: var(--fc-muted); color: var(--fc-s2); font: 800 11px/20px var(--fc-font); letter-spacing: .02em; opacity: .85; }
.fcupGifBtn:hover { background: var(--fc-head); opacity: 1; }
.fcupSearch { width: 100%; box-sizing: border-box; margin-bottom: 8px; }
.fcupList { height: 380px; overflow-y: auto; }
.fcupSec { margin: 4px 0 6px; font: 700 12px/1 var(--fc-font); letter-spacing: .02em; text-transform: uppercase; color: var(--fc-muted); }
.fcupGrid { column-count: 2; column-gap: 8px; }
.fcupMsg { padding: 24px 8px; text-align: center; font-size: 13px; color: var(--fc-muted); }
.fcupMsg.bad { color: var(--fc-danger); }
.fcupBy { margin-top: 6px; text-align: right; font: 600 10px/1 var(--fc-font); letter-spacing: .04em; color: var(--fc-faint, var(--fc-muted)); }
.fcupGrid .fc-empty { column-span: all; }
.fcupFav { position: relative; margin-bottom: 8px; border-radius: 6px; overflow: hidden; cursor: pointer; line-height: 0; background: var(--fc-s1); break-inside: avoid; }
.fcupFav img, .fcupFav video { width: 100%; height: auto; display: block; }
.fcupFav:hover { box-shadow: 0 0 0 2px var(--fc-accent); }
.fcupFav .star { position: absolute; top: 6px; right: 6px; display: none; padding: 4px; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; line-height: 0; }
.fcupFav.on .star { color: var(--fc-warning); }
.fcupFav:hover .star { display: block; }
.fcupFav .star .fc-ic { width: 16px; height: 16px; }
.fcupBtn .fc-ic { width: 16px; height: 16px; stroke-width: 3; }
/* the tray on top of the message box (3.4) */
.fcupTray { position: absolute; z-index: 55; display: flex; flex-wrap: wrap; align-items: flex-start; box-sizing: border-box; padding: 20px 16px 6px;
    border-radius: 10px 10px 0 0; background: var(--fc-input, #383a40); box-shadow: 0 -1px 0 var(--fc-divider); }
html body .chatInput.fcupTrayOn input.input { border-top-left-radius: 0 !important; border-top-right-radius: 0 !important; }
.fcupTile { position: relative; width: 216px; margin: 0 12px 10px 0; padding: 8px; box-sizing: border-box; border-radius: var(--fc-r2);
    background: var(--fc-s2); box-shadow: inset 0 0 0 1px var(--fc-divider); animation: fcPop var(--fc-fast) var(--fc-ease) both; }
.fcupTile .th { position: relative; display: flex; align-items: center; justify-content: center; height: 200px; overflow: hidden; border-radius: 6px;
    background: var(--fc-s1); line-height: 0; }
.fcupTile .th img, .fcupTile .th video { max-width: 100%; max-height: 100%; object-fit: contain; }
.fcupTile .th .au .fc-ic { width: 48px; height: 48px; color: var(--fc-accent); }
.fcupTile.spoiler .th img, .fcupTile.spoiler .th video { filter: blur(18px); transform: scale(1.08); }
.fcupTile .sp { position: absolute; padding: 4px 10px; border-radius: 12px; background: rgba(0,0,0,.65); color: #fff; font: 800 11px/1.2 var(--fc-font);
    letter-spacing: .06em; text-transform: uppercase; }
.fcupTile .nm { margin-top: 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: 13px/18px var(--fc-font); color: var(--fc-text); }
.fcupTile .bar { position: absolute; left: 8px; right: 8px; bottom: 8px; height: 4px; border-radius: 2px; background: rgba(0,0,0,.5); overflow: hidden; display: none; }
.fcupTile .bar > b { display: block; width: 0; height: 100%; background: var(--fc-accent); transition: width .15s; }
.fcupTile.up .bar { display: block; }
.fcupTile.err { box-shadow: inset 0 0 0 2px var(--fc-danger); }
/* the toolbar on the tile's corner: spoiler, name, remove */
.fcupTb { position: absolute; top: -12px; right: -10px; display: flex; padding: 2px; border-radius: var(--fc-r2); background: var(--fc-s0);
    box-shadow: 0 0 0 1px var(--fc-divider), var(--fc-sh2); }
.fcupTb > span { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; color: var(--fc-text); }
.fcupTb > span:hover { background: var(--fc-s4); color: var(--fc-head); }
.fcupTb > span .fc-ic { width: 20px; height: 20px; }
.fcupTb > span.bad { color: var(--fc-danger); }
.fcupTb > span.bad:hover { background: var(--fc-danger); color: #fff; }
.fcupTb { opacity: 0; pointer-events: none; transition: opacity var(--fc-fast) ease; }
.fcupTile:hover .fcupTb { opacity: 1; pointer-events: auto; }
.fcupTray.busy .fcupTb { display: none; }
.fcupTrayNote { flex: 1 1 100%; font: 12px/18px var(--fc-font); color: var(--fc-muted); }
.fcupName { width: 100%; }
.fcupSp { display: flex; align-items: center; margin-top: 10px; font-size: 13px; color: var(--fc-text); cursor: pointer; }
.fcupSp input { margin: 0 8px 0 0; }
#fcupDrop { position: fixed; z-index: var(--fc-z-pop); display: none; align-items: center; justify-content: center; pointer-events: none;
    background: rgba(88,101,242,.18); box-shadow: inset 0 0 0 3px var(--fc-accent); border-radius: 8px; }
#fcupDrop > div { display: flex; flex-direction: column; align-items: center; padding: 24px 32px; border-radius: var(--fc-r3); background: var(--fc-accent); color: #fff; text-align: center; }
#fcupDrop .fc-ic { width: 36px; height: 36px; margin-bottom: 8px; }
#fcupDrop b { font: 700 18px/1.3 var(--fc-font); }
#fcupDrop span { margin-top: 4px; font: 13px/1.3 var(--fc-font); opacity: .85; }
`;

function start(f) {
    fc = f;
    store = fc.config('uploads', { enabled: true, gifButton: true, favorites: [] });
    cfg = store.data;
    if (!Array.isArray(cfg.favorites)) cfg.favorites = [];
    // (before 2.17 a video could be starred like a GIF)
    if (cfg.favorites.some(f => f && f.kind === 'clip')) { cfg.favorites = cfg.favorites.filter(f => f && f.kind !== 'clip'); store.save(); }
    setTimeout(() => fc.emit('gifs:changed', {}), 0);           // stars on the GIFs already in the chat
    fc.ui.style('fcupStyle', CSS);
    const listen = (t, ev, fn, cap) => { t.addEventListener(ev, fn, cap); fc.own(() => t.removeEventListener(ev, fn, cap)); };
    listen(document, 'paste', onPaste, true);
    listen(window, 'keydown', onKey, true);
    listen(document, 'dragenter', onDragEnter, true);
    listen(document, 'dragover', onDragOver, true);
    listen(document, 'dragleave', onDragLeave, true);
    listen(document, 'drop', onDrop, true);
    fc.watch(ensureButtons, { selector: '.chatInput' });
    fc.tick(ensureButtons, 2000);                      // the emoji / font buttons place themselves too
    fc.own(() => {
        closeTray();
        if (dropEl) dropEl.remove();
        if (picker) picker.close();
        document.querySelectorAll('.fcupBtn, .fcupGifBtn').forEach(b => b.remove());
        document.querySelectorAll('.chatInput input.input').forEach(i => { i.style.removeProperty('padding-left'); i.style.removeProperty('padding-right'); });
        fc.ui.style('fcupStyle', null);
    });
    fc.settings.block({
        id: 'uploads', section: 'chat', title: 'Pictures in chat', hint: '— send pictures, GIFs, clips and audio (Fightcord players see them)', store, order: 12,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Send pictures, GIFs, clips and audio', hint: 'Paste one into the message box, drop it on the chat, or click the +',
                onChange: () => ensureButtons() },
            { key: 'gifButton', type: 'switch', label: 'GIF button with your favorites', hint: 'Star a GIF or picture in the chat to keep it; the GIF button sends it again', onChange: () => ensureButtons() },
            { type: 'note', label: 'Fightcade’s chat only carries text, so a file goes to catbox.moe (free, no account) and its link is sent; when catbox is down it goes to uguu.se instead, which deletes it after 3 hours. Fightcord players see the picture or hear the audio; others see the link. Anyone with the link can open it. Photos are redrawn first, which removes hidden details like location.' }
        ]
    });
    return api;
}

const api = {
    offer: (file, input) => offer(file, input),
    isFav: (link) => !!cfg && isFav(link),
    toggleFav: (item) => toggleFav(item),
    favorites: () => (cfg ? cfg.favorites.slice() : []),
    openPicker: (btn, input) => openPicker(btn, input),
    searchGifs: (q, get) => searchGifs(q, get),
    _tray: () => tray
};

module.exports = { id: 'uploads', name: 'Pictures in chat', start, checkFile, uploadRetry, stored, uguuUrl, blossomUrl, blossomAuth, mirror, BLOSSOM_MAX, typeOf, audioTag, catboxUrl, joinText, multipart, upload, fileFrom, nameOf, searchFavs, tenorSearchUrl, parseTenor, klipySlug, klipyPick, parseKlipy, KLIPY, TYPES, MAX };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
