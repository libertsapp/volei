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
| D3 | No financeiro **único**, quem joga os dois paga | **Duas vezes** (uma por jogo) |
| D4 | Mensagem do WhatsApp com 2 jogos | **Uma mensagem com as duas listas** |
| D5 | A rodada guarda de qual jogo veio? | **Depois, numa 2ª etapa** (fora deste trabalho) |

Pedido original: financeiro diferente para cada lista **só se for escolhido**, com a escolha **no próprio check-in**.

Consequência da D3: o **pagamento é sempre por jogo** (data + jogo + jogador), nos dois modos. "Único" e "separado" diferem só
na **configuração** (valor, PIX, quadra, brinde, ícone e "sem jogo"): uma para o dia inteiro, ou uma por jogo.

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
  (dinheiro ou crédito), a remoção é **bloqueada** até "Cancelar todos" ou marcar o jogo como sem jogo... e aí também bloqueia
  (há crédito do jogo): o caminho é cancelar os pagamentos. Remover o jogo 1 com o 2º existindo: o que sobra passa a ser o jogo 1
  (por dentro, a lista do 2º é movida para o 1º).
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

### Financeiro do dia: único (padrão) ou separado

- A escolha aparece **dentro do cartão "💰 Financeiro do dia"** do check-in, **só quando há 2 jogos**:
  - **Um financeiro para o dia** (padrão): um valor por pessoa, um PIX, **uma quadra** e um brinde para o dia. Cada jogo é
    cobrado (D3): quem joga os dois paga duas vezes o mesmo valor e aparece pago só no jogo que pagou.
  - **Separado por jogo**: cada jogo tem valor, PIX, quadra, brinde, ícone e "sem jogo" próprios. O cartão mostra os valores
    do jogo da aba ("Valores do jogo das 21:00"); o 2º jogo começa com os valores do 1º como sugestão (chip "pendente" até salvar).
- A escolha é gravada ao tocar em **Salvar** do cartão. **Trocar de modo é bloqueado se o dia já tem pagamento válido**
  ("Já há N pagamento(s) neste dia. Para trocar, use Cancelar todos antes"): evita valor cobrado de um jeito e previsto de outro.
- **Confirmar todos / Cancelar todos** valem sempre para o jogo da aba (nos dois modos, porque a cobrança é por jogo).
- O resumo visível a todos ("💰 R$ 15,00 por pessoa · PIX · barra Arrecadado X de Y") é **do jogo da aba**. A "Saída" mostrada é
  a do dia (único) ou a do jogo (separado).
- Lançamentos avulsos continuam sendo **do dia**.

### Dia sem jogo e crédito

- **Separado:** "🌧️ Jogo das 21:00 sem jogo" vale **só para aquele jogo**: a quadra/brinde dele deixam de contar e os
  pagamentos dele viram crédito (ou são devolvidos), como hoje. O outro jogo segue normal. "☀️ Reabrir jogo" desfaz, com as
  mesmas regras de hoje (só se nenhum crédito dele foi usado).
- **Único:** "🌧️ Dia sem jogo" vale para o **dia inteiro** (os dois jogos), como hoje. O modal avisa: se só um dos jogos pode
  não acontecer, use "Separado por jogo" antes de cobrar.
- O crédito guarda de qual jogo veio e continua sendo usado **só em datas seguintes** (nunca no outro jogo do mesmo dia).
- A aplicação automática de crédito passa a ser **por jogo** (cada jogo é uma cobrança): ao salvar o dia aplica nos dois jogos
  (o mais cedo primeiro); ao confirmar/desconfirmar, no jogo da mudança.

### Página Financeiro, fechamento e saldo previsto

- O **caixa continua um só** (soma de tudo, como hoje).
- O dia com 2 jogos ganha o selo "2 jogos" e o corpo em blocos: no separado, um bloco por jogo (saída, valor/PIX, pagamentos,
  quem falta pagar); no único, "Saídas do dia" (uma quadra) e os pagamentos com a etiqueta do jogo.
- O **fechamento do WhatsApp** sai num texto só: um bloco por jogo (lista de quem pagou, recebido; no separado, a quadra de cada
  jogo; jogo sem jogo = "pagamentos guardados como crédito") e o resumo do dia no fim (saldo anterior, recebido, despesas,
  saldo atual).
