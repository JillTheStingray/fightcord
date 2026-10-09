/**
 * Fightcord animated backgrounds
 *
 * A subtle moving background behind the chat:
 *   - Neon particles   soft glowing dots drifting up, in your accent colour + cyan
 *   - Gradient waves   slow flowing colour from your theme
 *   - Game-art drift   the channel's game art, blurred, slowly panning (follows the mouse a little)
 *   - Music visualizer bars, a wave or a pulsing ring that move with your background music
 *                      (music.js hands over an AnalyserNode; nothing listens while it's off)
 * It pauses whenever Fightcade isn't the window in front (e.g. while you're in a match), so
 * it costs nothing mid-game. A chat background picture (theme editor) wins over it.
 */
'use strict';

let fc = null;
let store = null, cfg = null;          // backgrounds-config.json

const N_ = (s) => s;          // translated where it's shown
const STYLES = { off: N_('Off'), particles: N_('Neon particles'), waves: N_('Gradient waves'), art: N_('Game-art drift'), visualizer: N_('Music visualizer') };
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
        if (cfg.style === 'particles' || cfg.style === 'visualizer') layer.innerHTML = '<canvas></canvas>';
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

// drifting dots; `boost` (0..1+) speeds them up and brightens them (the visualizer's beat)
function stepParticles(x, w, h, k, boost) {
    const want = Math.round(25 + 55 * k);
    while (parts.length < want) parts.push(spawn(w, h, true));
    if (parts.length > want) parts.length = want;
    const sp = getSprites();
    const speed = 1 + (boost || 0) * 3;
    parts.forEach((p, i) => {
        p.y -= p.vy * speed; p.x += p.vx * speed; p.t += 0.03 * speed;
        if (p.y < -30 || p.x < -30 || p.x > w + 30) parts[i] = spawn(w, h, false);
        x.globalAlpha = Math.min(1, p.a * (0.7 + 0.3 * Math.sin(p.t)) * (0.5 + k * 0.6) * (1 + (boost || 0) * 0.8));
        x.drawImage(sp[p.c], p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    });
    x.globalAlpha = 1;
}

/* --------------------------------------------------------- music visualizer */

const LOOKS = { bars: N_('Bars'), wave: N_('Wave'), pulse: N_('Pulse') };

// log-spaced bands from an analyser's byte spectrum (0-255) -> n values 0..1. The top quarter
// of the bins (above ~16 kHz) is left out: there's little music up there.
function bands(data, n) {
    const len = Math.max(2, Math.floor(data.length * 0.75));
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = Math.floor(Math.pow(len, i / n));
        const b = Math.max(a + 1, Math.floor(Math.pow(len, (i + 1) / n)));
        let s = 0, m = 0;
        for (let j = a; j < b && j < len; j++) { s += data[j]; m++; }
        out.push(m ? s / m / 255 : 0);
    }
    return out;
}

// the analyser's decibel window, moved with the music's volume, so the visualizer looks the
// same at 20% volume as at 100% (and while the music fades in and out)
function dbRange(volume) {
    const max = -6 + 20 * Math.log10(Math.max(0.05, Math.min(1, +volume || 0)));
    return { min: max - 70, max };
}

// automatic gain: bands scaled to the track's own recent peak (which eases down ~6%/s), with a
// little extra contrast, so quiet and loud tracks both fill the picture without pinning at the top
// f: how many 1/30 s went by since the last call (the visualizer runs at the screen's rate)
function agc(st, vals, f) {
    const top = vals.reduce((m, v) => Math.max(m, v), 0);
    st.ref = Math.max(top, (st.ref == null ? top : st.ref * Math.pow(0.998, f || 1)), 0.2);
    return vals.map(v => Math.min(1, Math.pow(v / st.ref, 1.7) * 0.92));
}

// a beat: bass clearly above its running average, at most every ~8 frames. st is kept between calls.
function beat(st, bass, f) {
    st.t = (st.t || 0) + (f || 1);                  // in 1/30 s
    const avg = st.avg == null ? bass : st.avg;
    // the levels are in decibels (0..1 over ~70 dB): a kick is ~5 dB over the running average,
    // and the next one at least ~0.2 s later
    const hit = bass > 0.25 && bass - avg > 0.07 && st.t - (st.last == null ? -99 : st.last) > 6;
    const a = Math.pow(0.9, f || 1);
    st.avg = avg * a + bass * (1 - a);
    if (hit) st.last = st.t;
    return hit;
}

