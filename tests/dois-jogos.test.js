// tests/dois-jogos.test.js
// Lógica pura de "dois jogos no mesmo dia": filas por jogo, chave de cobrança (null=dia, 1/2=jogo), visão mesclada
// do caixa e os textos de WhatsApp/fechamento. Extrai <financeiro-puro> (não muda) + <dois-jogos-puro> do HTML e
// roda os dois juntos — exatamente como a página de verdade. Rodar: node tests/dois-jogos.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
function bloco(tag) {
  const ini = html.indexOf('// <' + tag + '>');
  const fim = html.indexOf('// </' + tag + '>');
  assert.ok(ini > -1 && fim > ini, 'bloco <' + tag + '> não encontrado');
  return html.slice(ini, fim);
}
const corpo = bloco('financeiro-puro') + '\n' + bloco('dois-jogos-puro');
const EXPORTS = ['jogosDoDia', 'checkinsDoJogo', 'dentroEReservaDoJogo', 'estaNoJogo', 'vagasLivresDoJogo',
  'confirmadosPelaChave', 'chaveAtiva', 'cfgFinDaChave', 'finViewDaChave', 'finDiaMesclado', 'finVisaoCaixa',
  'corpoWhatsAppDoDia', 'fechamentoDoDia', 'finFormatar', 'finCentavos', 'finCaixa', 'finSaidaDia', 'finResumoFechamento'];
const F = new Function(corpo + '\nreturn { ' + EXPORTS.join(', ') + ' };')();

