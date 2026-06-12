/* ============================================================
   UTILS.JS — Código compartilhado entre professor.js e cadrasto.js
   ============================================================ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// ------------------------------------------------------------
// Cliente Supabase único — evita duplicar a conexão em cada arquivo
// ------------------------------------------------------------
const SUPABASE_URL = 'https://ixhuqbfzwkobhrvlzwgm.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4aHVxYmZ6d2tvYmhydmx6d2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjIyOTgsImV4cCI6MjA5NTU5ODI5OH0.ZtKv5X2Zxjp80Cjmvy0NzFDqadBYUvWBZHH12iD8x84'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ------------------------------------------------------------
// Dark mode — compartilhado entre todas as páginas
// ------------------------------------------------------------
export function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const ativado = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', ativado ? 'enabled' : 'disabled');

    const btn = document.getElementById('txt-modo');
    if (btn) btn.innerText = ativado ? '☀️ Claro' : '🌙 Escuro';
}

export function carregarPreferenciaModo() {
    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('txt-modo');
        if (btn) btn.innerText = '☀️ Claro';
    }
}

// Expõe globalmente para o atributo onclick="toggleDarkMode()" no HTML
window.toggleDarkMode = toggleDarkMode;

// ------------------------------------------------------------
// Registro do Service Worker — compartilhado entre todas as páginas
// ------------------------------------------------------------
export function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('PWA Service Worker ativo!', reg.scope))
            .catch(err => console.warn('Falha no registro do Service Worker', err));
    }
}

// ------------------------------------------------------------
// Alerta padronizado (fallback caso SweetAlert2 não carregue)
// ------------------------------------------------------------
export function dispararAlerta(config) {
    if (typeof Swal !== 'undefined') {
        Swal.fire(config);
    } else {
        alert(`${config.title}: ${config.text}`);
    }
}

// ------------------------------------------------------------
// Formata um objeto Date para 'YYYY-MM-DD'
// ------------------------------------------------------------
export function formatarData(dataObj) {
    const ano = dataObj.getFullYear();
    const mes = String(dataObj.getMonth() + 1).padStart(2, '0');
    const dia = String(dataObj.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}