// bass you can feel: the lowest bands sit lower on a steady bass line and jump on every hit
// (how far each is above its own slow average), instead of staying pinned near the top
function bassLift(st, vals, nBass, f) {
    st.avg = st.avg || [];
    const k = Math.pow(0.96, f || 1);
    return vals.map((v, i) => {
        if (i >= nBass) return v;
        const a = st.avg[i] == null ? v : st.avg[i];
        st.avg[i] = a * k + v * (1 - k);
        return Math.min(1, v * 0.55 + Math.max(0, v - a) * 2.6);
    });
}

const viz = { data: null, vals: [], peaks: [], beat: {}, agc: {}, lift: {}, glow: 0, punch: 0, rings: [], still: false, live: false };

// one frame of the visualizer. With no music it rests: a faint baseline, or the plain particles.
function drawVisualizer(x, w, h, k) {
    const mu = fc.modules.get('music');
    const lvl = mu && mu.level ? mu.level() : { playing: false, volume: 0 };
    const an = lvl.playing && mu.analyser ? mu.analyser() : null;
    const N = cfg.look === 'wave' ? 48 : 32;
    let vals = [], rawBass = 0;
    if (an) {
        const r = dbRange(lvl.volume);
        an.minDecibels = r.min;
        an.maxDecibels = r.max;
        if (!viz.data || viz.data.length !== an.frequencyBinCount) viz.data = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(viz.data);
        const raw = bands(viz.data, N);
        rawBass = (raw[0] + raw[1] + raw[2] + raw[3]) / 4;
        vals = bassLift(viz.lift, agc(viz.agc, raw, viz.f), Math.round(N / 6), viz.f);
    } else for (let i = 0; i < N; i++) vals.push(0);
    viz.live = !!an;
    // bars fall slowly, rise at once
    if (viz.vals.length !== N) { viz.vals = vals.slice(); viz.peaks = vals.slice(); }
    const f = viz.f || 1;                                // fall-offs are per 1/30 s, whatever the frame rate
    viz.vals = vals.map((v, i) => Math.max(v, viz.vals[i] * Math.pow(0.86, f)));
    viz.peaks = viz.vals.map((v, i) => Math.max(v, (viz.peaks[i] || 0) - 0.012 * f));
    const bass = (viz.vals[0] + viz.vals[1] + viz.vals[2] + viz.vals[3]) / 4;
    const hit = an ? beat(viz.beat, rawBass, viz.f) : false;
    viz.glow = hit ? 1 : viz.glow * Math.pow(0.88, f);
    viz.punch = hit ? 1 : viz.punch * Math.pow(0.84, f);   // the thump, gone in ~1/4 s
    viz.hit = hit;
    const [acc, cyan, violet] = colours();
    x.clearRect(0, 0, x.canvas.width, x.canvas.height);
    const alpha = 0.2 + 0.42 * k;
    if (cfg.look === 'pulse') return drawPulse(x, w, h, k, alpha, bass, acc, cyan, violet);
    if (cfg.look === 'wave') return drawWave(x, w, h, k, alpha, acc, cyan);
    return drawBars(x, w, h, k, alpha, acc, cyan);
}

// mirrored from the centre: the bass in the middle, the treble out to both sides
function drawBars(x, w, h, k, alpha, acc, cyan) {
    const n = viz.vals.length, slots = n * 2, slot = w / slots, bw = Math.max(2, slot * 0.58);
    const maxH = h * (0.18 + 0.2 * k) * (1 + viz.punch * 0.18), base = h;
    if (viz.punch > 0.02) {                               // the floor lights up on the kick
        const fg = x.createRadialGradient(w / 2, base, 0, w / 2, base, w * 0.5);
        fg.addColorStop(0, acc);
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        x.globalAlpha = alpha * 0.55 * viz.punch;
        x.fillStyle = fg;
        x.fillRect(0, base - maxH * 1.4, w, maxH * 1.4);
    }
    const g = x.createLinearGradient(0, base - maxH, 0, base);
    g.addColorStop(0, cyan);
    g.addColorStop(1, acc);
    // every bar in one path; the glow is a wider, faint copy behind them (a canvas blur on a
    // chat-sized canvas is the costly part at 60+ fps)
    const bars = (grow) => {
        x.beginPath();
        for (let s = 0; s < slots; s++) {
            const i = s < n ? n - 1 - s : s - n;            // centre outwards
            const v = 0.02 + viz.vals[i] * 0.98;
            const bh = Math.max(2, v * maxH) + grow, bx = s * slot + (slot - bw) / 2 - grow;
            x.rect(bx, base - bh, bw + grow * 2, bh);
            // the peak cap, falling slowly
            if (!grow) x.rect(bx, base - Math.max(3, (0.02 + viz.peaks[i] * 0.98) * maxH) - 5, bw, 2);
        }
        x.fill();
    };
    x.fillStyle = g;
    x.globalAlpha = alpha * (0.16 + viz.punch * 0.14);
    bars(Math.max(2, slot * 0.22) + viz.punch * 3);
    x.globalAlpha = alpha;
    bars(0);
    x.globalAlpha = 1;
}

