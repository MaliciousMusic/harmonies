// Bot « godmode » (niveau 4) : planificateur. Pur : sans DOM, fonctionne sous Node (tests, arène) et dans le navigateur.
//
// Principe. À chaque tour, le bot construit un plan de partie : l'empilement final visé sur chacune des 23 cases, choisi par recuit
// simulé pour maximiser le score final projeté — paysage + cartes en main + cartes qui peuvent encore sortir (rivière visible et
// composition connue de la pioche) — pondéré par la faisabilité : jetons nécessaires par couleur contre les probabilités de tirage
// (composition du sac et du plateau central), tours restants, place à garder pour les jetons imposés. Le tour joué est celui qui,
// après re-planification depuis la position obtenue, maximise son score projeté moins celui des adversaires : il prend aussi les
// cartes et les jetons dont un adversaire a le plus besoin (gêne) et sait finir la partie quand il est en tête.
// Il ne triche pas : il ne regarde ni l'ordre du sac ni celui de la pioche, seulement leur composition (comme un joueur qui compte).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./engine.js'));
  else root.God = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const N = E.CELLS.length, NB = E.NEIGHBORS, CARD = id => E.CARD_BY_ID.get(id);
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  // ---------- Empilements : les 15 piles légales, codées sur un entier ----------
  const STACKS = [[], [1], [5], [2], [2, 2], [2, 2, 2], [3], [3, 3], [4], [3, 4], [3, 3, 4], [6], [2, 6], [3, 6], [6, 6]];
  const CODE = new Map(STACKS.map((s, i) => [s.join(''), i]));
  const codeOf = s => { const c = CODE.get(s.join('')); if (c === undefined) throw new Error('unknown stack ' + s.join(',')); return c; };
  const LEN = STACKS.map(s => s.length);
  const TOP = STACKS.map(s => (s.length ? s[s.length - 1] : 0));
  const TREE = STACKS.map(s => E.treeHeight(s));
  const MTN = STACKS.map(s => (E.isMountain(s) ? s.length : 0));
  const BLD = STACKS.map(s => (E.isBuilding(s) ? 1 : 0));
  const ISFIELD = STACKS.map(s => (E.top(s) === 5 ? 1 : 0)), ISWATER = STACKS.map(s => (E.top(s) === 1 ? 1 : 0)), ISLAND = STACKS.map(s => (E.top(s) !== 1 ? 1 : 0));
  const HPTS = [0, 1, 3, 7];
  // EXT[c] : codes atteignables depuis c en ajoutant des jetons (c compris) ; PUSH[c][couleur] : code après la pose d'un jeton (-1 : illégal)
  const EXT = STACKS.map((s, c) => STACKS.map((_, d) => d).filter(d => LEN[d] >= LEN[c] && STACKS[d].slice(0, LEN[c]).every((x, k) => x === s[k])));
  const EXTMASK = EXT.map(list => list.reduce((m, d) => m | (1 << d), 0));
  const PUSH = STACKS.map(s => { const row = [-1, -1, -1, -1, -1, -1, -1]; for (let color = 1; color <= 6; color++) { const c = CODE.get(s.concat(color).join('')); if (c !== undefined) row[color] = c; } return row; });
  // Capacité d'une case à absorber des jetons imposés (non prévus par le plan)
  const JUNKCAP = STACKS.map((s, c) => (c === 0 ? 1.5 : PUSH[c].some(x => x >= 0) ? 0.5 : 0));
  const BLDMASK = (1 << 12) | (1 << 13) | (1 << 14);
  // Empilements « aboutis » examinés par le polissage par paires (pas les intermédiaires : tronc seul, deux troncs, rouge seul)
  const PAIRCODES = STACKS.map((_, c) => c).filter(c => c !== 0 && c !== 6 && c !== 7 && c !== 11);
  const PAIREXT = EXT.map(list => list.filter(c => PAIRCODES.includes(c)));
  const wantMask = s => (s.length === 2 && s[0] === 6 && s[1] === 7 ? BLDMASK : 1 << codeOf(s.slice().reverse()));

  // Toutes les réalisations possibles du motif de chaque carte sur la géométrie du plateau (même dédoublonnage que le moteur)
  const INST = new Map(), MASKS = new Map(); // MASKS : empilements requis par chaque case du motif (filtre rapide)
  for (const card of E.CARDS) {
    const list = [], seen = new Set(), masks = card.pat.map(p => wantMask(p.s)), ci = card.pat.findIndex(p => p.cube);
    MASKS.set(card.id, masks);
    for (let o = 0; o < N; o++) for (let rot = 0; rot < 6; rot++) {
      const cells = E.patternCells(o, card.pat, rot);
      if (!cells) continue;
      const sig = cells.slice().sort((a, b) => a - b).join('-') + ':' + cells[ci];
      if (seen.has(sig)) continue;
      seen.add(sig);
      list.push({ id: card.id, cells, masks, cube: cells[ci] });
    }
    INST.set(card.id, list);
  }

  const PARAMS = {
    gamma: 1.5,      // sévérité de l'escompte quand le plan demande plus de tours qu'il n'en reste
    share: 1.5,      // part du sac qu'un joueur peut espérer (× 1/joueurs)
    deepDelay: 0.15, // tours de retard par jeton empilé sur un autre jeton encore à poser
    tokenP: 0.95,    // probabilité qu'un jeton manquant précis arrive à temps, quand le plan est faisable en espérance
    temp: 1.2,       // température initiale du recuit simulé (points)
    inertia: 0.15,   // bonus par case qui garde la cible du plan précédent
    cardMargin: 0,   // gain projeté minimal pour prendre une carte (les motifs chers déçoivent plus souvent que prévu)
    junk: 1.2,       // coût par jeton imposé sans case pour l'accueillir
    rateStart: 3.0, rateEnd: 1.7, // cases consommées par tour, plateau vide → plateau plein (estimation des tours restants)
    displayW: 0.55,  // poids d'une carte visible de la rivière (pas encore en main)
    deckW: 0.35,     // poids d'une carte de la pioche (× chance d'apparaître)
    horizon: 0.7,    // prudence : fraction des tours restants sur laquelle le plan doit tenir
    denyCard: 0.7, denySlot: 0.6, // part de la perte adverse créditée quand on lui prend une carte / un lot
  };
  const RANK = [1, 0.7, 0.45, 0.25]; // décroissance par rang des meilleures cartes à venir
  const MEMO = new Map(); // plan du tour précédent par partie et siège (démarrage à chaud)

  // ---------- Score d'une cible (codes par case) ----------
  const seen = new Uint8Array(N), stack = new Int32Array(N), dist = new Int32Array(N), queue = new Int32Array(N), sizes = new Int32Array(N);
  // Tailles des composantes connexes des cases dont le code vérifie flag[code] ; renvoie le nombre de groupes
  function groups(t, flag) {
    seen.fill(0);
    let g = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (seen[s0] || !flag[t[s0]]) continue;
      let sp = 0, size = 0;
      stack[sp++] = s0; seen[s0] = 1;
      while (sp) {
        const i = stack[--sp]; size++;
        const nb = NB[i];
        for (let k = 0; k < nb.length; k++) { const j = nb[k]; if (!seen[j] && flag[t[j]]) { seen[j] = 1; stack[sp++] = j; } }
      }
      sizes[g++] = size;
    }
    return g;
  }
  function river(t) {
    let best = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (!ISWATER[t[s0]]) continue;
      dist.fill(0); dist[s0] = 1;
      let qh = 0, qt = 0;
      queue[qt++] = s0;
      while (qh < qt) {
        const i = queue[qh++], d = dist[i];
        if (d > best) best = d;
        const nb = NB[i];
        for (let k = 0; k < nb.length; k++) { const j = nb[k]; if (ISWATER[t[j]] && !dist[j]) { dist[j] = d + 1; queue[qt++] = j; } }
      }
    }
    return best;
  }
  // Points de paysage d'une cible (identique à Engine.scoreLandscape, sur les codes)
  function landscape(t, side) {
    let pts = 0;
    for (let i = 0; i < N; i++) {
      const c = t[i], nb = NB[i];
      if (TREE[c]) pts += HPTS[TREE[c]];
      if (MTN[c]) for (let k = 0; k < nb.length; k++) if (MTN[t[nb[k]]]) { pts += HPTS[MTN[c]]; break; }
      if (BLD[c]) { let m = 0, n = 0; for (let k = 0; k < nb.length; k++) { const tp = TOP[t[nb[k]]]; if (tp && !(m & (1 << tp))) { m |= 1 << tp; n++; } } if (n >= 3) pts += 5; }
    }
    const g = groups(t, ISFIELD);
    for (let k = 0; k < g; k++) if (sizes[k] >= 2) pts += 5;
    if (side === 'B') pts += Math.max(1, groups(t, ISLAND)) * 5;
    else pts += E.riverPoints(river(t));
    return pts;
  }
  function spiritPts(t, id) {
    let g, n = 0;
    switch (id) {
      case 33: g = groups(t, ISFIELD); for (let k = 0; k < g; k++) n += sizes[k] >= 3 ? 10 : 2; return n;
      case 34: return groups(t, ISFIELD) * 5;
      case 35: for (let i = 0; i < N; i++) if (TREE[t[i]] >= 2) n += 4; return n;
      case 36: for (let i = 0; i < N; i++) { const h = TREE[t[i]]; if (h === 3) n += 1; else if (h) n += 3; } return n;
      case 37: return groups(t, BLD) * 4;
      case 38: g = groups(t, BLD); for (let k = 0; k < g; k++) if (sizes[k] >= 2) n += 6; return n;
      case 39: for (let i = 0; i < N; i++) if (MTN[t[i]] >= 2) n += 4; return n;
      case 40: for (let i = 0; i < N; i++) { const h = MTN[t[i]]; if (h === 3) n += 1; else if (h) n += 3; } return n;
      case 41: g = groups(t, ISWATER); for (let k = 0; k < g; k++) if (sizes[k] >= 2) n += 7; return n;
      case 42: for (let i = 0; i < N; i++) if (ISWATER[t[i]]) n += 2; return n;
      default: return 0;
    }
  }

  // ---------- Motifs sur une cible ----------
  const claimStamp = new Int32Array(N), tmpStamp = new Int32Array(N), claimOwner = new Int32Array(N);
  let claimGen = 0, tmpGen = 0;
  // Nombre de réalisations du motif (cases cube distinctes, libres) sur la cible t, au plus max ; claim : réserve les cases cube.
  // kBuf[0..n-1] : jetons encore à poser pour chaque réalisation (par rapport à cur), triés par ordre croissant.
  const kBuf = new Int32Array(8);
  function matchCount(list, t, cur, cubed, max, claim) {
    let n = 0;
    if (!claim) tmpGen++;
    for (let a = 0; a < list.length && n < max; a++) {
      const ins = list[a], cc = ins.cube;
      if (cubed[cc] || claimStamp[cc] === claimGen || (!claim && tmpStamp[cc] === tmpGen)) continue;
      const cells = ins.cells, masks = ins.masks;
      let ok = true, k = 0;
      for (let q = 0; q < cells.length; q++) { const c = cells[q]; if (!((masks[q] >> t[c]) & 1)) { ok = false; break; } k += LEN[t[c]] - LEN[cur[c]]; }
      if (!ok) continue;
      if (claim) { claimStamp[cc] = claimGen; claimOwner[cc] = ins.id; } else tmpStamp[cc] = tmpGen;
      let q = n;
      while (q > 0 && kBuf[q - 1] > k) { kBuf[q] = kBuf[q - 1]; q--; }
      kBuf[q] = k;
      n++;
    }
    return n;
  }
  // Valeur espérée d'une carte dont n réalisations sont prévues (kBuf), chaque jeton manquant arrivant avec probabilité tokenP
  function cardExpected(pts, placed, n, tokenP) {
    let v = placed ? pts[placed - 1] : 0, K = 0;
    for (let i = 0; i < n && placed + i < pts.length; i++) { K += kBuf[i]; v += (pts[placed + i] - (placed + i ? pts[placed + i - 1] : 0)) * Math.pow(tokenP, K); }
    return v;
  }
  const handCard = (id, left) => { const c = CARD(id); return { id, pts: c.pts, left, placed: c.pts.length - left }; };
  const nextVal = h => (h.left ? h.pts[h.placed] - (h.placed ? h.pts[h.placed - 1] : 0) : 0);
  const cardTotal = (h, n) => { const k = h.placed + Math.min(n, h.left); return k ? h.pts[k - 1] : 0; };

  // ---------- Positions et valeur d'un plan ----------
  // Valeur « immédiate » d'une cible : ce que vaudrait le plateau sans rien ajouter (paysage, cartes réalisées, esprit)
  function immediate(pos, t) {
    claimGen++;
    let v = landscape(t, pos.ctx.side);
    for (const h of pos.hand) v += cardTotal(h, matchCount(instOf(pos, h.id), t, t, pos.cubed, h.left, true));
    if (pos.spirit && (pos.spirit.placed || matchCount(instOf(pos, pos.spirit.id), t, t, pos.cubed, 1, true))) v += spiritPts(t, pos.spirit.id);
    return v;
  }
  // pos : { ctx, cur (codes actuels), cubed, hand, spirit, T (tours de jetons à venir), Tcards (tours où prendre une carte), skipId }
  function makePos(ctx, cur, cubed, hand, spirit, T, Tcards, skipId, prev) {
    const active = hand.length + (spirit && !spirit.placed ? 1 : 0);
    const pos = { ctx, cur, cubed, hand, spirit, T, Tcards, skipId: skipId || 0, slotsFree: E.MAX_ACTIVE_CARDS - active, prev: prev || null, reach: null, feasible: null, stamps: null, base: 0, landBase: 0 };
    feasibleAll(pos);
    pos.base = immediate(pos, cur);
    pos.landBase = landscape(cur, ctx.side);
    return pos;
  }
  function posOf(ctx, seat, over) {
    const pl = ctx.state.players[seat];
    const cur = new Int8Array(N), cubed = new Uint8Array(N);
    pl.board.forEach((cell, i) => { cur[i] = codeOf(cell.s); cubed[i] = cell.cube ? 1 : 0; });
    const hand = pl.hand.map(h => handCard(h.id, h.left));
    if (over && over.addCard) hand.push(handCard(over.addCard, CARD(over.addCard).pts.length));
    hand.sort((a, b) => nextVal(b) - nextVal(a));
    const spirit = over && over.spirit ? over.spirit : (pl.spirit ? { id: pl.spirit.id, placed: pl.spirit.placed } : null);
    const T = ctx.turns[seat];
    return makePos(ctx, cur, cubed, hand, spirit, T, Math.max(0, T - 1), over && over.addCard, over && over.prev);
  }
  function reachOf(pos) {
    if (!pos.reach) { pos.reach = new Int32Array(N); for (let i = 0; i < N; i++) pos.reach[i] = pos.cubed[i] ? 1 << pos.cur[i] : EXTMASK[pos.cur[i]]; }
    return pos.reach;
  }
  // Réalisations d'un motif encore possibles depuis la position (chaque case atteignable, case cube libre)
  function feasibleList(pos, id) {
    if (!pos.feasible) pos.feasible = new Map();
    let list = pos.feasible.get(id);
    if (!list) {
      const reach = reachOf(pos);
      list = INST.get(id).filter(ins => !pos.cubed[ins.cube] && ins.cells.every((c, k) => (ins.masks[k] & reach[c]) !== 0));
      pos.feasible.set(id, list);
    }
    return list;
  }
  // Réalisations à examiner pour une carte : celles encore possibles si la position les a calculées, sinon toutes
  const instOf = (pos, id) => (pos.feasible && pos.feasible.get(id)) || INST.get(id);
  // Calcule les réalisations possibles de toutes les cartes utiles (main, esprit, cartes à venir) : accélère chaque évaluation
  function feasibleAll(pos) {
    for (const h of pos.hand) feasibleList(pos, h.id);
    if (pos.spirit) feasibleList(pos, pos.spirit.id);
    for (const f of pos.ctx.future) feasibleList(pos, f.id);
    return pos.feasible;
  }
  // Cartes dont on propose de tamponner le motif dans le plan, pondérées
  function stampsOf(pos) {
    if (!pos.stamps) {
      const list = [];
      for (const h of pos.hand) if (h.left) list.push({ id: h.id, w: 4 });
      if (pos.spirit && !pos.spirit.placed) list.push({ id: pos.spirit.id, w: 4 });
      for (const f of pos.ctx.future) if (f.id !== pos.skipId) list.push({ id: f.id, w: f.w * 3 });
      pos.stamps = { list, total: list.reduce((a, s) => a + s.w, 0) };
    }
    return pos.stamps;
  }
  const needBuf = new Int32Array(7), futBuf = new Float64Array(64);
  // Score final projeté d'une cible t pour la position pos : paysage escompté par la faisabilité globale, cartes et esprit escomptés
  // réalisation par réalisation (chaque jeton manquant doit arriver), cartes à venir, place pour les jetons imposés.
  let evalCount = 0; // évaluations effectuées (budgets de polissage)
  function planValue(pos, t, detail) {
    evalCount++;
    const ctx = pos.ctx, cur = pos.cur, cubed = pos.cubed;
    // jetons à ajouter, par couleur ; deep : jetons posés sur un jeton lui-même à poser
    needBuf.fill(0);
    let needTotal = 0, deep = 0;
    for (let i = 0; i < N; i++) {
      const a = t[i], b = cur[i];
      if (a !== b) { const s = STACKS[a]; for (let k = LEN[b]; k < s.length; k++) { needBuf[s[k]]++; needTotal++; if (k > LEN[b]) deep++; } }
    }
    const T = pos.T * PARAMS.horizon;
    let feasLin = 1, turnsNeeded = 0, placedInTime = 0;
    if (needTotal) {
      if (T <= 0) feasLin = 0;
      else { turnsNeeded = tokenTurns(ctx, needBuf, needTotal, deep, T); placedInTime = tokenBuf[0]; feasLin = Math.min(1, T / turnsNeeded); }
    }
    const feas = Math.pow(feasLin, PARAMS.gamma);
    const tokenP = needTotal ? Math.min(1, placedInTime / needTotal) * PARAMS.tokenP : 1;
    claimGen++;
    const land = landscape(t, ctx.side);
    let cards = 0, completing = 0, future = 0;
    for (const h of pos.hand) {
      const n = matchCount(instOf(pos, h.id), t, cur, cubed, h.left, true);
      cards += cardExpected(h.pts, h.placed, n, tokenP);
      if (n >= h.left) completing++;
    }
    if (pos.spirit) {
      if (pos.spirit.placed) cards += spiritPts(t, pos.spirit.id);
      else if (matchCount(instOf(pos, pos.spirit.id), t, cur, cubed, 1, true)) cards += spiritPts(t, pos.spirit.id) * Math.pow(tokenP, kBuf[0]);
    }
    // cartes qui peuvent encore sortir : les meilleures que ce paysage réaliserait, selon les places en main et les tours restants
    const K = Math.min(RANK.length, pos.slotsFree + completing, pos.Tcards);
    if (K > 0) {
      // ctx.future est trié par potentiel (poids × valeur maximale) décroissant : on s'arrête dès qu'aucune carte ne peut plus entrer
      // dans les K meilleures (futBuf : les K meilleures valeurs trouvées, triées par ordre décroissant)
      let nf = 0, present = 0;
      for (let i = 0; i < N; i++) present |= 1 << t[i];
      for (const f of ctx.future) {
        if (nf === K && f.max <= futBuf[K - 1]) break;
        if (f.id === pos.skipId) continue;
        const masks = MASKS.get(f.id);
        let possible = true;
        for (let k = 0; k < masks.length; k++) if (!(masks[k] & present)) { possible = false; break; }
        if (!possible) continue;
        const list = instOf(pos, f.id);
        if (!list.length) continue;
        const n = matchCount(list, t, cur, cubed, f.pts.length, false);
        if (!n) continue;
        const v = f.w * cardExpected(f.pts, 0, n, tokenP);
        if (nf < K) { let q = nf++; while (q > 0 && futBuf[q - 1] < v) { futBuf[q] = futBuf[q - 1]; q--; } futBuf[q] = v; }
        else if (v > futBuf[K - 1]) { let q = K - 1; while (q > 0 && futBuf[q - 1] < v) { futBuf[q] = futBuf[q - 1]; q--; } futBuf[q] = v; }
      }
      for (let r = 0; r < nf; r++) future += futBuf[r] * RANK[r];
    }
    // place pour les jetons imposés (pris avec les lots mais inutiles au plan)
    let junk = 0;
    if (T > 0) {
      const junkTokens = (3 * T - placedInTime) * 0.7;
      let cap = 0;
      for (let i = 0; i < N; i++) if (t[i] === cur[i] && !cubed[i]) cap += JUNKCAP[t[i]];
      junk = Math.max(0, junkTokens - cap) * PARAMS.junk;
    }
    // inertie : garder la cible du tour précédent quand rien ne justifie d'en changer (le recuit oscille sinon entre plans équivalents)
    let inertia = 0;
    const prev = pos.prev;
    if (prev) for (let i = 0; i < N; i++) if (prev[i] !== cur[i] && t[i] === prev[i]) inertia += PARAMS.inertia;
    const total = pos.landBase + (land - pos.landBase) * feas + cards + future - junk + inertia;
    if (detail) Object.assign(detail, { land, cards, future, inertia, total, base: pos.base, needTotal, need: Array.from(needBuf), deep, turnsNeeded, placedInTime, feasLin, feas, tokenP, junk, T, Tcards: pos.Tcards });
    return total;
  }
  // Tours nécessaires pour réunir les jetons du plan, en espérance : à chaque tour on prend la meilleure des triplettes fraîches
  // (composition du sac), les besoins par couleur s'épuisent, les jetons empilés (deep) attendent ceux du dessous.
  // Renvoie le nombre de tours (fractionnaire) ; tokenBuf[0] = jetons du plan réunis en T tours.
  const readyBuf = new Float64Array(7), tokenBuf = new Float64Array(1);
  function tokenTurns(ctx, need, needTotal, deep, T) {
    const prob = ctx.prob, m = ctx.fresh;
    let goal = 0;
    for (let c = 1; c <= 6; c++) { readyBuf[c] = Math.min(need[c], ctx.supply[c]); goal += readyBuf[c]; }
    const missing = needTotal - goal; // jetons d'une couleur épuisée : ils ne viendront pas
    let placed = 0, turns = 0, inTime = 0;
    while (turns < 40 && placed < goal - 1e-9) {
      let q = 0;
      for (let c = 1; c <= 6; c++) if (readyBuf[c] > 1e-9) q += prob[c];
      if (q <= 1e-9) break;
      const f0 = Math.pow(1 - q, 3), f1 = f0 + 3 * q * (1 - q) * (1 - q), f2 = 1 - q * q * q;
      const u = 3 - Math.pow(f0, m) - Math.pow(f1, m) - Math.pow(f2, m); // jetons utiles espérés dans la meilleure des m triplettes
      let got = 0;
      for (let c = 1; c <= 6; c++) if (readyBuf[c] > 1e-9) { const take = Math.min(readyBuf[c], u * prob[c] / q); readyBuf[c] -= take; got += take; }
      if (got <= 1e-9) break;
      if (placed + got >= goal - 1e-9) { // dernier tour, en partie
        const frac = (goal - placed) / got;
        if (turns < T) inTime += got * Math.min(frac, T - turns);
        turns += frac; placed = goal;
        break;
      }
      placed += got; turns += 1;
      if (turns <= T) inTime = placed;
    }
    tokenBuf[0] = inTime;
    if (placed < goal - 1e-9) return 1e9;
    return turns + missing * 2 + deep * PARAMS.deepDelay;
  }
  // Cases cube réservées par le plan : owner[case] = id de carte (0 : libre)
  function claimsOf(pos, t) {
    planValue(pos, t);
    const owner = new Int32Array(N);
    for (let i = 0; i < N; i++) if (claimStamp[i] === claimGen) owner[i] = claimOwner[i];
    return owner;
  }
  // Plan P reporté sur une nouvelle position : les cibles encore atteignables sont gardées, les autres reviennent à l'état de la case
  function merge(P, cur, cubed, out) {
    for (let i = 0; i < N; i++) { const reach = cubed[i] ? 1 << cur[i] : EXTMASK[cur[i]]; out[i] = (reach >> P[i]) & 1 ? P[i] : cur[i]; }
    return out;
  }

  // ---------- Recherche du plan : recuit simulé ----------
  function setCell(t, i, code, ch) { if (t[i] !== code) { ch.push(i, t[i]); t[i] = code; } }
  function propose(pos, t, ch, rng) {
    const r = rng(), cur = pos.cur;
    if (r < 0.4) {
      // tamponner le motif d'une carte (cases choisies parmi les empilements atteignables)
      const stamps = stampsOf(pos);
      if (!stamps.list.length) return;
      let x = rng() * stamps.total, card = stamps.list[stamps.list.length - 1];
      for (const s of stamps.list) { x -= s.w; if (x <= 0) { card = s; break; } }
      const list = feasibleList(pos, card.id);
      if (!list.length) return;
      const ins = list[Math.floor(rng() * list.length)], reach = reachOf(pos);
      for (let k = 0; k < ins.cells.length; k++) {
        const cell = ins.cells[k], mask = ins.masks[k];
        if ((mask >> t[cell]) & 1) continue;
        let m = mask & reach[cell], choice = -1, cnt = 0;
        for (let c = 0; m; c++, m >>= 1) if (m & 1) { cnt++; if (rng() * cnt < 1) choice = c; }
        if (choice >= 0) setCell(t, cell, choice, ch);
      }
    } else if (r < 0.72) {
      // une case : un empilement atteignable au hasard (dont l'état actuel = retrait du plan)
      const i = Math.floor(rng() * N);
      if (pos.cubed[i]) return;
      const opts = EXT[cur[i]];
      setCell(t, i, opts[Math.floor(rng() * opts.length)], ch);
    } else if (r < 0.86) {
      // prolonger une rivière, un champ, une chaîne : copier une case voisine sur une case vide
      const i = Math.floor(rng() * N);
      if (t[i] !== 0) return;
      const nb = NB[i], c = t[nb[Math.floor(rng() * nb.length)]];
      if (c) setCell(t, i, c, ch);
    } else {
      // retirer un élément du plan
      const i = Math.floor(rng() * N);
      if (t[i] !== cur[i]) setCell(t, i, cur[i], ch);
    }
  }
  function optimize(pos, start, iters, rng, temp0, rounds, pairs, maxEvals) {
    const t = Int8Array.from(start), bestT = Int8Array.from(start), ch = [];
    let cur = planValue(pos, t), best = cur;
    const T0 = temp0 || PARAMS.temp, cool = Math.log(0.03);
    for (let it = 0; it < iters; it++) {
      ch.length = 0;
      propose(pos, t, ch, rng);
      if (!ch.length) continue;
      const v = planValue(pos, t), d = v - cur;
      if (d >= 0 || rng() < Math.exp(d / (T0 * Math.exp(cool * it / iters)))) { cur = v; if (v > best) { best = v; bestT.set(t); } }
      else for (let k = ch.length - 2; k >= 0; k -= 2) t[ch[k]] = ch[k + 1];
    }
    return polish(pos, bestT, best, rounds, pairs, maxEvals);
  }
  // Polissage déterministe : chaque case essaie tous ses empilements atteignables, puis (pairs) deux cases voisines à la fois
  // (paires de montagnes ou de champs, buisson + arbre, eau + buisson…), puis chaque carte en main toutes ses réalisations ;
  // jusqu'à ce que plus rien n'améliore. Après la première passe, seules les paires touchant une case modifiée sont réexaminées.
  const dirty = new Uint8Array(N), dirtyNext = new Uint8Array(N);
  function polish(pos, t, v, rounds, pairs, maxEvals) {
    const ch = [], reach = reachOf(pos), stop = evalCount + (maxEvals || 1e9);
    dirty.fill(1);
    for (let round = 0; round < (rounds || 4) && evalCount < stop; round++) {
      let improved = false;
      dirtyNext.fill(0);
      for (let i = 0; i < N && evalCount < stop; i++) {
        if (pos.cubed[i]) continue;
        const opts = EXT[pos.cur[i]], keep = t[i];
        let bestC = keep;
        for (const c of opts) { if (c === keep) continue; t[i] = c; const w = planValue(pos, t); if (w > v + 1e-9) { v = w; bestC = c; } }
        t[i] = bestC;
        if (bestC !== keep) { improved = true; dirtyNext[i] = 1; }
      }
      if (pairs) for (let i = 0; i < N && evalCount < stop; i++) {
        if (pos.cubed[i]) continue;
        for (const j of NB[i]) {
          if (j < i || pos.cubed[j] || !(dirty[i] || dirty[j] || dirtyNext[i] || dirtyNext[j])) continue;
          const ki = t[i], kj = t[j];
          let bi = ki, bj = kj;
          for (const ci of PAIREXT[pos.cur[i]]) {
            if (ci === ki) continue; // les changements d'une seule case sont déjà faits
            for (const cj of PAIREXT[pos.cur[j]]) {
              if (cj === kj) continue;
              t[i] = ci; t[j] = cj;
              const w = planValue(pos, t);
              if (w > v + 1e-9) { v = w; bi = ci; bj = cj; }
            }
          }
          t[i] = bi; t[j] = bj;
          if (bi !== ki || bj !== kj) { improved = true; dirtyNext[i] = 1; dirtyNext[j] = 1; }
        }
      }
      for (const h of pos.hand) {
        if (!h.left) continue;
        for (const ins of feasibleList(pos, h.id)) {
          if (evalCount >= stop) break;
          ch.length = 0;
          for (let k = 0; k < ins.cells.length; k++) {
            const cell = ins.cells[k], mask = ins.masks[k];
            if ((mask >> t[cell]) & 1) continue;
            let m = mask & reach[cell], c = 0;
            while (!(m & 1)) { m >>= 1; c++; }
            setCell(t, cell, c, ch);
          }
          if (!ch.length) continue;
          const w = planValue(pos, t);
          if (w > v + 1e-9) { v = w; improved = true; for (let k = 0; k < ch.length; k += 2) dirtyNext[ch[k]] = 1; }
          else for (let k = ch.length - 2; k >= 0; k -= 2) t[ch[k]] = ch[k + 1];
        }
      }
      if (!improved) break;
      dirty.set(dirtyNext);
    }
    return { t, v };
  }

  // ---------- Contexte de partie : tours restants, probabilités de tirage, cartes à venir ----------
  // Tours que chaque siège jouera encore, en partant du joueur `turn` (compris) ; empties est modifié
  // Cases consommées par tour : on empile de plus en plus à mesure que le plateau se remplit
  const fillRate = (empties, adj) => (PARAMS.rateEnd + (PARAMS.rateStart - PARAMS.rateEnd) * Math.max(0, empties) / N) * adj;
  function simTurns(n, first, turn, bag, empties, final, rates) {
    const counts = new Array(n).fill(0);
    for (let guard = 0; guard < 4 * n + 80; guard++) {
      counts[turn]++;
      empties[turn] -= fillRate(empties[turn], rates[turn]);
      if (bag <= 0) final = true; else bag -= 3;
      if (empties[turn] <= 2) final = true;
      const next = (turn + 1) % n;
      if (final && next === first) break;
      turn = next;
    }
    return counts;
  }
  function buildCtx(state) {
    const n = state.players.length, bag = [0, 0, 0, 0, 0, 0, 0], mk = [0, 0, 0, 0, 0, 0, 0];
    for (const c of state.bag) bag[c]++;
    for (const m of state.market) for (const c of m) mk[c]++;
    const tot = state.bag.length + state.market.reduce((a, m) => a + m.length, 0);
    const prob = [0, 0, 0, 0, 0, 0, 0], supply = [0, 0, 0, 0, 0, 0, 0];
    for (let c = 1; c <= 6; c++) { prob[c] = tot ? (bag[c] + mk[c]) / tot : 0; supply[c] = mk[c] + bag[c] * Math.min(1, PARAMS.share / n); }
    const empties = state.players.map(p => E.emptyCount(p.board));
    // rythme de remplissage propre à chaque joueur : écart entre son historique et le rythme attendu (facteur borné)
    const rates = state.players.map((p, i) => {
      if (p.turns < 3) return 1;
      let em = N, expect = 0;
      for (let k = 0; k < p.turns; k++) { const r = fillRate(em, 1); expect += r; em -= r; }
      return Math.max(0.8, Math.min(1.25, (N - empties[i]) / expect));
    });
    const turns = simTurns(n, state.first, state.turn, state.bag.length, empties, state.finalRound, rates);
    const ctx = { state, n, side: state.opts.side, prob, supply, turns, rates, future: [], fresh: n === 2 ? 3 : 2 }; // lots « frais » parmi lesquels choisir (les autres joueurs se servent aussi)
    const T = turns[state.turn];
    const reveals = Math.min(state.deck.length, n * Math.max(0, T - 1) * 0.7);
    const deckW = PARAMS.deckW * (state.deck.length ? reveals / state.deck.length : 0);
    state.display.forEach(id => { if (id) ctx.future.push({ id, pts: CARD(id).pts, w: PARAMS.displayW }); });
    for (const id of state.deck) ctx.future.push({ id, pts: CARD(id).pts, w: deckW });
    for (const f of ctx.future) f.max = f.w * f.pts[f.pts.length - 1];
    ctx.future.sort((a, b) => b.max - a.max);
    return ctx;
  }
  // Tours restants de chacun une fois le tour du joueur `seat` joué, son plateau ayant `empties` cases vides
  function turnsAfter(ctx, seat, empties) {
    const state = ctx.state, n = state.players.length, em = state.players.map(p => E.emptyCount(p.board));
    em[seat] = empties;
    let bag = state.bag.length, final = state.finalRound;
    if (!state.market.every(m => !m.length)) { if (bag <= 0) final = true; else bag -= 3; }
    if (empties <= 2) final = true;
    const next = (seat + 1) % n;
    if (final && next === state.first) return new Array(n).fill(0);
    return simTurns(n, state.first, next, bag, em, final, ctx.rates);
  }

  // ---------- Recherche du tour ----------
  const scratchTT = new Int8Array(N), scratch = { ctx: null, cur: null, cubed: null, hand: null, spirit: null, T: 0, Tcards: 0, skipId: 0, slotsFree: 0, prev: null, reach: null, feasible: null, stamps: null, base: 0, landBase: 0 };
  // Valeur rapide d'un plateau t (après poses) : plan P reporté, tours restants selon que la partie se termine ou non
  function quickValue(pos, P, t, Tdef) {
    let empties = 0;
    for (let i = 0; i < N; i++) if (!t[i]) empties++;
    const T = empties <= 2 ? 0 : Tdef;
    scratch.ctx = pos.ctx; scratch.cur = t; scratch.cubed = pos.cubed; scratch.hand = pos.hand; scratch.spirit = pos.spirit;
    scratch.T = T; scratch.Tcards = T; scratch.skipId = pos.skipId; scratch.slotsFree = pos.slotsFree; scratch.prev = P;
    scratch.feasible = pos.feasible; // réalisations possibles depuis pos : un sur-ensemble de celles du plateau t (on n'a fait qu'ajouter des jetons)
    scratch.landBase = landscape(t, pos.ctx.side);
    return planValue(scratch, merge(P, t, pos.cubed, scratchTT));
  }
  function keyOf(t) { let s = ''; for (let i = 0; i < N; i++) s += String.fromCharCode(65 + t[i]); return s; }
  // Meilleures poses des jetons `colors` (faisceau de largeur W, `keep` résultats), notées par quickValue avec le plan P
  function bestPlacements(pos, P, colors, W, keep, Tdef) {
    let level = [{ t: pos.cur, left: colors.slice(), seq: [], v: 0 }];
    for (let depth = 0; depth < colors.length; depth++) {
      const next = [], keys = new Set();
      for (const part of level) {
        const tried = new Set();
        for (let li = 0; li < part.left.length; li++) {
          const color = part.left[li];
          if (tried.has(color)) continue;
          tried.add(color);
          const rest = part.left.slice();
          rest.splice(li, 1);
          const restKey = rest.slice().sort().join('');
          let any = false;
          for (let i = 0; i < N; i++) {
            if (pos.cubed[i]) continue;
            const c2 = PUSH[part.t[i]][color];
            if (c2 < 0) continue;
            any = true;
            const t2 = Int8Array.from(part.t);
            t2[i] = c2;
            const key = keyOf(t2) + restKey;
            if (keys.has(key)) continue;
            keys.add(key);
            next.push({ t: t2, left: rest, seq: part.seq.concat([{ color, cell: i }]), v: quickValue(pos, P, t2, Tdef) });
          }
          if (!any) { // jeton sans case légale : défaussé
            const key = keyOf(part.t) + 'd' + restKey;
            if (!keys.has(key)) { keys.add(key); next.push({ t: part.t, left: rest, seq: part.seq.concat([{ color, discard: true }]), v: quickValue(pos, P, part.t, Tdef) }); }
          }
        }
      }
      next.sort((a, b) => b.v - a.v);
      level = next.slice(0, depth === colors.length - 1 ? keep : W);
    }
    return level;
  }
  // Pose les cubes réalisables en respectant les cases réservées par le plan (owner) ; plan : cible (pour ne pas geler une case à faire grandir)
  function placeCubes(state, owner, plan, actions) {
    const board = E.current(state).board;
    for (let guard = 0; guard < 12; guard++) {
      let done = false;
      for (const pc of E.placeableCubes(state)) {
        let cell = pc.targets.find(c => owner[c] === pc.id);
        if (cell === undefined) cell = pc.targets.find(c => !owner[c] && (!plan || plan[c] === codeOf(board[c].s)));
        if (cell === undefined) continue;
        E.placeCube(state, pc.id, cell);
        actions.push({ a: 'cube', id: pc.id, cell });
        done = true;
        break;
      }
      if (!done) break;
    }
  }
  const memoKey = (state, seat) => (state.id || 'local') + ':' + seat;
  // Générateur déterministe : les candidats d'un même tour sont évalués avec la même suite aléatoire (bruit commun, classement plus fiable)
  function seededRng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }

  // Planifie et joue le tour du joueur courant sur `state` (mutation) ; renvoie la liste des actions.
  // opts : budget (ms, défaut 1500 ; la recherche se réduit si l'appareil est lent), iters (multiplicateur), fixed (ignorer le budget : déterministe)
  function playTurn(state, rng, opts) {
    rng = rng || Math.random; opts = opts || {};
    const started = now(), budget = opts.budget || 1500, mult = opts.iters || 1;
    const actions = [], seat = state.turn, p = state.players[seat], n = state.players.length;
    let scale = 1; // réduction des recherches si l'appareil est lent ou le budget serré (fixé après le plan principal)
    const it = k => Math.max(20, Math.round(k * mult * scale));
    const seedBase = Math.floor(rng() * 1e9), crn = k => seededRng(seedBase + k);
    // vitesse de l'appareil : quelques évaluations d'échauffement fixent le budget en évaluations du tour
    let per = 0.02;
    if (!opts.fixed) { const c0 = buildCtx(state), p0 = posOf(c0, seat), t0 = now(); for (let k = 0; k < 300; k++) planValue(p0, p0.cur); per = Math.max(0.002, (now() - t0) / 300); }
    const evalBudget = opts.fixed ? 60000 * mult : Math.max(8000, budget / per), evalStart = evalCount;
    // 1. Esprit de la Nature : celui dont le plan vaut le plus
    if (p.spiritChoices) {
      const ctx0 = buildCtx(state);
      let pick = p.spiritChoices[0], bestV = -Infinity;
      for (const id of p.spiritChoices) {
        const pos = posOf(ctx0, seat, { spirit: { id, placed: false } });
        const v = polish(pos, Int8Array.from(pos.cur), planValue(pos, pos.cur), 4, true, evalBudget * 0.08).v;
        if (v > bestV) { bestV = v; pick = id; }
      }
      E.chooseSpirit(state, pick);
      actions.push({ a: 'spirit', id: pick });
    }
    // 2. Plan principal (démarrage à chaud sur le plan du tour précédent)
    const memoRec = MEMO.get(memoKey(state, seat)), memo = memoRec && memoRec.turnNo < state.turnNo ? memoRec.t : null;
    let ctx = buildCtx(state), pos0 = posOf(ctx, seat, { prev: memo });
    const start0 = memo ? merge(memo, pos0.cur, pos0.cubed, new Int8Array(N)) : Int8Array.from(pos0.cur);
    let P0 = polish(pos0, start0, planValue(pos0, start0), 8, true, evalBudget * 0.4); // déterministe (un recuit n'apporte rien de plus)
    // le reste du tour (plans adverses, options de carte, candidats) coûte ~45 000 évaluations à l'échelle 1
    scale = Math.max(0.1, Math.min(1, (evalBudget - (evalCount - evalStart)) / (45000 + 6000 * (n - 1))));
    // 3. Cubes déjà réalisables sur les cases que le plan réserve
    placeCubes(state, claimsOf(pos0, P0.t), P0.t, actions);
    if (actions.some(a => a.a === 'cube')) { ctx = buildCtx(state); pos0 = posOf(ctx, seat, { prev: memo }); P0 = { t: merge(P0.t, pos0.cur, pos0.cubed, new Int8Array(N)) }; P0.v = planValue(pos0, P0.t); }
    // 4. Adversaires : leur plan, ce que chaque carte visible et chaque lot leur rapporteraient (pour la gêne et la projection)
    const opps = [];
    for (let j = 0; j < n; j++) {
      if (j === seat) continue;
      const pj = posOf(ctx, j), Pj = polish(pj, Int8Array.from(pj.cur), planValue(pj, pj.cur), 4, false, 4000 * scale);
      const score = E.scorePlayer(state.players[j], ctx.side).total;
      const rate = Math.max(2, Math.min(12, (Pj.v - score) / Math.max(1, ctx.turns[j])));
      const cardGain = {};
      if (E.activeCount(state.players[j]) < E.MAX_ACTIVE_CARDS) for (const id of state.display) if (id) { const pc = posOf(ctx, j, { addCard: id }); const start = merge(Pj.t, pc.cur, pc.cubed, new Int8Array(N)); cardGain[id] = polish(pc, start, planValue(pc, start), 2).v - Pj.v; }
      const slotVal = state.market.map(m => (m.length ? bestPlacements(pj, Pj.t, m, Math.max(2, Math.round(2 * scale)), 1, Math.max(0, ctx.turns[j] - 1))[0].v : -Infinity));
      opps.push({ seat: j, score, rate, cardGain, slotVal });
    }
    const second = (obj, key) => { let b = -Infinity; for (const k in obj) if (k !== String(key) && obj[k] > b) b = obj[k]; return b === -Infinity ? 0 : b; };
    const denyCard = id => (id ? opps.reduce((a, o) => a + (id in o.cardGain ? Math.max(0, o.cardGain[id] - second(o.cardGain, id)) : 0), 0) * PARAMS.denyCard / Math.max(1, n - 1) : 0);
    const denySlot = s => opps.reduce((a, o) => { const others = o.slotVal.filter((_, k) => k !== s && state.market[k].length); return a + Math.max(0, o.slotVal[s] - (others.length ? Math.max(...others) : o.slotVal[s])); }, 0) * PARAMS.denySlot / Math.max(1, n - 1);
    // Objectif : mon score projeté moins la moyenne des projections adverses (qui dépendent des tours qu'il leur reste)
    const objective = (myV, turns, cardId, slot) => {
      if (!opps.length) return myV;
      let opp = 0;
      for (const o of opps) opp += o.score + o.rate * turns[o.seat];
      return myV - opp / opps.length + denyCard(cardId) + (slot !== null ? denySlot(slot) : 0);
    };
    // 5. Options de carte : aucune, ou l'une des meilleures cartes visibles (pour moi, ou à retirer à l'adversaire)
    const options = [{ id: 0, slot: -1, pos: pos0, P: P0.t, v: P0.v }];
    if (E.canTakeCard(state)) {
      const cands = [];
      state.display.forEach((id, slot) => {
        if (!id) return;
        const pc = posOf(ctx, seat, { addCard: id, prev: P0.t }), start = merge(P0.t, pc.cur, pc.cubed, new Int8Array(N));
        const Pc = polish(pc, start, planValue(pc, start), 3, false, 2500 * scale);
        cands.push({ id, slot, pos: pc, P: Pc.t, v: Pc.v - PARAMS.cardMargin, score: Pc.v - PARAMS.cardMargin + denyCard(id) });
      });
      cands.sort((a, b) => b.score - a.score);
      options.push(...cands.filter(c => c.score > P0.v).slice(0, 2));
    }
    // 6. Poses candidates par option et par lot, notées avec le plan de l'option ; puis re-planification des meilleures
    const Tdef = Math.max(0, ctx.turns[seat] - 1), W = Math.max(2, Math.round(4 * scale));
    let cands = [];
    for (const opt of options) {
      state.market.forEach((m, slot) => {
        if (!m.length) return;
        for (const pl of bestPlacements(opt.pos, opt.P, m, W, 2, Tdef)) cands.push({ opt, slot, seq: pl.seq, t: pl.t, v1: pl.v });
      });
    }
    if (!cands.length) cands = options.map(opt => ({ opt, slot: null, seq: [], t: opt.pos.cur, v1: opt.v })); // plateau central vide (fin de partie)
    // entonnoir : 30 candidats re-planifiés brièvement, puis 6, puis 3 avec le polissage complet (même suite aléatoire pour tous)
    const stages = [{ keep: 30, iters: 200, rounds: 1, evals: 400, seed: 2 }, { keep: 6, iters: 800, rounds: 2, evals: 1500, seed: 3 }, { keep: 3, iters: 1500, rounds: 3, pairs: true, evals: 4000, seed: 4 }];
    for (const stage of stages) {
      cands.sort((a, b) => (b.obj === undefined ? b.v1 : b.obj) - (a.obj === undefined ? a.v1 : a.obj));
      cands = cands.slice(0, stage.keep);
      for (const c of cands) {
        if (!c.pos) {
          let empties = 0;
          for (let i = 0; i < N; i++) if (!c.t[i]) empties++;
          c.turns = turnsAfter(ctx, seat, empties);
          const T = c.turns[seat];
          c.pos = makePos(ctx, c.t, pos0.cubed, c.opt.pos.hand, pos0.spirit, T, T, c.opt.id, c.opt.P);
          c.plan = merge(c.opt.P, c.t, pos0.cubed, new Int8Array(N));
        }
        const r = optimize(c.pos, c.plan, it(stage.iters), crn(stage.seed), 0.8, stage.rounds, stage.pairs, stage.evals * scale);
        if (c.v === undefined || r.v > c.v) { c.plan = r.t; c.v = r.v; } // meilleur plan trouvé (la valeur vraie est au moins celle-là)
        c.obj = objective(c.v, c.turns, c.opt.id, c.slot);
      }
    }
    cands.sort((a, b) => b.obj - a.obj);
    const best = cands[0];
    // 7. Exécution : carte, jetons, cubes (sur les cases que le plan final réserve), carte tardive si aucune prise, cubes
    if (best.opt.id) { E.takeCard(state, best.opt.slot); actions.push({ a: 'card', id: best.opt.id, slot: best.opt.slot }); }
    if (best.slot !== null) {
      E.takeTokens(state, best.slot);
      actions.push({ a: 'take', slot: best.slot, tokens: state.cur.tokens.slice() });
      for (const s of best.seq) {
        const hi = state.cur.tokens.indexOf(s.color);
        if (s.discard) { E.discardToken(state, hi); actions.push({ a: 'discard', color: s.color }); }
        else { E.placeToken(state, hi, s.cell); actions.push({ a: 'place', color: s.color, cell: s.cell }); }
      }
      while (state.cur.tokens.length) { // sécurité : jeton restant
        const c = state.cur.tokens[0], legal = E.legalCells(p.board, c);
        if (legal.length) { E.placeToken(state, 0, legal[0]); actions.push({ a: 'place', color: c, cell: legal[0] }); }
        else { E.discardToken(state, 0); actions.push({ a: 'discard', color: c }); }
      }
    }
    let final = best.plan, finalPos = best.pos;
    placeCubes(state, claimsOf(finalPos, final), final, actions);
    if (!best.opt.id && E.canTakeCard(state)) {
      // carte tardive : une place s'est libérée ou un motif vient d'être terminé
      const ctx2 = buildCtx(state), base = posOf(ctx2, seat, { prev: final });
      const T = Math.max(0, ctx2.turns[seat] - 1); base.T = T; base.Tcards = T;
      const baseV = optimize(base, merge(final, base.cur, base.cubed, new Int8Array(N)), it(300), crn(5), 0.5, 2).v;
      let pick = null, bestV = baseV + 1;
      state.display.forEach((id, slot) => {
        if (!id) return;
        const pc = posOf(ctx2, seat, { addCard: id, prev: final }); pc.T = T; pc.Tcards = T;
        const r = optimize(pc, merge(final, pc.cur, pc.cubed, new Int8Array(N)), it(300), crn(5), 0.5, 2);
        const v = r.v - PARAMS.cardMargin + denyCard(id);
        if (v > bestV) { bestV = v; pick = { id, slot, plan: r.t, pos: pc }; }
      });
      if (pick) { E.takeCard(state, pick.slot); actions.push({ a: 'card', id: pick.id, slot: pick.slot }); final = pick.plan; finalPos = pick.pos; placeCubes(state, claimsOf(finalPos, final), final, actions); }
    }
    MEMO.set(memoKey(state, seat), { t: final, turnNo: state.turnNo });
    if (MEMO.size > 64) MEMO.delete(MEMO.keys().next().value);
    const detail = {};
    planValue(finalPos, final, detail);
    playTurn.last = { plan: final, pos: finalPos, value: best.v, objective: best.obj, ms: now() - started, scale, evals: evalCount - evalStart, detail,
      options: options.map(o => ({ id: o.id, v: o.v, deny: denyCard(o.id) })), top: cands.slice(0, 4).map(c => ({ card: c.opt.id, slot: c.slot, seq: c.seq, v: c.v, obj: c.obj, deny: denySlot(c.slot === null ? 0 : c.slot) })), opps };
    return actions;
  }

  // Réalisations prévues par le plan t pour les cartes en main : { id, n, ks (jetons manquants par réalisation), expected }
  function claimed(pos, t) {
    planValue(pos, t);
    const out = [];
    claimGen++;
    for (const h of pos.hand) {
      const n = matchCount(instOf(pos, h.id), t, pos.cur, pos.cubed, h.left, true);
      out.push({ id: h.id, n, ks: Array.from(kBuf.slice(0, n)), placed: h.placed, left: h.left });
    }
    return out;
  }
  // Plan d'un joueur depuis l'état courant (pour les tests et l'affichage) : cible par case, valeur projetée (déterministe)
  function plan(state, seat, maxEvals) {
    const ctx = buildCtx(state), pos = posOf(ctx, seat);
    const r = polish(pos, Int8Array.from(pos.cur), planValue(pos, pos.cur), 8, true, maxEvals || 30000);
    return { t: r.t, value: r.v, base: pos.base, stacks: Array.from(r.t, c => STACKS[c].slice()), turns: ctx.turns };
  }

  return { playTurn, plan, planValue, optimize, polish, claimed, buildCtx, posOf, landscape, spiritPts, codeOf, STACKS, PUSH, EXT, INST, PARAMS, MEMO };
});
