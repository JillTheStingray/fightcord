/**
 * Fightcord profile popout
 *
 * Click your own avatar (bottom-left) and instead of Fightcade's small Online / Away menu
 * you get a Discord-style profile card: tonight's session, your all-time record, main game,
 * goals, friends online, the Online / Away switch and quick links. The status buttons and Log out
 * click Fightcade's own buttons, so nothing about how they work changes.
 *
 * Quick settings (2.15): the Look, voice chat, streamer mode, music and Do not disturb, without
 * opening Settings. The same block opens from the channel header's ⋯ menu.
 * Your profile (2.18): a status line, About me, a banner game and your badges, which Fightcord
 * players see on your hover and scout cards (presence.js shares it). Edit it from here.
 */
'use strict';

let fc = null;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const N_ = (s) => s;
const shortName = (full) => String(full || '').replace(/\s*\([^)]*\)\s*$/, '');
const mod = (id) => fc.modules.get(id);
const store = (id) => fc.config(id, {});

/* --------------------------------------------------------------------- data */

function data() {
    const me = fc.app.me();
    const u = fc.app.user(me)[1] || fc.app.localUser() || {};
    const ms = mod('match-screens'), stats = mod('stats'), fr = mod('friends');
    const all = fc.history.all();
    const cleared = ms && ms._config ? ms._config.sessionClearedAt : 0;
    const tonight = fc.history.session(Date.now(), cleared);
    const tally = stats && stats._tally ? stats._tally(all) : null;
    const st = stats && stats._streaks ? stats._streaks(all) : null;
    const games = new Map();
    all.forEach(s => { const k = s.rom || s.game; if (!k) return; const g = games.get(k) || { n: 0, rom: s.rom, name: shortName(s.channel || s.game) }; g.n++; games.set(k, g); });
    const main = [...games.values()].sort((a, b) => b.n - a.n)[0] || null;
    const friends = fr && fr.list ? fr.list().filter(n => !!fc.app.user(n)[1]) : [];
    const status = u.playing && u.playing.quarkId ? 'live' : u.away ? 'away' : 'on';
    return { me, status, tonight: tonight.length, tRec: fc.data.recordOf(tonight), tStreak: fc.data.streakOf(tonight), tally, st, main, friends };
}

/* ----------------------------------------------------------- quick settings */

// what the switches do, and whether each is on (null = not available here)
const QUICK = [
    { id: 'voice', icon: 'mic', label: N_('Voice chat'), on: () => { const v = mod('voice'); return v && v.enabled ? v.enabled() : null; },
        set: (on) => { const s = store('voice'); s.data.enabled = on; s.save(); fc.emit('voice:changed', { on }); fc.settings.refresh('voice'); } },
    { id: 'streamer', icon: 'eye', label: N_('Streamer mode'), on: () => { const s = mod('streamer'); return s && s.active ? !!s.active() : null; },
        set: (on) => { const s = mod('streamer'); if (s && s.set) s.set(on); } },
    { id: 'music', icon: 'music', label: N_('Music'), on: () => { const m = mod('music'); return m && m._config && m._config.track ? !!m._config.enabled : null; },
        set: (on) => { const m = mod('music'); if (!m || !m._config) return; m._config.enabled = on; store('music').save(); if (m._tick) m._tick(); fc.settings.refresh('music'); } },
    { id: 'dnd', icon: 'ban', label: N_('Do not disturb'), on: () => fc.ui.dnd(), set: (on) => fc.ui.dnd(on) }
];

function currentLook() {
    const th = mod('discord-theme');
    if (!th || !th.looks) return '';
    const looks = th.looks(), d = store('discord-theme').data;
    return Object.keys(looks).find(k => looks[k].preset === d.preset && String(looks[k].accent).toLowerCase() === String(d.accent || '').toLowerCase()) || '';
}

function quickHtml() {
    const th = mod('discord-theme');
    const looks = th && th.looks ? th.looks() : {};
    const cur = currentLook();
    const sw = Object.keys(looks).map(k => {
        const c = looks[k].sw || ['#111', '#222', '#5865f2'];
        return `<span class="qsLook${k === cur ? ' on' : ''}" data-qs-look="${E(k)}" title="${E(T(looks[k].name))}" style="background:linear-gradient(135deg,${c[0]} 0 45%,${c[1]} 45% 70%,${c[2]} 70%)"></span>`;
    }).join('');
    const toggles = QUICK.map(q => {
        const on = q.on();
        if (on == null) return '';
        return `<span class="qsTg${on ? ' on' : ''}${q.id === 'dnd' ? ' dnd' : ''}" data-qs="${q.id}" role="switch" aria-checked="${on}">${fc.ui.icon(q.icon)}<span>${E(T(q.label))}</span><i></i></span>`;
    }).join('');
    const m = mod('music');
    const vol = m && m._config && m._config.track && m._config.enabled
        ? `<label class="qsVol">${fc.ui.icon('music')}<input type="range" min="0" max="100" value="${Math.round((+m._config.volume || 0) * 100)}" data-qs-vol title="${E(T('Music volume'))}"></label>` : '';
    return `<div class="qs">${sw ? `<div class="qsLooks">${sw}</div>` : ''}<div class="qsTgs">${toggles}</div>${vol}</div>`;
}

