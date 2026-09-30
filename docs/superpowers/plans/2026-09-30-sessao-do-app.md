# Sessão própria do app (login que não cai) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o ID Token do Google (vence em 1 h) por uma sessão emitida pelo servidor, que dura 90 dias, se renova a cada uso e só acaba no botão Sair.

**Architecture:** `loginGoogle` passa a criar uma linha em `sessoes` (só o hash SHA-256 do token) e devolver o token ao app. Um `identificar()` no porteiro aceita `body.sessao` (banco) ou `body.idToken` (Google, compatibilidade). O front guarda `AUTH.sessao`, manda em toda gravação e para de renovar o Google quando tem sessão.

**Tech Stack:** Node/Deno ESM (`backend/`, sem `node:`/`process.`/`require(`/`Buffer`, conferido por `npm run preparar-edge`), Supabase (Postgres, service_role), HTML single-file sem build, testes com `tests/backend/executor.mjs` (`ta`/`fim`) e scripts Node que extraem funções do HTML.

**Spec:** `docs/superpowers/specs/2026-09-30-sessao-do-app-design.md`

## Global Constraints

- Duração da sessão: **90 dias**; a validade só é empurrada para "agora + 90 dias" quando já passou **1 dia** desde a última renovação.
- Banco guarda **só o hash SHA-256 (hex)** do token; o token cru nunca é gravado nem logado.
- Token: 32 bytes de `crypto.getRandomValues`, em base64url.
- Mensagem de sessão inválida/vencida, exata: `Sua sessão expirou. Entre com o Google de novo.`
- Falha do banco ao conferir a sessão NÃO é "sessão expirou": mensagem exata `Não foi possível conferir sua sessão agora. Tente de novo.` (o app não desloga por ela).
- `idToken` do Google continua aceito em tudo que aceita hoje (app antigo em cache não quebra).
- Chave mestra (`senha`) continua valendo como hoje.
- `.gs` não muda; testes de paridade ignoram `sessao`/`sessaoExpiraEm`.
- Terça primeiro; Meme (Task 7) só com autorização explícita do usuário.
- Comentários em português explicando o porquê; subir `Ver.:` no rodapé (13.6 → 14.0, mudança grande).
- Validação de sintaxe do `<script>` depois de mexer no HTML (ver CLAUDE.md), usando o scratchpad em vez de `/tmp`.

## Review Focus

1. **Banco falha ao conferir a sessão** (queda de um instante): a pessoa NÃO pode ser deslogada — o app deve mostrar erro de conexão e manter a sessão. (Task 2 e Task 5 testam.)
2. **Pessoa removida da tabela `usuarios` por um admin** com o app aberto em outro aparelho: a próxima ação deve dar "sessão expirou" (sessões apagadas), não seguir como `jogador`. (Task 3 testa.)
3. **App antigo em cache** (sem `sessao`, só `idToken`) continua salvando check-in e rodada. (Task 3 testa com verificador Google falso.)
4. **Chave mestra errada + sessão válida**: deve cair para a sessão, igual hoje com `idToken` (a checagem `!body.idToken` precisa considerar `body.sessao`). (Task 3 testa.)
5. **Sair com servidor fora do ar**: o aparelho sai mesmo assim (apaga o local); a chamada `sair` é só melhor esforço. (Task 5 testa.)

---

### Task 1: Tabela `sessoes` e primitivas do repositório

**Files:**
- Create: `sql/schema-terca-supabase-ajuste-8.sql`
- Modify: `backend/repo-memoria.js` (novas primitivas, lista `sessoes` fora de `TABELAS`)
- Modify: `backend/repo-supabase.js` (mesmas primitivas no Supabase)
- Test: `tests/backend/repo-sessoes.test.mjs` (criar) e acrescentar em `package.json` → `test:backend`

**Interfaces:**
- Produces (os dois repositórios):
  - `lerSessao(tokenHash: string) → Promise<{token_hash,email,criada_em,expira_em,renovada_em} | null>`
  - `inserirSessao(linha) → Promise<void>`
  - `renovarSessao(tokenHash, { expira_em, renovada_em }) → Promise<void>`
  - `apagarSessao(tokenHash) → Promise<void>` (não falha se não existe)
  - `apagarSessoesDe(email) → Promise<void>`
  - `apagarSessoesVencidas(email, agoraIso) → Promise<void>` (apaga do e-mail as com `expira_em <= agoraIso`)
- `sessoes` **não** entra em `TABELAS` (o GET público nunca lê sessões).

- [ ] **Step 1: SQL**

`sql/schema-terca-supabase-ajuste-8.sql`:
```sql
-- Ajuste 8: sessões do app (login que não cai). Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase, ANTES de publicar a função nova.
-- Guarda só o hash SHA-256 do token (quem lê o banco não consegue usar a sessão de ninguém).
create table if not exists sessoes (
  token_hash  text primary key,
  email       text not null,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  renovada_em timestamptz not null default now()
);
create index if not exists sessoes_email_idx on sessoes (email);
-- como as outras tabelas: RLS ligado e nenhuma política (só a service_role, que ignora o RLS, chega aqui)
alter table sessoes enable row level security;
```

- [ ] **Step 2: Teste que falha**

`tests/backend/repo-sessoes.test.mjs`:
```js
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';

const linha = (h, email, expira) => ({ token_hash: h, email, criada_em: '2026-09-30T12:00:00.000Z', expira_em: expira, renovada_em: '2026-09-30T12:00:00.000Z' });

await ta('sessões: insere, lê, renova, apaga uma e apaga todas de um e-mail', async () => {
  const r = criarRepoMemoria(fixture);
  await r.inserirSessao(linha('h1', 'a@exemplo.com', '2026-12-29T12:00:00.000Z'));
  await r.inserirSessao(linha('h2', 'a@exemplo.com', '2026-12-29T12:00:00.000Z'));
  await r.inserirSessao(linha('h3', 'b@exemplo.com', '2026-12-29T12:00:00.000Z'));
  assert.equal((await r.lerSessao('h1')).email, 'a@exemplo.com');
  assert.equal(await r.lerSessao('nao-existe'), null);
  await r.renovarSessao('h1', { expira_em: '2027-01-01T00:00:00.000Z', renovada_em: '2026-10-03T00:00:00.000Z' });
  assert.equal((await r.lerSessao('h1')).expira_em, '2027-01-01T00:00:00.000Z');
  await r.apagarSessao('h1');
  await r.apagarSessao('h1'); // de novo: não falha
  assert.equal(await r.lerSessao('h1'), null);
  await r.apagarSessoesDe('a@exemplo.com');
  assert.equal(await r.lerSessao('h2'), null);
  assert.ok(await r.lerSessao('h3'));
});

await ta('sessões: apagarSessoesVencidas só apaga as vencidas daquele e-mail', async () => {
  const r = criarRepoMemoria(fixture);
  await r.inserirSessao(linha('velha', 'a@exemplo.com', '2026-09-01T00:00:00.000Z'));
  await r.inserirSessao(linha('nova', 'a@exemplo.com', '2026-12-01T00:00:00.000Z'));
  await r.inserirSessao(linha('velha-b', 'b@exemplo.com', '2026-09-01T00:00:00.000Z'));
  await r.apagarSessoesVencidas('a@exemplo.com', '2026-09-30T00:00:00.000Z');
  assert.equal(await r.lerSessao('velha'), null);
  assert.ok(await r.lerSessao('nova'));
  assert.ok(await r.lerSessao('velha-b'));
});

await ta('sessões não aparecem no lerTudo (o GET público nunca vê sessão)', async () => {
  const r = criarRepoMemoria(fixture);
  await r.inserirSessao(linha('h1', 'a@exemplo.com', '2026-12-29T12:00:00.000Z'));
  assert.equal('sessoes' in (await r.lerTudo()), false);
});

fim();
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node tests/backend/repo-sessoes.test.mjs`
Expected: FALHA (`r.inserirSessao is not a function`).

