// node --test tests/      UI round 2 (2.15+): pop-up parts, Do not disturb, the Tonight card's numbers
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../fightcord-core.js');
const { ui } = core._test;
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