function onQuick(e, redraw) {
    const look = e.target.closest('[data-qs-look]');
    if (look) {
        const th = mod('discord-theme');
        if (th && th.applyLook) th.applyLook(look.dataset.qsLook, true);
        fc.settings.refresh('discord-theme');
        setTimeout(redraw, 60);
        return true;
    }
    const tg = e.target.closest('[data-qs]');
    if (tg) {
        const q = QUICK.find(x => x.id === tg.dataset.qs);
        if (q) { q.set(!q.on()); setTimeout(redraw, 60); }
        return true;
    }
    return false;
}
function onQuickInput(e) {
    if (!e.target.matches || !e.target.matches('[data-qs-vol]')) return;
    const m = mod('music');
    if (!m || !m._config) return;
    m._config.volume = Math.max(0, Math.min(1, +e.target.value / 100));
    store('music').save();
    if (m._tick) m._tick();
}

// the same block from the channel header's ⋯ menu
let qsPop = null;
function openQuick(anchor) {
    if (qsPop) { qsPop.close(); return; }
    const box = document.createElement('div');
    const draw = () => { box.innerHTML = fc.ui.popHead({ icon: 'bolt', title: T('Quick settings') }) + `<div class="fc-pb">${quickHtml()}</div>` +
        fc.ui.popFoot('', fc.ui.btn('All settings', { kind: 'sec', size: 'sm', icon: 'gear', act: 'qs-all' })); };
    draw();
    box.addEventListener('click', (e) => {
        if (onQuick(e, draw)) return;
        if (e.target.closest('[data-act="qs-all"]')) { if (qsPop) qsPop.close(); const st = mod('fightcord'); if (st && st.open) st.open(); }
    });
    box.addEventListener('input', onQuickInput);
    const at = anchor || document.querySelector('.channelToolbar [data-hdr-core="more"]') || { x: window.innerWidth - 300, y: 60 };
    const me = qsPop = fc.ui.popover(at, box, { width: 280, cls: 'fc-pop-card fcQs', onClose: () => { if (qsPop === me) qsPop = null; } });
}

/* --------------------------------------------------------------------- card */

function cardHtml() {
    const d = data();
    const t = d.tally;
    const dnd = fc.ui.dnd();
    const st = d.status === 'live' ? 'playing' : d.status === 'away' ? 'away' : dnd ? 'dnd' : 'on';
    const statusText = T({ playing: 'In a match', away: 'Away', dnd: 'Do not disturb', on: 'Online' }[st]);
    const banner = d.main && d.main.rom ? fc.ui.cardBanner(d.main.rom, 'var(--fc-brand)') : 'linear-gradient(120deg,var(--fc-accent),#8b5cf6 60%,#22e3f2)';
    const streak = d.tStreak.n >= 2 ? (d.tStreak.kind === 'won' ? T('{n} win streak', { n: d.tStreak.n }) : T('{n} losses in a row', { n: d.tStreak.n })) : '';
    const stats = fc.ui.stats([
        { label: 'Tonight', value: d.tonight ? E(d.tRec.w + '–' + d.tRec.l) : '—',
            sub: (d.tStreak.n >= 2 && d.tStreak.kind === 'won' ? fc.ui.ic('flame', 'fill') : '') + E(streak || (d.tonight ? T.plural(d.tonight, '{n} set', '{n} sets') : T('no sets yet'))) },
        { label: 'All time', value: t ? E(t.w + '–' + t.l) : '—', sub: E(t && t.rate != null ? Math.round(t.rate * 100) + '% · ' + T.plural(t.n, '{n} set', '{n} sets') : T('play a set first')) },
        { label: 'Best streak', value: d.st && d.st.bestW ? E(d.st.bestW + 'W') : '—', sub: E(T('longest run of wins')) },
        { label: 'Main game', value: E(d.main ? d.main.name : '—'), sub: d.main ? E(T.plural(d.main.n, '{n} set', '{n} sets')) : '', title: d.main ? d.main.name : '' }
    ]);
    const g = mod('goals');
    const pr = mod('presence');
    const mine = pr && pr.myProfile ? pr.myProfile() : null;
    const myBanner = pr && pr.bannerFor ? pr.bannerFor(d.me) : '';
    const shared = pr && pr.sharing ? pr.sharing() : false;
    // 3.2: your status in the bubble by your avatar, About me / badges / sharing in one inner panel
    const profBits = mine && (mine.a || (mine.bd || []).length) ? pr.profileHtml(d.me, { status: false }) : '';
    return fc.ui.cardHead({
        name: d.me || T('You'), banner: myBanner || banner,
        avatar: fc.ui.avatar(d.me, { size: 80, status: st, ring: 'var(--fc-s0)' }),
        meta: `<span class="pcSt ${st}">${E(statusText)}</span>`, status: mine && mine.s
    }) + `<div class="pcBody">${pr ? `<div class="fc-ch-sec">${profBits || (!(mine && mine.s) ? `<div class="pcSetStatus" data-pc="profile">${fc.ui.ic('chat')}${E(T('Set a status'))}</div>` : '')}
        <div class="pcProfRow"><span class="pcShare${shared ? ' on' : ''}">${E(shared ? T('Fightcord players see this') : T('Only you see this'))}</span>${fc.ui.btn('Edit profile', { kind: 'sec', size: 'sm', icon: 'edit', attrs: 'data-pc="profile"' })}</div></div>` : ''}
        ${stats}
        ${g && g.summaryHtml ? g.summaryHtml() : ''}
        ${d.friends.length ? `<div class="pcSec"><div class="fc-card-h">${E(T('Friends online'))}</div><div class="pcFriends">${d.friends.slice(0, 6).map(n =>
            `<img src="${E(fc.data.avatarUrl(n, (fc.app.user(n)[1] || {}).gravatar, 64))}" title="${E(n)}" alt="" onerror="this.style.visibility='hidden'">`).join('')}${d.friends.length > 6 ? `<em>+${d.friends.length - 6}</em>` : ''}</div></div>` : ''}
        <div class="pcSec"><div class="fc-card-h">${E(T('Quick settings'))}</div>${quickHtml()}</div>
        <div class="pcFoot">
            <span class="pcSeg"><span class="${d.status !== 'away' ? 'on' : ''}" data-pc="online"><i class="dot on"></i>${E(T('Online'))}</span><span class="${d.status === 'away' ? 'on' : ''}" data-pc="away"><i class="dot away"></i>${E(T('Away'))}</span></span>
            ${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'chart', title: 'Stats', attrs: 'data-pc="stats"' })}${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'users', title: 'Friends', attrs: 'data-pc="friends"' })}${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'gear', title: 'Settings', attrs: 'data-pc="settings"' })}${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'logout', title: 'Log out', cls: 'pcOut', attrs: 'data-pc="logout"' })}
        </div></div>`;
}

