// LifeMapz - Service Worker v3.1.3
// Strategy: versioned pre-cache + safe upgrades
// - Network-first for HTML/documents (fresh app shell)
// - Cache-first for other GETs (with background update)
// - ✨ DO NOT intercept Google/Firebase auth requests (fixes mobile sign-in)

const CACHE_NAME = "lifemapz-v3.1.3";

// Precache EXACT versioned assets (match your index.html versions)
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=3.1.3",
  "./app.js?v=3.1.3",
  "./manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(ASSETS);
      } catch {
        // If any cross-origin asset fails to precache, continue install anyway.
      }
    })()
  );
  // Take control immediately so new tabs get the latest files
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("lifemapz-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Fetch strategy:
// - HTML/documents: network-first (fresh), fall back to cache when offline
// - Static assets: cache-first (populate cache on miss)
// - Everything else: network with cache fallback
// - ⚠️ Never intercept Firebase/Google auth flows
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 🚫 Do NOT intercept Firebase/Google auth traffic
  const skipSW =
    url.origin.includes("firebaseapp.com") ||
    url.origin.includes("web.app") ||
    url.origin.includes("gstatic.com") ||
    url.origin.includes("googleapis.com") ||          // identitytoolkit, installations, etc.
    url.origin.includes("googleusercontent.com") ||
    url.origin.includes("accounts.google.com") ||
    url.pathname.includes("/__/auth/");

  if (skipSW) {
    // Let the browser access the network directly so OAuth completes correctly
    return; // no respondWith -> default network handling
  }

  const isHTML =
    request.mode === "navigate" ||
    request.destination === "document" ||
    (request.headers.get("accept") || "").includes("text/html");

  // Prefer simple extension test for static assets
  const isAsset = /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname);

  if (isHTML) {
    // Network-first for app shell pages
    event.respondWith(
      (async () => {
        try {
          const resp = await fetch(request);
          // cache clone for offline
          caches.open(CACHE_NAME).then((c) => c.put(request, resp.clone())).catch(() => {});
          return resp;
        } catch {
          // Fallback to cache, then to cached index.html
          const cached = await caches.match(request);
          return cached || caches.match("./index.html");
        }
      })()
    );
    return;
  }

  if (isAsset) {
    // Cache-first for static assets (keep querystrings!)
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          // only cache same-origin assets to avoid opaque clutter
          if (url.origin === self.location.origin) {
            caches.open(CACHE_NAME).then((c) => c.put(request, fresh.clone())).catch(() => {});
          }
          return fresh;
        } catch {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Everything else: network with cache fallback
  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        const cached = await caches.match(request);
        return cached || Response.error();
      }
    })()
  );
});

// Optional: simple messaging for version info and instant activation
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "GET_VERSION") {
    event.ports[0]?.postMessage({
      version: "3.1.3",
      features: ["goals-view", "enhanced-cascade", "visual-horizons", "cloud-sync", "time-management", "calendar-view"],
    });
  }
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

console.log("✅ LifeMapz Service Worker v3.1.3 loaded");
