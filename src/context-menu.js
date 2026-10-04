/**
 * Fightcord right-click menu
 *
 * Fightcade's right-click menu on players, restyled like Discord's (icons, a separator,
 * blurple hover, red Ignore) and with Fightcord's own actions added under Fightcade's:
 * Add friend, Notes & tags, Head-to-head, Scout and Copy name.
 *
 * Fightcade builds the menu from data -- root.contextMenuData = { user, items, callback } --
 * so we add items to that list (a synchronous watch, before it renders) and handle their
 * ids in a wrapped callback; every other id still goes to Fightcade's own callback.
 */
'use strict';

let fc = null;
const mod = (id) => fc.modules.get(id);

const ICON = {
    profile: 'user', challenge: 'swords', ignore: 'ban', mention: 'at', copy: 'copy',
    'fc:friend': 'star', 'fc:notes': 'edit', 'fc:h2h': 'handshake', 'fc:scout': 'search', 'fc:copy': 'copy'
};
const handled = [];        // for the harness

function nameOf(d) {
    const u = d && d.user;
    return String((u && (u.name || u.id)) || '');
}

// add our items to a player menu (the ones with Fightcade's "profile" item)
function augment(d) {
    if (!d || !Array.isArray(d.items) || d.__fcAug) return;
    if (!d.items.some(i => i && i.id === 'profile')) return;
    const name = nameOf(d);
    if (!name) return;
    d.__fcAug = true;
    const fr = mod('friends'), nt = mod('notes'), st = mod('stats'), sc = mod('scout');
    const mine = fc.app.isMe(name);
    const add = [];
    if (fr && fr.isFriend && !mine) add.push({ id: 'fc:friend', text: fc.t(fr.isFriend(name) ? 'Remove friend' : 'Add friend') });
    if (nt && nt.edit && !mine) add.push({ id: 'fc:notes', text: fc.t('Notes & tags') });
    if (st && st.open && !mine) add.push({ id: 'fc:h2h', text: 'Head-to-head' });
    if (sc && sc.openCard) add.push({ id: 'fc:scout', text: 'Scout' });
    add.push({ id: 'fc:copy', text: 'Copy name' });
    add.forEach(i => d.items.push(i));
    const orig = d.callback;
    d.callback = function (id) {
        if (typeof id === 'string' && id.indexOf('fc:') === 0) { run(id, name, d); return undefined; }
        return orig && orig.apply(this, arguments);
    };
    setTimeout(decorate, 0);
}

function run(id, name, d) {
    handled.push(id);
    if (handled.length > 50) handled.shift();
    const pos = d && d.position ? { left: d.position.x, top: d.position.y, right: d.position.x, bottom: d.position.y, width: 0, height: 0 } : null;
    try {
        if (id === 'fc:friend') { const fr = mod('friends'); if (fr) fr.toggle(name); }
        else if (id === 'fc:notes') { const nt = mod('notes'); if (nt) setTimeout(() => nt.edit(name, pos), 30); }
        else if (id === 'fc:h2h') { const st = mod('stats'); if (st) st.open({ opp: name }); }
        else if (id === 'fc:scout') { const sc = mod('scout'); if (sc) setTimeout(() => sc.openCard(name, pos, 'right'), 30); }
        else if (id === 'fc:copy') fc.ui.copy(name);
    } catch (e) { fc.log.warn(id + ' failed', e.message); }
}

// icons + classes on the rendered rows (Fightcade's item component has no ids in the DOM:
// rows follow data.items in order, minus "challenge" (drawn on top) and "separator")
function decorate() {
    const menus = document.querySelectorAll('.mask > .menu');
    if (!menus.length) return;
    const r = fc.app.root();
    const d = r && r.contextMenuData;
    menus.forEach(menu => {
        menu.classList.add('fccm');
        if (!d || !Array.isArray(d.items)) return;
        const rows = [...menu.querySelectorAll(':scope > .contextMenuItemsWrapper > *')];
        const items = d.items.filter(i => i && i.id !== 'challenge' && i.id !== 'separator');
        rows.forEach((row, i) => {
            const it = items[i];
            if (!it) return;
            const ours = String(it.id).indexOf('fc:') === 0;
            row.classList.add('fccmRow');
            row.classList.toggle('fccmOurs', ours);
            row.classList.toggle('fccmFirst', ours && !(items[i - 1] && String(items[i - 1].id).indexOf('fc:') === 0));
            row.classList.toggle('fccmDanger', it.id === 'ignore');
            const ic = it.id === 'fc:friend' && /Remove/.test(it.text) ? 'star-fill' : (ICON[it.id] || '');
            if (ic && row.getAttribute('data-fcicon') !== ic) row.setAttribute('data-fcicon', ic);
        });
        const ch = menu.querySelector(':scope > .challengeButtonWrapper > *');
        if (ch) ch.setAttribute('data-fcicon', 'swords');
    });
}