// the profile editor (3.7, like Discord's): your avatar and banner pictures, theme colours, a frame,
// pronouns, status, About me and the banner game, with your card as others will see it on the right
const PIC = {
    av: { w: 256, h: 256, round: true, label: N_('Avatar') },
    bn: { w: 960, h: 384, round: false, label: N_('Banner') }
};
const GIF_MAX = 8 * 1024 * 1024, PIC_MAX = 25 * 1024 * 1024;
const PIC_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// an animated WebP has an ANIM chunk near the start
function isAnimatedWebp(bytes) {
    const n = Math.min(bytes.length, 65536);
    for (let i = 12; i < n - 4; i++) if (bytes[i] === 0x41 && bytes[i + 1] === 0x4e && bytes[i + 2] === 0x49 && bytes[i + 3] === 0x4d) return true;
    return false;
}
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not a picture')); i.src = url; });
const toBlob = (c, type, q) => new Promise(res => c.toBlob(res, type, q));
// a picture drawn to w x h (zoom z >= 1 over "cover", x/y: where the middle is, 0..1)
function drawCrop(img, w, h, z, x, y) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight) * (z || 1);
    const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    const cx = x == null ? 0.5 : x, cy = y == null ? 0.5 : y;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, Math.min(0, Math.max(w - dw, w / 2 - cx * dw)), Math.min(0, Math.max(h - dh, h / 2 - cy * dh)), dw, dh);
    return c;
}

// still pictures: drag to move, slider (or the wheel) to zoom -> a Blob, or null
function cropDialog(img, kind) {
    const spec = PIC[kind];
    const vw = kind === 'av' ? 300 : 440, vh = Math.round(vw * spec.h / spec.w);
    return new Promise(done => {
        let z = 1, x = 0.5, y = 0.5, result = null, off = () => {};
        const body = `<div class="pcCrop"><div class="pcCropView${spec.round ? ' round' : ''}" style="width:${vw}px;height:${vh}px"><canvas width="${vw * 2}" height="${vh * 2}"></canvas></div>
            <div class="pcCropZoom">${fc.ui.ic('image')}<input type="range" min="1" max="4" step="0.01" value="1">${fc.ui.ic('image')}</div>
            <p class="fc-note">${E(T('Drag to move it, zoom with the slider or the mouse wheel.'))}</p></div>`;
        const m = fc.ui.modal({
            title: kind === 'av' ? T('Crop your avatar') : T('Crop your banner'), body, width: vw + 48,
            actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Apply'), fn: () => { result = drawCrop(img, spec.w, spec.h, z, x, y); } }],
            onClose: () => { off(); if (result) toBlob(result, 'image/webp', 0.9).then(done); else done(null); }
        });
        const cv = m.body.querySelector('canvas'), range = m.body.querySelector('input[type=range]');
        const draw = () => { const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(drawCrop(img, cv.width, cv.height, z, x, y), 0, 0); };
        // how much of the picture one pixel of the view moves (so the spot under the mouse follows it)
        const step = () => { const k = Math.max(vw / img.naturalWidth, vh / img.naturalHeight) * z; return [1 / (img.naturalWidth * k), 1 / (img.naturalHeight * k)]; };
        let drag = null;
        cv.addEventListener('mousedown', (e) => { e.preventDefault(); drag = { sx: e.clientX, sy: e.clientY, x, y }; });
        const move = (e) => { if (!drag) return; const [kx, ky] = step(); x = Math.min(1, Math.max(0, drag.x - (e.clientX - drag.sx) * kx)); y = Math.min(1, Math.max(0, drag.y - (e.clientY - drag.sy) * ky)); draw(); };
        const up = () => { drag = null; };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        off = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        range.addEventListener('input', () => { z = +range.value; draw(); });
        cv.addEventListener('wheel', (e) => { e.preventDefault(); z = Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); range.value = z; draw(); }, { passive: false });
        draw();
    });
}

