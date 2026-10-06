// Testes do cálculo puro do Controle Financeiro. Extrai o bloco <financeiro-puro> direto do HTML,
// então testa exatamente o código que vai pro ar. Rodar: node tests/financeiro-puro.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <financeiro-puro>');
const fim = html.indexOf('// </financeiro-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <financeiro-puro> não encontrado no volei-dashboard.html');
const F = new Function(html.slice(ini, fim) + `
  return { finNormalizar, finCentavos, finFormatar, finDia, finDiaOuHerdado, finPagamentosValidos, finPagamentoDe,
           finArrecadadoDia, finSaidaDia, finAvulsosDia, finResultadoDia, finDatas, finCaixa, finPrevistoDia,
           finPendentes, finSinalizados, finMarcas, finResumoMes, finCabecalhoWhatsApp, finSaldoPrevisto,
           finPagamentosRecentesPrimeiro, finCaixaAte, finDataCurtaComDia, finResumoFechamento,
           finSemJogo, finTipoPagamento, finRecebidoDinheiroDia, finCreditosDisponiveis, finTotalCreditos,
           finSaldoLivre, finCreditoDe, finRotuloCredito, finSaldoCredito, finPendenciasAtivas, finPendenciasDe };
`)();

let falhas = 0;
function t(nome, fn){
  try { fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

const DIA = '2026-09-18';
const baseFin = () => ({
  dias: [{ data: DIA, valorPessoa: 13.6, pix: '31987702331', valorQuadra: 180, temBrinde: true, valorBrinde: 50 }],
  pagamentos: [], lancamentos: [], log: []
});
const pg = (id, jog, sobre) => Object.assign({ id, data: DIA, jogadorId: jog, jogadorNome: jog, valor: 13.6,
  marcadoPor: 'Adm', marcadoEm: '', estornado: false, estornadoPor: '', estornadoEm: '' }, sobre || {});

t('exemplo do enunciado: 3 pagaram, quadra 180, brinde 50 => arrecadado 40,80 e resultado -189,20', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'michel'), pg('2', 'sara'), pg('3', 'abraao')];
  assert.equal(F.finArrecadadoDia(fin, DIA), 4080);
  assert.equal(F.finSaidaDia(fin, DIA), 23000);
  assert.equal(F.finResultadoDia(fin, DIA), -18920);
  assert.equal(F.finCaixa(fin), -18920);
});

t('16 x 13,60 = 217,60 sem erro de ponto flutuante', () => {
  const fin = baseFin();
  fin.pagamentos = Array.from({ length: 16 }, (_, i) => pg('p' + i, 'j' + i));
  assert.equal(F.finArrecadadoDia(fin, DIA), 21760);
});

t('dia sem nenhum pagamento já aparece negativo (saída entra ao salvar o dia)', () => {
  assert.equal(F.finResultadoDia(baseFin(), DIA), -23000);
});

t('brinde desligado: a saída é só a quadra', () => {
  const fin = baseFin(); fin.dias[0].temBrinde = false;
  assert.equal(F.finSaidaDia(fin, DIA), 18000);
});

t('estorno tira o valor do caixa e sai da lista de válidos', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'michel'), pg('2', 'sara', { estornado: true, estornadoPor: 'Adm' })];
  assert.equal(F.finArrecadadoDia(fin, DIA), 1360);
  assert.equal(F.finPagamentosValidos(fin, DIA).length, 1);
  assert.equal(F.finPagamentoDe(fin, DIA, 'sara'), null);
  assert.equal(F.finPagamentoDe(fin, DIA, 'michel').id, '1');
});

t('lançamentos avulsos: entrada soma, saída subtrai, estornado é ignorado', () => {
  const fin = baseFin();
  fin.dias = [];
  fin.lancamentos = [
    { id: 'a', data: '2026-09-01', tipo: 'entrada', descricao: 'Saldo inicial', valor: 500, estornado: false },
    { id: 'b', data: '2026-09-02', tipo: 'saida', descricao: 'Bola', valor: 120.5, estornado: false },
    { id: 'c', data: '2026-09-03', tipo: 'saida', descricao: 'Errado', valor: 999, estornado: true }
  ];
  assert.equal(F.finAvulsosDia(fin, '2026-09-02'), -12050);
  assert.equal(F.finCaixa(fin), 37950);
});

