// node --test tests/      the matchup guide (3.5): every name the emulator writes finds its character
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const mg = require('../matchup-guide.js')._test;

// the character tables inside fcadefbneo.exe for these games, as the emulator spells them (the last
// name of a table comes out with a stray letter: "Remya", "Kaind")
const EMU = {
    sfiii3nr1: ['Alex', 'Ryu', 'Yun', 'Dudley', 'Necro', 'Hugo', 'Ibuki', 'Elena', 'Oro', 'Yang', 'Ken', 'Sean', 'Urien', 'Akuma', 'Chun-Li', 'Makoto', 'Q', 'Twelve', 'Remya', 'Gill', 'Remy'],
    vsavj: ['Bulleta', 'Demitri', 'Gallon', 'Victor', 'Zabel', 'Morrigan', 'Anakaris', 'Felicia', 'Bishamon', 'Aulbath', 'Sasquatch', 'Dark Force Zabel', 'Q-Bee', 'Lei-Lei',
        'Lilith', 'Jedah', 'EX Bulleta', 'EX Demitri', 'Dark Gallon', 'EX Victor', 'EX Zabel', 'EX Morrigan', 'EX Anakaris', 'EX Felicia', 'Oboro Bishamon', 'EX Aulbath',
        'EX Sasquatch', 'EX Dark Force Zabel', 'EX Q-Bee', 'EX Lei-Lei', 'EX Lilith', 'EX Jedah'],
    sfa3u: ['Ryu', 'Ken', 'Akuma', 'Charlie', 'Chun-li', 'Adon', 'Sodom', 'Guy', 'Birdie', 'Rose', 'M.Bison', 'Sagat', 'Dan', 'Sakura', 'Rolento', 'Dhalsim', 'Zangief', 'Gen',
        'Balrog', 'Cammy', 'E.Honda', 'Blanka', 'R.Mika', 'Cody', 'Vega', 'Karin', 'Juli', 'Juni', 'Junie', 'Gouki (Akuma)', 'Shin-Akuma', 'Evil Ryur', 'Zangief(old)', 'Dhalsim(old)'],
    ssf2xj: ['Ryu', 'E.Honda', 'Blanka', 'Guile', 'Ken', 'Chun Li', 'Zangief', 'Dhalsim', 'Vega (Dictator)', 'Sagat', 'M. Bison (Boxer)', 'Balrog (Claw)'],
    ssf2t: ['Ryu', 'E. Honda', 'Blanka', 'Guile', 'Ken', 'Chun-Li', 'Zangief', 'Dhalsim', 'M. Bison (Dictator)', 'Sagat', 'Balrog (Boxer)', 'Vega (Claw)', 'Cammy', 'T. Hawk', 'Fei Long', 'Dee Jay'],
    garou: ['Terry', 'Rock', 'Dong Hwan', 'Jae Hoon', 'Hotaru', 'Gato', 'B.Jenet', 'Marco', 'Hokutomaru', 'Freeman', 'Tizoc', 'Kevin', 'Grant', 'Kaind']
};

test('matchup guide: every character the emulator reports has an entry', () => {
    for (const rom of Object.keys(EMU)) {
        for (const name of EMU[rom]) assert.ok(mg.find(rom, name), rom + ': ' + name);
    }
});

test('matchup guide: the emulator\'s odd spellings land on the right character', () => {
    const is = (rom, raw, want) => assert.equal((mg.find(rom, raw) || {}).name, want, rom + ' ' + raw);
    is('sfiii3nr1', 'Remya', 'Remy');
    is('fc1_sfiii3', 'Chun li', 'Chun-Li');
    is('sfiii3nr1', 'gouki', 'Akuma');
    is('vsavj', 'EX Felicia', 'Felicia');
    is('vsavj', 'Dark Gallon', 'Jon Talbain');
    is('vsavj', 'Lei-Lei', 'Hsien-Ko');
    // Dictator / Boxer / Claw swap names between the Japanese and US versions: the role wins
    is('ssf2xj', 'Vega (Dictator)', 'M. Bison');
    is('ssf2xj', 'M. Bison (Boxer)', 'Balrog');
    is('ssf2xj', 'Balrog (Claw)', 'Vega');
    is('sfa3u', 'Evil Ryur', 'Evil Ryu');
    is('garou', 'Kaind', 'Kain');
    assert.equal(mg.find('kof98', 'Terry'), null, 'a game without a guide');
    assert.equal(mg.find('sfiii3nr1', 'Nobody'), null);
    assert.equal(mg.find('sfiii3nr1', ''), null);
    assert.equal(mg.find('vsav2', 'Felicia'), null, 'Vampire Savior 2 is another game');
});

