-- ANA TAGES v2.0.19 — Parte 2: pacotes/planos com pagamento à vista ou parcelado
--
-- Objetivo:
--   * separar o conceito de pacote/plano do cadastro do paciente para preservar histórico;
--   * permitir valor total, pagamento à vista ou parcelado, quantidade de parcelas e 1º vencimento;
--   * criar automaticamente todas as cobranças em A receber;
--   * manter vínculo rastreável paciente ↔ pacote/plano ↔ cobrança;
--   * impedir que a antiga rotina mensal de pacote gere cobranças duplicadas.
--
-- Incremental. NÃO reexecute a migration inicial.

begin;

-- O modelo novo não depende mais de package_timing/billing_day. Esses campos ficam apenas
-- por compatibilidade histórica com versões antigas do frontend.
alter table public.patients drop constraint if exists patients_package_fields;
alter table public.patients
  add constraint patients_package_fields check (
    billing_model = 'session'
    or (package_amount is not null and package_amount > 0)
  );

create table if not exists public.package_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  patient_id uuid not null,
  client_request_id uuid,
  total_amount numeric(12,2) not null check (total_amount > 0 and total_amount <= 1000000),
  payment_mode text not null check (payment_mode in ('single','installments')),
  installment_count smallint not null check (installment_count between 1 and 60),
  first_due_date date not null,
  status text not null default 'active' check (status in ('active','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_plans_id_owner_unique unique (id, owner_id),
  constraint package_plans_request_unique unique (owner_id, client_request_id),
  constraint package_plans_patient_owner_fk foreign key (patient_id, owner_id)
    references public.patients(id, owner_id) on delete restrict,
  constraint package_plans_payment_shape check (
    (payment_mode = 'single' and installment_count = 1)
    or (payment_mode = 'installments' and installment_count between 2 and 60)
  )
);

create unique index if not exists package_plans_one_active_per_patient
  on public.package_plans(owner_id, patient_id)
  where status = 'active';
create index if not exists package_plans_owner_patient_idx
  on public.package_plans(owner_id, patient_id, status);

alter table public.billing_entries add column if not exists package_plan_id uuid;
alter table public.billing_entries add column if not exists installment_number smallint;
alter table public.billing_entries add column if not exists installment_count smallint;

-- Adiciona as FKs/checks somente uma vez para permitir reexecução segura deste incremental.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_package_plan_owner_fk'
      and conrelid = 'public.billing_entries'::regclass
  ) then
    alter table public.billing_entries
      add constraint billing_package_plan_owner_fk
      foreign key (package_plan_id, owner_id)
      references public.package_plans(id, owner_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_installment_metadata_valid'
      and conrelid = 'public.billing_entries'::regclass
  ) then
    alter table public.billing_entries
      add constraint billing_installment_metadata_valid check (
        (package_plan_id is null and installment_number is null and installment_count is null)
        or (
          package_plan_id is not null
          and installment_number between 1 and 60
          and installment_count between 1 and 60
          and installment_number <= installment_count
        )
      );
  end if;
end $$;

create index if not exists billing_package_plan_idx
  on public.billing_entries(owner_id, package_plan_id, installment_number);

-- Mantém updated_at, owner guard e auditoria também no novo objeto financeiro.
drop trigger if exists package_plans_set_updated_at on public.package_plans;
create trigger package_plans_set_updated_at
before update on public.package_plans
for each row execute function public.set_updated_at();

drop trigger if exists package_plans_owner_guard on public.package_plans;
create trigger package_plans_owner_guard
before insert or update on public.package_plans
for each row execute function public.require_same_owner();

drop trigger if exists package_plans_audit on public.package_plans;
create trigger package_plans_audit
after insert or update or delete on public.package_plans
for each row execute function public.audit_row_change();

alter table public.package_plans enable row level security;
revoke all on public.package_plans from public, anon, authenticated;
grant select on public.package_plans to authenticated;

