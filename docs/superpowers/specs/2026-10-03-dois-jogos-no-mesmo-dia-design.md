# Dois jogos no mesmo dia — design

Data: 2026-10-03 · Vale para: **Terça** (schema `public`, função `terca-api-teste`, `volei-dashboard.html`). O banco do **Meme**
(schema `meme`) recebe o mesmo SQL porque a função `meme-api` usa o mesmo `backend/`; o **app do Meme não muda** até o usuário
autorizar a replicação. Protótipo usado para decidir: `.superpowers/brainstorm/dois-jogos/` (descartável, fora do git).

## Problema

O check-in só conhece **uma data aberta**, com um horário, um número de vagas e uma trava (`checkinDataAberta`,
`checkinHorario`, `checkinVagas`, `checkinTravado`). O financeiro tem a **data como chave** (`fin_dias.data`) e aceita um
pagamento válido por **data + jogador**. O grupo passa a ter, às vezes, **dois jogos no mesmo dia** (provavelmente em horários
diferentes), com listas separadas. O padrão continua sendo um jogo.

## Decisões do usuário (2026-10-03)

| # | Pergunta | Escolha |
|---|---|---|
| D1 | Onde a pessoa confirma presença | **Abas no topo** (uma por jogo) + o "Vou jogar" de sempre |
| D2 | A mesma pessoa pode estar nos dois jogos? | **Pode** |
| D3 | No financeiro **único**, quem joga os dois paga | **Uma vez** (o pagamento vale para os 2 jogos) |
| D4 | Mensagem do WhatsApp com 2 jogos | **Uma mensagem com as duas listas** |
| D5 | A rodada guarda de qual jogo veio? | **Depois, numa 2ª etapa** (fora deste trabalho) |
| D6 | Trocar um confirmado de fila (jogo) | **Botão ⇄ em cada confirmado** (não é arrastar — ver justificativa abaixo) |

Pedido original: financeiro diferente para cada lista **só se for escolhido**, com a escolha **no próprio check-in**, e poder
**trocar jogadores de fila** entre os dois jogos.

### D6: por que botão em vez de arrastar

O app roda sobretudo no **celular** (PWA), e "arrastar" de verdade (a tecnologia que a tela de Sorteio já usa para mover
jogador entre times) é a API nativa de drag-and-drop do navegador, que **só funciona com mouse — não em touch**. Mesmo no
Sorteio, quem usa o celular não arrasta: usa um seletor por toque ao lado de cada time. Arrastar de verdade também exigiria
as **duas filas visíveis ao mesmo tempo**, o que entraria em conflito com a D1 (abas, uma lista por vez). O usuário escolheu o
botão **"⇄ Mover para as 21:00"** em cada confirmado: um toque, funciona igual no celular e no computador, e as abas continuam
como estão.

## Comportamento

### Com 1 jogo (o padrão): nada muda

Sem abas, sem opção nova na tela. Tudo o que já existe no banco é "jogo 1" e aparece exatamente como hoje.

### Criar e remover o 2º jogo (organizador/admin)

- Com o check-in aberto e 1 jogo, aparece **"➕ Adicionar 2º jogo neste dia"** na área de controle. Um modal pede **horário**
  (sugestão: 2 h depois do 1º, até 23:00) e **vagas** (sugestão: as mesmas do 1º). Horário igual ao do 1º é recusado.
  O 2º jogo nasce com a lista vazia e a aba dele fica ativa.
- Em **⚙️ Ajustes do check-in**, cada jogo tem sua linha: horário, vagas e (com 2 jogos) um botão 🗑 para remover aquele jogo.
- **Remover um jogo com gente na lista** pergunta o que fazer: **mover todos para o outro jogo** (entram no fim da fila, na
  ordem em que estavam, sem duplicar quem já está lá) ou **desconfirmar todos**. Se o jogo removido tem **pagamento válido**
  (dinheiro ou crédito) amarrado só a ele (modo separado), a remoção é **bloqueada** até "Cancelar todos" ou marcar o jogo
  como sem jogo. Remover o jogo 1 com o 2º existindo: o que sobra passa a ser o jogo 1 (por dentro, a lista do 2º é movida
  para o 1º).
