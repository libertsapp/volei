// v19.9: 🌱 Convidados frequentes (bloco <convidados-puro>) — convidado que já veio 2+ vezes e ainda não tem cadastro.
// Rodar: node tests/convidados-frequentes.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <convidados-puro>');
const fim = html.indexOf('// </convidados-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <convidados-puro> não encontrado');
const { computeConvidadosFrequentes, chaveDeNome } = new Function(html.slice(ini, fim) + '; return { computeConvidadosFrequentes, chaveDeNome };')();

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };
const HOJE = '2026-10-18';
let n = 0;
const g = (nome) => 'convidado:' + nome + '#' + (++n).toString(36); // sufixo novo a cada rodada, como no app
const rod = (data, ids, extra = {}) => ({ data, times: [{ playerIds: ids }, { playerIds: ['fixo'] }], vencedores: [0], ...extra });

caso('junta as vindas pelo nome (acento, maiúscula e espaço não importam) e conta DATAS, não rodadas', () => {
  const r = computeConvidadosFrequentes([
    rod('2026-09-01', [g('Ana Paula')]),
    rod('2026-09-01', [g('ana  paula')]),   // 2º jogo do mesmo dia: mesma data
    rod('2026-09-08', [g('ANA PAULA')]),
    rod('2026-09-15', [g('Kaio')])
  ], [], HOJE);
  assert.deepEqual(r, [{ nome: 'ANA PAULA', vezes: 2, ultima: '2026-09-08' }]); // nome: o jeito mais recente
});

caso('quem já tem cadastro (nome ou apelido, ativo ou removido) não entra', () => {
  const rodadas = [rod('2026-09-01', [g('Bruno'), g('Coxa'), g('Rique')]), rod('2026-09-08', [g('Bruno'), g('Coxa'), g('Rique')])];
  const cad = [{ nome: 'BRUNO' }, { nome: 'Marcos Silva', apelido: 'Coxa' }, { nome: 'Henrique', apelido: 'RIQUE', removido: true }];
  assert.deepEqual(computeConvidadosFrequentes(rodadas, cad, HOJE), []);
});

caso('conta vindas de qualquer época, mas a última precisa ser nos últimos 6 meses', () => {
  const r = computeConvidadosFrequentes([
    rod('2025-11-25', [g('Allan'), g('Velho')]),
    rod('2026-02-24', [g('Allan'), g('Velho')]),  // Velho parou em fevereiro (> 180 dias)
    rod('2026-09-01', [g('Allan')])
  ], [], HOJE);
  assert.deepEqual(r.map((x) => [x.nome, x.vezes]), [['Allan', 3]]);
});

caso('rascunho e data futura não contam; "convidado" sem nome é ignorado', () => {
  const r = computeConvidadosFrequentes([
    rod('2026-09-01', [g('Yago'), 'convidado:#zz']),
    rod('2026-09-08', [g('Yago'), 'convidado:#yy'], { rascunho: true }),
    rod('2026-10-25', [g('Yago')])
  ], [], HOJE);
  assert.deepEqual(r, []);
});

caso('ordem: mais datas primeiro; empate, quem veio mais recente', () => {
  const r = computeConvidadosFrequentes([
    rod('2026-08-01', [g('Lucas'), g('Ryan'), g('Coxa')]),
    rod('2026-08-08', [g('Lucas'), g('Ryan')]),
    rod('2026-08-15', [g('Lucas'), g('Coxa')])
  ], [], HOJE);
  assert.deepEqual(r.map((x) => x.nome), ['Lucas', 'Coxa', 'Ryan']);
});

caso('chaveDeNome', () => {
  assert.equal(chaveDeNome('  Débora   Lima '), 'debora lima');
  assert.equal(chaveDeNome(undefined), '');
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
