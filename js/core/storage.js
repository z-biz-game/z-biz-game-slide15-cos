// Save file: one localStorage key, plain JSON, versioned so an old save is recognised
// rather than mistaken for a new shape.
//
// The guard is the reason this is a module instead of a direct read of the host storage
// object. That object is not merely missing in some contexts — touching the property throws
// (SecurityError under a blocking third-party-cookie setting, in a private tab, and
// in any non-browser host), and setItem throws on quota as well. So every access here goes
// through `backing()`, which turns all of that into "we are memory-only today", and the
// game keeps working. test/storage.test.mjs runs the whole suite on exactly that path.

const KEY = 'slide15.save.v1';

function backing() {
  try {
    const ls = globalThis.localStorage;
    if (!ls || typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') return null;
    return ls;
  } catch {
    return null;
  }
}

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, perfect: 0, slides: 0 },
    muted: false,
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null; // 宿主禁止访问（隐私模式 / 第三方 Cookie 拦截）：今天只能内存态
  }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        cache = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
          stats: { ...base.stats, ...(p.stats || {}) },
          muted: !!p.muted,
        };
        return cache;
      }
    } catch {
      // A corrupt save is not worth keeping: start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false; // 配额或宿主拒绝写入：内存里的这份仍然有效，游戏照玩
  }
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  get unlocked() { return load().unlocked; },
  // False in node, true in a normal browser tab: the difference between "we saved" and
  // "we remembered until you closed the tab".
  get persistent() { return backing() !== null; },

  get muted() { return !!load().muted; },
  setMuted(next) {
    const s = load();
    s.muted = !!next;
    persist();
    return s.muted;
  },

  record(id) {
    return load().records[id] || null;
  },

  // The campaign pointer only ever moves forwards: re-playing an early board must not be
  // able to hide a later one.
  unlock(n) {
    const s = load();
    if (n > s.unlocked) s.unlocked = n;
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id) {
    const s = load();
    s.daily[dateKey] = { id, at: Date.now() };
    persist();
  },

  dailyDone(dateKey) {
    return load().daily[dateKey] || null;
  },

  // `par` is the certified optimum, so beating or matching it is a fact about the run.
  solve(id, { moves, par }) {
    const s = load();
    const prev = s.records[id];
    const cur = {
      solved: true,
      best: !prev || !prev.best || moves < prev.best ? moves : prev.best,
      plays: (prev && prev.plays ? prev.plays : 0) + 1,
      perfect: moves <= par || !!(prev && prev.perfect),
    };
    s.records[id] = cur;
    s.stats.solves += 1;
    s.stats.slides += moves;
    if (moves <= par) s.stats.perfect += 1;
    persist();
    return cur;
  },

  reset() {
    cache = blank();
    const ls = backing();
    try {
      if (ls) ls.removeItem(KEY);
    } catch {
      // nothing was ever persisted, so there is nothing to remove
    }
  },
};

export const SAVE_KEY = KEY;
