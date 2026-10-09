/* coordenacao.js — autenticação via Supabase Auth */
import { supabase, registrarServiceWorker, dispararAlerta, detectarTurnoTurma, obterHorarioAula, formatarData, getAgoraBrasilia, checarBloqueioLogin, registrarFalhaLogin, resetarTentativasLogin, vibrarSucesso, vibrarErro, vibrarClique } from './utils.js'
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
window.modoDataRapido = 'hoje' // 'hoje' | 'amanha' | 'semana' | 'todas' | 'personalizado'

/**
 * Formata um número de telefone brasileiro para o formato internacional aceito pelo WhatsApp (55 + DDD + número)
 */
export function formatarTelefoneInternacional(tel) {
    if (!tel) return ''
    const limpo = String(tel).replace(/\D/g, '')
    if (!limpo) return ''
    if ((limpo.length === 12 || limpo.length === 13) && limpo.startsWith('55')) {
        return limpo
    }
    if (limpo.length === 10 || limpo.length === 11) {
        return `55${limpo}`
    }
    return limpo
}

/**
 * Formata número para exibição amigável: (XX) 9XXXX-XXXX ou (XX) XXXX-XXXX
 */
export function formatarTelefoneExibicao(tel) {
    if (!tel) return ''
    let d = String(tel).replace(/\D/g, '')
    if ((d.length === 12 || d.length === 13) && d.startsWith('55')) {
        d = d.slice(2)
    }
    if (d.length === 11) {
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    }
    if (d.length === 10) {
        return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
    }
    return tel
}

/**
 * Aplica máscara dinâmica em inputs de telefone: (XX) 9XXXX-XXXX
 */
