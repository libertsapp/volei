# Grupos independentes — Fase 3 (app: modo grupo + página de criação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O `volei-dashboard.html` passa a funcionar em "modo grupo" quando aberto em `volei.memberstars.com/<apelido>/` (identidade, API e chaves do aparelho do grupo), com a página `volei.memberstars.com/` (ou `/criar`) para criar um grupo em um clique, telas de grupo inexistente/suspenso e boas-vindas para o dono — sem mudar nada do Terça fora desse endereço.

**Architecture:** Um bloco puro `<grupo-puro>` decide, pelo host e pelo caminho, se há modo grupo e qual o apelido (`CTX_GRUPO`); daí saem `URL_API` (a `grupos-api` com `?g=`), as chaves do aparelho com o apelido e o nome do app. Fora do modo grupo, tudo devolve exatamente os valores de hoje. A identidade (nome, cor, iniciais, manifesto) é aplicada quando o GET devolve `grupo`. No backend, a `grupos-api` aceita o grupo também pela query no POST (o app não precisa mudar as 12 chamadas) e as respostas de recusa passam a ter `codigo` padronizado. Um servidor local em memória serve o app em qualquer caminho para testes no navegador.

**Tech Stack:** HTML/JS single-file (sem build), Node 24 (testes CJS `tests/*.test.js` e ESM `tests/backend/*.mjs`), Chrome headless via DevTools Protocol para o roteiro de navegador (driver descartável no scratchpad).

**Spec:** `docs/superpowers/specs/2026-10-12-grupos-independentes-design.md`

## Global Constraints

- Branch `grupos-fase1` (Fases 1 e 2 já estão nela). Nada é publicado; a Fase 4 cuida de Vercel/DNS/Google.
- **Só o Terça** (`volei-dashboard.html`). O HTML do Meme não muda (regra do projeto).
- **Fora do modo grupo nada muda**: mesmo `SHEET_API_URL`, mesmas chaves do aparelho (`volei-auth-v1`, `volei-copia-dados-v1`, `volei-instalar-aviso-v2-fechado`, `volei-notif-pop-dispensado`, `placar-estado-terca-v1`), mesmo nome "Volei de Terça", mesmo manifesto. Um teste puro garante isso.
- Modo grupo só quando `location.hostname` está em `HOSTS_MODO_GRUPO` (no ar: `["volei.memberstars.com"]`; o servidor local reescreve a linha para incluir `localhost`/`127.0.0.1`).
- As linhas `const SHEET_API_URL = "...";`, `const GRUPOS_API_URL = "...";` e `const HOSTS_MODO_GRUPO = [...];` ficam LITERAIS numa linha só (servidores locais as reescrevem por regex).
- Blocos novos dentro de telas: `<div>`, nunca `<section>`. Modais com `profile-overlay`.
- Versão no rodapé: `Ver.: 17.1` → `Ver.: 18.0`.
- Validação de sintaxe do CLAUDE.md depois de toda mudança no HTML; testes de front `for f in tests/*.test.js; do node "$f"; done`; backend `npm run test:backend`.

## Review Focus

1. **Terça aberto no endereço de sempre** (`memberstars.com/volei/`, Vercel, localhost): nenhuma chave, URL ou texto muda — inclusive quem já está logado continua logado. Testado na Task 3 (puro) e no roteiro da Task 4.
2. **Apelido com maiúscula ou sem barra final** (`/Quinta`): vai para `/quinta/` (mesmo grupo, mesmo app instalado). Testado na Task 3 (puro) e Task 4 (navegador).
3. **Dois grupos abertos no mesmo navegador**: login e cópia de dados de um não aparecem no outro (chaves com apelido). Testado na Task 4 (navegador).
4. **Grupo inexistente/suspenso**: tela própria, sem tentar de novo três vezes nem mostrar dado velho guardado. Testado na Task 5.
5. **Criar grupo sem ter logado com Google, ou com endereço já usado**: o botão avisa e nada é criado; com endereço livre, a pessoa cai no app do grupo novo. Testado na Task 6 (navegador).

---

### Task 1: Backend — grupo pela query no POST e `codigo` padronizado

**Files:**
- Modify: `backend/edge.js` (linha do POST: `return responder(200, await handler.post(corpo, { ip: ipParaLimitador(request.headers) }));`)
- Modify: `backend/grupos-cadastro.js`
- Modify: `backend/grupos-api.js`
- Modify: `tests/backend/edge-consulta.test.mjs`, `tests/backend/grupos-cadastro.test.mjs`, `tests/backend/grupos-api.test.mjs`

**Interfaces:**
- Produces: `handler.post(body, { ip, consulta })`. A `grupos-api` usa `body.grupo || contexto.consulta.g`.
- Produces (`grupos-cadastro.js`): `motivoDoApelido(s) -> null | { codigo: 'apelido_invalido' | 'apelido_reservado', mensagem }`; `MENSAGENS_CADASTRO` (os 4 códigos → texto); `validarApelido(s)` continua devolvendo `'' | mensagem`; `validarCadastroGrupo` devolve `{ erro, codigo? }` (com `codigo` quando o problema é o apelido).
- Produces (`grupos-api`): `criarGrupo` recusado por apelido → `{ error, codigo }` sempre, venha a recusa do JS ou do SQL, com o MESMO texto; `verificarApelido` → `{ status: 'ok', disponivel, motivo, codigo }` (`codigo: ''` quando livre; `'apelido_em_uso'` quando ocupado).

- [ ] **Step 1: Testes (falham)**

Em `tests/backend/edge-consulta.test.mjs`, antes de `fim();`:

```js
await ta('POST também repassa os parâmetros da URL (o app de grupo manda ?g= em todas as chamadas)', async () => {
  let recebido;
  const edge = criarEdge({ handler: { get: async () => ({}), post: async (b, ctx) => { recebido = ctx; return { ok: 1 }; } }, origensPermitidas: ['https://volei.memberstars.com'] });
  const r = await edge(new Request('https://x.supabase.co/functions/v1/grupos-api?g=quinta', {
    method: 'POST', headers: { origin: 'https://volei.memberstars.com', 'content-type': 'text/plain' }, body: JSON.stringify({ action: 'ping' })
  }));
  assert.equal(r.status, 200);
  assert.deepEqual(recebido.consulta, { g: 'quinta' });
  assert.ok('ip' in recebido);
});
```

Em `tests/backend/grupos-cadastro.test.mjs`, trocar o import por:

```js
import {
  UFS, PALETA, APELIDOS_RESERVADOS, normalizarApelido, validarApelido, sugerirApelido, normalizarCidade, validarCadastroGrupo,
  motivoDoApelido, MENSAGENS_CADASTRO
} from '../../backend/grupos-cadastro.js';
```

e acrescentar antes de `fim();`:

```js
t('motivoDoApelido: código e mensagem iguais aos do SQL (mesmo texto para a mesma recusa)', () => {
  assert.equal(motivoDoApelido('quinta'), null);
  assert.deepEqual(motivoDoApelido('Qu Inta'), { codigo: 'apelido_invalido', mensagem: MENSAGENS_CADASTRO.apelido_invalido });
  assert.deepEqual(motivoDoApelido('ab'), { codigo: 'apelido_invalido', mensagem: 'O endereço precisa ter de 3 a 30 caracteres.' });
  assert.deepEqual(motivoDoApelido('admin'), { codigo: 'apelido_reservado', mensagem: MENSAGENS_CADASTRO.apelido_reservado });
  assert.equal(validarApelido('admin'), MENSAGENS_CADASTRO.apelido_reservado);
  assert.deepEqual(validarCadastroGrupo({ nome: 'Vôlei', apelido: 'admin', cidade: 'BH', uf: 'MG', cor: PALETA[0] }),
    { erro: MENSAGENS_CADASTRO.apelido_reservado, codigo: 'apelido_reservado' });
  assert.deepEqual(Object.keys(MENSAGENS_CADASTRO).sort(), ['apelido_em_uso', 'apelido_invalido', 'apelido_reservado', 'limite_por_email']);
});
```

