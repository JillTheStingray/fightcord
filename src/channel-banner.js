/**
 * Fightcord channel banner
 *
 * A Discord "server banner" at the top of every game channel, merged with Fightcade's own
 * channel header: the game's art, how many players are online and how many matches are
 * live, your rank and record in this game, friends who are here, and quick buttons (your
 * stats for this game, rankings, replays, events, profile). The chevron shrinks it to a
 * slim bar -- remembered.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // channel-banner-config.json

const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const N_ = (s) => s;
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
const mod = (id) => fc.modules.get(id);

/* --------------------------------------------------------------------- data */

function channelOf(wrapper) {
    const t = wrapper.querySelector('.channelToolbar .channelInfo .name.title');
    const name = t ? (t.getAttribute('title') || t.textContent.replace(/^#/, '')).trim() : '';
    const romEl = wrapper.querySelector('.channelToolbar .channelInfo .name[title="Rom name"]');
    const links = {};
    wrapper.querySelectorAll('.channelToolbar a.link').forEach(a => { links[a.textContent.trim().toLowerCase()] = a.href; });
    return { name, rom: romEl ? romEl.textContent.trim() : '', links, ranked: !!wrapper.querySelector('.channelToolbar .channelInfo .rankedWrapper') };
}

function statsFor(ch) {
    const all = fc.app.users();
    let online = 0;
    const quarks = new Set();
    Object.keys(all).forEach(n => {
        const u = all[n];
        if ((u.channels || []).includes(ch.name)) online++;
        if (u.playing && u.playing.quarkId && u.playing.channelId === ch.name) quarks.add(u.playing.quarkId);
    });
    const me = all[fc.app.me()] || {};
    const rank = fc.data.rankLetter((me.channelRank && me.channelRank[ch.name]) || 0);
    const sets = fc.history.all().filter(s => s.channel === ch.name || (s.rom && s.rom === ch.rom));
    const r = fc.data.recordOf(sets);
    const fr = mod('friends');
    const friends = fr && fr.list ? fr.list().filter(n => { const u = fc.app.user(n)[1]; return u && (u.channels || []).includes(ch.name); }) : [];
    return { online, live: quarks.size, rank, w: r.w, l: r.l, sets: sets.length, friends };
}

/* ------------------------------------------------------------------- banner */

function build(wrapper, ch) {
    const b = document.createElement('div');
    b.className = 'cbnBanner';
    const btn = (act, label, icon, title) => `<span class="cbnBtn" data-cb="${act}" title="${E(T(title))}">${fc.ui.icon(icon)}${E(T(label))}</span>`;
    b.innerHTML = `<div class="cbnBg"></div><div class="cbnShade"></div>
        <div class="cbnArt"></div>
        <div class="cbnText"><div class="cbnName" title="${E(ch.name)}">${E(shortName(ch.name))}${ch.ranked ? `<span class="cbnRanked" title="${E(T('Ranked channel'))}">${E(T('RANKED'))}</span>` : ''}</div><div class="cbnLine"></div></div>
        <div class="cbnRight">
            <div class="cbnFriends"></div>
            <div class="cbnBtns">
                ${btn('stats', N_('Stats'), 'chart', N_('Your stats in this game'))}
                ${ch.links.rankings ? btn('rankings', N_('Rankings'), 'trophy', N_('Rankings (fightcade.com)')) : ''}
                ${ch.links.replays ? btn('replays', N_('Replays'), 'play', N_('Replays (fightcade.com)')) : ''}
                ${ch.links.events ? btn('events', N_('Events'), 'clock', N_('Events (fightcade.com)')) : ''}
                ${ch.links.profile ? btn('profile', N_('Profile'), 'user', N_('Your profile (fightcade.com)')) : ''}
            </div>
        </div>
        <span class="cbnFold" data-cb="fold" title="${E(T('Shrink / expand the banner'))}">${fc.ui.icon('chevronDown')}</span>`;
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
        const f = e.target.closest('[data-fr]');
        if (f) {
            e.stopPropagation();
            const sc = mod('scout');
            if (sc && sc.openCard) sc.openCard(f.dataset.fr, f.getBoundingClientRect(), 'right');
            return;
        }
        const a = e.target.closest('[data-cb]');
        if (!a) return;
        e.stopPropagation();
        const act = a.dataset.cb;
        if (act === 'fold') { cfg.collapsed = !cfg.collapsed; store.save(); applyFold(); fc.settings.refresh('channel-banner'); return; }
        if (act === 'stats') { const st = mod('stats'); if (st && st.open) st.open({ game: shortName(ch.name) }); return; }
        if (ch.links[act]) { try { window.open(ch.links[act], '_blank'); } catch (err) { /* ignore */ } }
    });
    if (ch.rom) {
        const url = fc.data.artUrl(ch.rom, 'https://web.fightcade.com/');
        const img = new Image();
        img.onload = () => {
            b.querySelector('.cbnBg').style.setProperty('background-image', 'url("' + url + '")', 'important');
            b.querySelector('.cbnArt').style.setProperty('background-image', 'url("' + url + '")', 'important');
            b.classList.add('art');
        };
        img.src = url;
    }
    b.__ch = ch.name;
    return b;
}

