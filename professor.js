/* professor.js — login em 2 passos: selecionar nome → PIN */
import { supabase, registrarServiceWorker, getProfessorLogado, fazerLogoutAuth } from './utils.js'
import { ativarNotificacoes, enviarNotificacao } from './push.js'

let professorLogado = null;
let buscandoAulasAtualmente = false;
let telaAtual = 'agendar';


// ============================================================
//  INICIALIZAÇÃO
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
    registrarServiceWorker();

    // Verifica sessão JWT ativa — se professor já está logado, pula login
    const professor = await getProfessorLogado();
    if (professor) {
        professorLogado = professor;
        mostrarAppLogado();
    } else {
        // Sem sessão: mostra tela de login e carrega lista de nomes
        carregarListaNomesLogin();
        configurarPinBoxesGrande();
    }
});



// ============================================================
//  CARREGA LISTA DE NOMES
// ============================================================

// ── Paleta de cores determinística para os avatares ──────────
const _PROF_CORES = [
    ['#7c3aed','#5b21b6'], ['#4f46e5','#3730a3'], ['#0891b2','#0e7490'],
    ['#059669','#047857'], ['#d97706','#b45309'], ['#dc2626','#b91c1c'],
    ['#db2777','#be185d'], ['#9333ea','#7e22ce'], ['#2563eb','#1d4ed8'],
    ['#16a34a','#15803d'],
]
function _corAvatar(nome) {
    let h = 0;
    for (const c of nome) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
    const [c1, c2] = _PROF_CORES[Math.abs(h) % _PROF_CORES.length];
    return `linear-gradient(135deg,${c1},${c2})`;
}
function _iniciais(nome) {
    const p = nome.trim().split(/\s+/).filter(Boolean);
    return (p.length >= 2 ? p[0][0] + p[p.length-1][0] : p[0]?.slice(0,2) || '?').toUpperCase();
}

// Estado da seleção atual
let _profId   = null;
let _profNome = null;

// Carrega professores e monta o grid de cards
async function carregarListaNomesLogin() {
    const grid = document.getElementById('prof-grid');
    if (!grid) return;

    try {
        // RLS policy 'professores_select_anon' filtra automaticamente
        // só professores com auth_user_id IS NOT NULL.
        const { data, error } = await supabase
            .from('professores')
            .select('id, nome')
            .order('nome');

        if (error) throw error;

        // Guarda lista completa para o filtro de busca
        window._todosProfs = data || [];
        _renderizarCards(window._todosProfs);

        // Filtro em tempo real
        const busca = document.getElementById('prof-search');
        if (busca) {
            busca.addEventListener('input', () => {
                const q = busca.value.trim().toLowerCase();
                const filtrados = q
                    ? window._todosProfs.filter(p => p.nome.toLowerCase().includes(q))
                    : window._todosProfs;
                _renderizarCards(filtrados, q);
            });
        }

    } catch (err) {
        console.error('Erro ao carregar professores:', err);
        if (grid) grid.innerHTML = '<div class="prof-grid-vazio">Erro ao carregar professores.</div>';
    }
}

function _renderizarCards(lista, busca = '') {
    const grid = document.getElementById('prof-grid');
    if (!grid) return;

    if (!lista.length) {
        grid.innerHTML = `<div class="prof-grid-vazio">${busca ? '😕 Nenhum professor encontrado.' : 'Nenhum professor disponível.'}</div>`;
        return;
    }

    grid.innerHTML = '';

    lista.forEach((prof, i) => {
        const card = document.createElement('div');
        card.className = 'prof-card' + (prof.id === _profId ? ' selecionado' : '');
        card.style.animationDelay = `${Math.min(i, 5) * 0.04}s`;

        // Avatar
        const wrap = document.createElement('div');
        wrap.className = 'prof-avatar-wrap';

        const avatar = document.createElement('div');
        avatar.className = 'prof-avatar';
        avatar.style.background = _corAvatar(prof.nome);
        avatar.textContent = _iniciais(prof.nome);  // textContent — sem XSS

        const check = document.createElement('div');
        check.className = 'prof-check';
        check.textContent = '✓';

        wrap.appendChild(avatar);
        wrap.appendChild(check);

        // Nome
        const nomeEl = document.createElement('div');
        nomeEl.className = 'prof-card-nome';
        nomeEl.textContent = prof.nome;  // textContent — sem XSS

        card.appendChild(wrap);
        card.appendChild(nomeEl);
        card.addEventListener('click', () => _selecionarCard(card, prof.id, prof.nome));
        grid.appendChild(card);
    });
}

function _selecionarCard(card, id, nome) {
    // Desmarca o anterior
    document.querySelectorAll('.prof-card.selecionado').forEach(c => c.classList.remove('selecionado'));
    // Marca o novo
    card.classList.add('selecionado');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    _profId   = id;
    _profNome = nome;

    const btn = document.getElementById('btn-continuar');
    if (btn) { btn.disabled = false; btn.classList.add('ativo'); }
}

// Navega para o passo 2 (PIN)
window.irParaPin = function() {
    if (!_profId || !_profNome) return;

    const elIniciais = document.getElementById('pin-avatar-iniciais');
    const elNome     = document.getElementById('pin-usuario-nome');
    if (elIniciais) elIniciais.textContent = _iniciais(_profNome);
    if (elNome)     elNome.textContent     = _profNome;

    // Limpa PIN
    const inputReal = document.getElementById('pin-input-real');
    if (inputReal) inputReal.value = '';
    [0,1,2,3].forEach(i => {
        const d  = document.getElementById('pd' + i);
        const ch = document.getElementById('pc' + i);
        if (d)  { d.classList.remove('ativo', 'preenchido'); if (i === 0) d.classList.add('ativo'); }
        if (ch) ch.textContent = '';
    });

    document.getElementById('login-step1').style.display = 'none';
    document.getElementById('login-step2').style.display = 'flex';
    setTimeout(() => document.getElementById('pin-input-real')?.focus(), 150);
}

// Volta ao passo 1 sem perder a seleção
window.voltarStep1 = function() {
    document.getElementById('login-step2').style.display = 'none';
    document.getElementById('login-step1').style.display = 'flex';
    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) { btnLogin.disabled = true; btnLogin.classList.remove('ativo'); btnLogin.textContent = 'Entrar'; }
    // Foca a busca se houver texto
    const busca = document.getElementById('prof-search');
    if (busca?.value) busca.focus();
}

// ============================================================
//  PIN — input único invisível, visuais atualizados via JS
// ============================================================

function configurarPinBoxesGrande() {
    const inputReal = document.getElementById('pin-input-real');
    const dots  = [0,1,2,3].map(i => document.getElementById('pd' + i));
    const chars = [0,1,2,3].map(i => document.getElementById('pc' + i));
    if (!inputReal || !dots[0]) return;

    function atualizarDots(val) {
        dots.forEach((dot, i) => {
            dot.classList.remove('ativo', 'preenchido');
            if (i < val.length) {
                // Preenchido: mostra ● no span e esconde o ::before via classe
                chars[i].textContent = '●';
                dot.classList.add('preenchido');
            } else {
                // Vazio: limpa o span (::before aparece como placeholder)
                chars[i].textContent = '';
                if (i === val.length) dot.classList.add('ativo');
            }
        });
    }

    // Estado inicial: primeiro dot ativo (mostra onde digitar)
    atualizarDots('');

    inputReal.addEventListener('focus', () => {
        const val = inputReal.value.replace(/\D/g, '').slice(0, 4);
        atualizarDots(val);
    });

    inputReal.addEventListener('blur', () => {
        dots.forEach(d => d.classList.remove('ativo'));
    });

    inputReal.addEventListener('input', () => {
        const val = inputReal.value.replace(/\D/g, '').slice(0, 4);
        inputReal.value = val;
        atualizarDots(val);
        if (val.length === 4) fazerLogin();
    });

    // Clique em qualquer lugar do wrapper foca o input
    document.querySelector('.pin-wrapper')?.addEventListener('click', () => inputReal.focus());
}

