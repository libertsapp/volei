# Terça no Supabase — Sub-projeto 1: Schema + Migração Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Tasks 2 e 3 têm passos manuais (painel do Supabase, Google Cloud
> Console) que não são subagent-friendly.

**Goal:** Criar as 14 tabelas relacionais no Supabase e copiar, uma única vez, os dados reais
do Vôlei de Terça (hoje em Google Sheets) pra lá — base pros sub-projetos futuros (login,
núcleo, financeiro, Ao Vivo, Hall da Fama) de uma segunda versão de estudo do app.

**Architecture:** Um script Node.js autônomo (`scripts/migrar-terca-supabase.js`) lê as 12 abas
da planilha do Terça via Google Sheets API (autenticado com uma service account), transforma
cada linha pro formato relacional novo através de funções puras testáveis
(`scripts/lib/transformacoes.js`), e grava no Supabase via `@supabase/supabase-js` usando a
`service_role key` (ignora RLS), respeitando a ordem exigida pelas chaves estrangeiras. O schema
em si é criado à mão no SQL Editor do Supabase a partir de um arquivo `.sql` versionado.

**Tech Stack:** Node.js (script CLI, sem framework), `googleapis`, `@supabase/supabase-js`,
`dotenv`. Testes com `node:assert/strict` (mesmo padrão já usado em `tests/*.test.js` neste
repo).

**Spec:** `docs/superpowers/specs/2026-09-22-terca-supabase-schema-migracao-design.md`

## Global Constraints

- **IDs originais preservados como `text`** — nunca gerar `uuid` novo pros registros migrados.
- **RLS habilitado, sem política nenhuma** em todas as tabelas — só a `service_role key` (que
  ignora RLS) escreve nelas neste sub-projeto.
- **`upsert`, nunca `insert` puro** — o script tem que ser seguro de rodar mais de uma vez.
- **Uma linha com FK quebrada não aborta a migração inteira** — registra no resumo final e
  segue (spec, seção "Script de migração", item 7).
- Nomes de função/variável em português (convenção do projeto — ver CLAUDE.md).
- Nenhum segredo (chave do Supabase, JSON da service account do Google) pode ir pro git —
  tudo lido de `.env` ou de um caminho de arquivo apontado por variável de ambiente.
- Node instalado localmente: v24.20.0 (qualquer v18+ serve pros pacotes usados).

---

### Task 1: Inicializar o projeto Node e instalar dependências

**Files:**
- Create: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produz: `node_modules` com `googleapis`, `@supabase/supabase-js` e `dotenv` instalados —
  todas as tasks seguintes importam esses pacotes.

- [ ] **Passo 1: Criar `package.json`**

```json
{
  "name": "volei-terca-supabase-migracao",
  "private": true,
  "version": "1.0.0",
  "description": "Migração única dos dados do Vôlei de Terça (Google Sheets) para o Supabase.",
  "type": "commonjs",
  "scripts": {
    "migrar": "node scripts/migrar-terca-supabase.js"
  }
}
```

- [ ] **Passo 2: Instalar as dependências**

```bash
npm install googleapis @supabase/supabase-js dotenv
```

- [ ] **Passo 3: Ignorar `node_modules` no git**

Adicionar ao `.gitignore` (se ainda não estiver lá):

```
node_modules/
```

- [ ] **Passo 4: Verificar**

```bash
node -e "require('googleapis'); require('@supabase/supabase-js'); require('dotenv'); console.log('OK')"
```

Esperado: imprime `OK` sem erro.

