/**
 * Fightcord chat extras (Discord-style)
 *
 *   - Mentions: lines that @ you get Discord's yellow highlight
 *   - NEW line: a red "NEW" divider where you left off when you come back to a channel
 *   - Hover actions: Reply, Copy, Translate, Profile on any message
 *   - Link previews: YouTube / Twitch / X / imgur / Fightcade links get an embed card
 *   - Images, GIFs and clips (2.15): picture / video links from trusted hosts show inline (a message
 *     that's only the link shows only the picture); click one to see it full size. Fightcord's
 *     uploads (uploads.js) go to catbox.moe, so other Fightcord players see them; everyone else
 *     sees the link.
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
    blurMedia: false,      // images and clips blurred until clicked (2.15)
    jumpBar: true,
    discordTime: true,     // "10:16 PM" instead of "at 22:16"
    hour12: true,
    animate: true,         // new messages slide in
    rankColors: true,      // names in the colour of their channel rank
    systemCards: true,     // challenge / match messages as compact pills and cards
    timeDividers: true,    // a divider when 20+ minutes pass between messages
    noticeFolded: true,    // Fightcade's channel notice (rules, links, events) as one line (2.13)
    noticeOpen: {},        // channels where you opened it
    multiLine: true        // Shift+Enter: a taller box, each line sent as its own message (2.18)
};

const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const N_ = (s) => s;
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
    // (a line break in a message is a <br>: a gap, so a link doesn't run into the next line)
    const text = (n) => {
        if (!n.querySelector || !n.querySelector('br')) return n.textContent;
        const c = n.cloneNode(true);
        c.querySelectorAll('br').forEach(b => b.replaceWith(' '));
        return c.textContent;
    };
    bc.childNodes.forEach(n => {
        if (n.nodeName === 'BR') t += ' ';
        else if (!(n.classList && (n.classList.contains('fcTr') || n.classList.contains('fcxEmbed')))) t += text(n);
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

const ACTS = { reply: [N_('Reply'), 'chat'], copy: [N_('Copy Text'), 'copy'], translate: [N_('Translate'), 'globe'], profile: [N_('Profile'), 'user'] };
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
    b.innerHTML = acts.map(a => `<span class="fcxBtn" data-act="${a}" title="${E(T(ACTS[a][0]))}">${fc.ui.icon(ACTS[a][1])}</span>`).join('');
    b.style.display = 'flex';
    const r = line.getBoundingClientRect();
    const chat = line.closest('.chatContent').getBoundingClientRect();
    const w = acts.length * 32 + 2;
    b.style.left = Math.max(chat.left + 8, chat.right - w - 24) + 'px';
    b.style.top = Math.max(chat.top + 4, r.top - 18) + 'px';
    barLine = line;
}

// a mention's band covers its name row and first line as one: hovering either lights both (Discord's
// one highlighted message), instead of the line lighting up alone like a box of its own
let hovHead = [];
function mentionHover(t) {
    const msg = t && t.closest && t.closest('.chatContent .message.chat.fcx-mention-head');
    const first = msg && msg.querySelector('.line');
    const on = msg && first && (t.closest('header') || t.closest('.line') === first) ? [msg.querySelector(':scope > header'), first].filter(Boolean) : [];
    if (on[0] === hovHead[0] && on[1] === hovHead[1]) return;
    hovHead.forEach(el => el.classList.remove('fcx-hov'));
    hovHead = on;
    on.forEach(el => el.classList.add('fcx-hov'));
}

function onMouseOver(e) {
    mentionHover(e.target);
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
    else if (what === 'copy') fc.ui.toast(fc.ui.copy(lineText(line)) ? N_('Copied') : N_('Copy failed'), { icon: 'copy', ms: 1500 });
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
    'cdn.discordapp.com', 'media.discordapp.net', 'supercombo.gg', 'github.com', 'catbox.moe', 'klipy.com', 'uguu.se',
    // the Blossom picture servers uploads go to (3.4; fc.data.BLOSSOM)
    'blossom.primal.net', 'nostr.download', 'nostrcheck.me', 'blossom.yakihonne.com', 'blossom.band'
];
const allowed = (host) => HOSTS.some(h => host === h || host.endsWith('.' + h));
// Preview IMAGES load from your connection too, and a trusted page's og:image can point
// anywhere -- so only these image servers (the allowed sites' own CDNs).
const IMG_HOSTS = HOSTS.concat(['ytimg.com', 'jtvnw.net', 'redditmedia.com', 'githubassets.com',
    'githubusercontent.com', 'discordapp.net', 'streamablevideo.com']);
let imageAllowedHook = null;           // (_render, the dev harness)
function imageAllowed(url) {
    if (imageAllowedHook && imageAllowedHook(url)) return true;
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && IMG_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
    } catch (e) { return false; }
}
const IMG_EXT = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;
const VID_EXT = /\.(mp4|webm|mov)(\?.*)?$/i;
const AUD_EXT = /\.(mp3|ogg|oga|wav|m4a|flac|opus|aac)$/i;
// an audio file's name: what the sender's Fightcord put after the # (catbox renames files), else the file's own
function audioName(u) {
    const ext = (u.pathname.match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '';
    let n = '';
    try { n = decodeURIComponent((u.hash || '').slice(1)).replace(/^SPOILER_/, ''); } catch (e) { /* bad escape */ }
    n = n.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
    if (!n) { try { n = decodeURIComponent(u.pathname.split('/').pop()).replace(/\.[a-z0-9]{2,5}$/i, ''); } catch (e) { n = 'audio'; } }
    return n + (ext ? '.' + ext.toLowerCase() : '');
}

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

