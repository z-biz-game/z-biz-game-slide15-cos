// 音效：一层薄薄的 WebAudio。整个模块的唯一硬约束是——静音必须是真静音。
//
// "把 master gain 设成 0" 是假静音：振荡器节点照建不误，CPU 照烧，某些浏览器还会漏出
// 一帧爆音。这里静音态下 tone() 直接 return，一个节点都不新建；再把 AudioContext
// 真的 suspend()，恢复时 resume()。suspend/resume 是浏览器用来停掉整个音频线程的开关，
// 停下去之后连 currentTime 都不再推进——这才叫"停"。
//
// AudioContext 只在第一次真实手势里惰性创建（自动播放策略），创建失败（无 WebAudio 的
// 环境、node 里跑）就整模块静默降级，游戏逻辑从不依赖它发声。

export function createAudio({ isMuted } = {}) {
  let ctx = null;
  let master = null;
  let muted = isMuted ? !!isMuted() : false;

  function ensure() {
    if (ctx) return ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function resume() {
    if (muted) return; // 静音态不唤醒音频线程
    const c = ensure();
    if (c && c.state === 'suspended' && c.resume) { try { c.resume(); } catch { /* 忽略 */ } }
  }

  function suspend() {
    if (ctx && ctx.state === 'running' && ctx.suspend) { try { ctx.suspend(); } catch { /* 忽略 */ } }
  }

  // 切换静音：真停/真起 AudioContext，返回切换后的静音态。
  function setMuted(next) {
    muted = !!next;
    if (muted) suspend();
    else resume();
    return muted;
  }

  // 静音态或音频线程未运行时，一个振荡器都不新建。
  function tone(freq, dur, type, vol) {
    if (muted) return;
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    o.connect(g);
    g.connect(master);
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    resume,
    setMuted,
    get muted() { return muted; },
    // 供探针/测试读取的真实运行态（'none' | 'suspended' | 'running'）。
    get state() { return ctx ? ctx.state : 'none'; },
    slide() { tone(520, 0.09, 'triangle', 0.22); },
    illegal() { tone(150, 0.13, 'sawtooth', 0.16); },
    hint() { tone(880, 0.07, 'sine', 0.16); },
    win() {
      if (muted) return;
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'sine', 0.3), i * 90));
    },
  };
}
