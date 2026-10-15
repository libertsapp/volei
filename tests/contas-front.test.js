// Tela Contas (v18.4), parte pura: "há X tempo" do último acesso e a separação "Online agora / Últimos online".
// Extrai <contas-puro> do HTML. Rodar: node tests/contas-front.test.js   (HTML_ARQUIVO=<outro .html> testa o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const arquivo = process.env.HTML_ARQUIVO ? path.resolve(process.env.HTML_ARQUIVO) : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(arquivo, 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <contas-puro>');
const fim = html.indexOf('// </contas-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <contas-puro> não encontrado');
const C = new Function(html.slice(ini, fim) + 'return { tempoDesde, resumoOnline, ONLINE_MINUTOS, RECENTES_MAX };')();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

// "agora" fixo: 14/10/2026 20:00 em Brasília (23:00 UTC)
const AGORA = Date.parse('2026-10-14T23:00:00.000Z');
const antes = (min) => new Date(AGORA - min * 60000).toISOString();

t('tempoDesde: minutos, horas, ontem, dias e data', () => {
  assert.equal(C.tempoDesde(antes(0.3), AGORA), 'agora mesmo');
  assert.equal(C.tempoDesde(antes(1), AGORA), 'há 1 min');
  assert.equal(C.tempoDesde(antes(25), AGORA), 'há 25 min');
  assert.equal(C.tempoDesde(antes(60), AGORA), 'há 1 h');
  assert.equal(C.tempoDesde(antes(3 * 60 + 20), AGORA), 'há 3 h');
  // 13/10 em Brasília (dia anterior no calendário), mesmo que tenha sido há menos de 24 h
  assert.equal(C.tempoDesde('2026-10-14T01:00:00.000Z', AGORA), 'ontem'); // 13/10 22:00 em Brasília
  assert.equal(C.tempoDesde(antes(3 * 24 * 60), AGORA), 'há 3 dias');
  assert.equal(C.tempoDesde('2026-08-01T15:00:00.000Z', AGORA), '01/08/2026');
});
t('tempoDesde: hoje cedo ainda é "há N h" (não "ontem")', () => {
  assert.equal(C.tempoDesde('2026-10-14T10:00:00.000Z', AGORA), 'há 13 h'); // 07:00 de hoje em Brasília
});
t('tempoDesde: vazio, inválido ou no futuro (relógio adiantado)', () => {
  assert.equal(C.tempoDesde('', AGORA), 'sem registro ainda');
  assert.equal(C.tempoDesde(null, AGORA), 'sem registro ainda');
  assert.equal(C.tempoDesde('xpto', AGORA), 'sem registro ainda');
  assert.equal(C.tempoDesde(new Date(AGORA + 120000).toISOString(), AGORA), 'agora mesmo');
});

const contas = [
  { email: 'a', ultimoAcesso: antes(2) },
  { email: 'b', ultimoAcesso: antes(9) },
  { email: 'c', ultimoAcesso: antes(11) },
  { email: 'd', ultimoAcesso: '' },
  { email: 'e', ultimoAcesso: antes(600) },
  { email: 'f', ultimoAcesso: antes(30) }
];
t('resumoOnline: online = últimos 10 min (mais recente primeiro)', () => {
  assert.equal(C.ONLINE_MINUTOS, 10);
  assert.deepEqual(C.resumoOnline(contas, AGORA).online.map(u => u.email), ['a', 'b']);
});
t('resumoOnline: últimos online = o resto com registro, mais recente primeiro, sem repetir quem está online', () => {
  assert.deepEqual(C.resumoOnline(contas, AGORA).recentes.map(u => u.email), ['c', 'f', 'e']);
});
t('resumoOnline: no máximo RECENTES_MAX nos últimos online', () => {
  const muitas = Array.from({ length: 25 }, (_, i) => ({ email: 'x' + i, ultimoAcesso: antes(20 + i) }));
  const r = C.resumoOnline(muitas, AGORA);
  assert.equal(C.RECENTES_MAX, 10);
  assert.equal(r.recentes.length, 10);
  assert.equal(r.recentes[0].email, 'x0');
});
t('resumoOnline: lista vazia ou sem registros', () => {
  assert.deepEqual(C.resumoOnline([], AGORA), { online: [], recentes: [] });
  assert.deepEqual(C.resumoOnline([{ email: 'z', ultimoAcesso: '' }], AGORA), { online: [], recentes: [] });
  assert.deepEqual(C.resumoOnline(undefined, AGORA), { online: [], recentes: [] });
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