Em `tests/backend/grupos-api.test.mjs`:
- trocar `assert.deepEqual(await criar(api, 'tok-outro', { ...NOVO, apelido: 'terca' }, '6.6.6.6'), { error: 'Esse endereço é reservado. Escolha outro.' });` por `assert.deepEqual(await criar(api, 'tok-outro', { ...NOVO, apelido: 'terca' }, '6.6.6.6'), { error: 'Esse endereço é reservado. Escolha outro.', codigo: 'apelido_reservado' });`
- trocar `assert.deepEqual(await v('quinta'), { status: 'ok', disponivel: false, motivo: 'Esse endereço já está em uso. Escolha outro.' });` por `assert.deepEqual(await v('quinta'), { status: 'ok', disponivel: false, motivo: 'Esse endereço já está em uso. Escolha outro.', codigo: 'apelido_em_uso' });`
- trocar `assert.deepEqual(await v('domingo'), { status: 'ok', disponivel: true, motivo: '' });` por `assert.deepEqual(await v('domingo'), { status: 'ok', disponivel: true, motivo: '', codigo: '' });`
- acrescentar antes de `fim();`:

```js
await ta('grupo pela query no POST (contexto.consulta.g) quando o corpo não traz "grupo"', async () => {
  const { api } = mundo();
  await criar(api, 'tok-dono', NOVO);
  const r = await api.post({ action: 'addPlayer', idToken: 'tok-dono', player: jogador('p1', 'Ana') }, { consulta: { g: 'quinta' } });
  assert.equal(r.status, 'ok');
  assert.deepEqual((await api.get({ consulta: { g: 'quinta' } })).players.map((p) => p.nome), ['Ana']);
});

await ta('recusa de apelido vem sempre com código (validação JS e verificarApelido)', async () => {
  const { api } = mundo();
  assert.deepEqual(await criar(api, 'tok-dono', { ...NOVO, apelido: 'Qu Inta' }), { error: 'Use só letras minúsculas, números e hífen (sem acento, sem espaço, sem hífen nas pontas).', codigo: 'apelido_invalido' });
  const v = await api.post({ action: 'verificarApelido', apelido: 'admin' }, { ip: '1.1.1.1' });
  assert.deepEqual(v, { status: 'ok', disponivel: false, motivo: 'Esse endereço é reservado. Escolha outro.', codigo: 'apelido_reservado' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/edge-consulta.test.mjs; node tests/backend/grupos-cadastro.test.mjs; node tests/backend/grupos-api.test.mjs`
Expected: falhas no teste novo do edge (`recebido.consulta` undefined), `motivoDoApelido` não exportado, e os deepEqual novos da grupos-api.

- [ ] **Step 3: Implementar**

`backend/edge.js` — trocar:

```js
        return responder(200, await handler.post(corpo, { ip: ipParaLimitador(request.headers) }));
```

por:

```js
        // a query vai junto também no POST (grupos: ?g=<apelido> em todas as chamadas); Terça/Meme só olham o ip
        return responder(200, await handler.post(corpo, { ip: ipParaLimitador(request.headers), consulta: Object.fromEntries(new URL(request.url).searchParams) }));
```

`backend/grupos-cadastro.js` — trocar a função `validarApelido` inteira e o retorno de erro do apelido em `validarCadastroGrupo`:

```js
// mesmo texto para a mesma recusa, venha ela do JS ou do criar_grupo do SQL (a tela confia no "codigo")
export const MENSAGENS_CADASTRO = {
  apelido_invalido: 'Use só letras minúsculas, números e hífen (sem acento, sem espaço, sem hífen nas pontas).',
  apelido_reservado: 'Esse endereço é reservado. Escolha outro.',
  apelido_em_uso: 'Esse endereço já está em uso. Escolha outro.',
  limite_por_email: 'Por enquanto cada pessoa pode criar 1 grupo.'
};

export function motivoDoApelido(s) {
  const a = normalizarApelido(s);
  if (a.length < 3 || a.length > 30) return { codigo: 'apelido_invalido', mensagem: 'O endereço precisa ter de 3 a 30 caracteres.' };
  if (!FORMATO_APELIDO.test(a) || a.includes('--')) return { codigo: 'apelido_invalido', mensagem: MENSAGENS_CADASTRO.apelido_invalido };
  if (APELIDOS_RESERVADOS.includes(a)) return { codigo: 'apelido_reservado', mensagem: MENSAGENS_CADASTRO.apelido_reservado };
  return null;
}

export function validarApelido(s) {
  const m = motivoDoApelido(s);
  return m ? m.mensagem : '';
}
```

e, em `validarCadastroGrupo`, trocar:

```js
  const erroApelido = validarApelido(apelido);
  if (erroApelido) return { erro: erroApelido };
```

por:

```js
  const motivo = motivoDoApelido(apelido);
  if (motivo) return { erro: motivo.mensagem, codigo: motivo.codigo };
```

`backend/grupos-api.js`:
- trocar o import de `./grupos-cadastro.js` por `import { motivoDoApelido, validarCadastroGrupo, normalizarApelido, MENSAGENS_CADASTRO } from './grupos-cadastro.js';`
- apagar as constantes `MSG_EM_USO` e `MENSAGENS` locais e usar `MENSAGENS_CADASTRO` no lugar de `MENSAGENS` (no `catch` do `criarGrupo`);
- trocar a função `verificarApelido` por:

```js
  async function verificarApelido(b, contexto) {
    if (!(await dentroDoLimite('apelido', contexto.ip, MAX_VERIFICACOES_POR_IP_HORA))) return { error: MSG_MUITAS_CRIACOES };
    const apelido = normalizarApelido(b.apelido);
    const motivo = motivoDoApelido(apelido);
    if (motivo) return { status: 'ok', disponivel: false, motivo: motivo.mensagem, codigo: motivo.codigo };
    const livre = await cadastro.apelidoDisponivel(apelido);
    return livre
      ? { status: 'ok', disponivel: true, motivo: '', codigo: '' }
      : { status: 'ok', disponivel: false, motivo: MENSAGENS_CADASTRO.apelido_em_uso, codigo: 'apelido_em_uso' };
  }
```

- em `criarGrupo`, trocar `if (v.erro) return { error: v.erro };` por `if (v.erro) return v.codigo ? { error: v.erro, codigo: v.codigo } : { error: v.erro };`
- no `post`, trocar `const r = await resolver(b.grupo);` por `const r = await resolver(b.grupo || (contexto.consulta && contexto.consulta.g));`

- [ ] **Step 4: Rodar e ver passar; suíte**

