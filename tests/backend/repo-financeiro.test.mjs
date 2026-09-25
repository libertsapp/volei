import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';

const repo = () => criarRepoMemoria(fixture);
const pg = (extra) => ({ id: 'n1', data: '2026-09-22', jogador_id: 'p2', jogador_nome: 'Bruno', valor: 14, marcado_por: 'Org', marcado_em: '2026-09-24T12:00:00.000Z', ...extra });

await ta('gravarFinDia: dia novo entra no fim com status normal e ordem do banco; existente muda só os campos enviados', async () => {
  const r = repo();
  await r.gravarFinDia({ data: '2026-10-06', valor_pessoa: 10, pix: '' });
  let t = (await r.lerTudo()).fin_dias;
  assert.deepEqual({ s: t.at(-1).status, o: t.at(-1).ordem }, { s: 'normal', o: 3 });
  await r.gravarFinDia({ data: '2026-09-15', valor_pessoa: 99 });
  t = (await r.lerTudo()).fin_dias;
  const d = t.find((x) => x.data === '2026-09-15');
  assert.deepEqual({ v: d.valor_pessoa, s: d.status, o: d.ordem, p: d.pix }, { v: 99, s: 'semjogo', o: 1, p: '' });
  assert.equal(t.length, 3);
});

await ta('inserirFinPagamento: true ao inserir (ordem do banco); false se já há válido do jogador no dia; estornado não conta; id repetido falha nomeando a tabela', async () => {
  const r = repo();
  assert.equal(await r.inserirFinPagamento(pg()), true);
  assert.equal((await r.lerTudo()).fin_pagamentos.find((p) => p.id === 'n1').ordem, 4);
  assert.equal(await r.inserirFinPagamento(pg({ id: 'n2' })), false); // índice único parcial
  assert.equal(await r.inserirFinPagamento(pg({ id: 'n3', data: '2026-09-29' })), true); // outro dia
  assert.equal(await r.inserirFinPagamento(pg({ id: 'n4', jogador_id: null, jogador_nome: 'A' })), true);
  assert.equal(await r.inserirFinPagamento(pg({ id: 'n5', jogador_id: null, jogador_nome: 'B' })), true); // null não conflita
  await r.estornarFinPagamento('n1', { por: 'x', em: 'y' });
  assert.equal(await r.inserirFinPagamento(pg({ id: 'n6' })), true); // o anterior está estornado
  await assert.rejects(() => r.inserirFinPagamento(pg({ id: 'n6' })), /fin_pagamentos.*duplicate key/);
});

await ta('estornarFinPagamento / estornarFinLancamento: só estornam uma vez (false na segunda) e preservam quem estornou primeiro', async () => {
  const r = repo();
  assert.equal(await r.estornarFinPagamento('pg1', { por: 'A', em: 't1' }), true);
  assert.equal(await r.estornarFinPagamento('pg1', { por: 'B', em: 't2' }), false);
  assert.equal(await r.estornarFinPagamento('nao-existe', { por: 'B', em: 't2' }), false);
  const p = (await r.lerTudo()).fin_pagamentos.find((x) => x.id === 'pg1');
  assert.deepEqual({ e: p.estornado, por: p.estornado_por, em: p.estornado_em }, { e: true, por: 'A', em: 't1' });
  assert.equal(await r.estornarFinLancamento('l1', { por: 'A', em: 't1' }), true);
  assert.equal(await r.estornarFinLancamento('l1', { por: 'B', em: 't2' }), false);
});