- **Saldo previsto** soma os pendentes dos dois jogos (cada um × o valor daquele jogo).
- Nos dias passados o nome do jogo é "1º jogo"/"2º jogo" (o horário só é conhecido enquanto aquela data está configurada).

### Mensagem do WhatsApp (D4)

Uma mensagem com as duas listas. O texto de abertura configurável troca `{horario}` por "19:00 e 21:00" e `{vagas}` por
"16 + 12". No financeiro único, valor e PIX aparecem uma vez no topo; no separado, embaixo do cabeçalho de cada jogo. Cada lista
vem com o cabeçalho "🏐 *JOGO DAS 19:00* (16 vagas)", os confirmados numerados com ✅/💰/🍫 e a "Espera" do próprio jogo.

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

Rodado pelo usuário no SQL Editor, uma vez por schema. Tudo aditivo e com padrão: o que existe vira "jogo 1".

```sql
-- check-in: de qual jogo do dia
alter table checkins add column if not exists jogo smallint not null default 1;
alter table checkins add constraint checkins_jogo_valido check (jogo in (1, 2));

-- pagamento: de qual jogo (D3: a cobrança é sempre por jogo)
alter table fin_pagamentos add column if not exists jogo smallint not null default 1;
alter table fin_pagamentos add constraint fin_pagamentos_jogo_valido check (jogo in (1, 2));
-- "um pagamento válido por jogador" passa de (data) para (data, jogo); troca numa transação só
begin;
drop index if exists fin_pagamentos_valido_uniq;
create unique index fin_pagamentos_valido_uniq on fin_pagamentos (data, jogo, jogador_id) where not estornado;
commit;

-- o dia: financeiro separado por jogo?
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

-- crédito: de qual jogo veio
alter table fin_creditos add column if not exists jogo_origem smallint not null default 1;

-- remover o 2º jogo movendo a lista para o 1º: numa transação só, no fim da fila, sem duplicar
create or replace function mover_jogo2_para_jogo1(p_data date) returns int ...
```

- As constraints `check` usam `if not exists` via bloco `do $$` (o arquivo pode rodar mais de uma vez, como os anteriores).
- `mover_jogo2_para_jogo1`: apaga do jogo 2 quem já está no jogo 1; o resto ganha `jogo = 1` e `ordem = nextval('seq_ordem_checkins')`
  na ordem em que estava; devolve quantos moveu. `revoke execute ... from public, anon, authenticated` + `grant` para service_role.
- Por que `fin_jogos` em vez de mudar a chave de `fin_dias` para (data, jogo): `fin_pagamentos.data` é chave estrangeira de
  `fin_dias(data)`; mudar a chave primária quebraria essa ligação e exigiria migrar todas as linhas. Assim, `fin_dias` continua
  sendo "o dia" (e, no separado, o 1º jogo), e nada que já existe muda.
- Meme: o mesmo conteúdo com `set search_path = meme` em `sql/meme/ajuste-9-dois-jogos-meme.sql`, e o ajuste 9 entra na lista do
  `scripts/gerar-sql-grupo.js`.

### Configuração do 2º jogo (tabela `config`, chaves novas)

`checkinJogo2Data`, `checkinJogo2Horario`, `checkinJogo2Vagas`, `checkinJogo2Travado`. O 2º jogo **existe** quando
`checkinJogo2Data` é igual a `checkinDataAberta`. O 1º jogo continua nas chaves de hoje.

## Backend (`backend/`, o mesmo código para as duas funções)

### Leitura (GET) — só campos novos, nada removido

- `checkins[].jogo` (número, 1 se vazio).
- `settings.checkinJogo2`: `{ data, horario, vagas, travado }` ou `null`.
- `financeiro.dias[].porJogo`; `financeiro.jogos[]` (as linhas de `fin_jogos`, mesmos nomes dos dias + `jogo`);
  `financeiro.pagamentos[].jogo`; `financeiro.creditos[].jogoOrigem`.

### Check-in

- `addCheckin` aceita `checkin.jogo` (ausente = 1; diferente de 1 ou 2 = erro). Recusa:
  - jogo 2 quando a data não tem 2º jogo configurado ("Esse jogo não existe mais. Recarregue a página.");
  - a mesma pessoa duas vezes no **mesmo** jogo ("Essa pessoa já está na lista desse jogo.").
