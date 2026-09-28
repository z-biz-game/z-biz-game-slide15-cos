// A board mid-game: the arrangement on screen, how many slides the player has spent, and
// the rules that decide whether a press does anything. No DOM, no clock, so the node tests,
// the browser tests and the baked data all drive the same object the canvas shows.

import { widthOf, blankAt, canSlide, swap, isGoal, slidePositions } from './puzzle.js';
import { solve } from './solve.js';

// `lot` is one row of js/data/lots.js: { id, band, n, state, par, path }.
// The game never searches: `par` and the certified `path` arrived already measured.
export function createGame(lot) {
  const state = Uint8Array.from(lot.state);
  const n = widthOf(state);
  if (n !== lot.n) throw new Error(`lot ${lot.id} claims ${lot.n}x${lot.n} and carries a ${n}x${n} board`);
  return {
    id: lot.id,
    band: lot.band,
    n,
    par: lot.par,
    start: Uint8Array.from(state),
    state,
    moves: 0,
    history: [],
    done: false,
  };
}

export function blankCell(game) {
  return blankAt(game.state);
}

// Which cells a finger may press right now — the view highlights these, and only these.
export function legalTaps(game) {
  return Array.from(slidePositions(game.state));
}

// Press a cell. Returns 1 when a tile slid and 0 when nothing happened; a press on a tile
// that is not touching the blank costs nothing at all, which is the difference between a
// counter that means something and one that merely counts taps.
//
// The history stores the pair of cells a slide exchanged, not just the pressed cell: the
// blank has already moved on, so "which cell did I press" does not say on its own which
// cell the tile came from, and undo needs that one.
export function tap(game, pos) {
  if (game.done) return 0;
  if (!canSlide(game.state, pos)) return 0;
  const blank = blankAt(game.state);
  swap(game.state, blank, pos);
  game.history.push({ blank, pos });
  game.moves++;
  if (isGoal(game.state)) game.done = true;
  return 1;
}

// Every slide is a swap of two cells, so taking it back is the same swap again.
export function undo(game) {
  const last = game.history.pop();
  if (last === undefined) return false;
  swap(game.state, last.blank, last.pos);
  game.moves--;
  game.done = false;
  return true;
}

export function reset(game) {
  game.state = Uint8Array.from(game.start);
  game.history = [];
  game.moves = 0;
  game.done = false;
}

// Three grades, defined here rather than in the markup so the tests can assert them.
// par is a proof, so "you matched the solver" is a fact about the run, not a mood.
export function grade(game) {
  const over = game.moves - game.par;
  if (over <= 0) return { key: 'perfect', label: '分毫不差', stars: 3 };
  if (over <= Math.max(4, Math.ceil(game.par * 0.2))) return { key: 'clean', label: '干净归位', stars: 2 };
  return { key: 'done', label: '终归复原', stars: 1 };
}

// Re-measure a board the browser is already holding. Only ever called from the debug hook
// the view hangs off the page, and from tools/bake.mjs — never on a tap, never on a route change.
export function verifyPar(game, opts) {
  const r = solve(game.state, opts);
  return { ok: r.ok, moves: r.moves, nodes: r.nodes, truncated: r.truncated, par: game.par };
}
