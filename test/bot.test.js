// Tests des joueurs artificiels : node --test test/bot.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const Bot = require('../src/bot.js');

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function playGame(levels, opts, seed) {
  const rng = seeded(seed);
  const state = E.newGame(opts, levels.map((l, i) => ({ token: 't' + i, name: 'B' + i, bot: l })), rng);
  let guard = 0;
  while (state.status === 'playing') {
    assert.ok(++guard < 400, 'partie interminable');
    const level = state.players[state.turn].bot;
    const actions = Bot.playTurn(state, level, rng);
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
