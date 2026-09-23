# Terça no Supabase — Etapa 1: Leitura + localhost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. A Task 5 termina com uma verificação manual no navegador (feita pelo usuário).

**Goal:** O `GET` do backend novo devolve exatamente o mesmo JSON que o `doGet` do Apps Script, lido das tabelas do Supabase, e o app do Terça abre em `http://localhost:8770` mostrando os dados reais.

**Architecture:** Um módulo `backend/` em JavaScript ESM (sem APIs do Node, para rodar depois como Edge Function). `mapeadores.js` converte linhas do banco (snake_case) no JSON do app; `handler.js` monta a resposta a partir de um `repo` injetado; `repo-memoria.js` (testes) e `repo-supabase.js` (real) implementam o mesmo método `lerTudo()`. Um servidor Node local serve o `volei-dashboard.html` de verdade e a rota `/api`. A paridade com o `.gs` é testada rodando o `.gs` real na planilha falsa que já existe em `tests/helpers/planilha-falsa.js`.

**Tech Stack:** Node.js 24 (ESM, `node:assert`), `@supabase/supabase-js` e `dotenv` (já instalados na raiz), sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-23-terca-supabase-backend-design.md` (etapa 1) e `docs/superpowers/specs/2026-09-22-terca-supabase-schema-migracao-design.md` (schema, ajustes 1 e 2).

## Global Constraints

- O JSON do `GET` tem as chaves `players, rounds, settings, checkins, perfisPublicos, aoVivo, financeiro`, com os mesmos campos, tipos e ordem do `doGet` de `apps-script-codigo.gs` (datas `yyyy-MM-dd`, carimbos ISO com milissegundos e `Z`, números e booleanos nativos, textos vazios como `''`, nunca `null`).
- `players` exclui `convidado = true`. As listas de jogadores das rodadas (`playerIds`) contêm os ids `convidado:NOME#xxxx`. Registros com `jogador_id` nulo saem com `jogadorId: ''`.
- Toda lista sai na ordem da planilha: `ordem` crescente (`nulls last`) e, nos times, `posicao` crescente e `time_index` crescente. `financeiro.log`: os 100 mais recentes, do mais novo para o mais antigo (por `id` decrescente).
- Nomes de função e variável em português (convenção do projeto). Nenhum segredo no código; credenciais só de `.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- `backend/` não pode importar nada do Node (`node:*`, `process`, `fs`): só JavaScript puro. Quem depende do Node é `servidor-local.js`.
- Esta etapa **não** grava nada no banco. O Ao Vivo fica para a etapa 5: se `ao_vivo`/`ao_vivo_log` tiverem linhas, o mapeador falha alto em vez de devolver dado errado (o schema atual de `ao_vivo` não tem `data` nem a lista de jogadores por time; será ajustado na etapa 5).
- Os arquivos `.gs` (`apps-script-codigo.gs`) são ignorados pelo git e existem só localmente; o teste de paridade os lê do disco e pula com aviso se não existirem.
- Comandos rodam dentro de `C:\Users\Heleno\OneDrive\Documentos\GitHub\voleis_VS\.worktrees\terca-supabase-migracao`.

---

### Task 1: Mapeadores puros (banco → JSON do app), com testes

**Files:**
- Create: `backend/package.json`
- Create: `backend/mapeadores.js`
- Create: `tests/backend/executor.mjs`
- Create: `tests/backend/fixture.mjs`
- Test: `tests/backend/mapeadores.test.mjs`

**Interfaces:**
- Produz (todas em `backend/mapeadores.js`, todas puras):
  `mapearJogadores(jogadores)`, `mapearRodadas(rodadas, times, timeJogadores)`, `mapearConfig(linhasConfig)`, `mapearCheckins(checkins)`, `mapearPerfisPublicos(usuarios)`, `mapearAoVivo(aoVivo, aoVivoLog)`, `mapearFinanceiro({ fin_dias, fin_pagamentos, fin_creditos, fin_lancamentos, fin_log })` e a constante `CHECKIN_MENSAGEM_PADRAO`.
- Produz `tests/backend/fixture.mjs` (`export const fixture`, linhas no formato do banco) e `tests/backend/executor.mjs` (`t`, `ta`, `fim`) — as Tasks 2 e 3 usam os dois.

- [ ] **Step 1: Criar `backend/package.json`**

```json
{
  "type": "module"
}
```

- [ ] **Step 2: Criar `tests/backend/executor.mjs`**

```javascript
// Mini executor de testes (mesmo estilo dos outros testes do projeto: ok/FALHA + código de saída).
let falhas = 0;

