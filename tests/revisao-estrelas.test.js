// Testes do cálculo puro da "Revisão de estrelas" (jogador com nota baixa mas desempenho recente
// de time forte). Extrai o bloco <estrelas-revisao-pura> direto do HTML, então testa exatamente
// o código que vai pro ar. Rodar: node tests/revisao-estrelas.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <estrelas-revisao-pura>');
const fim = html.indexOf('// </estrelas-revisao-pura>');
assert.ok(ini > -1 && fim > ini, 'bloco <estrelas-revisao-pura> não encontrado no volei-dashboard.html');
const F = new Function(html.slice(ini, fim) + `
  return { vitPartidaRecente, computeRevisaoEstrelas };
`)();

let falhas = 0;
function t(nome, fn){
  try { fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

// rounds: mais recente primeiro, como computePlayerAllTimeStats devolve. w = vitórias naquela rodada.
const rounds = (ws) => ws.map(w => ({ vitorias: w }));
const jogador = (id, estrelas, jogos, ws) => ({ id, nome: id, estrelas, jogos, rounds: rounds(ws) });

t('jogador com menos que o mínimo de partidas não aparece mesmo com desempenho alto', () => {
  const jogadores = [
    jogador('ref1', 5, 12, Array(12).fill(5)),
    jogador('candidato', 3, 8, Array(8).fill(5)), // só 8 partidas, mínimo é 10
  ];
  const lista = F.computeRevisaoEstrelas(jogadores, { minPartidas: 10, janela: 12 });
  assert.equal(lista.length, 0);
});

t('jogador 3 estrelas empatado com a média dos 4-5 estrelas aparece na lista', () => {
  const jogadores = [
    jogador('ref1', 5, 12, Array(12).fill(4)),
    jogador('ref2', 4, 12, Array(12).fill(4)),
    jogador('candidato', 3, 12, Array(12).fill(4)),
  ];
  const lista = F.computeRevisaoEstrelas(jogadores, { minPartidas: 10, janela: 12 });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, 'candidato');
});

t('jogador 5 estrelas nunca aparece como candidato, mesmo com Vit./partida altíssima', () => {
  const jogadores = [
    jogador('ref1', 5, 12, Array(12).fill(1)),
    jogador('estrela-alta', 5, 12, Array(12).fill(9)),
  ];
  const lista = F.computeRevisaoEstrelas(jogadores, { minPartidas: 10, janela: 12 });
  assert.equal(lista.find(j => j.id === 'estrela-alta'), undefined);
});

t('caso relatado: 3 estrelas com desempenho de 5 estrelas aparece primeiro na lista', () => {
  const jogadores = [
    jogador('ref1', 5, 12, Array(12).fill(3)),
    jogador('ref2', 4, 12, Array(12).fill(3)),
    jogador('discrepante', 3, 12, Array(12).fill(6)), // bem acima da média de referência
    jogador('empatado', 3, 12, Array(12).fill(3)), // só empatado, diferença menor
    jogador('abaixo', 3, 12, Array(12).fill(1)), // abaixo da média, não deve aparecer
  ];
  const lista = F.computeRevisaoEstrelas(jogadores, { minPartidas: 10, janela: 12 });
  assert.deepEqual(lista.map(j => j.id), ['discrepante', 'empatado']);
});

t('sem jogadores de referência (4-5 estrelas com partidas suficientes), lista fica vazia', () => {
  const jogadores = [
    jogador('ref-sem-amostra', 5, 3, Array(3).fill(9)), // só 3 partidas, não vira referência
    jogador('candidato', 3, 12, Array(12).fill(5)),
  ];
  const lista = F.computeRevisaoEstrelas(jogadores, { minPartidas: 10, janela: 12 });
  assert.equal(lista.length, 0);
});

t('só considera as últimas "janela" rodadas, ignorando o histórico antigo', () => {
  // referência: 12 rodadas recentes com vitorias=3 (rounds antigas não entram, janela=12 e tem mais)
  const refRounds = Array(12).fill(3).concat(Array(20).fill(1)); // recentes primeiro
  const jogadores = [
    { id: 'ref1', nome: 'ref1', estrelas: 5, jogos: 32, rounds: rounds(refRounds) },
    // candidato tem histórico antigo ruim (vitorias=1) mas as 12 rodadas recentes são fortes (vitorias=3)
    { id: 'candidato', nome: 'candidato', estrelas: 3, jogos: 32, rounds: rounds(Array(12).fill(3).concat(Array(20).fill(1))) },
  ];
  const lista = F.computeRevisaoEstrelas(jogadores, { minPartidas: 10, janela: 12 });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, 'candidato');
});

console.log(falhas === 0 ? `\nTodos os testes passaram.` : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