- [ ] **Step 4: Implementar no repositório em memória**

Em `backend/repo-memoria.js`, dentro de `criarRepoMemoria`, logo depois de `const tentativas = new Map();`:
```js
  let sessoes = []; // tabela "sessoes" (ajuste 8): fora de TABELAS de propósito, o lerTudo (GET público) não a lê
```
E no objeto devolvido (depois de `removerUsuario`):
```js
    // sessões do app (ajuste 8): só o hash do token é guardado
    async lerSessao(tokenHash) { const s = sessoes.find((x) => x.token_hash === tokenHash); return s ? { ...s } : null; },
    async inserirSessao(linha) { sessoes.push({ ...linha }); },
    async renovarSessao(tokenHash, campos) { sessoes = sessoes.map((x) => (x.token_hash === tokenHash ? { ...x, ...campos } : x)); },
    async apagarSessao(tokenHash) { sessoes = sessoes.filter((x) => x.token_hash !== tokenHash); },
    async apagarSessoesDe(email) { sessoes = sessoes.filter((x) => x.email !== email); },
    async apagarSessoesVencidas(email, agoraIso) {
      sessoes = sessoes.filter((x) => !(x.email === email && new Date(x.expira_em) <= new Date(agoraIso)));
    },
```

- [ ] **Step 5: Implementar no Supabase**

Em `backend/repo-supabase.js`, no objeto de `criarRepoSupabase` (depois de `removerUsuario`). `lerSessao` é leitura e usa `comNovasTentativas` (já existe no arquivo):
```js
    // sessões do app (ajuste 8). lerSessao é leitura: tenta de novo numa falha passageira (sem isso, uma queda de um
    // instante viraria "não consegui conferir sua sessão" em qualquer clique)
    async lerSessao(tokenHash) {
      return comNovasTentativas(async () => {
        const { data, error } = await cliente.from('sessoes').select('*').eq('token_hash', tokenHash).maybeSingle();
        if (error) throw new Error('sessoes: ' + error.message);
        return data || null;
      }, esperar);
    },
    async inserirSessao(linha) {
      const { error } = await cliente.from('sessoes').insert(linha);
      if (error) throw new Error('sessoes: ' + error.message);
    },
    async renovarSessao(tokenHash, campos) {
      const { error } = await cliente.from('sessoes').update(campos).eq('token_hash', tokenHash);
      if (error) throw new Error('sessoes: ' + error.message);
    },
    async apagarSessao(tokenHash) {
      const { error } = await cliente.from('sessoes').delete().eq('token_hash', tokenHash);
      if (error) throw new Error('sessoes: ' + error.message);
    },
    async apagarSessoesDe(email) {
      const { error } = await cliente.from('sessoes').delete().eq('email', email);
      if (error) throw new Error('sessoes: ' + error.message);
    },
    async apagarSessoesVencidas(email, agoraIso) {
      const { error } = await cliente.from('sessoes').delete().eq('email', email).lte('expira_em', agoraIso);
      if (error) throw new Error('sessoes: ' + error.message);
    },
```

- [ ] **Step 6: Rodar e ver passar; registrar na suíte**

Acrescentar `node tests/backend/repo-sessoes.test.mjs && ` logo depois de `node tests/backend/repo-supabase-leitura.test.mjs && ` em `package.json`.
Run: `node tests/backend/repo-sessoes.test.mjs && npm run test:backend`
Expected: `TODOS OS TESTES PASSARAM` em todos.

- [ ] **Step 7: Commit**

```bash
git add sql/schema-terca-supabase-ajuste-8.sql backend/repo-memoria.js backend/repo-supabase.js tests/backend/repo-sessoes.test.mjs package.json
git commit -m "sessões: tabela (ajuste 8) e primitivas do repositório"
```

---

### Task 2: Módulo `backend/sessoes.js` (criar, validar, renovar)

**Files:**
- Create: `backend/sessoes.js`
- Test: `tests/backend/sessoes.test.mjs` (criar) + `package.json`

**Interfaces:**
- Consumes: primitivas da Task 1; `deps.relogio(): Date`.
- Produces:
  - `export const MSG_SESSAO_EXPIRADA = 'Sua sessão expirou. Entre com o Google de novo.'`
  - `export const MSG_SESSAO_SEM_BANCO = 'Não foi possível conferir sua sessão agora. Tente de novo.'`
  - `export async function hashDoToken(token: string): Promise<string>` (hex de 64 caracteres)
  - `export async function criarSessao({ repo, relogio }, email): Promise<{ sessao: string, sessaoExpiraEm: string }>`
  - `export async function validarSessao({ repo, relogio }, token): Promise<{ ok: true, email, expiraEm } | { ok: false, erro }>`
  - `export async function encerrarSessao({ repo }, token): Promise<void>`

- [ ] **Step 1: Teste que falha**

`tests/backend/sessoes.test.mjs`:
```js
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarSessao, validarSessao, encerrarSessao, hashDoToken, MSG_SESSAO_EXPIRADA, MSG_SESSAO_SEM_BANCO } from '../../backend/sessoes.js';

const DIA = 86400000;
function deps(iniIso = '2026-09-30T12:00:00.000Z') {
  let agora = new Date(iniIso).getTime();
  return { repo: criarRepoMemoria(fixture), relogio: () => new Date(agora), avancar: (ms) => { agora += ms; } };
}

await ta('criarSessao: token base64url de 32 bytes, banco guarda só o hash, vale 90 dias', async () => {
  const d = deps();
  const s = await criarSessao(d, 'a@exemplo.com');
  assert.match(s.sessao, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(s.sessaoExpiraEm, '2026-12-29T12:00:00.000Z');
  const h = await hashDoToken(s.sessao);
  assert.match(h, /^[0-9a-f]{64}$/);
  const linha = await d.repo.lerSessao(h);
  assert.equal(linha.email, 'a@exemplo.com');
  assert.equal(JSON.stringify(linha).includes(s.sessao), false); // token cru nunca no banco
  assert.notEqual((await criarSessao(d, 'a@exemplo.com')).sessao, s.sessao); // cada login, um token
});

await ta('validarSessao: válida devolve o e-mail; lixo, vazio e vencida dão MSG_SESSAO_EXPIRADA', async () => {
  const d = deps();
  const { sessao } = await criarSessao(d, 'a@exemplo.com');
  const v = await validarSessao(d, sessao);
  assert.equal(v.ok, true);
  assert.equal(v.email, 'a@exemplo.com');
  for (const ruim of ['', undefined, null, 123, 'lixo']) assert.deepEqual(await validarSessao(d, ruim), { ok: false, erro: MSG_SESSAO_EXPIRADA });
  d.avancar(91 * DIA);
  assert.deepEqual(await validarSessao(d, sessao), { ok: false, erro: MSG_SESSAO_EXPIRADA });
});

await ta('renovação: dentro do mesmo dia não grava; depois de 1 dia empurra para agora + 90 dias', async () => {
  const d = deps();
  const { sessao } = await criarSessao(d, 'a@exemplo.com');
  const h = await hashDoToken(sessao);
  let gravacoes = 0;
  const renovar = d.repo.renovarSessao;
  d.repo.renovarSessao = async (...a) => { gravacoes++; return renovar(...a); };
  d.avancar(3 * 3600000);
  await validarSessao(d, sessao);
  assert.equal(gravacoes, 0);
  d.avancar(DIA);
  const v = await validarSessao(d, sessao);
  assert.equal(gravacoes, 1);
  assert.equal(v.expiraEm, new Date(new Date('2026-09-30T12:00:00.000Z').getTime() + DIA + 3 * 3600000 + 90 * DIA).toISOString());
  assert.equal((await d.repo.lerSessao(h)).expira_em, v.expiraEm);
  // quem usa pelo menos a cada 3 meses nunca sai: 89 dias depois ainda vale
  d.avancar(89 * DIA);
  assert.equal((await validarSessao(d, sessao)).ok, true);
});

await ta('banco fora do ar ao conferir: MSG_SESSAO_SEM_BANCO (não é "expirou"); falha ao renovar não derruba', async () => {
  const d = deps();
  const { sessao } = await criarSessao(d, 'a@exemplo.com');
  d.repo.renovarSessao = async () => { throw new Error('sessoes: timeout'); };
  d.avancar(2 * DIA);
  assert.equal((await validarSessao(d, sessao)).ok, true);
  d.repo.lerSessao = async () => { throw new Error('sessoes: connection reset'); };
  assert.deepEqual(await validarSessao(d, sessao), { ok: false, erro: MSG_SESSAO_SEM_BANCO });
});

await ta('criarSessao limpa as vencidas daquele e-mail; encerrarSessao apaga só aquela', async () => {
  const d = deps();
  const velha = await criarSessao(d, 'a@exemplo.com');
  d.avancar(91 * DIA);
  const nova = await criarSessao(d, 'a@exemplo.com');
  assert.equal(await d.repo.lerSessao(await hashDoToken(velha.sessao)), null);
  const outra = await criarSessao(d, 'a@exemplo.com');
  await encerrarSessao(d, nova.sessao);
  await encerrarSessao(d, 'lixo'); // não falha
  assert.equal((await validarSessao(d, nova.sessao)).ok, false);
  assert.equal((await validarSessao(d, outra.sessao)).ok, true);
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/sessoes.test.mjs`
Expected: erro de import (`sessoes.js` não existe).

