-- ANA TAGES v2.0.27 — painel técnico restrito de uso do Supabase
-- Mostra apenas métricas agregadas. Não retorna pacientes, prontuários, sessões ou valores financeiros.

begin;

create or replace function public.get_supabase_usage_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, storage
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_database_bytes bigint := 0;
  v_storage_bytes bigint := 0;
  v_storage_objects bigint := 0;
  v_auth_users bigint := 0;
  v_active_users_month bigint := 0;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;

  select coalesce(raw_app_meta_data ->> 'tages_role', '')
    into v_role
  from auth.users
  where id = v_uid;

  if v_role <> 'usage_monitor' then
    raise exception 'Acesso técnico restrito' using errcode = '42501';
  end if;

  select pg_database_size(current_database()) into v_database_bytes;

  select
    coalesce(sum(
      case
        when metadata is not null
          and metadata ? 'size'
          and coalesce(metadata ->> 'size', '') ~ '^[0-9]+$'
        then (metadata ->> 'size')::bigint
        else 0
      end
    ), 0),
    count(*)
  into v_storage_bytes, v_storage_objects
  from storage.objects;

  select
    count(*),
    count(*) filter (where last_sign_in_at >= date_trunc('month', now()))
  into v_auth_users, v_active_users_month
  from auth.users;

  return jsonb_build_object(
    'database_bytes', v_database_bytes,
    'storage_bytes', v_storage_bytes,
    'storage_objects', v_storage_objects,
    'auth_users', v_auth_users,
    'active_users_month', v_active_users_month,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.get_supabase_usage_snapshot() from public, anon;
grant execute on function public.get_supabase_usage_snapshot() to authenticated;

comment on function public.get_supabase_usage_snapshot() is
  'Métricas agregadas de uso do projeto, disponíveis somente ao usuário com app_metadata.tages_role=usage_monitor e sessão AAL2.';

commit;
