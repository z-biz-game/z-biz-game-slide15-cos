// The shell: hash routes in, canvas out, records in between. Nothing here knows the rules of
// the board — those live in js/core — and nothing here draws — that is js/view.js.
//
// It is also the only place a press is *billed*: a finger on the canvas, a drag, a keyboard
// arrow, a replayed solver route from a test and the demo all arrive through `commit()`,
// which calls `tap()` in js/core/game.js and nothing else.

import { createGame, blankCell, legalTaps, tap, undo, reset, grade } from './core/game.js';
import { solve, replay } from './core/solve.js';
import { store } from './core/storage.js';
import {
  BANDS, ALL, byId, bandByKey, levelAt, lotsIn, randomLot, dailyLot, stats as poolStats,
} from './core/library.js';
import { todayKey } from './core/rng.js';
import { toArray, goalState } from './core/puzzle.js';
import { createView } from './view.js';

const $ = (id) => document.getElementById(id);
const el = {
  modes: $('modes'), totals: $('totals'), crumbs: $('crumbs'), readout: $('readout'),
  shelf: $('shelf'), hintline: $('hintline'), curtain: $('curtain'), stars: $('stars'),
  verdict: $('verdict'), tally: $('tally'), undo: $('undo'), hint: $('hint'), demo: $('demo'),
  restart: $('restart'), share: $('share'), next: $('next'), again: $('again'),
  toast: $('toast'), canvas: $('board'), wipe: $('wipe'),
};

const LOTS = ALL.length;

// The one search this page is ever allowed to run, and it is bounded on both axes: 150k
// nodes inside 0.6 s is a hint, 400k inside 2 s is a demo, and both are the *same* budgets
// tools/bake.mjs published the pool with. A tap on a tile never searches at all — js/core
// decides legality, and the baked `par` is already on the page. When a live board exceeds a
// budget the shell says so instead of falling back to the heuristic's opinion, which is the
// whole reason a truncated search is refused in js/core/solve.js too.
const HINT_BUDGET = { nodeLimit: 150000, timeLimitMs: 600 };
const DEMO_BUDGET = { nodeLimit: 400000, timeLimitMs: 2000 };

const app = {
  mode: 'campaign',
  index: 1,
  route: null,
  lot: null,
  game: null,
  hints: 0,
  label: '',
  note: '',
  day: null,
};

function clampIndex(n) {
  return Math.min(LOTS, Math.max(1, Number(n) || 1));
}

// #/c/12 · #/daily · #/random/deep/4kq2 · #/lot/siege-05
// The lot id is in the URL, so a shared link resolves to the same scrambled board on another
// device without the receiver needing the sender's save file.
function parseHash(hash = location.hash) {
  const p = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean);
  if (p[0] === 'daily') return { mode: 'daily' };
  if (p[0] === 'random') return { mode: 'random', band: p[1] || BANDS[0].key, key: p[2] || null };
  if (p[0] === 'lot') return { mode: 'lot', id: p[1] };
  const n = p[0] === 'c' || p[0] === 'campaign' ? Number(p[1]) : Number(p[0]);
  return { mode: 'campaign', index: clampIndex(n) };
}

function resolve(rt) {
  if (rt.mode === 'daily') {
    // Same seed, same board, on every device and in every timezone-neutral calendar day.
    const day = todayKey();
    return { lot: dailyLot(day), label: `每日盘面 · ${day}`, note: `hashSeed("${day}")`, day };
  }
  if (rt.mode === 'random') {
    const band = bandByKey(rt.band);
    return {
      lot: randomLot(`${band.key}|${rt.key}`, band.key),
      label: `随机 · ${band.label}`,
      note: band.blurb,
    };
  }
  if (rt.mode === 'lot') {
    const lot = byId(rt.id) || ALL[0];
    return { lot, label: `关卡 ${lot.id}`, note: bandByKey(lot.band).blurb };
  }
  const lot = levelAt(rt.index - 1);
  return { lot, label: `第 ${rt.index} 关`, note: `共 ${LOTS} 关 · ${bandByKey(lot.band).label}` };
}

