// The search, checked against an instrument that was not used to produce it.
//
// This is the file the whole game's claim rests on. IDA* with an admissible bound returns an
// optimum by construction, but "by construction" is exactly the kind of argument that hides
// an off-by-one, so the bound's output is reconciled against the exhaustive 3x3 table for
// tens of thousands of boards: every one of the 26,931 boards within 18 slides of the goal,
// then a stride sample over the rest of the component up to the two diameter boards.
// If the search ever grades itself, this is where it gets caught.

import { test, run, ok, eq, note } from '../tools/harness.mjs';
import { solve, replay } from '../js/core/solve.js';
import { goalState, isGoal, canSlide, formatState, blankAt, toArray } from '../js/core/puzzle.js';
import { heuristic } from '../js/core/heur.js';
import { inversions } from '../js/core/parity.js';
import { table, boardsAtDepth, bfsDistance, farthestBoards } from '../js/core/bfs3.js';
import { walkScramble } from '../js/core/make.js';

// A route is only a solution if every step was legal where it was played.
function walkCheck(board, path) {
  let cur = Uint8Array.from(board);
  for (const pos of path) {
    if (!canSlide(cur, pos)) return `cell ${pos} was not beside the blank on ${formatState(cur)}`;
    cur = replay(cur, [pos]);
  }
  return isGoal(cur) ? null : 'the route does not end at the goal';
}

test('the anchor board [8,7,6,5,4,3,2,1,0] costs 30 slides', () => {
  const board = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  eq(inversions(board), 28, 'even, so reachable — the same 28 probe2 printed');
  const r = solve(board);
  eq(r.ok, true, 'and it is not a truncated answer');
  eq(r.truncated, false);
  eq(r.moves, 30, 'the published optimum, from the search');
  eq(bfsDistance(board), 30, 'the exhaustive table agrees, independently of how the search works');
  eq(r.path.length, 30);
  eq(walkCheck(board, r.path), null, 'every step legal, ending on the goal');
  ok(r.nodes > 1000, `the search really worked for it: ${r.nodes} nodes`);
});

test('the goal costs nothing and a board one slide away costs one', () => {
  const g = toArray(goalState(3));
  const zero = solve(g);
  eq([zero.ok, zero.moves, zero.path.length, zero.nodes], [true, 0, 0, 1], 'answered before the search starts');
  const one = [1, 2, 3, 4, 5, 6, 7, 0, 8];
  const r = solve(one);
  eq([r.ok, r.moves], [true, 1]);
  eq(r.path, [8], 'the one legal slide that lands a tile home is the tile in the goal corner');
  eq(bfsDistance(one), 1, 'and the table says one');
});

test('a hand-checked fixture: 4,1,3,2,_,6,7,5,8 is six slides', () => {
  const board = [4, 1, 3, 2, 0, 6, 7, 5, 8];
  eq(heuristic(board), 6, 'the bound is already tight here, which is why six is provably the answer');
  const r = solve(board);
  eq([r.ok, r.moves], [true, 6]);
  eq(bfsDistance(board), 6, 'the table, not the bound, is the second opinion');
  eq(r.threshold, 6, 'IDA* stopped at the first threshold that admitted a solution');
});

test('an unsolvable board is refused without spending a search', () => {
  const dead = [1, 2, 3, 4, 5, 6, 8, 7, 0];
  eq(inversions(dead), 1, 'odd on an odd width: one inversion too many');
  const r = solve(dead);
  eq([r.ok, r.moves, r.truncated, r.reason], [false, -1, false, 'unsolvable'], 'a no, said plainly and cheaply');
  eq(r.nodes, 0, 'no node was expanded to find out');
  eq(bfsDistance(dead), -1, 'the exhaustive table has the same answer');
});

test('a search that runs out of budget admits it instead of printing an estimate', () => {
  const board = farthestBoards()[0]; // one of the two 31-slide boards
  eq(bfsDistance(board), 31);
  ok(heuristic(board) > 0, 'the bound is non-trivial, so "returns the bound" would look plausible');
  const tight = solve(board, { nodeLimit: 40 });
  eq([tight.ok, tight.truncated, tight.reason], [false, true, 'nodes'], 'it stopped because it was told to');
  eq(tight.moves, -1, 'no number, and specifically not the heuristic value');
  eq(tight.path, []);
  ok(tight.nodes >= 40, `it did the work it was paid for: ${tight.nodes} nodes`);
  const generous = solve(board);
  eq([generous.ok, generous.moves], [true, 31], 'the same board is answerable once it has room');
});

test('a 4x4 that cannot be finished in time is dropped, not estimated', () => {
  const board = walkScramble('siege-4x4', 4, 120);
  const r = solve(board, { nodeLimit: 400000, timeLimitMs: 1 });
  eq(r.ok, false, 'a one-millisecond budget on a deep 4x4 is expected to lose');
  eq(r.truncated, true);
  ok(['timeout', 'nodes'].includes(r.reason), `reason was ${r.reason}`);
  eq(r.moves, -1, 'and nothing numeric about difficulty came back');
  const full = solve(board, { nodeLimit: 400000, timeLimitMs: 2000 });
  if (full.ok) {
    eq(walkCheck(board, full.path), null, 'when it does finish, the route is legal and lands on the goal');
    ok(full.moves >= heuristic(board), 'never below the admissible bound');
  } else {
    eq(full.moves, -1, 'still honest at the full budget');
  }
});

