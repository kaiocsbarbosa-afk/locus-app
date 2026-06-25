/* coordenacao.js — sem sessionStorage, token validado pelo servidor */
import { supabase, registrarServiceWorker, dispararAlerta } from './utils.js'
import { ativarNotificacoes, enviarNotificacao } from './push.js'

window.addEventListener('error', function(e) {
    console.error("Erro capturado:", e.message, e.lineno, e.error);
    if (typeof Swal !== 'undefined') {
        dispararAlerta({
            icon: 'error',
            title: 'Erro no sistema',
            text: 'Ocorreu um erro inesperado. Tente recarregar a página.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
    }
});

const URL_GOOGLE_SCRIPT = "https://script.google.com/macros/s/AKfycbw6fMtP880hmAdtRSj8tgBVCw-U9qGo-JnOqMD7DCb_I5q6Isooady17YNCmmUlKemhzQ/exec"

let dadosAtuaisParaExportar = [];
let _tokenSessaoCoord = null;
let _senhaEmMemoria = null; // necessária para passar à Edge Function resetar-acesso-professor

function tokenValido() {
    return _tokenSessaoCoord !== null;
}

// ============================================================
//  INICIALIZAÇÃO
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    registrarServiceWorker();

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

// ============================================================
//  AUTENTICAÇÃO
// ============================================================

window.entrarPainel = async function() {
    const senhaDigitada = document.getElementById('senha-coord').value;

    if (!senhaDigitada) {
        dispararAlerta({ icon: 'warning', title: 'Atenção', text: 'Por favor, digite a senha.', confirmButtonColor: 'var(--cor-primaria)' });
        return;
    }

    Swal.fire({ title: 'Autenticando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const { data, error } = await supabase.functions.invoke('verificar-senha-coord', {
            body: { senha: senhaDigitada }
        });

        Swal.close();

        if (error) {
            dispararAlerta({ icon: 'error', title: 'Erro de conexão', text: 'Não foi possível verificar as credenciais.', confirmButtonColor: 'var(--cor-perigo)' });
            return;
        }

        if (!data?.autorizado || !data?.token) {
            dispararAlerta({ icon: 'error', title: 'Acesso Negado', text: 'Senha incorreta.', confirmButtonColor: 'var(--cor-perigo)' });
            document.getElementById('senha-coord').value = '';
            return;
        }

        _tokenSessaoCoord = data.token;
        _senhaEmMemoria = senhaDigitada; // guarda para usar no reset
        document.getElementById('senha-coord').value = '';
        mostrarDashboard();

    } catch (err) {
        Swal.close();
        console.error("Erro inesperado:", err);
        dispararAlerta({ icon: 'error', title: 'Erro crítico', text: 'Falha na requisição. Tente novamente.', confirmButtonColor: 'var(--cor-perigo)' });
    }
}

window.sairPainel = function() {
    _tokenSessaoCoord = null;
    _senhaEmMemoria = null;
    window.location.reload();
}

function exigirToken() {
    if (!tokenValido()) {
        dispararAlerta({ icon: 'error', title: 'Sessão expirada', text: 'Faça login novamente.', confirmButtonColor: 'var(--cor-perigo)' });
        window.location.reload();
        return false;
    }
    return true;
}

// ============================================================
//  DASHBOARD
// ============================================================

function mostrarDashboard() {
    document.getElementById('secao-login-coord').style.display = 'none';
    document.getElementById('secao-dashboard').classList.add('visivel');

    const hoje = new Date();
    const inputData = document.getElementById('filtroData');
    if (inputData) inputData.value = hoje.toISOString().split('T')[0];

    carregarRelatorioGeral();
    atualizarBadgePendentes();
    verificarStatusNotificacoes(); // Mostra banner se permissão ainda não foi dada
}

// ============================================================
//  NOTIFICAÇÕES
// ============================================================

function verificarStatusNotificacoes() {
    const bannerPedido = document.getElementById('banner-notif');
    const bannerOk     = document.getElementById('banner-notif-ok');

    // Navegador sem suporte a Notification API — esconde tudo
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        if (bannerPedido) bannerPedido.classList.remove('visivel');
        if (bannerOk)     bannerOk.classList.remove('visivel');
        return;
    }

    const perm = Notification.permission;

    if (perm === 'granted') {
        // Permissão já concedida — mostra confirmação, esconde pedido
        if (bannerPedido) bannerPedido.classList.remove('visivel');
        if (bannerOk)     bannerOk.classList.add('visivel');
    } else if (perm === 'default') {
        // Ainda não decidido — mostra o banner de pedido
        if (bannerPedido) bannerPedido.classList.add('visivel');
        if (bannerOk)     bannerOk.classList.remove('visivel');
    } else {
        // 'denied' — esconde os dois, não insistimos
        if (bannerPedido) bannerPedido.classList.remove('visivel');
        if (bannerOk)     bannerOk.classList.remove('visivel');
    }
}

