/**
 * Fightcord chat font style
 *
 * Adds a "Chat font style" option to Fightcade. Outgoing chat messages are
 * rewritten with Unicode look-alike letters (mathematical alphanumerics,
 * fullwidth, circled, ...), so EVERYONE sees the styled text -- it travels as
 * plain text, no client mod required on their side.
 *
 * Usage:
 *   - Settings -> Chat -> "Chat font style", or
 *   - type  /font          in chat to list styles
 *     type  /font script   to switch
 *     type  /font off      to go back to normal
 *
 *   - Aa button by the chat box, Ctrl+Shift+F cycles favourites, Ctrl+Shift+X toggles
 *   - /mac F1 gg wp  -> F1 in the chat box types it (Ctrl+F1 sends it)
 */

'use strict';

let fc = null;
let store = null, config = null;          // fontstyle-config.json
const DEFAULTS = {
    style: 'off',                 // global style applied to outgoing messages
    lastStyle: 'bold',            // for the off/on toggle hotkey
    plainMentions: true,          // leave player names unstyled so pings still fire
    inlineMarkup: true,           // *bold* _italic_ ~strike~ `mono` __underline__
    decoration: 'none',           // prefix/suffix ornament preset
    readableChat: false,          // un-style other people's fancy text
    favorites: ['bold', 'script', 'fraktur', 'fullwidth'],
    macros: {}                    // { F1: 'gg wp', ... }
};
const saveConfig = () => { store.save(); if (fc) fc.settings.refresh('fontstyle'); };

/* ------------------------------------------------------------------- fonts */

const cp = (s) => s.codePointAt(0);
const PLAIN_U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PLAIN_L = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

function buildTable(from, to) {
    const t = {};
    const f = Array.from(from), g = Array.from(to);
    for (let i = 0; i < f.length && i < g.length; i++) t[f[i]] = g[i];
    return t;
}

// Contiguous Unicode block: u/l/d are the codepoints of A / a / 0 in that block.
// `holes` lists the characters that live outside the block (reserved slots).
function ranged(u, l, d, holes) {
    return { kind: 'ranged', u, l, d, holes: holes || {} };
}
// Explicit per-character substitution table.
function table(t) { return { kind: 'table', table: t }; }
// Whole-string transform.
function fn(f) { return { kind: 'fn', fn: f }; }
// Combining-mark overlay (strike / underline / slash).
function overlay(mark) {
    return fn((text) => Array.from(text).map(c => c === ' ' ? c : c + mark).join(''));
}

const SCRIPT_HOLES = {
    B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ',
    e: 'ℯ', g: 'ℊ', o: 'ℴ'
};
const FRAKTUR_HOLES = { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' };
const DS_HOLES = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };
const ITALIC_HOLES = { h: 'ℎ' };

function zalgo(text, intensity) {
    const marks = [];
    for (let c = 0x0300; c <= 0x036F; c++) marks.push(String.fromCharCode(c));
    return Array.from(text).map(ch => {
        if (ch === ' ') return ch;
        let out = ch;
        for (let i = 0; i < intensity; i++) out += marks[Math.floor(Math.random() * marks.length)];
        return out;
    }).join('');
}

