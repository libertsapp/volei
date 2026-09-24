import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },   // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }    // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const novo = () => criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: 'chave-de-teste' }, verificarToken });
const chk = { id: 'c9', data: '2026-09-29', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: 4, sexo: 'F' };

await ta('addCheckin/removeCheckin: qualquer perfil logado (até jogador) serve e o GET reflete', async () => {
  const h = novo();
  assert.deepEqual(await h.post({ action: 'addCheckin', idToken: 'tok-c', checkin: chk }), { status: 'ok' });
  assert.equal((await h.get()).checkins.at(-1).id, 'c9');
  assert.deepEqual(await h.post({ action: 'removeCheckin', idToken: 'tok-c', id: 'c9' }), { status: 'ok' });
  assert.equal((await h.get()).checkins.some((c) => c.id === 'c9'), false);
  assert.deepEqual(await h.post({ action: 'removeCheckin', idToken: 'tok-c', id: 'c9' }), { error: 'Check-in não encontrado (pode já ter sido desmarcado).' });
});

await ta('addCheckin/removeCheckin: sem token ou token ruim é recusado; a chave mestra sozinha não vale', async () => {
  const h = novo();
  const semToken = { error: 'Sem token de login. Entre com sua conta Google.' };
  assert.deepEqual(await h.post({ action: 'addCheckin', checkin: chk }), semToken);
  assert.deepEqual(await h.post({ action: 'removeCheckin', id: 'c1' }), semToken);
  assert.deepEqual(await h.post({ action: 'addCheckin', senha: 'chave-de-teste', checkin: chk }), semToken);
  assert.deepEqual(await h.post({ action: 'removeCheckin', senha: 'chave-de-teste', id: 'c1' }), semToken);
  assert.deepEqual(await h.post({ action: 'addCheckin', idToken: 'ruim', checkin: chk }), { error: 'inválido' });
  assert.equal((await h.get()).checkins.length, 3);
});

await ta('salvarEstrelasAjustadas: jogador é negado, organizador e a chave mestra gravam', async () => {
  const h = novo();
  const corpo = { action: 'salvarEstrelasAjustadas', checkins: [{ id: 'c1', estrelasAjustadas: 3 }] };
  assert.deepEqual(await h.post({ ...corpo, idToken: 'tok-c' }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.equal((await h.get()).checkins.find((c) => c.id === 'c1').estrelasAjustadas, '');
  assert.deepEqual(await h.post({ ...corpo, idToken: 'tok-b' }), { status: 'ok' });
  assert.equal((await h.get()).checkins.find((c) => c.id === 'c1').estrelasAjustadas, '3');
  assert.deepEqual(await h.post({ action: 'salvarEstrelasAjustadas', senha: 'chave-de-teste', checkins: [] }), { error: 'Lista de check-ins vazia.' });
});

fim();