window.ativarNotifCoord = async function() {
    const bannerPedido = document.getElementById('banner-notif');

    if (!('Notification' in window)) {
        dispararAlerta({ icon: 'info', title: 'Sem suporte', text: 'Seu navegador não suporta notificações.', confirmButtonColor: 'var(--cor-primaria)' });
        return;
    }

    try {
        const sucesso = await ativarNotificacoes('coordenacao', null);

        if (sucesso) {
            if (bannerPedido) bannerPedido.classList.remove('visivel');
            const bannerOk = document.getElementById('banner-notif-ok');
            if (bannerOk) bannerOk.classList.add('visivel');
        } else if (Notification.permission === 'denied') {
            if (bannerPedido) bannerPedido.classList.remove('visivel');
            dispararAlerta({
                icon: 'info',
                title: 'Notificações bloqueadas',
                text: 'Para ativar, vá em Configurações do navegador → Notificações → permitir este site.',
                confirmButtonColor: 'var(--cor-primaria)'
            });
        }
    } catch (err) {
        console.error('Erro ao ativar notificações:', err);
    }
}

async function carregarSalasNoFiltro() {
    try {
        const { data: salas, error } = await supabase.from('salas').select('id, nome').order('nome', { ascending: true });
        if (error) throw error;
        const selectSala = document.getElementById('filtroSala');
        selectSala.innerHTML = '<option value="">Todas as salas</option>';
        salas.forEach(sala => {
            const option = document.createElement('option');
            option.value = sala.id;
            option.textContent = sala.nome;
            selectSala.appendChild(option);
        });
    } catch (erro) { console.error("Erro ao carregar salas:", erro); }
}

async function carregarProfessoresNoFiltro() {
    try {
        const { data: professores, error } = await supabase.from('professores').select('id, nome').order('nome', { ascending: true });
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
    } catch (erro) { console.error("Erro ao carregar professores:", erro); }
}

async function carregarDisciplinasNoPreCadastro() {
    try {
        const { data: disciplinas, error } = await supabase.from('disciplinas').select('id, nome').order('nome', { ascending: true });
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
    } catch (erro) { console.error("Erro ao carregar disciplinas:", erro); }
}

// ============================================================
//  SOLICITAÇÕES DE ACESSO
// ============================================================

async function atualizarBadgePendentes() {
    const badge = document.getElementById('badge-pendentes');
    if (!badge) return;
    try {
        const { count } = await supabase
            .from('solicitacoes_acesso')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pendente');
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) { /* silencioso */ }
}

