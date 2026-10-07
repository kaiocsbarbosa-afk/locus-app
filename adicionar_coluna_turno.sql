-- ============================================================
-- LOCUS - ADICIONAR COLUNA TURNO (MANHÃ / EJA)
-- ============================================================
-- Execute este script no SQL Editor do seu painel Supabase:
-- https://supabase.com/dashboard/project/ixhuqbfzwkobhrvlzwgm/sql

-- 1. Adiciona a coluna turno na tabela de solicitações de acesso (padrão: 'manha')
ALTER TABLE public.solicitacoes_acesso 
    ADD COLUMN IF NOT EXISTS turno text DEFAULT 'manha';

-- 2. Adiciona a coluna turno na tabela de professores (padrão: 'manha')
ALTER TABLE public.professores 
    ADD COLUMN IF NOT EXISTS turno text DEFAULT 'manha';

-- 3. Cria índices para consultas rápidas por turno
CREATE INDEX IF NOT EXISTS idx_solicitacoes_turno ON public.solicitacoes_acesso (turno);
CREATE INDEX IF NOT EXISTS idx_professores_turno ON public.professores (turno);
