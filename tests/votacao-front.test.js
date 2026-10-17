// 🗳️ Votação do Craque/Bola Murcha (v19.1), partes puras do app. Extrai o bloco <votacao-puro>.
// Rodar: node tests/votacao-front.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <votacao-puro>');
const fim = html.indexOf('// </votacao-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <votacao-puro> não encontrado');
const { jogadoresDoDia, textoFaltaFechar, vencedoresAtuais } = new Function(html.slice(ini, fim) + '; return { jogadoresDoDia, textoFaltaFechar, vencedoresAtuais };')();

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };

caso('jogadoresDoDia: junta os dois jogos do dia e ignora rascunho e outras datas', () => {
  const rounds = [
    { data: '2026-10-13', times: [{ playerIds: ['ana', 'bia'] }, { playerIds: ['caio'] }] },
    { data: '2026-10-13', times: [{ playerIds: ['ana', 'duda'] }] },                // 2º jogo do dia
    { data: '2026-10-13', rascunho: true, times: [{ playerIds: ['eva'] }] },       // rascunho: fora
    { data: '2026-10-06', times: [{ playerIds: ['fred'] }] }                        // outra data
  ];
  assert.deepEqual([...jogadoresDoDia(rounds, '2026-10-13')].sort(), ['ana', 'bia', 'caio', 'duda']);
});

caso('textoFaltaFechar: horas, horas e minutos, minutos e fechando', () => {
  const agora = Date.parse('2026-10-14T00:00:00Z');
  assert.equal(textoFaltaFechar('2026-10-14T05:30:00Z', agora), 'fecha em 5h30');
  assert.equal(textoFaltaFechar('2026-10-14T05:03:00Z', agora), 'fecha em 5h');
  assert.equal(textoFaltaFechar('2026-10-14T23:30:00Z', agora), 'fecha em 23h');
  assert.equal(textoFaltaFechar('2026-10-14T00:40:00Z', agora), 'fecha em 40 min');
  assert.equal(textoFaltaFechar('2026-10-13T23:00:00Z', agora), 'fechando');
});

caso('vencedoresAtuais: votação fechada mais recente com vencedor, por categoria', () => {
  const vot = [
    { data: '2026-10-13', aberta: true },                                                                  // aberta: ignora
    { data: '2026-10-06', aberta: false, resultado: { craque: { ids: ['ana'], votos: 3 }, murcha: { ids: [], votos: 0 } } },
    { data: '2026-09-29', aberta: false, resultado: { craque: { ids: ['bia'], votos: 2 }, murcha: { ids: ['caio', 'duda'], votos: 2 } } }
  ];
  const r = vencedoresAtuais(vot);
  assert.deepEqual(r.craque, { ids: ['ana'], data: '2026-10-06' });
  // 06/10 ninguém votou em bola murcha: o emblema fica com os eleitos da votação anterior
  assert.deepEqual(r.murcha, { ids: ['caio', 'duda'], data: '2026-09-29' });
});

caso('vencedoresAtuais: sem votação fechada, ninguém tem emblema', () => {
  assert.deepEqual(vencedoresAtuais([]), { craque: { ids: [], data: '' }, murcha: { ids: [], data: '' } });
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
