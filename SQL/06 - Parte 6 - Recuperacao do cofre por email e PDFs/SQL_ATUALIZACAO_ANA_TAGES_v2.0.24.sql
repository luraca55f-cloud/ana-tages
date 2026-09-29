-- ANA TAGES v2.0.24
-- Recuperação do cofre clínico por e-mail + MFA.
-- Este SQL NÃO altera nem descriptografa evoluções clínicas existentes.
-- Ele adiciona somente o envelope criptografado usado na recuperação por e-mail.

begin;

alter table public.app_settings
  add column if not exists vault_email_recovery_ciphertext text,
  add column if not exists vault_email_recovery_iv text,
  add column if not exists vault_email_recovery_version smallint;

-- Limites defensivos: o envelope contém apenas uma chave AES-256 cifrada pelo Worker.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_vault_email_recovery_valid'
      and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings
      add constraint app_settings_vault_email_recovery_valid check (
        (
          vault_email_recovery_ciphertext is null
          and vault_email_recovery_iv is null
          and vault_email_recovery_version is null
        )
        or (
          vault_email_recovery_ciphertext is not null
          and char_length(vault_email_recovery_ciphertext) <= 4096
          and vault_email_recovery_iv is not null
          and char_length(vault_email_recovery_iv) <= 256
          and vault_email_recovery_version = 1
        )
      );
  end if;
end $$;

-- app_settings usa privilégios por coluna. Mantém o mesmo modelo das versões anteriores.
grant insert (
  vault_email_recovery_ciphertext,
  vault_email_recovery_iv,
  vault_email_recovery_version
) on public.app_settings to authenticated;

grant update (
  vault_email_recovery_ciphertext,
  vault_email_recovery_iv,
  vault_email_recovery_version
) on public.app_settings to authenticated;

comment on column public.app_settings.vault_email_recovery_ciphertext is
  'Chave clínica encapsulada pelo Worker para recuperação autenticada por e-mail + MFA; nunca contém prontuário em texto puro.';
comment on column public.app_settings.vault_email_recovery_iv is
  'IV AES-GCM do envelope de recuperação por e-mail.';
comment on column public.app_settings.vault_email_recovery_version is
  'Versão do envelope de recuperação por e-mail; atualmente 1.';

commit;
