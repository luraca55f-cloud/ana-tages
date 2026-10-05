# Perfil de teste local — v2.0.33

O perfil de homologação testa o ANA TAGES sem gravar nos dados reais da psicóloga.

## Cloudflare — runtime obrigatório

Configure em **Worker ana-tages > Settings > Runtime > Variables and Secrets**:

- `TEST_LOGIN_EMAIL` — Variable
- `TEST_LOGIN_PASSWORD` — Secret
- `SUPABASE_PROJECT_REF` — Variable
- `SUPABASE_MANAGEMENT_TOKEN` — Secret

Não basta cadastrar esses valores na seção **Builds**. O login e o painel de uso leem bindings do runtime do Worker.

O token da Management API deve ser escopado ao projeto e somente para leitura. Nunca coloque o token no GitHub ou em variável `VITE_`.

## Isolamento

- login de teste: Cloudflare Worker;
- sessão: cookie HttpOnly/Secure/SameSite=Strict;
- pacientes, agenda, sessões, pacotes, financeiro, recibos, materiais e configurações de teste: armazenamento local do navegador;
- conta real da Ana: Supabase Auth + MFA normalmente;
- módulo Uso Supabase: consulta somente leitura pela Management API através do Worker.

## Zerar testes

Use **Zerar testes** no cabeçalho ou **Configurações > Perfil de homologação > Zerar dados de teste**.

SQL novo nesta versão: **NÃO**.

## v2.0.34 — sincronização automática de runtime

No Workers Builds, as variáveis/secrets cadastradas em **Settings > Builds > Variables and secrets** existem somente durante o build. Nesta versão, o próprio `npm run build` executa `scripts/sync-runtime-secrets.mjs` após build/typecheck e envia, via Wrangler, os cinco bindings necessários ao runtime do Worker antes do deploy:

- `TEST_LOGIN_EMAIL`
- `TEST_LOGIN_PASSWORD`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_MANAGEMENT_TOKEN`
- `VAULT_RECOVERY_SECRET`

Os valores não são gravados no repositório nem exibidos pelo script. Em build local, quando essas variáveis não existem, a sincronização é simplesmente ignorada.
