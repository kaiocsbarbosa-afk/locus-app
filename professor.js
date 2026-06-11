// professor.js
import { supabase } from './supabase-client.js'
import { toggleDarkMode, carregarPreferenciaModo, registrarServiceWorker } from './utils.js'

// Expõe toggleDarkMode para o onclick no HTML
window.toggleDarkMode = toggleDarkMode

let professorLogado = null
let buscandoAulasAtualmente = false

document.addEventListener('DOMContentLoaded', () => {
    carregarPreferenciaModo()
    registrarServiceWorker()
    verificarPinSalvo()
})

async function verificarPinSalvo() {
    const pinSalvo = localStorage.getItem('prof_pin')
    if (pinSalvo) await fazerLogin(pinSalvo)
}

window.fazerLogin = async function(pinAutomatico) {
    const pin = pinAutomatico || document.getElementById('pin-professor').value

    if (!pin) {
        return Swal.fire({
            icon: 'warning', title: 'Atenção!',
            text: 'Por favor, informe seu PIN numérico.',
            confirmButtonColor: 'var(--cor-primaria)'
        })
    }

    const btnLogin = document.getElementById('btn-login')
    if (btnLogin) {
        btnLogin.innerText = 'Carregando... ⏳'
        btnLogin.disabled = true
    }

    const { data, error } = await supabase
        .from('professores')
        .select('*')
        .eq('pin', pin)
        .single()

    if (btnLogin) {
        btnLogin.innerText = 'Entrar no sistema'
        btnLogin.disabled = false
    }

    if (error || !data) {
        if (!pinAutomatico) {
            Swal.fire({
                icon: 'error', title: 'Ops!',
                text: 'PIN incorreto ou não localizado.',
                confirmButtonColor: 'var(--cor-primaria)'
            })
        }
        localStorage.removeItem('prof_pin')
        return
    }

    professorLogado = data
    localStorage.setItem('prof_pin', pin)
    configurarInterfaceParaLogado()
    configurarCalendarioSemana()
    carregarHistorico()
}

window.fazerLogout = function() {
    localStorage.removeItem('prof_pin')
    window.location.reload()
}

function configurarInterfaceParaLogado() {
    document.getElementById('status-usuario').innerHTML =
        `Olá, <strong>${professorLogado.nome}</strong>! 👋`
    document.getElementById('container-turma').classList.remove('hidden')
    document.getElementById('secao-historico').classList.remove('hidden')
    document.getElementById('btn-sair').classList.remove('hidden')
    document.getElementById('secao-login').classList.add('hidden')
    document.getElementById('secao-agendamento').classList.remove('hidden')
    carregarTurmas()
    carregarSalas()
}

async function carregarTurmas() {
    const selectTurma = document.getElementById('select-turma')
    try {
        const { data: turmas, error } = await supabase
            .from('turmas').select('id, nome').order('nome', { ascending: true })
        if (error) throw error
        selectTurma.innerHTML = '<option value="">Selecione a turma...</option>'
        turmas.forEach(t => {
            const o = document.createElement('option')
            o.value = t.id; o.textContent = t.nome
            selectTurma.appendChild(o)
        })
    } catch (err) {
        console.error('Erro ao carregar turmas:', err)
        Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao carregar turmas.', confirmButtonColor: 'var(--cor-primaria)' })
    }
}

async function carregarSalas() {
    const selectSala = document.getElementById('select-sala')
    try {
        const { data: salas, error } = await supabase
            .from('salas').select('id, nome').order('nome', { ascending: true })
        if (error) throw error
        selectSala.innerHTML = '<option value="">Selecione uma sala...</option>'
        salas.forEach(s => {
            const o = document.createElement('option')
            o.value = s.id; o.textContent = s.nome
            selectSala.appendChild(o)
        })
    } catch (err) {
        console.error('Erro ao carregar salas:', err)
        Swal.fire({ icon: 'error', title: 'Erro', text: 'Falha ao carregar salas.', confirmButtonColor: 'var(--cor-primaria)' })
    }
}

