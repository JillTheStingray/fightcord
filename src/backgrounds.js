/**
 * Fightcord animated backgrounds
 *
 * A subtle moving background behind the chat:
 *   - Neon particles   soft glowing dots drifting up, in your accent colour + cyan
 *   - Gradient waves   slow flowing colour from your theme
 *   - Game-art drift   the channel's game art, blurred, slowly panning (follows the mouse a little)
 * It pauses whenever Fightcade isn't the window in front (e.g. while you're in a match), so
 * it costs nothing mid-game. A chat background picture (theme editor) wins over it.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // backgrounds-config.json

const N_ = (s) => s;          // translated where it's shown
const STYLES = { off: N_('Off'), particles: N_('Neon particles'), waves: N_('Gradient waves'), art: N_('Game-art drift') };
let frames = 0;                  // for the harness: particle frames drawn

const active = () => cfg.style !== 'off' && !document.documentElement.classList.contains('dc-has-bg');
const paused = () => !window.__fcbgAlwaysOn && (document.hidden || !document.hasFocus());

/* ------------------------------------------------------------------- layers */

function visibleChat() {
    const w = fc.app.channelElement();
    return (w && w.querySelector('.chatWrapper')) || null;
}

function romOf(chat) {
    const w = chat.closest('.channelWrapper');
    const r = w && w.querySelector('.channelToolbar .channelInfo .name[title="Rom name"]');
    return r ? r.textContent.trim() : '';
}

function sync() {
    const html = document.documentElement;
    const on = active();
    html.classList.toggle('fcbg-on', on);
    html.classList.toggle('fcbg-paused', paused());
    html.style.setProperty('--fcbg-k', String(Math.max(0.1, Math.min(1, +cfg.intensity || 0.5))));
    document.querySelectorAll('.chatWrapper > .fcbgLayer').forEach(l => { if (!on || l.dataset.style !== cfg.style) l.remove(); });
    if (!on) return;
    const chat = visibleChat();
    if (!chat) return;
    let layer = chat.querySelector(':scope > .fcbgLayer');
    if (!layer) {
        layer = document.createElement('div');
        layer.className = 'fcbgLayer';
        layer.dataset.style = cfg.style;
        if (cfg.style === 'particles') layer.innerHTML = '<canvas></canvas>';
        else if (cfg.style === 'waves') layer.innerHTML = '<i class="w1"></i><i class="w2"></i><i class="w3"></i>';
        else layer.innerHTML = '<i class="art"></i>';
        chat.appendChild(layer);                    // last child: safe next to Fightcade's own nodes
    }
    if (cfg.style === 'art') {
        const rom = romOf(chat);
        const art = layer.querySelector('.art');
        if (rom && art.dataset.rom !== rom) {
            art.dataset.rom = rom;
            art.style.setProperty('background-image', 'url("' + fc.data.artUrl(rom, 'https://web.fightcade.com/') + '")', 'important');
        }
    }
}

/* ---------------------------------------------------------------- particles */

const parts = [];
let sprites = null, spriteKey = '';

function colours() {
    const acc = (getComputedStyle(document.documentElement).getPropertyValue('--dc-blurple') || '#5865f2').trim() || '#5865f2';
    return [acc, '#22e3f2', '#8b5cf6'];
}

// one pre-rendered glow per colour (drawing images is far cheaper than gradients per dot)
function getSprites() {
    const cols = colours();
    const key = cols.join();
    if (sprites && spriteKey === key) return sprites;
    spriteKey = key;
    sprites = cols.map(c => {
        const s = document.createElement('canvas');
        s.width = s.height = 64;
        const x = s.getContext('2d');
        const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, c);
        g.addColorStop(0.25, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, 64, 64);
        return s;
    });
    return sprites;
}

function spawn(w, h, anywhere) {
    return {
        x: Math.random() * w, y: anywhere ? Math.random() * h : h + 20,
        r: 6 + Math.random() * 18, vy: 0.15 + Math.random() * 0.45, vx: (Math.random() - 0.5) * 0.25,
        c: Math.floor(Math.random() * 3), a: 0.15 + Math.random() * 0.45, t: Math.random() * 6.28
    };
}

// the one per-frame loop in Fightcord (only while the particles are showing)
let lastDraw = 0, raf = 0, running = false;
function drawParticles(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(drawParticles);
    if (now - lastDraw < 33) return;                       // ~30 fps is plenty for drifting dots
    lastDraw = now;
    if (!active() || cfg.style !== 'particles' || paused()) return;
    const chat = visibleChat();
    const cv = chat && chat.querySelector(':scope > .fcbgLayer canvas');
    if (!cv) return;
    const w = chat.clientWidth, h = chat.clientHeight;
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; parts.length = 0; }
    const k = Math.max(0.1, Math.min(1, +cfg.intensity || 0.5));
    const want = Math.round(25 + 55 * k);
    while (parts.length < want) parts.push(spawn(w, h, true));
    if (parts.length > want) parts.length = want;
    const x = cv.getContext('2d');
    x.clearRect(0, 0, w, h);
    const sp = getSprites();
    parts.forEach((p, i) => {
        p.y -= p.vy; p.x += p.vx; p.t += 0.03;
        if (p.y < -30 || p.x < -30 || p.x > w + 30) parts[i] = spawn(w, h, false);
        x.globalAlpha = p.a * (0.7 + 0.3 * Math.sin(p.t)) * (0.5 + k * 0.6);
        x.drawImage(sp[p.c], p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    });
    x.globalAlpha = 1;
    frames++;
}

