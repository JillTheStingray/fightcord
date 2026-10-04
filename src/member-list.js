/**
 * Fightcord member list, Discord style
 *
 *   - "Looking to play" grouped by rank like Discord roles (Rank S — 2, Rank A — 7, …)
 *     with rank-coloured names, plus "Playing now" and "Friends" sections on top
 *   - a Discord status line under each name: flag, country, ping, Wi-Fi/VPN
 *   - ping as green/yellow/red signal bars
 *   - filter chips (rank, < 100 ms, my region) and sort (name / ping / top)
 *   - ⚔ 3–1 on players you've recently played, #12 on the game's leaderboard
 *
 * Local only. Rows are regrouped with CSS `order` and marked with classes -- Fightcade's
 * own elements are never moved, and nothing here reacts to clicks on a player row
 * (Fightcade's Challenge menu opens on mousedown there).
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // member-list-config.json

const DEFAULTS = {
    enabled: true,
    group: true,          // rank groups in "Looking to play"
    rankColors: true,     // names in their rank colour
    bars: true,           // signal bars instead of ping text
    played: true,         // ⚔ W–L on people you've played
    top: true,            // #12 leaderboard spot next to the name
    activity: true,       // "Playing now" + "Friends" sections on top
    filter: { ranks: [], lowPing: false, region: false },
    sort: 'name'          // name | ping | top
};

const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const N_ = (s) => s;
// continents, translated where shown: N_('Europe') N_('North America') N_('South America') N_('Asia') N_('Africa') N_('Oceania')
const mod = (id) => fc.modules.get(id);

/* ------------------------------------------------------------------ regions */

// ISO 3166 alpha-2 -> continent, for the "My region" filter (and challenge filters)
const CONTINENTS = {
    Europe: 'ad al at ax ba be bg by ch cy cz de dk ee es fi fo fr gb gg gi gr hr hu ie im is it je li lt lu lv mc md me mk mt nl no pl pt ro rs ru se si sk sm ua va xk',
    'North America': 'us ca mx gt bz sv hn ni cr pa cu do ht jm pr bs bb tt ag dm gd kn lc vc aw cw bq sx bm ky tc vg vi gl pm mq gp ms ai bl mf',
    'South America': 'ar bo br cl co ec fk gf gy pe py sr uy ve',
    Asia: 'af am az bh bd bt bn kh cn ge hk in id ir iq il jp jo kz kw kg la lb mo my mv mn mm np kp om pk ps ph qa sa sg kr lk sy tw tj th tl tr tm ae uz vn ye',
    Africa: 'dz ao bj bw bf bi cm cv cf td km cg cd ci dj eg gq er et ga gm gh gn gw ke ls lr ly mg mw ml mr mu ma mz na ne ng rw st sn sc sl so za ss sd sz tz tg tn ug zm zw eh re yt sh',
    Oceania: 'au nz fj pg sb vu nc pf ws to ki fm mh pw nr tv ck nu gu mp as'
};
const CONTINENT_OF = {};
Object.keys(CONTINENTS).forEach(c => CONTINENTS[c].split(' ').forEach(cc => { CONTINENT_OF[cc] = c; }));
const continentOf = (cc) => CONTINENT_OF[String(cc || '').toLowerCase()] || null;

function myContinent() {
    const u = fc.app.user(fc.app.me())[1];
    return u && u.country && u.country.iso_code ? continentOf(u.country.iso_code) : null;
}

/* ----------------------------------------------------------------- row data */

const RANKS = ['S', 'A', 'B', 'C', 'D', 'E', '?'];

// leaderboard spots per game (fc.api's shared leaderboard, cached there)
const boardAsked = new Map();      // rom -> time asked
function boardFor(rom) {
    if (!rom || !cfg.top) return null;
    const have = fc.api.cachedBoard(rom);
    if (!have && Date.now() - (boardAsked.get(rom) || 0) > 10 * 60000) {
        boardAsked.set(rom, Date.now());
        fc.api.leaderboard(rom).then(() => sweep()).catch(() => {});
    }
    return have;
}

