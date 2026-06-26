/* cadastro.js — professor envia solicitação de acesso */
import { supabase, carregarPreferenciaModo } from './utils.js'
import { enviarNotificacao } from './push.js'

// ── INICIALIZAÇÃO ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    carregarPreferenciaModo();
    carregarDisciplinas();
    configurarPin();

    document.getElementById('btn-enviar')
        ?.addEventListener('click', enviarSolicitacao);

    document.getElementById('btn-voltar-login')
        ?.addEventListener('click', () => { window.location.href = 'professor.html'; });

    document.getElementById('pin-wrapper')
        ?.addEventListener('click', () => document.getElementById('pin-input-cad').focus());
});

// ── PIN BOXES ─────────────────────────────────────────────
function configurarPin() {
    const input = document.getElementById('pin-input-cad');
    const dots  = [0,1,2,3].map(i => document.getElementById('cd' + i));
    const chars = [0,1,2,3].map(i => document.getElementById('cc' + i));
    if (!input || !dots[0]) return;

    function atualizar(val) {
        dots.forEach((dot, i) => {
            dot.classList.remove('ativo', 'preenchido');
            if (i < val.length) {
                chars[i].textContent = '●';
                dot.classList.add('preenchido');
            } else {
                chars[i].textContent = '';
                if (i === val.length) dot.classList.add('ativo');
            }
        });
    }

    atualizar('');
    input.addEventListener('focus', () => atualizar(input.value.replace(/\D/g, '').slice(0,4)));
    input.addEventListener('blur',  () => dots.forEach(d => d.classList.remove('ativo')));
    input.addEventListener('input', () => {
        const val = input.value.replace(/\D/g, '').slice(0, 4);
        input.value = val;
        atualizar(val);
    });
}

// ── DISCIPLINAS ───────────────────────────────────────────
async function carregarDisciplinas() {
    const select = document.getElementById('input-disciplina');
    try {
        const { data } = await supabase.from('disciplinas').select('nome').order('nome');
        if (data?.length) {
            data.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.nome; opt.textContent = d.nome;
                select.appendChild(opt);
            });
        }
    } catch (e) {
        const fixas = ['Artes','Biologia','Ciências','Educação Física','Filosofia','Física',
                       'Geografia','História','Inglês','Língua Portuguesa','Matemática','Química','Sociologia'];
        fixas.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d; opt.textContent = d;
            select.appendChild(opt);
        });
    }
}

// ── ENVIAR SOLICITAÇÃO ────────────────────────────────────
async function enviarSolicitacao() {
    const nome       = document.getElementById('input-nome').value.trim();
    const disciplina = document.getElementById('input-disciplina').value;
    const pin        = document.getElementById('pin-input-cad').value.replace(/\D/g,'').slice(0,4);

    if (!nome) {
        return Swal.fire({ icon:'warning', title:'Nome obrigatório', text:'Digite seu nome completo.', confirmButtonColor:'#7c3aed' });
    }
    if (!disciplina) {
        return Swal.fire({ icon:'warning', title:'Selecione a disciplina', text:'Escolha sua disciplina na lista.', confirmButtonColor:'#7c3aed' });
    }
    if (pin.length < 4) {
        return Swal.fire({ icon:'warning', title:'PIN incompleto', text:'Crie um PIN de 4 dígitos.', confirmButtonColor:'#7c3aed' });
    }

    const btnEnviar = document.getElementById('btn-enviar');
    btnEnviar.disabled = true;
    btnEnviar.classList.add('carregando');

    try {
        const { data: existente } = await supabase
            .from('solicitacoes_acesso').select('id').ilike('nome', nome).maybeSingle();

        if (existente) {
            btnEnviar.disabled = false;
            btnEnviar.classList.remove('carregando');
            return Swal.fire({
                icon: 'info', title: 'Solicitação já existe',
                text: 'Já existe um perfil com este nome. Faça login ou fale com a coordenação.',
                confirmButtonColor: '#7c3aed'
            });
        }

        const { error } = await supabase
            .from('solicitacoes_acesso')
            .insert({ nome, disciplina, pin, status: 'pendente' });

        if (error) throw error;

        await enviarNotificacao(
            '📋 Nova solicitação de acesso',
            `${nome} (${disciplina}) solicitou acesso ao Locus.`,
            'coordenacao'
        );

        document.getElementById('tela-form').style.display = 'none';
        document.getElementById('tela-sucesso').style.display = 'flex';

    } catch (err) {
        console.error('Erro ao enviar solicitação:', err);
        btnEnviar.disabled = false;
        btnEnviar.classList.remove('carregando');
        Swal.fire({
            icon: 'error', title: 'Erro ao enviar',
            text: 'Não foi possível enviar sua solicitação. Verifique sua conexão e tente novamente.',
            confirmButtonColor: '#7c3aed'
        });
    }
}
