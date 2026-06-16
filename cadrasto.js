/* cadrasto.js — versão com Supabase Auth */
import { supabase, carregarPreferenciaModo, registrarServiceWorker } from './utils.js'

let professoresSemAcesso = [];

document.addEventListener("DOMContentLoaded", () => {
    carregarPreferenciaModo();
    registrarServiceWorker();
    buscarProfessoresLiberados();

    document.getElementById('select-professor-cadastro').addEventListener('change', (e) => {
        const prof = professoresSemAcesso.find(p => p.id == e.target.value);
        const inputDisciplina = document.getElementById('disciplina-cadastro-visual');
        inputDisciplina.value = prof ? prof.disciplina : '';
    });
});

// Professores liberados pela coord que ainda não têm auth_user_id
async function buscarProfessoresLiberados() {
    const select = document.getElementById('select-professor-cadastro');

    try {
        // MUDANÇA: filtra por auth_user_id nulo em vez de pin nulo
        const { data, error } = await supabase
            .from('professores')
            .select('id, nome, disciplina')
            .is('auth_user_id', null);

        if (error) throw error;

        professoresSemAcesso = data || [];
        select.innerHTML = '<option value="">Selecione seu nome...</option>';

        if (professoresSemAcesso.length === 0) {
            select.innerHTML = '<option value="">Nenhum cadastro pendente</option>';
            return;
        }

        professoresSemAcesso.forEach(prof => {
            const opt = document.createElement('option');
            opt.value = prof.id;
            opt.textContent = prof.nome;
            select.appendChild(opt);
        });

    } catch (err) {
        console.error("Erro ao buscar professores:", err);
        select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
}

window.cadastrarProfessor = async function() {
    const professorId = document.getElementById('select-professor-cadastro').value;
    const pinInput = document.getElementById('pin-cadastro').value.trim();
    const codigoConvite = document.getElementById('codigo-escola-cadastro').value.trim();

    // ── Validações no front-end (redundantes — servidor também valida) ──
    if (!professorId || !pinInput || !codigoConvite) {
        return Swal.fire({
            icon: 'warning',
            title: 'Campos obrigatórios',
            text: 'Preencha todos os campos.',
            confirmButtonColor: '#6C63FF'
        });
    }

    if (!/^\d{4}$/.test(pinInput)) {
        return Swal.fire({
            icon: 'warning',
            title: 'PIN Inválido',
            text: 'O PIN deve ter exatamente 4 números.',
            confirmButtonColor: '#6C63FF'
        });
    }

    const btn = document.getElementById('btn-cadastrar');
    btn.innerText = 'Ativando acesso... ⏳';
    btn.disabled = true;

    try {
        // MUDANÇA: chama a Edge Function em vez de fazer UPDATE direto no banco
        // O código de convite é validado no SERVIDOR, não aqui
        // O PIN vira senha no Supabase Auth com bcrypt automático
        const { data, error } = await supabase.functions.invoke('ativar-professor', {
            body: {
                professor_id: professorId,
                pin: pinInput,
                codigo_convite: codigoConvite
            }
        })

        if (error || !data?.sucesso) {
            const mensagem = data?.erro || 'Não foi possível ativar seu acesso.'
            Swal.fire({
                icon: 'error',
                title: 'Erro na ativação',
                text: mensagem,
                confirmButtonColor: '#ff4d4d'
            });
            btn.innerText = 'Concluir Ativação';
            btn.disabled = false;
            return;
        }

        // ── Loga automaticamente após ativar ──
        // O email fictício é prof-{id}@locus.interno (gerado pela Edge Function)
        const emailFicticio = `prof-${professorId}@locus.interno`
        await supabase.auth.signInWithPassword({
            email: emailFicticio,
            password: pinInput
        })

        Swal.fire({
            icon: 'success',
            title: 'Acesso Ativado!',
            text: 'Seu PIN foi configurado. Você já pode fazer login!',
            confirmButtonColor: '#00b09b'
        }).then(() => {
            window.location.href = 'index.html';
        });

    } catch (err) {
        console.error("Erro na ativação:", err);
        Swal.fire({
            icon: 'error',
            title: 'Erro de Conexão',
            text: 'Tente novamente em instantes.',
            confirmButtonColor: '#6C63FF'
        });
        btn.innerText = 'Concluir Ativação';
        btn.disabled = false;
    }
}
