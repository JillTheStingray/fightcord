/**
 * Fightcord loader
 *
 * Fightcade's desktop app (a nativefier build) runs exactly one file at startup:
 *   resources/app/inject/inject.js
 * This is that file. Once Fightcade's app is up it loads Fightcord's core
 * (fightcord-core.js) and then every module in  inject/fightcord/ , and the core starts
 * them in dependency order. Old-style plugins (module.exports = fn) still run as
 * require(file)(FCADE). Without a core (an older install) it falls back to that alone.
 *
 * Safe mode: hold Shift while Fightcade starts (or "safeMode": true in fightcord.json)
 * -> only the core and the settings screen run.
 *
 * inject/fightcord/fightcord.json:
 *   { "version": "1.0.0", "disabled": false, "off": ["snapshot.js"] }
 *   disabled -> load nothing (Fightcade runs plain); off -> skip single plugins.
 * Settings -> "Fightcord" has an on/off switch for the whole thing.
 *
 * Installed by FightcordSetup.exe. Uninstalling restores what was here before.
 */
/* Fightcord loader */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'fightcord');
const MANIFEST = path.join(DIR, 'fightcord.json');
const LOG = (...a) => console.log('[Fightcord]', ...a);

function readManifest() {
    try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { return {}; }
}

function writeManifest(m) {
    try { fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); } catch (e) { LOG('could not save fightcord.json', e.message); }
}

// Fightcade's Vue app, once its globals exist (plugins read them straight away)
function whenReady(cb) {
    const app = document.querySelector('#app');
    const vue = app && app.__vue__;
    if (vue && vue._data && vue._data.global && vue._data.global.setTheme) cb(vue);
    else setTimeout(() => whenReady(cb), 300);
}

const CORE_FILE = 'fightcord-core.js';

// Shift held while Fightcade starts -> safe mode (keydown repeats while it's held)
let shiftHeld = false;
function watchShift() {
    const on = (e) => { if (e.shiftKey || e.key === 'Shift') shiftHeld = true; };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
}

function loadPlugins(FCADE, manifest, safe) {
    const off = new Set(Array.isArray(manifest.off) ? manifest.off : []);
    let files = [];
    try {
        // i18n-*.js are the core's translations, not modules
        files = fs.readdirSync(DIR).filter(f => f.endsWith('.js') && f !== CORE_FILE && !/^i18n-/.test(f)).sort();
    } catch (e) {
        LOG('no plugin folder at', DIR);
        return;
    }
    let core = null;
    try { core = require(path.join(DIR, CORE_FILE)); } catch (e) { if (fs.existsSync(path.join(DIR, CORE_FILE))) console.error('[Fightcord] core failed to load:', e); }
    if (core && core.boot && core.fc && core.fc.modules) {
        const fc = core.boot(FCADE, { version: manifest.version, safe });
        for (const f of files) {
            if (off.has(f)) { fc.modules.register(f, null).state = 'off'; continue; }
            try { fc.modules.register(f, require(path.join(DIR, f))); } catch (e) { fc.modules.failed(f, e); }
        }
        const list = fc.modules.startAll({ off: [...off] });
        LOG('v' + (manifest.version || '?') + (safe ? ' SAFE MODE' : '') + ' running ' + list.filter(m => m.state === 'running').map(m => m.id).join(', '));
        const bad = list.filter(m => m.state === 'failed');
        if (bad.length) LOG('could not start: ' + bad.map(m => m.id + ' (' + (m.error || '').split(/\r?\n/)[0] + ')').join(', '));
        return;
    }
    files = files.filter(f => !off.has(f));
    const ok = [];
    for (const f of files) {
        try {
            require(path.join(DIR, f))(FCADE);
            ok.push(f);
        } catch (e) {
            console.error('[Fightcord] ' + f + ' failed to load:', e);
        }
    }
    LOG('v' + (manifest.version || '?') + ' loaded ' + ok.join(', '));
}

// "Fightcord" block at the end of Fightcade's own settings list: version and an
// off switch. Shown even while switched off, so it can be switched back on.
function settingsSwitch(manifest) {
    const place = () => {
        const host = document.querySelector('.frontendOptions');
        if (!host || host.querySelector('.fcordBlock')) return;
        const row = host.querySelector('.option');
        const dv = row && Array.from(row.attributes).find(a => a.name.startsWith('data-v-'));
        const div = document.createElement('div');
        div.className = 'option fcordBlock';
        if (dv) div.setAttribute(dv.name, '');
        div.style.cssText = 'display:block;width:100%;';
        div.innerHTML =
            '<div' + (dv ? ' ' + dv.name + '=""' : '') + ' class="title">Fightcord ' +
            '<span style="opacity:.55;font-size:11px;font-weight:normal;">v' + (manifest.version || '?') + '</span></div>' +
            '<label style="display:flex;align-items:center;margin-top:8px;cursor:pointer;font-size:13px;">' +
            '<input type="checkbox" class="fcord_on" ' + (manifest.disabled ? '' : 'checked') + ' style="flex:none;margin:0 8px 0 0;">' +
            '<span>Fightcord on<span style="opacity:.5;font-size:11px;"> off = plain Fightcade, after a restart</span></span></label>';
        div.addEventListener('click', (e) => e.stopPropagation());
        div.querySelector('.fcord_on').addEventListener('change', (e) => {
            const m = readManifest();
            m.disabled = !e.target.checked;
            writeManifest(m);
        });
        host.appendChild(div);
    };
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
    place();
}

