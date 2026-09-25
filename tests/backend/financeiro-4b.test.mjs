import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { mapearFinanceiro, mapearCheckins } from '../../backend/mapeadores.js';
import {
  salvarFinDia, marcarPagamento, marcarDiaSemJogo, reabrirDia, aplicarCreditosDoDia, devolverCredito, aplicarCreditos
} from '../../backend/financeiro.js';
import { addCheckin, removeCheckin } from '../../backend/checkins.js';

// Unidade da etapa 4b: as quatro ações novas e os ganchos do check-in (addCheckin/removeCheckin), com o repositório em memória.
// Fixture: dia 22/09 normal (14), 15/09 sem jogo; check-ins de 22/09: Ana (c1), Bruno (c2), antigo sem jogador (c3), 12 vagas;
// pg1 Ana e pg3 antigo pagos em dinheiro; pg2 Bruno por crédito estornado; cr1 Bruno (14, de 15/09) ativo.
const ORG = { perfil: 'organizador', nome: 'Org', email: 'b@exemplo.com', viaChaveMestra: false };
const ADM = { perfil: 'admin', nome: 'Adm', email: 'a@exemplo.com', viaChaveMestra: false };
const MESTRA = { perfil: 'admin', nome: '', email: '', viaChaveMestra: true };

function ambiente(ajustar) {
  const dados = structuredClone(fixture);
  if (ajustar) ajustar(dados);
  let n = 0;
  const repo = criarRepoMemoria(dados);
  const avisos = [];
  return { repo, relogio: () => new Date('2026-09-24T12:00:00.000Z'), gerarId: () => 'id-' + (++n), avisar: (m) => avisos.push(m), avisos };
}
const fin = async (d) => mapearFinanceiro(await d.repo.lerTudo());
const jog = (id, nome, ordem) => ({ id, nome, apelido: null, foto: null, estrelas: 3, sexo: 'M', porte: null, convidado: false, removido: false, ordem });
const ck = (id, data, jid, nome, ordem) => ({ id, data, jogador_id: jid, jogador_nome: nome, estrelas: 3, sexo: 'M', estrelas_ajustadas: null, ordem });
const pg = (id, data, jid, nome, valor, ordem, extra) => ({ id, data, jogador_id: jid, jogador_nome: nome, valor, marcado_por: 'Org',
  marcado_em: data + 'T19:00:00+00:00', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, ordem, ...extra });
const cr = (id, jid, nome, valor, origem, dataOrigem, ordem, extra) => ({ id, jogador_id: jid, jogador_nome: nome, valor, origem_pagamento_id: origem, data_origem: dataOrigem,
  criado_por: 'Adm', criado_em: dataOrigem + 'T21:00:00+00:00', status: 'ativo', encerrado_por: null, encerrado_em: null, ordem, ...extra });
const diaLinha = (data, valor, ordem, status = 'normal') => ({ data, valor_pessoa: valor, pix: '', valor_quadra: 0, tem_brinde: false, valor_brinde: 0, atualizado_por: 'Adm', atualizado_em: data + 'T18:00:00+00:00', icone: null, status, ordem });
const validos = (f, data) => f.pagamentos.filter((p) => p.data === data && !p.estornado);

// ============================== marcarDiaSemJogo ==============================

await ta('marcarDiaSemJogo (crédito): o dinheiro do dia vira crédito (com nome/valor/origem), o dia fica semjogo, log verbatim e resposta com contadores', async () => {
  const d = ambiente();
  const r = await marcarDiaSemJogo(d, '2026-09-22', undefined, ORG);
  assert.deepEqual([r.status, r.creditos, r.estornados, r.ignorados], ['ok', 2, 0, 0]);
  assert.equal(r.financeiro.dias.find((x) => x.data === '2026-09-22').status, 'semjogo');
  const novos = r.financeiro.creditos.slice(1); // o cr1 do fixture vem antes
  assert.deepEqual(novos.map((c) => [c.id, c.jogadorId, c.jogadorNome, c.valor, c.origemPagamentoId, c.dataOrigem, c.criadoPor, c.status]),
    [['id-1', 'p1', 'Ana', 14, 'pg1', '2026-09-22', 'Org', 'ativo'], ['id-2', '', 'Antigo', 14, 'pg3', '2026-09-22', 'Org', 'ativo']]);
  assert.equal(r.financeiro.log[0].detalhe, '{"data":"2026-09-22","destino":"credito","creditos":2,"estornados":0,"ignorados":0,"nomes":["Ana","Antigo"]}');
  assert.equal(r.financeiro.log[0].acao, 'marcarDiaSemJogo');
  assert.equal(validos(r.financeiro, '2026-09-22').length, 2); // o dinheiro continua no caixa (virou crédito): pagamentos válidos
});

