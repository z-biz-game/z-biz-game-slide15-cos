// The seed machinery. Two claims live here. First: a seed string always produces the same
// stream, otherwise `#/daily` and a shared link would not be the same board on a second
// device. Second: `hashSeed` is exactly the function the benchmark repo ships, so a literal
// set of expected values is locked in below — if someone "tidies" the mix, every daily board
// in the game silently changes and this suite says so out loud.
//
// The lock is written against two independent implementations typed out longhand in this
// file: the published FNV-1a (one multiply per byte) and the shape `rng.js` actually uses
// (the high byte of each char code mixed unconditionally, so two multiplies per char).

import { test, run, ok, eq } from '../tools/harness.mjs';
import { hashSeed, mulberry32, rngFrom, todayKey } from '../js/core/rng.js';

// FNV-1a, 32 bit, from the published specification: offset basis 2166136261, prime 16777619,
// one byte at a time, multiply after each xor — and only the bytes a char code actually has.
function fnv1a32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 16777619) >>> 0;
    if (c > 255) h = Math.imul(h ^ ((c >> 8) & 0xff), 16777619) >>> 0;
  }
  return h >>> 0;
}

// The shipped shape: both halves of the char code go through xor-then-multiply, whatever the
// high byte holds. Typed out here in a different shape from the source (a loop over the two
// bytes) so that agreeing is evidence rather than a copy.
function seedMix(str) {
  const PRIME = 16777619;
  let acc = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    for (const byte of [code & 255, (code >>> 8) & 255]) {
      acc ^= byte;
      acc = Math.imul(acc, PRIME);
      acc >>>= 0;
    }
  }
  return acc;
}

test('the published FNV-1a vectors, against an implementation typed in here', () => {
  eq(fnv1a32(''), 2166136261, 'the offset basis, unchanged by an empty string');
  eq(fnv1a32('a'), 3826002220, '0xe40c292c from the reference test suite');
  eq(fnv1a32('z'), 4278997933, '0xff0c53ad');
  eq(fnv1a32('hello'), 1335831723, '0x4f9f2cab');
  eq(fnv1a32('abc'), 440920331, '0x1a47e90b');
  eq(hashSeed(''), 2166136261, 'with nothing to mix, hashSeed and FNV-1a are the same number');
});

test('hashSeed mixes both bytes of every char, so it agrees with stock FNV-1a only when there is a high byte to mix', () => {
  const keys = ['', 'a', 'z', 'hello', 'abc', '2026-09-27', 'bake-abyss-3', 'daily|2026-09-27', 'é', '十五数字盘', '串x'];
  for (const k of keys) eq(hashSeed(k), seedMix(k), `the longhand transcription agrees on ${JSON.stringify(k)}`);
  // An ASCII char has a zero high byte, and `hashSeed` multiplies for it anyway while the
  // published algorithm skips it — so the two part company on every ASCII string. A char
  // above U+00FF has a real high byte, both mix it, and the numbers come out identical.
  for (const k of keys) {
    const hasLowByte = [...k].some((ch) => ch.charCodeAt(0) <= 255);
    if (hasLowByte) ok(hashSeed(k) !== fnv1a32(k), `${JSON.stringify(k)} has a char with no high byte, so the extra multiply shows up`);
    else eq(hashSeed(k), fnv1a32(k), `${JSON.stringify(k)} is all high bytes, so it is stock FNV-1a after all`);
  }
  // The stability lock: these are the numbers the shipped pool and the daily route hash with.
  eq([hashSeed('a'), hashSeed('hello'), hashSeed('2026-09-27'), hashSeed('bake-abyss-3')],
    [723832900, 3276111607, 1753841231, 1923062945],
    'changing these means every saved daily board moves under the player');
});