t('caixa soma vários dias e avulsos', () => {
  const fin = baseFin();
  fin.dias.push({ data: '2026-09-11', valorPessoa: 13.6, pix: '', valorQuadra: 180, temBrinde: false, valorBrinde: 0 });
  fin.pagamentos = [pg('1', 'a'), pg('2', 'b', { data: '2026-09-11' })];
  fin.lancamentos = [{ id: 'x', data: '2026-09-01', tipo: 'entrada', descricao: 'Saldo inicial', valor: 1000, estornado: false }];
  // dia 18: 13,60 - 230 = -216,40 | dia 11: 13,60 - 180 = -166,40 | avulso +1000  => 617,20
  assert.equal(F.finCaixa(fin), 61720);
});

t('pendentes = confirmados sem pagamento; sinalizados = pagou mas não está entre os confirmados', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'michel'), pg('2', 'sara')];
  const dentro = [{ jogadorId: 'michel', jogadorNome: 'Michel' }, { jogadorId: 'ana', jogadorNome: 'Ana' }];
  assert.deepEqual(F.finPendentes(fin, DIA, dentro).map(c => c.jogadorId), ['ana']);
  assert.deepEqual(F.finSinalizados(fin, DIA, dentro).map(p => p.jogadorId), ['sara']);
});

t('sinalizado continua contando no caixa (só o estorno tira)', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'sara')];
  assert.equal(F.finSinalizados(fin, DIA, []).length, 1);
  assert.equal(F.finArrecadadoDia(fin, DIA), 1360);
});

t('marcas: ✅ sozinho sem brinde, ✅🍫 com brinde, vazio se não pagou', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'michel')];
  assert.equal(F.finMarcas(fin, DIA, 'michel'), '✅🍫');
  assert.equal(F.finMarcas(fin, DIA, 'outro'), '');
  fin.dias[0].temBrinde = false;
  assert.equal(F.finMarcas(fin, DIA, 'michel'), '✅');
});

t('finMarcas: o ícone de pagamento é escolhido por dia (✅ padrão, 💰 opcional; valor estranho cai no padrão)', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'michel')];
  fin.dias[0].icone = '💰';
  assert.equal(F.finMarcas(fin, DIA, 'michel'), '💰🍫');
  fin.dias[0].temBrinde = false;
  assert.equal(F.finMarcas(fin, DIA, 'michel'), '💰');
  fin.dias[0].icone = '🤡';
  assert.equal(F.finMarcas(fin, DIA, 'michel'), '✅');
  delete fin.dias[0].icone;
  assert.equal(F.finMarcas(fin, DIA, 'michel'), '✅');
  assert.equal(F.finMarcas(fin, DIA, 'ninguem'), '');
});

t('finDiaOuHerdado: o ícone do dia anterior também é herdado', () => {
  const fin = baseFin(); fin.dias[0].icone = '💰';
  assert.equal(F.finDiaOuHerdado(fin, '2026-09-25').dia.icone, '💰');
});

t('finFormatar', () => {
  assert.equal(F.finFormatar(1360), 'R$ 13,60');
  assert.equal(F.finFormatar(0), 'R$ 0,00');
  assert.equal(F.finFormatar(-18920), '−R$ 189,20');
  assert.equal(F.finFormatar(123456789), 'R$ 1.234.567,89');
  assert.equal(F.finFormatar(5), 'R$ 0,05');
});

t('finCentavos aceita número, texto com vírgula ou ponto, e lixo', () => {
  assert.equal(F.finCentavos(13.6), 1360);
  assert.equal(F.finCentavos('13,60'), 1360);
  assert.equal(F.finCentavos('13.60'), 1360);
  assert.equal(F.finCentavos(19.99), 1999);
  assert.equal(F.finCentavos('abc'), 0);
  assert.equal(F.finCentavos(''), 0);
  assert.equal(F.finCentavos(null), 0);
});

t('finDiaOuHerdado: exato, herdado do dia anterior mais recente, ou nada', () => {
  const fin = baseFin();
  fin.dias.push({ data: '2026-09-11', valorPessoa: 12, pix: 'x', valorQuadra: 170, temBrinde: false, valorBrinde: 0 });
  assert.deepEqual([F.finDiaOuHerdado(fin, DIA).herdado, F.finDiaOuHerdado(fin, DIA).dia.data], [false, DIA]);
  const h = F.finDiaOuHerdado(fin, '2026-09-25');
  assert.equal(h.herdado, true); assert.equal(h.dia.data, DIA);
  const nada = F.finDiaOuHerdado(fin, '2026-09-01');
  assert.equal(nada.dia, null); assert.equal(nada.herdado, false);
});

