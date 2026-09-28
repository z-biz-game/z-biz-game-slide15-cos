// The lower bound IDA* searches against. It is admissible — it never overstates the number
// of slides still needed — and that is the whole reason the first solution IDA* prints is
// the optimum rather than a guess. test/heur.test.mjs checks the property against the
// 3x3 exhaustive table instead of trusting this comment.

import { widthOf, goalState } from './puzzle.js';

const MAPS = new Map(); // n -> goal row/column per tile value
const SCRATCH = new Map(); // n -> line buffers, so the search allocates nothing per node

function goalMaps(n) {
  let m = MAPS.get(n);
  if (!m) {
    const g = goalState(n);
    const row = new Uint8Array(n * n);
    const col = new Uint8Array(n * n);
    for (let i = 0; i < g.length; i++) {
      row[g[i]] = Math.floor(i / n);
      col[g[i]] = i % n;
    }
    m = { row, col };
    MAPS.set(n, m);
  }
  return m;
}

function scratch(n) {
  let s = SCRATCH.get(n);
  if (!s) {
    s = { line: new Uint8Array(n), dp: new Uint8Array(n) };
    SCRATCH.set(n, s);
  }
  return s;
}

// Sum of each tile's distance to its own home cell. Every slide moves exactly one tile one
// cell, so this counts a lower bound on slides: a tile still owes that many of them.
// The blank is deliberately not counted — it has no tile to deliver.
export function manhattan(state) {
  const n = widthOf(state);
  const { row, col } = goalMaps(n);
  let d = 0;
  for (let i = 0; i < state.length; i++) {
    const t = state[i];
    if (t === 0) continue;
    d += Math.abs(Math.floor(i / n) - row[t]) + Math.abs((i % n) - col[t]);
  }
  return d;
}

// Fewest tiles that must step out of a line before the rest stop crossing each other.
// `line` holds the goal coordinates of the tiles already in their goal line, ordered by
// where they stand now; a crossing pair can only be untangled by someone leaving the line,
// and a tile that leaves pays at least two extra slides (out and back).
function removals(line, k, dp) {
  if (k < 2) return 0;
  for (let i = 0; i < k; i++) {
    let best = 1;
    for (let j = 0; j < i; j++) {
      if (line[j] < line[i] && dp[j] + 1 > best) best = dp[j] + 1;
    }
    dp[i] = best;
  }
  let longest = 1;
  for (let i = 0; i < k; i++) if (dp[i] > longest) longest = dp[i];
  return k - longest;
}

// Linear conflict on top of Manhattan: two tiles in each other's way in the same goal line
// each owe an extra detour. Counting crossing *pairs* would overcharge (three mutually
// crossing tiles cost four slides, not six), so the line is charged by the minimum number
// of tiles that have to leave it — the longest ordered run stays, the rest detour.
export function linearConflict(state) {
  const n = widthOf(state);
  const { row, col } = goalMaps(n);
  const { line, dp } = scratch(n);
  let total = 0;
  for (let r = 0; r < n; r++) {
    let k = 0;
    for (let c = 0; c < n; c++) {
      const t = state[r * n + c];
      if (t !== 0 && row[t] === r) line[k++] = col[t];
    }
    total += 2 * removals(line, k, dp);
  }
  for (let c = 0; c < n; c++) {
    let k = 0;
    for (let r = 0; r < n; r++) {
      const t = state[r * n + c];
      if (t !== 0 && col[t] === c) line[k++] = row[t];
    }
    total += 2 * removals(line, k, dp);
  }
  return total;
}

export function heuristic(state) {
  return manhattan(state) + linearConflict(state);
}
