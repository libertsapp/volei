# Grupos independentes — Fase 1 (camada de dados) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ter o banco e o repositório prontos para muitos grupos isolados: o schema `grupos` (todas as tabelas com `grupo_id`), a função `criar_grupo`, cidade/UF na `liga`, as regras de cadastro (apelido, cidade, UF, cor) e um repositório que aplica o grupo em toda operação — tudo testado, nada publicado.

**Architecture:** Um "cliente com escopo de grupo" (`clienteDoGrupo`) embrulha o supabase-js: todo `select`/`update`/`delete` ganha `.eq('grupo_id', X)`, todo `insert`/`upsert` grava `grupo_id`, toda função do banco recebe `p_grupo_id`. O repositório multigrupo é o `criarRepoSupabase` de sempre recebendo esse cliente, então todo método atual e futuro já nasce filtrado. No banco, chaves primárias e estrangeiras começam por `grupo_id`, para o Postgres também recusar referência entre grupos.

**Tech Stack:** Node 24 (ESM no backend, `node:assert` + `tests/backend/executor.mjs`), Postgres/Supabase (SQL puro, plpgsql), supabase-js v2 (só a interface `from/select/eq/insert/upsert/update/delete/rpc`).

**Spec:** `docs/superpowers/specs/2026-10-12-grupos-independentes-design.md`

## Global Constraints

- Fase 1 só cria arquivos novos e mexe em `backend/amistosos.js` (cidade/UF no mapeamento da liga). **Nada de HTML, nada de Edge Function, nada publicado.** Terça (`public`) e Meme (`meme`) não são tocados.
- Módulos de `backend/` não usam `node:`, `process.`, `require(` nem `Buffer` e só importam `./arquivo.js` (são copiados para Edge Functions).
- `sql/grupos/schema-grupos.sql` NÃO é processado pelo `scripts/gerar-sql-grupo.js` (pasta própria, como `sql/liga/`).
- Apelido: `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$` (3–30), sem `--`, fora da lista de reservados. Nome: 3–60. Cidade: 2–60, normalizada. UF: uma das 27. Cor: um hex da paleta fixa.
- Limites iniciais (tabela `grupos.limites`): `max_grupos_por_email` 1, `max_jogadores_por_grupo` 150, `max_foto_kb` 300, `max_criacoes_por_ip_hora` 3.
- Desvio consciente do spec: as colunas `ordem` usam as mesmas sequências globais (uma por tabela) em vez de uma por grupo — a ordem RELATIVA dentro de cada grupo é a mesma e o banco fica mais simples. A config inicial de um grupo novo é vazia: `mapearConfig` já devolve os padrões do Terça (16 vagas, 20:00, estrelas visíveis) quando a chave não existe.
- Testes: `npm run test:backend`; cada arquivo novo de teste entra no script.

## Review Focus

1. **Linha com `grupo_id` de outro grupo chegando ao cliente** (bug futuro num repositório): o cliente com escopo recusa com erro em vez de gravar no grupo errado. Testado na Task 1.
2. **`update` tentando trocar o `grupo_id` de uma linha** (mover dado para outro grupo): recusado. Testado na Task 1.
3. **Chamada de função do banco já trazendo `p_grupo_id`**: recusada (ninguém escolhe o grupo por fora do escopo). Testado na Task 1.
4. **Dois grupos com o mesmo id de jogador (`p1`)**: permitido (chave composta), e um check-in de um grupo não consegue apontar para o jogador do outro (chave estrangeira composta). Testado na Task 3 (estrutura do SQL).
5. **Apelido com maiúscula, acento, espaço ou palavra reservada**: JS e SQL concordam (mesma regex, mesma lista de reservados, mesmas UFs). Testado na Task 4.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/cliente-do-grupo.js` (novo) | Embrulha o supabase-js aplicando o grupo em toda operação |
| `backend/repo-multigrupo.js` (novo) | `criarRepoMultigrupo(cliente, grupoId)` = repo de sempre + cliente com escopo |
| `backend/grupos-cadastro.js` (novo) | Regras do cadastro: UFs, paleta, reservados, validar/normalizar apelido, cidade, sugerir apelido |
| `sql/grupos/schema-grupos.sql` (novo) | Schema `grupos`: cadastro, limites, reservados, 20 tabelas com `grupo_id`, 10 funções com `p_grupo_id`, `criar_grupo` |
| `sql/liga/ajuste-1-cidade.sql` (novo) | `cidade`/`uf` em `liga.grupos` |
| `backend/amistosos.js` (modificar) | `mapearLiga` devolve `cidade`/`uf` de cada grupo |
| `tests/backend/cliente-do-grupo.test.mjs` (novo) | Task 1 |
| `tests/backend/repo-multigrupo.test.mjs` (novo) | Task 2 |
| `tests/backend/sql-grupos.test.mjs` (novo) | Tasks 3 e 4 (estrutura do SQL × repositório × regras JS) |
| `tests/backend/grupos-cadastro.test.mjs` (novo) | Task 4 |
| `tests/backend/amistosos.test.mjs` (modificar) | Task 5 |
| `package.json` (modificar) | Testes novos no `test:backend` |

---

### Task 1: Cliente com escopo de grupo

**Files:**
- Create: `backend/cliente-do-grupo.js`
- Create: `tests/backend/cliente-gravador.mjs` (cliente falso compartilhado pelos testes das Tasks 1 e 2 — sem testes dentro)
- Create: `tests/backend/cliente-do-grupo.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces (teste): `clienteGravador() -> { ops: Array<{ tabela?, verbo, carga?, opcoes?, nome?, params?, filtros }>, from, rpc }`.
- Produces: `clienteDoGrupo(cliente, grupoId) -> { from(tabela), rpc(nome, params?, opcoes?) }`. `from(tabela)` devolve `{ select, insert, upsert, update, delete }`, cada um devolvendo o builder real do supabase-js (já filtrado/ajustado), para o chamador continuar encadeando `.eq/.neq/.lte/.order/.range/.limit/.maybeSingle/.select`.

- [ ] **Step 1: Escrever o teste (falha)**

Criar `tests/backend/cliente-gravador.mjs` (fica fora do `test:backend`: é só apoio, sem testes — um arquivo de teste
importado por outro rodaria o `fim()` dele e encerraria o processo antes da hora):

```js
// Cliente falso do supabase-js para os testes do multigrupo: grava cada operação encadeada (tabela, verbo, carga,
// opções, filtros) e responde vazio. Só a parte da interface que o repo-supabase usa.
export function clienteGravador() {
  const ops = [];
  const builder = (registro) => {
    const q = {};
    for (const f of ['eq', 'neq', 'lte', 'gte', 'in', 'or']) q[f] = (...a) => { registro.filtros.push([f, ...a]); return q; };
    for (const f of ['order', 'range', 'limit', 'select']) q[f] = () => q;
    q.maybeSingle = () => q;
    q.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return q;
  };
  const from = (tabela) => {
    const verbo = (nome) => (carga, opcoes) => { const r = { tabela, verbo: nome, carga, opcoes, filtros: [] }; ops.push(r); return builder(r); };
    return { select: verbo('select'), insert: verbo('insert'), upsert: verbo('upsert'), update: verbo('update'), delete: verbo('delete') };
  };
  const rpc = (nome, params) => { ops.push({ verbo: 'rpc', nome, params, filtros: [] }); return builder(ops.at(-1)); };
  return { ops, from, rpc };
}
```

