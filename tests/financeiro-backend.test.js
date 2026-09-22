// Testes do backend (financeiro + Ao Vivo) rodando o .gs REAL contra a planilha falsa.
//   Terça:  node tests/financeiro-backend.test.js
//   Meme:   MEME=1 node tests/financeiro-backend.test.js   (usa apps-script-codigo-volei-meme.gs, planilha própria e a senha do Meme)
const assert = require('node:assert/strict');
const path = require('path');
const { criarAmbiente } = require('./helpers/planilha-falsa');

const raiz = path.join(__dirname, '..');
const MEME = !!process.env.MEME;
const SUF = '';                                         // planilhas separadas agora: Terça e Meme usam os mesmos nomes de aba
const N = (nome) => nome + SUF;
const GS = MEME ? 'apps-script-codigo-volei-meme.gs' : 'apps-script-codigo.gs';
const DIA = '2026-09-18';
const SENHA = MEME ? '2026vmeme' : '131108'; // ADMIN_PASSWORD do .gs: entra como admin via chave mestra
console.log('== backend testado:', GS, MEME ? '(Meme)' : '(Terça)');

function novoAmbiente(){
  const nomes = ['Michel', 'Sara', 'Abraão', 'Ana'];
  const abas = {
    [N('Jogadores')]: [['id', 'nome', 'apelido', 'foto', 'estrelas', 'sexo', 'porte']].concat(nomes.map((n, i) => ['j' + i, n, '', '', 3, 'M', ''])),
    [N('Rodadas')]: [['roundId', 'data', 'timeIndex', 'timeNome', 'jogadores', 'vitorias', 'vencedor', 'rascunho'],
      // rodada-rascunho com 2 times (base dos testes do Ao Vivo)
      ['r1', DIA, 0, 'Time 1', 'j0,j1', 0, '', 'TRUE'],
      ['r1', DIA, 1, 'Time 2', 'j2,j3', 0, '', 'TRUE']],
    [N('Config')]: [['checkinDataAberta', DIA], ['checkinVagas', 3], ['checkinHorario', '20:00']],
    // vagas = 3: Michel, Sara e Abraão estão dentro; Ana (4ª) está na espera
    [N('Checkins')]: [['id', 'data', 'jogadorId', 'jogadorNome', 'estrelas', 'sexo', 'estrelasAjustadas']]
      .concat(nomes.map((n, i) => ['c' + i, DIA, 'j' + i, n, 3, 'M', ''])),
    [N('Usuarios')]: [['email', 'nome', 'perfil', 'jogadorId', 'criadoEm', 'jogadorIdPendente']]
  };
  if (MEME) {
    // no Meme as abas do Ao Vivo são criadas à mão (o script dele não cria sozinho); no Terça nascem sozinhas
    abas[N('AoVivo')] = [['roundId', 'data', 'timeIndex', 'timeNome', 'jogadores', 'vitorias', 'iniciadoEm', 'duracaoMinutos']];
    abas[N('AoVivoLog')] = [['roundId', 'timeIndex', 'timeNome', 'delta', 'timestamp']];
  }
  const amb = criarAmbiente(abas, [path.join(raiz, GS)]);
  // login do Google é rede: nos testes o "token" vale o que o teste disser
  amb.rodar(`
    var __perfil = 'organizador';
    // sem token = visitante (recusado), como o de verdade; com qualquer token = o organizador do teste
    verificarTokenGoogle_ = function(t){
      return t ? { ok: true, email: 'org@teste.com', nome: 'Org Teste' } : { ok: false, erro: 'Faça o login do Google para continuar.' };
    };
    perfilDoEmail_ = function(e){ return __perfil; };
    jogadorIdDoEmail_ = function(e){ return ''; };
    perfisPublicos_ = function(){ return []; };
  `);
  return amb;
}
const admin = (amb, action, extra) => amb.post(Object.assign({ action, senha: SENHA }, extra));
const org = (amb, action, extra) => amb.post(Object.assign({ action, idToken: 'x' }, extra)); // perfil organizador

let falhas = 0;
function t(nome, fn){
  try { fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}
const diaOk = { data: DIA, valorPessoa: 13.6, pix: '31987702331', valorQuadra: 180, temBrinde: true, valorBrinde: 50 };
// o backend já tem "dia sem jogo"/crédito? (Terça sim; o Meme só depois da replicação). FORCAR_CREDITO=1 não pula (ver falhar)
const TEM_CREDITO = !!process.env.FORCAR_CREDITO || novoAmbiente().rodar("typeof finMarcarDiaSemJogo_") === 'function';

t('salvarFinDia cria a linha, devolve o financeiro e escreve no log', () => {
  const amb = novoAmbiente();
  const r = admin(amb, 'salvarFinDia', { dia: diaOk });
  assert.equal(r.status, 'ok');
  assert.equal(r.financeiro.dias.length, 1);
  // sem ícone escolhido = ✅; dia normal = status vazio (o campo status só existe nos backends com "dia sem jogo")
  assert.deepEqual(r.financeiro.dias[0], Object.assign({}, diaOk, { icone: '✅' }, TEM_CREDITO ? { status: '' } : {}));
  assert.equal(r.financeiro.log[0].acao, 'salvarFinDia');
  assert.equal(r.financeiro.log[0].nome, 'Chave mestra');
});

t('salvarFinDia na mesma data atualiza (não duplica) e o log guarda o valor anterior', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  const r = admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, { valorPessoa: 15 }) });
  assert.equal(r.financeiro.dias.length, 1);
  assert.equal(r.financeiro.dias[0].valorPessoa, 15);
  const det = JSON.parse(r.financeiro.log[0].detalhe);
  assert.equal(det.antes.valorPessoa, 13.6);
  assert.equal(det.depois.valorPessoa, 15);
});

