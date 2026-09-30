-- ANA TAGES v2.0.27 — converte a conta técnica atual em monitor de uso
-- EXECUTE ANTES DE CRIAR A CONTA DA ANA.
-- Segurança: este script só continua se houver EXATAMENTE UMA conta no Auth.
-- Ele NÃO apaga a conta e NÃO altera senha/MFA. Apenas muda o perfil de interface.

begin;

do $$
declare
  v_count integer;
  v_uid uuid;
begin
  select count(*), min(id)
    into v_count, v_uid
  from auth.users;

  if v_count <> 1 or v_uid is null then
    raise exception 'Existem % contas no Auth. Este script automático exige exatamente 1 conta. Não altere nenhuma conta até identificar o usuário técnico com segurança.', v_count;
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tages_role', 'usage_monitor')
  where id = v_uid;

  raise notice 'Conta atual convertida em monitor técnico. Saia e entre novamente para o novo papel aparecer no JWT.';
end $$;

commit;
