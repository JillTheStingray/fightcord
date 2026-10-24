// node --test tests/      pictures in chat (2.15): uploads.js (checks, catbox answers, the upload itself
// against a fake server), chat-extras' media previews, and links surviving chat font styles
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const up = require('../uploads.js');
const cx = require('../chat-extras.js');
const fs = require('../fontstyle.js');

test('which files can go', () => {
    assert.equal(up.checkFile({ type: 'image/png', size: 1000 }), '');
    assert.equal(up.checkFile({ type: 'image/gif', size: 1000 }), '');
    assert.equal(up.checkFile({ type: 'video/mp4', size: 5e6 }), '');
    assert.match(up.checkFile({ type: 'application/zip', size: 10 }), /Only pictures/);
    assert.match(up.checkFile({ type: 'image/png', size: 0 }), /empty/);
    assert.match(up.checkFile({ type: 'image/png', size: up.MAX + 1 }), /Too big/);
    assert.match(up.checkFile(null), /Nothing/);
});

test('catbox answers: only a files.catbox.moe link counts', () => {
    assert.equal(up.catboxUrl('https://files.catbox.moe/ab12cd.png\n'), 'https://files.catbox.moe/ab12cd.png');
    assert.equal(up.catboxUrl('Internal Server Error'), null);
    assert.equal(up.catboxUrl('https://evil.example/ab12cd.png'), null);
    assert.equal(up.catboxUrl('https://files.catbox.moe/../x.png'), null);
    assert.equal(up.catboxUrl(''), null);
});

test('the link goes after what you typed', () => {
    assert.equal(up.joinText('', 'https://files.catbox.moe/a.png'), 'https://files.catbox.moe/a.png');
    assert.equal(up.joinText('  look at this  ', 'https://files.catbox.moe/a.png'), 'look at this https://files.catbox.moe/a.png');
});

test('multipart body: the field, then the file between boundaries', () => {
    const b = up.multipart('XYZ', { reqtype: 'fileupload' }, { name: 'fightcord.png', type: 'image/png', data: Buffer.from([1, 2, 3]) });
    const s = b.toString('latin1');
    assert.match(s, /^--XYZ\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n--XYZ\r\n/);
    assert.match(s, /name="fileToUpload"; filename="fightcord\.png"\r\nContent-Type: image\/png\r\n\r\n\x01\x02\x03\r\n--XYZ--\r\n$/);
});

// a fake https.request: records what's sent, answers with `answer` (or never, for cancel)
function fakeRequest(status, answer, opts) {
    const o = opts || {};
    const sent = { headers: null, body: [] };
    const request = (url, options, cb) => {
        sent.url = url; sent.headers = options.headers; sent.method = options.method;
        const req = new EventEmitter();
        let n = 0;
        req.write = (chunk) => { sent.body.push(chunk); n++; return n % 3 !== 0; };      // "full" sometimes -> drain
        req.end = () => {
            if (o.hang) return;
            setTimeout(() => {
                const res = new EventEmitter();
                res.statusCode = status;
                res.setEncoding = () => {};
                cb(res);
                res.emit('data', answer);
                res.emit('end');
            }, 5);
        };
        req.destroy = (err) => setTimeout(() => req.emit('error', err || new Error('destroyed')), 0);
        const realWrite = req.write;
        req.write = (chunk) => { const ok = realWrite(chunk); if (!ok) setTimeout(() => req.emit('drain'), 0); return ok; };
        return req;
    };
    return { request, sent };
}

test('upload: the whole file goes, progress reaches 100%, the link comes back', async () => {
    const data = Buffer.alloc(300 * 1024, 7);
    const f = fakeRequest(200, 'https://files.catbox.moe/q1w2e3.png');
    const seen = [];
    const job = up.upload(data, 'image/png', (p) => seen.push(p), { request: f.request });
    assert.equal(await job.promise, 'https://files.catbox.moe/q1w2e3.png');
    assert.equal(f.sent.method, 'POST');
    assert.match(f.sent.url, /^https:\/\/catbox\.moe\/user\/api\.php$/);
    const body = Buffer.concat(f.sent.body);
    assert.equal(body.length, f.sent.headers['Content-Length']);
    assert.ok(body.includes(data), 'the file is in the body');
    assert.ok(seen.length > 2 && seen[seen.length - 1] === 1, 'progress up to 100%');
});