- [ ] **Step 3: Implementar**

`backend/sessoes.js`:
```js
// Sessão própria do app (spec 2026-09-30-sessao-do-app-design.md). O Google só prova quem a pessoa é NO LOGIN; depois
// disso o servidor confia nesta sessão, que dura 90 dias e se renova a cada uso. Antes, o app usava o ID Token do
// Google (vence em 1 h) e a renovação silenciosa falhava muito no celular: a pessoa se sentia deslogada toda hora.
// O banco guarda só o hash SHA-256 do token: quem ler a tabela não consegue usar a sessão de ninguém.
// Só APIs que existem no Node e no Deno (crypto global, TextEncoder, btoa): este arquivo vai para a Edge Function.
export const MSG_SESSAO_EXPIRADA = 'Sua sessão expirou. Entre com o Google de novo.';
// falha do BANCO não é sessão vencida: o app não pode deslogar a pessoa por uma queda de um instante
export const MSG_SESSAO_SEM_BANCO = 'Não foi possível conferir sua sessão agora. Tente de novo.';

const DIA_MS = 24 * 60 * 60 * 1000;
const DURACAO_MS = 90 * DIA_MS;
const RENOVAR_A_CADA_MS = DIA_MS; // não grava no banco a cada clique: no máximo uma renovação por dia

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashDoToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function criarSessao({ repo, relogio }, email) {
  const agora = relogio();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const sessao = base64url(bytes);
  const expira = new Date(agora.getTime() + DURACAO_MS).toISOString();
  await repo.apagarSessoesVencidas(email, agora.toISOString()); // limpeza sem tarefa agendada
  await repo.inserirSessao({
    token_hash: await hashDoToken(sessao), email,
    criada_em: agora.toISOString(), expira_em: expira, renovada_em: agora.toISOString()
  });
  return { sessao, sessaoExpiraEm: expira };
}

export async function validarSessao({ repo, relogio }, token) {
  if (!token || typeof token !== 'string') return { ok: false, erro: MSG_SESSAO_EXPIRADA };
  const hash = await hashDoToken(token);
  let linha;
  try {
    linha = await repo.lerSessao(hash);
  } catch (e) {
    return { ok: false, erro: MSG_SESSAO_SEM_BANCO };
  }
  if (!linha) return { ok: false, erro: MSG_SESSAO_EXPIRADA };
  const agora = relogio();
  if (new Date(linha.expira_em).getTime() <= agora.getTime()) return { ok: false, erro: MSG_SESSAO_EXPIRADA };
  let expiraEm = new Date(linha.expira_em).toISOString();
  if (agora.getTime() - new Date(linha.renovada_em).getTime() >= RENOVAR_A_CADA_MS) {
    const nova = new Date(agora.getTime() + DURACAO_MS).toISOString();
    try {
      await repo.renovarSessao(hash, { expira_em: nova, renovada_em: agora.toISOString() });
      expiraEm = nova;
    } catch (e) { /* renovar é bônus: a sessão continua valendo até a validade antiga */ }
  }
  return { ok: true, email: linha.email, expiraEm };
}

export async function encerrarSessao({ repo }, token) {
  if (!token || typeof token !== 'string') return;
  await repo.apagarSessao(await hashDoToken(token));
}
```

- [ ] **Step 4: Rodar, registrar na suíte, conferir o preparar-edge**

Acrescentar `node tests/backend/sessoes.test.mjs && ` depois de `repo-sessoes.test.mjs && ` em `package.json`.
Run: `node tests/backend/sessoes.test.mjs && npm run preparar-edge`
Expected: `TODOS OS TESTES PASSARAM`; preparar-edge copia sem apontar problema em `sessoes.js`.

- [ ] **Step 5: Commit**

```bash
git add backend/sessoes.js tests/backend/sessoes.test.mjs package.json
git commit -m "sessões: criar, validar (renova 1x por dia) e encerrar"
```

---

### Task 3: Backend usa a sessão (porteiro, check-in, login, conta, remoção)

**Files:**
- Modify: `backend/porteiro.js` (exporta `identificar`; `autorizar` usa)
- Modify: `backend/handler.js` (check-in usa `identificar`; ações `minhaConta`, `sair`, `sairDeTodosOsAparelhos`)
- Modify: `backend/usuarios.js` (`loginGoogle` cria sessão; `removerUsuario` apaga sessões; ações de conta)
- Modify: `tests/backend/paridade-usuarios.test.mjs` (normalizar ignora `sessao`, `sessaoExpiraEm`)
- Test: `tests/backend/handler-sessao.test.mjs` (criar) + `package.json`

**Interfaces:**
- Consumes: `criarSessao`, `validarSessao`, `encerrarSessao`, `MSG_SESSAO_EXPIRADA` (Task 2); `repo.apagarSessoesDe` (Task 1).
- Produces:
  - `identificar(deps, body) → Promise<{ ok: true, email, nome, via: 'sessao'|'google' } | { ok: false, erro }>` em `backend/porteiro.js`
  - resposta de `loginGoogle` ganha `sessao` e `sessaoExpiraEm`
  - ações POST: `minhaConta` → `{ status:'ok', email, nome, perfil, jogadorId, jogadorIdPendente, sessaoExpiraEm }`; `sair` → `{ status:'ok' }`; `sairDeTodosOsAparelhos` → `{ status:'ok' }`

- [ ] **Step 1: Teste que falha**

