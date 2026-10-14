// Termos de uso (v18.2): regra de quando o popup aparece + conteúdo obrigatório do termo. Extrai <termos-puro> do HTML.
// Rodar: node tests/termos-front.test.js   (HTML_ARQUIVO=<outro .html> testa o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const arquivo = process.env.HTML_ARQUIVO ? path.resolve(process.env.HTML_ARQUIVO) : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(arquivo, 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <termos-puro>');
const fim = html.indexOf('// </termos-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <termos-puro> não encontrado');
const T = new Function(html.slice(ini, fim) + 'return { TERMOS_VERSAO, TERMOS_HTML, precisaAceitarTermos };')();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('conta que nunca aceitou (nova ou antiga): mostra', () => {
  assert.equal(T.precisaAceitarTermos({ status: 'ok', termosVersao: '' }, '1'), true);
});
t('conta que aceitou a versão atual: não mostra', () => {
  assert.equal(T.precisaAceitarTermos({ status: 'ok', termosVersao: '1' }, '1'), false);
});
t('termo mudou de versão: mostra de novo', () => {
  assert.equal(T.precisaAceitarTermos({ status: 'ok', termosVersao: '1' }, '2'), true);
});
t('servidor antigo (resposta sem termosVersao): NÃO mostra — o aceite falharia e o popup voltaria sempre', () => {
  assert.equal(T.precisaAceitarTermos({ status: 'ok', perfil: 'jogador' }, '1'), false);
});
t('erro, resposta vazia ou valor estranho: não mostra', () => {
  assert.equal(T.precisaAceitarTermos({ error: 'x', termosVersao: '' }, '1'), false);
  assert.equal(T.precisaAceitarTermos(null, '1'), false);
  assert.equal(T.precisaAceitarTermos(undefined, '1'), false);
  assert.equal(T.precisaAceitarTermos({ termosVersao: null }, '1'), false);
});
t('versão atual é um texto que o backend aceita', () => {
  assert.match(T.TERMOS_VERSAO, /^[A-Za-z0-9._-]{1,20}$/);
});
t('termo tem o que a LGPD pede: responsável, contato, lei, direitos, dados e onde ficam', () => {
  const texto = T.TERMOS_HTML.replace(/<[^>]+>/g, ' ');
  for (const trecho of ['Heleno Vilela', 'kingnabucodonosor@gmail.com', '13.709', 'apagar', 'Supabase', 'fora do Brasil', 'Não vendemos']) {
    assert.ok(texto.includes(trecho), 'faltou: ' + trecho);
  }
});
t('termo tem a isenção de responsabilidade pelos atos dos jogadores', () => {
  const texto = T.TERMOS_HTML.replace(/<[^>]+>/g, ' ');
  for (const trecho of ['não se responsabiliza', 'atos e condutas dos jogadores', 'lesões ou acidentes', 'pelos próprios atos']) {
    assert.ok(texto.includes(trecho), 'faltou: ' + trecho);
  }
});
t('termo mostra a versão em vigor', () => {
  assert.ok(T.TERMOS_HTML.includes('versão ' + T.TERMOS_VERSAO));
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
