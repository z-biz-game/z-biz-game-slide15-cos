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
// 存档格式版本号。写档带上、读档校验：将来改形状时旧档宁可整档丢弃，也不能被误读。
export const SAVE_VERSION = 1;

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
    v: SAVE_VERSION,
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, perfect: 0, slides: 0 },
  };
}

let cache = null;

// 数字字段的归一自带一份，不依赖仓里有没有 count() —— 少一层隐式耦合。
function recordNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// 存档两段式解码的第一段：整档 JSON 落到这里之后，**逐字段**归一。
// 一条记录不是"能用/不能用"二选一 —— 类型错的字段自己退成默认值，整条照样留下。
// 第二段（sanitizeRecords）在下面：它只丢掉归一后彻底没意义的记录，别的记录不受牵连。
function sanitizeRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  out.solved = !!r.solved;
  out.best = recordNum(r.best);
  out.plays = recordNum(r.plays);
  out.perfect = !!r.perfect;
  return out;
}

// 逐条隔离：坏的那条丢掉，好的那些原样留下，绝不因为一条把整份存档作废。
function sanitizeRecords(p) {
  const out = {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  for (const [id, rec] of Object.entries(p)) {
    const clean = sanitizeRecord(rec);
    if (clean) out[id] = clean;
  }
  return out;
}

function load() {
  if (cache) return cache;
  const ls = backing();
  let raw = null;
  try {
    raw = ls ? globalThis.localStorage.getItem(KEY) : null;
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      // 版本门：只认本仓写出去的版本。将来升 v2 时，旧档宁可整档丢弃也不能被误读成新档。
      if (p && typeof p === 'object' && !Array.isArray(p)
          && (p.v === undefined || p.v === SAVE_VERSION)) {
        const base = blank();
        cache = {
          records: sanitizeRecords(p.records),
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
          stats: { ...base.stats, ...(p.stats || {}) },
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
  const ls = backing();
  if (!ls) return false;
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
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