Run: `node tests/backend/edge-consulta.test.mjs && node tests/backend/grupos-cadastro.test.mjs && node tests/backend/grupos-api.test.mjs && npm run test:backend`
Expected: tudo `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Commit**

```bash
git add backend/edge.js backend/grupos-cadastro.js backend/grupos-api.js tests/backend/edge-consulta.test.mjs tests/backend/grupos-cadastro.test.mjs tests/backend/grupos-api.test.mjs
git commit -m "feat(grupos): grupo pela query no POST e códigos de recusa padronizados"
```

---

### Task 2: Servidor local de grupos (para testar no navegador)

**Files:**
- Create: `scripts/servidor-grupos-local.mjs`
- Create: `tests/backend/servidor-grupos-local.test.mjs`
- Modify: `package.json` (script `"servidor-grupos": "node scripts/servidor-grupos-local.mjs"` e o teste no `test:backend`)

**Interfaces:**
- Consumes: `criarGruposApi`, `criarCadastroMemoria`, `criarRepoLigaMemoria`.
- Produces: `criarServidorGrupos({ arquivoHtml, arquivoSw }) -> http.Server` (exportado para o teste). Rotas: `/api` (GET com query; POST só de origem localhost/127.0.0.1), `/sw.js` e `/<qualquer>/sw.js` → o `sw.js`, qualquer outro caminho → o HTML com `GRUPOS_API_URL` trocado por `/api` e `HOSTS_MODO_GRUPO` incluindo `localhost` e `127.0.0.1`. Login de teste: `idToken` no formato `dev:<email>` (só neste servidor local).

- [ ] **Step 1: Teste (falha)**

Criar `tests/backend/servidor-grupos-local.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ta, fim } from './executor.mjs';
import { criarServidorGrupos } from '../../scripts/servidor-grupos-local.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grupos-'));
const html = path.join(dir, 'app.html');
fs.writeFileSync(html, '<script>\nconst SHEET_API_URL = "https://x/terca";\nconst GRUPOS_API_URL = "https://x/grupos-api";\nconst HOSTS_MODO_GRUPO = ["volei.memberstars.com"];\n</script>');
const sw = path.join(dir, 'sw.js');
fs.writeFileSync(sw, '// sw');

const servidor = criarServidorGrupos({ arquivoHtml: html, arquivoSw: sw });
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + servidor.address().port;
const post = (corpo, consulta = '') => fetch(base + '/api' + consulta, { method: 'POST', headers: { origin: base, 'content-type': 'text/plain' }, body: JSON.stringify(corpo) }).then((r) => r.json());

await ta('qualquer caminho serve o app com a API local e localhost no modo grupo', async () => {
  for (const caminho of ['/', '/criar', '/quinta/', '/quinta/qualquer']) {
    const t = await (await fetch(base + caminho)).text();
    assert.match(t, /const GRUPOS_API_URL = "\/api";/, caminho);
    assert.match(t, /const HOSTS_MODO_GRUPO = \["volei\.memberstars\.com", "localhost", "127\.0\.0\.1"\];/, caminho);
    assert.match(t, /const SHEET_API_URL = "https:\/\/x\/terca";/, caminho); // o do Terça não é tocado
  }
  assert.equal(await (await fetch(base + '/quinta/sw.js')).text(), '// sw');
});

await ta('criar grupo com login de teste e usar pela query ?g=', async () => {
  const r = await post({ action: 'criarGrupo', idToken: 'dev:dono@teste.com', grupoNovo: { nome: 'Vôlei de Quinta', apelido: 'quinta', cidade: 'BH', uf: 'MG', cor: '#ffd700' } });
  assert.deepEqual(r, { status: 'ok', apelido: 'quinta' });
  const login = await post({ action: 'loginGoogle', idToken: 'dev:dono@teste.com' }, '?g=quinta');
  assert.equal(login.perfil, 'admin');
  const g = await (await fetch(base + '/api?g=quinta')).json();
  assert.equal(g.grupo.nome, 'Vôlei de Quinta');
});

await ta('POST de outra origem é recusado', async () => {
  const r = await fetch(base + '/api', { method: 'POST', headers: { origin: 'https://malicioso.com' }, body: '{}' });
  assert.equal(r.status, 403);
});

servidor.close();
fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/servidor-grupos-local.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar `scripts/servidor-grupos-local.mjs`**

```js
// Servidor LOCAL dos grupos independentes, todo em memória (nada de Supabase): serve o app em qualquer caminho
// (/criar, /<apelido>/...) já em modo grupo e uma grupos-api de verdade por trás, para testar no navegador.
// Login de teste: idToken "dev:<email>" (só aqui; a função publicada usa o Google de verdade).
// Uso: npm run servidor-grupos [-- porta]   → http://localhost:8800/criar
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { criarGruposApi } from '../backend/grupos-api.js';
import { criarCadastroMemoria } from '../backend/cadastro-grupos-memoria.js';
import { criarRepoLigaMemoria } from '../backend/repo-liga-memoria.js';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RE_API = /const GRUPOS_API_URL = "[^"]*";/;
const RE_HOSTS = /const HOSTS_MODO_GRUPO = \[[^\]]*\];/;

function prepararHtml(texto) {
  if (!RE_API.test(texto) || !RE_HOSTS.test(texto)) throw new Error('HTML sem as linhas GRUPOS_API_URL / HOSTS_MODO_GRUPO: recusando (a página falaria com a produção).');
  return texto
    .replace(RE_API, 'const GRUPOS_API_URL = "/api";')
    .replace(RE_HOSTS, 'const HOSTS_MODO_GRUPO = ["volei.memberstars.com", "localhost", "127.0.0.1"];');
}

export function criarServidorGrupos({ arquivoHtml = path.join(raiz, 'volei-dashboard.html'), arquivoSw = path.join(raiz, 'sw.js') } = {}) {
  prepararHtml(fs.readFileSync(arquivoHtml, 'utf8')); // falha já na criação se o HTML não tiver as linhas
  const repoLiga = criarRepoLigaMemoria({ grupos: [{ id: 'terca', nome: 'Vôlei de Terça', cor: '#ffd700', cidade: 'Santa Luzia', uf: 'MG' }, { id: 'meme', nome: 'Vôlei Meme Brasil', cor: '#b3790a', cidade: 'Santa Luzia', uf: 'MG' }] });
  const cadastro = criarCadastroMemoria({ repoLiga });
  const verificarToken = async (t) => {
    const m = /^dev:([^@\s]+@[^@\s]+)$/.exec(String(t || ''));
    return m ? { ok: true, email: m[1].toLowerCase(), nome: m[1].split('@')[0] } : { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' };
  };
  const api = criarGruposApi({ cadastro, repoLiga, verificarToken, criarRepoDoGrupo: (id) => cadastro.repoDoGrupo(id), enviarPush: async () => {} });

  const servidor = http.createServer(async (req, res) => {
    const porta = servidor.address().port;
    const origensOk = [`http://localhost:${porta}`, `http://127.0.0.1:${porta}`];
    const url = new URL(req.url, 'http://localhost');
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
    try {
      if (url.pathname === '/api') {
        const consulta = Object.fromEntries(url.searchParams);
        if (req.method === 'GET') return json(await api.get({ consulta }));
        if (req.method === 'POST') {
          if (!origensOk.includes(req.headers.origin)) return json({ error: 'Origem não permitida.' }, 403);
          let corpo = '';
          for await (const pedaco of req) corpo += pedaco;
          return json(await api.post(JSON.parse(corpo || '{}'), { ip: '127.0.0.1', consulta }));
        }
        return json({ error: 'Método não permitido.' }, 405);
      }
      if (url.pathname === '/sw.js' || url.pathname.endsWith('/sw.js')) {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(fs.readFileSync(arquivoSw));
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(prepararHtml(fs.readFileSync(arquivoHtml, 'utf8')));
    } catch (erro) {
      json({ error: String(erro && erro.message ? erro.message : erro) }, 500);
    }
  });
  return servidor;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const porta = Number(process.argv[2]) || 8800;
  criarServidorGrupos().listen(porta, '127.0.0.1', () => console.log('Grupos (memória) em http://localhost:' + porta + '/criar — login de teste: idToken "dev:<email>"'));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/servidor-grupos-local.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: package.json e commit**