- [ ] **Passo 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: inicializa projeto Node para a migração Terça -> Supabase"
```

---

### Task 2: Criar o schema no Supabase (manual, painel do Supabase)

**Files:**
- Create: `sql/schema-terca-supabase.sql`

**Interfaces:**
- Produz: as 14 tabelas existindo no projeto Supabase — Task 6 (gravação) depende delas
  existirem antes de rodar.

- [ ] **Passo 1: Criar o arquivo `sql/schema-terca-supabase.sql`**

Copiar o DDL completo da seção "Schema (DDL)" do spec
(`docs/superpowers/specs/2026-09-22-terca-supabase-schema-migracao-design.md`) para esse
arquivo — as 14 tabelas + os `alter table` de RLS, exatamente como está no spec.

- [ ] **Passo 2: Rodar no SQL Editor do Supabase**

No painel do projeto (supabase.com/dashboard) → **SQL Editor** → colar o conteúdo do arquivo →
Run.

- [ ] **Passo 3: Conferir no Table Editor**

Abrir **Table Editor** no painel e confirmar que as 14 tabelas aparecem: `jogadores`,
`rodadas`, `times_rodada`, `time_jogadores`, `checkins`, `usuarios`, `config`, `fin_dias`,
`fin_pagamentos`, `fin_creditos`, `fin_lancamentos`, `fin_log`, `ao_vivo`, `ao_vivo_log`.

- [ ] **Passo 4: Commit**

```bash
git add sql/schema-terca-supabase.sql
git commit -m "feat: schema SQL das tabelas do Terça no Supabase"
```

---

### Task 3: Configurar a service account do Google (manual, Google Cloud Console)

**Files:**
- Modify: `.env` (variáveis novas, arquivo já existe e já está no `.gitignore`)

**Interfaces:**
- Produz: `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` e `SPREADSHEET_ID_TERCA` disponíveis em `.env` —
  Task 5 (leitura da planilha) depende dessas duas variáveis.

- [ ] **Passo 1: Criar a service account**

No Google Cloud Console (console.cloud.google.com): criar/selecionar um projeto → **APIs e
Serviços → Biblioteca** → habilitar **Google Sheets API** → **APIs e Serviços → Credenciais →
Criar credenciais → Conta de serviço** → dar um nome (ex.: "migracao-terca-supabase") → criar.

- [ ] **Passo 2: Gerar a chave JSON**

Na conta de serviço criada → aba **Chaves** → **Adicionar chave → Criar nova chave → JSON** →
baixa um arquivo `.json`. Guardar esse arquivo FORA do repositório git (ex.: numa pasta pessoal
fora de `voleis_VS`, ou dentro do repo numa pasta já coberta por `.gitignore` — nunca commitar).

- [ ] **Passo 3: Compartilhar a planilha do Terça com a service account**

Abrir o JSON baixado, copiar o valor de `client_email` (algo como
`migracao-terca-supabase@SEU-PROJETO.iam.gserviceaccount.com`). Abrir a planilha do Terça
(ID `1dBAYE5IuUPxEBW75lILO-jqTrJrM11DsFGkpHeKg0iQ`) → botão **Compartilhar** → colar esse
e-mail → permissão de **Leitor** → Enviar.

- [ ] **Passo 4: Adicionar as variáveis no `.env`**

Adicionar ao `.env` existente (que já tem `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`):

```
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/caminho/completo/para/o/arquivo-baixado.json
SPREADSHEET_ID_TERCA=1dBAYE5IuUPxEBW75lILO-jqTrJrM11DsFGkpHeKg0iQ
```

- [ ] **Passo 5: Verificar**

```bash
node -e "
require('dotenv').config();
const fs = require('fs');
console.log('chave existe:', fs.existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH));
console.log('SPREADSHEET_ID_TERCA:', process.env.SPREADSHEET_ID_TERCA);
"
```

Esperado: `chave existe: true` e o ID da planilha impresso.

(Nada pra commitar nesta task — `.env` já está fora do git.)

---

### Task 4: Funções puras de transformação de dados (com testes)

**Files:**
- Create: `scripts/lib/transformacoes.js`
- Test: `tests/migracao-supabase-transformacoes.test.js`

**Interfaces:**
- Produz: `paraBooleano(valor)`, `dividirJogadores(idsTexto)`, `paraJsonb(valor)`,
  `paraDataISO(valor)`, `paraTimestampISO(valor)` — a Task 5 (leitura) e a Task 6 (gravação)
  importam essas funções de `scripts/lib/transformacoes.js`.

- [ ] **Passo 1: Escrever os testes (devem falhar — o arquivo ainda não existe)**

```javascript
// tests/migracao-supabase-transformacoes.test.js
const assert = require('node:assert/strict');
const {
  paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO
} = require('../scripts/lib/transformacoes');