await ta('encerrarFinCredito: só encerra crédito ativo; inserirFinLancamento e inserirFinLog usam o padrão do banco', async () => {
  const r = repo();
  assert.equal(await r.encerrarFinCredito('cr1', 'devolvido', { por: 'A', em: 't' }), true);
  assert.equal(await r.encerrarFinCredito('cr1', 'cancelado', { por: 'B', em: 't2' }), false);
  const c = (await r.lerTudo()).fin_creditos[0];
  assert.deepEqual({ s: c.status, por: c.encerrado_por }, { s: 'devolvido', por: 'A' });
  await r.inserirFinLancamento({ id: 'l2', data: '2026-09-22', tipo: 'saida', descricao: 'x', valor: 1, criado_por: 'A', criado_em: 't' });
  const l = (await r.lerTudo()).fin_lancamentos.find((x) => x.id === 'l2');
  assert.deepEqual({ o: l.ordem, e: l.estornado }, { o: 2, e: false });
  await assert.rejects(() => r.inserirFinLancamento({ id: 'l2' }), /fin_lancamentos.*duplicate key/);
  await r.inserirFinLog({ timestamp: 't', nome: 'n', email: '', acao: 'a', detalhe: { texto: '{}' } });
  assert.equal((await r.lerTudo()).fin_log.at(-1).id, 4); // o maior do fixture é 3
});

// ---- repo-supabase com um cliente falso que registra as chamadas (sem rede) ----
function clienteFalso(resposta) {
  const chamadas = [];
  const cadeia = (tabela) => {
    const passos = { tabela };
    const q = {
      insert(v) { passos.insert = v; return q; },
      upsert(v, o) { passos.upsert = [v, o]; return q; },
      update(v) { passos.update = v; return q; },
      eq(c, v) { (passos.eq ||= []).push([c, v]); return q; },
      select(c) { passos.select = c; return q; },
      then(res, rej) { chamadas.push(passos); return Promise.resolve(resposta).then(res, rej); }
    };
    return q;
  };
  return { chamadas, from: cadeia };
}

await ta('repo-supabase: gravarFinDia faz upsert por data sem enviar status nem ordem; erros nomeiam a tabela', async () => {
  const c = clienteFalso({ error: null });
  await criarRepoSupabase(c).gravarFinDia({ data: '2026-10-06', valor_pessoa: 1 });
  assert.deepEqual(c.chamadas[0], { tabela: 'fin_dias', upsert: [{ data: '2026-10-06', valor_pessoa: 1 }, { onConflict: 'data' }] });
  await assert.rejects(() => criarRepoSupabase(clienteFalso({ error: { message: 'boom' } })).gravarFinDia({}), /^Error: fin_dias: boom$/);
});

await ta('repo-supabase: inserirFinPagamento devolve false só para a violação do índice único parcial; outros erros propagam', async () => {
  assert.equal(await criarRepoSupabase(clienteFalso({ error: null })).inserirFinPagamento({ id: 'x' }), true);
  const dup = { code: '23505', message: 'duplicate key value violates unique constraint "fin_pagamentos_valido_uniq"' };
  assert.equal(await criarRepoSupabase(clienteFalso({ error: dup })).inserirFinPagamento({ id: 'x' }), false);
  const pkey = { code: '23505', message: 'duplicate key value violates unique constraint "fin_pagamentos_pkey"' };
  await assert.rejects(() => criarRepoSupabase(clienteFalso({ error: pkey })).inserirFinPagamento({ id: 'x' }), /fin_pagamentos: duplicate key/);
  await assert.rejects(() => criarRepoSupabase(clienteFalso({ error: { code: '23503', message: 'fk' } })).inserirFinPagamento({ id: 'x' }), /fin_pagamentos: fk/);
});

await ta('repo-supabase: estornos são UPDATE condicional (estornado = false) e devolvem se alguma linha mudou', async () => {
  const c = clienteFalso({ data: [{ id: 'pg1' }], error: null });
  assert.equal(await criarRepoSupabase(c).estornarFinPagamento('pg1', { por: 'A', em: 't' }), true);
  assert.deepEqual(c.chamadas[0], { tabela: 'fin_pagamentos', update: { estornado: true, estornado_por: 'A', estornado_em: 't' }, eq: [['id', 'pg1'], ['estornado', false]], select: 'id' });
  assert.equal(await criarRepoSupabase(clienteFalso({ data: [], error: null })).estornarFinLancamento('l1', { por: 'A', em: 't' }), false);
  const c2 = clienteFalso({ data: [{ id: 'cr1' }], error: null });
  assert.equal(await criarRepoSupabase(c2).encerrarFinCredito('cr1', 'devolvido', { por: 'A', em: 't' }), true);
  assert.deepEqual(c2.chamadas[0].eq, [['id', 'cr1'], ['status', 'ativo']]);
  await assert.rejects(() => criarRepoSupabase(clienteFalso({ data: null, error: { message: 'x' } })).estornarFinLancamento('l1', {}), /^Error: fin_lancamentos: x$/);
});

