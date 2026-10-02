-- ANA TAGES v2.0.31 — parcelamento 1x + cancelamento financeiro do atendimento
-- Incremental e compatível com os dados existentes. NÃO reexecute a migration inicial.
--
-- 1) Permite selecionar "Parcelado" com 1 parcela (ex.: pagamento único no próximo mês).
-- 2) Adiciona cancelamento transacional do atendimento e, quando a usuária escolher,
--    cancela também o pacote ativo e as parcelas pendentes sem recebimento.

begin;

alter table public.package_plans
  drop constraint if exists package_plans_payment_shape;

alter table public.package_plans
  add constraint package_plans_payment_shape check (
    (payment_mode = 'single' and installment_count = 1)
    or (payment_mode = 'installments' and installment_count between 1 and 60)
  );

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
     or (p_payment_mode = 'installments' and v_count < 1) then
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
      case when p_payment_mode = 'single'
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


-- Cancela um atendimento preservando histórico. O trigger financeiro já encerra a cobrança
-- individual da sessão. Se p_cancel_package=true, a mesma transação também encerra o plano
-- ativo do paciente e suas parcelas ainda pendentes/sem recebimento.
create or replace function public.cancel_appointment_with_finance(
  p_appointment_id uuid,
  p_cancel_package boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_patient_id uuid;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;

  select patient_id into v_patient_id
  from public.appointments
  where id = p_appointment_id and owner_id = v_uid
  for update;

  if not found then
    raise exception 'Atendimento não encontrado' using errcode = 'P0002';
  end if;

  update public.appointments
  set status = 'cancelled', updated_at = now()
  where id = p_appointment_id and owner_id = v_uid;

  if coalesce(p_cancel_package, false) and v_patient_id is not null then
    perform public.cancel_patient_package_plan(v_patient_id);
  end if;
end;
$$;

revoke all on function public.cancel_appointment_with_finance(uuid,boolean) from public, anon;
grant execute on function public.cancel_appointment_with_finance(uuid,boolean) to authenticated;

-- Reafirma permissões da RPC de pacote após o CREATE OR REPLACE acima.
revoke all on function public.save_patient_package_plan(uuid,numeric,text,integer,date,uuid) from public, anon;
grant execute on function public.save_patient_package_plan(uuid,numeric,text,integer,date,uuid) to authenticated;

commit;
