/**
 * Fightcord branding
 *
 * Swaps Fightcade's wordmark for the FightCord logo: the big header on the home page, the
 * "FIGHTCADE × PATREON" banners, the login screen and the icon at the top of the sidebar. Only
 * the FIGHTCADE letters are replaced -- the × and PATREON stay. Switch it off under Fightcord
 * settings → My Fightcord.
 */
'use strict';

let fc = null;

// FightCord wordmark, 900 × 173, transparent
const LOGO = 'data:image/png;base64,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';
// sidebar icon: the logo's F on a blue rounded square, 256 × 256
const ICON = 'data:image/png;base64,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';
const SVG_NS = 'http://www.w3.org/2000/svg';

// the SVG wordmarks, with the box (in that SVG's own units) the new logo goes in
const TARGETS = [
    // home page header: the whole 850 × 118 SVG is the word FIGHTCADE
    { sel: '.aboutHeader .fightcadeLogo svg', box: [0, 0, 850, 118] },
    // Patreon banners (home page + Patreon page): FIGHTCADE sits left of the ×, x 6–310
    { sel: '.patreonInfo .image svg, .patreonHeader .image svg', box: [6, 31, 304, 60] },
    // sidebar icon (opens the home page): replace the whole 320 × 320 drawing
    { sel: '.mainToolbar .logo svg', box: [0, 0, 320, 320], src: ICON, all: true }
];
const ALL = TARGETS.map(t => t.sel.split(',').map(s => s.trim() + ':not(.fcbSwapped)').join(', ')).join(', ') + ', .logoWrapper img.logo:not(.fcbSwapped)';

const CSS = `
svg.fcbSwapped .logoLetters, svg.fcbSwappedAll > :not(.fcbLogo) { display: none !important; }
`;

function swapSvg(svg, t) {
    const [x, y, w, h] = t.box;
    const img = document.createElementNS(SVG_NS, 'image');
    img.setAttribute('class', 'fcbLogo');
    img.setAttribute('href', t.src || LOGO);
    img.setAttribute('x', x); img.setAttribute('y', y);
    img.setAttribute('width', w); img.setAttribute('height', h);
    img.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.appendChild(img);
    svg.classList.add('fcbSwapped');
    if (t.all) svg.classList.add('fcbSwappedAll');
}

function apply() {
    if (!document.querySelector(ALL)) return;                // nothing new: one cheap check per page change
    for (const t of TARGETS) {
        document.querySelectorAll(t.sel).forEach(svg => { if (!svg.classList.contains('fcbSwapped')) swapSvg(svg, t); });
    }
    // login screen: an <img> of Fightcade's full logo
    document.querySelectorAll('.logoWrapper img.logo:not(.fcbSwapped)').forEach(img => {
        img.classList.add('fcbSwapped');
        img.src = LOGO;
    });
}

function start(f) {
    fc = f;
    window.__fcBrandingLoaded = true;
    fc.ui.style('fcbStyle', CSS);
    fc.own(() => { fc.ui.style('fcbStyle', null); window.__fcBrandingLoaded = false; });
    // pages are rendered when first opened: swap before they're painted
    fc.watch(apply, { sync: true });
    apply();
    return { LOGO, ICON };
}

module.exports = { id: 'branding', name: 'FightCord logo', start, LOGO, ICON };
