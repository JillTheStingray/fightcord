// node --test tests/      UI round 2 (2.15+): pop-up parts, Do not disturb, the Tonight card's numbers
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../fightcord-core.js');
const { ui } = core._test;
const T = core._test;
const ms = require('../match-screens.js');

test('pop-up head: icon, title escaped, sub as HTML, a close button unless turned off', () => {
    const h = ui.popHead({ icon: 'target', title: 'Find <a> match', sub: '<i>near you</i>' });
    assert.match(h, /^<div class="fc-ph">/);
    assert.match(h, /<b>Find &lt;a&gt; match<\/b>/, 'the title is text');
    assert.match(h, /<span><i>near you<\/i><\/span>/, 'the sub line is HTML');
    assert.match(h, /data-act="pop-close"/);
    assert.doesNotMatch(ui.popHead({ title: 'x', close: false }), /pop-close/);
    assert.match(ui.popHead({ title: 'x', extra: '<em>3</em>' }), /<em>3<\/em>.*pop-close/s, 'extra sits before the close button');
});

test('pop-up foot: a left note and the buttons on the right', () => {
    const f = ui.popFoot('2 more', '<button>a</button><button>b</button>');
    assert.equal(f, '<div class="fc-pf"><div class="l">2 more</div><div class="r"><button>a</button><button>b</button></div></div>');
    assert.equal(ui.popFoot(), '<div class="fc-pf"><div class="l"></div><div class="r"></div></div>');
});

test('Do not disturb: off without a config, a plain boolean', () => {
    assert.equal(typeof ui.dnd, 'function');
    assert.equal(ui.dnd(), false);
});

test('the night: a running wins-minus-losses line, the best win, the toughest opponent', () => {
    const at = 1;
    const sets = [
        { result: 'won', opp: 'Low', oppRank: 2, at },
        { result: 'lost', opp: 'Shoryu', oppRank: 5, at },
        { result: 'won', opp: 'Top', oppRank: 6, oppElo: 1700, at },
        { result: 'lost', opp: 'Shoryu', at },
        { result: 'draw', opp: 'Even', at },
        { result: 'won', opp: 'Shoryu', oppRank: 5, at }
    ];
    const n = ms.nightStats(sets);
    assert.equal(n.n, 5, 'draws and unknowns aren’t on the line');
    assert.deepEqual(n.points, [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0], [5, 1]]);
    assert.equal(n.best.opp, 'Top', 'the highest ELO / rank beaten');
    assert.deepEqual({ opp: n.toughest.opp, w: n.toughest.w, l: n.toughest.l }, { opp: 'Shoryu', w: 1, l: 2 });
    assert.equal(ms.nightStats([{ result: 'won', opp: 'A' }, { result: 'lost', opp: 'B' }, { result: 'won', opp: 'B' }]).toughest, null, 'even = not "toughest"');
    assert.equal(ms.nightStats([]).best, null);
});

const ml = require('../member-list.js');

test('member search: every word somewhere in the name, any case', () => {
    assert.equal(ml.matchesSearch('Ryu_Main', 'ryu'), true);
    assert.equal(ml.matchesSearch('Ryu_Main', 'MAIN ryu'), true, 'any order');
    assert.equal(ml.matchesSearch('Ryu_Main', 'ryu ken'), false, 'every word');
    assert.equal(ml.matchesSearch('Ryu_Main', '   '), true, 'an empty search hides nobody');
    assert.equal(ml.matchesSearch('', 'a'), false);
});

test('member groups: a fold key per group; who the ⚔ button can challenge', () => {
    assert.equal(ml.groupKey(-3), 'playing');
    assert.equal(ml.groupKey(-2), 'friends');
    assert.equal(ml.groupKey(-1), 'lobbies');
    assert.equal(ml.groupKey(0), 'rank-S');
    assert.equal(ml.groupKey(6), 'rank-?');
    assert.equal(ml.canQuick({ name: 'Ken' }), true);
    assert.equal(ml.canQuick({ name: 'Ken', me: true }), false, 'not yourself');
    assert.equal(ml.canQuick({ name: 'Ken', away: true }), false, 'not someone away');
    assert.equal(ml.canQuick({ name: 'Ken', playing: true }), false, 'not someone in a match');
    assert.equal(ml.canQuick({}), false);
});

const fcord = require('../fightcord.js')._setup;

