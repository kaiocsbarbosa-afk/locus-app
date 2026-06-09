import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Função auxiliar de segurança para garantir que o app não trave se o SweetAlert2 falhar
function dispararAlerta(config) {
    if (typeof Swal !== 'undefined') {
        Swal.fire(config);
    } else {
        alert(`${config.title}: ${config.text}`);
    }
}

// Captura qualquer erro invisível na tela de forma elegante
window.addEventListener('error', function(e) {
    console.error("Erro capturado:", e);
    dispararAlerta({
        icon: 'error',
        title: '🚨 O código quebrou!',
        text: `Erro: ${e.message} na linha ${e.lineno}`,
        confirmButtonColor: 'var(--cor-perigo)'
    });
});

// 🔒 FUNÇÃO DE CRIPTOGRAFIA (HASH)
async function gerarHashDaSenha(senha) {
    const encoder = new TextEncoder();
    const data = encoder.encode(senha);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// =========================================================================
// CONFIGURAÇÃO
// =========================================================================
const supabaseUrl = 'https://ixhuqbfzwkobhrvlzwgm.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4aHVxYmZ6d2tvYmhydmx6d2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjIyOTgsImV4cCI6MjA5NTU5ODI5OH0.ZtKv5X2Zxjp80Cjmvy0NzFDqadBYUvWBZHH12iD8x84'

// URL DO GOOGLE (Terminando obrigatoriamente com /exec)
const URL_GOOGLE_SCRIPT = "https://script.google.com/macros/s/AKfycbw6fMtP880hmAdtRSj8tgBVCw-U9qGo-JnOqMD7DCb_I5q6Isooady17YNCmmUlKemhzQ/exec";
// =========================================================================

const supabase = createClient(supabaseUrl, supabaseKey)
let dadosAtuaisParaExportar = [];

// Função para carregar as salas do Supabase no filtro da coordenação
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
        console.error("Erro ao carregar salas no filtro:", erro);
        dispararAlerta({
            icon: 'error',
            title: 'Erro ao carregar salas',
            text: 'Não foi possível buscar a lista de salas do banco de dados.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
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
});

// Função para carregar as disciplinas do Supabase no formulário de pré-cadastro
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
        dispararAlerta({
            icon: 'error',
            title: 'Erro ao carregar disciplinas',
            text: 'Não foi possível buscar a lista de disciplinas do banco de dados.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
    }
}

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

    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: 'Autenticando...',
            text: 'Buscando credenciais com segurança no Supabase',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
    }

    try {
        // 🔒 Transforma a senha digitada em Hash ANTES de comparar
        const senhaCriptografada = await gerarHashDaSenha(senhaDigitada);

        const { data, error } = await supabase
            .from('configuracoes')
            .select('valor')
            .eq('chave', 'senha_coordenacao')
            .maybeSingle();

        if (typeof Swal !== 'undefined') Swal.close();

        if (error) {
            console.error("Erro retornado do Supabase:", error);
            dispararAlerta({
                icon: 'error',
                title: 'Erro de Banco de Dados',
                text: `Não foi possível ler os dados. Motivo: ${error.message}.`,
                confirmButtonColor: 'var(--cor-perigo)'
            });
            return;
        }

        if (!data) {
            dispararAlerta({
                icon: 'error',
                title: 'Configuração Ausente',
                text: "A chave 'senha_coordenacao' não foi encontrada no banco.",
                confirmButtonColor: 'var(--cor-perigo)'
            });
            return;
        }

        // 🔒 Compara o Hash gerado agora com o Hash salvo no Supabase
        if (senhaCriptografada === data.valor) {
            sessionStorage.setItem('coord_logada', 'true');
            mostrarDashboard();
        } else {
            dispararAlerta({
                icon: 'error',
                title: 'Acesso Negado',
                text: '❌ Senha incorreta!',
                confirmButtonColor: 'var(--cor-perigo)'
            });
            document.getElementById('senha-coord').value = "";
        }
    } catch (err) {
        if (typeof Swal !== 'undefined') Swal.close();
        console.error("Erro na execução do bloco try-catch:", err);
        dispararAlerta({
            icon: 'error',
            title: 'Erro Crítico',
            text: `Falha na requisição: ${err.message}`,
            confirmButtonColor: 'var(--cor-perigo)'
        });
    }
}

window.sairPainel = function() {
    sessionStorage.removeItem('coord_logada');
    window.location.reload();
}

function mostrarDashboard() {
    document.getElementById('secao-login-coord').classList.add('hidden');
    document.getElementById('secao-dashboard').classList.remove('hidden');
    
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    
    const filtroData = document.getElementById('filtroData');
    if (filtroData) {
        filtroData.value = `${ano}-${mes}-${dia}`;
    }
    
    carregarRelatorioGeral();
}

