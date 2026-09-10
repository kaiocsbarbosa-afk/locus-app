-- ============================================================
-- LOCUS - FUNÇÃO RPC PARA ALTERAÇÃO DE PIN DE 4 DÍGITOS
-- ============================================================
-- Execute este script no SQL Editor do seu painel Supabase:
-- https://supabase.com/dashboard/project/ixhuqbfzwkobhrvlzwgm/sql
--
-- MOTIVO:
-- A API padrão do Supabase GoTrue (supabase.auth.updateUser)
-- rejeita senhas com menos de 6 caracteres (erro 422: weak_password).
-- Esta função com SECURITY DEFINER atualiza com segurança o hash
-- bcrypt (crypt) diretamente no auth.users para o usuário logado (auth.uid()),
-- permitindo que o PIN de 4 dígitos seja alterado com sucesso.
-- ============================================================

CREATE OR REPLACE FUNCTION public.alterar_meu_pin(novo_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- 1. Garante que há um usuário autenticado na sessão
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN json_build_object('sucesso', false, 'erro', 'Sessão inválida ou não autenticada.');
    END IF;

    -- 2. Valida se o PIN possui exatamente 4 dígitos numéricos
    IF novo_pin !~ '^\d{4}$' THEN
        RETURN json_build_object('sucesso', false, 'erro', 'O PIN deve conter exatamente 4 dígitos numéricos.');
    END IF;

    -- 3. Atualiza o hash bcrypt da senha diretamente em auth.users
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(novo_pin, extensions.gen_salt('bf')),
        updated_at = now()
    WHERE id = v_user_id;

    RETURN json_build_object('sucesso', true);
END;
$$;

-- Permite que qualquer usuário logado (authenticated) execute a função
GRANT EXECUTE ON FUNCTION public.alterar_meu_pin(text) TO authenticated;
