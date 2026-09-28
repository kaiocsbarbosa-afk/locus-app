-- ============================================================
-- LOCUS - ADICIONAR COLUNA TELEFONE (WHATSAPP)
-- ============================================================
-- Execute este script no SQL Editor do seu painel Supabase:
-- https://supabase.com/dashboard/project/ixhuqbfzwkobhrvlzwgm/sql

-- 1. Adiciona o campo telefone na tabela de solicitações de novos professores
ALTER TABLE public.solicitacoes_acesso 
    ADD COLUMN IF NOT EXISTS telefone text;

-- 2. Adiciona o campo telefone na tabela de professores cadastrados
ALTER TABLE public.professores 
    ADD COLUMN IF NOT EXISTS telefone text;

-- 3. Cria índices para otimizar consultas por telefone
CREATE INDEX IF NOT EXISTS idx_professores_telefone ON public.professores (telefone);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_telefone ON public.solicitacoes_acesso (telefone);
