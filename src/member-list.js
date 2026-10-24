/**
 * Fightcord member list, Discord style
 *
 *   - "Looking to play" grouped by rank like Discord roles (Rank S — 2, Rank A — 7, …)
 *     with rank-coloured names, plus "Playing now" and "Friends" sections on top
 *   - a Discord status line under each name: flag, country, ping, Wi-Fi/VPN
 *   - ping as green/yellow/red signal bars
 *   - one Filter button (rank, < 100 ms, my region in a popover) and sort (name / ping / top)
 *   - calm by default (2.9): on the left of the chat, one line per player (details in the hover
 *     card), and Fightcade's Playing list folded away until you open it
 *   - ⚔ 3–1 on players you've recently played, #12 on the game's leaderboard
 *   - 2.16: a search box, groups that fold from their heading (remembered), a ⚔ button on hover
 *     that challenges (Shift+click: the FT you played them at last), and "From your lobbies"
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
    top: false,           // #12 leaderboard spot next to the name (off since 2.9: calmer)
    activity: true,       // "Playing now" + "Friends" sections on top
    filter: { ranks: [], lowPing: false, region: false },
    sort: 'name',         // name | ping | top
    side: 'left',         // left | right of the chat
    details: false,       // the 'country · ms · Wi-Fi' line under each name
    playingOpen: false,   // Fightcade's Playing (live matches) list unfolded
    folded: {},           // group key -> folded (2.16)
    quickChallenge: true  // the ⚔ button on a row you hover (2.16)
};

/* ------------------------------------------------------------- pure parts */

// every word of the search somewhere in the name (any case)
function matchesSearch(name, q) {
    const n = String(name || '').toLowerCase();
    return String(q || '').toLowerCase().split(/\s+/).filter(Boolean).every(w => n.indexOf(w) >= 0);
}
// a group's number -> the key its folded state is kept under
const GROUP_KEYS = { '-3': 'playing', '-2': 'friends', '-1': 'lobbies' };
const groupKey = (gi, ranks) => GROUP_KEYS[gi] || 'rank-' + ((ranks || RANKS)[gi] || '?');
// can the ⚔ button challenge this row?
const canQuick = (o) => !!(o && o.name && !o.me && !o.away && !o.playing);

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

