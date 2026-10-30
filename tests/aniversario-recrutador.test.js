// v20.0: 🎂 aniversário e 🤝 recrutador (bloco <aniversario-puro>).
// Rodar: node tests/aniversario-recrutador.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <aniversario-puro>');
const fim = html.indexOf('// </aniversario-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <aniversario-puro> não encontrado');
const F = new Function(html.slice(ini, fim) + '; return { aniversarioValido, formatarAniversario, aniversariantesDoDia, aniversariantesDaSemana, proximosAniversarios, computeRecrutadores, RECRUTADO_MIN_DATAS };')();

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };
const J = (id, extra = {}) => ({ id, nome: id.toUpperCase(), ...extra });

caso('formato: só MM-DD com mês e dia de verdade', () => {
  assert.equal(F.aniversarioValido('03-15'), true);
  for (const v of ['15/03', '13-01', '00-10', '02-32', '3-15', '', undefined]) assert.equal(F.aniversarioValido(v), false, String(v));
  assert.equal(F.formatarAniversario('03-05'), '05/03');
  assert.equal(F.formatarAniversario('lixo'), '');
});

caso('🥳 aniversariantes da semana (v20.7): domingo a sábado, inclusive quem já fez aniversário no começo da semana', () => {
  // 2026-10-30 é sexta: a semana vai de domingo 25/10 a sábado 31/10
  const js = [J('dom', { aniversario: '10-25' }), J('sab', { aniversario: '10-31' }), J('antes', { aniversario: '10-24' }),
    J('depois', { aniversario: '11-01' }), J('hoje', { aniversario: '10-30' }), J('sem')];
  assert.deepEqual(F.aniversariantesDaSemana(js, '2026-10-30').map((p) => p.id).sort(), ['dom', 'hoje', 'sab']);
  // no domingo e no sábado a semana é a mesma
  assert.deepEqual(F.aniversariantesDaSemana(js, '2026-10-25').map((p) => p.id).sort(), ['dom', 'hoje', 'sab']);
  assert.deepEqual(F.aniversariantesDaSemana(js, '2026-10-31').map((p) => p.id).sort(), ['dom', 'hoje', 'sab']);
  // domingo seguinte: semana nova
  assert.deepEqual(F.aniversariantesDaSemana(js, '2026-11-01').map((p) => p.id), ['depois']);
});

caso('🥳 semana na virada do ano e 29/02 fora do bissexto', () => {
  // 2026-12-31 é quinta: semana de domingo 27/12/2026 a sábado 02/01/2027
  const js = [J('reveillon', { aniversario: '01-02' }), J('natal', { aniversario: '12-25' }), J('bis', { aniversario: '02-29' })];
  assert.deepEqual(F.aniversariantesDaSemana(js, '2026-12-31').map((p) => p.id), ['reveillon']);
  // 2027 não é bissexto: quem nasceu em 29/02 comemora em 28/02 (domingo 28/02/2027)
  assert.deepEqual(F.aniversariantesDaSemana(js, '2027-03-02').map((p) => p.id), ['bis']);
  assert.deepEqual(F.aniversariantesDaSemana([], '2026-10-30'), []);
});

caso('aniversariantes do dia; 29/02 comemora em 28/02 fora do bissexto (e em 29/02 no bissexto)', () => {
  const js = [J('a', { aniversario: '10-20' }), J('b', { aniversario: '02-29' }), J('c', { aniversario: '02-28' }), J('d')];
  assert.deepEqual(F.aniversariantesDoDia(js, '2026-10-20').map((p) => p.id), ['a']);
  assert.deepEqual(F.aniversariantesDoDia(js, '2027-02-28').map((p) => p.id), ['b', 'c']);
  assert.deepEqual(F.aniversariantesDoDia(js, '2028-02-28').map((p) => p.id), ['c']);
  assert.deepEqual(F.aniversariantesDoDia(js, '2028-02-29').map((p) => p.id), ['b']);
});

caso('próximos 7 dias: sem o de hoje, do mais perto pro mais longe, virando o ano', () => {
  const js = [J('hoje', { aniversario: '12-30' }), J('a', { aniversario: '01-02' }), J('b', { aniversario: '12-31' }), J('longe', { aniversario: '01-10' })];
  const r = F.proximosAniversarios(js, '2026-12-30', 7);
  assert.deepEqual(r.map((x) => [x.jogador.id, x.data, x.emDias]), [['b', '2026-12-31', 1], ['a', '2027-01-02', 3]]);
});

caso('recrutador: conta só quem o recrutado trouxe e que já jogou 3 datas (datas, não rodadas)', () => {
  assert.equal(F.RECRUTADO_MIN_DATAS, 3);
  const rod = (data, ids) => ({ data, times: [{ playerIds: ids }] });
  const rodadas = [
    rod('2026-09-01', ['novo1', 'novo2']), rod('2026-09-01', ['novo1']), // 2 jogos no mesmo dia = 1 data
    rod('2026-09-08', ['novo1', 'novo2']), rod('2026-09-15', ['novo1', 'novo3'])
  ];
  const js = [
    J('ana'), J('bia'),
    J('novo1', { recrutadoPor: 'ana' }),   // 3 datas: conta
    J('novo2', { recrutadoPor: 'ana' }),   // 2 datas: ainda não
    J('novo3', { recrutadoPor: 'bia' }),   // 1 data
    J('eu', { recrutadoPor: 'eu' })        // auto-recrutamento não conta
  ];
  assert.deepEqual(F.computeRecrutadores(js, rodadas), { ana: 1 });
  rodadas.push(rod('2026-09-22', ['novo2']));
  assert.deepEqual(F.computeRecrutadores(js, rodadas), { ana: 2 });
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