Em `package.json`, acrescentar ao objeto `scripts` a entrada `"servidor-grupos": "node scripts/servidor-grupos-local.mjs",` e ` && node tests/backend/servidor-grupos-local.test.mjs` ao `test:backend`.

```bash
git add scripts/servidor-grupos-local.mjs tests/backend/servidor-grupos-local.test.mjs package.json
git commit -m "feat(grupos): servidor local em memória para testar o modo grupo"
```

---

### Task 3: Front — bloco puro `<grupo-puro>`

**Files:**
- Modify: `volei-dashboard.html` (logo depois da linha `let sheetReady = SHEET_API_URL.startsWith("http");`)
- Create: `tests/grupo-puro.test.js`

**Interfaces:**
- Produces (globais do front): `GRUPOS_API_URL` (linha literal), `HOSTS_MODO_GRUPO` (linha literal), `NOME_PADRAO_APP`, `UFS_GRUPO`, `PALETA_GRUPO`, `contextoDoGrupo(hostname, pathname, hosts) -> null | { pagina: 'criar' | 'grupo', apelido }`, `urlDaApi(base, apiGrupos, ctx) -> string`, `chaveDoAparelho(base, ctx) -> string`, `caminhoCanonico(pathname, ctx) -> string | null` (para onde redirecionar, ou null), `iniciaisDoGrupo(nome) -> string`, `sugerirApelidoFront(nome) -> string`.

- [ ] **Step 1: Teste (falha)**

Criar `tests/grupo-puro.test.js`:

```js
// Testes do bloco puro do modo grupo. Extrai <grupo-puro> do HTML. Rodar: node tests/grupo-puro.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <grupo-puro>');
const fim = html.indexOf('// </grupo-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <grupo-puro> não encontrado');
const G = new Function(html.slice(ini, fim) + `
  return { GRUPOS_API_URL, HOSTS_MODO_GRUPO, NOME_PADRAO_APP, UFS_GRUPO, PALETA_GRUPO, contextoDoGrupo, urlDaApi,
           chaveDoAparelho, caminhoCanonico, iniciaisDoGrupo, sugerirApelidoFront };`)();
const backend = fs.readFileSync(path.join(__dirname, '..', 'backend', 'grupos-cadastro.js'), 'utf8');
const listaDoBackend = (nome) => new Function('return ' + backend.match(new RegExp('export const ' + nome + ' = (\\[[\\s\\S]*?\\]);'))[1])();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }
const HOSTS = ['volei.memberstars.com'];
const TERCA = 'https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/terca-api-teste';

t('linhas literais que os servidores locais reescrevem', () => {
  assert.match(html, /\nconst GRUPOS_API_URL = "https:\/\/lzwmirrjpoqucwlhgkku\.supabase\.co\/functions\/v1\/grupos-api";\n/);
  assert.match(html, /\nconst HOSTS_MODO_GRUPO = \["volei\.memberstars\.com"\];\n/);
});

t('Terça intacto: fora do host de grupos não há modo grupo e nada muda', () => {
  for (const host of ['memberstars.com', 'voleiterca.vercel.app', 'libertsapp.github.io', 'localhost', '127.0.0.1']) {
    const ctx = G.contextoDoGrupo(host, '/volei/', HOSTS);
    assert.equal(ctx, null, host);
    assert.equal(G.urlDaApi(TERCA, G.GRUPOS_API_URL, ctx), TERCA);
    for (const k of ['volei-auth-v1', 'volei-copia-dados-v1', 'volei-instalar-aviso-v2-fechado', 'volei-notif-pop-dispensado', 'placar-estado-terca-v1']) {
      assert.equal(G.chaveDoAparelho(k, ctx), k);
    }
    assert.equal(G.caminhoCanonico('/volei', ctx), null);
  }
  assert.equal(G.NOME_PADRAO_APP, 'Volei de Terça');
});

t('contextoDoGrupo: página de criação e grupo (apelido em minúsculas)', () => {
  assert.deepEqual(G.contextoDoGrupo('volei.memberstars.com', '/', HOSTS), { pagina: 'criar', apelido: '' });
  assert.deepEqual(G.contextoDoGrupo('volei.memberstars.com', '/criar', HOSTS), { pagina: 'criar', apelido: '' });
  assert.deepEqual(G.contextoDoGrupo('VOLEI.memberstars.com', '/Quinta/', HOSTS), { pagina: 'grupo', apelido: 'quinta' });
  assert.deepEqual(G.contextoDoGrupo('volei.memberstars.com', '/quinta/sw.js', HOSTS), { pagina: 'grupo', apelido: 'quinta' });
});

t('urlDaApi e chaveDoAparelho no modo grupo', () => {
  const ctx = { pagina: 'grupo', apelido: 'quinta' };
  assert.equal(G.urlDaApi(TERCA, G.GRUPOS_API_URL, ctx), G.GRUPOS_API_URL + '?g=quinta');
  assert.equal(G.urlDaApi(TERCA, G.GRUPOS_API_URL, { pagina: 'criar', apelido: '' }), G.GRUPOS_API_URL);
  assert.equal(G.chaveDoAparelho('volei-auth-v1', ctx), 'volei-g-quinta-auth-v1');
  assert.equal(G.chaveDoAparelho('placar-estado-terca-v1', ctx), 'placar-estado-g-quinta-terca-v1');
  assert.notEqual(G.chaveDoAparelho('volei-auth-v1', { pagina: 'grupo', apelido: 'sabado' }), G.chaveDoAparelho('volei-auth-v1', ctx));
});

t('caminhoCanonico: minúsculas e barra final (um app instalado por grupo)', () => {
  assert.equal(G.caminhoCanonico('/quinta/', { pagina: 'grupo', apelido: 'quinta' }), null);
  assert.equal(G.caminhoCanonico('/quinta', { pagina: 'grupo', apelido: 'quinta' }), '/quinta/');
  assert.equal(G.caminhoCanonico('/Quinta/', { pagina: 'grupo', apelido: 'quinta' }), '/quinta/');
  assert.equal(G.caminhoCanonico('/criar', { pagina: 'criar', apelido: '' }), null);
});

t('iniciais e sugestão de apelido', () => {
  assert.equal(G.iniciaisDoGrupo('Vôlei de Quinta'), 'VQ');
  assert.equal(G.iniciaisDoGrupo('Praia'), 'PR');
  assert.equal(G.iniciaisDoGrupo(''), '?');
  assert.equal(G.sugerirApelidoFront('Vôlei da Quinta!'), 'volei-da-quinta');
});

t('UFs e paleta iguais às do backend (grupos-cadastro.js)', () => {
  assert.deepEqual(G.UFS_GRUPO, listaDoBackend('UFS'));
  assert.deepEqual(G.PALETA_GRUPO, listaDoBackend('PALETA'));
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/grupo-puro.test.js`
Expected: `AssertionError: bloco <grupo-puro> não encontrado`.

- [ ] **Step 3: Inserir no HTML** (preservando CRLF), logo depois de `let sheetReady = SHEET_API_URL.startsWith("http");`:

