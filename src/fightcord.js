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
 * Updates: GitHub Releases of JillTheStingray/fightcord. latest.json names the new version, a
 * zip of the plugin files and its sha256. The zip is checked, unpacked into .update\ first,
 * then moved into place; it applies on the next start of Fightcade. Only this one URL, only
 * .js files, only inside Fightcord's own folder.
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
const LATEST_URL = 'https://github.com/' + REPO + '/releases/latest/download/latest.json';
const E = (s) => fc.fmt.esc(s);
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
    ['home', 'My Fightcord', 'home', 0], ['appearance', 'Appearance', 'palette', 10], ['chat', 'Chat', 'chat', 20],
    ['members', 'Member list & friends', 'users', 30], ['search', 'Search tab', 'search', 40],
    ['challenges', 'Scout & challenges', 'sword', 50], ['match', 'Match screens', 'trophy', 60], ['music', 'Music', 'music', 70],
    ['rpc', 'Discord status', 'link', 80],
    ['updates', 'Updates', 'download', 900], ['backup', 'Backup & restore', 'copy', 910], ['diagnostics', 'Diagnostics', 'bug', 920], ['about', 'About', 'info', 930]
];
const APP_FROM = 900;

const PLUGINS = [
    ['discord-theme.js', 'Discord theme'], ['branding.js', 'FightCord logo'], ['discover.js', 'Search tab (Discover)'], ['chat-extras.js', 'Chat extras'],
    ['translate.js', 'Translator'], ['emoji.js', ':emoji: shortcodes'], ['fontstyle.js', 'Chat font styles'],
    ['member-list.js', 'Member list'], ['scout.js', 'Scout card, ELO & odds'], ['challenge-filters.js', 'Challenge filters'],
    ['match-screens.js', 'Match screens & session tracker'], ['stats.js', 'Stats, head-to-head & share card'],
    ['analytics.js', 'Match analytics'], ['progress.js', 'Rank & ELO history'], ['goals.js', 'Training goals'], ['feed.js', 'Lobby feed'], ['welcome.js', 'Welcome screen & tour'], ['events.js', 'Event reminders'], ['friends.js', 'Friends'], ['notes.js', 'Player notes & tags'],
    ['challenge-card.js', 'Challenge card'], ['channel-banner.js', 'Channel banner'], ['hover-cards.js', 'Member hover cards'],
    ['profile-card.js', 'Profile popout'], ['context-menu.js', 'Right-click menu'], ['inbox.js', 'Notification inbox'], ['backgrounds.js', 'Animated backgrounds'], ['music.js', 'Background music'], ['discord-rpc.js', 'Discord status'],
    ['snapshot.js', 'Snapshot tool (dev)']
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
        return `<h2>My Fightcord</h2>
            ${hero('Discord-style Fightcade · ' + running + ' modules running' + (fc.safeMode ? ' · SAFE MODE' : ''))}
            <div class="fc-set">${toggle('Fightcord on', 'Off = plain Fightcade after a restart', !m.disabled, 'data-man="disabled"')}
            ${toggle('Startup splash screen', 'The FightCord logo while Fightcade logs in', m.splash !== false, 'data-man="splash"')}</div>
            <h3>Profile <small>— which modules run; applies after a restart</small></h3>
            <div class="fcordProfiles">${Object.keys(PROFILES).map(k => `<div class="fcordProfile${prof === k ? ' on' : ''}" data-profile="${k}">
                ${fc.ui.icon(PROFILES[k].icon)}<b>${PROFILES[k].label}</b><span>${E(PROFILES[k].desc)}</span></div>`).join('')}</div>
            <h3>Modules <small>— ${prof ? PROFILES[prof].label + ' profile' : 'your own mix'}</small></h3>
            <div class="fc-set">${PLUGINS.filter(([f]) => fs.existsSync(path.join(DIR, f))).map(([f, label]) => {
                const mod = fc.modules.list().find(x => x.file === f);
                const why = mod && mod.state === 'failed' ? ' — couldn’t start: ' + (mod.error || '').split('\n')[0] : '';
                return toggle(E(label) + (why ? ' <em class="bad">' + E(why) + '</em>' : ''), f, !off.has(f), `data-plugin="${E(f)}"`);
            }).join('')}</div>
            <div class="fcordBtns">${fc.ui.btn('Restart Fightcade', { kind: 'sec', icon: 'refresh', act: 'restart' })}<span class="fcordNote" data-note="restart"></span></div>`;
    }
    if (id === 'rpc') {
        const c = Object.assign({ showScore: true, showRanks: true, showNames: true, showSession: true, debug: false }, readJson(RPC_CONFIG, {}));
        return `<h2>Discord status</h2>
            <p class="lead">What your Discord profile shows while you're on Fightcade. Changes apply after a restart.</p>
            <div class="fc-set">${toggle('Show the score', 'The set score during a match', c.showScore, 'data-rpc="showScore"')}
            ${toggle('Show ranks', 'Your rank and your opponent’s', c.showRanks, 'data-rpc="showRanks"')}
            ${toggle('Show opponent names', '"vs KenjiRival"', c.showNames, 'data-rpc="showNames"')}
            ${toggle('Tonight’s record', '"· 7–3 tonight" from the session tracker', c.showSession, 'data-rpc="showSession"')}
            ${toggle('Debug log', 'Writes discord-rpc-debug.log — leave off unless something is wrong', c.debug, 'data-rpc="debug"')}</div>`;
    }
    if (id === 'updates') {
        const L = state.latest;
        return `<h2>Updates</h2>
            ${hero(E(state.ready ? 'Fightcord ' + state.ready + ' is installed — restart Fightcade to finish' : state.status || (state.lastCheck ? 'Checked ' + new Date(state.lastCheck).toLocaleString() : 'Not checked yet')))}
            <div class="fcordBtns">${fc.ui.btn('Check for updates', { icon: 'refresh', act: 'check' })}
                ${L && newer(L.version, version()) && !state.ready ? fc.ui.btn('Install ' + L.version, { kind: 'success', icon: 'download', act: 'install' }) : ''}
                ${state.ready ? fc.ui.btn('Restart Fightcade', { kind: 'sec', icon: 'refresh', act: 'restart' }) : ''}</div>
            <div class="fc-set">${toggle('Install updates automatically', 'Checks once a day; applies on the next start', state.autoInstall, 'data-state="autoInstall"')}</div>
            ${L && L.notes ? `<h3>What's new in ${E(L.version)}</h3><div class="fcordNotes">${E(L.notes)}</div>` : ''}
            <p class="lead small">From github.com/${REPO} (Releases). Plugin files only; a new installer is only needed if its dependencies change.</p>`;
    }
    if (id === 'backup') {
        return `<h2>Backup & restore</h2>
            <p class="lead">Every Fightcord setting in one file: theme, friends, notes, filters, member list, music choice…
            (Not the match history or your music files — those stay in the Fightcord folder.)</p>
            <div class="fcordBtns">${fc.ui.btn('Back up my settings', { icon: 'download', act: 'backup' })}
                ${fc.ui.btn('Restore from a file…', { kind: 'sec', icon: 'refresh', act: 'restore' })}
                <input type="file" class="fcordRestoreFile" accept=".json,application/json" style="display:none"></div>
            <div class="fcordNote" data-note="backup"></div>`;
    }
    if (id === 'diagnostics') return diagnosticsHtml();
    if (id === 'about') {
        return `<h2>About</h2>
            <p class="lead">Fightcord turns Fightcade into something that looks and works like Discord: the theme, chat, member list,
            search tab, match screens, stats and your Discord status. Fightcord isn’t made by or affiliated with Fightcade or Discord.</p>
            <div class="fcordBtns">${fc.ui.btn('GitHub page', { kind: 'sec', icon: 'link', act: 'repo' })}${fc.ui.btn('Open Fightcord folder', { kind: 'sec', icon: 'copy', act: 'folder' })}</div>
            <p class="lead small">Settings, match history and sounds are kept in the Fightcord folder. The installer keeps your previous setup
            (Cerberus) in fightcord-backup next to it; FightcordSetup.exe → Uninstall can put it back.</p>`;
    }
    const sec = fc.settings.sections().find(s => s.id === id);
    return `<h2>${E(sec ? sec.label : id)}</h2>`;
}

function diagnosticsHtml() {
    const d = fc.diag();
    const mods = d.modules;
    const running = mods.filter(m => m.state === 'running').length, failed = mods.filter(m => m.state === 'failed');
    const missing = Object.keys(d.anchors).filter(k => !d.anchors[k]);
    const cfg = fc.config('fightcord-core').data;
    return `<h2>Diagnostics</h2>
        <div class="fcordTiles">${fc.ui.tile(running + '/' + mods.length, 'modules running', { trend: failed.length ? 'down' : '' })}
            ${fc.ui.tile(String(d.tick.jobs), 'timers (one base loop)')}${fc.ui.tile(String(d.watch.watchers), 'page watchers (one observer)')}
            ${fc.ui.tile(d.api.requests + ' / ' + d.api.cached, 'API requests / from cache', { sub: d.api.errors ? d.api.errors + ' errors' : '' })}</div>
        ${d.safeMode ? '<div class="fc-note">Safe mode: only the settings are running. Restart Fightcade to start normally.</div>' : ''}
        <h3>Modules</h3>
        <div class="fcordMods">${mods.map(m => `<div class="fcordMod ${m.state}"><i></i><b>${E(m.name || m.id)}</b>` +
            `<span>${E(m.state)}${m.legacy ? ' · old-style plugin' : ''}${m.error ? ' — ' + E(m.error.split('\n')[0]) : ''}</span></div>`).join('')}</div>
        <h3>Fightcade</h3>
        <div class="fc-note">${missing.length ? 'Not found (a Fightcade update may have changed these): ' + E(missing.join(', ')) : 'Everything Fightcord hooks into is where it should be.'}</div>
        <h3>Recent problems</h3>
        <pre class="fcordLog">${E(d.errors.length ? d.errors.map(e => new Date(e.at).toLocaleTimeString() + ' ' + e.level + ' [' + e.scope + '] ' + e.text.split('\n')[0]).join('\n') : 'None — all quiet.')}</pre>
        <div class="fcordBtns">${fc.ui.btn('Copy debug info', { icon: 'copy', act: 'copydiag' })}${fc.ui.btn('Open Fightcord folder', { kind: 'sec', act: 'folder' })}<span class="fcordNote" data-note="diag"></span></div>
        <div class="fc-set">${toggle('Debug log', 'Writes fightcord-debug.log next to the plugins — for bug reports', !!cfg.debugLog, 'data-core="debugLog"')}
        ${toggle('Safe mode on the next start', 'Only the settings run (you can also hold Shift while Fightcade starts)', manifest().safeMode === true, 'data-man="safeMode"')}</div>`;
}

/* -------------------------------------------------------------------- modal */

let navSig = '';

function ensureModal() {
    let m = document.getElementById('fcordModal');
    if (m) { syncNav(m); return m; }
    m = document.createElement('div');
    m.id = 'fcordModal';
    m.innerHTML = `<div class="fcordSide"><nav>
            <div class="fcordSearch">${fc.ui.icon('search')}<input type="text" placeholder="Search settings" spellcheck="false"></div>
            <div class="fcordNav"></div>
            <div class="sep"></div><div class="ver">Fightcord ${E(version())}</div></nav></div>
        <div class="fcordMain"><div class="fcordContent"><div class="fcordPane fcordResults" data-results="1"></div></div>
            <div class="fcordClose" title="Close (Esc)">${fc.ui.icon('close')}<small>ESC</small></div></div>`;
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
        `<div class="item" data-sec="${E(s.id)}">${fc.ui.icon(s.icon)}<span>${E(s.label)}</span></div>`).join('') : '';
    m.querySelector('.fcordNav').innerHTML = group('Fightcord settings', secs.filter(s => s.order < APP_FROM)) + '<div class="sep"></div>' + group('App', secs.filter(s => s.order >= APP_FROM));
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
            const low = (text + ' ' + s.label).toLowerCase();
            if (text && words.every(w => low.indexOf(w) >= 0)) hits.push({ s, el, text });
        });
    });
    m.querySelectorAll('.fcordPane').forEach(p => p.classList.toggle('on', p === res));
    m.querySelectorAll('.fcordNav .item').forEach(i => i.classList.remove('on'));
    res.__hits = hits;
    res.innerHTML = `<h2>Search</h2>` + (hits.length ? hits.slice(0, 60).map((h, i) =>
        `<div class="fcordHit" data-hit="${i}">${fc.ui.icon(h.s.icon)}<span class="where">${E(h.s.label)}</span><span class="what">${E(h.text.slice(0, 120))}</span></div>`).join('')
        : fc.ui.empty({ icon: 'search', title: 'No settings match “' + q + '”' }));
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
    else if (act === 'install') installUpdate(state.latest);
    else if (act === 'repo') openExternal('https://github.com/' + REPO);
    else if (act === 'folder') openExternal(DIR);
    else if (act === 'backup') backup();
    else if (act === 'restore') document.querySelector('#fcordModal .fcordRestoreFile').click();
    else if (act === 'copydiag') note('diag', fc.ui.copy(fc.diagText()) ? 'Copied — paste it in a bug report.' : 'Couldn’t copy.');
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
        note('restart', 'Restart Fightcade to apply.');
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
    note('restart', p.label + ' profile set — restart Fightcade to apply.');
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
        note('backup', 'Saved ' + Object.keys(data.files).length + ' settings files to ' + file);
        try { require('electron').shell.showItemInFolder(file); } catch (e) { /* harness */ }
    } catch (e) { note('backup', 'Couldn’t back up: ' + e.message); }
}

function restore(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
        try {
            const n = fc.config.importAll(JSON.parse(String(rd.result)));
            note('backup', 'Restored ' + n + ' settings files. Restart Fightcade so every module picks them up.');
            fc.settings.refresh();
        } catch (e) { note('backup', 'That isn’t a Fightcord backup (' + e.message + ').'); }
        input.value = '';
    };
    rd.readAsText(f);
}

function openExternal(target) {
    try { require('electron').shell[target.indexOf('http') === 0 ? 'openExternal' : 'openPath'](target); }
    catch (e) { LOG('could not open', target, e.message); }
}

// Relaunch the app -- never while an emulator (a match) is running
function restartFightcade() {
    let busyGame = false;
    try {
        const out = require('child_process').execSync('tasklist /fo csv /nh', { timeout: 8000 }).toString().toLowerCase();
        busyGame = /fcadefbneo|flycast|ggpofba|fcadesnes|fcv39|duckstation/.test(out);
    } catch (e) { /* can't tell: be careful */ busyGame = false; }
    if (busyGame) { note('restart', 'A match is running — restart after it.'); return; }
    fc.config.flush();
    try {
        const { remote } = require('electron');
        remote.app.relaunch();
        remote.app.exit(0);
    } catch (e) {
        note('restart', 'Close Fightcade from its tray icon (Quit) and open it again.');
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
        div.innerHTML = `<div class="fcordOpenRow"><div><b>Fightcord settings</b><span>Theme, chat, member list, search tab, match screens, challenges, music, Discord status, updates</span></div>
            ${fc.ui.btn('Open', { act: 'open' })}</div>`;
        div.addEventListener('click', (e) => { e.stopPropagation(); open(); });
        host.appendChild(div);
    });
}

/* ------------------------------------------------------------------ updates */

function newer(a, b) {
    const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
}

// GET with redirects (GitHub release downloads bounce to a CDN) -> Buffer
function httpGet(url, hops) {
    hops = hops || 0;
    return new Promise((resolve, reject) => {
        const mod = url.indexOf('http:') === 0 ? require('http') : require('https');
        const req = mod.get(url, { headers: { 'User-Agent': 'Fightcord', Accept: '*/*' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 6) {
                res.resume();
                resolve(httpGet(new URL(res.headers.location, url).href, hops + 1));
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.setTimeout(20000, () => req.destroy(new Error('timed out')));
        req.on('error', reject);
    });
}

// Minimal ZIP reader: central directory -> {name: Buffer}, stored + deflate entries
function unzip(buf) {
    const zlib = require('zlib');
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const out = {};
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
        const method = buf.readUInt16LE(p + 10);
        const csize = buf.readUInt32LE(p + 20);
        const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8').replace(/\\/g, '/');
        p += 46 + nlen + xlen + clen;
        if (name.endsWith('/')) continue;
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('bad zip entry');
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const data = buf.slice(start, start + csize);
        if (method === 0) out[name] = data;
        else if (method === 8) out[name] = zlib.inflateRawSync(data);
        else throw new Error('unsupported zip method ' + method);
    }
    return out;
}

// where a zip entry may go: fightcord/<file>.js -> this folder, inject.js -> the loader
function targetFor(name) {
    if (/^fightcord\/[a-z0-9_.-]+\.js$/i.test(name)) return path.join(DIR, name.slice('fightcord/'.length));
    if (name === 'inject.js') return path.join(DIR, '..', 'inject.js');
    return null;
}

let busy = false;

async function checkUpdates(manual) {
    if (busy) return;
    busy = true;
    state.status = 'Checking…'; refreshUpdatesPane();
    state.lastCheck = Date.now();          // one try a day, whatever the answer
    try {
        const latest = JSON.parse((await httpGet(LATEST_URL + '?t=' + Date.now())).toString('utf8'));
        state.latest = latest;
        if (newer(latest.version, version()) && !(state.ready && !newer(latest.version, state.ready))) {
            state.status = 'Fightcord ' + latest.version + ' is available.';
            busy = false;
            if (state.autoInstall || manual === 'install') await installUpdate(latest);
        } else {
            state.status = state.ready ? state.status : 'Up to date.';
        }
    } catch (e) {
        // 404 = no release on GitHub yet: nothing's wrong, there's just nothing to get
        state.status = /HTTP 404/.test(e.message) ? 'No release published yet — you have the newest Fightcord.'
            : 'Couldn’t check for updates (' + e.message + '). It tries again tomorrow.';
    }
    busy = false;
    saveState();
    refreshUpdatesPane();
}

async function installUpdate(latest) {
    if (busy || !latest || !latest.zip) return;
    busy = true;
    state.status = 'Downloading ' + latest.version + '…'; refreshUpdatesPane();
    try {
        const url = /^https:\/\//.test(latest.zip) ? latest.zip
            : 'https://github.com/' + REPO + '/releases/download/v' + latest.version + '/' + latest.zip;
        if (url.indexOf('https://github.com/' + REPO + '/') !== 0) throw new Error('unexpected download address');
        const buf = await httpGet(url);
        const hash = require('crypto').createHash('sha256').update(buf).digest('hex');
        if (!latest.sha256 || hash !== String(latest.sha256).toLowerCase()) throw new Error('download didn’t match its checksum');
        const files = unzip(buf);
        const plan = Object.keys(files).map(n => [n, targetFor(n)]).filter(([, t]) => t);
        if (!plan.length) throw new Error('nothing to install in the update');
        // stage everything first, then move into place
        const stage = path.join(DIR, '.update');
        if (fs.existsSync(stage)) fs.readdirSync(stage).forEach(f => fs.unlinkSync(path.join(stage, f)));
        else fs.mkdirSync(stage);
        plan.forEach(([n], i) => fs.writeFileSync(path.join(stage, i + '.part'), files[n]));
        plan.forEach(([n, t], i) => {
            if (n === 'inject.js' && !files[n].toString('utf8').includes('/* Fightcord loader */')) return;
            fs.renameSync(path.join(stage, i + '.part'), t);
        });
        fs.readdirSync(stage).forEach(f => fs.unlinkSync(path.join(stage, f)));
        const m = manifest();
        m.version = latest.version;
        writeJson(MANIFEST, m);
        state.ready = latest.version;
        state.status = 'Fightcord ' + latest.version + ' is installed — restart Fightcade to finish.';
        fc.ui.toast('Fightcord ' + latest.version + ' is ready', { icon: 'download', kind: 'success', ms: 12000,
            sub: 'Restart Fightcade to finish updating.', onClick: () => open('updates') });
    } catch (e) {
        state.status = 'Update failed: ' + e.message + '. Nothing was changed.';
    }
    busy = false;
    saveState();
    refreshUpdatesPane();
}

function refreshUpdatesPane() {
    if (isOpen() && current === 'updates') show('updates');
}

/* -------------------------------------------------------------------- style */

const CSS = `
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
#fcordModal .fcordNotes { white-space: pre-wrap; font-size: 14px; padding: 12px 16px; border-radius: var(--fc-r2); background: var(--fc-s2); }
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
    window.__fcordCoreLoaded = true;
    fc.ui.style('fcordStyle', CSS);
    BUILTIN.forEach(([id, label, icon, order]) => fc.settings.section(id, label, icon, order));
    // General: the core's own settings, on My Fightcord
    const core = fc.config('fightcord-core');
    fc.settings.block({
        id: 'core', section: 'home', title: 'General', store: core, order: 1, reset: false,
        fields: [
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
        window.__fcordCoreLoaded = false;
    });
    fc.cmd('fightcord', 'Open the Fightcord settings', () => open());
    fc.cmd('help', 'Fightcord: every chat command', () => {
        fc.ui.toast('Fightcord commands', { icon: 'info', ms: 15000, sub: fc.cmd.list().map(c => '/' + c.name + (c.args ? ' ' + c.args : '')).join(' · ') });
    });
    fc.watch(decorateFcSettings, { selector: '.settingsWrapper' });
    // once a day, a little after start
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
    _unzip: unzip,
    _newer: newer,
    _targetFor: targetFor,
    _checkUpdates: (m) => checkUpdates(m),
    _state: () => state,
    _search: (q) => runSearch(q)
};

module.exports = { id: 'fightcord', name: 'Fightcord settings & updates', essential: true, start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
