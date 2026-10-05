> Versão atual: **v2.0.33**


> **v2.0.25:** Prestação de Serviço isolada, primeiro acesso com troca obrigatória de senha e documentos financeiros redesenhados.

# TAGES CONSULTORIA ANNA — v2.0.33

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

## Variáveis de runtime do Worker

Estas variáveis devem ser criadas em **Settings > Runtime > Variables and Secrets** do Worker, e não apenas em Workers Builds:

- `TEST_LOGIN_EMAIL` — Variable;
- `TEST_LOGIN_PASSWORD` — Secret;
- `SUPABASE_PROJECT_REF` — Variable;
- `SUPABASE_MANAGEMENT_TOKEN` — Secret escopado somente para leitura do projeto.

O `wrangler.jsonc` usa `keep_vars: true` para preservar as variáveis de runtime configuradas no painel durante novos deploys.

## Supabase

A migration `supabase/migrations/202609220001_initial_schema.sql` é apenas a referência de instalação inicial e **não deve ser reexecutada no banco atual**.

### Estado atual dos SQLs — não executar ainda

Por decisão do usuário, esta versão faz parte de um desenvolvimento cumulativo. **Nenhum SQL das Partes 1, 2 ou 5 deve ser executado agora e a aplicação ainda não deve ser publicada.**

Os SQLs incrementais estão organizados em `SQL/` e serão aplicados somente quando todas as partes estiverem concluídas e revisadas:

- `01 - Parte 1 - Dados profissionais e CPF` — v2.0.18;
- `02 - Parte 2 - Pacotes e parcelamento` — v2.0.19;
- `03 - Parte 3 - A receber completo` — sem SQL;
- `04 - Parte 4 - Cards financeiros clicaveis` — sem SQL;
- `05 - Parte 5 - Recibos e documentos financeiros` — v2.0.22;
- `00 - Historico - nao executar novamente` — somente referência.

A ordem definitiva e, se tecnicamente seguro, um SQL consolidado serão preparados apenas no pacote final. O mecanismo recuperável do cofre continua dependendo da atualização v2.0.14 já existente no banco atual; não repetir SQL histórico sem necessidade.

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


## Atualização v2.0.13 — identidade da aba do navegador

- Favicon atualizado com a identidade visual fornecida para o TAGES.
- Título da aba alterado para `TAGES | Consultório Anna`.
- O favicon usa versionamento na URL para evitar que navegadores mantenham o ícone anterior em cache.
- SQL adicional: NÃO.


## Atualização v2.0.14 — recuperação de acesso e cofre clínico

- Login: a tela inicial possui `Esqueci minha senha`, usando o fluxo oficial de recuperação por e-mail do Supabase Auth.
- Cofre clínico: a senha deixa de ser irrecuperável. A chave clínica é encapsulada separadamente pela senha e por um código de recuperação.
- Recuperar o cofre redefine a senha sem apagar nem recriptografar as evoluções existentes.
- O código de recuperação deve ser guardado fora do sistema; o banco armazena somente a chave clínica encapsulada, nunca o código em texto.
- Cofres legados v2 são migrados no primeiro desbloqueio bem-sucedido, preservando a mesma chave usada nas evoluções antigas.
- A senha do cofre não possui requisito mínimo imposto pela aplicação; continua recomendado usar uma senha difícil de adivinhar.
- SQL desta arquitetura: `SQL_ATUALIZACAO_ANA_TAGES_v2.0.14.sql`. Não reexecute a migration inicial em produção.

## Correções v2.0.16–v2.0.17

A criação do cofre clínico foi corrigida para não tentar atualizar `owner_id` via UPSERT, e a recuperação de senha passou a concluir MFA/AAL2 antes da troca. O cofre também passa a exibir o motivo real quando o Supabase rejeita a persistência, mantendo a recuperação de senha/cofre introduzida nas versões anteriores. Não há SQL novo nesta versão além do SQL v2.0.14 já necessário para a arquitetura recuperável do cofre.



## Atualização v2.0.18 — Parte 1

