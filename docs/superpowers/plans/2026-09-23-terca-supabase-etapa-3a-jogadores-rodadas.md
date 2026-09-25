# Terça no Supabase — Etapa 3a: Jogadores, rodadas e configurações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. A Task 7 tem passos do controlador e do usuário (SQL no painel do Supabase e teste no navegador).

**Goal:** O app grava jogadores, rodadas e configurações no Supabase com as mesmas respostas, mensagens de erro e efeitos no `GET` do Apps Script atual.

**Architecture:** Continua o módulo `backend/` (JavaScript puro). Novos módulos de regra: `convidados.js`, `jogadores.js`, `rodadas.js`, `configuracoes.js`. O repositório (memória e Supabase) ganha primitivas de gravação. Salvar e remover rodadas são funções do Postgres (`gravar_rodada`, `remover_rodada`, chamadas por RPC) para serem atômicas; a `ordem` das linhas novas vem de sequências do banco. O porteiro ganha a exceção "jogador troca só a própria foto". A igualdade com o `.gs` é provada por um teste diferencial que compara o `GET` completo depois de cada gravação.

**Tech Stack:** Node.js 24 (ESM, `node:assert`), Postgres (SQL/PLpgSQL colado no painel do Supabase), sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-23-terca-supabase-etapa-3a-jogadores-rodadas-design.md` (e os specs geral, da etapa 2 e do schema).

## Global Constraints

- Mesmas regras, respostas e **mensagens de erro** do `apps-script-codigo.gs` (`addPlayer`, `updatePlayer`, `removePlayer`, `addRound`, `updateRound`, `removeRound`, `saveSettingsAction`, `writeSettings`, `excecaoPropriaFoto_`). O `.gs` é a fonte da verdade: nunca editá-lo.
- `backend/` é JavaScript puro: nada de `node:*`, `process`, `require`, `Buffer`; `repo-supabase.js` não importa `@supabase/supabase-js`.
- Nenhum segredo no código nem nos testes (a senha mestra e o Client ID vêm do `.gs` carregado pelo teste ou do `.env`). Nunca escrever o valor da senha em arquivo, log ou mensagem de commit.
- `players` (no `GET` e nas validações) = jogadores com `convidado = false` **e** `removido = false`. Jogador arquivado nunca é apagado.
- `ordem` de linha nova NÃO é enviada pelo backend: o padrão do banco (sequência) a preenche. O repositório em memória imita isso (máximo + 1 quando a chave `ordem` nem foi enviada; `ordem: null` explícito continua nulo).
- Strings vazias de `apelido`, `foto`, `sexo`, `porte` são gravadas como `null` (o `sexo` tem `check in ('M','F')`) e lidas como `''`.
- O repositório em memória é a "dublê" do banco nos testes: `gravarRodada` e `removerRodada` reproduzem o que as funções SQL fazem (validar chaves estrangeiras antes de mexer; substituir a rodada; convidados novos com `ordem` nula).
- Testes automáticos nunca falam com o Supabase real nem com a rede; só a Task 7 (controlador) usa o banco real, com dados de teste que ela mesma apaga.
- Nomes de função e variável em português. Comandos rodam dentro de `C:\Users\Heleno\OneDrive\Documentos\GitHub\voleis_VS\.worktrees\terca-supabase-migracao`.

---

### Task 1: Script SQL do ajuste 3, convidados e filtro de jogadores arquivados

**Files:**
- Create: `sql/schema-terca-supabase-ajuste-3.sql`
- Create: `backend/convidados.js`
- Modify: `backend/mapeadores.js` (só o filtro de `mapearJogadores`)
- Test: `tests/backend/convidados.test.mjs`
- Modify: `tests/backend/mapeadores.test.mjs` (um teste novo)

**Interfaces:**
- Produz `nomeDoConvidado(id)` e `coletarConvidados(ids)` em `backend/convidados.js` (`coletarConvidados` devolve `[{ id, nome }]`, sem repetir id, só ids que começam com `convidado:`).
- Produz o arquivo SQL que o usuário executa no Supabase (Task 7): coluna `removido`, sequências de `ordem`, índices únicos e as funções `gravar_rodada(p jsonb)` e `remover_rodada(p_id text)`.
- `mapearJogadores` passa a excluir também `removido = true`.

- [ ] **Step 1: Criar `sql/schema-terca-supabase-ajuste-3.sql`**

```sql
-- Ajuste 3 (etapa 3a): jogador arquivado, ordem dada pelo banco, índices únicos e funções de rodada.
-- Pode ser executado mais de uma vez sem estragar nada.

-- 1) Jogador removido = arquivado: some da lista, mas o histórico (rodadas, check-ins, pagamentos, vínculos) continua válido.
alter table jogadores add column if not exists removido boolean not null default false;

-- 2) A "ordem" das linhas novas vem de uma sequência do banco (nada de ler o maior valor e somar 1 no código).
do $$
declare
  t text;
  seq text;
  maior bigint;
begin
  foreach t in array array['jogadores', 'rodadas', 'checkins', 'usuarios', 'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos'] loop
    seq := 'seq_ordem_' || t;
    execute format('create sequence if not exists %I', seq);
    execute format('select coalesce(max(ordem), 0) from %I', t) into maior;
    -- se a tabela está vazia, o próximo valor é 1; senão, é o maior + 1
    perform setval(seq, greatest(maior, 1), maior > 0);
    execute format('alter table %I alter column ordem set default nextval(%L)', t, seq);
  end loop;
end $$;

-- 3) Um jogador só pode estar vinculado (ou ter pedido de vínculo pendente) a UMA conta.
create unique index if not exists usuarios_jogador_id_unico on usuarios (jogador_id) where jogador_id is not null;
create unique index if not exists usuarios_jogador_id_pendente_unico on usuarios (jogador_id_pendente) where jogador_id_pendente is not null;

-- 4) Salvar uma rodada inteira numa única transação (criar ou substituir).
--    p = { id, data, rascunho, convidados: [{ id, nome }], times: [{ nome, vitorias, vencedor, playerIds: [...] }] }
create or replace function gravar_rodada(p jsonb) returns void
language plpgsql as $$
declare
  v_round_id text := p->>'id';
  v_time jsonb;
  v_idx int;
  v_time_id bigint;
begin
  -- convidados novos entram em jogadores (sem ordem), como na migração
  insert into jogadores (id, nome, convidado, ordem)
  select c->>'id', c->>'nome', true, null
  from jsonb_array_elements(coalesce(p->'convidados', '[]'::jsonb)) as c
  on conflict (id) do nothing;

  -- a versão antiga da rodada (se existir) some por inteiro
  delete from time_jogadores where time_rodada_id in (select id from times_rodada where round_id = v_round_id);
  delete from times_rodada where round_id = v_round_id;
  delete from rodadas where round_id = v_round_id;

  insert into rodadas (round_id, data, rascunho)
  values (v_round_id, (p->>'data')::date, coalesce((p->>'rascunho')::boolean, false));

  for v_time, v_idx in
    select t.value, (t.ordinality - 1)::int from jsonb_array_elements(p->'times') with ordinality as t
  loop
    insert into times_rodada (round_id, time_index, time_nome, vitorias, vencedor)
    values (
      v_round_id, v_idx, v_time->>'nome',
      coalesce((v_time->>'vitorias')::int, 0),
      coalesce((v_time->>'vencedor')::boolean, false)
    )
    returning id into v_time_id;

    insert into time_jogadores (time_rodada_id, jogador_id, posicao)
    select v_time_id, j.value, (j.ordinality - 1)::int
    from jsonb_array_elements_text(coalesce(v_time->'playerIds', '[]'::jsonb)) with ordinality as j
    on conflict do nothing; -- id repetido na mesma lista: vale o primeiro
  end loop;
end;
$$;

-- 5) Remover uma rodada inteira; devolve verdadeiro se ela existia.
create or replace function remover_rodada(p_id text) returns boolean
language plpgsql as $$
begin
  delete from time_jogadores where time_rodada_id in (select id from times_rodada where round_id = p_id);
  delete from times_rodada where round_id = p_id;
  delete from rodadas where round_id = p_id;
  return found;
end;
$$;
```

- [ ] **Step 2: Escrever o teste de `convidados.js` (deve falhar)**

Criar `tests/backend/convidados.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { t, fim } from './executor.mjs';
import { nomeDoConvidado, coletarConvidados } from '../../backend/convidados.js';

t('nomeDoConvidado: pega o nome entre "convidado:" e o "#" final; outros ids dão null', () => {
  assert.equal(nomeDoConvidado('convidado:CAUA#0z6z'), 'CAUA');
  assert.equal(nomeDoConvidado('convidado:VITOR SANTOS#ham8'), 'VITOR SANTOS');
  assert.equal(nomeDoConvidado('convidado:ALLEF (faltou)#ch69'), 'ALLEF (faltou)');
  assert.equal(nomeDoConvidado('p1'), null);
  assert.equal(nomeDoConvidado(''), null);
  assert.equal(nomeDoConvidado(null), null);
});

t('coletarConvidados: só convidados, sem repetir, com nome', () => {
  assert.deepEqual(coletarConvidados(['p1', 'convidado:CAUA#0z6z', '', 'convidado:CAUA#0z6z', 'convidado:IZA#s7k2', null]), [
    { id: 'convidado:CAUA#0z6z', nome: 'CAUA' },
    { id: 'convidado:IZA#s7k2', nome: 'IZA' }
  ]);
  assert.deepEqual(coletarConvidados([]), []);
});

