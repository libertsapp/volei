import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { mapearFinanceiro } from '../../backend/mapeadores.js';
import {
  salvarFinDia, marcarPagamento, estornarPagamento, marcarTodosPagamentos, estornarTodosPagamentos,
  addLancamento, estornarLancamento, aplicarCreditos
} from '../../backend/financeiro.js';

const ORG = { perfil: 'organizador', nome: 'Org', email: 'b@exemplo.com', viaChaveMestra: false };
const ADM = { perfil: 'admin', nome: 'Adm', email: 'a@exemplo.com', viaChaveMestra: false };
const MESTRA = { perfil: 'admin', nome: '', email: '', viaChaveMestra: true };
const SEM_NOME = { perfil: 'organizador', nome: '', email: '', viaChaveMestra: false };

function ambiente(ajustar) {
  const dados = structuredClone(fixture);
  if (ajustar) ajustar(dados);
  let n = 0;
  const repo = criarRepoMemoria(dados);
  return { repo, relogio: () => new Date('2026-09-24T12:00:00.000Z'), gerarId: () => 'id-' + (++n) };
}
const fin = async (d) => mapearFinanceiro(await d.repo.lerTudo());
const pgLinha = (extra) => ({ data: '2026-09-22', jogador_id: 'p4', jogador_nome: 'Fora', valor: 14, marcado_por: 'Org', marcado_em: '2026-09-22T19:00:00+00:00',
  estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, ...extra });

await ta('salvarFinDia: dia novo é gravado com valores em centavos, brinde decidido pelo valor, e escreve o log com antes = null', async () => {
  const d = ambiente();
  const r = await salvarFinDia(d, { data: '2026-10-06', valorPessoa: '13,999', pix: '  k  ', valorQuadra: '180.005', temBrinde: false, valorBrinde: '0,285', icone: '💰' }, ORG);
  assert.equal(r.status, 'ok');
  const dia = r.financeiro.dias.find((x) => x.data === '2026-10-06');
  assert.deepEqual(dia, { data: '2026-10-06', valorPessoa: 14, pix: 'k', valorQuadra: 180.01, temBrinde: true, valorBrinde: 0.28, icone: '💰', status: '' });
  assert.equal(r.financeiro.dias.at(-1).data, '2026-10-06'); // ordem: dia novo no fim
  assert.deepEqual(r.financeiro.log[0], { timestamp: '2026-09-24T12:00:00.000Z', nome: 'Org', acao: 'salvarFinDia',
    detalhe: '{"data":"2026-10-06","antes":null,"depois":{"valorPessoa":14,"pix":"k","valorQuadra":180.01,"temBrinde":true,"valorBrinde":0.28,"icone":"💰"}}' });
});

await ta('salvarFinDia: atualizar mantém a posição e o status "semjogo"; o log traz o antes', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: '2026-09-15', valorPessoa: 20, pix: '', valorQuadra: 1, valorBrinde: 0 }, ADM);
  const f = await fin(d);
  assert.deepEqual(f.dias.map((x) => x.data), ['2026-09-15', '2026-09-22']);
  assert.equal(f.dias[0].status, 'semjogo');
  assert.equal(f.dias[0].valorPessoa, 20);
  assert.match(f.log[0].detalhe, /"antes":\{"valorPessoa":14,"pix":"","valorQuadra":0,"temBrinde":false,"valorBrinde":0,"icone":"✅"\}/);
});

await ta('salvarFinDia: validações (mensagens do .gs) e nada é gravado quando falha', async () => {
  const d = ambiente();
  const antes = await fin(d);
  assert.deepEqual(await salvarFinDia(d, null, ORG), { error: 'Data inválida.' });
  assert.deepEqual(await salvarFinDia(d, { data: '2026-9-1' }, ORG), { error: 'Data inválida.' });
  assert.deepEqual(await salvarFinDia(d, { data: '2026-13-45', valorPessoa: 1 }, ORG), { error: 'Data inválida.' }); // diferença aceita: calendário real
  assert.deepEqual(await salvarFinDia(d, { data: '2026-10-06', valorPessoa: -1 }, ORG), { error: 'Os valores precisam ser números maiores ou iguais a zero.' });
  assert.deepEqual(await salvarFinDia(d, { data: '2026-10-06', valorQuadra: 'abc' }, ORG), { error: 'Os valores precisam ser números maiores ou iguais a zero.' });
  assert.deepEqual(await salvarFinDia(d, { data: '2026-10-06', valorBrinde: 1e9 }, ORG), { error: 'Valor alto demais (máximo 99.999.999,99).' }); // diferença aceita: numeric(10,2)
  assert.deepEqual(await fin(d), antes);
});

