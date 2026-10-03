# Dois jogos no mesmo dia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir dois jogos no mesmo dia no Vôlei de Terça (abas no check-in, financeiro único ou separado, botão ⇄ para trocar um confirmado de fila), mantendo o padrão de 1 jogo idêntico ao de hoje.

**Architecture:** Banco aditivo (coluna `jogo` em `checkins`/`fin_pagamentos`/`fin_creditos`, tabela nova `fin_jogos`, flag `fin_dias.por_jogo`) → backend com o conceito de "chave de cobrança" (`null` = o dia, `1`/`2` = um jogo) que envolve todas as ações do financeiro e do check-in → front com um bloco puro novo `<dois-jogos-puro>` que monta "visões" do financeiro por chave e reaproveita o `<financeiro-puro>` existente **sem alterá-lo** → UI do check-in com abas, cartão financeiro com único/separado, e botão ⇄.

**Tech Stack:** Node.js (backend, ESM), Supabase/Postgres (SQL), HTML+CSS+JS vanilla num arquivo só (`volei-dashboard.html`), testes com `node:assert/strict` (sem framework).

**Spec:** `docs/superpowers/specs/2026-10-03-dois-jogos-no-mesmo-dia-design.md`

## Global Constraints

- Só o **Terça** (`volei-dashboard.html`, `backend/`, schema `public`) muda de verdade nesta rodada; o schema `meme` recebe o mesmo SQL (para a função `meme-api` não quebrar), mas **o app do Meme não é tocado**.
- Compatibilidade com o app antigo em cache: nenhum campo/ação novo pode ser obrigatório para o GET ou para ações já existentes continuarem funcionando (`jogo` ausente = 1; `chave`/`jogo` ausente nas ações do financeiro = `null`/dia inteiro).
- Toda gravação do financeiro e do check-in continua sob a trava `gravacao` (`backend/trava.js`), exatamente como hoje.
- SQL sempre aditivo e idempotente (`if not exists`, `create or replace`), seguindo o estilo dos ajustes 1–8 (comentário de cabeçalho, bloco `do $$` quando precisa, `revoke`/`grant` explícitos para funções novas).
- `node --check` não aceita `.gs`; não existe `.gs` neste repositório (gitignorado) — não mexer nisso.
- Testes sem framework: `node:assert/strict` + o executor `ta`/`t`/`fim` de `tests/backend/executor.mjs`, ou o padrão de `tests/*.test.js` (extrai bloco do HTML, roda com `new Function`).
- Versão do Terça sobe para **15.0** no rodapé do HTML só quando a Task do front terminar.

## Review Focus

- **Único vs. separado com a mesma pessoa nos dois jogos**: no modo único, quem está confirmado nos dois jogos não pode contar duas vezes em "pendentes"/"previsto" nem gerar dois pagamentos — é a união, sem duplicar.
- **Trocar o modo (único↔separado) com pagamento já feito**: tem que ser recusado com uma mensagem clara, nos dois sentidos, e não pode deixar o dia num estado em que um pagamento "do dia" (chave `null`) convive com pagamentos "por jogo" sem ninguém saber reconciliar.
- **Remover um jogo com pagamento válido amarrado só a ele**: tem que bloquear (não pode apagar dinheiro registrado silenciosamente); e remover o jogo 1 (não o 2) precisa inverter os papéis sem perder configuração nem histórico.
- **App antigo em cache gravando configurações**: `saveSettings`/`saveCheckinSettings` do app de hoje reenvia o objeto de configurações inteiro — isso não pode apagar `checkinJogo2*` sem querer.
- **Crédito atravessando jogos do mesmo dia**: um crédito nascido hoje (de um pagamento de hoje que virou crédito) nunca pode pagar o outro jogo de hoje, só datas futuras — em nenhum dos dois modos.

---

## Visão geral dos arquivos

| Arquivo | O que muda |
|---|---|
| `sql/schema-terca-supabase-ajuste-9.sql` (novo) | Colunas `jogo`/`por_jogo`/`jogo_origem`, tabela `fin_jogos`, funções `mover_checkin_de_jogo`/`mover_jogo2_para_jogo1` |
| `sql/meme/ajuste-9-dois-jogos-meme.sql` (novo) | O mesmo, schema `meme` (arquivo avulso, como o ajuste 8) |
| `scripts/gerar-sql-grupo.js` | `ARQUIVOS_DO_TERCA` ganha o ajuste 9 |
| `sql/meme/schema-meme-supabase.sql` | Regerado (`npm run gerar-sql-meme`) |
| `backend/repo-memoria.js` | Tabela `fin_jogos`, `gravarFinJogo`, `definirStatusFinJogo`, `moverCheckinDeJogo`, `moverJogo2ParaJogo1` |
| `backend/repo-supabase.js` | Os mesmos métodos, via Supabase/RPC |
| `backend/mapeadores.js` | `checkins[].jogo`, `settings.checkinJogo2`, `financeiro.dias[].porJogo`, `financeiro.jogos`, `financeiro.pagamentos[].jogo`, `financeiro.creditos[].jogoOrigem` |
| `backend/checkins.js` | `addCheckin` valida `jogo`; ação nova `moverCheckin` |
| `backend/financeiro.js` | Conceito de "chave de cobrança" em toda ação; `aplicarCreditosDoDia`/hooks passam a cobrir as 1 ou 2 chaves do dia |
| `backend/jogos2.js` (novo) | `salvarJogo2`, `removerJogo2` |
| `backend/handler.js` | Novas ações ligadas; normalização de `chave`/`jogo` antes de chamar o financeiro |
| `backend/permissoes.js` | `moverCheckin`, `salvarJogo2`, `removerJogo2` → `['organizador','admin']` |
| `volei-dashboard.html` | Bloco `<dois-jogos-puro>` novo; `<financeiro-puro>` **não muda**; UI do check-in (abas, 2º jogo, financeiro único/separado, botão ⇄), página Financeiro, mensagem WhatsApp, CSS, versão |
| `tests/backend/dois-jogos.test.mjs`, `tests/backend/dois-jogos-handler.test.mjs`, `tests/backend/dois-jogos-simulacao.test.mjs` (novos) | Suíte do backend |
| `tests/dois-jogos.test.js` (novo) | Suíte do front (bloco puro) |
| `tests/backend/paridade-get.test.mjs`, `paridade-checkins.test.mjs`, `paridade-financeiro.test.mjs`, `paridade-financeiro-credito.test.mjs` | Ignoram os campos novos ao comparar com o `.gs` |
| `tests/backend/gerar-sql-grupo.test.mjs` | Contagem de funções com `search_path` fixo sobe de 5 para 7 |

## Decisão técnica (refinamento do spec, mesmo comportamento)

O spec descreve o `<financeiro-puro>` "ganhando o parâmetro `chave`". Na implementação, em vez de mudar a assinatura de **cada** função pura existente (grande superfície, grande risco para os ~45 testes de `tests/financeiro-puro.test.js` e as dezenas de call sites no HTML), o bloco **`<financeiro-puro>` fica 100% intocado**. Um bloco novo `<dois-jogos-puro>` constrói, para uma `(data, chave)`, uma **"visão"** no mesmo formato que `<financeiro-puro>` já entende — `{ dias: [cfgDaChave], pagamentos: pagamentosFiltradosPelaChave, lancamentos: [], creditos: creditosFiltradosPelaChave }` — e todo código (check-in, página Financeiro) passa a chamar `finPagamentoDe`, `finPendentes`, `finMarcas` etc. **sem mudar nada nelas**, só passando essa visão no lugar de `FINANCEIRO`. Resultado observável idêntico ao spec; superfície de mudança muito menor. O mesmo vale no backend: `financeiro.js` ganha os mesmos conceitos (`confirmadosPelaChave`, `linhaConfigDaChave`, `pagamentosDaChave`), mas os ganchos `aposAdicionarCheckin(deps, data)` / `aposRemoverCheckin(deps, data, jogadorId)` **mantêm a assinatura de hoje** (sem parâmetro `jogo`): por dentro, eles iteram as chaves do dia e conferem se a pessoa ainda está confirmada em cada uma — o que já resolve sozinho o caso "único e a pessoa continua no outro jogo" sem precisar saber de qual jogo ela saiu.

---

## PARTE A — Banco de dados

### Task 1: SQL ajuste 9 (Terça)

**Files:**
- Create: `sql/schema-terca-supabase-ajuste-9.sql`

**Interfaces:**
- Produces: colunas `checkins.jogo` (smallint, default 1), `fin_pagamentos.jogo` (smallint, nulo), `fin_dias.por_jogo` (boolean, default false), `fin_creditos.jogo_origem` (smallint, nulo); tabela `fin_jogos(data, jogo, valor_pessoa, pix, valor_quadra, tem_brinde, valor_brinde, icone, status, atualizado_por, atualizado_em)`; funções `mover_checkin_de_jogo(p_id text, p_para_jogo smallint) returns boolean` e `mover_jogo2_para_jogo1(p_data date) returns int`. Essas são as interfaces que `backend/repo-supabase.js` (Task 4) consome.

- [ ] **Step 1: Escrever o arquivo SQL completo**

```sql
-- Ajuste 9 (dois jogos no mesmo dia): colunas de "jogo" em checkins/fin_pagamentos/fin_creditos, a tabela fin_jogos
-- (configuração do 2º jogo quando o financeiro é separado) e duas funções de movimentação de fila.
-- Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (o código não roda SQL de estrutura).
-- Spec: docs/superpowers/specs/2026-10-03-dois-jogos-no-mesmo-dia-design.md

-- 1) check-in: de qual jogo (fila) do dia. Sempre um valor: confirmar presença é sempre numa fila específica.
alter table checkins add column if not exists jogo smallint not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'checkins_jogo_valido') then
    alter table checkins add constraint checkins_jogo_valido check (jogo in (1, 2));
  end if;
end $$;

-- 2) pagamento: NULL = vale para o DIA inteiro (modo único); 1 ou 2 = só aquele jogo (modo separado).
-- Linhas que já existem não precisam de backfill: um pagamento antigo, de quando só havia 1 jogo, sempre valeu
-- "pro dia" (não havia distinção), então NULL já é o valor certo pra elas.
alter table fin_pagamentos add column if not exists jogo smallint null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_pagamentos_jogo_valido') then
    alter table fin_pagamentos add constraint fin_pagamentos_jogo_valido check (jogo in (1, 2));
  end if;
end $$;
-- "um pagamento válido por jogador, por chave de cobrança" — coalesce(jogo, 0) trata NULL como uma chave só
-- (um UNIQUE INDEX comum NÃO barraria duas linhas com jogo IS NULL, porque o Postgres trata NULL <> NULL)
drop index if exists fin_pagamentos_valido_uniq;
create unique index fin_pagamentos_valido_uniq on fin_pagamentos (data, coalesce(jogo, 0), jogador_id) where not estornado;

-- 3) o dia: financeiro separado por jogo? (false = único, o padrão)
alter table fin_dias add column if not exists por_jogo boolean not null default false;

-- 4) configuração própria do 2º jogo (só existe no modo separado; o 1º jogo continua em fin_dias)
create table if not exists fin_jogos (
  data date not null references fin_dias(data),
  jogo smallint not null,
  valor_pessoa numeric(10,2), pix text, valor_quadra numeric(10,2), tem_brinde boolean, valor_brinde numeric(10,2),
  icone text, status text not null default 'normal',
  atualizado_por text, atualizado_em timestamptz,
  primary key (data, jogo)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_jogos_jogo_valido') then
    alter table fin_jogos add constraint fin_jogos_jogo_valido check (jogo = 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_jogos_status_valido') then
    alter table fin_jogos add constraint fin_jogos_status_valido check (status in ('normal', 'semjogo'));
  end if;
end $$;
alter table fin_jogos enable row level security; -- sem políticas: só a service_role (a função) acessa

-- 5) crédito: de onde veio (mesma regra do pagamento de origem: NULL = do dia, 1/2 = de um jogo no modo separado)
alter table fin_creditos add column if not exists jogo_origem smallint null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_creditos_jogo_origem_valido') then
    alter table fin_creditos add constraint fin_creditos_jogo_origem_valido check (jogo_origem in (1, 2));
  end if;
end $$;

-- 6) Mover um check-in para o fim da fila do OUTRO jogo (botão ⇄). Se a pessoa já estiver no destino (duas linhas
-- pro mesmo jogador/dia/jogo não deveriam existir, mas por segurança), não faz nada e devolve false.
create or replace function mover_checkin_de_jogo(p_id text, p_para_jogo smallint) returns boolean
language plpgsql set search_path = public as $$
declare
  v_jogador_id text;
  v_data date;
  v_proxima_ordem bigint;
begin
  select jogador_id, data into v_jogador_id, v_data from checkins where id = p_id;
  if not found then
    return false;
  end if;
  if v_jogador_id is not null and exists (
    select 1 from checkins where data = v_data and jogo = p_para_jogo and jogador_id = v_jogador_id
  ) then
    return false; -- já está no destino: nada para mover
  end if;
  select coalesce(max(ordem), 0) + 1 into v_proxima_ordem from checkins where data = v_data and jogo = p_para_jogo;
  update checkins set jogo = p_para_jogo, ordem = v_proxima_ordem where id = p_id;
  return true;
end;
$$;

-- 7) Remover o 2º jogo movendo quem está nele para o 1º, no fim da fila, sem duplicar quem já está lá.
-- Devolve quantas linhas foram realmente movidas (não conta quem já estava no jogo 1 e foi descartado).
create or replace function mover_jogo2_para_jogo1(p_data date) returns int
language plpgsql set search_path = public as $$
declare
  v_movidos int := 0;
  v_proxima_ordem bigint;
  v_linha record;
begin
  delete from checkins c2
  where c2.data = p_data and c2.jogo = 2 and c2.jogador_id is not null
    and exists (select 1 from checkins c1 where c1.data = p_data and c1.jogo = 1 and c1.jogador_id = c2.jogador_id);

  select coalesce(max(ordem), 0) into v_proxima_ordem from checkins where data = p_data and jogo = 1;
  for v_linha in select id from checkins where data = p_data and jogo = 2 order by ordem loop
    v_proxima_ordem := v_proxima_ordem + 1;
    update checkins set jogo = 1, ordem = v_proxima_ordem where id = v_linha.id;
    v_movidos := v_movidos + 1;
  end loop;
  return v_movidos;
end;
$$;

-- só o servidor (service_role) chama; o navegador nunca fala com o banco direto
revoke execute on function mover_checkin_de_jogo(text, smallint) from public, anon, authenticated;
revoke execute on function mover_jogo2_para_jogo1(date) from public, anon, authenticated;
grant execute on function mover_checkin_de_jogo(text, smallint) to service_role;
grant execute on function mover_jogo2_para_jogo1(date) to service_role;
```

- [ ] **Step 2: Conferir que o arquivo não tem erro óbvio de sintaxe**

Run: `node -e "require('fs').readFileSync('sql/schema-terca-supabase-ajuste-9.sql','utf8')"` (só confirma que o arquivo existe e é texto; SQL não roda no Node). Ler o arquivo de novo e comparar com os ajustes 3/5 (mesmo estilo de `do $$ ... end $$`, `language plpgsql set search_path = public as $$`, `revoke`/`grant`).

- [ ] **Step 3: Commit**

```bash
git add sql/schema-terca-supabase-ajuste-9.sql
git commit -m "sql: ajuste 9 — colunas de jogo, tabela fin_jogos e funções de mover check-in"
```

---

### Task 2: Gerador do SQL do Meme + arquivo avulso do ajuste 9

**Files:**
- Modify: `scripts/gerar-sql-grupo.js`
- Modify: `tests/backend/gerar-sql-grupo.test.mjs`
- Create: `sql/meme/ajuste-9-dois-jogos-meme.sql`
- Modify (gerado): `sql/meme/schema-meme-supabase.sql`

**Interfaces:**
- Consumes: `sql/schema-terca-supabase-ajuste-9.sql` (Task 1)
- Produces: nada que outra task consuma (ponta solta da parte SQL); só precisa continuar passando no `npm run test:backend`.

- [ ] **Step 1: Atualizar a lista de arquivos do gerador**

Em `scripts/gerar-sql-grupo.js`, adicionar o ajuste 9 ao fim de `ARQUIVOS_DO_TERCA`:

```js
const ARQUIVOS_DO_TERCA = [
  'schema-terca-supabase.sql',
  'schema-terca-supabase-ajuste-1.sql',
  'schema-terca-supabase-ajuste-2.sql',
  'schema-terca-supabase-ajuste-3.sql',
  'schema-terca-supabase-ajuste-4.sql',
  'schema-terca-supabase-ajuste-5.sql',
  'schema-terca-supabase-ajuste-6.sql',
  'schema-terca-supabase-ajuste-7.sql',
  'schema-terca-supabase-ajuste-8.sql',
  'schema-terca-supabase-ajuste-9.sql'
];
```

- [ ] **Step 2: Atualizar a contagem de funções com `search_path` fixo no teste**

Em `tests/backend/gerar-sql-grupo.test.mjs`, trocar (as duas funções novas do ajuste 9 usam `language plpgsql set search_path = public as $$`, igual a `pegar_trava`/`soltar_trava`/`registrar_tentativa`/`limpar_falhas`/`incrementar_acesso`, elevando a contagem de 5 para 7):

```js
  // as 7 funções que fixavam public agora fixam meme
  assert.equal((s.match(/set search_path = meme as/g) || []).length, 7);
```

- [ ] **Step 3: Rodar o teste do gerador e ver falhar (arquivo gerado ainda desatualizado)**

Run: `node tests/backend/gerar-sql-grupo.test.mjs`
Expected: FALHA na checagem "é determinístico e o arquivo gerado no repositório está em dia" (o `sql/meme/schema-meme-supabase.sql` em disco ainda não tem o ajuste 9).

- [ ] **Step 4: Regerar o SQL do Meme**

Run: `npm run gerar-sql-meme`

- [ ] **Step 5: Rodar o teste do gerador de novo e ver passar**

Run: `node tests/backend/gerar-sql-grupo.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 6: Criar o arquivo avulso do ajuste 9 para o Meme** (mesmo padrão do `sql/meme/ajuste-8-sessoes-meme.sql`: deixa quem já tem o Meme provisionado colar só a parte nova, sem repetir o schema inteiro)

```sql
-- GERADO a partir de sql/schema-terca-supabase-ajuste-9.sql (schema meme). NÃO edite à mão: se o ajuste 9 do
-- Terça mudar, regenere (ver scripts/gerar-sql-grupo.js) e cole este trecho nas instalações do Meme já existentes.
-- QUEM RODA: o usuário, no SQL Editor do Supabase, no projeto que já tem o schema "meme".
set search_path = meme;

alter table checkins add column if not exists jogo smallint not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'checkins_jogo_valido') then
    alter table checkins add constraint checkins_jogo_valido check (jogo in (1, 2));
  end if;
end $$;

alter table fin_pagamentos add column if not exists jogo smallint null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_pagamentos_jogo_valido') then
    alter table fin_pagamentos add constraint fin_pagamentos_jogo_valido check (jogo in (1, 2));
  end if;
end $$;
drop index if exists fin_pagamentos_valido_uniq;
create unique index fin_pagamentos_valido_uniq on fin_pagamentos (data, coalesce(jogo, 0), jogador_id) where not estornado;

alter table fin_dias add column if not exists por_jogo boolean not null default false;

