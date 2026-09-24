import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const AGORA = new Date('2026-09-23T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },   // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' },   // jogador
  'tok-x': { ok: true, email: 'x@exemplo.com', nome: 'Desconhecido' }
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' });
const handler = (repo = criarRepoMemoria(fixture)) => criarHandler({ repo, config: { adminPassword: 'chave-de-teste' }, verificarToken, relogio: () => AGORA });

await ta('loginGoogle passa pelo handler', async () => {
  const r = await handler().post({ action: 'loginGoogle', idToken: 'tok-a' });
  assert.equal(r.perfil, 'admin');
  assert.equal(r.status, 'ok');
});

await ta('bootstrapAdmin passa pelo handler', async () => {
  assert.deepEqual(await handler().post({ action: 'bootstrapAdmin', senha: 'errada', idToken: 'tok-c' }), { error: 'Chave mestra incorreta.' });
});

await ta('porteiro: sem nada, com senha errada, ação desconhecida', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'salvarUsuario' }), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.deepEqual(await h.post({ action: 'salvarUsuario', senha: 'errada' }), { error: 'Senha de administrador incorreta.' });
  assert.deepEqual(await h.post({ action: 'xpto', senha: 'chave-de-teste' }), { error: 'Ação desconhecida: xpto' });
  assert.deepEqual(await h.post({ action: 'constructor', senha: 'chave-de-teste' }), { error: 'Ação desconhecida: constructor' });
});

await ta('porteiro: senha errada mas COM token cai no token', async () => {
  const r = await handler().post({ action: 'listarUsuarios', senha: 'errada', idToken: 'tok-b' });
  assert.equal(r.usuarios.length, 3);
});

await ta('porteiro: perfil sem permissão, e-mail desconhecido vira jogador', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'salvarUsuario', idToken: 'tok-c', usuario: { email: 'c@exemplo.com', perfil: 'admin' } }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'listarUsuarios', idToken: 'tok-x' }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
});

await ta('ping: mostra perfil e se veio pela chave mestra', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'ping', senha: 'chave-de-teste' }), { status: 'ok', perfil: 'admin', viaChaveMestra: true });
  assert.deepEqual(await h.post({ action: 'ping', idToken: 'tok-b' }), { status: 'ok', perfil: 'organizador', viaChaveMestra: false });
});

await ta('listarUsuarios: chave mestra e admin veem o cargo; organizador não', async () => {
  const h = handler();
  assert.ok('perfil' in (await h.post({ action: 'listarUsuarios', senha: 'chave-de-teste' })).usuarios[0]);
  assert.ok('perfil' in (await h.post({ action: 'listarUsuarios', idToken: 'tok-a' })).usuarios[0]);
  assert.equal('perfil' in (await h.post({ action: 'listarUsuarios', idToken: 'tok-b' })).usuarios[0], false);
});

await ta('ações de usuários gravam pelo repositório (salvar, vincular, remover)', async () => {
  const repo = criarRepoMemoria(fixture);
  const h = handler(repo);
  assert.deepEqual(await h.post({ action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'organizador' } }), { status: 'ok' });
  assert.equal((await repo.lerUsuarios()).find((u) => u.email === 'c@exemplo.com').perfil, 'organizador');
  assert.deepEqual(await h.post({ action: 'removerUsuario', idToken: 'tok-a', email: 'c@exemplo.com' }), { status: 'ok' });
  assert.equal((await repo.lerUsuarios()).length, 2);
  assert.deepEqual(await h.post({ action: 'solicitarVinculo', idToken: 'tok-b', jogadorId: 'p1' }), { error: 'Esse jogador já está vinculado ao e-mail a@exemplo.com.' });
});

await ta('ação da matriz ainda não portada: passa pelo porteiro e depois avisa', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'marcarPagamento', idToken: 'tok-a' }), { error: 'Esta ação ainda não está disponível na versão Supabase (marcarPagamento).' });
  assert.deepEqual(await h.post({ action: 'marcarPagamento', idToken: 'tok-c' }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
});

await ta('addCheckin/removeCheckin: só validam o token e depois avisam', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'addCheckin' }), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.deepEqual(await h.post({ action: 'removeCheckin', idToken: 'tok-c' }), { error: 'Esta ação ainda não está disponível na versão Supabase (removeCheckin).' });
});

await ta('lerAoVivo: leitura pública, vazia hoje', async () => {
  assert.deepEqual(await handler().post({ action: 'lerAoVivo' }), { rounds: [], log: [] });
});

await ta('post nunca lança: falha do repositório vira { error }', async () => {
  const h = criarHandler({ repo: { async lerTudo() { throw new Error('banco fora do ar'); }, async lerUsuarios() { throw new Error('banco fora do ar'); } }, config: { adminPassword: 'x' }, verificarToken, relogio: () => AGORA });
  assert.deepEqual(await h.post({ action: 'incrementarAcesso' }), { error: 'banco fora do ar' });
  assert.deepEqual(await h.post({ action: 'listarUsuarios', idToken: 'tok-a' }), { error: 'banco fora do ar' });
  assert.deepEqual(await h.post(undefined), { error: 'Ação desconhecida: ' });
});

fim();
