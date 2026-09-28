// The shipped pool. The game picks boards from here and never generates one: that is a
// deliberate split, because the search that certifies a `par` is a build-step cost
// (tools/bake.mjs measures the acceptance rate and per-board time and prints both), while a
// tap on the screen has to be free.
//
// Everything below is a pure lookup over js/data/lots.js, keyed by hashSeed — which is what
// makes `#/daily` and a shared `#/lot/<id>` the same board on every device with no state
// and no network.

import { LOTS, TIERS_META } from '../data/lots.js';
import { hashSeed } from './rng.js';
import { widthOf } from './puzzle.js';

// Display-side bands (label / blurb / measured range). The generation ladder with its
// search budgets lives in make.js and is not needed once the boards are baked.
export const BANDS = TIERS_META;

const prepared = LOTS.map((row) => ({
  id: row.id,
  band: row.band,
  n: row.n,
  par: row.par,
  state: row.state,
  path: row.path,
  nodes: row.nodes,
  ms: row.ms,
  seed: row.seed,
}));

if (prepared.some((l) => widthOf(Uint8Array.from(l.state)) !== l.n)) {
  throw new Error('a shipped row disagrees with its own board size');
}

export const ALL = prepared;

function pick(list, seed, salt) {
  if (!list.length) return null;
  return list[hashSeed(`${salt}|${seed}`) % list.length];
}

export function bandByKey(key) {
  return BANDS.find((b) => b.key === key) || BANDS[0];
}

export function lotsIn(key) {
  return prepared.filter((l) => l.band === key);
}

export function byId(id) {
  return prepared.find((l) => l.id === id) || null;
}

// The campaign: every baked board, easy band first and within a band the lowest measured
// optimum first — exactly the order tools/bake.mjs wrote them in.
export function campaign() {
  return prepared;
}

export function levelAt(index) {
  return prepared[((index % prepared.length) + prepared.length) % prepared.length];
}

// Endless play inside one band. The seed chooses an index, so a shared link is reproducible
// without shipping anything extra.
export function randomLot(seed, bandKey) {
  const list = bandKey ? lotsIn(bandKey) : prepared;
  return pick(list, seed, 'random');
}

// One board per calendar day, identical for everyone who opens it that day.
export function dailyLot(dateKey) {
  return pick(prepared, dateKey, 'daily');
}

// What the pool actually contains, measured rather than claimed. `med` is here because a
// band where every board lands on the same number is one board wearing eight costumes, and
// min/max cannot see that.
function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

export function stats() {
  const byBand = {};
  for (const l of prepared) {
    const s = byBand[l.band] || (byBand[l.band] = {
      n: l.n, count: 0, min: Infinity, max: 0, pars: [], nodes: [], nodesMax: 0, msMax: 0,
    });
    s.count++;
    if (l.par < s.min) s.min = l.par;
    if (l.par > s.max) s.max = l.par;
    s.pars.push(l.par);
    s.nodes.push(l.nodes);
    if (l.nodes > s.nodesMax) s.nodesMax = l.nodes;
    if (l.ms > s.msMax) s.msMax = l.ms;
  }
  for (const s of Object.values(byBand)) {
    s.pars.sort((a, b) => a - b);
    s.med = median(s.pars);
    delete s.pars;
    delete s.nodes;
  }
  return { lots: prepared.length, byBand };
}
