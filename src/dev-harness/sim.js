/**
 * Harness simulations: make the fake Fightcade do things, to test plugins against.
 * Loaded by snapshot.html after its FCADE stub, before the plugins. From the console:
 *
 *   __sim.challenge('KenjiRival', { ranked: 5 })   incoming challenge (through Fightcade's callback)
 *   __sim.clearChallenge(id)                     Fightcade clears it (accepted / declined / cancelled)
 *   __sim.matchStart('A', 'B')  -> quark         two players start a match
 *   __sim.matchEnd(quark)                        and finish it
 *   __sim.meMatch('Opp') / __sim.meMatchEnd()    you start / finish one
 *   __sim.join('NewGuy', { rank: 6 })            someone joins your channel
 *   __sim.leave('NewGuy') / __sim.away('X', true)
 *   __sim.chat('Name', 'hello', n)               n chat lines appended to the open channel
 *   __sim.users()                                the names in globalUsers
 */
(function () {
    const F = () => window.FCADE;
    const users = () => (F() && F().globalUsers) || {};
    const me = () => F()._data.global.localUser.name;
    const joined = () => (F().channels.find(c => c.name) || {}).name || 'Street Fighter III 3rd Strike: Fight for the Future (Japan 990512, NO CD)';
    let seq = 1;

    const sim = {
        users: () => Object.keys(users()),

        challenge(name, o) {
            const p = o || {};
            const id = 'sim' + (seq++);
            const u = users()[name] || { name, id: name };
            F().connectionCallbacks.onChallengeRequest(Object.assign({ name, id: name }, u, { name }), p.channel || joined(), id, p.ranked == null ? 3 : p.ranked);
            return id;
        },
        clearChallenge(id, why) {
            F().removeChallengeNotifications && F().removeChallengeNotifications({}, joined(), id, why || 'cancel');
        },

        matchStart(a, b, o) {
            const quark = (o && o.quark) || ('simq' + (seq++));
            const ch = joined();
            const gameId = (F().channels.find(c => c.name === ch) || {}).gameid || 'sfiii3nr1';
            const port = 7100 + seq;
            [a, b].forEach(n => {
                const u = users()[n] || (users()[n] = { channels: [ch], channelRank: { [ch]: 3 }, country: { iso_code: 'us' } });
                u.playing = { quarkId: quark, channelId: ch, gameId, port };
            });
            return quark;
        },
        matchEnd(quark) {
            Object.keys(users()).forEach(n => { const u = users()[n]; if (u.playing && u.playing.quarkId === quark) u.playing = undefined; });
        },
        meMatch(opp) { return (sim._mine = sim.matchStart(me(), opp || sim.users().find(n => n !== me()))); },
        meMatchEnd() { if (sim._mine) sim.matchEnd(sim._mine); sim._mine = null; },
        // snapshot.html?login=1: log in (the lobby comes back)
        login() { if (window.__simLogin) window.__simLogin(); },

        join(name, o) {
            const p = o || {};
            const ch = joined();
            users()[name] = { channels: [ch], channelRank: { [ch]: p.rank || 3 }, country: { iso_code: p.cc || 'jp' }, ping: p.ping || 80 };
            return name;
        },
        leave(name) { delete users()[name]; },
        away(name, on) { if (users()[name]) users()[name].away = on !== false; },

        // a Fightcade event on the home page, starting in n minutes (for the reminders)
        event(name, inMinutes, o) {
            const p = o || {};
            const ch = p.channel || joined();
            const gameid = p.gameid || (F().channels.find(c => c.name === ch) || {}).gameid || 'sfiii3nr1';
            const ev = { name, date: Date.now() + (inMinutes || 0) * 60000, region: p.region || 'EU', link: p.link || 'https://example.com/event', image: '', gameid, channel: { name: ch } };
            const w = F().$refs['welcome-channel'];
            let sec = (w.results || []).find(s => s && s.title === 'Events');
            if (!sec) { sec = { title: 'Events', events: [] }; w.results = (w.results || []).concat([sec]); }
            sec.events.push(ev);
            return ev;
        },

        // Fightcade's playing event with an exact ELO (what Patreon supporters get); start = match began
        elo(name, value, start, rank) {
            const ch = joined();
            const gameId = (F().channels.find(c => c.name === ch) || {}).gameid || 'sfiii3nr1';
            F().onUserPlayingStateChanges(name || me(), start !== false, ch, 'simq' + (seq++), gameId, 1, 7000, 1, value, rank, [0, 0]);
            return gameId;
        },

        // clones the last chat line of the open channel n times
        chat(name, text, n) {
            const cc = document.querySelector('.channelWrapper:not([style*="none"]) .chatContent') || document.querySelector('.chatContent');
            const last = cc && [...cc.querySelectorAll('.messageWrapper')].pop();
            if (!last) return 0;
            for (let i = 0; i < (n || 1); i++) {
                const c = last.cloneNode(true);
                const nm = c.querySelector('.name, .username, .user');
                if (nm && name) nm.textContent = name;
                const body = c.querySelector('.blocksContainer, .content, .text');
                if (body && text) body.textContent = text + (n > 1 ? ' #' + (i + 1) : '');
                last.parentNode.appendChild(c);
            }
            cc.scrollTop = cc.scrollHeight;
            return n || 1;
        }
    };
    window.__sim = sim;
})();
