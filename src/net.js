// Transport des parties : Supabase (en ligne) ou localStorage (même téléphone).
// Interface commune : createGame, loadGame, saveGame (verrou optimiste), subscribe ; en ligne, aussi le chat (loadChat, sendChat,
// subscribeChat), les fonctions SQL des profils (rpc), le canal d'événements du joueur (subscribeAccount / pushEvent),
// la présence globale (subscribeOnline) et le suivi de plusieurs parties (subscribeGames).
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
    // envoi HTTP d'un message broadcast (sans rejoindre le canal)
    async function broadcast(topic, event, payload) {
      try { if (client.realtime && client.realtime.setAuth) await client.realtime.setAuth(); } catch (e) { /* ignore */ }
      const ch = client.channel(topic);
      try { return await ch.send({ type: 'broadcast', event, payload }); }
      finally { try { client.removeChannel(ch); } catch (e) { /* ignore */ } }
    }
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
      // onChange() est appelé à chaque modification distante ; onStatus(bool) reflète la connexion temps réel ;
      // opts.pid + opts.onPresence(pids) : présence des joueurs connectés à la partie.
      subscribe(id, onChange, onStatus, opts) {
        opts = opts || {};
        const channel = client.channel('game-' + id, opts.pid ? { config: { presence: { key: opts.pid } } } : undefined)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: 'id=eq.' + id }, () => onChange());
        if (opts.onPresence) channel.on('presence', { event: 'sync' }, () => { try { opts.onPresence(Object.keys(channel.presenceState())); } catch (e) { /* ignore */ } });
        channel.subscribe(async status => {
          const ok = status === 'SUBSCRIBED';
          if (onStatus) onStatus(ok);
          if (ok && opts.pid) { try { await channel.track({ pid: opts.pid, at: Date.now() }); } catch (e) { /* présence facultative */ } }
        });
        return () => { client.removeChannel(channel); };
      },
      // Suivi de plusieurs parties (liste de l'accueil) : onChange(id) à chaque mise à jour de l'une d'elles.
      subscribeGames(ids, onChange) {
        ids = (ids || []).filter(id => /^[A-Z0-9]+$/.test(id)).slice(0, 30);
        if (!ids.length) return () => {};
        const channel = client.channel('games-' + ids.join('-').slice(0, 60) + '-' + Math.random().toString(36).slice(2, 6))
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: 'id=in.(' + ids.join(',') + ')' }, payload => onChange(payload && payload.new ? payload.new.id : null))
          .subscribe();
        return () => { client.removeChannel(channel); };
      },
      // Présence globale : qui a l'application ouverte (pastilles « en ligne » des amis, choix des notifications)
      subscribeOnline(pid, onSync) {
        const channel = client.channel('harmonies-online', { config: { presence: { key: pid } } })
          .on('presence', { event: 'sync' }, () => { try { onSync(Object.keys(channel.presenceState())); } catch (e) { /* ignore */ } });
        channel.subscribe(async status => { if (status === 'SUBSCRIBED') { try { await channel.track({ pid, at: Date.now() }); } catch (e) { /* facultatif */ } } });
        return () => { client.removeChannel(channel); };
      },
      // ---- profils, amis, notifications : fonctions SQL (SECURITY DEFINER) ----
      async rpc(name, params) {
        const { data, error } = await client.rpc(name, params);
        if (error) throw new Error(error.message || 'error');
        return data;
      },
      // Canal d'événements d'un joueur (acct-<pid>) : 'game' (nouvelle partie), 'turn', 'finished', 'chat', 'friend'
      subscribeAccount(pid, onEvent) {
        const channel = client.channel('acct-' + pid, { config: { broadcast: { self: false } } });
        ['game', 'turn', 'finished', 'chat', 'friend'].forEach(ev => channel.on('broadcast', { event: ev }, msg => { if (msg && msg.payload) onEvent(ev, msg.payload); }));
        channel.subscribe();
        return () => { client.removeChannel(channel); };
      },
      pushEvent(pid, event, payload) { return broadcast('acct-' + pid, event, payload); },
      // ---- chat : messages persistants (les 60 derniers au chargement), diffusés par le temps réel ----
      async loadChat(id, afterId) {
        let q = client.from(CHAT).select('id, pid, name, avatar, text, created_at').eq('game', id).order('id', { ascending: false }).limit(60);
        if (afterId) q = q.gt('id', afterId);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data || []).reverse();
      },
      // msg.present : joueurs actuellement connectés (ils ne reçoivent pas de notification push pour ce message)
      async sendChat(id, msg) {
        const { data, error } = await client.from(CHAT).insert({ game: id, pid: msg.pid, name: msg.name, avatar: msg.avatar || 0, text: msg.text, present: msg.present || [] }).select('id, pid, name, avatar, text, created_at').single();
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