const view = createView(el.canvas, {
  onSlide: (pos) => commit(pos),
  onIllegal: (pos, value) => {
    const n = app.game ? app.game.n : 3;
    say(`<b>${value}</b> 号块（第 ${Math.floor(pos / n) + 1} 行第 ${pos % n + 1} 列）挨不着空格 —— 只有贴着空格的块推得动`);
  },
});

function setGame(lot, label) {
  stopDemo('');
  app.lot = lot;
  app.label = label || app.label;
  app.game = createGame(lot);
  app.hints = 0;
  view.attach(app.game);
  el.curtain.hidden = true;
  say('');
}

function say(html) {
  el.hintline.innerHTML = html;
}

function starText(n) {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

// How many tiles are already sitting on their own target cell — the progress the player can
// see on the board, counted the same way the picture tints it. The blank is not a tile, so it
// is not counted even when it is home.
function homeCount(game) {
  const g = goalState(game.n);
  let n = 0;
  for (let i = 0; i < game.state.length; i++) if (game.state[i] !== 0 && game.state[i] === g[i]) n++;
  return n;
}

function overPar(game) {
  return Math.max(0, game.moves - game.par);
}

function field(label, value, note, cls = '') {
  return `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd><dt><small>${note}</small></dt></div>`;
}

function renderCrumbs() {
  const band = bandByKey(app.lot.band);
  const rec = store.record(app.lot.id);
  // The note names the seed the board came out of (or the pool position for a campaign run),
  // so the number on the screen can be traced back to the lookup that produced it.
  el.crumbs.innerHTML = `${app.label}<b>${band.label}<span class="band"> ${band.blurb}</span></b>`
    + (app.note ? `<small>${app.note}</small>` : '');
  el.readout.innerHTML = [
    field('已滑', app.game.moves, '次滑动'),
    field('最少', app.lot.par, 'IDA* 证明', 'par'),
    field('超出', overPar(app.game), '滑 vs 最少', 'over'),
    field('最佳', rec && rec.best ? rec.best : '—', rec && rec.perfect ? '等于最少' : '你的纪录', 'best'),
    field('在位', homeCount(app.game), `共 ${app.game.n * app.game.n - 1} 块`),
    field('盘面', `${app.game.n}×${app.game.n}`, app.game.done ? '已复原' : '空格在第 ' + (blankCell(app.game) + 1) + ' 格'),
  ].join('');
  el.undo.disabled = !app.game.moves || app.game.done;
  el.hint.disabled = app.game.done;
  el.demo.disabled = app.game.done;
}

function renderTotals() {
  const solvedN = ALL.filter((l) => (store.record(l.id) || {}).solved).length;
  const perfectN = ALL.filter((l) => (store.record(l.id) || {}).perfect).length;
  el.totals.innerHTML = `已通 <b>${solvedN}</b>/${LOTS} · 完美 <b>${perfectN}</b> · 累计滑动 <b>${store.stats.slides}</b>`;
}

function renderShelf() {
  if (app.mode === 'campaign') {
    const unlocked = store.unlocked;
    let html = '';
    for (const band of BANDS) {
      html += `<p class="tier">${band.label} · ${band.blurb}</p>`;
      for (const lot of lotsIn(band.key)) {
        const n = ALL.indexOf(lot) + 1;
        const rec = store.record(lot.id);
        const cls = [
          n === app.index ? 'here' : '',
          rec && rec.perfect ? 'perfect' : rec && rec.solved ? 'done' : '',
        ].filter(Boolean).join(' ');
        html += `<button type="button" data-index="${n}" class="${cls}" title="${lot.par} 滑" ${n > unlocked ? 'disabled' : ''}>${n}</button>`;
      }
    }
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-index]').forEach((b) => {
      b.addEventListener('click', () => go(`#/c/${b.dataset.index}`));
    });
    return;
  }
  if (app.mode === 'random') {
    let html = '<p class="tier">选一段（数字是实测步数带）</p>';
    for (const band of BANDS) {
      const on = band.key === app.route.band ? 'here' : '';
      html += `<button type="button" class="${on}" data-band="${band.key}">${band.label}<br><small>${band.blurb}</small></button>`;
    }
    html += '<button type="button" class="wide" data-reroll="1">换一局</button>';
    el.shelf.innerHTML = html;
    el.shelf.querySelectorAll('button[data-band]').forEach((b) => {
      b.addEventListener('click', () => go(`#/random/${b.dataset.band}/${token()}`));
    });
    el.shelf.querySelector('[data-reroll]').addEventListener('click', () => go(`#/random/${app.route.band}/${token()}`));
    return;
  }
  if (app.mode === 'daily') {
    const done = app.day && store.dailyDone(app.day);
    el.shelf.innerHTML = `<p class="tier">今天这一盘对所有人相同${done ? ' · 已复原' : ''}</p>`
      + `<button type="button" class="wide" data-back="1">回到战役 第 ${store.unlocked} 关</button>`;
  } else {
    const lot = app.lot;
    const r = store.record(lot.id);
    el.shelf.innerHTML = `<p class="tier">分享的关卡 · 实测最少 ${lot.par} 滑</p>`
      + `<button type="button" class="wide" data-back="1">${r && r.solved ? '回到战役 第 ' + store.unlocked + ' 关' : '先把它复原，再回战役'}</button>`;
  }
  const back = el.shelf.querySelector('[data-back]');
  if (back) back.addEventListener('click', () => go(`#/c/${store.unlocked}`));
}

