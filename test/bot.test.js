// Tests des joueurs artificiels : node --test test/bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const Bot = require('../src/bot.js');

const God = require('../src/god.js');

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// iters : multiplicateur de recherche du godmode (réduit dans les tests pour la vitesse, déterministe avec fixed)
function playGame(levels, opts, seed, iters) {
  const rng = seeded(seed);
  const state = E.newGame(opts, levels.map((l, i) => ({ token: 't' + i, name: 'B' + i, bot: l })), rng);
  state.id = 'test' + seed;
  let guard = 0;
  while (state.status === 'playing') {
    assert.ok(++guard < 400, 'partie interminable');
    const level = state.players[state.turn].bot;
    const actions = Bot.playTurn(state, level, rng, { fixed: true, iters: iters || 0.3 });
    assert.ok(actions.some(a => a.a === 'take') || state.market.every(m => !m.length), 'le bot doit prendre des jetons');
    assert.equal(state.cur.tokens.length, 0, 'tous les jetons posés');
    E.endTurn(state);
  }
  return state;
}

test('les bots terminent des parties valides (tous niveaux, faces A/B, esprits)', () => {
  let seed = 11;
  for (const side of ['A', 'B']) for (const spirits of [false, true]) {
    const st = playGame([1, 2, 3], { side, spirits }, seed++);
    assert.equal(st.status, 'finished');
    assert.ok(st.result.scores.every(s => s.total >= 0));
  }
});

test('un expert bat un débutant nettement plus souvent que l\'inverse', () => {
  let wins3 = 0, wins1 = 0;
  for (let g = 0; g < 12; g++) {
    const st = playGame(g % 2 ? [1, 3] : [3, 1], { side: 'A', spirits: false }, 100 + g);
    const s = st.result.scores;
    const expert = s.find(x => st.players[x.seat].bot === 3), novice = s.find(x => st.players[x.seat].bot === 1);
    if (expert.total > novice.total) wins3++; else if (novice.total > expert.total) wins1++;
  }
  assert.ok(wins3 >= wins1 + 4, 'expert ' + wins3 + ' – débutant ' + wins1);
});

test('planification rapide (niveau 3 < 400 ms par tour)', () => {
  const rng = seeded(5);
  const state = E.newGame({ side: 'A' }, [{ token: 'a', name: 'A', bot: 3 }, { token: 'b', name: 'B', bot: 3 }], rng);
  for (let i = 0; i < 6; i++) { const t0 = Date.now(); Bot.playTurn(state, 3, rng); assert.ok(Date.now() - t0 < 400); E.endTurn(state); }
});

test('godmode : parties valides (faces A/B, esprits, 4 joueurs) et actions rejouables', () => {
  let seed = 31;
  for (const side of ['A', 'B']) for (const spirits of [false, true]) {
    const st = playGame([4, 3], { side, spirits }, seed++, 0.2);
    assert.equal(st.status, 'finished');
    assert.ok(st.result.scores.every(s => s.total >= 0));
  }
  const four = playGame([4, 1, 2, 4], { side: 'A', spirits: true }, 99, 0.2);
  assert.equal(four.status, 'finished');
  assert.equal(four.players.length, 4);
});

test('godmode : le tour planifié se rejoue à l\'identique sur une copie de l\'état (format des actions)', () => {
  const rng = seeded(8);
  const state = E.newGame({ side: 'A', spirits: true }, [{ token: 'g', name: 'G', bot: 4 }, { token: 'e', name: 'E', bot: 3 }], rng);
  state.id = 'replay';
  for (let i = 0; i < 6; i++) {
    const before = E.clone(state);
    const actions = Bot.playTurn(state, state.players[state.turn].bot, rng, { fixed: true, iters: 0.2 });
    for (const a of actions) {
      if (a.a === 'take') E.takeTokens(before, a.slot);
      else if (a.a === 'place') E.placeToken(before, before.cur.tokens.indexOf(a.color), a.cell);
      else if (a.a === 'card') E.takeCard(before, a.slot);
      else if (a.a === 'cube') E.placeCube(before, a.id, a.cell);
      else if (a.a === 'spirit') E.chooseSpirit(before, a.id);
      else if (a.a === 'discard') E.discardToken(before, before.cur.tokens.indexOf(a.color));
    }
    assert.deepEqual(before.players, state.players);
    assert.deepEqual(before.market, state.market);
    E.endTurn(state);
  }
});