Criar `tests/backend/cliente-do-grupo.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { clienteDoGrupo } from '../../backend/cliente-do-grupo.js';
import { clienteGravador } from './cliente-gravador.mjs';

const G = '11111111-1111-1111-1111-111111111111';
const OUTRO = '22222222-2222-2222-2222-222222222222';

t('exige um grupoId', () => {
  assert.throws(() => clienteDoGrupo(clienteGravador(), ''), /grupoId/);
});

await ta('select, update e delete ganham o filtro do grupo antes de qualquer outro', async () => {
  const c = clienteGravador();
  const g = clienteDoGrupo(c, G);
  await g.from('jogadores').select('*').order('id').range(0, 999);
  await g.from('checkins').update({ estrelas_ajustadas: 3 }).eq('id', 'c1').select('id');
  await g.from('sessoes').delete().eq('email', 'a@x.com').lte('expira_em', 'agora');
  assert.deepEqual(c.ops.map((o) => [o.tabela, o.verbo, o.filtros[0]]), [
    ['jogadores', 'select', ['eq', 'grupo_id', G]],
    ['checkins', 'update', ['eq', 'grupo_id', G]],
    ['sessoes', 'delete', ['eq', 'grupo_id', G]]
  ]);
  assert.deepEqual(c.ops[2].filtros.slice(1), [['eq', 'email', 'a@x.com'], ['lte', 'expira_em', 'agora']]);
});

await ta('insert e upsert gravam o grupo em cada linha (objeto ou lista) e prefixam o onConflict', async () => {
  const c = clienteGravador();
  const g = clienteDoGrupo(c, G);
  await g.from('jogadores').insert({ id: 'p1', nome: 'Ana' });
  await g.from('ao_vivo').insert([{ round_id: 'r1' }, { round_id: 'r1' }]);
  await g.from('fin_dias').upsert({ data: '2026-10-13' }, { onConflict: 'data' });
  await g.from('config').upsert([{ chave: 'a', valor: '1' }]);
  assert.deepEqual(c.ops[0].carga, { id: 'p1', nome: 'Ana', grupo_id: G });
  assert.ok(c.ops[1].carga.every((l) => l.grupo_id === G));
  assert.deepEqual(c.ops[2].opcoes, { onConflict: 'grupo_id,data' });
  assert.equal(c.ops[3].opcoes, undefined); // sem onConflict: vale a chave primária, que já começa por grupo_id
  assert.equal(c.ops[3].carga[0].grupo_id, G);
});

await ta('não altera o objeto do chamador', async () => {
  const g = clienteDoGrupo(clienteGravador(), G);
  const linha = { id: 'p1' };
  await g.from('jogadores').insert(linha);
  assert.deepEqual(linha, { id: 'p1' });
});

await ta('rpc recebe p_grupo_id junto dos parâmetros (inclusive quando não há parâmetros)', async () => {
  const c = clienteGravador();
  const g = clienteDoGrupo(c, G);
  await g.rpc('pegar_trava', { p_nome: 'gravacao', p_dono: 'd', p_ttl_seg: 30 });
  await g.rpc('incrementar_acesso');
  assert.deepEqual(c.ops[0].params, { p_grupo_id: G, p_nome: 'gravacao', p_dono: 'd', p_ttl_seg: 30 });
  assert.deepEqual(c.ops[1].params, { p_grupo_id: G });
});

t('recusa linha de outro grupo, update que troca o grupo e rpc que já traz p_grupo_id', () => {
  const g = clienteDoGrupo(clienteGravador(), G);
  assert.throws(() => g.from('jogadores').insert({ id: 'p1', grupo_id: OUTRO }), /outro grupo/);
  assert.throws(() => g.from('jogadores').upsert([{ id: 'p1' }, { id: 'p2', grupo_id: OUTRO }]), /outro grupo/);
  assert.throws(() => g.from('jogadores').update({ grupo_id: OUTRO }), /grupo_id/);
  assert.throws(() => g.rpc('remover_rodada', { p_grupo_id: OUTRO, p_id: 'r1' }), /p_grupo_id/);
  // a mesma linha já marcada com o PRÓPRIO grupo é aceita
  assert.doesNotThrow(() => g.from('jogadores').insert({ id: 'p1', grupo_id: G }));
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/cliente-do-grupo.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND` para `backend/cliente-do-grupo.js`.

- [ ] **Step 3: Implementar**

Criar `backend/cliente-do-grupo.js`:

```js
// Cliente do banco "com escopo de grupo" (grupos independentes, spec 2026-10-12): embrulha o supabase-js para que TODA
// operação do repositório fique presa a um grupo — select/update/delete ganham .eq('grupo_id', X) antes de qualquer outro
// filtro, insert/upsert gravam grupo_id em cada linha (e o onConflict passa a incluir grupo_id), e toda função do banco
// recebe p_grupo_id. Assim o repo-supabase de sempre vira multigrupo sem reescrever método nenhum, e um método novo
// criado amanhã já nasce filtrado. Qualquer tentativa de escolher OUTRO grupo por fora do escopo é recusada com erro
// (falha alta em vez de gravar no grupo errado em silêncio).
export function clienteDoGrupo(cliente, grupoId) {
  if (!grupoId) throw new Error('clienteDoGrupo: grupoId obrigatório');
  const comGrupo = (linha) => {
    if (linha && Object.hasOwn(linha, 'grupo_id') && linha.grupo_id !== grupoId) {
      throw new Error('clienteDoGrupo: linha de outro grupo recusada');
    }
    return { ...linha, grupo_id: grupoId };
  };
  const linhas = (v) => (Array.isArray(v) ? v.map(comGrupo) : comGrupo(v));
  // a chave de conflito precisa começar por grupo_id: o mesmo "data" ou "endpoint" pode existir em dois grupos
  const conflito = (opcoes) => (opcoes && opcoes.onConflict ? { ...opcoes, onConflict: 'grupo_id,' + opcoes.onConflict } : opcoes);

  return {
    from(tabela) {
      const base = cliente.from(tabela);
      return {
        select: (...a) => base.select(...a).eq('grupo_id', grupoId),
        insert: (v, opcoes) => base.insert(linhas(v), opcoes),
        upsert: (v, opcoes) => base.upsert(linhas(v), conflito(opcoes)),
        update: (campos, opcoes) => {
          if (campos && Object.hasOwn(campos, 'grupo_id')) throw new Error('clienteDoGrupo: update não pode mudar grupo_id');
          return base.update(campos, opcoes).eq('grupo_id', grupoId);
        },
        delete: (opcoes) => base.delete(opcoes).eq('grupo_id', grupoId)
      };
    },
    rpc(nome, params, opcoes) {
      if (params && Object.hasOwn(params, 'p_grupo_id')) throw new Error('clienteDoGrupo: p_grupo_id vem do escopo, não do chamador');
      return cliente.rpc(nome, { p_grupo_id: grupoId, ...(params || {}) }, opcoes);
    }
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/cliente-do-grupo.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Acrescentar ao `test:backend` e commit**

Em `package.json`, no fim do script `test:backend`, acrescentar ` && node tests/backend/cliente-do-grupo.test.mjs`.

```bash
git add backend/cliente-do-grupo.js tests/backend/cliente-gravador.mjs tests/backend/cliente-do-grupo.test.mjs package.json
git commit -m "feat(grupos): cliente do banco com escopo de grupo"
```

---

### Task 2: Repositório multigrupo

**Files:**
- Create: `backend/repo-multigrupo.js`
- Create: `tests/backend/repo-multigrupo.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `clienteDoGrupo(cliente, grupoId)` e `clienteGravador()` de `tests/backend/cliente-gravador.mjs` (Task 1); `criarRepoSupabase(cliente, opcoes?)` (já existe, `backend/repo-supabase.js`).
- Produces: `criarRepoMultigrupo(cliente, grupoId, opcoes?)` — mesma interface de `criarRepoSupabase`. O `cliente` deve apontar para o schema `grupos` (`db: { schema: 'grupos' }`); isso é responsabilidade de quem cria (Fase 2).

- [ ] **Step 1: Escrever o teste (falha)**

Criar `tests/backend/repo-multigrupo.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarRepoMultigrupo } from '../../backend/repo-multigrupo.js';
import { clienteGravador } from './cliente-gravador.mjs';

const G = '11111111-1111-1111-1111-111111111111';
const semEspera = { esperar: async () => {} };

// argumentos de exemplo por método (o resto usa o padrão). Só precisam ter o FORMATO certo: o cliente é falso.
const ARGS = {
  gravarUsuario: [{ email: 'a@x.com' }], inserirSessao: [{ token_hash: 'h', email: 'a@x.com' }],
  gravarPushInscricao: [{ id: 'i', endpoint: 'e' }], inserirJogador: [{ id: 'p1', nome: 'Ana' }],
  inserirCheckin: [{ id: 'c1' }], gravarFinDia: [{ data: '2026-10-13' }], inserirFinPagamento: [{ id: 'pg' }],
  inserirFinLancamento: [{ id: 'l' }], inserirFinLog: [{ acao: 'x' }], inserirFinPendencia: [{ id: 'pe' }],
  inserirFinCredito: [{ id: 'cr' }], gravarFinJogo: [{ data: '2026-10-13', jogo: 2 }],
  gravarConfig: [[{ chave: 'a', valor: '1' }]], gravarRodada: [{ id: 'r1', times: [] }],
  inserirAoVivo: [[{ round_id: 'r1' }]], inserirAoVivoLog: [[{ round_id: 'r1' }]],
  estornarFinPagamento: ['pg', { por: 'a', em: 't' }], encerrarFinCredito: ['cr', 'devolvido', { por: 'a', em: 't' }],
  estornarFinLancamento: ['l', { por: 'a', em: 't' }], baixarFinPendencia: ['pe', { por: 'a', em: 't' }],
  renovarSessao: ['h', { renovada_em: 't' }], atualizarJogador: ['p1', { nome: 'Bia' }], atualizarCheckin: ['c1', { estrelas_ajustadas: 3 }],
  atualizarVitoriasAoVivo: [1, 2], definirStatusFinJogo: ['2026-10-13', 2, 'semjogo'], moverFilaParaJogo: ['2026-10-13', 1, 2],
  registrarTentativa: ['ip', 5, 60, 300], pegarTrava: ['gravacao', 'dono', 30], soltarTrava: ['gravacao', 'dono'],
  apagarSessoesVencidas: ['a@x.com', 't'], moverCheckinDeJogo: ['c1', 2]
};
const PADRAO = ['x'];

function conferirEscopo(op) {
  if (op.verbo === 'rpc') return op.params && op.params.p_grupo_id === G;
  if (op.verbo === 'insert' || op.verbo === 'upsert') {
    const l = Array.isArray(op.carga) ? op.carga : [op.carga];
    const conflitoOk = !op.opcoes || !op.opcoes.onConflict || op.opcoes.onConflict.startsWith('grupo_id,');
    return l.every((x) => x.grupo_id === G) && conflitoOk;
  }
  return op.filtros[0] && op.filtros[0][0] === 'eq' && op.filtros[0][1] === 'grupo_id' && op.filtros[0][2] === G;
}

t('mesma interface do repositório de hoje (nenhum método a mais nem a menos)', () => {
  const chaves = (r) => Object.keys(r).sort();
  assert.deepEqual(chaves(criarRepoMultigrupo(clienteGravador(), G, semEspera)), chaves(criarRepoSupabase(clienteGravador(), semEspera)));
});

await ta('TODO método do repositório só faz operações presas ao grupo', async () => {
  const nomes = Object.keys(criarRepoSupabase(clienteGravador(), semEspera));
  const semOperacao = [];
  for (const nome of nomes) {
    const c = clienteGravador();
    const repo = criarRepoMultigrupo(c, G, semEspera);
    await repo[nome](...(ARGS[nome] || PADRAO));
    if (!c.ops.length) semOperacao.push(nome);
    for (const op of c.ops) assert.ok(conferirEscopo(op), nome + ': operação fora do grupo ' + JSON.stringify(op));
  }
  assert.deepEqual(semOperacao, []); // todo método fala com o banco (senão o teste não provaria nada sobre ele)
});

await ta('lerTudo devolve só o que o banco filtrado devolve (uma consulta por tabela, todas filtradas)', async () => {
  const c = clienteGravador();
  const tudo = await criarRepoMultigrupo(c, G, semEspera).lerTudo();
  assert.ok(Object.keys(tudo).includes('jogadores'));
  assert.ok(c.ops.length >= Object.keys(tudo).length);
  assert.ok(c.ops.every(conferirEscopo));
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/repo-multigrupo.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND` para `backend/repo-multigrupo.js`.