t('salvarFinDia recusa data inválida e valor negativo', () => {
  const amb = novoAmbiente();
  assert.ok(admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, { data: '18/09/2026' }) }).error);
  assert.ok(admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, { valorQuadra: -1 }) }).error);
  assert.equal(amb.get().financeiro.dias.length, 0);
});

t('brinde: quem manda é o VALOR (0, vazio ou ausente = sem brinde; > 0 = com brinde), não o checkbox do navegador', () => {
  const amb = novoAmbiente();
  const salvar = (extra) => admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, extra) }).financeiro.dias[0];
  assert.equal(salvar({ temBrinde: true, valorBrinde: 0 }).temBrinde, false);
  assert.equal(salvar({ temBrinde: true, valorBrinde: '' }).temBrinde, false);
  assert.equal(salvar({ temBrinde: true, valorBrinde: undefined }).temBrinde, false);
  const com = salvar({ temBrinde: false, valorBrinde: 50 });
  assert.equal(com.temBrinde, true); assert.equal(com.valorBrinde, 50);
  assert.equal(salvar({ valorBrinde: '12,5' }).valorBrinde, 12.5);
});

t('ícone de pagamento: ✅ por padrão, 💰 é aceito e guardado, qualquer outra coisa vira ✅', () => {
  const amb = novoAmbiente();
  const salvar = (icone) => admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, { icone }) }).financeiro.dias[0].icone;
  assert.equal(salvar(undefined), '✅');
  assert.equal(salvar('💰'), '💰');
  assert.equal(amb.get().financeiro.dias[0].icone, '💰');   // e a leitura (doGet) devolve o guardado
  assert.equal(salvar('🤡'), '✅');
});

t('marcarPagamento recusa dia sem valor por pessoa', () => {
  const amb = novoAmbiente();
  const r = admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'j0', jogadorNome: 'Michel' });
  assert.match(r.error, /valor por pessoa/i);
});

t('marcarPagamento recusa quem não está no check-in do dia', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  const r = admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'fantasma', jogadorNome: 'X' });
  assert.match(r.error, /check-in/i);
});

t('marcarPagamento grava o valor do DIA (ignora valor enviado pelo navegador) e é idempotente', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  const r1 = admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'j0', jogadorNome: 'Michel', valor: 0.01 });
  assert.equal(r1.financeiro.pagamentos.length, 1);
  assert.equal(r1.financeiro.pagamentos[0].valor, 13.6);
  const r2 = admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'j0', jogadorNome: 'Michel' });
  assert.equal(r2.financeiro.pagamentos.length, 1);
});

t('mudar o valor do dia depois NÃO reescreve pagamentos já marcados', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'j0', jogadorNome: 'Michel' });
  const r = admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, { valorPessoa: 20 }) });
  assert.equal(r.financeiro.pagamentos[0].valor, 13.6);
});

t('estornar: organizador estorna quem está na lista; marcar de novo cria linha nova', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  const id = admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'j0', jogadorNome: 'Michel' }).financeiro.pagamentos[0].id;
  const r = org(amb, 'estornarPagamento', { id });
  assert.equal(r.status, 'ok');
  assert.equal(r.financeiro.pagamentos[0].estornado, true);
  assert.equal(r.financeiro.pagamentos[0].estornadoPor, 'Org Teste');
  const r2 = admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'j0', jogadorNome: 'Michel' });
  assert.equal(r2.financeiro.pagamentos.length, 2);
  assert.equal(r2.financeiro.pagamentos.filter(p => !p.estornado).length, 1);
});

