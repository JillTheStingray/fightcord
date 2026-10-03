/**
 * Fightcord chat extras (Discord-style)
 *
 *   - Mentions: lines that @ you get Discord's yellow highlight
 *   - NEW line: a red "NEW" divider where you left off when you come back to a channel
 *   - Hover actions: Reply, Copy, Translate, Profile on any message
 *   - Link previews: YouTube / Twitch / X / imgur / Fightcade links get an embed card
 *   - Jump to present: a bar to get back down when you've scrolled up
 *   - Polish: Discord timestamps, rank-coloured names, slide-in, time dividers, compact
 *     system messages
 *
 * Everything is local -- nothing here changes what others see.
 *
 * Link previews only ever load from a fixed list of well-known sites. A preview means
 * fetching the link from YOUR connection, and a link from a stranger to some unknown domain
 * is exactly how IP grabbers work. Discord avoids that by fetching on its servers; we can't,
 * so unknown domains get no preview.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // chat-extras-config.json

const DEFAULTS = {
    mentions: true,
    newLine: true,
    hoverActions: true,
    linkPreviews: true,
    imagePreviews: true,
    jumpBar: true,
    discordTime: true,     // "10:16 PM" instead of "at 22:16"
    hour12: true,
    animate: true,         // new messages slide in
    rankColors: true,      // names in the colour of their channel rank
    systemCards: true,     // challenge / match messages as compact pills and cards
    timeDividers: true     // a divider when 20+ minutes pass between messages
};

const E = (s) => fc.fmt.esc(s);
const mod = (id) => fc.modules.get(id);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------ helpers */

function authorOf(wrap) {
    if (!wrap) return '';
    if (wrap.dataset.currentUser) return wrap.dataset.currentUser;
    const a = wrap.querySelector('header .author');
    return ((a && a.firstChild && a.firstChild.textContent) || '').trim();
}

// The line's own text, without what plugins appended (translations, embeds).
function lineText(line) {
    const bc = line.querySelector('.blocksContainer');
    if (!bc) return '';
    let t = '';
    bc.childNodes.forEach(n => {
        if (!(n.classList && (n.classList.contains('fcTr') || n.classList.contains('fcxEmbed')))) t += n.textContent;
    });
    return t.replace(/\s+/g, ' ').trim();
}

const visibleChats = () => [...document.querySelectorAll('.chatContent')].filter(c => c.offsetParent !== null);

/* ----------------------------------------------------------------- mentions */

// Fightcade renders every @mention as `.blocks .user` (whoever it names); `.highlight` is NOT
// a mention -- it's Fightcade's emphasis formatting (the MOTD headings use it too).
let nameRe = null, nameFor = null;
function mentionsMe(line, me) {
    if (!me) return false;
    const lme = me.toLowerCase();
    for (const u of line.querySelectorAll('.blocks .user')) {
        if (u.textContent.trim().replace(/^@/, '').toLowerCase() === lme) return true;
    }
    // bare-name matching only for names long enough not to be ordinary words ("me", "gg")
    if (me.length < 3) return false;
    if (nameFor !== me) { nameFor = me; nameRe = new RegExp('(^|[^\\w])@?' + reEsc(me) + '(?![\\w])', 'i'); }
    // skip other people's @mention spans: "@..Gaby Jay.." must not count as a mention of "Jay"
    let text = '';
    const walker = document.createTreeWalker(line.querySelector('.blocksContainer') || line, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const n = walker.currentNode;
        if (!(n.parentElement && n.parentElement.closest('.user, .fcTr, .fcxEmbed'))) text += n.nodeValue;
    }
    return nameRe.test(text);
}

function markMentions(chat, me) {
    const lines = chat.querySelectorAll('.messageWrapper.chat .line');
    for (let i = Math.max(0, lines.length - 80); i < lines.length; i++) {
        const line = lines[i];
        const own = me && authorOf(line.closest('.messageWrapper')).toLowerCase() === me.toLowerCase();
        const hit = cfg.mentions && !own && mentionsMe(line, me);
        if (line.classList.contains('fcx-mention') !== hit) line.classList.toggle('fcx-mention', hit);
    }
    // Discord highlights the whole message: when the first line is the mention, the name row
    // above it gets the band too.
    chat.querySelectorAll('.messageWrapper.chat .message.chat').forEach(msg => {
        const first = msg.querySelector('.line');
        const head = !!(first && first.classList.contains('fcx-mention'));
        if (msg.classList.contains('fcx-mention-head') !== head) msg.classList.toggle('fcx-mention-head', head);
    });
}

