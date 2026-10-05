/**
 * Fightcord settings (Settings 2.0) and the updater
 *
 * Settings: one Discord-style "User Settings" screen for all of Fightcord (Settings ->
 * "Open Fightcord settings", the gear in the Discover sidebar, Ctrl+, or /fightcord). Its
 * sections come from fc.settings (modules can add their own); each section is a pane the
 * core mounts that section's blocks into. On top: a search box over every setting, profiles
 * (Lite / Full / Competitive), backup & restore of all settings, and a Diagnostics page.
 * Fightcade's own settings page keeps just a way in.
 *
 * Updates (updater.js does the work): Fightcord updates itself while Fightcade starts. For
 * long sessions this checks once a day too; an update found then is installed right away and
 * a green button in the left rail (and a pop-up) offers to restart Fightcade to finish.
 * The release notes show here, so nobody has to go to GitHub.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
const DIR = __dirname;
const MANIFEST = path.join(DIR, 'fightcord.json');
const STATE_PATH = path.join(DIR, 'fightcord-state.json');
const RPC_CONFIG = path.join(DIR, 'discord-rpc-config.json');
const REPO = 'JillTheStingray/fightcord';
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const ET = (s, v) => fc.fmt.esc(fc.t(s, v));
const N_ = (s) => s;          // translated where shown
// module states in Diagnostics: N_('running') N_('failed') N_('off') N_('loaded')
const LOG = (...a) => fc.log(...a);

function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
function writeJson(p, v) { try { fs.writeFileSync(p, JSON.stringify(v, null, 2)); return true; } catch (e) { LOG('could not write', p, e.message); return false; } }

const manifest = () => readJson(MANIFEST, {});
const version = () => manifest().version || '0.0.0';

// updater state lives apart from fightcord.json (the installer rewrites that one)
let state = null;
const saveState = () => writeJson(STATE_PATH, state);

/* ----------------------------------------------------------------- sections */

// the built-in sections (modules can add more with fc.settings.section)
const BUILTIN = [
    ['home', N_('My Fightcord'), 'home', 0], ['appearance', N_('Appearance'), 'palette', 10], ['chat', N_('Chat'), 'chat', 20],
    ['members', N_('Member list & friends'), 'users', 30], ['search', N_('Search tab'), 'search', 40],
    ['challenges', N_('Scout & challenges'), 'sword', 50], ['match', N_('Match screens'), 'trophy', 60], ['music', N_('Music'), 'music', 70],
    ['rpc', N_('Discord status'), 'link', 80],
    ['updates', N_('Updates'), 'download', 900], ['backup', N_('Backup & restore'), 'copy', 910], ['diagnostics', N_('Diagnostics'), 'bug', 920], ['about', N_('About'), 'info', 930]
];
const APP_FROM = 900;

const PLUGINS = [
    ['discord-theme.js', N_('Discord theme')], ['branding.js', N_('FightCord logo')], ['discover.js', N_('Search tab (Discover)')], ['chat-extras.js', N_('Chat extras')],
    ['translate.js', N_('Translator')], ['emoji.js', N_(':emoji: shortcodes')], ['fontstyle.js', N_('Chat font styles')],
    ['member-list.js', N_('Member list')], ['scout.js', N_('Scout card, ELO & odds')], ['challenge-filters.js', N_('Challenge filters')], ['find-match.js', N_('Find a match')],
    ['match-screens.js', N_('Match screens & session tracker')], ['stats.js', N_('Stats, head-to-head & share card')],
    ['analytics.js', N_('Match analytics')], ['progress.js', N_('Rank & ELO history')], ['goals.js', N_('Training goals')], ['feed.js', N_('Lobby feed')], ['welcome.js', N_('Welcome screen & tour')], ['events.js', N_('Event reminders')], ['friends.js', N_('Friends')], ['notes.js', N_('Player notes & tags')],
    ['challenge-card.js', N_('Challenge card')], ['channel-banner.js', N_('Channel banner')], ['hover-cards.js', N_('Member hover cards')],
    ['profile-card.js', N_('Profile popout')], ['context-menu.js', N_('Right-click menu')], ['inbox.js', N_('Notification inbox')], ['backgrounds.js', N_('Animated backgrounds')], ['music.js', N_('Background music')], ['discord-rpc.js', N_('Discord status')], ['streamer.js', N_('Streamer mode & OBS overlay')],
    ['snapshot.js', N_('Snapshot tool (dev)')]
];

// one click sets which modules run (applies after a restart)
const PROFILES = {
    lite: { label: 'Lite', icon: 'bolt', desc: 'The Discord look and the essentials. Lightest on your PC.',
        off: ['backgrounds.js', 'music.js', 'feed.js', 'inbox.js', 'context-menu.js', 'hover-cards.js', 'profile-card.js', 'channel-banner.js', 'challenge-filters.js', 'translate.js', 'fontstyle.js', 'snapshot.js'] },
    full: { label: 'Full', icon: 'star', desc: 'Everything Fightcord has.', off: ['snapshot.js'] },
    competitive: { label: 'Competitive', icon: 'target', desc: 'Scouting, filters, stats and match screens — no music or moving background.',
        off: ['backgrounds.js', 'music.js', 'fontstyle.js', 'snapshot.js'] }
};

function currentProfile() {
    if (!PLUGINS.some(([f]) => fs.existsSync(path.join(DIR, f)))) return '';          // can't tell (no plugin files here)
    const off = new Set((manifest().off || []).filter(f => fs.existsSync(path.join(DIR, f))));
    return Object.keys(PROFILES).find(k => {
        const p = new Set(PROFILES[k].off.filter(f => fs.existsSync(path.join(DIR, f))));
        return p.size === off.size && [...p].every(f => off.has(f));
    }) || '';
}

let current = 'home';

/* --------------------------------------------------------------- pane heads */