const SETTINGS = { checkinHorario: '19:00', checkinVagas: 2, checkinTravado: false, checkinJogo2: { data: '2026-10-06', horario: '21:00', vagas: 2, travado: false } };
const CK = [
  { id: 'c1', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', jogo: 1 },
  { id: 'c2', data: '2026-10-06', jogadorId: 'p2', jogadorNome: 'Bruno', jogo: 1 },
  { id: 'c3', data: '2026-10-06', jogadorId: 'p3', jogadorNome: 'Caio', jogo: 1 }, // reserva do jogo 1 (vagas=2)
  { id: 'c4', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', jogo: 2 }   // Ana nos dois jogos
];

let falhas = 0;
function t(nome, fn) { try { fn(); console.log('ok    -', nome); } catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('jogosDoDia: 1 jogo sem checkinJogo2; 2 jogos em ordem de horário; órfão (checkins sem config) ainda aparece', () => {
  assert.deepEqual(F.jogosDoDia({ checkinHorario: '19:00', checkinVagas: 16 }, [], '2026-10-06').map((j) => j.numero), [1]);
  assert.deepEqual(F.jogosDoDia(SETTINGS, CK, '2026-10-06').map((j) => j.horario), ['19:00', '21:00']);
  const orfaos = [{ id: 'x', data: '2026-10-06', jogadorId: 'p9', jogo: 2 }];
  assert.deepEqual(F.jogosDoDia({ checkinHorario: '19:00', checkinVagas: 16 }, orfaos, '2026-10-06').map((j) => j.numero), [1, 2]);
});

t('dentroEReservaDoJogo / estaNoJogo / vagasLivresDoJogo', () => {
  const { dentro, reserva } = F.dentroEReservaDoJogo(CK, '2026-10-06', 1, 2);
  assert.deepEqual(dentro.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(reserva.map((c) => c.id), ['c3']);
  assert.ok(F.estaNoJogo(CK, '2026-10-06', 2, 'p1'));
  assert.ok(!F.estaNoJogo(CK, '2026-10-06', 2, 'p2'));
  assert.equal(F.vagasLivresDoJogo(CK, '2026-10-06', 2, 2), 1);
});

t('confirmadosPelaChave: null é a UNIÃO sem duplicar; 1/2 é só daquele jogo', () => {
  assert.deepEqual(F.confirmadosPelaChave(SETTINGS, CK, '2026-10-06', null).map((c) => c.jogadorId), ['p1', 'p2']); // c3 é reserva, c4 é Ana repetida
  assert.deepEqual(F.confirmadosPelaChave(SETTINGS, CK, '2026-10-06', 1).map((c) => c.jogadorId), ['p1', 'p2']);
  assert.deepEqual(F.confirmadosPelaChave(SETTINGS, CK, '2026-10-06', 2).map((c) => c.jogadorId), ['p1']);
});

t('chaveAtiva: null quando porJogo é falso (mesmo com 2 jogos); o número do jogo ativo quando porJogo é true', () => {
  const fin = { dias: [{ data: '2026-10-06', porJogo: false }] };
  assert.equal(F.chaveAtiva(fin, '2026-10-06', 2), null);
  fin.dias[0].porJogo = true;
  assert.equal(F.chaveAtiva(fin, '2026-10-06', 2), 2);
});

t('cfgFinDaChave / finViewDaChave: separa pagamentos e créditos por chave', () => {
  const fin = {
    dias: [{ data: '2026-10-06', valorPessoa: 15, pix: '', valorQuadra: 300, temBrinde: false, valorBrinde: 0, icone: '✅', status: '', porJogo: true }],
    jogos: [{ data: '2026-10-06', jogo: 2, valorPessoa: 20, pix: 'px', valorQuadra: 150, temBrinde: false, valorBrinde: 0, icone: '✅', status: '' }],
    pagamentos: [
      { id: 'a', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', valor: 15, jogo: 1, estornado: false, marcadoPor: 'x', marcadoEm: '' },
      { id: 'b', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', valor: 20, jogo: 2, estornado: false, marcadoPor: 'x', marcadoEm: '' }
    ],
    creditos: []
  };
  assert.equal(F.cfgFinDaChave(fin, '2026-10-06', 2).valorPessoa, 20);
  assert.deepEqual(F.finViewDaChave(fin, '2026-10-06', 1).pagamentos.map((p) => p.id), ['a']);
  assert.deepEqual(F.finViewDaChave(fin, '2026-10-06', 2).pagamentos.map((p) => p.id), ['b']);
});

t('finDiaMesclado/finVisaoCaixa: soma as 2 quadras; "sem jogo" só quando os 2 jogos estão sem jogo', () => {
  const fin = {
    dias: [{ data: '2026-10-06', valorPessoa: 15, pix: 'px1', valorQuadra: 300, temBrinde: false, valorBrinde: 0, icone: '✅', status: '' }],
    jogos: [{ data: '2026-10-06', jogo: 2, valorPessoa: 20, pix: 'px2', valorQuadra: 150, temBrinde: true, valorBrinde: 10, icone: '✅', status: 'semjogo' }],
    pagamentos: [], creditos: []
  };
  const m = F.finDiaMesclado(fin, '2026-10-06');
  assert.deepEqual({ q: m.valorQuadra, b: m.valorBrinde, s: m.status }, { q: 300, b: 0, s: '' }); // jogo 2 sem jogo: a quadra dele não entra
  const vis = F.finVisaoCaixa(fin);
  assert.equal(F.finSaidaDia(vis, '2026-10-06'), 30000); // 300 em centavos
});

t('corpoWhatsAppDoDia: único soma as 2 listas sob um cabeçalho só; separado traz 1 cabeçalho por jogo', () => {
  const finUnico = { dias: [{ data: '2026-10-06', valorPessoa: 15, pix: 'chave-pix', porJogo: false, status: '' }], jogos: [], pagamentos: [], creditos: [] };
  const t1 = F.corpoWhatsAppDoDia(SETTINGS, CK, finUnico, '2026-10-06');
  assert.match(t1, /chave-pix/);
  assert.match(t1, /JOGO DAS 19:00/);
  assert.match(t1, /JOGO DAS 21:00/);
  assert.match(t1, /1- Ana/);
  assert.match(t1, /1- Caio/); // reserva do jogo 1
});

t('fechamentoDoDia: separado faz o saldo fechar (anterior + recebido - despesas = atual)', () => {
  const fin = {
    dias: [{ data: '2026-10-06', valorPessoa: 15, valorQuadra: 300, temBrinde: false, valorBrinde: 0, status: '', porJogo: true }],
    jogos: [{ data: '2026-10-06', jogo: 2, valorPessoa: 20, valorQuadra: 150, temBrinde: false, valorBrinde: 0, status: '' }],
    pagamentos: [{ id: 'a', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', valor: 15, jogo: 1, estornado: false, tipo: 'dinheiro', marcadoPor: 'x', marcadoEm: '' }],
    creditos: []
  };
  const texto = F.fechamentoDoDia(SETTINGS, CK, fin, '2026-10-06');
  const m = texto.match(/Saldo anterior: (−?R\$ [\d.,]+)[\s\S]*Total recebido: (−?R\$ [\d.,]+)[\s\S]*Total de despesas: (−?R\$ [\d.,]+)[\s\S]*Saldo atual em caixa: (−?R\$ [\d.,]+)/);
  assert.ok(m, texto);
  const n = (s) => Math.round(parseFloat(s.replace('−', '-').replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.')) * 100);
  assert.equal(n(m[1]) + 1500 - 45000, n(m[4])); // anterior(=0) + recebido - despesas = atual
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
