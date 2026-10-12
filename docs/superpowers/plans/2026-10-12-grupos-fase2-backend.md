# Grupos independentes — Fase 2 (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma Edge Function `grupos-api` que atende qualquer grupo pelo apelido (GET `?g=<apelido>`, POST com `grupo`), cria grupos novos (`criarGrupo`), verifica endereço livre (`verificarApelido`), aplica o teto de jogadores e guarda as fotos numa pasta por grupo — usando o handler de sempre por cima do repositório multigrupo da Fase 1.

**Architecture:** `backend/grupos-api.js` é uma casca fina: resolve o apelido → grupo (cadastro), monta o `criarHandler` de sempre com `criarRepoMultigrupo(cliente, grupo.id)`, armazenamento com prefixo do grupo e `liga: { grupoId: apelido }`, e delega. As ações que existem ANTES de haver grupo (`verificarApelido`, `criarGrupo`) vivem só nela, com limite por IP numa tabela global. O cadastro (`backend/cadastro-grupos.js`) fala com `grupos.grupos`/`limites` e as funções SQL `criar_grupo`/`apelido_disponivel`/`registrar_tentativa_global`; uma versão em memória (`cadastro-grupos-memoria.js`) serve aos testes.

**Tech Stack:** Node 24 (ESM, `node:assert`, `tests/backend/executor.mjs`), Deno Edge Function, supabase-js v2, Postgres/plpgsql (PGlite opcional nos testes).

**Spec:** `docs/superpowers/specs/2026-10-12-grupos-independentes-design.md`

## Global Constraints

- Executar na branch `grupos-fase1` (a Fase 1 ainda não foi mesclada) — esta fase continua em cima dela.
- `sql/grupos/schema-grupos.sql` AINDA NÃO FOI RODADO no Supabase: as adições desta fase entram no próprio arquivo (sem "ajuste" separado).
- Nada de HTML, nada do Terça/Meme em produção. `supabase/functions/terca-api-teste/` e `meme-api/` não mudam. A única mudança em código compartilhado é `backend/edge.js` (o GET passa a repassar a query; quem ignora o argumento continua igual).
- Módulos de `backend/` sem `node:`, `process.`, `require(`, `Buffer`; só importam `./arquivo.js`.
- Mensagens ao usuário em português. Códigos de erro do cadastro: `apelido_invalido`, `apelido_reservado`, `apelido_em_uso`, `limite_por_email` (vindos do `criar_grupo` da Fase 1).
- Grupo inexistente → `{ error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' }`; suspenso → `{ error: 'Grupo indisponível.', codigo: 'grupo_suspenso' }`.
- Limite por IP: criar grupo = `limites.max_criacoes_por_ip_hora` (3) por hora; verificar apelido = 120 por hora. Teto de jogadores = `limites.max_jogadores_por_grupo` (150), contando só jogadores ativos (sem convidados nem removidos).
- Foto: o teto de 300 KB já é imposto por `backend/fotos.js` (igual a `max_foto_kb`); esta fase NÃO lê `max_foto_kb` (desvio consciente: mesmo valor, evita uma leitura por envio).
- Testes: `npm run test:backend`; cada arquivo novo entra no script.
- Publicar a função e rodar o SQL são passos do USUÁRIO (documentados na Task 6); o executor não publica nada.

## Review Focus

1. **Apelido em maiúscula ou com espaço no endereço** (`?g=Quinta `): resolve o mesmo grupo `quinta`. Testado na Task 5.
2. **Pessoa logada num grupo tentando agir em outro** (mesmo token Google, `grupo` trocado no corpo): lá ela é só "jogador" (ou desconhecida) e as ações de organizador são recusadas; a sessão do app de um grupo não vale no outro. Testado na Task 5.
3. **Grupo recém-criado acessado na hora** (cache): aparece imediatamente na mesma instância; o cache nunca guarda "não existe". Testado na Task 5.
4. **Foto antiga de outro grupo** (`fileIdAntigo` com barra ou caminho alheio): nunca é apagada; o armazenamento só apaga dentro da pasta do próprio grupo. Testado na Task 3.
5. **Corpo do `criarGrupo` sem token, com dados inválidos ou repetido do mesmo IP**: mensagens claras, nada criado, limite por IP aplicado mesmo nas tentativas que falham. Testado na Task 5.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `sql/grupos/schema-grupos.sql` (modificar) | `limite_global`, `registrar_tentativa_global`, `apelido_disponivel` |
| `backend/cadastro-grupos.js` (novo) | Cadastro no Supabase: ler grupo/limites, apelido livre, criar grupo (com tradução dos erros), limite global |
| `backend/cadastro-grupos-memoria.js` (novo) | Mesma interface em memória (testes): emula `criar_grupo` e guarda um repositório por grupo |
| `backend/armazenamento-grupo.js` (novo) | Armazenamento de fotos com prefixo `<grupo_id>/` |
| `backend/edge.js` (modificar) | GET repassa `{ consulta }` ao handler |
| `backend/grupos-api.js` (novo) | Roteamento por apelido, `verificarApelido`, `criarGrupo`, teto de jogadores, delegação ao handler |
| `supabase/functions/grupos-api/index.ts` (novo) | Casca Deno da função |
| `docs/superpowers/grupos-deploy.md` (novo) | Passos do usuário (SQL, schema exposto, bucket, segredos, deploy) |
| testes novos em `tests/backend/` | um por módulo (ver tasks) |

---

### Task 1: SQL — limite global e "apelido livre?"

**Files:**
- Modify: `sql/grupos/schema-grupos.sql` (acrescentar no fim)
- Modify: `tests/backend/sql-grupos.test.mjs` (antes do `fim()`)
- Modify: `tests/backend/sql-grupos-pglite.test.mjs` (antes do `console.log` final)

**Interfaces:**
- Produces (SQL, schema `grupos`): tabela `limite_global(chave text pk, tentativas, bloqueado_ate, atualizado_em)`; `registrar_tentativa_global(p_chave text, p_max int, p_janela_seg int, p_bloqueio_seg int) returns boolean` (true = pode seguir); `apelido_disponivel(p_apelido text) returns boolean` (false se em uso em `grupos`, em `liga.grupos` ou reservado; compara em minúsculas sem espaços nas pontas).

- [ ] **Step 1: Testes (falham)**

Em `tests/backend/sql-grupos.test.mjs`, antes de `fim();`:

```js
t('limite global (antes de existir grupo) e apelido_disponivel, só para a service_role', () => {
  assert.match(sql, /create table limite_global \(\n  chave text primary key,/);
  assert.match(sql, /alter table limite_global enable row level security;/);
  assert.match(sql, /grant select, insert, update, delete on limite_global to service_role;/);
  assert.match(sql, /create or replace function registrar_tentativa_global\(p_chave text, p_max int, p_janela_seg int, p_bloqueio_seg int\) returns boolean/);
  assert.match(sql, /create or replace function apelido_disponivel\(p_apelido text\) returns boolean/);
  for (const assinatura of ['registrar_tentativa_global\\(text, int, int, int\\)', 'apelido_disponivel\\(text\\)']) {
    assert.match(sql, new RegExp('revoke execute on function ' + assinatura + ' from public, anon, authenticated;'));
    assert.match(sql, new RegExp('grant execute on function ' + assinatura + ' to service_role;'));
  }
  const corpo = sql.match(/create or replace function apelido_disponivel[\s\S]*?\n\$\$;/)[0];
  for (const fonte of ['from grupos', 'from liga.grupos', 'from apelidos_reservados']) assert.ok(corpo.includes(fonte), fonte);
});
```

Em `tests/backend/sql-grupos-pglite.test.mjs`, antes da última linha (`console.log(process.exitCode ? ...`):

