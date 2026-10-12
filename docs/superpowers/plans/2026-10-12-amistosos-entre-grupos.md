# Amistosos entre grupos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grupos que usam o app (Terça e Meme, depois outros) se convidam para amistosos, combinam data/local, montam a convocação de cada lado e registram o placar, com histórico de confrontos.

**Architecture:** Schema Supabase novo e compartilhado `liga` (grupos, amistosos, mensagens, escalações, travas). Um repositório próprio (`repo-liga-memoria.js` / `repo-liga-supabase.js`) e um módulo de domínio (`backend/amistosos.js`) entram no handler existente por injeção (`criarHandler({ ..., liga: { repo, grupoId } })`). Cada Edge Function só altera o lado do próprio grupo. No front do Terça, uma aba "Amistosos", avisos na tela inicial e um bloco puro testável `<amistosos-puro>`.

**Tech Stack:** Node 24 (ESM no backend, testes com `node:assert` + `tests/backend/executor.mjs`), Supabase (Postgres + supabase-js v2), Deno Edge Function, HTML/JS single-file sem build.

**Spec:** `docs/superpowers/specs/2026-10-12-amistosos-entre-grupos-design.md`

## Global Constraints

- **Terça primeiro, Meme só com autorização** (CLAUDE.md): nesta execução NÃO tocar em `supabase/functions/meme-api/`, nem no HTML do Meme, nem em `sql/meme/`. O plano termina parando para pedir autorização.
- `supabase/functions/terca-api-teste/index.ts` não pode conter a palavra "meme" (teste `meme-api-index.test.mjs` verifica).
- Todo bloco novo dentro de uma tela usa `<div>`, nunca `<section>` (o CSS esconde `section` fora da aba ativa).
- Modais e tooltips novos colocados no `<body>` precisam de z-index maior que 300. Usar a classe `profile-overlay` existente, que já resolve isso.
- Comentários em português explicando o *porquê*; nomes de domínio em português.
- Os módulos de `backend/` não podem usar `node:`, `process.`, `require(` nem `Buffer`, e só podem importar `./arquivo.js`, porque são copiados para a Edge Function (`scripts/preparar-edge.js` verifica).
- Toda gravação nova do handler passa pela trava `travar(() => ...)`.
- Recado: até 500 caracteres. Local: até 200. Vagas por grupo: inteiro de 1 a 30, padrão 6.
- Confirmação automática do placar: 7 dias depois de `placar_lancado_em`, calculada na leitura.
- Horário do jogo é de Brasília: início = `new Date(data + 'T' + horario + ':00-03:00')`.
- Versão no rodapé do Terça: `Ver.: 16.3` → `Ver.: 17.0` (mudança grande).
- Depois de mexer em JS do HTML: rodar a validação de sintaxe do CLAUDE.md.
- Os testes de backend rodam com `npm run test:backend`; cada arquivo novo de teste precisa ser acrescentado ao script.

## Review Focus

1. **Duas pessoas respondendo o mesmo convite ao mesmo tempo** (dois organizadores do Meme tocam "Aceitar" e "Recusar" quase juntos): só uma transição pode valer; a outra recebe "Esse amistoso mudou…". Testado na Task 4 com `atualizarAmistosoSe` recusando um status velho.
2. **Schema `liga` ainda não criado no Supabase** (deploy da função antes do SQL): o GET do app tem que continuar funcionando normal, com `liga.disponivel = false`, e a aba mostra "não disponível". Testado nas Tasks 3 e 7.
3. **Jogador removido ou id inventado no "Vou jogar"** (alguém mexe no HTML e manda um `jogadorId` qualquer): o backend recusa com "Jogador não encontrado no seu grupo.". Testado na Task 5.
4. **Placar lançado e esquecido** (o outro grupo nunca confirma): depois de 7 dias aparece como `encerrado` na leitura, e confirmar/contestar passa a responder "Esse placar já foi confirmado.". Testado na Task 6.
5. **Grupo tentando agir num amistoso que não é dele** (o Terça manda `responderConvite` com o id de um convite Meme × outro grupo): responde "Amistoso não encontrado." e nada muda. Testado na Task 4.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `sql/liga/schema-liga.sql` (novo) | Cria o schema `liga`, as 5 tabelas, RLS, grants e as linhas `terca`/`meme` em `grupos` |
| `backend/repo-liga-memoria.js` (novo) | Repositório da liga em memória (testes; um objeto compartilhado entre dois handlers simula os dois grupos) |
| `backend/repo-liga-supabase.js` (novo) | Mesma interface, falando com o Supabase (cliente com `db: { schema: 'liga' }`) |
| `backend/amistosos.js` (novo) | Regras: leitura/mapeamento do bloco `liga`, convite, escalação, placar |
| `backend/jogos2.js` (modificar) | Exportar `dataValida` e `horarioValido` (reuso) |
| `backend/permissoes.js` (modificar) | 11 ações novas |
| `backend/handler.js` (modificar) | Injeção `liga`, bloco `liga` no GET, roteamento das ações |
| `backend/servidor-local.js` (modificar) | Liga no servidor local (`cfg.grupo`) |
| `supabase/functions/terca-api-teste/index.ts` (modificar) | Segundo cliente (`schema: 'liga'`) + `liga: { repo, grupoId: 'terca' }` |
| `tests/backend/repo-liga.test.mjs` (novo) | Repo memória + repo Supabase com cliente falso |
| `tests/backend/amistosos.test.mjs` (novo) | Domínio |
| `tests/backend/handler-amistosos.test.mjs` (novo) | Handler ponta a ponta com Terça e Meme compartilhando a liga |
| `tests/backend/permissoes.test.mjs` (modificar) | Excluir as ações novas da paridade com o `.gs` |
| `volei-dashboard.html` (modificar) | Bloco puro `<amistosos-puro>`, aba, avisos, modais, v17.0 |
| `tests/amistosos-puro.test.js` (novo) | Testes do bloco puro do front |
| `package.json` (modificar) | Acrescentar os testes novos a `test:backend` |

### Interface do repositório da liga (usada pelas Tasks 1–7)

Os dois repositórios expõem exatamente:

```
lerGrupos() -> Promise<Array<{ id, nome, logo_url, cor, ativo }>>
lerAmistososDoGrupo(grupoId) -> Promise<{ amistosos: Linha[], mensagens: Linha[], escalacoes: Linha[], travas: Linha[] }>
lerAmistoso(id) -> Promise<null | { amistoso: Linha, escalacoes: Linha[], travas: Linha[] }>
inserirAmistoso(linha) -> Promise<void>
atualizarAmistosoSe(id, statusEsperado, campos) -> Promise<boolean>   // só atualiza se status ainda é o esperado
inserirMensagem(linha) -> Promise<void>
inserirEscalacao(linha) -> Promise<boolean>                            // false = já estava na lista (unique)
atualizarEscalacao(amistosoId, grupo, jogadorId, campos) -> Promise<boolean>
removerEscalacao(amistosoId, grupo, jogadorId) -> Promise<boolean>
definirTrava(amistosoId, grupo, travada: boolean) -> Promise<void>
```

As linhas usam os nomes de coluna do SQL (snake_case).

---

### Task 1: SQL do schema `liga` + repositório em memória

**Files:**
- Create: `sql/liga/schema-liga.sql`
- Create: `backend/repo-liga-memoria.js`
- Create: `tests/backend/repo-liga.test.mjs`
- Modify: `package.json` (script `test:backend`)

**Interfaces:**
- Produces: `criarRepoLigaMemoria(dados?: { grupos?, amistosos?, amistoso_mensagens?, escalacoes?, travas_escalacao? })`, com a interface acima e mais `.tabelas`, para inspeção nos testes.

- [ ] **Step 1: Escrever o SQL**

Criar `sql/liga/schema-liga.sql`:

```sql
-- Amistosos entre grupos (spec docs/superpowers/specs/2026-10-12-amistosos-entre-grupos-design.md).
-- Schema COMPARTILHADO entre todos os grupos: roda UMA vez só (não existe versão "meme" deste arquivo, e o
-- gerar-sql-grupo NÃO deve processá-lo). QUEM RODA: o usuário, no SQL Editor do Supabase.
-- Depois de rodar: Configurações > API > "Exposed schemas": acrescentar "liga" (igual foi feito com "meme").
create schema if not exists liga;
grant usage on schema liga to service_role;

-- diretório de grupos: grupo novo = uma linha aqui + a Edge Function dele com grupoId igual ao id
create table if not exists liga.grupos (
  id text primary key,
  nome text not null,
  logo_url text,
  cor text,
  ativo boolean not null default true
);

create table if not exists liga.amistosos (
  id uuid primary key,
  grupo_convidante text not null references liga.grupos(id),
  grupo_convidado text not null references liga.grupos(id),
  data date not null,
  horario text not null,
  local text not null default '',
  vagas_por_grupo int not null default 6 check (vagas_por_grupo between 1 and 30),
  status text not null check (status in ('pendente', 'marcado', 'aguardando_confirmacao', 'encerrado', 'recusado', 'cancelado')),
  vez_de text references liga.grupos(id),
  sets_convidante int,
  sets_convidado int,
  parciais jsonb,
  placar_lancado_por_grupo text references liga.grupos(id),
  placar_lancado_em timestamptz,
  motivo_cancelamento text,
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (grupo_convidante <> grupo_convidado)
);
create index if not exists amistosos_convidante_idx on liga.amistosos (grupo_convidante);
create index if not exists amistosos_convidado_idx on liga.amistosos (grupo_convidado);

-- histórico do convite: é a "troca de informação" entre os grupos (não existe chat livre)
create table if not exists liga.amistoso_mensagens (
  id uuid primary key,
  amistoso_id uuid not null references liga.amistosos(id) on delete cascade,
  grupo text not null references liga.grupos(id),
  autor_nome text not null default '',
  tipo text not null check (tipo in ('convite', 'contraproposta', 'aceite', 'recusa', 'cancelamento', 'placar', 'confirmacao', 'contestacao', 'recado')),
  texto text not null default '' check (char_length(texto) <= 500),
  criado_em timestamptz not null default now()
);
create index if not exists amistoso_mensagens_amistoso_idx on liga.amistoso_mensagens (amistoso_id);

-- convocação: jogador_id é o id NO SCHEMA DO GRUPO (public.jogadores do Terça, meme.jogadores do Meme) — sem
-- chave estrangeira de propósito (cada grupo tem a sua tabela). nome/foto são copiados para o adversário exibir
-- sem precisar ler o schema do outro grupo.
create table if not exists liga.escalacoes (
  id uuid primary key,
  amistoso_id uuid not null references liga.amistosos(id) on delete cascade,
  grupo text not null references liga.grupos(id),
  jogador_id text not null,
  nome text not null,
  foto_url text,
  status text not null default 'interessado' check (status in ('interessado', 'confirmado')),
  criado_em timestamptz not null default now(),
  unique (amistoso_id, grupo, jogador_id)
);

-- a linha existir = a lista daquele grupo naquele amistoso está travada
create table if not exists liga.travas_escalacao (
  amistoso_id uuid not null references liga.amistosos(id) on delete cascade,
  grupo text not null references liga.grupos(id),
  primary key (amistoso_id, grupo)
);

-- RLS ligado e sem políticas (igual às outras tabelas): o navegador nunca fala com o banco direto, só a função (service_role)
alter table liga.grupos enable row level security;
alter table liga.amistosos enable row level security;
alter table liga.amistoso_mensagens enable row level security;
alter table liga.escalacoes enable row level security;
alter table liga.travas_escalacao enable row level security;
grant select, insert, update, delete on all tables in schema liga to service_role;

-- cores aproximadas da identidade de cada app (dá pra ajustar depois com um update)
insert into liga.grupos (id, nome, cor) values
  ('terca', 'Vôlei de Terça', '#ffd700'),
  ('meme', 'Vôlei Meme Brasil', '#b3790a')
on conflict (id) do nothing;
```

- [ ] **Step 2: Escrever o teste do repo em memória (falha)**

Criar `tests/backend/repo-liga.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ta, t, fim } from './executor.mjs';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';

const GRUPOS = [{ id: 'terca', nome: 'Vôlei de Terça' }, { id: 'meme', nome: 'Vôlei Meme Brasil' }, { id: 'outro', nome: 'Outro' }];
const amistoso = (id, de, para, extra = {}) => ({
  id, grupo_convidante: de, grupo_convidado: para, data: '2026-10-20', horario: '20:00', local: '', vagas_por_grupo: 6,
  status: 'pendente', vez_de: para, criado_por: 'b@exemplo.com', criado_em: '2026-10-12T15:00:00.000Z', atualizado_em: '2026-10-12T15:00:00.000Z', ...extra
});

t('SQL: cria as 5 tabelas no schema liga, liga RLS e cadastra terca e meme', () => {
  const sql = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'sql', 'liga', 'schema-liga.sql'), 'utf8');
  for (const tabela of ['grupos', 'amistosos', 'amistoso_mensagens', 'escalacoes', 'travas_escalacao']) {
    assert.match(sql, new RegExp('create table if not exists liga\\.' + tabela + ' '), tabela);
    assert.match(sql, new RegExp('alter table liga\\.' + tabela + ' enable row level security'), tabela + ' RLS');
  }
  assert.match(sql, /unique \(amistoso_id, grupo, jogador_id\)/);
  assert.match(sql, /\('terca', 'Vôlei de Terça'/);
  assert.match(sql, /\('meme', 'Vôlei Meme Brasil'/);
});

await ta('lerAmistososDoGrupo: só os amistosos em que o grupo participa, com mensagens/escalações/travas deles', async () => {
  const r = criarRepoLigaMemoria({
    grupos: GRUPOS,
    amistosos: [amistoso('a1', 'terca', 'meme'), amistoso('a2', 'meme', 'outro')],
    amistoso_mensagens: [{ id: 'm1', amistoso_id: 'a1' }, { id: 'm2', amistoso_id: 'a2' }],
    escalacoes: [{ id: 'e1', amistoso_id: 'a2', grupo: 'meme', jogador_id: 'x' }],
    travas_escalacao: [{ amistoso_id: 'a1', grupo: 'terca' }]
  });
  const doTerca = await r.lerAmistososDoGrupo('terca');
  assert.deepEqual(doTerca.amistosos.map((a) => a.id), ['a1']);
  assert.deepEqual(doTerca.mensagens.map((m) => m.id), ['m1']);
  assert.deepEqual(doTerca.escalacoes, []);
  assert.deepEqual(doTerca.travas, [{ amistoso_id: 'a1', grupo: 'terca' }]);
  assert.deepEqual((await r.lerAmistososDoGrupo('meme')).amistosos.map((a) => a.id).sort(), ['a1', 'a2']);
});

await ta('inserirAmistoso recusa id repetido e grupo inexistente (chaves do banco)', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS });
  await r.inserirAmistoso(amistoso('a1', 'terca', 'meme'));
  await assert.rejects(r.inserirAmistoso(amistoso('a1', 'terca', 'meme')), /duplicate key/);
  await assert.rejects(r.inserirAmistoso(amistoso('a9', 'terca', 'fantasma')), /foreign key/);
});

await ta('atualizarAmistosoSe: só atualiza se o status ainda é o esperado (concorrência otimista)', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [amistoso('a1', 'terca', 'meme')] });
  assert.equal(await r.atualizarAmistosoSe('a1', 'pendente', { status: 'marcado' }), true);
  assert.equal(await r.atualizarAmistosoSe('a1', 'pendente', { status: 'recusado' }), false); // quem chegou depois perde
  assert.equal((await r.lerAmistoso('a1')).amistoso.status, 'marcado');
  assert.equal(await r.atualizarAmistosoSe('nao-existe', 'pendente', { status: 'x' }), false);
});

await ta('escalações: unique por (amistoso, grupo, jogador); atualizar/remover devolvem se achou', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [amistoso('a1', 'terca', 'meme', { status: 'marcado' })] });
  const linha = { id: 'e1', amistoso_id: 'a1', grupo: 'terca', jogador_id: 'p1', nome: 'Ana', foto_url: null, criado_em: 't1' };
  assert.equal(await r.inserirEscalacao(linha), true);
  assert.equal(await r.inserirEscalacao({ ...linha, id: 'e2' }), false);
  assert.equal(await r.inserirEscalacao({ ...linha, id: 'e3', grupo: 'meme' }), true); // mesmo id de jogador no OUTRO grupo é outra pessoa
  assert.equal((await r.lerAmistoso('a1')).escalacoes[0].status, 'interessado'); // padrão da coluna
  assert.equal(await r.atualizarEscalacao('a1', 'terca', 'p1', { status: 'confirmado' }), true);
  assert.equal(await r.atualizarEscalacao('a1', 'terca', 'p9', { status: 'confirmado' }), false);
  assert.equal(await r.removerEscalacao('a1', 'terca', 'p1'), true);
  assert.equal(await r.removerEscalacao('a1', 'terca', 'p1'), false);
});

await ta('definirTrava liga e desliga sem duplicar', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [amistoso('a1', 'terca', 'meme')] });
  await r.definirTrava('a1', 'terca', true);
  await r.definirTrava('a1', 'terca', true);
  assert.deepEqual((await r.lerAmistoso('a1')).travas, [{ amistoso_id: 'a1', grupo: 'terca' }]);
  await r.definirTrava('a1', 'terca', false);
  assert.deepEqual((await r.lerAmistoso('a1')).travas, []);
});

await ta('lerAmistoso devolve null para id desconhecido e cópias (mexer no retorno não muda o "banco")', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [amistoso('a1', 'terca', 'meme')] });
  assert.equal(await r.lerAmistoso('x'), null);
  (await r.lerAmistoso('a1')).amistoso.status = 'mexido';
  assert.equal((await r.lerAmistoso('a1')).amistoso.status, 'pendente');
});

fim();
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node tests/backend/repo-liga.test.mjs`
Expected: erro de import (`Cannot find module ... repo-liga-memoria.js`).

- [ ] **Step 4: Implementar o repo em memória**

Criar `backend/repo-liga-memoria.js`:

```js
// Repositório da LIGA (schema "liga", compartilhado entre os grupos) em memória: mesma interface do repo-liga-supabase.
// Um ÚNICO objeto destes pode ser entregue a dois handlers (Terça e Meme) nos testes — é assim que se simula os dois
// grupos conversando pelo mesmo banco. Faz o papel do banco onde importa: chave primária, chaves estrangeiras para
// grupos, unique da escalação e o "update ... where status = X" da concorrência otimista.
const copia = (x) => structuredClone(x);

export function criarRepoLigaMemoria(dados = {}) {
  const t = {
    grupos: (dados.grupos || []).map((l) => ({ ativo: true, ...l })),
    amistosos: (dados.amistosos || []).map((l) => ({ ...l })),
    amistoso_mensagens: (dados.amistoso_mensagens || []).map((l) => ({ ...l })),
    escalacoes: (dados.escalacoes || []).map((l) => ({ ...l })),
    travas_escalacao: (dados.travas_escalacao || []).map((l) => ({ ...l }))
  };
  const doAmistoso = (lista, id) => lista.filter((l) => l.amistoso_id === id);
  const mesmaEscalacao = (e, amistosoId, grupo, jogadorId) => e.amistoso_id === amistosoId && e.grupo === grupo && e.jogador_id === jogadorId;

  return {
    tabelas: t,
    async lerGrupos() { return copia(t.grupos); },
    async lerAmistososDoGrupo(grupoId) {
      const amistosos = t.amistosos.filter((a) => a.grupo_convidante === grupoId || a.grupo_convidado === grupoId);
      const ids = new Set(amistosos.map((a) => a.id));
      return copia({
        amistosos,
        mensagens: t.amistoso_mensagens.filter((m) => ids.has(m.amistoso_id)),
        escalacoes: t.escalacoes.filter((e) => ids.has(e.amistoso_id)),
        travas: t.travas_escalacao.filter((x) => ids.has(x.amistoso_id))
      });
    },
    async lerAmistoso(id) {
      const a = t.amistosos.find((x) => x.id === id);
      if (!a) return null;
      return copia({ amistoso: a, escalacoes: doAmistoso(t.escalacoes, id), travas: doAmistoso(t.travas_escalacao, id) });
    },
    async inserirAmistoso(linha) {
      if (t.amistosos.some((a) => a.id === linha.id)) throw new Error('amistosos: duplicate key value violates unique constraint "amistosos_pkey"');
      for (const g of [linha.grupo_convidante, linha.grupo_convidado]) {
        if (!t.grupos.some((x) => x.id === g)) throw new Error('amistosos: insert or update on table "amistosos" violates foreign key constraint');
      }
      t.amistosos.push({ ...linha });
    },
    // atualiza SÓ se o status ainda é o esperado; quem chegou depois recebe false e não sobrescreve quem agiu primeiro
    async atualizarAmistosoSe(id, statusEsperado, campos) {
      const i = t.amistosos.findIndex((a) => a.id === id && a.status === statusEsperado);
      if (i === -1) return false;
      t.amistosos[i] = { ...t.amistosos[i], ...campos };
      return true;
    },
    async inserirMensagem(linha) { t.amistoso_mensagens.push({ ...linha }); },
    // false = a pessoa já está na lista desse grupo nesse amistoso (o unique do banco)
    async inserirEscalacao(linha) {
      if (t.escalacoes.some((e) => mesmaEscalacao(e, linha.amistoso_id, linha.grupo, linha.jogador_id))) return false;
      t.escalacoes.push({ status: 'interessado', ...linha });
      return true;
    },
    async atualizarEscalacao(amistosoId, grupo, jogadorId, campos) {
      const i = t.escalacoes.findIndex((e) => mesmaEscalacao(e, amistosoId, grupo, jogadorId));
      if (i === -1) return false;
      t.escalacoes[i] = { ...t.escalacoes[i], ...campos };
      return true;
    },
    async removerEscalacao(amistosoId, grupo, jogadorId) {
      const antes = t.escalacoes.length;
      t.escalacoes = t.escalacoes.filter((e) => !mesmaEscalacao(e, amistosoId, grupo, jogadorId));
      return t.escalacoes.length < antes;
    },
    async definirTrava(amistosoId, grupo, travada) {
      const existe = t.travas_escalacao.some((x) => x.amistoso_id === amistosoId && x.grupo === grupo);
      if (travada && !existe) t.travas_escalacao.push({ amistoso_id: amistosoId, grupo });
      if (!travada) t.travas_escalacao = t.travas_escalacao.filter((x) => !(x.amistoso_id === amistosoId && x.grupo === grupo));
    }
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node tests/backend/repo-liga.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 6: Acrescentar ao `test:backend`**

Em `package.json`, no fim do script `test:backend`, acrescentar ` && node tests/backend/repo-liga.test.mjs`.

- [ ] **Step 7: Commit**

```bash
git add sql/liga/schema-liga.sql backend/repo-liga-memoria.js tests/backend/repo-liga.test.mjs package.json
git commit -m "feat(liga): schema SQL e repositório em memória dos amistosos"
```

---

### Task 2: Repositório da liga no Supabase

**Files:**
- Create: `backend/repo-liga-supabase.js`
- Modify: `tests/backend/repo-liga.test.mjs` (acrescentar testes antes do `fim()`)

**Interfaces:**
- Consumes: a interface do repositório (seção acima).
- Produces: `criarRepoLigaSupabase(cliente)`. O `cliente` é um supabase-js com `db: { schema: 'liga' }`.

- [ ] **Step 1: Escrever os testes com cliente falso (falham)**

Em `tests/backend/repo-liga.test.mjs`, acrescentar o import no topo:

```js
import { criarRepoLigaSupabase } from '../../backend/repo-liga-supabase.js';
```

E antes de `fim();`:

```js
// ---- repo-liga-supabase com um cliente falso: grava cada consulta encadeada e responde por tabela ----
function clienteFalso(respostas = {}) {
  const chamadas = [];
  const from = (tabela) => {
    const passos = { tabela, filtros: [] };
    const q = {};
    for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'order', 'limit', 'maybeSingle']) {
      q[m] = (...args) => { passos[m] = args; return q; };
    }
    for (const m of ['eq', 'in', 'or']) q[m] = (...args) => { passos.filtros.push([m, ...args]); return q; };
    q.then = (res, rej) => {
      chamadas.push(passos);
      const r = typeof respostas[tabela] === 'function' ? respostas[tabela](passos) : (respostas[tabela] || { data: [], error: null });
      return Promise.resolve(r).then(res, rej);
    };
    return q;
  };
  return { chamadas, from };
}

await ta('supabase: lerAmistososDoGrupo filtra por convidante OU convidado e busca o resto pelos ids', async () => {
  const c = clienteFalso({
    amistosos: { data: [{ id: 'a1' }], error: null },
    amistoso_mensagens: { data: [{ id: 'm1', amistoso_id: 'a1' }], error: null }
  });
  const r = await criarRepoLigaSupabase(c).lerAmistososDoGrupo('terca');
  assert.deepEqual(r.amistosos, [{ id: 'a1' }]);
  assert.deepEqual(r.mensagens, [{ id: 'm1', amistoso_id: 'a1' }]);
  const am = c.chamadas.find((x) => x.tabela === 'amistosos');
  assert.deepEqual(am.filtros, [['or', 'grupo_convidante.eq.terca,grupo_convidado.eq.terca']]);
  const esc = c.chamadas.find((x) => x.tabela === 'escalacoes');
  assert.deepEqual(esc.filtros, [['in', 'amistoso_id', ['a1']]]);
});

await ta('supabase: sem amistosos não consulta as outras tabelas', async () => {
  const c = clienteFalso({ amistosos: { data: [], error: null } });
  const r = await criarRepoLigaSupabase(c).lerAmistososDoGrupo('terca');
  assert.deepEqual(r, { amistosos: [], mensagens: [], escalacoes: [], travas: [] });
  assert.deepEqual(c.chamadas.map((x) => x.tabela), ['amistosos']);
});

await ta('supabase: atualizarAmistosoSe filtra por id E status e devolve se alguma linha mudou', async () => {
  const c = clienteFalso({ amistosos: (p) => ({ data: p.filtros.some((f) => f[2] === 'pendente') ? [{ id: 'a1' }] : [], error: null }) });
  const repo = criarRepoLigaSupabase(c);
  assert.equal(await repo.atualizarAmistosoSe('a1', 'pendente', { status: 'marcado' }), true);
  assert.equal(await repo.atualizarAmistosoSe('a1', 'marcado', { status: 'encerrado' }), false);
  assert.deepEqual(c.chamadas[0].filtros, [['eq', 'id', 'a1'], ['eq', 'status', 'pendente']]);
  assert.deepEqual(c.chamadas[0].update, [{ status: 'marcado' }]);
});

await ta('supabase: inserirEscalacao devolve false no unique (23505) e lança nos outros erros, com a dica do SQL', async () => {
  const repoDup = criarRepoLigaSupabase(clienteFalso({ escalacoes: { error: { code: '23505', message: 'duplicate key' } } }));
  assert.equal(await repoDup.inserirEscalacao({ id: 'e1' }), false);
  const repoOk = criarRepoLigaSupabase(clienteFalso({ escalacoes: { error: null } }));
  assert.equal(await repoOk.inserirEscalacao({ id: 'e1' }), true);
  const repoRuim = criarRepoLigaSupabase(clienteFalso({ escalacoes: { error: { code: '42P01', message: 'relation does not exist' } } }));
  await assert.rejects(repoRuim.inserirEscalacao({ id: 'e1' }), /escalacoes: relation does not exist.*schema-liga\.sql/);
});