await ta('salvarFinDia: dia normal aplica o crédito ativo de um dia anterior (tipo credito, autor Crédito automático); idempotente', async () => {
  const d = ambiente((x) => {
    x.checkins.push({ id: 'k9', data: '2026-09-29', jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, ordem: 4 });
  });
  const r = await salvarFinDia(d, { data: '2026-09-29', valorPessoa: 14, pix: '', valorQuadra: 0, valorBrinde: 0 }, ORG);
  const p = r.financeiro.pagamentos.at(-1);
  assert.deepEqual({ d: p.data, j: p.jogadorId, v: p.valor, t: p.tipo, c: p.creditoId, por: p.marcadoPor }, { d: '2026-09-29', j: 'p2', v: 14, t: 'credito', c: 'cr1', por: 'Crédito automático' });
  assert.equal(r.financeiro.log[0].acao, 'aplicarCreditos');
  assert.equal(r.financeiro.log[0].nome, 'Org'); // o log usa o auth de quem salvou o dia
  assert.equal(r.financeiro.log[0].detalhe, '{"data":"2026-09-29","quantidade":1,"nomes":["Bruno"]}');
  assert.equal(await aplicarCreditos(d, '2026-09-29', ORG), 0); // já tem pagamento válido
});

await ta('marcarPagamento: valor SEMPRE do dia; nome cortado em 80 (no log não); segundo toque não cobra de novo nem loga', async () => {
  const d = ambiente((x) => {
    x.jogadores.push({ id: 'p3', nome: 'Carla', apelido: null, foto: null, estrelas: 1, sexo: 'F', porte: null, convidado: false, removido: false, ordem: 3 });
    x.checkins.push({ id: 'k5', data: '2026-09-22', jogador_id: 'p3', jogador_nome: 'Carla', estrelas: 1, sexo: 'F', estrelas_ajustadas: null, ordem: 4 });
  });
  const r = await marcarPagamento(d, '2026-09-22', 'p3', 'C'.repeat(100), ORG);
  const p = r.financeiro.pagamentos.at(-1);
  assert.deepEqual({ id: p.id, v: p.valor, n: p.jogadorNome.length, por: p.marcadoPor, t: p.tipo, e: p.estornado }, { id: 'id-1', v: 14, n: 80, por: 'Org', t: 'dinheiro', e: false });
  const r2 = await marcarPagamento(d, '2026-09-22', 'p3', 'Carla', ORG);
  assert.equal(r2.financeiro.pagamentos.length, r.financeiro.pagamentos.length);
  assert.equal(r2.financeiro.log.length, r.financeiro.log.length);
  assert.match(r.financeiro.log[0].detalhe, /^\{"data":"2026-09-22","jogadorId":"p3","jogadorNome":"C{100}","valor":14\}$/);
});

