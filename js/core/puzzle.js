// The board model: one row-major permutation of 0..n*n-1 where the value 0 is the blank,
// plus the definition of the only action the game has — slide a tile that is orthogonally
// adjacent to the blank into the blank's cell.
//
// Everything else in js/core is written against these primitives, and nothing in here
// touches a DOM or a clock: the same array means the same board in node, in the browser
// and in the baked data file.

const ADJ = new Map(); // n -> array of neighbour lists, cached because search calls it millions of times
const GOAL = new Map(); // n -> goal board

// How wide the board is. Board length must be a perfect square of a side >= 2, which is
// checked here once rather than in every caller.
export function widthOf(state) {
  const n = Math.round(Math.sqrt(state.length));
  if (n * n !== state.length || n < 2) {
    throw new Error(`a slide board is n x n with n >= 2, got ${state.length} cells`);
  }
  return n;
}

// 1 2 3 / 4 5 6 / 7 8 _ — the solved board of one side length, blank last.
export function goalState(n) {
  let g = GOAL.get(n);
  if (!g) {
    g = new Uint8Array(n * n);
    for (let i = 0; i < n * n - 1; i++) g[i] = i + 1;
    GOAL.set(n, g);
  }
  return Uint8Array.from(g);
}

export function isGoal(state) {
  const g = GOAL.get(widthOf(state)) || goalState(widthOf(state));
  for (let i = 0; i < state.length; i++) if (state[i] !== g[i]) return false;
  return true;
}

export function blankAt(state) {
  for (let i = 0; i < state.length; i++) if (state[i] === 0) return i;
  return -1;
}

// Cells orthogonally adjacent to each cell, in a fixed order (up, down, left, right minus
// the off-board ones). A board never changes size, so this is built once per side length.
export function neighbours(n) {
  let list = ADJ.get(n);
  if (list) return list;
  list = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n);
    const c = i % n;
    const near = [];
    if (r > 0) near.push(i - n);
    if (r < n - 1) near.push(i + n);
    if (c > 0) near.push(i - 1);
    if (c < n - 1) near.push(i + 1);
    list.push(Uint8Array.from(near));
  }
  ADJ.set(n, list);
  return list;
}

// Which cell a pointer may press right now: every tile that can slide, named by the cell
// it currently occupies. The blank's own cell is never in the list, so "press the hole"
// and "press a tile three cells away" are the same thing to this function — nothing.
export function slidePositions(state) {
  return neighbours(widthOf(state))[blankAt(state)];
}

export function canSlide(state, pos) {
  const blank = blankAt(state);
  const near = neighbours(widthOf(state))[blank];
  for (let i = 0; i < near.length; i++) if (near[i] === pos) return true;
  return false;
}

// In-place exchange of two cells. The move is its own inverse, which is why undo is a
// swap and why a search can step forward and back without copying a board.
export function swap(state, a, b) {
  const t = state[a];
  state[a] = state[b];
  state[b] = t;
  return state;
}

// The move as the player makes it: a new board with the tile at `pos` in the blank.
// Illegal presses throw rather than returning the board unchanged, because a caller that
// slips one through would otherwise print a board that never existed.
export function applySlide(state, pos) {
  const next = Uint8Array.from(state);
  if (!canSlide(next, pos)) throw new Error(`cell ${pos} is not next to the blank`);
  return swap(next, blankAt(next), pos);
}

export function toArray(state) {
  return Array.from(state, (v) => Number(v));
}

export function sameState(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// A compact, hand-comparable identity for a board: "1,2,3,4,5,6,7,8,0".
export function formatState(state) {
  return toArray(state).join(',');
}
