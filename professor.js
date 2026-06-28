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
    await fazerLogoutAuth();
}

function mostrarAppLogado() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('app-header').classList.add('visivel');
    document.getElementById('bottom-nav').classList.add('visivel');

    // Saudação personalizada com período do dia
    const hora = new Date().getHours();
    const periodo = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const emoji   = hora < 12 ? '☀️' : hora < 18 ? '🌤️' : '🌙';
    const primeiroNome = professorLogado.nome?.split(' ')[0] || professorLogado.nome;

    const elPeriodo = document.getElementById('saudacao-periodo');
    const elNome    = document.getElementById('saudacao-nome');
    const elDisc    = document.getElementById('saudacao-disciplina');
    if (elPeriodo) elPeriodo.textContent = `${emoji} ${periodo}!`;
    if (elNome)    elNome.textContent    = primeiroNome;
    if (elDisc)    elDisc.textContent    = professorLogado.disciplina || '';

    document.getElementById('tela-agendar').classList.add('ativa');
    configurarCalendarioSemana();
    carregarTurmas();
    carregarSalas();
    carregarHistorico();

    // Mostra banner de notificações se ainda não foi permitido/negado
    setTimeout(() => verificarBannerNotificacoes(), 1200);
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
    if (!desc || !btn) return;

    const perm = Notification?.permission;
    if (perm === 'granted') {
        desc.textContent = 'Ativas — lembretes e avisos habilitados';
        btn.textContent = 'Reativar';
    } else if (perm === 'denied') {
        desc.textContent = 'Bloqueadas — habilite nas configurações do navegador';
        btn.textContent = 'Bloqueadas';
        btn.disabled = true;
    } else {
        desc.textContent = 'Toque para ativar lembretes de aula';
        btn.textContent = 'Ativar';
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

function configurarCalendarioSemana() {
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    let minData = new Date(hoje);
    let maxData = new Date(hoje);

    if (diaSemana === 0) { minData.setDate(hoje.getDate() + 1); maxData.setDate(hoje.getDate() + 5); }
    else if (diaSemana === 6) { minData.setDate(hoje.getDate() + 2); maxData.setDate(hoje.getDate() + 6); }
    else { maxData.setDate(hoje.getDate() + (5 - diaSemana)); }

    const input = document.getElementById('data-agendamento');
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    input.min = fmt(minData);
    input.max = fmt(maxData);
    input.value = fmt(minData);
}

// ============================================================
//  GRADE DE AULAS
// ============================================================

window.buscarAulas = async function() {
    const salaId = document.getElementById('select-sala').value;
    const dataEscolhida = document.getElementById('data-agendamento').value;
    const grid = document.getElementById('grid-aulas');

    if (telaAtual === 'semana') carregarVisaoSemanal();
    if (buscandoAulasAtualmente) return;
    if (!salaId || !dataEscolhida) {
        grid.innerHTML = '<div class="grid-vazio"><div class="icone-vazio">🗓️</div><p>Selecione uma data e sala para ver os horários.</p></div>';
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
            if (mapaOcupacao[i]) {
                btn.classList.add('ocupada');
                btn.innerHTML = `Aula ${i}<br><span style="font-size:.7rem;font-weight:400;">🔒 ${mapaOcupacao[i].turma}<br>(${mapaOcupacao[i].prof})</span>`;
                btn.disabled = true;
            } else {
                btn.classList.add('disponivel');
                btn.innerHTML = `Aula ${i}<br><span style="font-size:.7rem;font-weight:400;">✨ Livre</span>`;
                btn.onclick = () => agendarAula(i);
            }
            grid.appendChild(btn);
        }
    } catch (err) {
        console.error("Erro ao buscar aulas:", err);
        grid.innerHTML = '<div class="grid-vazio"><div class="icone-vazio">⚠️</div><p>Erro ao carregar. Tente novamente.</p></div>';
    } finally {
        buscandoAulasAtualmente = false;
    }
}

