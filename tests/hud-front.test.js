// 🚀 HUD do próximo jogo (v22.0), parte pura do app: a contagem até o jogo e o resumo das vagas.
// Rodar: node tests/hud-front.test.js   (HTML_ARQUIVO=<outro .html> testa o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const arquivo = process.env.HTML_ARQUIVO ? path.resolve(process.env.HTML_ARQUIVO) : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(arquivo, 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <hud-puro>');
const fim = html.indexOf('// </hud-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <hud-puro> não encontrado');
const F = new Function(html.slice(ini, fim) + 'return { contagemProJogo, vagasResumo };')();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }
// "agora" no fuso do aparelho, igual ao app (o teste vale em qualquer fuso)
const em = (a, m, d, h, min) => new Date(a, m - 1, d, h, min || 0).getTime();

t('dias antes: "Faltam N dias"; véspera: "É amanhã" (conta dia do calendário, não 24h)', () => {
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 7, 9)), { texto: 'Faltam 3 dias', tom: '' });
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 9, 23, 50)), { texto: 'É amanhã', tom: '' });
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 9, 0, 5)), { texto: 'É amanhã', tom: '' });
});
t('no dia: horas cheias que faltam; na última hora, minutos', () => {
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 10, 8)), { texto: 'É hoje · faltam 12h', tom: 'agora' });
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 10, 18, 30)), { texto: 'É hoje · faltam 1h', tom: 'agora' });
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 10, 19)), { texto: 'Começa em 60 min', tom: 'agora' });
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 10, 19, 48)), { texto: 'Começa em 12 min', tom: 'agora' });
});
t('começou: "Bola rolando" por 3h; depois "Jogo encerrado"', () => {
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 10, 20)), { texto: 'Bola rolando', tom: 'agora' });
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 10, 22, 59)), { texto: 'Bola rolando', tom: 'agora' });
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 10, 23)), { texto: 'Jogo encerrado', tom: 'fim' });
  assert.deepEqual(F.contagemProJogo('2026-11-10', '20:00', em(2026, 11, 11, 9)), { texto: 'Jogo encerrado', tom: 'fim' });
});
t('jogo depois da meia-noite do dia seguinte e virada de mês/ano', () => {
  assert.equal(F.contagemProJogo('2026-12-01', '19:30', em(2026, 11, 30, 21)).texto, 'É amanhã');
  assert.equal(F.contagemProJogo('2027-01-05', '20:00', em(2026, 12, 29, 12)).texto, 'Faltam 7 dias');
});
t('horário ausente ou torto cai em 20:00; data inválida não quebra', () => {
  assert.equal(F.contagemProJogo('2026-11-10', '', em(2026, 11, 10, 19, 30)).texto, 'Começa em 30 min');
  assert.equal(F.contagemProJogo('2026-11-10', 'noite', em(2026, 11, 10, 8)).texto, 'É hoje · faltam 12h');
  assert.deepEqual(F.contagemProJogo('', '20:00', em(2026, 11, 10, 8)), { texto: '', tom: '' });
  assert.deepEqual(F.contagemProJogo(null, null, 0), { texto: '', tom: '' });
});
t('vagas: livres no plural e no singular, lotado, reserva, anel de 0 a 100', () => {
  assert.deepEqual(F.vagasResumo(11, 16, 0), { pct: 69, livres: 5, lotado: false, texto: '5 vagas livres' });
  assert.deepEqual(F.vagasResumo(15, 16, 0), { pct: 94, livres: 1, lotado: false, texto: '1 vaga livre' });
  assert.deepEqual(F.vagasResumo(16, 16, 0), { pct: 100, livres: 0, lotado: true, texto: 'Lotado' });
  assert.deepEqual(F.vagasResumo(16, 16, 3), { pct: 100, livres: 0, lotado: true, texto: 'Lotado · 3 na reserva' });
  assert.deepEqual(F.vagasResumo(0, 16, 0), { pct: 0, livres: 16, lotado: false, texto: '16 vagas livres' });
});
t('vagas: números tortos não quebram nem passam de 100%', () => {
  assert.deepEqual(F.vagasResumo(20, 16, 0), { pct: 100, livres: 0, lotado: true, texto: 'Lotado' });
  assert.deepEqual(F.vagasResumo(3, 0, 0), { pct: 0, livres: 0, lotado: false, texto: '0 vagas livres' });
  assert.deepEqual(F.vagasResumo(undefined, '12', null), { pct: 0, livres: 12, lotado: false, texto: '12 vagas livres' });
});

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\ntudo certo');