function listRom(el) {
    const cw = el.closest('.channelWrapper');
    const rom = cw && cw.querySelector('.channelInfo .name[title="Rom name"]');
    return rom ? rom.textContent.trim() : '';
}

function rowInfo(item, board) {
    const nameEl = item.querySelector('.playerName');
    const name = item.dataset.currentUser || (nameEl && (nameEl.getAttribute('title') || nameEl.textContent.trim())) || '';
    const rankImg = item.querySelector('.rankWrapper img.rank');
    const rm = ((rankImg && rankImg.getAttribute('title')) || '').match(/rank\s+([SABCDE])\b/i);
    const flag = item.querySelector('.flagWrapper');
    const flagCss = flag ? flag.style.backgroundImage || '' : '';
    const u = fc.app.users()[name];
    const cc = ((flagCss.match(/flags\/([a-z]{2})\./i) || [])[1] || (u && u.country && u.country.iso_code) || '').toLowerCase();

    // Fightcade's own numbers first (what its ping tooltip is built from), then what's on the row
    let ping = u && typeof u.ping === 'number' && u.ping > 0 ? u.ping : null;
    if (ping == null) {
        const pingImg = item.querySelector('.pingWrapper img.ping');
        const t = (pingImg && pingImg.getAttribute('title')) || '';
        const m = t.match(/~\s*(\d+)\s*ms/) || t.match(/(\d+)\s*ms/);
        ping = m ? +m[1] : null;
    }
    const net = u && u.proxy ? 'VPN' : u && u.wlan ? 'Wi-Fi' : '';
    const spot = board && name ? board.get(name.toLowerCase()) : null;
    return {
        name, rank: rm ? rm[1].toUpperCase() : '?',
        country: (flag && flag.getAttribute('title')) || (u && u.country && u.country.full_name) || '',
        flagCss, cc, ping, net, top: spot ? spot.pos : null,
        playing: u && u.playing && u.playing.quarkId ? u.playing : null
    };
}

/* ---------------------------------------------------------------- rendering */

let opponents = new Map();   // lowercased name -> {w, l, sets, last}

function pingLevel(ms) {
    if (ms == null || isNaN(ms)) return 'unk';
    return ms < 100 ? 'good' : ms < 180 ? 'ok' : 'bad';
}

// a small element right after the name (created once, kept in place)
function afterName(nag, cls, anchorSel) {
    let el = nag.querySelector(':scope > .' + cls);
    if (!el) {
        el = document.createElement('span');
        el.className = cls;
        const anchor = (anchorSel && nag.querySelector(anchorSel)) || nag.querySelector('.playerName');
        if (anchor) anchor.insertAdjacentElement('afterend', el); else nag.appendChild(el);
    }
    return el;
}