// a page's looping video (Tenor / Giphy put the GIF's small mp4 here)
function ogVideo(html) {
    for (const p of ['twitter:player:stream', 'og:video:secure_url', 'og:video:url', 'og:video']) {
        const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + p + '["\'][^>]*content=["\']([^"\']*)', 'i')) ||
                  html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + p + '["\']', 'i'));
        if (m && /^https:\/\/.+\.mp4(\?|$)/i.test(decode(m[1]))) return decode(m[1]);
    }
    return '';
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
    // tenor.com / giphy.com links are pages even when they end in .gif (share links): read the page
    const gifPage = /^(tenor|giphy)\.com$/.test(host);
    if (IMG_EXT.test(u.pathname) && !gifPage) return { kind: 'image', url: raw };
    // audio files: fixed addresses, nothing to fetch
    if (AUD_EXT.test(u.pathname)) return { kind: 'audio', url: raw.split('#')[0], name: audioName(u) };
    // klipy.com/gifs/<slug>: its page is behind Cloudflare, so ask KLIPY's API (Fightcord's app key, uploads.js)
    if (host === 'klipy.com') {
        let up = null;
        try { up = require(require('path').join(__dirname, 'uploads.js')); } catch (e) { return null; }
        const k = up.klipySlug(raw);
        if (!k) return null;
        const json = JSON.parse(await http(up.KLIPY + '/' + k.type + '/items?slugs=' + encodeURIComponent(k.slug)));
        const it = up.parseKlipy(json, k.type)[0];
        // (its animated webp: a picture, see uploads.js klipyPick; an mp4 only when there's no webp)
        return it ? (it.kind === 'image' ? { kind: 'image', url: it.src, page: raw } : { kind: 'gifv', url: it.src, still: it.still, page: raw }) : null;
    }
    // giphy.com/gifs/<name>-<id> (or /media/<id>/…): the files have fixed addresses, no page to read
    if (host === 'giphy.com') {
        const m = u.pathname.match(/^\/(?:gifs|stickers|embed)\/(?:[\w-]*-)?([A-Za-z0-9]{8,})\/?$/) || u.pathname.match(/^\/media\/([A-Za-z0-9]{8,})\//);
        if (!m) return null;
        // (the animated webp, about the mp4's size: Fightcade shows these mp4s far too contrasty)
        return { kind: 'image', url: 'https://media.giphy.com/media/' + m[1] + '/giphy.webp', page: raw };
    }
    if (VID_EXT.test(u.pathname)) return { kind: 'clip', url: raw };
    if (/(^|\.)imgur\.com$/.test(host) && /\.gifv$/i.test(u.pathname)) return { kind: 'gifv', url: raw.replace(/\.gifv(\?.*)?$/i, '.mp4'), page: raw };
    // replay links hand off to fcade:// (opens in Fightcade) -- nothing to fetch
    if (host === 'replay.fightcade.com') {
        const parts = u.pathname.split('/');
        const emu = parts[1], rom = parts[2];
        return { kind: 'card', color: '#5865f2', site: T('Fightcade replay'), title: T('Watch replay') + (rom ? ' · ' + rom : ''),
                 desc: T('Opens in Fightcade') + (emu ? ' (' + emu + ')' : ''), url: raw };
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
    const html = await http(raw);
    const og = ogTags(html);
    if (/(^|\.)twitch\.tv$/.test(host) && /^twitch$/i.test(og.title)) {
        // channel pages are a JS app with generic tags; the live preview image is public
        const login = u.pathname.split('/')[1];
        if (!login || host.indexOf('clips.') === 0) return null;
        return { kind: 'video', color: '#9146ff', site: 'Twitch', title: T('{name} on Twitch', { name: login }), url: raw,
                 image: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' + encodeURIComponent(login.toLowerCase()) + '-440x248.jpg' };
    }
    // a Tenor / Giphy page is the GIF itself: Tenor's animated webp (from its mp4's address), else the
    // .gif, else the looping mp4 (Fightcade's Chromium 80 shows those mp4s far too contrasty)
    if (gifPage) {
        const vid = ogVideo(html);
        const gif = og.image && /\.(gif|webp)(\?|$)/i.test(og.image) ? new URL(og.image, raw).href : '';
        let up = null;
        try { up = require(require('path').join(__dirname, 'uploads.js')); } catch (e) { /* harness */ }
        const webp = vid && up && up.tenorWebp ? up.tenorWebp(vid) : '';
        if (webp && imageAllowed(webp)) return { kind: 'image', url: webp, page: raw };
        if (gif && imageAllowed(gif)) return { kind: 'image', url: gif, page: raw };
        if (vid && imageAllowed(vid)) return { kind: 'gifv', url: vid, page: raw };
        return null;
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

// a preview -> its embed (a detached element; null: previews are off or the picture's server isn't
// allowed). dataset.media: a picture / clip / GIF / audio file (what stands in for the link). onGone:
// the file didn't load after all (the embed has removed itself)
function embedEl(p, onGone) {
    const div = document.createElement('div');
    div.className = 'fcxEmbed';
    const media = p.kind === 'image' || p.kind === 'clip' || p.kind === 'gifv' || p.kind === 'audio';
    if (media && (!cfg.imagePreviews || !imageAllowed(p.url))) return null;
    if (media) div.dataset.media = '1';
    if (p.kind === 'image' || p.kind === 'clip' || p.kind === 'gifv') {
        div.classList.add('fcxImage');
        // the sender marked it as a spoiler (3.4: #SPOILER_ after the link, Discord's mark): blurred with a label
        const spoiler = /#SPOILER_/.test(p.url);
        if (cfg.blurMedia || spoiler) div.classList.add('fcxBlur');
        div.dataset.view = p.url;
        div.dataset.link = p.page || p.url;
        div.dataset.kind = p.kind;
        if (p.still) div.dataset.still = p.still;
        div.innerHTML = (p.kind === 'clip'
            ? `<video src="${E(p.url)}" preload="metadata" playsinline controls></video>`
            : p.kind === 'gifv'
                ? `<video class="fcxGifv" src="${E(p.url)}" autoplay muted loop playsinline${p.still ? ` poster="${E(p.still)}"` : ''}></video>`
                : `<img src="${E(p.url)}" alt="" loading="lazy">`) +
            (cfg.blurMedia || spoiler ? `<span class="fcxShow">${E(T(spoiler ? 'Spoiler' : 'Show'))}</span>` : '') + (p.kind === 'clip' ? '' : favStar(p.page || p.url));
    } else if (p.kind === 'audio') {
        div.classList.add('fcxAudio');
        div.innerHTML = `<div class="fcxAuTop">${fc.ui.icon('music')}<a href="${E(p.url)}" target="_blank" rel="noopener noreferrer" title="${E(p.name)}">${E(p.name)}</a></div>` +
            `<div class="fcxAuCtl"><span class="fcxPlay" title="${E(T('Play'))}">${fc.ui.icon('play', 'fill')}</span><span class="fcxTime">0:00 / -:--</span>` +
            `<div class="fcxSeek"><i></i></div></div><audio src="${E(p.url)}" preload="metadata"></audio>`;
        wirePlayer(div);
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
    // a Blossom picture that won't load: the same file (by its hash) from the other servers, in turn
    div.querySelectorAll('img, video, audio').forEach(i => {
        const alts = fc.data.blossomAlts ? fc.data.blossomAlts(i.getAttribute('src') || '') : [];
        i.onerror = () => {
            if (alts.length) { i.src = alts.shift(); return; }
            if (/^(image|clip|audio)$/.test(p.kind)) { div.remove(); if (onGone) onGone(); } else i.parentNode.remove();
        };
    });
    return div;
}

function renderPreview(line, p) {
    const bc = line.querySelector('.blocksContainer');
    if (!bc) return;
    const old = bc.querySelector(':scope > .fcxEmbed');
    if (old) old.remove();
    const div = embedEl(p, () => { line.classList.remove('fcxOnlyMedia'); showUrlBlocks(line); });
    if (!div) return;
    // only the link in the message: show only the picture; with other words, hide just the link
    if (div.dataset.media) {
        if (lineText(line).replace(/s+/g, '') === String(line.dataset.fcxUrl || '').replace(/s+/g, '')) line.classList.add('fcxOnlyMedia');
        else hideUrlBlock(line, line.dataset.fcxUrl);
    }
    bc.appendChild(div);
}

// any link -> its embed, for chats that aren't Fightcade's (private lobbies, DMs): Promise<element|null>.
// The same allowlist, cache and settings as Fightcade's chat
function embed(url) {
    if (!cfg || !cfg.linkPreviews) return Promise.resolve(null);
    let host;
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return Promise.resolve(null); }
    if (!allowed(host)) return Promise.resolve(null);
    return preview(url).then(p => (p && cfg.linkPreviews ? embedEl(p) : null), () => null);
}

// Fightcade puts a link in a block of its own (<div class="blocks"><span class="link">): with a picture
// under it, that block is hidden and the rest of the message stays (Discord does the same)
function hideUrlBlock(line, url) {
    const want = String(url || '').trim();
    if (!want) return;
    line.querySelectorAll('.blocksContainer > .blocks').forEach(b => {
        const t = b.textContent.trim();
        if (t && (t === want || (b.querySelector('.link') && t.length > 10 && want.indexOf(t) === 0))) b.classList.add('fcxUrlHid');
    });
}
const showUrlBlocks = (root) => (root || document).querySelectorAll('.blocks.fcxUrlHid').forEach(b => b.classList.remove('fcxUrlHid'));

// the star that keeps a GIF / picture in your favorites (uploads.js has them)
function favStar(link) {
    const up = fc.modules.get('uploads');
    if (!up || !up.isFav) return '';
    const on = up.isFav(link);
    return `<span class="fcxFav${on ? ' on' : ''}" title="${E(T(on ? 'Remove from favorites' : 'Add to favorites'))}">${fc.ui.icon('star', on ? 'fill' : '')}</span>`;
}
function favItem(m) { return { link: m.dataset.link, src: m.dataset.view, kind: m.dataset.kind || 'image', still: m.dataset.still || '' }; }
function refreshStars() {
    document.querySelectorAll('.fcxImage:not([data-kind="clip"])').forEach(m => {
        const s = m.querySelector('.fcxFav');
        const html = favStar(m.dataset.link);
        if (s) s.outerHTML = html || '';
        else if (html) m.insertAdjacentHTML('beforeend', html);
    });
}

// the audio players: one plays at a time
const clockOf = (s) => (isFinite(s) && s >= 0 ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '-:--');
function wirePlayer(div) {
    const a = div.querySelector('audio');
    const draw = () => {
        const d = isFinite(a.duration) && a.duration > 0 ? a.duration : 0, playing = !a.paused;
        div.querySelector('.fcxTime').textContent = clockOf(a.currentTime) + ' / ' + (d ? clockOf(d) : '-:--');
        div.querySelector('.fcxSeek > i').style.width = (d ? Math.min(1, a.currentTime / d) * 100 : 0) + '%';
        div.querySelector('.fcxPlay').innerHTML = fc.ui.icon(playing ? 'pause' : 'play', 'fill');
        div.classList.toggle('playing', playing);
    };
    ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause'].forEach(ev => a.addEventListener(ev, draw));
    a.addEventListener('ended', () => { a.currentTime = 0; draw(); });
    a.addEventListener('play', () => document.querySelectorAll('.fcxAudio audio').forEach(o => { if (o !== a) o.pause(); }));
    a.__fcxDraw = draw;
}
function onPlayerClick(e) {
    const div = e.target.closest('.fcxAudio');
    if (!div || e.target.closest('a')) return;
    const a = div.querySelector('audio');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target.closest('.fcxPlay')) { if (a.paused) a.play().catch(err => fc.log('audio', err && err.message)); else a.pause(); return; }
    const track = e.target.closest('.fcxSeek');
    if (!track || !(isFinite(a.duration) && a.duration > 0)) return;
    const r = track.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration;
    if (a.paused) a.play().catch(() => {});
    if (a.__fcxDraw) a.__fcxDraw();
}

// click a picture: unblur it, or see it full size (Esc / click outside closes)
let viewer = null;
function openViewer(src, link) {
    closeViewer();
    const clip = VID_EXT.test(new URL(src).pathname);
    const el = document.createElement('div');
    el.id = 'fcxView';
    el.innerHTML = `<div class="fcxViewIn">${clip ? `<video src="${E(src)}" controls autoplay loop playsinline></video>` : `<img src="${E(src)}" alt="">`}` +
        `<div class="fcxViewBar"><a href="${E(link)}" target="_blank" rel="noopener noreferrer">${E(T('Open in browser'))}</a><span data-act="copy">${E(T('Copy link'))}</span></div></div>`;
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.target === el) closeViewer(); });
    el.addEventListener('click', (e) => {
        if (e.target.closest('[data-act="copy"]')) { fc.ui.copy(link); e.target.textContent = T('Copied'); }
    });
    document.body.appendChild(el);
    viewer = { el, unlayer: fc.ui.layer(() => closeViewer()) };
}
function closeViewer() {
    if (!viewer) return;
    viewer.unlayer();
    viewer.el.remove();
    viewer = null;
}
function onMediaClick(e) {
    if (e.target.closest && e.target.closest('.fcxAudio')) { onPlayerClick(e); return; }
    const m = e.target.closest && e.target.closest('.fcxImage');
    const star = m && e.target.closest('.fcxFav');
    if (star) {
        e.preventDefault();
        e.stopPropagation();
        const up = fc.modules.get('uploads');
        if (up && up.toggleFav) up.toggleFav(favItem(m));
        return;
    }
    if (!m || e.target.tagName === 'VIDEO' && !e.target.classList.contains('fcxGifv') && !m.classList.contains('fcxBlur')) return;
    e.preventDefault();
    e.stopPropagation();
    if (m.classList.contains('fcxBlur')) { m.classList.remove('fcxBlur'); const s = m.querySelector('.fcxShow'); if (s) s.remove(); return; }
    openViewer(m.dataset.view, m.dataset.link);
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
        if (old) { old.remove(); showUrlBlocks(line); }
        if (!url) continue;
        let host;
        try { host = new URL(url).hostname.toLowerCase(); } catch (e) { continue; }
        if (!allowed(host)) continue;                     // unknown domain: never fetched
        preview(url).then(p => {
            if (p && line.isConnected && line.dataset.fcxUrl === url && cfg.linkPreviews) renderPreview(line, p);
        });
    }
}