fim();
```

Run: `node tests/backend/convidados.test.mjs` → esperado: erro `Cannot find module` apontando para `backend/convidados.js`.

- [ ] **Step 3: Implementar `backend/convidados.js`**

```javascript
// Ids de convidado têm a forma "convidado:NOME#xxxx"; o nome vem do próprio id (mesma regra da migração).
export function nomeDoConvidado(id) {
  const texto = String(id ?? '');
  if (!texto.startsWith('convidado:')) return null;
  return texto.slice('convidado:'.length).replace(/#[^#]*$/, '').trim();
}

// Recebe uma lista de ids (com repetidos, vazios e ids normais) e devolve os convidados: [{ id, nome }], sem repetir.
export function coletarConvidados(ids) {
  const vistos = new Set();
  const saida = [];
  for (const id of ids) {
    const nome = nomeDoConvidado(id);
    if (nome === null || vistos.has(id)) continue;
    vistos.add(id);
    saida.push({ id: String(id), nome });
  }
  return saida;
}
```

Run: `node tests/backend/convidados.test.mjs` → 2 `ok`, `TODOS OS TESTES PASSARAM`.

- [ ] **Step 4: Teste de `mapearJogadores` com jogador arquivado (deve falhar)**

Em `tests/backend/mapeadores.test.mjs`, acrescentar antes da linha `fim();`:

```javascript
t('jogadores: arquivados (removido) não aparecem em players', () => {
  const dados = structuredClone(fixture.jogadores).concat([
    { id: 'p9', nome: 'Saiu', apelido: null, foto: null, estrelas: 3, sexo: 'M', porte: 'M', convidado: false, removido: true, ordem: 9 }
  ]);
  assert.deepEqual(mapearJogadores(dados).map((p) => p.id), ['p1', 'p2']);
});
```

Run: `node tests/backend/mapeadores.test.mjs` → esperado: 1 `FALHA` (o arquivado aparece).

- [ ] **Step 5: Implementar o filtro**

Em `backend/mapeadores.js`, na função `mapearJogadores`, trocar exatamente `.filter((j) => !j.convidado)` por `.filter((j) => !j.convidado && !j.removido)`. Nada mais muda.

Run: `node tests/backend/mapeadores.test.mjs && node tests/backend/handler.test.mjs && node tests/backend/usuarios.test.mjs` → todos `TODOS OS TESTES PASSARAM`.

- [ ] **Step 6: Commit**

```bash
git add sql/schema-terca-supabase-ajuste-3.sql backend/convidados.js backend/mapeadores.js tests/backend/convidados.test.mjs tests/backend/mapeadores.test.mjs
git commit -m "feat: ajuste 3 do schema (arquivar jogador, sequências, funções de rodada) e convidados (etapa 3a)"
```

---

### Task 2: Primitivas de gravação nos repositórios

**Files:**
- Modify: `backend/repo-memoria.js` (arquivo inteiro substituído)
- Modify: `backend/repo-supabase.js` (novos métodos)
- Modify: `backend/usuarios.js` (só o ramo de inserção de `gravar`)
- Test: `tests/backend/repo-escrita.test.mjs`

**Interfaces:**
- Consome: `TABELAS`, `criarRepoMemoria`, `criarRepoSupabase` (etapas 1 e 2), `lerTabela` (interno de `repo-supabase.js`).
- Produz, nos DOIS repositórios, além dos métodos já existentes (`lerTudo`, `lerUsuarios`, `lerJogadores`, `gravarUsuario`, `removerUsuario`): `inserirJogador(linha)` (falha se o `id` já existe), `atualizarJogador(id, campos)`, `lerConfig()`, `gravarConfig(pares)` (`[{ chave, valor }]`, insere ou atualiza pela chave), `gravarRodada(r)` (`r = { id, data, rascunho, convidados: [{ id, nome }], times: [{ nome, vitorias, vencedor, playerIds }] }`; cria ou substitui) e `removerRodada(id)` (devolve `true` se a rodada existia).

- [ ] **Step 1: Escrever os testes (devem falhar)**

Criar `tests/backend/repo-escrita.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';

const repo = () => criarRepoMemoria(fixture);
const rodada = (extra = {}) => ({
  id: 'r9', data: '2026-09-30', rascunho: false,
  convidados: [{ id: 'convidado:LUCAS#zz01', nome: 'LUCAS' }],
  times: [
    { nome: 'Time 1', vitorias: 2, vencedor: true, playerIds: ['p2', 'p1', 'p2'] },
    { nome: 'Time 2', vitorias: 0, vencedor: false, playerIds: ['convidado:LUCAS#zz01'] }
  ],
  ...extra
});

await ta('inserirJogador: entra no fim com ordem do banco; id repetido falha', async () => {
  const r = repo();
  await r.inserirJogador({ id: 'p7', nome: 'Novo', apelido: null, foto: null, estrelas: 3, sexo: 'M', porte: null });
  const novo = (await r.lerJogadores()).find((j) => j.id === 'p7');
  assert.equal(novo.convidado, false);
  assert.equal(novo.removido, false);
  assert.equal(novo.ordem, 3); // o maior da fixture entre não nulos é 2
  await assert.rejects(() => r.inserirJogador({ id: 'p7', nome: 'Outro' }), /duplicate key/);
});

await ta('atualizarJogador: muda só os campos enviados; id inexistente falha', async () => {
  const r = repo();
  await r.atualizarJogador('p1', { nome: 'Ana Maria', removido: true });
  const p1 = (await r.lerJogadores()).find((j) => j.id === 'p1');
  assert.equal(p1.nome, 'Ana Maria');
  assert.equal(p1.removido, true);
  assert.equal(p1.estrelas, 4);
  await assert.rejects(() => r.atualizarJogador('nao-existe', { nome: 'x' }));
});

await ta('lerConfig/gravarConfig: atualiza chave existente e cria chave nova', async () => {
  const r = repo();
  await r.gravarConfig([{ chave: 'checkinVagas', valor: '20' }, { chave: 'estrelasVisiveis', valor: 'FALSE' }]);
  const c = await r.lerConfig();
  assert.equal(c.find((x) => x.chave === 'checkinVagas').valor, '20');
  assert.equal(c.find((x) => x.chave === 'estrelasVisiveis').valor, 'FALSE');
  assert.equal(c.find((x) => x.chave === 'contadorAcessos').valor, '41');
});

await ta('gravarRodada: cria rodada, times, jogadores por posição (id repetido vale o primeiro) e convidado sem ordem', async () => {
  const r = repo();
  await r.gravarRodada(rodada());
  const t = await r.lerTudo();
  const nova = t.rodadas.find((x) => x.round_id === 'r9');
  assert.deepEqual({ data: nova.data, rascunho: nova.rascunho, ordem: nova.ordem }, { data: '2026-09-30', rascunho: false, ordem: 3 });
  const times = t.times_rodada.filter((x) => x.round_id === 'r9').sort((a, b) => a.time_index - b.time_index);
  assert.deepEqual(times.map((x) => [x.time_index, x.time_nome, x.vitorias, x.vencedor]), [[0, 'Time 1', 2, true], [1, 'Time 2', 0, false]]);
  const doTime0 = t.time_jogadores.filter((x) => x.time_rodada_id === times[0].id).sort((a, b) => a.posicao - b.posicao);
  assert.deepEqual(doTime0.map((x) => [x.jogador_id, x.posicao]), [['p2', 0], ['p1', 1]]);
  const convidado = t.jogadores.find((j) => j.id === 'convidado:LUCAS#zz01');
  assert.deepEqual({ nome: convidado.nome, convidado: convidado.convidado, ordem: convidado.ordem }, { nome: 'LUCAS', convidado: true, ordem: null });
});

await ta('gravarRodada: substitui a rodada existente e ela vai para o fim da lista', async () => {
  const r = repo();
  await r.gravarRodada(rodada({ id: 'r1', data: '2026-09-01' }));
  const t = await r.lerTudo();
  assert.equal(t.rodadas.filter((x) => x.round_id === 'r1').length, 1);
  assert.equal(t.rodadas.find((x) => x.round_id === 'r1').ordem, 3);
  assert.equal(t.times_rodada.filter((x) => x.round_id === 'r1').length, 2);
});

await ta('gravarRodada: jogador que não existe recusa tudo e nada muda (como a chave estrangeira)', async () => {
  const r = repo();
  const antes = await r.lerTudo();
  await assert.rejects(() => r.gravarRodada(rodada({ times: [{ nome: 'T', vitorias: 0, vencedor: false, playerIds: ['nao-existe'] }] })), /foreign key/);
  assert.deepEqual(await r.lerTudo(), antes);
});

await ta('removerRodada: apaga rodada, times e jogadores; devolve se existia', async () => {
  const r = repo();
  assert.equal(await r.removerRodada('r1'), true);
  const t = await r.lerTudo();
  assert.equal(t.rodadas.some((x) => x.round_id === 'r1'), false);
  assert.equal(t.times_rodada.some((x) => x.round_id === 'r1'), false);
  assert.equal(t.time_jogadores.some((x) => x.time_rodada_id === 11 || x.time_rodada_id === 12), false);
  assert.equal(await r.removerRodada('r1'), false);
});

await ta('gravarUsuario: usuário novo sem ordem recebe a ordem do banco (máximo + 1)', async () => {
  const r = repo();
  await r.gravarUsuario({ email: 'n@exemplo.com', nome: 'N', perfil: 'jogador', jogador_id: null, criado_em: '2026-09-23T15:00:00.000Z', jogador_id_pendente: null });
  assert.equal((await r.lerUsuarios()).find((u) => u.email === 'n@exemplo.com').ordem, 4);
});

fim();
```

Run: `node tests/backend/repo-escrita.test.mjs` → esperado: falhas (`inserirJogador is not a function`, etc.).

- [ ] **Step 2: Substituir `backend/repo-memoria.js` pelo conteúdo abaixo**

```javascript
// Repositório em memória: mesma interface do repo-supabase, usado nos testes. Faz o papel do BANCO onde isso
// importa: a "ordem" das linhas novas (no Postgres é o nextval de uma sequência; aqui, máximo + 1) e as funções
// gravar_rodada / remover_rodada (mesma regra: valida as chaves estrangeiras antes de mexer e substitui a rodada).
export const TABELAS = [
  'jogadores', 'rodadas', 'times_rodada', 'time_jogadores', 'checkins', 'config', 'usuarios',
  'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'ao_vivo', 'ao_vivo_log'
];

const COM_ORDEM = ['jogadores', 'rodadas', 'checkins', 'usuarios', 'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos'];

export function criarRepoMemoria(dados = {}) {
  const tabelas = {};
  for (const nome of TABELAS) tabelas[nome] = (dados[nome] || []).map((linha) => ({ ...linha }));

  // padrão da coluna "ordem": só quando a chave nem foi enviada (um `ordem: null` explícito continua nulo)
  function inserir(tabela, linha) {
    const nova = { ...linha };
    if (COM_ORDEM.includes(tabela) && !('ordem' in nova)) {
      nova.ordem = tabelas[tabela].reduce((m, x) => Math.max(m, x.ordem ?? 0), 0) + 1;
    }
    tabelas[tabela].push(nova);
    return nova;
  }

  function apagarRodada(id) {
    const idsTimes = tabelas.times_rodada.filter((t) => t.round_id === id).map((t) => t.id);
    const existia = tabelas.rodadas.some((r) => r.round_id === id);
    tabelas.time_jogadores = tabelas.time_jogadores.filter((x) => !idsTimes.includes(x.time_rodada_id));
    tabelas.times_rodada = tabelas.times_rodada.filter((t) => t.round_id !== id);
    tabelas.rodadas = tabelas.rodadas.filter((r) => r.round_id !== id);
    return existia;
  }

  return {
    tabelas,
    async lerTudo() { return structuredClone(tabelas); },
    async lerUsuarios() { return structuredClone(tabelas.usuarios); },
    async lerJogadores() { return structuredClone(tabelas.jogadores); },

    // insere ou atualiza pela chave email; numa atualização, só os campos enviados mudam
    async gravarUsuario(linha) {
      const i = tabelas.usuarios.findIndex((u) => u.email === linha.email);
      if (i === -1) inserir('usuarios', linha);
      else tabelas.usuarios[i] = { ...tabelas.usuarios[i], ...linha };
    },
    async removerUsuario(email) { tabelas.usuarios = tabelas.usuarios.filter((u) => u.email !== email); },

    async inserirJogador(linha) {
      if (tabelas.jogadores.some((j) => j.id === linha.id)) {
        throw new Error('duplicate key value violates unique constraint "jogadores_pkey"');
      }
      inserir('jogadores', { convidado: false, removido: false, ...linha });
    },
    async atualizarJogador(id, campos) {
      const i = tabelas.jogadores.findIndex((j) => j.id === id);
      if (i === -1) throw new Error('jogador não encontrado');
      tabelas.jogadores[i] = { ...tabelas.jogadores[i], ...campos };
    },

    async lerConfig() { return structuredClone(tabelas.config); },
    async gravarConfig(pares) {
      for (const par of pares) {
        const i = tabelas.config.findIndex((c) => c.chave === par.chave);
        if (i === -1) tabelas.config.push({ ...par });
        else tabelas.config[i] = { ...tabelas.config[i], ...par };
      }
    },

    async gravarRodada(r) {
      const existentes = new Set([...tabelas.jogadores.map((j) => j.id), ...(r.convidados || []).map((c) => c.id)]);
      for (const time of r.times) {
        for (const id of time.playerIds) {
          if (!existentes.has(id)) throw new Error('insert or update on table "time_jogadores" violates foreign key constraint "time_jogadores_jogador_id_fkey"');
        }
      }
      for (const c of r.convidados || []) {
        if (!tabelas.jogadores.some((j) => j.id === c.id)) {
          tabelas.jogadores.push({ id: c.id, nome: c.nome, apelido: null, foto: null, estrelas: null, sexo: null, porte: null, convidado: true, removido: false, ordem: null });
        }
      }
      apagarRodada(r.id);
      inserir('rodadas', { round_id: r.id, data: r.data, rascunho: r.rascunho });
      r.times.forEach((time, idx) => {
        const id = tabelas.times_rodada.reduce((m, x) => Math.max(m, x.id), 0) + 1;
        tabelas.times_rodada.push({ id, round_id: r.id, time_index: idx, time_nome: time.nome, vitorias: time.vitorias, vencedor: time.vencedor });
        const vistos = new Set();
        time.playerIds.forEach((jogador, posicao) => {
          if (vistos.has(jogador)) return; // id repetido na mesma lista: vale o primeiro
          vistos.add(jogador);
          tabelas.time_jogadores.push({ time_rodada_id: id, jogador_id: jogador, posicao });
        });
      });
    },
    async removerRodada(id) { return apagarRodada(id); }
  };
}
```

- [ ] **Step 3: Rodar os testes do repositório e os antigos**

Run: `node tests/backend/repo-escrita.test.mjs && node tests/backend/repo.test.mjs && node tests/backend/usuarios.test.mjs && node tests/backend/handler-post.test.mjs && node tests/backend/handler.test.mjs`
Expected: todos terminam com `TODOS OS TESTES PASSARAM` (o `repo.test.mjs` antigo continua valendo).

- [ ] **Step 4: `usuarios.js` deixa de calcular a `ordem`**

Em `backend/usuarios.js`, na função `gravar`, o ramo de inserção hoje é:

```javascript
  } else {
    const maior = brutos.reduce((m, x) => Math.max(m, x.ordem ?? 0), 0);
    await repo.gravarUsuario({ ...linha, email, criado_em: relogio().toISOString(), ordem: maior + 1 });
  }
