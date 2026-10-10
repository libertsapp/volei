// Aviso amarelo "times sorteados" na primeira tela: aparece só com rascunho pendente e leva ao rascunho mais recente.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(__dirname + '/../volei-dashboard.html', 'utf8');
const pega = (nome) => {
  const i = html.indexOf('function ' + nome + '(');
  assert.ok(i > 0, nome + ' não existe');
  let n = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) { if (html[k] === '{') n++; if (html[k] === '}' && --n === 0) return html.slice(i, k + 1); }
};
function montar(rounds) {
  const els = { 'rascunho-alerta': { style: {}, dataset: {} }, 'rascunho-alerta-texto': { textContent: '' } };
  const cliques = [];
  const F = new Function('ctx', `
    const DATA = { rounds: ctx.rounds }; const document = { getElementById: (id) => ctx.els[id] || null };
    const toTimestamp = (d) => Date.parse(d); const formatDate = (d) => d.split('-').reverse().join('/');
    ${pega('dataComHorario')}
    ${pega('atualizarAlertaRascunhos')}
    return { atualizarAlertaRascunhos };`);
  return { ...F({ rounds, els, cliques }), els };
}
let falhas = 0;
const t = (nome, fn) => { try { fn(); console.log('ok    - ' + nome); } catch (e) { falhas++; console.log('FALHA - ' + nome + '\n' + e.message); } };

t('sem rascunho: aviso escondido', () => {
  const m = montar([{ id: 'a', data: '2026-10-06', rascunho: false }]);
  m.atualizarAlertaRascunhos();
  assert.equal(m.els['rascunho-alerta'].style.display, 'none');
});
t('1 rascunho: mostra a data e guarda o id', () => {
  const m = montar([{ id: 'a', data: '2026-10-06', rascunho: false }, { id: 'b', data: '2026-10-13', rascunho: true }]);
  m.atualizarAlertaRascunhos();
  assert.equal(m.els['rascunho-alerta'].style.display, 'flex');
  assert.equal(m.els['rascunho-alerta-texto'].textContent, 'Times sorteados — jogo de 13/10/2026');
  assert.equal(m.els['rascunho-alerta'].dataset.rascunhoId, 'b');
});
t('rascunho com horário: o aviso mostra data · horário', () => {
  const m = montar([{ id: 'b', data: '2026-10-13', horario: '20:00', rascunho: true }]);
  m.atualizarAlertaRascunhos();
  assert.equal(m.els['rascunho-alerta-texto'].textContent, 'Times sorteados — jogo de 13/10/2026 · 20:00');
});
t('2 rascunhos: plural e aponta pro mais recente', () => {
  const m = montar([{ id: 'x', data: '2026-10-13', rascunho: true }, { id: 'y', data: '2026-10-20', rascunho: true }]);
  m.atualizarAlertaRascunhos();
  assert.equal(m.els['rascunho-alerta-texto'].textContent, '2 jogos com times sorteados');
  assert.equal(m.els['rascunho-alerta'].dataset.rascunhoId, 'y');
});
t('rascunho some (finalizado/excluído): aviso volta a esconder', () => {
  const rounds = [{ id: 'b', data: '2026-10-13', rascunho: true }];
  const m = montar(rounds);
  m.atualizarAlertaRascunhos();
  rounds[0].rascunho = false;
  m.atualizarAlertaRascunhos();
  assert.equal(m.els['rascunho-alerta'].style.display, 'none');
});
t('o cartão do rascunho no Histórico tem o id que o aviso procura', () => {
  assert.ok(html.includes('id="rascunho-${r.id}"'));
});
if (falhas) { console.log('\n' + falhas + ' FALHA(S)'); process.exit(1); }
console.log('\nTODOS OS TESTES PASSARAM');
