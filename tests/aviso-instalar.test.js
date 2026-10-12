// Aviso "instale o app / o endereço mudou" (v17.1). Extrai o bloco <aviso-instalar-puro> direto do HTML.
// Rodar: node tests/aviso-instalar.test.js   (HTML_ARQUIVO=<caminho> testa outra página)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <aviso-instalar-puro>');
const fim = html.indexOf('// </aviso-instalar-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <aviso-instalar-puro> não encontrado');
const A = new Function(html.slice(ini, fim) + 'return { avisoInstalarTexto, mostrarAvisoInstalar, comoInstalar };')();

let falhas = 0;
function t(nome, fn){
  try { fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

t('no endereço oficial (memberstars.com) o texto fala da mudança de endereço e de reinstalar', () => {
  for (const host of ['memberstars.com', 'www.memberstars.com']) {
    const txt = A.avisoInstalarTexto(host);
    assert.match(txt, /endereço do app mudou/i, host);
    assert.match(txt, /instale de novo/i, host);
  }
});

t('em outro endereço (Vercel, localhost) continua o convite de sempre, sem falar de mudança', () => {
  for (const host of ['voleiterca.vercel.app', 'localhost']) {
    const txt = A.avisoInstalarTexto(host);
    assert.doesNotMatch(txt, /mudou/i, host);
    assert.match(txt, /Instale o app/, host);
  }
});

t('aparece pra quem não tem o app instalado NESTE endereço, mesmo sem o navegador oferecer o botão de instalar', () => {
  assert.equal(A.mostrarAvisoInstalar({ instalado: false, fechado: false }), true);
  assert.equal(A.mostrarAvisoInstalar({ instalado: true, fechado: false }), false);
  assert.equal(A.mostrarAvisoInstalar({ instalado: false, fechado: true }), false);
});

t('como instalar: prompt do navegador > passo a passo do iPhone > passo a passo manual (Android sem prompt)', () => {
  assert.equal(A.comoInstalar({ temPrompt: true, ios: false }), 'prompt');
  assert.equal(A.comoInstalar({ temPrompt: false, ios: true }), 'ios');
  assert.equal(A.comoInstalar({ temPrompt: false, ios: false }), 'manual');
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