/* --------------------------------------------------------------- timestamps */

// "at 22:16" (header) and "22:16" (hover time on follow-up lines) -> Discord's "10:16 PM".
// The original is kept in data-fcx-orig, so turning it off restores it and a Vue re-render
// (which puts Fightcade's text back) is simply re-converted.
function fmtTime(hhmm) {
    const m = hhmm.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = +m[1], min = m[2];
    if (!cfg.hour12) return String(h).padStart(2, '0') + ':' + min;
    return ((h % 12) || 12) + ':' + min + ' ' + (h < 12 ? 'AM' : 'PM');
}

// Edit Vue's own text node in place rather than replacing it (textContent would detach the
// node Vue keeps a reference to).
function setText(el, s) {
    const tn = el.firstChild;
    if (tn && tn.nodeType === 3 && !tn.nextSibling) tn.nodeValue = s;
    else el.textContent = s;
}

function formatTimes(chat) {
    chat.querySelectorAll('.messageWrapper.chat header .authorAndTime .time, .messageWrapper.chat .line .time').forEach(el => {
        const txt = el.textContent;
        if (!txt.trim()) return;
        const orig = el.dataset.fcxOrig;
        if (!cfg.discordTime) {
            if (orig && txt !== orig) setText(el, orig);
            return;
        }
        // Fightcade (re)wrote it, or first visit: remember Fightcade's text, show ours
        const source = (orig && txt === el.dataset.fcxShown) ? orig : txt;
        const shown = fmtTime(source);
        if (!shown) return;
        el.dataset.fcxOrig = source;
        el.dataset.fcxShown = shown;
        if (txt !== shown) setText(el, shown);
    });
}

/* -------------------------------------------------------------- chat polish */

const polishState = new WeakMap();      // chat -> { known: WeakSet of messages already there }

