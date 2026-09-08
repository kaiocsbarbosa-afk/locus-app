/* ============================================================
   UTILS.JS — Código compartilhado (versão com Supabase Auth)
   ============================================================ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// ------------------------------------------------------------
// Cliente Supabase único
// A chave pública (anon) é segura para o navegador e protegida por RLS.
// Chaves administrativas (service_role e secrets) são mantidas no .env (git-ignored)
// ------------------------------------------------------------
const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || 'https://ixhuqbfzwkobhrvlzwgm.supabase.co'
const SUPABASE_KEY = window.__ENV__?.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4aHVxYmZ6d2tvYmhydmx6d2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjIyOTgsImV4cCI6MjA5NTU5ODI5OH0.ZtKv5X2Zxjp80Cjmvy0NzFDqadBYUvWBZHH12iD8x84'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        // Persiste a sessão JWT no localStorage automaticamente
        persistSession: true,
        // Renova o token automaticamente antes de expirar
        autoRefreshToken: true,
        // Detecta sessão na URL (útil para magic links futuros)
        detectSessionInUrl: false,
    }
})

// ------------------------------------------------------------
// Gerenciamento de Turnos (Manhã Integral x EJA Noturno)
// ------------------------------------------------------------
export const GRADE_HORARIOS_MANHA = {
    1: { inicioMinutos: 7 * 60,       fimMinutos: 7 * 60 + 50,  inicio: '07:00', fim: '07:50' },
    2: { inicioMinutos: 7 * 60 + 50,  fimMinutos: 8 * 60 + 40,  inicio: '07:50', fim: '08:40' },
    3: { inicioMinutos: 9 * 60,       fimMinutos: 9 * 60 + 50,  inicio: '09:00', fim: '09:50' },
    4: { inicioMinutos: 9 * 60 + 50,  fimMinutos: 10 * 60 + 40, inicio: '09:50', fim: '10:40' },
    5: { inicioMinutos: 10 * 60 + 40, fimMinutos: 11 * 60 + 30, inicio: '10:40', fim: '11:30' },
    6: { inicioMinutos: 12 * 60 + 20, fimMinutos: 13 * 60 + 10, inicio: '12:20', fim: '13:10' },
    7: { inicioMinutos: 13 * 60 + 10, fimMinutos: 14 * 60,      inicio: '13:10', fim: '14:00' },
};

export const GRADE_HORARIOS_EJA = {
    1: { inicioMinutos: 18 * 60,       fimMinutos: 18 * 60 + 50,  inicio: '18:00', fim: '18:50' },
    2: { inicioMinutos: 18 * 60 + 50,  fimMinutos: 19 * 60 + 40,  inicio: '18:50', fim: '19:40' },
    3: { inicioMinutos: 20 * 60,       fimMinutos: 20 * 60 + 50,  inicio: '20:00', fim: '20:50' },
    4: { inicioMinutos: 20 * 60 + 50,  fimMinutos: 21 * 60 + 40, inicio: '20:50', fim: '21:40' },
};

export function getTurnoAtivo() {
    return localStorage.getItem('locus_turno') || 'manha'
}

export function setTurnoAtivo(turno) {
    const turnoNormalizado = turno === 'eja' ? 'eja' : 'manha'
    localStorage.setItem('locus_turno', turnoNormalizado)
    window.dispatchEvent(new CustomEvent('locus:turno_alterado', { detail: { turno: turnoNormalizado } }))
    return turnoNormalizado
}

export function obterTotalAulasTurno(turno = getTurnoAtivo()) {
    return turno === 'eja' ? 4 : 7;
}

export function detectarTurnoTurma(turmaNome) {
    if (!turmaNome) return 'manha';
    const nomeNorm = String(turmaNome).toUpperCase();
    const isEja = nomeNorm.includes('EJA') || nomeNorm.includes('E.J.A.') || nomeNorm.includes('NOTURNO') || nomeNorm.includes('NOITE');
    return isEja ? 'eja' : 'manha';
}

export function obterHorarioAula(numeroAula, turno = getTurnoAtivo()) {
    const grade = turno === 'eja' ? GRADE_HORARIOS_EJA : GRADE_HORARIOS_MANHA;
    if (grade[numeroAula]) {
        return grade[numeroAula];
    }
    const baseHora = turno === 'eja' ? 18 : 7;
    const inicioMinutos = baseHora * 60 + (numeroAula - 1) * 50;
    const fimMinutos = inicioMinutos + 50;
    const formatarMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return {
        inicioMinutos,
        fimMinutos,
        inicio: formatarMin(inicioMinutos),
        fim: formatarMin(fimMinutos)
    };
}

export const COORD_EMAIL = 'coordenacao@locus.interno'

/**
 * Retorna as informações da sessão ativa:
 * { tipo: 'coordenacao' | 'professor' | null, session, professor }
 */
export async function getInfoSessaoAtual() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { tipo: null, session: null, professor: null }

    if (session.user?.email === COORD_EMAIL) {
        return { tipo: 'coordenacao', session, professor: null }
    }

    const { data: professor } = await supabase
        .from('professores')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .single()

    if (professor) {
        return { tipo: 'professor', session, professor }
    }

    return { tipo: null, session, professor: null }
}

/**
 * Retorna o professor logado buscando pelo auth_user_id do JWT atual.
 * Substitui o antigo localStorage.getItem('prof_pin')
 */
export async function getProfessorLogado() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    if (session.user?.email === COORD_EMAIL) return null

    const { data: professor, error } = await supabase
        .from('professores')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .single()

    if (error || !professor) return null
    return professor
}

/**
 * Logout do usuário — invalida o JWT no servidor.
 */
export async function fazerLogoutAuth() {
    await supabase.auth.signOut()
    window.location.href = 'index.html'
}

// ------------------------------------------------------------
// Dark mode
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

window.toggleDarkMode = toggleDarkMode;

// ------------------------------------------------------------
// Service Worker
// ------------------------------------------------------------
export function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('PWA Service Worker ativo!', reg.scope))
            .catch(err => console.warn('Falha no registro do Service Worker', err));
    }
}

// ------------------------------------------------------------
// Alerta padronizado
// ------------------------------------------------------------
export function dispararAlerta(config) {
    if (typeof Swal !== 'undefined') {
        Swal.fire(config);
    } else {
        alert(`${config.title}: ${config.text}`);
    }
}

// ------------------------------------------------------------
// Formata Date para 'YYYY-MM-DD'
// ------------------------------------------------------------
export function formatarData(dataObj) {
    const ano = dataObj.getFullYear();
    const mes = String(dataObj.getMonth() + 1).padStart(2, '0');
    const dia = String(dataObj.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}
