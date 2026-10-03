// tests/dois-jogos-ui-puro.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <dois-jogos-puro>');
const fim = html.indexOf('// </dois-jogos-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <dois-jogos-puro> não encontrado');
const F = new Function(html.slice(ini, fim) + '\nreturn { jogosAbasHtml };')();

const SETTINGS = { checkinHorario: '19:00', checkinVagas: 2, checkinJogo2: { data: '2026-10-06', horario: '21:00', vagas: 2, travado: false } };
const CK = [{ id: 'c1', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', jogo: 1 }, { id: 'c2', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', jogo: 2 }];

let falhas = 0;
function t(nome, fn) { try { fn(); console.log('ok    -', nome); } catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

t('jogosAbasHtml: nada com 1 jogo; 2 botões, em ordem de horário, com "você" pra quem está logado e confirmado', () => {
  assert.equal(F.jogosAbasHtml({ checkinHorario: '19:00', checkinVagas: 16 }, [], '2026-10-06', 1, {}), '');
  const h = F.jogosAbasHtml(SETTINGS, CK, '2026-10-06', 2, { logado: true, jogadorId: 'p1' });
  assert.equal((h.match(/class="jogo-aba /g) || []).length, 2);
  assert.match(h, /19:00[\s\S]*21:00/); // 1º jogo antes do 2º
  assert.match(h, /jogo-aba ativa"[^>]*data-jogo-aba="2"/);
  assert.match(h, /você ✅/);
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