function toggle(label, hint, checked, attrs) {
    return `<label class="fc-field"><span class="fc-field-text"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>` +
        `<input type="checkbox" class="fc-switch-in" ${attrs || ''} ${checked ? 'checked' : ''}><i class="fc-switch"></i></label>`;
}

function hero(sub) {
    return `<div class="fcordHero"><div class="logo">${fc.ui.icon('bolt')}</div><div><b>Fightcord ${E(version())}</b><span>${sub}</span></div></div>`;
}

function paneHtml(id) {
    if (id === 'home') {
        const m = manifest();
        const off = new Set(m.off || []);
        const prof = currentProfile();
        const running = fc.modules.list().filter(x => x.state === 'running').length;
        return `<h2>${ET('My Fightcord')}</h2>
            ${hero(ET('Discord-style Fightcade · {n} modules running', { n: running }) + (fc.safeMode ? ' · ' + ET('SAFE MODE') : ''))}
            <div class="fc-set">${toggle(ET('Fightcord on'), ET('Off = plain Fightcade after a restart'), !m.disabled, 'data-man="disabled"')}
            ${toggle(ET('Startup splash screen'), ET('The FightCord logo while Fightcade logs in'), m.splash !== false, 'data-man="splash"')}</div>
            <h3>${ET('Profile')} <small>— ${ET('which modules run; applies after a restart')}</small></h3>
            <div class="fcordProfiles">${Object.keys(PROFILES).map(k => `<div class="fcordProfile${prof === k ? ' on' : ''}" data-profile="${k}">
                ${fc.ui.icon(PROFILES[k].icon)}<b>${ET(PROFILES[k].label)}</b><span>${ET(PROFILES[k].desc)}</span></div>`).join('')}</div>
            <h3>${ET('Modules')} <small>— ${prof ? ET('{name} profile', { name: T(PROFILES[prof].label) }) : ET('your own mix')}</small></h3>
            <div class="fc-set">${PLUGINS.filter(([f]) => fs.existsSync(path.join(DIR, f))).map(([f, label]) => {
                const mod = fc.modules.list().find(x => x.file === f);
                const why = mod && mod.state === 'failed' ? ' — ' + T('couldn’t start: {error}', { error: (mod.error || '').split('\n')[0] }) : '';
                return toggle(ET(label) + (why ? ' <em class="bad">' + E(why) + '</em>' : ''), f, !off.has(f), `data-plugin="${E(f)}"`);
            }).join('')}</div>
            <div class="fcordBtns">${fc.ui.btn('Restart Fightcade', { kind: 'sec', icon: 'refresh', act: 'restart' })}<span class="fcordNote" data-note="restart"></span></div>`;
    }
    if (id === 'rpc') {
        const c = Object.assign({ showScore: true, showRanks: true, showNames: true, showSession: true, debug: false }, readJson(RPC_CONFIG, {}));
        return `<h2>${ET('Discord status')}</h2>
            <p class="lead">${ET('What your Discord profile shows while you’re on Fightcade. Changes apply after a restart.')}</p>
            <div class="fc-set">${toggle(ET('Show the score'), ET('The set score during a match'), c.showScore, 'data-rpc="showScore"')}
            ${toggle(ET('Show ranks'), ET('Your rank and your opponent’s'), c.showRanks, 'data-rpc="showRanks"')}
            ${toggle(ET('Show opponent names'), '"vs KenjiRival"', c.showNames, 'data-rpc="showNames"')}
            ${toggle(ET('Tonight’s record'), ET('"· 7–3 tonight" from the session tracker'), c.showSession, 'data-rpc="showSession"')}
            ${toggle(ET('Debug log'), ET('Writes discord-rpc-debug.log — leave off unless something is wrong'), c.debug, 'data-rpc="debug"')}</div>`;
    }
    if (id === 'updates') {
        const L = state.latest;
        return `<h2>${ET('Updates')}</h2>
            ${hero(E(state.ready ? T('Fightcord {version} is installed — restart Fightcade to finish', { version: state.ready }) : state.status || (state.lastCheck ? T('Checked {when}', { when: new Date(state.lastCheck).toLocaleString(fc.t.locale()) }) : T('Not checked yet'))))}
            <div class="fcordBtns">${fc.ui.btn('Check for updates', { icon: 'refresh', act: 'check' })}
                ${L && newer(L.version, version()) && !state.ready ? fc.ui.btn(T('Install {version}', { version: L.version }), { kind: 'success', icon: 'download', act: 'install' }) : ''}
                ${state.ready ? fc.ui.btn('Restart Fightcade', { kind: 'sec', icon: 'refresh', act: 'restart' }) : ''}</div>
            <div class="fc-set">${toggle(ET('Update automatically'), ET('When Fightcade starts, and once a day while it’s open'), state.autoInstall, 'data-state="autoInstall"')}</div>
            ${L && L.notes ? `<h3>${ET('What’s new in {version}', { version: L.version })}</h3><div class="fcordNotes">${notesHtml(L.notes)}</div>` : ''}
            <p class="lead small">${ET('Updates come straight from Fightcord’s releases on GitHub and are checked against a checksum before anything is installed. You never need to download the installer again.')}</p>`;
    }
    if (id === 'backup') {
        return `<h2>${ET('Backup & restore')}</h2>
            <p class="lead">${ET('Every Fightcord setting in one file: theme, friends, notes, filters, member list, music choice… (Not the match history or your music files — those stay in the Fightcord folder.)')}</p>
            <div class="fcordBtns">${fc.ui.btn('Back up my settings', { icon: 'download', act: 'backup' })}
                ${fc.ui.btn('Restore from a file…', { kind: 'sec', icon: 'refresh', act: 'restore' })}
                <input type="file" class="fcordRestoreFile" accept=".json,application/json" style="display:none"></div>
            <div class="fcordNote" data-note="backup"></div>`;
    }
    if (id === 'diagnostics') return diagnosticsHtml();
    if (id === 'about') {
        return `<h2>${ET('About')}</h2>
            <p class="lead">${ET('Fightcord turns Fightcade into something that looks and works like Discord: the theme, chat, member list, search tab, match screens, stats and your Discord status. Fightcord isn’t made by or affiliated with Fightcade or Discord.')}</p>
            <div class="fcordBtns">${fc.ui.btn('GitHub page', { kind: 'sec', icon: 'link', act: 'repo' })}${fc.ui.btn('Open Fightcord folder', { kind: 'sec', icon: 'copy', act: 'folder' })}</div>
            <p class="lead small">${ET('Settings, match history and sounds are kept in the Fightcord folder. The installer keeps your previous setup (Cerberus) in fightcord-backup next to it; FightcordSetup.exe → Uninstall can put it back.')}</p>`;
    }
    const sec = fc.settings.sections().find(s => s.id === id);
    return `<h2>${ET(sec ? sec.label : id)}</h2>`;
}