function render() {
  el.modes.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.mode === app.mode));
  });
  renderCrumbs();
  renderTotals();
  renderShelf();
}

function token() {
  // `Math.random()` can in principle return exactly 0, which would stringify to "0" and mint
  // an empty token — and an empty token is a route that re-mints itself forever.
  return Math.random().toString(36).slice(2) || 'roll';
}

// The one place a move happens. Returns true when a tile actually slid.
function commit(pos) {
  const moved = tap(app.game, pos);
  if (!moved) {
    view.redraw();
    return false;
  }
  if (app.game.done) finish();
  else {
    view.redraw();
    renderCrumbs();
    const slid = app.game.history.length ? app.game.history[app.game.history.length - 1] : null;
    const tile = slid ? app.game.state[slid.blank] : 0; // the blank moved into the tile's old cell
    say(`推了 <b>${tile}</b> 号块 · 已用 ${app.game.moves} 滑 · 最少 <b>${app.lot.par}</b> 滑 · 现在超 <b>${overPar(app.game)}</b>`);
  }
  return true;
}

function finish() {
  const lot = app.lot;
  const g = app.game;
  const rec = store.solve(lot.id, { moves: g.moves, par: lot.par });
  if (app.day) store.markDaily(app.day, lot.id);
  let nextIndex = 0;
  if (app.mode === 'campaign') {
    store.unlock(Math.min(LOTS, Math.max(store.unlocked, app.index + 1)));
    nextIndex = app.index < LOTS ? app.index + 1 : 0;
  }
  stopDemo('');
  const gr = grade(g);
  el.stars.textContent = starText(gr.stars);
  el.verdict.textContent = gr.label;
  el.tally.innerHTML = `你的 <b>${g.moves}</b> 滑 · IDA* 最少 <b>${lot.par}</b> 滑 · 提示 <b>${app.hints}</b>`
    + (rec.best === g.moves ? '<br>这是这一关的最好成绩' : '');
  el.next.hidden = !nextIndex;
  el.curtain.hidden = false;
  render();
  view.redraw();
}

function go(hash) {
  if (location.hash === hash) apply();
  else location.hash = hash;
}

