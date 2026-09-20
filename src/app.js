// Application Harmonies : écrans, interactions, animations, sons, chat, synchronisation. Interface en anglais.
(function (root) {
  'use strict';
  const E = root.Engine, R = root.Render, esc = R.esc, I = root.Icons, Bot = root.Bot;
  const ic = (name, cls) => I.svg(name, cls);
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const CFG = root.HARMONIES_CONFIG || {};
  const ONLINE_OK = !!(CFG.url && CFG.key && !CFG.url.startsWith('__') && root.supabase);
  const SEAT_COLORS = ['#2a8f8a', '#e8873a', '#6b4fa0', '#d96a8e'];
  const SIDE_LABEL = { A: 'Side A · river', B: 'Side B · islands' };
  const BOT_LABEL = { 1: 'Novice bot', 2: 'Skilled bot', 3: 'Expert bot' };
  const BOT_OPTIONS = [[0, 'Human'], [1, 'Novice bot'], [2, 'Skilled bot'], [3, 'Expert bot']];
  const QUICK_CHAT = ['👋 Hi!', 'GG!', 'Nice move!', 'Your turn 😉', 'One sec…', 'Well played!'];
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = !!(navigator.standalone || (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches));
  const botName = (players, level) => { const used = new Set(players.map(p => p.name)); void level; return Bot.NAMES.find(n => !used.has('Bot ' + n) && !used.has(n)) || 'Bot'; };
  const BANNER = ['#f2c94c', '#e8873a', '#5cc2b7', '#2a8f8a', '#2c4a8a', '#1e2a5a'];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const plural = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');

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
  const pidOverride = () => { try { return !!sessionStorage.getItem('harmonies.pid'); } catch (e) { return false; } };
  // Profil (pid + secret + code d'ami) : en sessionStorage quand l'identité est forcée par ?pid= (tests à plusieurs onglets)
  const acctStore = {
    get() {
      try { if (pidOverride()) { const v = sessionStorage.getItem('harmonies.account'); return v ? JSON.parse(v) : null; } } catch (e) { /* ignore */ }
      const a = ls.get('harmonies.account', null);
      return a && a.pid === myPid() && a.secret ? a : null;
    },
    set(v) {
      try { if (pidOverride()) { if (v) sessionStorage.setItem('harmonies.account', JSON.stringify(v)); else sessionStorage.removeItem('harmonies.account'); return; } } catch (e) { /* ignore */ }
      if (v) ls.set('harmonies.account', v); else ls.del('harmonies.account');
    },
  };
  const myName = () => ls.get('harmonies.name', '');
  // Avatar du profil : id d'une carte Animal (tiré au sort la première fois)
  const myAvatar = () => {
    let a = ls.get('harmonies.avatar', 0);
    if (!a || !E.CARD_BY_ID.has(a)) { a = E.CARDS[Math.floor(Math.random() * E.CARDS.length)].id; ls.set('harmonies.avatar', a); }
    return a;
  };
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
    // ---- musique d'ambiance : nappe douce (accordage 432 Hz), clochettes pentatoniques, souffle ----
    let music = ls.get('harmonies.music', true);
    let musicNodes = null, musicTimer = null;
    const N = n => 432 * Math.pow(2, n / 12); // demi-tons au-dessus du la 432
    const CHORDS = [[-24, -17, -12, -8], [-29, -20, -13, -8], [-19, -12, -5, 0], [-26, -17, -10, -5]];
    const BELLS = [0, 4, 7, 9, 12, 16, 19];
    function startMusic() {
      const c = ensure(); if (!c || musicNodes) return;
      const master = c.createGain(); master.gain.setValueAtTime(0.0001, c.currentTime); master.gain.exponentialRampToValueAtTime(0.9, c.currentTime + 4);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.4;
      const delay = c.createDelay(2); delay.delayTime.value = 0.42;
      const fb = c.createGain(); fb.gain.value = 0.32;
      const wet = c.createGain(); wet.gain.value = 0.35;
      lp.connect(master); lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
      master.connect(c.destination);
      // souffle
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.05; }
      const wind = c.createBufferSource(); wind.buffer = buf; wind.loop = true;
      const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 400;
      const wg = c.createGain(); wg.gain.value = 0.25;
      const wl = c.createOscillator(); wl.frequency.value = 0.07; const wlg = c.createGain(); wlg.gain.value = 0.12; wl.connect(wlg).connect(wg.gain);
      wind.connect(wf).connect(wg).connect(master); wind.start(); wl.start();
      musicNodes = { master, lp, wind, wl, chord: 0, voices: [] };
      const playChord = () => {
        if (!musicNodes) return;
        const t0 = c.currentTime;
        const notes = CHORDS[musicNodes.chord % CHORDS.length]; musicNodes.chord++;
        const old = musicNodes.voices; musicNodes.voices = [];
        old.forEach(v => { v.g.gain.cancelScheduledValues(t0); v.g.gain.setValueAtTime(v.g.gain.value, t0); v.g.gain.exponentialRampToValueAtTime(0.0001, t0 + 5); v.o.stop(t0 + 5.2); v.o2.stop(t0 + 5.2); });
        notes.forEach((n, i) => {
          const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
          o.type = i === 0 ? 'triangle' : 'sine'; o2.type = 'sine';
          o.frequency.value = N(n); o2.frequency.value = N(n) * 1.003;
          g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(i === 0 ? 0.05 : 0.035, t0 + 4);
          o.connect(g); o2.connect(g); g.connect(lp); o.start(t0); o2.start(t0);
          musicNodes.voices.push({ o, o2, g });
        });
        // clochettes
        for (let k = 0; k < 3; k++) {
          const at = t0 + 2 + Math.random() * 9;
          const bo = c.createOscillator(), bg = c.createGain(), pan = c.createStereoPanner ? c.createStereoPanner() : null;
          bo.type = 'sine'; bo.frequency.value = N(BELLS[Math.floor(Math.random() * BELLS.length)] + 12);
          bg.gain.setValueAtTime(0.0001, at); bg.gain.exponentialRampToValueAtTime(0.03, at + 0.03); bg.gain.exponentialRampToValueAtTime(0.0001, at + 3);
          if (pan) { pan.pan.value = Math.random() * 1.4 - 0.7; bo.connect(bg).connect(pan).connect(lp); } else bo.connect(bg).connect(lp);
          bo.start(at); bo.stop(at + 3.2);
        }
      };
      playChord();
      musicTimer = setInterval(playChord, 14000);
    }
    function stopMusic() {
      if (!musicNodes) return;
      const c = ctx, t0 = c.currentTime;
      clearInterval(musicTimer); musicTimer = null;
      const m = musicNodes; musicNodes = null;
      m.master.gain.cancelScheduledValues(t0); m.master.gain.setValueAtTime(m.master.gain.value, t0); m.master.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      setTimeout(() => { try { m.voices.forEach(v => { v.o.stop(); v.o2.stop(); }); m.wind.stop(); m.wl.stop(); m.master.disconnect(); } catch (e) { /* déjà arrêté */ } }, 1700);
    }
    document.addEventListener('visibilitychange', () => { if (!ctx || !musicNodes) return; const t0 = ctx.currentTime; musicNodes.master.gain.cancelScheduledValues(t0); musicNodes.master.gain.setValueAtTime(musicNodes.master.gain.value, t0); musicNodes.master.gain.exponentialRampToValueAtTime(document.visibilityState === 'visible' ? 0.9 : 0.0001, t0 + 0.8); });
    return {
      get enabled() { return enabled; },
      toggle() { enabled = !enabled; ls.set('harmonies.sound', enabled); if (enabled) { ensure(); this.take(); } return enabled; },
      unlock() { ensure(); if (music && !musicNodes) startMusic(); },
      get music() { return music; },
      get debug() { return { ctx: ctx ? ctx.state : null, music: !!musicNodes, voices: musicNodes ? musicNodes.voices.length : 0 }; },
      toggleMusic() { music = !music; ls.set('harmonies.music', music); if (music) { ensure(); startMusic(); } else stopMusic(); return music; },
      take() { noise(0.16, 1400, 0.12, 0, 0.6); tone(520, 0.12, 'sine', 0.05, 0, 760); },
      place() { noise(0.045, 2200, 0.28, 0, 1.2); tone(190, 0.11, 'triangle', 0.22, 0, 120); },
      card() { noise(0.09, 3200, 0.16, 0, 1); noise(0.06, 5000, 0.08, 0.05, 1); },
      cube() { tone(1046, 0.06, 'square', 0.05); tone(1568, 0.14, 'sine', 0.12, 0.06); noise(0.03, 3000, 0.15); },
      turn() { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'sine', 0.16, i * 0.11)); },
      undo() { tone(420, 0.09, 'triangle', 0.12); tone(300, 0.12, 'triangle', 0.12, 0.07); },
      error() { tone(140, 0.16, 'sawtooth', 0.06, 0, 110); },
      draw() { noise(0.12, 900, 0.1, 0, 0.5); },
      chat() { tone(880, 0.08, 'sine', 0.08); tone(1175, 0.16, 'sine', 0.1, 0.08); },
      win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, 'triangle', 0.16, i * 0.13)); },
      lose() { [392, 349, 311].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, i * 0.18)); },
    };
  })();

  // ---------- Animations (vols d'éléments par-dessus la page) ----------
  const rectOf = el => (el ? el.getBoundingClientRect() : null);
  const canAnimate = () => typeof Element !== 'undefined' && !!Element.prototype.animate;
  const flights = new Set(); // animations en vol (terminées d'un coup par flushFlights, bouton Skip)
  function flushFlights() { flights.forEach(a => { try { a.finish(); } catch (e) { /* déjà finie */ } }); }
  // attente interrompue dès que le rejeu est abandonné (Skip)
  const pause = (ms, token) => (token && token.abort ? Promise.resolve() : wait(ms));
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
      flights.add(a);
      const finish = () => { if (done) return; done = true; flights.delete(a); el.remove(); resolve(); };
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
    replay: null, busy: false, stage: 'play', stageManual: false, cardsOpen: ls.get('harmonies.cardsOpen', true), headerOpen: false, botRunning: false, botTimer: null,
    modalClose: null, fast: false, bannerEl: null,
  };
  // Chat de la partie (en ligne) : messages reçus, dernier id connu, non lus
  const chat = { msgs: [], lastId: 0, unread: 0, unsub: null, open: false };
  // Profil du joueur (créé automatiquement dès qu'il a un prénom) : pid, secret, code d'ami
  const acct = { me: null, registering: null };
  // Tableau de bord : parties du joueur (résumés serveur), amis, joueurs connectés à l'application, événements
  const hub = { games: [], friends: [], online: new Set(), myTurn: 0, loaded: false, loading: false, again: false, error: null, unsub: null, unsubGames: null, unsubOnline: null, watched: '', timer: null, skew: 0 };
  app.online = new Set(); // pids des joueurs actuellement connectés à la partie (présence temps réel)
  const view = () => (app.replay ? app.replay.state : (app.work || app.committed));
  const isMine = () => {
    const s = app.committed;
    if (!s || s.status !== 'playing' || app.replay) return false;
    if (E.current(s).bot) return false;
    if (app.mode === 'local') return true;
    return E.current(s).pid === myPid();
  };
  const mySeat = () => {
    const s = app.committed;
    if (!s) return -1;
    if (app.mode === 'local') return s.players[s.turn].bot ? s.players.findIndex(p => !p.bot) : s.turn;
    return s.players.findIndex(p => p.pid === myPid());
  };
  const seatOfPid = pid => { const s = app.committed; return s && s.players ? s.players.findIndex(p => p.pid === pid) : -1; };

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
    bg.innerHTML = '<div class="modal' + (opts && opts.cls ? ' ' + opts.cls : '') + '">' + html + '</div>';
    bg.addEventListener('click', ev => { if (ev.target === bg && !(opts && opts.sticky)) closeModal(); });
    document.body.appendChild(bg);
    app.modalClose = opts && opts.onClose ? opts.onClose : null;
    return bg;
  }
  function closeModal() {
    const m = $('#modal'); if (m) m.remove();
    const fn = app.modalClose; app.modalClose = null;
    if (fn) fn();
  }
  let interacted = false;
  function vibrate(ms) { if (interacted && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
  function showBanner(html, onClick, label) {
    app.banner = { html, onClick, label };
    mountBanner();
  }
  // Le nœud de la bannière est conservé d'un rendu à l'autre : un toucher commencé avant un re-rendu aboutit quand même,
  // et l'action part dès le pointerdown (les rendus pendant les animations des bots avalaient les clics).
  function mountBanner() {
    if (!app.banner) { if (app.bannerEl && app.bannerEl.parentNode) app.bannerEl.remove(); return; }
    const host = $('.stage') || document.body;
    let b = app.bannerEl;
    if (!b) {
      b = document.createElement('div'); b.id = 'banner';
      app.bannerEl = b;
    }
    b.className = 'banner' + (host !== document.body ? ' in-stage' : '');
    const key = app.banner.html + '|' + (app.banner.onClick ? app.banner.label : '');
    if (b.dataset.key !== key) {
      b.dataset.key = key;
      b.innerHTML = '<span>' + app.banner.html + '</span>' + (app.banner.onClick ? '<button type="button">' + app.banner.label + '</button>' : '');
      const btn = b.querySelector('button');
      if (btn) {
        let fired = 0;
        const fire = ev => {
          if (ev && ev.cancelable) ev.preventDefault();
          const now = Date.now(); if (now - fired < 600) return; fired = now;
          const fn = app.banner && app.banner.onClick; if (fn) fn();
        };
        btn.addEventListener('pointerdown', fire);
        btn.addEventListener('click', fire);
      }
    }
    if (b.parentNode !== host) host.appendChild(b);
  }
  function hideBanner() { app.banner = null; if (app.bannerEl && app.bannerEl.parentNode) app.bannerEl.remove(); }
  const seatDot = i => '<span class="dot" style="background:' + SEAT_COLORS[i] + '"></span>';
  const miniTok = c => '<span class="mtok">' + R.tokenSVG(c) + '</span>';
  const miniAnimal = id => '<span class="manimal">' + R.animalSVG(id) + '</span>';
  // Avatar rond d'un joueur (animal choisi, ou initiale), cerclé de la couleur de son siège
  function avatarHTML(p, seat, cls) {
    const color = seat >= 0 && seat < SEAT_COLORS.length ? SEAT_COLORS[seat] : '#2a8f8a';
    const id = (p && p.avatar) || (p && p.bot ? Bot.avatarFor(p.name) : 0);
    const pid = p && p.pid && !p.bot && !/^local/.test(String(p.pid)) ? String(p.pid) : '';
    return '<span class="avatar' + (cls ? ' ' + cls : '') + (pid && isOnline(pid) ? ' online' : '') + '" style="--seat:' + color + '"' + (pid ? ' data-pid="' + esc(pid) + '"' : '') + '>' +
      (id && E.CARD_BY_ID.has(id) ? R.animalSVG(id) : '<b>' + esc(String((p && p.name) || '?').slice(0, 1).toUpperCase()) + '</b>') + '</span>';
  }
  const namePlate = (p, seat, cls) => avatarHTML(p, seat, cls || 'xs') + '<b>' + esc(p.name) + '</b>';
  const isOnline = pid => pid !== myPid() && (app.online.has(pid) || hub.online.has(pid));
  // moment relatif (« 5 min ago ») pour les listes
  function ago(iso) {
    const t = Date.parse(iso); if (!t) return '';
    const d = Math.max(0, Date.now() + hub.skew - t);
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.round(d / 60000) + ' min ago';
    if (d < 86400000) return Math.round(d / 3600000) + ' h ago';
    if (d < 172800000) return 'yesterday';
    if (d < 7 * 86400000) return Math.round(d / 86400000) + ' days ago';
    try { return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }
  const fmtCode = c => String(c || '').replace(/^(...)(...)$/, '$1-$2');
  // Résumé HTML des actions d'un tour (journal, toasts)
  function actionsHTML(actions) {
    const parts = [];
    for (const a of actions) {
      if (a.a === 'take') parts.push(a.tokens.map(miniTok).join(''));
      else if (a.a === 'card') parts.push(miniAnimal(a.id) + ' ' + esc(E.CARD_BY_ID.get(a.id).en));
      else if (a.a === 'cube') parts.push('<span class="mcube"></span>' + miniAnimal(a.id) + ' ' + esc(E.CARD_BY_ID.get(a.id).en));
      else if (a.a === 'spirit') parts.push(ic('sparkles', 'inl') + ' ' + esc(E.CARD_BY_ID.get(a.id).en));
      else if (a.a === 'discard') parts.push('discards ' + miniTok(a.color));
    }
    return parts.join('<span class="sep">·</span>');
  }

  // ---------- Cartes ----------
  function cardHTML(card, opts) {
    opts = opts || {};
    const left = opts.left === undefined ? card.pts.length : opts.left;
    const placed = card.pts.length - left;
    const cubeStep = card.pat.find(p => p.cube);
    const tone = card.spirit ? 'sp' : (cubeStep.s[0] === 7 ? 6 : cubeStep.s[0]);
    const cls = 'card tone-' + tone + (card.spirit ? ' spirit' : '') + (opts.cls ? ' ' + opts.cls : '');
    const badge = opts.badge ? '<div class="badge' + (opts.badgeCls ? ' ' + opts.badgeCls : '') + '">' + opts.badge + '</div>' : '';
    let track = '';
    if (!card.spirit) {
      track = '<div class="track">' + card.pts.map((v, i) => {
        const c = i < placed ? 'step got' + (i === placed - 1 ? ' cur' : '') : 'step cube';
        return '<div class="' + c + '" data-step="' + i + '" title="' + v + ' pts"><span>' + v + '</span></div>';
      }).join('') + '</div>';
    }
    const foot = card.spirit ? '<div class="rule">' + esc(card.rule) + '</div>' :
      '<div class="foot">' + (opts.done ? 'completed · ' + card.pts[card.pts.length - 1] + ' pts' : (placed ? placed + '/' + card.pts.length + ' placed · worth ' + E.cardValue(card, left) + ' pts' : card.pts.length + ' cubes to place')) + '</div>';
    return '<div class="' + cls + '" data-card="' + card.id + '" ' + (opts.attrs || '') + '>' + badge +
      '<div class="head">' + esc(card.en) + '</div>' +
      '<div class="art">' + R.sceneSVG(card) + R.animalSVG(card.id) + '</div>' +
      R.patternSVG(card) + track + foot + '</div>';
  }
  function cardDetail(card, extraHTML) {
    const step = card.pat.find(p => p.cube);
    const cubeColor = step.s[0] === 7 ? 6 : step.s[0];
    const howto = card.spirit
      ? '<p><b>Nature\'s Spirit.</b> Place its cube once the pattern is built; at the end of the game: ' + esc(card.rule) + '.</p>'
      : '<p>Value by number of cubes placed: <b>' + card.pts.join(' → ') + '</b> pts. The cube goes on the <b>' + E.COLOR_NAMES[cubeColor] + '</b> ' + miniTok(cubeColor) + ' token of the pattern, in any orientation.</p>';
    modal(cardHTML(card, { cls: 'big' }) + howto + (extraHTML || '') +
      '<div class="actions"><button class="btn secondary" id="m-close">Close</button></div>');
    $('#m-close').onclick = closeModal;
  }

  // ---------- Profil : choix de l'animal ----------
  function showAvatarPicker(current, onPick) {
    modal('<h2>' + ic('smile', 'h') + 'Pick your animal</h2><p class="note">Shown next to your name for the other players.</p><div class="avatar-grid">' +
      E.CARDS.map(c => '<button class="av-choice' + (c.id === current ? ' on' : '') + '" data-av="' + c.id + '" title="' + esc(c.en) + '">' + R.animalSVG(c.id) + '<span>' + esc(c.en) + '</span></button>').join('') +
      '</div><div class="actions"><button class="btn secondary" id="m-close">Close</button></div>', { cls: 'sheet' });
    $('#m-close').onclick = closeModal;
    $$('.av-choice').forEach(b => { b.onclick = () => { const id = +b.dataset.av; closeModal(); Sfx.card(); onPick(id); }; });
  }

  // ---------- Notifications (page en arrière-plan : « à toi de jouer », messages, invitations) ----------
  const Notif = {
    can() { return typeof Notification !== 'undefined'; },
    ask() {
      if (!this.can() || Notification.permission !== 'default') return;
      try { const r = Notification.requestPermission(() => { /* ancien style */ }); if (r && r.catch) r.catch(() => { /* refusé */ }); } catch (e) { /* indisponible */ }
    },
    async show(title, body, tag) {
      if (!this.can() || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
      const opts = { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: tag || 'harmonies', renotify: true };
      try {
        const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
        if (reg && reg.showNotification) { await reg.showNotification(title, opts); return; }
        const n = new Notification(title, opts);
        n.onclick = () => { try { root.focus(); } catch (e) { /* ignore */ } n.close(); };
      } catch (e) { /* plateforme sans notifications de page */ }
    },
  };
  // Web Push : « à toi de jouer », nouvelle partie, message — même application fermée (fonction Edge harmonies-push).
  // Sur iPhone, seulement pour l'application ajoutée à l'écran d'accueil (iOS 16.4+).
  const Push = {
    supported() { return !!(CFG.vapid && 'serviceWorker' in navigator && 'PushManager' in root && typeof Notification !== 'undefined'); },
    get on() { return !!ls.get('harmonies.push', false); },
    get active() { return this.on && this.supported() && Notification.permission === 'granted'; },
    keyBytes() { const t = CFG.vapid.replace(/-/g, '+').replace(/_/g, '/'); const p = t + '='.repeat((4 - t.length % 4) % 4); return Uint8Array.from(atob(p), c => c.charCodeAt(0)); },
    async subscribeNow() {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this.keyBytes() });
      await acctNet().rpc('harmonies_push_subscribe', Object.assign(cred(), { p_sub: sub.toJSON(), p_ua: navigator.userAgent.slice(0, 200) }));
      return sub;
    },
    // depuis un geste de l'utilisateur (demande de permission)
    async enable() {
      if (!this.supported()) { showPushHelp(); return false; }
      if (!(await ensureAccount())) { toast('Enter your name first', true); return false; }
      let perm = Notification.permission;
      if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; } }
      if (perm !== 'granted') { toast(perm === 'denied' ? 'Notifications are blocked for Harmonies in your phone settings' : 'Notifications not allowed', true); return false; }
      try { await this.subscribeNow(); }
      catch (e) { toast('Could not enable notifications: ' + e.message, true); return false; }
      ls.set('harmonies.push', true);
      toast('Notifications on — you will be told when it is your turn');
      return true;
    },
    async disable() {
      ls.set('harmonies.push', false);
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) { try { if (acct.me) await acctNet().rpc('harmonies_push_unsubscribe', Object.assign(cred(), { p_endpoint: sub.endpoint })); } catch (e) { /* ignore */ } await sub.unsubscribe(); }
      } catch (e) { /* ignore */ }
      toast('Notifications off');
    },
    // au démarrage : l'abonnement peut avoir changé, on le renvoie au serveur (une fois par jour)
    async sync() {
      if (!this.active || !acct.me) return;
      const last = ls.get('harmonies.pushSync', 0);
      if (Date.now() - last < 86400000) return;
      try { await this.subscribeNow(); ls.set('harmonies.pushSync', Date.now()); } catch (e) { /* réessayé plus tard */ }
    },
  };
  function showPushHelp() {
    const body = IOS && !STANDALONE
      ? '<p>On iPhone, notifications only work once Harmonies is installed on your Home Screen:</p><ol><li>Tap the <b>Share</b> button in Safari,</li><li>choose <b>Add to Home Screen</b>,</li><li>open Harmonies from the icon and turn notifications on.</li></ol><p class="note">Requires iOS 16.4 or later.</p>'
      : (IOS ? '<p>This version of iOS cannot receive web notifications (iOS 16.4 or later is required).</p>' : '<p>This browser cannot receive notifications. On Android, use Chrome and add Harmonies to your Home Screen.</p>');
    modal('<h2>' + ic('bell', 'h') + 'Notifications</h2>' + body + '<div class="actions"><button class="btn secondary" id="m-close">Close</button></div>');
    $('#m-close').onclick = closeModal;
  }
  // Pastille de l'icône (nombre de parties où c'est à moi de jouer) — écran d'accueil iOS 16.4+, Android
  function setAppBadge(n) {
    if (!navigator.setAppBadge) return;
    try { if (n > 0) navigator.setAppBadge(n).catch(() => {}); else navigator.clearAppBadge().catch(() => {}); } catch (e) { /* facultatif */ }
  }

  // ---------- Écran d'accueil (fond de collines plein écran, lion) ----------
  function bgHTML() {
    const w = Math.max(320, root.innerWidth || 400), h = Math.max(480, root.innerHeight || 800);
    return '<div class="bg">' + R.hillsSVG(w, h, BANNER, { reeds: 22, seed: 7, cls: 'bg-hills', sunX: 0.8 }) + '</div>';
  }
  function heroHTML(opts) {
    opts = opts || {};
    return '<div class="hero2' + (opts.lion ? ' with-lion' : ' small') + '">' + (opts.lion ? R.lionSVG('hero-lion') : '') + R.logoSVG() +
      (opts.sub ? '<div class="tagline">' + opts.sub + '</div>' : '') + (opts.extra || '') + '</div>';
  }
  const avatarBtnHTML = (id, btnId) => '<button class="avatar-btn" id="' + btnId + '" title="Choose your animal">' + avatarHTML({ avatar: id, name: myName() }, -1, 'lg') + '<i>' + ic('edit') + '</i></button>';
  function ensureName() {
    const inp = $('#name');
    const n = (inp ? inp.value : myName()).trim();
    if (!n) { toast('Enter your name first', true); if (inp) inp.focus(); return null; }
    if (n !== myName()) { ls.set('harmonies.name', n); syncProfile(); }
    return n;
  }
  function renderHome() {
    app.screen = 'home';
    document.body.classList.remove('in-game');
    document.body.classList.add('scenic');
    document.title = 'Harmonies';
    hideBanner();
    const fresh = !myName() && !hub.games.length;
    $('#app').innerHTML =
      '<div class="screen home">' + bgHTML() + '<div class="home-content">' + heroHTML({ lion: fresh, sub: fresh ? 'Compose your landscapes, welcome your animals' : '' }) +
      '<div class="home-body">' +
      '<div class="panel glass profile" id="profile-panel">' + profilePanel() + '</div>' +
      '<div class="panel glass" id="play-panel">' + playPanel() + '</div>' +
      '<div id="games-panel">' + gamesPanel() + '</div>' +
      '<div id="friends-panel">' + friendsPanel() + '</div>' +
      '<div class="panel glass rules"><h2>' + ic('book', 'h') + 'How to play</h2><p>On your turn, take the <b>3 tokens</b> of one slot of the central board and place them on your board (following the stacking rules). You may also take <b>1 Animal card</b> (max 4 in front of you) and place <b>cubes</b> as soon as their habitat is built — these actions are possible at any time during the turn.</p>' +
      '<p>Game end: bag empty when refilling, or <b>2 empty spaces or fewer</b> on your board (the round is completed).</p><button class="btn ghost" id="rules-more">Full rules and scoring →</button></div>' +
      '<p class="credits">Unofficial adaptation of Harmonies (Johan Benvenuto, Libellud). Animal icons: OpenMoji (CC BY-SA 4.0).</p>' +
      '</div></div></div>';
    bindHome();
    loadHub();
  }
  function profilePanel() {
    const bell = ONLINE_OK ? '<button class="bell' + (Push.active ? ' on' : '') + '" id="bell" title="Notifications">' + ic(Push.active ? 'bell' : 'bell-off') + '<span>' + (Push.active ? 'Alerts on' : 'Alerts') + '</span></button>' : '';
    return '<div class="me-row">' + avatarBtnHTML(myAvatar(), 'avatar-btn') + '<input type="text" id="name" maxlength="16" placeholder="Your name" value="' + esc(myName()) + '">' + bell + '</div>' +
      (myName() || !ONLINE_OK ? '' : '<p class="note">Enter your name to play online, get a friend code and be told when it is your turn.</p>');
  }
  function playPanel() {
    return '<div class="row"><button class="btn primary big" id="new-game" ' + (ONLINE_OK ? '' : 'disabled') + '>' + ic('play') + 'New game</button></div>' +
      '<div class="row" style="margin-top:10px"><input type="text" id="code" placeholder="CODE" maxlength="6" class="code-input"><button class="btn secondary" id="join" ' + (ONLINE_OK ? '' : 'disabled') + '>' + ic('login') + 'Join</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn secondary" id="local">' + ic('phone') + 'Play on this phone</button></div>' +
      (ONLINE_OK ? '' : '<p class="note">Online play unavailable (no server configuration).</p>');
  }
  // ---- liste des parties : à moi de jouer / en attente des autres / terminées / sur ce téléphone ----
  const othersOf = g => g.players.filter(p => p.pid !== myPid());
  const isMyTurnGame = g => g.status === 'playing' && !!g.players[g.turn] && g.players[g.turn].pid === myPid();
  function gameTitle(g) {
    const o = othersOf(g);
    if (!o.length) return 'Solo';
    return o.length === 1 ? 'vs ' + esc(o[0].name) : esc(o.map(p => p.name).join(', '));
  }
  function gameSub(g) {
    const me = g.players.findIndex(p => p.pid === myPid());
    const t = ago(g.updated_at);
    if (g.status === 'lobby') return 'Waiting room · code ' + esc(g.id) + (g.host === myPid() ? ' · you host' : '') + ' · ' + t;
    if (g.status === 'cancelled') return 'Cancelled · ' + t;
    if (g.status === 'finished') {
      const w = g.winners || [];
      const totals = (g.totals || []).join('–');
      let txt = w.length ? (w.includes(me) ? (w.length > 1 ? 'Tie' : 'You won') : esc((g.players[w[0]] || {}).name || '?') + ' won') : 'Game over';
      if (g.endReason === 'resign') txt = (g.resigned === me ? 'You gave up' : esc((g.players[g.resigned] || {}).name || '?') + ' gave up') + (w.includes(me) ? ' · you won' : '');
      return txt + (totals && g.endReason !== 'resign' ? ' ' + totals : '') + ' · ' + t;
    }
    const cur = g.players[g.turn];
    if (cur && cur.pid === myPid()) return '<b class="yt">Your turn</b> · turn ' + g.turnNo + ' · ' + t;
    return esc(cur ? cur.name : '?') + (cur && cur.bot ? ' (bot)' : '') + ' is playing · turn ' + g.turnNo + ' · ' + t;
  }
  function gameRow(g) {
    const others = othersOf(g).slice(0, 3);
    const done = g.status === 'finished' || g.status === 'cancelled';
    return '<li class="grow' + (isMyTurnGame(g) ? ' mine' : '') + (done ? ' done' : '') + '" data-id="' + esc(g.id) + '" data-mode="online">' +
      '<span class="stack-av">' + (others.length ? others.map(p => avatarHTML(p, g.players.indexOf(p), 'md')).join('') : avatarHTML({ name: '?' }, -1, 'md')) + '</span>' +
      '<div class="g-txt"><b>' + gameTitle(g) + '</b><span>' + gameSub(g) + '</span></div>' +
      (done ? '<button class="hide-btn" data-hide="' + esc(g.id) + '" title="Remove from the list">' + ic('x') + '</button>' : ic('chevron', 'chev')) + '</li>';
  }
  function gamesPanel() {
    if (!ONLINE_OK) return localGamesHTML();
    const hidden = new Set(ls.get('harmonies.hidden', []));
    const games = hub.games.filter(g => !hidden.has(g.id) && g.players.some(p => p.pid === myPid()));
    const mine = games.filter(isMyTurnGame);
    const waiting = games.filter(g => g.status === 'lobby' || (g.status === 'playing' && !isMyTurnGame(g)));
    const done = games.filter(g => g.status === 'finished' || g.status === 'cancelled');
    const doneShown = hub.showAllDone ? done : done.slice(0, 4);
    const section = (title, cls, arr) => (arr.length ? '<h3 class="gsec ' + cls + '">' + title + (cls === 'mine' ? '<em>' + arr.length + '</em>' : '') + '</h3><ul class="games">' + arr.map(gameRow).join('') + '</ul>' : '');
    const local = localGamesHTML();
    let body;
    if (games.length) body = section('Your turn', 'mine', mine) + section('Waiting for others', 'wait', waiting) + section('Finished', 'done', doneShown) +
      (done.length > doneShown.length ? '<button class="btn ghost" id="more-done">Show all finished games (' + done.length + ')</button>' : '');
    else body = '<p class="note">' + (hub.loading && !hub.loaded ? 'Loading your games…' : (hub.error ? 'Could not load your games (' + esc(hub.error) + ')' : 'No online game yet — start one with a friend or a bot!')) + '</p>';
    return '<div class="panel glass"><h2>' + ic('layers', 'h') + 'Your games<span class="spacer"></span><button class="icon-btn light" id="games-reload" title="Refresh">' + ic('refresh') + '</button></h2>' + body + local + '</div>';
  }
  function localGamesHTML() {
    const local = ls.get('harmonies.recent', []).filter(g => g.mode === 'local').slice(0, 6);
    if (!local.length) return ONLINE_OK ? '' : '<div class="panel glass"><h2>' + ic('phone', 'h') + 'On this phone</h2><p class="note">No game yet.</p></div>';
    const rows = '<ul class="games">' + local.map(g => '<li class="grow" data-id="' + esc(g.id) + '" data-mode="local"><span class="stack-av phone">' + ic('phone') + '</span><div class="g-txt"><b>' + esc(g.label || 'Local game') + '</b><span>' + ago(new Date(g.at).toISOString()) + '</span></div>' + ic('chevron', 'chev') + '</li>').join('') + '</ul>';
    return ONLINE_OK ? '<h3 class="gsec local">On this phone</h3>' + rows : '<div class="panel glass"><h2>' + ic('phone', 'h') + 'On this phone</h2>' + rows + '</div>';
  }
  function friendsPanel() {
    if (!ONLINE_OK) return '';
    if (!acct.me) return '<div class="panel glass"><h2>' + ic('users', 'h') + 'Friends</h2><p class="note">' + (myName() ? (hub.error ? 'Offline — friends will appear once connected.' : 'Connecting…') : 'Enter your name above to get your friend code and challenge friends without any game code.') + '</p></div>';
    const seen = f => (isOnline(f.pid) ? '<b class="on">online</b>' : (f.last_seen ? 'seen ' + ago(f.last_seen) : ''));
    return '<div class="panel glass"><h2>' + ic('users', 'h') + 'Friends<span class="spacer"></span><button class="btn small secondary" id="add-friend">' + ic('user-plus') + 'Add</button></h2>' +
      (hub.friends.length ? '<ul class="friends">' + hub.friends.map(f => '<li>' + avatarHTML(f, -1, 'md') + '<div class="f-txt"><b>' + esc(f.name) + '</b><span class="note">' + seen(f) + '</span></div>' +
        '<button class="btn small primary" data-play="' + esc(f.pid) + '">' + ic('play') + 'Play</button><button class="btn small secondary icon" data-unfriend="' + esc(f.pid) + '" title="Remove">' + ic('x') + '</button></li>').join('') + '</ul>' :
        '<p class="note">No friends yet. Send your friend link, or enter a friend\'s code — then challenge them in one tap, no game code needed.</p>') +
      '<div class="mycode"><span class="note">Your friend code</span><b>' + fmtCode(acct.me.code) + '</b><button class="btn small secondary" id="share-code">' + ic('share') + 'Share my link</button></div></div>';
  }
  function bindHome() {
    $('#name').addEventListener('change', ev => { ls.set('harmonies.name', ev.target.value.trim()); syncProfile(); refreshHomePanels(); });
    $('#avatar-btn').onclick = () => showAvatarPicker(myAvatar(), id => { ls.set('harmonies.avatar', id); $('#avatar-btn').innerHTML = avatarHTML({ avatar: id, name: myName() }, -1, 'lg') + '<i>' + ic('edit') + '</i>'; syncProfile(); });
    const bell = $('#bell'); if (bell) bell.onclick = async () => { Sfx.unlock(); bell.disabled = true; try { if (Push.active) await Push.disable(); else await Push.enable(); } finally { bell.disabled = false; refreshHomePanels(); } };
    $('#new-game').onclick = () => { if (!ensureName()) return; Sfx.unlock(); showNewGame(); };
    $('#join').onclick = async () => {
      if (!ensureName()) return;
      Sfx.unlock();
      const code = $('#code').value.trim().toUpperCase();
      if (code.length < 4) { toast('Invalid code', true); return; }
      openOnline(code, true);
    };
    $('#local').onclick = () => { Sfx.unlock(); localSetup(ls.get('harmonies.opts', { side: 'A', spirits: false })); };
    $('#rules-more').onclick = showRules;
    bindGamesPanel(); bindFriendsPanel();
  }
  function bindGamesPanel() {
    $$('#games-panel .grow').forEach(li => {
      li.onclick = ev => { if (ev.target.closest('[data-hide]')) return; Sfx.unlock(); if (li.dataset.mode === 'local') openLocal(li.dataset.id); else openOnline(li.dataset.id, true); };
    });
    $$('#games-panel [data-hide]').forEach(b => { b.onclick = ev => { ev.stopPropagation(); const h = ls.get('harmonies.hidden', []); h.push(b.dataset.hide); ls.set('harmonies.hidden', h.slice(-100)); refreshHomePanels(); }; });
    const more = $('#more-done'); if (more) more.onclick = () => { hub.showAllDone = true; refreshHomePanels(); };
    const rl = $('#games-reload'); if (rl) rl.onclick = () => { loadHub(); toast('Refreshing…'); };
  }
  function bindFriendsPanel() {
    const add = $('#add-friend'); if (add) add.onclick = showAddFriend;
    const sh = $('#share-code'); if (sh) sh.onclick = shareFriendLink;
    $$('#friends-panel [data-play]').forEach(b => { b.onclick = () => { if (!ensureName()) return; Sfx.unlock(); showNewGame({ friend: b.dataset.play }); }; });
    $$('#friends-panel [data-unfriend]').forEach(b => { b.onclick = () => removeFriend(b.dataset.unfriend); });
  }
  function refreshHomePanels() {
    if (app.screen !== 'home') return;
    const g = $('#games-panel'); if (g) { g.innerHTML = gamesPanel(); bindGamesPanel(); }
    const f = $('#friends-panel'); if (f) { f.innerHTML = friendsPanel(); bindFriendsPanel(); }
    const bell = $('#bell'); if (bell) { bell.className = 'bell' + (Push.active ? ' on' : ''); bell.innerHTML = ic(Push.active ? 'bell' : 'bell-off') + '<span>' + (Push.active ? 'Alerts on' : 'Alerts') + '</span>'; }
  }
  // ---- nouvelle partie : plateau, amis (installés d'office et prévenus) et bots ; départ immédiat ou salle d'attente ----
  function showNewGame(preset) {
    const opts = ls.get('harmonies.opts', { side: 'A', spirits: false });
    const setup = { side: opts.side === 'B' ? 'B' : 'A', spirits: !!opts.spirits, friends: [], bots: [] };
    if (preset && preset.friend && hub.friends.some(f => f.pid === preset.friend)) setup.friends.push(preset.friend);
    const draw = () => {
      const count = 1 + setup.friends.length + setup.bots.length;
      const chosen = f => setup.friends.includes(f.pid);
      modal('<h2>' + ic('play', 'h') + 'New game</h2>' +
        '<div class="field"><label>Board</label><div class="seg" id="ng-side"><button data-v="A" class="' + (setup.side === 'A' ? 'on' : '') + '">' + miniTok(1) + 'Side A · river</button><button data-v="B" class="' + (setup.side === 'B' ? 'on' : '') + '">' + miniTok(5) + 'Side B · islands</button></div></div>' +
        '<label class="check"><input type="checkbox" id="ng-spirits" ' + (setup.spirits ? 'checked' : '') + '><span>' + ic('sparkles', 'inl') + ' Nature\'s Spirit cards <em>(advanced variant)</em></span></label>' +
        '<div class="field"><label>Players (' + count + '/4)</label><div class="chips">' +
        '<span class="chip on me">' + avatarHTML({ avatar: myAvatar(), name: myName() }, 0, 'xs') + esc(myName()) + '</span>' +
        hub.friends.map(f => '<button type="button" class="chip' + (chosen(f) ? ' on' : '') + '" data-friend="' + esc(f.pid) + '" ' + (!chosen(f) && count >= 4 ? 'disabled' : '') + '>' + avatarHTML(f, -1, 'xs') + esc(f.name) + (chosen(f) ? ic('check', 'inl') : '') + '</button>').join('') +
        setup.bots.map((lvl, i) => '<button type="button" class="chip on bot" data-bot="' + i + '" title="Remove">' + ic('cpu', 'inl') + esc(BOT_LABEL[lvl]) + ic('x', 'inl') + '</button>').join('') +
        (count < 4 ? '<select class="chip-sel" id="ng-addbot"><option value="">+ bot…</option><option value="1">Novice bot</option><option value="2">Skilled bot</option><option value="3">Expert bot</option></select>' : '') +
        '</div>' + (hub.friends.length ? '<p class="note">Tap friends to add them: they are seated right away and notified.</p>' : '<p class="note">No friends yet — add them from the Friends panel to challenge them here.</p>') + '</div>' +
        '<div class="actions col"><button class="btn primary big" id="ng-start" ' + (count >= 2 ? '' : 'disabled') + '>' + ic('play') + 'Start now</button>' +
        '<button class="btn secondary" id="ng-lobby">' + ic('globe') + 'Waiting room with a code</button></div>', { cls: 'sheet' });
      $('#ng-side').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; setup.side = b.dataset.v; [...$('#ng-side').children].forEach(x => x.classList.toggle('on', x === b)); saveOpts(); });
      $('#ng-spirits').onchange = ev => { setup.spirits = ev.target.checked; saveOpts(); };
      $$('#modal [data-friend]').forEach(b => { b.onclick = () => { const pid = b.dataset.friend; const i = setup.friends.indexOf(pid); if (i >= 0) setup.friends.splice(i, 1); else if (count < 4) setup.friends.push(pid); draw(); }; });
      $$('#modal [data-bot]').forEach(b => { b.onclick = () => { setup.bots.splice(+b.dataset.bot, 1); draw(); }; });
      const ab = $('#ng-addbot'); if (ab) ab.onchange = () => { const lvl = +ab.value; if (lvl && count < 4) setup.bots.push(lvl); draw(); };
      $('#ng-start').onclick = () => go(true);
      $('#ng-lobby').onclick = () => go(false);
    };
    const saveOpts = () => ls.set('harmonies.opts', { side: setup.side, spirits: setup.spirits });
    const go = async start => {
      const name = ensureName(); if (!name) return;
      const seats = [];
      const used = [name];
      setup.friends.forEach(pid => { const f = hub.friends.find(x => x.pid === pid); if (f) { seats.push({ pid: f.pid, name: f.name, avatar: f.avatar }); used.push(f.name); } });
      setup.bots.forEach(lvl => { const bn = 'Bot ' + botName(used.map(n => ({ name: n })), lvl); used.push(bn); seats.push({ bot: lvl, name: bn, avatar: Bot.avatarFor(bn) }); });
      if (start && seats.length && seats.every(p => p.bot) && false) return;
      closeModal();
      try { await createOnline({ side: setup.side, spirits: setup.spirits }, name, seats, start); }
      catch (e) { toast('Could not create the game: ' + e.message, true); }
    };
    draw();
  }
  function showAddFriend() {
    modal('<h2>' + ic('user-plus', 'h') + 'Add a friend</h2><p class="note">Ask your friend for their code (shown in their Friends panel), or send them your link — friendship works both ways.</p>' +
      '<form id="af-form" autocomplete="off"><div class="row"><input type="text" id="af-code" class="code-input" placeholder="ABC-DEF" maxlength="7" autocapitalize="characters"><button class="btn primary" type="submit">' + ic('plus') + 'Add</button></div></form>' +
      '<div class="mycode" style="margin-top:14px"><span class="note">Your friend code</span><b>' + fmtCode(acct.me ? acct.me.code : '') + '</b><button class="btn small secondary" id="af-share">' + ic('share') + 'Share my link</button></div>' +
      '<div class="actions"><button class="btn secondary" id="m-close">Close</button></div>');
    $('#m-close').onclick = closeModal;
    $('#af-share').onclick = shareFriendLink;
    $('#af-form').onsubmit = async ev => { ev.preventDefault(); const code = $('#af-code').value; if (!code.trim()) return; if (await addFriend(code)) closeModal(); };
    $('#af-code').focus();
  }
  async function shareFriendLink() {
    if (!(await ensureAccount())) { toast('Enter your name first', true); return; }
    const link = location.origin + location.pathname + '?add=' + acct.me.code;
    const text = myName() + ' wants to play Harmonies with you! Add me as a friend: ' + link;
    if (navigator.share) { try { await navigator.share({ title: 'Harmonies', text, url: link }); return; } catch (e) { /* annulé */ } }
    await copyText(link); toast('Friend link copied — send it to your friend');
  }
  function playerRow(pl, i) {
    const av = pl.avatar || (pl.bot ? Bot.avatarFor(pl.name) : 0);
    return '<div class="prow" data-av="' + av + '"><button class="avatar-btn sm" data-pick="' + i + '" title="Animal">' + avatarHTML({ avatar: av, name: pl.name, bot: pl.bot }, i, 'md') + '</button><input type="text" maxlength="16" value="' + esc(pl.name) + '" data-i="' + i + '">' +
      '<select class="ptype" data-i="' + i + '">' + BOT_OPTIONS.map(([v, l]) => '<option value="' + v + '"' + (pl.bot === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>';
  }
  function localSetup(opts) {
    let players = ls.get('harmonies.localPlayers', null);
    if (!players) players = [{ name: myName() || 'Player 1', bot: 0, avatar: myAvatar() }, { name: 'Bot Fennec', bot: 2 }];
    if (players[0] && !players[0].bot) { players[0].avatar = myAvatar(); if (myName()) players[0].name = myName(); }
    modal('<h2>' + ic('phone', 'h') + 'Game on this phone</h2><p class="note">Humans and bots; humans pass the phone around. Three bot levels: novice (random), skilled (goes for immediate points), expert (also prepares its habitats).</p>' +
      '<div id="prows">' + players.map(playerRow).join('') + '</div>' +
      '<div class="row"><button class="btn secondary small" id="m-add">' + ic('plus') + 'player</button><button class="btn secondary small" id="m-del">' + ic('minus') + 'player</button></div>' +
      '<div class="actions"><button class="btn secondary" id="m-cancel">Cancel</button><button class="btn primary" id="m-go">Start</button></div>');
    const read = () => $$('#prows .prow').map(row => ({ name: row.querySelector('input').value.trim(), bot: +row.querySelector('select').value, avatar: +row.dataset.av || 0 }));
    const rerender = pl => { ls.set('harmonies.localPlayers', pl); localSetup(opts); };
    $('#m-add').onclick = () => { const pl = read(); if (pl.length < 4) { pl.push({ name: 'Bot ' + botName(pl, 2), bot: 2 }); rerender(pl); } };
    $('#m-del').onclick = () => { const pl = read(); if (pl.length > 2) { pl.pop(); rerender(pl); } };
    $$('#prows select').forEach(sel => { sel.onchange = () => { const row = sel.closest('.prow'); const inp = row.querySelector('input'); const lvl = +sel.value; if (lvl && (!inp.value.trim() || /^Player \d|^Bot /.test(inp.value))) { inp.value = 'Bot ' + botName(read().filter((_, k) => k !== +sel.dataset.i), lvl); row.dataset.av = Bot.avatarFor(inp.value); } const pl = read(); ls.set('harmonies.localPlayers', pl); localSetup(opts); }; });
    $$('#prows [data-pick]').forEach(b => { b.onclick = () => { const pl = read(); ls.set('harmonies.localPlayers', pl); const i = +b.dataset.pick; showAvatarPicker(pl[i].avatar, id => { pl[i].avatar = id; if (i === 0 && !pl[0].bot) ls.set('harmonies.avatar', id); rerender(pl); }); }; });
    $('#m-cancel').onclick = closeModal;
    $('#m-go').onclick = () => {
      const pl = read().map((p, i) => ({ name: p.name || (p.bot ? 'Bot ' + (i + 1) : 'Player ' + (i + 1)), bot: p.bot, avatar: p.avatar || (p.bot ? Bot.avatarFor(p.name) : E.CARDS[(i * 7 + 3) % E.CARDS.length].id) }));
      if (pl.every(p => p.bot)) { toast('At least one human player is needed', true); return; }
      ls.set('harmonies.localPlayers', pl);
      closeModal();
      startLocal(opts, pl);
    };
  }

  // ---------- Création / ouverture ----------
  async function startLocal(opts, players) {
    app.net = root.Net.makeLocal(); app.mode = 'local';
    const id = randomId(6);
    const state = E.newGame(opts, players.map((pl, i) => ({ token: 'local' + i, name: pl.name, bot: pl.bot || 0, avatar: pl.avatar || 0 })));
    state.players.forEach((p, i) => { p.pid = 'local' + i; });
    state.id = id; state.mode = 'local';
    await app.net.createGame(id, state);
    rememberGame({ id, mode: 'local', label: players.map(p => p.name).join(', ') + ' · ' + SIDE_LABEL[opts.side] });
    enterGame(id, state, 1);
  }
  async function openLocal(id) {
    app.net = root.Net.makeLocal(); app.mode = 'local';
    const rec = await app.net.loadGame(id);
    if (!rec) { toast('Game not found on this device', true); return; }
    enterGame(id, rec.state, rec.version);
  }
  // seats : autres joueurs installés d'office ({ pid, name, avatar } d'un ami — prévenu aussitôt — ou { bot, name, avatar }) ;
  // start : la partie commence tout de suite (sans salle d'attente) dès qu'il y a au moins deux joueurs.
  async function createOnline(opts, name, seats, start) {
    if (!ONLINE_OK) throw new Error('online play unavailable');
    if (!acct.me) await ensureAccount();
    app.net = root.Net.makeOnline(CFG); app.mode = 'online';
    const id = randomId(5);
    const players = [{ pid: myPid(), name, avatar: myAvatar() }].concat((seats || []).map(p => (p.bot
      ? { pid: 'bot-' + randomId(6, 'abcdefghijklmnopqrstuvwxyz0123456789'), name: p.name, bot: p.bot, avatar: p.avatar || Bot.avatarFor(p.name) }
      : { pid: p.pid, name: p.name, avatar: p.avatar || 0 })));
    let state;
    if (start && players.length >= 2) {
      state = E.newGame(opts, players.map(p => ({ token: p.pid, name: p.name, bot: p.bot || 0, avatar: p.avatar || 0 })));
      state.players.forEach((p, i) => { p.pid = players[i].pid; });
      state.id = id; state.host = myPid(); state.mode = 'online';
    } else state = { status: 'lobby', id, opts: { side: opts.side === 'B' ? 'B' : 'A', spirits: !!opts.spirits }, host: myPid(), players, createdAt: Date.now() };
    stamp(state);
    await app.net.createGame(id, state);
    rememberGame({ id, mode: 'online', label: 'Online · ' + SIDE_LABEL[opts.side] });
    notifyPlayers(state, 'game', { started: state.status === 'playing', lobby: state.status === 'lobby' });
    history.replaceState(null, '', '?g=' + id);
    enterGame(id, state, 1);
    if (state.status === 'playing' && players.some(p => !p.bot && p.pid !== myPid())) toast('Game started — your friends have been notified');
    return id;
  }
  // Avant chaque enregistrement : qui a joué, et qui est connecté (ces joueurs ne reçoivent pas de notification push).
  function stamp(state) {
    state.lastBy = myPid();
    state.present = (state.players || []).filter(p => !p.bot && p.pid && p.pid !== myPid() && isOnline(p.pid)).map(p => p.pid);
    return state;
  }
  // Événement en direct (canal du joueur) pour les autres humains de la partie — ou seulement `pids`.
  function notifyPlayers(state, event, extra, pids) {
    if (!ONLINE_OK || !app.net || !app.net.pushEvent) return;
    const targets = pids || (state.players || []).filter(p => !p.bot && p.pid && p.pid !== myPid()).map(p => p.pid);
    const from = { pid: myPid(), name: myName() || 'A friend', avatar: myAvatar() };
    const payload = Object.assign({ game: state.id, from, side: state.opts ? state.opts.side : 'A', at: Date.now() }, extra || {});
    targets.forEach(pid => { try { app.net.pushEvent(pid, event, payload).catch(() => {}); } catch (e) { /* ignore */ } });
  }
  // autoJoin : rejoindre d'office la salle d'attente avec son prénom (lien reçu, invitation)
  async function openOnline(id, autoJoin) {
    if (!ONLINE_OK) { toast('Online play unavailable', true); return; }
    app.net = root.Net.makeOnline(CFG); app.mode = 'online';
    let rec;
    try { rec = await app.net.loadGame(id); } catch (e) { toast('Connection failed: ' + e.message, true); return; }
    if (!rec) { toast('No game with code ' + id, true); history.replaceState(null, '', location.pathname); return; }
    history.replaceState(null, '', '?g=' + id);
    enterGame(id, rec.state, rec.version);
    if (autoJoin && app.committed && app.committed.status === 'lobby' && !app.committed.players.some(p => p.pid === myPid()) && myName()) {
      try { await joinLobby(myName()); render(); } catch (e) { toast('Could not join: ' + e.message, true); }
    }
  }
  function goHome() { leaveGame(); renderHome(); }

  function enterGame(id, state, version) {
    if (app.unsub) { app.unsub(); app.unsub = null; }
    if (chat.unsub) { chat.unsub(); chat.unsub = null; }
    clearInterval(app.poll); clearTimeout(app.botTimer); app.botTimer = null;
    app.gameId = id; app.committed = state; app.version = version; app.work = null; app.undo = []; app.replay = null; app.busy = false;
    app.selToken = null; app.cubeMode = null; app.endShown = false; app.spiritPrompted = false; app.lastLogLen = (state.log || []).length;
    app.viewSeat = 0; app.stageManual = false;
    chat.msgs = []; chat.lastId = 0; chat.unread = 0; chat.open = false;
    app.online = new Set(); app.pollTick = 0; app.fast = false;
    const presence = app.mode === 'online' ? { pid: myPid(), onPresence: pids => { app.online = new Set(pids); updatePresence(); } } : null;
    app.unsub = app.net.subscribe(id, () => refresh(), ok => { app.rtOk = ok; const d = $('#conn'); if (d) d.className = 'conn ' + (ok ? 'on' : 'off'); }, presence);
    if (app.mode === 'online') {
      // toutes les 15 s au premier plan, 30 s en arrière-plan (pour prévenir quand c'est à soi de jouer)
      app.poll = setInterval(() => {
        app.pollTick++;
        const visible = document.visibilityState === 'visible';
        if (!visible && app.pollTick % 2) return;
        refresh();
        if (visible) loadChat(false);
      }, 15000);
      if (app.net.chat) { chat.unsub = app.net.subscribeChat(id, m => addChatMsg(m, true)); loadChat(true); }
    }
    render();
    updateHub();
    if (isMine() && state.status === 'playing') announceMyTurn();
    maybeRunBot();
    if (app.mode === 'online') setTimeout(maybeOfferPush, 2500);
  }
  // Une seule fois : proposer les notifications « à toi de jouer » (sur iPhone, seulement une fois l'app installée)
  function maybeOfferPush() {
    if (!ONLINE_OK || Push.on || ls.get('harmonies.pushAsked', false) || $('#modal') || app.screen === 'home') return;
    if (!Push.supported() && !(IOS && !STANDALONE)) return;
    if (Push.supported() && Notification.permission === 'denied') return;
    ls.set('harmonies.pushAsked', true);
    modal('<h2>' + ic('bell', 'h') + 'Know when it is your turn</h2><p>Harmonies can notify you when a friend plays, starts a game with you or sends a message — even when the app is closed.</p>' +
      (IOS && !STANDALONE ? '<p class="note">On iPhone this works once Harmonies is added to your Home Screen (Share → Add to Home Screen), then turn alerts on from the home screen.</p>' : '') +
      '<div class="actions"><button class="btn secondary" id="m-later">Later</button>' + (Push.supported() ? '<button class="btn primary" id="m-on">' + ic('bell') + 'Turn on</button>' : '') + '</div>');
    $('#m-later').onclick = closeModal;
    const on = $('#m-on'); if (on) on.onclick = async () => { closeModal(); await Push.enable(); };
  }
  // le mode « rapide » (bots joués sans animation après Skip) s'arrête dès qu'un humain doit jouer
  function syncFast() {
    const s = app.committed;
    if (!s || s.status !== 'playing' || !E.current(s).bot) app.fast = false;
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
    clearTimeout(app.botTimer); app.botTimer = null;
    if (app.replay) app.replay.abort = true;
    if (!wasMine || !isMine()) { app.work = null; app.undo = []; app.selToken = null; app.cubeMode = null; app.stageManual = false; ls.del('harmonies.draft.' + app.gameId); }
    // rejeu animé du tour adverse si l'on dispose de l'état exact qui le précédait
    const s = app.committed;
    const entry = s.log && s.log.length > app.lastLogLen ? s.log[s.log.length - 1] : null;
    const who = entry ? s.players[entry.p] : null;
    const remote = !!who && !(app.mode === 'online' && who.pid === myPid());
    const canReplay = remote && prev && prev.status === 'playing' && prev.log && s.log.length === prev.log.length + 1 && prev.turn === entry.p && prev.turnNo === entry.n && document.visibilityState === 'visible' && !(app.fast && who.bot);
    app.lastLogLen = s.log ? s.log.length : 0;
    if (canReplay) { await replayTurn(prev, entry, s); return; }
    if (remote) toast(avatarHTML(who, entry.p, 'xs') + esc(who.name) + ': ' + (actionsHTML(entry.actions) || 'played'));
    syncFast();
    if (s.status !== 'playing') hideBanner();
    render();
    if (isMine() && s.status === 'playing' && !wasMine) announceMyTurn();
    if (s.status === 'finished' && prev && prev.status === 'playing') loadHub();
    maybeRunBot();
  }
  function announceMyTurn() {
    const me = E.current(app.committed);
    turnOverlay(avatarHTML(me, app.committed.turn, 'big') + '<div>Your turn' + (app.mode === 'online' ? ', ' + esc(me.name) : ': ' + esc(me.name)) + '!</div>');
    Sfx.turn(); vibrate([30, 40, 30]);
    if (app.mode === 'online') Notif.show('Harmonies', 'Your turn, ' + me.name + '!', 'turn');
  }
  // Pastilles « en ligne » (présence) sans re-rendu complet
  function updatePresence() {
    $$('.avatar[data-pid]').forEach(el => el.classList.toggle('online', isOnline(el.dataset.pid)));
  }

  // ---------- Rejeu animé du tour d'un autre joueur ----------
  // Joue visuellement une action (rejeu d'un adversaire ou tour d'un bot) sur `state`.
  async function performAction(state, a, name, token) {
    const goStage = async st => { if (app.stage !== st) { app.stage = st; renderGame(); await pause(450, token); } };
    if (a.a === 'take') {
      let slot = a.slot;
      if (slot === undefined) slot = state.market.findIndex(m => m.length === a.tokens.length && m.every((t, i) => t === a.tokens[i]));
      if (slot >= 0) { await goStage('choose'); await animatedTake(state, slot); }
    } else if (a.a === 'place') {
      const idx = state.cur.tokens.indexOf(a.color);
      if (idx >= 0) { await goStage('play'); await animatedPlace(state, idx, a.cell); }
    } else if (a.a === 'card') {
      const idx = a.slot !== undefined && state.display[a.slot] === a.id ? a.slot : state.display.indexOf(a.id);
      if (idx >= 0) { await goStage('choose'); await animatedCard(state, idx); }
    } else if (a.a === 'cube') {
      await goStage('play'); await animatedCube(state, a.id, a.cell);
    } else if (a.a === 'spirit') {
      E.chooseSpirit(state, a.id); renderGame(); toast(esc(name) + ' chooses the spirit ' + esc(E.CARD_BY_ID.get(a.id).en));
    } else if (a.a === 'discard') {
      const idx = state.cur.tokens.indexOf(a.color); if (idx >= 0) E.discardToken(state, idx); renderGame();
    }
    void token;
  }
  async function replayTurn(prev, entry, next) {
    const state = E.clone(prev);
    const token = { state, seat: entry.p, abort: false };
    app.replay = token;
    app.viewSeat = entry.p;
    const name = next.players[entry.p].name;
    app.stage = 'play'; app.stageManual = false;
    renderGame();
    showBanner(ic('film', 'inl') + ' ' + esc(name) + ' is playing…', () => { token.abort = true; if (next.players[entry.p].bot) app.fast = true; flushFlights(); }, ic('skip') + 'Skip');
    await pause(500, token);
    for (const a of entry.actions) {
      if (token.abort) break;
      try { await performAction(state, a, name, token); } catch (e) { break; }
      if (token.abort) break;
      await pause(350, token);
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
    if (!aborted) await animateRefill(take ? take.slot : undefined, newDisplay);
    syncFast();
    app.stageManual = false; app.stage = autoStage();
    renderGame();
    if (mineNow && next.status === 'playing') announceMyTurn();
    if (next.status === 'finished' && !app.endShown) { app.endShown = true; showResults(); loadHub(); }
    maybeRunBot();
  }

  // ---------- Bots : joués par l'appareil hôte, ou à défaut par n'importe quel joueur humain connecté ----------
  // Délai avant que cet appareil joue le tour du bot : l'hôte tout de suite, les autres humains après (au cas où l'hôte est absent).
  function botDelay() {
    const s = app.committed;
    if (app.mode === 'local' || s.host === myPid()) return app.fast ? 120 : 700;
    const humans = s.players.filter(p => !p.bot && p.pid !== s.host).map(p => p.pid);
    const rank = humans.indexOf(myPid());
    return rank < 0 ? -1 : 7000 + rank * 4000;
  }
  function maybeRunBot() {
    clearTimeout(app.botTimer); app.botTimer = null;
    const s = app.committed;
    if (!s || s.status !== 'playing' || app.replay || app.botRunning) return;
    const p = E.current(s);
    if (!p.bot) return;
    const delay = botDelay();
    if (delay < 0) return;
    const version = app.version;
    app.botTimer = setTimeout(() => {
      app.botTimer = null;
      if (app.version !== version || app.botRunning || app.replay || !app.committed || app.committed.status !== 'playing') return;
      if (delay > 1000 && document.visibilityState !== 'visible') { maybeRunBot(); return; }
      app.botRunning = true;
      runBotTurn().catch(e => { app.botRunning = false; if (app.replay && app.replay.bot) app.replay = null; hideBanner(); toast('Bot turn failed: ' + e.message, true); render(); });
    }, delay);
  }
  // Bouton Skip : termine l'animation en cours et joue les bots suivants sans animation, jusqu'au prochain tour humain.
  function skipBots() {
    app.fast = true;
    if (app.replay) app.replay.abort = true;
    flushFlights();
  }
  async function runBotTurn() {
    const s = app.committed;
    if (!s || s.status !== 'playing' || app.replay) { app.botRunning = false; return; }
    const p = E.current(s);
    if (!p.bot) { app.botRunning = false; return; }
    const version = app.version;
    const planned = E.clone(s);
    let actions;
    try { actions = Bot.playTurn(planned, p.bot); E.endTurn(planned); }
    catch (e) { app.botRunning = false; toast('Bot error: ' + e.message, true); return; }
    stamp(planned);
    const fast = app.fast;
    let token = null, aborted = fast;
    if (!fast) {
      const vis = E.clone(s);
      token = { state: vis, seat: s.turn, abort: false, bot: true };
      app.replay = token; app.viewSeat = s.turn; app.stage = 'choose'; app.stageManual = false;
      renderGame();
      showBanner(ic('dice', 'inl') + ' ' + esc(p.name) + ' (' + BOT_LABEL[p.bot].toLowerCase() + ') is playing…', skipBots, ic('skip') + 'Skip');
      await pause(600, token);
      for (const a of actions) {
        if (token.abort) break;
        try { await performAction(vis, a, p.name, token); } catch (e) { break; }
        if (token.abort) break;
        await pause(300, token);
      }
      aborted = token.abort;
    }
    let saved = null;
    try { saved = await app.net.saveGame(app.gameId, planned, version); }
    catch (e) { if (token && app.replay === token) app.replay = null; hideBanner(); app.botRunning = false; await refresh(); render(); maybeRunBot(); return; }
    if (token && app.replay === token) app.replay = null;
    hideBanner();
    const prevDisplay = s.display;
    app.committed = planned; app.version = saved.version; app.lastLogLen = planned.log.length;
    app.work = null; app.undo = []; app.selToken = null; app.cubeMode = null; app.spiritPrompted = false; app.stageManual = false;
    if (app.mode === 'online') notifyNextTurn(planned);
    if (fast) toast(avatarHTML(p, s.turn, 'xs') + esc(p.name) + ': ' + (actionsHTML(actions) || 'played'));
    if (planned.status === 'finished') { app.botRunning = false; syncFast(); render(); loadHub(); return; }
    const take = actions.find(x => x.a === 'take');
    const newDisplay = [];
    planned.display.forEach((id, i) => { if (id && prevDisplay[i] !== id) newDisplay.push(i); });
    if (!aborted) await animateRefill(take ? take.slot : undefined, newDisplay);
    app.botRunning = false;
    syncFast();
    app.viewSeat = isMine() ? planned.turn : (mySeat() >= 0 ? mySeat() : planned.turn);
    app.stage = autoStage();
    render();
    if (isMine()) announceMyTurn();
    maybeRunBot();
  }
  // Après un tour enregistré : prévient en direct le prochain humain (ou tout le monde si la partie est finie).
  function notifyNextTurn(state) {
    if (app.mode !== 'online') return;
    if (state.status === 'finished') { notifyPlayers(state, 'finished', {}); return; }
    if (state.status !== 'playing') return;
    const nxt = E.current(state);
    if (nxt && !nxt.bot && nxt.pid && nxt.pid !== myPid()) notifyPlayers(state, 'turn', { turnNo: state.turnNo }, [nxt.pid]);
  }

  // ---------- Lobby ----------
  async function joinLobby(name) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const rec = await app.net.loadGame(app.gameId);
      if (!rec || rec.state.status !== 'lobby') return;
      const st = rec.state;
      if (st.players.some(p => p.pid === myPid())) { app.committed = st; app.version = rec.version; return; }
      if (st.players.length >= 4) { toast('The game is full (4 players)', true); return; }
      st.players.push({ pid: myPid(), name, avatar: myAvatar() });
      Notif.ask();
      try {
        const r = await app.net.saveGame(app.gameId, st, rec.version);
        app.committed = st; app.version = r.version;
        rememberGame({ id: app.gameId, mode: 'online', label: 'Online · ' + SIDE_LABEL[st.opts.side] });
        return;
      } catch (e) { if (e.code !== 'conflict') throw e; }
    }
  }
  const chatBtnHTML = cls => (chatAvailable() ? '<button class="chat-btn ' + (cls || '') + '" id="chat-btn" title="Chat">' + ic('chat') + (chat.unread ? '<i class="badge-n">' + chat.unread + '</i>' : '') + '</button>' : '');
  function renderLobby() {
    app.screen = 'lobby';
    document.body.classList.remove('in-game');
    document.body.classList.add('scenic');
    hideBanner();
    const s = app.committed;
    document.title = 'Harmonies · ' + (s.id || '');
    const host = s.host === myPid();
    const inGame = s.players.some(p => p.pid === myPid());
    const link = location.origin + location.pathname + '?g=' + s.id;
    const friendOf = pid => hub.friends.some(f => f.pid === pid);
    const hostP = s.players.find(p => p.pid === s.host);
    const seated = new Set(s.players.map(p => p.pid));
    const invitable = host && acct.me ? hub.friends.filter(f => !seated.has(f.pid)) : [];
    $('#app').innerHTML = '<div class="screen home">' + bgHTML() + '<div class="home-content">' + heroHTML({ sub: 'Waiting room', extra: chatBtnHTML('float') }) + '<div class="home-body">' +
      '<div class="panel glass"><h2>' + ic('users', 'h') + 'Game code</h2><div class="code-big">' + esc(s.id) + '</div>' +
      '<p class="note center">' + esc(SIDE_LABEL[s.opts.side]) + (s.opts.spirits ? ' · Nature\'s Spirits' : '') + '</p>' +
      '<div class="row"><button class="btn primary" id="share">' + ic('send') + 'Send the link</button><button class="btn secondary" id="copy">' + ic('copy') + 'Copy</button></div></div>' +
      '<div class="panel glass"><h2>' + ic('users', 'h') + 'Players (' + s.players.length + '/4)</h2><ul class="players-list">' + s.players.map((p, i) =>
        '<li>' + avatarHTML(p, i, 'md') + '<b>' + esc(p.name) + '</b>' + (p.bot ? ' <span class="note">· ' + BOT_LABEL[p.bot] + '</span>' : '') + (p.pid === s.host ? ' <span class="note">· host</span>' : '') + (p.pid === myPid() ? ' <span class="note">· you</span>' : '') +
        '<span class="spacer"></span>' +
        (!p.bot && p.pid !== myPid() && acct.me && !friendOf(p.pid) ? '<button class="btn small secondary" data-befriend="' + esc(p.pid) + '">' + ic('user-plus') + 'Add friend</button>' : '') +
        (host && p.pid !== myPid() ? '<button class="btn small secondary icon" data-rm="' + i + '" title="Remove">' + ic('x') + '</button>' : '') + '</li>').join('') + '</ul>' +
      (host && s.players.length < 4 ? '<div class="row" style="margin-top:8px"><select id="botlvl" class="sel"><option value="1">Novice bot</option><option value="2" selected>Skilled bot</option><option value="3">Expert bot</option></select><button class="btn secondary small" id="addbot">' + ic('plus') + 'Add a bot</button></div>' : '') +
      (inGame ? '' : '<div class="field" style="margin-top:10px"><label>Your name and animal</label><div class="me-row">' + avatarBtnHTML(myAvatar(), 'avatar-btn') + '<input type="text" id="jname" maxlength="16" value="' + esc(myName()) + '" placeholder="Your name"></div></div><button class="btn primary block" id="joinbtn">Join the game</button>') +
      '</div>' +
      (host && acct.me ? '<div class="panel glass"><h2>' + ic('users', 'h') + 'Invite friends</h2>' + (invitable.length ? '<ul class="friends">' + invitable.map(f => '<li>' + avatarHTML(f, -1, 'md') + '<div class="f-txt"><b>' + esc(f.name) + '</b><span class="note">' + (isOnline(f.pid) ? 'online' : (f.last_seen ? 'seen ' + ago(f.last_seen) : '')) + '</span></div>' +
        '<button class="btn small primary" data-invite="' + esc(f.pid) + '" ' + (s.players.length >= 4 ? 'disabled' : '') + '>' + ic('send') + 'Invite</button></li>').join('') + '</ul>' :
        '<p class="note">' + (hub.friends.length ? 'All your friends are already seated.' : 'Add friends from the home screen to seat them here without a code — they are notified right away.') + '</p>') + '</div>' : '') +
      (host ? '<button class="btn primary block big" id="start" ' + (s.players.length >= 2 ? '' : 'disabled') + '>' + ic('play') + 'Start the game (' + plural(s.players.length, 'player') + ')</button>' +
        (s.players.length < 2 ? '<p class="note center light">Waiting for at least one more player… this page refreshes by itself.</p>' : '') :
        '<p class="note center light">Waiting for ' + esc(hostP ? hostP.name : 'the host') + ' to start the game… <span class="conn ' + (app.rtOk ? 'on' : '') + '" id="conn"></span></p>') +
      '<div class="row"><button class="btn ghost light" id="leave">' + ic('back') + 'All games</button>' + (host ? '<button class="btn ghost light" id="cancel">' + ic('x') + 'Cancel this game</button>' : (inGame ? '<button class="btn ghost light" id="quit">' + ic('x') + 'Leave this game</button>' : '')) + '</div></div></div></div>';
    $('#share').onclick = async () => {
      const text = 'Come play Harmonies with me! Code ' + s.id + ' — ' + link;
      if (navigator.share) { try { await navigator.share({ title: 'Harmonies', text, url: link }); } catch (e) { /* annulé */ } }
      else { await copyText(link); toast('Link copied'); }
    };
    $('#copy').onclick = async () => { await copyText(link); toast('Link copied'); };
    $('#leave').onclick = goHome;
    const cb = $('#chat-btn'); if (cb) cb.onclick = openChat;
    $$('[data-invite]').forEach(b => { b.onclick = async () => {
      b.disabled = true;
      const f = hub.friends.find(x => x.pid === b.dataset.invite); if (!f) return;
      const ok = await saveLobby(st => { if (st.players.length < 4 && !st.players.some(p => p.pid === f.pid)) st.players.push({ pid: f.pid, name: f.name, avatar: f.avatar || 0 }); });
      if (ok) { notifyPlayers(app.committed, 'game', { lobby: true }, [f.pid]); toast(esc(f.name) + ' is seated and has been notified'); }
    }; });
    $$('[data-befriend]').forEach(b => { b.onclick = async () => { b.disabled = true; if (await addFriend(null, b.dataset.befriend)) render(); else b.disabled = false; }; });
    const ab2 = $('#avatar-btn'); if (ab2) ab2.onclick = () => showAvatarPicker(myAvatar(), id => { ls.set('harmonies.avatar', id); ab2.innerHTML = avatarHTML({ avatar: id, name: myName() }, -1, 'lg') + '<i>' + ic('edit') + '</i>'; });
    if (!inGame) $('#joinbtn').onclick = async () => {
      const n = $('#jname').value.trim(); if (!n) { toast('Enter your name', true); return; }
      ls.set('harmonies.name', n); Sfx.unlock(); syncProfile();
      try { await joinLobby(n); render(); } catch (e) { toast('Could not join: ' + e.message, true); }
    };
    const ab = $('#addbot'); if (ab) ab.onclick = () => { const lvl = +$('#botlvl').value; saveLobby(st => { if (st.players.length < 4) { const name = 'Bot ' + botName(st.players, lvl); st.players.push({ pid: 'bot-' + randomId(6, 'abcdefghijklmnopqrstuvwxyz0123456789'), name, bot: lvl, avatar: Bot.avatarFor(name) }); } }); };
    $$('[data-rm]').forEach(b => { b.onclick = () => { const i = +b.dataset.rm; const gone = s.players[i]; saveLobby(st => { if (st.players[i] && st.players[i].pid !== st.host) st.players.splice(i, 1); }).then(ok => { if (ok && gone && !gone.bot) notifyPlayers(app.committed, 'finished', { cancelled: true, removed: true }, [gone.pid]); }); }; });
    const cancel = $('#cancel'); if (cancel) cancel.onclick = () => confirmBox('Cancel this game?', 'The waiting room is closed for everyone.', async () => {
      const ok = await saveLobby(st => { st.status = 'cancelled'; st.cancelledBy = 0; });
      if (ok) { notifyPlayers(app.committed, 'finished', { cancelled: true }); goHome(); }
    });
    const quit = $('#quit'); if (quit) quit.onclick = async () => { const ok = await saveLobby(st => { const i = st.players.findIndex(p => p.pid === myPid()); if (i >= 0) st.players.splice(i, 1); }); if (ok) goHome(); };
    if (host) $('#start').onclick = async () => {
      Sfx.unlock(); Notif.ask();
      if (s.players.every(p => p.bot)) { toast('At least one human player is needed', true); return; }
      const st = E.newGame(s.opts, s.players.map(p => ({ token: p.pid, name: p.name, bot: p.bot || 0, avatar: p.avatar || 0 })));
      st.players.forEach((p, i) => { p.pid = s.players[i].pid; });
      st.id = s.id; st.host = s.host; st.mode = 'online';
      stamp(st);
      try {
        const r = await app.net.saveGame(app.gameId, st, app.version);
        app.committed = st; app.version = r.version; app.lastLogLen = 0;
        notifyPlayers(st, 'game', { started: true });
        render();
        if (isMine()) announceMyTurn();
        maybeRunBot();
      } catch (e) { toast('Could not start: ' + e.message, true); refresh(); }
    };
  }
  // Modifie la salle d'attente (relecture + verrou optimiste) ; renvoie true si enregistré.
  async function saveLobby(mut) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rec = await app.net.loadGame(app.gameId);
      if (!rec || rec.state.status !== 'lobby') { if (rec) { app.committed = rec.state; app.version = rec.version; render(); } return false; }
      const st = rec.state; mut(st); stamp(st);
      try { const r = await app.net.saveGame(app.gameId, st, rec.version); app.committed = st; app.version = r.version; if (st.status === 'lobby') render(); return true; }
      catch (e) { if (e.code !== 'conflict') { toast('Failed: ' + e.message, true); return false; } }
    }
    return false;
  }
  function confirmBox(title, text, onYes) {
    modal('<h2>' + ic('info', 'h') + esc(title) + '</h2><p>' + esc(text) + '</p><div class="actions"><button class="btn secondary" id="m-no">No</button><button class="btn warn" id="m-yes">Yes</button></div>');
    $('#m-no').onclick = closeModal;
    $('#m-yes').onclick = () => { closeModal(); onYes(); };
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch (e) { prompt('Copy this link:', text); }
  }
  function leaveGame() {
    if (app.unsub) app.unsub();
    if (chat.unsub) chat.unsub();
    clearInterval(app.poll); clearTimeout(app.botTimer);
    app.unsub = null; chat.unsub = null; app.botTimer = null; app.gameId = null; app.committed = null; app.work = null; app.replay = null; app.botRunning = false; app.fast = false;
    chat.msgs = []; chat.lastId = 0; chat.unread = 0; chat.open = false;
    hideBanner();
    history.replaceState(null, '', location.pathname);
    loadHub();
  }

  // ---------- Rendu principal ----------
  function render() {
    const s = app.committed;
    document.body.classList.toggle('in-game', !!s && s.status !== 'lobby');
    if (!s) return renderHome();
    if (s.status === 'lobby') return renderLobby();
    document.body.classList.remove('scenic');
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
  const secTitle = (color, icon, text) => '<span class="pill ' + color + '">' + ic(icon) + text + '</span>';
  // Scène proposée selon l'étape du tour (le joueur peut toujours changer d'onglet)
  function autoStage() {
    const s = view();
    if (!s || s.status !== 'playing' || app.replay) return 'play';
    if (!isMine()) return 'play';
    const cur = s.cur;
    if (cur.slot === null && !s.market.every(m => !m.length)) return 'choose';
    if (!cur.actions.some(a => a.a === 'place') && !cur.cardTaken && E.canTakeCard(s)) return 'choose';
    return 'play';
  }
  function setStage(st, manual) {
    app.stage = st;
    if (manual) app.stageManual = true;
    renderGame();
  }
  function stepOf(s, mine) {
    if (!mine || s.status !== 'playing') return 0;
    const cur = s.cur;
    if (cur.slot === null && !s.market.every(m => !m.length)) return 1;
    if (cur.tokens.length) return 2;
    return 3;
  }
  // Ajuste la taille du plateau à l'espace disponible (sans défilement)
  let fitObserver = null;
  function fitBoard() {
    const box = $('.board-fit'), svg = $('.board-fit .board');
    if (!box || !svg) return;
    const ratio = 10.09 / 8.5; // hauteur / largeur de la viewBox du plateau
    const drawer = $('#drawer');
    const reserved = drawer ? (drawer.classList.contains('open') ? drawer.offsetHeight + 6 : 30) : 0;
    box.style.paddingBottom = reserved + 'px';
    const w = Math.min(box.clientWidth, Math.max(120, box.clientHeight - reserved) / ratio);
    svg.style.width = Math.floor(w) + 'px';
    svg.style.height = Math.floor(w * ratio) + 'px';
  }
  function watchFit() {
    if (fitObserver) fitObserver.disconnect();
    const box = $('.board-fit');
    if (!box || typeof ResizeObserver === 'undefined') return;
    fitObserver = new ResizeObserver(() => fitBoard());
    fitObserver.observe(box);
  }

  function renderGame(anim) {
    anim = anim || {};
    app.screen = 'game';
    document.body.classList.add('in-game');
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
    if (!app.stageManual && !replaying) app.stage = anim.stage || autoStage();
    const stage = app.stage;
    document.title = (mine && s.status === 'playing' ? 'Your turn · ' : '') + 'Harmonies · ' + (s.id || '');
    const scores = s.players.map(p => E.scorePlayer(p, side));
    const step = stepOf(s, mine);
    const curName = esc(E.current(s).name);

    // Message d'état
    let msg, msgIcon = 'hourglass', msgCls = '';
    if (s.status === 'finished') { msg = 'Game over'; msgIcon = 'flag'; }
    else if (replaying) { msg = curName + ' is playing…'; msgIcon = 'film'; }
    else if (mine) {
      const st = E.turnStatus(s);
      msgIcon = 'hand'; msgCls = ' mine';
      if (app.cubeMode) { msg = 'Tap an orange space to place the cube'; msgIcon = 'cube'; }
      else if (step === 1) msg = 'Take a group of 3 tokens';
      else if (step === 2) msg = 'Place your tokens (' + cur.tokens.length + ')';
      else if (!st.ok) msg = st.reasons[0];
      else { msg = 'Card or cube? Otherwise end your turn'; msgIcon = 'check'; }
    } else msg = curName + '\'s turn' + (app.mode === 'online' ? '…' : '');

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
    void placeableIds;
    const canTake = mine && E.canTakeCard(s);

    // ----- barre haute + état -----
    const steps = mine && s.status === 'playing' ? '<span class="steps">' + [['1', 'Tokens'], ['2', 'Place'], ['3', 'Animals']].map(([n, l], i) =>
      '<span class="stp' + (step === i + 1 ? ' cur' : (step > i + 1 ? ' done' : '')) + '"><b>' + (step > i + 1 ? ic('check') : n) + '</b><em>' + l + '</em></span>').join('') + '</span>' : '';
    const connHTML = app.mode === 'online' ? '<span class="conn ' + (app.rtOk ? 'on' : 'off') + '" id="conn" title="live connection"></span>' : '';
    const chatB = chatBtnHTML('hdr');
    const gamesB = '<button class="chat-btn hdr" id="games-btn" title="All games">' + ic('list') + (hub.myTurn ? '<i class="badge-n">' + hub.myTurn + '</i>' : '') + '</button>';
    let html = '<div class="screen game">' +
      (app.headerOpen
        ? '<div class="topbar" id="topbar">' + R.logoSVG('logo-small') + '<span class="code">' + esc(s.id || '') + '</span>' + connHTML + '<span class="spacer"></span>' + gamesB + chatB + '<button class="icon-btn" id="hdr-toggle" title="Collapse">' + ic('minus') + '</button></div>'
        : '<div class="topbar-mini"><button class="mini-main" id="hdr-toggle" title="Show the header"><span class="brand">HARMONIES</span><span class="code">' + esc(s.id || '') + '</span>' + connHTML + '</button>' + gamesB + chatB + '</div>') +
      '<div class="status' + msgCls + '"><button class="icon-btn dark" id="menu" title="Menu">' + ic('menu') + '</button><span class="msg">' + ic(msgIcon, 'inl') + '<span>' + msg + '</span></span>' + steps +
      '<button class="icon-btn dark" id="music" title="Music">' + ic(Sfx.music ? 'music' : 'music-off') + '</button><button class="icon-btn dark" id="sound" title="Sounds">' + ic(Sfx.enabled ? 'sound' : 'mute') + '</button></div>';

    // ----- scène : choisir (jetons + animaux) ou jouer (plateau + cartes) -----
    html += '<div class="stage">';
    if (stage === 'choose') {
      html += '<div class="stage-choose"><div class="choose-market"><div class="stage-head">' + secTitle('blue', 'grid', 'Central board') +
        (mine && step === 1 ? '<span class="hint">take a group</span>' : (mine && cur.slot !== null ? '<span class="hint muted">tokens taken</span>' : '')) +
        '<span class="spacer"></span><span class="pouch-wrap" title="Tokens left in the bag">' + R.pouchSVG(s.bag ? s.bag.length : 0) + '</span></div>' +
        '<div class="market">' + s.market.map((m, i) => {
          const takeable = mine && cur.slot === null && m.length > 0 && !app.cubeMode;
          const arriving = anim.refillSlot === i;
          return '<div class="slot' + (takeable ? ' takeable' : '') + (m.length ? '' : ' empty') + '" data-slot="' + i + '">' + (m.length ? R.slotSVG(m, arriving) : (cur && cur.slot === i ? '<span class="slot-empty">taken</span>' : '')) + '</div>';
        }).join('') + '</div></div>' +
        '<div class="choose-animals"><div class="stage-head">' + secTitle('orange', 'star', 'Animals') +
        '<span class="hint' + (canTake ? '' : ' muted') + '">' + (canTake ? 'you can take one' : (mine && cur.cardTaken ? 'card taken this turn' : (mine ? '4-card limit reached' : 'one per turn, 4 max'))) + '</span>' +
        '<span class="spacer"></span><span class="deck-wrap mini" title="Draw pile">' + R.deckSVG(s.deck.length) + '</span></div>' +
        '<div class="cards-strip compact">' +
        s.display.map((id, i) => {
          if (!id) return '<div class="card empty" data-display="' + i + '"></div>';
          const card = E.CARD_BY_ID.get(id);
          const arriving = anim.newDisplay && anim.newDisplay.includes(i);
          return cardHTML(card, { cls: (canTake ? 'takeable' : '') + (arriving ? ' arriving' : ''), badge: canTake ? 'Take' : '', badgeCls: 'teal', attrs: 'data-display="' + i + '"' });
        }).join('') + '</div></div></div>';
    } else {
      const p2 = viewing;
      const items = [];
      const pcOf = id => (viewingMine ? placeable.find(x => x.id === id) : null);
      if (p2.spiritChoices && viewingMine) items.push('<div class="card tone-sp spirit choose" id="spirit-choose"><div class="head">Spirit</div><div class="art">' + R.hillsSVG(120, 70, ['#f2c94c', '#e8873a', '#d96a8e', '#6b4fa0'], { seed: 99, cls: 'scene' }) + '</div><div class="choose-body">' + ic('sparkles') + 'To choose</div></div>');
      if (p2.spirit) items.push(cardHTML(E.CARD_BY_ID.get(p2.spirit.id), { cls: (pcOf(p2.spirit.id) ? 'placeable' : '') + (p2.spirit.placed ? ' done' : ''), badge: pcOf(p2.spirit.id) ? ic('cube') + 'Place' : (p2.spirit.placed ? ic('check') : ''), badgeCls: p2.spirit.placed ? 'teal' : '', attrs: 'data-mine="1"' }));
      for (const h of p2.hand) items.push(cardHTML(E.CARD_BY_ID.get(h.id), { left: h.left, cls: (pcOf(h.id) ? 'placeable' : '') + (anim.arrivingCard === h.id ? ' arriving' : ''), badge: pcOf(h.id) ? ic('cube') + 'Place' : '', attrs: 'data-mine="1"' }));
      for (const d of p2.done) items.push(cardHTML(E.CARD_BY_ID.get(d.id), { left: 0, cls: 'done', done: true, badge: ic('check'), badgeCls: 'teal', attrs: 'data-mine="1"' }));
      html += '<div class="stage-play"><div class="board-tabs">' + s.players.map((p, i) =>
        '<button data-seat="' + i + '" class="' + (i === app.viewSeat ? 'on' : '') + '" style="--seat:' + SEAT_COLORS[i] + '">' + avatarHTML(p, i, 'xs') + esc(p.name) + (p.bot ? ic('cpu', 'inl') : '') + (i === me && app.mode === 'online' ? ' (you)' : '') + (i === s.turn && s.status === 'playing' ? ic('dice', 'inl') : '') + '<b>' + scores[i].total + '</b></button>').join('') +
        '<span class="spacer"></span><span class="board-info">' + E.emptyCount(p2.board) + ' empty</span></div>' +
        '<div class="board-fit">' + R.boardSVG(p2.board, { legal, targets, last, readonly: !viewingMine, newTop: anim.newTop, newCube: anim.newCube }) + '</div>' +
        cardsBlock();
      // tiroir des cartes possédées : ouvert par défaut, bouton rond central pour l'ouvrir (+) / le fermer (×)
      function cardsBlock() {
        const open = app.cardsOpen !== false;
        return '<div class="drawer' + (open ? ' open' : '') + '" id="drawer"><button class="drawer-toggle" id="drawer-toggle" title="' + (open ? 'Hide the cards' : 'Show the cards') + '">' + ic(open ? 'x' : 'plus') + '</button>' +
          (open ? '<div class="stage-head">' + secTitle('teal', 'layers', viewingMine ? 'Your cards' : esc(p2.name) + '\'s cards') +
            '<span class="hint muted">' + E.activeCount(p2) + '/4' + (p2.done.length ? ' · ' + p2.done.length + ' completed' : '') + '</span><span class="spacer"></span>' +
            '<button class="btn small secondary icon" id="cards-sheet" title="View large">' + ic('layers') + '</button></div>' +
            '<div class="cards-strip compact">' + (items.length ? items.join('') : '<div class="card empty"><div class="empty-text">no cards</div></div>') + '</div>' : '') + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';

    // ----- pied de page : vues | main, puis actions -----
    const handLabel = replaying ? curName + '\'s hand' : 'Hand';
    let handHTML;
    if (s.status === 'finished') handHTML = '<span class="placeholder">Finished</span>';
    else if (replaying) handHTML = cur.tokens.length ? cur.tokens.map((t, i) => '<span class="tok' + (anim.arrivingHand ? ' arriving' : '') + '" data-tok="' + i + '">' + R.tokenSVG(t) + '</span>').join('') : '<span class="placeholder">' + curName + ' is playing…</span>';
    else if (!mine) handHTML = '<span class="placeholder">' + (app.mode === 'online' ? 'Waiting for ' + curName : curName + '\'s turn') + '</span>';
    else if (cur.slot === null && cur.tokens.length === 0) handHTML = '<span class="placeholder">' + (s.market.every(m => !m.length) ? 'no tokens left' : '3 tokens to take') + '</span>';
    else if (cur.tokens.length === 0) handHTML = '<span class="placeholder ok">' + ic('check', 'inl') + 'placed</span>';
    else handHTML = cur.tokens.map((t, i) => {
      const dead = !E.legalCells(E.current(s).board, t).length;
      return '<button class="tok' + (i === app.selToken ? ' sel' : '') + (dead ? ' dead' : '') + (anim.arrivingHand ? ' arriving' : '') + '" data-tok="' + i + '" title="' + E.COLOR_NAMES[t] + '">' + R.tokenSVG(t) + '</button>';
    }).join('');
    const myCount = E.activeCount(s.players[me >= 0 ? me : s.turn]);
    const folded = stage === 'play';
    const tabsHTML = '<div class="view-tabs">' +
      '<button data-stage="choose" class="' + (stage === 'choose' ? 'on' : '') + '" title="Tokens and animals">' + ic('grid') + '<span>Choose</span>' + (mine && (step === 1 || (step === 3 && canTake)) ? '<i class="dotb"></i>' : '') + '</button>' +
      '<button data-stage="play" class="' + (stage === 'play' ? 'on' : '') + '" title="Board and cards">' + ic('layers') + '<span>Board</span>' + (mine && (step === 2 || app.cubeMode || placeable.length) ? '<i class="dotb"></i>' : '') + '<em class="cnt">' + myCount + '</em></button>' +
      '</div>';
    let actionsHTML = '';
    if (s.status === 'finished') actionsHTML = '<button class="btn primary" id="results">' + ic('trophy') + '<span class="lbl">Results</span></button>';
    else if (replaying) actionsHTML = folded ? '' : '<span class="placeholder">' + ic('film', 'inl') + 'Replaying the turn…</span>';
    else if (!mine) {
      const nxt = app.mode === 'online' ? nextMyTurnGame() : null;
      actionsHTML = (nxt ? '<button class="btn primary small" id="next-game">' + ic('play') + 'Your turn vs ' + esc(othersOf(nxt).map(p => p.name).join(', ') || '?') + '</button>' : (folded ? '' : '<span class="placeholder">' + ic('hourglass', 'inl') + 'You play after ' + curName + '</span>')) +
        (app.mode === 'online' ? '<button class="btn secondary icon" id="reload" title="Refresh">' + ic('refresh') + '</button>' : '');
    }
    else {
      const st = E.turnStatus(s);
      actionsHTML = '<button class="btn secondary' + (folded ? ' icon' : '') + '" id="undo" ' + (app.undo.length ? '' : 'disabled') + ' title="Undo">' + ic('undo') + '<span class="lbl">Undo</span></button>' +
        (st.ok ? '<button class="btn primary ready" id="end" title="End turn">' + (folded ? ic('flag') : '') + '<span class="lbl">' + (folded ? 'End' : 'End turn') + '</span></button>' : '');
    }
    if (folded) {
      html += '<div class="footer folded"><div class="foot-row">' + tabsHTML + '<div class="foot-hand"><div class="tokens">' + handHTML + '</div></div><div class="foot-actions">' + actionsHTML + '</div></div>';
    } else {
      html += '<div class="footer"><div class="foot-row">' + tabsHTML + '<div class="foot-hand"><div class="foot-lbl">' + handLabel + '</div><div class="tokens">' + handHTML + '</div></div></div>' +
        '<div class="foot-actions">' + actionsHTML + '</div>';
    }
    html += '</div></div></div>';
    $('#app').innerHTML = html;
    if (stage === 'play') { fitBoard(); watchFit(); }
    bindGame(s, mine, viewingMine, placeable);
    if (replaying) mountBanner();

    if (replaying) { /* bannière gérée par le rejeu */ }
    else if (mine && app.cubeMode) showBanner('Place the cube ' + miniAnimal(app.cubeMode.id) + ' ' + esc(E.CARD_BY_ID.get(app.cubeMode.id).en) + ': tap an orange space', () => { app.cubeMode = null; renderGame(); }, 'Cancel');
    else if (mine && stage === 'play' && app.selToken !== null && cur.tokens[app.selToken] !== undefined && !E.legalCells(E.current(s).board, cur.tokens[app.selToken]).length) {
      showBanner('No possible space for this token', () => { const sel = app.selToken; if (act(w => E.discardToken(w, sel))) Sfx.undo(); app.selToken = app.work.cur.tokens.length ? 0 : null; renderGame(); }, 'Discard');
    } else hideBanner();

    if (mine && E.current(s).spiritChoices && !app.spiritPrompted && !app.cubeMode) { app.spiritPrompted = true; showSpiritChoice(); }
    if (s.status === 'finished' && !app.endShown && !replaying) { app.endShown = true; showResults(); }
  }

  function bindGame(s, mine, viewingMine, placeable) {
    $('#menu').onclick = showMenu;
    $('#sound').onclick = () => { const on = Sfx.toggle(); $('#sound').innerHTML = ic(on ? 'sound' : 'mute'); toast(on ? 'Sounds on' : 'Sounds off'); };
    $('#music').onclick = () => { const on = Sfx.toggleMusic(); $('#music').innerHTML = ic(on ? 'music' : 'music-off'); toast(on ? 'Ambient music on' : 'Music off'); };
    $('#hdr-toggle').onclick = () => { app.headerOpen = !app.headerOpen; renderGame(); };
    const cb = $('#chat-btn'); if (cb) cb.onclick = openChat;
    const gb = $('#games-btn'); if (gb) gb.onclick = goHome;
    const ng = $('#next-game'); if (ng) ng.onclick = () => { const nxt = nextMyTurnGame(); if (nxt) { leaveGame(); openOnline(nxt.id); } };
    $$('.view-tabs button').forEach(b => { b.onclick = () => { if (app.replay) return; setStage(b.dataset.stage, true); }; });
    $$('.board-tabs button').forEach(b => { b.onclick = () => { const seat = +b.dataset.seat; if (app.viewSeat === seat) showScores(); else { app.viewSeat = seat; renderGame(); } }; });
    const reload = $('#reload'); if (reload) reload.onclick = () => { refresh(); loadChat(false); toast('Refreshing…'); };
    const results = $('#results'); if (results) results.onclick = showResults;
    const cs = $('#cards-sheet'); if (cs) cs.onclick = () => showCardsSheet(app.viewSeat, mine, viewingMine, placeable);
    const dt = $('#drawer-toggle'); if (dt) dt.onclick = () => { app.cardsOpen = app.cardsOpen === false; ls.set('harmonies.cardsOpen', app.cardsOpen); renderGame(); };
    $$('.stage .card[data-mine]').forEach(c => {
      c.onclick = ev => {
        const id = +c.dataset.card;
        const card = E.CARD_BY_ID.get(id);
        const pc = mine && viewingMine && !app.busy ? placeable.find(x => x.id === id) : null;
        if (pc && ev.target.closest('.badge')) { startCube(pc); return; }
        cardDetail(card, pc ? '<button class="btn warn block" id="m-cube">' + ic('cube') + 'Place a cube</button>' : '');
        const b = $('#m-cube'); if (b) b.onclick = () => { closeModal(); startCube(pc); };
      };
    });
    const sp = $('#spirit-choose'); if (sp) sp.onclick = ev => { ev.stopPropagation(); showSpiritChoice(); };
    // cartes disponibles : détail toujours consultable
    $$('.card[data-display]').forEach(c => {
      if (!c.dataset.card) return;
      c.onclick = ev => {
        const card = E.CARD_BY_ID.get(+c.dataset.card);
        const canTake = mine && !app.busy && E.canTakeCard(app.work);
        if (ev.target.closest('.badge') && canTake) { interactiveCard(+c.dataset.display); return; }
        cardDetail(card, canTake ? '<button class="btn primary block" id="m-take">Take this card</button>' : (mine ? '<p class="note">' + (app.work.cur.cardTaken ? 'You already took a card this turn.' : 'You already have 4 cards in progress.') + '</p>' : ''));
        const b = $('#m-take'); if (b) b.onclick = () => { closeModal(); interactiveCard(+c.dataset.display); };
      };
    });
    function startCube(pc) {
      closeModal();
      if (pc.targets.length === 1) { interactiveCube(pc.id, pc.targets[0]); return; }
      app.cubeMode = { id: pc.id, targets: new Set(pc.targets) };
      setStage('play', true);
    }
    bindGame.startCube = startCube;
    if (!mine) return;
    $$('.slot.takeable').forEach(sl => { sl.onclick = () => { if (app.busy) return; Sfx.unlock(); interactiveTake(+sl.dataset.slot); }; });
    $$('.tok').forEach(b => { b.onclick = () => { if (app.busy) return; app.selToken = +b.dataset.tok; app.cubeMode = null; app.stage = 'play'; renderGame(); }; });
    const board = $('.board');
    if (board && viewingMine) {
      board.addEventListener('click', ev => {
        if (app.busy) return;
        const hex = ev.target.closest('.hex'); if (!hex) return;
        const idx = +hex.dataset.idx;
        const w = app.work;
        if (app.cubeMode) {
          if (!app.cubeMode.targets.has(idx)) { toast('This space does not fit that habitat', true); return; }
          interactiveCube(app.cubeMode.id, idx);
          return;
        }
        if (app.selToken === null || w.cur.tokens[app.selToken] === undefined) {
          if (w.cur.slot === null) toast('Take 3 tokens first (Choose view)', true);
          return;
        }
        const color = w.cur.tokens[app.selToken];
        if (!E.canPlace(w.players[w.turn].board[idx], color)) { toast('Cannot place here (' + E.COLOR_NAMES[color] + ')', true); return; }
        interactivePlace(app.selToken, idx);
      });
    }
    const undo = $('#undo'); if (undo) undo.onclick = () => {
      if (!app.undo.length || app.busy) return;
      app.work = app.undo.pop();
      app.selToken = app.work.cur.tokens.length ? 0 : null; app.cubeMode = null; app.stageManual = false;
      saveDraft(); Sfx.undo(); renderGame();
    };
    const end = $('#end'); if (end) end.onclick = endTurn;
  }

  // Volet « cartes en grand » (siège affiché)
  function showCardsSheet(seat, mine, viewingMine, placeable) {
    const s = view();
    const p = s.players[seat];
    const items = [];
    if (p.spiritChoices && viewingMine) items.push('<div class="card tone-sp spirit choose" data-choose-spirit="1"><div class="head">Nature\'s Spirit</div><div class="art">' + R.hillsSVG(120, 70, ['#f2c94c', '#e8873a', '#d96a8e', '#6b4fa0'], { seed: 99, cls: 'scene' }) + '</div><div class="choose-body">' + ic('sparkles') + 'Choose your Spirit</div><div class="foot">2 cards to reveal</div></div>');
    const pcOf = id => (mine && viewingMine ? placeable.find(x => x.id === id) : null);
    if (p.spirit) items.push(cardHTML(E.CARD_BY_ID.get(p.spirit.id), { cls: (pcOf(p.spirit.id) ? 'placeable' : '') + (p.spirit.placed ? ' done' : ''), badge: pcOf(p.spirit.id) ? ic('cube') + 'Place' : (p.spirit.placed ? ic('check') + 'placed' : ''), badgeCls: p.spirit.placed ? 'teal' : '', attrs: 'data-mine="1"' }));
    for (const h of p.hand) items.push(cardHTML(E.CARD_BY_ID.get(h.id), { left: h.left, cls: pcOf(h.id) ? 'placeable' : '', badge: pcOf(h.id) ? ic('cube') + 'Place' : '', attrs: 'data-mine="1"' }));
    for (const d of p.done) items.push(cardHTML(E.CARD_BY_ID.get(d.id), { left: 0, cls: 'done', done: true, badge: ic('check'), badgeCls: 'teal', attrs: 'data-mine="1"' }));
    modal('<h2>' + ic('layers', 'h') + (viewingMine ? 'Your cards' : esc(p.name) + '\'s cards') + ' <span class="note">· ' + E.activeCount(p) + '/4 in progress' + (p.done.length ? ' · ' + p.done.length + ' completed' : '') + '</span></h2>' +
      (items.length ? '<div class="cards-grid">' + items.join('') + '</div>' : '<p class="note">No cards yet. Take some from the Animals row (one per turn).</p>') +
      '<div class="actions">' + (mine && E.canTakeCard(s) ? '<button class="btn secondary" id="m-animals">' + ic('star') + 'See the animals</button>' : '') + '<button class="btn secondary" id="m-close">Close</button></div>', { cls: 'sheet' });
    $('#m-close').onclick = closeModal;
    const ma = $('#m-animals'); if (ma) ma.onclick = () => { closeModal(); setStage('choose', true); };
    const cs = $('[data-choose-spirit]'); if (cs) cs.onclick = () => { closeModal(); showSpiritChoice(); };
    $$('#modal .card[data-mine]').forEach(c => {
      c.onclick = ev => {
        const id = +c.dataset.card;
        const card = E.CARD_BY_ID.get(id);
        const pc = pcOf(id);
        if (pc && ev.target.closest('.badge')) { bindGame.startCube(pc); return; }
        cardDetail(card, pc ? '<button class="btn warn block" id="m-cube">' + ic('cube') + 'Place a cube</button>' : '');
        const b = $('#m-cube'); if (b) b.onclick = () => { closeModal(); bindGame.startCube(pc); };
      };
    });
  }

  // ---------- Actions animées (partagées entre le joueur actif et le rejeu) ----------
  async function animatedTake(state, slot) {
    const from = $$('.slot[data-slot="' + slot + '"] .disc').map(rectOf);
    const colors = state.market[slot].slice();
    E.takeTokens(state, slot);
    if (state === app.work) { app.selToken = 0; app.stageManual = false; app.stage = autoStage(); }
    renderGame({ arrivingHand: true });
    Sfx.take();
    const toks = $$('.footer .tok');
    await Promise.all(toks.map((t, i) => fly(from[i] || from[0], rectOf(t), R.tokenSVG(colors[i]), { duration: 460 + i * 70, arc: -40 }).then(() => reveal(t, 'pop'))));
  }
  async function animatedPlace(state, handIdx, cellIdx) {
    const from = rectOf($('.footer .tok[data-tok="' + handIdx + '"]'));
    const color = state.cur.tokens[handIdx];
    E.placeToken(state, handIdx, cellIdx);
    if (state === app.work) app.selToken = state.cur.tokens.length ? Math.min(handIdx, state.cur.tokens.length - 1) : null;
    app.stage = 'play';
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
    app.stage = 'choose';
    renderGame({ stage: 'choose' });
    Sfx.card();
    const target = $('.view-tabs button[data-stage="play"]');
    await fly(from, rectOf(target), '<div class="ghost-card" style="border-color:' + R.cubeColorOf(card) + '">' + R.animalSVG(card.id) + '</div>', { duration: 560, arc: -30 });
    if (target) { target.classList.add('pop'); setTimeout(() => target.classList.remove('pop'), 700); }
  }
  async function animatedCube(state, cardId, cellIdx) {
    const steps = $$('.stage .card[data-mine][data-card="' + cardId + '"] .track .step.cube');
    const from = rectOf(steps.length ? steps[0] : $('.stage .card[data-mine][data-card="' + cardId + '"]'));
    const spirit = E.CARD_BY_ID.get(cardId).spirit;
    E.placeCube(state, cardId, cellIdx);
    app.stage = 'play';
    renderGame({ newCube: cellIdx });
    const target = $('.board .stack[data-cell="' + cellIdx + '"] .cube.arriving');
    await fly(from, rectOf(target), '<div class="ghost-cube' + (spirit ? ' spirit' : '') + '"></div>', { duration: 480, arc: -60 });
    reveal(target, 'bounce');
    Sfx.cube(); vibrate(20);
  }
  // Recharge de fin de tour (vue « choisir ») : sac → plateau central, puis pioche → animaux
  async function animateRefill(slot, displayIdxs) {
    const hasSlot = slot !== undefined && slot !== null;
    if (!hasSlot && !(displayIdxs && displayIdxs.length)) return;
    app.stage = 'choose';
    renderGame({ refillSlot: hasSlot ? slot : undefined, newDisplay: displayIdxs, stage: 'choose' });
    await wait(250);
    if (hasSlot) {
      const pouch = rectOf($('.pouch-wrap'));
      const discs = $$('.slot[data-slot="' + slot + '"] .disc.arriving');
      const colors = view().market[slot] || [];
      if (discs.length) Sfx.draw();
      await Promise.all(discs.map((d, i) => wait(i * 90).then(() => fly(pouch, rectOf(d), R.tokenSVG(colors[i]), { duration: 520, arc: -40 })).then(() => reveal(d, 'drop'))));
      await wait(200);
    }
    if (displayIdxs && displayIdxs.length) {
      const deck = rectOf($('.deck-wrap'));
      await Promise.all(displayIdxs.map((i, k) => {
        const target = $('.card.arriving[data-display="' + i + '"]');
        if (!target) return Promise.resolve();
        return wait(k * 120).then(() => { Sfx.card(); return fly(deck, rectOf(target), '<div class="ghost-card back"></div>', { duration: 560, arc: -20 }); }).then(() => reveal(target, 'flip'));
      }));
    }
    await wait(450);
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
      if (after !== before) floatText($('.board-tabs button[data-seat="' + seat + '"] b') || $('.status .msg'), (after > before ? '+' : '') + (after - before), after > before ? 'up' : 'down');
    } catch (e) {
      app.work = snap; toast(e.message, true);
    } finally {
      app.busy = false;
      renderGame();
    }
  }
  function interactiveTake(slot) { withAnim(() => animatedTake(app.work, slot)); }
  function interactivePlace(handIdx, cellIdx) {
    withAnim(() => animatedPlace(app.work, handIdx, cellIdx)).then(() => {
      if (!app.work) return;
      const now = E.placeableCubes(app.work);
      if (now.length && app.work.cur.tokens.length === 0) toast('Habitat built: ' + now.map(x => miniAnimal(x.id) + ' ' + esc(E.CARD_BY_ID.get(x.id).en)).join(', ') + ' → tap the card to place the cube');
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
    const btn = $('#end'); if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    app.busy = true;
    if (app.mode === 'online') stamp(w);
    try {
      const r = await app.net.saveGame(app.gameId, w, app.version);
      app.committed = w; app.version = r.version; app.work = null; app.undo = []; app.selToken = null; app.cubeMode = null; app.spiritPrompted = false; app.stageManual = false;
      app.lastLogLen = w.log.length;
      ls.del('harmonies.draft.' + app.gameId);
      app.busy = false;
      notifyNextTurn(w);
      if (app.mode === 'online') updateHub();
      const newDisplay = [];
      w.display.forEach((id, i) => { if (id && prevDisplay[i] !== id) newDisplay.push(i); });
      if (w.status === 'finished') { render(); loadHub(); return; }
      if (app.mode === 'local') app.viewSeat = w.turn;
      await animateRefill(slot, newDisplay);
      app.stage = autoStage();
      if (app.mode === 'local' && !E.current(w).bot) {
        renderGame();
        const nx = E.current(w);
        modal('<h2>' + ic('phone', 'h') + esc(nx.name) + '\'s turn</h2><div class="pass-phone">' + avatarHTML(nx, w.turn, 'big') + '<p>Pass the phone to ' + esc(nx.name) + '.</p></div><div class="actions"><button class="btn primary" id="m-ok">Let\'s go</button></div>', { sticky: true });
        $('#m-ok').onclick = () => { closeModal(); render(); announceMyTurn(); };
      } else { render(); maybeRunBot(); }
    } catch (e) {
      app.busy = false;
      if (e.code === 'conflict') { toast('The game changed in the meantime, reloading…', true); app.work = null; await refresh(); render(); }
      else { toast('Could not send: ' + e.message + ' — try again', true); renderGame(); }
    }
  }

  // ---------- Modales de jeu ----------
  function showSpiritChoice() {
    if (!app.work) return;
    const p = E.current(app.work);
    if (!p.spiritChoices) return;
    modal('<h2>' + ic('sparkles', 'h') + 'Choose your Nature\'s Spirit</h2><p class="note">Only one card is kept, the other goes back to the box. It counts towards your 4-card limit until its cube is placed.</p>' +
      '<div class="choice-grid">' + p.spiritChoices.map(id => cardHTML(E.CARD_BY_ID.get(id), { attrs: 'data-choose="' + id + '"' })).join('') + '</div>' +
      '<div class="actions"><button class="btn secondary" id="m-later">Later</button></div>');
    $('#m-later').onclick = closeModal;
    $$('[data-choose]').forEach(c => { c.onclick = () => { const id = +c.dataset.choose; closeModal(); if (act(w => E.chooseSpirit(w, id))) { Sfx.card(); toast('Spirit chosen: ' + esc(E.CARD_BY_ID.get(id).en)); } renderGame(); }; });
  }
  function scoreTable(s) {
    const rows = [['trees', miniTok(4) + 'Trees'], ['mountains', miniTok(2) + 'Mountains'], ['fields', miniTok(5) + 'Fields'], ['buildings', miniTok(6) + 'Buildings'], ['water', miniTok(1) + (s.opts.side === 'B' ? 'Islands' : 'River')], ['animals', '<span class="mcube"></span>Animals'], ['spirit', ic('sparkles', 'inl') + 'Spirit']];
    const scores = s.players.map(p => E.scorePlayer(p, s.opts.side));
    return '<table class="scores"><tr><th></th>' + s.players.map((p, i) => '<th style="color:' + SEAT_COLORS[i] + '"><span class="th-player">' + avatarHTML(p, i, 'sm') + esc(p.name) + '</span></th>').join('') + '</tr>' +
      rows.filter(([k]) => k !== 'spirit' || s.opts.spirits).map(([k, label]) => '<tr><td>' + label + '</td>' + scores.map(sc => '<td>' + sc[k] + '</td>').join('') + '</tr>').join('') +
      '<tr class="total"><td>Total</td>' + scores.map(sc => '<td>' + sc.total + '</td>').join('') + '</tr>' +
      '<tr><td class="note">cubes placed</td>' + s.players.map(p => '<td class="note">' + p.cubes + '</td>').join('') + '</tr></table>';
  }
  function showScores() {
    const s = view();
    modal('<h2>' + ic('chart', 'h') + 'Live score</h2>' + scoreTable(s) + '<p class="note">Estimate based on the current boards (' + esc(SIDE_LABEL[s.opts.side]) + ').</p><div class="actions"><button class="btn secondary" id="m-close">Close</button></div>');
    $('#m-close').onclick = closeModal;
  }
  function showResults() {
    const s = app.committed;
    if (!s.result) return;
    const winners = s.result.winners;
    const iWon = app.mode === 'local' || winners.includes(mySeat());
    const reason = s.endReason === 'bag' ? 'the bag was empty' : 'a board had 2 empty spaces or fewer';
    modal('<h2>' + ic('flag', 'h') + 'Game over</h2><div class="winner">' + ic('trophy', 'big') + '<div class="winner-row">' + winners.map(i => avatarHTML(s.players[i], i, 'md')).join('') + '</div>' +
      (winners.length > 1 ? 'Tie: ' + esc(winners.map(i => s.players[i].name).join(' & ')) : (winners.length ? esc(s.players[winners[0]].name) + ' wins!' : 'Game over')) + '</div>' +
      scoreTable(s) + '<p class="note">' + (s.endReason === 'resign' ? esc(s.players[s.resigned].name) + ' gave up.' : 'The end was triggered because ' + reason + '. Ties are broken by the number of cubes placed.') + '</p>' +
      '<div class="actions"><button class="btn secondary" id="m-close">See the boards</button><button class="btn primary" id="m-again">' + ic('refresh') + 'Rematch</button></div>' +
      (app.mode === 'online' ? '<button class="btn ghost block" id="m-games" style="margin-top:8px">' + ic('list') + 'All games' + (hub.myTurn ? ' · your turn in ' + hub.myTurn : '') + '</button>' : ''));
    $('#m-close').onclick = closeModal;
    $('#m-again').onclick = rematch;
    const mg = $('#m-games'); if (mg) mg.onclick = () => { closeModal(); goHome(); };
    if (iWon) { confetti(); Sfx.win(); } else Sfx.lose();
  }
  async function rematch() {
    const s = app.committed;
    closeModal();
    if (app.mode === 'local') { startLocal(s.opts, s.players.map(p => ({ name: p.name, bot: p.bot || 0, avatar: p.avatar || 0 }))); return; }
    if (s.rematch) { openOnline(s.rematch); return; }
    // revanche directe : mêmes joueurs (moi en hôte), la partie commence tout de suite et les autres sont prévenus
    const me = s.players.find(p => p.pid === myPid());
    if (!me) { toast('Only a player of this game can start a rematch', true); return; }
    const seats = s.players.filter(p => p !== me).map(p => (p.bot ? { bot: p.bot, name: p.name, avatar: p.avatar || 0 } : { pid: p.pid, name: p.name, avatar: p.avatar || 0 }));
    const oldId = app.gameId, oldVersion = app.version, old = E.clone(s);
    try {
      const id = await createOnline(s.opts, me.name, seats, true);
      old.rematch = id;
      try { await app.net.saveGame(oldId, old, oldVersion); } catch (e) { /* peu importe */ }
    } catch (e) { toast('Rematch failed: ' + e.message, true); }
  }
  function showMenu() {
    const s = app.committed;
    const link = location.origin + location.pathname + '?g=' + (s.id || '');
    modal('<h2>' + ic('menu', 'h') + 'Menu</h2><ul class="menu">' +
      (chatAvailable() ? '<li id="mn-chat">' + ic('chat') + 'Chat' + (chat.unread ? ' <span class="badge-n inl">' + chat.unread + '</span>' : '') + '</li>' : '') +
      (app.mode === 'online' ? '<li id="mn-share">' + ic('share') + 'Share the game link</li>' : '') +
      '<li id="mn-scores">' + ic('chart') + 'Detailed score</li><li id="mn-journal">' + ic('scroll') + 'Game log</li><li id="mn-rules">' + ic('book') + 'Rules and legend</li>' +
      (app.mode === 'online' ? '<li id="mn-players">' + ic('user-plus') + 'Players & friends</li>' : '') +
      (app.mode === 'online' && s.status === 'playing' && mySeat() < 0 ? '<li id="mn-claim">' + ic('users') + 'I am one of the players (take my seat back)</li>' : '') +
      (app.mode === 'online' ? '<li id="mn-reload">' + ic('refresh') + 'Reload the game</li>' : '') +
      (app.mode === 'online' && s.status === 'playing' && mySeat() >= 0 ? '<li id="mn-leave" class="danger">' + ic('flag') + ((s.log || []).length ? 'Give up this game' : 'Cancel this game') + '</li>' : '') +
      '<li id="mn-home">' + ic('list') + (app.mode === 'online' ? 'All games' + (hub.myTurn ? ' <span class="badge-n inl">' + hub.myTurn + '</span>' : '') : 'Back to home') + '</li></ul>' +
      '<p class="note">' + (app.mode === 'online' ? 'Online game · code ' + esc(s.id) + ' · ' : 'Local game · ') + esc(SIDE_LABEL[s.opts.side]) + (s.opts.spirits ? ' · Spirits' : '') + '</p>' +
      '<div class="actions"><button class="btn secondary" id="m-close">Close</button></div>');
    $('#m-close').onclick = closeModal;
    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
    on('#mn-chat', () => { closeModal(); openChat(); });
    on('#mn-share', async () => { closeModal(); if (navigator.share) { try { await navigator.share({ title: 'Harmonies', text: 'Our Harmonies game (code ' + s.id + ')', url: link }); } catch (e) { /* annulé */ } } else { await copyText(link); toast('Link copied'); } });
    on('#mn-scores', () => { closeModal(); showScores(); });
    on('#mn-journal', () => { closeModal(); showJournal(); });
    on('#mn-rules', () => { closeModal(); showRules(); });
    on('#mn-reload', () => { closeModal(); app.version = 0; refresh(); });
    on('#mn-home', () => { closeModal(); goHome(); });
    on('#mn-players', () => { closeModal(); showPlayers(); });
    on('#mn-leave', () => {
      closeModal();
      const played = (s.log || []).length > 0;
      confirmBox(played ? 'Give up this game?' : 'Cancel this game?', played ? 'The game ends now and the other players win.' : 'Nobody has played yet: the game is cancelled for everyone.', async () => {
        const st = E.clone(app.committed);
        if (played) E.resign(st, mySeat()); else { st.status = 'cancelled'; st.cancelledBy = mySeat(); st.cur = null; }
        stamp(st);
        try {
          const r = await app.net.saveGame(app.gameId, st, app.version);
          app.committed = st; app.version = r.version; app.work = null; ls.del('harmonies.draft.' + app.gameId);
          notifyPlayers(st, 'finished', { cancelled: !played, resigned: played });
          if (played) { app.endShown = true; render(); showResults(); } else goHome();
        } catch (e) { toast('Failed: ' + e.message, true); refresh(); }
      });
    });
    on('#mn-claim', () => {
      closeModal();
      modal('<h2>' + ic('users', 'h') + 'Who are you?</h2><p class="note">This device is not linked to any player of this game (new phone, cleared data…).</p><ul class="menu">' +
        s.players.map((p, i) => '<li data-seat="' + i + '">' + avatarHTML(p, i, 'sm') + esc(p.name) + '</li>').join('') + '</ul><div class="actions"><button class="btn secondary" id="m-close">Cancel</button></div>');
      $('#m-close').onclick = closeModal;
      $$('.menu li[data-seat]').forEach(li => { li.onclick = async () => {
        const st = E.clone(app.committed); st.players[+li.dataset.seat].pid = myPid(); stamp(st);
        try { const r = await app.net.saveGame(app.gameId, st, app.version); app.committed = st; app.version = r.version; app.work = null; closeModal(); render(); toast('Welcome back, ' + esc(st.players[+li.dataset.seat].name)); }
        catch (e) { toast('Failed: ' + e.message, true); refresh(); }
      }; });
    });
  }
  // Joueurs de la partie : ajouter comme ami en un geste
  function showPlayers() {
    const s = app.committed;
    const friendOf = pid => hub.friends.some(f => f.pid === pid);
    modal('<h2>' + ic('users', 'h') + 'Players</h2><ul class="players-list">' + s.players.map((p, i) => '<li>' + avatarHTML(p, i, 'md') + '<b>' + esc(p.name) + '</b>' + (p.bot ? ' <span class="note">· ' + BOT_LABEL[p.bot] + '</span>' : '') + (p.pid === myPid() ? ' <span class="note">· you</span>' : '') + '<span class="spacer"></span>' +
      (!p.bot && p.pid !== myPid() ? (friendOf(p.pid) ? '<span class="note ok">' + ic('check', 'inl') + 'Friend</span>' : (acct.me ? '<button class="btn small secondary" data-befriend="' + esc(p.pid) + '">' + ic('user-plus') + 'Add friend</button>' : '')) : '') + '</li>').join('') + '</ul>' +
      (acct.me ? '<p class="note">Friends can be challenged from the home screen without any game code.</p>' : '<p class="note">Enter your name on the home screen to add friends.</p>') +
      '<div class="actions"><button class="btn secondary" id="m-close">Close</button></div>');
    $('#m-close').onclick = closeModal;
    $$('#modal [data-befriend]').forEach(b => { b.onclick = async () => { b.disabled = true; if (await addFriend(null, b.dataset.befriend)) showPlayers(); else b.disabled = false; }; });
  }
  function showJournal() {
    const s = view();
    const log = (s.log || []).slice().reverse();
    modal('<h2>' + ic('scroll', 'h') + 'Game log</h2><ul class="log">' + (log.length ? log.map(l =>
      '<li><span class="turnno">T' + l.n + '</span>' + avatarHTML(s.players[l.p], l.p, 'xs') + '<b>' + esc(s.players[l.p].name) + '</b><span class="acts">' + (actionsHTML(l.actions) || '—') + '</span></li>').join('') : '<li>Game start.</li>') + '</ul>' +
      '<div class="actions"><button class="btn secondary" id="m-close">Close</button></div>', { cls: 'sheet' });
    $('#m-close').onclick = closeModal;
  }
  function showRules() {
    const tok = c => R.tokenSVG(c);
    modal('<h2>' + ic('book', 'h') + 'Essential rules</h2><div class="rules">' +
      '<p><b>Your turn</b> — mandatory: take the 3 tokens of one slot of the central board and place them. Optional (at any time, even between two tokens): take 1 Animal card (one per turn, max 4 cards in progress) and place cubes (no limit).</p>' +
      '<p><b>Stacking</b> — blue and yellow: only on the ground, nothing on top. Gray: on the ground or on gray (max 3). Brown: on the ground or on 1 brown. Green: on the ground (bush) or on 1 or 2 browns (tree). Red: on the ground or on 1 gray / brown / red (building). Never on a space holding a cube.</p>' +
      '<div class="legend">' +
      '<div>' + tok(4) + ' Tree: 1 / 3 / 7 pts (height 1, 2, 3)</div>' +
      '<div>' + tok(2) + ' Mountain: 1 / 3 / 7 pts, if next to another mountain</div>' +
      '<div>' + tok(5) + ' Field: 5 pts per group of at least 2 yellows</div>' +
      '<div>' + tok(6) + ' Building: 5 pts if surrounded by 3 different colors</div>' +
      '<div>' + tok(1) + ' Side A · river: 2 / 5 / 8 / 11 / 15 (+4 per token beyond 6), best river only</div>' +
      '<div>' + tok(1) + ' Side B · islands: 5 pts per group of spaces separated by water</div>' +
      '</div>' +
      '<p><b>Cubes</b> — the card pattern must be reproduced exactly (heights included), in any orientation. The cube goes on the indicated space, which must be free of cubes. A token can serve several habitats; a placed cube is final and blocks its space. When a card has no cube left, it is completed and no longer counts towards the 4-card limit.</p>' +
      '<p><b>Card points</b> — the column on the right of a card is revealed from bottom to top with each cube placed; the card is worth the last revealed step (0 if no cube placed).</p>' +
      '<p><b>End</b> — when the bag is empty at refill time, or when a player has 2 empty spaces or fewer: the round is completed. Tie: most cubes placed.</p>' +
      '</div><div class="actions"><button class="btn secondary" id="m-close">Close</button></div>');
    $('#m-close').onclick = closeModal;
  }

  // ---------- Chat (parties en ligne) : messages persistants, bulle éphémère sur l'écran des autres joueurs ----------
  function chatAvailable() { return app.mode === 'online' && !!(app.net && app.net.chat) && !!app.gameId; }
  async function loadChat(initial) {
    if (!chatAvailable()) return;
    try {
      const rows = await app.net.loadChat(app.gameId, initial ? 0 : chat.lastId);
      rows.forEach(r => addChatMsg(r, !initial));
    } catch (e) { /* hors ligne : on réessaiera au prochain rafraîchissement */ }
  }
  function addChatMsg(m, notify) {
    if (!m || typeof m.id !== 'number' || chat.msgs.some(x => x.id === m.id)) return false;
    chat.msgs.push(m);
    chat.msgs.sort((a, b) => a.id - b.id);
    if (chat.msgs.length > 200) chat.msgs.splice(0, chat.msgs.length - 200);
    chat.lastId = Math.max(chat.lastId, m.id);
    const mine = m.pid === myPid();
    if (chat.open) renderChatList();
    else if (!mine && notify) { chat.unread++; updateChatBadge(); chatPop(m); Sfx.chat(); vibrate(15); Notif.show(m.name, m.text, 'chat'); }
    return true;
  }
  function chatPop(m) {
    let host = $('#chat-pops');
    if (!host) { host = document.createElement('div'); host.id = 'chat-pops'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'chat-pop';
    el.innerHTML = avatarHTML(m, seatOfPid(m.pid), 'sm') + '<div class="cp-body"><b>' + esc(m.name) + '</b><span>' + esc(m.text) + '</span></div>' + ic('chat', 'cp-ic');
    el.onclick = () => { el.remove(); openChat(); };
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 5600);
  }
  function updateChatBadge() {
    $$('.chat-btn').forEach(b => {
      let badge = b.querySelector('.badge-n');
      if (chat.unread) { if (!badge) { badge = document.createElement('i'); badge.className = 'badge-n'; b.appendChild(badge); } badge.textContent = chat.unread; }
      else if (badge) badge.remove();
    });
  }
  const timeOf = iso => { try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  function renderChatList() {
    const list = $('#chat-list'); if (!list) return;
    const me = myPid();
    list.innerHTML = chat.msgs.length ? chat.msgs.map(m => '<div class="cmsg' + (m.pid === me ? ' mine' : '') + '">' + avatarHTML(m, seatOfPid(m.pid), 'sm') +
      '<div class="cbubble"><div class="cmeta"><b>' + esc(m.name) + '</b><span>' + timeOf(m.created_at) + '</span></div><div class="ctext">' + esc(m.text) + '</div></div></div>').join('') :
      '<p class="note center">No messages yet. Say hi!</p>';
    list.scrollTop = list.scrollHeight;
  }
  function openChat() {
    if (!chatAvailable()) return;
    chat.open = true; chat.unread = 0; updateChatBadge();
    modal('<h2>' + ic('chat', 'h') + 'Chat <span class="note">· game ' + esc(app.gameId) + '</span></h2><div class="chat-list" id="chat-list"></div>' +
      '<div class="chat-quick">' + QUICK_CHAT.map(q => '<button class="chip" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' +
      '<form class="chat-form" id="chat-form" autocomplete="off"><input type="text" id="chat-input" maxlength="300" placeholder="Write a message…" autocomplete="off" enterkeyhint="send"><button class="btn primary icon" type="submit" title="Send">' + ic('send') + '</button></form>',
      { cls: 'sheet chat-sheet', onClose: () => { chat.open = false; } });
    renderChatList();
    $$('.chat-quick .chip').forEach(b => { b.onclick = () => sendChat(b.dataset.q); });
    $('#chat-form').onsubmit = ev => { ev.preventDefault(); sendChat($('#chat-input').value); };
    $('#chat-input').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); sendChat($('#chat-input').value); } });
    loadChat(false);
  }
  async function sendChat(text) {
    text = String(text || '').trim().slice(0, 300);
    if (!text || !chatAvailable()) return;
    const s = app.committed;
    const me = s && s.players ? s.players.find(p => p.pid === myPid()) : null;
    const present = s && s.players ? s.players.filter(p => !p.bot && p.pid !== myPid() && app.online.has(p.pid)).map(p => p.pid) : [];
    const msg = { pid: myPid(), name: (me && me.name) || myName() || 'Player', avatar: (me && me.avatar) || myAvatar(), text, present };
    const inp = $('#chat-input'); if (inp) { inp.value = ''; inp.focus(); }
    try {
      const row = await app.net.sendChat(app.gameId, msg); addChatMsg(row, false); Sfx.chat();
      if (s && s.players) notifyPlayers(s, 'chat', { text }, s.players.filter(p => !p.bot && p.pid !== myPid() && !app.online.has(p.pid)).map(p => p.pid));
    } catch (e) { toast('Message not sent: ' + e.message, true); }
  }

  // ---------- Profil (automatique), amis, tableau de bord des parties, événements en direct ----------
  const acctNet = () => { if (!app.net || !app.net.rpc) { const n = root.Net.makeOnline(CFG); if (!app.net) app.net = n; return n; } return app.net; };
  const cred = () => ({ p_pid: acct.me.pid, p_secret: acct.me.secret });
  acct.me = acctStore.get();
  // Crée le profil du joueur (pid de l'appareil + prénom) s'il n'existe pas encore ; renvoie le profil ou null.
  async function ensureAccount() {
    if (!ONLINE_OK) return null;
    if (acct.me) return acct.me;
    const name = myName();
    if (!name) return null;
    if (acct.registering) return acct.registering;
    acct.registering = (async () => {
      try {
        const a = await acctNet().rpc('harmonies_register', { p_pid: myPid(), p_name: name, p_avatar: myAvatar() });
        setAccount(a);
      } catch (e) {
        if (/exists/i.test(e.message) && !pidOverride()) {
          // ce pid a déjà un profil dont cet appareil n'a plus le secret (données effacées) : nouvelle identité
          ls.set('harmonies.pid', randomId(12, 'abcdefghijklmnopqrstuvwxyz0123456789'));
          try { const a = await acctNet().rpc('harmonies_register', { p_pid: myPid(), p_name: name, p_avatar: myAvatar() }); setAccount(a); } catch (e2) { hub.error = e2.message; }
        } else hub.error = e.message;
      } finally { acct.registering = null; }
      return acct.me;
    })();
    return acct.registering;
  }
  function setAccount(a) {
    acct.me = a ? { pid: a.pid, secret: a.secret, code: a.code, name: a.name, avatar: a.avatar } : null;
    acctStore.set(acct.me);
    hub.friends = [];
    startHub();
    if (app.screen === 'home') refreshHomePanels();
    if (acct.me && app.pendingFriend) { const c = app.pendingFriend; app.pendingFriend = null; addFriend(c); }
    if (acct.me) Push.sync();
  }
  let profileTimer = null;
  function syncProfile() {
    if (!ONLINE_OK) return;
    if (!acct.me) { ensureAccount(); return; }
    clearTimeout(profileTimer);
    profileTimer = setTimeout(async () => {
      const name = myName() || acct.me.name, avatar = myAvatar();
      try { await acctNet().rpc('harmonies_update_profile', Object.assign(cred(), { p_name: name, p_avatar: avatar })); acct.me.name = name; acct.me.avatar = avatar; acctStore.set(acct.me); }
      catch (e) { /* réessayé au prochain changement */ }
    }, 600);
  }
  // ---- tableau de bord : parties (résumés serveur) + amis ; rechargé sur événement, au retour au premier plan et périodiquement ----
  async function loadHub() {
    if (!ONLINE_OK) return;
    if (hub.loading) { hub.again = true; return; }
    hub.loading = true;
    if (app.screen === 'home' && !hub.loaded) refreshHomePanels();
    try {
      if (!acct.me) await ensureAccount();
      if (acct.me) {
        const h = await acctNet().rpc('harmonies_home', cred());
        hub.friends = h.friends || []; hub.games = h.games || [];
        if (h.now) hub.skew = Date.parse(h.now) - Date.now();
        if (h.account && (h.account.name !== acct.me.name || h.account.avatar !== acct.me.avatar || h.account.code !== acct.me.code)) { acct.me.name = h.account.name; acct.me.avatar = h.account.avatar; acct.me.code = h.account.code; acctStore.set(acct.me); }
      } else {
        const ids = ls.get('harmonies.recent', []).filter(g => g.mode === 'online').map(g => g.id).slice(0, 20);
        hub.games = ids.length ? (await acctNet().rpc('harmonies_summaries', { p_ids: ids })) || [] : [];
      }
      hub.loaded = true; hub.error = null;
    } catch (e) {
      hub.error = e.message;
      if (/not signed in/i.test(e.message)) { acct.me = null; acctStore.set(null); ensureAccount(); }
    }
    hub.loading = false;
    updateHub();
    if (hub.again) { hub.again = false; loadHub(); }
  }
  // Recalcule la pastille « à toi de jouer », l'icône, les panneaux de l'accueil et le suivi temps réel des parties actives.
  function updateHub() {
    const mine = hub.games.filter(g => isMyTurnGame(g) && g.players.some(p => p.pid === myPid()));
    hub.myTurn = mine.filter(g => g.id !== app.gameId).length;
    setAppBadge(mine.length);
    if (app.screen === 'home') refreshHomePanels();
    else if (app.screen === 'game') { const b = $('#games-btn'); if (b) { let n = b.querySelector('.badge-n'); if (hub.myTurn) { if (!n) { n = document.createElement('i'); n.className = 'badge-n'; b.appendChild(n); } n.textContent = hub.myTurn; } else if (n) n.remove(); } }
    watchGames();
  }
  const nextMyTurnGame = () => hub.games.find(g => isMyTurnGame(g) && g.id !== app.gameId && g.players.some(p => p.pid === myPid())) || null;
  function watchGames() {
    if (!ONLINE_OK || !app.net || !app.net.subscribeGames) return;
    const ids = hub.games.filter(g => g.status === 'playing' || g.status === 'lobby').map(g => g.id).slice(0, 30).sort();
    const key = ids.join(',');
    if (key === hub.watched) return;
    hub.watched = key;
    if (hub.unsubGames) { hub.unsubGames(); hub.unsubGames = null; }
    if (ids.length) hub.unsubGames = app.net.subscribeGames(ids, id => { if (id !== app.gameId) scheduleHub(); });
  }
  let hubTimer = null;
  function scheduleHub() { clearTimeout(hubTimer); hubTimer = setTimeout(loadHub, 400); }
  function startHub() {
    if (hub.unsub) { hub.unsub(); hub.unsub = null; }
    if (hub.unsubOnline) { hub.unsubOnline(); hub.unsubOnline = null; }
    if (!acct.me || !ONLINE_OK) return;
    try {
      hub.unsub = acctNet().subscribeAccount(acct.me.pid, onHubEvent);
      hub.unsubOnline = acctNet().subscribeOnline(acct.me.pid, pids => { hub.online = new Set(pids); updatePresence(); if (app.screen === 'home') refreshHomePanels(); });
    } catch (e) { /* hors ligne */ }
    if (!hub.timer) hub.timer = setInterval(() => { if (document.visibilityState === 'visible') loadHub(); }, app.screen === 'home' ? 30000 : 60000);
    loadHub();
  }
  // Événement reçu sur mon canal : nouvelle partie, à moi de jouer, partie finie, message, nouvel ami
  function onHubEvent(ev, payload) {
    if (!payload || !payload.from) return;
    const from = payload.from;
    const same = payload.game && payload.game === app.gameId;
    scheduleHub();
    if (ev === 'friend') { toast(avatarHTML(from, -1, 'xs') + esc(from.name) + ' added you as a friend'); Sfx.chat(); return; }
    if (same) { if (ev !== 'chat') refresh(); return; } // la partie ouverte reçoit déjà ses propres mises à jour
    if (ev === 'game') {
      hubPop(from, payload.lobby ? 'invites you to a game · ' + esc(SIDE_LABEL[payload.side] || '') : 'started a game with you · ' + esc(SIDE_LABEL[payload.side] || ''), payload.game, payload.lobby ? 'Join' : 'Play');
      Sfx.turn(); vibrate([20, 30, 20]);
      Notif.show('Harmonies', from.name + (payload.lobby ? ' invites you to a game' : ' started a game with you'), 'game-' + payload.game);
    } else if (ev === 'turn') {
      hubPop(from, 'played — your turn!', payload.game, 'Play');
      Sfx.turn(); vibrate([30, 40, 30]);
      Notif.show('Your turn!', 'Game with ' + from.name, 'game-' + payload.game);
    } else if (ev === 'finished') {
      hubPop(from, payload.cancelled ? (payload.removed ? 'removed you from a game' : 'cancelled a game') : (payload.resigned ? 'gave up — you win!' : 'finished your game'), payload.cancelled ? null : payload.game, 'See');
      Sfx.chat();
      Notif.show('Harmonies', from.name + (payload.cancelled ? ' cancelled a game' : (payload.resigned ? ' gave up — you win!' : ' finished your game')), 'game-' + payload.game);
    } else if (ev === 'chat') {
      hubPop(from, esc(String(payload.text || '')).slice(0, 120), payload.game, 'Open');
      Sfx.chat(); vibrate(15);
      Notif.show(from.name, String(payload.text || ''), 'chat-' + payload.game);
    }
  }
  function hubPop(from, text, gameId, label) {
    let host = $('#chat-pops');
    if (!host) { host = document.createElement('div'); host.id = 'chat-pops'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'chat-pop invite';
    el.innerHTML = avatarHTML(from, -1, 'sm') + '<div class="cp-body"><b>' + esc(from.name || '?') + '</b><span>' + text + '</span></div>' + (gameId ? '<button class="btn small primary">' + ic('play') + label + '</button>' : '');
    const b = el.querySelector('button');
    if (b) b.onclick = ev => { ev.stopPropagation(); el.remove(); Sfx.unlock(); if (app.gameId) leaveGame(); openOnline(gameId, true); };
    el.onclick = () => { el.remove(); };
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 12000); setTimeout(() => el.remove(), 12400);
  }
  // ---- amis ----
  async function addFriend(code, pid) {
    if (!(await ensureAccount())) { toast('Enter your name first', true); return false; }
    try {
      const f = await acctNet().rpc('harmonies_add_friend', Object.assign(cred(), { p_code: code || null, p_friend: pid || null }));
      if (!hub.friends.some(x => x.pid === f.pid)) hub.friends.push(f);
      hub.friends.sort((a, b) => a.name.localeCompare(b.name));
      toast('You and ' + esc(f.name) + ' are now friends'); Sfx.card();
      try { acctNet().pushEvent(f.pid, 'friend', { from: { pid: myPid(), name: myName(), avatar: myAvatar() } }).catch(() => {}); } catch (e) { /* ignore */ }
      if (app.screen === 'home') refreshHomePanels();
      return true;
    } catch (e) { toast(e.message, true); return false; }
  }
  async function removeFriend(pid) {
    const f = hub.friends.find(x => x.pid === pid);
    confirmBox('Remove ' + (f ? f.name : 'this friend') + '?', 'You will no longer see each other in your friends lists.', async () => {
      try { await acctNet().rpc('harmonies_remove_friend', Object.assign(cred(), { p_friend: pid })); hub.friends = hub.friends.filter(x => x.pid !== pid); refreshHomePanels(); }
      catch (e) { toast(e.message, true); }
    });
  }

  // ---------- Démarrage ----------
  function openFromUrl(url) {
    let code = '';
    try { code = (new URL(url, location.href).searchParams.get('g') || '').toUpperCase(); } catch (e) { /* ignore */ }
    if (code && ONLINE_OK) { if (code !== app.gameId) { if (app.gameId) leaveGame(); openOnline(code, true); } else refresh(); }
    else if (!app.gameId) renderHome();
  }
  function boot() {
    document.body.insertAdjacentHTML('afterbegin', R.defsSVG() + (root.ANIMAL_SPRITE || ''));
    const params = new URLSearchParams(location.search);
    const code = (params.get('g') || '').toUpperCase();
    if (params.get('pid')) { try { sessionStorage.setItem('harmonies.pid', params.get('pid')); } catch (e) { /* ignore */ } }
    if (params.get('name')) ls.set('harmonies.name', params.get('name'));
    if (params.get('avatar')) ls.set('harmonies.avatar', +params.get('avatar'));
    if (params.get('add')) { app.pendingFriend = params.get('add'); history.replaceState(null, '', location.pathname); }
    acct.me = acctStore.get();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (app.mode === 'online' && app.gameId) { refresh(); loadChat(false); maybeRunBot(); }
      loadHub();
    });
    document.addEventListener('pointerdown', () => { interacted = true; Sfx.unlock(); }, { once: true, passive: true });
    // service worker : installation sur l'écran d'accueil, cache hors connexion, notifications push (page publiée ou dev local)
    if ((CFG.build || location.hostname === 'localhost') && 'serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.register('sw.js').catch(() => { /* facultatif */ });
        navigator.serviceWorker.addEventListener('message', ev => {
          const d = ev.data || {};
          if (d.type === 'open' && d.url) openFromUrl(d.url);
          else if (d.type === 'push') { scheduleHub(); if (app.mode === 'online' && app.gameId) refresh(); }
        });
      } catch (e) { /* facultatif */ }
    }
    if (code && ONLINE_OK) { renderHome(); openOnline(code, true); }
    else renderHome();
    if (acct.me) {
      startHub(); Push.sync();
      if (app.pendingFriend) { const c = app.pendingFriend; app.pendingFriend = null; addFriend(c); }
    } else ensureAccount();
  }
  root.HarmoniesApp = { boot, app, render, act, endTurn, refresh, Sfx, chat, sendChat, openChat, acct, hub, Notif, Push, loadHub, skipBots, openOnline, goHome };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof self !== 'undefined' ? self : this);
