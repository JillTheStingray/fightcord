/**
 * Fightcord matchup trials (3.16 prototype)
 *
 * Practice a matchup offline: Fightcade's own training mode with a dummy that plays the opponent's
 * character and does one thing on repeat, and a count of whether you dealt with it. First trial: parry
 * Chun-Li's cr.MK.
 *
 * How: Fightcade's training mode (fcade://training/<emu>/<rom>) runs the FBNeo training script, which runs
 * any game addon listed in games/<game>/addon/addons.lua. Fightcord puts its trial there
 * (fightcord-trial.lua, below) and a request file next to it; the trial reads the request once and
 * deletes it, so opening training mode normally afterwards is untouched. It writes its progress to
 * fightcord-trial.out, which Fightcord reads while the emulator is open. The game itself is never
 * changed: the trial only presses the dummy's buttons and reads the game's memory, like the training
 * script does.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let fc = null;
let store = null, cfg = null;
const T = (s, v) => fc.t(s, v);

// rom: the games it runs in; char: the dummy's character id in the game (3rd Strike: 16 = Chun-Li)
const TRIALS = [
    { id: '3s-chun-crmk', game: 'sfiii3', rom: /^sfiii3/i, opp: 'Chun-Li', char: 16, goal: 5,
        title: 'Parry Chun-Li’s cr.MK', hint: 'She pokes with cr.MK at random moments: tap down to parry it',
        luaTitle: "Parry Chun-Li's cr.MK", luaHint: 'She pokes with cr.MK: tap down to parry it' }
];

const LUA = String.raw`-- Fightcord matchup trial (3rd Strike). Written here by Fightcord, run by Fightcade's training mode as a
-- game addon. It does nothing unless Fightcord asked for a trial: Fightcord writes fightcord-trial.req
-- next to this file, the trial reads it once and deletes it, so the next normal training is untouched.
-- Fightcord reads progress back from fightcord-trial.out. Nothing here is from another script: the
-- memory addresses are the game's own (the same ones Fightcord's goals read).

local DIR = "games/sfiii3/addon/"
local REQ, OUT, LOG = DIR .. "fightcord-trial.req", DIR .. "fightcord-trial.out", DIR .. "fightcord-trial.log"

local function readfile(p) local f = io.open(p, "r") if not f then return nil end local s = f:read("*a") f:close() return s end
local req = readfile(REQ)
if not req then return end
if os and os.remove then os.remove(REQ) end

local cfg = {}
for k, v in string.gmatch(req, "([%w_]+)=([^\r\n]*)") do cfg[k] = v end
local GOAL = tonumber(cfg.goal) or 5
local OPP = tonumber(cfg.char) or 16                 -- the dummy's character (16 = Chun-Li)
local TITLE = cfg.title or "Parry Chun-Li's cr.MK"
local HINT = cfg.hint or "She pokes with cr.MK: tap down to parry it"
local AUTO = cfg.auto or ""                          -- tests only: "hit" / "block" / "parry" plays P1 too

local logf = io.open(LOG, "w")
local function log(s) if logf then logf:write(s, "\n") logf:flush() end end
log("trial " .. (cfg.trial or "?") .. " goal " .. GOAL .. " opp " .. OPP .. (AUTO ~= "" and (" auto " .. AUTO) or ""))

-- the game's memory
local BASE = { 0x02068C6C, 0x02069104 }
local SEL_STATE = { 0x0201553D, 0x02015545 }
local SEL_ID = { 0x02011387, 0x02011388 }
local rb, rw = memory.readbyte, memory.readword
local function inMatch() return (rb(0x020154C6) == 0xFF or rb(0x020154C8) == 0xFF) and rb(0x020154A7) == 0x02 end
local function posx(i) return memory.readwordsigned(BASE[i] + 0x64) end
local function charOf(i) return rw(BASE[i] + 0x3C0) end
local function marker(i) return rw(BASE[i] + 0x32E) end
local function hits(i) return rw(BASE[i] + 0x33E) end

-- results
local st = { streak = 0, best = 0, parried = 0, blocked = 0, hit = 0, tries = 0, passed = false }
local function save(status)
    local f = io.open(OUT, "w")
    if not f then return end
    f:write("trial=", cfg.trial or "", "\nstatus=", status, "\ngoal=", GOAL, "\nstreak=", st.streak, "\nbest=", st.best,
        "\nparried=", st.parried, "\nblocked=", st.blocked, "\nhit=", st.hit, "\ntries=", st.tries, "\npassed=", st.passed and 1 or 0,
        "\nframe=", emu.framecount(), "\n")
    f:close()
end
save("started")

-- this frame's inputs for the dummy (and, in tests, for P1)
local pad = {}
local function press(k) pad[k] = true end

-- character select: P1 picks as usual; the dummy joins, picks anyone, and becomes the trial's character
local sel = { last1 = -1, last2 = -1, chosenAt = nil, wrote = false }
local function selectStep(f)
    local s1, s2 = rb(SEL_STATE[1]), rb(SEL_STATE[2])
    if s1 ~= sel.last1 or s2 ~= sel.last2 then log("f" .. f .. " select p1=" .. s1 .. " p2=" .. s2) sel.last1, sel.last2 = s1, s2 end
    local pulse = (f % 20) < 2
    if AUTO ~= "" and s1 <= 4 then
        if s1 == 0 then if (f % 60) < 2 then press("P1 Coin") elseif (f % 60) >= 30 and (f % 60) < 32 then press("P1 Start") end
        elseif pulse then press("P1 Weak Punch") end
    end
    if s2 == 0 and s1 > 0 then
        if (f % 60) < 2 then press("P2 Coin") elseif (f % 60) >= 30 and (f % 60) < 32 then press("P2 Start") end
    elseif s2 >= 1 and s2 <= 4 then
        if s2 > 2 and not sel.chosenAt then sel.chosenAt = f end
        if sel.chosenAt and not sel.wrote and f >= sel.chosenAt + 20 then
            memory.writebyte(SEL_ID[2], OPP)
            sel.wrote = true
            log("f" .. f .. " dummy set to " .. OPP)
        end
        if pulse and (s2 <= 2 or sel.wrote) then press("P2 Weak Punch") end
    end
end

-- the dummy: walk to poke range, wait a random moment, cr.MK, then see what happened
math.randomseed(os and os.time and os.time() or 1)
local d = { phase = "approach", t = 0, wait = 0, range = 0, attackAt = 0, m0 = 0, h0 = 0, outcome = nil }
local function newRange() d.range = math.random(78, 100) end
newRange()
local function forward(dir) return dir and "P2 Left" or "P2 Right" end

local function dummyStep(f)
    local x1, x2 = posx(1), posx(2)
    local p1Left = x1 < x2
    local dist = math.abs(x2 - x1)
    d.t = d.t + 1
    if d.phase == "approach" then
        if dist > d.range then press(forward(p1Left))
        elseif dist < d.range - 30 then press(p1Left and "P2 Right" or "P2 Left")
        else d.phase, d.t, d.wait = "wait", 0, math.random(6, 45) end
        if d.t > 240 then d.phase, d.t, d.wait = "wait", 0, 4 end   -- can't reach: poke anyway
    elseif d.phase == "wait" then
        if d.t >= d.wait then
            d.phase, d.t, d.attackAt = "attack", 0, f
            d.m0, d.h0, d.outcome = marker(1), hits(1), nil
        end
    elseif d.phase == "attack" then
        press("P2 Down")
        if d.t <= 3 then press("P2 Medium Kick") end
        if d.t >= 6 then d.phase, d.t = "watch", 0 end
    elseif d.phase == "watch" then
        if d.t >= 34 then
            local o = d.outcome
            if o then
                st.tries = st.tries + 1
                if o == "parry" then
                    st.parried, st.streak = st.parried + 1, st.streak + 1
                    if st.streak > st.best then st.best = st.streak end
                    if st.streak >= GOAL and not st.passed then st.passed = true log("f" .. f .. " passed") end
                elseif o == "block" then st.blocked, st.streak = st.blocked + 1, 0
                else st.hit, st.streak = st.hit + 1, 0 end
                log("f" .. f .. " " .. o .. " dist " .. dist .. " streak " .. st.streak)
                save(st.passed and "passed" or "running")
            else
                d.range = math.max(60, d.range - 8)              -- whiffed: step in a little next time
                log("f" .. f .. " whiff dist " .. dist)
            end
            newRange()
            if not o then d.range = math.max(60, d.range - 10) end
            d.phase, d.t = "approach", 0
        end
    end
    -- what P1's side shows after the poke: a parry (0xFFF1), a block (any other mark), or a hit taken
    if (d.phase == "attack" or d.phase == "watch") and not d.outcome then
        local m, h = marker(1), hits(1)
        if h ~= d.h0 then d.outcome = "hit"
        elseif d.m0 == 0 and m ~= 0 then d.outcome = (m == 0xFFF1) and "parry" or "block" end
    end
end

-- tests: P1 does the same thing every time
local function autoStep()
    if AUTO == "" then return end
    if d.phase == "attack" or (d.phase == "watch" and d.t < 10) then
        local since = (d.phase == "attack") and d.t or (d.t + 7)
        if AUTO == "block" then press("P1 Down") press(posx(1) < posx(2) and "P1 Left" or "P1 Right")
        elseif AUTO == "parry" and since == 1 then press("P1 Down") end
    end
end

local function frame()
    pad = {}
    local f = emu.framecount()
    if inMatch() then
        if charOf(2) == OPP then dummyStep(f) autoStep() end
    else
        selectStep(f)
        if d.phase ~= "approach" then d.phase, d.t = "approach", 0 end
    end
    if next(pad) then joypad.set(pad) end
end

local shotDone = false
-- a dark panel under the timer, each line centred (the game's picture is 384 wide; gui.text is 4 px a letter)
local GOLD, WHITE, GREEN, RED = 0xFFD24AFF, 0xFFFFFFFF, 0x5BE37DFF, 0xFF6A6AFF
local function panel(lines)
    local w = 0
    for _, l in ipairs(lines) do if #l[1] > w then w = #l[1] end end
    local half = w * 2 + 8
    gui.box(192 - half, 40, 192 + half, 44 + #lines * 10, 0x000000B0, 0x00000000)
    for i, l in ipairs(lines) do gui.text(192 - #l[1] * 2, 34 + i * 10, l[1], l[2], 0x000000FF) end
end
local function draw()
    local head = { "FIGHTCORD TRIAL: " .. TITLE, GOLD }
    if not inMatch() then
        panel({ head, { "Pick your character. The dummy picks itself.", WHITE } })
    elseif charOf(2) ~= OPP then
        panel({ head, { "P2 isn't the trial's character: go back to character select", RED } })
    else
        local lines = { head, { HINT, WHITE },
            { "In a row " .. st.streak .. "/" .. GOAL .. "    best " .. st.best .. "    parried " .. st.parried .. "  blocked " .. st.blocked .. "  hit " .. st.hit, st.passed and GREEN or WHITE } }
        if st.passed then lines[#lines + 1] = { "Trial cleared! Keep going, or close the emulator.", GREEN } end
        panel(lines)
    end
    -- tests only: a picture of the screen once a few pokes have gone by
    if cfg.shot and st.tries == 6 and not shotDone and gd and gui.gdscreenshot then
        shotDone = true
        local ok, err = pcall(function() gd.createFromGdStr(gui.gdscreenshot()):png(cfg.shot) end)
        log("shot " .. tostring(ok) .. " " .. tostring(err))
    end
end

-- the training script runs these each frame: it owns the emulator's frame and exit hooks (registering our
-- own would replace its, and it saves its settings on exit), so progress is saved as it changes instead
table.insert(registers.registerbefore, frame)
table.insert(registers.guiregister, draw)
log("ready")
`;

const ADDONS = '-- Fightcord: game addons for the training script (Fightcord\'s matchup trials)\r\naddons_run = {\r\n\t"fightcord-trial.lua",\r\n}\r\n';

/* --------------------------------------------------------------- pure parts */

