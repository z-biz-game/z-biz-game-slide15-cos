// Which boards can be solved, decided without searching.
//
// Two independent instruments meet in this file. The parity theorem is the cheap rule in
// js/core/parity.js; the exhaustive 3x3 table in js/core/bfs3.js is the truth about
// reachability that nobody derived from the rule. The last test walks all 9! = 362,880
// arrangements and demands the two agree on every one — that is 181,440 solvable boards and
// not one more, which is the 9!/2 the literature reports.

import { test, run, ok, eq, note } from '../tools/harness.mjs';
import { inversions, blankRowFromBottom, solvable, parityLine } from '../js/core/parity.js';
import { goalState, widthOf, swap, formatState } from '../js/core/puzzle.js';
import { table, unrank, bfsDistance } from '../js/core/bfs3.js';
import { walkScramble } from '../js/core/make.js';

const G8 = [1, 2, 3, 4, 5, 6, 7, 8, 0];

test('inversion count: hand-typed fixtures', () => {
  eq(inversions(G8), 0, 'the goal has nothing out of order');
  eq(inversions([8, 7, 6, 5, 4, 3, 2, 1, 0]), 28, 'C(8,2) = 28 for a fully reversed row of tiles');
  eq(inversions([2, 1, 3, 4, 5, 6, 7, 8, 0]), 1, 'one adjacent pair swapped');
  eq(inversions([1, 2, 3, 4, 5, 6, 8, 7, 0]), 1, 'the same, further down the board');
  eq(inversions([0, 2, 1, 4, 3, 6, 5, 8, 7]), 4, 'the blank is skipped, wherever it sits');
});

test('odd width: even inversion count is solvable, odd is dead', () => {
  eq(solvable(G8), true);
  eq(solvable([8, 7, 6, 5, 4, 3, 2, 1, 0]), true, '28 is even — the anchor board, which is genuinely hard but not impossible');
  eq(solvable([1, 2, 3, 4, 5, 6, 8, 7, 0]), false, 'the 14-15 trick: one inversion on a 3x3 is unreachable');
  eq(solvable([2, 1, 3, 4, 5, 6, 7, 8, 0]), false, 'one inversion anywhere on odd width is still one inversion');
  eq(solvable([4, 1, 3, 2, 0, 6, 7, 5, 8]), true, 'six inversions, even');
});

test('where the blank sits is measured from the bottom and is 1-based', () => {
  eq(blankRowFromBottom(G8), 1, 'the goal keeps the blank in the bottom row');
  eq(blankRowFromBottom([0, 1, 2, 3, 4, 5, 6, 7, 8]), 3, 'top-left on a 3x3 is the third row up');
  eq(blankRowFromBottom([1, 2, 3, 4, 5, 6, 7, 8, 0]), 1);
  const b = Array.from(goalState(4));
  eq(blankRowFromBottom(b), 1, '4x4 goal too');
});

test('even width: the blank row enters the rule, and the 14-15 board is still dead', () => {
  const g = Array.from(goalState(4));
  eq(inversions(g), 0);
  eq(solvable(g), true, 'goal: even inversions, blank on row 1 from the bottom (odd)');
  const transposed = Array.from(goalState(4));
  swap(transposed, 13, 14);
  eq(inversions(transposed), 1, 'the classic 14/15 swap');
  eq(blankRowFromBottom(transposed), 1);
  eq(solvable(transposed), false, 'one inversion with the blank on an odd row from the bottom is unreachable');
});

test('even width: two rows up flips what the same inversion count means', () => {
  // Take the dead 14/15 board and lift the blank one row without moving any numbered tile
  // past another: that changes the blank row parity and therefore the verdict.
  const dead = Array.from(goalState(4));
  swap(dead, 13, 14);
  eq([blankRowFromBottom(dead), inversions(dead), solvable(dead)], [1, 1, false], 'baseline');
  const moved = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 13, 15, 14, 12];
  eq([widthOf(moved), blankRowFromBottom(moved), inversions(moved), solvable(moved)], [4, 2, 4, false],
    'even inversions with the blank on an even row from the bottom is the other half of the rule');
  const live = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 13, 14, 15, 12];
  eq([blankRowFromBottom(live), inversions(live), solvable(live)], [2, 3, true],
    'odd inversions with the blank two rows up is solvable — the pairing the theorem states');
});

test('every board produced by walking away from the goal is judged solvable, at both widths', () => {
  for (const n of [3, 4]) {
    let dead = 0;
    for (let i = 0; i < 60; i++) if (!solvable(walkScramble(`par-${n}-${i}`, n, 10 + i * 3))) dead++;
    eq(dead, 0, `${n}x${n}: a walk cannot leave the reachable component, so the rule must agree on all 60`);
  }
});