create table if not exists fin_jogos (
  data date not null references fin_dias(data),
  jogo smallint not null,
  valor_pessoa numeric(10,2), pix text, valor_quadra numeric(10,2), tem_brinde boolean, valor_brinde numeric(10,2),
  icone text, status text not null default 'normal',
  atualizado_por text, atualizado_em timestamptz,
  primary key (data, jogo)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_jogos_jogo_valido') then
    alter table fin_jogos add constraint fin_jogos_jogo_valido check (jogo = 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_jogos_status_valido') then
    alter table fin_jogos add constraint fin_jogos_status_valido check (status in ('normal', 'semjogo'));
  end if;
end $$;
alter table fin_jogos enable row level security;

alter table fin_creditos add column if not exists jogo_origem smallint null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_creditos_jogo_origem_valido') then
    alter table fin_creditos add constraint fin_creditos_jogo_origem_valido check (jogo_origem in (1, 2));
  end if;
end $$;

create or replace function mover_checkin_de_jogo(p_id text, p_para_jogo smallint) returns boolean
language plpgsql set search_path = meme as $$
declare
  v_jogador_id text;
  v_data date;
  v_proxima_ordem bigint;
begin
  select jogador_id, data into v_jogador_id, v_data from checkins where id = p_id;
  if not found then
    return false;
  end if;
  if v_jogador_id is not null and exists (
    select 1 from checkins where data = v_data and jogo = p_para_jogo and jogador_id = v_jogador_id
  ) then
    return false;
  end if;
  select coalesce(max(ordem), 0) + 1 into v_proxima_ordem from checkins where data = v_data and jogo = p_para_jogo;
  update checkins set jogo = p_para_jogo, ordem = v_proxima_ordem where id = p_id;
  return true;
end;
$$;

create or replace function mover_jogo2_para_jogo1(p_data date) returns int
language plpgsql set search_path = meme as $$
declare
  v_movidos int := 0;
  v_proxima_ordem bigint;
  v_linha record;
begin
  delete from checkins c2
  where c2.data = p_data and c2.jogo = 2 and c2.jogador_id is not null
    and exists (select 1 from checkins c1 where c1.data = p_data and c1.jogo = 1 and c1.jogador_id = c2.jogador_id);

  select coalesce(max(ordem), 0) into v_proxima_ordem from checkins where data = p_data and jogo = 1;
  for v_linha in select id from checkins where data = p_data and jogo = 2 order by ordem loop
    v_proxima_ordem := v_proxima_ordem + 1;
    update checkins set jogo = 1, ordem = v_proxima_ordem where id = v_linha.id;
    v_movidos := v_movidos + 1;
  end loop;
  return v_movidos;
end;
$$;

alter function mover_checkin_de_jogo(text, smallint) set search_path = meme;
alter function mover_jogo2_para_jogo1(date) set search_path = meme;
grant execute on function mover_checkin_de_jogo(text, smallint) to service_role;
grant execute on function mover_jogo2_para_jogo1(date) to service_role;
revoke execute on function mover_checkin_de_jogo(text, smallint) from public, anon, authenticated;
revoke execute on function mover_jogo2_para_jogo1(date) from public, anon, authenticated;
```

- [ ] **Step 7: Rodar a suíte inteira do backend**

Run: `npm run test:backend`
Expected: todos os arquivos `ok` (o ajuste 9 ainda não é usado por nenhum código — só o SQL e o gerador mudaram).

- [ ] **Step 8: Commit**

```bash
git add scripts/gerar-sql-grupo.js tests/backend/gerar-sql-grupo.test.mjs sql/meme/schema-meme-supabase.sql sql/meme/ajuste-9-dois-jogos-meme.sql
git commit -m "sql: ajuste 9 também no gerador do Meme (schema-meme-supabase.sql regerado) + arquivo avulso"
```

---

## PARTE B — Repositório

### Task 3: `repo-memoria.js` — tabela `fin_jogos` e as duas movimentações

**Files:**
- Modify: `backend/repo-memoria.js`
- Test: `tests/backend/repo-dois-jogos.test.mjs` (novo)

**Interfaces:**
- Produces: `repo.gravarFinJogo(linha)`, `repo.definirStatusFinJogo(data, jogo, status)` → boolean, `repo.moverCheckinDeJogo(id, paraJogo)` → boolean, `repo.moverJogo2ParaJogo1(data)` → number. `repo.lerTudo()` passa a incluir `fin_jogos` (basta adicionar o nome a `TABELAS`, igual às outras tabelas).
- Consumes: nada de outra task.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// tests/backend/repo-dois-jogos.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';

const base = () => ({
  checkins: [
    { id: 'c1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 4, sexo: 'F', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
    { id: 'c2', data: '2026-10-06', jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 2, ordem: 1 },
    { id: 'c3', data: '2026-10-06', jogador_id: 'p3', jogador_nome: 'Caio', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 1, ordem: 2 }
  ],
  fin_dias: [{ data: '2026-10-06', valor_pessoa: 15, pix: '', valor_quadra: 300, tem_brinde: false, valor_brinde: 0, status: 'normal', por_jogo: true, ordem: 1 }]
});

await ta('gravarFinJogo: insere e, numa segunda chamada, só atualiza os campos enviados (upsert por data+jogo)', async () => {
  const repo = criarRepoMemoria(base());
  await repo.gravarFinJogo({ data: '2026-10-06', jogo: 2, valor_pessoa: 15, pix: 'k', valor_quadra: 180, tem_brinde: false, valor_brinde: 0, icone: '✅', atualizado_por: 'Org', atualizado_em: 'x' });
  let t = await repo.lerTudo();
  assert.equal(t.fin_jogos.length, 1);
  assert.deepEqual({ v: t.fin_jogos[0].valor_pessoa, s: t.fin_jogos[0].status }, { v: 15, s: 'normal' });
  await repo.gravarFinJogo({ data: '2026-10-06', jogo: 2, valor_pessoa: 20 });
  t = await repo.lerTudo();
  assert.equal(t.fin_jogos.length, 1);
  assert.deepEqual({ v: t.fin_jogos[0].valor_pessoa, pix: t.fin_jogos[0].pix }, { v: 20, pix: 'k' }); // só o campo enviado mudou
});

await ta('definirStatusFinJogo: muda o status de uma linha existente; false se não existe', async () => {
  const repo = criarRepoMemoria(base());
  assert.equal(await repo.definirStatusFinJogo('2026-10-06', 2, 'semjogo'), false); // ainda não existe
  await repo.gravarFinJogo({ data: '2026-10-06', jogo: 2, status: 'normal' });
  assert.equal(await repo.definirStatusFinJogo('2026-10-06', 2, 'semjogo'), true);
  const t = await repo.lerTudo();
  assert.equal(t.fin_jogos[0].status, 'semjogo');
});

await ta('moverCheckinDeJogo: muda o jogo e vai pro fim da fila do destino; false se não existe ou já está lá', async () => {
  const repo = criarRepoMemoria(base());
  assert.equal(await repo.moverCheckinDeJogo('nao-existe', 2), false);
  assert.equal(await repo.moverCheckinDeJogo('c1', 2), true);
  let t = await repo.lerTudo();
  const movido = t.checkins.find((c) => c.id === 'c1');
  assert.equal(movido.jogo, 2);
  assert.equal(movido.ordem, 2); // fim da fila do jogo 2 (que já tinha ordem 1)
  assert.equal(await repo.moverCheckinDeJogo('c1', 2), false); // já está lá
});

await ta('moverJogo2ParaJogo1: descarta quem já está no 1, move o resto pro fim, na ordem; devolve quantos moveu', async () => {
  const dados = base();
  dados.checkins.push({ id: 'c4', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 4, sexo: 'F', estrelas_ajustadas: null, jogo: 2, ordem: 2 }); // Ana também no jogo 2: descarta
  dados.checkins.push({ id: 'c5', data: '2026-10-06', jogador_id: 'p4', jogador_nome: 'Duda', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 2, ordem: 3 });
  const repo = criarRepoMemoria(dados);
  const n = await repo.moverJogo2ParaJogo1('2026-10-06');
  assert.equal(n, 2); // Bruno (c2) e Duda (c5); Ana (c4) foi descartada
  const t = await repo.lerTudo();
  assert.equal(t.checkins.length, 4); // c1, c2, c3, c5 (c4 descartada)
  assert.ok(!t.checkins.some((c) => c.id === 'c4'));
  const noJogo1 = t.checkins.filter((c) => c.jogo === 1).sort((a, b) => a.ordem - b.ordem);
  assert.deepEqual(noJogo1.map((c) => c.id), ['c1', 'c3', 'c2', 'c5']); // na ordem em que chegaram
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/repo-dois-jogos.test.mjs`
Expected: FALHA — `repo.gravarFinJogo is not a function` (e as demais).

- [ ] **Step 3: Implementar em `backend/repo-memoria.js`**

Adicionar `'fin_jogos'` em `TABELAS` (linhas 4-7 hoje):

```js
export const TABELAS = [
  'jogadores', 'rodadas', 'times_rodada', 'time_jogadores', 'checkins', 'config', 'usuarios',
  'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'fin_jogos', 'ao_vivo', 'ao_vivo_log'
];
```

Adicionar os quatro métodos novos (perto de `inserirFinCredito`, antes da seção da trava):

```js
    // fin_jogos: upsert por (data, jogo); numa atualização só os campos enviados mudam (igual a gravarFinDia)
    async gravarFinJogo(linha) {
      const i = tabelas.fin_jogos.findIndex((j) => j.data === linha.data && j.jogo === linha.jogo);
      if (i === -1) tabelas.fin_jogos.push({ status: 'normal', ...linha });
      else tabelas.fin_jogos[i] = { ...tabelas.fin_jogos[i], ...linha };
    },
    async definirStatusFinJogo(data, jogo, status) {
      const i = tabelas.fin_jogos.findIndex((j) => j.data === data && j.jogo === jogo);
      if (i === -1) return false;
      tabelas.fin_jogos[i] = { ...tabelas.fin_jogos[i], status };
      return true;
    },
    // botão ⇄: move pro fim da fila do destino; false se o check-in não existe ou se a pessoa já está lá
    async moverCheckinDeJogo(id, paraJogo) {
      const c = tabelas.checkins.find((x) => x.id === id);
      if (!c) return false;
      if (c.jogador_id != null && tabelas.checkins.some((x) => x.data === c.data && x.jogo === paraJogo && x.jogador_id === c.jogador_id)) return false;
      const proximaOrdem = tabelas.checkins.reduce((m, x) => (x.data === c.data && x.jogo === paraJogo ? Math.max(m, x.ordem ?? 0) : m), 0) + 1;
      c.jogo = paraJogo;
      c.ordem = proximaOrdem;
      return true;
    },
    // remover o 2º jogo (destino: mover): descarta quem já está no 1º, move o resto pro fim, na ordem de chegada
    async moverJogo2ParaJogo1(data) {
      const doJogo1 = new Set(tabelas.checkins.filter((c) => c.data === data && c.jogo === 1).map((c) => c.jogador_id));
      const doJogo2 = tabelas.checkins.filter((c) => c.data === data && c.jogo === 2).sort(porOrdemLocal);
      let proximaOrdem = tabelas.checkins.reduce((m, x) => (x.data === data && x.jogo === 1 ? Math.max(m, x.ordem ?? 0) : m), 0);
      let movidos = 0;
      for (const c of doJogo2) {
        if (c.jogador_id != null && doJogo1.has(c.jogador_id)) {
          tabelas.checkins = tabelas.checkins.filter((x) => x !== c);
          continue;
        }
        proximaOrdem += 1;
        c.jogo = 1;
        c.ordem = proximaOrdem;
        movidos += 1;
      }
      return movidos;
    },
```

Adicionar, perto do topo do arquivo (junto a `COM_ORDEM`), o comparador local de ordem (o arquivo não importa `porOrdem` de `mapeadores.js` hoje — criar uma cópia mínima só para esta função interna, igual ao estilo do arquivo de não depender de outros módulos):

```js
const porOrdemLocal = (a, b) => { const x = a.ordem ?? Infinity, y = b.ordem ?? Infinity; return x === y ? 0 : (x < y ? -1 : 1); };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/repo-dois-jogos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 5: Rodar a suíte inteira do backend (nada mais deveria quebrar)**

Run: `npm run test:backend`
Expected: tudo `ok` (adicionar o novo arquivo à lista de scripts do `package.json`, ver Step 6).

- [ ] **Step 6: Registrar o teste novo no `package.json`**

Em `package.json`, no script `test:backend`, adicionar `&& node tests/backend/repo-dois-jogos.test.mjs` logo depois de `node tests/backend/gerar-sql-grupo.test.mjs &&` (mesma posição relativa não importa; manter perto dos testes de repositório, por exemplo logo após `node tests/backend/repo-financeiro.test.mjs &&`).

- [ ] **Step 7: Commit**

```bash
git add backend/repo-memoria.js tests/backend/repo-dois-jogos.test.mjs package.json
git commit -m "backend: repo em memória — tabela fin_jogos e mover check-in entre jogos"
```

---

### Task 4: `repo-supabase.js` — os mesmos métodos, via Supabase

**Files:**
- Modify: `backend/repo-supabase.js`

**Interfaces:**
- Consumes: `mover_checkin_de_jogo`, `mover_jogo2_para_jogo1` (SQL da Task 1); `fin_jogos` (tabela da Task 1)
- Produces: os mesmos quatro métodos da Task 3, com a mesma assinatura — `financeiro.js` (Tasks 7/8) chama os dois repositórios de forma intercambiável.

Sem teste de integração real aqui (exigiria um banco Supabase de verdade); a cobertura de comportamento vem da Task 3 (repo em memória, usado pelos testes de `financeiro.js`) e da Task 10 (handler). Esta task só garante que o código compila e segue o padrão dos métodos vizinhos.

- [ ] **Step 1: Adicionar `fin_jogos` às tabelas lidas pelo GET**

Em `backend/repo-supabase.js`, adicionar a chave de ordenação (perto de `CHAVES`, linha ~6-10):

```js
const CHAVES = {
  jogadores: ['id'], rodadas: ['round_id'], times_rodada: ['id'], time_jogadores: ['time_rodada_id', 'jogador_id'],
  checkins: ['id'], config: ['chave'], usuarios: ['email'], fin_dias: ['data'], fin_pagamentos: ['id'],
  fin_creditos: ['id'], fin_lancamentos: ['id'], fin_jogos: ['data', 'jogo'], ao_vivo: ['id'], ao_vivo_log: ['id']
};
```

(`TABELAS` já vem de `repo-memoria.js`, que a Task 3 já atualizou com `'fin_jogos'` — `lerTudo()` deste arquivo passa a incluir a tabela automaticamente, sem mais nada a mudar nessa função.)

- [ ] **Step 2: Adicionar os quatro métodos**, logo depois de `inserirFinCredito` (perto da linha 157 hoje):

```js
    async gravarFinJogo(linha) {
      const { error } = await cliente.from('fin_jogos').upsert(linha, { onConflict: 'data,jogo' });
      if (error) throw new Error('fin_jogos: ' + error.message);
    },
    async definirStatusFinJogo(data, jogo, status) {
      const { data: linhas, error } = await cliente.from('fin_jogos').update({ status }).eq('data', data).eq('jogo', jogo).select('data');
      if (error) throw new Error('fin_jogos: ' + error.message);
      return linhas.length > 0;
    },
    // botão ⇄ (ajuste 9); se a função não existir ainda, o erro cita o arquivo certo
    async moverCheckinDeJogo(id, paraJogo) {
      const { data, error } = await cliente.rpc('mover_checkin_de_jogo', { p_id: id, p_para_jogo: paraJogo });
      if (error) throw new Error('mover_checkin_de_jogo: ' + error.message + ' (rode sql/schema-terca-supabase-ajuste-9.sql no SQL Editor do Supabase)');
      return data === true;
    },
    async moverJogo2ParaJogo1(data) {
      const { data: n, error } = await cliente.rpc('mover_jogo2_para_jogo1', { p_data: data });
      if (error) throw new Error('mover_jogo2_para_jogo1: ' + error.message + ' (rode sql/schema-terca-supabase-ajuste-9.sql no SQL Editor do Supabase)');
      return Number(n);
    },
```

- [ ] **Step 3: Rodar a suíte inteira do backend** (os testes que usam `repo-supabase` mockam o cliente Supabase; conferir que nada quebrou)

Run: `npm run test:backend`
Expected: tudo `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/repo-supabase.js
git commit -m "backend: repo Supabase — fin_jogos e as duas RPCs de mover check-in"
```

---

## PARTE C — Mapeamento (GET) e check-in

### Task 5: `mapeadores.js` — campos novos no GET

**Files:**
- Modify: `backend/mapeadores.js`
- Test: `tests/backend/mapeadores-dois-jogos.test.mjs` (novo)

**Interfaces:**
- Produces: `mapearCheckins` devolve `jogo` (número) em cada item; `mapearConfig` devolve `checkinJogo2` (objeto ou `null`); `mapearFinanceiro` devolve `dias[].porJogo`, `jogos` (array), `pagamentos[].jogo` (número ou `null`), `creditos[].jogoOrigem` (número ou `null`).
- Consumes: linhas cruas de `checkins` (com `.jogo`), `config` (chaves `checkinJogo2*`), `fin_dias` (com `.por_jogo`), `fin_jogos` (Task 3/4), `fin_pagamentos`/`fin_creditos` (com `.jogo`/`.jogo_origem`).

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// tests/backend/mapeadores-dois-jogos.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { mapearCheckins, mapearConfig, mapearFinanceiro } from '../../backend/mapeadores.js';

await ta('mapearCheckins: devolve jogo (1 quando a coluna vem vazia/nula)', () => {
  const r = mapearCheckins([
    { id: 'c1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 4, sexo: 'F', estrelas_ajustadas: null, jogo: 2, ordem: 1 },
    { id: 'c2', data: '2026-10-06', jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: null, ordem: 2 }
  ]);
  assert.deepEqual(r.map((c) => c.jogo), [2, 1]);
});

await ta('mapearConfig: checkinJogo2 null sem as chaves; objeto completo quando presentes', () => {
  assert.equal(mapearConfig([]).checkinJogo2, null);
  const cfg = mapearConfig([
    { chave: 'checkinJogo2Data', valor: '2026-10-06' }, { chave: 'checkinJogo2Horario', valor: '21:00' },
    { chave: 'checkinJogo2Vagas', valor: '12' }, { chave: 'checkinJogo2Travado', valor: 'TRUE' }
  ]);
  assert.deepEqual(cfg.checkinJogo2, { data: '2026-10-06', horario: '21:00', vagas: 12, travado: true });
});

await ta('mapearFinanceiro: dias[].porJogo, jogos[], pagamentos[].jogo e creditos[].jogoOrigem', () => {
  const f = mapearFinanceiro({
    fin_dias: [{ data: '2026-10-06', valor_pessoa: 15, pix: '', valor_quadra: 300, tem_brinde: false, valor_brinde: 0, icone: '✅', status: 'normal', por_jogo: true, ordem: 1 }],
    fin_jogos: [{ data: '2026-10-06', jogo: 2, valor_pessoa: 15, pix: 'k', valor_quadra: 180, tem_brinde: false, valor_brinde: 0, icone: '✅', status: 'normal', atualizado_por: 'Org', atualizado_em: '' }],
    fin_pagamentos: [{ id: 'p1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, marcado_por: 'Org', marcado_em: '', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, jogo: 2, ordem: 1 }],
    fin_creditos: [{ id: 'cr1', jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, origem_pagamento_id: 'p0', data_origem: '2026-09-29', criado_por: 'Adm', criado_em: '', status: 'ativo', encerrado_por: null, encerrado_em: null, jogo_origem: 1, ordem: 1 }],
    fin_lancamentos: [], fin_log: []
  });
  assert.equal(f.dias[0].porJogo, true);
  assert.deepEqual(f.jogos, [{ data: '2026-10-06', jogo: 2, valorPessoa: 15, pix: 'k', valorQuadra: 180, temBrinde: false, valorBrinde: 0, icone: '✅', status: 'normal' }]);
  assert.equal(f.pagamentos[0].jogo, 2);
  assert.equal(f.creditos[0].jogoOrigem, 1);
});

await ta('mapearFinanceiro: pagamento/crédito "do dia" (coluna nula) vira jogo/jogoOrigem null, não 1', () => {
  const f = mapearFinanceiro({
    fin_dias: [], fin_jogos: [],
    fin_pagamentos: [{ id: 'p1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, marcado_por: 'Org', marcado_em: '', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, jogo: null, ordem: 1 }],
    fin_creditos: [], fin_lancamentos: [], fin_log: []
  });
  assert.equal(f.pagamentos[0].jogo, null);
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/mapeadores-dois-jogos.test.mjs`
Expected: FALHA — `checkinJogo2` indefinido, `porJogo`/`jogos` ausentes, etc.

- [ ] **Step 3: Implementar em `backend/mapeadores.js`**

Em `mapearCheckins` (acrescentar `jogo`):

```js
export function mapearCheckins(checkins) {
  return checkins.slice().sort(porOrdem).map((c) => ({
    id: texto(c.id), data: texto(c.data), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome),
    estrelas: numero(c.estrelas), sexo: texto(c.sexo),
    estrelasAjustadas: texto(c.estrelas_ajustadas),
    jogo: Number(c.jogo) || 1
  }));
}
```

Em `mapearConfig`, acrescentar `checkinJogo2` ao objeto padrão e ao laço (a função já existe; só adicionar as linhas marcadas):

```js
export function mapearConfig(linhas) {
  const s = {
    estrelasVisiveis: true, checkinDataAberta: '', checkinTravado: false, checkinVagas: 16,
    checkinHorario: '20:00', checkinMensagemTemplate: CHECKIN_MENSAGEM_PADRAO, contadorAcessos: 0,
    checkinJogo2: null // { data, horario, vagas, travado } quando o 2º jogo existe
  };
  const jogo2 = {};
  for (const { chave, valor } of linhas) {
    if (chave === 'estrelasVisiveis') s.estrelasVisiveis = String(valor).toUpperCase() === 'TRUE';
    if (chave === 'checkinDataAberta') s.checkinDataAberta = texto(valor);
    if (chave === 'checkinTravado') s.checkinTravado = String(valor).toUpperCase() === 'TRUE';
    if (chave === 'checkinVagas') s.checkinVagas = Number(valor) || 16;
    if (chave === 'checkinHorario') s.checkinHorario = texto(valor) || '20:00';
    if (chave === 'checkinMensagemTemplate') s.checkinMensagemTemplate = texto(valor) || CHECKIN_MENSAGEM_PADRAO;
    if (chave === 'contadorAcessos') s.contadorAcessos = Number(valor) || 0;
    if (chave === 'checkinJogo2Data') jogo2.data = texto(valor);
    if (chave === 'checkinJogo2Horario') jogo2.horario = texto(valor);
    if (chave === 'checkinJogo2Vagas') jogo2.vagas = Number(valor) || 16;
    if (chave === 'checkinJogo2Travado') jogo2.travado = String(valor).toUpperCase() === 'TRUE';
  }
  if (jogo2.data) s.checkinJogo2 = { data: jogo2.data, horario: jogo2.horario || '21:00', vagas: jogo2.vagas || 16, travado: !!jogo2.travado };
  return s;
}
```

Em `mapearFinanceiro`, acrescentar `porJogo` em `dias`, o array `jogos`, `jogo` em `pagamentos` e `jogoOrigem` em `creditos` (reescrever a função inteira, já que vários trechos mudam):

```js
export function mapearFinanceiro({ fin_dias, fin_pagamentos, fin_creditos, fin_lancamentos, fin_log, fin_jogos }) {
  const dias = fin_dias.slice().sort(porOrdem).map((d) => ({
    data: texto(d.data), valorPessoa: numero(d.valor_pessoa), pix: texto(d.pix), valorQuadra: numero(d.valor_quadra),
    temBrinde: d.tem_brinde === true, valorBrinde: numero(d.valor_brinde), icone: icone(d.icone), status: statusDia(d.status),
    porJogo: d.por_jogo === true
  }));
  const jogos = (fin_jogos || []).slice().sort((a, b) => (texto(a.data) === texto(b.data) ? a.jogo - b.jogo : (texto(a.data) < texto(b.data) ? -1 : 1))).map((j) => ({
    data: texto(j.data), jogo: Number(j.jogo), valorPessoa: numero(j.valor_pessoa), pix: texto(j.pix), valorQuadra: numero(j.valor_quadra),
    temBrinde: j.tem_brinde === true, valorBrinde: numero(j.valor_brinde), icone: icone(j.icone), status: statusDia(j.status)
  }));
  const pagamentos = fin_pagamentos.slice().sort(porOrdem).map((p) => ({
    id: texto(p.id), data: texto(p.data), jogadorId: texto(p.jogador_id), jogadorNome: texto(p.jogador_nome),
    valor: numero(p.valor), marcadoPor: texto(p.marcado_por), marcadoEm: iso(p.marcado_em),
    estornado: p.estornado === true, estornadoPor: texto(p.estornado_por), estornadoEm: iso(p.estornado_em),
    tipo: tipoPagamento(p.tipo), creditoId: texto(p.credito_id),
    jogo: p.jogo == null ? null : Number(p.jogo)
  }));
  const creditos = fin_creditos.slice().sort(porOrdem).map((c) => ({
    id: texto(c.id), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome), valor: numero(c.valor),
    origemPagamentoId: texto(c.origem_pagamento_id), dataOrigem: texto(c.data_origem), criadoPor: texto(c.criado_por),
    criadoEm: iso(c.criado_em), status: texto(c.status) || 'ativo', encerradoPor: texto(c.encerrado_por), encerradoEm: iso(c.encerrado_em),
    jogoOrigem: c.jogo_origem == null ? null : Number(c.jogo_origem)
  }));
  const lancamentos = fin_lancamentos.slice().sort(porOrdem).map((l) => ({
    id: texto(l.id), data: texto(l.data), tipo: texto(l.tipo), descricao: texto(l.descricao), valor: numero(l.valor),
    criadoPor: texto(l.criado_por), criadoEm: iso(l.criado_em),
    estornado: l.estornado === true, estornadoPor: texto(l.estornado_por), estornadoEm: iso(l.estornado_em)
  }));
  const log = fin_log.slice().sort((a, b) => b.id - a.id).slice(0, 100).map((l) => ({
    timestamp: iso(l.timestamp), nome: texto(l.nome), acao: texto(l.acao), detalhe: detalheComoTexto(l.detalhe)
  }));
  return { dias, jogos, pagamentos, lancamentos, log, creditos };
}
```

(`lerTudo()` do repositório em memória e do Supabase já devolve `fin_jogos` desde as Tasks 3/4, então `handler.js`'s `mapearFinanceiro(t)` — chamado com o `t` inteiro de `repo.lerTudo()` — passa `fin_jogos` automaticamente; nada a mudar em `handler.js` aqui.)

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/mapeadores-dois-jogos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 5: Rodar a suíte inteira do backend**

Run: `npm run test:backend`
Expected: tudo `ok` — nenhum teste existente lia `fin_jogos`/`jogo`/`porJogo`, então nada quebra.

- [ ] **Step 6: Registrar o teste novo no `package.json`** (depois de `node tests/backend/mapeadores.test.mjs &&`)

- [ ] **Step 7: Commit**

```bash
git add backend/mapeadores.js tests/backend/mapeadores-dois-jogos.test.mjs package.json
git commit -m "backend: GET devolve jogo/porJogo/jogos/jogoOrigem/checkinJogo2"
```

---

### Task 6: `backend/checkins.js` — `addCheckin` valida `jogo`; ação `moverCheckin`

**Files:**
- Modify: `backend/checkins.js`
- Test: `tests/backend/checkins-dois-jogos.test.mjs` (novo)

**Interfaces:**
- Consumes: `repo.moverCheckinDeJogo` (Task 3/4); `mapearConfig`, `mapearCheckins` (Task 5); os ganchos `aposAdicionarCheckin(deps, data)` / `aposRemoverCheckin(deps, data, jogadorId)` de `backend/financeiro.js` — **assinatura inalterada** (Task 7 os torna cientes de várias chaves por dentro).
- Produces: `addCheckin` grava `jogo` (1 quando ausente) e recusa jogo inválido/duplicado/sem configuração; `moverCheckin(deps, { id, paraJogo }, auth)` → `{ status:'ok', moveu: boolean }` ou `{ error }`.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// tests/backend/checkins-dois-jogos.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { addCheckin, moverCheckin } from '../../backend/checkins.js';
import { mapearCheckins } from '../../backend/mapeadores.js';

const ORG = { perfil: 'organizador', nome: 'Org', email: 'o@x.com', viaChaveMestra: false };

function ambiente(extra) {
  return {
    repo: criarRepoMemoria({
      jogadores: [{ id: 'p1', nome: 'Ana', convidado: false, removido: false, ordem: 1 }, { id: 'p2', nome: 'Bruno', convidado: false, removido: false, ordem: 2 }],
      config: [
        { chave: 'checkinDataAberta', valor: '2026-10-06' }, { chave: 'checkinVagas', valor: '16' },
        { chave: 'checkinJogo2Data', valor: '2026-10-06' }, { chave: 'checkinJogo2Horario', valor: '21:00' }, { chave: 'checkinJogo2Vagas', valor: '12' },
        ...(extra?.config || [])
      ],
      checkins: extra?.checkins || []
    }),
    relogio: () => new Date('2026-10-06T12:00:00.000Z')
  };
}
const lista = async (d) => mapearCheckins((await d.repo.lerTudo()).checkins);

await ta('addCheckin: jogo ausente grava 1; jogo 2 grava 2; jogo inválido dá erro', async () => {
  const d = ambiente();
  await addCheckin(d, { id: 'c1', data: '2026-10-06', jogadorId: 'p1' });
  await addCheckin(d, { id: 'c2', data: '2026-10-06', jogadorId: 'p2', jogo: 2 });
  const t = await lista(d);
  assert.deepEqual(t.map((c) => [c.id, c.jogo]), [['c1', 1], ['c2', 2]]);
  assert.deepEqual(await addCheckin(d, { id: 'c3', data: '2026-10-06', jogadorId: 'p1', jogo: 3 }), { error: 'Jogo inválido.' });
});

await ta('addCheckin: recusa jogo 2 quando a data não tem 2º jogo configurado', async () => {
  const d = ambiente({ config: [] }); // sem checkinJogo2*
  const r = await addCheckin(d, { id: 'c1', data: '2026-10-06', jogadorId: 'p1', jogo: 2 });
  assert.deepEqual(r, { error: 'Esse jogo não existe mais. Recarregue a página.' });
});

await ta('addCheckin: recusa a mesma pessoa duas vezes NO MESMO jogo; aceita nos dois jogos', async () => {
  const d = ambiente();
  await addCheckin(d, { id: 'c1', data: '2026-10-06', jogadorId: 'p1', jogo: 1 });
  assert.deepEqual(await addCheckin(d, { id: 'c2', data: '2026-10-06', jogadorId: 'p1', jogo: 1 }), { error: 'Essa pessoa já está na lista desse jogo.' });
  assert.deepEqual(await addCheckin(d, { id: 'c3', data: '2026-10-06', jogadorId: 'p1', jogo: 2 }), { status: 'ok' }); // outro jogo: pode
});

await ta('moverCheckin: move pro outro jogo; recusa se já está lá; recusa destino inexistente', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 }
  ] });
  assert.deepEqual(await moverCheckin(d, { id: 'c1', paraJogo: 2 }, ORG), { status: 'ok', moveu: true });
  assert.equal((await lista(d))[0].jogo, 2);
  assert.deepEqual(await moverCheckin(d, { id: 'c1', paraJogo: 2 }, ORG), { status: 'ok', moveu: false }); // já estava lá
  assert.deepEqual(await moverCheckin(d, { id: 'nao-existe', paraJogo: 1 }, ORG), { error: 'Check-in não encontrado.' });
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/checkins-dois-jogos.test.mjs`
Expected: FALHA — `moverCheckin` não existe; `addCheckin` não valida `jogo`.

- [ ] **Step 3: Implementar em `backend/checkins.js`**

Reescrever `addCheckin` (troca o corpo da função existente; o resto do arquivo — `removeCheckin`, `salvarEstrelasAjustadas`, `notaAjustada`, `MAX_NOME` — continua igual):

```js
import { texto } from './mapeadores.js';
import { aposAdicionarCheckin, aposRemoverCheckin } from './financeiro.js';
import { mapearConfig } from './mapeadores.js';

const MAX_NOME = 120;