- **Fechar check-in** fecha o dia inteiro (os dois jogos). O 2º jogo fica guardado **junto com a data**: reabrir a **mesma**
  data traz os dois jogos de volta (como hoje a lista volta); abrir uma data **nova** começa com 1 jogo.
- **Trocar a data** com o check-in aberto (botão "📅 Trocar para dd/mm") leva o 2º jogo junto (é correção de data). As listas
  da data antiga ficam nela, como hoje.

### As abas (D1)

- Com 2 jogos aparecem duas abas logo abaixo do aviso verde, **sempre em ordem de horário**: "1º jogo · 19:00 · 14/16 · 2 na
  reserva" e "2º jogo · 21:00 · 5/12". No perfil jogador logado, a aba mostra "você ✅" se a pessoa está naquele jogo.
- O aviso verde passa a dizer: "Check-in aberto para 06/10/2026 — 2 jogos: 19:00 (16 vagas) e 21:00 (12 vagas). Escolha o jogo abaixo."
- **Tudo abaixo das abas vale para o jogo da aba**, e o texto dos botões diz qual jogo quando há 2: contador e "Desconfirmar
  todos", resumo do financeiro, Confirmados/Reserva, busca + "Vou jogar", adicionar convidado, colar lista do WhatsApp, travar
  ("🔒 Travar 21:00"), ajustar estrelas, "Usar confirmados das 21:00 no Sorteio".
- Aba inicial ao abrir o app: a do jogo mais cedo.

### Mesma pessoa nos dois jogos (D2)

Pode. Cada jogo tem sua fila e sua reserva. Quem está no outro jogo ganha uma etiqueta discreta: "+21:00" nas listas
Confirmados/Reserva e "também às 21:00" na linha da busca. Quem cai na reserva vê "💡 O jogo das 21:00 ainda tem 3 vaga(s)"
quando o outro jogo tem vaga e está destravado.

### Mover um confirmado para o outro jogo (D6)

- Na lista **Confirmados** (e na **Reserva**) do jogo da aba, cada nome que está **só nesse jogo** (não nos dois) ganha um
  botão discreto **"⇄"**. Tocar pergunta "Mover [nome] para o jogo das 21:00?" e, confirmando, a pessoa sai da fila atual e
  entra no **fim da fila** do outro jogo (como uma nova confirmação — pode cair na reserva de lá). Quem já está nos dois
  jogos não ganha o botão (não há "para onde mover").
- Só organizador/admin vê o botão (é organização de lista, como "Desconfirmar todos" e a lista colada do WhatsApp).
- Mover reaproveita os **mesmos ganchos do financeiro** de sair/entrar na lista: se a pessoa tinha pago o jogo de origem
  (modo separado) e o pagamento era com **crédito**, o crédito volta ao saldo; se era em **dinheiro**, o pagamento continua
  válido e ela aparece sinalizada "pagou e saiu da lista" nesse jogo (igual a quem desconfirma hoje); ao entrar no jogo de
  destino, se ela tiver crédito disponível, é aplicado sozinho, como em qualquer nova confirmação.
- Só existe com **2 jogos** no dia; a lista some com o 2º jogo.

### Financeiro do dia: único (padrão) ou separado