test('matchup guide: every entry is complete, with wiki links', () => {
    for (const g of mg.GAMES) {
        for (const name of Object.keys(g.chars)) {
            const e = mg.find(g.id === '3s' ? 'sfiii3nr1' : g.id === 'vsav' ? 'vsavj' : g.id === 'sfa3' ? 'sfa3u' : g.id === 'st' ? 'ssf2t' : 'garou', name);
            assert.ok(e, g.id + ' ' + name);
            assert.equal(e.name, name, 'no alias of another character shadows ' + name);
            assert.ok(e.s.length >= 2 && e.w.length >= 2 && e.t.length >= 3, g.id + ' ' + name + ' has strengths, weaknesses and tips');
            for (const line of e.s.concat(e.w)) assert.ok(typeof line === 'string' && line.length > 3 && line.length < 110, g.id + ' ' + name + ': ' + line);
            // a tip has to say something ("Zone him" doesn't); short enough for the VS screen
            for (const line of e.t) assert.ok(typeof line === 'string' && line.length > 20 && line.length < 110, g.id + ' ' + name + ' tip: ' + line);
            for (const other of e.good.concat(e.hard)) assert.ok(g.chars[other], g.id + ' ' + name + ' lists ' + other);
            assert.match(e.small, /^https:\/\/wiki\.supercombo\.gg\/images\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+$/);
            assert.match(e.face, e.art ? /^https:\/\/wiki\.supercombo\.gg\/images\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\/160px-\1$/ : /^https:\/\/wiki\.supercombo\.gg\/images\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+$/);
            assert.match(e.page, /^https:\/\/wiki\.supercombo\.gg\/w\//);
        }
    }
    // MediaWiki keeps a file in folders named after its md5: the stored folder must be the real one
    const md5 = (f) => require('crypto').createHash('md5').update(f).digest('hex').slice(0, 2);
    for (const g of mg.GAMES) {
        for (const name of Object.keys(g.chars)) {
            for (const img of [g.chars[name].img, g.chars[name].art].filter(Boolean)) {
                const [dir, file] = img.split('/');
                assert.equal(dir, md5(file), g.id + ' ' + name + ' ' + file);
            }
        }
    }
    assert.equal(mg.imgUrl('a0/3S_Akumaface_small.jpg'), 'https://wiki.supercombo.gg/images/a/a0/3S_Akumaface_small.jpg');
});

test('matchup guide: your own matchup\'s tips come first, then the general ones', () => {
    const t = mg.tips('sfiii3nr1', 'Akuma', 'Chun-Li', 3);
    assert.equal(t.length, 3);
    assert.match(t[0], /air fireballs/);
    assert.equal(t[2], mg.find('sfiii3nr1', 'Chun-Li').t[0]);
    assert.deepEqual(mg.tips('sfiii3nr1', '', 'Chun-Li', 2), mg.find('sfiii3nr1', 'Chun-Li').t.slice(0, 2), 'no character of yours: the general tips');
    assert.deepEqual(mg.tips('sfiii3nr1', 'Twelve', 'Remya', 3), mg.find('sfiii3nr1', 'Remy').t, 'no pair: the general tips');
    assert.ok(mg.hasPair('sfiii3nr1', 'Akuma', 'Chun-Li'));
    assert.ok(!mg.hasPair('sfiii3nr1', 'Twelve', 'Chun-Li'));
    assert.deepEqual(mg.tips('kof98', 'Terry', 'Andy'), []);
    for (const k of Object.keys(mg.GAMES[0].pairs)) {
        const [a, b] = k.split('|');
        assert.ok(mg.GAMES[0].chars[a] && mg.GAMES[0].chars[b], 'pair ' + k);
    }
});

test('matchup guide: icons fall back to an initial; the card escapes and links the wiki', () => {
    const f = mg.faceHtml('sfiii3nr1', 'Akuma', 40);
    // 3rd Strike: the wiki's big art (its 160 px copy), the small face if that fails
    assert.match(f, /src="https:\/\/wiki\.supercombo\.gg\/images\/thumb\/0\/0f\/3S_Akuma_Art\.png\/160px-3S_Akuma_Art\.png"/);
    assert.match(f, /data-alt="https:\/\/wiki\.supercombo\.gg\/images\/a\/a0\/3S_Akumaface_small\.jpg"/);
    assert.ok(Object.values(mg.GAMES[0].chars).every(c => c.art), 'every 3rd Strike character has art');
    assert.match(f, /--s:40px/);
    assert.match(f, /onerror=/);
    const none = mg.faceHtml('kof98', '<Kyo>', 20);
    assert.ok(none.includes('nof') && !none.includes('<img') && none.includes('&lt;'), 'unknown: an initial, escaped');
    const card = mg.cardHtml('sfiii3nr1', 'Chun-Li', 'Akuma');
    assert.match(card, /How to fight them/);
    assert.match(card, /As Akuma/);
    assert.match(card, /href="https:\/\/wiki\.supercombo\.gg\/w\/Street_Fighter_3:_3rd_Strike\/Chun-Li"/);
    assert.ok(card.includes('don&#39;t') || !card.includes("don't"), 'apostrophes escaped');
    assert.equal(mg.cardHtml('kof98', 'Terry'), '');
});
