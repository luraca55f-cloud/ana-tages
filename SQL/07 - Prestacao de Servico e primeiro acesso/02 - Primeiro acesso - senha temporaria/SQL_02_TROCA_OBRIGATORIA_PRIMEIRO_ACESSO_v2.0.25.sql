-- ANA TAGES v2.0.25 — senha temporária no primeiro acesso
-- Contas que JÁ EXISTEM ao executar este SQL são marcadas como já configuradas.
-- Contas criadas DEPOIS recebem must_change_password=true automaticamente.

begin;

-- Não interrompe a conta atualmente usada para realizar a atualização.
update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('must_change_password', false)
where coalesce((raw_user_meta_data ->> 'must_change_password')::boolean, false) is false;

create or replace function public.mark_new_tages_user_temporary_password()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('must_change_password', true);
  return new;
end;
$$;

revoke all on function public.mark_new_tages_user_temporary_password() from public, anon, authenticated;

drop trigger if exists tages_new_user_temporary_password on auth.users;
create trigger tages_new_user_temporary_password
before insert on auth.users
for each row execute function public.mark_new_tages_user_temporary_password();

commit;
