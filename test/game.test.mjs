// The rules of a game in progress: what a press costs, when a board counts as won, what
// taking a step back means, and how a score is decided. Nothing here reaches for the DOM,
// so this suite and the browser drive the very object the canvas paints.
//
// The boards come from the shipped pool, so every claim below is checked against a `par`
// that tools/bake.mjs measured, not against a number invented in this file.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { byId, campaign } from '../js/core/library.js';
import { createGame, blankCell, legalTaps, tap, undo, reset, grade, verifyPar } from '../js/core/game.js';
import { goalState, isGoal, formatState, toArray, canSlide, neighbours, widthOf } from '../js/core/puzzle.js';
import { solve } from '../js/core/solve.js';

const EASY = byId('kerb-01'); // 3x3, par 4, path [3,6,7,8]
const HARD = byId('abyss-08'); // 3x3, par 28 — the widest allowance in the 3x3 pool
const SQUARE = byId('field-01'); // 4x4, par 16

// One step away and straight back: two slides spent, the same board, so a test can buy
// extra moves without having to solve anything twice.
function detour(game) {
  const blank = blankCell(game);
  const step = legalTaps(game)[0];
  eq(tap(game, step), 1, 'the detour step was legal');
  eq(tap(game, blank), 1, 'and the way back is legal too');
  return game;
}

function detourTimes(game, times) {
  const before = formatState(game.state);
  const spent = game.moves;
  for (let i = 0; i < times; i++) detour(game);
  eq(formatState(game.state), before, 'an away-and-back leaves the board exactly as it was');
  eq(game.moves, spent + 2 * times, 'but it is still two slides spent');
  return game;
}

test('a game opens on the start line with nothing spent', () => {
  const g = createGame(EASY);
  eq([g.id, g.band, g.n, g.par, g.moves, g.done], ['kerb-01', 'kerb', 3, 4, 0, false]);
  eq(toArray(g.state), EASY.state, 'the board on the table is the baked board');
  eq(toArray(g.start), EASY.state, 'and the start line remembers it');
  eq(g.history, [], 'nothing to take back');
  ok(g.state !== EASY.state && g.start !== EASY.state, 'the game holds copies, not a window onto the shipped pool');
});

test('createGame refuses a lot that mislabels its own board', () => {
  eq(widthOf(Uint8Array.from(SQUARE.state)), 4, 'a 4x4 board is 4 wide');
  let threw = '';
  try {
    createGame({ ...SQUARE, n: 3 });
  } catch (err) {
    threw = err.message;
  }
  ok(/claims 3x3 and carries a 4x4 board/.test(threw), `the mismatch has to be named, got: ${threw}`);
  threw = '';
  try {
    createGame({ ...EASY, n: 4 });
  } catch (err) {
    threw = err.message;
  }
  ok(/claims 4x4 and carries a 3x3 board/.test(threw), `and it is named in both directions, got: ${threw}`);
  const good = createGame({ id: 'handmade', band: 'kerb', n: 3, state: [1, 2, 3, 4, 5, 6, 0, 8, 7], par: 2 });
  eq([good.id, good.par, good.moves], ['handmade', 2, 0], 'a hand-made lot with an honest size is accepted');
});

test('the legal presses are exactly the tiles touching the blank', () => {
  const g = createGame(EASY);
  const blank = blankCell(g);
  eq(blank, 4, 'the blank sits in the middle of the baked board');
  eq(legalTaps(g), Array.from(neighbours(3)[blank]), 'the highlight list is the neighbour list of the blank');
  eq(legalTaps(g), [1, 7, 3, 5], 'up, down, left, right — in that fixed order');
  for (const pos of legalTaps(g)) ok(canSlide(g.state, pos), `cell ${pos} is pressable`);
  const far = [0, 2, 6, 8].filter((p) => !legalTaps(g).includes(p));
  eq(far, [0, 2, 6, 8], 'the four corners are not touching the blank');
  for (const pos of [...far, blank]) ok(!canSlide(g.state, pos), `cell ${pos} is not pressable`);
});

test('a press on a tile that is not sliding costs nothing', () => {
  const g = createGame(EASY);
  const before = formatState(g.state);
  for (const pos of [4, 0, 2, 6, 8, -1, 9, 99]) {
    eq(tap(g, pos), 0, `pressing ${pos} does nothing`);
  }
  eq(formatState(g.state), before, 'the board never moved');
  eq([g.moves, g.history.length, g.done], [0, 0, false], 'and nothing was spent or recorded');
});