function renderRow(item, info, where) {
    const w = where || {};
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
    const pr = mod('presence');
    const pres = pr && pr.mark ? pr.mark(info.name) : '';
    const quick = cfg.quickChallenge && canQuick({ name: info.name, me: fc.app.isMe(info.name), away: !!w.away, playing: !!info.playing });
    const mate = (w.mate || []).join(', ');
    const sig = [info.country, info.flagCss, info.ping, info.net, info.top, cfg.bars ? 1 : 0, gameTxt, friend ? 'F' : '', noteDots, live, pres,
        vs ? vs.w + '-' + vs.l + '-' + vs.sets : '', quick ? 'Q' : '', mate].join('|');
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
            if (info.net) bits.push(`<span class="fcm-net">${info.net === 'VPN' ? fc.ui.ic('shield') + 'VPN' : fc.ui.ic('wifi') + 'Wi-Fi'}</span>`);
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
            fc.ui.setHtml(lv, live);
        } else if (lv) lv.remove();

        // ★ for friends, right after the name
        if (friend) { const star = afterName(nag, 'fcm-fr'); star.innerHTML = fc.ui.ic('star', 'fill'); star.title = T('Friend'); }
        else { const s = nag.querySelector(':scope > .fcm-fr'); if (s) s.remove(); }

        // F (+ mic): has Fightcord (+ voice chat on)
        if (pres) { const pm = afterName(nag, 'fcm-pres'); fc.ui.setHtml(pm, pres); }
        else { const pm = nag.querySelector(':scope > .fcm-pres'); if (pm) pm.remove(); }

        // 🔒 a mate from your private lobbies
        if (mate) { const lb = afterName(nag, 'fcm-lb'); lb.innerHTML = fc.ui.ic('lock'); lb.title = T('In your lobby: {lobbies}', { lobbies: mate }); }
        else { const lb = nag.querySelector(':scope > .fcm-lb'); if (lb) lb.remove(); }

        // notes: coloured dots for the player's tags
        if (noteDots) { const nd = afterName(nag, 'fcm-nt', ':scope > .fcm-fr'); fc.ui.setHtml(nd, noteDots); }
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
            tag.innerHTML = fc.ui.ic('swords') + ((vs.w || vs.l) ? vs.w + '–' + vs.l : '');
            tag.title = T("You've played {name}: {w}–{l}", { name: info.name, w: vs.w, l: vs.l }) +
                (vs.sets > vs.w + vs.l ? ' (' + T.plural(vs.sets, '{n} set', '{n} sets') + ')' : '') + (vs.last ? ' · ' + T('last {when}', { when: fc.fmt.day(vs.last) }) : '') + '\n' + T('(from your most recent sets)');
        } else { const t = nag.querySelector(':scope > .fcm-vs'); if (t) t.remove(); }
    }

    // ⚔ on hover: challenge without opening Fightcade's menu
    let qc = item.querySelector(':scope > .fcm-qc');
    if (quick) {
        if (!qc) {
            qc = document.createElement('span');
            qc.className = 'fcm-qc';
            qc.innerHTML = fc.ui.ic('sword');
            // ours alone: Fightcade's row menu opens on mousedown
            ['mousedown', 'mouseup'].forEach(ev => qc.addEventListener(ev, (e) => { e.stopPropagation(); e.preventDefault(); }, true));
            qc.addEventListener('click', onQuickChallenge, true);
            item.appendChild(qc);
        }
        qc.dataset.who = info.name;
        const sc = mod('scout');
        const ft = sc && sc.knownFt ? sc.knownFt(info.name.toLowerCase()) : null;
        qc.title = T('Challenge {name}', { name: info.name }) + (typeof ft === 'number' ? '\n' + T('Shift+click: {ft} straight away', { ft: ft ? 'FT' + ft : T('casual') }) : '');
    } else if (qc) qc.remove();

    // signal bars
    let bars = item.querySelector(':scope > .fcm-bars');
    if (cfg.bars) {
        if (!bars) { bars = document.createElement('span'); bars.className = 'fcm-bars'; bars.innerHTML = '<i></i><i></i><i></i>'; item.appendChild(bars); }
        bars.className = 'fcm-bars ' + pingLevel(info.ping);
        bars.title = (info.ping != null && !isNaN(info.ping) ? info.ping + ' ms' : T('ping unknown')) + (info.net ? ' · ' + info.net : '');
    } else if (bars) bars.remove();
}

function onQuickChallenge(e) {
    e.stopPropagation();
    e.preventDefault();
    const name = e.currentTarget.dataset.who;
    const ms = mod('match-screens'), sc = mod('scout');
    if (!name || !ms || !ms.challenge) { fc.ui.toast(T('Match screens are off'), { kind: 'warning', icon: 'sword' }); return; }
    const ft = e.shiftKey && sc && sc.knownFt ? sc.knownFt(name.toLowerCase()) : null;
    // no FT: Fightcade asks for it, like its own Challenge
    const st = ms.challenge(name, typeof ft === 'number' ? ft : undefined);
    if (!st.ok) fc.ui.toast(st.why || T('Couldn’t challenge'), { kind: 'warning', icon: 'sword' });
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
        (watch ? `<span class="w" data-watch="${E(watch)}" title="${E(T('Watch this match'))}">${fc.ui.ic('eye')}${E(T('Watch'))}</span>` : '');
}

let searchQ = '';                // the member search (not saved)

