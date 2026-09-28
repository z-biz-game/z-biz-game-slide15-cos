// The generator. What it has to prove is that a band means something: boards are accepted
// or thrown away for measured reasons, every rejection kind is countable, and the same seed
// grows the same board forever (otherwise a shared link is a lie).

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  walkScramble, permScramble, makeAttempt, makePuzzle, BANDS, bandByKey, bandsFor,
} from '../js/core/make.js';
import { solvable, inversions } from '../js/core/parity.js';
import { solve } from '../js/core/solve.js';
import { goalState, formatState, isGoal, toArray } from '../js/core/puzzle.js';
import { replay } from '../js/core/solve.js';

const face = (lot) => JSON.stringify({ state: lot.state, par: lot.par, path: lot.path });

test('a walk from the goal is deterministic, reachable and really a walk', () => {
  const a = walkScramble('w1', 3, 20);
  const b = walkScramble('w1', 3, 20);
  eq(formatState(a), formatState(b), 'same seed, same board');
  ok(a instanceof Uint8Array, 'a typed board, ready for the search');
  eq(isGoal(walkScramble('w1', 3, 0)), true, 'zero steps is the goal itself');
  eq(formatState(walkScramble('w2', 3, 0)), '1,2,3,4,5,6,7,8,0');
  ok(formatState(a) !== '1,2,3,4,5,6,7,8,0', '20 steps does move tiles around');
  for (let i = 0; i < 40; i++) ok(solvable(walkScramble(`ws-${i}`, 4, 30)), `seed ${i} stayed in the reachable component`);
});

test('a uniform shuffle is a permutation, and about half of it is dead', () => {
  const boards = [];
  for (let i = 0; i < 200; i++) boards.push(permScramble(`p-${i}`, 3));
  for (const b of boards) eq(b.slice().sort((x, y) => x - y).join(','), '0,1,2,3,4,5,6,7,8', 'every tile exactly once');
  const dead = boards.filter((b) => !solvable(b)).length;
  ok(dead > 80 && dead < 120, `expected roughly half of 200 shuffles to be unreachable, got ${dead}`);
  eq(formatState(permScramble('same', 3)), formatState(permScramble('same', 3)), 'and it is still a function of its seed');
});

test('every band on the ladder is well formed', () => {
  eq(BANDS.length, 7, 'four 3x3 bands and three 4x4 bands');
  for (const b of BANDS) {
    ok(b.min <= b.max, `${b.key} has an inverted range`);
    ok(b.walk[0] <= b.walk[1], `${b.key} cannot walk a negative number of steps`);
    ok(b.nodeLimit > 0 && b.timeLimitMs > 0, `${b.key} needs a real budget`);
  }
  // The spec's 3x3 bands, typed by hand: 2-8 / 9-16 / 17-24 / 25-31.
  eq(bandsFor(3).map((b) => `${b.min}-${b.max}`), ['2-8', '9-16', '17-24', '25-31']);
  eq(bandsFor(3)[3].max, 31, 'the top band ends at the diameter of the exhaustive table');
  for (const b of bandsFor(4)) ok(b.min >= 12 && b.max <= 50, `4x4 band ${b.key} has to stay inside what a bounded search can certify`);
  eq(bandByKey('nope').key, 'kerb', 'an unknown band falls back instead of generating nonsense');
});

test('a grown board is in its band, solvable, and re-solves to the number it claims', () => {
  for (const band of BANDS) {
    const stats = {};
    const lot = makePuzzle(`grown-${band.key}`, band, stats);
    ok(lot, `${band.key} should land within 40 tries`);
    eq(lot.band, band.key);
    eq(lot.n, band.n, 'the band decides the board size');
    ok(lot.par >= band.min && lot.par <= band.max, `${band.key} measured ${lot.par}, outside ${band.min}-${band.max}`);
    eq(solvable(Uint8Array.from(lot.state)), true);
    const again = solve(lot.state, { nodeLimit: band.nodeLimit, timeLimitMs: band.timeLimitMs });
    eq(again.ok, true);
    eq(again.moves, lot.par, 'the printed optimum is reproducible from the shipped array');
    eq(isGoal(replay(lot.state, lot.path)), true, 'and the stored route actually finishes the board');
    eq(lot.path.length, lot.par, 'one entry per slide');
    ok(stats.keep >= 1 && stats.attempt >= stats.keep, `rejections were counted: ${JSON.stringify(stats)}`);
  }
});

test('the same seed grows the same board, and different seeds grow different boards', () => {
  const band = bandByKey('deep');
  eq(face(makePuzzle('s9', band)), face(makePuzzle('s9', band)), 'deterministic to the route');
  const faces = new Set();
  for (let i = 0; i < 12; i++) faces.add(face(makePuzzle(`spread-${i}`, band)));
  ok(faces.size >= 10, `12 seeds produced ${faces.size} distinct boards — the generator would be a copy machine`);
});

test('rejection reasons are counted, not swallowed', () => {
  const stats = {};
  const band = bandByKey('abyss'); // 25-31 on a 3x3: most short walks are too easy for it
  makeAttempt('reject-1', { ...band, walk: [2, 4] }, stats);
  ok((stats.tooEasy || 0) >= 1, `expected a tooEasy rejection, got ${JSON.stringify(stats)}`);
  eq(makeAttempt('reject-1', { ...band, walk: [2, 4] }, stats), null, 'and it returns no board');

  const hard = {};
  for (let i = 0; i < 30; i++) makeAttempt(`dead-${i}`, band, hard, { scramble: 'perm' });
  ok((hard.unsolvable || 0) >= 1, `a uniform shuffle must hand the parity gate something to refuse, got ${JSON.stringify(hard)}`);

  const tight = {};
  const n4 = bandByKey('siege');
  for (let i = 0; i < 10; i++) makeAttempt(`budget-${i}`, { ...n4, nodeLimit: 30, timeLimitMs: 1 }, tight);
  ok((tight.truncated || 0) >= 5, `a 30-node budget on a deep 4x4 must mostly run out, got ${JSON.stringify(tight)}`);
  eq(tight.keep, undefined, 'nothing is kept out of a search that never finished');
});

test('a band nothing can satisfy is refused rather than filled with noise', () => {
  const stats = {};
  const impossible = { key: 'never', label: '不可能', n: 3, min: 60, max: 70, walk: [30, 40], nodeLimit: 200000, timeLimitMs: 1000 };
  eq(makePuzzle('x', impossible, stats, { tries: 5 }), null, 'the 3x3 graph tops out at 31 slides');
  eq(stats.gaveUp, 1);
  eq(stats.tooEasy >= 5, true, 'every attempt was measured below the floor instead of being rounded up to it');
  ok(inversions(toArray(goalState(3))) === 0);
});

test('makePuzzle honours its try budget and stops looking', () => {
  const stats = {};
  const lot = makePuzzle('one-try', bandByKey('kerb'), stats, { tries: 1 });
  eq(stats.attempt <= 1, true, 'one seed at most when told to');
  ok(lot === null || lot.par >= 2, lot ? `got par ${lot.par}` : 'declined, which is allowed');
});

run();