```js
const GRUPOS_API_URL = "https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/grupos-api";
const HOSTS_MODO_GRUPO = ["volei.memberstars.com"];
// <grupo-puro>
/* Grupos independentes (spec 2026-10-12) — decisões PURAS do "modo grupo": aberto em volei.memberstars.com/<apelido>/
   este mesmo HTML vira o app daquele grupo. Fora desse host tudo devolve exatamente os valores do Terça (teste
   tests/grupo-puro.test.js garante). Sem DOM nem rede aqui. */
const NOME_PADRAO_APP = 'Volei de Terça';
const UFS_GRUPO = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE',
  'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const PALETA_GRUPO = ['#ffd700', '#00f3ff', '#39ff9e', '#ff4d6d', '#b388ff', '#ff9f1c', '#4dabf7', '#f06595'];
function contextoDoGrupo(hostname, pathname, hosts){
  if(hosts.indexOf(String(hostname || '').toLowerCase()) === -1) return null;
  let seg = String(pathname || '/').split('/').filter(Boolean)[0] || '';
  try{ seg = decodeURIComponent(seg); }catch(e){ /* caminho malformado: usa como veio */ }
  const apelido = seg.trim().toLowerCase();
  if(!apelido || apelido === 'criar') return { pagina: 'criar', apelido: '' };
  return { pagina: 'grupo', apelido };
}
// a grupos-api recebe o grupo pela query em TODAS as chamadas (GET e POST): o resto do app não precisa saber
function urlDaApi(base, apiGrupos, ctx){
  if(!ctx) return base;
  return ctx.pagina === 'grupo' ? apiGrupos + '?g=' + encodeURIComponent(ctx.apelido) : apiGrupos;
}
// todos os grupos dividem o localStorage de volei.memberstars.com: login, cópia de dados e avisos levam o apelido
function chaveDoAparelho(base, ctx){
  if(!ctx || ctx.pagina !== 'grupo') return base;
  return String(base).replace(/^(volei-|placar-estado-)/, '$1g-' + ctx.apelido + '-');
}
// um endereço só por grupo (/quinta/): sem isso "/Quinta" e "/quinta" virariam dois apps instalados
function caminhoCanonico(pathname, ctx){
  if(!ctx || ctx.pagina !== 'grupo') return null;
  const certo = '/' + ctx.apelido + '/';
  const atual = String(pathname || '');
  const primeiro = '/' + (atual.split('/').filter(Boolean)[0] || '') + '/';
  if(primeiro === certo && atual.startsWith(certo)) return null;
  return certo;
}
function iniciaisDoGrupo(nome){
  const PEQUENAS = ['de', 'da', 'do', 'das', 'dos', 'e'];
  const palavras = String(nome || '').trim().split(/\s+/).filter(p => p && PEQUENAS.indexOf(p.toLowerCase()) === -1);
  if(!palavras.length) return '?';
  if(palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return (palavras[0][0] + palavras[1][0]).toUpperCase();
}
function sugerirApelidoFront(nome){
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '');
}
// </grupo-puro>
```

Atenção: `iniciaisDoGrupo('Vôlei de Quinta')` pega a primeira letra com acento? "Vôlei" começa com "V", então "VQ". OK.

- [ ] **Step 4: Rodar e ver passar; validar sintaxe**

Run: `node tests/grupo-puro.test.js` e a validação de sintaxe do CLAUDE.md (no Windows: `python` e arquivo temporário fora de `/tmp`).
Expected: `TODOS OS TESTES PASSARAM`; sem erro de sintaxe.

- [ ] **Step 5: Commit**

```bash
git add volei-dashboard.html tests/grupo-puro.test.js
git commit -m "feat(terca): bloco puro do modo grupo (contexto, API, chaves, iniciais)"
```

---

### Task 4: Front — ligar o modo grupo (API, chaves, identidade, manifesto)

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:**
- Consumes: bloco puro (Task 3); GET da `grupos-api` devolve `grupo: { apelido, nome, cidade, uf, cor, logoUrl, plano }` (Fase 2).
- Produces: `CTX_GRUPO`, `URL_API`, `GRUPO_ATUAL`, `nomeDoApp()`, `aplicarIdentidade(grupo)`, `atualizarManifesto()`.

- [ ] **Step 1: Estado e URL**

Logo depois do `// </grupo-puro>`:

```js
const CTX_GRUPO = contextoDoGrupo(location.hostname, location.pathname, HOSTS_MODO_GRUPO);
// endereço canônico do grupo (minúsculas + barra final) antes de qualquer outra coisa carregar
(function(){ const certo = caminhoCanonico(location.pathname, CTX_GRUPO); if(certo) location.replace(certo + location.search); })();
const URL_API = urlDaApi(SHEET_API_URL, GRUPOS_API_URL, CTX_GRUPO);
let GRUPO_ATUAL = null; // cadastro público do grupo (vem no GET); null no Terça
function nomeDoApp(){ return GRUPO_ATUAL ? GRUPO_ATUAL.nome : NOME_PADRAO_APP; }
```

Trocar TODAS as ocorrências de `fetch(SHEET_API_URL` por `fetch(URL_API` (são 12; conferir com `grep -c "fetch(SHEET_API_URL" volei-dashboard.html` → 0 depois). `sheetReady` continua olhando `SHEET_API_URL`.

- [ ] **Step 2: Chaves do aparelho**

Trocar:
- `const CHAVE_COPIA_DADOS = 'volei-copia-dados-v1';` → `const CHAVE_COPIA_DADOS = chaveDoAparelho('volei-copia-dados-v1', CTX_GRUPO);`
- `const CHAVE_LOGIN_LOCAL = 'volei-auth-v1';` → `const CHAVE_LOGIN_LOCAL = chaveDoAparelho('volei-auth-v1', CTX_GRUPO);`
- `const CHAVE_INSTALAR_AVISO_FECHADO = 'volei-instalar-aviso-v2-fechado';` → `const CHAVE_INSTALAR_AVISO_FECHADO = chaveDoAparelho('volei-instalar-aviso-v2-fechado', CTX_GRUPO);`
- `const CHAVE_NOTIF_POP_DISPENSADO = 'volei-notif-pop-dispensado';` → `const CHAVE_NOTIF_POP_DISPENSADO = chaveDoAparelho('volei-notif-pop-dispensado', CTX_GRUPO);`
- as duas ocorrências de `'placar-estado-terca-v1'` → `chaveDoAparelho('placar-estado-terca-v1', CTX_GRUPO)`

Conferir antes que `tests/chaves-por-app.test.js` continua passando (ele compara as chaves do Terça e do Meme): se ele procurar a linha literal `const CHAVE_LOGIN_LOCAL = '...'`, ajustar o teste para aceitar `chaveDoAparelho('<chave>', CTX_GRUPO)` extraindo o primeiro argumento, e registrar a decisão.

- [ ] **Step 3: Nome do app nos textos**

Trocar:
- ``const mensagem = `🐞 *Bug/sugestão — Volei de Terça*\n\n${texto}`;`` → ``const mensagem = `🐞 *Bug/sugestão — ${nomeDoApp()}*\n\n${texto}`;``
- ``let texto = `🏐 *${titulo}* — Volei de Terça\n\n`;`` → ``let texto = `🏐 *${titulo}* — ${nomeDoApp()}\n\n`;``
- ``let texto = `🏐 *Resumo da semana* — Volei de Terça\n\n`;`` → ``let texto = `🏐 *Resumo da semana* — ${nomeDoApp()}\n\n`;``

- [ ] **Step 4: Manifesto separado do registro do Service Worker**