function formatarData(dataObj) {
    const ano = dataObj.getFullYear()
    const mes = String(dataObj.getMonth() + 1).padStart(2, '0')
    const dia = String(dataObj.getDate()).padStart(2, '0')
    return `${ano}-${mes}-${dia}`
}

function configurarCalendarioSemana() {
    const hoje = new Date()
    const diaSemana = hoje.getDay()
    let minData = new Date(hoje)
    let maxData = new Date(hoje)

    if (diaSemana === 0) {
        minData.setDate(hoje.getDate() + 1)
        maxData.setDate(hoje.getDate() + 5)
    } else if (diaSemana === 6) {
        minData.setDate(hoje.getDate() + 2)
        maxData.setDate(hoje.getDate() + 6)
    } else {
        const resto = 5 - diaSemana
        maxData.setDate(hoje.getDate() + resto)
    }

    const input = document.getElementById('data-agendamento')
    input.min = formatarData(minData)
    input.max = formatarData(maxData)
    input.value = formatarData(minData)
}

window.buscarAulas = async function() {
    const salaId = document.getElementById('select-sala').value
    const dataEscolhida = document.getElementById('data-agendamento').value
    const grid = document.getElementById('grid-aulas')

    if (buscandoAulasAtualmente) return

    if (!salaId || !dataEscolhida) {
        grid.innerHTML = `
            <div class="grid-vazio">
                <div class="icone-vazio">🗓️</div>
                <p>Selecione uma data e uma sala para ver os horários disponíveis.</p>
            </div>`
        return
    }

    grid.innerHTML = `
        <div class="spinner-container">
            <div class="spinner"></div>
            <div class="spinner-texto">Buscando grade...</div>
        </div>`

    try {
        buscandoAulasAtualmente = true
        const { data: agendamentos, error } = await supabase
            .from('agendamentos')
            .select('aula_numero, professores(nome), turmas(nome)')
            .eq('sala_id', salaId)
            .eq('data', dataEscolhida)

        if (error) throw error

        const mapaOcupacao = {}
        agendamentos.forEach(a => {
            mapaOcupacao[a.aula_numero] = {
                prof: a.professores?.nome || 'Desconhecido',
                turma: a.turmas?.nome || 'Turma'
            }
        })

        grid.innerHTML = ''
        for (let i = 1; i <= 7; i++) {
            const btn = document.createElement('button')
            btn.classList.add('btn-aula')
            if (mapaOcupacao[i]) {
                btn.classList.add('ocupada')
                btn.innerHTML = `Aula ${i}<br><span style="font-size:.7rem;font-weight:400">🔒 ${mapaOcupacao[i].turma}<br>(${mapaOcupacao[i].prof})</span>`
                btn.disabled = true
            } else {
                btn.classList.add('disponivel')
                btn.innerHTML = `Aula ${i}<br><span style="font-size:.7rem;font-weight:400">✨ Livre</span>`
                btn.onclick = () => agendarAula(i)
            }
            grid.appendChild(btn)
        }
    } catch (err) {
        console.error('Erro ao buscar aulas:', err)
        grid.innerHTML = `<div class="grid-vazio"><p>Erro ao carregar a grade. Tente novamente.</p></div>`
    } finally {
        buscandoAulasAtualmente = false
    }
}