export function t(nome, fn) {
  try { fn(); console.log('ok    -', nome); }
  catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

export async function ta(nome, fn) {
  try { await fn(); console.log('ok    -', nome); }
  catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

export function fim() {
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
}
```

- [ ] **Step 3: Criar `tests/backend/fixture.mjs`**

As linhas estão **fora de ordem de propósito**, para provar que os mapeadores ordenam.

```javascript
// Dados de teste no formato do BANCO (snake_case). Linhas fora de ordem de propósito.
export const fixture = {
  jogadores: [
    { id: 'p2', nome: 'Bruno', apelido: 'Bru', foto: 'https://exemplo.com/b.jpg', estrelas: 3.5, sexo: 'M', porte: 'G', convidado: false, ordem: 2 },
    { id: 'convidado:LUCAS#ab12', nome: 'LUCAS', apelido: null, foto: null, estrelas: null, sexo: null, porte: null, convidado: true, ordem: null },
    { id: 'p1', nome: 'Ana', apelido: null, foto: null, estrelas: 4, sexo: 'F', porte: 'P', convidado: false, ordem: 1 }
  ],
  rodadas: [
    { round_id: 'r2', data: '2026-09-08', rascunho: false, ordem: 2 },
    { round_id: 'r1', data: '2026-09-01', rascunho: false, ordem: 1 }
  ],
  times_rodada: [
    { id: 21, round_id: 'r2', time_index: 1, time_nome: 'Time 2', vitorias: 1, vencedor: false },
    { id: 20, round_id: 'r2', time_index: 0, time_nome: 'Time 1', vitorias: 3, vencedor: true },
    { id: 12, round_id: 'r1', time_index: 1, time_nome: 'Time 2', vitorias: 2, vencedor: true },
    { id: 11, round_id: 'r1', time_index: 0, time_nome: 'Time 1', vitorias: 2, vencedor: true }
  ],
  time_jogadores: [
    { time_rodada_id: 11, jogador_id: 'p2', posicao: 1 },
    { time_rodada_id: 11, jogador_id: 'p1', posicao: 0 },
    { time_rodada_id: 12, jogador_id: 'convidado:LUCAS#ab12', posicao: 0 },
    { time_rodada_id: 21, jogador_id: 'p2', posicao: 0 },
    { time_rodada_id: 20, jogador_id: 'p1', posicao: 0 }
  ],
  checkins: [
    { id: 'c2', data: '2026-09-22', jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 3.5, sexo: 'M', estrelas_ajustadas: 4, ordem: 2 },
    { id: 'c3', data: '2026-09-22', jogador_id: null, jogador_nome: 'Antigo', estrelas: null, sexo: 'M', estrelas_ajustadas: null, ordem: 3 },
    { id: 'c1', data: '2026-09-22', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 4, sexo: 'F', estrelas_ajustadas: null, ordem: 1 }
  ],
  config: [
    { chave: 'checkinVagas', valor: '12' },
    { chave: 'checkinDataAberta', valor: '2026-09-22' },
    { chave: 'checkinTravado', valor: 'TRUE' },
    { chave: 'contadorAcessos', valor: '41' }
  ],
  usuarios: [
    { email: 'b@exemplo.com', nome: 'B', perfil: 'organizador', jogador_id: 'p2', criado_em: '2026-09-02T10:00:00+00:00', jogador_id_pendente: null, ordem: 2 },
    { email: 'c@exemplo.com', nome: 'C', perfil: 'jogador', jogador_id: null, criado_em: '2026-09-03T10:00:00+00:00', jogador_id_pendente: null, ordem: 3 },
    { email: 'a@exemplo.com', nome: 'A', perfil: 'admin', jogador_id: 'p1', criado_em: '2026-09-01T10:00:00+00:00', jogador_id_pendente: null, ordem: 1 }
  ],
  fin_dias: [
    { data: '2026-09-22', valor_pessoa: 14, pix: '31999999999', valor_quadra: 180, tem_brinde: true, valor_brinde: 50, atualizado_por: 'Adm', atualizado_em: '2026-09-22T18:00:00+00:00', icone: '💰', status: 'normal', ordem: 2 },
    { data: '2026-09-15', valor_pessoa: 14, pix: '', valor_quadra: 0, tem_brinde: false, valor_brinde: 0, atualizado_por: 'Adm', atualizado_em: '2026-09-15T18:00:00+00:00', icone: null, status: 'semjogo', ordem: 1 }
  ],
  fin_pagamentos: [
    { id: 'pg2', data: '2026-09-22', jogador_id: 'p2', jogador_nome: 'Bruno', valor: 14, marcado_por: 'Org', marcado_em: '2026-09-22T19:05:00+00:00', estornado: true, estornado_por: 'Adm', estornado_em: '2026-09-22T20:00:00+00:00', tipo: 'credito', credito_id: 'cr1', ordem: 2 },
    { id: 'pg3', data: '2026-09-22', jogador_id: null, jogador_nome: 'Antigo', valor: 14, marcado_por: 'Org', marcado_em: '2026-09-22T19:10:00+00:00', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, ordem: 3 },
    { id: 'pg1', data: '2026-09-22', jogador_id: 'p1', jogador_nome: 'Ana', valor: 14, marcado_por: 'Org', marcado_em: '2026-09-22T19:00:00+00:00', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, ordem: 1 }
  ],
  fin_creditos: [
    { id: 'cr1', jogador_id: 'p2', jogador_nome: 'Bruno', valor: 14, origem_pagamento_id: 'pg0', data_origem: '2026-09-15', criado_por: 'Adm', criado_em: '2026-09-15T21:00:00+00:00', status: 'ativo', encerrado_por: null, encerrado_em: null, ordem: 1 }
  ],
  fin_lancamentos: [
    { id: 'l1', data: '2026-09-01', tipo: 'entrada', descricao: 'Saldo inicial', valor: 500, criado_por: 'Adm', criado_em: '2026-09-01T10:00:00+00:00', estornado: false, estornado_por: null, estornado_em: null, ordem: 1 }
  ],
  fin_log: [
    { id: 2, timestamp: '2026-09-22T19:05:00+00:00', nome: 'Org', email: 'b@exemplo.com', acao: 'marcarPagamento', detalhe: { data: '2026-09-22', jogadorNome: 'Bruno', valor: 14 } },
    { id: 3, timestamp: '2026-09-22T20:00:00+00:00', nome: 'Adm', email: 'a@exemplo.com', acao: 'nota', detalhe: { texto: 'texto solto' } },
    { id: 1, timestamp: '2026-09-22T19:00:00+00:00', nome: 'Org', email: 'b@exemplo.com', acao: 'marcarPagamento', detalhe: { data: '2026-09-22', jogadorNome: 'Ana', valor: 14 } }
  ],
  ao_vivo: [],
  ao_vivo_log: []
};
```

- [ ] **Step 4: Escrever os testes (devem falhar: o módulo ainda não existe)**

Criar `tests/backend/mapeadores.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { t, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import {
  mapearJogadores, mapearRodadas, mapearConfig, mapearCheckins,
  mapearPerfisPublicos, mapearAoVivo, mapearFinanceiro, CHECKIN_MENSAGEM_PADRAO
} from '../../backend/mapeadores.js';

t('jogadores: sem convidados, na ordem da planilha, textos vazios e estrelas numéricas', () => {
  assert.deepEqual(mapearJogadores(fixture.jogadores), [
    { id: 'p1', nome: 'Ana', apelido: '', foto: '', estrelas: 4, sexo: 'F', porte: 'P' },
    { id: 'p2', nome: 'Bruno', apelido: 'Bru', foto: 'https://exemplo.com/b.jpg', estrelas: 3.5, sexo: 'M', porte: 'G' }
  ]);
});

t('rodadas: ordem por "ordem", times por time_index, jogadores por posicao (com convidado), empate = 2 vencedores', () => {
  const r = mapearRodadas(fixture.rodadas, fixture.times_rodada, fixture.time_jogadores);
  assert.deepEqual(r, [
    { id: 'r1', data: '2026-09-01', rascunho: false, vencedores: [0, 1], times: [
      { nome: 'Time 1', playerIds: ['p1', 'p2'], vitorias: 2 },
      { nome: 'Time 2', playerIds: ['convidado:LUCAS#ab12'], vitorias: 2 } ] },
    { id: 'r2', data: '2026-09-08', rascunho: false, vencedores: [0], times: [
      { nome: 'Time 1', playerIds: ['p1'], vitorias: 3 },
      { nome: 'Time 2', playerIds: ['p2'], vitorias: 1 } ] }
  ]);
});

t('config: valores lidos e padrões para as chaves que faltam', () => {
  assert.deepEqual(mapearConfig(fixture.config), {
    estrelasVisiveis: true, checkinDataAberta: '2026-09-22', checkinTravado: true, checkinVagas: 12,
    checkinHorario: '20:00', checkinMensagemTemplate: CHECKIN_MENSAGEM_PADRAO, contadorAcessos: 41
  });
  assert.equal(mapearConfig([]).checkinVagas, 16);
  assert.equal(mapearConfig([{ chave: 'estrelasVisiveis', valor: 'FALSE' }]).estrelasVisiveis, false);
});

t('checkins: ordem de chegada, órfão vira jogadorId vazio, nota do dia como texto', () => {
  assert.deepEqual(mapearCheckins(fixture.checkins), [
    { id: 'c1', data: '2026-09-22', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: 4, sexo: 'F', estrelasAjustadas: '' },
    { id: 'c2', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3.5, sexo: 'M', estrelasAjustadas: '4' },
    { id: 'c3', data: '2026-09-22', jogadorId: '', jogadorNome: 'Antigo', estrelas: 0, sexo: 'M', estrelasAjustadas: '' }
  ]);
});

t('perfisPublicos: só quem tem jogador vinculado, na ordem, sem e-mail', () => {
  assert.deepEqual(mapearPerfisPublicos(fixture.usuarios), [
    { jogadorId: 'p1', perfil: 'admin' },
    { jogadorId: 'p2', perfil: 'organizador' }
  ]);
});

t('aoVivo: sem transmissão devolve vazio; com linhas falha alto (etapa 5)', () => {
  assert.deepEqual(mapearAoVivo([], []), { rounds: [], log: [] });
  assert.throws(() => mapearAoVivo([{ round_id: 'r1' }], []), /etapa 5/);
});

t('financeiro: dias, pagamentos, créditos e lançamentos na ordem, com padrões e carimbos ISO', () => {
  const f = mapearFinanceiro(fixture);
  assert.deepEqual(f.dias, [
    { data: '2026-09-15', valorPessoa: 14, pix: '', valorQuadra: 0, temBrinde: false, valorBrinde: 0, icone: '✅', status: 'semjogo' },
    { data: '2026-09-22', valorPessoa: 14, pix: '31999999999', valorQuadra: 180, temBrinde: true, valorBrinde: 50, icone: '💰', status: '' }
  ]);
  assert.deepEqual(f.pagamentos.map((p) => p.id), ['pg1', 'pg2', 'pg3']);
  assert.deepEqual(f.pagamentos[1], {
    id: 'pg2', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno', valor: 14, marcadoPor: 'Org',
    marcadoEm: '2026-09-22T19:05:00.000Z', estornado: true, estornadoPor: 'Adm', estornadoEm: '2026-09-22T20:00:00.000Z',
    tipo: 'credito', creditoId: 'cr1'
  });
  assert.equal(f.pagamentos[2].jogadorId, '');
  assert.equal(f.pagamentos[0].estornadoEm, '');
  assert.deepEqual(f.creditos, [{
    id: 'cr1', jogadorId: 'p2', jogadorNome: 'Bruno', valor: 14, origemPagamentoId: 'pg0', dataOrigem: '2026-09-15',
    criadoPor: 'Adm', criadoEm: '2026-09-15T21:00:00.000Z', status: 'ativo', encerradoPor: '', encerradoEm: ''
  }]);
  assert.equal(f.lancamentos[0].valor, 500);
});

t('financeiro.log: mais recente primeiro, sem e-mail, detalhe como texto, no máximo 100', () => {
  const f = mapearFinanceiro(fixture);
  assert.deepEqual(f.log.map((l) => l.acao), ['nota', 'marcarPagamento', 'marcarPagamento']);
  assert.deepEqual(f.log[0], { timestamp: '2026-09-22T20:00:00.000Z', nome: 'Adm', acao: 'nota', detalhe: 'texto solto' });
  assert.equal(f.log[1].detalhe, '{"data":"2026-09-22","jogadorNome":"Bruno","valor":14}');
  const muitos = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, timestamp: '2026-09-22T10:00:00+00:00', nome: 'x', email: 'x', acao: 'a', detalhe: null }));
  const f2 = mapearFinanceiro({ ...fixture, fin_log: muitos });
  assert.equal(f2.log.length, 100);
  assert.equal(f2.log[0].detalhe, '');
});