const STYLES = {
    /* --- off ------------------------------------------------------------- */
    off:           { group: '',            label: 'Normal (off)',        map: null },

    /* --- serif ----------------------------------------------------------- */
    bold:          { group: 'Serif',       label: 'Bold',                map: ranged(cp('𝐀'), cp('𝐚'), cp('𝟎')) },
    italic:        { group: 'Serif',       label: 'Italic',              map: ranged(cp('𝐴'), cp('𝑎'), 0, ITALIC_HOLES) },
    bolditalic:    { group: 'Serif',       label: 'Bold italic',         map: ranged(cp('𝑨'), cp('𝒂'), 0) },

    /* --- sans-serif ------------------------------------------------------ */
    sans:          { group: 'Sans-serif',  label: 'Sans-serif',          map: ranged(cp('𝖠'), cp('𝖺'), cp('𝟢')) },
    sansbold:      { group: 'Sans-serif',  label: 'Sans bold',           map: ranged(cp('𝗔'), cp('𝗮'), cp('𝟬')) },
    sansitalic:    { group: 'Sans-serif',  label: 'Sans italic',         map: ranged(cp('𝘈'), cp('𝘢'), 0) },
    sansbolditalic:{ group: 'Sans-serif',  label: 'Sans bold italic',    map: ranged(cp('𝘼'), cp('𝙖'), 0) },
    mono:          { group: 'Sans-serif',  label: 'Monospace',           map: ranged(cp('𝙰'), cp('𝚊'), cp('𝟶')) },

    /* --- decorative ------------------------------------------------------ */
    script:        { group: 'Decorative',  label: 'Script',              map: ranged(cp('𝒜'), cp('𝒶'), 0, SCRIPT_HOLES) },
    boldscript:    { group: 'Decorative',  label: 'Bold script',         map: ranged(cp('𝓐'), cp('𝓪'), 0) },
    fraktur:       { group: 'Decorative',  label: 'Fraktur (gothic)',    map: ranged(cp('𝔄'), cp('𝔞'), 0, FRAKTUR_HOLES) },
    boldfraktur:   { group: 'Decorative',  label: 'Bold fraktur',        map: ranged(cp('𝕬'), cp('𝖆'), 0) },
    doublestruck:  { group: 'Decorative',  label: 'Double-struck',       map: ranged(cp('𝔸'), cp('𝕒'), cp('𝟘'), DS_HOLES) },
    fullwidth:     { group: 'Decorative',  label: 'Fullwidth (ａｅｓｔｈｅｔｉｃ)',
                     map: ranged(cp('Ａ'), cp('ａ'), cp('０')), space: '　' },
    smallcaps:     { group: 'Decorative',  label: 'Small caps', revSafe: true,
                     map: table(buildTable(PLAIN_L, 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘꞯʀꜱᴛᴜᴠᴡxʏᴢ')) },
    superscript:   { group: 'Decorative',  label: 'Superscript', revSafe: true,
                     map: table(Object.assign(
                         buildTable(PLAIN_L, 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖ۹ʳˢᵗᵘᵛʷˣʸᶻ'),
                         buildTable(PLAIN_U, 'ᴬᴮᶜᴰᴱᶠᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾQᴿˢᵀᵁⱽᵂˣʸᶻ'),
                         buildTable(DIGITS, '⁰¹²³⁴⁵⁶⁷⁸⁹'),
                         buildTable('+-=()', '⁺⁻⁼⁽⁾'))) },
    subscript:     { group: 'Decorative',  label: 'Subscript (partial)', revSafe: true,
                     map: table(Object.assign(
                         buildTable('aehijklmnoprstuvx', 'ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ'),
                         buildTable(DIGITS, '₀₁₂₃₄₅₆₇₈₉'),
                         buildTable('+-=()', '₊₋₌₍₎'))) },

    /* --- boxed ----------------------------------------------------------- */
    circled:       { group: 'Boxed',       label: 'Circled',             map: ranged(cp('Ⓐ'), cp('ⓐ'), 0), digits: '⓪①②③④⑤⑥⑦⑧⑨' },
    negcircled:    { group: 'Boxed',       label: 'Circled (filled)',    map: ranged(cp('🅐'), cp('🅐'), 0), digits: '⓿❶❷❸❹❺❻❼❽❾' },
    squared:       { group: 'Boxed',       label: 'Squared',             map: ranged(cp('🄰'), cp('🄰'), 0) },
    negsquared:    { group: 'Boxed',       label: 'Squared (filled)',    map: ranged(cp('🅰'), cp('🅰'), 0) },
    parenthesized: { group: 'Boxed',       label: 'Parenthesized',       map: ranged(cp('🄐'), cp('⒜'), 0), digits: '0⑴⑵⑶⑷⑸⑹⑺⑻⑼' },
    regional:      { group: 'Boxed',       label: 'Regional indicator (flag letters)',
                     map: ranged(cp('🇦'), cp('🇦'), 0) },

    /* --- effects --------------------------------------------------------- */
    strike:        { group: 'Effects',     label: 'S̶t̶r̶i̶k̶e̶t̶h̶r̶o̶u̶g̶h̶',      map: overlay('̶') },
    underline:     { group: 'Effects',     label: 'U̲n̲d̲e̲r̲l̲i̲n̲e̲',         map: overlay('̲') },
    slashed:       { group: 'Effects',     label: 'S̸l̸a̸s̸h̸e̸d̸',           map: overlay('̸') },
    spaced:        { group: 'Effects',     label: 's p a c e d   o u t',
                     map: fn((t) => Array.from(t).join(' ')) },
    upsidedown:    { group: 'Effects',     label: 'Upside down',
                     map: { kind: 'table', reverse: true, table: Object.assign(
                         buildTable(PLAIN_L, 'ɐqɔpǝɟƃɥıɾʞlɯuodbɹsʇnʌʍxʎz'),
                         buildTable(PLAIN_U, '∀ᗺƆᗡƎℲƃHIſʞ˥WNOԀΌᴚS⊥∩ΛMX⅄Z'),
                         buildTable(DIGITS, '0ƖᄅƐㄣϛ9ㄥ86'),
                         buildTable('.,?!\'"()[]{}<>&_', '˙\'¿¡,„)(][}{><⅋‾')) } },
    mirrored:      { group: 'Effects',     label: 'Mirrored',
                     map: { kind: 'table', reverse: true, table: Object.assign(
                         buildTable(PLAIN_L, 'ɒdɔbɘʇϱʜiꞁʞlmnoqpɿƨƚuvwxyz'),
                         buildTable(PLAIN_U, 'AꓭƆꓷƎꓞGHIႱꓘ⅃MИOꟼϘЯꙄTUVWXYZ'),
                         buildTable('()[]{}<>', ')(][}{><')) } },
    zalgo:         { group: 'Effects',     label: 'Zalgo (cursed)',      map: fn((t) => zalgo(t, 3)) },

    /* --- text tricks ----------------------------------------------------- */
    faux:          { group: 'Text tricks', label: 'Faux Cyrillic',
                     map: table(Object.assign(
                         buildTable(PLAIN_U, 'ДБСDЄFGHЇЈЌLМИФРQЯЅТЦVШЖЧZ'),
                         buildTable(PLAIN_L, 'дъсdеfgнїјкlмиФрqяѕтцvшжчz'))) },
    leet:          { group: 'Text tricks', label: 'Leetspeak',
                     map: table(Object.assign(
                         buildTable('abegilostz', '4836110572'),
                         buildTable('ABEGILOSTZ', '4836110572'))) },
    alternating:   { group: 'Text tricks', label: 'aLtErNaTiNg CaSe',
                     map: fn((t) => { let i = 0; return Array.from(t).map(c => {
                         if (!/[a-z]/i.test(c)) return c;
                         return (i++ % 2) ? c.toUpperCase() : c.toLowerCase();
                     }).join(''); }) },
    upper:         { group: 'Text tricks', label: 'UPPERCASE',           map: fn((t) => t.toUpperCase()) },
    lower:         { group: 'Text tricks', label: 'lowercase',           map: fn((t) => t.toLowerCase()) }
};

function styleChar(ch, s) {
    const m = s.map;
    if (m.holes && m.holes[ch]) return m.holes[ch];
    if (ch >= 'A' && ch <= 'Z') return String.fromCodePoint(m.u + (ch.charCodeAt(0) - 65));
    if (ch >= 'a' && ch <= 'z') return String.fromCodePoint(m.l + (ch.charCodeAt(0) - 97));
    if (ch >= '0' && ch <= '9') {
        if (s.digits) return Array.from(s.digits)[ch.charCodeAt(0) - 48];
        if (m.d) return String.fromCodePoint(m.d + (ch.charCodeAt(0) - 48));
        return ch;
    }
    if (ch === ' ' && s.space) return s.space;
    return ch;
}

function applyStyle(text, style) {
    const s = STYLES[style];
    if (!s || !s.map) return text;
    const m = s.map;

    if (m.kind === 'fn') return m.fn(text);

    let out;
    if (m.kind === 'table') out = Array.from(text).map(c => m.table[c] || c).join('');
    else out = Array.from(text).map(c => styleChar(c, s)).join('');

    if (m.reverse) out = Array.from(out).reverse().join('');
    return out;
}

/* ------------------------------------------------------------ inline markup */

// Longest markers first -- '__' must win over '_'.
const MARKUP = [
    { mark: '__', style: 'underline' },
    { mark: '*',  style: 'bold' },
    { mark: '_',  style: 'italic' },
    { mark: '~',  style: 'strike' },
    { mark: '`',  style: 'mono' }
];

// A marker only opens at a word start and only closes at a word end.
const OPEN_BEFORE = /[\s([{"'<>-]/;
const CLOSE_AFTER = /[\s)\]}"'.,!?:;<>-]/;

function findClose(text, from, mark) {
    for (let i = from; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }       // escaped char, skip both
        if (text.startsWith(mark, i)) return i;
    }
    return -1;
}

function stripEscapes(text) {
    return text.replace(/\\(.)/g, '$1');
}

// -> [{ text, style|null }]  (null = use the global style)
function tokenizeMarkup(text) {
    const segs = [];
    const push = (t, style) => { if (t) segs.push({ text: t, style }); };
    let buf = '', i = 0;

    while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) { buf += text[i + 1]; i += 2; continue; }

        const mk = MARKUP.find(m => text.startsWith(m.mark, i));
        if (mk && OPEN_BEFORE.test(text[i - 1] || ' ')) {
            const open = i + mk.mark.length;
            const close = findClose(text, open, mk.mark);
            // non-empty, properly closed, and the closing marker ends a word --
            // so snake_case_names and 2*3 stay literal
            if (close > open && CLOSE_AFTER.test(text[close + mk.mark.length] || ' ')) {
                push(buf, null); buf = '';
                push(stripEscapes(text.slice(open, close)), mk.style);
                i = close + mk.mark.length;
                continue;
            }
        }
        buf += text[i];
        i++;
    }
    push(buf, null);
    return segs;
}

/* ------------------------------------------------------------- decorations */

const DECORATIONS = {
    none:     { label: 'None',              pre: '',        post: '' },
    sparkle:  { label: '✧ text ✧',          pre: '✧ ',      post: ' ✧' },
    kaomoji:  { label: '｡･:*˙ text ˙*:･｡',  pre: '｡･:*˙ ',  post: ' ˙*:･｡' },
    bars:     { label: '▐ text ▌',          pre: '▐ ',      post: ' ▌' },
    brackets: { label: '【 text 】',         pre: '【',       post: '】' },
    stars:    { label: '★ text ★',          pre: '★ ',      post: ' ★' },
    arrow:    { label: '➤ text',            pre: '➤ ',      post: '' }
};

function decorate(text) {
    const d = DECORATIONS[config.decoration];
    if (!d || (!d.pre && !d.post)) return text;
    return d.pre + text + d.post;
}

/* ---------------------------------------------------------------- outgoing */

/* ---------------------------------------------------------------- mentions */

// A styled name is a different string, so the other client never matches it and
// the ping never fires. Names therefore have to travel as plain ASCII.
let nameCache = { at: 0, set: null };

function knownNames() {
    if (nameCache.set && Date.now() - nameCache.at < 5000) return nameCache.set;

    const names = new Set();
    const users = fc ? fc.app.users() : null;
    if (users) for (const n of Object.keys(users)) names.add(n.toLowerCase());
    // fallback / top-up straight from the sidebar
    document.querySelectorAll('.usersListWrapper .playerName').forEach(el => {
        const n = el.textContent.trim();
        if (n) names.add(n.toLowerCase());
    });

    nameCache = { at: Date.now(), set: names };
    return names;
}

// "@Ryu99" -> yes. "Ryu99!" -> yes if Ryu99 is in the channel. "gg" -> no.
function isMention(token) {
    if (!token) return false;
    if (token.startsWith('@')) return true;
    const core = token.replace(/^[^\w-]+|[^\w-]+$/g, '').toLowerCase();
    return core.length > 1 && knownNames().has(core);
}

// Emoji runs (incl. skin tones, ZWJ sequences and flags) pass through untouched:
// overlay/zalgo marks would pile onto them and reversing styles split sequences.
// emoji.js converts :shortcodes: before this runs, so this covers its output too.
const EMOJI_RUN = /((?:[\u{1F1E6}-\u{1F1FF}]{2}|\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*(?:‍\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*)*)+)/u;

function styleNonEmoji(text, style) {
    return text.split(EMOJI_RUN)
        .map((part, i) => (i % 2 ? part : part && applyStyle(part, style)))
        .join('');
}

function styleSegment(text, style) {
    if (!style || style === 'off') return text;
    if (config && config.plainMentions === false) return styleNonEmoji(text, style);

    return text.split(/(\s+)/)
        .map(tok => isMention(tok) ? tok : styleNonEmoji(tok, style))
        .join('');
}

// Keep Fightcade features working: slash commands are never touched.
function styleMessage(text, style) {
    if (!text) return text;
    if (text.startsWith('/')) return text;            // never mangle FC commands

    const segs = !config || config.inlineMarkup ? tokenizeMarkup(text) : [{ text, style: null }];
    const out = segs.map(s => styleSegment(s.text, s.style || style)).join('');
    return decorate(out);
}

/* --------------------------------------------------------- incoming (A5) */

let reverseMap = null;

function buildReverseMap() {
    const r = {};
    for (const s of Object.values(STYLES)) {
        if (!s.map || s.map.kind === 'fn') continue;
        for (const ch of PLAIN_U + PLAIN_L + DIGITS) {
            const styled = s.map.kind === 'table' ? s.map.table[ch] : styleChar(ch, s);
            if (!styled || styled === ch || r[styled]) continue;
            // Only reverse glyphs that no language actually writes with. Below
            // U+0500 lives ASCII, Latin-1/Extended and Cyrillic -- mapping those
            // back would mangle upside-down/leet/faux-Cyrillic look-alikes that
            // are themselves ordinary letters, and would latinise real Russian.
            // (revSafe styles opt out: their glyphs are IPA letters nobody types.)
            if (!s.revSafe && styled.codePointAt(0) < 0x0500) continue;
            r[styled] = ch;
        }
    }
    return r;
}

function unstyle(text) {
    if (!reverseMap) reverseMap = buildReverseMap();
    return Array.from(text).map(c => reverseMap[c] || c).join('')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');   // combining marks / zalgo
}

/* --------------------------------------------------------------- chat hook */

const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

function setInputValue(el, value) {
    nativeValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function isChatInput(el) {
    return el && el.tagName === 'INPUT' && el.closest && el.closest('.chatInput');
}

function toast(msg) {
    const lines = String(msg).split('\n').filter(Boolean);
    fc.ui.toast(lines[0], { icon: 'edit', sub: lines.slice(1).join(' · '), ms: 5000 });
}

function styleList() {
    const groups = {};
    for (const [k, v] of Object.entries(STYLES)) {
        if (k === 'off') continue;
        (groups[v.group] = groups[v.group] || []).push(k);
    }
    return Object.entries(groups).map(([g, keys]) => g + ': ' + keys.join(', ')).join('\n');
}

function handleFontCommand(arg) {
    const key = (arg || '').trim().toLowerCase();
    if (!key) {
        toast('Chat font: ' + config.style + '   (/font <name>, /font off)\n' + styleList());
        return;
    }
    const target = (key === 'off' || key === 'none' || key === 'normal') ? 'off' : key;
    if (!STYLES[target]) { toast('Unknown style "' + key + '"\n' + styleList()); return; }
    setStyle(target);
}

function setStyle(key, why) {
    if (!STYLES[key]) return;
    if (config.style !== 'off') config.lastStyle = config.style;
    config.style = key;
    saveConfig();
    toast((why || 'Chat font') + ' → ' + STYLES[key].label + '\n' + applyStyle('Preview 123', key));
}

function cycleFavorite() {
    const favs = (config.favorites || []).filter(k => STYLES[k]);
    if (!favs.length) { toast('No favourites set — star some styles in the picker'); return; }
    const next = favs[(favs.indexOf(config.style) + 1) % favs.length];
    setStyle(next, 'Favourite');
}

function toggleStyle() {
    if (config.style === 'off') setStyle(config.lastStyle || 'bold', 'Chat font');
    else {
        config.lastStyle = config.style;
        config.style = 'off';
        saveConfig();
        toast('Chat font → off');
    }
}

function handleMacCommand(arg) {
    const parts = (arg || '').trim().split(/\s+/);
    const slot = (parts.shift() || '').toUpperCase();
    const text = parts.join(' ');

    if (!slot) {
        const list = Object.entries(config.macros).map(([k, v]) => k + ' = ' + v).join('\n');
        toast('Macros (F1-F8, Ctrl+Fn sends):\n' + (list || 'none set') + '\nUse /mac F1 gg wp');
        return;
    }
    if (!/^F[1-8]$/.test(slot)) { toast('Macro slots are F1..F8'); return; }
    if (!text) { delete config.macros[slot]; saveConfig(); toast(slot + ' cleared'); return; }
    config.macros[slot] = text;
    saveConfig();
    toast(slot + ' = ' + text);
}

function onKeyDown(e) {
    // --- global hotkeys (work anywhere) ---
    if (e.ctrlKey && e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'f') { e.preventDefault(); cycleFavorite(); return; }
        if (k === 'x') { e.preventDefault(); toggleStyle(); return; }
    }

    const el = e.target;
    if (!isChatInput(el)) return;

    // --- macros: F1..F8 in the chat box ---
    if (/^F[1-8]$/.test(e.key)) {
        const macro = config.macros[e.key];
        if (!macro) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        setInputValue(el, macro);
        if (e.ctrlKey) {
            el.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
            }));
        }
        return;
    }

    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;

    const raw = el.value;
    if (!raw) return;

    const styled = styleMessage(raw, config.style);
    if (styled !== raw) setInputValue(el, styled);
    // event continues -> Fightcade sends the (now styled) value
}

