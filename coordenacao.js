/* coordenacao.js — autenticação via Supabase Auth */
import { supabase, registrarServiceWorker, dispararAlerta, detectarTurnoTurma, obterHorarioAula, formatarData } from './utils.js'
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

// E-mail interno do usuário coordenador no Supabase Auth.
// Deve coincidir com o COORD_EMAIL nas Edge Functions.
const COORD_EMAIL = 'coordenacao@locus.interno'

let dadosAtuaisParaExportar = []

// ============================================================
//  AUTENTICAÇÃO
// ============================================================

/** Retorna true se a sessão ativa pertence ao coordenador. */
async function estaAutenticado() {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.email === COORD_EMAIL
}

/**
 * Exige sessão de coordenador ativa.
 * Se não existir, exibe alerta e recarrega a página.
 * Use com: if (!await exigirAuth()) return
 */
async function exigirAuth() {
    if (!await estaAutenticado()) {
        dispararAlerta({
            icon: 'error',
            title: 'Sessão expirada',
            text: 'Faça login novamente.',
            confirmButtonColor: 'var(--cor-perigo)'
        })
        window.location.reload()
        return false
    }
    return true
}

// ============================================================
//  INICIALIZAÇÃO
// ============================================================

function bloquearAcessoPorSessaoProfessor(nomeProf) {
    const cardLogin = document.querySelector('.login-card');
    if (cardLogin) {
        cardLogin.innerHTML = `
            <div class="login-card-titulo" style="color:#f59e0b;">⚠️ Sessão de Professor Ativa</div>
            <div class="login-card-sub" style="margin-top:10px; margin-bottom:20px; font-size:0.9rem;">
                Você está conectado como <strong>${nomeProf}</strong>.<br>
                Para acessar o Painel da Coordenação, você deve sair da sua conta de professor primeiro.
            </div>
            <button type="button" id="btn-ir-prof" class="btn-login-coord" style="margin-bottom:10px; background:#4f46e5;">
                Ir para Área do Professor
            </button>
            <button type="button" id="btn-sair-prof" class="btn-login-coord" style="background:#dc2626;">
                Sair da Conta de Professor
            </button>
            <div class="login-footer-link" style="margin-top:16px;">
                <a href="index.html">← Voltar ao Início</a>
            </div>
        `;

        document.getElementById('btn-ir-prof')?.addEventListener('click', () => {
            window.location.href = 'professor.html';
        });
        document.getElementById('btn-sair-prof')?.addEventListener('click', async () => {
            await supabase.auth.signOut();
            window.location.reload();
        });
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    registrarServiceWorker()

    // Verifica se já existe uma sessão válida do coordenador.
    const { data: { session } } = await supabase.auth.getSession()

    if (session) {
        if (session.user?.email === COORD_EMAIL) {
            // Coordenador já autenticado — vai direto ao dashboard
            mostrarDashboard()
            return
        } else {
            // Sessão de professor ativa detectada: bloqueia login na coordenação
            const { data: prof } = await supabase
                .from('professores')
                .select('nome')
                .eq('auth_user_id', session.user.id)
                .single()

            const nomeProf = prof?.nome || 'Professor'
            bloquearAcessoPorSessaoProfessor(nomeProf)
            return
        }
    }

    // Listener do Enter no campo de senha
    const inputSenha = document.getElementById("senha-coord")
    if (inputSenha) {
        inputSenha.addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                inputSenha.blur()
                window.entrarPainel()
            }
        })
    }
})

window.entrarPainel = async function() {
    const { data: { session } } = await supabase.auth.getSession()
    if (session && session.user?.email !== COORD_EMAIL) {
        dispararAlerta({
            icon: 'warning',
            title: 'Sessão de Professor Ativa',
            text: 'Você precisa sair da conta de Professor antes de entrar no Painel da Coordenação.',
            confirmButtonColor: 'var(--cor-primaria)'
        })
        return
    }

    const senhaDigitada = document.getElementById('senha-coord')?.value

    if (!senhaDigitada) {
        dispararAlerta({ icon: 'warning', title: 'Atenção', text: 'Por favor, digite a senha.', confirmButtonColor: 'var(--cor-primaria)' })
        return
    }

    Swal.fire({ title: 'Autenticando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() })

    try {
        let autenticadoSucesso = false;

        // 1. Tenta autenticação via Edge Function verificar-senha-coord
        try {
            const { data, error } = await supabase.functions.invoke('verificar-senha-coord', {
                body: { senha: senhaDigitada }
            });

            if (!error && data?.autorizado && data?.token) {
                await supabase.auth.setSession({
                    access_token: data.token,
                    refresh_token: data.refresh_token
                });
                autenticadoSucesso = true;
            }
        } catch (fnErr) {
            console.warn('[Coordenação] Falha na Edge Function, tentando autenticação direta:', fnErr);
        }

        // 2. Fallback: se a Edge Function falhar ou retornar erro interno, tenta autenticar diretamente via Supabase Auth
        if (!autenticadoSucesso) {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: COORD_EMAIL,
                password: senhaDigitada
            });

            if (!authError && authData?.session) {
                autenticadoSucesso = true;
            }
        }

        Swal.close();
        document.getElementById('senha-coord').value = '';

        if (!autenticadoSucesso) {
            dispararAlerta({ icon: 'error', title: 'Acesso Negado', text: 'Senha incorreta ou credenciais inválidas.', confirmButtonColor: 'var(--cor-perigo)' });
            return;
        }

        mostrarDashboard();

    } catch (err) {
        Swal.close()
        console.error("Erro inesperado:", err)
        dispararAlerta({ icon: 'error', title: 'Erro crítico', text: 'Falha na requisição. Tente novamente.', confirmButtonColor: 'var(--cor-perigo)' })
    }
}

window.sairPainel = async function() {
    await supabase.auth.signOut()
    window.location.reload()
}

// ============================================================
//  DASHBOARD
// ============================================================

function mostrarDashboard() {
    document.getElementById('secao-login-coord').style.display = 'none'
    document.getElementById('secao-dashboard').classList.add('visivel')

    const hoje = new Date()
    const inputData = document.getElementById('filtroData')
    if (inputData) inputData.value = formatarData(hoje)

    // Carrega dados dos filtros (requerem sessão ativa para professores completos)
    carregarSalasNoFiltro()
    carregarProfessoresNoFiltro()
    carregarDisciplinasNoPreCadastro()

    // Listeners do relatório — registrados aqui para não disparar antes do login
    const fData      = document.getElementById('filtroData')
    const fSala      = document.getElementById('filtroSala')
    const fProfessor = document.getElementById('filtroProfessor')
    const fTurno     = document.getElementById('filtroTurno')
    if (fData)      fData.addEventListener('change', () => carregarRelatorioGeral())
    if (fSala)      fSala.addEventListener('change', () => carregarRelatorioGeral())
    if (fProfessor) fProfessor.addEventListener('change', () => carregarRelatorioGeral())
    if (fTurno)     fTurno.addEventListener('change', () => carregarRelatorioGeral())

    carregarRelatorioGeral()
    atualizarBadgePendentes()
    verificarStatusNotificacoes()

    // Pré-carrega métricas e listas para navegação imediata entre as abas
    carregarListaProfessores()
    carregarListaTurmas()
    carregarListaSalas()
}

// ============================================================
//  NOTIFICAÇÕES
// ============================================================

function verificarStatusNotificacoes() {
    const bannerPedido = document.getElementById('banner-notif')
    const bannerOk     = document.getElementById('banner-notif-ok')

    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        if (bannerPedido) bannerPedido.classList.remove('visivel')
        if (bannerOk)     bannerOk.classList.remove('visivel')
        return
    }

    const perm = Notification.permission
    if (perm === 'granted') {
        if (bannerPedido) bannerPedido.classList.remove('visivel')
        if (bannerOk)     bannerOk.classList.add('visivel')
    } else if (perm === 'default') {
        if (bannerPedido) bannerPedido.classList.add('visivel')
        if (bannerOk)     bannerOk.classList.remove('visivel')
    } else {
        if (bannerPedido) bannerPedido.classList.remove('visivel')
        if (bannerOk)     bannerOk.classList.remove('visivel')
    }
}

window.ativarNotifCoord = async function() {
    const bannerPedido = document.getElementById('banner-notif')

    if (!('Notification' in window)) {
        dispararAlerta({ icon: 'info', title: 'Sem suporte', text: 'Seu navegador não suporta notificações.', confirmButtonColor: 'var(--cor-primaria)' })
        return
    }

    try {
        const sucesso = await ativarNotificacoes('coordenacao', null)
        if (sucesso) {
            if (bannerPedido) bannerPedido.classList.remove('visivel')
            const bannerOk = document.getElementById('banner-notif-ok')
            if (bannerOk) bannerOk.classList.add('visivel')
        } else if (Notification.permission === 'denied') {
            if (bannerPedido) bannerPedido.classList.remove('visivel')
            dispararAlerta({ icon: 'info', title: 'Notificações bloqueadas', text: 'Para ativar, vá em Configurações do navegador → Notificações → permitir este site.', confirmButtonColor: 'var(--cor-primaria)' })
        }
    } catch (err) {
        console.error('Erro ao ativar notificações:', err)
    }
}

async function carregarSalasNoFiltro() {
    try {
        const { data: salas, error } = await supabase.from('salas').select('id, nome').order('nome', { ascending: true })
        if (error) throw error
        const selectSala = document.getElementById('filtroSala')
        selectSala.innerHTML = '<option value="">Todas as salas</option>'
        salas.forEach(sala => {
            const option = document.createElement('option')
            option.value = sala.id
            option.textContent = sala.nome
            selectSala.appendChild(option)
        })
    } catch (erro) { console.error("Erro ao carregar salas:", erro) }
}

async function carregarProfessoresNoFiltro() {
    try {
        const { data: professores, error } = await supabase.from('professores').select('id, nome').order('nome', { ascending: true })
        if (error) throw error
        const selectProfessor = document.getElementById('filtroProfessor')
        if (!selectProfessor) return
        selectProfessor.innerHTML = '<option value="">Todos os professores</option>'
        professores.forEach(prof => {
            const option = document.createElement('option')
            option.value = prof.id
            option.textContent = prof.nome
            selectProfessor.appendChild(option)
        })
    } catch (erro) { console.error("Erro ao carregar professores:", erro) }
}

