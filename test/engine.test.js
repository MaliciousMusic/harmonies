// Tests du moteur : node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const idx = (c, r) => E.CELLS.findIndex(x => x.c === c && x.r === r);
function boardWith(entries) {
  // entries: [[c, r, stack], ...]
  const b = E.emptyBoard();
  for (const [c, r, s] of entries) b[idx(c, r)].s = s.slice();
  return b;
}
const cell = s => ({ s: s.slice(), cube: null });

test('géométrie du plateau (23 cases, 50 arêtes, voisinages symétriques)', () => {
  assert.equal(E.CELLS.length, 23);
  let links = 0;
  E.NEIGHBORS.forEach((ns, i) => {
    links += ns.length;
    for (const j of ns) assert.ok(E.NEIGHBORS[j].includes(i), `voisinage asymétrique ${i}-${j}`);
  });
  assert.equal(links, 100);
  // coin haut-gauche : 2 voisins ; centre : 6 voisins
  assert.equal(E.NEIGHBORS[idx(0, 0)].length, 2);
  assert.equal(E.NEIGHBORS[idx(2, 2)].length, 6);
});

test('règles de pose : tableau officiel', () => {
  const cases = [
    // [pile existante, couleur, autorisé]
    [[], 1, true], [[], 2, true], [[], 3, true], [[], 4, true], [[], 5, true], [[], 6, true],
    // rien sur bleu / jaune / vert
    [[1], 1, false], [[1], 2, false], [[1], 6, false], [[5], 5, false], [[5], 6, false], [[4], 3, false], [[4], 4, false],
    // gris : sur gris uniquement, jusqu'à 3
    [[2], 2, true], [[2, 2], 2, true], [[2, 2, 2], 2, false], [[3], 2, false], [[6], 2, false],
    // marron : sur marron, max 2 marrons
    [[3], 3, true], [[3, 3], 3, false], [[2], 3, false], [[6], 3, false],
    // vert : sur 1 ou 2 marrons
    [[3], 4, true], [[3, 3], 4, true], [[2], 4, false], [[6], 4, false], [[2, 2], 4, false],
    // rouge : niveau 2 max, sur gris / marron / rouge
    [[2], 6, true], [[3], 6, true], [[6], 6, true], [[2, 2], 6, false], [[3, 3], 6, false], [[2, 6], 6, false], [[1], 6, false], [[4], 6, false],
    // bleu / jaune : uniquement au sol
    [[2], 1, false], [[3], 5, false],
  ];
  for (const [s, color, ok] of cases) {
    assert.equal(E.canPlace(cell(s), color), ok, `pile ${JSON.stringify(s)} + ${color} devrait être ${ok}`);
  }
  // une case avec cube est verrouillée
  assert.equal(E.canPlace({ s: [2], cube: { id: 26 } }, 2), false);
});

test('score : arbres, montagnes, champs, bâtiments', () => {
  const side = 'A';
  // arbres 1 / 3 / 7 ; marron seul = 0 ; marron-marron = 0
  let sc = E.scoreLandscape(boardWith([[0, 0, [4]], [2, 2, [3, 4]], [4, 4, [3, 3, 4]], [0, 4, [3]], [4, 0, [3, 3]]]), side);
  assert.equal(sc.trees, 11);
  // montagnes isolées = 0, adjacentes = 1/3/7
  sc = E.scoreLandscape(boardWith([[0, 0, [2, 2, 2]]]), side);
  assert.equal(sc.mountains, 0);
  sc = E.scoreLandscape(boardWith([[0, 0, [2, 2, 2]], [0, 1, [2]], [4, 4, [2, 2]], [4, 3, [2]]]), side);
  assert.equal(sc.mountains, 7 + 1 + 3 + 1);
  // champs : 5 par groupe de 2+, un jaune isolé = 0, un groupe de 4 = 5
  sc = E.scoreLandscape(boardWith([[0, 0, [5]], [0, 1, [5]], [0, 2, [5]], [0, 3, [5]], [4, 0, [5]], [2, 2, [5]], [2, 3, [5]]]), side);
  assert.equal(sc.fields, 10);
  // bâtiment : rouge sur gris/marron/rouge, entouré de 3 couleurs différentes (sommets)
  sc = E.scoreLandscape(boardWith([[2, 2, [2, 6]], [2, 1, [1]], [2, 3, [5]], [1, 1, [4]]]), side);
  assert.equal(sc.buildings, 5);
  sc = E.scoreLandscape(boardWith([[2, 2, [2, 6]], [2, 1, [1]], [2, 3, [1]], [1, 1, [1]]]), side);
  assert.equal(sc.buildings, 0);
  // le rouge seul n'est pas un bâtiment ; rouge sur rouge en est un ; la couleur rouge voisine compte
  sc = E.scoreLandscape(boardWith([[2, 2, [6, 6]], [2, 1, [6]], [2, 3, [5]], [1, 1, [2, 2]]]), side);
  assert.equal(sc.buildings, 5);
  sc = E.scoreLandscape(boardWith([[2, 2, [6]], [2, 1, [1]], [2, 3, [5]], [1, 1, [4]]]), side);
  assert.equal(sc.buildings, 0);
});

