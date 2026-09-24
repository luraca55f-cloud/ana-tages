# NOTAS OBRIGATÓRIAS PARA IA / DESENVOLVEDOR — CLEAN START v2.0.2

Leia antes de alterar este projeto.

## Regra principal

O usuário decidiu **abandonar a implantação anterior** e começar com contas novas de GitHub, Supabase e Cloudflare. Não recupere Secrets, IDs de conta, URLs antigas, tokens, workflows ou configurações do repositório anterior.

A estrutura visual, módulos e comportamento funcional do site devem ser preservados. Correções de deploy não devem virar redesign nem remoção de funcionalidades.

## Identificadores canônicos

- Repositório: `ana-tages`
- Worker Cloudflare: `ana-tages`
- Pacote npm: `ana-tages`
- Não reintroduzir identificadores da implantação anterior em código, deploy ou documentação.

## Erros históricos que NÃO podem ser reintroduzidos

### 1. PostgreSQL 42P17

A primeira migração tentou usar uma expressão não IMMUTABLE em uma exclusion constraint/index envolvendo `tstzrange(... make_interval(...))`.

A migração atual `supabase/migrations/202609220001_initial_schema.sql` já foi corrigida com tratamento de sobreposição usando trigger e transaction/advisory lock. Não substitua pela migração antiga.

### 2. GitHub Actions antigo

A implantação anterior acumulou workflows de bootstrap, CI, deploy e Dependabot, gerando múltiplas execuções vermelhas e estados difíceis de diagnosticar.

Este CLEAN START não contém `.github` de propósito. Em contas novas, o caminho inicial é **Cloudflare Workers Builds + integração GitHub nativa**.

Só adicione GitHub Actions se houver uma necessidade nova e comprovada. Não copie os workflows da série v1.2.x.

### 3. Lockfile antigo / cache npm

Um workflow antigo usava cache apontando para um `package-lock.json` inexistente; depois um lockfile histórico passou a carregar combinações quebradas de dependências.

Neste CLEAN START o `package-lock.json` histórico foi removido e está ignorado durante a implantação inicial. Não copie lockfile do repositório antigo.

### 4. Conflito @types/react / @types/react-dom

O deploy anterior encontrou `ERESOLVE` porque `@types/react-dom 19.3.0` exigia `@types/react ^19.3.0` enquanto o projeto tinha `@types/react 19.2.x`.

As versões diretas atuais estão fixadas na mesma família 19.2:

- `@types/react = 19.2.17`
- `@types/react-dom = 19.2.3`

Não atualize uma sem validar a compatibilidade da outra.

### 5. `tw-animate-css` ausente

`src/styles.css` importa `tw-animate-css`. Uma versão anterior esqueceu de declarar o pacote, causando falha no Vite. Ele está declarado no `package.json` e deve permanecer enquanto o import CSS existir.

### 6. Import `@/components/ui/button` não resolvido no route splitting

A implantação v1.2.8 chegou ao Vite e falhou quando o módulo virtual `src/routes/index.tsx?tsr-split=component` não resolveu `@/components/ui/button`, mesmo com o arquivo existente.

Para eliminar essa classe de erro, o CLEAN START usa **imports relativos explícitos** em todo o código e não possui alias `@/` no Vite/tsconfig.

Não reintroduza alias `@/` sem antes provar com build real do TanStack Start + Cloudflare Vite plugin que a resolução funciona com route splitting.

### 7. Prettier não deve bloquear produção

Formatação é útil, mas não deve ser tratada como falha funcional de deploy. ESLint não integra Prettier como regra bloqueante.

### 8. Segredos

Nunca colocar em `VITE_*`:

- `service_role`
- database password
- Supabase secret key
- Turnstile secret
- Cloudflare API token

`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e Turnstile Site Key são valores públicos de frontend.

## Validação obrigatória antes de entregar nova versão

No mínimo:

1. `node scripts/verify-project.mjs`
2. confirmar que não existem imports `@/`;
3. confirmar que todos os imports locais apontam para arquivos reais;
4. confirmar que todo pacote importado está no `package.json`;
5. confirmar que a migração SQL é a corrigida;
6. se houver ambiente npm disponível: `npm install`, `npm run lint` e `npm run build`.

Nunca chamar uma versão de “stable” sem ter evidência real do pipeline/build correspondente.


## Correções v2.0.2 — typecheck Cloudflare
- Corrigidos acessos proibidos por `noPropertyAccessFromIndexSignature`.
- Corrigido narrowing do cliente Supabase em callbacks assíncronos.
- Corrigido parsing de mês com `noUncheckedIndexedAccess`.
- O build só deve ser considerado válido após `npm run build` concluir incluindo `tsc --noEmit`.
