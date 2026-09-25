import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const handler = () => criarHandler({ repo: criarRepoMemoria(fixture) });

await ta('get: devolve as 7 chaves do contrato', async () => {
  const r = await handler().get();
  assert.deepEqual(Object.keys(r).sort(), ['aoVivo', 'checkins', 'financeiro', 'perfisPublicos', 'players', 'rounds', 'settings']);
  assert.equal(r.players.length, 2);
  assert.equal(r.rounds.length, 2);
  assert.equal(r.checkins.length, 3);
  assert.equal(r.settings.checkinVagas, 12);
});

await ta('get: erro do repositório vira { error } como o doGet', async () => {
  const h = criarHandler({ repo: { async lerTudo() { throw new Error('banco fora do ar'); } } });
  assert.deepEqual(await h.get(), { error: 'banco fora do ar' });
});

await ta('post incrementarAcesso: soma 1 ao contador e devolve o novo valor (etapa 5)', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ action: 'incrementarAcesso' }), { contadorAcessos: 42 });
  assert.equal((await h.get()).settings.contadorAcessos, 42);
});

fim();
