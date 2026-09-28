// Canvas renderer + pointer handling. This file owns pixels and gestures and decides
// nothing: `js/core/puzzle.js` is the only place a press is judged legal, and the shell's
// `commit()` is the only place one is billed. The view asks ("may this slide?") through the
// same pure function the rule test drives, so there is exactly one implementation of the
// rule in the repo and never a second copy in here.
//
// Everything drawn is generated: a tray, n×n sockets and n*n-1 tiles. No image files, no
// fonts, no sprites — tiles are rounded rects with a gradient, a specular edge and a number
// set in the system monospace face.
//
// What the picture has to get right is the physics of the toy: only a tile touching the hole
// can move, it travels *into* the hole along one axis, and it never jumps over its
// neighbours. `ax/ay` animate that travel, which is what makes a drag feel like a push
// rather than a repaint.

import { widthOf, blankAt, canSlide, goalState, slidePositions } from './core/puzzle.js';

const PAD = 18;
const RATE = 16; // tile travel stiffness, per second

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createView(canvas, { onSlide, onIllegal } = {}) {
  // `willReadFrequently` because tools/playtest.mjs reads the bitmap back to prove that a
  // legal press changes the picture and an illegal one does not; without it Chrome logs a
  // warning on every readback, which would drown the console-clean check.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let game = null;
  let geom = { n: 3, cell: 64, x0: 20, y0: 20, size: 192, gap: 6, w: 320, h: 320 };
  let ax = new Float64Array(16); // tile value -> animated column
  let ay = new Float64Array(16); // tile value -> animated row
  let shake = new Float64Array(16); // decays after a refused press
  let live = []; // cells the rule accepts right now, refreshed once per draw
  let goal = null; // goal board for the current width, for the "is this tile home" tint
  let hint = null; // { cell, until }
  let drag = null; // { cell, value, ux, uy, dx, dy, fired }
  let moving = false; // is any tile still travelling (or still shaking)? `settled()` reads it
  let raf = 0;
  let last = 0;
  let warm = 0; // first frames always repaint, so the canvas is never blank

  function measure() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const W = Math.max(160, Math.round(box.width));
    const H = Math.max(160, Math.round(box.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = game ? widthOf(game.state) : 3;
    const size = Math.max(80, Math.floor(Math.min(W, H) - PAD * 2));
    const cell = Math.floor(size / n);
    geom = {
      n,
      cell,
      gap: Math.max(2, Math.round(cell * 0.075)),
      x0: Math.round((W - cell * n) / 2),
      y0: Math.round((H - cell * n) / 2),
      size: cell * n,
      w: W,
      h: H,
    };
    draw();
  }

  // ---- geometry, both directions ------------------------------------------------
  // Canvas-local centre of a *cell index* (the hole in the tray, wherever a tile is).
  function cellCentre(cell) {
    return {
      x: geom.x0 + (cell % geom.n + 0.5) * geom.cell,
      y: geom.y0 + (Math.floor(cell / geom.n) + 0.5) * geom.cell,
    };
  }

  // Canvas-local centre of a *tile*, which is where it is drawn right now — mid-travel and
  // mid-drag included, so an automated finger aims at the picture rather than at the model.
  function tileCentre(value) {
    return {
      x: geom.x0 + (ax[value] + 0.5) * geom.cell,
      y: geom.y0 + (ay[value] + 0.5) * geom.cell,
    };
  }

  function toClient(ux, uy) {
    const box = canvas.getBoundingClientRect();
    return { x: Math.round(box.left + ux), y: Math.round(box.top + uy) };
  }

  // Client-space point -> cell index, or -1 off the tray.
  //
  // The *drawn* tile wins over the grid square under the finger: while a slide is still
  // animating, the tile the player aimed at is halfway between its old cell and its model
  // cell, and answering with the grid square would report the neighbour instead. Naming the
  // tile's own cell keeps `pointAt(cellPoint(c).x, cellPoint(c).y) === c` true mid-animation,
  // which is what lets tools/playtest.mjs assert that a coordinate means the cell it claims.
  function cellAtClient(cx, cy) {
    const box = canvas.getBoundingClientRect();
    const ux = cx - box.left;
    const uy = cy - box.top;
    if (game) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < game.state.length; i++) {
        const v = game.state[i];
        if (v === 0) continue;
        const c = tileCentre(v);
        const d = Math.max(Math.abs(c.x - ux), Math.abs(c.y - uy));
        if (d <= geom.cell / 2 && d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) return best;
    }
    const c = Math.floor((ux - geom.x0) / geom.cell);
    const r = Math.floor((uy - geom.y0) / geom.cell);
    if (c < 0 || r < 0 || c >= geom.n || r >= geom.n) return -1;
    return r * geom.n + c;
  }

  function localPoint(ev) {
    const box = canvas.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }

  // Which tile value sits in a cell right now (0 = the hole).
  function tileIn(cell) {
    if (!game || cell < 0 || cell >= game.state.length) return -1;
    return game.state[cell];
  }

  function cellOf(value) {
    if (!game) return -1;
    for (let i = 0; i < game.state.length; i++) if (game.state[i] === value) return i;
    return -1;
  }

  // Snap every tile to where the board says it belongs — used on load and after a reset,
  // when animating a whole board from scratch would just be noise.
  function settle() {
    const n = widthOf(game.state);
    if (ax.length < n * n) {
      ax = new Float64Array(n * n);
      ay = new Float64Array(n * n);
      shake = new Float64Array(n * n);
    }
    for (let i = 0; i < game.state.length; i++) {
      const v = game.state[i];
      if (v === 0) continue;
      ax[v] = i % n;
      ay[v] = Math.floor(i / n);
    }
    shake.fill(0);
    drag = null;
    moving = false;
  }

  // ---- gesture ------------------------------------------------------------------
  // A press has two lives. If the finger moves far enough along the only axis the tile can
  // travel, it is a drag and the slide fires the moment the tile is past a third of a cell —
  // so the picture keeps up with the finger. If it does not move, the release is a click.
  function down(ev) {
    if (!game || game.done) return;
    const cell = cellAtClient(ev.clientX, ev.clientY);
    if (cell < 0) return; // bare table is not a tile, and costs nothing
    const value = tileIn(cell);
    ev.preventDefault();
    // Capture keeps a drag that wanders off the tile (or off the canvas) attached to this
    // gesture. Guarded: a pointer synthesised by a test driver is not always capturable, and
    // an exception thrown out of an event listener would pollute the clean-console gate.
    try {
      if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
    } catch { /* no capture, no drag-follow: the click path still works */ }
    if (hint && hint.cell === cell) hint = null;
    if (value === 0) return; // pressing the hole is not a press on a tile at all
    if (!canSlide(game.state, cell)) {
      shake[value] = 1; // feedback is all a refused press is allowed to buy
      if (onIllegal) onIllegal(cell, value);
      draw();
      return;
    }
    const blank = cellOf(0);
    // ux/uy are the *pixel* direction the tile has to travel, in cell units: from the tile
    // towards the hole. Exactly one component is non-zero, because only a tile touching the
    // blank can be pushed. Getting this sign the other way round makes the gesture refuse to
    // fire, which is why tools/verify.sh drags a tile for real instead of trusting this file.
    drag = {
      cell,
      value,
      ux: (blank % geom.n) - (cell % geom.n),
      uy: Math.floor(blank / geom.n) - Math.floor(cell / geom.n),
      dx: 0,
      dy: 0,
      travel: 0,
      fired: false,
      x0: localPoint(ev).x,
      y0: localPoint(ev).y,
    };
    draw();
  }

  function move(ev) {
    if (!drag || drag.fired || !game) return;
    const p = localPoint(ev);
    drag.dx = p.x - drag.x0;
    drag.dy = p.y - drag.y0;
    // Only the component pointing at the hole counts: dragging away from the blank is the
    // player changing their mind, not a second move.
    drag.travel = Math.max(0, drag.dx * drag.ux + drag.dy * drag.uy);
    if (drag.travel >= geom.cell * 0.34) {
      drag.fired = true;
      const cell = drag.cell;
      drag = null;
      if (onSlide) onSlide(cell);
    } else {
      draw();
    }
  }

  function up(ev) {
    if (!drag || !game) return;
    const d = drag;
    drag = null;
    const p = localPoint(ev);
    const far = Math.hypot(p.x - d.x0, p.y - d.y0) > geom.cell * 0.34;
    if (!d.fired && !far && onSlide) onSlide(d.cell); // a click: same gate, same cost
    draw();
  }

  function cancel() {
    drag = null;
    draw();
  }

  // ---- drawing ------------------------------------------------------------------
  function drawTray() {
    const { w, h } = geom;
    ctx.fillStyle = '#181b21';
    roundRect(ctx, 10, 10, w - 20, h - 20, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.08)';
    ctx.lineWidth = 1;
    roundRect(ctx, 10, 10, w - 20, h - 20, 16);
    ctx.stroke();

    // Sockets, each labelled faintly with the number that belongs there: the target layout is
    // part of the picture, so "one, two, three..." reads as the same shape every board. The
    // last socket is the hole's home and gets no label, exactly like the goal board.
    for (let i = 0; i < geom.n * geom.n; i++) {
      const c = cellCentre(i);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.035)';
      roundRect(ctx, c.x - geom.cell / 2 + 2, c.y - geom.cell / 2 + 2, geom.cell - 4, geom.cell - 4, geom.gap);
      ctx.fill();
      if (!game || i >= geom.n * geom.n - 1) continue;
      ctx.fillStyle = 'rgba(226, 232, 240, 0.10)';
      ctx.font = `600 ${Math.round(geom.cell * 0.2)}px "SF Mono", Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), c.x, c.y);
    }
  }

  function drawHole() {
    const blank = blankAt(game.state);
    const c = cellCentre(blank);
    const s = geom.cell - 2 * geom.gap;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([Math.max(3, geom.cell * 0.1), Math.max(3, geom.cell * 0.09)]);
    roundRect(ctx, c.x - s / 2, c.y - s / 2, s, s, geom.gap * 1.6);
    ctx.stroke();
    ctx.restore();
  }

  function drawTile(value) {
    const cell = cellOf(value);
    const can = live.indexOf(cell) >= 0;
    const home = game.state[cell] === goal[cell];
    const jitter = shake[value] > 0 ? Math.sin(shake[value] * 26) * shake[value] * geom.cell * 0.07 : 0;
    const d = drag && drag.value === value ? drag : null;
    const travel = d ? Math.min(d.travel, geom.cell) : 0;
    const x = geom.x0 + (ax[value] + 0.5) * geom.cell + (d ? d.ux * travel + jitter : jitter);
    const y = geom.y0 + (ay[value] + 0.5) * geom.cell + (d ? d.uy * travel : 0);
    const s = geom.cell - 2 * geom.gap;
    const r = Math.max(4, geom.gap * 1.6);

    ctx.save();
    const grad = ctx.createLinearGradient(x - s / 2, y - s / 2, x + s / 2, y + s / 2);
    if (can) {
      grad.addColorStop(0, '#e8b45a');
      grad.addColorStop(0.55, '#d8a13c');
      grad.addColorStop(1, '#966c1f');
    } else {
      grad.addColorStop(0, '#333b48');
      grad.addColorStop(0.6, '#2a3140');
      grad.addColorStop(1, '#222934');
    }
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = d ? 14 : 7;
    ctx.shadowOffsetY = d ? 6 : 3;
    ctx.fillStyle = grad;
    roundRect(ctx, x - s / 2, y - s / 2, s, s, r);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.lineWidth = 1;
    ctx.strokeStyle = can ? 'rgba(255, 236, 200, 0.5)' : 'rgba(226, 232, 240, 0.10)';
    roundRect(ctx, x - s / 2, y - s / 2, s, s, r);
    ctx.stroke();
    // Specular sweep along the top edge.
    ctx.strokeStyle = can ? 'rgba(255, 248, 232, 0.55)' : 'rgba(200, 210, 225, 0.16)';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath();
    ctx.moveTo(x - s / 2 + r, y - s / 2 + ctx.lineWidth);
    ctx.lineTo(x + s / 2 - r, y - s / 2 + ctx.lineWidth);
    ctx.stroke();

    // A tile already home is marked, so progress reads off the board and not only off the
    // counter in the panel.
    if (home && !can) {
      ctx.fillStyle = 'rgba(120, 220, 255, 0.16)';
      roundRect(ctx, x - s / 2, y - s / 2, s, s, r);
      ctx.fill();
    }
    ctx.fillStyle = can ? '#181b21' : (home ? '#cfe6f5' : '#c8cfda');
    ctx.font = `700 ${Math.round(geom.cell * (value > 9 ? 0.38 : 0.44))}px "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x, y + geom.cell * 0.02);

    if (can) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.30)';
      roundRect(ctx, x - s / 2 - 3, y - s / 2 - 3, s + 6, s + 6, r + 3);
      ctx.stroke();
    }
    if (hint && hint.cell === cell) {
      const t = (performance.now() % 1100) / 1100;
      ctx.lineWidth = 2 + t * 4;
      ctx.strokeStyle = `rgba(120, 220, 255, ${(0.9 - t * 0.6).toFixed(3)})`;
      roundRect(ctx, x - s / 2 - 5 - t * 6, y - s / 2 - 5 - t * 6, s + 10 + t * 12, s + 10 + t * 12, r + 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    const { w, h } = geom;
    ctx.clearRect(0, 0, w, h);
    drawTray();
    if (!game) return;
    live = Array.from(slidePositions(game.state));
    drawHole();
    // Tiles in cell order so a dragging one lands on top of where it came from.
    for (let i = 0; i < game.state.length; i++) {
      if (game.state[i] !== 0) drawTile(game.state[i]);
    }
  }

  function step(dt) {
    if (!game) { moving = false; return false; }
    let busy = false;
    const n = geom.n;
    for (let i = 0; i < game.state.length; i++) {
      const v = game.state[i];
      if (v === 0) continue;
      const tx = i % n;
      const ty = Math.floor(i / n);
      const dx = tx - ax[v];
      const dy = ty - ay[v];
      if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) {
        const k = Math.min(1, Math.max(0.12, dt * RATE));
        ax[v] += dx * k;
        ay[v] += dy * k;
        busy = true;
      } else if (ax[v] !== tx || ay[v] !== ty) {
        // Snap *and* repaint, so the last frame of a travel is exactly the settled geometry
        // rather than a frame 0.001 off. That is what makes "the picture came back to the
        // same place" a checkable statement (tools/playtest.mjs @pointer compares pixel
        // fingerprints across an undo).
        ax[v] = tx;
        ay[v] = ty;
        busy = true;
      }
      if (shake[v] > 0.002) {
        shake[v] = Math.max(0, shake[v] - dt * 2.6);
        busy = true;
      } else if (shake[v] !== 0) {
        shake[v] = 0;
        busy = true;
      }
    }
    moving = busy;
    return busy;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.064, (now - (last || now)) / 1000);
    last = now;
    const busy = step(dt);
    const hintAlive = !!(hint && now < hint.until);
    if (busy || hintAlive || drag || warm < 4) {
      warm++;
      draw();
    }
    if (hint && !hintAlive) {
      hint = null;
      draw();
    }
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // The canvas's box is decided by CSS, and a `window` resize event is not enough to follow
  // it: a phone rotating, the panel's text reflowing or a devtools split all change the box
  // without changing the window. Since the hit test maps client pixels through the geometry
  // measured from that box, measuring late means pressing the wrong tile — so watch the box.
  // (Guarded: this file is also loaded by `node --check`.)
  if (typeof ResizeObserver === 'function') {
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; } // the initial callback is the layout we already measured
      measure();
    });
    ro.observe(canvas);
  }

  return {
    attach(next) {
      game = next;
      goal = goalState(widthOf(next.state));
      hint = null;
      settle();
      measure();
    },
    detach() {
      game = null;
    },
    measure,
    redraw: draw,
    settle,
    // Where cell `cell` is on the screen right now, in client pixels — the mapping the hit
    // test reads, run backwards, so an automated finger presses where a tile actually is.
    cellPoint(cell) {
      if (!game || cell < 0 || cell >= game.state.length) return null;
      const c = cellCentre(cell);
      const value = game.state[cell];
      const drawn = value === 0 ? c : tileCentre(value);
      return {
        ...toClient(drawn.x, drawn.y),
        box: toClient(c.x, c.y),
        cell,
        tile: value,
        live: live.indexOf(cell) >= 0,
        size: geom.cell,
        n: geom.n,
        settled: !moving && !drag,
      };
    },
    // And where a numbered tile is, which is the same thing while nothing is travelling and a
    // different thing mid-animation.
    tilePoint(value) {
      if (!game || value <= 0 || value >= game.state.length) return null;
      const c = tileCentre(value);
      return { ...toClient(c.x, c.y), cell: cellOf(value), tile: value, size: geom.cell };
    },
    // Client point -> cell, so a test can prove a coordinate means the cell it thinks it
    // means before it presses it.
    pointAt(cx, cy) {
      return cellAtClient(cx, cy);
    },
    legalCells() {
      return game ? Array.from(slidePositions(game.state)) : [];
    },
    // False while a tile is still travelling or a refusal is still shaking: an automated
    // finger waits on this instead of guessing a sleep duration, so the pixel fingerprints it
    // compares are of settled geometry rather than of a frame mid-animation.
    settled() {
      return !moving && !drag;
    },
    // A cheap fingerprint of what is on screen: the browser suite uses it to assert that a
    // legal press changes pixels and a refused one does not.
    pixelsHash() {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i + 2 < d.length; i += 4 * 617) sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 2147483647;
      return sum;
    },
    painted() {
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    },
    showHint(cell) {
      hint = { cell, until: performance.now() + 2600 };
      draw();
    },
    geometry() {
      return { ...geom };
    },
    start() {
      if (!raf) {
        last = 0;
        warm = 0;
        raf = requestAnimationFrame(frame);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