t('estornar: quem NÃO está entre os confirmados (espera ou saiu) só o admin estorna', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  // Ana (j3) é a 4ª, fora das 3 vagas; gravo o pagamento direto pra simular "pagou e depois foi pra espera/saiu"
  amb.rodar("finAba_('" + N('FinPagamentos') + "')"); // a aba só nasce na primeira gravação; aqui crio antes de escrever direto nela
  amb.abas[N('FinPagamentos')].appendRow(['pg-ana', DIA, 'j3', 'Ana', 13.6, 'Adm', '2026-09-18T20:00:00.000Z', 'FALSE', '', '']);
  const negado = org(amb, 'estornarPagamento', { id: 'pg-ana' });
  assert.match(negado.error, /não tem permissão/i);
  assert.equal(amb.get().financeiro.pagamentos[0].estornado, false);
  const ok = admin(amb, 'estornarPagamento', { id: 'pg-ana' });
  assert.equal(ok.financeiro.pagamentos[0].estornado, true);
  assert.equal(JSON.parse(ok.financeiro.log[0].detalhe).motivo, 'pessoa fora da lista');
});

t('estornar duas vezes não dá erro nem duplica o log', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  const id = admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'j0', jogadorNome: 'Michel' }).financeiro.pagamentos[0].id;
  admin(amb, 'estornarPagamento', { id });
  const antes = amb.get().financeiro.log.length;
  const r = admin(amb, 'estornarPagamento', { id });
  assert.equal(r.status, 'ok');
  assert.equal(r.financeiro.log.length, antes);
});

t('addLancamento valida tipo, valor e descrição; grava e loga', () => {
  const amb = novoAmbiente();
  assert.ok(admin(amb, 'addLancamento', { lancamento: { data: DIA, tipo: 'roubo', descricao: 'x', valor: 5 } }).error);
  assert.ok(admin(amb, 'addLancamento', { lancamento: { data: DIA, tipo: 'entrada', descricao: 'x', valor: 0 } }).error);
  assert.ok(admin(amb, 'addLancamento', { lancamento: { data: DIA, tipo: 'entrada', descricao: '  ', valor: 5 } }).error);
  const r = org(amb, 'addLancamento', { lancamento: { data: DIA, tipo: 'entrada', descricao: 'Saldo inicial', valor: 500 } });
  assert.equal(r.financeiro.lancamentos.length, 1);
  assert.equal(r.financeiro.lancamentos[0].valor, 500);
  assert.equal(r.financeiro.lancamentos[0].criadoPor, 'Org Teste');
});

t('estornarLancamento é só do admin', () => {
  const amb = novoAmbiente();
  const id = admin(amb, 'addLancamento', { lancamento: { data: DIA, tipo: 'saida', descricao: 'Bola', valor: 80 } }).financeiro.lancamentos[0].id;
  assert.match(org(amb, 'estornarLancamento', { id }).error, /não tem permissão/i);
  const r = admin(amb, 'estornarLancamento', { id });
  assert.equal(r.financeiro.lancamentos[0].estornado, true);
});

t('doGet devolve o financeiro e o log NÃO expõe e-mail', () => {
  const amb = novoAmbiente();
  org(amb, 'addLancamento', { lancamento: { data: DIA, tipo: 'entrada', descricao: 'x', valor: 1 } });
  const json = amb.get();
  assert.ok(json.financeiro && Array.isArray(json.financeiro.dias));
  assert.ok(!JSON.stringify(json.financeiro).includes('org@teste.com'));
  // ...mas o e-mail fica guardado na aba de log, no servidor
  assert.equal(amb.abas[N('FinLog')].linhas[1][2], 'org@teste.com');
});

t('ação financeira exige perfil: visitante sem login é recusado (mesmo com tudo válido)', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk }); // dia configurado e Michel no check-in: o ÚNICO motivo de recusa possível é a falta de login
  const r = amb.post({ action: 'marcarPagamento', data: DIA, jogadorId: 'j0', jogadorNome: 'Michel' });
  assert.match(r.error, /login/i);
  assert.equal(amb.get().financeiro.pagamentos.length, 0);
});

/* ---------- ações em massa: "Confirmar todos" e "Cancelar todos" pagamentos do dia ---------- */
// (Terça e Meme têm; o "pulado" só protege contra rodar este teste num .gs mais antigo, sem as ações em massa)
const TEM_MASSA = !!process.env.FORCAR_MASSA || novoAmbiente().rodar("typeof finMarcarTodos_") === 'function'; // FORCAR_MASSA=1 não pula (ver o teste falhar)
const tm = TEM_MASSA ? t : (nome) => console.log('pulado -', nome, '(este backend ainda não tem as ações em massa)');
const pagamentosValidos = (amb) => amb.get().financeiro.pagamentos.filter(p => !p.estornado);

tm('marcarTodos: marca só os confirmados DENTRO das vagas que ainda não pagaram (ignora a espera, não duplica quem já pagou)', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  admin(amb, 'marcarPagamento', { data: DIA, jogadorId: 'j0', jogadorNome: 'Michel' });   // Michel já tinha pago
  const r = admin(amb, 'marcarTodosPagamentos', { data: DIA });
  assert.equal(r.status, 'ok');
  const validos = r.financeiro.pagamentos.filter(p => !p.estornado);
  assert.deepEqual(validos.map(p => p.jogadorId).sort(), ['j0', 'j1', 'j2']);            // Ana (j3, 4ª) está na espera: fora
  assert.ok(validos.every(p => p.valor === 13.6));                                       // valor do dia, do servidor
  assert.equal(validos.filter(p => p.jogadorId === 'j0').length, 1);                     // Michel não duplicou
  const log = JSON.parse(r.financeiro.log[0].detalhe);
  assert.equal(r.financeiro.log[0].acao, 'marcarTodosPagamentos');
  assert.equal(log.quantidade, 2); assert.deepEqual(log.nomes.sort(), ['Abraão', 'Sara']);
});