fim();
```

- [ ] **Step 5: Rodar e confirmar que falha**

Run: `node tests/backend/mapeadores.test.mjs`
Expected: erro `Cannot find module` apontando para `backend/mapeadores.js`.

- [ ] **Step 6: Implementar `backend/mapeadores.js`**

```javascript
// Converte linhas do banco (snake_case, tipos do Postgres) no JSON que o app já recebe do
// Apps Script (mesmos nomes, tipos e ordem). Funções puras: nada aqui fala com banco nem rede.
// Fonte da verdade do formato: readPlayers/readRounds/readSettings/readCheckins/lerFinanceiro_
// em apps-script-codigo.gs.

export const CHECKIN_MENSAGEM_PADRAO = 'Vôlei {diaSemana} {data} às {horario} horas, quem animar coloca o nome abaixo o mais rápido possível blz pessoal.\nOs {vagas} primeiros a enviarem o nome estarão no jogo';

const texto = (v) => (v === undefined || v === null ? '' : String(v));
// mesmo efeito de "Number(x) || 0" e de finNum_ do .gs: o que não é número vira 0
const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// o .gs guarda carimbos como texto ISO (toISOString, com milissegundos e Z); o Postgres devolve
// "2026-09-22T19:00:00+00:00" — normaliza pro mesmo formato do .gs
const iso = (v) => (v ? new Date(v).toISOString() : '');

