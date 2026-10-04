#!/usr/bin/env node
/**
 * Keeps the translations complete.
 *
 *   node tools/i18n-check.js              missing / unused keys and broken {placeholders} per language
 *   node tools/i18n-check.js --keys       every key, one per line (JSON strings)
 *   node tools/i18n-check.js --missing pt the keys pt still lacks, as a JSON object to fill in
 *   node tools/i18n-check.js --left x.js  English that x.js still shows without going through fc.t
 *
 * A key is the English text itself. It's found in:
 *   fc.t('…') / T('…') / tr('…') / N_('…'), and both forms of .plural(n, '…', '…')
 *   what the core's builders translate on their own: ui.btn / ui.chip / ui.toast('…'),
 *   fc.cmd(name, '…'), fc.settings.section(id, '…') and block / field properties
 *   (label, hint, title, sub, button, text, action, ok, cancel), options: [[value, '…'], …]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LANGS = ['pt', 'es'];
const args = process.argv.slice(2);

const STR = String.raw`('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|` + '`(?:\\\\.|[^`\\\\$])*`' + ')';
const unq = (lit) => { try { return Function('return ' + lit)(); } catch (e) { return null; } };

function sources() {
    return fs.readdirSync(ROOT).filter(f => f.endsWith('.js') && !/^i18n-/.test(f)).map(f => path.join(ROOT, f));
}

// the CSS blocks hold no text to translate (and lots of quotes)
const stripCss = (code) => code.replace(/const CSS\w* = `[\s\S]*?`;/g, '');

// T(…) / tr(…) / fc.t(…) / N_(…): every string in the first argument, so
// T(on ? 'Friend' : 'Add friend') and T({ a: 'Away', on: 'Online' }[k]) count too
function firstArgLiterals(c, from) {
    let depth = 0, i = from, q = null;
    const start = from;
    for (; i < c.length; i++) {
        const ch = c[i];
        if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
        if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') { if (!depth) break; depth--; }
        else if (ch === ',' && !depth) break;
    }
    const arg = c.slice(start, i);
    if (/^\s*\{/.test(arg) && !/\}\s*\[/.test(arg)) return [];            // a vars object, not text
    return (arg.match(new RegExp(STR, 'g')) || []);
}

const PATTERNS = [
    /(?:\bT|\bET|\btr|\bfc\.t|\bN_)\(/g,
    new RegExp(String.raw`\.plural\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*` + STR + String.raw`\s*,\s*` + STR, 'g'),
    new RegExp(String.raw`\bui\.(?:btn|chip|toast)\(\s*` + STR, 'g'),
    new RegExp(String.raw`\bfc\.cmd\(\s*` + STR + String.raw`\s*,\s*` + STR, 'g'),
    new RegExp(String.raw`\bsettings\.section\(\s*` + STR + String.raw`\s*,\s*` + STR, 'g'),
    new RegExp(String.raw`\b(?:label|hint|title|sub|button|text|action|ok|cancel|desc)\s*:\s*` + STR, 'g'),
    // settings switches made by a module's own opt(key, 'label', 'hint', …) helper
    new RegExp(String.raw`\b(?:opt|sw|sel)\(\s*` + STR + String.raw`\s*,\s*` + STR + String.raw`(?:\s*,\s*` + STR + ')?', 'g')
];

function keysOf(code, file) {
    const out = new Map();
    const add = (lit, at) => {
        const k = unq(lit);
        if (!k || !/[A-Za-z]{2}/.test(k) || /^[\w-]+\.(js|json|png|mp3)$/.test(k)) return;
        // not text: colours, html fragments, pieces of a bigger string, setting values
        if (/^#[0-9a-f]{3,8}$/i.test(k) || /^</.test(k) || /^\s|\s$/.test(k) || /^(all|on|off)$/.test(k)) return;
        out.set(k, (out.get(k) || []).concat(file + ':' + at));
    };
    const c = stripCss(code);
    PATTERNS.forEach((re, i) => {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(c))) {
            const line = c.slice(0, m.index).split('\n').length;
            if (i === 0) { firstArgLiterals(c, re.lastIndex).forEach(l => add(l, line)); continue; }
            if (i === 3) { add(m[2], line); continue; }           // fc.cmd: the description, not the name
            if (i === 4) { add(m[2], line); continue; }           // settings.section: the label
            if (i === 6) { add(m[2], line); if (m[3]) add(m[3], line); continue; }   // opt: label + hint, not the key
            add(m[1], line);
            if (i === 1) add(m[2], line);
        }
    });
    // ui.tile(value, 'caption'): skip the first argument (it often has commas of its own)
    const tileRe = /\bui\.tile\(/g;
    let tm;
    while ((tm = tileRe.exec(c))) {
        let depth = 0, i = tileRe.lastIndex, q = null;
        for (; i < c.length; i++) {
            const ch = c[i];
            if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
            if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
            if ('([{'.includes(ch)) depth++;
            else if (')]}'.includes(ch)) { if (!depth) break; depth--; }
            else if (ch === ',' && !depth) break;
        }
        const lit = c.slice(i + 1).match(new RegExp('^\\s*' + STR));
        if (lit) add(lit[1], c.slice(0, tm.index).split('\n').length);
    }
    // options: [[value, 'label'], ...]
    const optRe = /\boptions\s*:\s*\[/g;
    let m;
    while ((m = optRe.exec(c))) {
        let depth = 1, i = optRe.lastIndex;
        while (i < c.length && depth) { if (c[i] === '[') depth++; else if (c[i] === ']') depth--; i++; }
        const body = c.slice(optRe.lastIndex, i);
        const pair = new RegExp(String.raw`\[\s*[^,\[\]]+,\s*` + STR + String.raw`\s*\]`, 'g');
        let p;
        while ((p = pair.exec(body))) add(p[1], c.slice(0, m.index).split('\n').length);
    }
    return out;
}

function allKeys() {
    const keys = new Map();
    sources().forEach(f => {
        keysOf(fs.readFileSync(f, 'utf8'), path.basename(f)).forEach((at, k) => keys.set(k, (keys.get(k) || []).concat(at)));
    });
    return keys;
}

function dict(lang) {
    const f = path.join(ROOT, 'i18n-' + lang + '.js');
    if (!fs.existsSync(f)) return {};
    delete require.cache[require.resolve(f)];
    const m = require(f);
    return m.strings || m;
}

const holders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

function report() {
    const keys = allKeys();
    const out = { keys: keys.size, langs: {} };
    LANGS.forEach(l => {
        const d = dict(l);
        const missing = [...keys.keys()].filter(k => !(k in d));
        const unused = Object.keys(d).filter(k => !keys.has(k));
        const broken = Object.keys(d).filter(k => keys.has(k) && holders(k) !== holders(d[k]));
        out.langs[l] = { missing, unused, broken };
    });
    return out;
}

// English text still shown directly (string literals with words, outside keys, CSS, logs and selectors)
function leftovers(file) {
    const code = stripCss(fs.readFileSync(file, 'utf8'));
    const keys = keysOf(code, path.basename(file));
    const lines = code.split('\n');
    const out = [];
    const lit = new RegExp(STR, 'g');
    lines.forEach((ln, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(ln) || /\b(LOG|fc\.log|console)\b/.test(ln) || /querySelector|classList|getAttribute|setAttribute|require\(|addEventListener/.test(ln)) return;
        let m;
        lit.lastIndex = 0;
        while ((m = lit.exec(ln))) {
            const v = unq(m[1]);
            if (!v || keys.has(v)) continue;
            if (!/[A-Za-z]{3,}/.test(v) || !/(^[A-Z][a-z]|\s[a-z]{2,}\s|[a-z]{3,} [a-z]{3,})/.test(v.replace(/<[^>]+>/g, ' '))) continue;
            if (/^[.#\[:]|=>|^\w+:\/\/|\.(png|js|json)$/.test(v)) continue;
            out.push((i + 1) + ': ' + v.slice(0, 110));
        }
        // text between tags inside template / html strings: >Some words<
        const re = />([^<>{}$`'"]*[A-Za-z]{3,}[^<>{}$`'"]*)</g;
        while ((m = re.exec(ln))) { const v = m[1].trim(); if (v && /[a-z]{2,} ?/.test(v) && !keys.has(v)) out.push((i + 1) + ': >' + v.slice(0, 110) + '<'); }
    });
    return out;
}

if (require.main === module) {
    if (args[0] === '--keys') { allKeys().forEach((at, k) => console.log(JSON.stringify(k))); process.exit(0); }
    if (args[0] === '--missing') {
        const r = report();
        const o = {};
        (r.langs[args[1] || 'pt'].missing).forEach(k => { o[k] = ''; });
        console.log(JSON.stringify(o, null, 1));
        process.exit(0);
    }
    if (args[0] === '--left') { args.slice(1).forEach(f => { const l = leftovers(path.resolve(f)); console.log('== ' + f + ' (' + l.length + ')'); l.forEach(x => console.log('  ' + x)); }); process.exit(0); }
    const r = report();
    console.log(r.keys + ' keys');
    let bad = 0;
    LANGS.forEach(l => {
        const x = r.langs[l];
        console.log(`${l}: ${x.missing.length} missing, ${x.unused.length} unused, ${x.broken.length} with broken {placeholders}`);
        x.broken.forEach(k => console.log('   broken: ' + JSON.stringify(k)));
        bad += x.missing.length + x.broken.length;
    });
    process.exit(bad ? 1 : 0);
}

module.exports = { allKeys, report, leftovers, keysOf, dict };
