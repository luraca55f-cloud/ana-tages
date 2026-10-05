-- ANA TAGES v2.0.36
-- Parcelamento por atendimento + preservação de pagamentos já registrados.
-- A mudança visual de Pacientes em cards não exige estrutura nova no banco.
--
-- Este SQL é incremental. NÃO execute migrations antigas e NÃO zere a conta.

begin;

-- O metadata de parcelas passa a poder representar tanto parcelas de pacote/plano
-- quanto parcelas de um atendimento. O vínculo continua inequívoco pelo package_plan_id
-- ou pelo appointment_id.
alter table public.billing_entries drop constraint if exists billing_installment_metadata_valid;
alter table public.billing_entries
  add constraint billing_installment_metadata_valid check (
    (installment_number is null and installment_count is null)
    or (
      installment_number between 1 and 60
      and installment_count between 1 and 60
      and installment_number <= installment_count
      and (
        (package_plan_id is not null and appointment_id is null)
        or (package_plan_id is null and appointment_id is not null)
      )
    )
  );

create index if not exists billing_appointment_installment_idx
  on public.billing_entries(owner_id, appointment_id, installment_number)
  where appointment_id is not null;

-- Sincronização automática:
--   * atendimento ativo com valor cria cobrança única apenas quando ainda não existe
--     um plano parcelado explícito;
--   * quando existe parcelamento, a RPC save_appointment_billing_plan é a fonte da verdade;
--   * ao cancelar, parcelas pendentes são canceladas e parcelas parciais são encerradas
--     no valor já recebido, preservando o pagamento sem manter saldo a receber.
create or replace function public.sync_appointment_billing()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auto_key text := 'session:' || new.id::text;
  v_patient_billing text;
  v_competence date := (new.scheduled_at at time zone 'America/Sao_Paulo')::date;
  v_has_plan boolean := false;
begin
  if new.patient_id is not null and new.service_kind = 'session' then
    select billing_model into v_patient_billing
    from public.patients
    where id = new.patient_id and owner_id = new.owner_id;
  end if;

  select exists (
    select 1
    from public.billing_entries b
    where b.owner_id = new.owner_id
      and b.appointment_id = new.id
      and b.installment_count is not null
      and b.status <> 'cancelled'
  ) into v_has_plan;

  if new.status = 'cancelled' or coalesce(new.amount, 0) <= 0 or v_patient_billing = 'package' then
    -- Parcela parcial: mantém exatamente o que já entrou e elimina somente o saldo futuro.
    update public.billing_entries
       set amount = received_amount,
           status = 'paid',
           updated_at = now()
     where owner_id = new.owner_id
       and appointment_id = new.id
       and status = 'partial'
       and received_amount > 0;

    update public.billing_entries
       set status = 'cancelled',
           received_amount = 0,
           received_at = null,
           payment_method = null,
           updated_at = now()
     where owner_id = new.owner_id
       and appointment_id = new.id
       and status = 'pending'
       and received_amount = 0;

    return new;
  end if;

  -- Um plano explícito já existente não pode ganhar uma cobrança única adicional.
  if v_has_plan then
    return new;
  end if;

  insert into public.billing_entries(
    owner_id, patient_id, appointment_id, source_type, client_name, description,
    competence_date, issued_at, due_date, amount, status, received_amount, auto_key
  ) values (
    new.owner_id, new.patient_id, new.id,
    case when new.service_kind = 'session' then 'session' else new.service_kind end,
    coalesce(nullif(trim(new.patient_name), ''), 'Atendimento'),
    case when new.service_kind = 'session' then 'Sessão' else 'Serviço' end,
    v_competence, v_competence, v_competence, new.amount, 'pending', 0, v_auto_key
  )
  on conflict (owner_id, auto_key) do update set
    patient_id = case when public.billing_entries.status = 'paid' then public.billing_entries.patient_id else excluded.patient_id end,
    appointment_id = case when public.billing_entries.status = 'paid' then public.billing_entries.appointment_id else excluded.appointment_id end,
    source_type = case when public.billing_entries.status = 'paid' then public.billing_entries.source_type else excluded.source_type end,
    client_name = case when public.billing_entries.status = 'paid' then public.billing_entries.client_name else excluded.client_name end,
    description = case when public.billing_entries.status = 'paid' then public.billing_entries.description else excluded.description end,
    competence_date = case when public.billing_entries.status = 'paid' then public.billing_entries.competence_date else excluded.competence_date end,
    issued_at = case when public.billing_entries.status = 'paid' then public.billing_entries.issued_at else excluded.issued_at end,
    due_date = case when public.billing_entries.status = 'paid' then public.billing_entries.due_date else excluded.due_date end,
    amount = case when public.billing_entries.status = 'paid' then public.billing_entries.amount else excluded.amount end,
    status = case when public.billing_entries.status = 'paid' then 'paid' else 'pending' end,
    received_amount = case when public.billing_entries.status = 'paid' then public.billing_entries.received_amount else 0 end,
    received_at = case when public.billing_entries.status = 'paid' then public.billing_entries.received_at else null end,
    payment_method = case when public.billing_entries.status = 'paid' then public.billing_entries.payment_method else null end,
    updated_at = now();

  return new;