/* ----------------------------------------------------- quick picker (A2) */

function closePicker() {
    const p = document.getElementById('fontStylePicker');
    if (p) p.remove();
}

function openPicker(anchor) {
    if (document.getElementById('fontStylePicker')) { closePicker(); return; }

    const input = anchor.closest('.chatInput')?.querySelector('input.input');
    const sample = (input && input.value.trim()) || 'Good game 123';

    const box = document.createElement('div');
    box.id = 'fontStylePicker';
    const rect = anchor.getBoundingClientRect();
    box.style.cssText = 'position:fixed;z-index:100000;width:280px;max-height:60vh;overflow-y:auto;' +
        'background:var(--mainColor-darker,#14161a);border:1px solid var(--mainColor-light,rgba(255,255,255,.25));' +
        'border-radius:6px;padding:4px;font-size:13px;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.5);' +
        'left:' + Math.max(8, rect.right - 280) + 'px;bottom:' + (window.innerHeight - rect.top + 8) + 'px;';

    const rows = Object.entries(STYLES).map(([k, v]) => {
        const fav = (config.favorites || []).includes(k);
        const cur = k === config.style;
        return `<div class="fsRow" data-key="${k}" style="display:flex;align-items:center;padding:5px 6px;
                border-radius:4px;cursor:pointer;${cur ? 'background:var(--accentColor,rgba(100,149,237,.35));' : ''}">
                <span class="fsStar" data-key="${k}" title="favourite (Ctrl+Shift+F cycles)"
                    style="flex:none;width:16px;margin-right:6px;text-align:center;opacity:${fav ? 1 : .3};">★</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                    >${k === 'off' ? 'Normal (off)' : applyStyle(sample, k)}</span>
                <span style="flex:none;margin-left:6px;font-size:10px;opacity:.45;">${k}</span>
            </div>`;
    }).join('');
    box.innerHTML = rows;

    box.addEventListener('click', (e) => {
        e.stopPropagation();
        const star = e.target.closest('.fsStar');
        if (star) {
            const k = star.dataset.key;
            const favs = config.favorites || (config.favorites = []);
            const i = favs.indexOf(k);
            if (i >= 0) favs.splice(i, 1); else favs.push(k);
            saveConfig();
            star.style.opacity = favs.includes(k) ? 1 : .3;
            return;
        }
        const row = e.target.closest('.fsRow');
        if (!row) return;
        setStyle(row.dataset.key);
        closePicker();
        input?.focus();
    });

    document.body.appendChild(box);
    setTimeout(() => {
        document.addEventListener('click', closePicker, { once: true });
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePicker(); }, { once: true });
    }, 0);
}