const forMatchup = (rom, oppChar) => TRIALS.filter(t => t.rom.test(String(rom || '')) && String(oppChar || '').toLowerCase() === t.opp.toLowerCase());
const byId = (id) => TRIALS.find(t => t.id === id) || null;

// "key=value" lines -> object (whole numbers as numbers)
function parseOut(text) {
    const o = {};
    String(text || '').split(/\r?\n/).forEach(l => {
        const i = l.indexOf('=');
        if (i <= 0) return;
        const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim();
        o[k] = /^-?\d+$/.test(v) ? Number(v) : v;
    });
    return o;
}

// the request file: key=value lines the Lua side reads (no newlines or '=' inside values)
function requestText(t, extra) {
    const clean = (s) => String(s).replace(/[\r\n=]/g, ' ');
    const lines = Object.assign({ trial: t.id, char: t.char, goal: t.goal, title: t.luaTitle, hint: t.luaHint, at: Date.now() }, extra || {});
    return Object.keys(lines).map(k => k + '=' + clean(lines[k])).join('\n') + '\n';
}

// keep any other game addons someone listed: add ours to their list instead of replacing it
function addonsText(existing) {
    if (existing == null || !String(existing).trim()) return ADDONS;
    if (/fightcord-trial\.lua/.test(existing)) return existing;
    return String(existing).replace(/\s*$/, '') + '\r\n-- Fightcord\'s matchup trials\r\ntable.insert(addons_run, "fightcord-trial.lua")\r\n';
}