// ordem da planilha; linhas sem "ordem" vão pro fim
const porOrdem = (a, b) => {
  const x = a.ordem ?? Infinity;
  const y = b.ordem ?? Infinity;
  return x === y ? 0 : (x < y ? -1 : 1);
};

export function mapearJogadores(jogadores) {
  return jogadores
    .filter((j) => !j.convidado)
    .slice().sort(porOrdem)
    .map((j) => ({
      id: texto(j.id), nome: texto(j.nome), apelido: texto(j.apelido), foto: texto(j.foto),
      estrelas: numero(j.estrelas), sexo: texto(j.sexo), porte: texto(j.porte)
    }));
}

export function mapearRodadas(rodadas, times, timeJogadores) {
  const jogadoresPorTime = new Map();
  for (const tj of timeJogadores.slice().sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0))) {
    if (!jogadoresPorTime.has(tj.time_rodada_id)) jogadoresPorTime.set(tj.time_rodada_id, []);
    jogadoresPorTime.get(tj.time_rodada_id).push(texto(tj.jogador_id));
  }
  const timesPorRodada = new Map();
  for (const time of times.slice().sort((a, b) => a.time_index - b.time_index)) {
    if (!timesPorRodada.has(time.round_id)) timesPorRodada.set(time.round_id, []);
    timesPorRodada.get(time.round_id).push(time);
  }
  return rodadas.slice().sort(porOrdem).map((r) => {
    const saida = { id: texto(r.round_id), data: texto(r.data), times: [], vencedores: [], rascunho: r.rascunho === true };
    for (const time of timesPorRodada.get(r.round_id) || []) {
      saida.times[time.time_index] = {
        nome: texto(time.time_nome),
        playerIds: jogadoresPorTime.get(time.id) || [],
        vitorias: numero(time.vitorias)
      };
      if (time.vencedor === true) saida.vencedores.push(time.time_index);
    }
    return saida;
  });
}

export function mapearConfig(linhas) {
  const s = {
    estrelasVisiveis: true, checkinDataAberta: '', checkinTravado: false, checkinVagas: 16,
    checkinHorario: '20:00', checkinMensagemTemplate: CHECKIN_MENSAGEM_PADRAO, contadorAcessos: 0
  };
  for (const { chave, valor } of linhas) {
    if (chave === 'estrelasVisiveis') s.estrelasVisiveis = String(valor).toUpperCase() === 'TRUE';
    if (chave === 'checkinDataAberta') s.checkinDataAberta = texto(valor);
    if (chave === 'checkinTravado') s.checkinTravado = String(valor).toUpperCase() === 'TRUE';
    if (chave === 'checkinVagas') s.checkinVagas = Number(valor) || 16;
    if (chave === 'checkinHorario') s.checkinHorario = texto(valor) || '20:00';
    if (chave === 'checkinMensagemTemplate') s.checkinMensagemTemplate = texto(valor) || CHECKIN_MENSAGEM_PADRAO;
    if (chave === 'contadorAcessos') s.contadorAcessos = Number(valor) || 0;
  }
  return s;
}

export function mapearCheckins(checkins) {
  return checkins.slice().sort(porOrdem).map((c) => ({
    id: texto(c.id), data: texto(c.data), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome),
    estrelas: numero(c.estrelas), sexo: texto(c.sexo),
    // nota só pra ESTE check-in; vazia = usa a estrela do cadastro
    estrelasAjustadas: texto(c.estrelas_ajustadas)
  }));
}

export function mapearPerfisPublicos(usuarios) {
  return usuarios.slice().sort(porOrdem)
    .filter((u) => u.jogador_id)
    .map((u) => ({ jogadorId: texto(u.jogador_id), perfil: (texto(u.perfil) || 'jogador').trim().toLowerCase() }));
}

// O schema atual de ao_vivo não tem "data" nem a lista de jogadores por time (o .gs tem):
// isso é resolvido na etapa 5. Até lá, falha alto em vez de devolver dado errado.
export function mapearAoVivo(aoVivo, aoVivoLog) {
  if (aoVivo.length || aoVivoLog.length) {
    throw new Error('Ao Vivo ainda não é suportado pelo backend Supabase (etapa 5).');
  }
  return { rounds: [], log: [] };
}

const icone = (v) => (texto(v).trim() === '💰' ? '💰' : '✅');
const statusDia = (v) => (texto(v).trim() === 'semjogo' ? 'semjogo' : '');
const tipoPagamento = (v) => (texto(v).trim() === 'credito' ? 'credito' : 'dinheiro');

// o .gs devolve o "detalhe" do log como texto: JSON serializado, ou o texto solto
// (a migração guardou o texto solto como { texto: "..." })
function detalheComoTexto(d) {
  if (d === null || d === undefined) return '';
  if (typeof d === 'string') return d;
  if (typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 1 && typeof d.texto === 'string') return d.texto;
  return JSON.stringify(d);
}

