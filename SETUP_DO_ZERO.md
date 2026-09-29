# Implantação do zero — ordem correta

Este arquivo existe para evitar reaproveitar configurações da implantação antiga.

## Identificadores oficiais desta nova implantação

- Repositório GitHub: `ana-tages`
- Worker Cloudflare: `ana-tages`
- Nome do pacote npm: `ana-tages`
- Branch principal: `main`

## 1. GitHub novo

- Criar uma nova conta GitHub.
- Criar repositório **privado** chamado `ana-tages`.
- Não copiar workflows, Secrets, branches ou arquivos do repositório antigo.
- Enviar somente o conteúdo deste pacote CLEAN START.

## 2. Supabase novo

- Criar uma nova conta/projeto.
- Preferir região próxima aos usuários, como São Paulo para operação no Brasil.
- Abrir SQL Editor.
- Executar `supabase/migrations/202609220001_initial_schema.sql` uma única vez.
- Confirmar sucesso antes de seguir.
- Criar apenas o usuário de teste necessário.
- Copiar Project URL e Publishable Key.

## 3. Cloudflare novo

- Criar nova conta Cloudflare.
- Workers & Pages > Create application > Import a repository.
- Conectar a nova conta GitHub.
- Dar acesso somente ao repositório `ana-tages`.
- Branch: `main`.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.
- Adicionar as variáveis VITE do README antes do deploy.

## 4. Primeiro acesso

- Entrar com usuário de teste.
- Configurar TOTP/Google Authenticator.
- Criar senha do cofre clínico.
- Fazer testes somente com dados fictícios.

## 5. Turnstile

- Configurar somente depois de conhecer o hostname final do Worker.

## 6. Entrega para Anna

- Limpar dados fictícios.
- Alterar o e-mail do mesmo usuário Auth para o e-mail da Anna, preservando o UID.
- Definir senha temporária e permitir que Anna troque a senha.
- Transferir/reconfigurar MFA no aparelho da Anna.
- Anna deve criar a própria senha do cofre clínico.


## Complementos de schema após a migration inicial

Para uma instalação realmente nova usando esta versão do código, após a migration inicial aplique também os incrementais indicados em `SQL/LEIA-ME - ORDEM DOS SQL.txt`. A migration histórica não contém as evoluções de CPF/configurações da Parte 1 nem `package_plans`/parcelamento da Parte 2.

## Recuperação do cofre por e-mail (v2.0.24+)
1. Execute o SQL incremental da pasta 06.
2. No Cloudflare Worker, crie o Secret `VAULT_RECOVERY_SECRET` com no mínimo 32 caracteres.
3. Publique o código.
4. Crie/desbloqueie o cofre uma vez para provisionar a recuperação por e-mail.
5. O fluxo de recuperação será: e-mail cadastrado -> link seguro -> Google Authenticator -> nova senha do cofre.
