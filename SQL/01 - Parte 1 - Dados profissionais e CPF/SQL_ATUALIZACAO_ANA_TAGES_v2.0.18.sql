-- ANA TAGES v2.0.18 — Parte 1: identificação profissional e CPF de pacientes
--
-- Objetivo:
--   * guardar Nome/CPF/CRP da profissional em Configurações para uso futuro em recibos/notas;
--   * guardar CPF do paciente no próprio cadastro;
--   * manter esses dados protegidos pelas mesmas regras RLS/owner_id já existentes.
--
-- Este arquivo é incremental. NÃO reexecute a migration inicial em banco existente.

begin;

alter table public.app_settings
  add column if not exists cpf text;

alter table public.patients
  add column if not exists cpf text;

-- O frontend valida os dígitos verificadores. No banco mantemos somente a forma canônica
-- de 11 dígitos para evitar máscaras diferentes e facilitar geração futura de documentos.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_cpf_format'
      and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings
      add constraint app_settings_cpf_format
      check (cpf is null or cpf ~ '^[0-9]{11}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'patients_cpf_format'
      and conrelid = 'public.patients'::regclass
  ) then
    alter table public.patients
      add constraint patients_cpf_format
      check (cpf is null or cpf ~ '^[0-9]{11}$');
  end if;
end $$;

-- O projeto usa privilégios por coluna. Liberamos apenas a nova coluna sem ampliar
-- UPDATE/INSERT para outros campos sensíveis.
grant insert (cpf) on public.patients to authenticated;
grant update (cpf) on public.patients to authenticated;
grant insert (cpf) on public.app_settings to authenticated;
grant update (cpf) on public.app_settings to authenticated;

commit;
