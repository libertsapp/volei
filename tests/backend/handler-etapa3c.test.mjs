import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarArmazenamentoMemoria } from '../../backend/armazenamento-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }    // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const novo = () => {
  const armazenamento = criarArmazenamentoMemoria();
  return { armazenamento, h: criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: 'chave-de-teste' }, verificarToken, armazenamento }) };
};
const foto = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const corpo = { action: 'uploadPhoto', filename: 'x.jpg', mimeType: 'image/jpeg', base64: foto };

await ta('sem login e sem senha: mensagem do porteiro, nada gravado', async () => {
  const { h, armazenamento } = novo();
  assert.deepEqual(await h.post(corpo), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.equal(armazenamento.arquivos.size, 0);
});

await ta('perfil jogador com token pode enviar; resposta {url, fileId}', async () => {
  const { h, armazenamento } = novo();
  const r = await h.post({ ...corpo, idToken: 'tok-c' });
  assert.deepEqual(Object.keys(r).sort(), ['fileId', 'url']);
  assert.ok(armazenamento.arquivos.has(r.fileId));
  assert.ok(r.url.endsWith('?id=' + r.fileId));
});

await ta('chave mestra pode enviar; senha errada é recusada', async () => {
  const { h } = novo();
  assert.ok((await h.post({ ...corpo, senha: 'chave-de-teste' })).fileId);
  assert.deepEqual(await h.post({ ...corpo, senha: 'errada' }), { error: 'Senha de administrador incorreta.' });
});

await ta('regras de validação chegam pelo handler; sem armazenamento a ação avisa', async () => {
  const { h } = novo();
  assert.equal((await h.post({ ...corpo, senha: 'chave-de-teste', base64: Buffer.from('nao jpeg').toString('base64') })).error, 'A foto precisa ser uma imagem JPEG.');
  const h2 = criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: 'chave-de-teste' }, verificarToken });
  assert.equal((await h2.post({ ...corpo, senha: 'chave-de-teste' })).error, 'Envio de fotos não configurado neste servidor.');
});

fim();