- A escolha aparece **dentro do cartão "💰 Financeiro do dia"** do check-in, **só quando há 2 jogos**:
  - **Um financeiro para o dia** (padrão): um valor por pessoa, um PIX, **uma quadra** e um brinde para o dia. O pagamento é
    **do dia**: quem joga os dois jogos paga **uma vez** (D3) e aparece pago nos dois. "Quem conta" para cobrar é a **união**
    de quem está confirmado, dentro das vagas, em **qualquer um** dos jogos (sem contar a mesma pessoa duas vezes).
  - **Separado por jogo**: cada jogo tem valor, PIX, quadra, brinde, ícone e "sem jogo" próprios, e o **pagamento é por
    jogo**: quem joga os dois paga os dois, e cada jogo mostra só os pagamentos dele. O cartão mostra os valores do jogo da
    aba ("Valores do jogo das 21:00"); o 2º jogo começa com os valores do 1º como sugestão (chip "pendente" até salvar).
- A escolha é gravada ao tocar em **Salvar** do cartão. **Trocar de modo é bloqueado se o dia já tem pagamento válido**
  ("Já há N pagamento(s) neste dia. Para trocar, use Cancelar todos antes"): evita um pagamento "do dia" virar ambíguo
  quando o dia passa a ter cobrança por jogo (ou o contrário).
- **Confirmar todos / Cancelar todos**: no único, agem sobre a **chave do dia** (os pendentes/pagos somados dos 2 jogos); no
  separado, agem só sobre o jogo da aba.
- O resumo visível a todos ("💰 R$ 15,00 por pessoa · PIX · barra Arrecadado X de Y") mostra, no único, o progresso do **dia**
  (mesmo estando na aba de um jogo específico); no separado, o progresso **do jogo da aba**. A "Saída" mostrada é a do dia
  (único) ou a do jogo (separado).
- Lançamentos avulsos continuam sendo **do dia**.

### Dia sem jogo e crédito

- **Separado:** "🌧️ Jogo das 21:00 sem jogo" vale **só para aquele jogo**: a quadra/brinde dele deixam de contar e os
  pagamentos dele viram crédito (ou são devolvidos), como hoje. O outro jogo segue normal. "☀️ Reabrir jogo" desfaz, com as
  mesmas regras de hoje (só se nenhum crédito dele foi usado).
- **Único:** "🌧️ Dia sem jogo" vale para o **dia inteiro** (os dois jogos), como hoje. O modal avisa: se só um dos jogos pode
  não acontecer, use "Separado por jogo" antes de cobrar.
- O crédito guarda de onde veio (o dia inteiro, ou um jogo específico no separado) e continua sendo usado **só em datas
  seguintes** (nunca no outro jogo — nem na outra cobrança — do mesmo dia).
- A aplicação automática de crédito depende do modo: no **único**, roda uma vez por dia (quem está confirmado, dentro das
  vagas, em qualquer um dos jogos, e ainda não pagou o dia); no **separado**, roda uma vez por jogo.

### Página Financeiro, fechamento e saldo previsto

- O **caixa continua um só** (soma de tudo, como hoje).
- O dia com 2 jogos ganha o selo "2 jogos" e o corpo em blocos: no separado, um bloco por jogo (saída, valor/PIX, pagamentos,
  quem falta pagar); no único, "Saídas do dia" (uma quadra) e os pagamentos do dia, com uma etiqueta de quais jogos cada
  pessoa jogou.
- O **fechamento do WhatsApp** sai num texto só. No único: lista de quem pagou (uma vez, o dia inteiro) com uma nota de quais
  jogos cada um jogou, recebido e despesas do dia. No separado: um bloco por jogo (lista de quem pagou aquele jogo,
  recebido daquele jogo; jogo sem jogo = "pagamentos guardados como crédito") e o resumo do dia no fim (saldo anterior,
  recebido, despesas, saldo atual).
- **Saldo previsto**: no único, conta os pendentes da união dos 2 jogos uma vez cada; no separado, soma os pendentes dos dois
  jogos (cada um × o valor daquele jogo).
- Nos dias passados o nome do jogo é "1º jogo"/"2º jogo" (o horário só é conhecido enquanto aquela data está configurada).

### Mensagem do WhatsApp (D4)

