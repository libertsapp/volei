// 👻 Sumidos (aba Jogadores, organizador/admin) e 🎁 Retrospectiva (Meu Perfil), v18.7. Extrai o bloco <sumidos-retro>.
// Rodar: node tests/sumidos-retrospectiva.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <sumidos-retro>');
const fim = html.indexOf('// </sumidos-retro>');
assert.ok(ini > -1 && fim > ini, 'bloco <sumidos-retro> não encontrado');
const { computeSumidos, computeRetrospectiva } = new Function(html.slice(ini, fim) + '; return { computeSumidos, computeRetrospectiva };')();

// 8 terças seguidas de 2026
const D = ['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25', '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'];
// rodada com 2 times: [idsTimeA, idsTimeB], vencedor = índice do campeão
const rodada = (data, a, b, vencedor = 0, vit = [3, 1]) => ({ data, times: [{ playerIds: a, vitorias: vit[0] }, { playerIds: b, vitorias: vit[1] }], vencedores: [vencedor] });
const J = (...ids) => ids.map((id) => ({ id }));
let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };

// ---------------------------------------------------------------- sumidos
caso('sumido: jogou 5 datas e faltou as 3 últimas', () => {
  const rods = D.map((d, i) => rodada(d, i < 5 ? ['ana', 'x'] : ['x'], ['y']));
  const r = computeSumidos(rods, J('ana', 'x', 'y'), '2026-09-29');
  assert.deepEqual(r.map((s) => s.id), ['ana']);
  assert.equal(r[0].faltas, 3);
  assert.equal(r[0].ultima, '2026-09-01');
  assert.equal(r[0].dias, 28);
  assert.equal(r[0].jogosNaJanela, 5); // as 5 datas do grupo até a última vez dela: jogou todas
  assert.equal(r[0].janela, 5);
});

caso('faltou só 2: ainda não é sumido', () => {
  const rods = D.map((d, i) => rodada(d, i < 6 ? ['ana'] : ['x'], ['y']));
  assert.deepEqual(computeSumidos(rods, J('ana'), '2026-09-29'), []);
});

caso('jogou menos de 4 datas (convidado esporádico): não entra', () => {
  const rods = D.map((d, i) => rodada(d, i < 3 ? ['ana'] : ['x'], ['y']));
  assert.deepEqual(computeSumidos(rods, J('ana'), '2026-09-29'), []);
});

caso('mais de 6 meses fora: não entra (já é o 🪦)', () => {
  const rods = D.map((d, i) => rodada(d, i < 5 ? ['ana'] : ['x'], ['y']));
  assert.deepEqual(computeSumidos(rods, J('ana'), '2027-04-01'), []);
});

caso('rodada dupla (2 rodadas na mesma data) conta UMA falta', () => {
  const rods = D.map((d, i) => rodada(d, i < 5 ? ['ana'] : ['x'], ['y']));
  rods.push(rodada(D[7], ['x'], ['y'])); // 2ª rodada no último dia
  const r = computeSumidos(rods, J('ana'), '2026-09-29');
  assert.equal(r[0].faltas, 3);
});

caso('só jogadores ativos entram; quem jogava mais vem primeiro', () => {
  // bia jogou 4 das 5 primeiras; ana jogou as 5; removido também sumiu mas não está na lista de ativos
  const rods = D.map((d, i) => rodada(d, i < 5 ? ['ana', 'removido', ...(i === 2 ? [] : ['bia'])] : ['x'], ['y']));
  const r = computeSumidos(rods, J('bia', 'ana', 'x', 'y'), '2026-09-29');
  assert.deepEqual(r.map((s) => s.id), ['ana', 'bia']);
});

caso('sem nenhuma rodada: lista vazia, não quebra', () => {
  assert.deepEqual(computeSumidos([], J('ana'), '2026-09-29'), []);
});