function notaAjustada(v) {
  const s = String(v || '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// jogos que existem na data (1 sempre; 2 só se checkinJogo2 bate com a data) — mesma regra do front
function jogoExiste(cfg, data, jogo) {
  if (jogo === 1) return true;
  if (jogo === 2) return !!(cfg.checkinJogo2 && texto(cfg.checkinJogo2.data) === data);
  return false;
}

export async function addCheckin(deps, c) {
  const { repo } = deps;
  if (!c || !texto(c.id)) return { error: 'Check-in sem id.' };
  const tudo = await repo.lerTudo();
  if (tudo.checkins.some((x) => x.id === texto(c.id))) return { error: 'Já existe um check-in com esse id.' };
  const nota = notaAjustada(c.estrelasAjustadas);
  if (nota === undefined) return { error: 'Estrelas ajustadas inválidas.' };
  const jogo = c.jogo === undefined || c.jogo === null ? 1 : Number(c.jogo);
  if (jogo !== 1 && jogo !== 2) return { error: 'Jogo inválido.' };
  const cfg = mapearConfig(tudo.config);
  if (!jogoExiste(cfg, texto(c.data), jogo)) return { error: 'Esse jogo não existe mais. Recarregue a página.' };
  const jogadorId = texto(c.jogadorId);
  if (jogadorId && tudo.checkins.some((x) => x.data === c.data && (Number(x.jogo) || 1) === jogo && x.jogador_id === jogadorId)) {
    return { error: 'Essa pessoa já está na lista desse jogo.' };
  }
  if (jogadorId && !tudo.jogadores.some((j) => j.id === jogadorId)) {
    await repo.inserirJogador({
      id: jogadorId, nome: texto(c.jogadorNome).slice(0, MAX_NOME), apelido: null, foto: null, estrelas: Number(c.estrelas) || null,
      sexo: texto(c.sexo) || null, porte: null, convidado: true, removido: false, ordem: null
    });
  }
  await repo.inserirCheckin({
    id: texto(c.id), data: c.data, jogador_id: jogadorId || null, jogador_nome: texto(c.jogadorNome).slice(0, MAX_NOME) || null,
    estrelas: Number(c.estrelas) || 0, sexo: texto(c.sexo) || null, estrelas_ajustadas: nota, jogo
  });
  await aposAdicionarCheckin(deps, c.data);
  return { status: 'ok' };
}

export async function removeCheckin(deps, id) {
  const { repo } = deps;
  const alvo = (await repo.lerTudo()).checkins.find((c) => c.id === texto(id));
  if (!(await repo.removerCheckin(texto(id)))) return { error: 'Check-in não encontrado (pode já ter sido desmarcado).' };
  if (alvo) await aposRemoverCheckin(deps, texto(alvo.data), texto(alvo.jogador_id));
  return { status: 'ok' };
}

export async function salvarEstrelasAjustadas({ repo }, lista) {
  if (!Array.isArray(lista) || lista.length === 0) return { error: 'Lista de check-ins vazia.' };
  const itens = [];
  for (const item of lista) {
    const id = texto(item && item.id);
    if (!id) continue;
    const nota = notaAjustada(item.estrelasAjustadas);
    if (nota === undefined) return { error: 'Estrelas ajustadas inválidas.' };
    itens.push([id, nota]);
  }
  for (const [id, nota] of itens) await repo.atualizarCheckin(id, { estrelas_ajustadas: nota });
  return { status: 'ok' };
}

// Botão ⇄: tira do jogo de origem e põe no fim da fila do destino. "Tudo ou nada": se a pessoa já estava no
// destino, moveu é false e NADA é logado (idempotente, como addCheckin tocado duas vezes).
export async function moverCheckin(deps, { id, paraJogo } = {}, auth) {
  const { repo } = deps;
  const alvo = (await repo.lerTudo()).checkins.find((c) => c.id === texto(id));
  if (!alvo) return { error: 'Check-in não encontrado.' };
  const destino = Number(paraJogo);
  if (destino !== 1 && destino !== 2) return { error: 'Jogo inválido.' };
  const data = texto(alvo.data), jogadorId = texto(alvo.jogador_id);
  await aposRemoverCheckin(deps, data, jogadorId); // antes de mover: se saiu de uma chave, devolve crédito/sinaliza
  const moveu = await repo.moverCheckinDeJogo(texto(id), destino);
  if (moveu) await aposAdicionarCheckin(deps, data); // pode ter crédito disponível no destino
  return { status: 'ok', moveu };
}
```

Nota: o gancho `aposRemoverCheckin` é chamado **antes** de mover de verdade (ele só olha "a pessoa ainda está confirmada em alguma chave?" — e nesse instante ela ainda está, só que no jogo de origem; a Task 7 implementa `aposRemoverCheckin` reconferindo a lista fresca do banco a cada chave, então chamá-lo logo antes do `UPDATE` de `moverCheckinDeJogo` funciona porque, no modo separado, a chave do jogo de origem deixa de ter a pessoa assim que o `UPDATE` roda — então o gancho **tem que ser chamado depois**, não antes). Corrigir a ordem:

```js
export async function moverCheckin(deps, { id, paraJogo } = {}, auth) {
  const { repo } = deps;
  const alvo = (await repo.lerTudo()).checkins.find((c) => c.id === texto(id));
  if (!alvo) return { error: 'Check-in não encontrado.' };
  const destino = Number(paraJogo);
  if (destino !== 1 && destino !== 2) return { error: 'Jogo inválido.' };
  const data = texto(alvo.data), jogadorId = texto(alvo.jogador_id);
  const moveu = await repo.moverCheckinDeJogo(texto(id), destino);
  if (moveu) {
    await aposRemoverCheckin(deps, data, jogadorId); // agora a chave de origem já não tem mais a pessoa: devolve crédito/sinaliza se for o caso
    await aposAdicionarCheckin(deps, data); // crédito disponível no destino, se houver
  }
  return { status: 'ok', moveu };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/checkins-dois-jogos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 5: Rodar a suíte existente de check-in (não deve quebrar)**

Run: `node tests/backend/checkins.test.mjs`
Expected: `TODOS OS TESTES PASSARAM` (o comportamento de 1 jogo é idêntico: `jogo` ausente vira 1, nunca aparece no mapeamento dos testes antigos porque eles não conferem esse campo).

- [ ] **Step 6: Registrar o teste novo no `package.json`** (depois de `node tests/backend/checkins.test.mjs &&`)

- [ ] **Step 7: Commit**

```bash
git add backend/checkins.js tests/backend/checkins-dois-jogos.test.mjs package.json
git commit -m "backend: addCheckin valida jogo; ação moverCheckin (botão ⇄)"
```

---

## PARTE D — Financeiro (o coração da mudança)

### Task 7: `backend/financeiro.js` — "chave de cobrança" (`null` = o dia, `1`/`2` = um jogo)

**Files:**
- Modify: `backend/financeiro.js` (reescrita)
- Modify: `tests/backend/financeiro.test.mjs`, `tests/backend/financeiro-4b.test.mjs` (assinaturas novas)
- Test: `tests/backend/financeiro-dois-jogos.test.mjs` (novo)

**Interfaces:**
- Consumes: `repo.gravarFinJogo`, `repo.definirStatusFinJogo` (Task 3/4); `mapearConfig` (já importado); `checkins[].jogo` via `mapearCheckins` (Task 5).
- Produces (assinaturas que mudam — `checkins.js`, `jogos2.js` e `handler.js` passam a chamar assim):
  - `aplicarCreditos(deps, data, chave, auth)` (ganhou `chave`)
  - `marcarPagamento(deps, data, chave, jogadorId, jogadorNome, auth)` (ganhou `chave`)
  - `marcarTodosPagamentos(deps, data, chave, auth)` / `estornarTodosPagamentos(deps, data, chave, auth)` (ganharam `chave`)
  - `marcarDiaSemJogo(deps, data, chave, destino, auth)` (ganhou `chave`)
  - `reabrirDia(deps, data, chave, auth)` (ganhou `chave`)
  - `salvarFinDia(deps, d, auth)` — **assinatura igual**; `d` ganha os campos opcionais `jogo` (1/2) e `porJogo` (boolean)
  - `estornarPagamento`, `addLancamento`, `estornarLancamento`, `devolverCredito`, `aplicarCreditosDoDia` — **assinatura igual**
  - `aposAdicionarCheckin(deps, data)`, `aposRemoverCheckin(deps, data, jogadorId)` — **assinatura igual** (usadas por `checkins.js`, já na Task 6)
  - `chave` é sempre `null` (o dia) ou `1`/`2` (um jogo); nunca `undefined` — quem chama com valor ausente deve mandar `null` explicitamente.

- [ ] **Step 1: Escrever os testes novos (falhando)** — cobrem só o que é NOVO (único vs. separado); o comportamento de 1 jogo continua coberto pelos testes já existentes (que serão ajustados no Step 4)

```js
// tests/backend/financeiro-dois-jogos.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { mapearFinanceiro, mapearCheckins } from '../../backend/mapeadores.js';
import {
  salvarFinDia, marcarPagamento, estornarPagamento, marcarTodosPagamentos, estornarTodosPagamentos,
  marcarDiaSemJogo, reabrirDia, aplicarCreditos
} from '../../backend/financeiro.js';

const ORG = { perfil: 'organizador', nome: 'Org', email: 'o@x.com', viaChaveMestra: false };
const ADM = { perfil: 'admin', nome: 'Adm', email: 'a@x.com', viaChaveMestra: false };
const DATA = '2026-10-06';

function ambiente(ajustar) {
  const dados = {
    jogadores: [1, 2, 3].map((i) => ({ id: 'p' + i, nome: 'J' + i, convidado: false, removido: false, ordem: i })),
    checkins: [
      { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'J1', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
      { id: 'c2', data: DATA, jogador_id: 'p2', jogador_nome: 'J2', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 2, ordem: 1 },
      { id: 'c3', data: DATA, jogador_id: 'p1', jogador_nome: 'J1', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 2, ordem: 2 } // p1 nos dois jogos
    ],
    config: [{ chave: 'checkinVagas', valor: '16' }, { chave: 'checkinJogo2Data', valor: DATA }, { chave: 'checkinJogo2Vagas', valor: '16' }],
    fin_dias: [], fin_pagamentos: [], fin_creditos: [], fin_lancamentos: [], fin_log: [], fin_jogos: []
  };
  if (ajustar) ajustar(dados);
  let n = 0;
  return { repo: criarRepoMemoria(dados), relogio: () => new Date('2026-10-06T12:00:00.000Z'), gerarId: () => 'id-' + (++n) };
}
const fin = async (d) => mapearFinanceiro(await d.repo.lerTudo());

await ta('salvarFinDia: único (padrão) — jogo 2 recusado sem "separado por jogo" configurado', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' }, ORG);
  assert.deepEqual(await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 15, valorQuadra: 150, valorBrinde: 0, pix: '' }, ORG),
    { error: 'Configure "Separado por jogo" antes de editar o 2º jogo.' });
});

await ta('único: um pagamento cobre os 2 jogos; quem está nos dois conta uma vez só (pendentes)', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' }, ORG);
  const r = await marcarPagamento(d, DATA, null, 'p1', 'J1', ORG);
  assert.equal(r.financeiro.pagamentos.length, 1);
  assert.equal(r.financeiro.pagamentos[0].jogo, null); // "do dia", não 1
  // marcar todos: só falta p2 (p1 já pagou, conta uma vez mesmo estando nos 2 jogos; p3 não está em nenhum)
  const r2 = await marcarTodosPagamentos(d, DATA, null, ORG);
  assert.equal(r2.financeiro.pagamentos.length, 2);
  assert.ok(r2.financeiro.pagamentos.some((p) => p.jogadorId === 'p2'));
});

await ta('separado: cada jogo cobra o seu; quem está nos dois paga os dois', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG);
  await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: 'px' }, ORG);
  const r1 = await marcarPagamento(d, DATA, 1, 'p1', 'J1', ORG);
  assert.equal(r1.financeiro.pagamentos.find((p) => p.jogo === 1).valor, 15);
  const r2 = await marcarPagamento(d, DATA, 2, 'p1', 'J1', ORG);
  assert.equal(r2.financeiro.pagamentos.length, 2); // dois pagamentos distintos pra mesma pessoa, um por jogo
  assert.equal(r2.financeiro.pagamentos.find((p) => p.jogo === 2).valor, 20);
  // p3 não está no jogo 1: recusado
  assert.deepEqual(await marcarPagamento(d, DATA, 1, 'p3', 'J3', ORG), { error: 'Essa pessoa não está na lista de check-in deste dia.' });
});

await ta('trocar único↔separado é bloqueado se já há pagamento válido no dia', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' }, ORG);
  await marcarPagamento(d, DATA, null, 'p1', 'J1', ORG);
  assert.deepEqual(await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG),
    { error: 'Já há pagamento(s) neste dia. Para trocar, use "Cancelar todos" antes.' });
});

await ta('separado: "sem jogo" só no jogo 2 — a quadra do jogo 1 continua contando; crédito guarda jogoOrigem', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG);
  await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: '' }, ORG);
  await marcarPagamento(d, DATA, 2, 'p2', 'J2', ORG);
  const r = await marcarDiaSemJogo(d, DATA, 2, 'credito', ORG);
  assert.equal(r.creditos, 1);
  const f = await fin(d);
  assert.equal(f.jogos.find((j) => j.jogo === 2).status, 'semjogo');
  assert.equal(f.dias.find((x) => x.data === DATA).status, ''); // jogo 1 continua normal
  assert.equal(f.creditos[0].jogoOrigem, 2);
});

await ta('crédito de um jogo de hoje nunca paga o outro jogo (nem o dia) de hoje — só datas futuras', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG);
  await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: '' }, ORG);
  await marcarPagamento(d, DATA, 2, 'p2', 'J2', ORG);
  await marcarDiaSemJogo(d, DATA, 2, 'credito', ORG); // p2 ganha crédito de hoje
  const n = await aplicarCreditos(d, DATA, 1, ORG); // tentar aplicar no jogo 1 de HOJE
  assert.equal(n, 0);
});

await ta('reabrirDia: separado, só o jogo 2; jogo 1 não é tocado', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG);
  await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: '' }, ORG);
  await marcarDiaSemJogo(d, DATA, 2, 'devolver', ADM);
  assert.equal((await reabrirDia(d, DATA, 2, ADM)).status, 'ok');
  const f = await fin(d);
  assert.equal(f.jogos.find((j) => j.jogo === 2).status, 'normal');
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/financeiro-dois-jogos.test.mjs`
Expected: FALHA em quase tudo (as funções ainda não aceitam `chave`, `salvarFinDia` ignora `jogo`/`porJogo`).

- [ ] **Step 3: Reescrever `backend/financeiro.js` por inteiro**

```js
// Controle financeiro. Port de finSalvarDia_, finMarcarPagamento_, finEstornarPagamento_, finMarcarTodos_,
// finEstornarTodos_, finAddLancamento_ e finEstornarLancamento_ de apps-script-codigo.gs (mesmas mensagens, mesmos
// textos de log, mesmo arredondamento em centavos), com o conceito de "chave de cobrança" (dois jogos no mesmo dia,
// 2026-10-03): `chave` é `null` quando o pagamento vale pro DIA inteiro (modo único, o padrão) ou `1`/`2` quando vale
// só por um jogo (modo separado, fin_dias.por_jogo = true). Com 1 jogo só (o padrão de sempre), a chave é sempre
// `null` e todo o comportamento é idêntico ao de antes — "chave" é só um rótulo a mais nas mesmas linhas.
// Spec: docs/superpowers/specs/2026-10-03-dois-jogos-no-mesmo-dia-design.md
import { mapearFinanceiro, mapearCheckins, mapearConfig, porOrdem, texto } from './mapeadores.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const MAXIMO = 99999999.99;
function dataValida(s) {
  const v = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '0001-01-01') return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function valor(v) {
  const bruto = (v === undefined || v === null || v === '') ? 0 : v;
  const n = Number(String(bruto).replace(',', '.'));
  return (Number.isFinite(n) && n >= 0) ? Math.round(n * 100) / 100 : null;
}
const icone = (v) => (String(v || '').trim() === '💰' ? '💰' : '✅');
const statusDia = (v) => (texto(v).trim() === 'semjogo' ? 'semjogo' : '');
const tipoPag = (v) => (texto(v).trim() === 'credito' ? 'credito' : 'dinheiro');
const nomeDe = (auth) => auth.nome || (auth.viaChaveMestra ? 'Chave mestra' : (auth.email || 'Desconhecido'));
export const SISTEMA = { nome: 'Crédito automático', email: '', perfil: 'admin', viaChaveMestra: false };

const agora = (deps) => deps.relogio().toISOString();
const gerarId = (deps) => (deps.gerarId ? deps.gerarId() : globalThis.crypto.randomUUID());
const ok = async ({ repo }) => ({ status: 'ok', financeiro: mapearFinanceiro(await repo.lerTudo()) });

async function log(deps, auth, acao, detalhe) {
  await deps.repo.inserirFinLog({
    timestamp: agora(deps), nome: nomeDe(auth), email: auth.email || '', acao,
    detalhe: { texto: typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe) }
  });
}

// ---------- leituras sobre as linhas do banco (t = resultado de repo.lerTudo()) ----------
const diaDe = (t, data) => t.fin_dias.slice().sort(porOrdem).find((d) => texto(d.data) === data);
const pagamentos = (t) => t.fin_pagamentos.slice().sort(porOrdem);
const ehValido = (p) => p.estornado !== true;
const creditos = (t) => t.fin_creditos.slice().sort(porOrdem).map((c) => ({
  id: texto(c.id), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome), valor: num(c.valor), origemPagamentoId: texto(c.origem_pagamento_id),
  dataOrigem: texto(c.data_origem), status: texto(c.status) || 'ativo', jogoOrigem: c.jogo_origem == null ? null : Number(c.jogo_origem)
}));
function saldoCreditoCentavos(c, pags) {
  let usado = 0;
  for (const p of pags) if (ehValido(p) && tipoPag(p.tipo) === 'credito' && texto(p.credito_id) === c.id) usado += Math.round(num(p.valor) * 100);
  return Math.round(c.valor * 100) - usado;
}

// ---------- "chave de cobrança": null = o dia inteiro (único); 1/2 = um jogo (separado) ----------
// linha de configuração (mesmo formato de fin_dias) da chave: 2 vem de fin_jogos; null/1 vem de fin_dias
const linhaConfigDaChave = (t, data, chave) =>
  chave === 2 ? (t.fin_jogos || []).find((j) => texto(j.data) === data && Number(j.jogo) === 2) || null : diaDe(t, data);
const chaveDoRegistro = (r) => (r.jogo == null ? null : Number(r.jogo));
const pagamentosDaChave = (t, data, chave) => pagamentos(t).filter((p) => texto(p.data) === data && chaveDoRegistro(p) === chave);
// jogos que existem na data (1 sempre; 2 só se checkinJogo2 bate com a data) — mesma regra do check-in
function jogosDaData(cfg, data) {
  const jogos = [{ numero: 1, vagas: cfg.checkinVagas || 16 }];
  if (cfg.checkinJogo2 && texto(cfg.checkinJogo2.data) === data) jogos.push({ numero: 2, vagas: Number(cfg.checkinJogo2.vagas) || (cfg.checkinVagas || 16) });
  return jogos;
}
const jogoDoCheckin = (c) => Number(c.jogo) || 1;
const checkinsDoJogo = (t, data, jogo) => mapearCheckins(t.checkins).filter((c) => c.data === data && jogoDoCheckin(c) === jogo);
// confirmados "pela chave": null = união de quem está confirmado, dentro das vagas, em QUALQUER jogo do dia (sem
// repetir pessoa); 1/2 = só os confirmados daquele jogo, dentro das vagas dele
function confirmadosPelaChave(t, cfg, data, chave) {
  const jogos = jogosDaData(cfg, data);
  if (chave !== null) {
    const j = jogos.find((x) => x.numero === chave);
    return j ? checkinsDoJogo(t, data, chave).slice(0, j.vagas) : [];
  }
  const vistos = new Set();
  const out = [];
  for (const j of jogos) {
    for (const c of checkinsDoJogo(t, data, j.numero).slice(0, j.vagas)) {
      if (vistos.has(c.jogadorId)) continue;
      vistos.add(c.jogadorId);
      out.push(c);
    }
  }
  return out;
}
// as chaves de cobrança que existem no dia: [null] no único; [1, 2] no separado (fin_dias.por_jogo = true)
function chavesDaData(t, cfg, data) {
  const dia = diaDe(t, data);
  if (!dia || dia.por_jogo !== true) return [null];
  return jogosDaData(cfg, data).map((j) => j.numero);
}
// normaliza a chave que o cliente mandou contra o modo DE VERDADE do dia (protege de um cliente com estado
// desatualizado tentando gravar numa chave que não existe mais, ou vice-versa)
function chaveEfetiva(t, data, chaveRecebida) {
  const dia = diaDe(t, data);
  if (!dia || dia.por_jogo !== true) return null;
  return Number(chaveRecebida) === 2 ? 2 : 1;
}

// linha de pagamento nova, no formato do banco ('' vira null: jogador_id é chave estrangeira); jogo null = "do dia"
function linhaPagamento(deps, { data, jogadorId, jogadorNome, valor: v, por, em, tipo = 'dinheiro', creditoId = null, jogo = null }) {
  return {
    id: gerarId(deps), data, jogador_id: jogadorId || null, jogador_nome: String(jogadorNome || '').slice(0, 80), valor: v,
    marcado_por: por, marcado_em: em, estornado: false, estornado_por: null, estornado_em: null, tipo, credito_id: creditoId, jogo
  };
}

// ---------- créditos ----------
// Aplica os créditos numa CHAVE normal (não "sem jogo") com valor cadastrado: cada confirmado DENTRO das vagas
// (daquela chave) que ainda não tem pagamento válido naquela chave e tem crédito ativo de um dia ANTERIOR com saldo
// suficiente ganha um pagamento tipo 'credito'. Um crédito nascido hoje nunca paga outra chave de hoje (dataOrigem < data).
export async function aplicarCreditos(deps, data, chave, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return 0;
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg || statusDia(linhaCfg.status) === 'semjogo' || !(num(linhaCfg.valor_pessoa) > 0)) return 0;
  const ativos = creditos(t).filter((c) => c.status === 'ativo' && c.dataOrigem < data && c.jogadorId !== '');
  if (!ativos.length) return 0;
  const dentro = confirmadosPelaChave(t, cfg, data, chave);
  if (!dentro.length) return 0;
  const valorC = Math.round(num(linhaCfg.valor_pessoa) * 100);
  const pags = pagamentos(t);
  const pagos = {};
  for (const p of pagamentosDaChave(t, data, chave)) if (ehValido(p)) pagos[texto(p.jogador_id)] = true;
  const saldo = {};
  for (const c of ativos) saldo[c.id] = saldoCreditoCentavos(c, pags);
  const novos = [];
  const em = agora(deps);
  for (const c of dentro) {
    const jid = String(c.jogadorId);
    if (jid === '' || pagos[jid]) continue;
    const cred = ativos.find((k) => k.jogadorId === jid && saldo[k.id] >= valorC);
    if (!cred) continue;
    saldo[cred.id] -= valorC;
    pagos[jid] = true;
    novos.push({ nome: String(c.jogadorNome || ''),
      linha: linhaPagamento(deps, { data, jogadorId: jid, jogadorNome: c.jogadorNome, valor: valorC / 100, por: SISTEMA.nome, em, tipo: 'credito', creditoId: cred.id, jogo: chave }) });
  }
  const feitos = [];
  for (const n of novos) if (await repo.inserirFinPagamento(n.linha)) feitos.push(n);
  if (!feitos.length) return 0;
  await log(deps, auth || SISTEMA, 'aplicarCreditos', { data, jogo: chave ?? undefined, quantidade: feitos.length, nomes: feitos.map((n) => n.nome) });
  return feitos.length;
}

// ---------- ações ----------
export async function salvarFinDia(deps, d, auth) {
  const { repo } = deps;
  if (!d || !dataValida(d.data)) return { error: 'Data inválida.' };
  const vp = valor(d.valorPessoa), vq = valor(d.valorQuadra), vb = valor(d.valorBrinde);
  if (vp === null || vq === null || vb === null) return { error: 'Os valores precisam ser números maiores ou iguais a zero.' };
  if (vp > MAXIMO || vq > MAXIMO || vb > MAXIMO) return { error: 'Valor alto demais (máximo 99.999.999,99).' };
  const data = String(d.data);
  const chave = Number(d.jogo) === 2 ? 2 : 1;
  const t = await repo.lerTudo();
  const diaAtual = diaDe(t, data);
  if (chave === 2 && !(diaAtual && diaAtual.por_jogo === true)) {
    return { error: 'Configure "Separado por jogo" antes de editar o 2º jogo.' };
  }
  if (chave === 1 && d.porJogo !== undefined && diaAtual && (diaAtual.por_jogo === true) !== !!d.porJogo) {
    if (t.fin_pagamentos.some((p) => texto(p.data) === data && ehValido(p))) {
      return { error: 'Já há pagamento(s) neste dia. Para trocar, use "Cancelar todos" antes.' };
    }
  }
  const temBrinde = vb > 0;
  const ic = icone(d.icone);
  const pix = String(d.pix || '').trim().slice(0, 80);
  const existenteChave = linhaConfigDaChave(t, data, chave);
  let status = '';
  let antes = null;
  if (existenteChave) {
    status = statusDia(existenteChave.status);
    antes = { valorPessoa: num(existenteChave.valor_pessoa), pix: texto(existenteChave.pix), valorQuadra: num(existenteChave.valor_quadra),
      temBrinde: existenteChave.tem_brinde === true, valorBrinde: num(existenteChave.valor_brinde), icone: icone(existenteChave.icone) };
  }
  if (chave === 2) {
    await repo.gravarFinJogo({ data, jogo: 2, valor_pessoa: vp, pix, valor_quadra: vq, tem_brinde: temBrinde, valor_brinde: vb,
      atualizado_por: nomeDe(auth), atualizado_em: agora(deps), icone: ic });
  } else {
    const linha = { data, valor_pessoa: vp, pix, valor_quadra: vq, tem_brinde: temBrinde, valor_brinde: vb,
      atualizado_por: nomeDe(auth), atualizado_em: agora(deps), icone: ic };
    if (d.porJogo !== undefined) linha.por_jogo = !!d.porJogo;
    await repo.gravarFinDia(linha);
  }
  await log(deps, auth, 'salvarFinDia', { data, jogo: chave === 2 ? 2 : undefined, antes, depois: { valorPessoa: vp, pix, valorQuadra: vq, temBrinde, valorBrinde: vb, icone: ic } });
  if (status !== 'semjogo') await aplicarCreditos(deps, data, chave === 2 ? 2 : null, auth);
  return ok(deps);
}

export async function marcarPagamento(deps, data, chaveEntrada, jogadorId, jogadorNome, auth) {
  const { repo } = deps;
  if (!dataValida(data) || !jogadorId) return { error: 'Dados do pagamento incompletos.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg || !(num(linhaCfg.valor_pessoa) > 0)) return { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' };
  if (statusDia(linhaCfg.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para marcar pagamentos.' };
  if (!confirmadosPelaChave(t, cfg, data, chave).some((c) => String(c.jogadorId) === String(jogadorId))) {
    return { error: 'Essa pessoa não está na lista de check-in deste dia.' };
  }
  const jaPago = pagamentosDaChave(t, data, chave).some((p) => texto(p.jogador_id) === String(jogadorId) && ehValido(p));
  if (jaPago) return ok(deps);
  const v = num(linhaCfg.valor_pessoa);
  const inseriu = await repo.inserirFinPagamento(linhaPagamento(deps, {
    data, jogadorId: String(jogadorId), jogadorNome, valor: v, por: nomeDe(auth), em: agora(deps), jogo: chave }));
  if (inseriu) await log(deps, auth, 'marcarPagamento', { data, jogo: chave ?? undefined, jogadorId: String(jogadorId), jogadorNome: String(jogadorNome || ''), valor: v });
  return ok(deps);
}

async function curarCredito(deps, t, r, auth) {
  if (tipoPag(r.tipo) !== 'dinheiro') return;
  const cr = creditos(t).find((c) => c.origemPagamentoId === texto(r.id) && c.status === 'ativo');
  if (!cr || saldoCreditoCentavos(cr, pagamentos(t)) < Math.round(cr.valor * 100)) return;
  if (!(await deps.repo.encerrarFinCredito(cr.id, 'devolvido', { por: nomeDe(auth), em: agora(deps) }))) return;
  const data = texto(r.data);
  const cfg = mapearConfig(t.config);
  const naLista = confirmadosPelaChave(t, cfg, data, chaveDoRegistro(r)).some((c) => String(c.jogadorId) === texto(r.jogador_id));
  await log(deps, auth, 'estornarPagamento', { data, jogo: chaveDoRegistro(r) ?? undefined, jogadorId: texto(r.jogador_id), jogadorNome: texto(r.jogador_nome), valor: num(r.valor),
    motivo: naLista ? 'correção de marcação' : 'pessoa fora da lista', creditoDevolvido: cr.id });
}

export async function estornarPagamento(deps, id, auth) {
  const { repo } = deps;
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const r = pagamentos(t).find((p) => texto(p.id) === String(id));
  if (!r) return { error: 'Pagamento não encontrado.' };
  const chave = chaveDoRegistro(r);
  if (!ehValido(r)) { await curarCredito(deps, t, r, auth); return ok(deps); }
  const data = texto(r.data);
  const tipo = tipoPag(r.tipo);
  const naLista = confirmadosPelaChave(t, cfg, data, chave).some((c) => String(c.jogadorId) === texto(r.jogador_id));
  if (tipo === 'dinheiro' && !naLista && auth.perfil !== 'admin') {
    return { error: 'Seu perfil (' + auth.perfil + ') não tem permissão para estornar o pagamento de quem não está entre os confirmados. Peça ao admin.' };
  }
  let cr = null;
  if (tipo === 'dinheiro') {
    cr = creditos(t).find((c) => c.origemPagamentoId === texto(r.id) && c.status === 'ativo') || null;
    if (cr && saldoCreditoCentavos(cr, pagamentos(t)) < Math.round(cr.valor * 100)) {
      return { error: 'Este pagamento virou crédito e já foi usado em outro dia; não dá para estornar. Desmarque o pagamento por crédito primeiro.' };
    }
  }
  const quando = { por: nomeDe(auth), em: agora(deps) };
  if (!(await repo.estornarFinPagamento(texto(r.id), quando))) { await curarCredito(deps, await repo.lerTudo(), r, auth); return ok(deps); }
  let creditoDevolvido = '';
  if (cr) { await repo.encerrarFinCredito(cr.id, 'devolvido', quando); creditoDevolvido = cr.id; }
  await log(deps, auth, 'estornarPagamento', { data, jogo: chave ?? undefined, jogadorId: texto(r.jogador_id), jogadorNome: texto(r.jogador_nome), valor: num(r.valor),
    motivo: tipo === 'credito' ? 'crédito devolvido ao saldo' : (naLista ? 'correção de marcação' : 'pessoa fora da lista'),
    creditoDevolvido });
  return ok(deps);
}

export async function marcarTodosPagamentos(deps, data, chaveEntrada, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg || !(num(linhaCfg.valor_pessoa) > 0)) return { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' };
  if (statusDia(linhaCfg.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para marcar pagamentos.' };
  const v = num(linhaCfg.valor_pessoa);
  const dentro = confirmadosPelaChave(t, cfg, data, chave);
  const jaPagos = {};
  for (const p of pagamentosDaChave(t, data, chave)) if (ehValido(p)) jaPagos[texto(p.jogador_id)] = true;
  const novos = dentro.filter((c) => !jaPagos[String(c.jogadorId)]);
  if (!novos.length) return ok(deps);
  const em = agora(deps), nome = nomeDe(auth);
  const feitos = [];
  for (const c of novos) {
    if (await repo.inserirFinPagamento(linhaPagamento(deps, { data, jogadorId: String(c.jogadorId), jogadorNome: c.jogadorNome, valor: v, por: nome, em, jogo: chave }))) feitos.push(c);
  }
  if (feitos.length) {
    await log(deps, auth, 'marcarTodosPagamentos', { data, jogo: chave ?? undefined, quantidade: feitos.length, valorCada: v, nomes: feitos.map((c) => String(c.jogadorNome || '')) });
  }
  return ok(deps);
}

export async function estornarTodosPagamentos(deps, data, chaveEntrada, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (linhaCfg && statusDia(linhaCfg.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para cancelar pagamentos em massa.' };
  const dentroIds = {};
  for (const c of confirmadosPelaChave(t, cfg, data, chave)) dentroIds[String(c.jogadorId)] = true;
  const ehAdmin = auth.perfil === 'admin';
  const quando = { por: nomeDe(auth), em: agora(deps) };
  const estornados = [], ignorados = [];
  for (const r of pagamentosDaChave(t, data, chave)) {
    if (!texto(r.id) || !ehValido(r)) continue;
    const naLista = !!dentroIds[texto(r.jogador_id)];
    const quem = { jogadorNome: texto(r.jogador_nome), valor: num(r.valor) };
    if (tipoPag(r.tipo) === 'dinheiro' && !naLista && !ehAdmin) { ignorados.push(quem); continue; }
    if (await repo.estornarFinPagamento(texto(r.id), quando)) estornados.push(quem);
  }
  if (estornados.length || ignorados.length) {
    await log(deps, auth, 'estornarTodosPagamentos', { data, jogo: chave ?? undefined, quantidade: estornados.length,
      nomes: estornados.map((q) => q.jogadorNome), total: estornados.reduce((s, q) => s + q.valor, 0),
      ignoradosForaDaLista: ignorados.map((q) => q.jogadorNome) });
  }
  const resp = await ok(deps);
  resp.estornados = estornados.length;
  resp.ignorados = ignorados.length;
  return resp;
}

export async function addLancamento(deps, l, auth) {
  const { repo } = deps;
  if (!l || !dataValida(l.data)) return { error: 'Data inválida.' };
  if (l.tipo !== 'entrada' && l.tipo !== 'saida') return { error: 'Tipo inválido (use entrada ou saída).' };
  const v = valor(l.valor);
  if (v === null || v <= 0) return { error: 'O valor precisa ser maior que zero.' };
  if (v > MAXIMO) return { error: 'Valor alto demais (máximo 99.999.999,99).' };
  const descricao = String(l.descricao || '').trim().slice(0, 120);
  if (!descricao) return { error: 'Descreva o lançamento.' };
  await repo.inserirFinLancamento({ id: gerarId(deps), data: String(l.data), tipo: l.tipo, descricao, valor: v,
    criado_por: nomeDe(auth), criado_em: agora(deps), estornado: false, estornado_por: null, estornado_em: null });
  await log(deps, auth, 'addLancamento', { data: l.data, tipo: l.tipo, descricao, valor: v });
  return ok(deps);
}

export async function estornarLancamento(deps, id, auth) {
  const { repo } = deps;
  const r = (await repo.lerTudo()).fin_lancamentos.slice().sort(porOrdem).find((x) => texto(x.id) === String(id));
  if (!r) return { error: 'Lançamento não encontrado.' };
  if (r.estornado === true) return ok(deps);
  if (!(await repo.estornarFinLancamento(texto(r.id), { por: nomeDe(auth), em: agora(deps) }))) return ok(deps);
  await log(deps, auth, 'estornarLancamento', { data: texto(r.data), tipo: texto(r.tipo), descricao: texto(r.descricao), valor: num(r.valor) });
  return ok(deps);
}

// ====================== dia sem jogo, crédito e ganchos do check-in ======================

async function aplicarCreditosEmTodasAsChaves(deps, data, auth) {
  const t = await deps.repo.lerTudo();
  const cfg = mapearConfig(t.config);
  let n = 0;
  for (const chave of chavesDaData(t, cfg, data)) n += await aplicarCreditos(deps, data, chave, auth);
  return n;
}
async function aplicarCreditosFuturos(deps, dataOrigem, auth) {
  const t0 = await deps.repo.lerTudo();
  const datas = Array.from(new Set([...t0.fin_dias.map((d) => texto(d.data)), ...(t0.fin_jogos || []).map((j) => texto(j.data))]))
    .filter((d) => d > dataOrigem).sort();
  let n = 0;
  for (const d of datas) n += await aplicarCreditosEmTodasAsChaves(deps, d, auth);
  return n;
}

export async function marcarDiaSemJogo(deps, data, chaveEntrada, destino, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg) return { error: 'Configure o dia (valor por pessoa etc.) antes de marcá-lo como sem jogo.' };
  const resposta = async (creditosCriados, estornados, ignorados) => {
    const r = await ok(deps);
    r.creditos = creditosCriados; r.estornados = estornados; r.ignorados = ignorados;
    return r;
  };
  const repeticao = statusDia(linhaCfg.status) === 'semjogo';
  const modo = destino === 'devolver' ? 'devolver' : 'credito';
  if (!repeticao) {
    if (chave === 2) await repo.definirStatusFinJogo(data, 2, 'semjogo'); else await repo.definirStatusFinDia(data, 'semjogo');
  }
  const dentroIds = {};
  for (const c of confirmadosPelaChave(t, cfg, data, chave)) dentroIds[String(c.jogadorId)] = true;
  const ehAdmin = auth.perfil === 'admin';
  const em = agora(deps), nome = nomeDe(auth);
  const quando = { por: nome, em };
  const ativos = creditos(t).filter((c) => c.status === 'ativo');
  const nomes = [];
  let criados = 0, estornados = 0, ignorados = 0, mudou = false;
  for (const p of pagamentosDaChave(t, data, chave)) {
    if (!texto(p.id) || !ehValido(p)) continue;
    if (tipoPag(p.tipo) === 'credito') {
      if (await repo.estornarFinPagamento(texto(p.id), quando)) mudou = true;
      continue;
    }
    if (modo === 'devolver') {
      if (repeticao && ativos.some((c) => c.origemPagamentoId === texto(p.id))) continue;
      if (!dentroIds[texto(p.jogador_id)] && !ehAdmin) { ignorados++; continue; }
      await repo.estornarFinPagamento(texto(p.id), quando);
      mudou = true;
      estornados++; nomes.push(texto(p.jogador_nome));
      continue;
    }
    if (ativos.some((c) => c.origemPagamentoId === texto(p.id))) continue;
    await repo.inserirFinCredito({ id: gerarId(deps), jogador_id: texto(p.jogador_id) || null, jogador_nome: texto(p.jogador_nome),
      valor: num(p.valor), origem_pagamento_id: texto(p.id), data_origem: data, criado_por: nome, criado_em: em,
      status: 'ativo', encerrado_por: null, encerrado_em: null, jogo_origem: chave });
    mudou = true;
    criados++; nomes.push(texto(p.jogador_nome));
  }
  if (repeticao && !mudou) return resposta(0, 0, 0);
  await log(deps, auth, 'marcarDiaSemJogo', { data, jogo: chave ?? undefined, destino: modo, creditos: criados, estornados, ignorados, nomes });
  if (criados) await aplicarCreditosFuturos(deps, data, auth);
  return resposta(criados, estornados, ignorados);
}

export async function reabrirDia(deps, data, chaveEntrada, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg) return { error: 'Dia não encontrado.' };
  if (statusDia(linhaCfg.status) !== 'semjogo') return ok(deps);
  const pags = pagamentos(t);
  const doDia = creditos(t).filter((c) => c.dataOrigem === data && c.status === 'ativo' && c.jogoOrigem === chave);
  const usados = doDia.filter((c) => saldoCreditoCentavos(c, pags) < Math.round(c.valor * 100));
  if (usados.length) return { error: 'Não dá para reabrir: ' + usados.length + ' crédito(s) deste dia já foram usados em outro dia.' };
  const quando = { por: nomeDe(auth), em: agora(deps) };
  for (const c of doDia) await repo.encerrarFinCredito(c.id, 'cancelado', quando);
  if (chave === 2) await repo.definirStatusFinJogo(data, 2, 'normal'); else await repo.definirStatusFinDia(data, 'normal');
  await log(deps, auth, 'reabrirDia', { data, jogo: chave ?? undefined, creditosCancelados: doDia.length });
  await aplicarCreditos(deps, data, chave, auth);
  return ok(deps);
}

export async function aplicarCreditosDoDia(deps, data, auth) {
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const n = await aplicarCreditosEmTodasAsChaves(deps, data, auth);
  const r = await ok(deps);
  r.aplicados = n;
  return r;
}

export async function devolverCredito(deps, id, auth) {
  const { repo } = deps;
  const t = await repo.lerTudo();
  const c = creditos(t).find((k) => k.id === String(id));
  if (!c) return { error: 'Crédito não encontrado.' };
  if (c.status === 'devolvido') {
    const orig = pagamentos(t).find((p) => texto(p.id) === c.origemPagamentoId);
    if (orig && ehValido(orig) && await repo.estornarFinPagamento(texto(orig.id), { por: nomeDe(auth), em: agora(deps) })) {
      await log(deps, auth, 'devolverCredito', { jogadorNome: c.jogadorNome, valor: c.valor, dataOrigem: c.dataOrigem });
    }
    return ok(deps);
  }
  if (c.status !== 'ativo') return { error: 'Este crédito não está ativo.' };
  if (saldoCreditoCentavos(c, pagamentos(t)) < Math.round(c.valor * 100)) {
    return { error: 'Este crédito já foi usado (total ou parcialmente); não dá para devolver o dinheiro.' };
  }
  const quando = { por: nomeDe(auth), em: agora(deps) };
  if (!(await repo.encerrarFinCredito(c.id, 'devolvido', quando))) return ok(deps);
  const origem = pagamentos(t).find((p) => texto(p.id) === c.origemPagamentoId);
  if (origem && ehValido(origem)) await repo.estornarFinPagamento(texto(origem.id), quando);
  await log(deps, auth, 'devolverCredito', { jogadorNome: c.jogadorNome, valor: c.valor, dataOrigem: c.dataOrigem });
  return ok(deps);
}

// ---------- ganchos do check-in: NUNCA podem quebrar o check-in, então engolem qualquer erro ----------
function avisar(deps, onde, erro) {
  try { if (typeof deps.avisar === 'function') deps.avisar(onde + ': ' + (erro && erro.message ? erro.message : erro)); } catch { /* nada */ }
}

// roda em TODAS as chaves do dia (1 no único; 1 e 2 no separado) — idempotente, então não faz mal rodar à toa
export async function aposAdicionarCheckin(deps, data) {
  try { await aplicarCreditosEmTodasAsChaves(deps, String(data), SISTEMA); } catch (e) { avisar(deps, 'aposAdicionarCheckin', e); }
}

// para cada chave do dia: se a pessoa NÃO está mais confirmada nela (saiu de verdade daquela cobrança — no único,
// continuar no outro jogo CONTA como ainda confirmada, então nada é devolvido), devolve o crédito usado lá
export async function aposRemoverCheckin(deps, data, jogadorId) {
  try {
    const { repo } = deps;
    const t = await repo.lerTudo();
    const cfg = mapearConfig(t.config);
    const quando = { por: SISTEMA.nome, em: agora(deps) };
    let devolvidos = 0;
    for (const chave of chavesDaData(t, cfg, data)) {
      const aindaDentro = confirmadosPelaChave(t, cfg, data, chave).some((c) => String(c.jogadorId) === String(jogadorId));
      if (aindaDentro) continue;
      for (const p of pagamentosDaChave(t, data, chave)) {
        if (!texto(p.id) || !ehValido(p) || texto(p.jogador_id) !== String(jogadorId) || tipoPag(p.tipo) !== 'credito') continue;
        if (await repo.estornarFinPagamento(texto(p.id), quando)) devolvidos++;
      }
    }
    if (devolvidos) {
      await log(deps, SISTEMA, 'estornarPagamento', { data, jogadorId: String(jogadorId),
        motivo: 'saiu da lista: crédito devolvido ao saldo', quantidade: devolvidos });
    }
    await aplicarCreditosEmTodasAsChaves(deps, data, SISTEMA);
  } catch (e) { avisar(deps, 'aposRemoverCheckin', e); }
}
```

- [ ] **Step 4: Atualizar as assinaturas nos testes já existentes**

Em `tests/backend/financeiro.test.mjs` e `tests/backend/financeiro-4b.test.mjs`, toda chamada às funções que ganharam `chave` precisa inserir `null` na posição certa (comportamento "do dia", idêntico ao de hoje):

```bash
grep -n "aplicarCreditos(\|marcarPagamento(\|marcarTodosPagamentos(\|estornarTodosPagamentos(\|marcarDiaSemJogo(\|reabrirDia(" tests/backend/financeiro.test.mjs tests/backend/financeiro-4b.test.mjs
```

Para cada ocorrência, inserir `null,` logo depois do argumento `data`:
- `aplicarCreditos(d, '2026-09-29', ORG)` → `aplicarCreditos(d, '2026-09-29', null, ORG)`
- `marcarPagamento(d, '2026-09-22', 'p3', 'Carla', ORG)` → `marcarPagamento(d, '2026-09-22', null, 'p3', 'Carla', ORG)`
- `marcarTodosPagamentos(d, '2026-09-22', ORG)` → `marcarTodosPagamentos(d, '2026-09-22', null, ORG)`
- `estornarTodosPagamentos(d, '2026-09-22', ADM)` → `estornarTodosPagamentos(d, '2026-09-22', null, ADM)`
- `marcarDiaSemJogo(d, '2026-09-15', 'credito', ORG)` → `marcarDiaSemJogo(d, '2026-09-15', null, 'credito', ORG)`
- `reabrirDia(d, '2026-09-15', ADM)` → `reabrirDia(d, '2026-09-15', null, ADM)`

(editar cada ocorrência encontrada pelo grep do Step anterior; `estornarPagamento`, `salvarFinDia`, `addLancamento`, `estornarLancamento`, `devolverCredito`, `aplicarCreditosDoDia` **não mudam** nessas duas suítes).

- [ ] **Step 5: Rodar os dois arquivos de teste existentes e corrigir até passar**

Run: `node tests/backend/financeiro.test.mjs && node tests/backend/financeiro-4b.test.mjs`
Expected: `TODOS OS TESTES PASSARAM` nos dois (se algum call site ficou pra trás, o teste falha com um erro claro de asserção — voltar ao Step 4 e corrigi-lo).

- [ ] **Step 6: Rodar o teste novo**

Run: `node tests/backend/financeiro-dois-jogos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 7: Rodar a suíte inteira do backend**

Run: `npm run test:backend`
Expected: tudo `ok`. Prestar atenção especial em `tests/backend/handler-etapa4a.test.mjs`, `handler-etapa4b.test.mjs` e `paridade-financeiro*.test.mjs` (chamam as funções através do `handler.js`, que só é atualizado na Task 9 — se esses arquivos falharem agora com "chave não é número" ou parecido, é porque chamam `financeiro.js` direto com a assinatura antiga; aplicar o mesmo ajuste do Step 4 a eles também).

- [ ] **Step 8: Registrar o teste novo no `package.json`** (depois de `node tests/backend/financeiro-4b.test.mjs &&`)

- [ ] **Step 9: Commit**

```bash
git add backend/financeiro.js tests/backend/financeiro.test.mjs tests/backend/financeiro-4b.test.mjs tests/backend/financeiro-dois-jogos.test.mjs package.json
git commit -m "backend: financeiro.js com chave de cobrança (null=dia, 1/2=jogo) — único e separado"
```

---

### Task 8: `backend/jogos2.js` (novo) — criar/editar/remover o 2º jogo; guarda contra horário igual

**Files:**
- Create: `backend/jogos2.js`
- Modify: `backend/configuracoes.js`
- Test: `tests/backend/jogos2.test.mjs` (novo)

**Interfaces:**
- Consumes: `repo.lerConfig`, `repo.gravarConfig` (já existem); `repo.moverJogo2ParaJogo1`, `repo.gravarFinDia` (Task 3/4); `mapearConfig` (Task 5).
- Produces: `salvarJogo2(deps, jogo2, auth)` → `{status:'ok'}` ou `{error}`; `removerJogo2(deps, {data, destino, manter}, auth)` → `{status:'ok'}` ou `{error}`. `handler.js` (Task 9) liga as duas a `salvarJogo2`/`removerJogo2`.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// tests/backend/jogos2.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { saveSettings } from '../../backend/configuracoes.js';
import { salvarJogo2, removerJogo2 } from '../../backend/jogos2.js';
import { mapearConfig, mapearCheckins } from '../../backend/mapeadores.js';

const ORG = { perfil: 'organizador', nome: 'Org', email: 'o@x.com', viaChaveMestra: false };
const DATA = '2026-10-06';

function ambiente(extra) {
  return {
    repo: criarRepoMemoria({
      config: [{ chave: 'checkinDataAberta', valor: DATA }, { chave: 'checkinHorario', valor: '19:00' }, { chave: 'checkinVagas', valor: '16' }],
      checkins: [], fin_dias: [], fin_jogos: [], fin_pagamentos: [],
      ...extra
    }),
    relogio: () => new Date('2026-10-06T12:00:00.000Z')
  };
}
const cfg = async (d) => mapearConfig(await d.repo.lerConfig());

await ta('salvarJogo2: cria com sucesso; recusa data fechada, horário igual, vagas inválidas', async () => {
  const d = ambiente();
  assert.deepEqual(await salvarJogo2(d, { data: '2026-10-13', horario: '21:00', vagas: 12 }, ORG),
    { error: 'Abra o check-in para essa data antes de adicionar o 2º jogo.' });
  assert.deepEqual(await salvarJogo2(d, { data: DATA, horario: '19:00', vagas: 12 }, ORG), { error: 'Os dois jogos não podem ter o mesmo horário.' });
  assert.deepEqual(await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 0 }, ORG), { error: 'Vagas precisam ser maior que zero.' });
  assert.deepEqual(await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG), { status: 'ok' });
  assert.deepEqual((await cfg(d)).checkinJogo2, { data: DATA, horario: '21:00', vagas: 12, travado: false });
});

await ta('saveSettings: recusa deixar o horário do jogo 1 igual ao do jogo 2 já configurado', async () => {
  const d = ambiente();
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  const r = await saveSettings(d, { checkinDataAberta: DATA, checkinHorario: '21:00', checkinVagas: 16, estrelasVisiveis: true, checkinTravado: false });
  assert.deepEqual(r, { error: 'Os dois jogos não podem ter o mesmo horário.' });
  assert.equal((await cfg(d)).checkinHorario, '19:00'); // não gravou nada
});

await ta('removerJogo2: "mover" leva a lista pro jogo 1 e some com o 2º jogo', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
    { id: 'c2', data: DATA, jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 2, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  assert.deepEqual(await removerJogo2(d, { data: DATA, destino: 'mover' }, ORG), { status: 'ok' });
  assert.equal((await cfg(d)).checkinJogo2, null);
  const lista = mapearCheckins((await d.repo.lerTudo()).checkins);
  assert.deepEqual(lista.map((c) => [c.jogadorId, c.jogo]), [['p1', 1], ['p2', 1]]);
});

await ta('removerJogo2: "desconfirmar" apaga os check-ins do jogo 2', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
    { id: 'c2', data: DATA, jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 2, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await removerJogo2(d, { data: DATA, destino: 'desconfirmar' }, ORG);
  const lista = mapearCheckins((await d.repo.lerTudo()).checkins);
  assert.deepEqual(lista.map((c) => c.jogadorId), ['p1']);
});

await ta('removerJogo2: bloqueado com pagamento válido amarrado só ao jogo 2 (modo separado)', async () => {
  const d = ambiente();
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await d.repo.gravarFinDia({ data: DATA, valor_pessoa: 15, pix: '', valor_quadra: 300, tem_brinde: false, valor_brinde: 0, status: 'normal', por_jogo: true });
  await d.repo.inserirFinPagamento({ id: 'pg1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, marcado_por: 'Org', marcado_em: 'x', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, jogo: 2 });
  const r = await removerJogo2(d, { data: DATA, destino: 'mover' }, ORG);
  assert.match(r.error, /pagamento/);
});

await ta('removerJogo2 com manter:2 — "trocar os papéis": jogo 1 vira a config do jogo 2', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await removerJogo2(d, { data: DATA, destino: 'mover', manter: 2 }, ORG);
  const c = await cfg(d);
  assert.deepEqual({ h: c.checkinHorario, v: c.checkinVagas, j2: c.checkinJogo2 }, { h: '21:00', v: 12, j2: null });
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/jogos2.test.mjs`
Expected: FALHA — `backend/jogos2.js` ainda não existe.

- [ ] **Step 3: Criar `backend/jogos2.js`**

```js
// Criar/editar e remover o 2º jogo do dia (dois jogos no mesmo dia, 2026-10-03). O 2º jogo vive só em 4 chaves de
// `config` (checkinJogo2Data/Horario/Vagas/Travado); "existe" quando checkinJogo2Data bate com checkinDataAberta.
// Spec: docs/superpowers/specs/2026-10-03-dois-jogos-no-mesmo-dia-design.md
import { texto, mapearConfig } from './mapeadores.js';

function dataValida(s) {
  const v = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '0001-01-01') return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const horarioValido = (s) => /^\d{2}:\d{2}$/.test(String(s || ''));
const agora = (deps) => (deps.relogio ? deps.relogio() : new Date()).toISOString();
const nomeDe = (auth) => auth.nome || (auth.viaChaveMestra ? 'Chave mestra' : (auth.email || 'Desconhecido'));

export async function salvarJogo2(deps, jogo2, auth) {
  const { repo } = deps;
  if (!jogo2 || !dataValida(jogo2.data)) return { error: 'Data inválida.' };
  if (!horarioValido(jogo2.horario)) return { error: 'Horário inválido.' };
  const vagas = Number(jogo2.vagas);
  if (!(vagas > 0)) return { error: 'Vagas precisam ser maior que zero.' };
  const cfg = mapearConfig(await repo.lerConfig());
  if (cfg.checkinDataAberta !== texto(jogo2.data)) return { error: 'Abra o check-in para essa data antes de adicionar o 2º jogo.' };
  if (texto(jogo2.horario) === cfg.checkinHorario) return { error: 'Os dois jogos não podem ter o mesmo horário.' };
  await repo.gravarConfig([
    { chave: 'checkinJogo2Data', valor: texto(jogo2.data) },
    { chave: 'checkinJogo2Horario', valor: texto(jogo2.horario) },
    { chave: 'checkinJogo2Vagas', valor: String(vagas) },
    { chave: 'checkinJogo2Travado', valor: jogo2.travado ? 'TRUE' : 'FALSE' }
  ]);
  return { status: 'ok' };
}

// destino: 'mover' (leva a lista do jogo 2 pro fim da fila do 1) ou 'desconfirmar' (apaga os check-ins do jogo 2).
// manter: 2 — "trocar os papéis": usado quando quem está sendo removido é o jogo 1 (o app sempre chama esta mesma
// ação; com manter:2, depois de mover a lista, a configuração que SOBREVIVE no lugar do jogo 1 é a do jogo 2).
export async function removerJogo2(deps, { data, destino, manter } = {}, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const cfg = mapearConfig(await repo.lerConfig());
  if (!cfg.checkinJogo2 || texto(cfg.checkinJogo2.data) !== texto(data)) return { error: 'Não há um 2º jogo configurado para essa data.' };
  const t = await repo.lerTudo();
  const dia = (t.fin_dias || []).find((d) => texto(d.data) === texto(data));
  const porJogo = !!(dia && dia.por_jogo === true);
  const jogo2Fin = (t.fin_jogos || []).find((j) => texto(j.data) === texto(data) && Number(j.jogo) === 2) || null;
  if (porJogo && t.fin_pagamentos.some((p) => texto(p.data) === texto(data) && Number(p.jogo) === 2 && p.estornado !== true)) {
    return { error: 'O jogo das ' + cfg.checkinJogo2.horario + ' tem pagamento(s) só dele. Cancele-os (ou marque como sem jogo) antes de remover.' };
  }
  if (destino === 'mover') {
    await repo.moverJogo2ParaJogo1(data);
  } else {
    for (const c of t.checkins.filter((c) => c.data === texto(data) && (Number(c.jogo) || 1) === 2)) {
      await repo.removerCheckin(texto(c.id));
    }
  }
  if (manter === 2) {
    await repo.gravarConfig([
      { chave: 'checkinHorario', valor: cfg.checkinJogo2.horario },
      { chave: 'checkinVagas', valor: String(cfg.checkinJogo2.vagas) },
      { chave: 'checkinTravado', valor: cfg.checkinJogo2.travado ? 'TRUE' : 'FALSE' }
    ]);
    if (porJogo && jogo2Fin) {
      await repo.gravarFinDia({
        data, valor_pessoa: Number(jogo2Fin.valor_pessoa) || 0, pix: jogo2Fin.pix || '', valor_quadra: Number(jogo2Fin.valor_quadra) || 0,
        tem_brinde: jogo2Fin.tem_brinde === true, valor_brinde: Number(jogo2Fin.valor_brinde) || 0, icone: jogo2Fin.icone || '✅',
        status: jogo2Fin.status || 'normal', atualizado_por: nomeDe(auth), atualizado_em: agora(deps)
      });
    }
  }
  await repo.gravarConfig([
    { chave: 'checkinJogo2Data', valor: '' }, { chave: 'checkinJogo2Horario', valor: '' },
    { chave: 'checkinJogo2Vagas', valor: '' }, { chave: 'checkinJogo2Travado', valor: 'FALSE' }
  ]);
  if (porJogo) await repo.gravarFinDia({ data, por_jogo: false });
  return { status: 'ok' };
}
```

- [ ] **Step 4: Adicionar a guarda de horário em `backend/configuracoes.js`**

```js
// Configurações do app. Port de saveSettingsAction/writeSettings de apps-script-codigo.gs: as 7 chaves, com a mesma
// formatação (TRUE/FALSE, valores padrão). O contador de acessos nunca é tocado por uma gravação de configuração
// (o navegador do admin pode ter um valor desatualizado): desde a etapa 5 ele pertence só à função incrementar_acesso do banco,
// e reler-e-regravar o contador aqui, sob a trava, disputaria com a soma atômica que não usa trava.
// Dois jogos no mesmo dia (2026-10-03): esta função NUNCA toca nas chaves checkinJogo2* (só salvarJogo2/removerJogo2
// mexem nelas — ver backend/jogos2.js) e recusa deixar o horário do jogo 1 igual ao do 2º jogo já configurado.
import { texto, CHECKIN_MENSAGEM_PADRAO, mapearConfig } from './mapeadores.js';

export async function saveSettings({ repo }, settings) {
  const s = settings || {};
  const horario = String(s.checkinHorario || '20:00');
  const dataAberta = texto(s.checkinDataAberta);
  const atual = mapearConfig(await repo.lerConfig());
  if (dataAberta && atual.checkinJogo2 && texto(atual.checkinJogo2.data) === dataAberta && atual.checkinJogo2.horario === horario) {
    return { error: 'Os dois jogos não podem ter o mesmo horário.' };
  }
  await repo.gravarConfig([
    { chave: 'estrelasVisiveis', valor: s.estrelasVisiveis ? 'TRUE' : 'FALSE' },
    { chave: 'checkinDataAberta', valor: dataAberta },
    { chave: 'checkinTravado', valor: s.checkinTravado ? 'TRUE' : 'FALSE' },
    { chave: 'checkinVagas', valor: String(s.checkinVagas || 16) },
    { chave: 'checkinHorario', valor: horario },
    { chave: 'checkinMensagemTemplate', valor: String(s.checkinMensagemTemplate || CHECKIN_MENSAGEM_PADRAO) }
  ]);
  return { status: 'ok' };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node tests/backend/jogos2.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 6: Rodar a suíte inteira do backend**

Run: `npm run test:backend`
Expected: tudo `ok` (conferir especialmente `tests/backend/jogadores-config.test.mjs`, que já testa `saveSettings` — a nova guarda só reage quando existe `checkinJogo2`, então os casos de 1 jogo continuam idênticos).

- [ ] **Step 7: Registrar o teste novo no `package.json`** (depois de `node tests/backend/jogadores-config.test.mjs &&`)

- [ ] **Step 8: Commit**

```bash
git add backend/jogos2.js backend/configuracoes.js tests/backend/jogos2.test.mjs package.json
git commit -m "backend: criar/remover o 2º jogo (salvarJogo2/removerJogo2) + trava de horário igual"
```

---

### Task 9: `handler.js` + `permissoes.js` — ligar as ações novas

**Files:**
- Modify: `backend/handler.js`
- Modify: `backend/permissoes.js`
- Test: `tests/backend/handler-dois-jogos.test.mjs` (novo)

**Interfaces:**
- Consumes: `moverCheckin` (Task 6), `salvarJogo2`/`removerJogo2` (Task 8), as novas assinaturas de `financeiro.js` (Task 7).
- Produces: `POST { action: 'moverCheckin' | 'salvarJogo2' | 'removerJogo2', ... }` funcionando fim-a-fim; `POST` das ações do financeiro aceitando `jogo: null|1|2` no corpo.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// tests/backend/handler-dois-jogos.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const DATA = '2026-10-06';
function handler(extra) {
  return criarHandler({
    repo: criarRepoMemoria({
      jogadores: [{ id: 'p1', nome: 'Ana', convidado: false, removido: false, ordem: 1 }],
      config: [{ chave: 'checkinDataAberta', valor: DATA }, { chave: 'checkinHorario', valor: '19:00' }, { chave: 'checkinVagas', valor: '16' }],
      checkins: [], fin_dias: [], fin_jogos: [], fin_pagamentos: [],
      ...extra
    }),
    config: { adminPassword: 'senha-teste' },
    relogio: () => new Date('2026-10-06T12:00:00.000Z')
  });
}
const pingAdmin = { action: 'ping', senha: 'senha-teste' };

await ta('salvarJogo2/removerJogo2/moverCheckin exigem organizador/admin (recusa jogador)', async () => {
  const h = handler();
  const semPerfil = await h.post({ action: 'salvarJogo2', jogo2: { data: DATA, horario: '21:00', vagas: 12 } });
  assert.ok(semPerfil.error);
});

await ta('fluxo completo: criar o 2º jogo, confirmar presença nos dois, mover um, GET reflete tudo', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ ...pingAdmin, action: 'salvarJogo2', jogo2: { data: DATA, horario: '21:00', vagas: 12 } }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'addCheckin', checkin: { id: 'c1', data: DATA, jogadorId: 'p1', jogo: 1 } }), { status: 'ok' });
  const mov = await h.post({ ...pingAdmin, action: 'moverCheckin', id: 'c1', paraJogo: 2 });
  assert.deepEqual(mov, { status: 'ok', moveu: true });
  const get = await h.get();
  assert.equal(get.settings.checkinJogo2.horario, '21:00');
  assert.equal(get.checkins.find((c) => c.id === 'c1').jogo, 2);
});

await ta('financeiro: jogo no corpo do POST vira a chave certa (1/2/null)', async () => {
  const h = handler({ checkins: [{ id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 }] });
  await h.post({ ...pingAdmin, action: 'salvarJogo2', jogo2: { data: DATA, horario: '21:00', vagas: 12 } });
  await h.post({ ...pingAdmin, action: 'salvarFinDia', dia: { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true } });
  await h.post({ ...pingAdmin, action: 'salvarFinDia', dia: { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: '' } });
  const r = await h.post({ ...pingAdmin, action: 'marcarPagamento', data: DATA, jogo: 1, jogadorId: 'p1', jogadorNome: 'Ana' });
  assert.equal(r.financeiro.pagamentos[0].jogo, 1);
  assert.equal(r.financeiro.pagamentos[0].valor, 15);
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/handler-dois-jogos.test.mjs`
Expected: FALHA — `naoDisponivel` para `salvarJogo2`/`moverCheckin`/`removerJogo2`.

- [ ] **Step 3: Atualizar os imports em `backend/handler.js`**

```js
import { addCheckin, removeCheckin, salvarEstrelasAjustadas, moverCheckin } from './checkins.js';
import { salvarJogo2, removerJogo2 } from './jogos2.js';
```

(as demais linhas de import continuam iguais)

- [ ] **Step 4: Trocar as linhas do financeiro no `switch` e acrescentar as três ações novas**

Trocar o bloco (dentro de `async post(body, contexto = {})`, depois de `const auth = await autorizar(...)`):

```js
        switch (acao) {
          case 'ping': return { status: 'ok', perfil: auth.perfil, viaChaveMestra: !!auth.viaChaveMestra };
          case 'listarUsuarios': return await listarUsuarios(deps, auth.perfil);
          case 'salvarUsuario': return await salvarUsuario(deps, b.usuario);
          case 'removerUsuario': return await removerUsuario(deps, b.email);
          case 'solicitarVinculo': return await solicitarVinculo(deps, auth, b.jogadorId);
          case 'aprovarVinculo': return await aprovarVinculo(deps, b.email, b.jogadorId);
          case 'rejeitarVinculo': return await rejeitarVinculo(deps, b.email);
          case 'uploadPhoto': return await uploadPhoto(deps, auth, b);
          case 'addPlayer': return await addPlayer(deps, b.player);
          case 'updatePlayer': return await updatePlayer(deps, b.player);
          case 'removePlayer': return await removePlayer(deps, b.id);
          case 'restorePlayer': return await restorePlayer(deps, b.id);
          case 'addRound': return await addRound(deps, b.round);
          case 'updateRound': return await updateRound(deps, b.round);
          case 'removeRound': return await removeRound(deps, b.id);
          case 'saveSettings':
          case 'saveCheckinSettings': return await saveSettings(deps, b.settings);
          case 'salvarEstrelasAjustadas': return await salvarEstrelasAjustadas(deps, b.checkins);
          // dois jogos no mesmo dia (2026-10-03): b.jogo vindo do app é 1, 2 ou ausente/null — normaliza pra "chave de
          // cobrança" (null = o dia; 1/2 = um jogo) antes de chamar o financeiro
          case 'moverCheckin': return await travar(() => moverCheckin(deps, b, auth));
          case 'salvarJogo2': return await travar(() => salvarJogo2(deps, b.jogo2, auth));
          case 'removerJogo2': return await travar(() => removerJogo2(deps, b, auth));
          // controle financeiro (etapas 4a e 4b): toda gravação sob a trava 'gravacao'
          case 'salvarFinDia': return await travar(() => salvarFinDia(deps, b.dia, auth));
          case 'marcarPagamento': return await travar(() => marcarPagamento(deps, b.data, chaveDe(b), b.jogadorId, b.jogadorNome, auth));
          case 'estornarPagamento': return await travar(() => estornarPagamento(deps, b.id, auth));
          case 'marcarTodosPagamentos': return await travar(() => marcarTodosPagamentos(deps, b.data, chaveDe(b), auth));
          case 'estornarTodosPagamentos': return await travar(() => estornarTodosPagamentos(deps, b.data, chaveDe(b), auth));
          case 'addLancamento': return await travar(() => addLancamento(deps, b.lancamento, auth));
          case 'estornarLancamento': return await travar(() => estornarLancamento(deps, b.id, auth));
          case 'marcarDiaSemJogo': return await travar(() => marcarDiaSemJogo(deps, b.data, chaveDe(b), b.destino, auth));
          case 'reabrirDia': return await travar(() => reabrirDia(deps, b.data, chaveDe(b), auth));
          case 'aplicarCreditosDoDia': return await travar(() => aplicarCreditosDoDia(deps, b.data, auth));
          case 'devolverCredito': return await travar(() => devolverCredito(deps, b.id, auth));
          // Ao Vivo (etapa 5): o .gs segurava a trava nas três
          case 'iniciarTransmissaoAoVivo': return await travar(() => iniciarTransmissaoAoVivo(deps, b.roundId, b.duracaoMinutos));
          case 'salvarParcialAoVivo': return await travar(() => salvarParcialAoVivo(deps, b.roundId, b.vitoriasPorTime));
          case 'cancelarTransmissaoAoVivo': return await travar(() => cancelarTransmissaoAoVivo(deps, b.roundId));
          default: return naoDisponivel(acao);
        }
```

Acrescentar a função `chaveDe`, perto do topo de `criarHandler` (junto a `const falhaInesperada = ...` e `const travar = ...`):

```js
  // "jogo" vindo do app é 1, 2 ou ausente/null; a "chave de cobrança" do financeiro é sempre null (o dia) ou 1/2
  const chaveDe = (b) => (b.jogo === 1 || b.jogo === 2 ? b.jogo : null);
```

- [ ] **Step 5: Adicionar as três ações em `backend/permissoes.js`**

```js
export const PERMISSOES = {
  ping:             ['jogador', 'organizador', 'admin'],
  uploadPhoto:      ['jogador', 'organizador', 'admin'],
  addPlayer:        ['organizador', 'admin'],
  updatePlayer:     ['organizador', 'admin'],
  addRound:         ['organizador', 'admin'],
  updateRound:      ['organizador', 'admin'],
  removePlayer:     ['admin'],
  restorePlayer:    ['organizador', 'admin'],
  removeRound:      ['admin'],
  saveSettings:       ['admin'],
  saveCheckinSettings: ['organizador', 'admin'],
  listarUsuarios:   ['organizador', 'admin'],
  salvarUsuario:    ['admin'],
  removerUsuario:   ['admin'],
  solicitarVinculo: ['jogador', 'organizador', 'admin'],
  aprovarVinculo:   ['organizador', 'admin'],
  rejeitarVinculo:  ['organizador', 'admin'],
  salvarEstrelasAjustadas: ['organizador', 'admin'],
  iniciarTransmissaoAoVivo:  ['organizador', 'admin'],
  salvarParcialAoVivo:       ['organizador', 'admin'],
  cancelarTransmissaoAoVivo: ['organizador', 'admin'],
  // dois jogos no mesmo dia (2026-10-03)
  moverCheckin:       ['organizador', 'admin'],
  salvarJogo2:        ['organizador', 'admin'],
  removerJogo2:       ['organizador', 'admin'],
  // controle financeiro
  salvarFinDia:       ['organizador', 'admin'],
  marcarPagamento:    ['organizador', 'admin'],
  estornarPagamento:  ['organizador', 'admin'],
  marcarTodosPagamentos:    ['organizador', 'admin'],
  estornarTodosPagamentos:  ['organizador', 'admin'],
  addLancamento:      ['organizador', 'admin'],
  estornarLancamento: ['admin'],
  marcarDiaSemJogo:   ['organizador', 'admin'],
  reabrirDia:         ['organizador', 'admin'],
  aplicarCreditosDoDia: ['organizador', 'admin'],
  devolverCredito:    ['admin']
};
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node tests/backend/handler-dois-jogos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 7: Rodar a suíte inteira do backend**

Run: `npm run test:backend`
Expected: tudo `ok`. Se `handler-etapa4a.test.mjs`/`handler-etapa4b.test.mjs` falharem (chamam o handler com o corpo antigo, sem `jogo`), é esperado continuar passando sem mudança nenhuma — `chaveDe(b)` devolve `null` quando `b.jogo` está ausente, idêntico ao comportamento de hoje.

- [ ] **Step 8: Registrar o teste novo no `package.json`** (depois de `node tests/backend/handler-edge.test.mjs &&`, ou outro ponto perto dos testes de handler)

- [ ] **Step 9: Commit**

```bash
git add backend/handler.js backend/permissoes.js tests/backend/handler-dois-jogos.test.mjs package.json
git commit -m "backend: liga moverCheckin/salvarJogo2/removerJogo2; financeiro recebe a chave pelo POST"
```

---

### Task 10: Testes de paridade com o `.gs` — ignorar os campos novos

**Files:**
- Create: `tests/backend/semCamposNovosDoisJogos.mjs`
- Modify: `tests/backend/paridade-get.test.mjs`, `paridade-checkins.test.mjs`, `paridade-financeiro.test.mjs`, `paridade-financeiro-credito.test.mjs`

**Interfaces:**
- Produces: `semCamposNovos(valor)` — função pura que devolve uma cópia profunda de `valor` sem as chaves `jogo`, `porJogo`, `jogoOrigem`, `jogos`, `checkinJogo2` (em qualquer profundidade). Usada só dentro dos testes de paridade.

Estes 4 arquivos comparam, **passo a passo**, a resposta do backend novo com a resposta real do `.gs` (via `apps-script-codigo.gs`, que é **gitignorado** — não existe neste repositório, então os 4 arquivos imprimem "PULADO" e saem com sucesso aqui; mesmo assim, atualizar — quem tem o `.gs` na própria máquina depende disso para a suíte continuar verde). Como o `.gs` não tem o conceito de "jogo", **toda** resposta do backend novo que inclua `checkins`/`settings`/`financeiro` ganhou campos a mais — não só o GET final.

- [ ] **Step 1: Criar o helper de comparação**

```js
// tests/backend/semCamposNovosDoisJogos.mjs
// Tira dos JSONs de resposta os campos que só existem no backend novo (dois jogos no mesmo dia, 2026-10-03): o .gs
// real não tem esse conceito, então as comparações byte a byte com ele (paridade-*.test.mjs) precisam ignorar esses
// campos, em qualquer profundidade do objeto — eles aparecem dentro de arrays (checkins[], pagamentos[], creditos[]).
const CAMPOS_NOVOS = new Set(['jogo', 'porJogo', 'jogoOrigem', 'jogos', 'checkinJogo2']);

export function semCamposNovos(valor) {
  if (Array.isArray(valor)) return valor.map(semCamposNovos);
  if (valor && typeof valor === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) {
      if (CAMPOS_NOVOS.has(k)) continue;
      saida[k] = semCamposNovos(v);
    }
    return saida;
  }
  return valor;
}
```

- [ ] **Step 2: `tests/backend/paridade-get.test.mjs`** — importar e envolver `obtido`

```js
import { semCamposNovos } from './semCamposNovosDoisJogos.mjs';
// ...
await ta('paridade do GET: o backend novo devolve o mesmo JSON que o doGet do .gs real', async () => {
  const esperado = criarAmbiente(dbParaAbas(fixture), [caminhoGs]).get();
  const obtido = JSON.parse(JSON.stringify(await criarHandler({ repo: criarRepoMemoria(fixture) }).get()));
  delete obtido.removidos;
  assert.deepEqual(semCamposNovos(obtido), esperado);
});
```

- [ ] **Step 3: `tests/backend/paridade-checkins.test.mjs`** — envolver as duas comparações (resposta do POST e o GET final)

Trocar:
```js
    assert.deepEqual(obtido, esperado, 'resposta diferente');
```
por:
```js
    assert.deepEqual(semCamposNovos(obtido), esperado, 'resposta diferente');
```
e trocar:
```js
    assert.deepEqual((({ removidos, ...r }) => r)(json(await novo.get())), gs.get(), 'o GET (com o financeiro) ficou diferente depois deste passo');
```
por:
```js
    assert.deepEqual(semCamposNovos((({ removidos, ...r }) => r)(json(await novo.get()))), gs.get(), 'o GET (com o financeiro) ficou diferente depois deste passo');
```
(acrescentar `import { semCamposNovos } from './semCamposNovosDoisJogos.mjs';` no topo do arquivo)

- [ ] **Step 4: o mesmo em `tests/backend/paridade-financeiro.test.mjs` e `tests/backend/paridade-financeiro-credito.test.mjs`** (mesmas duas trocas, mesmo import)

- [ ] **Step 5: Rodar os 4 arquivos**

Run: `node tests/backend/paridade-get.test.mjs && node tests/backend/paridade-checkins.test.mjs && node tests/backend/paridade-financeiro.test.mjs && node tests/backend/paridade-financeiro-credito.test.mjs`
Expected: `PULADO - apps-script-codigo.gs não existe nesta pasta...` nos 4 (saída 0) — é o esperado aqui, pois o `.gs` é gitignorado. **Se o usuário tiver o `.gs` na própria máquina**, rodar de novo lá: aí sim os testes executam de verdade e precisam dar `TODOS OS TESTES PASSARAM`.

- [ ] **Step 6: Rodar a suíte inteira do backend**

Run: `npm run test:backend`
Expected: tudo `ok`

- [ ] **Step 7: Commit**

```bash
git add tests/backend/semCamposNovosDoisJogos.mjs tests/backend/paridade-get.test.mjs tests/backend/paridade-checkins.test.mjs tests/backend/paridade-financeiro.test.mjs tests/backend/paridade-financeiro-credito.test.mjs
git commit -m "backend: paridade com o .gs ignora os campos novos de dois jogos (em qualquer profundidade)"
```

---

### Task 11: Simulação — 200 sequências aleatórias não violam as regras

**Files:**
- Create: `tests/backend/dois-jogos-simulacao.test.mjs`

**Interfaces:**
- Consumes: `addCheckin`/`removeCheckin`/`moverCheckin` (Task 6), `financeiro.js` inteiro (Task 7), `salvarJogo2`/`removerJogo2` (Task 8), via `criarHandler` (Task 9) — testa pela borda pública, como um cliente faria.

- [ ] **Step 1: Escrever a simulação**

```js
// tests/backend/dois-jogos-simulacao.test.mjs
// 200 sequências aleatórias de ações (confirmar, desconfirmar, mover, pagar, estornar, sem jogo, trocar modo,
// remover o 2º jogo) nos modos único e separado. Depois de CADA ação, confere invariantes que nunca podem quebrar.
// Falha com a semente (SEED) impressa, pra reproduzir o caso exato.
import assert from 'node:assert/strict';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const escolhe = (rand, lista) => lista[Math.floor(rand() * lista.length)];
const DATA = '2026-10-06';
const ORG = { action: 'ping', senha: 'senha-teste' };

function novoHandler() {
  return criarHandler({
    repo: criarRepoMemoria({
      jogadores: [1, 2, 3, 4, 5].map((i) => ({ id: 'p' + i, nome: 'J' + i, convidado: false, removido: false, ordem: i })),
      config: [{ chave: 'checkinDataAberta', valor: DATA }, { chave: 'checkinHorario', valor: '19:00' }, { chave: 'checkinVagas', valor: '3' }],
      checkins: [], fin_dias: [], fin_jogos: [], fin_pagamentos: [], fin_creditos: []
    }),
    config: { adminPassword: 'senha-teste' },
    relogio: () => new Date('2026-10-06T12:00:00.000Z'),
    gerarId: (() => { let n = 0; return () => 'id-' + (++n); })()
  });
}

async function conferirInvariantes(h, comQueAcao) {
  const t = await h.get();
  // nunca duas pessoas na mesma vaga do mesmo jogo (mesmo jogadorId duas vezes no mesmo "jogo")
  const vistosPorJogo = new Map();
  for (const c of t.checkins) {
    const chave = c.data + '|' + c.jogo + '|' + c.jogadorId;
    assert.ok(!vistosPorJogo.has(chave), `jogador duplicado no mesmo jogo após ${comQueAcao}: ${chave}`);
    vistosPorJogo.set(chave, true);
  }
  // nunca dois pagamentos válidos por (data, chave, jogador)
  const vistosPag = new Map();
  for (const p of t.financeiro.pagamentos) {
    if (p.estornado) continue;
    const chave = p.data + '|' + (p.jogo ?? 'dia') + '|' + p.jogadorId;
    assert.ok(!vistosPag.has(chave), `pagamento duplicado após ${comQueAcao}: ${chave}`);
    vistosPag.set(chave, true);
  }
  // o caixa é sempre a soma dos registros (dinheiro válido − saídas dos jogos não-sem-jogo; aqui só confere que não é NaN/infinito)
  const caixa = t.financeiro.pagamentos.filter((p) => !p.estornado && p.tipo !== 'credito').reduce((s, p) => s + p.valor, 0);
  assert.ok(Number.isFinite(caixa), `caixa não numérico após ${comQueAcao}`);
}

async function umaSequencia(seed) {
  const rand = rng(seed);
  const h = novoHandler();
  let porJogo = false;
  for (let i = 0; i < 40; i++) {
    const jogador = escolhe(rand, ['p1', 'p2', 'p3', 'p4', 'p5']);
    const jogo = escolhe(rand, [1, 2]);
    const acao = escolhe(rand, ['confirmar', 'confirmar', 'desconfirmar', 'mover', 'pagar', 'estornar', 'semjogo', 'reabrir', 'trocarModo', 'add2', 'remove2']);
    try {
      if (acao === 'add2') { await h.post({ ...ORG, action: 'salvarJogo2', jogo2: { data: DATA, horario: '21:00', vagas: 3 } }); }
      else if (acao === 'remove2') { await h.post({ ...ORG, action: 'removerJogo2', data: DATA, destino: escolhe(rand, ['mover', 'desconfirmar']) }); porJogo = false; }
      else if (acao === 'confirmar') { await h.post({ action: 'addCheckin', checkin: { id: 'c' + i, data: DATA, jogadorId: jogador, jogo } }); }
      else if (acao === 'desconfirmar') {
        const get = await h.get();
        const alvo = get.checkins.find((c) => c.jogadorId === jogador && c.jogo === jogo);
        if (alvo) await h.post({ action: 'removeCheckin', id: alvo.id });
      } else if (acao === 'mover') {
        const get = await h.get();
        const alvo = get.checkins.find((c) => c.jogadorId === jogador);
        if (alvo) await h.post({ ...ORG, action: 'moverCheckin', id: alvo.id, paraJogo: alvo.jogo === 1 ? 2 : 1 });
      } else if (acao === 'pagar') {
        await h.post({ ...ORG, action: 'salvarFinDia', dia: { data: DATA, jogo: porJogo ? jogo : undefined, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' } });
        await h.post({ ...ORG, action: 'marcarPagamento', data: DATA, jogo: porJogo ? jogo : null, jogadorId: jogador, jogadorNome: jogador });
      } else if (acao === 'estornar') {
        const get = await h.get();
        const p = get.financeiro.pagamentos.find((x) => x.jogadorId === jogador && !x.estornado);
        if (p) await h.post({ ...ORG, action: 'estornarPagamento', id: p.id });
      } else if (acao === 'semjogo') {
        await h.post({ ...ORG, action: 'salvarFinDia', dia: { data: DATA, jogo: porJogo ? jogo : undefined, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' } });
        await h.post({ ...ORG, action: 'marcarDiaSemJogo', data: DATA, jogo: porJogo ? jogo : null, destino: escolhe(rand, ['credito', 'devolver']) });
      } else if (acao === 'reabrir') {
        await h.post({ ...ORG, action: 'reabrirDia', data: DATA, jogo: porJogo ? jogo : null });
      } else if (acao === 'trocarModo') {
        const get = await h.get();
        if (get.financeiro.dias.length) {
          const r = await h.post({ ...ORG, action: 'salvarFinDia', dia: { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: !porJogo } });
          if (!r.error) porJogo = !porJogo;
        }
      }
    } catch (e) { throw new Error(`seed ${seed}, passo ${i} (${acao}): ${e.message}`); }
    await conferirInvariantes(h, `seed ${seed}, passo ${i} (${acao})`);
  }
}

(async () => {
  for (let seed = 1; seed <= 200; seed++) await umaSequencia(seed);
  console.log('ok — simulação (200 sequências) sem violar nenhuma regra');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar**

Run: `node tests/backend/dois-jogos-simulacao.test.mjs`
Expected: `ok — simulação (200 sequências) sem violar nenhuma regra`. Se falhar, a mensagem traz a semente e o passo exatos — investigar e corrigir o bug real em `financeiro.js`/`checkins.js`/`jogos2.js` antes de seguir (não ajustar o teste pra "passar": a simulação existe pra achar bug de verdade).

- [ ] **Step 3: Registrar no `package.json`** (depois de `node tests/backend/handler-dois-jogos.test.mjs &&`)

- [ ] **Step 4: Rodar a suíte inteira do backend uma última vez**

Run: `npm run test:backend`
Expected: tudo `ok` — a PARTE do backend está pronta aqui.

- [ ] **Step 5: Commit**

```bash
git add tests/backend/dois-jogos-simulacao.test.mjs package.json
git commit -m "backend: simulação de 200 sequências aleatórias (dois jogos) — invariantes nunca quebram"
```

---

## PARTE E — Front (`volei-dashboard.html`, só o Terça)

A partir daqui, todo "Modify" é no mesmo arquivo `volei-dashboard.html`. Os números de linha citados são os de **hoje** (antes desta Parte E) — cada task desloca as linhas das tasks seguintes; use o nome da função/âncora de texto pra achar o lugar certo, não o número isolado.

Depois de qualquer edição em JS do HTML, validar sintaxe (regra do projeto):
```bash
python3 -c "
import re
content = open('volei-dashboard.html').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('/tmp/check.js','w').write(m.group(1))
"
node --check /tmp/check.js
```

### Task 12: Bloco `<dois-jogos-puro>` — a lógica pura de 1/2 jogos

**Files:**
- Modify: `volei-dashboard.html` — inserir um bloco novo logo depois de `// </financeiro-puro>` (linha ~3041 hoje)
- Test: `tests/dois-jogos.test.js` (novo)

**Interfaces:**
- Consumes: `<financeiro-puro>` (não muda — `finDia`, `finPagamentoDe`, `finPagamentosValidos`, `finMarcas`, `finRotuloCredito`, `finTipoPagamento`, `finCentavos`, `finFormatar`, `finCabecalhoWhatsApp`, `finPagamentosRecentesPrimeiro`, `finSemJogo`, `finCaixaAte`, `finResumoFechamento`, `finDataCurtaComDia`, `finSaidaDia`, `finCaixa`, `finDatas`, `finResultadoDia`, `finPendentes`, `finSaldoPrevisto`, `finCreditoDe` — todas usadas **sem mudar assinatura**).
- Produces: `jogosDoDia(settings, checkins, data)`, `checkinsDoJogo(checkins, data, jogo)`, `dentroEReservaDoJogo(checkins, data, jogo, vagas)`, `estaNoJogo(checkins, data, jogo, jogadorId)`, `vagasLivresDoJogo(checkins, data, jogo, vagas)`, `confirmadosPelaChave(settings, checkins, data, chave)`, `chaveAtiva(fin, data, jogoAtivo)`, `cfgFinDaChave(fin, data, chave)`, `finViewDaChave(fin, data, chave)`, `finDiaMesclado(fin, data)`, `finVisaoCaixa(fin)`, `corpoWhatsAppDoDia(settings, checkins, fin, data)`, `fechamentoDoDia(settings, checkins, fin, data)`. Usadas pelas Tasks 13–19 (UI do check-in e da página Financeiro).

- [ ] **Step 1: Escrever o teste (falhando)**

```js
// tests/dois-jogos.test.js
// Lógica pura de "dois jogos no mesmo dia": filas por jogo, chave de cobrança (null=dia, 1/2=jogo), visão mesclada
// do caixa e os textos de WhatsApp/fechamento. Extrai <financeiro-puro> (não muda) + <dois-jogos-puro> do HTML e
// roda os dois juntos — exatamente como a página de verdade. Rodar: node tests/dois-jogos.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
function bloco(tag) {
  const ini = html.indexOf('// <' + tag + '>');
  const fim = html.indexOf('// </' + tag + '>');
  assert.ok(ini > -1 && fim > ini, 'bloco <' + tag + '> não encontrado');
  return html.slice(ini, fim);
}
const corpo = bloco('financeiro-puro') + '\n' + bloco('dois-jogos-puro');
const EXPORTS = ['jogosDoDia', 'checkinsDoJogo', 'dentroEReservaDoJogo', 'estaNoJogo', 'vagasLivresDoJogo',
  'confirmadosPelaChave', 'chaveAtiva', 'cfgFinDaChave', 'finViewDaChave', 'finDiaMesclado', 'finVisaoCaixa',
  'corpoWhatsAppDoDia', 'fechamentoDoDia', 'finFormatar', 'finCentavos', 'finCaixa', 'finSaidaDia', 'finResumoFechamento'];
const F = new Function(corpo + '\nreturn { ' + EXPORTS.join(', ') + ' };')();

const SETTINGS = { checkinHorario: '19:00', checkinVagas: 2, checkinTravado: false, checkinJogo2: { data: '2026-10-06', horario: '21:00', vagas: 2, travado: false } };
const CK = [
  { id: 'c1', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', jogo: 1 },
  { id: 'c2', data: '2026-10-06', jogadorId: 'p2', jogadorNome: 'Bruno', jogo: 1 },
  { id: 'c3', data: '2026-10-06', jogadorId: 'p3', jogadorNome: 'Caio', jogo: 1 }, // reserva do jogo 1 (vagas=2)
  { id: 'c4', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', jogo: 2 }   // Ana nos dois jogos
];

let falhas = 0;
function t(nome, fn) { try { fn(); console.log('ok    -', nome); } catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('jogosDoDia: 1 jogo sem checkinJogo2; 2 jogos em ordem de horário; órfão (checkins sem config) ainda aparece', () => {
  assert.deepEqual(F.jogosDoDia({ checkinHorario: '19:00', checkinVagas: 16 }, [], '2026-10-06').map((j) => j.numero), [1]);
  assert.deepEqual(F.jogosDoDia(SETTINGS, CK, '2026-10-06').map((j) => j.horario), ['19:00', '21:00']);
  const orfaos = [{ id: 'x', data: '2026-10-06', jogadorId: 'p9', jogo: 2 }];
  assert.deepEqual(F.jogosDoDia({ checkinHorario: '19:00', checkinVagas: 16 }, orfaos, '2026-10-06').map((j) => j.numero), [1, 2]);
});

t('dentroEReservaDoJogo / estaNoJogo / vagasLivresDoJogo', () => {
  const { dentro, reserva } = F.dentroEReservaDoJogo(CK, '2026-10-06', 1, 2);
  assert.deepEqual(dentro.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(reserva.map((c) => c.id), ['c3']);
  assert.ok(F.estaNoJogo(CK, '2026-10-06', 2, 'p1'));
  assert.ok(!F.estaNoJogo(CK, '2026-10-06', 2, 'p2'));
  assert.equal(F.vagasLivresDoJogo(CK, '2026-10-06', 2, 2), 1);
});

t('confirmadosPelaChave: null é a UNIÃO sem duplicar; 1/2 é só daquele jogo', () => {
  assert.deepEqual(F.confirmadosPelaChave(SETTINGS, CK, '2026-10-06', null).map((c) => c.jogadorId), ['p1', 'p2']); // c3 é reserva, c4 é Ana repetida
  assert.deepEqual(F.confirmadosPelaChave(SETTINGS, CK, '2026-10-06', 1).map((c) => c.jogadorId), ['p1', 'p2']);
  assert.deepEqual(F.confirmadosPelaChave(SETTINGS, CK, '2026-10-06', 2).map((c) => c.jogadorId), ['p1']);
});

t('chaveAtiva: null quando porJogo é falso (mesmo com 2 jogos); o número do jogo ativo quando porJogo é true', () => {
  const fin = { dias: [{ data: '2026-10-06', porJogo: false }] };
  assert.equal(F.chaveAtiva(fin, '2026-10-06', 2), null);
  fin.dias[0].porJogo = true;
  assert.equal(F.chaveAtiva(fin, '2026-10-06', 2), 2);
});

t('cfgFinDaChave / finViewDaChave: separa pagamentos e créditos por chave', () => {
  const fin = {
    dias: [{ data: '2026-10-06', valorPessoa: 15, pix: '', valorQuadra: 300, temBrinde: false, valorBrinde: 0, icone: '✅', status: '', porJogo: true }],
    jogos: [{ data: '2026-10-06', jogo: 2, valorPessoa: 20, pix: 'px', valorQuadra: 150, temBrinde: false, valorBrinde: 0, icone: '✅', status: '' }],
    pagamentos: [
      { id: 'a', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', valor: 15, jogo: 1, estornado: false, marcadoPor: 'x', marcadoEm: '' },
      { id: 'b', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', valor: 20, jogo: 2, estornado: false, marcadoPor: 'x', marcadoEm: '' }
    ],
    creditos: []
  };
  assert.equal(F.cfgFinDaChave(fin, '2026-10-06', 2).valorPessoa, 20);
  assert.deepEqual(F.finViewDaChave(fin, '2026-10-06', 1).pagamentos.map((p) => p.id), ['a']);
  assert.deepEqual(F.finViewDaChave(fin, '2026-10-06', 2).pagamentos.map((p) => p.id), ['b']);
});

t('finDiaMesclado/finVisaoCaixa: soma as 2 quadras; "sem jogo" só quando os 2 jogos estão sem jogo', () => {
  const fin = {
    dias: [{ data: '2026-10-06', valorPessoa: 15, pix: 'px1', valorQuadra: 300, temBrinde: false, valorBrinde: 0, icone: '✅', status: '' }],
    jogos: [{ data: '2026-10-06', jogo: 2, valorPessoa: 20, pix: 'px2', valorQuadra: 150, temBrinde: true, valorBrinde: 10, icone: '✅', status: 'semjogo' }],
    pagamentos: [], creditos: []
  };
  const m = F.finDiaMesclado(fin, '2026-10-06');
  assert.deepEqual({ q: m.valorQuadra, b: m.valorBrinde, s: m.status }, { q: 300, b: 0, s: '' }); // jogo 2 sem jogo: a quadra dele não entra
  const vis = F.finVisaoCaixa(fin);
  assert.equal(F.finSaidaDia(vis, '2026-10-06'), 30000); // 300 em centavos
});

t('corpoWhatsAppDoDia: único soma as 2 listas sob um cabeçalho só; separado traz 1 cabeçalho por jogo', () => {
  const finUnico = { dias: [{ data: '2026-10-06', valorPessoa: 15, pix: 'chave-pix', porJogo: false, status: '' }], jogos: [], pagamentos: [], creditos: [] };
  const t1 = F.corpoWhatsAppDoDia(SETTINGS, CK, finUnico, '2026-10-06');
  assert.match(t1, /chave-pix/);
  assert.match(t1, /JOGO DAS 19:00/);
  assert.match(t1, /JOGO DAS 21:00/);
  assert.match(t1, /1- Ana/);
  assert.match(t1, /1- Caio/); // reserva do jogo 1
});

t('fechamentoDoDia: separado faz o saldo fechar (anterior + recebido - despesas = atual)', () => {
  const fin = {
    dias: [{ data: '2026-10-06', valorPessoa: 15, valorQuadra: 300, temBrinde: false, valorBrinde: 0, status: '', porJogo: true }],
    jogos: [{ data: '2026-10-06', jogo: 2, valorPessoa: 20, valorQuadra: 150, temBrinde: false, valorBrinde: 0, status: '' }],
    pagamentos: [{ id: 'a', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', valor: 15, jogo: 1, estornado: false, tipo: 'dinheiro', marcadoPor: 'x', marcadoEm: '' }],
    creditos: []
  };
  const texto = F.fechamentoDoDia(SETTINGS, CK, fin, '2026-10-06');
  const m = texto.match(/Saldo anterior: (R\$ [\d.,−]+)[\s\S]*Total recebido: (R\$ [\d.,−]+)[\s\S]*Total de despesas: (R\$ [\d.,−]+)[\s\S]*Saldo atual em caixa: (R\$ [\d.,−]+)/);
  assert.ok(m, texto);
  const n = (s) => Math.round(parseFloat(s.replace('R$', '').replace(/\./g, '').replace(',', '.').replace('−', '-')) * 100);
  assert.equal(n(m[1]) + 1500 - 45000, n(m[4])); // anterior(=0) + recebido - despesas = atual
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/dois-jogos.test.js`
Expected: FALHA — `bloco <dois-jogos-puro> não encontrado`.

- [ ] **Step 3: Inserir o bloco `<dois-jogos-puro>` no HTML**, imediatamente depois da linha `// </financeiro-puro>` (hoje linha 3041):

```js
// <dois-jogos-puro>
/* Dois jogos no mesmo dia (2026-10-03). PURO: não lê DATA, DOM nem rede. Reaproveita <financeiro-puro> SEM mudá-lo:
   "chave de cobrança" é null (o dia inteiro, modo único — o padrão) ou 1/2 (um jogo, modo separado). Para qualquer
   chave, finViewDaChave() monta um "fin" do mesmo formato que <financeiro-puro> já entende, e as funções de lá
   (finPagamentoDe, finPendentes, finMarcas...) são chamadas sem alteração nenhuma. Testado em tests/dois-jogos.test.js. */

// jogos que existem na data: 1 sempre; 2 só se checkinJogo2 bate com a data, OU (órfão: app antigo/corrida) se
// já existe check-in com jogo=2 nessa data mesmo sem config — nesse caso ninguém some da tela
function jogosDoDia(settings, checkins, data) {
  const jogos = [{ numero: 1, horario: settings.checkinHorario || '20:00', vagas: settings.checkinVagas || 16, travado: !!settings.checkinTravado }];
  const j2cfg = settings.checkinJogo2 && settings.checkinJogo2.data === data ? settings.checkinJogo2 : null;
  const orfao = !j2cfg && checkins.some((c) => c.data === data && (Number(c.jogo) || 1) === 2);
  if (j2cfg) jogos.push({ numero: 2, horario: j2cfg.horario || '21:00', vagas: j2cfg.vagas || 16, travado: !!j2cfg.travado });
  else if (orfao) jogos.push({ numero: 2, horario: jogos[0].horario, vagas: jogos[0].vagas, travado: false });
  return jogos.slice().sort((a, b) => a.horario.localeCompare(b.horario));
}
function checkinsDoJogo(checkins, data, jogo) {
  return checkins.filter((c) => c.data === data && (Number(c.jogo) || 1) === jogo);
}
function dentroEReservaDoJogo(checkins, data, jogo, vagas) {
  const lista = checkinsDoJogo(checkins, data, jogo);
  return { dentro: lista.slice(0, vagas), reserva: lista.slice(vagas) };
}
function estaNoJogo(checkins, data, jogo, jogadorId) {
  return checkins.some((c) => c.data === data && (Number(c.jogo) || 1) === jogo && c.jogadorId === jogadorId);
}
function vagasLivresDoJogo(checkins, data, jogo, vagas) {
  return Math.max(0, vagas - checkinsDoJogo(checkins, data, jogo).length);
}
// confirmados "pela chave": null = união de quem está confirmado, dentro das vagas, em QUALQUER jogo do dia (sem
// repetir pessoa, na ordem em que os jogos aparecem); 1/2 = só os confirmados daquele jogo, dentro das vagas dele
function confirmadosPelaChave(settings, checkins, data, chave) {
  const jogos = jogosDoDia(settings, checkins, data);
  if (chave !== null) {
    const j = jogos.find((x) => x.numero === chave);
    return j ? dentroEReservaDoJogo(checkins, data, chave, j.vagas).dentro : [];
  }
  const vistos = new Set();
  const out = [];
  jogos.forEach((j) => {
    dentroEReservaDoJogo(checkins, data, j.numero, j.vagas).dentro.forEach((c) => {
      if (vistos.has(c.jogadorId)) return;
      vistos.add(c.jogadorId);
      out.push(c);
    });
  });
  return out;
}
// a chave que vale AGORA pra essa data: null se o dia não é "separado por jogo" (mesmo com 2 jogos — um financeiro
// só, pelo dia); o número do jogo ativo (a aba) quando é separado
function chaveAtiva(fin, data, jogoAtivo) {
  const dia = (fin.dias || []).find((d) => d.data === data);
  return dia && dia.porJogo ? jogoAtivo : null;
}
// configuração (mesmo formato de um item de fin.dias) de uma chave: 2 vem de fin.jogos; null/1 vem de fin.dias
function cfgFinDaChave(fin, data, chave) {
  if (chave === 2) return (fin.jogos || []).find((j) => j.data === data && j.jogo === 2) || null;
  return (fin.dias || []).find((d) => d.data === data) || null;
}
// "visão" no formato que <financeiro-puro> entende, só com o que pertence a essa chave — assim finPagamentoDe,
// finPendentes, finMarcas etc. funcionam SEM MUDAR NADA nelas, só recebendo isto no lugar de FINANCEIRO
function finViewDaChave(fin, data, chave) {
  const cfg = cfgFinDaChave(fin, data, chave);
  return {
    dias: cfg ? [cfg] : [],
    pagamentos: (fin.pagamentos || []).filter((p) => p.data === data && (chave === null ? p.jogo == null : p.jogo === chave)),
    lancamentos: [],
    creditos: (fin.creditos || []).filter((c) => c.dataOrigem === data && (chave === null ? c.jogoOrigem == null : c.jogoOrigem === chave))
  };
}
// a configuração "do dia inteiro" pra quem só quer o CAIXA (soma as 2 quadras/brindes dos jogos que não estão sem
// jogo; "sem jogo" global só quando os 2 estão sem jogo). Usada só pelo caixa — nunca pra cobrar ninguém.
function finDiaMesclado(fin, data) {
  const base = finDia(fin, data);
  const jogo2 = (fin.jogos || []).find((j) => j.data === data && j.jogo === 2);
  if (!jogo2) return base;
  const normal1 = base && base.status !== 'semjogo';
  const normal2 = jogo2.status !== 'semjogo';
  const quadra = (normal1 ? (base.valorQuadra || 0) : 0) + (normal2 ? (jogo2.valorQuadra || 0) : 0);
  const brinde = (normal1 && base.temBrinde ? (base.valorBrinde || 0) : 0) + (normal2 && jogo2.temBrinde ? (jogo2.valorBrinde || 0) : 0);
  return { data, valorPessoa: base ? base.valorPessoa : 0, pix: base ? base.pix : '', valorQuadra: quadra,
    temBrinde: true, valorBrinde: brinde, icone: base ? base.icone : '✅', status: (!normal1 && !normal2) ? 'semjogo' : '' };
}
// um "fin" com os dias de 2 jogos trocados pela versão mesclada — passar isto (no lugar de FINANCEIRO) pra
// finCaixa/finDatas/finResultadoDia/finSaidaDia/finCaixaAte/finResumoFechamento continuarem corretos sem mudar nelas
function finVisaoCaixa(fin) {
  const datas = new Set((fin.jogos || []).map((j) => j.data));
  if (!datas.size) return fin;
  const dias = (fin.dias || []).map((d) => (datas.has(d.data) ? finDiaMesclado(fin, d.data) : d));
  datas.forEach((data) => { if (!dias.some((d) => d.data === data)) dias.push(finDiaMesclado(fin, data)); });
  return Object.assign({}, fin, { dias });
}
// linhas de valor/PIX + as listas numeradas (confirmados/reserva) de 1 ou 2 jogos, prontas pra colar depois do texto
// de abertura (que continua vindo de preencherMensagemCheckin, no app — ver <lista-whatsapp-puro>/montarTextoCheckinsWhatsApp)
function corpoWhatsAppDoDia(settings, checkins, fin, data) {
  const jogos = jogosDoDia(settings, checkins, data);
  const porJogo = !!((fin.dias || []).find((d) => d.data === data) || {}).porJogo;
  let t = '';
  if (!porJogo) t += finCabecalhoWhatsApp(finViewDaChave(fin, data, null), data);
  jogos.forEach((j) => {
    const chave = porJogo ? j.numero : null;
    const view = finViewDaChave(fin, data, chave);
    if (jogos.length > 1) t += '🏐 *JOGO DAS ' + j.horario + '* (' + j.vagas + ' vagas)\n';
    if (porJogo) t += finCabecalhoWhatsApp(view, data);
    const { dentro, reserva } = dentroEReservaDoJogo(checkins, data, j.numero, j.vagas);
    dentro.forEach((c, i) => {
      const marcas = finMarcas(view, data, c.jogadorId);
      const credito = finRotuloCredito(view, data, c.jogadorId) ? ' (Crédito)' : '';
      t += (i + 1) + '- ' + (c.jogadorNome || 'Convidado') + (marcas ? ' ' + marcas : '') + credito + '\n';
    });
    if (reserva.length) {
      t += '\nEspera:\n\n';
      reserva.forEach((c, i) => { t += (i + 1) + '- ' + (c.jogadorNome || 'Convidado') + '\n'; });
    }
    t += '\n';
  });
  return t;
}
// Fechamento (texto pra colar no grupo): único reaproveita finResumoFechamento de <financeiro-puro> sem mudar nada
// (a visão mesclada já resolve a quadra/brinde somados); separado monta um bloco por jogo.
function fechamentoDoDia(settings, checkins, fin, data) {
  const dia = (fin.dias || []).find((d) => d.data === data);
  if (!dia || !dia.porJogo) return finResumoFechamento(finVisaoCaixa(fin), data);
  const jogos = jogosDoDia(settings, checkins, data);
  const money = (c) => finFormatar(c);
  const linhas = ['🏐 FECHAMENTO VÔLEI', '📅 ' + finDataCurtaComDia(data) + ' · ' + jogos.length + ' jogos', ''];
  let recebidoTotal = 0, despesasTotal = 0;
  jogos.forEach((j) => {
    const view = finViewDaChave(fin, data, j.numero);
    const cfg = cfgFinDaChave(fin, data, j.numero);
    const pagos = finPagamentosRecentesPrimeiro(finPagamentosValidos(view, data)).reverse();
    linhas.push('⏰ JOGO DAS ' + j.horario + (finSemJogo(cfg) ? ' — 🌧️ SEM JOGO' : ''));
    linhas.push('📋 Lista: ' + (pagos.length ? pagos.map((p) => p.jogadorNome || 'Convidado').join(', ') + '.' : '—'));
    if (finSemJogo(cfg)) {
      const dinheiro = pagos.filter((p) => finTipoPagamento(p) === 'dinheiro');
      if (dinheiro.length) linhas.push('💳 ' + dinheiro.length + ' pagamento(s) guardado(s) como crédito.');
    } else if (cfg) {
      const dinheiro = pagos.filter((p) => finTipoPagamento(p) === 'dinheiro');
      const recebido = dinheiro.reduce((s, p) => s + finCentavos(p.valor), 0);
      const despesa = finCentavos(cfg.valorQuadra) + (cfg.temBrinde ? finCentavos(cfg.valorBrinde) : 0);
      linhas.push('💰 Recebido: ' + money(recebido), '💸 Quadra' + (cfg.temBrinde ? '+brinde' : '') + ': ' + money(despesa));
      recebidoTotal += recebido; despesasTotal += despesa;
    }
    linhas.push('');
  });
  const anterior = finCaixaAte(finVisaoCaixa(fin), data, false);
  linhas.push('📊 Resumo do dia (os ' + jogos.length + ' jogos):',
    '* Saldo anterior: ' + money(anterior), '* Total recebido: ' + money(recebidoTotal), '* Total de despesas: ' + money(despesasTotal), '',
    '✅ Saldo atual em caixa: ' + money(anterior + recebidoTotal - despesasTotal), '',
    'Obrigado (a), time! Que venham os próximos jogos! 🏐🙏🏻');
  return linhas.join('\n');
}
// </dois-jogos-puro>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/dois-jogos.test.js`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 5: Validar sintaxe e rodar `tests/financeiro-puro.test.js`** (não deve ter mudado nada: o bloco `<financeiro-puro>` está intocado)

Run: (o comando de validação de sintaxe do topo da Parte E) e depois `node tests/financeiro-puro.test.js`
Expected: `node --check` sem erro; `TODOS OS TESTES PASSARAM`

- [ ] **Step 6: Commit**

```bash
git add volei-dashboard.html tests/dois-jogos.test.js
git commit -m "front: bloco <dois-jogos-puro> — chave de cobrança, visão do caixa, WhatsApp e fechamento com 2 jogos"
```

---

### Task 13: Estado, markup e abas — criar/remover o 2º jogo

**Files:**
- Modify: `volei-dashboard.html`
- Test: `tests/dois-jogos-ui-puro.test.js` (novo)

**Interfaces:**
- Consumes: `jogosDoDia`, `checkinsDoJogo`, `dentroEReservaDoJogo`, `estaNoJogo` (Task 12); ações `salvarJogo2`/`removerJogo2`/`moverCheckin` (Tasks 6/8/9).
- Produces: estado global `JOGO_ATIVO` (1 ou 2); função pura `jogosAbasHtml(settings, checkins, data, jogoAtivo, auth)` (acrescentada ao bloco `<dois-jogos-puro>`); `renderJogosAbas()`, `abrirModalAdicionarJogo2()`, `abrirModalRemoverJogo(jogo)` — usadas pelas Tasks 14/15.

- [ ] **Step 1: Escrever o teste da função pura nova (falhando)**

```js
// tests/dois-jogos-ui-puro.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <dois-jogos-puro>');
const fim = html.indexOf('// </dois-jogos-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <dois-jogos-puro> não encontrado');
const F = new Function(html.slice(ini, fim) + '\nreturn { jogosAbasHtml };')();

const SETTINGS = { checkinHorario: '19:00', checkinVagas: 2, checkinJogo2: { data: '2026-10-06', horario: '21:00', vagas: 2, travado: false } };
const CK = [{ id: 'c1', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', jogo: 1 }, { id: 'c2', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', jogo: 2 }];

let falhas = 0;
function t(nome, fn) { try { fn(); console.log('ok    -', nome); } catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('jogosAbasHtml: nada com 1 jogo; 2 botões, em ordem de horário, com "você" pra quem está logado e confirmado', () => {
  assert.equal(F.jogosAbasHtml({ checkinHorario: '19:00', checkinVagas: 16 }, [], '2026-10-06', 1, {}), '');
  const h = F.jogosAbasHtml(SETTINGS, CK, '2026-10-06', 2, { logado: true, jogadorId: 'p1' });
  assert.equal((h.match(/class="jogo-aba /g) || []).length, 2);
  assert.match(h, /19:00[\s\S]*21:00/); // 1º jogo antes do 2º
  assert.match(h, /jogo-aba ativa"[^>]*data-jogo-aba="2"/);
  assert.match(h, /você ✅/);
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/dois-jogos-ui-puro.test.js`
Expected: FALHA — `jogosAbasHtml` não existe.

- [ ] **Step 3: Acrescentar `jogosAbasHtml` ao fim do bloco `<dois-jogos-puro>`** (antes de `// </dois-jogos-puro>`)

```js
// HTML das abas (uma por jogo); vazio quando há só 1 jogo (nada aparece na tela, como hoje)
function jogosAbasHtml(settings, checkins, data, jogoAtivo, auth) {
  const jogos = jogosDoDia(settings, checkins, data);
  if (jogos.length < 2) return '';
  return '<div class="jogos-abas" role="tablist" aria-label="Jogos do dia">' + jogos.map((j) => {
    const { dentro, reserva } = dentroEReservaDoJogo(checkins, data, j.numero, j.vagas);
    const eu = auth && auth.logado && estaNoJogo(checkins, data, j.numero, auth.jogadorId);
    return '<button type="button" class="jogo-aba ' + (j.numero === jogoAtivo ? 'ativa' : '') + '" role="tab" aria-selected="' + (j.numero === jogoAtivo) + '" data-jogo-aba="' + j.numero + '">'
      + '<span class="jogo-aba-rot">' + j.numero + 'º jogo</span><span class="jogo-aba-hora">' + j.horario + '</span>'
      + '<span class="jogo-aba-sub">' + dentro.length + '/' + j.vagas + (reserva.length ? ' · ' + reserva.length + ' na reserva' : '') + (j.travado ? ' · 🔒' : '') + '</span>'
      + (eu ? '<span class="jogo-aba-eu">você ✅</span>' : '') + '</button>';
  }).join('') + '</div>';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/dois-jogos-ui-puro.test.js`
Expected: `TODOS OS TESTES PASSARAM`

- [ ] **Step 5: Estado novo e `PERMISSOES_UI`**

Perto de `let SETTINGS = {...}` (linha ~2744), acrescentar `checkinJogo2: null` ao objeto padrão, e logo abaixo o estado de qual aba está ativa:

```js
let SETTINGS = { estrelasVisiveis: true, checkinDataAberta: '', checkinTravado: false, checkinVagas: 16, checkinHorario: '20:00', checkinMensagemTemplate: CHECKIN_MENSAGEM_PADRAO, checkinJogo2: null };
let JOGO_ATIVO = 1; // 1 ou 2 — a aba do check-in; reaproveitado como "chave do financeiro" quando o dia é separado
```

Em `PERMISSOES_UI` (linha ~2764), acrescentar as três ações novas (mesma lista do `backend/permissoes.js`, Task 9):

```js
  moverCheckin:       ['organizador','admin'],
  salvarJogo2:        ['organizador','admin'],
  removerJogo2:       ['organizador','admin'],
```

Em `aplicarDados(json)` (linha ~3125), nada muda — `SETTINGS = json.settings` já traz `checkinJogo2` porque `mapearConfig` (Task 5) o inclui. Mas ao abrir o app, `JOGO_ATIVO` deve começar no jogo mais cedo: no fim de `aplicarDados`, acrescentar:

```js
  JOGO_ATIVO = (jogosDoDia(SETTINGS, CHECKINS, SETTINGS.checkinDataAberta)[0] || { numero: 1 }).numero;
```

- [ ] **Step 6: Markup — botão "Adicionar 2º jogo", contêiner das abas, linhas de horário/vagas do 2º jogo, botão de remover**

No HTML do check-in (linha ~1896), logo depois de `<div id="checkin-status"></div>`:

```html
      <div id="checkin-status"></div>
      <div id="checkin-jogos-abas"></div>
```

Em `.checkin-admin-acoes` (linha ~1904-1908), acrescentar o botão de criar o 2º jogo (escondido por padrão; `renderCheckinStatus`, Task 14, decide quando mostrar):

```html
          <div class="checkin-admin-acoes">
            <button class="btn cheio" id="open-checkin-btn">Abrir check-in</button>
            <button class="btn secondary" id="toggle-checkin-lock-btn" title="Travar ou destravar inclusões e exclusões na lista">🔒 Travar lista</button>
            <button class="btn danger" id="close-checkin-btn">✕ Fechar check-in</button>
            <button class="btn secondary cheio" id="add-jogo2-btn" style="display:none;">➕ Adicionar 2º jogo neste dia</button>
          </div>
```

Em `.checkin-admin-ajustes-body` (linha ~1912-1922), trocar os campos fixos de Vagas/Horário por um bloco por jogo (jogo 1 sempre visível; jogo 2 só quando existe — `renderJogosAbas`, Step 7, monta o conteúdo):

```html
          <div class="checkin-admin-ajustes-body">
            <div id="jogos-ajustes-corpo"></div>
            <button class="btn secondary" id="checkin-msg-config-btn" title="Editar mensagem de compartilhar">⚙️ Mensagem</button>
          </div>
```

- [ ] **Step 7: Funções de renderização e os dois modais**

Logo antes de `function renderCheckinStatus(){` (linha ~7387), acrescentar:

```js
// linha de horário+vagas de UM jogo dentro de "⚙️ Ajustes do check-in"; com 2 jogos, cada um ganha o botão 🗑
function jogoAjusteHtml(j, total){
  return `<div class="jogo-cfg ${total > 1 ? 'novo' : ''}">
    ${total > 1 ? `<div class="jogo-cfg-tit">${j.numero}º jogo</div>` : ''}
    <div class="checkin-admin-field"><label for="jogo-horario-${j.numero}">Horário</label><input type="time" id="jogo-horario-${j.numero}" data-jogo-ajuste="horario" data-jogo="${j.numero}" value="${j.horario}"></div>
    <div class="checkin-admin-field"><label for="jogo-vagas-${j.numero}">Vagas</label><input type="number" id="jogo-vagas-${j.numero}" data-jogo-ajuste="vagas" data-jogo="${j.numero}" min="1" value="${j.vagas}"></div>
    ${total > 1 ? `<button type="button" class="btn danger" data-jogo-remover="${j.numero}" title="Remover este jogo" aria-label="Remover o jogo das ${j.horario}">🗑</button>` : '<span></span>'}
  </div>`;
}
function renderJogosAjustes(){
  const cont = document.getElementById('jogos-ajustes-corpo');
  if(!cont) return;
  const jogos = jogosDoDia(SETTINGS, CHECKINS, SETTINGS.checkinDataAberta);
  cont.innerHTML = jogos.map(j => jogoAjusteHtml(j, jogos.length)).join('');
}
function renderJogosAbas(){
  const cont = document.getElementById('checkin-jogos-abas');
  if(!cont) return;
  cont.innerHTML = jogosAbasHtml(SETTINGS, CHECKINS, SETTINGS.checkinDataAberta, JOGO_ATIVO, AUTH);
}
document.getElementById('checkin-jogos-abas').addEventListener('click', (e)=>{
  const b = e.target.closest('[data-jogo-aba]');
  if(!b) return;
  JOGO_ATIVO = Number(b.dataset.jogoAba);
  renderCheckinStatus();
  renderCheckinList();
});
document.getElementById('jogos-ajustes-corpo').addEventListener('change', async (e)=>{
  const campo = e.target.dataset.jogoAjuste;
  if(!campo) return;
  const jogo = Number(e.target.dataset.jogo);
  const cred = await requireAuth(jogo === 2 ? 'salvarJogo2' : 'saveCheckinSettings');
  if(!cred){ renderJogosAjustes(); return; }
  if(jogo === 1){
    const anterior = { h: SETTINGS.checkinHorario, v: SETTINGS.checkinVagas };
    if(campo === 'horario') SETTINGS.checkinHorario = e.target.value || anterior.h;
    else SETTINGS.checkinVagas = parseInt(e.target.value, 10) > 0 ? parseInt(e.target.value, 10) : anterior.v;
    const ok = await postAction('saveCheckinSettings', { settings: SETTINGS }, cred);
    if(!ok){ SETTINGS.checkinHorario = anterior.h; SETTINGS.checkinVagas = anterior.v; }
  } else {
    const j2 = Object.assign({}, SETTINGS.checkinJogo2);
    if(campo === 'horario') j2.horario = e.target.value || j2.horario;
    else j2.vagas = parseInt(e.target.value, 10) > 0 ? parseInt(e.target.value, 10) : j2.vagas;
    const ok = await postAction('salvarJogo2', { jogo2: { data: SETTINGS.checkinDataAberta, horario: j2.horario, vagas: j2.vagas, travado: j2.travado } }, cred);
    if(ok) SETTINGS.checkinJogo2 = j2;
  }
  renderCheckinStatus();
  renderCheckinList();
});
document.getElementById('jogos-ajustes-corpo').addEventListener('click', (e)=>{
  const b = e.target.closest('[data-jogo-remover]');
  if(b) abrirModalRemoverJogo(Number(b.dataset.jogoRemover));
});

// modal "➕ Adicionar 2º jogo" (sugere +2h do 1º jogo, até 23h, e as mesmas vagas)
function abrirModalAdicionarJogo2(){
  const [h, m] = (SETTINGS.checkinHorario || '20:00').split(':').map(Number);
  const sugestao = String(Math.min(23, (h || 0) + 2)).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0');
  finAbrirModal('➕ 2º jogo em ' + formatDate(SETTINGS.checkinDataAberta), `
    <label class="fin-campo">Horário<input type="time" id="j2-horario" value="${sugestao}"></label>
    <label class="fin-campo">Vagas<input type="number" id="j2-vagas" min="1" value="${SETTINGS.checkinVagas || 16}"></label>`,
    async (ov)=>{
      const horario = ov.querySelector('#j2-horario').value;
      const vagas = parseInt(ov.querySelector('#j2-vagas').value, 10) || (SETTINGS.checkinVagas || 16);
      if(!horario){ alert('Escolha o horário.'); return false; }
      if(!(await finPost('salvarJogo2', { jogo2: { data: SETTINGS.checkinDataAberta, horario, vagas, travado: false } }))) return false;
      SETTINGS.checkinJogo2 = { data: SETTINGS.checkinDataAberta, horario, vagas, travado: false };
      JOGO_ATIVO = 2;
      renderCheckinStatus();
      renderCheckinList();
      mostrarToast('2º jogo criado às ' + horario + '. A aba dele já está aberta.', 'sucesso');
      return true;
    }, 'Adicionar jogo');
}
document.getElementById('add-jogo2-btn').addEventListener('click', abrirModalAdicionarJogo2);

// modal de remover um jogo: se tem gente na lista, pergunta mover (fim da fila do outro) ou desconfirmar;
// remover o jogo 1 reaproveita a MESMA ação com manter:2 ("trocar os papéis" — o servidor explica em backend/jogos2.js)
function abrirModalRemoverJogo(jogo){
  const data = SETTINGS.checkinDataAberta;
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const alvo = jogos.find(j => j.numero === jogo);
  const outro = jogos.find(j => j.numero !== jogo);
  if(!alvo || !outro) return;
  const n = checkinsDoJogo(CHECKINS, data, jogo).length;
  const corpo = n
    ? `<p>O jogo das <strong>${alvo.horario}</strong> tem ${n} nome(s) na lista. O que fazer com eles?</p>
       <label class="fin-opcao" style="margin-bottom:8px;"><input type="radio" name="j2-dest" value="mover" checked><span><strong>Mover para o jogo das ${outro.horario}</strong><br><small>Entram no fim da fila, na mesma ordem em que estavam.</small></span></label>
       <label class="fin-opcao"><input type="radio" name="j2-dest" value="desconfirmar"><span><strong>Desconfirmar todos</strong></span></label>`
    : `<p>Remover o jogo das <strong>${alvo.horario}</strong>? Ele não tem ninguém na lista.</p>`;
  finAbrirModal('Remover o jogo das ' + alvo.horario + '?', corpo, async (ov)=>{
    const destino = n ? ov.querySelector('input[name="j2-dest"]:checked').value : 'mover';
    const payload = { data, destino };
    if(jogo === 1) payload.manter = 2;
    if(!(await finPost('removerJogo2', payload))) return false;
    if(jogo === 1){ SETTINGS.checkinHorario = outro.horario; SETTINGS.checkinVagas = outro.vagas; SETTINGS.checkinTravado = outro.travado; }
    SETTINGS.checkinJogo2 = null;
    JOGO_ATIVO = 1;
    renderCheckinStatus();
    renderCheckinList();
    mostrarToast('Jogo das ' + alvo.horario + ' removido. O dia voltou a ter 1 jogo.', 'sucesso');
    return true;
  }, 'Remover jogo');
}
```

(`renderFinanceiroTudo()`, chamado por `finPost`, já existe e não precisa mudar aqui — ele só repinta o financeiro; as linhas acima chamam `renderCheckinStatus()`/`renderCheckinList()` explicitamente por cima porque abas/ajustes não são "financeiro".)

- [ ] **Step 8: Chamar as duas renderizações novas e mostrar/esconder o botão de criar o 2º jogo, dentro de `renderCheckinStatus()`**

No corpo de `renderCheckinStatus()` (linha ~7387), logo no início (antes de `statusEl.innerHTML = ...`):

```js
  renderJogosAbas();
  renderJogosAjustes();
  const addJogo2Btn = document.getElementById('add-jogo2-btn');
  if(addJogo2Btn) addJogo2Btn.style.display = (data && jogosDoDia(SETTINGS, CHECKINS, data).length === 1) ? 'inline-block' : 'none';
```

(`data` já é a primeira constante da função — `const data = SETTINGS.checkinDataAberta;` continua logo acima, sem mudar.)

- [ ] **Step 9: Validar sintaxe e rodar os testes puros**

Run: (validação de sintaxe) e depois `node tests/dois-jogos-ui-puro.test.js && node tests/dois-jogos.test.js`
Expected: sem erro de sintaxe; `TODOS OS TESTES PASSARAM` nos dois.

- [ ] **Step 10: Verificação manual no navegador** (UI com estado/DOM de verdade não tem teste automatizado neste projeto — o padrão aqui é abrir a página real)

Subir o demo com dados falsos (sem tocar produção): adaptar `.superpowers/brainstorm/dois-jogos/app-hoje-dados-falsos.mjs` (ou escrever um novo script equivalente) para rodar `node <script> 8790` e abrir `http://localhost:8790/?view=checkin&perfil=admin`. Conferir: com 1 jogo, nada novo aparece; tocar "➕ Adicionar 2º jogo" cria a aba das 21:00; "⚙️ Ajustes" mostra as duas linhas com o 🗑; remover o jogo 2 faz as abas sumirem.

- [ ] **Step 11: Commit**

```bash
git add volei-dashboard.html tests/dois-jogos-ui-puro.test.js
git commit -m "front: abas do check-in, criar/remover o 2º jogo"
```

---

### Task 14: Cartão "💰 Financeiro do dia" — único/separado e sem jogo

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:**
- Consumes: `jogosDoDia`, `finViewDaChave`, `cfgFinDaChave` (Task 12); `JOGO_ATIVO` (Task 13); `finDia`, `finDiaOuHerdado`, `finSemJogo`, `finIconeDoCartao`, `finPagamentosValidos`, `finTipoPagamento`, `finCentavos`, `finFormatar` (`<financeiro-puro>`, inalterado).
- Produces: `cfgOuHerdadaDaChave(chave)`, `chaveFinanceiroAtiva()` — usadas pelas Tasks 15 e 18.

- [ ] **Step 1: Markup — título/seletor/escopo dentro do cartão**

Trocar o `<summary>` e o início do `.fin-dia-grid` do cartão (linhas ~1924-1927):

```html
        <details class="fin-dia-card" id="fin-dia-card">
          <summary><span class="linha-titulo" id="fin-dia-titulo">💰 Financeiro do dia</span><span class="fin-chip" id="fin-dia-chip"></span></summary>
          <div class="fin-dia-grid">
            <div id="fin-modo-sel" class="fin-modo" style="display:none;"></div>
            <p class="fin-dica" id="fin-dia-escopo" style="display:none;"></p>
            <p class="fin-dica" id="fin-dia-dica" style="display:none;">Valores sugeridos a partir do dia anterior — toque em Salvar para confirmar.</p>
```

(o resto do cartão — campos de valor/PIX/quadra/brinde, seletor de ícone, botão Salvar, linha de "sem jogo" — continua exatamente igual.)

- [ ] **Step 2: `cfgOuHerdadaDaChave` e `chaveFinanceiroAtiva`** — logo antes de `function renderFinDiaCard(){` (linha ~7626)

```js
// chave 2: o 2º jogo herda os valores do 1º (separado, ainda não salvo); null/1: comportamento de sempre
// (herda do dia anterior mais recente)
function cfgOuHerdadaDaChave(chave){
  const data = SETTINGS.checkinDataAberta;
  if(chave === 2){
    const exato = cfgFinDaChave(FINANCEIRO, data, 2);
    if(exato) return { dia: exato, herdado: false };
    const j1 = cfgFinDaChave(FINANCEIRO, data, 1);
    return { dia: j1, herdado: !!j1 };
  }
  return finDiaOuHerdado(FINANCEIRO, data);
}
// a chave que o cartão/resumo/pagamentos usam AGORA: null com 1 jogo ou no modo único; o número da aba no separado
function chaveFinanceiroAtiva(){
  const data = SETTINGS.checkinDataAberta;
  if(jogosDoDia(SETTINGS, CHECKINS, data).length < 2) return null;
  const diaAtual = finDia(FINANCEIRO, data);
  return (diaAtual && diaAtual.porJogo) ? JOGO_ATIVO : null;
}
```

- [ ] **Step 3: Reescrever `renderFinDiaCard()`**

```js
function renderFinDiaCard(){
  const card = document.getElementById('fin-dia-card');
  if(!card) return;
  const data = SETTINGS.checkinDataAberta;
  card.style.display = data ? '' : 'none';
  if(!data) return;
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const dois = jogos.length > 1;
  const chave = chaveFinanceiroAtiva();
  const porJogo = chave !== null || (dois && !!(finDia(FINANCEIRO, data) || {}).porJogo);
  const { dia, herdado } = cfgOuHerdadaDaChave(chave);
  const jHoje = jogos.find(j => j.numero === JOGO_ATIVO) || jogos[0];
  const foco = document.activeElement;
  const preencher = (id, v)=>{ const el = document.getElementById(id); if(el && el !== foco) el.value = v; };
  preencher('fin-valor-pessoa', dia && dia.valorPessoa ? dia.valorPessoa : '');
  preencher('fin-pix', dia ? dia.pix : '');
  preencher('fin-valor-quadra', dia && dia.valorQuadra ? dia.valorQuadra : '');
  preencher('fin-valor-brinde', dia && dia.valorBrinde ? dia.valorBrinde : '');
  marcarIconeAtivoNoCartao(finIconeDoCartao(dia));
  const chip = document.getElementById('fin-dia-chip');
  const semJogo = !herdado && finSemJogo(dia);
  chip.textContent = semJogo ? 'sem jogo 🌧️' : (herdado ? 'pendente' : (dia ? 'salvo ✓' : 'não configurado'));
  chip.classList.toggle('ok', !!dia && !herdado && !semJogo);
  chip.classList.toggle('pendente', !!herdado);
  document.getElementById('fin-dia-dica').style.display = herdado ? '' : 'none';
  const linha = document.getElementById('fin-semjogo-linha');
  linha.style.display = (dia && !herdado) ? '' : 'none';
  const btn = document.getElementById('fin-semjogo-btn');
  btn.textContent = semJogo ? ('☀️ Reabrir ' + (chave ? 'jogo' : 'dia')) : ('🌧️ ' + (chave ? `Jogo das ${jHoje.horario} sem jogo` : 'Dia sem jogo'));
  btn.dataset.acao = semJogo ? 'reabrir' : 'marcar';
  const titulo = document.getElementById('fin-dia-titulo');
  if(titulo) titulo.textContent = chave ? `💰 Financeiro do dia · ${jHoje.horario}` : '💰 Financeiro do dia';
  const modoSel = document.getElementById('fin-modo-sel');
  if(modoSel){
    modoSel.style.display = dois ? '' : 'none';
    if(dois){
      const nPag = (FINANCEIRO.pagamentos || []).filter(p => p.data === data && !p.estornado).length;
      modoSel.innerHTML = `<div class="fin-campo">Como cobrar os 2 jogos?</div>
        <label class="fin-opcao"><input type="radio" name="fin-modo" value="unico" ${!porJogo?'checked':''} ${nPag ? 'disabled' : ''}><span><strong>Um financeiro para o dia</strong> (padrão)<br><small>Um valor, PIX e quadra para os dois jogos. Quem joga os dois paga <strong>uma vez</strong>.</small></span></label>
        <label class="fin-opcao"><input type="radio" name="fin-modo" value="separado" ${porJogo?'checked':''} ${nPag ? 'disabled' : ''}><span><strong>Separado por jogo</strong><br><small>Cada jogo com valor, PIX, quadra, brinde e "sem jogo" próprios.</small></span></label>
        ${nPag ? `<p class="fin-dica" style="display:block;">🔒 Já há ${nPag} pagamento(s) neste dia. Para trocar, use "Cancelar todos" antes (nada é apagado, vira estorno).</p>` : ''}`;
    }
  }
  const escopo = document.getElementById('fin-dia-escopo');
  if(escopo){
    escopo.style.display = dois ? 'block' : 'none';
    if(dois) escopo.textContent = chave ? `Valores do jogo das ${jHoje.horario}.` : 'Valores do dia (valem para os 2 jogos).';
  }
}
document.getElementById('fin-modo-sel').addEventListener('change', async (e)=>{
  if(e.target.name !== 'fin-modo') return;
  const novoPorJogo = e.target.value === 'separado';
  const data = SETTINGS.checkinDataAberta;
  const atual = cfgFinDaChave(FINANCEIRO, data, 1) || finDiaOuHerdado(FINANCEIRO, data).dia || { valorPessoa:'', pix:'', valorQuadra:'', valorBrinde:'', icone:'✅' };
  const ok = await finPost('salvarFinDia', { dia: { data, valorPessoa: atual.valorPessoa, pix: atual.pix, valorQuadra: atual.valorQuadra,
    valorBrinde: atual.valorBrinde, temBrinde: finCentavos(atual.valorBrinde) > 0, icone: atual.icone, porJogo: novoPorJogo } });
  if(ok) mostrarToast(novoPorJogo ? 'Separado: cada aba tem o seu financeiro.' : 'Um financeiro para o dia.', 'sucesso');
  renderFinDiaCard();
});
```

- [ ] **Step 4: Trocar os três handlers que gravam/leem o financeiro do cartão** — `#fin-salvar-dia-btn`, `#fin-semjogo-btn` (via `abrirDiaSemJogo`/`reabrirDiaFinanceiro`)

```js
document.getElementById('fin-salvar-dia-btn').addEventListener('click', async ()=>{
  const data = SETTINGS.checkinDataAberta;
  if(!data) return;
  const chave = chaveFinanceiroAtiva();
  const valorBrinde = document.getElementById('fin-valor-brinde').value;
  const dia = {
    data, jogo: chave === 2 ? 2 : undefined, porJogo: chave === null ? undefined : (chave === 1 ? true : undefined),
    valorPessoa: document.getElementById('fin-valor-pessoa').value,
    pix: document.getElementById('fin-pix').value.trim(),
    valorQuadra: document.getElementById('fin-valor-quadra').value,
    valorBrinde, temBrinde: finCentavos(valorBrinde) > 0,
    icone: finIconeDoCartao(cfgOuHerdadaDaChave(chave).dia)
  };
  if(await finPost('salvarFinDia', { dia })){
    FIN_ICONE_ESCOLHIDO = null;
    renderFinDiaCard();
    const jHoje = (jogosDoDia(SETTINGS, CHECKINS, data).find(j => j.numero === JOGO_ATIVO) || {}).horario;
    mostrarToast(chave ? `Financeiro do jogo das ${jHoje} salvo.` : 'Financeiro do dia salvo.', 'sucesso');
  }
});

function abrirDiaSemJogo(){
  const data = SETTINGS.checkinDataAberta;
  if(!data) return;
  const chave = chaveFinanceiroAtiva();
  const view = finViewDaChave(FINANCEIRO, data, chave);
  const dinheiro = finPagamentosValidos(view, data).filter(p => finTipoPagamento(p) === 'dinheiro');
  const total = dinheiro.reduce((s, p) => s + finCentavos(p.valor), 0);
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const jHoje = (jogos.find(j => j.numero === JOGO_ATIVO) || {}).horario;
  const titulo = chave ? `Jogo das ${jHoje} sem jogo 🌧️` : 'Dia sem jogo 🌧️';
  const outro = chave ? (jogos.find(j => j.numero !== chave) || {}).horario : '';
  const corpo = `<p style="margin:0;font-size:13px;color:var(--muted);line-height:1.5;">Use quando <strong>não houve jogo</strong> (chuva, poucos jogadores). A <strong>quadra${chave ? '' : ' e o brinde'}</strong> deix${chave ? 'a' : 'am'} de contar ${chave ? 'neste jogo' : 'neste dia'}.${chave ? ` O jogo das ${outro} continua normal.` : ''}</p>`
    + (dinheiro.length
      ? `<div class="fin-campo">O que fazer com os ${dinheiro.length} pagamento(s) já recebido(s) (${finFormatar(total)})?</div>
         <label class="fin-opcao"><input type="radio" name="fin-sj-destino" value="credito" checked><span><strong>Guardar como crédito</strong> (recomendado)<br><small>Cada pessoa aparece já paga, com "(Crédito)", no próximo check-in em que confirmar presença.</small></span></label>
         <label class="fin-opcao"><input type="radio" name="fin-sj-destino" value="devolver"><span><strong>Devolver</strong> (estornar todos)<br><small>O valor sai do caixa.${ehAdminAgora() ? '' : ' Como organizador, quem já saiu da lista não é estornado (só o admin).'}</small></span></label>`
      : `<p style="margin:0;font-size:13px;color:var(--muted);">Ninguém pagou neste dia, então não há nada a guardar ou devolver.</p>`)
    + (!chave && jogos.length > 1 ? `<p style="color:var(--ball-yellow);font-size:12px;margin:10px 0 0;">Se só UM dos jogos não vai acontecer, use "Separado por jogo" antes de marcar — assim você marca só o jogo certo.</p>` : '');
  finAbrirModal(titulo, corpo, async (ov)=>{
    const sel = ov.querySelector('input[name="fin-sj-destino"]:checked');
    const destino = sel ? sel.value : 'credito';
    if(!(await finPost('marcarDiaSemJogo', { data, jogo: chave, destino }))) return false;
    const r = ULTIMA_RESPOSTA_POST || {};
    mostrarToast(destino === 'devolver'
      ? (r.estornados || 0) + ' pagamento(s) devolvido(s).' + (r.ignorados ? ' ' + r.ignorados + ' de quem saiu da lista ficou (só o admin devolve).' : '')
      : (r.creditos ? r.creditos + ' pagamento(s) guardado(s) como crédito.' : 'Marcado como sem jogo.'), 'sucesso');
    return true;
  }, 'Marcar sem jogo');
}
async function reabrirDiaFinanceiro(data){
  const chave = chaveFinanceiroAtiva();
  if(!confirm(`Reabrir ${chave ? 'este jogo' : 'este dia'}?\n\nA quadra${chave ? '' : ' e o brinde'} volta${chave ? '' : 'm'} a contar, e os créditos ${chave ? 'dele' : 'deste dia'} (que ainda não foram usados) voltam a ser pagamentos comuns.`)) return;
  if(await finPost('reabrirDia', { data, jogo: chave })) mostrarToast((chave ? 'Jogo' : 'Dia') + ' reaberto.', 'sucesso');
}
```

(o `document.getElementById('fin-semjogo-btn').addEventListener('click', ...)` que chama essas duas funções **não muda**.)

- [ ] **Step 5: Validar sintaxe**

Run: (comando de validação do topo da Parte E)
Expected: sem erro.

- [ ] **Step 6: Verificação manual** — com o demo de dados falsos (Task 13, Step 10): criar o 2º jogo, trocar para "Separado por jogo", conferir que o cartão mostra "💰 Financeiro do dia · 21:00" na aba de lá e os campos ficam vazios (ainda não salvos); salvar; trocar de aba e ver os valores do jogo 1 continuarem intactos; marcar um jogo como sem jogo e ver que o outro não muda.

- [ ] **Step 7: Commit**

```bash
git add volei-dashboard.html
git commit -m "front: cartão Financeiro do dia com único/separado e sem jogo por chave"
```

---

### Task 15: Resumo, Confirmados/Reserva com o botão ⇄, e ações em massa

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:**
- Consumes: `cfgOuHerdadaDaChave`, `chaveFinanceiroAtiva` (Task 14); `jogosDoDia`, `dentroEReservaDoJogo`, `confirmadosPelaChave`, `estaNoJogo`, `vagasLivresDoJogo`, `finViewDaChave`, `cfgFinDaChave` (Task 12); ação `moverCheckin` (Tasks 6/9).

- [ ] **Step 1: CSS do botão ⇄** — ver Task 19 (CSS); adiantar só a classe mínima pra não ficar sem estilo entre esta task e aquela:

Em `.tag-outro{...}` (linha ~1420 hoje, perto de `.jc-linha-tags`), acrescentar logo abaixo:

```css
  .btn-mover{margin-left:8px;font-size:11px;font-weight:700;color:var(--chalk);background:transparent;border:1px solid var(--line);border-radius:999px;padding:1px 9px;cursor:pointer;vertical-align:middle;}
  .btn-mover:hover{border-color:var(--accent);color:var(--accent);}
  .dica-vaga{margin:4px 0 10px;font-size:12px;color:var(--ball-yellow);}
```

- [ ] **Step 2: Reescrever `renderCheckinOrdenados()`**

```js
function renderCheckinOrdenados(){
  renderFinDiaCard();
  renderFinResumoCheckin();
  const data = SETTINGS.checkinDataAberta;
  const el = document.getElementById('checkin-ordenados');
  if(!data){ el.innerHTML = ''; return; }
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const jAtivo = jogos.find(j => j.numero === JOGO_ATIVO) || jogos[0];
  const outro = jogos.find(j => j.numero !== JOGO_ATIVO);
  const { dentro, reserva } = dentroEReservaDoJogo(CHECKINS, data, JOGO_ATIVO, jAtivo.vagas);
  const chave = chaveFinanceiroAtiva();
  const view = finViewDaChave(FINANCEIRO, data, chave);
  const dia = cfgFinDaChave(FINANCEIRO, data, chave);
  const cobrando = !!dia && !finSemJogo(dia) && finCentavos(dia.valorPessoa) > 0;
  const podeMarcar = cobrando && temPermissao('marcarPagamento');
  const podeMover = jogos.length > 1 && temPermissao('moverCheckin');
  const botaoMoverHtml = (c, horarioOutro) => podeMover && outro && !estaNoJogo(CHECKINS, data, outro.numero, c.jogadorId)
    ? `<button type="button" class="btn-mover" data-mover-checkin="${c.id}" data-mover-de="${JOGO_ATIVO}" data-mover-nome="${escapeHtml(c.jogadorNome || 'Convidado')}" data-mover-horario="${horarioOutro}" title="Mover ${escapeHtml(c.jogadorNome || 'Convidado')} para o jogo das ${horarioOutro}">⇄ ${horarioOutro}</button>` : '';
  const tagOutroHtml = (c) => (outro && estaNoJogo(CHECKINS, data, outro.numero, c.jogadorId))
    ? `<span class="tag-outro" title="Também está no jogo das ${outro.horario}">+${outro.horario}</span>` : '';
  let html = '';
  if(dentro.length){
    html += `<div style="margin:8px 0;"><strong style="font-size:13px;">✅ Confirmados${jogos.length > 1 ? ` — ${jAtivo.horario}` : ''}</strong><ol class="fin-lista">`;
    dentro.forEach(c=>{
      const nome = c.jogadorNome || 'Convidado';
      const marcas = finMarcas(view, data, c.jogadorId);
      const porCredito = !!finRotuloCredito(view, data, c.jogadorId);
      const creditoDisp = (!marcas && cobrando) ? finCreditoDe(FINANCEIRO, c.jogadorId) : 0;
      const dica = marcas ? (porCredito ? 'desmarcar o pagamento por crédito (o crédito volta ao saldo)' : 'desmarcar o pagamento') : 'marcar o pagamento';
      const atrib = podeMarcar ? ` class="fin-toque" role="button" tabindex="0" data-fin-jogador="${escapeHtml(c.jogadorId)}" data-fin-nome="${escapeHtml(nome)}" title="Toque para ${dica}"` : '';
      html += `<li${atrib}>${escapeHtml(nome)}${marcas ? `<span class="fin-marca" title="Pago">${marcas}</span>` : ''}`
        + (porCredito ? '<span class="fin-credito-tag" title="Pago com crédito de um dia sem jogo">(Crédito)</span>' : '')
        + (creditoDisp ? `<span class="fin-credito-tag" title="Tem crédito de um dia sem jogo que ainda não cobre este dia">🎟️ crédito ${finFormatar(creditoDisp)}</span>` : '')
        + tagOutroHtml(c) + botaoMoverHtml(c, outro ? outro.horario : '') + '</li>';
    });
    html += '</ol></div>';
  }
  if(reserva.length){
    html += `<div style="margin:8px 0;"><strong style="font-size:13px;">⏳ Reserva</strong><ol style="margin:6px 0 0;padding-left:22px;font-size:13px;">`;
    reserva.forEach(c=>{
      html += `<li>${escapeHtml(c.jogadorNome || 'Convidado')}${tagOutroHtml(c)}${botaoMoverHtml(c, outro ? outro.horario : '')}</li>`;
    });
    html += '</ol></div>';
    if(outro && !outro.travado){
      const livre = vagasLivresDoJogo(CHECKINS, data, outro.numero, outro.vagas);
      if(livre > 0) html += `<div class="dica-vaga">💡 O jogo das ${outro.horario} ainda tem ${livre} vaga(s).</div>`;
    }
  }
  const sinalizados = finSinalizados(view, data, dentro);
  if(sinalizados.length){
    html += '<div class="fin-alerta"><strong>⚠️ Pagaram e não estão mais entre os confirmados</strong> <span style="color:var(--muted);">(o valor continua no caixa)</span>';
    sinalizados.forEach(p=>{
      html += `<div class="fin-alerta-linha"><span>${escapeHtml(p.jogadorNome || 'Convidado')} — ${finFormatar(finCentavos(p.valor))}</span>`
        + (ehAdminAgora() ? `<button type="button" class="btn secondary" data-fin-estornar="${escapeHtml(p.id)}" data-fin-nome="${escapeHtml(p.jogadorNome || 'Convidado')}" data-fin-valor="${finCentavos(p.valor)}">Estornar</button>` : '')
        + '</div>';
    });
    html += '</div>';
  }
  el.innerHTML = html;
}
```

- [ ] **Step 3: `alternarPagamentoCheckin` e o botão ⇄ no listener de `#checkin-ordenados`**

```js
async function alternarPagamentoCheckin(jogadorId, nome){
  const data = SETTINGS.checkinDataAberta;
  if(!data) return;
  const chave = chaveFinanceiroAtiva();
  const view = finViewDaChave(FINANCEIRO, data, chave);
  const pago = finPagamentoDe(view, data, jogadorId);
  if(pago){
    const porCredito = finTipoPagamento(pago) === 'credito';
    if(!confirm(porCredito ? 'Desmarcar o pagamento por CRÉDITO de ' + nome + '? O crédito volta ao saldo dela(e).' : 'Desmarcar o pagamento de ' + nome + '?')) return;
    await finPost('estornarPagamento', { id: pago.id });
  } else {
    await finPost('marcarPagamento', { data, jogo: chave, jogadorId, jogadorNome: nome });
  }
}

document.getElementById('checkin-ordenados').addEventListener('click', async (e)=>{
  const mover = e.target.closest('[data-mover-checkin]');
  if(mover){
    const nome = mover.dataset.moverNome, horario = mover.dataset.moverHorario;
    if(!confirm(`Mover ${nome} para o jogo das ${horario}?`)) return;
    const cred = await requireAuth('moverCheckin');
    if(!cred) return;
    const paraJogo = Number(mover.dataset.moverDe) === 1 ? 2 : 1;
    if(await postAction('moverCheckin', { id: mover.dataset.moverCheckin, paraJogo }, cred)){
      const c = CHECKINS.find(x => x.id === mover.dataset.moverCheckin);
      if(c) c.jogo = paraJogo;
      mostrarToast('Movido para o jogo das ' + horario + '.', 'sucesso');
      renderCheckinList();
    }
    return;
  }
  const est = e.target.closest('[data-fin-estornar]');
  if(est){
    const valor = finFormatar(Number(est.dataset.finValor));
    if(!confirm('Estornar o pagamento de ' + est.dataset.finNome + ' (' + valor + ')? O valor sai do caixa.')) return;
    await finPost('estornarPagamento', { id: est.dataset.finEstornar });
    return;
  }
  const li = e.target.closest('[data-fin-jogador]');
  if(li) await alternarPagamentoCheckin(li.dataset.finJogador, li.dataset.finNome);
});
document.getElementById('checkin-ordenados').addEventListener('keydown', async (e)=>{
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest('[data-fin-jogador]');
  if(!li) return;
  e.preventDefault();
  await alternarPagamentoCheckin(li.dataset.finJogador, li.dataset.finNome);
});
```

- [ ] **Step 4: `renderFinResumoCheckin` e `pagamentosEmMassa`**

```js
function renderFinResumoCheckin(){
  const el = document.getElementById('fin-resumo-checkin');
  if(!el) return;
  const data = SETTINGS.checkinDataAberta;
  const chave = chaveFinanceiroAtiva();
  const view = finViewDaChave(FINANCEIRO, data, chave);
  const dia = data ? cfgFinDaChave(FINANCEIRO, data, chave) : null;
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const jAtivo = jogos.find(j => j.numero === JOGO_ATIVO) || jogos[0];
  if(dia && finSemJogo(dia)){
    const dinheiro = finPagamentosValidos(view, data).filter(p => finTipoPagamento(p) === 'dinheiro');
    const total = dinheiro.reduce((s, p) => s + finCentavos(p.valor), 0);
    el.innerHTML = `<div class="fin-resumo fin-semjogo">
      <div class="fin-resumo-linha"><span>🌧️ <strong>${chave ? `Jogo das ${jAtivo.horario} sem jogo` : 'Dia sem jogo'}</strong></span></div>
      <div class="fin-resumo-sub">A quadra${chave ? '' : ' e o brinde'} ${chave ? 'não conta' : 'não contam'} neste ${chave ? 'jogo' : 'dia'}.${dinheiro.length ? ' ' + dinheiro.length + ' pagamento(s) já recebido(s) (' + finFormatar(total) + ') ficaram como crédito para o próximo check-in.' : ''}</div>
    </div>`;
    return;
  }
  if(!dia || !(finCentavos(dia.valorPessoa) > 0)){ el.innerHTML = ''; return; }
  const dentro = confirmadosPelaChave(SETTINGS, CHECKINS, data, chave);
  const arrecadado = finArrecadadoDia(view, data);
  const previsto = finPrevistoDia(view, data, dentro.length);
  const pct = previsto > 0 ? Math.min(100, Math.round(arrecadado / previsto * 100)) : 0;
  const pendentes = finPendentes(view, data, dentro).length;
  const validos = finPagamentosValidos(view, data).length;
  const escopoMsg = jogos.length > 1 ? ` <span style="color:var(--muted);font-size:11px;">· ${chave ? `jogo das ${jAtivo.horario}` : 'os 2 jogos'}</span>` : '';
  el.innerHTML = `<div class="fin-resumo">
    <div class="fin-resumo-linha"><span>💰 <strong>${finFormatar(finCentavos(dia.valorPessoa))}</strong> por pessoa${escopoMsg}</span>
      ${dia.pix ? `<button type="button" class="fin-pix" data-fin-copiar-pix="${escapeHtml(dia.pix)}" title="Copiar a chave PIX">📌 PIX ${escapeHtml(dia.pix)} <i class="ti ti-copy"></i></button>` : ''}</div>
    <div class="fin-barra"><div class="fin-barra-fill" style="width:${pct}%"></div></div>
    <div class="fin-resumo-sub fin-resumo-linha"><span>Arrecadado <strong>${finFormatar(arrecadado)}</strong> de ${finFormatar(previsto)}</span><span>Saída ${chave ? 'do jogo' : 'do dia'} ${finFormatar(finCentavos(dia.valorQuadra) + (dia.temBrinde ? finCentavos(dia.valorBrinde) : 0))}</span></div>
    ${temPermissao('marcarTodosPagamentos') ? `<div class="fin-massa">
      <button type="button" class="btn secondary" data-fin-massa="marcar" ${pendentes ? '' : 'disabled'} title="Marca como pago quem está confirmado e ainda não pagou">Confirmar todos (${pendentes})</button>
      <button type="button" class="btn danger" data-fin-massa="cancelar" ${validos ? '' : 'disabled'} title="Estorna todos os pagamentos deste dia">Cancelar todos (${validos})</button>
    </div>` : ''}
  </div>`;
}
document.getElementById('fin-resumo-checkin').addEventListener('click', (e)=>{
  const b = e.target.closest('[data-fin-copiar-pix]');
  if(b){ copiarTexto(b.dataset.finCopiarPix, b); return; }
  const massa = e.target.closest('[data-fin-massa]');
  if(massa && !massa.disabled) pagamentosEmMassa(massa.dataset.finMassa);
});

async function pagamentosEmMassa(tipo){
  const data = SETTINGS.checkinDataAberta;
  const chave = chaveFinanceiroAtiva();
  const view = finViewDaChave(FINANCEIRO, data, chave);
  const dia = data ? cfgFinDaChave(FINANCEIRO, data, chave) : null;
  if(!dia || !(finCentavos(dia.valorPessoa) > 0)){ alert('Cadastre o valor por pessoa do dia antes de marcar pagamentos.'); return; }
  const dentro = confirmadosPelaChave(SETTINGS, CHECKINS, data, chave);
  if(tipo === 'marcar'){
    const n = finPendentes(view, data, dentro).length;
    if(!n) return;
    const valor = finCentavos(dia.valorPessoa);
    if(!confirm('Marcar como PAGO os ' + n + ' confirmado(s) que ainda não pagaram?\n\n' + n + ' × ' + finFormatar(valor) + ' = ' + finFormatar(n * valor))) return;
    if(await finPost('marcarTodosPagamentos', { data, jogo: chave })) mostrarToast(n + ' pagamento(s) marcado(s).', 'sucesso');
    return;
  }
  const validos = finPagamentosValidos(view, data);
  if(!validos.length) return;
  const total = validos.reduce((s, p) => s + finCentavos(p.valor), 0);
  let msg = 'CANCELAR TODOS os ' + validos.length + ' pagamentos' + (chave ? ' deste jogo' : ' deste dia') + ' (' + finFormatar(total) + ')?\n\nEles são estornados automaticamente e o valor sai do caixa. Nada é apagado: fica registrado na auditoria.';
  if(!ehAdminAgora()) msg += '\n\nComo organizador, os pagamentos de quem já saiu da lista NÃO são estornados (só o admin faz isso).';
  if(!confirm(msg)) return;
  if(await finPost('estornarTodosPagamentos', { data, jogo: chave })){
    const r = ULTIMA_RESPOSTA_POST || {};
    mostrarToast((r.estornados || 0) + ' pagamento(s) estornado(s).' + (r.ignorados ? ' ' + r.ignorados + ' de quem saiu da lista ficou (só o admin estorna).' : ''), 'sucesso');
  }
}
```

- [ ] **Step 5: Validar sintaxe**

Run: (comando de validação do topo da Parte E)
Expected: sem erro.

- [ ] **Step 6: Verificação manual** (demo de dados falsos): confirmar presença nos dois jogos; ver a etiqueta "+21:00" em quem está nos dois (sem botão ⇄); tocar ⇄ em alguém que está só num jogo e ver a troca refletir nas duas abas; no modo único, pagar na aba 19:00 e trocar pra 21:00 — a pessoa (se estiver lá) deve aparecer paga também; "Confirmar todos"/"Cancelar todos" com 2 jogos no modo único cobrindo a união.

- [ ] **Step 7: Commit**

```bash
git add volei-dashboard.html
git commit -m "front: resumo/Confirmados/Reserva por jogo + botão ⇄ + ações em massa por chave"
```

---

### Task 16: Lista de busca, convidado, lista colada do WhatsApp, Desconfirmar todos, importar no Sorteio, ajustar estrelas

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:**
- Consumes: `jogosDoDia`, `dentroEReservaDoJogo`, `checkinsDoJogo`, `estaNoJogo` (Task 12); `JOGO_ATIVO` (Task 13).
- Produces: `checkinsOrdenados(data)`/`checkinsDentroEReserva(data)` passam a ser **"atalhos" para o jogo ativo** — toda função que já os chamava (a maioria da tela) passa a respeitar a aba automaticamente, sem precisar ser reescrita uma por uma.

- [ ] **Step 1: Redefinir `checkinsOrdenados`/`checkinsDentroEReserva` como atalhos do jogo ativo** (linhas ~7536-7543 hoje) — esta é a mudança que resolve a maior parte da tela de uma vez:

```js
// Dois jogos no mesmo dia: estas duas funções passam a devolver a fila do JOGO_ATIVO (a aba). Como quase toda a
// tela (busca, convidado, lista colada, Desconfirmar todos não — ver abaixo, importar no Sorteio, ajustar estrelas)
// já chamava uma delas, a aba passa a valer em todo canto sem precisar reescrever cada chamada.
function checkinsOrdenados(data){
  return checkinsDoJogo(CHECKINS, data, JOGO_ATIVO);
}
function checkinsDentroEReserva(data){
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const j = jogos.find(x => x.numero === JOGO_ATIVO) || jogos[0];
  return dentroEReservaDoJogo(CHECKINS, data, JOGO_ATIVO, j.vagas);
}
```

- [ ] **Step 2: `renderCheckinList()` — "Vou jogar" grava no jogo ativo; mostra "também às HH:MM" de quem está no outro jogo**

```js
function renderCheckinList(){
  const data = SETTINGS.checkinDataAberta;
  const list = document.getElementById('checkin-list');

  document.getElementById('ajustar-estrelas-checkin-btn').style.display =
    (temPermissao('salvarEstrelasAjustadas') && data) ? 'inline-block' : 'none';

  if(!data){
    list.innerHTML = '';
    document.getElementById('checkin-counter-num').textContent = '0';
    document.getElementById('checkin-counter-label').textContent = 'confirmado(s)';
    renderCheckinOrdenados();
    return;
  }

  atualizarBotaoDesconfirmarTodos();
  const term = document.getElementById('checkin-search').value;
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const jAtivo = jogos.find(j => j.numero === JOGO_ATIVO) || jogos[0];
  const outro = jogos.find(j => j.numero !== JOGO_ATIVO);
  const { dentro, reserva } = checkinsDentroEReserva(data);
  const confirmadosHoje = new Set(dentro.concat(reserva).map(c=>c.jogadorId));
  const dentroIds = new Set(dentro.map(c=>c.jogadorId));
  const vagas = jAtivo.vagas;
  document.getElementById('checkin-counter-num').textContent = confirmadosHoje.size;
  document.getElementById('checkin-counter-label').textContent =
    `de ${vagas} vaga(s)${reserva.length ? ` (${reserva.length} na reserva)` : ''}${jogos.length > 1 ? ` · ${jAtivo.horario}` : ''}`;
  renderCheckinOrdenados();

  const pool = sortByName(DATA.players.concat(GUESTS)).filter(p=> normalizeStr(p.nome).includes(normalizeStr(term)) || normalizeStr(p.apelido||'').includes(normalizeStr(term)));
  if(pool.length===0){
    list.innerHTML = '<div class="empty"><i class="ti ti-users"></i>Nenhum jogador encontrado.</div>';
    return;
  }
  const mostrarEstrelas = starsVisibleNow();
  const travado = jAtivo.travado;
  const podeMarcar = AUTH.logado && !travado;
  list.innerHTML = pool.map(p=>{
    const confirmado = confirmadosHoje.has(p.id);
    const naReserva = confirmado && !dentroIds.has(p.id);
    const tambem = outro && estaNoJogo(CHECKINS, data, outro.numero, p.id);
    let rotulo = 'Vou jogar';
    if(confirmado) rotulo = naReserva ? '⏳ Reserva' : '✅ Confirmado';
    else if(travado) rotulo = '🔒 Travado';
    else if(!AUTH.logado) rotulo = '🔒 Entre pra confirmar';
    const botao = `<button type="button" class="btn ${confirmado && !naReserva?'':'secondary'}" style="padding:6px 12px;font-size:12px;" data-checkin-btn="${p.id}" ${podeMarcar?'':'disabled'}>
        ${rotulo}
      </button>`;
    const tagExtra = (p.isGuest ? '<span class="badge-guest">convidado</span>' : '') + (tambem ? `<span class="tag-outro" title="Também está no jogo das ${outro.horario}">também às ${outro.horario}</span>` : '');
    return `<label class="jc-linha" data-checkin-toggle="${p.id}">${jogadorCardHtml(
      montarDadosReduzido(p, mostrarEstrelas, {
        nomeHtml: highlightMatch(p.nome, term),
        apelidoHtml: p.apelido ? highlightMatch(p.apelido, term) : '',
        tagsExtraHtml: tagExtra,
        acoesHtml: botao
      }),
      { variante: 'reduzido', nomeAbrePerfil: false }
    )}</label>`;
  }).join('');
  if(!podeMarcar) return;
  list.querySelectorAll('[data-checkin-btn]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.preventDefault();
      const pid = btn.dataset.checkinBtn;
      const jaConfirmado = CHECKINS.find(c=> c.data===data && c.jogadorId===pid && (Number(c.jogo)||1)===JOGO_ATIVO);
      if(!jaConfirmado && !exigirLoginParaCheckin()) return;
      const cred = await credencialLogada();
      if(!cred) return;
      btn.disabled = true;
      if(jaConfirmado){
        const ok = await postAction('removeCheckin', {id: jaConfirmado.id}, cred);
        if(ok) CHECKINS = CHECKINS.filter(c=>c.id!==jaConfirmado.id);
      } else {
        const player = getPlayer(pid);
        const novoCheckin = { id: uid(), data, jogadorId: pid, jogadorNome: player ? (player.apelido||player.nome) : '', estrelas: player?player.estrelas:0, sexo: player?player.sexo:'', jogo: JOGO_ATIVO };
        CHECKINS.push(novoCheckin);
        const ok = await postAction('addCheckin', {checkin: novoCheckin}, cred);
        if(!ok) CHECKINS = CHECKINS.filter(c=>c.id!==novoCheckin.id);
      }
      renderCheckinList();
    });
  });
}
```

- [ ] **Step 3: Convidado — grava no jogo ativo**

No handler de `#add-checkin-guest-btn` (linha ~7503), trocar a checagem de trava e o `novoCheckin`:

```js
document.getElementById('add-checkin-guest-btn').addEventListener('click', async ()=>{
  const data = SETTINGS.checkinDataAberta;
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const jAtivo = jogos.find(j => j.numero === JOGO_ATIVO) || jogos[0];
  if(!data){ alert('O check-in está fechado no momento.'); return; }
  if(jAtivo.travado){ alert('O check-in está travado pelo admin no momento — não é possível incluir novos nomes.'); return; }
  if(!exigirLoginParaCheckin()) return;
  const cred = await credencialLogada();
  if(!cred) return;
  const nameInput = document.getElementById('checkin-guest-name');
  const genderSelect = document.getElementById('checkin-guest-gender');
  const starsEl = document.getElementById('checkin-guest-stars');
  const name = nameInput.value.trim();
  if(!name) return;
  const novoConvidado = { id: uid(), nome: name, apelido:'', foto:'', estrelas: parseFloat(starsEl.dataset.value) || 0, sexo: genderSelect.value || '', isGuest: true };
  GUESTS.push(novoConvidado);
  nameInput.value=''; genderSelect.value='';
  starsEl.dataset.value = 0;
  starsEl.querySelectorAll('button').forEach(b=>b.classList.remove('filled','half'));
  const novoCheckin = { id: uid(), data, jogadorId: novoConvidado.id, jogadorNome: name, estrelas: novoConvidado.estrelas, sexo: novoConvidado.sexo, jogo: JOGO_ATIVO };
  CHECKINS.push(novoCheckin);
  await postAction('addCheckin', {checkin: novoCheckin}, cred);
  renderCheckinList();
});
```

(a linha `<strong>Adicionar convidado...` do markup pode continuar igual; o rótulo "no jogo das HH:MM" é opcional e fica por conta da Task 19/CSS caso o usuário peça depois — não está no spec.)

- [ ] **Step 4: Lista colada do WhatsApp — confere "já confirmado" e grava SÓ no jogo ativo**

Em `confirmarListaDoGrupo` (trocar a linha de `naLista` e o `checkin` montado):

```js
async function confirmarListaDoGrupo(escolhas, aoProgresso = ()=>{}){
  const data = SETTINGS.checkinDataAberta;
  const cred = await credencialLogada();
  if(!cred) return { confirmados: 0, pulados: 0, falhas: escolhas.map(e=> e.texto) };
  let credReativar = null;
  const naLista = new Set(CHECKINS.filter(c=> c.data === data && (Number(c.jogo)||1) === JOGO_ATIVO).map(c=> c.jogadorId));
  let confirmados = 0, pulados = 0;
  const falhas = [];
  for(let i = 0; i < escolhas.length; i++){
    const e = escolhas[i];
    aoProgresso(i + 1, escolhas.length, e.texto);
    let jogadorId, nome, estrelas = 0, sexo = '';
    if(e.acao === 'convidado'){
      const convidado = { id: uid(), nome: e.texto, apelido: '', foto: '', estrelas: 0, sexo: '', isGuest: true };
      GUESTS.push(convidado);
      jogadorId = convidado.id;
      nome = e.texto;
    } else {
      if(naLista.has(e.id)){ pulados++; continue; }
      if(e.acao === 'reativar'){
        credReativar = credReativar || await requireAuth('restorePlayer');
        const removido = (DATA.removidos || []).find(p=> p.id === e.id);
        if(!credReativar || !removido || !(await postAction('restorePlayer', { id: e.id }, credReativar))){ falhas.push(e.texto); continue; }
        DATA.removidos = DATA.removidos.filter(p=> p.id !== e.id);
        DATA.players.push(removido);
      }
      const p = getPlayer(e.id);
      if(!p){ falhas.push(e.texto); continue; }
      jogadorId = p.id;
      nome = p.apelido || p.nome;
      estrelas = p.estrelas || 0;
      sexo = p.sexo || '';
    }
    const checkin = { id: uid(), data, jogadorId, jogadorNome: nome, estrelas, sexo, jogo: JOGO_ATIVO };
    CHECKINS.push(checkin);
    naLista.add(jogadorId);
    if(await postAction('addCheckin', { checkin }, cred)) confirmados++;
    else {
      CHECKINS = CHECKINS.filter(c=> c.id !== checkin.id);
      naLista.delete(jogadorId);
      falhas.push(e.texto);
    }
  }
  return { confirmados, pulados, falhas };
}
```

E no clique de `#lista-grupo-conferir-btn` (linha ~8321-8328), trocar `confirmados` para também só olhar o jogo ativo:

```js
document.getElementById('lista-grupo-conferir-btn').addEventListener('click', ()=>{
  const caixa = document.getElementById('lista-grupo-conferencia');
  const nomes = lerListaDoGrupo(document.getElementById('lista-grupo-texto').value);
  if(!nomes.length){ caixa.innerHTML = '<p class="lista-grupo-dica">Nenhum nome encontrado no texto colado.</p>'; return; }
  const data = SETTINGS.checkinDataAberta;
  const confirmados = new Set(CHECKINS.filter(c=> c.data === data && (Number(c.jogo)||1) === JOGO_ATIVO).map(c=> c.jogadorId));
  LISTA_GRUPO_LINHAS = montarConferencia(nomes, DATA.players, DATA.removidos || [], confirmados);
  renderConferenciaListaGrupo();
});
```

E o rótulo do `<summary>` ganha o jogo quando há 2 (markup, linha ~1977 — `atualizarBlocoListaGrupo` já esconde/mostra o bloco; aqui é só o texto, acrescentar um `<span>` e preenchê-lo em `atualizarBlocoListaGrupo`):

```html
        <summary><span class="linha-titulo">📋 Colar lista do WhatsApp</span><span id="lista-grupo-jogo"></span></summary>
```
```js
function atualizarBlocoListaGrupo(){
  const bloco = document.getElementById('lista-grupo-bloco');
  if(bloco) bloco.style.display = (SETTINGS.checkinDataAberta && !SETTINGS.checkinTravado && podeColarListaDoGrupo()) ? '' : 'none';
  const jogoEl = document.getElementById('lista-grupo-jogo');
  if(jogoEl){
    const jogos = jogosDoDia(SETTINGS, CHECKINS, SETTINGS.checkinDataAberta);
    jogoEl.textContent = jogos.length > 1 ? ` → jogo das ${(jogos.find(j=>j.numero===JOGO_ATIVO)||jogos[0]).horario}` : '';
  }
}
```
(nota: a condição original usa `!SETTINGS.checkinTravado`, que hoje era a trava "global"; a partir desta Parte E ela deixa de existir — a Task 13 remove `SETTINGS.checkinTravado` como a trava "do jogo 1" via `jAtivo.travado`, então trocar a condição para `!(jogosDoDia(SETTINGS,CHECKINS,SETTINGS.checkinDataAberta).find(j=>j.numero===JOGO_ATIVO)||{}).travado`, usando a trava do jogo ativo, não mais `SETTINGS.checkinTravado` isolado — mesma ideia da Task 14/15 em todo canto que olhava `SETTINGS.checkinTravado` sozinho.)

- [ ] **Step 5: "Desconfirmar todos" — só o jogo ativo**

```js
async function desconfirmarTodosDoDia(aoProgresso = ()=>{}){
  const data = SETTINGS.checkinDataAberta;
  const doDia = CHECKINS.filter(c=> c.data === data && (Number(c.jogo)||1) === JOGO_ATIVO);
  const cred = await credencialLogada();
  if(!cred) return { removidos: 0, falhas: doDia.map(c=> c.jogadorNome || '?') };
  let removidos = 0;
  const falhas = [];
  for(let i = 0; i < doDia.length; i++){
    const c = doDia[i];
    aoProgresso(i + 1, doDia.length, c.jogadorNome);
    if(await postAction('removeCheckin', { id: c.id }, cred)){ CHECKINS = CHECKINS.filter(x=> x.id !== c.id); removidos++; }
    else falhas.push(c.jogadorNome || '?');
  }
  return { removidos, falhas };
}
function atualizarBotaoDesconfirmarTodos(){
  const botao = document.getElementById('desconfirmar-todos-btn');
  if(!botao) return;
  const data = SETTINGS.checkinDataAberta;
  const jAtivo = (jogosDoDia(SETTINGS, CHECKINS, data).find(j=>j.numero===JOGO_ATIVO)) || { travado:false };
  botao.hidden = !(data && !jAtivo.travado && podeColarListaDoGrupo() && CHECKINS.some(c=> c.data === data && (Number(c.jogo)||1) === JOGO_ATIVO));
}
```

(O `confirm(...)` do listener de `#desconfirmar-todos-btn`, logo abaixo, já usa `doDia = CHECKINS.filter(c=>c.data===data)` — trocar essa linha pra incluir o filtro de jogo também, mesma mudança.)

- [ ] **Step 6: Importar no Sorteio — já segue a aba (via o atalho do Step 1); só o texto do alerta/label muda quando há 2 jogos**

`use-checkins-sorteio-btn` e `importarJogadoresDoCheckin` continuam chamando `checkinsDentroEReserva(data).dentro` — nenhuma mudança de lógica necessária. Opcional (sem teste dedicado): nos dois lugares, trocar o texto fixo do botão/alerta por uma versão que cita o horário quando `jogosDoDia(...).length > 1`, reaproveitando o padrão já usado nas outras tasks.

- [ ] **Step 7: `comEstrelaDoCheckin` — usa a nota ajustada DO JOGO ATIVO**

```js
function comEstrelaDoCheckin(player){
  const data = SETTINGS.checkinDataAberta;
  if(!data) return player;
  const checkin = CHECKINS.find(c=> c.data===data && c.jogadorId===player.id && (Number(c.jogo)||1)===JOGO_ATIVO && c.estrelasAjustadas);
  if(!checkin) return player;
  const ajustada = Number(checkin.estrelasAjustadas);
  if(!ajustada && ajustada!==0) return player;
  return Object.assign({}, player, { estrelas: ajustada, _estrelaAjustada: true });
}
```

(`abrirAjustarEstrelasCheckin` já usa `checkinsDentroEReserva(data)` — Step 1 resolve sozinho; só o texto "Vale só pro sorteio de ${formatDate(data)}" pode ganhar o horário do jogo quando houver 2, mesmo padrão opcional do Step 6.)

- [ ] **Step 8: "🔒 Travar lista" — trava o jogo ativo, não sempre o jogo 1**

Trocar o handler de `#toggle-checkin-lock-btn` (linha ~7446-7455): jogo 1 continua indo por `saveCheckinSettings` (`SETTINGS.checkinTravado`); jogo 2 vai por `salvarJogo2` (`checkinJogo2.travado`). O rótulo do botão (texto) passa a mostrar o horário quando há 2 jogos:

```js
document.getElementById('toggle-checkin-lock-btn').addEventListener('click', async ()=>{
  const data = SETTINGS.checkinDataAberta;
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const jAtivo = jogos.find(j => j.numero === JOGO_ATIVO) || jogos[0];
  const cred = await requireAuth(JOGO_ATIVO === 2 ? 'salvarJogo2' : 'saveCheckinSettings');
  if(!cred) return;
  const novoTravado = !jAtivo.travado;
  let ok;
  if(JOGO_ATIVO === 2){
    ok = await postAction('salvarJogo2', { jogo2: { data, horario: SETTINGS.checkinJogo2.horario, vagas: SETTINGS.checkinJogo2.vagas, travado: novoTravado } }, cred);
    if(ok) SETTINGS.checkinJogo2 = Object.assign({}, SETTINGS.checkinJogo2, { travado: novoTravado });
  } else {
    const anterior = SETTINGS.checkinTravado;
    SETTINGS.checkinTravado = novoTravado;
    ok = await postAction('saveCheckinSettings', { settings: SETTINGS }, cred);
    if(!ok) SETTINGS.checkinTravado = anterior;
  }
  renderCheckinStatus();
  renderCheckinList();
});
```

E, em `renderCheckinStatus()` (linha ~7404-7405), o texto do botão passa a citar o jogo quando há 2:

```js
  const lockBtn = document.getElementById('toggle-checkin-lock-btn');
  if(lockBtn){
    const jogos2 = jogosDoDia(SETTINGS, CHECKINS, data);
    const jAtivo2 = jogos2.find(j => j.numero === JOGO_ATIVO) || jogos2[0];
    lockBtn.textContent = (jAtivo2 && jAtivo2.travado ? '🔓 Destravar' : '🔒 Travar') + (jogos2.length > 1 ? ` ${jAtivo2.horario}` : ' lista');
  }
```

- [ ] **Step 9: Validar sintaxe**

Run: (comando de validação do topo da Parte E)
Expected: sem erro.

- [ ] **Step 10: Verificação manual** (demo de dados falsos): colar uma lista do WhatsApp na aba das 21:00 e ver que só confirma lá; "Desconfirmar todos" na aba das 19:00 não mexe na reserva das 21:00; buscar um nome que está nos dois jogos e ver "também às 21:00"; importar confirmados pro Sorteio a partir da aba das 21:00 e ver que só eles entram; travar a aba das 21:00 e confirmar que a das 19:00 continua liberada.

- [ ] **Step 11: Commit**

```bash
git add volei-dashboard.html
git commit -m "front: busca, convidado, lista colada, Desconfirmar todos e Sorteio respeitam a aba ativa"
```

---

### Task 17: Mensagem do WhatsApp — uma mensagem com as duas listas (D4)

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:**
- Consumes: `corpoWhatsAppDoDia`, `jogosDoDia`, `checkinsDoJogo` (Task 12).

- [ ] **Step 1: Reescrever `preencherMensagemCheckin` e `montarTextoCheckinsWhatsApp`**

```js
// troca {diaSemana} {data} {horario} {vagas} pelos valores de verdade; com 2 jogos, {horario} vira "19:00 e 21:00"
// e {vagas} vira "16 + 12"
function preencherMensagemCheckin(template, data){
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const horario = jogos.map(j => j.horario).join(' e ');
  const vagas = jogos.map(j => j.vagas).join(' + ');
  return String(template || CHECKIN_MENSAGEM_PADRAO)
    .replace(/\{diaSemana\}/g, nomeDiaSemana(data))
    .replace(/\{data\}/g, dataCurta(data))
    .replace(/\{horario\}/g, horario)
    .replace(/\{vagas\}/g, vagas);
}

function montarTextoCheckinsWhatsApp(){
  const data = SETTINGS.checkinDataAberta;
  const temAlguem = jogosDoDia(SETTINGS, CHECKINS, data).some(j => checkinsDoJogo(CHECKINS, data, j.numero).length > 0);
  if(!temAlguem){ alert('Ninguém confirmou presença para essa data ainda.'); return ''; }
  return (preencherMensagemCheckin(SETTINGS.checkinMensagemTemplate, data) + '\n\n' + corpoWhatsAppDoDia(SETTINGS, CHECKINS, FINANCEIRO, data)).trim();
}
```

(as duas funções substituem por inteiro as versões de hoje; `corpoWhatsAppDoDia` já cuida de valor/PIX — único ou por jogo — e das listas numeradas de 1 ou 2 jogos, com `(Crédito)` e os ícones de quem pagou, testado na Task 12.)

- [ ] **Step 2: Validar sintaxe**

Run: (comando de validação do topo da Parte E)
Expected: sem erro.

- [ ] **Step 3: Verificação manual** (demo de dados falsos): com 1 jogo, compartilhar no WhatsApp continua idêntico a hoje; com 2 jogos e modo único, o texto sai com um cabeçalho de valor/PIX e duas listas, cada uma com "🏐 *JOGO DAS...*"; no separado, cada jogo tem seu próprio valor/PIX.

- [ ] **Step 4: Commit**

```bash
git add volei-dashboard.html
git commit -m "front: mensagem do WhatsApp com as duas listas (D4)"
```

---

### Task 18: Página Financeiro — blocos por jogo e fechamento

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:**
- Consumes: `finVisaoCaixa`, `fechamentoDoDia`, `finViewDaChave`, `cfgFinDaChave`, `confirmadosPelaChave`, `jogosDoDia` (Task 12); `chaveFinanceiroAtiva` não se aplica aqui (a página mostra dias passados, não a aba ativa — cada dia usa o `porJogo` **dele**, não `JOGO_ATIVO`).

- [ ] **Step 1: `finBlocoChave` — o bloco de UMA chave (saída, pagamentos, pendentes), extraído de dentro de `finDiaHtml`**

Logo antes de `function finDiaHtml(data, pode, admin){` (linha ~7828):

```js
function finBlocoChave(data, chave, pode, admin, rotulo){
  const fin = FINANCEIRO;
  const view = finViewDaChave(fin, data, chave);
  const cfg = cfgFinDaChave(fin, data, chave);
  const dentro = confirmadosPelaChave(SETTINGS, CHECKINS, data, chave);
  const sinal = new Set(finSinalizados(view, data, dentro).map(p => p.id));
  const pagamentos = finPagamentosRecentesPrimeiro(view.pagamentos || []);
  const pendentes = cfg && finCentavos(cfg.valorPessoa) > 0 ? finPendentes(view, data, dentro) : [];
  const semJogo = finSemJogo(cfg);
  let h = '<div class="fin-bloco">';
  if(rotulo) h += `<div class="fin-bloco-titulo">${rotulo}${semJogo ? ' <span class="fin-selo fin-selo-info">🌧️ sem jogo</span>' : ''}</div>`;
  if(semJogo && cfg){
    h += `<div class="fin-linha"><span class="fin-linha-meta">A quadra (${finFormatar(finCentavos(cfg.valorQuadra))})${cfg.temBrinde ? ' e o brinde (' + finFormatar(finCentavos(cfg.valorBrinde)) + ')' : ''} não contam. O dinheiro já recebido ficou como crédito (ou foi devolvido).</span></div>`;
    if(pode) h += `<div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="btn secondary" style="padding:4px 12px;font-size:12px;" data-fin-reabrir-dia="${data}" data-fin-reabrir-jogo="${chave ?? ''}">☀️ Reabrir</button>
      <button type="button" class="btn secondary" style="padding:4px 12px;font-size:12px;" data-fin-editar-dia="${data}" data-fin-editar-jogo="${chave ?? ''}">✏️ Editar</button></div>`;
  } else if(cfg){
    h += `<div class="fin-linha"><span class="fin-linha-nome">Quadra</span><span class="fin-linha-valor fin-neg">−${finFormatar(finCentavos(cfg.valorQuadra))}</span></div>
      ${cfg.temBrinde ? `<div class="fin-linha"><span class="fin-linha-nome">Brinde 🍫</span><span class="fin-linha-valor fin-neg">−${finFormatar(finCentavos(cfg.valorBrinde))}</span></div>` : ''}
      <div class="fin-linha"><span class="fin-linha-meta">${finFormatar(finCentavos(cfg.valorPessoa))} por pessoa${cfg.pix ? ' · PIX ' + escapeHtml(cfg.pix) : ''}</span></div>
      ${pode ? `<button type="button" class="btn secondary" style="padding:4px 12px;font-size:12px;" data-fin-editar-dia="${data}" data-fin-editar-jogo="${chave ?? ''}">✏️ Editar</button>` : ''}`;
  }
  h += '</div>';
  if(pagamentos.length){
    h += '<div class="fin-bloco"><div class="fin-bloco-titulo">Pagamentos</div>';
    pagamentos.forEach(p=>{
      const marcas = !p.estornado ? finMarcas(view, data, p.jogadorId) : '';
      const porCredito = finTipoPagamento(p) === 'credito';
      const cred = !porCredito ? (fin.creditos || []).find(c => c.origemPagamentoId === p.id && c.status !== 'cancelado') : null;
      let selo = '';
      if(cred && cred.status === 'devolvido') selo = '<span class="fin-selo fin-selo-info">crédito devolvido</span>';
      else if(cred) selo = finSaldoCredito(fin, cred) > 0 ? '<span class="fin-selo fin-selo-info">crédito ' + finFormatar(finSaldoCredito(fin, cred)) + '</span>' : '<span class="fin-selo fin-selo-info">crédito usado</span>';
      h += `<div class="fin-linha ${p.estornado ? 'fin-estornado' : ''}">
        <span class="fin-linha-nome">${escapeHtml(p.jogadorNome || 'Convidado')} ${marcas}${porCredito ? ' <span class="fin-credito-tag" title="Pago com crédito de um dia sem jogo: não é dinheiro novo (já estava no caixa)">(Crédito)</span>' : ''}</span>
        ${selo}${sinal.has(p.id) ? '<span class="fin-selo">fora da lista</span>' : ''}
        ${admin && sinal.has(p.id) ? `<button type="button" class="btn secondary" data-fin-estornar="${escapeHtml(p.id)}" data-fin-nome="${escapeHtml(p.jogadorNome || 'Convidado')}" data-fin-valor="${finCentavos(p.valor)}">Estornar</button>` : ''}
        ${porCredito ? `<span class="fin-linha-valor" style="color:var(--muted);">🎟️ ${finFormatar(finCentavos(p.valor))}</span>` : `<span class="fin-linha-valor fin-pos">+${finFormatar(finCentavos(p.valor))}</span>`}
        <span class="fin-linha-meta">${p.estornado ? `estornado por ${escapeHtml(p.estornadoPor)} em ${finQuando(p.estornadoEm)} · ` : ''}marcado por ${escapeHtml(p.marcadoPor)} em ${finQuando(p.marcadoEm)}</span></div>`;
    });
    h += '</div>';
  }
  if(pendentes.length){
    h += `<div class="fin-bloco"><div class="fin-bloco-titulo">Ainda não pagaram (${pendentes.length})</div><div class="fin-pendentes">${pendentes.map(c=>`<span>${escapeHtml(c.jogadorNome || 'Convidado')}</span>`).join('')}</div></div>`;
  }
  return h;
}
```

- [ ] **Step 2: Reescrever `finDiaHtml(data, pode, admin)`** — um bloco por jogo quando `porJogo`; senão, o mesmo bloco de hoje (`chave = null`)

```js
function finDiaHtml(data, pode, admin){
  const fin = FINANCEIRO;
  const diaRow = finDia(fin, data);
  const porJogo = !!(diaRow && diaRow.porJogo);
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const dois = porJogo && jogos.length > 1;
  const visaoCaixa = finVisaoCaixa(fin);
  const validosTotal = (fin.pagamentos || []).filter(p => p.data === data && !p.estornado).length;
  const resultado = finResultadoDia(visaoCaixa, data) + finAvulsosDia(visaoCaixa, data);
  let h = `<details class="fin-dia"><summary><span class="fin-dia-data">${formatDate(data)}</span>
    ${dois ? '<span class="fin-selo fin-selo-info">2 jogos</span>' : ''}
    <span class="fin-dia-n">${validosTotal} pagamento${validosTotal === 1 ? '' : 's'}</span>
    <button type="button" class="fin-copiar" data-fin-copiar-resumo="${data}" title="Copiar o resumo do dia para enviar no grupo" aria-label="Copiar o resumo do dia ${formatDate(data)}"><i class="ti ti-copy"></i></button>
    <span class="fin-dia-res ${finClasseValor(resultado)}">${finFormatar(resultado)}</span></summary><div class="fin-dia-corpo">`;
  if(dois) jogos.forEach(j => { h += finBlocoChave(data, j.numero, pode, admin, `⏰ Jogo das ${j.horario}`); });
  else h += finBlocoChave(data, null, pode, admin, null);
  const avulsos = (fin.lancamentos || []).filter(l => l.data === data);
  if(avulsos.length){
    h += '<div class="fin-bloco"><div class="fin-bloco-titulo">Lançamentos avulsos</div>';
    avulsos.forEach(l=>{
      const cls = l.tipo === 'entrada' ? 'fin-pos' : 'fin-neg';
      h += `<div class="fin-linha ${l.estornado ? 'fin-estornado' : ''}">
        <span class="fin-linha-nome">${escapeHtml(l.descricao)}</span>
        ${admin && !l.estornado ? `<button type="button" class="btn secondary" data-fin-estornar-lanc="${escapeHtml(l.id)}" data-fin-nome="${escapeHtml(l.descricao)}">Estornar</button>` : ''}
        <span class="fin-linha-valor ${cls}">${l.tipo === 'entrada' ? '+' : '−'}${finFormatar(finCentavos(l.valor))}</span>
        <span class="fin-linha-meta">${l.estornado ? `estornado por ${escapeHtml(l.estornadoPor)} em ${finQuando(l.estornadoEm)} · ` : ''}lançado por ${escapeHtml(l.criadoPor)} em ${finQuando(l.criadoEm)}</span></div>`;
    });
    h += '</div>';
  }
  return h + '</div></details>';
}
```

- [ ] **Step 3: Reescrever `renderFinanceiro()`** (saldo, saldo previsto — soma os 2 jogos quando separado — e extrato pela visão mesclada do caixa)

```js
function renderFinanceiro(){
  const topo = document.getElementById('fin-topo');
  if(!topo) return;
  const liberado = podeVerFinanceiro();
  document.getElementById('fin-bloqueado').style.display = liberado ? 'none' : '';
  document.getElementById('fin-conteudo').style.display = liberado ? '' : 'none';
  if(!liberado){
    ['fin-topo', 'fin-acoes', 'fin-extrato', 'fin-creditos-lista', 'fin-auditoria-lista'].forEach(id => { document.getElementById(id).innerHTML = ''; });
    return;
  }
  const visaoCaixa = finVisaoCaixa(FINANCEIRO);
  const pode = temPermissao('addLancamento');
  const admin = ehAdminAgora();
  const caixa = finCaixa(visaoCaixa);
  const hoje = new Date();
  const mes = finResumoMes(visaoCaixa, hoje.getFullYear(), hoje.getMonth() + 1);
  const dataAberta = SETTINGS.checkinDataAberta;
  let prev = null;
  if(dataAberta){
    const diaAberto = finDia(FINANCEIRO, dataAberta);
    const jogosHoje = jogosDoDia(SETTINGS, CHECKINS, dataAberta);
    if(diaAberto && diaAberto.porJogo){
      let pendentes = 0, aReceber = 0;
      jogosHoje.forEach(j => {
        const view = finViewDaChave(FINANCEIRO, dataAberta, j.numero);
        const dentro = dentroEReservaDoJogo(CHECKINS, dataAberta, j.numero, j.vagas).dentro;
        const p = finSaldoPrevisto(view, dataAberta, dentro);
        if(p){ pendentes += p.pendentes; aReceber += p.aReceber; }
      });
      prev = { caixa, pendentes, aReceber, previsto: caixa + aReceber };
    } else {
      const view = finViewDaChave(FINANCEIRO, dataAberta, null);
      const dentro = confirmadosPelaChave(SETTINGS, CHECKINS, dataAberta, null);
      const p = finSaldoPrevisto(view, dataAberta, dentro);
      prev = p ? { caixa, pendentes: p.pendentes, aReceber: p.aReceber, previsto: caixa + p.aReceber } : null;
    }
  }
  let previstoHtml = '';
  if(prev){
    const n = prev.pendentes;
    previstoHtml = `<div class="fin-previsto">
      <div class="fin-previsto-rotulo">Saldo previsto</div>
      <div class="fin-previsto-valor ${prev.previsto < 0 ? 'neg' : ''}">${finFormatar(prev.previsto)}</div>
      <div class="fin-previsto-sub">${n
        ? `quando os <strong>${n} pendente${n === 1 ? '' : 's'}</strong> do check-in de ${formatDate(dataAberta)} pagarem (<span class="fin-pos">+${finFormatar(prev.aReceber)}</span> a receber)`
        : `todos do check-in de ${formatDate(dataAberta)} já pagaram — nada a receber`}</div>
    </div>`;
  } else if(dataAberta && finSemJogo(finDia(FINANCEIRO, dataAberta))){
    previstoHtml = `<div class="fin-previsto fin-previsto-vazio">Saldo previsto: o check-in de ${formatDate(dataAberta)} está marcado como <strong>sem jogo</strong>, então não há o que cobrar.</div>`;
  } else if(dataAberta){
    previstoHtml = `<div class="fin-previsto fin-previsto-vazio">Saldo previsto: cadastre o valor por pessoa do check-in de ${formatDate(dataAberta)} para ver a previsão.</div>`;
  }
  const totalCred = finTotalCreditos(visaoCaixa);
  const creditosHtml = totalCred > 0
    ? `<div class="fin-creditos"><span>🎟️ Créditos de jogadores: <strong>${finFormatar(totalCred)}</strong></span><span>Saldo livre (caixa − créditos): <strong>${finFormatar(finSaldoLivre(visaoCaixa))}</strong></span></div>` : '';
  topo.innerHTML = `<div class="fin-saldo">
    <div class="fin-saldo-rotulo">Saldo do caixa</div>
    <div class="fin-saldo-valor ${caixa < 0 ? 'neg' : ''}">${finFormatar(caixa)}</div>
    <div class="fin-saldo-mes"><span>Este mês: <span class="fin-pos">+${finFormatar(mes.entradas)}</span></span><span><span class="fin-neg">−${finFormatar(mes.saidas)}</span> saídas</span></div>
    ${creditosHtml}
    ${previstoHtml}
  </div>`;
  const creds = finCreditosDisponiveis(visaoCaixa);
  document.getElementById('fin-creditos-sec').style.display = creds.length ? '' : 'none';
  document.getElementById('fin-creditos-lista').innerHTML = creds.map(c => {
    const saldo = finSaldoCredito(visaoCaixa, c);
    const inteiro = saldo === finCentavos(c.valor);
    return `<div class="fin-linha"><span class="fin-linha-nome">${escapeHtml(c.jogadorNome || 'Convidado')}</span>
      <span class="fin-linha-meta" style="flex-basis:auto;">de ${formatDate(c.dataOrigem)}${inteiro ? '' : ' · já usado em parte'}</span>
      ${admin && inteiro ? `<button type="button" class="btn secondary" data-fin-devolver-credito="${escapeHtml(c.id)}" data-fin-nome="${escapeHtml(c.jogadorNome || 'Convidado')}" data-fin-valor="${saldo}">Devolver</button>` : ''}
      <span class="fin-linha-valor" style="color:var(--accent);">${finFormatar(saldo)}</span></div>`;
  }).join('');
  document.getElementById('fin-acoes').innerHTML = pode
    ? '<button type="button" class="btn" id="fin-lancar-btn">+ Lançar</button><button type="button" class="btn secondary" id="fin-ajustar-btn">Ajustar caixa</button>' : '';
  const datas = finDatas(visaoCaixa);
  document.getElementById('fin-extrato').innerHTML = datas.length
    ? datas.map(d => finDiaHtml(d, pode, admin)).join('')
    : '<div class="empty"><i class="ti ti-coin"></i>Nenhum movimento ainda. Configure o "Financeiro do dia" no Check-in ou faça um lançamento.</div>';
  document.getElementById('fin-auditoria-lista').innerHTML = (FINANCEIRO.log || []).length
    ? FINANCEIRO.log.map(l => `<div class="fin-log-item"><span class="fin-log-quando">${finQuando(l.timestamp)}</span><strong>${escapeHtml(l.nome)}</strong> ${FIN_ACOES_ROTULO[l.acao] || escapeHtml(l.acao)}: ${finDetalheLegivel(l.acao, l.detalhe)}</div>`).join('')
    : '<div class="empty" style="padding:20px;">Sem ações registradas ainda.</div>';
}
```

- [ ] **Step 4: Editar dia e reabrir, pelo extrato — ganham o `jogo`; "copiar resumo" usa `fechamentoDoDia`**

```js
function chaveDeAtributo(s){ return (s === '' || s === undefined) ? null : Number(s); }

function finAbrirEditarDia(data, jogoStr){
  const chave = chaveDeAtributo(jogoStr);
  const d = cfgFinDaChave(FINANCEIRO, data, chave) || { valorPessoa: '', pix: '', valorQuadra: '', valorBrinde: '', icone: '✅' };
  const jogos = jogosDoDia(SETTINGS, CHECKINS, data);
  const titulo = chave ? `Editar jogo das ${(jogos.find(j=>j.numero===chave)||{}).horario} — ${formatDate(data)}` : 'Editar ' + formatDate(data);
  finAbrirModal(titulo, `
    ${finCampoNum('fin-m-vp', 'Valor por pessoa (R$)', d.valorPessoa)}
    <label class="fin-campo">PIX<input type="text" id="fin-m-pix" maxlength="80" value="${escapeHtml(d.pix || '')}"></label>
    ${finCampoNum('fin-m-vq', 'Quadra (R$)', d.valorQuadra)}
    ${finCampoNum('fin-m-vb', 'Brinde 🍫 — valor total (R$)', d.valorBrinde, '0 = sem brinde')}
    <label class="fin-campo">Ícone de quem pagou
      <select id="fin-m-icone"><option value="✅" ${d.icone !== '💰' ? 'selected' : ''}>✅</option><option value="💰" ${d.icone === '💰' ? 'selected' : ''}>💰</option></select>
    </label>`,
    async (ov)=> {
      const valorBrinde = ov.querySelector('#fin-m-vb').value;
      return finPost('salvarFinDia', { dia: {
        data, jogo: chave === 2 ? 2 : undefined, valorPessoa: ov.querySelector('#fin-m-vp').value, pix: ov.querySelector('#fin-m-pix').value.trim(),
        valorQuadra: ov.querySelector('#fin-m-vq').value, valorBrinde, temBrinde: finCentavos(valorBrinde) > 0,
        icone: ov.querySelector('#fin-m-icone').value } });
    });
}
async function reabrirDiaFinanceiroDoExtrato(data, jogoStr){
  const chave = chaveDeAtributo(jogoStr);
  if(!confirm(`Reabrir ${chave ? 'este jogo' : 'este dia'}?\n\nA quadra${chave ? '' : ' e o brinde'} volta${chave ? '' : 'm'} a contar, e os créditos (que ainda não foram usados) voltam a ser pagamentos comuns.`)) return;
  if(await finPost('reabrirDia', { data, jogo: chave })) mostrarToast((chave ? 'Jogo' : 'Dia') + ' reaberto.', 'sucesso');
}
```

No listener `#view-financeiro` (linha ~8028), trocar as duas linhas que usam `finResumoFechamento`/`finAbrirEditarDia`/o antigo `reabrirDiaFinanceiro`:

```js
document.getElementById('view-financeiro').addEventListener('click', async (e)=>{
  const cp = e.target.closest('[data-fin-copiar-resumo]');
  if(cp){
    e.preventDefault(); e.stopPropagation();
    copiarTexto(fechamentoDoDia(SETTINGS, CHECKINS, FINANCEIRO, cp.dataset.finCopiarResumo), cp);
    return;
  }
  const reab = e.target.closest('[data-fin-reabrir-dia]');
  if(reab) return reabrirDiaFinanceiroDoExtrato(reab.dataset.finReabrirDia, reab.dataset.finReabrirJogo);
  const dev = e.target.closest('[data-fin-devolver-credito]');
  if(dev){
    if(!confirm('Devolver o crédito de ' + dev.dataset.finNome + ' (' + finFormatar(Number(dev.dataset.finValor)) + ')?\n\nO dinheiro é devolvido: o pagamento de origem é estornado e o valor sai do caixa.')) return;
    return finPost('devolverCredito', { id: dev.dataset.finDevolverCredito });
  }
  if(e.target.closest('#fin-lancar-btn')) return finAbrirLancar();
  if(e.target.closest('#fin-ajustar-btn')) return finAbrirAjustarCaixa();
  const ed = e.target.closest('[data-fin-editar-dia]');
  if(ed) return finAbrirEditarDia(ed.dataset.finEditarDia, ed.dataset.finEditarJogo);
  const est = e.target.closest('[data-fin-estornar]');
  if(est){
    if(!confirm('Estornar o pagamento de ' + est.dataset.finNome + ' (' + finFormatar(Number(est.dataset.finValor)) + ')? O valor sai do caixa.')) return;
    return finPost('estornarPagamento', { id: est.dataset.finEstornar });
  }
  const estL = e.target.closest('[data-fin-estornar-lanc]');
  if(estL){
    if(!confirm('Estornar o lançamento "' + estL.dataset.finNome + '"?')) return;
    return finPost('estornarLancamento', { id: estL.dataset.finEstornarLanc });
  }
});
```

(as funções `finAbrirLancar`, `finAbrirAjustarCaixa`, `finCampoNum`, `finAbrirModal`, `copiarTexto`, `podeVerFinanceiro` **não mudam**.)

- [ ] **Step 5: Validar sintaxe**

Run: (comando de validação do topo da Parte E)
Expected: sem erro.

- [ ] **Step 6: Verificação manual** (demo de dados falsos): um dia antigo com 1 jogo continua igual; um dia com 2 jogos no modo separado mostra dois blocos "⏰ Jogo das..."; editar o jogo 2 de um dia passado não mexe no jogo 1; "copiar resumo" de um dia separado traz o texto com os dois blocos e o resumo no fim.

- [ ] **Step 7: Commit**

```bash
git add volei-dashboard.html
git commit -m "front: página Financeiro em blocos por jogo + fechamento com 2 jogos"
```

---

### Task 19: CSS das abas, dos ajustes por jogo e da etiqueta "também às..."

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:** nenhuma (só estilo). Regra do projeto: sempre seletor de classe, nunca tag pura (`.tag-outro` já existe no HTML desde a Task 15/16, com estilo mínimo — esta task completa o resto).

- [ ] **Step 1: Acrescentar as regras, logo depois de `.checkin-admin-ajustes-body .btn{grid-column:1/-1;min-height:44px;}` (linha ~991)**

```css
  /* ===== DOIS JOGOS NO MESMO DIA ===== */
  .jogos-abas{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 16px;}
  .jogo-aba{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:10px 14px;
    border:1px solid var(--line);border-radius:12px;background:var(--court-navy-2);color:var(--chalk-dim);cursor:pointer;
    text-align:left;font-family:'Work Sans',sans-serif;}
  .jogo-aba-rot{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);}
  .jogo-aba-hora{font-family:'Space Mono',monospace;font-weight:700;font-size:20px;line-height:1.15;color:var(--chalk);}
  .jogo-aba-sub{font-size:11px;color:var(--muted);}
  .jogo-aba.ativa{border-color:var(--accent);box-shadow:var(--glass-brilho);background:color-mix(in srgb, var(--accent) 8%, var(--court-navy-2));}
  .jogo-aba.ativa .jogo-aba-hora{color:var(--accent);}
  .jogo-aba-eu{position:absolute;top:8px;right:10px;font-size:10px;font-weight:700;color:#3fbf6f;}
  .jogo-cfg{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;}
  .jogo-cfg + .jogo-cfg{padding-top:10px;border-top:1px dashed var(--line);margin-top:10px;}
  .jogo-cfg-tit{grid-column:1/-1;font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.6px;}
  .jogo-cfg .btn{min-height:40px;padding:6px 12px;}
  .fin-modo{grid-column:1/-1;display:flex;flex-direction:column;gap:8px;}
  .tag-outro{margin-left:6px;font-size:10px;font-weight:700;color:var(--accent);border:1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius:999px;padding:0 6px;white-space:nowrap;vertical-align:middle;}
  @media (max-width:640px){
    .jogos-abas{grid-template-columns:1fr;}
    .jogo-cfg{grid-template-columns:1fr 1fr;}
    .jogo-cfg button[data-jogo-remover]{grid-column:1/-1;}
  }
```

- [ ] **Step 2: Validar sintaxe**

Run: (comando de validação do topo da Parte E) — `node --check` só confere o `<script>`, mas rodar ajuda a garantir que o CSS novo não quebrou nenhuma tag (abrir a página no navegador confirma o CSS de verdade).

- [ ] **Step 3: Verificação manual** (demo de dados falsos): abas lado a lado no celular estreito e uma do lado da outra em telas largas; linhas de ajuste do jogo 2 com o rótulo "2º jogo" e o 🗑 alinhado; etiqueta "+21:00"/"também às 21:00" legível e discreta, sem quebrar o layout da linha do jogador.

- [ ] **Step 4: Commit**

```bash
git add volei-dashboard.html
git commit -m "front: CSS das abas, ajustes por jogo e etiqueta de quem está nos dois jogos"
```

---

### Task 20: Info do app e versão

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:** nenhuma.

- [ ] **Step 1: Acrescentar a entrada da 15.0 na tela "ℹ️ Info"**, no mesmo padrão das entradas anteriores (ver linha ~2344 e vizinhas, que já documentam a v14.x) — inserir uma nova `<p style="line-height:1.6;">` no topo da lista de novidades:

```html
            <p style="line-height:1.6;"><strong>Dois jogos no mesmo dia.</strong> O organizador pode abrir um <strong>2º jogo</strong> no mesmo dia (horário e vagas próprios) — o check-in ganha <strong>abas</strong>, uma por jogo, e tudo abaixo delas (lista, convidado, lista colada, travar, sorteio, compartilhar) vale para o jogo da aba. O <strong>Financeiro do dia</strong> pode ser <strong>um só para os dois jogos</strong> (padrão: quem joga os dois paga uma vez) ou <strong>separado por jogo</strong> (cada um com seu valor, PIX e "sem jogo"). O botão <strong>⇄</strong> em cada confirmado move a pessoa pra fila do outro jogo. Com 1 jogo só (o padrão), nada mudou na tela.</p>
```

- [ ] **Step 2: Subir a versão do rodapé** — localizar `Ver.: 14.8` (ou a versão mais recente no momento de implementar; conferir com `grep -n "Ver.: " volei-dashboard.html`) e trocar para `Ver.: 15.0` (mudança grande, vira número redondo — regra do projeto).

- [ ] **Step 3: Validar sintaxe**

Run: (comando de validação do topo da Parte E)
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add volei-dashboard.html
git commit -m "Terça v15.0: dois jogos no mesmo dia"
```

---

### Task 21: Verificação final fim-a-fim (antes de publicar)

**Files:** nenhum (só verificação — não cria nem edita arquivo versionado).

**Interfaces:** consome tudo (Tasks 1–20).

- [ ] **Step 1: Suíte completa**

Run: `npm run test:backend && node tests/dois-jogos.test.js && node tests/dois-jogos-ui-puro.test.js && node tests/financeiro-puro.test.js`
Expected: tudo `TODOS OS TESTES PASSARAM` / `ok`. Rodar também a suíte de front existente inteira (a lista de arquivos `tests/*.test.js` do projeto) pra confirmar que nada regrediu:

```bash
for f in tests/*.test.js; do echo "== $f =="; node "$f" || exit 1; done
```

- [ ] **Step 2: Servidor local com dados falsos** (app real + backend real sobre o repositório em memória — nenhum dado de produção), adaptando `.superpowers/brainstorm/dois-jogos/app-hoje-dados-falsos.mjs` para semear um dia com check-in aberto:

Run: `node .superpowers/brainstorm/dois-jogos/app-hoje-dados-falsos.mjs 8790` e abrir `http://localhost:8790/?view=checkin&perfil=admin`

- [ ] **Step 3: Roteiro manual** (cobre os cenários do protótipo de decisão, `.superpowers/brainstorm/dois-jogos/`, agora no app de verdade):
  1. 1 jogo: nada diferente de hoje.
  2. Criar o 2º jogo → abas aparecem; aba nova fica ativa.
  3. Confirmar a mesma pessoa nos dois jogos → etiqueta "+21:00" nos dois lados, sem botão ⇄.
  4. Mover alguém (⇄) de um jogo pro outro → sai de um, entra no fim da fila do outro; as duas abas atualizam a contagem.
  5. Financeiro único (padrão): pagar uma vez cobre os dois jogos; "Confirmar todos" soma a união.
  6. Trocar para "Separado por jogo", configurar os dois com valores diferentes; pagar cada jogo separadamente; tentar trocar de volta para único com pagamento feito → bloqueado.
  7. Marcar um jogo como "sem jogo" (separado): só a quadra dele some da conta; o outro jogo continua cobrando normal; crédito nasce com o jogo certo.
  8. Compartilhar no WhatsApp: uma mensagem só, com as duas listas.
  9. Remover o 2º jogo (mover a lista) → volta a 1 jogo; tentar de novo criando e removendo o jogo 1 (manter o 2) → "troca de papéis" funciona.
  10. Página Financeiro: dia separado em blocos; fechamento (copiar resumo) com os dois jogos e o saldo batendo.
  11. Perfil jogador (sem ser organizador/admin): vê as abas e os jogos, mas não vê os botões de administrar (criar/remover jogo, travar, ⇄, Confirmar/Cancelar todos).

- [ ] **Step 4: Conferir o changelog e a versão**

Abrir a tela "ℹ️ Info" no navegador e o rodapé — confirmar que a 15.0 aparece como esperado (Task 20).

- [ ] **Step 5: Relatar ao usuário e aguardar autorização antes de publicar**

Não fazer `git push` sozinho. Mostrar o resultado (a suíte verde + o roteiro manual conferido) e perguntar:
1. Se pode seguir com o `git push` do Terça (GitHub Pages + Vercel).
2. Lembrar que o usuário ainda precisa, nesta ordem, **antes** do push do app: rodar `sql/schema-terca-supabase-ajuste-9.sql` no Supabase (schema `public`) e, se for manter o Meme em dia, `sql/meme/ajuste-9-dois-jogos-meme.sql` (schema `meme`); e reimplantar as duas Edge Functions (`npm run preparar-edge` + `npm run preparar-edge -- meme-api`, depois os dois `supabase functions deploy`).
3. Perguntar se pode apagar a pasta `.superpowers/brainstorm/dois-jogos/` (protótipo descartável, nunca foi versionado) agora que a funcionalidade está pronta de verdade.
4. Lembrar a regra do projeto: **Meme não é tocado** nesta rodada — só perguntar se replica depois que o Terça estiver publicado e confirmado funcionando.

---

## Resumo da ordem de execução

1–2: SQL (Terça + Meme, gerador) · 3–4: Repositório · 5: Mapeadores (GET) · 6: Check-in (`addCheckin`/`moverCheckin`) · 7: Financeiro (chave de cobrança) · 8: Criar/remover o 2º jogo · 9: Handler/permissões · 10: Paridade com o `.gs` · 11: Simulação · 12: Bloco puro do front · 13: Abas e 2º jogo (UI) · 14: Cartão Financeiro do dia · 15: Confirmados/Reserva + ⇄ · 16: Busca/convidado/lista colada/Desconfirmar/Sorteio · 17: Mensagem WhatsApp · 18: Página Financeiro · 19: CSS · 20: Info/versão · 21: Verificação final.

Cada task é commitável e testável isoladamente, nessa ordem — uma task não começa sem a anterior pronta (as interfaces de cada uma dizem exatamente o que a próxima consome).