`tests/backend/handler-sessao.test.mjs`:
```js
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const AGORA = new Date('2026-09-30T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, // admin, vinculado a p1
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' }, // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }  // jogador
};
const EXPIROU = { error: 'Sua sessão expirou. Entre com o Google de novo.' };

function novo() {
  const repo = criarRepoMemoria(structuredClone(fixture));
  let chamadasGoogle = 0;
  const verificarToken = async (t) => { chamadasGoogle++; return TOKENS[t] || { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' }; };
  const h = criarHandler({ repo, config: { adminPassword: 'chave-de-teste' }, verificarToken, relogio: () => AGORA });
  return { h, repo, google: () => chamadasGoogle };
}
async function logar(h, tok) { return (await h.post({ action: 'loginGoogle', idToken: tok })).sessao; }

await ta('loginGoogle devolve sessão e validade de 90 dias', async () => {
  const { h } = novo();
  const r = await h.post({ action: 'loginGoogle', idToken: 'tok-b' });
  assert.equal(r.perfil, 'organizador');
  assert.match(r.sessao, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.sessaoExpiraEm, '2026-12-29T15:00:00.000Z');
});

await ta('com sessão, ações sensíveis e check-in funcionam SEM falar com o Google', async () => {
  const { h, google } = novo();
  const sessao = await logar(h, 'tok-b');
  const antes = google();
  assert.deepEqual(await h.post({ action: 'addPlayer', sessao, player: { id: 'p9', nome: 'Zé', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
  assert.equal((await h.post({ action: 'addCheckin', sessao, checkin: { id: 'k9', data: '2026-10-06', jogadorId: 'p9', jogadorNome: 'Zé' } })).error, undefined);
  assert.equal((await h.post({ action: 'ping', sessao })).perfil, 'organizador');
  assert.equal(google(), antes);
});

await ta('perfil vem da tabela a cada ação: promover vale sem novo login; jogador continua sem permissão', async () => {
  const { h } = novo();
  const sc = await logar(h, 'tok-c');
  assert.equal((await h.post({ action: 'addPlayer', sessao: sc, player: { id: 'p8', nome: 'X' } })).error, 'Seu perfil (jogador) não tem permissão para esta ação.');
  const sa = await logar(h, 'tok-a');
  await h.post({ action: 'salvarUsuario', sessao: sa, usuario: { email: 'c@exemplo.com', perfil: 'organizador' } });
  assert.deepEqual(await h.post({ action: 'addPlayer', sessao: sc, player: { id: 'p8', nome: 'X' } }), { status: 'ok' });
});

await ta('sessão inválida/vencida sem idToken: "sessão expirou"; com idToken válido, cai no Google (app antigo)', async () => {
  const { h } = novo();
  assert.deepEqual(await h.post({ action: 'ping', sessao: 'lixo' }), EXPIROU);
  assert.deepEqual(await h.post({ action: 'addCheckin', sessao: 'lixo', checkin: { id: 'k1', data: '2026-10-06', jogadorId: 'p1' } }), EXPIROU);
  assert.equal((await h.post({ action: 'ping', sessao: 'lixo', idToken: 'tok-a' })).perfil, 'admin');
  assert.equal((await h.post({ action: 'ping', idToken: 'tok-a' })).perfil, 'admin'); // sem sessão: como hoje
});

await ta('chave mestra errada + sessão válida cai para a sessão (como hoje com idToken)', async () => {
  const { h } = novo();
  const sessao = await logar(h, 'tok-b');
  assert.equal((await h.post({ action: 'ping', senha: 'errada', sessao })).perfil, 'organizador');
  assert.deepEqual(await h.post({ action: 'ping', senha: 'errada' }), { error: 'Senha de administrador incorreta.' });
});

await ta('minhaConta devolve dados atuais; sair encerra só aquela sessão', async () => {
  const { h } = novo();
  const s1 = await logar(h, 'tok-a');
  const s2 = await logar(h, 'tok-a');
  const conta = await h.post({ action: 'minhaConta', sessao: s1 });
  assert.equal(conta.status, 'ok');
  assert.equal(conta.email, 'a@exemplo.com');
  assert.equal(conta.perfil, 'admin');
  assert.equal(conta.jogadorId, 'p1');
  assert.ok(conta.sessaoExpiraEm);
  assert.deepEqual(await h.post({ action: 'sair', sessao: s1 }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'minhaConta', sessao: s1 }), EXPIROU);
  assert.equal((await h.post({ action: 'minhaConta', sessao: s2 })).status, 'ok');
  assert.deepEqual(await h.post({ action: 'sair', sessao: 'lixo' }), { status: 'ok' }); // sair nunca "falha"
});

await ta('sairDeTodosOsAparelhos derruba todas as sessões daquele e-mail, e só dele', async () => {
  const { h } = novo();
  const a1 = await logar(h, 'tok-a');
  const a2 = await logar(h, 'tok-a');
  const b1 = await logar(h, 'tok-b');
  assert.deepEqual(await h.post({ action: 'sairDeTodosOsAparelhos', sessao: a1 }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'ping', sessao: a2 }), EXPIROU);
  assert.equal((await h.post({ action: 'ping', sessao: b1 })).perfil, 'organizador');
  assert.deepEqual(await h.post({ action: 'sairDeTodosOsAparelhos', sessao: 'lixo' }), EXPIROU);
});

await ta('admin remove um usuário: as sessões dele deixam de valer (não vira "jogador")', async () => {
  const { h } = novo();
  const sc = await logar(h, 'tok-c');
  const sa = await logar(h, 'tok-a');
  assert.deepEqual(await h.post({ action: 'removerUsuario', sessao: sa, email: 'c@exemplo.com' }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'ping', sessao: sc }), EXPIROU);
  assert.deepEqual(await h.post({ action: 'addCheckin', sessao: sc, checkin: { id: 'k2', data: '2026-10-06', jogadorId: 'p1' } }), EXPIROU);
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/handler-sessao.test.mjs`
Expected: FALHAs (`sessao` indefinida no login; "Sem token de login" nas ações com sessão).

- [ ] **Step 3: `identificar` no porteiro e uso em `autorizar`**

Em `backend/porteiro.js`, importar e acrescentar antes de `autorizar`:
```js
import { validarSessao, MSG_SESSAO_EXPIRADA } from './sessoes.js';

// Quem é a pessoa. Sessão do app primeiro (banco, sem falar com o Google); senão o ID Token do Google, como antes
// (mantém funcionando o app antigo que ainda está em cache no celular). O nome, na sessão, vem da tabela usuarios.
export async function identificar(deps, body) {
  if (body.sessao) {
    const s = await validarSessao(deps, body.sessao);
    let erro = s.erro;
    if (s.ok) {
      const usuario = (await lerUsuarios(deps.repo)).find((u) => u.email === s.email);
      if (usuario) return { ok: true, email: s.email, nome: usuario.nome || '', via: 'sessao' };
      erro = MSG_SESSAO_EXPIRADA; // conta removida por um admin depois que a sessão foi criada
    }
    if (!body.idToken) return { ok: false, erro };
  }
  const token = await deps.verificarToken(body.idToken);
  return token.ok ? { ...token, via: 'google' } : token;
}
```

Em `autorizar`, trocar os dois `!body.idToken` por `!(body.idToken || body.sessao)` e o bloco "2) token do Google" por:
```js
  // 2) sessão do app ou token do Google
  const token = await identificar({ repo, config, verificarToken, limitador, relogio }, body);
  if (!token.ok) return { error: token.erro };
```
e mudar a assinatura para receber `relogio`: `export async function autorizar({ repo, config, verificarToken, limitador, relogio }, body, contexto = {})`. Os dois `return { ok: true, perfil, email: token.email, nome: token.nome, ... }` ficam iguais.

