// Arène : fait s'affronter des bots pour mesurer leur force. node tools/arena.js [parties=10] [niveaux=4,3] [face=A] [esprits=0] [iters=1] [graine=1]
// Les sièges tournent à chaque partie ; affiche victoires, scores moyens et temps par tour de chaque niveau.
const E = require('../src/engine.js');
const Bot = require('../src/bot.js');

const args = process.argv.slice(2);
const games = +args[0] || 10, levels = (args[1] || '4,3').split(',').map(Number), side = args[2] === 'B' ? 'B' : 'A';
const spirits = args[3] === '1' || args[3] === 'true', iters = +args[4] || 1, seed0 = +args[5] || 1;
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const stats = levels.map(l => ({ level: l, wins: 0, ties: 0, score: 0, ms: 0, turns: 0, maxMs: 0 }));
for (let g = 0; g < games; g++) {
  const rng = seeded(seed0 + g);
  const order = levels.map((_, i) => (i + g) % levels.length); // rotation des sièges
  const players = order.map(k => ({ token: 'p' + k, name: 'L' + levels[k], bot: levels[k] }));
  const state = E.newGame({ side, spirits }, players, rng);
  while (state.status === 'playing') {
    const k = order[state.turn], st = stats[k];
    const t0 = Date.now();
    Bot.playTurn(state, levels[k], rng, { iters, fixed: true });
    const dt = Date.now() - t0;
    st.ms += dt; st.turns++; if (dt > st.maxMs) st.maxMs = dt;
    E.endTurn(state);
  }
  const scores = state.result.scores;
  scores.forEach(s => { stats[order[s.seat]].score += s.total; });
  const w = state.result.winners;
  if (w.length === 1) stats[order[w[0]]].wins++; else w.forEach(seat => { stats[order[seat]].ties++; });
  process.stdout.write('game ' + (g + 1) + ': ' + scores.map(s => s.name + ' ' + s.total).join(' – ') + (w.length > 1 ? ' (tie)' : '') + '\n');
}
for (const st of stats) console.log('level ' + st.level + ': wins ' + st.wins + '/' + games + (st.ties ? ' (+' + st.ties + ' ties)' : '') + ', avg score ' + (st.score / games).toFixed(1) + ', ' + (st.ms / st.turns).toFixed(0) + ' ms/turn (max ' + st.maxMs + ')');