Em `configurarPWA`:
- trocar `function configurarPWA(){\n  const manifest = {` por `function atualizarManifesto(){\n  const manifest = {`
- trocar `    name: "Volei de Terça",` por `    name: nomeDoApp(),`
- trocar `    short_name: "Vôlei Terça",` por `    short_name: CTX_GRUPO ? nomeDoApp().slice(0, 12) : "Vôlei Terça",`
- trocar `    start_url: ".",` por `    start_url: CTX_GRUPO && CTX_GRUPO.apelido ? location.origin + '/' + CTX_GRUPO.apelido + '/' : ".",`
- trocar `    scope: ".",` por `    scope: CTX_GRUPO && CTX_GRUPO.apelido ? location.origin + '/' + CTX_GRUPO.apelido + '/' : ".",`
- logo depois da linha `  document.getElementById('pwa-manifest-link').href = URL.createObjectURL(blob);` inserir:

```js
}
// manifesto pode ser refeito (modo grupo: nome do grupo chega no GET); o Service Worker é registrado uma vez só
function configurarPWA(){
  atualizarManifesto();
```

(O resto de `configurarPWA` — o registro do `sw.js` — continua igual. Em `/quinta/`, o `sw.js` relativo vira `/quinta/sw.js`: um Service Worker e um app instalado por grupo.)

- [ ] **Step 5: Identidade do grupo**

Antes de `function aplicarDados(json){`, inserir:

```js
// modo grupo: veste o app com a identidade do grupo que veio no GET (nome, cor, iniciais, manifesto)
function aplicarIdentidade(g){
  if(!g) return;
  GRUPO_ATUAL = g;
  document.title = g.nome + ' — Dashboard do Time';
  const h1 = document.querySelector('header .brand h1');
  if(h1) h1.textContent = g.nome;
  const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if(meta) meta.setAttribute('content', g.nome);
  if(/^#[0-9a-f]{6}$/i.test(g.cor || '')) document.documentElement.style.setProperty('--ball-yellow', g.cor);
  const bola = document.querySelector('header .brand .ball');
  if(bola){ bola.textContent = iniciaisDoGrupo(g.nome); bola.classList.add('ball-iniciais'); }
  atualizarManifesto();
}
```

Em `aplicarDados(json)`, depois de `LIGA = amiNormalizar(json.liga);`, acrescentar `if(json.grupo) aplicarIdentidade(json.grupo);`.

CSS (perto de `.brand .ball{`):

```css
  /* modo grupo: a bola vira um círculo com as iniciais do grupo, na cor dele */
  .brand .ball.ball-iniciais{background:var(--ball-yellow);background-image:none;display:flex;align-items:center;justify-content:center;
    color:#101b33;font-weight:800;font-size:15px;letter-spacing:.5px;}
```

- [ ] **Step 6: Sintaxe, testes de front e roteiro no navegador**

Run: validação de sintaxe; `for f in tests/*.test.js; do node "$f" > /dev/null || echo "FALHOU: $f"; done`; `npm run test:backend`.
Expected: sem erro; nenhuma linha `FALHOU`; backend verde.

Roteiro (servidor local + Chrome headless 390px, driver descartável no scratchpad, igual ao usado nos amistosos):
1. `npm run servidor-grupos` (porta 8800). Criar o grupo `quinta` por POST (`idToken: 'dev:dono@teste.com'`) e o grupo `sabado` (`dev:outro@teste.com`).
2. Abrir `http://localhost:8800/Quinta` → a URL vira `/quinta/`; título, cabeçalho e bola mostram "Vôlei de Quinta"/"VQ" na cor do grupo; nenhum erro no console.
3. Fazer `loginGoogle` por `fetch(URL_API, POST)` com `dev:dono@teste.com`, guardar a resposta em `localStorage['volei-g-quinta-auth-v1']` (mesmo formato de `salvarSessaoAuth`) e recarregar: aparece logado como admin; cadastrar um jogador pela tela.
4. Abrir `/sabado/` no mesmo navegador: NÃO aparece logado e não aparece o jogador do quinta.
5. Abrir o Terça de sempre servido pelo `npm run servidor` (se houver `.env`) ou conferir no puro que fora do host nada muda (Task 3).

Registrar no ledger o que foi verificado de fato.

- [ ] **Step 7: Commit**

```bash
git add volei-dashboard.html tests/chaves-por-app.test.js
git commit -m "feat(terca): modo grupo ligado (API, chaves por grupo, identidade, manifesto)"
```

---

### Task 5: Front — telas de grupo inexistente/suspenso e boas-vindas

**Files:**
- Modify: `volei-dashboard.html`
- Create: `tests/grupo-telas.test.js`

**Interfaces:**
- Consumes: respostas `{ error, codigo: 'grupo_inexistente' | 'grupo_suspenso' }` (Fase 2).
- Produces: `respostaDeGrupoIndisponivel(json) -> 'grupo_inexistente' | 'grupo_suspenso' | null` (puro, dentro do `<grupo-puro>`), `mostrarTelaGrupo(tipo)`, cartão `#grupo-boas-vindas`.

- [ ] **Step 1: Teste (falha)**

Criar `tests/grupo-telas.test.js`:

```js
// Telas do modo grupo: indisponível não tenta de novo nem usa cópia velha. Rodar: node tests/grupo-telas.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const bloco = html.slice(html.indexOf('// <grupo-puro>'), html.indexOf('// </grupo-puro>'));
const { respostaDeGrupoIndisponivel } = new Function(bloco + 'return { respostaDeGrupoIndisponivel };')();

assert.equal(respostaDeGrupoIndisponivel({ error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' }), 'grupo_inexistente');
assert.equal(respostaDeGrupoIndisponivel({ error: 'Grupo indisponível.', codigo: 'grupo_suspenso' }), 'grupo_suspenso');
assert.equal(respostaDeGrupoIndisponivel({ error: 'Erro interno no servidor.' }), null);
assert.equal(respostaDeGrupoIndisponivel({ players: [] }), null);
assert.equal(respostaDeGrupoIndisponivel(null), null);

// a busca inicial devolve na hora (sem 3 tentativas) quando o grupo não existe
const ini = html.indexOf('async function buscarDadosComNovasTentativas(){');
const corpo = html.slice(ini, html.indexOf('\n}\n', ini));
assert.match(corpo, /respostaDeGrupoIndisponivel\(json\)\) return json;/);
// e o loadData mostra a tela própria em vez de cópia guardada
assert.match(html, /const indisponivel = respostaDeGrupoIndisponivel\(json\);\n\s+if\(indisponivel\)\{ mostrarTelaGrupo\(indisponivel\); return; \}/);
console.log('TODOS OS TESTES PASSARAM');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/grupo-telas.test.js`
Expected: falha (`respostaDeGrupoIndisponivel is not defined`).

- [ ] **Step 3: Implementar**

Dentro do `<grupo-puro>`, antes de `// </grupo-puro>`:

```js
function respostaDeGrupoIndisponivel(json){
  const c = json && json.codigo;
  return c === 'grupo_inexistente' || c === 'grupo_suspenso' ? c : null;
}
```

Em `buscarDadosComNovasTentativas`, logo depois de `const json = await res.json();`, acrescentar:

```js
      if(respostaDeGrupoIndisponivel(json)) return json; // grupo que não existe não melhora tentando de novo
```

Em `loadData`, logo depois de `const json = await buscarDadosComNovasTentativas();`, acrescentar:

```js
  const indisponivel = respostaDeGrupoIndisponivel(json);
  if(indisponivel){ mostrarTelaGrupo(indisponivel); return; }
```

HTML: logo antes de `<div id="app" style="display:none;">`:

```html
  <!-- modo grupo: página de criação e telas de grupo inexistente/suspenso (ver mostrarTelaGrupo / mostrarTelaCriarGrupo) -->
  <div id="tela-grupo" class="tela-grupo" style="display:none;"></div>
```

JS (depois de `aplicarIdentidade`):

```js
function mostrarTelaGrupo(tipo){
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  const tela = document.getElementById('tela-grupo');
  const texto = tipo === 'grupo_suspenso'
    ? { titulo: 'Grupo indisponível', corpo: 'Este grupo está suspenso no momento.' }
    : { titulo: 'Esse grupo não existe', corpo: 'Confira o endereço com quem te mandou o link — ou crie o app do seu grupo.' };
  tela.innerHTML = `<div class="tg-cartao"><h2>🏐 ${texto.titulo}</h2><p class="tg-sub">${texto.corpo}</p>
    <a class="btn" href="/criar">Criar o app do meu grupo</a></div>`;
  tela.style.display = 'block';
}
```

Boas-vindas (dono, grupo sem jogadores): no `#view-dashboard`, logo depois do `<div id="amistoso-marcado-alerta" ...>...</div>`:

```html
      <div id="grupo-boas-vindas" class="tg-cartao" style="display:none;">
        <h2>🎉 Seu grupo está no ar!</h2>
        <p class="tg-sub">Três passos para começar:</p>
        <ol class="tg-passos">
          <li>Cadastre os jogadores em <strong>Mais → Jogadores</strong></li>
          <li>Abra o primeiro check-in na aba <strong>Check-in</strong></li>
          <li>Mande o link deste endereço no grupo do WhatsApp e peça pra todo mundo <strong>instalar o app</strong></li>
        </ol>
      </div>
```

Em `renderAll()`, depois de `atualizarAvisosAmistosos();`, acrescentar:

```js
  const boasVindas = document.getElementById('grupo-boas-vindas');
  if(boasVindas) boasVindas.style.display = (GRUPO_ATUAL && temPermissao('addPlayer') && !DATA.players.length) ? '' : 'none';
```

CSS (perto do CSS dos amistosos):

```css
  /* ===== MODO GRUPO (criação, indisponível, boas-vindas) ===== */
  .tela-grupo{padding:12px 0;}
  .tg-cartao{background:var(--glass-bg);border:1px solid var(--glass-borda);border-radius:12px;padding:18px 16px;margin-bottom:14px;}
  .tg-cartao h2{font-size:18px;margin:0 0 6px;}
  .tg-sub{font-size:14px;color:var(--chalk-dim);margin:0 0 12px;line-height:1.5;}
  .tg-passos{margin:0;padding-left:20px;line-height:1.8;font-size:14px;}
  .tg-erro{color:var(--danger);font-size:14px;min-height:1.2em;margin:8px 0 0;}
  .tg-cores{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}
  .tg-cor{width:34px;height:34px;border-radius:50%;border:2px solid transparent;cursor:pointer;}
  .tg-cor.escolhida{border-color:var(--chalk);box-shadow:0 0 0 2px var(--court-navy);}
  .tg-prefixo{display:block;font-size:12px;color:var(--muted);margin:4px 0 2px;}
```

- [ ] **Step 4: Rodar, sintaxe, testes, navegador**

Run: `node tests/grupo-telas.test.js`, validação de sintaxe, todos os `tests/*.test.js`.
Expected: verdes. Navegador (servidor local): `/nao-existe/` mostra "Esse grupo não existe" sem atraso de tentativas; grupo novo, logado como dono e sem jogadores, mostra o cartão de boas-vindas; depois de cadastrar 1 jogador o cartão some.

- [ ] **Step 5: Commit**

```bash
git add volei-dashboard.html tests/grupo-telas.test.js
git commit -m "feat(terca): telas de grupo inexistente/suspenso e boas-vindas do dono"
```

---

### Task 6: Front — página de criação (`/` e `/criar`)

**Files:**
- Modify: `volei-dashboard.html`

**Interfaces:**
- Consumes: `verificarApelido` e `criarGrupo` da `grupos-api` (Task 1 da Fase 3: respostas com `codigo`); `UFS_GRUPO`, `PALETA_GRUPO`, `sugerirApelidoFront` (Task 3); `#tela-grupo` (Task 5); Google Identity Services (`window.onGoogleLibraryLoad`).
- Produces: `mostrarTelaCriarGrupo()`; `TOKEN_CRIAR_GRUPO` (idToken do Google, só na página de criação).

- [ ] **Step 1: Login do Google na página de criação**

No começo de `window.onGoogleLibraryLoad = function(){`, depois do teste de `GOOGLE_CLIENT_ID`, acrescentar:

```js
  // página de criação: não existe grupo para logar ainda — só pega o idToken do Google para o criarGrupo
  if(CTX_GRUPO && CTX_GRUPO.pagina === 'criar'){
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r)=> receberTokenCriarGrupo(r && r.credential), use_fedcm_for_prompt: true });
    const alvo = document.getElementById('tg-login');
    if(alvo) google.accounts.id.renderButton(alvo, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'pt-BR' });
    return;
  }
```

- [ ] **Step 2: A tela**

Depois de `mostrarTelaGrupo`:

```js
let TOKEN_CRIAR_GRUPO = '';
let APELIDO_EDITADO = false;
let TIMER_APELIDO = null;
// o e-mail só aparece pra pessoa saber com qual conta vai criar (o servidor confere o token de verdade)
function emailDoToken(token){
  try{ return JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; }catch(e){ return ''; }
}
function receberTokenCriarGrupo(token){
  if(!token) return;
  TOKEN_CRIAR_GRUPO = token;
  const el = document.getElementById('tg-logado');
  if(el){ el.textContent = '✅ Entrou como ' + (emailDoToken(token) || 'sua conta Google') + '. Você será o administrador do grupo.'; el.style.display = ''; }
  const btn = document.getElementById('tg-login');
  if(btn) btn.style.display = 'none';
}
async function postGrupos(corpo){
  const res = await fetch(URL_API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(corpo) });
  return res.json();
}
function mostrarTelaCriarGrupo(){
  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  document.title = 'Crie o app do seu grupo de vôlei';
  const tela = document.getElementById('tela-grupo');
  tela.innerHTML = `<div class="tg-cartao">
      <h2>🏐 Crie o app do seu grupo de vôlei</h2>
      <p class="tg-sub">Check-in, sorteio de times equilibrados, ranking, controle financeiro e amistosos com outros grupos. De graça.</p>
      <div id="tg-login"></div>
      <p id="tg-logado" class="tg-sub" style="display:none;"></p>
      <label class="fin-campo">Nome do grupo<input id="tg-nome" maxlength="60" placeholder="Vôlei de Quinta"></label>
      <label class="fin-campo">Endereço do app<span class="tg-prefixo">${escapeHtml(location.host)}/</span><input id="tg-apelido" maxlength="30" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="volei-de-quinta"></label>
      <p id="tg-apelido-status" class="tg-sub"></p>
      <label class="fin-campo">Cidade<input id="tg-cidade" maxlength="60" placeholder="Santa Luzia"></label>
      <label class="fin-campo">Estado<select id="tg-uf"><option value="">Escolha</option>${UFS_GRUPO.map(u => `<option value="${u}">${u}</option>`).join('')}</select></label>
      <div class="fin-campo">Cor do grupo<div class="tg-cores">${PALETA_GRUPO.map((c, i) => `<button type="button" class="tg-cor${i === 0 ? ' escolhida' : ''}" data-cor="${c}" style="background:${c}" aria-label="Cor ${i + 1}"></button>`).join('')}</div></div>
      <button type="button" class="btn" id="tg-criar">Criar meu grupo</button>
      <p id="tg-erro" class="tg-erro" role="alert"></p>
    </div>`;
  tela.style.display = 'block';
  const $ = (id)=> document.getElementById(id);
  const verificar = ()=>{
    clearTimeout(TIMER_APELIDO);
    const apelido = $('tg-apelido').value.trim();
    const status = $('tg-apelido-status');
    if(!apelido){ status.textContent = ''; return; }
    status.textContent = 'Conferindo…';
    TIMER_APELIDO = setTimeout(async ()=>{
      try{
        const r = await postGrupos({ action: 'verificarApelido', apelido });
        if($('tg-apelido').value.trim() !== apelido) return; // a pessoa já digitou outra coisa
        status.textContent = r.error ? r.error : (r.disponivel ? '✅ Endereço livre' : '❌ ' + r.motivo);
      }catch(e){ status.textContent = ''; }
    }, 400);
  };
  $('tg-nome').addEventListener('input', ()=>{
    if(!APELIDO_EDITADO){ $('tg-apelido').value = sugerirApelidoFront($('tg-nome').value); verificar(); }
  });
  $('tg-apelido').addEventListener('input', ()=>{ APELIDO_EDITADO = true; verificar(); });
  tela.querySelector('.tg-cores').addEventListener('click', (e)=>{
    const b = e.target.closest('.tg-cor');
    if(!b) return;
    tela.querySelectorAll('.tg-cor').forEach(x => x.classList.toggle('escolhida', x === b));
  });
  $('tg-criar').addEventListener('click', async ()=>{
    const erro = $('tg-erro');
    erro.textContent = '';
    if(!TOKEN_CRIAR_GRUPO){ erro.textContent = 'Entre com sua conta Google primeiro (botão acima).'; return; }
    const cor = (tela.querySelector('.tg-cor.escolhida') || {}).dataset;
    const grupoNovo = { nome: $('tg-nome').value, apelido: $('tg-apelido').value.trim(), cidade: $('tg-cidade').value, uf: $('tg-uf').value, cor: cor ? cor.cor : PALETA_GRUPO[0] };
    $('tg-criar').disabled = true;
    try{
      const r = await postGrupos({ action: 'criarGrupo', idToken: TOKEN_CRIAR_GRUPO, grupoNovo });
      if(r && r.status === 'ok'){ location.href = '/' + r.apelido + '/'; return; }
      erro.textContent = (r && r.error) || 'Não foi possível criar o grupo. Tente de novo.';
    }catch(e){
      erro.textContent = 'Sem conexão. Tente de novo.';
    }finally{
      $('tg-criar').disabled = false;
    }
  });
}
```

- [ ] **Step 3: Arranque**

No fim do script, trocar:

```js
restaurarSessaoAuth();   // se a aba já estava logada, volta o chip antes do primeiro render
loadData();
sincronizarContaComServidor(); // reconfere o vínculo (ver comentário na função) — silencioso, sem popup
tentarRenovarSeNecessario(); // cobre a abertura a frio (visibilitychange/focus não disparam no 1º load)
atualizarAvisoUsuariosPendentes();
```

por:

```js
if(CTX_GRUPO && CTX_GRUPO.pagina === 'criar'){
  mostrarTelaCriarGrupo(); // volei.memberstars.com/ ou /criar: não há grupo para carregar
} else {
  restaurarSessaoAuth();   // se a aba já estava logada, volta o chip antes do primeiro render
  loadData();
  sincronizarContaComServidor(); // reconfere o vínculo (ver comentário na função) — silencioso, sem popup
  tentarRenovarSeNecessario(); // cobre a abertura a frio (visibilitychange/focus não disparam no 1º load)
  atualizarAvisoUsuariosPendentes();
}
```

- [ ] **Step 4: Sintaxe, testes, navegador**

Run: validação de sintaxe; todos os `tests/*.test.js`; `npm run test:backend`.
Expected: verdes.

Roteiro (servidor local + Chrome headless 390px):
1. `/criar`: a tela aparece; digitar o nome "Vôlei de Quinta" preenche `volei-de-quinta` e mostra "✅ Endereço livre"; trocar para `admin` mostra "❌ Esse endereço é reservado…".
2. Clicar "Criar meu grupo" sem token → "Entre com sua conta Google primeiro".
3. Definir `TOKEN_CRIAR_GRUPO = 'dev:dono@teste.com'` (via `receberTokenCriarGrupo`), preencher cidade/UF e criar → navega para `/volei-de-quinta/` e o app abre com o nome do grupo.
4. Criar de novo com o mesmo endereço (outro e-mail) → "Esse endereço já está em uso…"; com o mesmo e-mail e outro endereço → "Por enquanto cada pessoa pode criar 1 grupo."
5. Screenshot da página de criação e do app do grupo.

- [ ] **Step 5: Commit**

```bash
git add volei-dashboard.html
git commit -m "feat(terca): página de criação de grupo (um clique)"
```

---

### Task 7: Versão 18.0, documentação e fechamento

**Files:**
- Modify: `volei-dashboard.html` (`Ver.: 17.1` → `Ver.: 18.0`)
- Modify: `CLAUDE.md` (seção curta "Grupos independentes")

- [ ] **Step 1: Versão e CLAUDE.md**

Trocar `Ver.: 17.1 ·` por `Ver.: 18.0 ·`. Em `CLAUDE.md`, depois da seção de amistosos:

```markdown
## Grupos independentes (v18.0 no Terça, 2026-10-12)

Spec: `docs/superpowers/specs/2026-10-12-grupos-independentes-design.md`. Qualquer pessoa cria o app do grupo em
`volei.memberstars.com/criar`; cada grupo vive em `volei.memberstars.com/<apelido>/`. Dados de todos os grupos no schema
`grupos` (coluna `grupo_id`; `backend/cliente-do-grupo.js` aplica o grupo em toda operação), servidos pela função
`grupos-api` (`backend/grupos-api.js`). O MESMO `volei-dashboard.html` entra em "modo grupo" só no host de
`HOSTS_MODO_GRUPO`; fora dele tudo é o Terça de sempre (teste `tests/grupo-puro.test.js`). Teste local:
`npm run servidor-grupos` (memória, login `dev:<email>`). Publicação: `docs/superpowers/grupos-deploy.md`.
```

- [ ] **Step 2: Suíte completa**

Run: validação de sintaxe; `for f in tests/*.test.js; do node "$f" > /dev/null || echo "FALHOU: $f"; done`; `npm run test:backend`; PGlite se houver.
Expected: tudo verde.

- [ ] **Step 3: Conferir o Meme e as funções do Terça/Meme intactos**

Run: `git diff --stat <base-da-fase>..HEAD -- supabase/functions/terca-api-teste supabase/functions/meme-api sql/meme 'sql/schema-terca-supabase*.sql'` e conferir que o repositório `voleimeme` não foi tocado.
Expected: nenhuma mudança.

- [ ] **Step 4: Commit e relatório**

```bash
git add volei-dashboard.html CLAUDE.md
git commit -m "Terça v18.0: grupos independentes (modo grupo e criação em um clique)"
```

Relatório ao usuário: o que foi verificado no navegador (com screenshots), que nada foi publicado, e os próximos passos — Fase 4 (Vercel + CNAME `volei` no GoDaddy + origem no Google + publicação da `grupos-api` e do SQL) e, separadamente, a pergunta de sempre sobre replicar no Meme (não se aplica ao modo grupo, que é só deste HTML).
