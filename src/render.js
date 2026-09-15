// Rendu SVG : jetons, plateaux, motifs de cartes. Chaînes SVG (innerHTML), pas de dépendance.
(function (root) {
  'use strict';
  const E = root.Engine;
  const SQ3 = Math.sqrt(3);
  const FILL = { 1: '#3d8fc4', 2: '#8f9498', 3: '#7d4b2a', 4: '#6aa83c', 5: '#e8b526', 6: '#cf4540' };
  const DARK = { 1: '#2a6a95', 2: '#5f6468', 3: '#52301a', 4: '#467527', 5: '#b58816', 6: '#922c29' };
  const LIGHT = { 1: '#6fb3dc', 2: '#b3b7bb', 3: '#9a6440', 4: '#8cc75a', 5: '#f2cb55', 6: '#e0655f' };

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function hexPoints(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i;
      pts.push((cx + size * Math.cos(a)).toFixed(3) + ',' + (cy + size * Math.sin(a)).toFixed(3));
    }
    return pts.join(' ');
  }
  function cellCenter(c, r) {
    return { x: 1.5 * c, y: SQ3 * (r + (c % 2 ? 0.5 : 0)) };
  }

  // Un disque de jeton (vue 3/4) dessiné à (x, y) — y = centre de la face supérieure.
  function disc(x, y, color, rx, ry, thick) {
    return '<ellipse cx="' + x + '" cy="' + (y + thick) + '" rx="' + rx + '" ry="' + ry + '" fill="' + DARK[color] + '"/>' +
      '<rect x="' + (x - rx) + '" y="' + y + '" width="' + (2 * rx) + '" height="' + thick + '" fill="' + DARK[color] + '"/>' +
      '<ellipse cx="' + x + '" cy="' + y + '" rx="' + rx + '" ry="' + ry + '" fill="' + FILL[color] + '"/>' +
      '<ellipse cx="' + (x - rx * 0.25) + '" cy="' + (y - ry * 0.3) + '" rx="' + (rx * 0.45) + '" ry="' + (ry * 0.35) + '" fill="' + LIGHT[color] + '" opacity=".55"/>';
  }
  function cubeMark(x, y, emoji, spirit) {
    const s = 0.62;
    return '<g class="cube">' +
      '<rect x="' + (x - s / 2) + '" y="' + (y - s / 2 - 0.06) + '" width="' + s + '" height="' + s + '" rx=".1" fill="' + (spirit ? '#d9a441' : '#2b2118') + '"/>' +
      '<rect x="' + (x - s / 2) + '" y="' + (y - s / 2 - 0.16) + '" width="' + s + '" height="' + (s * 0.35) + '" rx=".08" fill="' + (spirit ? '#f0c975' : '#4a3a2c') + '"/>' +
      '<text x="' + x + '" y="' + (y + 0.12) + '" text-anchor="middle" font-size=".5" style="pointer-events:none">' + esc(emoji) + '</text></g>';
  }
  // Pile complète à (x, y) : niveaux empilés vers le haut.
  function stack(x, y, s, cube, scale) {
    scale = scale || 1;
    const rx = 0.62 * scale, ry = 0.42 * scale, thick = 0.2 * scale, lift = 0.3 * scale;
    let out = '<g class="stack">';
    s.forEach((color, k) => { out += disc(x, y - k * lift, color, rx, ry, thick); });
    if (cube) {
      const card = E.CARD_BY_ID.get(cube.id);
      out += cubeMark(x, y - (s.length - 1) * lift - 0.05, card ? card.emoji : '●', !!cube.sp);
    }
    return out + '</g>';
  }
  // Petit jeton isolé (barre de main, plateau central)
  function tokenSVG(color, extra) {
    return '<svg viewBox="-0.8 -0.7 1.6 1.6" ' + (extra || '') + '>' + disc(0, 0, color, 0.66, 0.44, 0.22) + '</svg>';
  }
  function slotSVG(tokens) {
    if (!tokens.length) return '';
    let out = '<svg viewBox="-0.9 -0.7 1.8 3.4">';
    tokens.forEach((t, i) => { out += disc(0, i * 0.95, t, 0.66, 0.44, 0.22); });
    return out + '</svg>';
  }

  // Plateau personnel. opts: {legal:Set, targets:Set, last:Set, readonly:bool}
  function boardSVG(board, opts) {
    opts = opts || {};
    const pad = 1.15;
    const minX = -pad, minY = -SQ3 / 2 - pad + 0.3, maxX = 6 + pad, maxY = SQ3 * 4.5 + SQ3 / 2 + pad - 0.2;
    let out = '<svg class="board' + (opts.readonly ? ' readonly' : '') + '" viewBox="' + minX + ' ' + minY + ' ' + (maxX - minX) + ' ' + (maxY - minY) + '">';
    // cases
    E.CELLS.forEach((cell, i) => {
      const { x, y } = cellCenter(cell.c, cell.r);
      let cls = 'hex';
      if (opts.legal && opts.legal.has(i)) cls += ' legal';
      if (opts.targets && opts.targets.has(i)) cls += ' target';
      if (opts.last && opts.last.has(i)) cls += ' last';
      out += '<polygon class="' + cls + '" data-idx="' + i + '" points="' + hexPoints(x, y, 0.94) + '"/>';
    });
    // piles, dessinées de haut en bas de l'écran pour que les piles du bas recouvrent
    const order = E.CELLS.map((cell, i) => ({ i, y: cellCenter(cell.c, cell.r).y })).sort((a, b) => a.y - b.y);
    for (const { i } of order) {
      const cell = board[i];
      const { x, y } = cellCenter(E.CELLS[i].c, E.CELLS[i].r);
      if (cell.s.length) out += stack(x, y + 0.12, cell.s, cell.cube, 1);
      else if (opts.legal && opts.legal.has(i)) out += '<circle class="legal-dot" cx="' + x + '" cy="' + y + '" r=".22"/>';
      if (opts.targets && opts.targets.has(i)) out += '<circle class="target-dot" cx="' + x + '" cy="' + (y - cell.s.length * 0.3 - 0.75) + '" r=".2"/>';
    }
    return out + '</svg>';
  }

  // Cellules d'un motif pour la rotation qui donne le dessin le plus "large" (bbox la moins haute).
  function patternLayout(card) {
    let best = null;
    for (let rot = 0; rot < 6; rot++) {
      let c = 0, r = 0;
      const cells = [{ c, r }];
      for (let k = 1; k < card.pat.length; k++) {
        const n = E.neighborCoord(c, r, (card.pat[k].d + rot) % 6);
        c = n.c; r = n.r; cells.push({ c, r });
      }
      const pts = cells.map(cc => cellCenter(cc.c, cc.r));
      const ys = pts.map(p => p.y), xs = pts.map(p => p.x);
      const h = Math.max(...ys) - Math.min(...ys), w = Math.max(...xs) - Math.min(...xs);
      const score = h * 10 - w;
      if (!best || score < best.score) best = { score, pts, cells };
    }
    return best.pts;
  }
  function patternSVG(card, big) {
    const pts = patternLayout(card);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs) - 1.15, maxX = Math.max(...xs) + 1.15;
    const minY = Math.min(...ys) - 1.9, maxY = Math.max(...ys) + 1.05;
    let out = '<svg class="pattern" viewBox="' + minX + ' ' + minY + ' ' + (maxX - minX) + ' ' + (maxY - minY) + '" preserveAspectRatio="xMidYMid meet">';
    pts.forEach(p => { out += '<polygon points="' + hexPoints(p.x, p.y, 0.94) + '" fill="#efe1c3" stroke="#c9b08a" stroke-width=".06"/>'; });
    const order = pts.map((p, k) => ({ k, y: p.y })).sort((a, b) => a.y - b.y);
    for (const { k } of order) {
      const p = pts[k], step = card.pat[k];
      let s = step.s.slice().reverse(); // du bas vers le haut
      if (step.s.length === 2 && step.s[0] === 6 && step.s[1] === 7) s = [7, 6];
      let g = '<g class="stack">';
      s.forEach((color, lvl) => {
        if (color === 7) {
          // base quelconque : disque tricolore (gris / marron / rouge)
          const y = p.y + 0.12;
          g += '<ellipse cx="' + p.x + '" cy="' + (y + 0.2) + '" rx=".62" ry=".42" fill="#5a4a3a"/><rect x="' + (p.x - 0.62) + '" y="' + y + '" width="1.24" height=".2" fill="#5a4a3a"/>';
          g += '<path d="M' + (p.x - 0.62) + ' ' + y + ' A .62 .42 0 0 1 ' + (p.x + 0.62) + ' ' + y + ' L ' + p.x + ' ' + y + ' Z" fill="' + FILL[2] + '"/>';
          g += '<path d="M' + (p.x + 0.62) + ' ' + y + ' A .62 .42 0 0 1 ' + (p.x - 0.62) + ' ' + y + ' L ' + p.x + ' ' + y + ' Z" fill="' + FILL[3] + '"/>';
          g += '<path d="M' + (p.x - 0.62) + ' ' + y + ' A .62 .42 0 0 0 ' + (p.x - 0.31) + ' ' + (y + 0.365) + ' L ' + (p.x + 0.31) + ' ' + (y + 0.365) + ' A .62 .42 0 0 0 ' + (p.x + 0.62) + ' ' + y + ' L ' + p.x + ' ' + y + ' Z" fill="' + FILL[6] + '"/>';
        } else g += disc(p.x, p.y + 0.12 - lvl * 0.3, color, 0.62, 0.42, 0.2);
      });
      if (step.cube) {
        const topY = p.y + 0.12 - (s.length - 1) * 0.3;
        g += '<rect x="' + (p.x - 0.31) + '" y="' + (topY - 0.86) + '" width=".62" height=".62" rx=".1" fill="' + (card.spirit ? '#d9a441' : '#2b2118') + '"/>' +
          '<text x="' + p.x + '" y="' + (topY - 0.38) + '" text-anchor="middle" font-size=".46">' + esc(card.emoji) + '</text>';
      }
      out += g + '</g>';
    }
    return out + '</svg>';
  }

  // Couleur (CSS) de la case cube d'une carte, pour la bande de rappel.
  function cubeColorOf(card) {
    const step = card.pat.find(p => p.cube);
    const c = step.s[0] === 6 ? 6 : step.s[0];
    return FILL[c];
  }

  root.Render = { tokenSVG, slotSVG, boardSVG, patternSVG, cubeColorOf, esc, FILL, DARK };
})(typeof self !== 'undefined' ? self : this);