async function carregarDisciplinasNoPreCadastro() {
    try {
        const { data: disciplinas, error } = await supabase.from('disciplinas').select('id, nome').order('nome', { ascending: true })
        if (error) throw error
        const selectDisciplina = document.getElementById('coord-disciplina-professor')
        if (!selectDisciplina) return
        selectDisciplina.innerHTML = '<option value="">Selecione a disciplina...</option>'
        disciplinas.forEach(disc => {
            const option = document.createElement('option')
            option.value = disc.nome
            option.textContent = disc.nome
            selectDisciplina.appendChild(option)
        })
    } catch (erro) { console.error("Erro ao carregar disciplinas:", erro) }
}

// ============================================================
//  SOLICITAÇÕES DE ACESSO
// ============================================================

async function atualizarBadgePendentes() {
    const badge = document.getElementById('badge-pendentes')
    const badgeNav = document.getElementById('badge-nav-professores')
    const qtdSolicitacoes = document.getElementById('qtd-solicitacoes-total')
    try {
        const { count } = await supabase
            .from('solicitacoes_acesso')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pendente')
        const total = count || 0
        if (total > 0) {
            if (badge) { badge.textContent = total; badge.style.display = 'inline-flex'; }
            if (badgeNav) { badgeNav.textContent = total; badgeNav.style.display = 'inline-flex'; }
            if (qtdSolicitacoes) qtdSolicitacoes.textContent = total
        } else {
            if (badge) badge.style.display = 'none'
            if (badgeNav) badgeNav.style.display = 'none'
            if (qtdSolicitacoes) qtdSolicitacoes.textContent = '0'
        }
    } catch (e) { /* silencioso */ }
}

async function carregarSolicitacoes() {
    const lista = document.getElementById('lista-solicitacoes')
    const badge = document.getElementById('badge-pendentes')
    const badgeNav = document.getElementById('badge-nav-professores')
    const qtdSolicitacoes = document.getElementById('qtd-solicitacoes-total')
    if (!lista) return

    lista.innerHTML = '<div class="gerenciar-vazio">Carregando...</div>'

    try {
        const { data, error } = await supabase
            .from('solicitacoes_acesso')
            .select('*')
            .eq('status', 'pendente')
            .order('criado_em', { ascending: true })

        if (error) throw error

        const total = data?.length || 0
        if (badge) {
            if (total > 0) {
                badge.textContent = total
                badge.style.display = 'inline-flex'
            } else {
                badge.style.display = 'none'
            }
        }
        if (badgeNav) {
            badgeNav.textContent = total
            badgeNav.style.display = total > 0 ? 'inline-flex' : 'none'
        }
        if (qtdSolicitacoes) {
            qtdSolicitacoes.textContent = total
        }

        const kpiSol = document.getElementById('kpi-prof-solicitacoes')
        const kpiBadge = document.getElementById('kpi-badge-alerta')
        if (kpiSol) kpiSol.textContent = total
        if (kpiBadge) kpiBadge.style.display = total > 0 ? 'inline-flex' : 'none'

        if (!data || data.length === 0) {
            lista.innerHTML = `<div class="solicitacoes-vazio" style="padding: 16px; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 0.84rem; color: var(--txt3);">
                <span style="font-size: 1.2rem;">✅</span>
                <span>Nenhuma solicitação pendente no momento.</span>
            </div>`
            return
        }

        lista.innerHTML = ''
        data.forEach(s => {
            const dataFmt = new Date(s.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })

            const card = document.createElement('div')
            card.className = 'solicitacao-card'
            card.id = `sol-${s.id}`

            // Monta o card via DOM (evita XSS com dados do banco)
            const info = document.createElement('div')
            info.className = 'solicitacao-info'

            const nome = document.createElement('div')
            nome.className = 'solicitacao-nome'
            nome.textContent = s.nome

            const meta = document.createElement('div')
            meta.className = 'solicitacao-meta'
            meta.textContent = `${s.disciplina} · ${dataFmt}`

            // Badge com visualização segura do PIN escolhido
            const pinWrap = document.createElement('span')
            pinWrap.className = 'badge-solicitacao-pin-wrap'
            pinWrap.title = 'PIN escolhido pelo docente'
            const pinSpan = document.createElement('span')
            pinSpan.textContent = '••••'
            pinSpan.style.letterSpacing = '2px'
            const btnVerPin = document.createElement('button')
            btnVerPin.className = 'btn-ver-pin-sol'
            btnVerPin.type = 'button'
            btnVerPin.textContent = '👁️'
            btnVerPin.title = 'Ver/ocultar PIN'
            let pinVisivel = false
            btnVerPin.addEventListener('click', (e) => {
                e.stopPropagation()
                pinVisivel = !pinVisivel
                pinSpan.textContent = pinVisivel ? (s.pin || '----') : '••••'
                btnVerPin.textContent = pinVisivel ? '🔒' : '👁️'
            })
            pinWrap.appendChild(pinSpan)
            pinWrap.appendChild(btnVerPin)
            meta.appendChild(pinWrap)

            info.appendChild(nome)
            info.appendChild(meta)

            const acoes = document.createElement('div')
            acoes.className = 'solicitacao-acoes'

            const btnAprovar = document.createElement('button')
            btnAprovar.className = 'btn-aprovar'
            btnAprovar.textContent = '✓ Aprovar'
            // PIN armazenado em closure, nunca no DOM como atributo
            btnAprovar.addEventListener('click', () => aprovarSolicitacao(s.id, s.nome, s.disciplina, s.pin))

            const btnRejeitar = document.createElement('button')
            btnRejeitar.className = 'btn-rejeitar'
            btnRejeitar.textContent = '✕ Rejeitar'
            btnRejeitar.addEventListener('click', () => rejeitarSolicitacao(s.id, s.nome))

            acoes.appendChild(btnAprovar)
            acoes.appendChild(btnRejeitar)

            card.appendChild(info)
            card.appendChild(acoes)
            lista.appendChild(card)
        })

    } catch (err) {
        console.error('Erro ao carregar solicitações:', err)
        lista.innerHTML = '<div class="gerenciar-vazio">Erro ao carregar solicitações.</div>'
    }
}

async function aprovarSolicitacao(id, nome, disciplina, pin) {
    if (!await exigirAuth()) return

    const confirmar = await Swal.fire({
        icon: 'question',
        title: `Aprovar ${nome}?`,
        text: `Isso criará ou ativará o acesso de ${nome} (${disciplina}) com o PIN escolhido por ele.`,
        showCancelButton: true,
        confirmButtonText: 'Sim, aprovar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-sucesso)',
    })
    if (!confirmar.isConfirmed) return

    Swal.fire({ title: 'Aprovando e ativando acesso...', allowOutsideClick: false, didOpen: () => Swal.showLoading() })

    try {
        // 1. Verifica se já existe na tabela professores para não duplicar
        let profId = null
        const { data: existente } = await supabase
            .from('professores')
            .select('id')
            .ilike('nome', nome.trim())
            .maybeSingle()

        if (existente?.id) {
            profId = existente.id
            await supabase.from('professores').update({ disciplina }).eq('id', profId)
        } else {
            const { data: prof, error: errProf } = await supabase
                .from('professores')
                .insert([{ nome, disciplina, auth_user_id: null }])
                .select('id')
                .single()

            if (errProf) throw errProf
            profId = prof.id
        }

        // 2. Ativa o acesso do professor com o PIN escolhido
        try {
            await ativarOuAtualizarPinProfessor(profId, nome, pin)
        } catch (errAtiv) {
            if (!existente?.id) {
                await supabase.from('professores').delete().eq('id', profId)
            }
            throw errAtiv
        }

        // 3. Marca solicitação como aprovada (RLS: solicitacoes_update_coord)
        await supabase
            .from('solicitacoes_acesso')
            .update({ status: 'aprovado', atualizado_em: new Date().toISOString() })
            .eq('id', id)

        Swal.close()

        document.getElementById(`sol-${id}`)?.remove()
        carregarSolicitacoes()
        carregarListaProfessores()
        carregarProfessoresNoFiltro()

        enviarNotificacao(
            '✅ Acesso aprovado!',
            `Olá, ${nome}! Seu acesso ao Locus foi aprovado. Já pode fazer login com seu PIN.`,
            'professor',
            profId
        )

        dispararAlerta({ icon: 'success', title: 'Aprovado!', text: `${nome} já pode fazer login no Locus.`, confirmButtonColor: 'var(--cor-sucesso)', timer: 2500, showConfirmButton: false })

    } catch (err) {
        Swal.close()
        console.error('Erro ao aprovar:', err)
        dispararAlerta({ icon: 'error', title: 'Erro ao aprovar', text: err.message || 'Tente novamente.', confirmButtonColor: 'var(--cor-perigo)' })
    }
}

async function rejeitarSolicitacao(id, nome) {
    if (!await exigirAuth()) return

    const confirmar = await Swal.fire({
        icon: 'warning',
        title: `Rejeitar ${nome}?`,
        text: 'O professor não terá acesso ao sistema. Essa ação não pode ser desfeita.',
        showCancelButton: true,
        confirmButtonText: 'Sim, rejeitar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-perigo)',
    })
    if (!confirmar.isConfirmed) return

    try {
        // RLS: solicitacoes_update_coord
        await supabase
            .from('solicitacoes_acesso')
            .update({ status: 'rejeitado', atualizado_em: new Date().toISOString() })
            .eq('id', id)

        document.getElementById(`sol-${id}`)?.remove()
        carregarSolicitacoes()

        enviarNotificacao(
            '❌ Solicitação não aprovada',
            `${nome}, sua solicitação de acesso ao Locus não foi aprovada. Entre em contato com a coordenação.`,
            'coordenacao'
        )

        dispararAlerta({ icon: 'info', title: 'Solicitação rejeitada', text: `${nome} não terá acesso ao sistema.`, confirmButtonColor: 'var(--cor-primaria)', timer: 2200, showConfirmButton: false })
    } catch (err) {
        console.error('Erro ao rejeitar:', err)
        dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível rejeitar a solicitação.', confirmButtonColor: 'var(--cor-perigo)' })
    }
}

