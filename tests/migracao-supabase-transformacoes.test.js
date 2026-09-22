// tests/migracao-supabase-transformacoes.test.js
const assert = require('node:assert/strict');
const {
  paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO
} = require('../scripts/lib/transformacoes');

let falhas = 0;
function t(nome, fn) {
  try { fn(); console.log('ok    -', nome); }
  catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

t('paraBooleano: texto TRUE/FALSE do Sheets vira boolean', () => {
  assert.equal(paraBooleano('TRUE'), true);
  assert.equal(paraBooleano('FALSE'), false);
  assert.equal(paraBooleano('true'), true);
  assert.equal(paraBooleano(''), false);
  assert.equal(paraBooleano(true), true);
});

t('dividirJogadores: célula "j0,j1,j2" vira array de ids', () => {
  assert.deepEqual(dividirJogadores('j0,j1,j2'), ['j0', 'j1', 'j2']);
  assert.deepEqual(dividirJogadores('j0, j1 , j2'), ['j0', 'j1', 'j2']);
  assert.deepEqual(dividirJogadores(''), []);
  assert.deepEqual(dividirJogadores(null), []);
});

t('paraJsonb: JSON serializado vira objeto; texto solto vira {texto}', () => {
  assert.deepEqual(paraJsonb('{"data":"2026-09-18","valor":13.6}'), { data: '2026-09-18', valor: 13.6 });
  assert.deepEqual(paraJsonb('mensagem qualquer'), { texto: 'mensagem qualquer' });
  assert.equal(paraJsonb(''), null);
  assert.equal(paraJsonb(null), null);
});

t('paraDataISO: aceita ISO e dd/mm/aaaa, sempre devolve yyyy-mm-dd', () => {
  assert.equal(paraDataISO('2026-09-18'), '2026-09-18');
  assert.equal(paraDataISO('18/09/2026'), '2026-09-18');
  assert.throws(() => paraDataISO('lixo'), /formato inesperado/);
});

t('paraTimestampISO: aceita string parseável pelo Date, devolve ISO completo', () => {
  assert.equal(paraTimestampISO('2026-09-18T18:00:00.000Z'), '2026-09-18T18:00:00.000Z');
  assert.equal(paraTimestampISO(''), null);
  assert.equal(paraTimestampISO(null), null);
  assert.throws(() => paraTimestampISO('lixo'), /formato inesperado/);
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