async function carregarSolicitacoes() {
    const lista = document.getElementById('lista-solicitacoes');
    const badge = document.getElementById('badge-pendentes');
    if (!lista) return;

    lista.innerHTML = '<div class="gerenciar-vazio">Carregando...</div>';

    try {
        const { data, error } = await supabase
            .from('solicitacoes_acesso')
            .select('*')
            .eq('status', 'pendente')
            .order('criado_em', { ascending: true });

        if (error) throw error;

        // Badge de contagem
        if (badge) {
            if (data?.length) {
                badge.textContent = data.length;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }

        if (!data || data.length === 0) {
            lista.innerHTML = `<div class="solicitacoes-vazio">
                <span class="solicitacoes-vazio-icon">✅</span>
                Nenhuma solicitação pendente
            </div>`;
            return;
        }

        lista.innerHTML = data.map(s => {
            const data_fmt = new Date(s.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
            return `
            <div class="solicitacao-card" id="sol-${s.id}">
                <div class="solicitacao-info">
                    <div class="solicitacao-nome">${s.nome}</div>
                    <div class="solicitacao-meta">${s.disciplina} · ${data_fmt}</div>
                </div>
                <div class="solicitacao-acoes">
                    <button class="btn-aprovar" onclick="aprovarSolicitacao('${s.id}', '${s.nome.replace(/'/g,"\'")}', '${s.disciplina}', '${s.pin}')">✓ Aprovar</button>
                    <button class="btn-rejeitar" onclick="rejeitarSolicitacao('${s.id}', '${s.nome.replace(/'/g,"\'")}')">✕ Rejeitar</button>
                </div>
            </div>`;
        }).join('');

    } catch (err) {
        console.error('Erro ao carregar solicitações:', err);
        lista.innerHTML = '<div class="gerenciar-vazio">Erro ao carregar solicitações.</div>';
    }
}

window.aprovarSolicitacao = async function(id, nome, disciplina, pin) {
    if (!exigirToken()) return;

    const confirmar = await Swal.fire({
        icon: 'question',
        title: `Aprovar ${nome}?`,
        text: `Isso criará o acesso de ${nome} (${disciplina}) com o PIN escolhido por ele.`,
        showCancelButton: true,
        confirmButtonText: 'Sim, aprovar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-sucesso)',
    });

    if (!confirmar.isConfirmed) return;

    try {
        // 1. Cria professor na tabela
        const { data: prof, error: errProf } = await supabase
            .from('professores')
            .insert([{ nome, disciplina, auth_user_id: null }])
            .select('id')
            .single();

        if (errProf) throw errProf;

        // 2. Ativa via Edge Function (cria auth user + faz hash do PIN)
        const { data: resultado, error: errFn } = await supabase.functions.invoke('ativar-professor', {
            body: { professor_id: prof.id, pin }
        });

        if (errFn || !resultado?.sucesso) {
            // Reverte inserção em caso de erro na Edge Function
            await supabase.from('professores').delete().eq('id', prof.id);
            throw new Error(resultado?.erro || 'Falha ao ativar acesso');
        }

        // 3. Marca solicitação como aprovada
        await supabase.from('solicitacoes_acesso').update({ status: 'aprovado', atualizado_em: new Date().toISOString() }).eq('id', id);

        // Remove o card da lista
        document.getElementById(`sol-${id}`)?.remove();

        // Atualiza badge e estado vazio
        carregarSolicitacoes();
        carregarListaProfessores();
        carregarProfessoresNoFiltro();

        // Notifica o professor (se já tiver inscrição push registrada)
        enviarNotificacao(
            '✅ Acesso aprovado!',
            `Olá, ${nome}! Seu acesso ao Locus foi aprovado. Já pode fazer login com seu PIN.`,
            'professor',
            prof.id
        );

        dispararAlerta({ icon: 'success', title: 'Aprovado!', text: `${nome} já pode fazer login no Locus.`, confirmButtonColor: 'var(--cor-sucesso)', timer: 2500, showConfirmButton: false });

    } catch (err) {
        console.error('Erro ao aprovar:', err);
        dispararAlerta({ icon: 'error', title: 'Erro ao aprovar', text: err.message || 'Tente novamente.', confirmButtonColor: 'var(--cor-perigo)' });
    }
}

window.rejeitarSolicitacao = async function(id, nome) {
    if (!exigirToken()) return;

    const confirmar = await Swal.fire({
        icon: 'warning',
        title: `Rejeitar ${nome}?`,
        text: 'O professor não terá acesso ao sistema. Essa ação não pode ser desfeita.',
        showCancelButton: true,
        confirmButtonText: 'Sim, rejeitar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-perigo)',
    });

    if (!confirmar.isConfirmed) return;

    try {
        await supabase.from('solicitacoes_acesso').update({ status: 'rejeitado', atualizado_em: new Date().toISOString() }).eq('id', id);
        document.getElementById(`sol-${id}`)?.remove();
        carregarSolicitacoes();

        // Tenta notificar o professor (pode não ter inscrição push ainda)
        enviarNotificacao(
            '❌ Solicitação não aprovada',
            `${nome}, sua solicitação de acesso ao Locus não foi aprovada. Entre em contato com a coordenação.`,
            'coordenacao' // fallback: envia para coordenação (professor ainda não tem conta)
        );

        dispararAlerta({ icon: 'info', title: 'Solicitação rejeitada', text: `${nome} não terá acesso ao sistema.`, confirmButtonColor: 'var(--cor-primaria)', timer: 2200, showConfirmButton: false });
    } catch (err) {
        console.error('Erro ao rejeitar:', err);
        dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível rejeitar a solicitação.', confirmButtonColor: 'var(--cor-perigo)' });
    }
}

// ============================================================
//  RELATÓRIO
// ============================================================

window.carregarRelatorioGeral = async function() {
    if (!exigirToken()) return;

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

    if (!dataFiltro && !salaFiltro && !professorFiltro) {
        tabela.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--texto-secundario)">Selecione uma data, sala ou professor para ver os agendamentos.</td></tr>`;
        return;
    }

    tabela.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--texto-secundario)">Carregando...</td></tr>`;

    let query = supabase.from('agendamentos').select('id, data, aula_numero, professor_id, salas(nome), professores(nome), turmas(nome)');
    if (dataFiltro) query = query.eq('data', dataFiltro);
    if (salaFiltro) query = query.eq('sala_id', salaFiltro);
    if (professorFiltro) query = query.eq('professor_id', professorFiltro);

    const { data: agendamentos, error } = await query.order('data', { ascending: true }).order('aula_numero', { ascending: true });

    if (error) {
        dispararAlerta({ icon: 'error', title: 'Erro de carregamento', text: 'Não foi possível buscar os agendamentos.', confirmButtonColor: 'var(--cor-perigo)' });
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
    if (!exigirToken()) return;

    const confirmacao = await Swal.fire({
        title: 'Tem certeza?', text: `Cancelar reserva de ${nomeSala} — Aula ${numeroAula}?`, icon: 'warning',
        showCancelButton: true, confirmButtonColor: 'var(--cor-perigo)', cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: 'Sim, cancelar!', cancelButtonText: 'Voltar'
    });
    if (!confirmacao.isConfirmed) return;

    const { error } = await supabase.from('agendamentos').delete().eq('id', idAgendamento);

    if (error) {
        dispararAlerta({ icon: 'error', title: 'Erro!', text: 'Não foi possível excluir o agendamento.', confirmButtonColor: 'var(--cor-primaria)' });
    } else {
        dispararAlerta({ icon: 'success', title: 'Cancelado!', text: 'Reserva removida.', timer: 1500, showConfirmButton: false });
        carregarRelatorioGeral();
        if (professorId && professorId !== 'undefined' && professorId !== 'null') {
            enviarNotificacao('Reserva cancelada pela coordenação', `Sua reserva de ${nomeSala} (Aula ${numeroAula}) em ${dataBr} foi cancelada pela coordenação.`, 'professor', professorId);
        }
    }
}

window.exportarParaPlanilha = async function() {
    if (!exigirToken()) return;

    if (!dadosAtuaisParaExportar || dadosAtuaisParaExportar.length === 0) {
        dispararAlerta({ icon: 'warning', title: 'Tabela vazia', text: 'Filtre por uma data com agendamentos antes de exportar.', confirmButtonColor: 'var(--cor-primaria)' });
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
        await fetch(URL_GOOGLE_SCRIPT, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(dadosFormatados) });
        Swal.close();
        dispararAlerta({ icon: 'success', title: 'Concluído!', text: 'Dados enviados para a planilha.', confirmButtonColor: 'var(--cor-sucesso)' });
    } catch (erro) {
        Swal.close();
        dispararAlerta({ icon: 'error', title: 'Falha no envio', text: 'Não foi possível exportar. Tente novamente.', confirmButtonColor: 'var(--cor-perigo)' });
    }
}