test('setup codes: the look and layout go, nothing personal does', () => {
    const configs = {
        'discord-theme': { preset: 'tokyo', accent: '#ff3e8e', bgFile: 'theme-background.png', custom: { bg: '#111' }, _v: 2 },
        'login-screen': { enabled: true, art: 'mine', lastUser: 'TurtleTime' },
        'member-list': { side: 'right', folded: { 'rank-B': true }, filter: { ranks: ['S'] }, sort: 'ping' },
        'match-screens': { vs: true, sessionClearedAt: 123 },
        'fontstyle': { style: 'bold', macros: { F1: 'gg' } },
        'chat-extras': { blurMedia: true, noticeOpen: { a: 1 }, path: ['C:', 'Users', 'me', 'x.png'].join(String.fromCharCode(92)), pic: 'data:image/png;base64,AAAA', long: 'x'.repeat(400) },
        'notes': { players: { ken: 'rushes down' } },
        'lobbies': { secret: 'abc', lobbies: [{ id: 1 }] },
        'voice': { mic: 'usb-mic' },
        'uploads': { favorites: [{ link: 'x' }] }
    };
    const p = fcord.setupPayload(configs, ['music.js', 'fightcord.js', '../evil.js', 'streamer.js']);
    assert.deepEqual(p.cfg['discord-theme'], { preset: 'tokyo', accent: '#ff3e8e', custom: { bg: '#111' } });
    assert.deepEqual(p.cfg['login-screen'], { enabled: true, art: 'mine' }, 'not your account name');
    assert.deepEqual(p.cfg['member-list'], { side: 'right' });
    assert.deepEqual(p.cfg['match-screens'], { vs: true });
    assert.deepEqual(p.cfg['fontstyle'], { style: 'bold' }, 'no macros');
    assert.deepEqual(p.cfg['chat-extras'], { blurMedia: true }, 'no paths, pictures or long text');
    ['notes', 'lobbies', 'voice', 'uploads'].forEach(id => assert.equal(p.cfg[id], undefined, id + ' never goes'));
    assert.deepEqual(p.off, ['music.js', 'streamer.js'], 'only real module files, never the core');
    const code = fcord.encodeSetup(p);
    assert.match(code, /^FCSETUP1:[A-Za-z0-9+/=]+$/);
    assert.ok(!/TurtleTime|abc|rushes/.test(Buffer.from(code.slice(9), 'base64').toString('latin1')));
    assert.deepEqual(fcord.decodeSetup('  ' + code + '\n'), p, 'round trip');
});

test('setup codes: a pasted code is checked again; the preview says what changes', () => {
    assert.equal(fcord.decodeSetup('hello'), null);
    assert.equal(fcord.decodeSetup('FCSETUP1:!!!'), null);
    // a hand-made code trying to sneak secrets / other files in: they're dropped
    const zlib = require('zlib');
    const evil = 'FCSETUP1:' + zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, cfg: { lobbies: { secret: 'x' }, 'login-screen': { lastUser: 'x', art: 'none' } }, off: ['fightcord-core.js'] }))).toString('base64');
    assert.deepEqual(fcord.decodeSetup(evil), { v: 1, cfg: { 'login-screen': { art: 'none' } }, off: [] });
    const p = { v: 1, cfg: { 'discord-theme': { preset: 'crt', accent: '#ffb000' }, 'member-list': { side: 'left' } }, off: ['music.js'] };
    const d = fcord.setupDiff(p, { 'discord-theme': { preset: 'dark', accent: '#ffb000' }, 'member-list': { side: 'left' } }, ['discover.js']);
    assert.deepEqual(d.cfg, [{ id: 'discord-theme', keys: ['preset'] }]);
    assert.deepEqual(d.turnOff, ['music.js']);
    assert.deepEqual(d.turnOn, ['discover.js']);
});

test('changed settings: what differs from the defaults, and one put back', () => {
    const api = T.settingsApi();
    const saved = [];
    const store = { data: { on: false, mode: 'b', vol: 0.5, x: 1 }, defaults: () => ({ on: true, mode: 'a', vol: 0.5, x: 1 }), save() { saved.push(1); } };
    let changedTo = null;
    api.block({ id: 'zz-test', section: 'zz', title: 'Test block', store, fields: [
        { key: 'on', type: 'switch', label: 'On thing', onChange: (v) => { changedTo = v; } },
        { key: 'mode', type: 'select', label: 'Mode', options: [['a', 'Alpha'], ['b', 'Beta']] },
        { key: 'vol', type: 'slider', label: 'Volume', scale: 100, unit: '%' },
        { type: 'note', label: 'a note' }
    ] });
    const ch = api.changed().filter(c => c.block === 'zz-test');
    assert.deepEqual(ch.map(c => [c.key, c.text]), [['on', 'Off'], ['mode', 'Beta']]);
    assert.equal(T.valueText({ type: 'slider', scale: 100, unit: '%' }, 0.42), '42%');
    assert.equal(api.resetField('zz-test', 'on'), true);
    assert.equal(store.data.on, true);
    assert.equal(changedTo, true, 'its onChange runs');
    assert.deepEqual(api.changed().filter(c => c.block === 'zz-test').map(c => c.key), ['mode']);
    assert.equal(api.resetField('zz-test', 'nope'), false);
    assert.ok(saved.length >= 1);
});

test('ui.setHtml writes only when the content really changed (no rewrite loop with the page watcher)', () => {
    let writes = 0;
    const el = { childNodes: [], set innerHTML(v) { writes++; this._h = v; this.childNodes = v ? [1] : []; }, get innerHTML() { return 'normalized:' + this._h; } };
    assert.equal(ui.setHtml(el, '<b>664</b> online'), true);
    assert.equal(ui.setHtml(el, '<b>664</b> online'), false, 'same content: untouched, even though el.innerHTML reads back differently');
    assert.equal(ui.setHtml(el, '<b>665</b> online'), true);
    assert.equal(writes, 2);
    el.childNodes = [];                                  // someone else emptied it
    assert.equal(ui.setHtml(el, '<b>665</b> online'), true, 'put back');
    assert.equal(ui.setHtml(null, 'x'), false);
});