window.agendarAula = async function(numeroAula) {
    if (!professorLogado) return;
    const salaId = document.getElementById('select-sala').value;
    const turmaId = document.getElementById('select-turma').value;
    const dataEscolhida = document.getElementById('data-agendamento').value;

    if (!turmaId) {
        Swal.fire({ icon: 'warning', title: 'Atenção!', text: 'Selecione a TURMA antes de escolher o horário!', confirmButtonColor: '#7c3aed' })
            .then(() => document.getElementById('select-turma').focus());
        return;
    }

    const { data: choqueProf } = await supabase
        .from('agendamentos')
        .select('id, salas(nome)')
        .eq('professor_id', professorLogado.id)
        .eq('data', dataEscolhida)
        .eq('aula_numero', numeroAula);

    if (choqueProf && choqueProf.length > 0) {
        Swal.fire({ icon: 'error', title: 'Conflito!', text: `Você já reservou "${choqueProf[0].salas.nome}" neste horário.`, confirmButtonColor: '#7c3aed' });
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
        Swal.fire({ icon: 'error', title: 'Vaga indisponível', text: 'Pode ter sido preenchida agora mesmo.', confirmButtonColor: '#7c3aed' });
    } else {
        const nomeSala = document.getElementById('select-sala').selectedOptions[0]?.textContent || 'uma sala';
        Swal.fire({ icon: 'success', title: 'Agendado!', text: 'Sua reserva foi confirmada. 🎉', confirmButtonColor: '#059669', timer: 2000, showConfirmButton: false });
        buscarAulas();
        carregarHistorico();
        // Notifica coordenação
        enviarNotificacao('📅 Novo agendamento', `${professorLogado.nome} reservou ${nomeSala} — Aula ${numeroAula} em ${dataBr}.`, 'coordenacao');
        // Notifica o próprio professor como confirmação no dispositivo
        enviarNotificacao('✅ Reserva confirmada!', `${nomeSala} — Aula ${numeroAula} em ${dataBr} está reservada para você.`, 'professor', professorLogado.id);
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
        const dataBr = item.data.split('-').reverse().join('/');
        const div = document.createElement('div');
        div.classList.add('historico-item');
        div.innerHTML = `
            <div class="historico-info">
                <strong>${item.salas.nome} — Aula ${item.aula_numero}ª</strong>
                <span>${dataBr} · Turma ${item.turmas.nome}</span>
            </div>
            <button class="btn-cancelar" onclick="cancelarAgendamento('${item.id}', '${item.salas.nome}', ${item.aula_numero}, '${dataBr}')">Excluir</button>
        `;
        listaHtml.appendChild(div);
    });
}

window.cancelarAgendamento = async function(id, nomeSala, numeroAula, dataBr) {
    const confirmacao = await Swal.fire({
        title: 'Cancelar reserva?', text: "Tem certeza que deseja cancelar esta reserva?", icon: 'warning',
        showCancelButton: true, confirmButtonColor: '#dc2626', cancelButtonColor: '#9ca3af',
        confirmButtonText: 'Sim, cancelar!', cancelButtonText: 'Manter'
    });
    if (!confirmacao.isConfirmed) return;

    const { error } = await supabase.from('agendamentos').delete().eq('id', id);
    if (error) {
        Swal.fire({ icon: 'error', title: 'Erro!', text: 'Não foi possível cancelar.', confirmButtonColor: '#7c3aed' });
    } else {
        Swal.fire({ icon: 'success', title: 'Cancelada!', confirmButtonColor: '#059669', timer: 1500, showConfirmButton: false });
        enviarNotificacao('🗑️ Reserva cancelada', `${professorLogado.nome} cancelou ${nomeSala} — Aula ${numeroAula} em ${dataBr}.`, 'coordenacao');
        buscarAulas();
        carregarHistorico();
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

window.carregarVisaoSemanal = async function() {
    // Ao entrar na tela pela primeira vez: auto-seleciona hoje
    _semDados = null;
    await _fetchESalvar();
}

window.navegarSemana = async function(dir) {
    _semOffset += dir;
    _semDiaIdx  = 0;   // vai para segunda ao mudar de semana
    _semDados   = null;
    await _fetchESalvar();
}

window.trocarDiaSemana = function(idx) {
    _semDiaIdx = idx;
    _renderSemana();
}

async function _fetchESalvar() {
    const salaId    = document.getElementById('select-sala')?.value;
    const container = document.getElementById('visao-semanal');
    const infoEl    = document.getElementById('semana-sala-info');
    if (!container) return;

    if (!salaId) {
        container.innerHTML = `
          <div class="semana-vazio">
            <div class="icone">🏫</div>
            <p>Selecione uma sala na aba<br><strong>Agendar</strong> para ver a semana.</p>
          </div>`;
        if (infoEl) infoEl.textContent = 'Selecione uma sala na aba Agendar';
        return;
    }

    const nomeSala = document.getElementById('select-sala').selectedOptions[0]?.textContent || 'Sala';
    if (infoEl) infoEl.textContent = nomeSala;

    container.innerHTML = '<div class="spinner-container"><div class="spinner"></div><div class="spinner-texto">Carregando semana...</div></div>';

    const fmt = d =>
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const dataInput = document.getElementById('data-agendamento')?.value;
    const dataBase  = dataInput ? new Date(dataInput + 'T00:00:00') : new Date();
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

    /* ── Navegação de semana ── */
    const nav = `
      <div class="semana-nav">
        <button class="semana-seta" onclick="navegarSemana(-1)" aria-label="Semana anterior">‹</button>
        <span class="semana-periodo">${dias[0].diaNum}/${dias[0].mes} – ${dias[4].diaNum}/${dias[4].mes}</span>
        <button class="semana-seta" onclick="navegarSemana(1)" aria-label="Próxima semana">›</button>
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

        const detalhe = tipo === 'minha'
            ? `<div class="slot-detail">${inf.turma}</div>`
            : tipo === 'ocupada'
            ? `<div class="slot-detail">${inf.turma}</div><div class="slot-sub">${inf.prof}</div>`
            : '';

        return `
          <div class="slot-card ${tipo}">
            <div class="slot-num">${aula}<small>aula</small></div>
            <div class="slot-divisor"></div>
            <div class="slot-content">
              <div class="slot-badge">${ICONS[tipo]} ${LABELS[tipo]}</div>
              ${detalhe}
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
