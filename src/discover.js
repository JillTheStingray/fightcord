/**
 * Fightcord Discover
 *
 * The game browser (search tab), laid out like Discord's Discover page:
 *   - a category sidebar: Home, Your games, Favourites, every genre and system
 *   - a Spotlight carousel of the most played games, with the search box on top
 *   - instant search: results drop down while you type ("3s", "kof98" work)
 *   - scrolling rows of cards that tilt toward the mouse and show Join / Fav
 *   - "Your games" and "Live now" (matches in your channels, with Watch)
 *   - a game page for every game: live matches, top players, recent matches, you
 *   - a results page with endless scrolling, sorting and filter chips
 *
 * Navigation uses Fightcade's own view switch -- the same call its category cards
 * make: selectChannel('search-channel', {category: 'Fighter'}). Nothing is inserted
 * between Fightcade's own elements; the sidebar lives on <body>, and our pieces are
 * appended at the end of their containers and placed with CSS order.
 *
 * Runs on fightcord-core.js (Fightcade API calls go through fc.api, the match history is
 * fc.history).
 */

'use strict';

let fc = null;
let store = null, config = null;          // discover-config.json
const FC_ORIGIN = 'https://web.fightcade.com/';
const DEFAULTS = {
    enabled: true,
    yourGames: true,       // "Your games" row on the home view
    liveRow: true,         // "Live now" row on the home view
    friendsRow: true,      // "Friends playing now"
    rivalsRow: true,       // "Rivals online": people you've played lately who are free
    eventsRow: true,       // "Events this week"
    tilt: true,            // 3D tilt, glare and the ambient glow
    animations: true
};
const LOG = (...a) => fc.log(...a);
const root = () => fc.app.root();
const glob = () => fc.app.global();
const esc = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const ET = (s, v) => fc.fmt.esc(fc.t(s, v));
const N_ = (s) => s;
// genres (Fightcade's own names), translated where shown: N_('Fighter') N_("Beat 'em Up") N_('Shooter') N_('Platform') N_('Puzzle')
// N_('Sports') N_('Driving') N_('Maze') N_('Quiz') N_('Rhythm') N_('Casino') N_('Tabletop') N_('Ball & Paddle') N_('Climbing')
// N_('Multiplay') N_('Misc.') N_('Electromechanical') N_('Whac-A-Mole')

const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');

