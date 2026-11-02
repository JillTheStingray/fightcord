/**
 * Fightcord avatar decorations (3.9) -- drawn here as SVG, no pictures
 *
 * One of them sits on the avatar (data-fcdc="crown" on its wrapper), over the frame if there's one.
 * Each is a 100 x 100 drawing whose middle (a circle of radius 30 at 50,50) is the avatar, put on a
 * box two-thirds bigger than the avatar. They move when someone hovers the avatar or a card, and
 * always in the editor. The ids (presence.js DECOS) are what other Fightcord players get.
 */
'use strict';

let fc = null;
const N_ = (s) => s;

// id -> [name for the editor, the drawing, how it moves]
const DECOS = {
    crown: [N_('Crown'), `<g transform="rotate(-14 50 16)"><path d="M33 25 35 8l9 9 6-13 6 13 9-9 2 17z" fill="#ffd166" stroke="#a8761a" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M34 22h32" stroke="#a8761a" stroke-width="1.4"/><circle cx="50" cy="4" r="2.2" fill="#ff4d6d"/><circle cx="35" cy="8" r="1.8" fill="#7af0ff"/><circle cx="65" cy="8" r="1.8" fill="#7af0ff"/>
        <circle cx="50" cy="19" r="2.4" fill="#ff4d6d" stroke="#a8761a" stroke-width=".8"/></g>`, 'bob'],
    halo: [N_('Halo'), `<ellipse cx="50" cy="11" rx="19" ry="5.5" fill="none" stroke="#fff6c2" stroke-width="3.4"/><ellipse cx="50" cy="11" rx="19" ry="5.5" fill="none" stroke="#ffd166" stroke-width="1.2"/>`, 'bob'],
    horns: [N_('Horns'), `<path d="M30 30c-9-5-12-15-8-25 3 9 8 13 15 15z" fill="#e5383b" stroke="#7a0c12" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M70 30c9-5 12-15 8-25-3 9-8 13-15 15z" fill="#e5383b" stroke="#7a0c12" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M26 21c-2-4-2-8-1-12" stroke="#ff8a8c" stroke-width="1.4" fill="none"/><path d="M74 21c2-4 2-8 1-12" stroke="#ff8a8c" stroke-width="1.4" fill="none"/>`, 'wiggle'],
    catears: [N_('Cat ears'), `<path d="M24 34 22 9l20 13z" fill="#2b2d31" stroke="#f2f3f5" stroke-width="1.8" stroke-linejoin="round"/><path d="M27 28l-1-12 10 7z" fill="#ff8fb8"/>
        <path d="M76 34l2-25-20 13z" fill="#2b2d31" stroke="#f2f3f5" stroke-width="1.8" stroke-linejoin="round"/><path d="M73 28l1-12-10 7z" fill="#ff8fb8"/>`, 'wiggle'],
    headphones: [N_('Headphones'), `<path d="M21 52c0-22 13-35 29-35s29 13 29 35" fill="none" stroke="#1e1f22" stroke-width="5" stroke-linecap="round"/>
        <path d="M21 52c0-22 13-35 29-35s29 13 29 35" fill="none" stroke="#5865f2" stroke-width="2.4" stroke-linecap="round"/>
        <rect x="12" y="46" width="12" height="20" rx="5" fill="#5865f2" stroke="#1e1f22" stroke-width="1.8"/><rect x="76" y="46" width="12" height="20" rx="5" fill="#5865f2" stroke="#1e1f22" stroke-width="1.8"/>
        <path d="M15 51v10M85 51v10" stroke="#a5b0ff" stroke-width="1.6" stroke-linecap="round"/>`, 'bob'],
    sparkles: [N_('Sparkles'), ['M14 22l2 6 6 2-6 2-2 6-2-6-6-2 6-2z', 'M84 14l1.6 4.4 4.4 1.6-4.4 1.6L84 26l-1.6-4.4-4.4-1.6 4.4-1.6z', 'M88 70l2 5 5 2-5 2-2 5-2-5-5-2 5-2z', 'M16 80l1.4 3.6 3.6 1.4-3.6 1.4L16 90l-1.4-3.6-3.6-1.4 3.6-1.4z', 'M50 2l1.2 3.3 3.3 1.2-3.3 1.2L50 11l-1.2-3.3-3.3-1.2 3.3-1.2z']
        .map((d, i) => `<path d="${d}" fill="${['#fff6c2', '#ff73fa', '#7af0ff', '#ffd166', '#ffffff'][i]}"/>`).join(''), 'spin'],
    snow: [N_('Snow'), [[16, 24, 5], [84, 20, 4], [90, 62, 3.4], [12, 70, 3.6], [30, 90, 3], [74, 88, 4], [50, 6, 3]].map(([x, y, r]) =>
        `<g stroke="#e0f7ff" stroke-width="1.3" stroke-linecap="round"><path d="M${x - r} ${y}h${r * 2}M${x} ${y - r}v${r * 2}M${x - r * 0.7} ${y - r * 0.7}l${r * 1.4} ${r * 1.4}M${x - r * 0.7} ${y + r * 0.7}l${r * 1.4} ${-r * 1.4}"/></g>`).join('') +
        '<path d="M27 26c6-6 14-9 23-9s17 3 23 9c-4-1-7 1-10-1-3 2-6 0-9 1-3-2-6 0-9-1-3 2-7 0-10 1-3-1-5 1-8 0z" fill="#ffffff" opacity=".95"/>', 'spin'],
    flames: [N_('Flames'), `<path d="M18 74c-6-12 2-20 2-30 6 8 4 14 9 18 0-8 4-12 3-20 8 10 8 20 4 30z" fill="#ff6d00"/><path d="M82 74c6-12-2-20-2-30-6 8-4 14-9 18 0-8-4-12-3-20-8 10-8 20-4 30z" fill="#ff6d00"/>
        <path d="M22 74c-3-7 1-11 2-17 3 5 3 8 6 11 1-4 2-6 2-10 4 6 3 11 1 16z" fill="#ffca28"/><path d="M78 74c3-7-1-11-2-17-3 5-3 8-6 11-1-4-2-6-2-10-4 6-3 11-1 16z" fill="#ffca28"/>
        <path d="M30 86c5 6 12 9 20 9s15-3 20-9c-6 2-9-3-13 0-2-5-5-6-7-10-2 4-5 5-7 10-4-3-7 2-13 0z" fill="#ff3d00"/>`, 'flicker'],
    hearts: [N_('Hearts'), [[16, 26, 7, '#ff4d8d'], [84, 22, 6, '#ff85b3'], [88, 72, 5, '#ff4d8d'], [14, 76, 5, '#ffc2d9'], [50, 6, 5, '#ff85b3']].map(([x, y, s, c]) => {
        const p = (dx, dy) => (x + dx * s).toFixed(1) + ' ' + (y + dy * s).toFixed(1);
        return `<path d="M${p(0, 0.8)}C${p(-1.3, 0)} ${p(-0.6, -0.9)} ${p(0, -0.3)}C${p(0.6, -0.9)} ${p(1.3, 0)} ${p(0, 0.8)}z" fill="${c}"/>`;
    }).join(''), 'float'],
    bolts: [N_('Lightning'), [[12, 18, 1], [80, 10, -1], [86, 64, 1], [10, 66, -1]].map(([x, y, f]) =>
        `<path d="M${x + 6 * f} ${y}l${-6 * f} 12h${5 * f}l${-3 * f} 12 ${10 * f}-15h${-5 * f}l${4 * f}-9z" fill="#ffd60a" stroke="#6b5600" stroke-width="1" stroke-linejoin="round"/>`).join(''), 'flash']
};

