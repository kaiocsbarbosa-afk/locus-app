-- ============================================================
-- LOCUS - SCRIPT COMPLETO DE SEGURANÇA, CONSTRAINTS E POLÍTICAS RLS
-- ============================================================
-- Execute este script no SQL Editor do seu painel Supabase:
-- https://supabase.com/dashboard/project/ixhuqbfzwkobhrvlzwgm/sql
--
-- OBJETIVO:
-- 1. Blindar o banco de dados contra duplicidades de reserva (concorrência).
-- 2. Garantir integridade referencial com exclusão em cascata (evita erros 23503).
-- 3. Proteger leituras e escritas via Row Level Security (RLS).
-- 4. Otimizar consultas com índices estratégicos.
-- ============================================================

-- ------------------------------------------------------------
-- 1. INTEGRIDADE REFERENCIAL & CONSTRAINTS ANTICONFLITO
-- ------------------------------------------------------------

-- Garante que NUNCA haja agendamentos duplicados na mesma sala, data e aula
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agendamentos_sala_data_aula_unique'
    ) THEN
        ALTER TABLE public.agendamentos
            ADD CONSTRAINT agendamentos_sala_data_aula_unique
            UNIQUE (sala_id, data, aula_numero);
    END IF;
END $$;

-- Garante que um professor não reserve duas salas diferentes no mesmo horário
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agendamentos_prof_data_aula_unique'
    ) THEN
        ALTER TABLE public.agendamentos
            ADD CONSTRAINT agendamentos_prof_data_aula_unique
            UNIQUE (professor_id, data, aula_numero);
    END IF;
END $$;

-- Ajusta Foreign Keys para ON DELETE CASCADE (evita erro 23503 ao excluir professor/sala/turma)
DO $$
BEGIN
    -- agendamentos -> professores
    ALTER TABLE public.agendamentos DROP CONSTRAINT IF EXISTS agendamentos_professor_id_fkey;
    ALTER TABLE public.agendamentos
        ADD CONSTRAINT agendamentos_professor_id_fkey
        FOREIGN KEY (professor_id) REFERENCES public.professores(id) ON DELETE CASCADE;

    -- agendamentos -> salas
    ALTER TABLE public.agendamentos DROP CONSTRAINT IF EXISTS agendamentos_sala_id_fkey;
    ALTER TABLE public.agendamentos
        ADD CONSTRAINT agendamentos_sala_id_fkey
        FOREIGN KEY (sala_id) REFERENCES public.salas(id) ON DELETE CASCADE;

    -- agendamentos -> turmas
    ALTER TABLE public.agendamentos DROP CONSTRAINT IF EXISTS agendamentos_turma_id_fkey;
    ALTER TABLE public.agendamentos
        ADD CONSTRAINT agendamentos_turma_id_fkey
        FOREIGN KEY (turma_id) REFERENCES public.turmas(id) ON DELETE CASCADE;

    -- inscricoes_push -> professores
    ALTER TABLE public.inscricoes_push DROP CONSTRAINT IF EXISTS inscricoes_push_professor_id_fkey;
    ALTER TABLE public.inscricoes_push
        ADD CONSTRAINT inscricoes_push_professor_id_fkey
        FOREIGN KEY (professor_id) REFERENCES public.professores(id) ON DELETE CASCADE;
END $$;

