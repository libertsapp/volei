// Ajuste 12: a rodada guarda o horário do jogo ('HH:MM') e o GET devolve junto; lixo vira '' e rodada antiga continua sem horário.
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const verificarToken = async (t) => (t === 'tok-b' ? { ok: true, email: 'b@exemplo.com', nome: 'B' } : { ok: false, erro: 'inválido' });
const novo = () => criarHandler({ repo: criarRepoMemoria(structuredClone(fixture)), config: {}, verificarToken });
const rodada = (extra) => ({ id: 'rh1', data: '2026-10-13', rascunho: true, vencedores: [], times: [{ nome: 'Time 1', vitorias: 0, playerIds: ['p1'] }], ...extra });
const achar = async (h, id) => (await h.get()).rounds.find((r) => r.id === id);

await ta('addRound com horário: o GET devolve o horário', async () => {
  const h = novo();
  assert.deepEqual(await h.post({ action: 'addRound', idToken: 'tok-b', round: rodada({ horario: '20:00' }) }), { status: 'ok' });
  assert.equal((await achar(h, 'rh1')).horario, '20:00');
});

await ta('updateRound mantém/atualiza o horário (lançar placar de um rascunho)', async () => {
  const h = novo();
  await h.post({ action: 'addRound', idToken: 'tok-b', round: rodada({ horario: '20:00' }) });
  await h.post({ action: 'updateRound', idToken: 'tok-b', round: rodada({ horario: '21:30', rascunho: false, vencedores: [0] }) });
  const r = await achar(h, 'rh1');
  assert.equal(r.horario, '21:30');
  assert.equal(r.rascunho, false);
});

await ta('sem horário, horário vazio ou lixo: vira "" (nunca quebra a gravação)', async () => {
  for (const horario of [undefined, null, '', '25:99', 'meio-dia', '8:00', '20:00; drop table']) {
    const h = novo();
    assert.deepEqual(await h.post({ action: 'addRound', idToken: 'tok-b', round: rodada({ horario }) }), { status: 'ok' }, String(horario));
    assert.equal((await achar(h, 'rh1')).horario, '', String(horario));
  }
});

await ta('rodadas que já existiam (sem coluna preenchida) saem com horario ""', async () => {
  const h = novo();
  const todas = (await h.get()).rounds;
  assert.ok(todas.length > 0);
  assert.ok(todas.every((r) => r.horario === ''));
});

fim();