function renderRow(item, info) {
    item.classList.add('fcm-row');
    if (item.dataset.fcmRank !== info.rank) item.dataset.fcmRank = info.rank;

    const vs = cfg.played ? opponents.get(info.name.toLowerCase()) : null;
    // Fightcade can add/remove a "Playing …" line at any time -- part of the signature, so it's noticed
    const gameEl = item.querySelector('.nameAndGame .game');
    const gameTxt = gameEl ? gameEl.textContent.trim() : '';
    const fr = mod('friends');
    const friend = !!(fr && fr.isFriend && fr.isFriend(info.name));
    const nt = mod('notes');
    const noteDots = nt && nt.dots ? nt.dots(info.name) : '';
    const live = cfg.activity ? liveLine(info) : '';
    const sig = [info.country, info.flagCss, info.ping, info.net, info.top, cfg.bars ? 1 : 0, gameTxt, friend ? 'F' : '', noteDots, live,
        vs ? vs.w + '-' + vs.l + '-' + vs.sets : ''].join('|');
    if (item.dataset.fcmSig === sig && item.querySelector(':scope > .fcm-bars, .fcm-sub')) return;
    item.dataset.fcmSig = sig;

    const nag = item.querySelector('.nameAndGame');
    if (nag) {
        // line 2: flag · country · ping · Wi-Fi -- unless Fightcade shows a "Playing …" line
        let sub = nag.querySelector(':scope > .fcm-sub');
        if (gameTxt) { if (sub) sub.remove(); }
        else {
            if (!sub) { sub = document.createElement('div'); sub.className = 'fcm-sub'; nag.appendChild(sub); }
            const bits = [];
            if (info.country) bits.push(E(info.country));
            if (info.ping != null && !isNaN(info.ping)) bits.push(`<span class="fcm-ms ${pingLevel(info.ping)}">${info.ping} ms</span>`);
            if (info.net) bits.push(`<span class="fcm-net">${info.net === 'VPN' ? '🛡 VPN' : '📶 Wi-Fi'}</span>`);
            sub.innerHTML = (info.flagCss ? `<span class="fcm-flag" style="background-image:${E(info.flagCss)}"></span>` : '') + bits.join(' · ');
        }

        // in a match: "⚔ vs X · 12m · Watch" (activity sections)
        item.classList.toggle('fcm-playing', !!live);
        let lv = nag.querySelector(':scope > .fcm-live');
        if (live) {
            if (!lv) {
                lv = document.createElement('div');
                lv.className = 'fcm-live';
                // our Watch must not also trigger Fightcade's own row click
                ['click', 'mousedown', 'mouseup'].forEach(ev => lv.addEventListener(ev, (e) => {
                    const w = e.target.closest('[data-watch]');
                    if (!w) return;
                    e.stopPropagation();
                    e.preventDefault();
                    if (ev === 'click') { try { (window.__fcdOpenUri || ((x) => window.location.assign(x)))(w.dataset.watch); } catch (err) { /* ignore */ } }
                }, true));
                nag.appendChild(lv);
            }
            if (lv.innerHTML !== live) lv.innerHTML = live;
        } else if (lv) lv.remove();

        // ★ for friends, right after the name
        if (friend) { const star = afterName(nag, 'fcm-fr'); star.textContent = '★'; star.title = T('Friend'); }
        else { const s = nag.querySelector(':scope > .fcm-fr'); if (s) s.remove(); }

        // notes: coloured dots for the player's tags
        if (noteDots) { const nd = afterName(nag, 'fcm-nt', ':scope > .fcm-fr'); if (nd.innerHTML !== noteDots) nd.innerHTML = noteDots; }
        else { const nd = nag.querySelector(':scope > .fcm-nt'); if (nd) nd.remove(); }

        // #12 on this game's leaderboard (top 300)
        if (cfg.top && info.top) {
            const top = afterName(nag, 'fcm-top', '.fcScoutBadge');
            top.className = 'fcm-top' + (info.top <= 10 ? ' gold' : info.top <= 100 ? ' silver' : '');
            top.textContent = '#' + info.top;
            top.title = T('#{n} on the leaderboard for this game', { n: info.top });
        } else { const t = nag.querySelector(':scope > .fcm-top'); if (t) t.remove(); }

        // ⚔ 3–1 right after the name
        if (vs && (vs.w || vs.l || vs.sets)) {
            const tag = afterName(nag, 'fcm-vs', '.fcScoutBadge');
            tag.className = 'fcm-vs ' + (vs.w > vs.l ? 'ahead' : vs.w < vs.l ? 'behind' : 'even');
            // unscored sets only: "played", not a misleading 0–0
            tag.textContent = (vs.w || vs.l) ? '⚔ ' + vs.w + '–' + vs.l : '⚔';
            tag.title = T("You've played {name}: {w}–{l}", { name: info.name, w: vs.w, l: vs.l }) +
                (vs.sets > vs.w + vs.l ? ' (' + T.plural(vs.sets, '{n} set', '{n} sets') + ')' : '') + (vs.last ? ' · ' + T('last {when}', { when: fc.fmt.day(vs.last) }) : '') + '\n' + T('(from your most recent sets)');
        } else { const t = nag.querySelector(':scope > .fcm-vs'); if (t) t.remove(); }
    }

    // signal bars
    let bars = item.querySelector(':scope > .fcm-bars');
    if (cfg.bars) {
        if (!bars) { bars = document.createElement('span'); bars.className = 'fcm-bars'; bars.innerHTML = '<i></i><i></i><i></i>'; item.appendChild(bars); }
        bars.className = 'fcm-bars ' + pingLevel(info.ping);
        bars.title = (info.ping != null && !isNaN(info.ping) ? info.ping + ' ms' : T('ping unknown')) + (info.net ? ' · ' + info.net : '');
    } else if (bars) bars.remove();
}

