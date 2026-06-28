// IMPORTANTE: incremente CACHE_VERSION a cada deploy para forçar atualização
const CACHE_VERSION = 'v8';
const CACHE_NAME    = `locus-cache-${CACHE_VERSION}`;

// Chave pública VAPID — necessária para renovar a subscription em pushsubscriptionchange
const VAPID_PUBLIC_KEY = 'BHweJ-6fq5qkclX2bcySbRjfkqAItvHfxrano1xatzoZJW7eyR621fcQ8xLstojUOdjJafsX5SSzVzr0hs7VlU0';

const ASSETS = [
  './',
  './index.html',
  './cadastro.html',
  './professor.html',
  './coordenacao.html',
  './manifest.json',
  './locus.css',
  './utils.js',
  './push.js',
  './professor.js',
  './coordenacao.js',
  './cadastro.js',
  './apple-touch-icon.png',
  './icon-96.png',
  './icon-192.png',
  './icon-512.png',
  './icon-notification.png',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
];

// ------------------------------------------------------------
// Conversão da chave VAPID de base64url → Uint8Array
// (necessária para pushManager.subscribe e pushsubscriptionchange)
// ------------------------------------------------------------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const output  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

// ────────────────────────────────────────────────────────────
// INSTALL — pré-carrega assets em cache
// ────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Instalando cache', CACHE_NAME);
      // addAll individual para não abortar tudo se um asset externo falhar
      return Promise.allSettled(ASSETS.map(url => cache.add(url)));
    })
  );
});

// ────────────────────────────────────────────────────────────
// ACTIVATE — limpa caches antigos e assume controle imediato
// ────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Removendo cache antigo:', k);
          return caches.delete(k);
        })
      ))
      .then(() => {
        console.log('[SW]', CACHE_NAME, 'ativo.');
        return self.clients.claim();
      })
  );
});

// ────────────────────────────────────────────────────────────
// FETCH — Network first para JS/HTML, Cache first para assets
// ────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  // Ignora requests não-GET e chamadas à API Supabase
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return;

  const url    = new URL(e.request.url);
  const isJS   = url.pathname.endsWith('.js');
  const isHTML = url.pathname.endsWith('.html') || url.pathname === '/';

  if (isJS || isHTML) {
    // Network first: sempre tenta buscar versão mais recente
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match(e.request)
          .then(cached => cached || new Response('Offline', { status: 503 }))
        )
    );
  } else {
    // Cache first: imagens, CSS, fontes
    e.respondWith(
      caches.match(e.request)
        .then(cached => cached || fetch(e.request)
          .then(res => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
            return res;
          })
          .catch(() => new Response('', { status: 503 }))
        )
    );
  }
});

// ────────────────────────────────────────────────────────────
// PUSH — exibe a notificação
// ────────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let dados = {
    title: 'Locus',
    body:  'Você tem uma nova atualização.',
    url:   './',
  };

  if (e.data) {
    try   { Object.assign(dados, e.data.json()); }
    catch { dados.body = e.data.text(); }
  }

  e.waitUntil(
    self.registration.showNotification(dados.title, {
      body:      dados.body,
      icon:      '/icon-192.png',
      badge:     '/icon-notification.png',
      vibrate:   [100, 50, 100],
      // URL passada pelo servidor — usada no notificationclick
      data:      { url: dados.url },
      // Evita empilhar notificações repetidas do mesmo evento
      tag:       'locus-notif',
      renotify:  true,
    })
  );
});

// ────────────────────────────────────────────────────────────
// NOTIFICATION CLICK — foca aba existente ou abre a URL correta
// ────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const url = e.notification.data?.url || './';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Tenta focar uma aba já aberta do app
        const aberta = clients.find(c =>
          c.url.startsWith(self.registration.scope)
        );
        if (aberta) {
          aberta.focus();
          return aberta.navigate(url);
        }
        // Nenhuma aba aberta — abre nova janela na URL certa
        return self.clients.openWindow(url);
      })
  );
});

// ────────────────────────────────────────────────────────────
// PUSH SUBSCRIPTION CHANGE
// Disparado quando o push service expira ou revoga a subscription
// (acontece silenciosamente — sem este handler as notificações
//  param de funcionar sem nenhum erro visível)
// ────────────────────────────────────────────────────────────
self.addEventListener('pushsubscriptionchange', e => {
  console.log('[SW] pushsubscriptionchange — renovando subscription...');

  e.waitUntil((async () => {
    try {
      // Cria nova subscription com a mesma chave VAPID
      const novaSub = await self.registration.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Avisa todos os clientes abertos para salvar no banco
      const clients = await self.clients.matchAll({
        type:              'window',
        includeUncontrolled: true,
      });

      if (clients.length > 0) {
        clients.forEach(client =>
          client.postMessage({
            type:         'PUSH_SUBSCRIPTION_CHANGED',
            subscription: novaSub.toJSON(),
          })
        );
        console.log('[SW] Subscription renovada — clientes notificados.');
      } else {
        // App fechado: armazena no cache para processar quando reabrir
        const cache = await caches.open(CACHE_NAME);
        await cache.put(
          '/__push_subscription_pending',
          new Response(JSON.stringify(novaSub.toJSON()))
        );
        console.log('[SW] Subscription renovada — salva para próxima abertura.');
      }
    } catch (err) {
      console.error('[SW] Erro ao renovar subscription:', err);
    }
  })());
});
