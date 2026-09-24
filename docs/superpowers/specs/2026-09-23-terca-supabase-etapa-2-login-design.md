# Terça no Supabase — Etapa 2: login e perfis (Design)

Continuação de `2026-09-23-terca-supabase-backend-design.md` (etapa 2 da lista). A etapa 1 entregou a leitura
(`GET`); esta etapa entrega o login com Google, o porteiro de permissões e o gerenciamento de usuários e
vínculos, que são as primeiras **gravações** do backend novo.

## Objetivo

Entrar com o Google em `http://localhost:8000` e o app reconhecer a conta com o perfil real (jogador,
organizador ou admin), com as mesmas regras, mensagens de erro e respostas do Apps Script atual.

## Escopo

- Ações públicas: `loginGoogle`, `bootstrapAdmin` (chave mestra + token) e `lerAoVivo` (leitura; hoje vazia).
- Porteiro (`autorizar`) com a matriz `PERMISSOES` inteira (as do `.gs`, inclusive as do financeiro), aceitando a
  chave mestra (`senha`) **ou** o login do Google (`idToken`). Ação que não é da matriz: `Ação desconhecida: <nome>`.
- Ações de usuários: `ping`, `listarUsuarios` (organizador nunca recebe o `perfil` de ninguém), `salvarUsuario`,
  `removerUsuario`, `solicitarVinculo`, `aprovarVinculo`, `rejeitarVinculo`.
- `addCheckin`/`removeCheckin` (etapa 3) só validam o token e respondem "ainda não disponível"; as demais ações da
  matriz passam pelo porteiro e respondem "ainda não disponível" (a exceção de foto do jogador vem na etapa 3).
- Segurança do servidor local: só aceita `Host` `localhost:PORTA`/`127.0.0.1:PORTA`, exige `Origin` da própria
  página nos `POST`, limita o corpo a 1 MB e recusa iniciar sem `ADMIN_PASSWORD` e `GOOGLE_CLIENT_ID` no `.env`.

## Decisões

- **Mesmas regras e mensagens do `.gs`.** O app reconhece várias mensagens de erro; nenhuma é reescrita.
- **Segredos só do ambiente:** `ADMIN_PASSWORD` e `GOOGLE_CLIENT_ID` vêm do `.env` (e, depois, dos segredos da
  Edge Function). A comparação da chave mestra é em tempo constante. Sem `ADMIN_PASSWORD` configurada, a chave
  mestra fica desativada.
- **Verificação do token:** o mesmo endpoint `tokeninfo` do Google, conferindo `aud`, `email_verified`, `exp` e
  e-mail; só usa o `fetch` global (funciona em Node e em Deno).
- **E-mail sempre normalizado** (minúsculas, sem espaços) na leitura e em toda gravação; no Postgres a chave é
  sensível a maiúsculas, então nunca se grava um e-mail sem normalizar.
- **Ordem e criação:** usuário novo recebe `ordem = máximo + 1` e `criado_em = agora`; atualizar nunca mexe em
  `criado_em` nem em `ordem`. `listarUsuarios` devolve `criadoEm` só com a data (`yyyy-MM-dd`, fuso de São Paulo),
  como o `.gs`.
- **Repositório com primitivas de gravação** (`lerUsuarios`, `lerJogadores`, `gravarUsuario`, `removerUsuario`),
  iguais no repositório em memória (testes) e no do Supabase. A regra de negócio fica em `backend/usuarios.js`.
- **Comportamento herdado do `.gs`, mantido de propósito:** `solicitarVinculo` e `rejeitarVinculo` gravam o usuário
  sem passar `jogadorId`, o que **zera o vínculo já aprovado** de quem tinha um. O teste diferencial exige o mesmo
  resultado. Corrigir isso é uma mudança de comportamento, decidida depois da virada.

## Como garantir que fica igual: teste diferencial

Uma sequência de ~35 pedidos (logins válidos e inválidos, vínculos, promoções, remoções, permissões negadas,
chave mestra, bootstrap) roda no **`.gs` real** (planilha falsa, com a chamada ao Google simulada) e no
**backend novo** (repositório em memória, com o mesmo Google simulado). Cada resposta e o estado final precisam ser
idênticos. As diferenças aceitas: `criadoEm` de usuários criados durante o cenário (a data de hoje) é normalizado.

## Fora de escopo

Foto do próprio jogador (etapa 3), check-in, jogadores, rodadas, financeiro, Ao Vivo (gravação), contador de
acessos gravável. A etapa 1 continua respondendo o `incrementarAcesso` sem incrementar.

## Riscos

- **Gravações no banco real:** os testes manuais no localhost gravam na tabela `usuarios` do Supabase real (uma
  cópia; a migração final refaz os dados). Os testes automáticos usam só o repositório em memória.
- **Fuso:** a data de criação exibida é a de São Paulo; usuários sem data na planilha ganharam a data da migração.
- **Login real:** exige que `http://localhost:8000` esteja nas origens autorizadas do Client ID (já está).
