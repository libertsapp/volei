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

// ---------- v20.3: quadra de cada dia ----------
const Q2 = '6973976bf60a9f8fabaa7947';
const ligado = async () => {
  const n = novo();
  await n.h.post({ action: 'salvarReplays', arena: ARENA, quadra: QUADRA, quadraNome: 'Quadra 1', idToken: 'tok-a' });
  return n;
};

await ta('quadra do dia: organizador marca, volta na leitura; sem marcação não aparece "dias"', async () => {
  const { h } = await ligado();
  assert.equal('dias' in (await h.get()).settings.replays, false);
  const r = await h.post({ action: 'salvarQuadraDoDia', data: '2026-10-13', quadra: Q2, nome: 'Quadra 2', idToken: 'tok-b' });
  assert.equal(r.status, 'ok');
  assert.deepEqual((await h.get()).settings.replays.dias, { '2026-10-13': { quadra: Q2, nome: 'Quadra 2' } });
});

await ta('quadra do dia: quadra vazia volta ao padrão (e some "dias" quando não sobra nenhum)', async () => {
  const { h } = await ligado();
  await h.post({ action: 'salvarQuadraDoDia', data: '2026-10-13', quadra: Q2, idToken: 'tok-a' });
  await h.post({ action: 'salvarQuadraDoDia', data: '2026-10-13', quadra: '', idToken: 'tok-a' });
  assert.equal('dias' in (await h.get()).settings.replays, false);
});

await ta('quadra do dia: jogador e quem não logou recusados; data/quadra inválidas recusadas', async () => {
  const { h } = await ligado();
  for (const idToken of ['tok-c', undefined]) assert.ok((await h.post({ action: 'salvarQuadraDoDia', data: '2026-10-13', quadra: Q2, idToken })).error);
  for (const [data, quadra] of [['13/10/2026', Q2], ['2026-10-13', 'xyz'], ['', Q2]]) {
    assert.ok((await h.post({ action: 'salvarQuadraDoDia', data, quadra, idToken: 'tok-a' })).error, data + quadra);
  }
  assert.equal('dias' in (await h.get()).settings.replays, false);
});

await ta('quadra do dia: replays desligados = recusado', async () => {
  const { h } = novo();
  assert.ok((await h.post({ action: 'salvarQuadraDoDia', data: '2026-10-13', quadra: Q2, idToken: 'tok-a' })).error);
});

await ta('quadra do dia: guarda só os 60 dias mais recentes', async () => {
  const { h } = await ligado();
  const base = Date.parse('2026-01-01T12:00:00Z');
  for (let i = 0; i < 65; i++) {
    const d = new Date(base + i * 86400000).toISOString().slice(0, 10);
    await h.post({ action: 'salvarQuadraDoDia', data: d, quadra: Q2, idToken: 'tok-a' });
  }
  const dias = Object.keys((await h.get()).settings.replays.dias).sort();
  assert.equal(dias.length, 60);
  assert.equal(dias[0], '2026-01-06');
});

await ta('quadra do dia: JSON estragado no banco não derruba a leitura', async () => {
  const { h, repo } = await ligado();
  await repo.gravarConfig([{ chave: 'replaysDias', valor: '{quebrado' }]);
  assert.equal((await h.get()).settings.replays.quadra, QUADRA);
  await repo.gravarConfig([{ chave: 'replaysDias', valor: JSON.stringify({ '2026-10-13': { quadra: 'x' }, 'lixo': { quadra: Q2 }, '2026-10-06': { quadra: Q2, nome: 'Quadra 2' } }) }]);
  assert.deepEqual((await h.get()).settings.replays.dias, { '2026-10-06': { quadra: Q2, nome: 'Quadra 2' } });
});

await ta('desligar os replays limpa também as quadras dos dias', async () => {
  const { h, repo } = await ligado();
  await h.post({ action: 'salvarQuadraDoDia', data: '2026-10-13', quadra: Q2, idToken: 'tok-a' });
  await h.post({ action: 'salvarReplays', remover: true, idToken: 'tok-a' });
  assert.equal(((await repo.lerConfig()).find((c) => c.chave === 'replaysDias') || {}).valor, '');
});

fim();