t('finDatas: sem repetir, mais recente primeiro', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'a'), pg('2', 'b', { data: '2026-09-11' })];
  fin.lancamentos = [{ id: 'l', data: '2026-09-25', tipo: 'entrada', valor: 1, estornado: false }];
  assert.deepEqual(F.finDatas(fin), ['2026-09-25', '2026-09-18', '2026-09-11']);
});

t('finResumoMes: entradas (pagamentos + avulsas) e saídas (quadra/brinde + avulsas) só do mês', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'a'), pg('2', 'b', { data: '2026-08-28' })];
  fin.lancamentos = [{ id: 'l', data: '2026-09-05', tipo: 'saida', descricao: 'x', valor: 20, estornado: false }];
  assert.deepEqual(F.finResumoMes(fin, 2026, 9), { entradas: 1360, saidas: 23000 + 2000 });
});

t('finPrevistoDia = confirmados dentro das vagas x valor por pessoa', () => {
  assert.equal(F.finPrevistoDia(baseFin(), DIA, 16), 21760);
  assert.equal(F.finPrevistoDia({ dias: [] }, DIA, 16), 0);
});

t('finCabecalhoWhatsApp: com PIX, sem PIX e sem valor', () => {
  const fin = baseFin();
  assert.equal(F.finCabecalhoWhatsApp(fin, DIA), '💰 Valor: R$ 13,60\n\n📌 PIX para pagamento:\n31987702331\n\n');
  fin.dias[0].pix = '';
  assert.equal(F.finCabecalhoWhatsApp(fin, DIA), '💰 Valor: R$ 13,60\n\n');
  fin.dias[0].valorPessoa = 0;
  assert.equal(F.finCabecalhoWhatsApp(fin, DIA), '');
  assert.equal(F.finCabecalhoWhatsApp({ dias: [] }, DIA), '');
});

t('finNormalizar: null/undefined/parcial viram listas vazias', () => {
  // dois jogos no mesmo dia (2026-10-03): finNormalizar também repassa fin.jogos (a config do 2º jogo quando o
  // financeiro é separado) — sem isso, cfgFinDaChave(FINANCEIRO, data, 2) nunca encontrava nada (bug achado e
  // corrigido na Task 14 deste plano via verificação manual no navegador, não por um teste como este).
  assert.deepEqual(F.finNormalizar(null), { dias: [], jogos: [], pagamentos: [], lancamentos: [], log: [], creditos: [], pendencias: [] });
  assert.deepEqual(F.finNormalizar({ dias: [1] }), { dias: [1], jogos: [], pagamentos: [], lancamentos: [], log: [], creditos: [], pendencias: [] });
});

/* ---------- pendências (dívida avulsa de um jogador, cobrada "no olho" no próximo check-in) ---------- */
t('finPendenciasAtivas: só as pendentes, mais recente primeiro; finPendenciasDe filtra por jogador', () => {
  const fin = F.finNormalizar({ pendencias: [
    { id: 'p1', jogadorId: 'j1', jogadorNome: 'Heleno', valor: 10, observacao: 'saiu depois do horário', data: '2026-10-06', status: 'pendente' },
    { id: 'p2', jogadorId: 'j1', jogadorNome: 'Heleno', valor: 5, observacao: '', data: '2026-09-01', status: 'paga' },
    { id: 'p3', jogadorId: 'j2', jogadorNome: 'Ana', valor: 20, observacao: '', data: '2026-10-05', status: 'pendente' }
  ] });
  assert.deepEqual(F.finPendenciasAtivas(fin).map(p => p.id), ['p1', 'p3']); // p2 está paga, não entra
  assert.deepEqual(F.finPendenciasDe(fin, 'j1').map(p => p.id), ['p1']);
  assert.deepEqual(F.finPendenciasDe(fin, 'j2').map(p => p.id), ['p3']);
  assert.deepEqual(F.finPendenciasDe(fin, 'j3'), []);
});

/* ---------- dia sem jogo e crédito ---------- */
// crédito: status 'ativo' | 'devolvido' | 'cancelado'. O SALDO não é gravado: é valor − pagamentos por crédito ainda válidos.
const cred = (id, jog, valor, status, sobre) => Object.assign({ id, jogadorId: jog, jogadorNome: jog, valor, origemPagamentoId: 'o' + id,
  dataOrigem: '2026-09-11', criadoPor: 'Adm', criadoEm: '', status: status || 'ativo' }, sobre || {});