// Expõe as funções de solicitação no window (chamadas pelo Realtime e por toggle de seção)
window.carregarSolicitacoes = carregarSolicitacoes

// ============================================================
//  RELATÓRIO
// ============================================================

window.carregarRelatorioGeral = async function() {
    if (!await exigirAuth()) return

    const filtroData      = document.getElementById('filtroData')
    const filtroSala      = document.getElementById('filtroSala')
    const filtroProfessor = document.getElementById('filtroProfessor')
    const filtroTurno     = document.getElementById('filtroTurno')
    const tabela          = document.getElementById('listaAgendamentos')

    if (!filtroData || !tabela) return

    const dataFiltro      = filtroData.value
    const salaFiltro      = filtroSala?.value || ''
    const professorFiltro = filtroProfessor?.value || ''
    const turnoFiltro     = filtroTurno?.value || ''

    tabela.innerHTML = ''
    dadosAtuaisParaExportar = []

    if (!dataFiltro && !salaFiltro && !professorFiltro && !turnoFiltro) {
        tabela.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--texto-secundario)">Selecione uma data, sala, professor ou turno para ver os agendamentos.</td></tr>`
        return
    }

    tabela.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--texto-secundario)">Carregando...</td></tr>`

    let query = supabase
        .from('agendamentos')
        .select('id, data, aula_numero, professor_id, salas(nome), professores(nome), turmas(nome)')
    if (dataFiltro)      query = query.eq('data', dataFiltro)
    if (salaFiltro)      query = query.eq('sala_id', salaFiltro)
    if (professorFiltro) query = query.eq('professor_id', professorFiltro)

    const { data: agendamentos, error } = await query
        .order('data', { ascending: true })
        .order('aula_numero', { ascending: true })

    if (error) {
        dispararAlerta({ icon: 'error', title: 'Erro de carregamento', text: 'Não foi possível buscar os agendamentos.', confirmButtonColor: 'var(--cor-perigo)' })
        return
    }

    let agendamentosFiltrados = agendamentos || []
    if (turnoFiltro) {
        agendamentosFiltrados = agendamentosFiltrados.filter(item => {
            return detectarTurnoTurma(item.turmas?.nome) === turnoFiltro
        })
    }

    const qtdEl = document.getElementById('qtd-total')
    if (qtdEl) qtdEl.innerText = agendamentosFiltrados.length
    dadosAtuaisParaExportar = agendamentosFiltrados

    if (agendamentosFiltrados.length === 0) {
        tabela.innerHTML = `<tr><td colspan="6" class="tabela-vazio-container">
            <div class="tabela-vazio-wrap">
                <span class="tabela-vazio-icon">📅</span>
                <div class="tabela-vazio-titulo">Nenhuma reserva encontrada</div>
                <div class="tabela-vazio-sub">Não há agendamentos cadastrados para os filtros selecionados.</div>
            </div>
        </td></tr>`
        return
    }

    tabela.innerHTML = ''
    agendamentosFiltrados.forEach(item => {
        const dataBr = item.data.split('-').reverse().join('/')
        const tr = document.createElement('tr')

        // Monta via DOM para evitar XSS com dados do banco
        const tdData = document.createElement('td')
        const dataSpan = document.createElement('span')
        dataSpan.className = 'data-tabela-pill'
        dataSpan.textContent = dataBr
        tdData.appendChild(dataSpan)

        const turnoItem = detectarTurnoTurma(item.turmas?.nome)
        const horario = obterHorarioAula(item.aula_numero, turnoItem)
        const badgeTurno = turnoItem === 'eja' ? '🌙 EJA' : '☀️ Manhã'

        const tdAula = document.createElement('td')
        const badge = document.createElement('span')
        badge.className = `badge-aula badge-turno-${turnoItem === 'eja' ? 'eja' : 'manha'}`
        badge.textContent = `${badgeTurno} · Aula ${item.aula_numero}ª (${horario.inicio}–${horario.fim})`
        tdAula.appendChild(badge)

        const tdSala = document.createElement('td')
        const badgeSala = document.createElement('span')
        badgeSala.className = 'badge-sala-tabela'
        badgeSala.textContent = `📍 ${item.salas?.nome || 'Não informada'}`
        tdSala.appendChild(badgeSala)

        const tdProf = document.createElement('td')
        const wrapProf = document.createElement('div')
        wrapProf.className = 'tabela-prof-wrap'
        const avatarProf = document.createElement('div')
        avatarProf.className = 'tabela-prof-avatar'
        const profNome = item.professores?.nome || 'Desconhecido'
        avatarProf.textContent = profNome.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'P'
        const spanProf = document.createElement('span')
        spanProf.className = 'tabela-prof-nome'
        spanProf.textContent = `Prof. ${profNome}`
        wrapProf.appendChild(avatarProf)
        wrapProf.appendChild(spanProf)
        tdProf.appendChild(wrapProf)

        const tdTurma = document.createElement('td')
        const badgeTurma = document.createElement('span')
        badgeTurma.className = 'badge-turma-tabela'
        badgeTurma.textContent = `👥 ${item.turmas?.nome || 'Geral'}`
        tdTurma.appendChild(badgeTurma)

        const tdAcao = document.createElement('td')
        const btnRevogar = document.createElement('button')
        btnRevogar.className = 'btn-revogar'
        btnRevogar.innerHTML = '<span>✕</span> Cancelar'
        const nomeSala   = item.salas?.nome || ''
        const numAula    = item.aula_numero
        const profId     = item.professor_id
        btnRevogar.addEventListener('click', () =>
            window.revogarAgendamento(item.id, nomeSala, numAula, profId, dataBr)
        )
        tdAcao.appendChild(btnRevogar)

        tr.appendChild(tdData)
        tr.appendChild(tdAula)
        tr.appendChild(tdSala)
        tr.appendChild(tdProf)
        tr.appendChild(tdTurma)
        tr.appendChild(tdAcao)
        tabela.appendChild(tr)
    })
}

window.limparFiltros = function() {
    const filtroData      = document.getElementById('filtroData')
    const filtroSala      = document.getElementById('filtroSala')
    const filtroProfessor = document.getElementById('filtroProfessor')
    const filtroTurno     = document.getElementById('filtroTurno')
    if (filtroData)       filtroData.value = ''
    if (filtroSala)       filtroSala.value = ''
    if (filtroProfessor)  filtroProfessor.value = ''
    if (filtroTurno)      filtroTurno.value = ''
    carregarRelatorioGeral()
}

window.revogarAgendamento = async function(idAgendamento, nomeSala, numeroAula, professorId, dataBr) {
    if (!await exigirAuth()) return

    const confirmacao = await Swal.fire({
        title: 'Tem certeza?',
        text: `Cancelar reserva de ${nomeSala} — Aula ${numeroAula}?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-perigo)',
        cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: 'Sim, cancelar!',
        cancelButtonText: 'Voltar'
    })
    if (!confirmacao.isConfirmed) return

    // RLS: agendamentos_delete_coord
    const { error } = await supabase.from('agendamentos').delete().eq('id', idAgendamento)

    if (error) {
        dispararAlerta({ icon: 'error', title: 'Erro!', text: 'Não foi possível excluir o agendamento.', confirmButtonColor: 'var(--cor-primaria)' })
    } else {
        dispararAlerta({ icon: 'success', title: 'Cancelado!', text: 'Reserva removida.', timer: 1500, showConfirmButton: false })
        carregarRelatorioGeral()
        if (professorId && professorId !== 'undefined' && professorId !== 'null') {
            enviarNotificacao(
                'Reserva cancelada pela coordenação',
                `Sua reserva de ${nomeSala} (Aula ${numeroAula}) em ${dataBr} foi cancelada pela coordenação.`,
                'professor',
                professorId
            )
        }
    }
}

window.baixarRelatorioCSV = async function() {
    if (!await exigirAuth()) return

    if (!dadosAtuaisParaExportar || dadosAtuaisParaExportar.length === 0) {
        dispararAlerta({
            icon: 'warning',
            title: 'Tabela vazia',
            text: 'Filtre por uma data com agendamentos antes de baixar a planilha.',
            confirmButtonColor: 'var(--cor-primaria)'
        })
        return
    }

    try {
        const escapeCSV = (val) => {
            const str = String(val ?? '')
            return `"${str.replace(/"/g, '""')}"`
        }

        const cabecalho = ['Data', 'Turno', 'Aula', 'Horário Início', 'Horário Fim', 'Sala / Local', 'Professor', 'Turma']
        const linhas = [cabecalho.map(escapeCSV).join(';')]

        dadosAtuaisParaExportar.forEach(item => {
            const dataBr    = item.data.split('-').reverse().join('/')
            const turnoItem = detectarTurnoTurma(item.turmas?.nome)
            const horario   = obterHorarioAula(item.aula_numero, turnoItem)
            const nomeTurno = turnoItem === 'eja' ? 'EJA Noturno' : 'Manhã Integral'
            const nomeSala  = item.salas?.nome || 'Não informada'
            const nomeProf  = item.professores?.nome || 'Desconhecido'
            const nomeTurma = item.turmas?.nome || 'Geral'

            const linha = [
                dataBr,
                nomeTurno,
                `Aula ${item.aula_numero}ª`,
                horario.inicio,
                horario.fim,
                nomeSala,
                nomeProf,
                nomeTurma
            ]
            linhas.push(linha.map(escapeCSV).join(';'))
        })

        // Adiciona UTF-8 BOM (\uFEFF) para garantir abertura com acentuação correta no Excel (Windows e Mac)
        const conteudoCSV = '\uFEFF' + linhas.join('\r\n')
        const blob = new Blob([conteudoCSV], { type: 'text/csv;charset=utf-8;' })

        const filtroData = document.getElementById('filtroData')?.value
        const filtroTurno = document.getElementById('filtroTurno')?.value
        const sufixoTurno = filtroTurno ? `-${filtroTurno}` : ''
        const sufixoData  = filtroData || formatarData(new Date())
        const nomeArquivo = `locus-agendamentos${sufixoTurno}-${sufixoData}.csv`

        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', nomeArquivo)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: 'success',
                title: 'Download Concluído!',
                text: `Arquivo "${nomeArquivo}" baixado com sucesso.`,
                timer: 2200,
                showConfirmButton: false
            })
        } else {
            alert(`Arquivo "${nomeArquivo}" baixado com sucesso!`)
        }

    } catch (err) {
        console.error('Erro ao gerar CSV:', err)
        dispararAlerta({
            icon: 'error',
            title: 'Falha no download',
            text: 'Ocorreu um erro ao gerar o arquivo CSV.',
            confirmButtonColor: 'var(--cor-perigo)'
        })
    }
}

