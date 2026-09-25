# Terça no Supabase — Etapa 2: Login e perfis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. A Task 6 termina com um login real feito pelo usuário no navegador.

**Goal:** Entrar com o Google em `http://localhost:8000` e o app reconhecer a conta com o perfil real, com o porteiro de permissões e o gerenciamento de usuários e vínculos respondendo exatamente como o Apps Script atual.

**Architecture:** Continua o módulo `backend/` (JavaScript puro, sem APIs do Node). Novos arquivos: `auth.js` (verificação do token do Google e comparação de segredo), `permissoes.js` (matriz), `porteiro.js` (autorização), `usuarios.js` (regras de login, perfis e vínculos). O repositório ganha primitivas de gravação de usuários (memória e Supabase). O `handler.post` passa a rotear essas ações. O servidor local é dividido em `servidor.js` (HTTP, testável, com `Host`/`Origin`/limite de corpo) e `servidor-local.js` (lê o `.env` e sobe). A igualdade com o `.gs` é provada por um teste diferencial que roda a mesma sequência de pedidos no `.gs` real e no backend novo.

**Tech Stack:** Node.js 24 (ESM, `node:assert`, `node:http`), sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-23-terca-supabase-etapa-2-login-design.md` (e o spec geral `2026-09-23-terca-supabase-backend-design.md`).

## Global Constraints

- Mesmas regras, respostas e **mensagens de erro** do `apps-script-codigo.gs` (funções `loginGoogle`, `bootstrapAdmin`, `autorizar_`, `verificarTokenGoogle_`, `listarUsuarios`, `salvarUsuario`, `removerUsuario`, `solicitarVinculo`, `aprovarVinculo`, `rejeitarVinculo`, `acharJogadorPorNome_`). O `.gs` é a fonte da verdade: nunca editá-lo.
- `backend/` é JavaScript puro: nada de `node:*`, `process`, `fs`, `Buffer` e nenhum import de `@supabase/supabase-js`. Só `servidor.js` e `servidor-local.js` usam Node.
- Nenhum segredo no código nem nos testes: a senha mestra e o Client ID são lidos do ambiente (`.env`) ou do `.gs` carregado pelo teste (`amb.rodar('ADMIN_PASSWORD')`, `amb.rodar('GOOGLE_CLIENT_ID')`). Nunca escrever o valor da senha em arquivo, log ou mensagem de commit.
- E-mail sempre normalizado (`trim` + minúsculas) ao ler e ao gravar. `jogador_id`/`jogador_id_pendente` vazios são gravados como `null` (chave estrangeira) e lidos como `''`.
- Usuário novo: `ordem = máximo + 1`, `criado_em = relogio().toISOString()`. Atualizar nunca altera `criado_em` nem `ordem`. `listarUsuarios` devolve `criadoEm` como data `yyyy-MM-dd` no fuso `America/Sao_Paulo`.
- `players` para validar vínculo = jogadores com `convidado = false` (`mapearJogadores`).
- Nesta etapa, ações ainda não portadas respondem `Esta ação ainda não está disponível na versão Supabase (<ação>).` depois de passar pelo porteiro; `addCheckin`/`removeCheckin` só validam o token antes.
- Testes automáticos nunca falam com o Google nem com o Supabase real (o `fetch` e o repositório são injetados). Só o passo manual da Task 6 usa a rede.
- Nomes de função e variável em português. Comandos rodam dentro de `C:\Users\Heleno\OneDrive\Documentos\GitHub\voleis_VS\.worktrees\terca-supabase-migracao`.

---

### Task 1: Verificação do token do Google, comparação segura e matriz de permissões

**Files:**
- Create: `backend/auth.js`
- Create: `backend/permissoes.js`
- Test: `tests/backend/auth.test.mjs`
- Test: `tests/backend/permissoes.test.mjs`

**Interfaces:**
- Produz `iguaisSeguros(a, b)` e `criarVerificadorGoogle({ clientId, buscar?, agora? })` em `backend/auth.js`. O verificador é uma função assíncrona `verificarToken(idToken)` que devolve `{ ok: true, email, nome, foto }` ou `{ ok: false, erro }`. `buscar` é uma função `fetch`-like (padrão: `fetch` global) e `agora` devolve milissegundos (padrão `Date.now`).
- Produz `PERMISSOES` em `backend/permissoes.js`: objeto `{ acao: [perfis permitidos] }` com **todas** as ações (as de `PERMISSOES` e as de `PERMISSOES_FIN_` do `.gs`).

- [ ] **Step 1: Escrever os testes do verificador (devem falhar: o módulo não existe)**

Criar `tests/backend/auth.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarVerificadorGoogle, iguaisSeguros } from '../../backend/auth.js';

const CLIENTE = 'cliente-de-teste.apps.googleusercontent.com';
const AGORA = 1_800_000_000_000; // ms fixos
const futuro = String(Math.floor(AGORA / 1000) + 3600);
const passado = String(Math.floor(AGORA / 1000) - 3600);

// resposta do tokeninfo com o que o teste quiser mudar
const info = (extra = {}) => ({ aud: CLIENTE, email: 'Ana@Exemplo.com ', email_verified: 'true', exp: futuro, name: 'Ana Silva', picture: 'https://x/y.jpg', ...extra });
const resposta = (status, corpo) => ({ status, json: async () => { if (corpo instanceof Error) throw corpo; return corpo; } });
const verificador = (buscar) => criarVerificadorGoogle({ clientId: CLIENTE, buscar, agora: () => AGORA });