- Perfil profissional em Configurações: Nome completo, CPF e CRP.
- CPF no cadastro/edição de pacientes.
- CPF armazenado sem máscara e protegido por RLS/owner_id.
- Botão `Trocar senha do cofre` quando o cofre estiver desbloqueado.
- SQL desta etapa: `SQL/01 - Parte 1 - Dados profissionais e CPF/SQL_ATUALIZACAO_ANA_TAGES_v2.0.18.sql`.


## Atualização v2.0.19 — Parte 2: pacotes e parcelamento

- Cadastro de paciente com `Pacote / plano` agora possui valor total, forma de pagamento `À vista` ou `Parcelado`, número de parcelas e primeiro vencimento.
- A tela mostra uma prévia de **cada parcela**, com valor e vencimento. O arredondamento é feito em centavos e a última parcela absorve eventual diferença para a soma fechar exatamente no valor total.
- Ao salvar, o banco cria todas as parcelas automaticamente como `A receber`.
- O vínculo financeiro é explícito: `patients` → `package_plans` → `billing_entries`, com número/total de parcelas em cada cobrança.
- A antiga geração mensal automática de pacote foi desativada para não duplicar cobranças no novo modelo.
- A aba Financeiro > Pacotes e cobrança foi atualizada para refletir à vista/parcelado e primeiro vencimento.
- SQL da etapa: `SQL/02 - Parte 2 - Pacotes e parcelamento/SQL_ATUALIZACAO_ANA_TAGES_v2.0.19.sql`.


## v2.0.20 — Parte 3: A receber completo

O card **A receber** do Dashboard abre a carteira detalhada. A tela Financeiro passa a mostrar devedores por paciente/cliente, CPF, valor total da dívida relacionada, valor pago, saldo, andamento das parcelas e vencimentos, com filtros por paciente, status e período. Pacotes usam o vínculo `package_plan_id` para contar parcelas pagas sem misturar históricos antigos.

Esta etapa não possui SQL novo. Os SQLs anteriores permanecem na pasta `SQL/` e devem ficar sem execução até a conclusão de todas as partes.

## v2.0.21 — Parte 4: cards financeiros clicáveis

Os quatro cards financeiros agora funcionam como atalhos de rastreabilidade: **Faturado** abre a origem das cobranças, **Recebido** abre os pagamentos efetivamente recebidos, **A receber** abre devedores/parcelas e **Despesas** abre os gastos do período. A própria tela Financeiro possui as mesmas rotas por card e abas dedicadas a Faturado e Recebido.

Esta etapa não possui SQL novo. Os SQLs das Partes 1 e 2 continuam acumulados e **não devem ser executados ainda**, conforme decisão do usuário de publicar somente quando todas as partes estiverem concluídas.



## v2.0.22 — Parte 5: recibos e documentos financeiros

- Cada cobrança com valor recebido pode emitir **Recibo de pagamento**, usando automaticamente nome/CPF do paciente, valor recebido, valor por extenso, descrição, parcela, data e forma de pagamento.
- Cada cobrança com saldo pendente pode emitir **Nota de cobrança**, com paciente, CPF, referência, parcela, vencimento, valores e situação.
- A visão **A receber** pode emitir **Resumo financeiro** por paciente/plano, com todas as parcelas relacionadas, valores, datas, situação e totais de recebido/a receber.
- Os documentos usam automaticamente **Nome completo, CPF, CRP e Cidade** salvos em Configurações. Cidade foi adicionada porque o modelo de recibo fornecido possui `{{cidade}}`. Nenhum dado profissional fica fixo no código.
- O CPF do paciente vem do próprio cadastro; o sistema bloqueia a emissão se os dados mínimos do profissional ou do paciente estiverem incompletos.
- Novos recebimentos passam a registrar **forma de pagamento** (Pix, transferência bancária, dinheiro, cartão de crédito, cartão de débito ou outro).
- A impressão usa uma página A4 própria do documento. No diálogo do navegador é possível imprimir ou escolher **Salvar como PDF**.
- O texto de **RECIBO DE PAGAMENTO** e a estrutura de **RESUMO FINANCEIRO** seguem os modelos fornecidos pelo usuário.
- SQL desta etapa: `SQL/05 - Parte 5 - Recibos e documentos financeiros/SQL_ATUALIZACAO_ANA_TAGES_v2.0.22.sql`. **Não executar ainda.**