test('upload: an error answer is an error, cancelling stops it', async () => {
    const bad = fakeRequest(412, 'No file given');
    await assert.rejects(up.upload(Buffer.from('x'), 'image/png', null, { request: bad.request }).promise, /No file given/);
    const hang = fakeRequest(200, '', { hang: true });
    const job = up.upload(Buffer.from('x'), 'image/png', null, { request: hang.request });
    job.cancel();
    await assert.rejects(job.promise, /cancelled/);
});

test('previews: catbox pictures and clips, imgur gifv as a GIF; unknown hosts never fetched', async () => {
    assert.deepEqual(await cx._buildPreview('https://files.catbox.moe/ab12cd.png'), { kind: 'image', url: 'https://files.catbox.moe/ab12cd.png' });
    assert.deepEqual(await cx._buildPreview('https://files.catbox.moe/ab12cd.mp4'), { kind: 'clip', url: 'https://files.catbox.moe/ab12cd.mp4' });
    assert.deepEqual(await cx._buildPreview('https://i.imgur.com/AbCd123.gifv'), { kind: 'gifv', url: 'https://i.imgur.com/AbCd123.mp4', page: 'https://i.imgur.com/AbCd123.gifv' });
    assert.equal(cx._allowed('files.catbox.moe'), true);
    assert.equal(cx._allowed('catbox.moe.evil.com'), false);
    assert.equal(cx._allowed('grabify.link'), false);
});

test('chat font styles leave links alone (and skip decorations around them)', () => {
    const conf = { style: 'bold', plainMentions: false, inlineMarkup: true, decoration: 'stars' };
    const out = fs._styleMessage('gg look https://files.catbox.moe/ab_12_cd.gif nice', 'bold', conf);
    assert.ok(out.includes(' https://files.catbox.moe/ab_12_cd.gif '), out);
    assert.ok(!out.startsWith('gg'), 'the words around it are still styled');
    assert.ok(!out.includes('★'), 'no decoration when there is a link');
    assert.equal(fs._styleMessage('gg', 'bold', conf).includes('★'), true, 'decorations still apply without a link');
});

