// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch, no
// Playwright, no npm install).
// env: CDP_PORT (devtools port, default 9352), BASE_URL (page to attach to, default
//      http://127.0.0.1:5192/)
// usage:
//   node playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node playtest.mjs nav   <url>
//   node playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval  '@boot'        # | @play | @routes | @save | @reloaded | @pointer
//   node playtest.mjs tap   <cell>         # one real mouse press+release on a board cell
//   node playtest.mjs drag  <cell> <dx> <dy>   # a real pointer drag, in pixels
//   node playtest.mjs shot  <path.png>
//   node playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so
// tools/verify.sh aggregates node suites and browser suites on one line.
const PORT = process.env.CDP_PORT || 9352;
// Which page to attach to. Hard-coding the dev-server port silently evaluates against a
// fresh about:blank tab when pointed at any other origin.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5192/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One real mouse event at a client-space coordinate. Shared by the @pointer suite and the
// `tap`/`drag` commands so the three cannot drift apart in what "a press" means over the wire.
const mouseAt = (cdp, sessionId, type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', {
  type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: type === 'mousePressed' ? 1 : 0, buttons,
}, sessionId);

async function main() {
  // Self-check the in-page suites before attaching: every scenario below is *source text*
  // inside a template literal, so one unbalanced quote or one missing backslash makes the page
  // throw at parse time. That is recoverable (the driver reports a failing row), but the
  // message the browser gives is worse than the one below, and a silently un-parseable suite is
  // the exact way a gate ends up asserting nothing.
  for (const [name, body] of Object.entries(SCENARIOS)) {
    try {
      new Function('return ' + body);
    } catch (err) {
      console.error(`@${name} does not compile: ${err.message}`);
      process.exit(1);
    }
  }
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer. The page is a module graph fetched over the network: a
  // fixed sleep is long enough for a localhost server and too short for GitHub Pages, where it
  // made an innocent deployment look broken (`window.slide15` still undefined, canvas still the
  // unstyled 300x150 default). The floor keeps the local case as fast as it was.
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.slide15 && window.slide15.state && window.slide15.state.id)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  // Poll until the renderer says nothing is travelling any more. Nine-rings slept a fixed
  // 700ms between a tap and a pixel fingerprint; that works until the machine is busy, and
  // then it compares a mid-animation frame against a settled one and calls the difference a
  // bug. `settled()` is the same flag the animation loop maintains for its own bookkeeping.
  const waitSettled = async (budgetMs = 4000) => {
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let done = false;
      try { done = await runJS('window.slide15.settled()'); } catch { done = false; }
      if (done) return true;
      if (Date.now() > deadline) return false;
      await sleep(40);
    }
  };

  // Press and release at the point the page says cell `pos` occupies right now.
  async function tapCellAt(cdp2, sessionId2, cell, hold = 26, rest = 70) {
    await waitSettled();
    const p = await runJS(`window.slide15.cellPoint(${cell})`);
    if (!p) return null;
    await mouseAt(cdp2, sessionId2, 'mousePressed', p.x, p.y, 1);
    await sleep(hold);
    await mouseAt(cdp2, sessionId2, 'mouseReleased', p.x, p.y, 0);
    await sleep(rest);
    return p;
  }

  // A real drag: press on a cell, walk the pointer in small steps, release. Returns the last
  // coordinate it used so the caller can report where the finger ended up.
  async function dragCell(cdp2, sessionId2, cell, dx, dy, steps = 8, hold = 30) {
    await waitSettled();
    const p = await runJS(`window.slide15.cellPoint(${cell})`);
    if (!p) return null;
    await mouseAt(cdp2, sessionId2, 'mousePressed', p.x, p.y, 1);
    await sleep(hold);
    let x = p.x;
    let y = p.y;
    for (let i = 1; i <= steps; i++) {
      x = p.x + (dx * i) / steps;
      y = p.y + (dy * i) / steps;
      await mouseAt(cdp2, sessionId2, 'mouseMoved', x, y, 1);
      await sleep(16);
    }
    await mouseAt(cdp2, sessionId2, 'mouseReleased', x, y, 0);
    await sleep(hold);
    return { ...p, endX: x, endY: y };
  }

  // A real click on a DOM control, aimed at its own box.
  async function clickButton(cdp2, sessionId2, id) {
    const r = await runJS(`(() => { const b = document.getElementById(${JSON.stringify(id)}); const x = b.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; })()`);
    await mouseAt(cdp2, sessionId2, 'mousePressed', r.x, r.y, 1);
    await sleep(24);
    await mouseAt(cdp2, sessionId2, 'mouseReleased', r.x, r.y, 0);
    await sleep(90);
    return r;
  }

  const keyDown = (key, code, vk) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code: code || 'Key' + String(key).toUpperCase(),
    text: key.length === 1 ? key : '', windowsVirtualKeyCode: vk || key.toUpperCase().charCodeAt(0),
  }, sessionId);
  const keyUp = (key, code, vk) => cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code: code || 'Key' + String(key).toUpperCase(),
    windowsVirtualKeyCode: vk || key.toUpperCase().charCodeAt(0),
  }, sessionId);
  const ARROW_VK = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'tap') {
    // One cell, pressed and released for real, against the page that is already open (no
    // navigation, so the game keeps running between commands). This is the same primitive
    // @pointer uses; having it on the command line means the win screenshot a human reviews
    // can be produced by a finger rather than by an injected call.
    const cell = Number(arg);
    if (!Number.isInteger(cell) || cell < 0) {
      console.log('tap wants a cell index, got: ' + arg);
      process.exit(1);
    }
    const p = await tapCellAt(cdp, sessionId, cell);
    if (!p) {
      console.log('EVAL THROW: no cell ' + cell + ' on screen');
      process.exit(1);
    }
    const now = await runJS('window.slide15.state.moves + "/" + window.slide15.state.par + " done=" + window.slide15.state.done');
    console.log(`tapped cell ${cell} at ${p.x},${p.y} -> ${now}`);
  } else if (cmd === 'drag') {
    const parts = process.argv.slice(3).map(Number);
    const p = await dragCell(cdp, sessionId, parts[0], parts[1], parts[2]);
    const now = await runJS('window.slide15.state.moves + "/" + window.slide15.state.par');
    console.log(`dragged cell ${parts[0]} by ${parts[1]},${parts[2]} -> ${now} (ended ${p && p.endX},${p && p.endY})`);
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS, { waitSettled, tapCellAt, dragCell, clickButton, keyDown, keyUp, ARROW_VK });
      } else if (SCENARIOS[name]) {
        // Clear the row buffer *before* running. With `nonav` every scenario is evaluated in
        // the same page, so if this suite throws at parse time the fallback below would
        // otherwise hand back the previous suite's rows and verify.sh would print them as if
        // they belonged to this one — a broken suite that looks green.
        await runJS('window.__lastRows = null; 1');
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// The one suite a page-side script cannot run: real input. Everything below goes through
// Chrome's own mouse and keyboard over CDP, so what gets asserted is the pointer-to-tile
// wiring in js/view.js rather than the rule behind it — which cell a coordinate names, whether
// a press and a drag are each billed once, and whether a refused press leaves the picture
// exactly as it found it.
async function pointerScenario(cdp, sessionId, runJS, tools) {
  const { waitSettled, tapCellAt, dragCell, clickButton, keyDown, keyUp, ARROW_VK } = tools;
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });

  const ids = await runJS(`['board','modes','totals','crumbs','readout','hintline','curtain','stars','verdict','tally','again','next','undo','hint','demo','restart','share','shelf','wipe','toast']
    .map((i) => [i, !!document.getElementById(i)])`);
  rec('every control the shell reaches for exists', ids.every(([, on]) => on), Object.fromEntries(ids));

  await runJS(`window.slide15.load('#/lot/kerb-01'); 'ok'`);
  await sleep(350);
  const start = await runJS(`(() => {
    const g = window.slide15;
    return { state: g.state, level: g.level(), path: g.path(), arr: g.stateArray(), legal: g.legalTaps(), blank: g.blankCell(), px: g.pixels(), lit: g.painted() };
  })()`);
  const par = start.state.par;
  rec('a board loads with a certified par and a route to match',
    start.state.id === 'kerb-01' && par === 4 && start.path.length === par, { id: start.state.id, par, path: start.path.length });
  rec('the canvas is painted with something on it', start.lit > 50 && start.px > 0, { lit: start.lit, px: start.px });
  const roundTrip = await runJS(`(() => { const g = window.slide15; const bad = [];
    for (let c = 0; c < 9; c++) { const p = g.cellPoint(c); if (!p || g.pointAt(p.x, p.y) !== c) bad.push([c, p && p.tile, p && g.pointAt(p.x, p.y)]); }
    return bad; })()`);
  rec('the hit test inverts the geometry for every cell', roundTrip.length === 0, roundTrip);
  const aimCheck = await runJS(`(() => { const g = window.slide15; const bad = [];
    for (const c of g.legalTaps()) { const p = g.cellPoint(c); if (!p.live) bad.push(['not live', c]); if (p.tile === 0) bad.push(['hole', c]); }
    if (g.cellPoint(g.blankCell()).live) bad.push(['the hole is never live', g.blankCell()]);
    return bad; })()`);
  rec('the picture marks exactly the tiles the rule accepts', aimCheck.length === 0, aimCheck);
  const tileMap = await runJS(`(() => { const g = window.slide15; const bad = []; const arr = g.stateArray();
    for (let c = 0; c < arr.length; c++) { if (arr[c] === 0) continue; const tp = g.tilePoint(arr[c]); if (!tp || tp.cell !== c) bad.push([c, arr[c], tp && tp.cell]); }
    return bad; })()`);
  rec('the point of a tile reports the cell the model puts it in', tileMap.length === 0, tileMap);

  // An illegal press: a tile that is not touching the hole. It must not be billed, must not
  // move, and after its shake decays the picture must be the same picture.
  const dead = await runJS(`(() => { const g = window.slide15; const legal = g.legalTaps();
    for (let c = 0; c < 9; c++) if (!legal.includes(c) && g.stateArray()[c] !== 0) return { cell: c, tile: g.stateArray()[c] };
    return null; })()`);
  if (!dead) {
    rec('an illegal press is refused', false, 'this board has no far tile (impossible for n>=3)');
  } else {
    const said = await runJS(`document.getElementById('hintline').textContent`);
    const press = await tapCellAt(cdp, sessionId, dead.cell);
    const after = await runJS(`(() => { const g = window.slide15; return {
      moves: g.state.moves, arr: g.stateArray().join(''), said: document.getElementById('hintline').textContent, legal: g.legalTaps(), history: g.history(),
    }; })()`);
    rec('an illegal press costs nothing: no slide, no history', !!press && after.moves === 0 && after.history.length === 0,
      { cell: dead.cell, tile: dead.tile, moves: after.moves });
    rec('and the board is byte for byte the board it started on', after.arr === start.arr.join(''), { before: start.arr.join(''), after: after.arr });
    rec('the shell says why in terms of the hole', /挨不着空格/.test(after.said) && after.said !== said, after.said);
    rec('the same tiles are still the legal ones', JSON.stringify(after.legal) === JSON.stringify(start.legal) && !after.legal.includes(dead.cell),
      { before: start.legal, after: after.legal });
    await waitSettled();
    const back = await runJS(`(() => { const g = window.slide15; return { px: g.pixels(), moves: g.state.moves, arr: g.stateArray().join('') }; })()`);
    rec('a refused press leaves nothing behind on screen', back.px === start.px && back.arr === start.arr.join(''), { before: start.px, after: back.px });
  }

  // Pressing the hole itself is not pressing a tile at all: no move, and no refusal either.
  const hole = start.blank;
  const saidBefore = await runJS(`document.getElementById('hintline').textContent`);
  await tapCellAt(cdp, sessionId, hole);
  const afterHole = await runJS(`(() => { const g = window.slide15; return { moves: g.state.moves, said: document.getElementById('hintline').textContent }; })()`);
  rec('pressing the hole does nothing at all', afterHole.moves === 0 && afterHole.said === saidBefore, { hole, after: afterHole });

  // A legal click: billed once, and visible.
  const first = start.path[0];
  await tapCellAt(cdp, sessionId, first);
  await waitSettled();
  const after1 = await runJS(`(() => { const g = window.slide15; return {
    moves: g.state.moves, arr: g.stateArray().join(''), blank: g.blankCell(), px: g.pixels(), said: document.getElementById('hintline').textContent,
  }; })()`);
  const movedArr = start.arr.slice();
  { // the same slide, computed here rather than asked of the app
    const b = start.blank; const t = movedArr[first]; movedArr[b] = t; movedArr[first] = 0;
  }
  rec('a legal click on cell ' + first + ' is billed as one slide', after1.moves === 1, { moves: after1.moves });
  rec('and it moved exactly that tile into the hole', after1.arr === movedArr.join('') && after1.blank === first,
    { want: movedArr.join(''), got: after1.arr, blank: after1.blank });
  rec('the panel narrates the tile it just moved', new RegExp('推了 <b>' + start.arr[first] + '</b>').test((await runJS(`document.getElementById('hintline').innerHTML`))), after1.said);
  rec('a legal click changes the picture', after1.px !== start.px, { before: start.px, after: after1.px });

  // 撤销, clicked for real, returns both the count and the pixels.
  await clickButton(cdp, sessionId, 'undo');
  await waitSettled();
  const undone = await runJS(`(() => { const g = window.slide15; return { moves: g.state.moves, arr: g.stateArray().join(''), px: g.pixels() }; })()`);
  rec('undo takes the slide back and the picture back with it',
    undone.moves === 0 && undone.arr === start.arr.join('') && undone.px === start.px, undone);

  // A drag buys the same slide a tap buys, but at a different moment: js/view.js commits as soon
  // as the finger has travelled 0.34 of a cell toward the hole, and a press-release that never
  // gets there falls through to up() and is billed as the click it was — exactly one slide, not
  // two. So what the short push has to prove is the single billing, not a zero.
  const slideOf = (arr, cell, blank) => { const a = arr.slice(); const t = a[cell]; a[blank] = t; a[cell] = 0; return a.join(''); };
  const dragCellIndex = await runJS(`(() => { const g = window.slide15; return g.legalTaps()[0]; })()`);
  const vec = await runJS(`(() => { const g = window.slide15; const p = g.cellPoint(${dragCellIndex}); const q = g.cellPoint(g.blankCell());
    return { dx: Math.sign(q.box.x - p.box.x), dy: Math.sign(q.box.y - p.box.y), size: p.size }; })()`);
  const shortBy = Math.round(vec.size * 0.2);
  await dragCell(cdp, sessionId, dragCellIndex, vec.dx * shortBy, vec.dy * shortBy, 3, 20);
  const shortDrag = await runJS(`(() => { const g = window.slide15; return { moves: g.state.moves, arr: g.stateArray().join('') }; })()`);
  rec('a push that never reaches a third of a cell is billed once, as the click it is',
    shortDrag.moves === 1 && shortDrag.arr === slideOf(start.arr, dragCellIndex, start.blank),
    { pushed: shortBy, threshold: Math.round(vec.size * 0.34), moves: shortDrag.moves });

  // Back to the start board first: after that slide the cell the finger was on *is* the hole, so
  // a second push at the same coordinates would really be a press on the blank and would bill
  // nothing — which is exactly how the row below once passed while testing nothing.
  await clickButton(cdp, sessionId, 'restart');
  await sleep(150);
  const fresh = await runJS(`(() => { const g = window.slide15; const c = g.legalTaps()[0]; const b = g.blankCell(); const p = g.cellPoint(c); const q = g.cellPoint(b);
    return { cell: c, blank: b, arr: g.stateArray(), moves: g.state.moves, size: p.size,
      dx: Math.sign(q.box.x - p.box.x), dy: Math.sign(q.box.y - p.box.y) }; })()`);
  const farBy = Math.round(fresh.size * 0.62);
  await dragCell(cdp, sessionId, fresh.cell, fresh.dx * farBy, fresh.dy * farBy, 8, 24);
  await waitSettled();
  const afterDrag = await runJS(`(() => { const g = window.slide15; return { moves: g.state.moves, arr: g.stateArray().join(''), blank: g.blankCell() }; })()`);
  rec('a drag past a third of a cell is exactly one slide',
    afterDrag.moves === 1 && fresh.moves === 0 && fresh.arr.join('') === start.arr.join(''),
    { moves: afterDrag.moves, atStart: fresh.moves, pushed: farBy, threshold: Math.round(fresh.size * 0.34) });
  rec('and it slid the tile the finger pushed',
    afterDrag.arr === slideOf(fresh.arr, fresh.cell, fresh.blank) && afterDrag.blank === fresh.cell,
    { want: slideOf(fresh.arr, fresh.cell, fresh.blank), got: afterDrag.arr, blank: afterDrag.blank });
  // Dragging away from the hole is the player changing their mind.
  await clickButton(cdp, sessionId, 'restart');
  await sleep(150);
  const awayCell = await runJS(`(() => { const g = window.slide15; return g.legalTaps()[0]; })()`);
  const awayVec = await runJS(`(() => { const g = window.slide15; const p = g.cellPoint(${awayCell}); const q = g.cellPoint(g.blankCell());
    return { dx: Math.sign(q.box.x - p.box.x), dy: Math.sign(q.box.y - p.box.y), size: p.size }; })()`);
  await dragCell(cdp, sessionId, awayCell, -awayVec.dx * Math.round(awayVec.size * 0.7), -awayVec.dy * Math.round(awayVec.size * 0.7), 8, 24);
  await waitSettled();
  const afterAway = await runJS(`(() => { const g = window.slide15; return { moves: g.state.moves, arr: g.stateArray().join('') }; })()`);
  rec('pulling away from the hole slides nothing', afterAway.moves === 0 && afterAway.arr === start.arr.join(''), afterAway);

  // A point outside the tray is not a point on a tile: no move, and no refusal message.
  const miss = await runJS(`(() => {
    const g = window.slide15; const box = document.getElementById('board').getBoundingClientRect(); const geom = g.geometry();
    const cands = [[box.left + 2, box.top + 2], [box.right - 2, box.top + 2], [box.left + 2, box.bottom - 2], [box.right - 2, box.bottom - 2]];
    const out = [];
    for (const [x, y] of cands) {
      if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
      if (g.pointAt(x, y) === -1) out.push({ x: Math.round(x), y: Math.round(y) });
    }
    return { pts: out, cell: geom.cell };
  })()`);
  if (!miss.pts.length) {
    rec('a press off the tray is ignored', false, 'no corner of the canvas maps to no cell');
  } else {
    const saidOff = await runJS(`document.getElementById('hintline').textContent`);
    for (const pt of miss.pts) {
      await mouseAt(cdp, sessionId, 'mousePressed', pt.x, pt.y, 1);
      await sleep(20);
      await mouseAt(cdp, sessionId, 'mouseReleased', pt.x, pt.y, 0);
    }
    await sleep(120);
    const afterOff = await runJS(`(() => { const g = window.slide15; return { moves: g.state.moves, said: document.getElementById('hintline').textContent }; })()`);
    rec('a press off the tray is ignored: no move and no refusal', afterOff.moves === 0 && afterOff.said === saidOff, { pts: miss.pts, after: afterOff });
  }

  // The whole certified route, tapped for real, on a board with seven slides in it.
  await runJS(`window.slide15.load('#/lot/kerb-05'); 'ok'`);
  await sleep(350);
  const five = await runJS(`(() => { const g = window.slide15; return { par: g.state.par, path: g.path(), arr: g.stateArray(), id: g.state.id }; })()`);
  let played = 0;
  const log = [];
  let broke = null;
  for (const c of five.path) {
    const p = await tapCellAt(cdp, sessionId, c, 22, 50);
    if (!p) { broke = 'cell ' + c + ' is off screen'; break; }
    const now = await runJS(`(() => { const g = window.slide15; return { moves: g.state.moves, done: g.state.done, par: g.state.par }; })()`);
    played++;
    log.push({ cell: c, ...now });
    if (now.moves !== played) { broke = 'tap ' + played + ' counted as ' + now.moves; break; }
  }
  rec('the mouse taps the whole certified route, one slide per tap', !broke && played === five.par && played === 7, { broke, log, par: five.par });
  await waitSettled();
  const end = await runJS(`(() => {
    const g = window.slide15;
    return {
      state: g.state, solved: g.stateArray().join(''),
      stars: document.getElementById('stars').textContent,
      verdict: document.getElementById('verdict').textContent,
      tally: document.getElementById('tally').textContent,
      curtain: !document.getElementById('curtain').hidden,
      record: g.store.record(g.state.id),
    };
  })()`);
  // The goal board of a 3x3 is 1..8 with the blank last (js/core/puzzle.js:22), and `solved`
  // above is stateArray().join(''), so it reads "123456780" — no commas. The old literal was
  // the source form of the array, which no join ever produces.
  rec('the board is the goal board and the run is won', end.state.done && end.state.moves === end.state.par && end.solved === '123456780', end.solved);
  rec('the win card goes up with three stars', end.curtain && end.stars === '★★★' && end.verdict === '分毫不差', { stars: end.stars, verdict: end.verdict, curtain: end.curtain });
  rec('the card prints the player count against the proved minimum', end.tally.indexOf('你的 ' + five.par + ' 滑') >= 0 && end.tally.indexOf('IDA* 最少 ' + five.par + ' 滑') >= 0, end.tally);
  rec('the run is on record at par', !!end.record && end.record.best === five.par && end.record.perfect === true, end.record);
  const refusedAfterWin = await runJS(`(() => { const g = window.slide15; const c = g.legalTaps()[0]; return { r: c === undefined ? null : g.tapCell(c), moves: g.state.moves }; })()`);
  rec('and a finished board refuses further presses', refusedAfterWin.r === false && refusedAfterWin.moves === five.par, refusedAfterWin);

  // 再来一次 and the keyboard, both for real.
  await clickButton(cdp, sessionId, 'again');
  await sleep(250);
  rec('再来一次 clears the card as well as the count', await runJS(`window.slide15.state.moves === 0 && document.getElementById('curtain').hidden`), await runJS('window.slide15.state'));
  await keyDown('u'); await keyUp('u'); await sleep(200);
  rec('the u key is wired (nothing to undo at zero, and it says so)', (await runJS('window.slide15.state.moves')) === 0, await runJS('window.slide15.state.moves'));
  await keyDown('h'); await keyUp('h'); await sleep(320);
  const hintLine = await runJS(`(() => { const g = window.slide15; return { hints: g.state.hints, said: document.getElementById('hintline').textContent }; })()`);
  rec('the h key asks for a hint and gets one', hintLine.hints === 1 && /提示：把 \d+ 号块/.test(hintLine.said), hintLine);
  await keyDown('r'); await keyUp('r'); await sleep(200);
  rec('the r key restarts', (await runJS('window.slide15.state.moves')) === 0, await runJS('window.slide15.state.moves'));
  // Arrow keys name the direction a tile travels, so the cell that moves is the one on the
  // far side of the hole — computed here from the model, then checked against the picture.
  const want = await runJS(`(() => { const g = window.slide15; const n = g.state.n; const b = g.blankCell();
    const cands = { ArrowUp: b + n, ArrowDown: b - n, ArrowLeft: (Math.floor((b + 1) / n) === Math.floor(b / n) ? b + 1 : -1), ArrowRight: (Math.floor((b - 1) / n) === Math.floor(b / n) ? b - 1 : -1) };
    const out = {}; for (const k in cands) { const c = cands[k]; out[k] = (c >= 0 && c < n * n && g.stateArray()[c] !== 0) ? c : -1; }
    return out; })()`);
  const arrowName = Object.keys(want).find((k) => want[k] >= 0);
  if (!arrowName) {
    rec('an arrow key slides a tile', false, 'no direction is available from this hole position');
  } else {
    const vk = ARROW_VK[arrowName];
    const beforeArrow = await runJS(`(() => { const g = window.slide15; return { arr: g.stateArray(), blank: g.blankCell(), moves: g.state.moves }; })()`);
    const tile = beforeArrow.arr[want[arrowName]];
    await keyDown(arrowName, arrowName, vk); await keyUp(arrowName, arrowName, vk);
    await sleep(200);
    const afterArrow = await runJS(`(() => { const g = window.slide15; return { moves: g.state.moves, arr: g.stateArray(), blank: g.blankCell() }; })()`);
    const expect = beforeArrow.arr.slice();
    expect[beforeArrow.blank] = tile;
    expect[want[arrowName]] = 0;
    rec('an arrow key slides the tile on the far side of the hole, exactly once',
      afterArrow.moves === 1 && afterArrow.arr.join('') === expect.join('') && afterArrow.blank === want[arrowName],
      { key: arrowName, cell: want[arrowName], tile, want: expect.join(''), got: afterArrow.arr.join('') });
    await keyDown('r'); await keyUp('r'); await sleep(160);
  }
  await keyDown('d'); await keyUp('d'); await sleep(700);
  const demoing = await runJS(`(() => { const g = window.slide15; return { on: g.state.demo, moves: g.state.moves }; })()`);
  rec('the d key runs the solver on screen', demoing.on && demoing.moves >= 2, demoing);
  await keyDown('d'); await keyUp('d'); await sleep(200);
  rec('and stops it again', (await runJS('window.slide15.state.demo')) === false, await runJS('window.slide15.state.demo'));

  // A real click on 分享 must not navigate anywhere: the route the player is on is the thing
  // being shared. Which of its two messages the button shows is decided by the clipboard, not by
  // the game (js/main.js:299-312), so both branches are forced from here rather than left to
  // whatever headless Chrome happens to allow. The toast self-hides after 1800ms, so every
  // probe waits it out first; reading 160ms after the press is reading *this* press.
  const readToast = () => runJS(`(() => { const t = document.getElementById('toast'); return { hidden: t.hidden, text: t.textContent }; })()`);
  const armToast = async () => { await sleep(1900); await runJS(`(() => { const t = document.getElementById('toast'); t.hidden = true; t.textContent = ''; return 1; })()`); };
  const stubClipboard = (body) => runJS(`(() => { if (!window.__realWrite) window.__realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, 'writeText', { value: ${body}, configurable: true, writable: true }); return 1; })()`);

  // An inert button and a covered one fail the next row in the same way; only a hit box says
  // which happened, and 分享 sits in the tray where a stale win card used to be able to reach it.
  const shareBox = await runJS(`(() => { const b = document.getElementById('share'); const r = b.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { hit: !!t && (t === b || b.contains(t)), id: t && t.id, tag: t && t.tagName }; })()`);
  rec('the mouse lands on the 分享 button itself', shareBox.hit === true, shareBox);

  const beforeShare = await runJS(`(() => { const g = window.slide15; return { hash: location.hash, moves: g.state.moves }; })()`);
  await armToast();
  await clickButton(cdp, sessionId, 'share');
  await sleep(160);
  const afterShare = await runJS(`(() => { const g = window.slide15; return { hash: location.hash, moves: g.state.moves }; })()`);
  const shared = await readToast();
  rec('分享 leaves the board and the route exactly as they were',
    afterShare.hash === beforeShare.hash && afterShare.moves === beforeShare.moves, { before: beforeShare, after: afterShare });
  rec('and the press answers on screen', shared.hidden === false && shared.text.length > 0, shared);

  await stubClipboard("() => Promise.reject(new Error('gate: the clipboard says no'))");
  await armToast();
  await clickButton(cdp, sessionId, 'share');
  await sleep(160);
  const refused = await runJS(`(() => { const t = document.getElementById('toast'); const id = t.textContent.match(/#\\/lot\\/(.+)$/);
    const lot = id && window.slide15.lots().find((l) => l.id === id[1]) || null;
    return { hidden: t.hidden, text: t.textContent, lot, on: window.slide15.state.id }; })()`);
  rec('a refused clipboard still puts the link on the screen, never a silent failure',
    refused.hidden === false && /^https?:\/\/.+\/#\/lot\/[\w-]+$/.test(refused.text), { hidden: refused.hidden, text: refused.text });
  rec('and the link it builds names the board on screen', !!refused.lot && refused.lot.id === refused.on,
    { link: refused.text, names: refused.lot && refused.lot.id, onScreen: refused.on });

  await stubClipboard("() => Promise.resolve()");
  await armToast();
  await clickButton(cdp, sessionId, 'share');
  await sleep(160);
  const copied = await readToast();
  rec('an accepted clipboard says 链接已复制 instead of showing a url nobody asked for',
    copied.hidden === false && copied.text === '链接已复制', copied);
  await stubClipboard('window.__realWrite');

  return { rows };
}