const url = (svg) => 'url("data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${svg.replace(/\s+/g, ' ')}</svg>`) + '")';

// where it moves: on hover, in a card someone hovers, and in the editor
const LIVE = (id) => [`[data-fcdc="${id}"]:hover::before`].concat(['.fc-cardpop:hover', '.fc-pop:hover', '.fcdmProf:hover', '.fclkPrev', '.pcEdDcs']
    .map(p => `${p} [data-fcdc="${id}"]::before`)).join(', ');
function css() {
    let out = `
[data-fcdc] { position: relative; overflow: visible !important; }
[data-fcdc]::before { content: ''; position: absolute; top: -33.3%; left: -33.3%; right: -33.3%; bottom: -33.3%; z-index: 4; pointer-events: none; background: center / contain no-repeat; }
@keyframes fcdcBob { 50% { transform: translateY(-4%); } }
@keyframes fcdcWiggle { 25% { transform: rotate(-4deg); } 75% { transform: rotate(4deg); } }
@keyframes fcdcSpin { to { transform: rotate(360deg); } }
@keyframes fcdcFlicker { 50% { transform: scaleY(1.06) translateY(-2%); opacity: .85; } }
@keyframes fcdcFloat { 50% { transform: translateY(-6%) scale(1.04); } }
@keyframes fcdcFlash { 0%, 70%, 100% { opacity: 1; } 80% { opacity: .2; } 90% { opacity: 1; } 95% { opacity: .4; } }
`;
    const anim = { bob: 'fcdcBob 1.6s ease-in-out infinite', wiggle: 'fcdcWiggle 1.2s ease-in-out infinite', spin: 'fcdcSpin 9s linear infinite',
        flicker: 'fcdcFlicker .5s ease-in-out infinite', float: 'fcdcFloat 1.8s ease-in-out infinite', flash: 'fcdcFlash 1.6s linear infinite' };
    Object.keys(DECOS).forEach(id => {
        const [, svg, move] = DECOS[id];
        out += `[data-fcdc="${id}"]::before { background-image: ${url(svg)}; }\n`;
        out += `${LIVE(id)} { animation: ${anim[move]}; }\n`;
    });
    return out;
}

// id -> its name, in the editor's order
const names = () => Object.keys(DECOS).reduce((o, k) => { o[k] = DECOS[k][0]; return o; }, {});
module.exports = { id: 'decorations', name: 'Avatar decorations', start: (f) => start(f), DECOS, names };

function start(f) {
    fc = f;
    fc.ui.style('fcdcStyle', css());
    fc.own(() => fc.ui.style('fcdcStyle', null));
    return { names };
}
