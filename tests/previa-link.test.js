// v19.9: prévia do link (og:*). O Terça (GitHub Pages) sai com a dele; o build do Vercel (grupos) troca pela genérica.
// Rodar: node tests/previa-link.test.js   (HTML_ARQUIVO=<caminho> confere outra página, ex. o Meme — só a 1ª parte)
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const raiz = path.join(__dirname, '..');
const arquivo = process.env.HTML_ARQUIVO || path.join(raiz, 'volei-dashboard.html');
const html = fs.readFileSync(arquivo, 'utf8');
const meta = (h, prop) => { const m = h.match(new RegExp('<meta (?:property|name)="' + prop.replace(/[.:]/g, '\\$&') + '" content="([^"]*)"')); return m && m[1]; };

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };

caso('a página tem título, descrição e imagem absoluta (1200×630) dentro do bloco og:inicio/og:fim', () => {
  const ini = html.indexOf('<!-- og:inicio'), fim = html.indexOf('<!-- og:fim -->');
  assert.ok(ini > -1 && fim > ini, 'bloco og não encontrado');
  assert.ok(ini < html.indexOf('</head>'), 'o bloco precisa estar no <head>');
  const bloco = html.slice(ini, fim);
  for (const p of ['og:title', 'og:description', 'og:image', 'description']) assert.ok(meta(bloco, p), p + ' vazio');
  assert.match(meta(bloco, 'og:image'), /^https:\/\/[^ ]+\.jpg$/);
  assert.equal(meta(bloco, 'og:image:width'), '1200');
  assert.equal(meta(bloco, 'og:image:height'), '630');
  assert.equal(meta(bloco, 'twitter:card'), 'summary_large_image');
});

if (!process.env.HTML_ARQUIVO) {
  caso('Terça: a imagem apontada existe no repositório e é leve (WhatsApp ignora prévia pesada)', () => {
    const nome = meta(html, 'og:image').split('/').pop();
    const st = fs.statSync(path.join(raiz, nome));
    assert.ok(st.size < 250 * 1024, nome + ' tem ' + st.size + ' bytes');
  });

  caso('build do Vercel: a prévia vira a dos grupos (sem "Terça") e a imagem é copiada', () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
    fs.copyFileSync(path.join(raiz, 'volei-dashboard.html'), path.join(pasta, 'index.html'));
    execFileSync(process.execPath, [path.join(raiz, 'scripts', 'og-grupos.js'), pasta]);
    const saida = fs.readFileSync(path.join(pasta, 'index.html'), 'utf8');
    const bloco = saida.slice(saida.indexOf('<!-- og:inicio'), saida.indexOf('<!-- og:fim -->'));
    assert.doesNotMatch(bloco, /Ter[cç]a/);
    assert.equal(meta(bloco, 'og:image'), 'https://volei.memberstars.com/og-grupos.jpg');
    assert.ok(fs.statSync(path.join(pasta, 'og-grupos.jpg')).size < 250 * 1024);
    // o resto da página é o mesmo app
    assert.equal(saida.replace(/<!-- og:inicio[\s\S]*?<!-- og:fim -->/, ''), html.replace(/<!-- og:inicio[\s\S]*?<!-- og:fim -->/, ''));
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  caso('og-grupos.js recusa uma página sem o bloco (melhor quebrar o build do que publicar errado)', () => {
    const { trocarPrevia } = require(path.join(raiz, 'scripts', 'og-grupos.js'));
    assert.throws(() => trocarPrevia('<html><head></head></html>'), /não encontrado/);
  });
}

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