### v2.0.24
- Recuperação do cofre clínico por e-mail cadastrado + Google Authenticator, mantendo código de recuperação como fallback.
- Requer SQL incremental `SQL/06 - Parte 6 - Recuperacao do cofre por email e PDFs/SQL_ATUALIZACAO_ANA_TAGES_v2.0.24.sql`.
- Requer Secret de runtime no Cloudflare Worker: `VAULT_RECOVERY_SECRET` (mín. 32 caracteres, sem prefixo `VITE_`).
- Recibo, nota de cobrança e resumo financeiro imprimem pela própria página, sem depender de pop-up; no diálogo do navegador escolha “Salvar como PDF”.

## v2.0.25 — Prestação de Serviço, primeiro acesso e documentos
- Novo módulo **Prestação de Serviço** com financeiro próprio (`service_work_entries`). Ele é isolado de pacientes, sessões, `billing_entries`, `expenses`, Dashboard e Financeiro do consultório.
- Cards compactos: Faturado, Recebido, A receber, Despesas, Lucro de caixa e Resultado previsto.
- Contas criadas depois do SQL v2.0.25 recebem senha temporária: no primeiro login o usuário é obrigado a definir uma nova senha antes de continuar.
- Recibo, nota de cobrança e resumo financeiro receberam layout A4 institucional mais limpo e legível.
- A nova conta da Ana inicia sem dados visíveis por isolamento `owner_id`; a limpeza física da conta antiga é um passo opcional e separado para evitar exclusão acidental.



## v2.0.27
- Recuperação do cofre legado com ativação guiada por e-mail.
- Acesso técnico `usage_monitor` mostra somente métricas de uso do Supabase.
- Execute os SQLs da pasta `08 - Acesso tecnico e uso do Supabase` antes de criar a conta da Ana.


## v2.0.28 — teste de primeiro acesso
Use `SQL/09 - Testar primeiro acesso como Ana` para homologar a conta única como uma instalação zerada antes da entrega. Não converta essa conta em monitor técnico durante o ensaio.

### v2.0.29
A experiência de senha foi aprimorada: requisitos visíveis em tempo real (8+ caracteres, letra, número, confirmação e, no primeiro acesso, diferença da senha temporária) e botão de mostrar/ocultar senha nos campos de autenticação. Não há SQL novo nesta versão.


### v2.0.30
Correção de build/typecheck da interface de requisitos de senha. Sem alteração de SQL.


### Ajustes v2.0.31
- Pacote/plano em modo Parcelado aceita 1x a 60x, inclusive 1x com vencimento no próximo mês.
- Ao cancelar atendimento de paciente com pacote ativo, o sistema permite cancelar também o pacote e as parcelas pendentes sem apagar pagamentos já registrados.

## v2.0.32 — Perfil de teste local

A aplicação possui agora um perfil de homologação separado da conta clínica. Ele usa a mesma interface e os mesmos módulos, mas pacientes, agenda, financeiro, pacotes, documentos, materiais e Prestação de Serviço são mantidos somente no navegador.

Configuração necessária no Cloudflare Worker:

- `TEST_LOGIN_EMAIL` — Variable de runtime;
- `TEST_LOGIN_PASSWORD` — Secret de runtime.

Não há SQL nesta etapa. Consulte `TEST_PROFILE_SETUP.md`.


## v2.0.33 — login de homologação e uso do Supabase

- Login de teste passa a tentar o endpoint do Worker diretamente, sem depender da chamada `/api/test-auth/info` terminar antes do clique em Entrar.
- `TEST_LOGIN_EMAIL` e `TEST_LOGIN_PASSWORD` são bindings de **runtime** do Worker; build variables não bastam para autenticação.
- Novo módulo **Uso Supabase** aparece somente no perfil de homologação.
- O módulo consulta a Management API do Supabase pelo Worker com token read-only; o token nunca é enviado ao navegador.
- Métricas: tamanho do banco, Storage, arquivos, usuários, usuários ativos no mês, requisições API e disco provisionado.
- Dados de teste continuam no navegador e não são gravados no Supabase.
- SQL: NÃO.