```js
// Fase 2: limite global e apelido livre
const g1 = (await db.query("select grupos.registrar_tentativa_global('criar:1.2.3.4', 1, 3600, 3600) as ok")).rows[0].ok;
const g2 = (await db.query("select grupos.registrar_tentativa_global('criar:1.2.3.4', 1, 3600, 3600) as ok")).rows[0].ok;
const g3 = (await db.query("select grupos.registrar_tentativa_global('criar:5.6.7.8', 1, 3600, 3600) as ok")).rows[0].ok;
(g1 && !g2 && g3 ? ok : falha)('limite global por chave (IP)');
const livre = async (a) => (await db.query('select grupos.apelido_disponivel($1) as ok', [a])).rows[0].ok;
(!(await livre('quinta')) && !(await livre(' QUINTA ')) && !(await livre('terca')) && !(await livre('admin')) && (await livre('domingo')) ? ok : falha)('apelido_disponivel: em uso, da liga, reservado, livre');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/sql-grupos.test.mjs`
Expected: 1 FALHA (o teste novo).

- [ ] **Step 3: Acrescentar no fim de `sql/grupos/schema-grupos.sql`**

```sql
-- ======================================================================= Fase 2: antes de existir grupo
-- verificarApelido e criarGrupo acontecem ANTES de haver grupo: o limite por IP fica numa tabela sem grupo_id
create table limite_global (
  chave text primary key,
  tentativas int not null default 0,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table limite_global enable row level security;
grant select, insert, update, delete on limite_global to service_role;

-- mesma regra do registrar_tentativa (Terça, ajuste 7), sem grupo: true = pode seguir
create or replace function registrar_tentativa_global(p_chave text, p_max int, p_janela_seg int, p_bloqueio_seg int) returns boolean
language plpgsql set search_path = grupos as $$
declare
  v_permitido boolean;
begin
  delete from limite_global
   where atualizado_em < now() - interval '1 day'
     and (bloqueado_ate is null or bloqueado_ate < now())
     and chave <> p_chave;
  insert into limite_global as l (chave, tentativas, bloqueado_ate, atualizado_em)
  values (p_chave, 1, null, now())
  on conflict (chave) do update set
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

-- "esse endereço está livre?" — a mesma checagem que o criar_grupo faz, para a tela responder enquanto a pessoa digita
create or replace function apelido_disponivel(p_apelido text) returns boolean
language plpgsql stable set search_path = grupos as $$
declare
  v text := lower(btrim(coalesce(p_apelido, '')));
begin
  return not exists (select 1 from grupos where apelido = v)
     and not exists (select 1 from liga.grupos where id = v)
     and not exists (select 1 from apelidos_reservados where apelido = v);
end;
$$;

revoke execute on function registrar_tentativa_global(text, int, int, int) from public, anon, authenticated;
revoke execute on function apelido_disponivel(text) from public, anon, authenticated;
grant execute on function registrar_tentativa_global(text, int, int, int) to service_role;
grant execute on function apelido_disponivel(text) to service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/sql-grupos.test.mjs && node tests/backend/sql-grupos-pglite.test.mjs`
Expected: o primeiro `TODOS OS TESTES PASSARAM`; o segundo `PULADO` (sem PGlite) — se houver PGlite à mão (`PGLITE_MODULO=...`), rodar também com ele e esperar `TODOS OS TESTES PASSARAM` (27 conferências).

- [ ] **Step 5: Commit**

```bash
git add sql/grupos/schema-grupos.sql tests/backend/sql-grupos.test.mjs tests/backend/sql-grupos-pglite.test.mjs
git commit -m "feat(grupos): limite global por IP e apelido_disponivel no SQL"
```

---

### Task 2: Cadastro de grupos (Supabase + memória)

**Files:**
- Create: `backend/cadastro-grupos.js`
- Create: `backend/cadastro-grupos-memoria.js`
- Create: `tests/backend/cadastro-grupos.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: funções SQL da Task 1 e `criar_grupo` (Fase 1); `validarApelido`, `APELIDOS_RESERVADOS` (`backend/grupos-cadastro.js`); `criarRepoMemoria` (`backend/repo-memoria.js`); `criarRepoLigaMemoria().tabelas.grupos`.
- Produces (as duas implementações, mesma interface):
  - `lerGrupoPorApelido(apelido) -> Promise<null | { id, apelido, nome, cidade, uf, cor_destaque, logo_url, plano, status, dono_email }>`
  - `lerLimites() -> Promise<{ max_grupos_por_email, max_jogadores_por_grupo, max_foto_kb, max_criacoes_por_ip_hora }>`
  - `apelidoDisponivel(apelido) -> Promise<boolean>`
  - `registrarTentativaGlobal(chave, max, janelaSeg, bloqueioSeg) -> Promise<boolean>`
  - `criarGrupo({ apelido, nome, cidade, uf, cor, email, nomeDono }) -> Promise<string /* id */>`; erro de regra lança `ErroCadastro` com `.codigo` ∈ os 4 códigos.
- Produces: `ErroCadastro`, `LIMITES_PADRAO`, `codigoDoErro(error)` (de `cadastro-grupos.js`); `criarCadastroMemoria({ grupos?, limites?, repoLiga?, agoraMs? })` com, além da interface, `repoDoGrupo(grupoId)` e `.grupos` (array, para os testes).

- [ ] **Step 1: Testes (falham)**

Criar `tests/backend/cadastro-grupos.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { criarCadastroSupabase, codigoDoErro, ErroCadastro, LIMITES_PADRAO } from '../../backend/cadastro-grupos.js';
import { criarCadastroMemoria } from '../../backend/cadastro-grupos-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';
import { clienteGravador } from './cliente-gravador.mjs';

const NOVO = { apelido: 'quinta', nome: 'Vôlei de Quinta', cidade: 'Belo Horizonte', uf: 'MG', cor: '#ffd700', email: 'dono@x.com', nomeDono: 'Dono' };

t('codigoDoErro: reconhece os 4 códigos do criar_grupo e o unique (corrida de apelido)', () => {
  assert.equal(codigoDoErro({ message: 'apelido_em_uso' }), 'apelido_em_uso');
  assert.equal(codigoDoErro({ message: 'P0001: limite_por_email' }), 'limite_por_email');
  assert.equal(codigoDoErro({ code: '23505', message: 'duplicate key value violates unique constraint "grupos_apelido_key"' }), 'apelido_em_uso');
  assert.equal(codigoDoErro({ code: '42P01', message: 'relation does not exist' }), null);
});

// ---- Supabase (cliente falso) ----
function clienteResposta(respostas) {
  const c = clienteGravador();
  const rpcOriginal = c.rpc;
  c.rpc = (nome, params) => { rpcOriginal(nome, params); return Promise.resolve(respostas[nome] || { data: null, error: null }); };
  return c;
}

await ta('supabase: criarGrupo chama criar_grupo com os parâmetros certos e devolve o id', async () => {
  const c = clienteResposta({ criar_grupo: { data: 'uuid-1', error: null } });
  const id = await criarCadastroSupabase(c).criarGrupo(NOVO);
  assert.equal(id, 'uuid-1');
  assert.deepEqual(c.ops[0], { verbo: 'rpc', nome: 'criar_grupo', filtros: [], params: {
    p_apelido: 'quinta', p_nome: 'Vôlei de Quinta', p_cidade: 'Belo Horizonte', p_uf: 'MG', p_cor: '#ffd700', p_dono_email: 'dono@x.com', p_dono_nome: 'Dono'
  } });
});

await ta('supabase: erro de regra vira ErroCadastro com código; erro técnico sobe com a dica do SQL', async () => {
  const regra = criarCadastroSupabase(clienteResposta({ criar_grupo: { data: null, error: { code: 'P0001', message: 'apelido_reservado' } } }));
  await assert.rejects(regra.criarGrupo(NOVO), (e) => e instanceof ErroCadastro && e.codigo === 'apelido_reservado');
  const tecnico = criarCadastroSupabase(clienteResposta({ criar_grupo: { data: null, error: { code: '42883', message: 'function does not exist' } } }));
  await assert.rejects(tecnico.criarGrupo(NOVO), /criar_grupo: function does not exist.*schema-grupos\.sql/);
});

await ta('supabase: apelidoDisponivel e registrarTentativaGlobal chamam as funções da Task 1', async () => {
  const c = clienteResposta({ apelido_disponivel: { data: true, error: null }, registrar_tentativa_global: { data: false, error: null } });
  const cad = criarCadastroSupabase(c);
  assert.equal(await cad.apelidoDisponivel('quinta'), true);
  assert.equal(await cad.registrarTentativaGlobal('criar:1.2.3.4', 3, 3600, 3600), false);
  assert.deepEqual(c.ops.map((o) => [o.nome, o.params]), [
    ['apelido_disponivel', { p_apelido: 'quinta' }],
    ['registrar_tentativa_global', { p_chave: 'criar:1.2.3.4', p_max: 3, p_janela_seg: 3600, p_bloqueio_seg: 3600 }]
  ]);
});

await ta('supabase: lerGrupoPorApelido filtra pelo apelido; lerLimites cai no padrão sem linha', async () => {
  const c = clienteGravador();
  const cad = criarCadastroSupabase(c);
  assert.deepEqual(await cad.lerGrupoPorApelido('quinta'), null); // cliente falso devolve data: [] → nenhuma linha
  assert.deepEqual(c.ops[0].filtros, [['eq', 'apelido', 'quinta']]);
  assert.deepEqual(await cad.lerLimites(), LIMITES_PADRAO);
});

// ---- memória ----
await ta('memória: criarGrupo cria cadastro, repositório com o dono admin e linha na liga', async () => {
  const repoLiga = criarRepoLigaMemoria({ grupos: [{ id: 'terca', nome: 'Vôlei de Terça' }] });
  const cad = criarCadastroMemoria({ repoLiga });
  const id = await cad.criarGrupo(NOVO);
  const g = await cad.lerGrupoPorApelido('quinta');
  assert.equal(g.id, id);
  assert.equal(g.status, 'ativo');
  const usuarios = await cad.repoDoGrupo(id).lerUsuarios();
  assert.deepEqual(usuarios.map((u) => [u.email, u.perfil]), [['dono@x.com', 'admin']]);
  assert.ok(repoLiga.tabelas.grupos.some((l) => l.id === 'quinta' && l.cidade === 'Belo Horizonte' && l.uf === 'MG'));
});

await ta('memória: mesmas regras do criar_grupo (em uso, na liga, reservado, inválido, 1 por e-mail)', async () => {
  const repoLiga = criarRepoLigaMemoria({ grupos: [{ id: 'terca', nome: 'Vôlei de Terça' }] });
  const cad = criarCadastroMemoria({ repoLiga });
  await cad.criarGrupo(NOVO);
  const codigo = (p) => cad.criarGrupo({ ...NOVO, ...p }).then(() => 'criou', (e) => e.codigo);
  assert.equal(await codigo({ email: 'outro@x.com' }), 'apelido_em_uso');
  assert.equal(await codigo({ apelido: 'terca', email: 'outro@x.com' }), 'apelido_em_uso');
  assert.equal(await codigo({ apelido: 'admin', email: 'outro@x.com' }), 'apelido_reservado');
  assert.equal(await codigo({ apelido: 'Qu Inta', email: 'outro@x.com' }), 'apelido_invalido');
  assert.equal(await codigo({ apelido: 'sabado', email: 'DONO@x.com' }), 'limite_por_email');
  assert.equal(cad.grupos.length, 1);
  assert.equal(await cad.apelidoDisponivel('quinta'), false);
  assert.equal(await cad.apelidoDisponivel('terca'), false);
  assert.equal(await cad.apelidoDisponivel('domingo'), true);
});

await ta('memória: limite global por chave e janela', async () => {
  let agora = 0;
  const cad = criarCadastroMemoria({ agoraMs: () => agora });
  assert.equal(await cad.registrarTentativaGlobal('criar:ip', 2, 3600, 3600), true);
  assert.equal(await cad.registrarTentativaGlobal('criar:ip', 2, 3600, 3600), true);
  assert.equal(await cad.registrarTentativaGlobal('criar:ip', 2, 3600, 3600), false);
  assert.equal(await cad.registrarTentativaGlobal('criar:outro', 2, 3600, 3600), true);
  agora = 7300 * 1000; // passou a janela e o bloqueio
  assert.equal(await cad.registrarTentativaGlobal('criar:ip', 2, 3600, 3600), true);
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/cadastro-grupos.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND` (`backend/cadastro-grupos.js`).

- [ ] **Step 3: Implementar `backend/cadastro-grupos.js`**

```js
// Cadastro dos grupos independentes no Supabase (schema "grupos"): o que existe ANTES ou ACIMA de um grupo — achar o
// grupo pelo apelido, os limites do plano grátis, "esse endereço está livre?", criar o grupo e o limite por IP de quem
// ainda não tem grupo. O cliente recebido deve apontar para o schema "grupos" e NÃO ter escopo de grupo.
const DICA = ' (rode sql/grupos/schema-grupos.sql no SQL Editor do Supabase e exponha o schema "grupos")';
const CODIGOS = ['apelido_invalido', 'apelido_reservado', 'apelido_em_uso', 'limite_por_email'];

export const LIMITES_PADRAO = { max_grupos_por_email: 1, max_jogadores_por_grupo: 150, max_foto_kb: 300, max_criacoes_por_ip_hora: 3 };

export class ErroCadastro extends Error {
  constructor(codigo) { super(codigo); this.codigo = codigo; }
}

// o criar_grupo lança exceção com a mensagem-código; dois criando o mesmo apelido ao mesmo tempo caem no unique (23505)
export function codigoDoErro(error) {
  const msg = String((error && error.message) || '');
  const achado = CODIGOS.find((c) => msg.includes(c));
  if (achado) return achado;
  if (error && error.code === '23505') return 'apelido_em_uso';
  return null;
}

export function criarCadastroSupabase(cliente) {
  const falha = (onde, error) => new Error(onde + ': ' + error.message + DICA);
  return {
    async lerGrupoPorApelido(apelido) {
      const { data, error } = await cliente.from('grupos').select('*').eq('apelido', apelido).maybeSingle();
      if (error) throw falha('grupos', error);
      return data && !Array.isArray(data) ? data : null;
    },
    async lerLimites() {
      const { data, error } = await cliente.from('limites').select('*').limit(1).maybeSingle();
      if (error) throw falha('limites', error);
      return data && !Array.isArray(data) ? { ...LIMITES_PADRAO, ...data } : { ...LIMITES_PADRAO };
    },
    async apelidoDisponivel(apelido) {
      const { data, error } = await cliente.rpc('apelido_disponivel', { p_apelido: apelido });
      if (error) throw falha('apelido_disponivel', error);
      return data === true;
    },
    async registrarTentativaGlobal(chave, max, janelaSeg, bloqueioSeg) {
      const { data, error } = await cliente.rpc('registrar_tentativa_global', { p_chave: chave, p_max: max, p_janela_seg: janelaSeg, p_bloqueio_seg: bloqueioSeg });
      if (error) throw falha('registrar_tentativa_global', error);
      return data === true;
    },
    async criarGrupo({ apelido, nome, cidade, uf, cor, email, nomeDono }) {
      const { data, error } = await cliente.rpc('criar_grupo', {
        p_apelido: apelido, p_nome: nome, p_cidade: cidade, p_uf: uf, p_cor: cor, p_dono_email: email, p_dono_nome: nomeDono
      });
      if (error) {
        const codigo = codigoDoErro(error);
        if (codigo) throw new ErroCadastro(codigo);
        throw falha('criar_grupo', error);
      }
      return data;
    }
  };
}
```

- [ ] **Step 4: Implementar `backend/cadastro-grupos-memoria.js`**

```js
// Cadastro dos grupos em memória (testes): mesma interface do cadastro-grupos.js e as MESMAS regras do criar_grupo do
// SQL. Guarda um repositório em memória por grupo (repoDoGrupo), já com o dono como admin — é o papel que, no
// Supabase, as tabelas do schema "grupos" com grupo_id fazem.
import { criarRepoMemoria } from './repo-memoria.js';
import { APELIDOS_RESERVADOS } from './grupos-cadastro.js';
import { ErroCadastro, LIMITES_PADRAO } from './cadastro-grupos.js';

const FORMATO = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export function criarCadastroMemoria({ grupos = [], limites = {}, repoLiga, agoraMs = () => Date.now() } = {}) {
  const lista = grupos.map((g) => ({ status: 'ativo', plano: 'gratis', ...g }));
  const lim = { ...LIMITES_PADRAO, ...limites };
  const repos = new Map(lista.map((g) => [g.id, criarRepoMemoria({})]));
  const baldes = new Map(); // chave -> { tentativas, bloqueadoAte, atualizado }
  let seq = 0;
  const naLiga = (a) => !!repoLiga && repoLiga.tabelas.grupos.some((l) => l.id === a);

  return {
    grupos: lista,
    limites: lim,
    repoDoGrupo(grupoId) {
      if (!repos.has(grupoId)) throw new Error('grupo inexistente em memória: ' + grupoId);
      return repos.get(grupoId);
    },
    async lerGrupoPorApelido(apelido) { const g = lista.find((x) => x.apelido === apelido); return g ? { ...g } : null; },
    async lerLimites() { return { ...lim }; },
    async apelidoDisponivel(apelido) {
      const a = String(apelido || '').trim().toLowerCase();
      return !lista.some((g) => g.apelido === a) && !naLiga(a) && !APELIDOS_RESERVADOS.includes(a);
    },
    // mesma regra do registrar_tentativa_global: conta dentro da janela; estourou, bloqueia pelo tempo do bloqueio
    async registrarTentativaGlobal(chave, max, janelaSeg, bloqueioSeg) {
      const agora = agoraMs();
      const b = baldes.get(chave);
      if (b && b.bloqueadoAte && b.bloqueadoAte > agora) return false;
      const zerar = !b || b.atualizado < agora - janelaSeg * 1000 || (b.bloqueadoAte && b.bloqueadoAte <= agora);
      const n = zerar ? 1 : b.tentativas + 1;
      const bloqueadoAte = n > max ? agora + bloqueioSeg * 1000 : null;
      baldes.set(chave, { tentativas: n, bloqueadoAte, atualizado: agora });
      return bloqueadoAte === null;
    },
    async criarGrupo({ apelido, nome, cidade, uf, cor, email, nomeDono }) {
      const a = String(apelido || '').trim().toLowerCase();
      const e = String(email || '').trim().toLowerCase();
      if (!FORMATO.test(a) || a.includes('--')) throw new ErroCadastro('apelido_invalido');
      if (APELIDOS_RESERVADOS.includes(a)) throw new ErroCadastro('apelido_reservado');
      if (lista.some((g) => g.apelido === a) || naLiga(a)) throw new ErroCadastro('apelido_em_uso');
      if (lista.filter((g) => g.dono_email === e).length >= lim.max_grupos_por_email) throw new ErroCadastro('limite_por_email');
      const id = 'grupo-' + (++seq);
      lista.push({ id, apelido: a, nome, cidade, uf, cor_destaque: String(cor).toLowerCase(), logo_url: null, plano: 'gratis', status: 'ativo', dono_email: e });
      repos.set(id, criarRepoMemoria({ usuarios: [{ email: e, nome: nomeDono || '', perfil: 'admin', jogador_id: null, jogador_id_pendente: null, criado_em: new Date(agoraMs()).toISOString(), ordem: 1 }] }));
      if (repoLiga) repoLiga.tabelas.grupos.push({ id: a, nome, cor: String(cor).toLowerCase(), cidade, uf, ativo: true });
      return id;
    }
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node tests/backend/cadastro-grupos.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 6: Acrescentar ao `test:backend` e commit**

Acrescentar ` && node tests/backend/cadastro-grupos.test.mjs` ao `test:backend`.

```bash
git add backend/cadastro-grupos.js backend/cadastro-grupos-memoria.js tests/backend/cadastro-grupos.test.mjs package.json
git commit -m "feat(grupos): cadastro de grupos (Supabase e memória)"
```

---

### Task 3: Fotos numa pasta por grupo

**Files:**
- Create: `backend/armazenamento-grupo.js`
- Create: `tests/backend/armazenamento-grupo.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: armazenamento base `{ enviar(caminho, bytes, tipo) -> url, apagar(caminho) }` (`criarArmazenamentoSupabase`).
- Produces: `armazenamentoDoGrupo(base, grupoId) -> { enviar, apagar }`. A URL devolvida tem `?id=<caminho sem o prefixo>` (é o que `backend/fotos.js` e o front esperam: nomes sem barra).

- [ ] **Step 1: Teste (falha)**

Criar `tests/backend/armazenamento-grupo.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { armazenamentoDoGrupo } from '../../backend/armazenamento-grupo.js';
import { uploadPhoto } from '../../backend/fotos.js';

function baseFalsa() {
  const chamadas = [];
  return {
    chamadas,
    async enviar(caminho) { chamadas.push(['enviar', caminho]); return 'https://x.supabase.co/storage/v1/object/public/fotos-grupos/' + caminho + '?id=' + caminho; },
    async apagar(caminho) { chamadas.push(['apagar', caminho]); }
  };
}

t('exige grupoId', () => assert.throws(() => armazenamentoDoGrupo(baseFalsa(), ''), /grupoId/));

await ta('envia dentro da pasta do grupo e devolve a URL com id SEM o prefixo', async () => {
  const b = baseFalsa();
  const url = await armazenamentoDoGrupo(b, 'g1').enviar('123-abcd.jpg', new Uint8Array([1]), 'image/jpeg');
  assert.deepEqual(b.chamadas, [['enviar', 'g1/123-abcd.jpg']]);
  assert.equal(url, 'https://x.supabase.co/storage/v1/object/public/fotos-grupos/g1/123-abcd.jpg?id=123-abcd.jpg');
});

await ta('apaga só dentro da própria pasta; caminho com barra (de outro grupo) é recusado', async () => {
  const b = baseFalsa();
  const a = armazenamentoDoGrupo(b, 'g1');
  await a.apagar('123-abcd.jpg');
  await assert.rejects(a.apagar('g2/999.jpg'), /caminho/);
  await assert.rejects(a.apagar('../g2/999.jpg'), /caminho/);
  assert.deepEqual(b.chamadas, [['apagar', 'g1/123-abcd.jpg']]);
});

await ta('com o uploadPhoto de sempre: foto nova na pasta do grupo e a antiga apagada na mesma pasta', async () => {
  const b = baseFalsa();
  const deps = { armazenamento: armazenamentoDoGrupo(b, 'g1'), relogio: () => new Date('2026-10-12T15:00:00Z'), repo: { lerJogadores: async () => [] } };
  const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 0));
  const r = await uploadPhoto(deps, { perfil: 'organizador' }, { base64: jpeg, fileIdAntigo: '111-aaaa.jpg' });
  assert.match(r.url, /\/fotos-grupos\/g1\/\d+-[0-9a-f]{8}\.jpg\?id=\d+-[0-9a-f]{8}\.jpg$/);
  assert.match(r.fileId, /^\d+-[0-9a-f]{8}\.jpg$/);
  assert.deepEqual(b.chamadas.map((c) => c[0]), ['enviar', 'apagar']);
  assert.equal(b.chamadas[1][1], 'g1/111-aaaa.jpg');
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/armazenamento-grupo.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar `backend/armazenamento-grupo.js`**

```js
// Fotos dos grupos independentes: um bucket só ("fotos-grupos"), uma pasta por grupo (<grupo_id>/arquivo.jpg).
// Embrulha o armazenamento de sempre: envia dentro da pasta do grupo e devolve a URL com "?id=" SEM o prefixo — o
// fotos.js e o front só conhecem nomes sem barra. Apagar só aceita nome sem barra e sempre dentro da própria pasta,
// então um grupo nunca apaga a foto de outro.
export function armazenamentoDoGrupo(base, grupoId) {
  if (!grupoId) throw new Error('armazenamentoDoGrupo: grupoId obrigatório');
  const prefixo = grupoId + '/';
  return {
    async enviar(caminho, bytes, tipo) {
      const url = await base.enviar(prefixo + caminho, bytes, tipo);
      return String(url).replace('?id=' + prefixo, '?id=');
    },
    async apagar(caminho) {
      const c = String(caminho || '');
      if (!c || c.includes('/') || c.includes('..')) throw new Error('armazenamentoDoGrupo: caminho inválido');
      return base.apagar(prefixo + c);
    }
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/armazenamento-grupo.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Acrescentar ao `test:backend` e commit**

Acrescentar ` && node tests/backend/armazenamento-grupo.test.mjs`.

```bash
git add backend/armazenamento-grupo.js tests/backend/armazenamento-grupo.test.mjs package.json
git commit -m "feat(grupos): fotos numa pasta por grupo"
```

---

### Task 4: GET repassa a query ao handler

**Files:**
- Modify: `backend/edge.js` (linha `if (request.method === 'GET') return responder(200, await handler.get());`)
- Create: `tests/backend/edge-consulta.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `handler.get({ consulta })`, onde `consulta` é um objeto com os parâmetros da URL (`?g=quinta` → `{ g: 'quinta' }`). Handlers que não recebem argumento (Terça/Meme) continuam iguais.

- [ ] **Step 1: Teste (falha)**

Criar `tests/backend/edge-consulta.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarEdge } from '../../backend/edge.js';

await ta('GET repassa os parâmetros da URL ao handler (?g=quinta)', async () => {
  let recebido;
  const edge = criarEdge({ handler: { get: async (ctx) => { recebido = ctx; return { ok: 1 }; }, post: async () => ({}) } });
  const r = await edge(new Request('https://x.supabase.co/functions/v1/grupos-api?g=quinta&v=2'));
  assert.equal(r.status, 200);
  assert.deepEqual(recebido, { consulta: { g: 'quinta', v: '2' } });
});

await ta('GET sem parâmetros: consulta vazia (handler antigo, que ignora o argumento, não muda)', async () => {
  let recebido;
  const edge = criarEdge({ handler: { get: async (ctx) => { recebido = ctx; return { players: [] }; }, post: async () => ({}) } });
  const r = await edge(new Request('https://x.supabase.co/functions/v1/terca-api-teste'));
  assert.deepEqual(await r.json(), { players: [] });
  assert.deepEqual(recebido, { consulta: {} });
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/edge-consulta.test.mjs`
Expected: 2 FALHAS (`recebido` é `undefined`).

- [ ] **Step 3: Implementar**

Em `backend/edge.js`, trocar:

```js
      if (request.method === 'GET') return responder(200, await handler.get());
```

por:

```js
      // a query vai junto (grupos independentes: ?g=<apelido>); os handlers do Terça e do Meme ignoram o argumento
      if (request.method === 'GET') return responder(200, await handler.get({ consulta: Object.fromEntries(new URL(request.url).searchParams) }));
```

- [ ] **Step 4: Rodar e ver passar (inclusive os testes antigos do edge)**

Run: `node tests/backend/edge-consulta.test.mjs && node tests/backend/edge.test.mjs && node tests/backend/handler-edge.test.mjs`
Expected: os três `TODOS OS TESTES PASSARAM`.

- [ ] **Step 5: Acrescentar ao `test:backend` e commit**

Acrescentar ` && node tests/backend/edge-consulta.test.mjs`.

```bash
git add backend/edge.js tests/backend/edge-consulta.test.mjs package.json
git commit -m "feat(edge): GET repassa a query ao handler"
```

---

### Task 5: `grupos-api` (roteamento, criação, teto)

**Files:**
- Create: `backend/grupos-api.js`
- Create: `tests/backend/grupos-api.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `criarHandler` (`backend/handler.js`); cadastro (Task 2); `armazenamentoDoGrupo` (Task 3); `handler.get({ consulta })` (Task 4); `validarApelido`, `validarCadastroGrupo`, `normalizarApelido` (`backend/grupos-cadastro.js`); `normalizarIp` (`backend/limitador.js`); `mapearJogadores` (`backend/mapeadores.js`); `ErroDeNegocio`, `MSG_ERRO_INTERNO` (`backend/erros.js`).
- Produces: `criarGruposApi({ cadastro, criarRepoDoGrupo(grupoId), armazenamentoBase?, repoLiga?, verificarToken, relogio?, enviarPush?, avisar?, registrar?, ocultarErrosInternos?, cacheMs? }) -> { get(contexto), post(body, contexto) }`; `MSG_MUITAS_CRIACOES`.
  - GET `{ consulta: { g } }` → o JSON de sempre do grupo + `grupo: { apelido, nome, cidade, uf, cor, logoUrl, plano }`.
  - POST `{ action: 'verificarApelido', apelido }` → `{ status: 'ok', disponivel: boolean, motivo: string }`.
  - POST `{ action: 'criarGrupo', idToken, grupoNovo: { nome, apelido, cidade, uf, cor } }` → `{ status: 'ok', apelido }` ou `{ error, codigo? }`.
  - Qualquer outra ação: `{ action, grupo: '<apelido>', ... }` → delegada ao handler do grupo.

- [ ] **Step 1: Teste (falha)**

Criar `tests/backend/grupos-api.test.mjs`:

```js
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarGruposApi, MSG_MUITAS_CRIACOES } from '../../backend/grupos-api.js';
import { criarCadastroMemoria } from '../../backend/cadastro-grupos-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';

const TOKENS = {
  'tok-dono': { ok: true, email: 'dono@x.com', nome: 'Dono' },
  'tok-outro': { ok: true, email: 'outro@x.com', nome: 'Outro' },
  'tok-terceiro': { ok: true, email: 'terceiro@x.com', nome: 'Terceiro' }
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const NOVO = { nome: 'Vôlei de Quinta', apelido: 'quinta', cidade: 'belo horizonte', uf: 'mg', cor: '#ffd700' };

function mundo(limites = {}) {
  const repoLiga = criarRepoLigaMemoria({ grupos: [{ id: 'terca', nome: 'Vôlei de Terça', cidade: 'Santa Luzia', uf: 'MG' }] });
  const cadastro = criarCadastroMemoria({ repoLiga, limites });
  const api = criarGruposApi({
    cadastro, repoLiga, verificarToken,
    criarRepoDoGrupo: (id) => cadastro.repoDoGrupo(id),
    relogio: () => new Date('2026-10-12T15:00:00.000Z'), enviarPush: async () => {}
  });
  return { api, cadastro, repoLiga };
}
const criar = (api, token, dados, ip = '1.1.1.1') => api.post({ action: 'criarGrupo', idToken: token, grupoNovo: dados }, { ip });
const jogador = (id, nome) => ({ id, nome, apelido: '', foto: '', estrelas: 3, sexo: 'M', porte: '' });

await ta('criarGrupo: cria e o grupo responde na hora pelo apelido, com a identidade', async () => {
  const { api } = mundo();
  assert.deepEqual(await criar(api, 'tok-dono', NOVO), { status: 'ok', apelido: 'quinta' });
  const g = await api.get({ consulta: { g: 'quinta' } });
  assert.deepEqual(g.grupo, { apelido: 'quinta', nome: 'Vôlei de Quinta', cidade: 'Belo Horizonte', uf: 'MG', cor: '#ffd700', logoUrl: '', plano: 'gratis' });
  assert.deepEqual(g.players, []);
  assert.equal(g.liga.grupoId, 'quinta');
  assert.ok(g.liga.grupos.some((x) => x.id === 'terca'));
});

await ta('criarGrupo: sem login, dados inválidos, endereço em uso/reservado, segundo grupo do mesmo e-mail', async () => {
  const { api, cadastro } = mundo();
  assert.deepEqual(await criar(api, '', NOVO), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.deepEqual(await criar(api, 'tok-dono', { ...NOVO, uf: 'XX' }), { error: 'Escolha o estado (UF).' });
  await criar(api, 'tok-dono', NOVO, '2.2.2.2');
  assert.deepEqual(await criar(api, 'tok-outro', NOVO, '3.3.3.3'), { error: 'Esse endereço já está em uso. Escolha outro.', codigo: 'apelido_em_uso' });
  assert.deepEqual(await criar(api, 'tok-outro', { ...NOVO, apelido: 'terca' }, '3.3.3.3'), { error: 'Esse endereço já está em uso. Escolha outro.', codigo: 'apelido_em_uso' });
  assert.match((await criar(api, 'tok-outro', { ...NOVO, apelido: 'admin' }, '4.4.4.4')).error, /reservado/);
  assert.deepEqual(await criar(api, 'tok-dono', { ...NOVO, apelido: 'sabado' }, '5.5.5.5'), { error: 'Por enquanto cada pessoa pode criar 1 grupo.', codigo: 'limite_por_email' });
  assert.equal(cadastro.grupos.length, 1);
});

await ta('criarGrupo: limite por IP conta também as tentativas que falham', async () => {
  const { api } = mundo({ max_criacoes_por_ip_hora: 2 });
  await criar(api, '', NOVO, '9.9.9.9');
  await criar(api, 'tok-dono', { ...NOVO, uf: 'XX' }, '9.9.9.9');
  assert.deepEqual(await criar(api, 'tok-dono', NOVO, '9.9.9.9'), { error: MSG_MUITAS_CRIACOES });
  assert.equal((await criar(api, 'tok-dono', NOVO, '8.8.8.8')).status, 'ok'); // outro IP segue
});

await ta('verificarApelido: inválido, reservado, em uso (inclusive na liga) e livre', async () => {
  const { api } = mundo();
  await criar(api, 'tok-dono', NOVO);
  const v = (apelido) => api.post({ action: 'verificarApelido', apelido }, { ip: '1.1.1.1' });
  assert.equal((await v('Qu Inta')).disponivel, false);
  assert.match((await v('admin')).motivo, /reservado/);
  assert.deepEqual(await v('quinta'), { status: 'ok', disponivel: false, motivo: 'Esse endereço já está em uso. Escolha outro.' });
  assert.equal((await v('terca')).disponivel, false);
  assert.deepEqual(await v('domingo'), { status: 'ok', disponivel: true, motivo: '' });
});

await ta('grupo inexistente, suspenso e apelido com maiúscula/espaço', async () => {
  const { api, cadastro } = mundo();
  await criar(api, 'tok-dono', NOVO);
  assert.deepEqual(await api.get({ consulta: { g: 'nao-existe' } }), { error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' });
  assert.deepEqual(await api.get({}), { error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' });
  assert.equal((await api.get({ consulta: { g: ' Quinta ' } })).grupo.apelido, 'quinta');
  cadastro.grupos[0].status = 'suspenso';
  const api2 = criarGruposApi({ cadastro, verificarToken, criarRepoDoGrupo: (id) => cadastro.repoDoGrupo(id) }); // sem cache antigo
  assert.deepEqual(await api2.get({ consulta: { g: 'quinta' } }), { error: 'Grupo indisponível.', codigo: 'grupo_suspenso' });
  assert.deepEqual(await api2.post({ action: 'addPlayer', grupo: 'quinta', idToken: 'tok-dono', player: jogador('p1', 'Ana') }), { error: 'Grupo indisponível.', codigo: 'grupo_suspenso' });
});

await ta('isolamento: dono de um grupo não é organizador no outro; dados não se misturam', async () => {
  const { api } = mundo();
  await criar(api, 'tok-dono', NOVO);
  await criar(api, 'tok-outro', { ...NOVO, nome: 'Vôlei de Sábado', apelido: 'sabado' }, '2.2.2.2');
  assert.equal((await api.post({ action: 'addPlayer', grupo: 'quinta', idToken: 'tok-dono', player: jogador('p1', 'Ana') })).status, 'ok');
  assert.equal((await api.post({ action: 'addPlayer', grupo: 'sabado', idToken: 'tok-outro', player: jogador('p1', 'Bia') })).status, 'ok');
  assert.deepEqual(await api.post({ action: 'addPlayer', grupo: 'sabado', idToken: 'tok-dono', player: jogador('p2', 'Intrusa') }),
    { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.deepEqual((await api.get({ consulta: { g: 'quinta' } })).players.map((p) => p.nome), ['Ana']);
  assert.deepEqual((await api.get({ consulta: { g: 'sabado' } })).players.map((p) => p.nome), ['Bia']);
});

await ta('sessão do app de um grupo não vale no outro', async () => {
  const { api } = mundo();
  await criar(api, 'tok-dono', NOVO);
  await criar(api, 'tok-outro', { ...NOVO, apelido: 'sabado' }, '2.2.2.2');
  const login = await api.post({ action: 'loginGoogle', grupo: 'quinta', idToken: 'tok-dono' });
  assert.equal(login.perfil, 'admin');
  assert.ok(login.sessao);
  assert.equal((await api.post({ action: 'addPlayer', grupo: 'quinta', sessao: login.sessao, player: jogador('p1', 'Ana') })).status, 'ok');
  const noOutro = await api.post({ action: 'addPlayer', grupo: 'sabado', sessao: login.sessao, player: jogador('p9', 'X') });
  assert.ok(noOutro.error, 'sessão do quinta não pode valer no sabado');
});

await ta('teto de jogadores do plano grátis (só ativos contam)', async () => {
  const { api } = mundo({ max_jogadores_por_grupo: 2 });
  await criar(api, 'tok-dono', NOVO);
  const add = (id) => api.post({ action: 'addPlayer', grupo: 'quinta', idToken: 'tok-dono', player: jogador(id, 'J' + id) });
  assert.equal((await add('p1')).status, 'ok');
  assert.equal((await add('p2')).status, 'ok');
  assert.deepEqual(await add('p3'), { error: 'Este grupo chegou ao limite de 2 jogadores do plano grátis.' });
  assert.equal((await api.post({ action: 'removePlayer', grupo: 'quinta', idToken: 'tok-dono', id: 'p1' })).status, 'ok');
  assert.equal((await add('p3')).status, 'ok'); // removido não conta
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/grupos-api.test.mjs`
Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar `backend/grupos-api.js`**

```js
// Função dos grupos independentes (spec 2026-10-12): atende QUALQUER grupo pelo apelido. O grupo vem de "?g=" no GET e
// do campo "grupo" no POST; daí monta o handler de sempre (check-in, rodadas, financeiro, amistosos...) por cima do
// repositório daquele grupo — o domínio não sabe que existem vários grupos. As duas ações que acontecem ANTES de haver
// grupo (verificarApelido, criarGrupo) vivem só aqui, com limite por IP numa tabela global.
import { criarHandler } from './handler.js';
import { armazenamentoDoGrupo } from './armazenamento-grupo.js';
import { validarApelido, validarCadastroGrupo, normalizarApelido } from './grupos-cadastro.js';
import { normalizarIp } from './limitador.js';
import { mapearJogadores } from './mapeadores.js';
import { ErroDeNegocio, MSG_ERRO_INTERNO } from './erros.js';

export const MSG_MUITAS_CRIACOES = 'Muitas tentativas. Tente de novo mais tarde.';
const MAX_VERIFICACOES_POR_IP_HORA = 120;
const INEXISTENTE = { error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' };
const SUSPENSO = { error: 'Grupo indisponível.', codigo: 'grupo_suspenso' };
const MSG_EM_USO = 'Esse endereço já está em uso. Escolha outro.';
const MENSAGENS = {
  apelido_invalido: 'Use só letras minúsculas, números e hífen no endereço.',
  apelido_reservado: 'Esse endereço é reservado. Escolha outro.',
  apelido_em_uso: MSG_EM_USO,
  limite_por_email: 'Por enquanto cada pessoa pode criar 1 grupo.'
};

export function criarGruposApi({
  cadastro, criarRepoDoGrupo, armazenamentoBase, repoLiga, verificarToken, relogio = () => new Date(),
  enviarPush, avisar = () => {}, registrar = () => {}, ocultarErrosInternos = false, cacheMs = 60000
}) {
  // cache curto só de grupos ACHADOS (nunca de "não existe"): um grupo recém-criado responde na hora
  const cache = new Map();

  async function resolver(apelidoBruto) {
    const apelido = normalizarApelido(apelidoBruto).toLowerCase();
    if (!apelido) return { erro: INEXISTENTE };
    const agora = relogio().getTime();
    const guardado = cache.get(apelido);
    let grupo = guardado && guardado.ate > agora ? guardado.grupo : null;
    if (!grupo) {
      grupo = await cadastro.lerGrupoPorApelido(apelido);
      if (grupo) cache.set(apelido, { grupo, ate: agora + cacheMs });
    }
    if (!grupo) return { erro: INEXISTENTE };
    if (grupo.status !== 'ativo') return { erro: SUSPENSO };
    return { grupo };
  }

  const publico = (g) => ({ apelido: g.apelido, nome: g.nome, cidade: g.cidade, uf: g.uf, cor: g.cor_destaque, logoUrl: g.logo_url || '', plano: g.plano });

  // um handler por requisição: barato (só monta objetos) e sem estado compartilhado entre grupos
  const handlerDo = (g) => criarHandler({
    repo: criarRepoDoGrupo(g.id),
    config: { adminPassword: '' }, // sem chave mestra nos grupos novos (como Terça e Meme desde a v16.0)
    verificarToken, relogio, enviarPush, avisar, registrar, ocultarErrosInternos,
    armazenamento: armazenamentoBase ? armazenamentoDoGrupo(armazenamentoBase, g.id) : undefined,
    liga: repoLiga ? { repo: repoLiga, grupoId: g.apelido } : undefined
  });

  const falhaInesperada = (erro) => {
    if (ocultarErrosInternos && !(erro instanceof ErroDeNegocio)) {
      try { registrar(erro); } catch { /* nada */ }
      return { error: MSG_ERRO_INTERNO };
    }
    return { error: String(erro && erro.message ? erro.message : erro) };
  };

  const dentroDoLimite = (prefixo, ip, max) => cadastro.registrarTentativaGlobal(prefixo + ':' + normalizarIp(ip), max, 3600, 3600);

  async function verificarApelido(b, contexto) {
    if (!(await dentroDoLimite('apelido', contexto.ip, MAX_VERIFICACOES_POR_IP_HORA))) return { error: MSG_MUITAS_CRIACOES };
    const apelido = normalizarApelido(b.apelido);
    const motivo = validarApelido(apelido);
    if (motivo) return { status: 'ok', disponivel: false, motivo };
    const livre = await cadastro.apelidoDisponivel(apelido);
    return { status: 'ok', disponivel: livre, motivo: livre ? '' : MSG_EM_USO };
  }

  async function criarGrupo(b, contexto) {
    const limites = await cadastro.lerLimites();
    // conta ANTES de tudo: tentativas que falham (sem login, dados ruins) também gastam o limite do IP
    if (!(await dentroDoLimite('criar', contexto.ip, limites.max_criacoes_por_ip_hora))) return { error: MSG_MUITAS_CRIACOES };
    const token = await verificarToken(b.idToken);
    if (!token.ok) return { error: token.erro };
    const v = validarCadastroGrupo(b.grupoNovo || {});
    if (v.erro) return { error: v.erro };
    try {
      await cadastro.criarGrupo({ ...v.dados, email: token.email, nomeDono: token.nome || '' });
    } catch (erro) {
      if (erro && erro.codigo && MENSAGENS[erro.codigo]) return { error: MENSAGENS[erro.codigo], codigo: erro.codigo };
      throw erro;
    }
    cache.delete(v.dados.apelido);
    return { status: 'ok', apelido: v.dados.apelido };
  }

  async function tetoDeJogadores(g) {
    const limites = await cadastro.lerLimites();
    const ativos = mapearJogadores(await criarRepoDoGrupo(g.id).lerJogadores()).length; // sem convidados nem removidos
    if (ativos >= limites.max_jogadores_por_grupo) return { error: 'Este grupo chegou ao limite de ' + limites.max_jogadores_por_grupo + ' jogadores do plano grátis.' };
    return null;
  }

  return {
    async get(contexto = {}) {
      try {
        const r = await resolver(contexto.consulta && contexto.consulta.g);
        if (r.erro) return r.erro;
        const dados = await handlerDo(r.grupo).get();
        if (dados.error) return dados;
        return { ...dados, grupo: publico(r.grupo) };
      } catch (erro) {
        return falhaInesperada(erro);
      }
    },

    async post(body, contexto = {}) {
      try {
        const b = body || {};
        const acao = String(b.action || '');
        if (acao === 'verificarApelido') return await verificarApelido(b, contexto);
        if (acao === 'criarGrupo') return await criarGrupo(b, contexto);
        const r = await resolver(b.grupo);
        if (r.erro) return r.erro;
        if (acao === 'addPlayer') {
          const teto = await tetoDeJogadores(r.grupo);
          if (teto) return teto;
        }
        return await handlerDo(r.grupo).post(b, contexto);
      } catch (erro) {
        return falhaInesperada(erro);
      }
    }
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node tests/backend/grupos-api.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`. Se "sessão do app de um grupo não vale no outro" falhar porque o `loginGoogle` em memória não cria sessão, conferir em `backend/usuarios.js` (`sessaoOuNada`) se ele precisa de `relogio` — e não enfraquecer o teste: a sessão é guardada no repositório do grupo, então no outro grupo ela não existe.

- [ ] **Step 5: Acrescentar ao `test:backend` e commit**

Acrescentar ` && node tests/backend/grupos-api.test.mjs`.

```bash
git add backend/grupos-api.js tests/backend/grupos-api.test.mjs package.json
git commit -m "feat(grupos): grupos-api (roteamento por apelido, criarGrupo, verificarApelido, teto)"
```

---

### Task 6: Edge Function `grupos-api` + passos de publicação

**Files:**
- Create: `supabase/functions/grupos-api/index.ts`
- Create: `tests/backend/grupos-api-index.test.mjs`
- Create: `docs/superpowers/grupos-deploy.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `criarGruposApi` (Task 5), `criarRepoMultigrupo` (Fase 1), `criarCadastroSupabase` (Task 2), `criarRepoLigaSupabase`, `criarArmazenamentoSupabase`, `criarVerificadorGoogle`, `criarEdge`.
- Produces: função Deno; segredos `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (injetados), `GOOGLE_CLIENT_ID`, `GRUPOS_ORIGENS_PERMITIDAS`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (opcionais).

- [ ] **Step 1: Teste (falha)**

Criar `tests/backend/grupos-api-index.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { t, fim } from './executor.mjs';

const raiz = path.join(import.meta.dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (s) => s.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { validarNomeFuncao } = createRequire(import.meta.url)('../../scripts/preparar-edge.js');

t('preparar-edge aceita o nome grupos-api', () => assert.equal(validarNomeFuncao('grupos-api'), 'grupos-api'));

t('grupos-api: schemas grupos e liga, bucket fotos-grupos, segredos próprios, sem chave mestra', () => {
  const c = semComentarios(ler('supabase/functions/grupos-api/index.ts'));
  assert.match(c, /schema: 'grupos'|opcoes\('grupos'\)/);
  assert.match(c, /schema: 'liga'|opcoes\('liga'\)/);
  assert.match(c, /bucket: 'fotos-grupos'/);
  assert.match(c, /'GRUPOS_ORIGENS_PERMITIDAS'/);
  assert.match(c, /'GOOGLE_CLIENT_ID'/);
  assert.match(c, /criarRepoMultigrupo\(clienteGrupos, grupoId\)/);
  assert.match(c, /criarCadastroSupabase\(clienteGrupos\)/);
  assert.match(c, /ocultarErrosInternos: true/);
  assert.doesNotMatch(c, /ADMIN_PASSWORD/);
  assert.doesNotMatch(c, /'ORIGENS_PERMITIDAS'|MEME_ORIGENS_PERMITIDAS/); // nunca as origens do Terça/Meme
});

t('a pasta gerada pelo preparar-edge (backend/) fica fora do git, como nas outras funções', () => {
  const gi = ler('.gitignore');
  assert.ok(/supabase\/functions\/\*\/backend|supabase\/functions\/grupos-api\/backend/.test(gi), '.gitignore não cobre supabase/functions/grupos-api/backend');
});

fim();
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node tests/backend/grupos-api-index.test.mjs`
Expected: FALHA (arquivo `index.ts` inexistente). Se a FALHA do `.gitignore` também aparecer, ver o Step 4.

- [ ] **Step 3: Criar `supabase/functions/grupos-api/index.ts`**

```ts
// Edge Function dos grupos independentes (Deno). Atende QUALQUER grupo criado pela página /criar: o grupo vem do apelido
// ("?g=" no GET, campo "grupo" no POST). Dados de todos os grupos no schema "grupos" (separados por grupo_id) e amistosos
// no schema "liga". Os módulos de ./backend/ são gerados por "npm run preparar-edge -- grupos-api" (cópia de backend/*.js).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { criarGruposApi } from './backend/grupos-api.js';
import { criarEdge } from './backend/edge.js';
import { criarRepoMultigrupo } from './backend/repo-multigrupo.js';
import { criarCadastroSupabase } from './backend/cadastro-grupos.js';
import { criarRepoLigaSupabase } from './backend/repo-liga-supabase.js';
import { criarArmazenamentoSupabase } from './backend/armazenamento-supabase.js';
import { criarVerificadorGoogle } from './backend/auth.js';

const NOMES = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GRUPOS_ORIGENS_PERMITIDAS'];
const env = (nome: string): string => (Deno.env.get(nome) ?? '').trim();
const faltando = NOMES.filter((nome) => !env(nome));
if (faltando.length) console.error('Faltam variáveis de ambiente na função: ' + faltando.join(', '));

const recusar = (): Response => new Response(JSON.stringify({ error: 'Configuração incompleta no servidor.' }), {
  status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

if (faltando.length) {
  Deno.serve(recusar); // nunca sobe "meio configurada"
} else {
  const opcoes = (schema: string) => ({ auth: { persistSession: false, autoRefreshToken: false }, db: { schema } });
  const clienteGrupos = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), opcoes('grupos'));
  const clienteLiga = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), opcoes('liga'));
  const registrar = (erro: unknown) => console.error('erro inesperado:', erro instanceof Error ? erro.message : 'desconhecido');
  // notificações push: opcionais (mesmas chaves VAPID do Terça e do Meme); sem elas o resto funciona normal
  const vapidPub = env('VAPID_PUBLIC_KEY'), vapidPriv = env('VAPID_PRIVATE_KEY');
  if (vapidPub && vapidPriv) webpush.setVapidDetails(env('GRUPOS_ORIGENS_PERMITIDAS').split(',')[0], vapidPub, vapidPriv);
  const enviarPush = (vapidPub && vapidPriv)
    ? async (insc: { endpoint: string; p256dh: string; auth: string }, payload: string) =>
        webpush.sendNotification({ endpoint: insc.endpoint, keys: { p256dh: insc.p256dh, auth: insc.auth } }, payload)
    : undefined;
  const api = criarGruposApi({
    cadastro: criarCadastroSupabase(clienteGrupos),
    criarRepoDoGrupo: (grupoId: string) => criarRepoMultigrupo(clienteGrupos, grupoId),
    armazenamentoBase: criarArmazenamentoSupabase({ cliente: clienteGrupos, urlBase: env('SUPABASE_URL'), bucket: 'fotos-grupos' }),
    repoLiga: criarRepoLigaSupabase(clienteLiga),
    verificarToken: criarVerificadorGoogle({ clientId: env('GOOGLE_CLIENT_ID') }),
    enviarPush,
    avisar: (...a: unknown[]) => console.error(...a),
    ocultarErrosInternos: true, // cliente anônimo nunca vê texto de banco
    registrar
  });
  Deno.serve(criarEdge({ handler: api, origensPermitidas: env('GRUPOS_ORIGENS_PERMITIDAS').split(','), registrar }));
}
```

- [ ] **Step 4: Rodar e ver passar; preparar a pasta**

Run: `node tests/backend/grupos-api-index.test.mjs`
Expected: `TODOS OS TESTES PASSARAM`. Se o teste do `.gitignore` falhar, acrescentar a linha `supabase/functions/grupos-api/backend/` ao `.gitignore` (mesmo motivo das outras funções: é pasta gerada) e registrar a decisão.

Run: `npm run preparar-edge -- grupos-api` e depois `git status --short supabase/functions/grupos-api/`
Expected: copia os módulos sem apontar problema; o `git status` mostra só `index.ts` (a pasta `backend/` gerada fica ignorada).

- [ ] **Step 5: Escrever `docs/superpowers/grupos-deploy.md`**

```markdown
# Grupos independentes — publicação do backend (Fase 2)

Passos do USUÁRIO (o assistente não publica nada). Ordem importa.

1. **SQL** (SQL Editor do Supabase, projeto `lzwmirrjpoqucwlhgkku`), nesta ordem:
   1. `sql/liga/ajuste-1-cidade.sql` — cidade/UF na liga (Terça e Meme já ficam em Santa Luzia/MG).
   2. `sql/grupos/schema-grupos.sql` — schema `grupos` inteiro (tabelas, funções, criar_grupo, limites).
2. **Expor o schema:** Configurações → Data API → "Exposed schemas": acrescentar `grupos` (ao lado de public, meme, liga).
3. **Bucket de fotos:** Storage → New bucket → nome `fotos-grupos`, **público**.
4. **Segredo da função:**
   `npx supabase secrets set GRUPOS_ORIGENS_PERMITIDAS=https://volei.memberstars.com --project-ref lzwmirrjpoqucwlhgkku`
   (`GOOGLE_CLIENT_ID` e as chaves VAPID já existem no projeto e são compartilhadas.)
5. **Publicar:**
   `npm run preparar-edge -- grupos-api`
   `npx supabase functions deploy grupos-api --no-verify-jwt --project-ref lzwmirrjpoqucwlhgkku`
6. **Conferir:** `curl https://lzwmirrjpoqucwlhgkku.supabase.co/functions/v1/grupos-api?g=teste` deve responder
   `{"error":"Esse grupo não existe.","codigo":"grupo_inexistente"}`.

Nada disso muda o Terça nem o Meme. A página de criação e o "modo grupo" do app vêm na Fase 3; o endereço
`volei.memberstars.com` na Fase 4.
```

- [ ] **Step 6: Acrescentar ao `test:backend`, suíte inteira e commit**

Acrescentar ` && node tests/backend/grupos-api-index.test.mjs`.

Run: `npm run test:backend`
Expected: tudo `TODOS OS TESTES PASSARAM` (inclusive `meme-api-index.test.mjs`, que garante Terça/Meme intocados).

```bash
git add supabase/functions/grupos-api/index.ts tests/backend/grupos-api-index.test.mjs docs/superpowers/grupos-deploy.md package.json .gitignore
git commit -m "feat(grupos): Edge Function grupos-api e guia de publicação"
```

---

### Task 7: Fechamento da fase

- [ ] **Step 1: Suíte completa**

Run: `npm run test:backend` e `for f in tests/*.test.js; do node "$f" > /dev/null || echo "FALHOU: $f"; done`
Expected: backend todo verde; nenhuma linha `FALHOU`. Com PGlite à mão, rodar também `PGLITE_MODULO=... node tests/backend/sql-grupos-pglite.test.mjs` (27 conferências).

- [ ] **Step 2: Conferir que nada do que está no ar mudou**

Run: `git diff --stat <base-da-fase>..HEAD -- volei-dashboard.html index.html supabase/functions/terca-api-teste supabase/functions/meme-api sql/meme 'sql/schema-terca-supabase*.sql'`
Expected: nenhuma mudança. (`backend/edge.js` muda, mas só repassa um argumento que os handlers do Terça/Meme ignoram — coberto pelos testes de edge.)

- [ ] **Step 3: Relatório ao usuário**

A Fase 2 está pronta e testada na branch `grupos-fase1`; nada publicado. Listar os passos de `docs/superpowers/grupos-deploy.md`, dizendo que só valem a pena junto com a Fase 3 (sem o app, ninguém consegue usar a função). Próximo passo: plano da Fase 3 (modo grupo no `volei-dashboard.html` + página `/criar`).