test('godmode : score du paysage et des esprits identique au moteur sur les empilements codés', () => {
  const rng = seeded(3);
  for (let g = 0; g < 30; g++) {
    const board = E.emptyBoard();
    for (let k = 0; k < 30; k++) { const color = 1 + Math.floor(rng() * 6); const legal = E.legalCells(board, color); if (legal.length) board[legal[Math.floor(rng() * legal.length)]].s.push(color); }
    const t = Int8Array.from(board.map(cell => God.codeOf(cell.s)));
    for (const side of ['A', 'B']) {
      const ref = E.scoreLandscape(board, side);
      assert.equal(God.landscape(t, side), ref.trees + ref.mountains + ref.fields + ref.buildings + ref.water);
    }
    for (let id = 33; id <= 42; id++) assert.equal(God.spiritPts(t, id), E.scoreSpirit(board, id));
  }
  for (let c = 0; c < God.STACKS.length; c++) for (let color = 1; color <= 6; color++) assert.equal(God.PUSH[c][color] >= 0, E.canPlace({ s: God.STACKS[c].slice(), cube: null }, color));
});

test('godmode : le plan projette au moins le score actuel et ne demande jamais plus de jetons que le sac n\'en contient', () => {
  const rng = seeded(12);
  const state = E.newGame({ side: 'A' }, [{ token: 'a', name: 'A', bot: 3 }, { token: 'b', name: 'B', bot: 3 }], rng);
  for (let i = 0; i < 8; i++) { Bot.playTurn(state, 3, rng); E.endTurn(state); }
  const p = God.plan(state, state.turn, 8000);
  const now = E.scorePlayer(E.current(state), 'A').total;
  assert.ok(p.value >= now - 1e-9, 'plan ' + p.value + ' < score ' + now);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const c of state.bag) counts[c]++;
  for (const m of state.market) for (const c of m) counts[c]++;
  const need = [0, 0, 0, 0, 0, 0, 0];
  E.current(state).board.forEach((cell, i) => { p.stacks[i].slice(cell.s.length).forEach(c => { need[c]++; }); });
  for (let c = 1; c <= 6; c++) assert.ok(need[c] <= counts[c], 'couleur ' + c + ' : ' + need[c] + ' > ' + counts[c]);
});

test('godmode bat l\'expert nettement plus souvent que l\'inverse', () => {
  let wins4 = 0, wins3 = 0;
  for (let g = 0; g < 8; g++) {
    const st = playGame(g % 2 ? [3, 4] : [4, 3], { side: 'A', spirits: false }, 200 + g, 0.3);
    const s = st.result.scores;
    const god = s.find(x => st.players[x.seat].bot === 4), expert = s.find(x => st.players[x.seat].bot === 3);
    if (god.total > expert.total) wins4++; else if (expert.total > god.total) wins3++;
  }
  assert.ok(wins4 >= wins3 + 3, 'godmode ' + wins4 + ' – expert ' + wins3);
});

test('godmode : tour planifié dans le budget de temps (1,5 s par défaut)', () => {
  const rng = seeded(5);
  const state = E.newGame({ side: 'B', spirits: true }, [{ token: 'a', name: 'A', bot: 4 }, { token: 'b', name: 'B', bot: 4 }], rng);
  state.id = 'timing';
  for (let i = 0; i < 4; i++) { const t0 = Date.now(); Bot.playTurn(state, 4, rng, { budget: 1500 }); assert.ok(Date.now() - t0 < 3000, 'tour trop long : ' + (Date.now() - t0) + ' ms'); E.endTurn(state); }
});