/* ----------------------------------------------------------------- activity */

const firstSeen = new Map();     // quark -> when we first saw the match
const bootAt = Date.now();

function liveLine(info) {
    const p = info.playing;
    if (!p) return '';
    const all = fc.app.users();
    const opp = Object.keys(all).find(n => n !== info.name && all[n].playing && all[n].playing.quarkId === p.quarkId) || '';
    if (!firstSeen.has(p.quarkId)) firstSeen.set(p.quarkId, Date.now());
    if (firstSeen.size > 300) firstSeen.delete(firstSeen.keys().next().value);
    const since = firstSeen.get(p.quarkId);
    const mins = since - bootAt > 15000 ? Math.floor((Date.now() - since) / 60000) : null;
    const c = fc.app.channel(p.channelId);
    const watch = c && c.spectators !== false && !fc.app.isMe(info.name)
        ? fc.data.watchUrl({ emu: c.emulator, rom: p.gameId, quark: p.quarkId, port: p.port }) : '';
    return `<span class="dot"></span>${opp ? 'vs <b>' + E(opp) + '</b>' : E(T('in a match'))}${mins != null ? ' · ' + (mins < 1 ? E(T('just started')) : mins + 'm') : ''}` +
        (watch ? `<span class="w" data-watch="${E(watch)}" title="${E(T('Watch this match'))}">👁 ${E(T('Watch'))}</span>` : '');
}

function hiddenByFilter(info) {
    const f = cfg.filter;
    if (f.ranks.length && !f.ranks.includes(info.rank)) return true;
    if (f.lowPing && !(info.ping != null && info.ping < 100)) return true;
    if (f.region) {
        const mine = myContinent();
        if (mine && CONTINENT_OF[info.cc] !== mine) return true;
    }
    return false;
}

function sortKey(info, idx) {
    if (cfg.sort === 'ping') return [info.ping == null || isNaN(info.ping) ? 1e6 : info.ping, idx];
    if (cfg.sort === 'top') return [info.top == null ? 1e6 : info.top, idx];
    return [idx, 0];
}

