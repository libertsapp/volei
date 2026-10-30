// 🎉 Cartão de parabéns (v21.0), parte pura do app: frases padrão/do grupo, sorteio sem repetir, troca de {nome}/{grupo}
// e quebra da frase em linhas. Rodar: node tests/parabens-front.test.js   (HTML_ARQUIVO=<outro .html> testa o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const arquivo = process.env.HTML_ARQUIVO ? path.resolve(process.env.HTML_ARQUIVO) : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(arquivo, 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <parabens-puro>');
const fim = html.indexOf('// </parabens-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <parabens-puro> não encontrado');
const F = new Function(html.slice(ini, fim) + 'return { FRASES_ANIVERSARIO_PADRAO, frasesDoGrupo, montarFrase, sortearFrase, quebrarLinhas };')();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('frases padrão: 8, todas com {nome}', () => {
  assert.equal(F.FRASES_ANIVERSARIO_PADRAO.length, 8);
  for (const f of F.FRASES_ANIVERSARIO_PADRAO) assert.ok(f.includes('{nome}'), f);
});
t('frases do grupo: as editadas; sem edição (ou só vazias/lixo), as padrão — e nunca a mesma lista por referência', () => {
  assert.deepEqual(F.frasesDoGrupo({ frasesAniversario: ['Oi {nome}', '  ', 42] }), ['Oi {nome}']);
  for (const st of [{}, null, { frasesAniversario: [] }, { frasesAniversario: ['', ' '] }, { frasesAniversario: 'x' }]) {
    assert.deepEqual(F.frasesDoGrupo(st), F.FRASES_ANIVERSARIO_PADRAO, JSON.stringify(st));
  }
  assert.notEqual(F.frasesDoGrupo({}), F.FRASES_ANIVERSARIO_PADRAO);
});
t('montar: troca todos os {nome} e {grupo}', () => {
  assert.equal(F.montarFrase('{nome}, {nome}! Mais um ano de {grupo}', 'Carla', 'Vôlei de Terça'), 'Carla, Carla! Mais um ano de Vôlei de Terça');
  assert.equal(F.montarFrase('Sem marcador', 'Carla', 'G'), 'Sem marcador');
  assert.equal(F.montarFrase(null, 'Carla', 'G'), '');
});
t('sorteio: nunca repete a anterior quando há mais de uma (300 sorteios); com uma só, devolve ela; vazia = ""', () => {
  const l = ['a', 'b', 'c'];
  let ant = 'a';
  for (let i = 0; i < 300; i++) { const f = F.sortearFrase(l, ant); assert.notEqual(f, ant); assert.ok(l.includes(f)); ant = f; }
  assert.equal(F.sortearFrase(['única'], 'única'), 'única');
  assert.equal(F.sortearFrase([], ''), '');
  // aleatório nos extremos (0 e quase 1) não sai da lista
  assert.equal(F.sortearFrase(l, 'a', () => 0), 'b');
  assert.equal(F.sortearFrase(l, 'a', () => 0.9999999), 'c');
});
t('quebrar linhas: respeita a largura, mantém as palavras e a ordem; palavra enorme fica sozinha', () => {
  const medir = (s) => s.length; // 1 "pixel" por letra
  const linhas = F.quebrarLinhas('Parabéns, Carla! Que seu ano seja só de ponto de saque', 20, medir);
  assert.ok(linhas.every((l) => l.length <= 20), JSON.stringify(linhas));
  assert.equal(linhas.join(' '), 'Parabéns, Carla! Que seu ano seja só de ponto de saque');
  assert.deepEqual(F.quebrarLinhas('a supercalifragilistico b', 5, medir), ['a', 'supercalifragilistico', 'b']);
  assert.deepEqual(F.quebrarLinhas('   ', 10, medir), []);
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