// ============================================================
//  AUTENTICAÇÃO
// ============================================================

function limparPin() {
    const inputReal = document.getElementById('pin-input-real');
    if (inputReal) {
        inputReal.value = '';
        inputReal.dispatchEvent(new Event('input')); // atualiza os dots
        setTimeout(() => inputReal.focus(), 50);
    }
}

// ── FEEDBACK DE ERRO NO PIN (sem popup) ─────────────────────
// Tremida + flash vermelho + mensagem inline + vibração háptica
function erroPin(mensagem, isRateLimit = false) {
    const dotsWrap = document.querySelector('.pin-dots');
    const dots     = [0,1,2,3].map(i => document.getElementById('pd' + i));
    const erroMsg  = document.getElementById('pin-erro-msg');

    // 1. Vibração háptica (celular)
    if (navigator.vibrate) navigator.vibrate(isRateLimit ? [120, 60, 120, 60, 120] : [80, 40, 80]);

    // 2. Flash vermelho nos dots + tremida no container
    dots.forEach(d => d?.classList.add('pin-erro'));
    dotsWrap?.classList.add('pin-shake');

    // 3. Mensagem inline
    if (erroMsg) {
        erroMsg.textContent = mensagem;
        erroMsg.classList.add('visivel');
    }

    // 4. Remove shake (permite reanimar na próxima tentativa)
    dotsWrap?.addEventListener('animationend', function handler() {
        dotsWrap.classList.remove('pin-shake');
        dotsWrap.removeEventListener('animationend', handler);
    });

    // 5. Limpa dots vermelhos e PIN após curta pausa visual
    setTimeout(() => {
        dots.forEach(d => d?.classList.remove('pin-erro'));
        limparPin();
    }, 480);

    // 6. Esconde a mensagem depois de 2.5s
    setTimeout(() => {
        if (erroMsg) erroMsg.classList.remove('visivel');
    }, 2500);
}

window.fazerLogin = async function() {
    const profId = _profId;   // definido em _selecionarCard()
    const pin = (document.getElementById('pin-input-real')?.value || '').replace(/\D/g, '').slice(0, 4);

    if (!profId) {
        limparPin();
        return Swal.fire({ icon: 'warning', title: 'Selecione seu nome', text: 'Escolha seu nome na lista antes de continuar.', confirmButtonColor: '#7c3aed' });
    }

    if (pin.length < 4) {
        return; // auto-login só dispara quando pin.length === 4
    }

    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) { btnLogin.innerText = 'Entrando... ⏳'; btnLogin.disabled = true; }

    try {
        const emailFicticio = `prof-${profId}@locus.interno`;

        const { data, error } = await supabase.auth.signInWithPassword({
            email: emailFicticio,
            password: pin
        });

        if (error || !data.session) {
            if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }
            const isRateLimit = error?.message?.includes('rate limit');
            const mensagem = isRateLimit
                ? 'Muitas tentativas. Aguarde.'
                : 'PIN incorreto. Tente novamente.';
            erroPin(mensagem, isRateLimit);
            return;
        }

        professorLogado = await getProfessorLogado();

        if (!professorLogado) {
            await supabase.auth.signOut();
            if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }
            erroPin('Perfil não encontrado. Contate a coordenação.');
            return;
        }

        if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }
        mostrarAppLogado();

    } catch (err) {
        console.error('Erro no login:', err);
        if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }
        erroPin('Erro de conexão. Tente novamente.');
    }
}

window.fazerLogout = async function() {
    // Zera todo o estado local para não vazar para a próxima sessão no mesmo dispositivo
    _profId     = null;
    _profNome   = null;
    _semOffset  = 0;
    _semDiaIdx  = -1;
    _semDados   = null;
    _semSalaId  = null;
    professorLogado = null;
    await fazerLogoutAuth();
}

function mostrarAppLogado() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('app-header').classList.add('visivel');

    const statusBanner = document.getElementById('status-usuario');
    if (statusBanner) statusBanner.style.display = 'flex';

    // Saudação personalizada com período do dia
    const hora = new Date().getHours();
    const periodo = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const emoji   = hora < 12 ? '☀️' : hora < 18 ? '🌤️' : '🌙';
    const primeiroNome = professorLogado.nome?.split(' ')[0] || professorLogado.nome;

    const elPeriodo = document.getElementById('saudacao-periodo');
    const elNome    = document.getElementById('saudacao-nome');
    const elDisc    = document.getElementById('saudacao-disciplina');
    if (elPeriodo) elPeriodo.innerHTML = `<span class="greeting-dot">${emoji}</span> ${periodo}!`;
    if (elNome)    elNome.textContent    = primeiroNome;
    if (elDisc)    elDisc.textContent    = professorLogado.disciplina || '';

    // Atualiza avatar do banner
    const avatarBanner = document.getElementById('perfil-avatar');
    if (avatarBanner && professorLogado.nome) {
        avatarBanner.style.background = _corAvatar(professorLogado.nome);
        avatarBanner.innerHTML = `<span style="font-size:1.1rem;font-weight:700;color:#fff;">${_iniciais(professorLogado.nome)}</span>`;
    }

    document.getElementById('tela-agendar').classList.add('ativa');
    configurarCalendarioSemana();
    carregarTurmas();
    carregarSalas();
    carregarHistorico();

    // Mostra banner de notificações se ainda não foi permitido/negado
    setTimeout(() => verificarBannerNotificacoes(), 1200);

    // Renova silenciosamente a subscription push se a permissão já foi concedida.
    // Essencial para o PWA instalado: o contexto standalone é isolado do browser —
    // a subscription feita no Safari/Chrome não vale aqui. Ao reabrir o app instalado,
    // ativarNotificacoes detecta o endpoint desatualizado e recria automaticamente.
    if (Notification.permission === 'granted' && professorLogado?.id) {
        ativarNotificacoes('professor', professorLogado.id)
            .catch(() => {}); // silencioso — não interrompe o fluxo
    }
}

function verificarBannerNotificacoes() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    // Verifica se é o primeiro login (nunca tinha chave de sessão)
    const chaveLogin = `locus_logado_${professorLogado?.id}`;
    const primeiroLogin = !localStorage.getItem(chaveLogin);

    if (primeiroLogin) {
        // Marca que já logou antes
        localStorage.setItem(chaveLogin, '1');
        // Mostra banner verde de boas-vindas com CTA de notificação
        const bannerAprovado = document.getElementById('banner-aprovado');
        if (bannerAprovado && Notification.permission === 'default') {
            bannerAprovado.style.display = 'flex';
            return; // não mostra o banner roxo por cima
        }
    }

    // Login normal — mostra banner roxo só se permissão ainda não foi decidida
    const banner = document.getElementById('banner-notif');
    if (!banner) return;

    if (Notification.permission === 'default' && !sessionStorage.getItem('banner_notif_dispensado')) {
        banner.style.display = 'flex';
    } else {
        banner.style.display = 'none';
    }
}

