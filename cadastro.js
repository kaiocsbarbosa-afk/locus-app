/* cadastro.js — professor envia solicitação de acesso */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { carregarPreferenciaModo, COORD_EMAIL, supabase as authClient } from './utils.js'
import { enviarNotificacao } from './push.js'

const SUPABASE_URL = window.__ENV__?.SUPABASE_URL || ''
const SUPABASE_KEY = window.__ENV__?.SUPABASE_KEY || ''

// Cliente estritamente anônimo para cadastro/solicitação.
// Nunca herda tokens de sessão do localStorage (ex: coordenador ou professor logado em outra aba),
// prevenindo o erro HTTP 403 (RLS policy violation em solicitacoes_acesso para papel authenticated).
const supabase = (SUPABASE_URL && SUPABASE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    })
    : createClient('https://placeholder.supabase.co', 'placeholder-key', {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });

const DISCIPLINAS_PADRAO = [
    'Análise e Desenvolvimento de Sistemas',
    'Artes',
    'Biologia',
    'Ciências',
    'Educação Física',
    'Filosofia',
    'Física',
    'Geografia',
    'História',
    'Inglês',
    'Língua Portuguesa',
    'Matemática',
    'Química',
    'Sociologia'
];

// ── INICIALIZAÇÃO ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    carregarPreferenciaModo();
    carregarDisciplinas();
    configurarPin();
    verificarSessaoExistente();

    document.getElementById('btn-enviar')
        ?.addEventListener('click', enviarSolicitacao);

    document.getElementById('btn-voltar-login')
        ?.addEventListener('click', () => { window.location.href = 'professor.html'; });

    document.getElementById('pin-wrapper')
        ?.addEventListener('click', () => document.getElementById('pin-input-cad')?.focus());

    // Facilita preenchimento com navegação por teclado
    document.getElementById('input-nome')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('input-disciplina')?.focus();
        }
    });

    document.getElementById('pin-input-cad')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            enviarSolicitacao();
        }
    });
});

// ── VERIFICAÇÃO DE SESSÃO EXISTENTE NO NAVEGADOR ───────────
function verificarSessaoExistente() {
    try {
        const chaveAuth = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
        if (!chaveAuth) return;

        const raw = localStorage.getItem(chaveAuth);
        if (!raw) return;
        const dados = JSON.parse(raw);
        const email = dados?.user?.email;

        const banner = document.getElementById('aviso-sessao-ativa');
        const txtBanner = document.getElementById('txt-sessao-ativa');
        const btnIrPainel = document.getElementById('btn-ir-painel-sessao');
        const btnSairSessao = document.getElementById('btn-sair-sessao');

        if (banner && txtBanner && email) {
            const isCoord = email === COORD_EMAIL;
            txtBanner.textContent = isCoord
                ? 'Você está conectado como Coordenação em outra aba.'
                : 'Você já possui uma conta conectada neste aparelho.';

            banner.style.display = 'flex';

            btnIrPainel?.addEventListener('click', () => {
                window.location.href = isCoord ? 'coordenacao.html' : 'professor.html';
            });

            btnSairSessao?.addEventListener('click', async () => {
                try {
                    await authClient.auth.signOut();
                } catch (err) {
                    console.warn('Erro ao deslogar:', err);
                }
                localStorage.removeItem(chaveAuth);
                banner.style.display = 'none';
                Swal.fire({
                    icon: 'success',
                    title: 'Sessão encerrada',
                    text: 'Agora você pode solicitar um novo acesso normalmente.',
                    timer: 2000,
                    showConfirmButton: false
                });
            });
        }
    } catch (e) {
        // silencioso
    }
}

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
    input.addEventListener('focus', () => atualizar(input.value.replace(/\D/g, '').slice(0, 4)));
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
    if (!select) return;

    function preencher(lista) {
        while (select.options.length > 1) {
            select.remove(1);
        }
        lista.forEach(nomeDisc => {
            const opt = document.createElement('option');
            opt.value = nomeDisc;
            opt.textContent = nomeDisc;
            select.appendChild(opt);
        });
    }

    try {
        const { data, error } = await supabase.from('disciplinas').select('nome').order('nome');
        if (!error && data && data.length > 0) {
            preencher(data.map(d => d.nome));
            return;
        }
    } catch (e) {
        console.warn('Falha ao obter disciplinas do Supabase:', e);
    }

    // Fallback padrão se der erro ou vier vazio
    preencher(DISCIPLINAS_PADRAO);
}