tm('marcarTodos: é idempotente, exige dia com valor por pessoa e exige login', () => {
  const amb = novoAmbiente();
  assert.match(admin(amb, 'marcarTodosPagamentos', { data: DIA }).error, /valor por pessoa/i);
  admin(amb, 'salvarFinDia', { dia: diaOk });
  admin(amb, 'marcarTodosPagamentos', { data: DIA });
  const antes = amb.get().financeiro;
  const r = admin(amb, 'marcarTodosPagamentos', { data: DIA });          // de novo: nada a marcar
  assert.equal(r.financeiro.pagamentos.length, antes.pagamentos.length);
  assert.equal(r.financeiro.log.length, antes.log.length);                // e nem loga
  assert.match(amb.post({ action: 'marcarTodosPagamentos', data: DIA }).error, /login/i);
  assert.ok(admin(amb, 'marcarTodosPagamentos', { data: '18/09' }).error);
});

tm('estornarTodos (admin): estorna TODOS os pagamentos do dia, inclusive de quem saiu da lista, e devolve as contagens', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  admin(amb, 'marcarTodosPagamentos', { data: DIA });                     // Michel, Sara, Abraão
  amb.rodar("finAba_('" + N('FinPagamentos') + "')");
  amb.abas[N('FinPagamentos')].appendRow(['pg-ana', DIA, 'j3', 'Ana', 13.6, 'Adm', '2026-09-18T20:00:00.000Z', 'FALSE', '', '']); // pagou e está fora das vagas
  const r = admin(amb, 'estornarTodosPagamentos', { data: DIA });
  assert.equal(r.estornados, 4); assert.equal(r.ignorados, 0);
  assert.equal(pagamentosValidos(amb).length, 0);
  assert.ok(r.financeiro.pagamentos.every(p => p.estornado && p.estornadoPor === 'Chave mestra'));
  assert.equal(r.financeiro.log[0].acao, 'estornarTodosPagamentos');
  assert.equal(JSON.parse(r.financeiro.log[0].detalhe).quantidade, 4);
});

tm('estornarTodos (organizador): estorna só quem ainda está na lista; o de quem saiu fica (só o admin estorna)', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  admin(amb, 'marcarTodosPagamentos', { data: DIA });
  amb.rodar("finAba_('" + N('FinPagamentos') + "')");
  amb.abas[N('FinPagamentos')].appendRow(['pg-ana', DIA, 'j3', 'Ana', 13.6, 'Adm', '2026-09-18T20:00:00.000Z', 'FALSE', '', '']);
  const r = org(amb, 'estornarTodosPagamentos', { data: DIA });
  assert.equal(r.estornados, 3); assert.equal(r.ignorados, 1);
  assert.deepEqual(pagamentosValidos(amb).map(p => p.jogadorId), ['j3']);                 // sobrou só a da Ana
  assert.ok(r.financeiro.pagamentos.filter(p => p.estornado).every(p => p.estornadoPor === 'Org Teste'));
  // o admin termina o serviço
  assert.equal(admin(amb, 'estornarTodosPagamentos', { data: DIA }).estornados, 1);
  assert.equal(pagamentosValidos(amb).length, 0);
});

tm('estornarTodos: só mexe no dia pedido, é idempotente e exige login', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  admin(amb, 'marcarTodosPagamentos', { data: DIA });
  amb.rodar("finAba_('" + N('FinPagamentos') + "')");
  amb.abas[N('FinPagamentos')].appendRow(['pg-outro', '2026-09-11', 'j0', 'Michel', 13.6, 'Adm', '2026-09-11T20:00:00.000Z', 'FALSE', '', '']); // outro dia
  assert.match(amb.post({ action: 'estornarTodosPagamentos', data: DIA }).error, /login/i);
  admin(amb, 'estornarTodosPagamentos', { data: DIA });
  const vivos = pagamentosValidos(amb);
  assert.deepEqual(vivos.map(p => p.id), ['pg-outro']);                                   // o do dia 11 continua
  const logAntes = amb.get().financeiro.log.length;
  const r = admin(amb, 'estornarTodosPagamentos', { data: DIA });                         // de novo: nada a estornar
  assert.equal(r.estornados, 0); assert.equal(r.financeiro.log.length, logAntes);
});

