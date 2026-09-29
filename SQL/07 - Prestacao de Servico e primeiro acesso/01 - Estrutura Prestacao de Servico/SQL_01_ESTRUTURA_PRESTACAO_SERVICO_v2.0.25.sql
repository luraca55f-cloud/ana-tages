-- ANA TAGES v2.0.25 — Prestação de Serviço (financeiro isolado)
-- Execute depois dos SQLs anteriores já aplicados.
-- Tudo desta tabela é separado de billing_entries/expenses do consultório.

begin;

create table if not exists public.service_work_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  kind text not null check (kind in ('income','expense')),
  client_name text,
  description text not null check (char_length(trim(description)) between 1 and 240),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  paid_at date,
  payment_method text check (payment_method is null or payment_method in ('pix','bank_transfer','cash','credit_card','debit_card','other')),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_work_entries_id_owner_unique unique (id, owner_id),
  constraint service_work_paid_consistency check (
    (status = 'paid' and paid_at is not null)
    or (status <> 'paid' and paid_at is null)
  )
);

create index if not exists service_work_owner_due_idx
  on public.service_work_entries(owner_id, due_date desc);
create index if not exists service_work_owner_status_idx
  on public.service_work_entries(owner_id, status, kind);

drop trigger if exists service_work_set_updated_at on public.service_work_entries;
create trigger service_work_set_updated_at
before update on public.service_work_entries
for each row execute function public.set_updated_at();

drop trigger if exists service_work_owner_guard on public.service_work_entries;
create trigger service_work_owner_guard
before insert or update on public.service_work_entries
for each row execute function public.require_same_owner();

drop trigger if exists service_work_audit on public.service_work_entries;
create trigger service_work_audit
after insert or update or delete on public.service_work_entries
for each row execute function public.audit_row_change();

alter table public.service_work_entries enable row level security;
revoke all on public.service_work_entries from public, anon, authenticated;
grant select on public.service_work_entries to authenticated;

drop policy if exists service_work_mfa_boundary on public.service_work_entries;
create policy service_work_mfa_boundary on public.service_work_entries
as restrictive for all to authenticated
using (public.has_aal2())
with check (public.has_aal2());

drop policy if exists service_work_owner_boundary on public.service_work_entries;
create policy service_work_owner_boundary on public.service_work_entries
as restrictive for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists service_work_select on public.service_work_entries;
create policy service_work_select on public.service_work_entries
for select to authenticated
using (owner_id = auth.uid() and public.has_aal2());

create or replace function public.create_service_work_entry(
  p_kind text,
  p_client_name text,
  p_description text,
  p_amount numeric,
  p_due_date date,
  p_status text,
  p_paid_at date,
  p_payment_method text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if p_kind not in ('income','expense') then raise exception 'Tipo inválido' using errcode = '22023'; end if;
  if p_description is null or char_length(trim(p_description)) < 1 or char_length(trim(p_description)) > 240 then raise exception 'Descrição inválida' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then raise exception 'Valor inválido' using errcode = '22023'; end if;
  if p_due_date is null then raise exception 'Data obrigatória' using errcode = '22023'; end if;
  if p_status not in ('pending','paid','cancelled') then raise exception 'Situação inválida' using errcode = '22023'; end if;
  if p_status = 'paid' and p_paid_at is null then raise exception 'Data de pagamento obrigatória' using errcode = '22023'; end if;

  insert into public.service_work_entries(owner_id, kind, client_name, description, amount, due_date, status, paid_at, payment_method, notes)
  values (
    v_uid,
    p_kind,
    nullif(left(trim(coalesce(p_client_name,'')),160),''),
    left(trim(p_description),240),
    round(p_amount,2),
    p_due_date,
    p_status,
    case when p_status = 'paid' then p_paid_at else null end,
    case when p_status = 'paid' and p_payment_method in ('pix','bank_transfer','cash','credit_card','debit_card','other') then p_payment_method else null end,
    nullif(left(trim(coalesce(p_notes,'')),2000),'')
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_service_work_entry(
  p_id uuid,
  p_kind text,
  p_client_name text,
  p_description text,
  p_amount numeric,
  p_due_date date,
  p_status text,
  p_paid_at date,
  p_payment_method text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_aal2() then raise exception 'MFA obrigatório' using errcode = '42501'; end if;
  if p_kind not in ('income','expense') or p_status not in ('pending','paid','cancelled') then raise exception 'Dados inválidos' using errcode = '22023'; end if;
  if p_description is null or char_length(trim(p_description)) < 1 or char_length(trim(p_description)) > 240 then raise exception 'Descrição inválida' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_due_date is null then raise exception 'Valor/data inválidos' using errcode = '22023'; end if;
  if p_status = 'paid' and p_paid_at is null then raise exception 'Data de pagamento obrigatória' using errcode = '22023'; end if;

  update public.service_work_entries
  set kind = p_kind,
      client_name = nullif(left(trim(coalesce(p_client_name,'')),160),''),
      description = left(trim(p_description),240),
      amount = round(p_amount,2),
      due_date = p_due_date,
      status = p_status,
      paid_at = case when p_status = 'paid' then p_paid_at else null end,
      payment_method = case when p_status = 'paid' and p_payment_method in ('pix','bank_transfer','cash','credit_card','debit_card','other') then p_payment_method else null end,
      notes = nullif(left(trim(coalesce(p_notes,'')),2000),'')
  where id = p_id and owner_id = v_uid;
  if not found then raise exception 'Lançamento não encontrado'; end if;
end;
$$;

create or replace function public.mark_service_work_paid(p_id uuid, p_paid_at date, p_payment_method text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_aal2() then raise exception 'MFA obrigatório' using errcode = '42501'; end if;
  if p_paid_at is null then raise exception 'Data de pagamento obrigatória' using errcode = '22023'; end if;
  update public.service_work_entries
  set status = 'paid', paid_at = p_paid_at,
      payment_method = case when p_payment_method in ('pix','bank_transfer','cash','credit_card','debit_card','other') then p_payment_method else 'other' end
  where id = p_id and owner_id = v_uid and status = 'pending';
  if not found then raise exception 'Lançamento pendente não encontrado'; end if;
end;
$$;

create or replace function public.delete_service_work_entry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_aal2() then raise exception 'MFA obrigatório' using errcode = '42501'; end if;
  delete from public.service_work_entries where id = p_id and owner_id = v_uid;
  if not found then raise exception 'Lançamento não encontrado'; end if;
end;
$$;

revoke all on function public.create_service_work_entry(text,text,text,numeric,date,text,date,text,text) from public, anon;
revoke all on function public.update_service_work_entry(uuid,text,text,text,numeric,date,text,date,text,text) from public, anon;
revoke all on function public.mark_service_work_paid(uuid,date,text) from public, anon;
revoke all on function public.delete_service_work_entry(uuid) from public, anon;
grant execute on function public.create_service_work_entry(text,text,text,numeric,date,text,date,text,text) to authenticated;
grant execute on function public.update_service_work_entry(uuid,text,text,text,numeric,date,text,date,text,text) to authenticated;
grant execute on function public.mark_service_work_paid(uuid,date,text) to authenticated;
grant execute on function public.delete_service_work_entry(uuid) to authenticated;

comment on table public.service_work_entries is 'Financeiro isolado do módulo Prestação de Serviço; não participa do Dashboard/Financeiro do consultório.';

commit;
