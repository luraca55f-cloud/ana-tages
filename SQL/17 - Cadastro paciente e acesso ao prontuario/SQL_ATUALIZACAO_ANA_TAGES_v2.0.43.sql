-- ANA TAGES v2.0.43 — cadastro do paciente e acesso estável ao prontuário
--
-- Objetivo:
--   * manter o Google Authenticator como proteção da sessão (AAL2);
--   * eliminar o loop que exigia um NOVO TOTP a cada abertura de prontuário;
--   * reutilizar a sessão AAL2 já validada no login para conceder acesso clínico temporário;
--   * preservar RLS, isolamento por owner_id, cofre clínico e criptografia das evoluções.
--
-- SQL incremental. Execute SOMENTE este arquivo ao atualizar da v2.0.42.

begin;

create or replace function public.grant_clinical_access(p_patient_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_session text := public.current_session_id();
  v_exp timestamptz := now() + interval '30 minutes';
  -- A coluna foi criada originalmente para registrar o evento TOTP.
  -- A partir desta versão, o step-up é validado por has_aal2() e este valor funciona
  -- apenas como marcador único da concessão, sem exigir um novo TOTP por prontuário.
  v_grant_marker bigint := floor(extract(epoch from clock_timestamp()) * 1000000)::bigint;
begin
  if v_uid is null or v_session is null or not public.has_aal2() then
    raise exception 'Sessão MFA/AAL2 obrigatória' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.patients
    where id = p_patient_id
      and owner_id = v_uid
      and archived_at is null
  ) then
    raise exception 'Paciente inválido' using errcode = '42501';
  end if;

  -- Mantém somente um prontuário ativo por sessão.
  update public.clinical_access_grants
  set revoked_at = now()
  where owner_id = v_uid
    and session_id = v_session
    and revoked_at is null;

  insert into public.clinical_access_grants(
    owner_id,
    patient_id,
    session_id,
    totp_timestamp,
    expires_at,
    revoked_at
  )
  values (
    v_uid,
    p_patient_id,
    v_session,
    v_grant_marker,
    v_exp,
    null
  );

  return v_exp;
end;
$$;

revoke all on function public.grant_clinical_access(uuid) from public, anon;
grant execute on function public.grant_clinical_access(uuid) to authenticated;

commit;
