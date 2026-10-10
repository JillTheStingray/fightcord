/**
 * Fightcord player notes & tags
 *
 * Private notes and coloured tags on any player ("mashes DP", Laggy, Good sparring...).
 * Only on your PC (notes-config.json) -- nobody else ever sees them.
 *
 * Shown on the scout card, the member list (coloured dots), the challenge card, the
 * member hover card and the head-to-head page. Edit them from any of those (Notes),
 * or /note <name> in chat. Event: notes:changed (name).
 *
 * Matchup notes (2.10): one note per game + opponent character ("parry the dive kick"). When the
 * emulator shows who they picked, a card in the lobby says your record vs that character and the
 * note; Analytics lists every matchup with its note. Same file, key "<rom>|<character>".
 */
'use strict';

let fc = null;
let store = null, cfg = null;            // notes-config.json

const DEFAULT_TAGS = [
    { id: 'spar', label: 'Good sparring', color: '#23a55a' },
    { id: 'friendly', label: 'Friendly', color: '#00a8fc' },
    { id: 'rival', label: 'Rival', color: '#a35cf6' },
    { id: 'laggy', label: 'Laggy', color: '#f0a232' },
    { id: 'mash', label: 'Mashes', color: '#f23f43' },
    { id: 'avoid', label: 'Avoid', color: '#80848e' }
];

const E = (s) => fc.fmt.esc(s);
const T = (s, v) => fc.t(s, v);
T.plural = (n, one, many, v) => fc.t.plural(n, one, many, v);
const key = (n) => String(n || '').toLowerCase();

/* ---------------------------------------------------------------------- data */

// -> { name, note, tags: [tag objects] } (always an object)
function get(name) {
    if (!cfg) return { name, note: '', tags: [] };
    const p = cfg.people[key(name)] || {};
    const tags = (p.tags || []).map(id => cfg.tags.find(t => t.id === id)).filter(Boolean);
    return { name: p.name || name, note: p.note || '', tags };
}

const has = (name) => { const p = get(name); return !!(p.note || p.tags.length); };

function changed(name) {
    store.save();
    fc.emit('notes:changed', name || '');
    fc.settings.refresh('notes');
}

function set(name, patch) {
    if (!name || !cfg) return;
    const k = key(name);
    const p = Object.assign({ name, note: '', tags: [] }, cfg.people[k], patch, { name });
    p.note = String(p.note || '').slice(0, 500);
    if (!p.note && !(p.tags || []).length) delete cfg.people[k];
    else cfg.people[k] = p;
    changed(name);
}

function toggleTag(name, id) {
    const cur = (cfg.people[key(name)] || {}).tags || [];
    set(name, { tags: cur.includes(id) ? cur.filter(x => x !== id) : cur.concat(id) });
}

/* ------------------------------------------------------------------ matchups */

const muKey = (rom, ch) => String(rom || '') + '|' + String(ch || '').toLowerCase();
const matchup = (rom, ch) => (cfg && cfg.matchups[muKey(rom, ch)]) || null;

function setMatchup(rom, ch, text) {
    if (!cfg || !ch) return;
    const k = muKey(rom, ch), t = String(text || '').trim().slice(0, 500);
    if (t) cfg.matchups[k] = { rom: rom || '', char: ch, text: t, updated: Date.now() };
    else delete cfg.matchups[k];
    changed('');
}

// your record vs a character in a game, from the sets that know the characters (2.6+)
function matchupRecord(rom, ch) {
    const k = String(ch || '').toLowerCase();
    const sets = fc.history.all().filter(s => String(s.oppChar || '').toLowerCase() === k && (!rom || !s.rom || s.rom === rom));
    return Object.assign({ n: sets.length }, fc.data.recordOf(sets));
}