// ============================================================
//  GERENCIAR SALAS E TURMAS
// ============================================================

let gerenciamentoCarregado = false;

window.alternarGerenciamento = function(event) {
    const conteudo = document.getElementById('conteudo-gerenciar');
    const toggle = event.currentTarget;
    conteudo.classList.toggle('hidden');
    toggle.classList.toggle('aberto');
    if (!conteudo.classList.contains('hidden') && !gerenciamentoCarregado) {
        gerenciamentoCarregado = true;
        carregarListaSalas();
        carregarListaTurmas();
    }
}

async function carregarListaSalas() {
    const container = document.getElementById('lista-salas');
    container.innerHTML = '<div class="gerenciar-vazio">Carregando...</div>';
    const { data: salas, error } = await supabase.from('salas').select('id, nome').order('nome', { ascending: true });
    if (error) { container.innerHTML = '<div class="gerenciar-vazio">Erro ao carregar salas.</div>'; return; }
    if (!salas || salas.length === 0) { container.innerHTML = '<div class="gerenciar-vazio">Nenhuma sala cadastrada.</div>'; return; }
    container.innerHTML = '';
    salas.forEach(sala => {
        const div = document.createElement('div');
        div.classList.add('gerenciar-item');
        div.innerHTML = `<span>${sala.nome}</span><button onclick="excluirSala('${sala.id}', '${sala.nome.replace(/'/g, "\\'")}')">Excluir</button>`;
        container.appendChild(div);
    });
}