window.ativarNotifPrimeiroLogin = async function() {
    const bannerAprovado = document.getElementById('banner-aprovado');
    const btn = bannerAprovado?.querySelector('.btn-aprovado-notif');
    if (btn) { btn.textContent = 'Ativando...'; btn.disabled = true; }

    const sucesso = await ativarNotificacoes('professor', professorLogado?.id);

    if (bannerAprovado) bannerAprovado.style.display = 'none';

    if (sucesso) {
        Swal.fire({ icon: 'success', title: '🔔 Tudo pronto!', text: 'Você receberá lembretes antes das suas aulas.', confirmButtonColor: '#059669', timer: 2800, showConfirmButton: false });
    } else if (Notification.permission === 'denied') {
        Swal.fire({ icon: 'info', title: 'Notificações bloqueadas', text: 'Você pode ativar depois em Configurações do navegador → Notificações → Locus.', confirmButtonColor: '#7c3aed' });
    }
    atualizarStatusNotificacoes();
}

window.fecharBannerAprovado = function() {
    const b = document.getElementById('banner-aprovado');
    if (b) b.style.display = 'none';
    // Mostra o banner roxo padrão já que a permissão ainda não foi dada
    setTimeout(() => {
        const bn = document.getElementById('banner-notif');
        if (bn && Notification.permission === 'default') bn.style.display = 'flex';
    }, 500);
}

window.ativarNotifBanner = async function() {
    const banner = document.getElementById('banner-notif');
    const btnBanner = document.getElementById('btn-notif-banner');
    if (btnBanner) { btnBanner.textContent = 'Ativando...'; btnBanner.disabled = true; }

    const sucesso = await ativarNotificacoes('professor', professorLogado?.id);

    if (sucesso) {
        if (banner) banner.style.display = 'none';
        Swal.fire({ icon: 'success', title: '🔔 Notificações ativas!', text: 'Você receberá lembretes 5 min antes de cada aula e alertas de reserva.', confirmButtonColor: '#059669', timer: 3000, showConfirmButton: false });
    } else {
        if (btnBanner) { btnBanner.textContent = 'Permitir'; btnBanner.disabled = false; }
        if (Notification.permission === 'denied') {
            if (banner) banner.style.display = 'none'; // esconde se negou definitivamente
            Swal.fire({ icon: 'info', title: 'Notificações bloqueadas', text: 'Para ativar, vá em Configurações do navegador → Notificações → Locus → Permitir.', confirmButtonColor: '#7c3aed' });
        }
    }

    atualizarStatusNotificacoes();
}

window.fecharBannerNotif = function() {
    const banner = document.getElementById('banner-notif');
    if (banner) banner.style.display = 'none';
    // Guarda que o professor dispensou — não mostra de novo nesta sessão
    sessionStorage.setItem('banner_notif_dispensado', '1');
}

// ============================================================
//  NAVEGAÇÃO
// ============================================================

const TELAS = {
    'agendar':      { titulo: 'Agendar',      elemento: 'tela-agendar' },
    'semana':       { titulo: 'Semana',        elemento: 'tela-semana' },
    'minhas-aulas': { titulo: 'Minhas aulas',  elemento: 'tela-minhas-aulas' },
    'perfil':       { titulo: 'Perfil',        elemento: 'tela-perfil' },
};

const ORDEM_TELAS_NAV = ['agendar', 'semana', 'minhas-aulas', 'perfil'];

window.trocarTela = function(nomeTela) {
    if (nomeTela === telaAtual) return;

    // Determina direção da animação
    const idxAtual = ORDEM_TELAS_NAV.indexOf(telaAtual);
    const idxNova  = ORDEM_TELAS_NAV.indexOf(nomeTela);
    const classe   = idxNova > idxAtual ? 'entrando-direita' : 'entrando-esquerda';

    telaAtual = nomeTela;

    const header = document.getElementById('header-titulo');
    if (header) header.textContent = TELAS[nomeTela]?.titulo || 'Locus';

    Object.entries(TELAS).forEach(([id, cfg]) => {
        const el = document.getElementById(cfg.elemento);
        if (!el) return;
        if (id === nomeTela) {
            el.classList.add('ativa', classe);
            setTimeout(() => el.classList.remove(classe), 300);
        } else {
            el.classList.remove('ativa');
        }
    });

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('ativa'));
    const tab = document.getElementById(`tab-${nomeTela}`);
    if (tab) tab.classList.add('ativa');

    document.querySelectorAll('.stitch-tab').forEach(t => t.classList.remove('ativa'));
    const topTab = document.getElementById(`top-tab-${nomeTela}`);
    if (topTab) topTab.classList.add('ativa');

    if (nomeTela === 'semana') carregarVisaoSemanal();
    if (nomeTela === 'minhas-aulas') carregarHistorico();
    if (nomeTela === 'perfil') atualizarPerfil();
}

function atualizarPerfil() {
    if (!professorLogado) return;
    const nome = document.getElementById('perfil-nome');
    const disc = document.getElementById('perfil-disciplina');
    if (nome) nome.textContent = professorLogado.nome;
    if (disc) disc.textContent = professorLogado.disciplina || 'Sem disciplina';

    // Iniciais dinâmicas no avatar
    const iniciais = document.getElementById('perfil-iniciais');
    if (iniciais && professorLogado.nome) {
        const partes = professorLogado.nome.trim().split(' ').filter(Boolean);
        const sigla = partes.length >= 2
            ? partes[0][0] + partes[partes.length - 1][0]
            : partes[0]?.slice(0, 2) || '?';
        iniciais.textContent = sigla.toUpperCase();
    }

    atualizarStatusNotificacoes();
}

function atualizarStatusNotificacoes() {
    const desc = document.getElementById('status-notif-desc');
    const btn = document.getElementById('btn-notif');
    const switchEl = document.getElementById('btn-notif-switch');
    if (!desc) return;

    const perm = Notification?.permission;
    if (perm === 'granted') {
        desc.textContent = 'Ativas — lembretes e avisos habilitados';
        if (btn) { btn.textContent = 'Reativar'; btn.disabled = false; }
        if (switchEl) { switchEl.checked = true; switchEl.disabled = false; }
    } else if (perm === 'denied') {
        desc.textContent = 'Bloqueadas — habilite nas configurações do navegador';
        if (btn) { btn.textContent = 'Bloqueadas'; btn.disabled = true; }
        if (switchEl) { switchEl.checked = false; switchEl.disabled = true; }
    } else {
        desc.textContent = 'Toque para ativar lembretes de aula';
        if (btn) { btn.textContent = 'Ativar'; btn.disabled = false; }
        if (switchEl) { switchEl.checked = false; switchEl.disabled = false; }
    }
}

window.gerenciarNotificacoes = async function() {
    if (Notification?.permission === 'denied') {
        Swal.fire({ icon: 'info', title: 'Notificações bloqueadas', text: 'Vá em Configurações do navegador → Notificações → Locus e permita.', confirmButtonColor: '#7c3aed' });
        return;
    }
    const btn = document.getElementById('btn-notif');
    if (btn) { btn.textContent = 'Ativando...'; btn.disabled = true; }
    const sucesso = await ativarNotificacoes('professor', professorLogado?.id);
    if (sucesso) {
        Swal.fire({ icon: 'success', title: 'Notificações ativas!', text: 'Você receberá lembretes 5 minutos antes de cada aula.', confirmButtonColor: '#059669', timer: 2500, showConfirmButton: false });
    } else {
        Swal.fire({ icon: 'warning', title: 'Permissão necessária', text: 'Permita as notificações quando o navegador perguntar.', confirmButtonColor: '#7c3aed' });
    }
    if (btn) btn.disabled = false;
    atualizarStatusNotificacoes();
}

