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

- **Login:** preservar o botão `Esqueci minha senha` em `AuthGate.tsx`. A recuperação usa `supabase.auth.resetPasswordForEmail()`. Em PKCE com `detectSessionInUrl: false`, o callback deve trocar explicitamente o `code` por sessão com `exchangeCodeForSession()`; `PASSWORD_RECOVERY` permanece como fallback/evento complementar. Depois da troca da senha com `updateUser({ password })`, encerrar a sessão e exigir login + MFA normalmente.
- **Cofre v3:** nunca armazenar a senha do cofre nem o código de recuperação. As evoluções continuam cifradas por uma chave AES-GCM de conteúdo; essa chave é encapsulada uma vez pela senha e outra vez pelo código de recuperação.
- **Recuperação:** `Esqueci a senha do cofre` deve desembrulhar a mesma chave clínica com o código de recuperação e trocar apenas o envelope da senha. Não apagar/recriptografar prontuários para redefinir senha.
- **Legado v2:** ao desbloquear um cofre antigo com sucesso, preservar exatamente a chave antiga e migrá-la para envelopes v3. Exibir o novo código de recuperação uma única vez para a profissional guardar.
- **Sem requisito mínimo:** o cofre aceita qualquer senha não vazia por decisão explícita do usuário. Não reintroduzir mínimo de caracteres sem nova solicitação.
- **Privacidade:** a recuperação do cofre usa código externo justamente para preservar a premissa de que quem administra o banco/código não recebe uma chave de recuperação legível. Não trocar por escrow de chave no servidor sem discutir a mudança de garantia.
- **SQL:** aplicar apenas `SQL_ATUALIZACAO_ANA_TAGES_v2.0.14.sql` no banco existente.
- **Escopo:** ANA TAGES é sistema interno do consultório. Não implementar portal de paciente, link público ou autoagendamento sem solicitação explícita.

## Atualização v2.0.15 — callback de recuperação de senha PKCE

- **Causa corrigida:** o cliente Supabase usa `flowType: pkce` e `detectSessionInUrl: false`; portanto, o `code` devolvido pelo link de recuperação não pode ser ignorado. O `AuthGate` deve chamar explicitamente `exchangeCodeForSession(code)` antes de mostrar `Definir nova senha`.
- **Marcador explícito:** `resetPasswordForEmail()` usa `?mode=recovery` no `redirectTo`. Esse marcador diferencia recuperação de senha de uma abertura normal do sistema e evita depender exclusivamente do evento `PASSWORD_RECOVERY`.
- **PKCE entre abas:** sessão normal continua em `sessionStorage`; somente a chave `code-verifier` do PKCE usa `localStorage`, para que o link aberto a partir do e-mail em outra aba consiga concluir a troca do código. O verifier é removido pelo fluxo após uso.
- **MFA:** a sessão temporária de recuperação não deve ser desviada para a tela do Google Authenticator antes de a nova senha ser definida. Após `updateUser({ password })`, encerrar a sessão e exigir novo login + MFA.
- **Erros:** link inválido/expirado deve voltar para a tela de solicitação de recuperação com mensagem clara, sem expor o `code` na interface.
- **Banco:** nenhuma alteração de schema/RPC. SQL adicional: NÃO.

## Atualização v2.0.16 — criação do cofre e diagnóstico de persistência

- **Causa corrigida:** `saveAppSettings()` não deve usar `upsert` contendo `owner_id`. O banco concede INSERT dessa coluna, mas bloqueia UPDATE de `owner_id` por segurança; o ramo UPDATE do UPSERT podia exigir essa permissão e impedir a criação do cofre.
- **Persistência correta:** atualizar primeiro apenas as colunas mutáveis do registro já existente em `app_settings`; somente inserir um novo registro quando ainda não existir. Nunca liberar UPDATE de `owner_id` para contornar esse problema.
- **Erros do Supabase:** PostgREST retorna objetos simples e nem sempre `Error`. O cofre deve extrair `code/message/details` e mostrar motivo acionável em vez de sempre exibir uma mensagem genérica.
- **Banco desatualizado:** se os campos v3 do cofre não existirem, orientar explicitamente a executar `SQL_ATUALIZACAO_ANA_TAGES_v2.0.14.sql`. Não executar a migration inicial.
- **UX:** durante a derivação/encapsulamento da chave, desabilitar o botão e mostrar `Criando cofre...` para evitar cliques duplicados.
- **Criptografia:** fluxo testado com senha curta, desbloqueio por senha, recuperação por código e leitura do mesmo conteúdo cifrado. Não reintroduzir requisito mínimo de senha.
- **SQL:** nenhuma alteração nova de schema/RPC nesta versão. Se a v2.0.14 já foi aplicada, SQL adicional: NÃO.



## Atualização v2.0.17 — recuperação de senha com MFA/AAL2

