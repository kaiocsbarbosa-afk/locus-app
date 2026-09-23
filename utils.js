/* ============================================================
   UTILS.JS — Código compartilhado (versão com Supabase Auth)
   ============================================================ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// ------------------------------------------------------------
// Cliente Supabase único
// Credenciais carregadas de forma segura via env.js (ignorado no Git)
// ------------------------------------------------------------
export const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || 'https://ixhuqbfzwkobhrvlzwgm.supabase.co'
export const SUPABASE_KEY = window.__ENV__?.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4aHVxYmZ6d2tvYmhydmx6d2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjIyOTgsImV4cCI6MjA5NTU5ODI5OH0.ZtKv5X2Zxjp80Cjmvy0NzFDqadBYUvWBZHH12iD8x84'


export const supabase = (SUPABASE_URL && SUPABASE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            // Persiste a sessão JWT no localStorage automaticamente
            persistSession: true,
            // Renova o token automaticamente antes de expirar
            autoRefreshToken: true,
            // Detecta sessão na URL (útil para magic links futuros)
            detectSessionInUrl: false,
        }
    })
    : (() => {
        const dummyClient = createClient('https://placeholder.supabase.co', 'placeholder-key', {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            }
        });
        // Desativa conexão Realtime do cliente placeholder para evitar erros recorrentes de net::ERR_NAME_NOT_RESOLVED
        const noopChannel = {
            on: function() { return this; },
            subscribe: function() { return this; },
            unsubscribe: function() { return Promise.resolve(); }
        };
        dummyClient.channel = () => noopChannel;
        return dummyClient;
    })();

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

export function detectarTurnoHorarioAtual() {
    try {
        const agoraSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
        const hora = agoraSp.getHours();
        const minutos = agoraSp.getMinutes();
        const tempoEmMinutos = hora * 60 + minutos;
        // A partir das 17:30 (1050 minutos) ativa automaticamente o EJA Noturno
        return tempoEmMinutos >= 1050 ? 'eja' : 'manha';
    } catch (_) {
        return 'manha';
    }
}

export function getTurnoAtivo() {
    const salvo = localStorage.getItem('locus_turno');
    if (salvo === 'manha' || salvo === 'eja') {
        return salvo;
    }
    return detectarTurnoHorarioAtual();
}

export function setTurnoAtivo(turno) {
    const turnoNormalizado = turno === 'eja' ? 'eja' : 'manha';
    localStorage.setItem('locus_turno', turnoNormalizado);
    window.dispatchEvent(new CustomEvent('locus:turno_alterado', { detail: { turno: turnoNormalizado } }));
    return turnoNormalizado;
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

// ------------------------------------------------------------
// Monitor de Conexão Online/Offline
// ------------------------------------------------------------
export function configurarMonitorConexao() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    let banner = document.getElementById('locus-offline-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'locus-offline-banner';
        banner.style.cssText = `
            position: fixed;
            top: 14px;
            left: 50%;
            transform: translateX(-50%) translateY(-120px);
            z-index: 999999;
            padding: 8px 18px;
            border-radius: 50px;
            font-size: 0.84rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 18px rgba(0,0,0,0.18);
            transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
            opacity: 0;
            pointer-events: none;
            font-family: inherit;
        `;
        document.body.appendChild(banner);
    }

    let hideTimer = null;

    function exibirStatus(online) {
        clearTimeout(hideTimer);
        if (!online) {
            banner.style.background = '#dc3c3c';
            banner.style.color = '#ffffff';
            banner.innerHTML = `<span>📡</span> Modo Offline — Sem conexão com a internet`;
            banner.style.opacity = '1';
            banner.style.transform = 'translateX(-50%) translateY(0)';
        } else {
            banner.style.background = '#059669';
            banner.style.color = '#ffffff';
            banner.innerHTML = `<span>⚡</span> Conexão restabelecida!`;
            banner.style.opacity = '1';
            banner.style.transform = 'translateX(-50%) translateY(0)';
            hideTimer = setTimeout(() => {
                banner.style.opacity = '0';
                banner.style.transform = 'translateX(-50%) translateY(-120px)';
            }, 2500);
        }
    }

    window.addEventListener('offline', () => exibirStatus(false));
    window.addEventListener('online', () => exibirStatus(true));

    if (!navigator.onLine) {
        exibirStatus(false);
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', configurarMonitorConexao);
    } else {
        configurarMonitorConexao();
    }
}

// ------------------------------------------------------------
// Rate Limiting de Login (Proteção contra Força Bruta)
// Regra: Máximo 5 tentativas incorretas; ao atingir, bloqueio de 1 minuto (60s).
// ------------------------------------------------------------
const LIMITE_TENTATIVAS_LOGIN = 5;
const TEMPO_BLOQUEIO_LOGIN_MS = 60 * 1000; // 1 minuto (60 segundos)

export function checarBloqueioLogin(chave = 'padrao') {
    const storageKey = `locus_rl_${chave}`;
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return { bloqueado: false, tentativas: 0, segundosRestantes: 0 };
        const dados = JSON.parse(raw);
        const agora = Date.now();
        if (dados.bloqueadoAte && dados.bloqueadoAte > agora) {
            const segundosRestantes = Math.ceil((dados.bloqueadoAte - agora) / 1000);
            return { bloqueado: true, tentativas: dados.tentativas || LIMITE_TENTATIVAS_LOGIN, segundosRestantes };
        }
        // Se o período de bloqueio expirou, limpa o registro
        if (dados.bloqueadoAte && dados.bloqueadoAte <= agora) {
            localStorage.removeItem(storageKey);
            return { bloqueado: false, tentativas: 0, segundosRestantes: 0 };
        }
        return { bloqueado: false, tentativas: dados.tentativas || 0, segundosRestantes: 0 };
    } catch (_) {
        return { bloqueado: false, tentativas: 0, segundosRestantes: 0 };
    }
}

export function registrarFalhaLogin(chave = 'padrao') {
    const storageKey = `locus_rl_${chave}`;
    try {
        const agora = Date.now();
        const estadoAtual = checarBloqueioLogin(chave);
        const novasTentativas = estadoAtual.tentativas + 1;

        if (novasTentativas >= LIMITE_TENTATIVAS_LOGIN) {
            const bloqueadoAte = agora + TEMPO_BLOQUEIO_LOGIN_MS;
            localStorage.setItem(storageKey, JSON.stringify({
                tentativas: novasTentativas,
                bloqueadoAte
            }));
            return { bloqueado: true, tentativas: novasTentativas, segundosRestantes: 60 };
        } else {
            localStorage.setItem(storageKey, JSON.stringify({
                tentativas: novasTentativas,
                bloqueadoAte: null
            }));
            return { bloqueado: false, tentativas: novasTentativas, segundosRestantes: 0 };
        }
    } catch (_) {
        return { bloqueado: false, tentativas: 1, segundosRestantes: 0 };
    }
}

export function resetarTentativasLogin(chave = 'padrao') {
    try {
        localStorage.removeItem(`locus_rl_${chave}`);
    } catch (_) {}
}