Uma mensagem com as duas listas. O texto de abertura configurável troca `{horario}` por "19:00 e 21:00" e `{vagas}` por
"16 + 12". No financeiro único, valor e PIX aparecem uma vez no topo; no separado, embaixo do cabeçalho de cada jogo. Cada lista
vem com o cabeçalho "🏐 *JOGO DAS 19:00* (16 vagas)", os confirmados numerados com ✅/💰/🍫 (no único, marcado se pagou o dia;
no separado, se pagou aquele jogo) e a "Espera" do próprio jogo.

### Sorteio e estrelas ajustadas

"Usar confirmados das 21:00 no Sorteio" e o "Importar do check-in" da tela de Sorteio levam o jogo escolhido (com 2 jogos, o
botão de importar pergunta qual). O sorteio passa a usar a **estrela ajustada daquele jogo** (cada check-in tem a sua, então o
ajuste já é por jogo). O "⭐ Ajustar estrelas" mostra só a lista do jogo da aba.

### Fora deste trabalho (D5) e limitação conhecida

A rodada (Nova rodada/Histórico) **não** guarda de qual jogo veio. O Início já mostra os dois jogos do dia (rodada dupla, v14.6).
Limitação aceita até a 2ª etapa: a **nota total do time** no Histórico (só admin) e o "time mais forte" do resumo da semana
procuram a estrela ajustada por **data + jogador**; se a mesma pessoa jogou os dois jogos com ajustes diferentes, pode aparecer
o ajuste do outro jogo.

## Modelo de dados — `sql/schema-terca-supabase-ajuste-9.sql` (+ o mesmo para o schema `meme`)

Rodado pelo usuário no SQL Editor, uma vez por schema. Tudo aditivo e com padrão: o que existe vira "jogo 1" (check-ins) ou
"o dia inteiro" (pagamentos e créditos — ver abaixo por que isso não exige nenhum backfill).

```sql
-- check-in: de qual jogo (fila) do dia. Sempre um valor: confirmar presença é sempre numa fila específica.
alter table checkins add column if not exists jogo smallint not null default 1;
alter table checkins add constraint checkins_jogo_valido check (jogo in (1, 2));

-- pagamento: NULL = vale para o DIA inteiro (modo único, D3: paga uma vez); 1 ou 2 = só aquele jogo (modo separado).
-- Linhas que já existem não precisam de backfill: um pagamento antigo, de quando só havia 1 jogo, sempre valeu "pro dia"
-- (não havia distinção), então NULL já é o valor certo pra elas.
alter table fin_pagamentos add column if not exists jogo smallint null;
alter table fin_pagamentos add constraint fin_pagamentos_jogo_valido check (jogo in (1, 2));
-- "um pagamento válido por jogador, por chave de cobrança" — coalesce(jogo, 0) trata NULL como uma chave só (um único
-- UNIQUE INDEX normal NÃO barraria duas linhas com jogo IS NULL, porque o Postgres trata NULL <> NULL)
begin;
drop index if exists fin_pagamentos_valido_uniq;
create unique index fin_pagamentos_valido_uniq on fin_pagamentos (data, coalesce(jogo, 0), jogador_id) where not estornado;
commit;

-- o dia: financeiro separado por jogo? (false = único, o padrão)
alter table fin_dias add column if not exists por_jogo boolean not null default false;

-- configuração própria do 2º jogo (só existe no modo separado; o 1º jogo continua em fin_dias)
create table if not exists fin_jogos (
  data date not null references fin_dias(data),
  jogo smallint not null check (jogo = 2),
  valor_pessoa numeric(10,2), pix text, valor_quadra numeric(10,2), tem_brinde boolean, valor_brinde numeric(10,2),
  icone text, status text not null default 'normal' check (status in ('normal', 'semjogo')),
  atualizado_por text, atualizado_em timestamptz,
  primary key (data, jogo)
);
alter table fin_jogos enable row level security; -- sem políticas: só a service_role (a função) acessa

-- crédito: de onde veio (mesma regra do pagamento de origem: NULL = do dia, 1/2 = de um jogo no modo separado)
alter table fin_creditos add column if not exists jogo_origem smallint null;
alter table fin_creditos add constraint fin_creditos_jogo_origem_valido check (jogo_origem in (1, 2));

-- mover um check-in para o fim da fila do outro jogo (botão ⇄), numa transação só
create or replace function mover_checkin_de_jogo(p_id text, p_para_jogo smallint) returns boolean ...

-- remover o 2º jogo movendo a lista para o 1º: numa transação só, no fim da fila, sem duplicar
create or replace function mover_jogo2_para_jogo1(p_data date) returns int ...
```