function processList(list, grouped) {
    const items = [...list.children].filter(el => el.classList.contains('userItem'));
    const board = boardFor(listRom(list));
    const fr = mod('friends');
    const rows = items.map((item, idx) => {
        const info = rowInfo(item, board);
        renderRow(item, info);
        const hide = hiddenByFilter(info);
        if (item.classList.contains('fcm-hidden') !== hide) item.classList.toggle('fcm-hidden', hide);
        const visible = !hide && item.style.display !== 'none';
        // activity sections: Playing now (-2), Friends (-1), then the rank groups
        let group = grouped ? RANKS.indexOf(info.rank) : 0;
        if (grouped && cfg.activity) {
            if (info.playing) group = -2;
            else if (fr && fr.isFriend && fr.isFriend(info.name)) group = -1;
        }
        return { item, info, idx, visible, group };
    });

    list.classList.add('fcm-list');
    list.classList.toggle('fcm-grouped', grouped);

    const byGroup = new Map();
    rows.forEach(r => { if (!byGroup.has(r.group)) byGroup.set(r.group, []); byGroup.get(r.group).push(r); });
    byGroup.forEach((g, gi) => {
        if (gi === -2) g.sort((a, b) => String(a.info.playing.quarkId).localeCompare(String(b.info.playing.quarkId)) || a.idx - b.idx);
        else g.sort((a, b) => { const ka = sortKey(a.info, a.idx), kb = sortKey(b.info, b.idx); return ka[0] - kb[0] || ka[1] - kb[1]; });
        const count = g.filter(r => r.visible).length;
        let firstDone = false;
        g.forEach((r, pos) => {
            const order = String(gi * 10000 + pos);
            if (r.item.style.order !== order) r.item.style.order = order;
            const first = grouped && r.visible && !firstDone;
            if (first) firstDone = true;
            if (r.item.classList.contains('fcm-first') !== first) r.item.classList.toggle('fcm-first', first);
            const label = gi === -2 ? '⚔ ' + T('Playing now') : gi === -1 ? '★ ' + T('Friends') : RANKS[gi] === '?' ? T('Unranked') : T('Rank {rank}', { rank: RANKS[gi] });
            const head = first ? label + ' — ' + count : '';
            if (first) { if (r.item.dataset.fcmHead !== head) r.item.dataset.fcmHead = head; }
            else if (r.item.dataset.fcmHead) delete r.item.dataset.fcmHead;
        });
    });
}

/* ------------------------------------------------------------- chips + sort */

function chipBarHtml() {
    const f = cfg.filter;
    const chip = (key, label, on, title) => `<span class="fcm-chip${on ? ' on' : ''}" data-chip="${key}" title="${E(title || '')}">${label}</span>`;
    const active = f.ranks.length || f.lowPing || f.region;
    return RANKS.map(r => chip('rank:' + r, r, f.ranks.includes(r), r === '?' ? T('Unranked') : T('Rank {rank}', { rank: r }))).join('') +
        chip('lowPing', '&lt; 100 ms', f.lowPing, T('Only players under 100 ms')) +
        chip('region', E(T('My region')), f.region, myContinent() ? T('Only players in {region}', { region: T(myContinent()) }) : T('Your country is unknown')) +
        (active ? chip('clear', '×', false, T('Clear filters')) : '') +
        `<span class="fcm-sort" title="${E(T('Sort'))}">` +
        ['name', 'ping', 'top'].map(s => `<span class="fcm-seg${cfg.sort === s ? ' on' : ''}" data-sort="${s}">${E(T({ name: 'Name', ping: 'Ping', top: 'Top' }[s]))}</span>`).join('') +
        `</span>`;
}

function refreshChipBars() {
    const html = chipBarHtml();
    document.querySelectorAll('.fcm-chips').forEach(b => { if (b.innerHTML !== html) b.innerHTML = html; });
}

function onChipClick(e) {
    e.stopPropagation();
    e.preventDefault();
    const chip = e.target.closest('[data-chip]');
    const seg = e.target.closest('[data-sort]');
    const f = cfg.filter;
    if (chip) {
        const k = chip.dataset.chip;
        if (k.indexOf('rank:') === 0) {
            const r = k.slice(5);
            f.ranks = f.ranks.includes(r) ? f.ranks.filter(x => x !== r) : f.ranks.concat(r);
        } else if (k === 'lowPing') f.lowPing = !f.lowPing;
        else if (k === 'region') f.region = !f.region;
        else if (k === 'clear') { f.ranks = []; f.lowPing = false; f.region = false; }
    } else if (seg) cfg.sort = seg.dataset.sort;
    else return;
    store.save();
    refreshChipBars();
    sweep();
}