await ta('sem token: mensagem pedindo para entrar', async () => {
  const v = verificador(async () => { throw new Error('não devia chamar'); });
  assert.deepEqual(await v(''), { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' });
  assert.deepEqual(await v(undefined), { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' });
});

await ta('token válido: e-mail normalizado, nome e foto; a URL leva o token codificado', async () => {
  let urlChamada = '';
  const v = verificador(async (url) => { urlChamada = url; return resposta(200, info()); });
  assert.deepEqual(await v('abc+def/ghi'), { ok: true, email: 'ana@exemplo.com', nome: 'Ana Silva', foto: 'https://x/y.jpg' });
  assert.equal(urlChamada, 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent('abc+def/ghi'));
});

await ta('falha de rede: mensagem de "não foi possível falar com o Google"', async () => {
  const v = verificador(async () => { throw new Error('rede'); });
  assert.deepEqual(await v('t'), { ok: false, erro: 'Não foi possível falar com o Google pra conferir seu login. Tente de novo.' });
});

await ta('Google recusa (status diferente de 200): inválido ou expirado', async () => {
  const v = verificador(async () => resposta(400, {}));
  assert.deepEqual(await v('t'), { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' });
});

await ta('resposta que não é JSON: resposta inesperada', async () => {
  const v = verificador(async () => resposta(200, new Error('json ruim')));
  assert.deepEqual(await v('t'), { ok: false, erro: 'Resposta inesperada do Google ao conferir o login.' });
});

await ta('token emitido para outro aplicativo (aud diferente)', async () => {
  const v = verificador(async () => resposta(200, info({ aud: 'outro-app' })));
  assert.deepEqual(await v('t'), { ok: false, erro: 'Login do Google emitido para outro aplicativo.' });
});

await ta('e-mail não verificado', async () => {
  const v = verificador(async () => resposta(200, info({ email_verified: 'false' })));
  assert.deepEqual(await v('t'), { ok: false, erro: 'O e-mail dessa conta Google não está verificado.' });
});

await ta('token expirado ou sem exp', async () => {
  assert.deepEqual(await verificador(async () => resposta(200, info({ exp: passado })))('t'), { ok: false, erro: 'Login do Google expirou. Entre de novo.' });
  assert.deepEqual(await verificador(async () => resposta(200, info({ exp: undefined })))('t'), { ok: false, erro: 'Login do Google expirou. Entre de novo.' });
});

await ta('sem e-mail no token', async () => {
  const v = verificador(async () => resposta(200, info({ email: undefined })));
  assert.deepEqual(await v('t'), { ok: false, erro: 'Login do Google não trouxe e-mail. Entre de novo.' });
});

await ta('iguaisSeguros: igual, diferente, tamanhos diferentes e vazio', async () => {
  assert.equal(iguaisSeguros('abc', 'abc'), true);
  assert.equal(iguaisSeguros('abc', 'abd'), false);
  assert.equal(iguaisSeguros('abc', 'abcd'), false);
  assert.equal(iguaisSeguros('', 'x'), false);
  assert.equal(iguaisSeguros(undefined, 'x'), false);
});

fim();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tests/backend/auth.test.mjs`
Expected: erro `Cannot find module` apontando para `backend/auth.js`.

- [ ] **Step 3: Implementar `backend/auth.js`**

```javascript
// Verificação do login do Google e comparação de segredo. Só usa o `fetch` global (Node e Deno).
// Fonte: verificarTokenGoogle_ de apps-script-codigo.gs — mesmas checagens, na mesma ordem, mesmas mensagens.

// compara sem parar no primeiro caractere diferente (não vaza, pelo tempo, quantos caracteres batem)
export function iguaisSeguros(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  let diferenca = x.length ^ y.length;
  const tamanho = Math.max(x.length, y.length);
  for (let i = 0; i < tamanho; i++) diferenca |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diferenca === 0;
}

export function criarVerificadorGoogle({ clientId, buscar = (...args) => fetch(...args), agora = () => Date.now() }) {
  return async function verificarToken(idToken) {
    if (!idToken) return { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' };

    let resposta;
    try {
      resposta = await buscar('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
    } catch (e) {
      return { ok: false, erro: 'Não foi possível falar com o Google pra conferir seu login. Tente de novo.' };
    }
    if (resposta.status !== 200) return { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' };

    let info;
    try {
      info = await resposta.json();
    } catch (e) {
      return { ok: false, erro: 'Resposta inesperada do Google ao conferir o login.' };
    }

    // "aud" = pra qual aplicativo o token foi emitido; sem essa conferência, um token de QUALQUER outro site valeria aqui
    if (String(info.aud) !== String(clientId)) return { ok: false, erro: 'Login do Google emitido para outro aplicativo.' };
    if (String(info.email_verified) !== 'true') return { ok: false, erro: 'O e-mail dessa conta Google não está verificado.' };
    if (!info.exp || Number(info.exp) * 1000 < agora()) return { ok: false, erro: 'Login do Google expirou. Entre de novo.' };
    if (!info.email) return { ok: false, erro: 'Login do Google não trouxe e-mail. Entre de novo.' };

    return { ok: true, email: String(info.email).trim().toLowerCase(), nome: String(info.name || ''), foto: String(info.picture || '') };
  };
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `node tests/backend/auth.test.mjs`
Expected: 10 linhas `ok` e `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Escrever o teste da matriz (deve falhar)**

Criar `tests/backend/permissoes.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { t, fim } from './executor.mjs';
import { PERMISSOES } from '../../backend/permissoes.js';

t('matriz: regras principais (vale mesmo sem o .gs)', () => {
  assert.deepEqual(PERMISSOES.salvarUsuario, ['admin']);
  assert.deepEqual(PERMISSOES.removerUsuario, ['admin']);
  assert.deepEqual(PERMISSOES.listarUsuarios, ['organizador', 'admin']);
  assert.deepEqual(PERMISSOES.solicitarVinculo, ['jogador', 'organizador', 'admin']);
  assert.deepEqual(PERMISSOES.estornarLancamento, ['admin']);
  assert.deepEqual(PERMISSOES.marcarPagamento, ['organizador', 'admin']);
  assert.equal(PERMISSOES.acaoInexistente, undefined);
  assert.equal(Object.hasOwn(PERMISSOES, 'constructor'), false);
});

// a matriz do backend novo tem que ser IDÊNTICA à do .gs real (PERMISSOES + PERMISSOES_FIN_)
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');
if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - paridade da matriz: apps-script-codigo.gs não existe nesta pasta.');
} else {
  const require = createRequire(import.meta.url);
  const { criarAmbiente } = require('../helpers/planilha-falsa.js');
  t('matriz: idêntica à do .gs real (ações e perfis)', () => {
    const amb = criarAmbiente({}, [caminhoGs]);
    const doGs = JSON.parse(amb.rodar('JSON.stringify(Object.assign({}, PERMISSOES, PERMISSOES_FIN_))'));
    assert.deepEqual(PERMISSOES, doGs);
  });
}

fim();
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `node tests/backend/permissoes.test.mjs`
Expected: erro `Cannot find module` apontando para `backend/permissoes.js`.

- [ ] **Step 7: Implementar `backend/permissoes.js`**

```javascript
// MATRIZ DE PERMISSÕES — qual perfil pode fazer qual ação (cópia fiel de PERMISSOES + PERMISSOES_FIN_ do .gs).
// Lista branca: ação que não estiver aqui é recusada. Quem não logou é tratado como 'jogador'.
// 'updatePlayer' não lista 'jogador' de propósito: a exceção "jogador troca a PRÓPRIA foto" chega na etapa 3.
export const PERMISSOES = {
  ping:             ['jogador', 'organizador', 'admin'],
  uploadPhoto:      ['jogador', 'organizador', 'admin'],
  addPlayer:        ['organizador', 'admin'],
  updatePlayer:     ['organizador', 'admin'],
  addRound:         ['organizador', 'admin'],
  updateRound:      ['organizador', 'admin'],
  removePlayer:     ['admin'],
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

- [ ] **Step 8: Rodar — deve passar (com o .gs presente, 2 testes)**

Run: `node tests/backend/permissoes.test.mjs`
Expected: `ok` nos 2 testes e `TODOS OS TESTES PASSARAM`. Se a paridade acusar diferença, corrigir `permissoes.js` para ficar igual ao `.gs` (nunca o contrário).

- [ ] **Step 9: Commit**

```bash
git add backend/auth.js backend/permissoes.js tests/backend/auth.test.mjs tests/backend/permissoes.test.mjs
git commit -m "feat: verificador do token do Google e matriz de permissões (etapa 2)"
```

---

### Task 2: Primitivas de usuários nos repositórios

**Files:**
- Modify: `backend/repo-memoria.js`
- Modify: `backend/repo-supabase.js`
- Test: `tests/backend/repo.test.mjs`

**Interfaces:**
- Consome: `TABELAS` e `criarRepoMemoria` (etapa 1), `lerTabela` (interno de `repo-supabase.js`).
- Produz, nos DOIS repositórios, quatro métodos assíncronos: `lerUsuarios()` → linhas de `usuarios` no formato do banco (`{ email, nome, perfil, jogador_id, criado_em, jogador_id_pendente, ordem }`); `lerJogadores()` → linhas de `jogadores`; `gravarUsuario(linha)` → insere ou atualiza pela chave `email` (linha completa, já com `criado_em`/`ordem` quando é novo); `removerUsuario(email)` → apaga a linha (não falha se não existir).

- [ ] **Step 1: Escrever o teste do repositório em memória (deve falhar)**

Criar `tests/backend/repo.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';

const repo = () => criarRepoMemoria(fixture);

await ta('lerUsuarios/lerJogadores: devolvem cópias independentes', async () => {
  const r = repo();
  const us = await r.lerUsuarios();
  assert.equal(us.length, 3);
  us[0].nome = 'MUDOU';
  assert.notEqual((await r.lerUsuarios())[0].nome, 'MUDOU');
  assert.equal((await r.lerJogadores()).length, 3);
});

await ta('gravarUsuario: linha nova entra no fim; existente é atualizada pela chave email', async () => {
  const r = repo();
  await r.gravarUsuario({ email: 'n@exemplo.com', nome: 'N', perfil: 'jogador', jogador_id: null, criado_em: '2026-09-23T15:00:00.000Z', jogador_id_pendente: null, ordem: 4 });
  let us = await r.lerUsuarios();
  assert.equal(us.length, 4);
  assert.equal(us[3].email, 'n@exemplo.com');
  await r.gravarUsuario({ email: 'n@exemplo.com', nome: 'N2', perfil: 'organizador' });
  us = await r.lerUsuarios();
  assert.equal(us.length, 4);
  assert.equal(us[3].nome, 'N2');
  assert.equal(us[3].perfil, 'organizador');
  assert.equal(us[3].ordem, 4); // campos que a atualização não trouxe ficam como estavam
});

await ta('removerUsuario: apaga; e não falha se o e-mail não existe', async () => {
  const r = repo();
  await r.removerUsuario('c@exemplo.com');
  assert.deepEqual((await r.lerUsuarios()).map((u) => u.email).sort(), ['a@exemplo.com', 'b@exemplo.com']);
  await r.removerUsuario('nao-existe@exemplo.com');
  assert.equal((await r.lerUsuarios()).length, 2);
});

await ta('lerTudo enxerga as gravações feitas pelas primitivas', async () => {
  const r = repo();
  await r.removerUsuario('c@exemplo.com');
  assert.equal((await r.lerTudo()).usuarios.length, 2);
});

fim();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tests/backend/repo.test.mjs`
Expected: falha `r.lerUsuarios is not a function`.

- [ ] **Step 3: Implementar em `backend/repo-memoria.js`**

Trocar o retorno de `criarRepoMemoria` para incluir os quatro métodos (mantendo `tabelas` e `lerTudo`). O objeto retornado fica:

```javascript
  return {
    tabelas,
    async lerTudo() { return structuredClone(tabelas); },
    async lerUsuarios() { return structuredClone(tabelas.usuarios); },
    async lerJogadores() { return structuredClone(tabelas.jogadores); },
    // insere ou atualiza pela chave email; numa atualização, só os campos enviados mudam
    async gravarUsuario(linha) {
      const i = tabelas.usuarios.findIndex((u) => u.email === linha.email);
      if (i === -1) tabelas.usuarios.push({ ...linha });
      else tabelas.usuarios[i] = { ...tabelas.usuarios[i], ...linha };
    },
    async removerUsuario(email) { tabelas.usuarios = tabelas.usuarios.filter((u) => u.email !== email); }
  };
```

- [ ] **Step 4: Rodar — deve passar**

Run: `node tests/backend/repo.test.mjs && node tests/backend/handler.test.mjs`
Expected: `TODOS OS TESTES PASSARAM` nos dois.

- [ ] **Step 5: Implementar em `backend/repo-supabase.js`**

No objeto retornado por `criarRepoSupabase`, junto de `lerTudo`, acrescentar:

```javascript
    async lerUsuarios() { return lerTabela(cliente, 'usuarios'); },
    async lerJogadores() { return lerTabela(cliente, 'jogadores'); },
    // upsert pela chave email (a linha já vem completa do domínio: com criado_em/ordem quando é novo)
    async gravarUsuario(linha) {
      const { error } = await cliente.from('usuarios').upsert(linha);
      if (error) throw new Error('usuarios: ' + error.message);
    },
    async removerUsuario(email) {
      const { error } = await cliente.from('usuarios').delete().eq('email', email);
      if (error) throw new Error('usuarios: ' + error.message);
    }
```

- [ ] **Step 5b: Validar sintaxe e pureza**

Run: `node --check backend/repo-supabase.js && node --check backend/repo-memoria.js && grep -nE "node:|process\.|require\(|supabase-js" backend/repo-supabase.js backend/repo-memoria.js`
Expected: `node --check` sem erro e o `grep` sem nenhuma linha.

- [ ] **Step 6: Commit**

```bash
git add backend/repo-memoria.js backend/repo-supabase.js tests/backend/repo.test.mjs
git commit -m "feat: primitivas de leitura e gravação de usuários nos repositórios (etapa 2)"
```

---

### Task 3: Regras de login, perfis e vínculos (`usuarios.js`)

**Files:**
- Modify: `backend/mapeadores.js` (só exportar `texto` e `porOrdem`)
- Create: `backend/usuarios.js`
- Test: `tests/backend/usuarios.test.mjs`

**Interfaces:**
- Consome: repositório da Task 2, `mapearJogadores` (etapa 1), `iguaisSeguros` (Task 1).
- Produz em `backend/usuarios.js` (todas assíncronas; `deps = { repo, relogio, config: { adminPassword }, verificarToken }`):
  `lerUsuarios(repo)` → lista `{ email, nome, perfil, jogadorId, criadoEm, jogadorIdPendente }` na ordem da planilha; `loginGoogle(deps, body)`; `bootstrapAdmin(deps, body)`; `listarUsuarios(deps, perfilDeQuemPediu)`; `salvarUsuario(deps, u)`; `removerUsuario(deps, email)`; `solicitarVinculo(deps, auth, jogadorId)`; `aprovarVinculo(deps, email, jogadorIdEscolhido)`; `rejeitarVinculo(deps, email)`; `acharJogadorPorNome(jogadores, nomeConta)` (puro); `normalizarEmail(v)`.

- [ ] **Step 1: Exportar dois utilitários de `backend/mapeadores.js`**

Trocar exatamente estas duas linhas (nada mais muda no arquivo):
- `const texto = (v) => ...` → `export const texto = (v) => ...`
- `const porOrdem = (a, b) => {` → `export const porOrdem = (a, b) => {`

Run: `node tests/backend/mapeadores.test.mjs` → deve continuar `TODOS OS TESTES PASSARAM`.

- [ ] **Step 2: Escrever os testes (devem falhar: o módulo não existe)**

Criar `tests/backend/usuarios.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import {
  loginGoogle, bootstrapAdmin, listarUsuarios, salvarUsuario, removerUsuario,
  solicitarVinculo, aprovarVinculo, rejeitarVinculo, acharJogadorPorNome
} from '../../backend/usuarios.js';

const AGORA = new Date('2026-09-23T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' },
  'tok-n': { ok: true, email: 'n@exemplo.com', nome: 'Carla Souza' }
};

// fixture + um jogador (p3) sem vínculo, para os pedidos de vínculo
function novo() {
  const dados = structuredClone(fixture);
  dados.jogadores.push({ id: 'p3', nome: 'Carla Souza', apelido: null, foto: null, estrelas: 3, sexo: 'F', porte: 'M', convidado: false, ordem: 3 });
  const repo = criarRepoMemoria(dados);
  return { repo, relogio: () => AGORA, config: { adminPassword: 'chave-de-teste' }, verificarToken: async (t) => TOKENS[t] || { ok: false, erro: 'inválido' } };
}
const usuariosNoBanco = (deps) => deps.repo.lerUsuarios();

await ta('login de conta existente: devolve perfil e vínculo, sem sugestão', async () => {
  const deps = novo();
  assert.deepEqual(await loginGoogle(deps, { idToken: 'tok-a' }), {
    status: 'ok', email: 'a@exemplo.com', nome: 'A', perfil: 'admin', jogadorId: 'p1', jogadorIdPendente: '',
    sugestao: null, primeiroLogin: false, totalUsuarios: 3
  });
});

await ta('login de conta nova: cria como jogador no fim da lista, com sugestão por nome', async () => {
  const deps = novo();
  const r = await loginGoogle(deps, { idToken: 'tok-n' });
  assert.deepEqual(r, {
    status: 'ok', email: 'n@exemplo.com', nome: 'Carla Souza', perfil: 'jogador', jogadorId: '', jogadorIdPendente: '',
    sugestao: { id: 'p3', nome: 'Carla Souza', motivo: 'exato' }, primeiroLogin: true, totalUsuarios: 4
  });
  const us = await usuariosNoBanco(deps);
  assert.deepEqual(us[3], { email: 'n@exemplo.com', nome: 'Carla Souza', perfil: 'jogador', jogador_id: null, criado_em: '2026-09-23T15:00:00.000Z', jogador_id_pendente: null, ordem: 4 });
});

await ta('login com token inválido devolve o erro do verificador', async () => {
  assert.deepEqual(await loginGoogle(novo(), { idToken: 'x' }), { error: 'inválido' });
});

await ta('login: nome mudou na conta Google, planilha atualiza sem mexer em ordem nem criado_em', async () => {
  const deps = novo();
  TOKENS['tok-b2'] = { ok: true, email: 'b@exemplo.com', nome: 'Bruno Novo' };
  const r = await loginGoogle(deps, { idToken: 'tok-b2' });
  assert.equal(r.nome, 'Bruno Novo');
  const b = (await usuariosNoBanco(deps)).find((u) => u.email === 'b@exemplo.com');
  assert.equal(b.nome, 'Bruno Novo');
  assert.equal(b.ordem, 2);
  assert.equal(b.criado_em, '2026-09-02T10:00:00+00:00');
  assert.equal(b.perfil, 'organizador');
});

await ta('bootstrapAdmin: chave errada, chave certa promove e preserva o vínculo', async () => {
  const deps = novo();
  assert.deepEqual(await bootstrapAdmin(deps, { senha: 'errada', idToken: 'tok-c' }), { error: 'Chave mestra incorreta.' });
  assert.deepEqual(await bootstrapAdmin(deps, { senha: 'chave-de-teste', idToken: 'x' }), { error: 'inválido' });
  assert.deepEqual(await bootstrapAdmin(deps, { senha: 'chave-de-teste', idToken: 'tok-c' }), { status: 'ok', email: 'c@exemplo.com', nome: 'C', perfil: 'admin', jogadorId: '' });
  assert.equal((await usuariosNoBanco(deps)).find((u) => u.email === 'c@exemplo.com').perfil, 'admin');
});

await ta('bootstrapAdmin: sem chave mestra configurada, a chave fica desativada', async () => {
  const deps = novo();
  deps.config = {};
  assert.deepEqual(await bootstrapAdmin(deps, { senha: '', idToken: 'tok-c' }), { error: 'Chave mestra incorreta.' });
});

await ta('listarUsuarios: admin vê o cargo; organizador recebe a lista SEM perfil; criadoEm só a data', async () => {
  const deps = novo();
  const adm = await listarUsuarios(deps, 'admin');
  assert.deepEqual(adm.usuarios[0], { email: 'a@exemplo.com', nome: 'A', perfil: 'admin', jogadorId: 'p1', criadoEm: '2026-09-01', jogadorIdPendente: '' });
  const org = await listarUsuarios(deps, 'organizador');
  assert.deepEqual(org.usuarios.map((u) => u.email), ['a@exemplo.com', 'b@exemplo.com', 'c@exemplo.com']);
  assert.equal(org.usuarios.some((u) => 'perfil' in u), false);
});

await ta('salvarUsuario: validações e mensagens', async () => {
  const deps = novo();
  assert.deepEqual(await salvarUsuario(deps, null), { error: 'E-mail do usuário é obrigatório.' });
  assert.deepEqual(await salvarUsuario(deps, { email: 'c@exemplo.com', perfil: 'xpto' }), { error: 'Perfil inválido: xpto' });
  assert.deepEqual(await salvarUsuario(deps, { email: 'a@exemplo.com', perfil: 'jogador' }), { error: 'Não é possível rebaixar o último administrador. Promova outro admin primeiro.' });
  assert.deepEqual(await salvarUsuario(deps, { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'nao-existe' }), { error: 'O jogador escolhido não existe mais na aba Jogadores.' });
  assert.deepEqual(await salvarUsuario(deps, { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'p1' }), { error: 'Esse jogador já está vinculado ao e-mail a@exemplo.com.' });
});

await ta('salvarUsuario: promove, vincula e limpa o pedido pendente; e-mail é normalizado', async () => {
  const deps = novo();
  assert.deepEqual(await salvarUsuario(deps, { email: ' C@Exemplo.com ', perfil: 'Organizador', jogadorId: 'p3', nome: 'C' }), { status: 'ok' });
  const c = (await usuariosNoBanco(deps)).find((u) => u.email === 'c@exemplo.com');
  assert.equal(c.perfil, 'organizador');
  assert.equal(c.jogador_id, 'p3');
  assert.equal(c.jogador_id_pendente, null);
  assert.equal((await usuariosNoBanco(deps)).length, 3);
});

await ta('removerUsuario: inexistente, último admin e sucesso', async () => {
  const deps = novo();
  assert.deepEqual(await removerUsuario(deps, 'x@exemplo.com'), { error: 'Usuário não encontrado (pode já ter sido removido).' });
  assert.deepEqual(await removerUsuario(deps, 'a@exemplo.com'), { error: 'Não é possível remover o último administrador. Promova outro admin primeiro.' });
  assert.deepEqual(await removerUsuario(deps, 'C@Exemplo.com'), { status: 'ok' });
  assert.equal((await usuariosNoBanco(deps)).length, 2);
});

await ta('vínculos: pedido, conflito, aprovação, sem pendente e chave mestra', async () => {
  const deps = novo();
  const authC = { email: 'c@exemplo.com', nome: 'C', perfil: 'jogador' };
  const authB = { email: 'b@exemplo.com', nome: 'B', perfil: 'organizador' };
  assert.deepEqual(await solicitarVinculo(deps, { email: '' }, 'p3'), { error: 'Essa ação precisa de login com conta Google (a chave mestra não identifica uma pessoa).' });
  assert.deepEqual(await solicitarVinculo(deps, authC, 'nao-existe'), { error: 'O jogador escolhido não existe mais na aba Jogadores.' });
  assert.deepEqual(await solicitarVinculo(deps, authC, 'p1'), { error: 'Esse jogador já está vinculado ao e-mail a@exemplo.com.' });
  assert.deepEqual(await solicitarVinculo(deps, authC, 'p3'), { status: 'ok', jogadorIdPendente: 'p3' });
  assert.deepEqual(await solicitarVinculo(deps, authB, 'p3'), { error: 'Já existe outro pedido de vínculo pendente pra esse jogador. Fale com o administrador.' });
  assert.deepEqual(await aprovarVinculo(deps, 'x@exemplo.com'), { error: 'Usuário não encontrado.' });
  assert.deepEqual(await aprovarVinculo(deps, 'b@exemplo.com'), { error: 'Esse usuário não tem nenhum pedido de vínculo pendente.' });
  assert.deepEqual(await aprovarVinculo(deps, 'c@exemplo.com'), { status: 'ok' });
  const c = (await usuariosNoBanco(deps)).find((u) => u.email === 'c@exemplo.com');
  assert.equal(c.jogador_id, 'p3');
  assert.equal(c.jogador_id_pendente, null);
  assert.deepEqual(await solicitarVinculo(deps, authC, ''), { status: 'ok', jogadorIdPendente: '' });
});

await ta('rejeitarVinculo: limpa o pedido; usuário inexistente dá erro', async () => {
  const deps = novo();
  await solicitarVinculo(deps, { email: 'c@exemplo.com', nome: 'C', perfil: 'jogador' }, 'p3');
  assert.deepEqual(await rejeitarVinculo(deps, 'c@exemplo.com'), { status: 'ok' });
  assert.equal((await usuariosNoBanco(deps)).find((u) => u.email === 'c@exemplo.com').jogador_id_pendente, null);
  assert.deepEqual(await rejeitarVinculo(deps, 'x@exemplo.com'), { error: 'Usuário não encontrado.' });
});

await ta('herdado do .gs: rejeitarVinculo grava sem jogadorId e ZERA o vínculo já aprovado', async () => {
  const deps = novo();
  assert.equal((await usuariosNoBanco(deps)).find((u) => u.email === 'a@exemplo.com').jogador_id, 'p1');
  await rejeitarVinculo(deps, 'a@exemplo.com');
  assert.equal((await usuariosNoBanco(deps)).find((u) => u.email === 'a@exemplo.com').jogador_id, null);
});

await ta('acharJogadorPorNome: exato, sobrenome, primeiro nome único e ambiguidade', async () => {
  const jogadores = [
    { id: '1', nome: 'José Pedro Silva', apelido: 'Zé' },
    { id: '2', nome: 'Wanderson Lima', apelido: '' },
    { id: '3', nome: 'Maria A', apelido: '' },
    { id: '4', nome: 'Maria B', apelido: '' }
  ];
  assert.deepEqual(acharJogadorPorNome(jogadores, 'JOSE  pedro silva.'), { id: '1', nome: 'José Pedro Silva', motivo: 'exato' });
  assert.deepEqual(acharJogadorPorNome(jogadores, 'Zé'), { id: '1', nome: 'José Pedro Silva', motivo: 'exato' });
  assert.deepEqual(acharJogadorPorNome(jogadores, 'Jose Silva'), { id: '1', nome: 'José Pedro Silva', motivo: 'parecido' });
  assert.deepEqual(acharJogadorPorNome(jogadores, 'Wanderson'), { id: '2', nome: 'Wanderson Lima', motivo: 'parecido' });
  assert.equal(acharJogadorPorNome(jogadores, 'Maria'), null);
  assert.equal(acharJogadorPorNome(jogadores, ''), null);
  assert.equal(acharJogadorPorNome(jogadores, 'Qwerty Inexistente'), null);
});

fim();
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `node tests/backend/usuarios.test.mjs`
Expected: erro `Cannot find module` apontando para `backend/usuarios.js`.

- [ ] **Step 4: Implementar `backend/usuarios.js`**

```javascript
// Regras de login, perfis e vínculos entre conta e jogador. Port de loginGoogle, bootstrapAdmin, listarUsuarios,
// salvarUsuario, removerUsuario, solicitarVinculo, aprovarVinculo, rejeitarVinculo e acharJogadorPorNome_ de
// apps-script-codigo.gs. As mensagens de erro são as mesmas do .gs (o app reconhece várias delas).
import { mapearJogadores, texto, porOrdem } from './mapeadores.js';
import { iguaisSeguros } from './auth.js';

const PERFIS = ['admin', 'organizador', 'jogador'];
export const normalizarEmail = (v) => texto(v).trim().toLowerCase();

// "yyyy-MM-dd" no fuso de São Paulo (o .gs mostra a data de criação assim); en-CA já vem nesse formato
const formatoData = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function dataSaoPaulo(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? texto(v) : formatoData.format(d);
}

// usuários no formato do app (equivale a readUsuarios do .gs), na ordem da planilha
export async function lerUsuarios(repo) {
  const linhas = (await repo.lerUsuarios()).slice().sort(porOrdem);
  return linhas.filter((u) => u.email).map((u) => ({
    email: normalizarEmail(u.email),
    nome: texto(u.nome),
    perfil: (texto(u.perfil) || 'jogador').trim().toLowerCase(),
    jogadorId: texto(u.jogador_id),
    criadoEm: dataSaoPaulo(u.criado_em),
    jogadorIdPendente: texto(u.jogador_id_pendente)
  }));
}

// Mesma regra do upsertUsuario_ do .gs: mexe só em nome, perfil e jogadorId (a data de criação nunca é
// reescrita); "jogadorIdPendente" só é sobrescrito se o chamador passar essa chave (mesmo vazia).
// ATENÇÃO (herdado do .gs): se o chamador não passar jogadorId, o vínculo aprovado é zerado.
async function gravar(repo, relogio, u) {
  const email = normalizarEmail(u.email);
  const perfil = (texto(u.perfil) || 'jogador').trim().toLowerCase();
  const brutos = await repo.lerUsuarios();
  const atual = brutos.find((x) => normalizarEmail(x.email) === email);
  const pendente = ('jogadorIdPendente' in u) ? texto(u.jogadorIdPendente) : (atual ? texto(atual.jogador_id_pendente) : '');
  const linha = { nome: texto(u.nome), perfil, jogador_id: texto(u.jogadorId) || null, jogador_id_pendente: pendente || null };
  if (atual) {
    await repo.gravarUsuario({ ...linha, email: atual.email });
  } else {
    const maior = brutos.reduce((m, x) => Math.max(m, x.ordem ?? 0), 0);
    await repo.gravarUsuario({ ...linha, email, criado_em: relogio().toISOString(), ordem: maior + 1 });
  }
}

// Compara nomes sem tropeçar em acento, maiúscula, ponto ou espaço duplo
function normalizarNome(s) {
  return texto(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Palpite de qual jogador cadastrado é o dono da conta, pelo nome; no máximo UM, e na dúvida não palpita.
export function acharJogadorPorNome(players, nomeConta) {
  const alvo = normalizarNome(nomeConta);
  if (!alvo) return null;
  let achado = players.filter((p) => normalizarNome(p.nome) === alvo || (p.apelido && normalizarNome(p.apelido) === alvo))[0];
  if (achado) return { id: achado.id, nome: achado.nome, motivo: 'exato' };

  const partesAlvo = alvo.split(' ');
  if (partesAlvo.length >= 2) {
    const chaveAlvo = partesAlvo[0] + ' ' + partesAlvo[partesAlvo.length - 1];
    achado = players.filter((p) => {
      const partes = normalizarNome(p.nome).split(' ');
      return partes.length >= 2 && (partes[0] + ' ' + partes[partes.length - 1]) === chaveAlvo;
    })[0];
    if (achado) return { id: achado.id, nome: achado.nome, motivo: 'parecido' };
  }

  const comMesmoPrimeiro = players.filter((p) => normalizarNome(p.nome).split(' ')[0] === partesAlvo[0]);
  if (comMesmoPrimeiro.length === 1) return { id: comMesmoPrimeiro[0].id, nome: comMesmoPrimeiro[0].nome, motivo: 'parecido' };
  return null;
}

async function sugerirJogador(repo, nomeConta) {
  return acharJogadorPorNome(mapearJogadores(await repo.lerJogadores()), nomeConta);
}

export async function loginGoogle({ repo, relogio, verificarToken }, body) {
  const token = await verificarToken(body.idToken);
  if (!token.ok) return { error: token.erro };

  const usuarios = await lerUsuarios(repo);
  const existente = usuarios.find((u) => u.email === token.email);

  if (existente) {
    // o nome da conta Google pode ter mudado: mantém a planilha atualizada, sem tocar no perfil
    if (existente.nome !== token.nome && token.nome) {
      await gravar(repo, relogio, { email: existente.email, nome: token.nome, perfil: existente.perfil, jogadorId: existente.jogadorId });
    }
    return {
      status: 'ok', email: existente.email, nome: token.nome || existente.nome,
      perfil: existente.perfil || 'jogador', jogadorId: existente.jogadorId, jogadorIdPendente: existente.jogadorIdPendente,
      // já vinculado OU já com pedido em análise: não repete a sugestão de vínculo
      sugestao: (existente.jogadorId || existente.jogadorIdPendente) ? null : await sugerirJogador(repo, token.nome),
      primeiroLogin: false, totalUsuarios: usuarios.length
    };
  }

  await gravar(repo, relogio, { email: token.email, nome: token.nome, perfil: 'jogador', jogadorId: '' });
  return {
    status: 'ok', email: token.email, nome: token.nome, perfil: 'jogador', jogadorId: '', jogadorIdPendente: '',
    sugestao: await sugerirJogador(repo, token.nome), primeiroLogin: true, totalUsuarios: usuarios.length + 1
  };
}

// Promove a admin quem está logado com Google E informou a chave mestra (idempotente; nunca perde o vínculo)
export async function bootstrapAdmin({ repo, relogio, config, verificarToken }, body) {
  if (!config.adminPassword || !iguaisSeguros(body.senha, config.adminPassword)) return { error: 'Chave mestra incorreta.' };
  const token = await verificarToken(body.idToken);
  if (!token.ok) return { error: token.erro };
  const existente = (await lerUsuarios(repo)).find((u) => u.email === token.email);
  const jogadorId = existente ? existente.jogadorId : '';
  await gravar(repo, relogio, { email: token.email, nome: token.nome, perfil: 'admin', jogadorId });
  return { status: 'ok', email: token.email, nome: token.nome, perfil: 'admin', jogadorId };
}

// Organizador recebe a lista SEM o "perfil" de ninguém (defesa em profundidade: nunca sai do backend)
export async function listarUsuarios({ repo }, perfilDeQuemPediu) {
  const usuarios = await lerUsuarios(repo);
  if (perfilDeQuemPediu === 'admin') return { usuarios };
  return { usuarios: usuarios.map((u) => ({ email: u.email, nome: u.nome, jogadorId: u.jogadorId, criadoEm: u.criadoEm, jogadorIdPendente: u.jogadorIdPendente })) };
}

export async function salvarUsuario({ repo, relogio }, u) {
  if (!u || !u.email) return { error: 'E-mail do usuário é obrigatório.' };
  const perfil = texto(u.perfil || 'jogador').trim().toLowerCase();
  if (!PERFIS.includes(perfil)) return { error: 'Perfil inválido: ' + u.perfil };
  const email = normalizarEmail(u.email);
  const usuarios = await lerUsuarios(repo);
  const atual = usuarios.find((x) => x.email === email);

  // sem admin nenhum ninguém mais gerencia nada (só sobra a chave mestra): o último admin não pode se rebaixar
  if (atual && atual.perfil === 'admin' && perfil !== 'admin') {
    if (usuarios.filter((x) => x.perfil === 'admin').length <= 1) {
      return { error: 'Não é possível rebaixar o último administrador. Promova outro admin primeiro.' };
    }
  }

  const jogadorId = texto(u.jogadorId);
  if (jogadorId) {
    const jogadores = mapearJogadores(await repo.lerJogadores());
    if (!jogadores.some((p) => p.id === jogadorId)) return { error: 'O jogador escolhido não existe mais na aba Jogadores.' };
    const jaUsado = usuarios.find((x) => x.jogadorId === jogadorId && x.email !== email);
    if (jaUsado) return { error: 'Esse jogador já está vinculado ao e-mail ' + jaUsado.email + '.' };
  }

  // quem decide o jogadorId (aprovando um pedido ou editando à mão) resolve qualquer pedido pendente
  await gravar(repo, relogio, { email, nome: texto(u.nome || (atual && atual.nome)), perfil, jogadorId, jogadorIdPendente: '' });
  return { status: 'ok' };
}

export async function removerUsuario({ repo }, email) {
  const alvo = normalizarEmail(email);
  const usuarios = await lerUsuarios(repo);
  const atual = usuarios.find((x) => x.email === alvo);
  if (!atual) return { error: 'Usuário não encontrado (pode já ter sido removido).' };
  if (atual.perfil === 'admin' && usuarios.filter((x) => x.perfil === 'admin').length <= 1) {
    return { error: 'Não é possível remover o último administrador. Promova outro admin primeiro.' };
  }
  const bruto = (await repo.lerUsuarios()).find((x) => normalizarEmail(x.email) === alvo);
  if (!bruto) return { error: 'Usuário não encontrado (pode já ter sido removido).' };
  await repo.removerUsuario(bruto.email);
  return { status: 'ok' };
}

// Pedido de vínculo entre a conta logada e um jogador: NÃO vincula na hora, fica pendente até alguém aprovar.
// Só mexe na linha do PRÓPRIO e-mail autenticado (por isso recebe o "auth" do porteiro, nunca um e-mail do cliente).
export async function solicitarVinculo({ repo, relogio }, auth, jogadorId) {
  if (!auth.email) return { error: 'Essa ação precisa de login com conta Google (a chave mestra não identifica uma pessoa).' };
  const alvo = texto(jogadorId);

  if (!alvo) {
    await gravar(repo, relogio, { email: auth.email, nome: auth.nome, perfil: auth.perfil, jogadorIdPendente: '' });
    return { status: 'ok', jogadorIdPendente: '' };
  }

  const jogadores = mapearJogadores(await repo.lerJogadores());
  if (!jogadores.some((p) => p.id === alvo)) return { error: 'O jogador escolhido não existe mais na aba Jogadores.' };

  const usuarios = await lerUsuarios(repo);
  const jaAprovado = usuarios.find((x) => x.jogadorId === alvo && x.email !== auth.email);
  if (jaAprovado) return { error: 'Esse jogador já está vinculado ao e-mail ' + jaAprovado.email + '.' };
  const jaPendente = usuarios.find((x) => x.jogadorIdPendente === alvo && x.email !== auth.email);
  if (jaPendente) return { error: 'Já existe outro pedido de vínculo pendente pra esse jogador. Fale com o administrador.' };

  await gravar(repo, relogio, { email: auth.email, nome: auth.nome, perfil: auth.perfil, jogadorIdPendente: alvo });
  return { status: 'ok', jogadorIdPendente: alvo };
}

// Admin ou organizador confirma um pedido pendente (pode corrigir para outro jogador). Nunca mexe no cargo.
export async function aprovarVinculo(deps, email, jogadorIdEscolhido) {
  const alvo = normalizarEmail(email);
  const atual = (await lerUsuarios(deps.repo)).find((u) => u.email === alvo);
  if (!atual) return { error: 'Usuário não encontrado.' };
  if (!atual.jogadorIdPendente) return { error: 'Esse usuário não tem nenhum pedido de vínculo pendente.' };
  const jogadorId = jogadorIdEscolhido ? texto(jogadorIdEscolhido) : atual.jogadorIdPendente;
  return salvarUsuario(deps, { email: atual.email, nome: atual.nome, perfil: atual.perfil, jogadorId });
}

// Recusa um pedido pendente: só apaga o pedido (mas veja o aviso em gravar: o vínculo aprovado também é zerado)
export async function rejeitarVinculo({ repo, relogio }, email) {
  const alvo = normalizarEmail(email);
  const atual = (await lerUsuarios(repo)).find((u) => u.email === alvo);
  if (!atual) return { error: 'Usuário não encontrado.' };
  await gravar(repo, relogio, { email: atual.email, nome: atual.nome, perfil: atual.perfil, jogadorIdPendente: '' });
  return { status: 'ok' };
}
```

- [ ] **Step 5: Rodar — deve passar**

Run: `node tests/backend/usuarios.test.mjs`
Expected: 14 linhas `ok` e `TODOS OS TESTES PASSARAM`. Rodar também `node tests/backend/mapeadores.test.mjs`. Se algum teste falhar depois de copiar o código exatamente, NÃO alterar as expectativas: reportar a falha exata.

- [ ] **Step 6: Commit**

```bash
git add backend/mapeadores.js backend/usuarios.js tests/backend/usuarios.test.mjs
git commit -m "feat: regras de login, perfis e vínculos (usuarios.js, etapa 2)"
```

---

### Task 4: Porteiro e roteamento do `post` no handler

**Files:**
- Create: `backend/porteiro.js`
- Modify: `backend/handler.js`
- Modify: `tests/backend/handler.test.mjs` (só o 4º teste)
- Test: `tests/backend/handler-post.test.mjs`

**Interfaces:**
- Consome: `PERMISSOES` (Task 1), `iguaisSeguros` (Task 1), `lerUsuarios` e as ações de `usuarios.js` (Task 3), `mapearAoVivo`/`mapearConfig` (etapa 1).
- Produz `autorizar(deps, body)` em `backend/porteiro.js` (assíncrona): `{ error }` ou `{ ok: true, perfil, email, nome, jogadorId, viaChaveMestra }`.
- Produz `criarHandler({ repo, config = {}, verificarToken, relogio = () => new Date() })`: `get()` inalterado; `post(body)` roteia como o `doPost` do `.gs` (nunca lança: erros viram `{ error }`).

- [ ] **Step 1: Escrever os testes do post (devem falhar)**

Criar `tests/backend/handler-post.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const AGORA = new Date('2026-09-23T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },   // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' },   // jogador
  'tok-x': { ok: true, email: 'x@exemplo.com', nome: 'Desconhecido' }
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' });
const handler = (repo = criarRepoMemoria(fixture)) => criarHandler({ repo, config: { adminPassword: 'chave-de-teste' }, verificarToken, relogio: () => AGORA });

await ta('loginGoogle passa pelo handler', async () => {
  const r = await handler().post({ action: 'loginGoogle', idToken: 'tok-a' });
  assert.equal(r.perfil, 'admin');
  assert.equal(r.status, 'ok');
});

await ta('bootstrapAdmin passa pelo handler', async () => {
  assert.deepEqual(await handler().post({ action: 'bootstrapAdmin', senha: 'errada', idToken: 'tok-c' }), { error: 'Chave mestra incorreta.' });
});

await ta('porteiro: sem nada, com senha errada, ação desconhecida', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'salvarUsuario' }), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.deepEqual(await h.post({ action: 'salvarUsuario', senha: 'errada' }), { error: 'Senha de administrador incorreta.' });
  assert.deepEqual(await h.post({ action: 'xpto', senha: 'chave-de-teste' }), { error: 'Ação desconhecida: xpto' });
  assert.deepEqual(await h.post({ action: 'constructor', senha: 'chave-de-teste' }), { error: 'Ação desconhecida: constructor' });
});

await ta('porteiro: senha errada mas COM token cai no token', async () => {
  const r = await handler().post({ action: 'listarUsuarios', senha: 'errada', idToken: 'tok-b' });
  assert.equal(r.usuarios.length, 3);
});

await ta('porteiro: perfil sem permissão, e-mail desconhecido vira jogador', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'salvarUsuario', idToken: 'tok-c', usuario: { email: 'c@exemplo.com', perfil: 'admin' } }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'listarUsuarios', idToken: 'tok-x' }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
});

await ta('ping: mostra perfil e se veio pela chave mestra', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'ping', senha: 'chave-de-teste' }), { status: 'ok', perfil: 'admin', viaChaveMestra: true });
  assert.deepEqual(await h.post({ action: 'ping', idToken: 'tok-b' }), { status: 'ok', perfil: 'organizador', viaChaveMestra: false });
});

await ta('listarUsuarios: chave mestra e admin veem o cargo; organizador não', async () => {
  const h = handler();
  assert.ok('perfil' in (await h.post({ action: 'listarUsuarios', senha: 'chave-de-teste' })).usuarios[0]);
  assert.ok('perfil' in (await h.post({ action: 'listarUsuarios', idToken: 'tok-a' })).usuarios[0]);
  assert.equal('perfil' in (await h.post({ action: 'listarUsuarios', idToken: 'tok-b' })).usuarios[0], false);
});

await ta('ações de usuários gravam pelo repositório (salvar, vincular, remover)', async () => {
  const repo = criarRepoMemoria(fixture);
  const h = handler(repo);
  assert.deepEqual(await h.post({ action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'organizador' } }), { status: 'ok' });
  assert.equal((await repo.lerUsuarios()).find((u) => u.email === 'c@exemplo.com').perfil, 'organizador');
  assert.deepEqual(await h.post({ action: 'removerUsuario', idToken: 'tok-a', email: 'c@exemplo.com' }), { status: 'ok' });
  assert.equal((await repo.lerUsuarios()).length, 2);
  assert.deepEqual(await h.post({ action: 'solicitarVinculo', idToken: 'tok-b', jogadorId: 'p1' }), { error: 'Esse jogador já está vinculado ao e-mail a@exemplo.com.' });
});

await ta('ação da matriz ainda não portada: passa pelo porteiro e depois avisa', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'addPlayer', idToken: 'tok-a' }), { error: 'Esta ação ainda não está disponível na versão Supabase (addPlayer).' });
  assert.deepEqual(await h.post({ action: 'addPlayer', idToken: 'tok-c' }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
});

await ta('addCheckin/removeCheckin: só validam o token e depois avisam', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'addCheckin' }), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.deepEqual(await h.post({ action: 'removeCheckin', idToken: 'tok-c' }), { error: 'Esta ação ainda não está disponível na versão Supabase (removeCheckin).' });
});

await ta('lerAoVivo: leitura pública, vazia hoje', async () => {
  assert.deepEqual(await handler().post({ action: 'lerAoVivo' }), { rounds: [], log: [] });
});

await ta('post nunca lança: falha do repositório vira { error }', async () => {
  const h = criarHandler({ repo: { async lerTudo() { throw new Error('banco fora do ar'); }, async lerUsuarios() { throw new Error('banco fora do ar'); } }, config: { adminPassword: 'x' }, verificarToken, relogio: () => AGORA });
  assert.deepEqual(await h.post({ action: 'incrementarAcesso' }), { error: 'banco fora do ar' });
  assert.deepEqual(await h.post({ action: 'listarUsuarios', idToken: 'tok-a' }), { error: 'banco fora do ar' });
  assert.deepEqual(await h.post(undefined), { error: 'Ação desconhecida: ' });
});

fim();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tests/backend/handler-post.test.mjs`
Expected: falhas (o `post` atual só conhece `incrementarAcesso`).

- [ ] **Step 3: Implementar `backend/porteiro.js`**

```javascript
// Porteiro único das ações sensíveis. Ordem (igual ao autorizar_ do .gs):
//   1. senha === chave mestra  -> entra como admin (emergência / bootstrap)
//   2. ID Token válido         -> e-mail -> perfil na tabela usuarios -> confere a matriz
//   3. nada disso              -> nega
import { PERMISSOES } from './permissoes.js';
import { iguaisSeguros } from './auth.js';
import { lerUsuarios } from './usuarios.js';

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
  if (!permitidos.includes(perfil)) return { error: 'Seu perfil (' + perfil + ') não tem permissão para esta ação.' };

  return { ok: true, perfil, email: token.email, nome: token.nome, jogadorId: usuario ? usuario.jogadorId : '', viaChaveMestra: false };
}
```

- [ ] **Step 4: Reescrever `backend/handler.js`**

Substituir o arquivo inteiro por:

```javascript
import {
  mapearJogadores, mapearRodadas, mapearConfig, mapearCheckins,
  mapearPerfisPublicos, mapearAoVivo, mapearFinanceiro
} from './mapeadores.js';
import { autorizar } from './porteiro.js';
import {
  loginGoogle, bootstrapAdmin, listarUsuarios, salvarUsuario, removerUsuario,
  solicitarVinculo, aprovarVinculo, rejeitarVinculo
} from './usuarios.js';

const naoDisponivel = (acao) => ({ error: 'Esta ação ainda não está disponível na versão Supabase (' + acao + ').' });
const semLogin = async () => ({ ok: false, erro: 'Login do Google não configurado neste servidor.' });

// Handler do backend: mesma cara do doGet/doPost do Apps Script. Tudo entra por injeção: o repositório
// (memória nos testes, Supabase de verdade no servidor e na Edge Function), a chave mestra, o verificador
// do token do Google e o relógio.
export function criarHandler({ repo, config = {}, verificarToken = semLogin, relogio = () => new Date() }) {
  const deps = { repo, config, verificarToken, relogio };

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

    // Mesmas regras do doPost do .gs: ações públicas primeiro, depois o porteiro, depois a ação.
    async post(body) {
      try {
        const b = body || {};
        const acao = String(b.action || '');

        if (acao === 'incrementarAcesso') { // etapa 1: só lê o contador; gravar é da etapa 5
          const t = await repo.lerTudo();
          return { contadorAcessos: mapearConfig(t.config).contadorAcessos };
        }
        if (acao === 'lerAoVivo') {
          const t = await repo.lerTudo();
          return mapearAoVivo(t.ao_vivo, t.ao_vivo_log);
        }
        if (acao === 'loginGoogle') return await loginGoogle(deps, b);
        if (acao === 'bootstrapAdmin') return await bootstrapAdmin(deps, b);

        // check-in não pede senha nem perfil, só login (a ação em si chega na etapa 3)
        if (acao === 'addCheckin' || acao === 'removeCheckin') {
          const token = await verificarToken(b.idToken);
          if (!token.ok) return { error: token.erro };
          return naoDisponivel(acao);
        }

        // daqui pra baixo é tudo sensível: passa pelo porteiro (chave mestra OU login do Google)
        const auth = await autorizar(deps, b);
        if (auth.error) return { error: auth.error };

        switch (acao) {
          case 'ping': return { status: 'ok', perfil: auth.perfil, viaChaveMestra: !!auth.viaChaveMestra };
          case 'listarUsuarios': return await listarUsuarios(deps, auth.perfil);
          case 'salvarUsuario': return await salvarUsuario(deps, b.usuario);
          case 'removerUsuario': return await removerUsuario(deps, b.email);
          case 'solicitarVinculo': return await solicitarVinculo(deps, auth, b.jogadorId);
          case 'aprovarVinculo': return await aprovarVinculo(deps, b.email, b.jogadorId);
          case 'rejeitarVinculo': return await rejeitarVinculo(deps, b.email);
          default: return naoDisponivel(acao);
        }
      } catch (erro) {
        return { error: String(erro && erro.message ? erro.message : erro) };
      }
    }
  };
}
```

- [ ] **Step 5: Atualizar o 4º teste de `tests/backend/handler.test.mjs`**

Substituir o teste `'post de ação ainda não portada: erro claro com o nome da ação'` (que usava `addCheckin` sem login) por:

```javascript
await ta('post de ação ainda não portada: erro claro com o nome da ação', async () => {
  const h = criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: 'chave-de-teste' } });
  const r = await h.post({ action: 'addPlayer', senha: 'chave-de-teste' });
  assert.match(r.error, /ainda não está disponível/);
  assert.match(r.error, /addPlayer/);
});
```

- [ ] **Step 6: Rodar tudo — deve passar**

Run: `node tests/backend/handler-post.test.mjs && node tests/backend/handler.test.mjs && node tests/backend/usuarios.test.mjs && node tests/backend/mapeadores.test.mjs`
Expected: os quatro terminam com `TODOS OS TESTES PASSARAM`. Confirmar pureza: `grep -nE "node:|process\.|require\(" backend/handler.js backend/porteiro.js backend/usuarios.js backend/auth.js backend/permissoes.js` sem nenhuma linha.

- [ ] **Step 7: Commit**

```bash
git add backend/porteiro.js backend/handler.js tests/backend/handler.test.mjs tests/backend/handler-post.test.mjs
git commit -m "feat: porteiro e roteamento das ações de login e usuários no handler (etapa 2)"
```

---

### Task 5: Teste diferencial contra o `.gs` real

**Files:**
- Test: `tests/backend/paridade-usuarios.test.mjs`

**Interfaces:**
- Consome: `criarAmbiente` (`tests/helpers/planilha-falsa.js`), `dbParaAbas` e `fixture` (etapa 1), `criarRepoMemoria`, `criarHandler`, `criarVerificadorGoogle`.
- Produz: prova de que, para a mesma sequência de pedidos, o `.gs` real e o backend novo respondem igual e terminam com o mesmo estado.

- [ ] **Step 1: Criar `tests/backend/paridade-usuarios.test.mjs`**

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

// cenário: o fixture + um jogador (p3) sem vínculo, para os pedidos de vínculo
const dados = structuredClone(fixture);
dados.jogadores.push({ id: 'p3', nome: 'Carla Souza', apelido: null, foto: null, estrelas: 3, sexo: 'F', porte: 'M', convidado: false, ordem: 3 });

// ---------- lado 1: o .gs REAL ----------
const gs = criarAmbiente(dbParaAbas(dados), [caminhoGs]);
// a data de criação precisa ser um Date do PRÓPRIO contexto do .gs (ele testa `instanceof Date`)
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
  'tok-c': { ...base, email: 'c@exemplo.com', name: 'C' },
  'tok-n': { ...base, email: ' N@Exemplo.com ', name: 'Carla Souza' },
  'tok-n2': { ...base, email: 'm@exemplo.com', name: 'Carla' },
  'tok-b-renomeado': { ...base, email: 'b@exemplo.com', name: 'Bruno Novo' },
  'tok-outro-app': { ...base, aud: 'outro-app', email: 'z@exemplo.com', name: 'Z' },
  'tok-nao-verificado': { ...base, email_verified: 'false', email: 'z@exemplo.com', name: 'Z' },
  'tok-expirado': { ...base, exp: '1', email: 'z@exemplo.com', name: 'Z' }
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

// usuários criados DURANTE o cenário recebem a data de hoje: normaliza para não depender do fuso da hora do teste
const EMAILS_INICIAIS = new Set(dados.usuarios.map((u) => u.email));
function normalizar(x) {
  if (Array.isArray(x)) return x.map(normalizar);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = normalizar(x[k]);
    if ('email' in o && 'criadoEm' in o && !EMAILS_INICIAIS.has(o.email)) o.criadoEm = '<hoje>';
    return o;
  }
  return x;
}

const passos = [
  ['login: admin existente', { action: 'loginGoogle', idToken: 'tok-a' }],
  ['login: conta nova (e-mail com maiúscula e espaço) ganha sugestão exata', { action: 'loginGoogle', idToken: 'tok-n' }],
  ['login: mesma conta de novo (não é mais o primeiro login)', { action: 'loginGoogle', idToken: 'tok-n' }],
  ['login: outra conta nova, sugestão por primeiro nome', { action: 'loginGoogle', idToken: 'tok-n2' }],
  ['login: nome da conta mudou (atualiza sem mexer no perfil)', { action: 'loginGoogle', idToken: 'tok-b-renomeado' }],
  ['login: token de outro aplicativo', { action: 'loginGoogle', idToken: 'tok-outro-app' }],
  ['login: e-mail não verificado', { action: 'loginGoogle', idToken: 'tok-nao-verificado' }],
  ['login: token expirado', { action: 'loginGoogle', idToken: 'tok-expirado' }],
  ['login: token que o Google recusa', { action: 'loginGoogle', idToken: 'lixo' }],
  ['login: sem token', { action: 'loginGoogle' }],
  ['vínculo: conta nova pede p3', { action: 'solicitarVinculo', idToken: 'tok-n', jogadorId: 'p3' }],
  ['vínculo: outra conta pede o mesmo p3 (pedido pendente)', { action: 'solicitarVinculo', idToken: 'tok-n2', jogadorId: 'p3' }],
  ['vínculo: pede jogador já vinculado a outro e-mail', { action: 'solicitarVinculo', idToken: 'tok-n', jogadorId: 'p1' }],
  ['vínculo: pede jogador inexistente', { action: 'solicitarVinculo', idToken: 'tok-n', jogadorId: 'nao-existe' }],
  ['vínculo: chave mestra não identifica pessoa', { action: 'solicitarVinculo', senha: SENHA, jogadorId: 'p3' }],
  ['vínculo: aprovar e-mail que não existe', { action: 'aprovarVinculo', idToken: 'tok-b', email: 'x@exemplo.com' }],
  ['vínculo: aprovar quem não tem pedido', { action: 'aprovarVinculo', idToken: 'tok-b', email: 'c@exemplo.com' }],
  ['vínculo: organizador aprova o pedido', { action: 'aprovarVinculo', idToken: 'tok-b', email: 'n@exemplo.com' }],
  ['vínculo: jogador comum não pode aprovar', { action: 'aprovarVinculo', idToken: 'tok-c', email: 'm@exemplo.com' }],
  ['vínculo: admin rejeita pedido inexistente', { action: 'rejeitarVinculo', idToken: 'tok-a', email: 'x@exemplo.com' }],
  ['vínculo: conta desiste do pedido (jogadorId vazio)', { action: 'solicitarVinculo', idToken: 'tok-c', jogadorId: '' }],
  ['listar: organizador (sem cargo)', { action: 'listarUsuarios', idToken: 'tok-b' }],
  ['listar: admin (com cargo)', { action: 'listarUsuarios', idToken: 'tok-a' }],
  ['listar: chave mestra', { action: 'listarUsuarios', senha: SENHA }],
  ['listar: jogador comum é negado', { action: 'listarUsuarios', idToken: 'tok-c' }],
  ['salvar: sem e-mail', { action: 'salvarUsuario', idToken: 'tok-a', usuario: {} }],
  ['salvar: perfil inválido', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'xpto' } }],
  ['salvar: rebaixar o último admin', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'a@exemplo.com', perfil: 'jogador' } }],
  ['salvar: jogador inexistente', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'nao-existe' } }],
  ['salvar: jogador já vinculado a outro', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'p1' } }],
  ['salvar: promove b a admin', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'b@exemplo.com', perfil: 'admin', jogadorId: 'p2' } }],
  ['salvar: agora pode rebaixar a', { action: 'salvarUsuario', idToken: 'tok-b', usuario: { email: 'a@exemplo.com', perfil: 'organizador', jogadorId: 'p1' } }],
  ['salvar: admin promove c a organizador', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'organizador' } }],
  ['remover: e-mail que não existe', { action: 'removerUsuario', idToken: 'tok-b', email: 'x@exemplo.com' }],
  ['remover: c', { action: 'removerUsuario', idToken: 'tok-b', email: 'c@exemplo.com' }],
  ['remover: último admin (b)', { action: 'removerUsuario', idToken: 'tok-b', email: 'b@exemplo.com' }],
  ['herdado: rejeitar vínculo zera o vínculo aprovado de b', { action: 'rejeitarVinculo', idToken: 'tok-b', email: 'b@exemplo.com' }],
  ['bootstrap: chave errada', { action: 'bootstrapAdmin', senha: 'errada', idToken: 'tok-n2' }],
  ['bootstrap: chave certa com token inválido', { action: 'bootstrapAdmin', senha: SENHA, idToken: 'lixo' }],
  ['bootstrap: chave certa promove m a admin', { action: 'bootstrapAdmin', senha: SENHA, idToken: 'tok-n2' }],
  ['porteiro: ação desconhecida', { action: 'xpto', senha: SENHA }],
  ['porteiro: senha errada sem token', { action: 'listarUsuarios', senha: 'errada' }],
  ['porteiro: senha errada com token cai no token', { action: 'listarUsuarios', senha: 'errada', idToken: 'tok-b' }],
  ['porteiro: sem nada', { action: 'listarUsuarios' }],
  ['ping: chave mestra', { action: 'ping', senha: SENHA }],
  ['ping: jogador', { action: 'ping', idToken: 'tok-c' }],
  ['ping: conta promovida a admin pelo bootstrap', { action: 'ping', idToken: 'tok-n2' }]
];

