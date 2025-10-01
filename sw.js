/* LifeMapz Service Worker v3.1.3
   - Versioned via query param (?v=APP_VERSION) for clean cache rollover
   - App-shell precache + runtime caching for same-origin static assets
   - Bypass caching for cross-origin/API (Firebase, Pantry, JSONBin, etc.)
   - SPA navigation fallback to cached index.html when offline
   - Immediate activation (skipWaiting + clients.claim)
*/

const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE_PREFIX = 'lifemapz-cache';
const CACHE_NAME = `${CACHE_PREFIX}-${VERSION}`;
const STATIC_EXT_RE = /\.(?:js|css|html|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|json|map|webmanifest)$/i;

// Compute scoped URLs so this SW works from subfolders too
const SCOPE_URL = new URL(self.registration.scope);
const toScoped = (p) => new URL(p, SCOPE_URL).toString();

// Minimal app shell (best-effort)
const APP_SHELL = [
  'index.html',
  './index.html',
  './',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
].map(toScoped);

// Utility: addAll but ignore failures (missing files shouldn't break install)
async function addAllSafe(cache, urls) {
  for (const url of urls) {
    try {
      await cache.add(new Request(url, { cache: 'no-cache' }));
    } catch (_) {
      // ignore missing assets
    }
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await addAllSafe(cache, APP_SHELL);
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge old versioned caches
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// Helper: find a cached index.html for SPA fallback
async function matchIndex(cache) {
  const candidates = [
    toScoped('index.html'),
    toScoped('./index.html'),
    toScoped('/index.html'),
  ];
  for (const url of candidates) {
    const res = await cache.match(url, { ignoreSearch: true });
    if (res) return res;
  }
  // As a last resort, return a tiny offline page
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Offline</title><h1>Offline</h1><p>You appear to be offline. Try again once you\'re connected.</p>',
    { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never handle our own SW script
  if (url.origin === self.location.origin && /\/sw\.js$/i.test(url.pathname)) return;

  // Navigation requests: network-first, fallback to cached index for offline SPA
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Optionally keep a copy of index for offline
          const cache = await caches.open(CACHE_NAME);
          cache.put(toScoped('index.html'), fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return matchIndex(cache);
        }
      })()
    );
    return;
  }

  // Only runtime-cache same-origin static assets
  if (url.origin !== self.location.origin) {
    // Cross-origin (Firebase, Pantry, JSONBin, etc.) -> passthrough, no cache
    return;
  }

  const isStatic = STATIC_EXT_RE.test(url.pathname);
  if (!isStatic) {
    // Likely dynamic or API on same origin -> passthrough
    return;
  }

  // Static assets: stale-while-revalidate (cache first, refresh in background)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Try cache (ignore querystrings like ?v=)
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) {
        // Revalidate in the background
        event.waitUntil(
          (async () => {
            try {
              const fresh = await fetch(request, { cache: 'no-cache' });
              if (fresh && fresh.ok) await cache.put(request, fresh.clone());
            } catch {
              // ignore network errors during background refresh
            }
          })()
        );
        return cached;
      }

      // Fetch from network and cache
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        // Last-ditch: try any path-only match in cache (ignoring search)
        const fallback = await cache.match(request, { ignoreSearch: true });
        return fallback || new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })()
  );
});

// Allow page to trigger skipWaiting if needed
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});
