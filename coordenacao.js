import { supabase, toggleDarkMode, carregarPreferenciaModo, registrarServiceWorker, dispararAlerta } from './utils.js'
import { ativarNotificacoes, enviarNotificacao } from './push.js'

window.addEventListener('error', function(e) {
    console.error("Erro capturado:", e);
    dispararAlerta({
        icon: 'error',
        title: 'Erro no sistema',
        text: `${e.message} (linha ${e.lineno})`,
        confirmButtonColor: 'var(--cor-perigo)'
    });
});

const URL_GOOGLE_SCRIPT = "https://script.google.com/macros/s/AKfycbw6fMtP880hmAdtRSj8tgBVCw-U9qGo-JnOqMD7DCb_I5q6Isooady17YNCmmUlKemhzQ/exec"

let dadosAtuaisParaExportar = [];

// ============================================================
//  AUTENTICAÇÃO — agora via Edge Function (segura)
//  A senha nunca desce para o front-end
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    carregarPreferenciaModo();
    registrarServiceWorker();
    if (sessionStorage.getItem('coord_logada') === 'true') {
        mostrarDashboard();
    }

    const inputSenha = document.getElementById("senha-coord");
    if (inputSenha) {
        inputSenha.addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                inputSenha.blur();
                entrarPainel();
            }
        });
    }

    carregarSalasNoFiltro();
    carregarProfessoresNoFiltro();
    carregarDisciplinasNoPreCadastro();

    const fData = document.getElementById('filtroData');
    const fSala = document.getElementById('filtroSala');
    const fProfessor = document.getElementById('filtroProfessor');
    if (fData) fData.addEventListener('change', () => carregarRelatorioGeral());
    if (fSala) fSala.addEventListener('change', () => carregarRelatorioGeral());
    if (fProfessor) fProfessor.addEventListener('change', () => carregarRelatorioGeral());
});

