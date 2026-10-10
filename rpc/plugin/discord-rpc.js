// Fightcade Discord RPC — self-contained plugin
// Runs entirely inside Fightcade's Electron process. No external bridge needed.
// Install to inject/plugins/ (with node_modules/) and restart Fightcade.
//
// Works with both plugin loaders:
//   • Fightcade's built-in one, which calls  require('discord-rpc.js')(FCADE)
//   • the older bare  require('discord-rpc.js')  (we self-start as a fallback)
(function () {
  'use strict';

  var CLIENT_ID = '1516809115601604669';
  var POLL_MS   = 2500;
  var RETRY_MS  = 20000;

  // Discord throttles SET_ACTIVITY (roughly 5 per 20s). Meaningful changes
  // (match start/end, opponent, score) go out quickly; cosmetic churn such as
  // the lobby player count is coalesced so we never burn the budget on it.
  var MIN_MAJOR_MS = 4000;
  var MIN_MINOR_MS = 20000;

  // tasklist is only needed to spot spectating (emulator open, no quark of our
  // own). While playing we already know, so we skip the spawn entirely.
  var PROC_CACHE_MS = 5000;

  // Live set score comes from Fightcade's own web API. It sits behind
  // Cloudflare, so poll gently and back off hard on any failure.
  var FC_API        = 'https://web.fightcade.com/api/';
  var SCORE_POLL_MS = 15000;
  var SCORE_MAX_BACKOFF = 8;      // multiples of SCORE_POLL_MS

  var RPC = require('discord-rpc');
  var cp  = (function () { try { return require('child_process'); } catch (e) { return null; } })();
  var fsm = (function () { try { return require('fs');   } catch (e) { return null; } })();
  var pth = (function () { try { return require('path'); } catch (e) { return null; } })();

  // Optional settings file, sits next to this plugin. All keys are optional.
  //   { "showScore": true, "showRanks": true, "showNames": true, "showSession": true, "showCharacters": true, "debug": false }
  var cfg = { showScore: true, showRanks: true, showNames: true, showSession: true, showCharacters: true, debug: false };
  (function loadConfig() {
    if (!fsm || !pth || typeof __dirname === 'undefined') return;
    try {
      var f = pth.join(__dirname, 'discord-rpc-config.json');
      if (!fsm.existsSync(f)) return;
      var raw = JSON.parse(fsm.readFileSync(f, 'utf8'));
      for (var k in cfg) if (typeof raw[k] === 'boolean') cfg[k] = raw[k];
    } catch (e) {
      console.warn('[FC Discord RPC] Ignoring bad discord-rpc-config.json:', e.message);
    }
  })();

  // With "debug": true the score lookup writes what it saw to
  // discord-rpc-debug.log next to the plugin — no DevTools needed.
  function dbg(msg) {
    if (!cfg.debug) return;
    console.log('[FC Discord RPC]', msg);
    if (!fsm || !pth || typeof __dirname === 'undefined') return;
    try {
      fsm.appendFileSync(pth.join(__dirname, 'discord-rpc-debug.log'),
                         new Date().toISOString() + '  ' + msg + '\r\n');
    } catch (e) {}
  }

  var TASKLIST = (function () {
    var root = (process && process.env && process.env.SystemRoot) ? process.env.SystemRoot : 'C:\\Windows';
    return '"' + root + '\\System32\\tasklist.exe"';
  })();

  var EMULATOR_EXES = ['fcadefbneo.exe', 'flycast.exe', 'fcadesnes9x.exe', 'ggpofba-ng.exe', 'fcv39.exe'];

  var rpc        = null;
  var rpcReady   = false;
  var connecting = false;
  var retryTimer = null;

  var lastSentKey   = '';       // full activity signature actually sent
  var lastSentMajor = '';       // same, minus the volatile bits
  var lastSentAt    = 0;

  var prevActive = false;       // were we playing/spectating last tick
  var prevQuark  = null;        // quark of the match we're timing
  var startTime  = null;        // when current match/spectate began

  // ── Discord connection ──────────────────────────────────────────────────────

  // discord-rpc clients are single-use: once the IPC socket drops the client is
  // destroyed and cannot log in again, so every attempt gets a fresh one.
  function scheduleReconnect() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () { retryTimer = null; tryConnect(); }, RETRY_MS);
  }

  function tryConnect() {
    if (connecting || rpcReady) return;
    connecting = true;

    var client = new RPC.Client({ transport: 'ipc' });
    client.on('error', function () {});            // socket errors must not reject unhandled

    client.on('ready', function () {
      console.log('[FC Discord RPC] Connected as', client.user && client.user.username);
      rpcReady   = true;
      connecting = false;
      // Force the next poll to publish: Discord dropped whatever we set before.
      lastSentKey = lastSentMajor = '';
      lastSentAt  = 0;
    });

    client.on('disconnected', function () {
      if (rpc !== client) return;
      rpcReady   = false;
      connecting = false;
      scheduleReconnect();
    });

    rpc = client;
    client.login({ clientId: CLIENT_ID }).catch(function () {
      connecting = false;
      rpcReady   = false;
      try { client.destroy(); } catch (e) {}
      scheduleReconnect();
    });
  }

  // ── Emulator process detection (distinguishes "emulator open" overall) ──────

  var procCache = { at: 0, open: false };

  function emulatorOpen(cb) {
    if (!cp) { cb(false); return; }
    var now = Date.now();
    if (now - procCache.at < PROC_CACHE_MS) { cb(procCache.open); return; }

    cp.exec(TASKLIST + ' /fo csv /nh', { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, function (err, stdout) {
      var open = false;
      if (!err && stdout) {
        var lines = stdout.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var m = /^"([^"]+)"/.exec(lines[i].trim());
          if (m && EMULATOR_EXES.indexOf(m[1].toLowerCase()) !== -1) { open = true; break; }
        }
      }
      procCache = { at: Date.now(), open: open };
      cb(open);
    });
  }

  // ── Live set score (Fightcade web API) ──────────────────────────────────────

  // searchquarks returns the quark we're currently in, including each player's
  // running score and the number of games played. Requesting it from inside the
  // renderer reuses Fightcade's own browser session, which is what gets us past
  // Cloudflare — the same call from a plain HTTP client is challenged.
  var score = { quark: null, mine: null, theirs: null, games: 0, at: 0, fails: 0, busy: false };

  function resetScore(quark) {
    score = { quark: quark, mine: null, theirs: null, games: 0, at: 0, fails: 0, busy: false };
  }

  function refreshScore(quarkId, myName, oppName) {
    if (!cfg.showScore || !quarkId || typeof fetch !== 'function') return;
    if (score.quark !== quarkId) resetScore(quarkId);
    if (score.busy) return;

    var backoff = Math.min(SCORE_MAX_BACKOFF, Math.pow(2, score.fails));
    if (score.at && Date.now() - score.at < SCORE_POLL_MS * backoff) return;

    score.busy = true;
    score.at   = Date.now();

    var done = function (ok) {
      score.busy  = false;
      score.fails = ok ? 0 : score.fails + 1;
    };

    var status = 0;
    fetch(FC_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ req: 'searchquarks', quarkid: quarkId })
    }).then(function (r) {
      status = r.status;
      return r.text();                       // read as text so we can spot a Cloudflare page
    }).then(function (body) {
      if (body.trim().charAt(0) === '<') {   // Cloudflare challenge, not JSON
        dbg('score: blocked by Cloudflare (HTTP ' + status + ')');
        done(false);
        return;
      }
      var j   = JSON.parse(body);
      var row = j && j.results && j.results.results && j.results.results[0];
      if (!row || !row.players) {
        dbg('score: quark ' + quarkId + ' not listed (HTTP ' + status + ', res=' + (j && j.res) + ')');
        done(false);
        return;
      }
      if (score.quark !== quarkId) { done(false); return; }   // match changed under us

      var mine = null, theirs = null;
      for (var i = 0; i < row.players.length; i++) {
        var p = row.players[i];
        if (!p || typeof p.score !== 'number') continue;
        if (p.name === myName)       mine   = p.score;
        else if (p.name === oppName) theirs = p.score;
        else if (theirs === null && p.name !== myName) theirs = p.score;
      }
      score.mine   = mine;
      score.theirs = theirs;
      score.games  = row.num_matches || 0;
      dbg('score: ' + quarkId + ' games=' + score.games + ' -> ' +
          myName + '=' + mine + ' ' + oppName + '=' + theirs +
          (mine === null || theirs === null
            ? '  (null = API has no score yet; players in row: ' +
              row.players.map(function (q) { return q.name + ':' + q.score; }).join(', ') + ')'
            : ''));
      done(true);
    }).catch(function (e) {
      dbg('score: request failed (HTTP ' + status + '): ' + (e && e.message));
      done(false);
    });
  }

  // ── Vue state extraction ────────────────────────────────────────────────────

  function waitForVue(cb) {
    var el = document.querySelector('#app');
    if (el && el.__vue__ && el.__vue__._data && el.__vue__._data.global && el.__vue__._data.global.setTheme) {
      cb(el.__vue__);
    } else {
      setTimeout(function () { waitForVue(cb); }, 500);
    }
  }

  function extractState(FCADE) {
    var data      = FCADE._data;
    var localUser = data && data.global && data.global.localUser;
    if (!localUser) return null;

    var myName      = localUser.name;
    var channelId   = FCADE.activeChannelId;
    var channels    = FCADE.channels || [];
    var globalUsers = FCADE.globalUsers || {};

    var activeChannel = null;
    for (var i = 0; i < channels.length; i++) {
      if (channels[i].id === channelId) { activeChannel = channels[i]; break; }
    }

    // Player count + per-user rank components in the active channel
    var channelRef  = FCADE.$refs && FCADE.$refs[channelId];
    var channelComp = Array.isArray(channelRef) ? channelRef[0] : channelRef;
    var usersList   = channelComp && channelComp.$refs && channelComp.$refs.usersList;
    var children    = (usersList && usersList.$children) || [];
    var userCount   = children.length;

    // Map both id and name -> rank-list child component; `globalUsers` is keyed
    // by name while the components carry an id, and the two need not match.
    var childByUser = {};
    for (var c = 0; c < children.length; c++) {
      var cu = children[c] && children[c].user;
      if (!cu) continue;
      if (cu.id)   childByUser[cu.id]   = children[c];
      if (cu.name) childByUser[cu.name] = children[c];
    }

    // Am I playing? My own user object carries a `playing` quark when in a match.
    var me        = globalUsers[myName];
    var myPlaying = me && me.playing;          // { quarkId, gameId, channelId, port } or undefined
    var oppName   = null;
    var oppUser   = null;

    if (myPlaying && myPlaying.quarkId) {
      // Opponent = the other user sharing my quarkId
      var names = Object.keys(globalUsers);
      for (var k = 0; k < names.length; k++) {
        if (names[k] === myName) continue;
        var other = globalUsers[names[k]];
        if (other && other.playing && other.playing.quarkId === myPlaying.quarkId) {
          oppName = names[k];                  // key into globalUsers — keep it intact
          oppUser = other;
          break;
        }
      }
    }

    var chanName = (activeChannel && activeChannel.name) || channelId;

    return {
      username:    myName,
      channelName: chanName,
      playerCount: activeChannel ? (activeChannel.num || userCount) : userCount,
      playing:     !!(myPlaying && myPlaying.quarkId),
      quarkId:     (myPlaying && myPlaying.quarkId) || null,
      opponent:    oppUser ? (oppUser.name || oppName) : null,
      gameId:      myPlaying && myPlaying.gameId,
      myRank:      rankLetter(childByUser[myName] || childByUser[me && me.id], me, chanName),
      oppRank:     oppUser ? rankLetter(childByUser[oppName] || childByUser[oppUser.id], oppUser, chanName) : null
    };
  }

  // ── Rank resolution ─────────────────────────────────────────────────────────

  // channelRank number -> letter (0/undefined = unranked). Verified against live
  // data, and it matches the scale Fightcade's own web API uses
  // (6=S 5=A 4=B 3=C 2=D 1=E). In practice this numeric field is the reliable
  // source — the component tooltips below are usually empty.
  var RANK_MAP = ['', 'E', 'D', 'C', 'B', 'A', 'S'];

  function rankLetter(child, user, channelName) {
    // 1. Numeric channelRank for this channel — the field that's actually populated
    var num = user && user.channelRank && channelName ? user.channelRank[channelName] : undefined;
    if (typeof num === 'number' && RANK_MAP[num]) return RANK_MAP[num];
    // 2. Fall back to Fightcade's own computed tooltip (e.g. "B")
    var title = child && child.rankTitle;
    if (title) {
      var m = /\b([SABCDE])\b/.exec(String(title));
      if (m) return m[1];
    }
    // 3. Or parse the rank icon filename (e.g. ".../ranks/b.png")
    var src = child && child.rankSrc;
    if (src) {
      var m2 = /[\/_-]([sabcde])[._-]/i.exec(String(src));
      if (m2) return m2[1].toUpperCase();
    }
    return null;
  }

  // ── Per-game artwork ─────────────────────────────────────────────────────────

  // Maps a game to a Discord asset key. The image must be uploaded to the Discord
  // app's Art Assets under that exact key. Add more games by adding rows here.
  var GAME_ASSETS = [
    { key: 'sfiii3', match: /sfiii3|3rd ?strike/i }
    // { key: 'kof98',   match: /kof ?98|king of fighters '?98/i },
    // { key: 'kof2002', match: /kof ?2002|king of fighters 2002/i },
  ];

  function gameAssetKey(channelName, gameId) {
    var hay = ((gameId || '') + ' ' + (channelName || '')).toLowerCase();
    for (var i = 0; i < GAME_ASSETS.length; i++) {
      if (GAME_ASSETS[i].match.test(hay)) return GAME_ASSETS[i].key;
    }
    return 'fightcade_logo';
  }

  // ── Activity builder ────────────────────────────────────────────────────────

  function cleanGameName(raw) {
    return (raw || 'Fightcade').replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  // "Name (B · Akuma)": the rank and, once known, the character
  function tag(name, rank, ch) {
    var bits = [];
    if (cfg.showRanks && rank) bits.push(rank);
    if (ch) bits.push(ch);
    return name + (bits.length ? ' (' + bits.join(' · ') + ')' : '');
  }

  // ── The emulator's own match files ─────────────────────────────────────────
  // Fightcade's FBNeo writes the running match to <Fightcade>/emulator/fbneo/fightcade/*.txt
  // for stream overlays: both names, scores and characters, kept until the next match. This
  // plugin sits in <Fightcade>/fc2-electron/resources/app/inject/<folder>/. Read at most once a second.
  var emuFiles = { at: 0, data: null };
  function readEmu(quarkId) {
    if (!fsm || !pth || typeof __dirname === 'undefined' || !quarkId) return null;
    if (Date.now() - emuFiles.at > 1000) {
      emuFiles.at = Date.now();
      var dir = pth.resolve(__dirname, '..', '..', '..', '..', '..', 'emulator', 'fbneo', 'fightcade');
      var rd = function (n) {
        try { return String(fsm.readFileSync(pth.join(dir, n + '.txt'), 'utf8')).replace(/^\uFEFF/, '').trim(); }
        catch (e) { return ''; }
      };
      var q = rd('gamequark').replace(/\.\d+$/, '');     // the emulator writes "<quark>.0"
      emuFiles.data = q ? {
        quark: q,
        p1: { name: rd('p1name'), score: rd('p1score'), ch: rd('p1character') },
        p2: { name: rd('p2name'), score: rd('p2score'), ch: rd('p2character') }
      } : null;
    }
    var d = emuFiles.data;
    return d && d.quark === String(quarkId) ? d : null;
  }
  // { mine, theirs } from the files when this match is in them and you're one of the players
  function emuSides(state) {
    var d = readEmu(state.quarkId);
    if (!d) return null;
    var me = String(state.username || '').toLowerCase();
    if (d.p1.name.toLowerCase() === me) return { mine: d.p1, theirs: d.p2 };
    if (d.p2.name.toLowerCase() === me) return { mine: d.p2, theirs: d.p1 };
    return null;
  }
  var isNum = function (s) { return /^\d+$/.test(String(s)); };

  // "⚔  You (Akuma)  3 - 1  Rival (Yang)": the emulator's score (instant) or the web API's,
  // characters once the emulator shows them
  function matchLine(state) {
    var es = state.playing ? emuSides(state) : null;
    var sc = null;
    if (cfg.showScore && es && isNum(es.mine.score) && isNum(es.theirs.score)) sc = [es.mine.score, es.theirs.score];
    else if (haveScore()) sc = [score.mine, score.theirs];
    var chMe = cfg.showCharacters && es ? es.mine.ch : '', chOpp = cfg.showCharacters && es ? es.theirs.ch : '';
    if (!state.opponent || !cfg.showNames) {
      // names hidden: the characters and the score still say plenty
      if (chMe && chOpp) return '⚔  ' + chMe + (sc ? '  ' + sc[0] + ' - ' + sc[1] + '  ' : ' vs ') + chOpp;
      return sc ? '⚔  ' + sc[0] + ' - ' + sc[1] : '⚔  In Match';
    }
    var me  = tag(state.username, state.myRank, chMe);
    var opp = tag(state.opponent, state.oppRank, chOpp);
    var mid = sc ? '  ' + sc[0] + ' - ' + sc[1] + '  ' : ' vs ';
    return '⚔  ' + me + mid + opp;
  }

  function haveScore() {
    return cfg.showScore && score.quark !== null &&
           typeof score.mine === 'number' && typeof score.theirs === 'number';
  }

  // ── Tonight's record ("· 7–3 tonight") ─────────────────────────────────────
  // match-screens.js records every set in match-history.json next to this plugin.
  // Same session rule as its tracker: 5 AM to 5 AM, or since "Clear session".
  // Re-read only when the file changes.
  var session = { mtime: -1, clearedMtime: -1, cleared: 0, sets: [] };

  function sessionText() {
    if (!cfg.showSession || !fsm || !pth || typeof __dirname === 'undefined') return '';
    try {
      var hf = pth.join(__dirname, 'match-history.json');
      var st = fsm.statSync(hf);
      if (st.mtimeMs !== session.mtime) {
        var h = JSON.parse(fsm.readFileSync(hf, 'utf8'));
        session.sets = (h && h.sets) || [];
        session.mtime = st.mtimeMs;
      }
      var cf = pth.join(__dirname, 'match-screens-config.json');
      if (fsm.existsSync(cf)) {
        var cst = fsm.statSync(cf);
        if (cst.mtimeMs !== session.clearedMtime) {
          session.cleared = +(JSON.parse(fsm.readFileSync(cf, 'utf8')).sessionClearedAt || 0);
          session.clearedMtime = cst.mtimeMs;
        }
      }
    } catch (e) { return ''; }        // no history yet
    var now = new Date();
    var five = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 5, 0, 0, 0).getTime();
    var start = Math.max(now.getHours() < 5 ? five - 86400000 : five, session.cleared);
    var w = 0, l = 0, d = 0;
    for (var i = 0; i < session.sets.length; i++) {
      var s = session.sets[i];
      if (!s || s.at < start) continue;
      if (s.result === 'won') w++; else if (s.result === 'lost') l++; else if (s.result === 'draw') d++;
    }
    if (!w && !l && !d) return '';
    return w + '–' + l + (d ? '–' + d : '') + ' tonight';
  }

  function buildActivity(state, emuOpen) {
    var gameName = cleanGameName(state.channelName);
    var tonight  = sessionText();
    var spectating = emuOpen && !state.playing;
    var details, stateText, smallKey, smallText, ts;

    if (state.playing) {
      details   = gameName;
      stateText = matchLine(state);
      smallKey  = 'match'; smallText = 'In Match';
      ts        = startTime ? new Date(startTime) : undefined;
    } else if (spectating) {
      details   = gameName;
      stateText = '👁  Spectating';
      smallKey  = 'spectate'; smallText = 'Spectating';
      ts        = startTime ? new Date(startTime) : undefined;
    } else {
      var c     = typeof state.playerCount === 'number' ? state.playerCount : 0;
      details   = gameName;
      stateText = '🕹  Lobby · ' + c + ' player' + (c !== 1 ? 's' : '');
      smallKey  = 'lobby'; smallText = 'In Lobby';
    }

    // Large image: the game's logo while playing/spectating, Fightcade logo otherwise
    var largeKey = (state.playing || spectating)
      ? gameAssetKey(state.channelName, state.gameId)
      : 'fightcade_logo';

    if (tonight) details = details + ' · ' + tonight;

    var activity = {
      details:        details.slice(0, 128),
      state:          stateText.slice(0, 128),
      largeImageKey:  largeKey,
      largeImageText: gameName.slice(0, 128),
      smallImageKey:  smallKey,
      smallImageText: smallText,
      instance:       false
    };
    if (ts) activity.startTimestamp = ts;

    // Signature ignoring the lobby player count, which ticks constantly and is
    // not worth spending a rate-limit slot on. A score change IS worth one.
    activity.__major = [largeKey, smallKey, details,
                        state.playing ? stateText : smallText,
                        ts ? ts.getTime() : 0].join('|');
    return activity;
  }

  function publish(activity) {
    var major = activity.__major;
    delete activity.__major;

    var key = JSON.stringify(activity);
    if (key === lastSentKey) return;

    var elapsed  = Date.now() - lastSentAt;
    var required = (major !== lastSentMajor) ? MIN_MAJOR_MS : MIN_MINOR_MS;
    if (elapsed < required) return;              // coalesce; the next poll retries

    lastSentKey   = key;
    lastSentMajor = major;
    lastSentAt    = Date.now();
    rpc.setActivity(activity).catch(function () {});
  }

  // ── Main poll loop ──────────────────────────────────────────────────────────

  var started = false;

  function start(FCADE) {
    if (started) return;
    started = true;
    console.log('[FC Discord RPC] Plugin ready');
    tryConnect();

    function poll() {
      var state = extractState(FCADE);

      // Playing implies the emulator is up, so skip the process spawn entirely.
      var checkProc = (state && state.playing)
        ? function (cb) { cb(true); }
        : emulatorOpen;

      checkProc(function (emuOpen) {
        if (!state) { setTimeout(poll, POLL_MS); return; }

        var active = state.playing || emuOpen;   // in a match or spectating
        // Restart the timer on a new match too, not just after going idle —
        // back-to-back matches can keep the emulator open throughout.
        if ((active && !prevActive) || (state.quarkId && state.quarkId !== prevQuark)) {
          startTime = Date.now();
        }
        if (!active) startTime = null;
        prevActive = active;
        prevQuark  = state.quarkId;

        var es = state.playing ? emuSides(state) : null;
        if (state.playing && !(es && isNum(es.mine.score))) refreshScore(state.quarkId, state.username, state.opponent);
        else if (score.quark) resetScore(null);

        if (rpcReady && rpc) publish(buildActivity(state, emuOpen));
        setTimeout(poll, POLL_MS);
      });
    }
    poll();
  }

  // Fightcade's built-in loader calls us with the Vue root.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = function (FCADE) {
      if (FCADE) start(FCADE); else waitForVue(start);
    };
  }

  // Fallback for the older loader that only require()s the file: if nobody has
  // called us shortly after load, start ourselves.
  setTimeout(function () { if (!started) waitForVue(start); }, 5000);

})();