function editProfile() {
    const pr = mod('presence'), up = mod('uploads'), lk = mod('profile-looks');
    if (!pr || !pr.rawProfile) return;
    const me = fc.app.me() || '';
    const draft = JSON.parse(JSON.stringify(pr.rawProfile()));
    const busy = {};                                   // kind -> { job, pct, local }
    // games to pick a banner from: your channels and what you've played most
    const games = new Map();
    fc.app.joinedChannels().forEach(c => { if (c.gameid) games.set(c.gameid, shortName(c.name || c.id)); });
    const counts = new Map();
    fc.history.all().forEach(x => { if (x.rom) counts.set(x.rom, (counts.get(x.rom) || 0) + 1); });
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([rom]) => {
        if (!games.has(rom)) { const s = fc.history.all().find(x => x.rom === rom); games.set(rom, shortName((s && (s.channel || s.game)) || rom)); }
    });
    const opts = '<option value="">' + E(T('My main game')) + '</option>' + [...games.entries()].map(([rom, n]) =>
        `<option value="${E(rom)}"${rom === draft.b ? ' selected' : ''}>${E(n)}</option>`).join('');
    const mine = pr.myProfile();
    const frames = lk ? lk.frameNames() : {};
    const themes = lk ? lk.themes() : [];
    const u = fc.app.user(me)[1] || fc.app.localUser() || {};
    const plainAv = fc.data.avatarUrl(me, u.gravatar, 160, true);
    // N_('Avatar') N_('Banner') N_('Profile theme') N_('Avatar frame')
    const sec = (title, inner, extra) => `<div class="pcEdSec"${extra || ''}><div class="pcEdH">${E(T(title))}</div>${inner}</div>`;
    const body = `<div class="pcEd"><div class="pcEdL pcEdit">
        ${sec('Avatar', `<div class="pcEdRow" data-drop="av">${fc.ui.btn('Change avatar', { size: 'sm', attrs: 'data-ed="pick-av"' })}${fc.ui.btn('Remove', { size: 'sm', kind: 'ghost', attrs: 'data-ed="rm-av"' })}<span class="pcEdUp" data-up="av"></span></div>`, ' data-drop="av"')}
        ${sec('Banner', `<div class="pcEdRow">${fc.ui.btn('Change banner', { size: 'sm', attrs: 'data-ed="pick-bn"' })}${fc.ui.btn('Remove', { size: 'sm', kind: 'ghost', attrs: 'data-ed="rm-bn"' })}<span class="pcEdUp" data-up="bn"></span></div>
            <label class="pcEdGame"><span>${E(T('No picture: a game’s art'))}</span><select class="fc-select" data-f="b">${opts}</select></label>`, ' data-drop="bn"')}
        ${sec('Profile theme', `<div class="pcEdTheme"><label class="pcEdCol"><input type="color" data-ed="th0"><small>${E(T('Top'))}</small></label><label class="pcEdCol"><input type="color" data-ed="th1"><small>${E(T('Bottom'))}</small></label>
            <div class="pcEdPresets">${themes.map((t, i) => `<i data-ed="preset" data-i="${i}" style="background:linear-gradient(180deg,${t[0]},${t[1]})" title="${E(t.join(' → '))}"></i>`).join('')}</div>
            ${fc.ui.btn('None', { size: 'sm', kind: 'ghost', attrs: 'data-ed="th-none"' })}</div>`)}
        ${sec('Avatar frame', `<div class="pcEdFrames"><div class="pcEdFr" data-ed="fr" data-fr="" title="${E(T('No frame'))}"><span class="fc-avatar" style="--sz:40px"><img src="${E(plainAv)}" alt=""></span><small>${E(T('None'))}</small></div>` +
            Object.keys(frames).map(k => `<div class="pcEdFr" data-ed="fr" data-fr="${k}" title="${E(T(frames[k]))}"><span class="fc-avatar" data-fcfr="${k}" style="--sz:40px"><img src="${E(plainAv)}" alt=""></span><small>${E(T(frames[k]))}</small></div>`).join('') + '</div>')}
        <label><span>${E(T('Pronouns'))}</span><input class="fc-input" data-f="pn" maxlength="40" placeholder="${E(T('Add your pronouns'))}" value="${E(draft.pn || '')}"></label>
        <label><span>${E(T('Status'))}</span><input class="fc-input" data-f="s" maxlength="80" placeholder="${E(T('Grinding 3rd Strike, FT5s welcome'))}" value="${E(draft.s || '')}"></label>
        <label><span>${E(T('About me'))}</span><textarea class="fc-input" data-f="a" maxlength="190" placeholder="${E(T('Mains, where you play from, what you’re working on…'))}">${E(draft.a || '')}</textarea><small class="cnt"></small></label>
        ${(mine.bd || []).length ? `<div class="pcEditBadges"><span>${E(T('Your badges'))}</span>${pr.badgesHtml(mine, true)}</div>` : ''}
        <p class="fc-note">${E(pr.sharing() ? T('Fightcord players see your profile everywhere they see you. Pictures go on public file hosts: anyone with the link can see them.')
            : T('Sharing is off, so only you see this (Settings → Voice chat → Share my profile).'))}</p>
        </div><div class="pcEdR"><div class="pcEdH">${E(T('Preview'))}</div><div class="pcPrev fclkPrev"></div><p class="fc-note pcEdHint">${E(T('GIFs play when someone hovers your avatar or card.'))}</p></div></div>`;
    const m = fc.ui.modal({
        title: T('Edit profile'), body, width: 820,
        actions: [{ label: T('Cancel'), kind: 'ghost' }, { label: T('Save'), fn: () => {
            if (Object.keys(busy).length) { fc.ui.toast(T('Still uploading…'), { icon: 'image' }); return false; }
            pr.setProfile(draft);
            if (lk) lk.refresh();
            fc.ui.toast(T('Profile saved'), { icon: 'check', kind: 'success' });
        } }],
        onClose: () => Object.keys(busy).forEach(k => { try { busy[k].job.cancel(); } catch (e) { /* done */ } })
    });
    m.el.addEventListener('keydown', (e) => e.stopPropagation());
    m.el.addEventListener('keypress', (e) => e.stopPropagation());
    const $ = (sel) => m.body.querySelector(sel);
    const saveBtn = m.el.querySelector('.fc-modal-f [data-i="1"]');

    // the right column: your card as others will see it
    const prev = () => {
        const pic = (k) => (busy[k] && busy[k].local) || (draft[k] && draft[k].u) || '';
        const bn = pic('bn');
        const banner = bn ? `url(&quot;${E(bn)}&quot;) center/cover` : draft.b ? fc.ui.cardBanner(draft.b, fc.data.hashColor(me)) : fc.ui.cardBanner('', fc.data.hashColor(me));
        const av = fc.ui.avatar(me, { size: 80, status: 'on', ring: 'var(--fc-s0)' }).replace(/ data-av="[^"]*"/, draft.fr ? ` data-fcfr="${E(draft.fr)}"` : '')
            .replace(/src="[^"]*"/, `src="${E(pic('av') || plainAv)}"`);
        const box = $('.pcPrev');
        box.innerHTML = fc.ui.cardHead({ name: me || T('You'), banner, avatar: av, status: draft.s || '', pn: draft.pn || '', meta: `<span>${E(T('Online'))}</span>` }) +
            `<div class="pcPrevB">${draft.a ? `<div class="fc-ch-sec"><div class="fcProfA"><b>${E(T('About me'))}</b>${E(draft.a)}</div></div>` : ''}` +
            `${fc.ui.cardMsg(me || 'you', 'data-none', T('Message @{name}', { name: me || 'you' }))}</div>`;
        if (lk) lk.applyTheme(box, draft.th || null);
        ['av', 'bn'].forEach(k => { const el = m.body.querySelector(`[data-up="${k}"]`); el.textContent = busy[k] ? T('Uploading… {n}%', { n: busy[k].pct }) : ''; });
        if (saveBtn) saveBtn.disabled = !!Object.keys(busy).length;
        m.body.querySelectorAll('.pcEdFr').forEach(el => el.classList.toggle('on', (el.dataset.fr || '') === (draft.fr || '')));
        const th = draft.th || ['#5865f2', '#eb459e'];
        $('[data-ed="th0"]').value = th[0]; $('[data-ed="th1"]').value = th[1];
        m.body.querySelector('.pcEdTheme').classList.toggle('none', !draft.th);
    };

    const fail = (msg) => fc.ui.toast(msg, { kind: 'danger', icon: 'warn' });
    // (async all the way: anything that throws ends up in take's catch, never a stuck "Uploading…")
    const send = async (kind, blob, type, onPct) => {
        const data = Buffer.from(await blob.arrayBuffer());
        const job = up.uploadRetry(data, type, (f) => onPct(Math.round(f * 100)), { fallback: false });
        if (busy[kind]) busy[kind].job = job;
        return (await job.promise).url;
    };
    async function take(kind, file) {
        if (!up || !up.uploadRetry) { fail(T('Uploads aren’t available (Pictures in chat is off)')); return; }
        const type = String(file.type || '').toLowerCase();
        if (PIC_TYPES.indexOf(type) < 0) { fail(T('Only pictures: png, jpg, webp or gif')); return; }
        if (file.size > PIC_MAX) { fail(T('Too big: up to {mb} MB', { mb: PIC_MAX / 1048576 })); return; }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const moving = type === 'image/gif' || (type === 'image/webp' && isAnimatedWebp(bytes));
        if (moving && file.size > GIF_MAX) { fail(T('Animated pictures: up to {mb} MB', { mb: GIF_MAX / 1048576 })); return; }
        const local = URL.createObjectURL(file);
        let img;
        try { img = await loadImg(local); } catch (e) { URL.revokeObjectURL(local); fail(T('That picture didn’t open')); return; }
        const spec = PIC[kind];
        let main = null, still = null, mainType = 'image/webp';
        if (moving) {
            // as it is (it moves), and its first frame for everyone not hovering it
            main = file; mainType = type;
            still = await toBlob(drawCrop(img, spec.w, spec.h, 1, 0.5, 0.5), 'image/webp', 0.88);
        } else {
            main = await cropDialog(img, kind);
            if (!main) { URL.revokeObjectURL(local); return; }
        }
        const shown = moving ? local : URL.createObjectURL(main);
        if (!moving) URL.revokeObjectURL(local);
        busy[kind] = { pct: 0, local: shown, job: { cancel() {} } };
        prev();
        try {
            const pct = (n) => { if (busy[kind]) { busy[kind].pct = n; prev(); } };
            const url = await send(kind, main, mainType, pct);
            const surl = still ? await send(kind, still, 'image/webp', () => {}) : '';
            draft[kind] = surl ? { u: url, s: surl } : { u: url };
        } catch (e) {
            if (e && e.message !== 'cancelled') fail(T('The upload didn’t work: {why}', { why: (e && e.message) || '?' }));
        }
        delete busy[kind];
        if (m.el.isConnected) prev();
    }
    const pick = (kind) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = PIC_TYPES.join(',');
        input.onchange = () => { const f = input.files && input.files[0]; if (f) take(kind, f); };
        input.click();
    };

    m.body.addEventListener('click', (e) => {
        const t = e.target.closest('[data-ed]');
        if (!t) return;
        const ed = t.dataset.ed;
        if (ed === 'pick-av' || ed === 'pick-bn') { if (!busy[ed.slice(5)]) pick(ed.slice(5)); }
        else if (ed === 'rm-av' || ed === 'rm-bn') { const k = ed.slice(3); if (busy[k]) { busy[k].job.cancel(); delete busy[k]; } delete draft[k]; }
        else if (ed === 'preset') draft.th = themes[+t.dataset.i].slice();
        else if (ed === 'th-none') delete draft.th;
        else if (ed === 'fr') { if (t.dataset.fr) draft.fr = t.dataset.fr; else delete draft.fr; }
        else return;
        prev();
    });
    ['th0', 'th1'].forEach((k, i) => $(`[data-ed="${k}"]`).addEventListener('input', (e) => {
        const th = (draft.th || ['#5865f2', '#eb459e']).slice();
        th[i] = e.target.value.toLowerCase();
        draft.th = th;
        prev();
    }));
    m.body.addEventListener('input', (e) => {
        const f = e.target.dataset && e.target.dataset.f;
        if (!f) return;
        if (e.target.value) draft[f] = e.target.value; else delete draft[f];
        prev();
    });
    m.body.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.f === 'b') { draft.b = e.target.value; prev(); } });
    // drop a picture on the avatar or banner part
    m.body.addEventListener('dragover', (e) => { if (e.target.closest('[data-drop]')) e.preventDefault(); });
    m.body.addEventListener('drop', (e) => {
        const z = e.target.closest('[data-drop]');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!z || !f) return;
        e.preventDefault();
        if (!busy[z.dataset.drop]) take(z.dataset.drop, f);
    });
    const ta = $('textarea'), cnt = $('.cnt');
    const count = () => { cnt.textContent = (190 - ta.value.length) + ''; };
    ta.addEventListener('input', count);
    count();
    prev();
    setTimeout(() => { const i = $('[data-f="pn"]'); if (i) i.focus(); }, 30);
}

