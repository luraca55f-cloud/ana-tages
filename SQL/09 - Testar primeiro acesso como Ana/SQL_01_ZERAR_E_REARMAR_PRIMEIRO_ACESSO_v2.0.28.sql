-- ANA TAGES v2.0.28 — SQL 09 FINAL — HOMOLOGAR PRIMEIRO ACESSO COMO UMA CONTA NOVA
--
-- OBJETIVO
-- Transformar a ÚNICA conta existente no Supabase em uma conta de homologação que se comporta,
-- no próximo login, como uma conta recém-entregue para a Ana:
--   senha atual (temporária) -> criar nova senha -> configurar novo Google Authenticator -> sistema zerado.
--
-- IMPORTANTE
-- * Só executa se existir EXATAMENTE 1 usuário em auth.users.
-- * NÃO apaga o usuário Auth, NÃO altera o e-mail e NÃO altera a senha atual.
-- * APAGA os dados funcionais pertencentes a esse usuário.
-- * REMOVE os fatores MFA/TOTP antigos desse usuário.
-- * REVOGA sessões e refresh tokens antigos, para não reaproveitar AAL2/MFA anterior.
-- * Remove eventual papel técnico usage_monitor.
-- * Rearma must_change_password=true.
--
-- Depois de executar com sucesso, abra o ANA TAGES novamente e faça login com a SENHA ATUAL.
-- Ela será tratada como senha temporária. O fluxo esperado é:
--   1) criar uma nova senha;
--   2) configurar um NOVO Google Authenticator;
--   3) entrar no sistema zerado.
--
-- Este script pode ser executado novamente depois dos testes para zerar a homologação antes da entrega real.

begin;

do $$
declare
  v_count integer;
  v_owner uuid;
  v_email text;
  v_storage_count bigint := 0;
  v_factor_count bigint := 0;
  v_session_count bigint := 0;
begin
  -- Proteção principal: este script nunca escolhe entre várias contas.
  select count(*) into v_count from auth.users;

  if v_count <> 1 then
    raise exception 'Este script exige exatamente 1 usuário no Auth. Encontrado(s): %. Nenhum dado foi apagado.', v_count;
  end if;

  select id, email
    into v_owner, v_email
  from auth.users
  limit 1;

  if v_owner is null then
    raise exception 'Não foi possível identificar o único usuário do Auth. Nenhum dado foi apagado.';
  end if;

  -- Conta quantos fatores/sessões existem apenas para informar ao final.
  select count(*) into v_factor_count
  from auth.mfa_factors
  where user_id = v_owner;

  select count(*) into v_session_count
  from auth.sessions
  where user_id = v_owner;

  -- ============================================================
  -- 1. ZERA OS DADOS FUNCIONAIS DA CONTA
  -- ============================================================
  -- A ordem respeita as dependências atuais do schema ANA TAGES.
  delete from public.clinical_access_grants where owner_id = v_owner;
  delete from public.clinical_notes where owner_id = v_owner;
  delete from public.billing_entries where owner_id = v_owner;
  delete from public.appointments where owner_id = v_owner;
  delete from public.package_plans where owner_id = v_owner;
  delete from public.expenses where owner_id = v_owner;
  delete from public.materials where owner_id = v_owner;
  delete from public.service_work_entries where owner_id = v_owner;
  delete from public.audit_log where owner_id = v_owner;
  delete from public.app_settings where owner_id = v_owner;
  delete from public.patients where owner_id = v_owner;

  -- ============================================================
  -- 2. REMOVE O MFA ANTIGO PARA O TESTE SER UM PRIMEIRO ACESSO REAL
  -- ============================================================
  -- auth.mfa_challenges possui ON DELETE CASCADE para auth.mfa_factors,
  -- então os desafios antigos do fator também são eliminados automaticamente.
  delete from auth.mfa_factors
  where user_id = v_owner;

  -- ============================================================
  -- 3. REVOGA SESSÕES ANTIGAS / AAL2 ANTIGO
  -- ============================================================
  -- Primeiro remove refresh tokens vinculados ao usuário; depois as sessões.
  -- Isso evita que uma sessão anterior continue carregando o estado MFA/AAL2.
  delete from auth.refresh_tokens
  where user_id = v_owner::text;

  delete from auth.sessions
  where user_id = v_owner;

  -- ============================================================
  -- 4. REARMA O PRIMEIRO ACESSO E GARANTE ACESSO COMPLETO
  -- ============================================================
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'tages_role',
      raw_user_meta_data = (coalesce(raw_user_meta_data, '{}'::jsonb) - 'password_changed_at')
        || jsonb_build_object('must_change_password', true),
      updated_at = now()
  where id = v_owner;

  -- ============================================================
  -- 5. AVISO SOBRE STORAGE
  -- ============================================================
  -- Arquivos físicos do Storage não são apagados diretamente por SQL para evitar objetos órfãos.
  select count(*)
    into v_storage_count
  from storage.objects
  where bucket_id = 'materials-private'
    and (storage.foldername(name))[1] = v_owner::text;

  raise notice 'Conta preparada como primeiro acesso real: %', coalesce(v_email, v_owner::text);
  raise notice 'Dados funcionais apagados; fatores MFA removidos: %; sessões antigas removidas: %.', v_factor_count, v_session_count;
  raise notice 'A senha atual continua válida apenas para o próximo login e será tratada como senha temporária pelo ANA TAGES.';
  raise notice 'Fluxo esperado: login com senha atual -> criar nova senha -> configurar novo Google Authenticator -> sistema zerado.';

  if v_storage_count > 0 then
    raise notice 'ATENÇÃO: existem % arquivo(s) antigo(s) no Storage materials-private. Eles não aparecem mais no sistema, mas continuam consumindo Storage até serem removidos pelo painel/API.', v_storage_count;
  end if;
end $$;

commit;