```

Trocar por (a `ordem` passa a ser do banco):

```javascript
  } else {
    // a "ordem" da linha nova vem do banco (sequência); no repositório em memória é máximo + 1
    await repo.gravarUsuario({ ...linha, email, criado_em: relogio().toISOString() });
  }
```

Atualizar também o comentário de cabeçalho de `gravar` se citar "máximo + 1". Run: `node tests/backend/usuarios.test.mjs && node tests/backend/paridade-usuarios.test.mjs` → ambos `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Novos métodos em `backend/repo-supabase.js`**

No objeto retornado por `criarRepoSupabase`, junto dos outros métodos, acrescentar:

```javascript
    async inserirJogador(linha) {
      const { error } = await cliente.from('jogadores').insert(linha);
      if (error) throw new Error('jogadores: ' + error.message);
    },
    async atualizarJogador(id, campos) {
      const { error } = await cliente.from('jogadores').update(campos).eq('id', id);
      if (error) throw new Error('jogadores: ' + error.message);
    },
    async lerConfig() { return lerTabela(cliente, 'config'); },
    async gravarConfig(pares) {
      const { error } = await cliente.from('config').upsert(pares);
      if (error) throw new Error('config: ' + error.message);
    },
    // a rodada inteira é gravada por uma função do banco (uma transação só); ver sql/schema-terca-supabase-ajuste-3.sql
    async gravarRodada(r) {
      const { error } = await cliente.rpc('gravar_rodada', { p: r });
      if (error) throw new Error('gravar_rodada: ' + error.message);
    },
    async removerRodada(id) {
      const { data, error } = await cliente.rpc('remover_rodada', { p_id: id });
      if (error) throw new Error('remover_rodada: ' + error.message);
      return data === true;
    }
```

Validar: `node --check backend/repo-supabase.js backend/repo-memoria.js` e `grep -nE "node:|process\.|require\(|supabase-js" backend/repo-supabase.js backend/repo-memoria.js` (sem nenhuma linha). Não rodar nada contra o banco real (a Task 7 faz isso).

- [ ] **Step 6: Commit**

```bash
git add backend/repo-memoria.js backend/repo-supabase.js backend/usuarios.js tests/backend/repo-escrita.test.mjs
git commit -m "feat: primitivas de escrita de jogadores, configuração e rodadas nos repositórios (etapa 3a)"
```

---

### Task 3: Regras de jogadores e configurações

**Files:**
- Create: `backend/jogadores.js`
- Create: `backend/configuracoes.js`
- Test: `tests/backend/jogadores-config.test.mjs`

**Interfaces:**
- Consome: `mapearJogadores`, `mapearConfig`, `texto`, `CHECKIN_MENSAGEM_PADRAO` (etapa 1; `texto` e `CHECKIN_MENSAGEM_PADRAO` são exportados por `backend/mapeadores.js`), as primitivas da Task 2.
- Produz (todas assíncronas, `deps = { repo, ... }`): `addPlayer(deps, p)`, `updatePlayer(deps, p)`, `removePlayer(deps, id)` em `backend/jogadores.js`; `saveSettings(deps, settings)` em `backend/configuracoes.js`. Todas devolvem `{ status: 'ok' }` ou `{ error }` com as mensagens do `.gs`.

- [ ] **Step 1: Escrever os testes (devem falhar)**