function hiddenByFilter(info) {
    if (searchQ && !matchesSearch(info.name, searchQ)) return true;
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

function processList(list, grouped, away) {
    const items = [...list.children].filter(el => el.classList.contains('userItem'));
    const board = boardFor(listRom(list));
    const fr = mod('friends');
    const lbm = mod('lobbies');
    const mates = cfg.activity && lbm && lbm.mates ? lbm.mates() : null;
    const rows = items.map((item, idx) => {
        const info = rowInfo(item, board);
        const mate = mates ? mates.get(info.name.toLowerCase()) : null;
        renderRow(item, info, { away, mate });
        const hide = hiddenByFilter(info);
        if (item.classList.contains('fcm-hidden') !== hide) item.classList.toggle('fcm-hidden', hide);
        const visible = !hide && item.style.display !== 'none';
        // activity sections: Playing now (-3), Friends (-2), From your lobbies (-1), then the rank groups
        let group = grouped ? RANKS.indexOf(info.rank) : 0;
        if (grouped && cfg.activity) {
            if (info.playing) group = -3;
            else if (fr && fr.isFriend && fr.isFriend(info.name)) group = -2;
            else if (mate) group = -1;
        }
        return { item, info, idx, visible, group };
    });

    list.classList.add('fcm-list');
    list.classList.toggle('fcm-grouped', grouped);

    const byGroup = new Map();
    rows.forEach(r => { if (!byGroup.has(r.group)) byGroup.set(r.group, []); byGroup.get(r.group).push(r); });
    byGroup.forEach((g, gi) => {
        if (gi === -3) g.sort((a, b) => String(a.info.playing.quarkId).localeCompare(String(b.info.playing.quarkId)) || a.idx - b.idx);
        else g.sort((a, b) => { const ka = sortKey(a.info, a.idx), kb = sortKey(b.info, b.idx); return ka[0] - kb[0] || ka[1] - kb[1]; });
        const count = g.filter(r => r.visible).length;
        const key = groupKey(gi);
        const folded = grouped && !searchQ && !!cfg.folded[key];       // a search shows everything it finds
        let firstDone = false;
        g.forEach((r, pos) => {
            const order = String(gi * 10000 + pos);
            if (r.item.style.order !== order) r.item.style.order = order;
            const first = grouped && r.visible && !firstDone;
            if (first) firstDone = true;
            if (r.item.classList.contains('fcm-first') !== first) r.item.classList.toggle('fcm-first', first);
            const fold = folded && r.visible && !first;
            if (r.item.classList.contains('fcm-fold') !== fold) r.item.classList.toggle('fcm-fold', fold);
            const fh = folded && first;
            if (r.item.classList.contains('fcm-folded-head') !== fh) r.item.classList.toggle('fcm-folded-head', fh);
            let gh = r.item.querySelector(':scope > .fcm-gh');
            if (first) {
                const label = gi === -3 ? T('Playing now') : gi === -2 ? T('Friends') : gi === -1 ? T('From your lobbies')
                    : RANKS[gi] === '?' ? T('Unranked') : T('Rank {rank}', { rank: RANKS[gi] });
                // the group's picture: Fightcade's rank badge, or an icon
                const pic = gi === -3 ? fc.ui.iconUrl('swords', false, '#949ba4') : gi === -2 ? fc.ui.iconUrl('star', true, '#f0b232')
                    : gi === -1 ? fc.ui.iconUrl('lock', false, '#949ba4') : 'url("' + fc.data.rankImg(RANKS[gi]) + '")';
                if (!gh) {
                    gh = document.createElement('span');
                    gh.className = 'fcm-gh';
                    // a real element (not ::before): it can be clicked without Fightcade's row menu
                    ['mousedown', 'mouseup'].forEach(ev => gh.addEventListener(ev, (e) => { e.stopPropagation(); e.preventDefault(); }, true));
                    gh.addEventListener('click', onGroupClick, true);
                    r.item.appendChild(gh);
                }
                const html = `<i>${fc.ui.ic('chevronDown')}</i><span>${E(label)} — ${count}</span>`;
                if (gh.__html !== html) { gh.__html = html; gh.innerHTML = html; }
                gh.dataset.key = key;
                gh.title = folded ? T('Show this group') : T('Fold this group');
                gh.classList.toggle('folded', folded);
                if (gh.style.getPropertyValue('--fcm-hi') !== pic) gh.style.setProperty('--fcm-hi', pic);
            } else if (gh) gh.remove();
        });
    });
}

function onGroupClick(e) {
    e.stopPropagation();
    e.preventDefault();
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    if (cfg.folded[key]) delete cfg.folded[key]; else cfg.folded[key] = true;
    store.save();
    sweep();
}

/* ------------------------------------------------------------- chips + sort */

const chip = (key, label, on, title) => `<span class="fcm-chip${on ? ' on' : ''}" data-chip="${key}" title="${E(title || '')}">${label}</span>`;
const activeFilters = () => cfg.filter.ranks.length + (cfg.filter.lowPing ? 1 : 0) + (cfg.filter.region ? 1 : 0);

// what the Filter button opens
function filterPopHtml() {
    const f = cfg.filter;
    return `<div class="fcm-popt">${E(T('Ranks'))}</div><div class="fcm-poprow">` +
        RANKS.map(r => chip('rank:' + r, r, f.ranks.includes(r), r === '?' ? T('Unranked') : T('Rank {rank}', { rank: r }))).join('') + '</div>' +
        `<div class="fcm-popt">${E(T('Connection'))}</div><div class="fcm-poprow">` +
        chip('lowPing', '&lt; 100 ms', f.lowPing, T('Only players under 100 ms')) +
        chip('region', E(T('My region')), f.region, myContinent() ? T('Only players in {region}', { region: T(myContinent()) }) : T('Your country is unknown')) + '</div>' +
        (activeFilters() ? `<div class="fcm-poprow">${chip('clear', E(T('Clear filters')), false, '')}</div>` : '');
}

function chipBarHtml() {
    const n = activeFilters();
    return `<span class="fcm-fbtn${n ? ' on' : ''}" data-pop="filter" title="${E(T('Filter by rank, ping or region'))}">${fc.ui.ic('filter')}${E(T('Filter'))}${n ? `<b>${n}</b>` : ''}</span>` +
        `<span class="fcm-sort" title="${E(T('Sort'))}">` +
        ['name', 'ping', 'top'].map(s => `<span class="fcm-seg${cfg.sort === s ? ' on' : ''}" data-sort="${s}">${E(T({ name: 'Name', ping: 'Ping', top: 'Top' }[s]))}</span>`).join('') +
        `</span>`;
}

function refreshChipBars() {
    const html = chipBarHtml();
    document.querySelectorAll('.fcm-chips > .fcm-cbx').forEach(b => fc.ui.setHtml(b, html));
}

function setSearch(q) {
    searchQ = String(q || '').trim();
    document.querySelectorAll('.fcm-search').forEach(i => { if (i.value !== q) i.value = q; });
    sweep();
}

let filterPop = null;
function openFilters(btn) {
    if (filterPop) { filterPop.close(); return; }
    const box = document.createElement('div');
    box.className = 'fcm-filters';
    box.innerHTML = filterPopHtml();
    box.addEventListener('click', (e) => { onChipClick(e); box.innerHTML = filterPopHtml(); });
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    filterPop = fc.ui.popover(btn, box, { side: 'bottom', width: 236, onClose: () => { filterPop = null; } });
}

function onChipClick(e) {
    e.stopPropagation();
    e.preventDefault();
    const pop = e.target.closest('[data-pop]');
    if (pop) { openFilters(pop); return; }
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
    const old = wrapper.querySelector('.fcm-chips');
    if (old && old.querySelector('.fcm-search')) return;
    if (old) old.remove();                                // from before 2.16
    const anchor = wrapper.querySelector('.usersOnlineTitle');
    if (!anchor || !anchor.parentNode) return;
    const bar = document.createElement('div');
    bar.className = 'fcm-chips';
    bar.innerHTML = `<input class="fcm-search" type="text" spellcheck="false" placeholder="${E(T('Search members'))}" value="${E(searchQ)}"><span class="fcm-cbx">${chipBarHtml()}</span>`;
    bar.addEventListener('click', (e) => { if (!e.target.closest('.fcm-search')) onChipClick(e); });
    bar.addEventListener('mousedown', (e) => e.stopPropagation());
    const input = bar.querySelector('.fcm-search');
    input.addEventListener('input', () => setSearch(input.value));
    // Fightcade's chat shortcuts stay out; Esc clears the search
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' && input.value) { e.preventDefault(); setSearch(''); } });
    input.addEventListener('keypress', (e) => e.stopPropagation());
    input.addEventListener('keyup', (e) => { if (e.key === 'Escape') e.stopPropagation(); });
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
${P} .userItem.fcm-row.fcm-first { margin-top: 36px !important; }
${P} .userItem.fcm-row { position: relative !important; }
${P} .userItem .fcm-gh { position: absolute; left: 6px; top: -31px; display: flex; align-items: center; height: 26px; padding-left: 32px; white-space: nowrap;
    cursor: pointer; user-select: none; font: 500 14px/26px var(--fc-font); color: var(--fc-muted); letter-spacing: 0;
    background: var(--fcm-hi) no-repeat left center / 26px 26px; pointer-events: auto; visibility: visible !important; }
${P} .userItem .fcm-gh:hover { color: var(--fc-head); }
${P} .userItem .fcm-gh i { display: inline-flex; order: 2; margin-left: 4px; opacity: .7; transition: transform var(--fc-fast); }
${P} .userItem .fcm-gh i .fc-ic { width: 12px; height: 12px; }
${P} .userItem .fcm-gh.folded i { transform: rotate(-90deg); }
${P} .userItem.fcm-fold { display: none !important; }
/* (out-ranks the compact layout's fixed row height; the second selector covers a folded "Playing now") */
${P} .usersOnlineList .userItem.fcm-row.fcm-folded-head:not(.fcm-playing),
${P} .usersOnlineList .userItem.fcm-row.fcm-folded-head.fcm-playing { height: 0 !important; min-height: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important;
    overflow: visible !important; pointer-events: none !important; background: none !important; box-shadow: none !important; }
${P} .userItem.fcm-folded-head > :not(.fcm-gh) { visibility: hidden !important; }
${P} .userItem > .fcm-qc { order: 4; flex: none; display: none; align-items: center; justify-content: center; width: 24px; height: 24px; margin-left: 6px;
    border-radius: 6px; background: var(--fc-success); color: #fff; cursor: pointer; }
${P} .userItem > .fcm-qc .fc-ic { width: 14px; height: 14px; }
${P} .userItem > .fcm-qc:hover { filter: brightness(1.1); }
${P} .userItem.fcm-row:hover > .fcm-qc { display: inline-flex; }
${P} .userItem .nameAndGame > .fcm-lb { display: inline-flex !important; margin-left: 5px !important; color: var(--fc-muted) !important; vertical-align: -1px !important; }
${P} .userItem .nameAndGame > .fcm-lb .fc-ic { width: 12px; height: 12px; }
${P} .userItem.fcm-row .flagWrapper,
${P} .userItem.fcm-row .rankWrapper,
${P} .userItem.fcm-row .pingWrapper { display: none !important; }
${P} .userItem.fcm-row .fcScoutBadge { display: none !important; }
${P} .userItem.fcm-row:hover .fcScoutBadge { display: inline !important; }
${P} .userItem.fcm-row .nameAndGame .playerName {
    display: inline-block !important; max-width: calc(100% - 64px) !important; vertical-align: bottom !important; }
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
${P} .userItem .nameAndGame > .fcm-pres { display: inline-flex !important; align-items: center !important; }
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
${P} .fcm-chips > .fcm-cbx { display: flex; align-items: center; flex: 1 1 100%; }
${P} .fcm-search { flex: 1 1 100%; height: 28px; margin: 0 0 6px; padding: 0 10px; box-sizing: border-box; border: 0; border-radius: 6px; outline: none;
    background: var(--fc-input); color: var(--fc-text); font: 13px/28px var(--fc-font); }
${P} .fcm-search::placeholder { color: var(--fc-muted); }
${P} .fcm-search:focus { box-shadow: 0 0 0 1px var(--fc-accent); }
${P} .fcm-fbtn { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: 12px; cursor: pointer; user-select: none;
    font: 600 12px/24px var(--fc-font); background: var(--fc-btn); color: var(--fc-text); }
${P} .fcm-fbtn:hover { background: var(--fc-btn-h); }
${P} .fcm-fbtn .fc-ic { width: 13px; height: 13px; margin-right: 5px; }
${P} .fcm-fbtn.on { background: var(--fc-accent); color: #fff; }
${P} .fcm-fbtn b { margin-left: 6px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; text-align: center;
    font: 700 11px/16px var(--fc-font); background: rgba(255,255,255,.25); }
/* Fightcade's Playing list: folded unless opened from its title */
${P} .matchesTitleWrapper.fcm-fold { cursor: pointer; }
${P} .matchesTitleWrapper.fcm-fold .matchesTitle::before { content: '▸'; display: inline-block; width: 14px; transition: transform .15s; }
html body .usersListWrapper.fcm-pl-open .matchesTitleWrapper.fcm-fold .matchesTitle::before { transform: rotate(90deg); }
html body .usersListWrapper:not(.fcm-pl-open) .matchesList { display: none !important; }
/* on the left of the chat: rail | members | chat */
html.fcm-left body .channelContent > .usersListToolbar { order: -1 !important; }
html.fcm-left.dc-layout body .usersListToolbar .usersListWrapper { border-left: 0 !important; border-right: 1px solid var(--dc-divider) !important; }
html.fcm-left body .channelContent > .chatWrapper { box-shadow: none !important; }
/* one line per player, a narrower column */
html.fcm-compact.dc-layout body .usersListToolbar, html.fcm-compact.dc-layout body .usersListToolbar .usersListWrapper { width: 264px !important; min-width: 264px !important; }
html.fcm-compact body .usersListWrapper .fcm-sub { display: none !important; }
html.fcm-compact body .usersListWrapper .userItem .avatarWrapper, html.fcm-compact body .usersListWrapper .userItem .avatarWrapper .image { width: 28px !important; height: 28px !important; }
html.fcm-compact.dc-layout body .usersListWrapper .userItem:not(.fcm-playing) { height: 36px !important; min-height: 36px !important; }
.fcm-filters .fcm-popt { margin: 2px 2px 6px; font: 700 11px/14px var(--fc-font); letter-spacing: .04em; text-transform: uppercase; color: var(--fc-muted); }
.fcm-filters .fcm-poprow { display: flex; flex-wrap: wrap; margin-bottom: 8px; }
.fcm-filters .fcm-chip { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; margin: 0 4px 4px 0; border-radius: 12px;
    font: 500 12px/24px var(--fc-font); cursor: pointer; user-select: none; background: var(--fc-btn); color: var(--fc-text); }
.fcm-filters .fcm-chip:hover { background: var(--fc-btn-h); }
.fcm-filters .fcm-chip.on { background: var(--fc-accent); color: #fff; }
.fcm-filters .fcm-chip[data-chip="clear"] { background: transparent; color: var(--fc-muted); padding: 0 4px; }
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

// Fightcade's Playing (live matches) list folds away; its title opens it again. The eye next
// to it is Fightcade's own button, so only the title and count react.
function ensurePlayingFold(w) {
    w.classList.toggle('fcm-pl-open', !!cfg.playingOpen);
    w.querySelectorAll('.matchesTitleWrapper').forEach(t => {
        if (t.__fcmFold) return;
        t.__fcmFold = true;
        t.classList.add('fcm-fold');
        t.title = T('Show or hide the matches being played');
        t.addEventListener('click', (e) => {
            if (e.target.closest('.spectatorsIconWrapper')) return;
            e.stopPropagation();
            cfg.playingOpen = !cfg.playingOpen;
            store.save();
            document.querySelectorAll('.usersListWrapper').forEach(x => x.classList.toggle('fcm-pl-open', cfg.playingOpen));
        });
    });
}

// the layout: which side, one line or two per player
function applyLayout() {
    const html = document.documentElement;
    html.classList.toggle('fcm-left', !!cfg.enabled && cfg.side !== 'right');
    html.classList.toggle('fcm-compact', !!cfg.enabled && !cfg.details);
}

function sweep() {
    if (!cfg.enabled) return;
    applyLayout();
    document.querySelectorAll('.usersListWrapper').forEach(w => {
        // other channels: when shown. (The wrapper is position:fixed, so offsetParent is always
        // null -- a hidden channel shows up as zero size instead.)
        if (!w.offsetWidth && !w.offsetHeight) return;
        ensureChipBar(w);
        ensurePlayingFold(w);
        w.querySelectorAll('.usersOnlineList').forEach(l => { l.classList.toggle('fcm-colors', cfg.rankColors); processList(l, cfg.group); });
        w.querySelectorAll('.usersAwayList').forEach(l => { l.classList.toggle('fcm-colors', cfg.rankColors); processList(l, false, true); });
    });
}

function teardown() {
    document.documentElement.classList.remove('fcm-left', 'fcm-compact');
    document.querySelectorAll('.fcm-pl-open').forEach(n => n.classList.remove('fcm-pl-open'));
    if (filterPop) filterPop.close();
    document.querySelectorAll('.fcm-chips, .fcm-sub, .fcm-bars, .fcm-vs, .fcm-top, .fcm-fr, .fcm-nt, .fcm-live, .fcm-pres, .fcm-gh, .fcm-qc, .fcm-lb').forEach(n => n.remove());
    document.querySelectorAll('.fcm-playing').forEach(n => n.classList.remove('fcm-playing'));
    document.querySelectorAll('.fcm-list').forEach(l => l.classList.remove('fcm-list', 'fcm-grouped', 'fcm-colors'));
    document.querySelectorAll('.fcm-row').forEach(r => {
        r.classList.remove('fcm-row', 'fcm-hidden', 'fcm-first', 'fcm-fold', 'fcm-folded-head');
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
    fc.on('presence:changed', sweep);
    fc.on('ranks:changed', () => { fc.ui.style('fcmStyle', css()); sweep(); });     // rank icons: new colours
    fc.on('notes:changed', sweep);
    fc.on('lobbies:changed', sweep);

    const opt = (key, label, hint, show) => ({ key, type: 'switch', label, hint, show, onChange: () => redo(key) });
    const on = (d) => d.enabled;
    fc.settings.block({
        id: 'member-list', section: 'members', title: 'Member list', hint: '— only you see this', store, order: 10,
        fields: [
            opt('enabled', N_('Discord-style member list')),
            { key: 'side', type: 'select', label: N_('Side'), hint: N_('Where the member list sits next to the chat'), show: on,
                options: [['left', N_('Left')], ['right', N_('Right')]], onChange: () => redo('side') },
            opt('details', N_('Details under names'), N_('Country, ping and Wi-Fi on a second line (they’re always in the hover card)'), on),
            opt('group', N_('Group by rank'), N_('Like Discord roles'), on),
            opt('activity', N_('Activity sections'), N_('Playing now (with vs + Watch), Friends and your lobby mates at the top'), on),
            opt('quickChallenge', N_('Challenge button on hover'), N_('A ⚔ on the player you point at; Shift+click sends the FT you played them at last'), on),
            opt('rankColors', N_('Rank-coloured names'), N_('Each name in its rank’s colour'), on),
            opt('bars', N_('Signal bars'), N_('Instead of the ping number'), on),
            opt('played', N_('Played before'), N_('Your record with people you recently played'), on),
            opt('top', N_('Leaderboard spot'), N_('#12 next to players in this game’s top 300'), on)
        ]
    });
    sweep();
    return api;
}

const api = {
    continentOf,
    search: (q) => setSearch(q),
    _setOpponents: (m) => { opponents = m; sweep(); },
    _teardown: () => teardown(),
    get _config() { return cfg; }
};

module.exports = { id: 'member-list', name: 'Member list', start, matchesSearch, groupKey, canQuick };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
