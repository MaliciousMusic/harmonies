// Rendu SVG : jetons à motifs, plateaux illustrés, cartes, pioche et sac. Chaînes SVG (innerHTML), sans dépendance.
(function (root) {
  'use strict';
  const E = root.Engine;
  const SQ3 = Math.sqrt(3);
  const FILL = { 1: '#3d8fc4', 2: '#8f9498', 3: '#7d4b2a', 4: '#6aa83c', 5: '#e8b526', 6: '#cf4540' };
  const DARK = { 1: '#2a6a95', 2: '#5f6468', 3: '#52301a', 4: '#467527', 5: '#b58816', 6: '#922c29' };
  const LIGHT = { 1: '#7cc0e6', 2: '#b3b7bb', 3: '#9a6440', 4: '#8cc75a', 5: '#f2cb55', 6: '#e0655f' };

  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const n = v => (Math.round(v * 1000) / 1000).toString();

  // ---------- Définitions partagées (motifs des jetons, dos de carte) : à insérer une fois dans le document ----------
  function defsSVG() {
    const sym = (id, inner) => '<symbol id="' + id + '" viewBox="-1 -1 2 2" preserveAspectRatio="none" overflow="visible">' + inner + '</symbol>';
    return '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      // eau : vaguelettes
      sym('face-1', '<g fill="none" stroke="#a6dcf5" stroke-width=".13" stroke-linecap="round" opacity=".9">' +
        '<path d="M-.62,-.28 q.16,-.16 .32,0 t.32,0 t.32,0"/><path d="M-.7,.06 q.16,-.16 .32,0 t.32,0 t.32,0 t.32,0"/><path d="M-.5,.4 q.16,-.16 .32,0 t.32,0 t.32,0"/></g>') +
      // montagne : deux sommets enneigés
      sym('face-2', '<path d="M-.8,.55 L-.28,-.42 L.18,.55 Z" fill="#6b7075"/><path d="M-.02,.55 L.4,-.12 L.82,.55 Z" fill="#787d82"/>' +
        '<path d="M-.4,-.2 L-.28,-.42 L-.16,-.2 L-.24,-.14 L-.32,-.16 Z" fill="#eef1f3"/><path d="M.31,.02 L.4,-.12 L.5,.02 L.44,.06 L.36,.05 Z" fill="#eef1f3"/>') +
      // tronc : cernes du bois
      sym('face-3', '<g fill="none" stroke="#a5703f" stroke-width=".07" opacity=".85"><circle r=".25"/><circle r=".5"/><circle r=".76"/></g><path d="M.1,-.1 L.55,-.62" stroke="#5a3418" stroke-width=".06" stroke-linecap="round"/>') +
      // feuillage : une feuille nervurée
      sym('face-4', '<path d="M-.62,.5 Q-.3,-.62 .62,-.5 Q.3,.62 -.62,.5 Z" fill="#9ad160"/><path d="M-.55,.44 L.55,-.44" stroke="#4d8a2a" stroke-width=".06" stroke-linecap="round"/>' +
        '<g stroke="#4d8a2a" stroke-width=".04" stroke-linecap="round" opacity=".8"><path d="M-.25,.2 L-.1,-.12"/><path d="M0,0 L.15,-.32"/><path d="M.22,-.18 L.36,-.46"/></g>') +
      // champ : épis de blé
      sym('face-5', '<g stroke="#b8860b" stroke-width=".06" stroke-linecap="round" fill="#c9962a">' +
        '<path d="M-.42,.62 L-.42,-.3"/><path d="M0,.62 L0,-.45"/><path d="M.42,.62 L.42,-.3"/>' +
        '<ellipse cx="-.42" cy="-.42" rx=".1" ry=".16"/><ellipse cx="-.5" cy="-.2" rx=".08" ry=".13"/><ellipse cx="-.34" cy="-.2" rx=".08" ry=".13"/>' +
        '<ellipse cx="0" cy="-.58" rx=".1" ry=".16"/><ellipse cx="-.08" cy="-.36" rx=".08" ry=".13"/><ellipse cx=".08" cy="-.36" rx=".08" ry=".13"/><ellipse cx="-.08" cy="-.15" rx=".08" ry=".13"/><ellipse cx=".08" cy="-.15" rx=".08" ry=".13"/>' +
        '<ellipse cx=".42" cy="-.42" rx=".1" ry=".16"/><ellipse cx=".34" cy="-.2" rx=".08" ry=".13"/><ellipse cx=".5" cy="-.2" rx=".08" ry=".13"/></g>') +
      // bâtiment : maisonnette
      sym('face-6', '<path d="M-.62,.05 L0,-.58 L.62,.05 Z" fill="#8a2521"/><rect x="-.44" y=".05" width=".88" height=".55" fill="#f4dcc4"/>' +
        '<rect x="-.12" y=".22" width=".24" height=".38" fill="#8a2521"/><rect x="-.38" y=".14" width=".16" height=".16" fill="#7fb3d6"/><rect x=".22" y=".14" width=".16" height=".16" fill="#7fb3d6"/>') +
      // dos de carte : empreinte
      '<pattern id="card-back" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="8" r="2.6" fill="#f3d9a6" opacity=".35"/><circle cx="4" cy="4" r="1.1" fill="#f3d9a6" opacity=".35"/><circle cx="7" cy="2.6" r="1.1" fill="#f3d9a6" opacity=".35"/><circle cx="10" cy="4" r="1.1" fill="#f3d9a6" opacity=".35"/></pattern>' +
      '</defs></svg>';
  }

  function hexPoints(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i;
      pts.push(n(cx + size * Math.cos(a)) + ',' + n(cy + size * Math.sin(a)));
    }
    return pts.join(' ');
  }
  function cellCenter(c, r) {
    return { x: 1.5 * c, y: SQ3 * (r + (c % 2 ? 0.5 : 0)) };
  }

  // Un disque de jeton (vue 3/4) : y = centre de la face supérieure.
  function disc(x, y, color, rx, ry, thick, extraClass) {
    return '<g class="disc' + (extraClass ? ' ' + extraClass : '') + '" data-color="' + color + '">' +
      '<ellipse cx="' + n(x) + '" cy="' + n(y + thick) + '" rx="' + n(rx) + '" ry="' + n(ry) + '" fill="' + DARK[color] + '"/>' +
      '<rect x="' + n(x - rx) + '" y="' + n(y) + '" width="' + n(2 * rx) + '" height="' + n(thick) + '" fill="' + DARK[color] + '"/>' +
      '<ellipse cx="' + n(x) + '" cy="' + n(y) + '" rx="' + n(rx) + '" ry="' + n(ry) + '" fill="' + FILL[color] + '"/>' +
      '<use href="#face-' + color + '" x="' + n(x - rx * 0.86) + '" y="' + n(y - ry * 0.86) + '" width="' + n(rx * 1.72) + '" height="' + n(ry * 1.72) + '"/>' +
      '<ellipse cx="' + n(x - rx * 0.3) + '" cy="' + n(y - ry * 0.45) + '" rx="' + n(rx * 0.4) + '" ry="' + n(ry * 0.22) + '" fill="#fff" opacity=".18"/>' +
      '</g>';
  }
  function cubeMark(x, y, cardId, spirit, extraClass) {
    const s = 0.6;
    return '<g class="cube' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<ellipse cx="' + n(x) + '" cy="' + n(y + 0.3) + '" rx=".42" ry=".16" fill="#000" opacity=".25"/>' +
      '<rect x="' + n(x - s / 2) + '" y="' + n(y - s / 2 + 0.02) + '" width="' + s + '" height="' + s + '" rx=".1" fill="' + (spirit ? '#d9a441' : '#2b2118') + '"/>' +
      '<rect x="' + n(x - s / 2) + '" y="' + n(y - s / 2 - 0.1) + '" width="' + s + '" height="' + n(s * 0.35) + '" rx=".08" fill="' + (spirit ? '#f0c975' : '#4a3a2c') + '"/>' +
      '<use href="#a-' + cardId + '" x="' + n(x - 0.42) + '" y="' + n(y - 0.98) + '" width=".84" height=".84"/></g>';
  }
  // Pile complète à (x, y) ; opts.newTop marque le dernier disque (animation), opts.newCube le cube.
  function stack(x, y, s, cube, opts) {
    opts = opts || {};
    const rx = 0.62, ry = 0.42, thick = 0.2, lift = 0.3;
    let out = '<g class="stack" data-cell="' + (opts.cellIdx === undefined ? '' : opts.cellIdx) + '">' +
      '<ellipse cx="' + n(x + 0.08) + '" cy="' + n(y + thick + 0.12) + '" rx="' + n(rx + 0.08) + '" ry="' + n(ry + 0.02) + '" fill="#000" opacity=".22"/>';
    s.forEach((color, k) => { out += disc(x, y - k * lift, color, rx, ry, thick, opts.newTop && k === s.length - 1 ? 'arriving' : ''); });
    if (cube) out += cubeMark(x, y - (s.length - 1) * lift - 0.05, cube.id, !!cube.sp, opts.newCube ? 'arriving' : '');
    return out + '</g>';
  }
  // Petit jeton isolé (barre de main, plateau central, vol d'animation)
  function tokenSVG(color, extra) {
    return '<svg viewBox="-0.8 -0.7 1.6 1.6" ' + (extra || '') + '>' + disc(0, 0, color, 0.66, 0.44, 0.22) + '</svg>';
  }
  function slotSVG(tokens, arriving) {
    if (!tokens.length) return '';
    let out = '<svg viewBox="-0.9 -0.7 1.8 3.4">';
    tokens.forEach((t, i) => { out += disc(0, i * 0.95, t, 0.66, 0.44, 0.22, arriving ? 'arriving' : ''); });
    return out + '</svg>';
  }
  // Sac de jetons
  function pouchSVG(count) {
    return '<svg class="pouch" viewBox="0 0 40 44"><path d="M8,20 C4,30 6,40 20,41 C34,40 36,30 32,20 C28,14 12,14 8,20 Z" fill="#c9a76b"/>' +
      '<path d="M10,22 C7,30 9,37 20,38 C31,37 33,30 30,22" fill="none" stroke="#a88652" stroke-width="1.2" opacity=".6"/>' +
      '<path d="M12,17 Q20,11 28,17 L26,12 Q20,8 14,12 Z" fill="#b8955a"/><path d="M11,16 Q20,20 29,16" stroke="#7a5d33" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '<text x="20" y="32" text-anchor="middle" font-size="12" font-weight="700" fill="#4e351d">' + count + '</text></svg>';
  }
  // Pioche de cartes Animaux (dos)
  function deckSVG(count) {
    return '<svg class="deck" viewBox="0 0 60 84"><rect x="6" y="6" width="50" height="72" rx="6" fill="#3a2a1c"/><rect x="3" y="3" width="50" height="72" rx="6" fill="#4e351d" stroke="#7a5d33" stroke-width="1.5"/>' +
      '<rect x="3" y="3" width="50" height="72" rx="6" fill="url(#card-back)"/><circle cx="28" cy="34" r="12" fill="#2b2118" opacity=".45"/>' +
      '<g fill="#f3d9a6"><ellipse cx="28" cy="37" rx="5" ry="4"/><circle cx="22" cy="31" r="2.2"/><circle cx="26.5" cy="28.5" r="2.2"/><circle cx="31.5" cy="29" r="2.2"/><circle cx="35" cy="32.5" r="2"/></g>' +
      '<text x="28" y="66" text-anchor="middle" font-size="13" font-weight="700" fill="#f3d9a6">' + count + '</text></svg>';
  }

  // Plateau personnel. opts: {legal:Set, targets:Set, last:Set, readonly:bool, newTop:idx, newCube:idx}
  function boardSVG(board, opts) {
    opts = opts || {};
    const pad = 1.25;
    const minX = -pad, minY = -SQ3 / 2 - pad + 0.35, maxX = 6 + pad, maxY = SQ3 * 4.5 + SQ3 / 2 + pad - 0.15;
    const W = maxX - minX, H = maxY - minY;
    let out = '<svg class="board' + (opts.readonly ? ' readonly' : '') + '" viewBox="' + n(minX) + ' ' + n(minY) + ' ' + n(W) + ' ' + n(H) + '">' +
      '<defs><radialGradient id="earth" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#b4905f"/><stop offset=".7" stop-color="#8f6d45"/><stop offset="1" stop-color="#6e5232"/></radialGradient></defs>' +
      '<rect x="' + n(minX) + '" y="' + n(minY) + '" width="' + n(W) + '" height="' + n(H) + '" rx=".9" fill="url(#earth)"/>' +
      // décor : sentiers, mares, reliefs
      '<g fill="none" stroke="#f1e2c3" stroke-width=".1" opacity=".28" stroke-linecap="round"><path d="M-1.1,1.2 C-.2,.4 .6,1.6 1.4,.3"/><path d="M5.2,-.9 C6.1,-.2 5.9,1.2 7.1,1.8"/><path d="M-1.1,6.4 C.2,6.9 .8,8.4 2.4,8.5"/><path d="M4.4,8.7 C5.4,8.1 6.4,8.8 7.1,7.6"/></g>' +
      '<ellipse cx="-.8" cy="4.3" rx=".42" ry=".3" fill="#5aa6a0" opacity=".7"/><ellipse cx="7" cy="2.6" rx=".3" ry=".5" fill="#5aa6a0" opacity=".7"/>' +
      '<g fill="#7b6247" opacity=".8"><path d="M5.7,8.9 L6.2,8.1 L6.7,8.9 Z"/><path d="M6.4,8.9 L6.9,8.3 L7.3,8.9 Z"/></g>' +
      '<g fill="#5d7a3a" opacity=".75"><circle cx="-.9" cy="-.4" r=".22"/><circle cx="-.55" cy="-.7" r=".17"/><circle cx="6.9" cy="-.5" r=".2"/></g>';
    // cases
    E.CELLS.forEach((cell, i) => {
      const { x, y } = cellCenter(cell.c, cell.r);
      let cls = 'hex';
      if (opts.legal && opts.legal.has(i)) cls += ' legal';
      if (opts.targets && opts.targets.has(i)) cls += ' target';
      if (opts.last && opts.last.has(i)) cls += ' last';
      out += '<g class="cell" data-idx="' + i + '"><polygon class="' + cls + '" data-idx="' + i + '" points="' + hexPoints(x, y, 0.94) + '"/>' +
        '<polygon class="hex-inner" points="' + hexPoints(x, y - 0.03, 0.78) + '"/></g>';
    });
    // piles, dessinées de haut en bas de l'écran pour que les piles du bas recouvrent
    const order = E.CELLS.map((cell, i) => ({ i, y: cellCenter(cell.c, cell.r).y })).sort((a, b) => a.y - b.y);
    for (const { i } of order) {
      const cell = board[i];
      const { x, y } = cellCenter(E.CELLS[i].c, E.CELLS[i].r);
      if (cell.s.length) out += stack(x, y + 0.12, cell.s, cell.cube, { cellIdx: i, newTop: opts.newTop === i, newCube: opts.newCube === i });
      else if (opts.legal && opts.legal.has(i)) out += '<circle class="legal-dot" cx="' + n(x) + '" cy="' + n(y) + '" r=".2"/>';
      if (opts.targets && opts.targets.has(i)) out += '<circle class="target-dot" cx="' + n(x) + '" cy="' + n(y - cell.s.length * 0.3 - 0.8) + '" r=".18"/>';
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
        const nb = E.neighborCoord(c, r, (card.pat[k].d + rot) % 6);
        c = nb.c; r = nb.r; cells.push({ c, r });
      }
      const pts = cells.map(cc => cellCenter(cc.c, cc.r));
      const ys = pts.map(p => p.y), xs = pts.map(p => p.x);
      const h = Math.max(...ys) - Math.min(...ys), w = Math.max(...xs) - Math.min(...xs);
      const score = h * 10 - w;
      if (!best || score < best.score) best = { score, pts };
    }
    return best.pts;
  }
  function patternSVG(card) {
    const pts = patternLayout(card);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs) - 1.15, maxX = Math.max(...xs) + 1.15;
    const minY = Math.min(...ys) - 1.9, maxY = Math.max(...ys) + 1.05;
    let out = '<svg class="pattern" viewBox="' + n(minX) + ' ' + n(minY) + ' ' + n(maxX - minX) + ' ' + n(maxY - minY) + '" preserveAspectRatio="xMidYMid meet">';
    pts.forEach(p => { out += '<polygon points="' + hexPoints(p.x, p.y, 0.94) + '" fill="#efdcb6" stroke="#b9976a" stroke-width=".07"/>'; });
    const order = pts.map((p, k) => ({ k, y: p.y })).sort((a, b) => a.y - b.y);
    for (const { k } of order) {
      const p = pts[k], step = card.pat[k];
      let s = step.s.slice().reverse(); // du bas vers le haut
      if (step.s.length === 2 && step.s[0] === 6 && step.s[1] === 7) s = [7, 6];
      let g = '<g class="stack">';
      s.forEach((color, lvl) => {
        const y = p.y + 0.12 - lvl * 0.3;
        if (color === 7) {
          // base quelconque : disque tricolore (gris / marron / rouge)
          g += '<ellipse cx="' + n(p.x) + '" cy="' + n(y + 0.2) + '" rx=".62" ry=".42" fill="#5a4a3a"/><rect x="' + n(p.x - 0.62) + '" y="' + n(y) + '" width="1.24" height=".2" fill="#5a4a3a"/>' +
            '<path d="M' + n(p.x - 0.62) + ' ' + n(y) + ' A .62 .42 0 0 1 ' + n(p.x + 0.62) + ' ' + n(y) + ' L ' + n(p.x) + ' ' + n(y) + ' Z" fill="' + FILL[2] + '"/>' +
            '<path d="M' + n(p.x + 0.62) + ' ' + n(y) + ' A .62 .42 0 0 1 ' + n(p.x - 0.62) + ' ' + n(y) + ' L ' + n(p.x) + ' ' + n(y) + ' Z" fill="' + FILL[3] + '"/>' +
            '<path d="M' + n(p.x - 0.62) + ' ' + n(y) + ' A .62 .42 0 0 0 ' + n(p.x - 0.31) + ' ' + n(y + 0.365) + ' L ' + n(p.x + 0.31) + ' ' + n(y + 0.365) + ' A .62 .42 0 0 0 ' + n(p.x + 0.62) + ' ' + n(y) + ' L ' + n(p.x) + ' ' + n(y) + ' Z" fill="' + FILL[6] + '"/>';
        } else g += disc(p.x, y, color, 0.62, 0.42, 0.2);
      });
      if (step.cube) {
        const topY = p.y + 0.12 - (s.length - 1) * 0.3;
        g += '<rect x="' + n(p.x - 0.3) + '" y="' + n(topY - 0.78) + '" width=".6" height=".6" rx=".1" fill="' + (card.spirit ? '#d9a441' : '#2b2118') + '"/>' +
          '<use href="#a-' + card.id + '" x="' + n(p.x - 0.5) + '" y="' + n(topY - 1.5) + '" width="1" height="1"/>';
      }
      out += g + '</g>';
    }
    return out + '</svg>';
  }

  // Collines striées (esthétique de la boîte du jeu). bands = couleurs de l'arrière vers l'avant.
  let hillUid = 0;
  function hillsSVG(w, h, bands, opts) {
    opts = opts || {};
    const uid = ++hillUid;
    const seed = opts.seed || 1;
    const rnd = k => { const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
    const sky = opts.sky || ['#fdf1c4', '#f9d977'];
    let out = '<svg class="' + (opts.cls || 'hills') + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="' + (opts.par || 'none') + '">' +
      '<defs><pattern id="st' + uid + '" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)"><rect width="2.6" height="7" fill="#fff" opacity=".16"/></pattern>' +
      '<linearGradient id="sk' + uid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + sky[0] + '"/><stop offset="1" stop-color="' + sky[1] + '"/></linearGradient></defs>' +
      '<rect width="' + w + '" height="' + h + '" fill="url(#sk' + uid + ')"/>';
    if (opts.sun !== false) {
      const sx = w * (opts.sunX || 0.78);
      out += '<circle cx="' + n(sx) + '" cy="' + n(h * 0.28) + '" r="' + n(h * 0.24) + '" fill="#fff3b8" opacity=".35"/><circle cx="' + n(sx) + '" cy="' + n(h * 0.28) + '" r="' + n(h * 0.16) + '" fill="#fff7d6" opacity=".95"/>';
    }
    const nb = bands.length;
    bands.forEach((color, i) => {
      const base = h * (0.42 + 0.5 * i / nb);
      const a = h * 0.12 * (0.6 + rnd(i));
      const y0 = base + (rnd(i + 10) - 0.5) * a, y1 = base - a * rnd(i + 20), y2 = base + a * (rnd(i + 30) - 0.3), y3 = base - a * rnd(i + 40) * 0.6;
      const d = 'M0,' + n(y0) + ' C' + n(w * 0.22) + ',' + n(y1 - a) + ' ' + n(w * 0.3) + ',' + n(y2 + a * 0.8) + ' ' + n(w * 0.5) + ',' + n(y2) +
        ' S' + n(w * 0.8) + ',' + n(y3 - a * 0.5) + ' ' + w + ',' + n(y3) + ' L' + w + ',' + h + ' L0,' + h + ' Z';
      out += '<path d="' + d + '" fill="' + color + '"/><path d="' + d + '" fill="url(#st' + uid + ')"/>';
    });
    if (opts.reeds) {
      const tips = ['#f2c94c', '#e8873a', '#5cc2b7', '#d96a8e'];
      let stems = '', heads = '';
      for (let k = 0; k < opts.reeds; k++) {
        const x = w * (0.04 + 0.92 * rnd(k + 50)), hh = h * (0.12 + 0.16 * rnd(k + 60)), tilt = (rnd(k + 70) - 0.5) * 8;
        stems += '<path d="M' + n(x) + ',' + h + ' q' + n(tilt) + ',' + n(-hh / 2) + ' ' + n(tilt * 1.6) + ',' + n(-hh) + '"/>';
        heads += '<ellipse cx="' + n(x + tilt * 1.6) + '" cy="' + n(h - hh) + '" rx="1.6" ry="3.2" fill="' + tips[k % 4] + '"/>';
      }
      out += '<g fill="none" stroke="#1e2a5a" stroke-width="1.2" stroke-linecap="round" opacity=".75">' + stems + '</g><g>' + heads + '</g>';
    }
    return out + '</svg>';
  }
  // Illustration d'une carte : collines aux couleurs de l'habitat.
  const SKY = { 1: ['#e6f4fb', '#9fd3ef'], 2: ['#eef1f5', '#b9c5d3'], 3: ['#f8ecd8', '#e2c59a'], 4: ['#eaf6dc', '#b6dc95'], 5: ['#fff3c8', '#f7d268'], 6: ['#fde4d3', '#f4b08a'] };
  const HILL = { 1: ['#7fc3e6', '#3d8fc4', '#2c4a8a'], 2: ['#b3b7bb', '#8f9498', '#5f6468'], 3: ['#b98a5e', '#7d4b2a', '#52301a'], 4: ['#9ad160', '#6aa83c', '#467527'], 5: ['#f2cb55', '#e8b526', '#c98f14'], 6: ['#e0655f', '#cf4540', '#922c29'] };
  function sceneSVG(card) {
    const colors = [];
    card.pat.forEach(step => step.s.forEach(c => { if (c !== 7 && !colors.includes(c)) colors.push(c); }));
    const cubeStep = card.pat.find(p => p.cube);
    const main = cubeStep.s[0] === 7 ? 6 : cubeStep.s[0];
    const second = colors.find(c => c !== main) || main;
    const bands = [HILL[second][0], HILL[main][1], HILL[second][1], HILL[main][2]];
    return hillsSVG(120, 70, bands, { sky: SKY[main], seed: card.id, cls: 'scene', sunX: 0.8 });
  }
  function animalSVG(id, cls) {
    return '<svg class="animal' + (cls ? ' ' + cls : '') + '" viewBox="0 0 72 72" aria-hidden="true"><use href="#a-' + id + '"/></svg>';
  }
  function logoSVG(cls) {
    return '<svg class="' + (cls || 'logo-svg') + '" viewBox="0 0 340 70"><text x="170" y="54" text-anchor="middle" textLength="322" lengthAdjust="spacingAndGlyphs" font-family="Fredoka, Nunito, Arial, sans-serif" font-weight="700" font-size="54" fill="#fff" stroke="#1e2a5a" stroke-width="6" stroke-linejoin="round" paint-order="stroke">HARMONIES</text></svg>';
  }

  // Couleur (CSS) de la case cube d'une carte, pour la bande de rappel.
  function cubeColorOf(card) {
    const step = card.pat.find(p => p.cube);
    const c = step.s[0] === 7 ? 6 : step.s[0];
    return FILL[c];
  }

  root.Render = { defsSVG, tokenSVG, slotSVG, pouchSVG, deckSVG, boardSVG, patternSVG, sceneSVG, hillsSVG, animalSVG, logoSVG, cubeColorOf, esc, FILL, DARK, LIGHT };
})(typeof self !== 'undefined' ? self : this);
