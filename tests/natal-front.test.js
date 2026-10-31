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
const F = new Function(html.slice(ini, fim) + 'return { periodoNatal, anoDaArvore, jogadoresDaArvore, fileirasDaArvore };')();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('período: de 1º/12 a 6/1, nas bordas inclusive', () => {
  for (const d of ['2026-12-01', '2026-12-25', '2026-12-31', '2027-01-01', '2027-01-06']) assert.equal(F.periodoNatal(d), true, d);
  for (const d of ['2026-11-30', '2027-01-07', '2026-07-15', '', null, 'lixo']) assert.equal(F.periodoNatal(d), false, String(d));
});
t('?natal=1 liga fora da época; ?natal=0 desliga no Natal; outro valor não interfere', () => {
  assert.equal(F.periodoNatal('2026-07-15', '1'), true);
  assert.equal(F.periodoNatal('2026-12-25', '0'), false);
  assert.equal(F.periodoNatal('2026-12-25', 'x'), true);
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
