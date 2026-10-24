// The pause: one flag, one clock, one door.
//
// This repo has **no stopwatch on the panel** — a slide puzzle is scored in slides, not in
// seconds — so the things that keep running here are the demo's own auto-play (a timer that
// drops a tile every 220 ms whether the player touches anything or not) and the tile
// animation clock (the canvas carries a tile from one cell to the next on every frame).
// A pause therefore has to stop *those*, not a clock the player never saw.
//
// The module owns exactly three things:
//   1. the flag — is the board on hold? One truth; the shell keeps no copy of it;
//   2. the clock — the time this page has been *running*, with every paused stretch left
//      out. So a pause never eats a second and never invents one, and the demo's beat —
//      which is counted off this clock — stops dead while the board is on hold;
//   3. the door — `allowInput()` and `guard(fn)` hold every press, drag and arrow key at
//      the same place, so nothing slips through while the board is frozen.
//
// No DOM and no window: js/main.js wires it to the button, the veil and the view; the node
// suite drives it with a hand-cranked clock and watches the behaviour from the outside.

const wallClock = () => (globalThis.performance && typeof globalThis.performance.now === 'function'
  ? globalThis.performance.now()
  : Date.now());

export function createPause({ now = wallClock } = {}) {
  let paused = false;
  let banked = 0;      // milliseconds already on the clock
  let since = now();   // when the running stretch began (null: the clock stands still)
  let lastBeat = -1;   // the beat number the self-run last played

  // Move the running stretch onto the clock and stop it there. This is the line that makes
  // a pause freeze the reading instead of merely hiding it.
  function bank() {
    if (since === null) return;
    banked += Math.max(0, now() - since);
    since = null;
  }

  // Milliseconds of running time so far: the banked stretches plus the one in progress.
  function elapsed() {
    return banked + (since === null ? 0 : Math.max(0, now() - since));
  }

  function hold() {
    if (paused) return false;
    paused = true;
    bank();
    return true;
  }

  function release() {
    if (!paused) return false;
    paused = false;
    if (since === null) since = now();
    return true;
  }

  return {
    get paused() { return paused; },
    elapsedMs() { return elapsed(); },
    pause: hold,
    resume: release,
    // Returns the new state: true means the board is now on hold.
    toggle() { return paused ? (release(), false) : (hold(), true); },
    // The door: false while the board is on hold.
    allowInput() { return !paused; },
    // Wrap the one function that changes the board. A blocked call returns false and changes
    // nothing at all — not the board, not the count, not the record.
    guard(fn) {
      return (...args) => (paused ? false : fn(...args));
    },
    // The beat of a self-running thing (the demo's auto-play). The beat number is counted
    // off the *running* clock, so a pause freezes it: no beat comes due while the board is
    // on hold, and when the board is released the next beat is the one right after the
    // pause — the demo neither skips ahead over the pause nor plays the same beat twice.
    tick(periodMs) {
      const n = Math.floor(elapsed() / periodMs);
      if (n <= lastBeat) return false;
      lastBeat = n;
      return true;
    },
    // Start a self-run from here: the first beat is one period away, not "right now".
    rebase(periodMs) { lastBeat = Math.floor(elapsed() / periodMs); },
  };
}