- [ ] **Step 3: Implementar**

Criar `backend/repo-multigrupo.js`:

```js
// Repositório dos grupos independentes: o MESMO repo-supabase de sempre, falando com o banco através do cliente com
// escopo de grupo (cliente-do-grupo.js). Nenhuma regra é duplicada aqui de propósito — o isolamento entre grupos mora
// num lugar só, e todo método atual ou futuro do repo-supabase já nasce preso ao grupo.
// O cliente recebido deve apontar para o schema "grupos" (db: { schema: 'grupos' }).
import { criarRepoSupabase } from './repo-supabase.js';
import { clienteDoGrupo } from './cliente-do-grupo.js';

export function criarRepoMultigrupo(cliente, grupoId, opcoes) {
  return criarRepoSupabase(clienteDoGrupo(cliente, grupoId), opcoes);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/repo-multigrupo.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`. Se algum método aparecer em "operação fora do grupo", é um caminho do `repo-supabase` que fala com o banco de um jeito que o cliente com escopo não cobre (ex.: `cliente.storage`, `cliente.schema()`): cobrir no `clienteDoGrupo` com teste próprio na Task 1 antes de seguir.

- [ ] **Step 5: Acrescentar ao `test:backend` e commit**

Acrescentar ` && node tests/backend/repo-multigrupo.test.mjs` ao `test:backend`.

```bash
git add backend/repo-multigrupo.js tests/backend/repo-multigrupo.test.mjs package.json
git commit -m "feat(grupos): repositório multigrupo (repo de sempre + cliente com escopo)"
```

---

### Task 3: Schema `grupos` (20 tabelas + 10 funções)

**Files:**
- Create: `sql/grupos/schema-grupos.sql`
- Create: `tests/backend/sql-grupos.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: os nomes de tabela e de função do banco usados em `backend/repo-supabase.js` (`from('…')`, `.rpc('…')`) e as chaves de conflito (`onConflict`).
- Produces: schema `grupos` com `grupos.grupos(id uuid, apelido, nome, cidade, uf, cor_destaque, logo_url, plano, status, dono_email, criado_em)`, `grupos.limites`, `grupos.apelidos_reservados` e as 10 funções com primeiro parâmetro `p_grupo_id uuid` e os mesmos nomes de parâmetro de hoje (`p`, `p_id`, `p_nome`, `p_dono`, `p_ttl_seg`, `p_chave`, `p_max`, `p_janela_seg`, `p_bloqueio_seg`, `p_para_jogo`, `p_data`, `p_de`, `p_para`). A função `criar_grupo` entra na Task 4.

- [ ] **Step 1: Escrever o teste de estrutura (falha)**

Criar `tests/backend/sql-grupos.test.mjs`:

```js
// Confere o SQL do schema "grupos" contra o que o repositório realmente usa: toda tabela e toda função do banco que o
// repo-supabase chama existe no schema novo, presa ao grupo. Não roda Postgres: lê o texto do SQL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { t, fim } from './executor.mjs';
import { TABELAS } from '../../backend/repo-memoria.js';

const raiz = path.join(import.meta.dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r/g, '');
const sql = ler('sql/grupos/schema-grupos.sql');
const repo = ler('backend/repo-supabase.js');

const tabelasDoSql = Object.fromEntries([...sql.matchAll(/create table (\w+) \(([\s\S]*?)\n\);/g)].map((m) => [m[1], m[2]]));
// lerTudo lê as tabelas de TABELAS por variável (from(tabela)); as demais aparecem literais (from('sessoes') etc.)
const tabelasDoRepo = [...new Set([...TABELAS, ...[...repo.matchAll(/from\('([a-z_0-9]+)'\)/g)].map((m) => m[1])])];
const funcoesDoRepo = [...new Set([...repo.matchAll(/\.rpc\('([a-z_0-9]+)'/g)].map((m) => m[1]))];
const INFRA = ['travas', 'limite_tentativas'];

t('cada tabela que o repositório usa (mais travas e limites) existe em grupos, com grupo_id ligado ao cadastro', () => {
  for (const tabela of [...tabelasDoRepo, ...INFRA]) {
    assert.ok(tabelasDoSql[tabela], 'falta a tabela ' + tabela);
    assert.match(tabelasDoSql[tabela], /grupo_id uuid not null references grupos\(id\) on delete cascade/, tabela);
    assert.match(sql, new RegExp('alter table ' + tabela + ' enable row level security;'), tabela + ' sem RLS');
  }
  assert.equal(tabelasDoRepo.length + INFRA.length, 20);
});

t('cada função do banco que o repositório chama existe com p_grupo_id como 1º parâmetro e fica só com a service_role', () => {
  for (const f of funcoesDoRepo) {
    assert.match(sql, new RegExp('create or replace function ' + f + '\\(p_grupo_id uuid'), f);
    assert.match(sql, new RegExp('revoke execute on function ' + f + '\\(uuid'), f + ' sem revoke');
    assert.match(sql, new RegExp('grant execute on function ' + f + '\\(uuid'), f + ' sem grant');
  }
  assert.equal(funcoesDoRepo.length, 10);
});

t('chaves primárias começam por grupo_id (e casam com os onConflict do repositório)', () => {
  const pk = (tabela) => (tabelasDoSql[tabela].match(/primary key \(([^)]*)\)/) || [])[1];
  assert.equal(pk('jogadores'), 'grupo_id, id');
  assert.equal(pk('rodadas'), 'grupo_id, round_id');
  assert.equal(pk('checkins'), 'grupo_id, id');
  assert.equal(pk('usuarios'), 'grupo_id, email');
  assert.equal(pk('config'), 'grupo_id, chave');
  assert.equal(pk('fin_dias'), 'grupo_id, data');
  assert.equal(pk('fin_jogos'), 'grupo_id, data, jogo');
  assert.equal(pk('travas'), 'grupo_id, nome');
  assert.equal(pk('limite_tentativas'), 'grupo_id, chave');
  assert.match(tabelasDoSql.push_inscricoes, /unique \(grupo_id, endpoint\)/);
  // todo onConflict do repositório tem uma chave equivalente com grupo_id na frente
  for (const m of repo.matchAll(/onConflict: '([a-z_,]+)'/g)) {
    const alvo = 'grupo_id, ' + m[1].split(',').join(', ');
    assert.ok(sql.includes('(' + alvo + ')'), 'sem chave para onConflict ' + m[1]);
  }
});

t('referências entre tabelas são compostas: um grupo não aponta para jogador/rodada/dia de outro', () => {
  assert.match(tabelasDoSql.checkins, /foreign key \(grupo_id, jogador_id\) references jogadores\(grupo_id, id\)/);
  assert.match(tabelasDoSql.time_jogadores, /foreign key \(grupo_id, jogador_id\) references jogadores\(grupo_id, id\)/);
  assert.match(tabelasDoSql.time_jogadores, /foreign key \(grupo_id, time_rodada_id\) references times_rodada\(grupo_id, id\)/);
  assert.match(tabelasDoSql.times_rodada, /foreign key \(grupo_id, round_id\) references rodadas\(grupo_id, round_id\)/);
  assert.match(tabelasDoSql.fin_pagamentos, /foreign key \(grupo_id, data\) references fin_dias\(grupo_id, data\)/);
  assert.match(tabelasDoSql.ao_vivo, /foreign key \(grupo_id, round_id\) references rodadas\(grupo_id, round_id\) deferrable initially deferred/);
  assert.match(sql, /foreign key \(grupo_id, credito_id\) references fin_creditos\(grupo_id, id\)/);
  // nenhuma referência simples (sem grupo_id) a tabelas do app
  assert.doesNotMatch(sql, /references (jogadores|rodadas|fin_dias|fin_pagamentos|fin_creditos|times_rodada)\((id|round_id|data)\)/);
});

