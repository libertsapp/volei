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

## Resultado e avisos da revisão final (2026-09-23)

A etapa 2 foi aprovada para merge, com o login real testado no navegador e o teste diferencial (47 passos)
idêntico ao `.gs`. Registros que valem para as próximas etapas:

- **Sem serialização de escritas (diferença real em relação ao `.gs`).** O Apps Script protegia toda gravação
  com `LockService`; o backend novo não tem equivalente, então há três janelas de leitura-depois-escrita:
  `ordem = máximo + 1` (dois primeiros logins simultâneos duplicam a ordem), a regra do último admin (duas
  remoções simultâneas podem deixar zero admins; só a chave mestra recupera) e o vínculo já usado (não há
  índice único em `usuarios.jogador_id`). Aceito na etapa 2 (escala de dezenas de usuários, um escritor por vez).
  **Na etapa 3 isso precisa virar transação no banco** (função Postgres chamada por RPC, ou índice único).
  Endurecimento barato para o schema da etapa 3: `create unique index on usuarios (jogador_id) where jogador_id is not null`
  (e o mesmo para `jogador_id_pendente`).
- **A chave mestra fica exposta na internet quando o backend virar Edge Function.** Antes de publicar: trocar a
  `ADMIN_PASSWORD` por um valor longo e aleatório (a atual é curta e também está no histórico local do git) e
  limitar tentativas nesse caminho.
- **Fuso da data de criação:** o teste diferencial não prova o fuso (o `Utilities.formatDate` falso ignora o
  fuso); o backend formata em `America/Sao_Paulo`, que é o mais fiel. Campo apenas visual.

### O que muda para virar Edge Function (etapa 6)
1. CORS: `Access-Control-Allow-Origin` da origem do GitHub Pages em `GET` e `POST` (o app envia `text/plain`,
   sem preflight), lista de origens estrita.
2. Remover a checagem de `Host` (só faz sentido no localhost); a `Origin` mais a autenticação de cada escrita
   fazem esse papel.
3. Remover a injeção `?perfil=admin`, o serviço do HTML e a troca da `SHEET_API_URL` (o GitHub Pages serve a página).
4. Limite de corpo de pelo menos 600 KB (foto de até 300 KB vira ~400 KB em base64), resposta 413 simples, sem `destroy()`.
5. Segredos vindos do ambiente da função (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`,
   `GOOGLE_CLIENT_ID`), com a mesma checagem "faltam no ambiente" na partida.
6. Publicar com a verificação de JWT do Supabase **desligada** (`--no-verify-jwt`): o app envia um token do
   Google no corpo, e o porteiro é o único portão.
7. Mais tarde, considerar verificação local do token (chaves públicas do Google em cache) em vez de uma chamada
   ao Google por requisição.

### Avisos para a etapa 3
- Portar a exceção `excecaoPropriaFoto_` **dentro do porteiro**, no ponto em que a matriz nega o perfil `jogador`
  em `updatePlayer` (comparar campo a campo: nome, apelido, estrelas, sexo e porte inalterados).
- `uploadPhoto` deve ser tratado logo depois do porteiro e fora da trava (como no `.gs`), com os limites do spec
  (JPEG, até 300 KB, nome único, cache de 1 ano, apagar a foto antiga).
- `removePlayer` vai esbarrar nas chaves estrangeiras (`usuarios.jogador_id`, `jogador_id_pendente`, check-ins,
  rodadas, financeiro), coisa que o `.gs` fazia sem reclamar deixando ids soltos: decidir se apaga/zera as
  referências na mesma transação ou usa `on delete set null`.
- Check-in com limite de vagas exige transação (contar e inserir na mesma operação); `incrementarAcesso` (etapa 5)
  deve ser um `update` atômico, nunca ler-e-gravar; `ordem` das linhas novas deve ser calculada no SQL.
- Manter `addCheckin`/`removeCheckin` fora do porteiro (só validam o token; a chave mestra não conta como "estar logado").