function update(b, ch) {
    const s = statsFor(ch);
    const bits = [`<span class="on"><i></i>${E(T('{n} online', { n: s.online }))}</span>`];
    if (s.live) bits.push(`<span>${fc.ui.ic('swords')}${E(T.plural(s.live, '{n} live match', '{n} live matches'))}</span>`);
    if (s.rank) bits.push(`<span>${E(T('your rank'))} ${fc.ui.tag(s.rank, '', 16)}</span>`);
    if (s.w + s.l) bits.push(`<span>${E(T('you'))} <b>${s.w}–${s.l}</b> (${Math.round(s.w / (s.w + s.l) * 100)}%)</span>`);
    const line = bits.join('<span class="dot">·</span>');
    const ln = b.querySelector('.cbnLine');
    if (ln.innerHTML !== line) ln.innerHTML = line;
    const fr = s.friends.slice(0, 5).map(n => `<img data-fr="${E(n)}" src="${E(fc.data.avatarUrl(n, (fc.app.user(n)[1] || {}).gravatar, 64))}" title="${E(T('{name} (friend) is here', { name: n }))}" alt="" onerror="this.style.visibility='hidden'">`).join('') +
        (s.friends.length > 5 ? `<span class="more">+${s.friends.length - 5}</span>` : '');
    const fb = b.querySelector('.cbnFriends');
    if (fb.__html !== fr) {
        fb.__html = fr;
        fb.innerHTML = fr ? '<span class="lbl">' + E(T('Friends here')) + '</span>' + fr : '';
    }
}

function applyFold() {
    document.querySelectorAll('.cbnBanner').forEach(b => b.classList.toggle('slim', !!cfg.collapsed));
    document.querySelectorAll('.channelToolbar.cbn-merged').forEach(t => t.classList.toggle('cbn-slim', !!cfg.collapsed));
}

function tick() {
    const on = cfg.enabled;
    document.documentElement.classList.toggle('cbn-on', on);
    document.querySelectorAll('.channelWrapper').forEach(w => {
        if (w.closest('.searchResultsGrid')) return;
        const tb = w.querySelector(':scope > .channelToolbar');
        let b = w.querySelector(':scope > .cbnBanner');
        if (!on || !tb) { if (b) b.remove(); if (tb) tb.classList.remove('cbn-merged', 'cbn-slim'); return; }
        const ch = channelOf(w);
        if (!ch.name) return;
        if (b && b.__ch !== ch.name) { b.remove(); b = null; }
        if (!b) {
            b = build(w, ch);
            b.classList.toggle('slim', !!cfg.collapsed);
            tb.insertAdjacentElement('afterend', b);
        }
        if (!tb.classList.contains('cbn-merged')) tb.classList.add('cbn-merged');
        tb.classList.toggle('cbn-slim', !!cfg.collapsed);
        if (w.style.display !== 'none') {
            update(b, ch);
            const act = tb.querySelector('.channelActions');
            const aw = (act ? act.offsetWidth : 0) + 'px';
            if (b.style.getPropertyValue('--cbn-act') !== aw) b.style.setProperty('--cbn-act', aw);
        }
    });
}

