// Moteur de règles Harmonies (Libellud, 2024) — logique pure, sans DOM.
// Fonctionne dans le navigateur (globals) et sous Node (module.exports) pour les tests.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./cards.js').CARDS);
  else root.Engine = factory(root.CARDS);
})(typeof self !== 'undefined' ? self : this, function (CARDS) {
  'use strict';

  // ---------- Constantes ----------
  const COLOR_NAMES = { 1: 'water', 2: 'mountain', 3: 'trunk', 4: 'foliage', 5: 'field', 6: 'building' };
  const TOKEN_COUNTS = { 1: 23, 2: 23, 3: 21, 4: 19, 5: 19, 6: 15 }; // 120 jetons
  const CARD_BY_ID = new Map(CARDS.map(c => [c.id, c]));
  const ANIMAL_IDS = CARDS.filter(c => !c.spirit).map(c => c.id);
  const SPIRIT_IDS = CARDS.filter(c => c.spirit).map(c => c.id);
  const MAX_ACTIVE_CARDS = 4;

  // ---------- Plateau : hexagones à sommet plat, colonnes décalées (odd-q) ----------
  // 5 colonnes : colonnes paires 5 cases (r 0..4), colonnes impaires 4 cases (r 0..3), décalées d'une demi-case vers le bas.
  const CELLS = [];
  for (let c = 0; c < 5; c++) {
    const n = c % 2 === 0 ? 5 : 4;
    for (let r = 0; r < n; r++) CELLS.push({ c, r });
  }
  const cellKey = (c, r) => c + ',' + r;
  const CELL_INDEX = new Map(CELLS.map((cell, i) => [cellKey(cell.c, cell.r), i]));
  const DIRS_EVEN = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]];
  const DIRS_ODD = [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  function neighborCoord(c, r, d) {
    const dd = (c & 1) ? DIRS_ODD[d] : DIRS_EVEN[d];
    return { c: c + dd[0], r: r + dd[1] };
  }
  const NEIGHBORS = CELLS.map(({ c, r }) => {
    const res = [];
    for (let d = 0; d < 6; d++) {
      const n = neighborCoord(c, r, d);
      const i = CELL_INDEX.get(cellKey(n.c, n.r));
      if (i !== undefined) res.push(i);
    }
    return res;
  });

  // ---------- Utilitaires ----------
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const top = s => (s.length ? s[s.length - 1] : 0);
  const isMountain = s => s.length > 0 && s.every(t => t === 2);
  const isBuilding = s => s.length === 2 && s[1] === 6 && (s[0] === 2 || s[0] === 3 || s[0] === 6);
  function treeHeight(s) {
    // hauteur d'un arbre (feuillage sur 0, 1 ou 2 troncs), 0 sinon
    if (top(s) !== 4) return 0;
    for (let i = 0; i < s.length - 1; i++) if (s[i] !== 3) return 0;
    return s.length;
  }
  function emptyBoard() {
    return CELLS.map(() => ({ s: [], cube: null }));
  }

  // ---------- Règles de pose ----------
  // Le schéma officiel : niveau 3 = gris sur gris-gris, vert sur marron-marron ; niveau 2 = gris/gris, rouge/gris, rouge/rouge,
  // rouge/marron, marron/marron, vert/marron ; niveau 1 = n'importe quelle couleur. Bleu et jaune uniquement au sol.
  function canPlace(cell, color) {
    if (cell.cube) return false;
    const s = cell.s, h = s.length;
    if (h >= 3) return false;
    switch (color) {
      case 1: case 5: return h === 0;
      case 2: return s.every(t => t === 2);
      case 3: return h < 2 && s.every(t => t === 3);
      case 4: return s.every(t => t === 3);
      case 6: return h < 2 && (h === 0 || s[h - 1] === 2 || s[h - 1] === 3 || s[h - 1] === 6);
      default: return false;
    }
  }
  function legalCells(board, color) {
    const out = [];
    for (let i = 0; i < board.length; i++) if (canPlace(board[i], color)) out.push(i);
    return out;
  }

  // ---------- Motifs des cartes ----------
  function patternCells(originIdx, pat, rot) {
    let { c, r } = CELLS[originIdx];
    const res = [originIdx];
    for (let k = 1; k < pat.length; k++) {
      const n = neighborCoord(c, r, (pat[k].d + rot) % 6);
      const i = CELL_INDEX.get(cellKey(n.c, n.r));
      if (i === undefined) return null;
      res.push(i);
      c = n.c; r = n.r;
    }
    return res;
  }
  function stackMatches(s, want) {
    if (want.length === 2 && want[0] === 6 && want[1] === 7) return isBuilding(s);
    if (s.length !== want.length) return false;
    for (let i = 0; i < want.length; i++) if (s[s.length - 1 - i] !== want[i]) return false;
    return true;
  }
  // Toutes les réalisations du motif de la carte sur le plateau (rotations 0..5), cube posable uniquement sur une case libre de cube.
  function findMatches(board, card) {
    const out = [], seen = new Set();
    for (let o = 0; o < CELLS.length; o++) {
      for (let rot = 0; rot < 6; rot++) {
        const cells = patternCells(o, card.pat, rot);
        if (!cells) continue;
        let ok = true, cubeCell = -1;
        for (let k = 0; k < cells.length && ok; k++) {
          const cell = board[cells[k]];
          if (!stackMatches(cell.s, card.pat[k].s)) ok = false;
          else if (card.pat[k].cube) { cubeCell = cells[k]; if (cell.cube) ok = false; }
        }
        if (!ok) continue;
        const sig = cells.slice().sort((a, b) => a - b).join('-') + ':' + cubeCell;
        if (!seen.has(sig)) { seen.add(sig); out.push({ cells, cubeCell }); }
      }
    }
    return out;
  }
  function cubeTargets(board, card) {
    const set = new Set();
    for (const m of findMatches(board, card)) set.add(m.cubeCell);
    return [...set];
  }

  // ---------- Score ----------
  function components(indices) {
    const inSet = new Set(indices), seen = new Set(), groups = [];
    for (const start of indices) {
      if (seen.has(start)) continue;
      const group = [], stack = [start];
      seen.add(start);
      while (stack.length) {
        const i = stack.pop();
        group.push(i);
        for (const j of NEIGHBORS[i]) if (inSet.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
      groups.push(group);
    }
    return groups;
  }
  // Longueur de la meilleure rivière : nombre de jetons du plus court chemin entre les deux extrémités les plus éloignées.
  function longestRiver(board) {
    const water = new Set();
    board.forEach((cell, i) => { if (top(cell.s) === 1) water.add(i); });
    let best = 0;
    for (const start of water) {
      const dist = new Map([[start, 1]]);
      const queue = [start];
      while (queue.length) {
        const i = queue.shift();
        const d = dist.get(i);
        if (d > best) best = d;
        for (const j of NEIGHBORS[i]) if (water.has(j) && !dist.has(j)) { dist.set(j, d + 1); queue.push(j); }
      }
    }
    return best;
  }
  function riverPoints(n) {
    if (n < 2) return 0;
    const table = [0, 0, 2, 5, 8, 11, 15];
    return n <= 6 ? table[n] : 15 + 4 * (n - 6);
  }
  function islands(board) {
    const land = [];
    board.forEach((cell, i) => { if (top(cell.s) !== 1) land.push(i); });
    return Math.max(1, components(land).length);
  }
  function scoreLandscape(board, side) {
    let trees = 0, mountains = 0, buildings = 0;
    board.forEach((cell, i) => {
      const s = cell.s;
      const th = treeHeight(s);
      if (th) trees += [0, 1, 3, 7][th];
      if (isMountain(s) && NEIGHBORS[i].some(j => isMountain(board[j].s))) mountains += [0, 1, 3, 7][s.length];
      if (isBuilding(s)) {
        const colors = new Set();
        for (const j of NEIGHBORS[i]) { const t = top(board[j].s); if (t) colors.add(t); }
        if (colors.size >= 3) buildings += 5;
      }
    });
    const fieldCells = [];
    board.forEach((cell, i) => { if (top(cell.s) === 5) fieldCells.push(i); });
    const fields = components(fieldCells).filter(g => g.length >= 2).length * 5;
    const water = side === 'B' ? islands(board) * 5 : riverPoints(longestRiver(board));
    return { trees, mountains, fields, buildings, water };
  }
  function cardValue(card, cubesLeft) {
    const placed = card.pts.length - cubesLeft;
    return placed > 0 ? card.pts[placed - 1] : 0;
  }
  function scoreSpirit(board, id) {
    const groupsOf = pred => components(board.map((cell, i) => (pred(cell.s) ? i : -1)).filter(i => i >= 0));
    const countTrees = hs => board.filter(cell => hs.includes(treeHeight(cell.s))).length;
    const countMountains = hs => board.filter(cell => isMountain(cell.s) && hs.includes(cell.s.length)).length;
    switch (id) {
      case 33: return groupsOf(s => top(s) === 5).reduce((a, g) => a + (g.length >= 3 ? 10 : 2), 0);
      case 34: return groupsOf(s => top(s) === 5).length * 5;
      case 35: return countTrees([2, 3]) * 4;
      case 36: return countTrees([1, 2]) * 3 + countTrees([3]);
      case 37: return groupsOf(isBuilding).length * 4;
      case 38: return groupsOf(isBuilding).filter(g => g.length >= 2).length * 6;
      case 39: return countMountains([2, 3]) * 4;
      case 40: return countMountains([1, 2]) * 3 + countMountains([3]);
      case 41: return groupsOf(s => top(s) === 1).filter(g => g.length >= 2).length * 7;
      case 42: return board.filter(cell => top(cell.s) === 1).length * 2;
      default: return 0;
    }
  }
  function scorePlayer(player, side) {
    const land = scoreLandscape(player.board, side);
    let animals = 0;
    for (const h of player.hand) animals += cardValue(CARD_BY_ID.get(h.id), h.left);
    for (const d of player.done) animals += cardValue(CARD_BY_ID.get(d.id), 0);
    const spirit = player.spirit && player.spirit.placed ? scoreSpirit(player.board, player.spirit.id) : 0;
    const total = land.trees + land.mountains + land.fields + land.buildings + land.water + animals + spirit;
    return Object.assign(land, { animals, spirit, total });
  }

  // ---------- Partie ----------
  function newGame(opts, players, rng) {
    rng = rng || Math.random;
    const bag = [];
    for (const [color, n] of Object.entries(TOKEN_COUNTS)) for (let i = 0; i < n; i++) bag.push(Number(color));
    shuffle(bag, rng);
    const market = [];
    for (let i = 0; i < 5; i++) market.push(bag.splice(-3, 3));
    const deck = shuffle(ANIMAL_IDS.slice(), rng);
    const display = deck.splice(-5, 5);
    const spiritDeck = shuffle(SPIRIT_IDS.slice(), rng);
    const state = {
      v: 1,
      status: 'playing',
      opts: { side: opts.side === 'B' ? 'B' : 'A', spirits: !!opts.spirits },
      players: players.map((p, i) => ({
        token: p.token, name: p.name, seat: i, bot: p.bot || 0, avatar: p.avatar || 0,
        board: emptyBoard(), hand: [], done: [], cubes: 0,
        spirit: null,
        spiritChoices: opts.spirits ? spiritDeck.splice(-2, 2) : null,
        turns: 0,
      })),
      bag, market, deck, display,
      first: Math.floor(rng() * players.length),
      turn: 0, turnNo: 1,
      finalRound: false, endReason: null,
      log: [],
      cur: null,
    };
    state.turn = state.first;
    state.cur = newTurn();
    return state;
  }
  function newTurn() {
    return { slot: null, tokens: [], cardTaken: false, actions: [] };
  }
  const current = state => state.players[state.turn];
  const activeCount = p => p.hand.length + (p.spirit && !p.spirit.placed ? 1 : 0);
  const emptyCount = board => board.filter(cell => cell.s.length === 0).length;

  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  function takeTokens(state, slot) {
    assert(state.status === 'playing', 'the game is over');
    assert(state.cur.slot === null, 'tokens already taken this turn');
    assert(slot >= 0 && slot < 5 && state.market[slot].length > 0, 'empty slot');
    state.cur.slot = slot;
    state.cur.tokens = state.market[slot].slice();
    state.market[slot] = [];
    state.cur.actions.push({ a: 'take', slot, tokens: state.cur.tokens.slice() });
  }
  function placeToken(state, handIdx, cellIdx) {
    const cur = state.cur;
    assert(handIdx >= 0 && handIdx < cur.tokens.length, 'invalid token');
    const color = cur.tokens[handIdx];
    const cell = current(state).board[cellIdx];
    assert(cell && canPlace(cell, color), 'illegal placement');
    cell.s.push(color);
    cur.tokens.splice(handIdx, 1);
    cur.actions.push({ a: 'place', color, cell: cellIdx });
  }
  // Un jeton sans aucune case légale est défaussé (cas limite de fin de partie).
  function discardToken(state, handIdx) {
    const cur = state.cur;
    const color = cur.tokens[handIdx];
    assert(color !== undefined, 'invalid token');
    assert(legalCells(current(state).board, color).length === 0, 'this token can still be placed');
    cur.tokens.splice(handIdx, 1);
    cur.actions.push({ a: 'discard', color });
  }
  function canTakeCard(state) {
    return state.status === 'playing' && !state.cur.cardTaken && activeCount(current(state)) < MAX_ACTIVE_CARDS;
  }
  function takeCard(state, displayIdx) {
    assert(canTakeCard(state), 'you cannot take a card now');
    const id = state.display[displayIdx];
    assert(id, 'empty slot');
    const card = CARD_BY_ID.get(id);
    state.display[displayIdx] = null;
    current(state).hand.push({ id, left: card.pts.length });
    state.cur.cardTaken = true;
    state.cur.actions.push({ a: 'card', id, slot: displayIdx });
  }
  function chooseSpirit(state, id) {
    const p = current(state);
    assert(p.spiritChoices && p.spiritChoices.includes(id), 'invalid choice');
    p.spirit = { id, placed: false };
    p.spiritChoices = null;
    state.cur.actions.push({ a: 'spirit', id });
  }
  // Cartes (main + esprit) pour lesquelles un cube est posable, avec les cases candidates.
  function placeableCubes(state) {
    const p = current(state);
    const out = [];
    for (const h of p.hand) {
      const targets = cubeTargets(p.board, CARD_BY_ID.get(h.id));
      if (targets.length) out.push({ id: h.id, targets });
    }
    if (p.spirit && !p.spirit.placed) {
      const targets = cubeTargets(p.board, CARD_BY_ID.get(p.spirit.id));
      if (targets.length) out.push({ id: p.spirit.id, targets, spirit: true });
    }
    return out;
  }
  function placeCube(state, cardId, cellIdx) {
    const p = current(state);
    const card = CARD_BY_ID.get(cardId);
    assert(card, 'unknown card');
    assert(cubeTargets(p.board, card).includes(cellIdx), 'habitat not completed on that space');
    if (card.spirit) {
      assert(p.spirit && p.spirit.id === cardId && !p.spirit.placed, 'spirit cube already placed');
      p.spirit.placed = true;
      p.board[cellIdx].cube = { id: cardId, sp: true };
    } else {
      const hi = p.hand.findIndex(h => h.id === cardId);
      assert(hi >= 0, 'card not in hand');
      const h = p.hand[hi];
      h.left -= 1;
      p.board[cellIdx].cube = { id: cardId };
      if (h.left === 0) { p.hand.splice(hi, 1); p.done.push({ id: cardId, left: 0 }); }
    }
    p.cubes += 1;
    state.cur.actions.push({ a: 'cube', id: cardId, cell: cellIdx });
  }
  function turnStatus(state) {
    const p = current(state), cur = state.cur;
    const marketEmpty = state.market.every(m => m.length === 0);
    const reasons = [];
    if (cur.slot === null && !marketEmpty) reasons.push('take 3 tokens');
    if (cur.tokens.length) reasons.push('place your tokens (' + cur.tokens.length + ')');
    if (p.spiritChoices) reasons.push('choose your Spirit');
    return { ok: reasons.length === 0, reasons };
  }
  function endTurn(state) {
    const st = turnStatus(state);
    assert(st.ok, st.reasons.join(', '));
    const p = current(state), cur = state.cur;
    p.turns += 1;
    // Recharge du plateau central
    if (cur.slot !== null) {
      if (state.bag.length === 0) { state.finalRound = true; state.endReason = state.endReason || 'bag'; }
      else state.market[cur.slot] = state.bag.splice(-Math.min(3, state.bag.length));
    }
    // Recharge des cartes Animaux
    for (let i = 0; i < 5; i++) if (!state.display[i] && state.deck.length) state.display[i] = state.deck.pop();
    // Fin de partie : 2 cases vides ou moins
    if (emptyCount(p.board) <= 2) { state.finalRound = true; state.endReason = state.endReason || 'board'; }
    state.log.push({ n: state.turnNo, p: state.turn, actions: cur.actions });
    if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
    const next = (state.turn + 1) % state.players.length;
    if (state.finalRound && next === state.first) {
      state.status = 'finished';
      state.cur = null;
      state.result = finalResult(state);
    } else {
      state.turn = next;
      state.turnNo += 1;
      state.cur = newTurn();
    }
  }
  function finalResult(state) {
    const scores = state.players.map((p, i) => Object.assign({ seat: i, name: p.name, cubes: p.cubes }, scorePlayer(p, state.opts.side)));
    const ranked = scores.slice().sort((a, b) => b.total - a.total || b.cubes - a.cubes);
    const best = ranked[0];
    const winners = ranked.filter(s => s.total === best.total && s.cubes === best.cubes).map(s => s.seat);
    return { scores, winners };
  }

  // Résumé texte des actions d'un tour (pour le journal).
  const COLOR_EMOJI = { 1: '🟦', 2: '⬜', 3: '🟫', 4: '🟩', 5: '🟨', 6: '🟥' };
  function describeActions(actions) {
    const parts = [];
    for (const a of actions) {
      if (a.a === 'take') parts.push(a.tokens.map(t => COLOR_EMOJI[t]).join(''));
      else if (a.a === 'card') parts.push('card ' + CARD_BY_ID.get(a.id).en);
      else if (a.a === 'cube') parts.push('cube ' + CARD_BY_ID.get(a.id).emoji + ' ' + CARD_BY_ID.get(a.id).en);
      else if (a.a === 'spirit') parts.push('spirit ' + CARD_BY_ID.get(a.id).en);
      else if (a.a === 'discard') parts.push('discards ' + COLOR_EMOJI[a.color]);
    }
    return parts.join(' · ');
  }

  return {
    CARDS, CARD_BY_ID, COLOR_NAMES, COLOR_EMOJI, TOKEN_COUNTS, CELLS, NEIGHBORS, MAX_ACTIVE_CARDS,
    neighborCoord, canPlace, legalCells, patternCells, stackMatches, findMatches, cubeTargets,
    components, longestRiver, riverPoints, islands, scoreLandscape, scoreSpirit, scorePlayer, cardValue,
    newGame, newTurn, current, activeCount, emptyCount, takeTokens, placeToken, discardToken,
    canTakeCard, takeCard, chooseSpirit, placeableCubes, placeCube, turnStatus, endTurn, finalResult,
    describeActions, shuffle, clone, emptyBoard, treeHeight, isMountain, isBuilding, top,
  };
});
