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
  assert.doesNotMatch(c, /'MEME_ADMIN_PASSWORD'/); // v16.0: sem chave mestra, a função nem pede o segredo
  assert.match(c, /adminPassword: ''/);
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
  // v16.0: o Terça não lê mais a chave mestra (a Edge Function nem pede o segredo); só o Meme ainda usa
  assert.doesNotMatch(c, /Deno\.env\.get\('ADMIN_PASSWORD'\)|env\('ADMIN_PASSWORD'\)|'ADMIN_PASSWORD'/);
  assert.match(c, /adminPassword: ''/);
});

await ta('config.toml liga verify_jwt=false para as duas funções e .gitignore cobre backend/ gerado de qualquer função', () => {
  const t = ler('supabase/config.toml');
  assert.match(t, /\[functions\.terca-api-teste\]\s*\r?\nverify_jwt = false/);
  assert.match(t, /\[functions\.meme-api\]\s*\r?\nverify_jwt = false/);
  assert.match(ler('.gitignore'), /^supabase\/functions\/\*\/backend\/\r?$/m);
});

fim();
