// 🎥 Replays do RegistraAí (v20.2): só ADMIN escolhe arena e quadra; o backend só guarda os identificadores (os vídeos
// nunca passam por aqui) e a leitura do app devolve settings.replays quando os dois existem.
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
const ARENA = '697391cdf60a9f8fabaa7943';
const QUADRA = '6973973ef60a9f8fabaa7946';

await ta('permissão: só admin', () => {
  assert.deepEqual(PERMISSOES.salvarReplays, ['admin']);
});

await ta('sem configuração: settings não traz replays (resposta igual à de antes)', async () => {
  const { h } = novo();
  assert.equal('replays' in (await h.get()).settings, false);
});

await ta('admin salva arena e quadra: volta na leitura do app', async () => {
  const { h } = novo();
  const r = await h.post({ action: 'salvarReplays', arena: ARENA, quadra: QUADRA, arenaNome: 'IBIZA Beach Sports', quadraNome: 'Quadra 1', idToken: 'tok-a' });
  assert.equal(r.status, 'ok');
  assert.deepEqual((await h.get()).settings.replays, { arena: ARENA, quadra: QUADRA, arenaNome: 'IBIZA Beach Sports', quadraNome: 'Quadra 1' });
});

await ta('maiúsculas e espaços em volta são normalizados', async () => {
  const { h } = novo();
  await h.post({ action: 'salvarReplays', arena: '  ' + ARENA.toUpperCase() + ' ', quadra: QUADRA, idToken: 'tok-a' });
  const s = (await h.get()).settings.replays;
  assert.equal(s.arena, ARENA);
  assert.equal(s.arenaNome, '');
});

await ta('identificador que não é hexadecimal de 24: recusado e nada gravado', async () => {
  const { h } = novo();
  for (const [arena, quadra] of [['abc', QUADRA], [ARENA, ''], [ARENA + '&x=1', QUADRA], ['https://registraai.com.br/?a=' + ARENA, QUADRA], [ARENA, '../' + QUADRA]]) {
    const r = await h.post({ action: 'salvarReplays', arena, quadra, idToken: 'tok-a' });
    assert.ok(r.error, JSON.stringify([arena, quadra]));
  }
  assert.equal('replays' in (await h.get()).settings, false);
});

await ta('nome comprido é cortado em 80 caracteres', async () => {
  const { h } = novo();
  await h.post({ action: 'salvarReplays', arena: ARENA, quadra: QUADRA, arenaNome: 'x'.repeat(500), idToken: 'tok-a' });
  assert.equal((await h.get()).settings.replays.arenaNome.length, 80);
});

await ta('desligar: limpa tudo e some da leitura', async () => {
  const { h } = novo();
  await h.post({ action: 'salvarReplays', arena: ARENA, quadra: QUADRA, idToken: 'tok-a' });
  const r = await h.post({ action: 'salvarReplays', remover: true, idToken: 'tok-a' });
  assert.deepEqual(r, { status: 'ok', replays: null });
  assert.equal('replays' in (await h.get()).settings, false);
});

await ta('organizador, jogador e quem não logou: recusados', async () => {
  const { h } = novo();
  for (const idToken of ['tok-b', 'tok-c', undefined]) {
    const r = await h.post({ action: 'salvarReplays', arena: ARENA, quadra: QUADRA, idToken });
    assert.ok(r.error, String(idToken));
  }
  assert.equal('replays' in (await h.get()).settings, false);
});

await ta('salvar as configurações do check-in não apaga os replays', async () => {
  const { h } = novo();
  await h.post({ action: 'salvarReplays', arena: ARENA, quadra: QUADRA, idToken: 'tok-a' });
  const s = (await h.get()).settings;
  await h.post({ action: 'saveSettings', settings: { ...s, checkinVagas: 18 }, idToken: 'tok-a' });
  assert.equal((await h.get()).settings.replays.quadra, QUADRA);
});

fim();