// a neon spectrum curve over the lower part, mirrored, with a soft fill under it
function drawWave(x, w, h, k, alpha, acc, cyan) {
    const n = viz.vals.length, base = h * 0.86, amp = h * (0.14 + 0.18 * k) * (1 + viz.punch * 0.3);
    const pts = [];
    for (let s = 0; s <= n * 2; s++) {
        const i = Math.min(n - 1, s < n ? n - 1 - s : s - n);
        pts.push([s / (n * 2) * w, base - (0.015 + viz.vals[i]) * amp]);
    }
    const path = () => {
        x.beginPath();
        x.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
            const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
            x.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        x.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    };
    x.globalAlpha = alpha * 0.55;
    const f = x.createLinearGradient(0, base - amp, 0, h);
    f.addColorStop(0, acc);
    f.addColorStop(1, 'rgba(0,0,0,0)');
    path();
    x.lineTo(w, h); x.lineTo(0, h); x.closePath();
    x.fillStyle = f;
    x.fill();
    x.globalAlpha = Math.min(1, alpha * 1.4);
    path();
    x.lineWidth = 2.5 + viz.punch * 2.5;
    x.strokeStyle = cyan;
    x.shadowColor = acc;
    x.shadowBlur = 16 + viz.punch * 22;
    x.stroke();
    x.shadowBlur = 0;
    x.globalAlpha = 1;
}

// a ring that swells with the bass, spikes for the spectrum, particles that rush on the beat
function drawPulse(x, w, h, k, alpha, bass, acc, cyan, violet) {
    stepParticles(x, w, h, k, viz.live ? bass * 0.5 + viz.punch * 1.1 : 0);
    const cx = w / 2, cy = h * 0.44, r0 = Math.min(w, h) * (0.11 + 0.05 * k);
    const breathe = viz.live ? 0 : Math.sin(Date.now() / 1600) * 0.03;
    const r = r0 * (1 + bass * 0.32 + viz.punch * 0.16 + breathe);
    // a shockwave ring on every kick, rolling out and fading
    if (viz.hit) viz.rings.push({ r, a: 1 });
    const f = viz.f || 1;
    viz.rings = viz.rings.filter(s => (s.r += r0 * 0.11 * f, s.a *= Math.pow(0.88, f)) > 0.04).slice(-6);
    x.lineWidth = 2;
    viz.rings.forEach(s => {
        x.globalAlpha = alpha * s.a;
        x.strokeStyle = acc;
        x.beginPath(); x.arc(cx, cy, s.r, 0, Math.PI * 2); x.stroke();
    });
    const n = viz.vals.length;
    x.globalAlpha = alpha * 0.7;
    x.strokeStyle = violet;
    x.lineWidth = 2;
    x.lineCap = 'round';
    for (let s = 0; s < n * 2; s++) {
        const i = s < n ? s : n * 2 - 1 - s;
        const a = s / (n * 2) * Math.PI * 2 - Math.PI / 2, len = 4 + viz.vals[i] * r0 * 0.9;
        x.beginPath();
        x.moveTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6));
        x.lineTo(cx + Math.cos(a) * (r + 6 + len), cy + Math.sin(a) * (r + 6 + len));
        x.stroke();
    }
    const g = x.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, acc);
    x.globalAlpha = alpha * (0.22 + viz.glow * 0.25);
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.globalAlpha = Math.min(1, alpha * 1.3);
    x.strokeStyle = cyan;
    x.lineWidth = 3;
    x.shadowColor = acc;
    x.shadowBlur = 18 + viz.glow * 20;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    x.shadowBlur = 0;
    x.globalAlpha = 1;
}