- [ ] **Step 4: Check-in e ações de conta no handler**

Em `backend/handler.js`: importar `identificar` de `./porteiro.js` (junto de `autorizar`) e `minhaConta, sair, sairDeTodosOsAparelhos` de `./usuarios.js`. No bloco do check-in, trocar:
```js
          const token = await verificarToken(b.idToken);
```
por
```js
          const token = await identificar(deps, b); // sessão do app ou token do Google
```
E logo antes do comentário "check-in não pede senha nem perfil", acrescentar:
```js
        // conta da própria pessoa: só com sessão do app (nunca com chave mestra, que não identifica ninguém)
        if (acao === 'minhaConta') return await minhaConta(deps, b);
        if (acao === 'sair') return await sair(deps, b);
        if (acao === 'sairDeTodosOsAparelhos') return await sairDeTodosOsAparelhos(deps, b);
```

- [ ] **Step 5: `usuarios.js` — login cria sessão, remoção apaga, ações de conta**

Importar no topo: `import { criarSessao, validarSessao, encerrarSessao, MSG_SESSAO_EXPIRADA } from './sessoes.js';`

Em `loginGoogle`, guardar o retorno em vez de devolver direto e acrescentar a sessão nos dois ramos:
```js
  if (existente) {
    if (existente.nome !== token.nome && token.nome) {
      await gravar(repo, relogio, { email: existente.email, nome: token.nome, perfil: existente.perfil, jogadorId: existente.jogadorId });
    }
    return {
      status: 'ok', email: existente.email, nome: token.nome || existente.nome,
      perfil: existente.perfil || 'jogador', jogadorId: existente.jogadorId, jogadorIdPendente: existente.jogadorIdPendente,
      sugestao: (existente.jogadorId || existente.jogadorIdPendente) ? null : await sugerirJogador(repo, token.nome),
      primeiroLogin: false, totalUsuarios: usuarios.length,
      ...(await criarSessao({ repo, relogio }, existente.email)) // o Google provou quem é: a partir daqui vale a sessão do app
    };
  }

  await gravar(repo, relogio, { email: token.email, nome: token.nome, perfil: 'jogador', jogadorId: '' });
  return {
    status: 'ok', email: token.email, nome: token.nome, perfil: 'jogador', jogadorId: '', jogadorIdPendente: '',
    sugestao: await sugerirJogador(repo, token.nome), primeiroLogin: true, totalUsuarios: usuarios.length + 1,
    ...(await criarSessao({ repo, relogio }, token.email))
  };
```
Em `removerUsuario`, depois da linha que remove o usuário do repositório (`await repo.removerUsuario(alvo)`), acrescentar:
```js
  await repo.apagarSessoesDe(alvo); // sem isso a pessoa removida seguiria usando o app como "jogador" até a sessão vencer
```
No fim do arquivo:
```js
// Ações da própria conta (sessão do app obrigatória).
export async function minhaConta({ repo, relogio }, body) {
  const s = await validarSessao({ repo, relogio }, body.sessao);
  if (!s.ok) return { error: s.erro };
  const u = (await lerUsuarios(repo)).find((x) => x.email === s.email);
  if (!u) return { error: MSG_SESSAO_EXPIRADA };
  return { status: 'ok', email: u.email, nome: u.nome, perfil: u.perfil || 'jogador', jogadorId: u.jogadorId, jogadorIdPendente: u.jogadorIdPendente, sessaoExpiraEm: s.expiraEm };
}
// sair nunca "falha" para quem chama: se a sessão já não existe, o objetivo (não estar logado) já foi atingido
export async function sair({ repo }, body) {
  await encerrarSessao({ repo }, body.sessao);
  return { status: 'ok' };
}
export async function sairDeTodosOsAparelhos({ repo, relogio }, body) {
  const s = await validarSessao({ repo, relogio }, body.sessao);
  if (!s.ok) return { error: s.erro };
  await repo.apagarSessoesDe(s.email);
  return { status: 'ok' };
}
```

- [ ] **Step 6: Paridade com o `.gs` ignora os campos novos**

Em `tests/backend/paridade-usuarios.test.mjs`, dentro da função `normalizar` (antes do `return`), apagar as chaves novas do objeto recebido:
```js
  // sessão do app (2026-09-30) só existe no backend novo: o .gs não tem equivalente
  if (x && typeof x === 'object') { delete x.sessao; delete x.sessaoExpiraEm; }
```
(ajustar o nome da variável ao parâmetro que `normalizar` já usa).

- [ ] **Step 7: Rodar tudo**

Acrescentar `node tests/backend/handler-sessao.test.mjs && ` em `package.json` depois de `sessoes.test.mjs && `.
Run: `node tests/backend/handler-sessao.test.mjs && npm run test:backend && npm run preparar-edge`
Expected: tudo `TODOS OS TESTES PASSARAM`; nenhuma regressão (usuarios, paridade-usuarios, handler-etapa3*, checkins).

- [ ] **Step 8: Commit**

```bash
git add backend/porteiro.js backend/handler.js backend/usuarios.js tests/backend/handler-sessao.test.mjs tests/backend/paridade-usuarios.test.mjs package.json
git commit -m "sessões: porteiro, check-in, login, conta e remoção passam a usar a sessão do app"
```

---

### Task 4: Front usa a sessão (credencial, login, sincronização, sem renovar o Google)

**Files:**
- Modify: `volei-dashboard.html` (bloco LOGIN COM GOOGLE, `requireAuth`, `postAction`, `uploadPhoto`, `carregarUsuarios`, os 2 pontos de check-in, inicialização)
- Test: `tests/sessao-front.test.js` (criar); rodar também `tests/perfil-autossincroniza.test.js` e `tests/renovacao-token.test.js` (podem precisar de ajuste mínimo se extraírem trechos alterados)

**Interfaces:**
- Consumes: backend da Task 3 (`loginGoogle` com `sessao`, `minhaConta`, `sair`, mensagens exatas).
- Produces (usadas na Task 5):
  - `AUTH.sessao: string`, `AUTH.sessaoExpiraEm: string` (ISO), persistidas em `volei-auth-v1`
  - `async function credencialLogada(): Promise<{ sessao, idToken, senha } | null>`
  - `function sessaoExpirou(msg): boolean` (msg contém "sessão expirou")
  - `function tratarSessaoExpirada(): void` (limpa a conta local sem chamar o servidor e avisa com toast)

- [ ] **Step 1: Teste que falha**

