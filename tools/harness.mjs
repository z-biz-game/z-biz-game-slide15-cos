// Tiny zero-dep test harness: every test/*.mjs suite prints the same shape so tools/verify.sh
// can aggregate them, and so the browser suite in tools/playtest.mjs reports in identical
// terms ({ test, pass, detail } rows plus a `rows: N fail: M` trailer).
//
// A `test` is one row: the block either finishes without throwing or it does not. `eq` and
// `ok` are the assertions inside it, and a suite prints the number of both so a reader can
// see how much was actually checked.

const rows = [];
let asserts = 0;

export function test(name, fn) {
  try {
    fn();
    rows.push({ test: name, pass: true });
  } catch (err) {
    rows.push({ test: name, pass: false, detail: String((err && err.message) || err) });
  }
}

export function ok(cond, msg = 'expected truthy') {
  asserts++;
  if (!cond) throw new Error(msg);
}

export function eq(a, b, msg = 'not equal') {
  asserts++;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg}\n    got      ${sa}\n    expected ${sb}`);
}

// eq on a value produced by a search against a value typed into the test file by hand.
export function note(msg) {
  console.log(`         · ${msg}`);
}

export function fail(msg) {
  asserts++;
  throw new Error(msg);
}

export function counts() {
  return { rows: rows.length, asserts };
}

export function run() {
  const bad = rows.filter((r) => !r.pass);
  for (const r of rows) console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.test}${r.pass ? '' : '\n         ' + r.detail}`);
  console.log(`rows: ${rows.length} fail: ${bad.length} asserts: ${asserts}`);
  process.exit(bad.length ? 1 : 0);
}
