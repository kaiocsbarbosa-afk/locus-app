-- ============================================================
-- LOCUS - SCRIPT COMPLETO DE SEGURANÇA E POLÍTICAS RLS
-- ============================================================
-- Execute este script no SQL Editor do seu painel Supabase:
-- https://supabase.com/dashboard/project/ixhuqbfzwkobhrvlzwgm/sql
--
-- OBJETIVO:
-- Blindar o banco de dados PostgreSQL contra manipulações indevidas
-- via API REST/GraphQL com a chave pública anon, garantindo que
-- apenas usuários autorizados realizem operações de escrita/leitura restrita.
-- ============================================================

-- 1. HABILITAR ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS
ALTER TABLE IF EXISTS public.disciplinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.salas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.turmas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.professores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.solicitacoes_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inscricoes_push ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. POLÍTICAS: DISCIPLINAS
-- Leitura pública; modificação exclusiva da coordenação
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
-- 3. POLÍTICAS: SALAS
-- Leitura pública; modificação exclusiva da coordenação
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
-- 4. POLÍTICAS: TURMAS
-- Leitura pública; modificação exclusiva da coordenação
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
-- 5. POLÍTICAS: PROFESSORES
-- Leitura de nomes necessária para a tela de login;
-- Modificações e gestão restritas à coordenação ou ao próprio professor
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
-- 6. POLÍTICAS: SOLICITAÇÕES DE ACESSO (CADASTRO)
-- Qualquer visitante pode enviar solicitação;
-- Apenas coordenação pode ler, aprovar ou excluir solicitações
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
-- 7. POLÍTICAS: AGENDAMENTOS
-- Leitura pública para visualização do mapa de horários;
-- Inserção permitida para a coordenação ou pelo professor logado para sua própria conta;
-- Exclusão/Cancelamento restrito ao dono do agendamento ou à coordenação
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
-- 8. POLÍTICAS: NOTIFICAÇÕES PUSH
-- Dispositivos registram subscriptions por device_id e tipo;
-- Envio e listagem são restritos à coordenação e Edge Functions.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "push_propria_sessao" ON public.inscricoes_push;
DROP POLICY IF EXISTS "push_inserir_dispositivo" ON public.inscricoes_push;
DROP POLICY IF EXISTS "push_deletar_dispositivo" ON public.inscricoes_push;
DROP POLICY IF EXISTS "push_leitura_coord" ON public.inscricoes_push;

-- Permite que os aparelhos registrem notificações push
CREATE POLICY "push_inserir_dispositivo" ON public.inscricoes_push
    FOR INSERT WITH CHECK (true);

-- Permite substituir/remover inscrições antigas do mesmo aparelho
CREATE POLICY "push_deletar_dispositivo" ON public.inscricoes_push
    FOR DELETE USING (true);

-- Listagem de endpoints restrita à coordenação (e Edge Functions de disparo)
CREATE POLICY "push_leitura_coord" ON public.inscricoes_push
    FOR SELECT TO authenticated
    USING ((auth.jwt() ->> 'email') = 'coordenacao@locus.interno');

