// IMPORTANTE: incremente a versão do cache a cada deploy
// para garantir que usuários recebam os arquivos atualizados
const CACHE_NAME = 'locus-cache-v7';

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
  './professor.js',
  './coordenacao.js',
  './cadrasto.js',
  './apple-touch-icon.png',
  './icon-96.png',
  './icon-192.png',
  './icon-512.png',
  './icon-notification.png',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11'
];

self.addEventListener('install', e => {
  // Força ativação imediata sem esperar abas antigas fecharem
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Instalando cache', CACHE_NAME, '...');
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => {
      console.log('[SW]', CACHE_NAME, 'ativo.');
      // Assume controle de todas as abas abertas imediatamente
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', e => {
  // Estratégia: Network first para JS/HTML, cache first para assets estáticos
  const url = new URL(e.request.url);
  const isJS  = url.pathname.endsWith('.js');
  const isHTML = url.pathname.endsWith('.html') || url.pathname === '/';

  if (isJS || isHTML) {
    // Network first: busca a versão mais recente, cai no cache se offline
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match(e.request).then(cached => cached || new Response('Offline', { status: 503 })))
    );
  } else {
    // Cache first: imagens, fontes, CSS
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => new Response('', { status: 503 })))
    );
  }
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
      badge: './icon-notification.png',
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