end;
$$;

-- Cria/reconfigura a forma de cobrança de UM atendimento.
-- Pagamentos já feitos/parciais ficam preservados. Somente parcelas sem recebimento
-- são canceladas e refeitas. Se a nova quantidade/valor não comportar o histórico já
-- recebido, a função bloqueia a alteração em vez de apagar dados financeiros.
create or replace function public.save_appointment_billing_plan(
  p_appointment_id uuid,
  p_payment_mode text,
  p_installment_count integer,
  p_first_due_date date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_appointment public.appointments%rowtype;
  v_patient_billing text;
  v_count integer;
  v_fixed_count integer := 0;
  v_fixed_total_cents bigint := 0;
  v_total_cents bigint;
  v_remaining_cents bigint;
  v_remaining_slots integer;
  v_base_cents bigint;
  v_installment_cents bigint;
  v_month_start date;
  v_month_last_day date;
  v_due date;
  v_first_day integer;
  v_competence date;
  v_number integer;
  i integer := 0;
  r record;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if p_payment_mode not in ('single','installments') then
    raise exception 'Forma de cobrança inválida' using errcode = '22023';
  end if;
  if p_first_due_date is null then
    raise exception 'Data do primeiro vencimento obrigatória' using errcode = '22023';
  end if;

  v_count := case when p_payment_mode = 'single' then 1 else p_installment_count end;
  if v_count is null or v_count < 1 or v_count > 60
     or (p_payment_mode = 'installments' and v_count < 2) then
    raise exception 'Quantidade de parcelas inválida' using errcode = '22023';
  end if;

  select * into v_appointment
  from public.appointments
  where id = p_appointment_id and owner_id = v_uid
  for update;
  if not found then
    raise exception 'Atendimento não encontrado' using errcode = 'P0002';
  end if;

  if v_appointment.patient_id is not null and v_appointment.service_kind = 'session' then
    select billing_model into v_patient_billing
    from public.patients
    where id = v_appointment.patient_id and owner_id = v_uid;
  end if;

  -- Sem cobrança individual: encerra somente o que ainda não foi recebido.
  if v_appointment.status = 'cancelled'
     or coalesce(v_appointment.amount, 0) <= 0
     or v_patient_billing = 'package' then
    update public.billing_entries
       set amount = received_amount, status = 'paid', updated_at = now()
     where owner_id = v_uid
       and appointment_id = p_appointment_id
       and status = 'partial'
       and received_amount > 0;

    update public.billing_entries
       set status = 'cancelled', received_amount = 0, received_at = null,
           payment_method = null, updated_at = now()
     where owner_id = v_uid
       and appointment_id = p_appointment_id
       and status = 'pending'
       and received_amount = 0;
    return;
  end if;

  v_total_cents := round(v_appointment.amount * 100)::bigint;
  v_competence := (v_appointment.scheduled_at at time zone 'America/Sao_Paulo')::date;

  select count(*)::integer,
         coalesce(sum(round(amount * 100)::bigint), 0)::bigint
    into v_fixed_count, v_fixed_total_cents
  from public.billing_entries
  where owner_id = v_uid
    and appointment_id = p_appointment_id
    and status in ('partial','paid')
    and received_amount > 0;

  if v_fixed_count > v_count then
    raise exception 'Não é possível reduzir para menos parcelas do que já possuem recebimento.' using errcode = '22023';
  end if;
  if v_fixed_total_cents > v_total_cents then
    raise exception 'O valor do atendimento não pode ser menor que o valor já comprometido em parcelas recebidas.' using errcode = '22023';
  end if;

  -- Cancela apenas cobranças ainda sem qualquer recebimento.
  update public.billing_entries
     set status = 'cancelled', received_amount = 0, received_at = null,
         payment_method = null, updated_at = now()
   where owner_id = v_uid
     and appointment_id = p_appointment_id
     and status = 'pending'
     and received_amount = 0;

  -- Renumera somente registros com recebimento e muda a auto_key para liberar as chaves
  -- de slots do plano atual. Valor, data e forma de pagamento permanecem intocados.
  i := 0;
  for r in
    select id
    from public.billing_entries
    where owner_id = v_uid
      and appointment_id = p_appointment_id
      and status in ('partial','paid')
      and received_amount > 0
    order by due_date nulls first, created_at, id
  loop
    i := i + 1;
    update public.billing_entries
       set installment_number = i,
           installment_count = v_count,
           description = case when v_count = 1
             then 'Atendimento — pagamento único'
             else format('Atendimento — parcela %s/%s', i, v_count)
           end,
           auto_key = 'appointment-paid:' || p_appointment_id::text || ':' || r.id::text,
           updated_at = now()
     where id = r.id and owner_id = v_uid;
  end loop;

  v_remaining_slots := v_count - v_fixed_count;
  v_remaining_cents := v_total_cents - v_fixed_total_cents;

  if v_remaining_slots = 0 then
    if v_remaining_cents <> 0 then
      raise exception 'O atendimento já possui todas as parcelas com recebimento; o valor total não pode ser alterado.' using errcode = '22023';
    end if;
    return;
  end if;
  if v_remaining_cents <= 0 then
    raise exception 'Não há saldo suficiente para criar as parcelas restantes.' using errcode = '22023';
  end if;

  v_base_cents := v_remaining_cents / v_remaining_slots;
  v_first_day := extract(day from p_first_due_date)::integer;

  for i in 1..v_remaining_slots loop
    v_number := v_fixed_count + i;
    v_month_start := (date_trunc('month', p_first_due_date)::date + make_interval(months => v_number - 1))::date;
    v_month_last_day := (v_month_start + interval '1 month - 1 day')::date;
    v_due := make_date(
      extract(year from v_month_start)::integer,
      extract(month from v_month_start)::integer,
      least(v_first_day, extract(day from v_month_last_day)::integer)
    );
    v_installment_cents := case
      when i = v_remaining_slots then v_remaining_cents - (v_base_cents * (v_remaining_slots - 1))
      else v_base_cents
    end;

    if v_installment_cents <= 0 then
      raise exception 'O valor é muito baixo para a quantidade de parcelas escolhida.' using errcode = '22023';
    end if;

    insert into public.billing_entries(
      owner_id, patient_id, appointment_id, source_type, client_name, description,
      competence_date, issued_at, due_date, amount, status, received_amount,
      received_at, payment_method, auto_key, package_plan_id,
      installment_number, installment_count
    ) values (
      v_uid, v_appointment.patient_id, v_appointment.id,
      case when v_appointment.service_kind = 'session' then 'session' else v_appointment.service_kind end,
      coalesce(nullif(trim(v_appointment.patient_name), ''), 'Atendimento'),
      case when v_count = 1
        then 'Atendimento — pagamento único'
        else format('Atendimento — parcela %s/%s', v_number, v_count)
      end,
      v_competence, current_date, v_due, (v_installment_cents::numeric / 100),
      'pending', 0, null, null,
      'appointment-plan:' || v_appointment.id::text || ':' || v_number::text,
      null, v_number, v_count
    )
    on conflict (owner_id, auto_key) do update set
      patient_id = excluded.patient_id,
      appointment_id = excluded.appointment_id,
      source_type = excluded.source_type,
      client_name = excluded.client_name,
      description = excluded.description,
      competence_date = excluded.competence_date,
      issued_at = excluded.issued_at,
      due_date = excluded.due_date,
      amount = excluded.amount,
      status = 'pending',
      received_amount = 0,
      received_at = null,
      payment_method = null,
      package_plan_id = null,
      installment_number = excluded.installment_number,
      installment_count = excluded.installment_count,
      updated_at = now()
    where public.billing_entries.received_amount = 0;
  end loop;
end;
$$;

-- Compatibilidade com o frontend: garante que atendimentos antigos sem cobrança sejam
-- reconciliados. Atendimentos que já possuem parcelamento não ganham cobrança duplicada.
create or replace function public.ensure_appointment_billings()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;

  update public.appointments
     set amount = amount
   where owner_id = v_uid
     and status <> 'cancelled'
     and amount > 0;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- A ação "Recebido" do modal é destinada à cobrança única. Em atendimento parcelado,
-- cada parcela deve ser baixada individualmente no Financeiro para manter datas e formas
-- de pagamento corretas.
create or replace function public.mark_appointment_paid(
  p_appointment_id uuid,
  p_payment_method text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_method text := nullif(trim(coalesce(p_payment_method, '')), '');
  v_open_count integer;
  v_max_installments integer;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if v_method not in ('pix','bank_transfer','cash','credit_card','debit_card','other') then
    raise exception 'Forma de pagamento obrigatória ou inválida' using errcode = '22023';
  end if;

  perform public.ensure_appointment_billings();

  select count(*)::integer, coalesce(max(installment_count), 1)::integer
    into v_open_count, v_max_installments
  from public.billing_entries
  where owner_id = v_uid
    and appointment_id = p_appointment_id
    and status in ('pending','partial');

  if v_open_count = 0 then
    raise exception 'Cobrança do atendimento não encontrada ou já recebida';
  end if;
  if v_open_count > 1 or v_max_installments > 1 then
    raise exception 'Este atendimento está parcelado. Baixe as parcelas individualmente no Financeiro.' using errcode = '22023';
  end if;

  update public.billing_entries
     set status = 'paid',
         received_amount = amount,
         received_at = (now() at time zone 'America/Sao_Paulo')::date,
         payment_method = v_method,
         updated_at = now()
   where owner_id = v_uid
     and appointment_id = p_appointment_id
     and status in ('pending','partial');
end;
$$;

revoke all on function public.save_appointment_billing_plan(uuid,text,integer,date) from public, anon;
revoke all on function public.ensure_appointment_billings() from public, anon;
revoke all on function public.mark_appointment_paid(uuid,text) from public, anon;

grant execute on function public.save_appointment_billing_plan(uuid,text,integer,date) to authenticated;
grant execute on function public.ensure_appointment_billings() to authenticated;
grant execute on function public.mark_appointment_paid(uuid,text) to authenticated;

commit;