/* ------------------------------------------------------------------ running */

const gameDir = (game) => path.join(fc.emu.dir(), '..', 'fbneo-training-mode', 'games', game);
let live = null;                 // { t, dir, since, seen, last, done }

function openUri(u) { try { (window.__fcdOpenUri || ((x) => window.location.assign(x)))(u); } catch (e) { fc.log('open failed', e.message); } }

async function start(id, rom, opts) {
    const t = byId(id);
    if (!t) return false;
    const o = opts || {};
    if (!fs.existsSync(gameDir(t.game))) { fc.ui.toast(T('Fightcade’s training mode for this game isn’t installed'), { icon: 'warn' }); return false; }
    if (await fc.emu.running()) { fc.ui.toast(T('Close the emulator first, then start the trial'), { icon: 'info' }); return false; }
    const dir = path.join(gameDir(t.game), 'addon');
    try {
        fs.mkdirSync(dir, { recursive: true });
        const listFile = path.join(dir, 'addons.lua');
        let cur = null;
        try { cur = fs.readFileSync(listFile, 'utf8'); } catch (e) { /* none yet */ }
        const next = addonsText(cur);
        if (next !== cur) fs.writeFileSync(listFile, next);
        fs.writeFileSync(path.join(dir, 'fightcord-trial.lua'), LUA.replace(/\r?\n/g, '\r\n'));
        try { fs.unlinkSync(path.join(dir, 'fightcord-trial.out')); } catch (e) { /* none */ }
        fs.writeFileSync(path.join(dir, 'fightcord-trial.req'), requestText(t, o.auto ? { auto: o.auto } : null));
    } catch (e) {
        fc.log.error('trial setup', e);
        fc.ui.toast(T('Couldn’t set up the trial'), { icon: 'warn', sub: e.message });
        return false;
    }
    live = { t, dir, since: Date.now(), seen: false, last: null, done: false };
    openUri('fcade://training/fbneo/' + (rom || 'sfiii3nr1'));
    fc.ui.toast(T('Starting the trial: {title}', { title: T(t.title) }), { icon: 'target', ms: 9000,
        sub: T('Pick your character. The dummy picks {char} by itself', { char: t.opp }) });
    return true;
}