for (const [i, [nome, corpo]] of passos.entries()) {
  await ta(`passo ${String(i + 1).padStart(2, '0')}: ${nome}`, async () => {
    const esperado = normalizar(gs.post(corpo));
    const obtido = normalizar(JSON.parse(JSON.stringify(await novo.post(corpo))));
    assert.deepEqual(obtido, esperado);
  });
}

await ta('estado final: perfisPublicos do GET e lista completa de usuários iguais', async () => {
  const esperadoGet = normalizar(gs.get().perfisPublicos);
  const obtidoGet = normalizar(JSON.parse(JSON.stringify((await novo.get()).perfisPublicos)));
  assert.deepEqual(obtidoGet, esperadoGet);
  const corpo = { action: 'listarUsuarios', senha: SENHA };
  assert.deepEqual(normalizar(JSON.parse(JSON.stringify(await novo.post(corpo)))), normalizar(gs.post(corpo)));
});

fim();
```

- [ ] **Step 2: Rodar**

Run: `node tests/backend/paridade-usuarios.test.mjs`
Expected: idealmente `TODOS OS TESTES PASSARAM` (49 passos + o estado final).

- [ ] **Step 3: Se houver diferenças, resolver assim (este é o objetivo do teste)**

Para cada passo que falhar, ler o `.gs` real (fonte da verdade) e decidir de que lado está o defeito:
- o backend novo (`usuarios.js`, `porteiro.js`, `handler.js`, `auth.js`) difere do `.gs` → corrigir o **backend novo**;
- só a montagem do teste (fake do Google, datas, normalização) → corrigir o teste, sem enfraquecer a comparação.
Regras: nunca editar o `.gs`; nunca afrouxar o `assert.deepEqual`; nunca remover um passo para ele passar; se corrigir o backend, rodar de novo `node tests/backend/usuarios.test.mjs`, `node tests/backend/handler-post.test.mjs` e `node tests/backend/permissoes.test.mjs`. Registrar cada diferença encontrada (passo, o que o `.gs` faz, qual arquivo foi corrigido) no relatório da tarefa.
Se alguma diferença revelar um comportamento do `.gs` que pareça um bug (como o de `rejeitarVinculo`), **não** corrigi-lo: replicar o comportamento e listar no relatório.

- [ ] **Step 4: Verificar que o teste não é vazio**

Confirmar no relatório que o `.gs` respondeu de verdade (ex.: o passo 2 devolve `primeiroLogin: true` e o passo "listar: admin" devolve os usuários do fixture mais os criados no cenário). Fazer uma mutação: trocar temporariamente, só na memória do teste, uma resposta esperada (por exemplo, rodar o cenário com `ADMIN` diferente no lado novo) e confirmar que o teste **falha**; desfazer.

- [ ] **Step 5: Commit**

```bash
git add tests/backend/paridade-usuarios.test.mjs backend/
git commit -m "test: paridade das ações de login e usuários com o .gs real (etapa 2)"
```

---

### Task 6: Servidor local seguro, segredos do `.env` e login real

**Files:**
- Create: `backend/servidor.js`
- Modify: `backend/servidor-local.js` (vira só o lançador)
- Test: `tests/backend/servidor.test.mjs`
- Modify: `package.json` (script `test:backend`)

**Interfaces:**
- Consome: `criarHandler` (Task 4), `criarRepoSupabase` (etapa 1/Task 2), `criarVerificadorGoogle` (Task 1).
- Produz `criarServidor({ handler, arquivoHtml })` em `backend/servidor.js`: devolve um `http.Server` (o chamador faz o `listen`). Recusa (lança) se o HTML não tiver a linha `const SHEET_API_URL = "...";`.

- [ ] **Step 1: Escrever os testes do servidor (devem falhar)**

Criar `tests/backend/servidor.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ta, fim } from './executor.mjs';
import { criarServidor } from '../../backend/servidor.js';

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'servidor-teste-'));
const arquivoHtml = path.join(pasta, 'app.html');
fs.writeFileSync(arquivoHtml, '<html><body><script>const SHEET_API_URL = "https://script.google.com/producao";</script></body></html>');

