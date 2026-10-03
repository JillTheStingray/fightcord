/**
 * Fightcord emoji shortcodes
 *
 * Discord-style emoji for Fightcade chat: type  :sob:  and it becomes 😭.
 * The conversion happens before the message is sent, so EVERYONE sees the real
 * emoji -- it travels as plain Unicode, no plugin needed on their side.
 *
 * Usage:
 *   - type  :so   -> a suggestion popup appears (↑/↓, Tab/Enter to pick, Esc)
 *   - type  :sob: -> converted on the spot (and again on send, as a safety net)
 *   - 🙂 button by the chat box opens a searchable picker
 *   - /emoji                 help + your custom shortcodes
 *     /emoji add salt 🧂     add your own shortcode
 *     /emoji del salt        remove it
 *     /emoji find cry        list matches
 *   - :flag_jp: style flags work for any two-letter country code
 *
 * Runs on fightcord-core.js.
 */

'use strict';

let fc = null;
let store = null, config = null;          // emoji-config.json
const DEFAULTS = {
    enabled: true,          // convert :shortcodes: in outgoing messages
    autocomplete: true,     // suggestion popup while typing :na
    custom: {},             // { salt: '🧂', ... } -- user-defined shortcodes
    recent: []              // most recently used shortcode names, newest first
};
const saveConfig = () => store.save();

/* ------------------------------------------------------------------- data */

