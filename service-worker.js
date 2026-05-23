const CACHE_NAME = 'attendance-tracker-v2';

// Caching app shell and critical assets (removed font for CORS safety)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/install.html',
  '/style.css',
  '/script.js',
  '/firebase-config.js',
  '/manifest.json',
  '/assets/logo.png',
  '/assets/apple-touch-icon.png',
  '/assets/icon-192x192.png',
  '/assets/icon-512x512.png'
];

// Install Event: Cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event: Clean up old caches if you update the version number
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: Serve static assets from cache first, then fallback to network
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  // Let Firebase, Auth, and Firestore requests bypass the service worker entirely
  if (!event.request.url.startsWith(self.location.origin)) {
    return; 
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return the cached version if found, otherwise fetch from the network
      return cachedResponse || fetch(event.request);
    })
  );
});