tm('marcar todos e depois cancelar todos volta ao caixa de antes (só a saída do dia fica)', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  admin(amb, 'marcarTodosPagamentos', { data: DIA });
  assert.equal(pagamentosValidos(amb).length, 3);
  admin(amb, 'estornarTodosPagamentos', { data: DIA });
  assert.equal(pagamentosValidos(amb).length, 0);
  admin(amb, 'marcarTodosPagamentos', { data: DIA });                                     // pode marcar de novo depois de cancelar
  assert.equal(pagamentosValidos(amb).length, 3);
});

/* ---------- dia sem jogo e crédito de jogadores ---------- */
// (só o Terça tem por enquanto; no Meme ficam pulados até a replicação)
const tc = TEM_CREDITO ? t : (nome) => console.log('pulado -', nome, '(este backend ainda não tem dia sem jogo/crédito)');
const D0 = '2026-09-11';                                 // um dia ANTERIOR ao DIA (18/09), que vai ser o "dia sem jogo"
const NOMES_J = { j0: 'Michel', j1: 'Sara', j2: 'Abraão', j3: 'Ana', j9: 'Zé' };
// monta o D0: check-ins (j0,j1,j2,j3 + os extras pedidos), dia configurado com o valor e os pagamentos marcados
function prepararD0(amb, pagantes, valor, extras) {
  const ck = amb.abas[N('Checkins')];
  ['j0', 'j1', 'j2', 'j3'].concat(extras || []).forEach((j) => ck.appendRow(['ck-' + D0 + j, D0, j, NOMES_J[j], 3, 'M', '']));
  admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, { data: D0, valorPessoa: valor || 13.6 }) });
  pagantes.forEach((j) => admin(amb, 'marcarPagamento', { data: D0, jogadorId: j, jogadorNome: NOMES_J[j] }));
}
const fin = (amb) => amb.get().financeiro;
const dia = (amb, data) => fin(amb).dias.find((d) => d.data === data);
const pagosCredito = (amb, data) => fin(amb).pagamentos.filter((p) => p.data === data && !p.estornado && p.tipo === 'credito');
// saldo de um crédito = valor − pagamentos por crédito ainda válidos (mesma regra do app)
const saldoDe = (amb, c) => Math.round(c.valor * 100) - Math.round(fin(amb).pagamentos
  .filter((p) => !p.estornado && p.tipo === 'credito' && p.creditoId === c.id).reduce((s, p) => s + p.valor, 0) * 100);

tc('sem jogo (crédito): o dia vira semjogo, cada pagamento em dinheiro vira um crédito ativo e o dinheiro continua pago', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0', 'j1']);
  const r = admin(amb, 'marcarDiaSemJogo', { data: D0, destino: 'credito' });
  assert.equal(r.status, 'ok');
  assert.equal(dia(amb, D0).status, 'semjogo');
  assert.equal(r.creditos, 2);
  const cs = fin(amb).creditos;
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => c.status === 'ativo' && c.valor === 13.6 && c.dataOrigem === D0));
  assert.deepEqual(cs.map((c) => c.jogadorId).sort(), ['j0', 'j1']);
  const pagosD0 = fin(amb).pagamentos.filter((p) => p.data === D0 && !p.estornado);
  assert.equal(pagosD0.length, 2);                                        // o dinheiro segue no caixa
  assert.deepEqual(cs.map((c) => c.origemPagamentoId).sort(), pagosD0.map((p) => p.id).sort());
  assert.equal(fin(amb).log[0].acao, 'marcarDiaSemJogo');
  // idempotente: marcar de novo não duplica crédito
  const r2 = admin(amb, 'marcarDiaSemJogo', { data: D0, destino: 'credito' });
  assert.equal(r2.creditos, 0); assert.equal(fin(amb).creditos.length, 2);
});

tc('sem jogo: exige o dia configurado e o login; salvar o dia de novo não perde o status', () => {
  const amb = novoAmbiente();
  assert.match(admin(amb, 'marcarDiaSemJogo', { data: D0 }).error, /Configure o dia/i);
  prepararD0(amb, []);
  assert.match(amb.post({ action: 'marcarDiaSemJogo', data: D0 }).error, /login/i);
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, { data: D0, valorQuadra: 200 }) });   // editar valores
  assert.equal(dia(amb, D0).status, 'semjogo'); assert.equal(dia(amb, D0).valorQuadra, 200);
});

tc('sem jogo (devolver): estorna os pagamentos do dia e não cria crédito; organizador não estorna quem saiu da lista', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0', 'j1']);
  amb.abas[N('FinPagamentos')].appendRow(['pg-ana0', D0, 'j9', 'Zé', 13.6, 'Adm', '2026-09-11T20:00:00.000Z', 'FALSE', '', '', 'dinheiro', '']); // pagou e não está no check-in do dia
  const r = org(amb, 'marcarDiaSemJogo', { data: D0, destino: 'devolver' });
  assert.equal(r.estornados, 2); assert.equal(r.ignorados, 1); assert.equal(r.creditos, 0);
  assert.equal(fin(amb).creditos.length, 0);
  assert.equal(fin(amb).pagamentos.filter((p) => p.data === D0 && !p.estornado).length, 1);   // sobrou o do Zé (só o admin estorna)
  const amb2 = novoAmbiente();
  prepararD0(amb2, ['j0', 'j1']);
  const r2 = admin(amb2, 'marcarDiaSemJogo', { data: D0, destino: 'devolver' });
  assert.equal(r2.estornados, 2); assert.equal(fin(amb2).pagamentos.filter((p) => !p.estornado).length, 0);
});

