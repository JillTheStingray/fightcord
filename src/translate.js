/**
 * Fightcord chat translator
 *
 * Translates other players' chat into your language and shows it under the original,
 * Discord style:
 *
 *     pasni aku buat kat kau pulak ye
 *     文A I'll do it for you later.
 *        (translated from Malay – Dismiss)
 *
 * Uses Google Translate's free web endpoint (no key, no account). Only incoming chat that
 * plausibly isn't already in your language is sent: your own messages, system notices, short
 * FGC slang ("gg", "ft3", "games"), links and emoji-only lines are skipped. Nothing you type is
 * sent anywhere.
 *
 *   /tr            status + help
 *   /tr on|off     toggle
 *   /tr es         translate into Spanish (any language code)
 *   Settings -> Chat
 */
'use strict';

let fc = null;
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
let store = null, config = null;          // translate-config.json

/* --------------------------------------------------------------- languages */

// Chromium 80 has no Intl.DisplayNames (it landed in 81), so names are listed.
// language names are translated where shown
const N_ = (s) => s;
const LANGS = {
    en: N_('English'), es: N_('Spanish'), pt: N_('Portuguese'), fr: N_('French'), de: N_('German'), it: N_('Italian'),
    nl: N_('Dutch'), ru: N_('Russian'), uk: N_('Ukrainian'), pl: N_('Polish'), tr: N_('Turkish'), ar: N_('Arabic'),
    ja: N_('Japanese'), ko: N_('Korean'), 'zh-CN': N_('Chinese'), 'zh-TW': N_('Chinese (Traditional)'), zh: N_('Chinese'),
    ms: N_('Malay'), id: N_('Indonesian'), tl: N_('Filipino'), fil: N_('Filipino'), vi: N_('Vietnamese'), th: N_('Thai'),
    hi: N_('Hindi'), bn: N_('Bengali'), ur: N_('Urdu'), fa: N_('Persian'), he: N_('Hebrew'), iw: N_('Hebrew'), el: N_('Greek'),
    sv: N_('Swedish'), no: N_('Norwegian'), da: N_('Danish'), fi: N_('Finnish'), cs: N_('Czech'), sk: N_('Slovak'),
    hu: N_('Hungarian'), ro: N_('Romanian'), bg: N_('Bulgarian'), sr: N_('Serbian'), hr: N_('Croatian'), ca: N_('Catalan'),
    gl: N_('Galician'), eu: N_('Basque'), sw: N_('Swahili'), af: N_('Afrikaans'), lt: N_('Lithuanian'), lv: N_('Latvian'),
    et: N_('Estonian'), sl: N_('Slovenian'), is: N_('Icelandic'), ga: N_('Irish'), cy: N_('Welsh'), la: N_('Latin')
};
const langName = (c) => { const n = LANGS[c] || LANGS[String(c).split('-')[0]]; return n ? (fc ? fc.t(n) : n) : String(c).toUpperCase(); };
// '' (the default) = the language Fightcord itself is in
const target = () => config.target || (fc ? fc.t.lang() : 'en');

// Offered in the settings dropdown (any code works via /tr <code>).
const TARGETS = ['en', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'ru', 'pl', 'tr', 'ar', 'ja', 'ko',
    'zh-CN', 'ms', 'id', 'tl', 'vi', 'th', 'hi'];

/* ---------------------------------------------------------------- skipping */

// Chat that never needs translating. Mostly FGC shorthand and English filler;
// without this list Google happily "detects" "ggs" as Somali and "ft3" as Malay.
const PLAIN = new Set(('gg ggs ggwp gj wp glhf gl hf ez ft ft2 ft3 ft5 ft10 ft7 lol lmao lmfao rofl xd xdd ' +
    'haha hahaha hehe kek bro bruh brb afk gtg ty thx thanks np yw ok okay k kk yes yeah yep ya no nah nope ' +
    'hi hey hello yo sup gm gn cya bye rematch rm more again one games game play lets let\'s go run it back ' +
    'nice good great sick wow omg wtf idk idc ikr imo tbh ngl fr rn pls plz sorry my bad mb lag laggy ' +
    'rollback delay ping wifi the a an and or i you me my it is are was to of in on for with that this what ' +
    'why how who when where u ur r im i\'m can cant can\'t dont don\'t do did not just so too very really').split(' '));

