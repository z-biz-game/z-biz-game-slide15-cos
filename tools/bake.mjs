// The content pipeline: this is where every board in the game comes from, and the browser
// never runs it.
//
//   node tools/bake.mjs                 # writes js/data/lots.js
//   PER_BAND=4 node tools/bake.mjs      # a smaller pool while iterating
//
// What has to be true for a board to ship:
//   1. the parity theorem says it is reachable,
//   2. IDA* finishes inside the band's budget (a truncated search is counted and dropped —
//      its threshold is an estimate and an estimate never becomes a printed `par`),
//   3. the measured optimum falls inside the band,
//   4. re-solving the *serialised* row reproduces that optimum and replays the stored route
//      onto the goal.
// Number 4 is the reason the file can be trusted after it is written: a hand-edited `par`
// makes `node test/library.test.mjs` fail, and that test is in CI.
//
// The cost is measured and printed, not assumed. 3x3 solves are sub-millisecond; the 4x4
// bands are where boards get thrown away, and the acceptance rate below is the honest
// number for that.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BANDS, bandByKey, makePuzzle, makeAttempt } from '../js/core/make.js';
import { solve, replay } from '../js/core/solve.js';
import { isGoal, formatState, toArray } from '../js/core/puzzle.js';
import { solvable, inversions } from '../js/core/parity.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PER_BAND = Number(process.env.PER_BAND || 8);

function median(sorted) {
  if (!sorted.length) return 0;
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

const rows = [];
const report = [];

for (const band of BANDS) {
  const stats = {};
  const times = [];
  const picked = [];
  const seen = new Set();
  const t0 = Date.now();
  for (let s = 0; picked.length < PER_BAND && s < PER_BAND * 40; s++) {
    const lot = makePuzzle(`bake-${band.key}-${s}`, band, stats, { tries: 60 });
    if (!lot) continue;
    const key = formatState(lot.state);
    if (seen.has(key)) { stats.duplicate = (stats.duplicate || 0) + 1; continue; }
    // Re-solve the serialised row, exactly as the game will read it back.
    const roundTrip = JSON.parse(JSON.stringify({ state: lot.state, par: lot.par, path: lot.path }));
    const again = solve(roundTrip.state, { nodeLimit: band.nodeLimit, timeLimitMs: band.timeLimitMs });
    if (!again.ok || again.moves !== lot.par) {
      throw new Error(`${band.key}: par ${lot.par} not reproduced from the serialised board (${again.moves}${again.truncated ? ', truncated' : ''})`);
    }
    if (!isGoal(replay(roundTrip.state, roundTrip.path))) {
      throw new Error(`${band.key}: stored route does not replay onto the goal`);
    }
    seen.add(key);
    times.push(lot.ms);
    picked.push({
      id: `${band.key}-${String(picked.length + 1).padStart(2, '0')}`,
      band: band.key,
      n: lot.n,
      state: toArray(lot.state),
      par: lot.par,
      path: lot.path,
      nodes: lot.nodes,
      ms: lot.ms,
      seed: lot.seed,
    });
    process.stdout.write(`\r${band.key}: ${picked.length}/${PER_BAND}  ${((Date.now() - t0) / 1000).toFixed(1)}s  `);
  }
  process.stdout.write(`\n`);
  if (picked.length < PER_BAND) console.error(`warn: ${band.key} only reached ${picked.length} boards`);
  // Play the band as a curve: easiest measured optimum first.
  picked.sort((a, b) => a.par - b.par || a.id.localeCompare(b.id));
  picked.forEach((p, i) => { p.id = `${band.key}-${String(i + 1).padStart(2, '0')}`; });
  rows.push(...picked);

  times.sort((a, b) => a - b);
  const attempts = stats.attempt || 0;
  report.push({
    band: band.key,
    label: band.label,
    n: band.n,
    bandRange: `${band.min}-${band.max}`,
    got: picked.length,
    pars: picked.length ? `${Math.min(...picked.map((p) => p.par))}-${Math.max(...picked.map((p) => p.par))}` : '—',
    accept: attempts ? `${((100 * (stats.keep || 0)) / attempts).toFixed(1)}%` : '—',
    tooEasy: stats.tooEasy || 0,
    tooHard: stats.tooHard || 0,
    unsolvable: stats.unsolvable || 0,
    truncated: stats.truncated || 0,
    duplicate: stats.duplicate || 0,
    gaveUp: stats.gaveUp || 0,
    attempts,
    msMed: median(times),
    msMax: times.length ? times[times.length - 1] : 0,
    nodesMax: picked.reduce((m, p) => Math.max(m, p.nodes), 0),
    secs: +((Date.now() - t0) / 1000).toFixed(1),
  });
}

// The parity gate on its own: a uniform shuffle is the case where boards really are dead,
// so this census prints the rejection that a random walk can never produce.
{
  const stats = {};
  const band = bandByKey('cross');
  for (let i = 0; i < 200; i++) makeAttempt(`perm-${i}`, band, stats, { scramble: 'perm' });
  report.push({
    band: '(census)', label: '整盘洗牌', n: 3, bandRange: '—', got: stats.keep || 0, pars: '—',
    accept: `${((100 * (stats.keep || 0)) / (stats.attempt || 1)).toFixed(1)}%`,
    tooEasy: stats.tooEasy || 0, tooHard: stats.tooHard || 0,
    unsolvable: stats.unsolvable || 0, truncated: 0, duplicate: 0, gaveUp: 0,
    attempts: stats.attempt || 0, msMed: 0, msMax: 0, nodesMax: 0, secs: 0,
  });
}

// The band the UI prints is measured off the boards that shipped, not copied from the
// generator's wish list.
const meta = BANDS.map((b) => {
  const mine = rows.filter((r) => r.band === b.key).map((r) => r.par);
  if (!mine.length) return null;
  const lo = Math.min(...mine);
  const hi = Math.max(...mine);
  return {
    key: b.key, label: b.label, n: b.n, min: lo, max: hi,
    blurb: `${b.n}×${b.n} · ${lo === hi ? lo : `${lo}-${hi}`} 步`,
  };
}).filter(Boolean);

const lines = [
  '// Generated by tools/bake.mjs — every board in this game is a measurement, not an opinion.',
  '// `par` is the IDA*-proved optimum for the `state` on the same line (additive Manhattan +',
  '// linear conflict, both admissible), and `path` is the certified route in cell indices.',
  '// Do not hand-edit: `node test/library.test.mjs` re-solves every row and fails if a',
  '// number and its board ever disagree. Re-run with `node tools/bake.mjs`.',
  `export const TIERS_META = ${JSON.stringify(meta)};`,
  'export const LOTS = [',
  ...rows.map((r) => `  ${JSON.stringify(r)},`),
  '];',
  '',
];
const path = join(root, 'js', 'data', 'lots.js');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, lines.join('\n'));

