// Horário do jogo na rodada: sugestão vinda do check-in, escolha manual e exibição junto da data (ajuste 12).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(__dirname + '/../volei-dashboard.html', 'utf8');
const pega = (nome) => {
  const i = html.indexOf('function ' + nome + '(');
  assert.ok(i > 0, nome + ' não existe');
  let n = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) { if (html[k] === '{') n++; if (html[k] === '}' && --n === 0) return html.slice(i, k + 1); }
};
function montar({ settings, checkins = [], jogoAtivo = 1, dataCampo = '2026-10-13', campo = { value: '', dataset: {} } }) {
  const els = { 'round-date': { value: dataCampo }, 'round-time': campo };
  const F = new Function('ctx', `
    const SETTINGS = ctx.settings, CHECKINS = ctx.checkins; let JOGO_ATIVO = ctx.jogoAtivo;
    const document = { getElementById: (id) => ctx.els[id] };
    ${pega('jogosDoDia')}
    ${pega('formatDate')}
    ${pega('dataComHorario')}
    ${pega('horarioDoCheckinNaData')}
    ${pega('sugerirHorarioDaRodada')}
    return { horarioDoCheckinNaData, sugerirHorarioDaRodada, dataComHorario };`);
  return { ...F({ settings, checkins, jogoAtivo, els }), campo };
}
let falhas = 0;
const t = (nome, fn) => { try { fn(); console.log('ok    - ' + nome); } catch (e) { falhas++; console.log('FALHA - ' + nome + '\n' + e.message); } };
const cfg = (extra) => ({ checkinDataAberta: '2026-10-13', checkinHorario: '20:00', checkinVagas: 16, checkinJogo2: null, ...extra });

t('data igual à do check-in aberto: sugere o horário do check-in', () => {
  const m = montar({ settings: cfg() });
  m.sugerirHorarioDaRodada();
  assert.equal(m.campo.value, '20:00');
});
t('outra data: o app não sabe o horário, campo fica vazio', () => {
  const m = montar({ settings: cfg(), dataCampo: '2026-10-20' });
  m.sugerirHorarioDaRodada();
  assert.equal(m.campo.value, '');
});
t('dois jogos: usa o horário do jogo da aba ativa', () => {
  const s = cfg({ checkinJogo2: { data: '2026-10-13', horario: '21:30', vagas: 16, travado: false } });
  assert.equal(montar({ settings: s, jogoAtivo: 2 }).horarioDoCheckinNaData('2026-10-13'), '21:30');
  assert.equal(montar({ settings: s, jogoAtivo: 1 }).horarioDoCheckinNaData('2026-10-13'), '20:00');
});
t('horário digitado à mão não é sobrescrito pela sugestão (só quando se troca a data, com forçar)', () => {
  const m = montar({ settings: cfg(), campo: { value: '19:00', dataset: { manual: '1' } } });
  m.sugerirHorarioDaRodada();
  assert.equal(m.campo.value, '19:00');
  m.sugerirHorarioDaRodada(true);
  assert.equal(m.campo.value, '20:00');
});
t('exibição: data com horário; rodada antiga só com a data', () => {
  const m = montar({ settings: cfg() });
  assert.equal(m.dataComHorario({ data: '2026-10-13', horario: '20:00' }), '13/10/2026 · 20:00');
  assert.equal(m.dataComHorario({ data: '2026-10-06', horario: '' }), '06/10/2026');
  assert.equal(m.dataComHorario({ data: '2026-10-06' }), '06/10/2026');
});
t('as 4 gravações de rodada (salvar/rascunho, nova/edição) levam o horário', () => {
  assert.equal((html.match(/horario: horarioDigitado\(\)/g) || []).length, 4);
});
if (falhas) { console.log('\n' + falhas + ' FALHA(S)'); process.exit(1); }
console.log('\nTODOS OS TESTES PASSARAM');