let chamadasPost = 0;
const handler = { async get() { return { ok: 'get' }; }, async post(b) { chamadasPost++; return { eco: b }; } };
const servidor = criarServidor({ handler, arquivoHtml });
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const porta = servidor.address().port;
const ORIGEM = `http://localhost:${porta}`;

function pedir({ metodo = 'GET', caminho = '/', headers = {}, corpo }) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers }, (res) => {
      let texto = '';
      res.on('data', (d) => (texto += d));
      res.on('end', () => resolve({ status: res.statusCode, texto }));
    });
    req.on('error', () => resolve({ status: 0, texto: '' })); // conexão cortada pelo servidor
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

await ta('GET /api devolve o handler.get', async () => {
  const r = await pedir({ caminho: '/api' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.texto), { ok: 'get' });
});

await ta('POST /api sem Origin é recusado (403) e o handler não é chamado', async () => {
  const antes = chamadasPost;
  const r = await pedir({ metodo: 'POST', caminho: '/api', corpo: '{"action":"x"}' });
  assert.equal(r.status, 403);
  assert.equal(chamadasPost, antes);
});

await ta('POST /api com Origin de outro site é recusado (403)', async () => {
  const antes = chamadasPost;
  const r = await pedir({ metodo: 'POST', caminho: '/api', headers: { Origin: 'http://evil.example' }, corpo: '{"action":"x"}' });
  assert.equal(r.status, 403);
  assert.equal(chamadasPost, antes);
});

