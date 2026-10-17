// v19.3: quem levou 🚫 falta sai dos times nas contas (bloco <faltas-rodada>), sem mexer na rodada salva.
// Rodar: node tests/faltas-rodada.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <faltas-rodada>');
const fim = html.indexOf('// </faltas-rodada>');
assert.ok(ini > -1 && fim > ini, 'bloco <faltas-rodada> não encontrado');
const tirarFaltosos = new Function(html.slice(ini, fim) + '; return tirarFaltosos;')();

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };

const rod = (data, horario, a, b) => ({ id: data + horario, data, horario, times: [{ nome: 'A', playerIds: a }, { nome: 'B', playerIds: b }], vencedores: [0] });
const ck = (data, jogadorId, jogo, faltou) => ({ data, jogadorId, jogo, ...(faltou ? { faltou: true } : {}) });

caso('sem nenhuma falta: devolve o mesmo array (nada copiado)', () => {
  const rodadas = [rod('2026-10-13', '20:00', ['ana'], ['bia'])];
  assert.equal(tirarFaltosos(rodadas, [ck('2026-10-13', 'ana', 1, false)]), rodadas);
});

caso('faltou o único check-in da data: sai do time, vai pra "faltaram", e o original fica intacto', () => {
  const r = rod('2026-10-13', '20:00', ['ana', 'duda'], ['bia']);
  const [x] = tirarFaltosos([r], [ck('2026-10-13', 'duda', 1, true)]);
  assert.deepEqual(x.times[0].playerIds, ['ana']);
  assert.deepEqual(x.times[0].faltaram, ['duda']);
  assert.equal(x.times[1], r.times[1]);          // time sem faltoso: mesmo objeto
  assert.deepEqual(r.times[0].playerIds, ['ana', 'duda']); // rodada salva não muda
});

caso('falta de outra data não afeta', () => {
  const r = rod('2026-10-13', '20:00', ['ana', 'duda'], ['bia']);
  assert.equal(tirarFaltosos([r], [ck('2026-10-06', 'duda', 1, true)])[0], r);
});

caso('dia com dois jogos: faltou o 2º e foi no 1º -> sai só da rodada do 2º (por horário)', () => {
  const j2 = rod('2026-10-13', '21:00', ['duda'], ['bia']);
  const j1 = rod('2026-10-13', '19:00', ['duda'], ['ana']);
  const [y2, y1] = tirarFaltosos([j2, j1], [ck('2026-10-13', 'duda', 1, false), ck('2026-10-13', 'duda', 2, true)]);
  assert.equal(y1, j1);
  assert.deepEqual(y2.times[0].playerIds, []);
  assert.deepEqual(y2.times[0].faltaram, ['duda']);
});

caso('dia com dois jogos e faltou os dois: sai das duas rodadas', () => {
  const out = tirarFaltosos([rod('2026-10-13', '19:00', ['duda'], ['ana']), rod('2026-10-13', '21:00', ['duda'], ['bia'])],
    [ck('2026-10-13', 'duda', 1, true), ck('2026-10-13', 'duda', 2, true)]);
  out.forEach((r) => assert.deepEqual(r.times[0].faltaram, ['duda']));
});

caso('faltou um jogo, foi no outro, mas a data só tem uma rodada: fica (jogou a que teve rodada)', () => {
  const r = rod('2026-10-13', '20:00', ['duda'], ['ana']);
  assert.equal(tirarFaltosos([r], [ck('2026-10-13', 'duda', 1, true), ck('2026-10-13', 'duda', 2, false)])[0], r);
});

caso('check-in sem jogo conta como jogo 1; check-in sem jogador é ignorado', () => {
  const j1 = rod('2026-10-13', '19:00', ['duda'], ['ana']);
  const j2 = rod('2026-10-13', '21:00', ['duda'], ['bia']);
  const [y1, y2] = tirarFaltosos([j1, j2], [{ data: '2026-10-13', jogadorId: 'duda', faltou: true }, ck('2026-10-13', 'duda', 2, false), { data: '2026-10-13', faltou: true }]);
  assert.deepEqual(y1.times[0].faltaram, ['duda']);
  assert.equal(y2, j2);
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
