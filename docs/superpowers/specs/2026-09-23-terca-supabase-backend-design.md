# Terça no Supabase — Backend compatível (sub-projetos 2 a 6): Design

## Contexto e objetivo

O sub-projeto 1 (schema + migração de dados, ver `2026-09-22-terca-supabase-schema-migracao-design.md`)
deixou os dados reais do Terça no Supabase. O objetivo agora é ter o **app do Terça funcionando
por inteiro sobre o Supabase**, com a intenção de **migrar de vez** se o resultado for bom.
O Terça atual (Apps Script + Google Sheets) continua no ar em paralelo até a virada.

## Decisões

- **Abordagem A: backend compatível com a API atual.** Um módulo de backend novo implementa o
  mesmo contrato de `doGet`/`doPost` do `apps-script-codigo.gs`, lendo e gravando nas tabelas do
  Supabase. O `volei-dashboard.html` muda o mínimo (a `SHEET_API_URL` e um ajuste nas fotos).
  A alternativa B (app falando direto com o supabase-js) foi descartada: muito mais trabalho e
  risco para uma camada de dados de um arquivo grande.
- **Roda como Supabase Edge Function** (`supabase/functions/api`), com a `service_role` usada só
  lá dentro. As 14 tabelas continuam com RLS ligado e sem políticas: o navegador nunca lê nem
  grava direto no banco. A função é publicada sem verificação de JWT do Supabase (o app não usa o
  login do Supabase; a identidade continua vindo do token do Google, verificado pela própria função).
- **A mesma lógica roda local:** o módulo é JavaScript (ESM) sem APIs específicas do Node, então um
  servidor Node local o usa para servir o app em `http://localhost:8770`, e a Edge Function o usa em produção.
- **Login e perfis inalterados:** login opcional pelo Google Identity Services, verificado como hoje
  (endpoint `tokeninfo`, conferindo `aud` com o `GOOGLE_CLIENT_ID`); perfis na tabela `usuarios`; a
  chave mestra `ADMIN_PASSWORD` vira segredo da função (variável de ambiente), fora do código.
- **Matriz de permissões portada como está** (`PERMISSOES`); o front (`PERMISSOES_UI`) não muda.
- **Fotos vão para o Supabase Storage** (decisão do usuário): bucket público `fotos`, servido por CDN.
- **Terça primeiro:** o Meme fica fora deste projeto (regra do CLAUDE.md).

## Arquitetura

```
backend/
  handler.js          roteador: handleGet(), handlePost(body); permissões; contrato JSON
  auth.js             verificação do token Google; perfil por e-mail (tabela usuarios)
  repo-supabase.js    acesso ao banco via supabase-js; devolve objetos no formato das leituras do .gs
  repo-memoria.js     mesma interface, em memória (testes)
  checkin.js, jogadores.js, rodadas.js, financeiro.js, aovivo.js, fotos.js
  servidor-local.js   servidor Node: serve o HTML (trocando a SHEET_API_URL) e /api -> handler
supabase/functions/api/index.ts   adapta Request/Response da Edge Function ao handler
```

- O handler recebe dependências injetadas (`repo`, `auth`, `relogio`), para os testes controlarem
  o login e a data.
- **Contrato:** `GET` devolve `{ players, rounds, settings, checkins, perfisPublicos, aoVivo, financeiro }`
  com exatamente os campos e tipos do `.gs` (datas `yyyy-MM-dd`, carimbos ISO, números e booleanos
  nativos). Os `POST` mantêm os nomes de ação atuais e as mesmas respostas e mensagens de erro.
- **Adaptação à migração:** `players` exclui `convidado = true`; as listas de jogadores das rodadas
  voltam a conter os ids `convidado:NOME#xxxx`; registros com `jogador_id` nulo (órfãos) saem com o
  nome guardado em `jogador_nome`.
- **Fuso horário:** a Edge Function roda em UTC e o `.gs` usa o fuso do script. Toda lógica de "hoje",
  dia do jogo e data aberta do check-in usa `America/Sao_Paulo` explicitamente.
- **CORS:** o app envia `POST` com `Content-Type: text/plain` (sem preflight); a função responde com
  `Access-Control-Allow-Origin` para a origem do GitHub Pages e para o localhost, e trata `OPTIONS`.

## Etapas (cada uma com plano e testes próprios)

1. **Leitura + localhost.** `handleGet` completo, `repo-supabase` de leitura e o servidor local. Pronto
   quando o app abre em `localhost:8770` com os dados reais e o JSON do `GET` é igual ao do `.gs`.
2. **Login e perfis.** `loginGoogle`, `bootstrapAdmin`, ações de usuários (listar, aprovar/rejeitar
   vínculo, mudar cargo, remover), matriz de permissões. Pronto quando os perfis se comportam como
   hoje (o localhost precisa entrar como origem autorizada do Client ID no Google Cloud).
