// Joueurs artificiels (3 niveaux). Pur : planifie un tour complet sur une copie de l'état, sans DOM.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Bot = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const NAMES = ['Fennec', 'Otter', 'Owl', 'Koala', 'Penguin', 'Alpaca', 'Beaver', 'Panther'];
  const LEVELS = { 1: 'novice', 2: 'skilled', 3: 'expert' };
  // Avatar (id de carte Animal) associé à chaque nom de bot
  const AVATARS = { Fennec: 23, Otter: 4, Owl: 36, Koala: 18, Penguin: 21, Alpaca: 28, Beaver: 40, Panther: 32 };
  const avatarFor = name => AVATARS[String(name || '').replace(/^Bot /, '')] || 26;

  // Pile actuelle compatible avec la pile requise (préfixe, du bas vers le haut) ?
  function compatible(cell, want) {
    if (cell.cube) return false;
    const need = want.length === 2 && want[0] === 6 && want[1] === 7 ? null : want.slice().reverse(); // null = bâtiment (X puis rouge)
    const s = cell.s;
    if (need === null) {
      if (s.length === 0) return true;
      if (s.length === 1) return s[0] === 2 || s[0] === 3 || s[0] === 6;
      return E.isBuilding(s);
    }
    if (s.length > need.length) return false;
    for (let i = 0; i < s.length; i++) if (s[i] !== need[i]) return false;
    return true;
  }
  // Potentiel d'une carte sur un plateau : meilleure proportion de cases déjà conformes parmi les placements encore possibles.
  function potential(board, card) {
    let best = 0;
    for (let o = 0; o < E.CELLS.length && best < 1; o++) {
      for (let rot = 0; rot < 6; rot++) {
        const cells = E.patternCells(o, card.pat, rot);
        if (!cells) continue;
        let ok = 0, possible = true;
        for (let k = 0; k < cells.length; k++) {
          const cell = board[cells[k]], want = card.pat[k].s;
          if (E.stackMatches(cell.s, want)) { if (card.pat[k].cube && cell.cube) { possible = false; break; } ok++; }
          else if (!compatible(cell, want)) { possible = false; break; }
        }
        if (possible && ok / cells.length > best) best = ok / cells.length;
      }
    }
    return best;
  }
  function nextValue(card, left) {
    const placed = card.pts.length - left;
    return left > 0 ? card.pts[placed] - (placed ? card.pts[placed - 1] : 0) : 0;
  }
  // Gain immédiat des cubes posables (valeur du prochain palier de chaque carte réalisée)
  function cubeGain(state) {
    const p = E.current(state);
    let gain = 0;
    for (const pc of E.placeableCubes(state)) {
      const card = E.CARD_BY_ID.get(pc.id);
      if (card.spirit) gain += 8;
      else { const h = p.hand.find(x => x.id === pc.id); gain += nextValue(card, h.left); }
    }
    return gain;
  }
  function evaluate(state, level) {
    const p = E.current(state);
    let v = E.scoreLandscape(p.board, state.opts.side);
    v = v.trees + v.mountains + v.fields + v.buildings + v.water;
    v += cubeGain(state) * 1.1;
    if (level >= 3) {
      for (const h of p.hand) { const card = E.CARD_BY_ID.get(h.id); const pot = potential(p.board, card); v += pot * pot * nextValue(card, h.left) * 0.8; }
      if (p.spirit && !p.spirit.placed) { const pot = potential(p.board, E.CARD_BY_ID.get(p.spirit.id)); v += pot * pot * 6; }
      // garder de la place : pénalité douce quand le plateau se remplit vite
      v -= Math.max(0, 6 - E.emptyCount(p.board)) * 0.5;
    }
    return v;
  }
  function perms3(a) {
    const [x, y, z] = a;
    return [[x, y, z], [x, z, y], [y, x, z], [y, z, x], [z, x, y], [z, y, x]];
  }
  function placeAllCubes(state, actions, rng, level) {
    let guard = 0;
    while (guard++ < 12) {
      const pcs = E.placeableCubes(state);
      if (!pcs.length) break;
      const pc = pcs[0];
      const target = level === 1 ? pc.targets[Math.floor(rng() * pc.targets.length)] : pc.targets[0];
      E.placeCube(state, pc.id, target);
      actions.push({ a: 'cube', id: pc.id, cell: target });
    }
  }
  // Note d'une carte de la rivière pour ce joueur (valeur, faisabilité, cubes)
  function cardAppeal(state, card, level) {
    const p = E.current(state);
    const max = card.pts[card.pts.length - 1];
    const pot = potential(p.board, card);
    const now = E.cubeTargets(p.board, card).length > 0 ? 1 : 0;
    return max * (0.35 + 0.65 * pot) / Math.sqrt(card.pts.length) + now * 6 + (level >= 3 ? card.pts[0] * 0.3 : 0);
  }

  // Planifie et applique le tour du joueur courant sur `state` (mutation) ; renvoie la liste des actions.
  function playTurn(state, level, rng) {
    rng = rng || Math.random;
    level = Math.max(1, Math.min(3, level | 0));
    const actions = [];
    const p = E.current(state);
    if (p.spiritChoices) {
      let pick = p.spiritChoices[Math.floor(rng() * 2)];
      if (level >= 2) pick = p.spiritChoices.slice().sort((a, b) => potential(p.board, E.CARD_BY_ID.get(b)) - potential(p.board, E.CARD_BY_ID.get(a)) || E.CARD_BY_ID.get(a).pat.length - E.CARD_BY_ID.get(b).pat.length)[0];
      E.chooseSpirit(state, pick);
      actions.push({ a: 'spirit', id: pick });
    }
    placeAllCubes(state, actions, rng, level);
    // carte immédiatement réalisable ? on la prend d'abord
    const tryCard = when => {
      if (!E.canTakeCard(state)) return false;
      const ids = state.display.map((id, i) => (id ? i : -1)).filter(i => i >= 0);
      if (!ids.length) return false;
      if (level === 1) {
        if (when === 'late' && rng() < 0.6) { const i = ids[Math.floor(rng() * ids.length)]; const id = state.display[i]; E.takeCard(state, i); actions.push({ a: 'card', id, slot: i }); return true; }
        return false;
      }
      const scored = ids.map(i => ({ i, s: cardAppeal(state, E.CARD_BY_ID.get(state.display[i]), level) })).sort((a, b) => b.s - a.s);
      const best = scored[0];
      const handSize = E.activeCount(E.current(state));
      const threshold = when === 'early' ? 9 : (handSize <= 1 ? 2 : handSize === 2 ? 4 : 6);
      if (best.s >= threshold) { const id = state.display[best.i]; E.takeCard(state, best.i); actions.push({ a: 'card', id, slot: best.i }); return true; }
      return false;
    };
    tryCard('early');
    placeAllCubes(state, actions, rng, level);
    // jetons
    const slots = state.market.map((m, i) => (m.length ? i : -1)).filter(i => i >= 0);
    if (slots.length) {
      let plan = null;
      if (level === 1) {
        const slot = slots[Math.floor(rng() * slots.length)];
        plan = { slot, cells: null };
      } else {
        let best = null;
        for (const slot of slots) {
          const tokens = state.market[slot];
          const orders = tokens.length === 3 ? perms3([0, 1, 2]) : [tokens.map((_, i) => i)];
          for (const order of orders) {
            const sim = E.clone(state);
            E.takeTokens(sim, slot);
            const cells = [];
            let dead = false;
            for (const oi of order) {
              // l'index en main diminue au fur et à mesure : on retrouve le jeton par couleur
              const color = tokens[oi];
              const hi = sim.cur.tokens.indexOf(color);
              const legal = E.legalCells(E.current(sim).board, color);
              if (!legal.length) { dead = true; break; }
              let bestCell = legal[0], bestV = -Infinity;
              for (const c of legal) {
                const t = E.clone(sim);
                E.placeToken(t, hi, c);
                const v = evaluate(t, 2) + rng() * 0.01;
                if (v > bestV) { bestV = v; bestCell = c; }
              }
              E.placeToken(sim, hi, bestCell);
              cells.push({ color, cell: bestCell });
            }
            if (dead) continue;
            const v = evaluate(sim, level) + rng() * 0.05;
            if (!best || v > best.v) best = { v, slot, cells };
          }
        }
        if (best) plan = best;
      }
      if (plan) {
        E.takeTokens(state, plan.slot);
        actions.push({ a: 'take', slot: plan.slot, tokens: state.cur.tokens.slice() });
        if (plan.cells) {
          for (const { color, cell } of plan.cells) {
            const hi = state.cur.tokens.indexOf(color);
            E.placeToken(state, hi, cell);
            actions.push({ a: 'place', color, cell });
            placeAllCubes(state, actions, rng, level);
          }
        } else {
          // débutant : chaque jeton sur une case légale au hasard
          while (state.cur.tokens.length) {
            const hi = Math.floor(rng() * state.cur.tokens.length);
            const c = state.cur.tokens[hi];
            const legal = E.legalCells(E.current(state).board, c);
            if (!legal.length) { E.discardToken(state, hi); actions.push({ a: 'discard', color: c }); continue; }
            const cell = legal[Math.floor(rng() * legal.length)];
            E.placeToken(state, hi, cell);
            actions.push({ a: 'place', color: c, cell });
          }
        }
        while (state.cur.tokens.length) { // sécurité : jeton sans case possible
          const c = state.cur.tokens[0];
          const legal = E.legalCells(E.current(state).board, c);
          if (legal.length) { E.placeToken(state, 0, legal[0]); actions.push({ a: 'place', color: c, cell: legal[0] }); }
          else { E.discardToken(state, 0); actions.push({ a: 'discard', color: c }); }
        }
      }
    }
    tryCard('late');
    placeAllCubes(state, actions, rng, level);
    return actions;
  }

  return { playTurn, potential, evaluate, NAMES, LEVELS, AVATARS, avatarFor };
});
