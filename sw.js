// Guarda la app en caché para que funcione sin conexión.
// Al cambiar archivos de la app, subí VERSION para que se actualice.
const VERSION = 'capital-v20';
const CORE = [
  './',
  'index.html',
  'styles.css',
  'fonts.css',
  'app.js',
  'spell-worker.js',
  'dict/es.aff',
  'dict/es.dic',
  'dict/capital-extra.txt',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/vditor/dist/index.min.js',
  'vendor/vditor/dist/index.css',
  'vendor/vditor/dist/js/lute/lute.min.js',
  'vendor/vditor/dist/js/i18n/es_ES.js',
  'vendor/vditor/dist/js/icons/ant.js',
  'vendor/vditor/dist/css/content-theme/light.css',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' saltea la caché HTTP de GitHub (10 minutos) para guardar los archivos nuevos
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (para recibir actualizaciones); si no hay conexión, la caché.
// cache: 'no-cache' le pregunta siempre a GitHub si el archivo cambió (si no cambió, responde rápido y sin volver a bajarlo).
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./')))
  );
});
