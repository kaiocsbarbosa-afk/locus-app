/* ============================================================
   PUSH.JS — Inscrição e envio de notificações push
   ============================================================ */

import { supabase, dispararAlerta } from './utils.js'

const VAPID_PUBLIC_KEY = 'BHweJ-6fq5qkclX2bcySbRjfkqAItvHfxrano1xatzoZJW7eyR621fcQ8xLstojUOdjJafsX5SSzVzr0hs7VlU0';

// ------------------------------------------------------------
// Converte a chave VAPID (base64url) para Uint8Array
// ------------------------------------------------------------
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = atob(base64);
    const output  = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
}

// ------------------------------------------------------------
// ID de dispositivo persistente — identifica este aparelho
// no banco para substituir subscriptions antigas quando o
// endpoint muda (reinstalação, limpeza de cache etc.)
// ------------------------------------------------------------
function obterDeviceId() {
    let id = localStorage.getItem('locus_device_id');
    if (!id) {
        id = 'dev_' + crypto.randomUUID();
        localStorage.setItem('locus_device_id', id);
    }
    return id;
}

// ------------------------------------------------------------
// Persiste tipo e professorId no localStorage para que o
// listener de pushsubscriptionchange consiga renovar sem
// o usuário precisar ativar manualmente de novo.
// ------------------------------------------------------------
function salvarContextoPush(tipo, professorId) {
    localStorage.setItem('locus_push_tipo', tipo);
    if (professorId) {
        localStorage.setItem('locus_push_professor_id', professorId);
    } else {
        localStorage.removeItem('locus_push_professor_id');
    }
}

// ------------------------------------------------------------
// Inscreve (ou renova) a subscription no banco.
// Chamado tanto pelo fluxo normal quanto pelo listener abaixo.
// ------------------------------------------------------------
async function salvarSubscriptionNoBanco(subJson, tipo, professorId, deviceId) {
    // Remove inscrição antiga deste dispositivo
    await supabase.from('inscricoes_push').delete().eq('device_id', deviceId);

    const { error } = await supabase.from('inscricoes_push').insert({
        professor_id: professorId ?? null,
        endpoint:     subJson.endpoint,
        p256dh:       subJson.keys.p256dh,
        auth:         subJson.keys.auth,
        tipo,
        device_id:    deviceId,
    });

    if (error) {
        console.error('[Push] Erro ao salvar inscrição:', error);
        return false;
    }
    return true;
}

// ------------------------------------------------------------
// Listener de mensagens do Service Worker.
// Recebe PUSH_SUBSCRIPTION_CHANGED quando a subscription
// expirou e o SW já criou uma nova — salva no banco sem
// o usuário precisar fazer nada.
// ------------------------------------------------------------
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async event => {
        if (event.data?.type !== 'PUSH_SUBSCRIPTION_CHANGED') return;

        const sub        = event.data.subscription;
        const deviceId   = obterDeviceId();
        const tipo       = localStorage.getItem('locus_push_tipo');
        const professorId = localStorage.getItem('locus_push_professor_id') || null;

        if (!tipo || !sub) return;

        const ok = await salvarSubscriptionNoBanco(sub, tipo, professorId, deviceId);
        console.log('[Push] Subscription renovada automaticamente:', ok ? 'OK' : 'ERRO');
    });

    // Verifica se há subscription pendente salva pelo SW enquanto o app estava fechado
    navigator.serviceWorker.ready.then(async reg => {
        const cache = await caches.open('locus-cache-v8');
        const resp  = await cache.match('/__push_subscription_pending').catch(() => null);
        if (!resp) return;

        const sub        = await resp.json().catch(() => null);
        const deviceId   = obterDeviceId();
        const tipo       = localStorage.getItem('locus_push_tipo');
        const professorId = localStorage.getItem('locus_push_professor_id') || null;

        if (sub && tipo) {
            await salvarSubscriptionNoBanco(sub, tipo, professorId, deviceId);
            await cache.delete('/__push_subscription_pending');
            console.log('[Push] Subscription pendente processada ao reabrir o app.');
        }
    }).catch(() => {});
}

// ------------------------------------------------------------
// Pede permissão e inscreve o dispositivo para push.
// tipo: 'professor' (precisa de professorId) ou 'coordenacao'
// ------------------------------------------------------------
export async function ativarNotificacoes(tipo, professorId = null) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[Push] Push não suportado neste navegador.');
        return false;
    }

    try {
        const permissao = await Notification.requestPermission();
        if (permissao !== 'granted') {
            console.log('[Push] Permissão negada pelo usuário.');
            return false;
        }

        const registration = await navigator.serviceWorker.ready;

        // Sempre cria/renova a subscription para garantir que o endpoint
        // está atualizado — especialmente importante no contexto do PWA
        // instalado, que tem contexto separado do browser.
        let subscription = await registration.pushManager.getSubscription();

        // Verifica se o endpoint ainda é válido comparando com o banco
        const deviceId     = obterDeviceId();
        const { data: row } = await supabase
            .from('inscricoes_push')
            .select('endpoint')
            .eq('device_id', deviceId)
            .eq('tipo', tipo)
            .maybeSingle();

        const endpointDesatualizado = !row || row.endpoint !== subscription?.endpoint;

        if (!subscription || endpointDesatualizado) {
            // Cria subscription nova (ou recria se o endpoint mudou)
            if (subscription) await subscription.unsubscribe();
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly:      true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            });
        }

        // Salva contexto para renovação automática futura
        salvarContextoPush(tipo, professorId);

        const ok = await salvarSubscriptionNoBanco(
            subscription.toJSON(), tipo, professorId, deviceId
        );

        if (!ok) return false;

        console.log('[Push] Notificações ativadas:', tipo);
        return true;

    } catch (err) {
        console.error('[Push] Erro ao ativar notificações:', err);
        return false;
    }
}

// ------------------------------------------------------------
// Dispara uma notificação via Edge Function.
// Usa supabase.functions.invoke — envia automaticamente o JWT
// do usuário logado, sem chave hardcoded.
// ------------------------------------------------------------
export async function enviarNotificacao(titulo, corpo, destino, professorId = null) {
    try {
        const { error } = await supabase.functions.invoke('enviar-notificacao', {
            body: {
                titulo,
                corpo,
                destino,
                professor_id: professorId,
            },
        });
        if (error) console.warn('[Push] Erro ao enviar notificação:', error);
    } catch (err) {
        // Notificação é "best effort" — não interrompe o fluxo principal
        console.warn('[Push] Falha ao chamar função de notificação:', err);
    }
}