function chatChannel(chat) {
    const cw = chat.closest('.channelWrapper');
    const t = cw && cw.querySelector('.channelToolbar .channelInfo .name.title');
    return t ? (t.getAttribute('title') || t.textContent.replace(/^#/, '')).trim() : '';
}

function minutesOf(hhmm) {
    const m = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
}

function stateOf(chat) {
    let st = polishState.get(chat);
    if (!st) {
        // what's already there when we first see the chat never animates
        st = { known: new WeakSet() };
        chat.querySelectorAll(':scope > .messageWrapper').forEach(m => st.known.add(m));
        polishState.set(chat, st);
    }
    return st;
}

// new messages slide in: tagged before they're painted (a sync watcher), walking back from
// the newest message to the first one we already know
function tagNew() {
    if (!cfg.animate) return;
    document.querySelectorAll('.chatContent').forEach(chat => {
        const st = polishState.get(chat);
        if (!st) return;
        for (let n = chat.lastElementChild; n && n.classList.contains('messageWrapper') && !st.known.has(n); n = n.previousElementSibling) {
            st.known.add(n);
            n.classList.add('fcx-in');
            const el = n;
            setTimeout(() => el.classList.remove('fcx-in'), 700);
        }
    });
}

function polish(chat) {
    const html = document.documentElement;
    html.classList.toggle('fcx-anim', !!cfg.animate);
    html.classList.toggle('fcx-syscards', !!cfg.systemCards);
    const msgs = chat.querySelectorAll(':scope > .messageWrapper');
    const st = stateOf(chat);
    const users = fc.app.users();
    const chan = chatChannel(chat);
    let prevMin = null;
    msgs.forEach(m => {
        if (!st.known.has(m)) st.known.add(m);
        // rank colours on names
        if (m.classList.contains('chat')) {
            const author = m.querySelector('header .author');
            if (author) {
                const u = users[authorOf(m)];
                const letter = cfg.rankColors && u && u.channelRank ? fc.data.rankLetter(u.channelRank[chan] || 0) : '';
                if ((author.dataset.fcxRank || '') !== letter) {
                    author.dataset.fcxRank = letter;
                    if (letter) author.style.setProperty('color', fc.data.rankColor(letter), 'important');
                    else author.style.removeProperty('color');
                }
            }
            // a divider after a long gap (Fightcade only gives HH:MM)
            const tEl = m.querySelector('header .authorAndTime .time') || m.querySelector('.line .time');
            const min = tEl ? minutesOf(tEl.dataset.fcxOrig || tEl.textContent) : null;
            const msgEl = m.querySelector(':scope > .message');
            let gap = '';
            if (cfg.timeDividers && min != null && prevMin != null) {
                const d = (min - prevMin + 1440) % 1440;
                if (d >= 20 && d <= 720) gap = fmtTime(tEl.dataset.fcxOrig || tEl.textContent) || '';
            }
            if (min != null) prevMin = min;
            if (msgEl && (msgEl.dataset.fcxGap || '') !== gap) {
                if (gap) { msgEl.dataset.fcxGap = gap; m.classList.add('fcx-gap'); }
                else { delete msgEl.dataset.fcxGap; m.classList.remove('fcx-gap'); }
            }
        }
        // match results: colour the card by the result
        if (m.classList.contains('endgame')) {
            m.classList.toggle('fcx-won', !!m.querySelector('.wrapUpWrapper.won'));
            m.classList.toggle('fcx-lost', !!m.querySelector('.wrapUpWrapper.lost'));
        }
    });
}

/* ----------------------------------------------------------------- NEW line */

// Per chat: the last message you had in front of you. "In front of you" = the channel is
// showing and the Fightcade window has focus (not the emulator).
const seenState = new WeakMap();
const isSeen = (chat) => chat.offsetParent !== null && document.hasFocus() && !document.hidden;

function clearNew(chat) {
    (chat || document).querySelectorAll('.messageWrapper.fcx-new-first').forEach(m => m.classList.remove('fcx-new-first'));
}

function trackNew(chat) {
    const msgs = chat.querySelectorAll(':scope > .messageWrapper');
    const last = msgs[msgs.length - 1] || null;
    const seen = isSeen(chat);
    let st = seenState.get(chat);
    if (!st) { st = { lastSeen: last, wasSeen: seen }; seenState.set(chat, st); return; }
    if (seen) {
        if (!st.wasSeen && cfg.newLine && st.lastSeen && st.lastSeen !== last && st.lastSeen.isConnected) {
            let first = st.lastSeen.nextElementSibling;
            while (first && !first.classList.contains('messageWrapper')) first = first.nextElementSibling;
            if (first) { clearNew(chat); first.classList.add('fcx-new-first'); }
        }
        st.lastSeen = last;
    } else if (st.wasSeen) {
        clearNew(chat);                  // you left: the next visit gets a fresh marker
    }
    st.wasSeen = seen;
}

/* ------------------------------------------------------------ hover actions */

const ACTS = { reply: ['Reply', 'chat'], copy: ['Copy Text', 'copy'], translate: ['Translate', 'globe'], profile: ['Profile', 'user'] };
let bar = null, barLine = null, hideTimer = null;

function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'fcxBar';
    bar.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    bar.addEventListener('mouseleave', () => scheduleHide());
    bar.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = e.target.closest('.fcxBtn');
        if (b && barLine) act(b.dataset.act, barLine);
    });
    document.body.appendChild(bar);
    return bar;
}

function hideBar() { if (bar) bar.style.display = 'none'; barLine = null; }
function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hideBar, 120); }

function showBar(line) {
    const wrap = line.closest('.messageWrapper');
    const own = fc.app.isMe(authorOf(wrap));
    const acts = own ? ['copy'] : ['reply', 'copy'];
    if (!own && mod('translate')) acts.push('translate');
    if (mod('scout')) acts.push('profile');
    const b = ensureBar();
    b.innerHTML = acts.map(a => `<span class="fcxBtn" data-act="${a}" title="${ACTS[a][0]}">${fc.ui.icon(ACTS[a][1])}</span>`).join('');
    b.style.display = 'flex';
    const r = line.getBoundingClientRect();
    const chat = line.closest('.chatContent').getBoundingClientRect();
    const w = acts.length * 32 + 2;
    b.style.left = Math.max(chat.left + 8, chat.right - w - 24) + 'px';
    b.style.top = Math.max(chat.top + 4, r.top - 18) + 'px';
    barLine = line;
}

function onMouseOver(e) {
    if (!cfg.hoverActions) return;
    const t = e.target;
    if (bar && bar.contains(t)) return;
    const line = t.closest && t.closest('.chatContent .messageWrapper.chat .line');
    if (line) {
        clearTimeout(hideTimer);
        if (line !== barLine) showBar(line);
    } else if (barLine) {
        scheduleHide();
    }
}