window.salvarPreCadastro = async function() {
    const nomeInput = document.getElementById('coord-nome-professor').value.trim();
    const disciplinaInput = document.getElementById('coord-disciplina-professor').value;

    if (!nomeInput || !disciplinaInput) {
        return dispararAlerta({
            icon: 'warning',
            title: 'Campos Incompletos',
            text: 'Por favor, informe o nome completo do professor e escolha uma disciplina.',
            confirmButtonColor: 'var(--cor-primaria)'
        });
    }

    document.activeElement.blur();

    try {
        const { error } = await supabase
            .from('professores')
            .insert([{
                nome: nomeInput,
                disciplina: disciplinaInput,
                pin: null 
            }]);

        if (error) throw error;

        dispararAlerta({
            icon: 'success',
            title: 'Professor Autorizado!',
            text: `"${nomeInput}" foi liberado. Ele já pode configurar o PIN de 4 dígitos na página de ativação.`,
            confirmButtonColor: 'var(--cor-sucesso)'
        });

        document.getElementById('coord-nome-professor').value = "";
        document.getElementById('coord-disciplina-professor').value = "";

    } catch (err) {
        console.error("Erro ao pré-cadastrar professor:", err);
        dispararAlerta({
            icon: 'error',
            title: 'Erro de Banco de Dados',
            text: 'Não foi possível autorizar o professor. Verifique se a tabela aceita valores NULL.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
    }
}

window.carregarRelatorioGeral = async function() {
    const filtroData = document.getElementById('filtroData') || document.getElementById('filtro-data');
    const filtroSala = document.getElementById('filtroSala') || document.getElementById('filtro-sala');
    const tabela = document.getElementById('corpo-tabela') || document.getElementById('listaAgendamentos');
    const avisoVazio = document.getElementById('aviso-vazio') || document.getElementById('sem-dados');

    if (!filtroData || !tabela) return;
    
    const dataFiltro = filtroData.value;
    const salaFiltro = filtroSala?.value || ''; 

    console.log("🔍 [DIAGNÓSTICO] Tentando buscar agendamentos da data:", dataFiltro, "| Sala ID:", salaFiltro);

    tabela.innerHTML = '';
    dadosAtuaisParaExportar = [];
    if (!dataFiltro) return;

    let query = supabase
        .from('agendamentos')
        .select('id, data, aula_numero, salas(nome), professores(nome), turmas(nome)')
        .eq('data', dataFiltro);

    if (salaFiltro) {
        query = query.eq('sala_id', salaFiltro);
    }

    const { data: agendamentos, error } = await query.order('aula_numero', { ascending: true });

    console.log("📊 [DIAGNÓSTICO] Resposta do Supabase:", { dados: agendamentos, erro: error });

    if (error) {
        dispararAlerta({
            icon: 'error',
            title: 'Erro de Carregamento',
            text: 'Não foi possível buscar os agendamentos no Supabase.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
        return;
    }

    const qtdTotalElemento = document.getElementById('qtd-total');
    if (qtdTotalElemento) {
        qtdTotalElemento.innerText = agendamentos.length;
    }
    
    dadosAtuaisParaExportar = agendamentos;

    if (!agendamentos || agendamentos.length === 0) {
        if (avisoVazio) avisoVazio.classList.remove('hidden');
        return;
    } else {
        if (avisoVazio) avisoVazio.classList.add('hidden');
    }

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
                <button class="btn-revogar" onclick="revogarAgendamento('${item.id}', '${item.salas?.nome}', '${item.aula_numero}')">
                    Cancelar
                </button>
            </td>
        `;
        tabela.appendChild(tr);
    });
}

window.revogarAgendamento = async function(idAgendamento, nomeSala, numeroAula) {
    if (typeof Swal === 'undefined') {
        const c = confirm(`Deseja cancelar o agendamento de: ${nomeSala}?`);
        if(!c) return;
    } else {
        const confirmacao = await Swal.fire({
            title: 'Tem certeza?',
            text: `Deseja cancelar o agendamento de: ${nomeSala}?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: 'var(--cor-perigo)',
            cancelButtonColor: 'var(--texto-secundario)',
            confirmButtonText: 'Sim, cancelar!',
            cancelButtonText: 'Voltar'
        });
        if (!confirmacao.isConfirmed) return;
    }

    const { error } = await supabase
        .from('agendamentos')
        .delete()
        .eq('id', idAgendamento);

    if (error) {
        dispararAlerta({
            icon: 'error',
            title: 'Erro!',
            text: 'Não foi possível excluir o agendamento.',
            confirmButtonColor: 'var(--cor-primaria)'
        });
    } else {
        dispararAlerta({
            icon: 'success',
            title: 'Cancelado!',
            text: 'O agendamento foi removido.',
            timer: 1500,
            showConfirmButton: false
        });
        carregarRelatorioGeral();
    }
}

window.exportarParaPlanilha = async function() {
    if (!dadosAtuaisParaExportar || dadosAtuaisParaExportar.length === 0) {
        dispararAlerta({
            icon: 'warning',
            title: 'Tabela Vazia',
            text: 'Não há dados na tabela para enviar. Mude a data do filtro para carregar os agendamentos primeiro.',
            confirmButtonColor: 'var(--cor-primaria)'
        });
        return;
    }

    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: 'Exportando dados...',
            text: 'Enviando para o Google Planilhas. Por favor, aguarde.',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    }

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

        if (typeof Swal !== 'undefined') Swal.close();

        dispararAlerta({
            icon: 'success',
            title: 'Concluído!',
            text: 'Os dados foram enviados para a sua planilha com sucesso.',
            confirmButtonColor: 'var(--cor-sucesso)'
        });

    } catch (erro) {
        if (typeof Swal !== 'undefined') Swal.close();
        
        dispararAlerta({
            icon: 'error',
            title: 'Falha no envio',
            text: "Ocorreu um erro físico: " + erro.message,
            confirmButtonColor: 'var(--cor-perigo)'
        });
    }
}

supabase
    .channel('mudancas-agendamentos-coord')
    .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'agendamentos' }, 
        (payload) => {
            console.log('Mudança detectada em tempo real!', payload);
            carregarRelatorioGeral();
        }
    )
    .subscribe();

document.addEventListener("DOMContentLoaded", () => {
    carregarSalasNoFiltro();
    carregarDisciplinasNoPreCadastro(); 
    
    const fData = document.getElementById('filtroData') || document.getElementById('filtro-data');
    const fSala = document.getElementById('filtroSala') || document.getElementById('filtro-sala');
    
    if (fData) fData.addEventListener('change', () => carregarRelatorioGeral());
    if (fSala) fSala.addEventListener('change', () => carregarRelatorioGeral());
});
