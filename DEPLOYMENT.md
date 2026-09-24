# Deploy — nova implantação

## Estratégia

Esta versão foi preparada para uma instalação nova e não depende do histórico da implantação anterior.

### Preferência

**GitHub privado → Cloudflare Workers Builds (integração GitHub nativa) → Worker**

Não há GitHub Actions neste pacote.

## Cloudflare Workers Builds

Ao importar o repositório:

- Production branch: `main`
- Root directory: raiz do repositório
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Variáveis de build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_IDLE_TIMEOUT_MINUTES=30`
- `VITE_TURNSTILE_SITE_KEY` (opcional no primeiro deploy)

## Por que não há package-lock inicial

A implantação antiga tinha lockfile/cache inconsistentes e isso causou `ERESOLVE` e falhas antes do build. O CLEAN START usa versões diretas exatas e não reaproveita esse estado antigo.

Se futuramente for criado um lockfile novo a partir desta árvore limpa e ele for comprovado por build bem-sucedido, ele pode ser versionado conscientemente. Nunca copiar o lockfile antigo.

## Wrangler

`wrangler.jsonc` mantém:

- Worker `ana-tages`
- Node compatibility
- `src/server.ts` como wrapper do servidor TanStack Start
- rate limiter `HTTP_RATE_LIMITER`
- observability/logs

O wrapper adiciona cabeçalhos de segurança e limitação de requisições sem mudar a interface do sistema.