- **Conta correta:** `resetPasswordForEmail()` não redefine senha por si só; apenas a conta existente correspondente ao e-mail recebe um link válido. A interface deve manter resposta genérica para não enumerar usuários, mas explicar que somente o e-mail cadastrado obtém acesso à redefinição.
- **MFA antes da nova senha:** quando MFA está habilitado, o Supabase exige sessão `aal2` para `updateUser({ password })`. Portanto o fluxo correto é: link do e-mail cadastrado → `exchangeCodeForSession()` → desafio TOTP/Google Authenticator → `refreshSession()` → nova senha.
- **Nunca contornar AAL2:** não desabilitar MFA, não usar service role no frontend e não tentar alterar senha em sessão de recuperação `aal1`.
- **Conta vinculada:** a tela de recuperação exibe o `user.email` da própria sessão criada pelo link; não permite escolher outra conta após abrir o link.
- **Pós-troca:** depois de `updateUser({ password })`, encerrar a sessão local e exigir novo login + MFA.
- **SQL:** nenhuma alteração de schema/RPC nesta versão. SQL adicional: NÃO.


## Atualização v2.0.18 — Parte 1: identificação profissional, CPF e troca de senha do cofre

- **Configurações é a fonte dos documentos futuros:** nome completo, CPF e CRP da psicóloga devem ser lidos de `app_settings`. Não fixar esses dados no código de recibos/notas.
- **CPF da profissional:** salvo em `app_settings.cpf`, somente com 11 dígitos. A máscara `000.000.000-00` é apenas de interface.
- **CPF do paciente:** salvo em `patients.cpf`, também somente com 11 dígitos. Se informado, o frontend valida os dígitos verificadores antes de persistir.
- **RLS/owner_id:** CPF continua protegido pelas mesmas políticas do registro pai. Não criar endpoint público nem expor CPF em logs.
- **Trocar senha do cofre:** quando o cofre estiver desbloqueado, existe botão `Trocar senha do cofre`. A operação recria apenas o envelope da senha com a MESMA chave clínica; não recriptografa nem apaga evoluções e não invalida o código de recuperação atual.
- **SQL:** aplicar apenas `SQL/01 - Parte 1 - Dados profissionais e CPF/SQL_ATUALIZACAO_ANA_TAGES_v2.0.18.sql` no banco existente. Não reexecutar a migration inicial.


## Atualização v2.0.19 — Parte 2: pacote/plano e parcelamento

- **Modelo financeiro:** `package_amount` em `patients` é apenas o resumo do valor total. O plano real e histórico fica em `package_plans`; as cobranças ficam em `billing_entries`.
- **Vínculo obrigatório:** parcelas geradas pelo plano carregam `package_plan_id`, `installment_number` e `installment_count`. Não remover esses campos em futuras telas de A receber/recibos.
- **À vista:** `payment_mode = single`, `installment_count = 1`; gera uma cobrança pendente na data informada.
- **Parcelado:** `payment_mode = installments`; gera entre 2 e 60 cobranças mensais, começando no primeiro vencimento. Em meses menores, o dia é limitado ao último dia do mês.
- **Centavos:** dividir o total em centavos; parcelas iniciais usam divisão inteira e a última absorve o resto. A soma das parcelas deve ser exatamente igual ao total do plano.
- **A receber:** todas as parcelas nascem `pending`, sem recebimento, e entram imediatamente na carteira a receber.
- **Reconfiguração:** ao alterar um plano ativo, parcelas pendentes antigas são canceladas; pagamentos concluídos ficam preservados. Se existir qualquer recebimento registrado no plano ativo, bloquear a reconfiguração para evitar gerar um novo valor total e cobrar em duplicidade.
- **Troca para por sessão:** `cancel_patient_package_plan` cancela somente parcelas pendentes não pagas; histórico pago/parcial é preservado.
- **Legado:** `generate_package_billings(date)` virou no-op de compatibilidade. Não reativar a criação mensal antiga; ela duplicaria as parcelas do novo plano.
- **Transação:** a criação/reconfiguração de plano e geração de parcelas ocorre na RPC `save_patient_package_plan`. Não mover essa geração para o frontend.
- **SQL:** os SQLs estão organizados na pasta `SQL/`. Para esta etapa, executar a Parte 2; a Parte 1 só deve ser executada se ainda não tiver sido aplicada.


## Atualização v2.0.20 — Parte 3: A receber completo

