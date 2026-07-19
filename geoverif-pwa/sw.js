// GeoVerif — ressources applicatives conservées pour l'utilisation hors connexion.
// Les fonds de carte, Nominatim et GoatCounter restent des services réseau externes.
const CACHE = 'geoverif-v1.0.0-pwa-260719a';
const COQUILLE = [
  './', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png',
  './libs/leaflet.css', './libs/leaflet.js',
  './libs/images/layers.png', './libs/images/layers-2x.png',
  './libs/images/marker-icon.png', './libs/images/marker-icon-2x.png', './libs/images/marker-shadow.png',
  './libs/shp.js', './libs/sql-wasm.js', './libs/sql-wasm.wasm',
  './libs/proj4.js', './libs/togeojson.umd.js', './libs/papaparse.min.js',
  './libs/xlsx.full.min.js', './libs/jszip.min.js',
  './libs/fonts/IBMPlexSans-Regular.woff2', './libs/fonts/IBMPlexSans-Medium.woff2',
  './libs/fonts/IBMPlexSans-SemiBold.woff2', './libs/fonts/IBMPlexMono-Regular.woff2',
  './libs/fonts/IBMPlexMono-Medium.woff2', './libs/fonts/IBMPlexMono-SemiBold.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(COQUILLE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async response => {
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put('./index.html', response.clone());
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, {ignoreSearch: true})
      .then(cached => cached || fetch(event.request).then(async response => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
        }
        return response;
      }))
  );
});