function ensureChipBar(wrapper) {
    if (wrapper.querySelector('.fcm-chips')) return;
    const anchor = wrapper.querySelector('#cerbPlayerSearchContainer') || wrapper.querySelector('.usersOnlineTitle');
    if (!anchor || !anchor.parentNode) return;
    const bar = document.createElement('div');
    bar.className = 'fcm-chips';
    bar.innerHTML = chipBarHtml();
    bar.addEventListener('click', onChipClick);
    bar.addEventListener('mousedown', (e) => e.stopPropagation());
    anchor.insertAdjacentElement('afterend', bar);
}

/* -------------------------------------------------------------------- style */

// html body prefix: out-ranks discord-theme.js's member-list rules (both use !important)
const P = 'html body .usersListWrapper';
function css() {
    return `
${P} .fcm-list.fcm-grouped { display: flex !important; flex-direction: column !important; }
${P} .fcm-list { display: flex !important; flex-direction: column !important; }
${P} .userItem.fcm-hidden { display: none !important; }
${P} .userItem.fcm-row.fcm-first { margin-top: 30px !important; }
${P} .userItem.fcm-row.fcm-first::before {
    content: attr(data-fcm-head); position: absolute; left: 8px; top: -24px; pointer-events: none; white-space: nowrap;
    font: 500 14px/18px var(--fc-font); color: var(--fc-muted); letter-spacing: 0; }
${P} .userItem.fcm-row .flagWrapper,
${P} .userItem.fcm-row .rankWrapper,
${P} .userItem.fcm-row .pingWrapper { display: none !important; }
${P} .userItem.fcm-row .fcScoutBadge { display: none !important; }
${P} .userItem.fcm-row:hover .fcScoutBadge { display: inline !important; }
${P} .userItem.fcm-row .nameAndGame .playerName {
    display: inline-block !important; max-width: calc(100% - 64px) !important; vertical-align: bottom !important; }
${P} .userItem.fcm-row .cerb-rank-badge { order: 4 !important; margin: 0 0 0 6px !important; font-size: 12px !important; }
${P} .fcm-sub { display: block; font-size: 12px; line-height: 16px; color: var(--fc-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 400; }
${P} .fcm-flag { display: inline-block; width: 16px; height: 11px; margin-right: 5px; vertical-align: -1px;
    background-size: cover; background-position: center; border-radius: 2px; }
/* the theme greys out everything after a name with !important (0,5,1): out-rank it */
${P} .userItem .nameAndGame > .fcm-vs { display: inline-block !important; margin-left: 6px !important; padding: 0 4px !important;
    border-radius: 4px !important; vertical-align: 1px !important; font: 600 11px/16px var(--fc-font) !important;
    background: rgba(255,255,255,.06) !important; color: var(--fc-muted) !important; }
${P} .userItem .nameAndGame > .fcm-vs.ahead { color: var(--fc-success) !important; background: rgba(35,165,90,.12) !important; }
${P} .userItem .nameAndGame > .fcm-vs.behind { color: #f23f43 !important; background: rgba(242,63,67,.12) !important; }
${P} .fcm-ms.good { color: var(--fc-success); } ${P} .fcm-ms.ok { color: var(--fc-warning); } ${P} .fcm-ms.bad { color: #f23f43; }
${P} .fcm-net { color: var(--fc-text); }
${P} .userItem .nameAndGame > .fcm-nt { display: inline-block !important; }
${P} .userItem.fcm-playing { background: rgba(242,63,67,.07) !important; box-shadow: inset 2px 0 0 #f23f43 !important; border-radius: 4px !important; }
${P} .userItem .nameAndGame > .fcm-live { display: flex !important; align-items: center !important; margin-top: 1px !important; font-size: 12px !important;
    color: var(--fc-muted) !important; white-space: nowrap !important; overflow: hidden !important; }
${P} .userItem .nameAndGame > .fcm-live .dot { width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: #f23f43; flex: none; box-shadow: 0 0 6px #f23f43; }
${P} .userItem .nameAndGame > .fcm-live b { color: var(--fc-text); font-weight: 600; margin-left: 3px; }
${P} .userItem .nameAndGame > .fcm-live .w { margin-left: 6px; padding: 0 6px; border-radius: 3px; font-size: 11px; font-weight: 700; color: #fff;
    background: #f23f43; cursor: pointer; flex: none; }
${P} .userItem.fcm-playing .nameAndGame .game { display: none !important; }
${P} .userItem.fcm-playing .nameAndGame > .fcm-sub { display: none !important; }
${P} .userItem .nameAndGame > .fcm-fr { display: inline-block !important; margin-left: 5px !important; color: var(--fc-warning) !important; font-size: 12px !important; }
${P} .userItem .nameAndGame > .fcm-top { display: inline-block !important; margin-left: 6px !important; padding: 0 4px !important;
    border-radius: 4px !important; vertical-align: 1px !important; font: 700 11px/16px var(--fc-font) !important;
    background: rgba(255,255,255,.06) !important; color: var(--fc-muted) !important; }
${P} .userItem .nameAndGame > .fcm-top.silver { color: #c9d1d9 !important; background: rgba(201,209,217,.12) !important; }
${P} .userItem .nameAndGame > .fcm-top.gold { color: var(--fc-warning) !important; background: rgba(240,178,50,.14) !important; }
${P} .fcm-bars { order: 5; flex: none; display: inline-flex; align-items: flex-end; height: 12px; margin-left: 8px; }
${P} .fcm-bars i { width: 3px; margin-left: 2px; border-radius: 1px; background: currentColor; opacity: .25; }
${P} .fcm-bars i:nth-child(1) { height: 5px; } ${P} .fcm-bars i:nth-child(2) { height: 8px; } ${P} .fcm-bars i:nth-child(3) { height: 12px; }
${P} .fcm-bars.good { color: var(--fc-success); } ${P} .fcm-bars.ok { color: var(--fc-warning); } ${P} .fcm-bars.bad { color: #f23f43; } ${P} .fcm-bars.unk { color: #80848e; }
${P} .fcm-bars.good i, ${P} .fcm-bars.ok i:nth-child(-n+2), ${P} .fcm-bars.bad i:nth-child(1) { opacity: 1; }
${P} .fcm-chips { display: flex; flex-wrap: wrap; align-items: center; padding: 6px 8px 2px; }
${P} .fcm-chip, ${P} .fcm-seg { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; margin: 0 4px 4px 0;
    border-radius: 11px; font: 500 12px/22px var(--fc-font); cursor: pointer; user-select: none;
    background: var(--fc-btn); color: var(--fc-text); }
${P} .fcm-chip:hover { background: var(--fc-btn-h); }
${P} .fcm-chip.on { background: var(--fc-accent); color: #fff; }
${P} .fcm-chip[data-chip="clear"] { background: transparent; color: var(--fc-muted); padding: 0 6px; }
${P} .fcm-sort { display: inline-flex; margin: 0 0 4px auto; border-radius: 11px; overflow: hidden; }
${P} .fcm-seg { margin: 0; border-radius: 0; padding: 0 7px; }
${P} .fcm-seg.on { background: var(--fc-accent); color: #fff; }
` + Object.keys(fc.data.RANK_COLOR).map(r =>
        `html body .usersListWrapper .fcm-colors .userItem.fcm-row[data-fcm-rank="${r}"] .playerName:not(.patreon):not(.dev) { color: ${fc.data.RANK_COLOR[r]} !important; }`).join('\n');
}