function act(what, line) {
    const wrap = line.closest('.messageWrapper');
    const name = authorOf(wrap);
    if (what === 'reply' && name) fc.app.mention(name);
    else if (what === 'copy') fc.ui.toast(fc.ui.copy(lineText(line)) ? 'Copied' : 'Copy failed', { icon: 'copy', ms: 1500 });
    else if (what === 'translate') { const tr = mod('translate'); if (tr) tr.translateLine(line); }
    else if (what === 'profile' && name) {
        const avatar = wrap.querySelector('header .avatarWrapper img') || wrap.querySelector('header .author') || line;
        const sc = mod('scout');
        if (sc) sc.openCard(name, avatar.getBoundingClientRect(), 'beside');
    }
    hideBar();
}

/* ------------------------------------------------------------ link previews */

// Only these hosts are ever fetched (see the header comment).
const HOSTS = [
    'youtube.com', 'youtu.be', 'twitch.tv', 'x.com', 'twitter.com', 'imgur.com', 'fightcade.com',
    'streamable.com', 'reddit.com', 'redd.it', 'twimg.com', 'tenor.com', 'giphy.com',
    'cdn.discordapp.com', 'media.discordapp.net', 'supercombo.gg', 'github.com'
];
const allowed = (host) => HOSTS.some(h => host === h || host.endsWith('.' + h));
// Preview IMAGES load from your connection too, and a trusted page's og:image can point
// anywhere -- so only these image servers (the allowed sites' own CDNs).
const IMG_HOSTS = HOSTS.concat(['ytimg.com', 'jtvnw.net', 'redditmedia.com', 'githubassets.com',
    'githubusercontent.com', 'discordapp.net', 'streamablevideo.com']);
function imageAllowed(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && IMG_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
    } catch (e) { return false; }
}
const IMG_EXT = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

function http(url, redirects) {
    let https = null;
    try { https = require('https'); } catch (e) { /* harness */ }
    if (!https) return fetch(url).then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)));
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept-Language': 'en' }, timeout: 8000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirects || 0) < 3) {
                res.resume();
                const next = new URL(res.headers.location, url).href;
                if (!allowed(new URL(next).hostname)) return reject(new Error('redirected off the allowlist'));
                return resolve(http(next, (redirects || 0) + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            let body = '', size = 0;
            res.setEncoding('utf8');
            res.on('data', (c) => { size += c.length; body += c; if (size > 262144) req.destroy(); });
            res.on('end', () => resolve(body));
            res.on('close', () => resolve(body));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

function decode(s) {
    return String(s || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => {
        const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
        if (map[e.toLowerCase()]) return map[e.toLowerCase()];
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(n) ? m : String.fromCodePoint(n);
    });
}

function ogTags(html) {
    const get = (p) => {
        const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + p + '["\'][^>]*content=["\']([^"\']*)', 'i')) ||
                  html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + p + '["\']', 'i'));
        return m ? decode(m[1]).trim() : '';
    };
    const title = get('og:title') || get('twitter:title') || decode((html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').trim();
    return { title, desc: get('og:description') || get('description'), image: get('og:image') || get('twitter:image'), site: get('og:site_name') };
}

function youtubeId(u) {
    if (/youtu\.be$/.test(u.hostname)) return u.pathname.slice(1).split('/')[0];
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/);
    return m ? m[2] : '';
}