// the loop only runs for the particle style
function loop() {
    const want = active() && cfg.style === 'particles';
    if (want && !running) { running = true; raf = requestAnimationFrame(drawParticles); }
    else if (!want && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
}

/* -------------------------------------------------------- art: mouse drift */

function onMove(e) {
    if (cfg.style !== 'art' || paused()) return;
    const chat = visibleChat();
    const art = chat && chat.querySelector(':scope > .fcbgLayer .art');
    if (!art) return;
    const r = chat.getBoundingClientRect();
    const dx = ((e.clientX - r.left) / r.width - 0.5) * -14, dy = ((e.clientY - r.top) / r.height - 0.5) * -10;
    art.style.setProperty('--px', dx.toFixed(1) + 'px');
    art.style.setProperty('--py', dy.toFixed(1) + 'px');
}

const CSS = `
html.fcbg-on .channelContent .chatWrapper { position: relative !important; }
html.fcbg-on .channelContent .chatWrapper > .chatContent { z-index: 1 !important; background: transparent !important; background-image: none !important; }
/* Fightcade's own art layer would cover ours; the message box stays above */
html.fcbg-on .channelContent .chatWrapper > .chatWrapperBg { display: none !important; }
html.fcbg-on .channelContent .chatWrapper > .chatInput { position: relative; z-index: 2; }
.fcbgLayer { position: absolute; top: 0; left: 0; right: 0; bottom: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.fcbgLayer canvas { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.fcbgLayer i { position: absolute; display: block; }
.fcbgLayer .w1, .fcbgLayer .w2, .fcbgLayer .w3 { width: 140%; height: 140%; left: -20%; top: -20%; border-radius: 45%; filter: blur(40px);
    opacity: calc(.12 + var(--fcbg-k, .5) * .25); }
.fcbgLayer .w1 { background: radial-gradient(ellipse at 30% 40%, var(--fc-accent), transparent 55%); animation: fcbgW1 26s ease-in-out infinite alternate; }
.fcbgLayer .w2 { background: radial-gradient(ellipse at 70% 60%, #8b5cf6, transparent 50%); animation: fcbgW2 32s ease-in-out infinite alternate; }
.fcbgLayer .w3 { background: radial-gradient(ellipse at 50% 80%, #22e3f2, transparent 45%); opacity: calc(.06 + var(--fcbg-k, .5) * .14);
    animation: fcbgW1 40s ease-in-out infinite alternate-reverse; }
@keyframes fcbgW1 { from { transform: translate(-6%, -4%) rotate(0deg); } to { transform: translate(6%, 5%) rotate(25deg); } }
@keyframes fcbgW2 { from { transform: translate(5%, 4%) rotate(0deg); } to { transform: translate(-6%, -5%) rotate(-30deg); } }
.fcbgLayer .art { top: -8%; left: -8%; width: 116%; height: 116%; background-size: cover; background-position: center; image-rendering: pixelated;
    filter: blur(calc(26px - var(--fcbg-k, .5) * 14px)) saturate(1.3) brightness(calc(.22 + var(--fcbg-k, .5) * .25));
    transform: translate(var(--px, 0px), var(--py, 0px)); transition: transform .6s ease-out; }
.fcbgLayer .art { animation: fcbgKen 38s ease-in-out infinite alternate; }
@keyframes fcbgKen { from { background-position: 40% 35%; background-size: 115% auto; } to { background-position: 60% 55%; background-size: 135% auto; } }
html.fcbg-paused .fcbgLayer, html.fcbg-paused .fcbgLayer * { animation-play-state: paused !important; }
`;

function update() { sync(); loop(); }

/* ------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('backgrounds', { style: 'particles', intensity: 0.5 });
    cfg = store.data;
    window.__fcBgLoaded = true;
    fc.ui.style('fcbgStyle', CSS);
    const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); fc.own(() => t.removeEventListener(ev, fn, o)); };
    listen(window, 'focus', update);
    listen(window, 'blur', update);
    listen(document, 'visibilitychange', update);
    listen(document, 'mousemove', onMove, { passive: true });
    fc.own(() => {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        document.querySelectorAll('.fcbgLayer').forEach(l => l.remove());
        ['fcbg-on', 'fcbg-paused'].forEach(c => document.documentElement.classList.remove(c));
        fc.ui.style('fcbgStyle', null);
        window.__fcBgLoaded = false;
    });
    fc.tick(update, 1000);
    fc.watch(update, { selector: '.chatWrapper' });
    fc.settings.block({
        id: 'backgrounds', section: 'appearance', title: 'Animated background', hint: '— behind the chat; pauses while you’re in a match',
        store, order: 30,
        fields: [
            { key: 'style', type: 'select', label: 'Style', options: Object.keys(STYLES).map(k => [k, STYLES[k]]), onChange: update },
            { key: 'intensity', type: 'slider', label: 'Intensity', min: 10, max: 100, scale: 100, unit: '%', show: (d) => d.style !== 'off', live: update }
        ]
    });
    update();
    return api;
}

const api = { _sync: () => sync(), _frames: () => frames, get _config() { return cfg; } };

module.exports = { id: 'backgrounds', name: 'Animated backgrounds', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