3. **Jogadores, rodadas, check-in e fotos.** Cadastro/edição/remoção, salvar e lançar rodada, check-in
   com trava de vagas, envio de foto e a migração das fotos atuais (ver "Fotos").
4. **Financeiro.** Dia, pagamentos, lançamentos, marcar/estornar (inclusive em massa), dia sem jogo,
   crédito e aplicação automática (os ganchos do check-in), log. É a parte mais delicada.
5. **Ao Vivo e contador de acessos.**
6. **Publicar e virar a chave.** Deploy da função, `SHEET_API_URL` do app apontando para ela, e uma
   última migração de dados no dia da troca (congelar a planilha, rodar o script de migração de novo).
   O Apps Script antigo fica de reserva por 1 a 2 semanas.

## Testes de paridade

O `tests/financeiro-backend.test.js` já roda o `.gs` real contra uma planilha falsa. O mesmo conjunto
de casos (mesmas ações, mesmas respostas esperadas) passa a rodar também contra o backend novo com o
`repo-memoria`, e o conjunto do `GET` compara o JSON dos dois. Cada etapa só termina quando a paridade
das ações daquela etapa passa nos dois backends. Diferenças aceitas e conhecidas (convidados, órfãos)
ficam documentadas nos próprios testes.

## Concorrência (substitui o `LockService`)

`addCheckin`/`removeCheckin` e a aplicação de créditos rodam numa única transação no banco, com trava
(função Postgres com `pg_advisory_xact_lock`), para duas pessoas não ultrapassarem o número de vagas
nem aplicarem o mesmo crédito duas vezes.

## Fotos

- **Hoje:** o front reduz a imagem no navegador (máx. 500 px, JPEG qualidade 82%) e envia em base64;
  o `.gs` grava no Drive e devolve `{ url, fileId }`; a tela usa a miniatura de 300 px que o Drive gera.
- **Depois:** o backend recebe o mesmo base64, grava no bucket público `fotos` com nome único
  (`<jogadorId>-<carimbo>.jpg`) e cache longo (`cacheControl` de 1 ano, seguro por o nome ser único), e
  devolve `{ url, fileId }` (o `fileId` passa a ser o caminho do arquivo no bucket). O arquivo antigo é
  apagado quando `fileIdAntigo` chega. No front, `extrairFileIdDaFoto` passa a entender também as URLs do
  Storage (única mudança no HTML além da `SHEET_API_URL`).
- **Limite de segurança no envio:** o backend recusa uma foto que não seja JPEG ou que passe de 300 KB
  (o app manda ~20 a 80 KB), para proteger o bucket público de envios fora do app. O redimensionamento
  continua sendo feito no navegador (`resizeImageToBase64`: máx. 500 px, qualidade 82%).
- **Migração das fotos atuais (cópia única, na etapa 3):** para cada jogador com foto no Drive, baixar
  o arquivo, enviá-lo ao bucket **sem reprocessar** e atualizar `jogadores.foto`. As fotos já foram
  reduzidas pelo app no envio: as ~47 somam cerca de 1 MB (uns 20 KB cada), então a cópia é leve. Os
  originais permanecem na pasta do Drive como backup; a pasta só é aposentada por decisão do usuário.
- **Sem miniaturas automáticas:** o Storage não gera miniaturas no plano gratuito, mas isso não é problema,
  porque a imagem já é gravada no tamanho final (no máximo 500 px).

## Riscos

- **Volume de lógica portada:** ~1.600 linhas de `.gs` (financeiro é o mais delicado). Mitigação: paridade de testes e etapas pequenas.
- **Partida a frio da Edge Function:** existe, mas costuma ser muito menor que a do Apps Script; medir na etapa 1.
- **Divergência de dados no dia da virada:** mitigada pela migração final e pelo Apps Script de reserva.
- **Segredos:** `service_role`, `ADMIN_PASSWORD` e `GOOGLE_CLIENT_ID` só como segredos da função e no `.env` local.
  As chaves que passaram pelo chat devem ser regeneradas antes da virada.

## Fora de escopo

O Vôlei Meme; o login com Google do Supabase (Supabase Auth); qualquer redesenho visual; recursos novos.

## Notas descobertas ao planejar a etapa 1

- **Ao Vivo (etapa 5) exige ajuste de schema:** a aba `AoVivo` do Apps Script guarda também `data` e a lista de jogadores de cada time, e a tabela `ao_vivo` atual não tem essas colunas. Adicionar (por exemplo `data date` e `jogadores text`) antes de portar a leitura e as ações do Ao Vivo. Até lá, o backend falha alto se houver linhas de Ao Vivo em vez de responder dado errado.
- **Ordem e desempate:** todas as listas do contrato saem por `ordem` (planilha), `posicao` e `time_index`; linhas novas recebem `max(ordem) + 1` na mesma transação que grava.
- **Carimbos:** o app espera texto ISO com milissegundos e `Z` (`toISOString`); o Postgres devolve `+00:00`, então o backend normaliza.