function editMatchup(rom, ch, rect) {
    if (!cfg || !ch) return;
    closeEditor();
    const box = document.createElement('div');
    box.id = 'ntEdit';
    const r = matchupRecord(rom, ch), cur = matchup(rom, ch);
    box.innerHTML = `<div class="h">${E(T('Matchup notes vs'))} <b>${E(ch)}</b>${r.w || r.l ? ` · ${E(fc.fmt.wl(r))}` : ''}</div>
        <textarea class="fc-input" maxlength="500" placeholder="${E(T('What works against {char}…', { char: ch }))}">${E(cur ? cur.text : '')}</textarea>
        <div class="f"><span class="fc-muted">${E(T('Shown when you face {char}', { char: ch }))}</span>${fc.ui.btn('Save', { size: 'sm', act: 'save' })}</div>`;
    const save = () => { setMatchup(rom, ch, box.querySelector('textarea').value); closeEditor(); };
    box.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey) && e.target.tagName === 'TEXTAREA') { e.preventDefault(); save(); }
    }, true);
    box.addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('[data-act="save"]')) save(); });
    const at = rect || { left: window.innerWidth / 2 - 160, right: window.innerWidth / 2 - 160, top: window.innerHeight / 3, bottom: window.innerHeight / 3, width: 0, height: 0 };
    const me = editor = fc.ui.popover(at, box, { cls: 'ntPop', width: 320, onClose: () => { if (editor === me) editor = null; } });
    box.querySelector('textarea').focus();
}

// the emulator shows who they picked: your record and your note, once per set and character
const muShown = new Set();
function onCharacter(ev) {
    if (!cfg || !ev || !ev.char) return;
    const k = ev.quark + '|' + ev.char;
    if (muShown.has(k)) return;
    muShown.add(k);
    const r = matchupRecord(ev.rom, ev.char), note = matchup(ev.rom, ev.char);
    if (!note && r.n < 3) return;
    fc.ui.toast(T('vs {char}', { char: ev.char }) + (r.w || r.l ? ' · ' + fc.fmt.wl(r) : ''), {
        icon: 'sword', ms: 12000,
        sub: note ? '“' + note.text + '”' : T('No matchup note yet'),
        actions: [{ label: note ? T('Edit note') : T('Add a note'), kind: 'sec', fn: () => editMatchup(ev.rom, ev.char) }]
    });
}

// [data-mu="rom|Character"] anywhere (Analytics, the challenge card) opens the editor
function onMuClick(e) {
    const el = e.target.closest && e.target.closest('[data-mu]');
    if (!el) return;
    e.stopPropagation();
    e.preventDefault();
    const v = el.getAttribute('data-mu'), i = v.indexOf('|');
    editMatchup(v.slice(0, i), v.slice(i + 1), el.getBoundingClientRect());
}

/* ------------------------------------------------------------------- display */

const tagChip = (t, extra) => `<span class="ntChip${extra || ''}" data-tag="${E(t.id)}" style="--c:${E(t.color)}">${E(t.label)}</span>`;

// tag chips + the note, for cards
function chips(name, opts) {
    const p = get(name);
    const o = opts || {};
    if (!p.tags.length && !p.note) return o.empty || '';
    return `<div class="ntChips">${p.tags.map(t => tagChip(t)).join('')}</div>` +
        (p.note && !o.noNote ? `<div class="ntNote">“${E(p.note)}”</div>` : '');
}

// up to two coloured dots (member list)
function dots(name) {
    const p = get(name);
    if (!p.tags.length && !p.note) return '';
    const ds = p.tags.slice(0, 2).map(t => `<i style="background:${E(t.color)}"></i>`).join('') || '<i class="n"></i>';
    return `<span class="ntDots" title="${E(p.tags.map(t => t.label).concat(p.note ? ['“' + p.note + '”'] : []).join(' · '))}">${ds}</span>`;
}

/* -------------------------------------------------------------------- editor */

let editor = null;
function closeEditor() { if (editor) editor.close(); }