/* -------------------------------------------------------------------- sweep */

function sweep() {
    if (!cfg.enabled) return;
    document.querySelectorAll('.usersListWrapper').forEach(w => {
        // other channels: when shown. (The wrapper is position:fixed, so offsetParent is always
        // null -- a hidden channel shows up as zero size instead.)
        if (!w.offsetWidth && !w.offsetHeight) return;
        ensureChipBar(w);
        w.querySelectorAll('.usersOnlineList').forEach(l => { l.classList.toggle('fcm-colors', cfg.rankColors); processList(l, cfg.group); });
        w.querySelectorAll('.usersAwayList').forEach(l => { l.classList.toggle('fcm-colors', cfg.rankColors); processList(l, false); });
    });
}

function teardown() {
    document.querySelectorAll('.fcm-chips, .fcm-sub, .fcm-bars, .fcm-vs, .fcm-top, .fcm-fr, .fcm-nt, .fcm-live').forEach(n => n.remove());
    document.querySelectorAll('.fcm-playing').forEach(n => n.classList.remove('fcm-playing'));
    document.querySelectorAll('.fcm-list').forEach(l => l.classList.remove('fcm-list', 'fcm-grouped', 'fcm-colors'));
    document.querySelectorAll('.fcm-row').forEach(r => {
        r.classList.remove('fcm-row', 'fcm-hidden', 'fcm-first');
        r.style.removeProperty('order');
        ['fcmRank', 'fcmSig', 'fcmHead'].forEach(k => delete r.dataset[k]);
    });
}