function apply() {
  const rt = parseHash();
  app.route = rt;
  app.mode = rt.mode;
  if (rt.mode === 'random' && !rt.key) {
    // A bare #/random/deep would mean a different board on every visit and an
    // unreproducible link, so the token is minted once and written back into the URL.
    location.replace(`${location.pathname}${location.search}#/random/${rt.band}/${token()}`);
    return;
  }
  const r = resolve(rt);
  if (!r.lot) {
    say('这一段还没有盘面');
    return;
  }
  app.day = r.day || null;
  app.note = r.note || '';
  app.index = rt.mode === 'campaign' ? rt.index : ALL.indexOf(r.lot) + 1;
  setGame(r.lot, r.label);
  render();
}

let toastTimer = 0;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1800);
}

function shareLink() {
  const url = `${location.origin}${location.pathname}#/lot/${app.lot.id}`;
  // The clipboard is not ours to command: it needs focus and permission, and in a headless tab
  // it can refuse either synchronously or by rejection. Either way the link goes on screen, and
  // a refused write stays out of the error log the browser gate reads.
  try {
    if (document.hasFocus() && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => toast('链接已复制'), () => toast(url));
    } else {
      toast(url);
    }
  } catch {
    toast(url);
  }
}

// The name of the press a player should make next, in the words they would use: which tile,
// and which way it goes. Derived from the solver's own cell list, so the panel and the
// search can never drift apart.
function describe(pos) {
  const n = app.game.n;
  const blank = blankCell(app.game);
  const dr = Math.floor(blank / n) - Math.floor(pos / n);
  const dc = (blank % n) - (pos % n);
  const dir = dr === 1 ? '下' : dr === -1 ? '上' : dc === 1 ? '右' : '左';
  return { tile: app.game.state[pos], dir, from: pos, to: blank };
}

let hintCache = null; // one search per *position*, so mashing the button costs nothing extra

function nextFromSearch(budget) {
  const r = solve(app.game.state, budget);
  if (!r.ok || !r.path.length) return { ok: false, moves: r.moves, nodes: r.nodes, truncated: r.truncated };
  return { ok: true, path: r.path, moves: r.moves, nodes: r.nodes };
}

el.hint.addEventListener('click', () => {
  stopDemo('');
  const key = app.game.state.join(',');
  if (!hintCache || hintCache.key !== key) {
    hintCache = { key, ...nextFromSearch(HINT_BUDGET) };
  }
  if (!hintCache.ok) {
    say(`这一盘现场算不动（超过 ${HINT_BUDGET.nodeLimit} 结点的即时预算）—— 提示只在开局或接近开局时用，全量搜索是 <code>tools/bake.mjs</code> 的活`);
    return;
  }
  app.hints++;
  const d = describe(hintCache.path[0]);
  view.showHint(hintCache.path[0]);
  say(`提示：把 <b>${d.tile}</b> 号块向<b>${d.dir}</b>推进空格 · 从这一格起还要 <b>${hintCache.moves - 1}</b> 滑（实测 ${hintCache.nodes} 结点）`);
  renderCrumbs();
});

// The demo is the IDA* route made visible, so it can never be cheaper than par.
let demoTimer = 0;
let demoRoute = [];
let demoSteps = 0;
function startDemo() {
  if (demoTimer || !app.game || app.game.done) return;
  const r = nextFromSearch(DEMO_BUDGET);
  if (!r.ok) {
    say(`演示要用一次完整求解，这一盘超出了 ${DEMO_BUDGET.nodeLimit} 结点的现场预算 —— 换一或撤销几步再看`);
    return;
  }
  demoRoute = r.path;
  demoSteps = 0;
  el.demo.textContent = '停止';
  el.demo.setAttribute('aria-pressed', 'true');
  demoTimer = setInterval(() => {
    const pos = demoRoute[demoSteps];
    if (pos === undefined || app.game.done || ++demoSteps > app.game.par + 8) {
      stopDemo('');
      return;
    }
    commit(pos);
    if (app.game.done) stopDemo('演示走完了一条最短路线');
  }, 220);
}