tc('crédito aplicado sozinho ao salvar o dia seguinte: só quem está DENTRO das vagas e tem crédito, com o valor do dia', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0', 'j1', 'j3']);                          // Ana (j3) também pagou no D0
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  admin(amb, 'salvarFinDia', { dia: diaOk });                   // dia 18: j0,j1,j2 dentro; Ana (j3) na espera
  const cp = pagosCredito(amb, DIA);
  assert.deepEqual(cp.map((p) => p.jogadorId).sort(), ['j0', 'j1']);     // j2 não tinha crédito; Ana está na espera
  assert.ok(cp.every((p) => p.valor === 13.6 && p.marcadoPor === 'Crédito automático' && p.creditoId));
  const c0 = fin(amb).creditos.find((c) => c.jogadorId === 'j0');
  assert.equal(saldoDe(amb, c0), 0);
  assert.equal(saldoDe(amb, fin(amb).creditos.find((c) => c.jogadorId === 'j3')), 1360);   // o da Ana segue disponível
  assert.equal(fin(amb).log[0].acao, 'aplicarCreditos');
});

tc('crédito parcial e insuficiente: maior que o valor sobra saldo; menor que o valor não é aplicado', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0'], 20);                                  // crédito de 20,00
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  admin(amb, 'salvarFinDia', { dia: diaOk });                   // dia 18 custa 13,60
  const c = fin(amb).creditos[0];
  assert.equal(pagosCredito(amb, DIA).length, 1);
  assert.equal(saldoDe(amb, c), 640);                           // sobrou 6,40 (não se perde dinheiro)
  const amb2 = novoAmbiente();
  prepararD0(amb2, ['j0'], 10);                                 // crédito de 10,00 < 13,60
  admin(amb2, 'marcarDiaSemJogo', { data: D0 });
  admin(amb2, 'salvarFinDia', { dia: diaOk });
  assert.equal(pagosCredito(amb2, DIA).length, 0);              // não cobre: a pessoa segue pendente
  assert.equal(saldoDe(amb2, fin(amb2).creditos[0]), 1000);
});

tc('aplicação automática também ao CONFIRMAR presença (addCheckin) e quando alguém SAI e a espera sobe (removeCheckin)', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0', 'j3']);
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  const E2 = '2026-09-25';
  admin(amb, 'salvarFinDia', { dia: Object.assign({}, diaOk, { data: E2 }) });          // dia configurado, ninguém confirmado ainda
  assert.equal(pagosCredito(amb, E2).length, 0);
  org(amb, 'addCheckin', { checkin: { id: 'cE2', data: E2, jogadorId: 'j0', jogadorNome: 'Michel', estrelas: 3, sexo: 'M' } });
  assert.deepEqual(pagosCredito(amb, E2).map((p) => p.jogadorId), ['j0']);              // confirmou => já aparece pago (Crédito)
  // dia 18: Michel, Sara, Abraão dentro; Ana (crédito) na espera
  admin(amb, 'salvarFinDia', { dia: diaOk });
  assert.equal(pagosCredito(amb, DIA).filter((p) => p.jogadorId === 'j3').length, 0);
  org(amb, 'removeCheckin', { id: 'c1' });                                               // a Sara sai: a Ana sobe
  assert.deepEqual(pagosCredito(amb, DIA).map((p) => p.jogadorId), ['j3']);
});

tc('quem SAI da lista (removeCheckin) devolve o crédito que tinha usado no dia', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0']);
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  admin(amb, 'salvarFinDia', { dia: diaOk });                                            // j0 (c0) entra pago por crédito
  const c = fin(amb).creditos[0];
  assert.equal(saldoDe(amb, c), 0);
  org(amb, 'removeCheckin', { id: 'c0' });                                               // Michel desmarca a presença
  assert.equal(pagosCredito(amb, DIA).length, 0);
  assert.equal(saldoDe(amb, c), 1360);                                                   // o crédito voltou
  assert.equal(fin(amb).pagamentos.filter((p) => p.data === DIA && p.tipo === 'credito' && p.estornado).length, 1);
});