await ta('supabase: lerAmistoso devolve null quando não acha; definirTrava faz upsert ou delete', async () => {
  const c = clienteFalso({ amistosos: { data: null, error: null } });
  assert.equal(await criarRepoLigaSupabase(c).lerAmistoso('x'), null);
  const c2 = clienteFalso();
  const repo = criarRepoLigaSupabase(c2);
  await repo.definirTrava('a1', 'terca', true);
  await repo.definirTrava('a1', 'terca', false);
  assert.deepEqual(c2.chamadas[0].upsert, [{ amistoso_id: 'a1', grupo: 'terca' }, { onConflict: 'amistoso_id,grupo', ignoreDuplicates: true }]);
  assert.ok(c2.chamadas[1].delete);
  assert.deepEqual(c2.chamadas[1].filtros, [['eq', 'amistoso_id', 'a1'], ['eq', 'grupo', 'terca']]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/repo-liga.test.mjs`
Expected: erro de import de `repo-liga-supabase.js`.

- [ ] **Step 3: Implementar**

Criar `backend/repo-liga-supabase.js`:

```js
// Repositório da LIGA no Supabase. O cliente recebido deve apontar pro schema "liga" (db: { schema: 'liga' }) e usar a
// service_role (RLS ligado sem políticas, como nas outras tabelas). Toda mensagem de erro leva o nome da tabela e a dica
// do SQL — o caso mais provável de erro aqui é a função ter sido publicada antes de o schema existir.
const DICA = ' (rode sql/liga/schema-liga.sql no SQL Editor do Supabase e inclua "liga" em Exposed schemas)';
const falha = (tabela, error) => new Error(tabela + ': ' + error.message + DICA);
const LIMITE_AMISTOSOS = 300; // bem acima do uso real; o mapeamento ainda corta o histórico em 50

export function criarRepoLigaSupabase(cliente) {
  async function porAmistosos(tabela, ids) {
    if (!ids.length) return [];
    const { data, error } = await cliente.from(tabela).select('*').in('amistoso_id', ids);
    if (error) throw falha(tabela, error);
    return data || [];
  }

  return {
    async lerGrupos() {
      const { data, error } = await cliente.from('grupos').select('*').order('id');
      if (error) throw falha('grupos', error);
      return data || [];
    },
    // grupoId vem da configuração do servidor (nunca do navegador), por isso pode entrar direto no filtro "or"
    async lerAmistososDoGrupo(grupoId) {
      const { data, error } = await cliente.from('amistosos').select('*')
        .or(`grupo_convidante.eq.${grupoId},grupo_convidado.eq.${grupoId}`)
        .order('criado_em', { ascending: false }).limit(LIMITE_AMISTOSOS);
      if (error) throw falha('amistosos', error);
      const amistosos = data || [];
      if (!amistosos.length) return { amistosos: [], mensagens: [], escalacoes: [], travas: [] };
      const ids = amistosos.map((a) => a.id);
      const [mensagens, escalacoes, travas] = await Promise.all([
        porAmistosos('amistoso_mensagens', ids), porAmistosos('escalacoes', ids), porAmistosos('travas_escalacao', ids)
      ]);
      return { amistosos, mensagens, escalacoes, travas };
    },
    async lerAmistoso(id) {
      const { data, error } = await cliente.from('amistosos').select('*').eq('id', id).maybeSingle();
      if (error) throw falha('amistosos', error);
      if (!data) return null;
      const [escalacoes, travas] = await Promise.all([porAmistosos('escalacoes', [id]), porAmistosos('travas_escalacao', [id])]);
      return { amistoso: data, escalacoes, travas };
    },
    async inserirAmistoso(linha) {
      const { error } = await cliente.from('amistosos').insert(linha);
      if (error) throw falha('amistosos', error);
    },
    // "update ... where id = X and status = Y": se outra pessoa mudou o status antes, nenhuma linha volta e devolve false
    async atualizarAmistosoSe(id, statusEsperado, campos) {
      const { data, error } = await cliente.from('amistosos').update(campos).eq('id', id).eq('status', statusEsperado).select('id');
      if (error) throw falha('amistosos', error);
      return (data || []).length > 0;
    },
    async inserirMensagem(linha) {
      const { error } = await cliente.from('amistoso_mensagens').insert(linha);
      if (error) throw falha('amistoso_mensagens', error);
    },
    async inserirEscalacao(linha) {
      const { error } = await cliente.from('escalacoes').insert(linha);
      if (error) {
        if (error.code === '23505') return false; // unique (amistoso, grupo, jogador): já está na lista
        throw falha('escalacoes', error);
      }
      return true;
    },
    async atualizarEscalacao(amistosoId, grupo, jogadorId, campos) {
      const { data, error } = await cliente.from('escalacoes').update(campos)
        .eq('amistoso_id', amistosoId).eq('grupo', grupo).eq('jogador_id', jogadorId).select('id');
      if (error) throw falha('escalacoes', error);
      return (data || []).length > 0;
    },
    async removerEscalacao(amistosoId, grupo, jogadorId) {
      const { data, error } = await cliente.from('escalacoes').delete()
        .eq('amistoso_id', amistosoId).eq('grupo', grupo).eq('jogador_id', jogadorId).select('id');
      if (error) throw falha('escalacoes', error);
      return (data || []).length > 0;
    },
    async definirTrava(amistosoId, grupo, travada) {
      const r = travada
        ? await cliente.from('travas_escalacao').upsert({ amistoso_id: amistosoId, grupo }, { onConflict: 'amistoso_id,grupo', ignoreDuplicates: true })
        : await cliente.from('travas_escalacao').delete().eq('amistoso_id', amistosoId).eq('grupo', grupo);
      if (r.error) throw falha('travas_escalacao', r.error);
    }
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/repo-liga.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Commit**

```bash
git add backend/repo-liga-supabase.js tests/backend/repo-liga.test.mjs
git commit -m "feat(liga): repositório Supabase dos amistosos"
```

---

### Task 3: Domínio — leitura e mapeamento do bloco `liga`

**Files:**
- Create: `backend/amistosos.js`
- Modify: `backend/jogos2.js` (exportar duas funções)
- Create: `tests/backend/amistosos.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: repositório da liga (Tasks 1–2). De `jogos2.js`: `dataValida(s) -> boolean`, `horarioValido(s) -> boolean` (passam a ser exportadas).
- Produces (de `backend/amistosos.js`):
  - `DIAS_CONFIRMACAO_AUTOMATICA = 7`
  - `inicioDoJogo(linhaAmistoso) -> Date`
  - `statusEfetivo(linhaAmistoso, agora: Date) -> string`
  - `ligaVazia(grupoId) -> { disponivel: false, grupoId, grupos: [], amistosos: [] }`
  - `mapearLiga({ grupos, amistosos, mensagens, escalacoes, travas }, grupoId, agora) -> BlocoLiga`
  - `lerBlocoLiga(deps) -> Promise<BlocoLiga>` (nunca lança)
  - `deps.liga = { repo, grupoId }`

Formato `BlocoLiga` (o JSON que o front recebe):

```
{ disponivel: true, grupoId: 'terca',
  grupos: [{ id, nome, logoUrl, cor }],
  amistosos: [{
    id, convidante, convidado, adversario, data, horario, local, vagasPorGrupo, status, vezDe,
    setsConvidante, setsConvidado, parciais, placarLancadoPorGrupo, placarLancadoEm, motivoCancelamento, criadoEm, atualizadoEm,
    mensagens: [{ grupo, autorNome, tipo, texto, criadoEm }],
    minhaEscalacao: { travada, jogadores: [{ jogadorId, nome, foto, status, criadoEm }] },
    escalacaoAdversario: { confirmados: [{ jogadorId, nome, foto }], interessados: number }
  }] }
```

- [ ] **Step 1: Exportar os validadores de `jogos2.js`**

Em `backend/jogos2.js`, trocar `function dataValida(s) {` por `export function dataValida(s) {` e `const horarioValido = (s) =>` por `export const horarioValido = (s) =>`. Nada mais muda.

- [ ] **Step 2: Escrever os testes (falham)**

Criar `tests/backend/amistosos.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';
import { statusEfetivo, inicioDoJogo, mapearLiga, lerBlocoLiga, ligaVazia } from '../../backend/amistosos.js';

const GRUPOS = [{ id: 'terca', nome: 'Vôlei de Terça', cor: '#ffd700' }, { id: 'meme', nome: 'Vôlei Meme Brasil', cor: '#b3790a' }, { id: 'outro', nome: 'Outro' }];
const linha = (id, extra = {}) => ({
  id, grupo_convidante: 'terca', grupo_convidado: 'meme', data: '2026-10-20', horario: '20:00', local: 'Quadra X', vagas_por_grupo: 6,
  status: 'pendente', vez_de: 'meme', criado_por: 'b@exemplo.com', criado_em: '2026-10-12T15:00:00.000Z', atualizado_em: '2026-10-12T15:00:00.000Z', ...extra
});
const AGORA = new Date('2026-10-12T15:00:00.000Z');

t('inicioDoJogo usa o horário de Brasília (-03:00)', () => {
  assert.equal(inicioDoJogo(linha('a')).toISOString(), '2026-10-20T23:00:00.000Z');
});

t('statusEfetivo: placar parado 7 dias vira encerrado; antes disso continua aguardando; outros status não mudam', () => {
  const a = linha('a', { status: 'aguardando_confirmacao', placar_lancado_em: '2026-10-21T00:00:00.000Z' });
  assert.equal(statusEfetivo(a, new Date('2026-10-27T23:59:59.000Z')), 'aguardando_confirmacao');
  assert.equal(statusEfetivo(a, new Date('2026-10-28T00:00:00.000Z')), 'encerrado');
  assert.equal(statusEfetivo(linha('b', { status: 'marcado' }), new Date('2030-01-01')), 'marcado');
});

t('mapearLiga: formato do front, adversário do ponto de vista do grupo, grupos inativos fora', () => {
  const bloco = mapearLiga({ grupos: [...GRUPOS, { id: 'velho', nome: 'Velho', ativo: false }], amistosos: [linha('a1')], mensagens: [], escalacoes: [], travas: [] }, 'meme', AGORA);
  assert.equal(bloco.disponivel, true);
  assert.equal(bloco.grupoId, 'meme');
  assert.deepEqual(bloco.grupos.map((g) => g.id), ['terca', 'meme', 'outro']);
  assert.deepEqual(bloco.grupos[0], { id: 'terca', nome: 'Vôlei de Terça', logoUrl: '', cor: '#ffd700' });
  const a = bloco.amistosos[0];
  assert.equal(a.adversario, 'terca');
  assert.equal(a.convidante, 'terca');
  assert.equal(a.vezDe, 'meme');
  assert.equal(a.vagasPorGrupo, 6);
  assert.equal(a.local, 'Quadra X');
  assert.deepEqual(a.parciais, []);
  assert.equal(a.setsConvidante, null);
});

t('mapearLiga: o próprio grupo vê interessados e confirmados; o adversário só confirmados + contagem', () => {
  const esc = (grupo, jogador, status, criado) => ({ id: grupo + jogador, amistoso_id: 'a1', grupo, jogador_id: jogador, nome: jogador.toUpperCase(), foto_url: null, status, criado_em: criado });
  const bruto = {
    grupos: GRUPOS, amistosos: [linha('a1', { status: 'marcado', vez_de: null })], mensagens: [],
    escalacoes: [esc('terca', 'p2', 'interessado', 't2'), esc('terca', 'p1', 'confirmado', 't1'), esc('meme', 'm1', 'confirmado', 't1'), esc('meme', 'm2', 'interessado', 't2'), esc('meme', 'm3', 'interessado', 't3')],
    travas: [{ amistoso_id: 'a1', grupo: 'terca' }]
  };
  const doTerca = mapearLiga(bruto, 'terca', AGORA).amistosos[0];
  assert.equal(doTerca.minhaEscalacao.travada, true);
  assert.deepEqual(doTerca.minhaEscalacao.jogadores.map((j) => [j.jogadorId, j.status]), [['p1', 'confirmado'], ['p2', 'interessado']]); // ordem de chegada
  assert.deepEqual(doTerca.escalacaoAdversario, { confirmados: [{ jogadorId: 'm1', nome: 'M1', foto: '' }], interessados: 2 });
  const doMeme = mapearLiga(bruto, 'meme', AGORA).amistosos[0];
  assert.equal(doMeme.minhaEscalacao.travada, false);
  assert.equal(doMeme.minhaEscalacao.jogadores.length, 3);
  assert.deepEqual(doMeme.escalacaoAdversario.confirmados.map((p) => p.jogadorId), ['p1']);
});

t('mapearLiga: ignora amistoso de outros grupos; histórico corta nos 50 mais recentes; ativos sempre entram', () => {
  const fechados = Array.from({ length: 60 }, (_, i) => linha('f' + i, { status: 'encerrado', data: '2025-01-' + String((i % 28) + 1).padStart(2, '0'), sets_convidante: 3, sets_convidado: 1 }));
  const bruto = { grupos: GRUPOS, amistosos: [linha('ativo'), linha('alheio', { grupo_convidante: 'meme', grupo_convidado: 'outro' }), ...fechados], mensagens: [], escalacoes: [], travas: [] };
  const bloco = mapearLiga(bruto, 'terca', AGORA);
  assert.ok(bloco.amistosos.some((a) => a.id === 'ativo'));
  assert.ok(!bloco.amistosos.some((a) => a.id === 'alheio'));
  assert.equal(bloco.amistosos.filter((a) => a.status === 'encerrado').length, 50);
});

t('mapearLiga: mensagens em ordem de chegada, com o status efetivo aplicado', () => {
  const bruto = {
    grupos: GRUPOS,
    amistosos: [linha('a1', { status: 'aguardando_confirmacao', placar_lancado_em: '2026-10-01T00:00:00.000Z', placar_lancado_por_grupo: 'terca', sets_convidante: 3, sets_convidado: 2 })],
    mensagens: [{ id: 'm2', amistoso_id: 'a1', grupo: 'meme', autor_nome: 'B', tipo: 'aceite', texto: '', criado_em: '2026-09-02T00:00:00.000Z' },
                { id: 'm1', amistoso_id: 'a1', grupo: 'terca', autor_nome: 'A', tipo: 'convite', texto: 'bora', criado_em: '2026-09-01T00:00:00.000Z' }],
    escalacoes: [], travas: []
  };
  const a = mapearLiga(bruto, 'terca', AGORA).amistosos[0];
  assert.equal(a.status, 'encerrado'); // 11 dias depois do placar
  assert.deepEqual(a.mensagens.map((m) => m.tipo), ['convite', 'aceite']);
  assert.deepEqual(a.mensagens[0], { grupo: 'terca', autorNome: 'A', tipo: 'convite', texto: 'bora', criadoEm: '2026-09-01T00:00:00.000Z' });
});

await ta('lerBlocoLiga: sem liga configurada devolve o bloco vazio', async () => {
  assert.deepEqual(await lerBlocoLiga({ repo: criarRepoMemoria(fixture) }), ligaVazia(''));
});

await ta('lerBlocoLiga: schema liga ausente (repo lança) não derruba — devolve vazio e avisa', async () => {
  const avisos = [];
  const repoQuebrado = { lerGrupos: async () => { throw new Error('grupos: relation "liga.grupos" does not exist'); }, lerAmistososDoGrupo: async () => ({}) };
  const r = await lerBlocoLiga({ repo: criarRepoMemoria(fixture), liga: { repo: repoQuebrado, grupoId: 'terca' }, avisar: (m) => avisos.push(m) });
  assert.deepEqual(r, ligaVazia('terca'));
  assert.equal(avisos.length, 1);
});

await ta('lerBlocoLiga: com liga, devolve o mapeamento do grupo', async () => {
  const liga = { repo: criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [linha('a1')] }), grupoId: 'terca' };
  const r = await lerBlocoLiga({ repo: criarRepoMemoria(fixture), liga, relogio: () => AGORA });
  assert.equal(r.disponivel, true);
  assert.deepEqual(r.amistosos.map((a) => a.id), ['a1']);
});

fim();
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node tests/backend/amistosos.test.mjs`
Expected: erro de import de `amistosos.js`.

- [ ] **Step 4: Implementar a parte de leitura de `backend/amistosos.js`**

Criar `backend/amistosos.js`:

```js
// Amistosos entre grupos (spec docs/superpowers/specs/2026-10-12-amistosos-entre-grupos-design.md).
// Tudo que é "entre grupos" vive no schema compartilhado "liga" (deps.liga.repo); o grupo DESTE servidor é
// deps.liga.grupoId. Regra de ouro: cada servidor só altera o LADO do próprio grupo — amistoso em que ele não participa
// "não existe" pra ele, escalação só a do próprio grupo, responder só quando a vez é dele.
import { texto, mapearJogadores } from './mapeadores.js';
import { dataValida, horarioValido } from './jogos2.js';
import { enviarNotificacao } from './notificacoes.js';

export const DIAS_CONFIRMACAO_AUTOMATICA = 7;
const MAX_RECADO = 500;
const MAX_LOCAL = 200;
const MAX_FECHADOS = 50;
const ATIVOS = ['pendente', 'marcado', 'aguardando_confirmacao'];

const agoraDe = (deps) => (deps.relogio ? deps.relogio() : new Date());
const iso = (v) => (v ? new Date(v).toISOString() : '');
const participa = (a, g) => a.grupo_convidante === g || a.grupo_convidado === g;
const outroGrupo = (a, g) => (a.grupo_convidante === g ? a.grupo_convidado : a.grupo_convidante);
const porCriacao = (x, y) => (texto(x.criado_em) < texto(y.criado_em) ? -1 : texto(x.criado_em) > texto(y.criado_em) ? 1 : 0);

// início do jogo no horário de Brasília (os grupos são do Brasil; -03:00 fixo, sem horário de verão desde 2019)
export function inicioDoJogo(a) {
  return new Date(texto(a.data) + 'T' + (texto(a.horario) || '00:00') + ':00-03:00');
}

// placar parado há 7+ dias conta como confirmado — calculado na leitura, sem agendamento nenhum
export function statusEfetivo(a, agora) {
  if (a.status !== 'aguardando_confirmacao' || !a.placar_lancado_em) return a.status;
  const limite = new Date(a.placar_lancado_em).getTime() + DIAS_CONFIRMACAO_AUTOMATICA * 86400000;
  return agora.getTime() >= limite ? 'encerrado' : a.status;
}

export const ligaVazia = (grupoId) => ({ disponivel: false, grupoId: grupoId || '', grupos: [], amistosos: [] });

const pessoa = (e) => ({ jogadorId: texto(e.jogador_id), nome: texto(e.nome), foto: texto(e.foto_url) });

export function mapearLiga(bruto, grupoId, agora) {
  const grupos = (bruto.grupos || []).filter((g) => g.ativo !== false)
    .map((g) => ({ id: texto(g.id), nome: texto(g.nome), logoUrl: texto(g.logo_url), cor: texto(g.cor) }));
  const todos = (bruto.amistosos || []).filter((a) => participa(a, grupoId)).map((a) => ({ a, status: statusEfetivo(a, agora) }));
  const ativos = todos.filter((x) => ATIVOS.includes(x.status));
  // histórico: os 50 mais recentes por data do jogo (o resto continua no banco, só não vai pro app)
  const fechados = todos.filter((x) => !ATIVOS.includes(x.status))
    .sort((p, q) => (texto(p.a.data) < texto(q.a.data) ? 1 : texto(p.a.data) > texto(q.a.data) ? -1 : 0))
    .slice(0, MAX_FECHADOS);
  const amistosos = [...ativos, ...fechados].map(({ a, status }) => {
    const esc = (bruto.escalacoes || []).filter((e) => e.amistoso_id === a.id).sort(porCriacao);
    const meus = esc.filter((e) => e.grupo === grupoId);
    const deles = esc.filter((e) => e.grupo !== grupoId);
    return {
      id: texto(a.id), convidante: texto(a.grupo_convidante), convidado: texto(a.grupo_convidado), adversario: outroGrupo(a, grupoId),
      data: texto(a.data), horario: texto(a.horario), local: texto(a.local), vagasPorGrupo: Number(a.vagas_por_grupo) || 0,
      status, vezDe: texto(a.vez_de),
      setsConvidante: a.sets_convidante ?? null, setsConvidado: a.sets_convidado ?? null, parciais: a.parciais || [],
      placarLancadoPorGrupo: texto(a.placar_lancado_por_grupo), placarLancadoEm: iso(a.placar_lancado_em),
      motivoCancelamento: texto(a.motivo_cancelamento), criadoEm: iso(a.criado_em), atualizadoEm: iso(a.atualizado_em),
      mensagens: (bruto.mensagens || []).filter((m) => m.amistoso_id === a.id).sort(porCriacao)
        .map((m) => ({ grupo: texto(m.grupo), autorNome: texto(m.autor_nome), tipo: texto(m.tipo), texto: texto(m.texto), criadoEm: iso(m.criado_em) })),
      minhaEscalacao: {
        travada: (bruto.travas || []).some((x) => x.amistoso_id === a.id && x.grupo === grupoId),
        jogadores: meus.map((e) => ({ ...pessoa(e), status: texto(e.status), criadoEm: iso(e.criado_em) }))
      },
      // os interessados do outro grupo são assunto interno dele: aqui só a contagem
      escalacaoAdversario: {
        confirmados: deles.filter((e) => e.status === 'confirmado').map(pessoa),
        interessados: deles.filter((e) => e.status !== 'confirmado').length
      }
    };
  });
  return { disponivel: true, grupoId, grupos, amistosos };
}

const semLiga = (deps) => !deps.liga || !deps.liga.repo || !deps.liga.grupoId;

// nunca lança: se o schema "liga" ainda não existe (função publicada antes do SQL), o resto do app segue normal
export async function lerBlocoLiga(deps) {
  if (semLiga(deps)) return ligaVazia(deps.liga && deps.liga.grupoId);
  const { repo, grupoId } = deps.liga;
  try {
    const [grupos, resto] = await Promise.all([repo.lerGrupos(), repo.lerAmistososDoGrupo(grupoId)]);
    return mapearLiga({ grupos, ...resto }, grupoId, agoraDe(deps));
  } catch (erro) {
    try { (deps.avisar || (() => {}))('liga indisponível: ' + (erro && erro.message ? erro.message : erro)); } catch { /* nada */ }
    return ligaVazia(grupoId);
  }
}
```

(`mapearJogadores`, `dataValida`, `horarioValido`, `enviarNotificacao`, `MAX_RECADO` e `MAX_LOCAL` ainda não são usados aqui; as Tasks 4 a 6 usam.)

- [ ] **Step 5: Rodar e ver passar**

Run: `node tests/backend/amistosos.test.mjs && node tests/backend/jogos2.test.mjs`
Expected: os dois com `TODOS OS TESTES PASSARAM`.

- [ ] **Step 6: Acrescentar ao `test:backend` e fazer commit**

Em `package.json`, acrescentar ` && node tests/backend/amistosos.test.mjs` ao fim de `test:backend`.

```bash
git add backend/amistosos.js backend/jogos2.js tests/backend/amistosos.test.mjs package.json
git commit -m "feat(liga): leitura e mapeamento do bloco de amistosos"
```

---

### Task 4: Domínio — fluxo do convite

**Files:**
- Modify: `backend/amistosos.js` (acrescentar no fim)
- Modify: `tests/backend/amistosos.test.mjs` (acrescentar antes de `fim()`)

**Interfaces:**
- Consumes: `lerBlocoLiga`, `statusEfetivo` e o repositório da liga (Task 3).
- Produces (todas `async (deps, corpo, auth) -> { status: 'ok', liga: BlocoLiga } | { error: string }`):
  - `convidarGrupo(deps, { grupo, data, horario, local, vagasPorGrupo, recado }, auth)`
  - `responderConvite(deps, { id, resposta: 'aceitar'|'recusar'|'contrapropor', recado, data, horario, local, vagasPorGrupo }, auth)`
  - `cancelarAmistoso(deps, { id, motivo }, auth)`
  - `recadoAmistoso(deps, { id, texto }, auth)`
  - Helpers internos que as Tasks 5–6 reusam: `carregar(deps, id)`, `transicionar(deps, a, campos)`, `registrarMensagem(deps, a, tipo, texto, auth)`, `respostaOk(deps)`, `MSG_SEM_LIGA`, `MSG_MUDOU`.

- [ ] **Step 1: Escrever os testes (falham)**

No topo de `tests/backend/amistosos.test.mjs`, trocar o import de `amistosos.js` por:

```js
import {
  statusEfetivo, inicioDoJogo, mapearLiga, lerBlocoLiga, ligaVazia,
  convidarGrupo, responderConvite, cancelarAmistoso, recadoAmistoso
} from '../../backend/amistosos.js';
```

E acrescentar antes de `fim();`:

```js
// ---- dois "servidores" (Terça e Meme) falando com a MESMA liga ----
const ORG = { perfil: 'organizador', nome: 'Org', email: 'b@exemplo.com' };
function mundo() {
  let agora = new Date('2026-10-12T15:00:00.000Z');
  let n = 0;
  const repoLiga = criarRepoLigaMemoria({ grupos: GRUPOS });
  const push = [];
  const servidor = (grupoId) => ({
    repo: criarRepoMemoria({ ...fixture, push_inscricoes: [{ id: 'i1', endpoint: 'e-' + grupoId, p256dh: 'p', auth: 'a' }] }),
    liga: { repo: repoLiga, grupoId },
    relogio: () => agora,
    gerarId: () => 'id' + (++n),
    enviarPush: async (insc, payload) => { push.push([grupoId, JSON.parse(payload)]); }
  });
  return { terca: servidor('terca'), meme: servidor('meme'), outro: servidor('outro'), repoLiga, push, avancar: (iso) => { agora = new Date(iso); } };
}
const CONVITE = { grupo: 'meme', data: '2026-10-20', horario: '20:00', local: 'Quadra X', vagasPorGrupo: 6, recado: 'levamos bola' };
async function convidar(m) {
  const r = await convidarGrupo(m.terca, CONVITE, ORG);
  assert.equal(r.status, 'ok', JSON.stringify(r));
  return r.liga.amistosos[0].id;
}

await ta('convidarGrupo: cria pendente com a vez do convidado e registra a mensagem; o Meme enxerga', async () => {
  const m = mundo();
  const id = await convidar(m);
  const visto = (await lerBlocoLiga(m.meme)).amistosos.find((a) => a.id === id);
  assert.equal(visto.status, 'pendente');
  assert.equal(visto.vezDe, 'meme');
  assert.deepEqual(visto.mensagens.map((x) => [x.tipo, x.texto, x.grupo]), [['convite', 'levamos bola', 'terca']]);
});

await ta('convidarGrupo: validações (grupo, data, horário, vagas, data passada)', async () => {
  const m = mundo();
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, grupo: 'terca' }, ORG), { error: 'Escolha outro grupo para convidar.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, grupo: 'fantasma' }, ORG), { error: 'Grupo não encontrado.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, data: '2026-02-30' }, ORG), { error: 'Data inválida.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, horario: '8h' }, ORG), { error: 'Horário inválido.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, vagasPorGrupo: 31 }, ORG), { error: 'Vagas por grupo precisam ser entre 1 e 30.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, data: '2026-10-11' }, ORG), { error: 'A data do amistoso já passou.' });
  assert.equal(m.repoLiga.tabelas.amistosos.length, 0);
});

await ta('convidarGrupo: sem liga configurada responde erro claro', async () => {
  assert.deepEqual(await convidarGrupo({ repo: criarRepoMemoria(fixture) }, CONVITE, ORG), { error: 'Amistosos não estão disponíveis neste servidor.' });
});

await ta('responderConvite: só quem tem a vez responde; aceitar marca e manda push só aos inscritos de quem aceitou', async () => {
  const m = mundo();
  const id = await convidar(m);
  assert.deepEqual(await responderConvite(m.terca, { id, resposta: 'aceitar' }, ORG), { error: 'Agora a vez de responder é do outro grupo.' });
  const r = await responderConvite(m.meme, { id, resposta: 'aceitar', recado: 'fechado!' }, ORG);
  assert.equal(r.status, 'ok');
  const a = r.liga.amistosos.find((x) => x.id === id);
  assert.equal(a.status, 'marcado');
  assert.equal(a.vezDe, '');
  assert.deepEqual(m.push.map(([g]) => g), ['meme']);
  assert.match(m.push[0][1].corpo, /Vôlei de Terça em 20\/10 às 20:00/);
  assert.deepEqual(await responderConvite(m.meme, { id, resposta: 'recusar' }, ORG), { error: 'Esse convite não está mais esperando resposta.' });
});

await ta('responderConvite: contraproposta troca a vez e os campos; o vai e volta continua até aceitar', async () => {
  const m = mundo();
  const id = await convidar(m);
  const r1 = await responderConvite(m.meme, { id, resposta: 'contrapropor', data: '2026-10-22', horario: '19:00', local: 'Ginásio', vagasPorGrupo: 12, recado: 'terça não dá' }, ORG);
  assert.equal(r1.status, 'ok');
  let a = r1.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.vezDe, a.data, a.horario, a.local, a.vagasPorGrupo], ['pendente', 'terca', '2026-10-22', '19:00', 'Ginásio', 12]);
  assert.equal(a.mensagens.at(-1).tipo, 'contraproposta');
  assert.match(a.mensagens.at(-1).texto, /22\/10 às 19:00 em Ginásio — terça não dá/);
  const r2 = await responderConvite(m.terca, { id, resposta: 'aceitar' }, ORG);
  a = r2.liga.amistosos.find((x) => x.id === id);
  assert.equal(a.status, 'marcado');
});

