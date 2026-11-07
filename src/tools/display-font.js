#!/usr/bin/env node
// node tools/display-font.js   rebuilds the FONT line in display-font.js from assets/fonts/anton.woff2
// (the font ships inside the .js because the updater only ships .js files)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'fonts', 'anton.woff2');
const FILE = path.join(ROOT, 'display-font.js');

const b64 = fs.readFileSync(SRC).toString('base64');
let src = fs.readFileSync(FILE, 'utf8');
const crlf = /\r\n/.test(src);
src = src.replace(/\r\n/g, '\n');
const re = /(\/\/ FONT-START[^\n]*\n)[\s\S]*?(\n\/\/ FONT-END)/;
if (!re.test(src)) throw new Error('no FONT-START / FONT-END markers in display-font.js');
src = src.replace(re, (m, a, b) => a + "const FONT = '" + b64 + "';" + b);
fs.writeFileSync(FILE, crlf ? src.replace(/\n/g, '\r\n') : src);
console.log('display-font.js: ' + Math.round(fs.statSync(FILE).size / 1024) + ' KB');
