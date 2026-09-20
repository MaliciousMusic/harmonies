// Fonction Edge « harmonies-push » : notifications Web Push (VAPID + chiffrement aes128gcm, RFC 8291), sans dépendance.
// Appelée par les triggers pg_net des tables harmonies_games (tour joué, partie commencée / finie, joueur invité) et
// harmonies_chat (message). Clé VAPID générée au premier appel et conservée dans le coffre Vault (RPC harmonies_secret*).
// GET  /harmonies-push            → { vapid: <clé publique> } (à embarquer dans le client)
// POST /harmonies-push (+ x-harmonies-key) → traite l'événement { event: 'game' | 'chat', ... }
// (déployée sur le projet Supabase « harmonies » ; conservée ici pour référence)
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const HEADERS = { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' };
const CONTACT = 'mailto:harmonies@maliciousmusic.github.io';

type Player = { pid?: string; name?: string; avatar?: number; bot?: number; seat?: number };
type Note = { pid: string; title: string; body: string; tag: string; url: string; ttl?: number };

const enc = (s: string) => new TextEncoder().encode(s);
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s: string) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const p = t + '='.repeat((4 - t.length % 4) % 4); return Uint8Array.from(atob(p), c => c.charCodeAt(0)); };
function concat(...parts: Uint8Array[]) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }

async function rpc(name: string, params: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(params) });
  if (!r.ok) throw new Error(name + ' ' + r.status + ' ' + await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---------- Clés VAPID (coffre Vault) ----------
let vapid: { publicKey: string; jwk: JsonWebKey } | null = null;
async function getVapid() {
  if (vapid) return vapid;
  let text = await rpc('harmonies_secret', { p_name: 'harmonies_vapid' });
  if (!text) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    text = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
    await rpc('harmonies_secret_set', { p_name: 'harmonies_vapid', p_value: text });
  }
  const jwk = JSON.parse(text) as JsonWebKey;
  vapid = { publicKey: b64u(concat(new Uint8Array([4]), b64d(jwk.x!), b64d(jwk.y!))), jwk };
  return vapid;
}

// ---------- Web Push : VAPID (JWT ES256) + chiffrement aes128gcm ----------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function sendPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, ttl: number) {
  const v = await getVapid();
  const aud = new URL(sub.endpoint).origin;
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(head + '.' + claims)));
  const jwt = head + '.' + claims + '.' + b64u(sig);
  const ua = b64d(sub.keys.p256dh), auth = b64d(sub.keys.auth);
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(auth, shared, concat(enc('WebPush: info\0'), ua, asPub), 32);
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc(payload), new Uint8Array([2]))));
  const body = concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, cipher);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal', Authorization: `vapid t=${jwt}, k=${v.publicKey}` },
    body,
  });
  return r.status;
}

