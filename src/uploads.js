/**
 * Fightcord image uploads (Fightcord-only)
 *
 * Paste an image into the chat box, drag one onto the chat, or click the + next to the message
 * box: you see it first, then Upload sends it. Fightcade's chat only carries text, so the file goes
 * to catbox.moe (free, no account) and the message is its link. Everyone with Fightcord sees the
 * picture / GIF / clip in the chat (chat-extras.js); everyone else sees the link.
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
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

/* ---------------------------------------------------------------- pure parts */

// a file -> '' if it can go, else why not
function checkFile(f) {
    if (!f) return T('Nothing to upload');
    if (!TYPES[f.type]) return T('Only pictures, GIFs and clips (png, jpg, gif, webp, mp4, webm, mov)');
    if (!(f.size > 0)) return T('That file is empty');
    if (f.size > MAX) return T('Too big: up to {mb} MB', { mb: MAX / 1048576 });
    return '';
}
// what catbox answers -> the link, or null (it answers errors as plain text too)
function catboxUrl(text) {
    const t = String(text || '').trim();
    return /^https:\/\/files\.catbox\.moe\/[A-Za-z0-9_-]+\.[A-Za-z0-9]{2,5}$/.test(t) ? t : null;
}
// what's typed + the link (the link last, so the picture follows the words)
function joinText(cur, url) {
    const c = String(cur || '').trim();
    return c ? c + ' ' + url : url;
}
// multipart/form-data: the fields, then the file
function multipart(boundary, fields, file) {
    const parts = [];
    Object.keys(fields).forEach(k => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${fields[k]}\r\n`)));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
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

// -> { promise, cancel }. opts.request: https.request (the tests pass a fake)
function upload(data, type, onProgress, opts) {
    const o = opts || {};
    const request = o.request || require('https').request;
    const boundary = '----fightcord' + Math.random().toString(16).slice(2);
    const name = 'fightcord.' + (TYPES[type] || 'bin');
    const body = multipart(boundary, { reqtype: 'fileupload' }, { name, type, data });
    let req = null, cancelled = false;
    const promise = new Promise((resolve, reject) => {
        req = request(o.url || API, { method: 'POST', timeout: 120000,
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length, 'User-Agent': 'Fightcord' } }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; if (text.length > 4096) req.destroy(); });
            res.on('end', () => {
                const url = catboxUrl(text);
                if (res.statusCode === 200 && url) resolve(url);
                else reject(new Error(text.trim().slice(0, 120) || 'HTTP ' + res.statusCode));
            });
        });
        req.on('timeout', () => req.destroy(new Error('timed out')));
        req.on('error', (e) => reject(cancelled ? new Error('cancelled') : e));
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

// photos lose their hidden details (EXIF: location, camera) by being redrawn; GIFs / clips go as they are
async function prepare(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return { data: Buffer.from(await file.arrayBuffer()), type: file.type };
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

let card = null;          // { pop, file, input, job, url (object URL) }

function chatInputOf(el) {
    const w = el && el.closest ? el.closest('.chatInput') : null;
    return (w && w.querySelector('input.input, input')) || fc.app.chatInput();
}

function closeCard() {
    if (!card) return;
    const c = card;
    card = null;
    if (c.job) c.job.cancel();
    if (c.url) URL.revokeObjectURL(c.url);
    c.pop.close();
}

function offer(file, input) {
    if (!cfg.enabled) return;
    const why = checkFile(file);
    if (why) { fc.ui.toast(why, { kind: 'warning', icon: 'warn' }); return; }
    closeCard();
    const url = URL.createObjectURL(file);
    const clip = /^video\//.test(file.type);
    const box = document.createElement('div');
    box.className = 'fcupCard';
    box.innerHTML = fc.ui.popHead({ icon: 'share', title: T('Send to the chat'), sub: E(fmtSize(file.size) + ' · ' + (TYPES[file.type] || '').toUpperCase()) }) +
        `<div class="fc-pb"><div class="fcupPrev">${clip ? `<video src="${E(url)}" muted autoplay loop playsinline></video>` : `<img src="${E(url)}" alt="">`}</div>` +
        `<div class="fcupBar"><i></i></div><div class="fcupNote">${E(T('Fightcord players see it in the chat; others see a link. It goes to catbox.moe: public to anyone with the link.'))}</div></div>` +
        fc.ui.popFoot(E(T('Enter to send · Esc to cancel')), fc.ui.btn('Cancel', { kind: 'ghost', size: 'sm', act: 'up-cancel' }) + fc.ui.btn('Upload', { kind: 'brand', size: 'sm', icon: 'share', act: 'up-go' }));
    box.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="up-cancel"]')) closeCard();
        else if (e.target.closest('[data-act="up-go"]')) go();
    });
    const anchor = (input && input.isConnected && input) || { x: window.innerWidth / 2 - 180, y: window.innerHeight - 80 };
    const pop = fc.ui.popover(anchor, box, { side: 'top', width: 360, cls: 'fc-pop-card fcupPop', onClose: () => { if (card && card.pop === pop) { const c = card; card = null; if (c.job) c.job.cancel(); URL.revokeObjectURL(c.url); } } });
    card = { pop, file, input, url, box };
}

async function go() {
    const c = card;
    if (!c || c.job) return;
    const btn = c.box.querySelector('[data-act="up-go"]');
    if (btn) { btn.disabled = true; btn.lastChild.textContent = T('Uploading…'); }
    c.box.classList.add('busy');
    const bar = c.box.querySelector('.fcupBar > i');
    try {
        const p = await prepare(c.file);
        if (card !== c) return;
        c.job = upload(p.data, p.type, (f) => { if (bar) bar.style.width = Math.round(f * 100) + '%'; });
        const link = await c.job.promise;
        if (card !== c) return;
        c.job = null;
        closeCard();
        send(c.input, link);
    } catch (e) {
        if (card !== c || /cancelled/.test(e.message)) return;
        c.job = null;
        c.box.classList.remove('busy');
        if (btn) { btn.disabled = false; btn.lastChild.textContent = T('Try again'); }
        fc.ui.toast(T('Upload failed'), { kind: 'danger', icon: 'warn', sub: e.message });
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
    return files.find(f => TYPES[f.type]) || files[0] || null;
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

// Enter / Esc while the card is up: upload / cancel instead of sending the chat line
// (only real key presses: the Enter that sends the link is ours)
function onKey(e) {
    if (!card || !e.isTrusted || e.key !== 'Enter' || e.shiftKey) return;
    if (!(e.target && e.target.closest && (e.target.closest('.chatInput') || e.target.closest('.fcupCard')))) return;
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
        dropEl.innerHTML = `<div>${fc.ui.icon('share')}<b>${E(T('Drop to send to the chat'))}</b><span>${E(T('Pictures, GIFs and clips · Fightcord players see them'))}</span></div>`;
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
    const f = fileFrom(e.dataTransfer.files);
    const w = a.closest('.channelWrapper') || document;
    offer(f, (w.querySelector('.chatInput input.input') || fc.app.chatInput()));
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
        // the GIF button: left of the emoji (and font style) buttons
        let gif = wrap.querySelector('.fcupGifBtn');
        if (!cfg.gifButton) { if (gif) gif.remove(); return; }
        if (!gif) {
            gif = document.createElement('div');
            gif.className = 'fcupGifBtn';
            gif.textContent = 'GIF';
            gif.title = T('Your favorite GIFs');
            gif.addEventListener('mousedown', (e) => e.stopPropagation());
            gif.addEventListener('click', (e) => { e.stopPropagation(); openPicker(gif, wrap.querySelector('input.input')); });
            wrap.appendChild(gif);
        }
        // left of whichever of the emoji / font style buttons sits furthest left (where they really are)
        const wr = wrap.getBoundingClientRect();
        const lefts = [...wrap.querySelectorAll('.emojiBtn, .fontStyleBtn')].map(b => b.getBoundingClientRect()).filter(r => r.width).map(r => r.left);
        const right = Math.round(lefts.length ? wr.right - Math.min(...lefts) + 6 : 12);
        if (gif.style.right !== right + 'px') gif.style.right = right + 'px';
        const need = right + gif.offsetWidth + 8;
        if (parseFloat(getComputedStyle(input).paddingRight) < need) input.style.setProperty('padding-right', need + 'px', 'important');
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
const klipyUser = () => { if (!cfg.klipyId) { cfg.klipyId = require('crypto').randomBytes(8).toString('hex'); store.save(); } return cfg.klipyId; };

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
// item: { link (what gets sent), src (what shows), kind: 'image' | 'gifv' | 'clip', still }
function toggleFav(item) {
    if (!item || !item.link || !item.src) return false;
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
    const media = f.kind === 'gifv' || f.kind === 'clip'
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
    f.accept = Object.keys(TYPES).join(',');
    f.addEventListener('change', () => { if (f.files && f.files[0]) offer(f.files[0], input); });
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
.fcupPrev { display: flex; align-items: center; justify-content: center; height: 200px; padding: 8px; box-sizing: border-box; border-radius: var(--fc-r2); background: var(--fc-s1); line-height: 0; }
.fcupPrev img, .fcupPrev video { max-width: 100%; max-height: 184px; border-radius: 6px; object-fit: contain; }
.fcupBar { height: 4px; margin-top: 8px; border-radius: 2px; background: var(--fc-s4); overflow: hidden; visibility: hidden; }
.fcupBar > i { display: block; width: 0; height: 100%; background: var(--fc-accent); transition: width .15s; }
.fcupCard.busy .fcupBar { visibility: visible; }
.fcupNote { margin-top: 8px; font-size: 12px; line-height: 1.4; color: var(--fc-muted); }
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
        closeCard();
        if (dropEl) dropEl.remove();
        if (picker) picker.close();
        document.querySelectorAll('.fcupBtn, .fcupGifBtn').forEach(b => b.remove());
        document.querySelectorAll('.chatInput input.input').forEach(i => { i.style.removeProperty('padding-left'); i.style.removeProperty('padding-right'); });
        fc.ui.style('fcupStyle', null);
    });
    fc.settings.block({
        id: 'uploads', section: 'chat', title: 'Pictures in chat', hint: '— send pictures, GIFs and clips (Fightcord players see them)', store, order: 12,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Send pictures, GIFs and clips', hint: 'Paste one into the message box, drop it on the chat, or click the +',
                onChange: () => ensureButtons() },
            { key: 'gifButton', type: 'switch', label: 'GIF button with your favorites', hint: 'Star a GIF or picture in the chat to keep it; the GIF button sends it again', onChange: () => ensureButtons() },
            { type: 'note', label: 'Fightcade’s chat only carries text, so a picture goes to catbox.moe (free, no account) and its link is sent. Fightcord players see the picture; others see the link. Anyone with the link can open it, and catbox keeps it. Photos are redrawn first, which removes hidden details like location.' }
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
    _card: () => card
};

module.exports = { id: 'uploads', name: 'Pictures in chat', start, checkFile, catboxUrl, joinText, multipart, upload, fileFrom, nameOf, searchFavs, tenorSearchUrl, parseTenor, klipySlug, klipyPick, parseKlipy, KLIPY, TYPES, MAX };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