// Everyday English. When translating INTO English, a line made mostly of these
// is English already and isn't worth a request (it would come back unchanged).
const COMMON_EN = new Set(('about above after all also always am any anyone anything around as ask at away back be ' +
    'because been before being best better big both but by call came come could day did different does doing done ' +
    'down each even ever every feel few find first from get gets getting give got had has have having he her here ' +
    'him his hit home if into its keep kind know last like little long look looking lot made make man many maybe ' +
    'me mean might more most much must need never new next nothing now off old once only other our out over own ' +
    'people put right said same say see seems she should show since some someone something sometimes still such ' +
    'sure take than their them then there these they thing things think those though through time top try trying ' +
    'two up us use used want wants was way we well went were which while will win won would year you your yours ' +
    'thank thanks please man guy guys dude player players match matches character characters main mains online ' +
    'lose lost losing beat beating broken connection internet steam works work working happened happening fine ' +
    'somethings anyone everyone everything anymore enough actually probably literally honestly').split(' '));

function mostlyEnglish(words) {
    const known = words.filter(w => PLAIN.has(w) || COMMON_EN.has(w)).length;
    return known / words.length >= 0.6;
}

function lettersOf(t) { return (t.match(/\p{L}/gu) || []).join(''); }

// Anything outside Latin script (Cyrillic, Arabic, CJK, Thai, ...) is worth a
// look no matter how short it is.
const NON_LATIN = /[^\u0000-ɏḀ-ỿ\s\p{P}\p{S}\p{N}\p{M}]/u;

function worthTranslating(text) {
    const t = text.replace(/https?:\/\/\S+/g, ' ').replace(/@\S+/g, ' ').trim();
    if (NON_LATIN.test(t)) return lettersOf(t).length >= 1;
    if (lettersOf(t).length < 4) return false;
    const words = t.toLowerCase().match(/[\p{L}']+/gu) || [];
    if (!words.length) return false;
    if (words.every(w => PLAIN.has(w) || /^(ha)+h?$|^(he)+$|^(ja)+$|^(ka)+$|^(k)+$|^x+d+$/.test(w))) return false;
    if (target().split('-')[0] === 'en' && mostlyEnglish(words)) return false;
    return true;
}

const norm = (s) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

// Fancy Unicode from the font plugin (𝐠𝐠, ｆｕｌｌｗｉｄｔｈ) confuses language
// detection -- reuse fontstyle.js's un-styler when it's installed.
const unstyle = (s) => { const fs_ = fc && fc.modules.get('fontstyle'); return fs_ && fs_.unstyle ? fs_.unstyle(s) : s; };

/* ------------------------------------------------------------ translation */

// translate.googleapis.com with client=gtx: the endpoint Google's own web
// widgets use. dj=1 returns an object: {sentences:[{trans,orig}], src, confidence}.
function request(text, tl) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
        encodeURIComponent(tl) + '&dt=t&dt=ld&dj=1&q=' + encodeURIComponent(text);
    let https = null;
    try { https = require('https'); } catch (e) { /* not in the dev harness */ }
    if (!https) return fetch(url).then(r => { if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status }); return r.json(); });
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(Object.assign(new Error('HTTP ' + res.statusCode), { status: res.statusCode }));
                try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

const cache = new Map();      // `${tl}\n${text}` -> {text, src} | null (nothing to show)
const CACHE_MAX = 600;