function diagnosticsHtml() {
    const d = fc.diag();
    const mods = d.modules;
    const running = mods.filter(m => m.state === 'running').length, failed = mods.filter(m => m.state === 'failed');
    const missing = Object.keys(d.anchors).filter(k => !d.anchors[k]);
    const cfg = fc.config('fightcord-core').data;
    return `<h2>${ET('Diagnostics')}</h2>
        <div class="fcordTiles">${fc.ui.tile(running + '/' + mods.length, 'modules running', { trend: failed.length ? 'down' : '' })}
            ${fc.ui.tile(String(d.tick.jobs), 'timers (one base loop)')}${fc.ui.tile(String(d.watch.watchers), 'page watchers (one observer)')}
            ${fc.ui.tile(d.api.requests + ' / ' + d.api.cached, 'API requests / from cache', { sub: d.api.errors ? d.api.errors + ' errors' : '' })}</div>
        ${d.safeMode ? '<div class="fc-note">' + ET('Safe mode: only the settings are running. Restart Fightcade to start normally.') + '</div>' : ''}
        <h3>${ET('Modules')}</h3>
        <div class="fcordMods">${mods.map(m => `<div class="fcordMod ${m.state}"><i></i><b>${ET(m.name || m.id)}</b>` +
            `<span>${ET(m.state)}${m.legacy ? ' · ' + ET('old-style plugin') : ''}${m.error ? ' — ' + E(m.error.split('\n')[0]) : ''}</span></div>`).join('')}</div>
        <h3>Fightcade</h3>
        <div class="fc-note">${missing.length ? ET('Not found (a Fightcade update may have changed these): {list}', { list: missing.join(', ') }) : ET('Everything Fightcord hooks into is where it should be.')}</div>
        <h3>${ET('Recent problems')}</h3>
        <pre class="fcordLog">${E(d.errors.length ? d.errors.map(e => new Date(e.at).toLocaleTimeString() + ' ' + e.level + ' [' + e.scope + '] ' + e.text.split('\n')[0]).join('\n') : T('None — all quiet.'))}</pre>
        <div class="fcordBtns">${fc.ui.btn('Copy debug info', { icon: 'copy', act: 'copydiag' })}${fc.ui.btn('Open Fightcord folder', { kind: 'sec', act: 'folder' })}<span class="fcordNote" data-note="diag"></span></div>
        <div class="fc-set">${toggle(ET('Debug log'), ET('Writes fightcord-debug.log next to the plugins — for bug reports'), !!cfg.debugLog, 'data-core="debugLog"')}
        ${toggle(ET('Safe mode on the next start'), ET('Only the settings run (you can also hold Shift while Fightcade starts)'), manifest().safeMode === true, 'data-man="safeMode"')}</div>`;
}

/* -------------------------------------------------------------------- modal */

let navSig = '';

function ensureModal() {
    let m = document.getElementById('fcordModal');
    if (m) { syncNav(m); return m; }
    m = document.createElement('div');
    m.id = 'fcordModal';
    m.innerHTML = `<div class="fcordSide"><nav>
            <div class="fcordSearch">${fc.ui.icon('search')}<input type="text" placeholder="${ET('Search settings')}" spellcheck="false"></div>
            <div class="fcordNav"></div>
            <div class="sep"></div><div class="ver">Fightcord ${E(version())}</div></nav></div>
        <div class="fcordMain"><div class="fcordContent"><div class="fcordPane fcordResults" data-results="1"></div></div>
            <div class="fcordClose" title="${ET('Close (Esc)')}">${fc.ui.icon('close')}<small>ESC</small></div></div>`;
    m.addEventListener('click', onModalClick);
    m.addEventListener('change', onModalChange);
    m.addEventListener('mousedown', (e) => e.stopPropagation());
    const search = m.querySelector('.fcordSearch input');
    search.addEventListener('input', () => runSearch(search.value));
    search.addEventListener('keydown', (e) => e.stopPropagation(), true);
    document.body.appendChild(m);
    syncNav(m);
    return m;
}

// sidebar + one pane per section (a module may add a section later: picked up here)
function syncNav(m) {
    const secs = fc.settings.sections();
    const sig = secs.map(s => s.id + ':' + s.label).join('|');
    if (sig === navSig) return;
    navSig = sig;
    const group = (title, list) => list.length ? `<div class="sec">${title}</div>` + list.map(s =>
        `<div class="item" data-sec="${E(s.id)}">${fc.ui.icon(s.icon)}<span>${ET(s.label)}</span></div>`).join('') : '';
    m.querySelector('.fcordNav').innerHTML = group(ET('Fightcord settings'), secs.filter(s => s.order < APP_FROM)) + '<div class="sep"></div>' + group(ET('App'), secs.filter(s => s.order >= APP_FROM));
    const content = m.querySelector('.fcordContent');
    secs.forEach(s => {
        if (content.querySelector(':scope > .fcordPane[data-sec="' + s.id + '"]')) return;
        const p = document.createElement('div');
        p.className = 'fcordPane';
        p.setAttribute('data-sec', s.id);
        p.innerHTML = '<div class="fcordHead"></div>';
        content.appendChild(p);
        fc.settings.mount(p, s.id);
    });
}