Criar `tests/backend/jogadores-config.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { addPlayer, updatePlayer, removePlayer } from '../../backend/jogadores.js';
import { saveSettings } from '../../backend/configuracoes.js';
import { mapearJogadores, mapearConfig } from '../../backend/mapeadores.js';

const deps = () => ({ repo: criarRepoMemoria(fixture) });
const ativos = async (d) => mapearJogadores(await d.repo.lerJogadores());

await ta('addPlayer: grava com os campos vazios como null e estrelas numérica; aparece no fim de players', async () => {
  const d = deps();
  assert.deepEqual(await addPlayer(d, { id: 'p5', nome: 'Diego', estrelas: '3.5', sexo: 'M', porte: 'G' }), { status: 'ok' });
  const bruto = (await d.repo.lerJogadores()).find((j) => j.id === 'p5');
  assert.deepEqual({ apelido: bruto.apelido, foto: bruto.foto, estrelas: bruto.estrelas, sexo: bruto.sexo, porte: bruto.porte, convidado: bruto.convidado, removido: bruto.removido }, { apelido: null, foto: null, estrelas: 3.5, sexo: 'M', porte: 'G', convidado: false, removido: false });
  assert.deepEqual((await ativos(d)).map((p) => p.id), ['p1', 'p2', 'p5']);
});

await ta('addPlayer: sem id ou com id repetido devolve erro', async () => {
  const d = deps();
  assert.deepEqual(await addPlayer(d, {}), { error: 'Jogador sem id.' });
  assert.deepEqual(await addPlayer(d, null), { error: 'Jogador sem id.' });
  assert.deepEqual(await addPlayer(d, { id: 'p1', nome: 'X' }), { error: 'Já existe um jogador com esse id.' });
});

await ta('updatePlayer: sobrescreve os 6 campos; jogador inexistente dá a mensagem do .gs', async () => {
  const d = deps();
  assert.deepEqual(await updatePlayer(d, { id: 'p1', nome: 'Ana Maria', apelido: 'Aninha', foto: 'https://x/f.jpg', estrelas: 5, sexo: 'F', porte: 'M' }), { status: 'ok' });
  const p1 = (await ativos(d)).find((p) => p.id === 'p1');
  assert.deepEqual(p1, { id: 'p1', nome: 'Ana Maria', apelido: 'Aninha', foto: 'https://x/f.jpg', estrelas: 5, sexo: 'F', porte: 'M' });
  assert.deepEqual(await updatePlayer(d, { id: 'nao-existe', nome: 'X' }), { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' });
  assert.deepEqual(await updatePlayer(d, { id: 'convidado:LUCAS#ab12', nome: 'X' }), { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' });
});

await ta('removePlayer: arquiva (some de players, o histórico fica); repetir ou inexistente dá a mensagem do .gs', async () => {
  const d = deps();
  assert.deepEqual(await removePlayer(d, 'p1'), { status: 'ok' });
  assert.deepEqual((await ativos(d)).map((p) => p.id), ['p2']);
  const bruto = (await d.repo.lerJogadores()).find((j) => j.id === 'p1');
  assert.equal(bruto.removido, true);
  assert.equal((await d.repo.lerTudo()).time_jogadores.some((x) => x.jogador_id === 'p1'), true); // o histórico das rodadas continua
  assert.deepEqual(await removePlayer(d, 'p1'), { error: 'Jogador não encontrado (pode já ter sido removido por outra pessoa).' });
  assert.deepEqual(await removePlayer(d, 'xx'), { error: 'Jogador não encontrado (pode já ter sido removido por outra pessoa).' });
  assert.deepEqual(await updatePlayer(d, { id: 'p1', nome: 'x' }), { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' });
});

await ta('saveSettings: grava as 7 chaves como o writeSettings do .gs e preserva o contador de acessos', async () => {
  const d = deps();
  assert.deepEqual(await saveSettings(d, { estrelasVisiveis: false, checkinDataAberta: '2026-10-06', checkinTravado: true, checkinVagas: 14, checkinHorario: '21:00', checkinMensagemTemplate: 'Oi {vagas}', contadorAcessos: 9999 }), { status: 'ok' });
  const c = mapearConfig(await d.repo.lerConfig());
  assert.deepEqual(c, { estrelasVisiveis: false, checkinDataAberta: '2026-10-06', checkinTravado: true, checkinVagas: 14, checkinHorario: '21:00', checkinMensagemTemplate: 'Oi {vagas}', contadorAcessos: 41 });
});

await ta('saveSettings: chaves ausentes viram os padrões do .gs (estrelasVisiveis vira FALSE)', async () => {
  const d = deps();
  await saveSettings(d, {});
  const bruto = Object.fromEntries((await d.repo.lerConfig()).map((x) => [x.chave, x.valor]));
  assert.equal(bruto.estrelasVisiveis, 'FALSE');
  assert.equal(bruto.checkinTravado, 'FALSE');
  assert.equal(bruto.checkinVagas, '16');
  assert.equal(bruto.checkinHorario, '20:00');
  assert.equal(bruto.checkinDataAberta, '');
  assert.equal(bruto.contadorAcessos, '41');
});

fim();
```

Run: `node tests/backend/jogadores-config.test.mjs` → esperado: `Cannot find module` (`backend/jogadores.js`).

- [ ] **Step 2: Implementar `backend/jogadores.js`**

```javascript
// Cadastro de jogadores. Port de addPlayer, updatePlayer e removePlayer de apps-script-codigo.gs (mesmas mensagens).
// "Remover" ARQUIVA o jogador (coluna removido): ele some de players, como acontece hoje, mas o histórico que aponta
// para ele (rodadas, check-ins, pagamentos, vínculos) continua válido no banco.
import { mapearJogadores, texto } from './mapeadores.js';

// os 6 campos que o .gs sobrescreve; vazios viram null (sexo tem check M/F) e são lidos de volta como ''
function campos(p) {
  return {
    nome: texto(p.nome),
    apelido: texto(p.apelido) || null,
    foto: texto(p.foto) || null,
    estrelas: Number(p.estrelas) || 0,
    sexo: texto(p.sexo) || null,
    porte: texto(p.porte) || null
  };
}

const ativos = async (repo) => mapearJogadores(await repo.lerJogadores());

export async function addPlayer({ repo }, p) {
  if (!p || !texto(p.id)) return { error: 'Jogador sem id.' };
  if ((await repo.lerJogadores()).some((j) => j.id === texto(p.id))) return { error: 'Já existe um jogador com esse id.' };
  await repo.inserirJogador({ id: texto(p.id), ...campos(p) });
  return { status: 'ok' };
}

export async function updatePlayer({ repo }, p) {
  const id = texto(p && p.id);
  if (!(await ativos(repo)).some((j) => j.id === id)) {
    return { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' };
  }
  await repo.atualizarJogador(id, campos(p));
  return { status: 'ok' };
}

export async function removePlayer({ repo }, id) {
  const alvo = texto(id);
  if (!(await ativos(repo)).some((j) => j.id === alvo)) {
    return { error: 'Jogador não encontrado (pode já ter sido removido por outra pessoa).' };
  }
  await repo.atualizarJogador(alvo, { removido: true });
  return { status: 'ok' };
}
```

- [ ] **Step 3: Implementar `backend/configuracoes.js`**

```javascript
// Configurações do app. Port de saveSettingsAction/writeSettings de apps-script-codigo.gs: as 7 chaves, com a mesma
// formatação (TRUE/FALSE, valores padrão). O contador de acessos nunca é sobrescrito por uma gravação de configuração
// (o navegador do admin pode ter um valor desatualizado).
import { mapearConfig, texto, CHECKIN_MENSAGEM_PADRAO } from './mapeadores.js';

export async function saveSettings({ repo }, settings) {
  const s = settings || {};
  const atual = mapearConfig(await repo.lerConfig());
  await repo.gravarConfig([
    { chave: 'estrelasVisiveis', valor: s.estrelasVisiveis ? 'TRUE' : 'FALSE' },
    { chave: 'checkinDataAberta', valor: texto(s.checkinDataAberta) },
    { chave: 'checkinTravado', valor: s.checkinTravado ? 'TRUE' : 'FALSE' },
    { chave: 'checkinVagas', valor: String(s.checkinVagas || 16) },
    { chave: 'checkinHorario', valor: String(s.checkinHorario || '20:00') },
    { chave: 'checkinMensagemTemplate', valor: String(s.checkinMensagemTemplate || CHECKIN_MENSAGEM_PADRAO) },
    { chave: 'contadorAcessos', valor: String(atual.contadorAcessos || 0) }
  ]);
  return { status: 'ok' };
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `node tests/backend/jogadores-config.test.mjs` → 6 `ok`, `TODOS OS TESTES PASSARAM`. Purity: `grep -nE "node:|process\.|require\(" backend/jogadores.js backend/configuracoes.js` (nada). Se um teste falhar depois de copiar exatamente, não alterar as expectativas: reportar a falha exata.

- [ ] **Step 5: Commit**

```bash
git add backend/jogadores.js backend/configuracoes.js tests/backend/jogadores-config.test.mjs
git commit -m "feat: regras de jogadores (arquivar em vez de apagar) e configurações (etapa 3a)"
```

---

### Task 4: Regras de rodadas

**Files:**
- Create: `backend/rodadas.js`
- Test: `tests/backend/rodadas.test.mjs`

**Interfaces:**
- Consome: `coletarConvidados` (Task 1), `texto` (etapa 1), `gravarRodada`/`removerRodada` (Task 2), `mapearRodadas` (etapa 1, nos testes).
- Produz `addRound(deps, r)`, `updateRound(deps, r)`, `removeRound(deps, id)` em `backend/rodadas.js`. `r` tem a forma do app: `{ id, data, rascunho, vencedores: [índices], times: [{ nome, vitorias, playerIds }] }`.

- [ ] **Step 1: Escrever os testes (devem falhar)**

Criar `tests/backend/rodadas.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { addRound, updateRound, removeRound } from '../../backend/rodadas.js';
import { mapearRodadas } from '../../backend/mapeadores.js';

const deps = () => ({ repo: criarRepoMemoria(fixture) });
const rodadas = async (d) => { const t = await d.repo.lerTudo(); return mapearRodadas(t.rodadas, t.times_rodada, t.time_jogadores); };
const r9 = () => ({
  id: 'r9', data: '2026-09-30', rascunho: true, vencedores: [0, 1],
  times: [
    { nome: 'Time A', vitorias: 3, playerIds: ['p1', 'convidado:LUCAS#zz01'] },
    { nome: 'Time B', vitorias: '3', playerIds: ['p2', ''] }
  ]
});

await ta('addRound: cria a rodada no fim com times, vencedores (empate), rascunho e convidado novo', async () => {
  const d = deps();
  assert.deepEqual(await addRound(d, r9()), { status: 'ok' });
  const todas = await rodadas(d);
  assert.deepEqual(todas.map((r) => r.id), ['r1', 'r2', 'r9']);
  assert.deepEqual(todas[2], {
    id: 'r9', data: '2026-09-30', rascunho: true, vencedores: [0, 1],
    times: [{ nome: 'Time A', playerIds: ['p1', 'convidado:LUCAS#zz01'], vitorias: 3 }, { nome: 'Time B', playerIds: ['p2'], vitorias: 3 }]
  });
  const convidado = (await d.repo.lerJogadores()).find((j) => j.id === 'convidado:LUCAS#zz01');
  assert.deepEqual({ nome: convidado.nome, convidado: convidado.convidado }, { nome: 'LUCAS', convidado: true });
});