await ta('repo-supabase: inserirFinLancamento e inserirFinLog não enviam ordem/id', async () => {
  const c = clienteFalso({ error: null });
  const r = criarRepoSupabase(c);
  await r.inserirFinLancamento({ id: 'l', valor: 1 });
  await r.inserirFinLog({ acao: 'a' });
  assert.deepEqual(c.chamadas.map((x) => [x.tabela, Object.keys(x.insert)]), [['fin_lancamentos', ['id', 'valor']], ['fin_log', ['acao']]]);
});

// ---- etapa 4b: status do dia e inserção de crédito ----
await ta('definirStatusFinDia: muda só o status de um dia existente (false se não existe); inserirFinCredito usa status ativo e ordem do banco', async () => {
  const r = repo();
  assert.equal(await r.definirStatusFinDia('2026-09-22', 'semjogo'), true);
  const d = (await r.lerTudo()).fin_dias.find((x) => x.data === '2026-09-22');
  assert.deepEqual({ s: d.status, v: d.valor_pessoa, o: d.ordem }, { s: 'semjogo', v: 14, o: 2 });
  assert.equal(await r.definirStatusFinDia('2026-09-22', 'normal'), true);
  assert.equal((await r.lerTudo()).fin_dias.find((x) => x.data === '2026-09-22').status, 'normal');
  assert.equal(await r.definirStatusFinDia('2030-01-01', 'semjogo'), false);
  await r.inserirFinCredito({ id: 'cr9', jogador_id: 'p1', jogador_nome: 'Ana', valor: 5, origem_pagamento_id: 'pg1', data_origem: '2026-09-22', criado_por: 'A', criado_em: 't' });
  const c = (await r.lerTudo()).fin_creditos.find((x) => x.id === 'cr9');
  assert.deepEqual({ s: c.status, o: c.ordem }, { s: 'ativo', o: 2 });
  await assert.rejects(() => r.inserirFinCredito({ id: 'cr9' }), /fin_creditos.*duplicate key/);
});

await ta('repo-supabase: definirStatusFinDia é UPDATE por data (true se mudou linha); inserirFinCredito insere e erros nomeiam a tabela', async () => {
  const c = clienteFalso({ data: [{ data: '2026-09-22' }], error: null });
  assert.equal(await criarRepoSupabase(c).definirStatusFinDia('2026-09-22', 'semjogo'), true);
  assert.deepEqual(c.chamadas[0], { tabela: 'fin_dias', update: { status: 'semjogo' }, eq: [['data', '2026-09-22']], select: 'data' });
  assert.equal(await criarRepoSupabase(clienteFalso({ data: [], error: null })).definirStatusFinDia('x', 'normal'), false);
  await assert.rejects(() => criarRepoSupabase(clienteFalso({ data: null, error: { message: 'x' } })).definirStatusFinDia('x', 'normal'), /^Error: fin_dias: x$/);
  const c2 = clienteFalso({ error: null });
  await criarRepoSupabase(c2).inserirFinCredito({ id: 'cr', valor: 1 });
  assert.deepEqual(c2.chamadas[0], { tabela: 'fin_creditos', insert: { id: 'cr', valor: 1 } });
  await assert.rejects(() => criarRepoSupabase(clienteFalso({ error: { message: 'fk' } })).inserirFinCredito({ id: 'cr' }), /^Error: fin_creditos: fk$/);
});

fim();