// "name,alias emoji" pairs. Names follow Discord / GitHub shortcodes so muscle
// memory carries over; a few extra aliases (laugh, lol, dead, ...) on top.
// Deliberately stops at Unicode 12 emoji: FC is Chromium 80, and players on
// older Windows builds would see tofu boxes for anything newer.
const CATEGORIES = {
    'Smileys': `
        grinning 😀  smiley 😃  smile 😄  grin 😁  laughing,laugh,satisfied 😆  sweat_smile 😅
        rofl,rolling_on_the_floor_laughing 🤣  joy,lol 😂  slight_smile,slightly_smiling_face 🙂
        upside_down,upside_down_face 🙃  wink 😉  blush 😊  innocent 😇  smiling_face_with_3_hearts,love 🥰
        heart_eyes 😍  star_struck 🤩  kissing_heart 😘  yum 😋  stuck_out_tongue 😛
        stuck_out_tongue_winking_eye 😜  zany_face,crazy 🤪  stuck_out_tongue_closed_eyes 😝
        money_mouth,money_mouth_face 🤑  hugging,hug,hugs 🤗  hand_over_mouth 🤭  shushing,shh 🤫
        thinking,think,hmm 🤔  zipper_mouth 🤐  raised_eyebrow,sus 🤨  neutral_face 😐  expressionless 😑
        no_mouth 😶  smirk 😏  unamused 😒  rolling_eyes,eyeroll 🙄  grimacing 😬  lying_face 🤥
        relieved 😌  pensive 😔  sleepy 😪  drooling_face,drool 🤤  sleeping 😴  mask 😷
        thermometer_face 🤒  nauseated_face,sick 🤢  vomiting,puke 🤮  sneezing_face 🤧
        hot_face,hot 🥵  cold_face,cold 🥶  woozy_face,woozy 🥴  dizzy_face 😵  exploding_head,mindblown 🤯
        cowboy 🤠  partying_face,party 🥳  sunglasses 😎  nerd 🤓  monocle_face,monocle 🧐
        confused 😕  worried 😟  slight_frown,slightly_frowning_face 🙁  frowning_face ☹️  open_mouth 😮
        hushed 😯  astonished 😲  flushed 😳  pleading_face,pleading 🥺  frowning 😦  anguished 😧
        fearful 😨  cold_sweat 😰  disappointed_relieved 😥  cry 😢  sob 😭  scream 😱
        confounded 😖  persevere 😣  disappointed 😞  sweat 😓  weary 😩  tired_face 😫  yawning_face,yawn 🥱
        triumph 😤  rage,pout 😡  angry 😠  cursing_face,face_with_symbols_over_mouth 🤬
        smiling_imp 😈  imp 👿  skull,dead 💀  skull_crossbones ☠️  poop,shit 💩  clown 🤡
        japanese_ogre 👹  japanese_goblin 👺  ghost 👻  alien 👽  space_invader 👾  robot 🤖
        smiley_cat 😺  joy_cat 😹  heart_eyes_cat 😻  scream_cat 🙀  crying_cat_face 😿  pouting_cat 😾
        see_no_evil 🙈  hear_no_evil 🙉  speak_no_evil 🙊`,

    'People': `
        thumbsup,+1,like 👍  thumbsdown,-1,dislike 👎  ok_hand 👌  pinching_hand 🤏  v ✌️
        crossed_fingers,fingers_crossed 🤞  love_you_gesture 🤟  metal 🤘  call_me 🤙
        point_left 👈  point_right 👉  point_up_2 👆  point_down 👇  point_up ☝️  middle_finger 🖕
        raised_hand,hand ✋  raised_back_of_hand 🤚  hand_splayed 🖐️  vulcan 🖖  wave 👋
        clap 👏  raised_hands 🙌  open_hands 👐  palms_up_together 🤲  handshake 🤝  pray 🙏
        writing_hand ✍️  nail_care 💅  muscle,flex 💪  punch,oncoming_fist 👊  fist ✊
        left_facing_fist 🤛  right_facing_fist 🤜  eyes 👀  eye 👁️  brain 🧠  tongue 👅  lips 👄
        ear 👂  nose 👃  facepalm 🤦  shrug 🤷  bow 🙇  no_good 🙅  raising_hand 🙋
        baby 👶  man 👨  woman 👩  older_man 👴  older_woman 👵  zombie 🧟  vampire 🧛  genie 🧞
        mage 🧙  superhero 🦸  detective 🕵️  cop 👮  construction_worker 👷  prince 🤴  princess 👸
        santa 🎅  angel 👼  dancer 💃  man_dancing 🕺  runner,running 🏃  walking 🚶
        person_fencing 🤺  wrestlers,wrestling 🤼  boxing_glove 🥊  martial_arts_uniform 🥋`,

    'Hearts & symbols': `
        heart ❤️  orange_heart 🧡  yellow_heart 💛  green_heart 💚  blue_heart 💙  purple_heart 💜
        black_heart 🖤  white_heart 🤍  brown_heart 🤎  broken_heart 💔  heart_exclamation ❣️
        two_hearts 💕  revolving_hearts 💞  heartbeat 💓  heartpulse 💗  sparkling_heart 💖
        cupid 💘  gift_heart 💝  100 💯  anger 💢  boom,collision 💥  dizzy 💫  sweat_drops 💦
        dash 💨  zzz 💤  speech_balloon 💬  thought_balloon 💭  fire,lit 🔥  sparkles ✨  star ⭐
        star2,glowing_star 🌟  zap ⚡  white_check_mark,check ✅  heavy_check_mark ✔️  x ❌
        warning ⚠️  no_entry_sign,no_entry 🚫  question ❓  exclamation ❗  bangbang ‼️  interrobang ⁉️
        recycle ♻️  arrow_up ⬆️  arrow_down ⬇️  arrow_left ⬅️  arrow_right ➡️  repeat 🔁
        new 🆕  free 🆓  cool 🆒  up 🆙  sos 🆘  vs 🆚  ok 🆗  red_circle 🔴  green_circle 🟢
        blue_circle 🔵  black_circle ⚫  white_circle ⚪  trophy 🏆  first_place,1st_place_medal 🥇
        second_place,2nd_place_medal 🥈  third_place,3rd_place_medal 🥉  medal 🏅  crown 👑  gem 💎
        moneybag 💰  dollar 💵  chart_with_upwards_trend,stonks 📈  chart_with_downwards_trend,notstonks 📉`,

    'Nature & food': `
        dog 🐶  cat 🐱  mouse 🐭  hamster 🐹  rabbit 🐰  fox 🦊  bear 🐻  panda_face,panda 🐼
        koala 🐨  tiger 🐯  lion_face,lion 🦁  cow 🐮  pig 🐷  frog 🐸  monkey_face 🐵  monkey 🐒
        chicken 🐔  penguin 🐧  bird 🐦  eagle 🦅  owl 🦉  duck 🦆  wolf 🐺  horse 🐴  unicorn 🦄
        bee 🐝  bug 🐛  butterfly 🦋  snail 🐌  snake 🐍  turtle 🐢  octopus 🐙  shark 🦈
        whale 🐳  dolphin 🐬  fish 🐟  crab 🦀  shrimp 🦐  dragon 🐉  dragon_face 🐲  t_rex 🦖
        sauropod 🦕  goat 🐐  sloth 🦥  rat 🐀  rose 🌹  sunflower 🌻  cherry_blossom 🌸  tulip 🌷
        four_leaf_clover 🍀  seedling 🌱  evergreen_tree 🌲  palm_tree 🌴  cactus 🌵  mushroom 🍄
        earth_americas 🌎  full_moon 🌕  new_moon 🌑  crescent_moon 🌙  sun_with_face 🌞  sunny ☀️
        cloud ☁️  rainbow 🌈  snowflake ❄️  snowman ⛄  droplet 💧  ocean 🌊  volcano 🌋  tornado 🌪️
        pizza 🍕  hamburger,burger 🍔  fries 🍟  hotdog 🌭  taco 🌮  ramen 🍜  sushi 🍣  rice 🍚
        bento 🍱  cookie 🍪  cake 🍰  birthday 🎂  doughnut,donut 🍩  icecream 🍦  popcorn 🍿
        candy 🍬  lollipop 🍭  chocolate_bar 🍫  apple 🍎  banana 🍌  strawberry 🍓  watermelon 🍉
        peach 🍑  eggplant 🍆  avocado 🥑  hot_pepper 🌶️  egg 🥚  bread 🍞  cheese 🧀
        poultry_leg 🍗  salt 🧂  coffee ☕  tea 🍵  milk 🥛  cup_with_straw 🥤  beer 🍺  beers 🍻
        wine_glass 🍷  cocktail 🍸  champagne 🍾`,

    'Objects & activities': `
        video_game 🎮  joystick 🕹️  game_die 🎲  dart,bullseye 🎯  crossed_swords ⚔️  shield 🛡️
        bomb 💣  dagger 🗡️  knife 🔪  hammer 🔨  wrench 🔧  gear ⚙️  lock 🔒  unlock 🔓  key 🔑
        bell 🔔  no_bell 🔕  mega 📣  loudspeaker 📢  microphone 🎤  headphones 🎧  musical_note 🎵
        notes 🎶  guitar 🎸  tv 📺  computer 💻  keyboard ⌨️  iphone,phone 📱  camera 📷
        movie_camera 🎥  bulb 💡  book 📖  books 📚  memo,pencil 📝  calendar 📅  pushpin 📌
        paperclip 📎  scissors ✂️  hourglass ⌛  stopwatch ⏱️  alarm_clock ⏰  battery 🔋
        electric_plug 🔌  satellite 📡  coffin ⚰️  rocket 🚀  airplane ✈️  red_car,car 🚗
        ambulance 🚑  tada 🎉  confetti_ball 🎊  balloon 🎈  gift 🎁  ribbon 🎀  soccer ⚽
        basketball 🏀  football 🏈  baseball ⚾  tennis 🎾  bowling 🎳  checkered_flag 🏁
        triangular_flag_on_post,red_flag 🚩  white_flag 🏳️  rainbow_flag 🏳️‍🌈  pirate_flag 🏴‍☠️`,

    // fighting-game shorthand -- not Discord names, just handy here
    'FGC': `
        gg 🤝  parry 🛡️  lag 🐌  rip ⚰️  salty 🧂  hype 🔥  goat 🐐  ez 😎  clutch 😤`
};