async function carregarListaTurmas() {
    const container = document.getElementById('lista-turmas');
    container.innerHTML = '<div class="gerenciar-vazio">Carregando...</div>';
    const { data: turmas, error } = await supabase.from('turmas').select('id, nome').order('nome', { ascending: true });
    if (error) { container.innerHTML = '<div class="gerenciar-vazio">Erro ao carregar turmas.</div>'; return; }
    if (!turmas || turmas.length === 0) { container.innerHTML = '<div class="gerenciar-vazio">Nenhuma turma cadastrada.</div>'; return; }
    container.innerHTML = '';
    turmas.forEach(turma => {
        const div = document.createElement('div');
        div.classList.add('gerenciar-item');
        div.innerHTML = `<span>${turma.nome}</span><button onclick="excluirTurma('${turma.id}', '${turma.nome.replace(/'/g, "\\'")}')">Excluir</button>`;
        container.appendChild(div);
    });
}

window.adicionarSala = async function() {
    if (!exigirToken()) return;
    const input = document.getElementById('nova-sala-nome');
    const nome = input.value.trim();
    if (!nome) { dispararAlerta({ icon: 'warning', title: 'Atenção', text: 'Digite o nome da sala.', confirmButtonColor: 'var(--cor-primaria)' }); return; }
    const { error } = await supabase.from('salas').insert([{ nome }]);
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível adicionar a sala.', confirmButtonColor: 'var(--cor-perigo)' }); return; }
    input.value = '';
    carregarListaSalas();
    carregarSalasNoFiltro();
}