await ta('marcarDiaSemJogo: validações (mensagens do .gs), idempotência sem log e destino desconhecido vira crédito', async () => {
  const d = ambiente();
  const antes = await fin(d);
  assert.deepEqual(await marcarDiaSemJogo(d, 'x', 'credito', ORG), { error: 'Data inválida.' });
  assert.deepEqual(await marcarDiaSemJogo(d, undefined, 'credito', ORG), { error: 'Data inválida.' });
  assert.deepEqual(await marcarDiaSemJogo(d, '2026-11-03', 'credito', ORG), { error: 'Configure o dia (valor por pessoa etc.) antes de marcá-lo como sem jogo.' });
  assert.deepEqual(await fin(d), antes);
  const r = await marcarDiaSemJogo(d, '2026-09-15', 'devolver', ADM); // já era semjogo
  assert.deepEqual([r.creditos, r.estornados, r.ignorados], [0, 0, 0]);
  assert.equal(r.financeiro.log.length, antes.log.length);
  const r2 = await marcarDiaSemJogo(d, '2026-09-22', 'qualquer-coisa', ORG);
  assert.match(r2.financeiro.log[0].detalhe, /"destino":"credito"/);
});

await ta('marcarDiaSemJogo (devolver): organizador ignora dinheiro de quem saiu da lista; admin estorna tudo; pagamento por crédito só devolve o crédito', async () => {
  const setup = (x) => {
    x.fin_pagamentos.push(pg('pgx', '2026-09-22', 'p9', 'Fora', 7.5, 4), pg('pgc', '2026-09-22', 'p2', 'Bruno', 14, 5, { tipo: 'credito', credito_id: 'cr1' }));
    x.jogadores.push(jog('p9', 'Fora', 9));
  };
  const d = ambiente(setup);
  const r = await marcarDiaSemJogo(d, '2026-09-22', 'devolver', ORG);
  assert.deepEqual([r.creditos, r.estornados, r.ignorados], [0, 2, 1]);
  assert.equal(r.financeiro.log[0].detalhe, '{"data":"2026-09-22","destino":"devolver","creditos":0,"estornados":2,"ignorados":1,"nomes":["Ana","Antigo"]}');
  const p = (id) => r.financeiro.pagamentos.find((x) => x.id === id);
  assert.deepEqual([p('pg1').estornado, p('pg3').estornado, p('pgx').estornado, p('pgc').estornado], [true, true, false, true]);
  assert.deepEqual([p('pg1').estornadoPor, p('pgc').estornadoPor], ['Org', 'Org']);
  assert.equal(r.financeiro.creditos.find((c) => c.id === 'cr1').status, 'ativo'); // o crédito do Bruno voltou ao saldo (o pagamento por crédito foi estornado)
  const d2 = ambiente(setup);
  const r2 = await marcarDiaSemJogo(d2, '2026-09-22', 'devolver', ADM);
  assert.deepEqual([r2.creditos, r2.estornados, r2.ignorados], [0, 3, 0]);
  assert.match(r2.financeiro.log[0].detalhe, /"nomes":\["Ana","Antigo","Fora"\]/);
});