// ============================================================
//  SISTEMA DE ABAS PRINCIPAIS & GERENCIAMENTO
// ============================================================

let cacheProfessores = []
let cacheTurmas = []
let cacheSalas = []
let disciplinasCache = []
let cacheAgendamentosPorProf = {}
let filtroStatusProfAtual = 'todos'

window.filtrarReservasPorProfessor = function(nomeProf) {
    if (!nomeProf) return
    window.mudarAbaPrincipal('reservas')
    const fProf = document.getElementById('filtroProfessor')
    if (fProf) {
        let achou = false
        for (let opt of fProf.options) {
            if (opt.text.toLowerCase().trim() === nomeProf.toLowerCase().trim() || opt.value.toLowerCase().trim() === nomeProf.toLowerCase().trim()) {
                fProf.value = opt.value
                achou = true
                break
            }
        }
        if (!achou) {
            fProf.value = nomeProf
        }
        carregarRelatorioGeral()
    }
}

window.mudarAbaPrincipal = function(aba) {
    const abas = ['reservas', 'professores', 'salas-turmas']
    abas.forEach(a => {
        const btn = document.getElementById(`nav-aba-${a}`)
        const painel = document.getElementById(`painel-aba-${a}`)
        if (btn) btn.classList.toggle('ativo', a === aba)
        if (painel) painel.classList.toggle('oculto', a !== aba)
    })

    if (aba === 'professores') {
        carregarSolicitacoes()
        carregarListaProfessores()
    } else if (aba === 'salas-turmas') {
        carregarListaTurmas()
        carregarListaSalas()
    } else if (aba === 'reservas') {
        carregarRelatorioGeral()
    }
}

window.alternarSubTab = function(sub) {
    const btnTurmas = document.getElementById('subtab-turmas-btn')
    const btnSalas = document.getElementById('subtab-salas-btn')
    const painelTurmas = document.getElementById('subpainel-turmas')
    const painelSalas = document.getElementById('subpainel-salas')

    if (sub === 'turmas') {
        btnTurmas?.classList.add('ativa')
        btnSalas?.classList.remove('ativa')
        painelTurmas?.classList.remove('oculto')
        painelSalas?.classList.add('oculto')
    } else {
        btnTurmas?.classList.remove('ativa')
        btnSalas?.classList.add('ativa')
        painelTurmas?.classList.add('oculto')
        painelSalas?.classList.remove('oculto')
    }
}
window.alternarTabSalasTurmas = window.alternarSubTab
window.alternarTabGerenciar = function(aba) { window.alternarSubTab(aba) }
window.alternarGerenciamento = function() { window.mudarAbaPrincipal('salas-turmas') }
window.alternarGerenciamentoProfessores = function() { window.mudarAbaPrincipal('professores') }

// ------------------------------------------------------------
//  GERENCIAR SALAS
// ------------------------------------------------------------
async function carregarListaSalas() {
    const container = document.getElementById('lista-salas')
    if (!container) return
    container.innerHTML = '<div class="gerenciar-vazio">Carregando salas...</div>'

    const { data: salas, error } = await supabase.from('salas').select('id, nome').order('nome', { ascending: true })
    if (error) { container.innerHTML = '<div class="gerenciar-vazio">Erro ao carregar salas.</div>'; return }
    
    cacheSalas = salas || []
    const qtdEl = document.getElementById('qtd-salas-total')
    if (qtdEl) qtdEl.textContent = cacheSalas.length

    renderizarListaSalas(cacheSalas)
}

function renderizarListaSalas(salas, isFiltrado = false) {
    const container = document.getElementById('lista-salas')
    if (!container) return

    if (!salas || salas.length === 0) {
        container.innerHTML = `<div class="gerenciar-vazio">${isFiltrado ? 'Nenhuma sala encontrada para esta busca.' : 'Nenhuma sala cadastrada ainda.'}</div>`
        return
    }

    container.innerHTML = ''
    salas.forEach((sala, i) => {
        const div = document.createElement('div')
        div.className = 'item-card-moderno'
        div.style.animationDelay = `${i * 0.03}s`

        const info = document.createElement('div')
        info.className = 'item-card-info'

        const icone = document.createElement('div')
        icone.className = 'item-card-icone sala'
        icone.textContent = '🏫'

        const detalhes = document.createElement('div')
        detalhes.className = 'item-card-detalhes'

        const nome = document.createElement('div')
        nome.className = 'item-card-nome'
        nome.textContent = sala.nome

        detalhes.appendChild(nome)
        info.appendChild(icone)
        info.appendChild(detalhes)

        const btnDel = document.createElement('button')
        btnDel.className = 'btn-item-del'
        btnDel.title = `Excluir sala ${sala.nome}`
        btnDel.textContent = '🗑'
        btnDel.addEventListener('click', () => window.excluirSala(sala.id, sala.nome))

        div.appendChild(info)
        div.appendChild(btnDel)
        container.appendChild(div)
    })
}

window.filtrarSalas = function(termo) {
    termo = (termo || '').toLowerCase().trim()
    const filtradas = cacheSalas.filter(s => s.nome && s.nome.toLowerCase().includes(termo))
    renderizarListaSalas(filtradas, termo !== '')
}

window.adicionarSala = async function() {
    if (!await exigirAuth()) return
    const input = document.getElementById('nova-sala-nome')
    const nome  = input.value.trim()
    if (!nome) { dispararAlerta({ icon: 'warning', title: 'Atenção', text: 'Digite o nome da sala.', confirmButtonColor: 'var(--cor-primaria)' }); return }
    // RLS: salas_insert_coord
    const { error } = await supabase.from('salas').insert([{ nome }])
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível adicionar a sala.', confirmButtonColor: 'var(--cor-perigo)' }); return }
    input.value = ''
    carregarListaSalas()
    carregarSalasNoFiltro()
}

