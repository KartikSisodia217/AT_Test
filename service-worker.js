const CACHE_NAME = 'attendance-tracker-v3';

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

// Install

self.addEventListener('install', (event) => {

  event.waitUntil(

    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

// Activate

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

// Fetch

self.addEventListener('fetch', (event) => {

  // Only GET requests

  if (event.request.method !== 'GET') return;

  // Ignore external requests (Firebase etc.)

  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(

    caches.match(event.request).then((cachedResponse) => {

      return (

        cachedResponse ||

        fetch(event.request).catch(() => {
          return caches.match('/index.html');
        })
      );
    })
  );
});