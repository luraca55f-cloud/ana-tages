-- ANA TAGES v2.0.35
-- Corrige a cobrança por atendimento para que um atendimento ativo com valor
-- apareça imediatamente em A receber, sem precisar estar concluído.
-- Cancelamento continua cancelando a cobrança pendente e sessões cobertas por
-- pacote continuam sem cobrança individual.

begin;

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
begin
  if new.patient_id is not null and new.service_kind = 'session' then
    select billing_model into v_patient_billing
    from public.patients
    where id = new.patient_id and owner_id = new.owner_id;
  end if;

  -- Atendimento ativo + valor > 0 gera cobrança imediatamente.
  -- Cancelado não gera cobrança. Sessão em pacote não gera cobrança individual.
  if new.status = 'cancelled' or new.amount <= 0 or v_patient_billing = 'package' then
    update public.billing_entries
      set status = 'cancelled', updated_at = now()
      where owner_id = new.owner_id and auto_key = v_auto_key and status <> 'paid';
    return new;
  end if;

  insert into public.billing_entries(
    owner_id, patient_id, appointment_id, source_type, client_name, description,
    competence_date, issued_at, due_date, amount, status, received_amount, auto_key
  ) values (
    new.owner_id, new.patient_id, new.id,
    case when new.service_kind = 'session' then 'session' else new.service_kind end,
    coalesce(nullif(trim(new.patient_name), ''), 'Atendimento'),
    case when new.service_kind = 'session' then 'Sessão realizada' else 'Serviço realizado' end,
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
    updated_at = now();

  return new;
end;
$$;

-- Reprocessa apenas atendimentos existentes para refletir a nova regra.
-- O UPDATE sem alteração material dispara o trigger já existente com segurança.
update public.appointments
set updated_at = now()
where amount > 0
  and status <> 'cancelled';

commit;