// Flags: any :flag_xx: converts (two regional-indicator letters), these ones also
// show up in suggestions and the picker.
const COMMON_FLAGS = ('jp us br gb fr de es it kr cn tw hk mx ca ar cl pe co ve nl be pt ch at ' +
    'se no fi dk pl ru ua tr in id th vn ph my sg au nz sa ae ma eg za ng ie il gr').split(' ');

function flagEmoji(cc) {
    return String.fromCodePoint(...cc.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

const BUILTIN = {};          // name -> emoji
const BY_CATEGORY = {};      // category -> [[primaryName, emoji], ...]
for (const [cat, block] of Object.entries(CATEGORIES)) {
    const toks = block.trim().split(/\s+/);
    BY_CATEGORY[cat] = [];
    for (let i = 0; i + 1 < toks.length; i += 2) {
        const names = toks[i].split(','), emo = toks[i + 1];
        names.forEach(n => { BUILTIN[n] = emo; });
        BY_CATEGORY[cat].push([names[0], emo]);
    }
}
BY_CATEGORY['Flags'] = COMMON_FLAGS.map(cc => ['flag_' + cc, flagEmoji(cc)]);
COMMON_FLAGS.forEach(cc => { BUILTIN['flag_' + cc] = flagEmoji(cc); });

function lookup(name) {
    const n = name.toLowerCase();
    if (config && config.custom[n]) return config.custom[n];
    if (BUILTIN[n]) return BUILTIN[n];
    const flag = n.match(/^flag_([a-z]{2})$/);
    return flag ? flagEmoji(flag[1]) : null;
}

function allNames() {
    return Object.keys(config.custom).concat(Object.keys(BUILTIN).filter(n => !config.custom[n]));
}

/* ------------------------------------------------------------- conversion */

// :name: not glued onto a word ("a:sob:" stays). Only known names convert, so
// times like 10:30:45 fall through untouched. Lookbehind rather than a consumed
// prefix char, so back-to-back :sob::sob: converts both.
const SHORTCODE = /(?<!\w):([a-z0-9_+\-]{1,32}):/gi;

function convertShortcodes(text, used) {
    if (!text || text.startsWith('/')) return text;     // leave FC commands alone
    return text.split(/(\s+)/).map(tok => {
        if (/^[a-z][\w+.-]*:\/\//i.test(tok)) return tok; // URLs
        return tok.replace(SHORTCODE, (m, name) => {
            const e = lookup(name);
            if (!e) return m;
            if (used) used.push(name.toLowerCase());
            return e;
        });
    }).join('');
}

function noteRecent(names) {
    if (!names.length) return;
    const r = config.recent.filter(n => !names.includes(n));
    config.recent = names.concat(r).slice(0, 24);
    saveConfig();
}

/* -------------------------------------------------------------- search */

function search(q, limit) {
    q = q.toLowerCase();
    const recentRank = (n) => { const i = config.recent.indexOf(n); return i < 0 ? 99 : i; };
    const seen = new Set();
    const hits = [];
    for (const n of allNames()) {
        let score;
        if (n === q) score = 0;
        else if (n.startsWith(q)) score = 1;
        else if (n.split('_').some(p => p.startsWith(q))) score = 2;
        else if (q.length >= 3 && n.includes(q)) score = 3;
        else continue;
        hits.push({ name: n, emoji: lookup(n), score, recent: recentRank(n), custom: !!config.custom[n] });
    }
    hits.sort((a, b) => a.score - b.score || a.recent - b.recent ||
        (b.custom - a.custom) || a.name.length - b.name.length || (a.name < b.name ? -1 : 1));
    // one row per emoji -- the best-scoring alias wins
    return hits.filter(h => !seen.has(h.emoji) && seen.add(h.emoji)).slice(0, limit || 8);
}

/* --------------------------------------------------------------- chat hook */

const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
let selfInput = false;

function setInputValue(el, value, caret) {
    selfInput = true;
    try {
        nativeValueSetter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    } finally { selfInput = false; }
    if (caret != null) el.setSelectionRange(caret, caret);
}

function isChatInput(el) {
    return el && el.tagName === 'INPUT' && el.closest && el.closest('.chatInput');
}

function insertAtCaret(el, text) {
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
    setInputValue(el, el.value.slice(0, s) + text + el.value.slice(e), s + text.length);
}

function toast(msg) {
    const lines = String(msg).split('\n').filter(Boolean);
    fc.ui.toast(lines[0], { icon: 'chat', sub: lines.slice(1).join(' · '), ms: 6000 });
}

function handleEmojiCommand(arg) {
    const parts = (arg || '').trim().split(/\s+/).filter(Boolean);
    const sub = (parts.shift() || '').toLowerCase();

    if (sub === 'add') {
        const name = (parts.shift() || '').toLowerCase().replace(/^:|:$/g, '');
        const emo = parts.join(' ');
        if (!/^[a-z0-9_+\-]{1,32}$/.test(name) || !emo) {
            toast('Usage: /emoji add <name> <emoji or text>\ne.g. /emoji add salt 🧂'); return;
        }
        config.custom[name] = emo;
        saveConfig();
        toast(':' + name + ':  ->  ' + emo);
        return;
    }
    if (sub === 'del' || sub === 'remove' || sub === 'rm') {
        const name = (parts.shift() || '').toLowerCase().replace(/^:|:$/g, '');
        if (!config.custom[name]) { toast('No custom shortcode :' + name + ':'); return; }
        delete config.custom[name];
        saveConfig();
        toast(':' + name + ': removed');
        return;
    }
    if (sub === 'find' || sub === 'search') {
        const hits = search(parts.join('_') || '', 20);
        toast(hits.length ? hits.map(h => h.emoji + '  :' + h.name + ':').join('\n') : 'No matches');
        return;
    }
    if (sub === 'on' || sub === 'off') {
        config.enabled = sub === 'on';
        saveConfig();
        fc.settings.refresh('emoji');
        toast('Emoji shortcodes ' + sub);
        return;
    }
    const custom = Object.entries(config.custom).map(([k, v]) => v + '  :' + k + ':').join('\n');
    toast('Emoji shortcodes: ' + (config.enabled ? 'on' : 'off') + '\n' +
        '/emoji add <name> <emoji>   /emoji del <name>\n' +
        '/emoji find <word>   /emoji on|off\n\n' +
        'Your shortcodes:\n' + (custom || 'none yet'));
}

/* --------------------------------------------------------- suggestion popup */

let popup = null;   // { el, input, start, query, items, sel }

// The ":quer" being typed right before the caret, if any.
function pendingQuery(el) {
    const caret = el.selectionStart;
    if (caret == null || caret !== el.selectionEnd) return null;
    const before = el.value.slice(0, caret);
    const m = before.match(/(?<![\w:]):([a-z0-9_+\-]{2,32})$/i);
    if (!m || el.value.startsWith('/')) return null;
    return { start: caret - m[1].length - 1, query: m[1] };
}

function closePopup() {
    if (popup) popup.el.remove();
    popup = null;
}

function renderPopup() {
    const { el, items, sel, query } = popup;
    const q = query.toLowerCase();
    el.innerHTML = `<div style="padding:4px 8px 6px;font-size:10px;letter-spacing:.06em;opacity:.5;
            text-transform:uppercase;">emoji matching <b>:${escapeHtml(query)}</b></div>` +
        items.map((h, i) => {
            const at = h.name.indexOf(q);
            const nm = at < 0 ? escapeHtml(h.name) : escapeHtml(h.name.slice(0, at)) +
                '<b style="color:#fff;">' + escapeHtml(h.name.slice(at, at + q.length)) + '</b>' +
                escapeHtml(h.name.slice(at + q.length));
            return `<div class="emjRow" data-i="${i}" style="display:flex;align-items:center;padding:4px 8px;
                border-radius:4px;cursor:pointer;${i === sel ? 'background:var(--accentColor,rgba(100,149,237,.35));' : ''}">
                <span style="flex:none;width:26px;font-size:18px;line-height:1.2;">${escapeHtml(h.emoji)}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                    color:rgba(255,255,255,.8);">:${nm}:</span>
                ${h.custom ? '<span style="flex:none;margin-left:6px;font-size:10px;opacity:.45;">custom</span>' : ''}
            </div>`;
        }).join('') +
        `<div style="padding:5px 8px 2px;font-size:10px;opacity:.4;">↑↓ select · Tab / Enter pick · Esc close</div>`;
}

function updatePopup(input) {
    if (!config.autocomplete || !config.enabled) { closePopup(); return; }
    const p = pendingQuery(input);
    const items = p ? search(p.query) : [];
    if (!items.length) { closePopup(); return; }

    if (!popup || popup.input !== input) {
        closePopup();
        const el = document.createElement('div');
        el.id = 'emojiSuggest';
        el.style.cssText = 'position:fixed;z-index:100000;box-sizing:border-box;padding:4px;' +
            'background:var(--mainColor-darker,#14161a);border:1px solid var(--mainColor-light,rgba(255,255,255,.25));' +
            'border-radius:6px;font-size:13px;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.5);';
        // mousedown, not click: keep focus in the chat box
        el.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            const row = e.target.closest('.emjRow');
            if (row) { popup.sel = +row.dataset.i; accept(); }
        });
        el.addEventListener('click', (e) => e.stopPropagation());
        document.body.appendChild(el);
        popup = { el, input, sel: 0 };
    }
    const prevName = popup.items && popup.items[popup.sel] && popup.items[popup.sel].name;
    Object.assign(popup, p, { items });
    const keep = items.findIndex(h => h.name === prevName);
    popup.sel = keep >= 0 ? keep : 0;

    const r = input.getBoundingClientRect();
    popup.el.style.left = r.left + 'px';
    popup.el.style.width = Math.min(Math.max(r.width, 220), 340) + 'px';
    popup.el.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    renderPopup();
}

function accept() {
    const { input, start, query, items, sel } = popup;
    const h = items[sel];
    const end = start + 1 + query.length;
    const tail = input.value.slice(end).replace(/^\S*?:/, '');   // eat a half-typed ":sob:" tail
    const ins = h.emoji + (tail.startsWith(' ') ? '' : ' ');
    setInputValue(input, input.value.slice(0, start) + ins + tail, start + ins.length);
    noteRecent([h.name]);
    closePopup();
}

// Live conversion: the moment a closing colon completes a known shortcode.
function onInput(e) {
    if (selfInput || !isChatInput(e.target)) return;
    const el = e.target;
    // any insertion (typed, pasted, IME) -- but not deletions, or backspacing
    // back to a ":sob:" would snap it into an emoji again
    const inserting = !e.inputType || e.inputType.startsWith('insert');
    if (config.enabled && inserting && !el.value.startsWith('/')) {
        const caret = el.selectionStart;
        const before = el.value.slice(0, caret);
        const m = before.match(/(?<!\w):([a-z0-9_+\-]{1,32}):$/i);
        const emo = m && lookup(m[1]);
        if (emo) {
            const start = caret - m[1].length - 2;
            setInputValue(el, el.value.slice(0, start) + emo + el.value.slice(caret), start + emo.length);
            noteRecent([m[1].toLowerCase()]);
        }
    }
    updatePopup(el);
}

// Registered on WINDOW in the capture phase, so it runs before fontstyle.js
// (document, capture) and before Fightcade's own Enter handler. That ordering is
// the point: shortcodes become emoji before anything styles or sends the text.
function onKeyDown(e) {
    const el = e.target;
    if (!isChatInput(el)) return;

    if (popup && popup.input === el) {
        const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
        if (e.key === 'ArrowDown') { stop(); popup.sel = (popup.sel + 1) % popup.items.length; renderPopup(); return; }
        if (e.key === 'ArrowUp') { stop(); popup.sel = (popup.sel - 1 + popup.items.length) % popup.items.length; renderPopup(); return; }
        if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) { stop(); accept(); return; }
        if (e.key === 'Escape') { stop(); closePopup(); return; }
    }

    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const raw = el.value;
    if (!raw) return;

    if (!config.enabled) return;
    const used = [];
    const out = convertShortcodes(raw, used);
    if (out !== raw) { setInputValue(el, out); noteRecent(used); }
    // event continues -> fontstyle (if installed) styles it, Fightcade sends it
}

