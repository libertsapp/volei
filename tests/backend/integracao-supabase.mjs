// Lê o Supabase REAL (somente leitura) e confere o resultado do GET com os números conhecidos da
// migração. Uso: node tests/backend/integracao-supabase.mjs   (precisa do .env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY)
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarHandler } from '../../backend/handler.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const handler = criarHandler({ repo: criarRepoSupabase(cliente) });

let r;
await ta('GET real: responde sem erro e mede o tempo', async () => {
  const inicio = performance.now();
  r = await handler.get();
  const ms = Math.round(performance.now() - inicio);
  console.log('       tempo do GET:', ms, 'ms');
  assert.equal(r.error, undefined, r.error);
});

await ta('GET real: contagens iguais às da migração', async () => {
  assert.equal(r.players.length, 47);
  assert.equal(r.rounds.length, 34);
  assert.equal(r.checkins.length, 75);
  assert.equal(r.financeiro.dias.length, 2);
  assert.equal(r.financeiro.pagamentos.length, 34);
  assert.equal(r.financeiro.creditos.length, 16);
  assert.equal(r.financeiro.lancamentos.length, 1);
  assert.equal(r.financeiro.log.length, 47);
  assert.equal(r.rounds.reduce((soma, x) => soma + x.vencedores.length, 0), 33);
});

await ta('GET real: convidados aparecem nos times e não na lista de jogadores', async () => {
  const idsJogadores = new Set(r.players.map((p) => p.id));
  const idsNosTimes = r.rounds.flatMap((x) => x.times.flatMap((tm) => (tm ? tm.playerIds : [])));
  assert.ok(idsNosTimes.some((id) => id.startsWith('convidado:')));
  assert.ok(!r.players.some((p) => p.id.startsWith('convidado:')));
  assert.ok(idsNosTimes.filter((id) => !id.startsWith('convidado:')).every((id) => idsJogadores.has(id)));
});

await ta('GET real: perfisPublicos bate com os usuários vinculados', async () => {
  const { data } = await cliente.from('usuarios').select('jogador_id');
  assert.equal(r.perfisPublicos.length, data.filter((u) => u.jogador_id).length);
});

fim();
