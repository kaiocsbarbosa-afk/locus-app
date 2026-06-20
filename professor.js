/* professor.js — login em 2 passos: selecionar nome → PIN */
import { supabase, toggleDarkMode as _toggleDarkMode, carregarPreferenciaModo, registrarServiceWorker, getProfessorLogado, fazerLogoutAuth } from './utils.js'
import { ativarNotificacoes, enviarNotificacao } from './push.js'

let professorLogado = null;
let buscandoAulasAtualmente = false;
let telaAtual = 'agendar';


// ============================================================
//  INICIALIZAÇÃO
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    carregarPreferenciaModo();
    atualizarBtnDarkMode();
    registrarServiceWorker();
    carregarListaNomesLogin(); // Pré-carrega a lista de professores

    setTimeout(() => {
        const splash = document.getElementById('splash');
        splash.classList.add('saindo');
        setTimeout(async () => {
            splash.style.display = 'none';
            await verificarSessaoAtiva();
            configurarPinBoxesGrande();
        }, 500);
    }, 2000);
});

function atualizarBtnDarkMode() {
    const isDark = document.body.classList.contains('dark-mode');
    const btn = document.getElementById('btn-dark-mode');
    const btnPerfil = document.getElementById('btn-dark-perfil');
    if (btn) btn.textContent = isDark ? '☀️' : '🌙';
    if (btnPerfil) btnPerfil.textContent = isDark ? 'Ativado' : 'Desativado';
}

window.toggleDarkMode = function() {
    _toggleDarkMode();
    atualizarBtnDarkMode();
}

// ============================================================
//  CARREGA LISTA DE NOMES
// ============================================================

async function carregarListaNomesLogin() {
    const select = document.getElementById('select-nome-login');
    if (!select) return;

    try {
        const { data, error } = await supabase
            .from('professores')
            .select('id, nome')
            .not('auth_user_id', 'is', null)
            .order('nome');

        if (error) throw error;

        select.innerHTML = '<option value="">Selecione seu nome...</option>';

        (data || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nome;
            select.appendChild(opt);
        });

    } catch (err) {
        console.error('Erro ao carregar professores:', err);
        if (select) select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
}

// ============================================================
//  PIN — input único invisível, visuais atualizados via JS
// ============================================================

function configurarPinBoxesGrande() {
    const inputReal = document.getElementById('pin-input-real');
    const dots = [0,1,2,3].map(i => document.getElementById('pd' + i));
    if (!inputReal || !dots[0]) return;

    function atualizarDots(val) {
        dots.forEach((dot, i) => {
            dot.classList.remove('ativo', 'preenchido');
            if (i < val.length) {
                dot.textContent = '●';
                dot.classList.add('preenchido');
            } else {
                dot.textContent = '';
                if (i === val.length) dot.classList.add('ativo');
            }
        });
    }

    // Foca no input e mostra o primeiro dot ativo
    inputReal.addEventListener('focus', () => {
        const val = inputReal.value.replace(/\D/g, '').slice(0, 4);
        atualizarDots(val);
    });

    inputReal.addEventListener('blur', () => {
        dots.forEach(d => d.classList.remove('ativo'));
    });

    inputReal.addEventListener('input', () => {
        // Filtra só dígitos e limita a 4
        const val = inputReal.value.replace(/\D/g, '').slice(0, 4);
        inputReal.value = val;
        atualizarDots(val);

        // Auto-login ao completar 4 dígitos
        if (val.length === 4) {
            fazerLogin();
        }
    });

    // Toque em qualquer dot foca o input
    dots.forEach(dot => {
        dot.parentElement?.addEventListener('click', () => inputReal.focus());
    });
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

window.fazerLogin = async function() {
    const select = document.getElementById('select-nome-login');
    const profId = select?.value;
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
            if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
            limparPin();

            const mensagem = error?.message?.includes('rate limit')
                ? 'Muitas tentativas. Aguarde alguns minutos.'
                : 'PIN incorreto. Tente novamente.';

            return Swal.fire({ icon: 'error', title: 'Ops!', text: mensagem, confirmButtonColor: '#7c3aed' });
        }

        professorLogado = await getProfessorLogado();

        if (!professorLogado) {
            await supabase.auth.signOut();
            if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }
            limparPin();
            return Swal.fire({ icon: 'error', title: 'Erro', text: 'Perfil não encontrado. Contate a coordenação.', confirmButtonColor: '#7c3aed' });
        }

        if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }
        mostrarAppLogado();
        ativarNotificacoes('professor', professorLogado.id);

    } catch (err) {
        console.error('Erro no login:', err);
        if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }
        limparPin();
        Swal.fire({ icon: 'error', title: 'Erro de conexão', text: 'Tente novamente.', confirmButtonColor: '#7c3aed' });
    }
}

window.fazerLogout = async function() {
    await fazerLogoutAuth();
}