function redraw() { const c = document.getElementById('pcCard'); if (c) c.innerHTML = cardHtml(); }

function closeFc() {
    const r = fc.app.root();
    const tb = r && r.$refs && r.$refs.mainToolbar;
    if (tb && 'showGlobalStateMenu' in tb) tb.showGlobalStateMenu = false;
    const m = document.querySelector('.userStateMenu.active');
    if (m) m.classList.remove('active');
    hide();
}

function onClick(e) {
    e.stopPropagation();
    if (onQuick(e, redraw)) return;
    const b = e.target.closest('[data-pc]');
    const a = b && b.dataset.pc;
    if (!a) return;
    const fcMenu = document.querySelector('.buttonBar .userButton .userStateMenu');
    if (a === 'online' || a === 'away') {
        const opts = fcMenu ? fcMenu.querySelectorAll('.optionWrapper') : [];
        const el = opts[a === 'online' ? 0 : 1];
        if (el) el.click();
        setTimeout(redraw, 120);
        return;
    }
    if (a === 'profile') { closeFc(); setTimeout(editProfile, 0); return; }
    if (a === 'logout') {
        const lo = fcMenu && fcMenu.querySelector('.logOutWrapper .button');
        closeFc();
        if (lo) lo.click();
        return;
    }
    closeFc();
    const m = mod(a === 'settings' ? 'fightcord' : a);
    if (m && m.open) m.open();
}