// ============================================================
//  DADOS
// ============================================================

async function carregarTurmas() {
    const select = document.getElementById('select-turma');
    try {
        const { data, error } = await supabase.from('turmas').select('id, nome').order('nome', { ascending: true });
        if (error) throw error;
        select.innerHTML = '<option value="">Selecione a turma...</option>';
        data.forEach(t => {
            const o = document.createElement('option');
            o.value = t.id; o.textContent = t.nome;
            select.appendChild(o);
        });
    } catch (err) { console.error("Erro ao carregar turmas:", err); }
}

async function carregarSalas() {
    const select = document.getElementById('select-sala');
    try {
        const { data, error } = await supabase.from('salas').select('id, nome').order('nome', { ascending: true });
        if (error) throw error;
        select.innerHTML = '<option value="">Selecione uma sala...</option>';
        data.forEach(s => {
            const o = document.createElement('option');
            o.value = s.id; o.textContent = s.nome;
            select.appendChild(o);
        });
    } catch (err) { console.error("Erro ao carregar salas:", err); }
}

// ============================================================
//  FUSO HORÁRIO DE BRASÍLIA & JANELA DA SEMANA ATUAL
//  Regra: Agendamentos permitidos EXCLUSIVAMENTE para a semana
//  atual (Segunda a Sexta). Abertura toda Segunda-feira às 00:00
//  (horário de Brasília). Semanas anteriores e posteriores são
//  bloqueadas.
// ============================================================

function _getAgoraBrasilia() {
    // Retorna a data/hora atual no fuso de Brasília (UTC-3)
    const agoraUtc = new Date();
    const strSp = agoraUtc.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
    return new Date(strSp);
}

function _limitesAgendamento() {
    const agoraSp = _getAgoraBrasilia();
    const hoje = new Date(agoraSp);
    hoje.setHours(0, 0, 0, 0);

    const diaSemana = hoje.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado

    // Se hoje for Sábado (6) ou Domingo (0), a semana letiva atual encerrou.
    // As reservas para a próxima semana abrem exclusivamente na Segunda-feira às 00:00 (Brasília).
    let bloqueadoFimDeSemana = false;
    let minData, maxData, segundaSemana, sextaSemana;

    if (diaSemana === 0 || diaSemana === 6) {
        bloqueadoFimDeSemana = true;
        const diasAteProximaSegunda = diaSemana === 0 ? 1 : 2;
        segundaSemana = new Date(hoje);
        segundaSemana.setDate(hoje.getDate() + diasAteProximaSegunda);
        sextaSemana = new Date(segundaSemana);
        sextaSemana.setDate(segundaSemana.getDate() + 4);
        minData = new Date(segundaSemana);
        maxData = new Date(sextaSemana);
    } else {
        // Segunda (1) a Sexta (5) da semana atual
        segundaSemana = new Date(hoje);
        segundaSemana.setDate(hoje.getDate() - (diaSemana - 1));

        sextaSemana = new Date(segundaSemana);
        sextaSemana.setDate(segundaSemana.getDate() + 4);

        // minData: não pode agendar dias que já passaram na semana atual
        minData = new Date(hoje);
        // maxData: não pode agendar semanas futuras além da sexta-feira da semana atual
        maxData = new Date(sextaSemana);
    }

    return { minData, maxData, segundaSemana, sextaSemana, bloqueadoFimDeSemana };
}

function _dataEstaNaSemanaAtual(dataIso) {
    const { minData, maxData, bloqueadoFimDeSemana } = _limitesAgendamento();
    if (bloqueadoFimDeSemana) return false;

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const minIso = fmt(minData);
    const maxIso = fmt(maxData);

    return dataIso >= minIso && dataIso <= maxIso;
}

// Bloqueia qualquer semana anterior (< 0) ou futura (> 0).
// Apenas a semana atual (offset === 0) é permitida.
function _offsetSemanaValido(offset) {
    return offset === 0;
}

function configurarCalendarioSemana() {
    const { minData, maxData, bloqueadoFimDeSemana } = _limitesAgendamento();
    const input = document.getElementById('data-agendamento');
    if (!input) return;

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    if (bloqueadoFimDeSemana) {
        input.min = fmt(minData);
        input.max = fmt(maxData);
        input.value = fmt(minData);
        input.disabled = true;
    } else {
        input.disabled = false;
        input.min = fmt(minData);
        input.max = fmt(maxData);

        const valAtual = input.value;
        if (!valAtual || valAtual < fmt(minData) || valAtual > fmt(maxData)) {
            input.value = fmt(minData);
        }
    }
}

// ============================================================
//  GRADE DE AULAS — Horários Oficiais
// ============================================================

// Horários oficiais das aulas:
// 1ª aula: 07:00 – 07:50
// 2ª aula: 07:50 – 08:40
// 3ª aula: 09:00 – 09:50
// 4ª aula: 09:50 – 10:40
// 5ª aula: 10:40 – 11:30
// 6ª aula: 12:20 – 13:10
// 7ª aula: 13:10 – 14:00
const GRADE_HORARIOS = {
    1: { inicioMinutos: 7 * 60,       fimMinutos: 7 * 60 + 50,  inicio: '07:00', fim: '07:50' },
    2: { inicioMinutos: 7 * 60 + 50,  fimMinutos: 8 * 60 + 40,  inicio: '07:50', fim: '08:40' },
    3: { inicioMinutos: 9 * 60,       fimMinutos: 9 * 60 + 50,  inicio: '09:00', fim: '09:50' },
    4: { inicioMinutos: 9 * 60 + 50,  fimMinutos: 10 * 60 + 40, inicio: '09:50', fim: '10:40' },
    5: { inicioMinutos: 10 * 60 + 40, fimMinutos: 11 * 60 + 30, inicio: '10:40', fim: '11:30' },
    6: { inicioMinutos: 12 * 60 + 20, fimMinutos: 13 * 60 + 10, inicio: '12:20', fim: '13:10' },
    7: { inicioMinutos: 13 * 60 + 10, fimMinutos: 14 * 60,      inicio: '13:10', fim: '14:00' },
};

let timerAtualizacaoHorario = null;

