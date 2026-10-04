// node --test tests/      exact ELO from Fightcade's playing events (fc.elo)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require('../fightcord-core.js');
const T = core._test;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcelo-'));
const root = { _data: { global: { localUser: { name: 'Me' } } }, globalUsers: {} };
T.setDir(dir);
T.setRoot(root);
T.boot(root, { version: 'test' });

test('ignores missing / zero / non-number ELO (what non-supporters get)', () => {
    assert.equal(T.recordElo('Ken', 'sfiii3nr1', 0, true), false);
    assert.equal(T.recordElo('Ken', 'sfiii3nr1', undefined, true), false);
    assert.equal(T.recordElo('Ken', 'sfiii3nr1', '1500', true), false);
    assert.equal(T.recordElo('Ken', '', 1500, true), false);
    assert.equal(T.elo.value('Ken', 'sfiii3nr1'), null);
});

test('other players: per name + game, case-insensitive, memory only', () => {
    assert.equal(T.recordElo('Ken', 'sfiii3nr1', 1500.4, true), true);
    assert.equal(T.elo.value('ken', 'sfiii3nr1'), 1500);
    assert.equal(T.elo.value('Ken', 'kof98'), null);
    assert.equal(T.elo.mine('sfiii3nr1'), null, 'not yours');
});

test('yours: start / end of the match kept and saved to the core config', async () => {
    const seen = [];
    const ev = T.eventsFor(T.makeOwner('elo-test'));
    ev.on('elo:real', (e) => seen.push(e));
    T.recordElo('Me', 'sfiii3nr1', 1630, true, 5);
    assert.deepEqual(T.elo.mine('sfiii3nr1').start, 1630);
    assert.equal(T.elo.mine('sfiii3nr1').end, undefined, 'still playing');
    T.recordElo('ME', 'sfiii3nr1', 1642, false, 5);
    const m = T.elo.mine('sfiii3nr1');
    assert.equal(m.elo, 1642);
    assert.equal(m.start, 1630);
    assert.equal(m.end, 1642);
    assert.equal(T.elo.value('me', 'sfiii3nr1'), 1642);
    assert.equal(seen.length, 2);
    assert.deepEqual([seen[1].mine, seen[1].start, seen[1].elo, seen[1].rank], [true, false, 1642, 5]);
    // a new match starts fresh: no stale start carried into it
    T.recordElo('Me', 'sfiii3nr1', 1650, false);
    assert.equal(T.elo.mine('sfiii3nr1').start, undefined, 'an end without its start');
    T.flushStores();
    await sleep(50);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'fightcord-core-config.json'), 'utf8'));
    assert.equal(saved.myElo.sfiii3nr1.elo, 1650);
});

test('the in-memory list of other players is capped', () => {
    for (let i = 0; i < 2100; i++) T.recordElo('p' + i, 'kof98', 1000 + i, true);
    assert.equal(T.elo.value('p0', 'kof98'), null, 'oldest dropped');
    assert.equal(T.elo.value('p2099', 'kof98'), 3099);
});