// In-page suites. Each returns { rows: [{ test, pass, detail }] }.
const PRELUDE = `
    const g = window.slide15;
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const waitSettled = async (budget) => { const end = Date.now() + (budget || 2500); while (!g.settled() && Date.now() < end) await sleep(25); return g.settled(); };
    // An independent re-derivation of the rule, in the *test*: it walks a board from a baked
    // route and says whether every step was legal and where it ends, without asking js/core.
    const walk = (state, path) => {
      const arr = state.slice(); const n = Math.round(Math.sqrt(arr.length)); const bad = [];
      for (const pos of path) {
        const b = arr.indexOf(0);
        const adj = (Math.floor(b / n) === Math.floor(pos / n) && Math.abs(b - pos) === 1) || (b % n === pos % n && Math.abs(b - pos) === n);
        if (!adj || arr[pos] === 0) { bad.push(pos); break; }
        arr[b] = arr[pos]; arr[pos] = 0;
      }
      const goal = []; for (let i = 1; i < n * n; i++) goal.push(i); goal.push(0);
      return { bad, arr, solved: arr.join(',') === goal.join(',') };
    };
`;

const SCENARIOS = {
  boot: `(async () => {${PRELUDE}
    rec('the shell boots straight into a board', g && g.version === 1 && g.state.mode === 'campaign' && g.state.id === 'kerb-01', g && g.state);
    rec('the board is the 3x3 its row claims', g.state.n === 3 && g.stateArray().length === 9 && g.level().n === 3, { n: g.state.n });
    const c = D('board');
    rec('the canvas has real pixels', c.width > 0 && c.height > 0 && !!c.getContext('2d'), { w: c.width, h: c.height });
    // A canvas whose CSS was never applied is still the 300x150 box the HTML spec hands out, and
    // the game would draw a 15-puzzle into a strip nobody designed. The screenshot catches that
    // by eye; this line is the same check inside the gate.
    const box = c.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    rec('the canvas is laid out, not the unstyled 300x150 default',
      box.width > 300 && box.height > 300
        && Math.abs(c.width - box.width * dpr) <= dpr + 1 && Math.abs(c.height - box.height * dpr) <= dpr + 1,
      { css: [Math.round(box.width), Math.round(box.height)], backing: [c.width, c.height], dpr });
    rec('the board was actually painted', g.painted() > 50 && g.pixels() > 0, { litSamples: g.painted() });
    const geom = g.geometry();
    rec('the tray is square and inside the canvas', geom.n === 3 && geom.cell * 3 === geom.size && geom.size <= Math.min(box.width, box.height), geom);
    const badMap = [];
    for (let cell = 0; cell < 9; cell++) {
      const p = g.cellPoint(cell);
      if (!p || p.tile !== g.stateArray()[cell]) { badMap.push(['tile mismatch', cell]); continue; }
      if (p.tile !== 0 && g.pointAt(p.x, p.y) !== cell) badMap.push(['hit test missed', cell]);
    }
    rec('every drawn tile is where the model says it is, and reverse-maps to its own cell', badMap.length === 0, badMap);
    const legal = g.legalTaps();
    rec('the legal presses are the hole neighbours and never the hole',
      legal.length >= 2 && legal.length <= 4 && !legal.includes(g.blankCell())
        && legal.every((p) => { const b = g.blankCell(); const n = 3; return (b % n === p % n && Math.abs(b - p) === n) || (Math.floor(b / n) === Math.floor(p / n) && Math.abs(b - p) === 1); }),
      { legal, blank: g.blankCell() });
    const pool = g.pool;
    rec('the shipped pool loaded', pool && pool.lots >= 40, pool && pool.lots);
    rec('every band reports a measured range', Object.values(pool.byBand).every((s) => s.count > 0 && s.min <= s.max && s.med >= s.min && s.med <= s.max && s.nodesMax > 0), pool.byBand);
    rec('both board widths shipped', Object.values(pool.byBand).some((s) => s.n === 3) && Object.values(pool.byBand).some((s) => s.n === 4), Object.values(pool.byBand).map((s) => s.n + ':' + s.count));
    const mp = g.measurePar();
    rec("the browser's own IDA* agrees with the printed par", mp.agrees && mp.moves === g.state.par && mp.replays && !mp.truncated, mp);
    const fx = g.solveState([8, 7, 6, 5, 4, 3, 2, 1, 0]);
    rec('the hand-checked 8 7 6 / 5 4 3 / 2 1 _ board costs exactly 30 slides here too', fx.ok && fx.moves === 30 && fx.path.length === 30 && !fx.truncated, { moves: fx.moves, nodes: fx.nodes });
    const uns = g.solveState([1, 2, 3, 4, 5, 6, 8, 7, 0]);
    rec('the classic one-swap board is refused as unsolvable, not searched to death',
      uns.ok === false && uns.reason === 'unsolvable' && uns.moves === -1 && uns.truncated === false && uns.nodes === 0, uns);
    const gr = await g.graph();
    rec('the whole 3x3 space is 181,440 = 9!/2 reachable boards', gr.states === 181440 && gr.size === 362880 && gr.diameter === 31, gr.states);
    rec('the diameter is 31 and exactly two boards sit on it', gr.atDiameter === 2 && gr.histogram[31] === 2 && gr.histogram[30] === 221, { atDiameter: gr.atDiameter, hist: gr.histogram.slice(28) });
    rec('the distance histogram accounts for every reachable board', gr.histogram.reduce((a, b) => a + b, 0) === gr.states && gr.histogram[0] === 1, gr.histogram.length);
    const lots3 = g.lots().filter((l) => l.n === 3);
    const mismatch = [];
    for (const l of lots3) {
      const s = g.solveState(l.state);
      const d = await g.bfsDistance(l.state);
      if (!s.ok || s.moves !== l.par || d !== l.par) mismatch.push([l.id, l.par, s.moves, d]);
    }
    rec('IDA*, the exhaustive BFS table and the baked par agree on all ' + lots3.length + ' 3x3 boards', mismatch.length === 0 && lots3.length === 32, mismatch);
    rec('every baked route is exactly par slides long and ends solved',
      g.lots().every((l) => { const w = walk(l.state, l.path); return l.path.length === l.par && w.bad.length === 0 && w.solved; }),
      g.lots().filter((l) => { const w = walk(l.state, l.path); return !(l.path.length === l.par && w.bad.length === 0 && w.solved); }).map((l) => l.id));
    const readout = D('readout').textContent;
    rec('the panel prints slides, the proved minimum and the record', /已滑/.test(readout) && /最少/.test(readout) && /最佳/.test(readout), readout);
    rec('this browser can persist a save file', g.state.persistent === true, { persistent: g.state.persistent });
    return { rows };
  })()`,

  play: `(async () => {${PRELUDE}
    g.store.reset();
    g.load('#/c/2'); await sleep(160);
    const par = g.state.par;
    const path = g.path();
    const startArr = g.stateArray();
    rec('第 2 关 is the baked kerb-02 with a par of 4', g.state.id === 'kerb-02' && g.state.band === 'kerb' && par === 4 && path.length === par, { id: g.state.id, par });
    const w = walk(startArr, path);
    rec('every step of the baked route is legal and it ends on the goal board', w.bad.length === 0 && w.solved, w.arr.join(''));
    const mp2 = g.measurePar();
    rec('the route is legal in the app too: re-solving it from the start returns par', mp2.agrees && mp2.moves === par && mp2.replays, mp2);
    const legal = g.legalTaps();
    const farCells = [];
    for (let c = 0; c < 9; c++) if (!legal.includes(c) && startArr[c] !== 0) farCells.push(c);
    const refused = farCells.map((c) => g.tapCell(c));
    rec('the shell refuses every press that is not touching the hole', refused.length >= 3 && refused.every((r) => r === false), { farCells, refused });
    rec('and refuses them without billing anything', g.state.moves === 0 && g.history().length === 0 && g.stateArray().join('') === startArr.join(''), g.state);
    rec('pressing the hole is refused as well', g.tapCell(g.blankCell()) === false && g.state.moves === 0, g.blankCell());
    const b0 = g.blankCell();
    const step = g.legalTaps()[0];
    g.tapCell(step);
    const mid = { moves: g.state.moves, blank: g.blankCell() };
    g.tapCell(b0);
    const back = { moves: g.state.moves, arr: g.stateArray().join(''), over: g.state.over };
    rec('a there-and-back costs two slides and returns the board', mid.moves === 1 && mid.blank === step && back.moves === 2 && back.arr === startArr.join(''), { mid, back });
    // Two slides on a par-4 board is two *under* the minimum, and the panel's 超 field is
    // Math.max(0, moves - par) (js/main.js:125-127), so the honest number here is the clamp at
    // zero, not 2. The "two over" claim belongs one row down, where 6 slides really do pass par.
    rec('and it leaves the over-count clamped at zero with the tiles back where they were',
      back.over === 0 && g.state.home === startArr.filter((v, i) => v !== 0 && v === i + 1).length, { over: back.over, home: g.state.home });
    g.play(path); await sleep(160);
    rec('over par still finishes: two stars and 干净归位, two slides past the minimum',
      g.state.done && g.state.moves === 6 && g.state.over === g.state.moves - g.state.par && g.state.over === 2
      && D('stars').textContent === '★★☆' && D('verdict').textContent === '干净归位',
      { moves: g.state.moves, par: g.state.par, over: g.state.over, stars: D('stars').textContent, verdict: D('verdict').textContent });
    rec('the win card offers the next level', !D('curtain').hidden && !D('next').hidden, { nextHidden: D('next').hidden });
    const sloppy = g.store.record('kerb-02');
    rec('a run over par is a solve without the perfect flag', sloppy.best === 6 && sloppy.perfect === false, sloppy);
    D('next').click(); await sleep(180);
    rec('下一关 advances the campaign', g.state.index === 3 && g.state.moves === 0 && g.state.id === 'kerb-03', g.state);
    g.load('#/c/2'); await sleep(160);
    g.play(g.path()); await sleep(160);
    const clean = g.store.record('kerb-02');
    rec('matching par later takes the record down and earns the flag', clean.best === 4 && clean.perfect === true && clean.plays === 2, clean);
    g.load('#/c/2'); await sleep(160);
    const h = g.hintOnce();
    rec('the hint names the first slide of the certified route', h.hints === 1 && h.cell === path[0] && h.left === par - 1, h);
    rec('and says it as a tile and a direction', /提示：把 \\d+ 号块向[上下左右]推进空格/.test(h.line), h.line);
    rec('the hinted cell is one the picture marks as live', !!g.cellPoint(h.cell) && g.cellPoint(h.cell).live, { cell: h.cell, live: g.legalTaps() });
    g.load('#/lot/abyss-08'); await sleep(200);
    const h2 = g.hintOnce();
    rec('the hardest 3x3 band still answers a hint inside the on-page budget', h2.cell >= 0 && g.state.par === 28 && h2.left === 27, { h2, par: g.state.par });
    g.load('#/lot/siege-08'); await sleep(200);
    const mp4 = g.measurePar();
    rec('the deepest 4x4 re-measures to its printed par in the browser', mp4.agrees && mp4.moves === 45 && !mp4.truncated, mp4);
    const arr4 = g.stateArray();
    const home4 = arr4.filter((v, i) => v !== 0 && v === i + 1).length;
    rec('and the 4x4 really is drawn 4 cells wide, with the panel counting tiles home',
      g.geometry().n === 4 && arr4.length === 16 && g.state.home === home4 && home4 < 15, { geom: g.geometry(), home: g.state.home, home4 });
    g.load('#/c/2'); await sleep(160);
    const on = g.demoStart(); await sleep(1700);
    rec('the demo walks an IDA* route to par', on && g.state.done && g.state.moves === 4 && g.state.over === 0, g.state);
    g.reset(); await sleep(150);
    g.demoStart(); await sleep(520);
    const stopped = g.demoStop(); await sleep(250);
    rec('stopping it mid-route leaves a plain game, not a finished one', stopped && !g.state.demo && g.state.moves > 0 && !g.state.done, g.state);
    g.reset(); await sleep(150);
    rec('重开 clears the count, the card and the hints', g.state.moves === 0 && g.state.hints === 0 && D('curtain').hidden && g.history().length === 0, g.state);
    rec('the undo button is disabled at zero slides', D('undo').disabled === true, D('undo').disabled);
    g.play(g.path().slice(0, 2));
    const u = g.undoOnce();
    rec('undo takes back exactly one slide', u === 1 && g.state.moves === 1 && D('undo').disabled === false, { u, moves: g.state.moves });
    g.undoOnce();
    rec('and stops at the start line instead of going negative', g.state.moves === 0 && D('undo').disabled === true, g.state);
    return { rows };
  })()`,

  routes: `(async () => {${PRELUDE}
    g.store.reset();
    g.load('#/c/12'); await sleep(160);
    rec('#/c/12 is the twelfth baked board, in the 熟盘 band', g.state.index === 12 && g.state.band === 'cross' && g.state.mode === 'campaign', g.state);
    g.load('#/c/99999'); await sleep(160);
    rec('a huge index clamps to the last board', g.state.index === g.pool.lots && g.state.par === 45 && g.state.band === 'siege', { index: g.state.index, lots: g.pool.lots });
    g.load('#/c/0'); await sleep(160);
    rec('index zero clamps up to one', g.state.index === 1 && g.state.id === 'kerb-01', g.state.id);
    g.load('#/c/33'); await sleep(160);
    rec('the 4x4 half of the campaign opens at board 33', g.state.index === 33 && g.state.band === 'field' && g.state.n === 4 && g.pool.byBand.field.min <= g.state.par && g.state.par <= g.pool.byBand.field.max, g.state);
    g.load('#/daily'); await sleep(180);
    const dailyId = g.state.id;
    const dayLabel = g.state.label.split(' · ')[1];
    g.load('#/c/1'); await sleep(160);
    g.load('#/daily'); await sleep(160);
    rec('the daily route is the same board twice', g.state.mode === 'daily' && g.state.id === dailyId, { first: dailyId, again: g.state.id });
    rec('the daily label carries the calendar day', /^每日盘面 · \\d{4}-\\d{2}-\\d{2}$/.test(g.state.label), g.state.label);
    rec('and the panel names the seed that day drew', /hashSeed\\("\\d{4}-\\d{2}-\\d{2}"\\)/.test(D('crumbs').textContent), D('crumbs').textContent);
    rec('and it is exactly what the seed of that day names', g.daily(dayLabel) && g.daily(dayLabel).id === g.state.id, { dayLabel, want: g.daily(dayLabel) && g.daily(dayLabel).id });
    rec('hashSeed of a fixed date names a fixed board here and on any device', g.daily('2026-09-27').id === 'kerb-03' && g.daily('2026-09-27').par === 4, g.daily('2026-09-27'));
    rec('a different day is a different draw', g.daily('2026-09-28').id !== g.daily('2026-09-27').id || g.daily('2026-09-28').par !== g.daily('2026-09-27').par, { a: g.daily('2026-09-27'), b: g.daily('2026-09-28') });
    const seenBand = [];
    for (const band of g.bands) {
      g.load('#/random/' + band.key + '/fixedseed'); await sleep(150);
      const first = { id: g.state.id, par: g.state.par, band: g.state.band };
      g.load('#/c/1'); await sleep(150);
      g.load('#/random/' + band.key + '/fixedseed'); await sleep(150);
      const named = g.randomOf(band.key, 'fixedseed');
      rec('#/random/' + band.key + ' stays in its band and repeats itself',
        first.band === band.key && g.state.id === first.id && named.id === first.id && g.state.par >= band.min && g.state.par <= band.max,
        { band: [band.min, band.max], got: first, again: { id: g.state.id, par: g.state.par } });
      seenBand.push(first.par);
    }
    rec('the same token in the easy band and the hard band gives two difficulties', seenBand[0] <= 8 && seenBand[3] >= 25, seenBand);
    g.load('#/random'); await sleep(340);
    rec('a bare #/random mints a token into the URL', /^#\\/random\\/[a-z]+\\/[a-z0-9]+$/.test(location.hash), location.hash);
    g.load('#/c/5'); await sleep(160);
    const sample = g.state.id;
    g.load('#/c/1'); await sleep(160);
    g.load('#/lot/' + sample); await sleep(160);
    rec('#/lot/<id> opens that board', g.state.id === sample && g.state.mode === 'lot', { want: sample, got: g.state.id });
    g.load('#/lot/siege-08'); await sleep(180);
    rec('the deepest baked 4x4 is shareable at par 45', g.state.id === 'siege-08' && g.state.par === 45 && g.state.n === 4, g.state);
    g.load('#/lot/not-a-real-board'); await sleep(180);
    rec('an unknown id falls back instead of blanking the board', !!g.state.id && g.state.mode === 'lot' && g.state.n >= 3 && g.state.par >= 1, g.state);
    g.load('#/nonsense'); await sleep(160);
    rec('an unparseable route still deals a board', g.state.mode === 'campaign' && g.state.index === 1, g.state);
    g.load('#/c/3'); await sleep(160);
    g.tapCell(g.legalTaps()[0]);
    g.load('#/c/4'); await sleep(160);
    rec('a route change resets the slide count', g.state.moves === 0 && g.history().length === 0 && !g.state.done, g.state);
    const nav = D('modes');
    nav.querySelector('button[data-mode="daily"]').click(); await sleep(180);
    rec('the header routes through the same hashes a link would use', g.state.mode === 'daily' && /#\\/daily$/.test(location.hash), { mode: g.state.mode, hash: location.hash });
    nav.querySelector('button[data-mode="random"]').click(); await sleep(300);
    rec('and lands in the random band with a minted token', g.state.mode === 'random' && /^#\\/random\\/[a-z]+\\/[a-z0-9]+$/.test(location.hash), location.hash);
    nav.querySelector('button[data-mode="campaign"]').click(); await sleep(200);
    rec('back to the campaign at the unlocked board', g.state.mode === 'campaign' && g.state.index === g.state.unlocked, g.state);
    return { rows };
  })()`,

  save: `(async () => {${PRELUDE}
    const KEY = 'slide15.save.v1';
    g.load('#/c/1'); await sleep(160);
    g.play(g.path()); await sleep(180);
    const had = Object.keys(g.store.records).length;
    rec('a solve is on record before the wipe is tried', had >= 1 && g.store.record('kerb-01').best === 4, { had, rec: g.store.record('kerb-01') });
    D('wipe').click(); await sleep(100);
    rec('the first click only arms it', Object.keys(g.store.records).length === had && !D('toast').hidden && /清空/.test(D('toast').textContent),
      { records: Object.keys(g.store.records).length, toast: D('toast').textContent });
    D('wipe').click(); await sleep(280);
    rec('清空存档 takes two clicks and clears everything',
      Object.keys(g.store.records).length === 0 && g.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { records: Object.keys(g.store.records), unlocked: g.store.unlocked, raw: localStorage.getItem(KEY) });
    // NOTE: innerHTML, not textContent — this assertion is about the tally being rendered inside
    // its emphasis element, and textContent has no markup in it by definition.
    rec('and the shell re-renders as a clean device', /已通 <b>0<\\/b>/.test(D('totals').innerHTML), D('totals').innerHTML);
    g.load('#/c/1'); await sleep(160);
    g.play(g.path()); await sleep(180);
    const raw = JSON.parse(localStorage.getItem(KEY));
    rec('the solve reaches localStorage, not only memory', !!(raw && raw.records['kerb-01'] && raw.records['kerb-01'].best === 4), raw && Object.keys(raw.records || {}));
    rec('clearing the first board unlocks the second', g.store.unlocked === 2 && raw.unlocked === 2, { unlocked: g.store.unlocked });
    rec('the record is flagged perfect at the measured minimum', raw.records['kerb-01'].perfect === true && raw.records['kerb-01'].plays === 1, raw.records['kerb-01']);
    rec('the aggregate counters move with it', raw.stats.solves === 1 && raw.stats.perfect === 1 && raw.stats.slides >= 4, raw.stats);
    const shelf2 = document.querySelector("#shelf button[data-index='2']");
    rec('the shelf lets board two be clicked', !!shelf2 && !shelf2.disabled, shelf2 && shelf2.outerHTML);
    const shelf3 = document.querySelector("#shelf button[data-index='3']");
    rec('and keeps board three locked', !!shelf3 && shelf3.disabled, shelf3 && shelf3.outerHTML);
    g.load('#/c/1'); await sleep(160);
    rec('the panel prints the record it just read back', /<div class="best"><dt>最佳<\\/dt><dd>4<\\/dd>/.test(D('readout').innerHTML), D('readout').innerHTML.slice(0, 420));
    rec('and marks the board as done in its own list', /perfect/.test((document.querySelector("#shelf button[data-index='1']") || {}).className || ''), (document.querySelector("#shelf button[data-index='1']") || {}).className);
    g.load('#/daily'); await sleep(180);
    const day = g.state.label.split(' · ')[1];
    g.play(g.path()); await sleep(180);
    const mark = g.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.id === g.state.id, { day, mark });
    rec('the shelf says today is done', /已复原/.test(D('shelf').textContent), D('shelf').textContent);
    const nRec = Object.keys(g.store.records).length;
    rec('the header tally counts every distinct solve', D('totals').textContent.indexOf('已通 ' + nRec + '/') === 0 && /累计滑动/.test(D('totals').textContent), D('totals').textContent);
    g.load('#/c/1'); await sleep(160);
    const statsBefore = JSON.parse(localStorage.getItem(KEY)).stats;
    g.play(g.path()); await sleep(180);
    const stats2 = JSON.parse(localStorage.getItem(KEY)).stats;
    const rec2 = g.store.record('kerb-01');
    rec('a second run at par keeps the better record and counts the plays', rec2.best === 4 && rec2.plays === 2 && rec2.perfect === true, rec2);
    rec('the aggregate counters add exactly what this run spent',
      stats2.slides - statsBefore.slides === 4 && stats2.solves === statsBefore.solves + 1 && stats2.perfect === statsBefore.perfect + 1,
      { statsBefore, stats2 });
    return { rows };
  })()`,

  // Run after @save in its own process, so `eval` (without nonav) has really reloaded the page:
  // this is the only suite that can tell a warm module cache from a save on disk.
  reloaded: `(async () => {${PRELUDE}
    rec('a fresh page reads its progress off disk', g.store.unlocked === 2, { unlocked: g.store.unlocked, records: Object.keys(g.store.records) });
    const r1 = g.store.record('kerb-01');
    rec("and the first board's record came back", !!r1 && r1.solved === true && r1.best === 4 && r1.perfect === true, r1);
    g.load('#/c/1'); await sleep(200);
    rec('the shelf shows it as already done', /perfect|done/.test((document.querySelector("#shelf button[data-index='1']") || {}).className || ''), (document.querySelector("#shelf button[data-index='1']") || {}).className);
    rec('the header counts the recovered solves', D('totals').textContent.indexOf('已通 ' + Object.keys(g.store.records).length + '/') === 0, D('totals').textContent);
    g.load('#/daily'); await sleep(200);
    const day = g.state.label.split(' · ')[1];
    rec('the daily slot is remembered across the reload', g.store.dailyDone(day) !== null, { day, mark: g.store.dailyDone(day) });
    rec('a reloaded board starts at zero slides with the baked par', g.state.moves === 0 && g.state.par === g.level().par && !g.state.done, { moves: g.state.moves, par: g.state.par });
    g.store.reset();
    rec('and a reset leaves nothing on disk for the next visitor', localStorage.getItem('slide15.save.v1') === null, localStorage.getItem('slide15.save.v1'));
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
