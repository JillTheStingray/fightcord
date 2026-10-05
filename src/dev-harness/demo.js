/**
 * Demo mode for README screenshots: snapshot.html?s=<folder>&demo=1
 *
 * Snapshots are real Fightcade pages: real player names, chat, avatars (Gravatar hashes of
 * people's email addresses) and your own Fightcade ID. Before anything is shown, this rewrites
 * the parsed snapshot so none of that survives:
 *   - every name (member list, matches, chat authors, data-* / title attributes, your ID)
 *     -> a made-up handle, the same one everywhere
 *   - every chat line -> made-up banter
 *   - every Gravatar picture -> a generic pixel avatar for the made-up name
 * window.__demoLeaks() lists any original name still on the page (shots.js refuses to save
 * a screenshot while that list isn't empty).
 */
(function () {
    'use strict';
    const A = ['Frame', 'Parry', 'Combo', 'Tech', 'Chip', 'Meaty', 'Jab', 'Whiff', 'Dash', 'Sweep', 'Hado', 'Shoryu', 'Kara', 'Plink',
        'Fuzzy', 'Cross', 'Buffer', 'Tiger', 'Dragon', 'Charge', 'Zoning', 'Rush', 'Poke', 'Grab', 'Stun', 'Super', 'Arcade', 'Coin',
        'Final', 'Reset', 'Mixup', 'Block', 'Punish', 'Throw', 'Low', 'Okizeme', 'Neutral', 'Spacing', 'Rekka', 'Taunt'];
    const B = ['Kid', 'King', 'Queen', 'Master', 'Main', 'Fan', 'Ace', 'Ninja', 'Wolf', 'Fox', 'Panda', 'Owl', 'Ghost', 'Hero', 'Boss',
        'Monk', 'Rookie', 'Pilot', 'Chef', 'Wizard'];
    const fakeName = (i) => {
        const a = A[i % A.length], b = B[Math.floor(i / A.length) % B.length], n = Math.floor(i / (A.length * B.length));
        const style = (i * 7) % 5;
        const base = style === 0 ? a + b : style === 1 ? a.toLowerCase() + '_' + b.toLowerCase() : style === 2 ? a + b + ((i * 37) % 90 + 10)
            : style === 3 ? a + '_' + b : a.toUpperCase() + b;
        return n ? base + n : base;
    };
    const LINES = ['gg', 'anyone up for ft5?', 'that parry was clean', 'rematch?', 'lag was rough that set, my bad',
        'gg wp, your Ken is scary', 'looking for long sets, any rank', 'how do you even block that crossup',
        'one more?', 'nice comeback lol', 'ft10 anyone? EU', 'learning Chun, go easy', 'that super cancel though',
        'brb food', 'Ryu mirror anyone?', 'good games all', 'who wants to run some casuals', 'gg, thanks for the sets'];
    // a made-up 32-hex "Gravatar hash" per made-up name: with f=y Gravatar always draws its generated
    // retro avatar for it (never anyone's real picture), and each name gets a different one
    const hash = (s) => [0x811c9dc5, 0x1b873593, 0x85ebca6b, 0xc2b2ae35].map(h => {
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return h.toString(16).padStart(8, '0');
    }).join('');
    window.__demoHash = hash;
    const avatar = (name, size) => 'https://www.gravatar.com/avatar/' + hash(name) + '?s=' + (size || 40) + '&d=retro&f=y';
    const GRAV = /https?:\/\/(?:www\.|secure\.)?gravatar\.com\/avatar\/[^"'\s)&]+(?:\?[^"'\s)]*)?/g;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // any of the names, standing on its own (not inside a longer word)
    const nameRe = (names) => names.length
        ? new RegExp('(^|[^A-Za-z0-9_])(' + names.slice().sort((a, b) => b.length - a.length).map(esc).join('|') + ')(?![A-Za-z0-9_])', 'g') : null;

    let originals = [];
    const realHashes = new Set();

    window.__demoScrub = function (doc, meFake) {
        const map = new Map();
        const add = (raw) => {
            const n = String(raw || '').trim();
            if (n.length < 2 || map.has(n) || /\s{2,}/.test(n) || n.length > 32) return;
            map.set(n, fakeName(map.size + 3));
        };
        // who's who
        doc.querySelectorAll('.playerName').forEach(el => add(el.getAttribute('title') || el.textContent));
        doc.querySelectorAll('.author').forEach(el => add([...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join('')));
        doc.querySelectorAll('[data-current-user], [data-cerberus-user]').forEach(el => { add(el.getAttribute('data-current-user')); add(el.getAttribute('data-cerberus-user')); });
        let myId = '';
        doc.querySelectorAll('.userIdWrapper .userName, .userName').forEach(el => { myId = myId || el.textContent.trim(); add(el.textContent); });
        if (myId && meFake) map.set(myId, meFake);
        originals = [...map.keys()];
        // Cerberus' floating buttons were in the capture; Fightcord users don't have Cerberus
        doc.querySelectorAll('.cerb-fabs-container, .cerb-fab-btn, .cerb-rank-badge, .fcScoutBadge').forEach(n => n.remove());

        // chat lines -> banter (before names, so mentions inside lines go too)
        let li = 0;
        doc.querySelectorAll('.messageWrapper:not(.motd) .blocksContainer').forEach(bc => {
            bc.innerHTML = '<div class="blocks"><span class="regular ">' + LINES[li++ % LINES.length] + '</span></div>';
        });
        doc.querySelectorAll('.messageWrapper:not(.motd)').forEach(mw => {
            // a chat line without blocks: blank every text node outside the header
            if (mw.querySelector('.blocksContainer')) return;
            const body = mw.querySelector('.message');
            if (!body) return;
            const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
            const texts = [];
            while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('header')) texts.push(walker.currentNode);
            texts.forEach((t, i) => { t.textContent = i === 0 ? LINES[li++ % LINES.length] : ''; });
        });

        // text: whole matches, then names inside sentences ("You have just finished a game vs <name>")
        const textRe = nameRe(originals.filter(n => n.length >= 3));
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const t = walker.currentNode, v = t.textContent.trim();
            if (!v) continue;
            if (map.has(v)) t.textContent = t.textContent.replace(v, map.get(v));
            else if (textRe && !t.parentElement.closest('script, style')) t.textContent = t.textContent.replace(textRe, (m, pre, n) => pre + map.get(n));
        }
        // attributes: exact, then any longer name inside (ids like "chat-sfiii3nr1-<name>-at 21:44")
        const longRe = nameRe(originals);
        doc.body.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(at => {
                if (at.name === 'class' || at.name.startsWith('data-v-')) return;
                let v = at.value;
                if (map.has(v.trim())) v = map.get(v.trim());
                else if (longRe && at.name !== 'src' && at.name !== 'style') v = v.replace(longRe, (m, pre, n) => pre + map.get(n));
                if (/gravatar\.com\/avatar\//.test(v)) {
                    (v.match(/gravatar\.com\/avatar\/([0-9a-f]{32})/g) || []).forEach(g => realHashes.add(g.slice(-32)));
                    const who = el.closest('[data-current-user], .userItem, .messageWrapper');
                    const n = el.closest('.userAvatarWrapper') ? (meFake || 'me')
                        : (who && (who.getAttribute('data-current-user') || (who.querySelector('.playerName') || {}).textContent)) || 'player';
                    v = v.replace(GRAV, avatar(String(n).trim(), 64));
                    if (at.name === 'href') v = '#';
                }
                if (v !== at.value) el.setAttribute(at.name, v);
            });
        });
        return map;
    };

    // made-up history for the stats / progress / goals screens (only the harness's in-memory files)
    window.__demoSeed = function (files, names, channel, rom) {
        let seed = 7;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const pick = (a) => a[Math.floor(rnd() * a.length)];
        const opps = names.filter(n => n !== 'TurtleTime').slice(0, 40);
        const DAY = 86400e3, now = Date.now();
        const sets = [];
        let q = 1000;
        // characters from their own generator, so the rest of the made-up history stays the same
        let cseed = 11;
        const crnd = () => (cseed = (cseed * 16807) % 2147483647) / 2147483647;
        const CAST = ['Ken', 'Chun-Li', 'Yun', 'Yang', 'Dudley', 'Makoto', 'Ryu', 'Urien', 'Ibuki', 'Necro'];
        const addSet = (at, myRank, winP) => {
            const oppRank = Math.max(1, Math.min(6, myRank + Math.round((rnd() - 0.5) * 3)));
            const ft = pick([2, 3, 3, 5, 5, 5, 10]);
            const ping = Math.round(25 + rnd() * rnd() * 220);
            const p = winP - (oppRank - myRank) * 0.08 - (ping > 150 ? 0.1 : 0);
            const won = rnd() < p;
            const loser = Math.floor(rnd() * ft);
            const durSec = Math.round(ft * (110 + rnd() * 80));
            sets.push({ at, opp: pick(opps), game: 'SFIII 3rd Strike', channel, rom, result: won ? 'won' : 'lost',
                mine: won ? ft : loser, theirs: won ? loser : ft, quark: 'demo' + (q++), ft, startedAt: at - durSec * 1000, durSec,
                oppRank, myRank, ping, emu: 'fbneo', myChar: crnd() < 0.8 ? 'Akuma' : 'Ken', oppChar: CAST[Math.floor(crnd() * crnd() * CAST.length)] });
        };
        for (let d = 45; d >= 1; d--) {
            if (rnd() < 0.3) continue;
            const myRank = d > 30 ? 3 : d > 14 ? 4 : 5;
            const start = now - d * DAY - (rnd() * 6 + 1) * 3600e3;
            const n = 2 + Math.floor(rnd() * 6);
            for (let i = 0; i < n; i++) addSet(start + i * 14 * 60e3, myRank, 0.48 + (45 - d) * 0.004);
        }
        // tonight
        for (let i = 6; i >= 1; i--) addSet(now - i * 16 * 60e3, 5, 0.62);
        files['./match-history.json'] = JSON.stringify({ v: 2, sets });

        const points = [];
        for (let d = 45; d >= 0; d--) {
            const t = (45 - d) / 45;
            const elo = Math.round(1080 + t * 560 + (rnd() - 0.5) * 50);
            points.push({ at: now - d * DAY, rom, rank: elo < 1300 ? 3 : elo < 1550 ? 4 : 5, elo, est: false,
                matches: 800 + (45 - d) * 14, pos: Math.max(48, Math.round(240 - t * 190 + (rnd() - 0.5) * 12)) });
        }
        files['./rank-history.json'] = JSON.stringify({ v: 1, points });
        // the settings screen: the released version, and module files to list (empty stand-ins)
        files['./fightcord.json'] = JSON.stringify({ version: '2.0.0', off: ['snapshot.js'] });
        ['fightcord-core.js', 'discord-theme.js', 'branding.js', 'discover.js', 'chat-extras.js', 'translate.js', 'emoji.js', 'fontstyle.js',
            'member-list.js', 'scout.js', 'challenge-filters.js', 'match-screens.js', 'stats.js', 'analytics.js', 'progress.js', 'goals.js',
            'feed.js', 'welcome.js', 'friends.js', 'notes.js', 'challenge-card.js', 'channel-banner.js', 'hover-cards.js', 'profile-card.js',
            'context-menu.js', 'inbox.js', 'backgrounds.js', 'music.js', 'discord-rpc.js', 'snapshot.js'].forEach(f => { if (!(('./' + f) in files)) files['./' + f] = ''; });
        files['./goals-config.json'] = JSON.stringify({ goals: [
            { id: 'g1', type: 'wins', target: 5, scope: 'day' },
            { id: 'g2', type: 'beatRank', target: 2, scope: 'week', rank: 'A' },
            { id: 'g3', type: 'minutes', target: 90, scope: 'day' }], notify: true, pill: true, summary: true, done: {}, summarized: now });
    };

    // original names still visible anywhere on the live page (text, attributes, our own UI)
    window.__demoLeaks = function () {
        // everything a viewer could see or inspect, minus scripts and inline image data
        const parts = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('script, style')) parts.push(walker.currentNode.textContent);
        document.body.querySelectorAll('*').forEach(el => {
            if (el.closest('script')) return;
            [...el.attributes].forEach(at => { if (!/^data:/.test(at.value) && at.name !== 'class') parts.push(at.value); });
        });
        const all = parts.join('\n');
        const out = originals.filter(n => !COMMON.has(n.toLowerCase()) && new RegExp('(^|[^A-Za-z0-9_])' + esc(n) + '(?![A-Za-z0-9_])').test(all));
        const grav = [...realHashes].filter(h => all.indexOf(h) >= 0);
        return out.concat(grav.map(h => 'avatar hash ' + h));
    };
    // handles that are also ordinary words shown by Fightcade itself
    const COMMON = new Set(['online', 'away', 'playing', 'chat', 'ranked', 'casual', 'search', 'home', 'events', 'rules', 'player', 'players']);
})();
