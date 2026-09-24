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
