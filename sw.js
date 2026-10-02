'use strict';
// SLIDE15 的离线服务：network-first，断网才退缓存。
//
// 为什么不是 cache-first：手工写死的版本号 + cache-first 会把 js/css 永久钉在旧版，
// 于是出现"新 HTML 配旧 JS"的鬼状态。这里每个请求先问网络，命中就顺手回填缓存，
// 只有取不到网络（离线/掉线）才回落到上次成功抓到的副本。缓存名带版本，改版换名即清旧。
const VERSION = 'slide15-v1';
const STATIC = 'slide15-static-v1';
const SHELL = ['./', './index.html', './css/game.css', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  // 预缓存外壳，让离线首开不白屏；单个文件失败不拖垮整次安装。
  e.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== STATIC && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!sameOrigin(url)) return; // 不代理第三方，避免把别人的响应塞进我们的缓存

  // 导航请求：网络优先，离线退到缓存里的外壳。
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html'))
          || (await caches.match(req))
          || Response.error();
      }
    })());
    return;
  }

  // 同源子资源（js/css/图标）：网络优先，成功回填，失败退缓存。
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(VERSION);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return (await caches.match(req)) || Response.error();
    }
  })());
});
