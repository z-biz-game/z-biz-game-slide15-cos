// The出题 end of the pipeline. It exists so that the difficulty a player sees is the
// difficulty a search measured, and it runs at build time only (tools/bake.mjs) — a slide
// board is cheap to solve at 3x3 and expensive at 4x4, and either way a tap on the screen
// must never wait for it.
//
// Scrambling is a random walk away from the goal rather than a shuffle of the tiles, which
// is what keeps the board solvable by construction. The walk length is only a suggestion:
// a 60-step walk can still collapse back to a 12-step optimum, so the band a board belongs
// to is decided by the measured `par` and nothing else. Boards that land outside the band
// are thrown away and counted, which is why bake prints an acceptance rate instead of
// pretending the generator always hits its target.

import { goalState, neighbours, swap, toArray, widthOf } from './puzzle.js';
import { solvable } from './parity.js';
import { solve } from './solve.js';
import { rngFrom } from './rng.js';

// Two scrambles, and the difference between them is the point of the parity module:
// a walk cannot leave the reachable component, a uniform shuffle lands outside it half the
// time. `perm` exists so tools/bake.mjs can show the unsolvable gate actually firing.
export function walkScramble(seed, n, steps) {
  const rng = rngFrom(seed);
  const board = goalState(n);
  const adj = neighbours(n);
  let blank = board.length - 1;
  let back = -1;
  for (let i = 0; i < steps; i++) {
    const near = adj[blank];
    const cand = [];
    for (let k = 0; k < near.length; k++) if (near[k] !== back) cand.push(near[k]);
    const t = cand[rng.int(cand.length)];
    swap(board, blank, t);
    back = blank;
    blank = t;
  }
  return board;
}

export function permScramble(seed, n) {
  const rng = rngFrom(`${seed}|perm`);
  const board = goalState(n);
  rng.shuffle(board);
  return board;
}

// The generation ladder. `min`/`max` is the band of *measured* optima a board must land in
// to ship; `walk` is the random-walk length range used to propose boards to that band;
// `nodeLimit`/`timeLimitMs` is the search budget, and a board whose search runs out of
// budget is discarded rather than published with an estimate.
//
// The 3x3 bands are the spec's (2-8 / 9-16 / 17-24 / 25-31; 31 is the diameter of the
// exhaustive table, so the top band is "as hard as this board can be"). The 4x4 bands are
// set from measurement, not from hope: see README/DESIGN for the accepted-rate numbers.
export const BANDS = [
  { key: 'kerb', label: '起手', n: 3, min: 2, max: 8, walk: [4, 12], nodeLimit: 200000, timeLimitMs: 1000 },
  { key: 'cross', label: '熟盘', n: 3, min: 9, max: 16, walk: [14, 24], nodeLimit: 200000, timeLimitMs: 1000 },
  { key: 'deep', label: '深盘', n: 3, min: 17, max: 24, walk: [26, 46], nodeLimit: 200000, timeLimitMs: 1000 },
  { key: 'abyss', label: '绝境', n: 3, min: 25, max: 31, walk: [60, 120], nodeLimit: 200000, timeLimitMs: 1000 },
  { key: 'field', label: '方城', n: 4, min: 12, max: 24, walk: [18, 34], nodeLimit: 400000, timeLimitMs: 2000 },
  { key: 'wall', label: '石墙', n: 4, min: 25, max: 36, walk: [42, 60], nodeLimit: 400000, timeLimitMs: 2000 },
  { key: 'siege', label: '深渊', n: 4, min: 37, max: 50, walk: [70, 120], nodeLimit: 400000, timeLimitMs: 2000 },
];

export function bandByKey(key) {
  return BANDS.find((b) => b.key === key) || BANDS[0];
}

export function bandsFor(n) {
  return BANDS.filter((b) => b.n === n);
}

// One attempt: scramble, decide solvability for free, search it, then judge the measured
// optimum against the band. Returns null (and records why) when the board does not qualify.
export function makeAttempt(seed, band, stats, opts = {}) {
  const hit = (k) => { if (stats) stats[k] = (stats[k] || 0) + 1; };
  const rng = rngFrom(`${seed}|walk`);
  const steps = band.walk[0] + rng.int(band.walk[1] - band.walk[0] + 1);
  const state = (opts.scramble || band.scramble) === 'perm'
    ? permScramble(seed, band.n)
    : walkScramble(seed, band.n, steps);
  hit('attempt');

  if (!solvable(state)) { hit('unsolvable'); return null; }
  const r = solve(state, { nodeLimit: band.nodeLimit, timeLimitMs: band.timeLimitMs });
  if (!r.ok) {
    hit(r.reason === 'unsolvable' ? 'unsolvable' : 'truncated');
    return null;
  }
  if (r.moves < band.min) { hit('tooEasy'); return null; }
  if (r.moves > band.max) { hit('tooHard'); return null; }
  hit('keep');
  return {
    n: widthOf(state),
    band: band.key,
    state: toArray(state),
    par: r.moves,
    path: r.path,
    nodes: r.nodes,
    ms: r.ms,
    steps,
  };
}

// A seed always grows the same board: `restarts` attempts are derived from the seed, so a
// shared seed is a shared puzzle and a re-bake reproduces the shipped file.
export function makePuzzle(seed, band, stats, opts) {
  const tries = (opts && opts.tries) || 40;
  for (let i = 0; i < tries; i++) {
    const out = makeAttempt(`${seed}#${i}`, band, stats, opts);
    if (out) {
      out.seed = `${seed}#${i}`;
      return out;
    }
  }
  if (stats) stats.gaveUp = (stats.gaveUp || 0) + 1;
  return null;
}
