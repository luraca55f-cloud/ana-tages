-- ANA TAGES v2.0.42 — nascimento, pacote recebido/a receber e filtros financeiros
--
-- Objetivo:
--   * adicionar data de nascimento ao cadastro do paciente para idade calculada automaticamente no app;
--   * permitir criar/atualizar pacote como A RECEBER ou RECEBIDO;
--   * corrigir o cancelamento de pacote preservando tudo que já foi recebido;
--   * manter histórico financeiro íntegro e cancelar somente saldos ainda não recebidos.
--
-- SQL incremental. Execute SOMENTE este arquivo ao atualizar da v2.0.41.

begin;

alter table public.patients
  add column if not exists birth_date date;

-- Evita datas obviamente inválidas sem depender de CURRENT_DATE em CHECK constraint.
alter table public.patients
  drop constraint if exists patients_birth_date_valid;
alter table public.patients
  add constraint patients_birth_date_valid check (
    birth_date is null or birth_date >= date '1900-01-01'
  );

create or replace function public.save_patient_package_plan_v2(
  p_patient_id uuid,
  p_total_amount numeric,
  p_payment_mode text,
  p_installment_count integer,
  p_first_due_date date,
  p_initial_status text,
  p_received_at date,
  p_payment_method text,
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
  v_initial_status text := coalesce(nullif(trim(p_initial_status), ''), 'pending');
  v_payment_method text := nullif(trim(coalesce(p_payment_method, '')), '');
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
  if v_initial_status not in ('pending','paid') then
    raise exception 'Situação financeira do pacote inválida' using errcode = '22023';
  end if;
  if v_initial_status = 'paid' then
    if p_received_at is null then
      raise exception 'Data do recebimento obrigatória' using errcode = '22023';
    end if;
    if v_payment_method not in ('pix','bank_transfer','cash','credit_card','debit_card','other') then
      raise exception 'Forma de pagamento inválida' using errcode = '22023';
    end if;
  end if;

  v_count := case when p_payment_mode = 'single' then 1 else p_installment_count end;
  if v_count is null or v_count < 1 or v_count > 60 then
    raise exception 'Quantidade de parcelas inválida' using errcode = '22023';
  end if;

  select full_name into v_patient_name
  from public.patients
  where id = p_patient_id and owner_id = v_uid and archived_at is null
  for update;
  if not found then raise exception 'Paciente não encontrado' using errcode = 'P0002'; end if;

  -- Retry idempotente.
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
    -- Se a configuração financeira não mudou, a profissional pode apenas transformar as
    -- parcelas ainda abertas em recebido, sem recriar o pacote nem duplicar cobrança.
    if v_existing.total_amount = v_total
       and v_existing.payment_mode = p_payment_mode
       and v_existing.installment_count = v_count
       and v_existing.first_due_date = p_first_due_date then
      if v_initial_status = 'paid' then
        if exists (
          select 1 from public.billing_entries
          where owner_id = v_uid
            and package_plan_id = v_existing.id
            and status = 'partial'
            and received_amount > 0
        ) then
          raise exception 'O pacote possui recebimento parcial. Finalize ou corrija essas parcelas no Financeiro antes de marcar o pacote inteiro como recebido.'
            using errcode = '22023';
        end if;

        update public.billing_entries
        set status = 'paid',
            received_amount = amount,
            received_at = p_received_at,
            payment_method = v_payment_method,
            updated_at = now()
        where owner_id = v_uid
          and package_plan_id = v_existing.id
          and status = 'pending'
          and coalesce(received_amount, 0) = 0;
      end if;
      return v_existing.id;
    end if;

    -- Alterar valor/parcelamento de um pacote com recebimento existente poderia reescrever o
    -- histórico. Neste caso a profissional deve cancelar o plano e criar outro.
    if exists (
      select 1 from public.billing_entries
      where owner_id = v_uid
        and package_plan_id = v_existing.id
        and received_amount > 0
    ) then
      raise exception 'Este pacote já possui recebimento registrado. Cancele o pacote atual para preservar o histórico e depois crie a nova configuração.'
        using errcode = '22023';
    end if;

    update public.billing_entries
    set status = 'cancelled', updated_at = now()
    where owner_id = v_uid
      and package_plan_id = v_existing.id
      and status = 'pending'
      and coalesce(received_amount, 0) = 0;

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
      received_at, payment_method, auto_key, package_plan_id,
      installment_number, installment_count
    ) values (
      v_uid, p_patient_id, 'package', v_patient_name,
      case when p_payment_mode = 'single'
        then 'Pacote / plano — pagamento único'
        else format('Pacote / plano — parcela %s/%s', i, v_count)
      end,
      v_due, current_date, v_due, (v_installment_cents::numeric / 100),
      case when v_initial_status = 'paid' then 'paid' else 'pending' end,
      case when v_initial_status = 'paid' then (v_installment_cents::numeric / 100) else 0 end,
      case when v_initial_status = 'paid' then p_received_at else null end,
      case when v_initial_status = 'paid' then v_payment_method else null end,
      'package-plan:' || v_plan_id::text || ':' || i::text,
      v_plan_id, i, v_count
    )
    on conflict (owner_id, auto_key) do nothing;
  end loop;

  return v_plan_id;
end;
$$;

-- Cancelamento robusto: pagamentos concluídos ficam intactos; recebimentos parciais viram
-- históricos quitados apenas pelo valor que efetivamente entrou; saldo não recebido é cancelado.
create or replace function public.cancel_patient_package_plan_v2(p_patient_id uuid)
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
    -- Preserva a parte recebida de cobranças parciais e elimina apenas o saldo futuro.
    update public.billing_entries
    set amount = received_amount,
        status = 'paid',
        updated_at = now()
    where owner_id = v_uid
      and package_plan_id = v_plan_id
      and status = 'partial'
      and received_amount > 0;

    update public.billing_entries
    set status = 'cancelled',
        updated_at = now()
    where owner_id = v_uid
      and package_plan_id = v_plan_id
      and status = 'pending'
      and coalesce(received_amount, 0) = 0;

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

revoke all on function public.save_patient_package_plan_v2(uuid,numeric,text,integer,date,text,date,text,uuid) from public, anon;
revoke all on function public.cancel_patient_package_plan_v2(uuid) from public, anon;
grant execute on function public.save_patient_package_plan_v2(uuid,numeric,text,integer,date,text,date,text,uuid) to authenticated;
grant execute on function public.cancel_patient_package_plan_v2(uuid) to authenticated;

commit;
