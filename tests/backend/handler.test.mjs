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

await ta('post incrementarAcesso: devolve o contador atual (leitura; gravar é da etapa 5)', async () => {
  assert.deepEqual(await handler().post({ action: 'incrementarAcesso' }), { contadorAcessos: 41 });
});

await ta('post de ação ainda não portada: erro claro com o nome da ação', async () => {
  const r = await handler().post({ action: 'addCheckin' });
  assert.match(r.error, /ainda não está disponível/);
  assert.match(r.error, /addCheckin/);
});

fim();
