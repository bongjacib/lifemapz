/* LifeMapz Service Worker — final
   - Versioned via query param (?v=APP_VERSION) from app.js
   - Precache core app shell
   - SWR for same-origin static assets
   - Network-first for navigations with offline fallback
   - Bypass caching for dynamic backends (Pantry/JSONBin/Firebase/etc.)
*/

// LifeMapz - Service Worker v3.1.6 (cache bump for hotfix)
const CACHE_NAME = "lifemapz-v3.1.6";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=3.1.6",
  "./dnd.js?v=3.1.6",
  "./HoursCards.js?v=3.1.6",
  "./app.js?v=3.1.6",
  "./app-hotfix.js?v=3.1.6",
  "./manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js",
];

// Domains we always bypass (dynamic data / auth)
const NETWORK_ONLY_HOSTS = new Set([
  'getpantry.cloud',
  'api.jsonbin.io',
  'kvdb.io',
  'firebase.googleapis.com',
  'firestore.googleapis.com',
  'www.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com'
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Attempt to precache core assets; ignore individual failures
      await Promise.allSettled(
        CORE_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );
    } catch (err) {
      // Non-fatal
      console.warn('[SW] Precache error:', err);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clean up old versions
    const names = await caches.keys();
    await Promise.all(
      names.map((n) => {
        if (n.startsWith('lifemapz-static-v') && n !== CACHE_NAME) {
          return caches.delete(n);
        }
        return Promise.resolve(false);
      })
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const { type } = event.data || {};
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bypass certain dynamic backends completely
  if (NETWORK_ONLY_HOSTS.has(url.hostname)) {
    return; // let the request go to network unmodified
  }

  // Navigations: network-first with fallback to cached index.html (SPA)
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigate(req));
    return;
  }

  // Same-origin static assets: stale-while-revalidate
  if (url.origin === self.location.origin && isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Cross-origin assets (e.g., icon/fonts/css CDNs): stale-while-revalidate
  if (isLikelyCdn(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Default: try cache, then network
  event.respondWith(cacheFirst(req));
});

/* ------------------ Strategies ------------------ */

async function networkFirstNavigate(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 4000); // 4s timeout
    const netRes = await fetch(request, { signal: controller.signal });
    clearTimeout(to);
    // Optionally cache a copy of successful navigations
    if (netRes && netRes.ok && netRes.type !== 'opaque') {
      cache.put(request, netRes.clone());
    }
    return netRes;
  } catch {
    // Fallback to cached request or index.html (SPA shell)
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match('./index.html');
    if (shell) return shell;
    // Last resort: simple offline response
    return new Response('<h1>Offline</h1><p>Content is unavailable.</p>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      status: 503
    });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = (async () => {
    try {
      const res = await fetch(request);
      if (res && res.ok) {
        cache.put(request, res.clone());
      }
      return res;
    } catch {
      // Ignore network error, SWR will return cached if present
      return null;
    }
  })();
  return cached || (await fetchPromise) || fetchPromise; // ensure a Response is returned
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    // If image request fails, return a transparent placeholder
    if (request.destination === 'image') {
      return new Response(
        new Blob([new Uint8Array()], { type: 'image/png' }), { headers: { 'Content-Type': 'image/png' } }
      );
    }
    throw e;
  }
}

/* ------------------ Helpers ------------------ */

function isStaticAsset(pathname) {
  // Adjust as needed; keep broad but safe
  return /\.(?:css|js|mjs|json|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|map)$/.test(pathname) ||
         pathname.endsWith('/') ||
         pathname.endsWith('/index.html');
}

function isLikelyCdn(url) {
  // Heuristic for common static CDNs
  return /(cdnjs|cdn\.jsdelivr|unpkg|fonts\.gstatic|fonts\.googleapis|static\.cachefly|cdn\.skypack)\./.test(url.hostname);
}