/* ============================================================
   PUSH.JS — Inscrição e envio de notificações push
   ============================================================ */

import { supabase, dispararAlerta } from './utils.js'

// Substitua pela sua chave pública VAPID (gerada com `npx web-push generate-vapid-keys`)
const VAPID_PUBLIC_KEY = 'COLE_AQUI_SUA_VAPID_PUBLIC_KEY';

const URL_FUNCAO_NOTIFICAR = 'https://ixhuqbfzwkobhrvlzwgm.supabase.co/functions/v1/enviar-notificacao';

// ------------------------------------------------------------
// Converte a chave VAPID (base64url) para o formato que a API
// PushManager espera (Uint8Array)
// ------------------------------------------------------------
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// ------------------------------------------------------------
// Pede permissão e inscreve o dispositivo para push.
// tipo: 'professor' (precisa de professorId) ou 'coordenacao'
// ------------------------------------------------------------
export async function ativarNotificacoes(tipo, professorId = null) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('Push não suportado neste navegador.');
        return false;
    }

    if (VAPID_PUBLIC_KEY === 'COLE_AQUI_SUA_VAPID_PUBLIC_KEY') {
        console.warn('VAPID_PUBLIC_KEY não configurada em push.js — notificações desativadas.');
        return false;
    }

    try {
        const permissao = await Notification.requestPermission();
        if (permissao !== 'granted') {
            console.log('Permissão de notificação negada pelo usuário.');
            return false;
        }

        const registration = await navigator.serviceWorker.ready;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }

        const subJson = subscription.toJSON();

        const { error } = await supabase
            .from('inscricoes_push')
            .upsert({
                professor_id: professorId,
                endpoint: subJson.endpoint,
                p256dh: subJson.keys.p256dh,
                auth: subJson.keys.auth,
                tipo: tipo
            }, { onConflict: 'professor_id,endpoint' });

        if (error) {
            console.error('Erro ao salvar inscrição push:', error);
            return false;
        }

        console.log('Notificações push ativadas:', tipo);
        return true;

    } catch (err) {
        console.error('Erro ao ativar notificações:', err);
        return false;
    }
}

// ------------------------------------------------------------
// Dispara uma notificação via Edge Function.
// destino: 'professor' (precisa professorId) ou 'coordenacao'
// ------------------------------------------------------------
export async function enviarNotificacao(titulo, corpo, destino, professorId = null) {
    try {
        const resp = await fetch(URL_FUNCAO_NOTIFICAR, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo,
                corpo,
                destino,
                professor_id: professorId
            })
        });

        if (!resp.ok) {
            console.warn('Falha ao enviar notificação:', await resp.text());
        }
    } catch (err) {
        // Notificação é "best effort" — não interrompe o fluxo principal se falhar
        console.warn('Erro ao chamar função de notificação:', err);
    }
}