const pgCred = (id, jog, sobre) => pg(id, jog, Object.assign({ tipo: 'credito', creditoId: 'c1', marcadoPor: 'Crédito automático' }, sobre || {}));

t('dia SEM JOGO: a saída do dia (quadra + brinde) não conta; os pagamentos já recebidos continuam no caixa', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'a'), pg('2', 'b')];
  assert.equal(F.finResultadoDia(fin, DIA), 2720 - 23000);       // com jogo: -202,80
  fin.dias[0].status = 'semjogo';
  assert.equal(F.finSemJogo(fin.dias[0]), true);
  assert.equal(F.finSaidaDia(fin, DIA), 0);
  assert.equal(F.finResultadoDia(fin, DIA), 2720);               // sem despesa: só o dinheiro que entrou
  assert.equal(F.finCaixa(fin), 2720);
});

t('dia sem jogo sem pagamento nenhum não pesa no caixa (o caso da quadra que ficou negativa)', () => {
  const fin = baseFin(); fin.dias[0].status = 'semjogo';
  assert.equal(F.finCaixa(fin), 0);
  assert.equal(F.finResultadoDia(fin, DIA), 0);
});

t('pagamento por CRÉDITO conta como pago (arrecadado/marcas/pendentes) mas NÃO é dinheiro novo no caixa', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'a'), pgCred('2', 'b')];
  assert.equal(F.finTipoPagamento(fin.pagamentos[0]), 'dinheiro');
  assert.equal(F.finTipoPagamento(fin.pagamentos[1]), 'credito');
  assert.equal(F.finArrecadadoDia(fin, DIA), 2720);              // os dois estão "pagos"
  assert.equal(F.finRecebidoDinheiroDia(fin, DIA), 1360);        // mas só um trouxe dinheiro
  assert.equal(F.finResultadoDia(fin, DIA), 1360 - 23000);       // o crédito já estava no caixa
  assert.equal(F.finMarcas(fin, DIA, 'b'), '✅🍫');
  assert.equal(F.finRotuloCredito(fin, DIA, 'b'), 'Crédito');
  assert.equal(F.finRotuloCredito(fin, DIA, 'a'), '');
  assert.equal(F.finPendentes(fin, DIA, [{ jogadorId: 'a' }, { jogadorId: 'b' }, { jogadorId: 'c' }]).map(c => c.jogadorId).join(), 'c');
});

t('créditos: saldo é DERIVADO (valor − pagamentos por crédito válidos); total, saldo livre e crédito por jogador; devolvido/cancelado não contam', () => {
  const fin = baseFin();
  fin.dias.push({ data: '2026-09-11', valorPessoa: 13.6, pix: '', valorQuadra: 0, temBrinde: false, valorBrinde: 0, status: 'semjogo' });
  fin.pagamentos = [pg('o1', 'ana', { data: '2026-09-11' }), pg('o2', 'bia', { data: '2026-09-11' }),
    pgCred('cp2', 'bia', { creditoId: '2' }),                       // a Bia gastou o crédito inteiro dela no dia 18
    pgCred('cp6', 'zed', { creditoId: '6' }),                       // o Zed gastou 13,60 de um crédito de 20,00
    pgCred('cpx', 'ana', { creditoId: '3', estornado: true })];     // estornado: o crédito 3 da Ana volta a valer
  fin.creditos = [cred('1', 'ana', 13.6), cred('2', 'bia', 13.6), cred('3', 'ana', 5), cred('4', 'x', 9, 'devolvido'),
    cred('5', 'y', 9, 'cancelado'), cred('6', 'zed', 20)];
  assert.equal(F.finSaldoCredito(fin, fin.creditos[1]), 0);       // usado por inteiro
  assert.equal(F.finSaldoCredito(fin, fin.creditos[5]), 640);     // 20,00 − 13,60
  assert.equal(F.finSaldoCredito(fin, fin.creditos[2]), 500);     // o pagamento por crédito estornado devolveu o saldo
  assert.deepEqual(F.finCreditosDisponiveis(fin).map(c => c.id), ['1', '3', '6']);
  assert.equal(F.finTotalCreditos(fin), 1360 + 500 + 640);
  assert.equal(F.finCreditoDe(fin, 'ana'), 1860);
  assert.equal(F.finCreditoDe(fin, 'bia'), 0);
  assert.equal(F.finCreditoDe(fin, 'zed'), 640);
  // caixa: 2 pagamentos em dinheiro no dia sem jogo (27,20) − saída do dia 18 (230,00); os pagamentos por crédito não são dinheiro novo
  assert.equal(F.finCaixa(fin), 2720 - 23000);
  assert.equal(F.finSaldoLivre(fin), 2720 - 23000 - (1360 + 500 + 640));
  assert.equal(F.finTotalCreditos({ dias: [] }), 0);
});

