-- ============================================================
-- LOCUS - ATUALIZAÇÃO DAS TURMAS DO DIURNO / INTEGRAL
-- ============================================================
-- Execute este script no SQL Editor do seu painel Supabase se desejar
-- sincronizar manualmente ou restaurar as turmas:
-- https://supabase.com/dashboard/project/ixhuqbfzwkobhrvlzwgm/sql

-- 1. Remove as turmas antigas do diurno (preservando as turmas da EJA)
DELETE FROM public.turmas
WHERE UPPER(nome) NOT LIKE '%EJA%'
  AND UPPER(nome) NOT LIKE '%NOTURNO%';

-- 2. Insere as novas turmas solicitadas
INSERT INTO public.turmas (nome) VALUES
    ('1 I01 LCH'),
    ('1 I02 LCH'),
    ('1 I01 IPI'),
    ('1 I01 MCN'),
    ('2 I01 LCH'),
    ('2 I02 LCH'),
    ('2 I01 IPI'),
    ('3 I01 ESP'),
    ('3 I02 ESP'),
    ('3 I01 IPI'),
    ('3 I01 HUM')
ON CONFLICT DO NOTHING;