function ensureChatButton() {
    document.querySelectorAll('.chatInput').forEach(wrap => {
        if (wrap.querySelector('.fontStyleBtn')) return;
        if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

        const btn = document.createElement('div');
        btn.className = 'fontStyleBtn';
        btn.textContent = 'Aa';
        btn.title = 'Chat font style (Ctrl+Shift+F cycles, Ctrl+Shift+X toggles)';
        btn.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:50;' +
            'cursor:pointer;font-size:12px;font-weight:bold;line-height:1;padding:4px 6px;border-radius:4px;' +
            'background:rgba(0,0,0,.35);border:1px solid var(--mainColor-light,rgba(255,255,255,.25));' +
            'color:#fff;opacity:.75;user-select:none;';
        btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
        btn.addEventListener('mouseleave', () => btn.style.opacity = '.75');
        btn.addEventListener('click', (e) => { e.stopPropagation(); openPicker(btn); });
        wrap.appendChild(btn);
    });
}

/* ------------------------------------------------- readable chat (A5) */

function plainifyElement(el) {
    if (el.dataset.fcfontPlain === el.textContent) return;   // already ours

    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);

    const original = el.textContent;
    let changed = false;
    for (const n of nodes) {
        const plain = unstyle(n.nodeValue);
        if (plain !== n.nodeValue) { n.nodeValue = plain; changed = true; }
    }
    if (changed) el.title = original;
    el.dataset.fcfontPlain = el.textContent;
}