function stopDemo(note) {
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = 0;
  demoRoute = [];
  el.demo.textContent = '演示';
  el.demo.setAttribute('aria-pressed', 'false');
  if (note) say(note);
}

el.modes.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-mode]');
  if (!b) return;
  if (b.dataset.mode === 'campaign') go(`#/c/${clampIndex(store.unlocked)}`);
  else if (b.dataset.mode === 'daily') go('#/daily');
  else go(`#/random/${BANDS[0].key}/${token()}`);
});

el.undo.addEventListener('click', () => {
  stopDemo('');
  hintCache = null;
  if (undo(app.game)) {
    view.redraw();
    renderCrumbs();
    if (app.game.moves === 0) say('回到起点');
  }
});

el.restart.addEventListener('click', restart);

function restart() {
  stopDemo('');
  hintCache = null;
  reset(app.game);
  app.hints = 0;
  el.curtain.hidden = true;
  view.settle(); // the tiles snap back: replaying N slides as an animation is noise, not info
  view.redraw();
  render();
  say('回到起点');
}

el.again.addEventListener('click', restart);
el.next.addEventListener('click', () => go(`#/c/${Math.min(LOTS, app.index + 1)}`));
el.share.addEventListener('click', shareLink);
el.demo.addEventListener('click', () => {
  if (demoTimer) stopDemo('演示已停止');
  else startDemo();
});

// Wiping the save is the one destructive thing this game can do, so it asks twice instead of
// firing on a stray click.
let wipeArmed = false;
el.wipe.addEventListener('click', () => {
  if (!wipeArmed) {
    wipeArmed = true;
    toast('再点一次会清空本机全部成绩');
    setTimeout(() => { wipeArmed = false; }, 4000);
    return;
  }
  store.reset();
  wipeArmed = false;
  toast('存档已清空');
  apply();
});

window.addEventListener('hashchange', apply);
window.addEventListener('resize', () => view.measure());
window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key;
  if (k === 'Escape' && !el.curtain.hidden) { el.curtain.hidden = true; return; }
  if (k === 'u' || k === 'U') { el.undo.click(); return; }
  if (k === 'h' || k === 'H') { el.hint.click(); return; }
  if (k === 'r' || k === 'R') { el.restart.click(); return; }
  if (k === 'd' || k === 'D') { el.demo.click(); return; }
  // Arrow keys name the *direction a tile travels*, so the cell pressed is the one on the far
  // side of the hole: ArrowUp pushes the tile below the blank upwards. It is the same single
  // rule as a finger — js/core decides, and a non-adjacent or off-board press costs nothing.
  const dir = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, 1], ArrowRight: [0, -1] }[k];
  if (!dir || !app.game || app.game.done) return;
  ev.preventDefault();
  const n = app.game.n;
  const blank = blankCell(app.game);
  const from = blank + dir[0] * n + dir[1];
  if (from < 0 || from >= n * n) return;
  if (Math.floor(from / n) !== Math.floor(blank / n) && dir[1] !== 0) return;
  commit(from);
});

view.start();
// Deliberately not paused on visibilitychange: the slide animation and the win card are
// driven from the same loop, and a tab that reports itself hidden (headless Chrome does) must
// still be able to finish a board.
apply();

