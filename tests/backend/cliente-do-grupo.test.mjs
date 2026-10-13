import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { clienteDoGrupo } from '../../backend/cliente-do-grupo.js';
import { clienteGravador } from './cliente-gravador.mjs';

const G = '11111111-1111-1111-1111-111111111111';
const OUTRO = '22222222-2222-2222-2222-222222222222';

t('exige um grupoId', () => {
  assert.throws(() => clienteDoGrupo(clienteGravador(), ''), /grupoId/);
});

await ta('select, update e delete ganham o filtro do grupo antes de qualquer outro', async () => {
  const c = clienteGravador();
  const g = clienteDoGrupo(c, G);
  await g.from('jogadores').select('*').order('id').range(0, 999);
  await g.from('checkins').update({ estrelas_ajustadas: 3 }).eq('id', 'c1').select('id');
  await g.from('sessoes').delete().eq('email', 'a@x.com').lte('expira_em', 'agora');
  assert.deepEqual(c.ops.map((o) => [o.tabela, o.verbo, o.filtros[0]]), [
    ['jogadores', 'select', ['eq', 'grupo_id', G]],
    ['checkins', 'update', ['eq', 'grupo_id', G]],
    ['sessoes', 'delete', ['eq', 'grupo_id', G]]
  ]);
  assert.deepEqual(c.ops[2].filtros.slice(1), [['eq', 'email', 'a@x.com'], ['lte', 'expira_em', 'agora']]);
});

await ta('insert e upsert gravam o grupo em cada linha (objeto ou lista) e prefixam o onConflict', async () => {
  const c = clienteGravador();
  const g = clienteDoGrupo(c, G);
  await g.from('jogadores').insert({ id: 'p1', nome: 'Ana' });
  await g.from('ao_vivo').insert([{ round_id: 'r1' }, { round_id: 'r1' }]);
  await g.from('fin_dias').upsert({ data: '2026-10-13' }, { onConflict: 'data' });
  await g.from('config').upsert([{ chave: 'a', valor: '1' }]);
  assert.deepEqual(c.ops[0].carga, { id: 'p1', nome: 'Ana', grupo_id: G });
  assert.ok(c.ops[1].carga.every((l) => l.grupo_id === G));
  assert.deepEqual(c.ops[2].opcoes, { onConflict: 'grupo_id,data' });
  assert.equal(c.ops[3].opcoes, undefined); // sem onConflict: vale a chave primária, que já começa por grupo_id
  assert.equal(c.ops[3].carga[0].grupo_id, G);
});

await ta('não altera o objeto do chamador', async () => {
  const g = clienteDoGrupo(clienteGravador(), G);
  const linha = { id: 'p1' };
  await g.from('jogadores').insert(linha);
  assert.deepEqual(linha, { id: 'p1' });
});

await ta('rpc recebe p_grupo_id junto dos parâmetros (inclusive quando não há parâmetros)', async () => {
  const c = clienteGravador();
  const g = clienteDoGrupo(c, G);
  await g.rpc('pegar_trava', { p_nome: 'gravacao', p_dono: 'd', p_ttl_seg: 30 });
  await g.rpc('incrementar_acesso');
  assert.deepEqual(c.ops[0].params, { p_grupo_id: G, p_nome: 'gravacao', p_dono: 'd', p_ttl_seg: 30 });
  assert.deepEqual(c.ops[1].params, { p_grupo_id: G });
});

t('recusa linha de outro grupo, update que troca o grupo e rpc que já traz p_grupo_id', () => {
  const g = clienteDoGrupo(clienteGravador(), G);
  assert.throws(() => g.from('jogadores').insert({ id: 'p1', grupo_id: OUTRO }), /outro grupo/);
  assert.throws(() => g.from('jogadores').upsert([{ id: 'p1' }, { id: 'p2', grupo_id: OUTRO }]), /outro grupo/);
  assert.throws(() => g.from('jogadores').update({ grupo_id: OUTRO }), /grupo_id/);
  assert.throws(() => g.rpc('remover_rodada', { p_grupo_id: OUTRO, p_id: 'r1' }), /p_grupo_id/);
  // a mesma linha já marcada com o PRÓPRIO grupo é aceita
  assert.doesNotThrow(() => g.from('jogadores').insert({ id: 'p1', grupo_id: G }));
});

fim();