test('IDA* vs BFS: every board within 18 slides of the goal', () => {
  const t0 = Date.now();
  let checked = 0;
  let bad = 0;
  let maxNodes = 0;
  for (let d = 0; d <= 18; d++) {
    for (const board of boardsAtDepth(d)) {
      const r = solve(board);
      checked++;
      if (!r.ok || r.moves !== d) {
        bad++;
        if (bad < 4) note(`MISMATCH ${formatState(board)} table=${d} search=${r.moves}`);
      }
      if (r.nodes > maxNodes) maxNodes = r.nodes;
    }
  }
  note(`${checked} boards reconciled in ${((Date.now() - t0) / 1000).toFixed(2)}s, deepest search ${maxNodes} nodes`);
  eq(checked, 26931, 'the published counts for depths 0..18, summed');
  eq(bad, 0, 'not one board where the search and the table disagree');
});

test('IDA* vs BFS: a stride sample up to the two diameter boards', () => {
  const t0 = Date.now();
  let checked = 0;
  let bad = 0;
  for (let d = 19; d <= table().diameter; d++) {
    for (const board of boardsAtDepth(d, { stride: 41 })) {
      const r = solve(board, { nodeLimit: 200000, timeLimitMs: 1000 });
      checked++;
      if (!r.ok) { bad++; note(`truncated at depth ${d}: ${formatState(board)}`); continue; }
      if (r.moves !== d) { bad++; note(`MISMATCH ${formatState(board)} table=${d} search=${r.moves}`); }
    }
  }
  for (const board of farthestBoards()) {
    const r = solve(board, { nodeLimit: 200000, timeLimitMs: 1000 });
    checked++;
    if (!r.ok || r.moves !== 31) bad++;
  }
  note(`${checked} deep boards reconciled in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  eq(bad, 0, 'including both boards at the far end of the graph');
  ok(checked > 1500, `sampled ${checked}`);
});

test('the solver does not touch the board it was given', () => {
  const board = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  const copy = board.slice();
  const r = solve(board);
  eq(board, copy, 'the array is byte-for-byte what it was');
  const typed = goalState(3);
  const snapshot = formatState(typed);
  solve(toArray(typed));
  solve(typed);
  eq(formatState(typed), snapshot, 'a Uint8Array survives as well as a plain one');
  const blank = blankAt(typed);
  eq(blank, 8, 'and the blank never wandered');
  eq(solve(board).moves, r.moves, 'same board, same answer, twice over');
  eq(solve(board).nodes, r.nodes, 'down to the number of nodes it spent');
});

test('replay is strict about the routes it accepts', () => {
  const board = [1, 2, 3, 4, 5, 6, 7, 8, 0];
  const good = solve(board).path;
  eq(isGoal(replay(board, good)), true);
  let threw = 0;
  try { replay(board, [0]); } catch { threw++; }
  eq(threw, 1, 'cell 0 is nowhere near the blank, so a "route" through it is rejected');
  eq(walkCheck([1, 2, 3, 0, 4, 5, 6, 7, 8], solve([1, 2, 3, 0, 4, 5, 6, 7, 8]).path), null);
});

test('a random walk from the goal is solvable at both widths and the answer is a real route', () => {
  // The budget is deliberately lifted past any shipped band budget here: this row wants a
  // *finished* route so it can check every step of it, and tools/bake.mjs is the one that
  // decides what a band may spend (it drops what will not fit, and says so). The drop
  // behaviour itself has its own row above; the last assertion below proves this lift was
  // needed rather than cosmetic.
  for (const n of [3, 4]) {
    let anyDropped = false;
    for (let i = 0; i < 8; i++) {
      const board = walkScramble(`route-${n}-${i}`, n, 12 + i * 5);
      const r = solve(board, { nodeLimit: 5000000, timeLimitMs: 60000 });
      ok(r.ok, `${n}x${n} seed ${i} finished once the budget is lifted`);
      eq(walkCheck(board, r.path), null, 'legal steps, ending home');
      ok(r.moves >= heuristic(board), `never below the bound: ${r.moves} vs ${heuristic(board)}`);
      eq(blankAt(replay(board, r.path)), n * n - 1, 'the blank ends in the goal corner');
      const strict = solve(board, { nodeLimit: 400000, timeLimitMs: 2000 });
      if (!strict.ok) {
        anyDropped = true;
        eq([strict.moves, strict.truncated, strict.ok], [-1, true, false], 'a board dropped by the budget leaves no number behind');
      }
    }
    if (n === 4) ok(anyDropped, 'at least one of the eight 4x4 walks needs more than the default 400k nodes, so the lift above is doing real work');
  }
});

run();