async function buildPreview(raw) {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    if (IMG_EXT.test(u.pathname)) return { kind: 'image', url: raw };
    // replay links hand off to fcade:// (opens in Fightcade) -- nothing to fetch
    if (host === 'replay.fightcade.com') {
        const parts = u.pathname.split('/');
        const emu = parts[1], rom = parts[2];
        return { kind: 'card', color: '#5865f2', site: 'Fightcade replay', title: 'Watch replay' + (rom ? ' · ' + rom : ''),
                 desc: 'Opens in Fightcade' + (emu ? ' (' + emu + ')' : ''), url: raw };
    }
    if (/(^|\.)youtube\.com$|youtu\.be$/.test(host)) {
        const id = youtubeId(u);
        if (!id) return null;
        const j = JSON.parse(await http('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id)));
        return { kind: 'video', color: '#ff0000', site: 'YouTube', author: j.author_name, title: j.title, url: raw,
                 image: 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/hqdefault.jpg' };
    }
    if (/(^|\.)(x|twitter)\.com$/.test(host) && /\/status\/\d+/.test(u.pathname)) {
        const j = JSON.parse(await http('https://publish.twitter.com/oembed?omit_script=1&url=' + encodeURIComponent(raw)));
        // the tweet text is the first <p>; after it comes the "— author (@handle) date" credit
        const body = String(j.html || '').replace(/<\/p>[\s\S]*$/, '')
            .replace(/<a[^>]*>(pic\.twitter\.com[^<]*)<\/a>/g, '').replace(/<br\s*\/?>/g, '\n');
        const text = decode(body.replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').trim();
        return { kind: 'card', color: '#1d9bf0', site: 'X', author: j.author_name, title: '', desc: text, url: raw };
    }
    if (/(^|\.)streamable\.com$/.test(host)) {
        const j = JSON.parse(await http('https://api.streamable.com/oembed.json?url=' + encodeURIComponent(raw)));
        return { kind: 'video', color: '#0f90fa', site: 'Streamable', title: j.title, url: raw, image: j.thumbnail_url };
    }
    const og = ogTags(await http(raw));
    if (/(^|\.)twitch\.tv$/.test(host) && /^twitch$/i.test(og.title)) {
        // channel pages are a JS app with generic tags; the live preview image is public
        const login = u.pathname.split('/')[1];
        if (!login || host.indexOf('clips.') === 0) return null;
        return { kind: 'video', color: '#9146ff', site: 'Twitch', title: login + ' on Twitch', url: raw,
                 image: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' + encodeURIComponent(login.toLowerCase()) + '-440x248.jpg' };
    }
    // app shells whose tags only ever say their own name aren't worth a card
    if (!og.title && !og.image) return null;
    if (/^(reddit|twitch|x|fightcade-web|imgur)$/i.test(og.title) && !og.image) return null;
    const color = /twitch\.tv$/.test(host) ? '#9146ff' : /fightcade\.com$/.test(host) ? '#5865f2'
        : /reddit\.com$|redd\.it$/.test(host) ? '#ff4500' : '#5865f2';
    const big = /twitch\.tv$/.test(host);
    return { kind: big ? 'video' : 'card', color, site: og.site || host, title: og.title, desc: og.desc, url: raw,
             image: og.image ? new URL(og.image, raw).href : '' };
}

const previewCache = new Map();  // url -> Promise<preview|null>
const pq = [];
let pqBusy = false;

function preview(url) {
    if (previewCache.has(url)) return previewCache.get(url);
    const p = new Promise((resolve) => { pq.push({ url, resolve }); pumpPreviews(); });
    previewCache.set(url, p);
    if (previewCache.size > 300) previewCache.delete(previewCache.keys().next().value);
    return p;
}

async function pumpPreviews() {
    if (pqBusy || !pq.length) return;
    pqBusy = true;
    const job = pq.shift();
    try { job.resolve(await buildPreview(job.url)); }
    catch (e) { fc.log('preview failed', job.url, e && e.message); job.resolve(null); }
    finally { pqBusy = false; setTimeout(pumpPreviews, 150); }
}

function renderPreview(line, p) {
    const bc = line.querySelector('.blocksContainer');
    if (!bc) return;
    const old = bc.querySelector(':scope > .fcxEmbed');
    if (old) old.remove();
    const div = document.createElement('div');
    div.className = 'fcxEmbed';
    if (p.kind === 'image') {
        if (!cfg.imagePreviews) return;
        div.classList.add('fcxImage');
        div.innerHTML = `<a href="${E(p.url)}" target="_blank" rel="noopener noreferrer"><img src="${E(p.url)}"></a>`;
    } else {
        div.style.borderLeftColor = p.color;
        const img = p.image && cfg.imagePreviews && imageAllowed(p.image)
            ? `<a class="fcxThumb${p.kind === 'video' ? ' fcxVideo' : ''}" href="${E(p.url)}" target="_blank" rel="noopener noreferrer"><img src="${E(p.image)}"></a>` : '';
        div.innerHTML = `
            <div class="fcxSite">${E(p.site || '')}</div>
            ${p.author ? `<div class="fcxAuthor">${E(p.author)}</div>` : ''}
            ${p.title ? `<a class="fcxTitle" href="${E(p.url)}" target="_blank" rel="noopener noreferrer">${E(p.title)}</a>` : ''}
            ${p.desc ? `<div class="fcxDesc">${E(p.desc)}</div>` : ''}
            ${img}`;
    }
    div.querySelectorAll('img').forEach(i => { i.onerror = () => (p.kind === 'image' ? div.remove() : i.parentNode.remove()); });
    bc.appendChild(div);
}

const URL_RE = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/i;

function previewLinks(chat) {
    if (!cfg.linkPreviews) return;
    const lines = chat.querySelectorAll('.messageWrapper.chat .line');
    for (let i = Math.max(0, lines.length - 40); i < lines.length; i++) {
        const line = lines[i];
        const m = lineText(line).match(URL_RE);
        const url = m ? m[0] : '';
        if (line.dataset.fcxUrl === url) continue;
        line.dataset.fcxUrl = url;
        const old = line.querySelector('.blocksContainer > .fcxEmbed');
        if (old) old.remove();
        if (!url) continue;
        let host;
        try { host = new URL(url).hostname.toLowerCase(); } catch (e) { continue; }
        if (!allowed(host)) continue;                     // unknown domain: never fetched
        preview(url).then(p => {
            if (p && line.isConnected && line.dataset.fcxUrl === url && cfg.linkPreviews) renderPreview(line, p);
        });
    }
}

/* ---------------------------------------------------------- jump to present */

let jump = null, jumpChat = null;

function ensureJump() {
    if (jump) return jump;
    jump = document.createElement('div');
    jump.id = 'fcxJump';
    jump.innerHTML = `<span>You're viewing older messages</span><span class="fcxJumpBtn">Jump to present</span>`;
    jump.addEventListener('click', (e) => {
        e.stopPropagation();
        if (jumpChat) jumpChat.scrollTop = jumpChat.scrollHeight;
        jump.style.display = 'none';
    });
    document.body.appendChild(jump);
    return jump;
}

function updateJump() {
    const chat = visibleChats()[0];
    if (!cfg.jumpBar || !chat) { if (jump) jump.style.display = 'none'; return; }
    const away = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    const show = away > chat.clientHeight * 1.5 || (jump && jump.style.display === 'flex' && away > 200);
    const j = ensureJump();
    if (!show) { j.style.display = 'none'; return; }
    const r = chat.getBoundingClientRect();
    j.style.left = (r.left + 16) + 'px';
    j.style.width = (r.width - 32) + 'px';
    j.style.top = (r.bottom - 34) + 'px';
    j.style.display = 'flex';
    jumpChat = chat;
}

const CSS = `
html body .chatContent .messageWrapper.chat .message.chat .line.fcx-mention,
html body .chatContent .messageWrapper.chat .message.chat.fcx-mention-head > header {
    background: rgba(250,168,26,.12) !important; box-shadow: inset 2px 0 0 #f0b232 !important; }
html body .chatContent .messageWrapper.chat .message.chat .line.fcx-mention:hover { background: rgba(250,168,26,.17) !important; }

/* ---- chat polish ---- */
@keyframes fcxIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
html.fcx-anim body .chatContent .messageWrapper.fcx-in { animation: fcxIn .32s cubic-bezier(.2,.8,.2,1) both; }
html body .chatContent .messageWrapper.chat .message.chat:hover { border-radius: 6px !important; }
html body .chatContent .messageWrapper.fcx-gap { position: relative !important; margin-top: 30px !important; }
html body .chatContent .messageWrapper.fcx-gap > .message::before {
    content: attr(data-fcx-gap) !important; position: absolute !important; top: -22px !important; left: 16px !important; right: 16px !important;
    height: 14px !important; display: block !important; text-align: center !important; pointer-events: none !important;
    font: 600 11px/14px var(--fc-font) !important; color: var(--fc-muted) !important;
    background: linear-gradient(var(--fc-divider), var(--fc-divider)) left center / calc(50% - 44px) 1px no-repeat,
                linear-gradient(var(--fc-divider), var(--fc-divider)) right center / calc(50% - 44px) 1px no-repeat !important; }
html.fcx-syscards body .chatContent .messageWrapper.requestChallenge .wrapUpWrapper,
html.fcx-syscards body .chatContent .messageWrapper.challengeRequested .challengeWrapper .title,
html.fcx-syscards body .chatContent .messageWrapper.challengeError .message {
    display: inline-flex !important; align-items: center !important; height: 24px !important; padding: 0 10px 0 8px !important;
    border-radius: 12px !important; font-size: 13px !important; font-weight: 600 !important; line-height: 24px !important; }
html.fcx-syscards body .chatContent .messageWrapper.requestChallenge .wrapUpWrapper.accepted { color: #2dc770 !important; background: rgba(35,165,90,.14) !important; }
html.fcx-syscards body .chatContent .messageWrapper.requestChallenge .wrapUpWrapper.accepted::before { content: '✓' !important; margin-right: 6px !important; font-weight: 800 !important; }
html.fcx-syscards body .chatContent .messageWrapper.requestChallenge .wrapUpWrapper.declined { color: #f23f43 !important; background: rgba(242,63,67,.12) !important; }
html.fcx-syscards body .chatContent .messageWrapper.requestChallenge .wrapUpWrapper.declined::before { content: '✕' !important; margin-right: 6px !important; font-weight: 800 !important; }
html.fcx-syscards body .chatContent .messageWrapper.challengeRequested .challengeWrapper .title {
    color: var(--fc-text) !important; background: var(--fc-accent-soft) !important; }
html.fcx-syscards body .chatContent .messageWrapper.challengeRequested .challengeWrapper .title::before { content: '⚔' !important; margin-right: 6px !important; }
html.fcx-syscards body .chatContent .messageWrapper.challengeError .message { color: #f23f43 !important; background: rgba(242,63,67,.12) !important; }
html.fcx-syscards body .chatContent .messageWrapper.endgame.fcx-won .endgameMessageWrapper {
    border-left-color: #23a55a !important; background: linear-gradient(90deg, rgba(35,165,90,.14), transparent 70%), var(--fc-input) !important; }
html.fcx-syscards body .chatContent .messageWrapper.endgame.fcx-lost .endgameMessageWrapper {
    border-left-color: #f23f43 !important; background: linear-gradient(90deg, rgba(242,63,67,.12), transparent 70%), var(--fc-input) !important; }

html body .chatContent .messageWrapper.fcx-new-first { position: relative !important; margin-top: 26px !important; }
html body .chatContent .messageWrapper.fcx-new-first::after {
    content: 'NEW' !important; position: absolute !important; top: -16px !important; left: 16px !important; right: 16px !important;
    height: 13px !important; display: flex !important; justify-content: flex-end !important; align-items: center !important;
    padding: 0 4px !important; font: 700 10px/13px system-ui, sans-serif !important; color: #fff !important; letter-spacing: .02em !important;
    background: linear-gradient(#f23f43, #f23f43) left center / calc(100% - 34px) 1px no-repeat,
                linear-gradient(#f23f43, #f23f43) right center / 34px 13px no-repeat !important;
    border-radius: 0 4px 4px 0 !important; pointer-events: none !important; }

#fcxBar { position: fixed; z-index: 100000; display: none; padding: 0; height: 32px; border-radius: 8px;
    background: var(--fc-s0); border: 1px solid var(--fc-divider);
    box-shadow: 0 4px 12px rgba(0,0,0,.3); overflow: hidden; }
#fcxBar .fcxBtn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer;
    color: var(--dc-icon, #b5bac1); }
#fcxBar .fcxBtn:hover { background: var(--fc-s4); color: var(--fc-head); }

.fcxEmbed { display: block; max-width: 432px; margin: 4px 0 2px; padding: 8px 16px 12px 12px; box-sizing: border-box;
    border-left: 4px solid var(--fc-accent); border-radius: 4px; background: var(--fc-input);
    font-size: 14px; line-height: 1.375; white-space: normal; font-style: normal; }
.fcxEmbed .fcxSite { font-size: 12px; color: var(--fc-muted); margin-top: 4px; }
.fcxEmbed .fcxAuthor { font-size: 14px; font-weight: 600; color: var(--fc-head); margin-top: 6px; }
.fcxEmbed .fcxTitle { display: block; margin-top: 6px; font-size: 15px; font-weight: 600; color: #00a8fc !important;
    text-decoration: none; }
.fcxEmbed .fcxTitle:hover { text-decoration: underline; }
.fcxEmbed .fcxDesc { margin-top: 6px; color: var(--fc-text); white-space: pre-line; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.fcxEmbed .fcxThumb { display: block; position: relative; margin-top: 12px; line-height: 0; }
.fcxEmbed .fcxThumb img { width: 400px !important; max-width: 100%; height: auto !important; max-height: 225px;
    object-fit: cover; border-radius: 4px; }
.fcxEmbed .fcxVideo::after { content: ''; position: absolute; left: 50%; top: 50%; width: 48px; height: 48px;
    margin: -24px 0 0 -24px; border-radius: 50%; background: rgba(0,0,0,.6)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M8 5v14l11-7z'/%3E%3C/svg%3E") center / 26px no-repeat; }
.fcxEmbed.fcxImage { padding: 0; background: none; border: 0; max-width: 400px; }
.fcxEmbed.fcxImage img { width: auto !important; height: auto !important; max-width: 400px; max-height: 300px;
    border-radius: 8px; display: block; cursor: pointer; }

#fcxJump { position: fixed; z-index: 99990; display: none; align-items: center; justify-content: space-between;
    height: 34px; padding: 0 12px; box-sizing: border-box; border-radius: 8px 8px 0 0;
    background: var(--fc-accent); color: #fff; font: 500 14px/1 var(--fc-font); cursor: pointer;
    box-shadow: 0 -2px 8px rgba(0,0,0,.2); }
#fcxJump .fcxJumpBtn { font-weight: 700; }
#fcxJump:hover { background: var(--fc-accent-h); }
#fcxBar .fcxBtn > .fc-ic { width: 18px; height: 18px; }
/* under full pages (Stats, Friends) and their popups */
#fcxJump { z-index: 18; }
`;

/* -------------------------------------------------------------------- sweep */

function sweep() {
    const me = fc.app.me();
    document.querySelectorAll('.chatContent').forEach(chat => {
        trackNew(chat);
        if (chat.offsetParent === null) return;
        stateOf(chat);
        markMentions(chat, me);
        formatTimes(chat);
        polish(chat);
        previewLinks(chat);
    });
    updateJump();
}

function onSetting(key) {
    if (!cfg.linkPreviews || !cfg.imagePreviews) {
        document.querySelectorAll('.fcxEmbed').forEach(n => n.remove());
        document.querySelectorAll('.line[data-fcx-url]').forEach(l => { delete l.dataset.fcxUrl; });
    }
    if (!cfg.newLine) clearNew();
    if (!cfg.hoverActions) hideBar();
    sweep();
}

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('chat-extras', DEFAULTS);
    cfg = store.data;
    window.__fcChatExtrasLoaded = true;
    fc.ui.style('fcxStyle', CSS);

    const listen = (target, ev, fn, cap) => { target.addEventListener(ev, fn, cap); fc.own(() => target.removeEventListener(ev, fn, cap)); };
    listen(document, 'mouseover', onMouseOver, true);
    listen(document, 'scroll', (e) => { if (e.target && e.target.classList && e.target.classList.contains('chatContent')) { hideBar(); updateJump(); } }, true);
    // sending a message = you've caught up
    listen(window, 'keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.closest && e.target.closest('.chatInput') && e.target.value) clearNew(); }, true);
    listen(window, 'focus', () => setTimeout(sweep, 50));
    listen(window, 'blur', () => setTimeout(sweep, 50));
    listen(window, 'resize', () => { hideBar(); updateJump(); });
    fc.own(() => {
        fc.ui.style('fcxStyle', null);
        hideBar();
        if (jump) { jump.remove(); jump = null; }
        document.querySelectorAll('.fcxEmbed').forEach(n => n.remove());
        clearNew();
        window.__fcChatExtrasLoaded = false;
    });

    fc.watch(tagNew, { sync: true, selector: '.chatContent' });
    fc.watch(sweep, { selector: '.chatContent' });
    fc.tick(sweep, 2000);                    // channel switches only flip visibility

    const opt = (key, label, hint, show) => ({ key, type: 'switch', label, hint, show, onChange: () => onSetting(key) });
    fc.settings.block({
        id: 'chat-extras', section: 'chat', title: 'Chat extras', hint: '— only you see these', store, order: 10,
        fields: [
            opt('mentions', 'Mention highlight', 'Yellow highlight when someone @s you'),
            opt('newLine', 'NEW line', 'Red divider where you left off'),
            opt('hoverActions', 'Hover actions', 'Reply · Copy · Translate · Profile'),
            opt('linkPreviews', 'Link previews', 'YouTube, Twitch, X, imgur, Fightcade… (only well-known sites are ever fetched)'),
            opt('imagePreviews', 'Image previews', 'Pictures inside previews', (d) => d.linkPreviews),
            opt('jumpBar', 'Jump to present', 'A bar when you scroll up'),
            opt('discordTime', 'Discord timestamps', '"10:16 PM" instead of "at 22:16"'),
            opt('hour12', '12-hour clock', 'Off = 22:16', (d) => d.discordTime),
            opt('animate', 'Animate new messages', 'They slide in'),
            opt('rankColors', 'Rank colours', 'Names coloured by channel rank (S gold, A red, B purple…)'),
            opt('systemCards', 'Compact system messages', 'Challenge and match messages as pills and cards'),
            opt('timeDividers', 'Time dividers', 'A line with the time after a 20+ minute gap')
        ]
    });
    sweep();
    return api;
}

const api = {
    _buildPreview: (u) => buildPreview(u),
    _allowed: allowed,
    _sweep: () => sweep(),
    get _config() { return cfg; }
};

module.exports = { id: 'chat-extras', name: 'Chat extras', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
