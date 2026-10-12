import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarEdge } from '../../backend/edge.js';

await ta('GET repassa os parâmetros da URL ao handler (?g=quinta)', async () => {
  let recebido;
  const edge = criarEdge({ handler: { get: async (ctx) => { recebido = ctx; return { ok: 1 }; }, post: async () => ({}) } });
  const r = await edge(new Request('https://x.supabase.co/functions/v1/grupos-api?g=quinta&v=2'));
  assert.equal(r.status, 200);
  assert.deepEqual(recebido, { consulta: { g: 'quinta', v: '2' } });
});

await ta('GET sem parâmetros: consulta vazia (handler antigo, que ignora o argumento, não muda)', async () => {
  let recebido;
  const edge = criarEdge({ handler: { get: async (ctx) => { recebido = ctx; return { players: [] }; }, post: async () => ({}) } });
  const r = await edge(new Request('https://x.supabase.co/functions/v1/terca-api-teste'));
  assert.deepEqual(await r.json(), { players: [] });
  assert.deepEqual(recebido, { consulta: {} });
});

await ta('POST também repassa os parâmetros da URL (o app de grupo manda ?g= em todas as chamadas)', async () => {
  let recebido;
  const edge = criarEdge({ handler: { get: async () => ({}), post: async (b, ctx) => { recebido = ctx; return { ok: 1 }; } }, origensPermitidas: ['https://volei.memberstars.com'] });
  const r = await edge(new Request('https://x.supabase.co/functions/v1/grupos-api?g=quinta', {
    method: 'POST', headers: { origin: 'https://volei.memberstars.com', 'content-type': 'text/plain' }, body: JSON.stringify({ action: 'ping' })
  }));
  assert.equal(r.status, 200);
  assert.deepEqual(recebido.consulta, { g: 'quinta' });
  assert.ok('ip' in recebido);
});

fim();
