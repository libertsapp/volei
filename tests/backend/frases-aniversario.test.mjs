// 🎂 Frases do cartão de parabéns (v21.0): organizador e admin editam a lista do grupo; a leitura do app devolve
// settings.frasesAniversario só quando o grupo editou (sem ela o app usa as padrão do HTML).
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { PERMISSOES } from '../../backend/permissoes.js';

const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' }, // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }  // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const novo = () => {
  const repo = criarRepoMemoria(structuredClone(fixture));
  return { repo, h: criarHandler({ repo, config: { adminPassword: '' }, verificarToken, avisar: () => {} }) };
};

await ta('permissão: organizador e admin', () => {
  assert.deepEqual(PERMISSOES.salvarFrasesAniversario, ['organizador', 'admin']);
});

await ta('sem edição: settings não traz frasesAniversario (resposta igual à de antes)', async () => {
  const { h } = novo();
  assert.equal('frasesAniversario' in (await h.get()).settings, false);
});

await ta('organizador salva: limpa espaços, junta linhas, tira vazias; volta na leitura do app', async () => {
  const { h } = novo();
  const r = await h.post({ action: 'salvarFrasesAniversario', frases: ['  Parabéns, {nome}!  ', '', 'Feliz\n aniversário,   {nome} 🎉', '   '], idToken: 'tok-b' });
  assert.deepEqual(r, { status: 'ok', frasesAniversario: ['Parabéns, {nome}!', 'Feliz aniversário, {nome} 🎉'] });
  assert.deepEqual((await h.get()).settings.frasesAniversario, ['Parabéns, {nome}!', 'Feliz aniversário, {nome} 🎉']);
});

await ta('frase longa é cortada em 160; mais de 20 frases é recusado', async () => {
  const { h } = novo();
  await h.post({ action: 'salvarFrasesAniversario', frases: ['x'.repeat(400)], idToken: 'tok-a' });
  assert.equal((await h.get()).settings.frasesAniversario[0].length, 160);
  const r = await h.post({ action: 'salvarFrasesAniversario', frases: Array.from({ length: 21 }, (_, i) => 'f' + i), idToken: 'tok-a' });
  assert.ok(r.error);
  assert.equal((await h.get()).settings.frasesAniversario.length, 1);
});

await ta('lista vazia ou "voltar às padrão": some da leitura', async () => {
  const { h } = novo();
  await h.post({ action: 'salvarFrasesAniversario', frases: ['Oi {nome}'], idToken: 'tok-a' });
  assert.deepEqual(await h.post({ action: 'salvarFrasesAniversario', frases: ['', ' '], idToken: 'tok-a' }), { status: 'ok', frasesAniversario: null });
  assert.equal('frasesAniversario' in (await h.get()).settings, false);
  await h.post({ action: 'salvarFrasesAniversario', frases: ['Oi {nome}'], idToken: 'tok-a' });
  assert.deepEqual(await h.post({ action: 'salvarFrasesAniversario', remover: true, idToken: 'tok-a' }), { status: 'ok', frasesAniversario: null });
  assert.equal('frasesAniversario' in (await h.get()).settings, false);
});

await ta('jogador e quem não logou: recusados; frases que não são lista: recusado', async () => {
  const { h } = novo();
  for (const idToken of ['tok-c', undefined]) assert.ok((await h.post({ action: 'salvarFrasesAniversario', frases: ['x'], idToken })).error);
  assert.ok((await h.post({ action: 'salvarFrasesAniversario', frases: 'Parabéns', idToken: 'tok-a' })).error);
  assert.equal('frasesAniversario' in (await h.get()).settings, false);
});

await ta('JSON estragado no banco não derruba a leitura; só textos entram', async () => {
  const { h, repo } = novo();
  await repo.gravarConfig([{ chave: 'frasesAniversario', valor: '{quebrado' }]);
  assert.equal('frasesAniversario' in (await h.get()).settings, false);
  await repo.gravarConfig([{ chave: 'frasesAniversario', valor: JSON.stringify(['ok {nome}', 42, null, { a: 1 }, '  ']) }]);
  assert.deepEqual((await h.get()).settings.frasesAniversario, ['ok {nome}']);
});

await ta('salvar as configurações do check-in não apaga as frases', async () => {
  const { h } = novo();
  await h.post({ action: 'salvarFrasesAniversario', frases: ['Oi {nome}'], idToken: 'tok-a' });
  const s = (await h.get()).settings;
  await h.post({ action: 'saveSettings', settings: { ...s, checkinVagas: 18 }, idToken: 'tok-a' });
  assert.deepEqual((await h.get()).settings.frasesAniversario, ['Oi {nome}']);
});

fim();