await ta('marcarPagamento: erros na ordem do .gs (dados, dia, valor, sem jogo, lista de check-in)', async () => {
  const d = ambiente();
  assert.deepEqual(await marcarPagamento(d, '2026-09-22', '', 'x', ORG), { error: 'Dados do pagamento incompletos.' });
  assert.deepEqual(await marcarPagamento(d, 'x', 'p1', 'x', ORG), { error: 'Dados do pagamento incompletos.' });
  assert.deepEqual(await marcarPagamento(d, '2026-11-03', 'p1', 'x', ORG), { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' });
  await salvarFinDia(d, { data: '2026-11-03', valorPessoa: 0 }, ORG);
  assert.deepEqual(await marcarPagamento(d, '2026-11-03', 'p1', 'x', ORG), { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' });
  assert.deepEqual(await marcarPagamento(d, '2026-09-15', 'p1', 'x', ORG), { error: 'Este dia está marcado como sem jogo. Reabra o dia para marcar pagamentos.' });
  assert.deepEqual(await marcarPagamento(d, '2026-09-22', 'zzz', 'x', ORG), { error: 'Essa pessoa não está na lista de check-in deste dia.' });
});

await ta('marcarPagamento: dois toques quase simultâneos geram UM pagamento válido e UM log (índice único parcial)', async () => {
  const d = ambiente();
  const [a, b] = await Promise.all([marcarPagamento(d, '2026-09-22', 'p2', 'Bruno', ORG), marcarPagamento(d, '2026-09-22', 'p2', 'Bruno', ADM)]);
  assert.equal(a.status, 'ok');
  assert.equal(b.status, 'ok');
  const f = await fin(d);
  assert.equal(f.pagamentos.filter((p) => p.jogadorId === 'p2' && p.data === '2026-09-22' && !p.estornado).length, 1);
  assert.equal(f.log.filter((l) => l.acao === 'marcarPagamento').length, 3); // 2 do fixture + 1 novo
});

await ta('estornarPagamento: organizador corrige quem está na lista; grava quem/quando e loga o motivo; repetir não faz nada', async () => {
  const d = ambiente();
  const r = await estornarPagamento(d, 'pg1', ORG);
  const p = r.financeiro.pagamentos.find((x) => x.id === 'pg1');
  assert.deepEqual({ e: p.estornado, por: p.estornadoPor, em: p.estornadoEm }, { e: true, por: 'Org', em: '2026-09-24T12:00:00.000Z' });
  assert.equal(r.financeiro.log[0].detalhe, '{"data":"2026-09-22","jogadorId":"p1","jogadorNome":"Ana","valor":14,"motivo":"correção de marcação","creditoDevolvido":""}');
  assert.equal((await estornarPagamento(d, 'pg1', ORG)).financeiro.log.length, r.financeiro.log.length);
  assert.deepEqual(await estornarPagamento(d, 'nao-existe', ORG), { error: 'Pagamento não encontrado.' });
});

await ta('estornarPagamento: dinheiro de quem saiu da lista só o admin estorna; pagamento por crédito não tem essa trava', async () => {
  const d = ambiente((x) => {
    x.fin_pagamentos.push(pgLinha({ id: 'pgx', ordem: 4 }), pgLinha({ id: 'pgy', tipo: 'credito', credito_id: 'crz', ordem: 5 }));
  });
  assert.deepEqual(await estornarPagamento(d, 'pgx', ORG), { error: 'Seu perfil (organizador) não tem permissão para estornar o pagamento de quem não está entre os confirmados. Peça ao admin.' });
  assert.match((await estornarPagamento(d, 'pgy', ORG)).financeiro.log[0].detalhe, /"motivo":"crédito devolvido ao saldo"/);
  assert.match((await estornarPagamento(d, 'pgx', ADM)).financeiro.log[0].detalhe, /"motivo":"pessoa fora da lista"/);
});

await ta('estornarPagamento: pagamento que virou crédito ativo devolve o crédito; se já foi usado, recusa e nada muda', async () => {
  const d = ambiente((x) => {
    x.fin_creditos.push({ id: 'cr2', jogador_id: 'p1', jogador_nome: 'Ana', valor: 14, origem_pagamento_id: 'pg1', data_origem: '2026-09-15', criado_por: 'A', criado_em: '2026-09-15T21:00:00+00:00', status: 'ativo', encerrado_por: null, encerrado_em: null, ordem: 2 });
    x.fin_pagamentos.push(pgLinha({ id: 'pgu', data: '2026-09-29', jogador_id: 'p1', jogador_nome: 'Ana', tipo: 'credito', credito_id: 'cr2', ordem: 4 }));
  });
  const antes = await fin(d);
  assert.deepEqual(await estornarPagamento(d, 'pg1', ORG), { error: 'Este pagamento virou crédito e já foi usado em outro dia; não dá para estornar. Desmarque o pagamento por crédito primeiro.' });
  assert.deepEqual(await fin(d), antes);
  await estornarPagamento(d, 'pgu', ORG); // desmarca o uso: o saldo volta
  const r = await estornarPagamento(d, 'pg1', ORG);
  const c = r.financeiro.creditos.find((x) => x.id === 'cr2');
  assert.deepEqual({ s: c.status, por: c.encerradoPor, em: c.encerradoEm }, { s: 'devolvido', por: 'Org', em: '2026-09-24T12:00:00.000Z' });
  assert.match(r.financeiro.log[0].detalhe, /"creditoDevolvido":"cr2"\}$/);
});

await ta('marcarTodosPagamentos: só os dentro das vagas sem pagamento válido; 2ª vez não faz nem loga; validações', async () => {
  const d = ambiente((x) => {
    x.config.find((c) => c.chave === 'checkinVagas').valor = '2';
    x.fin_pagamentos = [];
    x.fin_creditos = [];
  });
  const r = await marcarTodosPagamentos(d, '2026-09-22', ORG);
  assert.deepEqual(r.financeiro.pagamentos.map((p) => [p.jogadorId, p.valor, p.marcadoPor, p.id]), [['p1', 14, 'Org', 'id-1'], ['p2', 14, 'Org', 'id-2']]);
  assert.equal(r.financeiro.log[0].detalhe, '{"data":"2026-09-22","quantidade":2,"valorCada":14,"nomes":["Ana","Bruno"]}');
  assert.equal((await marcarTodosPagamentos(d, '2026-09-22', ORG)).financeiro.log.length, r.financeiro.log.length);
  assert.deepEqual(await marcarTodosPagamentos(d, 'x', ORG), { error: 'Data inválida.' });
  assert.deepEqual(await marcarTodosPagamentos(d, '2026-09-15', ORG), { error: 'Este dia está marcado como sem jogo. Reabra o dia para marcar pagamentos.' });
  assert.deepEqual(await marcarTodosPagamentos(d, '2026-11-03', ORG), { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' });
});

await ta('estornarTodosPagamentos: organizador ignora dinheiro de quem saiu da lista (admin estorna); dia sem jogo é recusado', async () => {
  const d = ambiente((x) => x.fin_pagamentos.push(pgLinha({ id: 'pgx', valor: 7.5, ordem: 4 })));
  const r = await estornarTodosPagamentos(d, '2026-09-22', ORG);
  assert.deepEqual([r.estornados, r.ignorados], [2, 1]); // pg1 e pg3 (check-in sem jogador conta como na lista); pgx fica
  assert.equal(r.financeiro.log[0].detalhe, '{"data":"2026-09-22","quantidade":2,"nomes":["Ana","Antigo"],"total":28,"ignoradosForaDaLista":["Fora"]}');
  const r2 = await estornarTodosPagamentos(d, '2026-09-22', ADM);
  assert.deepEqual([r2.estornados, r2.ignorados], [1, 0]);
  const r3 = await estornarTodosPagamentos(d, '2026-09-22', ADM);
  assert.deepEqual([r3.estornados, r3.ignorados], [0, 0]);
  assert.equal(r3.financeiro.log.length, r2.financeiro.log.length); // nada a fazer: sem log
  assert.deepEqual(await estornarTodosPagamentos(d, '2026-09-15', ADM), { error: 'Este dia está marcado como sem jogo. Reabra o dia para cancelar pagamentos em massa.' });
  assert.deepEqual(await estornarTodosPagamentos(d, '', ADM), { error: 'Data inválida.' });
});

await ta('addLancamento: valida na ordem do .gs, arredonda, corta a descrição em 120 e loga', async () => {
  const d = ambiente();
  const l = (x) => ({ data: '2026-09-22', tipo: 'entrada', valor: 5, descricao: 'ok', ...x });
  assert.deepEqual(await addLancamento(d, null, ORG), { error: 'Data inválida.' });
  assert.deepEqual(await addLancamento(d, l({ data: '22/09' }), ORG), { error: 'Data inválida.' });
  assert.deepEqual(await addLancamento(d, l({ tipo: 'saída' }), ORG), { error: 'Tipo inválido (use entrada ou saída).' });
  for (const v of [0, '', 'x', '-1']) assert.deepEqual(await addLancamento(d, l({ valor: v }), ORG), { error: 'O valor precisa ser maior que zero.' });
  assert.deepEqual(await addLancamento(d, l({ valor: 1e10 }), ORG), { error: 'Valor alto demais (máximo 99.999.999,99).' });
  assert.deepEqual(await addLancamento(d, l({ descricao: '  ' }), ORG), { error: 'Descreva o lançamento.' });
  assert.equal((await fin(d)).lancamentos.length, 1);
  const r = await addLancamento(d, l({ valor: '10,555', tipo: 'saida', descricao: '  ' + 'z'.repeat(130) }), SEM_NOME);
  const novo = r.financeiro.lancamentos.at(-1);
  assert.deepEqual({ v: novo.valor, n: novo.descricao.length, por: novo.criadoPor, t: novo.tipo, e: novo.estornado }, { v: 10.56, n: 120, por: 'Desconhecido', t: 'saida', e: false });
  assert.equal(r.financeiro.log[0].nome, 'Desconhecido');
});

await ta('estornarLancamento: estorna uma vez só (idempotente, sem log repetido); id inexistente dá erro', async () => {
  const d = ambiente();
  const r = await estornarLancamento(d, 'l1', MESTRA);
  const l = r.financeiro.lancamentos[0];
  assert.deepEqual({ e: l.estornado, por: l.estornadoPor }, { e: true, por: 'Chave mestra' });
  assert.equal(r.financeiro.log[0].detalhe, '{"data":"2026-09-01","tipo":"entrada","descricao":"Saldo inicial","valor":500}');
  assert.equal((await estornarLancamento(d, 'l1', ADM)).financeiro.log.length, r.financeiro.log.length);
  assert.deepEqual(await estornarLancamento(d, 'nao-existe', ADM), { error: 'Lançamento não encontrado.' });
});

await ta('log: e-mail fica só na linha do banco (nunca no financeiro devolvido); detalhe gravado verbatim em { texto }', async () => {
  const d = ambiente();
  const r = await addLancamento(d, { data: '2026-09-22', tipo: 'entrada', valor: 1, descricao: 'a' }, ORG);
  assert.equal(JSON.stringify(r).includes('b@exemplo.com'), false);
  const linha = (await d.repo.lerTudo()).fin_log.at(-1);
  assert.deepEqual({ id: linha.id, email: linha.email, acao: linha.acao, tipo: typeof linha.detalhe.texto }, { id: 4, email: 'b@exemplo.com', acao: 'addLancamento', tipo: 'string' });
});

fim();
