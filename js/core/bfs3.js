// The truth table. On 3x3 the whole reachable graph fits in memory, so BFS from the goal
// gives the exact optimum for every one of the 181,440 solvable boards — and that is what
// lets this repo claim its IDA* numbers instead of asserting them: js/core/solve.js is
// checked board by board against a distance nobody computed the same way.
//
// Build-time and test-time only. Nothing in the shipped page imports this: the browser gets
// the par printed in js/data/lots.js, and a 3x3 table costs a couple of hundred milliseconds
// to lay down on every load. 4x4 is 16!/2 = 10^13 states, so there is no table and the
// bounded search in solve.js is the only instrument — which is exactly why it carries a
// budget it is allowed to admit losing.
//
// States are indexed by their Lehmer rank (a bijection from permutations to 0..N!-1), so the
// distances live in one Int16Array and there is no Map anywhere in the hot loop.

import { goalState, neighbours, widthOf, swap } from './puzzle.js';

const FACT = [1];
for (let i = 1; i <= 16; i++) FACT[i] = FACT[i - 1] * i;

// Side lengths whose full permutation space can be addressed: 9! = 362,880 ranks fits in a
// typed array, 16! does not fit in anything.
const MAX_SIDE = 3;

export function rank(perm) {
  const N = perm.length;
  let r = 0;
  for (let i = 0; i < N; i++) {
    let smaller = 0;
    for (let j = i + 1; j < N; j++) if (perm[j] < perm[i]) smaller++;
    r += smaller * FACT[N - 1 - i];
  }
  return r;
}

export function unrank(r, N) {
  const pool = [];
  for (let v = 0; v < N; v++) pool.push(v);
  const out = new Uint8Array(N);
  let rest = r;
  for (let i = 0; i < N; i++) {
    const f = FACT[N - 1 - i];
    const k = Math.floor(rest / f);
    rest -= k * f;
    out[i] = pool[k];
    pool.splice(k, 1);
  }
  return out;
}

let TABLE = null;

// table(n = 3) -> { n, size, dist, states, diameter, histogram }
//   `dist[rank(board)]` is the exact minimum number of slides, or -1 for a board the parity
//   theorem also calls unreachable.
export function table(n = 3) {
  if (TABLE && TABLE.n === n) return TABLE;
  if (n > MAX_SIDE) {
    throw new Error(`exhaustive BFS stops at ${MAX_SIDE}x${MAX_SIDE}: ${n * n}! states is ${(FACT[n * n]).toExponential(1)} boards`);
  }
  const N = n * n;
  const size = FACT[N];
  const dist = new Int16Array(size).fill(-1);
  const adj = neighbours(n);
  const goal = goalState(n);
  const board = new Uint8Array(N);
  // Boards travel through the queue packed in base N (one digit per cell): 9^9 < 2^31, so
  // an Int32Array holds the whole frontier and swapping two digits is arithmetic.
  const pow = new Int32Array(N);
  pow[0] = 1;
  for (let i = 1; i < N; i++) pow[i] = pow[i - 1] * N;
  const queue = new Int32Array(size);
  let code0 = 0;
  for (let i = 0; i < N; i++) code0 += goal[i] * pow[i];
  queue[0] = code0;
  dist[rank(goal)] = 0;

  const histogram = [1];
  let head = 0;
  let tail = 1;
  let depth = 0;
  let levelEnd = 1;
  while (head < tail) {
    if (head === levelEnd) { depth++; levelEnd = tail; }
    const code = queue[head++];
    let rest = code;
    let blank = -1;
    for (let i = 0; i < N; i++) {
      const v = rest % N;
      rest = (rest - v) / N;
      board[i] = v;
      if (v === 0) blank = i;
    }
    const near = adj[blank];
    for (let k = 0; k < near.length; k++) {
      const t = near[k];
      swap(board, blank, t);
      const r = rank(board);
      if (dist[r] === -1) {
        dist[r] = depth + 1;
        let c = 0;
        for (let i = 0; i < N; i++) c += board[i] * pow[i];
        queue[tail++] = c;
        histogram[depth + 1] = (histogram[depth + 1] || 0) + 1;
      }
      swap(board, blank, t);
    }
  }

  TABLE = { n, size, dist, states: tail, diameter: depth, histogram };
  return TABLE;
}

export function bfsDistance(state) {
  const n = widthOf(state);
  return table(n).dist[rank(state)];
}

export function reachableCount() {
  return table().states;
}

export function diameter() {
  return table().diameter;
}

export function distanceHistogram() {
  return table().histogram.slice();
}

// The boards exactly `depth` slides from the goal. A full pass over the rank space costs a
// few tens of milliseconds, which is why sampling goes through here rather than through a
// random walk that would land wherever it likes.
export function boardsAtDepth(depth, opts = {}) {
  const t = table(opts.n || 3);
  const stride = opts.stride || 1;
  const limit = opts.limit || Infinity;
  const out = [];
  let seen = 0;
  for (let r = 0; r < t.size; r++) {
    if (t.dist[r] !== depth) continue;
    if (seen++ % stride === 0) out.push(unrank(r, t.n * t.n));
    if (out.length >= limit) break;
  }
  return out;
}

// The two boards at the far end of the graph — the diameter is not "about 31", it is 31 and
// exactly these two arrangements reach it.
export function farthestBoards() {
  return boardsAtDepth(diameter());
}