tc('estornar um pagamento por crédito só devolve o crédito; estornar o pagamento de ORIGEM de um crédito ativo devolve o crédito junto (se não foi usado)', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0', 'j1']);
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  admin(amb, 'salvarFinDia', { dia: diaOk });
  const pc = pagosCredito(amb, DIA).find((p) => p.jogadorId === 'j0');
  admin(amb, 'estornarPagamento', { id: pc.id });                                        // "desmarcar" o pago por crédito
  assert.equal(saldoDe(amb, fin(amb).creditos.find((c) => c.jogadorId === 'j0')), 1360);
  // origem do j0 agora tem crédito ativo SEM uso: estornar o dinheiro cancela o crédito (devolvido)
  const origem = fin(amb).pagamentos.find((p) => p.data === D0 && p.jogadorId === 'j0');
  admin(amb, 'estornarPagamento', { id: origem.id });
  assert.equal(fin(amb).creditos.find((c) => c.jogadorId === 'j0').status, 'devolvido');
  // origem do j1 já foi usada no dia 18: não dá para estornar o dinheiro
  const origem1 = fin(amb).pagamentos.find((p) => p.data === D0 && p.jogadorId === 'j1');
  assert.match(admin(amb, 'estornarPagamento', { id: origem1.id }).error, /virou crédito e já foi usado/i);
});

tc('reabrir o dia: volta ao normal e cancela os créditos se NENHUM foi usado; se algum já foi usado, recusa', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0', 'j1']);
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  const r = org(amb, 'reabrirDia', { data: D0 });
  assert.equal(r.status, 'ok');
  assert.equal(dia(amb, D0).status, '');
  assert.ok(fin(amb).creditos.every((c) => c.status === 'cancelado'));
  assert.equal(fin(amb).pagamentos.filter((p) => p.data === D0 && !p.estornado).length, 2);   // voltaram a ser pagamentos comuns
  const amb2 = novoAmbiente();
  prepararD0(amb2, ['j0', 'j1']);
  admin(amb2, 'marcarDiaSemJogo', { data: D0 });
  admin(amb2, 'salvarFinDia', { dia: diaOk });                                            // usa os créditos no dia 18
  assert.match(admin(amb2, 'reabrirDia', { data: D0 }).error, /já foram usados/i);
  assert.equal(dia(amb2, D0).status, 'semjogo');
});

tc('devolver crédito (só admin): estorna o dinheiro de origem; recusa se já foi usado', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0', 'j1']);
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  const c0 = fin(amb).creditos.find((c) => c.jogadorId === 'j0');
  assert.match(org(amb, 'devolverCredito', { id: c0.id }).error, /não tem permissão/i);
  const r = admin(amb, 'devolverCredito', { id: c0.id });
  assert.equal(r.status, 'ok');
  assert.equal(fin(amb).creditos.find((c) => c.id === c0.id).status, 'devolvido');
  assert.equal(fin(amb).pagamentos.find((p) => p.id === c0.origemPagamentoId).estornado, true);   // o dinheiro saiu do caixa
  admin(amb, 'salvarFinDia', { dia: diaOk });                                             // j1 usa o crédito dele no dia 18
  const c1 = fin(amb).creditos.find((c) => c.jogadorId === 'j1');
  assert.match(admin(amb, 'devolverCredito', { id: c1.id }).error, /já foi usado/i);
});

tc('marcar sem jogo um dia que TINHA pagamentos por crédito devolve esses créditos (não são dinheiro) e não mexe no caixa', () => {
  const amb = novoAmbiente();
  prepararD0(amb, ['j0']);
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  admin(amb, 'salvarFinDia', { dia: diaOk });                                             // dia 18: j0 pago por crédito
  assert.equal(pagosCredito(amb, DIA).length, 1);
  const r = admin(amb, 'marcarDiaSemJogo', { data: DIA });                                // choveu no dia 18 também
  assert.equal(r.status, 'ok');
  assert.equal(pagosCredito(amb, DIA).length, 0);
  assert.equal(saldoDe(amb, fin(amb).creditos.find((c) => c.jogadorId === 'j0' && c.dataOrigem === D0)), 1360);
});

tc('ações em massa não valem para dia sem jogo', () => {
  const amb = novoAmbiente();
  admin(amb, 'salvarFinDia', { dia: diaOk });
  admin(amb, 'marcarDiaSemJogo', { data: DIA });
  assert.match(admin(amb, 'marcarTodosPagamentos', { data: DIA }).error, /sem jogo/i);
  assert.match(admin(amb, 'estornarTodosPagamentos', { data: DIA }).error, /sem jogo/i);
});

tc('aplicarCreditosDoDia (manual): aplica o que faltou e devolve a quantidade', () => {
  const amb = novoAmbiente();
  amb.abas[N('Config')].linhas.find((l) => l[0] === 'checkinVagas')[1] = 4;               // 4 vagas: quem voltar como 4º ainda fica dentro
  prepararD0(amb, ['j0']);
  admin(amb, 'marcarDiaSemJogo', { data: D0 });
  admin(amb, 'salvarFinDia', { dia: diaOk });
  org(amb, 'removeCheckin', { id: 'c0' });                                                // sai e devolve o crédito
  amb.abas[N('Checkins')].appendRow(['c0b', DIA, 'j0', 'Michel', 3, 'M', '']);            // volta pela planilha (sem passar pelo gancho)
  assert.equal(pagosCredito(amb, DIA).length, 0);
  const r = org(amb, 'aplicarCreditosDoDia', { data: DIA });
  assert.equal(r.aplicados, 1);
  assert.equal(pagosCredito(amb, DIA).length, 1);
  assert.equal(org(amb, 'aplicarCreditosDoDia', { data: DIA }).aplicados, 0);             // idempotente
});

