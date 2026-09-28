// The board model. Everything downstream — parity, the heuristic, the search, the canvas —
// reads positions through these functions, so "a slide is a swap of the blank with one of
// its orthogonal neighbours" is nailed down here first.

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  widthOf, goalState, isGoal, blankAt, neighbours, slidePositions, canSlide, swap,
  applySlide, toArray, sameState, formatState,
} from '../js/core/puzzle.js';

const G8 = [1, 2, 3, 4, 5, 6, 7, 8, 0];

test('a board is an n by n permutation and anything else is refused', () => {
  eq(widthOf(G8), 3, '3x3 is 9 cells');
  eq(widthOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0]), 4, '4x4 is 16 cells');
  eq(widthOf([1, 2, 3, 0]), 2, '2x2 counts too');
  let threw = 0;
  for (const bad of [[1, 2, 3], [1, 2, 3, 4, 5, 6, 7]]) {
    try { widthOf(bad); } catch { threw++; }
  }
  eq(threw, 2, 'a non-square board is a programming error, not a game state');
});

test('the goal is 1..n*n-1 with the blank in the bottom-right corner', () => {
  eq(formatState(goalState(3)), '1,2,3,4,5,6,7,8,0', 'hand-typed target arrangement');
  eq(formatState(goalState(4)), '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0');
  eq(isGoal(G8), true);
  eq(isGoal([1, 2, 3, 4, 5, 6, 8, 7, 0]), false, 'two tiles transposed is not the goal');
});

test('goalState hands out a copy, so no caller can dent the reference board', () => {
  const a = goalState(3);
  swap(a, 0, 8);
  eq(formatState(goalState(3)), '1,2,3,4,5,6,7,8,0', 'the second call is still the goal');
});

test('the blank is found, and neighbours are the orthogonal ones', () => {
  eq(blankAt(G8), 8);
  eq(blankAt([0, 1, 2, 3, 4, 5, 6, 7, 8]), 0);
  eq(Array.from(neighbours(3)[4]), [1, 7, 3, 5], 'the centre touches up, down, left, right');
  eq(Array.from(neighbours(3)[0]), [3, 1], 'a corner has two');
  eq(Array.from(neighbours(3)[8]), [5, 7], 'the bottom-right has two');
  eq(neighbours(3).length, 9);
  eq(Array.from(neighbours(4)[0]), [4, 1], 'no wrapping across a row edge');
});

test('slidePositions names exactly the cells a finger may press', () => {
  eq(Array.from(slidePositions(G8)), [5, 7], 'with the blank home, only 6 and 8 can slide');
  eq(Array.from(slidePositions([1, 2, 3, 0, 5, 6, 7, 8, 4])), [0, 6, 4], 'blank mid-left: up, down, right');
  eq(slidePositions(goalState(4)).length, 2, 'a 4x4 corner blank has two neighbours too');
});

test('canSlide is the legality gate the view leans on', () => {
  eq(canSlide(G8, 5), true);
  eq(canSlide(G8, 0), false, 'the far corner is not next to the blank');
  eq(canSlide(G8, 8), false, 'pressing the blank itself is not a slide');
});

test('applySlide moves one tile and leaves the board a permutation', () => {
  const after = applySlide(G8, 7);
  eq(formatState(after), '1,2,3,4,5,6,7,0,8', 'tile 8 drops into the blank and the blank takes its cell');
  eq(after.slice().sort((a, b) => a - b).join(','), '0,1,2,3,4,5,6,7,8', 'still every tile exactly once');
  eq(formatState(G8), '1,2,3,4,5,6,7,8,0', 'the input board was not touched');
});

test('an illegal applySlide throws instead of quietly returning a board', () => {
  let msg = '';
  try { applySlide(G8, 0); } catch (err) { msg = String(err.message); }
  ok(/not next to the blank/.test(msg), `expected a legibility error, got "${msg}"`);
});

test('a slide is its own inverse, which is what makes undo free', () => {
  const start = [1, 2, 3, 4, 5, 0, 7, 8, 6];
  const once = applySlide(start, 2);
  eq(formatState(once), '1,2,0,4,5,3,7,8,6');
  const twice = applySlide(once, 5);
  eq(formatState(twice), formatState(start), 'slide the same tile back and the board is where it was');
});

test('array helpers round-trip a board through plain JSON numbers', () => {
  const typed = toArray(goalState(3));
  eq(Array.isArray(typed), true, 'a Uint8Array is not what belongs in a data file');
  eq(sameState(typed, G8), true);
  eq(sameState(typed, [1, 2, 3, 4, 5, 6, 7, 0, 8]), false);
  eq(sameState(typed, toArray(goalState(4))), false, 'different sizes are different boards');
});

run();
