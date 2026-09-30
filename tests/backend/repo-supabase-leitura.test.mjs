// Leitura do repositório real (repo-supabase.js) com um cliente Supabase FALSO: uma falha passageira do banco
// (erro devolvido ou exceção de rede) não pode derrubar o GET inteiro — a consulta é tentada de novo.
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';

// falhas: { tabela: [ 'erro' | 'excecao' | 'ok', ... ] } — o que cada chamada sucessiva àquela tabela faz
function clienteFalso(falhas = {}) {
  const chamadas = {};
  const responder = (tabela) => {
    const n = (chamadas[tabela] = (chamadas[tabela] || 0) + 1);
    const plano = (falhas[tabela] || [])[n - 1] || 'ok';
    if (plano === 'excecao') return Promise.reject(new TypeError('fetch failed'));
    if (plano === 'erro') return Promise.resolve({ data: null, error: { message: 'connection reset' } });
    return Promise.resolve({ data: [{ id: tabela + '-1' }], error: null });
  };
  const consulta = (tabela) => {
    const q = { order: () => q, range: () => responder(tabela), limit: () => responder(tabela) };
    return q;
  };
  return { chamadas, from: (tabela) => ({ select: () => consulta(tabela) }) };
}
const semEspera = { esperar: async () => {} };

await ta('lerTudo: uma tabela que falha 1x (erro do banco) é lida de novo e o GET funciona', async () => {
  const c = clienteFalso({ rodadas: ['erro'] });
  const t = await criarRepoSupabase(c, semEspera).lerTudo();
  assert.deepEqual(t.rodadas, [{ id: 'rodadas-1' }]);
  assert.equal(c.chamadas.rodadas, 2);
});

await ta('lerTudo: exceção de rede ("fetch failed") também é tentada de novo, até 2x seguidas', async () => {
  const c = clienteFalso({ checkins: ['excecao', 'excecao'], fin_log: ['erro'] });
  const t = await criarRepoSupabase(c, semEspera).lerTudo();
  assert.deepEqual(t.checkins, [{ id: 'checkins-1' }]);
  assert.equal(c.chamadas.checkins, 3);
  assert.equal(c.chamadas.fin_log, 2);
});

await ta('lerTudo: falha persistente desiste depois de 3 tentativas e lança a mensagem com o nome da tabela', async () => {
  const c = clienteFalso({ jogadores: ['erro', 'erro', 'erro', 'ok'] });
  await assert.rejects(criarRepoSupabase(c, semEspera).lerTudo(), /jogadores: connection reset/);
  assert.equal(c.chamadas.jogadores, 3);
});

await ta('lerTudo: sem falha nenhuma, cada tabela é lida uma única vez', async () => {
  const c = clienteFalso();
  await criarRepoSupabase(c, semEspera).lerTudo();
  assert.ok(Object.values(c.chamadas).every((n) => n === 1));
});

fim();
