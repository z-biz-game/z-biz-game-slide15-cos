// The lower bound. Everything the solver claims about optimality is only as good as this
// function's promise that it never overstates what is left, so the promise is tested
// against the exhaustive table rather than argued about in a comment.

import { test, run, ok, eq, note } from '../tools/harness.mjs';
import { manhattan, linearConflict, heuristic } from '../js/core/heur.js';
import { goalState, formatState, swap, toArray } from '../js/core/puzzle.js';
import { table, boardsAtDepth, bfsDistance } from '../js/core/bfs3.js';

test('Manhattan distance, counted by hand', () => {
  eq(manhattan(goalState(3)), 0, 'every tile is home');
  eq(manhattan([1, 2, 3, 4, 5, 6, 0, 7, 8]), 2, '7 owes one step left, 8 owes one step left; the blank is free');
  eq(manhattan([1, 2, 3, 4, 5, 6, 7, 8, 0]), 0, 'the blank may sit in the goal corner without costing anything');
  eq(manhattan([2, 1, 4, 3, 5, 6, 7, 8, 0]), 8, '2 and 1 owe 1 each; 4 and 3 each owe a row and a column, so 3+3');
  eq(manhattan(Array.from(goalState(4))), 0, 'the 4x4 goal too');
});

test('linear conflict: crossing tiles in a goal line cost detours, not just steps', () => {
  eq(linearConflict([1, 2, 3, 4, 5, 6, 7, 8, 0]), 0, 'nobody crosses anybody');
  eq(linearConflict([2, 1, 3, 4, 5, 6, 7, 8, 0]), 2, 'one crossing pair in the top row: one of them has to leave and come back');
  eq(linearConflict([2, 1, 4, 3, 5, 6, 7, 8, 0]), 2, 'only the top pair crosses: 4 and 3 are not standing in their goal rows, so they are charged by Manhattan alone');
  eq(linearConflict([0, 1, 2, 3, 4, 5, 6, 7, 8]), 0, 'the whole row shifted one cell is ordered, so it is not a conflict');
});

test('three mutually crossing tiles pay for two detours, not for three pairs', () => {
  // Row 0 holds 3,2,1 — three crossing pairs, but only two tiles ever need to leave the row
  // (the third can stay put while the other two step around it). Charging a pair each time
  // would ask for 6 here and the bound would stop being admissible.
  const board = [3, 2, 1, 5, 4, 6, 7, 8, 0];
  eq(manhattan(board), 6, '3 and 1 each owe two cells, 5 and 4 one each');
  eq(linearConflict(board), 6, 'top row: 3 - 1 = two detours = 4; middle row: one detour = 2');
  eq(heuristic(board), 12);
});

test('the combined bound and its two parts agree on hand-picked boards', () => {
  eq(heuristic([2, 1, 3, 4, 5, 6, 8, 7, 0]), 8, 'two row crossings, four steps of Manhattan');
  eq(heuristic([0, 1, 2, 3, 4, 5, 6, 7, 8]), 12, 'every tile one cell out of place, no crossings');
  eq(heuristic(goalState(4)), 0);
  eq(heuristic([4, 1, 3, 2, 0, 6, 7, 5, 8]), 6, '1, 2, 4 wander; nothing crosses in a goal line');
});

test('the bound is zero only on the goal', () => {
  const g = toArray(goalState(3));
  eq(heuristic(g), 0);
  for (const board of [[1, 2, 3, 4, 5, 6, 7, 0, 8], [1, 2, 3, 4, 5, 6, 0, 8, 7], [2, 1, 3, 4, 5, 6, 7, 8, 0]]) {
    ok(heuristic(board) > 0, `${formatState(board)} is not the goal and must cost something`);
  }
});

test('admissible against the table on a stride sample across every depth', () => {
  let checked = 0;
  let worstSlack = Infinity;
  let worstBoard = null;
  let worstReal = 0;
  let worstBound = 0;
  for (let d = 0; d <= table().diameter; d++) {
    for (const board of boardsAtDepth(d, { stride: 37 })) {
      const h = heuristic(board);
      const real = bfsDistance(board);
      checked++;
      if (h > real) throw new Error(`${formatState(board)}: bound ${h} overstates the true ${real}`);
      if (real - h < worstSlack) {
        worstSlack = real - h;
        worstBoard = formatState(board);
        worstReal = real;
        worstBound = h;
      }
    }
  }
  note(`${checked} boards sampled; tightest was ${worstBoard} with a bound of ${worstBound} against a true ${worstReal}`);
  ok(checked > 3000, `sampled ${checked} boards`);
});

test('admissible on all 181,440 reachable boards at once', () => {
  const t = table(3);
  let reachable = 0;
  let over = 0;
  let minSlack = Infinity;
  for (let d = 0; d <= t.diameter; d++) {
    for (const board of boardsAtDepth(d)) {
      reachable++;
      const real = bfsDistance(board);
      const h = heuristic(board);
      if (h > real) over++;
      if (real - h < minSlack) minSlack = real - h;
    }
  }
  eq(reachable, 181440, 'the sweep really covered the whole component');
  eq(over, 0, 'not one board where the bound overshot');
  eq(minSlack, 0, 'and it is tight somewhere, which is what makes it useful');
});

test('the heuristic is a pure read of a board', () => {
  const before = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  const copy = before.slice();
  const a = heuristic(before);
  eq(before, copy, 'the array it was handed is unchanged');
  eq(a, heuristic(copy), 'and it answers the same twice over');
  const typed = goalState(4);
  const snapshot = formatState(typed);
  manhattan(typed);
  linearConflict(typed);
  heuristic(typed);
  eq(formatState(typed), snapshot, 'no scratch state leaked into the board');
});

run();
