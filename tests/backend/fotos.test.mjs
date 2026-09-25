import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarArmazenamentoMemoria } from '../../backend/armazenamento-memoria.js';
import { uploadPhoto } from '../../backend/fotos.js';

const AGORA = new Date('2026-09-24T12:00:00.000Z');
const jpeg = (n = 100) => { const b = Buffer.alloc(n, 7); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const b64 = (b) => b.toString('base64');

function novo(fotoDoP3 = '') {
  const dados = structuredClone(fixture);
  dados.jogadores.push({ id: 'p3', nome: 'Carla', apelido: '', foto: fotoDoP3, estrelas: 3, sexo: 'F', porte: 'M', convidado: false, removido: false, ordem: 3 });
  const armazenamento = criarArmazenamentoMemoria();
  const deps = { repo: criarRepoMemoria(dados), armazenamento, relogio: () => AGORA };
  return { deps, armazenamento };
}
const admin = { ok: true, perfil: 'admin', jogadorId: '', viaChaveMestra: true };
const orga = { ok: true, perfil: 'organizador', jogadorId: 'p2', viaChaveMestra: false };
const jogadorP3 = { ok: true, perfil: 'jogador', jogadorId: 'p3', viaChaveMestra: false };

await ta('envio válido devolve {url, fileId} no formato ?id= e guarda os bytes', async () => {
  const { deps, armazenamento } = novo();
  const r = await uploadPhoto(deps, admin, { base64: b64(jpeg(200)), mimeType: 'image/jpeg' });
  assert.match(r.fileId, /^[0-9a-z-]+\.jpg$/);
  assert.ok(r.fileId.startsWith(AGORA.getTime() + '-'));
  assert.equal(r.url, 'https://exemplo.test/fotos/' + r.fileId + '?id=' + r.fileId);
  assert.equal(armazenamento.arquivos.get(r.fileId).contentType, 'image/jpeg');
  assert.deepEqual(Buffer.from(armazenamento.arquivos.get(r.fileId).bytes), jpeg(200));
});

await ta('dois envios no mesmo instante têm caminhos diferentes', async () => {
  const { deps } = novo();
  const a = await uploadPhoto(deps, admin, { base64: b64(jpeg()) });
  const b = await uploadPhoto(deps, admin, { base64: b64(jpeg()) });
  assert.notEqual(a.fileId, b.fileId);
});

await ta('recusas: grande demais, não JPEG, não base64, ausente, vazio', async () => {
  const { deps, armazenamento } = novo();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  assert.deepEqual(await uploadPhoto(deps, admin, { base64: b64(jpeg(300 * 1024 + 1)) }), { error: 'Foto grande demais (máximo 300 KB).' });
  assert.deepEqual(await uploadPhoto(deps, admin, { base64: b64(jpeg(5 * 1024 * 1024)) }), { error: 'Foto grande demais (máximo 300 KB).' });
  assert.ok((await uploadPhoto(deps, admin, { base64: b64(jpeg(300 * 1024)) })).fileId, 'exatamente 300 KB passa');
  assert.deepEqual(await uploadPhoto(deps, admin, { base64: b64(png), mimeType: 'image/jpeg' }), { error: 'A foto precisa ser uma imagem JPEG.' });
  assert.match((await uploadPhoto(deps, admin, { base64: '!!!nao e base64!!!' })).error, /base64/);
  assert.match((await uploadPhoto(deps, admin, { base64: 123 })).error, /base64/);
  assert.match((await uploadPhoto(deps, admin, {})).error, /base64/);
  assert.match((await uploadPhoto(deps, admin, { base64: '' })).error, /base64/);
  assert.equal(armazenamento.arquivos.size, 1, 'só o envio de 300 KB foi gravado');
});

await ta('sem armazenamento configurado: mensagem clara', async () => {
  const { deps } = novo();
  delete deps.armazenamento;
  assert.deepEqual(await uploadPhoto(deps, admin, { base64: b64(jpeg()) }), { error: 'Envio de fotos não configurado neste servidor.' });
});

await ta('fileIdAntigo: organizador e chave mestra apagam qualquer caminho bem formado', async () => {
  const { deps, armazenamento } = novo();
  await armazenamento.enviar('1-aa.jpg', jpeg(), 'image/jpeg');
  await armazenamento.enviar('2-bb.jpg', jpeg(), 'image/jpeg');
  await uploadPhoto(deps, orga, { base64: b64(jpeg()), fileIdAntigo: '1-aa.jpg' });
  await uploadPhoto(deps, admin, { base64: b64(jpeg()), fileIdAntigo: '2-bb.jpg' });
  assert.equal(armazenamento.arquivos.has('1-aa.jpg'), false);
  assert.equal(armazenamento.arquivos.has('2-bb.jpg'), false);
});

await ta('jogador apaga a PRÓPRIA foto antiga, mas não a de outra pessoa; o envio funciona nos dois casos', async () => {
  const { deps, armazenamento } = novo('https://x/storage/v1/object/public/fotos/9-cc.jpg?id=9-cc.jpg');
  await armazenamento.enviar('9-cc.jpg', jpeg(), 'image/jpeg');
  await armazenamento.enviar('8-dd.jpg', jpeg(), 'image/jpeg');
  const r1 = await uploadPhoto(deps, jogadorP3, { base64: b64(jpeg()), fileIdAntigo: '8-dd.jpg' });
  assert.ok(r1.fileId);
  assert.equal(armazenamento.arquivos.has('8-dd.jpg'), true, 'foto alheia preservada');
  const r2 = await uploadPhoto(deps, jogadorP3, { base64: b64(jpeg()), fileIdAntigo: '9-cc.jpg' });
  assert.ok(r2.fileId);
  assert.equal(armazenamento.arquivos.has('9-cc.jpg'), false, 'a própria foi apagada');
});

await ta('ataque em dois passos: jogador aponta a própria foto para a URL de outro e envia com fileIdAntigo; o arquivo do outro fica', async () => {
  const { deps, armazenamento } = novo();
  const url = (c) => 'https://x/storage/v1/object/public/fotos/' + c + '?id=' + c;
  await armazenamento.enviar('5-vv.jpg', jpeg(), 'image/jpeg');
  deps.repo.tabelas.jogadores.find((j) => j.id === 'p1').foto = url('5-vv.jpg'); // vítima
  await deps.repo.atualizarJogador('p3', { foto: url('5-vv.jpg') });            // passo 1: updatePlayer da própria foto
  const r = await uploadPhoto(deps, jogadorP3, { base64: b64(jpeg()), fileIdAntigo: '5-vv.jpg' }); // passo 2
  assert.ok(r.fileId, 'o envio em si funciona');
  assert.equal(armazenamento.arquivos.has('5-vv.jpg'), true, 'arquivo da vítima preservado');
});

await ta('convidado ou removido que referencia o caminho também protege o arquivo', async () => {
  const { deps, armazenamento } = novo('https://x/fotos/6-ww.jpg?id=6-ww.jpg');
  await armazenamento.enviar('6-ww.jpg', jpeg(), 'image/jpeg');
  deps.repo.tabelas.jogadores.push({ id: 'g1', nome: 'Conv', apelido: '', foto: 'https://x/fotos/6-ww.jpg?id=6-ww.jpg', estrelas: 0, sexo: '', porte: '', convidado: true, removido: false, ordem: 9 });
  await uploadPhoto(deps, jogadorP3, { base64: b64(jpeg()), fileIdAntigo: '6-ww.jpg' });
  assert.equal(armazenamento.arquivos.has('6-ww.jpg'), true);
});

await ta('fluxo legítimo: ninguém mais referencia, a foto antiga do próprio jogador é apagada', async () => {
  const { deps, armazenamento } = novo('https://x/fotos/4-ok.jpg?id=4-ok.jpg');
  await armazenamento.enviar('4-ok.jpg', jpeg(), 'image/jpeg');
  await uploadPhoto(deps, jogadorP3, { base64: b64(jpeg()), fileIdAntigo: '4-ok.jpg' });
  assert.equal(armazenamento.arquivos.has('4-ok.jpg'), false);
});

await ta('jogador sem vínculo é recusado no envio (com aviso), organizador e chave mestra não', async () => {
  const { deps, armazenamento } = novo();
  const semVinculo = { ok: true, perfil: 'jogador', jogadorId: '', viaChaveMestra: false };
  assert.deepEqual(await uploadPhoto(deps, semVinculo, { base64: b64(jpeg()) }), { error: 'Vincule sua conta a um jogador antes de enviar foto.' });
  assert.equal(armazenamento.arquivos.size, 0);
  assert.ok((await uploadPhoto(deps, orga, { base64: b64(jpeg()) })).fileId);
});

await ta('fileIdAntigo malformado (../x, a/b.jpg, id do Drive) é ignorado em silêncio', async () => {
  const { deps, armazenamento } = novo();
  for (const ruim of ['../x', 'a/b.jpg', '1AbC_dEf', 'x.png', '..\\x.jpg', 42, {}]) {
    const r = await uploadPhoto(deps, admin, { base64: b64(jpeg()), fileIdAntigo: ruim });
    assert.ok(r.fileId, 'upload ok com ' + JSON.stringify(ruim));
  }
  assert.deepEqual(armazenamento.chamadas.apagar, []);
});

await ta('apagar que falha não derruba o envio', async () => {
  const { deps, armazenamento } = novo();
  armazenamento.apagar = async () => { throw new Error('boom'); };
  const r = await uploadPhoto(deps, admin, { base64: b64(jpeg()), fileIdAntigo: '1-aa.jpg' });
  assert.ok(r.fileId && r.url);
});

fim();