- Ganchos do financeiro passam a receber o jogo: `aposAdicionarCheckin(data, jogo)`, `aposRemoverCheckin(data, jogo, jogadorId)`.

### Ações novas (organizador/admin; entram em `PERMISSOES` do backend e `PERMISSOES_UI` do app)

- `salvarJogo2 { jogo2: { data, horario, vagas, travado } }`: cria/edita o 2º jogo. Valida horário `HH:MM`, diferente do 1º
  jogo na mesma data, e vagas > 0. **Só ela mexe nas chaves `checkinJogo2*`**: `saveSettings`/`saveCheckinSettings` não as tocam,
  então um app antigo em cache (que reenvia as configurações inteiras) não consegue apagar nem desfazer o 2º jogo.
- `removerJogo2 { data, destino: 'mover' | 'desconfirmar' }`, sob a trava `gravacao`: recusa se o jogo 2 tem pagamento válido;
  `mover` chama `mover_jogo2_para_jogo1`; `desconfirmar` apaga os check-ins do jogo 2; no modo separado apaga a linha de
  `fin_jogos` e volta `por_jogo` para false; limpa as chaves `checkinJogo2*`; aplica crédito no jogo 1 (quem foi movido pode ter).
- Remover o **jogo 1** com o 2º existindo: o app faz "trocar os papéis" com a mesma ação (`destino` + `manter: 2`), o servidor
  move a lista do 2º para o 1º, copia horário/vagas/trava do 2º para as chaves do 1º e, no separado, copia `fin_jogos` para
  `fin_dias`. Recusa se o jogo removido tem pagamento válido.

### Financeiro — todas as ações recebem `jogo` (ausente = 1)

- **Configuração do jogo:** `cfgDoJogo(t, data, jogo)` = `fin_dias` da data se `por_jogo` é false ou se `jogo = 1`; senão a linha
  de `fin_jogos`. "Sem jogo" de um jogo = status da configuração dele.
- `salvarFinDia({ data, jogo, porJogo, ...valores })`: jogo 1 grava `fin_dias` (com `por_jogo` quando enviado); jogo 2 exige o dia
  já salvo e `por_jogo = true` e grava `fin_jogos`. Mudar `por_jogo` com pagamento válido na data = erro. Aplica crédito nos
  jogos do dia que estão normais.
- `marcarPagamento(data, jogo, ...)`: a pessoa precisa estar no check-in **daquele jogo**; valor = o da configuração do jogo;
  índice único por (data, jogo, jogador).
- `marcarTodosPagamentos(data, jogo)` e `estornarTodosPagamentos(data, jogo)`: só os do jogo.
- `estornarPagamento(id)`: "está na lista?" é conferido no jogo do pagamento.
- `marcarDiaSemJogo(data, jogo, destino)` / `reabrirDia(data, jogo)`: com `por_jogo` false valem para o dia todo (todos os
  pagamentos da data, status em `fin_dias`); com `por_jogo` true, só para o jogo (status em `fin_dias` se jogo 1, em `fin_jogos`
  se jogo 2; créditos filtrados por `data_origem` + `jogo_origem`).
- `aplicarCreditos(data, jogo)`: por jogo (a configuração e o "dentro das vagas" daquele jogo). Vagas do jogo 2 =
  `checkinJogo2Vagas` quando a data bate. `aplicarCreditosDoDia(data)` e `aplicarCreditosFuturos` passam pelos dois jogos.
- `fin_log`: os detalhes ganham `jogo` quando ele é 2.

## App (`volei-dashboard.html`, só o Terça)

- Estado novo `JOGO_ATIVO` (1 ou 2) e `jogosDoDiaAberto()`: a lista de jogos da data aberta em ordem de horário. Inclui um
  jogo 2 "sem configuração" se houver check-ins com `jogo = 2` nessa data e o 2º jogo não estiver configurado (ninguém some).
- As funções do check-in que hoje leem só `SETTINGS.checkinDataAberta` passam a receber **data + jogo** (lista, dentro/reserva,
  contador, ordenados, convidado, colar lista, desconfirmar todos, sorteio, compartilhar, ajustar estrelas,
  `comEstrelaDoCheckin` com o jogo importado para o sorteio).
