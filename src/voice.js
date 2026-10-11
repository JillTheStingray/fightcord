/**
 * Fightcord voice chat (Fightcord-only)
 *
 * Talk to your opponent during a set, when both of you have Fightcord with voice on.
 *   - The voice goes straight between the two PCs (WebRTC, Opus, encrypted end to end), like the
 *     match itself. STUN only, no relay server for audio.
 *   - To find each other, the two Fightcords swap a short handshake through free public Nostr
 *     relays: ephemeral events (relays pass them on, don't keep them), AES-GCM-encrypted, signed
 *     with a throwaway key per session (BIP340 Schnorr, built in below).
 *   - Off until you turn it on. Both players have to join. Voice-activated with a noise gate;
 *     Ctrl+Shift+M mutes / unmutes even while the emulator is in front. Nothing is recorded.
 *
 * Flow: the challenge is accepted (VS screen, match:accepted) -> both announce themselves in a
 * room named after the two players -> each joins (asked, or automatically per Settings) -> the
 * player whose name sorts first calls -> voice until the match ends.
 */
'use strict';

// Node's crypto (Fightcade's page has it; the dev harness doesn't -- voice is then simply unavailable)
const crypto = (() => { try { return require('crypto'); } catch (e) { return null; } })();

let fc = null;
let store = null, cfg = null;            // voice-config.json
const T = (s, v) => fc ? fc.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const E = (s) => fc.fmt.esc(s);
const N_ = (s) => s;
const lc = (s) => String(s || '').toLowerCase();

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const KIND = 25050;                       // ephemeral: relays forward it, never store it
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const HOTKEY = 'CommandOrControl+Shift+M';

/* ============================================================ secp256k1 / BIP340 */

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m) => { const r = a % (m || P); return r >= 0n ? r : r + (m || P); };
function inv(a, m) {
    let lm = 1n, hm = 0n, low = mod(a, m), high = m;
    while (low > 1n) { const r = high / low; [lm, hm] = [hm - lm * r, lm]; [low, high] = [high - low * r, low]; }
    return mod(lm, m);
}
function add(p, q) {
    if (!p) return q;
    if (!q) return p;
    if (p[0] === q[0] && p[1] !== q[1]) return null;
    const l = p[0] === q[0] ? mod(3n * p[0] * p[0] * inv(2n * p[1], P)) : mod((q[1] - p[1]) * inv(q[0] - p[0], P));
    const x = mod(l * l - p[0] - q[0]);
    return [x, mod(l * (p[0] - x) - p[1])];
}
function mul(p, k) {
    let r = null, a = p;
    while (k > 0n) { if (k & 1n) r = add(r, a); a = add(a, a); k >>= 1n; }
    return r;
}
const toBig = (b) => BigInt('0x' + (Buffer.from(b).toString('hex') || '0'));
const to32 = (n) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const sha = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)))).digest();
const tagged = (tag, ...parts) => { const t = sha(tag); return sha(t, t, ...parts); };

// x-only public key of a 32-byte secret
function pubkey(sk) { return to32(mul(G, toBig(sk))[0]); }

// BIP340 Schnorr signature of a 32-byte message
function sign(msg, sk, aux) {
    const d0 = toBig(sk);
    if (d0 <= 0n || d0 >= N) throw new Error('bad secret key');
    const Pp = mul(G, d0);
    const d = Pp[1] % 2n === 0n ? d0 : N - d0;
    const t = Buffer.from(to32(d).map((b, i) => b ^ tagged('BIP0340/aux', aux || Buffer.alloc(32))[i]));
    const k0 = mod(toBig(tagged('BIP0340/nonce', t, to32(Pp[0]), msg)), N);
    if (k0 === 0n) throw new Error('bad nonce');
    const R = mul(G, k0);
    const k = R[1] % 2n === 0n ? k0 : N - k0;
    const e = mod(toBig(tagged('BIP0340/challenge', to32(R[0]), to32(Pp[0]), msg)), N);
    return Buffer.concat([to32(R[0]), to32(mod(k + e * d, N))]);
}

// BIP340 verification (the tests check our signatures; relays do the same)
function verify(msg, pk, sig) {
    const x = toBig(pk);
    if (x >= P) return false;
    const y2 = mod(x * x * x + 7n);
    let y = 1n, b = y2, ex = (P + 1n) / 4n;
    while (ex > 0n) { if (ex & 1n) y = mod(y * b); b = mod(b * b); ex >>= 1n; }
    if (mod(y * y) !== y2) return false;
    const Pt = [x, y % 2n === 0n ? y : P - y];
    const r = toBig(sig.slice(0, 32)), s = toBig(sig.slice(32));
    if (r >= P || s >= N) return false;
    const e = mod(toBig(tagged('BIP0340/challenge', sig.slice(0, 32), pk, msg)), N);
    const R = add(mul(G, s), mul(Pt, N - e));
    return !!R && R[1] % 2n === 0n && R[0] === r;
}

