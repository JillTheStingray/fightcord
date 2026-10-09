/**
 * Fightcord background music
 *
 * Plays a track from  inject/fightcord/music/  on a loop while you're in the lobby, and fades
 * it out while you're in a match (back in when you return). It dips under the VS / result
 * screens. Pick, add or remove tracks under Fightcord settings → Music; /music in chat turns
 * it on or off.
 *
 * Any mp3 / ogg / wav / m4a works. Tracks are only ever on your own PC -- Fightcord doesn't
 * ship any music. What happens is in the core's log (Settings → Diagnostics).
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, config = null;          // music-config.json

const MUSIC_DIR = path.join(__dirname, 'music');
const EXT = /\.(mp3|ogg|wav|m4a|flac|webm)$/i;
const MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', webm: 'audio/webm' };
const FADE_MS = 1200;
const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const N_ = (s) => s;
const pretty = (f) => String(f || '').replace(EXT, '').replace(/[_]+/g, ' ').trim();

/* -------------------------------------------------------------------- files */

let trackCache = null, trackAt = 0;
function tracks(fresh) {
    if (fresh || !trackCache || Date.now() - trackAt > 10000) {
        try { trackCache = fs.readdirSync(MUSIC_DIR).filter(f => EXT.test(f)).sort((a, b) => a.localeCompare(b)); }
        catch (e) { trackCache = []; }
        trackAt = Date.now();
    }
    return trackCache.slice();
}

function currentTrack() {
    const list = tracks();
    return list.includes(config.track) ? config.track : (list[0] || '');
}

