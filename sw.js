// LifeMapz - Service Worker v3.1.1
// Strategy: versioned pre-cache + safe upgrades
// - Network-first for HTML/documents (so you always get fresh app shell)
// - Cache-first for other GETs (with background update)
// - ✨ DO NOT intercept Google/Firebase auth requests (fixes mobile sign-in)

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
    url.origin.includes("googleapis.com") ||
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

  if (isHTML) {
    // Network-first for app shell pages
    event.respondWith(
      (async () => {
        try {
          const resp = await fetch(request);
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
          return resp;
        } catch {
          // fallback to cache, then to cached index.html
          const cached = await caches.match(request);
          return cached || caches.match("./index.html");
        }
      })()
    );
    return;
  }

  // Non-HTML: cache-first with background update (keep querystrings!)
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const fetchPromise = fetch(request)
        .then((network) => {
          const copy = network.clone();
          if (url.origin === self.location.origin) {
            caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
          }
          return network;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })()
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