- **Entrada pelo Dashboard:** o card `A receber` do Dashboard é clicável e deve abrir `Financeiro > A receber` diretamente. Preservar esse deep-link interno quando a navegação financeira evoluir.
- **Visão por devedor:** agrupar cobranças abertas por paciente (`patient_id`) e, quando não houver vínculo, por nome do cliente. Mostrar nome, CPF, valor total relacionado à dívida atual, recebido, saldo, vencimentos e situação.
- **CPF:** vem de `patients.cpf`; nunca tentar reconstruir CPF por nome nem expor o valor em logs. Lançamentos manuais sem paciente vinculado exibem CPF indisponível.
- **Pacotes:** para um pacote ainda em aberto, carregar também parcelas já pagas com o mesmo `package_plan_id`. Isso permite informar `N parcelas / X pagas` sem misturar pagamentos de pacotes antigos ou sessões históricas não relacionadas.
- **Não misturar histórico vitalício:** em cobrança por sessão/avulsa, `já pago` considera apenas as cobranças que ainda compõem a dívida atual (por exemplo, baixa parcial). Não somar todos os recebimentos históricos do paciente.
- **Vencida:** uma cobrança é vencida somente quando ainda há saldo e `due_date` é anterior à data local atual. Pagamentos quitados nunca aparecem como vencidos.
- **Filtros:** paciente/cliente, status (`pendente`, `parcial`, `vencida`) e intervalo de vencimento. O intervalo decide quais devedores entram na visão; o detalhamento do pacote mantém todas as parcelas relacionadas para preservar contexto do parcelamento.
- **Ações:** parcelas/cobranças abertas mantêm a ação de baixa já existente; não criar UPDATE financeiro direto no frontend.
- **Performance:** `loadFinanceBundle(month, true)` carrega histórico de parcelas/CPF apenas na tela Financeiro. O Dashboard continua usando o modo leve.
- **Banco:** Parte 3 não adiciona schema/RPC/policy. SQL adicional: NÃO. Os SQLs anteriores ficam acumulados e NÃO devem ser executados até o usuário concluir todas as partes.

## Atualização v2.0.21 — Parte 4: cards financeiros clicáveis

- **Dashboard:** os quatro cards financeiros são `Faturado`, `Recebido`, `A receber` e `Despesas`. Todos são clicáveis e devem abrir diretamente a visão que explica o número exibido.
- **Faturado:** abre `Financeiro > Faturado`, com a origem de cada cobrança do período (paciente/cliente, origem, descrição, status e valor faturado).
- **Recebido:** abre `Financeiro > Recebido`, com as baixas efetivamente recebidas no período, incluindo ações de editar/excluir recebimento já existentes.
- **A receber:** preserva a visão completa criada na v2.0.20, com devedores, CPF, saldo e parcelas.
- **Despesas:** abre `Financeiro > Despesas`, respeitando o período/mês selecionado.
- **Coerência interna:** os quatro cards do topo da própria tela Financeiro também levam às mesmas visões, evitando cards meramente informativos sem rastreabilidade.
- **Banco:** esta etapa usa somente dados já carregados por `loadFinanceBundle()` e não altera schema, RLS nem RPCs. SQL adicional: NÃO.
- **Publicação:** por decisão do usuário, continuar acumulando alterações sem executar SQL nem publicar até o pacote final.



## Atualização v2.0.22 — Parte 5: recibos, cobrança e resumo financeiro

