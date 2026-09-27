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

## Atualização v2.0.8 — Dashboard financeiro e observabilidade

- **F5 / carregamento:** os cards financeiros não podem exibir `R$ 0,00` enquanto o Supabase ainda está carregando. O estado inicial vazio do React não significa saldo zero. Usar skeleton durante a consulta; em erro, mostrar indisponibilidade em vez de número falso.
- **Resultado:** o quarto card identifica dinamicamente `Lucro no mês`, `Prejuízo no mês` ou `Resultado do mês` conforme `recebido - despesas`.
- **Filtro mensal:** o campo `type=month` deve abrir o seletor nativo ao clicar em qualquer ponto do campo, usando `showPicker()` com fallback silencioso para navegadores sem suporte.
- **Movimentações recentes:** preservar o filtro `Todas / Entradas / Saídas`. Filtrar antes de limitar aos 12 registros. Entrada usa verde suave e Saída vermelho suave; não usar destaques chamativos.
- **Cloudflare:** `wrangler.jsonc` replica a observabilidade configurada no painel: logs e invocation logs ligados/persistidos e traces desligados.
- **Estrutura Git:** a pasta legada `GIT/` é duplicação e não deve existir nem ser versionada; a fonte oficial é `/src`.
- Sempre atualizar estes comentários quando mudar uma dessas regras.

## Atualização v2.0.10 — correção de recebimentos

- **Regra central:** cobrança/faturamento e recebimento são coisas diferentes. Nunca apague a `billing_entry` apenas porque uma baixa foi registrada incorretamente.
- **Editar recebimento:** altera somente `received_amount` e `received_at`; o status vira `paid` quando o valor recebido é igual ao faturado e `partial` quando é menor.
- **Excluir recebimento:** significa desfazer a baixa, zerando `received_amount`, limpando `received_at` e devolvendo a cobrança para `pending` / A receber. O vínculo com sessão, pacote, paciente ou serviço deve permanecer intacto.
- **Movimentações recentes:** entradas devem vir de `receivedInPeriod`, pois a seção representa fluxo de caixa real. Isso permite que uma correção da data de recebimento mova a entrada para o mês correto.
- **Banco:** usar apenas o SQL incremental `SQL_ATUALIZACAO_ANA_TAGES_v2.0.10.sql`. Não reexecutar a migration inicial.
- **Texto profissional:** na seção “Despesas sobre o faturamento”, usar “Participação percentual de cada categoria de despesa em relação ao faturamento do período selecionado.”
- Manter os comentários dessa regra sincronizados caso o fluxo financeiro seja alterado futuramente.

## Atualização v2.0.11 — edição e exclusão de despesas na visão geral

- **Movimentações recentes:** saídas/despesas devem oferecer `Editar despesa` e `Excluir despesa` diretamente na coluna Ações, assim como os recebimentos já possuem ações próprias.
- **Reutilizar fluxo existente:** essas ações chamam `startExpenseEdit()` e `removeExpense()`, os mesmos fluxos usados na aba Despesas. Não duplicar lógica de persistência e não conceder UPDATE/DELETE direto ao frontend.
- **Rastreabilidade:** edição e exclusão continuam passando pelas RPCs seguras já existentes (`update_expense` / `delete_expense`) e pela auditoria do banco.
- **UX:** manter os botões discretos; `Editar despesa` neutro e `Excluir despesa` com destaque destrutivo moderado, sem poluir a tabela.
- **Banco:** esta versão não altera schema nem RPCs. SQL adicional: NÃO.

## Atualização v2.0.12 — mensagens específicas ao salvar atendimentos

- **Nunca usar erro genérico de cadastro** quando for possível identificar o bloqueio. O modal de atendimento deve informar claramente campo obrigatório, data inválida, duração inválida, valor inválido, conflito de agenda, expiração/autorização MFA ou falha de comunicação.
- **Conflito de agenda:** erros PostgreSQL `23P01`, mensagens de sobreposição e a constraint de horário devem ser traduzidos para uma orientação direta para escolher outro horário ou ajustar a duração.
- **Etapas separadas:** se o atendimento já foi salvo e apenas a baixa financeira falhar, a interface deve dizer explicitamente que o atendimento foi salvo e que somente o recebimento falhou. Não apresentar isso como falha total do cadastro.
- **Segurança:** detalhes técnicos brutos do Supabase/PostgreSQL continuam apenas no `console.error`; não expor nomes internos de constraints/RPCs ao usuário.
- **Banco:** esta versão não altera schema, políticas nem RPCs. SQL adicional: NÃO.


## Atualização v2.0.13 — favicon e título da aba

- **Título da aba:** manter `TAGES | Consultório Anna` em `src/routes/__root.tsx`.
- **Favicon oficial:** `public/favicon.ico` e `public/favicon.png` derivam do símbolo fornecido pelo usuário nesta versão. Não substituir por favicon genérico sem solicitação.
- **Cache:** os links do favicon usam `?v=2.0.13`; ao trocar novamente o ícone, incrementar o identificador de cache.
- **Banco:** esta alteração é somente de interface/metadados. SQL adicional: NÃO.


## Atualização v2.0.14 — recuperação de senha e cofre recuperável

- **Login:** preservar o botão `Esqueci minha senha` em `AuthGate.tsx`. A recuperação deve usar `supabase.auth.resetPasswordForEmail()` e a troca efetiva deve ocorrer no evento `PASSWORD_RECOVERY` com `updateUser({ password })`. Depois da troca, encerrar a sessão e exigir login + MFA normalmente.
- **Cofre v3:** nunca armazenar a senha do cofre nem o código de recuperação. As evoluções continuam cifradas por uma chave AES-GCM de conteúdo; essa chave é encapsulada uma vez pela senha e outra vez pelo código de recuperação.
- **Recuperação:** `Esqueci a senha do cofre` deve desembrulhar a mesma chave clínica com o código de recuperação e trocar apenas o envelope da senha. Não apagar/recriptografar prontuários para redefinir senha.
- **Legado v2:** ao desbloquear um cofre antigo com sucesso, preservar exatamente a chave antiga e migrá-la para envelopes v3. Exibir o novo código de recuperação uma única vez para a profissional guardar.
- **Sem requisito mínimo:** o cofre aceita qualquer senha não vazia por decisão explícita do usuário. Não reintroduzir mínimo de caracteres sem nova solicitação.
- **Privacidade:** a recuperação do cofre usa código externo justamente para preservar a premissa de que quem administra o banco/código não recebe uma chave de recuperação legível. Não trocar por escrow de chave no servidor sem discutir a mudança de garantia.
- **SQL:** aplicar apenas `SQL_ATUALIZACAO_ANA_TAGES_v2.0.14.sql` no banco existente.
- **Escopo:** ANA TAGES é sistema interno do consultório. Não implementar portal de paciente, link público ou autoagendamento sem solicitação explícita.