window.excluirSala = async function(id, nome) {
    if (!await exigirAuth()) return;

    // Busca agendamentos vinculados
    const { data: vinculos, count } = await supabase
        .from('agendamentos')
        .select('id', { count: 'exact' })
        .eq('sala_id', id);

    const total = count ?? (vinculos ? vinculos.length : 0);

    let textoConfirmacao = `Tem certeza que deseja excluir a sala "${nome}"? Esta ação não pode ser desfeita.`;
    let textoBotao = 'Sim, excluir!';

    if (total > 0) {
        textoConfirmacao = `A sala "${nome}" possui ${total} agendamento(s) vinculado(s). Ao confirmar, todos os agendamentos vinculados a esta sala serão cancelados/excluídos definitivamente. Deseja prosseguir?`;
        textoBotao = 'Sim, excluir sala e agendamentos!';
    }

    const confirmacao = await Swal.fire({
        title: 'Excluir sala?',
        text: textoConfirmacao,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-perigo)',
        cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: textoBotao,
        cancelButtonText: 'Cancelar'
    });
    if (!confirmacao.isConfirmed) return;

    Swal.fire({ title: 'Excluindo sala...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // Se houver agendamentos vinculados, deleta os agendamentos primeiro para liberar a restrição de FK
    if (total > 0) {
        const { error: errAgendamentos } = await supabase
            .from('agendamentos')
            .delete()
            .eq('sala_id', id);

        if (errAgendamentos) {
            Swal.close();
            dispararAlerta({
                icon: 'error',
                title: 'Erro ao desvincular agendamentos',
                text: 'Não foi possível cancelar as reservas vinculadas a esta sala.',
                confirmButtonColor: 'var(--cor-perigo)'
            });
            return;
        }
    }

    // RLS: salas_delete_coord
    const { error } = await supabase.from('salas').delete().eq('id', id);
    Swal.close();

    if (error) {
        dispararAlerta({
            icon: 'error',
            title: 'Erro ao excluir',
            text: error.code === '23503'
                ? `A sala "${nome}" possui registros vinculados e não pode ser excluída.`
                : 'Não foi possível excluir a sala.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
        return;
    }

    dispararAlerta({ icon: 'success', title: 'Sala excluída!', text: `A sala "${nome}" foi removida com sucesso.`, timer: 1500, showConfirmButton: false });
    carregarListaSalas();
    carregarSalasNoFiltro();
    carregarRelatorioGeral();
}

// ------------------------------------------------------------
//  GERENCIAR TURMAS
// ------------------------------------------------------------
async function carregarListaTurmas() {
    const container = document.getElementById('lista-turmas')
    if (!container) return
    container.innerHTML = '<div class="gerenciar-vazio">Carregando turmas...</div>'

    const { data: turmas, error } = await supabase.from('turmas').select('id, nome').order('nome', { ascending: true })
    if (error) { container.innerHTML = '<div class="gerenciar-vazio">Erro ao carregar turmas.</div>'; return }
    
    cacheTurmas = turmas || []
    const qtdEl = document.getElementById('qtd-turmas-total')
    if (qtdEl) qtdEl.textContent = cacheTurmas.length

    renderizarListaTurmas(cacheTurmas)
}

function renderizarListaTurmas(turmas, isFiltrado = false) {
    const container = document.getElementById('lista-turmas')
    if (!container) return

    if (!turmas || turmas.length === 0) {
        container.innerHTML = `<div class="gerenciar-vazio">${isFiltrado ? 'Nenhuma turma encontrada para esta busca.' : 'Nenhuma turma cadastrada ainda.'}</div>`
        return
    }

    container.innerHTML = ''
    turmas.forEach((turma, i) => {
        const div = document.createElement('div')
        div.className = 'item-card-moderno'
        div.style.animationDelay = `${i * 0.03}s`

        const info = document.createElement('div')
        info.className = 'item-card-info'

        const icone = document.createElement('div')
        icone.className = 'item-card-icone turma'
        icone.textContent = '👥'

        const detalhes = document.createElement('div')
        detalhes.className = 'item-card-detalhes'

        const nome = document.createElement('div')
        nome.className = 'item-card-nome'
        nome.textContent = turma.nome

        // Detecção automática de turno
        const turno = detectarTurnoTurma(turma.nome)
        const tagTurno = document.createElement('span')
        if (turno === 'manha') {
            tagTurno.className = 'badge-turno-tag manha'
            tagTurno.textContent = '☀️ Manhã'
        } else if (turno === 'eja') {
            tagTurno.className = 'badge-turno-tag eja'
            tagTurno.textContent = '🌙 EJA'
        } else {
            tagTurno.className = 'badge-turno-tag geral'
            tagTurno.textContent = '📚 Geral'
        }

        detalhes.appendChild(nome)
        detalhes.appendChild(tagTurno)
        info.appendChild(icone)
        info.appendChild(detalhes)

        const btnDel = document.createElement('button')
        btnDel.className = 'btn-item-del'
        btnDel.title = `Excluir turma ${turma.nome}`
        btnDel.textContent = '🗑'
        btnDel.addEventListener('click', () => window.excluirTurma(turma.id, turma.nome))

        div.appendChild(info)
        div.appendChild(btnDel)
        container.appendChild(div)
    })
}

window.filtrarTurmas = function(termo) {
    termo = (termo || '').toLowerCase().trim()
    const filtradas = cacheTurmas.filter(t => t.nome && t.nome.toLowerCase().includes(termo))
    renderizarListaTurmas(filtradas, termo !== '')
}

window.adicionarTurma = async function() {
    if (!await exigirAuth()) return
    const input = document.getElementById('nova-turma-nome')
    const nome  = input.value.trim()
    if (!nome) { dispararAlerta({ icon: 'warning', title: 'Atenção', text: 'Digite o nome da turma.', confirmButtonColor: 'var(--cor-primaria)' }); return }
    // RLS: turmas_insert_coord
    const { error } = await supabase.from('turmas').insert([{ nome }])
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível adicionar a turma.', confirmButtonColor: 'var(--cor-perigo)' }); return }
    input.value = ''
    carregarListaTurmas()
}

window.excluirTurma = async function(id, nome) {
    if (!await exigirAuth()) return;

    const { data: vinculos, count } = await supabase
        .from('agendamentos')
        .select('id', { count: 'exact' })
        .eq('turma_id', id);

    const total = count ?? (vinculos ? vinculos.length : 0);

    let textoConfirmacao = `Tem certeza que deseja excluir a turma "${nome}"? Esta ação não pode ser desfeita.`;
    let textoBotao = 'Sim, excluir!';

    if (total > 0) {
        textoConfirmacao = `A turma "${nome}" possui ${total} agendamento(s) vinculado(s). Ao confirmar, todos os agendamentos vinculados a esta turma serão cancelados/excluídos definitivamente. Deseja prosseguir?`;
        textoBotao = 'Sim, excluir turma e agendamentos!';
    }

    const confirmacao = await Swal.fire({
        title: 'Excluir turma?',
        text: textoConfirmacao,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-perigo)',
        cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: textoBotao,
        cancelButtonText: 'Cancelar'
    });
    if (!confirmacao.isConfirmed) return;

    Swal.fire({ title: 'Excluindo turma...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    if (total > 0) {
        const { error: errAgendamentos } = await supabase
            .from('agendamentos')
            .delete()
            .eq('turma_id', id);

        if (errAgendamentos) {
            Swal.close();
            dispararAlerta({
                icon: 'error',
                title: 'Erro ao desvincular agendamentos',
                text: 'Não foi possível cancelar as reservas vinculadas a esta turma.',
                confirmButtonColor: 'var(--cor-perigo)'
            });
            return;
        }
    }

    // RLS: turmas_delete_coord
    const { error } = await supabase.from('turmas').delete().eq('id', id);
    Swal.close();

    if (error) {
        dispararAlerta({
            icon: 'error',
            title: 'Erro ao excluir',
            text: error.code === '23503'
                ? `A turma "${nome}" possui registros vinculados e não pode ser excluída.`
                : 'Não foi possível excluir a turma.',
            confirmButtonColor: 'var(--cor-perigo)'
        });
        return;
    }

    dispararAlerta({ icon: 'success', title: 'Turma excluída!', text: `A turma "${nome}" foi removida com sucesso.`, timer: 1500, showConfirmButton: false });
    carregarListaTurmas();
    carregarRelatorioGeral();
}

// ------------------------------------------------------------
//  GERENCIAR PROFESSORES
// ------------------------------------------------------------
async function obterDisciplinasCache() {
    if (disciplinasCache.length > 0) return disciplinasCache
    const { data, error } = await supabase.from('disciplinas').select('id, nome').order('nome', { ascending: true })
    if (!error && data) disciplinasCache = data
    return disciplinasCache
}

async function carregarListaProfessores() {
    const container = document.getElementById('lista-professores')
    if (!container) return
    container.innerHTML = '<div class="gerenciar-vazio">Carregando professores...</div>'

    const [{ data: professores, error }, disciplinas, { data: agendamentosData }] = await Promise.all([
        supabase.from('professores').select('id, nome, disciplina, auth_user_id').order('nome', { ascending: true }),
        obterDisciplinasCache(),
        supabase.from('agendamentos').select('professor_id')
    ])

    if (error) {
        container.innerHTML = '<div class="gerenciar-vazio">Erro ao carregar professores.</div>'
        return
    }

    // Calcula contagem de reservas por professor
    cacheAgendamentosPorProf = {}
    if (agendamentosData) {
        agendamentosData.forEach(a => {
            if (a.professor_id) {
                cacheAgendamentosPorProf[a.professor_id] = (cacheAgendamentosPorProf[a.professor_id] || 0) + 1
            }
        })
    }
    
    cacheProfessores = professores || []
    const ativosCount = cacheProfessores.filter(p => p.auth_user_id !== null && p.auth_user_id !== '').length
    const pendentesCount = cacheProfessores.length - ativosCount

    // Atualiza KPIs principais
    const kpiTotal = document.getElementById('kpi-prof-total')
    const kpiAtivos = document.getElementById('kpi-prof-ativos')
    const kpiPendentes = document.getElementById('kpi-prof-pendentes')
    if (kpiTotal) kpiTotal.textContent = cacheProfessores.length
    if (kpiAtivos) kpiAtivos.textContent = ativosCount
    if (kpiPendentes) kpiPendentes.textContent = pendentesCount

    const qtdProfEl = document.getElementById('qtd-professores-total')
    if (qtdProfEl) qtdProfEl.textContent = ativosCount

    // Atualiza contadores dos chips
    const chipTodos = document.getElementById('chip-count-todos')
    const chipAtivos = document.getElementById('chip-count-ativos')
    const chipPendentes = document.getElementById('chip-count-pendentes')
    if (chipTodos) chipTodos.textContent = cacheProfessores.length
    if (chipAtivos) chipAtivos.textContent = ativosCount
    if (chipPendentes) chipPendentes.textContent = pendentesCount

    // Atualiza dropdown de disciplinas para filtro
    const selectFiltro = document.getElementById('filtro-disciplina-professores')
    if (selectFiltro) {
        const valAtual = selectFiltro.value
        const discUnicas = [...new Set(cacheProfessores.map(p => p.disciplina).filter(Boolean))].sort()
        selectFiltro.innerHTML = '<option value="">Todas as disciplinas</option>'
        discUnicas.forEach(d => {
            const opt = document.createElement('option')
            opt.value = d
            opt.textContent = d
            if (d === valAtual) opt.selected = true
            selectFiltro.appendChild(opt)
        })
    }

    window.aplicarFiltrosProfessores()
}

window.filtrarStatusProfessores = function(status) {
    filtroStatusProfAtual = status || 'todos'
    const chips = ['todos', 'ativos', 'pendentes']
    chips.forEach(s => {
        const btn = document.getElementById(`chip-status-${s}`)
        if (btn) btn.classList.toggle('ativo', s === filtroStatusProfAtual)
    })
    window.aplicarFiltrosProfessores()
}

window.aplicarFiltrosProfessores = function() {
    const inputBusca = document.getElementById('busca-professores')
    const selectDisc = document.getElementById('filtro-disciplina-professores')
    const termo = (inputBusca?.value || '').toLowerCase().trim()
    const discEscolhida = selectDisc?.value || ''

    const filtrados = cacheProfessores.filter(p => {
        // Filtro por texto
        const matchTexto = !termo ||
            (p.nome && p.nome.toLowerCase().includes(termo)) ||
            (p.disciplina && p.disciplina.toLowerCase().includes(termo))

        // Filtro por status
        const temAcesso = p.auth_user_id !== null && p.auth_user_id !== ''
        let matchStatus = true
        if (filtroStatusProfAtual === 'ativos') matchStatus = temAcesso
        else if (filtroStatusProfAtual === 'pendentes') matchStatus = !temAcesso

        // Filtro por disciplina
        const matchDisc = !discEscolhida || p.disciplina === discEscolhida

        return matchTexto && matchStatus && matchDisc
    })

    const contadorEl = document.getElementById('contador-professores-filtrados')
    if (contadorEl) {
        if (termo || discEscolhida || filtroStatusProfAtual !== 'todos') {
            contadorEl.textContent = `Exibindo ${filtrados.length} de ${cacheProfessores.length} docentes`
        } else {
            contadorEl.textContent = `${cacheProfessores.length} docente${cacheProfessores.length === 1 ? '' : 's'} cadastrado${cacheProfessores.length === 1 ? '' : 's'}`
        }
    }

    const isFiltrado = termo !== '' || discEscolhida !== '' || filtroStatusProfAtual !== 'todos'
    renderizarListaProfessores(filtrados, disciplinasCache, isFiltrado)
}

window.filtrarProfessores = function(termo) {
    const inputBusca = document.getElementById('busca-professores')
    if (inputBusca) inputBusca.value = termo
    window.aplicarFiltrosProfessores()
}

// Paleta dinâmica de gradientes para os avatares do corpo docente
const GRADIENTES_AVATAR = [
    'linear-gradient(135deg, #6366f1, #8b5cf6)', // Indigo - Violet
    'linear-gradient(135deg, #0284c7, #2563eb)', // Sky - Blue
    'linear-gradient(135deg, #059669, #10b981)', // Emerald
    'linear-gradient(135deg, #d97706, #f59e0b)', // Amber
    'linear-gradient(135deg, #db2777, #ec4899)', // Pink
    'linear-gradient(135deg, #7c3aed, #c026d3)', // Purple - Fuchsia
    'linear-gradient(135deg, #0d9488, #06b6d4)', // Teal - Cyan
    'linear-gradient(135deg, #dc2626, #f43f5e)'  // Red - Rose
]

function obterGradienteAvatar(str) {
    let hash = 0
    const txt = str || 'Docente'
    for (let i = 0; i < txt.length; i++) {
        hash = txt.charCodeAt(i) + ((hash << 5) - hash)
    }
    const idx = Math.abs(hash) % GRADIENTES_AVATAR.length
    return GRADIENTES_AVATAR[idx]
}

function renderizarListaProfessores(professores, disciplinas = disciplinasCache, isFiltrado = false) {
    const container = document.getElementById('lista-professores')
    if (!container) return

    if (!professores || professores.length === 0) {
        container.innerHTML = `<div class="gerenciar-vazio" style="grid-column: 1 / -1; padding: 36px 16px;">
            ${isFiltrado ? 'Nenhum professor encontrado para os filtros selecionados.' : 'Nenhum professor cadastrado ainda.'}
        </div>`
        return
    }

    container.innerHTML = ''
    professores.forEach((prof, i) => {
        const temAcesso = prof.auth_user_id !== null && prof.auth_user_id !== ''
        const iniciais  = prof.nome.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()
        const qtdReservas = cacheAgendamentosPorProf[prof.id] || 0
        const gradiente = obterGradienteAvatar(prof.nome)

        const div = document.createElement('div')
        div.classList.add('professor-card')
        div.style.animationDelay = `${i * 0.03}s`

        // Monta seletor de disciplinas via DOM
        const selectOpts = (disciplinas || []).map(d => {
            const opt = document.createElement('option')
            opt.value = d.nome
            opt.textContent = d.nome
            if (d.nome === prof.disciplina) opt.selected = true
            return opt
        })

        const statusClasse = temAcesso ? 'ativo' : 'pendente'
        const statusTexto  = temAcesso ? '● Acesso Ativo' : '○ Sem PIN'

        div.innerHTML = `
            <div class="professor-card-topo">
                <div class="avatar-wrapper">
                    <div class="professor-card-avatar" style="--avatar-bg: ${gradiente}; background: ${gradiente} !important;">
                        ${iniciais}
                    </div>
                    <span class="avatar-status-dot ${statusClasse}" title="${temAcesso ? 'Acesso Ativo' : 'Sem PIN'}"></span>
                </div>
                <div class="professor-card-info">
                    <div class="professor-nome" title="${prof.nome}">${prof.nome}</div>
                    <div class="professor-card-meta">
                        <span class="badge-disciplina-pill" title="Disciplina">${prof.disciplina || 'Sem disciplina'}</span>
                        <span class="badge-reservas-pill" id="res-prof-${prof.id}" title="Clique para ver os agendamentos deste professor">
                            📅 ${qtdReservas} reserva${qtdReservas === 1 ? '' : 's'} <span style="opacity:0.7; font-size:0.75rem;">›</span>
                        </span>
                    </div>
                </div>
            </div>

            <div class="professor-card-footer">
                <span class="status-pill-badge ${statusClasse}">
                    ${statusTexto}
                </span>
                <div class="card-acoes-botoes">
                    <button class="btn-card-pin ${temAcesso ? '' : 'destaque'}" id="btn-pin-${prof.id}" title="${temAcesso ? 'Alterar ou redefinir PIN de acesso' : 'Definir PIN e ativar acesso agora'}">
                        <span>🔑</span> ${temAcesso ? 'PIN' : 'Ativar PIN'}
                    </button>
                    <button class="btn-card-icon" id="btn-edit-${prof.id}" title="Editar nome e disciplina">
                        ✏️
                    </button>
                    <button class="btn-card-icon danger" id="btn-del-${prof.id}" title="Excluir professor">
                        🗑️
                    </button>
                </div>
            </div>

            <div class="professor-card-expansivel" id="exp-${prof.id}">
                <div class="edicao-campos-grid">
                    <div class="edicao-campo">
                        <label>Nome Completo:</label>
                        <input type="text" id="edit-nome-${prof.id}" placeholder="Nome completo" value="${prof.nome.replace(/"/g, '&quot;')}">
                    </div>
                    <div class="edicao-campo">
                        <label>Disciplina:</label>
                        <select id="edit-disciplina-${prof.id}">
                            <option value="">Selecione a disciplina...</option>
                        </select>
                    </div>
                </div>
                <div class="edicao-botoes">
                    <button class="btn-novo-professor" id="btn-salvar-${prof.id}" style="padding: 8px 16px; font-size: 0.78rem;">
                        💾 Salvar Alterações
                    </button>
                    <button class="btn-card-pin" id="btn-cancelar-edit-${prof.id}" style="padding: 8px 14px;">
                        ✕ Cancelar
                    </button>
                </div>
            </div>`

        const select = div.querySelector(`#edit-disciplina-${prof.id}`)
        selectOpts.forEach(opt => select.appendChild(opt.cloneNode(true)))

        // Eventos dos botões
        div.querySelector(`#res-prof-${prof.id}`)
            ?.addEventListener('click', () => window.filtrarReservasPorProfessor(prof.nome))

        div.querySelector(`#btn-pin-${prof.id}`)
            ?.addEventListener('click', () => window.gerenciarAcessoProfessor(prof.id, prof.nome, temAcesso))

        div.querySelector(`#btn-edit-${prof.id}`)
            ?.addEventListener('click', () => window.toggleEditarProfessor(prof.id))

        div.querySelector(`#btn-del-${prof.id}`)
            ?.addEventListener('click', () => window.excluirProfessor(prof.id, prof.nome))

        div.querySelector(`#btn-salvar-${prof.id}`)
            ?.addEventListener('click', () => window.salvarEdicaoProfessor(prof.id))

        div.querySelector(`#btn-cancelar-edit-${prof.id}`)
            ?.addEventListener('click', () => window.toggleEditarProfessor(prof.id))

        container.appendChild(div)
    })
}

window.toggleEditarProfessor = function(id) {
    const exp = document.getElementById(`exp-${id}`)
    const btn = document.getElementById(`btn-edit-${id}`)
    if (!exp) return
    const isOpen = exp.classList.contains('aberto')
    document.querySelectorAll('.professor-card-expansivel.aberto').forEach(el => {
        el.classList.remove('aberto')
        const otherId = el.id.replace('exp-', '')
        const otherBtn = document.getElementById(`btn-edit-${otherId}`)
        if (otherBtn) otherBtn.textContent = '✏️'
    })
    if (!isOpen) {
        exp.classList.add('aberto')
        if (btn) btn.textContent = '✕'
        exp.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
}

window.salvarEdicaoProfessor = async function(id) {
    if (!await exigirAuth()) return
    const nome       = document.getElementById(`edit-nome-${id}`).value.trim()
    const disciplina = document.getElementById(`edit-disciplina-${id}`).value
    if (!nome) { dispararAlerta({ icon: 'warning', title: 'Atenção', text: 'O nome não pode ficar vazio.', confirmButtonColor: 'var(--cor-primaria)' }); return }
    // RLS: professores_update_coord
    const { error } = await supabase.from('professores').update({ nome, disciplina }).eq('id', id)
    if (error) { dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível salvar as alterações.', confirmButtonColor: 'var(--cor-perigo)' }); return }
    dispararAlerta({ icon: 'success', title: 'Salvo!', timer: 1200, showConfirmButton: false })
    carregarListaProfessores()
    carregarProfessoresNoFiltro()
}

/**
 * Ativa ou redefine o PIN de 4 dígitos de um professor de forma robusta e resiliente.
 * Resolve o problema de política de senhas (mínimo 6 caracteres do Supabase Auth)
 * utilizando o padrão 'locus_PIN' compatível com professor.js.
 */
async function ativarOuAtualizarPinProfessor(profId, nome, pin) {
    if (!pin || pin.length !== 4) {
        throw new Error('O PIN deve conter exatamente 4 dígitos numéricos.');
    }

    const emailFicticio = `prof-${profId}@locus.interno`;
    const senhaAuth = `locus_${pin}`;

    // 1. Tenta via Edge Function ativar-professor primeiro (para manter compatibilidade)
    try {
        const { data: resFn, error: errFn } = await supabase.functions.invoke('ativar-professor', {
            body: { professor_id: profId, pin }
        });
        if (!errFn && resFn?.sucesso) {
            return { sucesso: true, metodo: 'edge_function' };
        }
    } catch (e) {
        console.warn('[PIN] Tentativa via Edge Function falhou, aplicando fallback direto:', e);
    }

    // 2. Fallback direto via Supabase Auth + REST:
    // Limpa qualquer registro anterior ou corrompido em auth.users para evitar conflitos de email duplicado
    try {
        await supabase.functions.invoke('resetar-acesso-professor', {
            body: { professor_id: profId }
        });
    } catch (_) {}

    // 3. Realiza o cadastro do usuário no Supabase Auth com o padrão de senha seguro (locus_PIN >= 6 caracteres)
    // Usa fetch direto no endpoint de signup do Supabase para não sobrescrever a sessão ativa do coordenador
    const supabaseUrl = window.__ENV__?.SUPABASE_URL || 'https://ixhuqbfzwkobhrvlzwgm.supabase.co';
    const supabaseKey = window.__ENV__?.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4aHVxYmZ6d2tvYmhydmx6d2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjIyOTgsImV4cCI6MjA5NTU5ODI5OH0.ZtKv5X2Zxjp80Cjmvy0NzFDqadBYUvWBZHH12iD8x84';

    const signupResp = await fetch(`${supabaseUrl}/auth/v1/signup`, {
        method: 'POST',
        headers: {
            'apikey': supabaseKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            email: emailFicticio,
            password: senhaAuth,
            data: {
                nome,
                professor_id: profId,
                tipo: 'professor'
            }
        })
    });

    const signupData = await signupResp.json();

    if (!signupResp.ok || !signupData?.user?.id) {
        // Se já existia usuário e por algum motivo não foi limpo pelo reset, tenta re-executar reset e tentar de novo
        if (signupResp.status === 422) {
            try {
                await supabase.functions.invoke('resetar-acesso-professor', {
                    body: { professor_id: profId }
                });
                const retryResp = await fetch(`${supabaseUrl}/auth/v1/signup`, {
                    method: 'POST',
                    headers: { 'apikey': supabaseKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: emailFicticio, password: senhaAuth, data: { nome, professor_id: profId, tipo: 'professor' } })
                });
                const retryData = await retryResp.json();
                if (retryResp.ok && retryData?.user?.id) {
                    signupData.user = retryData.user;
                }
            } catch (_) {}
        }

        if (!signupData?.user?.id) {
            const erroMsg = signupData?.msg || signupData?.message || signupData?.error_description || 'Falha ao registrar credencial de acesso.';
            throw new Error(erroMsg);
        }
    }

    const authUserId = signupData.user.id;

    // 4. Vincula o auth_user_id e o pin na tabela 'professores'
    const { error: errUpdate } = await supabase
        .from('professores')
        .update({
            auth_user_id: authUserId,
            pin: pin
        })
        .eq('id', profId);

    if (errUpdate) {
        console.error('[PIN] Erro ao vincular auth_user_id no banco:', errUpdate);
        throw new Error('Credencial criada, mas ocorreu um erro ao salvar o vínculo com o professor.');
    }

    return { sucesso: true, metodo: 'direct_auth', authUserId };
}

window.gerenciarAcessoProfessor = async function(id, nome, temAcesso) {
    if (!await exigirAuth()) return

    const htmlModal = `
        <div class="modal-pin-wrapper">
            <div class="modal-pin-bloco">
                <div class="modal-pin-titulo">
                    <span>🔑</span> Definir Novo PIN Imediatamente
                </div>
                <div class="modal-pin-sub">
                    Digite 4 dígitos ou gere um PIN aleatório para liberar ou redefinir o acesso de <strong>${nome}</strong> na hora.
                </div>
                <div class="modal-pin-input-linha">
                    <input type="text" id="modal-input-pin" class="modal-pin-input" maxlength="4" placeholder="••••" autocomplete="off" inputmode="numeric">
                    <button type="button" id="btn-gerar-pin-modal" class="modal-pin-btn-random">
                        🎲 Gerar PIN Aleatório
                    </button>
                </div>
                <label style="font-size:0.75rem; color:var(--txt2); display:flex; align-items:center; gap:6px; cursor:pointer; margin-top:4px;">
                    <input type="checkbox" id="chk-notificar-prof" checked style="cursor:pointer;">
                    Enviar notificação push avisando sobre o novo PIN
                </label>
            </div>

            ${temAcesso ? `
            <div class="modal-pin-bloco" style="border-color: rgba(239, 68, 68, 0.25); background: rgba(239, 68, 68, 0.04);">
                <div class="modal-pin-titulo" style="color: #f87171;">
                    <span>⚠️</span> Revogar Acesso & Desconectar
                </div>
                <div class="modal-pin-sub">
                    Desconecta imediatamente as sessões ativas do professor. Ele precisará definir um novo PIN para voltar a acessar.
                </div>
                <button type="button" id="btn-revogar-acesso-modal" class="btn-acao-topo btn-acao-excluir" style="width:fit-content; padding:8px 14px;">
                    Revogar PIN e Desconectar
                </button>
            </div>
            ` : ''}
        </div>
    `

    const res = await Swal.fire({
        title: `Acesso · ${nome}`,
        html: htmlModal,
        showCancelButton: true,
        confirmButtonText: '💾 Salvar e Ativar PIN',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-sucesso, #22c55e)',
        cancelButtonColor: 'var(--texto-secundario, #6b7280)',
        focusConfirm: false,
        didOpen: () => {
            const inputPin = document.getElementById('modal-input-pin')
            const btnRandom = document.getElementById('btn-gerar-pin-modal')
            const btnRevogar = document.getElementById('btn-revogar-acesso-modal')

            if (inputPin) {
                inputPin.focus()
                inputPin.addEventListener('input', () => {
                    inputPin.value = inputPin.value.replace(/\D/g, '').slice(0, 4)
                })
            }

            if (btnRandom && inputPin) {
                btnRandom.addEventListener('click', () => {
                    const rnd = Math.floor(1000 + Math.random() * 9000).toString()
                    inputPin.value = rnd
                    inputPin.focus()
                })
            }

            if (btnRevogar) {
                btnRevogar.addEventListener('click', async () => {
                    Swal.close()
                    await executarRevogacaoAcesso(id, nome)
                })
            }
        },
        preConfirm: () => {
            const inputPin = document.getElementById('modal-input-pin')
            const chkNotificar = document.getElementById('chk-notificar-prof')
            const val = inputPin ? inputPin.value.replace(/\D/g, '') : ''
            if (val.length !== 4) {
                Swal.showValidationMessage('O PIN deve conter exatamente 4 dígitos numéricos.')
                return false
            }
            return { pin: val, notificar: chkNotificar ? chkNotificar.checked : true }
        }
    })

    if (!res.isConfirmed || !res.value) return

    const { pin: novoPin, notificar } = res.value

    Swal.fire({
        title: 'Aplicando novo PIN...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    })

    try {
        await ativarOuAtualizarPinProfessor(id, nome, novoPin)

        Swal.close()

        if (notificar) {
            enviarNotificacao(
                '🔑 Novo PIN Ativado',
                `Olá, ${nome}! Seu PIN de acesso ao Locus foi atualizado para: ${novoPin}`,
                'professor',
                id
            ).catch(() => {})
        }

        await carregarListaProfessores()

        // Tela de confirmação com cópia facilitada
        Swal.fire({
            icon: 'success',
            title: 'PIN Definido com Sucesso!',
            html: `
                <div style="font-family:'Poppins',sans-serif; text-align:center;">
                    <p style="font-size:0.86rem; color:var(--txt2); margin-bottom:12px;">
                        O código de acesso de <strong>${nome}</strong> já está ativo:
                    </p>
                    <div class="modal-copiar-box">
                        <div style="text-align:left;">
                            <div style="font-size:0.68rem; text-transform:uppercase; color:var(--txt3); font-weight:700;">PIN DE ACESSO</div>
                            <div class="badge-pin-display" id="display-novo-pin">${novoPin}</div>
                        </div>
                        <button type="button" id="btn-copiar-novo-pin" class="btn-acao-topo" style="padding:8px 14px; border-color:var(--purple); color:var(--purple); font-weight:700;">
                            📋 Copiar PIN
                        </button>
                    </div>
                    <p style="font-size:0.75rem; color:var(--txt3); margin-top:14px;">
                        O professor já pode fazer login na Área do Professor com este PIN.
                    </p>
                </div>
            `,
            confirmButtonText: 'Concluído',
            confirmButtonColor: 'var(--cor-primaria)',
            didOpen: () => {
                const btnCopiar = document.getElementById('btn-copiar-novo-pin')
                if (btnCopiar) {
                    btnCopiar.addEventListener('click', () => {
                        navigator.clipboard.writeText(novoPin).then(() => {
                            btnCopiar.textContent = '✓ Copiado!'
                            btnCopiar.style.background = 'rgba(34,197,94,0.15)'
                            btnCopiar.style.color = '#22c55e'
                            setTimeout(() => {
                                btnCopiar.textContent = '📋 Copiar PIN'
                                btnCopiar.style.background = ''
                                btnCopiar.style.color = ''
                            }, 2000)
                        }).catch(() => {
                            alert(`PIN: ${novoPin}`)
                        })
                    })
                }
            }
        })

    } catch (err) {
        Swal.close()
        console.error('Erro ao definir PIN:', err)
        dispararAlerta({
            icon: 'error',
            title: 'Erro ao configurar PIN',
            text: err.message || 'Não foi possível atualizar o PIN via servidor.',
            confirmButtonColor: 'var(--cor-perigo)'
        })
    }
}

async function executarRevogacaoAcesso(id, nome) {
    const confirmacao = await Swal.fire({
        title: 'Revogar acesso?',
        text: `"${nome}" será desconectado de todos os aparelhos e o PIN atual será cancelado.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-perigo)',
        cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: 'Sim, revogar e desconectar',
        cancelButtonText: 'Cancelar'
    })
    if (!confirmacao.isConfirmed) return

    Swal.fire({ title: 'Revogando acesso...', allowOutsideClick: false, didOpen: () => Swal.showLoading() })

    try {
        try {
            await supabase.functions.invoke('resetar-acesso-professor', {
                body: { professor_id: id }
            })
        } catch (_) {}

        // Limpa auth_user_id e pin na tabela professores
        await supabase.from('professores').update({ auth_user_id: null, pin: null }).eq('id', id)

        Swal.close()

        enviarNotificacao(
            '⚠️ Acesso Redefinido',
            `Olá, ${nome}! Seu acesso ao Locus foi redefinido pela coordenação. Cadastre um novo PIN para entrar.`,
            'professor',
            id
        )

        dispararAlerta({
            icon: 'success',
            title: 'Acesso revogado!',
            text: `${nome} foi desconectado e precisará definir um novo PIN.`,
            timer: 2500,
            showConfirmButton: false
        })

        carregarListaProfessores()

    } catch (err) {
        Swal.close()
        console.error('Erro ao revogar acesso:', err)
        dispararAlerta({
            icon: 'error',
            title: 'Erro',
            text: 'Não foi possível revogar o acesso.',
            confirmButtonColor: 'var(--cor-perigo)'
        })
    }
}

// Mantém compatibilidade com chamadas existentes de resetarAcessoProfessor
window.resetarAcessoProfessor = function(id, nome) {
    window.gerenciarAcessoProfessor(id, nome, true)
}

window.abrirModalNovoProfessor = async function() {
    if (!await exigirAuth()) return

    const disciplinas = await obterDisciplinasCache()
    const optsDisciplinas = (disciplinas || []).map(d => `<option value="${d.nome}">${d.nome}</option>`).join('')

    const htmlModal = `
        <div class="modal-pin-wrapper">
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">Nome Completo:</label>
                <input type="text" id="novo-prof-nome" class="swal2-input" placeholder="Ex: Lucas Gabriel Martins" style="margin:0; width:100%; font-size:0.86rem; box-sizing:border-box;">
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">Disciplina Principal:</label>
                <select id="novo-prof-disciplina" class="swal2-select" style="margin:0; width:100%; font-size:0.86rem; display:block; box-sizing:border-box;">
                    <option value="">Selecione a disciplina...</option>
                    ${optsDisciplinas}
                </select>
            </div>
            <div class="modal-pin-bloco">
                <div class="modal-pin-titulo">
                    <span>🔑</span> Definir PIN Inicial (Opcional)
                </div>
                <div class="modal-pin-sub">
                    Defina 4 dígitos agora para o professor já começar a usar, ou deixe vazio para que ele ative posteriormente.
                </div>
                <div class="modal-pin-input-linha">
                    <input type="text" id="novo-prof-pin" class="modal-pin-input" maxlength="4" placeholder="••••" autocomplete="off" inputmode="numeric">
                    <button type="button" id="btn-gerar-pin-novo" class="modal-pin-btn-random">
                        🎲 Gerar PIN
                    </button>
                </div>
            </div>
        </div>
    `

    const res = await Swal.fire({
        title: 'Novo Professor',
        html: htmlModal,
        showCancelButton: true,
        confirmButtonText: 'Cadastrar Professor',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-primaria)',
        cancelButtonColor: 'var(--texto-secundario)',
        didOpen: () => {
            const inputNome = document.getElementById('novo-prof-nome')
            const inputPin = document.getElementById('novo-prof-pin')
            const btnRandom = document.getElementById('btn-gerar-pin-novo')

            if (inputNome) inputNome.focus()
            if (inputPin) {
                inputPin.addEventListener('input', () => {
                    inputPin.value = inputPin.value.replace(/\D/g, '').slice(0, 4)
                })
            }
            if (btnRandom && inputPin) {
                btnRandom.addEventListener('click', () => {
                    inputPin.value = Math.floor(1000 + Math.random() * 9000).toString()
                })
            }
        },
        preConfirm: () => {
            const nomeRaw = document.getElementById('novo-prof-nome')?.value.trim() || ''
            const disciplina = document.getElementById('novo-prof-disciplina')?.value || ''
            const pinRaw = document.getElementById('novo-prof-pin')?.value.replace(/\D/g, '') || ''

            if (!nomeRaw || nomeRaw.length < 3) {
                Swal.showValidationMessage('Digite o nome completo do professor (mínimo 3 caracteres).')
                return false
            }
            if (!disciplina) {
                Swal.showValidationMessage('Selecione uma disciplina.')
                return false
            }
            if (pinRaw && pinRaw.length !== 4) {
                Swal.showValidationMessage('O PIN inicial deve conter exatamente 4 dígitos (ou deixe em branco).')
                return false
            }

            return { nome: nomeRaw, disciplina, pin: pinRaw || null }
        }
    })

    if (!res.isConfirmed || !res.value) return

    const { nome, disciplina, pin } = res.value

    Swal.fire({
        title: 'Cadastrando professor...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    })

    try {
        // Verifica se já existe com esse nome
        const { data: existente } = await supabase
            .from('professores')
            .select('id, nome')
            .ilike('nome', nome)
            .maybeSingle()

        if (existente?.id) {
            Swal.close()
            dispararAlerta({
                icon: 'warning',
                title: 'Professor já existente',
                text: `Já existe um professor cadastrado com o nome "${nome}".`,
                confirmButtonColor: 'var(--cor-aviso)'
            })
            return
        }

        // Insere professor
        const { data: novoProf, error: errInsert } = await supabase
            .from('professores')
            .insert([{ nome, disciplina, auth_user_id: null }])
            .select('id')
            .single()

        if (errInsert || !novoProf) throw errInsert || new Error('Falha ao cadastrar')

        let pinAtivadoComSucesso = false
        if (pin) {
            try {
                await ativarOuAtualizarPinProfessor(novoProf.id, nome, pin)
                pinAtivadoComSucesso = true
            } catch (errAtivar) {
                console.warn('Falha ao ativar PIN imediato:', errAtivar)
            }
        }

        Swal.close()
        await carregarListaProfessores()
        carregarProfessoresNoFiltro()

        if (pin && pinAtivadoComSucesso) {
            Swal.fire({
                icon: 'success',
                title: 'Professor Cadastrado!',
                html: `
                    <div style="font-family:'Poppins',sans-serif; text-align:center;">
                        <p style="font-size:0.86rem; color:var(--txt2); margin-bottom:12px;">
                            <strong>${nome}</strong> foi adicionado(a) e seu PIN já está pronto para uso:
                        </p>
                        <div class="modal-copiar-box">
                            <div style="text-align:left;">
                                <div style="font-size:0.68rem; text-transform:uppercase; color:var(--txt3); font-weight:700;">PIN DE ACESSO</div>
                                <div class="badge-pin-display">${pin}</div>
                            </div>
                            <button type="button" id="btn-copiar-pin-cad" class="btn-acao-topo" style="padding:8px 14px; border-color:var(--purple); color:var(--purple); font-weight:700;">
                                📋 Copiar PIN
                            </button>
                        </div>
                    </div>
                `,
                confirmButtonText: 'Entendido',
                confirmButtonColor: 'var(--cor-primaria)',
                didOpen: () => {
                    const btnCopiar = document.getElementById('btn-copiar-pin-cad')
                    if (btnCopiar) {
                        btnCopiar.addEventListener('click', () => {
                            navigator.clipboard.writeText(pin).then(() => {
                                btnCopiar.textContent = '✓ Copiado!'
                                setTimeout(() => btnCopiar.textContent = '📋 Copiar PIN', 2000)
                            })
                        })
                    }
                }
            })
        } else {
            dispararAlerta({
                icon: 'success',
                title: 'Professor cadastrado!',
                text: `${nome} foi adicionado à lista.${pin ? ' O PIN poderá ser configurado a qualquer momento.' : ''}`,
                timer: 2200,
                showConfirmButton: false
            })
        }

    } catch (err) {
        Swal.close()
        console.error('Erro ao cadastrar professor:', err)
        dispararAlerta({
            icon: 'error',
            title: 'Erro ao cadastrar',
            text: err.message || 'Tente novamente.',
            confirmButtonColor: 'var(--cor-perigo)'
        })
    }
}

window.excluirProfessor = async function(id, nome) {
    if (!await exigirAuth()) return;

    const { data: vinculos, count } = await supabase
        .from('agendamentos')
        .select('id', { count: 'exact' })
        .eq('professor_id', id);

    const total = count ?? (vinculos ? vinculos.length : 0);

    let textoConfirmacao = `Tem certeza que deseja excluir "${nome}"? Esta ação não pode ser desfeita.`;
    let textoBotao = 'Sim, excluir!';

    if (total > 0) {
        textoConfirmacao = `"${nome}" possui ${total} agendamento(s) vinculado(s). Ao confirmar, suas reservas serão canceladas e o acesso será removido definitivamente. Deseja prosseguir?`;
        textoBotao = 'Sim, excluir professor e agendamentos!';
    }

    const confirmacao = await Swal.fire({
        title: 'Excluir professor?',
        text: textoConfirmacao,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-perigo)',
        cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: textoBotao,
        cancelButtonText: 'Cancelar'
    });
    if (!confirmacao.isConfirmed) return;

    Swal.fire({ title: 'Excluindo professor...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    // Revoga acesso Auth do professor antes de deletar do banco
    try {
        await supabase.functions.invoke('resetar-acesso-professor', {
            body: { professor_id: id }
        });
    } catch (_) {}

    if (total > 0) {
        const { error: errAgendamentos } = await supabase
            .from('agendamentos')
            .delete()
            .eq('professor_id', id);

        if (errAgendamentos) {
            console.warn('Não foi possível remover agendamentos antes de excluir professor:', errAgendamentos);
        }
    }

    // RLS: professores_delete_coord
    const { error } = await supabase.from('professores').delete().eq('id', id);
    Swal.close();

    if (error) {
        dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível excluir o professor.', confirmButtonColor: 'var(--cor-perigo)' });
        return;
    }

    dispararAlerta({ icon: 'success', title: 'Excluído!', text: `Professor "${nome}" foi excluído com sucesso.`, timer: 1500, showConfirmButton: false });
    carregarListaProfessores();
    carregarProfessoresNoFiltro();
    carregarRelatorioGeral();
}

// ============================================================
//  REALTIME
// ============================================================

supabase
    .channel('mudancas-agendamentos-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, async () => {
        if (await estaAutenticado()) carregarRelatorioGeral()
    })
    .subscribe()

supabase
    .channel('mudancas-professores-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'professores' }, async () => {
        if (!await estaAutenticado()) return
        const painel = document.getElementById('painel-aba-professores')
        if (painel && !painel.classList.contains('oculto')) {
            carregarSolicitacoes()
            carregarListaProfessores()
        }
        carregarProfessoresNoFiltro()
    })
    .subscribe()

supabase
    .channel('mudancas-solicitacoes-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'solicitacoes_acesso' }, async () => {
        if (!await estaAutenticado()) return
        const painel = document.getElementById('painel-aba-professores')
        if (painel && !painel.classList.contains('oculto')) {
            carregarSolicitacoes()
        }
        atualizarBadgePendentes()
    })
    .subscribe()

supabase
    .channel('mudancas-salas-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'salas' }, async () => {
        if (!await estaAutenticado()) return
        const painel = document.getElementById('painel-aba-salas-turmas')
        if (painel && !painel.classList.contains('oculto')) {
            carregarListaSalas()
        }
        carregarSalasNoFiltro()
    })
    .subscribe()

supabase
    .channel('mudancas-turmas-coord')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'turmas' }, async () => {
        if (!await estaAutenticado()) return
        const painel = document.getElementById('painel-aba-salas-turmas')
        if (painel && !painel.classList.contains('oculto')) {
            carregarListaTurmas()
        }
    })
    .subscribe()