function record(t) { return cfg.results[t.id] || (cfg.results[t.id] = { best: 0, passed: 0, sessions: 0 }); }

function keep(r) {
    const rec = record(live.t);
    rec.best = Math.max(rec.best || 0, r.best || 0);
    rec.last = { at: Date.now(), best: r.best || 0, parried: r.parried || 0, blocked: r.blocked || 0, hit: r.hit || 0 };
    store.save();
}

// while the emulator is open: read the trial's progress; when it closes, the summary
async function poll() {
    if (!live || live.done) return;
    let r = null;
    try { r = parseOut(fs.readFileSync(path.join(live.dir, 'fightcord-trial.out'), 'utf8')); } catch (e) { /* not yet */ }
    if (r && r.trial === live.t.id) {
        const was = live.last;
        live.last = r;
        if (r.passed && !(was && was.passed)) {
            record(live.t).passed = (record(live.t).passed || 0) + 1;
            keep(r);
            fc.ui.toast(T('Trial cleared: {title}', { title: T(live.t.title) }), { icon: 'trophy', sub: T('{n} in a row', { n: r.streak }), ms: 9000 });
            fc.emit('trial:passed', { id: live.t.id });
        }
    }
    if (await fc.emu.running()) { live.seen = true; return; }
    if (!live.seen && Date.now() - live.since < 120000) return;      // still opening
    live.done = true;
    if (live.last) {
        keep(live.last);
        record(live.t).sessions = (record(live.t).sessions || 0) + 1;
        store.save();
        if (!live.last.passed && (live.last.tries || 0) > 0)
            fc.ui.toast(T('Trial: {title}', { title: T(live.t.title) }), { icon: 'target', ms: 9000,
                sub: T('Best {best} in a row of {goal}. Parried {p}, blocked {b}, hit {h}', { best: live.last.best || 0, goal: live.last.goal || live.t.goal, p: live.last.parried || 0, b: live.last.blocked || 0, h: live.last.hit || 0 }) });
    }
    fc.emit('trial:done', { id: live.t.id });
}

/* ------------------------------------------------------------------- module */

function startModule(f) {
    fc = f;
    store = fc.config('trials', { results: {} });
    cfg = store.data;
    if (!cfg.results || typeof cfg.results !== 'object') cfg.results = {};
    fc.tick(poll, 2000, { whileHidden: true });
    return api;
}

const api = {
    forMatchup, byId, start, list: () => TRIALS.slice(),
    result: (id) => (cfg && cfg.results[id]) || null,
    active: () => (live && !live.done ? live.t.id : null),
    diag: () => ['Trials: ' + (live ? live.t.id + (live.done ? ' (done)' : live.seen ? ' (emulator open)' : ' (starting)') + (live.last ? ', ' + JSON.stringify(live.last) : '') : 'none run this session')]
};

module.exports = { id: 'trials', name: 'Matchup trials', start: startModule, TRIALS, LUA, ADDONS, parseOut, requestText, addonsText, forMatchup };
Object.keys(api).forEach(k => { if (!(k in module.exports)) Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)); });