t('o índice de pagamento válido mantém o nome que o repositório reconhece, agora por grupo', () => {
  assert.match(sql, /create unique index fin_pagamentos_valido_uniq on fin_pagamentos \(grupo_id, data, coalesce\(jogo, 0\), jogador_id\) where not estornado;/);
});

t('as funções nunca tocam linhas sem filtrar pelo grupo (todo delete/update nelas tem grupo_id = p_grupo_id)', () => {
  const corpos = [...sql.matchAll(/create or replace function (\w+)\(p_grupo_id uuid[\s\S]*?\n\$\$;/g)].map((m) => [m[1], m[0]]);
  for (const [nome, corpo] of corpos) {
    // "on conflict ... do update set" é o upsert da própria linha (já presa ao grupo pela chave de conflito): fica de fora
    for (const cmd of corpo.match(/(?<!do )\b(delete from|update) \w+[^;]*;/g) || []) {
      assert.match(cmd, /grupo_id = p_grupo_id/, nome + ': ' + cmd.slice(0, 80));
    }
  }
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/sql-grupos.test.mjs`
Expected: `ENOENT` (arquivo `sql/grupos/schema-grupos.sql` não existe).

- [ ] **Step 3: Escrever o SQL**

Criar `sql/grupos/schema-grupos.sql`:

```sql
-- Grupos independentes (spec docs/superpowers/specs/2026-10-12-grupos-independentes-design.md) — Fase 1.
-- Schema "grupos": TODOS os grupos novos moram nas mesmas tabelas, cada linha marcada com grupo_id. Chaves primárias e
-- estrangeiras começam por grupo_id, então nem o banco deixa um grupo apontar para jogador/rodada/dia de outro.
-- Terça (public) e Meme (meme) NÃO são tocados. NÃO é processado pelo scripts/gerar-sql-grupo.js.
-- QUEM RODA: o usuário, uma vez, no SQL Editor (depois do sql/liga/ajuste-1-cidade.sql).
-- Depois: Configurações > API > "Exposed schemas": acrescentar "grupos".
create schema if not exists grupos;
grant usage on schema grupos to service_role;
set search_path to grupos;

-- ======================================================================= cadastro
create table grupos (
  id uuid primary key default gen_random_uuid(),
  apelido text not null unique check (apelido ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' and apelido !~ '--'),
  nome text not null check (char_length(btrim(nome)) between 3 and 60),
  cidade text not null check (char_length(btrim(cidade)) between 2 and 60),
  uf char(2) not null check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  cor_destaque text not null check (cor_destaque ~ '^#[0-9a-f]{6}$'),
  logo_url text,
  plano text not null default 'gratis',
  status text not null default 'ativo' check (status in ('ativo', 'suspenso')),
  dono_email text not null,
  criado_em timestamptz not null default now()
);
create index if not exists grupos_dono_email_idx on grupos (dono_email);

-- uma linha só (id sempre true): os limites do plano grátis, ajustáveis com um update
create table limites (
  id boolean primary key default true check (id),
  max_grupos_por_email int not null default 1,
  max_jogadores_por_grupo int not null default 150,
  max_foto_kb int not null default 300,
  max_criacoes_por_ip_hora int not null default 3
);
insert into limites default values on conflict do nothing;

-- mesma lista de backend/grupos-cadastro.js (APELIDOS_RESERVADOS) — o teste sql-grupos confere que as duas batem
create table apelidos_reservados (apelido text primary key);
insert into apelidos_reservados (apelido) values
  ('criar'), ('admin'), ('api'), ('app'), ('www'), ('static'), ('assets'), ('sw'), ('login'), ('ajuda'), ('suporte'),
  ('termos'), ('privacidade'), ('volei'), ('voleimeme'), ('terca'), ('meme'), ('memberstars'),
  ('porra'), ('caralho'), ('merda'), ('puta'), ('buceta'), ('foda'), ('viado')
on conflict do nothing;

-- ======================================================================= sequências da coluna "ordem"
-- uma por tabela, globais: a ordem relativa DENTRO de cada grupo é a mesma de ter uma por grupo
create sequence if not exists seq_ordem_jogadores;
create sequence if not exists seq_ordem_rodadas;
create sequence if not exists seq_ordem_checkins;
create sequence if not exists seq_ordem_usuarios;
create sequence if not exists seq_ordem_fin_dias;
create sequence if not exists seq_ordem_fin_pagamentos;
create sequence if not exists seq_ordem_fin_creditos;
create sequence if not exists seq_ordem_fin_lancamentos;

-- ======================================================================= núcleo
create table jogadores (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  nome text not null,
  apelido text,
  foto text,
  estrelas numeric(3,1),
  sexo text check (sexo in ('M','F')),
  porte text,
  convidado boolean not null default false,
  removido boolean not null default false,
  ordem int default nextval('seq_ordem_jogadores'),
  primary key (grupo_id, id)
);

create table rodadas (
  grupo_id uuid not null references grupos(id) on delete cascade,
  round_id text not null,
  data date not null,
  rascunho boolean not null default false,
  horario text check (horario is null or horario ~ '^[0-2][0-9]:[0-5][0-9]$'),
  ordem int default nextval('seq_ordem_rodadas'),
  primary key (grupo_id, round_id)
);

create table times_rodada (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  round_id text not null,
  time_index int not null,
  time_nome text,
  vitorias int not null default 0,
  vencedor boolean not null default false,
  unique (grupo_id, round_id, time_index),
  unique (grupo_id, id),
  foreign key (grupo_id, round_id) references rodadas(grupo_id, round_id)
);

create table time_jogadores (
  grupo_id uuid not null references grupos(id) on delete cascade,
  time_rodada_id bigint not null,
  jogador_id text not null,
  posicao int,
  primary key (grupo_id, time_rodada_id, jogador_id),
  foreign key (grupo_id, time_rodada_id) references times_rodada(grupo_id, id),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id)
);

create table checkins (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  data date not null,
  jogador_id text,
  jogador_nome text,
  estrelas numeric(3,1),
  sexo text,
  estrelas_ajustadas numeric(3,1),
  jogo smallint not null default 1 check (jogo in (1, 2)),
  ordem int default nextval('seq_ordem_checkins'),
  primary key (grupo_id, id),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id)
);

create table usuarios (
  grupo_id uuid not null references grupos(id) on delete cascade,
  email text not null,
  nome text,
  perfil text not null default 'jogador' check (perfil in ('jogador','organizador','admin')),
  jogador_id text,
  criado_em timestamptz not null default now(),
  jogador_id_pendente text,
  ordem int default nextval('seq_ordem_usuarios'),
  primary key (grupo_id, email),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id),
  foreign key (grupo_id, jogador_id_pendente) references jogadores(grupo_id, id)
);
create unique index if not exists usuarios_jogador_id_unico on usuarios (grupo_id, jogador_id) where jogador_id is not null;
create unique index if not exists usuarios_jogador_id_pendente_unico on usuarios (grupo_id, jogador_id_pendente) where jogador_id_pendente is not null;

create table config (
  grupo_id uuid not null references grupos(id) on delete cascade,
  chave text not null,
  valor text,
  primary key (grupo_id, chave)
);

-- token_hash é aleatório (único no banco todo); a sessão carrega o grupo e só é achada dentro dele
create table sessoes (
  token_hash text primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  email text not null,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null,
  renovada_em timestamptz not null default now()
);
create index if not exists sessoes_grupo_email_idx on sessoes (grupo_id, email);

create table push_inscricoes (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz,
  primary key (grupo_id, id),
  unique (grupo_id, endpoint)
);

-- ======================================================================= financeiro
create table fin_dias (
  grupo_id uuid not null references grupos(id) on delete cascade,
  data date not null,
  valor_pessoa numeric(10,2),
  pix text,
  valor_quadra numeric(10,2),
  tem_brinde boolean,
  valor_brinde numeric(10,2),
  atualizado_por text,
  atualizado_em timestamptz,
  icone text,
  status text not null default 'normal' check (status in ('normal','semjogo')),
  por_jogo boolean not null default false,
  ordem int default nextval('seq_ordem_fin_dias'),
  primary key (grupo_id, data)
);

create table fin_pagamentos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  data date,
  jogador_id text,
  jogador_nome text,
  valor numeric(10,2),
  marcado_por text,
  marcado_em timestamptz,
  estornado boolean not null default false,
  estornado_por text,
  estornado_em timestamptz,
  tipo text not null default 'dinheiro' check (tipo in ('dinheiro','credito')),
  credito_id text,
  jogo smallint check (jogo in (1, 2)),
  ordem int default nextval('seq_ordem_fin_pagamentos'),
  primary key (grupo_id, id),
  foreign key (grupo_id, data) references fin_dias(grupo_id, data),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id)
);