const pad = (v, w) => String(v).padEnd(w);
console.log(`\nband       n  range  got  pars    accept  tooEasy tooHard unsolv trunc  dup  msMed msMax nodesMax  s`);
for (const r of report) {
  console.log(
    `${pad(r.band, 10)} ${r.n}  ${pad(r.bandRange, 6)} ${pad(r.got, 4)} ${pad(r.pars, 7)}`
    + ` ${pad(r.accept, 8)} ${pad(r.tooEasy, 7)} ${pad(r.tooHard, 7)} ${pad(r.unsolvable, 6)}`
    + ` ${pad(r.truncated, 5)} ${pad(r.duplicate, 4)} ${pad(r.msMed, 5)} ${pad(r.msMax, 5)} ${pad(r.nodesMax, 8)} ${r.secs}`,
  );
}
const byN = {};
for (const r of rows) byN[r.n] = (byN[r.n] || 0) + 1;
console.log(`\nwrote ${rows.length} boards (${Object.entries(byN).map(([k, v]) => `${k}x${k}:${v}`).join(' ')}) -> js/data/lots.js`);
// One more sanity line: the shipped file must be internally consistent about parity, since
// an unsolvable row would make the game unwinnable and the search above would have thrown.
const badParity = rows.filter((r) => !solvable(r.state));
console.log(`parity check on the shipped file: ${badParity.length} unsolvable rows (inversions of the first row: ${inversions(rows[0].state)})`);
