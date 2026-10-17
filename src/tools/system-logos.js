#!/usr/bin/env node
// node tools/system-logos.js   rebuilds the LOGOS line in system-logos.js from assets/systems/<key>.png
// (the logos ship inside the .js because the updater only ships .js files; a missing PNG is just skipped)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'systems');
const FILE = path.join(ROOT, 'system-logos.js');
const { KEYS } = require(FILE);

const logos = {};
for (const key of new Set(Object.values(KEYS))) {
    const f = path.join(DIR, key + '.png');
    if (fs.existsSync(f)) logos[key] = fs.readFileSync(f).toString('base64');
}
let src = fs.readFileSync(FILE, 'utf8');
const crlf = /\r\n/.test(src);
src = src.replace(/\r\n/g, '\n');
const re = /(\/\/ LOGOS-START[^\n]*\n)[\s\S]*?(\n\/\/ LOGOS-END)/;
if (!re.test(src)) throw new Error('no LOGOS-START / LOGOS-END markers in system-logos.js');
src = src.replace(re, (m, a, b) => a + 'const LOGOS = ' + JSON.stringify(logos) + ';' + b);
fs.writeFileSync(FILE, crlf ? src.replace(/\n/g, '\r\n') : src);
console.log('system-logos.js: ' + Object.keys(logos).length + ' logos (' + Object.keys(logos).join(', ') + '), ' + Math.round(fs.statSync(FILE).size / 1024) + ' KB');