t('dia sem jogo: sem pendentes e sem saldo previsto (não há o que cobrar)', () => {
  const fin = baseFin(); fin.dias[0].status = 'semjogo';
  assert.deepEqual(F.finPendentes(fin, DIA, [{ jogadorId: 'a' }]), []);
  assert.equal(F.finSaldoPrevisto(fin, DIA, [{ jogadorId: 'a' }]), null);
});

t('fechamento com crédito: o total recebido é só o dinheiro novo e há uma linha "com crédito"; a lista traz todos', () => {
  const fin = baseFin(); fin.dias[0].valorBrinde = 0; fin.dias[0].temBrinde = false;
  fin.pagamentos = [pg('1', 'a', { jogadorNome: 'Ana', marcadoEm: '2026-09-18T10:00:00.000Z' }),
    pgCred('2', 'b', { jogadorNome: 'Bia', marcadoEm: '2026-09-18T11:00:00.000Z' })];
  const txt = F.finResumoFechamento(fin, DIA);
  assert.ok(txt.includes('📋 Lista:\nAna, Bia.'), txt);
  assert.ok(txt.includes('1 × R$ 13,60 = R$ 13,60\n🎟️ Com crédito: 1 × R$ 13,60 = R$ 13,60 (já estava no caixa)'), txt);
  assert.ok(txt.includes('Total recebido: R$ 13,60'), txt);
  assert.ok(txt.includes('Total de despesas: R$ 180,00'), txt);
});

t('fechamento de dia SEM JOGO: aviso curto, lista de quem já tinha pago e o destino (crédito)', () => {
  const fin = baseFin(); fin.dias[0].status = 'semjogo';
  fin.pagamentos = [pg('1', 'a', { jogadorNome: 'Ana' }), pg('2', 'b', { jogadorNome: 'Bia' })];
  const txt = F.finResumoFechamento(fin, DIA);
  assert.equal(txt, [
    '🏐 VÔLEI — SEM JOGO', '📅 18/09/26 | SEXTA-FEIRA', '',
    '🌧️ Hoje não houve jogo.', '',
    '💳 Pagamentos já recebidos: 2 (R$ 27,20), guardados como crédito para o próximo check-in.', '',
    '📋 Lista:', 'Ana, Bia.'
  ].join('\n'));
  fin.pagamentos = [];
  assert.equal(F.finResumoFechamento(fin, DIA), '🏐 VÔLEI — SEM JOGO\n📅 18/09/26 | SEXTA-FEIRA\n\n🌧️ Hoje não houve jogo.');
});

/* ---------- resumo de fechamento (texto pro grupo) ---------- */
const NOMES16 = ['Michel', 'Zelão', 'Thales', 'Ana F', 'Bibiana', 'Bruno', 'Cassia', 'Pierre', 'Leo', 'Mateus', 'Camila', 'Sara', 'Pedro', 'Diego', 'Abraão', 'Markus'];
function finFechamento(){
  const fin = baseFin();
  fin.dias[0].valorBrinde = 51.96;   // "Chocolate" do exemplo
  fin.dias.push({ data: '2026-09-11', valorPessoa: 13.6, pix: '', valorQuadra: 0, temBrinde: false, valorBrinde: 0, icone: '✅' });
  fin.lancamentos = [{ id: 'sa', data: '2026-09-11', tipo: 'entrada', descricao: 'Saldo anterior', valor: 226.43, estornado: false }];
  // ordem em que pagaram = ordem dos horários (a lista do resumo segue essa ordem)
  fin.pagamentos = NOMES16.map((n, i) => pg('p' + i, n.toLowerCase(), { jogadorNome: n, marcadoEm: '2026-09-18T' + String(10 + i).padStart(2, '0') + ':00:00.000Z' }));
  return fin;
}