create table fin_creditos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  jogador_id text,
  jogador_nome text,
  valor numeric(10,2),
  origem_pagamento_id text,
  data_origem date,
  criado_por text,
  criado_em timestamptz,
  status text check (status in ('ativo','devolvido','cancelado')),
  encerrado_por text,
  encerrado_em timestamptz,
  jogo_origem smallint check (jogo_origem in (1, 2)),
  ordem int default nextval('seq_ordem_fin_creditos'),
  primary key (grupo_id, id),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id),
  foreign key (grupo_id, origem_pagamento_id) references fin_pagamentos(grupo_id, id)
);

alter table fin_pagamentos
  add constraint fin_pagamentos_credito_fkey
  foreign key (grupo_id, credito_id) references fin_creditos(grupo_id, id);

-- 1 pagamento válido por jogador, por dia (ou por jogo, nos dias separados), DENTRO do grupo. O nome do índice é o que o
-- repositório reconhece no erro 23505 para devolver false (pagamento repetido) — não mudar.
create unique index fin_pagamentos_valido_uniq on fin_pagamentos (grupo_id, data, coalesce(jogo, 0), jogador_id) where not estornado;

create table fin_lancamentos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  data date,
  tipo text check (tipo in ('entrada','saida')),
  descricao text,
  valor numeric(10,2),
  criado_por text,
  criado_em timestamptz,
  estornado boolean not null default false,
  estornado_por text,
  estornado_em timestamptz,
  ordem int default nextval('seq_ordem_fin_lancamentos'),
  primary key (grupo_id, id)
);

create table fin_pendencias (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  jogador_id text,
  jogador_nome text,
  valor numeric(10,2),
  observacao text,
  data date,
  criado_por text,
  criado_em timestamptz,
  status text not null default 'pendente' check (status in ('pendente','paga')),
  baixado_por text,
  baixado_em timestamptz,
  ordem bigint generated by default as identity,
  primary key (grupo_id, id),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id)
);

create table fin_log (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  timestamp timestamptz,
  nome text,
  email text,
  acao text,
  detalhe jsonb
);
create index if not exists fin_log_grupo_idx on fin_log (grupo_id, id desc);

create table fin_jogos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  data date not null,
  jogo smallint not null check (jogo = 2),
  valor_pessoa numeric(10,2),
  pix text,
  valor_quadra numeric(10,2),
  tem_brinde boolean,
  valor_brinde numeric(10,2),
  icone text,
  status text not null default 'normal' check (status in ('normal', 'semjogo')),
  atualizado_por text,
  atualizado_em timestamptz,
  primary key (grupo_id, data, jogo),
  foreign key (grupo_id, data) references fin_dias(grupo_id, data)
);

-- ======================================================================= Ao Vivo
create table ao_vivo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  round_id text,
  time_index int,
  time_nome text,
  vitorias numeric,
  iniciado_em timestamptz,
  duracao_minutos numeric,
  data date,
  jogadores text,
  -- adiável até o fim da transação: gravar_rodada apaga e recria a rodada que está ao vivo (mesmo motivo do ajuste 6)
  foreign key (grupo_id, round_id) references rodadas(grupo_id, round_id) deferrable initially deferred
);
create index if not exists ao_vivo_grupo_round_idx on ao_vivo (grupo_id, round_id);

create table ao_vivo_log (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  round_id text,
  time_index int,
  time_nome text,
  delta numeric,
  "timestamp" timestamptz
);
create index if not exists ao_vivo_log_grupo_round_idx on ao_vivo_log (grupo_id, round_id);

-- ======================================================================= infraestrutura
create table travas (
  grupo_id uuid not null references grupos(id) on delete cascade,
  nome text not null,
  dono text not null,
  expira_em timestamptz not null,
  primary key (grupo_id, nome)
);

create table limite_tentativas (
  grupo_id uuid not null references grupos(id) on delete cascade,
  chave text not null,
  tentativas int not null default 0,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (grupo_id, chave)
);

-- ======================================================================= RLS e permissões
-- RLS ligado e sem políticas (como no Terça): o navegador nunca fala com o banco, só a função (service_role)
alter table grupos enable row level security;
alter table limites enable row level security;
alter table apelidos_reservados enable row level security;
alter table jogadores enable row level security;
alter table rodadas enable row level security;
alter table times_rodada enable row level security;
alter table time_jogadores enable row level security;
alter table checkins enable row level security;
alter table usuarios enable row level security;
alter table config enable row level security;
alter table sessoes enable row level security;
alter table push_inscricoes enable row level security;
alter table fin_dias enable row level security;
alter table fin_pagamentos enable row level security;
alter table fin_creditos enable row level security;
alter table fin_lancamentos enable row level security;
alter table fin_pendencias enable row level security;
alter table fin_log enable row level security;
alter table fin_jogos enable row level security;
alter table ao_vivo enable row level security;
alter table ao_vivo_log enable row level security;
alter table travas enable row level security;
alter table limite_tentativas enable row level security;
grant select, insert, update, delete on all tables in schema grupos to service_role;
grant usage, select on all sequences in schema grupos to service_role;

-- ======================================================================= funções (todas presas a p_grupo_id)
create or replace function gravar_rodada(p_grupo_id uuid, p jsonb) returns void
language plpgsql set search_path = grupos as $$
declare
  v_round_id text := p->>'id';
  v_time jsonb;
  v_idx int;
  v_time_id bigint;
begin
  insert into jogadores (grupo_id, id, nome, convidado, ordem)
  select p_grupo_id, c->>'id', c->>'nome', true, null
  from jsonb_array_elements(coalesce(p->'convidados', '[]'::jsonb)) as c
  on conflict (grupo_id, id) do nothing;
  delete from time_jogadores where grupo_id = p_grupo_id
    and time_rodada_id in (select id from times_rodada where grupo_id = p_grupo_id and round_id = v_round_id);
  delete from times_rodada where grupo_id = p_grupo_id and round_id = v_round_id;
  delete from rodadas where grupo_id = p_grupo_id and round_id = v_round_id;
  insert into rodadas (grupo_id, round_id, data, rascunho, horario)
  values (p_grupo_id, v_round_id, (p->>'data')::date, coalesce((p->>'rascunho')::boolean, false), nullif(btrim(p->>'horario'), ''));
  for v_time, v_idx in
    select t.value, (t.ordinality - 1)::int from jsonb_array_elements(p->'times') with ordinality as t
  loop
    insert into times_rodada (grupo_id, round_id, time_index, time_nome, vitorias, vencedor)
    values (p_grupo_id, v_round_id, v_idx, v_time->>'nome',
      coalesce((v_time->>'vitorias')::int, 0), coalesce((v_time->>'vencedor')::boolean, false))
    returning id into v_time_id;
    insert into time_jogadores (grupo_id, time_rodada_id, jogador_id, posicao)
    select p_grupo_id, v_time_id, j.value, (j.ordinality - 1)::int
    from jsonb_array_elements_text(coalesce(v_time->'playerIds', '[]'::jsonb)) with ordinality as j
    on conflict do nothing; -- id repetido na mesma lista: vale o primeiro
  end loop;
end;
$$;

create or replace function remover_rodada(p_grupo_id uuid, p_id text) returns boolean
language plpgsql set search_path = grupos as $$
begin
  delete from ao_vivo_log where grupo_id = p_grupo_id and round_id = p_id;
  delete from ao_vivo where grupo_id = p_grupo_id and round_id = p_id;
  delete from time_jogadores where grupo_id = p_grupo_id
    and time_rodada_id in (select id from times_rodada where grupo_id = p_grupo_id and round_id = p_id);
  delete from times_rodada where grupo_id = p_grupo_id and round_id = p_id;
  delete from rodadas where grupo_id = p_grupo_id and round_id = p_id;
  return found; -- "found" vem do último comando: o delete da própria rodada
end;
$$;

create or replace function incrementar_acesso(p_grupo_id uuid) returns numeric
language plpgsql set search_path = grupos as $$
declare
  v_novo text;
begin
  insert into config (grupo_id, chave, valor) values (p_grupo_id, 'contadorAcessos', '1')
  on conflict (grupo_id, chave) do update set valor = (
    case when btrim(config.valor) ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
         then btrim(config.valor)::numeric else 0 end + 1
  )::text
  returning valor into v_novo;
  return v_novo::numeric;
end;
$$;

-- trava de gravação POR GRUPO: um sorteio no grupo A não bloqueia um check-in no grupo B
create or replace function pegar_trava(p_grupo_id uuid, p_nome text, p_dono text, p_ttl_seg int) returns boolean
language plpgsql set search_path = grupos as $$
declare
  v_ok boolean;
