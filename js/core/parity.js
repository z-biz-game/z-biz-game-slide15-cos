// Which boards can be solved at all — decided without searching anything.
//
// Story 14 (and the 15-puzzle after it): sliding a tile past the blank never changes the
// parity of the permutation, so half of all arrangements are unreachable from the goal and
// no amount of search will ever find a route. The rule below is the cheap decision; the
// 3x3 exhaustive table in js/core/bfs3.js is the evidence that the rule is right, and
// test/parity.test.mjs compares the two over the whole 9! state space.

import { widthOf, blankAt } from './puzzle.js';

// Inversions among the numbered tiles, reading the board row by row and ignoring the blank.
export function inversions(state) {
  const tiles = [];
  for (let i = 0; i < state.length; i++) if (state[i] !== 0) tiles.push(state[i]);
  let n = 0;
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) if (tiles[i] > tiles[j]) n++;
  }
  return n;
}

// Row the blank sits in, counted from the bottom and 1-based, which is how the even-width
// half of the theorem is stated. The goal has the blank in the bottom-right corner, i.e.
// row 1 — odd — with 0 inversions, and that is the reference the rule is calibrated on.
export function blankRowFromBottom(state) {
  const n = widthOf(state);
  return n - Math.floor(blankAt(state) / n);
}

// Odd width: solvable iff the inversion count is even.
// Even width: solvable iff the blank's row-from-bottom and the inversion count have
// opposite parity — an odd row from the bottom wants an even inversion count.
export function solvable(state) {
  const inv = inversions(state);
  if (widthOf(state) % 2 === 1) return inv % 2 === 0;
  return (blankRowFromBottom(state) % 2 === 1) === (inv % 2 === 0);
}

// The two halves of the theorem, printed by tools/bake.mjs so a reader can see which rule
// decided a given board instead of taking the boolean on faith.
export function parityLine(state) {
  const n = widthOf(state);
  const inv = inversions(state);
  const row = blankRowFromBottom(state);
  return n % 2 === 1
    ? `${n}x${n}: inv=${inv} (${inv % 2 === 0 ? 'even' : 'odd'}) -> ${solvable(state) ? 'solvable' : 'dead'}`
    : `${n}x${n}: inv=${inv} blankRowFromBottom=${row} -> ${solvable(state) ? 'solvable' : 'dead'}`;
}
