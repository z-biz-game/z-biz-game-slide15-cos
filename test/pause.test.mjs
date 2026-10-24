// The pause: a behaviour, not a label.
//
// This repo has no stopwatch on the panel, so what a pause has to stop is the demo's own
// auto-play (the one thing on this page that advances without the player) and the board
// input that would otherwise slip past a frozen board. Every claim below is made from the
// outside of js/core/pause.js, with a hand-cranked clock: "the clock stopped" is a fact
// about the numbers, not about how long the suite happened to take.
//
// The last block is not behaviour but wiring: the shell has to actually use the module, or
// the button on the page would be a label over nothing.

import fs from 'node:fs';
import { test, run, ok, eq } from '../tools/harness.mjs';
import { createPause } from '../js/core/pause.js';

// A hand-cranked clock: the suite moves time itself, so "the clock stood still" is a fact
// about the numbers rather than about how long the test happened to take.
function fakeClock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    advance(ms) { t += ms; return t; },
  };
}

const BEAT = 220; // the demo's beat, in milliseconds

test('a fresh page is running and its door is open', () => {
  const c = fakeClock();
  const p = createPause({ now: c.now });
  eq(p.paused, false, 'a fresh pause is not paused');
  eq(p.allowInput(), true, 'and the door is open');
  c.advance(1000);
  eq(p.elapsedMs(), 1000, 'the running clock counts the seconds that ran');
});

test('a pause freezes the clock; a release picks it up where it was', () => {
  const c = fakeClock();
  const p = createPause({ now: c.now });
  c.advance(1500);
  eq(p.elapsedMs(), 1500, 'before the pause');
  eq(p.pause(), true, 'the pause takes');
  eq(p.paused, true, 'the board is on hold');
  c.advance(5000);
  eq(p.elapsedMs(), 1500, 'the clock stands still while the board is on hold');
  eq(p.resume(), true, 'the release takes');
  c.advance(500);
  eq(p.elapsedMs(), 2000, 'and picks up where it was — the hold is neither eaten nor counted twice');
});

test('a second pause is a no-op: the clock is not banked twice', () => {
  const c = fakeClock();
  const p = createPause({ now: c.now });
  c.advance(800);
  eq(p.pause(), true, 'the first pause takes');
  eq(p.pause(), false, 'the second one changes nothing');
  c.advance(400);
  p.resume();
  c.advance(200);
  eq(p.elapsedMs(), 1000, 'the clock lost neither the 800 ms before the pause nor the 200 ms after it');
});

test('the door is shut while the board is on hold', () => {
  const c = fakeClock();
  const p = createPause({ now: c.now });
  let slides = 0;
  const press = p.guard(() => { slides++; return true; });
  eq(press(), true, 'a press on a running board goes through');
  eq(slides, 1, 'and it was one slide');
  p.pause();
  eq(p.allowInput(), false, 'the door is shut');
  eq(press(), false, 'a press on a held board is refused');
  eq(slides, 1, 'and it changed nothing at all — no slide, no board, no count');
  p.resume();
  eq(press(), true, 'the door opens again on release');
  eq(slides, 2, 'exactly one more slide, no more');
});

test("the demo's beat stops with the clock and does not catch up", () => {
  const c = fakeClock();
  const p = createPause({ now: c.now });
  p.rebase(BEAT);
  c.advance(BEAT);
  eq(p.tick(BEAT), true, 'the first beat comes due one period after the demo starts');
  eq(p.tick(BEAT), false, 'and no second beat comes due at the same moment');
  c.advance(BEAT);
  eq(p.tick(BEAT), true, 'the next beat comes due one period later');
  p.pause();
  c.advance(BEAT * 10);
  eq(p.tick(BEAT), false, 'no beat comes due while the board is on hold — the demo does not walk');
  p.resume();
  c.advance(BEAT);
  eq(p.tick(BEAT), true, 'after the release the demo walks on');
  eq(p.tick(BEAT), false, 'and it walks one step, not the ten it sat out');
});

test('three hold/release rounds in a row leave the clock exactly as they found it', () => {
  const c = fakeClock();
  const p = createPause({ now: c.now });
  c.advance(1000);
  for (let i = 0; i < 3; i++) {
    p.pause();
    c.advance(400);
    p.resume();
    c.advance(300);
  }
  eq(p.paused, false, 'the board is running again');
  eq(p.allowInput(), true, 'and the door is open');
  eq(p.elapsedMs(), 1900, 'the three holds are not on the clock, and the running time is not counted twice');
});

test('the module is free of the browser: no DOM, no window, no timers of its own', () => {
  const src = fs.readFileSync(new URL('../js/core/pause.js', import.meta.url), 'utf8');
  for (const banned of ['document', 'window.', 'localStorage', 'navigator', 'requestAnimationFrame', 'fetch(']) {
    ok(!src.includes(banned), `js/core/pause.js does not reach for ${banned}`);
  }
});

// ---- wiring: the shell has to use the module, or the button is a label over nothing ----
const MAIN = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const CSS = fs.readFileSync(new URL('../css/game.css', import.meta.url), 'utf8');

test('the shell wires the pause module to the board, the demo and the view', () => {
  ok(MAIN.includes('allowInput()'), 'commit() asks the pause module whether input is allowed');
  ok(MAIN.includes('pause.tick('), "the demo's beat is counted off the pause module's clock");
  ok(MAIN.includes('view.setPaused('), 'the view is told to stop its animation clock');
  ok(MAIN.includes("'p'"), 'the P key is bound');
  ok(MAIN.includes('pause-btn'), 'the shell knows the pause button');
});

test('the page has a reachable pause control and a visible paused state', () => {
  ok(/<button[^>]*id="pause-btn"/.test(HTML), 'the page has a pause button');
  ok(/>暂停</.test(HTML), 'and it says 暂停 on it');
  ok(/id="pause-veil"/.test(HTML), 'the page has a veil for the paused state');
  ok(/已暂停/.test(HTML), 'and the veil says 已暂停');
  ok(/min-height:\s*44px\s*!important/.test(CSS), 'every button gets the 44px hit-area floor');
});

run();
