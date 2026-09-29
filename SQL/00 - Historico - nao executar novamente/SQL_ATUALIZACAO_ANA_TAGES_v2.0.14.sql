-- ANA TAGES v2.0.14
-- Recuperação do cofre clínico sem armazenar a senha.
--
-- Arquitetura:
--   * a chave que cifra as evoluções é encapsulada separadamente pela senha do cofre;
--   * uma segunda cópia encapsulada é protegida por um código de recuperação exibido à profissional;
--   * redefinir a senha troca apenas o encapsulamento da chave, sem recriptografar prontuários;
--   * o código de recuperação não é armazenado em texto no banco.
--
-- Incremental: NÃO reexecute a migration inicial no banco atual.

begin;

alter table public.app_settings
  add column if not exists vault_version smallint not null default 2,
  add column if not exists vault_password_salt text,
  add column if not exists vault_password_key_ciphertext text,
  add column if not exists vault_password_key_iv text,
  add column if not exists vault_recovery_salt text,
  add column if not exists vault_recovery_key_ciphertext text,
  add column if not exists vault_recovery_key_iv text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_vault_version_valid'
      and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings
      add constraint app_settings_vault_version_valid
      check (vault_version in (2, 3));
  end if;
end $$;

-- Limites defensivos: os campos guardam somente salts, IVs e chaves encapsuladas em base64.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_vault_recovery_fields_valid'
      and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings
      add constraint app_settings_vault_recovery_fields_valid check (
        (vault_password_salt is null or char_length(vault_password_salt) <= 256)
        and (vault_password_key_ciphertext is null or char_length(vault_password_key_ciphertext) <= 4096)
        and (vault_password_key_iv is null or char_length(vault_password_key_iv) <= 256)
        and (vault_recovery_salt is null or char_length(vault_recovery_salt) <= 256)
        and (vault_recovery_key_ciphertext is null or char_length(vault_recovery_key_ciphertext) <= 4096)
        and (vault_recovery_key_iv is null or char_length(vault_recovery_key_iv) <= 256)
      );
  end if;
end $$;

grant insert (
  vault_version,
  vault_password_salt,
  vault_password_key_ciphertext,
  vault_password_key_iv,
  vault_recovery_salt,
  vault_recovery_key_ciphertext,
  vault_recovery_key_iv
) on public.app_settings to authenticated;

grant update (
  vault_version,
  vault_password_salt,
  vault_password_key_ciphertext,
  vault_password_key_iv,
  vault_recovery_salt,
  vault_recovery_key_ciphertext,
  vault_recovery_key_iv
) on public.app_settings to authenticated;

commit;