- As constraints `check` usam `if not exists` via bloco `do $$` (o arquivo pode rodar mais de uma vez, como os anteriores).
- `mover_checkin_de_jogo`: se a pessoa já está no jogo de destino, não faz nada e devolve `false`; senão muda `jogo` e dá
  `ordem = nextval('seq_ordem_checkins')` (vai pro fim da fila de lá), devolve `true`. O backend chama os ganchos do
  financeiro (sair do jogo de origem, entrar no de destino) ao redor desta função, sob a mesma trava `gravacao`.
- `mover_jogo2_para_jogo1`: apaga do jogo 2 quem já está no jogo 1; o resto ganha `jogo = 1` e `ordem = nextval(...)` na
  ordem em que estava; devolve quantos moveu.
- `revoke execute ... from public, anon, authenticated` + `grant` para `service_role` nas duas funções.
- Por que `fin_jogos` em vez de mudar a chave de `fin_dias` para (data, jogo): `fin_pagamentos.data` é chave estrangeira de
  `fin_dias(data)`; mudar a chave primária quebraria essa ligação e exigiria migrar todas as linhas. Assim, `fin_dias` continua
  sendo "o dia" (e, no separado, também a config do 1º jogo), e nada que já existe muda.
- Meme: o mesmo conteúdo com `set search_path = meme` em `sql/meme/ajuste-9-dois-jogos-meme.sql`, e o ajuste 9 entra na lista
  do `scripts/gerar-sql-grupo.js`.

### Configuração do 2º jogo (tabela `config`, chaves novas)

`checkinJogo2Data`, `checkinJogo2Horario`, `checkinJogo2Vagas`, `checkinJogo2Travado`. O 2º jogo **existe** quando
`checkinJogo2Data` é igual a `checkinDataAberta`. O 1º jogo continua nas chaves de hoje.

## Backend (`backend/`, o mesmo código para as duas funções)

### Leitura (GET) — só campos novos, nada removido

- `checkins[].jogo` (número, 1 se vazio).
- `settings.checkinJogo2`: `{ data, horario, vagas, travado }` ou `null`.
- `financeiro.dias[].porJogo`; `financeiro.jogos[]` (as linhas de `fin_jogos`, mesmos nomes dos dias + `jogo`);
  `financeiro.pagamentos[].jogo` (número ou `null` = "do dia"); `financeiro.creditos[].jogoOrigem` (número ou `null`).

### Check-in

- `addCheckin` aceita `checkin.jogo` (ausente = 1; diferente de 1 ou 2 = erro). Recusa:
  - jogo 2 quando a data não tem 2º jogo configurado ("Esse jogo não existe mais. Recarregue a página.");
  - a mesma pessoa duas vezes no **mesmo** jogo ("Essa pessoa já está na lista desse jogo.").
- Ganchos do financeiro passam a receber o jogo: `aposAdicionarCheckin(data, jogo)`, `aposRemoverCheckin(data, jogo, jogadorId)`.
- **`moverCheckin({ id, paraJogo })`** (organizador/admin, sob a trava `gravacao`): lê o check-in, recusa se a pessoa já está
  no jogo de destino ou se o destino não existe; chama `aposRemoverCheckin(data, jogoOrigem, jogadorId)`, grava
  `mover_checkin_de_jogo`, chama `aposAdicionarCheckin(data, paraJogo)`. Tudo ou nada: se a troca não acontecer (já estava lá),
  devolve `{ status: 'ok', moveu: false }` sem log.

