const CACHE = 'geoverif-v1.0.0';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'libs/leaflet.css', 'libs/leaflet.js', 'libs/shp.js', 'libs/sql-wasm.js', 'libs/sql-wasm.wasm',
  'libs/proj4.js', 'libs/togeojson.umd.js', 'libs/papaparse.min.js', 'libs/jszip.min.js',
  'libs/xlsx.full.min.js',
  'libs/images/layers.png', 'libs/images/layers-2x.png',
  'libs/images/marker-icon.png', 'libs/images/marker-icon-2x.png', 'libs/images/marker-shadow.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;           // tuiles, Nominatim, GoatCounter : réseau direct
  e.respondWith(caches.match(e.request, {ignoreSearch: true})
    .then(r => r || fetch(e.request)));                  // app shell : cache d'abord
});