export function mapearFinanceiro({ fin_dias, fin_pagamentos, fin_creditos, fin_lancamentos, fin_log }) {
  const dias = fin_dias.slice().sort(porOrdem).map((d) => ({
    data: texto(d.data), valorPessoa: numero(d.valor_pessoa), pix: texto(d.pix), valorQuadra: numero(d.valor_quadra),
    temBrinde: d.tem_brinde === true, valorBrinde: numero(d.valor_brinde), icone: icone(d.icone), status: statusDia(d.status)
  }));
  const pagamentos = fin_pagamentos.slice().sort(porOrdem).map((p) => ({
    id: texto(p.id), data: texto(p.data), jogadorId: texto(p.jogador_id), jogadorNome: texto(p.jogador_nome),
    valor: numero(p.valor), marcadoPor: texto(p.marcado_por), marcadoEm: iso(p.marcado_em),
    estornado: p.estornado === true, estornadoPor: texto(p.estornado_por), estornadoEm: iso(p.estornado_em),
    tipo: tipoPagamento(p.tipo), creditoId: texto(p.credito_id)
  }));
  const creditos = fin_creditos.slice().sort(porOrdem).map((c) => ({
    id: texto(c.id), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome), valor: numero(c.valor),
    origemPagamentoId: texto(c.origem_pagamento_id), dataOrigem: texto(c.data_origem), criadoPor: texto(c.criado_por),
    criadoEm: iso(c.criado_em), status: texto(c.status) || 'ativo', encerradoPor: texto(c.encerrado_por), encerradoEm: iso(c.encerrado_em)
  }));
  const lancamentos = fin_lancamentos.slice().sort(porOrdem).map((l) => ({
    id: texto(l.id), data: texto(l.data), tipo: texto(l.tipo), descricao: texto(l.descricao), valor: numero(l.valor),
    criadoPor: texto(l.criado_por), criadoEm: iso(l.criado_em),
    estornado: l.estornado === true, estornadoPor: texto(l.estornado_por), estornadoEm: iso(l.estornado_em)
  }));
  const log = fin_log.slice().sort((a, b) => b.id - a.id).slice(0, 100).map((l) => ({
    timestamp: iso(l.timestamp), nome: texto(l.nome), acao: texto(l.acao), detalhe: detalheComoTexto(l.detalhe) // e-mail nunca sai daqui
  }));
  return { dias, pagamentos, lancamentos, log, creditos };
}
```

- [ ] **Step 7: Rodar os testes — devem passar**

Run: `node tests/backend/mapeadores.test.mjs`
Expected: 8 linhas `ok` e `TODOS OS TESTES PASSARAM`.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/mapeadores.js tests/backend/executor.mjs tests/backend/fixture.mjs tests/backend/mapeadores.test.mjs
git commit -m "feat: mapeadores banco -> JSON do app (etapa 1 do backend Supabase)"
```

---

### Task 2: Handler do GET, repo em memória e testes

**Files:**
- Create: `backend/repo-memoria.js`
- Create: `backend/handler.js`
- Test: `tests/backend/handler.test.mjs`

**Interfaces:**
- Consome: as funções `mapear*` da Task 1 e `fixture` de `tests/backend/fixture.mjs`.
- Produz: `TABELAS` (array dos 14 nomes de tabela) e `criarRepoMemoria(dados)` em `backend/repo-memoria.js`, com `lerTudo()` assíncrono devolvendo `{ <tabela>: [linhas] }`; `criarHandler({ repo })` em `backend/handler.js`, com `get()` e `post(body)` assíncronos — a Task 3 e a Task 5 usam o handler.

- [ ] **Step 1: Escrever os testes (devem falhar)**

Criar `tests/backend/handler.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const handler = () => criarHandler({ repo: criarRepoMemoria(fixture) });

await ta('get: devolve as 7 chaves do contrato', async () => {
  const r = await handler().get();
  assert.deepEqual(Object.keys(r).sort(), ['aoVivo', 'checkins', 'financeiro', 'perfisPublicos', 'players', 'rounds', 'settings']);
  assert.equal(r.players.length, 2);
  assert.equal(r.rounds.length, 2);
  assert.equal(r.checkins.length, 3);
  assert.equal(r.settings.checkinVagas, 12);
});

await ta('get: erro do repositório vira { error } como o doGet', async () => {
  const h = criarHandler({ repo: { async lerTudo() { throw new Error('banco fora do ar'); } } });
  assert.deepEqual(await h.get(), { error: 'banco fora do ar' });
});

await ta('post incrementarAcesso: devolve o contador atual (leitura; gravar é da etapa 5)', async () => {
  assert.deepEqual(await handler().post({ action: 'incrementarAcesso' }), { contadorAcessos: 41 });
});

await ta('post de ação ainda não portada: erro claro com o nome da ação', async () => {
  const r = await handler().post({ action: 'addCheckin' });
  assert.match(r.error, /ainda não está disponível/);
  assert.match(r.error, /addCheckin/);
});

fim();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tests/backend/handler.test.mjs`
Expected: erro `Cannot find module` apontando para `backend/repo-memoria.js`.

- [ ] **Step 3: Implementar `backend/repo-memoria.js`**

```javascript
// Repositório em memória: mesma interface do repo-supabase (lerTudo), usado nos testes.
export const TABELAS = [
  'jogadores', 'rodadas', 'times_rodada', 'time_jogadores', 'checkins', 'config', 'usuarios',
  'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'ao_vivo', 'ao_vivo_log'
];

export function criarRepoMemoria(dados = {}) {
  const tabelas = {};
  for (const nome of TABELAS) tabelas[nome] = (dados[nome] || []).map((linha) => ({ ...linha }));
  return {
    tabelas,
    async lerTudo() { return structuredClone(tabelas); }
  };
}
```

- [ ] **Step 4: Implementar `backend/handler.js`**

```javascript
import {
  mapearJogadores, mapearRodadas, mapearConfig, mapearCheckins,
  mapearPerfisPublicos, mapearAoVivo, mapearFinanceiro
} from './mapeadores.js';

// Handler do backend: mesma cara do doGet/doPost do Apps Script. Recebe o repositório por
// injeção (memória nos testes, Supabase de verdade no servidor local e na Edge Function).
export function criarHandler({ repo }) {
  return {
    async get() {
      try {
        const t = await repo.lerTudo();
        return {
          players: mapearJogadores(t.jogadores),
          rounds: mapearRodadas(t.rodadas, t.times_rodada, t.time_jogadores),
          settings: mapearConfig(t.config),
          checkins: mapearCheckins(t.checkins),
          perfisPublicos: mapearPerfisPublicos(t.usuarios),
          aoVivo: mapearAoVivo(t.ao_vivo, t.ao_vivo_log),
          financeiro: mapearFinanceiro(t)
        };
      } catch (erro) {
        return { error: String(erro && erro.message ? erro.message : erro) };
      }
    },

    // Etapa 1: só leitura. As ações de escrita chegam nas próximas etapas.
    async post(body) {
      const acao = body && body.action;
      if (acao === 'incrementarAcesso') {
        const t = await repo.lerTudo();
        return { contadorAcessos: mapearConfig(t.config).contadorAcessos };
      }
      return { error: 'Esta ação ainda não está disponível na versão Supabase (' + String(acao) + ').' };
    }
  };
}
```

- [ ] **Step 5: Rodar os testes — devem passar**

Run: `node tests/backend/handler.test.mjs`
Expected: 4 linhas `ok` e `TODOS OS TESTES PASSARAM`. Rodar também `node tests/backend/mapeadores.test.mjs` (continua verde).

- [ ] **Step 6: Commit**

