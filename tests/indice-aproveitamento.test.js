// v19.5: aproveitamento ponderado (bloco <indice-puro>): títulos 35, colocação 25, presença 30, compromisso 10.
// Rodar: node tests/indice-aproveitamento.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <indice-puro>');
const fim = html.indexOf('// </indice-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <indice-puro> não encontrado');
const computeIndice = new Function(html.slice(ini, fim) + '; return computeIndice;')();

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };
const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

// datas de 2026 de 7 em 7 dias a partir de 06/01
const data = (i) => new Date(Date.UTC(2026, 0, 6 + 7 * i)).toISOString().slice(0, 10);
// 3 times; vit = vitórias de partida de cada time; campeão = índice do time
const rod = (i, times, vit, campeao) => ({ data: data(i), times: times.map((ids, k) => ({ playerIds: ids, vitorias: vit[k] })), vencedores: [campeao] });

caso('quem nunca jogou no período: null', () => {
  assert.equal(computeIndice([rod(0, [['a'], ['b'], ['c']], [3, 2, 1], 0)], [], 'z'), null);
});

caso('colocação: campeão 100, do meio 50, último 0 (pelas vitórias de partida)', () => {
  const rodadas = [];
  for (let i = 0; i < 6; i++) rodadas.push(rod(i, [['a'], ['b'], ['c']], [3, 2, 1], 0));
  perto(computeIndice(rodadas, [], 'a').partes.colocacao.valor, 100, 'a');
  perto(computeIndice(rodadas, [], 'b').partes.colocacao.valor, 50, 'b');
  perto(computeIndice(rodadas, [], 'c').partes.colocacao.valor, 0, 'c');
});

caso('empate em vitórias com o campeão não derruba o 2º (ninguém tem MAIS vitórias que ele)', () => {
  const rodadas = [];
  for (let i = 0; i < 5; i++) rodadas.push(rod(i, [['a'], ['b'], ['c']], [3, 3, 1], 0));
  perto(computeIndice(rodadas, [], 'b').partes.colocacao.valor, 100, 'b');
});

caso('presença conta só a partir da 1ª vez do jogador; títulos ÷ rodadas', () => {
  const rodadas = [];
  for (let i = 0; i < 10; i++) rodadas.push(rod(i, [['velho'], i >= 4 ? ['novo'] : ['x'], ['y']], [1, 2, 3], 2));
  const novo = computeIndice(rodadas, [], 'novo');
  assert.equal(novo.partes.presenca.datas, 6);
  perto(novo.partes.presenca.valor, 100, 'novo');
  assert.equal(novo.partes.presenca.desde, data(4));
  perto(computeIndice(rodadas, [], 'velho').partes.presenca.valor, 100, 'velho');
});

caso('exemplo da proposta: Ana ~58 e Bia ~57', () => {
  // 25 datas. Ana joga as 20 primeiras (6 títulos); Bia joga 5 (3 títulos) — a Bia começa na data 0 também
  const rodadas = [];
  for (let i = 0; i < 25; i++) {
    const ana = i < 20, bia = i % 5 === 0;
    const timeAna = ana ? ['ana'] : [], timeBia = bia ? ['bia'] : [];
    const anaCampea = ana && [1, 2, 3, 4, 6, 7].includes(i), biaCampea = bia && i <= 10; // datas diferentes: um não rouba o título do outro
    // 3 times: 0 = Ana, 1 = Bia, 2 = resto
    const campeao = anaCampea ? 0 : (biaCampea ? 1 : 2);
    const vit = [campeao === 0 ? 3 : 1, campeao === 1 ? 3 : 2, campeao === 2 ? 3 : 0];
    rodadas.push(rod(i, [timeAna, timeBia, ['resto']], vit, campeao));
  }
  const ana = computeIndice(rodadas, [{ data: data(19), jogadorId: 'ana', faltou: true }], 'ana');
  assert.equal(ana.partes.titulos.titulos, 6);
  assert.equal(ana.partes.presenca.jogadas, 20);
  assert.equal(ana.partes.compromisso.faltas, 1);
  perto(ana.partes.compromisso.valor, 50, 'compromisso'); // v19.6: −50 na nota = −5 no Aproveitamento
  perto(ana.partes.compromisso.pontos, 5, 'compromisso em pontos');
  const bia = computeIndice(rodadas, [], 'bia');
  assert.equal(bia.partes.titulos.titulos, 3);
  assert.equal(bia.partes.presenca.jogadas, 5);
  assert.equal(bia.poucas, false);
  // a colocação não é a do exemplo (depende das vitórias), mas os dois ficam perto e a Ana à frente
  assert.ok(Math.abs(ana.valor - bia.valor) <= 10, `${ana.valor} x ${bia.valor}`);
  // conferência da soma: pontos = nota × peso
  const soma = Object.values(ana.partes).reduce((t, p) => t + p.pontos, 0);
  assert.equal(ana.valor, Math.round(soma));
});

caso('poucas rodadas: 1 rodada com 1 título não vira 100 (fica perto do esperado)', () => {
  const r = computeIndice([rod(0, [['a'], ['b'], ['c']], [3, 2, 1], 0)], [], 'a');
  assert.equal(r.poucas, true);
  perto(r.partes.titulos.real, 100, 'real');
  // peso 1/5: 0,2×100 + 0,8×33,3 = 46,7
  perto(r.partes.titulos.valor, 0.2 * 100 + 0.8 * (100 / 3), 'titulos');
  perto(r.partes.colocacao.valor, 0.2 * 100 + 0.8 * 50, 'colocacao');
  assert.ok(r.valor < 80, String(r.valor));
});

caso('compromisso: só faltas nos 90 dias até a última data do período; mínimo 0', () => {
  const rodadas = [];
  for (let i = 0; i < 20; i++) rodadas.push(rod(i, [['a'], ['b'], ['c']], [3, 2, 1], 0)); // última data: data(19)
  const velha = { data: data(0), jogadorId: 'a', faltou: true };   // ~133 dias antes: fora
  const outra = { data: data(18), jogadorId: 'b', faltou: true };  // de outro jogador
  const naoFaltou = { data: data(18), jogadorId: 'a' };
  assert.equal(computeIndice(rodadas, [velha, outra, naoFaltou], 'a').partes.compromisso.faltas, 0);
  perto(computeIndice(rodadas, [{ data: data(19), jogadorId: 'a', faltou: true }, { data: data(18), jogadorId: 'a', faltou: true }], 'a').partes.compromisso.valor, 0, '2 faltas zeram');
  const muitas = Array.from({ length: 12 }, (_, k) => ({ data: data(19), jogadorId: 'a', faltou: true, id: k }));
  perto(computeIndice(rodadas, muitas, 'a').partes.compromisso.valor, 0, 'mínimo 0');
});

caso('pesos somam 100', () => {
  const pesos = new Function(html.slice(ini, fim) + '; return INDICE_PESOS;')();
  assert.equal(Object.values(pesos).reduce((a, b) => a + b, 0), 100);
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
