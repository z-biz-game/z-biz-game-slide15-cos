// The save file. Node has no localStorage at all — and in a real browser touching the
// property can *throw* rather than return null — so this suite runs entirely on the
// degraded path. That is the path a private window and a blocked-storage tab take, and
// losing the game there would be a crash, so it is tested on purpose.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { store, SAVE_KEY } from '../js/core/storage.js';

const fresh = () => { store.reset(); return store; };

test('there is no browser here and the save notices without dying', () => {
  eq(typeof window, 'undefined', 'this suite is the memory-only path');
  eq(store.persistent, false, 'and it reports itself as memory-only rather than pretending to persist');
  const s = fresh();
  eq([s.records, s.daily, s.unlocked, s.stats], [{}, {}, 1, { solves: 0, perfect: 0, slides: 0 }], 'a blank save is blank');
  eq(s.record('never-played'), null);
  eq(s.dailyDone('2026-09-27'), null);
  eq(SAVE_KEY, 'slide15.save.v1', 'one versioned key');
});

test('a solve records the score, the plays and the grade', () => {
  const s = fresh();
  eq(s.solve('kerb-01', { moves: 5, par: 5 }), { solved: true, best: 5, plays: 1, perfect: true });
  const again = s.solve('kerb-01', { moves: 8, par: 5 });
  eq([again.best, again.plays], [5, 2], 'a worse run keeps the record and counts the play');
  eq(again.perfect, true, 'once you have matched par on a board you have done it');
  eq([s.stats.solves, s.stats.slides], [2, 13], 'the totals add up, in both senses');
  eq(s.stats.perfect, 1, 'only the run that hit par counts towards the perfect tally');
});

test('best only ever goes downwards', () => {
  const s = fresh();
  s.solve('cross-02', { moves: 14, par: 12 });
  eq(s.record('cross-02').best, 14);
  s.solve('cross-02', { moves: 12, par: 12 });
  eq([s.record('cross-02').best, s.record('cross-02').perfect], [12, true], 'matching par from above earns the flag');
  s.solve('cross-02', { moves: 30, par: 12 });
  eq(s.record('cross-02').best, 12, 'and a bad run cannot undo it');
  eq(s.record('cross-02').plays, 3, 'it does count as a try');
});

test('a run over par is a solve without the perfect flag', () => {
  const s = fresh();
  eq(s.solve('deep-03', { moves: 25, par: 19 }).perfect, false);
  eq([s.stats.perfect, s.record('deep-03').solved], [0, true]);
  eq(s.solve('deep-03', { moves: 19, par: 19 }).perfect, true, 'then matching it later does earn it');
  eq(s.stats.perfect, 1);
});

test('unlocking the campaign is monotone', () => {
  const s = fresh();
  eq(s.unlock(6), 6);
  eq(s.unlock(2), 6, 'replaying an early board does not lock the back half away');
  eq(s.unlock(9), 9);
  eq(s.unlocked, 9);
  eq(s.unlock(9), 9, 'and the same value twice is not an error');
});

test('the daily log keeps one entry per calendar day', () => {
  const s = fresh();
  s.markDaily('2026-09-27', 'field-04');
  eq(s.dailyDone('2026-09-27').id, 'field-04');
  eq(s.dailyDone('2026-09-26'), null, 'yesterday is its own board, and was never played');
  eq(Object.keys(s.daily).length, 1, 'asking about a day does not write it into the log');
  s.markDaily('2026-09-27', 'wall-01');
  eq(s.dailyDone('2026-09-27').id, 'wall-01', 'replaying today overwrites today');
  eq(Object.keys(s.daily).length, 1, 'two marks on one date are still one entry');
  s.markDaily('2026-09-28', 'deep-02');
  eq(Object.keys(s.daily).sort(), ['2026-09-27', '2026-09-28'], 'and a new date is a new entry');
  eq(s.dailyDone('2026-09-27').id, 'wall-01', 'which leaves the earlier day alone');
});

test('reset really is a wipe', () => {
  const s = fresh();
  s.solve('kerb-01', { moves: 4, par: 4 });
  s.unlock(7);
  s.markDaily('2026-09-27', 'kerb-01');
  eq(Object.keys(s.records).length, 1);
  s.reset();
  eq([s.records, s.daily, s.unlocked, s.stats], [{}, {}, 1, { solves: 0, perfect: 0, slides: 0 }]);
  eq(store.record('kerb-01'), null, 'no trace left');
  eq(store.stats.slides, 0, 'not even the totals');
});

run();