function addTrack(file) {
    // Electron gives picked files a real path; otherwise read the bytes
    try { fs.mkdirSync(MUSIC_DIR, { recursive: true }); } catch (e) { /* exists */ }
    const name = String(file.name || 'track.mp3').replace(/[\\/:*?"<>|]/g, '_');
    const dst = path.join(MUSIC_DIR, name);
    return new Promise((res, rej) => {
        if (file.path) { try { fs.copyFileSync(file.path, dst); tracks(true); res(name); } catch (e) { rej(e); } return; }
        const rd = new FileReader();
        rd.onload = () => { try { fs.writeFileSync(dst, Buffer.from(rd.result)); tracks(true); res(name); } catch (e) { rej(e); } };
        rd.onerror = () => rej(new Error(T('could not read the file')));
        rd.readAsArrayBuffer(file);
    });
}

function removeTrack(name) {
    try { fs.unlinkSync(path.join(MUSIC_DIR, name)); } catch (e) { fc.log.warn('remove failed', e.message); }
    tracks(true);
    if (config.track === name) { config.track = ''; store.save(); }
    if (loaded === name) unload();
}

/* ----------------------------------------------------------------- playback */

let audio = null, loaded = '', blobUrl = '';
let target = 0;              // volume we're fading towards
let fadeTimer = 0;
let waitingForGesture = false;
let ducked = false;          // the VS / result screens are up
const state = { playing: false, reason: '' };

// The music visualizer (backgrounds.js) listens through an AnalyserNode. Attached only when it
// asks, and only once the AudioContext runs: an <audio> routed through WebAudio is heard only
// while the context runs, so without a running context the music stays as it is.
let tap = null;              // { el, src, an }
function analyser() {
    if (!audio) return null;
    if (tap && tap.el === audio) return tap.an;
    const ctx = fc.sound.ctx();
    if (!ctx || ctx.state !== 'running') return null;
    try {
        const src = ctx.createMediaElementSource(audio);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        an.smoothingTimeConstant = 0.55;          // quick enough for the kick drum
        src.connect(an);
        an.connect(ctx.destination);
        dropTap();
        tap = { el: audio, src, an };
        fc.log('visualizer listening');
        return an;
    } catch (e) {
        fc.log.warn('visualizer tap failed', e.message);
        return null;
    }
}
function dropTap() {
    if (!tap) return;
    try { tap.src.disconnect(); tap.an.disconnect(); } catch (e) { /* gone */ }
    tap = null;
}

function unload() {
    dropTap();
    clearInterval(fadeTimer);
    fadeTimer = 0;
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    audio = null; loaded = ''; blobUrl = '';
    target = 0;
    state.playing = false;
}

// the page origin is https://web.fightcade.com, so file:// audio is blocked: play a Blob instead
function load(name) {
    if (loaded === name && audio) return audio;
    unload();
    if (!name) return null;
    try {
        const buf = fs.readFileSync(path.join(MUSIC_DIR, name));
        const ext = ((name.match(EXT) || [])[1] || 'mp3').toLowerCase();
        blobUrl = URL.createObjectURL(new Blob([buf], { type: MIME[ext] || 'audio/mpeg' }));
        audio = new Audio(blobUrl);
        audio.loop = true;
        audio.volume = 0;
        loaded = name;
        audio.addEventListener('error', () => {
            const err = audio && audio.error;
            fc.log.warn('audio error', { code: err && err.code, message: err && err.message, track: name });
            state.reason = T('Couldn’t play {name}', { name }) + (err ? ' (' + T('error {code}', { code: err.code }) + (err.message ? ': ' + err.message : '') + ')' : '');
            fc.settings.refresh('music');
        });
        audio.addEventListener('playing', () => fc.log('playing', name, 'at volume', audio && audio.volume.toFixed(2)));
        fc.log('loaded', { track: name, bytes: buf.length });
        return audio;
    } catch (e) {
        state.reason = T('Couldn’t read {name}', { name }) + ' (' + e.message + ')';
        fc.log.warn('read failed', e.message);
        return null;
    }
}

function fadeTo(vol, then) {
    clearInterval(fadeTimer);
    fadeTimer = 0;
    target = vol;
    if (!audio) return;
    const a = audio, start = a.volume, t0 = Date.now();
    fadeTimer = setInterval(() => {
        if (a !== audio) { clearInterval(fadeTimer); fadeTimer = 0; return; }
        const k = Math.min(1, (Date.now() - t0) / FADE_MS);
        a.volume = Math.max(0, Math.min(1, start + (vol - start) * k));
        if (k >= 1) { clearInterval(fadeTimer); fadeTimer = 0; if (then) then(); }
    }, 40);
}

// decide every second: should the music be playing, and how loud
let listSig = '', lastWhy = '';
function tick() {
    // a track added or removed outside the settings: redraw the list
    const sig = tracks().join('|');
    if (sig !== listSig) { listSig = sig; fc.settings.refresh('music'); }
    const name = currentTrack();
    const inMatch = fc.app.inMatch();
    const want = config.enabled && name && !(config.pauseInMatch && inMatch);
    const why = JSON.stringify({ want: !!want, enabled: config.enabled, track: name, inMatch });
    if (why !== lastWhy) { lastWhy = why; fc.log('decision', why); }
    const reason = !config.enabled ? T('Off') : !name ? T('No track — add one below') : (config.pauseInMatch && inMatch) ? T('Paused — you’re in a match') : '';
    if (reason !== state.reason && !waitingForGesture) { state.reason = reason; fc.settings.refresh('music'); }
    if (!want) {
        if (audio && !audio.paused && target !== 0) fadeTo(0, () => { if (audio) audio.pause(); state.playing = false; fc.settings.refresh('music'); });
        if (!config.enabled || !name) { if (audio && audio.paused) unload(); }
        return;
    }
    const a = load(name);
    if (!a) return;
    const vol = Math.max(0, Math.min(1, +config.volume || 0)) * (ducked ? 0.3 : 1);
    if (a.paused) {
        target = 0;
        a.play().then(() => { if (a !== audio) return; state.playing = true; waitingForGesture = false; fadeTo(vol); fc.settings.refresh('music'); })
            .catch((err) => {
                if (a !== audio) return;
                fc.log.warn('play() refused', { name: err && err.name, message: err && err.message });
                waitingForGesture = true;
                state.reason = T('Starts on your first click') + ' (' + ((err && err.name) || 'blocked') + ')';
                fc.settings.refresh('music');
            });
    } else if (Math.abs(target - vol) > 0.001 || (!fadeTimer && Math.abs(a.volume - vol) > 0.01)) fadeTo(vol);
}

function onGesture() {
    if (!waitingForGesture) return;
    waitingForGesture = false;
    tick();
}

// a short chime straight to the speakers: if you can't hear this, Fightcade itself is muted
// or on another output (Windows volume mixer), not the music
function testSound() {
    if (!fc.sound.tone([[660, 0, 0.35], [880, 0.18, 0.35]], { volume: 1 })) fc.log.warn('test sound: no audio output');
}

/* ----------------------------------------------------------------- settings */

function nowText() {
    const cur = currentTrack();
    return state.playing && audio && !audio.paused ? T('Now playing: {track}', { track: pretty(cur) }) : (state.reason || (cur ? T('Ready: {track}', { track: pretty(cur) }) : ''));
}

function listHtml() {
    const list = tracks(), cur = currentTrack();
    return list.length ? list.map(f => `<div class="muTrack${f === cur ? ' on' : ''}" data-track="${E(f)}">
            ${fc.ui.icon(f === cur ? 'music' : 'play', 'muIc')}<span class="muName" title="${E(f)}">${E(pretty(f))}</span>
            ${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'trash', title: 'Remove this track', cls: 'muX', attrs: `data-del="${E(f)}"` })}</div>`).join('')
        : `<div class="muEmpty">${E(T('No tracks yet. Add an mp3 / ogg / wav file of your own.'))}</div>`;
}

function render(el) {
    const sw = (key, label, hint) => `<label class="fc-field"><span class="fc-field-text"><b>${E(T(label))}</b>${hint ? `<small>${E(T(hint))}</small>` : ''}</span>` +
        `<input type="checkbox" class="fc-switch-in" data-opt="${key}"${config[key] ? ' checked' : ''}><i class="fc-switch"></i></label>`;
    el.innerHTML = `<div class="fc-set-title">${E(T('Background music'))} <small>— ${E(T('loops in the lobby · /music in chat'))}</small></div>
        ${sw('enabled', N_('Play background music'))}
        ${sw('pauseInMatch', N_('Pause during matches'), N_('Fades back in after'))}
        <div class="fc-field"><span class="fc-field-text"><b>${E(T('Volume'))}</b></span>
            <input type="range" class="fc-slider" data-vol="1" min="0" max="100" value="${Math.round(config.volume * 100)}"><span class="fc-slider-v">${Math.round(config.volume * 100)}%</span></div>
        <div class="muList">${listHtml()}</div>
        <div class="muBar">${fc.ui.btn('Add a track…', { kind: 'sec', size: 'sm', icon: 'plus', act: 'add' })}
            ${fc.ui.btn('Test sound', { kind: 'ghost', size: 'sm', icon: 'music', act: 'test', title: 'Plays a short chime' })}
            ${fc.ui.btn('Visualizer…', { kind: 'ghost', size: 'sm', icon: 'trend', act: 'viz', title: 'A visualizer behind the chat: Appearance → Animated background → Music visualizer' })}
            <input type="file" class="mu_file" accept="audio/*,.mp3,.ogg,.wav,.m4a,.flac" style="display:none"><span class="muNow">${E(nowText())}</span></div>
        <div class="fc-note">${E(T('Playing but can’t hear it? Open the Windows volume mixer (right-click the speaker icon) and check that Fightcade isn’t muted or turned down, and that it uses the right speakers / headset.'))}</div>`;
}

// patch, don't rebuild (the volume slider may be in your hand)
function refresh(el) {
    const now = el.querySelector('.muNow');
    if (now && now.textContent !== nowText()) now.textContent = nowText();
    const list = el.querySelector('.muList');
    const html = listHtml();
    if (list && list.__html !== html) { list.__html = html; list.innerHTML = html; }
    el.querySelectorAll('[data-opt]').forEach(i => { i.checked = !!config[i.dataset.opt]; });
}

function wire(el) {
    render(el);
    el.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.opt) { config[t.dataset.opt] = t.checked; store.save(); tick(); fc.settings.refresh('music'); }
        else if (t.dataset.vol) store.save();
        else if (t.classList.contains('mu_file')) {
            const f = t.files && t.files[0];
            if (!f) return;
            addTrack(f).then(name => {
                config.track = name;
                config.enabled = true;
                store.save();
                unload();
                tick();
                fc.settings.refresh('music');
            }).catch(err => { state.reason = T('Couldn’t add it: {error}', { error: err.message }); fc.settings.refresh('music'); });
        }
    });
    el.addEventListener('input', (e) => {
        if (!e.target.dataset.vol) return;
        config.volume = +e.target.value / 100;
        const out = e.target.parentNode.querySelector('.fc-slider-v');
        if (out) out.textContent = e.target.value + '%';
        if (audio && !audio.paused) { clearInterval(fadeTimer); fadeTimer = 0; audio.volume = config.volume; target = config.volume; }
    });
    el.addEventListener('click', (e) => {
        const del = e.target.closest('[data-del]');
        if (del) { e.stopPropagation(); removeTrack(del.dataset.del); tick(); fc.settings.refresh('music'); return; }
        const a = e.target.closest('[data-act]');
        if (a && a.getAttribute('data-act') === 'add') { el.querySelector('.mu_file').click(); return; }
        if (a && a.getAttribute('data-act') === 'test') { testSound(); return; }
        if (a && a.getAttribute('data-act') === 'viz') { const s = fc.modules.get('fightcord'); if (s && s.open) s.open('appearance'); return; }
        const t = e.target.closest('.muTrack');
        if (t) {
            config.track = t.dataset.track;
            config.enabled = true;
            store.save();
            unload();
            tick();
            fc.settings.refresh('music');
        }
    });
}