function show(sec) {
    const m = ensureModal();
    current = sec || current;
    const search = m.querySelector('.fcordSearch input');
    if (search.value) { search.value = ''; }
    m.querySelectorAll('.fcordNav .item').forEach(i => i.classList.toggle('on', i.dataset.sec === current));
    m.querySelectorAll('.fcordPane').forEach(p => {
        const on = p.dataset.sec === current;
        p.classList.toggle('on', on);
        if (on) {
            p.querySelector('.fcordHead').innerHTML = paneHtml(current);
            fc.settings.mount(p, current);
            const empty = !p.querySelector('.fcBlock') && !BUILTIN.some(b => b[0] === current && ['home', 'rpc', 'updates', 'backup', 'diagnostics', 'about'].includes(b[0]));
            let em = p.querySelector(':scope > .fc-empty');
            if (empty && !em) p.insertAdjacentHTML('beforeend', fc.ui.empty({ icon: 'gear', title: 'Nothing to set here', sub: 'The modules for this section are switched off (My Fightcord → Modules).' }));
            else if (!empty && em) em.remove();
        }
    });
    m.querySelector('.fcordContent').scrollTop = 0;
}

let unlayer = null;
function open(sec) {
    const m = ensureModal();
    show(sec || 'home');
    m.classList.add('open');
    if (!unlayer) unlayer = pushEsc();
}
function close() {
    const m = document.getElementById('fcordModal');
    if (m) m.classList.remove('open');
    if (unlayer) { unlayer(); unlayer = null; }
}
const isOpen = () => { const m = document.getElementById('fcordModal'); return !!(m && m.classList.contains('open')); };

// Esc closes it (keyup: Fightcade swallows Escape on keydown), unless a popup is on top
function pushEsc() {
    const h = (e) => {
        if (e.key !== 'Escape' || !isOpen()) return;
        if (document.querySelector('.fc-mask, .fc-pop')) return;          // the popup closes first
        close();
    };
    window.addEventListener('keyup', h, true);
    return () => window.removeEventListener('keyup', h, true);
}

function note(key, text) {
    document.querySelectorAll(`#fcordModal [data-note="${key}"]`).forEach(n => { n.textContent = text; });
}

/* ------------------------------------------------------------------- search */

// every setting row and block title, across all sections
function runSearch(q) {
    const m = ensureModal();
    const res = m.querySelector('.fcordResults');
    q = String(q || '').trim().toLowerCase();
    if (!q) { show(current); return; }
    const words = q.split(/\s+/);
    const secs = fc.settings.sections();
    const hits = [];
    secs.forEach(s => {
        const pane = m.querySelector('.fcordPane[data-sec="' + s.id + '"]');
        if (!pane) return;
        if (!pane.querySelector('.fcBlock')) fc.settings.mount(pane, s.id);
        // the built-in heads too (they're drawn when shown): draw them once, off-screen
        const head = pane.querySelector('.fcordHead');
        if (head && !head.innerHTML) head.innerHTML = paneHtml(s.id);
        pane.querySelectorAll('.fc-field, .fc-set-title, h2, h3, .fcordProfile').forEach(el => {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            const low = (text + ' ' + T(s.label) + ' ' + s.label).toLowerCase();
            if (text && words.every(w => low.indexOf(w) >= 0)) hits.push({ s, el, text });
        });
    });
    m.querySelectorAll('.fcordPane').forEach(p => p.classList.toggle('on', p === res));
    m.querySelectorAll('.fcordNav .item').forEach(i => i.classList.remove('on'));
    res.__hits = hits;
    res.innerHTML = `<h2>${ET('Search')}</h2>` + (hits.length ? hits.slice(0, 60).map((h, i) =>
        `<div class="fcordHit" data-hit="${i}">${fc.ui.icon(h.s.icon)}<span class="where">${ET(h.s.label)}</span><span class="what">${E(h.text.slice(0, 120))}</span></div>`).join('')
        : fc.ui.empty({ icon: 'search', title: T('No settings match “{q}”', { q }) }));
}

function goToHit(h) {
    show(h.s.id);
    setTimeout(() => {
        if (!h.el.isConnected) return;
        h.el.scrollIntoView({ block: 'center' });
        h.el.classList.add('fcordFlash');
        setTimeout(() => h.el.classList.remove('fcordFlash'), 1400);
    }, 30);
}

/* ------------------------------------------------------------------ actions */

function onModalClick(e) {
    e.stopPropagation();
    if (e.target.closest('.fcordClose')) { close(); return; }
    const item = e.target.closest('.fcordNav .item');
    if (item) { show(item.dataset.sec); return; }
    const hit = e.target.closest('[data-hit]');
    if (hit) { const res = document.querySelector('#fcordModal .fcordResults'); goToHit(res.__hits[+hit.dataset.hit]); return; }
    const prof = e.target.closest('[data-profile]');
    if (prof) { setProfile(prof.dataset.profile); return; }
    const a = e.target.closest('[data-act]');
    const act = a && a.getAttribute('data-act');
    if (act === 'restart') restartFightcade();
    else if (act === 'check') checkUpdates(true);
    else if (act === 'install') checkUpdates('install');
    else if (act === 'repo') openExternal('https://github.com/' + REPO);
    else if (act === 'folder') openExternal(DIR);
    else if (act === 'backup') backup();
    else if (act === 'restore') document.querySelector('#fcordModal .fcordRestoreFile').click();
    else if (act === 'copydiag') note('diag', T(fc.ui.copy(fc.diagText()) ? 'Copied — paste it in a bug report.' : 'Couldn’t copy.'));
}