/* ---------------------------------------------------------------- picker */

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function closePicker() {
    document.getElementById('emojiPicker')?.remove();
}

function pickerCell(name, emo) {
    // inline-block cells, not grid/flex gap: FC's Chromium 80 has no flex gap
    return `<span class="emjCell" data-name="${escapeHtml(name)}" data-emoji="${escapeHtml(emo)}"
        style="display:inline-block;vertical-align:top;min-width:32px;height:32px;line-height:32px;text-align:center;font-size:20px;white-space:nowrap;box-sizing:border-box;padding:0 2px;
        border-radius:4px;cursor:pointer;">${escapeHtml(emo)}</span>`;
}

function pickerBody(q) {
    const head = (t) => `<div style="padding:8px 4px 2px;font-size:10px;letter-spacing:.06em;opacity:.5;
        text-transform:uppercase;">${escapeHtml(t)}</div>`;
    if (q) {
        const hits = search(q.replace(/\s+/g, '_'), 64);
        return hits.length ? hits.map(h => pickerCell(h.name, h.emoji)).join('')
            : '<div style="padding:12px 4px;opacity:.5;">No matches</div>';
    }
    let html = '';
    const recent = config.recent.filter(lookup).slice(0, 16);
    if (recent.length) html += head('Recent') + recent.map(n => pickerCell(n, lookup(n))).join('');
    const custom = Object.entries(config.custom);
    if (custom.length) html += head('Custom') + custom.map(([n, e]) => pickerCell(n, e)).join('');
    for (const [cat, items] of Object.entries(BY_CATEGORY)) {
        html += head(cat) + items.map(([n, e]) => pickerCell(n, e)).join('');
    }
    return html;
}