function initials(name) {
    const words = name.replace(/\s*[\(\[].*$/, '').replace(/[:\-–]/g, ' ').split(/\s+/).filter(Boolean);
    let s = words.map(w => /^\d/.test(w) ? w.match(/^\d+/)[0] : w[0]).join('');
    if (s.length > 4) s = s.slice(0, 4);
    return s || '?';
}

function select(id, params) {
    const r = root();
    if (!r || typeof r.selectChannel !== 'function') { LOG('no selectChannel'); return; }
    try { r.selectChannel(id, params); } catch (e) { LOG('selectChannel failed', id, e.message); }
}

const visible = (el) => !!(el && el.offsetWidth > 0);

// another module's API ('stats.js' or 'stats')
const plugin = (file) => fc.modules.get(file);

/* ------------------------------------------------------------- categories */

// line icons (24-unit grid, drawn in currentColor so they follow the item's text colour)
const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    pad: '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M6.5 12h4M8.5 10v4"/><circle cx="15.5" cy="11" r=".6"/><circle cx="18" cy="13.5" r=".6"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    chart: '<path d="M3 21h18M6 17v-5M11 17V6M16 17v-8M20.5 17v-3"/>',
    sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
    fist: '<path d="M7 11V8a1.8 1.8 0 0 1 3.6 0v2M10.6 10V7a1.8 1.8 0 0 1 3.6 0v3M14.2 10V8.5a1.8 1.8 0 0 1 3.6 0V14a7 7 0 0 1-7 7h-.6A6.2 6.2 0 0 1 4 14.8V13a2 2 0 0 1 3-1.7l2 1.2"/>',
    rocket: '<path d="M12 15l-3-3c1.8-4.8 5.4-8.4 12-9-.6 6.6-4.2 10.2-9 12z"/><path d="M9 12H5l2.5-3.5H11M12 15v4l3.5-2.5V13M6 16c-1.5.5-2.5 3.5-2.5 4.5 1 0 4-1 4.5-2.5"/>',
    stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
    puzzle: '<path d="M4 4h6a2 2 0 1 1 4 0h6v6a2 2 0 1 0 0 4v6H4z"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6a9 9 0 0 1 0 12.8M18.4 5.6a9 9 0 0 0 0 12.8"/>',
    car: '<path d="M3 17v-4l2.2-5.2A1.5 1.5 0 0 1 6.6 7h10.8a1.5 1.5 0 0 1 1.4.8L21 13v4z"/><path d="M3 13h18"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/>',
    maze: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v10h6M17 7v14M11 17h6M7 17v4"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 1 1 3.7 2.4c-.7.3-1.2.9-1.2 1.6v.7M12 17h.01"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" stroke-width="3"/>',
    pawn: '<circle cx="12" cy="6.5" r="2.5"/><path d="M10 9.5 9 14h6l-1-4.5M8.5 14l-1 5h9l-1-5M6 21h12"/>',
    paddle: '<path d="M4 5v14M20 5v14"/><circle cx="12" cy="10" r="2"/>',
    mountain: '<path d="M3 20 9.5 8l4 6.5L16 11l5 9z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6 6 0 0 1 3.5 5.8"/>',
    gear: '<path d="M18.94 10.08L21.38 10.47L21.38 13.53L18.94 13.92L18.26 15.55L19.71 17.55L17.55 19.71L15.55 18.26L13.92 18.94L13.53 21.38L10.47 21.38L10.08 18.94L8.45 18.26L6.45 19.71L4.29 17.55L5.74 15.55L5.06 13.92L2.62 13.53L2.62 10.47L5.06 10.08L5.74 8.45L4.29 6.45L6.45 4.29L8.45 5.74L10.08 5.06L10.47 2.62L13.53 2.62L13.92 5.06L15.55 5.74L17.55 4.29L19.71 6.45L18.26 8.45z"/><circle cx="12" cy="12" r="3"/>',
    hammer: '<path d="M13 7 4 16a2.1 2.1 0 0 0 3 3l9-9M11 5l3-3 8 8-3 3z"/>'
};
const svgIcon = (name) => `<svg class="fcdSvg" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.pad}</svg>`;
const GENRE_ICON = {
    'Fighter': 'sword', "Beat 'em Up": 'fist', 'Shooter': 'rocket', 'Platform': 'stairs', 'Puzzle': 'puzzle',
    'Sports': 'ball', 'Driving': 'car', 'Maze': 'maze', 'Quiz': 'quiz', 'Rhythm': 'music', 'Casino': 'dice',
    'Tabletop': 'pawn', 'Ball & Paddle': 'paddle', 'Climbing': 'mountain', 'Multiplay': 'users', 'Misc.': 'dice',
    'Electromechanical': 'gear', 'Whac-A-Mole': 'hammer'
};
const COMMON_GENRES = ['Fighter', "Beat 'em Up", 'Shooter', 'Platform', 'Puzzle', 'Sports', 'Driving'];
const SYSTEM_TAG = {
    'Arcade FC1': 'FC1', 'Arcade FC2': 'FC2', 'Atomiswave': 'AW', 'ColecoVision': 'CV', 'Dreamcast': 'DC',
    'Game Gear': 'GG', 'MSX': 'MSX', 'Master System': 'SMS', 'Megadrive': 'MD', 'NAOMI': 'NAO',
    'NAOMI 2': 'NA2', 'NES': 'NES', 'PC-Engine': 'PCE', 'PlayStation': 'PS', 'Sega SG-1000': 'SG',
    'Super NES': 'SNES', 'TurboGrafx16': 'TG16'
};
const TAG_COLORS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#1abc9c', '#9b59b6', '#e67e22'];
function tagColor(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return TAG_COLORS[h % TAG_COLORS.length];
}

// FC's lists (index 0 = "All"). Read off the welcome view's own <select>s when the
// global isn't reachable (older loaders, the dev harness).
function filterLists() {
    const fo = glob()?.filtersOptions;
    const fromDom = (cls) => [...document.querySelectorAll('.welcomeWrapper .filterItem.' + cls + ' option')].map(o => o.textContent.trim());
    const genres = (fo && fo.genres && fo.genres.length) ? fo.genres : fromDom('genre');
    const systems = (fo && fo.systems && fo.systems.length) ? fo.systems : fromDom('system');
    return { genres: genres.slice(1), systems: systems.slice(1), allGenres: genres, allSystems: systems };
}

/* ----------------------------------------------------------------- history */

const historySets = () => fc.history.all();

/* ------------------------------------------------------------- shared data */

const RANKS = ['', 'E', 'D', 'C', 'B', 'A', 'S'];

function rankLetter(r) {
    if (typeof r === 'string' && /^[A-Za-z]$/.test(r)) return r.toUpperCase();
    return RANKS[+r] || '';
}
function rankPill(r) {
    const L = rankLetter(r);
    return L ? fc.ui.tag(L, '', 16).replace('class="fc-tag"', 'class="fc-tag fcdRank"') : '';
}
function flagImg(cc) {
    cc = String(cc || '').toLowerCase();
    return /^[a-z]{2}$/.test(cc) ? `<img class="fcdFlag" src="${FC_ORIGIN}static/flags/${cc}.png" alt="">` : '';
}
function avatarUrl(name) {
    const u = users()[name];
    return u && u.gravatar
        ? 'https://www.gravatar.com/avatar/' + encodeURIComponent(u.gravatar) + '?s=96&d=retro&r=g'
        : 'https://www.gravatar.com/avatar/' + encodeURIComponent(name || '?') + '?s=96&d=retro&f=y';
}
const users = () => root()?.globalUsers || {};
const localUser = () => glob()?.localUser || {};
const myName = () => localUser().name || '';

// Every channel object seen anywhere (welcome rows, result pages, joined channels),
// by name -- the catalog itself only has names and roms.
const chanCache = new Map();
function remember(ch) {
    if (!ch || !ch.name) return ch;
    const cur = chanCache.get(ch.name) || {};
    for (const k in ch) if (ch[k] !== undefined && ch[k] !== null && ch[k] !== '') cur[k] = ch[k];
    chanCache.set(ch.name, cur);
    return cur;
}
const plain = (v) => ({
    name: v.name, gameid: v.gameid, system: v.system, clients: v.clients, ranked: v.ranked,
    available_for: v.available_for, owner: v.owner, genre: v.genre, year: v.year,
    emulator: v.emulator, spectators: v.spectators
});

const isJoinedName = (name) => (localUser().channels || []).includes(name) || joinedChannels().some(c => (c.name || c.id) === name);
const isFavName = (name) => (localUser().favoritesChannels || []).includes(name);

// FC's own rules (channelIsAvaibleForUser / canFavoriteChannel); '' = allowed
function joinBlock(ch) {
    const lu = localUser();
    if (ch && ch.available_for != null && lu.role != null && lu.role < ch.available_for) return T('Patrons only');
    if (lu.maxNumChannelsReached) return T('Channel limit reached');
    return '';
}
function favBlock(ch) {
    if (isFavName(ch.name)) return '';
    const lu = localUser();
    const max = lu.perks && lu.perks.maxNumFavorites;
    if (max != null && (lu.favoritesChannels || []).length >= max) return T('Favourites full');
    if (ch.owner) return T('Lobbies can’t be favourited');
    return '';
}

// the same calls Fightcade's own card buttons make
function doJoin(name) {
    const r = root();
    if (r && typeof r.joinChannel === 'function') { try { r.joinChannel(name); } catch (e) { LOG('join failed', e.message); } }
}
function doFav(name, on) {
    const r = root();
    if (r && typeof r.favChannel === 'function') { try { r.favChannel(name, on); } catch (e) { LOG('fav failed', e.message); } }
}
function openChannel(name) {
    const c = joinedChannels().find(x => (x.name || x.id) === name);
    if (c) select(c.id);
    return !!c;
}
// fcade:// links (spectate) go through here; the harness swaps in a spy
function openUri(u) {
    try { (window.__fcdOpenUri || ((x) => window.location.assign(x)))(u); } catch (e) { LOG('open failed', e.message); }
}

/* --------------------------------------------------------------------- API */

// every request goes through fc.api: one queue, one cache, one backoff for all of Fightcord
const fcApi = (body) => fc.api.request(body, { ttl: 2 * 60000 });
const pickRows = (j) => {
    const r = j?.results?.results || j?.results || j?.quarks || j?.rankings;
    return Array.isArray(r) ? r : [];
};
function quarkDate(row) {
    const d = row.date ?? row.created ?? row.time ?? row.timestamp;
    if (d == null) return null;
    const ms = typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : Date.parse(d);
    return isNaN(ms) ? null : ms;
}

// field names of the first API answers, in the log (Settings -> Diagnostics)
const seenShapes = {};
function noteShape(key, top, row) {
    if (seenShapes[key]) return;
    seenShapes[key] = true;
    LOG('api shape', key, { top: top && typeof top === 'object' ? Object.keys(top) : null, rowKeys: row ? Object.keys(row) : [] });
}

/* ------------------------------------------------------------------- style */

// Every declaration gets !important: FC's rules are [data-v-*]-scoped and the
// Discord theme marks its own !important. Keyframes are kept out of this.
function important(css) {
    return css.replace(/:\s*([^;{}]+?)\s*;/g, (m, v) => /!important$/.test(v) ? m : ': ' + v + ' !important;');
}

const NAV_W = 232;
const ART_H = 124;
const INFO_H = 76;

const CSS = `
html.fcd-browse .welcomeWrapper, html.fcd-browse .searchWrapper { margin-left: ${NAV_W}px; }

/* ================================ sidebar ================================ */
#fcdNav {
    display: none; position: fixed; top: 0; bottom: 0; left: var(--fcd-left, 72px); width: ${NAV_W}px; z-index: 5;
    background: var(--dc-bg2, #2b2d31); border-right: 1px solid var(--dc-divider, #3f4147);
    font-family: var(--dc-font, 'gg sans', 'Noto Sans', sans-serif); color: var(--dc-muted, #949ba4);
    flex-direction: column; user-select: none;
}
html.fcd-browse #fcdNav { display: flex; }
#fcdNav .fcdNavHead {
    flex: none; height: 48px; padding: 0 16px; display: flex; align-items: center;
    font-size: 16px; font-weight: 700; color: var(--dc-head, #f2f3f5);
    box-shadow: 0 1px 0 rgba(0,0,0,.2), 0 1.5px 0 rgba(0,0,0,.05), 0 2px 0 rgba(0,0,0,.05);
}
#fcdNav .fcdNavList { flex: 1; overflow-y: auto; padding: 8px 8px 16px; }
#fcdNav .fcdGear { margin-left: auto; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
    font-size: 17px; color: var(--dc-icon, #b5bac1); cursor: pointer; transition: background-color .15s ease, color .15s ease, transform .3s ease; }
#fcdNav .fcdGear:hover { background: var(--dc-hover, #2e3035); color: var(--dc-head, #f2f3f5); transform: rotate(45deg); }
#fcdNav .fcdNavList::-webkit-scrollbar { width: 4px; }
#fcdNav .fcdNavList::-webkit-scrollbar-thumb { background: var(--dc-bg3, #1e1f22); border-radius: 2px; }
#fcdNav .fcdNavSec {
    padding: 18px 8px 6px; font-size: 12px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase;
    color: var(--dc-muted, #949ba4);
}
#fcdNav .fcdNavItem {
    position: relative; display: flex; align-items: center; height: 40px; margin: 2px 0; padding: 0 8px;
    border-radius: 6px; cursor: pointer; font-size: 15px; font-weight: 500; color: var(--dc-muted, #949ba4);
    transition: background-color .15s ease, color .15s ease;
}
#fcdNav .fcdNavItem:hover { background: var(--dc-hover, #2e3035); color: var(--dc-text, #dbdee1); }
#fcdNav .fcdNavItem.on { background: var(--dc-active, #404249); color: var(--dc-head, #f2f3f5); }
#fcdNav .fcdNavItem::before {
    content: ''; position: absolute; left: -8px; top: 50%; width: 4px; height: 0; margin-top: 0;
    border-radius: 0 4px 4px 0; background: var(--dc-head, #f2f3f5);
    transition: height .2s cubic-bezier(.2,.8,.2,1), margin-top .2s cubic-bezier(.2,.8,.2,1);
}
#fcdNav .fcdNavItem:hover::before { height: 8px; margin-top: -4px; }
#fcdNav .fcdNavItem.on::before { height: 24px; margin-top: -12px; }
#fcdNav .fcdIco {
    flex: none; width: 28px; height: 28px; margin-right: 10px; display: flex; align-items: center; justify-content: center;
    font-size: 17px; line-height: 1;
}
.fcdSvg {
    width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
}
#fcdNav .fcdGear .fcdSvg { width: 18px; height: 18px; }
#fcdNav .fcdNavItem.on .fcdIco { color: var(--dc-head, #f2f3f5); }
#fcdNav .fcdTag {
    flex: none; width: 28px; height: 28px; margin-right: 10px; border-radius: 9px; display: flex; align-items: center;
    justify-content: center; font-size: 9px; font-weight: 800; color: #fff; letter-spacing: -.02em;
    transition: border-radius .2s ease;
}
#fcdNav .fcdNavItem:hover .fcdTag, #fcdNav .fcdNavItem.on .fcdTag { border-radius: 50%; }
#fcdNav .fcdLbl { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcdNav .fcdCnt { float: right; min-width: 18px; height: 18px; margin-top: 2px; padding: 0 5px; border-radius: 9px; box-sizing: border-box;
    font-size: 11px; font-weight: 800; line-height: 18px; text-align: center; color: #fff; background: var(--dc-green, #23a55a); }
#fcdNav .fcdCnt:empty { display: none; }
#fcdNav .fcdMore { overflow: hidden; max-height: 0; transition: max-height .3s ease; }
#fcdNav .fcdMore.open { max-height: 800px; }
#fcdNav .fcdMoreBtn { font-size: 13px; height: 32px; }
#fcdNav .fcdMoreBtn .fcdChev { margin-left: 6px; transition: transform .2s ease; display: inline-block; }
#fcdNav .fcdMoreBtn.open .fcdChev { transform: rotate(180deg); }

/* ============================ home: spotlight ============================ */
html.fcd-on .welcomeWrapper, html.fcd-on .searchWrapper { position: relative; background: var(--dc-bg, #313338); }
html.fcd-on .welcomeWrapper .contentWrapper,
html.fcd-on .searchWrapper .contentWrapper {
    position: relative; z-index: 1; background: transparent; background-image: none; padding-bottom: 32px;
}
html.fcd-on .welcomeWrapper .contentWrapper { display: flex; flex-direction: column; }
html.fcd-on .welcomeWrapper .contentWrapper > * { flex: none; }
/* the search bar sits on the page; the spotlight below it is the card */
html.fcd-on .welcomeWrapper .contentWrapper > header {
    order: -10; position: relative; z-index: 2;
    margin: 0; min-height: 0; padding: 16px 24px 0; border-radius: 0;
    display: flex; flex-direction: column; justify-content: flex-start; align-items: stretch; text-align: left;
    background: none; background-image: none; box-shadow: none;
}
html.fcd-on .welcomeWrapper .contentWrapper > header::before { display: none; }
html.fcd-on .welcomeWrapper header .inputWrapper { justify-content: flex-start; max-width: 560px; }

.fcdSpot {
    order: 2; position: relative; overflow: hidden; z-index: 0; display: none; min-height: 300px; margin-top: 16px;
    border-radius: 12px; background: var(--dc-float, #111214);
    box-shadow: 0 0 0 1px rgba(255,255,255,.05), 0 10px 34px rgba(0,0,0,.4);
}
.fcdSpot.has { display: flex; }
/* layers: blurred art (whole card) < sharp art (right) < shade < text / thumbs */
html.fcd-on .fcdHeroArt {
    position: absolute; top: -40px; left: -40px; right: -40px; bottom: -40px; z-index: 0; pointer-events: none;
    background-size: cover; background-position: center; opacity: 0;
    filter: blur(30px) saturate(1.5) brightness(.55); transition: opacity 1s ease;
}
html.fcd-on .fcdHeroArt.on { opacity: 1; }
.fcdSpot::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 2; pointer-events: none;
    background: linear-gradient(90deg, rgba(10,10,12,.9) 0%, rgba(10,10,12,.72) 34%, rgba(10,10,12,0) 62%),
                linear-gradient(180deg, rgba(0,0,0,0) 60%, rgba(0,0,0,.5) 100%);
}
.fcdSpotText {
    position: relative; z-index: 3; flex: none; width: 48%; min-width: 360px; padding: 28px 0 26px 32px;
    display: flex; flex-direction: column; justify-content: center;
}
.fcdSpotKicker { font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--dc-yellow, #f0b232); }
.fcdSpotTitle {
    margin-top: 8px; font-family: var(--dc-font, sans-serif); font-size: 36px; font-weight: 800; line-height: 42px; color: #fff;
    text-shadow: 0 2px 14px rgba(0,0,0,.6); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.fcdSpotSub { margin-top: 4px; font-size: 13px; color: rgba(255,255,255,.55); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdSpotMeta { margin-top: 14px; display: flex; flex-wrap: wrap; align-items: center; font-size: 14px; font-weight: 600; color: rgba(255,255,255,.9); }
.fcdSpotMeta > span { display: inline-flex; align-items: center; margin: 0 16px 4px 0; }
.fcdDot { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: var(--dc-green, #23a55a); flex: none; }
.fcdSpotBtns { margin-top: 18px; display: flex; align-items: center; flex-wrap: wrap; }
.fcdBtn {
    height: 40px; margin: 0 10px 6px 0; padding: 0 18px; border: 0; border-radius: 8px; display: inline-flex; align-items: center;
    font-family: var(--dc-font, sans-serif); font-size: 15px; font-weight: 700; color: #fff; background: rgba(255,255,255,.12);
    cursor: pointer; white-space: nowrap; transition: background-color .15s ease, transform .15s ease;
}
.fcdBtn:hover { background: rgba(255,255,255,.2); transform: translateY(-1px); }
.fcdBtn.go { background: #248046; }
.fcdBtn.go:hover { background: #1a6334; }
.fcdBtn.on { color: var(--dc-yellow, #f0b232); }
.fcdBtn.dis { opacity: .45; cursor: not-allowed; transform: none; }
.fcdBtn.sm { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 6px; }
.fcdSpotNav { margin-top: 16px; display: flex; align-items: center; }
.fcdDotNav {
    position: relative; overflow: hidden; width: 8px; height: 8px; margin-right: 8px; border-radius: 4px; cursor: pointer;
    background: rgba(255,255,255,.3); transition: width .3s ease, background-color .2s ease;
}
.fcdDotNav:hover { background: rgba(255,255,255,.55); }
.fcdDotNav.on { width: 34px; background: rgba(255,255,255,.25); }
.fcdDotNav.on::after {
    content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: calc(var(--p, 0) * 100%);
    background: #fff; border-radius: 4px; transition: width .3s linear;
}
.fcdSpotArrs { margin-left: 8px; display: flex; }
.fcdSpotArr {
    width: 30px; height: 30px; margin-left: 6px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,.12); color: #fff; font-size: 18px; cursor: pointer; transition: background-color .15s ease;
}
.fcdSpotArr:hover { background: rgba(255,255,255,.25); }
.fcdSpotArt {
    position: absolute; top: 0; right: 0; bottom: 0; width: 66%; z-index: 1; overflow: hidden; cursor: pointer;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, rgba(0,0,0,.6) 22%, #000 45%);
}
.fcdSpotArt > i {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0; opacity: 0; transition: opacity .7s ease;
    background-size: cover; background-position: center 30%; image-rendering: pixelated;
}
.fcdSpotArt > i.on { opacity: 1; }
.fcdSpotThumbs { position: absolute; right: 20px; bottom: 18px; z-index: 3; display: flex; }
.fcdSpot.narrow .fcdSpotThumbs { display: none; }
.fcdSpotThumb {
    width: 80px; height: 46px; margin-left: 8px; border-radius: 6px; cursor: pointer; opacity: .55;
    background: #000 center / cover no-repeat; box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 4px 12px rgba(0,0,0,.5);
    transition: opacity .2s ease, transform .2s ease, box-shadow .2s ease;
}
.fcdSpotThumb:hover { opacity: .9; transform: translateY(-3px); }
.fcdSpotThumb.on { opacity: 1; box-shadow: 0 0 0 2px var(--dc-blurple, #5865f2); }

/* ambient glow behind the page, in the colours of the game in focus */
.fcdAmbient { display: none; position: absolute; top: 0; left: 0; right: 0; height: 560px; z-index: 0; overflow: hidden; pointer-events: none;
    -webkit-mask-image: linear-gradient(180deg, #000 20%, transparent 100%); }
html.fcd-glow .fcdAmbient { display: block; }
.fcdAmbient > i {
    position: absolute; top: -80px; left: -80px; right: -80px; bottom: -80px; opacity: 0;
    background-size: cover; background-position: center; filter: blur(70px) saturate(1.7);
    transition: opacity 1s ease;
}
.fcdAmbient > i.on { opacity: .34; }

/* ============================ search inputs ============================= */
html.fcd-on .welcomeWrapper header .inputWrapper,
html.fcd-on .searchWrapper header .inputWrapper {
    position: relative; width: 100%; max-width: 640px; display: flex; flex-direction: row; align-items: center;
    justify-content: center; padding-left: 0;
}
html.fcd-on .welcomeWrapper header .inputWrapper .text-filter,
html.fcd-on .searchWrapper header .inputWrapper .text-filter {
    flex: 1; min-width: 0; width: auto; height: 44px; margin: 0; padding: 0 16px 0 44px; border: 0; border-radius: 8px;
    font-family: var(--dc-font, sans-serif); font-size: 16px; text-align: left; color: var(--dc-text, #dbdee1);
    background: var(--dc-bg3, #1e1f22) no-repeat 14px center / 18px 18px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23949ba4' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='M15.5 15.5L21 21'/%3E%3C/svg%3E");
    box-shadow: 0 0 0 0 transparent; transition: box-shadow .15s ease;
}
html.fcd-on .welcomeWrapper header .inputWrapper .text-filter:focus,
html.fcd-on .searchWrapper header .inputWrapper .text-filter:focus { box-shadow: 0 0 0 2px var(--dc-blurple, #5865f2); }
html.fcd-on .welcomeWrapper header .inputWrapper .text-filter::-webkit-input-placeholder,
html.fcd-on .searchWrapper header .inputWrapper .text-filter::-webkit-input-placeholder { color: var(--dc-muted, #949ba4); }
html.fcd-on .welcomeWrapper header .filtersButton,
html.fcd-on .searchWrapper header .filtersButton {
    flex: none; width: 44px; height: 44px; margin-left: 8px; border-radius: 8px; display: flex; align-items: center;
    justify-content: center; background: var(--dc-bg3, #1e1f22); cursor: pointer; transition: background-color .15s ease;
}
html.fcd-on .welcomeWrapper header .filtersButton:hover,
html.fcd-on .searchWrapper header .filtersButton:hover { background: var(--dc-hover, #2e3035); }
html.fcd-on .welcomeWrapper header .filtersButton .filtersButtonIcon,
html.fcd-on .searchWrapper header .filtersButton .filtersButtonIcon { width: 20px; height: 20px; fill: var(--dc-icon, #b5bac1); filter: none; }
html.fcd-on .welcomeWrapper header .filtersButton.active .filtersButtonIcon,
html.fcd-on .searchWrapper header .filtersButton.active .filtersButtonIcon { fill: var(--dc-blurple, #5865f2); filter: none; }
html.fcd-on .welcomeWrapper header .filtersWrapper,
html.fcd-on .searchWrapper header .filtersWrapper { margin-top: 12px; }
html.fcd-on .welcomeWrapper header .filtersWrapper .filtersList,
html.fcd-on .searchWrapper header .filtersWrapper .filtersList { margin-bottom: 0; }
html.fcd-on .welcomeWrapper header .filterItem,
html.fcd-on .searchWrapper header .filterItem { margin: 4px 8px 4px 0; text-align: left; }
html.fcd-on .welcomeWrapper header .filterItem .title,
html.fcd-on .searchWrapper header .filterItem .title {
    margin-bottom: 6px; font-size: 12px; font-weight: 700; color: var(--dc-muted, #949ba4); text-shadow: none;
}
html.fcd-on .welcomeWrapper header .filterItem select,
html.fcd-on .searchWrapper header .filterItem select {
    height: 34px; min-width: 150px; padding: 0 8px; border: 0; border-radius: 6px; box-shadow: none;
    background: var(--dc-bg3, #1e1f22); color: var(--dc-text, #dbdee1); font-size: 14px; cursor: pointer;
}
html.fcd-on .welcomeWrapper header .filterItem select option,
html.fcd-on .searchWrapper header .filterItem select option { color: var(--dc-text, #dbdee1); background: var(--dc-bg3, #1e1f22); }

/* results view: compact sticky bar */
html.fcd-on .searchWrapper .contentWrapper > header {
    position: sticky; top: 0; z-index: 6; padding: 14px 24px 12px; text-align: left;
    background: var(--dc-bg, #313338); background-image: none;
    box-shadow: 0 1px 0 rgba(0,0,0,.2), 0 2px 10px rgba(0,0,0,.18);
}
html.fcd-on .searchWrapper header .inputWrapper { justify-content: flex-start; max-width: 720px; }
html.fcd-on .searchWrapper header .filtersWrapper .filtersList { justify-content: flex-start; }
html.fcd-on .searchWrapper header .filtersWrapper { display: none; }
html.fcd-on .searchWrapper header .filtersWrapper.active { display: flex; align-items: flex-end; flex-wrap: wrap; }
html.fcd-on .searchWrapper header .filtersWrapper .button-alt {
    margin: 4px 0 4px 4px; height: 34px; line-height: 34px; padding: 0 12px; border: 0; border-radius: 6px;
    background: transparent; color: var(--dc-link, #00a8fc); font-size: 14px; font-weight: 500; box-shadow: none; text-shadow: none;
}
html.fcd-on .searchWrapper header .filtersWrapper .button-alt:hover { text-decoration: underline; }

/* ================================ rows ================================== */
html.fcd-on .welcomeListWrapper { overflow: visible; margin: 14px 0 0; }
html.fcd-on .welcomeListWrapper .titleWrapper,
html.fcd-on #fcdYours .fcdRowHead,
html.fcd-on #fcdLive .fcdRowHead {
    display: flex; align-items: center; padding: 14px 24px 0; text-transform: none; text-shadow: none;
}
html.fcd-on .welcomeListWrapper .titleWrapper h3,
html.fcd-on #fcdYours .fcdRowHead h3,
html.fcd-on #fcdLive .fcdRowHead h3 {
    flex: 1; display: flex; align-items: center; margin: 0; font-family: var(--dc-font, sans-serif); font-size: 18px; font-weight: 700;
    line-height: 24px; text-transform: none; color: var(--dc-head, #f2f3f5); text-shadow: none;
}
/* count chip after the heading */
html.fcd-on .welcomeListWrapper .titleWrapper h3[data-fcd-n]:not([data-fcd-n=""])::after,
.fcdCount {
    margin-left: 10px; height: 20px; padding: 0 7px; border-radius: 10px; display: inline-flex; align-items: center;
    font-size: 12px; font-weight: 700; line-height: 1; color: var(--dc-text, #dbdee1); background: var(--dc-bg3, #1e1f22);
}
html.fcd-on .welcomeListWrapper .titleWrapper h3[data-fcd-n]:not([data-fcd-n=""])::after { content: attr(data-fcd-n); }
html.fcd-on .welcomeListWrapper .titleWrapper h3::first-letter { text-transform: uppercase; }
html.fcd-on .welcomeListWrapper .welcomeListGrid,
html.fcd-on .welcomeListWrapper .welcomeListGridBig,
html.fcd-on #fcdYours .fcdYoursGrid,
html.fcd-on #fcdLive .fcdYoursGrid {
    display: grid; grid-auto-flow: column; grid-template-columns: none; grid-template-rows: auto; grid-auto-rows: auto;
    grid-auto-columns: var(--fcd-col, 224px); grid-gap: 16px; width: auto; overflow-x: auto; overflow-y: hidden;
    padding: 14px 24px 18px; scroll-snap-type: x proximity; scroll-padding: 0 24px; scroll-behavior: smooth;
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 56px), transparent 100%);
}
html.fcd-on .welcomeListWrapper[data-fcd-edge~="start"] .welcomeListGrid,
html.fcd-on .welcomeListWrapper[data-fcd-edge~="start"] .welcomeListGridBig,
html.fcd-on #fcdYours[data-fcd-edge~="start"] .fcdYoursGrid,
html.fcd-on #fcdLive[data-fcd-edge~="start"] .fcdYoursGrid {
    -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 56px), transparent 100%);
}
html.fcd-on .welcomeListWrapper[data-fcd-edge~="start"][data-fcd-edge~="end"] .welcomeListGrid,
html.fcd-on .welcomeListWrapper[data-fcd-edge~="start"][data-fcd-edge~="end"] .welcomeListGridBig,
html.fcd-on #fcdYours[data-fcd-edge~="start"][data-fcd-edge~="end"] .fcdYoursGrid,
html.fcd-on #fcdLive[data-fcd-edge~="start"][data-fcd-edge~="end"] .fcdYoursGrid { -webkit-mask-image: none; }
html.fcd-on .welcomeListWrapper .welcomeListGrid::-webkit-scrollbar,
html.fcd-on .welcomeListWrapper .welcomeListGridBig::-webkit-scrollbar,
html.fcd-on #fcdYours .fcdYoursGrid::-webkit-scrollbar,
html.fcd-on #fcdLive .fcdYoursGrid::-webkit-scrollbar { height: 0; display: none; }
html.fcd-on .welcomeListWrapper .gridWrapper { margin: 0; scroll-snap-align: start; }
html.fcd-on .welcomeListWrapper[data-fcd-row="cat"] .welcomeListGrid,
html.fcd-on .welcomeListWrapper[data-fcd-row="cat"] .welcomeListGridBig { grid-auto-columns: var(--fcd-col, 176px); }

.fcdArrows { flex: none; display: flex; align-items: center; opacity: 0; transition: opacity .2s ease; }
.welcomeListWrapper:hover .fcdArrows, #fcdYours:hover .fcdArrows, #fcdLive:hover .fcdArrows { opacity: 1; }
.fcdArr {
    width: 32px; height: 32px; margin-left: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: var(--dc-bg3, #1e1f22); color: var(--dc-text, #dbdee1); font-size: 20px; line-height: 1; cursor: pointer;
    transition: background-color .15s ease, opacity .15s ease, transform .15s ease;
}
.fcdArr:hover { background: var(--dc-active, #404249); transform: scale(1.08); }
.fcdArr.off { opacity: .3; pointer-events: none; }
.fcdSeeAll {
    margin-right: 8px; font-size: 14px; font-weight: 600; color: var(--dc-link, #00a8fc); cursor: pointer;
}
.fcdSeeAll:hover { text-decoration: underline; }

/* ============================ game cards ================================ */
html.fcd-on .channelPreviewWrapper,
html.fcd-on .eventPreviewWrapper {
    position: relative; height: 100%; min-height: ${ART_H + INFO_H}px; padding-bottom: ${INFO_H}px; overflow: hidden;
    border-radius: 8px; text-align: left; background: var(--dc-bg3, #1e1f22); background-image: none;
    box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.04)), 0 2px 6px rgba(0,0,0,.25);
    transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease; z-index: 1;
}
html.fcd-on .channelPreviewWrapper:hover,
html.fcd-on .eventPreviewWrapper:hover {
    transform: translateY(-6px) scale(1.04); z-index: 5;
    box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.06)), 0 14px 30px rgba(0,0,0,.5);
}
html.fcd-on .channelPreviewWrapper .thumbnail,
html.fcd-on .eventPreviewWrapper .thumbnail {
    position: static; display: block; width: 100%; height: ${ART_H}px; margin: 0; border-radius: 0; box-shadow: none;
    background-color: var(--dc-float, #111214); background-repeat: no-repeat; background-size: 100% auto; background-position: center 35%;
    transition: background-size .45s cubic-bezier(.2,.8,.2,1);
}
html.fcd-on .channelPreviewWrapper:hover .thumbnail,
html.fcd-on .eventPreviewWrapper:hover .thumbnail { background-size: 110% auto; }
html.fcd-on .channelPreviewWrapper .thumbnail[lazy="error"]::before,
html.fcd-on .eventPreviewWrapper .thumbnail[lazy="error"]::before {
    top: 0; left: 0; right: 0; bottom: auto; height: ${ART_H}px; z-index: 0; font-size: 11px; background: var(--dc-float, #111214);
    box-shadow: none; color: var(--dc-faint, #6d6f78);
}
html.fcd-on .channelPreviewWrapper .channelExtraInfoWrapper {
    position: absolute; top: 0; left: 0; right: 0; width: auto; height: ${ART_H}px; padding: 8px; z-index: 2;
    display: flex; flex-direction: row; align-items: flex-start; justify-content: flex-start;
    background-image: none;
}
/* no backdrop-filter anywhere: FC's Chromium 80 paints the whole card black under it */
html.fcd-on .channelPreviewWrapper .channelExtraInfo {
    height: 24px; padding: 0 8px; border-radius: 12px; display: flex; align-items: center;
    background: rgba(17,18,20,.82); box-shadow: 0 1px 4px rgba(0,0,0,.35);
}
html.fcd-on .channelPreviewWrapper .channelExtraInfo .num-users { font-size: 12px; font-weight: 700; color: #fff; }
html.fcd-on .channelPreviewWrapper .channelExtraInfo .num-users .usersIconSvg { display: none; }
html.fcd-on .channelPreviewWrapper .channelExtraInfo .num-users::before {
    content: ''; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: var(--dc-green, #23a55a);
}
html.fcd-on .channelPreviewWrapper .channelExtraInfo .favStatus {
    height: auto; padding: 0; margin: 0 6px 0 0; border: 0; background: none; color: var(--dc-yellow, #f0b232);
    text-shadow: none; font-size: 13px;
}
html.fcd-on .channelPreviewWrapper .channelExtraInfo .rankedStatus {
    display: flex; align-items: center; height: 14px; margin-left: 7px; padding-left: 7px;
    border-left: 1px solid rgba(255,255,255,.2); fill: var(--dc-yellow, #f0b232);
}
html.fcd-on .channelPreviewWrapper .channelExtraInfo .rankedStatus svg { width: 13px; height: 13px; }
html.fcd-on .channelPreviewWrapper .channelInfoWrapper,
html.fcd-on .eventPreviewWrapper .eventInfoWrapper {
    position: absolute; left: 0; right: 0; top: auto; bottom: 0; width: auto; min-height: ${INFO_H}px; z-index: 3;
    padding: 10px 12px 12px; border-radius: 0; text-align: left; text-shadow: none;
    display: flex; flex-direction: column; align-items: flex-start;
    background: var(--dc-bg3, #1e1f22); background-image: none;
    transition: box-shadow .22s ease;
}
html.fcd-on .channelPreviewWrapper .channelInfoWrapper .name { align-self: stretch; }
html.fcd-on .channelPreviewWrapper .channelInfoWrapper .system { margin-top: auto; }
html.fcd-on .channelPreviewWrapper .channelInfoWrapper .name,
html.fcd-on .eventPreviewWrapper .eventInfoWrapper .name {
    margin: 0; padding: 0; font-family: var(--dc-font, sans-serif); font-size: 14px; font-weight: 600; line-height: 18px;
    text-transform: none; color: var(--dc-head, #f2f3f5); white-space: normal; text-overflow: clip;
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
html.fcd-on .channelPreviewWrapper:hover .channelInfoWrapper,
html.fcd-on .eventPreviewWrapper:hover .eventInfoWrapper { box-shadow: 0 -10px 16px rgba(0,0,0,.35); }
html.fcd-on .channelPreviewWrapper:hover .channelInfoWrapper .name,
html.fcd-on .eventPreviewWrapper:hover .eventInfoWrapper .name { -webkit-line-clamp: 4; }
html.fcd-on .channelPreviewWrapper .channelInfoWrapper .system {
    display: inline-block; margin: 6px 0 0; padding: 1px 6px; border-radius: 4px; flex: none;
    background: var(--dc-active, #404249); color: var(--dc-text, #dbdee1); font-size: 11px; font-weight: 600; text-transform: none;
}
html.fcd-on .eventPreviewWrapper .eventInfoWrapper .date {
    margin: 4px 0 0; font-size: 12px; font-weight: 500; text-transform: none; color: var(--dc-muted, #949ba4);
}
html.fcd-on .channelPreviewWrapper.fcd-joined { cursor: pointer; }
html.fcd-on .channelPreviewWrapper.fcd-joined .channelInfoWrapper { flex-direction: row; flex-wrap: wrap; align-content: flex-start; }
html.fcd-on .channelPreviewWrapper.fcd-joined .channelInfoWrapper .name { flex: 0 0 100%; }
html.fcd-on .channelPreviewWrapper.fcd-joined .channelInfoWrapper::after {
    content: '\\2713  Joined'; display: inline-block; margin: 6px 0 0 6px; padding: 1px 6px; border-radius: 4px; align-self: flex-end;
    background: rgba(35,165,90,.18); color: #2dc770; font-size: 11px; font-weight: 600;
}

/* Join / Fav: slide in at the top right of the art */
html.fcd-on .channelPreviewWrapper .channelActions,
html.fcd-on .eventPreviewWrapper .eventActions {
    position: absolute; top: 8px; right: 8px; left: auto; bottom: auto; width: auto; height: auto; z-index: 4;
    display: flex; flex-direction: row; align-items: center; justify-content: flex-end; padding: 0; border-radius: 0;
    background: none; background-image: none; opacity: 0; transform: translateY(-6px);
    transition: opacity .18s ease, transform .18s ease;
}
html.fcd-on .channelPreviewWrapper:hover .channelActions,
html.fcd-on .eventPreviewWrapper:hover .eventActions { opacity: 1; transform: translateY(0); }
html.fcd-on .channelPreviewWrapper .channelActions .channelSubActions,
html.fcd-on .eventPreviewWrapper .eventActions .eventSubActions { width: auto; display: flex; align-items: center; }
html.fcd-on .channelPreviewWrapper .channelActions .patronExclusive,
html.fcd-on .eventPreviewWrapper .eventActions .patronExclusive {
    width: auto; margin: 0 6px 0 0; padding: 3px 8px; border-radius: 4px; background: rgba(17,18,20,.8);
    font-size: 11px; text-shadow: none; color: var(--dc-yellow, #f0b232);
}
html.fcd-on .channelPreviewWrapper .channelActions .button-generic,
html.fcd-on .eventPreviewWrapper .eventActions .button-generic {
    width: auto; height: 28px; margin: 0 0 0 6px; padding: 0 12px; border: 0; border-radius: 4px; box-shadow: none;
    display: inline-flex; align-items: center; font-family: var(--dc-font, sans-serif); font-size: 13px; font-weight: 600;
    line-height: 28px; text-transform: none; text-shadow: none; color: #fff; background: rgba(17,18,20,.82);
    transition: background-color .15s ease;
}
html.fcd-on .channelPreviewWrapper .channelActions .button-generic:hover,
html.fcd-on .eventPreviewWrapper .eventActions .button-generic:hover { background: var(--dc-btn-h, #6d6f78); }
html.fcd-on .channelPreviewWrapper .channelActions .joinButton,
html.fcd-on .eventPreviewWrapper .eventActions .joinButton { background: #248046; }
html.fcd-on .channelPreviewWrapper .channelActions .joinButton:hover,
html.fcd-on .eventPreviewWrapper .eventActions .joinButton:hover { background: #1a6334; }

/* event "when" pill */
html.fcd-on .eventPreviewWrapper[data-fcd-when]::before {
    content: attr(data-fcd-when); position: absolute; top: 8px; left: 8px; z-index: 2; height: 22px; padding: 0 8px;
    border-radius: 11px; display: flex; align-items: center; font-size: 12px; font-weight: 700; color: #fff;
    background: rgba(17,18,20,.85); box-shadow: 0 1px 4px rgba(0,0,0,.35);
}
html.fcd-on .eventPreviewWrapper[data-fcd-live]::before { background: var(--dc-red, #f23f43); }

/* ========================== category tiles ============================== */
html.fcd-on .categoryPreviewWrapper {
    position: relative; overflow: hidden; border-radius: 8px; background: var(--dc-bg3, #1e1f22); background-image: none;
    box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.04)), 0 2px 6px rgba(0,0,0,.25);
    transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease;
}
html.fcd-on .categoryPreviewWrapper:hover { transform: translateY(-4px); box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.06)), 0 10px 22px rgba(0,0,0,.45); }
html.fcd-on .categoryPreviewWrapper .thumbnail {
    height: 88px; border-radius: 8px; box-shadow: none; display: flex; align-items: center; justify-content: center;
    background-size: 100% auto; background-position: center; background-repeat: no-repeat;
    transition: background-size .45s cubic-bezier(.2,.8,.2,1);
}
html.fcd-on .categoryPreviewWrapper:hover .thumbnail { background-size: 112% auto; }
html.fcd-on .categoryPreviewWrapper .thumbnail .favorite {
    margin-top: -18px; font-size: 34px; color: var(--dc-yellow, #f0b232); text-shadow: 0 0 18px rgba(240,178,50,.45);
}
html.fcd-on .categoryPreviewWrapper .categoryInfoWrapper {
    padding-top: 28px; border-radius: 0 0 8px 8px; text-align: left; text-shadow: none;
    background-image: linear-gradient(transparent, rgba(0,0,0,.8));
}
html.fcd-on .categoryPreviewWrapper .categoryInfoWrapper .name {
    margin: 0 0 8px; padding: 0 10px; font-family: var(--dc-font, sans-serif); font-size: 14px; font-weight: 700;
    text-transform: none; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.7);
}
/* the whole tile is the Browse button */
html.fcd-on .categoryPreviewWrapper .categoryActions { opacity: 1; background: none; background-image: none; }
html.fcd-on .categoryPreviewWrapper .categoryActions .browseButton {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0; width: auto; height: auto; margin: 0; opacity: 0; cursor: pointer;
}

/* ============================ your games ================================ */
#fcdYours { display: none; order: -6; margin: 14px 0 0; }
html.fcd-on #fcdYours.has { display: block; }
html.fcd-on #fcdYours .fcdYoursGrid {
    grid-auto-flow: row; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); grid-auto-columns: auto;
    overflow: visible; scroll-snap-type: none; -webkit-mask-image: none;
}
#fcdYours .fcdArrows { display: none; }
#fcdYours .fcdTile.fcdHid { display: none; }
#fcdYours.all .fcdTile.fcdHid { display: flex; }
.fcdShowAll { flex: none; font-size: 14px; font-weight: 600; color: var(--dc-link, #00a8fc); cursor: pointer; }
.fcdShowAll:hover { text-decoration: underline; }
.fcdTile {
    position: relative; height: 72px; display: flex; align-items: center; overflow: hidden; border-radius: 8px; cursor: pointer;
    background: var(--dc-bg3, #1e1f22);
    box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.04)), 0 2px 6px rgba(0,0,0,.25);
    transition: transform .18s ease, box-shadow .18s ease, background-color .18s ease;
}
.fcdTile:hover { transform: translateY(-2px); background: var(--dc-hover, #2e3035); box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.06)), 0 8px 18px rgba(0,0,0,.4); }
.fcdTileArt {
    position: relative; flex: none; width: 96px; height: 72px; display: flex; align-items: center; justify-content: center;
    background: var(--dc-float, #111214) no-repeat center 35% / cover; image-rendering: pixelated;
}
.fcdTileIni { font-size: 18px; font-weight: 800; color: var(--dc-muted, #949ba4); letter-spacing: -.02em; }
.fcdTileArt.art .fcdTileIni { display: none; }
.fcdTilePlay {
    flex: none; width: 34px; height: 34px; margin-right: 14px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; padding-left: 3px;
    background: #248046; color: #fff; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,.35);
    opacity: 0; transform: scale(.85); transition: opacity .15s ease, transform .15s ease;
}
.fcdTile:hover .fcdTilePlay { opacity: 1; transform: scale(1); }
.fcdTileBody { flex: 1; min-width: 0; padding: 0 12px 0 14px; }
.fcdTileName {
    font-size: 14px; font-weight: 600; line-height: 18px; color: var(--dc-head, #f2f3f5);
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.fcdTileSub { margin-top: 4px; font-size: 12px; color: var(--dc-muted, #949ba4); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdTileSub .fcdOn { display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; background: var(--dc-green, #23a55a); }
#fcdYours.flash .fcdRowHead h3 { color: var(--dc-blurple, #5865f2); transition: color .3s ease; }

/* ============================ results view ============================== */
html.fcd-on .searchResultsWrapper { padding: 4px 0 16px; background: none; background-image: none; height: auto; }
html.fcd-on .searchResultsWrapper .titleWrapper {
    display: flex; align-items: baseline; padding: 20px 24px 2px; text-transform: none; text-shadow: none;
}
html.fcd-on .searchResultsWrapper .titleWrapper h3 {
    font-family: var(--dc-font, sans-serif); font-size: 20px; font-weight: 700; text-transform: none; color: var(--dc-head, #f2f3f5);
}
html.fcd-on .searchResultsWrapper .titleWrapper[data-fcd-title] h3 { display: none; }
html.fcd-on .searchResultsWrapper .titleWrapper[data-fcd-title]::before {
    content: attr(data-fcd-title); font-family: var(--dc-font, sans-serif); font-size: 20px; font-weight: 700; color: var(--dc-head, #f2f3f5);
}
html.fcd-on .searchResultsWrapper .titleWrapper[data-fcd-count]::after {
    content: attr(data-fcd-count); margin-left: 10px; font-size: 14px; font-weight: 500; color: var(--dc-muted, #949ba4);
}
html.fcd-on .searchResultsWrapper .searchResultsGrid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr)); grid-gap: 16px; overflow: visible;
    width: auto; padding: 14px 24px 16px;
}
html.fcd-on .searchResultsWrapper .searchResultsGrid > .channelWrapper {
    position: relative; margin: 0; width: auto; border-radius: 8px; text-align: left; background: none; background-image: none; box-shadow: none;
}
html.fcd-on .searchResultsWrapper .no-results { padding: 48px 32px; color: var(--dc-muted, #949ba4); font-size: 16px; }
html.fcd-on .searchResultsWrapper .no-results .emoji { font-size: 28px; margin-bottom: 12px; color: var(--dc-text, #dbdee1); }
html.fcd-on .searchResultsWrapper .paginationWrapper { margin: 8px 24px 0; padding: 0 0 8px; border-top: 1px solid var(--dc-divider, #3f4147); }
html.fcd-on .searchResultsWrapper .paginationWrapper .button-alt {
    display: inline-block; height: 32px; line-height: 32px; padding: 0 16px; border: 0; border-radius: 4px; box-shadow: none;
    background: var(--dc-btn, #4e5058); color: #fff; font-size: 14px; font-weight: 500; text-transform: none; text-shadow: none;
    transition: background-color .15s ease;
}
html.fcd-on .searchResultsWrapper .paginationWrapper .button-alt:hover { background: var(--dc-btn-h, #6d6f78); }
html.fcd-on .searchResultsWrapper .paginationWrapper .button-alt.disabled { opacity: .4; pointer-events: none; }
html.fcd-on .searchResultsWrapper .paginationWrapper .range { color: var(--dc-muted, #949ba4); font-size: 13px; }
html.fcd-on .searchResultsWrapper .paginationWrapper .range span { color: var(--dc-text, #dbdee1); }

/* ========================= loading skeletons ============================ */
html.fcd-on .welcomeWrapper .contentWrapper > .spinnerWrapper,
html.fcd-on .searchResultsWrapper .spinnerWrapper {
    position: relative; overflow: hidden; height: ${ART_H + INFO_H}px; margin: 30px 24px 0; text-align: left;
    background: repeating-linear-gradient(90deg, var(--dc-bg3, #1e1f22) 0, var(--dc-bg3, #1e1f22) 224px, transparent 224px, transparent 240px);
    border-radius: 8px;
}
html.fcd-on .welcomeWrapper .contentWrapper > .spinnerWrapper .spinner,
html.fcd-on .searchResultsWrapper .spinnerWrapper .spinner,
html.fcd-on .searchResultsWrapper .spinnerWrapper .message { display: none; }
html.fcd-on .welcomeWrapper .contentWrapper > .spinnerWrapper::after,
html.fcd-on .searchResultsWrapper .spinnerWrapper::after {
    content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 45%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.05), transparent);
}
`;

const CSS2 = `
/* ============================ shared bits =============================== */
.fcdRank { margin-left: 5px; }
.fcdFlag { width: 16px; height: 11px; margin-right: 5px; border-radius: 2px; flex: none; vertical-align: middle; }
.fcdAva { width: 44px; height: 44px; border-radius: 50%; background: var(--dc-bg3, #1e1f22); flex: none; }
.fcdSys {
    display: inline-block; margin: 6px 0 0; padding: 1px 6px; border-radius: 4px;
    background: var(--dc-active, #404249); color: var(--dc-text, #dbdee1); font-size: 11px; font-weight: 600;
}
.fcdJoined {
    display: inline-block; margin: 6px 0 0 6px; padding: 1px 6px; border-radius: 4px;
    background: rgba(35,165,90,.18); color: #2dc770; font-size: 11px; font-weight: 600;
}
.fcdSkel {
    position: relative; overflow: hidden; height: 34px; margin: 6px 0; border-radius: 6px; background: var(--dc-bg3, #1e1f22);
}
.fcdSkel::after {
    content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 45%;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.05), transparent);
}
.fcdMuted { color: var(--dc-muted, #949ba4); font-size: 13px; padding: 6px 0; }

/* ============================== game page =============================== */
#fcdGameDim {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 900; background: rgba(0,0,0,.55);
    opacity: 0; pointer-events: none; transition: opacity .25s ease;
}
#fcdGameDim.open { opacity: 1; pointer-events: auto; }
#fcdGame {
    position: fixed; top: 0; right: 0; bottom: 0; width: 460px; max-width: 92vw; z-index: 901; overflow: hidden;
    display: flex; flex-direction: column; background: var(--dc-bg2, #2b2d31); color: var(--dc-text, #dbdee1);
    font-family: var(--dc-font, 'gg sans', 'Noto Sans', sans-serif); box-shadow: -12px 0 40px rgba(0,0,0,.5);
    transform: translateX(105%); transition: transform .32s cubic-bezier(.2,.8,.2,1);
}
#fcdGame.open { transform: translateX(0); }
#fcdGame .fcdGHead { position: relative; flex: none; height: 210px; overflow: hidden; background: #000; }
#fcdGame .fcdGBg {
    position: absolute; top: -30px; left: -30px; right: -30px; bottom: -30px; background-size: cover; background-position: center;
    filter: blur(22px) saturate(1.5) brightness(.6);
}
#fcdGame .fcdGArt {
    position: absolute; top: 22px; left: 50%; width: 224px; height: 168px; margin-left: -112px; border-radius: 8px;
    background: #000 center / cover no-repeat; image-rendering: pixelated;
    box-shadow: 0 14px 34px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.1);
}
#fcdGame .fcdGHead::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 60px;
    background: linear-gradient(180deg, transparent, var(--dc-bg2, #2b2d31));
}
#fcdGame .fcdGClose {
    position: absolute; top: 12px; right: 12px; z-index: 2; width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 16px; color: #fff;
    background: rgba(0,0,0,.55); transition: background-color .15s ease, transform .15s ease;
}
#fcdGame .fcdGClose:hover { background: rgba(0,0,0,.8); transform: rotate(90deg); }
#fcdGame .fcdGScroll { flex: 1; overflow-y: auto; padding: 4px 20px 24px; }
#fcdGame .fcdGScroll::-webkit-scrollbar { width: 6px; }
#fcdGame .fcdGScroll::-webkit-scrollbar-thumb { background: var(--dc-bg3, #1e1f22); border-radius: 3px; }
#fcdGame .fcdGName { font-size: 22px; font-weight: 800; line-height: 28px; color: var(--dc-head, #f2f3f5); }
#fcdGame .fcdGFull { margin-top: 2px; font-size: 12px; color: var(--dc-muted, #949ba4); }
#fcdGame .fcdGTags { margin-top: 6px; }
#fcdGame .fcdGTags .fcdSys, #fcdGame .fcdGTags .fcdJoined { margin: 4px 6px 0 0; }
#fcdGame .fcdGStats { margin-top: 12px; display: flex; flex-wrap: wrap; font-size: 14px; font-weight: 600; color: var(--dc-text, #dbdee1); }
#fcdGame .fcdGStats > span { display: inline-flex; align-items: center; margin: 0 16px 4px 0; }
#fcdGame .fcdGBtns { margin-top: 14px; display: flex; flex-wrap: wrap; }
#fcdGame .fcdGBtns .fcdBtn { background: var(--dc-btn, #4e5058); }
#fcdGame .fcdGBtns .fcdBtn:hover { background: var(--dc-btn-h, #6d6f78); }
#fcdGame .fcdGBtns .fcdBtn.go { background: #248046; }
#fcdGame .fcdGBtns .fcdBtn.go:hover { background: #1a6334; }
#fcdGame section { margin-top: 22px; }
#fcdGame section h4 {
    margin: 0 0 8px; font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--dc-muted, #949ba4);
}
#fcdGame .fcdGRow {
    display: flex; align-items: center; min-height: 36px; padding: 6px 8px; margin: 0 -8px; border-radius: 6px; font-size: 14px;
    transition: background-color .15s ease;
}
#fcdGame .fcdGRow:hover { background: var(--dc-hover, #2e3035); }
#fcdGame .fcdGPos { width: 26px; flex: none; font-weight: 800; color: var(--dc-muted, #949ba4); }
#fcdGame .fcdGRow:nth-child(1) .fcdGPos { color: #ffd166; }
#fcdGame .fcdGRow:nth-child(2) .fcdGPos { color: #c9d1d9; }
#fcdGame .fcdGRow:nth-child(3) .fcdGPos { color: #e0a36b; }
#fcdGame .fcdGWho { flex: 1; min-width: 0; display: flex; align-items: center; overflow: hidden; white-space: nowrap; }
#fcdGame .fcdGWho b { font-weight: 600; color: var(--dc-head, #f2f3f5); overflow: hidden; text-overflow: ellipsis; }
#fcdGame .fcdGRight { flex: none; margin-left: 8px; font-size: 12px; color: var(--dc-muted, #949ba4); display: flex; align-items: center; }
#fcdGame .fcdGMatch { display: flex; align-items: center; flex: 1; min-width: 0; }
#fcdGame .fcdGSide { flex: 1; min-width: 0; display: flex; align-items: center; overflow: hidden; white-space: nowrap; }
#fcdGame .fcdGSide.r { justify-content: flex-end; }
#fcdGame .fcdGSide b { font-weight: 600; color: var(--dc-text, #dbdee1); overflow: hidden; text-overflow: ellipsis; }
#fcdGame .fcdGSide b.win { color: var(--dc-head, #f2f3f5); }
#fcdGame .fcdGScore { flex: none; margin: 0 8px; font-weight: 800; color: var(--dc-head, #f2f3f5); font-variant-numeric: tabular-nums; }
#fcdGame .fcdGVs { flex: none; margin: 0 8px; font-size: 11px; font-weight: 800; color: var(--dc-muted, #949ba4); }
#fcdGame .fcdLink { margin-left: 8px; color: var(--dc-link, #00a8fc); cursor: pointer; font-weight: 600; }
#fcdGame .fcdLink:hover { text-decoration: underline; }
#fcdGame .fcdYou { display: flex; flex-wrap: wrap; }
#fcdGame .fcdYou > div {
    flex: 1 1 30%; min-width: 110px; margin: 0 8px 8px 0; padding: 10px 12px; border-radius: 8px; background: var(--dc-bg3, #1e1f22);
}
#fcdGame .fcdYou b { display: block; font-size: 18px; font-weight: 800; color: var(--dc-head, #f2f3f5); }
#fcdGame .fcdYou span { font-size: 12px; color: var(--dc-muted, #949ba4); }
.fcdWatch {
    flex: none; margin-left: 8px; height: 26px; padding: 0 10px; border-radius: 4px; display: inline-flex; align-items: center;
    background: var(--dc-red, #f23f43); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; transition: filter .15s ease;
}
.fcdWatch:hover { filter: brightness(1.15); }
.fcdLiveTag { color: var(--dc-red, #f23f43); font-weight: 800; font-size: 11px; margin-right: 6px; }

/* =========================== instant search ============================ */
#fcdQuick {
    position: fixed; z-index: 950; display: none; max-height: 70vh; overflow-y: auto; padding: 6px; border-radius: 10px;
    background: var(--dc-float, #111214); color: var(--dc-text, #dbdee1); font-family: var(--dc-font, sans-serif);
    box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 16px 40px rgba(0,0,0,.55);
}
#fcdQuick.open { display: block; }
#fcdQuick .fcdQHead { padding: 8px 10px 4px; font-size: 12px; font-weight: 800; text-transform: uppercase; color: var(--dc-muted, #949ba4); }
#fcdQuick .fcdQRow {
    display: flex; align-items: center; padding: 6px 10px; border-radius: 6px; cursor: pointer; transition: background-color .1s ease;
}
#fcdQuick .fcdQRow.sel { background: var(--dc-active, #404249); }
#fcdQuick .fcdQThumb {
    flex: none; width: 64px; height: 48px; margin-right: 12px; border-radius: 5px; background: #000 center / cover no-repeat;
}
#fcdQuick .fcdQText { flex: 1; min-width: 0; }
#fcdQuick .fcdQName { font-size: 15px; font-weight: 600; color: var(--dc-head, #f2f3f5); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcdQuick .fcdQName mark { background: none; color: var(--dc-blurple, #5865f2); }
#fcdQuick .fcdQMeta { margin-top: 2px; display: flex; align-items: center; font-size: 12px; color: var(--dc-muted, #949ba4); }
#fcdQuick .fcdQMeta > span { margin-right: 10px; display: inline-flex; align-items: center; }
#fcdQuick .fcdQAll { padding: 10px; color: var(--dc-link, #00a8fc); font-weight: 600; font-size: 14px; }
#fcdQuick .fcdQKey { flex: none; margin-left: 8px; font-size: 11px; color: var(--dc-muted, #949ba4); }

/* ============================= live now row ============================ */
#fcdLive { display: none; order: -4; margin: 14px 0 0; }
html.fcd-on #fcdLive.has { display: block; }
html.fcd-on #fcdLive .fcdYoursGrid { grid-auto-columns: var(--fcd-col, 300px); }
#fcdLive .fcdRowHead h3 .fcdLiveCount { color: #fff; background: var(--dc-red, #f23f43); }
#fcdLive .fcdRowHead h3 .fcdLiveCount:empty { display: none; }
.fcdLiveCard {
    position: relative; height: 178px; overflow: hidden; border-radius: 10px; cursor: pointer; scroll-snap-align: start;
    background: var(--dc-float, #111214); color: #fff;
    box-shadow: 0 0 0 1px rgba(242,63,67,.25), 0 2px 8px rgba(0,0,0,.3);
    transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease;
}
.fcdLiveCard:hover { transform: translateY(-6px) scale(1.03); z-index: 5; box-shadow: 0 0 0 1px rgba(242,63,67,.5), 0 14px 30px rgba(0,0,0,.5); }
.fcdLiveBg {
    position: absolute; top: -20px; left: -20px; right: -20px; bottom: -20px; background-size: cover; background-position: center;
    filter: blur(10px) saturate(1.4) brightness(.4);
}
.fcdLiveIn { position: relative; z-index: 1; height: 100%; padding: 10px 12px; display: flex; flex-direction: column; }
.fcdLiveTop { display: flex; align-items: center; height: 20px; font-size: 12px; font-weight: 700; }
.fcdLivePill { padding: 2px 7px; border-radius: 4px; background: var(--dc-red, #f23f43); color: #fff; font-size: 11px; font-weight: 800; }
.fcdLiveTime { margin-left: 8px; color: rgba(255,255,255,.8); font-variant-numeric: tabular-nums; }
.fcdLiveGame { margin-top: 6px; font-size: 13px; font-weight: 600; color: rgba(255,255,255,.8); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcdLiveVs { flex: 1; display: flex; align-items: center; justify-content: space-between; }
.fcdLiveVs.solo { justify-content: center; }
.fcdLiveVs.solo .fcdLiveP { width: auto; max-width: 100%; }
.fcdLiveNote { margin-top: 2px; font-size: 12px; color: rgba(255,255,255,.6); }
.fcdLiveP { width: 110px; display: flex; flex-direction: column; align-items: center; text-align: center; }
.fcdLiveP .fcdAva { box-shadow: 0 0 0 2px rgba(255,255,255,.25); }
.fcdLiveN { margin-top: 6px; max-width: 110px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; }
.fcdLiveN b { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 700; }
.fcdLiveVsTxt { font-size: 22px; font-weight: 900; font-style: italic; color: rgba(255,255,255,.85); text-shadow: 0 2px 10px rgba(0,0,0,.6); }
.fcdLiveAct { display: flex; justify-content: center; font-size: 12px; color: rgba(255,255,255,.75); height: 26px; align-items: center; }
.fcdLiveAct .fcdWatch { margin-left: 0; }
.fcdLiveDet {
    height: 26px; padding: 0 12px; border-radius: 4px; display: inline-flex; align-items: center; font-size: 12px; font-weight: 700;
    color: #fff; background: rgba(255,255,255,.14); cursor: pointer; transition: background-color .15s ease;
}
.fcdLiveDet:hover { background: rgba(255,255,255,.24); }

/* ============================ results page ============================= */
#fcdResults { display: none; position: relative; z-index: 1; padding: 8px 0 16px; }
html.fcd-own-results .searchWrapper .searchResultsWrapper { display: none; }
html.fcd-own-results #fcdResults { display: block; }
.fcdResBar { display: flex; align-items: center; flex-wrap: wrap; padding: 18px 24px 4px; }
.fcdResTitle { flex: 1; min-width: 200px; display: flex; align-items: baseline; }
.fcdResTitle .t { font-size: 20px; font-weight: 700; color: var(--dc-head, #f2f3f5); }
.fcdResTitle .c { margin-left: 10px; font-size: 14px; font-weight: 500; color: var(--dc-muted, #949ba4); }
.fcdSeg { display: flex; margin: 4px 12px 4px 0; padding: 3px; border-radius: 8px; background: var(--dc-bg3, #1e1f22); }
.fcdSeg > span {
    padding: 5px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; color: var(--dc-muted, #949ba4); cursor: pointer;
    transition: background-color .15s ease, color .15s ease;
}
.fcdSeg > span:hover { color: var(--dc-text, #dbdee1); }
.fcdSeg > span.on { background: var(--dc-active, #404249); color: var(--dc-head, #f2f3f5); }
.fcdChip {
    margin: 4px 8px 4px 0; padding: 6px 12px; border-radius: 16px; font-size: 13px; font-weight: 600; cursor: pointer;
    background: var(--dc-bg3, #1e1f22); color: var(--dc-muted, #949ba4); box-shadow: inset 0 0 0 1px var(--dc-divider, #3f4147);
    transition: background-color .15s ease, color .15s ease, box-shadow .15s ease;
}
.fcdChip:hover { color: var(--dc-text, #dbdee1); }
.fcdChip.on { background: var(--dc-accent-soft, rgba(88,101,242,.3)); color: #fff; box-shadow: inset 0 0 0 1px var(--dc-blurple, #5865f2); }
.fcdResStatus { padding: 0 24px; font-size: 13px; color: var(--dc-muted, #949ba4); min-height: 18px; }
.fcdResGrid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr)); grid-gap: 16px; padding: 10px 24px 16px;
}
.fcdResEmpty { padding: 48px 32px; text-align: center; color: var(--dc-muted, #949ba4); font-size: 16px; }
.fcdResEmpty .emoji { font-family: monospace; font-size: 26px; margin-bottom: 12px; color: var(--dc-text, #dbdee1); }
#fcdResSentinel { height: 1px; }

/* our own game card (results page) -- same look as the restyled FC cards */
.fcdCard {
    position: relative; height: ${ART_H + INFO_H}px; overflow: hidden; border-radius: 8px; cursor: pointer;
    background: var(--dc-bg3, #1e1f22);
    box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.04)), 0 2px 6px rgba(0,0,0,.25);
    transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease; z-index: 1;
}
.fcdCard:hover { transform: translateY(-6px) scale(1.04); z-index: 5; box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.06)), 0 14px 30px rgba(0,0,0,.5); }
.fcdCardArt {
    height: ${ART_H}px; background-color: var(--dc-float, #111214); background-repeat: no-repeat;
    background-size: 100% auto; background-position: center 35%; transition: background-size .45s cubic-bezier(.2,.8,.2,1);
}
.fcdCard:hover .fcdCardArt { background-size: 110% auto; }
.fcdCardPill {
    position: absolute; top: 8px; left: 8px; z-index: 2; height: 24px; padding: 0 8px; border-radius: 12px; display: flex; align-items: center;
    background: rgba(17,18,20,.85); box-shadow: 0 1px 4px rgba(0,0,0,.35); color: #fff; font-size: 12px; font-weight: 700;
}
.fcdCardPill .fcdRk {
    margin-left: 7px; padding-left: 7px; border-left: 1px solid rgba(255,255,255,.2); color: var(--dc-yellow, #f0b232); font-size: 11px;
}
.fcdCardPill .fcdFv { margin-left: 6px; color: var(--dc-yellow, #f0b232); }
.fcdCardActs {
    position: absolute; top: 8px; right: 8px; z-index: 4; display: flex; opacity: 0; transform: translateY(-6px);
    transition: opacity .18s ease, transform .18s ease;
}
.fcdCard:hover .fcdCardActs { opacity: 1; transform: none; }
.fcdCardActs > span {
    height: 28px; margin-left: 6px; padding: 0 12px; border-radius: 4px; display: inline-flex; align-items: center;
    font-size: 13px; font-weight: 600; color: #fff; background: rgba(17,18,20,.85); transition: background-color .15s ease;
}
.fcdCardActs > span:hover { background: var(--dc-btn-h, #6d6f78); }
.fcdCardActs > span.go { background: #248046; }
.fcdCardActs > span.go:hover { background: #1a6334; }
.fcdCardActs > span.dis { opacity: .5; cursor: not-allowed; }
.fcdCardInfo {
    position: absolute; left: 0; right: 0; bottom: 0; min-height: ${INFO_H}px; z-index: 3; padding: 10px 12px 12px;
    background: var(--dc-bg3, #1e1f22); transition: box-shadow .22s ease;
}
.fcdCard:hover .fcdCardInfo { box-shadow: 0 -10px 16px rgba(0,0,0,.35); }
.fcdCardName {
    font-size: 14px; font-weight: 600; line-height: 18px; color: var(--dc-head, #f2f3f5);
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.fcdCard:hover .fcdCardName { -webkit-line-clamp: 4; }

/* =========================== tilt and glare ============================ */
html.fcd-tilt .channelPreviewWrapper:hover, html.fcd-tilt .eventPreviewWrapper:hover, html.fcd-tilt .fcdCard:hover,
html.fcd-tilt .fcdLiveCard:hover {
    transform: perspective(700px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) translateY(-6px) scale(1.04);
    transition: transform .12s ease-out, box-shadow .22s ease;
}
html.fcd-tilt .categoryPreviewWrapper:hover {
    transform: perspective(600px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) translateY(-4px);
    transition: transform .12s ease-out, box-shadow .22s ease;
}
html.fcd-tilt .channelPreviewWrapper::after, html.fcd-tilt .eventPreviewWrapper::after, html.fcd-tilt .fcdCard::after,
html.fcd-tilt .fcdLiveCard::after, html.fcd-tilt .categoryPreviewWrapper::after {
    content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 7; pointer-events: none; border-radius: inherit;
    background: radial-gradient(circle at var(--gx, 50%) var(--gy, 30%), rgba(255,255,255,.2), rgba(255,255,255,0) 58%);
    opacity: 0; transition: opacity .25s ease;
}
html.fcd-tilt .channelPreviewWrapper:hover::after, html.fcd-tilt .eventPreviewWrapper:hover::after, html.fcd-tilt .fcdCard:hover::after,
html.fcd-tilt .fcdLiveCard:hover::after, html.fcd-tilt .categoryPreviewWrapper:hover::after { opacity: 1; }
`;

// Motion, only under html.fcd-anim -- the Animations setting. (Not tied to the OS
// "reduce motion" flag: Windows with animation effects off reports it, and motion
// here is something the user asked for.)
const ANIM = `
@keyframes fcdRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes fcdPop { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes fcdSlideIn { from { opacity: 0; transform: translateX(-16px); } to { opacity: 1; transform: none; } }
@keyframes fcdKen { from { transform: scale(1); } to { transform: scale(1.09) translate(-1%, -1%); } }
@keyframes fcdShimmer { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
@keyframes fcdDrop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes fcdFlash { 0% { box-shadow: 0 0 0 0 var(--dc-blurple, #5865f2); } 100% { box-shadow: 0 0 0 14px rgba(88,101,242,0); } }
html.fcd-anim.fcd-browse #fcdNav.fresh { animation: fcdSlideIn .35s cubic-bezier(.2,.8,.2,1) both; }
html.fcd-anim .welcomeWrapper .contentWrapper > header { animation: fcdRise .45s cubic-bezier(.2,.8,.2,1) both; }
html.fcd-anim .fcdHeroArt.on, html.fcd-anim .fcdSpotArt > i.on { animation: fcdKen 14s ease-out both; }
html.fcd-anim .welcomeListWrapper, html.fcd-anim #fcdYours.has, html.fcd-anim #fcdLive.has, html.fcd-anim .fcdXRow.has {
    animation: fcdRise .45s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--fcd-i, 0) * 70ms + 60ms);
}
html.fcd-anim .welcomeListWrapper .gridWrapper, html.fcd-anim #fcdYours .fcdTile,
html.fcd-anim .searchResultsGrid > .channelWrapper { animation: fcdPop .4s cubic-bezier(.2,.8,.2,1) both; }
${Array.from({ length: 12 }, (_, i) => `html.fcd-anim .welcomeListWrapper .gridWrapper:nth-child(${i + 1}), html.fcd-anim #fcdYours .fcdTile:nth-child(${i + 1}) { animation-delay: calc(var(--fcd-i, 0) * 70ms + ${120 + i * 30}ms); }`).join('\n')}
${Array.from({ length: 16 }, (_, i) => `html.fcd-anim .searchResultsGrid > .channelWrapper:nth-child(${i + 1}) { animation-delay: ${i * 25}ms; }`).join('\n')}
html.fcd-anim .searchResultsGrid > .channelWrapper:nth-child(n+17) { animation-delay: 400ms; }
html.fcd-anim .welcomeWrapper .contentWrapper > .spinnerWrapper::after,
html.fcd-anim .searchResultsWrapper .spinnerWrapper::after { animation: fcdShimmer 1.3s ease-in-out infinite; }
html.fcd-anim .welcomeWrapper header .filtersWrapper.active,
html.fcd-anim .searchWrapper header .filtersWrapper.active { animation: fcdDrop .2s ease-out both; }
html.fcd-anim #fcdYours.flash .fcdTile:first-child { animation: fcdFlash .9s ease-out 1; }
html:not(.fcd-anim) .fcdHeroArt, html:not(.fcd-anim) .channelPreviewWrapper, html:not(.fcd-anim) .eventPreviewWrapper,
html:not(.fcd-anim) .categoryPreviewWrapper, html:not(.fcd-anim) .fcdTile { transition: none !important; }
html.fcd-on:not(.fcd-anim) .channelPreviewWrapper:hover, html.fcd-on:not(.fcd-anim) .eventPreviewWrapper:hover,
html.fcd-on:not(.fcd-anim) .fcdTile:hover, html.fcd-on:not(.fcd-anim) .categoryPreviewWrapper:hover { transform: none !important; }
html.fcd-on:not(.fcd-anim) .channelPreviewWrapper:hover .thumbnail, html.fcd-on:not(.fcd-anim) .eventPreviewWrapper:hover .thumbnail,
html.fcd-on:not(.fcd-anim) .categoryPreviewWrapper:hover .thumbnail { background-size: 100% auto !important; }
@keyframes fcdPulse { 0% { box-shadow: 0 0 0 0 rgba(242,63,67,.65); } 100% { box-shadow: 0 0 0 9px rgba(242,63,67,0); } }
@keyframes fcdSpotIn { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
html.fcd-anim .eventPreviewWrapper[data-fcd-live]::before, html.fcd-anim .fcdLivePill { animation: fcdPulse 1.6s ease-out infinite; }
html.fcd-anim .fcdSpotText.fcd-in { animation: fcdSpotIn .5s cubic-bezier(.2,.8,.2,1) both; }
html.fcd-anim .fcdCard.pop { animation: fcdPop .4s cubic-bezier(.2,.8,.2,1) both; }
html.fcd-anim #fcdLive .fcdLiveCard, html.fcd-anim .fcdXRow .fcdPCard, html.fcd-anim .fcdXRow .fcdEvCard { animation: fcdPop .4s cubic-bezier(.2,.8,.2,1) both; }
html.fcd-anim .fcdEvCard.live .fcdEvCount, html.fcd-anim .fcdPCard.playing .fcdLiveDot { animation: fcdPulse 1.6s ease-out infinite; }
html.fcd-anim .fcdSkel::after, html.fcd-anim .fcdSkelCard::after { animation: fcdShimmer 1.3s ease-in-out infinite; }
.fcdSkelCard { cursor: default !important; }
.fcdSkelCard::after { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 45%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.05), transparent); }
html:not(.fcd-anim) .fcdCard, html:not(.fcd-anim) .fcdLiveCard, html:not(.fcd-anim) #fcdGame, html:not(.fcd-anim) .fcdSpotArt > i,
html:not(.fcd-anim) .fcdAmbient > i, html:not(.fcd-anim) .fcdDotNav.on::after { transition: none !important; }
html.fcd-on:not(.fcd-anim) .fcdCard:hover, html.fcd-on:not(.fcd-anim) .fcdLiveCard:hover { transform: none !important; }
`;

const CSS3 = "\n/* ============================ for you rows ============================== */\n#fcdFriends { order: -5; } #fcdRivals { order: -3; } #fcdEvents { order: -2; }\n.fcdXRow { display: none; margin: 14px 0 0; }\nhtml.fcd-on .fcdXRow.has { display: block; }\nhtml.fcd-on .fcdXRow .fcdRowHead { display: flex; align-items: center; padding: 14px 24px 0; }\nhtml.fcd-on .fcdXRow .fcdRowHead h3 {\n    flex: 1; display: flex; align-items: center; margin: 0; font-family: var(--dc-font, sans-serif); font-size: 18px; font-weight: 700;\n    line-height: 24px; color: var(--dc-head, #f2f3f5);\n}\nhtml.fcd-on .fcdXRow .fcdRowHead h3 > .fc-ic { width: 20px; height: 20px; margin-right: 8px; color: var(--dc-blurple, #5865f2); vertical-align: middle; }\nhtml.fcd-on .fcdXRow .fcdShowAll { margin-right: 8px; }\nhtml.fcd-on .fcdXRow .fcdYoursGrid {\n    display: grid; grid-auto-flow: column; grid-template-columns: none; grid-auto-columns: var(--fcd-col, 260px); grid-gap: 16px; width: auto;\n    overflow-x: auto; overflow-y: hidden; padding: 14px 24px 18px; scroll-snap-type: x proximity; scroll-padding: 0 24px; scroll-behavior: smooth;\n    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 56px), transparent 100%);\n}\nhtml.fcd-on .fcdXRow[data-fcd-edge~=\"start\"] .fcdYoursGrid { -webkit-mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 56px), transparent 100%); }\nhtml.fcd-on .fcdXRow[data-fcd-edge~=\"start\"][data-fcd-edge~=\"end\"] .fcdYoursGrid { -webkit-mask-image: none; }\nhtml.fcd-on .fcdXRow .fcdYoursGrid::-webkit-scrollbar { height: 0; display: none; }\n.fcdXRow:hover .fcdArrows { opacity: 1; }\n\n.fcdPCard {\n    position: relative; height: 132px; overflow: hidden; border-radius: 12px; cursor: pointer; scroll-snap-align: start; display: flex; flex-direction: column;\n    background: var(--dc-bg3, #1e1f22); box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.05)), 0 2px 8px rgba(0,0,0,.3);\n    transition: transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s ease;\n}\n.fcdPCard:hover { transform: translateY(-4px); z-index: 5; box-shadow: 0 0 0 1px var(--dc-blurple, #5865f2), 0 12px 26px rgba(0,0,0,.45); }\n.fcdPCard.playing { box-shadow: 0 0 0 1px rgba(242,63,67,.35), 0 2px 8px rgba(0,0,0,.3); }\n.fcdPArt {\n    position: absolute; top: 0; left: 0; right: 0; height: 64px; background-size: cover; background-position: center 30%;\n    filter: saturate(1.2) brightness(.55); image-rendering: pixelated;\n}\n.fcdPArt::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(180deg, transparent 20%, var(--dc-bg3, #1e1f22)); }\n.fcdPMain { position: relative; z-index: 1; flex: 1; display: flex; align-items: flex-end; padding: 0 12px; min-height: 0; }\n.fcdPAva { position: relative; flex: none; margin-right: 10px; line-height: 0; }\n.fcdPAva .fcdAva { width: 48px; height: 48px; border-radius: 50%; box-shadow: 0 0 0 3px var(--dc-bg3, #1e1f22); }\n.fcdPAva .st { position: absolute; right: -1px; bottom: -1px; width: 14px; height: 14px; border-radius: 50%; border: 3px solid var(--dc-bg3, #1e1f22); }\n.fcdPAva .st.on { background: var(--dc-green, #23a55a); }\n.fcdPAva .st.playing { background: var(--dc-red, #f23f43); }\n.fcdPTx { flex: 1; min-width: 0; padding-bottom: 2px; }\n.fcdPTx b { display: inline-block; max-width: calc(100% - 26px); vertical-align: middle; font-size: 15px; font-weight: 700; color: var(--dc-head, #f2f3f5);\n    overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; }\n.fcdPTx b:hover { text-decoration: underline; }\n.fcdPTx .sub { display: flex; align-items: center; margin-top: 2px; font-size: 12.5px; color: var(--dc-text, #dbdee1); white-space: nowrap; overflow: hidden; }\n.fcdPTx .game { display: block; font-size: 11.5px; color: var(--dc-muted, #949ba4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.fcdPTx .rec { font-weight: 700; } .fcdPTx .rec.up { color: var(--dc-green, #23a55a); } .fcdPTx .rec.down { color: var(--dc-red, #f23f43); }\n.fcdLiveDot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--dc-red, #f23f43); }\n.fcdPAct { position: relative; z-index: 1; display: flex; justify-content: flex-end; padding: 8px 12px 10px; }\n.fcdPBtn {\n    display: inline-flex; align-items: center; height: 26px; padding: 0 10px; margin-left: 6px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer;\n    color: #fff; background: var(--dc-btn, #4e5058); transition: filter .15s ease, background-color .15s ease;\n}\n.fcdPBtn:hover { filter: brightness(1.15); }\n.fcdPBtn.watch { background: var(--dc-red, #f23f43); }\n.fcdPBtn.go { background: var(--dc-green, #23a55a); }\n.fcdPBtn.sent { background: var(--dc-btn, #4e5058); pointer-events: none; }\n.fcdPBtn.ghost { background: rgba(255,255,255,.08); color: var(--dc-text, #dbdee1); }\n.fcdPBtn .fc-ic { margin-right: 5px; }\n\n.fcdEvCard {\n    position: relative; height: 164px; overflow: hidden; border-radius: 12px; cursor: pointer; scroll-snap-align: start;\n    background: var(--dc-float, #111214); box-shadow: 0 0 0 1px var(--dc-divider, rgba(255,255,255,.05)), 0 2px 8px rgba(0,0,0,.3);\n    transition: transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s ease;\n}\n.fcdEvCard.mine { box-shadow: 0 0 0 1px rgba(240,178,50,.45), 0 2px 8px rgba(0,0,0,.3); }\n.fcdEvCard:hover { transform: translateY(-4px); z-index: 5; box-shadow: 0 0 0 1px var(--dc-yellow, #f0b232), 0 12px 26px rgba(0,0,0,.45); }\n.fcdEvArt { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-size: cover; background-position: center; filter: brightness(.4) saturate(1.2); }\n.fcdEvIn { position: relative; z-index: 1; height: 100%; padding: 10px 12px; display: flex; flex-direction: column; color: #fff; }\n.fcdEvWhen { display: flex; align-items: center; font-size: 12px; font-weight: 800; letter-spacing: .02em; }\n.fcdEvWhen .d { padding: 2px 8px; border-radius: 4px; background: rgba(240,178,50,.22); color: var(--dc-yellow, #f0b232); text-transform: uppercase; }\n.fcdEvWhen .t { margin-left: 8px; color: rgba(255,255,255,.85); }\n.fcdEvBell { margin-left: auto; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center;\n    color: rgba(255,255,255,.8); background: rgba(0,0,0,.35); transition: background-color .15s ease, color .15s ease; }\n.fcdEvBell .fc-ic { width: 16px; height: 16px; }\n.fcdEvBell:hover { background: rgba(255,255,255,.18); }\n.fcdEvBell.on { color: #1a1300; background: var(--dc-yellow, #f0b232); }\n.fcdEvName { margin-top: 10px; font-size: 16px; font-weight: 800; line-height: 20px; max-height: 40px; overflow: hidden; }\n.fcdEvMeta { margin-top: 4px; font-size: 12px; color: rgba(255,255,255,.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.fcdEvMeta span + span::before { content: '·'; margin: 0 6px; }\n.fcdEvFoot { margin-top: auto; display: flex; align-items: center; }\n.fcdEvCount { flex: 1; font-size: 12.5px; font-weight: 700; color: var(--dc-yellow, #f0b232); }\n.fcdEvCard.live .fcdEvCount { color: var(--dc-red, #f23f43); }\n\n.fcdTileRank { flex: none; width: 66px; margin-right: 12px; display: flex; flex-direction: column; align-items: center; }\n.fcdTileRank .elo { margin-top: 3px; font-size: 11.5px; font-weight: 700; color: var(--dc-text, #dbdee1); font-variant-numeric: tabular-nums; }\n.fcdTileRank .bar { display: block; width: 52px; height: 3px; margin-top: 4px; border-radius: 2px; background: rgba(255,255,255,.1); overflow: hidden; }\n.fcdTileRank .bar > i { display: block; height: 100%; }\n.fcdTile:hover .fcdTileRank { display: none; }\n";

function ensureStyle() {
    if (document.getElementById('fcdStyle')) return;
    const st = document.createElement('style');
    st.id = 'fcdStyle';
    st.textContent = important(CSS) + important(CSS2) + important(CSS3) + ANIM;
    document.head.appendChild(st);
}

/* ------------------------------------------------------------------- views */

function currentView() {
    const w = document.querySelector('.welcomeWrapper');
    if (visible(w)) return 'home';
    const s = document.querySelector('.searchWrapper');
    if (visible(s)) return 'search';
    // hidden but about to show: trust FC's own state
    const id = root()?.activeChannelId;
    if (id === 'welcome-channel' && w) return 'home';
    if (id === 'search-channel' && s) return 'search';
    return null;
}

const searchComp = () => root()?.$refs?.['search-channel'] || null;

// which sidebar entry matches what the results view is showing
function activeKey(view) {
    if (view === 'home') return 'home';
    if (view !== 'search') return null;
    const sc = searchComp();
    if (!sc) return null;
    const L = filterLists();
    if (sc.favorites) return 'fav';
    if (sc.textFilter) return null;
    const g = +sc.genreFilter || 0, s = +sc.systemFilter || 0;
    if (g > 0 && !s) return 'g:' + L.allGenres[g];
    if (s > 0 && !g) return 's:' + L.allSystems[s];
    return null;
}

/* ----------------------------------------------------------------- sidebar */

let navKey = '';
let moreOpen = false;

function navItem(key, icon, label, extraCls) {
    return `<div class="fcdNavItem${extraCls ? ' ' + extraCls : ''}" data-key="${esc(key)}" title="${ET(label)}">${icon}<span class="fcdLbl">${ET(label)}</span></div>`;
}

function buildNav() {
    const L = filterLists();
    // (Friends shows once friends.js is running -- it loads after this plugin)
    const key = L.genres.join('|') + '#' + L.systems.join('|') + (fc.modules.has('friends') ? '#fr' : '');
    let nav = document.getElementById('fcdNav');
    if (nav && navKey === key) return nav;
    navKey = key;
    const ico = (name) => `<span class="fcdIco">${svgIcon(name)}</span>`;
    const common = COMMON_GENRES.filter(g => L.genres.includes(g));
    const rest = L.genres.filter(g => !common.includes(g));
    const genre = (g) => navItem('g:' + g, ico(GENRE_ICON[g] || 'pad'), g);
    const system = (s) => navItem('s:' + s,
        `<span class="fcdTag" style="background:${tagColor(s)}">${esc(SYSTEM_TAG[s] || initials(s))}</span>`, s);
    const html = `<div class="fcdNavHead">${ET('Discover')}<span class="fcdGear" data-key="settings" title="${ET('Fightcord settings (Ctrl+,)')}">${svgIcon('gear')}</span></div><div class="fcdNavList">
        ${navItem('home', ico('home'), N_('Home'))}
        ${navItem('yours', ico('pad'), N_('Your games'))}
        ${navItem('fav', ico('star'), N_('Favourites'))}
        ${navItem('stats', ico('chart'), N_('Your stats'))}
        ${fc.modules.has('friends') ? navItem('friends', ico('users'), N_('Friends'), 'fcdFriends') : ''}
        ${L.genres.length ? '<div class="fcdNavSec">' + ET('Genres') + '</div>' : ''}
        ${common.map(genre).join('')}
        ${rest.length ? `<div class="fcdMore${moreOpen ? ' open' : ''}">${rest.map(genre).join('')}</div>
            <div class="fcdNavItem fcdMoreBtn${moreOpen ? ' open' : ''}" data-key="more"><span class="fcdIco"></span>
            <span class="fcdLbl">${ET('More genres')}<span class="fcdChev">▾</span></span></div>` : ''}
        ${L.systems.length ? '<div class="fcdNavSec">' + ET('Systems') + '</div>' : ''}
        ${L.systems.map(system).join('')}
    </div>`;
    if (!nav) {
        nav = document.createElement('nav');
        nav.id = 'fcdNav';
        nav.className = 'fresh';
        nav.addEventListener('click', onNavClick);
        nav.addEventListener('mousedown', (e) => e.stopPropagation());
        document.body.appendChild(nav);
    }
    nav.innerHTML = html;
    return nav;
}

function setMore(open) {
    moreOpen = open;
    const nav = document.getElementById('fcdNav');
    if (!nav) return;
    nav.querySelector('.fcdMore')?.classList.toggle('open', open);
    nav.querySelector('.fcdMoreBtn')?.classList.toggle('open', open);
}

function onNavClick(e) {
    if (e.target.closest('.fcdGear')) { const fc = plugin('fightcord.js'); if (fc && fc.open) fc.open(); return; }
    const item = e.target.closest('.fcdNavItem');
    if (!item) return;
    const key = item.dataset.key;
    if (key === 'more') { setMore(!moreOpen); return; }
    if (key === 'stats') { const st = plugin('stats.js'); if (st && st.open) st.open(); return; }
    if (key === 'friends') { const fr = plugin('friends.js'); if (fr && fr.open) fr.open(); return; }
    fc.emit('nav', key);                                    // the stats / friends pages close on any other pick
    if (key === 'home') select('welcome-channel');
    else if (key === 'yours') goYours();
    else if (key === 'fav') select('search-channel', { category: 'My Favorites' });
    else if (key.startsWith('g:') || key.startsWith('s:')) select('search-channel', { category: key.slice(2) });
    setTimeout(tick, 30);
}

function goYours() {
    if (currentView() !== 'home') select('welcome-channel');
    let tries = 0;
    const go = () => {
        const row = document.getElementById('fcdYours');
        if (row && row.classList.contains('has') && visible(row)) {
            row.scrollIntoView({ behavior: config.animations ? 'smooth' : 'auto', block: 'start' });
            row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
            setTimeout(() => row.classList.remove('flash'), 1200);
        } else if (++tries < 15) setTimeout(go, 100);
    };
    setTimeout(go, 50);
}

function updateNav(view) {
    const nav = buildNav();
    // green count of friends online, on the Friends item
    const fi = nav.querySelector('.fcdFriends .fcdLbl');
    if (fi) {
        const fr = plugin('friends.js');
        const n = fr && fr.onlineCount ? fr.onlineCount() : 0;
        const txt = n ? String(n) : '';
        let b = fi.querySelector('.fcdCnt');
        if (!b) { b = document.createElement('span'); b.className = 'fcdCnt'; fi.appendChild(b); }
        if (b.textContent !== txt) b.textContent = txt;
    }
    const key = activeKey(view);
    nav.querySelectorAll('.fcdNavItem').forEach(it => {
        const on = it.dataset.key === key;
        if (it.classList.contains('on') !== on) it.classList.toggle('on', on);
    });
    if (key && key.startsWith('g:') && !moreOpen && nav.querySelector('.fcdMore [data-key="' + CSS_ESC(key) + '"]')) setMore(true);
}
const CSS_ESC = (s) => (window.CSS && window.CSS.escape) ? window.CSS.escape(s) : s.replace(/["\\]/g, '\\$&');

/* --------------------------------------------------------------- home view */

function artUrl(rom) {
    return new URL('static/previews/' + encodeURIComponent(String(rom).replace(/^fc1_/, '')) + '.png', FC_ORIGIN).href;
}

function cardArt(card) {
    const th = card.querySelector('.thumbnail');
    if (!th) return '';
    const bg = th.style.backgroundImage;
    const m = bg && bg.match(/url\(["']?([^"')]+)["']?\)/);
    const src = (m && m[1]) || th.getAttribute('data-src') || '';
    return src ? new URL(src, FC_ORIGIN).href : '';
}

/* --------------------------------------------------------------- spotlight */

const SPOT_MS = 8000;
let spot = { items: [], idx: 0, elapsed: 0, last: 0, sig: '', hover: false, dyn: '' };

// A channel object for one of FC's own cards (its Vue data, or read off the card).
function channelFromCard(card) {
    const v = card.__vue__?.channel;
    if (v && v.name) return remember(plain(v));
    const art = cardArt(card);
    const m = art.match(/previews\/([^/?#]+)\.png/);
    const n = parseInt((card.querySelector('.num-users')?.textContent || '').replace(/\D/g, ''), 10);
    return remember({
        name: cardChannelName(card), gameid: m ? decodeURIComponent(m[1]) : '',
        system: card.querySelector('.system')?.textContent.trim() || '',
        clients: isNaN(n) ? undefined : n, ranked: !!card.querySelector('.rankedStatus')
    });
}

// whatever we know about a channel by name (cache, joined channel, catalog)
function channelByName(name, rom) {
    const c = chanCache.get(name);
    if (c) return c;
    const j = joinedChannels().find(x => (x.name || x.id) === name);
    if (j) return remember(Object.assign(plain(j), { name: j.name || j.id }));
    const e = catalog().find(x => x.name === name);
    return remember({ name, gameid: (e && e.gameid) || rom || '' });
}

function spotItems(content) {
    const res = root()?.$refs?.['welcome-channel']?.results;
    let chans = [];
    if (Array.isArray(res)) {
        const first = res.find(r => r && Array.isArray(r.channels) && r.channels.length);
        if (first) chans = first.channels.slice(0, 5).map(c => remember(plain(c)));
    }
    if (!chans.length) {
        const row = [...content.querySelectorAll('.welcomeListWrapper')].find(r => r.querySelector('.channelPreviewWrapper'));
        if (row) chans = [...row.querySelectorAll('.channelPreviewWrapper')].slice(0, 5).map(channelFromCard);
    }
    return chans.filter(c => c && c.name);
}

// fade to a new picture on one of two stacked layers, once it has loaded
function crossfade(layers, url) {
    if (!url || layers.length < 2) return;
    const on = [...layers].find(l => l.classList.contains('on'));
    if (on && on.__url === url) return;
    const next = on === layers[0] ? layers[1] : layers[0];
    const img = new Image();
    img.onload = () => {
        next.style.setProperty('background-image', 'url("' + url + '")', 'important');
        next.__url = url;
        next.classList.add('on');
        if (on && on !== next) on.classList.remove('on');
    };
    img.src = url;
}

function liveCount(name) {
    return liveMatches().filter(m => m.channel === name).length;
}

function decorateSpotlight(content) {
    const header = content.querySelector(':scope > header');
    if (!header) return;
    let sp = header.querySelector(':scope > .fcdSpot');
    if (!sp) {
        sp = document.createElement('div');
        sp.className = 'fcdSpot';
        sp.innerHTML = `<div class="fcdHeroArt"></div><div class="fcdHeroArt"></div>
            <div class="fcdSpotArt" data-act="details" title="Details"><i></i><i></i></div>
            <div class="fcdSpotText"></div><div class="fcdSpotThumbs"></div>`;
        sp.addEventListener('click', onSpotClick);
        sp.addEventListener('mouseenter', () => { spot.hover = true; });
        sp.addEventListener('mouseleave', () => { spot.hover = false; });
        header.appendChild(sp);
        spot.sig = '';
    }
    // no room for the thumbnail strip beside the text on a narrow window
    const narrow = sp.clientWidth > 0 && sp.clientWidth < 900;
    if (sp.classList.contains('narrow') !== narrow) sp.classList.toggle('narrow', narrow);
    const items = spotItems(content);
    const sig = items.map(c => c.name).join('|');
    if (sig !== spot.sig) {
        spot.sig = sig;
        spot.items = items;
        if (spot.idx >= items.length) spot.idx = 0;
        renderSpot(header, true);
    }
    const now = Date.now();
    const dt = spot.last ? Math.min(1000, now - spot.last) : 0;
    spot.last = now;
    const paused = spot.hover || document.getElementById('fcdGame')?.classList.contains('open') || quick.open;
    if (!paused && spot.items.length > 1) spot.elapsed += dt;
    if (spot.elapsed >= SPOT_MS) goSpot(header, spot.idx + 1);
    const dot = sp.querySelector('.fcdDotNav.on');
    if (dot) dot.style.setProperty('--p', Math.min(1, spot.elapsed / SPOT_MS).toFixed(3));
    renderSpot(header, false);
}

function goSpot(header, i) {
    if (!spot.items.length) return;
    spot.idx = (i + spot.items.length) % spot.items.length;
    spot.elapsed = 0;
    renderSpot(header, true);
}

function spotButtons(ch) {
    const joined = isJoinedName(ch.name);
    const jb = joined ? '' : joinBlock(ch);
    const fav = isFavName(ch.name);
    const fb = favBlock(ch);
    return (joined
        ? '<span class="fcdBtn go" data-act="open">▶ ' + ET('Open') + '</span>'
        : `<span class="fcdBtn go${jb ? ' dis' : ''}" data-act="${jb ? '' : 'join'}" title="${esc(jb)}">▶ ${ET('Join')}</span>`) +
        `<span class="fcdBtn${fav ? ' on' : ''}${fb ? ' dis' : ''}" data-act="${fb ? '' : 'fav'}" title="${esc(fb)}">${fav ? fc.ui.ic('star', 'fill') + ET('Favourited') : fc.ui.ic('star') + ET('Favourite')}</span>` +
        '<span class="fcdBtn" data-act="details">ⓘ ' + ET('Details') + '</span>';
}

function spotMeta(ch) {
    const parts = [];
    if (ch.clients != null) parts.push(`<span><span class="fcdDot"></span>${ET('{n} playing', { n: Number(ch.clients).toLocaleString(fc.t.locale()) })}</span>`);
    const live = isJoinedName(ch.name) ? liveCount(ch.name) : 0;
    if (live) parts.push(`<span>${fc.ui.ic('swords')}${esc(T.plural(live, '{n} match live', '{n} matches live'))}</span>`);
    if (ch.ranked) parts.push('<span>' + fc.ui.ic('trophy') + ET('Ranked') + '</span>');
    if (ch.system) parts.push(`<span>${esc(ch.system)}</span>`);
    return parts.join('');
}

function renderSpot(header, changed) {
    const sp = header.querySelector(':scope > .fcdSpot');
    const ch = spot.items[spot.idx];
    sp.classList.toggle('has', !!ch);
    if (!ch) return;
    const text = sp.querySelector('.fcdSpotText');
    if (changed) {
        const paren = (ch.name.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
        text.innerHTML = `<div class="fcdSpotKicker">${fc.ui.ic('star', 'fill')}Spotlight · #${spot.idx + 1} most played</div>
            <div class="fcdSpotTitle">${esc(shortName(ch.name))}</div>
            ${paren ? `<div class="fcdSpotSub">${esc(paren)}</div>` : ''}
            <div class="fcdSpotMeta"></div><div class="fcdSpotBtns"></div>
            <div class="fcdSpotNav">${spot.items.map((_, i) => `<span class="fcdDotNav${i === spot.idx ? ' on' : ''}" data-go="${i}"></span>`).join('')}
                <span class="fcdSpotArrs"><span class="fcdSpotArr" data-go="prev">‹</span><span class="fcdSpotArr" data-go="next">›</span></span></div>`;
        text.classList.remove('fcd-in'); void text.offsetWidth; text.classList.add('fcd-in');
        const url = ch.gameid ? artUrl(ch.gameid) : '';
        crossfade(sp.querySelectorAll('.fcdSpotArt > i'), url);
        crossfade(sp.querySelectorAll(':scope > .fcdHeroArt'), url);
        sp.querySelector('.fcdSpotThumbs').innerHTML = spot.items.map((c, i) =>
            `<div class="fcdSpotThumb${i === spot.idx ? ' on' : ''}" data-go="${i}" title="${esc(c.name)}"
                style="background-image:url(&quot;${c.gameid ? artUrl(c.gameid) : ''}&quot;) !important"></div>`).join('');
        amb.base = url;
        spot.dyn = '';
    }
    const meta = spotMeta(ch), btns = spotButtons(ch);
    const dyn = meta + '\n' + btns;
    if (dyn !== spot.dyn) {
        spot.dyn = dyn;
        const m = text.querySelector('.fcdSpotMeta'), b = text.querySelector('.fcdSpotBtns');
        if (m) m.innerHTML = meta;
        if (b) b.innerHTML = btns;
    }
}

function onSpotClick(e) {
    const header = e.currentTarget.parentNode;
    const go = e.target.closest('[data-go]');
    if (go) {
        const g = go.dataset.go;
        goSpot(header, g === 'prev' ? spot.idx - 1 : g === 'next' ? spot.idx + 1 : +g);
        return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const ch = spot.items[spot.idx];
    if (!act || !ch) return;
    runAction(act, ch);
    spot.dyn = '';
    setTimeout(tick, 60);
}

// Join / Open / Fav / Details, shared by the spotlight, the game page and our cards
function runAction(act, ch) {
    if (act === 'open') openChannel(ch.name);
    else if (act === 'join') { if (!joinBlock(ch) && !isJoinedName(ch.name)) doJoin(ch.name); }
    else if (act === 'fav') { if (!favBlock(ch)) doFav(ch.name, !isFavName(ch.name)); }
    else if (act === 'details') openGame(ch);
    else if (act === 'results') { closeGame(); select('search-channel', { textFilter: shortName(ch.name) }); }
}

/* ----------------------------------------------------------- ambient glow */

let amb = { base: '', hover: '', resetT: 0 };

function updateAmbient(view) {
    const wrap = document.querySelector(view === 'home' ? '.welcomeWrapper' : '.searchWrapper');
    if (!wrap) return;
    let a = wrap.querySelector(':scope > .fcdAmbient');
    if (!a) {
        a = document.createElement('div');
        a.className = 'fcdAmbient';
        a.innerHTML = '<i></i><i></i>';
        wrap.appendChild(a);           // last child of FC's view; positioned behind the content
    }
    const want = amb.hover || amb.base;
    if (want) crossfade(a.querySelectorAll(':scope > i'), want);
}

/* --------------------------------------------------------------- 3D tilt */

const TILT_SEL = '.channelPreviewWrapper, .eventPreviewWrapper, .categoryPreviewWrapper, .fcdCard, .fcdLiveCard, .fcdPCard, .fcdEvCard';
let tiltEl = null, tiltRaf = 0, tiltEv = null;

function artOf(el) {
    if (el.dataset.art) return el.dataset.art;
    if (el.classList.contains('channelPreviewWrapper') || el.classList.contains('eventPreviewWrapper')) return cardArt(el);
    return '';
}

function onMouseMove(e) {
    tiltEv = e;
    if (!tiltRaf) tiltRaf = requestAnimationFrame(applyTilt);
}

function applyTilt() {
    tiltRaf = 0;
    const e = tiltEv;
    if (!e) return;
    const h = document.documentElement;
    const on = h.classList.contains('fcd-tilt') && h.classList.contains('fcd-browse');
    let el = on && e.target && e.target.closest ? e.target.closest(TILT_SEL) : null;
    if (el && !el.closest('.welcomeWrapper, .searchWrapper')) el = null;
    if (tiltEl && tiltEl !== el) {
        tiltEl.style.setProperty('--rx', '0deg');
        tiltEl.style.setProperty('--ry', '0deg');
    }
    tiltEl = el;
    if (!el) {
        if (amb.hover && !amb.resetT) amb.resetT = setTimeout(() => { amb.hover = ''; amb.resetT = 0; }, 1500);
        return;
    }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const max = 8;
    el.style.setProperty('--rx', ((0.5 - py) * max).toFixed(2) + 'deg');
    el.style.setProperty('--ry', ((px - 0.5) * max * 1.3).toFixed(2) + 'deg');
    el.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
    el.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
    const art = artOf(el);
    if (art) {
        if (amb.resetT) { clearTimeout(amb.resetT); amb.resetT = 0; }
        amb.hover = art;
    }
}

function rowType(row) {
    if (row.querySelector('.categoryPreviewWrapper')) return 'cat';
    if (row.querySelector('.eventPreviewWrapper')) return 'ev';
    return 'games';
}

function arrowsHtml() {
    return '<div class="fcdArr off" data-d="-1" title="Back">‹</div><div class="fcdArr" data-d="1" title="More">›</div>';
}

function wireScroller(row, grid) {
    if (!grid || grid.__fcdWired) return;
    grid.__fcdWired = true;
    const edge = () => {
        const start = grid.scrollLeft <= 2;
        const end = grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 2;
        const v = (start ? 'start ' : '') + (end ? 'end' : '');
        if (row.getAttribute('data-fcd-edge') !== v.trim()) row.setAttribute('data-fcd-edge', v.trim());
        row.querySelectorAll('.fcdArr').forEach(a => a.classList.toggle('off', a.dataset.d === '-1' ? start : end));
    };
    grid.addEventListener('scroll', edge, { passive: true });
    row.__fcdEdge = edge;
    edge();
}

function onArrowClick(e) {
    const a = e.target.closest('.fcdArr');
    if (a) {
        e.stopPropagation();
        const row = a.closest('.welcomeListWrapper, #fcdYours, #fcdLive, .fcdXRow');
        const grid = row && row.querySelector('.welcomeListGrid, .welcomeListGridBig, .fcdYoursGrid');
        if (grid) grid.scrollBy({ left: (+a.dataset.d) * Math.max(240, grid.clientWidth * 0.85), behavior: config.animations ? 'smooth' : 'auto' });
        return;
    }
    if (e.target.closest('.fcdSeeAll')) { e.stopPropagation(); select('search-channel'); }
}

// size the columns so a whole number of cards fills the row exactly (the rest scroll)
function fitColumns(grid, minW) {
    if (!grid) return;
    const w = grid.clientWidth - 48;              // 24px padding either side
    if (w <= 0) return;
    const cols = Math.max(1, Math.floor((w + 16) / (minW + 16)));
    const col = Math.floor((w - (cols - 1) * 16) / cols) + 'px';
    if (grid.style.getPropertyValue('--fcd-col') !== col) grid.style.setProperty('--fcd-col', col);
}

function decorateRows(content) {
    let i = 0;
    const yours = document.getElementById('fcdYours');
    if (yours && yours.classList.contains('has')) i = 1;
    content.querySelectorAll('.welcomeListWrapper').forEach(row => {
        const t = rowType(row);
        if (row.getAttribute('data-fcd-row') !== t) row.setAttribute('data-fcd-row', t);
        const iv = String(i++);
        if (row.style.getPropertyValue('--fcd-i') !== iv) row.style.setProperty('--fcd-i', iv);
        const title = row.querySelector('.titleWrapper');
        if (title && !title.querySelector(':scope > .fcdArrows')) {
            const box = document.createElement('div');
            box.className = 'fcdArrows';
            const seeAll = t === 'games';
            box.innerHTML = (seeAll ? '<span class="fcdSeeAll">' + ET('See all') + '</span>' : '') + arrowsHtml();
            title.appendChild(box);
        }
        const grid = row.querySelector('.welcomeListGrid, .welcomeListGridBig');
        fitColumns(grid, t === 'cat' ? 168 : 208);
        const h3 = title && title.querySelector('h3');
        const n = grid ? String(grid.children.length || '') : '';
        if (h3 && h3.getAttribute('data-fcd-n') !== n) h3.setAttribute('data-fcd-n', n);
        wireScroller(row, grid);
        if (row.__fcdEdge) row.__fcdEdge();
    });
}

/* ------------------------------------------------------------ card extras */

function joinedChannels() {
    const r = root(), G = glob();
    const isGame = (id) => (G && typeof G.isGameChannel === 'function') ? G.isGameChannel(id) : !/-channel$/.test(id);
    return (r?.channels || []).filter(c => c && c.id && isGame(c.id));
}

function cardChannelName(card) {
    const ch = card.__vue__?.channel;
    if (ch?.name) return ch.name;
    const t = card.getAttribute('title') || '';
    const sys = card.querySelector('.system')?.textContent.trim();
    return sys && t.endsWith(' - ' + sys) ? t.slice(0, -(sys.length + 3)) : t;
}

function decorateCards(scope) {
    const joined = new Set(joinedChannels().map(c => c.name || c.id));
    scope.querySelectorAll('.channelPreviewWrapper').forEach(card => {
        const ch = card.__vue__?.channel;
        if (ch && ch.name) remember(plain(ch));
        const isJoined = ch ? !!ch.alreadyJoined || joined.has(ch.name) : joined.has(cardChannelName(card));
        if (card.classList.contains('fcd-joined') !== isJoined) card.classList.toggle('fcd-joined', isJoined);
    });
    scope.querySelectorAll('.eventPreviewWrapper').forEach(card => {
        const ev = card.__vue__?.event;
        let t = ev?.date ? new Date(ev.date).getTime() : NaN;
        if (isNaN(t)) {
            const txt = card.querySelector('.date')?.textContent || '';
            t = Date.parse(txt.split(' - ')[0]);
        }
        const w = isNaN(t) ? null : whenLabel(t);
        const label = w ? w.text : '';
        if ((card.getAttribute('data-fcd-when') || '') !== label) {
            if (label) card.setAttribute('data-fcd-when', label); else card.removeAttribute('data-fcd-when');
        }
        const live = !!(w && w.live);
        if (card.hasAttribute('data-fcd-live') !== live) {
            if (live) card.setAttribute('data-fcd-live', ''); else card.removeAttribute('data-fcd-live');
        }
    });
}

function clock(t) {
    const d = new Date(t), h = d.getHours(), m = d.getMinutes();
    return ((h % 12) || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + (h < 12 ? 'AM' : 'PM');
}

// Counts down under a day ("Starts in 2h 14m", seconds in the last hour), then
// "Tomorrow 7 PM" / "In 3 days" / "Oct 18"; "● LIVE" for 4 h after the start.
// N_('LIVE') N_('Starts in {time}') N_('Tomorrow {time}') N_('In {n} days')
function whenLabel(t, now) {
    now = now || Date.now();
    // (the unit test calls this without a running Fightcord: plain English then)
    const tt = (s, v) => (fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => v[k]));
    if (t <= now) return now - t < 4 * 3600000 ? { text: '● ' + tt('LIVE'), live: true } : null;
    const s = Math.floor((t - now) / 1000);
    if (s < 3600) return { text: tt('Starts in {time}', { time: Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's' }) };
    if (s < 86400) return { text: tt('Starts in {time}', { time: Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm' }) };
    const day = (x) => { const d = new Date(x); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const days = Math.round((day(t) - day(now)) / 86400000);
    if (days === 1) return { text: tt('Tomorrow {time}', { time: clock(t) }) };
    if (days < 7) return { text: tt('In {n} days', { n: days }) };
    return { text: new Date(t).toLocaleDateString(fc ? fc.t.locale() : 'en-US', { month: 'short', day: 'numeric' }) };
}

// clicking a game card (not its buttons) opens its game page
function onCardClick(e) {
    if (!config.enabled || e.button !== 0) return;
    if (!document.documentElement.classList.contains('fcd-browse')) return;
    const card = e.target.closest('.channelPreviewWrapper');
    if (!card || !card.closest('.welcomeWrapper, .searchWrapper')) return;
    if (e.target.closest('a, button, .button-generic')) return;
    openGame(channelFromCard(card));
}

/* -------------------------------------------------------------- your games */

function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return T('just now');
    if (s < 3600) return T('{n}m ago', { n: Math.floor(s / 60) });
    if (s < 86400) return T('{n}h ago', { n: Math.floor(s / 3600) });
    if (s < 7 * 86400) return T('{n}d ago', { n: Math.floor(s / 86400) });
    return new Date(t).toLocaleDateString(fc.t.locale(), { month: 'short', day: 'numeric' });
}

function onlineIn(name) {
    const all = root()?.globalUsers || {};
    let n = 0;
    for (const k in all) { const u = all[k]; if (u && Array.isArray(u.channels) && u.channels.includes(name)) n++; }
    return n;
}

// played recently (newest first), then other joined channels, then favourites
function yourGames() {
    const joined = joinedChannels();
    const byName = new Map(joined.map(c => [c.name || c.id, c]));
    const byShort = new Map(joined.map(c => [shortName(c.name || c.id), c]));
    const items = new Map();
    const sets = historySets();
    for (let i = sets.length - 1; i >= 0; i--) {
        const s = sets[i];
        const c = (s.channel && byName.get(s.channel)) || byShort.get(s.game || '');
        const full = c ? (c.name || c.id) : (s.channel || s.game || '');
        if (!full) continue;
        let it = items.get(full);
        if (!it) {
            it = { full, short: shortName(full), rom: (c && c.gameid) || s.rom || '', chan: c || null, lastAt: s.at, w: 0, l: 0, d: 0, played: true };
            items.set(full, it);
        }
        if (s.result === 'won') it.w++; else if (s.result === 'lost') it.l++; else if (s.result === 'draw') it.d++;
    }
    joined.forEach(c => {
        const full = c.name || c.id;
        if (!items.has(full)) items.set(full, { full, short: shortName(full), rom: c.gameid || '', chan: c, joined: true });
    });
    const favs = glob()?.localUser?.favoritesChannels || [];
    favs.forEach(full => { if (!items.has(full)) items.set(full, { full, short: shortName(full), rom: (chanCache.get(full) || {}).gameid || (catalog().find(x => x.name === full) || {}).gameid || '', chan: null, fav: true }); });
    return [...items.values()].slice(0, 16);
}

// your rank in that game (last set's rank, or the Progress chart's) + ELO and how far to the next rank
function tileRank(it) {
    if (!it.rom && !it.full) return '';
    const rom = String(it.rom || '').replace(/^fc1_/, '');
    const pr = plugin('progress');
    const sum = pr && pr.summary && rom ? pr.summary(rom) : null;
    const last = sum && sum.last;
    let rank = last && last.rank ? fc.data.rankNum(last.rank) : 0;
    if (!rank) { const s = historySets().slice().reverse().find(x => x.rom === it.rom || x.channel === it.full); rank = s ? fc.data.rankNum(s.myRank) : 0; }
    if (!rank) return '';
    const real = fc.elo && fc.elo.mine ? fc.elo.mine(rom) : null;
    const elo = real && real.elo ? real.elo : (last && typeof last.elo === 'number' ? last.elo : null);
    const band = nextBand(rank, elo, fc.data.ELO_BANDS);
    const tip = band ? (band.next ? T('{pct}% of the way to {rank}', { pct: Math.round(band.frac * 100), rank: fc.data.rankLetter(band.next) }) : T('Top rank')) : '';
    return '<div class="fcdTileRank" title="' + esc(tip) + '">' + fc.ui.tag(rank, '', 22) +
        (elo ? '<span class="elo">' + (real && real.elo ? '' : '~') + fc.fmt.num(Math.round(elo)) + '</span>' : '') +
        (band ? '<i class="bar"><i style="width:' + Math.round(band.frac * 100) + '%;background:' + fc.data.rankColor(rank) + '"></i></i>' : '') + '</div>';
}

function tileSub(it) {
    if (it.played) {
        const rec = (it.w || it.l || it.d) ? ' · ' + it.w + '–' + it.l + (it.d ? '–' + it.d : '') : '';
        return esc(T('Played {when}', { when: ago(it.lastAt) }) + rec);
    }
    if (it.chan) {
        const n = onlineIn(it.full);
        return n ? '<span class="fcdOn"></span>' + ET('{n} online', { n }) : ET('Joined');
    }
    return fc.ui.ic('star', 'fill') + ET('Favourite');
}

const artState = {};   // url -> 'loading' | 'ok' | 'fail'
function applyArt(el, rom) {
    if (!rom) return;
    const url = artUrl(rom);
    if (artState[url] === 'ok') {
        if (!el.classList.contains('art')) { el.style.setProperty('background-image', 'url("' + url + '")', 'important'); el.classList.add('art'); }
    } else if (!artState[url]) {
        artState[url] = 'loading';
        const img = new Image();
        img.onload = () => { artState[url] = 'ok'; applyArt(el, rom); };
        img.onerror = () => { artState[url] = 'fail'; };
        img.src = url;
    }
}

let yoursKeys = '';
let yoursAt = 0;

function renderYours(content) {
    let row = document.getElementById('fcdYours');
    if (!config.yourGames) { row?.classList.remove('has'); return; }
    if (!row || row.parentNode !== content) {
        row?.remove();
        row = document.createElement('div');
        row.id = 'fcdYours';
        row.innerHTML = `<div class="fcdRowHead"><h3>${ET('Your games')}<span class="fcdCount fcdYoursCount"></span></h3><span class="fcdShowAll"></span></div>
            <div class="fcdYoursGrid"></div>`;
        row.addEventListener('click', onYoursClick);
        content.appendChild(row);          // at the end; CSS order puts it under the hero
        yoursKeys = '';
    }
    yoursLimit(row);
    const now = Date.now();
    if (yoursKeys && now - yoursAt < 3000) return;
    yoursAt = now;
    const list = yourGames();
    const grid = row.querySelector('.fcdYoursGrid');
    const keys = list.map(it => it.full).join('\n');
    if (keys !== yoursKeys) {
        yoursKeys = keys;
        grid.innerHTML = list.map(it => `<div class="fcdTile" data-full="${esc(it.full)}" title="${esc(it.full)}" data-art="${esc(it.rom ? artUrl(it.rom) : '')}">
            <div class="fcdTileArt"><span class="fcdTileIni">${esc(initials(it.full))}</span></div>
            <div class="fcdTileBody"><div class="fcdTileName">${esc(it.short)}</div><div class="fcdTileSub">${tileSub(it)}</div></div>
            ${it.played ? tileRank(it) : ''}
            <span class="fcdTilePlay" title="Play">▶</span>
        </div>`).join('');
        yoursLimit(row, true);
        grid.__fcdWired = false;
        wireScroller(row, grid);
    } else {
        grid.querySelectorAll('.fcdTile').forEach((t, i) => {
            const sub = tileSub(list[i]);
            const el = t.querySelector('.fcdTileSub');
            if (el.innerHTML !== sub) el.innerHTML = sub;
        });
    }
    grid.querySelectorAll('.fcdTile').forEach((t, i) => applyArt(t.querySelector('.fcdTileArt'), list[i].rom));
    const cnt = row.querySelector('.fcdYoursCount');
    if (cnt && cnt.textContent !== String(list.length)) cnt.textContent = String(list.length);
    row.__items = list;
    row.classList.toggle('has', list.length > 0);
    if (row.__fcdEdge) row.__fcdEdge();
}

// two rows of tiles, the rest behind "Show all"
let yoursAll = false;
function yoursLimit(row, force) {
    const grid = row.querySelector('.fcdYoursGrid');
    const tiles = grid ? grid.querySelectorAll('.fcdTile') : [];
    const w = grid ? grid.clientWidth - 48 : 0;
    const cols = w > 0 ? Math.max(1, Math.floor((w + 16) / (280 + 16))) : 4;
    const limit = cols * 2;
    const sig = limit + ':' + tiles.length + ':' + yoursAll;
    if (!force && row.__limitSig === sig) return;
    row.__limitSig = sig;
    tiles.forEach((t, i) => t.classList.toggle('fcdHid', i >= limit));
    row.classList.toggle('all', yoursAll);
    const btn = row.querySelector('.fcdShowAll');
    if (btn) btn.textContent = tiles.length > limit ? (yoursAll ? T('Show less') : T('Show all ({n})', { n: tiles.length })) : '';
}

function onYoursClick(e) {
    if (e.target.closest('.fcdShowAll')) { yoursAll = !yoursAll; yoursLimit(e.currentTarget, true); return; }
    const tile = e.target.closest('.fcdTile');
    if (!tile) return;
    const row = document.getElementById('fcdYours');
    const it = (row.__items || []).find(x => x.full === tile.dataset.full);
    if (!it) return;
    if (!e.target.closest('.fcdTilePlay')) { openGame(channelByName(it.full, it.rom)); return; }
    // ▶ jumps straight in: the channel if joined, else Fightcade's results for it
    const c = joinedChannels().find(x => (x.name || x.id) === it.full);
    if (c) select(c.id);
    else select('search-channel', { textFilter: it.short });
}

/* ------------------------------------------------------------ results view */

function decorateSearch(wrap) {
    const tw = wrap.querySelector('.searchResultsWrapper .titleWrapper');
    if (!tw) return;
    const sc = searchComp();
    const L = filterLists();
    let title = '';
    if (sc) {
        const parts = [];
        const g = +sc.genreFilter || 0, s = +sc.systemFilter || 0, y = +sc.yearFilter || 0;
        if (sc.favorites) parts.push(T('Favourites'));
        if (g > 0) parts.push(T(L.allGenres[g]));
        if (s > 0) parts.push(L.allSystems[s]);
        const years = glob()?.filtersOptions?.years;
        if (y > 0 && years) parts.push(String(years[y]));
        if (sc.textFilter) parts.push(T('Results for “{q}”', { q: sc.textFilter }));
        title = parts.length ? parts.join(' · ') : T('All games');
    }
    const list = sc?.$refs?.paginatedList;
    const fetching = list ? !!list.fetchingData : false;
    let total = list && !fetching ? list.totalChannels : null;
    if (total == null) {
        const spans = wrap.querySelectorAll('.paginationWrapper .range span');
        if (spans.length) total = parseInt(spans[spans.length - 1].textContent.replace(/\D/g, ''), 10);
    }
    const count = (total || total === 0) && !fetching ? total.toLocaleString('en-US') + (total === 1 ? ' game' : ' games') : '';
    setAttr(tw, 'data-fcd-title', title);
    setAttr(tw, 'data-fcd-count', count);
}

function setAttr(el, name, v) {
    if (v) { if (el.getAttribute(name) !== v) el.setAttribute(name, v); }
    else if (el.hasAttribute(name)) el.removeAttribute(name);
}

/* ------------------------------------------------------------ live matches */

// Matches in the channels you've joined: players sharing a quark, as FC tracks them.
const firstSeen = new Map();     // quarkId -> first time we saw it
// matches already running when Fightcord started have an unknown start time: no timer for those
let liveBoot = 0;
const LIVE_BOOT_MS = 15000;

function liveMatches() {
    const all = users();
    const byId = new Map(joinedChannels().map(c => [c.id, c]));
    const q = new Map();
    for (const name in all) {
        const p = all[name] && all[name].playing;
        if (!p || !p.quarkId || !p.channelId) continue;
        let m = q.get(p.quarkId);
        if (!m) { m = { quark: p.quarkId, channel: p.channelId, gameId: p.gameId, port: p.port, players: [] }; q.set(p.quarkId, m); }
        if (m.players.length < 2 && !m.players.includes(name)) m.players.push(name);
    }
    const now = Date.now();
    if (!liveBoot) liveBoot = now;
    const out = [];
    q.forEach(m => {
        if (!firstSeen.has(m.quark)) firstSeen.set(m.quark, now);
        m.since = firstSeen.get(m.quark);
        m.timed = m.since - liveBoot > LIVE_BOOT_MS;
        m.chan = byId.get(m.channel) || null;
        out.push(m);
    });
    if (firstSeen.size > 400) firstSeen.forEach((_, k) => { if (!q.has(k)) firstSeen.delete(k); });
    return out.sort((a, b) => a.since - b.since);
}

// the joined channel, or what the welcome cards told us about it
const liveChan = (m) => m.chan || chanCache.get(m.channel) || null;
function canWatch(m) {
    const c = liveChan(m);
    return !!(c && c.spectators && c.emulator && m.port != null && m.gameId && !m.players.includes(myName()));
}
// exactly FC's own spectateMatch: fcade://stream/<emulator>/<rom>/<quark>.2,<port>
function watch(m) {
    if (canWatch(m)) openUri('fcade://stream/' + liveChan(m).emulator + '/' + m.gameId + '/' + m.quark + '.2,' + m.port);
}

function durText(since) {
    const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function playerBits(name, channel) {
    const u = users()[name] || {};
    return { name, cc: u.country?.iso_code || '', rank: u.channelRank?.[channel] || 0 };
}

let liveKeys = '';

function liveCardHtml(m) {
    const [a, b] = m.players.map(n => playerBits(n, m.channel));
    const art = m.chan && m.chan.gameid ? artUrl(m.chan.gameid) : (m.gameId ? artUrl(m.gameId) : '');
    const me = myName();
    const side = (p, note) => `<div class="fcdLiveP"><img class="fcdAva" src="${esc(avatarUrl(p.name))}" alt="">
        <div class="fcdLiveN">${flagImg(p.cc)}<b>${esc(p.name === me ? T('You') : p.name)}</b>${rankPill(p.rank)}</div>${note ? `<div class="fcdLiveNote">${note}</div>` : ''}</div>`;
    // the opponent is only known when they're in a channel you've joined
    const vs = b ? `<div class="fcdLiveVs">${side(a)}<div class="fcdLiveVsTxt">VS</div>${side(b)}</div>`
        : `<div class="fcdLiveVs solo">${side(a, ET('in a match'))}</div>`;
    const c = liveChan(m);
    const act = m.players.includes(me) ? ET("You're playing")
        : canWatch(m) ? '<span class="fcdWatch" data-watch="1">' + fc.ui.ic('eye') + ET('Watch') + '</span>'
        : `<span class="fcdLiveDet" data-det="1" title="${ET(c && c.spectators === false ? 'Spectating is off in this channel' : 'Open the game page')}">${ET('Details')}</span>`;
    return `<div class="fcdLiveCard" data-q="${esc(m.quark)}" data-art="${esc(art)}">
        <div class="fcdLiveBg" style="background-image:url(&quot;${esc(art)}&quot;) !important"></div>
        <div class="fcdLiveIn">
            <div class="fcdLiveTop"><span class="fcdLivePill">● LIVE</span>${m.timed ? `<span class="fcdLiveTime">${durText(m.since)}</span>` : ''}</div>
            <div class="fcdLiveGame" title="${esc(m.channel)}">${esc(shortName(m.channel))}</div>
            ${vs}
            <div class="fcdLiveAct">${act}</div>
        </div></div>`;
}

function renderLive(content) {
    let row = document.getElementById('fcdLive');
    if (!config.liveRow) { row?.classList.remove('has'); return; }
    if (!row || row.parentNode !== content) {
        row?.remove();
        row = document.createElement('div');
        row.id = 'fcdLive';
        row.innerHTML = `<div class="fcdRowHead"><h3>${ET('Live now')}<span class="fcdCount fcdLiveCount"></span></h3><div class="fcdArrows">${arrowsHtml()}</div></div>
            <div class="fcdYoursGrid"></div>`;
        row.addEventListener('click', onLiveClick);
        content.appendChild(row);          // after #fcdYours; CSS order keeps both under the hero
        liveKeys = '';
    }
    const list = liveMatches();
    const grid = row.querySelector('.fcdYoursGrid');
    const keys = list.map(m => m.quark + ':' + m.players.join(',') + ':' + canWatch(m) + ':' + m.timed).join('|');
    if (keys !== liveKeys) {
        liveKeys = keys;
        grid.innerHTML = list.map(liveCardHtml).join('');
        grid.__fcdWired = false;
        wireScroller(row, grid);
    } else {
        grid.querySelectorAll('.fcdLiveCard').forEach((c, i) => {
            const t = c.querySelector('.fcdLiveTime');
            const txt = list[i] && list[i].timed ? durText(list[i].since) : '';
            if (t && t.textContent !== txt) t.textContent = txt;
        });
    }
    const cnt = row.querySelector('.fcdLiveCount');
    const ct = list.length ? String(list.length) : '';
    if (cnt.textContent !== ct) cnt.textContent = ct;
    fitColumns(grid, 280);
    row.__items = list;
    row.classList.toggle('has', list.length > 0);
    if (row.__fcdEdge) row.__fcdEdge();
}

function onLiveClick(e) {
    const card = e.target.closest('.fcdLiveCard');
    if (!card) return;
    const m = (document.getElementById('fcdLive').__items || []).find(x => String(x.quark) === card.dataset.q);
    if (!m) return;
    if (e.target.closest('[data-watch]')) { watch(m); return; }
    openGame(channelByName(m.channel, m.gameId));
}


/* ------------------------------------------------------------- for you rows */

const DAY_MS = 86400000;

// friends who are around: in a match first, then free (away ones left out)
// friends: names; all: globalUsers -> [{ name, playing, channels }]
function friendsNow(friends, all) {
    const lower = new Map(Object.keys(all || {}).map(k => [k.toLowerCase(), k]));
    const out = [];
    (friends || []).forEach(f => {
        const key = lower.get(String(f || '').toLowerCase());
        const u = key && all[key];
        if (!u) return;
        const playing = u.playing && u.playing.quarkId ? u.playing : null;
        if (!playing && u.away) return;
        out.push({ name: key, playing, channels: Array.isArray(u.channels) ? u.channels : [] });
    });
    return out.sort((a, b) => (b.playing ? 1 : 0) - (a.playing ? 1 : 0) || a.name.localeCompare(b.name));
}

// people you've played in the last 30 days who are online and free now, most played first
// -> [{ name, w, l, sets, last, channel, rom, rank }]
function rivalsOnline(sets, all, me, now) {
    const since = (now || Date.now()) - 30 * DAY_MS;
    const lme = String(me || '').toLowerCase();
    const map = new Map();
    (sets || []).forEach(s => {
        if (!s || !s.opp || !(s.at >= since)) return;
        const k = s.opp.toLowerCase();
        const e = map.get(k) || { name: s.opp, w: 0, l: 0, sets: 0, last: 0, channel: '', rom: '' };
        e.sets++;
        if (s.result === 'won') e.w++; else if (s.result === 'lost') e.l++;
        if (s.at > e.last) { e.last = s.at; e.channel = s.channel || ''; e.rom = s.rom || ''; }
        map.set(k, e);
    });
    const lower = new Map(Object.keys(all || {}).map(k => [k.toLowerCase(), k]));
    const out = [];
    map.forEach((e, k) => {
        const key = lower.get(k);
        const u = key && all[key];
        if (!u || k === lme || u.away || (u.playing && u.playing.quarkId)) return;
        const rk = u.channelRank || {};
        out.push(Object.assign({}, e, { name: key, rank: +(rk[e.channel] || 0) || Math.max(0, ...Object.values(rk).map(Number).filter(n => n > 0)) }));
    });
    return out.sort((a, b) => b.sets - a.sets || b.last - a.last).slice(0, 12);
}

// the next 7 days of events; yours (reminded) first unless asked for all
// list: events.js upcoming() -> [{...ev, day: 0 today | 1 tomorrow | 2..6}]
function eventsWeek(list, now, all) {
    const t = now || Date.now();
    const midnight = new Date(t); midnight.setHours(0, 0, 0, 0);
    const week = (list || []).filter(ev => ev && ev.date > t - 30 * 60000 && ev.date < t + 7 * DAY_MS);
    const mine = week.filter(ev => ev.why);
    const pick = all || !mine.length ? week : mine;
    return pick.slice().sort((a, b) => a.date - b.date)
        .map(ev => Object.assign({}, ev, { day: Math.max(0, Math.floor((ev.date - midnight.getTime()) / DAY_MS)), mine: !!ev.why }));
}

// how far through its ELO band a rank is -> { frac, next } (next = the rank above, or null at S)
function nextBand(rank, elo, bands) {
    const b = bands && bands[rank];
    if (!b || typeof elo !== 'number') return null;
    return { frac: Math.max(0, Math.min(1, (elo - b[0]) / (b[1] - b[0]))), next: rank < 6 ? rank + 1 : null };
}

// one row: header (icon, title, count), a horizontal grid of cards
function ensureRow(content, id, title, icon, onClick) {
    let row = document.getElementById(id);
    if (!row || row.parentNode !== content) {
        row?.remove();
        row = document.createElement('div');
        row.id = id;
        row.className = 'fcdXRow';
        row.innerHTML = '<div class="fcdRowHead"><h3>' + fc.ui.ic(icon) + ET(title) + '<span class="fcdCount"></span></h3><span class="fcdShowAll"></span>' +
            '<div class="fcdArrows">' + arrowsHtml() + '</div></div><div class="fcdYoursGrid"></div>';
        row.addEventListener('click', onClick);
        content.appendChild(row);
        row.__keys = '';
    }
    return row;
}
function fillRow(row, items, keys, html, colW) {
    const grid = row.querySelector('.fcdYoursGrid');
    if (keys !== row.__keys) {
        row.__keys = keys;
        grid.innerHTML = items.map(html).join('');
        grid.__fcdWired = false;
        wireScroller(row, grid);
    }
    const cnt = row.querySelector('.fcdCount');
    const ct = items.length ? String(items.length) : '';
    if (cnt.textContent !== ct) cnt.textContent = ct;
    fitColumns(grid, colW);
    row.__items = items;
    row.classList.toggle('has', items.length > 0);
    if (row.__fcdEdge) row.__fcdEdge();
}
const hideRow = (id) => document.getElementById(id)?.classList.remove('has');
const gameOf = (chans) => (chans || []).find(c => fc.app.isGameChannel(c)) || '';

/* friends playing now */

function friendCardHtml(f) {
    const m = f.playing ? liveMatches().find(x => String(x.quark) === String(f.playing.quarkId)) : null;
    const chan = f.playing ? f.playing.channelId : gameOf(f.channels);
    const opp = m ? m.players.find(n => n !== f.name) : '';
    const rank = (users()[f.name]?.channelRank || {})[chan] || 0;
    const sub = f.playing ? (opp ? ET('vs {name}', { name: opp }) : ET('in a match')) : ET('Online');
    const act = m && canWatch(m) ? '<span class="fcdPBtn watch" data-act="watch">' + fc.ui.ic('eye') + ET('Watch') + '</span>'
        : chan ? '<span class="fcdPBtn" data-act="open">' + ET('Open game') + '</span>' : '';
    return '<div class="fcdPCard' + (f.playing ? ' playing' : '') + '" data-n="' + esc(f.name) + '" data-art="' + esc(chan ? artUrl((chanCache.get(chan) || {}).gameid || (m && m.gameId) || '') : '') + '">' +
        '<div class="fcdPArt"></div>' +
        '<div class="fcdPMain"><span class="fcdPAva"><img class="fcdAva" src="' + esc(avatarUrl(f.name)) + '" alt=""><i class="st ' + (f.playing ? 'playing' : 'on') + '"></i></span>' +
        '<div class="fcdPTx"><b data-act="scout">' + esc(f.name) + '</b>' + (rank ? rankPill(rank) : '') +
        '<span class="sub">' + (f.playing ? '<span class="fcdLiveDot"></span>' : '') + sub + '</span>' +
        '<span class="game">' + esc(shortName(chan)) + '</span></div></div>' +
        '<div class="fcdPAct">' + act + '</div></div>';
}

function renderFriends(content) {
    const fr = plugin('friends');
    if (!config.friendsRow || !fr || !fr.list) { hideRow('fcdFriends'); return; }
    const row = ensureRow(content, 'fcdFriends', 'Friends playing now', 'users', onPeopleClick);
    const list = friendsNow(fr.list(), users());
    const keys = list.map(f => f.name + ':' + (f.playing ? f.playing.quarkId : '') + ':' + gameOf(f.channels)).join('|');
    fillRow(row, list, keys, friendCardHtml, 260);
    row.querySelectorAll('.fcdPCard').forEach(c => { if (c.dataset.art) setBg(c.querySelector('.fcdPArt'), c.dataset.art); });
}

/* rivals online */

function rivalCardHtml(r) {
    const rec = r.w || r.l ? r.w + '–' + r.l : '';
    return '<div class="fcdPCard rival" data-n="' + esc(r.name) + '" data-art="' + esc(r.rom ? artUrl(r.rom) : '') + '">' +
        '<div class="fcdPArt"></div>' +
        '<div class="fcdPMain"><span class="fcdPAva"><img class="fcdAva" src="' + esc(avatarUrl(r.name)) + '" alt=""><i class="st on"></i></span>' +
        '<div class="fcdPTx"><b data-act="scout">' + esc(r.name) + '</b>' + (r.rank ? rankPill(r.rank) : '') +
        '<span class="sub">' + (rec ? '<span class="rec ' + (r.w >= r.l ? 'up' : 'down') + '">' + esc(rec) + '</span><span>&nbsp;·&nbsp;</span>' : '') +
        ET('last played {when}', { when: ago(r.last) }) + '</span>' +
        '<span class="game">' + esc(shortName(r.channel)) + '</span></div></div>' +
        '<div class="fcdPAct"><span class="fcdPBtn go" data-act="challenge">' + fc.ui.ic('swords') + ET('Challenge') + '</span></div></div>';
}

function renderRivals(content) {
    if (!config.rivalsRow) { hideRow('fcdRivals'); return; }
    const row = ensureRow(content, 'fcdRivals', 'Rivals online', 'swords', onPeopleClick);
    const list = rivalsOnline(historySets(), users(), myName(), Date.now());
    fillRow(row, list, list.map(r => r.name + ':' + r.w + '-' + r.l + ':' + r.rank).join('|'), rivalCardHtml, 260);
    row.querySelectorAll('.fcdPCard').forEach(c => { if (c.dataset.art) setBg(c.querySelector('.fcdPArt'), c.dataset.art); });
}

function onPeopleClick(e) {
    const card = e.target.closest('.fcdPCard');
    if (!card) return;
    const name = card.dataset.n;
    const a = e.target.closest('[data-act]');
    const act = a && a.dataset.act;
    if (act === 'scout') { const sc = plugin('scout'); if (sc && sc.openCard) sc.openCard(name, a.getBoundingClientRect(), 'right'); return; }
    if (act === 'challenge') {
        const ms = plugin('match-screens');
        const st = ms && ms.challenge ? ms.challenge(name) : { ok: false, why: T('Match screens are off') };
        if (st.ok) { a.classList.add('sent'); a.innerHTML = fc.ui.ic('check') + ET('Sent'); }
        else fc.ui.toast(st.why || T('Couldn’t challenge'), { kind: 'warning', icon: 'sword' });
        return;
    }
    const u = users()[name] || {};
    const p = u.playing && u.playing.quarkId ? u.playing : null;
    if (act === 'watch' && p) { const m = liveMatches().find(x => String(x.quark) === String(p.quarkId)); if (m) watch(m); return; }
    const chan = p ? p.channelId : gameOf(u.channels);
    if (chan) openGame(channelByName(chan, (chanCache.get(chan) || {}).gameid));
}

/* events this week */

let eventsAll = false;
function dayName(ev) {
    if (ev.day === 0) return T('Today');
    if (ev.day === 1) return T('Tomorrow');
    return new Date(ev.date).toLocaleDateString(fc.t.locale(), { weekday: 'long' });
}
function countdown(t) {
    const m = Math.round((t - Date.now()) / 60000);
    if (m <= 0) return T('Live now');
    if (m < 60) return T('in {n} min', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return T('in {h}h {m}m', { h, m: m % 60 });
    const d = Math.round(h / 24);
    return d === 1 ? T('in a day') : T('in {n} days', { n: d });
}
function eventCardHtml(ev) {
    const clock = new Date(ev.date).toLocaleTimeString(fc.t.locale(), { hour: 'numeric', minute: '2-digit' });
    const live = ev.date <= Date.now();
    return '<div class="fcdEvCard' + (ev.mine ? ' mine' : '') + (live ? ' live' : '') + '" data-k="' + esc(ev.key) + '">' +
        '<div class="fcdEvArt" style="background-image:url(&quot;' + esc(ev.image || (ev.gameid ? artUrl(ev.gameid) : '')) + '&quot;) !important"></div>' +
        '<div class="fcdEvIn"><div class="fcdEvWhen"><span class="d">' + esc(dayName(ev)) + '</span><span class="t">' + esc(clock) + '</span>' +
        '<span class="fcdEvBell' + (ev.mine ? ' on' : '') + '" data-act="bell" title="' + ET(ev.mine ? 'Reminder set — click to remove' : 'Remind me') + '">' + fc.ui.icon('bell') + '</span></div>' +
        '<div class="fcdEvName" title="' + esc(ev.name) + '">' + esc(ev.name) + '</div>' +
        '<div class="fcdEvMeta">' + (ev.region ? '<span>' + esc(ev.region) + '</span>' : '') + (ev.channel ? '<span>' + esc(shortName(ev.channel)) + '</span>' : '') + '</div>' +
        '<div class="fcdEvFoot"><span class="fcdEvCount">' + esc(countdown(ev.date)) + '</span>' +
        (ev.channel ? '<span class="fcdPBtn" data-act="open">' + ET('Open channel') + '</span>' : '') +
        (ev.link ? '<span class="fcdPBtn ghost" data-act="info">' + ET('Info') + '</span>' : '') + '</div></div></div>';
}

function renderEvents(content) {
    const evm = plugin('events');
    if (!config.eventsRow || !evm || !evm.upcoming) { hideRow('fcdEvents'); return; }
    const row = ensureRow(content, 'fcdEvents', 'Events this week', 'bell', onEventsClick);
    const now = Date.now();
    if (row.__at && now - row.__at < 5000 && row.__keys) {
        row.querySelectorAll('.fcdEvCard').forEach((c, i) => { const ev = row.__items[i]; const el = c.querySelector('.fcdEvCount'); const t = ev ? countdown(ev.date) : ''; if (el && el.textContent !== t) el.textContent = t; });
        return;
    }
    row.__at = now;
    const raw = evm.upcoming();
    const mineCount = raw.filter(ev => ev.why && ev.date < now + 7 * DAY_MS).length;
    const list = eventsWeek(raw, now, eventsAll).slice(0, 20);
    const all = eventsWeek(raw, now, true).length;
    const btn = row.querySelector('.fcdShowAll');
    const label = mineCount && all > mineCount ? (eventsAll ? T('Your games only') : T('Show all ({n})', { n: all })) : '';
    if (btn.textContent !== label) btn.textContent = label;
    fillRow(row, list, list.map(ev => ev.key + ':' + ev.mine + ':' + ev.day).join('|'), eventCardHtml, 248);
}

function onEventsClick(e) {
    const row = e.currentTarget;
    if (e.target.closest('.fcdShowAll')) { eventsAll = !eventsAll; row.__at = 0; row.__keys = ''; tick(); return; }
    const card = e.target.closest('.fcdEvCard');
    if (!card) return;
    const ev = (row.__items || []).find(x => x.key === card.dataset.k);
    if (!ev) return;
    const a = e.target.closest('[data-act]');
    const act = a && a.dataset.act;
    if (act === 'bell') { const evm = plugin('events'); if (evm && evm.toggle) evm.toggle(ev.key); row.__at = 0; row.__keys = ''; tick(); return; }
    if (act === 'info' && /^https?:\/\//i.test(ev.link || '')) { openUri(ev.link); return; }
    if (ev.channel) {
        const c = joinedChannels().find(x => (x.id || x.name) === ev.channel);
        if (c) select(c.id);
        else if (act === 'open') { const r = root(); if (r && typeof r.joinChannel === 'function') { try { r.joinChannel(ev.channel); } catch (err) { LOG('join failed', err.message); } } }
        else openGame(channelByName(ev.channel, ev.gameid));
    }
}

// a card's art, once it has loaded (no flash of a broken image)
function setBg(el, url) {
    if (!el || !url || el.__bg === url) return;
    el.__bg = url;
    const img = new Image();
    img.onload = () => { if (el.__bg === url) el.style.setProperty('background-image', 'url("' + url + '")', 'important'); };
    img.src = url;
}

/* --------------------------------------------------------------- game page */

let game = { ch: null, token: 0, top: null, recent: null, err: {}, dyn: '' };

function ensureGamePanel() {
    let panel = document.getElementById('fcdGame');
    if (panel) return panel;
    const dim = document.createElement('div');
    dim.id = 'fcdGameDim';
    dim.addEventListener('click', (e) => { if (e.isTrusted || window.__fcdTest) closeGame(); });
    panel = document.createElement('aside');
    panel.id = 'fcdGame';
    panel.innerHTML = `<div class="fcdGHead"><div class="fcdGBg"></div><div class="fcdGArt"></div><div class="fcdGClose" title="${ET('Close (Esc)')}">${fc.ui.icon('close')}</div></div>
        <div class="fcdGScroll"><div class="fcdGTop"></div><div class="fcdGDyn"></div></div>`;
    panel.addEventListener('click', onGameClick);
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(dim);
    document.body.appendChild(panel);
    return panel;
}

function openGame(ch) {
    if (!ch || !ch.name) return;
    ch = remember(Object.assign({}, ch));
    const panel = ensureGamePanel();
    game = { ch, token: game.token + 1, top: null, recent: null, err: {}, dyn: '' };
    const url = ch.gameid ? artUrl(ch.gameid) : '';
    ['.fcdGBg', '.fcdGArt'].forEach(sel => panel.querySelector(sel).style.setProperty('background-image', url ? 'url("' + url + '")' : 'none', 'important'));
    const paren = (ch.name.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
    panel.querySelector('.fcdGTop').innerHTML = `<div class="fcdGName">${esc(shortName(ch.name))}</div>
        ${paren ? `<div class="fcdGFull">${esc(paren)}</div>` : ''}<div class="fcdGTags"></div><div class="fcdGStats"></div><div class="fcdGBtns"></div>`;
    panel.querySelector('.fcdGScroll').scrollTop = 0;
    renderGame();
    panel.classList.add('open');
    document.getElementById('fcdGameDim').classList.add('open');
    closeQuick();
    loadGameApi(game.token);
}

function closeGame() {
    document.getElementById('fcdGame')?.classList.remove('open');
    document.getElementById('fcdGameDim')?.classList.remove('open');
    game.ch = null;
}

const gameOpen = () => !!(game.ch && document.getElementById('fcdGame')?.classList.contains('open'));

// searchrankings rows: {name, country:{iso_code}, gameinfo:{<rom>:{rank, num_matches, time_played}}}
function parseRank(r, i, gameid) {
    const gi = (r.gameinfo && (r.gameinfo[gameid] || Object.values(r.gameinfo)[0])) || {};
    const cc = (r.country && (r.country.iso_code || r.country)) || '';
    return {
        pos: i + 1, name: r.name || r.username || '', cc: typeof cc === 'string' ? cc : '',
        rank: gi.rank ?? r.rank ?? null, matches: gi.num_matches ?? r.num_matches ?? null,
        hours: gi.time_played != null ? Math.round(gi.time_played / 3600) : null
    };
}

function parseQuark(r, ch) {
    const players = (Array.isArray(r.players) ? r.players : []).map(p => ({
        name: p.name || p.username || '?', score: typeof p.score === 'number' ? p.score : null,
        cc: (p.country && (p.country.iso_code || p.country)) || '', rank: p.rank
    }));
    const quark = r.quarkid || r.quarkId || r.id || '';
    const emulator = r.emulator || ch.emulator || '';
    const live = r.live === true || (typeof r.status === 'string' && /live|progress|playing/i.test(r.status));
    return {
        players, date: quarkDate(r), live, views: r.realtime_views, games: r.num_matches,
        replay: emulator && quark ? 'https://replay.fightcade.com/' + emulator + '/' + (r.gameid || ch.gameid) + '/' + quark : ''
    };
}

function loadGameApi(token) {
    const ch = game.ch;
    if (!ch.gameid) { game.err.top = game.err.recent = T('unknown game id'); return; }
    fcApi({ req: 'searchrankings', gameid: ch.gameid, limit: 10, offset: 0, byElo: true, recent: true })
        .then(j => { const rows = pickRows(j); noteShape('rankings', j, rows[0]); if (token === game.token) game.top = rows.slice(0, 10).map((r, i) => parseRank(r, i, ch.gameid)); })
        .catch(e => { if (token === game.token) game.err.top = e.message; });
    fcApi({ req: 'searchquarks', gameid: ch.gameid })
        .then(j => { const rows = pickRows(j); noteShape('quarks', j, rows[0]); if (token === game.token) game.recent = rows.slice(0, 40).map(r => parseQuark(r, ch)); })
        .catch(e => { if (token === game.token) game.err.recent = e.message; });
}

const skel = (n) => Array.from({ length: n }, () => '<div class="fcdSkel"></div>').join('');

function youSection(ch) {
    const short = shortName(ch.name);
    const sets = historySets().filter(s => s.channel === ch.name || (!s.channel && s.game === short));
    if (!sets.length) return '<div class="fcdMuted">' + ET('You haven’t played a set here yet (since the session tracker was installed).') + '</div>';
    let w = 0, l = 0, d = 0;
    const opp = {};
    sets.forEach(s => {
        if (s.result === 'won') w++; else if (s.result === 'lost') l++; else if (s.result === 'draw') d++;
        if (s.opp) opp[s.opp] = (opp[s.opp] || 0) + 1;
    });
    const top = Object.keys(opp).sort((a, b) => opp[b] - opp[a])[0];
    const last = sets[sets.length - 1].at;
    return `<div class="fcdYou"><div><b>${w}–${l}${d ? '–' + d : ''}</b><span>${ET('your record')} · ${esc(T.plural(sets.length, '{n} set', '{n} sets'))}</span></div>
        <div><b>${esc(ago(last))}</b><span>${ET('last played')}</span></div>
        ${top ? `<div><b>${esc(top)}</b><span>${ET('played most')} · ${opp[top]}×</span></div>` : ''}</div>`;
}

function liveSection(ch) {
    if (isJoinedName(ch.name)) {
        const list = liveMatches().filter(m => m.channel === ch.name);
        if (!list.length) return '<div class="fcdMuted">' + ET('No matches right now.') + '</div>';
        const me = myName();
        return list.map(m => {
            const [a, b] = m.players.map(n => playerBits(n, m.channel));
            const who = (p, r) => p ? `<div class="fcdGSide${r ? ' r' : ''}">${r ? '' : flagImg(p.cc)}<b>${esc(p.name)}</b>${rankPill(p.rank)}${r ? '&nbsp;' + flagImg(p.cc) : ''}</div>` : '<div class="fcdGSide"></div>';
            const act = m.players.includes(me) ? '<span class="fcdGRight">' + ET('you') + '</span>'
                : canWatch(m) ? `<span class="fcdWatch" data-watch="${esc(m.quark)}">${fc.ui.ic('eye')}${ET('Watch')}</span>` : '';
            return `<div class="fcdGRow"><div class="fcdGMatch"><span class="fcdLiveTag">● ${durText(m.since)}</span>${who(a)}<span class="fcdGVs">VS</span>${who(b, true)}</div>${act}</div>`;
        }).join('');
    }
    const live = (game.recent || []).filter(q => q.live);
    if (!game.recent && !game.err.recent) return skel(2);
    if (!live.length) return '<div class="fcdMuted">' + ET('Join the channel to see and watch its live matches.') + '</div>';
    return live.map(q => matchRow(q)).join('');
}

function matchRow(q) {
    const [a, b] = q.players;
    if (!a || !b) return '';
    const known = a.score != null && b.score != null;
    const aw = known && a.score > b.score, bw = known && b.score > a.score;
    const tail = q.live ? '<span class="fcdLiveTag">● LIVE</span>'
        : (q.date ? esc(ago(q.date)) : '') + (q.replay ? `<span class="fcdLink" data-replay="${esc(q.replay)}">${ET('Replay')}</span>` : '');
    return `<div class="fcdGRow"><div class="fcdGMatch">
        <div class="fcdGSide">${flagImg(a.cc)}<b class="${aw ? 'win' : ''}">${esc(a.name)}</b></div>
        <span class="fcdGScore">${known ? a.score + ' – ' + b.score : 'vs'}</span>
        <div class="fcdGSide r"><b class="${bw ? 'win' : ''}">${esc(b.name)}</b>&nbsp;${flagImg(b.cc)}</div></div>
        <span class="fcdGRight">${tail}</span></div>`;
}

function topSection() {
    if (game.err.top) return `<div class="fcdMuted">Couldn’t load the leaderboard (${esc(game.err.top)}).</div>`;
    if (!game.top) return skel(4);
    if (!game.top.length) return '<div class="fcdMuted">' + ET('No ranked players yet.') + '</div>';
    return game.top.map(p => `<div class="fcdGRow"><span class="fcdGPos">${p.pos}</span>
        <div class="fcdGWho">${flagImg(p.cc)}<b>${esc(p.name)}</b>${rankPill(p.rank)}</div>
        <span class="fcdGRight">${[p.matches != null ? Number(p.matches).toLocaleString('en-US') + ' games' : '',
            p.hours ? Number(p.hours).toLocaleString('en-US') + 'h played' : ''].filter(Boolean).join(' · ')}</span></div>`).join('');
}

function recentSection() {
    if (game.err.recent) return `<div class="fcdMuted">Couldn’t load recent matches (${esc(game.err.recent)}).</div>`;
    if (!game.recent) return skel(4);
    const done = game.recent.filter(q => !q.live && q.games !== 0).slice(0, 8);
    if (!done.length) return '<div class="fcdMuted">' + ET('No recent matches.') + '</div>';
    return done.map(matchRow).join('');
}

function renderGame() {
    const ch = game.ch;
    const panel = document.getElementById('fcdGame');
    if (!ch || !panel) return;
    const c = chanCache.get(ch.name) || ch;
    const joined = isJoinedName(ch.name);
    const fav = isFavName(ch.name);
    const tags = (c.system ? `<span class="fcdSys">${esc(c.system)}</span>` : '') +
        (c.ranked ? '<span class="fcdSys">' + fc.ui.ic('trophy') + ET('Ranked') + '</span>' : '') +
        (c.genre ? `<span class="fcdSys">${ET(c.genre)}</span>` : '') +
        (c.year ? `<span class="fcdSys">${esc(String(c.year))}</span>` : '') +
        (joined ? '<span class="fcdJoined">' + fc.ui.ic('check') + ET('Joined') + '</span>' : '') + (fav ? '<span class="fcdSys">' + fc.ui.ic('star', 'fill') + ET('Favourite') + '</span>' : '');
    const live = joined ? liveMatches().filter(m => m.channel === ch.name).length : 0;
    const stats = (c.clients != null ? `<span><span class="fcdDot"></span>${ET('{n} playing', { n: Number(c.clients).toLocaleString(fc.t.locale()) })}</span>` : '') +
        (live ? `<span>${fc.ui.ic('swords')}${ET('{n} live', { n: live })}</span>` : '');
    const jb = joined ? '' : joinBlock(c), fb = favBlock(c);
    const btns = (joined ? '<span class="fcdBtn go" data-act="open">▶ ' + ET('Open channel') + '</span>'
        : `<span class="fcdBtn go${jb ? ' dis' : ''}" data-act="${jb ? '' : 'join'}" title="${esc(jb)}">▶ ${ET('Join')}</span>`) +
        `<span class="fcdBtn${fav ? ' on' : ''}${fb ? ' dis' : ''}" data-act="${fb ? '' : 'fav'}" title="${esc(fb)}">${fav ? fc.ui.ic('star', 'fill') + ET('Favourited') : fc.ui.ic('star') + ET('Favourite')}</span>` +
        '<span class="fcdBtn" data-act="results">' + ET('Show in results') + '</span>';
    const top = panel.querySelector('.fcdGTop');
    [['.fcdGTags', tags], ['.fcdGStats', stats], ['.fcdGBtns', btns]].forEach(([sel, html]) => {
        const el = top.querySelector(sel);
        if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; }
    });
    const dyn = `<section><h4>${fc.ui.ic('live', 'fcdLiveIc')}${ET('Live now')}</h4>${liveSection(c)}</section>
        <section><h4>${fc.ui.ic('chart')}${ET('You')}</h4>${youSection(c)}</section>
        <section><h4>${fc.ui.ic('trophy')}${ET('Top players')}</h4>${topSection()}</section>
        <section><h4>${fc.ui.ic('clock')}${ET('Recent matches')}</h4>${recentSection()}</section>`;
    if (dyn !== game.dyn) { game.dyn = dyn; panel.querySelector('.fcdGDyn').innerHTML = dyn; }
}

function onGameClick(e) {
    if (e.target.closest('.fcdGClose')) { closeGame(); return; }
    const w = e.target.closest('[data-watch]');
    if (w) { const m = liveMatches().find(x => String(x.quark) === w.dataset.watch); if (m) watch(m); return; }
    const rp = e.target.closest('[data-replay]');
    if (rp) { window.open(rp.dataset.replay, '_blank'); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act && game.ch) {
        runAction(act, chanCache.get(game.ch.name) || game.ch);
        if (act === 'open') closeGame();
        setTimeout(renderGame, 80);
    }
}

/* ---------------------------------------------------------- instant search */

// FC's full catalog, loaded at login: [{textToCompare, gameId, channelName, thumbnail}]
let catIdx = { n: -1, list: [] };
function catalog() {
    const fn = glob()?.channelsList?.forNotifications;
    if (!Array.isArray(fn) || !fn.length) return [];
    if (fn.length !== catIdx.n) {
        catIdx = {
            n: fn.length, list: fn.map(e => {
                const name = e.channelName || '';
                const nn = norm(name);
                return {
                    name, gameid: String(e.gameId || '').toLowerCase(), nn,
                    ini: nn.split(' ').map(w => /^\d/.test(w) ? w : w[0]).join('')
                };
            })
        };
        noteShape('catalogEntry', null, fn[0]);
    }
    return catIdx.list;
}

function norm(s) {
    return String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(iii|ii|iv)\b/g, m => ({ ii: '2', iii: '3', iv: '4' }[m])).trim().replace(/\s+/g, ' ');
}

// shorthand players actually type -> rom name prefixes
const ALIASES = {
    '3s': ['sfiii3'], '3rd strike': ['sfiii3'], 'third strike': ['sfiii3'], 'sf3': ['sfiii'], 'sf3s': ['sfiii3'],
    'kof98': ['kof98'], 'kof02': ['kof2002'], 'kof2k2': ['kof2002'], 'kof97': ['kof97'], 'kof2k': ['kof2000'],
    'sf2': ['sf2'], 'sf2ce': ['sf2ce'], 'ce': ['sf2ce'], 'st': ['ssf2t'], 'ssf2t': ['ssf2t'], 'super turbo': ['ssf2t'],
    'ssf2x': ['ssf2xj', 'ssf2t'], 'vsav': ['vsav'], 'vampire savior': ['vsav'], 'darkstalkers': ['dstlk', 'vsav', 'nwarr'],
    'garou': ['garou'], 'motw': ['garou'], 'mvc2': ['mvsc2'], 'mvc': ['mvsc'], 'cvs2': ['cvs2'], 'cvs': ['cvs'],
    'jojo': ['jojoba', 'jojo'], 'jojos': ['jojoba', 'jojo'], 'sfa3': ['sfa3'], 'alpha 3': ['sfa3'], 'a3': ['sfa3'],
    'sfa2': ['sfa2'], 'a2': ['sfa2'], 'xmvsf': ['xmvsf'], 'msh': ['msh'], 'mshvsf': ['mshvsf'], 'xsota': ['xmcota'],
    'ggxx': ['ggxx'], 'guilty gear': ['ggxx', 'ggx'], 'mk2': ['mk2'], 'umk3': ['umk3'], 'mk3': ['mk3', 'umk3'],
    'samsho': ['samsh'], 'ss2': ['samsho2'], 'ss5': ['samsh5'], 'rb2': ['rbff2'], 'rbff2': ['rbff2'], 'lb2': ['lastbld2'],
    'kof': ['kof'], 'sfiii': ['sfiii']
};

function scoreEntry(en, q, qc, tokens, aliasGids) {
    let s = 0;
    if (aliasGids && aliasGids.some(p => en.gameid.startsWith(p))) s = 95;
    if (en.gameid === qc) s = Math.max(s, 100);
    else if (qc.length >= 3 && en.gameid.startsWith(qc)) s = Math.max(s, 80);
    if (en.nn.startsWith(q)) s = Math.max(s, 60);
    else if (tokens.every(t => en.nn.includes(t))) s = Math.max(s, tokens.every(t => (' ' + en.nn).includes(' ' + t)) ? 50 : 40);
    if (qc.length >= 2 && en.ini.startsWith(qc)) s = Math.max(s, 30);
    if (!s) return 0;
    const c = chanCache.get(en.name);
    s += Math.min(12, Math.log10(((c && c.clients) || 0) + 1) * 5);
    if (/hack/i.test(en.name)) s -= 6;
    if (isJoinedName(en.name)) s += 3;
    return s;
}

function quickResults(query) {
    const q = norm(query);
    if (!q) return [];
    const qc = q.replace(/ /g, '');
    const tokens = q.split(' ');
    const aliasGids = ALIASES[q] || ALIASES[qc] || null;
    const out = [];
    for (const en of catalog()) {
        const s = scoreEntry(en, q, qc, tokens, aliasGids);
        if (s > 0) out.push({ en, s });
    }
    out.sort((a, b) => b.s - a.s || a.en.name.length - b.en.name.length);
    return out.slice(0, 8).map(x => x.en);
}

function highlight(name, query) {
    const tokens = norm(query).split(' ').filter(t => t.length >= 2);
    let html = esc(name);
    for (const t of tokens) {
        const i = name.toLowerCase().indexOf(t);
        if (i < 0) continue;
        const part = name.slice(i, i + t.length);
        html = html.replace(esc(part), '<mark>' + esc(part) + '</mark>');
        break;
    }
    return html;
}

let quick = { open: false, q: '', items: [], sel: -1, input: null, recents: false };

function ensureQuick() {
    let box = document.getElementById('fcdQuick');
    if (!box) {
        box = document.createElement('div');
        box.id = 'fcdQuick';
        box.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });   // keep focus in the input
        box.addEventListener('click', (e) => {
            const row = e.target.closest('[data-i]');
            if (row) pickQuick(row.dataset.i);
        });
        box.addEventListener('mousemove', (e) => {
            const row = e.target.closest('.fcdQRow[data-i]');
            if (row && +row.dataset.i !== quick.sel && row.dataset.i !== 'all') { quick.sel = +row.dataset.i; paintSel(); }
        });
        document.body.appendChild(box);
    }
    return box;
}

function quickRowHtml(en, i, query) {
    const c = chanCache.get(en.name) || {};
    const bits = [];
    if (c.system) bits.push(`<span>${esc(c.system)}</span>`);
    if (c.clients != null) bits.push(`<span><span class="fcdDot"></span>${Number(c.clients).toLocaleString('en-US')}</span>`);
    if (c.ranked) bits.push('<span>' + fc.ui.ic('trophy') + ET('Ranked') + '</span>');
    if (isJoinedName(en.name)) bits.push('<span style="color:#2dc770">' + fc.ui.ic('check') + ET('Joined') + '</span>');
    return `<div class="fcdQRow" data-i="${i}">
        <div class="fcdQThumb" style="background-image:url(&quot;${esc(en.gameid ? artUrl(en.gameid) : '')}&quot;) !important"></div>
        <div class="fcdQText"><div class="fcdQName">${query ? highlight(en.name, query) : esc(en.name)}</div>
        <div class="fcdQMeta">${bits.join('')}<span>${esc(en.gameid)}</span></div></div></div>`;
}

function renderQuick() {
    const box = ensureQuick();
    const input = quick.input;
    if (!quick.open || !input || !visible(input)) { box.classList.remove('open'); return; }
    let html;
    if (quick.recents) {
        html = quick.items.length ? '<div class="fcdQHead">' + ET('Your games') + '</div>' + quick.items.map((en, i) => quickRowHtml(en, i, '')).join('') : '';
    } else {
        html = (quick.items.length ? quick.items.map((en, i) => quickRowHtml(en, i, quick.q)).join('')
            : '<div class="fcdQHead">' + ET('No game names match') + '</div>') +
            `<div class="fcdQRow fcdQAll" data-i="all">${ET('See all results for “{q}”', { q: quick.q })} →<span class="fcdQKey">Enter</span></div>`;
    }
    if (!html) { box.classList.remove('open'); return; }
    box.innerHTML = html;
    placeQuick();
    box.classList.add('open');
    paintSel();
}

function placeQuick() {
    const box = document.getElementById('fcdQuick');
    if (!box || !quick.input) return;
    const r = quick.input.getBoundingClientRect();
    box.style.setProperty('top', Math.round(r.bottom + 6) + 'px', 'important');
    box.style.setProperty('left', Math.round(r.left) + 'px', 'important');
    box.style.setProperty('width', Math.round(Math.max(r.width, 480)) + 'px', 'important');
}

function paintSel() {
    document.querySelectorAll('#fcdQuick .fcdQRow[data-i]').forEach(r => r.classList.toggle('sel', r.dataset.i !== 'all' && +r.dataset.i === quick.sel));
}

function closeQuick() {
    quick.open = false;
    document.getElementById('fcdQuick')?.classList.remove('open');
}

function recentPicks() {
    return yourGames().slice(0, 6).map(it => ({ name: it.full, gameid: String(it.rom || channelByName(it.full).gameid || '').toLowerCase() }));
}

function runQuick(input) {
    quick.input = input;
    quick.q = input.value;
    quick.recents = !input.value.trim();
    quick.items = quick.recents ? recentPicks() : quickResults(input.value);
    quick.sel = quick.recents ? -1 : (quick.items.length ? 0 : -1);
    quick.open = true;
    renderQuick();
}

function pickQuick(i) {
    const q = quick.q.trim();
    const input = quick.input;
    if (i === 'all' || i == null || i < 0 || !quick.items[+i]) {
        if (!q) return;
        closeQuick();
        if (input) { input.value = ''; input.blur(); }
        select('search-channel', { textFilter: q });
        return;
    }
    const en = quick.items[+i];
    closeQuick();
    if (input) { input.value = ''; quick.q = ''; input.blur(); }
    openGame(channelByName(en.name, en.gameid));
}

const isHomeInput = (t) => !!(t && t.matches && t.matches('.welcomeWrapper .text-filter'));
const quickOn = () => config.enabled && catalog().length > 0;

// Capture phase, before Vue's v-model: FC would otherwise jump to the results page
// half a second into typing. Enter / "See all" goes there on purpose instead.
function onQuickInput(e) {
    if (!isHomeInput(e.target) || !quickOn()) return;
    e.stopImmediatePropagation();
    runQuick(e.target);
}

function onQuickKey(e) {
    if (!isHomeInput(e.target) || !quickOn()) return;
    const n = quick.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!quick.open) runQuick(e.target);
        if (!n) return;
        quick.sel = e.key === 'ArrowDown' ? (quick.sel + 1) % n : (quick.sel <= 0 ? n - 1 : quick.sel - 1);
        paintSel();
        document.querySelector('#fcdQuick .fcdQRow.sel')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        pickQuick(quick.sel >= 0 ? quick.sel : 'all');
    }
}

function onQuickKeyUp(e) {
    if (e.key === 'Escape' && quick.open) { closeQuick(); return; }
    if (e.key === 'Escape' && gameOpen()) closeGame();
}

function onQuickClick(e) {
    if (isHomeInput(e.target) && quickOn() && !quick.open) runQuick(e.target);
}

function onQuickFocusOut(e) {
    if (!isHomeInput(e.target)) return;
    setTimeout(() => { if (document.activeElement !== quick.input) closeQuick(); }, 120);
}

/* ------------------------------------------------------------ results page */

// Our grid over FC's own data: the search component fetches pages of 50 into
// sc.channels; we collect them (endless scroll) and sort / filter on top.
let R = { sig: '', items: [], names: new Set(), pages: new Set(), total: null, stale: null, nextAt: 0,
    sort: 'players', has: false, key: '', state: '' };

const scReady = (sc) => !!(sc && typeof sc.requestChannels === 'function' && Array.isArray(sc.channels) && sc.$refs && sc.$refs.paginatedList);
const filterSig = (sc) => [sc.textFilter || '', +sc.genreFilter || 0, +sc.systemFilter || 0, +sc.yearFilter || 0,
    +sc.rankedFilter || 0, sc.favorites ? 1 : 0].join('|');

function syncResults(sc) {
    const list = sc.$refs.paginatedList;
    const sig = filterSig(sc);
    if (sig !== R.sig) {
        R.sig = sig; R.items = []; R.names = new Set(); R.pages = new Set(); R.total = null;
        R.stale = list.fetchingData ? null : sc.channels;        // what's on screen now belongs to the old search
        R.key = '';
    }
    if (list.fetchingData || sc.channels === R.stale) return;
    if (R.pages.has(sc.page)) return;
    R.pages.add(sc.page);
    R.stale = sc.channels;
    sc.channels.forEach(c => {
        if (c && c.name && !R.names.has(c.name)) { R.names.add(c.name); R.items.push(remember(plain(c))); }
    });
    if (sc.channels[0]) noteShape('channel', null, Object.assign({}, sc.channels[0]));
    R.total = list.totalChannels;
}

function moreToLoad() { return R.total == null || R.items.length < R.total; }

function requestMore(sc) {
    if (sc.$refs.paginatedList.fetchingData || !moreToLoad() || Date.now() < R.nextAt || !R.pages.size) return;
    R.nextAt = Date.now() + 450;
    R.stale = sc.channels;
    try { sc.requestChannels(Math.max(...R.pages) + 1); } catch (e) { LOG('requestChannels failed', e.message); }
}

function shownItems() {
    let a = R.items;
    if (R.has) a = a.filter(c => (c.clients || 0) > 0);
    if (R.sort === 'az') a = a.slice().sort((x, y) => shortName(x.name).localeCompare(shortName(y.name)));
    return a;
}

function cardHtml(c, i) {
    const joined = isJoinedName(c.name), fav = isFavName(c.name);
    const art = c.gameid ? artUrl(c.gameid) : '';
    const jb = joined ? '' : joinBlock(c), fb = favBlock(c);
    return `<div class="fcdCard${i != null ? ' pop' : ''}" data-name="${esc(c.name)}" data-art="${esc(art)}"${i != null ? ` style="animation-delay:${Math.min(i, 24) * 22}ms"` : ''}>
        <div class="fcdCardArt" style="background-image:url(&quot;${esc(art)}&quot;) !important"></div>
        <div class="fcdCardPill"><span class="fcdDot"></span>${Number(c.clients || 0).toLocaleString('en-US')}${c.ranked ? '<span class="fcdRk">R</span>' : ''}${fav ? '<span class="fcdFv">' + fc.ui.ic('star', 'fill') + '</span>' : ''}</div>
        <div class="fcdCardActs"><span data-act="${fb ? '' : 'fav'}" class="${fb ? 'dis' : ''}" title="${esc(fb)}">${fav ? fc.ui.ic('star', 'fill') + 'Unfav' : fc.ui.ic('star') + 'Fav'}</span>${joined
            ? '<span class="go" data-act="open">' + ET('Open') + '</span>'
            : `<span class="go${jb ? ' dis' : ''}" data-act="${jb ? '' : 'join'}" title="${esc(jb)}">${ET('Join')}</span>`}</div>
        <div class="fcdCardInfo"><div class="fcdCardName">${esc(c.name)}</div>${c.system ? `<span class="fcdSys">${esc(c.system)}</span>` : ''}${joined ? '<span class="fcdJoined">' + fc.ui.ic('check') + ET('Joined') + '</span>' : ''}</div>
    </div>`;
}

function resultsTitle(sc) {
    const L = filterLists();
    const parts = [];
    const g = +sc.genreFilter || 0, s = +sc.systemFilter || 0, y = +sc.yearFilter || 0;
    if (sc.favorites) parts.push(T('Favourites'));
    if (g > 0) parts.push(T(L.allGenres[g]));
    if (s > 0) parts.push(L.allSystems[s]);
    const years = glob()?.filtersOptions?.years;
    if (y > 0 && years) parts.push(String(years[y]));
    if (sc.textFilter) parts.push(T('Results for “{q}”', { q: sc.textFilter }));
    return parts.length ? parts.join(' · ') : T('All games');
}

function ensureResultsBox(content) {
    let box = document.getElementById('fcdResults');
    if (box && box.parentNode === content) return box;
    box?.remove();
    box = document.createElement('div');
    box.id = 'fcdResults';
    box.innerHTML = `<div class="fcdResBar"><div class="fcdResTitle"><span class="t"></span><span class="c"></span></div>
        <div class="fcdSeg"><span data-sort="players">${ET('Most players')}</span><span data-sort="az">A–Z</span></div>
        <span class="fcdChip" data-chip="has">● ${ET('Has players')}</span><span class="fcdChip" data-chip="ranked">${fc.ui.ic('trophy')}${ET('Ranked only')}</span></div>
        <div class="fcdResStatus"></div><div class="fcdResGrid"></div><div id="fcdResSentinel"></div>`;
    box.addEventListener('click', onResultsClick);
    content.appendChild(box);            // after FC's header and results; FC's results are hidden by CSS
    R.key = '';
    return box;
}

function renderResults(wrap, sc) {
    const content = wrap.querySelector(':scope > .contentWrapper');
    if (!content) return;
    syncResults(sc);
    const box = ensureResultsBox(content);
    const list = sc.$refs.paginatedList;
    const fetching = !!list.fetchingData;

    // toolbar
    const setText = (sel, t) => { const el = box.querySelector(sel); if (el.textContent !== t) el.textContent = t; };
    setText('.fcdResTitle .t', resultsTitle(sc));
    setText('.fcdResTitle .c', R.total != null ? R.total.toLocaleString('en-US') + (R.total === 1 ? ' game' : ' games') : '');
    box.querySelectorAll('.fcdSeg > span').forEach(s => s.classList.toggle('on', s.dataset.sort === R.sort));
    box.querySelector('[data-chip="has"]').classList.toggle('on', R.has);
    box.querySelector('[data-chip="ranked"]').classList.toggle('on', +sc.rankedFilter === 1);

    // sorting A–Z or "has players" needs every page; players-order can stop at the first empty channel
    const last = R.items[R.items.length - 1];
    const needAll = (R.sort === 'az' || R.has) && moreToLoad() && !(R.sort === 'players' && R.has && last && !(last.clients > 0));
    const sentinel = box.querySelector('#fcdResSentinel');
    const nearEnd = sentinel.getBoundingClientRect().top < window.innerHeight + 700;
    if ((needAll || nearEnd) && moreToLoad() && !(R.has && R.sort === 'players' && last && !(last.clients > 0))) requestMore(sc);

    const status = needAll && R.total ? T('Loading {n} / {total}…', { n: R.items.length.toLocaleString(fc.t.locale()), total: R.total.toLocaleString(fc.t.locale()) })
        : (fetching && R.items.length ? T('Loading more…') : '');
    setText('.fcdResStatus', status);

    const grid = box.querySelector('.fcdResGrid');
    const shown = shownItems();
    if (!R.items.length && (fetching || R.total == null)) {
        if (R.key !== 'skel') { R.key = 'skel'; grid.innerHTML = Array.from({ length: 12 }, () => '<div class="fcdCard fcdSkelCard"></div>').join(''); }
        return;
    }
    if (!shown.length) {
        if (R.key !== 'empty') {
            R.key = 'empty';
            grid.innerHTML = '<div class="fcdResEmpty" style="grid-column:1/-1"><div class="emoji">(╯°□°)╯︵ ┻━┻</div>' + ET('No game channels found.') + '</div>';
        }
        return;
    }
    const state = (localUser().channels || []).join('\n') + '#' + (localUser().favoritesChannels || []).join('\n');
    const view = R.sig + '|' + R.sort + '|' + R.has;
    const key = view + '#' + state + '#' + shown.length + '#' + shown[shown.length - 1].name;
    if (key === R.key) return;
    const rendered = grid.querySelectorAll('.fcdCard:not(.fcdSkelCard)').length;
    if (R.lastView === view && R.lastState === state && R.sort === 'players' && rendered && rendered < shown.length) {
        // the next page arrived: add it, the cards already there stay put
        grid.insertAdjacentHTML('beforeend', shown.slice(rendered).map((c, i) => cardHtml(c, i)).join(''));
    } else {
        // new search / sort / filter pops in; a joined or favourited change just redraws
        const animate = R.lastView !== view;
        grid.innerHTML = shown.map((c, i) => cardHtml(c, animate ? i : null)).join('');
    }
    R.lastView = view;
    R.lastState = state;
    R.key = key;
}

function onResultsClick(e) {
    const sc = searchComp();
    const seg = e.target.closest('[data-sort]');
    if (seg) { R.sort = seg.dataset.sort; tick(); return; }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
        if (chip.dataset.chip === 'has') R.has = !R.has;
        else if (sc) {
            sc.rankedFilter = +sc.rankedFilter === 1 ? 0 : 1;       // FC's own filter; its select follows
            try { sc.requestChannels(0); } catch (er) { LOG('requestChannels failed', er.message); }
        }
        tick();
        return;
    }
    const card = e.target.closest('.fcdCard');
    if (!card || card.classList.contains('fcdSkelCard')) return;
    const ch = chanCache.get(card.dataset.name) || { name: card.dataset.name };
    const act = e.target.closest('[data-act]');
    if (act) { if (act.dataset.act) runAction(act.dataset.act, ch); R.key = ''; setTimeout(tick, 80); return; }
    openGame(ch);
}

/* -------------------------------------------------------------------- tick */

function railRight() {
    const r = document.querySelector('.mainToolbarWrapper')?.getBoundingClientRect();
    return r && r.width ? Math.round(r.right) : 72;
}

function setHtmlClass(name, on) {
    const h = document.documentElement;
    if (h.classList.contains(name) !== on) h.classList.toggle(name, on);
}

function tick() {
    if (!config.enabled) {
        ['fcd-on', 'fcd-browse', 'fcd-anim', 'fcd-tilt', 'fcd-glow', 'fcd-own-results'].forEach(c => setHtmlClass(c, false));
        closeQuick();
        closeGame();
        return;
    }
    ensureStyle();
    setHtmlClass('fcd-on', true);
    setHtmlClass('fcd-anim', !!config.animations);
    setHtmlClass('fcd-tilt', !!(config.tilt && config.animations));
    setHtmlClass('fcd-glow', !!config.tilt);
    const view = currentView();
    setHtmlClass('fcd-browse', !!view);
    const left = railRight() + 'px';
    if (document.documentElement.style.getPropertyValue('--fcd-left') !== left) document.documentElement.style.setProperty('--fcd-left', left);
    updateNav(view);
    joinedChannels().forEach(c => { if (c.name) remember(Object.assign(plain(c), { name: c.name })); });
    if (gameOpen()) renderGame();
    if (view !== 'home') {
        closeQuick();
        // our typed text was never handed to FC; don't leave it in the box
        const hi = document.querySelector('.welcomeWrapper .text-filter');
        if (hi && hi.value && quick.q === hi.value) { hi.value = ''; quick.q = ''; }
    } else if (quick.open) placeQuick();
    if (!view) { setHtmlClass('fcd-own-results', false); return; }
    if (config.tilt) updateAmbient(view);
    if (view === 'home') {
        setHtmlClass('fcd-own-results', false);
        const content = document.querySelector('.welcomeWrapper > .contentWrapper');
        if (content) {
            decorateSpotlight(content);
            renderYours(content);
            renderFriends(content);
            renderLive(content);
            renderRivals(content);
            renderEvents(content);
            decorateRows(content);
            decorateCards(content);
        }
    } else {
        const wrap = document.querySelector('.searchWrapper');
        const sc = searchComp();
        const own = scReady(sc);
        setHtmlClass('fcd-own-results', own);
        if (own) renderResults(wrap, sc);
        else decorateSearch(wrap);
        decorateCards(wrap);
    }
}

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('discover', DEFAULTS);
    config = store.data;
    window.__fcDiscoverLoaded = true;
    ensureStyle();
    const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); fc.own(() => t.removeEventListener(ev, fn, o)); };
    listen(document, 'click', onArrowClick, true);
    listen(document, 'click', onCardClick);
    listen(document, 'input', onQuickInput, true);
    listen(document, 'keydown', onQuickKey, true);
    listen(document, 'click', onQuickClick, true);
    listen(document, 'focusout', onQuickFocusOut, true);
    listen(window, 'keyup', onQuickKeyUp, true);          // Fightcade swallows Escape on keydown
    listen(document, 'mousemove', onMouseMove, { passive: true });
    listen(document, 'scroll', () => { if (quick.open) placeQuick(); }, true);
    fc.own(() => { window.__fcDiscoverLoaded = false; });
    fc.watch(tick);
    fc.tick(tick, 300);
    fc.on('friends:changed', () => { yoursKeys = ''; tick(); });
    const redo = () => { yoursKeys = ''; liveKeys = ''; document.querySelectorAll('.fcdXRow').forEach(r => { r.__keys = ''; r.__at = 0; }); tick(); };
    const opt = (key, label, hint, show) => ({ key, type: 'switch', label, hint, show, onChange: redo });
    fc.settings.block({
        id: 'discover', section: 'search', title: 'Discover', hint: '— the search tab', store, order: 10,
        fields: [
            opt('enabled', 'Discover layout', 'Sidebar, spotlight, instant search, game pages, card rows'),
            opt('yourGames', 'Your games row', 'Played, joined and favourite games up top', (d) => d.enabled),
            opt('liveRow', 'Live now row', 'Matches in your channels, with Watch', (d) => d.enabled),
            opt('friendsRow', 'Friends playing now', 'Friends in your channels: who’s in a match, with Watch', (d) => d.enabled),
            opt('rivalsRow', 'Rivals online', 'People you’ve played lately who are free now, with Challenge', (d) => d.enabled),
            opt('eventsRow', 'Events this week', 'Upcoming tournaments with countdowns and reminder bells', (d) => d.enabled),
            opt('tilt', '3D tilt & glow', 'Cards tilt toward the mouse, the page glows in the game’s colours', (d) => d.enabled),
            opt('animations', 'Animations', 'Off = no motion', (d) => d.enabled)
        ]
    });
    tick();
    LOG('ready');
    return api;
}

const api = {
    channelInfo: (name) => (name && chanCache.get(name)) || null,
    _tick: () => tick(),
    _whenLabel: (t) => whenLabel(t),
    _yourGames: () => yourGames(),
    _quickResults: (q) => quickResults(q).map(e => e.name),
    _openGame: (name) => openGame(channelByName(name)),
    _liveMatches: () => liveMatches(),
    _state: () => ({ spot, R, quick, game, amb }),
    get _config() { return config; }
};

module.exports = { id: 'discover', name: 'Search tab (Discover)', start, friendsNow, rivalsOnline, eventsWeek, nextBand };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });

