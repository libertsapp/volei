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
  // as 7 funções que fixavam meme agora fixam meme
  assert.equal((s.match(/set search_path = meme as/g) || []).length, 7);
  // sessões do app (ajuste 8, 2026-09-30): uma instalação nova do Meme já nasce com a tabela
  assert.match(s, /create table if not exists sessoes \(/);
});

await ta('é determinístico e o arquivo gerado no repositório está em dia (rode: npm run gerar-sql-meme)', () => {
  const a = gerarSqlGrupo(reais, 'meme');
  assert.equal(gerarSqlGrupo(reais, 'meme'), a);
  const emDisco = fs.readFileSync(path.join(raiz, 'sql', 'meme', 'schema-meme-supabase.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(emDisco, a, 'sql/meme/schema-meme-supabase.sql está desatualizado: rode "npm run gerar-sql-meme"');
});

fim();
