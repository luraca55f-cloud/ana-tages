-- ANA TAGES v2.0.46: cancelamento individual sem apagar pagamentos.
begin;
alter table public.patients add column if not exists birth_date date;
grant insert (birth_date), update (birth_date) on public.patients to authenticated;
alter table public.billing_entries add column if not exists manually_cancelled_at timestamptz;

create or replace function public.guard_manual_billing_cancellation_v2046()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    -- Uma reconciliação automática não pode reabrir um débito cancelado manualmente.
    if old.manually_cancelled_at is not null then return null; end if;
    return new;
  end if;
  if new.appointment_id is not null and exists (
    select 1 from public.billing_entries b where b.owner_id = new.owner_id
      and b.appointment_id = new.appointment_id and b.manually_cancelled_at is not null
  ) then
    if new.auto_key = 'session:' || new.appointment_id::text then
      return null;
    end if;
    -- Reparcelar automaticamente após uma exclusão poderia recriar o saldo indevido.
    raise exception 'Este atendimento possui débito cancelado manualmente. Não é possível recriar o parcelamento.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_manual_billing_cancellation_v2046() from public, anon, authenticated;
drop trigger if exists billing_manual_cancellation_guard_v2046 on public.billing_entries;
create trigger billing_manual_cancellation_guard_v2046 before insert or update on public.billing_entries
for each row execute function public.guard_manual_billing_cancellation_v2046();

create or replace function public.cancel_open_billing_v2046(p_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid();
  v_appointment_id uuid;
  v_row public.billing_entries%rowtype;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  select appointment_id into v_appointment_id from public.billing_entries where id = p_id and owner_id = v_uid;
  if not found then raise exception 'Cobrança não encontrada' using errcode = 'P0002'; end if;
  if v_appointment_id is not null then
    perform 1 from public.appointments where id = v_appointment_id and owner_id = v_uid for update;
  end if;
  select * into v_row from public.billing_entries where id = p_id and owner_id = v_uid for update;
  if not found then raise exception 'Cobrança não encontrada' using errcode = 'P0002'; end if;
  if v_row.manually_cancelled_at is not null then return; end if;
  if v_row.status <> 'pending' or v_row.received_amount <> 0 then
    raise exception 'Somente débitos sem recebimento podem ser excluídos.' using errcode = '22023';
  end if;
  update public.billing_entries set status = 'cancelled', manually_cancelled_at = now(), updated_at = now()
    where id = p_id and owner_id = v_uid;
end;
$$;
revoke all on function public.cancel_open_billing_v2046(uuid) from public, anon;
grant execute on function public.cancel_open_billing_v2046(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