await ta('responderConvite: recusar, resposta inválida e contraproposta com campos ruins', async () => {
  const m = mundo();
  const id = await convidar(m);
  assert.deepEqual(await responderConvite(m.meme, { id, resposta: 'talvez' }, ORG), { error: 'Resposta inválida.' });
  assert.deepEqual(await responderConvite(m.meme, { id, resposta: 'contrapropor', data: 'x', horario: '19:00' }, ORG), { error: 'Data inválida.' });
  const r = await responderConvite(m.meme, { id, resposta: 'recusar', recado: 'sem quadra' }, ORG);
  assert.equal(r.liga.amistosos.find((x) => x.id === id).status, 'recusado');
});

await ta('isolamento: grupo que não participa do amistoso recebe "não encontrado" e nada muda', async () => {
  const m = mundo();
  const id = await convidar(m);
  assert.deepEqual(await responderConvite(m.outro, { id, resposta: 'aceitar' }, ORG), { error: 'Amistoso não encontrado.' });
  assert.deepEqual(await cancelarAmistoso(m.outro, { id, motivo: 'x' }, ORG), { error: 'Amistoso não encontrado.' });
  assert.equal(m.repoLiga.tabelas.amistosos[0].status, 'pendente');
});

await ta('concorrência: se o status mudou entre a leitura e a gravação, a segunda ação perde', async () => {
  const m = mundo();
  const id = await convidar(m);
  // simula outro organizador do Meme aceitando "no meio" da recusa deste
  const original = m.repoLiga.atualizarAmistosoSe;
  m.repoLiga.atualizarAmistosoSe = async (...args) => { await original('' + id, 'pendente', { status: 'marcado' }); return original(...args); };
  assert.deepEqual(await responderConvite(m.meme, { id, resposta: 'recusar' }, ORG),
    { error: 'Esse amistoso mudou enquanto você olhava. Recarregue a página e tente de novo.' });
  m.repoLiga.atualizarAmistosoSe = original;
  assert.equal(m.repoLiga.tabelas.amistosos[0].status, 'marcado');
});

await ta('cancelarAmistoso: qualquer lado; marcado exige motivo; encerrado não cancela', async () => {
  const m = mundo();
  const id = await convidar(m);
  await responderConvite(m.meme, { id, resposta: 'aceitar' }, ORG);
  assert.deepEqual(await cancelarAmistoso(m.terca, { id }, ORG), { error: 'Conte o motivo do cancelamento (o outro grupo vai ver).' });
  const r = await cancelarAmistoso(m.terca, { id, motivo: 'choveu' }, ORG);
  const a = r.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.motivoCancelamento], ['cancelado', 'choveu']);
  assert.deepEqual(await cancelarAmistoso(m.meme, { id, motivo: 'x' }, ORG), { error: 'Esse amistoso não pode mais ser cancelado.' });
  // pendente cancela sem motivo
  const id2 = await convidar(m);
  assert.equal((await cancelarAmistoso(m.terca, { id: id2 }, ORG)).status, 'ok');
});

await ta('recadoAmistoso: grava no histórico; texto vazio é recusado; corta em 500', async () => {
  const m = mundo();
  const id = await convidar(m);
  assert.deepEqual(await recadoAmistoso(m.meme, { id, texto: '   ' }, ORG), { error: 'Escreva o recado.' });
  const r = await recadoAmistoso(m.meme, { id, texto: 'x'.repeat(600) }, ORG);
  const msg = r.liga.amistosos.find((x) => x.id === id).mensagens.at(-1);
  assert.deepEqual([msg.tipo, msg.grupo, msg.texto.length, msg.autorNome], ['recado', 'meme', 500, 'Org']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/amistosos.test.mjs`
Expected: `SyntaxError`/import falhando (`convidarGrupo` não exportado).

- [ ] **Step 3: Implementar (acrescentar no fim de `backend/amistosos.js`)**

```js
// ---------------------------------------------------------------- escrita: helpers comuns
export const MSG_SEM_LIGA = 'Amistosos não estão disponíveis neste servidor.';
export const MSG_MUDOU = 'Esse amistoso mudou enquanto você olhava. Recarregue a página e tente de novo.';
const gerarId = (deps) => (deps.gerarId ? deps.gerarId() : globalThis.crypto.randomUUID());
const nomeDe = (auth) => (auth && (auth.nome || auth.email)) || 'Desconhecido';
const recado = (v) => texto(v).trim().slice(0, MAX_RECADO);
// "hoje" no Brasil (-03:00): sem isso, às 22h de Brasília o servidor (UTC) já acharia que é amanhã
const hojeBrasil = (agora) => new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
const dataCurta = (iso) => { const [, m, d] = texto(iso).split('-'); return d + '/' + m; };

// toda escrita devolve o bloco atualizado: o app troca o estado local por ele (igual ao financeiro)
export async function respostaOk(deps) { return { status: 'ok', liga: await lerBlocoLiga(deps) }; }

// Lê o amistoso para uma ação. Amistoso de outros grupos "não existe" para este servidor. Se o placar já venceu os 7 dias,
// esta é "a primeira escrita que toca nele": grava o encerramento antes de seguir.
export async function carregar(deps, id) {
  const { repo, grupoId } = deps.liga;
  const r = await repo.lerAmistoso(texto(id));
  if (!r || !participa(r.amistoso, grupoId)) return { erro: 'Amistoso não encontrado.' };
  const a = r.amistoso;
  if (a.status === 'aguardando_confirmacao' && statusEfetivo(a, agoraDe(deps)) === 'encerrado') {
    if (await repo.atualizarAmistosoSe(a.id, 'aguardando_confirmacao', { status: 'encerrado', atualizado_em: agoraDe(deps).toISOString() })) a.status = 'encerrado';
  }
  return { ...r, amistoso: a };
}

// muda o amistoso SÓ se o status ainda é o que esta ação leu (concorrência otimista); false = alguém agiu antes
export async function transicionar(deps, a, campos) {
  return deps.liga.repo.atualizarAmistosoSe(a.id, a.status, { ...campos, atualizado_em: agoraDe(deps).toISOString() });
}

export async function registrarMensagem(deps, a, tipo, textoLivre, auth) {
  await deps.liga.repo.inserirMensagem({
    id: gerarId(deps), amistoso_id: a.id, grupo: deps.liga.grupoId, autor_nome: nomeDe(auth), tipo,
    texto: recado(textoLivre), criado_em: agoraDe(deps).toISOString()
  });
}

function validarCampos(c, agora) {
  if (!c || !dataValida(c.data)) return { erro: 'Data inválida.' };
  if (!horarioValido(c.horario)) return { erro: 'Horário inválido.' };
  const bruto = c.vagasPorGrupo;
  const vagas = bruto === undefined || bruto === null || bruto === '' ? 6 : Number(bruto);
  if (!Number.isInteger(vagas) || vagas < 1 || vagas > 30) return { erro: 'Vagas por grupo precisam ser entre 1 e 30.' };
  if (texto(c.data) < hojeBrasil(agora)) return { erro: 'A data do amistoso já passou.' };
  return { campos: { data: texto(c.data), horario: texto(c.horario), local: texto(c.local).trim().slice(0, MAX_LOCAL), vagas_por_grupo: vagas } };
}

// push é bônus: só vai para os inscritos DESTE grupo (cada servidor só lê as próprias inscrições) e nunca desfaz o aceite
async function avisarMarcado(deps, a, auth) {
  try {
    const grupos = await deps.liga.repo.lerGrupos();
    const adv = grupos.find((g) => g.id === outroGrupo(a, deps.liga.grupoId));
    await enviarNotificacao(deps, {
      titulo: '🏐 Amistoso marcado!',
      corpo: 'Contra ' + (adv ? adv.nome : 'outro grupo') + ' em ' + dataCurta(a.data) + ' às ' + a.horario + '. Marque "Vou jogar" no app.'
    }, auth);
  } catch (erro) {
    try { (deps.avisar || (() => {}))('push do amistoso falhou: ' + (erro && erro.message)); } catch { /* nada */ }
  }
}

// ---------------------------------------------------------------- convite
export async function convidarGrupo(deps, convite, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const { repo, grupoId } = deps.liga;
  const destino = texto(convite && convite.grupo);
  if (!destino || destino === grupoId) return { error: 'Escolha outro grupo para convidar.' };
  const grupos = await repo.lerGrupos();
  if (!grupos.some((g) => g.id === destino && g.ativo !== false)) return { error: 'Grupo não encontrado.' };
  const v = validarCampos(convite, agoraDe(deps));
  if (v.erro) return { error: v.erro };
  const agora = agoraDe(deps).toISOString();
  const a = {
    id: gerarId(deps), grupo_convidante: grupoId, grupo_convidado: destino, ...v.campos,
    status: 'pendente', vez_de: destino, criado_por: texto(auth && auth.email), criado_em: agora, atualizado_em: agora
  };
  await repo.inserirAmistoso(a);
  await registrarMensagem(deps, a, 'convite', convite.recado, auth);
  return respostaOk(deps);
}

export async function responderConvite(deps, b, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const { grupoId } = deps.liga;
  const r = await carregar(deps, b && b.id);
  if (r.erro) return { error: r.erro };
  const a = r.amistoso;
  if (a.status !== 'pendente') return { error: 'Esse convite não está mais esperando resposta.' };
  if (a.vez_de !== grupoId) return { error: 'Agora a vez de responder é do outro grupo.' };
  const resposta = texto(b.resposta);
  if (resposta === 'aceitar') {
    if (!(await transicionar(deps, a, { status: 'marcado', vez_de: null }))) return { error: MSG_MUDOU };
    await registrarMensagem(deps, a, 'aceite', b.recado, auth);
    await avisarMarcado(deps, a, auth);
    return respostaOk(deps);
  }
  if (resposta === 'recusar') {
    if (!(await transicionar(deps, a, { status: 'recusado', vez_de: null }))) return { error: MSG_MUDOU };
    await registrarMensagem(deps, a, 'recusa', b.recado, auth);
    return respostaOk(deps);
  }
  if (resposta === 'contrapropor') {
    const v = validarCampos(b, agoraDe(deps));
    if (v.erro) return { error: v.erro };
    if (!(await transicionar(deps, a, { ...v.campos, vez_de: outroGrupo(a, grupoId) }))) return { error: MSG_MUDOU };
    // o histórico guarda a proposta por escrito: quem lê depois entende o vai e volta sem comparar campos
    const c = v.campos;
    const resumo = dataCurta(c.data) + ' às ' + c.horario + (c.local ? ' em ' + c.local : '');
    await registrarMensagem(deps, a, 'contraproposta', [resumo, recado(b.recado)].filter(Boolean).join(' — '), auth);
    return respostaOk(deps);
  }
  return { error: 'Resposta inválida.' };
}

export async function cancelarAmistoso(deps, b, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return { error: r.erro };
  const a = r.amistoso;
  if (a.status !== 'pendente' && a.status !== 'marcado') return { error: 'Esse amistoso não pode mais ser cancelado.' };
  const motivo = recado(b.motivo);
  if (a.status === 'marcado' && !motivo) return { error: 'Conte o motivo do cancelamento (o outro grupo vai ver).' };
  if (!(await transicionar(deps, a, { status: 'cancelado', vez_de: null, motivo_cancelamento: motivo || null }))) return { error: MSG_MUDOU };
  await registrarMensagem(deps, a, 'cancelamento', motivo, auth);
  return respostaOk(deps);
}

export async function recadoAmistoso(deps, b, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return { error: r.erro };
  if (!recado(b.texto)) return { error: 'Escreva o recado.' };
  await registrarMensagem(deps, r.amistoso, 'recado', b.texto, auth);
  return respostaOk(deps);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/amistosos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Commit**

```bash
git add backend/amistosos.js tests/backend/amistosos.test.mjs
git commit -m "feat(liga): convite, contraproposta, cancelamento e recado de amistoso"
```

---

### Task 5: Domínio — convocação (escalação)

**Files:**
- Modify: `backend/amistosos.js` (acrescentar no fim)
- Modify: `tests/backend/amistosos.test.mjs`

**Interfaces:**
- Consumes: `carregar`, `respostaOk`, `MSG_SEM_LIGA` (Task 4); `deps.repo.lerJogadores()` + `mapearJogadores` (já existem).
- Produces (`async (deps, { id, jogadorId }) -> { status:'ok', liga } | { error }`):
  - `entrarAmistoso(deps, { id, jogadorId })`
  - `sairAmistoso(deps, { id, jogadorId })`
  - `confirmarEscalado(deps, { id, jogadorId })`
  - `desconfirmarEscalado(deps, { id, jogadorId })`
  - `travarEscalacao(deps, { id })` / `destravarEscalacao(deps, { id })`

- [ ] **Step 1: Escrever os testes (falham)**

Acrescentar ao import de `amistosos.js` no teste: `entrarAmistoso, sairAmistoso, confirmarEscalado, desconfirmarEscalado, travarEscalacao, destravarEscalacao`.

Antes de `fim();`:

```js
async function marcado(m, vagas = 6) {
  const r = await convidarGrupo(m.terca, { ...CONVITE, vagasPorGrupo: vagas }, ORG);
  const id = r.liga.amistosos[0].id;
  await responderConvite(m.meme, { id, resposta: 'aceitar' }, ORG);
  return id;
}
const minha = (r, id) => r.liga.amistosos.find((x) => x.id === id).minhaEscalacao;

await ta('entrarAmistoso: só depois de marcado; copia nome (apelido) e foto do jogador do grupo; não repete', async () => {
  const m = mundo();
  const r0 = await convidarGrupo(m.terca, CONVITE, ORG);
  const idPendente = r0.liga.amistosos[0].id;
  assert.deepEqual(await entrarAmistoso(m.terca, { id: idPendente, jogadorId: 'p2' }), { error: 'A lista só abre depois que o amistoso é marcado.' });
  const id = await marcado(m);
  const r = await entrarAmistoso(m.terca, { id, jogadorId: 'p2' });
  assert.deepEqual(minha(r, id).jogadores.map((j) => [j.jogadorId, j.nome, j.foto, j.status]), [['p2', 'Bru', 'https://exemplo.com/b.jpg', 'interessado']]);
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'p2' }), { error: 'Essa pessoa já está na lista.' });
});

await ta('entrarAmistoso: jogador inexistente, convidado ou removido é recusado', async () => {
  const m = mundo();
  const id = await marcado(m);
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'inventado' }), { error: 'Jogador não encontrado no seu grupo.' });
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'convidado:LUCAS#ab12' }), { error: 'Jogador não encontrado no seu grupo.' });
  await m.terca.repo.atualizarJogador('p1', { removido: true });
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'p1' }), { error: 'Jogador não encontrado no seu grupo.' });
});

await ta('isolamento: cada servidor só mexe na escalação do próprio grupo', async () => {
  const m = mundo();
  const id = await marcado(m);
  await entrarAmistoso(m.terca, { id, jogadorId: 'p1' });
  await entrarAmistoso(m.meme, { id, jogadorId: 'p1' }); // "p1" do Meme é outra pessoa (outro schema)
  assert.deepEqual(m.repoLiga.tabelas.escalacoes.map((e) => e.grupo).sort(), ['meme', 'terca']);
  await sairAmistoso(m.meme, { id, jogadorId: 'p1' });
  assert.deepEqual(m.repoLiga.tabelas.escalacoes.map((e) => e.grupo), ['terca']);
});

await ta('confirmar/desconfirmar: respeita o limite de vagas; o adversário passa a ver o confirmado', async () => {
  const m = mundo();
  const id = await marcado(m, 1);
  await entrarAmistoso(m.terca, { id, jogadorId: 'p1' });
  await entrarAmistoso(m.terca, { id, jogadorId: 'p2' });
  assert.deepEqual(await confirmarEscalado(m.terca, { id, jogadorId: 'p9' }), { error: 'Essa pessoa não está na lista.' });
  assert.equal((await confirmarEscalado(m.terca, { id, jogadorId: 'p1' })).status, 'ok');
  assert.deepEqual(await confirmarEscalado(m.terca, { id, jogadorId: 'p2' }), { error: 'Já tem 1 confirmados (limite 1).' });
  const visto = (await lerBlocoLiga(m.meme)).amistosos.find((x) => x.id === id).escalacaoAdversario;
  assert.deepEqual(visto, { confirmados: [{ jogadorId: 'p1', nome: 'Ana', foto: '' }], interessados: 1 });
  const r = await desconfirmarEscalado(m.terca, { id, jogadorId: 'p1' });
  assert.equal(minha(r, id).jogadores.find((j) => j.jogadorId === 'p1').status, 'interessado');
});

await ta('travar: ninguém entra nem sai, mas o organizador ainda confirma; destravar libera', async () => {
  const m = mundo();
  const id = await marcado(m);
  await entrarAmistoso(m.terca, { id, jogadorId: 'p1' });
  const r = await travarEscalacao(m.terca, { id });
  assert.equal(minha(r, id).travada, true);
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'p2' }), { error: 'A lista do seu grupo está travada.' });
  assert.deepEqual(await sairAmistoso(m.terca, { id, jogadorId: 'p1' }), { error: 'A lista do seu grupo está travada.' });
  assert.equal((await confirmarEscalado(m.terca, { id, jogadorId: 'p1' })).status, 'ok');
  assert.equal((await entrarAmistoso(m.meme, { id, jogadorId: 'p2' })).status, 'ok'); // a trava do Terça não trava o Meme
  await destravarEscalacao(m.terca, { id });
  assert.equal((await entrarAmistoso(m.terca, { id, jogadorId: 'p2' })).status, 'ok');
});

await ta('sairAmistoso: quem não está na lista recebe erro', async () => {
  const m = mundo();
  const id = await marcado(m);
  assert.deepEqual(await sairAmistoso(m.terca, { id, jogadorId: 'p1' }), { error: 'Essa pessoa não está na lista.' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/amistosos.test.mjs`
Expected: import falhando (`entrarAmistoso` não exportado).

- [ ] **Step 3: Implementar (acrescentar no fim de `backend/amistosos.js`)**

```js
// ---------------------------------------------------------------- convocação
// lista aberta de interessados ("Vou jogar") + o organizador confirma quem joga. Separada da rodada: não toca em checkins.
async function carregarParaEscalacao(deps, b) {
  if (semLiga(deps)) return { erro: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return r;
  if (r.amistoso.status !== 'marcado') return { erro: 'A lista só abre depois que o amistoso é marcado.' };
  const travada = r.travas.some((x) => x.grupo === deps.liga.grupoId);
  return { ...r, travada };
}

export async function entrarAmistoso(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  if (r.travada) return { error: 'A lista do seu grupo está travada.' };
  // só jogador de verdade do PRÓPRIO grupo (nem convidado, nem removido): o id vem do navegador e não é confiável
  const jogador = mapearJogadores(await deps.repo.lerJogadores()).find((p) => p.id === texto(b.jogadorId));
  if (!jogador) return { error: 'Jogador não encontrado no seu grupo.' };
  const entrou = await deps.liga.repo.inserirEscalacao({
    id: gerarId(deps), amistoso_id: r.amistoso.id, grupo: deps.liga.grupoId, jogador_id: jogador.id,
    nome: jogador.apelido || jogador.nome, foto_url: jogador.foto || null, status: 'interessado', criado_em: agoraDe(deps).toISOString()
  });
  if (!entrou) return { error: 'Essa pessoa já está na lista.' };
  return respostaOk(deps);
}

export async function sairAmistoso(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  if (r.travada) return { error: 'A lista do seu grupo está travada.' };
  if (!(await deps.liga.repo.removerEscalacao(r.amistoso.id, deps.liga.grupoId, texto(b.jogadorId)))) return { error: 'Essa pessoa não está na lista.' };
  return respostaOk(deps);
}

// a trava não impede o organizador de confirmar: travar é justamente o momento de fechar a escalação
export async function confirmarEscalado(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  const { grupoId } = deps.liga;
  const meus = r.escalacoes.filter((e) => e.grupo === grupoId);
  const alvo = meus.find((e) => e.jogador_id === texto(b.jogadorId));
  if (!alvo) return { error: 'Essa pessoa não está na lista.' };
  if (alvo.status === 'confirmado') return respostaOk(deps); // confirmar duas vezes não é erro
  const vagas = Number(r.amistoso.vagas_por_grupo) || 0;
  const confirmados = meus.filter((e) => e.status === 'confirmado').length;
  if (confirmados >= vagas) return { error: 'Já tem ' + confirmados + ' confirmados (limite ' + vagas + ').' };
  await deps.liga.repo.atualizarEscalacao(r.amistoso.id, grupoId, alvo.jogador_id, { status: 'confirmado' });
  return respostaOk(deps);
}

export async function desconfirmarEscalado(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  if (!(await deps.liga.repo.atualizarEscalacao(r.amistoso.id, deps.liga.grupoId, texto(b.jogadorId), { status: 'interessado' }))) {
    return { error: 'Essa pessoa não está na lista.' };
  }
  return respostaOk(deps);
}

export async function travarEscalacao(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  await deps.liga.repo.definirTrava(r.amistoso.id, deps.liga.grupoId, true);
  return respostaOk(deps);
}

export async function destravarEscalacao(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  await deps.liga.repo.definirTrava(r.amistoso.id, deps.liga.grupoId, false);
  return respostaOk(deps);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/amistosos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Commit**

```bash
git add backend/amistosos.js tests/backend/amistosos.test.mjs
git commit -m "feat(liga): convocação dos amistosos (vou jogar, confirmar, travar)"
```

---

### Task 6: Domínio — placar

**Files:**
- Modify: `backend/amistosos.js`
- Modify: `tests/backend/amistosos.test.mjs`

**Interfaces:**
- Consumes: `carregar`, `transicionar`, `registrarMensagem`, `respostaOk`, `inicioDoJogo` (Tasks 3–4).
- Produces:
  - `lancarPlacar(deps, { id, setsConvidante, setsConvidado, parciais?, recado? }, auth)`
  - `confirmarPlacar(deps, { id }, auth)`
  - `contestarPlacar(deps, { id, texto }, auth)`

- [ ] **Step 1: Escrever os testes (falham)**

Acrescentar ao import: `lancarPlacar, confirmarPlacar, contestarPlacar`. Antes de `fim();`:

```js
const PLACAR = { setsConvidante: 3, setsConvidado: 1, parciais: [[25, 20], [25, 22], [18, 25], [25, 23]] };

await ta('lancarPlacar: só marcado e só depois do horário (Brasília); fica aguardando o outro grupo', async () => {
  const m = mundo();
  const id = await marcado(m);
  assert.deepEqual(await lancarPlacar(m.terca, { id, ...PLACAR }, ORG), { error: 'O placar só pode ser lançado depois do horário do jogo.' });
  m.avancar('2026-10-20T22:59:00.000Z'); // 19:59 em Brasília, jogo às 20:00
  assert.deepEqual(await lancarPlacar(m.terca, { id, ...PLACAR }, ORG), { error: 'O placar só pode ser lançado depois do horário do jogo.' });
  m.avancar('2026-10-20T23:00:00.000Z');
  const r = await lancarPlacar(m.terca, { id, ...PLACAR }, ORG);
  const a = r.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.setsConvidante, a.setsConvidado, a.placarLancadoPorGrupo], ['aguardando_confirmacao', 3, 1, 'terca']);
  assert.deepEqual(a.parciais, PLACAR.parciais);
  assert.equal(a.mensagens.at(-1).tipo, 'placar');
  assert.match(a.mensagens.at(-1).texto, /3 × 1/);
});

await ta('lancarPlacar: placar inválido e parciais inválidas', async () => {
  const m = mundo();
  const id = await marcado(m);
  m.avancar('2026-10-21T01:00:00.000Z');
  for (const ruim of [{ setsConvidante: 0, setsConvidado: 0 }, { setsConvidante: -1, setsConvidado: 2 }, { setsConvidante: 1.5, setsConvidado: 2 }, { setsConvidante: 10, setsConvidado: 0 }, { setsConvidante: 'a', setsConvidado: 1 }]) {
    assert.deepEqual(await lancarPlacar(m.terca, { id, ...ruim }, ORG), { error: 'Placar inválido.' }, JSON.stringify(ruim));
  }
  assert.deepEqual(await lancarPlacar(m.terca, { id, setsConvidante: 2, setsConvidado: 1, parciais: [[25, 'x']] }, ORG), { error: 'Parciais inválidas.' });
  assert.deepEqual(await lancarPlacar(m.terca, { id, setsConvidante: 2, setsConvidado: 1, parciais: 'abc' }, ORG), { error: 'Parciais inválidas.' });
  assert.equal((await lancarPlacar(m.terca, { id, setsConvidante: 2, setsConvidado: 1 }, ORG)).status, 'ok'); // parciais opcionais
});

await ta('confirmarPlacar: só o grupo que NÃO lançou; encerra', async () => {
  const m = mundo();
  const id = await marcado(m);
  m.avancar('2026-10-21T01:00:00.000Z');
  await lancarPlacar(m.terca, { id, ...PLACAR }, ORG);
  assert.deepEqual(await confirmarPlacar(m.terca, { id }, ORG), { error: 'Quem confirma o placar é o outro grupo.' });
  const r = await confirmarPlacar(m.meme, { id }, ORG);
  assert.equal(r.liga.amistosos.find((x) => x.id === id).status, 'encerrado');
  assert.deepEqual(await confirmarPlacar(m.meme, { id }, ORG), { error: 'Esse placar já foi confirmado.' });
});

await ta('contestarPlacar: exige texto, limpa o placar e volta para marcado; qualquer lado lança de novo', async () => {
  const m = mundo();
  const id = await marcado(m);
  m.avancar('2026-10-21T01:00:00.000Z');
  await lancarPlacar(m.terca, { id, ...PLACAR }, ORG);
  assert.deepEqual(await contestarPlacar(m.meme, { id, texto: ' ' }, ORG), { error: 'Explique o que está errado no placar.' });
  assert.deepEqual(await contestarPlacar(m.terca, { id, texto: 'x' }, ORG), { error: 'Quem confirma o placar é o outro grupo.' });
  const r = await contestarPlacar(m.meme, { id, texto: 'foi 3 × 2' }, ORG);
  const a = r.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.setsConvidante, a.placarLancadoPorGrupo, a.parciais], ['marcado', null, '', []]);
  assert.equal((await lancarPlacar(m.meme, { id, setsConvidante: 3, setsConvidado: 2 }, ORG)).status, 'ok');
});

