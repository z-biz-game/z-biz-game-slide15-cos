// The exhaustive 3x3 table: the second instrument, and the reason the phrase "the search
// graded itself" cannot be aimed at this repo. Its own numbers are published ones — the
// reachable count is 9!/2, the diameter is 31 slides, and the distance distribution below
// is the table that appears in the sliding-puzzle literature. All typed in by hand here.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { table, rank, unrank, bfsDistance, reachableCount, diameter, distanceHistogram, boardsAtDepth, farthestBoards } from '../js/core/bfs3.js';
import { goalState, formatState, toArray } from '../js/core/puzzle.js';

// The published count of 8-puzzle positions at each optimal distance, depth 0..31.
const PUBLISHED = [
  1, 2, 4, 8, 16, 20, 39, 62, 116, 152, 286, 396, 748, 1024, 1893,
  2512, 4485, 5638, 9529, 10878, 16993, 17110, 23952, 20224, 24047,
  15578, 14560, 6274, 3910, 760, 221, 2,
];

test('the table is built once and reports its shape', () => {
  const t = table(3);
  eq(table(3) === t, true, 'memoised: a second call is the same object, not a second sweep');
  eq(t.n, 3);
  eq(t.size, 362880, '9! ranks addressed, of which half are reachable');
  eq(typeof t.dist[0], 'number');
});

test('reachable states = 181,440 = 9!/2', () => {
  let fact = 1;
  for (let i = 2; i <= 9; i++) fact *= i;
  eq([fact / 2, reachableCount()], [181440, 181440], 'the anchor, and the arithmetic behind it');
  eq(distanceHistogram().reduce((a, c) => a + c, 0), 181440, 'the distribution sums to the same count');
});

test('the diameter is 31 and exactly two boards sit on it', () => {
  const hist = distanceHistogram();
  eq(diameter(), 31, 'the anchor');
  eq(hist.length, 32, 'depths 0..31 and nothing beyond');
  eq(hist[31], 2, 'the anchor: |{d = 31}| = 2');
  eq(hist[30], 221);
});

test('the whole distance distribution matches the published one', () => {
  eq(distanceHistogram(), PUBLISHED, 'depth by depth, 32 numbers nobody derived from this code');
});

test('rank and unrank are inverses over the whole space', () => {
  const t = table(3);
  const sample = [];
  for (let r = 0; r < t.size; r += 7507) sample.push(r);
  for (const r of sample) {
    const p = unrank(r, 9);
    ok(rank(p) === r, `rank(unrank(${r})) came back different`);
  }
  eq(rank(toArray(goalState(3))), rank(unrank(rank(toArray(goalState(3))), 9)));
  eq(rank(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8])), 0, 'the lowest rank is the ascending permutation');
  eq(rank(new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1, 0])), t.size - 1, 'the highest is the descending one');
});

test('bfsDistance answers hand-checked boards', () => {
  eq(bfsDistance(toArray(goalState(3))), 0);
  eq(bfsDistance([1, 2, 3, 4, 5, 6, 7, 0, 8]), 1);
  eq(bfsDistance([1, 2, 3, 4, 5, 6, 0, 7, 8]), 2, 'every tile is already home, so the distance is how far the blank has to walk back: two slides');
  eq(bfsDistance([8, 7, 6, 5, 4, 3, 2, 1, 0]), 30, 'the anchor board');
  eq(bfsDistance([1, 2, 3, 4, 5, 6, 8, 7, 0]), -1, 'the 14-15 trick is not in the table at all');
});

test('4x4 is refused rather than attempted', () => {
  let msg = '';
  try { table(4); } catch (err) { msg = String(err.message); }
  ok(/exhaustive BFS stops at 3x3/.test(msg), `expected the refusal, got "${msg}"`);
  ok(/!/.test(msg), 'and it says how many states that would be');
});

test('boardsAtDepth enumerates what the histogram claims', () => {
  const five = boardsAtDepth(5);
  eq(five.length, 20, 'the published count for depth 5');
  eq(new Set(five.map(formatState)).size, 20, 'all distinct');
  for (const b of five) eq(bfsDistance(b), 5, `${formatState(b)} claims depth 5`);
  const sampled = boardsAtDepth(20, { stride: 100 });
  eq(sampled.length, Math.ceil(16993 / 100), 'a stride really thins the level');
  eq(boardsAtDepth(31, { limit: 1 }).length, 1, 'and a limit really stops it');
});

test('the two farthest boards are pinned', () => {
  const far = farthestBoards();
  eq(far.length, 2);
  for (const b of far) eq(bfsDistance(b), 31);
  // A regression pin rather than an external anchor: if the table build ever changes order
  // or neighbourhood, these two boards are where it shows first.
  eq(far.map(formatState).sort(), ['6,4,7,8,5,0,3,2,1', '8,6,7,2,5,4,3,0,1']);
});

run();