/* ============================================================== nostr events */

// a signed nostr event -> what relays accept
function makeEvent(sk, kind, tags, content, at) {
    const pk = pubkey(sk).toString('hex');
    const created = at || Math.floor(Date.now() / 1000);
    const id = sha(JSON.stringify([0, pk, created, kind, tags, content]));
    return { id: id.toString('hex'), pubkey: pk, created_at: created, kind, tags, content, sig: sign(id, sk, crypto.randomBytes(32)).toString('hex') };
}
function checkEvent(ev) {
    try {
        const id = sha(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]));
        return id.toString('hex') === ev.id && verify(id, Buffer.from(ev.pubkey, 'hex'), Buffer.from(ev.sig, 'hex'));
    } catch (e) { return false; }
}

/* ===================================================================== room */

// the two players -> the same room for both, whichever order
const pair = (a, b) => [lc(a), lc(b)].sort().join('|');
const roomTopic = (a, b) => sha('fightcord-voice-v1|topic|' + pair(a, b)).toString('hex');
const dayKey = (at) => new Date(at).toISOString().slice(0, 10);
const roomKey = (a, b, at) => sha('fightcord-voice-v1|key|' + pair(a, b) + '|' + dayKey(at));
// the one who calls (sends the WebRTC offer): the name that sorts first
const isCaller = (me, opp) => lc(me) < lc(opp);

function seal(key, obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
}
// tries today's key and yesterday's (a set across midnight)
function open(keys, text) {
    const raw = Buffer.from(String(text || ''), 'base64');
    if (raw.length < 29) return null;
    for (const key of keys) {
        try {
            const d = crypto.createDecipheriv('aes-256-gcm', key, raw.slice(0, 12));
            d.setAuthTag(raw.slice(raw.length - 16));
            return JSON.parse(Buffer.concat([d.update(raw.slice(12, raw.length - 16)), d.final()]).toString('utf8'));
        } catch (e) { /* the other key */ }
    }
    return null;
}

/* ======================================================= who joins, and when */

// join mode + friend -> 'auto' | 'ask'
function decide(mode, friend) {
    if (mode === 'everyone') return 'auto';
    if (mode === 'friends' && friend) return 'auto';
    return 'ask';
}

// The handshake, without any network or audio: messages in, actions out. One per set.
//   actions: { send: msg } | { ask: true } | { call: true } | { answer: sdp } | { accept: sdp } | { end: why }
function Session(me, opp, opts) {
    const o = opts || {};
    const s = {
        me, opp, sid: o.sid || crypto.randomBytes(6).toString('hex'),
        state: 'announce',               // announce -> (ask) -> joined -> calling / connected -> ended
        peer: null,                      // the opponent's session id once heard
        meJoined: false, peerJoined: false, called: false,
        mode: o.mode || 'ask', friend: !!o.friend
    };
    const msg = (t, extra) => Object.assign({ t, from: lc(me), sid: s.sid }, extra);
    s.hello = () => [{ send: msg('hello') }];
    function maybeCall() {
        if (!(s.meJoined && s.peerJoined) || s.called || !isCaller(me, opp)) return [];
        s.called = true;
        s.state = 'calling';
        return [{ call: true }];
    }
    s.join = () => {
        if (s.meJoined || s.state === 'ended') return [];
        s.meJoined = true;
        s.state = 'joined';
        return [{ send: msg('join') }].concat(maybeCall());
    };
    s.leave = (why) => {
        if (s.state === 'ended') return [];
        s.state = 'ended';
        return [{ send: msg('leave') }, { end: why || 'left' }];
    };
    s.receive = (m) => {
        if (!m || m.from !== lc(opp) || s.state === 'ended') return [];
        if (s.peer && m.sid !== s.peer) {
            // a new session from them (a rematch): only a hello may replace the old one
            if (m.t !== 'hello') return [];
            s.peerJoined = false; s.called = false;
        }
        const out = [];
        if (m.t === 'hello') {
            const first = s.peer !== m.sid;
            s.peer = m.sid;
            if (first) {
                out.push({ send: msg('hello') });                     // they may have missed ours
                if (s.meJoined) out.push({ send: msg('join') });
                else if (decide(s.mode, s.friend) === 'auto') out.push(...s.join());
                else { s.state = 'ask'; out.push({ ask: true }); }
            }
            return out;
        }
        if (!s.peer) s.peer = m.sid;
        if (m.t === 'join') {
            const first = !s.peerJoined;
            s.peerJoined = true;
            if (first && s.meJoined) out.push({ send: msg('join') });
            return out.concat(maybeCall());
        }
        if (m.t === 'offer' && s.meJoined && !isCaller(me, opp)) { s.state = 'connected'; return [{ answer: m.sdp }]; }
        if (m.t === 'answer' && s.called) { s.state = 'connected'; return [{ accept: m.sdp }]; }
        if (m.t === 'leave') { s.state = 'ended'; return [{ end: 'they left' }]; }
        return out;
    };
    s.offerMsg = (sdp) => msg('offer', { sdp });
    s.answerMsg = (sdp) => msg('answer', { sdp });
    return s;
}

