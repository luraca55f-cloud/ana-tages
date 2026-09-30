-- ANA TAGES v2.0.27 — LIMPEZA OPCIONAL DOS DADOS DA CONTA TÉCNICA
-- ATENÇÃO: APAGA DEFINITIVAMENTE os dados de consultório pertencentes ao usuário técnico.
-- NÃO apaga a conta de autenticação; ela permanece disponível para o painel de uso do Supabase.
-- Execute SOMENTE depois de confirmar que a conta da Ana foi criada e está funcionando.

begin;

do $$
declare
  v_count integer;
  v_owner uuid;
begin
  select count(*), min(id)
    into v_count, v_owner
  from auth.users
  where coalesce(raw_app_meta_data ->> 'tages_role', '') = 'usage_monitor';

  if v_count <> 1 or v_owner is null then
    raise exception 'Esperado exatamente 1 usuário técnico usage_monitor; encontrado(s): %.', v_count;
  end if;

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

  raise notice 'Dados do consultório da conta técnica removidos. A conta Auth foi preservada para o monitor de uso.';
end $$;

commit;
