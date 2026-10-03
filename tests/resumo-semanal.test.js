// "Resumo da semana" (texto pro WhatsApp): título "Atuais Paneleiros do Volei", carregadores de mochila e o time mais
// forte da última rodada (maior soma de estrelas — mesma soma do Histórico). A soma só aparece no texto se as estrelas
// estiverem visíveis ao público (o resumo vai pro grupo). Roda o montarResumoSemanal de verdade, extraído do HTML.
// Rodar: node tests/resumo-semanal.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const pegar = (inicio) => {
  const i = html.indexOf(inicio);
  assert.ok(i > -1, 'não encontrei: ' + inicio);
  return html.slice(i, html.indexOf('\n}\n', i) + 3);
};

const jogadores = {
  a: { id: 'a', nome: 'Ana', estrelas: 5 }, b: { id: 'b', nome: 'Beto', estrelas: 4 }, c: { id: 'c', nome: 'Caio', estrelas: 3 },
  d: { id: 'd', nome: 'Duda', estrelas: 3 }, e: { id: 'e', nome: 'Eva', estrelas: 2 }, f: { id: 'f', nome: 'Fred', estrelas: 0 }
};
function resumo({ times, estrelasVisiveis = true, paneleiro = ['a'], mochila = ['b', 'c'], rodadas } = {}) {
  const F = new Function('ctx', `
    const { jogadores } = ctx;
    const DATA = { rounds: ctx.rodadas || [{ id: 'r1', data: '2026-09-29', rascunho: false, vencedores: [0], times: ctx.times }] };
    const CHECKINS = []; const SETTINGS = { estrelasVisiveis: ctx.estrelasVisiveis };
    const getPlayer = (id) => jogadores[id];
    const roundsOficiais = () => DATA.rounds.filter((r) => !r.rascunho);
    const toTimestamp = (d) => new Date(d).getTime();
    const formatDate = (d) => d;
    const computeBadges = () => ({ top1: new Set(), grudento: new Set(), paneleiro: new Set(ctx.paneleiro), mochila: new Set(ctx.mochila), rip: new Set(), aposentado: new Set() });
    const computeRanking = () => [];
    ${pegar('function notaTotalDoTime(')}
    ${pegar('function formatarNotaTotal(')}
    ${pegar('function timesMaisFortes(')}
    ${pegar('function montarResumoSemanal(')}
    return montarResumoSemanal();`);
  return F({ jogadores, times, estrelasVisiveis, paneleiro, mochila, rodadas });
}

const doisTimes = [{ nome: 'Azul', vitorias: 3, playerIds: ['a', 'c', 'f'] }, { nome: 'Verde', vitorias: 1, playerIds: ['b', 'd', 'e'] }];
// Azul = 5 + 3 + 3 (sem nota) = 11; Verde = 4 + 3 + 2 = 9
let t = resumo({ times: doisTimes });
assert.match(t, /🍳 \*Atuais Paneleiros do Volei\*\nAna\n/);
assert.doesNotMatch(t, /Paneleiros da vez/);
assert.match(t, /🎒 \*Carregadores de mochila\*\nBeto, Caio\n/);
assert.match(t, /💪 \*Time mais forte da semana\* — Azul \(★ 11\)\nAna, Caio, Fred\n/);
assert.ok(t.indexOf('🏆') < t.indexOf('💪'), 'o time mais forte vem logo depois do campeão da mesma rodada');

// estrelas escondidas do público: o time aparece, a soma não
t = resumo({ times: doisTimes, estrelasVisiveis: false });
assert.match(t, /💪 \*Time mais forte da semana\* — Azul\nAna, Caio, Fred\n/);
assert.doesNotMatch(t, /★/);

// empate na soma: os dois aparecem
t = resumo({ times: [{ nome: 'Azul', playerIds: ['a', 'e'] }, { nome: 'Verde', playerIds: ['b', 'c'] }] }); // 7 x 7
assert.match(t, /💪 \*Times mais fortes da semana \(empate\)\* — Azul e Verde \(★ 7\)\nAna, Eva\n× Beto, Caio\n/);

// sem carregadores de mochila: a seção não aparece; sem rodada: sem time mais forte
t = resumo({ times: doisTimes, mochila: [] });
assert.doesNotMatch(t, /Carregadores de mochila/);
t = resumo({ rodadas: [] });
assert.doesNotMatch(t, /Time mais forte|Times mais fortes/);
console.log('ok — resumo da semana (paneleiros, mochila e time mais forte)');
