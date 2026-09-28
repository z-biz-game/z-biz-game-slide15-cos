// The solver, and therefore the thing that decides what "最少 N 步" means on screen.
//
// IDA* rather than BFS: BFS on 4x4 would have to hold 16!/2 = 10^13 states in memory, which
// is not a bigger constant, it is impossible. IDA* keeps one path in memory and leans on an
// admissible lower bound (js/core/heur.js) instead: with a bound that never overstates what
// is left, the first solution it can print at a given threshold is provably the shortest,
// so `moves` is an optimum and not a plausible-looking number.
//
// The budget is the other half of the honesty. A search that runs out of nodes or seconds
// returns `ok: false, truncated: true, moves: -1` — it never returns the threshold it was
// sitting on, because that would be the heuristic's opinion printed as a fact. Callers must
// throw such a board away (js/core/make.js counts it as `truncated`).

import { widthOf, isGoal, blankAt, neighbours, swap, applySlide } from './puzzle.js';
import { heuristic } from './heur.js';
import { solvable } from './parity.js';

// 3x3 finishes any reachable board in a few milliseconds, so the budget there is only a
// guard against an infinite loop. 4x4 is where the budget does real work: see DESIGN.md for
// the measured cost and the acceptance rate that comes out of it.
const NODE_LIMIT = 400000;
const TIME_LIMIT_MS = 2000;

// solve(state) -> { ok, moves, path, nodes, truncated, reason?, threshold? }
//   `path` is the list of cells whose tile slides, in order, starting from `state`.
//   Every move is its own inverse, so reading the list backwards undoes it.
export function solve(state, opts = {}) {
  const nodeLimit = opts.nodeLimit || NODE_LIMIT;
  const timeLimitMs = opts.timeLimitMs || TIME_LIMIT_MS;
  const src = state instanceof Uint8Array ? state : Uint8Array.from(state);
  const n = widthOf(src);

  if (isGoal(src)) {
    return { ok: true, moves: 0, path: [], nodes: 1, truncated: false, threshold: 0 };
  }
  // The parity theorem settles the hopeless ones for free; without this a dead board costs
  // a full budget before the answer is "no".
  if (!solvable(src)) {
    return { ok: false, moves: -1, path: [], nodes: 0, truncated: false, reason: 'unsolvable' };
  }

  const board = Uint8Array.from(src);
  const adj = neighbours(n);
  const blank0 = blankAt(board);
  const path = [];
  const startedAt = Date.now();
  let nodes = 0;
  let abort = null;

  // Depth-first branch and bound against an increasing threshold. `forbidden` is the cell
  // the blank just left: sliding that tile straight back is the one move that can never be
  // part of a shortest route, and pruning it is worth most of the speed here.
  function dfs(blank, g, bound, forbidden) {
    const h = heuristic(board);
    const f = g + h;
    if (f > bound) return f;
    if (h === 0) return -1; // a zero lower bound means every tile is home
    let min = Infinity;
    const near = adj[blank];
    for (let k = 0; k < near.length; k++) {
      const t = near[k];
      if (t === forbidden) continue;
      if (abort) return Infinity;
      if (++nodes > nodeLimit) { abort = 'nodes'; return Infinity; }
      if ((nodes & 2047) === 0 && Date.now() - startedAt > timeLimitMs) { abort = 'timeout'; return Infinity; }
      swap(board, blank, t);
      path.push(t);
      const r = dfs(t, g + 1, bound, blank);
      if (r === -1) return -1; // leave the winning path in place
      swap(board, blank, t);
      path.pop();
      if (r < min) min = r;
    }
    return min;
  }

  let threshold = heuristic(board);
  for (;;) {
    const r = dfs(blank0, 0, threshold, -1);
    if (r === -1) {
      return {
        ok: true,
        moves: path.length,
        path: path.slice(),
        nodes,
        truncated: false,
        threshold,
        ms: Date.now() - startedAt,
      };
    }
    if (abort) break;
    threshold = r;
    if (threshold === Infinity) break; // no board beyond the frontier: unreachable
  }

  if (abort) {
    return { ok: false, moves: -1, path: [], nodes, truncated: true, reason: abort, ms: Date.now() - startedAt };
  }
  return { ok: false, moves: -1, path: [], nodes, truncated: false, reason: 'exhausted', ms: Date.now() - startedAt };
}

// Walk a solver route over a board and hand back where it ends. Throws on a move that was
// never legal, which is how the tests catch a path that only *looks* like a solution:
// `isGoal(replay(state, path))` is the assertion, and it is made in node, in the browser
// and in tools/bake.mjs against the shipped data.
export function replay(state, path) {
  let cur = Uint8Array.from(state);
  for (const pos of path) cur = applySlide(cur, pos);
  return cur;
}
