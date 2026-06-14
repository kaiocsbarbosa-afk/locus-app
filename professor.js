/* professor.js */
import { supabase, toggleDarkMode as _toggleDarkMode, carregarPreferenciaModo, registrarServiceWorker, dispararAlerta, formatarData } from './utils.js'
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

    // Splash screen: aguarda 2s e desliza para fora
    setTimeout(() => {
        const splash = document.getElementById('splash');
        splash.classList.add('saindo');
        setTimeout(() => {
            splash.style.display = 'none';
            verificarPinSalvo();
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

// Sobrescreve toggleDarkMode para atualizar os botões do app
window.toggleDarkMode = function() {
    _toggleDarkMode();
    atualizarBtnDarkMode();
}

async function verificarPinSalvo() {
    const pinSalvo = localStorage.getItem('prof_pin');
    if (pinSalvo) {
        await fazerLogin(pinSalvo);
    }
}

// ============================================================
//  NAVEGAÇÃO ENTRE TELAS
// ============================================================

const TELAS = {
    'agendar':      { titulo: 'Agendar',      elemento: 'tela-agendar' },
    'semana':       { titulo: 'Semana',        elemento: 'tela-semana' },
    'minhas-aulas': { titulo: 'Minhas aulas',  elemento: 'tela-minhas-aulas' },
    'perfil':       { titulo: 'Perfil',        elemento: 'tela-perfil' },
};

window.trocarTela = function(nomeTela) {
    if (nomeTela === telaAtual) return;
    telaAtual = nomeTela;

    // Atualiza título do header
    const header = document.getElementById('header-titulo');
    if (header) header.textContent = TELAS[nomeTela]?.titulo || 'Locus';

    // Troca a tela visível com animação
    Object.entries(TELAS).forEach(([id, cfg]) => {
        const el = document.getElementById(cfg.elemento);
        if (!el) return;
        if (id === nomeTela) {
            el.classList.add('ativa', 'entrando');
            setTimeout(() => el.classList.remove('entrando'), 250);
        } else {
            el.classList.remove('ativa');
        }
    });

    // Atualiza o tab ativo
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('ativa'));
    const tab = document.getElementById(`tab-${nomeTela}`);
    if (tab) tab.classList.add('ativa');

    // Ações específicas ao entrar na tela
    if (nomeTela === 'semana') {
        const sala = document.getElementById('select-sala');
        const info = document.getElementById('semana-sala-info');
        if (sala?.value && sala.selectedOptions[0]?.textContent) {
            if (info) info.textContent = sala.selectedOptions[0].textContent;
        } else {
            if (info) info.textContent = 'Selecione uma sala na aba Agendar';
        }
        carregarVisaoSemanal();
    }
    if (nomeTela === 'minhas-aulas') carregarHistorico();
    if (nomeTela === 'perfil') atualizarPerfil();
}

function atualizarPerfil() {
    if (!professorLogado) return;
    const nome = document.getElementById('perfil-nome');
    const disc = document.getElementById('perfil-disciplina');
    if (nome) nome.textContent = professorLogado.nome;
    if (disc) disc.textContent = professorLogado.disciplina || 'Sem disciplina';

    // Status notificações
    const statusNotif = document.getElementById('status-notif');
    if (statusNotif) {
        const perm = Notification?.permission;
        statusNotif.textContent = perm === 'granted' ? 'Ativas' : perm === 'denied' ? 'Bloqueadas' : 'Não configuradas';
    }
}

// ============================================================
//  AUTENTICAÇÃO
// ============================================================

window.fazerLogin = async function(pinAutomatico) {
    const pin = pinAutomatico || document.getElementById('pin-professor').value;

    if (!pin) {
        return Swal.fire({ icon: 'warning', title: 'Atenção!', text: 'Por favor, informe seu PIN.', confirmButtonColor: '#7c3aed' });
    }

    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) { btnLogin.innerText = 'Entrando... ⏳'; btnLogin.disabled = true; }

    const { data, error } = await supabase
        .from('professores')
        .select('*')
        .eq('pin', pin)
        .single();

    if (error || !data) {
        if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }
        if (!pinAutomatico) {
            Swal.fire({ icon: 'error', title: 'Ops!', text: 'PIN incorreto ou não localizado.', confirmButtonColor: '#7c3aed' });
        }
        localStorage.removeItem('prof_pin');
        return;
    }

    if (btnLogin) { btnLogin.innerText = 'Entrar'; btnLogin.disabled = false; }

    professorLogado = data;
    localStorage.setItem('prof_pin', pin);

    mostrarAppLogado();
    ativarNotificacoes('professor', professorLogado.id);
}

window.fazerLogout = function() {
    localStorage.removeItem('prof_pin');
    window.location.reload();
}

function mostrarAppLogado() {
    // Esconde login, mostra app shell
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('app-header').classList.add('visivel');
    document.getElementById('bottom-nav').classList.add('visivel');

    // Saudação
    const status = document.getElementById('status-usuario');
    if (status) status.innerHTML = `Olá, <strong>${professorLogado.nome}</strong>! 👋`;

    // Ativa a primeira tela
    document.getElementById('tela-agendar').classList.add('ativa');

    configurarCalendarioSemana();
    carregarTurmas();
    carregarSalas();
    carregarHistorico();
}

// ============================================================
//  DADOS
// ============================================================

async function carregarTurmas() {
    const selectTurma = document.getElementById('select-turma');
    try {
        const { data: turmas, error } = await supabase.from('turmas').select('id, nome').order('nome', { ascending: true });
        if (error) throw error;
        selectTurma.innerHTML = '<option value="">Selecione a turma...</option>';
        turmas.forEach(t => {
            const o = document.createElement('option');
            o.value = t.id; o.textContent = t.nome;
            selectTurma.appendChild(o);
        });
    } catch (err) { console.error("Erro ao carregar turmas:", err); }
}

async function carregarSalas() {
    const selectSala = document.getElementById('select-sala');
    try {
        const { data: salas, error } = await supabase.from('salas').select('id, nome').order('nome', { ascending: true });
        if (error) throw error;
        selectSala.innerHTML = '<option value="">Selecione uma sala...</option>';
        salas.forEach(s => {
            const o = document.createElement('option');
            o.value = s.id; o.textContent = s.nome;
            selectSala.appendChild(o);
        });
    } catch (err) { console.error("Erro ao carregar salas:", err); }
}

function configurarCalendarioSemana() {
    const hoje = new Date();
    const diaSemana = hoje.getDay();
    let minData = new Date(hoje);
    let maxData = new Date(hoje);

    if (diaSemana === 0) {
        minData.setDate(hoje.getDate() + 1);
        maxData.setDate(hoje.getDate() + 5);
    } else if (diaSemana === 6) {
        minData.setDate(hoje.getDate() + 2);
        maxData.setDate(hoje.getDate() + 6);
    } else {
        minData = hoje;
        maxData.setDate(hoje.getDate() + (5 - diaSemana));
    }

    const input = document.getElementById('data-agendamento');
    input.min = formatarData(minData);
    input.max = formatarData(maxData);
    input.value = formatarData(minData);
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
        title: 'Confirmar reserva?',
        text: `Aula ${numeroAula} no dia ${dataBr}?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#7c3aed',
        cancelButtonColor: '#9ca3af',
        confirmButtonText: 'Sim, agendar!',
        cancelButtonText: 'Cancelar'
    });

    if (!confirmacao.isConfirmed) return;

    const { error } = await supabase.from('agendamentos').insert([{
        professor_id: professorLogado.id,
        sala_id: salaId,
        turma_id: turmaId,
        data: dataEscolhida,
        aula_numero: numeroAula
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
//  HISTÓRICO (MINHAS AULAS)
// ============================================================

window.carregarHistorico = async function() {
    if (!professorLogado) return;
    const listaHtml = document.getElementById('historico-lista');
    if (!listaHtml) return;

    listaHtml.innerHTML = '<div class="minhas-aulas-vazio">Carregando...</div>';

    const hojeIso = formatarData(new Date());
    const { data: historico, error } = await supabase
        .from('agendamentos')
        .select('id, data, aula_numero, salas(nome), turmas(nome)')
        .eq('professor_id', professorLogado.id)
        .gte('data', hojeIso)
        .order('data', { ascending: true });

    if (error) { listaHtml.innerHTML = '<div class="minhas-aulas-vazio">Erro ao carregar.</div>'; return; }

    if (historico.length === 0) {
        listaHtml.innerHTML = '<div class="minhas-aulas-vazio">Nenhum agendamento ativo esta semana.</div>';
        return;
    }

    listaHtml.innerHTML = '';
    historico.forEach(item => {
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

window.cancelarAgendamento = async function(idAgendamento, nomeSala, numeroAula, dataBr) {
    const confirmacao = await Swal.fire({
        title: 'Cancelar reserva?',
        text: "Tem certeza que deseja cancelar esta reserva?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#9ca3af',
        confirmButtonText: 'Sim, cancelar!',
        cancelButtonText: 'Manter'
    });

    if (!confirmacao.isConfirmed) return;

    const { error } = await supabase.from('agendamentos').delete().eq('id', idAgendamento);

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
//  VISUALIZAÇÃO SEMANAL
// ============================================================

function obterSegundaFeiraDaSemana(dataBase) {
    const data = new Date(dataBase);
    const dia = data.getDay();
    const diff = dia === 0 ? -6 : 1 - dia;
    data.setDate(data.getDate() + diff);
    return data;
}

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

    const dataInput = document.getElementById('data-agendamento').value;
    const dataBase = dataInput ? new Date(dataInput + 'T00:00:00') : new Date();
    const segunda = obterSegundaFeiraDaSemana(dataBase);

    const diasDaSemana = [];
    const nomesDias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    for (let i = 0; i < 5; i++) {
        const d = new Date(segunda);
        d.setDate(segunda.getDate() + i);
        diasDaSemana.push({ data: formatarData(d), nome: nomesDias[i], diaNum: d.getDate() });
    }

    try {
        const { data: agendamentos, error } = await supabase
            .from('agendamentos')
            .select('data, aula_numero, professor_id, professores(nome), turmas(nome)')
            .eq('sala_id', salaId)
            .gte('data', diasDaSemana[0].data)
            .lte('data', diasDaSemana[4].data);

        if (error) throw error;

        const mapa = {};
        agendamentos.forEach(a => {
            mapa[`${a.data}|${a.aula_numero}`] = {
                prof: a.professores?.nome || 'Desconhecido',
                turma: a.turmas?.nome || 'Turma',
                minha: professorLogado && a.professor_id === professorLogado.id
            };
        });

        let html = '<div class="semana-wrapper"><table class="semana-tabela"><thead><tr><th>Aula</th>';
        diasDaSemana.forEach(d => { html += `<th>${d.nome}<br>${d.diaNum}</th>`; });
        html += '</tr></thead><tbody>';

        for (let aula = 1; aula <= 7; aula++) {
            html += `<tr><td>${aula}ª</td>`;
            diasDaSemana.forEach(d => {
                const info = mapa[`${d.data}|${aula}`];
                if (info?.minha) html += `<td><div class="semana-celula minha" title="Sua reserva — ${info.turma}">★</div></td>`;
                else if (info) html += `<td><div class="semana-celula ocupada" title="${info.prof} — ${info.turma}">●</div></td>`;
                else html += `<td><div class="semana-celula livre" title="Livre">○</div></td>`;
            });
            html += '</tr>';
        }

        html += '</tbody></table></div>';
        html += `
            <div class="semana-legenda">
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
        buscarAulas();
        if (professorLogado) carregarHistorico();
        if (telaAtual === 'semana') carregarVisaoSemanal();
    })
    .subscribe();
