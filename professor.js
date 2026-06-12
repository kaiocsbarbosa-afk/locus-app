/* professor.js */
import { supabase, toggleDarkMode, carregarPreferenciaModo, registrarServiceWorker, dispararAlerta, formatarData } from './utils.js'

let professorLogado = null;
let buscandoAulasAtualmente = false;
let visualizacaoAtual = 'dia';

// Inicialização do Sistema
document.addEventListener("DOMContentLoaded", () => {
    carregarPreferenciaModo();
    verificarPinSalvo();
    registrarServiceWorker();
});

async function verificarPinSalvo() {
    const pinSalvo = localStorage.getItem('prof_pin');
    if (pinSalvo) {
        await fazerLogin(pinSalvo);
    }
}

window.fazerLogin = async function(pinAutomatico) {
    const pin = pinAutomatico || document.getElementById('pin-professor').value;
    
    if (!pin) {
        return Swal.fire({
            icon: 'warning',
            title: 'Atenção!',
            text: 'Por favor, informe seu PIN numérico.',
            confirmButtonColor: '#6C63FF'
        });
    }

    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) {
        btnLogin.innerText = 'Carregando... ⏳';
        btnLogin.disabled = true;
        btnLogin.style.opacity = '0.8';
    }

    const { data, error } = await supabase
        .from('professores')
        .select('*')
        .eq('pin', pin)
        .single();

    if (error || !data) {
        if (btnLogin) {
            btnLogin.innerText = 'Entrar Sistema';
            btnLogin.disabled = false;
            btnLogin.style.opacity = '1';
        }
        
        if (!pinAutomatico) {
            Swal.fire({
                icon: 'error',
                title: 'Ops!',
                text: 'PIN incorreto ou não localizado.',
                confirmButtonColor: '#6C63FF'
            });
        }
        localStorage.removeItem('prof_pin');
        return;
    }

    if (btnLogin) {
        btnLogin.innerText = 'Entrar Sistema';
        btnLogin.disabled = false;
        btnLogin.style.opacity = '1';
    }

    professorLogado = data;
    localStorage.setItem('prof_pin', pin);

    configurarInterfaceParaLogado();
    configurarCalendarioSemana();
    carregarHistorico();
}

window.fazerLogout = function() {
    localStorage.removeItem('prof_pin');
    window.location.reload();
}

function configurarInterfaceParaLogado() {
    document.getElementById('titulo-app').innerText = "Locus";
    document.getElementById('status-usuario').innerHTML = `Olá, <strong>${professorLogado.nome}</strong>! 👋`;
    document.getElementById('container-turma').classList.remove('hidden');
    document.getElementById('secao-historico').classList.remove('hidden');
    document.getElementById('btn-sair').classList.remove('hidden');
    
    document.getElementById('secao-login').classList.add('hidden');
    document.getElementById('secao-agendamento').classList.remove('hidden');

    carregarTurmas();
    carregarSalas();
}

async function carregarTurmas() {
    const selectTurma = document.getElementById('select-turma');
    try {
        const { data: turmas, error } = await supabase
            .from('turmas')
            .select('id, nome')
            .order('nome', { ascending: true });
        if (error) throw error;
        selectTurma.innerHTML = '<option value="">Selecione a turma...</option>';
        turmas.forEach(turma => {
            const option = document.createElement('option');
            option.value = turma.id;
            option.textContent = turma.nome;
            selectTurma.appendChild(option);
        });
    } catch (err) {
        console.error("Erro ao carregar turmas:", err);
        Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao carregar turmas.', confirmButtonColor: '#6C63FF' });
    }
}

async function carregarSalas() {
    const selectSala = document.getElementById('select-sala');
    try {
        const { data: salas, error } = await supabase
            .from('salas')
            .select('id, nome')
            .order('nome', { ascending: true });
        if (error) throw error;
        selectSala.innerHTML = '<option value="">Selecione uma sala...</option>';
        salas.forEach(sala => {
            const option = document.createElement('option');
            option.value = sala.id;
            option.textContent = sala.nome;
            selectSala.appendChild(option);
        });
    } catch (err) {
        console.error("Erro ao carregar salas:", err);
        Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao carregar salas.', confirmButtonColor: '#6C63FF' });
    }
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
        const resto = 5 - diaSemana;
        maxData.setDate(hoje.getDate() + resto);
    }

    const input = document.getElementById('data-agendamento');
    input.min = formatarData(minData);
    input.max = formatarData(maxData);
    input.value = formatarData(minData);
}

