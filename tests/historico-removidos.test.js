// v19.7: no Histórico, jogador REMOVIDO (DATA.removidos) aparece com o nome riscado em vez de "(removido)".
// Rodar: node tests/historico-removidos.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const i = html.indexOf('function jogadorDoHistoricoHtml(');
assert.ok(i > -1, 'jogadorDoHistoricoHtml não encontrada');
const fonte = html.slice(i, html.indexOf('\n}\n', i) + 3);
const f = new Function(`
  const DATA = { removidos: [{ id: 'rique', nome: 'Henrique', apelido: 'RIQUE' }] };
  const ativos = { ana: { id: 'ana', nome: 'Ana' } };
  const getPlayer = (id) => ativos[id];
  const escapeHtml = (x) => String(x);
  const avatarHtml = (p) => '[foto ' + (p ? p.id : '?') + ']';
  const nomeComApelidoHtml = (p) => p.apelido || p.nome;
  ${fonte}
  return jogadorDoHistoricoHtml;`)();

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };

caso('jogador ativo: nome clicável (abre o perfil), sem risco', () => {
  const h = f('ana');
  assert.match(h, /data-open-profile="ana">Ana</);
  assert.doesNotMatch(h, /<s>/);
});
caso('jogador removido: nome riscado, foto dele, sem abrir perfil', () => {
  const h = f('rique');
  assert.match(h, /<s>RIQUE<\/s>/);
  assert.match(h, /\[foto rique\]/);
  assert.match(h, /history-removido/);
  assert.match(h, /title="Jogador removido do grupo"/);
  assert.doesNotMatch(h, /data-open-profile/);
});
caso('id sem cadastro nenhum: continua "(removido)"', () => {
  assert.match(f('sumiu'), /\(removido\)/);
});
caso('falta: riscado + 🚫 faltou (ativo continua clicável)', () => {
  const h = f('ana', true);
  assert.match(h, /data-open-profile="ana"><s>Ana<\/s>/);
  assert.match(h, /🚫 faltou/);
  assert.match(f('rique', true), /<s>RIQUE<\/s>.*🚫 faltou/);
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