test('transposing two numbered tiles flips the verdict at both widths', () => {
  // Not a guess: a slide is an even permutation of the tiles, so one transposition must
  // change reachability. This is the negative test — a rule that only ever said "solvable"
  // would pass the previous test and fail this one.
  for (const n of [3, 4]) {
    let wrong = 0;
    for (let i = 0; i < 60; i++) {
      const a = Array.from(walkScramble(`flip-${n}-${i}`, n, 8 + i));
      const b = a.slice();
      // Transpose two numbered tiles (values 1 and 2) wherever they happen to sit. Swapping
      // a tile with the blank would change nothing about reachability, so the test would be
      // measuring the wrong thing.
      const at1 = b.indexOf(1);
      const at2 = b.indexOf(2);
      swap(b, at1, at2);
      ok(solvable(a), `the walk itself is solvable (${n}x${n} seed ${i})`);
      if (solvable(a) === solvable(b)) wrong++;
    }
    eq(wrong, 0, `${n}x${n}`);
  }
});

// probe2.mjs (2026-09-27) ran exactly this loop with exactly this linear congruential
// generator and reported `agree 40/40 mism 0`. Reproduced here with the probe's own
// independent implementations of inversion counting and BFS — nothing from js/core — so the
// anchor is checked rather than quoted.
test('the probe2 cross-check: 40 walk-scrambled boards, parity vs its own BFS, 0 disagreements', () => {
  const inv = (a) => {
    const f = a.filter((x) => x);
    let n = 0;
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (f[i] > f[j]) n++;
    return n;
  };
  const goal8 = [1, 2, 3, 4, 5, 6, 7, 8, 0];
  const NB = [[1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7], [2, 4, 8], [3, 7], [4, 6, 8], [5, 7]];
  const code = (a) => a.reduce((s, v) => s * 9 + v, 0);
  const bfsDist = (start, cap = 400000) => {
    const dist = new Map([[code(start), 0]]);
    const q = [start];
    let head = 0;
    let steps = 0;
    while (head < q.length) {
      if (++steps > cap) throw new Error('BFS cap');
      const cur = q[head++];
      const z = cur.indexOf(0);
      const d = dist.get(code(cur));
      if (code(cur) === code(goal8)) return d;
      for (const t of NB[z]) {
        const nx = cur.slice();
        [nx[z], nx[t]] = [nx[t], nx[z]];
        const k = code(nx);
        if (dist.has(k)) continue;
        dist.set(k, d + 1);
        q.push(nx);
      }
    }
    return null;
  };
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  let agree = 0;
  let mism = 0;
  for (let t = 0; t < 40; t++) {
    const a = goal8.slice();
    for (let k = 0; k < 30 + t * 7; k++) {
      const i = a.indexOf(0);
      const cand = NB[i];
      const j = cand[Math.floor(rnd() * cand.length)];
      [a[i], a[j]] = [a[j], a[i]];
    }
    const pred = inv(a) % 2 === 0;
    const got = bfsDist(a) !== null;
    if (got === pred) agree++;
    else mism++;
    if (solvable(a) !== pred) throw new Error(`js/core disagrees with the probe's own rule on ${a.join(',')}`);
  }
  eq([agree, mism], [40, 0], 'the anchor line from probe2');
});

test('the anchor board [8,7,6,5,4,3,2,1,0] is even-inversion and reachable', () => {
  const b = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  eq(inversions(b), 28);
  eq(solvable(b), true);
  eq(bfsDistance(b), 30, 'and the exhaustive table gives it 30 slides, which test/solve.test.mjs re-derives by search');
});

test('parityLine says which half of the theorem answered', () => {
  eq(parityLine([8, 7, 6, 5, 4, 3, 2, 1, 0]), '3x3: inv=28 (even) -> solvable');
  const dead = Array.from(goalState(4));
  swap(dead, 13, 14);
  eq(parityLine(dead), '4x4: inv=1 blankRowFromBottom=1 -> dead');
});

test('over all 362,880 arrangements the rule and the exhaustive table never disagree', () => {
  const t = table(3);
  const N = 9;
  const perm = new Uint8Array(N);
  let predicted = 0;
  let actually = 0;
  let wrong = 0;
  let firstWrong = null;
  for (let r = 0; r < t.size; r++) {
    const p = unrank(r, N);
    for (let i = 0; i < N; i++) perm[i] = p[i];
    const pred = solvable(perm);
    const truth = t.dist[r] >= 0;
    if (pred) predicted++;
    if (truth) actually++;
    if (pred !== truth) {
      wrong++;
      if (!firstWrong) firstWrong = `${formatState(perm)} rule=${pred} bfs=${truth}`;
    }
  }
  note(`9! = ${t.size} arrangements scanned, ${predicted} judged solvable, ${actually} reachable in the table`);
  eq([predicted, actually], [181440, 181440], '9!/2 on both sides');
  eq([wrong, firstWrong], [0, null], 'the theorem is not an approximation of the table, it is the table');
});

run();
