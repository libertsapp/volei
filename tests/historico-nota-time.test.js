// Nota total de cada time no Histórico (só admin): nota ajustada no check-in DAQUELE dia quando existe (foi a do
// sorteio), senão a nota atual do cadastro; sem nota ou jogador removido conta 3 (regra do sorteio e das panelas).
// Extrai as funções do HTML. Rodar: node tests/historico-nota-time.test.js  (HTML_ARQUIVO=<caminho> p/ outra página)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const pegar = (inicio) => {
  const i = html.indexOf(inicio);
  assert.ok(i > -1, 'não encontrei: ' + inicio);
  return html.slice(i, html.indexOf('\n}\n', i) + 3);
};
const { notaTotalDoTime, formatarNotaTotal } = new Function(
  pegar('function notaTotalDoTime(') + pegar('function formatarNotaTotal(') + '; return { notaTotalDoTime, formatarNotaTotal };'
)();

const jogadores = { a: { id: 'a', estrelas: 4 }, b: { id: 'b', estrelas: 3.5 }, c: { id: 'c', estrelas: 0 }, d: { id: 'd', estrelas: 5 } };
const getPlayer = (id) => jogadores[id];
const checkins = [
  { data: '2026-09-29', jogadorId: 'a', estrelasAjustadas: 2.5 },  // ajuste do dia: vale 2,5 nessa rodada
  { data: '2026-09-22', jogadorId: 'd', estrelasAjustadas: 4 },    // ajuste de OUTRO dia: não vale em 29/09
  { data: '2026-09-29', jogadorId: 'b', estrelasAjustadas: '' },   // ajuste vazio: usa o cadastro
  { data: '2026-09-29', jogadorId: 'x', estrelasAjustadas: 4.5 }   // removido do cadastro, mas com ajuste do dia
];

// a (ajuste 2,5) + b (cadastro 3,5) + c (sem nota -> 3) + d (cadastro 5; o ajuste é de outro dia) = 14
assert.equal(notaTotalDoTime(['a', 'b', 'c', 'd'], '2026-09-29', checkins, getPlayer), 14);
// no dia 22 o ajuste do "d" vale (4) e o "a" volta ao cadastro (4): 4 + 4 = 8
assert.equal(notaTotalDoTime(['a', 'd'], '2026-09-22', checkins, getPlayer), 8);
// jogador removido: com ajuste do dia usa o ajuste; sem ajuste conta 3
assert.equal(notaTotalDoTime(['x'], '2026-09-29', checkins, getPlayer), 4.5);
assert.equal(notaTotalDoTime(['y'], '2026-09-29', checkins, getPlayer), 3);
// time vazio ou sem lista
assert.equal(notaTotalDoTime([], '2026-09-29', checkins, getPlayer), 0);
assert.equal(notaTotalDoTime(undefined, '2026-09-29', checkins, getPlayer), 0);
// formatação: inteiro sem casa decimal, meia estrela com vírgula
assert.equal(formatarNotaTotal(14), '★ 14');
assert.equal(formatarNotaTotal(17.5), '★ 17,5');
assert.equal(formatarNotaTotal(0), '★ 0');
console.log('ok — nota total do time no histórico');

// A tela: renderHistory de verdade, com uma página mínima. Admin vê a nota total nas rodadas e nos rascunhos; os outros não.
function telaDoHistorico(admin) {
  const el = {};
  const elemento = (id) => (el[id] ||= { id, innerHTML: '', textContent: '', style: {}, querySelectorAll: () => [] });
  const F = new Function('admin', 'elemento', `
    const document = { getElementById: elemento };
    const ehAdminAgora = () => admin;
    const DATA = { rounds: [
      { id: 'r1', data: '2026-09-29', rascunho: false, vencedores: [0], times: [{ nome: 'Azul', vitorias: 3, playerIds: ['a', 'b'] }, { nome: 'Verde', vitorias: 1, playerIds: ['c'] }] },
      { id: 'r2', data: '2026-10-06', rascunho: true, vencedores: [], times: [{ nome: 'Rascunho A', vitorias: 0, playerIds: ['d'] }] }
    ], aoVivo: { rounds: [] } };
    const CHECKINS = [];
    const jogadores = { a: { id: 'a', nome: 'A', estrelas: 4 }, b: { id: 'b', nome: 'B', estrelas: 3.5 }, c: { id: 'c', nome: 'C', estrelas: 0 }, d: { id: 'd', nome: 'D', estrelas: 5 } };
    const getPlayer = (id) => jogadores[id];
    const roundsOficiais = () => DATA.rounds.filter((r) => !r.rascunho);
    const toTimestamp = (d) => new Date(d).getTime();
    const formatDate = (d) => d; const escapeHtml = (x) => String(x); const avatarHtml = () => '';
    const nomeComApelidoHtml = (p) => p.nome; const souCampeao = (r, i) => r.vencedores.includes(i);
    const HISTORICO_LIMITE = 20;
    ${pegar('function notaTotalDoTime(')}
    ${pegar('function formatarNotaTotal(')}
    ${pegar('function renderHistory(')}
    renderHistory();`);
  F(admin, elemento);
  // os rascunhos são desenhados dentro de #drafts-list, que o renderHistory cria dentro de #history-drafts
  return { lancadas: elemento('history-list').innerHTML, rascunhos: elemento('drafts-list').innerHTML };
}
const comoAdmin = telaDoHistorico(true);
assert.match(comoAdmin.lancadas, /3 vitória\(s\) de partida · <span class="history-nota"[^>]*>★ 7,5<\/span>/); // 4 + 3,5
assert.match(comoAdmin.lancadas, /★ 3<\/span>/);                                                                 // sem nota = 3
assert.match(comoAdmin.rascunhos, /★ 5<\/span>/);
const semSerAdmin = telaDoHistorico(false);
assert.doesNotMatch(semSerAdmin.lancadas + semSerAdmin.rascunhos, /history-nota|★/);
assert.match(semSerAdmin.lancadas, /3 vitória\(s\) de partida<\/div>/);
console.log('ok — só o admin vê a nota total dos times no histórico');
