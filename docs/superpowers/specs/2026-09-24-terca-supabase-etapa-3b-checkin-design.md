# Terça no Supabase — Etapa 3b: check-in (Design)

Continuação de `2026-09-23-terca-supabase-etapa-3a-jogadores-rodadas-design.md`. A etapa 3 foi dividida em
3a (jogadores, rodadas, configurações), **3b (este documento)** e 3c (fotos).

## Objetivo

O app faz check-in no Supabase com as mesmas respostas, mensagens de erro e efeitos visíveis (o `GET` seguinte)
do Apps Script atual.

## Escopo

- Ações: `addCheckin`, `removeCheckin` e `salvarEstrelasAjustadas`.
- `addCheckin` e `removeCheckin` **não passam pelo porteiro**: exigem só um `idToken` válido do Google, qualquer
  perfil; a chave mestra sozinha não vale (mesma resposta do ramo que já existia no handler).
- `salvarEstrelasAjustadas` continua atrás do porteiro (organizador e admin; a matriz já tinha a ação).
- Fora de escopo: fotos (3c), financeiro (4), Ao Vivo (5).

## Decisões

- **Sem limite de vagas e sem checagem de repetição**, como no `.gs`: a fila de espera é decidida pelo app pela
  ordem. O mesmo jogador pode ter check-ins em dias diferentes (e até no mesmo dia).
- **`ordem` vem da sequência do banco** (não é enviada), como nas outras tabelas: o check-in novo vai para o fim.
- **Novas primitivas no repositório** (memória e Supabase, mesma semântica): `inserirCheckin(linha)`,
  `removerCheckin(id) -> boolean` e `atualizarCheckin(id, campos) -> boolean` (o Supabase usa `.select('id')` e confere
  se voltou alguma linha). A leitura reaproveita `lerTudo`.
- **Padrões iguais aos do `.gs`:** nome vazio, sexo vazio e estrelas 0 quando não vêm; `estrelasAjustadas` vazio (ou
  0) vira nulo e é lido de volta como `''`; `salvarEstrelasAjustadas` ignora, sem erro, item sem id ou com id que não
  existe mais, e responde `Lista de check-ins vazia.` quando não recebe uma lista com itens.
- **Ganchos do financeiro adiados para a etapa 4:** o `.gs` chama `finAposAdicionarCheckin_` (aplica crédito de dia
  sem jogo) e `finAposRemoverCheckin_` (devolve crédito e sobe a espera) depois de gravar. Aqui não são implementados;
  há um comentário no ponto de chamada em `backend/handler.js`.

## Diferenças conhecidas e aceitas (não cobertas pelo teste diferencial)

- Um `jogadorId` que não existe em `jogadores` é recusado pela chave estrangeira (o `.gs` grava qualquer texto).
- Um `id` de check-in repetido responde `Já existe um check-in com esse id.` (o `.gs` duplica a linha); um check-in
  sem `id` responde `Check-in sem id.` (o `.gs` grava uma linha que a leitura ignora).
- `estrelasAjustadas` que não é número responde `Estrelas ajustadas inválidas.` (a coluna é numérica; o `.gs` guarda
  o texto). Em `salvarEstrelasAjustadas` a lista é validada inteira antes de gravar.
- `data` que não é uma data é recusada pelo banco (coluna `date`); o `.gs` guarda qualquer texto.
- O `GET` diferencial compara tudo **menos o `financeiro`**, porque o `.gs` mexe nas abas do Financeiro por causa dos
  ganchos acima (etapa 4).

## Como garantir que fica igual

- `tests/backend/checkins.test.mjs`: regras sobre o repositório em memória; `repo-escrita.test.mjs`: as três primitivas.
- `tests/backend/handler-etapa3b.test.mjs`: token obrigatório, chave mestra sozinha recusada, permissões de
  `salvarEstrelasAjustadas`.
- `tests/backend/paridade-checkins.test.mjs`: teste diferencial, o `.gs` real na planilha falsa contra o backend novo,
  24 passos, comparando cada resposta e o `GET` (sem financeiro) depois de cada passo.
- `tests/backend/integracao-etapa3b.mjs`: roda no Supabase real (a sequência de `ordem`, a chave estrangeira) e limpa
  tudo. Só é executado à mão.
