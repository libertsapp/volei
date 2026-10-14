// Logo do grupo (v18.3), parte pura do app: só endereço https "limpo" vira background-image do logo (o valor vem do
// banco e entra num url("...") do CSS — aspas, parênteses ou espaço quebrariam o estilo ou injetariam CSS).
// Rodar: node tests/logo-front.test.js   (HTML_ARQUIVO=<outro .html> testa o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const arquivo = process.env.HTML_ARQUIVO ? path.resolve(process.env.HTML_ARQUIVO) : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(arquivo, 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <logo-puro>');
const fim = html.indexOf('// </logo-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <logo-puro> não encontrado');
const L = new Function(html.slice(ini, fim) + 'return { logoValido };')();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('endereço do armazenamento do Supabase: aceito', () => {
  assert.equal(L.logoValido('https://lzwmirrjpoqucwlhgkku.supabase.co/storage/v1/object/public/fotos/logo-1791854065270-9d1150a9.jpg'), true);
  assert.equal(L.logoValido('https://exemplo.test/fotos/logo-1-abcdef12.jpg?id=logo-1-abcdef12.jpg'), true);
});
t('vazio, nulo e não-texto: recusado (app mostra o padrão)', () => {
  for (const v of ['', null, undefined, 42, {}]) assert.equal(L.logoValido(v), false, JSON.stringify(v));
});
t('http, javascript: e data: recusados', () => {
  assert.equal(L.logoValido('http://exemplo.test/a.jpg'), false);
  assert.equal(L.logoValido('javascript:alert(1)'), false);
  assert.equal(L.logoValido('data:image/svg+xml,<svg/>'), false);
});
t('aspas, parênteses, espaço e barra invertida (fugiriam do url("...")): recusados', () => {
  for (const v of ['https://x.test/a".jpg', "https://x.test/a'.jpg", 'https://x.test/a).jpg', 'https://x.test/a (1).jpg', 'https://x.test/a\\b.jpg', 'https://x.test/a\n.jpg']) {
    assert.equal(L.logoValido(v), false, v);
  }
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