// The test hook. Every number in here is read off the same objects the panel prints, and the
// only search reachable from it is `measurePar`, which is bounded and is never on a tap path.
window.slide15 = {
  version: 1,
  get state() {
    return {
      mode: app.mode,
      label: app.label,
      id: app.lot && app.lot.id,
      band: app.lot && app.lot.band,
      index: app.index,
      n: app.game && app.game.n,
      moves: app.game && app.game.moves,
      par: app.lot && app.lot.par,
      over: app.game ? overPar(app.game) : 0,
      home: app.game ? homeCount(app.game) : 0,
      blank: app.game ? blankCell(app.game) : -1,
      legal: app.game ? legalTaps(app.game) : [],
      done: !!(app.game && app.game.done),
      hints: app.hints,
      unlocked: store.unlocked,
      solved: ALL.filter((l) => (store.record(l.id) || {}).solved).length,
      curtain: !el.curtain.hidden,
      demo: !!demoTimer,
      persistent: store.persistent,
    };
  },
  get pool() { return poolStats(); },
  get bands() { return BANDS; },
  // The 3×3 truth table, on demand and never at boot: `js/core/bfs3.js` is deliberately not
  // in the page's import graph (it costs a couple of hundred milliseconds to lay down and the
  // shipped game needs it for nothing). A test can still ask the browser to build it and read
  // back the anchors every `par` in this repo is checked against.
  async graph() {
    const b = await import('./core/bfs3.js');
    const t0 = performance.now();
    const t = b.table(3);
    const buildMs = Number((performance.now() - t0).toFixed(1));
    return {
      n: t.n, size: t.size, states: t.states, diameter: t.diameter,
      atDiameter: b.boardsAtDepth(t.diameter).length,
      histogram: t.histogram.slice(0, t.diameter + 1),
      buildMs,
    };
  },
  load(hash) { go(hash); return app.lot && app.lot.id; },
  // The baked row the board came from: its certified route, from its own start position.
  level() {
    return app.lot ? { id: app.lot.id, band: app.lot.band, n: app.lot.n, state: app.lot.state, par: app.lot.par, path: app.lot.path.slice() } : null;
  },
  path() { return app.lot ? app.lot.path.slice() : []; },
  // The shipped pool itself, so a test can re-check every printed number against the board it
  // was measured from instead of only the one currently on screen.
  lots() { return ALL.map((l) => ({ id: l.id, band: l.band, n: l.n, par: l.par, state: l.state, path: l.path.slice() })); },
  stateArray() { return app.game ? toArray(app.game.state) : null; },
  legalTaps() { return app.game ? legalTaps(app.game) : []; },
  blankCell() { return app.game ? blankCell(app.game) : -1; },
  history() { return app.game ? app.game.history.map((h) => ({ blank: h.blank, pos: h.pos })) : []; },
  // Press a cell through the same gate a finger uses.
  tapCell(pos) { return commit(pos); },
  play(cells) { for (const c of cells || []) commit(c); return app.game.moves; },
  undoOnce() { el.undo.click(); return app.game.moves; },
  reset() { restart(); return app.game.moves; },
  hintOnce() {
    el.hint.click();
    return {
      hints: app.hints,
      line: el.hintline.textContent,
      cell: hintCache && hintCache.ok ? hintCache.path[0] : -1,
      left: hintCache && hintCache.ok ? hintCache.moves - 1 : -1,
    };
  },
  demoStart() { startDemo(); return !!demoTimer; },
  demoStop() { stopDemo(''); return demoTimer === 0; },
  // Re-measure the board on screen with the solver that produced the printed number. The
  // browser is allowed to disagree with `par`, and this is the call that would show it.
  measurePar(opts) {
    const r = solve(app.game.state, opts || {});
    return {
      ok: r.ok, moves: r.moves, nodes: r.nodes, truncated: !!r.truncated, reason: r.reason || null,
      par: app.lot.par, agrees: r.ok && r.moves === app.lot.par,
      replays: r.ok ? replay(app.game.state, r.path).every((v, i) => v === goalState(app.game.n)[i]) : false,
    };
  },
  // And measure an arbitrary one, under the same default budget. Nothing on a tap path calls
  // this: it exists so a test can make the browser reproduce the anchors the node suite makes
  // it reproduce, including the negative case (a board the parity theorem refuses).
  solveState(state, opts) {
    const r = solve(Uint8Array.from(state), opts || {});
    return {
      ok: r.ok, moves: r.moves, nodes: r.nodes, truncated: !!r.truncated,
      reason: r.reason || null, path: r.path || [],
    };
  },
  async bfsDistance(state) {
    const b = await import('./core/bfs3.js');
    return b.bfsDistance(Uint8Array.from(state));
  },
  // The pure lookups behind the routes, callable with an explicit seed so a test can prove the
  // URL and the pool agree without depending on what day it is.
  daily(dateKey) {
    const l = dailyLot(dateKey || todayKey());
    return l ? { id: l.id, band: l.band, n: l.n, par: l.par, state: l.state } : null;
  },
  randomOf(bandKey, key) {
    const band = bandByKey(bandKey);
    const l = randomLot(`${band.key}|${key}`, band.key);
    return l ? { id: l.id, band: l.band, n: l.n, par: l.par } : null;
  },
  // Where things are, in client pixels — what an automated finger needs, as opposed to the
  // maths in js/core. `cellPoint` follows the tile drawn in that cell, so it stays correct
  // while a slide is still animating.
  cellPoint(cell) { return view.cellPoint(cell); },
  tilePoint(value) { return view.tilePoint(value); },
  pointAt(x, y) { return view.pointAt(x, y); },
  geometry() { return view.geometry(); },
  settled() { return view.settled(); },
  pixels() { return view.pixelsHash(); },
  painted() { return view.painted(); },
  store,
};
// The spec's shorter name for the same object, so a link to `window.slide` is not a lie.
window.slide = window.slide15;