function openPicker(anchor) {
    if (document.getElementById('emojiPicker')) { closePicker(); return; }
    closePopup();
    const input = anchor.closest('.chatInput')?.querySelector('input.input');
    const rect = anchor.getBoundingClientRect();
    const W = 8 * 32 + 26;   // 8 columns + padding + scrollbar

    const box = document.createElement('div');
    box.id = 'emojiPicker';
    box.style.cssText = 'position:fixed;z-index:100000;box-sizing:border-box;width:' + W + 'px;' +
        'background:var(--mainColor-darker,#14161a);border:1px solid var(--mainColor-light,rgba(255,255,255,.25));' +
        'border-radius:6px;padding:6px;font-size:13px;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.5);' +
        'left:' + Math.max(8, rect.right - W) + 'px;bottom:' + (window.innerHeight - rect.top + 8) + 'px;';
    box.innerHTML = `
        <input class="emjSearch" type="text" placeholder="Search emoji…" style="display:block;box-sizing:border-box;
            width:100%;padding:6px 8px;border-radius:4px;outline:none;font-size:13px;color:#fff;
            background:rgba(0,0,0,.35);border:1px solid var(--mainColor-light,rgba(255,255,255,.25));">
        <div class="emjGrid" style="height:260px;overflow-y:auto;margin-top:6px;"></div>
        <div class="emjFoot" style="height:18px;padding-top:6px;font-size:12px;opacity:.6;white-space:nowrap;
            overflow:hidden;text-overflow:ellipsis;">Click to insert · shift-click keeps it open</div>`;

    const grid = box.querySelector('.emjGrid');
    const foot = box.querySelector('.emjFoot');
    const search_ = box.querySelector('.emjSearch');
    const fill = () => { grid.innerHTML = pickerBody(search_.value.trim()); };
    fill();

    search_.addEventListener('input', fill);
    search_.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { closePicker(); input?.focus(); }
        if (e.key === 'Enter') grid.querySelector('.emjCell')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    grid.addEventListener('mouseover', (e) => {
        const c = e.target.closest('.emjCell');
        grid.querySelectorAll('.emjCell').forEach(x => { x.style.background = ''; });
        if (!c) return;
        c.style.background = 'rgba(255,255,255,.12)';
        foot.textContent = c.dataset.emoji + '  :' + c.dataset.name + ':';
    });
    box.addEventListener('click', (e) => {
        e.stopPropagation();
        const c = e.target.closest('.emjCell');
        if (!c || !input) return;
        input.focus();
        insertAtCaret(input, c.dataset.emoji);
        noteRecent([c.dataset.name]);
        if (!e.shiftKey) closePicker();
    });

    document.body.appendChild(box);
    search_.focus();
    setTimeout(() => document.addEventListener('click', closePicker, { once: true }), 0);
}