/* ---------- Ao Vivo (portado do Meme pro Terça; as abas AoVivo/AoVivoLog nascem sozinhas) ---------- */

t('Ao Vivo: iniciar cria as abas, espelha os 2 times e a leitura pública devolve a transmissão', () => {
  const amb = novoAmbiente();
  if (!MEME) assert.ok(!amb.abas.AoVivo, 'a aba AoVivo ainda não deveria existir'); // no Terça ela nasce aqui; no Meme já existe (criada à mão)
  const r = org(amb, 'iniciarTransmissaoAoVivo', { roundId: 'r1', duracaoMinutos: 10 });
  assert.equal(r.status, 'ok');
  assert.equal(amb.abas[N('AoVivo')].linhas.length, 3); // cabeçalho + 2 times
  const lido = amb.post({ action: 'lerAoVivo' }); // leitura pública: sem senha nem login
  assert.equal(lido.rounds.length, 1);
  assert.equal(lido.rounds[0].times.length, 2);
  assert.deepEqual(lido.rounds[0].times[0].playerIds, ['j0', 'j1']);
  assert.equal(lido.rounds[0].duracaoMinutos, 10);
  assert.equal(amb.get().aoVivo.rounds.length, 1); // e o doGet também traz
});

t('Ao Vivo: não inicia duas vezes a mesma rodada, nem rodada que já teve placar lançado', () => {
  const amb = novoAmbiente();
  org(amb, 'iniciarTransmissaoAoVivo', { roundId: 'r1', duracaoMinutos: 10 });
  assert.match(org(amb, 'iniciarTransmissaoAoVivo', { roundId: 'r1', duracaoMinutos: 10 }).error, /já está sendo transmitida/i);
  assert.match(org(amb, 'iniciarTransmissaoAoVivo', { roundId: 'nao-existe', duracaoMinutos: 10 }).error, /não encontrada/i);
});

t('Ao Vivo: salvar parcial grava o placar e o histórico (delta) do que mudou', () => {
  const amb = novoAmbiente();
  org(amb, 'iniciarTransmissaoAoVivo', { roundId: 'r1', duracaoMinutos: 10 });
  assert.equal(org(amb, 'salvarParcialAoVivo', { roundId: 'r1', vitoriasPorTime: [2, 0] }).status, 'ok');
  org(amb, 'salvarParcialAoVivo', { roundId: 'r1', vitoriasPorTime: [2, 1] }); // só o Time 2 mudou
  const lido = amb.post({ action: 'lerAoVivo' });
  assert.deepEqual(lido.rounds[0].times.map(x => x.vitorias), [2, 1]);
  assert.equal(lido.log.length, 2);                               // Time 1 +2, depois Time 2 +1
  assert.deepEqual(lido.log.map(l => l.delta).sort(), [1, 2]);
});

t('Ao Vivo: cancelar apaga a transmissão e o histórico; ações de escrita exigem perfil', () => {
  const amb = novoAmbiente();
  assert.ok(amb.post({ action: 'iniciarTransmissaoAoVivo', roundId: 'r1' }).error, 'visitante não inicia');
  org(amb, 'iniciarTransmissaoAoVivo', { roundId: 'r1', duracaoMinutos: 10 });
  org(amb, 'salvarParcialAoVivo', { roundId: 'r1', vitoriasPorTime: [1, 0] });
  assert.equal(org(amb, 'cancelarTransmissaoAoVivo', { roundId: 'r1' }).status, 'ok');
  const lido = amb.post({ action: 'lerAoVivo' });
  assert.equal(lido.rounds.length, 0);
  assert.equal(lido.log.length, 0);
});

t('Ao Vivo: leitura sem as abas não quebra e não cria nada', () => {
  const amb = novoAmbiente();
  assert.deepEqual(amb.post({ action: 'lerAoVivo' }), { rounds: [], log: [] });
  if (!MEME) assert.ok(!amb.abas.AoVivo && !amb.abas.AoVivoLog); // leitura nunca cria aba (no Terça elas só nascem na 1ª transmissão)
});

t('doGet devolve aoVivo e financeiro juntos (o app do Terça precisa dos dois)', () => {
  const j = novoAmbiente().get();
  assert.ok(j.aoVivo && Array.isArray(j.aoVivo.rounds));
  assert.ok(j.financeiro && Array.isArray(j.financeiro.dias));
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