// ── ENVIAR SOLICITAÇÃO ────────────────────────────────────
async function enviarSolicitacao() {
    const nome       = document.getElementById('input-nome').value.trim();
    const disciplina = document.getElementById('input-disciplina').value;
    const pin        = document.getElementById('pin-input-cad').value.replace(/\D/g, '').slice(0, 4);

    if (!nome || nome.length < 3) {
        return Swal.fire({
            icon: 'warning',
            title: 'Nome obrigatório',
            text: 'Digite seu nome completo (mínimo 3 caracteres).',
            confirmButtonColor: '#dc3c3c'
        });
    }
    if (nome.length > 100) {
        return Swal.fire({
            icon: 'warning',
            title: 'Nome muito longo',
            text: 'O nome deve ter no máximo 100 caracteres.',
            confirmButtonColor: '#dc3c3c'
        });
    }
    if (!disciplina) {
        return Swal.fire({
            icon: 'warning',
            title: 'Selecione a disciplina',
            text: 'Escolha sua disciplina na lista.',
            confirmButtonColor: '#dc3c3c'
        });
    }
    if (pin.length < 4) {
        return Swal.fire({
            icon: 'warning',
            title: 'PIN incompleto',
            text: 'Crie um PIN de 4 dígitos para seu acesso.',
            confirmButtonColor: '#dc3c3c'
        });
    }

    const btnEnviar = document.getElementById('btn-enviar');
    btnEnviar.disabled = true;
    btnEnviar.classList.add('carregando');

    try {
        // 1. Verifica se já existe professor ATIVO na tabela 'professores'
        const { data: profsAtivos, error: errProf } = await supabase
            .from('professores')
            .select('id, nome')
            .ilike('nome', nome)
            .limit(1);

        if (!errProf && profsAtivos && profsAtivos.length > 0) {
            btnEnviar.disabled = false;
            btnEnviar.classList.remove('carregando');
            return Swal.fire({
                icon: 'info',
                title: 'Professor já cadastrado',
                text: `Já existe um acesso ativo para "${nome}". Acesse a tela de login do professor.`,
                confirmButtonText: 'Ir para login',
                confirmButtonColor: '#dc3c3c',
                showCancelButton: true,
                cancelButtonText: 'Fechar'
            }).then((res) => {
                if (res.isConfirmed) window.location.href = 'professor.html';
            });
        }

        // 2. Verifica se já existe solicitação PENDENTE em análise
        const { data: solPendentes, error: errSol } = await supabase
            .from('solicitacoes_acesso')
            .select('id, status')
            .ilike('nome', nome)
            .eq('status', 'pendente')
            .limit(1);

        if (!errSol && solPendentes && solPendentes.length > 0) {
            btnEnviar.disabled = false;
            btnEnviar.classList.remove('carregando');
            return Swal.fire({
                icon: 'info',
                title: 'Solicitação em análise',
                text: 'Já existe uma solicitação pendente com este nome. Aguarde a aprovação da coordenação.',
                confirmButtonColor: '#dc3c3c'
            });
        }

        // 3. Insere a nova solicitação sem retorno de coluna pin (.select())
        // Usa cliente estritamente anônimo com 'Prefer: return=minimal'
        const { error: errInsert } = await supabase
            .from('solicitacoes_acesso')
            .insert({
                nome,
                disciplina,
                pin,
                status: 'pendente'
            });

        if (errInsert) throw errInsert;

        // 4. Notifica coordenadores em segundo plano (não bloqueia exibição da tela de sucesso)
        enviarNotificacao(
            '📋 Nova solicitação de acesso',
            `${nome} (${disciplina}) solicitou acesso ao Locus.`,
            'coordenacao'
        ).catch(e => console.warn('[Push] Falha ao notificar coordenação:', e));

        // 5. Exibe a tela de sucesso
        document.getElementById('tela-form').style.display = 'none';
        document.getElementById('tela-sucesso').style.display = 'flex';

    } catch (err) {
        console.error('Erro ao enviar solicitação:', err);
        btnEnviar.disabled = false;
        btnEnviar.classList.remove('carregando');

        const detalhe = err?.message || err?.details || (typeof err === 'string' ? err : '');
        const mensagemAmigavel = detalhe
            ? `Não foi possível registrar o pedido: ${detalhe}`
            : 'Não foi possível enviar sua solicitação. Verifique sua conexão e tente novamente.';

        Swal.fire({
            icon: 'error',
            title: 'Erro ao enviar solicitação',
            text: mensagemAmigavel,
            confirmButtonColor: '#dc3c3c'
        });
    }
}