export function aplicarMascaraTelefoneInput(inputEl) {
    if (!inputEl) return
    inputEl.addEventListener('input', () => {
        let v = inputEl.value.replace(/\D/g, '')
        if (v.length > 11) v = v.slice(0, 11)
        if (v.length > 6) {
            v = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`
        } else if (v.length > 2) {
            v = `(${v.slice(0, 2)}) ${v.slice(2)}`
        } else if (v.length > 0) {
            v = `(${v}`
        }
        inputEl.value = v
    })
}

/**
 * Gera mensagem educada e formatada para envio do PIN via WhatsApp
 */
export function gerarMensagemWhatsAppProfessor(nomeProf, pinAcesso) {
    const primeiroNome = (nomeProf || 'Professor').split(' ')[0]
    const urlApp = new URL('professor.html', window.location.href).href
    return `Olá Prof. ${primeiroNome}!\n\nSeu acesso ao sistema *Locus* (agendamento de salas) foi liberado pela coordenação.\n\n🔑 *Seu PIN de acesso:* ${pinAcesso}\n🔗 *Acesse por aqui:* ${urlApp}\n\nQualquer dúvida estamos à disposição da coordenação!`
}

window.abrirWhatsAppComPin = function(nomeProf, pinAcesso, telefone = null) {
    const msg = gerarMensagemWhatsAppProfessor(nomeProf, pinAcesso)
    const telInt = formatarTelefoneInternacional(telefone)
    const link = telInt
        ? `https://api.whatsapp.com/send?phone=${telInt}&text=${encodeURIComponent(msg)}`
        : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`
    window.open(link, '_blank')
}

window.copiarMensagemWhatsApp = function(nomeProf, pinAcesso, btnEl) {
    const msg = gerarMensagemWhatsAppProfessor(nomeProf, pinAcesso)
    navigator.clipboard.writeText(msg).then(() => {
        if (btnEl) {
            const txtAntigo = btnEl.innerHTML
            btnEl.innerHTML = '✓ Mensagem copiada!'
            btnEl.style.background = 'rgba(34,197,94,0.18)'
            btnEl.style.color = '#22c55e'
            setTimeout(() => {
                btnEl.innerHTML = txtAntigo
                btnEl.style.background = ''
                btnEl.style.color = ''
            }, 2000)
        }
    }).catch(() => alert(msg))
}

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
    const statusRL = checarBloqueioLogin('coord');
    if (statusRL.bloqueado) {
        dispararAlerta({
            icon: 'error',
            title: 'Acesso Temporariamente Bloqueado',
            text: `Limite de 5 tentativas incorretas atingido. Por segurança, aguarde ${statusRL.segundosRestantes} segundos antes de tentar novamente.`,
            confirmButtonColor: 'var(--cor-perigo)'
        });
        return;
    }

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
            vibrarErro();
            const falhaRL = registrarFalhaLogin('coord');
            if (falhaRL.bloqueado) {
                dispararAlerta({
                    icon: 'error',
                    title: 'Bloqueio de Segurança Ativado',
                    text: `Você errou a senha 5 vezes consecutivas. O acesso à coordenação foi bloqueado por 1 minuto (${falhaRL.segundosRestantes}s).`,
                    confirmButtonColor: 'var(--cor-perigo)'
                });
            } else {
                dispararAlerta({
                    icon: 'error',
                    title: 'Acesso Negado',
                    text: `Senha incorreta. Tentativa ${falhaRL.tentativas} de 5.`,
                    confirmButtonColor: 'var(--cor-perigo)'
                });
            }
            return;
        }

        // Sucesso: zera o contador de tentativas
        resetarTentativasLogin('coord');
        vibrarSucesso();
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

window.selecionarFiltroDataRapido = function(modo) {
    window.modoDataRapido = modo
    const fData = document.getElementById('filtroData')
    const hoje = getAgoraBrasilia()

    ;['hoje', 'amanha', 'semana', 'todas'].forEach(m => {
        const btn = document.getElementById(`btn-data-${m}`)
        if (btn) btn.classList.toggle('ativo', m === modo)
    })

    if (modo === 'hoje') {
        if (fData) fData.value = formatarData(hoje)
    } else if (modo === 'amanha') {
        const amanha = new Date(hoje)
        amanha.setDate(amanha.getDate() + 1)
        if (fData) fData.value = formatarData(amanha)
    } else if (modo === 'semana') {
        if (fData) fData.value = ''
    } else if (modo === 'todas') {
        if (fData) fData.value = ''
    }
    carregarRelatorioGeral()
}

function mostrarDashboard() {
    document.getElementById('secao-login-coord').style.display = 'none'
    document.getElementById('secao-dashboard').classList.add('visivel')

    const hoje = getAgoraBrasilia()
    const inputData = document.getElementById('filtroData')
    if (inputData) inputData.value = formatarData(hoje)
    window.modoDataRapido = 'hoje'

    // Carrega dados dos filtros (requerem sessão ativa para professores completos)
    carregarSalasNoFiltro()
    carregarProfessoresNoFiltro()
    carregarDisciplinasNoPreCadastro()

    // Listeners do relatório — registrados aqui para não disparar antes do login
    const fData      = document.getElementById('filtroData')
    const fSala      = document.getElementById('filtroSala')
    const fProfessor = document.getElementById('filtroProfessor')
    const fTurno     = document.getElementById('filtroTurno')
    if (fData) {
        fData.addEventListener('change', () => {
            window.modoDataRapido = 'personalizado'
            ;['hoje', 'amanha', 'semana', 'todas'].forEach(m => {
                const btn = document.getElementById(`btn-data-${m}`)
                if (btn) btn.classList.remove('ativo')
            })
            carregarRelatorioGeral()
        })
    }
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
        if (badge) {
            if (total > 0) {
                badge.textContent = total; badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
        if (badgeNav) {
            badgeNav.textContent = total; badgeNav.style.display = total > 0 ? 'inline-flex' : 'none';
        }
        if (qtdSolicitacoes) {
            qtdSolicitacoes.textContent = total;
        }

        const bannerAlerta = document.getElementById('banner-alerta-solicitacoes');
        const qtdAlerta = document.getElementById('qtd-sol-alerta');
        if (bannerAlerta && qtdAlerta) {
            qtdAlerta.textContent = total;
            bannerAlerta.style.display = total > 0 ? 'flex' : 'none';
        }
    } catch (e) { /* silencioso */ }
}

async function carregarSolicitacoes() {
    const lista = document.getElementById('lista-solicitacoes')
    const badge = document.getElementById('badge-pendentes')
    const badgeNav = document.getElementById('badge-nav-professores')
    const qtdSolicitacoes = document.getElementById('qtd-solicitacoes-total')
    const blocoSol = document.getElementById('bloco-solicitacoes')
    if (!lista) return

    try {
        const { data, error } = await supabase
            .from('solicitacoes_acesso')
            .select('*')
            .eq('status', 'pendente')
            .order('criado_em', { ascending: true })

        if (error) throw error

        const total = data?.length || 0
        if (badge) {
            badge.textContent = total
            badge.style.display = total > 0 ? 'inline-flex' : 'none'
        }
        if (badgeNav) {
            badgeNav.textContent = total
            badgeNav.style.display = total > 0 ? 'inline-flex' : 'none'
        }
        if (qtdSolicitacoes) {
            qtdSolicitacoes.textContent = total
        }

        const bannerAlerta = document.getElementById('banner-alerta-solicitacoes');
        const qtdAlerta = document.getElementById('qtd-sol-alerta');
        if (bannerAlerta && qtdAlerta) {
            qtdAlerta.textContent = total;
            bannerAlerta.style.display = total > 0 ? 'flex' : 'none';
        }

        const kpiSol = document.getElementById('kpi-prof-solicitacoes')
        const kpiBadge = document.getElementById('kpi-badge-alerta')
        if (kpiSol) kpiSol.textContent = total
        if (kpiBadge) kpiBadge.style.display = total > 0 ? 'inline-flex' : 'none'

        // Se não houver solicitações, mantém a tela limpa e sem poluição
        if (!data || data.length === 0) {
            if (blocoSol) blocoSol.style.display = 'none'
            lista.innerHTML = ''
            return
        }

        // Se houver solicitações, exibe o banner em destaque acolhedor
        if (blocoSol) blocoSol.style.display = 'block'

        lista.innerHTML = ''
        data.forEach(s => {
            const dataFmt = new Date(s.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })

            const card = document.createElement('div')
            card.className = 'solicitacao-card'
            card.id = `sol-${s.id}`

            const info = document.createElement('div')
            info.className = 'solicitacao-info'

            const nome = document.createElement('div')
            nome.className = 'solicitacao-nome'
            nome.textContent = s.nome

            const meta = document.createElement('div')
            meta.className = 'solicitacao-meta'
            const telTag = s.telefone ? `<span class="solicitacao-tel-tag" title="WhatsApp informado">📱 ${formatarTelefoneExibicao(s.telefone)}</span>` : ''
            meta.innerHTML = `<span class="solicitacao-disc-tag">📚 ${s.disciplina || 'Geral'}</span> ${telTag} <span>· Pedido em ${dataFmt}</span>`

            info.appendChild(nome)
            info.appendChild(meta)

            const acoes = document.createElement('div')
            acoes.className = 'solicitacao-acoes'

            const btnAprovar = document.createElement('button')
            btnAprovar.className = 'btn-aprovar'
            btnAprovar.type = 'button'
            btnAprovar.innerHTML = '✓ Liberar Acesso'
            btnAprovar.addEventListener('click', () => aprovarSolicitacao(s.id, s.nome, s.disciplina, s.pin, s.telefone, 'manha'))

            const btnRejeitar = document.createElement('button')
            btnRejeitar.className = 'btn-rejeitar'
            btnRejeitar.type = 'button'
            btnRejeitar.innerHTML = '✕ Recusar'
            btnRejeitar.addEventListener('click', () => rejeitarSolicitacao(s.id, s.nome))

            acoes.appendChild(btnAprovar)
            acoes.appendChild(btnRejeitar)

            card.appendChild(info)
            card.appendChild(acoes)
            lista.appendChild(card)
        })

    } catch (err) {
        console.error('Erro ao carregar solicitações:', err)
        if (blocoSol) blocoSol.style.display = 'none'
    }
}

async function aprovarSolicitacao(id, nome, disciplina, pin, telefone = null, turno = 'manha') {
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
            const updatePayload = { disciplina }
            if (telefone) updatePayload.telefone = telefone
            if (turno) updatePayload.turno = turno
            try {
                await supabase.from('professores').update(updatePayload).eq('id', profId)
            } catch (errUp) {
                if (errUp?.code === '42703' || String(errUp?.message).includes('turno') || String(errUp?.message).includes('telefone')) {
                    const fallbackUp = { disciplina }
                    if (telefone && !String(errUp?.message).includes('telefone')) fallbackUp.telefone = telefone
                    await supabase.from('professores').update(fallbackUp).eq('id', profId)
                } else {
                    throw errUp
                }
            }
        } else {
            const insertPayload = { nome, disciplina, auth_user_id: null, turno: turno || 'manha' }
            if (telefone) insertPayload.telefone = telefone
            let { data: prof, error: errProf } = await supabase
                .from('professores')
                .insert([insertPayload])
                .select('id')
                .single()

            if (errProf && (errProf.code === '42703' || String(errProf.message).includes('turno') || String(errProf.message).includes('telefone'))) {
                const fallbackInsert = { nome, disciplina, auth_user_id: null }
                if (telefone && !String(errProf?.message).includes('telefone')) fallbackInsert.telefone = telefone
                const fallback = await supabase
                    .from('professores')
                    .insert([fallbackInsert])
                    .select('id')
                    .single()
                prof = fallback.data
                errProf = fallback.error
            }

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
        let { error: errUpdate } = await supabase
            .from('solicitacoes_acesso')
            .update({ status: 'aprovado', atualizado_em: new Date().toISOString() })
            .eq('id', id)

        if (errUpdate && errUpdate.code === '42703') {
            await supabase
                .from('solicitacoes_acesso')
                .update({ status: 'aprovado' })
                .eq('id', id)
        }

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

        vibrarSucesso()
        Swal.fire({
            icon: 'success',
            title: 'Professor(a) Aprovado(a)!',
            html: `
                <div style="font-family:'Poppins',sans-serif; text-align:center;">
                    <p style="font-size:0.86rem; color:var(--txt2); margin-bottom:12px;">
                        O acesso de <strong>${nome}</strong> (${disciplina}) foi ativado com o PIN:
                    </p>
                    <div class="modal-copiar-box" style="margin-bottom:14px;">
                        <div style="text-align:left;">
                            <div style="font-size:0.68rem; text-transform:uppercase; color:var(--txt3); font-weight:700;">PIN DE ACESSO</div>
                            <div class="badge-pin-display">${pin}</div>
                        </div>
                        <button type="button" id="btn-copiar-pin-aprovado" class="btn-acao-topo" style="padding:8px 14px; border-color:var(--purple); color:var(--purple); font-weight:700;">
                            📋 Copiar PIN
                        </button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
                        <button type="button" id="btn-zap-aprovado" class="btn-whatsapp-rapido" style="width:100%; justify-content:center;">
                            <span>📱</span> Enviar Acesso via WhatsApp ${telefone ? `(${formatarTelefoneExibicao(telefone)})` : ''}
                        </button>
                        <button type="button" id="btn-copiar-msg-aprovado" class="btn-acao-topo" style="width:100%; justify-content:center; padding:9px 12px; font-size:0.8rem;">
                            📋 Copiar Mensagem Pronta
                        </button>
                    </div>
                </div>
            `,
            confirmButtonText: 'Concluído',
            confirmButtonColor: 'var(--cor-primaria)',
            didOpen: () => {
                const btnCopiar = document.getElementById('btn-copiar-pin-aprovado')
                const btnZap = document.getElementById('btn-zap-aprovado')
                const btnCopiarMsg = document.getElementById('btn-copiar-msg-aprovado')

                if (btnCopiar) {
                    btnCopiar.addEventListener('click', () => {
                        navigator.clipboard.writeText(pin).then(() => {
                            btnCopiar.textContent = '✓ Copiado!'
                            setTimeout(() => { if (btnCopiar) btnCopiar.textContent = '📋 Copiar PIN' }, 2000)
                        }).catch(() => alert(`PIN: ${pin}`))
                    })
                }
                if (btnZap) {
                    btnZap.addEventListener('click', () => {
                        window.abrirWhatsAppComPin(nome, pin, telefone)
                    })
                }
                if (btnCopiarMsg) {
                    btnCopiarMsg.addEventListener('click', () => {
                        window.copiarMensagemWhatsApp(nome, pin, btnCopiarMsg)
                    })
                }
            }
        })

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
        let { error: errUpdate } = await supabase
            .from('solicitacoes_acesso')
            .update({ status: 'rejeitado', atualizado_em: new Date().toISOString() })
            .eq('id', id)

        if (errUpdate && errUpdate.code === '42703') {
            await supabase
                .from('solicitacoes_acesso')
                .update({ status: 'rejeitado' })
                .eq('id', id)
        }

        document.getElementById(`sol-${id}`)?.remove()
        carregarSolicitacoes()

        enviarNotificacao(
            '❌ Solicitação não aprovada',
            `${nome}, sua solicitação de acesso ao Locus não foi aprovada. Entre em contato com a coordenação.`,
            'coordenacao'
        )

        vibrarClique()
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
    const tabela          = document.getElementById('listaAgendamentos')
    const buscaRapida     = document.getElementById('busca-rapida-reservas')

    if (!filtroData || !tabela) return

    const dataFiltro      = filtroData.value
    const salaFiltro      = filtroSala?.value || ''
    const professorFiltro = filtroProfessor?.value || ''

    tabela.innerHTML = ''
    dadosAtuaisParaExportar = []

    tabela.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--texto-secundario)">Carregando agendamentos...</td></tr>`

    const hojeObj = getAgoraBrasilia()
    const hojeIso = formatarData(hojeObj)

    let query = supabase
        .from('agendamentos')
        .select('id, data, aula_numero, professor_id, salas(nome), professores(nome), turmas(nome)')

    // Aplica estratégia de data conforme modo rápido ou campo datepicker
    if (window.modoDataRapido === 'semana') {
        const diaSemana = hojeObj.getDay() // 0 Dom, 1 Seg, ..., 6 Sab
        const distSeg = diaSemana === 0 ? -6 : 1 - diaSemana
        const segObj = new Date(hojeObj)
        segObj.setDate(hojeObj.getDate() + distSeg)
        const sexObj = new Date(segObj)
        sexObj.setDate(segObj.getDate() + 4)
        query = query.gte('data', formatarData(segObj)).lte('data', formatarData(sexObj))
    } else if (window.modoDataRapido === 'todas') {
        // Exibe todas as reservas (sem restringir por data mínima)
    } else if (dataFiltro) {
        query = query.eq('data', dataFiltro)
    } else {
        query = query.gte('data', hojeIso)
    }

    if (salaFiltro)      query = query.eq('sala_id', salaFiltro)
    if (professorFiltro) query = query.eq('professor_id', professorFiltro)

    const ordemAsc = window.modoDataRapido !== 'todas'
    const { data: agendamentos, error } = await query
        .order('data', { ascending: ordemAsc })
        .order('aula_numero', { ascending: true })

    if (error) {
        dispararAlerta({ icon: 'error', title: 'Erro de carregamento', text: 'Não foi possível buscar os agendamentos.', confirmButtonColor: 'var(--cor-perigo)' })
        return
    }

    let agendamentosFiltrados = agendamentos || []

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

        const horario = obterHorarioAula(item.aula_numero)

        const tdAula = document.createElement('td')
        const badge = document.createElement('span')
        badge.className = 'badge-aula badge-turno-manha'
        badge.textContent = `Aula ${item.aula_numero}ª (${horario.inicio}–${horario.fim})`
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

    // Se houver busca em tempo real ativa, reaplica o filtro
    if (buscaRapida && buscaRapida.value.trim()) {
        window.filtrarTabelaReservasEmTempoReal(buscaRapida.value)
    }
}

window.filtrarTabelaReservasEmTempoReal = function(termo) {
    const termoNorm = (termo || '').toLowerCase().trim()
    const linhas = document.querySelectorAll('#listaAgendamentos tr')
    let visiveis = 0
    let totalValidas = 0

    linhas.forEach(tr => {
        if (tr.querySelector('.tabela-vazio-container')) return
        totalValidas++
        const texto = tr.textContent.toLowerCase()
        const match = texto.includes(termoNorm)
        tr.style.display = match ? '' : 'none'
        if (match) visiveis++
    })

    const qtdEl = document.getElementById('qtd-total')
    if (qtdEl) {
        if (termoNorm && totalValidas > 0) {
            qtdEl.innerText = `${visiveis} de ${dadosAtuaisParaExportar.length}`
        } else {
            qtdEl.innerText = dadosAtuaisParaExportar.length
        }
    }
}

window.limparFiltros = function() {
    const filtroSala      = document.getElementById('filtroSala')
    const filtroProfessor = document.getElementById('filtroProfessor')
    const buscaRapida     = document.getElementById('busca-rapida-reservas')

    if (filtroSala)       filtroSala.value = ''
    if (filtroProfessor)  filtroProfessor.value = ''
    if (buscaRapida)      buscaRapida.value = ''

    window.selecionarFiltroDataRapido('hoje')
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
        vibrarClique()
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

        const cabecalho = ['Data', 'Aula', 'Horário Início', 'Horário Fim', 'Sala / Local', 'Professor', 'Turma']
        const linhas = [cabecalho.map(escapeCSV).join(';')]

        dadosAtuaisParaExportar.forEach(item => {
            const dataBr    = item.data.split('-').reverse().join('/')
            const horario   = obterHorarioAula(item.aula_numero)
            const nomeSala  = item.salas?.nome || 'Não informada'
            const nomeProf  = item.professores?.nome || 'Desconhecido'
            const nomeTurma = item.turmas?.nome || 'Geral'

            const linha = [
                dataBr,
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
        const sufixoData  = filtroData || formatarData(new Date())
        const nomeArquivo = `locus-agendamentos-${sufixoData}.csv`

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

window.filtrarReservasPorProfessor = function(profId, nomeProf) {
    window.mudarAbaPrincipal('reservas')

    // 1. Ativa 'todas' para exibir todas as reservas do professor sem travar na data de hoje
    window.modoDataRapido = 'todas'
    ;['hoje', 'amanha', 'semana', 'todas'].forEach(m => {
        const btn = document.getElementById(`btn-data-${m}`)
        if (btn) btn.classList.toggle('ativo', m === 'todas')
    })
    const fData = document.getElementById('filtroData')
    if (fData) fData.value = ''

    // 2. Localiza e seleciona o professor no dropdown
    const fProf = document.getElementById('filtroProfessor')
    if (fProf) {
        if (profId) {
            fProf.value = profId
        } else if (nomeProf) {
            for (let opt of fProf.options) {
                if (opt.text.toLowerCase().trim() === nomeProf.toLowerCase().trim() || opt.value.toLowerCase().trim() === nomeProf.toLowerCase().trim()) {
                    fProf.value = opt.value
                    break
                }
            }
        }
    }

    // 3. Limpa filtros de sala e turno para mostrar todas as aulas dele
    const fSala = document.getElementById('filtroSala')
    if (fSala) fSala.value = ''
    const fTurno = document.getElementById('filtroTurno')
    if (fTurno) fTurno.value = ''

    // 4. Executa a busca atualizada
    carregarRelatorioGeral()
}

window.abrirHistoricoProfessor = async function(profId, nomeProf) {
    if (!profId) return

    Swal.fire({
        title: 'Buscando histórico...',
        html: `Consultando os agendamentos do(a) <strong>Prof. ${nomeProf}</strong>...`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    })

    try {
        const { data: agendamentos, error } = await supabase
            .from('agendamentos')
            .select('id, data, aula_numero, salas(nome), turmas(nome)')
            .eq('professor_id', profId)
            .order('data', { ascending: false })
            .order('aula_numero', { ascending: true })

        if (error) throw error

        if (!agendamentos || agendamentos.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'Nenhum Agendamento',
                text: `O(A) Prof. ${nomeProf} não possui agendamentos registrados no sistema.`,
                confirmButtonColor: 'var(--cor-primaria)'
            })
            return
        }

        const hojeIso = formatarData(new Date())
        const total = agendamentos.length
        const futuras = agendamentos.filter(a => a.data >= hojeIso).length
        const passadas = total - futuras

        const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

        const itensHtml = agendamentos.map(item => {
            const [ano, mes, dia] = item.data.split('-').map(Number)
            const dtObj = new Date(ano, mes - 1, dia)
            const diaSemana = diasSemana[dtObj.getDay()] || ''
            const dataFormatada = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`

            let statusTag = ''
            if (item.data === hojeIso) {
                statusTag = '<span class="status-reserva-badge hoje">🟢 Hoje</span>'
            } else if (item.data > hojeIso) {
                statusTag = '<span class="status-reserva-badge futura">🔵 Agendada</span>'
            } else {
                statusTag = '<span class="status-reserva-badge passada">⚪ Realizada</span>'
            }

            const salaNome = item.salas?.nome || 'Sala Geral'
            const turmaNome = item.turmas?.nome || 'Sem turma'

            return `
                <div class="historico-item-card ${item.data === hojeIso ? 'destaque-hoje' : ''}">
                    <div class="historico-item-topo">
                        <div class="historico-item-data">
                            <strong>📅 ${dataFormatada}</strong>
                            <span class="historico-item-diasemana">${diaSemana}</span>
                        </div>
                        ${statusTag}
                    </div>
                    <div class="historico-item-detalhes">
                        <div class="historico-item-detalhe">
                            <span class="historico-item-label">🏫 Sala</span>
                            <span class="historico-item-valor" title="${salaNome}">${salaNome}</span>
                        </div>
                        <div class="historico-item-detalhe">
                            <span class="historico-item-label">👥 Turma</span>
                            <span class="historico-item-valor" title="${turmaNome}">${turmaNome}</span>
                        </div>
                        <div class="historico-item-detalhe">
                            <span class="historico-item-label">⏰ Horário</span>
                            <span class="historico-item-valor">${item.aula_numero}ª Aula</span>
                        </div>
                    </div>
                </div>
            `
        }).join('')

        const modalHtml = `
            <div class="historico-prof-modal-container">
                <div class="historico-prof-resumo">
                    <div class="resumo-chip total">
                        <span class="resumo-chip-num">${total}</span>
                        <span class="resumo-chip-label">Total</span>
                    </div>
                    <div class="resumo-chip futuras">
                        <span class="resumo-chip-num">${futuras}</span>
                        <span class="resumo-chip-label">Hoje / Futuras</span>
                    </div>
                    <div class="resumo-chip passadas">
                        <span class="resumo-chip-num">${passadas}</span>
                        <span class="resumo-chip-label">Realizadas</span>
                    </div>
                </div>

                <div class="historico-prof-lista-scroll">
                    ${itensHtml}
                </div>
            </div>
        `

        Swal.fire({
            title: `Histórico — ${nomeProf}`,
            html: modalHtml,
            width: '560px',
            showCancelButton: true,
            cancelButtonText: 'Fechar',
            confirmButtonText: '📊 Ver na Tabela Geral',
            confirmButtonColor: 'var(--cor-primaria, #dc3c3c)',
            cancelButtonColor: 'var(--surface2, #160d2c)',
            customClass: {
                popup: 'modal-historico-popup'
            }
        }).then(result => {
            if (result.isConfirmed) {
                window.filtrarReservasPorProfessor(profId, nomeProf)
            }
        })

    } catch (err) {
        console.error('Erro ao buscar histórico do professor:', err)
        Swal.fire({
            icon: 'error',
            title: 'Erro ao carregar',
            text: 'Não foi possível buscar as reservas deste professor.',
            confirmButtonColor: 'var(--cor-perigo)'
        })
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

        detalhes.appendChild(nome)
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
    if (!error && data) disciplinasCache = data.map(d => ({ ...d, nome: d.nome ? d.nome.trim() : '' }))
    return disciplinasCache
}

async function carregarListaProfessores() {
    const container = document.getElementById('lista-professores')
    if (!container) return
    container.innerHTML = '<div class="gerenciar-vazio">Carregando professores...</div>'

    // Busca professores com colunas 'telefone' e 'turno' de forma resiliente
    const buscarProfessores = async () => {
        const res = await supabase.from('professores').select('id, nome, disciplina, auth_user_id, pin, telefone, turno').order('nome', { ascending: true })
        if (res.error && (res.error.code === '42703' || String(res.error.message).includes('turno'))) {
            const resSemTurno = await supabase.from('professores').select('id, nome, disciplina, auth_user_id, pin, telefone').order('nome', { ascending: true })
            if (resSemTurno.error && (resSemTurno.error.code === '42703' || String(resSemTurno.error.message).includes('telefone'))) {
                return await supabase.from('professores').select('id, nome, disciplina, auth_user_id, pin').order('nome', { ascending: true })
            }
            return resSemTurno
        }
        return res
    }

    const [{ data: professores, error }, disciplinas, { data: agendamentosData }] = await Promise.all([
        buscarProfessores(),
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
        selectFiltro.innerHTML = '<option value="">Todas as matérias</option>'
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
            contadorEl.textContent = `Exibindo ${filtrados.length} de ${cacheProfessores.length} professores`
        } else {
            contadorEl.textContent = `${cacheProfessores.length} professor${cacheProfessores.length === 1 ? '' : 'es'} cadastrado${cacheProfessores.length === 1 ? '' : 's'}`
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

// Paleta dinâmica de gradientes suaves para os avatares do corpo docente
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
        container.innerHTML = `<div class="gerenciar-vazio" style="grid-column: 1 / -1; padding: 42px 16px; text-align: center;">
            <div style="font-size: 2.2rem; margin-bottom: 8px;">🔍</div>
            <div style="font-weight: 700; font-size: 1rem; color: var(--txt);">
                ${isFiltrado ? 'Nenhum professor encontrado com esse nome ou matéria.' : 'Nenhum professor cadastrado ainda.'}
            </div>
            <div style="font-size: 0.82rem; color: var(--txt3); margin-top: 4px;">
                ${isFiltrado ? 'Tente buscar com outras palavras ou limpe a pesquisa.' : 'Clique no botão "+ Cadastrar Professor" acima para adicionar.'}
            </div>
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
        div.style.animationDelay = `${i * 0.02}s`

        const statusClasse = temAcesso ? 'ativo' : 'pendente'
        const statusTexto  = temAcesso ? '🟢 Ativo' : '🟡 Sem Senha'

        div.innerHTML = `
            <div class="professor-card-header-clean">
                <div class="professor-avatar-clean" style="background: ${gradiente} !important;">
                    ${iniciais}
                </div>
                <div class="professor-header-info">
                    <div class="professor-nome-clean" title="${prof.nome}">${prof.nome}</div>
                    <div class="professor-subinfo-clean">
                        <span class="badge-disciplina-clean">${prof.disciplina || 'Geral'}</span>
                        ${qtdReservas > 0 ? `
                            <span class="badge-reservas-clean" id="res-prof-${prof.id}" title="Ver histórico de agendamentos">
                                📅 ${qtdReservas} ${qtdReservas === 1 ? 'aula' : 'aulas'} ›
                            </span>
                        ` : ''}
                    </div>
                </div>
                <span class="status-pill-clean ${statusClasse}" title="${temAcesso ? 'Acesso Liberado com PIN' : 'Falta cadastrar senha de acesso'}">
                    ${statusTexto}
                </span>
            </div>

            <div class="prof-meta-row-clean">
                ${prof.telefone ? `
                    <span class="prof-tel-link" title="WhatsApp cadastrado">📱 ${formatarTelefoneExibicao(prof.telefone)}</span>
                ` : `
                    <span style="color:var(--txt3); font-style:italic;">Sem telefone</span>
                `}
                <span style="font-size:0.72rem; color:var(--txt3);">
                    ${temAcesso ? (prof.pin ? `PIN: ${prof.pin}` : 'PIN ativo') : 'Acesso bloqueado'}
                </span>
            </div>

            <div class="prof-card-actions-clean">
                ${temAcesso ? `
                    <button type="button" class="btn-card-clean-main" id="btn-pin-${prof.id}" title="Ver ou alterar a senha de acesso (PIN de 4 dígitos)">
                        <span>🔑</span> Senha
                    </button>
                    ${prof.pin ? `
                    <button type="button" class="btn-card-clean-zap" id="btn-zap-prof-${prof.id}" title="Enviar dados de acesso diretamente pelo WhatsApp">
                        <span>💬</span> WhatsApp
                    </button>
                    ` : ''}
                ` : `
                    <button type="button" class="btn-card-clean-main destaque" id="btn-pin-${prof.id}" title="Criar senha de 4 números para liberar o acesso">
                        <span>✨</span> Liberar Senha
                    </button>
                `}
                <button type="button" class="btn-card-clean-icon" id="btn-edit-${prof.id}" title="Editar dados">
                    ✏️
                </button>
                <button type="button" class="btn-card-clean-icon del" id="btn-del-${prof.id}" title="Excluir professor">
                    🗑️
                </button>
            </div>`

        // Eventos dos botões (100% preservados)
        if (prof.pin) {
            div.querySelector(`#btn-zap-prof-${prof.id}`)
                ?.addEventListener('click', (e) => {
                    e.stopPropagation()
                    window.abrirWhatsAppComPin(prof.nome, prof.pin, prof.telefone)
                })
        }

        div.querySelector(`#res-prof-${prof.id}`)
            ?.addEventListener('click', (e) => {
                e.stopPropagation()
                window.abrirHistoricoProfessor(prof.id, prof.nome)
            })

        div.querySelector(`#btn-pin-${prof.id}`)
            ?.addEventListener('click', () => window.gerenciarAcessoProfessor(prof.id, prof.nome, temAcesso, prof.pin, prof.telefone))

        div.querySelector(`#btn-edit-${prof.id}`)
            ?.addEventListener('click', () => window.abrirModalEditarProfessor(prof.id, prof.nome, prof.disciplina, prof.telefone))

        div.querySelector(`#btn-del-${prof.id}`)
            ?.addEventListener('click', () => window.excluirProfessor(prof.id, prof.nome))

        container.appendChild(div)
    })
}

window.abrirModalEditarProfessor = async function(id, nomeAtual, disciplinaAtual, telefoneAtual) {
    if (!await exigirAuth()) return
    const telExistente = telefoneAtual !== undefined ? telefoneAtual : (cacheProfessores.find(p => p.id === id)?.telefone || '')
    const disciplinas = await obterDisciplinasCache()
    const optsDisciplinas = (disciplinas || []).map(d => 
        `<option value="${d.nome}" ${d.nome === disciplinaAtual ? 'selected' : ''}>${d.nome}</option>`
    ).join('')

    const htmlModal = `
        <div class="modal-pin-wrapper">
            <div style="font-size:0.84rem; color:var(--txt2); margin-bottom:4px;">
                Altere os dados de cadastro de <strong>${nomeAtual}</strong>:
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">Nome Completo:</label>
                <input type="text" id="edit-modal-nome-${id}" class="swal2-input" value="${nomeAtual.replace(/"/g, '&quot;')}" style="margin:0; width:100%; font-size:0.88rem; box-sizing:border-box;">
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">Matéria / Disciplina:</label>
                <select id="edit-modal-disc-${id}" class="swal2-select" style="margin:0; width:100%; font-size:0.88rem; display:block; box-sizing:border-box;">
                    <option value="">Selecione a matéria...</option>
                    ${optsDisciplinas}
                </select>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">WhatsApp / Celular:</label>
                <input type="tel" id="edit-modal-tel-${id}" class="swal2-input" value="${formatarTelefoneExibicao(telExistente)}" placeholder="(DDD) 99999-9999" maxlength="15" inputmode="numeric" style="margin:0; width:100%; font-size:0.88rem; box-sizing:border-box;">
            </div>
        </div>
    `

    const res = await Swal.fire({
        title: 'Editar Professor',
        html: htmlModal,
        showCancelButton: true,
        confirmButtonText: '💾 Salvar Alterações',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-primaria)',
        cancelButtonColor: 'var(--texto-secundario)',
        didOpen: () => {
            const inputNome = document.getElementById(`edit-modal-nome-${id}`)
            const inputTel = document.getElementById(`edit-modal-tel-${id}`)
            if (inputNome) inputNome.focus()
            if (inputTel) aplicarMascaraTelefoneInput(inputTel)
        },
        preConfirm: () => {
            const novoNome = document.getElementById(`edit-modal-nome-${id}`)?.value.trim()
            const novaDisc = document.getElementById(`edit-modal-disc-${id}`)?.value
            const telLimpo = (document.getElementById(`edit-modal-tel-${id}`)?.value || '').replace(/\D/g, '')
            if (!novoNome || novoNome.length < 3) {
                Swal.showValidationMessage('Digite o nome completo do professor.')
                return false
            }
            if (telLimpo && telLimpo.length < 10) {
                Swal.showValidationMessage('O WhatsApp deve ter DDD e pelo menos 10 dígitos (ou deixe em branco).')
                return false
            }
            return { nome: novoNome, disciplina: novaDisc || '', telefone: telLimpo || null }
        }
    })

    if (!res.isConfirmed || !res.value) return

    const { nome, disciplina, telefone } = res.value
    Swal.fire({ title: 'Salvando alterações...', allowOutsideClick: false, didOpen: () => Swal.showLoading() })

    let error = null
    const { error: errTel } = await supabase.from('professores').update({ nome, disciplina, telefone }).eq('id', id)

    if (errTel && (errTel.code === '42703' || String(errTel.message).includes('telefone'))) {
        const { error: errSemTel } = await supabase.from('professores').update({ nome, disciplina }).eq('id', id)
        error = errSemTel
    } else {
        error = errTel
    }

    if (error) {
        dispararAlerta({ icon: 'error', title: 'Erro', text: 'Não foi possível salvar as alterações.', confirmButtonColor: 'var(--cor-perigo)' })
        return
    }

    dispararAlerta({ icon: 'success', title: 'Alterações Salvas!', timer: 1400, showConfirmButton: false })
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

window.gerenciarAcessoProfessor = async function(id, nome, temAcesso, pinAtual, telefone = null) {
    if (!await exigirAuth()) return

    const profDoCache = cacheProfessores.find(p => p.id === id)
    const pinCadastrado = pinAtual || profDoCache?.pin || null
    const telProf = telefone !== null && telefone !== undefined ? telefone : (profDoCache?.telefone || null)

    const htmlModal = `
        <div class="modal-pin-wrapper">
            <div style="font-size:0.84rem; color:var(--txt2); line-height:1.45;">
                O professor usa esta senha de 4 números para entrar no Locus e agendar salas.
            </div>

            ${pinCadastrado ? `
            <div class="modal-copiar-box" style="margin-top:2px; margin-bottom:4px;">
                <div style="text-align:left;">
                    <div style="font-size:0.68rem; text-transform:uppercase; color:var(--txt3); font-weight:700;">SENHA ATUAL CADASTRADA</div>
                    <div class="badge-pin-display">${pinCadastrado}</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button type="button" id="btn-zap-pin-atual" class="btn-whatsapp-rapido" style="padding:8px 14px; font-size:0.78rem;">
                        📱 WhatsApp ${telProf ? `(${formatarTelefoneExibicao(telProf)})` : ''}
                    </button>
                    <button type="button" id="btn-copiar-pin-atual" class="btn-acao-topo" style="padding:8px 14px; font-size:0.78rem;">
                        📋 Copiar
                    </button>
                </div>
            </div>
            ` : ''}

            <div class="modal-pin-bloco">
                <div class="modal-pin-titulo">
                    <span>🔑</span> ${pinCadastrado ? 'Trocar a Senha de Acesso' : 'Definir Senha de Acesso'}
                </div>
                <div class="modal-pin-sub">
                    Digite 4 números ou clique em "Gerar Senha" para ${pinCadastrado ? 'trocar a senha de' : 'liberar o acesso de'} <strong>${nome}</strong>.
                </div>
                <div class="modal-pin-input-linha">
                    <input type="text" id="modal-input-pin" class="modal-pin-input" maxlength="4" placeholder="••••" autocomplete="off" inputmode="numeric">
                    <button type="button" id="btn-gerar-pin-modal" class="modal-pin-btn-random">
                        🎲 Gerar Senha
                    </button>
                </div>
                <label style="font-size:0.76rem; color:var(--txt2); display:flex; align-items:center; gap:6px; cursor:pointer; margin-top:4px;">
                    <input type="checkbox" id="chk-notificar-prof" checked style="cursor:pointer;">
                    Avisar o professor pelo aplicativo sobre a nova senha
                </label>
            </div>

            ${temAcesso ? `
            <div style="margin-top:4px; padding-top:10px; border-top:1px dashed var(--border); display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                <span style="font-size:0.75rem; color:var(--txt3);">Precisa desativar o acesso temporariamente?</span>
                <button type="button" id="btn-revogar-acesso-modal" style="background:none; border:none; color:#f87171; font-size:0.76rem; font-weight:700; cursor:pointer; text-decoration:underline;">
                    Bloquear Acesso
                </button>
            </div>
            ` : ''}
        </div>
    `

    const res = await Swal.fire({
        title: `Senha de Acesso · ${nome}`,
        html: htmlModal,
        showCancelButton: true,
        confirmButtonText: '💾 Salvar Senha',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-sucesso, #22c55e)',
        cancelButtonColor: 'var(--texto-secundario, #6b7280)',
        focusConfirm: false,
        didOpen: () => {
            const inputPin = document.getElementById('modal-input-pin')
            const btnRandom = document.getElementById('btn-gerar-pin-modal')
            const btnRevogar = document.getElementById('btn-revogar-acesso-modal')
            const btnZapAtual = document.getElementById('btn-zap-pin-atual')
            const btnCopiarAtual = document.getElementById('btn-copiar-pin-atual')

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

            if (btnZapAtual && pinCadastrado) {
                btnZapAtual.addEventListener('click', () => {
                    window.abrirWhatsAppComPin(nome, pinCadastrado, telProf)
                })
            }

            if (btnCopiarAtual && pinCadastrado) {
                btnCopiarAtual.addEventListener('click', () => {
                    navigator.clipboard.writeText(pinCadastrado).then(() => {
                        btnCopiarAtual.textContent = '✓ Copiado!'
                        setTimeout(() => { if (btnCopiarAtual) btnCopiarAtual.textContent = '📋 Copiar' }, 2000)
                    }).catch(() => alert(`PIN: ${pinCadastrado}`))
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
                Swal.showValidationMessage('A senha deve conter exatamente 4 números.')
                return false
            }
            return { pin: val, notificar: chkNotificar ? chkNotificar.checked : true }
        }
    })

    if (!res.isConfirmed || !res.value) return

    const { pin: novoPin, notificar } = res.value

    Swal.fire({
        title: 'Salvando nova senha...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    })

    try {
        await ativarOuAtualizarPinProfessor(id, nome, novoPin)

        Swal.close()

        if (notificar) {
            enviarNotificacao(
                '🔑 Nova Senha Ativada',
                `Olá, ${nome}! Sua senha de acesso ao Locus foi atualizada para: ${novoPin}`,
                'professor',
                id
            ).catch(() => {})
        }

        await carregarListaProfessores()

        // Tela de confirmação com envio WhatsApp e cópia facilitada
        Swal.fire({
            icon: 'success',
            title: 'Senha Salva com Sucesso!',
            html: `
                <div style="font-family:'Poppins',sans-serif; text-align:center;">
                    <p style="font-size:0.86rem; color:var(--txt2); margin-bottom:12px;">
                        A senha de acesso de <strong>${nome}</strong> já está ativa no sistema:
                    </p>
                    <div class="modal-copiar-box">
                        <div style="text-align:left;">
                            <div style="font-size:0.68rem; text-transform:uppercase; color:var(--txt3); font-weight:700;">SENHA DE ACESSO</div>
                            <div class="badge-pin-display" id="display-novo-pin">${novoPin}</div>
                        </div>
                        <button type="button" id="btn-copiar-novo-pin" class="btn-acao-topo" style="padding:8px 14px; border-color:var(--purple); color:var(--purple); font-weight:700;">
                            📋 Copiar Senha
                        </button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
                        <button type="button" id="btn-zap-novo-pin" class="btn-whatsapp-rapido" style="width:100%; justify-content:center;">
                            <span>📱</span> Enviar Nova Senha via WhatsApp ${telProf ? `(${formatarTelefoneExibicao(telProf)})` : ''}
                        </button>
                        <button type="button" id="btn-copiar-msg-novo-pin" class="btn-acao-topo" style="width:100%; justify-content:center; padding:9px 12px; font-size:0.8rem;">
                            📋 Copiar Mensagem Pronta
                        </button>
                    </div>
                    <p style="font-size:0.75rem; color:var(--txt3); margin-top:14px;">
                        O professor já pode entrar na Área do Professor com esta senha.
                    </p>
                </div>
            `,
            confirmButtonText: 'Concluído',
            confirmButtonColor: 'var(--cor-primaria)',
            didOpen: () => {
                const btnCopiar = document.getElementById('btn-copiar-novo-pin')
                const btnZap = document.getElementById('btn-zap-novo-pin')
                const btnCopiarMsg = document.getElementById('btn-copiar-msg-novo-pin')

                if (btnCopiar) {
                    btnCopiar.addEventListener('click', () => {
                        navigator.clipboard.writeText(novoPin).then(() => {
                            btnCopiar.textContent = '✓ Copiado!'
                            btnCopiar.style.background = 'rgba(34,197,94,0.15)'
                            btnCopiar.style.color = '#22c55e'
                            setTimeout(() => {
                                if (btnCopiar) {
                                    btnCopiar.textContent = '📋 Copiar PIN'
                                    btnCopiar.style.background = ''
                                    btnCopiar.style.color = ''
                                }
                            }, 2000)
                        }).catch(() => {
                            alert(`PIN: ${novoPin}`)
                        })
                    })
                }

                if (btnZap) {
                    btnZap.addEventListener('click', () => {
                        window.abrirWhatsAppComPin(nome, novoPin, telProf)
                    })
                }

                if (btnCopiarMsg) {
                    btnCopiarMsg.addEventListener('click', () => {
                        window.copiarMensagemWhatsApp(nome, novoPin, btnCopiarMsg)
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
            <div style="font-size:0.84rem; color:var(--txt2); margin-bottom:4px;">
                Preencha os dados abaixo para adicionar um novo professor à escola:
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">Nome Completo:</label>
                <input type="text" id="novo-prof-nome" class="swal2-input" placeholder="Ex: Maria Clara Souza" style="margin:0; width:100%; font-size:0.88rem; box-sizing:border-box;">
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">Matéria / Disciplina:</label>
                <select id="novo-prof-disciplina" class="swal2-select" style="margin:0; width:100%; font-size:0.88rem; display:block; box-sizing:border-box;">
                    <option value="">Selecione a matéria...</option>
                    ${optsDisciplinas}
                </select>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">Turno / Modalidade:</label>
                <select id="novo-prof-turno" class="swal2-select" style="margin:0; width:100%; font-size:0.88rem; display:block; box-sizing:border-box;">
                    <option value="manha">☀️ Ensino Regular · Manhã Integral</option>
                    <option value="eja">🌙 Educação de Jovens e Adultos · EJA Noturno</option>
                </select>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
                <label style="font-size:0.8rem; font-weight:700; color:var(--txt);">WhatsApp / Celular (Opcional):</label>
                <input type="tel" id="novo-prof-tel" class="swal2-input" placeholder="(DDD) 99999-9999" maxlength="15" inputmode="numeric" style="margin:0; width:100%; font-size:0.88rem; box-sizing:border-box;">
            </div>
            <div class="modal-pin-bloco">
                <div class="modal-pin-titulo">
                    <span>🔑</span> Senha de Acesso (4 números)
                </div>
                <div class="modal-pin-sub">
                    Defina agora ou clique em "Gerar Senha" para o professor já começar a usar. Se preferir, pode deixar em branco para criar depois.
                </div>
                <div class="modal-pin-input-linha">
                    <input type="text" id="novo-prof-pin" class="modal-pin-input" maxlength="4" placeholder="••••" autocomplete="off" inputmode="numeric">
                    <button type="button" id="btn-gerar-pin-novo" class="modal-pin-btn-random">
                        🎲 Gerar Senha
                    </button>
                </div>
            </div>
        </div>
    `

    const res = await Swal.fire({
        title: 'Cadastrar Novo Professor',
        html: htmlModal,
        showCancelButton: true,
        confirmButtonText: 'Cadastrar Professor',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: 'var(--cor-primaria)',
        cancelButtonColor: 'var(--texto-secundario)',
        didOpen: () => {
            const inputNome = document.getElementById('novo-prof-nome')
            const inputTel = document.getElementById('novo-prof-tel')
            const inputPin = document.getElementById('novo-prof-pin')
            const btnRandom = document.getElementById('btn-gerar-pin-novo')

            if (inputNome) inputNome.focus()
            if (inputTel) aplicarMascaraTelefoneInput(inputTel)
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
            const turno = 'manha'
            const telLimpo = (document.getElementById('novo-prof-tel')?.value || '').replace(/\D/g, '')
            const pinRaw = document.getElementById('novo-prof-pin')?.value.replace(/\D/g, '') || ''

            if (!nomeRaw || nomeRaw.length < 3) {
                Swal.showValidationMessage('Digite o nome completo do professor (mínimo 3 caracteres).')
                return false
            }
            if (!disciplina) {
                Swal.showValidationMessage('Selecione a matéria do professor.')
                return false
            }
            if (telLimpo && telLimpo.length < 10) {
                Swal.showValidationMessage('O WhatsApp deve ter DDD e pelo menos 10 dígitos (ou deixe em branco).')
                return false
            }
            if (pinRaw && pinRaw.length !== 4) {
                Swal.showValidationMessage('A senha inicial deve conter exatamente 4 números (ou deixe em branco).')
                return false
            }

            return { nome: nomeRaw, disciplina, pin: pinRaw || null, telefone: telLimpo || null, turno }
        }
    })

    if (!res.isConfirmed || !res.value) return

    const { nome, disciplina, pin, telefone, turno } = res.value

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

        // Insere professor com suporte a turno, telefone e fallback resiliente
        const insertPayload = { nome, disciplina, auth_user_id: null, turno }
        if (telefone) insertPayload.telefone = telefone

        let novoProf = null
        let errInsert = null

        const resInsert = await supabase
            .from('professores')
            .insert([insertPayload])
            .select('id')
            .single()

        if (resInsert.error && (resInsert.error.code === '42703' || String(resInsert.error.message).includes('turno') || String(resInsert.error.message).includes('telefone'))) {
            const fallbackObj = { nome, disciplina, auth_user_id: null }
            if (telefone && !String(resInsert.error.message).includes('telefone')) fallbackObj.telefone = telefone
            const fallbackRes = await supabase
                .from('professores')
                .insert([fallbackObj])
                .select('id')
                .single()
            novoProf = fallbackRes.data
            errInsert = fallbackRes.error
        } else {
            novoProf = resInsert.data
            errInsert = resInsert.error
        }

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
                            <strong>${nome}</strong> foi cadastrado(a) com sucesso e sua senha já está pronta para uso:
                        </p>
                        <div class="modal-copiar-box">
                            <div style="text-align:left;">
                                <div style="font-size:0.68rem; text-transform:uppercase; color:var(--txt3); font-weight:700;">SENHA DE ACESSO</div>
                                <div class="badge-pin-display">${pin}</div>
                            </div>
                            <button type="button" id="btn-copiar-pin-cad" class="btn-acao-topo" style="padding:8px 14px; border-color:var(--purple); color:var(--purple); font-weight:700;">
                                📋 Copiar Senha
                            </button>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
                            <button type="button" id="btn-zap-novo-prof" class="btn-whatsapp-rapido" style="width:100%; justify-content:center;">
                                <span>📱</span> Enviar Senha via WhatsApp ${telefone ? `(${formatarTelefoneExibicao(telefone)})` : ''}
                            </button>
                            <button type="button" id="btn-copiar-msg-novo-prof" class="btn-acao-topo" style="width:100%; justify-content:center; padding:9px 12px; font-size:0.8rem;">
                                📋 Copiar Mensagem Pronta
                            </button>
                        </div>
                    </div>
                `,
                confirmButtonText: 'Concluído',
                confirmButtonColor: 'var(--cor-primaria)',
                didOpen: () => {
                    const btnCopiar = document.getElementById('btn-copiar-pin-cad')
                    const btnZap = document.getElementById('btn-zap-novo-prof')
                    const btnCopiarMsg = document.getElementById('btn-copiar-msg-novo-prof')

                    if (btnCopiar) {
                        btnCopiar.addEventListener('click', () => {
                            navigator.clipboard.writeText(pin).then(() => {
                                btnCopiar.textContent = '✓ Copiado!'
                                setTimeout(() => { if (btnCopiar) btnCopiar.textContent = '📋 Copiar PIN' }, 2000)
                            }).catch(() => alert(`PIN: ${pin}`))
                        })
                    }

                    if (btnZap) {
                        btnZap.addEventListener('click', () => {
                            window.abrirWhatsAppComPin(nome, pin, telefone)
                        })
                    }

                    if (btnCopiarMsg) {
                        btnCopiarMsg.addEventListener('click', () => {
                            window.copiarMensagemWhatsApp(nome, pin, btnCopiarMsg)
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

    // 1. Remove inscrições push para evitar violação de integridade referencial (23503)
    try {
        await supabase.from('inscricoes_push').delete().eq('professor_id', id);
    } catch (errPush) {
        console.warn('Aviso ao remover push do professor:', errPush);
    }

    // 2. Remove agendamentos vinculados
    try {
        await supabase.from('agendamentos').delete().eq('professor_id', id);
    } catch (errAgendamentos) {
        console.warn('Aviso ao remover agendamentos do professor:', errAgendamentos);
    }

    // 3. Remove professor (RLS: professores_delete_coord)
    const { error } = await supabase.from('professores').delete().eq('id', id);
    Swal.close();

    if (error) {
        console.error('Erro ao excluir professor:', error);
        dispararAlerta({ icon: 'error', title: 'Erro', text: error.message || 'Não foi possível excluir o professor.', confirmButtonColor: 'var(--cor-perigo)' });
        return;
    }

    dispararAlerta({ icon: 'success', title: 'Excluído!', text: `Professor "${nome}" foi excluído com sucesso.`, timer: 1800, showConfirmButton: false });
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