test('Giphy links: the GIF from the id (a small looping video), no page to read', async () => {
    const want = { kind: 'gifv', url: 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.mp4', still: 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy_s.gif' };
    for (const link of ['https://giphy.com/gifs/street-fighter-ryu-3o7TKSjRrfIPjeiVyM', 'https://giphy.com/gifs/3o7TKSjRrfIPjeiVyM', 'https://giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif']) {
        const p = await cx._buildPreview(link);
        assert.deepEqual({ kind: p.kind, url: p.url, still: p.still }, want, link);
        assert.equal(p.page, link);
    }
    assert.equal(await cx._buildPreview('https://giphy.com/explore/ryu'), null, 'not a GIF page');
    assert.deepEqual(await cx._buildPreview('https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif'), { kind: 'image', url: 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif' }, 'a direct file stays a picture');
});

test('pasting text is never taken for a file (Fightcade pastes it as usual)', () => {
    const text = { kind: 'string', type: 'text/plain', getAsFile: () => null };
    const html = { kind: 'string', type: 'text/html', getAsFile: () => null };
    assert.equal(up.fileFrom([text]), null, 'a pasted link');
    assert.equal(up.fileFrom([text, html]), null);
    const png = { name: 'a.png', type: 'image/png', size: 10 };
    assert.equal(up.fileFrom([text, { kind: 'file', type: 'image/png', getAsFile: () => png }]), png, 'a picture next to text');
    const zip = { name: 'a.zip', type: 'application/zip', size: 10 };
    assert.equal(up.fileFrom([zip, png]), png, 'dropped files: the picture first');
    assert.equal(up.fileFrom([zip]), zip, 'an unusable file still gets its "only pictures" message');
    assert.equal(up.fileFrom(null), null);
});

test('favorites: names from the link, search by every word', () => {
    assert.equal(up.nameOf('https://tenor.com/view/fighting-stance-ken-masters-ryu-gif-14314834610398825016'), 'fighting stance ken masters ryu');
    assert.equal(up.nameOf('https://giphy.com/gifs/street-fighter-ryu-3o7TKSjRrfIPjeiVyM'), 'street fighter ryu');
    assert.equal(up.nameOf('https://files.catbox.moe/ab12cd.gif'), '', 'catbox names are random');
    assert.equal(up.nameOf('https://i.imgur.com/hadouken.gif'), 'hadouken');
    assert.equal(up.nameOf('not a link'), '');
    const list = [
        { link: 'https://tenor.com/view/ken-masters-gif-1', name: 'ken masters' },
        { link: 'https://giphy.com/gifs/ryu-hadouken-abcdefgh12', name: 'ryu hadouken' },
        { link: 'https://files.catbox.moe/zz99yy.gif', name: '' }
    ];
    assert.equal(up.searchFavs(list, '').length, 3);
    assert.deepEqual(up.searchFavs(list, 'MASTERS').map(f => f.name), ['ken masters'], 'any case');
    assert.equal(up.searchFavs(list, 'ken').length, 2, 'part of a word too (hadouKEN)');
    assert.deepEqual(up.searchFavs(list, 'ryu hado').map(f => f.name), ['ryu hadouken'], 'every word');
    assert.deepEqual(up.searchFavs(list, 'catbox').length, 1, 'the link counts too');
    assert.equal(up.searchFavs(list, 'masters ryu').length, 0, 'every word has to be there');
});

// a Tenor search page, the way tenor.com carries its results
function tenorPage(results) {
    const data = { universal: { search: { 'ryu-low-all': { results } } } };
    return '<html><script type="text/x-cache" nonce="x">' + JSON.stringify(data).replace(/\//g, '\u002F') + '</script></html>';
}
const tenorHit = (id, extra) => Object.assign({ itemurl: 'https://tenor.com/view/ryu-gif-' + id, h1_title: 'Ryu ' + id + ' GIF',
    media_formats: { tinymp4: { url: 'https://media.tenor.com/' + id + 'P1/ryu.mp4' }, tinygif: { url: 'https://media.tenor.com/' + id + 'AM/ryu.gif' } } }, extra);

test('GIF search: the Tenor page for a search, its results read from the page', async () => {
    assert.equal(up.tenorSearchUrl('  Ryu   Hadouken '), 'https://tenor.com/search/ryu-hadouken-gifs');
    assert.equal(up.tenorSearchUrl('a/b?c#d'), 'https://tenor.com/search/abcd-gifs', 'no path tricks');
    assert.equal(up.tenorSearchUrl('   '), '');
    const r = up.parseTenor(tenorPage([tenorHit('aa'), tenorHit('bb'), tenorHit('aa'),
        tenorHit('cc', { itemurl: 'https://evil.example/view/x' }), tenorHit('dd', { media_formats: { tinymp4: { url: 'https://evil.example/x.mp4' } } })]));
    assert.deepEqual(r.map(x => x.link), ['https://tenor.com/view/ryu-gif-aa', 'https://tenor.com/view/ryu-gif-bb'], 'Tenor links and media only, once each');
    assert.deepEqual(r[0], { link: 'https://tenor.com/view/ryu-gif-aa', src: 'https://media.tenor.com/aaP1/ryu.mp4', still: 'https://media.tenor.com/aaAM/ryu.gif', kind: 'gifv', name: 'Ryu aa' });
    assert.deepEqual(up.parseTenor('<html>no data</html>'), []);
    // KLIPY can't answer -> Tenor's page; the search goes out once, then comes from the cache
    const seen = [];
    const get = (url) => {
        seen.push(url.split('?')[0]);
        if (/api\.klipy\.com/.test(url)) return Promise.reject(new Error('HTTP 429'));
        assert.equal(url, 'https://tenor.com/search/ken-gifs');
        return Promise.resolve(tenorPage([tenorHit('kk')]));
    };
    const r1 = await up.searchGifs('ken', get);
    assert.equal(r1.source, 'tenor');
    assert.equal(r1.results.length, 1);
    assert.equal((await up.searchGifs('Ken ', get)).results.length, 1);
    assert.deepEqual(seen, [up.KLIPY + '/gifs/search', 'https://tenor.com/search/ken-gifs'], 'cached after the first time');
    assert.deepEqual((await up.searchGifs('', get)).results, []);
});

// a KLIPY item, the way its API answers
const klipyItem = (slug, extra) => Object.assign({ slug, title: 'Cat ' + slug, file: {
    sm: { mp4: { url: 'https://static.klipy.com/ii/a/' + slug + '.mp4' }, jpg: { url: 'https://static.klipy.com/ii/a/' + slug + '.jpg' } },
    hd: { gif: { url: 'https://static.klipy.com/ii/a/' + slug + '.gif' } } } }, extra);

test('KLIPY: its links, its answers, search through it first', async () => {
    assert.deepEqual(up.klipySlug('https://klipy.com/gifs/cat-clapping-2'), { type: 'gifs', slug: 'cat-clapping-2' });
    assert.deepEqual(up.klipySlug('https://www.klipy.com/stickers/hi-there'), { type: 'stickers', slug: 'hi-there' });
    assert.equal(up.klipySlug('https://klipy.com/gifs/search'), null);
    assert.equal(up.klipySlug('https://klipy.com.evil.io/gifs/x1'), null);
    assert.equal(up.klipySlug('https://klipy.com/'), null);
    const list = up.parseKlipy({ result: true, data: { data: [klipyItem('cat-1'), klipyItem('bad', { file: { sm: { mp4: { url: 'https://evil.example/x.mp4' } } } }), { title: 'no slug' }] } }, 'gifs');
    assert.deepEqual(list, [{ link: 'https://klipy.com/gifs/cat-1', src: 'https://static.klipy.com/ii/a/cat-1.mp4', still: 'https://static.klipy.com/ii/a/cat-1.jpg', kind: 'gifv', name: 'Cat cat-1' }], 'KLIPY files only');
    assert.deepEqual(up.parseKlipy(null), []);
    const got = [];
    const r = await up.searchGifs('happy cat', (url) => { got.push(url); return Promise.resolve(JSON.stringify({ result: true, data: { data: [klipyItem('happy-1')] } })); });
    assert.equal(r.source, 'klipy');
    assert.equal(r.results[0].link, 'https://klipy.com/gifs/happy-1');
    assert.ok(got[0].indexOf('/gifs/search?page=1&per_page=40&q=happy%20cat&customer_id=') > 0, got[0]);
    assert.equal(got.length, 1, 'no Tenor when KLIPY answers');
});

test('audio files: which can go (by type or by name), their name after the #', async () => {
    assert.equal(up.typeOf({ type: 'audio/mpeg', name: 'a.mp3' }), 'audio/mpeg');
    assert.equal(up.typeOf({ type: '', name: 'Ken Theme.FLAC' }), 'audio/flac', 'Windows hands some files over with no type');
    assert.equal(up.typeOf({ type: 'application/octet-stream', name: 'x.exe' }), '');
    assert.equal(up.checkFile({ type: 'audio/x-m4a', name: 'a.m4a', size: 10 }), '');
    assert.match(up.checkFile({ type: '', name: 'notes.txt', size: 10 }), /Only pictures, GIFs, clips and audio/);
    assert.equal(up.audioTag('Ken Theme (remix).mp3'), '#Ken%20Theme%20%28remix%29');
    assert.equal(up.audioTag('.mp3'), '');
    const link = 'https://files.catbox.moe/ab12cd.mp3' + up.audioTag('Ken Theme (remix).mp3');
    assert.deepEqual(await cx._buildPreview(link), { kind: 'audio', url: 'https://files.catbox.moe/ab12cd.mp3', name: 'Ken Theme (remix).mp3' });
    assert.deepEqual(await cx._buildPreview('https://cdn.discordapp.com/attachments/1/2/round_1.ogg'), { kind: 'audio', url: 'https://cdn.discordapp.com/attachments/1/2/round_1.ogg', name: 'round_1.ogg' });
});

// a fake HEAD request: answers with that content-length (the file catbox kept)
function fakeHead(len, status) {
    return (url, o, cb) => { const req = new EventEmitter(); req.end = () => setTimeout(() => cb({ statusCode: status || 200, headers: { 'content-length': String(len) }, resume() {} }), 2); req.destroy = () => {}; return req; };
}
const okHead = (url, o, cb) => fakeHead(1)(url, o, cb);

test('catbox busy (200 with nothing, or a 5xx): a clear message, tried again, then given up', async () => {
    await assert.rejects(up.upload(Buffer.from('x'), 'image/png', null, { request: fakeRequest(200, '').request }).promise, (e) => e.busy && /busy or down/.test(e.message));
    await assert.rejects(up.upload(Buffer.from('x'), 'image/png', null, { request: fakeRequest(503, '<html>').request }).promise, (e) => e.busy);
    const notBusy = await up.upload(Buffer.from('x'), 'image/png', null, { request: fakeRequest(412, 'No file!').request }).promise.catch(e => e);
    assert.equal(notBusy.busy, undefined);
    // two busy answers, then a link
    const answers = [[200, ''], [502, ''], [200, 'https://files.catbox.moe/ok1234.webm']];
    let calls = 0, retries = 0;
    const flaky = (url, o, cb) => { const [s, a] = answers[calls++]; return fakeRequest(s, a).request(url, o, cb); };
    const got = await up.uploadRetry(Buffer.from('x'), 'audio/webm', null, { request: flaky, waits: [5, 5], head: okHead, onRetry: () => retries++ }).promise;
    assert.deepEqual(got, { url: 'https://files.catbox.moe/ok1234.webm', host: 'catbox' });
    assert.equal(calls, 3);
    assert.equal(retries, 2);
    // always busy: gives up after the waits run out; a real error isn't retried
    calls = 0;
    await assert.rejects(up.uploadRetry(Buffer.from('x'), 'audio/webm', null, { request: (u, o, cb) => { calls++; return fakeRequest(200, '').request(u, o, cb); }, waits: [5, 5], head: okHead, fallback: false }).promise, /busy/);
    assert.equal(calls, 3);
    calls = 0;
    await assert.rejects(up.uploadRetry(Buffer.from('x'), 'audio/webm', null, { request: (u, o, cb) => { calls++; return fakeRequest(412, 'No file!').request(u, o, cb); }, waits: [5, 5], head: okHead }).promise, /No file/);
    assert.equal(calls, 1);
    // cancel while waiting to try again
    const job = up.uploadRetry(Buffer.from('x'), 'audio/webm', null, { request: fakeRequest(200, '').request, waits: [500], head: okHead, fallback: false });
    setTimeout(() => job.cancel(), 40);
    await assert.rejects(job.promise, /cancelled/);
});

test('catbox hands out a link but kept nothing: tried again, never sent', async () => {
    let calls = 0;
    const req = (u, o, cb) => { calls++; return fakeRequest(200, 'https://files.catbox.moe/empty1.webm').request(u, o, cb); };
    await assert.rejects(up.uploadRetry(Buffer.from('abc'), 'audio/webm', null, { request: req, head: fakeHead(0), waits: [5, 5], fallback: false }).promise, (e) => e.busy && /didn.t keep the file/.test(e.message));
    assert.equal(calls, 3);
    assert.equal(await up.uploadRetry(Buffer.from('abc'), 'audio/webm', null, { request: req, head: fakeHead(3), waits: [5] }).promise.then(g => g.url), 'https://files.catbox.moe/empty1.webm', 'the right size: fine');
    assert.equal(await up.stored('https://files.catbox.moe/x.png', 3, { head: () => { throw new Error('offline'); } }), null, 'can not tell: the link goes out');
});

test('catbox keeps failing: the file goes to uguu.se instead (its own field, its JSON answer)', async () => {
    assert.equal(up.uguuUrl('{"success":true,"files":[{"url":"https://h.uguu.se/AbCd1234.png"}]}'), 'https://h.uguu.se/AbCd1234.png');
    assert.equal(up.uguuUrl('{"success":true,"files":[{"url":"https://evil.example/x.png"}]}'), null);
    assert.equal(up.uguuUrl('{"success":false}'), null);
    assert.equal(up.uguuUrl('<html>'), null);
    const seen = [], steps = [];
    const req = (url, o, cb) => {
        seen.push(url);
        return /uguu/.test(url) ? fakeRequest(200, '{"success":true,"files":[{"url":"https://h.uguu.se/Zx9.webm"}]}').request(url, o, cb) : fakeRequest(200, '').request(url, o, cb);
    };
    const got = await up.uploadRetry(Buffer.from('abc'), 'audio/mpeg', null, { request: (u, o, cb) => { const r = req(u, o, cb); const w = r.write; r.write = (c) => { steps.push(String(c)); return w(c); }; return r; }, head: fakeHead(3), waits: [5, 5], onRetry: (n, h) => steps.push('retry ' + n + ' ' + h) }).promise;
    assert.deepEqual(got, { url: 'https://h.uguu.se/Zx9.webm', host: 'uguu' });
    assert.deepEqual(seen, ['https://catbox.moe/user/api.php', 'https://catbox.moe/user/api.php', 'https://catbox.moe/user/api.php', 'https://uguu.se/upload']);
    assert.ok(steps.some(x => x === 'retry 3 uguu.se'));
    assert.ok(steps.join('').includes('name="files[]"; filename="fightcord.mp3"'), 'uguu wants files[]');
    // both down: one clear message
    await assert.rejects(up.uploadRetry(Buffer.from('abc'), 'image/png', null, { request: fakeRequest(200, '').request, head: okHead, waits: [5] }).promise, /both having trouble/);
});

test('messages with several lines: one message per line, blank lines dropped, long ones split at a space', () => {
    assert.deepEqual(cx.splitLines('gg\n\nrematch?\r\n  \nFT5 '), ['gg', 'rematch?', 'FT5']);
    assert.deepEqual(cx.splitLines(''), []);
    const long = ('word ').repeat(150).trim();                 // 749 characters
    const parts = cx.splitLines(long);
    assert.equal(parts.length, 2);
    assert.ok(parts.every(p => p.length <= 500));
    assert.equal(parts.join(' '), long, 'nothing lost at the cut');
    assert.deepEqual(cx.splitLines('x'.repeat(1200)).map(p => p.length), [500, 500, 200], 'no space: a hard cut');
});

test('messages with several lines go as ONE message: lines joined with Fightcade\'s \\n (shown as a new line)', () => {
    const BR = String.fromCharCode(92) + 'n';
    assert.deepEqual(cx.packMessages('Looking for sets:\n3rd Strike FT5\n\nEU, wired\n\n'), ['Looking for sets:' + BR + '3rd Strike FT5' + BR + BR + 'EU, wired'], 'a blank line in the middle stays; not at the ends');
    assert.deepEqual(cx.packMessages('\n\n  \n'), []);
    // past 500 characters: as few messages as fit, each at most 500
    const many = Array.from({ length: 60 }, (_, i) => 'line number ' + i).join('\n');
    const msgs = cx.packMessages(many);
    assert.ok(msgs.length === 2 && msgs.every(m => m.length <= 500), msgs.map(m => m.length).join(','));
    assert.equal(msgs.join(BR).split(BR).length, 60, 'every line is there');
    assert.ok(!msgs.some(m => m.startsWith(BR) || m.endsWith(BR)));
});

test('chat font styles keep Fightcade\'s \\n line break (and stop a link at it)', () => {
    const BR = String.fromCharCode(92) + 'n';
    const conf = { style: 'bold', plainMentions: false, inlineMarkup: true, decoration: 'none' };
    const out = fs._styleMessage('hello' + BR + 'see https://x.com/a' + BR + 'next', 'bold', conf);
    assert.equal(out.split(BR).length, 3, out);
    assert.ok(out.includes('https://x.com/a' + BR), 'the link is untouched and ends at the line break');
    assert.ok(!out.split(BR)[2].includes('next'), 'the text after it is still styled');
});