window.agendarAula = async function(numeroAula) {
    if (!professorLogado) return
    const salaId = document.getElementById('select-sala').value
    const turmaId = document.getElementById('select-turma').value
    const dataEscolhida = document.getElementById('data-agendamento').value

    if (!turmaId) {
        Swal.fire({
            icon: 'warning', title: 'Atenção!',
            text: 'Selecione a turma antes de escolher o horário.',
            confirmButtonColor: 'var(--cor-primaria)'
        }).then(() => document.getElementById('select-turma').focus())
        return
    }

    const { data: choqueProf } = await supabase
        .from('agendamentos')
        .select('id, salas(nome)')
        .eq('professor_id', professorLogado.id)
        .eq('data', dataEscolhida)
        .eq('aula_numero', numeroAula)

    if (choqueProf && choqueProf.length > 0) {
        Swal.fire({
            icon: 'error', title: 'Conflito de horário!',
            text: `Você já reservou "${choqueProf[0].salas.nome}" neste mesmo dia e horário.`,
            confirmButtonColor: 'var(--cor-primaria)'
        })
        return
    }

    const dataBr = dataEscolhida.split('-').reverse().join('/')
    const confirmacao = await Swal.fire({
        title: 'Confirmar reserva?',
        text: `Aula ${numeroAula} — ${dataBr}`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-primaria)',
        cancelButtonColor: 'var(--cor-perigo)',
        confirmButtonText: 'Sim, agendar!',
        cancelButtonText: 'Cancelar'
    })

    if (!confirmacao.isConfirmed) return

    const { error } = await supabase.from('agendamentos').insert([{
        professor_id: professorLogado.id,
        sala_id: salaId,
        turma_id: turmaId,
        data: dataEscolhida,
        aula_numero: numeroAula
    }])

    if (error) {
        Swal.fire({
            icon: 'error', title: 'Vaga indisponível',
            text: 'Essa vaga pode ter sido preenchida agora por outro professor.',
            confirmButtonColor: 'var(--cor-primaria)'
        })
    } else {
        Swal.fire({
            icon: 'success', title: 'Agendado!',
            text: 'Aula reservada com sucesso! 🎉',
            confirmButtonColor: 'var(--cor-sucesso)',
            timer: 2000, showConfirmButton: false
        })
        buscarAulas()
        carregarHistorico()
    }
}

window.carregarHistorico = async function() {
    if (!professorLogado) return
    const listaHtml = document.getElementById('historico-lista')
    listaHtml.innerHTML = '<span style="font-size:.85rem;color:var(--texto-secundario)">Carregando...</span>'

    const hojeIso = formatarData(new Date())
    const { data: historico, error } = await supabase
        .from('agendamentos')
        .select('id, data, aula_numero, salas(nome), turmas(nome)')
        .eq('professor_id', professorLogado.id)
        .gte('data', hojeIso)
        .order('data', { ascending: true })

    if (error) { listaHtml.innerHTML = 'Erro ao carregar histórico.'; return }

    if (historico.length === 0) {
        listaHtml.innerHTML = '<span style="font-size:.85rem;color:var(--texto-secundario)">Nenhum agendamento ativo.</span>'
        return
    }

    listaHtml.innerHTML = ''
    historico.forEach(item => {
        const dataBr = item.data.split('-').reverse().join('/')
        const div = document.createElement('div')
        div.classList.add('historico-item')
        div.innerHTML = `
            <div class="historico-info">
                <strong>${item.salas.nome} — Aula ${item.aula_numero}º</strong>
                <span>${dataBr} · ${item.turmas.nome}</span>
            </div>
            <button class="btn-cancelar" onclick="cancelarAgendamento('${item.id}')">Cancelar</button>`
        listaHtml.appendChild(div)
    })
}

window.cancelarAgendamento = async function(idAgendamento) {
    const confirmacao = await Swal.fire({
        title: 'Cancelar reserva?',
        text: 'Tem certeza que deseja remover este agendamento?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: 'var(--cor-perigo)',
        cancelButtonColor: 'var(--texto-secundario)',
        confirmButtonText: 'Sim, cancelar!',
        cancelButtonText: 'Manter'
    })

    if (!confirmacao.isConfirmed) return

    const { error } = await supabase.from('agendamentos').delete().eq('id', idAgendamento)

    if (error) {
        Swal.fire({ icon: 'error', title: 'Erro!', text: 'Não foi possível cancelar.', confirmButtonColor: 'var(--cor-primaria)' })
    } else {
        Swal.fire({ icon: 'success', title: 'Cancelado!', text: 'Reserva removida.', timer: 1500, showConfirmButton: false })
        buscarAulas()
        carregarHistorico()
    }
}

// Realtime — FIX: verifica professorLogado antes de chamar carregarHistorico
supabase
    .channel('agendamentos-prof')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agendamentos' }, () => {
        buscarAulas()
        if (professorLogado) carregarHistorico()  // ← bug corrigido
    })
    .subscribe()
