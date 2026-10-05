// node --test tests/      the login screen (login-screen.js) and Discover's personal rows (discover.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const login = require('../login-screen.js');
const disc = require('../discover.js');

const DAY = 86400000, NOW = Date.UTC(2026, 9, 5, 18, 0);

test('login art: your most played games first, then popular ones, no repeats', () => {
    const sets = [{ rom: 'kof98' }, { rom: 'fc1_garou' }, { rom: 'kof98' }, { rom: 'garou' }, { rom: 'kof98' }, { rom: 'vsav' }];
    const roms = login.artRoms(sets, 6);
    assert.deepEqual(roms.slice(0, 3), ['kof98', 'garou', 'vsav']);
    assert.equal(roms.length, 6);
    assert.equal(new Set(roms).size, 6);
    assert.deepEqual(login.artRoms([], 3), login.POPULAR.slice(0, 3), 'nothing played yet: popular games');
});

test('login greeting: the last session is the sets within 8 hours of your last one', () => {
    const at = (h) => NOW - h * 3600000;
    const s = login.lastSession([
        { at: at(30), result: 'won', game: 'Old game' },
        { at: at(3), result: 'won', game: 'SFIII 3rd Strike' },
        { at: at(2), result: 'lost', game: 'SFIII 3rd Strike' },
        { at: at(1), result: 'won', game: 'SFIII 3rd Strike', myRank: 5 }
    ]);
    assert.deepEqual({ w: s.w, l: s.l, game: s.game, rank: s.rank }, { w: 2, l: 1, game: 'SFIII 3rd Strike', rank: 5 });
    assert.equal(login.lastSession([]), null);
    assert.equal(login.lastSession([{ at: 1, channel: 'Street Fighter III 3rd Strike: Fight for the Future (Japan 990512)' }]).game, 'Street Fighter III 3rd Strike');
});

const USERS = {
    Kenji: { channels: ['sf3'], playing: { quarkId: 'q1', channelId: 'sf3' } },
    Mai: { channels: ['kof98'] },
    Sleepy: { channels: ['sf3'], away: true },
    Rival: { channels: ['sf3'], channelRank: { sf3: 5 } },
    Busy: { channels: ['sf3'], playing: { quarkId: 'q2' } },
    Me: { channels: ['sf3'] }
};

test('friends playing now: in a match first, then free ones; away and offline friends left out', () => {
    const list = disc.friendsNow(['mai', 'KENJI', 'Sleepy', 'Nobody'], USERS);
    assert.deepEqual(list.map(f => f.name), ['Kenji', 'Mai']);
    assert.equal(list[0].playing.quarkId, 'q1');
    assert.deepEqual(disc.friendsNow([], USERS), []);
});

test('rivals online: played in the last 30 days, online and free, most played first', () => {
    const set = (opp, daysAgo, result) => ({ opp, at: NOW - daysAgo * DAY, result, channel: 'sf3', rom: 'sfiii3nr1' });
    const sets = [set('Rival', 1, 'won'), set('Rival', 2, 'lost'), set('rival', 3, 'won'), set('Mai', 5, 'lost'),
        set('Busy', 1, 'won'), set('Sleepy', 1, 'won'), set('Gone', 1, 'won'), set('Me', 1, 'won'), set('Mai', 40, 'won')];
    const list = disc.rivalsOnline(sets, USERS, 'me', NOW);
    assert.deepEqual(list.map(r => r.name), ['Rival', 'Mai'], 'busy, away, offline, yourself and old sets left out');
    assert.deepEqual({ w: list[0].w, l: list[0].l, sets: list[0].sets, rank: list[0].rank }, { w: 2, l: 1, sets: 3, rank: 5 });
    assert.equal(list[1].sets, 1, 'the 40-day-old set does not count');
});

test('events this week: your reminded ones first, all on request, day numbers, nothing past or beyond 7 days', () => {
    const ev = (name, hours, why) => ({ name, key: name, date: NOW + hours * 3600000, why });
    const list = [ev('Later', 24 * 9, 'auto'), ev('Old', -2, 'auto'), ev('Mine soon', 2, 'auto'), ev('Other', 5, ''), ev('Mine later', 30, 'picked')];
    assert.deepEqual(disc.eventsWeek(list, NOW).map(e => e.name), ['Mine soon', 'Mine later']);
    assert.deepEqual(disc.eventsWeek(list, NOW, true).map(e => e.name), ['Mine soon', 'Other', 'Mine later']);
    assert.deepEqual(disc.eventsWeek([ev('Other', 5, '')], NOW).map(e => e.name), ['Other'], 'none of yours: all of them');
    const days = disc.eventsWeek(list, NOW, true).map(e => e.day);
    assert.ok(days[0] <= days[2] && days.every(d => d >= 0 && d < 8));
});

test('rank band progress: how far through the band, and the next rank', () => {
    const bands = { 4: [1300, 1600], 6: [1900, 2300] };
    assert.deepEqual(disc.nextBand(4, 1450, bands), { frac: 0.5, next: 5 });
    assert.equal(disc.nextBand(4, 1200, bands).frac, 0);
    assert.equal(disc.nextBand(6, 2400, bands).next, null);
    assert.equal(disc.nextBand(4, null, bands), null);
    assert.equal(disc.nextBand(2, 900, bands), null);
});