test('score : rivière (face A) — plus court chemin entre extrémités, une seule rivière compte', () => {
  const pts = n => E.riverPoints(n);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(pts), [0, 0, 2, 5, 8, 11, 15, 19, 23]);
  // colonne de 5 bleus = rivière de 5 → 11
  let b = boardWith([[0, 0, [1]], [0, 1, [1]], [0, 2, [1]], [0, 3, [1]], [0, 4, [1]]]);
  assert.equal(E.longestRiver(b), 5);
  assert.equal(E.scoreLandscape(b, 'A').water, 11);
  // deux rivières : seule la meilleure compte
  b = boardWith([[0, 0, [1]], [0, 1, [1]], [4, 0, [1]], [4, 1, [1]], [4, 2, [1]]]);
  assert.equal(E.scoreLandscape(b, 'A').water, 5);
  // Y : une branche latérale ne rallonge pas le chemin
  b = boardWith([[0, 0, [1]], [0, 1, [1]], [0, 2, [1]], [0, 3, [1]], [1, 1, [1]]]);
  assert.equal(E.longestRiver(b), 4);
  // triangle de 3 bleus mutuellement adjacents : chemin le plus court = 2
  b = boardWith([[0, 0, [1]], [0, 1, [1]], [1, 0, [1]]]);
  assert.equal(E.longestRiver(b), 2);
  // pas d'eau : 0
  assert.equal(E.scoreLandscape(E.emptyBoard(), 'A').water, 0);
});

test('score : îles (face B)', () => {
  assert.equal(E.scoreLandscape(E.emptyBoard(), 'B').water, 5); // toujours au moins 1 île
  // une colonne complète de bleu coupe le plateau en 2 îles
  const b = boardWith([[1, 0, [1]], [1, 1, [1]], [1, 2, [1]], [1, 3, [1]]]);
  assert.equal(E.islands(b), 2);
  assert.equal(E.scoreLandscape(b, 'B').water, 10);
  // une case isolée entourée de bleu = île supplémentaire
  const b2 = boardWith([[1, 0, [1]], [0, 1, [1]], [1, 1, [1]]]); // isole (0,0)
  assert.equal(E.islands(b2), 2);
});

test('motifs : chaque carte est détectée dans les 6 orientations, cube au bon endroit', () => {
  for (const card of E.CARDS) {
    let found = 0;
    for (let o = 0; o < E.CELLS.length; o++) {
      for (let rot = 0; rot < 6; rot++) {
        const cells = E.patternCells(o, card.pat, rot);
        if (!cells) continue;
        const b = E.emptyBoard();
        let cubeCell = -1;
        cells.forEach((ci, k) => {
          const want = card.pat[k].s;
          b[ci].s = (want.length === 2 && want[0] === 6 && want[1] === 7) ? [2, 6] : want.slice().reverse();
          if (card.pat[k].cube) cubeCell = ci;
        });
        const targets = E.cubeTargets(b, card);
        assert.ok(targets.includes(cubeCell), `carte ${card.fr} non détectée (origine ${o}, rot ${rot})`);
        found++;
      }
    }
    assert.ok(found > 0, `aucune orientation possible pour ${card.fr}`);
  }
});

test('motifs : hauteur exacte, bâtiment sur toute base, case cube occupée', () => {
  const frog = E.CARD_BY_ID.get(5); // vert + bleu (cube sur bleu)
  // un arbre de hauteur 2 ne vaut pas un buisson
  assert.equal(E.cubeTargets(boardWith([[0, 0, [3, 4]], [0, 1, [1]]]), frog).length, 0);
  assert.deepEqual(E.cubeTargets(boardWith([[0, 0, [4]], [0, 1, [1]]]), frog), [idx(0, 1)]);
  const duck = E.CARD_BY_ID.get(6); // bâtiment + bleu
  for (const base of [2, 3, 6]) assert.equal(E.cubeTargets(boardWith([[0, 0, [base, 6]], [0, 1, [1]]]), duck).length, 1);
  assert.equal(E.cubeTargets(boardWith([[0, 0, [6]], [0, 1, [1]]]), duck).length, 0, 'rouge seul ≠ bâtiment');
  // case cube déjà occupée : pas de cible, mais les autres cases du motif peuvent porter un cube
  const b = boardWith([[0, 0, [4]], [0, 1, [1]]]);
  b[idx(0, 1)].cube = { id: 5 };
  assert.equal(E.cubeTargets(b, frog).length, 0);
  b[idx(0, 1)].cube = null;
  b[idx(0, 0)].cube = { id: 18 };
  assert.equal(E.cubeTargets(b, frog).length, 1);
});

