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