```bash
git add backend/repo-memoria.js backend/handler.js tests/backend/handler.test.mjs
git commit -m "feat: handler do GET e repositório em memória (etapa 1 do backend Supabase)"
```

---

### Task 3: Teste de paridade com o `.gs` real

**Files:**
- Create: `tests/backend/dbParaAbas.mjs`
- Test: `tests/backend/paridade-get.test.mjs`

**Interfaces:**
- Consome: `fixture` (Task 1), `criarRepoMemoria` e `criarHandler` (Task 2), `criarAmbiente` de `tests/helpers/planilha-falsa.js` (já existe; `criarAmbiente(abas, [caminhoDoGs]).get()` devolve o JSON do `doGet` do `.gs`).
- Produz: `dbParaAbas(fixture)` em `tests/backend/dbParaAbas.mjs`, devolvendo `{ NomeDaAba: [[cabeçalho...], [linha...], ...] }` no formato que o `.gs` lê.

- [ ] **Step 1: Criar `tests/backend/dbParaAbas.mjs`**

```javascript
// Transforma os dados do fixture (formato do banco) nas abas da planilha, como o Apps Script as lê.
// É o caminho inverso da migração: serve só para o teste de paridade.
const vazio = (v) => (v === null || v === undefined ? '' : v);
const iso = (v) => (v ? new Date(v).toISOString() : '');
const porOrdem = (a, b) => {
  const x = a.ordem ?? Infinity;
  const y = b.ordem ?? Infinity;
  return x === y ? 0 : (x < y ? -1 : 1);
};
const ordenar = (linhas) => linhas.slice().sort(porOrdem);

export function dbParaAbas(fx) {
  const abas = {};

  abas.Jogadores = [['id', 'nome', 'apelido', 'foto', 'estrelas', 'sexo', 'porte'],
    ...ordenar(fx.jogadores.filter((j) => !j.convidado))
      .map((j) => [j.id, vazio(j.nome), vazio(j.apelido), vazio(j.foto), vazio(j.estrelas), vazio(j.sexo), vazio(j.porte)])];

  const linhasRodadas = [];
  for (const r of ordenar(fx.rodadas)) {
    const times = fx.times_rodada.filter((x) => x.round_id === r.round_id).sort((a, b) => a.time_index - b.time_index);
    for (const time of times) {
      const ids = fx.time_jogadores.filter((x) => x.time_rodada_id === time.id).sort((a, b) => a.posicao - b.posicao).map((x) => x.jogador_id);
      linhasRodadas.push([r.round_id, r.data, time.time_index, vazio(time.time_nome), ids.join(','), time.vitorias, time.vencedor, r.rascunho]);
    }
  }
  abas.Rodadas = [['roundId', 'data', 'timeIndex', 'timeNome', 'jogadores', 'vitorias', 'vencedor', 'rascunho'], ...linhasRodadas];

  abas.Config = fx.config.map((c) => [c.chave, c.valor]);

  abas.Checkins = [['id', 'data', 'jogadorId', 'jogadorNome', 'estrelas', 'sexo', 'estrelasAjustadas'],
    ...ordenar(fx.checkins).map((c) => [c.id, c.data, vazio(c.jogador_id), vazio(c.jogador_nome), vazio(c.estrelas), vazio(c.sexo), vazio(c.estrelas_ajustadas)])];

  abas.Usuarios = [['email', 'nome', 'perfil', 'jogadorId', 'criadoEm', 'jogadorIdPendente'],
    ...ordenar(fx.usuarios).map((u) => [u.email, vazio(u.nome), u.perfil, vazio(u.jogador_id), iso(u.criado_em), vazio(u.jogador_id_pendente)])];

  abas.FinDias = [['data', 'valorPessoa', 'pix', 'valorQuadra', 'temBrinde', 'valorBrinde', 'atualizadoPor', 'atualizadoEm', 'icone', 'status'],
    ...ordenar(fx.fin_dias).map((d) => [d.data, d.valor_pessoa, vazio(d.pix), d.valor_quadra, d.tem_brinde, d.valor_brinde,
      vazio(d.atualizado_por), iso(d.atualizado_em), vazio(d.icone), d.status === 'semjogo' ? 'semjogo' : ''])];

  abas.FinPagamentos = [['id', 'data', 'jogadorId', 'jogadorNome', 'valor', 'marcadoPor', 'marcadoEm', 'estornado', 'estornadoPor', 'estornadoEm', 'tipo', 'creditoId'],
    ...ordenar(fx.fin_pagamentos).map((p) => [p.id, p.data, vazio(p.jogador_id), vazio(p.jogador_nome), p.valor, vazio(p.marcado_por),
      iso(p.marcado_em), p.estornado, vazio(p.estornado_por), iso(p.estornado_em), p.tipo, vazio(p.credito_id)])];

  abas.FinCreditos = [['id', 'jogadorId', 'jogadorNome', 'valor', 'origemPagamentoId', 'dataOrigem', 'criadoPor', 'criadoEm', 'status', 'encerradoPor', 'encerradoEm'],
    ...ordenar(fx.fin_creditos).map((c) => [c.id, vazio(c.jogador_id), vazio(c.jogador_nome), c.valor, vazio(c.origem_pagamento_id),
      vazio(c.data_origem), vazio(c.criado_por), iso(c.criado_em), vazio(c.status), vazio(c.encerrado_por), iso(c.encerrado_em)])];

  abas.FinLancamentos = [['id', 'data', 'tipo', 'descricao', 'valor', 'criadoPor', 'criadoEm', 'estornado', 'estornadoPor', 'estornadoEm'],
    ...ordenar(fx.fin_lancamentos).map((l) => [l.id, l.data, l.tipo, vazio(l.descricao), l.valor, vazio(l.criado_por),
      iso(l.criado_em), l.estornado, vazio(l.estornado_por), iso(l.estornado_em)])];

  // o log da planilha guarda o detalhe como texto (JSON serializado, ou o texto solto)
  const detalhe = (d) => (d === null || d === undefined ? '' : (typeof d === 'object' && Object.keys(d).length === 1 && typeof d.texto === 'string' ? d.texto : JSON.stringify(d)));
  abas.FinLog = [['timestamp', 'nome', 'email', 'acao', 'detalhe'],
    ...fx.fin_log.slice().sort((a, b) => a.id - b.id).map((l) => [iso(l.timestamp), vazio(l.nome), vazio(l.email), vazio(l.acao), detalhe(l.detalhe)])];

  return abas;
}
```

