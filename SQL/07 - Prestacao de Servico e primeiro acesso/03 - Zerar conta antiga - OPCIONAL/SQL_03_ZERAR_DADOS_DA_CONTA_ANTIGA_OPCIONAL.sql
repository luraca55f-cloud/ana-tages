-- ANA TAGES v2.0.25 — LIMPEZA OPCIONAL DA CONTA ANTIGA
-- ATENÇÃO: este arquivo APAGA DEFINITIVAMENTE os dados da conta informada abaixo.
-- Execute SOMENTE depois que a conta nova da Ana estiver criada, testada e funcionando.
-- O objetivo é liberar a exclusão do usuário antigo no Supabase, pois várias tabelas usam ON DELETE RESTRICT.
--
-- Antes de executar, confira o e-mail em v_email. O valor abaixo corresponde à conta usada nos testes atuais.

begin;

do $$
declare
  v_email text := 'deividv156@gmail.com';
  v_owner uuid;
begin
  select id into v_owner from auth.users where lower(email) = lower(v_email) limit 1;
  if v_owner is null then
    raise exception 'Usuário não encontrado para o e-mail %', v_email;
  end if;

  -- Dependências clínicas e financeiras primeiro.
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

  raise notice 'Dados da conta % (%) removidos. Agora a conta de autenticação pode ser excluída manualmente no Supabase.', v_email, v_owner;
end $$;

commit;
