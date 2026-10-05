// node --test tests/      the in-app updater (updater.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const up = require('../updater.js');

const DIR = path.join(os.tmpdir(), 'fc-upd-test', 'inject', 'fightcord');

test('versions: newer only when it really is', () => {
    assert.equal(up.newer('2.4.0', '2.3.1'), true);
    assert.equal(up.newer('2.3.10', '2.3.9'), true);
    assert.equal(up.newer('2.3.1', '2.3.1'), false);
    assert.equal(up.newer('2.3.0', '2.3.1'), false);
    assert.equal(up.newer('', '2.3.1'), false);
});

test('what an update may write: modules, the loader, the Discord-status library; nothing else', () => {
    const t = (n) => up.targetFor(n, DIR);
    assert.equal(t('fightcord/scout.js'), path.join(DIR, 'scout.js'));
    assert.equal(t('inject.js'), path.join(DIR, '..', 'inject.js'));
    assert.equal(t('fightcord/node_modules/ws/lib/websocket.js'), path.join(DIR, 'node_modules', 'ws', 'lib', 'websocket.js'));
    assert.equal(t('fightcord/node_modules/ws/package.json'), path.join(DIR, 'node_modules', 'ws', 'package.json'));
    assert.equal(t('fightcord/node_modules/discord-rpc/LICENSE'), path.join(DIR, 'node_modules', 'discord-rpc', 'LICENSE'));
    // never settings, history, binaries, or a way out of the folder
    assert.equal(t('fightcord/scout-config.json'), null);
    assert.equal(t('fightcord/match-history.json'), null);
    assert.equal(t('fightcord/sub/evil.js'), null);
    assert.equal(t('fightcord/node_modules/x/../../../evil.js'), null);
    assert.equal(t('fightcord/node_modules/x/addon.node'), null);
    assert.equal(t('fightcord/node_modules/x/run.exe'), null);
    assert.equal(t('../inject.js'), null);
    assert.equal(t('files.json'), null);
});

test('a module dropped from Fightcord is removed, nothing else', () => {
    assert.deepEqual(up.staleModules(['a.js', 'b.js', 'old.js', 'updater.js'], ['a.js', 'b.js']), ['old.js']);
    assert.deepEqual(up.staleModules(undefined, ['a.js']), [], 'no list from before: remove nothing');
    assert.deepEqual(up.staleModules(['a.js'], []), [], 'an empty new list never empties the folder');
    assert.deepEqual(up.staleModules(['fightcord-core.js', 'fightcord.js', 'my-plugin.js'], ['x.js']), ['my-plugin.js']);
});

// a stored + a deflated entry
function zip(entries) {
    const parts = [], dir = [];
    let off = 0;
    Object.keys(entries).forEach((name, i) => {
        const raw = Buffer.from(entries[name]);
        const deflate = i % 2 === 1;
        const data = deflate ? zlib.deflateRawSync(raw) : raw;
        const nm = Buffer.from(name);
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8);
        lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10);
        ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
        parts.push(lh, nm, data);
        dir.push(ch, nm);
        off += 30 + nm.length + data.length;
    });
    const cd = Buffer.concat(dir);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat(parts.concat([cd, end]));
}

test('zip reader: stored and deflated entries', () => {
    const files = up.unzip(zip({ 'fightcord/a.js': 'A', 'fightcord/b.js': 'B'.repeat(500) }));
    assert.equal(files['fightcord/a.js'].toString(), 'A');
    assert.equal(files['fightcord/b.js'].toString(), 'B'.repeat(500));
});

test('install: modules + library in place, settings untouched, dropped module gone, version recorded', () => {
    fs.rmSync(path.join(os.tmpdir(), 'fc-upd-test'), { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'fightcord.json'), JSON.stringify({ version: '2.3.1', off: ['snapshot.js'], files: ['scout.js', 'old.js'] }));
    fs.writeFileSync(path.join(DIR, 'scout-config.json'), '{"mine":true}');
    fs.writeFileSync(path.join(DIR, 'old.js'), 'old');
    fs.writeFileSync(path.join(DIR, 'my-plugin.js'), 'mine');
    const files = up.unzip(zip({
        'fightcord/scout.js': 'new scout',
        'fightcord/node_modules/ws/index.js': 'ws',
        'fightcord/scout-config.json': '{"mine":false}',
        'inject.js': '/* Fightcord loader */ new',
        'files.json': JSON.stringify({ version: '2.4.0', modules: ['scout.js'] })
    }));
    const r = up.apply(DIR, files, '2.4.0');
    assert.equal(fs.readFileSync(path.join(DIR, 'scout.js'), 'utf8'), 'new scout');
    assert.equal(fs.readFileSync(path.join(DIR, 'node_modules', 'ws', 'index.js'), 'utf8'), 'ws');
    assert.equal(fs.readFileSync(path.join(DIR, '..', 'inject.js'), 'utf8'), '/* Fightcord loader */ new');
    assert.equal(fs.readFileSync(path.join(DIR, 'scout-config.json'), 'utf8'), '{"mine":true}', 'settings are never overwritten');
    assert.equal(fs.existsSync(path.join(DIR, 'old.js')), false, 'a module dropped from Fightcord is removed');
    assert.equal(fs.existsSync(path.join(DIR, 'my-plugin.js')), true, 'files Fightcord never shipped stay');
    assert.deepEqual(r.removed, ['old.js']);
    const m = JSON.parse(fs.readFileSync(path.join(DIR, 'fightcord.json'), 'utf8'));
    assert.equal(m.version, '2.4.0');
    assert.deepEqual(m.off, ['snapshot.js'], 'the rest of fightcord.json is kept');
    assert.deepEqual(m.files, ['scout.js']);
    fs.rmSync(path.join(os.tmpdir(), 'fc-upd-test'), { recursive: true, force: true });
});

test('install: a fake loader is never written', () => {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, '..', 'inject.js'), '/* Fightcord loader */ old');
    up.apply(DIR, { 'fightcord/a.js': Buffer.from('a'), 'inject.js': Buffer.from('evil()') }, '9.9.9');
    assert.equal(fs.readFileSync(path.join(DIR, '..', 'inject.js'), 'utf8'), '/* Fightcord loader */ old');
    fs.rmSync(path.join(os.tmpdir(), 'fc-upd-test'), { recursive: true, force: true });
});