t('finDataCurtaComDia: dd/mm/aa | DIA-DA-SEMANA em maiúsculas (cada dia da semana)', () => {
  assert.equal(F.finDataCurtaComDia('2026-09-18'), '18/09/26 | SEXTA-FEIRA');
  assert.equal(F.finDataCurtaComDia('2026-09-19'), '19/09/26 | SÁBADO');
  assert.equal(F.finDataCurtaComDia('2026-09-20'), '20/09/26 | DOMINGO');
  assert.equal(F.finDataCurtaComDia('2026-09-21'), '21/09/26 | SEGUNDA-FEIRA');
  assert.equal(F.finDataCurtaComDia('2026-09-22'), '22/09/26 | TERÇA-FEIRA');
  assert.equal(F.finDataCurtaComDia('2026-09-23'), '23/09/26 | QUARTA-FEIRA');
  assert.equal(F.finDataCurtaComDia('2026-09-24'), '24/09/26 | QUINTA-FEIRA');
});

t('finCaixaAte: soma só as datas até (ou antes de) uma data', () => {
  const fin = finFechamento();
  assert.equal(F.finCaixaAte(fin, DIA, false), 22643 - 0);                    // dia 11: +226,43 avulso + (0 pagamentos - 0 quadra)
  assert.equal(F.finCaixaAte(fin, DIA, true), 22643 + 21760 - (18000 + 5196)); // 226,43 + 217,60 - 231,96
  assert.equal(F.finCaixaAte(fin, DIA, true), F.finCaixa(fin));                // hoje = fim da linha do tempo
});

t('finResumoFechamento: o exemplo do usuário (16 × 13,60, quadra 180, chocolate 51,96, saldo anterior 226,43)', () => {
  const esperado = [
    '🏐 FECHAMENTO VÔLEI',
    '📅 18/09/26 | SEXTA-FEIRA',
    '',
    '📋 Lista:',
    'Michel, Zelão, Thales, Ana F, Bibiana, Bruno, Cassia, Pierre, Leo, Mateus, Camila, Sara, Pedro, Diego, Abraão, Markus.',
    '',
    '💰 Total recebido:',
    '16 × R$ 13,60 = R$ 217,60',
    '',
    'Total recebido: R$ 217,60',
    '',
    '💸 Despesas:',
    '* Quadra: R$ 180,00',
    '* Chocolate: R$ 51,96',
    '',
    'Total de despesas: R$ 231,96',
    '',
    '📊 Resumo:',
    '* Saldo anterior: R$ 226,43',
    '* Total recebido: R$ 217,60',
    '* Total de despesas: R$ 231,96',
    '',
    '✅ Saldo atual em caixa: R$ 212,07',   // 226,43 + 217,60 − 231,96 (o exemplo do usuário tinha 212,47: erro de conta dele)
    '',
    'Obrigado (a), time! Que venham os próximos jogos! 🏐🙏🏻'
  ].join('\n');
  assert.equal(F.finResumoFechamento(finFechamento(), DIA), esperado);
});

t('finResumoFechamento: a lista segue a ORDEM em que pagaram (não a do array) e ignora estornados', () => {
  const fin = baseFin();
  fin.pagamentos = [
    pg('c', 'c', { jogadorNome: 'Carla', marcadoEm: '2026-09-18T12:00:00.000Z' }),
    pg('a', 'a', { jogadorNome: 'Ana',   marcadoEm: '2026-09-18T10:00:00.000Z' }),
    pg('x', 'x', { jogadorNome: 'Xis',   marcadoEm: '2026-09-18T11:00:00.000Z', estornado: true }),
    pg('b', 'b', { jogadorNome: 'Bia',   marcadoEm: '2026-09-18T11:30:00.000Z' })
  ];
  const txt = F.finResumoFechamento(fin, DIA);
  assert.ok(txt.includes('📋 Lista:\nAna, Bia, Carla.\n'), txt);
  assert.ok(txt.includes('3 × R$ 13,60 = R$ 40,80'), txt);
  assert.ok(!txt.includes('Xis'));
});

t('finResumoFechamento: sem brinde não há linha de Chocolate; valores diferentes viram "N pagamentos"', () => {
  const fin = baseFin(); fin.dias[0].temBrinde = false;
  fin.pagamentos = [pg('1', 'a', { jogadorNome: 'Ana' }), pg('2', 'b', { jogadorNome: 'Bia', valor: 10 })];
  const txt = F.finResumoFechamento(fin, DIA);
  assert.ok(!txt.includes('Chocolate'));
  assert.ok(txt.includes('2 pagamentos = R$ 23,60'), txt);
  assert.ok(txt.includes('Total de despesas: R$ 180,00'));
});

