// Logo do grupo (v18.3): só ADMIN troca ou volta ao padrão; a imagem vai pro armazenamento de fotos e o endereço
// fica nas configurações (chaves logoUrl/logoArquivo), que a leitura do app devolve em settings.logoUrl.
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarArmazenamentoMemoria } from '../../backend/armazenamento-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { mapearConfig } from '../../backend/mapeadores.js';
import { PERMISSOES } from '../../backend/permissoes.js';

const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' }, // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }  // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const novo = () => {
  const armazenamento = criarArmazenamentoMemoria();
  const repo = criarRepoMemoria(structuredClone(fixture));
  return { armazenamento, repo, h: criarHandler({ repo, config: { adminPassword: '' }, verificarToken, armazenamento, avisar: () => {} }) };
};
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const config = async (repo) => mapearConfig(await repo.lerConfig());
const chave = async (repo, k) => ((await repo.lerConfig()).find((c) => c.chave === k) || {}).valor;

await ta('permissão: só admin', () => {
  assert.deepEqual(PERMISSOES.salvarLogo, ['admin']);
});

await ta('sem logo: settings não traz logoUrl (resposta igual à de antes; app mostra o padrão)', async () => {
  const { h } = novo();
  assert.equal('logoUrl' in (await h.get()).settings, false);
});

await ta('admin troca o logo: arquivo enviado, endereço nas configurações e na leitura do app', async () => {
  const { h, repo, armazenamento } = novo();
  const r = await h.post({ action: 'salvarLogo', base64: jpeg, idToken: 'tok-a' });
  assert.equal(r.status, 'ok');
  assert.match(r.logoUrl, /^https:\/\/exemplo\.test\/fotos\/logo-\d+-[0-9a-f]{8}\.jpg/);
  assert.equal(armazenamento.arquivos.size, 1);
  assert.equal((await config(repo)).logoUrl, r.logoUrl);
  assert.match(await chave(repo, 'logoArquivo'), /^logo-\d+-[0-9a-f]{8}\.jpg$/);
  assert.equal((await h.get()).settings.logoUrl, r.logoUrl);
});

await ta('trocar de novo apaga o arquivo antigo; voltar ao padrão apaga o atual e limpa o endereço', async () => {
  const { h, repo, armazenamento } = novo();
  await h.post({ action: 'salvarLogo', base64: jpeg, idToken: 'tok-a' });
  const primeiro = await chave(repo, 'logoArquivo');
  await new Promise((r) => setTimeout(r, 2)); // carimbo diferente no nome
  await h.post({ action: 'salvarLogo', base64: jpeg, idToken: 'tok-a' });
  const segundo = await chave(repo, 'logoArquivo');
  assert.notEqual(primeiro, segundo);
  assert.deepEqual([...armazenamento.arquivos.keys()], [segundo]);
  const r = await h.post({ action: 'salvarLogo', remover: true, idToken: 'tok-a' });
  assert.deepEqual(r, { status: 'ok', logoUrl: '' });
  assert.equal(armazenamento.arquivos.size, 0);
  assert.equal((await config(repo)).logoUrl, undefined);
  assert.equal(await chave(repo, 'logoArquivo'), '');
});

await ta('organizador, jogador e visitante são recusados, nada gravado', async () => {
  const { h, repo, armazenamento } = novo();
  for (const idToken of ['tok-b', 'tok-c']) {
    const r = await h.post({ action: 'salvarLogo', base64: jpeg, idToken });
    assert.match(r.error, /permissão/i, idToken);
  }
  assert.ok((await h.post({ action: 'salvarLogo', base64: jpeg })).error);
  assert.ok((await h.post({ action: 'salvarLogo', remover: true, idToken: 'tok-b' })).error);
  assert.equal(armazenamento.arquivos.size, 0);
  assert.equal((await config(repo)).logoUrl, undefined);
});

await ta('imagem inválida: não-JPEG, vazia, base64 quebrado e grande demais', async () => {
  const { h, armazenamento } = novo();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]).toString('base64');
  assert.match((await h.post({ action: 'salvarLogo', base64: png, idToken: 'tok-a' })).error, /JPEG/);
  assert.ok((await h.post({ action: 'salvarLogo', base64: '', idToken: 'tok-a' })).error);
  assert.ok((await h.post({ action: 'salvarLogo', base64: '###', idToken: 'tok-a' })).error);
  const grande = Buffer.alloc(301 * 1024, 0xff).toString('base64');
  assert.match((await h.post({ action: 'salvarLogo', base64: grande, idToken: 'tok-a' })).error, /grande/);
  assert.equal(armazenamento.arquivos.size, 0);
});

await ta('logoArquivo adulterado no banco (caminho estranho) nunca é apagado', async () => {
  const { h, repo, armazenamento } = novo();
  await repo.gravarConfig([{ chave: 'logoArquivo', valor: '../fotos-de-outro/x.jpg' }, { chave: 'logoUrl', valor: 'https://x' }]);
  await h.post({ action: 'salvarLogo', remover: true, idToken: 'tok-a' });
  assert.deepEqual(armazenamento.chamadas.apagar, []);
});

await ta('sem armazenamento configurado: erro claro', async () => {
  const repo = criarRepoMemoria(structuredClone(fixture));
  const h = criarHandler({ repo, config: { adminPassword: '' }, verificarToken, avisar: () => {} });
  assert.match((await h.post({ action: 'salvarLogo', base64: jpeg, idToken: 'tok-a' })).error, /não configurado/);
});

fim();
