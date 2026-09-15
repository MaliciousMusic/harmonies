// Application Harmonies : écrans, interactions, synchronisation.
(function (root) {
  'use strict';
  const E = root.Engine, R = root.Render, esc = R.esc;
  const $ = sel => document.querySelector(sel);
  const CFG = root.HARMONIES_CONFIG || {};
  const ONLINE_OK = !!(CFG.url && CFG.key && !CFG.url.startsWith('__') && root.supabase);
  const SEAT_COLORS = ['#1f8a80', '#e0743d', '#7c4dff', '#c9a227'];
  const SIDE_LABEL = { A: 'Face A (rivière)', B: 'Face B (îles)' };

  // ---------- Stockage local (appareil) ----------
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* rien */ } },
  };
  const randomId = (n, alphabet) => {
    alphabet = alphabet || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    const buf = new Uint32Array(n);
    (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(buf) : buf.forEach((_, i) => { buf[i] = Math.floor(Math.random() * 4294967296); });
    for (let i = 0; i < n; i++) out += alphabet[buf[i] % alphabet.length];
    return out;
  };
  const myPid = () => {
    // identité de l'appareil ; sessionStorage permet de tester deux joueurs dans deux onglets (?pid=...)
    try { const sp = sessionStorage.getItem('harmonies.pid'); if (sp) return sp; } catch (e) { /* ignore */ }
    let v = ls.get('harmonies.pid');
    if (!v) { v = randomId(12, 'abcdefghijklmnopqrstuvwxyz0123456789'); ls.set('harmonies.pid', v); }
    return v;
  };
  const myName = () => ls.get('harmonies.name', '');
  function rememberGame(rec) {
    const list = ls.get('harmonies.recent', []).filter(g => g.id !== rec.id);
    list.unshift(Object.assign({ at: Date.now() }, rec));
    ls.set('harmonies.recent', list.slice(0, 12));
  }

  // ---------- État de l'application ----------
  const app = {
    screen: 'home', net: null, mode: null, gameId: null, version: 0,
    committed: null, work: null, undo: [], viewSeat: 0, selToken: null, cubeMode: null,
    unsub: null, poll: null, rtOk: false, endShown: false, spiritPrompted: false, lastLogLen: 0,
  };
  const view = () => (app.work || app.committed);
  const isMine = () => {
    const s = app.committed;
    if (!s || s.status !== 'playing') return false;
    if (app.mode === 'local') return true;
    return E.current(s).pid === myPid();
  };
  const mySeat = () => {
    const s = app.committed;
    if (!s) return -1;
    if (app.mode === 'local') return s.turn;
    return s.players.findIndex(p => p.pid === myPid());
  };

  // ---------- Petits composants ----------
  let toastTimer = null;
  function toast(msg, err) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 3200 : 2200);
  }
  function modal(html, opts) {
    closeModal();
    const bg = document.createElement('div');
    bg.className = 'modal-bg'; bg.id = 'modal';
    bg.innerHTML = '<div class="modal">' + html + '</div>';
    bg.addEventListener('click', ev => { if (ev.target === bg && !(opts && opts.sticky)) closeModal(); });
    document.body.appendChild(bg);
    return bg;
  }
  function closeModal() { const m = $('#modal'); if (m) m.remove(); }
  function vibrate(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }

  // ---------- Cartes ----------
  function trackHTML(card, left) {
    if (card.spirit) return '<div class="rule">' + esc(card.rule) + '</div>';
    const placed = card.pts.length - left;
    return '<div class="track">' + card.pts.map((v, i) => {
      let cls = 'step';
      if (i >= placed) cls += ' cube'; else if (i === placed - 1) cls += ' cur'; else cls += ' got';
      return '<div class="' + cls + '" title="' + v + ' pts">' + (i >= placed ? '&nbsp;' : v) + '</div>';
    }).join('') + '</div>';
  }
  function cardHTML(card, opts) {
    opts = opts || {};
    const left = opts.left === undefined ? card.pts.length : opts.left;
    let cls = 'card' + (card.spirit ? ' spirit' : '') + (opts.cls ? ' ' + opts.cls : '');
    let badge = '';
    if (opts.badge) badge = '<div class="badge' + (opts.badgeCls ? ' ' + opts.badgeCls : '') + '">' + esc(opts.badge) + '</div>';
    const sub = card.spirit ? '' : (opts.done ? '<div class="cubes-left">terminée</div>' :
      '<div class="cubes-left">' + (left === card.pts.length ? card.pts.length + ' cubes' : left + ' cube' + (left > 1 ? 's' : '') + ' restant' + (left > 1 ? 's' : '')) + '</div>');
    return '<div class="' + cls + '" data-card="' + card.id + '" ' + (opts.attrs || '') + '>' +
      '<div class="stripe" style="background:' + R.cubeColorOf(card) + '"></div>' + badge +
      '<div class="head"><span class="emoji">' + card.emoji + '</span><span>' + esc(card.fr) + '</span></div>' +
      R.patternSVG(card) + trackHTML(card, left) + sub + '</div>';
  }
  function cardDetail(card, extraHTML) {
    const step = card.pat.find(p => p.cube);
    const cubeColor = step.s[0] === 6 ? 6 : step.s[0];
    const howto = card.spirit
      ? '<p><b>Esprit de la Nature.</b> Pose son cube quand le motif est réalisé ; en fin de partie : ' + esc(card.rule) + '.</p>'
      : '<p>Points selon le nombre de cubes posés : <b>' + card.pts.join(' → ') + '</b>. Le cube se pose sur le jeton <b>' + E.COLOR_NAMES[cubeColor] + '</b> ' + E.COLOR_EMOJI[cubeColor] + '.</p>';
    modal('<h2>' + card.emoji + ' ' + esc(card.fr) + '</h2>' + cardHTML(card, { cls: 'big' }) + howto + (extraHTML || '') +
      '<div class="actions"><button class="btn secondary" id="m-close">Fermer</button></div>');
    $('#m-close').onclick = closeModal;
  }

  // ---------- Écran d'accueil ----------
  function renderHome() {
    app.screen = 'home';
    document.title = 'Harmonies';
    const recent = ls.get('harmonies.recent', []);
    const opts = ls.get('harmonies.opts', { side: 'A', spirits: false });
    $('#app').innerHTML =
      '<div class="screen home">' +
      '<div class="logo"><h1>HARMONIES</h1><p>Compose tes paysages, accueille tes animaux.</p></div>' +
      '<div class="panel"><div class="field"><label>Ton prénom</label><input type="text" id="name" maxlength="16" placeholder="Ex. Hadrien" value="' + esc(myName()) + '"></div>' +
      '<div class="field"><label>Plateau personnel</label><div class="seg" id="side"><button data-v="A" class="' + (opts.side === 'A' ? 'on' : '') + '">Face A · rivière</button><button data-v="B" class="' + (opts.side === 'B' ? 'on' : '') + '">Face B · îles</button></div></div>' +
      '<label class="check"><input type="checkbox" id="spirits" ' + (opts.spirits ? 'checked' : '') + '> Cartes Esprit de la Nature (variante avancée)</label>' +
      '<div class="row" style="margin-top:6px"><button class="btn" id="create" ' + (ONLINE_OK ? '' : 'disabled') + '>🌐 Créer une partie en ligne</button></div>' +
      (ONLINE_OK ? '' : '<p class="note">Mode en ligne indisponible (pas de configuration serveur).</p>') +
      '<div class="row" style="margin-top:10px"><button class="btn secondary" id="local">📱 Jouer sur ce téléphone</button></div></div>' +
      '<div class="panel"><h2>Rejoindre une partie</h2><div class="row"><input type="text" id="code" placeholder="CODE" maxlength="6" style="text-transform:uppercase;letter-spacing:4px;font-weight:700"><button class="btn" id="join" ' + (ONLINE_OK ? '' : 'disabled') + '>Rejoindre</button></div></div>' +
      (recent.length ? '<div class="panel"><h2>Parties récentes</h2><ul class="recent">' + recent.map(g =>
        '<li data-id="' + esc(g.id) + '" data-mode="' + g.mode + '"><span class="code">' + esc(g.mode === 'local' ? '📱' : g.id) + '</span><span class="meta">' + esc(g.label || '') + '<br>' + new Date(g.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '</span><button class="btn small">Ouvrir</button></li>').join('') + '</ul></div>' : '') +
      '<div class="panel rules"><h2>Comment jouer</h2><p>À ton tour : prends les <b>3 jetons</b> d\'un emplacement du plateau central et pose-les sur ton plateau (en respectant les règles d\'empilement). Tu peux aussi prendre <b>1 carte Animal</b> (max 4 devant toi) et poser des <b>cubes</b> dès que leur habitat est réalisé — ces actions sont possibles à tout moment du tour.</p>' +
      '<p>Fin de partie : sac vide au moment de recharger, ou <b>2 cases vides ou moins</b> sur ton plateau (on finit la manche).</p><button class="btn ghost" id="rules-more">Voir le détail des règles et du score →</button></div>' +
      '</div>';
    $('#name').addEventListener('change', ev => ls.set('harmonies.name', ev.target.value.trim()));
    $('#side').addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      [...$('#side').children].forEach(x => x.classList.toggle('on', x === b));
      saveOpts();
    });
    $('#spirits').addEventListener('change', saveOpts);
    function saveOpts() { ls.set('harmonies.opts', readOpts()); }
    function readOpts() { return { side: $('#side .on').dataset.v, spirits: $('#spirits').checked }; }
    function ensureName() {
      const n = $('#name').value.trim();
      if (!n) { toast('Indique ton prénom d\'abord', true); $('#name').focus(); return null; }
      ls.set('harmonies.name', n);
      return n;
    }
    $('#create').onclick = async () => {
      const n = ensureName(); if (!n) return;
      try { await createOnline(readOpts(), n); } catch (e) { toast('Création impossible : ' + e.message, true); }
    };
    $('#join').onclick = async () => {
      const n = ensureName(); if (!n) return;
      const code = $('#code').value.trim().toUpperCase();
      if (code.length < 4) { toast('Code invalide', true); return; }
      openOnline(code);
    };
    $('#local').onclick = () => localSetup(readOpts());
    $('#rules-more').onclick = showRules;
    document.querySelectorAll('.recent li').forEach(li => {
      li.querySelector('button').onclick = () => { if (li.dataset.mode === 'local') openLocal(li.dataset.id); else openOnline(li.dataset.id); };
    });
  }

  function localSetup(opts) {
    const names = ls.get('harmonies.localNames', [myName() || 'Joueur 1', 'Joueur 2']);
    modal('<h2>📱 Partie sur ce téléphone</h2><p class="note">Les joueurs se passent le téléphone à chaque tour.</p>' +
      '<div id="names">' + names.map((n, i) => '<div class="field"><label>Joueur ' + (i + 1) + '</label><input type="text" maxlength="16" value="' + esc(n) + '"></div>').join('') + '</div>' +
      '<div class="row"><button class="btn secondary small" id="m-add">+ joueur</button><button class="btn secondary small" id="m-del">− joueur</button></div>' +
      '<div class="actions"><button class="btn secondary" id="m-cancel">Annuler</button><button class="btn" id="m-go">Commencer</button></div>');
    const getNames = () => [...document.querySelectorAll('#names input')].map(i => i.value.trim());
    $('#m-add').onclick = () => { const ns = getNames(); if (ns.length < 4) { ns.push('Joueur ' + (ns.length + 1)); ls.set('harmonies.localNames', ns); localSetup(opts); } };
    $('#m-del').onclick = () => { const ns = getNames(); if (ns.length > 2) { ns.pop(); ls.set('harmonies.localNames', ns); localSetup(opts); } };
    $('#m-cancel').onclick = closeModal;
    $('#m-go').onclick = () => {
      const ns = getNames().map((n, i) => n || 'Joueur ' + (i + 1));
      ls.set('harmonies.localNames', ns);
      closeModal();
      startLocal(opts, ns);
    };
  }

  // ---------- Création / ouverture ----------
  async function startLocal(opts, names) {
    app.net = root.Net.makeLocal(); app.mode = 'local';
    const id = randomId(6);
    const state = E.newGame(opts, names.map((name, i) => ({ token: 'local' + i, name })));
    state.players.forEach((p, i) => { p.pid = 'local' + i; });
    state.id = id; state.mode = 'local';
    await app.net.createGame(id, state);
    rememberGame({ id, mode: 'local', label: names.join(', ') + ' · ' + SIDE_LABEL[opts.side] });
    enterGame(id, state, 1);
  }
  async function openLocal(id) {
    app.net = root.Net.makeLocal(); app.mode = 'local';
    const rec = await app.net.loadGame(id);
    if (!rec) { toast('Partie introuvable sur cet appareil', true); return; }
    enterGame(id, rec.state, rec.version);
  }
  async function createOnline(opts, name) {
    app.net = root.Net.makeOnline(CFG); app.mode = 'online';
    const id = randomId(5);
    const state = { status: 'lobby', id, opts, host: myPid(), players: [{ pid: myPid(), name }], createdAt: Date.now() };
    await app.net.createGame(id, state);
    rememberGame({ id, mode: 'online', label: 'En ligne · ' + SIDE_LABEL[opts.side] });
    history.replaceState(null, '', '?g=' + id);
    enterGame(id, state, 1);
  }
  async function openOnline(id) {
    if (!ONLINE_OK) { toast('Mode en ligne indisponible', true); return; }
    app.net = root.Net.makeOnline(CFG); app.mode = 'online';
    let rec;
    try { rec = await app.net.loadGame(id); } catch (e) { toast('Connexion impossible : ' + e.message, true); return; }
    if (!rec) { toast('Aucune partie avec le code ' + id, true); history.replaceState(null, '', location.pathname); return; }
    history.replaceState(null, '', '?g=' + id);
    enterGame(id, rec.state, rec.version);
  }

  function enterGame(id, state, version) {
    if (app.unsub) { app.unsub(); app.unsub = null; }
    clearInterval(app.poll);
    app.gameId = id; app.committed = state; app.version = version; app.work = null; app.undo = [];
    app.selToken = null; app.cubeMode = null; app.endShown = false; app.spiritPrompted = false; app.lastLogLen = (state.log || []).length;
    app.viewSeat = 0;
    app.unsub = app.net.subscribe(id, () => refresh(), ok => { app.rtOk = ok; const d = $('#conn'); if (d) d.className = 'conn ' + (ok ? 'on' : 'off'); });
    if (app.mode === 'online') {
      app.poll = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    }
    render();
  }
  async function refresh() {
    if (!app.gameId || !app.net) return;
    let rec;
    try { rec = await app.net.loadGame(app.gameId); } catch (e) { return; }
    if (!rec || rec.version <= app.version) return;
    const wasMine = isMine();
    app.committed = rec.state; app.version = rec.version;
    if (!wasMine || !isMine()) { app.work = null; app.undo = []; app.selToken = null; app.cubeMode = null; ls.del('harmonies.draft.' + app.gameId); }
    announceRemote();
    render();
  }
  function announceRemote() {
    const s = app.committed;
    if (!s.log) return;
    if (s.log.length > app.lastLogLen) {
      const last = s.log[s.log.length - 1];
      const who = s.players[last.p];
      if (!who || who.pid !== myPid() || app.mode === 'local') toast((who ? who.name : '?') + ' : ' + (E.describeActions(last.actions) || 'a joué'));
    }
    app.lastLogLen = s.log.length;
  }

  // ---------- Lobby ----------
  async function joinLobby(name) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const rec = await app.net.loadGame(app.gameId);
      if (!rec || rec.state.status !== 'lobby') return;
      const st = rec.state;
      if (st.players.some(p => p.pid === myPid())) { app.committed = st; app.version = rec.version; return; }
      if (st.players.length >= 4) { toast('La partie est complète (4 joueurs)', true); return; }
      st.players.push({ pid: myPid(), name });
      try {
        const r = await app.net.saveGame(app.gameId, st, rec.version);
        app.committed = st; app.version = r.version;
        rememberGame({ id: app.gameId, mode: 'online', label: 'En ligne · ' + SIDE_LABEL[st.opts.side] });
        return;
      } catch (e) { if (e.code !== 'conflict') throw e; }
    }
  }
  function renderLobby() {
    app.screen = 'lobby';
    const s = app.committed;
    const host = s.host === myPid();
    const inGame = s.players.some(p => p.pid === myPid());
    const link = location.origin + location.pathname + '?g=' + s.id;
    $('#app').innerHTML = '<div class="screen home">' +
      '<div class="logo"><h1>HARMONIES</h1><p>Salle d\'attente</p></div>' +
      '<div class="panel"><h2>Code de la partie</h2><div class="code-big">' + esc(s.id) + '</div>' +
      '<p class="note" style="text-align:center">' + esc(SIDE_LABEL[s.opts.side]) + (s.opts.spirits ? ' · Esprits de la Nature' : '') + '</p>' +
      '<div class="row"><button class="btn" id="share">📤 Envoyer le lien à Belai</button><button class="btn secondary" id="copy">Copier</button></div></div>' +
      '<div class="panel"><h2>Joueurs (' + s.players.length + '/4)</h2><ul class="players-list">' + s.players.map((p, i) =>
        '<li><span class="dot" style="background:' + SEAT_COLORS[i] + '"></span><b>' + esc(p.name) + '</b>' + (p.pid === s.host ? ' <span class="note">· hôte</span>' : '') + (p.pid === myPid() ? ' <span class="note">· toi</span>' : '') + '</li>').join('') + '</ul>' +
      (inGame ? '' : '<div class="field" style="margin-top:10px"><label>Ton prénom</label><input type="text" id="jname" maxlength="16" value="' + esc(myName()) + '"></div><button class="btn block" id="joinbtn">Rejoindre la partie</button>') +
      '</div>' +
      (host ? '<button class="btn block" id="start" ' + (s.players.length >= 2 ? '' : 'disabled') + '>Commencer la partie (' + s.players.length + ' joueur' + (s.players.length > 1 ? 's' : '') + ')</button>' +
        (s.players.length < 2 ? '<p class="note" style="text-align:center">En attente d\'au moins un autre joueur… la page se met à jour toute seule.</p>' : '') :
        '<p class="note" style="text-align:center">En attente que l\'hôte lance la partie… <span class="conn ' + (app.rtOk ? 'on' : '') + '" id="conn"></span></p>') +
      '<button class="btn ghost" id="leave">← Retour à l\'accueil</button></div>';
    $('#share').onclick = async () => {
      const text = 'Viens jouer à Harmonies avec moi ! Code ' + s.id + ' — ' + link;
      if (navigator.share) { try { await navigator.share({ title: 'Harmonies', text, url: link }); } catch (e) { /* annulé */ } }
      else { await copyText(link); toast('Lien copié'); }
    };
    $('#copy').onclick = async () => { await copyText(link); toast('Lien copié'); };
    $('#leave').onclick = () => { leaveGame(); renderHome(); };
    if (!inGame) $('#joinbtn').onclick = async () => {
      const n = $('#jname').value.trim(); if (!n) { toast('Indique ton prénom', true); return; }
      ls.set('harmonies.name', n);
      try { await joinLobby(n); render(); } catch (e) { toast('Impossible de rejoindre : ' + e.message, true); }
    };
    if (host) $('#start').onclick = async () => {
      const st = E.newGame(s.opts, s.players.map(p => ({ token: p.pid, name: p.name })));
      st.players.forEach((p, i) => { p.pid = s.players[i].pid; });
      st.id = s.id; st.host = s.host; st.mode = 'online';
      try {
        const r = await app.net.saveGame(app.gameId, st, app.version);
        app.committed = st; app.version = r.version; app.lastLogLen = 0;
        render();
      } catch (e) { toast('Lancement impossible : ' + e.message, true); refresh(); }
    };
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Copie ce lien :', text); }
  }
  function leaveGame() {
    if (app.unsub) app.unsub();
    clearInterval(app.poll);
    app.unsub = null; app.gameId = null; app.committed = null; app.work = null;
    history.replaceState(null, '', location.pathname);
  }

  // ---------- Rendu principal ----------
  function render() {
    const s = app.committed;
    if (!s) return renderHome();
    if (s.status === 'lobby') return renderLobby();
    renderGame();
  }

  function ensureWork() {
    if (!isMine()) { app.work = null; return; }
    if (app.work) return;
    const draft = ls.get('harmonies.draft.' + app.gameId);
    if (draft && draft.version === app.version && draft.work && draft.work.turn === app.committed.turn) {
      app.work = draft.work; app.undo = draft.undo || [];
    } else {
      app.work = E.clone(app.committed); app.undo = [];
    }
    app.viewSeat = app.work.turn;
    app.selToken = app.work.cur.tokens.length ? 0 : null;
    app.cubeMode = null;
  }
  function saveDraft() {
    if (app.work) ls.set('harmonies.draft.' + app.gameId, { version: app.version, work: app.work, undo: app.undo });
  }
  function act(fn) {
    // applique une action au tour en cours, avec instantané pour Annuler
    const snap = E.clone(app.work);
    try { fn(app.work); }
    catch (e) { app.work = snap; toast(e.message, true); return false; }
    app.undo.push(snap);
    saveDraft();
    return true;
  }

  function renderGame() {
    app.screen = 'game';
    ensureWork();
    const s = view();
    const mine = isMine();
    const me = mySeat();
    if (app.viewSeat >= s.players.length) app.viewSeat = 0;
    const cur = s.cur;
    const viewing = s.players[app.viewSeat];
    const viewingMine = mine && app.viewSeat === s.turn;
    const side = s.opts.side;
    document.title = (mine && s.status === 'playing' ? '🫵 À toi · ' : '') + 'Harmonies · ' + (s.id || '');

    // Score en direct
    const scores = s.players.map(p => E.scorePlayer(p, side));

    // Message d'état
    let msg;
    if (s.status === 'finished') msg = '🏁 Partie terminée';
    else if (mine) {
      const st = E.turnStatus(s);
      if (app.cubeMode) msg = 'Choisis la case du cube ' + E.CARD_BY_ID.get(app.cubeMode.id).emoji;
      else if (cur.slot === null && !s.market.every(m => !m.length)) msg = '🫵 À toi : prends 3 jetons';
      else if (cur.tokens.length) msg = '🫵 Pose tes jetons (' + cur.tokens.length + ' restant' + (cur.tokens.length > 1 ? 's' : '') + ')';
      else if (!st.ok) msg = '🫵 ' + st.reasons[0];
      else msg = '✅ Termine ton tour quand tu veux';
    } else msg = '⏳ Tour de ' + esc(E.current(s).name) + (app.mode === 'online' ? '…' : '');

    const legal = new Set(), targets = new Set(), last = new Set();
    if (viewingMine && !app.cubeMode && app.selToken !== null && cur.tokens[app.selToken] !== undefined) {
      E.legalCells(viewing.board, cur.tokens[app.selToken]).forEach(i => legal.add(i));
    }
    if (viewingMine && app.cubeMode) app.cubeMode.targets.forEach(i => targets.add(i));
    if (viewingMine) cur.actions.forEach(a => { if (a.a === 'place') last.add(a.cell); });
    else {
      const lastLog = (s.log || []).slice().reverse().find(l => l.p === app.viewSeat);
      if (lastLog) lastLog.actions.forEach(a => { if (a.a === 'place') last.add(a.cell); });
    }

    const placeable = mine ? E.placeableCubes(s) : [];
    const placeableIds = new Set(placeable.map(p => p.id));
    const canTake = mine && E.canTakeCard(s);

    let html = '<div class="screen game">' +
      '<div class="topbar"><span class="title">HARMONIES</span><span class="code">' + esc(s.id || '') + '</span>' +
      (app.mode === 'online' ? '<span class="conn ' + (app.rtOk ? 'on' : 'off') + '" id="conn" title="temps réel"></span>' : '') +
      '<span class="spacer"></span><button class="icon-btn" id="menu">☰</button></div>' +
      '<div class="status' + (mine ? ' mine' : '') + '"><span class="msg">' + msg + '</span><span class="scores">' +
      s.players.map((p, i) => '<span class="score-chip' + (i === app.viewSeat ? ' active' : '') + '" data-seat="' + i + '"><span class="dot" style="background:' + SEAT_COLORS[i] + '"></span>' + esc(p.name) + (i === s.turn && s.status === 'playing' ? ' 🎲' : '') + ' <b>' + scores[i].total + '</b></span>').join('') +
      '</span></div>';

    // Plateau central
    html += '<div class="section"><h3>Plateau central' + (s.bag ? ' <span class="hint" style="color:var(--muted)">· sac : ' + s.bag.length + '</span>' : '') + (mine && cur.slot === null && s.status === 'playing' ? ' <span class="hint">← choisis un groupe</span>' : '') + '</h3><div class="market">' +
      s.market.map((m, i) => {
        const takeable = mine && cur.slot === null && m.length > 0 && !app.cubeMode;
        return '<div class="slot' + (takeable ? ' takeable' : '') + (m.length ? '' : ' empty') + '" data-slot="' + i + '">' + (m.length ? R.slotSVG(m) : (cur && cur.slot === i ? '<span style="color:#f6e9cf;font-size:12px">pris</span>' : '')) + '</div>';
      }).join('') + '</div></div>';

    // Plateaux
    html += '<div class="board-tabs">' + s.players.map((p, i) => '<button data-seat="' + i + '" class="' + (i === app.viewSeat ? 'on' : '') + '">' + esc(p.name) + (i === me && app.mode === 'online' ? ' (toi)' : '') + ' · ' + E.emptyCount(p.board) + ' vides</button>').join('') + '</div>' +
      '<div class="board-wrap">' + R.boardSVG(viewing.board, { legal, targets, last, readonly: !viewingMine }) + '</div>';

    // Cartes disponibles
    html += '<div class="section"><h3>Animaux disponibles' + (canTake ? ' <span class="hint">· tu peux en prendre une</span>' : (mine && cur.cardTaken ? ' <span class="hint" style="color:var(--muted)">· carte prise ce tour</span>' : '')) + '</h3><div class="cards-strip">' +
      s.display.map((id, i) => {
        if (!id) return '<div class="card empty"></div>';
        const card = E.CARD_BY_ID.get(id);
        return cardHTML(card, { cls: canTake ? 'takeable' : '', badge: canTake ? 'Prendre' : '', badgeCls: 'teal', attrs: 'data-display="' + i + '"' });
      }).join('') + '</div></div>';

    // Cartes du joueur affiché
    const p = viewing;
    const items = [];
    if (p.spiritChoices && viewingMine) items.push('<div class="card spirit" id="spirit-choose"><div class="head"><span class="emoji">✨</span><span>Choisis ton Esprit</span></div><div style="height:70px;display:grid;place-items:center;font-size:36px">❔</div><div class="cubes-left">2 cartes à découvrir</div></div>');
    if (p.spirit) {
      const card = E.CARD_BY_ID.get(p.spirit.id);
      const pl = placeableIds.has(card.id) && viewingMine;
      items.push(cardHTML(card, { cls: (pl ? 'placeable' : '') + (p.spirit.placed ? ' done' : ''), badge: pl ? 'Poser' : (p.spirit.placed ? '✓ posé' : ''), badgeCls: p.spirit.placed ? 'teal' : '', attrs: 'data-mine="1"' }));
    }
    for (const h of p.hand) {
      const card = E.CARD_BY_ID.get(h.id);
      const pl = placeableIds.has(h.id) && viewingMine;
      items.push(cardHTML(card, { left: h.left, cls: pl ? 'placeable' : '', badge: pl ? 'Poser' : '', attrs: 'data-mine="1"' }));
    }
    for (const d of p.done) items.push(cardHTML(E.CARD_BY_ID.get(d.id), { left: 0, cls: 'done', done: true, badge: '✓', badgeCls: 'teal', attrs: 'data-mine="1"' }));
    const active = E.activeCount(p);
    html += '<div class="section"><h3>Cartes de ' + esc(p.name) + ' <span class="hint" style="color:var(--muted)">· ' + active + '/4 en cours' + (p.done.length ? ' · ' + p.done.length + ' terminée' + (p.done.length > 1 ? 's' : '') : '') + '</span></h3><div class="cards-strip">' +
      (items.length ? items.join('') : '<div class="card empty"><div class="cubes-left" style="padding-top:60px">aucune carte</div></div>') + '</div></div>';

    // Journal
    const log = (s.log || []).slice(-8).reverse();
    html += '<div class="section"><h3>Journal</h3></div><ul class="log">' + (log.length ? log.map(l =>
      '<li>Tour ' + l.n + ' · <b>' + esc(s.players[l.p].name) + '</b> : ' + esc(E.describeActions(l.actions) || '—') + '</li>').join('') : '<li>Début de partie.</li>') + '</ul>';

    // Barre du bas
    html += '<div class="handbar">';
    if (s.status === 'finished') {
      html += '<div class="tokens"><span class="placeholder">Partie terminée</span></div><div class="actions"><button class="btn" id="results">Résultats</button></div>';
    } else if (!mine) {
      html += '<div class="tokens"><span class="placeholder">' + (app.mode === 'online' ? 'En attente de ' + esc(E.current(s).name) + '…' : 'Tour de ' + esc(E.current(s).name)) + '</span></div><div class="actions">' +
        (app.mode === 'online' ? '<button class="btn secondary" id="reload">↻</button>' : '') + '</div>';
    } else {
      const st = E.turnStatus(s);
      html += '<div class="tokens">' + (cur.slot === null && cur.tokens.length === 0 ?
        '<span class="placeholder">' + (s.market.every(m => !m.length) ? 'Plus de jetons à prendre' : 'Prends 3 jetons ↑') + '</span>' :
        cur.tokens.map((t, i) => {
          const dead = !E.legalCells(E.current(s).board, t).length;
          return '<button class="tok' + (i === app.selToken ? ' sel' : '') + (dead ? ' dead' : '') + '" data-tok="' + i + '" title="' + E.COLOR_NAMES[t] + '">' + R.tokenSVG(t) + '</button>';
        }).join('') + (cur.tokens.length === 0 ? '<span class="placeholder">Jetons posés ✓</span>' : '')) + '</div>' +
        '<div class="actions"><button class="btn secondary" id="undo" ' + (app.undo.length ? '' : 'disabled') + '>Annuler</button>' +
        '<button class="btn" id="end" ' + (st.ok ? '' : 'disabled') + '>Fin du tour</button></div>';
    }
    html += '</div></div>';
    $('#app').innerHTML = html;
    bindGame(s, mine, viewingMine, placeable);

    if (mine && app.cubeMode) showBanner('Pose le cube ' + E.CARD_BY_ID.get(app.cubeMode.id).emoji + ' ' + esc(E.CARD_BY_ID.get(app.cubeMode.id).fr) + ' : tape une case orange', () => { app.cubeMode = null; renderGame(); });
    else if (mine && app.selToken !== null && cur.tokens[app.selToken] !== undefined && !E.legalCells(E.current(s).board, cur.tokens[app.selToken]).length) {
      showBanner('Aucune case possible pour ce jeton', () => { act(w => E.discardToken(w, app.selToken)); app.selToken = app.work.cur.tokens.length ? 0 : null; renderGame(); }, 'Défausser');
    } else hideBanner();

    if (mine && E.current(s).spiritChoices && !app.spiritPrompted && !app.cubeMode) { app.spiritPrompted = true; showSpiritChoice(); }
    if (s.status === 'finished' && !app.endShown) { app.endShown = true; showResults(); }
  }

  function showBanner(text, onClick, label) {
    let b = $('#banner');
    if (!b) { b = document.createElement('div'); b.id = 'banner'; b.className = 'banner'; document.body.appendChild(b); }
    b.innerHTML = '<span>' + text + '</span><button>' + esc(label || 'Annuler') + '</button>';
    b.querySelector('button').onclick = onClick;
  }
  function hideBanner() { const b = $('#banner'); if (b) b.remove(); }

  function bindGame(s, mine, viewingMine, placeable) {
    $('#menu').onclick = showMenu;
    document.querySelectorAll('.score-chip').forEach(chip => { chip.onclick = () => { const seat = +chip.dataset.seat; if (app.viewSeat === seat) showScores(); else { app.viewSeat = seat; renderGame(); } }; });
    document.querySelectorAll('.board-tabs button').forEach(b => { b.onclick = () => { app.viewSeat = +b.dataset.seat; renderGame(); }; });
    const reload = $('#reload'); if (reload) reload.onclick = () => { refresh(); toast('Mise à jour…'); };
    const results = $('#results'); if (results) results.onclick = showResults;
    // Marché
    document.querySelectorAll('.slot.takeable').forEach(sl => {
      sl.onclick = () => {
        if (act(w => E.takeTokens(w, +sl.dataset.slot))) { app.selToken = 0; vibrate(15); renderGame(); scrollToBoard(); }
      };
    });
    // Jetons en main
    document.querySelectorAll('.tok').forEach(b => { b.onclick = () => { app.selToken = +b.dataset.tok; app.cubeMode = null; renderGame(); }; });
    // Plateau
    const board = $('.board');
    if (board && viewingMine) {
      board.addEventListener('click', ev => {
        const hex = ev.target.closest('.hex'); if (!hex) return;
        const idx = +hex.dataset.idx;
        const w = app.work;
        if (app.cubeMode) {
          if (!app.cubeMode.targets.has(idx)) { toast('Cette case ne convient pas à cet habitat', true); return; }
          const id = app.cubeMode.id;
          if (act(x => E.placeCube(x, id, idx))) { app.cubeMode = null; vibrate(20); toast('Cube posé ' + E.CARD_BY_ID.get(id).emoji); }
          renderGame(); return;
        }
        if (app.selToken === null || w.cur.tokens[app.selToken] === undefined) {
          if (w.cur.slot === null) toast('Prends d\'abord 3 jetons sur le plateau central', true);
          return;
        }
        const color = w.cur.tokens[app.selToken];
        if (!E.canPlace(w.players[w.turn].board[idx], color)) { toast('Pose impossible ici (' + E.COLOR_NAMES[color] + ')', true); return; }
        const sel = app.selToken;
        if (act(x => E.placeToken(x, sel, idx))) {
          vibrate(10);
          app.selToken = app.work.cur.tokens.length ? Math.min(sel, app.work.cur.tokens.length - 1) : null;
          // proposer les cubes devenus posables
          const now = E.placeableCubes(app.work);
          if (now.length && app.work.cur.tokens.length === 0) toast('Habitat réalisé : ' + now.map(x => E.CARD_BY_ID.get(x.id).emoji).join(' ') + ' → « Poser »');
        }
        renderGame();
      });
    }
    // Cartes disponibles
    document.querySelectorAll('.card[data-display]').forEach(c => {
      c.onclick = ev => {
        const card = E.CARD_BY_ID.get(+c.dataset.card);
        const canTake = mine && E.canTakeCard(app.work);
        if (ev.target.closest('.badge') && canTake) { takeDisplay(+c.dataset.display); return; }
        cardDetail(card, canTake ? '<button class="btn block" id="m-take">Prendre cette carte</button>' : (mine ? '<p class="note">' + (app.work.cur.cardTaken ? 'Tu as déjà pris une carte ce tour.' : 'Tu as déjà 4 cartes en cours.') + '</p>' : ''));
        const b = $('#m-take'); if (b) b.onclick = () => { closeModal(); takeDisplay(+c.dataset.display); };
      };
    });
    function takeDisplay(i) { if (act(w => E.takeCard(w, i))) { vibrate(15); toast('Carte prise'); } renderGame(); }
    // Mes cartes
    const spiritBtn = $('#spirit-choose'); if (spiritBtn) spiritBtn.onclick = showSpiritChoice;
    document.querySelectorAll('.card[data-mine]').forEach(c => {
      c.onclick = ev => {
        const id = +c.dataset.card;
        const card = E.CARD_BY_ID.get(id);
        const pc = placeable.find(x => x.id === id);
        if (pc && viewingMine && ev.target.closest('.badge')) { startCube(pc); return; }
        cardDetail(card, pc && viewingMine ? '<button class="btn block warn" id="m-cube">Poser un cube ' + card.emoji + '</button>' : '');
        const b = $('#m-cube'); if (b) b.onclick = () => { closeModal(); startCube(pc); };
      };
    });
    function startCube(pc) {
      if (pc.targets.length === 1) {
        if (act(w => E.placeCube(w, pc.id, pc.targets[0]))) { vibrate(20); toast('Cube posé ' + E.CARD_BY_ID.get(pc.id).emoji); }
        renderGame(); return;
      }
      app.cubeMode = { id: pc.id, targets: new Set(pc.targets) };
      renderGame(); scrollToBoard();
    }
    // Annuler / Fin du tour
    const undo = $('#undo'); if (undo) undo.onclick = () => {
      if (!app.undo.length) return;
      app.work = app.undo.pop();
      app.selToken = app.work.cur.tokens.length ? 0 : null; app.cubeMode = null;
      saveDraft(); renderGame();
    };
    const end = $('#end'); if (end) end.onclick = endTurn;
  }
  function scrollToBoard() { const b = $('.board-wrap'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  async function endTurn() {
    const w = E.clone(app.work);
    try { E.endTurn(w); } catch (e) { toast(e.message, true); return; }
    const btn = $('#end'); if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
    try {
      const r = await app.net.saveGame(app.gameId, w, app.version);
      app.committed = w; app.version = r.version; app.work = null; app.undo = []; app.selToken = null; app.cubeMode = null; app.spiritPrompted = false;
      app.lastLogLen = w.log.length;
      ls.del('harmonies.draft.' + app.gameId);
      if (app.mode === 'local' && w.status === 'playing') {
        modal('<h2>📱 Au tour de ' + esc(E.current(w).name) + '</h2><p>Passe le téléphone à ' + esc(E.current(w).name) + '.</p><div class="actions"><button class="btn" id="m-ok">C\'est parti</button></div>', { sticky: true });
        $('#m-ok').onclick = () => { closeModal(); render(); };
      } else render();
    } catch (e) {
      if (e.code === 'conflict') { toast('La partie a changé entre-temps, rechargement…', true); app.work = null; await refresh(); render(); }
      else { toast('Envoi impossible : ' + e.message + ' — réessaie', true); renderGame(); }
    }
  }

  // ---------- Modales de jeu ----------
  function showSpiritChoice() {
    if (!app.work) return;
    const p = E.current(app.work);
    if (!p.spiritChoices) return;
    modal('<h2>✨ Choisis ton Esprit de la Nature</h2><p class="note">Une seule carte est gardée, l\'autre retourne dans la boîte. Elle compte dans ta limite de 4 cartes tant que son cube n\'est pas posé.</p>' +
      '<div class="choice-grid">' + p.spiritChoices.map(id => cardHTML(E.CARD_BY_ID.get(id), { attrs: 'data-choose="' + id + '"' })).join('') + '</div>' +
      '<div class="actions"><button class="btn secondary" id="m-later">Plus tard</button></div>');
    $('#m-later').onclick = closeModal;
    document.querySelectorAll('[data-choose]').forEach(c => { c.onclick = () => { const id = +c.dataset.choose; closeModal(); if (act(w => E.chooseSpirit(w, id))) toast('Esprit choisi : ' + E.CARD_BY_ID.get(id).fr); renderGame(); }; });
  }
  function scoreTable(s) {
    const rows = [['trees', '🌳 Arbres'], ['mountains', '⛰️ Montagnes'], ['fields', '🌾 Champs'], ['buildings', '🏠 Bâtiments'], [s.opts.side === 'B' ? 'water' : 'water', s.opts.side === 'B' ? '🏝️ Îles' : '🌊 Rivière'], ['animals', '🐾 Animaux'], ['spirit', '✨ Esprit']];
    const scores = s.players.map(p => E.scorePlayer(p, s.opts.side));
    return '<table class="scores"><tr><th></th>' + s.players.map((p, i) => '<th style="color:' + SEAT_COLORS[i] + '">' + esc(p.name) + '</th>').join('') + '</tr>' +
      rows.filter(([k]) => k !== 'spirit' || s.opts.spirits).map(([k, label]) => '<tr><td>' + label + '</td>' + scores.map(sc => '<td>' + sc[k] + '</td>').join('') + '</tr>').join('') +
      '<tr class="total"><td>Total</td>' + scores.map(sc => '<td>' + sc.total + '</td>').join('') + '</tr>' +
      '<tr><td class="note">cubes posés</td>' + s.players.map(p => '<td class="note">' + p.cubes + '</td>').join('') + '</tr></table>';
  }
  function showScores() {
    const s = view();
    modal('<h2>Score en direct</h2>' + scoreTable(s) + '<p class="note">Estimation calculée sur l\'état actuel des plateaux (' + esc(SIDE_LABEL[s.opts.side]) + ').</p><div class="actions"><button class="btn secondary" id="m-close">Fermer</button></div>');
    $('#m-close').onclick = closeModal;
  }
  function showResults() {
    const s = app.committed;
    if (!s.result) return;
    const winners = s.result.winners.map(i => s.players[i].name);
    const reason = s.endReason === 'bag' ? 'le sac était vide' : 'un plateau n\'avait plus que 2 cases vides ou moins';
    modal('<h2>🏁 Fin de partie</h2><div class="winner">' + (winners.length > 1 ? 'Égalité : ' + esc(winners.join(' & ')) : '🏆 ' + esc(winners[0]) + ' gagne !') + '</div>' +
      scoreTable(s) + '<p class="note">Fin déclenchée car ' + reason + '. En cas d\'égalité, le plus grand nombre de cubes posés l\'emporte.</p>' +
      '<div class="actions"><button class="btn secondary" id="m-close">Voir les plateaux</button><button class="btn" id="m-again">Revanche</button></div>');
    $('#m-close').onclick = closeModal;
    $('#m-again').onclick = rematch;
  }
  async function rematch() {
    const s = app.committed;
    closeModal();
    if (app.mode === 'local') { startLocal(s.opts, s.players.map(p => p.name)); return; }
    if (s.rematch) { openOnline(s.rematch); return; }
    try {
      const id = randomId(5);
      const state = { status: 'lobby', id, opts: s.opts, host: myPid(), players: s.players.map(p => ({ pid: p.pid, name: p.name })), createdAt: Date.now() };
      await app.net.createGame(id, state);
      const old = E.clone(s); old.rematch = id;
      try { await app.net.saveGame(app.gameId, old, app.version); } catch (e) { /* peu importe */ }
      rememberGame({ id, mode: 'online', label: 'En ligne · ' + SIDE_LABEL[s.opts.side] });
      history.replaceState(null, '', '?g=' + id);
      enterGame(id, state, 1);
    } catch (e) { toast('Revanche impossible : ' + e.message, true); }
  }
  function showMenu() {
    const s = app.committed;
    const link = location.origin + location.pathname + '?g=' + (s.id || '');
    modal('<h2>Menu</h2><ul class="menu">' +
      (app.mode === 'online' ? '<li id="mn-share">📤 Partager le lien de la partie</li>' : '') +
      '<li id="mn-scores">📊 Score détaillé</li><li id="mn-rules">📖 Règles et légende</li>' +
      (app.mode === 'online' && s.status === 'playing' && mySeat() < 0 ? '<li id="mn-claim">🪪 Je suis un des joueurs (reprendre ma place)</li>' : '') +
      (app.mode === 'online' ? '<li id="mn-reload">↻ Recharger la partie</li>' : '') +
      '<li id="mn-home">🏠 Retour à l\'accueil</li></ul>' +
      '<p class="note">' + (app.mode === 'online' ? 'Partie en ligne · code ' + esc(s.id) + ' · ' : 'Partie locale · ') + esc(SIDE_LABEL[s.opts.side]) + (s.opts.spirits ? ' · Esprits' : '') + '</p>' +
      '<div class="actions"><button class="btn secondary" id="m-close">Fermer</button></div>');
    $('#m-close').onclick = closeModal;
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    on('#mn-share', async () => { closeModal(); if (navigator.share) { try { await navigator.share({ title: 'Harmonies', text: 'Notre partie d\'Harmonies (code ' + s.id + ')', url: link }); } catch (e) { /* annulé */ } } else { await copyText(link); toast('Lien copié'); } });
    on('#mn-scores', () => { closeModal(); showScores(); });
    on('#mn-rules', () => { closeModal(); showRules(); });
    on('#mn-reload', () => { closeModal(); app.version = 0; refresh(); });
    on('#mn-home', () => { closeModal(); leaveGame(); renderHome(); });
    on('#mn-claim', () => {
      closeModal();
      modal('<h2>Qui es-tu ?</h2><p class="note">Cet appareil n\'est associé à aucun joueur de la partie (nouveau téléphone, données effacées…).</p><ul class="menu">' +
        s.players.map((p, i) => '<li data-seat="' + i + '"><span class="dot" style="background:' + SEAT_COLORS[i] + '"></span>' + esc(p.name) + '</li>').join('') + '</ul><div class="actions"><button class="btn secondary" id="m-close">Annuler</button></div>');
      $('#m-close').onclick = closeModal;
      document.querySelectorAll('.menu li[data-seat]').forEach(li => { li.onclick = async () => {
        const st = E.clone(app.committed); st.players[+li.dataset.seat].pid = myPid();
        try { const r = await app.net.saveGame(app.gameId, st, app.version); app.committed = st; app.version = r.version; app.work = null; closeModal(); render(); toast('Bienvenue, ' + st.players[+li.dataset.seat].name); }
        catch (e) { toast('Échec : ' + e.message, true); refresh(); }
      }; });
    });
  }
  function showRules() {
    const tok = c => R.tokenSVG(c);
    modal('<h2>📖 Règles essentielles</h2><div class="rules">' +
      '<p><b>Tour de jeu</b> — obligatoire : prendre les 3 jetons d\'un emplacement du plateau central et les poser. Optionnel (à tout moment, même entre deux jetons) : prendre 1 carte Animal (une par tour, max 4 cartes en cours) et poser des cubes (sans limite).</p>' +
      '<p><b>Empilement</b> — bleu et jaune : uniquement au sol, rien dessus. Gris : au sol ou sur du gris (max 3). Marron : au sol ou sur 1 marron. Vert : au sol (buisson) ou sur 1 ou 2 marrons (arbre). Rouge : au sol ou sur 1 gris / marron / rouge (bâtiment). Jamais sur une case qui porte un cube.</p>' +
      '<div class="legend">' +
      '<div>' + tok(4) + ' Arbre : 1 / 3 / 7 pts (hauteur 1, 2, 3)</div>' +
      '<div>' + tok(2) + ' Montagne : 1 / 3 / 7 pts, si voisine d\'une autre montagne</div>' +
      '<div>' + tok(5) + ' Champ : 5 pts par groupe d\'au moins 2 jaunes</div>' +
      '<div>' + tok(6) + ' Bâtiment : 5 pts si entouré de 3 couleurs différentes</div>' +
      '<div>' + tok(1) + ' Face A · rivière : 2 / 5 / 8 / 11 / 15 (+4 par jeton au-delà de 6), la meilleure rivière seulement</div>' +
      '<div>' + tok(1) + ' Face B · îles : 5 pts par groupe de cases séparé par l\'eau</div>' +
      '</div>' +
      '<p><b>Cubes</b> — le motif de la carte doit être reproduit exactement (hauteurs comprises), dans n\'importe quelle orientation. Le cube va sur la case indiquée, qui doit être libre de cube. Un jeton peut servir à plusieurs habitats ; un cube posé est définitif et bloque sa case. Quand la carte n\'a plus de cube, elle est terminée et ne compte plus dans la limite de 4.</p>' +
      '<p><b>Points des cartes</b> — la valeur d\'une carte est celle du dernier palier découvert (0 si aucun cube posé).</p>' +
      '<p><b>Fin</b> — quand le sac est vide au moment de recharger, ou quand un joueur a 2 cases vides ou moins : on termine la manche. Égalité : le plus de cubes posés.</p>' +
      '</div><div class="actions"><button class="btn secondary" id="m-close">Fermer</button></div>');
    $('#m-close').onclick = closeModal;
  }

  // ---------- Démarrage ----------
  function boot() {
    const params = new URLSearchParams(location.search);
    const code = (params.get('g') || '').toUpperCase();
    if (params.get('pid')) { try { sessionStorage.setItem('harmonies.pid', params.get('pid')); } catch (e) { /* ignore */ } }
    if (params.get('name')) ls.set('harmonies.name', params.get('name'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && app.mode === 'online' && app.gameId) refresh(); });
    if (code && ONLINE_OK) {
      renderHome();
      openOnline(code).then(async () => {
        if (app.committed && app.committed.status === 'lobby' && !app.committed.players.some(p => p.pid === myPid()) && myName()) {
          try { await joinLobby(myName()); render(); } catch (e) { toast('Impossible de rejoindre : ' + e.message, true); }
        }
      });
    } else renderHome();
  }
  root.HarmoniesApp = { boot, app, render, act, endTurn, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof self !== 'undefined' ? self : this);