/* ------------------------------------------------------- multi-line messages */

// Fightcade's message box is one line, but its chat shows a typed \n as a new line (for everyone,
// Fightcord or not). Shift+Enter, or pasting several lines, swaps in a taller box over it; Enter
// sends the lines as ONE message joined with \n, through Fightcade's own box (so font styles and
// :emoji: still apply). Only past Fightcade's 500 characters does it take more than one message
// (a little apart; if Fightcade answers "stop spamming", what didn't go stays in the box).
const ML_MAX = 500, ML_MSGS = 5, ML_GAP = 1100, BR = '\\n';

// the box's text -> its lines (no trailing spaces, no blank lines at the start or end)
function boxLines(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''));
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return lines;
}
// the box's text -> the messages to send: the lines joined with \n, as few messages as fit in 500
// characters (a line that's too long by itself is split at a space)
function packMessages(text, max) {
    const lim = max || ML_MAX, out = [];
    let cur = null;
    boxLines(text).forEach(line => {
        const pieces = line.trim() ? splitLines(line, lim) : [''];
        pieces.forEach(p => {
            if (cur !== null && cur.length + BR.length + p.length <= lim) cur += BR + p;
            else { if (cur !== null) out.push(cur); cur = p; }
        });
    });
    if (cur !== null) out.push(cur);
    // (a message doesn't start or end on an empty line)
    return out.map(m => m.replace(/^(\\n)+|(\\n)+$/g, '')).filter(m => m.replace(/\\n/g, '').trim());
}
// a line that's too long for one message -> pieces cut at a space (blank lines dropped)
function splitLines(text, max) {
    const lim = max || ML_MAX, out = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach(raw => {
        let line = raw.replace(/\s+$/, '');
        if (!line.trim()) return;
        while (line.length > lim) {
            let cut = line.lastIndexOf(' ', lim);
            if (cut < lim / 2) cut = lim;
            out.push(line.slice(0, cut).replace(/\s+$/, ''));
            line = line.slice(cut).replace(/^\s+/, '');
        }
        if (line) out.push(line);
    });
    return out;
}