await ta('addRound: rodada sem times não deixa rastro (como no .gs)', async () => {
  const d = deps();
  assert.deepEqual(await addRound(d, { id: 'r8', data: '2026-09-30', times: [] }), { status: 'ok' });
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r1', 'r2']);
});

await ta('updateRound: troca o conteúdo e leva a rodada para o fim; id novo cria; sem times remove', async () => {
  const d = deps();
  assert.deepEqual(await updateRound(d, { id: 'r1', data: '2026-09-01', vencedores: [1], times: [{ nome: 'X', vitorias: 1, playerIds: ['p2'] }, { nome: 'Y', vitorias: 4, playerIds: ['p1'] }] }), { status: 'ok' });
  let todas = await rodadas(d);
  assert.deepEqual(todas.map((r) => r.id), ['r2', 'r1']);
  assert.deepEqual(todas[1].vencedores, [1]);
  assert.deepEqual(todas[1].times.map((t) => t.nome), ['X', 'Y']);
  await updateRound(d, { id: 'novo', data: '2026-10-01', times: [{ nome: 'Z', vitorias: 0, playerIds: [] }] });
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r2', 'r1', 'novo']);
  await updateRound(d, { id: 'r2', data: '2026-09-08', times: [] });
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r1', 'novo']);
});

await ta('removeRound: remove; repetir ou inexistente dá a mensagem do .gs', async () => {
  const d = deps();
  assert.deepEqual(await removeRound(d, 'r1'), { status: 'ok' });
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r2']);
  assert.deepEqual(await removeRound(d, 'r1'), { error: 'Rodada não encontrada (pode já ter sido removida por outra pessoa).' });
});

await ta('addRound com jogador inexistente: a falha vem do repositório e nada é gravado', async () => {
  const d = deps();
  await assert.rejects(() => addRound(d, { id: 'rx', data: '2026-09-30', times: [{ nome: 'T', vitorias: 0, playerIds: ['nao-existe'] }] }), /foreign key/);
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r1', 'r2']);
});

fim();
```

Run: `node tests/backend/rodadas.test.mjs` → esperado: `Cannot find module` (`backend/rodadas.js`).

- [ ] **Step 2: Implementar `backend/rodadas.js`**

```javascript
// Rodadas. Port de addRound, updateRound e removeRound de apps-script-codigo.gs.
// Salvar é UMA operação do repositório (no banco, uma função que roda numa transação só): cria a rodada, os times
// e os jogadores de cada time, e cria os convidados novos. Editar apaga a versão antiga e grava a nova, então a rodada
// editada vai para o FIM da lista (como no .gs, que apaga as linhas e insere de novo no fim).
import { texto } from './mapeadores.js';
import { coletarConvidados } from './convidados.js';

const NAO_ACHOU = 'Rodada não encontrada (pode já ter sido removida por outra pessoa).';

// até 2 times podem empatar e virar campeões juntos: "vencedor" é uma marca por time
function montar(r) {
  const vencedores = Array.isArray(r.vencedores) ? r.vencedores : [];
  const times = (r.times || []).map((t, idx) => ({
    nome: texto(t.nome),
    vitorias: Number(t.vitorias) || 0,
    vencedor: vencedores.indexOf(idx) !== -1,
    playerIds: (t.playerIds || []).map(texto).filter(Boolean)
  }));
  return {
    id: texto(r.id),
    data: texto(r.data),
    rascunho: !!r.rascunho,
    times,
    convidados: coletarConvidados(times.flatMap((t) => t.playerIds))
  };
}

// no .gs uma rodada sem times não deixa nenhuma linha na aba
export async function addRound({ repo }, r) {
  const rodada = montar(r || {});
  if (rodada.times.length) await repo.gravarRodada(rodada);
  return { status: 'ok' };
}

export async function updateRound({ repo }, r) {
  const rodada = montar(r || {});
  if (rodada.times.length) await repo.gravarRodada(rodada);
  else await repo.removerRodada(rodada.id);
  return { status: 'ok' };
}

export async function removeRound({ repo }, id) {
  return (await repo.removerRodada(texto(id))) ? { status: 'ok' } : { error: NAO_ACHOU };
}
```

- [ ] **Step 3: Rodar — deve passar**

Run: `node tests/backend/rodadas.test.mjs` → 5 `ok`, `TODOS OS TESTES PASSARAM`. Purity: `grep -nE "node:|process\.|require\(" backend/rodadas.js` (nada). Se um teste falhar depois de copiar exatamente, não alterar as expectativas: reportar a falha exata.

- [ ] **Step 4: Commit**

```bash
git add backend/rodadas.js tests/backend/rodadas.test.mjs
git commit -m "feat: regras de rodadas (salvar, editar levando para o fim, remover) (etapa 3a)"
```

---

### Task 5: Exceção da foto no porteiro e roteamento no handler

**Files:**
- Modify: `backend/porteiro.js` (arquivo inteiro substituído)
- Modify: `backend/handler.js` (imports e novos `case`)
- Modify: `tests/backend/handler.test.mjs` (4º teste)
- Modify: `tests/backend/handler-post.test.mjs` (um teste)
- Test: `tests/backend/handler-etapa3a.test.mjs`

**Interfaces:**
- Consome: `addPlayer`, `updatePlayer`, `removePlayer` (Task 3), `saveSettings` (Task 3), `addRound`, `updateRound`, `removeRound` (Task 4), `mapearJogadores`, `texto` (etapa 1).
- Produz: o `post` do handler passa a rotear as 8 ações; o porteiro aceita a exceção "jogador troca só a própria foto".

- [ ] **Step 1: Escrever os testes novos (devem falhar)**

Criar `tests/backend/handler-etapa3a.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const AGORA = new Date('2026-09-23T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin, vinculado a p1
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },   // organizador, vinculado a p2
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }    // jogador, sem vínculo
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });

function novo() {
  const dados = structuredClone(fixture);
  // c passa a ser jogador vinculado a p3 (para a exceção da foto)
  dados.jogadores.push({ id: 'p3', nome: 'Carla', apelido: 'Carlinha', foto: '', estrelas: 3, sexo: 'F', porte: 'M', convidado: false, removido: false, ordem: 3 });
  dados.usuarios.find((u) => u.email === 'c@exemplo.com').jogador_id = 'p3';
  const repo = criarRepoMemoria(dados);
  return { repo, h: criarHandler({ repo, config: { adminPassword: 'chave-de-teste' }, verificarToken, relogio: () => AGORA }) };
}

await ta('organizador cadastra, edita e o admin arquiva um jogador; o GET reflete cada passo', async () => {
  const { h } = novo();
  assert.deepEqual(await h.post({ action: 'addPlayer', idToken: 'tok-b', player: { id: 'p7', nome: 'Diego', estrelas: 4, sexo: 'M', porte: 'G' } }), { status: 'ok' });
  assert.ok((await h.get()).players.some((p) => p.id === 'p7'));
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-b', player: { id: 'p7', nome: 'Diego S', estrelas: 5, sexo: 'M', porte: 'G' } }), { status: 'ok' });
  assert.equal((await h.get()).players.find((p) => p.id === 'p7').nome, 'Diego S');
  assert.deepEqual(await h.post({ action: 'removePlayer', idToken: 'tok-b', id: 'p7' }), { error: 'Seu perfil (organizador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'removePlayer', idToken: 'tok-a', id: 'p7' }), { status: 'ok' });
  assert.equal((await h.get()).players.some((p) => p.id === 'p7'), false);
});

await ta('rodadas: organizador salva e edita; só o admin remove', async () => {
  const { h } = novo();
  const rodada = { id: 'r9', data: '2026-09-30', rascunho: false, vencedores: [0], times: [{ nome: 'A', vitorias: 2, playerIds: ['p1'] }, { nome: 'B', vitorias: 1, playerIds: ['p2'] }] };
  assert.deepEqual(await h.post({ action: 'addRound', idToken: 'tok-b', round: rodada }), { status: 'ok' });
  assert.deepEqual((await h.get()).rounds.map((r) => r.id), ['r1', 'r2', 'r9']);
  assert.deepEqual(await h.post({ action: 'updateRound', idToken: 'tok-b', round: { ...rodada, data: '2026-10-01' } }), { status: 'ok' });
  assert.equal((await h.get()).rounds.at(-1).data, '2026-10-01');
  assert.deepEqual(await h.post({ action: 'removeRound', idToken: 'tok-b', id: 'r9' }), { error: 'Seu perfil (organizador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'removeRound', senha: 'chave-de-teste', id: 'r9' }), { status: 'ok' });
  assert.deepEqual((await h.get()).rounds.map((r) => r.id), ['r1', 'r2']);
});

await ta('configurações: saveSettings só admin; saveCheckinSettings organizador também', async () => {
  const { h } = novo();
  const settings = { estrelasVisiveis: true, checkinDataAberta: '2026-10-06', checkinTravado: true, checkinVagas: 12, checkinHorario: '20:30', checkinMensagemTemplate: 'x' };
  assert.deepEqual(await h.post({ action: 'saveSettings', idToken: 'tok-b', settings }), { error: 'Seu perfil (organizador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'saveCheckinSettings', idToken: 'tok-b', settings }), { status: 'ok' });
  assert.equal((await h.get()).settings.checkinTravado, true);
  assert.equal((await h.get()).settings.contadorAcessos, 41);
  assert.deepEqual(await h.post({ action: 'saveSettings', idToken: 'tok-a', settings: { ...settings, estrelasVisiveis: false } }), { status: 'ok' });
  assert.equal((await h.get()).settings.estrelasVisiveis, false);
});

await ta('exceção da foto: jogador vinculado troca só a foto; qualquer outro campo, outro jogador ou perfil sem vínculo é negado', async () => {
  const { h } = novo();
  const igual = { id: 'p3', nome: 'Carla', apelido: 'Carlinha', estrelas: 3, sexo: 'F', porte: 'M' };
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { ...igual, foto: 'https://x/nova.jpg' } }), { status: 'ok' });
  assert.equal((await h.get()).players.find((p) => p.id === 'p3').foto, 'https://x/nova.jpg');
  const negado = { error: 'Seu perfil (jogador) não tem permissão para esta ação.' };
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { ...igual, estrelas: 5 } }), negado);
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { ...igual, nome: 'Outra' } }), negado);
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { id: 'p1', nome: 'Ana', estrelas: 4, sexo: 'F', porte: 'P' } }), negado);
  assert.deepEqual(await h.post({ action: 'addPlayer', idToken: 'tok-c', player: { id: 'p8', nome: 'X' } }), negado);
});

