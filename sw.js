const CACHE_NAME = 'sistemagil-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './cadasto.html',      // ➕ Adicionado
  './professor.html',     // ➕ Adicionado
  './coordenaçao.html',   // ➕ Adicionado (Atenção à acentuação aqui!)
  './manifest.json',
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
  console.log('Service Worker ativado com sucesso.');
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      return cachedResponse || fetch(e.request);
    })
  );
});