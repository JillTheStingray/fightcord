// The private-lobby Room exactly as Fightcord 2.19 shipped it: the 3.0 events must not disturb it
'use strict';
const MAX_TEXT = 2000;
const lc = (s) => String(s || '').toLowerCase();
function Room(o) {
    const r = {
        owner: (o && o.owner) || '', pre: (o && o.pre) || '',
        info: null, members: new Map(), out: new Map(), msgs: [], ids: new Set(), ends: {}, rekeys: [], closed: false
    };
    r.isOwner = (pk) => !!pk && (r.owner ? pk === r.owner : !!r.pre && pk.startsWith(r.pre));
    function member(pk, n, g, at, ep, trusted) {
        if (!pk || !n) return;
        const kicked = r.out.get(pk);
        if (kicked != null && !(ep > kicked)) return;
        if (kicked != null) r.out.delete(pk);
        let m = r.members.get(pk);
        if (!m) { m = { pk, n: String(n).slice(0, 40), g: '', at, seen: 0, left: 0 }; r.members.set(pk, m); }
        if (trusted) m.n = String(n).slice(0, 40);
        if (g && /^[0-9a-f]{1,64}$/i.test(g)) m.g = g;
        if (at < m.at) m.at = at;
        if (at > m.seen) m.seen = at;
        return m;
    }
    function push(item) {
        let i = r.msgs.length;
        while (i > 0 && (r.msgs[i - 1].at > item.at || (r.msgs[i - 1].at === item.at && r.msgs[i - 1].id > item.id))) i--;
        r.msgs.splice(i, 0, item);
        if (r.msgs.length > 600) r.msgs.splice(0, r.msgs.length - 600);
    }
    // -> what changed: 'info' | 'member' | 'msg' | 'rekey' | ''
    r.apply = (ev) => {
        const b = ev && ev.b;
        if (!b || !ev.id || !ev.pk || r.ids.has(ev.id)) return '';
        r.ids.add(ev.id);
        const ep = ev.ep || 0;
        if (b.t === 'info') {
            if (!ev.ok || !r.isOwner(ev.pk) || (r.info && r.info.at > ev.at)) return '';
            r.owner = ev.pk;
            r.info = { name: String(b.name || '').slice(0, 40), rom: b.rom || '', ch: b.ch || '', id: b.id || '', epoch: +b.epoch || 0, prev: Array.isArray(b.prev) ? b.prev : [], at: ev.at };
            if (Array.isArray(b.members)) b.members.forEach(x => Array.isArray(x) && member(x[0], x[1], x[2], ev.at, ep, true));
            r.closed = !!b.closed;
            return 'info';
        }
        if (b.t === 'rekey') {
            if (!ev.ok || !r.isOwner(ev.pk)) return '';
            r.rekeys.push({ at: ev.at, ep, epoch: +b.epoch || 0, keys: b.keys || {}, out: Array.isArray(b.out) ? b.out : [] });
            if (r.ends[ep] == null || ev.at < r.ends[ep]) r.ends[ep] = ev.at;
            (Array.isArray(b.out) ? b.out : []).forEach(pk => {
                const m = r.members.get(pk);
                r.out.set(pk, ep);
                if (m) { r.members.delete(pk); push({ id: ev.id + pk.slice(0, 6), sys: 'out', pk, n: m.n, at: ev.at, ep }); }
            });
            return 'rekey';
        }
        if (b.t === 'join') {
            const m = member(ev.pk, b.n, b.g, ev.at, ep);
            if (!m) return '';
            push({ id: ev.id, sys: 'join', pk: ev.pk, n: m.n, at: ev.at, ep });
            return 'member';
        }
        if (b.t === 'leave') {
            const m = r.members.get(ev.pk);
            if (m && ev.at > m.left) m.left = ev.at;
            if (m) push({ id: ev.id, sys: 'leave', pk: ev.pk, n: m.n, at: ev.at, ep });
            return 'member';
        }
        if (b.t === 'msg') {
            const x = typeof b.x === 'string' ? b.x.slice(0, MAX_TEXT) : '';
            if (!x.trim()) return '';
            const m = member(ev.pk, b.n, b.g, ev.at, ep) || r.members.get(ev.pk);
            push({ id: ev.id, pk: ev.pk, n: m ? m.n : String(b.n || '?').slice(0, 40), g: (m && m.g) || '', x, at: ev.at, ep });
            return 'msg';
        }
        return '';
    };
    // a member is in unless they left after they last said something, or were removed
    r.active = () => [...r.members.values()].filter(m => !r.out.has(m.pk) && !(m.left && m.left > m.seen));
    // the chat as shown: an old key's messages stop where that key was replaced
    r.visible = () => r.msgs.filter(m => r.ends[m.ep] == null || m.at <= r.ends[m.ep] + 60000);
    // a name claimed by two keys: the first one keeps it, the rest get flagged
    r.dupes = () => {
        const first = new Map(), out = new Set();
        [...r.members.values()].sort((a, b) => a.at - b.at).forEach(m => { const k = lc(m.n); if (first.has(k)) out.add(m.pk); else first.set(k, m.pk); });
        return out;
    };
    return r;
}
module.exports = { Room };
