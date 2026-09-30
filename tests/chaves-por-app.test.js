// O Terça (libertsapp.github.io/volei/) e o Meme (libertsapp.github.io/voleimeme) moram no MESMO endereço, então dividem
// o localStorage do navegador. Se os dois gravarem o login (ou a cópia dos dados) na mesma chave, um app lê e apaga o do
// outro — com a sessão do app (v14), que só vale no servidor que a criou, quem usa os dois seria deslogado toda vez que
// trocasse de app, e o Meme sem internet poderia mostrar os dados do Terça. Este teste RODA o código de cada página
// (não procura texto) e confere em que chave cada uma grava. Rodar: node tests/chaves-por-app.test.js
// (MEME_HTML=<caminho> aponta outro arquivo do Meme; sem o arquivo do Meme, o teste é pulado)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const caminhoTerca = path.join(__dirname, '..', 'volei-dashboard.html');
const caminhoMeme = process.env.MEME_HTML || path.join(__dirname, '..', '..', 'voleimeme', 'index.html');
if (!fs.existsSync(caminhoMeme)) {
  console.log('PULADO - arquivo do Meme não encontrado: ' + caminhoMeme);
  process.exit(0);
}

function pegar(html, inicio, antesDe) {
  const i = html.indexOf(inicio);
  assert.ok(i > -1, 'não encontrei: ' + inicio);
  const f = html.indexOf(antesDe, i);
  assert.ok(f > i, 'não encontrei o fim de: ' + inicio);
  return html.slice(i, f);
}

// roda o salvarSessaoAuth e o salvarCopiaDosDados de verdade da página, com um localStorage que registra as chaves
function chavesGravadas(caminho) {
  const html = fs.readFileSync(caminho, 'utf8').replace(/\r/g, '');
  const codigo = pegar(html, '// <sessao-front>', '// </sessao-front>')
    + pegar(html, 'function salvarSessaoAuth(){', '// ID Token do Google dura ~1h')
    + pegar(html, 'async function buscarDadosComNovasTentativas(){', 'async function loadData(){');
  const F = new Function('gravadas', `
    const localStorage = { setItem: (k) => { gravadas.push(k); }, getItem: () => null, removeItem: () => {} };
    let AUTH = { idToken: '', exp: 0, email: 'a@exemplo.com', sessao: 'S1', sessaoExpiraEm: '', logado: true };
    ${codigo}
    return { salvarSessaoAuth, salvarCopiaDosDados };`);
  const login = [], copia = [];
  F(login).salvarSessaoAuth();
  F(copia).salvarCopiaDosDados({ players: [] });
  assert.equal(login.length, 1, 'salvarSessaoAuth deveria gravar uma chave em ' + caminho);
  assert.equal(copia.length, 1, 'salvarCopiaDosDados deveria gravar uma chave em ' + caminho);
  return { login: login[0], copia: copia[0] };
}

const terca = chavesGravadas(caminhoTerca);
const meme = chavesGravadas(caminhoMeme);
assert.notEqual(meme.login, terca.login, 'Terça e Meme gravam o LOGIN na mesma chave do localStorage: ' + terca.login);
assert.notEqual(meme.copia, terca.copia, 'Terça e Meme gravam a CÓPIA DOS DADOS na mesma chave do localStorage: ' + terca.copia);
assert.notEqual(meme.login, terca.copia);
assert.notEqual(meme.copia, terca.login);
console.log('ok — cada app grava em chaves próprias (Terça: ' + terca.login + ', ' + terca.copia + ' | Meme: ' + meme.login + ', ' + meme.copia + ')');