### Ações novas de organização do dia (organizador/admin)

- `salvarJogo2 { jogo2: { data, horario, vagas, travado } }`: cria/edita o 2º jogo. Valida horário `HH:MM`, diferente do 1º
  jogo na mesma data, e vagas > 0. **Só ela mexe nas chaves `checkinJogo2*`**: `saveSettings`/`saveCheckinSettings` não as tocam,
  então um app antigo em cache (que reenvia as configurações inteiras) não consegue apagar nem desfazer o 2º jogo.
- `removerJogo2 { data, destino: 'mover' | 'desconfirmar' }`, sob a trava `gravacao`: recusa se o jogo 2 tem pagamento válido
  amarrado só a ele (modo separado); `mover` chama `mover_jogo2_para_jogo1`; `desconfirmar` apaga os check-ins do jogo 2; no
  modo separado apaga a linha de `fin_jogos` e volta `por_jogo` para false; limpa as chaves `checkinJogo2*`; aplica crédito no
  jogo 1 (quem foi movido pode ter).
- Remover o **jogo 1** com o 2º existindo: o app faz "trocar os papéis" com a mesma ação (`destino` + `manter: 2`), o servidor
  move a lista do 2º para o 1º, copia horário/vagas/trava do 2º para as chaves do 1º e, no separado, copia `fin_jogos` para
  `fin_dias`. Recusa se o jogo removido tem pagamento válido amarrado só a ele.

### Financeiro — a "chave de cobrança" (`chave`: `null` = o dia, `1`/`2` = um jogo) entra em todas as ações

- `chaveDoDia(data)`: lê `fin_dias.por_jogo`; se `false`, a única chave possível é `null` (o dia); se `true`, as chaves são
  `1` e `2`, cada uma com sua config (`fin_dias` para o 1, `fin_jogos` para o 2).
- `confirmadosPelaChave(t, data, chave)`: chave `null` → união de quem está confirmado, dentro das vagas, em **qualquer** um
  dos jogos do dia (sem repetir pessoa); chave `1`/`2` → só os confirmados daquele jogo, dentro das vagas dele.
- `salvarFinDia({ data, jogo, porJogo, ...valores })`: jogo 1/ausente grava `fin_dias` (com `por_jogo` quando enviado); jogo 2
  exige o dia já salvo e `por_jogo = true` e grava `fin_jogos`. Mudar `por_jogo` com pagamento válido na data (em qualquer
  chave) = erro. Aplica crédito em todas as chaves do dia (1 chave no único, 2 no separado).
- `marcarPagamento(data, chave, ...)`: a pessoa precisa estar em `confirmadosPelaChave`; valor = o da config daquela chave;
  índice único por (data, `coalesce(chave, 0)`, jogador).
- `marcarTodosPagamentos(data, chave)` e `estornarTodosPagamentos(data, chave)`: agem sobre essa chave.
- `estornarPagamento(id)`: "está na lista?" é conferido com a chave do próprio pagamento (`confirmadosPelaChave` com a chave
  dele).
- `marcarDiaSemJogo(data, chave, destino)` / `reabrirDia(data, chave)`: chave `null` (só existe quando `por_jogo = false`)
  vale para o dia todo (status em `fin_dias`, todos os pagamentos da data viram crédito/são devolvidos); chave `1`/`2` (só
  existe quando `por_jogo = true`) vale só para aquele jogo (status em `fin_dias` se chave 1, em `fin_jogos` se chave 2;
  créditos filtrados por `data_origem` + `jogo_origem = chave`).
- `aplicarCreditos(data, chave)`: usa `confirmadosPelaChave` e a config daquela chave. `aplicarCreditosDoDia(data)` chama uma
  vez por chave existente naquele dia. `aplicarCreditosFuturos` idem, para cada data futura já configurada.