window.entrarPainel = async function() {
    const senhaDigitada = document.getElementById('senha-coord').value;

    if (!senhaDigitada) {
        dispararAlerta({
            icon: 'warning',
            title: 'Atenção',
            text: 'Por favor, digite a senha.',
            confirmButtonColor: 'var(--cor-primaria)'
        });
        return;
    }

    Swal.fire({
        title: 'Autenticando...',
        text: 'Verificando credenciais',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        // Chama a Edge Function no servidor — a senha real nunca desce ao browser
        const { data, error } = await supabase.functions.invoke('verificar-senha-coord', {
            body: { senha: senhaDigitada }
        });

        Swal.close();

        if (error) {
            console.error("Erro na Edge Function:", error);
            dispararAlerta({
                icon: 'error',
                title: 'Erro de conexão',
                text: 'Não foi possível verificar as credenciais. Tente novamente.',
                confirmButtonColor: 'var(--cor-perigo)'
            });
            return;
        }

        if (!data?.autorizado) {
            dispararAlerta({
                icon: 'error',
                title: 'Acesso Negado',
                text: 'Senha incorreta.',
                confirmButtonColor: 'var(--cor-perigo)'
            });
            document.getElementById('senha-coord').value = '';
            return;
        }

        sessionStorage.setItem('coord_logada', 'true');
        mostrarDashboard();

    } catch (err) {
        Swal.close();
        console.error("Erro inesperado:", err);
        dispararAlerta({
            icon: 'error',
            title: 'Erro crítico',
            text: `Falha na requisição: ${err.message}`,
            confirmButtonColor: 'var(--cor-perigo)'
        });
    }
}

window.sairPainel = function() {
    sessionStorage.removeItem('coord_logada');
    window.location.reload();
}

// ============================================================
//  DASHBOARD
// ============================================================

function mostrarDashboard() {
    document.getElementById('secao-login-coord').classList.add('hidden');
    document.getElementById('secao-dashboard').classList.remove('hidden');

    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    const inputData = document.getElementById('filtroData');
    if (inputData) inputData.value = `${ano}-${mes}-${dia}`;

    carregarRelatorioGeral();

    // Ativa notificações push para a coordenação
    ativarNotificacoes('coordenacao');
}

async function carregarSalasNoFiltro() {
    try {
        const { data: salas, error } = await supabase
            .from('salas')
            .select('id, nome')
            .order('nome', { ascending: true });

        if (error) throw error;

        const selectSala = document.getElementById('filtroSala');
        selectSala.innerHTML = '<option value="">Todas as salas</option>';
        salas.forEach(sala => {
            const option = document.createElement('option');
            option.value = sala.id;
            option.textContent = sala.nome;
            selectSala.appendChild(option);
        });
    } catch (erro) {
        console.error("Erro ao carregar salas:", erro);
    }
}

async function carregarProfessoresNoFiltro() {
    try {
        const { data: professores, error } = await supabase
            .from('professores')
            .select('id, nome')
            .order('nome', { ascending: true });

        if (error) throw error;

        const selectProfessor = document.getElementById('filtroProfessor');
        if (!selectProfessor) return;

        selectProfessor.innerHTML = '<option value="">Todos os professores</option>';
        professores.forEach(prof => {
            const option = document.createElement('option');
            option.value = prof.id;
            option.textContent = prof.nome;
            selectProfessor.appendChild(option);
        });
    } catch (erro) {
        console.error("Erro ao carregar professores:", erro);
    }
}

async function carregarDisciplinasNoPreCadastro() {
    try {
        const { data: disciplinas, error } = await supabase
            .from('disciplinas')
            .select('id, nome')
            .order('nome', { ascending: true });

        if (error) throw error;

        const selectDisciplina = document.getElementById('coord-disciplina-professor');
        if (!selectDisciplina) return;

        selectDisciplina.innerHTML = '<option value="">Selecione a disciplina...</option>';
        disciplinas.forEach(disc => {
            const option = document.createElement('option');
            option.value = disc.nome;
            option.textContent = disc.nome;
            selectDisciplina.appendChild(option);
        });
    } catch (erro) {
        console.error("Erro ao carregar disciplinas:", erro);
    }
}

window.salvarPreCadastro = async function() {
    const nome = document.getElementById('coord-nome-professor').value.trim();
    const disciplina = document.getElementById('coord-disciplina-professor').value;

    if (!nome || !disciplina) {
        dispararAlerta({
            icon: 'warning',
            title: 'Campos obrigatórios',
            text: 'Preencha o nome e selecione a disciplina do professor.',
            confirmButtonColor: 'var(--cor-primaria)'
        });
        return;
    }

    try {
        const { error } = await supabase
            .from('professores')
            .insert([{ nome, disciplina, pin: null }]);

        if (error) throw error;

        dispararAlerta({
            icon: 'success',
            title: 'Professor liberado!',
            text: `${nome} já pode criar seu PIN de acesso.`,
            confirmButtonColor: 'var(--cor-sucesso)',
            timer: 2500,
            showConfirmButton: false
        });

        document.getElementById('coord-nome-professor').value = '';
        document.getElementById('coord-disciplina-professor').value = '';

    } catch (err) {
        console.error("Erro ao pré-cadastrar professor:", err);
        dispararAlerta({
            icon: 'error',
            title: 'Erro de banco de dados',
            text: 'Não foi possível autorizar o professor.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
    }
}

window.carregarRelatorioGeral = async function() {
    const filtroData = document.getElementById('filtroData');
    const filtroSala = document.getElementById('filtroSala');
    const filtroProfessor = document.getElementById('filtroProfessor');
    const tabela = document.getElementById('listaAgendamentos');

    if (!filtroData || !tabela) return;

    const dataFiltro = filtroData.value;
    const salaFiltro = filtroSala?.value || '';
    const professorFiltro = filtroProfessor?.value || '';

    tabela.innerHTML = '';
    dadosAtuaisParaExportar = [];

    // Exige pelo menos um filtro para evitar carregar a tabela inteira
    if (!dataFiltro && !salaFiltro && !professorFiltro) {
        tabela.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--texto-secundario)">Selecione uma data, sala ou professor para ver os agendamentos.</td></tr>`;
        return;
    }

    tabela.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--texto-secundario)">Carregando...</td></tr>`;

    let query = supabase
        .from('agendamentos')
        .select('id, data, aula_numero, professor_id, salas(nome), professores(nome), turmas(nome)');

    if (dataFiltro) {
        query = query.eq('data', dataFiltro);
    }

    if (salaFiltro) {
        query = query.eq('sala_id', salaFiltro);
    }

    if (professorFiltro) {
        query = query.eq('professor_id', professorFiltro);
    }

    const { data: agendamentos, error } = await query
        .order('data', { ascending: true })
        .order('aula_numero', { ascending: true });

    if (error) {
        dispararAlerta({
            icon: 'error',
            title: 'Erro de carregamento',
            text: 'Não foi possível buscar os agendamentos.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
        return;
    }

    const qtdEl = document.getElementById('qtd-total');
    if (qtdEl) qtdEl.innerText = agendamentos.length;

    dadosAtuaisParaExportar = agendamentos;

    if (!agendamentos || agendamentos.length === 0) {
        tabela.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--texto-secundario)">Nenhum agendamento encontrado para os filtros selecionados.</td></tr>`;
        return;
    }

    tabela.innerHTML = '';
    agendamentos.forEach(item => {
        const dataBr = item.data.split('-').reverse().join('/');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${dataBr}</strong></td>
            <td><span class="badge-aula">Aula ${item.aula_numero}º</span></td>
            <td>${item.salas?.nome || 'Não informada'}</td>
            <td>Prof. ${item.professores?.nome || 'Desconhecido'}</td>
            <td>${item.turmas?.nome || 'Geral'}</td>
            <td>
                <button class="btn-revogar" onclick="revogarAgendamento('${item.id}', '${item.salas?.nome}', '${item.aula_numero}', '${item.professor_id}', '${dataBr}')">
                    Cancelar
                </button>
            </td>
        `;
        tabela.appendChild(tr);
    });
}

window.limparFiltros = function() {
    const filtroData = document.getElementById('filtroData');
    const filtroSala = document.getElementById('filtroSala');
    const filtroProfessor = document.getElementById('filtroProfessor');

    if (filtroData) filtroData.value = '';
    if (filtroSala) filtroSala.value = '';
    if (filtroProfessor) filtroProfessor.value = '';

    carregarRelatorioGeral();
}

window.revogarAgendamento = async function(idAgendamento, nomeSala, numeroAula, professorId, dataBr) {
    const confirmacao = await Swal.fire({
        title: 'Tem certeza?',
        text: `Cancelar reserva de ${nomeSala} — Aula ${numeroAula}?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-perigo)',
        cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: 'Sim, cancelar!',
        cancelButtonText: 'Voltar'
    });

    if (!confirmacao.isConfirmed) return;

    const { error } = await supabase.from('agendamentos').delete().eq('id', idAgendamento);

    if (error) {
        dispararAlerta({ icon: 'error', title: 'Erro!', text: 'Não foi possível excluir o agendamento.', confirmButtonColor: 'var(--cor-primaria)' });
    } else {
        dispararAlerta({ icon: 'success', title: 'Cancelado!', text: 'Reserva removida.', timer: 1500, showConfirmButton: false });
        carregarRelatorioGeral();

        // Notifica o professor que a coordenação cancelou a reserva dele
        if (professorId && professorId !== 'undefined' && professorId !== 'null') {
            enviarNotificacao(
                'Reserva cancelada pela coordenação',
                `Sua reserva de ${nomeSala} (Aula ${numeroAula}) em ${dataBr} foi cancelada pela coordenação.`,
                'professor',
                professorId
            );
        }
    }
}

window.exportarParaPlanilha = async function() {
    if (!dadosAtuaisParaExportar || dadosAtuaisParaExportar.length === 0) {
        dispararAlerta({
            icon: 'warning',
            title: 'Tabela vazia',
            text: 'Filtre por uma data com agendamentos antes de exportar.',
            confirmButtonColor: 'var(--cor-primaria)'
        });
        return;
    }

    Swal.fire({ title: 'Exportando...', text: 'Enviando para o Google Planilhas.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    const dadosFormatados = dadosAtuaisParaExportar.map(item => ({
        data: item.data.split('-').reverse().join('/'),
        horario: `Aula ${item.aula_numero}º`,
        sala: item.salas?.nome || 'Não informada',
        professor: item.professores?.nome || 'Desconhecido',
        turma: item.turmas?.nome || 'Geral'
    }));

    try {
        await fetch(URL_GOOGLE_SCRIPT, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify(dadosFormatados)
        });

        Swal.close();
        dispararAlerta({ icon: 'success', title: 'Concluído!', text: 'Dados enviados para a planilha.', confirmButtonColor: 'var(--cor-sucesso)' });

    } catch (erro) {
        Swal.close();
        dispararAlerta({ icon: 'error', title: 'Falha no envio', text: erro.message, confirmButtonColor: 'var(--cor-perigo)' });
    }
}

// Realtime — atualiza tabela automaticamente
supabase
    .channel('mudancas-agendamentos-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, () => {
        if (sessionStorage.getItem('coord_logada') === 'true') {
            carregarRelatorioGeral();
        }
    })
    .subscribe();
