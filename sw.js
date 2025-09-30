// LifeMapz - Service Worker v3.1.0
const CACHE_NAME = 'lifemapz-visual-horizons-v3.1.0';
const STATIC_CACHE = 'lifemapz-static-v3.1';
const DYNAMIC_CACHE = 'lifemapz-dynamic-v3.1';

// Assets to cache immediately on install
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css?v=3.1.0',
  './app.js?v=3.1.0',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('🔄 LifeMapz Service Worker v3.1.0 installing...');
  event.waitUntil(
    (async () => {
      try {
        const staticCache = await caches.open(STATIC_CACHE);
        console.log('📦 Caching static assets...');
        await staticCache.addAll(STATIC_ASSETS);
        console.log('✅ Static assets cached successfully');
        await self.skipWaiting();
        console.log('🚀 Service Worker activated immediately');
      } catch (error) {
        console.error('❌ Cache installation failed:', error);
      }
    })()
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 LifeMapz Service Worker v3.1.0 activating...');
  event.waitUntil(
    (async () => {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(async (cacheName) => {
            // Delete ALL old caches to ensure clean update
            if (!cacheName.startsWith('lifemapz-') || 
                (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE)) {
              console.log('🗑️ Deleting old cache:', cacheName);
              await caches.delete(cacheName);
            }
          })
        );
        await self.clients.claim();
        console.log('✅ Service Worker v3.1.0 activated and claiming clients');
      } catch (error) {
        console.error('❌ Service Worker activation failed:', error);
      }
    })()
  );
});

// Fetch event - caching strategy
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        // Network-first strategy for HTML to ensure fresh content
        if (event.request.url.includes('/index.html') || 
            event.request.destination === 'document') {
          try {
            const networkResponse = await fetch(event.request);
            if (networkResponse.ok) {
              const dynamicCache = await caches.open(DYNAMIC_CACHE);
              dynamicCache.put(event.request, networkResponse.clone());
              return networkResponse;
            }
          } catch (networkError) {
            console.log('🌐 Network failed for HTML, serving from cache');
          }
        }

        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) {
          if (event.request.url.startsWith(self.location.origin)) {
            const dynamicCache = await caches.open(DYNAMIC_CACHE);
            dynamicCache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }
        throw new Error('Network response not ok');
      } catch (networkError) {
        console.log('🌐 Network failed, serving fallback');
        
        if (event.request.destination === 'document' || event.request.headers.get('accept')?.includes('text/html')) {
          return new Response(
            `<!DOCTYPE html>
            <html>
            <head>
              <title>Offline - LifeMapz</title>
              <style>
                body { font-family: system-ui, sans-serif; padding: 2rem; text-align: center; background: #f8fafc; color: #0f172a; }
                h1 { color: #7c3aed; margin-bottom: 1rem; }
                button { background: #7c3aed; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer; font-size: 1rem; }
                button:hover { background: #6d28d9; }
              </style>
            </head>
            <body>
              <h1>LifeMapz v3.1.0</h1>
              <p>You're offline. Your data is safe locally.</p>
              <p><small>New version loaded with enhanced goals view</small></p>
              <button onclick="window.location.reload()">Try Again</button>
            </body>
            </html>`,
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
        return new Response('Resource not available offline', { status: 408 });
      }
    })()
  );
});

// Message handling for version check
self.addEventListener('message', (event) => {
  const { type } = event.data;
  if (type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ 
      version: '3.1.0', 
      features: ['goals-view', 'enhanced-cascade', 'visual-horizons', 'cloud-sync', 'time-management'] 
    });
  }
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('✅ LifeMapz Service Worker v3.1.0 loaded');