const CSS = `
.muList { margin-top: 10px; border-radius: var(--fc-r2); overflow: hidden; background: var(--fc-s1); }
.muTrack { display: flex; align-items: center; height: 36px; padding: 0 6px 0 10px; cursor: pointer; font-size: 13px; }
.muTrack:hover { background: var(--fc-hover); }
.muTrack.on { background: var(--fc-accent-soft); font-weight: 600; color: var(--fc-head); }
.muTrack .muIc { width: 16px; height: 16px; margin-right: 8px; color: var(--fc-accent); }
.muName { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.muTrack .muX { opacity: 0; }
.muTrack:hover .muX { opacity: .8; }
.muTrack .muX:hover { color: var(--fc-danger); }
.muEmpty { padding: 10px; font-size: 12px; color: var(--fc-muted); }
.muBar { display: flex; align-items: center; margin-top: 10px; }
.muBar > .fc-btn + .fc-btn { margin-left: 8px; }
.muNow { flex: 1; min-width: 0; margin-left: 12px; text-align: right; font-size: 12px; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
`;

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('music', { enabled: true, track: '', volume: 0.35, pauseInMatch: true });
    config = store.data;
    if ('debug' in config) delete config.debug;          // the core's log does this now
    window.__fcMusicLoaded = true;
    try { fs.mkdirSync(MUSIC_DIR, { recursive: true }); } catch (e) { /* exists */ }
    fc.ui.style('muStyle', CSS);
    document.addEventListener('mousedown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    fc.own(() => {
        document.removeEventListener('mousedown', onGesture, true);
        document.removeEventListener('keydown', onGesture, true);
        unload();
        fc.ui.style('muStyle', null);
        window.__fcMusicLoaded = false;
    });
    fc.on('sound:duck', (on) => { ducked = !!on; tick(); });
    // whileHidden: a match can start while Fightcade is minimised
    fc.tick(tick, 1000, { delay: 1500, whileHidden: true });
    fc.cmd('music', 'Background music on / off', () => {
        config.enabled = !config.enabled;
        store.save();
        tick();
        fc.settings.refresh('music');
        fc.ui.toast(T(config.enabled ? 'Background music on' : 'Background music off'), { icon: 'music', ms: 2000 });
    });
    fc.settings.block({ id: 'music', section: 'music', order: 10, render: wire, refresh });
    fc.log('ready,', tracks().length, 'track(s)');
    return api;
}

const api = {
    // for the welcome screen
    tracks: () => tracks(),
    current: () => (config.enabled ? currentTrack() : ''),
    addTrack: (file) => addTrack(file),
    pick(name) {
        config.track = name || '';
        config.enabled = !!name;
        store.save();
        unload();
        tick();
        fc.settings.refresh('music');
    },
    // for the music visualizer: the analyser (null until the music plays and audio can run),
    // and whether it's playing at what volume (the visualizer evens out the volume)
    analyser: () => analyser(),
    level: () => ({ playing: !!(audio && !audio.paused && state.playing), volume: audio ? audio.volume : 0 }),
    _tick: () => tick(),
    _state: () => ({ playing: state.playing, reason: state.reason, loaded, volume: audio ? audio.volume : 0, paused: audio ? audio.paused : true }),
    _tracks: () => tracks(),
    _testSound: () => testSound(),
    get _config() { return config; }
};

module.exports = { id: 'music', name: 'Background music', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
