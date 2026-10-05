# Perfil de teste local — v2.0.32

Este perfil existe para homologar o ANA TAGES sem tocar nos dados reais da psicóloga.

## O que é isolado

- login do perfil de teste é validado pelo Cloudflare Worker;
- pacientes, agenda, sessões, financeiro, pacotes, recibos, relatórios, materiais, configurações e Prestação de Serviço usam armazenamento local do navegador;
- o perfil de teste não usa Supabase Auth para entrar e os repositórios não executam consultas/gravações no Supabase;
- a conta real da Ana continua usando Supabase + MFA normalmente.

## Configuração no Cloudflare

Em **Settings > Variables and Secrets** do Worker `ana-tages`:

1. Crie `TEST_LOGIN_EMAIL` como **Variable** com o e-mail que você quer usar no perfil de teste.
2. Crie `TEST_LOGIN_PASSWORD` como **Secret** com uma senha forte exclusiva para homologação.
3. Salve/deploy.

Não use `VITE_` nesses nomes. A senha nunca deve entrar no GitHub.

## Como funciona

Na mesma tela de login do consultório, digite o `TEST_LOGIN_EMAIL` e a senha configurada no Cloudflare. O Worker valida as credenciais e cria um cookie HttpOnly de sessão de teste.

Depois do login aparece **MODO TESTE • sem Supabase**. Os módulos são os mesmos do consultório, porém os registros ficam somente naquele navegador.

## Zerar testes

Use o botão **Zerar testes** no cabeçalho ou **Configurações > Perfil de homologação > Zerar dados de teste**.

## Observações

- dados de teste não sincronizam entre computadores ou navegadores;
- limpar os dados do navegador também apaga os registros de homologação;
- materiais de teste são limitados a 2 MB por arquivo porque ficam no armazenamento local;
- não use dados reais de pacientes neste perfil;
- recuperação do cofre por e-mail e Google Authenticator da conta clínica não são simulados no perfil local, para evitar qualquer chamada ao Supabase. O cofre de teste continua podendo ser validado por senha/código local.