await ta('marcarDiaSemJogo (crédito): pagamento que já tem crédito ativo não gera outro; os dias seguintes já configurados recebem os créditos novos', async () => {
  const d = ambiente((x) => {
    x.fin_creditos.push(cr('cr9', 'p1', 'Ana', 14, 'pg1', '2026-09-22', 2)); // o dinheiro da Ana já é um crédito ativo
    x.jogadores.push(jog('p3', 'Carla', 3));
    x.fin_pagamentos.push(pg('pg7', '2026-09-22', 'p3', 'Carla', 14, 4));
    x.checkins.push(ck('k1', '2026-09-22', 'p3', 'Carla', 4), ck('k2', '2026-09-29', 'p3', 'Carla', 5), ck('k3', '2026-09-29', 'p1', 'Ana', 6));
    x.fin_dias.push(diaLinha('2026-09-29', 10, 3));
  });
  const r = await marcarDiaSemJogo(d, '2026-09-22', 'credito', ORG);
  assert.equal(r.creditos, 2); // Antigo (pg3) e Carla (pg7); Ana não
  const f = r.financeiro;
  // 29/09 (10 por pessoa): Carla usa o crédito novo (14), Ana o cr9 (14); ordem do log: o do dia sem jogo vem antes dos aplicados
  const usados = validos(f, '2026-09-29').filter((p) => p.tipo === 'credito').map((p) => [p.jogadorId, p.creditoId, p.valor, p.marcadoPor]).sort();
  assert.deepEqual(usados, [['p1', 'cr9', 10, 'Crédito automático'], ['p3', 'id-2', 10, 'Crédito automático']]); // Antigo (pg3) é o id-1; Carla (pg7) o id-2
  assert.deepEqual(f.log.slice(0, 2).map((l) => l.acao), ['aplicarCreditos', 'marcarDiaSemJogo']);
  assert.equal(f.log[0].nome, 'Org'); // o auth de quem marcou o dia é o autor do log
});

// ============================== reabrirDia ==============================

await ta('reabrirDia: validações, dia normal só devolve ok (sem log) e crédito usado em outro dia impede (nada muda)', async () => {
  const d = ambiente();
  assert.deepEqual(await reabrirDia(d, 'x', ORG), { error: 'Data inválida.' });
  assert.deepEqual(await reabrirDia(d, '2027-01-01', ORG), { error: 'Dia não encontrado.' });
  const n = (await fin(d)).log.length;
  assert.equal((await reabrirDia(d, '2026-09-22', ORG)).financeiro.log.length, n); // já normal
  await marcarDiaSemJogo(d, '2026-09-22', 'credito', ORG);
  // um dos créditos novos (Ana) é gasto em 29/09
  await d.repo.gravarFinDia({ data: '2026-09-29', valor_pessoa: 10 });
  const antesUso = await fin(d);
  const idAna = antesUso.creditos.find((c) => c.jogadorId === 'p1' && c.dataOrigem === '2026-09-22').id;
  await d.repo.inserirFinPagamento(pg('pgu', '2026-09-29', 'p1', 'Ana', 10, 99, { tipo: 'credito', credito_id: idAna }));
  const antes = await fin(d);
  assert.deepEqual(await reabrirDia(d, '2026-09-22', ORG), { error: 'Não dá para reabrir: 1 crédito(s) deste dia já foram usados em outro dia.' });
  assert.deepEqual(await fin(d), antes);
});

await ta('reabrirDia: cancela os créditos do dia (quem/quando), volta a normal, loga a contagem e reaplica créditos de dias anteriores', async () => {
  const d = ambiente((x) => {
    x.fin_dias.push(diaLinha('2026-10-06', 14, 3));
    x.checkins.push(ck('k1', '2026-10-06', 'p1', 'Ana', 4));
    x.fin_creditos.push(cr('cr7', 'p1', 'Ana', 14, 'pgz', '2026-09-08', 2));
  });
  await marcarDiaSemJogo(d, '2026-10-06', 'credito', ORG); // dia sem jogo sem pagamento: cria 0 créditos
  const r = await reabrirDia(d, '2026-10-06', ADM);
  assert.equal(r.financeiro.dias.find((x) => x.data === '2026-10-06').status, '');
  assert.equal(r.financeiro.log[1].detalhe, '{"data":"2026-10-06","creditosCancelados":0}');
  assert.equal(r.financeiro.log[0].acao, 'aplicarCreditos'); // Ana paga o 06/10 com o cr7
  assert.equal(r.financeiro.log[0].nome, 'Adm');
  // com créditos do dia: 22/09
  const r2 = await marcarDiaSemJogo(d, '2026-09-22', 'credito', ORG);
  assert.equal(r2.creditos, 2);
  const r3 = await reabrirDia(d, '2026-09-22', ADM);
  const cancelados = r3.financeiro.creditos.filter((c) => c.dataOrigem === '2026-09-22');
  assert.deepEqual(cancelados.map((c) => [c.status, c.encerradoPor, c.encerradoEm]), [['cancelado', 'Adm', '2026-09-24T12:00:00.000Z'], ['cancelado', 'Adm', '2026-09-24T12:00:00.000Z']]);
  assert.equal(r3.financeiro.dias.find((x) => x.data === '2026-09-22').status, '');
  assert.ok(r3.financeiro.log.some((l) => l.detalhe === '{"data":"2026-09-22","creditosCancelados":2}'));
  // o dinheiro volta a ser pagamento comum (Ana e o antigo) e a reabertura reaplica o cr1 do Bruno, que tem check-in no dia
  assert.deepEqual(validos(r3.financeiro, '2026-09-22').map((p) => [p.jogadorId, p.tipo, p.creditoId]), [['p1', 'dinheiro', ''], ['', 'dinheiro', ''], ['p2', 'credito', 'cr1']]);
});