window.buscarAulas = async function() {
    const salaId = document.getElementById('select-sala').value;
    const dataEscolhida = document.getElementById('data-agendamento').value;
    const grid = document.getElementById('grid-aulas');

    // Se a visão semanal estiver ativa, atualiza ela também
    if (visualizacaoAtual === 'semana') {
        carregarVisaoSemanal();
    }

    if (buscandoAulasAtualmente) return;
    
    if (!salaId || !dataEscolhida) {
        grid.innerHTML = '';
        return;
    }

    grid.innerHTML = `
        <div class="spinner-container">
            <div class="spinner"></div>
            <div class="spinner-texto">Buscando grade...</div>
        </div>
    `;

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
            mapaOcupacao[a.aula_numero] = {
                prof: a.professores?.nome || 'Desconhecido',
                turma: a.turmas?.nome || 'Turma'
            };
        });

        grid.innerHTML = '';
        for (let i = 1; i <= 7; i++) {
            const btn = document.createElement('button');
            btn.classList.add('btn-aula');
            
            if (mapaOcupacao[i]) {
                btn.classList.add('ocupada');
                btn.innerHTML = `Aula ${i}<br><span style="font-size:0.7rem; font-weight:400;">🔒 ${mapaOcupacao[i].turma}<br>(${mapaOcupacao[i].prof})</span>`;
                btn.disabled = true;
            } else {
                btn.classList.add('disponivel');
                btn.innerHTML = `Aula ${i}<br><span style="font-size:0.7rem; font-weight:400;">✨ Livre</span>`;
                btn.onclick = () => agendarAula(i);
            }
            grid.appendChild(btn);
        }
    } catch (err) {
        console.error("Erro ao buscar aulas:", err);
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
        Swal.fire({
            icon: 'warning',
            title: 'Atenção!',
            text: 'Selecione a TURMA antes de escolher o horário da aula!',
            confirmButtonColor: '#6C63FF'
        }).then(() => { document.getElementById('select-turma').focus(); });
        return;
    }

    const { data: choqueProf } = await supabase
        .from('agendamentos')
        .select('id, salas(nome)')
        .eq('professor_id', professorLogado.id)
        .eq('data', dataEscolhida)
        .eq('aula_numero', numeroAula);

    if (choqueProf && choqueProf.length > 0) {
        Swal.fire({
            icon: 'error',
            title: 'Conflito de Horário!',
            text: `Você já reservou a sala "${choqueProf[0].salas.nome}" neste mesmo dia e horário.`,
            confirmButtonColor: '#6C63FF'
        });
        return;
    }

    const dataBr = dataEscolhida.split('-').reverse().join('/');
    const confirmacao = await Swal.fire({
        title: 'Confirmar reserva?',
        text: `Deseja agendar a Aula ${numeroAula} no dia ${dataBr}?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#6C63FF',
        cancelButtonColor: '#ff4d4d',
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
        Swal.fire({
            icon: 'error',
            title: 'Vaga Indisponível',
            text: 'Erro! Essa vaga pode ter sido preenchida agora há pouco por outro professor.',
            confirmButtonColor: '#6C63FF'
        });
    } else {
        Swal.fire({
            icon: 'success',
            title: 'Show!',
            text: 'Aula agendada com êxito! 🎉',
            confirmButtonColor: '#00b09b',
            timer: 2000,
            showConfirmButton: false
        });
        buscarAulas();
        carregarHistorico();
    }
}

window.carregarHistorico = async function() {
    if (!professorLogado) return;
    const listaHtml = document.getElementById('historico-lista');
    listaHtml.innerHTML = '<span style="font-size:0.85rem;color:var(--texto-secundario)">Carregando agenda...</span>';

    const hojeIso = formatarData(new Date());
    const { data: historico, error } = await supabase
        .from('agendamentos')
        .select('id, data, aula_numero, salas(nome), turmas(nome)')
        .eq('professor_id', professorLogado.id)
        .gte('data', hojeIso)
        .order('data', { ascending: true });

    if (error) {
        listaHtml.innerHTML = 'Erro ao carregar histórico.';
        return;
    }

    if (historico.length === 0) {
        listaHtml.innerHTML = '<span style="font-size:0.85rem;color:var(--texto-secundario)">Nenhum agendamento ativo nesta semana.</span>';
        return;
    }

    listaHtml.innerHTML = '';
    historico.forEach(item => {
        const dataBr = item.data.split('-').reverse().join('/');
        const divItem = document.createElement('div');
        divItem.classList.add('historico-item');
        divItem.innerHTML = `
            <div class="historico-info">
                <strong>${item.salas.nome} - Aula ${item.aula_numero}º</strong>
                <span>Dia: ${dataBr} | Turma: ${item.turmas.nome}</span>
            </div>
            <button class="btn-cancelar" onclick="cancelarAgendamento('${item.id}')">Excluir</button>
        `;
        listaHtml.appendChild(divItem);
    });
}

window.cancelarAgendamento = async function(idAgendamento) {
    const confirmacao = await Swal.fire({
        title: 'Cancelar Reserva?',
        text: "Tem certeza que deseja cancelar esta reserva de sala?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ff4d4d',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Sim, cancelar!',
        cancelButtonText: 'Manter reserva'
    });

    if (!confirmacao.isConfirmed) return;

    const { error } = await supabase.from('agendamentos').delete().eq('id', idAgendamento);

    if (error) {
        Swal.fire({
            icon: 'error',
            title: 'Erro!',
            text: 'Não foi possível cancelar a reserva no momento.',
            confirmButtonColor: '#6C63FF'
        });
    } else {
        Swal.fire({
            icon: 'success',
            title: 'Cancelada!',
            text: 'Reserva removida com sucesso.',
            confirmButtonColor: '#00b09b',
            timer: 2000,
            showConfirmButton: false
        });
        buscarAulas();
        carregarHistorico();
    }
}

// ============================================================
//  VISUALIZAÇÃO SEMANAL
// ============================================================

window.alternarVisualizacao = function(modo) {
    visualizacaoAtual = modo;

    const btnDia = document.getElementById('btn-view-dia');
    const btnSemana = document.getElementById('btn-view-semana');
    const gridDia = document.getElementById('grid-aulas');
    const gridSemana = document.getElementById('visao-semanal');

    if (modo === 'semana') {
        btnDia.classList.remove('active');
        btnSemana.classList.add('active');
        gridDia.classList.add('hidden');
        gridSemana.classList.remove('hidden');
        carregarVisaoSemanal();
    } else {
        btnSemana.classList.remove('active');
        btnDia.classList.add('active');
        gridSemana.classList.add('hidden');
        gridDia.classList.remove('hidden');
    }
}

// Calcula a segunda-feira da semana atual (ou da semana da data escolhida)
function obterSegundaFeiraDaSemana(dataBase) {
    const data = new Date(dataBase);
    const dia = data.getDay(); // 0 = domingo, 1 = segunda...
    const diff = dia === 0 ? -6 : 1 - dia; // volta até a segunda
    data.setDate(data.getDate() + diff);
    return data;
}

window.carregarVisaoSemanal = async function() {
    const salaId = document.getElementById('select-sala').value;
    const container = document.getElementById('visao-semanal');

    if (!salaId) {
        container.innerHTML = `
            <div class="grid-vazio">
                <div class="icone-vazio">🏫</div>
                <p>Selecione uma sala para ver a semana inteira.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="spinner-container">
            <div class="spinner"></div>
            <div class="spinner-texto">Montando a semana...</div>
        </div>
    `;

    // Usa a data já escolhida no input (ou hoje) para achar a semana
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
        const dataInicio = diasDaSemana[0].data;
        const dataFim = diasDaSemana[4].data;

        const { data: agendamentos, error } = await supabase
            .from('agendamentos')
            .select('data, aula_numero, professor_id, professores(nome), turmas(nome)')
            .eq('sala_id', salaId)
            .gte('data', dataInicio)
            .lte('data', dataFim);

        if (error) throw error;

        // Mapa: "data|aula" -> { prof, turma, minha }
        const mapa = {};
        agendamentos.forEach(a => {
            const chave = `${a.data}|${a.aula_numero}`;
            mapa[chave] = {
                prof: a.professores?.nome || 'Desconhecido',
                turma: a.turmas?.nome || 'Turma',
                minha: professorLogado && a.professor_id === professorLogado.id
            };
        });

        // Monta a tabela: linhas = aulas 1-7, colunas = dias da semana
        let html = '<div class="semana-wrapper"><table class="semana-tabela"><thead><tr><th>Aula</th>';
        diasDaSemana.forEach(d => {
            html += `<th>${d.nome}<br>${d.diaNum}</th>`;
        });
        html += '</tr></thead><tbody>';

        for (let aula = 1; aula <= 7; aula++) {
            html += `<tr><td>${aula}ª</td>`;
            diasDaSemana.forEach(d => {
                const chave = `${d.data}|${aula}`;
                const info = mapa[chave];

                if (info && info.minha) {
                    html += `<td><div class="semana-celula minha" title="Sua reserva — Turma ${info.turma}">★</div></td>`;
                } else if (info) {
                    html += `<td><div class="semana-celula ocupada" title="${info.prof} — Turma ${info.turma}">●</div></td>`;
                } else {
                    html += `<td><div class="semana-celula livre" title="Horário livre">○</div></td>`;
                }
            });
            html += '</tr>';
        }

        html += '</tbody></table></div>';

        html += `
            <div class="semana-legenda">
                <div class="semana-legenda-item">
                    <div class="semana-legenda-cor" style="background:var(--cor-sucesso-clara); border-color:var(--cor-sucesso-borda);"></div>
                    Livre
                </div>
                <div class="semana-legenda-item">
                    <div class="semana-legenda-cor" style="background:var(--cor-perigo-clara); border-color:var(--cor-perigo-borda);"></div>
                    Ocupada por outro professor
                </div>
                <div class="semana-legenda-item">
                    <div class="semana-legenda-cor" style="background:var(--cor-primaria-clara); border-color:var(--cor-primaria);"></div>
                    Sua reserva
                </div>
            </div>
        `;

        container.innerHTML = html;

    } catch (err) {
        console.error("Erro ao carregar visão semanal:", err);
        container.innerHTML = `
            <div class="grid-vazio">
                <div class="icone-vazio">⚠️</div>
                <p>Não foi possível carregar a semana. Tente novamente.</p>
            </div>
        `;
    }
}

// SINCRO_TEMPO_REAL
supabase
    .channel('mudancas-agendamentos-prof')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, (payload) => {
        console.log('Grade atualizada em tempo real!');
        buscarAulas();
        if (professorLogado) carregarHistorico();
        if (visualizacaoAtual === 'semana') carregarVisaoSemanal();
    })
    .subscribe();