// voice-activated: open above the threshold, stay open `hold` ms after the last loud moment
function gate(st, level, now, threshold, hold) {
    if (level >= threshold) { st.until = now + (hold || 300); st.open = true; }
    else if (!st.until || now > st.until) st.open = false;
    return st.open;
}

module.exports = {
    id: 'voice', name: 'Voice chat',
    start: (f) => start(f),
    // pure parts, for the tests
    pubkey, sign, verify, makeEvent, checkEvent, roomTopic, roomKey, isCaller, seal, open, decide, Session, gate, RELAYS, KIND
};

/* ===================================================== relays (the handshake) */

// One room on a few relays: publish to all, hear from all, each event once.
//   opts.kind: the event kind (default KIND); opts.reconnect: reopen dropped relays (long-lived rooms);
//   opts.replay: how many recent sends a (re)opened relay gets (default 20; 0 for presence)
function Relays(topic, keys, sk, onMsg, WS, opts) {
    const o = opts || {};
    const W = WS || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    const kind = o.kind || KIND, keep = o.replay != null ? o.replay : 20;
    const socks = {}, seen = new Set(), queue = [];
    const sub = 'fcv' + crypto.randomBytes(4).toString('hex');
    const myPk = pubkey(sk).toString('hex');
    let closed = false;
    function connect(url, tries) {
        let ws;
        try { ws = new W(url); } catch (e) { return; }
        socks[url] = ws;
        ws.onopen = () => {
            tries = 0;
            ws.send(JSON.stringify(['REQ', sub, { kinds: [kind], '#t': [topic], since: Math.floor(Date.now() / 1000) - 30 }]));
            queue.forEach(ev => ws.send(JSON.stringify(['EVENT', ev])));
        };
        ws.onmessage = (m) => {
            let d;
            try { d = JSON.parse(m.data); } catch (e) { return; }
            if (d[0] !== 'EVENT' || d[1] !== sub || !d[2]) return;
            const ev = d[2];
            if (seen.has(ev.id) || ev.pubkey === myPk) return;
            seen.add(ev.id);
            if (seen.size > 2000) seen.clear();
            const body = open(keys(), ev.content);
            if (body) onMsg(body);
        };
        ws.onerror = () => {};
        ws.onclose = () => {
            if (closed || !o.reconnect || socks[url] !== ws) return;
            setTimeout(() => { if (!closed) connect(url, tries + 1); }, Math.min(300000, 5000 * Math.pow(2, tries || 0)));
        };
    }
    RELAYS.forEach(url => connect(url, 0));
    const all = () => Object.keys(socks).map(k => socks[k]);
    return {
        send(obj) {
            if (closed) return;
            const ev = makeEvent(sk, kind, [['t', topic]], seal(keys()[0], obj));
            if (keep) { queue.push(ev); if (queue.length > keep) queue.shift(); }
            all().forEach(ws => { if (ws.readyState === 1) ws.send(JSON.stringify(['EVENT', ev])); });
        },
        close() {
            closed = true;
            all().forEach(ws => { try { if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', sub])); ws.close(); } catch (e) { /* gone */ } });
        },
        open: () => all().filter(ws => ws.readyState === 1).length
    };
}
module.exports.Relays = Relays;

/* ======================================================= the call (browser) */

let sess = null;      // { s: Session, relays, pc, mic, gateSt, timers[], opp, status, muted, remote: {el, level} }

function status(text, kind) {
    if (!sess) return;
    sess.status = text;
    sess.kind = kind || '';
    renderPill();
}

async function getMic() {
    const c = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (cfg.mic) c.deviceId = { exact: cfg.mic };
    try { return await navigator.mediaDevices.getUserMedia({ audio: c }); }
    catch (e) {
        if (cfg.mic) return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        throw e;
    }
}

// level 0..1 of a stream, read by the caller every ~50 ms
function meter(stream) {
    const ctx = fc.sound.ctx();
    if (!ctx) return () => 0;
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const read = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        return peak / 128;
    };
    read.stop = () => { try { src.disconnect(); } catch (e) { /* gone */ } };
    return read;
}

// SDP with the ICE candidates in it (one message instead of many over the relays): done when
// gathering completes, or ~0.6 s after the first public (STUN) address, at most 3 s
function gathered(pc) {
    return new Promise((res) => {
        if (pc.iceGatheringState === 'complete') { res(pc.localDescription); return; }
        let done = false, soon = 0;
        const finish = () => { if (done) return; done = true; clearTimeout(cap); clearTimeout(soon); res(pc.localDescription); };
        const cap = setTimeout(finish, 3000);
        pc.addEventListener('icecandidate', (e) => { if (e.candidate && / typ srflx /.test(e.candidate.candidate) && !soon) soon = setTimeout(finish, 600); });
        pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') finish(); });
    });
}

async function makePc() {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    sess.pc = pc;
    sess.mic = await getMic();
    sess.mic.getAudioTracks().forEach(tr => pc.addTrack(tr, sess.mic));
    sess.micLevel = meter(sess.mic);
    pc.ontrack = (e) => {
        if (!sess || sess.pc !== pc) return;
        const el = sess.remoteEl || (sess.remoteEl = new Audio());
        el.srcObject = e.streams[0];
        el.volume = Math.max(0, Math.min(1, +cfg.volume || 0.9));
        if (cfg.output && el.setSinkId) el.setSinkId(cfg.output).catch(() => {});
        el.play().catch(() => {});
        sess.remoteLevel = meter(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
        if (!sess || sess.pc !== pc) return;
        const st = pc.connectionState;
        if (st === 'connected') { status(T('Connected'), 'on'); fc.sound.tone([[660, 0, .08], [990, .08, .12]], { volume: .6 }); }
        else if (st === 'failed') { status(T('Couldn’t connect — your networks don’t allow a direct line'), 'bad'); }
        else if (st === 'disconnected') status(T('Reconnecting…'));
    };
    return pc;
}

function apply(actions) {
    if (!sess) return;
    actions.forEach(a => {
        if (a.send) sess.relays.send(a.send);
        if (a.ask) askCard();
        if (a.call) call();
        if (a.answer) answer(a.answer);
        if (a.accept) accept(a.accept);
        if (a.end) end(a.end, true);
    });
    renderPill();
}

async function call() {
    try {
        status(T('Connecting…'));
        const pc = await makePc();
        await pc.setLocalDescription(await pc.createOffer());
        const sdp = await gathered(pc);
        if (sess && sess.pc === pc) sess.relays.send(sess.s.offerMsg(sdp.sdp));
    } catch (e) { fc.log.warn('voice call', e.message); status(T('Microphone unavailable ({error})', { error: e.name || e.message }), 'bad'); }
}
async function answer(sdp) {
    try {
        status(T('Connecting…'));
        const pc = await makePc();
        await pc.setRemoteDescription({ type: 'offer', sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        const local = await gathered(pc);
        if (sess && sess.pc === pc) sess.relays.send(sess.s.answerMsg(local.sdp));
    } catch (e) { fc.log.warn('voice answer', e.message); status(T('Microphone unavailable ({error})', { error: e.name || e.message }), 'bad'); }
}
async function accept(sdp) {
    try { if (sess && sess.pc) await sess.pc.setRemoteDescription({ type: 'answer', sdp }); }
    catch (e) { fc.log.warn('voice accept', e.message); }
}

// every 50 ms: the noise gate on your mic, who's speaking, the music ducking under voices
function audioTick() {
    if (!sess || !sess.pc) return;
    const now = Date.now();
    const lvl = sess.micLevel ? sess.micLevel() : 0;
    const open = !sess.muted && gate(sess.gateSt, lvl, now, +cfg.gate || 0.08, 350);
    if (sess.mic) sess.mic.getAudioTracks().forEach(tr => { if (tr.enabled !== open) tr.enabled = open; });
    const rl = sess.remoteLevel ? sess.remoteLevel() : 0;
    const talking = rl > 0.06;
    if (talking !== sess.remoteTalking) { sess.remoteTalking = talking; fc.sound.duck(talking || !!sess.meTalking); }
    if (open !== sess.meTalking) { sess.meTalking = open; }
    const pill = document.querySelector('.fcvPill');
    if (pill) { pill.classList.toggle('them', talking); pill.classList.toggle('me', open); }
}

function toggleMute() {
    if (!sess) return;
    if (sess.s.state === 'ask') { apply(sess.s.join()); return; }      // the key also says "yes"
    sess.muted = !sess.muted;
    fc.sound.tone(sess.muted ? [[700, 0, .07], [440, .08, .1]] : [[440, 0, .07], [700, .08, .1]], { volume: .7 });
    renderPill();
}

function hotkey(on) {
    try {
        const gs = require('electron').remote.globalShortcut;
        if (on && !gs.isRegistered(HOTKEY)) gs.register(HOTKEY, () => toggleMute());
        if (!on && gs.isRegistered(HOTKEY)) gs.unregister(HOTKEY);
    } catch (e) { fc.log('mute key unavailable:', e.message); }
}

// a set starts (challenge accepted): only with an opponent who has Fightcord voice on
// (Fightcord players tells us; not heard of yet -> ask them directly, 4 s)
function begin(opp, channel) {
    if (!crypto || !cfg.enabled || !opp || cfg.blocked.indexOf(lc(opp)) >= 0) return;
    const me = fc.app.me();
    if (!me || lc(me) === lc(opp)) return;
    if (sess && lc(sess.opp) === lc(opp) && sess.s.state !== 'ended') return;      // the same set
    const pr = fc.modules.get('presence');
    if (!pr || !pr.check) { announce(me, opp, channel); return; }
    if (!pr.visible()) { fc.log('voice: hidden from Fightcord players, so no voice'); return; }
    const want = opp;
    pr.check(opp, 4000).then(i => {
        if (!i || !i.voice) { fc.log('voice:', opp, i ? 'has voice off' : 'has no Fightcord'); return; }
        if (cfg.enabled && fc.app.me() === me && want === opp && !(sess && lc(sess.opp) === lc(opp) && sess.s.state !== 'ended')) announce(me, opp, channel);
    });
}
function announce(me, opp, channel) {
    end('new set', false);
    const fr = fc.modules.get('friends');
    const s = Session(me, opp, { mode: cfg.join, friend: !!(fr && fr.isFriend && fr.isFriend(opp)) });
    const keys = () => [roomKey(me, opp, Date.now()), roomKey(me, opp, Date.now() - 86400000)];
    sess = { s, opp, channel, gateSt: {}, timers: [], muted: !!cfg.startMuted, status: T('Waiting for {name}…', { name: opp }), kind: 'wait' };
    sess.relays = Relays(roomTopic(me, opp), keys, crypto.randomBytes(32), (m) => apply(s.receive(m)));
    // ephemeral: they only hear what's sent after they're listening -- say hello a few times
    [400, 3000, 7000, 12000, 20000].forEach(ms => sess.timers.push(setTimeout(() => { if (sess && sess.s === s && !s.peer) apply(s.hello()); }, ms)));
    sess.timers.push(setTimeout(() => { if (sess && sess.s === s && !s.peer) end('no voice on their side', false); }, 45000));
    sess.timers.push(setInterval(audioTick, 50));
    hotkey(true);
    fc.log('voice: announcing for', opp);
    renderPill();
}

// the set is over (or someone left): hang up, release the mic, stop listening
function end(why, fromPeer) {
    if (!sess) return;
    const x = sess;
    if (!fromPeer && x.s.state !== 'ended' && x.s.peer) { try { x.relays.send({ t: 'leave', from: lc(fc.app.me()), sid: x.s.sid }); } catch (e) { /* closing */ } }
    sess = null;
    x.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    try { if (x.pc) x.pc.close(); } catch (e) { /* closed */ }
    if (x.mic) x.mic.getTracks().forEach(t => t.stop());
    if (x.micLevel && x.micLevel.stop) x.micLevel.stop();
    if (x.remoteLevel && x.remoteLevel.stop) x.remoteLevel.stop();
    if (x.remoteEl) { x.remoteEl.pause(); x.remoteEl.srcObject = null; }
    setTimeout(() => x.relays.close(), 600);                 // let the goodbye go out
    if (x.remoteTalking) fc.sound.duck(false);
    if (x.ask) x.ask.close();
    hotkey(false);
    if (x.pc) fc.sound.tone([[600, 0, .08], [400, .09, .12]], { volume: .5 });
    fc.log('voice: ended,', why);
    renderPill();
}

/* ======================================================================== UI */

function askCard() {
    if (!sess) return;
    const opp = sess.opp;
    sess.ask = fc.ui.toast(T('{name} has Fightcord voice', { name: opp }), {
        icon: 'mic', ms: 25000,
        sub: T('Talk during this set? Ctrl+Shift+M also joins.'),
        actions: [
            { label: T('Join'), fn: () => { if (sess && sess.opp === opp) apply(sess.s.join()); } },
            { label: T('Not now'), kind: 'sec', fn: () => { if (sess && sess.opp === opp) end('declined', false); } }
        ]
    });
    fc.sound.tone([[880, 0, .08], [1175, .1, .14]], { volume: .6 });
}

// the pill in the channel bar while a voice session is up
function pillHtml() {
    if (!sess) return '';
    const live = sess.s.state === 'connected' || (sess.pc && sess.pc.connectionState === 'connected');
    const ask = sess.s.state === 'ask';
    return `<span class="ic">${fc.ui.ic('mic')}</span><span class="tx"><b>${E(sess.opp)}</b><small>${E(ask ? T('wants to talk') : sess.muted && live ? T('You’re muted') : sess.status || '')}</small></span>` +
        (ask ? `<span class="b go" data-v="join">${E(T('Join'))}</span>` : '') +
        (live ? `<span class="b" data-v="mute" title="${E(T('Mute / unmute (Ctrl+Shift+M, works in the emulator too)'))}">${fc.ui.ic(sess.muted ? 'close' : 'mic')}</span>` : '') +
        `<span class="b x" data-v="leave" title="${E(T('Leave voice'))}">${fc.ui.ic('logout')}</span>`;
}
function renderPill() {
    document.querySelectorAll('.channelToolbar .channelActions').forEach(a => {
        let p = a.querySelector(':scope > .fcvPill');
        if (!sess || sess.kind === 'wait') { if (p) p.remove(); return; }
        if (!p) {
            p = document.createElement('div');
            p.className = 'fcvPill';
            p.addEventListener('mousedown', (e) => e.stopPropagation());
            p.addEventListener('click', (e) => {
                e.stopPropagation();
                const b = e.target.closest('[data-v]');
                if (!b || !sess) return;
                if (b.dataset.v === 'join') apply(sess.s.join());
                else if (b.dataset.v === 'mute') toggleMute();
                else if (b.dataset.v === 'leave') end('left', false);
            });
            a.insertBefore(p, a.firstChild);
        }
        p.classList.toggle('muted', !!sess.muted);
        p.classList.toggle('bad', sess.kind === 'bad');
        const html = pillHtml();
        if (p.__html !== html) { p.__html = html; p.innerHTML = html; }
    });
}

// Settings: devices, the gate with a live meter, the blocked list
let testMic = null;
function devicesHtml(d) {
    if (!d.enabled) return '';
    const opt = (list, cur) => '<option value="">' + E(T('Windows default')) + '</option>' + list.map(x => `<option value="${E(x.deviceId)}"${x.deviceId === cur ? ' selected' : ''}>${E(x.label || T('Device'))}</option>`).join('');
    const ins = devices.filter(x => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications');
    const outs = devices.filter(x => x.kind === 'audiooutput' && x.deviceId !== 'default' && x.deviceId !== 'communications');
    return `<div class="fcvDev"><label><span>${E(T('Microphone'))}</span><select class="fc-select" data-dev="mic">${opt(ins, cfg.mic)}</select></label>` +
        `<label><span>${E(T('Speakers / headset'))}</span><select class="fc-select" data-dev="output">${opt(outs, cfg.output)}</select></label>` +
        `<div class="fcvMeter"><span>${E(T('Mic level'))}</span><i><u></u><b style="left:${Math.round((+cfg.gate || 0.08) * 100 / 0.5)}%"></b></i>` +
        fc.ui.btn(testMic ? 'Stop test' : 'Test mic', { kind: 'sec', size: 'sm', act: 'voice-test' }) + `</div></div>`;
}
let devices = [];
function loadDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(list => { devices = list; fc.settings.refresh('voice'); }).catch(() => {});
}
function blockedHtml(d) {
    if (!d.enabled || !cfg.blocked.length) return '';
    return `<div class="fcvBlocked"><span>${E(T('Never voice with'))}</span>${cfg.blocked.map(n => `<span class="fc-chip">${E(n)}<i data-unblock="${E(n)}">×</i></span>`).join('')}</div>`;
}
async function toggleTest() {
    if (testMic) { testMic.stream.getTracks().forEach(t => t.stop()); clearInterval(testMic.timer); if (testMic.read.stop) testMic.read.stop(); testMic = null; fc.settings.refresh('voice'); return; }
    try {
        const stream = await getMic();
        const read = meter(stream);
        testMic = { stream, read, st: {} };
        loadDevices();                                        // labels appear once the mic is allowed
        testMic.timer = setInterval(() => {
            const l = read(), open = gate(testMic.st, l, Date.now(), +cfg.gate || 0.08, 350);
            document.querySelectorAll('.fcvMeter u').forEach(u => { u.style.width = Math.min(100, l * 100 / 0.5) + '%'; u.classList.toggle('open', open); });
        }, 50);
        fc.settings.refresh('voice');
    } catch (e) { fc.ui.toast(T('Microphone unavailable ({error})', { error: e.name || e.message }), { kind: 'danger' }); }
}
function onSettingsClick(e) {
    const a = e.target.closest && e.target.closest('[data-act="voice-test"]');
    if (a) { e.stopPropagation(); toggleTest(); return; }
    const u = e.target.closest && e.target.closest('[data-unblock]');
    if (u) { e.stopPropagation(); setBlocked(u.dataset.unblock, false); }
}
function onSettingsChange(e) {
    const s = e.target.closest && e.target.closest('[data-dev]');
    if (!s) return;
    cfg[s.dataset.dev] = s.value;
    store.save();
}

function setBlocked(name, on) {
    const k = lc(name);
    cfg.blocked = cfg.blocked.filter(x => x !== k);
    if (on) { cfg.blocked.push(k); if (sess && lc(sess.opp) === k) end('blocked', false); }
    store.save();
    fc.settings.refresh('voice');
}

const CSS = `
.channelActions > .fcvPill { display: inline-flex; align-items: center; height: 32px; padding: 0 4px 0 8px; margin-right: 8px; border-radius: var(--fc-r1, 8px);
    background: var(--fc-btn); color: #fff; font: 600 13px/1 var(--fc-font); user-select: none; box-shadow: inset 0 0 0 1px rgba(35,165,90,.45); transition: box-shadow .12s; }
.channelActions > .fcvPill { text-transform: none; letter-spacing: 0; }
.fcvDev label > span, .fcvMeter > span, .fcvBlocked > span:first-child { font-size: 14px; font-weight: 500; color: var(--fc-head); }
.fcvPill .ic { display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center; border-radius: 50%; margin-right: 6px; background: rgba(35,165,90,.25); color: var(--fc-success); }
.fcvPill .ic .fc-ic { width: 13px; height: 13px; }
.fcvPill.them { box-shadow: inset 0 0 0 2px var(--fc-success), 0 0 12px rgba(35,165,90,.45); }
.fcvPill.me .ic { background: var(--fc-success); color: #fff; }
.fcvPill.muted .ic { background: rgba(242,63,67,.25); color: var(--fc-danger); }
.fcvPill.bad { box-shadow: inset 0 0 0 1px rgba(242,63,67,.5); }
.fcvPill .tx { display: flex; flex-direction: column; line-height: 1.1; margin-right: 6px; max-width: 170px; }
.fcvPill .tx b { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcvPill .tx small { font-size: 10.5px; font-weight: 500; color: var(--fc-muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fcvPill .b { display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 6px; margin-left: 2px; border-radius: 6px; cursor: pointer; color: var(--fc-text); }
.fcvPill .b:hover { background: var(--fc-btn-h); }
.fcvPill .b .fc-ic { width: 14px; height: 14px; }
.fcvPill .b.go { background: var(--fc-success); color: #fff; font-weight: 700; }
.fcvPill .b.x:hover { background: var(--fc-danger); color: #fff; }
.fcvDev label { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
.fcvDev label .fc-select { max-width: 320px; }
.fcvMeter { display: flex; align-items: center; padding: 8px 0; }
.fcvMeter > span { width: 120px; color: var(--fc-text); }
.fcvMeter > i { position: relative; flex: 1; height: 8px; margin-right: 12px; border-radius: 4px; background: rgba(255,255,255,.08); overflow: hidden; }
.fcvMeter > i > u { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--fc-muted); transition: width .05s; }
.fcvMeter > i > u.open { background: var(--fc-success); }
.fcvMeter > i > b { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--fc-warning); }
.fcvBlocked { display: flex; flex-wrap: wrap; align-items: center; padding: 6px 0; }
.fcvBlocked > span:first-child { margin-right: 10px; color: var(--fc-text); }
.fcvBlocked .fc-chip { margin: 2px 4px 2px 0; }
.fcvBlocked .fc-chip i { margin-left: 6px; cursor: pointer; font-style: normal; opacity: .7; }
`;

function start(f) {
    fc = f;
    store = fc.config('voice', { enabled: false, join: 'ask', startMuted: false, gate: 0.08, volume: 0.9, mic: '', output: '', blocked: [] });
    cfg = store.data;
    if (!Array.isArray(cfg.blocked)) cfg.blocked = [];
    fc.ui.style('fcvStyle', CSS);
    fc.own(() => { end('unloaded', false); fc.ui.style('fcvStyle', null); if (testMic) toggleTest(); });
    fc.on('match:accepted', (ev) => begin(ev && ev.opp, ev && ev.channel));
    fc.on('match:start', (ev) => { if (ev && ev.opp) begin(ev.opp); });
    fc.on('match:end', () => setTimeout(() => end('the set is over', false), 1500));
    fc.watch(renderPill, { selector: '.channelToolbar' });
    if (typeof document !== 'undefined') {
        document.addEventListener('click', onSettingsClick, true);
        document.addEventListener('change', onSettingsChange, true);
        fc.own(() => { document.removeEventListener('click', onSettingsClick, true); document.removeEventListener('change', onSettingsChange, true); });
    }
    fc.settings.section('voice', N_('Voice chat'), 'mic', 75);
    fc.settings.block({
        id: 'voice', section: 'voice', title: 'Voice chat', hint: '— talk to your opponent during a set (Fightcord players only)', store, order: 10,
        fields: [
            { key: 'enabled', type: 'switch', label: 'Voice chat with opponents', hint: 'Only with players who also have Fightcord and voice on. Both have to join.',
                onChange: (v) => { if (v) loadDevices(); else end('turned off', false); fc.emit('voice:changed', { on: !!v }); } },
            { key: 'join', type: 'select', label: 'When a set starts', show: (d) => d.enabled,
                options: [['ask', N_('Ask me each time')], ['friends', N_('Join with friends, ask for others')], ['everyone', N_('Join with everyone')]] },
            { key: 'startMuted', type: 'switch', label: 'Start muted', hint: 'Ctrl+Shift+M unmutes, even inside the emulator', show: (d) => d.enabled },
            { key: 'volume', type: 'slider', label: 'Opponent volume', min: 0, max: 100, scale: 100, unit: '%', show: (d) => d.enabled,
                live: () => { if (sess && sess.remoteEl) sess.remoteEl.volume = +cfg.volume; } },
            { key: 'gate', type: 'slider', label: 'Mic sensitivity', hint: 'Higher = only louder sound opens your mic (keeps stick clicks out)', min: 2, max: 40, scale: 100, unit: '%', show: (d) => d.enabled,
                live: () => fc.settings.refresh('voice') },
            { type: 'html', id: 'voice-devices', html: devicesHtml },
            { type: 'html', id: 'voice-blocked', html: blockedHtml },
            { type: 'note', label: 'Like the match itself, voice goes straight between your PC and your opponent’s. The handshake passes through free public relays, encrypted. Nothing is stored or recorded. Ctrl+Shift+M mutes / unmutes.' }
        ]
    });
    if (cfg.enabled) loadDevices();
    return api;
}

const api = {
    setBlocked: (n, on) => setBlocked(n, on),
    isBlocked: (n) => !!cfg && cfg.blocked.indexOf(lc(n)) >= 0,
    enabled: () => !!(cfg && cfg.enabled),
    _session: () => sess && { opp: sess.opp, state: sess.s.state, status: sess.status, muted: sess.muted, relays: sess.relays.open(), pc: sess.pc ? sess.pc.connectionState : '' },
    _begin: (opp) => begin(opp),
    // the dev harness can't make calls: draw the pill / card in a given state
    _demo(opp, state, muted) {
        end('demo', false);
        const s = Session(fc.app.me() || 'Me', opp, { sid: 'demo' });
        s.state = state;
        sess = { s, opp, gateSt: {}, timers: [], muted: !!muted, status: state === 'connected' ? T('Connected') : T('Connecting…'), kind: '',
            relays: { send() {}, close() {}, open: () => 0 }, pc: state === 'connected' ? { connectionState: 'connected', close() {} } : null };
        if (state === 'ask') askCard();
        renderPill();
    },
    _end: (why) => end(why || 'test', false),
    _toggleMute: () => toggleMute()
};
Object.keys(api).forEach(k => Object.defineProperty(module.exports, k, Object.getOwnPropertyDescriptor(api, k)));