await ta('POST /api com a Origin da própria página funciona', async () => {
  const r = await pedir({ metodo: 'POST', caminho: '/api', headers: { Origin: ORIGEM }, corpo: '{"action":"ping"}' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.texto), { eco: { action: 'ping' } });
});

await ta('Host diferente de localhost/127.0.0.1 é recusado (403)', async () => {
  const r = await pedir({ caminho: '/api', headers: { Host: 'evil.example' } });
  assert.equal(r.status, 403);
});

await ta('corpo maior que 1 MB é recusado e o handler não é chamado', async () => {
  const antes = chamadasPost;
  const r = await pedir({ metodo: 'POST', caminho: '/api', headers: { Origin: ORIGEM }, corpo: 'x'.repeat(2 * 1024 * 1024) });
  assert.ok(r.status === 413 || r.status === 0, 'esperava 413 ou conexão cortada, veio ' + r.status);
  assert.equal(chamadasPost, antes);
});

await ta('JSON inválido vira { error } (200), sem derrubar o servidor', async () => {
  const r = await pedir({ metodo: 'POST', caminho: '/api', headers: { Origin: ORIGEM }, corpo: '{nao e json' });
  assert.equal(r.status, 200);
  assert.ok(JSON.parse(r.texto).error);
});

await ta('GET / serve a página com a URL da API trocada e sem apontar para a produção', async () => {
  const r = await pedir({ caminho: '/' });
  assert.equal(r.status, 200);
  assert.ok(r.texto.includes(`const SHEET_API_URL = "http://localhost:${porta}/api";`));
  assert.equal(r.texto.includes('script.google.com'), false);
  assert.ok(r.texto.includes('perfil'), 'a injeção do ?perfil=admin deve estar na página');
});