- [ ] **Step 2: Escrever o teste de paridade (pode falhar por diferenças reais de formato: é o objetivo)**

Criar `tests/backend/paridade-get.test.mjs`:

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

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');

if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - apps-script-codigo.gs não existe nesta pasta (o arquivo é ignorado pelo git; copie-o da máquina do usuário).');
  process.exit(0);
}

const { criarAmbiente } = require('../helpers/planilha-falsa.js');

await ta('paridade do GET: o backend novo devolve o mesmo JSON que o doGet do .gs real', async () => {
  const esperado = criarAmbiente(dbParaAbas(fixture), [caminhoGs]).get();
  const obtido = JSON.parse(JSON.stringify(await criarHandler({ repo: criarRepoMemoria(fixture) }).get()));
  assert.deepEqual(obtido, esperado);
});

fim();
```

- [ ] **Step 3: Rodar e analisar**

Run: `node tests/backend/paridade-get.test.mjs`
Expected: `ok - paridade do GET...` e `TODOS OS TESTES PASSARAM`.
Se falhar, a mensagem mostra a chave que difere. Para cada diferença, decidir com o `.gs` como fonte da verdade:
- diferença por bug do mapeador → corrigir o mapeador (`backend/mapeadores.js`) e rodar também `node tests/backend/mapeadores.test.mjs`;
- diferença que só existe por causa do formato da planilha falsa (por exemplo o `.gs` lendo um tipo que o teste escreveu de outro jeito) → corrigir `dbParaAbas.mjs`.
Não alterar o `.gs`. Repetir até passar.

- [ ] **Step 4: Commit**

O teste de paridade usa `tests/helpers/planilha-falsa.js`, que até agora só existia como arquivo local sem versionar (a suíte financeira antiga depende dele). Ele é código de teste sem segredo: entra neste commit para o teste rodar em qualquer cópia do repositório. (Ao mesclar na `main`, o arquivo não versionado que existe lá precisa ser removido antes, senão o git recusa sobrescrevê-lo; o conteúdo é o mesmo.)

```bash
git add tests/helpers/planilha-falsa.js tests/backend/dbParaAbas.mjs tests/backend/paridade-get.test.mjs backend/mapeadores.js
git commit -m "test: paridade do GET do backend novo com o doGet do .gs real"
```

---

### Task 4: Repositório do Supabase e verificação contra o banco real (somente leitura)

**Files:**
- Create: `backend/repo-supabase.js`
- Create: `tests/backend/integracao-supabase.mjs`

**Interfaces:**
- Consome: `TABELAS` (Task 2) e `criarHandler` (Task 2).
- Produz: `criarRepoSupabase(cliente)` em `backend/repo-supabase.js` — `cliente` é um cliente do `@supabase/supabase-js`; devolve `{ lerTudo() }` igual ao repo em memória. Task 5 usa.

- [ ] **Step 1: Implementar `backend/repo-supabase.js`**

```javascript
import { TABELAS } from './repo-memoria.js';

const PAGINA = 1000; // limite de linhas por consulta do Supabase; as tabelas de hoje têm menos que isso (a maior, time_jogadores, ~540)

async function lerTabela(cliente, tabela) {
  let saida = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await cliente.from(tabela).select('*').range(de, de + PAGINA - 1);
    if (error) throw new Error(tabela + ': ' + error.message);
    saida = saida.concat(data);
    if (data.length < PAGINA) break;
  }
  return saida;
}

// Repositório de verdade: lê todas as tabelas (em paralelo). O cliente recebido deve usar a
// service_role, porque o RLS está ligado sem políticas (o navegador nunca acessa o banco direto).
export function criarRepoSupabase(cliente) {
  return {
    async lerTudo() {
      const pares = await Promise.all(TABELAS.map(async (tabela) => {
        if (tabela === 'fin_log') {
          // o app só usa os 100 mais recentes
          const { data, error } = await cliente.from(tabela).select('*').order('id', { ascending: false }).limit(100);
          if (error) throw new Error(tabela + ': ' + error.message);
          return [tabela, data];
        }
        return [tabela, await lerTabela(cliente, tabela)];
      }));
      return Object.fromEntries(pares);
    }
  };
}
```

- [ ] **Step 2: Criar `tests/backend/integracao-supabase.mjs`**

Verificação manual (lê o banco real; não faz parte da suíte automática):

```javascript
// Lê o Supabase REAL (somente leitura) e confere o resultado do GET com os números conhecidos da
// migração. Uso: node tests/backend/integracao-supabase.mjs   (precisa do .env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)
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
const handler = criarHandler({ repo: criarRepoSupabase(cliente) });

let r;
await ta('GET real: responde sem erro e mede o tempo', async () => {
  const inicio = performance.now();
  r = await handler.get();
  const ms = Math.round(performance.now() - inicio);
  console.log('       tempo do GET:', ms, 'ms');
  assert.equal(r.error, undefined, r.error);
});

await ta('GET real: contagens iguais às da migração', async () => {
  assert.equal(r.players.length, 47);
  assert.equal(r.rounds.length, 34);
  assert.equal(r.checkins.length, 75);
  assert.equal(r.financeiro.dias.length, 2);
  assert.equal(r.financeiro.pagamentos.length, 34);
  assert.equal(r.financeiro.creditos.length, 16);
  assert.equal(r.financeiro.lancamentos.length, 1);
  assert.equal(r.financeiro.log.length, 47);
  assert.equal(r.rounds.reduce((soma, x) => soma + x.vencedores.length, 0), 33);
});

await ta('GET real: convidados aparecem nos times e não na lista de jogadores', async () => {
  const idsJogadores = new Set(r.players.map((p) => p.id));
  const idsNosTimes = r.rounds.flatMap((x) => x.times.flatMap((tm) => (tm ? tm.playerIds : [])));
  assert.ok(idsNosTimes.some((id) => id.startsWith('convidado:')));
  assert.ok(!r.players.some((p) => p.id.startsWith('convidado:')));
  assert.ok(idsNosTimes.filter((id) => !id.startsWith('convidado:')).every((id) => idsJogadores.has(id)));
});

