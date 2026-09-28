# Vôlei Meme Brasil no Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o Vôlei Meme Brasil para o mesmo projeto Supabase do Terça (schema `meme`, função `meme-api`, bucket `fotos-meme`), com virada e rollback como no Terça, sem alterar o Terça em produção.

**Architecture:** Um script gera o SQL do Meme a partir dos SQL do Terça (troca só o nome do schema); o backend continua o mesmo e o cliente do Supabase aponta para o schema `meme`; um módulo `scripts/lib/grupo.js` concentra tudo que muda entre os grupos (`GRUPO=meme`); uma Edge Function nova `meme-api` (cópia da casca do Terça com segredos `MEME_*`); migração dos dados e das fotos parametrizada; virada trocando `SHEET_API_URL` no `index.html` do repositório `voleimeme`.

**Tech Stack:** Node.js (testes com o mini executor `tests/backend/executor.mjs`), Supabase (Postgres, Storage, Edge Functions/Deno), googleapis, PowerShell/Bash, git.

**Spec:** `docs/superpowers/specs/2026-09-26-meme-no-supabase-design.md`

## Global Constraints

- **O Terça em produção não pode mudar:** não editar `supabase/functions/terca-api-teste/`, nem `volei-dashboard.html`, nem o schema `public`. Todo código novo mantém o padrão atual (sem `GRUPO` = Terça, schema `public`, bucket `fotos`).
- **Diretórios:** **VOLEI** = `C:\Users\Heleno\OneDrive\Documentos\GitHub\volei` (branch `meme-supabase`; onde tudo é feito e testado); **MEME** = `C:\Users\Heleno\OneDrive\Documentos\GitHub\voleimeme` (só na Task 9, o `index.html` do Meme).
- Nomes fixos (valores exatos do spec): schema `meme`; função `meme-api`; bucket `fotos-meme`; segredos `MEME_ADMIN_PASSWORD` (>= 20 caracteres, 43 recomendado) e `MEME_ORIGENS_PERMITIDAS`; `GOOGLE_CLIENT_ID` é o mesmo do Terça (`986000653553-d5ri8n0k3kg6f1iii2e8c3v3854uuk3d.apps.googleusercontent.com`); projeto `lzwmirrjpoqucwlhgkku`; endereço da função `https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/meme-api`; rodapé do Meme na virada `Ver.: 13.0`.
- Só `service_role` acessa o schema `meme` (nenhum grant para `anon`/`authenticated`); RLS como no Terça.
- **`git push` e qualquer publicação (função, virada do `voleimeme`) só com OK explícito do usuário naquele momento;** a virada só fora de horário de jogo. Sem `git add -A`: adicionar arquivos pelo nome. Continuam untracked e fora dos commits: `CLAUDE.md`, `docs/superpowers/financeiro-*.md`, `docs/superpowers/plans/2026-09-1*`, `docs/superpowers/plans/2026-09-22*`, `docs/superpowers/specs/2026-09-1*`, `tests/financeiro-puro.test.js`, `tests/jogador-card-sequencia.test.js`.
- Commits terminam com a linha `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Nenhum segredo no repositório (`.env`, `CHAVE/`, senhas, `service_role`). No Windows/PowerShell 5.1, `curl.exe -d` leva aspas simples por fora: `-d '{\"action\":\"lerAoVivo\"}'`.
- Validar sintaxe (`node --check`) depois de editar `.js`; o `.html` do Meme segue a regra do CLAUDE.md (extrair `<script>` e `node --check`).
- Passos marcados **[USUÁRIO]** só o usuário faz (painel do Supabase, gerenciador de senhas, OK de publicação); o agente guia e confere o resultado.

## Review Focus

1. **Trocar `public` demais no SQL gerado:** em `revoke ... from public, anon, authenticated` o `public` é o PAPEL, não o schema; trocá-lo quebraria os grants. Teste na Task 1.
2. **Script do Meme lendo a planilha ou o schema do Terça** (esquecer `GRUPO`, variável trocada): `meme` nunca lê `SPREADSHEET_ID_TERCA`; `GRUPO` inválido é erro. Testes na Task 3 e conferência de contagens do Terça antes/depois na Task 6.
3. **Aba `FinCreditos` ausente na planilha real do Meme** (a leitura hoje daria erro 400 e abortaria a migração): tratada como vazia, e o script avisa. Teste na Task 3.
4. **Função `meme-api` usando segredo do Terça ou o schema `public`:** teste estático na Task 5 (lê `MEME_*`, schema `meme`, bucket `fotos-meme`; e a `terca-api-teste` continua sem qualquer menção ao Meme).
5. **Funções SQL do Meme presas ao schema `public`** (`set search_path = public` copiado, ou função sem `search_path` dependendo da requisição): gerador troca e fixa; `verificar-schema` chama `remover_rodada` de verdade contra o banco. Task 1 e Task 6.
6. **Foto do Meme parando no bucket do Terça** (ou o `?id=` de exclusão cruzar grupos): bucket parametrizado; scripts sem `'fotos'` fixo. Tasks 2 e 4.
7. **Virada com o endereço do Apps Script sobrando ou a origem `localhost` ainda aberta:** conferências com `grep` e com `curl` (403) na Task 9.

---

### Task 1: Gerador do SQL do Meme

**Files:**
- Create: `scripts/gerar-sql-grupo.js`
- Create: `sql/meme/schema-meme-supabase.sql` (gerado)
- Create: `tests/backend/gerar-sql-grupo.test.mjs`
- Modify: `package.json` (script `gerar-sql-meme` e teste na suíte)

**Interfaces:**
- Consumes: os arquivos `sql/schema-terca-supabase.sql` e `sql/schema-terca-supabase-ajuste-1.sql` a `-7.sql`.
- Produces: `gerarSqlGrupo(arquivos, schema)` -> string; `trocarSchema(sql, schema)` -> string; `ARQUIVOS_DO_TERCA` (array de nomes, na ordem de execução). `npm run gerar-sql-meme` escreve `sql/meme/schema-meme-supabase.sql` (um arquivo só, para colar de uma vez no SQL Editor).

- [ ] **Step 1: Escrever o teste (falha porque o módulo não existe)**

Criar `tests/backend/gerar-sql-grupo.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ta, fim } from './executor.mjs';

const { gerarSqlGrupo, trocarSchema, ARQUIVOS_DO_TERCA } = createRequire(import.meta.url)('../../scripts/gerar-sql-grupo.js');
const raiz = path.join(import.meta.dirname, '..', '..');
const lerSql = (nome) => fs.readFileSync(path.join(raiz, 'sql', nome), 'utf8').replace(/\r\n/g, '\n');
const reais = ARQUIVOS_DO_TERCA.map((nome) => ({ nome, conteudo: lerSql(nome) }));

await ta('troca só nome de schema: search_path e regclass; o papel PUBLIC em "from public, anon" fica', () => {
  const entrada = [
    'language plpgsql set search_path = public as $$',
    "where c.conrelid = 'public.ao_vivo'::regclass and c.confrelid = 'public.rodadas'::regclass;",
    'revoke execute on function f() from public, anon, authenticated;'
  ].join('\n');
  const s = trocarSchema(entrada, 'meme');
  assert.match(s, /set search_path = meme as/);
  assert.match(s, /'meme\.ao_vivo'::regclass/);
  assert.match(s, /'meme\.rodadas'::regclass/);
  assert.match(s, /from public, anon, authenticated;/, 'o papel PUBLIC não pode ser trocado');
  assert.doesNotMatch(s, /search_path = public/);
});

await ta('cabeçalho cria o schema e fixa o search_path ANTES do conteúdo dos arquivos', () => {
  const s = gerarSqlGrupo([{ nome: 'a.sql', conteudo: 'create table t (x int);' }], 'meme');
  assert.ok(s.indexOf('create schema if not exists meme;') > -1);
  assert.ok(s.indexOf('set search_path to meme;') > s.indexOf('create schema if not exists meme;'));
  assert.ok(s.indexOf('create table t') > s.indexOf('set search_path to meme;'));
});

await ta('rodapé fixa o search_path das funções soltas e dá acesso só ao service_role', () => {
  const s = gerarSqlGrupo([{ nome: 'a.sql', conteudo: 'select 1;' }], 'meme');
  assert.match(s, /alter function gravar_rodada\(jsonb\) set search_path = meme;/);
  assert.match(s, /alter function remover_rodada\(text\) set search_path = meme;/);
  assert.match(s, /grant usage on schema meme to service_role;/);
  assert.match(s, /grant all on all tables in schema meme to service_role;/);
  assert.match(s, /revoke all on all tables in schema meme from anon, authenticated;/);
  assert.match(s, /revoke execute on all functions in schema meme from public, anon, authenticated;/);
  assert.doesNotMatch(s, /grant [^;]*\bto (anon|authenticated|public)\b/);
});

await ta('recusa schema "public", vazio ou com caracteres perigosos', () => {
  for (const ruim of ['public', '', 'Meme', 'me me', 'meme;drop', '1meme']) {
    assert.throws(() => gerarSqlGrupo(reais, ruim), /schema/i, JSON.stringify(ruim));
  }
});