`tests/sessao-front.test.js` (extrai do HTML o trecho entre os marcadores `// <sessao-front>` e `// </sessao-front>` que a Step 3 cria):
```js
// Sessão do app no front. Extrai o código do HTML. Rodar: node tests/sessao-front.test.js  (HTML_ARQUIVO=<caminho> p/ o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <sessao-front>');
const fim = html.indexOf('// </sessao-front>');
assert.ok(ini > -1 && fim > ini, 'bloco <sessao-front> não encontrado');
const bloco = html.slice(ini, fim);

function amb({ auth, garantir = async () => null, respostas = [] } = {}) {
  const posts = [], toasts = [];
  let saiu = 0;
  const F = new Function('AUTH', 'garantirTokenFresco', 'respostas', 'posts', 'toasts', 'marcarSaida', `
    const SHEET_API_URL = 'x'; const sheetReady = true; const console = { error(){} };
    const fetch = async (u, o) => { const b = JSON.parse(o.body); posts.push(b); const r = respostas.shift(); if (r === 'rede') throw new TypeError('Failed to fetch'); return { json: async () => r || { status: 'ok' } }; };
    const mostrarToast = (m) => toasts.push(m);
    const salvarSessaoAuth = () => {}; const atualizarStatusAuth = () => {}; const aplicarPermissoesUI = () => {}; const renderAll = () => {};
    const sairDaConta = () => { marcarSaida(); AUTH.logado = false; AUTH.sessao = ''; };
    ${bloco}
    return { credencialLogada, sessaoExpirou, tratarSessaoExpirada, sincronizarContaComServidor };`);
  const api = F(auth, garantir, respostas, posts, toasts, () => { saiu++; });
  return { ...api, posts, toasts, saidas: () => saiu, auth };
}

(async () => {
  // com sessão: credencial é a sessão, sem pedir nada ao Google
  let chamouGoogle = false;
  let a = amb({ auth: { logado: true, sessao: 'S1', idToken: '' }, garantir: async () => { chamouGoogle = true; return 'G'; } });
  assert.deepEqual(await a.credencialLogada(), { sessao: 'S1', idToken: '', senha: '' });
  assert.equal(chamouGoogle, false);
  // sem sessão (app antigo): cai no token do Google, como antes
  a = amb({ auth: { logado: true, sessao: '', idToken: 'G' }, garantir: async () => 'G2' });
  assert.deepEqual(await a.credencialLogada(), { sessao: '', idToken: 'G2', senha: '' });
  // deslogado / Google não renovou: null
  assert.equal(await amb({ auth: { logado: false } }).credencialLogada(), null);
  assert.equal(await amb({ auth: { logado: true, sessao: '' } }).credencialLogada(), null);

  assert.equal(a.sessaoExpirou('Sua sessão expirou. Entre com o Google de novo.'), true);
  assert.equal(a.sessaoExpirou('Não foi possível conferir sua sessão agora. Tente de novo.'), false);
  assert.equal(a.sessaoExpirou(undefined), false);

  // sincronização com sessão usa minhaConta e atualiza o perfil
  a = amb({ auth: { logado: true, sessao: 'S1', perfil: 'jogador', jogadorId: '', jogadorIdPendente: '' }, respostas: [{ status: 'ok', perfil: 'admin', jogadorId: 'p1', jogadorIdPendente: '', nome: 'A', sessaoExpiraEm: '2026-12-29T15:00:00.000Z' }] });
  await a.sincronizarContaComServidor();
  assert.equal(a.posts[0].action, 'minhaConta');
  assert.equal(a.posts[0].sessao, 'S1');
  assert.equal(a.auth.perfil, 'admin');
  assert.equal(a.auth.sessaoExpiraEm, '2026-12-29T15:00:00.000Z');
  // sessão expirou na sincronização: sai da conta localmente (uma vez) e avisa
  a = amb({ auth: { logado: true, sessao: 'S1' }, respostas: [{ error: 'Sua sessão expirou. Entre com o Google de novo.' }] });
  await a.sincronizarContaComServidor();
  assert.equal(a.saidas(), 1);
  assert.equal(a.toasts.length, 1);
  // banco fora do ar / rede caiu: NÃO sai da conta
  for (const r of [{ error: 'Não foi possível conferir sua sessão agora. Tente de novo.' }, 'rede']) {
    a = amb({ auth: { logado: true, sessao: 'S1' }, respostas: [r] });
    await a.sincronizarContaComServidor();
    assert.equal(a.saidas(), 0);
    assert.equal(a.auth.sessao, 'S1');
  }
  // migração: logado só com idToken ainda válido troca por sessão via loginGoogle, em silêncio
  a = amb({ auth: { logado: true, sessao: '', idToken: 'G', exp: Math.floor(Date.now() / 1000) + 1800 }, respostas: [{ status: 'ok', perfil: 'organizador', jogadorId: '', jogadorIdPendente: '', sessao: 'NOVA', sessaoExpiraEm: '2026-12-29T15:00:00.000Z' }] });
  await a.sincronizarContaComServidor();
  assert.equal(a.posts[0].action, 'loginGoogle');
  assert.equal(a.auth.sessao, 'NOVA');
  // idToken vencido e sem sessão: não chama nada (a pessoa entra de novo pelo botão)
  a = amb({ auth: { logado: true, sessao: '', idToken: 'G', exp: 1 } });
  await a.sincronizarContaComServidor();
  assert.equal(a.posts.length, 0);
  console.log('ok — sessão do app no front');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/sessao-front.test.js`
Expected: `bloco <sessao-front> não encontrado`.

- [ ] **Step 3: Bloco `<sessao-front>` no HTML**

Em `volei-dashboard.html`, apagar a função `sincronizarContaComServidor` atual (com o comentário "Bug real (2026-09): AUTH.jogadorId...") e, no mesmo lugar, colocar:
```js
// <sessao-front>
/* Sessão do app (spec 2026-09-30): o Google só entra no LOGIN; depois toda gravação manda AUTH.sessao, que o servidor
   confere no banco e renova sozinho (90 dias a cada uso). Só quem ainda não tem sessão (app antigo, login de antes da
   v14.0) continua no caminho velho do token do Google. */
function sessaoExpirou(msg){ return String(msg || '').toLowerCase().includes('sessão expirou'); }
function tratarSessaoExpirada(){
  sairDaConta(true);
  mostrarToast('Sua sessão expirou. Toque em "Entrar com Google" pra continuar.', 'erro');
}
async function credencialLogada(){
  if(!AUTH.logado) return null;
  if(AUTH.sessao) return { sessao: AUTH.sessao, idToken: '', senha: '' };
  const token = await garantirTokenFresco();
  return token ? { sessao: '', idToken: token, senha: '' } : null;
}
function aplicarDadosDaConta(json){
  const mudou = (json.perfil||'jogador') !== AUTH.perfil || (json.jogadorId||'') !== AUTH.jogadorId || (json.jogadorIdPendente||'') !== AUTH.jogadorIdPendente;
  AUTH.perfil = json.perfil || 'jogador';
  AUTH.jogadorId = json.jogadorId || '';
  AUTH.jogadorIdPendente = json.jogadorIdPendente || '';
  AUTH.nome = json.nome || AUTH.nome;
  if(json.sessao) AUTH.sessao = json.sessao;
  if(json.sessaoExpiraEm) AUTH.sessaoExpiraEm = json.sessaoExpiraEm;
  salvarSessaoAuth();
  if(mudou){ atualizarStatusAuth(); aplicarPermissoesUI(); renderAll(); }
}
/* Reconfere a conta com o servidor ao abrir o app (perfil/vínculo podem ter mudado em outro aparelho). Com sessão: ação
   minhaConta. Sem sessão mas com token do Google ainda válido: loginGoogle, que devolve uma sessão (migração silenciosa
   de quem logou antes da v14.0). Nunca abre popup; só sai da conta se o SERVIDOR disser que a sessão expirou — falha de
   rede ou do banco mantém a pessoa logada. */
async function sincronizarContaComServidor(){
  if(!AUTH.logado || !sheetReady) return;
  let corpo;
  if(AUTH.sessao) corpo = { action:'minhaConta', sessao: AUTH.sessao };
  else if(AUTH.idToken && AUTH.exp && (AUTH.exp * 1000 - Date.now()) > 120000) corpo = { action:'loginGoogle', idToken: AUTH.idToken };
  else return;
  try{
    const res = await fetch(SHEET_API_URL, { method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body: JSON.stringify(corpo) });
    const json = await res.json();
    if(json && json.error){
      if(AUTH.sessao && sessaoExpirou(json.error)) tratarSessaoExpirada();
      return;
    }
    if(json) aplicarDadosDaConta(json);
  }catch(e){
    console.error('Falha ao sincronizar a conta (silencioso; tenta de novo ao reabrir)', e);
  }
}
// </sessao-front>
```