begin
  insert into travas as t (grupo_id, nome, dono, expira_em)
  values (p_grupo_id, p_nome, p_dono, now() + make_interval(secs => p_ttl_seg))
  on conflict (grupo_id, nome) do update
    set dono = excluded.dono, expira_em = excluded.expira_em
    where t.expira_em < now() or t.dono = excluded.dono
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function soltar_trava(p_grupo_id uuid, p_nome text, p_dono text) returns void
language plpgsql set search_path = grupos as $$
begin
  delete from travas where grupo_id = p_grupo_id and nome = p_nome and dono = p_dono;
end;
$$;

create or replace function registrar_tentativa(p_grupo_id uuid, p_chave text, p_max int, p_janela_seg int, p_bloqueio_seg int) returns boolean
language plpgsql set search_path = grupos as $$
declare
  v_permitido boolean;
begin
  delete from limite_tentativas
   where grupo_id = p_grupo_id
     and atualizado_em < now() - interval '1 day'
     and (bloqueado_ate is null or bloqueado_ate < now())
     and chave <> p_chave;
  insert into limite_tentativas as l (grupo_id, chave, tentativas, bloqueado_ate, atualizado_em)
  values (p_grupo_id, p_chave, 1, null, now())
  on conflict (grupo_id, chave) do update set
    tentativas = case
      when l.bloqueado_ate > now() then l.tentativas
      when l.atualizado_em < now() - make_interval(secs => p_janela_seg)
        or (l.bloqueado_ate is not null and l.bloqueado_ate <= now()) then 1
      else l.tentativas + 1 end,
    bloqueado_ate = case
      when l.bloqueado_ate > now() then l.bloqueado_ate
      when l.atualizado_em < now() - make_interval(secs => p_janela_seg)
        or (l.bloqueado_ate is not null and l.bloqueado_ate <= now()) then null
      when l.tentativas + 1 > p_max then now() + make_interval(secs => p_bloqueio_seg)
      else null end,
    atualizado_em = case when l.bloqueado_ate > now() then l.atualizado_em else now() end
  returning (bloqueado_ate is null or bloqueado_ate <= now()) into v_permitido;
  return coalesce(v_permitido, false);
end;
$$;

create or replace function limpar_falhas(p_grupo_id uuid, p_chave text) returns void
language plpgsql set search_path = grupos as $$
begin
  delete from limite_tentativas where grupo_id = p_grupo_id and chave = p_chave;
end;
$$;

create or replace function mover_checkin_de_jogo(p_grupo_id uuid, p_id text, p_para_jogo smallint) returns boolean
language plpgsql set search_path = grupos as $$
declare
  v_jogador_id text;
  v_data date;
  v_proxima_ordem bigint;
begin
  select jogador_id, data into v_jogador_id, v_data from checkins where grupo_id = p_grupo_id and id = p_id;
  if not found then
    return false;
  end if;
  if v_jogador_id is not null and exists (
    select 1 from checkins where grupo_id = p_grupo_id and data = v_data and jogo = p_para_jogo and jogador_id = v_jogador_id
  ) then
    return false; -- já está no destino: nada para mover
  end if;
  select coalesce(max(ordem), 0) + 1 into v_proxima_ordem from checkins where grupo_id = p_grupo_id and data = v_data and jogo = p_para_jogo;
  update checkins set jogo = p_para_jogo, ordem = v_proxima_ordem where grupo_id = p_grupo_id and id = p_id;
  return true;
end;
$$;

create or replace function mover_jogo2_para_jogo1(p_grupo_id uuid, p_data date) returns int
language plpgsql set search_path = grupos as $$
declare
  v_movidos int := 0;
  v_proxima_ordem bigint;
  v_linha record;
begin
  delete from checkins c2
  where c2.grupo_id = p_grupo_id and c2.data = p_data and c2.jogo = 2 and c2.jogador_id is not null
    and exists (select 1 from checkins c1 where c1.grupo_id = p_grupo_id and c1.data = p_data and c1.jogo = 1 and c1.jogador_id = c2.jogador_id);
  select coalesce(max(ordem), 0) into v_proxima_ordem from checkins where grupo_id = p_grupo_id and data = p_data and jogo = 1;
  for v_linha in select id from checkins where grupo_id = p_grupo_id and data = p_data and jogo = 2 order by ordem loop
    v_proxima_ordem := v_proxima_ordem + 1;
    update checkins set jogo = 1, ordem = v_proxima_ordem where grupo_id = p_grupo_id and id = v_linha.id;
    v_movidos := v_movidos + 1;
  end loop;
  return v_movidos;
end;
$$;

create or replace function mover_fila_para_jogo(p_grupo_id uuid, p_data date, p_de smallint, p_para smallint) returns int
language plpgsql set search_path = grupos as $$
declare
  v_movidos int := 0;
  v_proxima_ordem bigint;
  v_linha record;
begin
  delete from checkins cd
  where cd.grupo_id = p_grupo_id and cd.data = p_data and cd.jogo = p_de and cd.jogador_id is not null
    and exists (select 1 from checkins cp where cp.grupo_id = p_grupo_id and cp.data = p_data and cp.jogo = p_para and cp.jogador_id = cd.jogador_id);
  select coalesce(max(ordem), 0) into v_proxima_ordem from checkins where grupo_id = p_grupo_id and data = p_data and jogo = p_para;
  for v_linha in select id from checkins where grupo_id = p_grupo_id and data = p_data and jogo = p_de order by ordem loop
    v_proxima_ordem := v_proxima_ordem + 1;
    update checkins set jogo = p_para, ordem = v_proxima_ordem where grupo_id = p_grupo_id and id = v_linha.id;
    v_movidos := v_movidos + 1;
  end loop;
  return v_movidos;
end;
$$;