drop policy if exists package_plans_mfa_boundary on public.package_plans;
create policy package_plans_mfa_boundary on public.package_plans
as restrictive for all to authenticated
using (public.has_aal2())
with check (public.has_aal2());

drop policy if exists package_plans_owner_boundary on public.package_plans;
create policy package_plans_owner_boundary on public.package_plans
as restrictive for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists package_plans_select on public.package_plans;
create policy package_plans_select on public.package_plans
for select to authenticated
using (owner_id = auth.uid() and public.has_aal2());

-- Cria ou reconfigura o plano ativo e suas parcelas em uma única transação no banco.
-- Se já existir parcela parcialmente paga, a reconfiguração é bloqueada para não criar
-- ambiguidade sobre saldo antigo. Parcelas totalmente pagas permanecem como histórico.
create or replace function public.save_patient_package_plan(
  p_patient_id uuid,
  p_total_amount numeric,
  p_payment_mode text,
  p_installment_count integer,
  p_first_due_date date,
  p_client_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_patient_name text;
  v_existing public.package_plans%rowtype;
  v_plan_id uuid;
  v_count integer;
  v_total numeric(12,2);
  v_total_cents bigint;
  v_base_cents bigint;
  v_installment_cents bigint;
  v_month_start date;
  v_month_last_day date;
  v_due date;
  v_first_day integer;
  i integer;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'Identificador idempotente obrigatório' using errcode = '22023';
  end if;
  if p_total_amount is null or p_total_amount <= 0 or p_total_amount > 1000000 then
    raise exception 'Valor total do pacote/plano inválido' using errcode = '22023';
  end if;
  if p_first_due_date is null then
    raise exception 'Data do primeiro pagamento obrigatória' using errcode = '22023';
  end if;
  if p_payment_mode not in ('single','installments') then
    raise exception 'Forma de pagamento inválida' using errcode = '22023';
  end if;

  v_count := case when p_payment_mode = 'single' then 1 else p_installment_count end;
  if v_count is null or v_count < 1 or v_count > 60
     or (p_payment_mode = 'installments' and v_count < 2) then
    raise exception 'Quantidade de parcelas inválida' using errcode = '22023';
  end if;

  select full_name into v_patient_name
  from public.patients
  where id = p_patient_id and owner_id = v_uid and archived_at is null
  for update;
  if not found then raise exception 'Paciente não encontrado'; end if;

  -- Retry idempotente: se esta requisição já foi concluída, devolve o mesmo plano.
  select id into v_plan_id
  from public.package_plans
  where owner_id = v_uid and client_request_id = p_client_request_id;
  if found then return v_plan_id; end if;

  select * into v_existing
  from public.package_plans
  where owner_id = v_uid and patient_id = p_patient_id and status = 'active'
  for update;

  v_total := round(p_total_amount, 2);

  if found then
    if v_existing.total_amount = v_total
       and v_existing.payment_mode = p_payment_mode
       and v_existing.installment_count = v_count
       and v_existing.first_due_date = p_first_due_date then
      return v_existing.id;
    end if;

    if exists (
      select 1 from public.billing_entries
      where owner_id = v_uid
        and package_plan_id = v_existing.id
        and received_amount > 0
    ) then
      raise exception 'Este plano já possui pagamento registrado. Para preservar o histórico e evitar cobrança duplicada, corrija o plano antes de registrar pagamentos ou mantenha a regra atual.'
        using errcode = '22023';
    end if;

    -- Parcelas ainda não pagas do plano anterior deixam de ser cobradas; pagamentos concluídos
    -- permanecem intactos e vinculados ao plano anterior para preservar histórico financeiro.
    update public.billing_entries
    set status = 'cancelled', received_amount = 0, received_at = null, updated_at = now()
    where owner_id = v_uid
      and package_plan_id = v_existing.id
      and status = 'pending'
      and received_amount = 0;

    update public.package_plans
    set status = 'cancelled', updated_at = now()
    where id = v_existing.id and owner_id = v_uid;
  end if;

  insert into public.package_plans(
    owner_id, patient_id, client_request_id, total_amount, payment_mode,
    installment_count, first_due_date, status
  ) values (
    v_uid, p_patient_id, p_client_request_id, v_total, p_payment_mode,
    v_count, p_first_due_date, 'active'
  ) returning id into v_plan_id;

  -- Mantém os campos legados apenas como resumo do cadastro. A verdade das parcelas passa
  -- a ser package_plans + billing_entries.
  update public.patients
  set billing_model = 'package',
      session_amount = null,
      package_amount = v_total,
      package_timing = null,
      billing_day = null,
      updated_at = now()
  where id = p_patient_id and owner_id = v_uid;

  v_total_cents := round(v_total * 100)::bigint;
  v_base_cents := v_total_cents / v_count;
  v_first_day := extract(day from p_first_due_date)::integer;

  for i in 1..v_count loop
    v_month_start := (date_trunc('month', p_first_due_date)::date + make_interval(months => i - 1))::date;
    v_month_last_day := (v_month_start + interval '1 month - 1 day')::date;
    v_due := make_date(
      extract(year from v_month_start)::integer,
      extract(month from v_month_start)::integer,
      least(v_first_day, extract(day from v_month_last_day)::integer)
    );
    v_installment_cents := case
      when i = v_count then v_total_cents - (v_base_cents * (v_count - 1))
      else v_base_cents
    end;

    insert into public.billing_entries(
      owner_id, patient_id, source_type, client_name, description,
      competence_date, issued_at, due_date, amount, status, received_amount,
      auto_key, package_plan_id, installment_number, installment_count
    ) values (
      v_uid, p_patient_id, 'package', v_patient_name,
      case when v_count = 1
        then 'Pacote / plano — pagamento único'
        else format('Pacote / plano — parcela %s/%s', i, v_count)
      end,
      v_due, current_date, v_due, (v_installment_cents::numeric / 100),
      'pending', 0,
      'package-plan:' || v_plan_id::text || ':' || i::text,
      v_plan_id, i, v_count
    )
    on conflict (owner_id, auto_key) do nothing;
  end loop;

  return v_plan_id;
end;
$$;

-- Ao trocar o paciente de pacote para cobrança por sessão, cancela somente parcelas futuras
-- ainda sem recebimento. Valores já pagos e parcelas parciais permanecem no histórico.
create or replace function public.cancel_patient_package_plan(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan_id uuid;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;

  select id into v_plan_id
  from public.package_plans
  where owner_id = v_uid and patient_id = p_patient_id and status = 'active'
  for update;

  if v_plan_id is not null then
    update public.billing_entries
    set status = 'cancelled', received_amount = 0, received_at = null, updated_at = now()
    where owner_id = v_uid
      and package_plan_id = v_plan_id
      and status = 'pending'
      and received_amount = 0;

    update public.package_plans
    set status = 'cancelled', updated_at = now()
    where id = v_plan_id and owner_id = v_uid;
  end if;

  update public.patients
  set billing_model = 'session',
      package_amount = null,
      package_timing = null,
      billing_day = null,
      updated_at = now()
  where id = p_patient_id and owner_id = v_uid and archived_at is null;
end;
$$;

-- Compatibilidade: versões antigas chamavam esta RPC a cada abertura do Financeiro e criavam
-- uma cobrança de pacote por mês. No modelo parcelado isso causaria duplicidade, então ela
-- permanece apenas como no-op até todo cliente antigo deixar de existir.
create or replace function public.generate_package_billings(p_month date)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  return 0;
end;
$$;

revoke all on function public.save_patient_package_plan(uuid,numeric,text,integer,date,uuid) from public, anon;
revoke all on function public.cancel_patient_package_plan(uuid) from public, anon;
grant execute on function public.save_patient_package_plan(uuid,numeric,text,integer,date,uuid) to authenticated;
grant execute on function public.cancel_patient_package_plan(uuid) to authenticated;

commit;
