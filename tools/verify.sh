#!/usr/bin/env bash
# One-shot verification: the node suites first, then a real browser against a real server,
# driven over raw CDP (no Playwright, no npm install). Everything the script starts exits with
# the script, including the Chrome it started in its own temp profile.
#
#   ./tools/verify.sh                              # node suites + @boot @play @routes @save @reloaded @pointer
#   SCENARIOS="pointer" ./tools/verify.sh          # one browser suite while editing the view
#   SKIP_UNIT=1 ./tools/verify.sh                  # browser only (what the CI browser job does)
#   SHOT_DIR=/tmp/puzzle-brief/shots ./tools/verify.sh   # where the per-scenario PNGs land
#
# One PNG per scenario is written to $SHOT_DIR (default /tmp/slide15) by the same driver that
# ran it, so the picture a human reviews came off the same page the assertions read.
#
# PORTS: web 5192, devtools 9352. They must NOT collide with the sibling repos in this series
# (gridlock :5180/:9340, nine-rings :5181/:9341, and the rest of the batch on :5185-:5191 /
# :9345-:9351) — a collision is not a nuisance, it is a false verdict, because the driver
# would attach to somebody else's Chrome and read a page that is not this game.
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterisation saturates the cores and, with no CDP client attached, the process will not exit
# on its own. This game is 2D canvas, so plain headless Chrome is enough.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
CDP_PORT=${CDP_PORT:-9352}
WEB_PORT=${WEB_PORT:-5192}
BASE=${BASE_URL:-http://127.0.0.1:$WEB_PORT/}
SHOT_DIR=${SHOT_DIR:-/tmp/slide15}
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

# An orphan Chrome from a killed builder answers /json/version happily and then reports "0
# browser asserts, 0 failures" for a page it never loaded. Refuse to be fooled: if anything is
# already listening on either port, or any headless Chrome is already up with a debug port,
# stop here and say so instead of producing a green lie.
if [ "${IGNORE_ORPHANS:-}" != "1" ]; then
  if lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "devtools port :$CDP_PORT is already in use — another playtest (or an orphan Chrome) is alive." >&2
    echo "clean it up (pgrep -fl remote-debugging-port), or set CDP_PORT=<free port> IGNORE_ORPHANS=1." >&2
    exit 5
  fi
  if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "web port :$WEB_PORT is already in use — the game would be served by somebody else's server." >&2
    echo "clean it up (lsof -nP -iTCP:$WEB_PORT -sTCP:LISTEN), or set WEB_PORT=<free port>." >&2
    exit 6
  fi
  LEFT=$(ps -Ao command= | awk '/remote-debugging[-]port/ && !/--type=/' | wc -l | tr -d ' ')  # instances, not processes
  if [ "$LEFT" != "0" ]; then
    echo "note: $LEFT headless Chrome process(es) with a debug port are already running elsewhere on" >&2
    echo "      this machine. Ports :$CDP_PORT/:$WEB_PORT are free, so this run will not read them," >&2
    echo "      but a busy machine can make the readiness polls slow. Continuing." >&2
  fi
fi

UDD=$(mktemp -d)
mkdir -p "$SHOT_DIR"
"$CHROME" --headless=new --remote-debugging-port=$CDP_PORT --user-data-dir=$UDD \
  --window-size=1000,820 --no-first-run --no-default-browser-check about:blank >/tmp/slide15-chrome.log 2>&1 &
CPID=$!
node "$HERE/server.cjs" $WEB_PORT >/tmp/slide15-server.log 2>&1 &
SPID=$!
cleanup() {
  kill -9 $CPID $SPID 2>/dev/null
  wait $CPID 2>/dev/null
  wait $SPID 2>/dev/null
  wait $WD 2>/dev/null
  rm -rf $UDD
}
trap cleanup EXIT
# Watchdog redirects its fds: a background subshell inherits the script's stdout, and if this
# runs inside a pipeline it would hold the write end open for the full timeout and stall the
# consumer long after the tests finished.
( sleep ${WD_TIMEOUT:-300}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# DUAL readiness: the devtools endpoint and the web root are two different servers that start
# at different speeds, and driving a page whose origin is not answering yet is exactly how you
# get an empty result set rather than an error. A fresh --user-data-dir binds DevTools
# noticeably later than a warm profile, so wait on both endpoints, never on a guessed sleep.
for i in $(seq 1 60); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$CDP_PORT" >&2; exit 3; }
for i in $(seq 1 40); do
  curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS -m 2 "$BASE" >/dev/null 2>&1 || {
  echo "static server never answered on $BASE" >&2; exit 4; }

cd "$HERE"
FAILED=0

echo "=== node suites ==="
# SKIP_UNIT=1 for the browser job in CI: the suites are its own job there.
if [ -z "${SKIP_UNIT:-}" ]; then
  NODE_ASSERTS=0
  for f in test/*.test.mjs; do
    echo "--- $f"
    OUT=$(node "$f"); RC=$?
    printf '%s\n' "$OUT" | tail -1
    A=$(printf '%s\n' "$OUT" | sed -n 's/^rows: [0-9]* fail: [0-9]* asserts: \([0-9]*\)$/\1/p' | tail -1)
    NODE_ASSERTS=$((NODE_ASSERTS + ${A:-0}))
    [ $RC -ne 0 ] && FAILED=1
  done
  echo "node assertions total: $NODE_ASSERTS"
fi

export CDP_PORT
export BASE_URL=$BASE
node tools/playtest.mjs open "$BASE" | head -3
# The shell resolves a route (a pure lookup over js/data/lots.js) before it reports a state, so
# wait on window.slide15.state.id rather than on a timer: on a warm localhost this is instant and
# on GitHub Pages a fixed sleep used to sample an unstyled 300x150 canvas and call it a failure.
BOOT=""
for i in $(seq 1 60); do
  BOOT=$(node tools/playtest.mjs eval "window.slide15?window.slide15.state.id:'nope'" nonav 2>/dev/null | tr -d '\n" ')
  case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
done
echo "boot lot: $BOOT"
[ "$BOOT" = "nope" ] || [ -z "$BOOT" ] && { echo "window.slide15 never appeared at $BASE" >&2; exit 5; }

# @reloaded has to run after @save (it reads what @save left on disk) and each scenario runs in
# its own driver process, which is what makes the "eval without nonav" reload real.
TOTAL_ROWS=0
TOTAL_FAIL=0
for s in ${SCENARIOS:-boot play routes save reloaded pointer}; do
  echo "=== @$s ==="
  if [ "$s" = "reloaded" ]; then
    OUT=$(node tools/playtest.mjs eval "@$s" 2>&1)
  else
    OUT=$(node tools/playtest.mjs eval "@$s" nonav 2>&1)
  fi
  printf '%s\n' "$OUT" | python3 -c '
import sys, json
raw = sys.stdin.read()
# Brace counting, not JSON.parse of a line: headless Chrome appends its own text to the same
# line the result is printed on, and a line-wise parse fails (or, worse, parses a prefix).
start = raw.find("{")
if start < 0:
    print("NO RESULT", raw[-300:]); sys.exit(1)
depth = 0
d = None
for i in range(start, len(raw)):
    if raw[i] == "{": depth += 1
    elif raw[i] == "}":
        depth -= 1
        if depth == 0:
            try: d = json.loads(raw[start:i + 1])
            except Exception as e:
                print("BAD JSON", e, raw[start:start+200]); sys.exit(1)
            break
if d is None:
    print("UNBALANCED BRACES", raw[-200:]); sys.exit(1)
rows = d.get("rows", [])
bad = [r for r in rows if not r["pass"]]
print("rows:", len(rows), "fail:", len(bad))
for r in bad: print("  FAIL", r["test"], json.dumps(r["detail"], ensure_ascii=False)[:240])
sys.exit(1 if bad else 0)
' || FAILED=1
  # A clean console is part of the contract: a thrown page error, a refused resource or a
  # rendering warning all count, even when every assertion above happened to pass. (The
  # favicon is an inline SVG data URI in index.html for exactly this reason.)
  # `[log:x]` is its own shape: Log.entryAdded entries are tagged with their level, so a
  # rendering *warning* — the Canvas2D readback hint, for one — reads `[log:warning]` and slips
  # past a grep for `[warning]`. Match both, or the gate is green on a page that complained.
  if printf '%s' "$OUT" | grep -qE '\[EXCEPTION\]|\[log:[a-z]+\]|\[(error|warning)\]'; then
    echo "  CONSOLE NOT CLEAN for @$s"
    printf '%s\n' "$OUT" | grep -E '\[EXCEPTION\]|\[log:[a-z]+\]|\[(error|warning)\]' | head -5
    FAILED=1
  fi
  node tools/playtest.mjs shot "$SHOT_DIR/$s.png" >/dev/null 2>&1
done

echo "=== console ==="
# A print-only dump is a green gate that reads its own evidence and then ignores it: this is the
# one place the buffered Log.entryAdded replay shows up in full, so it has to decide too.
LOGDUMP=$(node tools/playtest.mjs logs)
printf '%s\n' "$LOGDUMP"
if printf '%s' "$LOGDUMP" | grep -qE '\[EXCEPTION\]|\[log:[a-z]+\]|\[(error|warning)\]'; then
  echo "  THE PAGE LEFT A DIRTY CONSOLE — see the dump above" >&2
  FAILED=1
fi
kill $WD 2>/dev/null
wait $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