function remember(key, val) {
    cache.set(key, val);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// One request at a time, spaced out; back off hard if Google pushes back.
const queue = [];
let busy = false;
let pausedUntil = 0;
let backoff = 30000;

// While Google has us paused (up to 15 min) chat keeps coming; only the newest
// lines are still worth translating, and a backlog burst would get us blocked again.
const QUEUE_MAX = 20;

function translate(text) {
    const key = target() + '\n' + text;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    const queued = queue.find(j => j.key === key);           // same text already waiting
    if (queued) return new Promise((resolve) => { queued.also = (queued.also || []).concat(resolve); });
    return new Promise((resolve) => {
        queue.push({ text, key, resolve });
        while (queue.length > QUEUE_MAX) settle(queue.shift(), null);
        pump();
    });
}

function settle(job, val) {
    job.resolve(val);
    (job.also || []).forEach(r => r(val));
}

async function pump() {
    if (busy || !queue.length) return;
    const wait = pausedUntil - Date.now();
    if (wait > 0) { setTimeout(pump, wait); return; }
    busy = true;
    const job = queue.shift();
    try {
        if (cache.has(job.key)) { settle(job, cache.get(job.key)); return; }
        const d = await request(job.text, target());
        const out = (d.sentences || []).map(x => x.trans || '').join('').trim();
        const src = d.src || (d.ld_result && d.ld_result.srclangs && d.ld_result.srclangs[0]) || '';
        const conf = typeof d.confidence === 'number' ? d.confidence : 1;
        const same = !out || !src || src.split('-')[0] === target().split('-')[0] || norm(out) === norm(job.text);
        const val = (same || conf < 0.5) ? null : { text: out, src };
        remember(job.key, val);
        backoff = 30000;
        settle(job, val);
    } catch (e) {
        if (e && (e.status === 429 || e.status === 403 || e.status >= 500)) {
            pausedUntil = Date.now() + backoff;
            fc.log('Google pushed back (' + e.status + '), pausing ' + (backoff / 1000) + 's');
            backoff = Math.min(backoff * 2, 15 * 60000);
            queue.unshift(job);           // retry after the pause
            return;
        }
        fc.log('translate failed:', e && e.message);
        settle(job, null);
    } finally {
        busy = false;
        setTimeout(pump, 250);
    }
}

/* ---------------------------------------------------------------- the chat */


// The words to translate: the line's text minus @mentions and links (FC renders
// those as .user / .link spans). Otherwise a name like "akuma furioso" comes
// back as "akuma furious", and chat-extras' embeds would be sent along too.
const SKIP_IN_LINE = '.fcTr, .fcxEmbed, .user, .link, a';
function lineText(line) {
    const bc = line.querySelector('.blocksContainer');
    if (!bc) return '';
    let t = '';
    const walker = document.createTreeWalker(bc, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const n = walker.currentNode;
        if (!(n.parentElement && n.parentElement.closest(SKIP_IN_LINE))) t += n.nodeValue;
    }
    return t.replace(/\s+/g, ' ').trim();
}

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>';

function render(line, tr) {
    const bc = line.querySelector('.blocksContainer');
    if (!bc) return;
    { const old = bc.querySelector(':scope > .fcTr'); if (old) old.remove(); }
    const div = document.createElement('div');
    div.className = 'fcTr';
    div.innerHTML = ICON + '<span class="fcTrText"></span><div class="fcTrMeta">(' + fc.fmt.esc(T('translated from {language}', { language: langName(tr.src) })) +
        ' – <span class="fcTrDismiss">' + fc.fmt.esc(T('Dismiss')) + '</span>)</div>';
    div.querySelector('.fcTrText').textContent = tr.text;
    div.querySelector('.fcTrDismiss').addEventListener('click', (e) => {
        e.stopPropagation();
        line.dataset.trDismissed = line.dataset.trSrc || '1';
        div.remove();
    });
    bc.appendChild(div);
}

const LINES_PER_CHAT = 25;   // on joining a busy channel, only the newest lines

function sweep() {
    if (!config.enabled) return;
    const me = fc.app.me().toLowerCase();
    document.querySelectorAll('.chatContent').forEach(chat => {
        if (chat.offsetParent === null) return;          // hidden channel: handled when you switch to it
        const lines = chat.querySelectorAll('.messageWrapper.chat .line');
        for (let i = Math.max(0, lines.length - LINES_PER_CHAT); i < lines.length; i++) {
            const line = lines[i];
            const text = lineText(line);
            if (!text || line.dataset.trSrc === text) continue;       // done (or pending) for this text
            line.dataset.trSrc = text;
            { const old = line.querySelector('.blocksContainer > .fcTr'); if (old) old.remove(); }
            if (line.dataset.trDismissed === text) continue;

            const wrap = line.closest('.messageWrapper');
            const au = wrap.querySelector('header .author');
            const author = (wrap.dataset.currentUser || (au && au.firstChild && au.firstChild.textContent) || '').trim().toLowerCase();
            if (me && author === me) continue;

            const plain = unstyle(text);
            if (!worthTranslating(plain)) continue;
            translate(plain).then(tr => {
                // the line may have been re-rendered with other text meanwhile
                if (tr && line.isConnected && line.dataset.trSrc === text && config.enabled) render(line, tr);
            });
        }
    });
}

function clearAll() {
    document.querySelectorAll('.fcTr').forEach(n => n.remove());
    document.querySelectorAll('.line[data-tr-src]').forEach(l => { delete l.dataset.trSrc; });
}

const CSS = `
.fcTr { display: block; margin: 2px 0 1px; font-style: italic; font-size: .95em; line-height: 1.375;
    color: var(--mainColor-lightest-trans-md, var(--fc-muted)); white-space: normal; }
.fcTr svg { width: 15px; height: 15px; vertical-align: -3px; margin-right: 6px; fill: currentColor; }
.fcTr .fcTrText { color: var(--mainColor-lightest-trans-hi, var(--fc-text)); }
.fcTr .fcTrMeta { font-size: .9em; }
.fcTr .fcTrDismiss { color: var(--fc-link); cursor: pointer; }
.fcTr .fcTrDismiss:hover { text-decoration: underline; }
`;

/* ---------------------------------------------------------------- controls */

const say = (msg, sub) => fc.ui.toast(msg, { icon: 'globe', sub, ms: 4000 });

function setEnabled(on) {
    config.enabled = on;
    store.save();
    fc.settings.refresh('translate');
    if (on) sweep(); else clearAll();
}

function setTarget(code) {
    config.target = code;
    store.save();
    fc.settings.refresh('translate');
    clearAll();
    sweep();
}

function onCmd(arg) {
    if (/^(on|off)$/i.test(arg)) { setEnabled(arg.toLowerCase() === 'on'); say(T(arg.toLowerCase() === 'on' ? 'Chat translator on' : 'Chat translator off')); return; }
    if (/^[a-z]{2,3}(-[A-Za-z]{2})?$/i.test(arg)) {
        const code = arg.length > 3 ? arg.slice(0, 2).toLowerCase() + '-' + arg.slice(3).toUpperCase() : arg.toLowerCase();
        setTarget(code);
        say(T('Translating chat into {language}', { language: langName(code) }));
        return;
    }
    say(T(config.enabled ? 'Chat translator on' : 'Chat translator off') + ' → ' + langName(target()), T('/tr on|off · /tr <language code>, e.g. /tr es, /tr pt, /tr ja'));
}

// On demand (chat-extras' hover toolbar): skip the auto-filter, translate this line now.
function translateLine(line) {
    const text = lineText(line);
    if (!text) return Promise.resolve(null);
    return translate(unstyle(text)).then(tr => {
        if (!line.isConnected) return tr;
        if (tr) {
            line.dataset.trSrc = text;
            delete line.dataset.trDismissed;
            render(line, tr);
        } else say(T('Already in {language} (or nothing to translate)', { language: langName(target()) }));
        return tr;
    });
}

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('translate', { enabled: true, target: '' });        // '' = the language Fightcord is in
    config = store.data;
    window.__fcTranslateLoaded = true;
    fc.ui.style('fcTrStyle', CSS);
    fc.own(() => { fc.ui.style('fcTrStyle', null); clearAll(); window.__fcTranslateLoaded = false; });
    fc.watch(sweep, { selector: '.chatContent' });
    // switching channels only flips visibility (no DOM insert), so also sweep on a timer
    fc.tick(sweep, 2000);
    fc.cmd('tr', 'Chat translator: on / off / language', onCmd, { args: 'on|off|<code>' });
    fc.cmd('translate', 'Chat translator: on / off / language', onCmd, { args: 'on|off|<code>' });
    const langs = () => [['', T('Same as Fightcord ({language})', { language: langName(fc.t.lang()) })]]
        .concat(TARGETS.concat(!config.target || TARGETS.includes(config.target) ? [] : [config.target]).map(c => [c, langName(c)]));
    fc.settings.block({
        id: 'translate', section: 'chat', title: 'Chat translator', hint: '— other players’ messages, via Google Translate', store, order: 20,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Translate other players’ messages', onChange: (v) => { if (v) sweep(); else clearAll(); } },
            { key: 'target', type: 'select', label: 'Into', options: langs(), show: (d) => d.enabled, onChange: () => { clearAll(); sweep(); } },
            { type: 'note', label: 'Or in chat: /tr es, /tr pt, /tr ja … (any language code)' }
        ]
    });
    sweep();
    fc.log('ready -', config.enabled ? 'on' : 'off', '→', target());
    return api;
}

const api = {
    translateLine: (line) => translateLine(line),
    worthTranslating: (t) => worthTranslating(t),
    translate: (t) => translate(t),
    get _config() { return config; }
};

module.exports = { id: 'translate', name: 'Translator', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