let lastOpp = 0;
async function refreshOpponents(force) {
    if (!cfg.enabled || !cfg.played) return;
    if (!force && Date.now() - lastOpp < 10 * 60000) return;
    const scout = mod('scout');
    if (!scout || !scout.recentOpponents) return;
    lastOpp = Date.now();
    try {
        opponents = await scout.recentOpponents();
        sweep();
    } catch (e) { fc.log('recent opponents unavailable:', e && e.message); }
}

function redo(key) {
    teardown();
    if (!cfg.enabled) return;
    if (key === 'played' && cfg.played) refreshOpponents(true);
    sweep();
}

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('member-list', DEFAULTS);
    cfg = store.data;
    if (!Array.isArray(cfg.filter.ranks)) cfg.filter.ranks = [];
    window.__fcMemberListLoaded = true;
    fc.ui.style('fcmStyle', css());
    fc.own(() => { fc.ui.style('fcmStyle', null); teardown(); window.__fcMemberListLoaded = false; });

    fc.watch(sweep, { selector: '.usersListWrapper' });
    fc.tick(sweep, 2000);                                   // ping / matches / away change without a DOM change
    fc.tick(() => refreshOpponents(false), 60000, { delay: 3000 });
    fc.on('friends:changed', sweep);
    fc.on('notes:changed', sweep);

    const opt = (key, label, hint, show) => ({ key, type: 'switch', label, hint, show, onChange: () => redo(key) });
    const on = (d) => d.enabled;
    fc.settings.block({
        id: 'member-list', section: 'members', title: 'Member list', hint: '— only you see this', store, order: 10,
        fields: [
            opt('enabled', N_('Discord-style member list')),
            opt('group', N_('Group by rank'), N_('Like Discord roles'), on),
            opt('activity', N_('Activity sections'), N_('Playing now (with vs + Watch) and Friends at the top'), on),
            opt('rankColors', N_('Rank-coloured names'), N_('S gold · A red · B purple · C blue · D green'), on),
            opt('bars', N_('Signal bars'), N_('Instead of the ping number'), on),
            opt('played', N_('Played before'), N_('⚔ your record with people you recently played'), on),
            opt('top', N_('Leaderboard spot'), N_('#12 next to players in this game’s top 300'), on)
        ]
    });
    sweep();
    return api;
}

const api = {
    continentOf,
    _setOpponents: (m) => { opponents = m; sweep(); },
    _teardown: () => teardown(),
    get _config() { return cfg; }
};

module.exports = { id: 'member-list', name: 'Member list', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
