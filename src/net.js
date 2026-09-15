// Transport des parties : Supabase (en ligne) ou localStorage (même téléphone).
// Interface commune : createGame, loadGame, saveGame (verrou optimiste), subscribe ; en ligne, aussi le chat (loadChat, sendChat, subscribeChat).
(function (root) {
  'use strict';

  const TABLE = 'harmonies_games';
  const CHAT = 'harmonies_chat';
  const LS_PREFIX = 'harmonies.game.';

  let client = null; // un seul client Supabase par page
  function makeOnline(cfg) {
    if (!client) client = root.supabase.createClient(cfg.url, cfg.key, {
      realtime: { params: { eventsPerSecond: 5 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      mode: 'online',
      chat: true,
      async createGame(id, state) {
        const { data, error } = await client.from(TABLE).insert({ id, state, version: 1 }).select('version').single();
        if (error) throw new Error(error.message);
        return { version: data.version };
      },
      async loadGame(id) {
        const { data, error } = await client.from(TABLE).select('state, version').eq('id', id).maybeSingle();
        if (error) throw new Error(error.message);
        return data ? { state: data.state, version: data.version } : null;
      },
      async saveGame(id, state, version) {
        const { data, error } = await client.from(TABLE).update({ state, version: version + 1 }).eq('id', id).eq('version', version).select('version');
        if (error) throw new Error(error.message);
        if (!data || !data.length) { const e = new Error('conflict'); e.code = 'conflict'; throw e; }
        return { version: data[0].version };
      },
      // onChange() est appelé à chaque modification distante ; onStatus(bool) reflète la connexion temps réel.
      subscribe(id, onChange, onStatus) {
        const channel = client.channel('game-' + id)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: 'id=eq.' + id }, () => onChange())
          .subscribe(status => { if (onStatus) onStatus(status === 'SUBSCRIBED'); });
        return () => { client.removeChannel(channel); };
      },
      // ---- chat : messages persistants (les 60 derniers au chargement), diffusés par le temps réel ----
      async loadChat(id, afterId) {
        let q = client.from(CHAT).select('id, pid, name, avatar, text, created_at').eq('game', id).order('id', { ascending: false }).limit(60);
        if (afterId) q = q.gt('id', afterId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data || []).reverse();
      },
      async sendChat(id, msg) {
        const { data, error } = await client.from(CHAT).insert({ game: id, pid: msg.pid, name: msg.name, avatar: msg.avatar || 0, text: msg.text }).select('id, pid, name, avatar, text, created_at').single();
        if (error) throw new Error(error.message);
        return data;
      },
      subscribeChat(id, onMessage) {
        const channel = client.channel('chat-' + id)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: CHAT, filter: 'game=eq.' + id }, payload => { if (payload.new) onMessage(payload.new); })
          .subscribe();
        return () => { client.removeChannel(channel); };
      },
    };
  }

  function makeLocal() {
    const listeners = new Map();
    const read = id => { try { const raw = localStorage.getItem(LS_PREFIX + id); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
    const write = (id, rec) => localStorage.setItem(LS_PREFIX + id, JSON.stringify(rec));
    root.addEventListener('storage', ev => {
      if (ev.key && ev.key.startsWith(LS_PREFIX)) {
        const id = ev.key.slice(LS_PREFIX.length);
        (listeners.get(id) || []).forEach(fn => fn());
      }
    });
    return {
      mode: 'local',
      chat: false,
      async createGame(id, state) { write(id, { state, version: 1 }); return { version: 1 }; },
      async loadGame(id) { return read(id); },
      async saveGame(id, state, version) {
        const rec = read(id);
        if (!rec || rec.version !== version) { const e = new Error('conflict'); e.code = 'conflict'; throw e; }
        write(id, { state, version: version + 1 });
        return { version: version + 1 };
      },
      subscribe(id, onChange, onStatus) {
        if (!listeners.has(id)) listeners.set(id, []);
        listeners.get(id).push(onChange);
        if (onStatus) onStatus(true);
        return () => { const arr = listeners.get(id) || []; const i = arr.indexOf(onChange); if (i >= 0) arr.splice(i, 1); };
      },
    };
  }

  root.Net = { makeOnline, makeLocal };
})(typeof self !== 'undefined' ? self : this);
