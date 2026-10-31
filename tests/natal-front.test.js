// 🎄 Tema de Natal (v21.7), parte pura do app: período (1º/12 a 6/1, ?natal= força), ano da árvore e quem entra nela.
// Rodar: node tests/natal-front.test.js   (HTML_ARQUIVO=<outro .html> testa o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const arquivo = process.env.HTML_ARQUIVO ? path.resolve(process.env.HTML_ARQUIVO) : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(arquivo, 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <natal-puro>');
const fim = html.indexOf('// </natal-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <natal-puro> não encontrado');
const F = new Function(html.slice(ini, fim) + 'return { temaDoPeriodo, temFogos, anoDaArvore, numerosDoAno, jogadoresDaArvore, fileirasDaArvore };')();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('período: Natal de 1º a 25/12, Réveillon de 26/12 a 1/1, depois nada', () => {
  for (const d of ['2026-12-01', '2026-12-25']) assert.equal(F.temaDoPeriodo(d), 'natal', d);
  for (const d of ['2026-12-26', '2026-12-31', '2027-01-01']) assert.equal(F.temaDoPeriodo(d), 'reveillon', d);
  for (const d of ['2026-11-30', '2027-01-02', '2026-07-15', '', null, 'lixo']) assert.equal(F.temaDoPeriodo(d), '', String(d));
});
t('?natal= força: 1/natal, reveillon, fogos; 0 desliga; outro valor não interfere', () => {
  assert.equal(F.temaDoPeriodo('2026-07-15', '1'), 'natal');
  assert.equal(F.temaDoPeriodo('2026-07-15', 'natal'), 'natal');
  assert.equal(F.temaDoPeriodo('2026-07-15', 'reveillon'), 'reveillon');
  assert.equal(F.temaDoPeriodo('2026-07-15', 'fogos'), 'reveillon');
  assert.equal(F.temaDoPeriodo('2026-12-25', '0'), '');
  assert.equal(F.temaDoPeriodo('2026-12-25', 'x'), 'natal');
});
t('fogos: só 31/12 e 1/1 (ou ?natal=fogos); outro ?natal= tira os fogos', () => {
  assert.equal(F.temFogos('2026-12-31'), true);
  assert.equal(F.temFogos('2027-01-01'), true);
  assert.equal(F.temFogos('2026-12-30'), false);
  assert.equal(F.temFogos('2027-01-02'), false);
  assert.equal(F.temFogos('2026-07-15', 'fogos'), true);
  assert.equal(F.temFogos('2026-12-31', 'reveillon'), false);
});
t('números do ano: dias, jogadores, mais títulos e mais presente (empate = todos), sem convidado', () => {
  const rounds = [
    { data: '2026-03-03', times: [{ playerIds: ['a', 'b', 'convidado:Zé#1'] }, { playerIds: ['c'] }], vencedores: [0] },
    { data: '2026-03-03', times: [{ playerIds: ['a'] }, { playerIds: ['c', 'b'] }], vencedores: [1] },
    { data: '2026-03-10', times: [{ playerIds: ['a', 'd'] }, { playerIds: ['c'] }], vencedores: [0, 1] },
    { data: '2025-12-30', times: [{ playerIds: ['b'] }], vencedores: [0] },
  ];
  const n = F.numerosDoAno(rounds, 2026);
  assert.equal(n.dias, 2);
  assert.equal(n.jogadores, 4);
  assert.deepEqual(n.campeao, { ids: ['a', 'b', 'c'], total: 2 });
  assert.deepEqual(n.presente, { ids: ['a', 'c'], total: 3 });
  const vazio = F.numerosDoAno([], 2026);
  assert.deepEqual(vazio, { dias: 0, jogadores: 0, campeao: null, presente: null });
});
t('ano da árvore: em janeiro ainda é o ano que acabou', () => {
  assert.equal(F.anoDaArvore('2026-12-10'), 2026);
  assert.equal(F.anoDaArvore('2027-01-03'), 2026);
});
t('jogadores: só do ano, sem convidado, quem jogou mais primeiro, empate pelo id', () => {
  const rounds = [
    { data: '2026-03-03', times: [{ playerIds: ['b', 'a'] }, { playerIds: ['c', 'convidado:Zé#1'] }] },
    { data: '2026-03-10', times: [{ playerIds: ['c'] }, { playerIds: ['a'] }] },
    { data: '2025-12-30', times: [{ playerIds: ['d'] }] },
    { data: '2026-04-01' },
  ];
  assert.deepEqual(F.jogadoresDaArvore(rounds, 2026), [{ id: 'a', jogos: 2 }, { id: 'c', jogos: 2 }, { id: 'b', jogos: 1 }]);
  assert.deepEqual(F.jogadoresDaArvore(null, 2026), []);
});
t('fileiras: triângulo 1, 2, 3...; quem sobra alarga as de baixo; nunca afina descendo', () => {
  assert.deepEqual(F.fileirasDaArvore(0), []);
  assert.deepEqual(F.fileirasDaArvore(1), [1]);
  assert.deepEqual(F.fileirasDaArvore(6), [1, 2, 3]);
  assert.deepEqual(F.fileirasDaArvore(8), [1, 3, 4]);
  assert.deepEqual(F.fileirasDaArvore(16), [1, 2, 3, 4, 6]);
  for (let n = 1; n <= 120; n++) {
    const f = F.fileirasDaArvore(n);
    assert.equal(f.reduce((a, b) => a + b, 0), n, 'soma ' + n);
    for (let i = 1; i < f.length; i++) assert.ok(f[i] >= f[i - 1], 'afinou descendo em ' + n + ': ' + f);
  }
});

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\ntudo certo');