// ============================== aplicarCreditosDoDia ==============================

await ta('aplicarCreditosDoDia: valida a data, devolve quantos aplicou (resposta com "aplicados"), e o log usa o auth de quem pediu', async () => {
  const d = ambiente((x) => { x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg2'); });
  assert.deepEqual(await aplicarCreditosDoDia(d, '22/09', ORG), { error: 'Data inválida.' });
  const r = await aplicarCreditosDoDia(d, '2026-09-22', ORG); // cr1 do Bruno (15/09) paga o dia 22
  assert.deepEqual([r.status, r.aplicados], ['ok', 1]);
  assert.equal(r.financeiro.log[0].detalhe, '{"data":"2026-09-22","quantidade":1,"nomes":["Bruno"]}');
  assert.equal(r.financeiro.log[0].nome, 'Org');
  assert.equal((await aplicarCreditosDoDia(d, '2026-09-22', ORG)).aplicados, 0);
  assert.equal((await aplicarCreditosDoDia(d, '2026-09-15', ORG)).aplicados, 0); // dia sem jogo nunca recebe crédito
  assert.equal((await aplicarCreditosDoDia(d, '2030-01-01', ORG)).aplicados, 0); // dia não configurado
});

// ============================== devolverCredito ==============================

await ta('devolverCredito: erros do .gs (não encontrado, não ativo, já usado) e o caminho feliz (crédito devolvido + dinheiro de origem estornado + log)', async () => {
  const d = ambiente((x) => {
    x.fin_pagamentos.push(pg('pg0', '2026-09-15', 'p2', 'Bruno', 14, 4));
    x.fin_creditos.push(cr('crC', 'p1', 'Ana', 14, 'pgq', '2026-09-08', 2, { status: 'cancelado' }),
      cr('crU', 'p1', 'Ana', 14, 'pgw', '2026-09-08', 3));
    x.fin_pagamentos.push(pg('pgu', '2026-09-22', 'p1', 'Ana', 5, 5, { tipo: 'credito', credito_id: 'crU' })); // uso parcial de 5
  });
  assert.deepEqual(await devolverCredito(d, undefined, ADM), { error: 'Crédito não encontrado.' });
  assert.deepEqual(await devolverCredito(d, 'nao-existe', ADM), { error: 'Crédito não encontrado.' });
  assert.deepEqual(await devolverCredito(d, 'crC', ADM), { error: 'Este crédito não está ativo.' });
  assert.deepEqual(await devolverCredito(d, 'crU', ADM), { error: 'Este crédito já foi usado (total ou parcialmente); não dá para devolver o dinheiro.' });
  const r = await devolverCredito(d, 'cr1', ADM);
  const c = r.financeiro.creditos.find((x) => x.id === 'cr1');
  assert.deepEqual([c.status, c.encerradoPor, c.encerradoEm], ['devolvido', 'Adm', '2026-09-24T12:00:00.000Z']);
  assert.equal(r.financeiro.log[0].detalhe, '{"jogadorNome":"Bruno","valor":14,"dataOrigem":"2026-09-15"}');
  assert.equal(r.financeiro.log[0].acao, 'devolverCredito');
});

await ta('devolverCredito: estorna o pagamento de origem (quem/quando), é idempotente e não estorna de novo pagamento já estornado', async () => {
  const d = ambiente((x) => {
    x.fin_pagamentos.push(pg('pg0', '2026-09-15', 'p2', 'Bruno', 14, 4));
    x.fin_pagamentos.push(pg('pgE', '2026-09-15', 'p1', 'Ana', 14, 5, { estornado: true, estornado_por: 'Ant', estornado_em: '2026-09-16T10:00:00+00:00' }));
    x.fin_creditos.push(cr('crE', 'p1', 'Ana', 14, 'pgE', '2026-09-15', 2));
  });
  const r = await devolverCredito(d, 'cr1', MESTRA);
  const p = r.financeiro.pagamentos.find((x) => x.id === 'pg0');
  assert.deepEqual([p.estornado, p.estornadoPor, p.estornadoEm], [true, 'Chave mestra', '2026-09-24T12:00:00.000Z']);
  const n = r.financeiro.log.length;
  assert.equal((await devolverCredito(d, 'cr1', MESTRA)).financeiro.log.length, n); // idempotente
  const r2 = await devolverCredito(d, 'crE', ADM); // origem já estornada: mantém quem estornou primeiro
  assert.equal(r2.financeiro.pagamentos.find((x) => x.id === 'pgE').estornadoPor, 'Ant');
  assert.equal(r2.financeiro.creditos.find((x) => x.id === 'crE').status, 'devolvido');
});

// ============================== ganchos do check-in ==============================

await ta('gancho de entrada: quem tem crédito de dia anterior já aparece pago (tipo credito, autor Crédito automático, log com o nome)', async () => {
  const d = ambiente((x) => { x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg2'); });
  assert.deepEqual(await addCheckin(d, { id: 'n1', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3, sexo: 'M' }), { status: 'ok' });
  const f = await fin(d);
  const p = f.pagamentos.at(-1);
  assert.deepEqual([p.jogadorId, p.tipo, p.creditoId, p.valor, p.marcadoPor, p.data], ['p2', 'credito', 'cr1', 14, 'Crédito automático', '2026-09-22']);
  assert.deepEqual([f.log[0].acao, f.log[0].nome, f.log[0].detalhe], ['aplicarCreditos', 'Crédito automático', '{"data":"2026-09-22","quantidade":1,"nomes":["Bruno"]}']);
});

await ta('gancho de entrada: vários créditos do mesmo jogador (o mais antigo primeiro); saldo parcial só paga se cobrir o valor do dia (>=)', async () => {
  const d = ambiente((x) => {
    x.jogadores.push(jog('p3', 'Carla', 3));
    x.fin_dias.push(diaLinha('2026-09-29', 14, 3), diaLinha('2026-10-06', 14, 4), diaLinha('2026-10-13', 14, 5));
    // Carla: crédito novo (13,99 < 14: não paga), antigo de 20 (paga e sobra 6), e outro de 14 exatos (paga: limite do >=)
    x.fin_creditos.push(cr('crN', 'p3', 'Carla', 13.99, 'a', '2026-09-01', 2), cr('crA', 'p3', 'Carla', 20, 'b', '2026-09-02', 3), cr('crB', 'p3', 'Carla', 14, 'c', '2026-09-03', 4));
  });
  for (const [i, data] of ['2026-09-29', '2026-10-06', '2026-10-13'].entries()) {
    await addCheckin(d, { id: 'n' + i, data, jogadorId: 'p3', jogadorNome: 'Carla', estrelas: 3, sexo: 'F' });
  }
  const usos = (await fin(d)).pagamentos.filter((p) => p.jogadorId === 'p3').map((p) => [p.data, p.creditoId]);
  // 29/09 -> crA (20, o mais antigo que cobre), 06/10 -> crB (crA ficou com 6; crN 13,99 < 14), 13/10 -> nenhum (crN 13,99 não cobre 14)
  assert.deepEqual(usos, [['2026-09-29', 'crA'], ['2026-10-06', 'crB']]);
});

await ta('gancho de entrada: dia sem jogo, sem valor ou não configurado não aplica; check-in além das vagas não recebe crédito', async () => {
  const d = ambiente((x) => {
    x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg2');
    x.fin_dias.push(diaLinha('2026-09-29', 0, 3), diaLinha('2026-10-06', 14, 4, 'semjogo'), diaLinha('2026-10-13', 14, 5));
    x.config.find((c) => c.chave === 'checkinVagas').valor = '1';
    x.checkins.push(ck('kk', '2026-10-13', 'p1', 'Ana', 4));
  });
  for (const data of ['2026-09-29', '2026-10-06', '2026-11-03']) await addCheckin(d, { id: 'x' + data, data, jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3, sexo: 'M' });
  await addCheckin(d, { id: 'espera', data: '2026-10-13', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3, sexo: 'M' }); // 2º da fila com 1 vaga
  assert.equal((await fin(d)).pagamentos.filter((p) => p.tipo === 'credito' && !p.estornado).length, 0);
});

await ta('gancho de saída: o crédito usado no dia volta (pagamento por crédito estornado + log "saiu da lista") e o check-in é mesmo removido', async () => {
  const d = ambiente((x) => { x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg2'); });
  await addCheckin(d, { id: 'n1', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3, sexo: 'M' });
  assert.deepEqual(await removeCheckin(d, 'c2'), { status: 'ok' }); // o c2 do fixture (Bruno) também sai: as duas entradas somem
  assert.deepEqual(await removeCheckin(d, 'n1'), { status: 'ok' });
  const f = await fin(d);
  assert.equal(f.pagamentos.filter((p) => p.tipo === 'credito' && !p.estornado).length, 0);
  const estornado = f.pagamentos.find((p) => p.tipo === 'credito');
  assert.deepEqual([estornado.estornado, estornado.estornadoPor, estornado.estornadoEm], [true, 'Crédito automático', '2026-09-24T12:00:00.000Z']);
  const l = f.log.find((x) => x.acao === 'estornarPagamento' && x.detalhe.includes('saiu da lista'));
  assert.equal(l.detalhe, '{"data":"2026-09-22","jogadorId":"p2","motivo":"saiu da lista: crédito devolvido ao saldo","quantidade":1}');
  assert.equal(l.nome, 'Crédito automático');
  assert.equal((await mapearCheckins((await d.repo.lerTudo()).checkins)).some((c) => c.id === 'n1'), false);
});

await ta('gancho de saída: pagamento em dinheiro de quem saiu NÃO é estornado; check-in inexistente não roda gancho', async () => {
  const d = ambiente();
  await removeCheckin(d, 'c1'); // Ana pagou em dinheiro (pg1)
  assert.equal((await fin(d)).pagamentos.find((p) => p.id === 'pg1').estornado, false);
  const n = (await fin(d)).log.length;
  assert.deepEqual(await removeCheckin(d, 'nao-existe'), { error: 'Check-in não encontrado (pode já ter sido desmarcado).' });
  assert.equal((await fin(d)).log.length, n);
});

await ta('gancho de saída: a espera sobe para dentro das vagas e paga com o crédito (inclusive quando as vagas já eram menores que a lista)', async () => {
  const d = ambiente((x) => {
    x.config.find((c) => c.chave === 'checkinVagas').valor = '1'; // só o Ana (c1) está dentro; Bruno (c2) e o antigo (c3) esperam
  });
  assert.equal((await fin(d)).pagamentos.some((p) => p.tipo === 'credito' && !p.estornado), false);
  await removeCheckin(d, 'c1'); // Ana sai: Bruno sobe e paga com o cr1
  const f = await fin(d);
  const novo = f.pagamentos.filter((p) => p.tipo === 'credito' && !p.estornado);
  assert.deepEqual(novo.map((p) => [p.jogadorId, p.creditoId, p.data]), [['p2', 'cr1', '2026-09-22']]);
  assert.equal(f.log[0].detalhe, '{"data":"2026-09-22","quantidade":1,"nomes":["Bruno"]}');
});

await ta('ganchos nunca quebram o check-in: erro no gancho de entrada e no de saída é engolido (avisar recebe a mensagem)', async () => {
  const d = ambiente((x) => { x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg2'); });
  d.repo.inserirFinPagamento = async () => { throw new Error('fin_pagamentos: banco fora do ar'); };
  assert.deepEqual(await addCheckin(d, { id: 'n1', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3, sexo: 'M' }), { status: 'ok' });
  assert.equal((await mapearCheckins((await d.repo.lerTudo()).checkins)).some((c) => c.id === 'n1'), true);
  assert.deepEqual(d.avisos, ['aposAdicionarCheckin: fin_pagamentos: banco fora do ar']);
  const d2 = ambiente();
  const original = d2.repo.lerTudo;
  let chamadas = 0;
  d2.repo.lerTudo = async () => { if (++chamadas > 1) throw new Error('lerTudo: caiu'); return original(); }; // a 1ª leitura (do removeCheckin) passa; a do gancho falha
  assert.deepEqual(await removeCheckin(d2, 'c1'), { status: 'ok' });
  assert.equal((await mapearCheckins(await (async () => { d2.repo.lerTudo = original; return (await original()).checkins; })())).some((c) => c.id === 'c1'), false);
  assert.deepEqual(d2.avisos, ['aposRemoverCheckin: lerTudo: caiu']);
  // sem deps.avisar e sem relogio: o gancho engole calado, o check-in continua ok
  const d3 = { repo: criarRepoMemoria(fixture) };
  assert.deepEqual(await addCheckin(d3, { id: 'z', data: '2026-09-22', jogadorId: 'p1' }), { status: 'ok' });
});

await ta('gancho: check-in sem jogador (jogadorId vazio) nunca recebe crédito órfão (I3 da 4a continua valendo)', async () => {
  const d = ambiente((x) => { x.fin_creditos.push(cr('crO', null, 'Órfão', 14, 'o', '2026-09-01', 2)); x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg3'); });
  await addCheckin(d, { id: 'n1', data: '2026-09-22', jogadorNome: 'Sem cadastro', estrelas: 0, sexo: '' });
  assert.equal((await fin(d)).pagamentos.some((p) => p.creditoId === 'crO'), false);
  const f = await fin(d);
  assert.deepEqual(f.pagamentos.filter((p) => p.tipo === 'credito' && !p.estornado).map((p) => [p.jogadorId, p.creditoId]), [['p2', 'cr1']]); // só o Bruno
  assert.equal(await aplicarCreditos(d, '2026-09-22', ORG), 0);
});

await ta('gancho de entrada: crédito pago por salvarFinDia e por check-in usam o mesmo caminho (mesma linha de log e de pagamento)', async () => {
  const d = ambiente((x) => { x.checkins.push(ck('k9', '2026-09-29', 'p2', 'Bruno', 4)); x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg2'); });
  const r = await salvarFinDia(d, { data: '2026-09-29', valorPessoa: 14, pix: '', valorQuadra: 0, valorBrinde: 0 }, ORG);
  assert.equal(r.financeiro.pagamentos.at(-1).creditoId, 'cr1');
  // marcarPagamento em dia com crédito já aplicado é idempotente
  const r2 = await marcarPagamento(d, '2026-09-29', 'p2', 'Bruno', ORG);
  assert.equal(r2.financeiro.pagamentos.length, r.financeiro.pagamentos.length);
});

// ============================== nova tentativa depois de falha no meio (autocura) ==============================
const tresDinheiros = (x) => {
  x.jogadores.push(jog('p3', 'Carla', 3), jog('p4', 'Diego', 4));
  x.fin_pagamentos.push(pg('pg7', '2026-09-22', 'p3', 'Carla', 14, 4), pg('pg8', '2026-09-22', 'p4', 'Diego', 14, 5));
  x.checkins.push(ck('k1', '2026-09-22', 'p3', 'Carla', 4), ck('k2', '2026-09-22', 'p4', 'Diego', 5));
};
// faz a n-ésima chamada de um método do repositório falhar (uma vez só)
const falharNa = (repo, metodo, n) => {
  const original = repo[metodo].bind(repo);
  let c = 0;
  repo[metodo] = async (...a) => { if (++c === n) throw new Error(metodo + ': falha injetada'); return original(...a); };
};

await ta('marcarDiaSemJogo: falha no meio da criação de créditos e nova tentativa termina o serviço (sem duplicar, com log e contagem só do que faltava)', async () => {
  const d = ambiente(tresDinheiros);
  falharNa(d.repo, 'inserirFinCredito', 2);
  await assert.rejects(() => marcarDiaSemJogo(d, '2026-09-22', 'credito', ORG), /falha injetada/);
  let f = await fin(d);
  assert.equal(f.dias.find((x) => x.data === '2026-09-22').status, 'semjogo');
  assert.equal(f.creditos.filter((c) => c.dataOrigem === '2026-09-22').length, 1);
  assert.equal(f.log.some((l) => l.acao === 'marcarDiaSemJogo'), false);
  const r = await marcarDiaSemJogo(d, '2026-09-22', 'credito', ORG);
  assert.deepEqual([r.creditos, r.estornados, r.ignorados], [3, 0, 0]); // os 4 pagamentos válidos: 1 já tinha crédito, faltam 3
  f = await fin(d);
  const doDia = f.creditos.filter((c) => c.dataOrigem === '2026-09-22');
  assert.deepEqual(doDia.map((c) => c.origemPagamentoId).sort(), ['pg1', 'pg3', 'pg7', 'pg8']); // um por pagamento, sem duplicar
  assert.equal(f.log.filter((l) => l.acao === 'marcarDiaSemJogo').length, 1);
});

await ta('marcarDiaSemJogo: repetição sem nada a fazer não grava nada (nem log) e responde como o .gs; a repetição também não desfaz crédito com "devolver"', async () => {
  const d = ambiente(tresDinheiros);
  await marcarDiaSemJogo(d, '2026-09-22', 'credito', ORG);
  const antes = await fin(d);
  const r = await marcarDiaSemJogo(d, '2026-09-22', 'credito', ORG);
  assert.deepEqual([r.creditos, r.estornados, r.ignorados], [0, 0, 0]);
  assert.deepEqual(r.financeiro, antes);
  const r2 = await marcarDiaSemJogo(d, '2026-09-22', 'devolver', ADM);
  assert.deepEqual(r2.financeiro, antes);
  assert.equal(r2.financeiro.pagamentos.filter((p) => p.data === '2026-09-22' && p.estornado && p.tipo === 'dinheiro').length, 0);
});

await ta('marcarDiaSemJogo (devolver): falha no meio dos estornos e nova tentativa estorna o que faltou', async () => {
  const d = ambiente(tresDinheiros);
  falharNa(d.repo, 'estornarFinPagamento', 2);
  await assert.rejects(() => marcarDiaSemJogo(d, '2026-09-22', 'devolver', ADM), /falha injetada/);
  assert.equal((await fin(d)).pagamentos.filter((p) => p.data === '2026-09-22' && !p.estornado).length, 3);
  const r = await marcarDiaSemJogo(d, '2026-09-22', 'devolver', ADM);
  assert.equal(r.financeiro.pagamentos.filter((p) => p.data === '2026-09-22' && !p.estornado).length, 0);
  assert.equal(r.estornados, 3);
  assert.equal(r.financeiro.log.filter((l) => l.acao === 'marcarDiaSemJogo').length, 1);
});

await ta('devolverCredito: falha entre fechar o crédito e estornar a origem; a nova tentativa estorna a origem e loga uma vez só', async () => {
  const d = ambiente((x) => { x.fin_pagamentos.push(pg('pg0', '2026-09-15', 'p2', 'Bruno', 14, 4)); });
  falharNa(d.repo, 'estornarFinPagamento', 1);
  await assert.rejects(() => devolverCredito(d, 'cr1', ADM), /falha injetada/);
  let f = await fin(d);
  assert.equal(f.creditos.find((c) => c.id === 'cr1').status, 'devolvido');
  assert.equal(f.pagamentos.find((p) => p.id === 'pg0').estornado, false); // o dinheiro ainda conta no caixa
  const r = await devolverCredito(d, 'cr1', ADM);
  assert.equal(r.financeiro.pagamentos.find((p) => p.id === 'pg0').estornado, true);
  assert.equal(r.financeiro.log[0].detalhe, '{"jogadorNome":"Bruno","valor":14,"dataOrigem":"2026-09-15"}');
  const n = r.financeiro.log.length;
  assert.deepEqual((await devolverCredito(d, 'cr1', ADM)).financeiro, r.financeiro); // repetição simples: nada novo
  assert.equal(n, (await fin(d)).log.length);
});

// ============================== avisar (erros engolidos ficam visíveis) ==============================
await ta('handler: erro engolido no gancho chega em avisar e o check-in continua ok', async () => {
  const { criarHandler } = await import('../../backend/handler.js');
  const repo = criarRepoMemoria(structuredClone(fixture));
  const orig = repo.lerTudo.bind(repo);
  let n = 0;
  repo.lerTudo = async () => { if (++n > 1) throw new Error('lerTudo: caiu no gancho'); return orig(); }; // 1ª leitura (addCheckin) passa
  const avisos = [];
  const h = criarHandler({ repo, config: {}, verificarToken: async () => ({ ok: true, email: 'c@exemplo.com', nome: 'C' }), avisar: (m) => avisos.push(m) });
  const r = await h.post({ action: 'addCheckin', idToken: 'x', checkin: { id: 'nn', data: '2026-09-22', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: 3, sexo: 'F' } });
  assert.deepEqual(r, { status: 'ok' });
  assert.ok(avisos.some((m) => m.includes('aposAdicionarCheckin') && m.includes('caiu no gancho')), JSON.stringify(avisos));
});

fim();