function ensureChatButton() {
    document.querySelectorAll('.chatInput').forEach(wrap => {
        let btn = wrap.querySelector('.emojiBtn');
        if (!btn) {
            if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
            btn = document.createElement('div');
            btn.className = 'emojiBtn';
            btn.textContent = '🙂';
            btn.title = 'Emoji (or type :name: in chat)';
            btn.style.cssText = 'position:absolute;top:50%;transform:translateY(-50%);z-index:50;' +
                'cursor:pointer;font-size:14px;line-height:1;padding:3px 4px;border-radius:4px;' +
                'background:rgba(0,0,0,.35);border:1px solid var(--mainColor-light,rgba(255,255,255,.25));' +
                'opacity:.75;user-select:none;';
            btn.addEventListener('mouseenter', () => btn.style.opacity = '1');
            btn.addEventListener('mouseleave', () => btn.style.opacity = '.75');
            btn.addEventListener('click', (e) => { e.stopPropagation(); openPicker(btn); });
            wrap.appendChild(btn);
        }
        // sit left of fontstyle's "Aa" button when that plugin is installed
        const aa = wrap.querySelector('.fontStyleBtn');
        const right = aa ? aa.offsetWidth + 16 : 10;
        if (btn.style.right !== right + 'px') btn.style.right = right + 'px';
        // keep typed text from running under the buttons
        const input = wrap.querySelector('input.input');
        const need = right + btn.offsetWidth + 8;
        if (input && parseFloat(getComputedStyle(input).paddingRight) < need) input.style.paddingRight = need + 'px';
    });
}