- `fin_log`: os detalhes ganham `jogo` quando a chave não é o dia inteiro.

## App (`volei-dashboard.html`, só o Terça)

- Estado novo `JOGO_ATIVO` (1 ou 2) e `jogosDoDiaAberto()`: a lista de jogos da data aberta em ordem de horário. Inclui um
  jogo 2 "sem configuração" se houver check-ins com `jogo = 2` nessa data e o 2º jogo não estiver configurado (ninguém some).
- As funções do check-in que hoje leem só `SETTINGS.checkinDataAberta` passam a receber **data + jogo** (lista, dentro/reserva,
  contador, ordenados, convidado, colar lista, desconfirmar todos, sorteio, compartilhar, ajustar estrelas,
  `comEstrelaDoCheckin` com o jogo importado para o sorteio).
- `chaveDoJogoAtivo()`: `null` quando `FINANCEIRO.porJogo` é falso (independente da aba — o único é "do dia"); o número do
  jogo da aba quando `porJogo` é verdadeiro. É essa chave que o resumo, Confirmar/Cancelar todos e os botões de pagamento usam.
- Botão **⇄** nas linhas de Confirmados/Reserva: aparece quando há 2 jogos e a pessoa está só no jogo da aba; chama
  `moverCheckin`, com confirmação (`confirm`) antes.
- Bloco puro novo `// <dois-jogos-puro>` (testável no Node): `jogosDoDia`, `dentroEReservaDoJogo`, `confirmadosPelaChave`,
  `cfgFinDaChave`, `textoWhatsAppDoDia`, `fechamentoDoDia`, `saidaDoDia`. O bloco `<financeiro-puro>` ganha o parâmetro `chave`
  onde hoje há só a data (sem mudar o resultado quando a chave é `null`/o dia tem 1 jogo).
- CSS novo com seletores de classe (`.jogos-abas`, `.jogo-aba`, `.jogo-cfg`, `.tag-outro`, `.dica-vaga`, `.btn-mover`); nada de
  `<section>` nem seletor de tag pura (erros já vividos).
- Info do app: novidade da 15.0 explicando o 2º jogo, o financeiro único/separado e o botão ⇄.

## Compatibilidade e ordem de publicação

1. **SQL** do ajuste 9 nos dois schemas (`public` e `meme`) — o usuário roda no SQL Editor.
2. **Backend** nas duas funções (`npm run preparar-edge`, `preparar-edge -- meme-api` e os dois deploys) — o usuário roda.
   O backend novo funciona com o app antigo (tudo sem `jogo`/chave = 1/dia; campos novos no GET são ignorados pelo app antigo).
3. **Push do Terça** (GitHub Pages e Vercel). O app novo **não pode** ir antes do backend: o servidor antigo ignoraria `jogo` e
   gravaria o check-in do 2º jogo no 1º.

App antigo aberto em algum celular durante a troca: não apaga o 2º jogo (ação dedicada), e o check-in dele cai no jogo 1; até
recarregar, ele mostraria as duas listas juntas (o service worker não guarda cache, então recarregar resolve).

Volta atrás: reverter o commit do app; backend e SQL podem ficar (são compatíveis com o app antigo).

## Casos de borda

