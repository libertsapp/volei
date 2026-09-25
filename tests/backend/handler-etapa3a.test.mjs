import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const AGORA = new Date('2026-09-23T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin, vinculado a p1
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },   // organizador, vinculado a p2
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }    // jogador, sem vínculo
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });

function novo() {
  const dados = structuredClone(fixture);
  // c passa a ser jogador vinculado a p3 (para a exceção da foto)
  dados.jogadores.push({ id: 'p3', nome: 'Carla', apelido: 'Carlinha', foto: '', estrelas: 3, sexo: 'F', porte: 'M', convidado: false, removido: false, ordem: 3 });
  dados.usuarios.find((u) => u.email === 'c@exemplo.com').jogador_id = 'p3';
  const repo = criarRepoMemoria(dados);
  return { repo, h: criarHandler({ repo, config: { adminPassword: 'chave-de-teste' }, verificarToken, relogio: () => AGORA }) };
}

await ta('organizador cadastra, edita e o admin arquiva um jogador; o GET reflete cada passo', async () => {
  const { h } = novo();
  assert.deepEqual(await h.post({ action: 'addPlayer', idToken: 'tok-b', player: { id: 'p7', nome: 'Diego', estrelas: 4, sexo: 'M', porte: 'G' } }), { status: 'ok' });
  assert.ok((await h.get()).players.some((p) => p.id === 'p7'));
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-b', player: { id: 'p7', nome: 'Diego S', estrelas: 5, sexo: 'M', porte: 'G' } }), { status: 'ok' });
  assert.equal((await h.get()).players.find((p) => p.id === 'p7').nome, 'Diego S');
  assert.deepEqual(await h.post({ action: 'removePlayer', idToken: 'tok-b', id: 'p7' }), { error: 'Seu perfil (organizador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'removePlayer', idToken: 'tok-a', id: 'p7' }), { status: 'ok' });
  assert.equal((await h.get()).players.some((p) => p.id === 'p7'), false);
});

await ta('rodadas: organizador salva e edita; só o admin remove', async () => {
  const { h } = novo();
  const rodada = { id: 'r9', data: '2026-09-30', rascunho: false, vencedores: [0], times: [{ nome: 'A', vitorias: 2, playerIds: ['p1'] }, { nome: 'B', vitorias: 1, playerIds: ['p2'] }] };
  assert.deepEqual(await h.post({ action: 'addRound', idToken: 'tok-b', round: rodada }), { status: 'ok' });
  assert.deepEqual((await h.get()).rounds.map((r) => r.id), ['r1', 'r2', 'r9']);
  assert.deepEqual(await h.post({ action: 'updateRound', idToken: 'tok-b', round: { ...rodada, data: '2026-10-01' } }), { status: 'ok' });
  assert.equal((await h.get()).rounds.at(-1).data, '2026-10-01');
  assert.deepEqual(await h.post({ action: 'removeRound', idToken: 'tok-b', id: 'r9' }), { error: 'Seu perfil (organizador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'removeRound', senha: 'chave-de-teste', id: 'r9' }), { status: 'ok' });
  assert.deepEqual((await h.get()).rounds.map((r) => r.id), ['r1', 'r2']);
});

await ta('configurações: saveSettings só admin; saveCheckinSettings organizador também', async () => {
  const { h } = novo();
  const settings = { estrelasVisiveis: true, checkinDataAberta: '2026-10-06', checkinTravado: true, checkinVagas: 12, checkinHorario: '20:30', checkinMensagemTemplate: 'x' };
  assert.deepEqual(await h.post({ action: 'saveSettings', idToken: 'tok-b', settings }), { error: 'Seu perfil (organizador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'saveCheckinSettings', idToken: 'tok-b', settings }), { status: 'ok' });
  assert.equal((await h.get()).settings.checkinTravado, true);
  assert.equal((await h.get()).settings.contadorAcessos, 41);
  assert.deepEqual(await h.post({ action: 'saveSettings', idToken: 'tok-a', settings: { ...settings, estrelasVisiveis: false } }), { status: 'ok' });
  assert.equal((await h.get()).settings.estrelasVisiveis, false);
});

await ta('exceção da foto: jogador vinculado troca só a foto; qualquer outro campo, outro jogador ou perfil sem vínculo é negado', async () => {
  const { h } = novo();
  const igual = { id: 'p3', nome: 'Carla', apelido: 'Carlinha', estrelas: 3, sexo: 'F', porte: 'M' };
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { ...igual, foto: 'https://x/nova.jpg' } }), { status: 'ok' });
  assert.equal((await h.get()).players.find((p) => p.id === 'p3').foto, 'https://x/nova.jpg');
  const negado = { error: 'Seu perfil (jogador) não tem permissão para esta ação.' };
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { ...igual, estrelas: 5 } }), negado);
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { ...igual, nome: 'Outra' } }), negado);
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { id: 'p1', nome: 'Ana', estrelas: 4, sexo: 'F', porte: 'P' } }), negado);
  assert.deepEqual(await h.post({ action: 'addPlayer', idToken: 'tok-c', player: { id: 'p8', nome: 'X' } }), negado);
});

await ta('exceção da foto: conta sem vínculo é negada', async () => {
  const { h, repo } = novo();
  await repo.gravarUsuario({ email: 'c@exemplo.com', jogador_id: null });
  assert.deepEqual(await h.post({ action: 'updatePlayer', idToken: 'tok-c', player: { id: 'p3', nome: 'Carla', apelido: 'Carlinha', estrelas: 3, sexo: 'F', porte: 'M', foto: 'x' } }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
});

fim();