await ta('confirmação automática: depois de 7 dias aparece encerrado e a primeira escrita grava isso', async () => {
  const m = mundo();
  const id = await marcado(m);
  m.avancar('2026-10-21T01:00:00.000Z');
  await lancarPlacar(m.terca, { id, ...PLACAR }, ORG);
  m.avancar('2026-10-28T01:00:00.000Z');
  assert.equal((await lerBlocoLiga(m.meme)).amistosos.find((x) => x.id === id).status, 'encerrado');
  assert.equal(m.repoLiga.tabelas.amistosos[0].status, 'aguardando_confirmacao'); // a leitura não grava
  assert.deepEqual(await contestarPlacar(m.meme, { id, texto: 'tarde demais' }, ORG), { error: 'Esse placar já foi confirmado.' });
  assert.equal(m.repoLiga.tabelas.amistosos[0].status, 'encerrado'); // a escrita gravou
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/amistosos.test.mjs`
Expected: import falhando (`lancarPlacar` não exportado).

- [ ] **Step 3: Implementar (acrescentar no fim de `backend/amistosos.js`)**

```js
// ---------------------------------------------------------------- placar
const setsValidos = (n) => Number.isInteger(n) && n >= 0 && n <= 9;
// parciais opcionais: até 9 sets, cada um [pontos do convidante, pontos do convidado]
function validarParciais(p) {
  if (p === undefined || p === null || (Array.isArray(p) && p.length === 0)) return { parciais: null };
  if (!Array.isArray(p) || p.length > 9) return { erro: true };
  for (const s of p) {
    if (!Array.isArray(s) || s.length !== 2 || !s.every((x) => Number.isInteger(x) && x >= 0 && x <= 99)) return { erro: true };
  }
  return { parciais: p };
}

export async function lancarPlacar(deps, b, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return { error: r.erro };
  const a = r.amistoso;
  if (a.status !== 'marcado') return { error: 'Só dá pra lançar o placar de um amistoso marcado.' };
  if (agoraDe(deps).getTime() < inicioDoJogo(a).getTime()) return { error: 'O placar só pode ser lançado depois do horário do jogo.' };
  const sc = b.setsConvidante, sd = b.setsConvidado;
  if (!setsValidos(sc) || !setsValidos(sd) || sc + sd === 0) return { error: 'Placar inválido.' };
  const p = validarParciais(b.parciais);
  if (p.erro) return { error: 'Parciais inválidas.' };
  const ok = await transicionar(deps, a, {
    status: 'aguardando_confirmacao', sets_convidante: sc, sets_convidado: sd, parciais: p.parciais,
    placar_lancado_por_grupo: deps.liga.grupoId, placar_lancado_em: agoraDe(deps).toISOString()
  });
  if (!ok) return { error: MSG_MUDOU };
  await registrarMensagem(deps, a, 'placar', ['Placar: ' + sc + ' × ' + sd, recado(b.recado)].filter(Boolean).join(' — '), auth);
  return respostaOk(deps);
}

// confirmar e contestar: só o grupo que NÃO lançou. Se os 7 dias já passaram, carregar() já gravou o encerramento.
async function carregarParaConferir(deps, b) {
  if (semLiga(deps)) return { erro: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return r;
  const a = r.amistoso;
  if (a.status === 'encerrado') return { erro: 'Esse placar já foi confirmado.' };
  if (a.status !== 'aguardando_confirmacao') return { erro: 'Esse amistoso não tem placar esperando confirmação.' };
  if (a.placar_lancado_por_grupo === deps.liga.grupoId) return { erro: 'Quem confirma o placar é o outro grupo.' };
  return r;
}

export async function confirmarPlacar(deps, b, auth) {
  const r = await carregarParaConferir(deps, b);
  if (r.erro) return { error: r.erro };
  if (!(await transicionar(deps, r.amistoso, { status: 'encerrado' }))) return { error: MSG_MUDOU };
  await registrarMensagem(deps, r.amistoso, 'confirmacao', '', auth);
  return respostaOk(deps);
}

export async function contestarPlacar(deps, b, auth) {
  const r = await carregarParaConferir(deps, b);
  if (r.erro) return { error: r.erro };
  if (!recado(b.texto)) return { error: 'Explique o que está errado no placar.' };
  const ok = await transicionar(deps, r.amistoso, {
    status: 'marcado', sets_convidante: null, sets_convidado: null, parciais: null, placar_lancado_por_grupo: null, placar_lancado_em: null
  });
  if (!ok) return { error: MSG_MUDOU };
  await registrarMensagem(deps, r.amistoso, 'contestacao', b.texto, auth);
  return respostaOk(deps);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/amistosos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Commit**

```bash
git add backend/amistosos.js tests/backend/amistosos.test.mjs
git commit -m "feat(liga): placar dos amistosos (lançar, confirmar, contestar, confirmação automática)"
```

---

### Task 7: Handler, permissões, servidor local e Edge Function do Terça

**Files:**
- Modify: `backend/permissoes.js`
- Modify: `backend/handler.js`
- Modify: `backend/servidor-local.js`
- Modify: `supabase/functions/terca-api-teste/index.ts`
- Modify: `tests/backend/permissoes.test.mjs`
- Create: `tests/backend/handler-amistosos.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: todas as funções exportadas de `backend/amistosos.js` (Tasks 3–6); `criarRepoLigaSupabase` (Task 2).
- Produces:
  - `criarHandler({ ..., liga })`, onde `liga = { repo, grupoId }` é opcional.
  - O GET passa a incluir `liga: BlocoLiga`.
  - As ações POST `convidarGrupo`, `responderConvite`, `cancelarAmistoso`, `recadoAmistoso`, `entrarAmistoso`, `sairAmistoso`, `confirmarEscalado`, `desconfirmarEscalado`, `travarEscalacao`, `destravarEscalacao`, `lancarPlacar`, `confirmarPlacar`, `contestarPlacar`. Os campos vão no corpo, no mesmo nível de `action` (ex.: `{ action: 'responderConvite', id, resposta, recado }`), exceto `convidarGrupo`, que recebe `{ action, convite: {...} }`.

- [ ] **Step 1: Escrever o teste do handler (falha)**

Criar `tests/backend/handler-amistosos.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' }, // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }  // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const GRUPOS = [{ id: 'terca', nome: 'Vôlei de Terça' }, { id: 'meme', nome: 'Vôlei Meme Brasil' }];

function mundo() {
  let agora = new Date('2026-10-12T15:00:00.000Z');
  const repoLiga = criarRepoLigaMemoria({ grupos: GRUPOS });
  const novo = (grupoId) => criarHandler({
    repo: criarRepoMemoria(fixture), config: { adminPassword: '' }, verificarToken,
    relogio: () => agora, liga: { repo: repoLiga, grupoId }, enviarPush: async () => {}
  });
  return { terca: novo('terca'), meme: novo('meme'), repoLiga, avancar: (iso) => { agora = new Date(iso); } };
}
const CONVITE = { grupo: 'meme', data: '2026-10-20', horario: '20:00', local: 'Quadra X', vagasPorGrupo: 6, recado: 'bora' };

await ta('GET: traz o bloco liga; sem liga injetada vem disponivel=false e o resto do app normal', async () => {
  const m = mundo();
  const g = await m.terca.get();
  assert.equal(g.liga.disponivel, true);
  assert.equal(g.liga.grupoId, 'terca');
  assert.ok(Array.isArray(g.players));
  const semLiga = await criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: '' }, verificarToken }).get();
  assert.deepEqual(semLiga.liga, { disponivel: false, grupoId: '', grupos: [], amistosos: [] });
  assert.ok(semLiga.players.length > 0);
});

await ta('GET: schema liga quebrado não derruba a leitura geral', async () => {
  const quebrado = { lerGrupos: async () => { throw new Error('relation "liga.grupos" does not exist'); }, lerAmistososDoGrupo: async () => ({}) };
  const h = criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: '' }, verificarToken, liga: { repo: quebrado, grupoId: 'terca' } });
  const g = await h.get();
  assert.equal(g.error, undefined);
  assert.equal(g.liga.disponivel, false);
});