function onModalChange(e) {
    const t = e.target;
    if (t.dataset.man === 'disabled') { const m = manifest(); m.disabled = !t.checked; writeJson(MANIFEST, m); }
    else if (t.dataset.man === 'splash') { const m = manifest(); m.splash = t.checked; writeJson(MANIFEST, m); }
    else if (t.dataset.man === 'safeMode') { const m = manifest(); if (t.checked) m.safeMode = true; else delete m.safeMode; writeJson(MANIFEST, m); }
    else if (t.dataset.core) { const st = fc.config('fightcord-core'); st.data[t.dataset.core] = t.checked; st.save(); }
    else if (t.dataset.plugin) {
        const m = manifest();
        const off = new Set(m.off || []);
        if (t.checked) off.delete(t.dataset.plugin); else off.add(t.dataset.plugin);
        m.off = [...off];
        writeJson(MANIFEST, m);
        note('restart', T('Restart Fightcade to apply.'));
        refreshProfiles();
    } else if (t.dataset.rpc) {
        const c = readJson(RPC_CONFIG, {});
        c[t.dataset.rpc] = t.checked;
        writeJson(RPC_CONFIG, c);
    } else if (t.dataset.state) {
        state[t.dataset.state] = t.checked;
        saveState();
    } else if (t.classList.contains('fcordRestoreFile')) restore(t);
}

// which modules run from the next start (true when written)
function applyProfile(k) {
    const p = PROFILES[k];
    if (!p) return false;
    const m = manifest();
    m.off = p.off.slice();
    return writeJson(MANIFEST, m);
}

function setProfile(k) {
    const p = PROFILES[k];
    if (!p || !applyProfile(k)) return;
    show('home');
    note('restart', T('{name} profile set — restart Fightcade to apply.', { name: T(p.label) }));
}

function refreshProfiles() {
    const prof = currentProfile();
    document.querySelectorAll('#fcordModal .fcordProfile').forEach(el => el.classList.toggle('on', el.dataset.profile === prof));
}

function backup() {
    try {
        const data = fc.config.exportAll();
        const dir = path.join(require('os').homedir(), 'Documents', 'Fightcord');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'fightcord-settings-' + new Date().toISOString().slice(0, 10) + '.json');
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        note('backup', T('Saved {n} settings files to {file}', { n: Object.keys(data.files).length, file }));
        try { require('electron').shell.showItemInFolder(file); } catch (e) { /* harness */ }
    } catch (e) { note('backup', T('Couldn’t back up: {error}', { error: e.message })); }
}

function restore(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
        try {
            const n = fc.config.importAll(JSON.parse(String(rd.result)));
            note('backup', T('Restored {n} settings files. Restart Fightcade so every module picks them up.', { n }));
            fc.settings.refresh();
        } catch (e) { note('backup', T('That isn’t a Fightcord backup ({error}).', { error: e.message })); }
        input.value = '';
    };
    rd.readAsText(f);
}

function openExternal(target) {
    try { require('electron').shell[target.indexOf('http') === 0 ? 'openExternal' : 'openPath'](target); }
    catch (e) { LOG('could not open', target, e.message); }
}

// Relaunch the app -- never while an emulator (a match) is running
function restartFightcade(popup) {
    let busyGame = false;
    try {
        const out = require('child_process').execSync('tasklist /fo csv /nh', { timeout: 8000 }).toString().toLowerCase();
        busyGame = /fcadefbneo|flycast|ggpofba|fcadesnes|fcv39|duckstation/.test(out);
    } catch (e) { /* can't tell: be careful */ busyGame = false; }
    if (busyGame) {
        note('restart', T('A match is running — restart after it.'));
        if (popup) fc.ui.toast(T('A match is running — restart after it.'), { icon: 'refresh', kind: 'warning' });
        return;
    }
    fc.config.flush();
    try {
        const { remote } = require('electron');
        remote.app.relaunch();
        remote.app.exit(0);
    } catch (e) {
        note('restart', T('Close Fightcade from its tray icon (Quit) and open it again.'));
        if (popup) fc.ui.toast(T('Close Fightcade from its tray icon (Quit) and open it again.'), { icon: 'refresh' });
    }
}

/* ----------------------------------------------- Fightcade's settings page */

// Fightcade's own settings page gets a way into the Fightcord screen
function decorateFcSettings() {
    document.querySelectorAll('.settingsWrapper .frontendOptions').forEach(host => {
        if (host.querySelector('.fcordOpenBlock')) return;
        const div = document.createElement('div');
        div.className = 'option fcordOpenBlock';
        div.style.cssText = 'display:block;width:100%;';
        div.innerHTML = `<div class="fcordOpenRow"><div><b>${ET('Fightcord settings')}</b><span>${ET('Theme, chat, member list, search tab, match screens, challenges, music, Discord status, updates')}</span></div>
            ${fc.ui.btn('Open', { act: 'open' })}</div>`;
        div.addEventListener('click', (e) => { e.stopPropagation(); open(); });
        host.appendChild(div);
    });
}

/* ------------------------------------------------------------------ updates */

const UPD = () => fc.modules.get('updater');
const newer = (a, b) => { const u = UPD(); return u ? u.newer(a, b) : false; };
let busy = false;

