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
