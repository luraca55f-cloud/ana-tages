-- ANA TAGES v2.0.22 — Parte 5: recibos, notas de cobrança e resumo financeiro
--
-- Objetivo:
--   * guardar a cidade da profissional para emissão de recibos;
--   * registrar a forma de pagamento nas baixas financeiras;
--   * permitir que receitas manuais já recebidas guardem a forma de pagamento;
--   * preservar cobrança, paciente, pacote e atendimento ao editar/excluir uma baixa;
--   * permitir que recebimentos originados no atendimento também registrem a forma de pagamento.
--
-- Este arquivo é incremental. NÃO execute a migration inicial em um banco já existente.

begin;

alter table public.app_settings
  add column if not exists city text;

-- A coluna já existe no schema-base mais recente, mas o IF NOT EXISTS mantém esta atualização
-- segura para bancos criados por versões intermediárias.
alter table public.billing_entries
  add column if not exists payment_method text;

-- Mantém os mesmos limites de texto usados pelo restante do cadastro profissional.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_city_length'
      and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings
      add constraint app_settings_city_length
      check (city is null or char_length(trim(city)) between 1 and 120);
  end if;
end $$;

-- O projeto usa privilégios por coluna em app_settings.
grant insert (city) on public.app_settings to authenticated;
grant update (city) on public.app_settings to authenticated;

-- Receita manual v2: mantém a RPC anterior intacta para compatibilidade, mas oferece uma
-- assinatura adicional com forma de pagamento. O frontend v2.0.22 usa esta assinatura.
create or replace function public.create_manual_revenue(
  p_source_type text,
  p_client_name text,
  p_description text,
  p_competence_date date,
  p_issued_at date,
  p_due_date date,
  p_amount numeric,
  p_paid boolean,
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
  v_id uuid;
  v_method text := nullif(trim(coalesce(p_payment_method, '')), '');
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if p_client_request_id is null then
    raise exception 'Identificador idempotente obrigatório' using errcode = '22023';
  end if;
  if p_source_type not in ('session','package','company','psychological_test','neuropsychology','other') then
    raise exception 'Origem inválida' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'Valor inválido' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_client_name, ''))) not between 1 and 160
     or char_length(trim(coalesce(p_description, ''))) not between 1 and 500 then
    raise exception 'Dados inválidos' using errcode = '22023';
  end if;
  if p_paid and v_method not in ('pix','bank_transfer','cash','credit_card','debit_card','other') then
    raise exception 'Forma de pagamento obrigatória ou inválida' using errcode = '22023';
  end if;

  insert into public.billing_entries(
    owner_id, client_request_id, source_type, client_name, description, competence_date, issued_at,
    due_date, amount, status, received_amount, received_at, payment_method, auto_key
  ) values (
    v_uid, p_client_request_id, p_source_type, trim(p_client_name), trim(p_description), p_competence_date,
    p_issued_at, p_due_date, round(p_amount, 2),
    case when p_paid then 'paid' else 'pending' end,
    case when p_paid then round(p_amount, 2) else 0 end,
    case when p_paid then p_issued_at else null end,
    case when p_paid then v_method else null end,
    null
  )
  on conflict (owner_id, client_request_id) do update
    set client_request_id = excluded.client_request_id
  returning id into v_id;

  return v_id;
end;
$$;

-- Baixa financeira v2: registra valor, data e forma de pagamento sem alterar a cobrança
-- original nem seus vínculos com sessão/pacote/paciente.
create or replace function public.update_billing_receipt(
  p_id uuid,
  p_received_amount numeric,
  p_received_at date,
  p_payment_method text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric(12,2);
  v_status text;
  v_received numeric(12,2);
  v_method text := nullif(trim(coalesce(p_payment_method, '')), '');
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if p_received_amount is null or p_received_amount <= 0 or p_received_amount > 1000000 then
    raise exception 'Valor recebido inválido' using errcode = '22023';
  end if;
  if p_received_at is null then
    raise exception 'Data do recebimento obrigatória' using errcode = '22023';
  end if;
  if v_method not in ('pix','bank_transfer','cash','credit_card','debit_card','other') then
    raise exception 'Forma de pagamento obrigatória ou inválida' using errcode = '22023';
  end if;

  select amount, status
    into v_amount, v_status
  from public.billing_entries
  where id = p_id and owner_id = v_uid
  for update;

  if not found then raise exception 'Cobrança não encontrada'; end if;
  if v_status = 'cancelled' then
    raise exception 'Cobrança cancelada não pode receber baixa' using errcode = '22023';
  end if;

  v_received := round(p_received_amount, 2);
  if v_received > v_amount then
    raise exception 'Valor recebido não pode exceder o valor faturado' using errcode = '22023';
  end if;

  update public.billing_entries
  set received_amount = v_received,
      received_at = p_received_at,
      payment_method = v_method,
      status = case when v_received = v_amount then 'paid' else 'partial' end,
      updated_at = now()
  where id = p_id and owner_id = v_uid;
end;
$$;

-- Ao desfazer a baixa, a forma de pagamento também deve ser removida.
create or replace function public.delete_billing_receipt(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;

  update public.billing_entries
  set received_amount = 0,
      received_at = null,
      payment_method = null,
      status = 'pending',
      updated_at = now()
  where id = p_id
    and owner_id = v_uid
    and status in ('partial', 'paid')
    and received_amount > 0;

  if not found then
    raise exception 'Recebimento não encontrado ou já excluído';
  end if;
end;
$$;

-- Sobrecarga da baixa de atendimento. Reutiliza a RPC já existente que efetiva a baixa e,
-- em seguida, apenas grava a forma de pagamento no mesmo lançamento. Assim preservamos todas
-- as regras atuais de criação/sincronização do billing do atendimento.
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
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if v_method not in ('pix','bank_transfer','cash','credit_card','debit_card','other') then
    raise exception 'Forma de pagamento obrigatória ou inválida' using errcode = '22023';
  end if;

  -- A função de um argumento já faz a baixa do atendimento no banco atual.
  perform public.mark_appointment_paid(p_appointment_id);

  update public.billing_entries
  set payment_method = v_method,
      updated_at = now()
  where owner_id = v_uid
    and appointment_id = p_appointment_id
    and status = 'paid';

  if not found then
    raise exception 'Recebimento do atendimento não encontrado';
  end if;
end;
$$;

revoke all on function public.create_manual_revenue(text,text,text,date,date,date,numeric,boolean,text,uuid) from public, anon;
revoke all on function public.update_billing_receipt(uuid,numeric,date,text) from public, anon;
revoke all on function public.delete_billing_receipt(uuid) from public, anon;
revoke all on function public.mark_appointment_paid(uuid,text) from public, anon;

grant execute on function public.create_manual_revenue(text,text,text,date,date,date,numeric,boolean,text,uuid) to authenticated;
grant execute on function public.update_billing_receipt(uuid,numeric,date,text) to authenticated;
grant execute on function public.delete_billing_receipt(uuid) to authenticated;
grant execute on function public.mark_appointment_paid(uuid,text) to authenticated;

commit;