await ta('permissões: jogador não convida nem responde; sem login nada', async () => {
  const m = mundo();
  assert.deepEqual(await m.terca.post({ action: 'convidarGrupo', idToken: 'tok-c', convite: CONVITE }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.deepEqual(await m.terca.post({ action: 'convidarGrupo', convite: CONVITE }), { error: 'Sem token de login. Entre com sua conta Google.' });
});

await ta('ponta a ponta: Terça convida, Meme aceita, jogadores entram, org confirma, placar lançado e confirmado', async () => {
  const m = mundo();
  const r1 = await m.terca.post({ action: 'convidarGrupo', idToken: 'tok-b', convite: CONVITE });
  assert.equal(r1.status, 'ok', JSON.stringify(r1));
  const id = r1.liga.amistosos[0].id;
  const rMeme = await m.meme.get();
  assert.equal(rMeme.liga.amistosos[0].vezDe, 'meme');
  assert.equal((await m.meme.post({ action: 'responderConvite', idToken: 'tok-a', id, resposta: 'aceitar' })).status, 'ok');
  // "Vou jogar": qualquer logado, inclusive perfil jogador (igual ao check-in); sem login não
  assert.deepEqual(await m.terca.post({ action: 'entrarAmistoso', id, jogadorId: 'p1' }), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.equal((await m.terca.post({ action: 'entrarAmistoso', idToken: 'tok-c', id, jogadorId: 'p1' })).status, 'ok');
  assert.deepEqual(await m.terca.post({ action: 'confirmarEscalado', idToken: 'tok-c', id, jogadorId: 'p1' }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.equal((await m.terca.post({ action: 'confirmarEscalado', idToken: 'tok-b', id, jogadorId: 'p1' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'travarEscalacao', idToken: 'tok-b', id })).status, 'ok');
  m.avancar('2026-10-21T01:00:00.000Z');
  assert.equal((await m.meme.post({ action: 'lancarPlacar', idToken: 'tok-b', id, setsConvidante: 1, setsConvidado: 3 })).status, 'ok');
  const fim_ = await m.terca.post({ action: 'confirmarPlacar', idToken: 'tok-b', id });
  const a = fim_.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.setsConvidante, a.setsConvidado], ['encerrado', 1, 3]);
  assert.deepEqual(a.mensagens.map((x) => x.tipo), ['convite', 'aceite', 'placar', 'confirmacao']);
});

await ta('roteamento: as demais ações chegam ao domínio', async () => {
  const m = mundo();
  const id = (await m.terca.post({ action: 'convidarGrupo', idToken: 'tok-b', convite: CONVITE })).liga.amistosos[0].id;
  assert.equal((await m.terca.post({ action: 'recadoAmistoso', idToken: 'tok-b', id, texto: 'oi' })).status, 'ok');
  assert.equal((await m.meme.post({ action: 'responderConvite', idToken: 'tok-b', id, resposta: 'contrapropor', data: '2026-10-21', horario: '19:00' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'responderConvite', idToken: 'tok-b', id, resposta: 'aceitar' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'entrarAmistoso', idToken: 'tok-b', id, jogadorId: 'p2' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'confirmarEscalado', idToken: 'tok-b', id, jogadorId: 'p2' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'desconfirmarEscalado', idToken: 'tok-b', id, jogadorId: 'p2' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'sairAmistoso', idToken: 'tok-b', id, jogadorId: 'p2' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'travarEscalacao', idToken: 'tok-b', id })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'destravarEscalacao', idToken: 'tok-b', id })).status, 'ok');
  m.avancar('2026-10-22T01:00:00.000Z');
  assert.equal((await m.terca.post({ action: 'lancarPlacar', idToken: 'tok-b', id, setsConvidante: 2, setsConvidado: 0 })).status, 'ok');
  assert.equal((await m.meme.post({ action: 'contestarPlacar', idToken: 'tok-b', id, texto: 'errado' })).status, 'ok');
  assert.equal((await m.meme.post({ action: 'cancelarAmistoso', idToken: 'tok-b', id, motivo: 'deixa pra lá' })).status, 'ok');
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/handler-amistosos.test.mjs`
Expected: FALHA (`g.liga` undefined / "Ação desconhecida: convidarGrupo").

- [ ] **Step 3: Permissões**

Em `backend/permissoes.js`, antes da linha `enviarNotificacao:  ['organizador', 'admin']`, acrescentar:

```js
  // amistosos entre grupos (2026-10-12). entrarAmistoso/sairAmistoso ficam FORA da matriz de propósito: são como o
  // check-in (só pedem login, qualquer perfil) e o handler trata antes do porteiro
  convidarGrupo:        ['organizador', 'admin'],
  responderConvite:     ['organizador', 'admin'],
  cancelarAmistoso:     ['organizador', 'admin'],
  recadoAmistoso:       ['organizador', 'admin'],
  confirmarEscalado:    ['organizador', 'admin'],
  desconfirmarEscalado: ['organizador', 'admin'],
  travarEscalacao:      ['organizador', 'admin'],
  destravarEscalacao:   ['organizador', 'admin'],
  lancarPlacar:         ['organizador', 'admin'],
  confirmarPlacar:      ['organizador', 'admin'],
  contestarPlacar:      ['organizador', 'admin'],
```

Em `tests/backend/permissoes.test.mjs`, trocar a linha da desestruturação por:

```js
    // amistosos entre grupos (2026-10-12): também só existem no backend novo
    const {
      restorePlayer, moverCheckin, salvarJogo2, removerJogo2, enviarNotificacao,
      convidarGrupo, responderConvite, cancelarAmistoso, recadoAmistoso, confirmarEscalado, desconfirmarEscalado,
      travarEscalacao, destravarEscalacao, lancarPlacar, confirmarPlacar, contestarPlacar, ...resto
    } = PERMISSOES;
```

E, depois de `assert.deepEqual(enviarNotificacao, ['organizador', 'admin']);`, acrescentar:

```js
    for (const acao of [convidarGrupo, responderConvite, cancelarAmistoso, recadoAmistoso, confirmarEscalado, desconfirmarEscalado,
      travarEscalacao, destravarEscalacao, lancarPlacar, confirmarPlacar, contestarPlacar]) assert.deepEqual(acao, ['organizador', 'admin']);
```

- [ ] **Step 4: Handler**

Em `backend/handler.js`:

1. Acrescentar o import depois do import de `aovivo.js`:

```js
import {
  lerBlocoLiga, convidarGrupo, responderConvite, cancelarAmistoso, recadoAmistoso,
  entrarAmistoso, sairAmistoso, confirmarEscalado, desconfirmarEscalado, travarEscalacao, destravarEscalacao,
  lancarPlacar, confirmarPlacar, contestarPlacar
} from './amistosos.js';
```

2. Na assinatura de `criarHandler`, acrescentar `liga` depois de `enviarPush`: `..., registrar = () => {}, enviarPush, liga }) {`. Acrescentar o comentário `// liga (opcional): { repo, grupoId } dos amistosos entre grupos (schema "liga"); sem ela o bloco vem vazio e as ações respondem erro claro` logo abaixo do comentário do `enviarPush`. No objeto `deps`, acrescentar `liga,` antes de `enviarPush: ...`.

3. Em `get()`, trocar `const t = await repo.lerTudo();` por:

```js
        // o bloco da liga nunca lança (schema ausente = bloco vazio), então pode correr em paralelo sem risco
        const [t, liga] = await Promise.all([repo.lerTudo(), lerBlocoLiga(deps)]);
```

E acrescentar `liga` ao objeto devolvido, depois de `financeiro: mapearFinanceiro(t)`:

```js
          financeiro: mapearFinanceiro(t),
          liga
```

4. Em `post()`, logo depois do bloco do `addCheckin`/`removeCheckin`, acrescentar:

```js
        // "Vou jogar" num amistoso: mesma regra do check-in (só login, qualquer perfil), por isso antes do porteiro
        if (acao === 'entrarAmistoso' || acao === 'sairAmistoso') {
          const token = await identificar(deps, b);
          if (!token.ok) return { error: token.erro };
          return await travar(() => (acao === 'entrarAmistoso' ? entrarAmistoso(deps, b) : sairAmistoso(deps, b)));
        }
```

5. No `switch`, antes de `default:`, acrescentar:

```js
          // amistosos entre grupos (2026-10-12): toda gravação sob a trava, como o resto
          case 'convidarGrupo': return await travar(() => convidarGrupo(deps, b.convite, auth));
          case 'responderConvite': return await travar(() => responderConvite(deps, b, auth));
          case 'cancelarAmistoso': return await travar(() => cancelarAmistoso(deps, b, auth));
          case 'recadoAmistoso': return await travar(() => recadoAmistoso(deps, b, auth));
          case 'confirmarEscalado': return await travar(() => confirmarEscalado(deps, b));
          case 'desconfirmarEscalado': return await travar(() => desconfirmarEscalado(deps, b));
          case 'travarEscalacao': return await travar(() => travarEscalacao(deps, b));
          case 'destravarEscalacao': return await travar(() => destravarEscalacao(deps, b));
          case 'lancarPlacar': return await travar(() => lancarPlacar(deps, b, auth));
          case 'confirmarPlacar': return await travar(() => confirmarPlacar(deps, b, auth));
          case 'contestarPlacar': return await travar(() => contestarPlacar(deps, b, auth));
```

- [ ] **Step 5: Rodar o teste do handler e das permissões**

Run: `node tests/backend/handler-amistosos.test.mjs && node tests/backend/permissoes.test.mjs`
Expected: os dois com `TODOS OS TESTES PASSARAM`.

- [ ] **Step 6: Servidor local**

Em `backend/servidor-local.js`, acrescentar o import junto aos outros do backend:

```js
import { criarRepoLigaSupabase } from './repo-liga-supabase.js';
```

E dentro do `criarHandler({ ... })`, depois de `config: ...`:

```js
  // amistosos: o schema "liga" é o mesmo pros dois grupos; o grupo deste servidor é o do .env (GRUPO=meme ou Terça)
  liga: { repo: criarRepoLigaSupabase(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'liga' } })), grupoId: cfg.grupo },
```

Antes de editar, conferir com `node -e "const {configDoGrupo}=require('./scripts/lib/grupo.js'); console.log(configDoGrupo().grupo)"` que `cfg.grupo` devolve `terca` sem `GRUPO` no ambiente. Se devolver outra coisa, usar `cfg.grupo === 'meme' ? 'meme' : 'terca'`.

- [ ] **Step 7: Edge Function do Terça**

Em `supabase/functions/terca-api-teste/index.ts`, acrescentar o import:

```ts
import { criarRepoLigaSupabase } from './backend/repo-liga-supabase.js';
```

Depois de `const repo = criarRepoSupabase(cliente);`, acrescentar:

```ts
  // amistosos entre grupos: segundo cliente apontando pro schema compartilhado "liga". Se o SQL da liga ainda não rodou,
  // o GET devolve o bloco vazio e o resto do app segue normal (nunca derrubar o app por uma peça nova).
  const clienteLiga = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'liga' }
  });
```

E, dentro de `criarHandler({ ... })`, depois de `enviarPush,`:

```ts
    liga: { repo: criarRepoLigaSupabase(clienteLiga), grupoId: 'terca' },
```

- [ ] **Step 8: Rodar a suíte inteira do backend**

Em `package.json`, acrescentar ` && node tests/backend/handler-amistosos.test.mjs` ao fim de `test:backend`.

Run: `npm run test:backend`
Expected: todos os arquivos terminam em `TODOS OS TESTES PASSARAM` (incluindo `meme-api-index.test.mjs`, que garante que o `index.ts` do Terça não menciona "meme", e `preparar-edge.test.mjs`).

Run: `npm run preparar-edge` e depois `ls supabase/functions/terca-api-teste/backend/ | grep -E "amistosos|repo-liga"`
Expected: o script termina sem apontar problema e lista `amistosos.js`, `repo-liga-memoria.js` e `repo-liga-supabase.js`.

- [ ] **Step 9: Commit**

```bash
git add backend/permissoes.js backend/handler.js backend/servidor-local.js supabase/functions/terca-api-teste/index.ts tests/backend/permissoes.test.mjs tests/backend/handler-amistosos.test.mjs package.json
git commit -m "feat(liga): ações de amistoso no handler e na função do Terça"
```

---

### Task 8: Front do Terça — bloco puro `<amistosos-puro>`

**Files:**
- Modify: `volei-dashboard.html` (logo depois do bloco `// </financeiro-puro>`)
- Create: `tests/amistosos-puro.test.js`

**Interfaces:**
- Consumes: o formato `BlocoLiga` (Task 3).
- Produces (funções globais do front, puras):
  - `AMI_ATIVOS`
  - `amiNormalizar(liga) -> BlocoLiga`
  - `amiNomeGrupo(liga, id) -> string`
  - `amiDataCurta(iso) -> 'dd/mm'`
  - `amiHojeBrasil(agoraMs) -> 'YYYY-MM-DD'`
  - `amiPendencias(liga) -> amistoso[]`
  - `amiTextoAviso(liga) -> string`
  - `amiProximoMarcado(liga, hojeIso) -> amistoso | null`
  - `amiPlacarNosso(liga, a) -> { nos, eles }`
  - `amiRetrospecto(liga) -> [{ adversario, nome, jogos, vitorias, derrotas, empates }]`
  - `amiJogoComecou(a, agoraMs) -> boolean`
  - `amiSeparar(liga) -> { esperando, marcados, historico }`

- [ ] **Step 1: Escrever o teste (falha)**

Criar `tests/amistosos-puro.test.js`:

```js
// Testes do cálculo puro dos Amistosos. Extrai o bloco <amistosos-puro> direto do HTML (testa o código que vai pro ar).
// Rodar: node tests/amistosos-puro.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <amistosos-puro>');
const fim = html.indexOf('// </amistosos-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <amistosos-puro> não encontrado no volei-dashboard.html');
const A = new Function(html.slice(ini, fim) + `
  return { AMI_ATIVOS, amiNormalizar, amiNomeGrupo, amiDataCurta, amiHojeBrasil, amiPendencias, amiTextoAviso,
           amiProximoMarcado, amiPlacarNosso, amiRetrospecto, amiJogoComecou, amiSeparar };
`)();

let falhas = 0;
function t(nome, fn){
  try { fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

const ami = (id, extra) => Object.assign({ id, convidante: 'terca', convidado: 'meme', adversario: 'meme', data: '2026-10-20', horario: '20:00',
  local: '', vagasPorGrupo: 6, status: 'pendente', vezDe: 'meme', setsConvidante: null, setsConvidado: null, placarLancadoPorGrupo: '', mensagens: [] }, extra || {});
const liga = (amistosos, grupoId) => A.amiNormalizar({ disponivel: true, grupoId: grupoId || 'terca',
  grupos: [{ id: 'terca', nome: 'Vôlei de Terça' }, { id: 'meme', nome: 'Vôlei Meme Brasil' }, { id: 'outro', nome: 'Outro' }], amistosos });

t('amiNormalizar: null vira bloco vazio indisponível', () => {
  assert.deepEqual(A.amiNormalizar(null), { disponivel: false, grupoId: '', grupos: [], amistosos: [] });
});

t('amiPendencias: convite na nossa vez e placar lançado pelo adversário; nada do que espera o outro lado', () => {
  const l = liga([
    ami('convite-recebido', { convidante: 'meme', convidado: 'terca', vezDe: 'terca' }),
    ami('convite-enviado'), // vez do Meme
    ami('placar-deles', { status: 'aguardando_confirmacao', placarLancadoPorGrupo: 'meme', vezDe: '' }),
    ami('placar-nosso', { status: 'aguardando_confirmacao', placarLancadoPorGrupo: 'terca', vezDe: '' }),
    ami('marcado', { status: 'marcado', vezDe: '' })
  ]);
  assert.deepEqual(A.amiPendencias(l).map(a => a.id), ['convite-recebido', 'placar-deles']);
});

t('amiTextoAviso: textos de convite, contraproposta, placar e plural', () => {
  assert.equal(A.amiTextoAviso(liga([])), '');
  assert.equal(A.amiTextoAviso(liga([ami('a', { convidante: 'meme', convidado: 'terca', vezDe: 'terca' })])),
    'Vôlei Meme Brasil convidou vocês pra um amistoso em 20/10');
  assert.equal(A.amiTextoAviso(liga([ami('a', { vezDe: 'terca' })])), 'Vôlei Meme Brasil propôs outra data pro amistoso: 20/10');
  assert.equal(A.amiTextoAviso(liga([ami('a', { status: 'aguardando_confirmacao', placarLancadoPorGrupo: 'meme' })])),
    'Vôlei Meme Brasil lançou o placar do amistoso de 20/10 — confirme');
  assert.equal(A.amiTextoAviso(liga([ami('a', { vezDe: 'terca' }), ami('b', { vezDe: 'terca' })])), '2 amistosos esperando resposta');
});

t('amiHojeBrasil: 22h de Brasília ainda é o mesmo dia (servidor em UTC já virou)', () => {
  assert.equal(A.amiHojeBrasil(Date.parse('2026-10-21T01:00:00Z')), '2026-10-20');
  assert.equal(A.amiHojeBrasil(Date.parse('2026-10-21T03:00:00Z')), '2026-10-21');
});

t('amiProximoMarcado: o marcado mais próximo a partir de hoje; ignora passados e não marcados', () => {
  const l = liga([
    ami('passado', { status: 'marcado', data: '2026-10-01' }),
    ami('longe', { status: 'marcado', data: '2026-11-10' }),
    ami('perto-tarde', { status: 'marcado', data: '2026-10-20', horario: '21:00' }),
    ami('perto-cedo', { status: 'marcado', data: '2026-10-20', horario: '19:00' }),
    ami('pendente', { data: '2026-10-15' })
  ]);
  assert.equal(A.amiProximoMarcado(l, '2026-10-12').id, 'perto-cedo');
  assert.equal(A.amiProximoMarcado(liga([]), '2026-10-12'), null);
});

t('amiPlacarNosso e amiRetrospecto: do ponto de vista de quem olha, por adversário', () => {
  const l = liga([
    ami('1', { status: 'encerrado', setsConvidante: 3, setsConvidado: 1 }), // nós convidamos e ganhamos
    ami('2', { status: 'encerrado', convidante: 'meme', convidado: 'terca', setsConvidante: 3, setsConvidado: 0 }), // perdemos
    ami('3', { status: 'encerrado', setsConvidante: 2, setsConvidado: 2 }),
    ami('4', { status: 'encerrado', adversario: 'outro', convidado: 'outro', setsConvidante: 0, setsConvidado: 2 }),
    ami('5', { status: 'cancelado' })
  ]);
  assert.deepEqual(A.amiPlacarNosso(l, l.amistosos[1]), { nos: 0, eles: 3 });
  assert.deepEqual(A.amiRetrospecto(l), [
    { adversario: 'meme', nome: 'Vôlei Meme Brasil', jogos: 3, vitorias: 1, derrotas: 1, empates: 1 },
    { adversario: 'outro', nome: 'Outro', jogos: 1, vitorias: 0, derrotas: 1, empates: 0 }
  ]);
  // o mesmo jogo visto pelo Meme
  const doMeme = A.amiNormalizar({ ...l, grupoId: 'meme', amistosos: [ami('1', { status: 'encerrado', adversario: 'terca', setsConvidante: 3, setsConvidado: 1 })] });
  assert.deepEqual(A.amiRetrospecto(doMeme)[0], { adversario: 'terca', nome: 'Vôlei de Terça', jogos: 1, vitorias: 0, derrotas: 1, empates: 0 });
});

t('amiJogoComecou: compara com o horário de Brasília', () => {
  const a = ami('a');
  assert.equal(A.amiJogoComecou(a, Date.parse('2026-10-20T22:59:00Z')), false);
  assert.equal(A.amiJogoComecou(a, Date.parse('2026-10-20T23:00:00Z')), true);
});

t('amiSeparar: esperando / marcados (mais próximo primeiro) / histórico (mais recente primeiro)', () => {
  const l = liga([
    ami('p'), ami('ag', { status: 'aguardando_confirmacao' }),
    ami('m2', { status: 'marcado', data: '2026-11-01' }), ami('m1', { status: 'marcado', data: '2026-10-25' }),
    ami('h1', { status: 'encerrado', data: '2026-09-01' }), ami('h2', { status: 'recusado', data: '2026-09-20' }), ami('h3', { status: 'cancelado', data: '2026-08-01' })
  ]);
  const s = A.amiSeparar(l);
  assert.deepEqual(s.esperando.map(a => a.id), ['p', 'ag']);
  assert.deepEqual(s.marcados.map(a => a.id), ['m1', 'm2']);
  assert.deepEqual(s.historico.map(a => a.id), ['h2', 'h1', 'h3']);
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/amistosos-puro.test.js`
Expected: `AssertionError: bloco <amistosos-puro> não encontrado`.

- [ ] **Step 3: Implementar o bloco**

Em `volei-dashboard.html`, logo depois da linha `// </financeiro-puro>`, inserir:

```js
// <amistosos-puro>
/* Amistosos entre grupos — cálculos PUROS (sem DOM, DATA nem rede): recebem o bloco "liga" que o servidor manda e
   devolvem dados prontos pra tela. Testados em tests/amistosos-puro.test.js extraindo este bloco do HTML. */
const AMI_ATIVOS = ['pendente', 'marcado', 'aguardando_confirmacao'];
function amiNormalizar(l){
  const x = l || {};
  return { disponivel: !!x.disponivel, grupoId: x.grupoId || '', grupos: x.grupos || [], amistosos: x.amistosos || [] };
}
function amiNomeGrupo(liga, id){ const g = liga.grupos.find(g => g.id === id); return g ? g.nome : id; }
function amiDataCurta(iso){ const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }
// "hoje" no Brasil (-03:00), igual ao backend: às 22h de Brasília o UTC já virou o dia
function amiHojeBrasil(agoraMs){ return new Date(agoraMs - 3 * 3600000).toISOString().slice(0, 10); }
// o que ESTE grupo precisa responder: convite/contraproposta na vez dele, ou placar lançado pelo adversário
function amiPendencias(liga){
  return liga.amistosos.filter(a =>
    (a.status === 'pendente' && a.vezDe === liga.grupoId) ||
    (a.status === 'aguardando_confirmacao' && a.placarLancadoPorGrupo && a.placarLancadoPorGrupo !== liga.grupoId));
}
function amiTextoAviso(liga){
  const p = amiPendencias(liga);
  if(!p.length) return '';
  if(p.length > 1) return p.length + ' amistosos esperando resposta';
  const a = p[0], adv = amiNomeGrupo(liga, a.adversario), quando = amiDataCurta(a.data);
  if(a.status === 'aguardando_confirmacao') return adv + ' lançou o placar do amistoso de ' + quando + ' — confirme';
  // pendente na NOSSA vez mas fomos nós que convidamos = o outro grupo devolveu com outra data
  if(a.convidante === liga.grupoId) return adv + ' propôs outra data pro amistoso: ' + quando;
  return adv + ' convidou vocês pra um amistoso em ' + quando;
}
const amiPorDataHora = (x, y) => (x.data + x.horario < y.data + y.horario ? -1 : x.data + x.horario > y.data + y.horario ? 1 : 0);
function amiProximoMarcado(liga, hojeIso){
  return liga.amistosos.filter(a => a.status === 'marcado' && a.data >= hojeIso).sort(amiPorDataHora)[0] || null;
}
// os sets "do nosso lado": no banco o placar é do convidante/convidado, a tela fala em "nós × eles"
function amiPlacarNosso(liga, a){
  const nosConvidamos = a.convidante === liga.grupoId;
  return { nos: nosConvidamos ? a.setsConvidante : a.setsConvidado, eles: nosConvidamos ? a.setsConvidado : a.setsConvidante };
}
function amiRetrospecto(liga){
  const por = {};
  liga.amistosos.filter(a => a.status === 'encerrado').forEach(a => {
    const r = por[a.adversario] || (por[a.adversario] = { adversario: a.adversario, nome: amiNomeGrupo(liga, a.adversario), jogos: 0, vitorias: 0, derrotas: 0, empates: 0 });
    const p = amiPlacarNosso(liga, a);
    r.jogos++;
    if(p.nos > p.eles) r.vitorias++; else if(p.nos < p.eles) r.derrotas++; else r.empates++;
  });
  return Object.values(por).sort((x, y) => y.jogos - x.jogos || x.nome.localeCompare(y.nome));
}
// mesma regra do backend (inicioDoJogo): o botão "Lançar placar" só aparece depois do horário do jogo em Brasília
function amiJogoComecou(a, agoraMs){ return agoraMs >= Date.parse(a.data + 'T' + (a.horario || '00:00') + ':00-03:00'); }
function amiSeparar(liga){
  return {
    esperando: liga.amistosos.filter(a => a.status === 'pendente' || a.status === 'aguardando_confirmacao'),
    marcados: liga.amistosos.filter(a => a.status === 'marcado').sort(amiPorDataHora),
    historico: liga.amistosos.filter(a => AMI_ATIVOS.indexOf(a.status) === -1).sort((x, y) => -amiPorDataHora(x, y))
  };
}
// </amistosos-puro>
```

- [ ] **Step 4: Rodar e ver passar + validar sintaxe**

Run: `node tests/amistosos-puro.test.js`
Expected: `TODOS OS TESTES PASSARAM`.

Run (validação do CLAUDE.md; no Windows usar `python` em vez de `python3` e um caminho no scratchpad em vez de `/tmp`):

```bash
python -c "
import re
content = open('volei-dashboard.html', encoding='utf-8').read()
m = re.search(r'<script>(.*)</script>', content, re.S)
open('check.js','w', encoding='utf-8').write(m.group(1))
" && node --check check.js && rm check.js
```
Expected: nenhuma saída de erro.

- [ ] **Step 5: Commit**

```bash
git add volei-dashboard.html tests/amistosos-puro.test.js
git commit -m "feat(terca): cálculos puros dos amistosos no front"
```

---

### Task 9: Front do Terça — aba Amistosos, avisos e modais

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:**
- Consumes: o bloco puro (Task 8); `postAction`, `requireAuth`, `credencialLogada`, `exigirLoginParaCheckin`, `temPermissao`, `escapeHtml`, `formatDate`, `mostrarToast`, `abrirTelaVia`, `finAbrirModal`, `ULTIMA_RESPOSTA_POST`, `DATA.players`, `AUTH.jogadorId` (já existem no HTML).
- Produces: `LIGA` (estado global), `amiPost(acao, payload) -> Promise<boolean>`, `renderAmistosos()`, `atualizarAvisosAmistosos()`.

Este passo é de interface. Não há teste automático de DOM no projeto para isso; a verificação é a sintaxe, os testes existentes e o roteiro manual do Step 9.

- [ ] **Step 1: Estado e permissões de UI**

1. Perto de `let FINANCEIRO = finNormalizar(null);`, acrescentar:

```js
// amistosos entre grupos: bloco "liga" do servidor (ver <amistosos-puro>); vazio até a primeira leitura
let LIGA = { disponivel: false, grupoId: '', grupos: [], amistosos: [] };
```

(Não usar `amiNormalizar` aqui: o bloco puro fica mais abaixo no arquivo e `const`/`function` declarados depois ainda não existiriam nesse ponto da execução para o `const AMI_ATIVOS`.)

2. Em `PERMISSOES_UI`, depois de `removerJogo2: [...]`, acrescentar (lembrar da vírgula na linha anterior):

```js
  // amistosos entre grupos (entrar/sair são como o check-in: só login, sem entrada aqui)
  convidarGrupo:        ['organizador','admin'],
  responderConvite:     ['organizador','admin'],
  cancelarAmistoso:     ['organizador','admin'],
  recadoAmistoso:       ['organizador','admin'],
  confirmarEscalado:    ['organizador','admin'],
  desconfirmarEscalado: ['organizador','admin'],
  travarEscalacao:      ['organizador','admin'],
  destravarEscalacao:   ['organizador','admin'],
  lancarPlacar:         ['organizador','admin'],
  confirmarPlacar:      ['organizador','admin'],
  contestarPlacar:      ['organizador','admin']
```

3. Em `aplicarDados(json)`, depois de `FINANCEIRO = finNormalizar(json.financeiro);`, acrescentar:

```js
  LIGA = amiNormalizar(json.liga);
```

- [ ] **Step 2: HTML — menu, avisos e tela**

1. No `<nav id="nav">`, depois de `<button data-view="historico">Histórico</button>`:

```html
      <button data-view="amistosos" id="nav-amistosos-btn" style="display:none;">Amistosos 🤝<span class="badge-count" id="nav-amistosos-badge" style="display:none;"></span></button>
```

2. No painel "Mais", depois do botão `data-view="historico"`:

```html
        <button class="mais-item" data-view="amistosos" id="mais-amistosos-btn" style="display:none;"><span class="mais-item-icon">🤝</span>Amistosos<span class="badge-count" id="mais-amistosos-badge" style="display:none;"></span></button>
```

3. Em `#view-dashboard`, logo depois do `<div id="usuarios-pendentes-alerta" ...>...</div>`:

```html
      <!-- amistosos: um aviso pro organizador (tem algo pra responder) e um pra todos (amistoso marcado) — ver atualizarAvisosAmistosos -->
      <div id="amistosos-alerta" class="rascunho-alerta" style="display:none;" role="button" tabindex="0" title="Toque para responder">
        <span class="ponto-rascunho" aria-hidden="true"></span>
        <strong id="amistosos-alerta-texto"></strong>
        <span class="aovivo-alerta-ir">Responder ›</span>
      </div>
      <div id="amistoso-marcado-alerta" class="rascunho-alerta" style="display:none;" role="button" tabindex="0" title="Toque para ver o amistoso">
        <span aria-hidden="true">🤝</span>
        <strong id="amistoso-marcado-texto"></strong>
        <span class="aovivo-alerta-ir">Vou jogar ›</span>
      </div>
```

4. Depois do `</section>` de `#view-historico`, criar a tela (`<section>` aqui é a própria aba, como as outras; dentro dela só `<div>`):

```html
    <section id="view-amistosos">
      <h2 class="section-title">🤝 Amistosos</h2>
      <p id="ami-indisponivel" class="ami-vazio" style="display:none;">Amistosos ainda não estão disponíveis neste servidor.</p>
      <div id="ami-acoes-topo" style="display:none;margin-bottom:14px;"><button type="button" class="btn" id="ami-convidar-btn">+ Convidar grupo</button></div>
      <div id="ami-esperando-bloco" role="group" aria-label="Esperando resposta">
        <h3 class="ami-subtitulo">Esperando resposta</h3>
        <div id="ami-esperando"></div>
      </div>
      <h3 class="ami-subtitulo">Marcados</h3>
      <div id="ami-marcados"></div>
      <h3 class="ami-subtitulo">Histórico de confrontos</h3>
      <div id="ami-retrospecto"></div>
      <div id="ami-historico"></div>
    </section>
```

- [ ] **Step 3: CSS**

Perto do CSS de `.rascunho-alerta`, acrescentar (seletores só de classe):

```css
  /* ===== AMISTOSOS ===== */
  .ami-subtitulo{font-size:15px;margin:18px 0 8px;color:var(--chalk);}
  .ami-vazio{font-size:13px;color:var(--muted);margin:4px 0 10px;}
  .ami-cartao{background:var(--glass-bg);border:1px solid rgba(255,255,255,0.08);border-left:4px solid var(--accent);border-radius:10px;padding:12px 14px;margin-bottom:12px;font-size:14px;}
  .ami-topo{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}
  .ami-status{font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.08);color:var(--chalk-dim);}
  .ami-status-marcado{background:rgba(0,200,120,0.18);color:var(--chalk);}
  .ami-status-pendente,.ami-status-aguardando_confirmacao{background:rgba(255,215,0,0.18);color:var(--chalk);}
  .ami-quando,.ami-info{font-size:13px;color:var(--chalk-dim);margin-top:4px;}
  .ami-placar{font-size:16px;margin:8px 0;}
  .ami-escalacao{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);}
  .ami-escalacao-titulo{font-size:13px;color:var(--muted);margin:8px 0 4px;}
  .ami-jogador{display:flex;align-items:center;gap:8px;padding:3px 0;}
  .ami-jogador .btn{padding:2px 8px;font-size:12px;}
  .ami-acoes{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
  .ami-msgs{margin-top:8px;font-size:13px;}
  .ami-msgs summary{cursor:pointer;color:var(--muted);}
  .ami-msg{padding:3px 0;color:var(--chalk-dim);}
  .ami-retro{font-size:14px;margin-bottom:6px;}
```

- [ ] **Step 4: Envio e avisos**

Depois de `renderFinanceiroTudo()`, acrescentar:

```js
/* ---------- AMISTOSOS ENTRE GRUPOS ---------- */
// Envia uma ação de amistoso e troca LIGA pelo bloco que o servidor devolveu (fonte da verdade, igual ao financeiro).
// "Vou jogar"/"desmarcar" seguem a regra do check-in: qualquer pessoa logada; o resto pede o perfil certo.
async function amiPost(acao, payload){
  let cred;
  if(acao === 'entrarAmistoso' || acao === 'sairAmistoso'){
    if(!exigirLoginParaCheckin()) return false;
    cred = await credencialLogada();
    if(!cred){ mostrarToast('Seu login expirou. Toque em "Entrar com Google" e tente de novo.', 'erro'); return false; }
  } else {
    cred = await requireAuth(acao);
    if(!cred) return false;
  }
  ULTIMA_RESPOSTA_POST = null;
  const ok = await postAction(acao, payload, cred);
  if(!ok) return false;
  if(ULTIMA_RESPOSTA_POST && ULTIMA_RESPOSTA_POST.liga) LIGA = amiNormalizar(ULTIMA_RESPOSTA_POST.liga);
  renderAmistosos();
  atualizarAvisosAmistosos();
  return true;
}

// tela inicial + contador no menu. O aviso "pra responder" só aparece pra quem pode responder (organizador/admin);
// o do amistoso marcado é pra todo mundo (é ele que leva a pessoa a marcar "Vou jogar").
function atualizarAvisosAmistosos(){
  const mostrar = (id, sim)=>{ const el = document.getElementById(id); if(el) el.style.display = sim ? '' : 'none'; };
  mostrar('nav-amistosos-btn', LIGA.disponivel);
  mostrar('mais-amistosos-btn', LIGA.disponivel);
  const podeResponder = LIGA.disponivel && temPermissao('responderConvite');
  const pendentes = podeResponder ? amiPendencias(LIGA).length : 0;
  ['nav-amistosos-badge', 'mais-amistosos-badge'].forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = String(pendentes);
    el.style.display = pendentes > 0 ? 'inline-flex' : 'none';
  });
  const alerta = document.getElementById('amistosos-alerta');
  if(pendentes > 0){
    document.getElementById('amistosos-alerta-texto').textContent = '🏐 ' + amiTextoAviso(LIGA);
    alerta.style.display = 'flex';
  } else alerta.style.display = 'none';
  const proximo = LIGA.disponivel ? amiProximoMarcado(LIGA, amiHojeBrasil(Date.now())) : null;
  const marcado = document.getElementById('amistoso-marcado-alerta');
  if(proximo){
    document.getElementById('amistoso-marcado-texto').textContent =
      'Amistoso marcado: ' + amiNomeGrupo(LIGA, LIGA.grupoId) + ' × ' + amiNomeGrupo(LIGA, proximo.adversario) + ', ' + amiDataCurta(proximo.data) + ' às ' + proximo.horario;
    marcado.dataset.amiId = proximo.id;
    marcado.style.display = 'flex';
  } else marcado.style.display = 'none';
}
// os dois avisos levam pra aba e rolam até o cartão certo (mesmo truque do aviso de rascunho)
function irParaAmistoso(id){
  abrirTelaVia('amistosos');
  setTimeout(()=>{
    const card = id && document.getElementById('ami-' + id);
    if(card) card.scrollIntoView({ behavior:'smooth', block:'center' });
  }, 80);
}
function ligarAviso(id, alvo){
  const el = document.getElementById(id);
  el.addEventListener('click', ()=> irParaAmistoso(alvo()));
  el.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); irParaAmistoso(alvo()); } });
}
ligarAviso('amistosos-alerta', ()=> (amiPendencias(LIGA)[0] || {}).id);
ligarAviso('amistoso-marcado-alerta', ()=> document.getElementById('amistoso-marcado-alerta').dataset.amiId);
```

Em `renderAll()`, depois de `atualizarAlertaRascunhos();`, acrescentar `atualizarAvisosAmistosos();`. Em `aplicarPermissoesUI()`, no fim da função, acrescentar `atualizarAvisosAmistosos();` (login/logout muda quem vê o aviso). No listener de `#nav`, depois de `if(btn.dataset.view==='historico') renderHistory();`, acrescentar:

```js
  if(btn.dataset.view==='amistosos') renderAmistosos();
```

- [ ] **Step 5: Renderização da aba**

Logo depois de `atualizarAvisosAmistosos`/`ligarAviso`, acrescentar:

```js
const AMI_STATUS = { pendente: 'Aguardando resposta', marcado: 'Marcado', aguardando_confirmacao: 'Placar aguardando confirmação', encerrado: 'Encerrado', recusado: 'Recusado', cancelado: 'Cancelado' };
const AMI_TIPO_MSG = { convite: 'enviou o convite', contraproposta: 'propôs outra data', aceite: 'aceitou', recusa: 'recusou', cancelamento: 'cancelou',
  placar: 'lançou o placar', confirmacao: 'confirmou o placar', contestacao: 'contestou o placar', recado: 'mandou um recado' };

function amiBotao(acao, rotulo, id, extra){
  const sec = extra && extra.secundario ? ' secondary' : '';
  const jog = extra && extra.jogadorId ? ` data-ami-jogador="${escapeHtml(extra.jogadorId)}"` : '';
  const aria = extra && extra.aria ? ` aria-label="${escapeHtml(extra.aria)}"` : '';
  return `<button type="button" class="btn${sec}" data-ami-acao="${acao}" data-ami-id="${escapeHtml(id)}"${jog}${aria}>${rotulo}</button>`;
}

function amiEscalacaoHtml(a, adv){
  const minha = a.minhaEscalacao, org = temPermissao('confirmarEscalado');
  const confirmados = minha.jogadores.filter(j => j.status === 'confirmado').length;
  const linhas = minha.jogadores.map(j => `<div class="ami-jogador">
      <span>${j.status === 'confirmado' ? '✅' : '🙋'} ${escapeHtml(j.nome)}</span>
      ${org ? (j.status === 'confirmado'
        ? amiBotao('desconfirmarEscalado', 'Tirar', a.id, { secundario: true, jogadorId: j.jogadorId })
        : amiBotao('confirmarEscalado', 'Confirmar', a.id, { secundario: true, jogadorId: j.jogadorId })) : ''}
      ${!minha.travada ? amiBotao('sairAmistoso', '✕', a.id, { secundario: true, jogadorId: j.jogadorId, aria: 'Desmarcar ' + j.nome }) : ''}
    </div>`).join('');
  const deles = a.escalacaoAdversario;
  const adversario = deles.confirmados.length
    ? deles.confirmados.map(p => escapeHtml(p.nome)).join(', ')
    : `Escalação ainda não confirmada (${deles.interessados} ${deles.interessados === 1 ? 'interessado' : 'interessados'})`;
  return `<div class="ami-escalacao">
      <div class="ami-escalacao-titulo">${escapeHtml(amiNomeGrupo(LIGA, LIGA.grupoId))} — ${confirmados}/${a.vagasPorGrupo} confirmados${minha.travada ? ' · 🔒 lista travada' : ''}</div>
      ${linhas || '<p class="ami-vazio">Ninguém marcou ainda.</p>'}
      <div class="ami-acoes">
        ${!minha.travada ? amiBotao('entrarAmistoso', '🙋 Vou jogar', a.id) : ''}
        ${org ? (minha.travada ? amiBotao('destravarEscalacao', '🔓 Destravar lista', a.id, { secundario: true }) : amiBotao('travarEscalacao', '🔒 Travar lista', a.id, { secundario: true })) : ''}
      </div>
      <div class="ami-escalacao-titulo">${escapeHtml(adv.nome)}</div>
      <div>${adversario}</div>
    </div>`;
}

function amiCartaoHtml(a){
  const adv = LIGA.grupos.find(g => g.id === a.adversario) || { nome: a.adversario, cor: '' };
  const nosso = amiNomeGrupo(LIGA, LIGA.grupoId);
  const org = temPermissao('responderConvite');
  const nossaVez = a.status === 'pendente' && a.vezDe === LIGA.grupoId;
  let acoes = '';
  if(org && nossaVez) acoes += amiBotao('aceitar', 'Aceitar', a.id) + amiBotao('contrapropor', 'Outra data', a.id, { secundario: true }) + amiBotao('recusar', 'Recusar', a.id, { secundario: true });
  if(org && a.status === 'marcado' && amiJogoComecou(a, Date.now())) acoes += amiBotao('lancarPlacar', 'Lançar placar', a.id);
  if(org && a.status === 'aguardando_confirmacao' && a.placarLancadoPorGrupo !== LIGA.grupoId) acoes += amiBotao('confirmarPlacar', 'Confirmar placar', a.id) + amiBotao('contestarPlacar', 'Contestar', a.id, { secundario: true });
  if(org && AMI_ATIVOS.indexOf(a.status) > -1) acoes += amiBotao('recado', '💬 Recado', a.id, { secundario: true });
  if(org && (a.status === 'pendente' || a.status === 'marcado')) acoes += amiBotao('cancelar', 'Cancelar', a.id, { secundario: true });
  const esperandoOutro = a.status === 'pendente' && !nossaVez ? `<div class="ami-info">Esperando ${escapeHtml(adv.nome)} responder</div>` : '';
  const esperandoPlacar = a.status === 'aguardando_confirmacao' && a.placarLancadoPorGrupo === LIGA.grupoId ? `<div class="ami-info">Esperando ${escapeHtml(adv.nome)} confirmar o placar</div>` : '';
  let placar = '';
  if(a.status === 'encerrado' || a.status === 'aguardando_confirmacao'){
    const p = amiPlacarNosso(LIGA, a);
    placar = `<div class="ami-placar">${escapeHtml(nosso)} <strong>${p.nos}</strong> × <strong>${p.eles}</strong> ${escapeHtml(adv.nome)}</div>`;
  }
  const escalacao = a.status === 'marcado' ? amiEscalacaoHtml(a, adv) : '';
  const msgs = a.mensagens.length ? `<details class="ami-msgs"><summary>💬 Conversa (${a.mensagens.length})</summary>${a.mensagens.map(m =>
    `<div class="ami-msg"><strong>${escapeHtml(amiNomeGrupo(LIGA, m.grupo))}</strong> · ${escapeHtml(m.autorNome)} ${escapeHtml(AMI_TIPO_MSG[m.tipo] || m.tipo)}${m.texto ? ': ' + escapeHtml(m.texto) : ''}</div>`).join('')}</details>` : '';
  const cor = /^#[0-9a-fA-F]{3,8}$/.test(adv.cor || '') ? ` style="border-left-color:${adv.cor};"` : '';
  return `<div class="ami-cartao" id="ami-${escapeHtml(a.id)}"${cor}>
      <div class="ami-topo"><strong>${escapeHtml(nosso)} × ${escapeHtml(adv.nome)}</strong><span class="ami-status ami-status-${escapeHtml(a.status)}">${AMI_STATUS[a.status] || escapeHtml(a.status)}</span></div>
      <div class="ami-quando">📅 ${formatDate(a.data)} às ${escapeHtml(a.horario)}${a.local ? ' · 📍 ' + escapeHtml(a.local) : ''} · ${a.vagasPorGrupo} por grupo</div>
      ${a.motivoCancelamento ? `<div class="ami-info">Motivo: ${escapeHtml(a.motivoCancelamento)}</div>` : ''}
      ${esperandoOutro}${esperandoPlacar}${placar}${escalacao}${msgs}
      ${acoes ? `<div class="ami-acoes">${acoes}</div>` : ''}
    </div>`;
}

function renderAmistosos(){
  const el = (id)=> document.getElementById(id);
  el('ami-indisponivel').style.display = LIGA.disponivel ? 'none' : '';
  el('ami-acoes-topo').style.display = LIGA.disponivel && temPermissao('convidarGrupo') ? '' : 'none';
  const { esperando, marcados, historico } = amiSeparar(LIGA);
  const vazio = (t)=> `<p class="ami-vazio">${t}</p>`;
  // convites pendentes são assunto dos organizadores: jogador comum nem vê o bloco
  const org = temPermissao('responderConvite');
  el('ami-esperando-bloco').style.display = org ? '' : 'none';
  el('ami-esperando').innerHTML = esperando.length ? esperando.map(amiCartaoHtml).join('') : vazio('Nada esperando resposta.');
  el('ami-marcados').innerHTML = marcados.length ? marcados.map(amiCartaoHtml).join('') : vazio('Nenhum amistoso marcado.');
  const nosso = amiNomeGrupo(LIGA, LIGA.grupoId);
  el('ami-retrospecto').innerHTML = amiRetrospecto(LIGA).map(r =>
    `<div class="ami-retro"><strong>${escapeHtml(nosso)} × ${escapeHtml(r.nome)}</strong>: ${r.jogos} ${r.jogos === 1 ? 'jogo' : 'jogos'} — ${r.vitorias}V ${r.derrotas}D${r.empates ? ' ' + r.empates + 'E' : ''}</div>`).join('');
  el('ami-historico').innerHTML = historico.length ? historico.map(amiCartaoHtml).join('') : vazio('Nenhum confronto ainda.');
}
```

- [ ] **Step 6: Modais e cliques**

Logo depois de `renderAmistosos`, acrescentar:

```js
// campos de data/horário/local/vagas: os mesmos no convite e na contraproposta
function amiCamposHtml(v){
  return `<label class="fin-campo">Data<input type="date" id="ami-m-data" value="${escapeHtml(v.data || '')}"></label>
    <label class="fin-campo">Horário<input type="time" id="ami-m-horario" value="${escapeHtml(v.horario || '20:00')}"></label>
    <label class="fin-campo">Local<input type="text" id="ami-m-local" maxlength="200" value="${escapeHtml(v.local || '')}" placeholder="Quadra, endereço"></label>
    <label class="fin-campo">Jogadores por grupo<input type="number" id="ami-m-vagas" min="1" max="30" inputmode="numeric" value="${escapeHtml(String(v.vagasPorGrupo || 6))}"></label>
    <label class="fin-campo">Recado (opcional)<textarea id="ami-m-recado" maxlength="500" rows="3"></textarea></label>`;
}
function amiLerCampos(ov){
  const val = (id)=> ov.querySelector('#' + id).value.trim();
  return { data: val('ami-m-data'), horario: val('ami-m-horario'), local: val('ami-m-local'), vagasPorGrupo: Number(val('ami-m-vagas')), recado: val('ami-m-recado') };
}
// caixa de texto simples (recado, motivo, contestação). obrigatorio=true não deixa enviar vazio.
function amiPedirTexto(titulo, rotuloOk, obrigatorio, aoEnviar){
  finAbrirModal(titulo, `<label class="fin-campo"><textarea id="ami-m-texto" maxlength="500" rows="4"></textarea></label>`, async (ov)=>{
    const texto = ov.querySelector('#ami-m-texto').value.trim();
    if(obrigatorio && !texto){ mostrarToast('Escreva alguma coisa antes de enviar.', 'erro'); return false; }
    return aoEnviar(texto);
  }, rotuloOk);
}

document.getElementById('ami-convidar-btn').addEventListener('click', ()=>{
  const outros = LIGA.grupos.filter(g => g.id !== LIGA.grupoId);
  if(!outros.length){ mostrarToast('Ainda não há outro grupo cadastrado pra convidar.', 'erro'); return; }
  finAbrirModal('🤝 Convidar para amistoso', `
    <label class="fin-campo">Grupo<select id="ami-m-grupo">${outros.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.nome)}</option>`).join('')}</select></label>
    ${amiCamposHtml({})}`, async (ov)=>{
    const c = amiLerCampos(ov);
    if(!c.data){ mostrarToast('Escolha a data do amistoso.', 'erro'); return false; }
    return amiPost('convidarGrupo', { convite: { grupo: ov.querySelector('#ami-m-grupo').value, ...c } });
  }, 'Enviar convite');
});