// ---------------------------------------------------------------- retrospectiva
const rodsRetro = [
  rodada('2026-03-03', ['ana', 'bia'], ['caio', 'duda'], 0, [3, 1]),
  rodada('2026-03-10', ['ana', 'bia'], ['caio', 'duda'], 0, [2, 1]),
  rodada('2026-03-17', ['ana', 'caio'], ['bia', 'duda'], 1, [1, 3]),
  rodada('2026-03-24', ['caio', 'duda'], ['bia', 'eva'], 0, [3, 0]), // ana faltou
  rodada('2026-04-07', ['ana', 'bia'], ['caio', 'duda'], 0, [3, 2]),
  rodada('2026-04-07', ['ana', 'duda'], ['bia', 'caio'], 1, [0, 3]), // rodada dupla no mesmo dia
  rodada('2025-12-02', ['ana', 'bia'], ['caio', 'duda'], 0, [3, 0]) // outro ano: fora
];

caso('retrospectiva: totais do ano, sem o ano anterior', () => {
  const r = computeRetrospectiva(rodsRetro, J('ana', 'bia', 'caio', 'duda', 'eva'), 'ana', 2026);
  assert.equal(r.ano, '2026');
  assert.equal(r.jogos, 5);
  assert.equal(r.titulos, 3); // 03/03, 10/03, 1ª de 07/04
  assert.equal(r.pct, 60);
  assert.equal(r.vitorias, 3 + 2 + 1 + 3 + 0);
});

caso('retrospectiva: presença e sequência contam DATAS (rodada dupla = 1 dia)', () => {
  const r = computeRetrospectiva(rodsRetro, J('ana', 'bia', 'caio', 'duda', 'eva'), 'ana', 2026);
  assert.equal(r.datasDoGrupo, 5);
  assert.equal(r.datas, 4);
  assert.equal(r.presencaPct, 80);
  assert.equal(r.maiorSequencia, 3); // 03, 10, 17/03 — faltou 24/03
  assert.equal(r.primeira, '2026-03-03');
  assert.equal(r.ultima, '2026-04-07');
});

caso('retrospectiva: parceiro frequente, dupla de ouro (mín. 3 juntos) e mês mais animado', () => {
  const r = computeRetrospectiva(rodsRetro, J('ana', 'bia', 'caio', 'duda', 'eva'), 'ana', 2026);
  assert.deepEqual(r.parceiroFrequente, { id: 'bia', juntos: 3, titulos: 3, pct: 100 });
  assert.equal(r.duplaDeOuro.id, 'bia');
  assert.deepEqual(r.mesMaisAtivo, { mes: 2, rodadas: 3 }); // março
});

caso('retrospectiva: posição no ranking do ano, com a mesma ordem do app', () => {
  const todos = J('ana', 'bia', 'caio', 'duda', 'eva');
  const pos = todos.map((p) => [p.id, computeRetrospectiva(rodsRetro, todos, p.id, 2026).posicao]);
  const ordem = pos.slice().sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  assert.equal(new Set(pos.map((x) => x[1])).size, 5); // posições únicas 1..5
  assert.equal(computeRetrospectiva(rodsRetro, todos, 'ana', 2026).noRanking, 5);
  assert.equal(ordem[0], 'bia'); // bia: 4 títulos (03, 10, 17/03 e 1ª de 07/04)
});

caso('retrospectiva: jogador removido não entra no ranking nem como parceiro', () => {
  const r = computeRetrospectiva(rodsRetro, J('ana', 'caio', 'duda', 'eva'), 'ana', 2026); // bia "removida"
  assert.equal(r.noRanking, 4);
  assert.notEqual(r.parceiroFrequente.id, 'bia');
});

caso('retrospectiva: quem não jogou no ano recebe null (o botão nem aparece)', () => {
  assert.equal(computeRetrospectiva(rodsRetro, J('ana', 'eva'), 'eva', 2025), null);
  assert.equal(computeRetrospectiva([], J('ana'), 'ana', 2026), null);
});

caso('retrospectiva: dupla de ouro exige título junto (3 jogos e 0 títulos não é "de ouro")', () => {
  const rods = [1, 2, 3].map((i) => rodada('2026-05-0' + i, ['ana', 'zé'], ['x', 'y'], 1));
  const r = computeRetrospectiva(rods, J('ana', 'zé', 'x', 'y'), 'ana', 2026);
  assert.equal(r.duplaDeOuro, null);
  assert.equal(r.parceiroFrequente.id, 'zé');
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