window.adicionarTurma = async function() {
    if (!exigirToken()) return;
    const input = document.getElementById('nova-turma-nome');
    const nome = input.value.trim();
    if (!nome) { dispararAlerta({ icon: 'warning', title: 'Atenção', text: 'Digite o nome da turma.', confirmButtonColor: 'var(--cor-primaria)' }); return; }
    const { error } = await supabase.from('turmas').insert([{ nome }]);
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível adicionar a turma.', confirmButtonColor: 'var(--cor-perigo)' }); return; }
    input.value = '';
    carregarListaTurmas();
}

window.excluirSala = async function(id, nome) {
    if (!exigirToken()) return;
    const { data: vinculos } = await supabase.from('agendamentos').select('id').eq('sala_id', id).limit(1);
    if (vinculos && vinculos.length > 0) {
        dispararAlerta({ icon: 'warning', title: 'Sala em uso', text: `A sala "${nome}" possui agendamentos vinculados. Cancele-os primeiro.`, confirmButtonColor: 'var(--cor-primaria)' });
        return;
    }
    const confirmacao = await Swal.fire({ title: 'Excluir sala?', text: `Tem certeza que deseja excluir "${nome}"?`, icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--cor-perigo)', cancelButtonColor: 'var(--texto-secundario)', confirmButtonText: 'Sim, excluir!', cancelButtonText: 'Cancelar' });
    if (!confirmacao.isConfirmed) return;
    const { error } = await supabase.from('salas').delete().eq('id', id);
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível excluir a sala.', confirmButtonColor: 'var(--cor-perigo)' }); return; }
    dispararAlerta({ icon: 'success', title: 'Excluída!', timer: 1200, showConfirmButton: false });
    carregarListaSalas();
    carregarSalasNoFiltro();
}

window.excluirTurma = async function(id, nome) {
    if (!exigirToken()) return;
    const { data: vinculos } = await supabase.from('agendamentos').select('id').eq('turma_id', id).limit(1);
    if (vinculos && vinculos.length > 0) {
        dispararAlerta({ icon: 'warning', title: 'Turma em uso', text: `A turma "${nome}" possui agendamentos vinculados. Cancele-os primeiro.`, confirmButtonColor: 'var(--cor-primaria)' });
        return;
    }
    const confirmacao = await Swal.fire({ title: 'Excluir turma?', text: `Tem certeza que deseja excluir "${nome}"?`, icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--cor-perigo)', cancelButtonColor: 'var(--texto-secundario)', confirmButtonText: 'Sim, excluir!', cancelButtonText: 'Cancelar' });
    if (!confirmacao.isConfirmed) return;
    const { error } = await supabase.from('turmas').delete().eq('id', id);
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível excluir a turma.', confirmButtonColor: 'var(--cor-perigo)' }); return; }
    dispararAlerta({ icon: 'success', title: 'Excluída!', timer: 1200, showConfirmButton: false });
    carregarListaTurmas();
}

// ============================================================
//  GERENCIAR PROFESSORES
// ============================================================

let gerenciamentoProfessoresCarregado = false;
let disciplinasCache = [];

window.alternarGerenciamentoProfessores = function(event) {
    const conteudo = document.getElementById('conteudo-gerenciar-professores');
    const toggle = event.currentTarget;
    conteudo.classList.toggle('hidden');
    toggle.classList.toggle('aberto');
    if (!conteudo.classList.contains('hidden')) {
        carregarSolicitacoes();
        if (!gerenciamentoProfessoresCarregado) {
            gerenciamentoProfessoresCarregado = true;
            carregarListaProfessores();
        }
    }
}

async function obterDisciplinasCache() {
    if (disciplinasCache.length > 0) return disciplinasCache;
    const { data, error } = await supabase.from('disciplinas').select('id, nome').order('nome', { ascending: true });
    if (!error && data) disciplinasCache = data;
    return disciplinasCache;
}

async function carregarListaProfessores() {
    const container = document.getElementById('lista-professores');
    container.innerHTML = '<div class="gerenciar-vazio">Carregando...</div>';

    const [{ data: professores, error }, disciplinas] = await Promise.all([
        supabase.from('professores').select('id, nome, disciplina, auth_user_id').order('nome', { ascending: true }),
        obterDisciplinasCache()
    ]);

    if (error) { container.innerHTML = '<div class="gerenciar-vazio">Erro ao carregar professores.</div>'; return; }
    if (!professores || professores.length === 0) { container.innerHTML = '<div class="gerenciar-vazio">Nenhum professor cadastrado.</div>'; return; }

    container.innerHTML = '';
    professores.forEach(prof => {
        const temAcesso = prof.auth_user_id !== null && prof.auth_user_id !== '';
        const opcoesDisciplina = disciplinas.map(d =>
            `<option value="${d.nome}" ${d.nome === prof.disciplina ? 'selected' : ''}>${d.nome}</option>`
        ).join('');

        const div = document.createElement('div');
        div.classList.add('professor-card');
        div.innerHTML = `
            <div class="professor-card-topo">
                <div class="professor-card-info">
                    <div class="professor-nome">${prof.nome}</div>
                    <div class="professor-disciplina">${prof.disciplina || 'Sem disciplina'}</div>
                </div>
                <span class="status-pin ${temAcesso ? 'ativo' : 'pendente'}">
                    ${temAcesso ? '✓ Acesso ativo' : '⏳ Aguardando ativação'}
                </span>
            </div>
            <div class="professor-card-edicao">
                <input type="text" value="${prof.nome.replace(/"/g, '&quot;')}" id="edit-nome-${prof.id}" placeholder="Nome completo">
                <select id="edit-disciplina-${prof.id}">
                    <option value="">Selecione a disciplina...</option>
                    ${opcoesDisciplina}
                </select>
            </div>
            <div class="professor-card-acoes">
                <button class="btn-salvar-professor" onclick="salvarEdicaoProfessor('${prof.id}')">💾 Salvar</button>
                ${temAcesso ? `<button class="btn-resetar-pin" onclick="resetarAcessoProfessor('${prof.id}', '${prof.nome.replace(/'/g, "\\'")}')">🔑 Resetar acesso</button>` : ''}
                <button class="btn-excluir-professor" onclick="excluirProfessor('${prof.id}', '${prof.nome.replace(/'/g, "\\'")}')">🗑️ Excluir</button>
            </div>
        `;
        container.appendChild(div);
    });
}

window.salvarEdicaoProfessor = async function(id) {
    if (!exigirToken()) return;
    const nome = document.getElementById(`edit-nome-${id}`).value.trim();
    const disciplina = document.getElementById(`edit-disciplina-${id}`).value;
    if (!nome) { dispararAlerta({ icon: 'warning', title: 'Atenção', text: 'O nome não pode ficar vazio.', confirmButtonColor: 'var(--cor-primaria)' }); return; }
    const { error } = await supabase.from('professores').update({ nome, disciplina }).eq('id', id);
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível salvar as alterações.', confirmButtonColor: 'var(--cor-perigo)' }); return; }
    dispararAlerta({ icon: 'success', title: 'Salvo!', timer: 1200, showConfirmButton: false });
    carregarListaProfessores();
    carregarProfessoresNoFiltro();
}

// MUDANÇA PRINCIPAL: agora chama a Edge Function que deleta o usuário do Auth
// em vez de apenas limpar a coluna pin no banco
window.resetarAcessoProfessor = async function(id, nome) {
    if (!exigirToken()) return;

    const confirmacao = await Swal.fire({
        title: 'Resetar acesso?',
        text: `"${nome}" será desconectado imediatamente e precisará ativar um novo PIN para entrar.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-aviso)',
        cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: 'Sim, resetar',
        cancelButtonText: 'Cancelar'
    });
    if (!confirmacao.isConfirmed) return;

    if (!_senhaEmMemoria) {
        dispararAlerta({ icon: 'error', title: 'Sessão expirada', text: 'Faça login novamente para executar esta ação.', confirmButtonColor: 'var(--cor-perigo)' });
        sairPainel();
        return;
    }

    Swal.fire({ title: 'Resetando acesso...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        // Chama Edge Function que:
        // 1. Deleta o usuário do Supabase Auth (invalida o JWT imediatamente)
        // 2. Limpa o auth_user_id na tabela professores
        // 3. O Realtime no professor.js detecta e força o logout na tela dele
        const { data, error } = await supabase.functions.invoke('resetar-acesso-professor', {
            body: {
                professor_id: id,
                senha_coord: _senhaEmMemoria
            }
        });

        Swal.close();

        if (error || !data?.sucesso) {
            dispararAlerta({
                icon: 'error',
                title: 'Erro',
                text: data?.erro || 'Não foi possível resetar o acesso.',
                confirmButtonColor: 'var(--cor-perigo)'
            });
            return;
        }

        dispararAlerta({
            icon: 'success',
            title: 'Acesso resetado!',
            text: `${nome} foi desconectado e precisará ativar um novo PIN.`,
            timer: 2500,
            showConfirmButton: false
        });
        carregarListaProfessores();

    } catch (err) {
        Swal.close();
        console.error('Erro ao resetar acesso:', err);
        dispararAlerta({ icon: 'error', title: 'Erro', text: 'Falha na requisição.', confirmButtonColor: 'var(--cor-perigo)' });
    }
}

