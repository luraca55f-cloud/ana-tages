# Deploy — nova implantação

> **DESENVOLVIMENTO CUMULATIVO — NÃO PUBLICAR AINDA:** as Partes 1–5 estão sendo montadas em sequência. Por decisão do usuário, não executar os SQLs acumulados nem fazer deploy até a revisão final do pacote. As instruções históricas abaixo ficam apenas como referência de versões anteriores.


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

## Atualização v2.0.14 — ordem recomendada

Antes de publicar a v2.0.14 no Cloudflare, execute no Supabase **somente**:

`SQL_ATUALIZACAO_ANA_TAGES_v2.0.14.sql`

Isso adiciona os campos necessários ao cofre recuperável. Não reexecute a migration inicial no banco atual.

Para o link de recuperação da senha de login funcionar no domínio publicado, confirme em **Supabase Auth > URL Configuration** que o domínio atual do ANA TAGES está definido como Site URL ou permitido em Redirect URLs.

## Atualização v2.0.15 — recuperação de senha PKCE

- SQL adicional: **NÃO**.
- Publicar normalmente pelo fluxo GitHub → Cloudflare.
- Depois do deploy, solicitar **um novo e-mail** em `Esqueci minha senha`; links gerados pela v2.0.14 não possuem o marcador `?mode=recovery` e não são o teste correto desta correção.
- O callback autorizado continua sendo `https://ana-tages.tagescloud.workers.dev/**` no Supabase.


## Atualização v2.0.18 — Parte 1

Antes do push desta versão, execute no Supabase **somente**:

`SQL/01 - Parte 1 - Dados profissionais e CPF/SQL_ATUALIZACAO_ANA_TAGES_v2.0.18.sql`

Esse SQL adiciona CPF em `app_settings` e `patients` e concede apenas os privilégios de coluna necessários. Não reexecute a migration inicial. Depois faça o deploy normal GitHub → Cloudflare.


## Atualização v2.0.19 — Parte 2

Antes do push da v2.0.19, leia `SQL/LEIA-ME - ORDEM DOS SQL.txt`.

- Se v2.0.18 Parte 1 já estiver no Supabase: execute somente `SQL/02 - Parte 2 - Pacotes e parcelamento/SQL_ATUALIZACAO_ANA_TAGES_v2.0.19.sql`.
- Se ainda não estiver: execute `SQL/01 - Parte 1 - Dados profissionais e CPF/...v2.0.18.sql` e depois a Parte 2.
- Não execute novamente os arquivos em `SQL/00 - Historico - nao executar novamente` nem a migration inicial em banco existente.


## Atualização v2.0.22 — Parte 5

- SQL novo acumulado: `SQL/05 - Parte 5 - Recibos e documentos financeiros/SQL_ATUALIZACAO_ANA_TAGES_v2.0.22.sql`.
- Não executar agora. Parte 5 depende das atualizações acumuladas das Partes 1 e 2; Partes 3 e 4 não possuem SQL.
- A versão final deverá revisar a ordem completa em `SQL/LEIA-ME - ORDEM DOS SQL.txt` antes de qualquer alteração no Supabase.
- Os documentos usam impressão do navegador; não exigem serviço externo de PDF nem chave adicional no Cloudflare.

## v2.0.24 — segredo do cofre
Após executar o SQL v2.0.24 e antes de testar a recuperação por e-mail, configure no Worker `ana-tages` um Secret de runtime chamado `VAULT_RECOVERY_SECRET`, com valor aleatório forte de pelo menos 32 caracteres. Não use prefixo `VITE_` e não salve esse valor no GitHub.

Depois do deploy, desbloqueie o cofre uma vez com a senha atual (ou, se necessário, com o código de recuperação antigo). Esse primeiro desbloqueio cria o envelope necessário para as próximas recuperações por e-mail.

## v2.0.25 — Prestação de Serviço, primeiro acesso e documentos
- Novo módulo **Prestação de Serviço** com financeiro próprio (`service_work_entries`). Ele é isolado de pacientes, sessões, `billing_entries`, `expenses`, Dashboard e Financeiro do consultório.
- Cards compactos: Faturado, Recebido, A receber, Despesas, Lucro de caixa e Resultado previsto.
- Contas criadas depois do SQL v2.0.25 recebem senha temporária: no primeiro login o usuário é obrigado a definir uma nova senha antes de continuar.
- Recibo, nota de cobrança e resumo financeiro receberam layout A4 institucional mais limpo e legível.
- A nova conta da Ana inicia sem dados visíveis por isolamento `owner_id`; a limpeza física da conta antiga é um passo opcional e separado para evitar exclusão acidental.


## v2.0.27 — acesso técnico e recuperação do cofre legado

Antes de criar a conta da Ana, execute os SQLs da pasta `08 - Acesso tecnico e uso do Supabase` na ordem 01 e 02. O segundo SQL converte a conta Auth já existente em `usage_monitor`; ele aborta se houver mais de uma conta, para evitar marcar o usuário errado.

Depois do SQL 02, faça logout/login na conta técnica. Ela deve abrir somente o painel Uso do Supabase. A futura conta da Ana não recebe esse papel e segue o fluxo normal do consultório/primeiro acesso.

Para cofres anteriores à v2.0.24, a recuperação por e-mail precisa de uma ativação única com a senha atual ou o código de recuperação. Isso preserva as evoluções já cifradas sem enfraquecer o modelo criptográfico. Depois da ativação, o fluxo principal é e-mail + Google Authenticator.


## v2.0.28 — teste de primeiro acesso
Use `SQL/09 - Testar primeiro acesso como Ana` para homologar a conta única como uma instalação zerada antes da entrega. Não converta essa conta em monitor técnico durante o ensaio.

## v2.0.32 — acesso de homologação sem Supabase

Antes do deploy, configure no Worker `ana-tages`:

- `TEST_LOGIN_EMAIL` como Variable;
- `TEST_LOGIN_PASSWORD` como Secret.

Não use prefixo `VITE_`. O perfil de teste é autenticado pelo próprio Worker e os dados de homologação ficam no navegador; nenhum SQL novo é necessário.