t('finResumoFechamento: lançamentos avulsos do dia entram (entradas em "recebido", saídas em "despesas") e o saldo fecha', () => {
  const fin = baseFin(); fin.dias[0].temBrinde = false;
  fin.pagamentos = [pg('1', 'a', { jogadorNome: 'Ana' })];
  fin.lancamentos = [
    { id: 'e', data: DIA, tipo: 'entrada', descricao: 'Doação', valor: 20, estornado: false },
    { id: 's', data: DIA, tipo: 'saida', descricao: 'Bola nova', valor: 30, estornado: false },
    { id: 'z', data: DIA, tipo: 'saida', descricao: 'Errado', valor: 99, estornado: true }
  ];
  const txt = F.finResumoFechamento(fin, DIA);
  assert.ok(txt.includes('* Doação: R$ 20,00'), txt);
  assert.ok(txt.includes('* Bola nova: R$ 30,00'), txt);
  assert.ok(!txt.includes('Errado'));
  assert.ok(txt.includes('Total recebido: R$ 33,60'), txt);          // 13,60 + 20
  assert.ok(txt.includes('Total de despesas: R$ 210,00'), txt);      // 180 + 30
  assert.ok(txt.includes('✅ Saldo atual em caixa: ' + F.finFormatar(F.finCaixaAte(fin, DIA, true))), txt);
});

t('finResumoFechamento: dia sem pagamentos nem despesas não quebra', () => {
  const txt = F.finResumoFechamento({ dias: [], pagamentos: [], lancamentos: [], log: [] }, DIA);
  assert.ok(txt.includes('Nenhum pagamento registrado.'));
  assert.ok(txt.includes('* Nenhuma'));
  assert.ok(txt.includes('Saldo atual em caixa: R$ 0,00'));
});

t('finPagamentosRecentesPrimeiro: o último pagamento vem primeiro; empate = o gravado depois vem antes', () => {
  const l = [
    pg('a', 'ana',   { marcadoEm: '2026-09-18T19:00:00.000Z' }),
    pg('c', 'carla', { marcadoEm: '2026-09-18T21:30:00.000Z' }),
    pg('b', 'bia',   { marcadoEm: '2026-09-18T20:00:00.000Z' }),
    pg('d', 'dani',  { marcadoEm: '2026-09-18T20:00:00.000Z' })   // mesmo horário da Bia, mas gravada depois
  ];
  assert.deepEqual(F.finPagamentosRecentesPrimeiro(l).map(p => p.id), ['c', 'd', 'b', 'a']);
  assert.deepEqual(l.map(p => p.id), ['a', 'c', 'b', 'd'], 'não pode alterar a lista original');
  assert.deepEqual(F.finPagamentosRecentesPrimeiro(null), []);
});

t('finPagamentosRecentesPrimeiro: estornados entram na ordem pelo horário em que foram marcados; sem horário vai pro fim', () => {
  const l = [
    pg('x', 'x', { marcadoEm: '' }),
    pg('e', 'e', { marcadoEm: '2026-09-18T20:00:00.000Z', estornado: true }),
    pg('n', 'n', { marcadoEm: '2026-09-18T22:00:00.000Z' })
  ];
  assert.deepEqual(F.finPagamentosRecentesPrimeiro(l).map(p => p.id), ['n', 'e', 'x']);
});

t('finSaldoPrevisto: caixa + o que falta dos confirmados que ainda não pagaram (16 confirmados, 3 pagaram)', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'j0'), pg('2', 'j1'), pg('3', 'j2')];
  const dentro = Array.from({ length: 16 }, (_, i) => ({ jogadorId: 'j' + i, jogadorNome: 'J' + i }));
  const p = F.finSaldoPrevisto(fin, DIA, dentro);
  assert.equal(p.caixa, -18920);                 // 3 x 13,60 - 230,00
  assert.equal(p.pendentes, 13);
  assert.equal(p.aReceber, 17680);               // 13 x 13,60
  assert.equal(p.previsto, -1240);               // = 16 x 13,60 - 230,00: o resultado do dia se TODOS pagarem
  assert.equal(p.previsto, F.finPrevistoDia(fin, DIA, 16) - F.finSaidaDia(fin, DIA));
});

t('finSaldoPrevisto: todos já pagaram => nada a receber e previsto = caixa', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'a'), pg('2', 'b')];
  const p = F.finSaldoPrevisto(fin, DIA, [{ jogadorId: 'a' }, { jogadorId: 'b' }]);
  assert.equal(p.pendentes, 0); assert.equal(p.aReceber, 0); assert.equal(p.previsto, p.caixa);
});