let unlayer = null;
function show() {
    document.documentElement.classList.add('fcpc-on');
    let c = document.getElementById('pcCard');
    if (c && c.classList.contains('fc-out')) { c.remove(); c = null; }      // still fading out
    if (!c) {
        c = document.createElement('div');
        c.id = 'pcCard';
        c.className = 'fc-cardpop';
        c.addEventListener('click', onClick);
        c.addEventListener('input', onQuickInput);
        c.addEventListener('mousedown', (e) => e.stopPropagation());
        document.body.appendChild(c);
    }
    c.innerHTML = cardHtml();
    const rail = document.querySelector('.mainToolbarWrapper .mainToolbar');
    c.style.left = ((rail ? rail.getBoundingClientRect().right : 72) + 10) + 'px';
    if (!unlayer) unlayer = fc.ui.layer(() => closeFc());
}

function hide() {
    const c = document.getElementById('pcCard');
    if (c && !c.classList.contains('fc-out')) fc.ui.animateOut(c);
    if (unlayer) { unlayer(); unlayer = null; }
}

// follow Fightcade's own open / closed state of the status menu
let lastOpen = false;
function poll() {
    const open = !!document.querySelector('.buttonBar .userButton .userStateMenu.active');
    if (open !== lastOpen) { lastOpen = open; if (open) show(); else hide(); }
}