- **Fonte dos dados profissionais:** documentos financeiros devem buscar `professional_name`, `cpf`, `crp` e `city` em `app_settings`. Não hardcodar nome, CPF, CRP ou cidade da psicóloga no frontend, template ou SQL.
- **Cidade:** `app_settings.city` foi adicionada nesta etapa porque o modelo de recibo usa `{{cidade}}`. É dado administrativo, protegido pelas mesmas regras de `app_settings`.
- **Paciente:** recibos, notas de cobrança e resumos usam `patients.full_name` e `patients.cpf`. Bloquear emissão quando o paciente vinculado não possuir CPF em vez de gerar documento incompleto.
- **Forma de pagamento:** novos recebimentos devem registrar `billing_entries.payment_method` com um dos valores `pix`, `bank_transfer`, `cash`, `credit_card`, `debit_card` ou `other`. A interface traduz esses valores para PT-BR.
- **Baixas:** continuar usando RPCs. Não transformar edição/baixa de recebimento em `UPDATE` direto pelo frontend. `update_billing_receipt` registra valor, data e forma de pagamento; `delete_billing_receipt` desfaz a baixa e limpa também `payment_method`, preservando a cobrança e todos os vínculos.
- **Atendimentos:** a ação rápida de receber abre o formulário do atendimento para capturar a forma de pagamento antes da baixa. A sobrecarga `mark_appointment_paid(uuid,text)` reutiliza a regra existente de baixa e só acrescenta a forma de pagamento.
- **Recibo:** emitir somente quando `received_amount > 0` e existir `received_at`. O valor por extenso é calculado no cliente apenas para apresentação do documento; o valor financeiro oficial continua vindo da `billing_entry`.
- **Nota de cobrança:** é emitida por cobrança que ainda possui saldo. Deve permanecer descritiva, sem multa/juros não cadastrados e sem alterar a cobrança.
- **Resumo financeiro:** deve usar o conjunto de cobranças já agrupado para o paciente/plano na visão A receber, preservando `package_plan_id`, números de parcela, datas, recebido e saldo. Não misturar pacotes históricos.
- **PDF/impressão:** `src/features/finance/documents.ts` monta documento A4 e abre o diálogo de impressão do navegador. O usuário pode imprimir ou escolher `Salvar como PDF`; não há armazenamento automático do PDF no Supabase nesta etapa.
- **Segurança do HTML:** dados vindos do banco são escapados antes de entrar no HTML de impressão. Preservar essa proteção ao alterar os modelos.
- **SQL:** `SQL/05 - Parte 5 - Recibos e documentos financeiros/SQL_ATUALIZACAO_ANA_TAGES_v2.0.22.sql`. Ele adiciona cidade, garante `payment_method` e atualiza/sobrecarga RPCs financeiras.
- **Publicação:** por decisão do usuário, esta etapa continua acumulada com as Partes 1–4. NÃO executar SQL e NÃO publicar até todas as partes estarem finalizadas e revisadas.
## v2.0.23 — Correção de build TypeScript (29/09/2026)
- Base: v2.0.22 completa (Partes 1–5), sem remoção funcional e sem alteração de banco.
- Corrigido `addMonthsClamped` em `FinancePage.tsx` e `src/routes/index.tsx`: valores padrão explícitos eliminam falsos `undefined` sob `noUncheckedIndexedAccess`, preservando a regra de vencimento mensal.
- Corrigida a tipagem opcional de `Metric.onClick` para compatibilidade com `exactOptionalPropertyTypes` quando um card não recebe callback.
- Motivo: o Cloudflare compilava client/SSR, mas `tsc --noEmit` bloqueava o deploy da v2.0.22.
- SQL: NÃO. Os SQLs das Partes 1, 2 e 5 permanecem os mesmos já executados/previstos.
- Commit sugerido: `Corrigir typecheck do financeiro v2.0.23`.


## v2.0.24 — recuperação do cofre por e-mail + impressão/PDF sem pop-up
- Fluxo principal de recuperação do cofre passa a ser e-mail cadastrado no Supabase + Google Authenticator (AAL2). O código de recuperação permanece como contingência.
- Para preservar a criptografia das evoluções, a chave clínica não é salva em texto puro: o frontend envia a chave somente após AAL2 para `/api/vault-email-recovery/provision`; o Worker a encapsula com AES-GCM usando o Secret de runtime `VAULT_RECOVERY_SECRET` e o frontend persiste apenas ciphertext/IV em `app_settings`.
- O endpoint `/api/vault-email-recovery/recover` exige token Supabase válido + claim `aal=aal2`, validada somente após `/auth/v1/user` aceitar o token. O envelope usa AAD vinculado ao `user.id`.
- `VAULT_RECOVERY_SECRET` NUNCA pode ser VITE_ nem entrar no Git. Rotacionar esse segredo invalida envelopes existentes até o cofre ser desbloqueado novamente com senha/código para reprovisionar.
- Cofres existentes precisam ser desbloqueados UMA VEZ após a v2.0.24 (senha atual ou código de recuperação) para ativar o envelope de recuperação por e-mail.
- A recuperação por e-mail reduz o modelo anterior de “somente quem possui o código consegue recuperar”: quem controla simultaneamente a conta Supabase/MFA, o banco e o segredo do Worker pode tecnicamente recuperar a chave. Não voltar a prometer impossibilidade absoluta de acesso pelo desenvolvedor.
- Documentos financeiros deixaram de usar `window.open()`. Recibo, nota de cobrança e resumo financeiro agora montam um DOM temporário na própria página e chamam `window.print()`, evitando bloqueio de pop-up. O usuário escolhe “Salvar como PDF” no diálogo do navegador.

## v2.0.25 — Prestação de Serviço, primeiro acesso e documentos
- Novo módulo **Prestação de Serviço** com financeiro próprio (`service_work_entries`). Ele é isolado de pacientes, sessões, `billing_entries`, `expenses`, Dashboard e Financeiro do consultório.
- Cards compactos: Faturado, Recebido, A receber, Despesas, Lucro de caixa e Resultado previsto.
- Contas criadas depois do SQL v2.0.25 recebem senha temporária: no primeiro login o usuário é obrigado a definir uma nova senha antes de continuar.
- Recibo, nota de cobrança e resumo financeiro receberam layout A4 institucional mais limpo e legível.
- A nova conta da Ana inicia sem dados visíveis por isolamento `owner_id`; a limpeza física da conta antiga é um passo opcional e separado para evitar exclusão acidental.