t('finSaldoPrevisto: quem pagou e saiu da lista não vira "pendente" (o pagamento já está no caixa)', () => {
  const fin = baseFin();
  fin.pagamentos = [pg('1', 'saiu')];
  const p = F.finSaldoPrevisto(fin, DIA, [{ jogadorId: 'a' }]);
  assert.equal(p.pendentes, 1);
  assert.equal(p.previsto, 1360 - 23000 + 1360);
});

t('finSaldoPrevisto: soma o resto do caixa (outros dias e avulsos) e ignora pagamento estornado', () => {
  const fin = baseFin();
  fin.lancamentos = [{ id: 'x', data: '2026-09-01', tipo: 'entrada', descricao: 'Saldo inicial', valor: 500, estornado: false }];
  fin.pagamentos = [pg('1', 'a', { estornado: true })];   // estornado: a pessoa volta a ser pendente
  const p = F.finSaldoPrevisto(fin, DIA, [{ jogadorId: 'a' }]);
  assert.equal(p.pendentes, 1);
  assert.equal(p.previsto, 50000 - 23000 + 1360);
});

t('finSaldoPrevisto: null se o dia não tem valor por pessoa (não dá pra prever)', () => {
  assert.equal(F.finSaldoPrevisto({ dias: [] }, DIA, [{ jogadorId: 'a' }]), null);
  const fin = baseFin(); fin.dias[0].valorPessoa = 0;
  assert.equal(F.finSaldoPrevisto(fin, DIA, [{ jogadorId: 'a' }]), null);
});

t('montarTextoCheckinsWhatsApp: com valor => cabeçalho e ✅🍫 por nome; sem valor => igual a antes', () => {
  // dois jogos no mesmo dia (2026-10-03, Task 17) reescreveu montarTextoCheckinsWhatsApp/preencherMensagemCheckin
  // pra usar jogosDoDia/checkinsDoJogo/corpoWhatsAppDoDia (do bloco <dois-jogos-puro>, logo depois de
  // <financeiro-puro> no HTML) em vez de checkinsDentroEReserva — a extração isolada precisa ir até o fim desse
  // bloco e expor SETTINGS/CHECKINS/FINANCEIRO como as globais que o código de verdade lê, não como parâmetros.
  const fimDoisJogos = html.indexOf('// </dois-jogos-puro>');
  assert.ok(fimDoisJogos > fim, 'bloco <dois-jogos-puro> não encontrado depois de <financeiro-puro>');
  const ini2 = html.indexOf('function preencherMensagemCheckin');
  const fim2 = html.indexOf('/* ---------- engrenagem', ini2);
  assert.ok(ini2 > -1 && fim2 > ini2, 'função montarTextoCheckinsWhatsApp não encontrada');
  const monta = new Function('SETTINGS', 'CHECKINS', 'FINANCEIRO', 'alert', 'nomeDiaSemana', 'dataCurta',
    html.slice(ini, fimDoisJogos) + '\n' + html.slice(ini2, fim2) + '\nreturn montarTextoCheckinsWhatsApp;');
  const checkins = [{ data: DIA, jogadorId: 'a', jogadorNome: 'Cássia', jogo: 1 }, { data: DIA, jogadorId: 'b', jogadorNome: 'Bruno', jogo: 1 }];
  const fin = baseFin(); fin.pagamentos = [pg('1', 'a')]; fin.jogos = [];
  const semData = () => ''; // o template nos dois cenários não usa {diaSemana}/{data}, só precisa não quebrar
  const f = monta({ checkinDataAberta: DIA, checkinMensagemTemplate: 'ABERTURA', checkinHorario: '20:00', checkinVagas: 16 }, checkins, fin, () => {}, semData, semData);
  assert.equal(f(), 'ABERTURA\n\n💰 Valor: R$ 13,60\n\n📌 PIX para pagamento:\n31987702331\n\n1- Cássia ✅🍫\n2- Bruno');
  const semValor = monta({ checkinDataAberta: DIA, checkinMensagemTemplate: 'ABERTURA', checkinHorario: '20:00', checkinVagas: 16 }, checkins,
    { dias: [], jogos: [], pagamentos: [], lancamentos: [], log: [] }, () => {}, semData, semData);
  assert.equal(semValor(), 'ABERTURA\n\n1- Cássia\n2- Bruno');
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
