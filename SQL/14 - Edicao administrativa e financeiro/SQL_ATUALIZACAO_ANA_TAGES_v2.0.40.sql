-- ANA TAGES v2.0.40 — edição administrativa e financeiro editável
--
-- Objetivo:
--   * permitir editar faturamentos MANUAIS sem alterar vínculos de sessão/pacote;
--   * permitir excluir faturamentos MANUAIS quando a profissional realmente quiser removê-los;
--   * preservar recebimentos ao editar valor/datas e impedir reduzir o faturado abaixo do que já entrou;
--   * manter cobranças automáticas de sessão/pacote sob controle da origem correta.
--
-- Este SQL é incremental. Execute SOMENTE este arquivo ao atualizar da v2.0.38/v2.0.37.
-- Não reexecute migrations antigas.

begin;

create or replace function public.update_manual_revenue(
  p_id uuid,
  p_source_type text,
  p_client_name text,
  p_description text,
  p_competence_date date,
  p_issued_at date,
  p_due_date date,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_received numeric(12,2);
  v_appointment_id uuid;
  v_patient_id uuid;
  v_package_plan_id uuid;
  v_amount numeric(12,2) := round(p_amount, 2);
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;
  if p_source_type not in ('session','package','company','psychological_test','neuropsychology','other') then
    raise exception 'Origem inválida' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 1000000 then
    raise exception 'Valor inválido' using errcode = '22023';
  end if;
  if p_competence_date is null or p_issued_at is null then
    raise exception 'Competência e data de emissão são obrigatórias' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_client_name, ''))) not between 1 and 160
     or char_length(trim(coalesce(p_description, ''))) not between 1 and 500 then
    raise exception 'Dados inválidos' using errcode = '22023';
  end if;

  select received_amount, appointment_id, patient_id, package_plan_id
    into v_received, v_appointment_id, v_patient_id, v_package_plan_id
  from public.billing_entries
  where id = p_id and owner_id = v_uid
  for update;

  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  if v_appointment_id is not null or v_patient_id is not null or v_package_plan_id is not null then
    raise exception 'Este lançamento é vinculado. Edite o atendimento ou pacote que o originou.' using errcode = '22023';
  end if;
  if coalesce(v_received, 0) > v_amount then
    raise exception 'O valor faturado não pode ser menor que o valor já recebido.' using errcode = '22023';
  end if;

  update public.billing_entries
     set source_type = p_source_type,
         client_name = trim(p_client_name),
         description = trim(p_description),
         competence_date = p_competence_date,
         issued_at = p_issued_at,
         due_date = p_due_date,
         amount = v_amount,
         status = case
           when coalesce(received_amount, 0) <= 0 then 'pending'
           when received_amount >= v_amount then 'paid'
           else 'partial'
         end,
         updated_at = now()
   where id = p_id and owner_id = v_uid;
end;
$$;

create or replace function public.delete_manual_revenue(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_appointment_id uuid;
  v_patient_id uuid;
  v_package_plan_id uuid;
begin
  if v_uid is null or not public.has_aal2() then
    raise exception 'MFA obrigatório' using errcode = '42501';
  end if;

  select appointment_id, patient_id, package_plan_id
    into v_appointment_id, v_patient_id, v_package_plan_id
  from public.billing_entries
  where id = p_id and owner_id = v_uid
  for update;

  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  if v_appointment_id is not null or v_patient_id is not null or v_package_plan_id is not null then
    raise exception 'Este lançamento é vinculado. Cancele ou edite o atendimento/pacote que o originou.' using errcode = '22023';
  end if;

  delete from public.billing_entries
  where id = p_id and owner_id = v_uid;
end;
$$;

revoke all on function public.update_manual_revenue(uuid,text,text,text,date,date,date,numeric) from public, anon;
revoke all on function public.delete_manual_revenue(uuid) from public, anon;
grant execute on function public.update_manual_revenue(uuid,text,text,text,date,date,date,numeric) to authenticated;
grant execute on function public.delete_manual_revenue(uuid) to authenticated;

commit;