const CSS = `
html.fcpc-on .buttonBar .userButton .userStateMenu { opacity: 0 !important; pointer-events: none !important; }
#pcCard { position: fixed; bottom: 12px; z-index: calc(var(--fc-z-pop) + 4); width: 320px; max-height: calc(100vh - 24px); overflow-x: hidden; overflow-y: auto;
    border-radius: var(--fc-r3); background: var(--fc-s0); color: var(--fc-text); font: 14px/1.35 var(--fc-font);
    box-shadow: 0 0 0 1px var(--fc-divider), var(--fc-sh3); transform-origin: left bottom; }
#pcCard .fc-ch-banner { image-rendering: pixelated; }
#pcCard .fc-ch-sec > :first-child { margin-top: 0; }
.fc-avatar > .st.dnd { background: var(--fc-danger); }
#pcCard .pcSt { font-weight: 600; color: var(--fc-success); }
#pcCard .pcSt.away { color: var(--fc-warning); } #pcCard .pcSt.playing, #pcCard .pcSt.dnd { color: var(--fc-danger); }
#pcCard .pcBody { padding: 0 16px 12px; }
#pcCard .fcProf { margin-top: 10px; }
#pcCard .pcSetStatus { display: flex; align-items: center; margin-top: 0; padding: 6px 9px; border-radius: var(--fc-r2); border: 1px dashed var(--fc-divider);
    color: var(--fc-muted); font-size: 13px; cursor: pointer; }
#pcCard .pcSetStatus:hover { color: var(--fc-text); border-color: var(--fc-muted); }
#pcCard .pcSetStatus .fc-ic { width: 13px; height: 13px; margin-right: 7px; }
#pcCard .pcProfRow { display: flex; align-items: center; margin-top: 8px; }
#pcCard .pcShare { flex: 1; font-size: 11.5px; color: var(--fc-muted); }
#pcCard .pcShare.on { color: var(--fc-success); }
.pcEdit label { display: block; margin-bottom: 12px; position: relative; }
.pcEdit label > span { display: block; margin-bottom: 6px; color: var(--fc-muted); font: 700 12px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
.pcEdit .fc-input, .pcEdit .fc-select { width: 100%; box-sizing: border-box; }
.pcEdit textarea { height: 70px; padding: 8px 10px; resize: none; line-height: 1.4; }
.pcEdit .cnt { position: absolute; right: 8px; bottom: 6px; font-size: 11px; color: var(--fc-muted); }
.pcEditBadges > span { display: block; color: var(--fc-muted); font: 700 12px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
/* 3.7: the editor, fields on the left and your card on the right (no flex gap: Chromium 80) */
.pcEd { display: flex; align-items: flex-start; }
.pcEdL { flex: 1; min-width: 0; padding-right: 4px; }
.pcEdR { flex: none; width: 300px; margin-left: 18px; position: sticky; top: 0; }
.pcEdH { margin-bottom: 8px; color: var(--fc-muted); font: 700 12px/1 var(--fc-font); text-transform: uppercase; letter-spacing: .02em; }
.pcEdSec { margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--fc-divider); }
.pcEdRow { display: flex; align-items: center; flex-wrap: wrap; }
.pcEdRow > .fc-btn { margin-right: 8px; }
.pcEdUp { font-size: 12px; color: var(--fc-muted); }
.pcEdit label.pcEdGame { margin: 10px 0 0; }
.pcEdit label.pcEdGame > span { text-transform: none; font-weight: 600; letter-spacing: 0; }
.pcEdTheme { display: flex; align-items: center; flex-wrap: wrap; }
.pcEdit label.pcEdCol { display: flex; flex-direction: column; align-items: center; margin: 0 10px 0 0; }
.pcEdCol input { width: 44px; height: 44px; padding: 0; border: 0; border-radius: 8px; background: none; cursor: pointer; }
.pcEdCol small { margin-top: 3px; font-size: 11px; color: var(--fc-muted); }
.pcEdTheme.none .pcEdCol input { opacity: .45; }
.pcEdPresets { display: flex; flex-wrap: wrap; max-width: 190px; margin-right: 8px; }
.pcEdPresets > i { width: 22px; height: 22px; margin: 0 6px 6px 0; border-radius: 50%; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(255,255,255,.15); }
.pcEdPresets > i:hover { transform: scale(1.12); }
.pcEdFrames { display: flex; flex-wrap: wrap; margin-right: -8px; }
.pcEdFr { display: flex; flex-direction: column; align-items: center; width: 64px; margin: 0 8px 8px 0; padding: 10px 0 6px; border-radius: 8px; background: var(--fc-s2); cursor: pointer; }
.pcEdFr:hover { background: var(--fc-s3); }
.pcEdFr.on { box-shadow: inset 0 0 0 2px var(--fc-accent); }
.pcEdFr small { margin-top: 8px; font-size: 11px; color: var(--fc-text); }
.pcPrev { position: relative; overflow: hidden; border-radius: 10px; background: var(--fc-s0); box-shadow: 0 0 0 1px var(--fc-divider), var(--fc-sh2, 0 4px 14px rgba(0,0,0,.3)); }
.pcPrevB { padding: 0 16px 16px; }
.pcPrevB .fc-cmsg { margin-top: 12px; pointer-events: none; }
.pcEdHint { margin-top: 8px; }
.pcCrop { display: flex; flex-direction: column; align-items: center; }
.pcCropView { position: relative; overflow: hidden; border-radius: 8px; background: #000; cursor: grab; }
.pcCropView:active { cursor: grabbing; }
.pcCropView canvas { width: 100%; height: 100%; display: block; }
.pcCropView.round::after { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; background: radial-gradient(circle closest-side, transparent 98%, rgba(0,0,0,.6) 100%); }
.pcCropZoom { display: flex; align-items: center; width: 100%; margin-top: 12px; color: var(--fc-muted); }
.pcCropZoom input { flex: 1; margin: 0 10px; }
.pcCropZoom .fc-ic:first-child { width: 13px; height: 13px; }
.pcCropZoom .fc-ic:last-child { width: 19px; height: 19px; }
#pcCard .fc-stat > small .fc-ic { margin-right: 3px; color: var(--fc-warning); }
#pcCard .pcSec { margin-top: 10px; }
#pcCard .pcSec .fc-card-h { margin-bottom: 6px; font-size: 11px; }
#pcCard .fcglSum { margin-top: 6px; }
#pcCard .pcFriends { display: flex; align-items: center; }
#pcCard .pcFriends img { width: 28px; height: 28px; margin-right: -6px; border-radius: 50%; box-shadow: 0 0 0 3px var(--fc-s0); background: var(--fc-s1); }
#pcCard .pcFriends em { margin-left: 12px; font-style: normal; font-size: 12px; color: var(--fc-muted); }
#pcCard .pcFoot { display: flex; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--fc-divider); }
#pcCard .pcFoot > .fc-btn { margin-left: 2px; }
#pcCard .pcFoot > .pcOut:hover { background: var(--fc-danger); color: #fff; }
#pcCard .pcSeg { display: flex; flex: 1; margin-right: 6px; padding: 2px; border-radius: var(--fc-r2); background: var(--fc-s1); }
#pcCard .pcSeg > span { display: flex; align-items: center; justify-content: center; flex: 1; height: 26px; border-radius: 6px; cursor: pointer;
    font-size: 12.5px; font-weight: 600; color: var(--fc-muted); }
#pcCard .pcSeg > span:hover { color: var(--fc-text); }
#pcCard .pcSeg > span.on { background: var(--fc-s3); color: var(--fc-head); }
#pcCard .pcSeg .dot { width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; }
#pcCard .pcSeg .dot.on { background: var(--fc-success); } #pcCard .pcSeg .dot.away { background: var(--fc-warning); }

/* quick settings (also in the ⋯ menu pop-up) */
.qsLooks { display: flex; margin-bottom: 8px; }
.qsLook { width: 28px; height: 28px; margin-right: 8px; border-radius: 50%; cursor: pointer; box-shadow: 0 0 0 1px rgba(255,255,255,.12);
    transition: transform var(--fc-fast); }
.qsLook:hover { transform: scale(1.1); }
.qsLook.on { box-shadow: 0 0 0 2px var(--fc-s0), 0 0 0 4px var(--fc-accent); }
.qsTgs { display: flex; flex-wrap: wrap; margin: 0 -3px; }
.qsTg + .qsTg { margin-top: 0; }
.qsTg { display: flex; align-items: center; flex: 1 1 100%; min-width: 0; box-sizing: border-box; margin: 3px; padding: 6px 8px;
    border-radius: var(--fc-r2); background: var(--fc-s2); cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--fc-text); user-select: none; }
.qsTg:hover { background: var(--fc-s3); }
.qsTg > .fc-ic { width: 15px; height: 15px; flex: none; margin-right: 6px; color: var(--fc-muted); }
.qsTg > span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.qsTg > i { position: relative; flex: none; width: 24px; height: 14px; margin-left: 6px; border-radius: 7px; background: var(--fc-s4); transition: background var(--fc-fast); }
.qsTg > i::after { content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; transition: left var(--fc-fast); }
.qsTg.on > i { background: var(--fc-success); }
.qsTg.on > i::after { left: 12px; }
.qsTg.on > .fc-ic { color: var(--fc-success); }
.qsTg.dnd.on > i { background: var(--fc-danger); }
.qsTg.dnd.on > .fc-ic { color: var(--fc-danger); }
.qsVol { display: flex; align-items: center; margin-top: 6px; padding: 0 4px; color: var(--fc-muted); }
.qsVol .fc-ic { width: 14px; height: 14px; flex: none; margin-right: 8px; }
.qsVol input { flex: 1; min-width: 0; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    window.__fcProfileLoaded = true;
    fc.ui.style('pcStyle', CSS);
    document.documentElement.classList.add('fcpc-on');       // the card replaces Fightcade's small menu
    fc.own(() => { fc.ui.style('pcStyle', null); hide(); if (qsPop) qsPop.close(); document.documentElement.classList.remove('fcpc-on'); window.__fcProfileLoaded = false; });
    fc.tick(poll, 150);
    fc.on('dnd:changed', () => redraw());
    fc.on('presence:profile', (ev) => { if (ev && ev.me) redraw(); });
    fc.own(fc.ui.header.more({ id: 'quick-settings', label: N_('Quick settings'), icon: 'bolt', order: 90, fn: () => setTimeout(() => openQuick(), 0) }));
    return api;
}

const api = { _edit: () => editProfile(), _show: () => show(), _hide: () => hide(), _data: () => data(), openQuick: (a) => openQuick(a), _quick: () => QUICK.map(q => ({ id: q.id, on: q.on() })) };

module.exports = { id: 'profile-card', name: 'Profile popout', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