test('one legal press slides one tile and spends one move', () => {
  const g = createGame(EASY);
  eq(tap(g, 3), 1, 'the tile left of the blank slides right');
  eq(toArray(g.state), [1, 2, 3, 0, 5, 6, 4, 7, 8], 'the blank has moved into that cell');
  eq([g.moves, g.history, g.done], [1, [{ blank: 4, pos: 3 }], false], 'one slide, one entry in the history');
  eq(blankCell(g), 3, 'blankCell follows the blank');
  eq(tap(g, 3), 0, 'pressing the blank itself is not a slide');
  eq([g.moves, g.history], [1, [{ blank: 4, pos: 3 }]], 'still one slide spent');
  eq(tap(g, 6), 1, 'now the tile below the blank can come up');
  eq([g.moves, g.history, blankCell(g)], [2, [{ blank: 4, pos: 3 }, { blank: 3, pos: 6 }], 6]);
});

test('the certified path wins at exactly par, and only on its last slide', () => {
  for (const lot of campaign()) {
    const g = createGame(lot);
    eq(lot.path.length, lot.par, `row ${lot.id} carries a path as long as its own par`);
    for (let i = 0; i < lot.path.length; i++) {
      eq(tap(g, lot.path[i]), 1, `row ${lot.id}: press ${i} of ${lot.path.length} was legal`);
      if (i < lot.path.length - 1) {
        ok(!g.done, `row ${lot.id} is not solved before the last slide (par ${lot.par} is a proof, not a guess)`);
        ok(!isGoal(g.state), 'and the goal check agrees');
      }
    }
    eq([g.moves, g.done], [lot.par, true], `row ${lot.id} lands on par`);
    eq(toArray(g.state), toArray(goalState(lot.n)), `row ${lot.id} ends on the goal board`);
    eq(grade(g).stars, 3, `matching the proof is three stars on row ${lot.id}`);
  }
});

test('once the board is home, further presses are ignored', () => {
  const g = createGame(EASY);
  for (const pos of EASY.path) tap(g, pos);
  eq([g.moves, g.done], [4, true]);
  const won = formatState(g.state);
  for (const pos of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    eq(tap(g, pos), 0, `pressing ${pos} after the win does nothing`);
  }
  eq(formatState(g.state), won, 'the solved board is frozen');
  eq([g.moves, g.history.length], [4, 4], 'and the score is safe');
});

test('undo takes back one slide, its cost included', () => {
  const g = createGame(EASY);
  eq(undo(g), false, 'there is nothing to take back at the start');
  eq([g.moves, formatState(g.state)], [0, formatState(Uint8Array.from(EASY.state))]);
  const mid = [];
  for (const pos of EASY.path) {
    tap(g, pos);
    mid.push(formatState(g.state));
  }
  eq(g.done, true, 'solved');
  for (let i = EASY.path.length - 1; i >= 0; i--) {
    eq(undo(g), true, `step ${i} back`);
    eq(g.moves, i, 'and its cost');
    eq(g.done, false, 'an unsolved board is in play again');
    eq(formatState(g.state), i === 0 ? formatState(Uint8Array.from(EASY.state)) : mid[i - 1], 'the board is exactly where it was');
    eq(blankCell(g), i === 0 ? 4 : EASY.path[i - 1], 'the blank sits back where the undone slide took it from');
  }
  eq(g.history, [], 'the history is empty again');
  eq(undo(g), false, 'and there is nothing further to take back');
  eq(toArray(g.state), EASY.state, 'undo never wanders off the path');
  for (const pos of EASY.path) tap(g, pos);
  eq([g.moves, g.done], [4, true], 'the same route still wins after the walk back');
});

test('reset puts the lot back on the table', () => {
  const g = createGame(HARD);
  for (const pos of HARD.path.slice(0, 10)) tap(g, pos);
  eq(g.moves, 10);
  detourTimes(g, 2);
  eq(g.moves, 14);
  reset(g);
  eq([g.moves, g.history, g.done], [0, [], false], 'spent moves, history and the win flag all clear');
  eq(toArray(g.state), HARD.state, 'back to the baked start line');
  for (const pos of HARD.path) tap(g, pos);
  eq([g.moves, g.done], [HARD.par, true], 'and the certified path still fits after a reset');
});

