const STATIC_CACHE = 'seoul2026-static';
const HTML_CACHE = 'seoul2026-html';
const VERSION_URL = './version.json';
const STATIC_ASSETS = ['./manifest.json', './icons/icon.svg', './version.json', './data/payment.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![STATIC_CACHE, HTML_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim()).then(checkForUpdates));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CHECK_FOR_UPDATES') event.waitUntil(checkForUpdates());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(networkFirstHtml(event.request));
    event.waitUntil(checkForUpdates());
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirstStatic(event.request));
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

function isStaticAsset(url) {
  return /\.(?:js|css|svg|png|jpg|jpeg|webp|ico|json)$/i.test(url.pathname);
}

async function networkFirstHtml(request) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response.ok) await cache.put('./index.html', response.clone());
    return response;
  } catch {
    return (await cache.match('./index.html')) || caches.match('./index.html');
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    refreshStatic(request, cache);
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function refreshStatic(request, cache) {
  try {
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response.ok) await cache.put(request, response);
  } catch {}
}

async function checkForUpdates() {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cachedVersion = await cache.match(VERSION_URL);
    const oldVersion = cachedVersion ? await cachedVersion.clone().json() : null;
    const fresh = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!fresh.ok) return;
    const newVersion = await fresh.clone().json();
    await cache.put(VERSION_URL, fresh);
    await warmCurrentShell();
    if (oldVersion && oldVersion.version !== newVersion.version) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach(client => client.postMessage({ type: 'APP_UPDATE_READY', version: newVersion.version }));
    }
  } catch {}
}

async function warmCurrentShell() {
  const htmlCache = await caches.open(HTML_CACHE);
  const staticCache = await caches.open(STATIC_CACHE);
  const index = await fetch('./index.html', { cache: 'no-store' });
  if (index.ok) await htmlCache.put('./index.html', index);
  await Promise.all(STATIC_ASSETS.map(async asset => {
    try {
      const response = await fetch(asset, { cache: 'no-store' });
      if (response.ok) await staticCache.put(asset, response);
    } catch {}
  }));
}
