// LifeMapz - Service Worker v3.1.1
// Strategy: versioned pre-cache + safe upgrades + network-first for HTML, cache-first for assets

const CACHE_NAME = "lifemapz-v3.1.1";

// Precache EXACT versioned assets (match your index.html versions)
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=3.1.1",
  "./app.js?v=3.1.1",
  "./manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  // Take control immediately so new tabs get the latest files
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  // Start controlling any open clients
  self.clients.claim();
});

// Fetch strategy:
// - HTML/documents: network-first (fresh content), fall back to cache when offline
// - Other GETs: cache-first, then network; also update cache in the background
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const isHTML =
    request.mode === "navigate" ||
    request.destination === "document" ||
    (request.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(request))
        .then((resp) => resp || caches.match("./index.html"))
    );
    return;
  }

  // Non-HTML: cache-first with background update (DO NOT ignore querystrings)
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((network) => {
          const copy = network.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
          return network;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Optional: simple messaging for version info and instant activation
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "GET_VERSION") {
    event.ports[0]?.postMessage({
      version: "3.1.1",
      features: ["goals-view", "enhanced-cascade", "visual-horizons", "cloud-sync", "time-management"]
    });
  }
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

console.log("✅ LifeMapz Service Worker v3.1.1 loaded");