function scanReadable(root) {
    if (!config.readableChat) return;
    (root || document).querySelectorAll('.chatContent .blocksContainer .blocks .regular')
        .forEach(plainifyElement);
}

/* ---------------------------------------------------------------- settings */

function buildOptions() {
    const groups = {};
    for (const [k, v] of Object.entries(STYLES)) {
        if (k === 'off') continue;
        (groups[v.group] = groups[v.group] || []).push([k, v]);
    }
    const opt = ([k, v]) => `<option value="${k}"${k === config.style ? ' selected' : ''}>${v.label}</option>`;
    return opt(['off', STYLES.off]) +
        Object.entries(groups).map(([g, items]) => `<optgroup label="${g}">${items.map(opt).join('')}</optgroup>`).join('');
}

function renderBlock(el) {
    const E = fc.fmt.esc;
    const sw = (key, label, hint) => `<label class="fc-field"><span class="fc-field-text"><b>${label}</b><small>${E(hint)}</small></span>` +
        `<input type="checkbox" class="fc-switch-in" data-opt="${key}"${config[key] ? ' checked' : ''}><i class="fc-switch"></i></label>`;
    el.innerHTML = `<div class="fc-set-title">Chat font style <small>— everyone sees it</small></div>
        <div class="fc-field"><span class="fc-field-text"><b>Style</b><small class="fsPreview"></small></span><select class="fc-select fsSelect">${buildOptions()}</select></div>
        <div class="fc-field"><span class="fc-field-text"><b>Decoration</b></span><select class="fc-select fsDeco">${Object.entries(DECORATIONS).map(([k, v]) =>
            `<option value="${k}"${k === config.decoration ? ' selected' : ''}>${E(v.label)}</option>`).join('')}</select></div>
        ${sw('inlineMarkup', 'Inline markup', '*bold* _italic_ ~strike~ `mono` __underline__')}
        ${sw('plainMentions', 'Plain @mentions', 'Never style player names, so pings still reach them')}
        ${sw('readableChat', 'Readable chat', 'Un-style other people’s text (hover shows the original)')}
        <div class="fc-note">Aa button by the chat box · Ctrl+Shift+F cycles favourites · Ctrl+Shift+X toggles · /font and /mac in chat</div>`;
    const pv = el.querySelector('.fsPreview');
    if (pv) pv.textContent = decorate(applyStyle('Good game! gg 123', config.style));
}