let falhas = 0;
function t(nome, fn) {
  try { fn(); console.log('ok    -', nome); }
  catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

t('paraBooleano: texto TRUE/FALSE do Sheets vira boolean', () => {
  assert.equal(paraBooleano('TRUE'), true);
  assert.equal(paraBooleano('FALSE'), false);
  assert.equal(paraBooleano('true'), true);
  assert.equal(paraBooleano(''), false);
  assert.equal(paraBooleano(true), true);
});

t('dividirJogadores: célula "j0,j1,j2" vira array de ids', () => {
  assert.deepEqual(dividirJogadores('j0,j1,j2'), ['j0', 'j1', 'j2']);
  assert.deepEqual(dividirJogadores('j0, j1 , j2'), ['j0', 'j1', 'j2']);
  assert.deepEqual(dividirJogadores(''), []);
  assert.deepEqual(dividirJogadores(null), []);
});

t('paraJsonb: JSON serializado vira objeto; texto solto vira {texto}', () => {
  assert.deepEqual(paraJsonb('{"data":"2026-09-18","valor":13.6}'), { data: '2026-09-18', valor: 13.6 });
  assert.deepEqual(paraJsonb('mensagem qualquer'), { texto: 'mensagem qualquer' });
  assert.equal(paraJsonb(''), null);
  assert.equal(paraJsonb(null), null);
});

t('paraDataISO: aceita ISO e dd/mm/aaaa, sempre devolve yyyy-mm-dd', () => {
  assert.equal(paraDataISO('2026-09-18'), '2026-09-18');
  assert.equal(paraDataISO('18/09/2026'), '2026-09-18');
  assert.throws(() => paraDataISO('lixo'), /formato inesperado/);
});

t('paraTimestampISO: aceita string parseável pelo Date, devolve ISO completo', () => {
  assert.equal(paraTimestampISO('2026-09-18T18:00:00.000Z'), '2026-09-18T18:00:00.000Z');
  assert.equal(paraTimestampISO(''), null);
  assert.equal(paraTimestampISO(null), null);
  assert.throws(() => paraTimestampISO('lixo'), /formato inesperado/);
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
```

- [ ] **Passo 2: Rodar e confirmar que falha (módulo não existe ainda)**

```bash
node tests/migracao-supabase-transformacoes.test.js
```

Esperado: erro `Cannot find module '../scripts/lib/transformacoes'`.

- [ ] **Passo 3: Implementar `scripts/lib/transformacoes.js`**

```javascript
// Funções puras de transformação: célula do Google Sheets (sempre texto ou já convertido
// pela googleapis) -> valor pronto pra gravar na coluna Postgres correspondente.

function paraBooleano(valor) {
  if (typeof valor === 'boolean') return valor;
  return String(valor || '').trim().toUpperCase() === 'TRUE';
}

function dividirJogadores(idsTexto) {
  return String(idsTexto || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function paraJsonb(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  try { return JSON.parse(texto); }
  catch (e) { return { texto }; }
}

// Sempre devolve "yyyy-mm-dd". Aceita ISO (corta hora se vier junto) e dd/mm/aaaa
// (formato que o Google Sheets costuma mostrar quando a coluna é do tipo Data, locale pt-BR).
function paraDataISO(valor) {
  const texto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  throw new Error('Data em formato inesperado: "' + texto + '"');
}

// Sempre devolve um ISO 8601 completo (o que o Postgres "timestamptz" espera), ou null.
function paraTimestampISO(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  const d = new Date(texto);
  if (isNaN(d.getTime())) throw new Error('Timestamp em formato inesperado: "' + texto + '"');
  return d.toISOString();
}

module.exports = { paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO };
```

- [ ] **Passo 4: Rodar os testes de novo — devem passar**

```bash
node tests/migracao-supabase-transformacoes.test.js
```

Esperado: `TODOS OS TESTES PASSARAM`.

> **Nota pra Task 5:** `paraTimestampISO` assume que a API do Google Sheets devolve os
> timestamps como string parseável por `new Date(...)` — isso depende do `valueRenderOption`
> usado na leitura (Task 5 usa `FORMATTED_VALUE`). Se o primeiro run real (Task 7) mostrar
> datas num formato que `new Date()` não entende (ex.: `18/09/2026 18:00:00`, que o `Date`
> nativo do JS não parseia), ajustar `paraTimestampISO` pra tratar esse formato também — mesmo
> padrão de `paraDataISO`. Isso é esperado, não é um retrabalho por erro de design.

- [ ] **Passo 5: Commit**

```bash
git add scripts/lib/transformacoes.js tests/migracao-supabase-transformacoes.test.js
git commit -m "feat: funções de transformação de dados para a migração Terça -> Supabase"
```

---

### Task 5: Ler as 12 abas da planilha do Terça via Google Sheets API

**Files:**
- Create: `scripts/lib/planilha.js`

**Interfaces:**
- Consome: `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` e `SPREADSHEET_ID_TERCA` (Task 3, via `.env`).
- Produz: `lerPlanilhaTerca()` — função assíncrona que devolve um objeto
  `{ Jogadores, Rodadas, Config, Checkins, Usuarios, FinDias, FinPagamentos, FinCreditos,
  FinLancamentos, FinLog, AoVivo, AoVivoLog }`, cada chave um array de arrays (linhas x
  colunas, cabeçalho incluído na posição 0) — a Task 6 (orquestrador) consome essa função.

- [ ] **Passo 1: Implementar `scripts/lib/planilha.js`**

```javascript
// Lê as abas da planilha do Terça via Google Sheets API, autenticado como service account.
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

async function lerPlanilhaTerca() {
  const sheets = await autenticar();
  const spreadsheetId = process.env.SPREADSHEET_ID_TERCA;
  const resultado = {};
  for (const aba of ABAS) {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: aba,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    resultado[aba] = resp.data.values || [];
  }
  return resultado;
}

module.exports = { lerPlanilhaTerca, ABAS };
```

- [ ] **Passo 2: Verificar com um teste manual (exige Task 3 concluída)**

```bash
node -e "
require('dotenv').config();
const { lerPlanilhaTerca } = require('./scripts/lib/planilha');
lerPlanilhaTerca().then(dados => {
  for (const aba of Object.keys(dados)) console.log(aba, ':', dados[aba].length, 'linha(s)');
}).catch(e => { console.error(e); process.exit(1); });
"
```

Esperado: uma linha por aba com uma contagem > 0 pras abas que têm dado hoje (Jogadores,
Rodadas, Checkins, FinDias, FinPagamentos, FinLancamentos, FinLog no mínimo), e possivelmente
0 ou 1 (só cabeçalho) pra Usuarios/FinCreditos/AoVivo/AoVivoLog, que podem estar vazias.

- [ ] **Passo 3: Commit**

```bash
git add scripts/lib/planilha.js
git commit -m "feat: leitura das abas do Terça via Google Sheets API"
```

---

### Task 6: Script orquestrador — grava tudo no Supabase na ordem certa

**Files:**
- Create: `scripts/migrar-terca-supabase.js`

**Interfaces:**
- Consome: `lerPlanilhaTerca()` (Task 5) e `paraBooleano`/`dividirJogadores`/`paraJsonb`/
  `paraDataISO`/`paraTimestampISO` (Task 4).
- Produz: dados gravados nas 14 tabelas do Supabase (Task 2) + um resumo impresso no console —
  a Task 7 (validação) confere esse resultado.

- [ ] **Passo 1: Implementar `scripts/migrar-terca-supabase.js`**

```javascript
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { lerPlanilhaTerca } = require('./lib/planilha');
const {
  paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO
} = require('./lib/transformacoes');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resumo = [];
const excecoes = [];

// linhas[0] = cabeçalho; devolve um array de objetos { coluna: valor } usando o cabeçalho como chave
function paraObjetos(linhas) {
  if (!linhas || linhas.length < 2) return [];
  const [cabecalho, ...resto] = linhas;
  return resto.filter((l) => l[0]).map((l) => {
    const obj = {};
    cabecalho.forEach((col, i) => { obj[col] = l[i]; });
    return obj;
  });
}

async function gravar(tabela, registros) {
  if (!registros.length) { resumo.push(`${tabela}: 0 registro(s)`); return; }
  const { error } = await supabase.from(tabela).upsert(registros);
  if (error) {
    excecoes.push(`${tabela}: ${error.message}`);
    resumo.push(`${tabela}: FALHOU (${error.message})`);
    return;
  }
  resumo.push(`${tabela}: ${registros.length} registro(s) gravado(s)`);
}

async function migrar() {
  const dados = await lerPlanilhaTerca();

  // 1. jogadores
  const jogadores = paraObjetos(dados.Jogadores).map((j) => ({
    id: j.id, nome: j.nome, apelido: j.apelido || null, foto: j.foto || null,
    estrelas: j.estrelas ? Number(j.estrelas) : null, sexo: j.sexo || null, porte: j.porte || null
  }));
  await gravar('jogadores', jogadores);

  // 2. usuarios
  const usuarios = paraObjetos(dados.Usuarios).map((u) => {
    const obj = {
      email: u.email, nome: u.nome || null, perfil: (u.perfil || 'jogador').toLowerCase(),
      jogador_id: u.jogadorId || null, jogador_id_pendente: u.jogadorIdPendente || null
    };
    // criado_em é "not null default now()" no schema: só inclui a chave se houver valor,
    // senão o Postgres recusa um null explícito numa coluna not null (o default só entra
    // em ação quando a coluna nem aparece no INSERT)
    if (u.criadoEm) obj.criado_em = paraTimestampISO(u.criadoEm);
    return obj;
  });
  await gravar('usuarios', usuarios);

  // 3. config (Config é aba key/value, sem cabeçalho de tabela — cada linha é [chave, valor])
  const config = (dados.Config || []).filter((l) => l[0]).map((l) => ({ chave: l[0], valor: String(l[1] ?? '') }));
  await gravar('config', config);

  // 4. rodadas (uma linha por round_id só, mesmo que a aba tenha várias linhas por rodada)
  const linhasRodadas = paraObjetos(dados.Rodadas);
  const rodadasUnicas = new Map();
  linhasRodadas.forEach((r) => {
    if (!rodadasUnicas.has(r.roundId)) {
      rodadasUnicas.set(r.roundId, { round_id: r.roundId, data: paraDataISO(r.data), vencedor: r.vencedor || null, rascunho: paraBooleano(r.rascunho) });
    }
  });
  await gravar('rodadas', Array.from(rodadasUnicas.values()));

  // 5. times_rodada
  const timesRodada = linhasRodadas.map((r) => ({
    round_id: r.roundId, time_index: Number(r.timeIndex), time_nome: r.timeNome || null, vitorias: Number(r.vitorias || 0)
  }));
  await gravar('times_rodada', timesRodada);

  // times_rodada.id é gerado pelo Postgres (identity) — buscamos de volta pra montar time_jogadores
  const { data: timesGravados, error: erroTimes } = await supabase.from('times_rodada').select('id, round_id, time_index');
  if (erroTimes) { excecoes.push('times_rodada (select de volta): ' + erroTimes.message); }
  const idPorRoundETime = new Map((timesGravados || []).map((t) => [`${t.round_id}:${t.time_index}`, t.id]));

  // 6. time_jogadores
  const timeJogadores = [];
  linhasRodadas.forEach((r) => {
    const timeRodadaId = idPorRoundETime.get(`${r.roundId}:${r.timeIndex}`);
    if (!timeRodadaId) return;
    dividirJogadores(r.jogadores).forEach((jogadorId) => {
      timeJogadores.push({ time_rodada_id: timeRodadaId, jogador_id: jogadorId });
    });
  });
  await gravar('time_jogadores', timeJogadores);

  // 7. checkins
  const checkins = paraObjetos(dados.Checkins).map((c) => ({
    id: c.id, data: paraDataISO(c.data), jogador_id: c.jogadorId || null, jogador_nome: c.jogadorNome || null,
    estrelas: c.estrelas ? Number(c.estrelas) : null, sexo: c.sexo || null,
    estrelas_ajustadas: c.estrelasAjustadas ? Number(c.estrelasAjustadas) : null
  }));
  await gravar('checkins', checkins);

  // 8. fin_dias
  const finDias = paraObjetos(dados.FinDias).map((f) => ({
    data: paraDataISO(f.data), valor_pessoa: Number(f.valorPessoa || 0), pix: f.pix || null,
    valor_quadra: f.valorQuadra ? Number(f.valorQuadra) : null, tem_brinde: paraBooleano(f.temBrinde),
    valor_brinde: f.valorBrinde ? Number(f.valorBrinde) : null, atualizado_por: f.atualizadoPor || null,
    atualizado_em: paraTimestampISO(f.atualizadoEm), icone: f.icone || null, status: f.status || 'normal'
  }));
  await gravar('fin_dias', finDias);

  // 9. fin_pagamentos (credito_id fica de fora por enquanto — fin_creditos ainda não existe)
  const linhasPagamentos = paraObjetos(dados.FinPagamentos);
  const finPagamentos = linhasPagamentos.map((p) => ({
    id: p.id, data: paraDataISO(p.data), jogador_id: p.jogadorId || null, jogador_nome: p.jogadorNome || null,
    valor: Number(p.valor || 0), marcado_por: p.marcadoPor || null, marcado_em: paraTimestampISO(p.marcadoEm),
    estornado: paraBooleano(p.estornado), estornado_por: p.estornadoPor || null, estornado_em: paraTimestampISO(p.estornadoEm),
    tipo: p.tipo || 'dinheiro'
  }));
  await gravar('fin_pagamentos', finPagamentos);

  // 10. fin_creditos (já pode referenciar origem_pagamento_id, que existe desde o passo anterior)
  const finCreditos = paraObjetos(dados.FinCreditos).map((c) => ({
    id: c.id, jogador_id: c.jogadorId || null, jogador_nome: c.jogadorNome || null, valor: Number(c.valor || 0),
    origem_pagamento_id: c.origemPagamentoId || null, data_origem: c.dataOrigem ? paraDataISO(c.dataOrigem) : null,
    criado_por: c.criadoPor || null, criado_em: paraTimestampISO(c.criadoEm), status: c.status || null,
    encerrado_por: c.encerradoPor || null, encerrado_em: paraTimestampISO(c.encerradoEm)
  }));
  await gravar('fin_creditos', finCreditos);

  // 11. atualiza fin_pagamentos.credito_id pra quem pagou usando crédito
  const pagamentosComCredito = linhasPagamentos.filter((p) => p.creditoId);
  for (const p of pagamentosComCredito) {
    const { error } = await supabase.from('fin_pagamentos').update({ credito_id: p.creditoId }).eq('id', p.id);
    if (error) excecoes.push(`fin_pagamentos.credito_id (${p.id}): ${error.message}`);
  }
  resumo.push(`fin_pagamentos.credito_id: ${pagamentosComCredito.length} atualizado(s)`);

  // 12. fin_lancamentos
  const finLancamentos = paraObjetos(dados.FinLancamentos).map((l) => ({
    id: l.id, data: paraDataISO(l.data), tipo: l.tipo || null, descricao: l.descricao || null,
    valor: Number(l.valor || 0), criado_por: l.criadoPor || null, criado_em: paraTimestampISO(l.criadoEm),
    estornado: paraBooleano(l.estornado), estornado_por: l.estornadoPor || null, estornado_em: paraTimestampISO(l.estornadoEm)
  }));
  await gravar('fin_lancamentos', finLancamentos);

  // 13. fin_log
  const finLog = paraObjetos(dados.FinLog).map((l) => ({
    timestamp: paraTimestampISO(l.timestamp), nome: l.nome || null, email: l.email || null,
    acao: l.acao || null, detalhe: paraJsonb(l.detalhe)
  }));
  await gravar('fin_log', finLog);

  // 14. ao_vivo / ao_vivo_log (normalmente vazias)
  const aoVivo = paraObjetos(dados.AoVivo).map((a) => ({
    round_id: a.roundId, time_index: Number(a.timeIndex), time_nome: a.timeNome || null,
    vitorias: Number(a.vitorias || 0), iniciado_em: paraTimestampISO(a.iniciadoEm),
    duracao_minutos: a.duracaoMinutos ? Number(a.duracaoMinutos) : null
  }));
  await gravar('ao_vivo', aoVivo);

  const aoVivoLog = paraObjetos(dados.AoVivoLog).map((a) => ({
    round_id: a.roundId, time_index: Number(a.timeIndex), time_nome: a.timeNome || null,
    delta: Number(a.delta || 0), timestamp: paraTimestampISO(a.timestamp)
  }));
  await gravar('ao_vivo_log', aoVivoLog);

  console.log('\n=== Resumo da migração ===');
  resumo.forEach((linha) => console.log(' -', linha));
  if (excecoes.length) {
    console.log('\n=== Exceções (revisar à mão) ===');
    excecoes.forEach((linha) => console.log(' !', linha));
  }
}

migrar().catch((e) => { console.error('Migração interrompida:', e); process.exit(1); });
```

- [ ] **Passo 2: Validar sintaxe**

```bash
node --check scripts/migrar-terca-supabase.js
```

Esperado: sem erro.

- [ ] **Passo 3: Commit**

```bash
git add scripts/migrar-terca-supabase.js
git commit -m "feat: script orquestrador da migração Terça -> Supabase"
```

---

### Task 7: Rodar a migração de verdade e validar

**Files:** nenhum (execução + conferência).

**Interfaces:**
- Consome: tudo das Tasks 1-6.

- [ ] **Passo 1: Rodar a migração**

```bash
npm run migrar
```

Ler o resumo impresso. Se `paraDataISO`/`paraTimestampISO` derem erro de "formato inesperado",
voltar na Task 4 e ajustar a função pro formato real que apareceu (ver a nota da Task 4, Passo
4) — depois rodar `npm run migrar` de novo (é seguro, usa `upsert`).

- [ ] **Passo 2: Comparar contagens**

Pra cada aba, contar as linhas de dado na planilha (Ctrl+Fim mostra a última linha usada, menos
1 pelo cabeçalho) e comparar com a contagem que apareceu no resumo do script. Também dá pra
conferir direto no Supabase:

```sql
select 'jogadores', count(*) from jogadores
union all select 'rodadas', count(*) from rodadas
union all select 'checkins', count(*) from checkins
union all select 'fin_pagamentos', count(*) from fin_pagamentos
union all select 'fin_creditos', count(*) from fin_creditos;
```

- [ ] **Passo 3: Spot-check manual**

No Table Editor do Supabase: abrir `jogadores` e reconhecer alguns nomes; abrir `rodadas` +
`times_rodada` + `time_jogadores` e conferir que uma rodada conhecida tem os dois times com os
jogadores certos; abrir `fin_pagamentos` e achar um pagamento conhecido.

- [ ] **Passo 4: Testar idempotência**

```bash
npm run migrar
```

Esperado: mesmas contagens de antes (nenhum registro duplicado — `upsert` fez update, não
insert de novo).

- [ ] **Passo 5: Revisar exceções, se houver**

Se o resumo listou exceções (FK quebrada), decidir caso a caso: corrigir o dado de origem na
planilha e rodar de novo, ou aceitar que aquele registro específico fica de fora da versão
Supabase (registrar a decisão em memória do projeto, não precisa virar código).