const CSS = `
.mask > .menu.fccm { padding: 6px 8px !important; border-radius: 8px !important; min-width: 200px !important;
    background: var(--fc-s0) !important; background-image: none !important; border: 0 !important;
    box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 8px 24px rgba(0,0,0,.5) !important;
    font-family: var(--fc-font) !important; animation: fccmIn .12s ease-out both; }
@keyframes fccmIn { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
.mask > .menu.fccm::before, .mask > .menu.fccm::after { display: none !important; }
.mask > .menu.fccm .contextMenuItemsWrapper { padding: 0 !important; margin: 0 !important; background: none !important; border: 0 !important; }
.mask > .menu.fccm .contextMenuItemsWrapper > *, .mask > .menu.fccm .challengeButtonWrapper > * {
    position: relative !important; display: flex !important; align-items: center !important; min-height: 32px !important;
    margin: 2px 0 !important; padding: 6px 8px 6px 34px !important; border-radius: 4px !important; border: 0 !important;
    font-size: 14px !important; font-weight: 500 !important; text-transform: none !important; letter-spacing: 0 !important;
    color: var(--fc-text) !important; background: none !important; background-image: none !important; box-shadow: none !important;
    text-shadow: none !important; cursor: pointer !important; transition: background-color .08s ease, color .08s ease !important; }
.mask > .menu.fccm .contextMenuItemsWrapper > *::before, .mask > .menu.fccm .challengeButtonWrapper > *::before {
    content: '' !important; position: absolute !important; left: 10px !important; top: 50% !important;
    width: 16px !important; height: 16px !important; margin-top: -8px !important; opacity: .85 !important;
    background: currentColor !important; -webkit-mask: center / contain no-repeat !important; }
${['user', 'swords', 'ban', 'at', 'copy', 'star', 'star-fill', 'edit', 'handshake', 'search'].map(n =>
    `.mask > .menu.fccm [data-fcicon="${n}"]::before { -webkit-mask-image: var(--fc-i-${n}) !important; }`).join('\n')}
.mask > .menu.fccm .contextMenuItemsWrapper > *:hover, .mask > .menu.fccm .challengeButtonWrapper > *:hover {
    background: var(--fc-accent) !important; color: #fff !important; }
.mask > .menu.fccm .challengeButtonWrapper { margin: 0 0 4px !important; padding: 0 0 4px !important; background: none !important;
    border: 0 !important; border-bottom: 1px solid var(--fc-divider) !important; }
.mask > .menu.fccm .challengeButtonWrapper > * { color: #fff !important; font-weight: 600 !important; background: rgba(35,165,90,.22) !important; }
.mask > .menu.fccm .challengeButtonWrapper > *:hover { background: #248046 !important; }
.mask > .menu.fccm .fccmFirst { margin-top: 8px !important; }
.mask > .menu.fccm .fccmFirst::after { content: '' !important; position: absolute !important; top: -5px !important; left: 4px !important; right: 4px !important;
    height: 1px !important; background: var(--fc-divider) !important; }
.mask > .menu.fccm .fccmDanger { color: #f23f43 !important; }
.mask > .menu.fccm .fccmDanger:hover { background: #f23f43 !important; color: #fff !important; }
.mask > .menu.fccm .contextMenuItemsWrapper > * input[type="checkbox"] { margin-left: auto !important; }
.mask > .menu.fccm [disabled], .mask > .menu.fccm .disabled { opacity: .45 !important; cursor: default !important; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    window.__fcCtxLoaded = true;
    fc.ui.style('fccmStyle', CSS);
    fc.own(() => { fc.ui.style('fccmStyle', null); window.__fcCtxLoaded = false; });
    // our items go in before Fightcade draws the menu
    fc.app.watch('contextMenuData', (d) => { if (d) augment(d); }, { sync: true });
    // any menu that opens (including Fightcade's FT submenu) gets the look, before it paints
    fc.watch(() => { if (document.querySelector('.mask > .menu:not(.fccm)')) decorate(); }, { sync: true });
    return api;
}

const api = { _augment: (d) => augment(d), _decorate: () => decorate(), _handled: handled };

module.exports = { id: 'context-menu', name: 'Right-click menu', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