- [ ] **Step 4: Rodar o teste do bloco**

Run: `node tests/sessao-front.test.js`
Expected: `ok — sessão do app no front`.

- [ ] **Step 5: Ligar a sessão no resto do HTML**

1. Objeto `AUTH` (perto de "Quem está logado com conta Google agora"): acrescentar `sessao: '', sessaoExpiraEm: '',` e trocar o comentário por: `/* Quem está logado. Desde a v14.0 a prova de identidade é AUTH.sessao (sessão do app, 90 dias renovando a cada uso); o idToken do Google só é usado no login e por quem ainda não tem sessão. 'logado' falso = visitante anônimo. */`
2. `salvarSessaoAuth`: incluir `sessao: AUTH.sessao, sessaoExpiraEm: AUTH.sessaoExpiraEm` no objeto gravado.
3. `restaurarSessaoAuth`: trocar `if(!s || !s.idToken) return;` por `if(!s || (!s.idToken && !s.sessao)) return;`.
4. `sairDaConta(silencioso)`: logo no início, antes de zerar `AUTH`:
   ```js
   // avisa o servidor pra apagar esta sessão (melhor esforço: sem internet, o aparelho sai mesmo assim)
   if(AUTH.sessao && sheetReady){
     fetch(SHEET_API_URL, { method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body: JSON.stringify({ action:'sair', sessao: AUTH.sessao }) }).catch(()=>{});
   }
   ```
   e no objeto que zera `AUTH` acrescentar `sessao:'', sessaoExpiraEm:''`. (Em `tratarSessaoExpirada` a sessão já não existe no servidor; o `sair` extra é inofensivo.)
5. `loginComGoogle`: depois de `AUTH.nome = json.nome || AUTH.nome;` acrescentar `AUTH.sessao = json.sessao || ''; AUTH.sessaoExpiraEm = json.sessaoExpiraEm || '';` (antes do `salvarSessaoAuth()` que já existe). Trocar o texto do `alert` de erro de conexão já corrigido na v13.6 (não mexer).
6. `handleGoogleCredential` (ramo `AUTH.aoRenovar`): sem mudança.
7. Renovação do Google só sem sessão: em `tentarRenovarSeNecessario` trocar a condição por `if(AUTH.logado && !AUTH.sessao && tokenExpirado(300)) renovarTokenGoogle();` e no `setInterval` por `if(AUTH.logado && !AUTH.sessao && tokenExpirado(900)) renovarTokenGoogle();`.
8. `requireAuth`: trocar
   ```js
    const token = await garantirTokenFresco();
    if(token) return { idToken: token, senha: '' };
   ```
   por
   ```js
    const cred = await credencialLogada();
    if(cred) return cred;
   ```
   e nos três `return { idToken: AUTH.idToken || '', senha: ... }` do resto da função acrescentar `sessao: AUTH.sessao || '',`.
9. `postAction`: no corpo, depois de `idToken: (cred && cred.idToken) || '',` acrescentar `sessao: (cred && cred.sessao) || '',`. No tratamento de erro, ANTES do `else if(erro.includes('login do google'))`, acrescentar:
   ```js
      } else if(sessaoExpirou(json.error)){
        tratarSessaoExpirada();
   ```
   (a mensagem "Não foi possível conferir sua sessão agora" cai no `else` genérico: toast, sem sair).
10. `uploadPhoto`: no `JSON.stringify` acrescentar `sessao: (cred && cred.sessao) || ''`.
11. `carregarUsuarios(silencioso)`: no ramo silencioso, trocar a linha `else if(AUTH.logado && !tokenExpirado(120)) cred = { idToken: AUTH.idToken, senha: '' };` por:
    ```js
    else if(AUTH.logado && AUTH.sessao) cred = { sessao: AUTH.sessao, idToken: '', senha: '' };
    else if(AUTH.logado && !tokenExpirado(120)) cred = { idToken: AUTH.idToken, senha: '' };
    ```
    e no `fetch` acrescentar `sessao: cred.sessao || ''` ao corpo; na linha `senha: senha` do mesmo ramo, acrescentar `sessao: AUTH.sessao || ''`.
12. Os dois pontos de check-in (`add-checkin-guest-btn` e os botões `[data-checkin-btn]`): trocar `const token = await garantirTokenFresco(); if(!token) return;` por `const cred = await credencialLogada(); if(!cred) return;` e cada `{idToken: token, senha:''}` por `cred`.
13. `pedirBootstrapAdmin`: sem mudança (usa o `idToken` recém-emitido no login).

- [ ] **Step 6: Validar**

Run (Git Bash, na raiz do repo; `$T` = scratchpad da sessão):
```bash
python3 -c "
import re,sys
c=open('volei-dashboard.html',encoding='utf-8').read()
m=re.search(r'<script>(.*)</script>',c,re.S)
open(sys.argv[1]+'/check.js','w',encoding='utf-8').write(m.group(1))
" "$T" && node --check "$T/check.js"
node tests/sessao-front.test.js && node tests/perfil-autossincroniza.test.js && node tests/renovacao-token.test.js && node tests/leitura-inicial.test.js && node tests/jogadores-removidos.test.js
grep -n "garantirTokenFresco()" volei-dashboard.html
```
Expected: sintaxe ok; testes ok. Se `perfil-autossincroniza`/`renovacao-token` falharem por extrair uma função que mudou de lugar ou de corpo, ajustar o TESTE para o novo contrato (mesmas garantias: sincroniza sem popup; nunca desloga por falha de renovação) — não enfraquecer o que ele verifica. O grep deve mostrar `garantirTokenFresco()` só dentro de `credencialLogada`.

- [ ] **Step 7: Commit**

```bash
git add volei-dashboard.html tests/sessao-front.test.js tests/perfil-autossincroniza.test.js tests/renovacao-token.test.js
git commit -m "Terça: front passa a usar a sessão do app (sem renovar o Google a cada hora)"
```

---

### Task 5: Área de conta no app

**Files:**
- Modify: `volei-dashboard.html` (clique no chip do usuário; topo do "Meu Perfil"; rodapé `Ver.: 14.0`; changelog se a aba Novidades listar versões)
- Test: acrescentar casos em `tests/sessao-front.test.js`

**Interfaces:**
- Consumes: `AUTH.sessao`, `AUTH.sessaoExpiraEm`, `AUTH.email`, `AUTH.perfil`, `sairDaConta`, `tratarSessaoExpirada`, `sessaoExpirou` (Task 4).
- Produces: `function textoValidadeSessao(iso): string` e `async function sairDeTodosOsAparelhos(): Promise<boolean>` (dentro do bloco `<sessao-front>`), `function abrirAreaDaConta()`.

- [ ] **Step 1: Testes que falham** — acrescentar ao `return` do `new Function` em `tests/sessao-front.test.js` as funções `textoValidadeSessao, sairDeTodosOsAparelhos` e, antes do `console.log` final:
```js
  assert.equal(a.textoValidadeSessao(''), '');
  assert.match(a.textoValidadeSessao('2026-12-29T15:00:00.000Z'), /^Conectado neste aparelho até \d{2}\/\d{2}\/\d{4}$/);
  // sair de todos: manda a ação certa e sai deste aparelho também
  a = amb({ auth: { logado: true, sessao: 'S1' }, respostas: [{ status: 'ok' }] });
  assert.equal(await a.sairDeTodosOsAparelhos(), true);
  assert.equal(a.posts[0].action, 'sairDeTodosOsAparelhos');
  assert.equal(a.saidas(), 1);
  // servidor fora do ar: não sai e avisa (a pessoa tenta de novo)
  a = amb({ auth: { logado: true, sessao: 'S1' }, respostas: ['rede'] });
  assert.equal(await a.sairDeTodosOsAparelhos(), false);
  assert.equal(a.saidas(), 0);
  assert.equal(a.toasts.length, 1);
```
Run: `node tests/sessao-front.test.js` → Expected: FALHA (`textoValidadeSessao is not a function`).

