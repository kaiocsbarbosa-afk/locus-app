const CACHE_NAME = 'locus-cache-v3';
const ASSETS = [
  './',
  './index.html',
  './cadasto.html',
  './professor.html',
  './coordenacao.html',
  './manifest.json',
  './locus.css',
  './utils.js',
  './push.js',
  './icon-96.png',
  './icon-192.png',
  './icon-512.png',
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

// ------------------------------------------------------------
// Notificações push
// ------------------------------------------------------------
self.addEventListener('push', e => {
  let dados = { title: 'Locus', body: 'Você tem uma nova atualização.' };

  if (e.data) {
    try {
      dados = e.data.json();
    } catch (err) {
      dados.body = e.data.text();
    }
  }

  e.waitUntil(
    self.registration.showNotification(dados.title, {
      body: dados.body,
      icon: './icon-192.png',
      badge: './icon-96.png',
      vibrate: [100, 50, 100]
    })
  );
});

// Clica na notificação → abre/foca o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clientsArr => {
      const clienteExistente = clientsArr.find(c => c.url.includes(self.registration.scope));
      if (clienteExistente) return clienteExistente.focus();
      return self.clients.openWindow('./');
    })
  );
});
