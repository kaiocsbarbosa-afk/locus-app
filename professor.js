/* app.js */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://ixhuqbfzwkobhrvlzwgm.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4aHVxYmZ6d2tvYmhydmx6d2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjIyOTgsImV4cCI6MjA5NTU5ODI5OH0.ZtKv5X2Zxjp80Cjmvy0NzFDqadBYUvWBZHH12iD8x84'
const supabase = createClient(supabaseUrl, supabaseKey)

let professorLogado = null;
let buscandoAulasAtualmente = false;

// Inicialização do Sistema
document.addEventListener("DOMContentLoaded", () => {
    carregarPreferenciaModo();
    verificarPinSalvo();
    registrarServiceWorker();
});

function registrarServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('PWA Service Worker ativo!', reg.scope))
            .catch(err => console.warn('Falha no registro do Service Worker', err));
    }
}

window.toggleDarkMode = function() {
    document.body.classList.toggle('dark-mode');
    const estauradoDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('darkMode', estauradoDark ? 'enabled' : 'disabled');
    document.getElementById('txt-modo').innerText = estauradoDark ? '☀️ Claro' : '🌙 Escuro';
}

function carregarPreferenciaModo() {
    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        document.getElementById('txt-modo').innerText = '☀️ Claro';
    }
}

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

function formatarData(dataObj) {
    const ano = dataObj.getFullYear();
    const mes = String(dataObj.getMonth() + 1).padStart(2, '0');
    const dia = String(dataObj.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
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

// SINCRO_TEMPO_REAL
supabase
    .channel('mudancas-agendamentos-prof')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, (payload) => {
        console.log('Grade atualizada em tempo real!');
        buscarAulas();
        if (professorLogado) carregarHistorico();
    })
    .subscribe();