await ta('outros caminhos: 404; método errado em /api: 405', async () => {
  assert.equal((await pedir({ caminho: '/sw.js' })).status, 404);
  assert.equal((await pedir({ caminho: '/api/x' })).status, 404);
  assert.equal((await pedir({ metodo: 'PUT', caminho: '/api', headers: { Origin: ORIGEM } })).status, 405);
});

await ta('HTML sem a linha SHEET_API_URL: o servidor recusa nascer', async () => {
  const ruim = path.join(pasta, 'ruim.html');
  fs.writeFileSync(ruim, '<html><body>sem a linha</body></html>');
  assert.throws(() => criarServidor({ handler, arquivoHtml: ruim }), /SHEET_API_URL/);
});

servidor.close();
fs.rmSync(pasta, { recursive: true, force: true });
fim();
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node tests/backend/servidor.test.mjs`
Expected: erro `Cannot find module` apontando para `backend/servidor.js`.

- [ ] **Step 3: Implementar `backend/servidor.js`**

```javascript
// Servidor HTTP local (só Node): serve a página do app e a rota /api. Não sabe nada de banco nem de .env:
// recebe o handler pronto. Quem chama decide onde escutar (o lançador usa 127.0.0.1).
import http from 'node:http';
import fs from 'node:fs';

