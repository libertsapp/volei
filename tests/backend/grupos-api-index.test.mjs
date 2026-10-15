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

t('grupos-api: vitrine pública lê grupos, liga e os schemas do Terça (public) e do Meme (meme)', () => {
  const c = semComentarios(ler('supabase/functions/grupos-api/index.ts'));
  assert.match(c, /criarLeitorVitrine\(/);
  assert.match(c, /opcoes\('public'\)/);
  assert.match(c, /opcoes\('meme'\)/);
  assert.match(c, /clientesLegados: \{ terca: clientePublico, meme: clienteMeme \}/);
  assert.match(c, /lerVitrine/);
});

fim();