function teardown() {
    document.querySelectorAll('.cbnBanner').forEach(b => b.remove());
    document.querySelectorAll('.channelToolbar.cbn-merged').forEach(t => t.classList.remove('cbn-merged', 'cbn-slim'));
    document.documentElement.classList.remove('cbn-on');
}

const CSS = `
.channelWrapper > .channelToolbar.cbn-merged { height: 0 !important; min-height: 0 !important; padding: 0 !important; overflow: visible !important;
    background: transparent !important; box-shadow: none !important; border: 0 !important; position: relative !important; z-index: 4 !important; }
.channelWrapper > .channelToolbar.cbn-merged > .channelInfo { display: none !important; }
.channelWrapper > .channelToolbar.cbn-merged > .channelActions { position: absolute !important; top: 12px !important; right: 16px !important;
    height: auto !important; display: flex !important; align-items: center !important; }
.channelWrapper > .channelToolbar.cbn-merged.cbn-slim > .channelActions { top: 8px !important; }
.channelWrapper > .channelToolbar.cbn-merged > .channelActions .button-alt {
    background: rgba(0,0,0,.35) !important; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14) !important; }
.channelWrapper > .channelToolbar.cbn-merged > .channelActions .button-alt:hover { background: rgba(0,0,0,.55) !important; }
.cbnBanner { position: relative; flex: none; overflow: hidden; height: 96px; display: flex; align-items: center; padding: 0 16px;
    background: var(--fc-s2); color: var(--fc-text); font: 14px/1.3 var(--fc-font);
    box-shadow: 0 1px 0 rgba(0,0,0,.25); transition: height .25s ease; z-index: 1; }
.cbnBg { position: absolute; top: -30px; left: -30px; right: -30px; bottom: -30px; background-size: cover; background-position: center;
    filter: blur(22px) saturate(1.4) brightness(.55); opacity: 0; transition: opacity .6s ease; }
.cbnBanner.art .cbnBg { opacity: 1; }
.cbnShade { position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: linear-gradient(90deg, rgba(10,10,14,.35) 0%, rgba(10,10,14,.55) 45%, rgba(10,10,14,.75) 100%),
                radial-gradient(ellipse at 12% 120%, var(--fc-accent-soft), transparent 60%); }
.cbnArt { position: relative; flex: none; width: 88px; height: 66px; border-radius: 8px; background: var(--fc-s1) center / cover no-repeat;
    image-rendering: pixelated; box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 6px 16px rgba(0,0,0,.45); transition: width .25s ease, height .25s ease, opacity .2s ease; }
.cbnText { position: relative; flex: 1; min-width: 0; margin-left: 14px; }
.cbnName { font-size: 20px; font-weight: 800; color: #fff; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-shadow: 0 2px 10px rgba(0,0,0,.5); }
.cbnLine { margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; font-size: 13px; color: rgba(255,255,255,.82); }
.cbnLine .on { display: inline-flex; align-items: center; }
.cbnLine .on i { width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: #23a55a; box-shadow: 0 0 8px #23a55a; }
.cbnLine .dot { margin: 0 8px; opacity: .45; }
.cbnLine b { color: #fff; }
.cbnRanked { display: inline-block; margin-left: 10px; padding: 1px 7px; border-radius: 4px; vertical-align: 3px; font-size: 10px; font-weight: 800;
    letter-spacing: .06em; color: #f0b232; background: rgba(240,178,50,.16); text-shadow: none; }
.cbnRight { position: relative; flex: none; align-self: stretch; display: flex; align-items: flex-end; justify-content: flex-end;
    min-width: var(--cbn-act, 0px); margin-left: 14px; padding: 0 34px 12px 0; box-sizing: content-box; }
.cbnFriends { position: relative; flex: none; display: flex; align-items: center; margin-right: 6px; height: 30px; }
.cbnFriends .lbl { margin-right: 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: rgba(255,255,255,.6); }
.cbnFriends img { width: 28px; height: 28px; margin-left: -6px; border-radius: 50%; cursor: pointer; background: var(--fc-s1);
    box-shadow: 0 0 0 2px #f0b232; transition: transform .12s ease; }
.cbnFriends img:first-of-type { margin-left: 0; }
.cbnFriends img:hover { transform: translateY(-2px); z-index: 1; }
.cbnFriends .more { margin-left: 6px; font-size: 12px; color: rgba(255,255,255,.7); }
.cbnBtns { position: relative; flex: none; display: flex; }
.cbnBtn { height: 30px; margin-left: 8px; padding: 0 12px; border-radius: 6px; display: inline-flex; align-items: center; cursor: pointer;
    font-size: 13px; font-weight: 600; color: #fff; background: rgba(255,255,255,.12); box-shadow: inset 0 0 0 1px rgba(255,255,255,.1);
    transition: background-color .12s ease; white-space: nowrap; }
.cbnBtn:hover { background: rgba(255,255,255,.22); }
.cbnFold { position: absolute; right: 12px; bottom: 14px; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; cursor: pointer; color: rgba(255,255,255,.7); font-size: 14px; transition: transform .25s ease, background-color .12s ease; }
.cbnFold:hover { background: rgba(255,255,255,.12); color: #fff; }
.cbnBanner.slim { height: 48px; padding-right: calc(var(--cbn-act, 0px) + 56px); }
.cbnBanner.slim .cbnRight { display: none; }
.cbnBanner.slim .cbnFold { bottom: auto; top: 11px; right: calc(var(--cbn-act, 0px) + 24px); }
.cbnBanner.slim .cbnArt { width: 0; height: 0; opacity: 0; }
.cbnBanner.slim .cbnText { margin-left: 0; display: flex; align-items: center; }
.cbnBanner.slim .cbnName { font-size: 14px; flex: 0 1 auto; margin-right: 12px; }
.cbnBanner.slim .cbnLine { margin-top: 0; flex-wrap: nowrap; overflow: hidden; }
.cbnBanner.slim .cbnFold { transform: rotate(180deg); }
@media (max-width: 1300px) { .cbnFriends .lbl { display: none; } .cbnBtn { padding: 0 9px; } }
@media (max-width: 1100px) { .cbnBtn[data-cb="events"], .cbnBtn[data-cb="profile"] { display: none; } }
.cbnBtn > .fc-ic { width: 15px; height: 15px; margin-right: 6px; }
.cbnFold > .fc-ic { width: 16px; height: 16px; }
.cbnBanner .cbnFold { transform: rotate(180deg); }
.cbnBanner.slim .cbnFold { transform: none; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('channel-banner', { enabled: true, collapsed: false });
    cfg = store.data;
    window.__fcBannerLoaded = true;
    fc.ui.style('cbnStyle', CSS);
    fc.own(() => { fc.ui.style('cbnStyle', null); teardown(); window.__fcBannerLoaded = false; });
    fc.watch(tick, { selector: '.channelWrapper' });
    fc.tick(tick, 2000);
    fc.on('friends:changed', tick);
    fc.on('set:recorded', tick);
    fc.settings.block({
        id: 'channel-banner', section: 'appearance', title: 'Channel banner', hint: '— game art, who’s online and your record at the top of each channel',
        store, order: 20,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Show the banner', onChange: tick },
            { key: 'collapsed', type: 'switch', label: 'Slim (one line)', show: (d) => d.enabled, onChange: applyFold }
        ]
    });
    tick();
    return api;
}

const api = {
    _tick: () => tick(),
    _statsFor: (ch) => statsFor(ch),
    get _config() { return cfg; }
};

module.exports = { id: 'channel-banner', name: 'Channel banner', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
