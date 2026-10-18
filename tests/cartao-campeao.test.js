// v19.9: 📸 Cartão do campeão (bloco <cartao-puro>): grade das fotos e nome que aparece embaixo de cada uma.
// Rodar: node tests/cartao-campeao.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <cartao-puro>');
const fim = html.indexOf('// </cartao-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <cartao-puro> não encontrado');
const { gradeDeFotos, nomeNoCartao } = new Function(html.slice(ini, fim) + '; return { gradeDeFotos, nomeNoCartao };')();

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };

caso('a grade sempre cabe na largura (1080 − margens) e na área das fotos (630 px de altura)', () => {
  for (let n = 1; n <= 18; n++) {
    const { porLinha, raio } = gradeDeFotos(n);
    const linhas = Math.ceil(n / porLinha);
    const passo = Math.min(260, (1080 - 160) / porLinha);
    assert.ok(raio * 2 + 10 <= passo, `n=${n}: foto (${raio * 2}) mais larga que a coluna (${passo})`);
    assert.ok(linhas * (raio * 2 + 78) <= 630 + 1, `n=${n}: ${linhas} linhas não cabem`);
  }
});

caso('time pequeno: uma linha só, fotos grandes; time de 4 a 6: 3 por linha', () => {
  assert.deepEqual(gradeDeFotos(2), { porLinha: 2, raio: 125 });
  assert.equal(gradeDeFotos(4).porLinha, 3);
  assert.equal(gradeDeFotos(7).porLinha, 4);
});

caso('nome: apelido inteiro; sem apelido, o 1º nome; convidado perde o "(Convidado(a))"', () => {
  assert.equal(nomeNoCartao({ nome: 'Henrique Souza', apelido: 'RIQUE TOP' }), 'RIQUE TOP');
  assert.equal(nomeNoCartao({ nome: 'Ana Paula Lima' }), 'Ana');
  assert.equal(nomeNoCartao({ nome: 'Kaio Silva (Convidado(a))' }), 'Kaio');
  assert.equal(nomeNoCartao(null), '?');
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