// the one per-frame loop in Fightcord (only while the particles or the visualizer are showing)
let lastDraw = 0, raf = 0, running = false;
const animated = () => cfg.style === 'particles' || cfg.style === 'visualizer';
function drawFrame(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(drawFrame);
    // the visualizer at your screen's rate (or 60 / 30, Settings), the drifting particles at ~30.
    // The gaps leave a little slack so 60 lands on every other frame of a 120-144 Hz screen.
    const gap = cfg.style !== 'visualizer' ? 33 : cfg.fps === '30' ? 30 : cfg.fps === '60' ? 13 : 5;
    if (now - lastDraw < gap) return;
    viz.f = Math.min(4, Math.max(0.25, (now - (lastDraw || now - 33)) / 33.3));
    lastDraw = now;
    if (!active() || !animated() || paused()) return;
    const chat = visibleChat();
    const cv = chat && chat.querySelector(':scope > .fcbgLayer canvas');
    if (!cv) return;
    const w = chat.clientWidth, h = chat.clientHeight;
    if (!w || !h) return;
    const still = document.documentElement.classList.contains('fc-still');
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; parts.length = 0; viz.still = false; }
    else if (still && viz.still) return;                   // Animations off: one still frame
    viz.still = still;
    const k = Math.max(0.1, Math.min(1, +cfg.intensity || 0.5));
    const x = cv.getContext('2d');
    if (cfg.style === 'visualizer') {
        // drawn above the message box, not behind it
        const inp = chat.querySelector(':scope > .chatInput');
        drawVisualizer(x, w, inp && inp.offsetTop > 120 ? inp.offsetTop : h, k);
    }
    else { x.clearRect(0, 0, w, h); stepParticles(x, w, h, k, 0); }
    frames++;
}

// the loop only runs for the particles and the visualizer
function loop() {
    const want = active() && animated();
    if (want && !running) { running = true; raf = requestAnimationFrame(drawFrame); }
    else if (!want && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
}

// the AudioContext may only start after a click: wake it while the visualizer is on
function onGesture() {
    if (cfg.style === 'visualizer' && fc.sound && fc.sound.ctx) fc.sound.ctx();
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
/* a hovered message: a soft see-through tint, not a solid dark box over the moving background */
html.fcbg-on body .chatContent .messageWrapper .message.chat .line:hover,
html.fcbg-on body .chatWrapper .chatContent .messageWrapper:not(.chat):not(.motd):not(.dc-live):hover { background: rgba(255,255,255,.045) !important; border-radius: 6px; }
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
    store = fc.config('backgrounds', { style: 'particles', intensity: 0.5, look: 'bars', fps: 'screen' });
    cfg = store.data;
    window.__fcBgLoaded = true;
    fc.ui.style('fcbgStyle', CSS);
    const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); fc.own(() => t.removeEventListener(ev, fn, o)); };
    listen(window, 'focus', update);
    listen(window, 'blur', update);
    listen(document, 'visibilitychange', update);
    listen(document, 'mousemove', onMove, { passive: true });
    listen(document, 'mousedown', onGesture, true);
    listen(document, 'keydown', onGesture, true);
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
            { key: 'look', type: 'select', label: 'Look', options: Object.keys(LOOKS).map(k => [k, LOOKS[k]]), show: (d) => d.style === 'visualizer', onChange: update },
            { key: 'fps', type: 'select', label: 'Frame rate', hint: 'Smoother uses a little more of your computer, only while it’s showing',
                options: [['screen', N_('Match my screen')], ['60', '60 fps'], ['30', '30 fps']], show: (d) => d.style === 'visualizer' },
            { key: 'intensity', type: 'slider', label: 'Intensity', min: 10, max: 100, scale: 100, unit: '%', show: (d) => d.style !== 'off', live: update },
            { type: 'note', label: 'Moves with your background music (Settings → Music). It rests while no music plays.', show: (d) => d.style === 'visualizer' }
        ]
    });
    update();
    return api;
}

const api = { _sync: () => sync(), _frames: () => frames, _viz: () => ({ live: viz.live, glow: viz.glow, vals: viz.vals.slice() }), get _config() { return cfg; } };

module.exports = { id: 'backgrounds', name: 'Animated backgrounds', start, bands, dbRange, agc, beat, bassLift, LOOKS };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
