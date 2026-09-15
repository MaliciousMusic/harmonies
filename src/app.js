// Application Harmonies : écrans, interactions, animations, sons, synchronisation.
(function (root) {
  'use strict';
  const E = root.Engine, R = root.Render, esc = R.esc, I = root.Icons;
  const ic = (name, cls) => I.svg(name, cls);
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const CFG = root.HARMONIES_CONFIG || {};
  const ONLINE_OK = !!(CFG.url && CFG.key && !CFG.url.startsWith('__') && root.supabase);
  const SEAT_COLORS = ['#2a8f8a', '#e8873a', '#6b4fa0', '#d96a8e'];
  const SIDE_LABEL = { A: 'Face A · rivière', B: 'Face B · îles' };
  const BANNER = ['#f2c94c', '#e8873a', '#5cc2b7', '#2a8f8a', '#2c4a8a', '#1e2a5a'];
  const wait = ms => new Promise(r => setTimeout(r, ms));

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
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(buf);
    else for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 4294967296);
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

  // ---------- Sons (synthèse Web Audio, aucun fichier) ----------
  const Sfx = (() => {
    let ctx = null;
    let enabled = ls.get('harmonies.sound', true);
    function ensure() {
      if (!enabled) return null;
      try {
        if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { return null; }
      return ctx;
    }
    function tone(freq, dur, type, gain, delay, slideTo) {
      const c = ensure(); if (!c) return;
      const t0 = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, freq, gain, delay, q) {
      const c = ensure(); if (!c) return;
      const t0 = c.currentTime + (delay || 0);
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 0.8;
      const g = c.createGain(); g.gain.setValueAtTime(gain || 0.2, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t0);
    }
    return {
      get enabled() { return enabled; },
      toggle() { enabled = !enabled; ls.set('harmonies.sound', enabled); if (enabled) { ensure(); this.take(); } return enabled; },
      unlock() { ensure(); },
      take() { noise(0.16, 1400, 0.12, 0, 0.6); tone(520, 0.12, 'sine', 0.05, 0, 760); },
      place() { noise(0.045, 2200, 0.28, 0, 1.2); tone(190, 0.11, 'triangle', 0.22, 0, 120); },
      card() { noise(0.09, 3200, 0.16, 0, 1); noise(0.06, 5000, 0.08, 0.05, 1); },
      cube() { tone(1046, 0.06, 'square', 0.05); tone(1568, 0.14, 'sine', 0.12, 0.06); noise(0.03, 3000, 0.15); },
      turn() { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'sine', 0.16, i * 0.11)); },
      undo() { tone(420, 0.09, 'triangle', 0.12); tone(300, 0.12, 'triangle', 0.12, 0.07); },
      error() { tone(140, 0.16, 'sawtooth', 0.06, 0, 110); },
      draw() { noise(0.12, 900, 0.1, 0, 0.5); },
      win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, 'triangle', 0.16, i * 0.13)); },
      lose() { [392, 349, 311].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, i * 0.18)); },
    };
  })();

  // ---------- Animations (vols d'éléments par-dessus la page) ----------
  const rectOf = el => (el ? el.getBoundingClientRect() : null);
  const canAnimate = () => typeof Element !== 'undefined' && !!Element.prototype.animate;
  function fly(from, to, html, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      if (!from || !to || !from.width || !to.width || !canAnimate()) { resolve(); return; }
      const el = document.createElement('div');
      el.className = 'fly' + (opts.cls ? ' ' + opts.cls : '');
      el.style.cssText = 'left:' + from.left + 'px;top:' + from.top + 'px;width:' + from.width + 'px;height:' + from.height + 'px;';
      el.innerHTML = html;
      document.body.appendChild(el);
      const dur = opts.duration || 480;
      const sx = to.width / from.width, sy = to.height / from.height;
      const arc = opts.arc === undefined ? -40 : opts.arc;
      const dx = to.left - from.left, dy = to.top - from.top;
      const a = el.animate([
        { transform: 'translate(0,0) scale(1,1)' },
        { transform: 'translate(' + dx / 2 + 'px,' + (dy / 2 + arc) + 'px) scale(' + ((1 + sx) / 2) + ',' + ((1 + sy) / 2) + ')', offset: 0.5 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')' },
      ], { duration: dur, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
      let done = false;
      const finish = () => { if (done) return; done = true; el.remove(); resolve(); };
      a.onfinish = finish; a.oncancel = finish;
      setTimeout(finish, dur + 200);
    });
  }
  function reveal(el, cls) {
    if (!el) return;
    el.classList.remove('arriving');
    if (cls) { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 700); }
  }
  function floatText(anchor, text, cls) {
    const r = rectOf(anchor); if (!r) return;
    const el = document.createElement('div');
    el.className = 'float-text ' + (cls || '');
    el.textContent = text;
    el.style.left = (r.left + r.width / 2) + 'px'; el.style.top = r.top + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }
  function confetti() {
    const colors = ['#3d8fc4', '#6aa83c', '#e8b526', '#cf4540', '#5cc2b7', '#6b4fa0'];
    for (let i = 0; i < 46; i++) {
      const p = document.createElement('div');
      p.className = 'confetti';
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.8) + 's';
      p.style.animationDuration = (2.2 + Math.random() * 1.4) + 's';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 4400);
    }
  }
  function turnOverlay(html) {
    const el = document.createElement('div');
    el.className = 'turn-overlay';
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1500);
    setTimeout(() => el.remove(), 1900);
  }

  // ---------- État de l'application ----------
  const app = {
    screen: 'home', net: null, mode: null, gameId: null, version: 0,
    committed: null, work: null, undo: [], viewSeat: 0, selToken: null, cubeMode: null,
    unsub: null, poll: null, rtOk: false, endShown: false, spiritPrompted: false, lastLogLen: 0,
    replay: null, busy: false,
  };
  const view = () => (app.replay ? app.replay.state : (app.work || app.committed));
  const isMine = () => {
    const s = app.committed;
    if (!s || s.status !== 'playing' || app.replay) return false;
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
    t.innerHTML = (err ? ic('x') : ic('check')) + '<span>' + msg + '</span>';
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 3200 : 2400);
    if (err) Sfx.error();
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
  let interacted = false;
  function vibrate(ms) { if (interacted && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
  function showBanner(html, onClick, label) {
    let b = $('#banner');
    if (!b) { b = document.createElement('div'); b.id = 'banner'; b.className = 'banner'; document.body.appendChild(b); }
    b.innerHTML = '<span>' + html + '</span>' + (onClick ? '<button>' + label + '</button>' : '');
    if (onClick) b.querySelector('button').onclick = onClick;
  }
  function hideBanner() { const b = $('#banner'); if (b) b.remove(); }
  const seatDot = i => '<span class="dot" style="background:' + SEAT_COLORS[i] + '"></span>';
  const miniTok = c => '<span class="mtok">' + R.tokenSVG(c) + '</span>';
  const miniAnimal = id => '<span class="manimal">' + R.animalSVG(id) + '</span>';
  // Résumé HTML des actions d'un tour (journal, toasts)
  function actionsHTML(actions) {
    const parts = [];
    for (const a of actions) {
      if (a.a === 'take') parts.push(a.tokens.map(miniTok).join(''));
      else if (a.a === 'card') parts.push(miniAnimal(a.id) + ' ' + esc(E.CARD_BY_ID.get(a.id).fr));
      else if (a.a === 'cube') parts.push('<span class="mcube"></span>' + miniAnimal(a.id) + ' ' + esc(E.CARD_BY_ID.get(a.id).fr));
      else if (a.a === 'spirit') parts.push(ic('sparkles', 'inl') + ' ' + esc(E.CARD_BY_ID.get(a.id).fr));
      else if (a.a === 'discard') parts.push('défausse ' + miniTok(a.color));
    }
    return parts.join('<span class="sep">·</span>');
  }

  // ---------- Cartes ----------
  function cardHTML(card, opts) {
    opts = opts || {};
    const left = opts.left === undefined ? card.pts.length : opts.left;
    const placed = card.pts.length - left;
    const cls = 'card' + (card.spirit ? ' spirit' : '') + (opts.cls ? ' ' + opts.cls : '');
    const badge = opts.badge ? '<div class="badge' + (opts.badgeCls ? ' ' + opts.badgeCls : '') + '">' + opts.badge + '</div>' : '';
    let track = '';
    if (!card.spirit) {
      track = '<div class="track">' + card.pts.map((v, i) => {
        const c = i < placed ? 'step got' + (i === placed - 1 ? ' cur' : '') : 'step cube';
        return '<div class="' + c + '" data-step="' + i + '" title="' + v + ' pts">' + (i < placed ? v : '') + '</div>';
      }).reverse().join('') + '</div>';
    }
    const foot = card.spirit ? '<div class="rule">' + esc(card.rule) + '</div>' :
      '<div class="foot">' + (opts.done ? 'terminée · ' + card.pts[card.pts.length - 1] + ' pts' : (placed ? placed + '/' + card.pts.length + ' posé' + (placed > 1 ? 's' : '') + ' · ' + E.cardValue(card, left) + ' pts' : card.pts.length + ' cubes · jusqu\'à ' + card.pts[card.pts.length - 1] + ' pts')) + '</div>';
    return '<div class="' + cls + '" data-card="' + card.id + '" ' + (opts.attrs || '') + '>' +
      '<div class="stripe" style="background:' + R.cubeColorOf(card) + '"></div>' + badge +
      '<div class="art">' + R.sceneSVG(card) + R.animalSVG(card.id) + '<div class="name">' + esc(card.fr) + '</div></div>' +
      track + R.patternSVG(card) + foot + '</div>';
  }
  function cardDetail(card, extraHTML) {
    const step = card.pat.find(p => p.cube);
    const cubeColor = step.s[0] === 7 ? 6 : step.s[0];
    const howto = card.spirit
      ? '<p><b>Esprit de la Nature.</b> Pose son cube quand le motif est réalisé ; en fin de partie : ' + esc(card.rule) + '.</p>'
      : '<p>Valeur selon le nombre de cubes posés : <b>' + card.pts.join(' → ') + '</b> pts. Le cube se pose sur le jeton <b>' + E.COLOR_NAMES[cubeColor] + '</b> ' + miniTok(cubeColor) + ' du motif, dans n\'importe quelle orientation.</p>';
    modal('<h2>' + R.animalSVG(card.id, 'h') + esc(card.fr) + '</h2>' + cardHTML(card, { cls: 'big' }) + howto + (extraHTML || '') +
      '<div class="actions"><button class="btn secondary" id="m-close">Fermer</button></div>');
    $('#m-close').onclick = closeModal;
  }

  // ---------- Écran d'accueil ----------
  function headerHTML(sub) {
    return '<div class="hero">' + R.hillsSVG(400, 190, BANNER, { reeds: 14, seed: 7, cls: 'hero-hills' }) +
      '<div class="hero-inner">' + R.logoSVG() + (sub ? '<div class="tagline">' + sub + '</div>' : '') + '</div></div>';
  }
  function renderHome() {
    app.screen = 'home';
    document.title = 'Harmonies';
    hideBanner();
    const recent = ls.get('harmonies.recent', []);
    const opts = ls.get('harmonies.opts', { side: 'A', spirits: false });
    $('#app').innerHTML =
      '<div class="screen home">' + headerHTML('Compose tes paysages, accueille tes animaux') +
      '<div class="home-body">' +
      '<div class="panel"><div class="field"><label>Ton prénom</label><input type="text" id="name" maxlength="16" placeholder="Ex. Hadrien" value="' + esc(myName()) + '"></div>' +
      '<div class="field"><label>Plateau personnel</label><div class="seg" id="side"><button data-v="A" class="' + (opts.side === 'A' ? 'on' : '') + '">' + miniTok(1) + 'Face A · rivière</button><button data-v="B" class="' + (opts.side === 'B' ? 'on' : '') + '">' + miniTok(5) + 'Face B · îles</button></div></div>' +
      '<label class="check"><input type="checkbox" id="spirits" ' + (opts.spirits ? 'checked' : '') + '><span>' + ic('sparkles', 'inl') + ' Cartes Esprit de la Nature <em>(variante avancée)</em></span></label>' +
      '<div class="row" style="margin-top:8px"><button class="btn primary" id="create" ' + (ONLINE_OK ? '' : 'disabled') + '>' + ic('globe') + 'Créer une partie en ligne</button></div>' +
      (ONLINE_OK ? '' : '<p class="note">Mode en ligne indisponible (pas de configuration serveur).</p>') +
      '<div class="row" style="margin-top:10px"><button class="btn secondary" id="local">' + ic('phone') + 'Jouer sur ce téléphone</button></div></div>' +
      '<div class="panel"><h2>' + ic('login', 'h') + 'Rejoindre une partie</h2><div class="row"><input type="text" id="code" placeholder="CODE" maxlength="6" class="code-input"><button class="btn primary" id="join" ' + (ONLINE_OK ? '' : 'disabled') + '>Rejoindre</button></div></div>' +
      (recent.length ? '<div class="panel"><h2>' + ic('layers', 'h') + 'Parties récentes</h2><ul class="recent">' + recent.map(g =>
        '<li data-id="' + esc(g.id) + '" data-mode="' + g.mode + '"><span class="code">' + (g.mode === 'local' ? ic('phone') : esc(g.id)) + '</span><span class="meta">' + esc(g.label || '') + '<br>' + new Date(g.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '</span><button class="btn small secondary">Ouvrir</button></li>').join('') + '</ul></div>' : '') +
      '<div class="panel rules"><h2>' + ic('book', 'h') + 'Comment jouer</h2><p>À ton tour : prends les <b>3 jetons</b> d\'un emplacement du plateau central et pose-les sur ton plateau (en respectant les règles d\'empilement). Tu peux aussi prendre <b>1 carte Animal</b> (max 4 devant toi) et poser des <b>cubes</b> dès que leur habitat est réalisé — ces actions sont possibles à tout moment du tour.</p>' +
      '<p>Fin de partie : sac vide au moment de recharger, ou <b>2 cases vides ou moins</b> sur ton plateau (on finit la manche).</p><button class="btn ghost" id="rules-more">Le détail des règles et du score →</button></div>' +
      '<p class="credits">Adaptation non officielle du jeu Harmonies (Johan Benvenuto, Libellud). Icônes animaux : OpenMoji (CC BY-SA 4.0).</p>' +
      '</div></div>';
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
      Sfx.unlock();
      try { await createOnline(readOpts(), n); } catch (e) { toast('Création impossible : ' + e.message, true); }
    };
    $('#join').onclick = async () => {
      const n = ensureName(); if (!n) return;
      Sfx.unlock();
      const code = $('#code').value.trim().toUpperCase();
      if (code.length < 4) { toast('Code invalide', true); return; }
      openOnline(code);
    };
    $('#local').onclick = () => { Sfx.unlock(); localSetup(readOpts()); };
    $('#rules-more').onclick = showRules;
    $$('.recent li').forEach(li => {
      li.querySelector('button').onclick = () => { Sfx.unlock(); if (li.dataset.mode === 'local') openLocal(li.dataset.id); else openOnline(li.dataset.id); };
    });
  }

  function localSetup(opts) {
    const names = ls.get('harmonies.localNames', [myName() || 'Joueur 1', 'Joueur 2']);
    modal('<h2>' + ic('phone', 'h') + 'Partie sur ce téléphone</h2><p class="note">Les joueurs se passent le téléphone à chaque tour.</p>' +
      '<div id="names">' + names.map((n, i) => '<div class="field"><label>Joueur ' + (i + 1) + '</label><input type="text" maxlength="16" value="' + esc(n) + '"></div>').join('') + '</div>' +
      '<div class="row"><button class="btn secondary small" id="m-add">' + ic('plus') + 'joueur</button><button class="btn secondary small" id="m-del">' + ic('minus') + 'joueur</button></div>' +
      '<div class="actions"><button class="btn secondary" id="m-cancel">Annuler</button><button class="btn primary" id="m-go">Commencer</button></div>');
    const getNames = () => $$('#names input').map(i => i.value.trim());
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
    app.gameId = id; app.committed = state; app.version = version; app.work = null; app.undo = []; app.replay = null; app.busy = false;
    app.selToken = null; app.cubeMode = null; app.endShown = false; app.spiritPrompted = false; app.lastLogLen = (state.log || []).length;
    app.viewSeat = 0;
    app.unsub = app.net.subscribe(id, () => refresh(), ok => { app.rtOk = ok; const d = $('#conn'); if (d) d.className = 'conn ' + (ok ? 'on' : 'off'); });
    if (app.mode === 'online') {
      app.poll = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    }
    render();
    if (isMine() && state.status === 'playing') announceMyTurn();
  }
  let refreshing = false;
  async function refresh() {
    if (!app.gameId || !app.net || refreshing) return;
    refreshing = true;
    let rec;
    try { rec = await app.net.loadGame(app.gameId); } catch (e) { refreshing = false; return; }
    refreshing = false;
    if (!rec || rec.version <= app.version) return;
    const prev = app.committed;
    const wasMine = isMine();
    app.committed = rec.state; app.version = rec.version;
    if (app.replay) app.replay.abort = true;
    if (!wasMine || !isMine()) { app.work = null; app.undo = []; app.selToken = null; app.cubeMode = null; ls.del('harmonies.draft.' + app.gameId); }
    // rejeu animé du tour adverse si l'on dispose de l'état exact qui le précédait
    const s = app.committed;
    const entry = s.log && s.log.length > app.lastLogLen ? s.log[s.log.length - 1] : null;
    const who = entry ? s.players[entry.p] : null;
    const remote = !!who && !(app.mode === 'online' && who.pid === myPid());
    const canReplay = remote && prev && prev.status === 'playing' && prev.log && s.log.length === prev.log.length + 1 && prev.turn === entry.p && prev.turnNo === entry.n && document.visibilityState === 'visible';
    app.lastLogLen = s.log ? s.log.length : 0;
    if (canReplay) { await replayTurn(prev, entry, s); return; }
    if (remote) toast(esc(who.name) + ' : ' + (actionsHTML(entry.actions) || 'a joué'));
    render();
    if (isMine() && s.status === 'playing' && !wasMine) announceMyTurn();
  }
  function announceMyTurn() {
    const me = E.current(app.committed);
    turnOverlay(ic('hand', 'big') + '<div>À toi de jouer' + (app.mode === 'online' ? ', ' + esc(me.name) : ' : ' + esc(me.name)) + ' !</div>');
    Sfx.turn(); vibrate([30, 40, 30]);
  }

  // ---------- Rejeu animé du tour d'un autre joueur ----------
  async function replayTurn(prev, entry, next) {
    const state = E.clone(prev);
    const token = { state, seat: entry.p, abort: false };
    app.replay = token;
    app.viewSeat = entry.p;
    const name = next.players[entry.p].name;
    renderGame();
    showBanner(ic('film', 'inl') + ' ' + esc(name) + ' joue son tour…', () => { token.abort = true; }, ic('skip') + 'Passer');
    await wait(500);
    for (const a of entry.actions) {
      if (token.abort) break;
      try {
        if (a.a === 'take') {
          let slot = a.slot;
          if (slot === undefined) slot = state.market.findIndex(m => m.length === a.tokens.length && m.every((t, i) => t === a.tokens[i]));
          if (slot >= 0) await animatedTake(state, slot);
        } else if (a.a === 'place') {
          const idx = state.cur.tokens.indexOf(a.color);
          if (idx >= 0) await animatedPlace(state, idx, a.cell);
        } else if (a.a === 'card') {
          const idx = a.slot !== undefined && state.display[a.slot] === a.id ? a.slot : state.display.indexOf(a.id);
          if (idx >= 0) await animatedCard(state, idx);
        } else if (a.a === 'cube') {
          await animatedCube(state, a.id, a.cell);
        } else if (a.a === 'spirit') {
          E.chooseSpirit(state, a.id); renderGame(); toast(esc(name) + ' choisit l\'esprit ' + esc(E.CARD_BY_ID.get(a.id).fr));
        } else if (a.a === 'discard') {
          const idx = state.cur.tokens.indexOf(a.color); if (idx >= 0) E.discardToken(state, idx); renderGame();
        }
      } catch (e) { break; }
      if (token.abort) break;
      await wait(350);
    }
    const aborted = token.abort;
    if (app.replay !== token) return; // remplacé par un rejeu plus récent
    app.replay = null;
    hideBanner();
    if (app.committed !== next) { render(); return; } // un état plus récent est arrivé entre-temps
    const take = entry.actions.find(x => x.a === 'take');
    const newDisplay = [];
    next.display.forEach((id, i) => { if (id && prev.display[i] !== id) newDisplay.push(i); });
    const mineNow = isMine();
    if (mineNow) ensureWork(); else app.viewSeat = mySeat() >= 0 ? mySeat() : entry.p;
    renderGame(aborted ? {} : { refillSlot: take ? take.slot : undefined, newDisplay });
    if (!aborted) await animateRefill(take ? take.slot : undefined, newDisplay);
    if (mineNow && next.status === 'playing') announceMyTurn();
    if (next.status === 'finished' && !app.endShown) { app.endShown = true; showResults(); }
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
    hideBanner();
    const s = app.committed;
    const host = s.host === myPid();
    const inGame = s.players.some(p => p.pid === myPid());
    const link = location.origin + location.pathname + '?g=' + s.id;
    $('#app').innerHTML = '<div class="screen home">' + headerHTML('Salle d\'attente') + '<div class="home-body">' +
      '<div class="panel"><h2>' + ic('users', 'h') + 'Code de la partie</h2><div class="code-big">' + esc(s.id) + '</div>' +
      '<p class="note center">' + esc(SIDE_LABEL[s.opts.side]) + (s.opts.spirits ? ' · Esprits de la Nature' : '') + '</p>' +
      '<div class="row"><button class="btn primary" id="share">' + ic('send') + 'Envoyer le lien</button><button class="btn secondary" id="copy">' + ic('copy') + 'Copier</button></div></div>' +
      '<div class="panel"><h2>' + ic('users', 'h') + 'Joueurs (' + s.players.length + '/4)</h2><ul class="players-list">' + s.players.map((p, i) =>
        '<li>' + seatDot(i) + '<b>' + esc(p.name) + '</b>' + (p.pid === s.host ? ' <span class="note">· hôte</span>' : '') + (p.pid === myPid() ? ' <span class="note">· toi</span>' : '') + '</li>').join('') + '</ul>' +
      (inGame ? '' : '<div class="field" style="margin-top:10px"><label>Ton prénom</label><input type="text" id="jname" maxlength="16" value="' + esc(myName()) + '"></div><button class="btn primary block" id="joinbtn">Rejoindre la partie</button>') +
      '</div>' +
      (host ? '<button class="btn primary block big" id="start" ' + (s.players.length >= 2 ? '' : 'disabled') + '>' + ic('play') + 'Commencer la partie (' + s.players.length + ' joueur' + (s.players.length > 1 ? 's' : '') + ')</button>' +
        (s.players.length < 2 ? '<p class="note center">En attente d\'au moins un autre joueur… la page se met à jour toute seule.</p>' : '') :
        '<p class="note center">En attente que l\'hôte lance la partie… <span class="conn ' + (app.rtOk ? 'on' : '') + '" id="conn"></span></p>') +
      '<button class="btn ghost" id="leave">' + ic('back') + 'Retour à l\'accueil</button></div></div>';
    $('#share').onclick = async () => {
      const text = 'Viens jouer à Harmonies avec moi ! Code ' + s.id + ' — ' + link;
      if (navigator.share) { try { await navigator.share({ title: 'Harmonies', text, url: link }); } catch (e) { /* annulé */ } }
      else { await copyText(link); toast('Lien copié'); }
    };
    $('#copy').onclick = async () => { await copyText(link); toast('Lien copié'); };
    $('#leave').onclick = () => { leaveGame(); renderHome(); };
    if (!inGame) $('#joinbtn').onclick = async () => {
      const n = $('#jname').value.trim(); if (!n) { toast('Indique ton prénom', true); return; }
      ls.set('harmonies.name', n); Sfx.unlock();
      try { await joinLobby(n); render(); } catch (e) { toast('Impossible de rejoindre : ' + e.message, true); }
    };
    if (host) $('#start').onclick = async () => {
      Sfx.unlock();
      const st = E.newGame(s.opts, s.players.map(p => ({ token: p.pid, name: p.name })));
      st.players.forEach((p, i) => { p.pid = s.players[i].pid; });
      st.id = s.id; st.host = s.host; st.mode = 'online';
      try {
        const r = await app.net.saveGame(app.gameId, st, app.version);
        app.committed = st; app.version = r.version; app.lastLogLen = 0;
        render();
        if (isMine()) announceMyTurn();
      } catch (e) { toast('Lancement impossible : ' + e.message, true); refresh(); }
    };
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Copie ce lien :', text); }
  }
  function leaveGame() {
    if (app.unsub) app.unsub();
    clearInterval(app.poll);
    app.unsub = null; app.gameId = null; app.committed = null; app.work = null; app.replay = null;
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
  // Applique une action au tour en cours (avec instantané pour Annuler) ; renvoie false en cas d'erreur de règle.
  function act(fn) {
    const snap = E.clone(app.work);
    try { fn(app.work); }
    catch (e) { app.work = snap; toast(e.message, true); return false; }
    app.undo.push(snap);
    saveDraft();
    return true;
  }
  function scoreOf(seat) { const s = view(); return E.scorePlayer(s.players[seat], s.opts.side).total; }
  const secTitle = (color, icon, text, extra) => '<h3 class="sec"><span class="pill ' + color + '">' + ic(icon) + text + '</span>' + (extra || '') + '</h3>';

  function renderGame(anim) {
    anim = anim || {};
    app.screen = 'game';
    ensureWork();
    const s = view();
    const mine = isMine();
    const me = mySeat();
    if (app.viewSeat >= s.players.length) app.viewSeat = 0;
    const cur = s.cur;
    const viewing = s.players[app.viewSeat];
    const viewingMine = mine && app.viewSeat === s.turn;
    const replaying = !!app.replay;
    const side = s.opts.side;
    document.title = (mine && s.status === 'playing' ? 'À toi · ' : '') + 'Harmonies · ' + (s.id || '');

    const scores = s.players.map(p => E.scorePlayer(p, side));

    // Message d'état
    let msg, msgIcon = 'hourglass', msgCls = '';
    if (s.status === 'finished') { msg = 'Partie terminée'; msgIcon = 'flag'; }
    else if (replaying) { msg = esc(E.current(s).name) + ' joue…'; msgIcon = 'film'; }
    else if (mine) {
      const st = E.turnStatus(s);
      msgIcon = 'hand'; msgCls = ' mine';
      if (app.cubeMode) { msg = 'Tape une case orange pour poser le cube'; msgIcon = 'cube'; }
      else if (cur.slot === null && !s.market.every(m => !m.length)) msg = 'À toi : prends un groupe de 3 jetons';
      else if (cur.tokens.length) msg = 'Pose tes jetons (' + cur.tokens.length + ' restant' + (cur.tokens.length > 1 ? 's' : '') + ')';
      else if (!st.ok) msg = st.reasons[0];
      else { msg = 'Une carte ou un cube à poser ? Sinon, termine ton tour'; msgIcon = 'check'; }
    } else msg = 'Tour de ' + esc(E.current(s).name) + (app.mode === 'online' ? '…' : '');

    const legal = new Set(), targets = new Set(), last = new Set();
    if (viewingMine && !app.cubeMode && app.selToken !== null && cur.tokens[app.selToken] !== undefined) {
      E.legalCells(viewing.board, cur.tokens[app.selToken]).forEach(i => legal.add(i));
    }
    if (viewingMine && app.cubeMode) app.cubeMode.targets.forEach(i => targets.add(i));
    if (viewingMine || (replaying && app.viewSeat === s.turn)) cur.actions.forEach(a => { if (a.a === 'place') last.add(a.cell); });
    else {
      const lastLog = (s.log || []).slice().reverse().find(l => l.p === app.viewSeat);
      if (lastLog) lastLog.actions.forEach(a => { if (a.a === 'place') last.add(a.cell); });
    }

    const placeable = mine ? E.placeableCubes(s) : [];
    const placeableIds = new Set(placeable.map(p => p.id));
    const canTake = mine && E.canTakeCard(s);

    let html = '<div class="screen game">' +
      '<div class="topbar">' + R.logoSVG('logo-small') + '<span class="code">' + esc(s.id || '') + '</span>' +
      (app.mode === 'online' ? '<span class="conn ' + (app.rtOk ? 'on' : 'off') + '" id="conn" title="temps réel"></span>' : '') +
      '<span class="spacer"></span><button class="icon-btn" id="sound" title="Sons">' + ic(Sfx.enabled ? 'sound' : 'mute') + '</button><button class="icon-btn" id="menu" title="Menu">' + ic('menu') + '</button></div>' +
      '<div class="status' + msgCls + '"><span class="msg">' + ic(msgIcon, 'inl') + '<span>' + msg + '</span></span><span class="score-chips">' +
      s.players.map((p, i) => '<span class="score-chip' + (i === app.viewSeat ? ' active' : '') + '" data-seat="' + i + '" style="--seat:' + SEAT_COLORS[i] + '">' + seatDot(i) + esc(p.name) + (i === s.turn && s.status === 'playing' ? ic('dice', 'inl') : '') + ' <b>' + scores[i].total + '</b></span>').join('') +
      '</span></div>';

    // Plateau central + sac
    html += '<div class="section">' + secTitle('blue', 'grid', 'Plateau central', (mine && cur.slot === null && s.status === 'playing' && !app.cubeMode ? '<span class="hint">choisis un groupe</span>' : '') +
      '<span class="spacer"></span><span class="pouch-wrap" title="Jetons restants dans le sac">' + R.pouchSVG(s.bag ? s.bag.length : 0) + '</span>') + '<div class="market">' +
      s.market.map((m, i) => {
        const takeable = mine && cur.slot === null && m.length > 0 && !app.cubeMode;
        const arriving = anim.refillSlot === i;
        return '<div class="slot' + (takeable ? ' takeable' : '') + (m.length ? '' : ' empty') + '" data-slot="' + i + '">' + (m.length ? R.slotSVG(m, arriving) : (cur && cur.slot === i ? '<span class="slot-empty">pris</span>' : '')) + '</div>';
      }).join('') + '</div></div>';

    // Plateaux
    html += '<div class="board-tabs">' + s.players.map((p, i) => '<button data-seat="' + i + '" class="' + (i === app.viewSeat ? 'on' : '') + '" style="--seat:' + SEAT_COLORS[i] + '">' + seatDot(i) + esc(p.name) + (i === me && app.mode === 'online' ? ' (toi)' : '') + '<em>' + E.emptyCount(p.board) + ' vides</em></button>').join('') + '</div>' +
      '<div class="board-wrap">' + R.boardSVG(viewing.board, { legal, targets, last, readonly: !viewingMine, newTop: anim.newTop, newCube: anim.newCube }) + '</div>';

    // Cartes disponibles + pioche
    html += '<div class="section">' + secTitle('orange', 'star', 'Animaux disponibles', (canTake ? '<span class="hint">tu peux en prendre une</span>' : (mine && cur.cardTaken ? '<span class="hint muted">carte prise ce tour</span>' : ''))) + '<div class="cards-strip">' +
      '<div class="deck-wrap" title="Pioche">' + R.deckSVG(s.deck.length) + '</div>' +
      s.display.map((id, i) => {
        if (!id) return '<div class="card empty" data-display="' + i + '"></div>';
        const card = E.CARD_BY_ID.get(id);
        const arriving = anim.newDisplay && anim.newDisplay.includes(i);
        return cardHTML(card, { cls: (canTake ? 'takeable' : '') + (arriving ? ' arriving' : ''), badge: canTake ? 'Prendre' : '', badgeCls: 'teal', attrs: 'data-display="' + i + '"' });
      }).join('') + '</div></div>';

    // Cartes du joueur affiché
    const p = viewing;
    const items = [];
    if (p.spiritChoices && viewingMine) items.push('<div class="card spirit choose" id="spirit-choose"><div class="art">' + R.hillsSVG(120, 70, ['#f2c94c', '#e8873a', '#d96a8e', '#6b4fa0'], { seed: 99, cls: 'scene' }) + '<div class="name">Esprit</div></div><div class="choose-body">' + ic('sparkles') + 'Choisis ton Esprit de la Nature</div><div class="foot">2 cartes à découvrir</div></div>');
    if (p.spirit) {
      const card = E.CARD_BY_ID.get(p.spirit.id);
      const pl = placeableIds.has(card.id) && viewingMine;
      items.push(cardHTML(card, { cls: (pl ? 'placeable' : '') + (p.spirit.placed ? ' done' : ''), badge: pl ? 'Poser' : (p.spirit.placed ? ic('check') + 'posé' : ''), badgeCls: p.spirit.placed ? 'teal' : '', attrs: 'data-mine="1"' }));
    }
    for (const h of p.hand) {
      const card = E.CARD_BY_ID.get(h.id);
      const pl = placeableIds.has(h.id) && viewingMine;
      items.push(cardHTML(card, { left: h.left, cls: (pl ? 'placeable' : '') + (anim.arrivingCard === h.id ? ' arriving' : ''), badge: pl ? 'Poser' : '', attrs: 'data-mine="1"' }));
    }
    for (const d of p.done) items.push(cardHTML(E.CARD_BY_ID.get(d.id), { left: 0, cls: 'done', done: true, badge: ic('check'), badgeCls: 'teal', attrs: 'data-mine="1"' }));
    const active = E.activeCount(p);
    html += '<div class="section">' + secTitle('teal', 'layers', 'Cartes de ' + esc(p.name), '<span class="hint muted">' + active + '/4 en cours' + (p.done.length ? ' · ' + p.done.length + ' terminée' + (p.done.length > 1 ? 's' : '') : '') + '</span>') + '<div class="cards-strip">' +
      (items.length ? items.join('') : '<div class="card empty"><div class="empty-text">aucune carte</div></div>') + '</div></div>';

    // Journal
    const log = (s.log || []).slice(-8).reverse();
    html += '<div class="section">' + secTitle('purple', 'scroll', 'Journal') + '</div><ul class="log">' + (log.length ? log.map(l =>
      '<li><span class="turnno">T' + l.n + '</span>' + seatDot(l.p) + '<b>' + esc(s.players[l.p].name) + '</b><span class="acts">' + (actionsHTML(l.actions) || '—') + '</span></li>').join('') : '<li>Début de partie.</li>') + '</ul>';

    // Barre du bas
    html += '<div class="handbar">';
    if (s.status === 'finished') {
      html += '<div class="tokens"><span class="placeholder">Partie terminée</span></div><div class="actions"><button class="btn primary" id="results">' + ic('trophy') + 'Résultats</button></div>';
    } else if (replaying) {
      html += '<div class="tokens">' + (cur.tokens.length ? cur.tokens.map((t, i) => '<span class="tok' + (anim.arrivingHand ? ' arriving' : '') + '" data-tok="' + i + '">' + R.tokenSVG(t) + '</span>').join('') : '<span class="placeholder">' + esc(E.current(s).name) + ' joue…</span>') + '</div>';
    } else if (!mine) {
      html += '<div class="tokens"><span class="placeholder">' + (app.mode === 'online' ? 'En attente de ' + esc(E.current(s).name) + '…' : 'Tour de ' + esc(E.current(s).name)) + '</span></div><div class="actions">' +
        (app.mode === 'online' ? '<button class="btn secondary icon" id="reload" title="Actualiser">' + ic('refresh') + '</button>' : '') + '</div>';
    } else {
      const st = E.turnStatus(s);
      html += '<div class="tokens">' + (cur.slot === null && cur.tokens.length === 0 ?
        '<span class="placeholder">' + (s.market.every(m => !m.length) ? 'Plus de jetons à prendre' : 'Prends 3 jetons en haut') + '</span>' :
        cur.tokens.map((t, i) => {
          const dead = !E.legalCells(E.current(s).board, t).length;
          return '<button class="tok' + (i === app.selToken ? ' sel' : '') + (dead ? ' dead' : '') + (anim.arrivingHand ? ' arriving' : '') + '" data-tok="' + i + '" title="' + E.COLOR_NAMES[t] + '">' + R.tokenSVG(t) + '</button>';
        }).join('') + (cur.tokens.length === 0 ? '<span class="placeholder">' + ic('check', 'inl') + 'Jetons posés</span>' : '')) + '</div>' +
        '<div class="actions"><button class="btn secondary" id="undo" ' + (app.undo.length ? '' : 'disabled') + '>' + ic('undo') + '<span class="lbl">Annuler</span></button>' +
        '<button class="btn primary' + (st.ok ? ' ready' : '') + '" id="end" ' + (st.ok ? '' : 'disabled') + '>Fin du tour</button></div>';
    }
    html += '</div></div>';
    $('#app').innerHTML = html;
    bindGame(s, mine, viewingMine, placeable);

    if (replaying) { /* bannière gérée par le rejeu */ }
    else if (mine && app.cubeMode) showBanner('Pose le cube ' + miniAnimal(app.cubeMode.id) + ' ' + esc(E.CARD_BY_ID.get(app.cubeMode.id).fr) + ' : tape une case orange', () => { app.cubeMode = null; renderGame(); }, 'Annuler');
    else if (mine && app.selToken !== null && cur.tokens[app.selToken] !== undefined && !E.legalCells(E.current(s).board, cur.tokens[app.selToken]).length) {
      showBanner('Aucune case possible pour ce jeton', () => { const sel = app.selToken; if (act(w => E.discardToken(w, sel))) Sfx.undo(); app.selToken = app.work.cur.tokens.length ? 0 : null; renderGame(); }, 'Défausser');
    } else hideBanner();

    if (mine && E.current(s).spiritChoices && !app.spiritPrompted && !app.cubeMode) { app.spiritPrompted = true; showSpiritChoice(); }
    if (s.status === 'finished' && !app.endShown && !replaying) { app.endShown = true; showResults(); }
  }

  function bindGame(s, mine, viewingMine, placeable) {
    $('#menu').onclick = showMenu;
    $('#sound').onclick = () => { const on = Sfx.toggle(); $('#sound').innerHTML = ic(on ? 'sound' : 'mute'); toast(on ? 'Sons activés' : 'Sons coupés'); };
    $$('.score-chip').forEach(chip => { chip.onclick = () => { const seat = +chip.dataset.seat; if (app.viewSeat === seat) showScores(); else { app.viewSeat = seat; renderGame(); } }; });
    $$('.board-tabs button').forEach(b => { b.onclick = () => { app.viewSeat = +b.dataset.seat; renderGame(); }; });
    const reload = $('#reload'); if (reload) reload.onclick = () => { refresh(); toast('Mise à jour…'); };
    const results = $('#results'); if (results) results.onclick = showResults;
    // cartes disponibles : détail toujours consultable
    $$('.card[data-display]').forEach(c => {
      if (!c.dataset.card) return;
      c.onclick = ev => {
        const card = E.CARD_BY_ID.get(+c.dataset.card);
        const canTake = mine && !app.busy && E.canTakeCard(app.work);
        if (ev.target.closest('.badge') && canTake) { interactiveCard(+c.dataset.display); return; }
        cardDetail(card, canTake ? '<button class="btn primary block" id="m-take">Prendre cette carte</button>' : (mine ? '<p class="note">' + (app.work.cur.cardTaken ? 'Tu as déjà pris une carte ce tour.' : 'Tu as déjà 4 cartes en cours.') + '</p>' : ''));
        const b = $('#m-take'); if (b) b.onclick = () => { closeModal(); interactiveCard(+c.dataset.display); };
      };
    });
    $$('.card[data-mine]').forEach(c => {
      c.onclick = ev => {
        const id = +c.dataset.card;
        const card = E.CARD_BY_ID.get(id);
        const pc = mine && !app.busy ? placeable.find(x => x.id === id) : null;
        if (pc && viewingMine && ev.target.closest('.badge')) { startCube(pc); return; }
        cardDetail(card, pc && viewingMine ? '<button class="btn warn block" id="m-cube">' + ic('cube') + 'Poser un cube</button>' : '');
        const b = $('#m-cube'); if (b) b.onclick = () => { closeModal(); startCube(pc); };
      };
    });
    if (!mine) return;
    // Marché
    $$('.slot.takeable').forEach(sl => {
      sl.onclick = () => { if (app.busy) return; Sfx.unlock(); interactiveTake(+sl.dataset.slot); };
    });
    // Jetons en main
    $$('.tok').forEach(b => { b.onclick = () => { if (app.busy) return; app.selToken = +b.dataset.tok; app.cubeMode = null; renderGame(); }; });
    // Plateau
    const board = $('.board');
    if (board && viewingMine) {
      board.addEventListener('click', ev => {
        if (app.busy) return;
        const hex = ev.target.closest('.hex'); if (!hex) return;
        const idx = +hex.dataset.idx;
        const w = app.work;
        if (app.cubeMode) {
          if (!app.cubeMode.targets.has(idx)) { toast('Cette case ne convient pas à cet habitat', true); return; }
          interactiveCube(app.cubeMode.id, idx);
          return;
        }
        if (app.selToken === null || w.cur.tokens[app.selToken] === undefined) {
          if (w.cur.slot === null) toast('Prends d\'abord 3 jetons sur le plateau central', true);
          return;
        }
        const color = w.cur.tokens[app.selToken];
        if (!E.canPlace(w.players[w.turn].board[idx], color)) { toast('Pose impossible ici (' + E.COLOR_NAMES[color] + ')', true); return; }
        interactivePlace(app.selToken, idx);
      });
    }
    const spiritBtn = $('#spirit-choose'); if (spiritBtn) spiritBtn.onclick = showSpiritChoice;
    function startCube(pc) {
      if (pc.targets.length === 1) { interactiveCube(pc.id, pc.targets[0]); return; }
      app.cubeMode = { id: pc.id, targets: new Set(pc.targets) };
      renderGame(); scrollToBoard();
    }
    // Annuler / Fin du tour
    const undo = $('#undo'); if (undo) undo.onclick = () => {
      if (!app.undo.length || app.busy) return;
      app.work = app.undo.pop();
      app.selToken = app.work.cur.tokens.length ? 0 : null; app.cubeMode = null;
      saveDraft(); Sfx.undo(); renderGame();
    };
    const end = $('#end'); if (end) end.onclick = endTurn;
  }
  function scrollToBoard() { const b = $('.board-wrap'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

  // ---------- Actions animées (partagées entre le joueur actif et le rejeu) ----------
  async function animatedTake(state, slot) {
    const from = $$('.slot[data-slot="' + slot + '"] .disc').map(rectOf);
    const colors = state.market[slot].slice();
    E.takeTokens(state, slot);
    if (state === app.work) app.selToken = 0;
    renderGame({ arrivingHand: true });
    Sfx.take();
    const toks = $$('.handbar .tok');
    await Promise.all(toks.map((t, i) => fly(from[i] || from[0], rectOf(t), R.tokenSVG(colors[i]), { duration: 420 + i * 60, arc: -30 }).then(() => reveal(t, 'pop'))));
  }
  async function animatedPlace(state, handIdx, cellIdx) {
    const from = rectOf($('.handbar .tok[data-tok="' + handIdx + '"]'));
    const color = state.cur.tokens[handIdx];
    E.placeToken(state, handIdx, cellIdx);
    if (state === app.work) app.selToken = state.cur.tokens.length ? Math.min(handIdx, state.cur.tokens.length - 1) : null;
    renderGame({ newTop: cellIdx });
    const target = $('.board .stack[data-cell="' + cellIdx + '"] .disc.arriving');
    await fly(from, rectOf(target), R.tokenSVG(color), { duration: 380, arc: -50 });
    reveal(target, 'drop');
    Sfx.place(); vibrate(10);
  }
  async function animatedCard(state, displayIdx) {
    const id = state.display[displayIdx];
    const card = E.CARD_BY_ID.get(id);
    const from = rectOf($('.card[data-display="' + displayIdx + '"]'));
    E.takeCard(state, displayIdx);
    renderGame({ arrivingCard: id });
    Sfx.card();
    const target = $('.card.arriving[data-card="' + id + '"]');
    await fly(from, rectOf(target), '<div class="ghost-card" style="border-color:' + R.cubeColorOf(card) + '">' + R.animalSVG(card.id) + '</div>', { duration: 520, arc: -30 });
    reveal(target, 'pop');
  }
  async function animatedCube(state, cardId, cellIdx) {
    const steps = $$('.card[data-mine][data-card="' + cardId + '"] .track .step.cube');
    const from = rectOf(steps.length ? steps[steps.length - 1] : $('.card[data-mine][data-card="' + cardId + '"]'));
    const spirit = E.CARD_BY_ID.get(cardId).spirit;
    E.placeCube(state, cardId, cellIdx);
    renderGame({ newCube: cellIdx });
    const target = $('.board .stack[data-cell="' + cellIdx + '"] .cube.arriving');
    await fly(from, rectOf(target), '<div class="ghost-cube' + (spirit ? ' spirit' : '') + '"></div>', { duration: 480, arc: -60 });
    reveal(target, 'bounce');
    Sfx.cube(); vibrate(20);
  }
  async function animateRefill(slot, displayIdxs) {
    const jobs = [];
    if (slot !== undefined && slot !== null) {
      const pouch = rectOf($('.pouch-wrap'));
      const discs = $$('.slot[data-slot="' + slot + '"] .disc.arriving');
      const colors = view().market[slot] || [];
      discs.forEach((d, i) => jobs.push(wait(i * 90).then(() => fly(pouch, rectOf(d), R.tokenSVG(colors[i]), { duration: 520, arc: -40 })).then(() => reveal(d, 'drop'))));
      if (discs.length) Sfx.draw();
    }
    if (displayIdxs && displayIdxs.length) {
      const deck = rectOf($('.deck-wrap'));
      displayIdxs.forEach((i, k) => {
        const target = $('.card.arriving[data-display="' + i + '"]');
        if (!target) return;
        jobs.push(wait(200 + k * 120).then(() => { Sfx.card(); return fly(deck, rectOf(target), '<div class="ghost-card back"></div>', { duration: 560, arc: -20 }); }).then(() => reveal(target, 'flip')));
      });
    }
    await Promise.all(jobs);
  }

  // Versions interactives (tour du joueur actif) : instantané pour Annuler + brouillon + score flottant
  async function withAnim(fn) {
    if (app.busy || !app.work) return;
    app.busy = true;
    const snap = E.clone(app.work);
    const seat = app.work.turn;
    const before = scoreOf(seat);
    try {
      await fn();
      app.undo.push(snap);
      saveDraft();
      const after = scoreOf(seat);
      if (after !== before) floatText($('.score-chip[data-seat="' + seat + '"]'), (after > before ? '+' : '') + (after - before), after > before ? 'up' : 'down');
    } catch (e) {
      app.work = snap; toast(e.message, true);
    } finally {
      app.busy = false;
      renderGame();
    }
  }
  function interactiveTake(slot) { withAnim(() => animatedTake(app.work, slot)).then(() => scrollToBoard()); }
  function interactivePlace(handIdx, cellIdx) {
    withAnim(() => animatedPlace(app.work, handIdx, cellIdx)).then(() => {
      if (!app.work) return;
      const now = E.placeableCubes(app.work);
      if (now.length && app.work.cur.tokens.length === 0) toast('Habitat réalisé : ' + now.map(x => miniAnimal(x.id) + ' ' + esc(E.CARD_BY_ID.get(x.id).fr)).join(', ') + ' → « Poser »');
    });
  }
  function interactiveCard(displayIdx) { withAnim(() => animatedCard(app.work, displayIdx)); }
  function interactiveCube(cardId, cellIdx) { app.cubeMode = null; withAnim(() => animatedCube(app.work, cardId, cellIdx)); }

  async function endTurn() {
    if (app.busy || !app.work) return;
    const w = E.clone(app.work);
    const slot = w.cur.slot;
    const prevDisplay = w.display.slice();
    try { E.endTurn(w); } catch (e) { toast(e.message, true); return; }
    const btn = $('#end'); if (btn) { btn.disabled = true; btn.textContent = 'Envoi…'; }
    app.busy = true;
    try {
      const r = await app.net.saveGame(app.gameId, w, app.version);
      app.committed = w; app.version = r.version; app.work = null; app.undo = []; app.selToken = null; app.cubeMode = null; app.spiritPrompted = false;
      app.lastLogLen = w.log.length;
      ls.del('harmonies.draft.' + app.gameId);
      app.busy = false;
      const newDisplay = [];
      w.display.forEach((id, i) => { if (id && prevDisplay[i] !== id) newDisplay.push(i); });
      if (w.status === 'finished') { render(); return; }
      if (app.mode === 'local') app.viewSeat = w.turn;
      renderGame({ refillSlot: slot, newDisplay });
      await animateRefill(slot, newDisplay);
      if (app.mode === 'local') {
        modal('<h2>' + ic('phone', 'h') + 'Au tour de ' + esc(E.current(w).name) + '</h2><p>Passe le téléphone à ' + esc(E.current(w).name) + '.</p><div class="actions"><button class="btn primary" id="m-ok">C\'est parti</button></div>', { sticky: true });
        $('#m-ok').onclick = () => { closeModal(); render(); announceMyTurn(); };
      } else render();
    } catch (e) {
      app.busy = false;
      if (e.code === 'conflict') { toast('La partie a changé entre-temps, rechargement…', true); app.work = null; await refresh(); render(); }
      else { toast('Envoi impossible : ' + e.message + ' — réessaie', true); renderGame(); }
    }
  }

  // ---------- Modales de jeu ----------
  function showSpiritChoice() {
    if (!app.work) return;
    const p = E.current(app.work);
    if (!p.spiritChoices) return;
    modal('<h2>' + ic('sparkles', 'h') + 'Choisis ton Esprit de la Nature</h2><p class="note">Une seule carte est gardée, l\'autre retourne dans la boîte. Elle compte dans ta limite de 4 cartes tant que son cube n\'est pas posé.</p>' +
      '<div class="choice-grid">' + p.spiritChoices.map(id => cardHTML(E.CARD_BY_ID.get(id), { attrs: 'data-choose="' + id + '"' })).join('') + '</div>' +
      '<div class="actions"><button class="btn secondary" id="m-later">Plus tard</button></div>');
    $('#m-later').onclick = closeModal;
    $$('[data-choose]').forEach(c => { c.onclick = () => { const id = +c.dataset.choose; closeModal(); if (act(w => E.chooseSpirit(w, id))) { Sfx.card(); toast('Esprit choisi : ' + esc(E.CARD_BY_ID.get(id).fr)); } renderGame(); }; });
  }
  function scoreTable(s) {
    const rows = [['trees', miniTok(4) + 'Arbres'], ['mountains', miniTok(2) + 'Montagnes'], ['fields', miniTok(5) + 'Champs'], ['buildings', miniTok(6) + 'Bâtiments'], ['water', miniTok(1) + (s.opts.side === 'B' ? 'Îles' : 'Rivière')], ['animals', '<span class="mcube"></span>Animaux'], ['spirit', ic('sparkles', 'inl') + 'Esprit']];
    const scores = s.players.map(p => E.scorePlayer(p, s.opts.side));
    return '<table class="scores"><tr><th></th>' + s.players.map((p, i) => '<th style="color:' + SEAT_COLORS[i] + '">' + esc(p.name) + '</th>').join('') + '</tr>' +
      rows.filter(([k]) => k !== 'spirit' || s.opts.spirits).map(([k, label]) => '<tr><td>' + label + '</td>' + scores.map(sc => '<td>' + sc[k] + '</td>').join('') + '</tr>').join('') +
      '<tr class="total"><td>Total</td>' + scores.map(sc => '<td>' + sc.total + '</td>').join('') + '</tr>' +
      '<tr><td class="note">cubes posés</td>' + s.players.map(p => '<td class="note">' + p.cubes + '</td>').join('') + '</tr></table>';
  }
  function showScores() {
    const s = view();
    modal('<h2>' + ic('chart', 'h') + 'Score en direct</h2>' + scoreTable(s) + '<p class="note">Estimation calculée sur l\'état actuel des plateaux (' + esc(SIDE_LABEL[s.opts.side]) + ').</p><div class="actions"><button class="btn secondary" id="m-close">Fermer</button></div>');
    $('#m-close').onclick = closeModal;
  }
  function showResults() {
    const s = app.committed;
    if (!s.result) return;
    const winners = s.result.winners.map(i => s.players[i].name);
    const iWon = app.mode === 'local' || s.result.winners.includes(mySeat());
    const reason = s.endReason === 'bag' ? 'le sac était vide' : 'un plateau n\'avait plus que 2 cases vides ou moins';
    modal('<h2>' + ic('flag', 'h') + 'Fin de partie</h2><div class="winner">' + ic('trophy', 'big') + (winners.length > 1 ? 'Égalité : ' + esc(winners.join(' & ')) : esc(winners[0]) + ' gagne !') + '</div>' +
      scoreTable(s) + '<p class="note">Fin déclenchée car ' + reason + '. En cas d\'égalité, le plus grand nombre de cubes posés l\'emporte.</p>' +
      '<div class="actions"><button class="btn secondary" id="m-close">Voir les plateaux</button><button class="btn primary" id="m-again">' + ic('refresh') + 'Revanche</button></div>');
    $('#m-close').onclick = closeModal;
    $('#m-again').onclick = rematch;
    if (iWon) { confetti(); Sfx.win(); } else Sfx.lose();
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
    modal('<h2>' + ic('menu', 'h') + 'Menu</h2><ul class="menu">' +
      (app.mode === 'online' ? '<li id="mn-share">' + ic('share') + 'Partager le lien de la partie</li>' : '') +
      '<li id="mn-scores">' + ic('chart') + 'Score détaillé</li><li id="mn-rules">' + ic('book') + 'Règles et légende</li>' +
      (app.mode === 'online' && s.status === 'playing' && mySeat() < 0 ? '<li id="mn-claim">' + ic('users') + 'Je suis un des joueurs (reprendre ma place)</li>' : '') +
      (app.mode === 'online' ? '<li id="mn-reload">' + ic('refresh') + 'Recharger la partie</li>' : '') +
      '<li id="mn-home">' + ic('home') + 'Retour à l\'accueil</li></ul>' +
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
      modal('<h2>' + ic('users', 'h') + 'Qui es-tu ?</h2><p class="note">Cet appareil n\'est associé à aucun joueur de la partie (nouveau téléphone, données effacées…).</p><ul class="menu">' +
        s.players.map((p, i) => '<li data-seat="' + i + '">' + seatDot(i) + esc(p.name) + '</li>').join('') + '</ul><div class="actions"><button class="btn secondary" id="m-close">Annuler</button></div>');
      $('#m-close').onclick = closeModal;
      $$('.menu li[data-seat]').forEach(li => { li.onclick = async () => {
        const st = E.clone(app.committed); st.players[+li.dataset.seat].pid = myPid();
        try { const r = await app.net.saveGame(app.gameId, st, app.version); app.committed = st; app.version = r.version; app.work = null; closeModal(); render(); toast('Bienvenue, ' + esc(st.players[+li.dataset.seat].name)); }
        catch (e) { toast('Échec : ' + e.message, true); refresh(); }
      }; });
    });
  }
  function showRules() {
    const tok = c => R.tokenSVG(c);
    modal('<h2>' + ic('book', 'h') + 'Règles essentielles</h2><div class="rules">' +
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
      '<p><b>Points des cartes</b> — la colonne de droite d\'une carte se découvre de bas en haut à chaque cube posé ; la carte vaut le dernier palier découvert (0 si aucun cube posé).</p>' +
      '<p><b>Fin</b> — quand le sac est vide au moment de recharger, ou quand un joueur a 2 cases vides ou moins : on termine la manche. Égalité : le plus de cubes posés.</p>' +
      '</div><div class="actions"><button class="btn secondary" id="m-close">Fermer</button></div>');
    $('#m-close').onclick = closeModal;
  }

  // ---------- Démarrage ----------
  function boot() {
    document.body.insertAdjacentHTML('afterbegin', R.defsSVG() + (root.ANIMAL_SPRITE || ''));
    const params = new URLSearchParams(location.search);
    const code = (params.get('g') || '').toUpperCase();
    if (params.get('pid')) { try { sessionStorage.setItem('harmonies.pid', params.get('pid')); } catch (e) { /* ignore */ } }
    if (params.get('name')) ls.set('harmonies.name', params.get('name'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && app.mode === 'online' && app.gameId) refresh(); });
    document.addEventListener('pointerdown', () => { interacted = true; Sfx.unlock(); }, { once: true, passive: true });
    if (code && ONLINE_OK) {
      renderHome();
      openOnline(code).then(async () => {
        if (app.committed && app.committed.status === 'lobby' && !app.committed.players.some(p => p.pid === myPid()) && myName()) {
          try { await joinLobby(myName()); render(); } catch (e) { toast('Impossible de rejoindre : ' + e.message, true); }
        }
      });
    } else renderHome();
  }
  root.HarmoniesApp = { boot, app, render, act, endTurn, refresh, Sfx };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof self !== 'undefined' ? self : this);