function edit(name, rect) {
    if (!name || !cfg) return;
    closeEditor();
    const box = document.createElement('div');
    box.id = 'ntEdit';
    const draw = () => {
        const p = get(name);
        const on = new Set(p.tags.map(t => t.id));
        box.innerHTML = `<div class="h">${E(T('Notes on'))} <b>${E(name)}</b></div>
            <div class="tags">${cfg.tags.map(t => tagChip(t, ' pick' + (on.has(t.id) ? ' on' : ''))).join('')}</div>
            <textarea class="fc-input" maxlength="500" placeholder="${E(T('Anything to remember about {name}…', { name }))}">${E(p.note)}</textarea>
            <div class="f"><span class="fc-muted">${E(T('Only you can see this'))}</span>${fc.ui.btn('Save', { size: 'sm', act: 'save' })}</div>`;
    };
    draw();
    const save = () => { set(name, { note: box.querySelector('textarea').value.trim() }); closeEditor(); };
    box.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey) && e.target.tagName === 'TEXTAREA') { e.preventDefault(); save(); }
    }, true);
    box.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = e.target.closest('[data-tag]');
        if (t) {
            const note = box.querySelector('textarea').value;
            toggleTag(name, t.dataset.tag);
            draw();
            box.querySelector('textarea').value = note;
            return;
        }
        if (e.target.closest('[data-act="save"]')) save();
    });
    const r = rect || { left: window.innerWidth / 2 - 160, right: window.innerWidth / 2 - 160, top: window.innerHeight / 3, bottom: window.innerHeight / 3, width: 0, height: 0 };
    const me = editor = fc.ui.popover(r, box, { cls: 'ntPop', width: 320, onClose: () => { if (editor === me) editor = null; } });
    box.querySelector('textarea').focus();
}

/* ------------------------------------------------------------------ settings */

// the tag list: colour + name per tag, + Add
function renderTags(el) {
    const n = Object.keys(cfg.people).length;
    el.innerHTML = `<div class="fc-set-title">${E(T('Player notes & tags'))} <small>— ${E(T.plural(n, '{n} player noted', '{n} players noted'))} · ${E(T('only on your PC'))} · /note name</small></div>
        <div class="ntTagList">${cfg.tags.map((t, i) => `<div class="fc-field ntTagRow" data-i="${i}">
            <input type="color" class="fc-input fc-color" value="${E(t.color)}" data-f="color">
            <input type="text" class="fc-input" value="${E(t.label)}" data-f="label" maxlength="24">
            <span class="fc-grow"></span>${fc.ui.btn('', { kind: 'ghost', size: 'sm', icon: 'trash', title: 'Remove tag', attrs: `data-del="${i}"` })}</div>`).join('')}</div>
        <div class="ntAddRow">${fc.ui.btn('Add a tag', { kind: 'sec', size: 'sm', icon: 'plus', act: 'addtag' })}</div>`;
}

function wireTags(el) {
    renderTags(el);
    el.addEventListener('change', (e) => {
        const row = e.target.closest('.ntTagRow');
        const t = row && cfg.tags[+row.dataset.i];
        if (!t) return;
        if (e.target.dataset.f === 'label') t.label = e.target.value.trim() || t.label;
        else if (e.target.dataset.f === 'color') t.color = e.target.value;
        changed();
    });
    el.addEventListener('click', (e) => {
        const del = e.target.closest('[data-del]');
        if (del) {
            const t = cfg.tags[+del.dataset.del];
            if (!t) return;
            cfg.tags.splice(+del.dataset.del, 1);
            Object.keys(cfg.people).forEach(k => { const p = cfg.people[k]; p.tags = (p.tags || []).filter(id => id !== t.id); });
            changed();
        } else if (e.target.closest('[data-act="addtag"]')) {
            cfg.tags.push({ id: 't' + Date.now().toString(36), label: 'New tag', color: '#5865f2' });
            changed();
        }
    });
}

