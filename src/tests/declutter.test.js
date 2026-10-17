// node --test tests/      2.13 calmer UI: the header row's order and ⋯ menu, card building blocks, the notice line
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../fightcord-core.js');
const { ui } = core._test;
const chatExtras = require('../chat-extras.js');

// just enough of a channel header for the menu: native buttons present or not
function fakeActions(natives) {
    const clicked = [];
    const title = { getAttribute: () => 'Street Fighter III 3rd Strike', textContent: '#Street Fighter III 3rd Strike' };
    const wrapper = {
        querySelector: (sel) => (sel === '.channelInfo .name.title' ? title : null),
        querySelectorAll: () => []
    };
    const actions = {
        closest: (sel) => (sel === '.channelWrapper' ? wrapper : null),
        querySelector: (sel) => {
            const m = /^:scope > \.(\w+)$/.exec(sel);
            return m && natives.includes(m[1]) ? { click: () => clicked.push(m[1]) } : null;
        }
    };
    return { actions, clicked };
}

test('header: a fixed left-to-right order', () => {
    const o = ui.header.ORDER;
    const row = ['live', 'voice', 'session', 'goals', 'findmatch', 'feed', 'hub', 'stats', 'more'];
    for (let i = 1; i < row.length; i++) assert.ok(o[row[i - 1]] < o[row[i]], row[i - 1] + ' before ' + row[i]);
});

test('header ⋯ menu: Fightcade\'s own buttons first, then the registered items in order', () => {
    const off = [
        ui.header.more({ id: 't-b', label: 'Second', order: 2, fn: () => {} }),
        ui.header.more({ id: 't-a', label: 'First', order: 1, fn: () => {} }),
        ui.header.more({ id: 't-hidden', label: 'Hidden', order: 3, fn: () => {}, show: () => false })
    ];
    try {
        const { actions, clicked } = fakeActions(['testGame', 'trainingGame']);
        const items = ui.header._menu(actions);
        assert.deepEqual(items.map(i => (i === 'sep' ? '---' : i.label)), ['Test Game', 'Training', '---', 'First', 'Second']);
        items[0].fn();
        assert.deepEqual(clicked, ['testGame'], 'the menu clicks the real Test Game button');
        // no native buttons (a Fightcade update renamed them): just our items, no separator
        const bare = ui.header._menu(fakeActions([]).actions);
        assert.deepEqual(bare.map(i => (i === 'sep' ? '---' : i.label)), ['First', 'Second']);
    } finally { off.forEach(f => f()); }
});

test('card blocks: stats grid, one warning line, head', () => {
    const st = ui.stats([{ label: 'ELO', value: '1,546', sub: '#125' }, { label: 'Your odds', value: '41%', tone: 'down' }, null]);
    assert.equal((st.match(/class="fc-stat[ "]/g) || []).length, 2);
    assert.match(st, /fc-stat down/);
    assert.match(st, /<small>#125<\/small>/);
    assert.equal(ui.warn(''), '');
    assert.equal(ui.warn(['', null]), '');
    assert.match(ui.warn(['Wi-Fi', 'Leaves sets unfinished']), /Wi-Fi · Leaves sets unfinished/);
    const head = ui.cardHead({ name: 'Ken<b>', meta: '<i>m</i>', close: true });
    assert.ok(head.includes('Ken&lt;b&gt;'), 'the name is escaped');
    assert.ok(head.includes('<i>m</i>'), 'meta is HTML');
    assert.ok(head.includes('data-act="close"'));
});

test('channel notice: the folded line', () => {
    const t = (s) => s;
    t.plural = (n, one, many, v) => (n === 1 ? one : many).replace('{n}', v.n);
    assert.deepEqual(chatExtras.noticeSummary({ rules: true, links: 13, events: 4 }, t), ['Rules', '13 links', '4 events']);
    assert.deepEqual(chatExtras.noticeSummary({ rules: false, links: 1, events: 0 }, t), ['1 link']);
    assert.deepEqual(chatExtras.noticeSummary({}, t), []);
});
