// AgentEdge SaleComps — Service Worker
// Cache-first for app shell, network-first for data

const CACHE_NAME = 'salecomps-v1';
const DATA_CACHE = 'salecomps-data-v1';

// App shell — everything needed to load the UI
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js',
];

// Large data files — cache on first fetch, serve from cache after
const DATA_URLS = [
  '/salecomps-data.json',
  '/dc-zip-boundaries.json',
];

// ── Install: pre-cache app shell ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_URLS).catch(err => {
        // Don't fail install if CDN assets are unavailable
        console.warn('[SW] Shell pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and browser-extension requests
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // Data files: cache-first, long-lived (5.9MB JSON doesn't change often)
  if (DATA_URLS.some(u => url.pathname.endsWith(u.replace('/', '')))) {
    event.respondWith(cacheFirstWithFallback(event.request, DATA_CACHE));
    return;
  }

  // Tile server requests: network-only (never cache map tiles)
  if (url.hostname.includes('tile') || url.pathname.includes('/tiles/')) {
    return; // Let browser handle normally
  }

  // Everything else: cache-first (app shell, fonts, leaflet)
  event.respondWith(cacheFirstWithFallback(event.request, CACHE_NAME));
});

// ── Cache-first helper ──
async function cacheFirstWithFallback(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Only cache valid responses
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline fallback for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

// ── Message handler: force cache refresh ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_DATA_CACHE') {
    caches.delete(DATA_CACHE).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }
});