const CSS = `
.ntChips { display: flex; flex-wrap: wrap; margin: 2px -2px; }
.ntChip { display: inline-flex; align-items: center; height: 20px; margin: 2px; padding: 0 8px 0 6px; border-radius: 10px;
    font: 600 11.5px/1 var(--fc-font); color: var(--fc-text); background: rgba(255,255,255,.07);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); white-space: nowrap; }
.ntChip::before { content: ''; width: 8px; height: 8px; margin-right: 5px; border-radius: 50%; background: var(--c); flex: none; }
.ntNote { margin-top: 4px; font-size: 13px; line-height: 1.35; font-style: italic; color: var(--fc-text); opacity: .9;
    overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.ntDots { display: inline-flex; align-items: center; margin-left: 5px; vertical-align: middle; }
.ntDots i { width: 7px; height: 7px; margin-right: 2px; border-radius: 50%; display: inline-block; }
.ntDots i.n { background: transparent; box-shadow: inset 0 0 0 1.5px var(--fc-muted); }
.fc-pop.ntPop { padding: 12px 14px; }
#ntEdit .h { font-size: 14px; color: var(--fc-muted); }
#ntEdit .h b { color: var(--fc-head); }
#ntEdit .tags { display: flex; flex-wrap: wrap; margin: 8px -2px; }
#ntEdit .ntChip.pick { cursor: pointer; opacity: .55; transition: opacity var(--fc-fast), box-shadow var(--fc-fast); }
#ntEdit .ntChip.pick:hover { opacity: .85; }
#ntEdit .ntChip.pick.on { opacity: 1; box-shadow: inset 0 0 0 1.5px var(--c); }
#ntEdit textarea { width: 100%; height: 80px; padding: 8px 10px; resize: none; line-height: 1.4; }
#ntEdit .f { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 12px; }
.ntTagRow .fc-input[type="text"] { width: 180px; margin-left: 8px; height: 30px; }
.ntTagRow .fc-color { height: 30px; }
.ntAddRow { margin-top: 10px; }
`;

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('notes', { people: {}, tags: DEFAULT_TAGS.map(t => Object.assign({}, t)), matchups: {} });
    cfg = store.data;
    if (!cfg.people || typeof cfg.people !== 'object') cfg.people = {};
    if (!Array.isArray(cfg.tags) || !cfg.tags.length) cfg.tags = DEFAULT_TAGS.map(t => Object.assign({}, t));
    if (!cfg.matchups || typeof cfg.matchups !== 'object') cfg.matchups = {};
    fc.on('match:character', onCharacter);
    if (typeof document !== 'undefined') {
        document.addEventListener('click', onMuClick, true);
        fc.own(() => document.removeEventListener('click', onMuClick, true));
    }
    window.__fcNotesLoaded = true;
    fc.ui.style('ntStyle', CSS);
    fc.own(() => { fc.ui.style('ntStyle', null); closeEditor(); window.__fcNotesLoaded = false; });

    fc.cmd('note', 'Notes & tags on a player', (arg, ctx) => { if (arg) edit(arg.split(/\s+/)[0], ctx.input ? ctx.input.getBoundingClientRect() : null); }, { args: '<name>' });
    fc.cmd('notes', 'Notes & tags on a player', (arg, ctx) => { if (arg) edit(arg.split(/\s+/)[0], ctx.input ? ctx.input.getBoundingClientRect() : null); }, { args: '<name>' });

    fc.settings.block({ id: 'notes', section: 'members', order: 30, render: wireTags, refresh: renderTags });
    fc.log('ready,', Object.keys(cfg.people).length, 'players noted');
    return api;
}

const api = {
    get, has, set, toggleTag, chips, dots, edit,
    matchup, setMatchup, matchupRecord, editMatchup, _onCharacter: (ev) => onCharacter(ev),
    tags: () => (cfg ? cfg.tags : DEFAULT_TAGS),
    get _config() { return cfg; }
};

module.exports = { id: 'notes', name: 'Player notes & tags', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