await ta('exceção da foto: conta sem vínculo é negada', async () => {
  const { h, repo } = novo();
  await repo.gravarUsuario({ email: 'c@exemplo.com', jogador_id: null });
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { id: 'p3', nome: 'Carla', apelido: 'Carlinha', estrelas: 3, sexo: 'F', porte: 'M', foto: 'x' } }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
});

fim();
```

Run: `node tests/backend/handler-etapa3a.test.mjs` → esperado: falhas (as ações ainda respondem "não disponível").

- [ ] **Step 2: Substituir `backend/porteiro.js` pelo conteúdo abaixo**

```javascript
// Porteiro único das ações sensíveis. Ordem (igual ao autorizar_ do .gs):
//   1. senha === chave mestra  -> entra como admin (emergência / bootstrap)
//   2. ID Token válido         -> e-mail -> perfil na tabela usuarios -> confere a matriz
//   3. nada disso              -> nega
import { PERMISSOES } from './permissoes.js';
import { iguaisSeguros } from './auth.js';
import { lerUsuarios } from './usuarios.js';
import { mapearJogadores, texto } from './mapeadores.js';

// Única exceção da matriz: um 'jogador' pode mexer no cadastro DELE mesmo, e só para trocar/remover a foto.
// Compara o que chegou com o que já está gravado e só libera se TODO o resto (nome, apelido, estrelas, sexo, porte)
// estiver igualzinho; senão um jogador comum se daria 5 estrelas sozinho.
async function excecaoPropriaFoto(repo, jogadorIdDaConta, body) {
  if (String(body.action) !== 'updatePlayer' || !body.player) return false;
  if (!jogadorIdDaConta || String(jogadorIdDaConta) !== String(body.player.id)) return false;

  const atual = mapearJogadores(await repo.lerJogadores()).find((p) => String(p.id) === String(body.player.id));
  if (!atual) return false;

  const p = body.player;
  return texto(p.nome) === atual.nome
    && texto(p.apelido) === atual.apelido
    && Number(p.estrelas || 0) === atual.estrelas
    && texto(p.sexo) === atual.sexo
    && texto(p.porte) === atual.porte;
}

export async function autorizar({ repo, config, verificarToken }, body) {
  const acao = String(body.action || '');
  if (!Object.hasOwn(PERMISSOES, acao)) return { error: 'Ação desconhecida: ' + acao };
  const permitidos = PERMISSOES[acao];

  // 1) chave mestra — continua valendo em paralelo ao login do Google
  if (body.senha) {
    if (config.adminPassword && iguaisSeguros(body.senha, config.adminPassword)) {
      return { ok: true, perfil: 'admin', email: '', nome: '', jogadorId: '', viaChaveMestra: true };
    }
    // senha errada E sem token: a mensagem que o app já reconhece para limpar a senha guardada
    if (!body.idToken) return { error: 'Senha de administrador incorreta.' };
    // senha errada mas com token: ignora a senha e tenta pelo token
  }

  // 2) token do Google
  const token = await verificarToken(body.idToken);
  if (!token.ok) return { error: token.erro };

  const usuario = (await lerUsuarios(repo)).find((u) => u.email === token.email);
  const perfil = (usuario && usuario.perfil) || 'jogador'; // e-mail desconhecido = jogador
  const jogadorId = usuario ? usuario.jogadorId : '';
  if (!permitidos.includes(perfil)) {
    if (await excecaoPropriaFoto(repo, jogadorId, body)) {
      return { ok: true, perfil, email: token.email, nome: token.nome, jogadorId, viaChaveMestra: false };
    }
    return { error: 'Seu perfil (' + perfil + ') não tem permissão para esta ação.' };
  }

  return { ok: true, perfil, email: token.email, nome: token.nome, jogadorId, viaChaveMestra: false };
}
```

- [ ] **Step 3: Editar `backend/handler.js`**

(a) Depois do import de `./usuarios.js`, acrescentar:

```javascript
import { addPlayer, updatePlayer, removePlayer } from './jogadores.js';
import { addRound, updateRound, removeRound } from './rodadas.js';
import { saveSettings } from './configuracoes.js';
```

(b) No `switch (acao)` do `post`, logo antes da linha `default: return naoDisponivel(acao);`, acrescentar:

```javascript
          case 'addPlayer': return await addPlayer(deps, b.player);
          case 'updatePlayer': return await updatePlayer(deps, b.player);
          case 'removePlayer': return await removePlayer(deps, b.id);
          case 'addRound': return await addRound(deps, b.round);
          case 'updateRound': return await updateRound(deps, b.round);
          case 'removeRound': return await removeRound(deps, b.id);
          case 'saveSettings':
          case 'saveCheckinSettings': return await saveSettings(deps, b.settings);
```

Nada mais no arquivo muda.

- [ ] **Step 4: Ajustar dois testes antigos que usavam `addPlayer` como "ação ainda não portada"**

Em `tests/backend/handler.test.mjs`, no teste `'post de ação ainda não portada: erro claro com o nome da ação'`, trocar `addPlayer` por `marcarPagamento` (nas duas linhas: o `post({ action: ... , senha: 'chave-de-teste' })` e o `assert.match(r.error, /.../)`).

Em `tests/backend/handler-post.test.mjs`, no teste `'ação da matriz ainda não portada: passa pelo porteiro e depois avisa'`, trocar as duas ocorrências de `addPlayer` por `marcarPagamento` (a mensagem esperada passa a citar `(marcarPagamento)`; o perfil `jogador` continua negado).

- [ ] **Step 5: Rodar tudo — deve passar**

Run: `node tests/backend/handler-etapa3a.test.mjs && node tests/backend/handler-post.test.mjs && node tests/backend/handler.test.mjs && node tests/backend/usuarios.test.mjs && node tests/backend/paridade-usuarios.test.mjs && node tests/backend/permissoes.test.mjs`
Expected: todos `TODOS OS TESTES PASSARAM`. Purity: `grep -nE "node:|process\.|require\(" backend/porteiro.js backend/handler.js` (nada).

- [ ] **Step 6: Commit**

```bash
git add backend/porteiro.js backend/handler.js tests/backend/handler.test.mjs tests/backend/handler-post.test.mjs tests/backend/handler-etapa3a.test.mjs
git commit -m "feat: exceção da foto no porteiro e roteamento das ações de jogadores, rodadas e configurações (etapa 3a)"
```

---

### Task 6: Teste diferencial contra o `.gs` real

**Files:**
- Test: `tests/backend/paridade-jogadores-rodadas.test.mjs`

**Interfaces:**
- Consome: `criarAmbiente` (`tests/helpers/planilha-falsa.js`), `dbParaAbas` e `fixture` (etapa 1), `criarRepoMemoria`, `criarHandler`, `criarVerificadorGoogle`.
- Produz: prova de que, para a mesma sequência de pedidos, o `.gs` real e o backend novo respondem igual **e** o `GET` completo dos dois é idêntico depois de cada passo de gravação.

- [ ] **Step 1: Criar `tests/backend/paridade-jogadores-rodadas.test.mjs`**

```javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { dbParaAbas } from './dbParaAbas.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { criarVerificadorGoogle } from '../../backend/auth.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');
if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - apps-script-codigo.gs não existe nesta pasta (o arquivo é ignorado pelo git; copie-o da máquina do usuário).');
  process.exit(0);
}
const { criarAmbiente } = require('../helpers/planilha-falsa.js');

// cenário: o fixture + Carla (p3), jogadora sem conta; a conta c@ é jogadora e o admin a vincula a p3 durante o cenário
const dados = structuredClone(fixture);
dados.jogadores.push({ id: 'p3', nome: 'Carla', apelido: 'Carlinha', foto: '', estrelas: 3, sexo: 'F', porte: 'M', convidado: false, removido: false, ordem: 3 });

// ---------- lado 1: o .gs REAL ----------
const gs = criarAmbiente(dbParaAbas(dados), [caminhoGs]);
const linhasUsuarios = gs.abas.Usuarios.linhas;
dados.usuarios.slice().sort((a, b) => a.ordem - b.ordem).forEach((u, i) => {
  linhasUsuarios[i + 1][4] = gs.rodar('new Date(' + JSON.stringify(new Date(u.criado_em).toISOString()) + ')');
});
const CLIENTE = gs.rodar('GOOGLE_CLIENT_ID');
const SENHA = gs.rodar('ADMIN_PASSWORD'); // lida do .gs carregado, nunca em texto puro nos testes

// ---------- o "Google" falso, igual para os dois lados ----------
const exp = String(Math.floor(Date.now() / 1000) + 3600);
const base = { aud: CLIENTE, email_verified: 'true', exp };
const google = {
  'tok-a': { ...base, email: 'a@exemplo.com', name: 'A' },
  'tok-b': { ...base, email: 'b@exemplo.com', name: 'B' },
  'tok-c': { ...base, email: 'c@exemplo.com', name: 'C' }
};
gs.rodar('UrlFetchApp.fetch = function (url) { var t = decodeURIComponent(url.split("id_token=")[1]); var r = (' + JSON.stringify(google) + ')[t]; '
  + 'return r ? { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(r); } } '
  + ': { getResponseCode: function () { return 400; }, getContentText: function () { return "{}"; } }; };');