const REGEX_URL_API = /const SHEET_API_URL = "[^"]*";/;
const LIMITE_CORPO = 1024 * 1024; // 1 MB (a foto do app tem ~20 a 80 KB)

// Parâmetros da URL só para conferir telas no navegador (não dão privilégio nenhum no servidor):
//   ?perfil=admin  simula um usuário admin logado, só para ver as telas      ?view=financeiro  abre a tela
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

async function lerCorpo(req) {
  let total = 0;
  const pedacos = [];
  for await (const pedaco of req) {
    total += pedaco.length;
    if (total > LIMITE_CORPO) return null;
    pedacos.push(pedaco);
  }
  return Buffer.concat(pedacos).toString('utf8');
}

export function criarServidor({ handler, arquivoHtml }) {
  // confere já na criação: se o HTML foi reformatado e a URL não puder ser reescrita, a página falaria com a PRODUÇÃO
  if (!REGEX_URL_API.test(fs.readFileSync(arquivoHtml, 'utf8'))) {
    throw new Error('Não achei a linha "const SHEET_API_URL = ..." no HTML; recusando iniciar (a página apontaria para a produção).');
  }

  const servidor = http.createServer(async (req, res) => {
    const porta = servidor.address().port;
    const json = (objeto) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(objeto)); };
    const recusar = (status) => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(); };
    try {
      // defesa contra páginas de outros sites falando com o localhost (e contra DNS rebinding)
      if (req.headers.host !== `localhost:${porta}` && req.headers.host !== `127.0.0.1:${porta}`) return recusar(403);

      const caminho = req.url.split('?')[0];
      if (caminho === '/api') {
        if (req.method === 'GET') return json(await handler.get());
        if (req.method === 'POST') {
          const origem = req.headers.origin;
          if (origem !== `http://localhost:${porta}` && origem !== `http://127.0.0.1:${porta}`) return recusar(403);
          if (Number(req.headers['content-length']) > LIMITE_CORPO) { res.writeHead(413); res.end(); return req.destroy(); }
          const corpo = await lerCorpo(req);
          if (corpo === null) { res.writeHead(413); res.end(); return req.destroy(); }
          return json(await handler.post(JSON.parse(corpo || '{}')));
        }
        return recusar(405);
      }
      if (caminho !== '/') return recusar(404);

      const original = fs.readFileSync(arquivoHtml, 'utf8');
      const comUrl = original.replace(REGEX_URL_API, 'const SHEET_API_URL = "http://localhost:' + porta + '/api";');
      if (comUrl === original) throw new Error('Não achei a linha "const SHEET_API_URL = ..." no HTML; recusando servir a página (ela apontaria para a produção).');
      const html = comUrl.replace('</body>', INJECAO + '</body>');
      if (html === comUrl) throw new Error('Não achei a tag </body> no HTML; recusando servir a página sem a injeção.');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (erro) {
      json({ error: String(erro && erro.message ? erro.message : erro) });
    }
  });
  return servidor;
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `node tests/backend/servidor.test.mjs`
Expected: 10 linhas `ok` e `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Reescrever `backend/servidor-local.js` (lançador)**

Substituir o arquivo inteiro por:

```javascript
// Lançador do servidor local do Terça sobre o Supabase. Lê o .env, monta o handler de verdade e sobe em 127.0.0.1.
// Uso: node backend/servidor-local.js [porta]      (padrão 8000: a origem autorizada no Client ID do Google)
//   HTML_TERCA=<caminho do volei-dashboard.html>    (padrão: o da raiz do repositório)
// A service_role, a chave mestra e o Client ID ficam só neste processo; nada disso vai para o navegador.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { criarHandler } from './handler.js';
import { criarRepoSupabase } from './repo-supabase.js';
import { criarVerificadorGoogle } from './auth.js';
import { criarServidor } from './servidor.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const obrigatorias = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD', 'GOOGLE_CLIENT_ID'];
const faltando = obrigatorias.filter((nome) => !process.env[nome]);
if (faltando.length) {
  console.error('Faltam no .env: ' + faltando.join(', '));
  process.exit(1);
}