await ta('GET real: perfisPublicos bate com os usuários vinculados', async () => {
  const { data } = await cliente.from('usuarios').select('jogador_id');
  assert.equal(r.perfisPublicos.length, data.filter((u) => u.jogador_id).length);
});

fim();
```

- [ ] **Step 3: Validar sintaxe**

Run: `node --check backend/repo-supabase.js && node --check tests/backend/integracao-supabase.mjs`
Expected: sem saída (sem erro).

- [ ] **Step 4: Rodar contra o banco real (o controlador executa; só lê)**

Run: `node tests/backend/integracao-supabase.mjs`
Expected: 4 linhas `ok`, uma linha `tempo do GET: N ms` e `TODOS OS TESTES PASSARAM`. Se algum número divergir, investigar (não ajustar o número esperado sem entender a causa).

- [ ] **Step 5: Commit**

```bash
git add backend/repo-supabase.js tests/backend/integracao-supabase.mjs
git commit -m "feat: repositório do Supabase e verificação de leitura contra o banco real"
```

---

### Task 5: Servidor local e verificação no navegador

**Files:**
- Create: `backend/servidor-local.js`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consome: `criarHandler` (Task 2) e `criarRepoSupabase` (Task 4).
- Produz: `npm run servidor` (e `npm run test:backend`), servidor em `http://localhost:8770`.

- [ ] **Step 1: Implementar `backend/servidor-local.js`**

```javascript
// Servidor local: serve o volei-dashboard.html de verdade e a rota /api (o mesmo handler que vai
// virar Edge Function), lendo do Supabase. Só escuta em 127.0.0.1. A service_role fica só aqui.
// Uso: node backend/servidor-local.js [porta]
//   HTML_TERCA=<caminho do volei-dashboard.html>  (padrão: o da raiz do repositório)
// Parâmetros da URL para conferir telas (só no navegador, sem login de verdade nesta etapa):
//   ?perfil=admin  simula um usuário logado como admin (só para ver as telas)   ?view=financeiro  abre a tela
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { criarHandler } from './handler.js';
import { criarRepoSupabase } from './repo-supabase.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const porta = Number(process.argv[2]) || 8770;
const arquivoHtml = process.env.HTML_TERCA || path.join(raiz, 'volei-dashboard.html');
const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const handler = criarHandler({ repo: criarRepoSupabase(cliente) });

const INJECAO = `<script>(function(){
  var q = new URLSearchParams(location.search);
  var espera = setInterval(function(){
    var c = document.getElementById('loading');
    if(!c || c.style.display !== 'none') return;
    clearInterval(espera);
    if(q.get('perfil') === 'admin'){ AUTH.logado = true; AUTH.perfil = 'admin'; aplicarPermissoesUI(); }
    var v = q.get('view');
    if(v){ var b = document.querySelector('#nav button[data-view="' + v + '"]'); if(b) b.click(); }
  }, 100);
})();</script>`;

function responderJson(res, objeto) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(objeto));
}

http.createServer(async (req, res) => {
  try {
    const caminho = req.url.split('?')[0];
    if (caminho === '/api') {
      if (req.method === 'GET') return responderJson(res, await handler.get());
      if (req.method === 'POST') {
        let corpo = '';
        for await (const pedaco of req) corpo += pedaco;
        return responderJson(res, await handler.post(JSON.parse(corpo || '{}')));
      }
      res.writeHead(405); return res.end();
    }
    if (caminho !== '/') { res.writeHead(404); return res.end(); }
    const html = fs.readFileSync(arquivoHtml, 'utf8')
      .replace(/const SHEET_API_URL = "[^"]*";/, 'const SHEET_API_URL = "http://localhost:' + porta + '/api";')
      .replace('</body>', INJECAO + '</body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch (erro) {
    responderJson(res, { error: String(erro && erro.message ? erro.message : erro) });
  }
}).listen(porta, '127.0.0.1', () => console.log('Terça (Supabase) em http://localhost:' + porta));
```

- [ ] **Step 2: Atualizar os scripts do `package.json`**

Deixar o bloco `scripts` assim (mantendo `migrar`):

```json
  "scripts": {
    "migrar": "node scripts/migrar-terca-supabase.js",
    "servidor": "node backend/servidor-local.js",
    "test:backend": "node tests/backend/mapeadores.test.mjs && node tests/backend/handler.test.mjs && node tests/backend/paridade-get.test.mjs"
  }
```

- [ ] **Step 3: Rodar a suíte do backend**

Run: `npm run test:backend`
Expected: os três arquivos terminam com `TODOS OS TESTES PASSARAM`.

- [ ] **Step 4: Subir o servidor e testar a rota (o controlador executa)**

Run (em segundo plano): `npm run servidor`
Depois: `node -e "fetch('http://localhost:8770/api').then(r=>r.json()).then(j=>console.log(Object.keys(j).join(','), j.players.length, j.rounds.length))"`
Expected: `players,rounds,settings,checkins,perfisPublicos,aoVivo,financeiro 47 34`.
Conferir também que `http://localhost:8770/sw.js` responde 404 (o servidor só serve `/` e `/api`).

- [ ] **Step 5: Commit**

```bash
git add backend/servidor-local.js package.json
git commit -m "feat: servidor local do Terça sobre o Supabase (etapa 1 do backend)"
```

- [ ] **Step 6: Verificação manual no navegador (o usuário)**

O `volei-dashboard.html` do worktree é a versão commitada (mais antiga). O app atual está no checkout principal, então o servidor deve apontar para ele. No PowerShell:

```powershell
cd C:\Users\Heleno\OneDrive\Documentos\GitHub\voleis_VS\.worktrees\terca-supabase-migracao
$env:HTML_TERCA = "C:\Users\Heleno\OneDrive\Documentos\GitHub\voleis_VS\volei-dashboard.html"
npm run servidor
```

Abrir `http://localhost:8770` e conferir, comparando com o app em produção:
- lista de jogadores com fotos, estrelas e nomes;
- histórico de rodadas com os times e os vencedores (medalhas/vitórias);
- check-in do dia (ordem de chegada e quem está dentro das vagas);
- ranking e Hall da Fama;
- `http://localhost:8770/?perfil=admin&view=financeiro`: tela do financeiro com dias, pagamentos e créditos.
Nesta etapa qualquer ação de gravação (marcar presença, salvar rodada, pagar) responde "ainda não está disponível na versão Supabase": isso é esperado.