// "Vou jogar": escolhe o jogador da lista do grupo (já vem marcado quem está vinculado à conta), igual ao check-in
function amiEscolherJogador(id){
  const jogadores = (DATA.players || []).slice().sort((x, y) => (x.apelido || x.nome).localeCompare(y.apelido || y.nome));
  finAbrirModal('🙋 Quem vai jogar?', `<label class="fin-campo">Jogador<select id="ami-m-jogador">${jogadores.map(p =>
    `<option value="${escapeHtml(p.id)}" ${String(p.id) === String(AUTH.jogadorId) ? 'selected' : ''}>${escapeHtml(p.apelido || p.nome)}</option>`).join('')}</select></label>`,
    async (ov)=> amiPost('entrarAmistoso', { id, jogadorId: ov.querySelector('#ami-m-jogador').value }), 'Vou jogar');
}

function amiLancarPlacar(a){
  const nosso = amiNomeGrupo(LIGA, LIGA.grupoId), adv = amiNomeGrupo(LIGA, a.adversario);
  finAbrirModal('🔢 Placar do amistoso', `
    <label class="fin-campo">Sets — ${escapeHtml(nosso)}<input type="number" id="ami-m-nos" min="0" max="9" inputmode="numeric"></label>
    <label class="fin-campo">Sets — ${escapeHtml(adv)}<input type="number" id="ami-m-eles" min="0" max="9" inputmode="numeric"></label>
    <label class="fin-campo">Recado (opcional)<textarea id="ami-m-recado" maxlength="500" rows="2"></textarea></label>`, async (ov)=>{
    const nos = Number(ov.querySelector('#ami-m-nos').value), eles = Number(ov.querySelector('#ami-m-eles').value);
    // o servidor guarda convidante/convidado: traduz o "nós × eles" da tela
    const nosConvidamos = a.convidante === LIGA.grupoId;
    return amiPost('lancarPlacar', { id: a.id, setsConvidante: nosConvidamos ? nos : eles, setsConvidado: nosConvidamos ? eles : nos,
      recado: ov.querySelector('#ami-m-recado').value.trim() });
  }, 'Lançar');
}