const porta = Number(process.argv[2]) || 8000;
const arquivoHtml = process.env.HTML_TERCA || path.join(raiz, 'volei-dashboard.html');
const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const handler = criarHandler({
  repo: criarRepoSupabase(cliente),
  config: { adminPassword: process.env.ADMIN_PASSWORD },
  verificarToken: criarVerificadorGoogle({ clientId: process.env.GOOGLE_CLIENT_ID })
});

criarServidor({ handler, arquivoHtml }).listen(porta, '127.0.0.1', () => console.log('Terça (Supabase) em http://localhost:' + porta));
```

- [ ] **Step 6: Atualizar o script `test:backend` do `package.json`**

Deixar o script assim (uma linha; mantendo `migrar` e `servidor`):

```json
    "test:backend": "node tests/backend/mapeadores.test.mjs && node tests/backend/handler.test.mjs && node tests/backend/handler-post.test.mjs && node tests/backend/auth.test.mjs && node tests/backend/permissoes.test.mjs && node tests/backend/repo.test.mjs && node tests/backend/usuarios.test.mjs && node tests/backend/servidor.test.mjs && node tests/backend/paridade-get.test.mjs && node tests/backend/paridade-usuarios.test.mjs"
```

Run: `npm run test:backend`
Expected: todos os arquivos terminam com `TODOS OS TESTES PASSARAM`. Rodar também `node --check backend/servidor-local.js`.

- [ ] **Step 7: Commit**

```bash
git add backend/servidor.js backend/servidor-local.js tests/backend/servidor.test.mjs package.json
git commit -m "feat: servidor local seguro (Host, Origin, limite de corpo) e segredos do .env (etapa 2)"
```

- [ ] **Step 8: Colocar `ADMIN_PASSWORD` e `GOOGLE_CLIENT_ID` no `.env` do worktree (o controlador executa; nunca imprimir os valores)**

O `.env` do worktree é ignorado pelo git. Copiar os dois valores do `.gs` local sem mostrá-los:

```bash
node -e "
const fs = require('fs');
const gs = fs.readFileSync('apps-script-codigo.gs', 'utf8');
const pega = (nome) => { const m = gs.match(new RegExp('const ' + nome + ' = \"([^\"]*)\";')); if (!m) throw new Error(nome + ' nao encontrado no .gs'); return m[1]; };
let env = fs.readFileSync('.env', 'utf8');
if (!/^ADMIN_PASSWORD=/m.test(env)) env += (env.endsWith('\n') ? '' : '\n') + 'ADMIN_PASSWORD=' + pega('ADMIN_PASSWORD') + '\n';
if (!/^GOOGLE_CLIENT_ID=/m.test(env)) env += 'GOOGLE_CLIENT_ID=' + pega('GOOGLE_CLIENT_ID') + '\n';
fs.writeFileSync('.env', env);
console.log('.env atualizado (valores não exibidos). Chaves presentes:', env.split('\n').filter(Boolean).map((l) => l.split('=')[0]).join(', '));
"
```

Expected: imprime as chaves presentes (`SUPABASE_URL, ..., ADMIN_PASSWORD, GOOGLE_CLIENT_ID`), sem valores.

- [ ] **Step 9: Subir o servidor e testar sem login (o controlador executa)**

Run (em segundo plano, apontando para o HTML atual do checkout principal):

```bash
HTML_TERCA="C:/Users/Heleno/OneDrive/Documentos/GitHub/voleis_VS/volei-dashboard.html" node backend/servidor-local.js
```

Depois: `GET http://localhost:8000/api` deve devolver as 7 chaves (47 jogadores); um `POST` com `Origin: http://localhost:8000` e `{"action":"loginGoogle","idToken":"lixo"}` deve devolver `{"error":"Login do Google inválido ou expirado. Entre de novo."}`; um `POST` sem `Origin` deve dar 403.

- [ ] **Step 10: Login real no navegador (o usuário)**

Abrir `http://localhost:8000`, clicar em entrar com o Google. Esperado: o app te reconhece com o seu perfil (a sua conta já está na tabela `usuarios`). Conferir também: um jogador sem vínculo vê a pergunta "esse é você?"; a tela "Gerenciar usuários" (se admin) lista os usuários; o financeiro aparece para usuário registrado. Ações de gravar fora de usuários e vínculos (check-in, jogadores, rodadas, pagamentos) continuam respondendo "ainda não disponível".