test('hashSeed is a function of the string and nothing else', () => {
  eq(hashSeed('bake-abyss-3'), hashSeed('bake-abyss-3'));
  ok(hashSeed('bake-abyss-3') !== hashSeed('bake-abyss-4'), 'one character moves it');
  ok(hashSeed('daily|2026-09-27') !== hashSeed('daily|2026-09-28'));
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(hashSeed(`s-${i}`));
  ok(seen.size > 480, `500 distinct keys collapsed into ${seen.size} hashes — too clustered to pick boards with`);
  for (const v of seen) ok(Number.isInteger(v) && v >= 0 && v < 4294967296, 'every hash is a uint32');
  const buckets = [0, 0, 0, 0];
  for (let i = 0; i < 4000; i++) buckets[hashSeed(`band-${i}`) % 4]++;
  for (const b of buckets) ok(b > 800 && b < 1200, `a quarter of 4000 keys landing on ${b} is not a spread: ${buckets.join('/')}`);
});

test('mulberry32 replays a stream from its state, and stays in [0,1)', () => {
  const a = mulberry32(1234);
  const b = mulberry32(1234);
  const first = [a(), a(), a()];
  eq([b(), b(), b()], first, 'same state, same stream');
  const other = mulberry32(1235);
  const next = [other(), other(), other()];
  eq(first.map((v) => v.toFixed(6)).join(), '0.073295,0.703412,0.902856', 'the stream of state 1234, to six places — a lock, because a shifted stream moves every baked board');
  ok(next.every((v, i) => Math.abs(v - first[i]) > 1e-9), `one step in the state moves every draw: ${first.join()} vs ${next.join()}`);
  const c = mulberry32(7);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const v = c();
    ok(v >= 0 && v < 1, `${v} escaped the unit interval`);
    seen.add(v);
  }
  eq(seen.size, 500, '500 draws, 500 distinct values — the stream is not cycling early');
  const opens = new Set();
  for (let s = 0; s < 1000; s++) opens.add(mulberry32(s)());
  ok(opens.size > 990, `a thousand seeds opened on ${opens.size} distinct first draws`);
});

test('the rng helpers do what their names say', () => {
  const r = mulberry32(99);
  for (let i = 0; i < 200; i++) {
    const k = r.int(5);
    ok(Number.isInteger(k) && k >= 0 && k < 5, `int(5) returned ${k}`);
    const n = r.range(10, 12);
    ok(Number.isInteger(n) && n >= 10 && n <= 12, `range(10,12) returned ${n}`);
  }
  const picked = new Set();
  for (let i = 0; i < 400; i++) picked.add(r.pick([1, 2, 3]));
  eq([...picked].sort(), [1, 2, 3], 'pick returns an element of the array, and reaches all of them');
  const shuffled = r.shuffle([1, 2, 3, 4, 5]);
  eq(shuffled.slice().sort((x, y) => x - y), [1, 2, 3, 4, 5], 'a shuffle keeps the tiles');
  let yes = 0;
  for (let i = 0; i < 400; i++) if (r.chance(0.5)) yes++;
  ok(yes > 140 && yes < 260, `a coin that landed ${yes}/400 heads is not a coin`);
});

test('rngFrom accepts a string, a number, or a ready-made stream', () => {
  eq(rngFrom('seed')(), rngFrom('seed')(), 'string seeds are stable');
  eq(rngFrom(hashSeed('seed'))(), rngFrom('seed')(), 'and a string seed is just its hash');
  const made = mulberry32(42);
  eq(rngFrom(made) === made, true, 'an existing stream is passed through, not re-seeded');
  eq(rngFrom(7)(), mulberry32(7)(), 'numeric seeds go straight to the state');
});

test('todayKey is the YYYY-MM-DD the daily route hashes', () => {
  eq(todayKey(new Date(2026, 8, 27)), '2026-09-27', 'month and day are padded');
  eq(todayKey(new Date(2026, 0, 1)), '2026-01-01');
  eq(todayKey(new Date(2026, 11, 31)), '2026-12-31');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(todayKey()), `today looks like a date: ${todayKey()}`);
});

run();