async function deliver(notes: Note[]) {
  if (!notes.length) return;
  const pids = [...new Set(notes.map(n => n.pid))];
  const subs: { id: number; pid: string; sub: { endpoint: string; keys: { p256dh: string; auth: string } } }[] =
    await rest(`harmonies_push?pid=in.(${pids.map(encodeURIComponent).join(',')})&select=id,pid,sub`);
  if (!subs || !subs.length) return;
  const badges: Record<string, number> = {};
  for (const pid of pids) if (subs.some(s => s.pid === pid)) badges[pid] = (await rpc('harmonies_turn_count', { p_pid: pid })) || 0;
  for (const n of notes) {
    const payload = JSON.stringify({ title: n.title, body: n.body, tag: n.tag, url: n.url, badge: badges[n.pid] || 0 });
    for (const s of subs.filter(x => x.pid === n.pid)) {
      let status = 0;
      try { status = await sendPush(s.sub, payload, n.ttl || 86400); } catch (e) { console.error('push failed', s.id, e); }
      console.log('push', n.pid, s.id, status, n.title);
      if (status === 404 || status === 410) await rest(`harmonies_push?id=eq.${s.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}

// ---------- Événements ----------
const human = (p: Player) => !!p && !p.bot && !!p.pid;
const listNames = (players: Player[], except: string) => players.filter(p => p.pid !== except).map(p => p.name || '?').join(', ') || 'friends';

async function onGame(ev: { game: string; op: string; old?: { status?: string; turn?: number; turnNo?: number; pids?: string[] } }) {
  const rows = await rest(`harmonies_games?id=eq.${encodeURIComponent(ev.game)}&select=id,state`);
  const g = rows && rows[0];
  if (!g) return;
  const s = g.state;
  const players: Player[] = (s.players || []).map((p: Player, i: number) => ({ ...p, seat: i }));
  const present = new Set<string>([...(s.present || []), s.lastBy].filter(Boolean));
  const oldPids = new Set<string>(ev.old && ev.old.pids ? ev.old.pids : []);
  const url = './?g=' + g.id;
  const tag = 'game-' + g.id;
  const by = players.find(p => p.pid === s.lastBy) || players.find(p => p.pid === s.host);
  const byName = by && by.name ? by.name : 'A friend';
  const notes: Note[] = [];
  const opts = (s.opts && s.opts.side === 'B' ? 'islands' : 'river') + (s.opts && s.opts.spirits ? ' · spirits' : '');
  // joueurs nouvellement installés (invitation directe, salle d'attente)
  if (s.status === 'lobby' || s.status === 'playing') {
    for (const p of players) {
      if (!human(p) || oldPids.has(p.pid!) || p.pid === s.host || p.pid === s.lastBy) continue;
      notes.push({ pid: p.pid!, title: s.status === 'playing' ? 'New game!' : 'Invitation', tag, url,
        body: byName + (s.status === 'playing' ? ' started a game with you (' + opts + ')' : ' invites you to a game (' + opts + ')') });
    }
  }
  if (s.status === 'playing') {
    const cur = players[s.turn];
    const changed = !ev.old || ev.old.status !== 'playing' || ev.old.turn !== s.turn || ev.old.turnNo !== s.turnNo;
    if (human(cur) && changed && !present.has(cur.pid!)) {
      const first = notes.find(n => n.pid === cur.pid);
      if (first) first.body += ' — your turn!';
      else notes.push({ pid: cur.pid!, title: 'Your turn!', body: 'Game with ' + listNames(players, cur.pid!) + ' · turn ' + (s.turnNo || 1), tag, url });
    }
  } else if (s.status === 'finished' && (!ev.old || ev.old.status !== 'finished')) {
    const winners: number[] = (s.result && s.result.winners) || [];
    const scores: { total: number }[] = (s.result && s.result.scores) || [];
    const totals = scores.map(x => x.total).join('–');
    for (const p of players) {
      if (!human(p) || present.has(p.pid!)) continue;
      const won = winners.includes(p.seat!);
      const resigned = s.endReason === 'resign' ? players[s.resigned] : null;
      const body = resigned ? (resigned.name || '?') + ' gave up — ' + (won ? 'you win!' : 'game over') :
        (won ? (winners.length > 1 ? 'Tie! ' : 'You win! ') : (players[winners[0]] ? (players[winners[0]].name || '?') + ' wins. ' : 'Game over. ')) + totals;
      notes.push({ pid: p.pid!, title: 'Game over', body, tag, url });
    }
  } else if (s.status === 'cancelled' && (!ev.old || ev.old.status !== 'cancelled')) {
    for (const p of players) if (human(p) && p.pid !== s.lastBy) notes.push({ pid: p.pid!, title: 'Game cancelled', body: byName + ' cancelled the game', tag, url: './' });
  }
  await deliver(notes);
}

async function onChat(ev: { id: number; game: string }) {
  const rows = await rest(`harmonies_chat?id=eq.${ev.id}&select=id,game,pid,name,text,present`);
  const m = rows && rows[0];
  if (!m) return;
  const games = await rest(`harmonies_games?id=eq.${encodeURIComponent(m.game)}&select=id,state`);
  const g = games && games[0];
  if (!g) return;
  const present = new Set<string>(m.present || []);
  const notes: Note[] = [];
  for (const p of (g.state.players || []) as Player[]) {
    if (!human(p) || p.pid === m.pid || present.has(p.pid!)) continue;
    notes.push({ pid: p.pid!, title: m.name || 'Message', body: String(m.text || '').slice(0, 200), tag: 'chat-' + g.id, url: './?g=' + g.id, ttl: 3600 });
  }
  await deliver(notes);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') {
    const v = await getVapid();
    return new Response(JSON.stringify({ vapid: v.publicKey }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const key = await rpc('harmonies_secret', { p_name: 'harmonies_push_key' });
  if (!key || req.headers.get('x-harmonies-key') !== key) return new Response('forbidden', { status: 403 });
  let ev: { event?: string } & Record<string, unknown>;
  try { ev = await req.json(); } catch (_e) { return new Response('bad request', { status: 400 }); }
  const work = (ev.event === 'chat' ? onChat(ev as unknown as { id: number; game: string }) : onGame(ev as unknown as { game: string; op: string }))
    .catch(e => console.error('harmonies-push', e));
  // réponse immédiate (le trigger pg_net n'attend pas) ; l'envoi continue en tâche de fond
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt && rt.waitUntil) rt.waitUntil(work); else await work;
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