await ta('arquivos reais: nenhum "search_path = public" nem regclass "public." sobra, e os revoke de PUBLIC continuam', () => {
  const s = gerarSqlGrupo(reais, 'meme');
  assert.doesNotMatch(s, /search_path = public/);
  assert.doesNotMatch(s, /'public\./);
  const conta = (texto) => (texto.match(/from public, anon, authenticated;/g) || []).length;
  const nasFontes = reais.reduce((n, a) => n + conta(a.conteudo), 0);
  assert.ok(nasFontes >= 5, 'as fontes do Terça têm revoke de PUBLIC: ' + nasFontes);
  assert.ok(conta(s) >= nasFontes, 'o SQL do Meme perdeu revoke de PUBLIC');
  // as 5 funções que fixavam public agora fixam meme
  assert.equal((s.match(/set search_path = meme as/g) || []).length, 5);
});

await ta('é determinístico e o arquivo gerado no repositório está em dia (rode: npm run gerar-sql-meme)', () => {
  const a = gerarSqlGrupo(reais, 'meme');
  assert.equal(gerarSqlGrupo(reais, 'meme'), a);
  const emDisco = fs.readFileSync(path.join(raiz, 'sql', 'meme', 'schema-meme-supabase.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(emDisco, a, 'sql/meme/schema-meme-supabase.sql está desatualizado: rode "npm run gerar-sql-meme"');
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em VOLEI): `node tests/backend/gerar-sql-grupo.test.mjs`
Expected: erro `Cannot find module '../../scripts/gerar-sql-grupo.js'`.

- [ ] **Step 3: Implementar o gerador**

Criar `scripts/gerar-sql-grupo.js`:

```js
// Gera o SQL de um grupo (schema separado no MESMO projeto Supabase) a partir dos SQL do Terça, para os dois nunca divergirem.
// Só troca NOME DE SCHEMA ("set search_path = public" e "'public.tabela'" em regclass). O "public" de
// "revoke ... from public, anon, authenticated" é o PAPEL PUBLIC do Postgres e NÃO é trocado.
// Uso: npm run gerar-sql-meme   -> escreve sql/meme/schema-meme-supabase.sql (um arquivo só, para colar de uma vez no SQL Editor).
// Não toca em rede nem no banco.
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVOS_DO_TERCA = [
  'schema-terca-supabase.sql',
  'schema-terca-supabase-ajuste-1.sql',
  'schema-terca-supabase-ajuste-2.sql',
  'schema-terca-supabase-ajuste-3.sql',
  'schema-terca-supabase-ajuste-4.sql',
  'schema-terca-supabase-ajuste-5.sql',
  'schema-terca-supabase-ajuste-6.sql',
  'schema-terca-supabase-ajuste-7.sql'
];

function trocarSchema(sql, schema) {
  return sql
    .replace(/set search_path = public\b/g, `set search_path = ${schema}`)
    .replace(/'public\./g, `'${schema}.`);
}

function cabecalho(schema) {
  return [
    `-- GERADO por scripts/gerar-sql-grupo.js a partir dos SQL do Terça. NÃO edite: rode "npm run gerar-sql-${schema}" de novo.`,
    `-- Cria o schema "${schema}" no MESMO projeto do Terça (o schema "public" do Terça não é tocado).`,
    '-- QUEM RODA: o usuário, UMA vez, no SQL Editor do Supabase. Depois: Configurações > API > "Exposed schemas": acrescentar o schema.',
    `create schema if not exists ${schema};`,
    `set search_path to ${schema};`,
    ''
  ].join('\n');
}

function rodape(schema) {
  return [
    '',
    '-- ==== acesso e search_path (gerado) ====',
    '-- funções que não fixavam search_path passam a apontar para este schema, sem depender da requisição:',
    `alter function gravar_rodada(jsonb) set search_path = ${schema};`,
    `alter function remover_rodada(text) set search_path = ${schema};`,
    '-- só service_role acessa o schema (o app nunca fala com o banco direto):',
    `grant usage on schema ${schema} to service_role;`,
    `grant all on all tables in schema ${schema} to service_role;`,
    `grant all on all sequences in schema ${schema} to service_role;`,
    `grant execute on all functions in schema ${schema} to service_role;`,
    `revoke all on all tables in schema ${schema} from anon, authenticated;`,
    `revoke all on all sequences in schema ${schema} from anon, authenticated;`,
    `revoke execute on all functions in schema ${schema} from public, anon, authenticated;`,
    `revoke all on schema ${schema} from public, anon, authenticated;`,
    `alter default privileges in schema ${schema} grant all on tables to service_role;`,
    `alter default privileges in schema ${schema} grant all on sequences to service_role;`,
    `alter default privileges in schema ${schema} grant execute on functions to service_role;`,
    ''
  ].join('\n');
}

// arquivos: [{ nome, conteudo }] na ordem de execução
function gerarSqlGrupo(arquivos, schema) {
  if (typeof schema !== 'string' || !/^[a-z][a-z0-9_]*$/.test(schema) || schema === 'public') {
    throw new Error('schema inválido: ' + JSON.stringify(schema) + ' (minúsculas, sem espaço, diferente de "public")');
  }
  const partes = [cabecalho(schema)];
  for (const { nome, conteudo } of arquivos) {
    partes.push(`-- ==== ${nome} (fonte: sql/${nome}) ====`);
    partes.push(trocarSchema(conteudo.replace(/\r\n/g, '\n'), schema).trimEnd());
    partes.push('');
  }
  partes.push(rodape(schema));
  return partes.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function executar() {
  const raiz = path.join(__dirname, '..');
  const arquivos = ARQUIVOS_DO_TERCA.map((nome) => ({ nome, conteudo: fs.readFileSync(path.join(raiz, 'sql', nome), 'utf8') }));
  const saida = path.join(raiz, 'sql', 'meme', 'schema-meme-supabase.sql');
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, gerarSqlGrupo(arquivos, 'meme'));
  console.log('Escrito sql/meme/schema-meme-supabase.sql (' + arquivos.length + ' arquivos do Terça, schema "meme").');
}

if (require.main === module) executar();
module.exports = { gerarSqlGrupo, trocarSchema, ARQUIVOS_DO_TERCA };
```

- [ ] **Step 4: Registrar o script e o teste no `package.json`**

Em `package.json`, trocar
`"preparar-edge": "node scripts/preparar-edge.js"`
por
`"preparar-edge": "node scripts/preparar-edge.js",\n    "gerar-sql-meme": "node scripts/gerar-sql-grupo.js"`
e no final de `test:backend`, trocar `&& node tests/backend/paridade-aovivo.test.mjs"` por `&& node tests/backend/paridade-aovivo.test.mjs && node tests/backend/gerar-sql-grupo.test.mjs"`.

- [ ] **Step 5: Gerar o SQL e rodar o teste**

Run: `npm run gerar-sql-meme && node tests/backend/gerar-sql-grupo.test.mjs`
Expected: `Escrito sql/meme/schema-meme-supabase.sql (8 arquivos ...)` e depois `TODOS OS TESTES PASSARAM` (6 casos `ok`).

- [ ] **Step 6: Conferir a mão o trecho crítico**

Run: `grep -n "search_path" sql/meme/schema-meme-supabase.sql && grep -c "from public, anon, authenticated" sql/meme/schema-meme-supabase.sql`
Expected: só `search_path = meme` (5 funções + `set search_path to meme;` + 2 `alter function`) e nenhuma `search_path = public`.

- [ ] **Step 7: Commit**

```bash
git add scripts/gerar-sql-grupo.js sql/meme/schema-meme-supabase.sql tests/backend/gerar-sql-grupo.test.mjs package.json
git commit -m "feat: gerador do SQL do Meme (schema meme derivado dos SQL do Terça)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Bucket de fotos parametrizado

**Files:**
- Modify: `backend/armazenamento-supabase.js`
- Create: `tests/backend/armazenamento-bucket.test.mjs`
- Modify: `package.json` (teste na suíte)

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `criarArmazenamentoSupabase({ cliente, urlBase, bucket = 'fotos' })` — o padrão `'fotos'` mantém o Terça idêntico.

- [ ] **Step 1: Escrever o teste (falha: hoje o bucket é fixo)**

Criar `tests/backend/armazenamento-bucket.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarArmazenamentoSupabase } from '../../backend/armazenamento-supabase.js';

function clienteFalso(erro = null) {
  const chamadas = [];
  return {
    chamadas,
    storage: {
      from: (bucket) => ({
        upload: async (caminho, bytes, opcoes) => { chamadas.push({ op: 'upload', bucket, caminho, opcoes }); return { error: erro }; },
        remove: async (caminhos) => { chamadas.push({ op: 'remove', bucket, caminhos }); return { error: erro }; }
      })
    }
  };
}

await ta('sem "bucket" o padrão continua "fotos" (o Terça não muda)', async () => {
  const c = clienteFalso();
  const a = criarArmazenamentoSupabase({ cliente: c, urlBase: 'https://x.supabase.co/' });
  const url = await a.enviar('jog-1.jpg', new Uint8Array([1]), 'image/jpeg');
  assert.equal(c.chamadas[0].bucket, 'fotos');
  assert.equal(url, 'https://x.supabase.co/storage/v1/object/public/fotos/jog-1.jpg?id=jog-1.jpg');
});

await ta('com bucket "fotos-meme": envia, apaga e monta a URL nesse bucket, nunca no do Terça', async () => {
  const c = clienteFalso();
  const a = criarArmazenamentoSupabase({ cliente: c, urlBase: 'https://x.supabase.co', bucket: 'fotos-meme' });
  const url = await a.enviar('jog-2.jpg', new Uint8Array([1]), 'image/jpeg');
  await a.apagar('jog-2.jpg');
  assert.deepEqual(c.chamadas.map((x) => x.bucket), ['fotos-meme', 'fotos-meme']);
  assert.equal(url, 'https://x.supabase.co/storage/v1/object/public/fotos-meme/jog-2.jpg?id=jog-2.jpg');
  assert.ok(!url.includes('/public/fotos/'));
});

await ta('erro do Storage cita o bucket usado', async () => {
  const a = criarArmazenamentoSupabase({ cliente: clienteFalso({ message: 'sem espaço' }), urlBase: 'https://x.supabase.co', bucket: 'fotos-meme' });
  await assert.rejects(() => a.enviar('a.jpg', new Uint8Array([1]), 'image/jpeg'), /bucket fotos-meme.*sem espaço/);
  await assert.rejects(() => a.apagar('a.jpg'), /bucket fotos-meme/);
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/armazenamento-bucket.test.mjs`
Expected: o caso "fotos-meme" falha (o bucket enviado é `fotos`).

- [ ] **Step 3: Implementar**

Substituir todo `backend/armazenamento-supabase.js` por:

```js
// Armazenamento de fotos no Supabase Storage (bucket público; um por grupo, padrão "fotos"). O cliente (supabase-js) vem por injeção.
export function criarArmazenamentoSupabase({ cliente, urlBase, bucket = 'fotos' }) {
  const base = String(urlBase || '').replace(/\/+$/, '');
  return {
    async enviar(caminho, bytes, contentType) {
      // cache de 1 ano é seguro porque cada envio tem nome único; upsert:false impede sobrescrever uma foto existente
      const { error } = await cliente.storage.from(bucket).upload(caminho, bytes, { contentType, cacheControl: '31536000', upsert: false });
      if (error) throw new Error('Storage (bucket ' + bucket + '): ' + error.message);
      // o Storage ignora a query string; "?id=" existe só para o front (extrairFileIdDaFoto) devolver o caminho depois
      return base + '/storage/v1/object/public/' + bucket + '/' + caminho + '?id=' + caminho;
    },
    async apagar(caminho) {
      const { error } = await cliente.storage.from(bucket).remove([caminho]);
      if (error) throw new Error('Storage (bucket ' + bucket + '): ' + error.message);
    }
  };
}
```

- [ ] **Step 4: Rodar os testes (novo + os de fotos existentes)**

Run: `node tests/backend/armazenamento-bucket.test.mjs && node tests/backend/fotos.test.mjs && node tests/backend/handler-etapa3c.test.mjs`
Expected: os três terminam com `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Registrar na suíte e commitar**

Em `package.json`, no fim de `test:backend`, acrescentar `&& node tests/backend/armazenamento-bucket.test.mjs` (depois do `gerar-sql-grupo.test.mjs` da Task 1).

```bash
git add backend/armazenamento-supabase.js tests/backend/armazenamento-bucket.test.mjs package.json
git commit -m "feat: armazenamento de fotos com bucket por grupo (padrão fotos)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Configuração por grupo e leitura tolerante da planilha

**Files:**
- Create: `scripts/lib/grupo.js`
- Modify: `scripts/lib/planilha.js`
- Create: `tests/backend/grupo.test.mjs`
- Create: `tests/backend/planilha-abas.test.mjs`
- Modify: `package.json` (testes na suíte)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `configDoGrupo(env = process.env)` -> `{ grupo, schema, bucket, spreadsheetIdVar, adminPasswordVar, htmlVar, htmlPadrao, spreadsheetId }`. `GRUPO` ausente = `terca`; valores aceitos `terca` e `meme` (sem diferenciar maiúsculas/espaços); outro valor lança `Error('GRUPO inválido: ...')`.
  - `opcoesDoCliente(cfg)` -> `{}` para `public`, `{ db: { schema } }` para os outros.
  - `lerAbas(sheets, spreadsheetId, abas = ABAS)` -> `{ dados, ausentes }` (aba inexistente vira `[]` e entra em `ausentes`).
  - `lerPlanilha(spreadsheetId)` -> dados por aba; `lerPlanilhaTerca()` continua existindo.

- [ ] **Step 1: Escrever os testes (falham: módulos/funções não existem)**

Criar `tests/backend/grupo.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ta, fim } from './executor.mjs';

const { configDoGrupo, opcoesDoCliente } = createRequire(import.meta.url)('../../scripts/lib/grupo.js');

await ta('sem GRUPO é o Terça (schema public, bucket fotos): nada muda para quem já usa', () => {
  const c = configDoGrupo({ SPREADSHEET_ID_TERCA: 'T1', SPREADSHEET_ID_MEME: 'M1' });
  assert.equal(c.grupo, 'terca');
  assert.equal(c.schema, 'public');
  assert.equal(c.bucket, 'fotos');
  assert.equal(c.adminPasswordVar, 'ADMIN_PASSWORD');
  assert.equal(c.spreadsheetId, 'T1');
  assert.deepEqual(opcoesDoCliente(c), {});
});

await ta('GRUPO=meme: schema meme, bucket fotos-meme, senha e planilha do Meme; ignora maiúsculas e espaços', () => {
  const c = configDoGrupo({ GRUPO: '  MEME ', SPREADSHEET_ID_TERCA: 'T1', SPREADSHEET_ID_MEME: 'M1' });
  assert.equal(c.grupo, 'meme');
  assert.equal(c.schema, 'meme');
  assert.equal(c.bucket, 'fotos-meme');
  assert.equal(c.adminPasswordVar, 'MEME_ADMIN_PASSWORD');
  assert.equal(c.spreadsheetId, 'M1');
  assert.deepEqual(opcoesDoCliente(c), { db: { schema: 'meme' } });
});

await ta('o Meme NUNCA cai na planilha do Terça (ID do Meme ausente = vazio, não o do Terça)', () => {
  const c = configDoGrupo({ GRUPO: 'meme', SPREADSHEET_ID_TERCA: 'T1' });
  assert.equal(c.spreadsheetId, '');
});

await ta('GRUPO desconhecido é erro (nada de cair no Terça por engano)', () => {
  for (const ruim of ['meem', 'publico', 'terça2']) {
    assert.throws(() => configDoGrupo({ GRUPO: ruim }), /GRUPO inválido/);
  }
});

fim();
```

Criar `tests/backend/planilha-abas.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ta, fim } from './executor.mjs';

const { lerAbas } = createRequire(import.meta.url)('../../scripts/lib/planilha.js');

// cliente falso do Sheets: values.get devolve o que está em "abas" ou lança o erro configurado
function sheetsFalso(abas, erros = {}) {
  const chamadas = [];
  return {
    chamadas,
    spreadsheets: { values: { get: async ({ spreadsheetId, range }) => {
      chamadas.push({ spreadsheetId, range });
      if (erros[range]) throw erros[range];
      return { data: { values: abas[range] } };
    } } }
  };
}
const erro400 = (aba) => Object.assign(new Error('Unable to parse range: ' + aba), { code: 400 });

await ta('lê cada aba com o ID pedido; aba sem valores vira lista vazia', async () => {
  const s = sheetsFalso({ Jogadores: [['id', 'nome'], ['1', 'ANA']], Rodadas: undefined });
  const { dados, ausentes } = await lerAbas(s, 'ID-MEME', ['Jogadores', 'Rodadas']);
  assert.deepEqual(dados.Jogadores, [['id', 'nome'], ['1', 'ANA']]);
  assert.deepEqual(dados.Rodadas, []);
  assert.deepEqual(ausentes, []);
  assert.deepEqual(s.chamadas.map((c) => c.spreadsheetId), ['ID-MEME', 'ID-MEME']);
});

await ta('aba que NÃO existe na planilha (400 "Unable to parse range", caso real do Meme: FinCreditos) vira vazia e é avisada', async () => {
  const s = sheetsFalso({ Jogadores: [['id']] }, { FinCreditos: erro400('FinCreditos') });
  const { dados, ausentes } = await lerAbas(s, 'X', ['Jogadores', 'FinCreditos']);
  assert.deepEqual(dados.FinCreditos, []);
  assert.deepEqual(ausentes, ['FinCreditos']);
  assert.deepEqual(dados.Jogadores, [['id']]);
});

await ta('outros erros (sem permissão, rede) NÃO são engolidos', async () => {
  const semPermissao = Object.assign(new Error('The caller does not have permission'), { code: 403 });
  await assert.rejects(() => lerAbas(sheetsFalso({}, { Jogadores: semPermissao }), 'X', ['Jogadores']), /permission/);
  const outro400 = Object.assign(new Error('Invalid value at range'), { code: 400 });
  await assert.rejects(() => lerAbas(sheetsFalso({}, { Jogadores: outro400 }), 'X', ['Jogadores']), /Invalid value/);
});

await ta('ID de planilha vazio é erro claro (não tenta ler "undefined")', async () => {
  await assert.rejects(() => lerAbas(sheetsFalso({}), '', ['Jogadores']), /ID da planilha/);
  await assert.rejects(() => lerAbas(sheetsFalso({}), undefined, ['Jogadores']), /ID da planilha/);
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/grupo.test.mjs; node tests/backend/planilha-abas.test.mjs`
Expected: `Cannot find module '../../scripts/lib/grupo.js'` e, no segundo, `lerAbas is not a function`.

- [ ] **Step 3: Criar `scripts/lib/grupo.js`**

```js
// Configuração de cada grupo: tudo o que muda entre o Terça (schema "public") e o Meme (schema "meme") fica aqui.
// Escolha pela variável GRUPO do ambiente (padrão: terca). Não guarda segredo: só NOMES de variáveis, de schema e de bucket.
const path = require('node:path');

const GRUPOS = {
  terca: {
    schema: 'public', bucket: 'fotos',
    spreadsheetIdVar: 'SPREADSHEET_ID_TERCA', adminPasswordVar: 'ADMIN_PASSWORD',
    htmlVar: 'HTML_TERCA', htmlPadrao: 'volei-dashboard.html'
  },
  meme: {
    schema: 'meme', bucket: 'fotos-meme',
    spreadsheetIdVar: 'SPREADSHEET_ID_MEME', adminPasswordVar: 'MEME_ADMIN_PASSWORD',
    htmlVar: 'HTML_MEME', htmlPadrao: path.join('..', 'voleimeme', 'index.html') // relativo à raiz do repositório volei
  }
};

function configDoGrupo(env = process.env) {
  const nome = String(env.GRUPO || 'terca').trim().toLowerCase();
  const g = GRUPOS[nome];
  if (!g) throw new Error('GRUPO inválido: "' + nome + '" (use terca ou meme)');
  return { grupo: nome, ...g, spreadsheetId: env[g.spreadsheetIdVar] || '' };
}

// opções do createClient do supabase-js: o schema "public" é o padrão dele; os outros precisam ser pedidos
function opcoesDoCliente(cfg) {
  return cfg.schema === 'public' ? {} : { db: { schema: cfg.schema } };
}

module.exports = { configDoGrupo, opcoesDoCliente, GRUPOS };
```

- [ ] **Step 4: Substituir `scripts/lib/planilha.js`**

```js
// Lê as abas de uma planilha (Terça ou Meme) via Google Sheets API, autenticado como service account.
// Não faz nenhuma transformação de dado — devolve os valores crus, linha 0 = cabeçalho.
const { google } = require('googleapis');

const ABAS = [
  'Jogadores', 'Rodadas', 'Config', 'Checkins', 'Usuarios',
  'FinDias', 'FinPagamentos', 'FinCreditos', 'FinLancamentos', 'FinLog',
  'AoVivo', 'AoVivoLog'
];

async function autenticar() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// O Google responde 400 "Unable to parse range: <aba>" quando a aba não existe (o Meme nunca usou crédito, então não tem FinCreditos:
// o Apps Script só cria a aba na primeira gravação). Isso é dado vazio, não erro; qualquer outro erro continua subindo.
const abaInexistente = (e) => !!e && (e.code === 400 || e.status === 400) && /Unable to parse range/i.test(String(e.message || ''));

// "sheets" vem por injeção (o teste passa um falso)
async function lerAbas(sheets, spreadsheetId, abas = ABAS) {
  if (!spreadsheetId) throw new Error('ID da planilha não informado (SPREADSHEET_ID_TERCA ou SPREADSHEET_ID_MEME no .env)');
  const dados = {};
  const ausentes = [];
  for (const aba of abas) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: aba, valueRenderOption: 'FORMATTED_VALUE' });
      dados[aba] = resp.data.values || [];
    } catch (e) {
      if (!abaInexistente(e)) throw e;
      dados[aba] = [];
      ausentes.push(aba);
    }
  }
  return { dados, ausentes };
}

async function lerPlanilha(spreadsheetId) {
  const { dados, ausentes } = await lerAbas(await autenticar(), spreadsheetId);
  if (ausentes.length) console.log('Abas que não existem na planilha (tratadas como vazias): ' + ausentes.join(', '));
  return dados;
}

const lerPlanilhaTerca = () => lerPlanilha(process.env.SPREADSHEET_ID_TERCA);

module.exports = { lerPlanilha, lerPlanilhaTerca, lerAbas, ABAS };
```

- [ ] **Step 5: Rodar os testes**

Run: `node tests/backend/grupo.test.mjs && node tests/backend/planilha-abas.test.mjs`
Expected: os dois terminam com `TODOS OS TESTES PASSARAM` (4 casos cada).

- [ ] **Step 6: Registrar na suíte, rodar a suíte inteira e commitar**

Em `package.json`, no fim de `test:backend`, acrescentar `&& node tests/backend/grupo.test.mjs && node tests/backend/planilha-abas.test.mjs`.
Run: `npm run test:backend`
Expected: `TODOS OS TESTES PASSARAM` no último arquivo e saída 0 (a suíte roda em sequência com `&&`).

```bash
git add scripts/lib/grupo.js scripts/lib/planilha.js tests/backend/grupo.test.mjs tests/backend/planilha-abas.test.mjs package.json
git commit -m "feat: configuração por grupo (GRUPO=meme) e leitura da planilha tolerante a aba ausente

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Scripts e servidor local por grupo, mais conferências do banco

**Files:**
- Modify: `scripts/migrar-terca-supabase.js`, `scripts/migrar-fotos.js`, `scripts/criar-bucket-fotos.js`, `backend/servidor-local.js`
- Create: `scripts/verificar-schema-grupo.js`, `scripts/comparar-migracao.js`
- Create: `tests/backend/scripts-por-grupo.test.mjs`
- Modify: `package.json` (scripts `verificar-schema`, `comparar-migracao`; teste na suíte)

**Interfaces:**
- Consumes: `configDoGrupo`, `opcoesDoCliente` (Task 3); `lerPlanilha` (Task 3); `criarArmazenamentoSupabase({ bucket })` (Task 2).
- Produces: `GRUPO=meme npm run migrar | migrar-fotos | criar-bucket-fotos | verificar-schema | comparar-migracao`; `GRUPO=meme node backend/servidor-local.js`. Sem `GRUPO`, comportamento idêntico ao de hoje.

- [ ] **Step 1: Teste estático (falha: os scripts ainda têm "fotos" fixo e não usam o grupo)**

Criar `tests/backend/scripts-por-grupo.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ta, fim } from './executor.mjs';

const raiz = path.join(import.meta.dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (t) => t.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

await ta('scripts de fotos não têm o bucket "fotos" fixo (usam o bucket do grupo)', () => {
  for (const rel of ['scripts/migrar-fotos.js', 'scripts/criar-bucket-fotos.js']) {
    const c = semComentarios(ler(rel));
    assert.match(c, /configDoGrupo\(/, rel);
    assert.doesNotMatch(c, /['"]fotos['"]/, rel + ' ainda tem "fotos" fixo');
    assert.doesNotMatch(c, /object\/public\/fotos\//, rel + ' ainda tem a URL do bucket fixa');
    assert.match(c, /cfg\.bucket/, rel);
  }
});

await ta('migração dos dados e verificações abrem o cliente NO schema do grupo e a planilha do grupo', () => {
  const mig = semComentarios(ler('scripts/migrar-terca-supabase.js'));
  assert.match(mig, /opcoesDoCliente\(cfg\)/);
  assert.match(mig, /lerPlanilha\(cfg\.spreadsheetId\)/);
  assert.doesNotMatch(mig, /lerPlanilhaTerca/);
  for (const rel of ['scripts/verificar-schema-grupo.js', 'scripts/comparar-migracao.js']) {
    assert.match(semComentarios(ler(rel)), /opcoesDoCliente\(cfg\)/, rel);
  }
});

await ta('servidor local usa schema, bucket, senha e HTML do grupo', () => {
  const s = semComentarios(ler('backend/servidor-local.js'));
  assert.match(s, /opcoesDoCliente\(cfg\)/);
  assert.match(s, /bucket: cfg\.bucket/);
  assert.match(s, /process\.env\[cfg\.adminPasswordVar\]/);
  assert.match(s, /process\.env\[cfg\.htmlVar\]/);
  assert.doesNotMatch(s, /process\.env\.ADMIN_PASSWORD/);
});

fim();
```

Run: `node tests/backend/scripts-por-grupo.test.mjs`
Expected: 3 `FALHA`.

- [ ] **Step 2: `scripts/criar-bucket-fotos.js` — substituir o arquivo inteiro**

```js
// Cria (ou ajusta) o bucket público de fotos do grupo no Supabase Storage. Idempotente: pode rodar quantas vezes quiser.
// Uso: npm run criar-bucket-fotos                 (Terça: bucket "fotos")
//      $env:GRUPO='meme'; npm run criar-bucket-fotos   (Meme: bucket "fotos-meme")
// Precisa do .env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { configDoGrupo, opcoesDoCliente } = require('./lib/grupo');

// mesmos limites que o backend impõe no envio (300 KB, só JPEG): defesa em dobro para um bucket público
const OPCOES = { public: true, fileSizeLimit: 300 * 1024, allowedMimeTypes: ['image/jpeg'] };

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }
  const cfg = configDoGrupo();
  const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));
  const { data: existentes, error: erroLista } = await cliente.storage.listBuckets();
  if (erroLista) throw new Error('Não consegui listar os buckets: ' + erroLista.message);

  if (existentes.some((b) => b.name === cfg.bucket)) {
    const { error } = await cliente.storage.updateBucket(cfg.bucket, OPCOES);
    if (error) throw new Error('Não consegui atualizar o bucket ' + cfg.bucket + ': ' + error.message);
    console.log('Bucket "' + cfg.bucket + '" já existia: ajustado para público, máximo 300 KB, somente image/jpeg.');
  } else {
    const { error } = await cliente.storage.createBucket(cfg.bucket, OPCOES);
    if (error) throw new Error('Não consegui criar o bucket ' + cfg.bucket + ': ' + error.message);
    console.log('Bucket "' + cfg.bucket + '" criado: público, máximo 300 KB, somente image/jpeg.');
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 3: `scripts/migrar-fotos.js` — 5 edições**

1. Trocar
```js
const { createClient } = require('@supabase/supabase-js');

const LIMITE_BYTES = 300 * 1024;
const DRIVE = /(drive\.google\.com|googleusercontent\.com|usercontent\.google\.com)/;
const NOSSO_STORAGE = '/storage/v1/object/public/fotos/';
```
por
```js
const { createClient } = require('@supabase/supabase-js');
const { configDoGrupo, opcoesDoCliente } = require('./lib/grupo');

const cfg = configDoGrupo(); // GRUPO=meme usa o schema e o bucket do Meme; sem GRUPO, o Terça (como sempre)
const LIMITE_BYTES = 300 * 1024;
const DRIVE = /(drive\.google\.com|googleusercontent\.com|usercontent\.google\.com)/;
const NOSSO_STORAGE = '/storage/v1/object/public/' + cfg.bucket + '/';
```
2. Trocar `const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);` por `const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));`
3. Trocar (replace_all) `cliente.storage.from('fotos')` por `cliente.storage.from(cfg.bucket)` (duas ocorrências: upload e remove).
4. Trocar `console.log(aplicar ? 'MODO APLICAR: vai copiar e atualizar.' : 'SIMULAÇÃO (nada será baixado nem gravado). Use --aplicar para valer.');` por
```js
  console.log('Grupo: ' + cfg.grupo + ' (schema ' + cfg.schema + ', bucket ' + cfg.bucket + ')');
  console.log(aplicar ? 'MODO APLICAR: vai copiar e atualizar.' : 'SIMULAÇÃO (nada será baixado nem gravado). Use --aplicar para valer.');
```
5. Na linha 1 (comentário), trocar `para o bucket "fotos" do Supabase` por `para o bucket do grupo (fotos ou fotos-meme) do Supabase`.

- [ ] **Step 4: `scripts/migrar-terca-supabase.js` — 3 edições**

1. Trocar
```js
const { lerPlanilhaTerca } = require('./lib/planilha');
```
por
```js
const { lerPlanilha } = require('./lib/planilha');
const { configDoGrupo, opcoesDoCliente } = require('./lib/grupo');
```
2. Trocar `const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);` por
```js
const cfg = configDoGrupo(); // GRUPO=meme migra a planilha do Meme para o schema "meme"; sem GRUPO, o Terça (como sempre)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));
```
3. Trocar `  const dados = await lerPlanilhaTerca();` por
```js
  console.log('Grupo: ' + cfg.grupo + ' (schema ' + cfg.schema + ')');
  const dados = await lerPlanilha(cfg.spreadsheetId);
```

- [ ] **Step 5: `backend/servidor-local.js` — 5 edições**

1. Depois da linha `const { createClient } = require('@supabase/supabase-js');` acrescentar:
```js
const { configDoGrupo, opcoesDoCliente } = require('../scripts/lib/grupo.js');
const cfg = configDoGrupo(); // GRUPO=meme: schema, bucket, senha (MEME_ADMIN_PASSWORD) e HTML (HTML_MEME) do Meme
```
2. Trocar `const obrigatorias = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD', 'GOOGLE_CLIENT_ID'];` por `const obrigatorias = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', cfg.adminPasswordVar, 'GOOGLE_CLIENT_ID'];`
3. Trocar `const arquivoHtml = process.env.HTML_TERCA || path.join(raiz, 'volei-dashboard.html');` por `const arquivoHtml = process.env[cfg.htmlVar] || path.join(raiz, cfg.htmlPadrao);`
4. Trocar `const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);` por `const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));`
5. Trocar `armazenamento: criarArmazenamentoSupabase({ cliente, urlBase: process.env.SUPABASE_URL }),` por `armazenamento: criarArmazenamentoSupabase({ cliente, urlBase: process.env.SUPABASE_URL, bucket: cfg.bucket }),` e `config: { adminPassword: process.env.ADMIN_PASSWORD },` por `config: { adminPassword: process.env[cfg.adminPasswordVar] },`.
Também na primeira linha do arquivo, acrescentar ao comentário `Uso: ... GRUPO=meme para o Meme (schema meme).`

- [ ] **Step 6: Criar `scripts/verificar-schema-grupo.js`**

```js
// Confere o schema de um grupo no banco REAL: conta as linhas de cada tabela e prova que as funções enxergam o schema certo.
// Somente leitura (a única chamada que "escreve" é remover_rodada com um id que não existe: devolve false e não muda nada).
// Uso: npm run verificar-schema                       (Terça)
//      $env:GRUPO='meme'; npm run verificar-schema    (Meme)
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { configDoGrupo, opcoesDoCliente } = require('./lib/grupo');

const TABELAS = [
  'jogadores', 'rodadas', 'times_rodada', 'time_jogadores', 'checkins', 'usuarios', 'config',
  'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'ao_vivo', 'ao_vivo_log',
  'travas', 'limite_tentativas'
];

async function main() {
  const cfg = configDoGrupo();
  const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));
  console.log('Grupo ' + cfg.grupo + ' (schema ' + cfg.schema + ')');
  let problemas = 0;
  for (const t of TABELAS) {
    const { count, error } = await cliente.from(t).select('*', { count: 'exact', head: true });
    if (error) { problemas++; console.log('  FALHA ' + t + ': ' + error.message); }
    else console.log('  ok    ' + t + ': ' + count + ' linha(s)');
  }
  const r = await cliente.rpc('remover_rodada', { p_id: '__inexistente__' });
  if (r.error || r.data !== false) {
    problemas++;
    console.log('  FALHA rpc remover_rodada: ' + (r.error ? r.error.message : 'devolveu ' + JSON.stringify(r.data) + ' (esperado false)'));
  } else console.log('  ok    rpc remover_rodada (a função enxerga as tabelas do schema)');
  console.log(problemas ? '\n' + problemas + ' problema(s).' : '\nSchema em ordem.');
  process.exit(problemas ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 7: Criar `scripts/comparar-migracao.js`**

```js
// Compara as linhas da planilha do grupo com as do schema do grupo, depois de "npm run migrar". Somente leitura.
// Uso: $env:GRUPO='meme'; npm run comparar-migracao       (sem GRUPO compara o Terça)
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { lerPlanilha } = require('./lib/planilha');
const { configDoGrupo, opcoesDoCliente } = require('./lib/grupo');

// mesma regra do migrar: só conta linha de dados com a 1ª coluna preenchida
const linhas = (aba) => (aba || []).slice(1).filter((l) => l[0]).length;
const unicos = (aba, col) => new Set((aba || []).slice(1).filter((l) => l[0]).map((l) => l[col])).size;

async function contar(cliente, tabela) {
  const { count, error } = await cliente.from(tabela).select('*', { count: 'exact', head: true });
  if (error) throw new Error(tabela + ': ' + error.message);
  return count;
}

async function main() {
  const cfg = configDoGrupo();
  const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));
  const d = await lerPlanilha(cfg.spreadsheetId);
  const cabRodadas = (d.Rodadas || [])[0] || [];
  const colRound = Math.max(0, cabRodadas.indexOf('roundId'));
  // [rótulo, esperado (planilha), tabela, modo]: "min" = o banco pode ter MAIS (convidados viram linhas de jogadores);
  // "log" = o banco pode ter MENOS (o migrar só carrega fin_log quando a tabela está vazia, então numa re-migração o log novo não entra)
  const pares = [
    ['Jogadores', linhas(d.Jogadores), 'jogadores', 'min'],
    ['Rodadas (rodadas únicas)', unicos(d.Rodadas, colRound), 'rodadas'],
    ['Rodadas (times)', linhas(d.Rodadas), 'times_rodada'],
    ['Checkins', linhas(d.Checkins), 'checkins'],
    ['Usuarios', linhas(d.Usuarios), 'usuarios'],
    ['Config', (d.Config || []).filter((l) => l[0]).length, 'config'],
    ['FinDias', linhas(d.FinDias), 'fin_dias'],
    ['FinPagamentos', linhas(d.FinPagamentos), 'fin_pagamentos'],
    ['FinCreditos', linhas(d.FinCreditos), 'fin_creditos'],
    ['FinLancamentos', linhas(d.FinLancamentos), 'fin_lancamentos'],
    ['FinLog', linhas(d.FinLog), 'fin_log', 'log']
  ];
  console.log('Grupo ' + cfg.grupo + ': planilha x schema "' + cfg.schema + '"');
  let diferentes = 0;
  for (const [rotulo, esperado, tabela, modo] of pares) {
    const no = await contar(cliente, tabela);
    const ok = modo === 'min' ? no >= esperado : modo === 'log' ? no <= esperado : no === esperado;
    if (!ok) diferentes++;
    const nota = modo === 'min' ? ' (o banco também tem os convidados)' : modo === 'log' ? ' (o log só é carregado com a tabela vazia)' : '';
    console.log('  ' + (ok ? 'ok       ' : 'DIFERENTE') + ' ' + rotulo + ': planilha ' + esperado + ' | banco ' + no + nota);
  }
  console.log(diferentes ? '\n' + diferentes + ' diferença(s): reveja as exceções do "npm run migrar".' : '\nTudo confere.');
  process.exit(diferentes ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 8: `package.json` e checagens**

Em `package.json`, trocar `"gerar-sql-meme": "node scripts/gerar-sql-grupo.js"` por
`"gerar-sql-meme": "node scripts/gerar-sql-grupo.js",\n    "verificar-schema": "node scripts/verificar-schema-grupo.js",\n    "comparar-migracao": "node scripts/comparar-migracao.js"`
e acrescentar `&& node tests/backend/scripts-por-grupo.test.mjs` ao fim de `test:backend`.

Run:
```bash
node --check scripts/migrar-terca-supabase.js && node --check scripts/migrar-fotos.js && node --check scripts/criar-bucket-fotos.js && node --check scripts/verificar-schema-grupo.js && node --check scripts/comparar-migracao.js && node --check backend/servidor-local.js && echo SINTAXE_OK
node tests/backend/scripts-por-grupo.test.mjs
GRUPO=xx node backend/servidor-local.js
```
Expected: `SINTAXE_OK`; `TODOS OS TESTES PASSARAM` (3 casos); e o servidor local encerra com `GRUPO inválido: "xx" (use terca ou meme)` (sem subir).

- [ ] **Step 9: Suíte inteira e commit**

Run: `npm run test:backend`  — Expected: termina sem falhas (saída 0).

```bash
git add scripts/migrar-terca-supabase.js scripts/migrar-fotos.js scripts/criar-bucket-fotos.js scripts/verificar-schema-grupo.js scripts/comparar-migracao.js backend/servidor-local.js tests/backend/scripts-por-grupo.test.mjs package.json
git commit -m "feat: scripts de migração, fotos, verificação e servidor local por grupo (GRUPO=meme)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Função `meme-api`

**Files:**
- Create: `supabase/functions/meme-api/index.ts`
- Modify: `scripts/preparar-edge.js`, `supabase/config.toml`, `.gitignore`
- Create: `tests/backend/meme-api-index.test.mjs`
- Modify: `package.json` (teste na suíte)

**Interfaces:**
- Consumes: `criarArmazenamentoSupabase({ bucket })` (Task 2); os módulos de `backend/` já existentes.
- Produces: `npm run preparar-edge -- meme-api` (copia `backend/*.js` para `supabase/functions/meme-api/backend/`); `validarNomeFuncao(nome)` exportado por `scripts/preparar-edge.js` (devolve o nome ou lança); função `meme-api` pronta para `supabase functions deploy`, lendo `MEME_ADMIN_PASSWORD`, `MEME_ORIGENS_PERMITIDAS` e `GOOGLE_CLIENT_ID`, com `db: { schema: 'meme' }` e bucket `fotos-meme`.

- [ ] **Step 1: Escrever o teste (falha: nada disso existe)**

Criar `tests/backend/meme-api-index.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ta, fim } from './executor.mjs';

const { validarNomeFuncao } = createRequire(import.meta.url)('../../scripts/preparar-edge.js');
const raiz = path.join(import.meta.dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (t) => t.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

await ta('validarNomeFuncao aceita nomes de função e recusa caminhos/estranhos', () => {
  assert.equal(validarNomeFuncao('meme-api'), 'meme-api');
  assert.equal(validarNomeFuncao('terca-api-teste'), 'terca-api-teste');
  for (const ruim of ['', '../x', 'a/b', 'Meme', 'meme api', 'meme;rm', '-x', undefined]) {
    assert.throws(() => validarNomeFuncao(ruim), /nome de função/i, JSON.stringify(ruim));
  }
});

await ta('meme-api lê só segredos MEME_* (e o GOOGLE_CLIENT_ID compartilhado), no schema meme e no bucket fotos-meme', () => {
  const c = semComentarios(ler('supabase/functions/meme-api/index.ts'));
  assert.match(c, /'MEME_ADMIN_PASSWORD'/);
  assert.match(c, /'MEME_ORIGENS_PERMITIDAS'/);
  assert.match(c, /'GOOGLE_CLIENT_ID'/);
  assert.match(c, /db:\s*\{\s*schema:\s*'meme'\s*\}/);
  assert.match(c, /bucket:\s*'fotos-meme'/);
  // nunca os nomes do Terça (senão uma senha/origem do Terça valeria no Meme)
  assert.doesNotMatch(c, /'ADMIN_PASSWORD'/);
  assert.doesNotMatch(c, /'ORIGENS_PERMITIDAS'/);
  assert.doesNotMatch(c, /terca/i);
});

await ta('a função do Terça continua sem qualquer menção ao Meme (produção intocada)', () => {
  const c = ler('supabase/functions/terca-api-teste/index.ts');
  assert.doesNotMatch(c, /meme/i);
  assert.match(c, /'ADMIN_PASSWORD'/);
});

await ta('config.toml liga verify_jwt=false para as duas funções e .gitignore cobre backend/ gerado de qualquer função', () => {
  const t = ler('supabase/config.toml');
  assert.match(t, /\[functions\.terca-api-teste\]\s*\r?\nverify_jwt = false/);
  assert.match(t, /\[functions\.meme-api\]\s*\r?\nverify_jwt = false/);
  assert.match(ler('.gitignore'), /^supabase\/functions\/\*\/backend\/\r?$/m);
});

fim();
```

Run: `node tests/backend/meme-api-index.test.mjs`
Expected: falha (`validarNomeFuncao is not a function` e arquivos ausentes).

- [ ] **Step 2: Criar `supabase/functions/meme-api/index.ts`**

```ts
// Edge Function do backend do Vôlei Meme Brasil (Deno). Mesma casca da terca-api-teste, mas: schema "meme" do banco,
// bucket "fotos-meme" e segredos com prefixo MEME_ (os segredos das funções são do projeto inteiro, então não podem colidir com os do Terça).
// Os módulos de ./backend/ são gerados por "npm run preparar-edge -- meme-api" (cópia de backend/*.js).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { criarHandler } from './backend/handler.js';
import { criarEdge } from './backend/edge.js';
import { criarRepoSupabase } from './backend/repo-supabase.js';
import { criarArmazenamentoSupabase } from './backend/armazenamento-supabase.js';
import { criarVerificadorGoogle } from './backend/auth.js';
import { criarLimitador } from './backend/limitador.js';

const NOMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MEME_ADMIN_PASSWORD', 'GOOGLE_CLIENT_ID', 'MEME_ORIGENS_PERMITIDAS'];
const env = (nome: string): string => (Deno.env.get(nome) ?? '').trim();
const faltando = NOMES.filter((nome) => !env(nome));
if (faltando.length) console.error('Faltam variáveis de ambiente na função: ' + faltando.join(', '));
const senhaCurta = env('MEME_ADMIN_PASSWORD') !== '' && env('MEME_ADMIN_PASSWORD').length < 20;
if (senhaCurta) console.error('MEME_ADMIN_PASSWORD tem menos de 20 caracteres: use uma senha longa e aleatória.');

const recusar = (): Response => new Response(JSON.stringify({ error: 'Configuração incompleta no servidor.' }), {
  status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

if (faltando.length || senhaCurta) {
  Deno.serve(recusar); // nunca sobe "meio configurada": toda requisição recebe 500
} else {
  const cliente = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false }, // função sem sessão: nada a guardar nem renovar
    db: { schema: 'meme' }
  });
  const registrar = (erro: unknown) => console.error('erro inesperado:', erro instanceof Error ? erro.message : 'desconhecido');
  const repo = criarRepoSupabase(cliente);
  const handler = criarHandler({
    repo,
    armazenamento: criarArmazenamentoSupabase({ cliente, urlBase: env('SUPABASE_URL'), bucket: 'fotos-meme' }),
    config: { adminPassword: env('MEME_ADMIN_PASSWORD') },
    verificarToken: criarVerificadorGoogle({ clientId: env('GOOGLE_CLIENT_ID') }),
    limitador: criarLimitador({ repo }),
    avisar: (...a: unknown[]) => console.error(...a),
    ocultarErrosInternos: true, // cliente anônimo nunca vê texto de banco; a mensagem real vai só para o log
    registrar
  });
  Deno.serve(criarEdge({
    handler,
    origensPermitidas: env('MEME_ORIGENS_PERMITIDAS').split(','),
    registrar
  }));
}
```

- [ ] **Step 3: `scripts/preparar-edge.js` — nome da função por argumento**

1. Acima de `function executar()` acrescentar:
```js
// O nome vira parte de um caminho: só minúsculas, dígitos e hífen (nada de "../" nem espaço).
function validarNomeFuncao(nome) {
  if (typeof nome !== 'string' || !/^[a-z][a-z0-9-]{1,60}$/.test(nome)) {
    throw new Error('nome de função inválido: ' + JSON.stringify(nome) + ' (use minúsculas, dígitos e hífen, ex.: meme-api)');
  }
  return nome;
}
```
2. Trocar a assinatura e o destino:
`function executar() {` -> `function executar(nomeFuncao = 'terca-api-teste') {`
`  const destino = path.join(raiz, 'supabase', 'functions', 'terca-api-teste', 'backend');` ->
```js
  const nome = validarNomeFuncao(nomeFuncao);
  if (!fs.existsSync(path.join(raiz, 'supabase', 'functions', nome, 'index.ts'))) {
    console.error('A função "' + nome + '" não existe em supabase/functions/ (falta o index.ts).');
    process.exit(1);
  }
  const destino = path.join(raiz, 'supabase', 'functions', nome, 'backend');
```
3. Trocar a mensagem final `console.log(\`Copiados ${plano.copiar.length} arquivos para supabase/functions/terca-api-teste/backend/ (ignorados: ...)\`)` por `console.log(\`Copiados ${plano.copiar.length} arquivos para supabase/functions/${nome}/backend/ (ignorados: ${plano.ignorados.join(', ')})\`);`
4. Trocar `if (require.main === module) executar();` por `if (require.main === module) executar(process.argv[2]);` e `module.exports = { planejarCopia, deveCopiar };` por `module.exports = { planejarCopia, deveCopiar, validarNomeFuncao };`
5. Na linha 1 e 4 dos comentários, acrescentar: `Uso: npm run preparar-edge [-- nome-da-função]  (padrão: terca-api-teste).`

- [ ] **Step 4: `supabase/config.toml` e `.gitignore`**

Em `supabase/config.toml`, trocar a primeira linha de comentário por `# Configuração mínima do Supabase CLI para publicar as funções do projeto (terca-api-teste e meme-api). Não há "supabase start" nem migrações aqui:` e acrescentar ao fim:
```toml

[functions.meme-api]
verify_jwt = false
```
Em `.gitignore`, trocar a linha `supabase/functions/terca-api-teste/backend/` por `supabase/functions/*/backend/`.

- [ ] **Step 5: Rodar o teste e a suíte**

Run: `node tests/backend/meme-api-index.test.mjs`
Expected: `TODOS OS TESTES PASSARAM` (4 casos).
Em `package.json`, acrescentar `&& node tests/backend/meme-api-index.test.mjs` ao fim de `test:backend`, e rodar `npm run test:backend` (sai com 0; inclui o `preparar-edge.test.mjs` antigo).

- [ ] **Step 6: Preparar e conferir a pasta gerada (sem publicar nada)**

Run: `npm run preparar-edge -- meme-api && ls supabase/functions/meme-api/backend | head -30 && git status --short | grep -c "functions/meme-api/backend"`
Expected: `Copiados N arquivos para supabase/functions/meme-api/backend/ ...`, lista dos módulos, e `0` (a pasta gerada não aparece no git).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/meme-api/index.ts scripts/preparar-edge.js supabase/config.toml .gitignore tests/backend/meme-api-index.test.mjs package.json
git commit -m "feat: função meme-api (schema meme, bucket fotos-meme, segredos MEME_*) e preparar-edge por nome

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Schema, bucket, dados e fotos do Meme no Supabase (sem publicar nada ao grupo)

**Files:** nenhum arquivo do repositório; executa o que as Tasks 1 a 5 produziram contra o Supabase real. Escreve **só** no schema `meme` e no bucket `fotos-meme`.

**Interfaces:**
- Consumes: `sql/meme/schema-meme-supabase.sql` (Task 1), `npm run criar-bucket-fotos`, `migrar`, `comparar-migracao`, `verificar-schema`, `migrar-fotos` com `GRUPO=meme` (Tasks 3 e 4).
- Produces: schema `meme` criado e exposto, com os dados da planilha do Meme migrados e as fotos copiadas; o Terça idêntico ao "antes".

Todos os comandos em **VOLEI**, PowerShell. Nunca deixar `GRUPO` definido depois da tarefa: `Remove-Item Env:GRUPO`.

- [ ] **Step 1: Foto do Terça ANTES (referência para provar que nada mudou)**

Run: `npm run verificar-schema | Tee-Object -FilePath "$env:TEMP\terca-antes.txt"`
Expected: `Grupo terca (schema public)`, todas as linhas `ok`, terminando com `Schema em ordem.` (guarda as contagens).

- [ ] **Step 2: [USUÁRIO] Criar o schema `meme`**

No Supabase Dashboard (projeto `lzwmirrjpoqucwlhgkku`) > **SQL Editor** > New query: colar TODO o conteúdo de `sql/meme/schema-meme-supabase.sql` (abrir o arquivo no VS Code, Ctrl+A, Ctrl+C) e clicar **Run**.
Expected: `Success. No rows returned`. Se der erro, o usuário me cola a mensagem (é seguro rodar de novo: o cabeçalho usa `create schema if not exists`, mas o `create table` da base falha na segunda vez com "already exists": nesse caso, avisar antes de repetir).

- [ ] **Step 3: [USUÁRIO] Expor o schema na API**

Dashboard > **Project Settings** > **API** (ou "Data API") > **Exposed schemas**: acrescentar `meme` à lista (mantendo `public`) e **Save**.

- [ ] **Step 4: Verificar o schema `meme`**

Run: `$env:GRUPO='meme'; npm run verificar-schema; Remove-Item Env:GRUPO`
Expected: `Grupo meme (schema meme)`, 16 linhas `ok ... 0 linha(s)`, `ok rpc remover_rodada`, `Schema em ordem.`
Se aparecer `FALHA ...: The schema must be one of the following: public` ou `Invalid schema: meme`, o Step 3 não foi salvo: repetir. Se `permission denied for schema meme`, os grants do rodapé não rodaram: rodar de novo só o rodapé (do `-- ==== acesso e search_path` até o fim) no SQL Editor.

- [ ] **Step 5: Criar o bucket do Meme**

Run: `$env:GRUPO='meme'; npm run criar-bucket-fotos; Remove-Item Env:GRUPO`
Expected: `Bucket "fotos-meme" criado: público, máximo 300 KB, somente image/jpeg.`

- [ ] **Step 6: Migrar os dados do Meme**

Run: `$env:GRUPO='meme'; npm run migrar; Remove-Item Env:GRUPO`
Expected: `Grupo: meme (schema meme)`, `Abas que não existem na planilha (tratadas como vazias): FinCreditos`, e o `=== Resumo da migração ===` com contagens; sem a seção `=== Exceções ===`. Se houver exceções, revisar uma a uma com o usuário antes de seguir (não ignorar).

- [ ] **Step 7: Conferir contagens contra a planilha**

Run: `$env:GRUPO='meme'; npm run comparar-migracao; Remove-Item Env:GRUPO`
Expected: `ok` em todas as linhas e `Tudo confere.` (Jogadores pode mostrar banco > planilha: são os convidados). `DIFERENTE` = parar e investigar.

- [ ] **Step 8: Fotos — simulação e depois de verdade**

Run: `$env:GRUPO='meme'; npm run migrar-fotos` (simulação; lista o que faria) e, se a lista estiver sensata, `npm run migrar-fotos -- --aplicar; Remove-Item Env:GRUPO`
Expected: `Grupo: meme (schema meme, bucket fotos-meme)` e `Resumo: N migrada(s), 0 já no Storage, ... 0 falha(s)`. Fotos que forem puladas (não JPEG, > 300 KB, ou Drive devolveu página por não estar como "qualquer pessoa com o link") ficam listadas: revisar com o usuário.

- [ ] **Step 9: Provar que o Terça não mudou**

Run: `npm run verificar-schema | Tee-Object -FilePath "$env:TEMP\terca-depois.txt"; Compare-Object (Get-Content "$env:TEMP\terca-antes.txt") (Get-Content "$env:TEMP\terca-depois.txt")`
Expected: nenhuma diferença nas tabelas `jogadores`, `rodadas`, `times_rodada`, `time_jogadores` e `config` (o `Compare-Object` não imprime essas linhas). Diferenças pequenas em `checkins`, `fin_*`, `usuarios`, `travas` e `limite_tentativas` podem ser uso normal do grupo do Terça entre os dois passos (check-in, pagamento, tentativa de senha): conferir se batem com isso. Qualquer diferença em `jogadores`/`rodadas`/`times_rodada`/`time_jogadores`/`config` = PARAR: algo tocou o `public`.

- [ ] **Step 10: Registrar na memória do projeto**

Atualizar `project_meme_supabase.md` (memória) com: schema `meme` criado e exposto, bucket `fotos-meme`, dados e fotos migrados em `<data>`, Terça verificado idêntico. Sem commit (a memória não é do repositório).

---

### Task 7: Publicar a função `meme-api` e os segredos (só com localhost liberado para teste)

**Files:** nenhum arquivo do repositório.

**Interfaces:**
- Consumes: função `meme-api` (Task 5), schema/dados (Task 6).
- Produces: função no ar em `https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/meme-api`, aceitando escrita de `https://libertsapp.github.io` **e de `http://localhost:8000` (só até a Task 9)**.

**Publicar a função é uma ação de produção: pedir OK ao usuário antes do Step 4.** Ela só é usada por quem apontar para a URL dela; o app do Meme continua no Apps Script.

- [ ] **Step 1: [USUÁRIO] Gerar a senha mestra do Meme (43 caracteres) e guardá-la**

No PowerShell, sem mostrar na tela:
```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $b = New-Object byte[] 32; $rng.GetBytes($b); $rng.Dispose()
$env:NOVA_SENHA_MEME = [Convert]::ToBase64String($b).TrimEnd('=').Replace('+','-').Replace('/','_')
Remove-Variable b
$env:NOVA_SENHA_MEME.Length
$env:NOVA_SENHA_MEME | Set-Clipboard
```
Expected: `43`. Colar no gerenciador de senhas ("Vôlei Meme - função Supabase"), depois `Set-Clipboard -Value $null`. **Manter a mesma janela do PowerShell aberta** até o Step 3.

- [ ] **Step 2: Gravar os segredos (mesma janela)**

Run (em VOLEI):
```powershell
npx supabase secrets set MEME_ADMIN_PASSWORD=$env:NOVA_SENHA_MEME MEME_ORIGENS_PERMITIDAS=https://libertsapp.github.io,http://localhost:8000
Remove-Item Env:NOVA_SENHA_MEME
```
Expected: escolher o projeto único com Enter e ver `Finished supabase secrets set.` (o `GOOGLE_CLIENT_ID` já existe e é o mesmo; não regravar). Conferir só nomes: `npx supabase secrets list` deve mostrar `MEME_ADMIN_PASSWORD`, `MEME_ORIGENS_PERMITIDAS` além dos do Terça.

- [ ] **Step 3: Preparar e publicar (com OK do usuário)**

Run: `npm run preparar-edge -- meme-api && npx supabase functions deploy meme-api --no-verify-jwt`
Expected: `Copiados N arquivos ...`, linhas `Uploading asset (meme-api): ...` e `Deployed Functions on project lzwmirrjpoqucwlhgkku: meme-api`. O aviso `Docker is not running` é normal. Se reclamar do Docker de verdade, acrescentar `--use-api`.

- [ ] **Step 4: Testar a função (leitura dos dados do MEME; e o Terça intacto)**

```powershell
$m = 'https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/meme-api'
$t = 'https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste'
(curl.exe -s $m | ConvertFrom-Json).players.Count
(curl.exe -s $t | ConvertFrom-Json).players.Count
curl.exe -s -X POST -H "Content-Type: text/plain" -d '{\"action\":\"lerAoVivo\"}' $m
curl.exe -s -i -X POST -H "Origin: http://localhost:8000" -H "Content-Type: text/plain" -d '{\"action\":\"lerAoVivo\"}' $m | Select-String "HTTP/|access-control-allow-origin"
```
Expected: o 1º número = jogadores do Meme (confere com o `comparar-migracao`); o 2º = o de sempre do Terça (rodar o mesmo comando do Terça ANTES do Step 3 para ter a referência); o POST sem `Origin` devolve `{"error":"Origem não permitida."}`; o POST com `Origin: http://localhost:8000` devolve `200` com `Access-Control-Allow-Origin: http://localhost:8000`.
Se vier `Configuração incompleta no servidor.`: ver os logs em Supabase > Edge Functions > meme-api > Logs (dizem quais nomes faltam).

- [ ] **Step 5: Provar que a função do Meme lê o schema `meme` e a do Terça o `public`**

```powershell
(curl.exe -s $m | ConvertFrom-Json).players[0].nome
(curl.exe -s $t | ConvertFrom-Json).players[0].nome
```
Expected: nomes diferentes (o do Terça continua `BRUNA`). Se forem iguais, a função do Meme está lendo o schema errado: PARAR.

---

### Task 8: Teste local completo da página do Meme falando com a `meme-api`

**Files:** `.env` local (fora do git).

**Interfaces:**
- Consumes: função no ar com `localhost:8000` liberado (Task 7); `index.html` do Meme em MEME.
- Produces: conclusão de que login, admin, check-in, foto e financeiro funcionam contra o schema `meme` antes da virada.

- [ ] **Step 1: Completar o `.env` local (o servidor local exige estas duas variáveis mesmo com BACKEND_URL)**

Run (em VOLEI):
```powershell
Add-Content .env "GOOGLE_CLIENT_ID=986000653553-d5ri8n0k3kg6f1iii2e8c3v3854uuk3d.apps.googleusercontent.com"
Add-Content .env "MEME_ADMIN_PASSWORD=local-nao-usado-quando-BACKEND_URL-esta-definida"
```
Expected: sem saída. (A senha de mentira nunca é usada: com `BACKEND_URL` a página fala com a função, que tem a senha de verdade. `.env` está fora do git.) Se o `.env` já tiver essas linhas, pular.

- [ ] **Step 2: Subir o servidor local apontando para a função do Meme**

Run (em VOLEI; porta 8000 livre: se der `EADDRINUSE`, achar o processo com `Get-NetTCPConnection -LocalPort 8000 -State Listen` e encerrar o `node` dono):
```powershell
$env:GRUPO='meme'
$env:BACKEND_URL='https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/meme-api'
node backend/servidor-local.js
```
Expected: `... em http://localhost:8000 (página falando com o backend remoto configurado em BACKEND_URL)`. O servidor serve o `index.html` de `..\voleimeme` e reescreve o endereço da API para a função.

- [ ] **Step 3: [USUÁRIO] Percorrer o app em `http://localhost:8000` (Ctrl+F5)**

Conferir e marcar:
1. Aparece a identidade do **Meme** (nome, cores) e a lista de jogadores é a do Meme.
2. O login com o Google funciona e o perfil correto aparece.
3. O `ping` de admin com a **senha nova do Meme** (a do gerenciador) funciona e a antiga do Apps Script NÃO vale.
4. Check-in de teste feito e depois removido.
5. Troca de foto de um jogador de teste sobe e aparece (bucket `fotos-meme`).
6. Abas Financeiro e Ao Vivo abrem sem erro; nenhuma tela de chave mestra aparece sozinha ao recarregar.
Se algo falhar, anotar o passo e o que apareceu (os logs da função em Supabase > Edge Functions > meme-api > Logs ajudam).

- [ ] **Step 4: Encerrar**

Ctrl+C no servidor; depois `Remove-Item Env:GRUPO; Remove-Item Env:BACKEND_URL`.
Não há commit.

---

### Task 9: Virada do Meme (fora de horário de jogo, com OK explícito)

**Files:**
- Modify: `C:\Users\Heleno\OneDrive\Documentos\GitHub\voleimeme\index.html` (MEME)

**Interfaces:**
- Consumes: função `meme-api` testada (Task 8); OK do usuário para publicar, em horário sem jogo.
- Produces: `libertsapp.github.io/voleimeme/` em `Ver.: 13.0`, falando com a função; rollback = `git revert` do commit da virada.

**Antes de começar, perguntar ao usuário: "O jogo do Meme já acabou e posso publicar agora?"**

- [ ] **Step 1: Fechar a origem `localhost` da função**

Run (VOLEI): `npx supabase secrets set MEME_ORIGENS_PERMITIDAS=https://libertsapp.github.io` (Enter no projeto único).
Depois:
```powershell
curl.exe -s -X POST -H "Origin: http://localhost:8000" -H "Content-Type: text/plain" -d '{\"action\":\"lerAoVivo\"}' https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/meme-api
curl.exe -s -i -X POST -H "Origin: https://libertsapp.github.io" -H "Content-Type: text/plain" -d '{\"action\":\"lerAoVivo\"}' https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/meme-api | Select-String "HTTP/|access-control-allow-origin"
```
Expected: o 1º responde `{"error":"Origem não permitida."}`; o 2º `200` com `Access-Control-Allow-Origin: https://libertsapp.github.io`. (Se `secrets set` sobrescrever só esse nome, `MEME_ADMIN_PASSWORD` continua; conferir com `npx supabase secrets list`.)

- [ ] **Step 2: Re-migrar os dados imediatamente antes de trocar o front (idempotente)**

Run (VOLEI): `$env:GRUPO='meme'; npm run migrar; npm run comparar-migracao; npm run migrar-fotos -- --aplicar; Remove-Item Env:GRUPO`
Expected: `migrar` sem `Exceções`; `comparar-migracao` termina em `Tudo confere.`; `migrar-fotos` sem falhas (a re-migração zera `jogadores.foto` para as URLs do Drive; por isso as fotos rodam de novo, na ordem). Isto puxa qualquer check-in/pagamento feito no Apps Script do Meme desde a primeira migração.

- [ ] **Step 3: Editar o front do Meme (MEME, `index.html`)**

Duas edições exatas:
1. Trocar a linha
`const SHEET_API_URL = "https://script.google.com/macros/s/AKfycbwkEGPXqlxSr1asfp0BRQAm-INPoNu_Nm9jJ9EUl45filI5Nkuzx8t2sE0QvrE3lyc/exec";`
por
```javascript
/* Desde a virada (2026-09) o backend é a Edge Function meme-api do Supabase; o Apps Script do Meme fica só como reserva. */
const SHEET_API_URL = "https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/meme-api";
```
2. Trocar `<div class="footer-line">Ver.: 12.9 · <span id="visit-counter"></span></div>` por `<div class="footer-line">Ver.: 13.0 · <span id="visit-counter"></span></div>` (manter o espaço depois do `·`).

- [ ] **Step 4: Validar o front**

Run (MEME):
```bash
grep -c "script.google.com/macros" index.html
grep -c "functions/v1/meme-api" index.html
grep -c "Ver.: 13.0 · <span" index.html
git diff -U0 | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | cut -c1-150
node -e "const fs=require('fs');const c=fs.readFileSync('index.html','utf8');const m=c.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.env.TEMP+'/check_meme.js',m[1])" && node --check "$TEMP/check_meme.js" && echo SINTAXE_OK
```
Expected: `0`, `1`, `1` (o `grep` de `script.google.com/macros` deve dar 0: qualquer ocorrência restante é um endereço do Apps Script esquecido, PARAR e tratar); o diff mostra só as 3 linhas esperadas; `SINTAXE_OK`.
Depois, em VOLEI: `HTML_ARQUIVO=../voleimeme/index.html node tests/login-silencioso.test.js | tail -2` — Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Commit local (MEME)**

```bash
git add index.html
git commit -m "Meme v13.0: página passa a usar o backend no Supabase (Edge Function meme-api)

Rollback: git revert deste commit + push (o Apps Script do Meme segue intacto).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git log --oneline -1
```
Anotar o SHA (é o commit a reverter num rollback).

- [ ] **Step 6: Pedir o OK final e publicar**

Com o OK explícito do usuário (jogo acabado, dados conferidos):
```bash
git fetch -q && git merge-base --is-ancestor origin/main HEAD && echo "fast-forward OK" && git push origin main
```
Expected: `fast-forward OK` e push aceito. (O repositório do Meme não tem Action de sincronização: o push já publica.)

- [ ] **Step 7: Esperar o Pages e conferir**

```bash
for i in 1 2 3 4 5 6 7 8; do V=$(curl -s "https://libertsapp.github.io/voleimeme/?nc=$RANDOM" | grep -o "Ver\.: [0-9.]*" | head -1); echo "tentativa $i: $V"; [ "$V" = "Ver.: 13.0" ] && break; sleep 15; done
curl -s "https://libertsapp.github.io/voleimeme/?nc=$RANDOM" | grep -c "functions/v1/meme-api"
curl -s "https://libertsapp.github.io/voleimeme/?nc=$RANDOM" | grep -c "script.google.com/macros"
```
Expected: `Ver.: 13.0`, `1` (ou mais) e `0`.

- [ ] **Step 8: [USUÁRIO] Teste em produção (Ctrl+F5; no celular, fechar e reabrir o app)**

1. Rodapé `Ver.: 13.0`. 2. Lista de jogadores e fotos carregam. 3. Login com o Google e perfil corretos. 4. Check-in de teste feito e removido. 5. Troca de foto de um jogador de teste. 6. Financeiro e Ao Vivo abrem. 7. O contador de acessos sobe ao recarregar. 8. A planilha do Meme **não** ganha a linha do check-in de teste (ela só aparece no Supabase).
Depois, olhar os logs de `meme-api` (sem `Configuração incompleta` nem `cf-connecting-ip ausente`).

- [ ] **Step 9: Rollback (só se o Step 8 falhar)**

Run (MEME): `git revert --no-edit <SHA_DA_VIRADA> && git push origin main`; conferir com o Step 7 que o rodapé volta a `Ver.: 12.9` e o `script.google.com/macros` volta a aparecer. Dados gravados no Supabase depois da virada não voltam para a planilha: listar o que foi criado no schema `meme` desde a hora da virada e lançar à mão na planilha.

---

### Task 10: Fechamento e limpeza

**Files:**
- Modify: memória do projeto; `docs/superpowers/terca-supabase-deploy.md` (nota final, opcional)

**Interfaces:**
- Consumes: virada estável do Meme (Task 9) e do Terça (já feita).
- Produces: código integrado na `main` do repositório `volei`; nenhuma credencial que passou pelo chat continua válida; estado registrado.

- [ ] **Step 1: Integrar a branch na `main` do `volei` (com OK do usuário)**

Run (VOLEI): `git checkout main && git pull --ff-only && git merge meme-supabase -m "Merge meme-supabase (Meme no Supabase: schema meme, função meme-api, scripts por grupo)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>" && npm run test:backend`
Expected: merge limpo (a branch só acrescenta arquivos e altera scripts/backend/`.gitignore`/`package.json`) e a suíte passa. Push só com OK: `git push origin main` (a Action `sync-index` só dispara com mudança no `volei-dashboard.html`, que esta branch não altera; conferir com `git diff --stat origin/main main -- volei-dashboard.html` sem saída).

- [ ] **Step 2: Teste de bloqueio por IP em duas redes da `meme-api` (quando houver uma segunda rede)**

Igual ao item 2 da seção 8 do `terca-supabase-deploy.md`, apontando para `.../meme-api` e usando `Origin: https://libertsapp.github.io`; 8 respostas `Senha de administrador incorreta.` e a 9ª `Muitas tentativas...`; de outra rede, `Senha de administrador incorreta.`.

- [ ] **Step 3: Limpeza de segredos (agora liberada, com as duas migrações concluídas), fora de horário de jogo**

1. Apagar a chave JSON do Google: a pasta `chave/` (e `CHAVE/`) em `voleis_VS`, e excluir a chave da conta de serviço no Google Cloud (IAM > Contas de serviço > Chaves). Remover `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` do `.env`.
2. Regenerar a `service_role` no painel do Supabase e atualizar `SUPABASE_SERVICE_ROLE_KEY` no `.env` local.
3. Conferir as **duas** funções depois da rotação (republicar com `npm run preparar-edge` + `functions deploy` se o painel disser que é necessário):
   `curl.exe -s https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste | Select-Object -First 1` e o mesmo para `meme-api`. Expected: JSON com `players` nas duas.
4. Remover as permissões temporárias do Claude (`npm run migrar`, `criar-bucket-fotos`, `migrar-fotos*`) dos arquivos de configuração do projeto.

- [ ] **Step 4: Registrar o estado final**

Atualizar a memória `project_meme_supabase.md` (virada feita em `<data>`, `Ver.: 13.0`, Apps Script do Meme como reserva por 1 a 2 semanas, teste de IP pendente ou feito, limpeza feita) e `project_terca_supabase.md`. Perguntar ao usuário, 1 a 2 semanas depois, se desliga o Apps Script do Meme (não desligar sem pedido explícito).