// the release notes (Markdown from the changelog): bold, and "- " bullets
function notesHtml(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    let html = '', item = '';
    const flush = () => { if (item) html += '<li>' + E(item).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>') + '</li>'; item = ''; };
    lines.forEach(l => {
        if (/^\s*- /.test(l)) { flush(); item = l.replace(/^\s*- /, ''); }
        else if (l.trim()) item = item ? item + ' ' + l.trim() : l.trim();
        else flush();
    });
    flush();
    return html ? '<ul>' + html + '</ul>' : '';
}

async function checkUpdates(manual) {
    const u = UPD();
    if (busy || !u) return;
    busy = true;
    state.status = T('Checking…'); refreshUpdatesPane();
    const r = await u.run(DIR, { version: version(), force: manual === 'install',
        onStatus: (t, phase) => { if (phase === 'download') { state.status = T('Downloading {version}…', { version: r0(t) }); refreshUpdatesPane(); } } });
    const fresh = u.readState(DIR);
    state.lastCheck = fresh.lastCheck; state.latest = fresh.latest;
    if (r.installed) {
        state.ready = r.version;
        state.status = T('Fightcord {version} is installed — restart Fightcade to finish.', { version: r.version });
        fc.ui.toast(T('Fightcord {version} is ready', { version: r.version }), { icon: 'download', kind: 'success', ms: 20000,
            sub: T('Restart Fightcade to finish updating.'), actions: [{ label: T('Restart now'), kind: 'success', fn: () => restartFightcade(true) }, { label: T('What’s new'), fn: () => open('updates') }] });
    } else if (r.error) {
        state.status = r.available ? T('Update failed: {error}. Nothing was changed.', { error: r.error })
            : T('Couldn’t check for updates ({error}). It tries again tomorrow.', { error: r.error });
    } else if (r.available) {
        state.status = T('Fightcord {version} is available.', { version: r.latest.version });
    } else if (!state.ready) {
        state.status = r.latest ? T('Up to date.') : T('No release published yet — you have the newest Fightcord.');
    }
    busy = false;
    saveState();
    refreshUpdatesPane();
    refreshUpdateButton();
}
// "Updating Fightcord to 2.4.0…" -> "2.4.0"
const r0 = (t) => (String(t).match(/\d+\.\d+\.\d+/) || [''])[0];

// Discord's green "update ready" button, at the top of the bottom of the left rail
function refreshUpdateButton() {
    document.querySelectorAll('.mainToolbar .buttonBar').forEach(bar => {
        let b = bar.querySelector(':scope > .fcordUpd');
        if (!state.ready) { if (b) b.remove(); return; }
        if (!b) {
            b = document.createElement('div');
            b.className = 'fcordUpd';
            b.innerHTML = fc.ui.icon('download');
            b.addEventListener('mousedown', (e) => e.stopPropagation());
            b.addEventListener('click', (e) => { e.stopPropagation(); restartFightcade(true); });
            bar.insertBefore(b, bar.firstChild);
        }
        const t = T('Fightcord {version} is ready — click to restart Fightcade and finish updating', { version: state.ready });
        if (b.title !== t) b.title = t;
    });
}

function refreshUpdatesPane() {
    if (isOpen() && current === 'updates') show('updates');
}

/* -------------------------------------------------------------------- style */

const CSS = `
.mainToolbar .buttonBar > .fcordUpd { width: 40px; height: 40px; margin: 0 auto 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: #fff; background: var(--fc-success); box-shadow: 0 0 0 0 rgba(35,165,90,.6); animation: fcordUpdPulse 2s ease-out infinite; transition: border-radius .15s ease; }
.mainToolbar .buttonBar > .fcordUpd:hover { border-radius: 14px; }
.mainToolbar .buttonBar > .fcordUpd .fc-ic { width: 22px; height: 22px; }
@keyframes fcordUpdPulse { 0% { box-shadow: 0 0 0 0 rgba(35,165,90,.6); } 70%, 100% { box-shadow: 0 0 0 10px rgba(35,165,90,0); } }
.fcordNotes ul { margin: 0; padding-left: 20px; list-style: disc outside; white-space: normal; }
.fcordNotes li { margin-bottom: 8px; }
.fcordNotes code { padding: 0 4px; border-radius: 3px; background: var(--fc-s1); font-size: 13px; }
#fcordModal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: var(--fc-z-modal); display: flex; visibility: hidden; opacity: 0;
    transform: scale(1.04); transition: opacity .18s ease, transform .18s ease, visibility 0s linear .18s;
    background: var(--fc-s3); color: var(--fc-text); font: 16px/1.375 var(--fc-font); }
#fcordModal.open { visibility: visible; opacity: 1; transform: none; transition: opacity .18s ease, transform .18s ease; }
#fcordModal .fcordSide { flex: 1 0 218px; display: flex; justify-content: flex-end; background: var(--fc-s2); overflow-y: auto; }
#fcordModal .fcordSide nav { width: 218px; padding: 60px 6px 60px 20px; }
#fcordModal .fcordSearch { position: relative; margin: 0 0 12px; }
#fcordModal .fcordSearch .fc-ic { position: absolute; left: 8px; top: 7px; width: 16px; height: 16px; color: var(--fc-muted); }
#fcordModal .fcordSearch input { width: 100%; height: 30px; padding: 0 8px 0 30px; box-sizing: border-box; border: 0; border-radius: var(--fc-r1);
    background: var(--fc-s1); color: var(--fc-text); font: 14px var(--fc-font); outline: none; }
#fcordModal .fcordSearch input:focus { box-shadow: 0 0 0 2px var(--fc-accent); }
#fcordModal .fcordSide .sec { padding: 6px 10px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--fc-muted); }
#fcordModal .fcordSide .item { display: flex; align-items: center; margin-bottom: 2px; padding: 6px 10px; border-radius: var(--fc-r1); font-size: 15px; font-weight: 500;
    color: var(--fc-muted); cursor: pointer; transition: background-color var(--fc-fast), color var(--fc-fast); }
#fcordModal .fcordSide .item .fc-ic { width: 16px; height: 16px; margin-right: 10px; opacity: .8; }
#fcordModal .fcordSide .item:hover { background: var(--fc-hover); color: var(--fc-text); }
#fcordModal .fcordSide .item.on { background: var(--fc-s4); color: var(--fc-head); }
#fcordModal .fcordSide .sep { height: 1px; margin: 8px 10px; background: var(--fc-divider); }
#fcordModal .fcordSide .ver { padding: 6px 10px; font-size: 12px; color: var(--fc-muted); }
#fcordModal .fcordMain { flex: 1 1 800px; display: flex; min-width: 0; }
#fcordModal .fcordContent { flex: 1; max-width: 740px; min-width: 0; padding: 60px 40px 80px; overflow-y: auto; }
#fcordModal .fcordClose { flex: none; width: 36px; margin: 60px 20px 0 21px; display: flex; flex-direction: column; align-items: center; cursor: pointer; color: var(--fc-muted); }
#fcordModal .fcordClose .fc-ic { width: 36px; height: 36px; padding: 7px; box-sizing: border-box; border-radius: 50%; border: 2px solid currentColor; transition: color var(--fc-fast); }
#fcordModal .fcordClose:hover { color: var(--fc-head); }
#fcordModal .fcordClose small { margin-top: 8px; font-size: 13px; font-weight: 600; }
#fcordModal .fcordPane { display: none; }
#fcordModal .fcordPane.on { display: block; animation: fcRise .2s ease both; }
#fcordModal .fcordPane > .fcBlock { margin: 0 0 16px; padding: 16px; border-radius: var(--fc-r2); background: var(--fc-s2); box-shadow: inset 0 0 0 1px var(--fc-divider); }
#fcordModal h2 { margin: 0 0 20px; font-size: 20px; font-weight: 700; color: var(--fc-head); }
#fcordModal h3 { margin: 28px 0 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--fc-muted); }
#fcordModal h3 small { text-transform: none; font-weight: 500; }
#fcordModal .lead { margin: 0 0 16px; font-size: 14px; color: var(--fc-muted); }
#fcordModal .lead.small { font-size: 12px; margin-top: 24px; }
#fcordModal .fcordHero { display: flex; align-items: center; margin-bottom: 16px; padding: 16px; border-radius: var(--fc-r2);
    background: linear-gradient(120deg, rgba(79,99,240,.25), rgba(139,92,246,.12) 60%, transparent), var(--fc-s2); }
#fcordModal .fcordHero .logo { flex: none; width: 56px; height: 56px; margin-right: 16px; border-radius: 16px; display: flex; align-items: center;
    justify-content: center; background: var(--fc-brand); color: #fff; box-shadow: var(--fc-glow); }
#fcordModal .fcordHero .logo .fc-ic { width: 28px; height: 28px; }
#fcordModal .fcordHero b { display: block; font-size: 18px; color: var(--fc-head); }
#fcordModal .fcordHero span { font-size: 14px; color: var(--fc-muted); }
#fcordModal .fcordProfiles { display: flex; margin: 0 -6px; }
#fcordModal .fcordProfile { flex: 1; margin: 0 6px; padding: 14px; border-radius: var(--fc-r2); background: var(--fc-s2); cursor: pointer;
    box-shadow: inset 0 0 0 1px var(--fc-divider); transition: box-shadow var(--fc-fast), background-color var(--fc-fast); }
#fcordModal .fcordProfile:hover { background: var(--fc-s4); }
#fcordModal .fcordProfile.on { box-shadow: inset 0 0 0 2px var(--fc-accent); background: var(--fc-accent-soft); }
#fcordModal .fcordProfile .fc-ic { width: 22px; height: 22px; color: var(--fc-accent); }
#fcordModal .fcordProfile b { display: block; margin-top: 6px; font-size: 15px; color: var(--fc-head); }
#fcordModal .fcordProfile span { display: block; margin-top: 2px; font-size: 12px; line-height: 1.35; color: var(--fc-muted); }
#fcordModal .fc-field-text em.bad { font-style: normal; font-weight: 400; color: var(--fc-danger); font-size: 12px; }
#fcordModal .fcordBtns { display: flex; flex-wrap: wrap; align-items: center; margin: 16px 0 8px; }
#fcordModal .fcordBtns > .fc-btn { margin: 0 8px 8px 0; }
#fcordModal .fcordNote { font-size: 13px; color: var(--fc-warning); min-height: 18px; margin-bottom: 8px; }
#fcordModal .fcordNotes { white-space: normal; font-size: 14px; padding: 12px 16px; border-radius: var(--fc-r2); background: var(--fc-s2); }
#fcordModal .fcordTiles { display: flex; flex-wrap: wrap; margin: 0 -6px; }
#fcordModal .fcordTiles .fc-tile { flex: 1 1 140px; margin: 0 6px 12px; background: var(--fc-s2); }
#fcordModal .fcordMods { border-radius: var(--fc-r2); overflow: hidden; background: var(--fc-s2); }
#fcordModal .fcordMod { display: flex; align-items: center; padding: 7px 12px; font-size: 13px; border-top: 1px solid var(--fc-divider); }
#fcordModal .fcordMod:first-child { border-top: 0; }
#fcordModal .fcordMod i { flex: none; width: 8px; height: 8px; margin-right: 10px; border-radius: 50%; background: #80848e; }
#fcordModal .fcordMod.running i { background: var(--fc-success); }
#fcordModal .fcordMod.failed i { background: var(--fc-danger); }
#fcordModal .fcordMod b { flex: none; width: 210px; font-weight: 600; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcordModal .fcordMod span { flex: 1; min-width: 0; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcordModal .fcordLog { max-height: 220px; overflow: auto; margin: 0; padding: 10px 12px; border-radius: var(--fc-r2); background: var(--fc-s1);
    font: 12px/1.5 Consolas, monospace; color: var(--fc-text); white-space: pre-wrap; }
#fcordModal .fcordHit { display: flex; align-items: center; padding: 10px 12px; margin-bottom: 4px; border-radius: var(--fc-r2); cursor: pointer; background: var(--fc-s2); }
#fcordModal .fcordHit:hover { background: var(--fc-s4); }
#fcordModal .fcordHit .fc-ic { width: 16px; height: 16px; margin-right: 10px; color: var(--fc-muted); }
#fcordModal .fcordHit .where { flex: none; width: 180px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--fc-muted); }
#fcordModal .fcordHit .what { flex: 1; min-width: 0; font-size: 14px; color: var(--fc-head); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
#fcordModal .fcordFlash { animation: fcordFlash 1.4s ease; border-radius: var(--fc-r1); }
@keyframes fcordFlash { 0%, 40% { background: var(--fc-accent-soft); box-shadow: 0 0 0 4px var(--fc-accent-soft); } 100% { background: transparent; box-shadow: none; } }
.fcordOpenBlock .fcordOpenRow { display: flex; align-items: center; padding: 12px 14px; border-radius: var(--fc-r2); background: rgba(88,101,242,.12);
    border: 1px solid rgba(88,101,242,.35); cursor: pointer; }
.fcordOpenBlock .fcordOpenRow > div { flex: 1; min-width: 0; }
.fcordOpenBlock b { display: block; font-size: 15px; }
.fcordOpenBlock span { font-size: 12px; opacity: .7; }
.fcordOpenBlock .fc-btn { margin-left: 12px; }
`;

/* ------------------------------------------------------------------- module */

function onKeyDown(e) {
    // Ctrl+, opens the screen
    if (e.key === ',' && e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); if (isOpen()) close(); else open(); }
}