test('valeur des cartes et esprits', () => {
  const croco = E.CARD_BY_ID.get(1); // 4 / 9 / 15
  assert.equal(E.cardValue(croco, 3), 0);
  assert.equal(E.cardValue(croco, 2), 4);
  assert.equal(E.cardValue(croco, 1), 9);
  assert.equal(E.cardValue(croco, 0), 15);
  // Lion : 2 pts par groupe de 1-2 jaunes, 10 par groupe de 3+ (exemple du livret : 2 + 2 + 10 = 14)
  const b = boardWith([[0, 0, [5]], [4, 4, [5]], [4, 3, [5]], [2, 0, [5]], [2, 1, [5]], [2, 2, [5]]]);
  assert.equal(E.scoreSpirit(b, 33), 14);
  assert.equal(E.scoreSpirit(b, 34), 15);
  // Bélier : 4 pts par montagne de hauteur 2 ou 3, même isolée
  assert.equal(E.scoreSpirit(boardWith([[0, 0, [2, 2]], [4, 4, [2, 2, 2]], [2, 2, [2]]]), 39), 8);
  assert.equal(E.scoreSpirit(boardWith([[0, 0, [2, 2]], [4, 4, [2, 2, 2]], [2, 2, [2]]]), 40), 3 + 3 + 1);
  assert.equal(E.scoreSpirit(boardWith([[0, 0, [1]], [0, 1, [1]], [4, 4, [1]]]), 41), 7);
  assert.equal(E.scoreSpirit(boardWith([[0, 0, [1]], [0, 1, [1]], [4, 4, [1]]]), 42), 6);
});

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function countTokens(state) {
  const counts = {};
  const add = t => { counts[t] = (counts[t] || 0) + 1; };
  state.bag.forEach(add);
  state.market.forEach(m => m.forEach(add));
  if (state.cur) state.cur.tokens.forEach(add);
  state.players.forEach(p => p.board.forEach(c => c.s.forEach(add)));
  return counts;
}
function randomPlayout(nPlayers, opts, seed) {
  const rng = seeded(seed);
  const players = Array.from({ length: nPlayers }, (_, i) => ({ token: 't' + i, name: 'J' + i }));
  const state = E.newGame(opts, players, rng);
  let guard = 0;
  let discarded = 0;
  while (state.status === 'playing') {
    assert.ok(++guard < 500, 'partie interminable');
    const p = E.current(state);
    if (p.spiritChoices) E.chooseSpirit(state, p.spiritChoices[Math.floor(rng() * 2)]);
    const slots = state.market.map((m, i) => (m.length ? i : -1)).filter(i => i >= 0);
    if (slots.length) E.takeTokens(state, slots[Math.floor(rng() * slots.length)]);
    // carte animal une fois sur deux
    if (E.canTakeCard(state) && rng() < 0.6) {
      const ds = state.display.map((d, i) => (d ? i : -1)).filter(i => i >= 0);
      if (ds.length) E.takeCard(state, ds[Math.floor(rng() * ds.length)]);
    }
    while (state.cur.tokens.length) {
      const legal = E.legalCells(p.board, state.cur.tokens[0]);
      if (!legal.length) { E.discardToken(state, 0); discarded++; continue; }
      E.placeToken(state, 0, legal[Math.floor(rng() * legal.length)]);
      for (const pc of E.placeableCubes(state)) {
        if (rng() < 0.8) E.placeCube(state, pc.id, pc.targets[Math.floor(rng() * pc.targets.length)]);
      }
    }
    const counts = countTokens(state);
    assert.deepEqual(counts, E.TOKEN_COUNTS, 'jetons non conservés');
    E.endTurn(state);
  }
  return { state, discarded };
}