test('the three grades cut at par, at the allowance, and past it', () => {
  eq(grade(createGame(EASY)), { key: 'perfect', label: '分毫不差', stars: 3 }, 'fresh board: nothing spent yet, so nothing worse than par has happened');
  const atPar = createGame(EASY);
  for (const pos of EASY.path) tap(atPar, pos);
  eq(grade(atPar).stars, 3, 'solved in par is three stars');

  // The allowance is max(4, ceil(par * 0.2)) slides over par. On this lot that is 4:
  // three stars at 4, two at 5..8, one from 9.
  for (const [extra, want] of [[2, 'clean'], [4, 'clean'], [6, 'done'], [10, 'done']]) {
    const g = createGame(EASY);
    detourTimes(g, extra / 2);
    for (const pos of EASY.path) tap(g, pos);
    eq([g.moves, g.done], [4 + extra, true], `par plus ${extra} slides still solves the board`);
    eq(grade(g).key, want, `${4 + extra} slides against par 4 grades ${want}`);
  }

  // par 28 buys ceil(28 * 0.2) = 6 slides, so the two-star band is wider here — the
  // allowance is a proportion, floored at 4, not a constant.
  const clean = createGame(HARD);
  detourTimes(clean, 3);
  for (const pos of HARD.path) tap(clean, pos);
  eq([clean.moves, grade(clean).key], [34, 'clean'], '28 + 6 is still two stars');
  const poor = createGame(HARD);
  detourTimes(poor, 4);
  for (const pos of HARD.path) tap(poor, pos);
  eq([poor.moves, grade(poor).key, grade(poor).label, grade(poor).stars], [36, 'done', '终归复原', 1], '28 + 8 is one star');
});

test('verifyPar re-measures what the screen is holding and agrees with the printed par', () => {
  const g = createGame(EASY);
  const fresh = verifyPar(g);
  eq([fresh.ok, fresh.truncated, fresh.moves, fresh.par], [true, false, 4, 4], 'a fresh board measures exactly its printed par');
  ok(fresh.nodes > 0, `the search looked at ${fresh.nodes} nodes, which is not zero`);
  tap(g, EASY.path[0]);
  eq([g.moves, blankCell(g)], [1, 3], 'one slide in');
  const after = verifyPar(g);
  eq([after.ok, after.truncated, after.par], [true, false, 4], 'the printed par never moves');
  eq(after.moves, 3, 'and the remaining optimum is par minus the slide spent — the tail of an optimal route is optimal');
  tap(g, EASY.path[1]);
  eq(verifyPar(g).moves, 2, 'two spent, two to go');
  const sq = createGame(SQUARE);
  const measured = verifyPar(sq, { nodeLimit: 4000000, timeLimitMs: 20000 });
  eq([measured.par, measured.ok, measured.truncated, measured.moves], [16, true, false, 16], 'the easiest 4x4 row re-measures to its printed par when the budget is lifted');
});

test('the search agrees with the baked par on every 3x3 row, budget aside', () => {
  // A cheap full audit of the 3x3 pool: IDA* has no budget problem at this size, so any
  // disagreement between a printed par and a re-solve is a real bug in the bake.
  for (const lot of campaign()) {
    if (lot.n !== 3) continue;
    const r = solve(Uint8Array.from(lot.state));
    eq([r.ok, r.truncated, r.moves, lot.id], [true, false, lot.par, lot.id], `row ${lot.id} re-solves to its printed par`);
    eq(r.path.length, lot.par, 'and the route it finds is that long');
  }
});

test('a game object carries only what the view needs, in the shapes the view can draw', () => {
  const g = createGame(SQUARE);
  eq(Object.keys(g).sort(), ['band', 'done', 'history', 'id', 'moves', 'n', 'par', 'start', 'state']);
  ok(g.state instanceof Uint8Array && g.start instanceof Uint8Array, 'boards are typed arrays of bytes');
  eq(g.state.length, 16, 'a 4x4 board is sixteen cells');
  eq(widthOf(g.state), g.n, 'and the model agrees with the lot about the width');
  eq(legalTaps(g), [4, 12, 9], 'the same highlight rule works on a sixteen-cell board');
  for (let i = 0; i < SQUARE.path.length; i++) tap(g, SQUARE.path[i]);
  eq([g.moves, g.done, g.n], [16, true, 4], 'the 4x4 route wins on a 4x4 board');
});

run();