let ml = null;                 // { wrap, input, ta, note, sending, unlayer }
function openMulti(input, text, caret) {
    if (ml) closeMulti(false);
    const wrap = input.closest('.chatInput');
    if (!wrap) return;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    const cs = getComputedStyle(input);
    const ta = document.createElement('textarea');
    ta.className = 'fcxMulti';
    ta.spellcheck = false;
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'letterSpacing', 'paddingLeft', 'paddingRight', 'borderRadius', 'backgroundColor'].forEach(k => { ta.style[k] = cs[k]; });
    if (!cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)') ta.style.backgroundColor = 'var(--fc-input, #383a40)';
    const note = document.createElement('div');
    note.className = 'fcxMultiNote';
    note.textContent = T('Enter sends · Shift+Enter: new line · Esc: back to one line');
    wrap.appendChild(ta);
    wrap.appendChild(note);
    input.style.visibility = 'hidden';
    ml = { wrap, input, ta, note, sending: false };
    ml.unlayer = fc.ui.layer(() => { if (ml && !ml.sending) closeMulti(true); });
    ta.value = text;
    ['mousedown', 'keypress', 'keyup'].forEach(ev => ta.addEventListener(ev, (e) => e.stopPropagation()));
    ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!ml.sending) sendMulti(); }
    });
    ta.addEventListener('input', () => fitMulti());
    fitMulti();
    ta.focus();
    const at = caret == null ? text.length : caret;
    ta.setSelectionRange(at, at);
}
// grows upward from the box's bottom edge, up to about 10 lines (then it scrolls)
function fitMulti() {
    if (!ml) return;
    const { input, ta, note, wrap } = ml;
    const bottom = wrap.clientHeight - (input.offsetTop + input.offsetHeight);
    Object.assign(ta.style, { left: input.offsetLeft + 'px', width: input.offsetWidth + 'px', bottom: bottom + 'px', height: 'auto' });
    const line = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.style.height = Math.max(input.offsetHeight, Math.min(ta.scrollHeight, line * 10 + 24)) + 'px';
    Object.assign(note.style, { left: (input.offsetLeft + 8) + 'px', bottom: (bottom + ta.offsetHeight + 4) + 'px' });
}
// keepText: what's in the tall box goes back to the one-line box (its lines joined with \n)
function closeMulti(keepText) {
    const m = ml;
    if (!m) return;
    ml = null;
    m.unlayer();
    const text = m.ta.value;
    m.ta.remove();
    m.note.remove();
    m.input.style.visibility = '';
    if (keepText && m.input.isConnected) fc.app.setChatText(boxLines(text).join(BR));
    else if (m.input.isConnected) m.input.focus();
}
const spamCount = (wrap) => { const ch = wrap.closest('.channelWrapper') || document; return ch.querySelectorAll('.chatContent .spam').length; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function sendMulti() {
    const m = ml;
    const lines = packMessages(m.ta.value);          // (one message, unless it's past 500 characters)
    if (!lines.length) return;
    if (lines.length > ML_MSGS) { fc.ui.toast(T('Too long: up to about {n} characters at a time', { n: ML_MSGS * ML_MAX }), { kind: 'warning', icon: 'warn' }); return; }
    m.sending = true;
    m.ta.readOnly = true;
    m.ta.classList.add('sending');
    for (let i = 0; i < lines.length; i++) {
        if (ml !== m || !m.input.isConnected) return;
        if (lines.length > 1) m.note.textContent = T('Sending {n} of {total}…', { n: i + 1, total: lines.length });
        const before = spamCount(m.wrap);
        fc.app.setChatText(lines[i], false);
        m.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        await wait(i < lines.length - 1 ? ML_GAP : 400);
        if (ml !== m) return;
        // Fightcade marks a refused line "Message not sent. Please stop spamming.": keep it and the rest
        if (spamCount(m.wrap) > before) {
            m.ta.value = lines.slice(i).map(x => x.split(BR).join('\n')).join('\n');
            m.sending = false;
            m.ta.readOnly = false;
            m.ta.classList.remove('sending');
            m.note.textContent = T('Fightcade asked to slow down: Enter sends the rest');
            fitMulti();
            m.ta.focus();
            return;
        }
    }
    closeMulti(false);
}
// Shift+Enter in Fightcade's box, or a paste with line breaks (the one-line box would squash them)
function onMultiKey(e) {
    if (!cfg.multiLine || e.key !== 'Enter' || !e.shiftKey || e.isComposing) return;
    const input = e.target && e.target.closest && e.target.closest('.chatInput') && e.target.tagName === 'INPUT' ? e.target : null;
    if (!input) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // (a \n already typed in the one-line box becomes a real line here)
    const at = input.selectionStart == null ? input.value.length : input.selectionStart;
    const head = input.value.slice(0, at).split(BR).join('\n'), tail = input.value.slice(input.selectionEnd == null ? at : input.selectionEnd).split(BR).join('\n');
    openMulti(input, head + '\n' + tail, head.length + 1);
}
function onMultiPaste(e) {
    if (!cfg.multiLine || !e.clipboardData) return;
    const input = e.target && e.target.closest && e.target.closest('.chatInput') && e.target.tagName === 'INPUT' ? e.target : null;
    const text = e.clipboardData.getData('text/plain') || '';
    if (!input || !/\S[^\n]*\r?\n[^\n]*\S/.test(text)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const a = input.selectionStart == null ? input.value.length : input.selectionStart, b = input.selectionEnd == null ? a : input.selectionEnd;
    const t = text.replace(/\r/g, ''), head = input.value.slice(0, a).split(BR).join('\n') + t;
    openMulti(input, head + input.value.slice(b).split(BR).join('\n'), head.length);
}

/* ---------------------------------------------------------- jump to present */

let jump = null, jumpChat = null;

function ensureJump() {
    if (jump) return jump;
    jump = document.createElement('div');
    jump.id = 'fcxJump';
    jump.innerHTML = `<span>${E(T("You're viewing older messages"))}</span><span class="fcxJumpBtn">${E(T('Jump to present'))}</span>`;
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
/* the channel notice, folded to one line (2.13) */
.messageWrapper.motd.fcx-motd-shut > .motd { display: none !important; }
.messageWrapper.motd.fcx-motd-shut { border: 0 !important; box-shadow: none !important; background: none !important; padding: 0 !important; }
.fcxMotd { display: flex; align-items: center; margin: 0; padding: 8px 12px; border-radius: 8px; cursor: pointer; user-select: none;
    background: rgba(255,255,255,.045); color: var(--fc-muted); font: 500 13px/18px var(--fc-font); box-shadow: inset 3px 0 0 var(--fc-accent); }
.fcxMotd:hover { background: rgba(255,255,255,.08); color: var(--fc-text); }
.fcxMotd > .fc-ic { width: 16px; height: 16px; flex: none; margin-right: 8px; color: var(--fc-accent); }
.fcxMotd > b { flex: none; color: var(--fc-head); font-weight: 600; margin-right: 10px; }
.fcxMotd > span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcxMotd > i { display: inline-flex; flex: none; margin-left: 8px; transition: transform .15s; }
.fcxMotd > i > .fc-ic { width: 16px; height: 16px; }
.messageWrapper.motd.fcx-motd:not(.fcx-motd-shut) > .fcxMotd > i { transform: rotate(180deg); }
.messageWrapper.motd.fcx-motd:not(.fcx-motd-shut) > .fcxMotd { margin-bottom: 0; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
html body .chatContent .messageWrapper.chat .message.chat .line.fcx-mention,
html body .chatContent .messageWrapper.chat .message.chat.fcx-mention-head > header {
    background: rgba(250,168,26,.12) !important; box-shadow: inset 2px 0 0 #f0b232 !important; border-radius: 0 !important; transition: background-color .12s; }
html body .chatContent .messageWrapper.chat .message.chat .line.fcx-mention:hover,
html body .chatContent .messageWrapper.chat .message.chat .line.fcx-mention.fcx-hov,
html body .chatContent .messageWrapper.chat .message.chat.fcx-mention-head > header.fcx-hov { background: rgba(250,168,26,.17) !important; }

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
html.fcx-syscards body .chatContent .messageWrapper.requestChallenge .wrapUpWrapper.accepted::before { content: '' !important; display: inline-block !important; width: 14px !important; height: 14px !important; margin-right: 6px !important; vertical-align: -2px !important; background: currentColor !important; -webkit-mask: var(--fc-i-check) center / contain no-repeat !important; }
html.fcx-syscards body .chatContent .messageWrapper.requestChallenge .wrapUpWrapper.declined { color: #f23f43 !important; background: rgba(242,63,67,.12) !important; }
html.fcx-syscards body .chatContent .messageWrapper.requestChallenge .wrapUpWrapper.declined::before { content: '' !important; display: inline-block !important; width: 14px !important; height: 14px !important; margin-right: 6px !important; vertical-align: -2px !important; background: currentColor !important; -webkit-mask: var(--fc-i-close) center / contain no-repeat !important; }
html.fcx-syscards body .chatContent .messageWrapper.challengeRequested .challengeWrapper .title {
    color: var(--fc-text) !important; background: var(--fc-accent-soft) !important; }
html.fcx-syscards body .chatContent .messageWrapper.challengeRequested .challengeWrapper .title::before { content: '' !important; display: inline-block !important; width: 15px !important; height: 15px !important; margin-right: 6px !important; vertical-align: -2px !important; background: currentColor !important; -webkit-mask: var(--fc-i-swords) center / contain no-repeat !important; }
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
.fcxEmbed.fcxImage { position: relative; display: block; width: -webkit-fit-content; width: fit-content; padding: 0; background: none; border: 0; max-width: 400px; overflow: hidden; border-radius: 8px; line-height: 0; }
.fcxEmbed.fcxImage img, .fcxEmbed.fcxImage video { width: auto !important; height: auto !important; max-width: 400px; max-height: 300px;
    border-radius: 8px; display: block; cursor: zoom-in; background: rgba(0,0,0,.2); }
.fcxEmbed.fcxImage video { cursor: default; }
.fcxEmbed.fcxImage video.fcxGifv { cursor: zoom-in; }
.fcxEmbed.fcxBlur img, .fcxEmbed.fcxBlur video { filter: blur(24px); transform: scale(1.06); cursor: pointer; }
.fcxEmbed .fcxShow { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 6px 14px; border-radius: 16px; cursor: pointer;
    background: rgba(0,0,0,.65); color: #fff; font: 600 13px/1.2 var(--fc-font); }
.fcxEmbed .fcxFav { position: absolute; top: 6px; right: 6px; display: none; padding: 5px; border-radius: 50%; cursor: pointer; line-height: 0;
    background: rgba(0,0,0,.6); color: #fff; }
.fcxEmbed.fcxImage:hover .fcxFav { display: block; }
.fcxEmbed .fcxFav.on { color: var(--fc-warning); }
.fcxEmbed .fcxFav:hover { background: rgba(0,0,0,.8); }
.fcxEmbed .fcxFav .fc-ic { width: 16px; height: 16px; }
.line.fcxOnlyMedia .blocksContainer > :not(.fcxEmbed):not(.fcTr) { display: none !important; }
.blocksContainer > .blocks.fcxUrlHid { display: none !important; }
/* multi-line messages */
.fcxMulti { position: absolute; z-index: 60; box-sizing: border-box; margin: 0; padding-top: 11px; padding-bottom: 11px; border: 0; outline: none; resize: none;
    overflow-y: auto; white-space: pre-wrap; box-shadow: 0 0 0 1px var(--fc-accent), 0 -6px 18px rgba(0,0,0,.25); }
.fcxMulti.sending { opacity: .6; }
.fcxMultiNote { position: absolute; z-index: 60; padding: 2px 8px; border-radius: 4px; font: 500 12px/18px var(--fc-font); color: var(--fc-muted);
    background: var(--fc-s1, rgba(0,0,0,.6)); pointer-events: none; white-space: nowrap; }
/* audio files */
.fcxEmbed.fcxAudio { border-left: 0; line-height: 1.3; user-select: none; }
.fcxEmbed.fcxAudio { width: 400px; max-width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 8px; }
.fcxAuTop { display: flex; align-items: center; min-width: 0; margin-bottom: 10px; }
.fcxAuTop > .fc-ic { flex: none; width: 28px; height: 28px; margin-right: 10px; color: var(--fc-accent); }
.fcxAuTop a { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: #00a8fc !important; }
.fcxAuCtl { display: flex; align-items: center; }
.fcxEmbed .fcxPlay { flex: none; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
    background: var(--fc-accent); color: #fff; }
.fcxEmbed .fcxPlay:hover { filter: brightness(1.12); }
.fcxEmbed .fcxPlay .fc-ic { width: 14px; height: 14px; }
.fcxAuCtl .fcxTime { flex: none; margin: 0 12px; font-size: 12px; color: var(--fc-muted); font-variant-numeric: tabular-nums; }
.fcxSeek { flex: 1; height: 6px; border-radius: 3px; cursor: pointer; background: rgba(255,255,255,.12); overflow: hidden; }
.fcxSeek > i { display: block; width: 0; height: 100%; background: var(--fc-accent); }
#fcxView { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: var(--fc-z-modal, 100010); display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.85); animation: fcIn var(--fc-med, .2s) ease both; }
#fcxView .fcxViewIn { display: flex; flex-direction: column; align-items: flex-start; max-width: 90vw; }
#fcxView img, #fcxView video { max-width: 90vw; max-height: 82vh; border-radius: 6px; display: block; box-shadow: 0 8px 40px rgba(0,0,0,.6); }
#fcxView .fcxViewBar { display: flex; margin-top: 8px; font: 500 14px/1.2 var(--fc-font); }
#fcxView .fcxViewBar a, #fcxView .fcxViewBar span { margin-right: 16px; color: rgba(255,255,255,.75) !important; cursor: pointer; text-decoration: none; }
#fcxView .fcxViewBar a:hover, #fcxView .fcxViewBar span:hover { color: #fff !important; text-decoration: underline; }

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

/* ---------------------------------------------------- the channel notice (2.13) */

// what the notice holds -> the words on its folded line
function noticeSummary(n, tt) {
    const t = tt || T;                       // (tests pass their own translator)
    const bits = [];
    if (n.rules) bits.push(t('Rules'));
    if (n.links) bits.push(t.plural(n.links, '{n} link', '{n} links', { n: n.links }));
    if (n.events) bits.push(t.plural(n.events, '{n} event', '{n} events', { n: n.events }));
    return bits;
}
function noticeOf(motd) {
    return {
        rules: [...motd.querySelectorAll('.highlight')].some(h => /rules/i.test(h.textContent)),
        links: motd.querySelectorAll('.blocks .link, a.link').length,
        events: motd.querySelectorAll('.eventsItem').length
    };
}
function foldNotices(chat) {
    chat.querySelectorAll('.messageWrapper.motd').forEach(w => {
        const motd = w.querySelector(':scope > .motd');
        let bar = w.querySelector(':scope > .fcxMotd');
        if (!cfg.noticeFolded || !motd) { if (bar) bar.remove(); w.classList.remove('fcx-motd', 'fcx-motd-shut'); return; }
        const c = fc.app.channelOf(w);
        const key = c ? c.name || c.id : '';
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'fcxMotd';
            bar.addEventListener('click', (e) => {
                e.stopPropagation();
                const open = !w.classList.contains('fcx-motd-shut');
                if (open) delete cfg.noticeOpen[bar.dataset.ch]; else cfg.noticeOpen[bar.dataset.ch] = true;
                store.save();
                foldNotices(chat);
            });
            w.insertBefore(bar, motd);
        }
        bar.dataset.ch = key;
        const shut = !cfg.noticeOpen[key];
        w.classList.add('fcx-motd');
        w.classList.toggle('fcx-motd-shut', shut);
        const sum = noticeSummary(noticeOf(motd)).join(' · ');
        const html = fc.ui.icon('info') + '<b>' + E(T('Channel info')) + '</b>' + (sum ? '<span>' + E(sum) + '</span>' : '') +
            '<i title="' + E(T(shut ? 'Show' : 'Hide')) + '">' + fc.ui.icon('chevronDown') + '</i>';
        if (bar.__html !== html) { bar.__html = html; bar.innerHTML = html; }
    });
}

function sweep() {
    const me = fc.app.me();
    document.querySelectorAll('.chatContent').forEach(chat => {
        trackNew(chat);
        if (chat.offsetParent === null) return;
        stateOf(chat);
        foldNotices(chat);
        markMentions(chat, me);
        formatTimes(chat);
        polish(chat);
        previewLinks(chat);
    });
    updateJump();
}

function onSetting(key) {
    if (!cfg.linkPreviews || !cfg.imagePreviews || key === 'blurMedia') {
        document.querySelectorAll('.fcxEmbed').forEach(n => n.remove());
        document.querySelectorAll('.line.fcxOnlyMedia').forEach(l => l.classList.remove('fcxOnlyMedia'));
        showUrlBlocks();
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
    fc.ui.style('fcxStyle', CSS.replace("content: 'NEW'", 'content: ' + JSON.stringify(T('NEW'))));

    const listen = (target, ev, fn, cap) => { target.addEventListener(ev, fn, cap); fc.own(() => target.removeEventListener(ev, fn, cap)); };
    listen(document, 'mouseover', onMouseOver, true);
    listen(document, 'scroll', (e) => { if (e.target && e.target.classList && e.target.classList.contains('chatContent')) { hideBar(); updateJump(); } }, true);
    // sending a message = you've caught up
    listen(document, 'click', onMediaClick, true);
    listen(window, 'keydown', onMultiKey, true);
    listen(document, 'paste', onMultiPaste, true);
    listen(window, 'resize', () => fitMulti());
    fc.on('gifs:changed', () => refreshStars());
    fc.own(() => closeViewer());
    listen(window, 'keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.closest && e.target.closest('.chatInput') && e.target.value) clearNew(); }, true);
    listen(window, 'focus', () => setTimeout(sweep, 50));
    listen(window, 'blur', () => setTimeout(sweep, 50));
    listen(window, 'resize', () => { hideBar(); updateJump(); });
    fc.own(() => {
        fc.ui.style('fcxStyle', null);
        closeMulti(true);
        hideBar();
        if (jump) { jump.remove(); jump = null; }
        document.querySelectorAll('.fcxEmbed audio').forEach(a => a.pause());
        document.querySelectorAll('.fcxEmbed').forEach(n => n.remove());
        document.querySelectorAll('.line.fcxOnlyMedia').forEach(l => l.classList.remove('fcxOnlyMedia'));
        showUrlBlocks();
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
            opt('imagePreviews', 'Images, GIFs, clips and audio', 'Pictures, videos and audio from trusted sites (Nostr picture servers, catbox, uguu, imgur, KLIPY, Tenor, Giphy, Discord) show in the chat', (d) => d.linkPreviews),
            opt('blurMedia', 'Blur them until clicked', 'Click a blurred picture to show it', (d) => d.linkPreviews && d.imagePreviews),
            opt('multiLine', 'Messages with several lines', 'Shift+Enter (or pasting several lines) opens a taller box; Fightcade shows the lines as one message, for everyone'),
            opt('jumpBar', 'Jump to present', 'A bar when you scroll up'),
            opt('discordTime', 'Discord timestamps', '"10:16 PM" instead of "at 22:16"'),
            opt('hour12', '12-hour clock', 'Off = 22:16', (d) => d.discordTime),
            opt('animate', 'Animate new messages', 'They slide in'),
            opt('rankColors', 'Rank colours', 'Names coloured by channel rank (S gold, A red, B purple…)'),
            opt('systemCards', 'Compact system messages', 'Challenge and match messages as pills and cards'),
            opt('timeDividers', 'Time dividers', 'A line with the time after a 20+ minute gap'),
            opt('noticeFolded', 'Fold the channel notice', 'Rules, links and events as one line until you open it (remembered per channel)')
        ]
    });
    sweep();
    return api;
}

const api = {
    // a link's embed for another chat (lobbies, DMs): Promise<element|null>
    embed: (url) => embed(url),
    _noticeSummary: (n) => noticeSummary(n),
    _buildPreview: (u) => buildPreview(u),
    // the dev harness: show a preview for a made-up file (blob: URLs only there)
    _render(line, p) { try { imageAllowedHook = (u) => /^blob:/.test(u); renderPreview(line, p); } finally { imageAllowedHook = null; } },
    _viewer: (src, link) => openViewer(src, link || src),
    _allowed: allowed,
    _sweep: () => sweep(),
    _multi: () => ml,
    openMulti: (text) => { const i = fc.app.chatInput(); if (i) openMulti(i, String(text || ''), null); },
    get _config() { return cfg; }
};

module.exports = { id: 'chat-extras', name: 'Chat extras', start, noticeSummary, splitLines, packMessages };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