document.getElementById('view-amistosos').addEventListener('click', (e)=>{
  const b = e.target.closest('[data-ami-acao]');
  if(!b) return;
  const id = b.dataset.amiId, acao = b.dataset.amiAcao, jogadorId = b.dataset.amiJogador;
  const a = LIGA.amistosos.find(x => x.id === id);
  if(!a) return;
  if(acao === 'aceitar') return amiPost('responderConvite', { id, resposta: 'aceitar' });
  if(acao === 'recusar') return amiPedirTexto('Recusar convite', 'Recusar', false, (t)=> amiPost('responderConvite', { id, resposta: 'recusar', recado: t }));
  if(acao === 'contrapropor') return finAbrirModal('📅 Propor outra data', amiCamposHtml(a), async (ov)=>{
    return amiPost('responderConvite', { id, resposta: 'contrapropor', ...amiLerCampos(ov) });
  }, 'Enviar proposta');
  if(acao === 'cancelar') return amiPedirTexto('Cancelar amistoso — motivo', 'Cancelar amistoso', a.status === 'marcado', (t)=> amiPost('cancelarAmistoso', { id, motivo: t }));
  if(acao === 'recado') return amiPedirTexto('💬 Recado para o outro grupo', 'Enviar', true, (t)=> amiPost('recadoAmistoso', { id, texto: t }));
  if(acao === 'lancarPlacar') return amiLancarPlacar(a);
  if(acao === 'confirmarPlacar') return amiPost('confirmarPlacar', { id });
  if(acao === 'contestarPlacar') return amiPedirTexto('Contestar placar — o que está errado?', 'Contestar', true, (t)=> amiPost('contestarPlacar', { id, texto: t }));
  if(acao === 'entrarAmistoso') return amiEscolherJogador(id);
  if(acao === 'sairAmistoso' || acao === 'confirmarEscalado' || acao === 'desconfirmarEscalado') return amiPost(acao, { id, jogadorId });
  if(acao === 'travarEscalacao' || acao === 'destravarEscalacao') return amiPost(acao, { id });
});
```

- [ ] **Step 7: Versão no rodapé**

Trocar `Ver.: 16.3` por `Ver.: 17.0` no `<div class="footer-line">`. Antes, procurar outras ocorrências da versão: `grep -n "16\.3" volei-dashboard.html`. Se houver uma constante de versão usada pelo aviso de "versão nova", atualizar ela também para `17.0`.

- [ ] **Step 8: Validar sintaxe e rodar os testes de front existentes**

Run: a mesma validação do Step 4 da Task 8.
Expected: sem erro.

Run: `for f in tests/*.test.js; do node "$f" > /dev/null || echo "FALHOU: $f"; done`
Expected: nenhuma linha `FALHOU`. Se algum teste já falhava antes desta mudança, conferir com `git stash` e anotar o caso no relatório em vez de mascarar.

- [ ] **Step 9: Roteiro manual no servidor local**

Pré-requisito: o SQL da Task 1 já rodou no Supabase. Se ainda não rodou, só os passos 1–2 se aplicam, porque a aba fica escondida.

1. `npm run servidor` e abrir `http://localhost:8000`. A aba "Amistosos" aparece no menu (e no "Mais") quando `liga.disponivel` é true.
2. Sem login: a aba mostra "Marcados" e "Histórico", sem "Esperando resposta" e sem botões de organizador.
3. Logado como organizador: "+ Convidar grupo" → Vôlei Meme Brasil, data futura → o cartão aparece em "Esperando resposta" com "Esperando Vôlei Meme Brasil responder".
4. Responder pelo lado do Meme sem tocar no app do Meme: `GRUPO=meme npm run servidor -- 8001` e chamar a API do servidor local do Meme com `responderConvite`/`aceitar`; ou, sem servidor do Meme, rodar no SQL Editor `update liga.amistosos set status='marcado', vez_de=null where id='<id>';`. Recarregar o Terça: o aviso "Amistoso marcado…" aparece na tela inicial para todos e o cartão mostra "🙋 Vou jogar".
5. "Vou jogar" → escolher jogador → aparece com 🙋; "Confirmar" → ✅ e contador `1/6`; "🔒 Travar lista" → some o "Vou jogar".
6. Celular (largura 375px no DevTools): os cartões e os botões quebram linha sem rolagem horizontal.

Anotar no relatório o que foi verificado de fato e o que não pôde ser feito (por exemplo, SQL ainda não rodado).

- [ ] **Step 10: Commit**

```bash
git add volei-dashboard.html
git commit -m "feat(terca): aba Amistosos, avisos na tela inicial e convocação (v17.0)"
```

---

### Task 10: Fechamento — suíte completa, instruções de deploy e PARAR

**Files:**
- Modify: `CLAUDE.md` (seção curta sobre amistosos)

- [ ] **Step 1: Rodar tudo**

Run: `npm run test:backend`
Expected: todos `TODOS OS TESTES PASSARAM`.

Run: `for f in tests/*.test.js; do node "$f" > /dev/null || echo "FALHOU: $f"; done`
Expected: nenhuma linha `FALHOU`.

- [ ] **Step 2: Documentar no CLAUDE.md**

Acrescentar, depois da seção "Sistema de login com Google + perfis de acesso":

```markdown
## Amistosos entre grupos (v17.0 no Terça, 2026-10-12)

Spec: `docs/superpowers/specs/2026-10-12-amistosos-entre-grupos-design.md`. Schema **compartilhado** `liga` no mesmo
projeto Supabase (`sql/liga/schema-liga.sql`, roda uma vez só, sem versão Meme; "liga" precisa estar em Exposed schemas).
Backend: `backend/amistosos.js` + `repo-liga-*.js`, injetados em `criarHandler({ liga: { repo, grupoId } })`. Cada Edge
Function só altera o lado do próprio grupo. Grupo novo = linha em `liga.grupos` + função com o `grupoId` dele. Push de
"amistoso marcado" só vai para os inscritos do grupo que aceitou (as inscrições não são compartilhadas).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: amistosos entre grupos no CLAUDE.md"
```

- [ ] **Step 4: Relatório ao usuário e PARAR**

Dizer ao usuário, sem rodar nada disso:
1. **Rodar `sql/liga/schema-liga.sql`** no SQL Editor do Supabase e acrescentar `liga` em Configurações → API → Exposed schemas.
2. **Publicar a função do Terça**: `npm run preparar-edge` e depois o deploy de sempre de `terca-api-teste` (o usuário é quem roda o deploy).
3. **`git push`** para o HTML ir ao ar (GitHub Pages + Vercel).
4. Até o Meme ser atualizado, um convite do Terça para o Meme fica parado sem resposta (esperado).
5. **Pedir autorização explícita** antes de replicar para o Meme (`meme-api/index.ts` com `grupoId: 'meme'` + HTML do Meme). Não tocar em nenhum arquivo do Meme sem esse sim.
