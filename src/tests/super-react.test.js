// node --test tests/      3.9: super reactions (their own pill next to the normal one) and big emoji
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const V = require('../voice.js');
const L = require(path.join(__dirname, '..', 'lobbies.js'));
L._setVoice(V);

let n = 0;
const id = () => 'e' + (n++);
const react = (r, pk, e, on, at, sp) => r.apply({ id: id(), pk, at, b: Object.assign({ t: 'react', m: 'm1', e, on }, sp ? { sp: 1 } : {}) });

test('a super reaction is its own pill, first, next to the normal one with the same emoji', () => {
    const r = L.Room({ pre: 'own' });
    r.apply({ id: 'm1', pk: 'aa', at: 100, b: { t: 'msg', x: 'that parry' } });
    react(r, 'bb', '🔥', true, 200);
    react(r, 'cc', '🔥', true, 210);
    react(r, 'bb', '🔥', true, 220, true);
    const list = r.reactions('m1');
    assert.deepEqual(list.map(x => [x.e, x.sp, x.pks.length]), [['🔥', true, 1], ['🔥', false, 2]]);
});

test('a super reaction comes off on its own; the same person twice is one', () => {
    const r = L.Room({ pre: 'own' });
    react(r, 'bb', '😂', true, 200, true);
    react(r, 'bb', '😂', true, 210, true);
    react(r, 'bb', '😂', true, 220);
    assert.deepEqual(r.reactions('m1').map(x => [x.sp, x.pks.length]), [[true, 1], [false, 1]]);
    react(r, 'bb', '😂', false, 230, true);
    assert.deepEqual(r.reactions('m1').map(x => [x.sp, x.pks.length]), [[false, 1]], 'only the super one went');
    // an older one arriving late changes nothing
    react(r, 'bb', '😂', true, 215, true);
    assert.equal(r.reactions('m1').filter(x => x.sp).length, 0);
});

test('a 3.8 reaction (no sp) stays a normal one', () => {
    const r = L.Room({ pre: 'own' });
    react(r, 'bb', '👍', true, 200);
    assert.deepEqual(r.reactions('m1'), [{ e: '👍', sp: false, pks: ['bb'] }]);
});

test('emoji -> the name of Google’s animated Noto picture', () => {
    assert.equal(L.notoCode('🔥'), '1f525');
    assert.equal(L.notoCode('❤️'), '2764', 'the FE0F goes');
    assert.equal(L.notoCode('👍🏽'), '1f44d_1f3fd', 'skin tones stay');
    assert.equal(L.notoCode('👩‍💻'), '1f469_200d_1f4bb', 'ZWJ sequences keep their joiners');
    assert.equal(L.notoCode('gg'), '', 'text is not an emoji');
    assert.equal(L.notoCode(''), '');
});

test('big emoji: only emoji, up to 10', () => {
    assert.deepEqual(L.emojiOnly('🔥'), ['🔥']);
    assert.deepEqual(L.emojiOnly(' 😂 😂👍🏽 '), ['😂', '😂', '👍🏽']);
    assert.deepEqual(L.emojiOnly('👩‍💻❤️'), ['👩‍💻', '❤️']);
    assert.equal(L.emojiOnly('gg 🔥'), null, 'with words: a normal message');
    assert.equal(L.emojiOnly('🔥'.repeat(11)), null, 'too many');
    assert.equal(L.emojiOnly(''), null);
    assert.equal(L.emojiOnly('123'), null, 'digits are not emoji here');
});