| Situação | Comportamento |
|---|---|
| Dois toques quase juntos em jogos diferentes | Trava `gravacao` (já existe) serializa; cada jogo tem sua fila |
| Mesma pessoa duas vezes no mesmo jogo (toque duplo, lista colada) | Servidor recusa a segunda; o app desfaz a linha local |
| Check-in no 2º jogo depois que ele foi removido | Servidor recusa ("Esse jogo não existe mais") |
| Horário do 2º igual ao do 1º | Recusado no app e no servidor |
| Trocar único ↔ separado com pagamento no dia | Bloqueado com aviso (Cancelar todos antes) |
| Remover jogo com pagamento válido amarrado só a ele | Bloqueado com aviso |
| Mover (⇄) quem já está nos dois jogos | O botão não aparece (nada para onde mover) |
| Mover (⇄) para um jogo onde a pessoa já tem pagamento válido (separado) | Continua sinalizada "pagou e saiu da lista" no jogo de origem; sem cobrança automática no destino |
| Jogo 2 sem jogo (separado) e jogo 1 normal | Só a quadra do jogo 2 deixa de contar; crédito com `jogoOrigem = 2` |
| Crédito do jogo 2 de hoje | Não paga o jogo 1 de hoje nem o "dia" de hoje; só datas seguintes |
| No único, pendentes do dia | Quem está confirmado nos 2 jogos conta uma vez só (não dobra o previsto) |
| Reabrir a mesma data depois de fechar | Volta com os 2 jogos e as duas listas |
| Abrir data nova | 1 jogo (padrão) |
| Check-ins de jogo 2 sem configuração | Aba "2º jogo" aparece mesmo assim, com as vagas do 1º |
| Organizador muda o horário do 1º para o mesmo do 2º | Recusado no app; o servidor também recusa no `saveCheckinSettings` quando a data do 2º jogo é a aberta |

## Testes

- **Backend** (repositório em memória, `tests/backend/dois-jogos.test.mjs`): check-in por jogo, repetido no mesmo jogo
  recusado, mesma pessoa nos dois jogos aceita, jogo 2 inexistente recusado, `saveSettings` do app antigo não toca o 2º jogo,
  `salvarJogo2` (validações), `removerJogo2` (mover no fim da fila sem duplicar; desconfirmar; bloqueio com pagamento; trocar
  os papéis), `moverCheckin` (move e aplica os ganchos do financeiro; recusa se já está no destino), financeiro único
  (pagamento vale os 2 jogos, pendentes contam a pessoa uma vez) e separado (pagamento por jogo, sem jogo só de um jogo,
  crédito com `jogoOrigem`, crédito nunca atravessa jogos do mesmo dia), troca de modo bloqueada com pagamento, crédito
  aplicado por chave.
- O repositório em memória ganha `fin_jogos` e o equivalente de `mover_checkin_de_jogo`/`mover_jogo2_para_jogo1`; o do
  Supabase, os métodos novos.
- **Suíte existente continua verde** (`npm run test:backend` e os testes de front). Os testes de paridade com o `.gs` passam a
  ignorar os campos novos do GET (`jogo`, `porJogo`, `jogos`, `jogoOrigem`, `checkinJogo2`), como já fazem com `removidos`.
- **Front** (`tests/dois-jogos.test.js`, extrai o bloco `<dois-jogos-puro>`): jogos do dia em ordem de horário, jogo órfão,
  dentro/reserva por jogo, confirmadosPelaChave no único (união sem duplicar) e no separado, texto do WhatsApp (1 e 2 jogos,
  único e separado), fechamento (caixa fecha: anterior + recebido − despesas = atual), saída do dia (uma quadra no único,
  uma por jogo no separado).
- **Simulação** (200 sequências aleatórias de confirmar/desconfirmar/mover/pagar/estornar/sem jogo/remover jogo nos dois
  modos): nunca há dois pagamentos válidos por data + chave + jogador; ninguém aparece duas vezes no mesmo jogo; mover nunca
  deixa a pessoa em dois jogos nem some com ela; o caixa é sempre a soma dos registros; remover o 2º jogo nunca perde nem
  duplica ninguém.
- **No navegador**, antes de publicar: o app real + backend real sobre o repositório em memória
  (`.superpowers/brainstorm/dois-jogos/app-hoje-dados-falsos.mjs`, adaptado) em localhost, passando pelos cenários do protótipo.

## Versão

Terça **15.0** (mudança grande). Meme continua na 14.8 até a autorização.
