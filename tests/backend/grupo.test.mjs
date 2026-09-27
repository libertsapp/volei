import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ta, fim } from './executor.mjs';

const { configDoGrupo, opcoesDoCliente } = createRequire(import.meta.url)('../../scripts/lib/grupo.js');

await ta('sem GRUPO é o Terça (schema public, bucket fotos): nada muda para quem já usa', () => {
  const c = configDoGrupo({ SPREADSHEET_ID_TERCA: 'T1', SPREADSHEET_ID_MEME: 'M1' });
  assert.equal(c.grupo, 'terca');
  assert.equal(c.schema, 'public');
  assert.equal(c.bucket, 'fotos');
  assert.equal(c.adminPasswordVar, 'ADMIN_PASSWORD');
  assert.equal(c.spreadsheetId, 'T1');
  assert.deepEqual(opcoesDoCliente(c), {});
});

await ta('GRUPO=meme: schema meme, bucket fotos-meme, senha e planilha do Meme; ignora maiúsculas e espaços', () => {
  const c = configDoGrupo({ GRUPO: '  MEME ', SPREADSHEET_ID_TERCA: 'T1', SPREADSHEET_ID_MEME: 'M1' });
  assert.equal(c.grupo, 'meme');
  assert.equal(c.schema, 'meme');
  assert.equal(c.bucket, 'fotos-meme');
  assert.equal(c.adminPasswordVar, 'MEME_ADMIN_PASSWORD');
  assert.equal(c.spreadsheetId, 'M1');
  assert.deepEqual(opcoesDoCliente(c), { db: { schema: 'meme' } });
});

await ta('o Meme NUNCA cai na planilha do Terça (ID do Meme ausente = vazio, não o do Terça)', () => {
  const c = configDoGrupo({ GRUPO: 'meme', SPREADSHEET_ID_TERCA: 'T1' });
  assert.equal(c.spreadsheetId, '');
});

await ta('GRUPO desconhecido é erro (nada de cair no Terça por engano)', () => {
  for (const ruim of ['meem', 'publico', 'terça2']) {
    assert.throws(() => configDoGrupo({ GRUPO: ruim }), /GRUPO inválido/);
  }
});

fim();