function start(f) {
    fc = f;
    state = Object.assign({ autoInstall: true, lastCheck: 0, latest: null, status: '', ready: '' }, readJson(STATE_PATH, {}));
    // already running the version that was waiting for a restart
    if (state.ready && !(UPD() && UPD().newer(state.ready, version()))) { state.ready = ''; state.status = T('Up to date.'); }
    const just = state.justUpdated;
    if (just) {
        delete state.justUpdated;
        state.status = T('Updated to Fightcord {version} when Fightcade started.', { version: just.version });
        if (Date.now() - (just.at || 0) < 10 * 60000) setTimeout(() => fc.ui.toast(T('Fightcord updated to {version}', { version: just.version }),
            { icon: 'download', kind: 'success', ms: 9000, sub: T('It updated itself while Fightcade started.'), actions: [{ label: T('What’s new'), fn: () => open('updates') }] }), 6000);
    }
    saveState();
    window.__fcordCoreLoaded = true;
    fc.ui.style('fcordStyle', CSS);
    BUILTIN.forEach(([id, label, icon, order]) => fc.settings.section(id, label, icon, order));
    // General: the core's own settings, on My Fightcord
    const core = fc.config('fightcord-core');
    fc.settings.block({
        id: 'core', section: 'home', title: 'General', store: core, order: 1, reset: false,
        fields: [
            { key: 'lang', type: 'select', label: 'Language', hint: 'Applies after a restart',
                options: [['auto', 'Automatic (Windows language)'], ['en', 'English'], ['pt', 'Português (Brasil)'], ['es', 'Español']],
                onChange: () => fc.ui.toast('Restart Fightcade to switch the language', { icon: 'globe', ms: 6000 }) },
            { key: 'animations', type: 'switch', label: 'Animations', hint: 'Off = no motion anywhere in Fightcord (and calmer Fightcade)' },
            { key: 'sfxVolume', type: 'slider', label: 'Sound effects', hint: 'Pings, the challenge ring, chimes', scale: 100, unit: '%', onChange: () => fc.sound.play('ping') }
        ]
    });
    ensureModal();
    window.addEventListener('keydown', onKeyDown, true);
    fc.own(() => {
        window.removeEventListener('keydown', onKeyDown, true);
        close();
        const m = document.getElementById('fcordModal');
        if (m) m.remove();
        fc.ui.style('fcordStyle', null);
        document.querySelectorAll('.fcordUpd').forEach(b => b.remove());
        window.__fcordCoreLoaded = false;
    });
    fc.cmd('fightcord', 'Open the Fightcord settings', () => open());
    fc.cmd('help', 'Fightcord: every chat command', () => {
        fc.ui.toast('Fightcord commands', { icon: 'info', ms: 15000, sub: fc.cmd.list().map(c => '/' + c.name + (c.args ? ' ' + c.args : '')).join(' · ') });
    });
    fc.watch(decorateFcSettings, { selector: '.settingsWrapper' });
    fc.watch(refreshUpdateButton, { selector: '.mainToolbar' });
    // the loader checked at startup; for long sessions, once a day after that
    fc.tick(() => { if (state.autoInstall && Date.now() - (state.lastCheck || 0) > 20 * 3600000) checkUpdates(false); }, 15 * 60000, { whileHidden: true });
    setTimeout(() => { if (Date.now() - (state.lastCheck || 0) > 20 * 3600000) checkUpdates(false); }, 20000);
    fc.log('settings ready - Fightcord ' + version());
    return api;
}

const api = {
    open: (sec) => open(sec),
    close: () => close(),
    version: () => version(),
    profiles: () => PROFILES,
    profile: () => currentProfile(),
    applyProfile: (k) => applyProfile(k),
    _notesHtml: (md) => notesHtml(md),
    _refreshUpdateButton: () => refreshUpdateButton(),
    _checkUpdates: (m) => checkUpdates(m),
    _state: () => state,
    _search: (q) => runSearch(q)
};

module.exports = { id: 'fightcord', name: 'Fightcord settings & updates', essential: true, start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
