// The shipped pool. This is the anti-tamper suite: every row in js/data/lots.js is
// re-solved from the serialised array on the page, so a hand-edited `par` — or a bake that
// drifted away from what its own generator claimed — fails the build instead of shipping a
// number nobody measured.

import { test, run, ok, eq, note } from '../tools/harness.mjs';
import { LOTS, TIERS_META } from '../js/data/lots.js';
import {
  BANDS, ALL, byId, levelAt, lotsIn, campaign, randomLot, dailyLot, bandByKey, stats,
} from '../js/core/library.js';
import { solve, replay } from '../js/core/solve.js';
import { solvable } from '../js/core/parity.js';
import { isGoal, formatState } from '../js/core/puzzle.js';
import { hashSeed } from '../js/core/rng.js';

test('the pool has rows at both widths and every field a row is supposed to have', () => {
  ok(LOTS.length >= 30, `${LOTS.length} boards shipped`);
  const widths = new Set(ALL.map((l) => l.n));
  eq([...widths].sort(), [3, 4], '3x3 and 4x4 both play');
  for (const l of ALL) {
    ok(typeof l.id === 'string' && l.id.length > 3, `${l.id}: needs an id`);
    eq(l.state.length, l.n * l.n, `${l.id}: a ${l.n}x${l.n} board is ${l.n * l.n} cells`);
    eq(l.state.slice().sort((a, b) => a - b).join(','), Array.from({ length: l.n * l.n }, (_, i) => i).join(','), `${l.id}: every tile exactly once`);
    ok(Number.isInteger(l.par) && l.par >= 2, `${l.id}: par ${l.par}`);
    ok(Array.isArray(l.path) && l.path.length === l.par, `${l.id}: a route per slide`);
    ok(typeof l.ms === 'number' && typeof l.nodes === 'number', `${l.id}: carries the cost it took to certify`);
  }
});

test('ids are unique, well formed, and every board appears once', () => {
  const ids = ALL.map((l) => l.id);
  eq(new Set(ids).size, ids.length, 'no duplicated id');
  for (const id of ids) ok(/^[a-z]+-\d\d$/.test(id), `${id} is not band-numbered`);
  const faces = ALL.map((l) => formatState(l.state));
  eq(new Set(faces).size, faces.length, 'the same board cannot ship twice under two ids');
});

test('re-solving every shipped board reproduces the printed par', () => {
  const t0 = Date.now();
  let slowest = { id: '', ms: 0 };
  for (const l of ALL) {
    const r = solve(l.state);
    ok(r.ok, `${l.id}: the search finished inside the default budget, so par is a measurement`);
    eq(r.truncated, false, `${l.id}: a truncated search must never reach the data file`);
    eq(r.moves, l.par, `${l.id} claims ${l.par}, search says ${r.moves}`);
    if (r.ms > slowest.ms) slowest = { id: l.id, ms: r.ms };
  }
  note(`re-solved ${ALL.length} boards in ${Date.now() - t0}ms; slowest ${slowest.id} at ${slowest.ms}ms`);
});

test('every stored route is legal and ends on the goal', () => {
  for (const l of ALL) {
    eq(isGoal(replay(l.state, l.path)), true, `${l.id}: its own certified route has to finish it`);
    eq(l.path.length, l.par);
  }
});

test('parity agrees with the pool: nothing unsolvable shipped', () => {
  for (const l of ALL) {
    eq(solvable(l.state), true, `${l.id} is unreachable and would be an unwinnable screen`);
    eq(isGoal(l.state), false, `${l.id} is already solved before the player touches it`);
  }
});