// ---------- lado 2: o backend novo (repositório em memória, mesmo "Google" falso) ----------
const buscar = async (url) => {
  const t = decodeURIComponent(url.split('id_token=')[1]);
  return google[t] ? { status: 200, json: async () => google[t] } : { status: 400, json: async () => ({}) };
};
const novo = criarHandler({
  repo: criarRepoMemoria(dados),
  config: { adminPassword: SENHA },
  verificarToken: criarVerificadorGoogle({ clientId: CLIENTE, buscar }),
  relogio: () => new Date()
});

const json = (x) => JSON.parse(JSON.stringify(x));

const r10 = { id: 'r10', data: '2026-10-06', rascunho: false, vencedores: [1], times: [
  { nome: 'Time 1', vitorias: 1, playerIds: ['p1', 'p10'] },
  { nome: 'Time 2', vitorias: 3, playerIds: ['p2', 'convidado:LUCAS#ab12', 'p3'] }
] };
const r11 = { id: 'r11', data: '2026-10-13', rascunho: true, vencedores: [0, 1], times: [
  { nome: 'A', vitorias: 2, playerIds: ['p3'] }, { nome: 'B', vitorias: 2, playerIds: ['p1', 'p2'] }, { nome: 'C', vitorias: 0, playerIds: [] }
] };
const cfg = { estrelasVisiveis: false, checkinDataAberta: '2026-10-20', checkinTravado: true, checkinVagas: 12, checkinHorario: '21:00', checkinMensagemTemplate: 'Vôlei {data} às {horario}' };
const igualP3 = { id: 'p3', nome: 'Carla', apelido: 'Carlinha', estrelas: 3, sexo: 'F', porte: 'M' };

const passos = [
  ['addPlayer: completo', { action: 'addPlayer', senha: SENHA, player: { id: 'p10', nome: 'Diego', apelido: 'Di', foto: 'https://x/d.jpg', estrelas: 3.5, sexo: 'M', porte: 'G' } }],
  ['addPlayer: só o obrigatório', { action: 'addPlayer', idToken: 'tok-b', player: { id: 'p11', nome: 'Eva' } }],
  ['addPlayer: estrelas como texto', { action: 'addPlayer', idToken: 'tok-a', player: { id: 'p12', nome: 'Fábio', estrelas: '4', sexo: 'M', porte: 'P' } }],
  ['updatePlayer: muda vários campos', { action: 'updatePlayer', idToken: 'tok-b', player: { id: 'p10', nome: 'Diego S', apelido: '', foto: '', estrelas: 4.5, sexo: 'M', porte: 'M' } }],
  ['updatePlayer: jogador inexistente', { action: 'updatePlayer', senha: SENHA, player: { id: 'nao-existe', nome: 'X' } }],
  ['updatePlayer: id de convidado não existe na aba', { action: 'updatePlayer', senha: SENHA, player: { id: 'convidado:LUCAS#ab12', nome: 'X' } }],
  ['removePlayer: inexistente', { action: 'removePlayer', senha: SENHA, id: 'nao-existe' }],
  ['removePlayer: organizador não pode', { action: 'removePlayer', idToken: 'tok-b', id: 'p12' }],
  ['addRound: dois times, vencedor, convidado e jogador novo', { action: 'addRound', idToken: 'tok-b', round: r10 }],
  ['addRound: rascunho com empate de vencedores e time vazio', { action: 'addRound', idToken: 'tok-b', round: r11 }],
  ['addRound: sem times não deixa rastro', { action: 'addRound', idToken: 'tok-b', round: { id: 'r12', data: '2026-10-27', times: [] } }],
  ['updateRound: troca times e vai para o fim', { action: 'updateRound', idToken: 'tok-b', round: { ...r10, vencedores: [0], times: [{ nome: 'Time 1', vitorias: 3, playerIds: ['p2', 'p1'] }, { nome: 'Time 2', vitorias: 1, playerIds: ['p10', 'convidado:NOVO#cd34'] }] } }],
  ['updateRound: id que não existe cria a rodada', { action: 'updateRound', senha: SENHA, round: { id: 'r13', data: '2026-11-03', vencedores: [], times: [{ nome: 'Z', vitorias: 0, playerIds: ['p3'] }] } }],
  ['updateRound: sem times remove a rodada', { action: 'updateRound', senha: SENHA, round: { id: 'r13', data: '2026-11-03', times: [] } }],
  ['removeRound: organizador não pode', { action: 'removeRound', idToken: 'tok-b', id: 'r11' }],
  ['removeRound: admin remove', { action: 'removeRound', idToken: 'tok-a', id: 'r11' }],
  ['removeRound: de novo dá erro', { action: 'removeRound', idToken: 'tok-a', id: 'r11' }],
  ['removePlayer: admin remove p10 (a rodada continua citando o id)', { action: 'removePlayer', idToken: 'tok-a', id: 'p10' }],
  ['removePlayer: de novo dá erro', { action: 'removePlayer', idToken: 'tok-a', id: 'p10' }],
  ['updatePlayer: removido não é achado', { action: 'updatePlayer', senha: SENHA, player: { id: 'p10', nome: 'Diego' } }],
  ['saveSettings: admin grava tudo (o contador de acessos é preservado)', { action: 'saveSettings', idToken: 'tok-a', settings: { ...cfg, contadorAcessos: 99999 } }],
  ['saveSettings: organizador não pode', { action: 'saveSettings', idToken: 'tok-b', settings: cfg }],
  ['saveCheckinSettings: organizador grava', { action: 'saveCheckinSettings', idToken: 'tok-b', settings: { ...cfg, checkinTravado: false, checkinVagas: 0 } }],
  ['saveCheckinSettings: chaves ausentes viram os padrões', { action: 'saveCheckinSettings', idToken: 'tok-b', settings: {} }],
  ['foto: jogador ainda sem vínculo é negado', { action: 'updatePlayer', idToken: 'tok-c', player: { ...igualP3, foto: 'https://x/c.jpg' } }],
  ['vínculo: admin liga a conta c@ ao jogador p3', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'p3' } }],
  ['foto: jogador vinculado troca só a foto', { action: 'updatePlayer', idToken: 'tok-c', player: { ...igualP3, foto: 'https://x/c.jpg' } }],
  ['foto: tentar mudar as estrelas é negado', { action: 'updatePlayer', idToken: 'tok-c', player: { ...igualP3, estrelas: 5, foto: 'https://x/c.jpg' } }],
  ['foto: tentar mudar o nome é negado', { action: 'updatePlayer', idToken: 'tok-c', player: { ...igualP3, nome: 'Outra' } }],
  ['foto: mexer no cadastro de outro jogador é negado', { action: 'updatePlayer', idToken: 'tok-c', player: { id: 'p1', nome: 'Ana', estrelas: 4, sexo: 'F', porte: 'P', foto: 'x' } }],
  ['foto: jogador comum não cadastra', { action: 'addPlayer', idToken: 'tok-c', player: { id: 'p20', nome: 'X' } }],
  ['foto: jogador comum não mexe em rodada', { action: 'addRound', idToken: 'tok-c', round: r10 }]
];

for (const [i, [nome, corpo]] of passos.entries()) {
  await ta(`passo ${String(i + 1).padStart(2, '0')}: ${nome}`, async () => {
    const esperado = gs.post(corpo);
    const obtido = json(await novo.post(corpo));
    assert.deepEqual(obtido, esperado, 'resposta diferente');
    assert.deepEqual(json(await novo.get()), gs.get(), 'o GET completo ficou diferente depois deste passo');
  });
}

fim();
```

- [ ] **Step 2: Rodar**

Run: `node tests/backend/paridade-jogadores-rodadas.test.mjs`
Expected: idealmente `TODOS OS TESTES PASSARAM` (32 passos, cada um comparando a resposta e o `GET` completo).

- [ ] **Step 3: Se houver diferenças, resolver assim (é o objetivo do teste)**

Para cada passo que falhar (a mensagem diz se foi a resposta ou o `GET`), ler o `.gs` real (fonte da verdade) e decidir de que lado está o defeito:
- o backend novo (`jogadores.js`, `rodadas.js`, `configuracoes.js`, `porteiro.js`, `handler.js` ou o repositório em memória, que faz o papel do banco) difere do `.gs` → corrigir o **backend novo**;
- só a montagem do teste (fake do Google, datas, fixture) → corrigir o teste, sem enfraquecer a comparação.
Regras: nunca editar o `.gs`; nunca afrouxar o `assert.deepEqual`; nunca remover um passo para ele passar; nunca ignorar uma chave do `GET`. Se a diferença revelar algo que pareça bug do `.gs`, **replicar** o comportamento e listar no relatório como comportamento herdado; se for uma das "diferenças conhecidas e aceitas" do spec, não deve aparecer aqui (nenhum passo a exercita). Depois de qualquer correção no backend, rodar de novo `node tests/backend/rodadas.test.mjs`, `jogadores-config.test.mjs`, `repo-escrita.test.mjs`, `handler-etapa3a.test.mjs`, `usuarios.test.mjs`, `paridade-usuarios.test.mjs`, `paridade-get.test.mjs`, `permissoes.test.mjs`; todos devem continuar verdes. Registrar no relatório cada diferença (passo, o que o `.gs` faz, que arquivo foi corrigido).

- [ ] **Step 4: Verificar que o teste não é vazio**

Confirmar no relatório que o `.gs` respondeu de verdade (por exemplo, o passo "addRound: dois times..." deixa a rodada `r10` no `GET` do `.gs`) e fazer uma mutação temporária no backend novo (por exemplo, fazer `updateRound` NÃO levar a rodada para o fim, ou trocar uma mensagem de erro) confirmando que o teste **falha**; desfazer com `git checkout -- <arquivo>`.

- [ ] **Step 5: Commit**

```bash
git add tests/backend/paridade-jogadores-rodadas.test.mjs backend/
git commit -m "test: paridade das ações de jogadores, rodadas e configurações com o .gs real (etapa 3a)"
```

---

### Task 7: Banco real: SQL, integração e teste no navegador

**Files:**
- Test: `tests/backend/integracao-etapa3a.mjs`
- Modify: `package.json` (script `test:backend`)

**Interfaces:**
- Consome: tudo das Tasks 1-6 e o SQL `sql/schema-terca-supabase-ajuste-3.sql` já executado pelo usuário.

- [ ] **Step 1: Atualizar o script `test:backend` do `package.json`**

Acrescentar, ao final da linha existente do script `test:backend` (mantendo tudo que já está lá), estes arquivos encadeados com `&&`: `node tests/backend/convidados.test.mjs`, `node tests/backend/repo-escrita.test.mjs`, `node tests/backend/jogadores-config.test.mjs`, `node tests/backend/rodadas.test.mjs`, `node tests/backend/handler-etapa3a.test.mjs`, `node tests/backend/paridade-jogadores-rodadas.test.mjs`. Rodar `npm run test:backend`: todos os arquivos terminam com `TODOS OS TESTES PASSARAM`.

- [ ] **Step 2: Criar `tests/backend/integracao-etapa3a.mjs` (verificação manual; grava no Supabase REAL com dados de teste e apaga tudo)**

```javascript
// Exercita, no Supabase REAL, as ações da etapa 3a com dados de teste e limpa tudo no fim. Confere também o que só o
// banco faz: sequências de "ordem", a função gravar_rodada (transação) e remover_rodada, o índice único de vínculos.
// Uso: node tests/backend/integracao-etapa3a.mjs   (precisa do .env e do ajuste 3 já executado no painel do Supabase)
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarHandler } from '../../backend/handler.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SENHA = process.env.ADMIN_PASSWORD;
const h = criarHandler({ repo: criarRepoSupabase(cliente), config: { adminPassword: SENHA } });
const post = (corpo) => h.post({ senha: SENHA, ...corpo });