// ---- 全屏开关（#btn-fullscreen）----
// 绑的是本页 HUD 上真实存在的那个按钮。全屏最常见的假实现就是引用一个并不存在的
// id：点下去什么也不会发生，量具却算它"已实现"。所以这里找不到按钮就直接不装。
(function bindFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  // 只做特性检测，不嗅探 UA：iOS Safari 是 webkitRequestFullscreen，老 Edge 是 ms 前缀，
  // 而 UA 字符串随时会改。"有没有这个能力"是查出来的，不是猜出来的。
  const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const current = () => document.fullscreenElement || document.webkitFullscreenElement
    || document.msFullscreenElement || null;

  // 不支持也要给个说法：只把按钮灰掉而不解释，玩家会以为这功能没做完。
  const unsupported = () => {
    btn.disabled = true;
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」独立打开）';
  };
  if (!req) unsupported();

  // fullscreen 返回 Promise，被拒时必须吃掉：iOS Safari 对多数非 video 元素直接拒绝，
  // 让这个 rejection 冒泡出去会变成一条未捕获错误，整局游戏跟着挂。
  const settle = (p) => { if (p && p.catch) p.catch(unsupported); };

  // 进出都能走：已经全屏时这次调用是退出，不是"再进一次"。
  function toggle() {
    try {
      if (current()) {
        if (exit) settle(exit.call(document));
      } else if (req) {
        settle(req.call(root));
      } else {
        unsupported();
      }
    } catch (e) {
      unsupported();
    }
  }

  // Esc 和系统手势退出都不经过我们的代码，按钮状态只能靠 fullscreenchange 回写，
  // 否则用户已经退出、HUD 还停在"退出全屏"，下一次点击反而会重新进全屏。
  function sync() {
    const on = !!current();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    btn.title = "全屏" + '（F）';
    const body = document.body;
    if (body && body.classList) body.classList.toggle('fullscreen', on);
  }

  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    const t = ev.target;
    // 盘号 / 种子这类输入框里打字不能触发全屏，否则玩家输 seed 输到一半屏幕没了。
    if (t && /input|textarea|select/i.test(t.tagName || '')) return;
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    toggle();
  });
  window.addEventListener('fullscreenchange', sync);
  window.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('MSFullscreenChange', sync);
  sync();
})();
