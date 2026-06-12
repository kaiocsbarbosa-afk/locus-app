/* cadastro.js */
import { supabase, carregarPreferenciaModo, registrarServiceWorker, dispararAlerta } from './utils.js'

// Array para guardar temporariamente os professores vindos do banco
let professoresSemPin = [];

document.addEventListener("DOMContentLoaded", () => {
    carregarPreferenciaModo();
    registrarServiceWorker();
    buscarProfessoresLiberados();
    
    // Escuta quando o professor muda a seleção do nome para mostrar a disciplina correspondente
    document.getElementById('select-professor-cadastro').addEventListener('change', (e) => {
        const idSelecionado = e.target.value;
        const prof = professoresSemPin.find(p => p.id == idSelecionado);
        const inputDisciplina = document.getElementById('disciplina-cadastro-visual');
        
        if (prof) {
            inputDisciplina.value = prof.disciplina;
        } else {
            inputDisciplina.value = "";
        }
    });
});

// Busca no banco os professores cadastrados pela coordenação que ainda não têm PIN criado
async function buscarProfessoresLiberados() {
    const select = document.getElementById('select-professor-cadastro');
    
    try {
        const { data, error } = await supabase
            .from('professores')
            .select('id, nome, disciplina')
            .is('pin', null); // Traz apenas quem está com PIN nulo/vazio

        if (error) throw error;

        professoresSemPin = data || [];
        
        select.innerHTML = '<option value="">Selecione seu nome...</option>';
        
        if (professoresSemPin.length === 0) {
            select.innerHTML = '<option value="">Nenhum cadastro pendente de liberação</option>';
            return;
        }

        professoresSemPin.forEach(prof => {
            const opt = document.createElement('option');
            opt.value = prof.id;
            opt.textContent = prof.nome;
            select.appendChild(opt);
        });

    } catch (err) {
        console.error("Erro ao buscar professores:", err);
        select.innerHTML = '<option value="">Erro ao carregar professores</option>';
    }
}

window.cadastrarProfessor = async function() {
    const professorId = document.getElementById('select-professor-cadastro').value;
    const pinInput = document.getElementById('pin-cadastro').value.trim();
    const codigoEscolaInput = document.getElementById('codigo-escola-cadastro').value.trim();

    if (!professorId || !pinInput || !codigoEscolaInput) {
        return Swal.fire({
            icon: 'warning',
            title: 'Campos obrigatórios',
            text: 'Por favor, preencha todos os campos.',
            confirmButtonColor: '#6C63FF'
        });
    }

    if (!/^\d+$/.test(pinInput) || pinInput.length !== 4) {
        return Swal.fire({
            icon: 'warning',
            title: 'PIN Inválido',
            text: 'O seu PIN de acesso deve conter exatamente 4 números.',
            confirmButtonColor: '#6C63FF'
        });
    }

    const btnCadastrar = document.getElementById('btn-cadastrar');
    btnCadastrar.innerText = 'Validando dados... ⏳';
    btnCadastrar.disabled = true;

    try {
        // 1. Valida o código de convite na tabela configuracoes
        const { data: config, error: erroConfig } = await supabase
            .from('configuracoes')
            .select('valor')
            .eq('chave', 'codigo_convite')
            .single();

        if (erroConfig || !config) throw new Error("Erro ao buscar configurações.");

        if (codigoEscolaInput.toUpperCase() !== config.valor.toUpperCase()) {
            Swal.fire({
                icon: 'error',
                title: 'Código Incorreto',
                text: 'O código de convite da escola está inválido.',
                confirmButtonColor: '#ff4d4d'
            });
            restaurarBotao(btnCadastrar);
            return;
        }

        // 2. Garante que ninguém usou esse mesmo PIN de 4 dígitos antes
        const { data: pinExistente, error: erroBusca } = await supabase
            .from('professores')
            .select('id')
            .eq('pin', pinInput);

        if (erroBusca) throw erroBusca;

        if (pinExistente && pinExistente.length > 0) {
            Swal.fire({
                icon: 'error',
                title: 'PIN Indisponível',
                text: 'Este PIN já está em uso. Escolha uma combinação diferente.',
                confirmButtonColor: '#6C63FF'
            });
            restaurarBotao(btnCadastrar);
            return;
        }

        btnCadastrar.innerText = 'Salvando acesso... ⏳';

        // 3. Atualiza (UPDATE) a linha do professor adicionando o PIN definitivo
        const { error: erroUpdate } = await supabase
            .from('professores')
            .update({ pin: pinInput })
            .eq('id', professorId);

        if (erroUpdate) throw erroUpdate;

        Swal.fire({
            icon: 'success',
            title: 'Acesso Ativado!',
            text: 'Seu PIN foi configurado com sucesso. Você já pode fazer login!',
            confirmButtonColor: '#00b09b'
        }).then(() => {
            window.location.href = 'index.html';
        });

    } catch (err) {
        console.error("Erro na ativação:", err);
        Swal.fire({
            icon: 'error',
            title: 'Erro de Conexão',
            text: 'Não foi possível ativar seu acesso no momento.',
            confirmButtonColor: '#6C63FF'
        });
        restaurarBotao(btnCadastrar);
    }
}

function restaurarBotao(botao) {
    botao.innerText = 'Concluir Ativação';
    botao.disabled = false;
}
