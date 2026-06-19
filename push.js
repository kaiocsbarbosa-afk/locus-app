/* ============================================================
   PUSH.JS — Inscrição e envio de notificações push
   ============================================================ */

import { supabase, dispararAlerta } from './utils.js'

const VAPID_PUBLIC_KEY = 'BHweJ-6fq5qkclX2bcySbRjfkqAItvHfxrano1xatzoZJW7eyR621fcQ8xLstojUOdjJafsX5SSzVzr0hs7VlU0';

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4aHVxYmZ6d2tvYmhydmx6d2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjIyOTgsImV4cCI6MjA5NTU5ODI5OH0.ZtKv5X2Zxjp80Cjmvy0NzFDqadBYUvWBZHH12iD8x84';

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
// ID de dispositivo persistente — gerado uma vez e salvo no
// localStorage. Usado para identificar e substituir a inscrição
// antiga deste dispositivo quando o endpoint muda.
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
        const deviceId = obterDeviceId();

        // Remove qualquer inscrição antiga deste mesmo dispositivo
        // (endpoint pode ter mudado após reinstalar o app/limpar cache)
        await supabase
            .from('inscricoes_push')
            .delete()
            .eq('device_id', deviceId);

        const { error } = await supabase
            .from('inscricoes_push')
            .insert({
                professor_id: professorId,
                endpoint: subJson.endpoint,
                p256dh: subJson.keys.p256dh,
                auth: subJson.keys.auth,
                tipo: tipo,
                device_id: deviceId
            });

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
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
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