- Bloco puro novo `// <dois-jogos-puro>` (testável no Node): `jogosDoDia`, `dentroEReservaDoJogo`, `cfgFinDoJogo`,
  `textoWhatsAppDoDia`, `fechamentoDoDia`, `saidaDoDia`. O bloco `<financeiro-puro>` ganha o parâmetro `jogo` onde hoje há só a data
  (sem mudar o resultado quando o dia tem 1 jogo).
- CSS novo com seletores de classe (`.jogos-abas`, `.jogo-aba`, `.jogo-cfg`, `.tag-outro`, `.dica-vaga`); nada de `<section>` nem
  seletor de tag pura (erros já vividos).
- Info do app: novidade da 15.0 explicando o 2º jogo e o financeiro único/separado.

## Compatibilidade e ordem de publicação

1. **SQL** do ajuste 9 nos dois schemas (`public` e `meme`) — o usuário roda no SQL Editor.
2. **Backend** nas duas funções (`npm run preparar-edge`, `preparar-edge -- meme-api` e os dois deploys) — o usuário roda.
   O backend novo funciona com o app antigo (tudo sem `jogo` = 1; campos novos no GET são ignorados pelo app antigo).
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
| Remover jogo com pagamento válido | Bloqueado com aviso |
| Jogo 2 sem jogo (separado) e jogo 1 normal | Só a quadra do jogo 2 deixa de contar; crédito com `jogo_origem = 2` |
| Crédito do jogo 2 de hoje | Não paga o jogo 1 de hoje; só datas seguintes |
| Reabrir a mesma data depois de fechar | Volta com os 2 jogos e as duas listas |
| Abrir data nova | 1 jogo (padrão) |
| Check-ins de jogo 2 sem configuração | Aba "2º jogo" aparece mesmo assim, com as vagas do 1º |
| Organizador muda o horário do 1º para o mesmo do 2º | Recusado no app; o servidor também recusa no `saveCheckinSettings` quando a data do 2º jogo é a aberta |

## Testes

- **Backend** (repositório em memória, `tests/backend/dois-jogos.test.mjs`): check-in por jogo, repetido no mesmo jogo recusado,
  mesma pessoa nos dois jogos aceita, jogo 2 inexistente recusado, `saveSettings` do app antigo não toca o 2º jogo, `salvarJogo2`
  (validações), `removerJogo2` (mover no fim da fila sem duplicar; desconfirmar; bloqueio com pagamento; trocar os papéis),
  financeiro único (config compartilhada, uma quadra, cobrança por jogo) e separado (config própria, sem jogo só de um jogo,
  crédito com `jogo_origem`, crédito nunca no mesmo dia), troca de modo bloqueada com pagamento, crédito aplicado por jogo.
- O repositório em memória ganha `fin_jogos` e o equivalente de `mover_jogo2_para_jogo1`; o do Supabase, os métodos novos.
- **Suíte existente continua verde** (`npm run test:backend` e os testes de front). Os testes de paridade com o `.gs` passam a
  ignorar os campos novos do GET (`jogo`, `porJogo`, `jogos`, `jogoOrigem`, `checkinJogo2`), como já fazem com `removidos`.
- **Front** (`tests/dois-jogos.test.js`, extrai o bloco `<dois-jogos-puro>`): jogos do dia em ordem de horário, jogo órfão,
  dentro/reserva por jogo, texto do WhatsApp (1 e 2 jogos, único e separado), fechamento (caixa fecha: anterior + recebido −
  despesas = atual), saída do dia (uma quadra no único, uma por jogo no separado).
- **Simulação** (200 sequências aleatórias de confirmar/desconfirmar/pagar/estornar/sem jogo/remover jogo nos dois modos):
  nunca há dois pagamentos válidos por data + jogo + jogador; ninguém aparece duas vezes no mesmo jogo; o caixa é sempre a soma
  dos registros; remover o 2º jogo nunca perde nem duplica ninguém.
- **No navegador**, antes de publicar: o app real + backend real sobre o repositório em memória
  (`.superpowers/brainstorm/dois-jogos/app-hoje-dados-falsos.mjs`, adaptado) em localhost, passando pelos cenários do protótipo.

## Versão

Terça **15.0** (mudança grande). Meme continua na 14.8 até a autorização.
