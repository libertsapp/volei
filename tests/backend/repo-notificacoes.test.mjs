import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';

await ta('repo-memoria: gravarPushInscricao faz upsert por endpoint; removerPushInscricao remove; lerTudo (GET geral) não traz a tabela', async () => {
  const r = criarRepoMemoria({});
  await r.gravarPushInscricao({ id: 'p1', endpoint: 'e1', p256dh: 'a', auth: 'x', criado_em: 't1' });
  await r.gravarPushInscricao({ id: 'p2', endpoint: 'e1', p256dh: 'b', auth: 'y', criado_em: 't2' }); // mesmo endpoint: atualiza
  let linhas = await r.lerPushInscricoes();
  assert.equal(linhas.length, 1);
  assert.deepEqual({ p: linhas[0].p256dh, a: linhas[0].auth }, { p: 'b', a: 'y' });
  await r.gravarPushInscricao({ id: 'p3', endpoint: 'e2', p256dh: 'c', auth: 'z', criado_em: 't3' });
  assert.equal((await r.lerPushInscricoes()).length, 2);
  await r.removerPushInscricao('e1');
  linhas = await r.lerPushInscricoes();
  assert.deepEqual(linhas.map((x) => x.endpoint), ['e2']);
  assert.ok(!('push_inscricoes' in (await r.lerTudo()))); // fora de TABELAS de propósito (mesma razão das sessões)
});

// ---- repo-supabase com um cliente falso (mesmo padrão de repo-financeiro.test.mjs) ----
function clienteFalso(resposta) {
  const chamadas = [];
  const cadeia = (tabela) => {
    const passos = { tabela };
    const q = {
      insert(v) { passos.insert = v; return q; },
      upsert(v, o) { passos.upsert = [v, o]; return q; },
      delete() { passos.delete = true; return q; },
      eq(c, v) { (passos.eq ||= []).push([c, v]); return q; },
      select(c) { passos.select = c; return q; },
      then(res, rej) { chamadas.push(passos); return Promise.resolve(resposta).then(res, rej); }
    };
    return q;
  };
  return { chamadas, from: cadeia };
}

await ta('repo-supabase: gravarPushInscricao é upsert por endpoint; removerPushInscricao e lerPushInscricoes nomeiam a tabela no erro', async () => {
  const c = clienteFalso({ error: null });
  await criarRepoSupabase(c).gravarPushInscricao({ id: 'p1', endpoint: 'e1', p256dh: 'a', auth: 'x' });
  assert.deepEqual(c.chamadas[0], { tabela: 'push_inscricoes', upsert: [{ id: 'p1', endpoint: 'e1', p256dh: 'a', auth: 'x' }, { onConflict: 'endpoint' }] });
  await assert.rejects(() => criarRepoSupabase(clienteFalso({ error: { message: 'boom' } })).gravarPushInscricao({}), /^Error: push_inscricoes: boom$/);
  const c2 = clienteFalso({ error: null });
  await criarRepoSupabase(c2).removerPushInscricao('e1');
  assert.deepEqual(c2.chamadas[0], { tabela: 'push_inscricoes', delete: true, eq: [['endpoint', 'e1']] });
  await assert.rejects(() => criarRepoSupabase(clienteFalso({ data: null, error: { message: 'x' } })).lerPushInscricoes(), /^Error: push_inscricoes: x$/);
  assert.deepEqual(await criarRepoSupabase(clienteFalso({ data: [{ endpoint: 'e1' }], error: null })).lerPushInscricoes(), [{ endpoint: 'e1' }]);
});

fim();
