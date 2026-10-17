#!/usr/bin/env node
// node tools/rank-icons.js   rebuilds the ICONS line in rank-icons.js from assets/ranks/rank<n>@128.webp
// (0 = unknown, 1-6 = E D C B A S). The icons ship inside the .js because the updater only ships .js files.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'ranks');
const FILE = path.join(ROOT, 'rank-icons.js');

const icons = {};
for (let n = 0; n <= 6; n++) {
    const f = path.join(DIR, 'rank' + n + '@128.webp');
    if (!fs.existsSync(f)) throw new Error('missing ' + path.relative(ROOT, f));
    icons[n] = fs.readFileSync(f).toString('base64');
}
let src = fs.readFileSync(FILE, 'utf8');
const crlf = /\r\n/.test(src);
src = src.replace(/\r\n/g, '\n');
const re = /(\/\/ ICONS-START[^\n]*\n)[\s\S]*?(\n\/\/ ICONS-END)/;
if (!re.test(src)) throw new Error('no ICONS-START / ICONS-END markers in rank-icons.js');
src = src.replace(re, (m, a, b) => a + 'const ICONS = ' + JSON.stringify(icons) + ';' + b);
fs.writeFileSync(FILE, crlf ? src.replace(/\n/g, '\r\n') : src);
console.log('rank-icons.js: 7 icons, ' + Math.round(fs.statSync(FILE).size / 1024) + ' KB');
