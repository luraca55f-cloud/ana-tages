-- ANA TAGES v2.0.10
-- Correção segura de recebimentos.
--
-- Regra de negócio:
--   * recebimento (baixa) e cobrança/faturamento são registros conceitualmente distintos;
--   * editar um recebimento altera apenas valor recebido e data da baixa;
--   * excluir um recebimento NÃO exclui a billing_entry: desfaz a baixa e devolve a cobrança para "pending";
--   * vínculos com sessão, pacote, paciente e demais origens permanecem preservados.
--
-- Este arquivo é incremental. NÃO reexecute a migration inicial para aplicar esta atualização.

begin;

create or replace function public.update_billing_receipt(
  p_id uuid,
  p_received_amount numeric,
  p_received_at date
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

  select amount, status
    into v_amount, v_status
  from public.billing_entries
  where id = p_id and owner_id = v_uid
  for update;

  if not found then
    raise exception 'Cobrança não encontrada';
  end if;
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
      status = case when v_received = v_amount then 'paid' else 'partial' end,
      updated_at = now()
  where id = p_id and owner_id = v_uid;
end;
$$;

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

  -- "Excluir recebimento" desfaz somente a baixa. A cobrança permanece para manter
  -- rastreabilidade e todos os vínculos automáticos com atendimentos/pacotes.
  update public.billing_entries
  set received_amount = 0,
      received_at = null,
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

revoke all on function public.update_billing_receipt(uuid,numeric,date) from public, anon;
revoke all on function public.delete_billing_receipt(uuid) from public, anon;
grant execute on function public.update_billing_receipt(uuid,numeric,date) to authenticated;
grant execute on function public.delete_billing_receipt(uuid) to authenticated;

commit;