function wireBlock(el) {
    renderBlock(el);
    el.addEventListener('change', (e) => {
        const t = e.target;
        if (t.classList.contains('fsSelect')) { if (config.style !== 'off') config.lastStyle = config.style; config.style = t.value; }
        else if (t.classList.contains('fsDeco')) config.decoration = t.value;
        else if (t.dataset.opt) { config[t.dataset.opt] = t.checked; if (t.dataset.opt === 'readableChat' && t.checked) scanReadable(); }
        else return;
        saveConfig();
    });
}

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('fontstyle', DEFAULTS, {
        // the old inverted flag
        version: 2,
        migrate: (d) => {
            if (d.plainMentions === undefined && d.styleUsernameMentions !== undefined) d.plainMentions = !d.styleUsernameMentions;
            delete d.styleUsernameMentions;
            return d;
        }
    });
    config = store.data;
    if (!config.macros || typeof config.macros !== 'object') config.macros = {};
    window.__fcFontStyleLoaded = true;
    // capture phase: run before Fightcade's own Enter handler reads the model
    document.addEventListener('keydown', onKeyDown, true);
    fc.own(() => {
        document.removeEventListener('keydown', onKeyDown, true);
        closePicker();
        document.querySelectorAll('.fontStyleBtn').forEach(b => b.remove());
        window.__fcFontStyleLoaded = false;
    });
    fc.watch(() => { ensureChatButton(); scanReadable(); }, { selector: '.chatInput' });
    fc.cmd('font', 'Chat font style: list / pick / off', handleFontCommand, { args: '<style>|off' });
    fc.cmd('mac', 'Chat macros on F1-F8', handleMacCommand, { args: 'F1 <text>' });
    fc.settings.block({ id: 'fontstyle', section: 'chat', order: 40, render: wireBlock, refresh: renderBlock });
    ensureChatButton();
    fc.log('ready - style:', config.style);
    return api;
}

const api = {
    applyStyle: (t, s) => applyStyle(t, s),
    styleMessage: (t, s) => styleMessage(t, s),
    unstyle: (t) => unstyle(t),
    STYLES,
    get _config() { return config; },
    _setFcade: () => { nameCache = { at: 0, set: null }; }
};

module.exports = { id: 'fontstyle', name: 'Chat font styles', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