const P = 'teste-e3a-jogador';
const R = 'teste-e3a-rodada';
const CONV = 'convidado:TESTE E3A#zz99';

async function limpar() {
  const { data: times } = await cliente.from('times_rodada').select('id').eq('round_id', R);
  if (times && times.length) await cliente.from('time_jogadores').delete().in('time_rodada_id', times.map((t) => t.id));
  await cliente.from('times_rodada').delete().eq('round_id', R);
  await cliente.from('rodadas').delete().eq('round_id', R);
  await cliente.from('jogadores').delete().in('id', [P, CONV]);
}

const antes = { players: 0, rounds: 0 };
let configAntes;

await limpar(); // sobra de uma execução anterior interrompida
try {
  const g0 = await h.get();
  antes.players = g0.players.length;
  antes.rounds = g0.rounds.length;
  configAntes = g0.settings;

  await ta('sequência de ordem: jogador novo entra no fim (ordem do banco, maior que todas as existentes)', async () => {
    assert.deepEqual(await post({ action: 'addPlayer', player: { id: P, nome: 'Teste Etapa 3a', estrelas: 3.5, sexo: 'M', porte: 'G' } }), { status: 'ok' });
    const { data } = await cliente.from('jogadores').select('id, ordem, removido, convidado').eq('id', P);
    const { data: todas } = await cliente.from('jogadores').select('ordem').not('ordem', 'is', null);
    assert.equal(data[0].removido, false);
    assert.equal(data[0].convidado, false);
    assert.ok(data[0].ordem !== null && data[0].ordem === Math.max(...todas.map((x) => x.ordem)), 'ordem do jogador novo deve ser a maior; veio ' + data[0].ordem);
    const g = await h.get();
    assert.equal(g.players.length, antes.players + 1);
    assert.equal(g.players.at(-1).id, P);
  });

  await ta('id repetido é recusado com mensagem clara', async () => {
    assert.deepEqual(await post({ action: 'addPlayer', player: { id: P, nome: 'X' } }), { error: 'Já existe um jogador com esse id.' });
  });

  await ta('gravar_rodada: cria rodada, times, jogadores e o convidado novo (sem ordem) numa transação', async () => {
    const rodada = { id: R, data: '2026-12-31', rascunho: true, vencedores: [1], times: [
      { nome: 'T1', vitorias: 1, playerIds: [P, CONV] }, { nome: 'T2', vitorias: 2, playerIds: [] }
    ] };
    assert.deepEqual(await post({ action: 'addRound', round: rodada }), { status: 'ok' });
    const g = await h.get();
    assert.equal(g.rounds.length, antes.rounds + 1);
    const nova = g.rounds.at(-1);
    assert.deepEqual({ id: nova.id, data: nova.data, rascunho: nova.rascunho, vencedores: nova.vencedores }, { id: R, data: '2026-12-31', rascunho: true, vencedores: [1] });
    assert.deepEqual(nova.times.map((t) => [t.nome, t.vitorias, t.playerIds]), [['T1', 1, [P, CONV]], ['T2', 2, []]]);
    assert.ok(!g.players.some((p) => p.id === CONV), 'convidado não aparece em players');
    const { data } = await cliente.from('jogadores').select('nome, convidado, ordem').eq('id', CONV);
    assert.deepEqual(data[0], { nome: 'TESTE E3A', convidado: true, ordem: null });
  });

  await ta('gravar_rodada: jogador que não existe recusa tudo e a rodada anterior continua intacta (atomicidade)', async () => {
    const r = await post({ action: 'updateRound', round: { id: R, data: '2027-01-01', times: [{ nome: 'X', vitorias: 0, playerIds: ['id-que-nao-existe'] }] } });
    assert.ok(r.error && /foreign key|violates/i.test(r.error), 'esperava erro de chave estrangeira, veio ' + JSON.stringify(r));
    const nova = (await h.get()).rounds.find((x) => x.id === R);
    assert.equal(nova.data, '2026-12-31');
    assert.equal(nova.times.length, 2);
  });

  await ta('updateRound: troca o conteúdo e a rodada continua sendo a última', async () => {
    assert.deepEqual(await post({ action: 'updateRound', round: { id: R, data: '2027-01-02', rascunho: false, vencedores: [0], times: [{ nome: 'Novo', vitorias: 5, playerIds: [P] }] } }), { status: 'ok' });
    const g = await h.get();
    assert.equal(g.rounds.length, antes.rounds + 1);
    assert.deepEqual(g.rounds.at(-1).times.map((t) => t.nome), ['Novo']);
    assert.equal(g.rounds.at(-1).data, '2027-01-02');
  });

  await ta('índice único: dois usuários não podem ficar vinculados ao mesmo jogador', async () => {
    const dup = await cliente.from('usuarios').select('jogador_id, jogador_id_pendente');
    const ids = dup.data.map((u) => u.jogador_id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, 'já há vínculos duplicados no banco');
    const candidato = ids[0];
    const { error } = await cliente.from('usuarios').insert({ email: 'teste-e3a@exemplo.com', nome: 'T', perfil: 'jogador', jogador_id: candidato });
    await cliente.from('usuarios').delete().eq('email', 'teste-e3a@exemplo.com');
    assert.ok(error && /unique|duplicate/i.test(error.message), 'o banco deveria recusar o vínculo repetido; veio ' + JSON.stringify(error));
  });

  await ta('saveSettings: regravar as configurações atuais não muda nada (e preserva o contador de acessos)', async () => {
    assert.deepEqual(await post({ action: 'saveSettings', settings: configAntes }), { status: 'ok' });
    assert.deepEqual((await h.get()).settings, configAntes);
  });

  await ta('removeRound e removePlayer: apagam a rodada e arquivam o jogador; repetir dá a mensagem do .gs', async () => {
    assert.deepEqual(await post({ action: 'removeRound', id: R }), { status: 'ok' });
    assert.deepEqual(await post({ action: 'removeRound', id: R }), { error: 'Rodada não encontrada (pode já ter sido removida por outra pessoa).' });
    assert.deepEqual(await post({ action: 'removePlayer', id: P }), { status: 'ok' });
    const { data } = await cliente.from('jogadores').select('removido').eq('id', P);
    assert.equal(data[0].removido, true);
    assert.deepEqual(await post({ action: 'removePlayer', id: P }), { error: 'Jogador não encontrado (pode já ter sido removido por outra pessoa).' });
    const g = await h.get();
    assert.equal(g.players.length, antes.players);
    assert.equal(g.rounds.length, antes.rounds);
  });
} finally {
  await limpar();
  const g = await h.get();
  console.log('limpeza: players', antes.players, '->', g.players.length, '| rounds', antes.rounds, '->', g.rounds.length,
    g.players.length === antes.players && g.rounds.length === antes.rounds ? '(banco como estava)' : '(ATENÇÃO: diferente!)');
}
fim();
```

- [ ] **Step 3: Validar sintaxe**

Run: `node --check tests/backend/integracao-etapa3a.mjs` (sem erro). **Não** rodar este arquivo: ele grava no banco real; o controlador o roda depois que o usuário executar o SQL (Step 4).

- [ ] **Step 4: (controlador + usuário) Conferir duplicatas, entregar o SQL e rodar a integração**

1. O controlador confere, só lendo, que os índices únicos vão passar: nenhum `jogador_id` nem `jogador_id_pendente` repetido em `usuarios`.
2. O usuário abre `sql/schema-terca-supabase-ajuste-3.sql`, cola no SQL Editor do Supabase e roda (esperado: `Success. No rows returned`).
3. O controlador roda `node tests/backend/integracao-etapa3a.mjs` (esperado: todos `ok`, e a linha final `(banco como estava)`).

- [ ] **Step 5: (usuário) Teste no navegador**

Com o servidor local reiniciado (`http://localhost:8000`) e o login feito: cadastrar um jogador de teste; editá-lo; montar e salvar uma rodada com ele e um convidado; editar a rodada; ver que os dois aparecem nas telas certas; remover a rodada e o jogador de teste; mudar uma configuração do check-in (ex.: travar e destravar). Conferir que tudo se comporta como no app de produção.

- [ ] **Step 6: Commit**

```bash
git add tests/backend/integracao-etapa3a.mjs package.json
git commit -m "test: integração da etapa 3a contra o Supabase real e script de testes atualizado"
```