window.excluirProfessor = async function(id, nome) {
    if (!exigirToken()) return;
    const { data: vinculos } = await supabase.from('agendamentos').select('id').eq('professor_id', id).limit(1);
    if (vinculos && vinculos.length > 0) {
        dispararAlerta({ icon: 'warning', title: 'Professor com reservas ativas', text: `"${nome}" possui agendamentos vinculados. Cancele-os primeiro.`, confirmButtonColor: 'var(--cor-primaria)' });
        return;
    }
    const confirmacao = await Swal.fire({ title: 'Excluir professor?', text: `Tem certeza que deseja excluir "${nome}"? Esta ação não pode ser desfeita.`, icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--cor-perigo)', cancelButtonColor: 'var(--texto-secundario)', confirmButtonText: 'Sim, excluir!', cancelButtonText: 'Cancelar' });
    if (!confirmacao.isConfirmed) return;

    // Reseta o Auth antes de deletar do banco
    if (_senhaEmMemoria) {
        await supabase.functions.invoke('resetar-acesso-professor', {
            body: { professor_id: id, senha_coord: _senhaEmMemoria }
        });
    }

    const { error } = await supabase.from('professores').delete().eq('id', id);
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível excluir o professor.', confirmButtonColor: 'var(--cor-perigo)' }); return; }
    dispararAlerta({ icon: 'success', title: 'Excluído!', timer: 1200, showConfirmButton: false });
    carregarListaProfessores();
    carregarProfessoresNoFiltro();
}

// ============================================================
//  REALTIME
// ============================================================

supabase
    .channel('mudancas-agendamentos-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, () => {
        if (tokenValido()) carregarRelatorioGeral();
    })
    .subscribe();

supabase
    .channel('mudancas-professores-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'professores' }, () => {
        if (tokenValido()) {
            const conteudo = document.getElementById('conteudo-gerenciar-professores');
            if (conteudo && !conteudo.classList.contains('hidden')) {
                carregarSolicitacoes();
                carregarListaProfessores();
            }
            carregarProfessoresNoFiltro();
        }
    })
    .subscribe();

// Realtime para solicitações de acesso — atualiza badge e lista em tempo real
supabase
    .channel('mudancas-solicitacoes-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitacoes_acesso' }, () => {
        const conteudo = document.getElementById('conteudo-gerenciar-professores');
        if (conteudo && !conteudo.classList.contains('hidden')) {
            carregarSolicitacoes();
        }
        // Atualiza badge mesmo com a seção fechada
        atualizarBadgePendentes();
    })
    .subscribe();