-- ------------------------------------------------------------
-- 2. ÍNDICES DE PERFORMANCE PARA CONSULTAS RÁPIDAS
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agendamentos_data_sala ON public.agendamentos (data, sala_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_professor_data ON public.agendamentos (professor_id, data);
CREATE INDEX IF NOT EXISTS idx_agendamentos_turma ON public.agendamentos (turma_id);
CREATE INDEX IF NOT EXISTS idx_professores_auth_id ON public.professores (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_professores_nome ON public.professores (nome);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_status ON public.solicitacoes_acesso (status);

-- ------------------------------------------------------------
-- 3. HABILITAR ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS public.disciplinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.salas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.turmas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.professores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.solicitacoes_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inscricoes_push ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 4. POLÍTICAS: DISCIPLINAS
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "disciplinas_leitura_publica" ON public.disciplinas;
CREATE POLICY "disciplinas_leitura_publica" ON public.disciplinas
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "disciplinas_modificacao_coord" ON public.disciplinas;
CREATE POLICY "disciplinas_modificacao_coord" ON public.disciplinas
    FOR ALL TO authenticated
    USING ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno')
    WITH CHECK ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno');

-- ------------------------------------------------------------
-- 5. POLÍTICAS: SALAS
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "salas_leitura_publica" ON public.salas;
CREATE POLICY "salas_leitura_publica" ON public.salas
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "salas_modificacao_coord" ON public.salas;
CREATE POLICY "salas_modificacao_coord" ON public.salas
    FOR ALL TO authenticated
    USING ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno')
    WITH CHECK ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno');

-- ------------------------------------------------------------
-- 6. POLÍTICAS: TURMAS
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "turmas_leitura_publica" ON public.turmas;
CREATE POLICY "turmas_leitura_publica" ON public.turmas
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "turmas_modificacao_coord" ON public.turmas;
CREATE POLICY "turmas_modificacao_coord" ON public.turmas
    FOR ALL TO authenticated
    USING ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno')
    WITH CHECK ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno');

-- ------------------------------------------------------------
-- 7. POLÍTICAS: PROFESSORES
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "professores_leitura_publica" ON public.professores;
CREATE POLICY "professores_leitura_publica" ON public.professores
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "professores_gestao_coord" ON public.professores;
CREATE POLICY "professores_gestao_coord" ON public.professores
    FOR ALL TO authenticated
    USING ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno')
    WITH CHECK ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno');

DROP POLICY IF EXISTS "professores_update_proprio" ON public.professores;
CREATE POLICY "professores_update_proprio" ON public.professores
    FOR UPDATE TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());

-- ------------------------------------------------------------
-- 8. POLÍTICAS: SOLICITAÇÕES DE ACESSO
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "solicitacoes_inserir_publico" ON public.solicitacoes_acesso;
CREATE POLICY "solicitacoes_inserir_publico" ON public.solicitacoes_acesso
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "solicitacoes_gestao_coord" ON public.solicitacoes_acesso;
CREATE POLICY "solicitacoes_gestao_coord" ON public.solicitacoes_acesso
    FOR ALL TO authenticated
    USING ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno')
    WITH CHECK ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno');

-- ------------------------------------------------------------
-- 9. POLÍTICAS: AGENDAMENTOS
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "agendamentos_leitura_publica" ON public.agendamentos;
CREATE POLICY "agendamentos_leitura_publica" ON public.agendamentos
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "agendamentos_gestao_coord" ON public.agendamentos;
CREATE POLICY "agendamentos_gestao_coord" ON public.agendamentos
    FOR ALL TO authenticated
    USING ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno')
    WITH CHECK ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno');

DROP POLICY IF EXISTS "agendamentos_inserir_professor" ON public.agendamentos;
CREATE POLICY "agendamentos_inserir_professor" ON public.agendamentos
    FOR INSERT TO authenticated
    WITH CHECK (
        (auth.jwt() ->> 'email') = 'coordenacao@locus.interno'
        OR
        EXISTS (
            SELECT 1 FROM public.professores p
            WHERE p.id = agendamentos.professor_id
              AND p.auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "agendamentos_deletar_professor" ON public.agendamentos;
CREATE POLICY "agendamentos_deletar_professor" ON public.agendamentos
    FOR DELETE TO authenticated
    USING (
        (auth.jwt() ->> 'email') = 'coordenacao@locus.interno'
        OR
        EXISTS (
            SELECT 1 FROM public.professores p
            WHERE p.id = agendamentos.professor_id
              AND p.auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 10. POLÍTICAS: NOTIFICAÇÕES PUSH
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "push_inserir_dispositivo" ON public.inscricoes_push;
CREATE POLICY "push_inserir_dispositivo" ON public.inscricoes_push
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "push_deletar_dispositivo" ON public.inscricoes_push;
CREATE POLICY "push_deletar_dispositivo" ON public.inscricoes_push
    FOR DELETE USING (true);

DROP POLICY IF EXISTS "push_leitura_coord" ON public.inscricoes_push;
CREATE POLICY "push_leitura_coord" ON public.inscricoes_push
    FOR SELECT TO authenticated
    USING ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno');

-- ------------------------------------------------------------
-- 11. FUNÇÃO RPC: VERIFICAR SE JÁ EXISTE SOLICITAÇÃO PENDENTE
-- Permite que a tela de cadastro verifique duplicidade com segurança
-- sem expor a tabela solicitacoes_acesso (e sem expor PINs).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_solicitacao_existente(p_nome text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.solicitacoes_acesso
        WHERE LOWER(TRIM(nome)) = LOWER(TRIM(p_nome))
          AND status = 'pendente'
    );
$$;

GRANT EXECUTE ON FUNCTION public.verificar_solicitacao_existente(text) TO anon, authenticated;