test('parties aléatoires complètes : 2, 3, 4 joueurs, faces A/B, avec/sans esprits', () => {
  let seed = 1;
  for (const n of [2, 3, 4]) {
    for (const side of ['A', 'B']) {
      for (const spirits of [false, true]) {
        const { state } = randomPlayout(n, { side, spirits }, seed++);
        assert.equal(state.status, 'finished');
        assert.ok(state.result && state.result.winners.length >= 1);
        const turns = state.players.map(p => p.turns);
        assert.ok(turns.every(t => t === turns[0]), 'tours inégaux ' + turns);
        assert.ok(['bag', 'board'].includes(state.endReason));
        for (const p of state.players) {
          assert.ok(E.activeCount(p) <= 4);
          if (spirits) assert.ok(p.spirit && !p.spiritChoices);
          const sc = E.scorePlayer(p, side);
          assert.equal(sc.total, sc.trees + sc.mountains + sc.fields + sc.buildings + sc.water + sc.animals + sc.spirit);
          // chaque cube sur le plateau correspond à une carte détenue/terminée ou à l'esprit
          for (const c of p.board) if (c.cube) {
            const known = p.hand.some(h => h.id === c.cube.id) || p.done.some(d => d.id === c.cube.id) || (p.spirit && p.spirit.id === c.cube.id);
            assert.ok(known);
          }
          assert.equal(p.cubes, p.board.filter(c => c.cube).length);
        }
      }
    }
  }
});

test('fin de partie : déclenchement à 2 cases vides, dernier tour équitable', () => {
  const rng = seeded(42);
  const state = E.newGame({ side: 'A' }, [{ token: 'a', name: 'A' }, { token: 'b', name: 'B' }], rng);
  state.first = 0; state.turn = 0;
  // remplir le plateau du joueur 0 jusqu'à 3 cases vides, puis poser 1 jeton → 2 vides → fin déclenchée
  const p0 = state.players[0];
  for (let i = 0; i < 20; i++) p0.board[i].s = [2];
  E.takeTokens(state, 0);
  const legal = () => E.legalCells(p0.board, state.cur.tokens[0]);
  while (state.cur.tokens.length) { const l = legal(); if (l.length) E.placeToken(state, 0, l[0]); else E.discardToken(state, 0); }
  E.endTurn(state);
  assert.equal(state.finalRound, true);
  assert.equal(state.endReason, 'board');
  assert.equal(state.status, 'playing', 'le joueur 1 doit encore jouer');
  assert.equal(state.turn, 1);
  E.takeTokens(state, 1);
  while (state.cur.tokens.length) E.placeToken(state, 0, E.legalCells(state.players[1].board, state.cur.tokens[0])[0]);
  E.endTurn(state);
  assert.equal(state.status, 'finished');
  assert.equal(state.players[0].turns, state.players[1].turns);
});

test('fin de partie : sac vide au moment de recharger', () => {
  const rng = seeded(7);
  const state = E.newGame({ side: 'A' }, [{ token: 'a', name: 'A' }, { token: 'b', name: 'B' }], rng);
  state.first = 0; state.turn = 0;
  state.bag = [];
  E.takeTokens(state, 2);
  while (state.cur.tokens.length) E.placeToken(state, 0, E.legalCells(E.current(state).board, state.cur.tokens[0])[0]);
  E.endTurn(state);
  assert.equal(state.endReason, 'bag');
  assert.deepEqual(state.market[2], []);
  assert.equal(state.status, 'playing');
});

test('limite de 4 cartes et une carte par tour', () => {
  const rng = seeded(3);
  const state = E.newGame({ side: 'A', spirits: true }, [{ token: 'a', name: 'A' }, { token: 'b', name: 'B' }], rng);
  const p = E.current(state);
  E.chooseSpirit(state, p.spiritChoices[0]);
  assert.equal(E.activeCount(p), 1);
  assert.ok(E.canTakeCard(state));
  E.takeCard(state, 0);
  assert.equal(E.canTakeCard(state), false, 'une seule carte par tour');
  assert.equal(state.display[0], null);
  p.hand.push({ id: 2, left: 3 }, { id: 3, left: 4 });
  state.cur.cardTaken = false;
  assert.equal(E.canTakeCard(state), false, 'esprit + 3 cartes = 4 actives');
});

test('abandon : la partie se termine, le joueur qui abandonne ne gagne jamais', () => {
  const st = E.newGame({ side: 'A' }, [{ token: 'a', name: 'A' }, { token: 'b', name: 'B' }]);
  // A construit un peu de paysage pour être devant au score
  st.players[0].board[0].s = [3, 3, 4];
  E.resign(st, 0);
  assert.equal(st.status, 'finished');
  assert.equal(st.endReason, 'resign');
  assert.equal(st.resigned, 0);
  assert.equal(st.cur, null);
  assert.deepEqual(st.result.winners, [1]);
  assert.equal(st.result.scores.length, 2);
  assert.throws(() => E.resign(st, 1), /over/);
});