// FightCord splash: from page load until Fightcade has logged in (or shows its login
// screen). Plain DOM -- it runs before Fightcade's app exists. Click to skip.
function splash(manifest) {
    if (manifest.splash === false || !document.body) return;
    let art = '';
    try { art = require(path.join(DIR, 'splash-art.js')).ART || ''; } catch (e) { /* no art: the name instead */ }
    const st = document.createElement('style');
    st.id = 'fcordSplashStyle';
    st.textContent = `
#fcordSplash { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2147483646; overflow: hidden; cursor: pointer;
    display: flex; align-items: center; justify-content: center; background: #0a0c1a;
    font-family: 'gg sans', 'Noto Sans', 'Segoe UI', sans-serif; transition: opacity .5s ease, transform .5s ease; }
#fcordSplash.out { opacity: 0; transform: scale(1.04); pointer-events: none; }
#fcordSplash .g { position: absolute; width: 70vmax; height: 70vmax; border-radius: 50%; filter: blur(60px); opacity: .55; }
#fcordSplash .g1 { left: -20vmax; top: -25vmax; background: radial-gradient(circle, #4f63f0 0, transparent 65%); animation: fcsd1 9s ease-in-out infinite alternate; }
#fcordSplash .g2 { right: -25vmax; bottom: -30vmax; background: radial-gradient(circle, #8b5cf6 0, transparent 65%); animation: fcsd2 11s ease-in-out infinite alternate; }
#fcordSplash .g3 { right: -10vmax; top: -30vmax; width: 50vmax; height: 50vmax; background: radial-gradient(circle, #22e3f2 0, transparent 65%); opacity: .3; animation: fcsd1 13s ease-in-out infinite alternate-reverse; }
@keyframes fcsd1 { from { transform: translate(0, 0); } to { transform: translate(8vmax, 6vmax); } }
@keyframes fcsd2 { from { transform: translate(0, 0); } to { transform: translate(-7vmax, -5vmax); } }
#fcordSplash .c { position: relative; display: flex; flex-direction: column; align-items: center; }
#fcordSplash img { width: 300px; height: 300px; animation: fcsdFloat 3.2s ease-in-out infinite, fcsdGlow 2.4s ease-in-out infinite; }
@keyframes fcsdFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@keyframes fcsdGlow { 0%, 100% { filter: drop-shadow(0 0 18px rgba(79,99,240,.55)); } 50% { filter: drop-shadow(0 0 34px rgba(34,227,242,.6)); } }
#fcordSplash .t { font-size: 64px; font-weight: 900; color: #4f63f0; text-shadow: 0 0 30px rgba(79,99,240,.7); }
#fcordSplash .bar { position: relative; width: 240px; height: 4px; margin-top: 18px; border-radius: 2px; overflow: hidden; background: rgba(255,255,255,.1); }
#fcordSplash .bar i { position: absolute; top: 0; bottom: 0; width: 40%; border-radius: 2px;
    background: linear-gradient(90deg, transparent, #22e3f2, #4f63f0, #8b5cf6, transparent); animation: fcsdBar 1.3s ease-in-out infinite; }
@keyframes fcsdBar { from { left: -40%; } to { left: 100%; } }
#fcordSplash .msg { margin-top: 14px; font-size: 14px; font-weight: 600; letter-spacing: .04em; color: #a9b0dc; }
#fcordSplash .v { position: absolute; bottom: 18px; right: 22px; font-size: 12px; color: rgba(169,176,220,.45); }
#fcordSplash .sm { position: absolute; bottom: 18px; left: 22px; font-size: 12px; color: rgba(169,176,220,.3); }`;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.id = 'fcordSplash';
    el.title = 'Click to skip';
    el.innerHTML = '<div class="g g1"></div><div class="g g2"></div><div class="g g3"></div><div class="c">' +
        (art ? '<img src="' + art + '" alt="">' : '<div class="t">FightCord</div>') +
        '<div class="bar"><i></i></div><div class="msg">Starting Fightcade\u2026</div></div>' +
        '<div class="v">Fightcord v' + String(manifest.version || '').replace(/[^0-9.]/g, '') + '</div>' +
        '<div class="sm">Hold Shift for safe mode</div>';
    document.body.appendChild(el);
    const t0 = Date.now();
    const msg = el.querySelector('.msg');
    let done = false, timer = 0;
    const finish = () => {
        if (done) return;
        done = true;
        clearInterval(timer);
        el.classList.add('out');
        setTimeout(() => { el.remove(); st.remove(); }, 600);
    };
    el.addEventListener('click', finish);
    timer = setInterval(() => {
        const v = document.querySelector('#app') && document.querySelector('#app').__vue__;
        let text = 'Starting Fightcade\u2026', ready = false;
        if (v && v._data) {
            if (v.autoLoginning) text = 'Logging in\u2026';
            else if (v.initializingApp) text = 'Loading your channels\u2026';
            else { text = 'Ready'; ready = true; }
        }
        if (msg.textContent !== text) msg.textContent = text;
        if ((ready && Date.now() - t0 > 800) || Date.now() - t0 > (window.__fcordSplashMax || 30000)) finish();
    }, 150);
}

(function init() {
    const manifest = readManifest();
    settingsSwitch(manifest);
    if (manifest.disabled) {
        LOG('switched off in settings - Fightcade runs without plugins');
        return;
    }
    const unwatch = watchShift();
    splash(manifest);
    whenReady((FCADE) => {
        unwatch();
        loadPlugins(FCADE, manifest, shiftHeld || manifest.safeMode === true);
    });
})();