function _formatarHora(totalMinutos) {
    const horas = Math.floor(totalMinutos / 60);
    const minutos = totalMinutos % 60;
    return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`;
}

function _horarioDaAula(numeroAula) {
    if (GRADE_HORARIOS[numeroAula]) {
        return GRADE_HORARIOS[numeroAula];
    }
    const inicioMinutos = 7 * 60 + (numeroAula - 1) * 50;
    const fimMinutos = inicioMinutos + 50;
    return {
        inicioMinutos,
        inicio: _formatarHora(inicioMinutos),
        fim: _formatarHora(fimMinutos),
    };
}

function _inicioDaAula(dataIso, numeroAula) {
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    const { inicioMinutos } = _horarioDaAula(numeroAula);
    return new Date(ano, mes - 1, dia, Math.floor(inicioMinutos / 60), inicioMinutos % 60, 0, 0);
}

// Uma reserva só pode ser feita antes do início da aula. Assim, por exemplo,
// às 07:01 a Aula 1 já fica indisponível, mesmo que esteja sem reserva.
function _aulaJaComecou(dataIso, numeroAula, agora = new Date()) {
    return agora >= _inicioDaAula(dataIso, numeroAula);
}

function _programarAtualizacaoDaGrade(dataIso) {
    clearTimeout(timerAtualizacaoHorario);

    const agora = new Date();
    const proximosInicios = Array.from({ length: 7 }, (_, indice) =>
        _inicioDaAula(dataIso, indice + 1)
    ).filter(inicio => inicio > agora);

    if (!proximosInicios.length) return;

    const proximoInicio = proximosInicios[0];
    timerAtualizacaoHorario = setTimeout(() => {
        const dataAtual = document.getElementById('data-agendamento')?.value;
        if (dataAtual === dataIso) buscarAulas();
    }, proximoInicio.getTime() - agora.getTime() + 100);
}

window.buscarAulas = async function() {
    const salaId = document.getElementById('select-sala').value;
    const dataEscolhida = document.getElementById('data-agendamento').value;
    const grid = document.getElementById('grid-aulas');

    if (telaAtual === 'semana') carregarVisaoSemanal();
    if (buscandoAulasAtualmente) return;
    if (!salaId || !dataEscolhida) {
        grid.innerHTML = '<div class="stitch-empty-card"><div class="stitch-empty-art"><div class="stitch-art-glow"></div><div class="stitch-art-graphic"><svg width="84" height="84" viewBox="0 0 84 84" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="calBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#f5ede2"/></linearGradient><linearGradient id="calHeader" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ea5a52"/><stop offset="100%" stop-color="#d33c36"/></linearGradient><linearGradient id="clockFace" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#fff8f2"/><stop offset="100%" stop-color="#fae7d4"/></linearGradient><filter id="shadowArt" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#8a5a1e" flood-opacity="0.14"/></filter></defs><g filter="url(#shadowArt)"><rect x="14" y="16" width="46" height="46" rx="10" fill="url(#calBg)" stroke="#f0dfc7" stroke-width="1.5"/><path d="M14 26C14 20.4772 18.4772 16 24 16H50C55.5228 16 60 20.4772 60 26V29H14V26Z" fill="url(#calHeader)"/><rect x="23" y="12" width="4" height="7" rx="2" fill="#7a6250"/><rect x="47" y="12" width="4" height="7" rx="2" fill="#7a6250"/><circle cx="24" cy="38" r="2.2" fill="#cfbeae"/><circle cx="34" cy="38" r="2.2" fill="#cfbeae"/><circle cx="44" cy="38" r="2.2" fill="#cfbeae"/><circle cx="24" cy="48" r="2.2" fill="#cfbeae"/><circle cx="34" cy="48" r="2.2" fill="#cfbeae"/></g><g filter="url(#shadowArt)"><circle cx="54" cy="54" r="19" fill="url(#clockFace)" stroke="#f48646" stroke-width="2.5"/><line x1="54" y1="54" x2="54" y2="44" stroke="#7a421a" stroke-width="2.2" stroke-linecap="round"/><line x1="54" y1="54" x2="62" y2="54" stroke="#7a421a" stroke-width="2.2" stroke-linecap="round"/><circle cx="54" cy="54" r="2.5" fill="#f48646"/></g></svg></div></div><p class="stitch-empty-text">Selecione uma data e sala para ver os horários.</p></div>';
        return;
    }

    grid.innerHTML = '<div class="spinner-container"><div class="spinner"></div><div class="spinner-texto">Buscando grade...</div></div>';

    try {
        buscandoAulasAtualmente = true;
        const { data: agendamentos, error } = await supabase
            .from('agendamentos')
            .select('aula_numero, professores(nome), turmas(nome)')
            .eq('sala_id', salaId)
            .eq('data', dataEscolhida);

        if (error) throw error;

        const mapaOcupacao = {};
        agendamentos.forEach(a => {
            mapaOcupacao[a.aula_numero] = { prof: a.professores?.nome || 'Desconhecido', turma: a.turmas?.nome || 'Turma' };
        });

        grid.innerHTML = '';
        for (let i = 1; i <= 7; i++) {
            const btn = document.createElement('button');
            btn.classList.add('btn-aula');
            const horario = _horarioDaAula(i);

            if (_aulaJaComecou(dataEscolhida, i)) {
                btn.classList.add('encerrada');
                btn.disabled = true;
                btn.title = `O horário ${horario.inicio}–${horario.fim} já começou`;

                const lblAula = document.createElement('span');
                lblAula.style.cssText = 'display:block;font-weight:600;';
                lblAula.textContent = `Aula ${i}`;

                const lblDetalhe = document.createElement('span');
                lblDetalhe.style.cssText = 'font-size:.72rem;font-weight:400;display:block;margin-top:2px;';
                lblDetalhe.textContent = `⏱ ${horario.inicio}–${horario.fim} · Encerrada`;

                btn.appendChild(lblAula);
                btn.appendChild(lblDetalhe);
            } else if (mapaOcupacao[i]) {
                btn.classList.add('ocupada');
                btn.disabled = true;
                // textContent em cada nó — dados do banco nunca vão para innerHTML
                const lblAula = document.createElement('span');
                lblAula.style.cssText = 'display:block;font-weight:600;';
                lblAula.textContent = `Aula ${i}`;
                const lblDetalhe = document.createElement('span');
                lblDetalhe.style.cssText = 'font-size:.72rem;font-weight:400;display:block;margin-top:2px;';
                lblDetalhe.textContent = `🔒 ${mapaOcupacao[i].turma} (${mapaOcupacao[i].prof}) · ${horario.inicio}–${horario.fim}`;
                btn.appendChild(lblAula);
                btn.appendChild(lblDetalhe);
            } else {
                btn.classList.add('disponivel');
                const lblLivre = document.createElement('span');
                lblLivre.style.cssText = 'display:block;font-weight:600;';
                lblLivre.textContent = `Aula ${i}`;
                const lblStatus = document.createElement('span');
                lblStatus.style.cssText = 'font-size:.72rem;font-weight:400;display:block;margin-top:2px;';
                lblStatus.textContent = `✨ Livre · ${horario.inicio}–${horario.fim}`;
                btn.appendChild(lblLivre);
                btn.appendChild(lblStatus);
                btn.addEventListener('click', () => agendarAula(i));
            }
            grid.appendChild(btn);
        }

        _programarAtualizacaoDaGrade(dataEscolhida);
    } catch (err) {
        console.error("Erro ao buscar aulas:", err);
        grid.innerHTML = '<div class="grid-vazio"><div class="icone-vazio">⚠️</div><p>Erro ao carregar. Tente novamente.</p></div>';
    } finally {
        buscandoAulasAtualmente = false;
    }
}

window.agendarAula = async function(numeroAula) {
    if (!professorLogado) return;
    const salaId       = document.getElementById('select-sala').value;
    const turmaId      = document.getElementById('select-turma').value;
    const dataEscolhida = document.getElementById('data-agendamento').value;

    if (!salaId || !dataEscolhida) return; // slots só aparecem após sala+data serem escolhidos

    const { bloqueadoFimDeSemana } = _limitesAgendamento();
    if (bloqueadoFimDeSemana) {
        Swal.fire({
            icon: 'info',
            title: 'Agendamentos fechados',
            text: 'Os agendamentos são permitidos exclusivamente para a semana atual e abrem toda Segunda-feira às 00:00 (horário de Brasília).',
            confirmButtonColor: '#dc3c3c'
        });
        return;
    }

    if (!_dataEstaNaSemanaAtual(dataEscolhida)) {
        Swal.fire({
            icon: 'warning',
            title: 'Semana bloqueada',
            text: 'Só é possível agendar horários para a semana corrente (de Segunda a Sexta). Semanas anteriores e posteriores estão bloqueadas.',
            confirmButtonColor: '#dc3c3c'
        });
        return;
    }

    if (_aulaJaComecou(dataEscolhida, numeroAula)) {
        const horario = _horarioDaAula(numeroAula);
        Swal.fire({
            icon: 'info',
            title: 'Horário encerrado',
            text: `A Aula ${numeroAula} (${horario.inicio}–${horario.fim}) já começou e não pode mais ser reservada.`,
            confirmButtonColor: '#7c3aed'
        });
        buscarAulas();
        return;
    }

    if (!turmaId) {
        Swal.fire({ icon: 'warning', title: 'Atenção!', text: 'Selecione a TURMA antes de escolher o horário!', confirmButtonColor: '#7c3aed' })
            .then(() => document.getElementById('select-turma').focus());
        return;
    }

    try {
        // Verifica conflito: professor já tem este horário em outra sala
        const { data: choqueProf, error: errChoque } = await supabase
            .from('agendamentos')
            .select('id, salas(nome)')
            .eq('professor_id', professorLogado.id)
            .eq('data', dataEscolhida)
            .eq('aula_numero', numeroAula);

        if (errChoque) throw errChoque;

        if (choqueProf && choqueProf.length > 0) {
            const nomeSalaChoque = choqueProf[0].salas?.nome || 'outra sala';
            Swal.fire({ icon: 'error', title: 'Conflito!', text: `Você já reservou "${nomeSalaChoque}" neste horário.`, confirmButtonColor: '#7c3aed' });
            return;
        }

        const dataBr = dataEscolhida.split('-').reverse().join('/');
        const confirmacao = await Swal.fire({
            title: 'Confirmar reserva?', text: `Aula ${numeroAula} no dia ${dataBr}?`, icon: 'question',
            showCancelButton: true, confirmButtonColor: '#7c3aed', cancelButtonColor: '#9ca3af',
            confirmButtonText: 'Sim, agendar!', cancelButtonText: 'Cancelar'
        });
        if (!confirmacao.isConfirmed) return;

        const { error } = await supabase.from('agendamentos').insert([{
            professor_id: professorLogado.id, sala_id: salaId, turma_id: turmaId,
            data: dataEscolhida, aula_numero: numeroAula
        }]);

        if (error) {
            // P0002 = trigger check_aula_nao_iniciada no banco: a aula já
            // começou de acordo com a hora real do servidor (não a do
            // navegador). É a trava definitiva, mesmo que o relógio do
            // aparelho de quem está agendando esteja errado ou adiantado.
            if (error.code === 'P0002') {
                Swal.fire({ icon: 'info', title: 'Horário encerrado', text: 'Essa aula já começou e não pode mais ser reservada.', confirmButtonColor: '#7c3aed' });
                buscarAulas();
            } else {
                Swal.fire({ icon: 'error', title: 'Vaga indisponível', text: 'Pode ter sido preenchida agora mesmo.', confirmButtonColor: '#7c3aed' });
            }
        } else {
            const nomeSala = document.getElementById('select-sala').selectedOptions[0]?.textContent || 'uma sala';
            Swal.fire({ icon: 'success', title: 'Agendado!', text: 'Sua reserva foi confirmada. 🎉', confirmButtonColor: '#059669', timer: 2000, showConfirmButton: false });
            buscarAulas();
            carregarHistorico();
            enviarNotificacao('📅 Novo agendamento', `${professorLogado.nome} reservou ${nomeSala} — Aula ${numeroAula} em ${dataBr}.`, 'coordenacao');
            enviarNotificacao('✅ Reserva confirmada!', `${nomeSala} — Aula ${numeroAula} em ${dataBr} está reservada para você.`, 'professor', professorLogado.id);
        }
    } catch (err) {
        console.error('Erro ao agendar aula:', err);
        Swal.fire({ icon: 'error', title: 'Erro de conexão', text: 'Não foi possível completar o agendamento. Tente novamente.', confirmButtonColor: '#7c3aed' });
    }
}

// ============================================================
//  HISTÓRICO
// ============================================================

window.carregarHistorico = async function() {
    if (!professorLogado) return;
    const listaHtml = document.getElementById('historico-lista');
    if (!listaHtml) return;
    listaHtml.innerHTML = '<div class="minhas-aulas-vazio">Carregando...</div>';

    const hoje = new Date();
    const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;

    const { data, error } = await supabase
        .from('agendamentos')
        .select('id, data, aula_numero, salas(nome), turmas(nome)')
        .eq('professor_id', professorLogado.id)
        .gte('data', hojeIso)
        .order('data', { ascending: true });

    if (error) { listaHtml.innerHTML = '<div class="minhas-aulas-vazio">Erro ao carregar.</div>'; return; }
    if (!data || data.length === 0) { listaHtml.innerHTML = '<div class="minhas-aulas-vazio">Nenhum agendamento ativo a partir de hoje.</div>'; return; }

    listaHtml.innerHTML = '';
    data.forEach(item => {
        const dataBr    = item.data.split('-').reverse().join('/');
        const nomeSala  = item.salas?.nome  || 'Sala removida';
        const nomeTurma = item.turmas?.nome || 'Turma removida';

        const div = document.createElement('div');
        div.classList.add('historico-item');

        const info = document.createElement('div');
        info.className = 'historico-info';

        const horario   = _horarioDaAula(item.aula_numero);
        const titulo    = document.createElement('strong');
        titulo.textContent = `${nomeSala} — Aula ${item.aula_numero}ª (${horario.inicio}–${horario.fim})`;  // textContent: sem XSS

        const meta = document.createElement('span');
        meta.textContent = `${dataBr} · Turma ${nomeTurma}`;

        info.appendChild(titulo);
        info.appendChild(meta);

        const btn = document.createElement('button');
        btn.className = 'btn-cancelar';
        btn.textContent = 'Cancelar';
        // Closure: dados nunca vão para atributo HTML
        btn.addEventListener('click', () =>
            cancelarAgendamento(item.id, nomeSala, item.aula_numero, dataBr)
        );

        div.appendChild(info);
        div.appendChild(btn);
        listaHtml.appendChild(div);
    });
}

// Chamado via addEventListener em carregarHistorico — não precisa ser window.*
async function cancelarAgendamento(id, nomeSala, numeroAula, dataBr) {
    const confirmacao = await Swal.fire({
        title: 'Cancelar reserva?', text: 'Tem certeza que deseja cancelar esta reserva?', icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#9ca3af',
        confirmButtonText: 'Sim, cancelar!', cancelButtonText: 'Manter'
    });
    if (!confirmacao.isConfirmed) return;

    try {
        const { error } = await supabase.from('agendamentos').delete().eq('id', id);
        if (error) throw error;

        Swal.fire({ icon: 'success', title: 'Cancelada!', confirmButtonColor: '#059669', timer: 1500, showConfirmButton: false });
        enviarNotificacao('🗑️ Reserva cancelada', `${professorLogado.nome} cancelou ${nomeSala} — Aula ${numeroAula} em ${dataBr}.`, 'coordenacao');
        buscarAulas();
        carregarHistorico();
    } catch (err) {
        console.error('Erro ao cancelar agendamento:', err);
        Swal.fire({ icon: 'error', title: 'Erro!', text: 'Não foi possível cancelar. Tente novamente.', confirmButtonColor: '#7c3aed' });
    }
}

// ============================================================
//  VISÃO SEMANAL
// ============================================================

// ============================================================
//  VISÃO SEMANAL v2 — cards por dia, swipe, navegação de semana
// ============================================================

let _semOffset  = 0;   // semanas a partir da atual (0 = esta semana)
let _semDiaIdx  = -1;  // dia ativo: 0=Seg … 4=Sex; -1 = auto (hoje)
let _semDados   = null; // cache: { salaId, offset, mapa, dias, hojeStr }
let _semSalaId  = null; // sala escolhida NA PRÓPRIA aba Semana (independente da aba Agendar)

window.carregarVisaoSemanal = async function() {
    // Ao entrar na tela pela primeira vez, usa como sugestão a sala já
    // escolhida na aba Agendar — mas a partir daí a visão semanal tem
    // sua própria sala, trocável pelo botão "Trocar local".
    if (_semSalaId === null) {
        const salaAgendar = document.getElementById('select-sala')?.value;
        if (salaAgendar) _semSalaId = salaAgendar;
    }
    _semDados = null;
    await _fetchESalvar();
}

window.navegarSemana = async function(dir) {
    const novoOffset = _semOffset + dir;
    if (!_offsetSemanaValido(novoOffset)) {
        Swal.fire({
            toast: true, position: 'top', icon: 'info',
            title: 'Só é possível visualizar a semana atual de agendamento.',
            showConfirmButton: false, timer: 2400, timerProgressBar: true
        });
        return;
    }
    _semOffset = novoOffset;
    _semDiaIdx  = 0;   // vai para segunda ao mudar de semana
    _semDados   = null;
    await _fetchESalvar();
}

window.abrirSeletorLocalSemana = async function() {
    const select = document.getElementById('select-sala');
    const opcoes = {};
    if (select) {
        Array.from(select.options).forEach(o => {
            if (o.value) opcoes[o.value] = o.textContent;
        });
    }

    if (Object.keys(opcoes).length === 0) {
        await carregarSalasParaSemana(opcoes);
    }

    if (Object.keys(opcoes).length === 0) {
        Swal.fire({ icon: 'info', title: 'Sem locais cadastrados', text: 'Nenhuma sala foi cadastrada ainda.', confirmButtonColor: '#7c3aed' });
        return;
    }

    const { value: salaEscolhida } = await Swal.fire({
        title: 'Escolher local',
        input: 'select',
        inputOptions: opcoes,
        inputValue: _semSalaId || '',
        inputPlaceholder: 'Selecione um local...',
        confirmButtonText: 'Ver semana',
        confirmButtonColor: '#7c3aed',
        showCancelButton: true,
        cancelButtonText: 'Cancelar'
    });

    if (!salaEscolhida) return;

    _semSalaId = salaEscolhida;
    _semOffset = 0;
    _semDiaIdx = -1;
    _semDados  = null;
    await _fetchESalvar();
}

// Fallback: se a aba Agendar ainda não carregou as salas, busca direto
async function carregarSalasParaSemana(opcoes) {
    try {
        const { data, error } = await supabase.from('salas').select('id, nome').order('nome', { ascending: true });
        if (error) throw error;
        data.forEach(s => { opcoes[s.id] = s.nome; });
    } catch (err) {
        console.error('Erro ao carregar salas para a visão semanal:', err);
    }
}

window.trocarDiaSemana = function(idx) {
    _semDiaIdx = idx;
    _renderSemana();
}

async function _fetchESalvar() {
    const salaId    = _semSalaId;
    const container = document.getElementById('visao-semanal');
    const infoEl    = document.getElementById('semana-sala-info');
    if (!container) return;

    if (!salaId) {
        container.innerHTML = `
          <div class="semana-vazio">
            <div class="icone">🏫</div>
            <p>Toque em <strong>Trocar local</strong> para escolher<br>uma sala e ver a semana antes de agendar.</p>
          </div>`;
        if (infoEl) infoEl.textContent = 'Nenhum local selecionado';
        return;
    }

    const selectAgendar = document.getElementById('select-sala');
    const opcaoSala = selectAgendar
        ? Array.from(selectAgendar.options).find(o => o.value === salaId)
        : null;
    const nomeSala = opcaoSala?.textContent || 'Sala';
    if (infoEl) infoEl.textContent = nomeSala;

    container.innerHTML = '<div class="spinner-container"><div class="spinner"></div><div class="spinner-texto">Carregando semana...</div></div>';

    const fmt = d =>
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    // Âncora sempre dentro da janela de agendamento válida (evita, por
    // exemplo, mostrar a semana errada quando hoje é sábado/domingo).
    const { minData } = _limitesAgendamento();
    const dataInput = document.getElementById('data-agendamento')?.value;
    const dataBase  = dataInput ? new Date(dataInput + 'T00:00:00') : minData;
    const dow       = dataBase.getDay();
    const diffSeg   = dow === 0 ? -6 : 1 - dow;
    const segunda   = new Date(dataBase);
    segunda.setDate(dataBase.getDate() + diffSeg + _semOffset * 7);

    const NOMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    const dias  = NOMES.map((nome, i) => {
        const d = new Date(segunda);
        d.setDate(segunda.getDate() + i);
        return { nome, data: fmt(d), diaNum: d.getDate(), mes: d.getMonth() + 1 };
    });

    const hojeStr = fmt(new Date());

    // Auto-seleciona hoje se estiver nesta semana
    if (_semDiaIdx < 0) {
        const hi = dias.findIndex(d => d.data === hojeStr);
        _semDiaIdx = hi >= 0 ? hi : 0;
    }

    try {
        const { data, error } = await supabase
            .from('agendamentos')
            .select('data, aula_numero, professor_id, professores(nome), turmas(nome)')
            .eq('sala_id', salaId)
            .gte('data', dias[0].data)
            .lte('data', dias[4].data);
        if (error) throw error;

        const mapa = {};
        data.forEach(a => {
            mapa[`${a.data}|${a.aula_numero}`] = {
                prof:  a.professores?.nome || '—',
                turma: a.turmas?.nome     || '—',
                minha: professorLogado && a.professor_id === professorLogado.id
            };
        });

        _semDados = { salaId, offset: _semOffset, mapa, dias, hojeStr };
        _renderSemana();

    } catch (err) {
        console.error('Erro ao carregar visão semanal:', err);
        container.innerHTML = `
          <div class="semana-vazio">
            <div class="icone">⚠️</div>
            <p>Não foi possível carregar.<br>Verifique a conexão.</p>
          </div>`;
    }
}

function _renderSemana() {
    const container = document.getElementById('visao-semanal');
    if (!container || !_semDados) return;

    const { mapa, dias, hojeStr } = _semDados;
    const diaAtivo = dias[_semDiaIdx];

    /* ── Navegação de semana — travada à janela de agendamento válida ── */
    const podeAnterior = _offsetSemanaValido(_semOffset - 1);
    const podeProxima  = _offsetSemanaValido(_semOffset + 1);
    const nav = `
      <div class="semana-nav">
        <button class="semana-seta" onclick="navegarSemana(-1)" ${podeAnterior ? '' : 'disabled'} aria-label="Semana anterior">‹</button>
        <span class="semana-periodo">${dias[0].diaNum}/${dias[0].mes} – ${dias[4].diaNum}/${dias[4].mes}</span>
        <button class="semana-seta" onclick="navegarSemana(1)" ${podeProxima ? '' : 'disabled'} aria-label="Próxima semana">›</button>
      </div>`;

    /* ── Pills de dia ── */
    const pills = dias.map((d, i) => {
        const ativo = i === _semDiaIdx ? ' ativo' : '';
        const hoje  = d.data === hojeStr ? ' hoje' : '';
        return `<button class="dia-pill${ativo}${hoje}" onclick="trocarDiaSemana(${i})">
                  <span class="dia-nome">${d.nome}</span>
                  <span class="dia-num">${d.diaNum}</span>
                </button>`;
    }).join('');

    /* ── Cards de aula ── */
    const TOTAL_AULAS = 7;
    const ICONS = { livre: '○', ocupada: '●', minha: '★' };
    const LABELS = { livre: 'Livre', ocupada: 'Ocupado', minha: 'Minha reserva' };

    const cards = Array.from({ length: TOTAL_AULAS }, (_, i) => {
        const aula = i + 1;
        const inf  = mapa[`${diaAtivo.data}|${aula}`];
        const tipo = inf?.minha ? 'minha' : inf ? 'ocupada' : 'livre';

        // Placeholder vazio — preenchido via textContent depois do innerHTML
        const temDetalhe = tipo === 'minha' || tipo === 'ocupada';
        const temSub     = tipo === 'ocupada';

        return `
          <div class="slot-card ${tipo}" data-aula="${aula}">
            <div class="slot-num">${aula}<small>aula</small></div>
            <div class="slot-divisor"></div>
            <div class="slot-content">
              <div class="slot-badge">${ICONS[tipo]} ${LABELS[tipo]}</div>
              ${temDetalhe ? '<div class="slot-detail"></div>' : ''}
              ${temSub     ? '<div class="slot-sub"></div>'    : ''}
            </div>
          </div>`;
    }).join('');

    /* ── Legenda ── */
    const legenda = `
      <div class="semana-legenda">
        <div class="semana-legenda-item"><div class="semana-legenda-cor livre"></div>Livre</div>
        <div class="semana-legenda-item"><div class="semana-legenda-cor ocupada"></div>Outro professor</div>
        <div class="semana-legenda-item"><div class="semana-legenda-cor minha"></div>Minha reserva</div>
      </div>`;

    container.innerHTML = `
      <div class="semana-v2">
        ${nav}
        <div class="semana-dias-pills">${pills}</div>
        <div class="semana-slots" id="semana-slots">${cards}</div>
        ${legenda}
      </div>`;

    // Preenche dados do banco via textContent (sem XSS) nos placeholders
    Array.from({ length: TOTAL_AULAS }, (_, i) => {
        const aula = i + 1;
        const inf  = mapa[`${diaAtivo.data}|${aula}`];
        if (!inf) return;
        const card   = container.querySelector(`.slot-card[data-aula="${aula}"]`);
        if (!card) return;
        const detail = card.querySelector('.slot-detail');
        const sub    = card.querySelector('.slot-sub');
        if (detail) detail.textContent = inf.turma;
        if (sub)    sub.textContent    = inf.prof;
    });

    /* ── Swipe para trocar de dia ── */
    const slotsEl = document.getElementById('semana-slots');
    if (slotsEl) {
        let sx = 0, sy = 0;
        slotsEl.addEventListener('touchstart', e => {
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
        }, { passive: true });
        slotsEl.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - sx;
            const dy = e.changedTouches[0].clientY - sy;
            if (Math.abs(dx) > Math.abs(dy) * 1.4 && Math.abs(dx) > 44) {
                const next = _semDiaIdx + (dx < 0 ? 1 : -1);
                if (next >= 0 && next < dias.length) window.trocarDiaSemana(next);
            }
        }, { passive: true });
    }
}

// ============================================================
//  REALTIME
// ============================================================

supabase
    .channel('mudancas-agendamentos-prof')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, () => {
        if (!professorLogado) return;
        buscarAulas();
        carregarHistorico();
        if (telaAtual === 'semana') { _semDados = null; _fetchESalvar(); }
    })
    .subscribe();

supabase
    .channel('mudancas-professor-logado')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'professores' }, async (payload) => {
        if (!professorLogado) return;
        const id = payload.new?.id || payload.old?.id;
        if (id !== professorLogado.id) return;

        if (payload.eventType === 'DELETE') {
            await Swal.fire({ icon: 'warning', title: 'Acesso removido', text: 'Sua conta foi removida pela coordenação.', confirmButtonColor: '#7c3aed', allowOutsideClick: false });
            await supabase.auth.signOut();
            window.location.href = 'professor.html';
            return;
        }

        if (payload.eventType === 'UPDATE') {
            const acessoRevogado = payload.new?.auth_user_id === null;
            if (acessoRevogado) {
                await Swal.fire({ icon: 'info', title: 'Acesso redefinido', text: 'Crie um novo PIN para continuar.', confirmButtonColor: '#7c3aed', allowOutsideClick: false });
                await supabase.auth.signOut();
                window.location.href = 'cadastro.html';
                return;
            }
            professorLogado = { ...professorLogado, ...payload.new };
            if (telaAtual === 'perfil') atualizarPerfil();
        }
    })
    .subscribe();

// ============================================================
//  SWIPE ENTRE ABAS (estilo Instagram/WhatsApp)
// ============================================================

(function() {
    // Usa ORDEM_TELAS_NAV declarada no escopo global — única fonte de verdade
    const LIMIAR_SWIPE = 60;   // pixels mínimos para contar como swipe
    const LIMIAR_VERTICAL = 80; // se o dedo subiu/desceu mais que isso, ignora (é scroll)

    let touchStartX = 0;
    let touchStartY = 0;
    let swipeAtivo = false;

    const appContent = document.getElementById('app-content');
    if (!appContent) return;

    appContent.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        swipeAtivo = true;
    }, { passive: true });

    appContent.addEventListener('touchmove', (e) => {
        if (!swipeAtivo) return;
        const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
        // Se o movimento for predominantemente vertical, cancela o swipe
        if (deltaY > LIMIAR_VERTICAL) swipeAtivo = false;
    }, { passive: true });

    appContent.addEventListener('touchend', (e) => {
        if (!swipeAtivo) return;
        swipeAtivo = false;

        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartY);

        // Ignora se o movimento horizontal for pequeno ou o vertical for grande
        if (Math.abs(deltaX) < LIMIAR_SWIPE || deltaY > LIMIAR_VERTICAL) return;

        const indexAtual = ORDEM_TELAS_NAV.indexOf(telaAtual);
        if (indexAtual === -1) return;

        if (deltaX < 0) {
            // Swipe para esquerda → próxima aba
            const proxima = ORDEM_TELAS_NAV[indexAtual + 1];
            if (proxima) trocarTela(proxima);
        } else {
            // Swipe para direita → aba anterior
            const anterior = ORDEM_TELAS_NAV[indexAtual - 1];
            if (anterior) trocarTela(anterior);
        }
    }, { passive: true });
})();