/* -------------------------------------------------------------------- module */

function start(f) {
    fc = f;
    store = fc.config('emoji', DEFAULTS);
    config = store.data;
    if (!config.custom || typeof config.custom !== 'object') config.custom = {};
    if (!Array.isArray(config.recent)) config.recent = [];
    window.__fcEmojiLoaded = true;
    const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); fc.own(() => t.removeEventListener(ev, fn, o)); };
    // window + capture: before fontstyle (document, capture) and Fightcade's own Enter handler,
    // so shortcodes become emoji before anything styles or sends the text
    listen(window, 'keydown', onKeyDown, true);
    listen(document, 'input', onInput, true);
    // caret moved by mouse/arrow keys -> re-evaluate (or drop) the popup
    listen(document, 'click', (e) => { if (isChatInput(e.target)) updatePopup(e.target); }, true);
    listen(document, 'keyup', (e) => { if (isChatInput(e.target) && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) updatePopup(e.target); }, true);
    listen(document, 'focusout', (e) => {
        if (popup && e.target === popup.input) setTimeout(() => { if (popup && document.activeElement !== popup.input) closePopup(); }, 100);
    }, true);
    listen(window, 'resize', closePopup);
    fc.own(() => { closePopup(); closePicker(); document.querySelectorAll('.emojiBtn').forEach(b => b.remove()); window.__fcEmojiLoaded = false; });
    fc.watch(ensureChatButton, { selector: '.chatInput' });
    fc.cmd('emoji', 'Emoji shortcodes: add / del / find / on / off', handleEmojiCommand, { args: 'add <name> <emoji>|del <name>|find <word>' });
    fc.settings.block({
        id: 'emoji', section: 'chat', title: 'Emoji shortcodes', hint: '— everyone sees them', store: store, order: 30,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Convert :sob: → 😭', hint: 'When you send' },
            { key: 'autocomplete', type: 'switch', label: 'Suggestions', hint: 'A popup while typing :so…', show: (d) => d.enabled, onChange: (v) => { if (!v) closePopup(); } },
            { type: 'note', label: '🙂 button by the chat box · /emoji add salt 🧂 for your own · :flag_jp: for flags' }
        ]
    });
    ensureChatButton();
    fc.log('ready -', Object.keys(BUILTIN).length, 'shortcodes,', Object.keys(config.custom).length, 'custom');
    return api;
}

const api = {
    convertShortcodes: (t, used) => convertShortcodes(t, used),
    search: (q, n) => search(q, n),
    lookup: (n) => lookup(n),
    get _config() { return config; }
};

module.exports = { id: 'emoji', name: ':emoji: shortcodes', start };
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
