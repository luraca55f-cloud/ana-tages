# TAGES CONSULTORIA ANNA — CLEAN START v2.0.1

Pacote reiniciado para uma implantação totalmente nova em **nova conta GitHub + novo projeto Supabase + nova conta Cloudflare**, preservando a estrutura visual e funcional do sistema.

## O que permanece igual

- Dashboard do consultório
- Pacientes
- Agenda
- Sessões
- Financeiro
- Relatórios
- Materiais
- Configurações
- Prontuário/evolução clínica criptografado no navegador
- MFA/TOTP com aplicativo autenticador
- RLS por proprietário no Supabase
- Upload privado de materiais
- Auditoria e controles clínicos
- Layout responsivo e identidade visual existentes

O CLEAN START **não redesenha o site** e **não remove módulos**. As mudanças desta versão são de implantação, dependências, resolução de imports e documentação.

## Arquitetura da nova implantação

1. GitHub privado: somente o código-fonte.
2. Supabase novo: autenticação, banco, RLS e storage.
3. Cloudflare Workers novo: aplicação web e Worker.
4. Deploy preferencial: integração GitHub nativa do Cloudflare Workers Builds.

### Importante

Este pacote **não contém GitHub Actions nem Dependabot**. Eles foram removidos de propósito para a nova implantação não herdar falhas e ruído do repositório antigo. Em uma conta Cloudflare nova, tente primeiro a integração GitHub nativa.

## Variáveis públicas de build

Configure no Cloudflare Workers Builds:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_IDLE_TIMEOUT_MINUTES=30`
- `VITE_TURNSTILE_SITE_KEY` — pode ficar vazia no primeiro deploy

Nunca coloque no frontend:

- Supabase `service_role`
- senha do banco
- Secret Key do Supabase
- Turnstile Secret Key
- tokens pessoais

## Supabase

Execute **uma única vez**:

`supabase/migrations/202609220001_initial_schema.sql`

Essa é a migração corrigida após o erro PostgreSQL `42P17` ocorrido na implantação anterior.

Depois crie um usuário de teste em Authentication > Users. Se esse mesmo cadastro for entregue à Anna futuramente, altere o e-mail e a senha do **mesmo usuário**, em vez de criar outro UID, para preservar os vínculos `owner_id`.

## Cloudflare

Configuração recomendada ao importar o repositório:

- Branch de produção: `main`
- Diretório raiz: vazio / raiz do repositório
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

O Worker é definido por `wrangler.jsonc` e usa `src/server.ts` para acrescentar cabeçalhos de segurança e rate limiting ao TanStack Start.

## Validação interna

Antes do Vite, `npm run build` executa `scripts/verify-project.mjs`. Essa checagem bloqueia especificamente problemas já encontrados na implantação antiga, incluindo:

- import local apontando para arquivo inexistente;
- pacote importado sem estar no `package.json`;
- reintrodução de imports `@/`;
- incompatibilidade de família entre `@types/react` e `@types/react-dom`;
- migração SQL antiga com o problema `42P17`;
- reaproveitamento de `.github`/Actions antigos;
- reaproveitamento de `package-lock.json` antigo.

## Turnstile

Faça depois do primeiro deploy:

1. obtenha o hostname `workers.dev`;
2. crie o widget Turnstile;
3. coloque a **Site Key pública** em `VITE_TURNSTILE_SITE_KEY` no Cloudflare;
4. coloque a **Secret Key do Turnstile** somente na configuração CAPTCHA do Supabase Auth;
5. faça novo deploy.

## Para manutenção por outra IA

Leia `AI_MAINTENANCE_NOTES.md` antes de alterar dependências, deploy, imports ou migração do banco.