test('the bands the UI prints are measured off the boards, not off the wish list', () => {
  eq(BANDS.map((b) => b.key), TIERS_META.map((b) => b.key), 'library exposes exactly what bake wrote');
  for (const meta of TIERS_META) {
    const pars = lotsIn(meta.key).map((l) => l.par);
    ok(pars.length > 0, `${meta.key} shipped no boards`);
    eq([Math.min(...pars), Math.max(...pars)], [meta.min, meta.max], `${meta.key} claims ${meta.min}-${meta.max}`);
    eq(meta.blurb, `${meta.n}×${meta.n} · ${meta.min === meta.max ? meta.min : `${meta.min}-${meta.max}`} 步`);
    for (const p of pars) ok(p >= meta.min && p <= meta.max, `${meta.key} shipped a ${p}`);
  }
  // Within a width the bands must not overlap, or "harder" stops meaning anything.
  for (const n of [3, 4]) {
    const rows = TIERS_META.filter((b) => b.n === n);
    for (let i = 1; i < rows.length; i++) ok(rows[i].min > rows[i - 1].max, `${rows[i].key} overlaps ${rows[i - 1].key}`);
  }
});

test('the campaign is a curve: band by band, easiest measured optimum first', () => {
  const bandOrder = BANDS.map((b) => b.key);
  const seen = campaign().map((l) => l.band);
  // Bands are contiguous and appear in ladder order — not alphabetically, which is the
  // difference between "sorted" and "in the order the generator measured them".
  const groups = [];
  for (const key of seen) if (groups[groups.length - 1] !== key) groups.push(key);
  eq(groups, bandOrder.filter((k) => groups.includes(k)), 'one contiguous block per band, in ladder order');
  for (const l of ALL) ok(bandOrder.includes(l.band), `${l.id} claims band ${l.band}`);
  for (const key of bandOrder) {
    const pars = lotsIn(key).map((l) => l.par);
    eq(pars, pars.slice().sort((a, b) => a - b), `${key} ships out of order`);
  }
  eq(levelAt(0).id, ALL[0].id, 'index 0 is the first board');
  eq(levelAt(ALL.length).id, ALL[0].id, 'and the shelf wraps instead of falling off the end');
  eq(levelAt(-1).id, ALL[ALL.length - 1].id, 'negative indices wrap the other way, they do not crash');
});

test('lookups are pure functions of their key', () => {
  const first = ALL[7];
  eq(byId(first.id).id, first.id);
  eq(byId('no-such-board'), null, 'an unknown id says so rather than handing back a random board');
  const seedA = randomLot('fixed', 'deep');
  eq(randomLot('fixed', 'deep').id, seedA.id, 'the same seed, the same board');
  ok(bandByKey(seedA.band).key === 'deep', 'a seeded random pick stays inside the band it was asked for');
  for (const key of ['2026-09-27', '2026-09-28', '2027-01-01', '1999-12-31']) {
    const d = dailyLot(key);
    ok(d, `${key} produced no daily board`);
    eq(dailyLot(key).id, d.id, `${key} is the same board twice over`);
    // The mechanism, checked without going through library.js: the date seeds a hashSeed.
    eq(d.id, LOTS[hashSeed(`daily|${key}`) % LOTS.length].id, `${key} is chosen by hashSeed, not by a clock`);
  }
});

test('stats() reports the pool it actually holds', () => {
  const s = stats();
  eq(s.lots, ALL.length);
  eq(Object.values(s.byBand).reduce((a, b) => a + b.count, 0), ALL.length);
  for (const [key, b] of Object.entries(s.byBand)) {
    const meta = bandByKey(key);
    eq(b.n, meta.n, `${key} is the wrong width`);
    ok(b.min <= b.med && b.med <= b.max, `${key} median ${b.med} outside ${b.min}-${b.max}`);
    eq([b.min, b.max], [meta.min, meta.max]);
    ok(b.nodesMax > 0 && b.msMax >= 0, `${key} records the search cost it took`);
  }
});

test('a row whose par was edited by hand does not survive the guard', () => {
  const row = ALL[3];
  const edited = { ...row, par: row.par + 1 };
  const r = solve(edited.state);
  eq(r.ok, true, 'the board is still solvable...');
  eq(r.moves === edited.par, false, '...but the search disagrees with the edited number, which is what fails CI');
  const fakePath = row.path.slice(0, -1);
  eq(isGoal(replay(row.state, fakePath)), false, 'a truncated route does not quietly count as a solution');
});

run();
