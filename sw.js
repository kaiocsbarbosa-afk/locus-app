const CACHE_NAME = 'locus-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './cadasto.html',
  './professor.html',
  './coordenacao.html',
  './manifest.json',
  './locus.css',
  './utils.js',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Instalando e cacheando assets do PWA...');
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', e => {
  // Remove caches antigos de versões anteriores do app
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    )
  );
  console.log('Service Worker ativado com sucesso.');
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      return cachedResponse || fetch(e.request);
    })
  );
});