revoke execute on function gravar_rodada(uuid, jsonb) from public, anon, authenticated;
revoke execute on function remover_rodada(uuid, text) from public, anon, authenticated;
revoke execute on function incrementar_acesso(uuid) from public, anon, authenticated;
revoke execute on function pegar_trava(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function soltar_trava(uuid, text, text) from public, anon, authenticated;
revoke execute on function registrar_tentativa(uuid, text, int, int, int) from public, anon, authenticated;
revoke execute on function limpar_falhas(uuid, text) from public, anon, authenticated;
revoke execute on function mover_checkin_de_jogo(uuid, text, smallint) from public, anon, authenticated;
revoke execute on function mover_jogo2_para_jogo1(uuid, date) from public, anon, authenticated;
revoke execute on function mover_fila_para_jogo(uuid, date, smallint, smallint) from public, anon, authenticated;
grant execute on function gravar_rodada(uuid, jsonb) to service_role;
grant execute on function remover_rodada(uuid, text) to service_role;
grant execute on function incrementar_acesso(uuid) to service_role;
grant execute on function pegar_trava(uuid, text, text, int) to service_role;
grant execute on function soltar_trava(uuid, text, text) to service_role;
grant execute on function registrar_tentativa(uuid, text, int, int, int) to service_role;
grant execute on function limpar_falhas(uuid, text) to service_role;
grant execute on function mover_checkin_de_jogo(uuid, text, smallint) to service_role;
grant execute on function mover_jogo2_para_jogo1(uuid, date) to service_role;
grant execute on function mover_fila_para_jogo(uuid, date, smallint, smallint) to service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/sql-grupos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`. Se o teste "funções nunca tocam linhas sem filtrar" falhar por um `update`/`delete` dentro de uma subconsulta já filtrada, corrigir o SQL (pôr `grupo_id = p_grupo_id` no comando), não o teste.

- [ ] **Step 5: Acrescentar ao `test:backend` e commit**

Acrescentar ` && node tests/backend/sql-grupos.test.mjs` ao `test:backend`.

```bash
git add sql/grupos/schema-grupos.sql tests/backend/sql-grupos.test.mjs package.json
git commit -m "feat(grupos): schema grupos com grupo_id em todas as tabelas e funções"
```

---

### Task 4: Regras de cadastro + `criar_grupo` + cidade na `liga`

**Files:**
- Create: `backend/grupos-cadastro.js`
- Create: `tests/backend/grupos-cadastro.test.mjs`
- Create: `sql/liga/ajuste-1-cidade.sql`
- Modify: `sql/grupos/schema-grupos.sql` (acrescentar `criar_grupo` no fim)
- Modify: `tests/backend/sql-grupos.test.mjs` (acrescentar testes antes do `fim()`)
- Modify: `package.json`

**Interfaces:**
- Produces (de `backend/grupos-cadastro.js`):
  - `UFS: string[]` (27 siglas), `PALETA: string[]` (hex minúsculos), `APELIDOS_RESERVADOS: string[]`
  - `normalizarApelido(s) -> string` (minúsculas, sem espaços nas pontas)
  - `validarApelido(s) -> '' | mensagem`
  - `sugerirApelido(nome) -> string` (sem acento, minúsculas, não-alfanumérico vira `-`, até 30)
  - `normalizarCidade(s) -> string`
  - `validarCadastroGrupo({ nome, apelido, cidade, uf, cor }) -> { erro: string } | { dados: { nome, apelido, cidade, uf, cor } }`
- Produces (SQL): `grupos.criar_grupo(p_apelido text, p_nome text, p_cidade text, p_uf text, p_cor text, p_dono_email text, p_dono_nome text) returns uuid`, que lança exceções com mensagem `apelido_invalido` | `apelido_reservado` | `apelido_em_uso` | `limite_por_email` (a Fase 2 traduz para o usuário). `liga.grupos` ganha `cidade text`, `uf char(2)`.

- [ ] **Step 1: Escrever os testes (falham)**

Criar `tests/backend/grupos-cadastro.test.mjs`:

```js
import assert from 'node:assert/strict';
import { t, fim } from './executor.mjs';
import {
  UFS, PALETA, APELIDOS_RESERVADOS, normalizarApelido, validarApelido, sugerirApelido, normalizarCidade, validarCadastroGrupo
} from '../../backend/grupos-cadastro.js';

t('UFs: as 27, únicas', () => {
  assert.equal(UFS.length, 27);
  assert.equal(new Set(UFS).size, 27);
  assert.ok(UFS.includes('MG') && UFS.includes('DF'));
});

t('paleta: hex minúsculo de 6 dígitos, sem repetição, pelo menos 6 cores', () => {
  assert.ok(PALETA.length >= 6);
  assert.equal(new Set(PALETA).size, PALETA.length);
  for (const c of PALETA) assert.match(c, /^#[0-9a-f]{6}$/);
});

t('validarApelido: aceita o formato certo e explica o que está errado', () => {
  for (const ok of ['quinta', 'volei-da-quinta', 'bh2026', 'abc']) assert.equal(validarApelido(ok), '', ok);
  assert.match(validarApelido('ab'), /3 a 30/);
  assert.match(validarApelido('a'.repeat(31)), /3 a 30/);
  for (const ruim of ['Quinta', 'vôlei', 'meu grupo', '-quinta', 'quinta-', 'qu--inta', 'quinta!']) {
    assert.match(validarApelido(ruim), /letras minúsculas/, ruim);
  }
  for (const r of ['criar', 'admin', 'terca', 'meme', 'porra']) assert.match(validarApelido(r), /reservado/, r);
});

t('normalizarApelido e sugerirApelido', () => {
  assert.equal(normalizarApelido('  quinta '), 'quinta');
  assert.equal(sugerirApelido('Vôlei da Quinta!'), 'volei-da-quinta');
  assert.equal(sugerirApelido('  São   João  '), 'sao-joao');
  assert.equal(sugerirApelido('Á'.repeat(40)).length, 30);
  assert.equal(validarApelido(sugerirApelido('Vôlei de Sábado - Praia')), '');
});

t('normalizarCidade: espaços, maiúsculas e preposições', () => {
  assert.equal(normalizarCidade('  são   paulo '), 'São Paulo');
  assert.equal(normalizarCidade('BELO HORIZONTE'), 'Belo Horizonte');
  assert.equal(normalizarCidade('rio de janeiro'), 'Rio de Janeiro');
  assert.equal(normalizarCidade('santana do parnaíba'), 'Santana do Parnaíba');
  assert.equal(normalizarCidade('de'), 'De'); // a primeira palavra sempre maiúscula
});

t('validarCadastroGrupo: devolve os dados normalizados ou o primeiro erro', () => {
  const base = { nome: '  Vôlei de Quinta ', apelido: 'quinta', cidade: 'belo horizonte', uf: 'mg', cor: PALETA[0].toUpperCase() };
  assert.deepEqual(validarCadastroGrupo(base), { dados: { nome: 'Vôlei de Quinta', apelido: 'quinta', cidade: 'Belo Horizonte', uf: 'MG', cor: PALETA[0] } });
  assert.deepEqual(validarCadastroGrupo({ ...base, nome: 'ab' }), { erro: 'O nome do grupo precisa ter de 3 a 60 caracteres.' });
  assert.deepEqual(validarCadastroGrupo({ ...base, cidade: ' ' }), { erro: 'Informe a cidade do grupo.' });
  assert.deepEqual(validarCadastroGrupo({ ...base, uf: 'XX' }), { erro: 'Escolha o estado (UF).' });
  assert.deepEqual(validarCadastroGrupo({ ...base, cor: '#123456' }), { erro: 'Escolha uma das cores da paleta.' });
  assert.match(validarCadastroGrupo({ ...base, apelido: 'admin' }).erro, /reservado/);
});

t('lista de reservados: minúscula e sem repetição', () => {
  assert.equal(new Set(APELIDOS_RESERVADOS).size, APELIDOS_RESERVADOS.length);
  for (const r of APELIDOS_RESERVADOS) assert.equal(r, r.toLowerCase());
});

fim();
```

Em `tests/backend/sql-grupos.test.mjs`, acrescentar o import no topo:

```js
import { UFS, APELIDOS_RESERVADOS } from '../../backend/grupos-cadastro.js';
```

e, antes de `fim();`:

```js
t('JS e SQL concordam: mesmas UFs, mesmos reservados, mesma regex de apelido', () => {
  const ufsSql = sql.match(/uf in \(([^)]*)\)/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(ufsSql.sort(), [...UFS].sort());
  const blocoReservados = sql.match(/insert into apelidos_reservados \(apelido\) values([\s\S]*?)on conflict/)[1];
  const reservadosSql = [...blocoReservados.matchAll(/\('([a-z0-9-]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(reservadosSql.sort(), [...APELIDOS_RESERVADOS].sort());
  assert.match(sql, /apelido ~ '\^\[a-z0-9\]\[a-z0-9-\]\{1,28\}\[a-z0-9\]\$' and apelido !~ '--'/);
});

t('criar_grupo: uma transação que valida limites e cria cadastro, dono admin e linha na liga', () => {
  const corpo = sql.match(/create or replace function criar_grupo\([\s\S]*?\n\$\$;/)[0];
  for (const erro of ['apelido_invalido', 'apelido_reservado', 'apelido_em_uso', 'limite_por_email']) assert.match(corpo, new RegExp("'" + erro + "'"));
  assert.match(corpo, /insert into grupos \(/);
  assert.match(corpo, /insert into usuarios \(grupo_id, email, nome, perfil\)[\s\S]*'admin'/);
  assert.match(corpo, /insert into liga\.grupos \(id, nome, cor, cidade, uf\)/);
  assert.match(corpo, /from limites/);
  assert.match(sql, /revoke execute on function criar_grupo\(text, text, text, text, text, text, text\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function criar_grupo\(text, text, text, text, text, text, text\) to service_role;/);
});

t('liga ganha cidade e uf (ajuste próprio, idempotente)', () => {
  const liga = ler('sql/liga/ajuste-1-cidade.sql');
  assert.match(liga, /alter table liga\.grupos add column if not exists cidade text;/);
  assert.match(liga, /alter table liga\.grupos add column if not exists uf char\(2\);/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/grupos-cadastro.test.mjs; node tests/backend/sql-grupos.test.mjs`
Expected: o primeiro com `ERR_MODULE_NOT_FOUND` (`grupos-cadastro.js`); o segundo também (import novo).

- [ ] **Step 3: Implementar `backend/grupos-cadastro.js`**

```js
// Regras do cadastro de um grupo independente (spec 2026-10-12). O banco repete as mesmas regras (sql/grupos/
// schema-grupos.sql) — o teste sql-grupos confere que UFs, reservados e o formato do apelido batem nos dois lados.
// Aqui elas servem para responder rápido e em português na tela de criação; o banco é a última palavra.
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE',
  'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

// cores de destaque oferecidas na criação: todas legíveis sobre o fundo escuro do app
export const PALETA = ['#ffd700', '#00f3ff', '#39ff9e', '#ff4d6d', '#b388ff', '#ff9f1c', '#4dabf7', '#f06595'];

export const APELIDOS_RESERVADOS = ['criar', 'admin', 'api', 'app', 'www', 'static', 'assets', 'sw', 'login', 'ajuda',
  'suporte', 'termos', 'privacidade', 'volei', 'voleimeme', 'terca', 'meme', 'memberstars',
  'porra', 'caralho', 'merda', 'puta', 'buceta', 'foda', 'viado'];

const FORMATO_APELIDO = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const texto = (v) => (v === undefined || v === null ? '' : String(v));

export const normalizarApelido = (s) => texto(s).trim();

export function validarApelido(s) {
  const a = normalizarApelido(s);
  if (a.length < 3 || a.length > 30) return 'O endereço precisa ter de 3 a 30 caracteres.';
  if (!FORMATO_APELIDO.test(a) || a.includes('--')) return 'Use só letras minúsculas, números e hífen (sem acento, sem espaço, sem hífen nas pontas).';
  if (APELIDOS_RESERVADOS.includes(a)) return 'Esse endereço é reservado. Escolha outro.';
  return '';
}

export function sugerirApelido(nome) {
  return texto(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');
}

export function normalizarCidade(s) {
  return texto(s).trim().split(/\s+/).filter(Boolean).map((p, i) => {
    const min = p.toLowerCase();
    if (i > 0 && PREPOSICOES.has(min)) return min;
    return min.charAt(0).toUpperCase() + min.slice(1);
  }).join(' ');
}

export function validarCadastroGrupo({ nome, apelido, cidade, uf, cor } = {}) {
  const n = texto(nome).trim().replace(/\s+/g, ' ');
  if (n.length < 3 || n.length > 60) return { erro: 'O nome do grupo precisa ter de 3 a 60 caracteres.' };
  const erroApelido = validarApelido(apelido);
  if (erroApelido) return { erro: erroApelido };
  const c = normalizarCidade(cidade);
  if (c.length < 2 || c.length > 60) return { erro: 'Informe a cidade do grupo.' };
  const u = texto(uf).trim().toUpperCase();
  if (!UFS.includes(u)) return { erro: 'Escolha o estado (UF).' };
  const cor_ = texto(cor).trim().toLowerCase();
  if (!PALETA.includes(cor_)) return { erro: 'Escolha uma das cores da paleta.' };
  return { dados: { nome: n, apelido: normalizarApelido(apelido), cidade: c, uf: u, cor: cor_ } };
}
```

- [ ] **Step 4: Escrever `sql/liga/ajuste-1-cidade.sql`**

```sql
-- Amistosos: cidade e UF de cada grupo, para o convite mostrar primeiro os adversários da mesma cidade
-- (grupos independentes, spec 2026-10-12). Idempotente. QUEM RODA: o usuário, antes do sql/grupos/schema-grupos.sql.
-- Depois de rodar, informe a cidade do Terça e do Meme com:
--   update liga.grupos set cidade = 'Nome da Cidade', uf = 'UF' where id = 'terca';
--   update liga.grupos set cidade = 'Nome da Cidade', uf = 'UF' where id = 'meme';
alter table liga.grupos add column if not exists cidade text;
alter table liga.grupos add column if not exists uf char(2);
```

- [ ] **Step 5: Acrescentar `criar_grupo` no fim de `sql/grupos/schema-grupos.sql`**

```sql
-- ======================================================================= criação de grupo (o "um clique")
-- Tudo numa transação: valida o apelido e o limite por e-mail, cria o cadastro, o dono como admin e a linha na liga
-- (id da liga = apelido). A config fica vazia de propósito: mapearConfig já devolve os padrões quando a chave não existe.
-- Erros saem como exceção com a mensagem-código (apelido_invalido | apelido_reservado | apelido_em_uso |
-- limite_por_email); a função grupos-api traduz para o usuário. Corrida de dois criando o mesmo apelido ao mesmo tempo
-- cai no unique de grupos.apelido / liga.grupos.id (erro 23505), que a grupos-api também traduz para apelido_em_uso.
create or replace function criar_grupo(p_apelido text, p_nome text, p_cidade text, p_uf text, p_cor text,
                                       p_dono_email text, p_dono_nome text) returns uuid
language plpgsql set search_path = grupos as $$
declare
  v_id uuid;
  v_apelido text := lower(btrim(p_apelido));
  v_email text := lower(btrim(p_dono_email));
  v_max int;
begin
  select max_grupos_por_email into v_max from limites limit 1;
  if v_apelido !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' or v_apelido ~ '--' then
    raise exception 'apelido_invalido';
  end if;
  if exists (select 1 from apelidos_reservados where apelido = v_apelido) then
    raise exception 'apelido_reservado';
  end if;
  if exists (select 1 from grupos where apelido = v_apelido) or exists (select 1 from liga.grupos where id = v_apelido) then
    raise exception 'apelido_em_uso';
  end if;
  if (select count(*) from grupos where dono_email = v_email) >= coalesce(v_max, 1) then
    raise exception 'limite_por_email';
  end if;
  insert into grupos (apelido, nome, cidade, uf, cor_destaque, dono_email)
  values (v_apelido, btrim(p_nome), btrim(p_cidade), upper(btrim(p_uf)), lower(btrim(p_cor)), v_email)
  returning id into v_id;
  insert into usuarios (grupo_id, email, nome, perfil) values (v_id, v_email, p_dono_nome, 'admin');
  insert into liga.grupos (id, nome, cor, cidade, uf)
  values (v_apelido, btrim(p_nome), lower(btrim(p_cor)), btrim(p_cidade), upper(btrim(p_uf)));
  return v_id;
end;
$$;
revoke execute on function criar_grupo(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function criar_grupo(text, text, text, text, text, text, text) to service_role;
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node tests/backend/grupos-cadastro.test.mjs && node tests/backend/sql-grupos.test.mjs`
Expected: os dois com `TODOS OS TESTES PASSARAM`. Atenção: o teste "funções nunca tocam linhas sem filtrar" da Task 3 só olha funções com `p_grupo_id` — `criar_grupo` não tem `update`/`delete`, então não entra nele.

- [ ] **Step 7: Acrescentar ao `test:backend` e commit**

Acrescentar ` && node tests/backend/grupos-cadastro.test.mjs` ao `test:backend`.

```bash
git add backend/grupos-cadastro.js tests/backend/grupos-cadastro.test.mjs sql/liga/ajuste-1-cidade.sql sql/grupos/schema-grupos.sql tests/backend/sql-grupos.test.mjs package.json
git commit -m "feat(grupos): regras de cadastro, criar_grupo e cidade/UF na liga"
```

---

### Task 5: Cidade e UF no bloco da liga

**Files:**
- Modify: `backend/amistosos.js` (função `mapearLiga`, linha do `grupos`)
- Modify: `tests/backend/amistosos.test.mjs`

**Interfaces:**
- Consumes: `liga.grupos.cidade`, `liga.grupos.uf` (Task 4).
- Produces: cada item de `BlocoLiga.grupos` passa a ser `{ id, nome, logoUrl, cor, cidade, uf }` (cidade/uf `''` quando não informados). A Fase 5 usa isso no convite.

- [ ] **Step 1: Ajustar o teste (falha)**

Em `tests/backend/amistosos.test.mjs`, no teste `'mapearLiga: formato do front, adversário do ponto de vista do grupo, grupos inativos fora'`, trocar:

```js
  assert.deepEqual(bloco.grupos[0], { id: 'terca', nome: 'Vôlei de Terça', logoUrl: '', cor: '#ffd700' });
```

por:

```js
  assert.deepEqual(bloco.grupos[0], { id: 'terca', nome: 'Vôlei de Terça', logoUrl: '', cor: '#ffd700', cidade: '', uf: '' });
```

E acrescentar antes de `fim();`:

```js
t('mapearLiga: cidade e UF de cada grupo vão para o front (para o convite agrupar por cidade)', () => {
  const grupos = [{ id: 'terca', nome: 'Vôlei de Terça', cidade: 'Belo Horizonte', uf: 'MG' }, { id: 'meme', nome: 'Meme' }];
  const bloco = mapearLiga({ grupos, amistosos: [], mensagens: [], escalacoes: [], travas: [] }, 'terca', AGORA);
  assert.deepEqual(bloco.grupos.map((g) => [g.id, g.cidade, g.uf]), [['terca', 'Belo Horizonte', 'MG'], ['meme', '', '']]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/amistosos.test.mjs`
Expected: 2 FALHAS (o deepEqual do formato e o teste novo).

- [ ] **Step 3: Implementar**

Em `backend/amistosos.js`, dentro de `mapearLiga`, trocar:

```js
    .map((g) => ({ id: texto(g.id), nome: texto(g.nome), logoUrl: texto(g.logo_url), cor: texto(g.cor) }));
```

por:

```js
    .map((g) => ({ id: texto(g.id), nome: texto(g.nome), logoUrl: texto(g.logo_url), cor: texto(g.cor), cidade: texto(g.cidade), uf: texto(g.uf) }));
```

- [ ] **Step 4: Rodar e ver passar; suíte inteira**

Run: `node tests/backend/amistosos.test.mjs && npm run test:backend`
Expected: tudo `TODOS OS TESTES PASSARAM` (o front do Terça ignora campos extras em `grupos`; `node tests/amistosos-puro.test.js` também continua verde).

- [ ] **Step 5: Commit**

```bash
git add backend/amistosos.js tests/backend/amistosos.test.mjs
git commit -m "feat(liga): cidade e UF dos grupos no bloco de amistosos"
```

---

### Task 6: Fechamento da fase

- [ ] **Step 1: Suíte completa**

Run: `npm run test:backend` e `for f in tests/*.test.js; do node "$f" > /dev/null || echo "FALHOU: $f"; done`
Expected: backend todo verde; nenhuma linha `FALHOU`.

- [ ] **Step 2: Conferir que a Fase 1 não tocou no que está no ar**

Run: `git diff --stat <commit-base>..HEAD -- volei-dashboard.html supabase/ sql/meme/ sql/schema-terca-supabase*.sql`
Expected: nenhuma mudança.

- [ ] **Step 3: Relatório ao usuário**

Explicar que a Fase 1 está pronta e testada, mas **nada foi rodado no Supabase ainda**: o SQL (`sql/liga/ajuste-1-cidade.sql` e depois `sql/grupos/schema-grupos.sql`) só deve ser rodado quando a Fase 2 (a função `grupos-api`) estiver pronta, junto com expor o schema `grupos`. Pedir a cidade/UF do Terça e do Meme para o `update` da liga. Próximo passo: plano da Fase 2 (backend: `grupos-api`, `verificarApelido`/`criarGrupo`, tetos, fotos por grupo).