- [ ] **Step 2: Implementar dentro de `<sessao-front>`** (antes de `// </sessao-front>`):
```js
function textoValidadeSessao(iso){
  if(!iso) return '';
  return 'Conectado neste aparelho até ' + new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
}
// derruba a sessão em TODOS os aparelhos (celular perdido, computador emprestado); este aparelho sai junto
async function sairDeTodosOsAparelhos(){
  try{
    const res = await fetch(SHEET_API_URL, { method:'POST', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body: JSON.stringify({ action:'sairDeTodosOsAparelhos', sessao: AUTH.sessao }) });
    const json = await res.json();
    if(json && json.error && !sessaoExpirou(json.error)){ mostrarToast('Não deu: ' + json.error, 'erro'); return false; }
    sairDaConta(true);
    renderAll();
    return true;
  }catch(e){
    mostrarToast('Sem conexão com o servidor agora. Tente de novo.', 'erro');
    return false;
  }
}
```
Run: `node tests/sessao-front.test.js` → Expected: ok.

- [ ] **Step 3: Tela da conta** — trocar o listener do chip:
```js
document.getElementById('auth-user-chip').addEventListener('click', ()=>{
  if(confirm('Sair da conta ' + (AUTH.email || '') + '?')) sairDaConta(false);
});
```
por:
```js
document.getElementById('auth-user-chip').addEventListener('click', abrirAreaDaConta);
// Área da conta: quem está conectado, até quando, e os dois jeitos de sair. Mesmo visual dos outros modais
// (profile-overlay + password-card), z-index já acima dos modais do app.
function abrirAreaDaConta(){
  const overlay = document.createElement('div');
  overlay.className = 'profile-overlay';
  const validade = textoValidadeSessao(AUTH.sessaoExpiraEm);
  overlay.innerHTML = `
    <div class="password-card">
      <p class="password-title">Sua conta</p>
      <p style="margin:0 0 4px;">${escapeHtml(AUTH.email || '')}</p>
      <p style="margin:0 0 4px;color:var(--muted);font-size:13px;">Perfil: ${escapeHtml((AUTH.perfil || 'jogador').toUpperCase())}</p>
      ${validade ? `<p style="margin:0 0 12px;color:var(--muted);font-size:13px;">${validade}</p>` : ''}
      <div class="password-actions">
        <button class="btn danger" data-acao="sair">Sair</button>
        ${AUTH.sessao ? '<button class="btn secondary" data-acao="todos">Sair de todos os aparelhos</button>' : ''}
        <button class="btn secondary" data-acao="fechar">Fechar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', async (e)=>{
    const acao = e.target.dataset && e.target.dataset.acao;
    if(e.target !== overlay && !acao) return;
    if(acao === 'todos' && !confirm('Sair desta conta em TODOS os aparelhos (celular, computador...)?')) return;
    overlay.remove();
    if(acao === 'sair') sairDaConta(false);
    else if(acao === 'todos') await sairDeTodosOsAparelhos();
  });
}
```
No "Meu Perfil": localizar a função que renderiza a tela (`grep -n "function renderMeuPerfil" volei-dashboard.html`) e, no topo do HTML que ela monta, acrescentar uma linha com `escapeHtml(AUTH.email)` + `textoValidadeSessao(AUTH.sessaoExpiraEm)` e um botão `<button class="btn secondary" id="meuperfil-conta-btn">Gerenciar conta</button>`; depois de montar, `document.getElementById('meuperfil-conta-btn')?.addEventListener('click', abrirAreaDaConta);`.

- [ ] **Step 4: Versão** — rodapé `Ver.: 13.6 ·` → `Ver.: 14.0 ·`. Se a aba de novidades/changelog do app tiver entradas por versão (`grep -n "13.6\|13.5" volei-dashboard.html`), acrescentar uma entrada 14.0: "Login que não cai: entre com o Google uma vez por aparelho e fique conectado até tocar em Sair."

- [ ] **Step 5: Validar e commit** — rodar o Step 6 da Task 4 de novo (sintaxe + todos os testes de front) e `npm run test:backend`.
```bash
git add volei-dashboard.html tests/sessao-front.test.js
git commit -m "Terça v14.0: área da conta (sair, sair de todos os aparelhos, validade da sessão)"
```

---

### Task 6: Publicar o Terça (com o usuário)

- [ ] **Step 1:** Pedir ao usuário para rodar `sql/schema-terca-supabase-ajuste-8.sql` no SQL Editor do Supabase (projeto `lzwmirrjpoqucwlhgkku`).
- [ ] **Step 2:** Pedir ao usuário: `npm run preparar-edge` e `npx supabase functions deploy terca-api-teste --no-verify-jwt --project-ref lzwmirrjpoqucwlhgkku` (o classificador bloqueia esse comando para o agente).
- [ ] **Step 3:** Conferir, sem gravar nada: GET da função responde normal (`curl -H "Origin: https://libertsapp.github.io" <url>`); POST `{"action":"minhaConta","sessao":"lixo"}` responde exatamente `{"error":"Sua sessão expirou. Entre com o Google de novo."}` (prova que a função nova está no ar e a tabela existe; se vier "Não foi possível conferir sua sessão agora", o SQL não foi rodado).
- [ ] **Step 4:** Com OK do usuário, `git pull --rebase` + `git push`.
- [ ] **Step 5:** Pedir ao usuário o teste real no celular: entrar com Google; fechar o app; voltar depois de mais de 1 hora; salvar algo (check-in ou editar jogador) — não pode pedir Google de novo. Tocar no chip → "Sua conta" → Sair.

### Task 7: Meme (SÓ com autorização explícita)

- [ ] **Step 1:** Criar `sql/meme/ajuste-8-sessoes-meme.sql` = o ajuste 8 com `create table if not exists meme.sessoes`, `create index if not exists sessoes_email_idx on meme.sessoes (email)` e `alter table meme.sessoes enable row level security`; acrescentar `schema-terca-supabase-ajuste-8.sql` em `ARQUIVOS_DO_TERCA` de `scripts/gerar-sql-grupo.js` e rodar `npm run gerar-sql-meme` (instalação do zero fica completa); rodar `node tests/backend/gerar-sql-grupo.test.mjs`.
- [ ] **Step 2:** Usuário roda o SQL do Step 1 no SQL Editor; depois `npm run preparar-edge -- meme-api` e `npx supabase functions deploy meme-api --no-verify-jwt --project-ref lzwmirrjpoqucwlhgkku`.
- [ ] **Step 3:** Replicar o HTML por merge de 3 vias (receita na memória "replicar-terca-para-meme": base = `git show <commit v13.6>:volei-dashboard.html`, ours = `../voleimeme/index.html`, theirs = Terça atual, tudo em LF; gravar o Meme de volta em CRLF; só a linha `Ver.:` deve conflitar).
- [ ] **Step 4:** Validar sintaxe do Meme; `HTML_ARQUIVO=<caminho do index.html do Meme>` para `sessao-front`, `leitura-inicial`, `jogadores-removidos`, `perfil-autossincroniza`, `renovacao-token`; procurar vazamento de "Terça".
- [ ] **Step 5:** Commit + push no `voleimeme`; conferir `minhaConta` com `sessao: "lixo"` na `meme-api`.