function mostrarAppLogado() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('app-header').classList.add('visivel');
    document.getElementById('bottom-nav').classList.add('visivel');

    const status = document.getElementById('status-usuario');
    if (status) status.innerHTML = `Olá, <strong>${professorLogado.nome}</strong>! 👋`;

    document.getElementById('tela-agendar').classList.add('ativa');
    configurarCalendarioSemana();
    carregarTurmas();
    carregarSalas();
    carregarHistorico();
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
        Swal.fire({ icon: 'success', title: 'Agendado!', text: 'Sua reserva foi confirmada. 🎉', confirmButtonColor: '#059669', timer: 2000, showConfirmButton: false });
        buscarAulas();
        carregarHistorico();
        const nomeSala = document.getElementById('select-sala').selectedOptions[0]?.textContent || 'uma sala';
        enviarNotificacao('Novo agendamento', `${professorLogado.nome} reservou ${nomeSala} (Aula ${numeroAula}) em ${dataBr}.`, 'coordenacao');
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
        enviarNotificacao('Reserva cancelada', `${professorLogado.nome} cancelou ${nomeSala} (Aula ${numeroAula}) em ${dataBr}.`, 'coordenacao');
        buscarAulas();
        carregarHistorico();
    }
}

// ============================================================
//  VISÃO SEMANAL
// ============================================================

window.carregarVisaoSemanal = async function() {
    const salaId = document.getElementById('select-sala').value;
    const container = document.getElementById('visao-semanal');
    const info = document.getElementById('semana-sala-info');
    if (!container) return;

    if (!salaId) {
        container.innerHTML = '<div class="grid-vazio"><div class="icone-vazio">🏫</div><p>Selecione uma sala na aba Agendar para ver a semana.</p></div>';
        return;
    }

    const nomeSala = document.getElementById('select-sala').selectedOptions[0]?.textContent || 'Sala';
    if (info) info.textContent = nomeSala;
    container.innerHTML = '<div class="spinner-container"><div class="spinner"></div><div class="spinner-texto">Montando a semana...</div></div>';

    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dataInput = document.getElementById('data-agendamento').value;
    const dataBase = dataInput ? new Date(dataInput + 'T00:00:00') : new Date();
    const dia = dataBase.getDay();
    const diff = dia === 0 ? -6 : 1 - dia;
    const segunda = new Date(dataBase);
    segunda.setDate(dataBase.getDate() + diff);

    const nomes = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    const dias = Array.from({length: 5}, (_, i) => {
        const d = new Date(segunda);
        d.setDate(segunda.getDate() + i);
        return { data: fmt(d), nome: nomes[i], diaNum: d.getDate() };
    });

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
                prof: a.professores?.nome || 'Desconhecido',
                turma: a.turmas?.nome || 'Turma',
                minha: professorLogado && a.professor_id === professorLogado.id
            };
        });

        let html = '<div class="semana-wrapper"><table class="semana-tabela"><thead><tr><th>Aula</th>';
        dias.forEach(d => { html += `<th>${d.nome}<br>${d.diaNum}</th>`; });
        html += '</tr></thead><tbody>';

        for (let aula = 1; aula <= 7; aula++) {
            html += `<tr><td>${aula}ª</td>`;
            dias.forEach(d => {
                const inf = mapa[`${d.data}|${aula}`];
                if (inf?.minha) html += `<td><div class="semana-celula minha" title="Sua reserva — ${inf.turma}">★</div></td>`;
                else if (inf) html += `<td><div class="semana-celula ocupada" title="${inf.prof} — ${inf.turma}">●</div></td>`;
                else html += `<td><div class="semana-celula livre" title="Livre">○</div></td>`;
            });
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        html += `<div class="semana-legenda">
            <div class="semana-legenda-item"><div class="semana-legenda-cor" style="background:var(--cor-sucesso-clara);border-color:var(--cor-sucesso-borda);"></div>Livre</div>
            <div class="semana-legenda-item"><div class="semana-legenda-cor" style="background:var(--cor-perigo-clara);border-color:var(--cor-perigo-borda);"></div>Outro professor</div>
            <div class="semana-legenda-item"><div class="semana-legenda-cor" style="background:var(--cor-primaria-clara);border-color:var(--cor-primaria);"></div>Minha reserva</div>
        </div>`;

        container.innerHTML = html;
    } catch (err) {
        console.error("Erro ao carregar visão semanal:", err);
        container.innerHTML = '<div class="grid-vazio"><div class="icone-vazio">⚠️</div><p>Não foi possível carregar a semana.</p></div>';
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
        if (telaAtual === 'semana') carregarVisaoSemanal();
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
            window.location.href = 'index.html';
            return;
        }

        if (payload.eventType === 'UPDATE') {
            const acessoRevogado = payload.new?.auth_user_id === null;
            if (acessoRevogado) {
                await Swal.fire({ icon: 'info', title: 'Acesso redefinido', text: 'Crie um novo PIN para continuar.', confirmButtonColor: '#7c3aed', allowOutsideClick: false });
                await supabase.auth.signOut();
                window.location.href = 'cadasto.html';
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
