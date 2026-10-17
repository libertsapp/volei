// v19.2: 📅 "Adicionar à agenda" e ⚔️ Adversários (partes puras). Extrai o bloco <extras-puro>.
// Rodar: node tests/extras-v19-2.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <extras-puro>');
const fim = html.indexOf('// </extras-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <extras-puro> não encontrado');
const F = new Function(html.slice(ini, fim) + '; return { gerarIcs, linkGoogleAgenda, computeConfrontos, computeCarrascoFregues };')();

let ok = 0;
const caso = (nome, fn) => { fn(); ok++; console.log('ok    -', nome); };

const EV = { uid: 'checkin-2026-10-20-1@memberstars', titulo: 'Vôlei de Terça', data: '2026-10-20', horario: '20:00', duracaoMin: 120,
  local: 'Quadra, Centro; fundos', descricao: 'Lista:\nhttps://memberstars.com/volei/' };

caso('ICS: 20h em Brasília vira 23h UTC, 2h de duração, lembrete 2h antes, linhas em CRLF', () => {
  const ics = F.gerarIcs(EV, Date.parse('2026-10-17T12:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /\r\nDTSTART:20261020T230000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20261021T010000Z\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261017T120000Z\r\n/);
  assert.match(ics, /\r\nTRIGGER:-PT2H\r\n/);
  assert.match(ics, /\r\nUID:checkin-2026-10-20-1@memberstars\r\n/);
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /\n/); // nenhuma quebra solta (a descrição tem \n escapado)
});

caso('ICS: escapa vírgula, ponto e vírgula e quebra de linha', () => {
  const ics = F.gerarIcs(EV, 0);
  assert.match(ics, /\r\nLOCATION:Quadra\\, Centro\\; fundos\r\n/);
  assert.match(ics, /\r\nDESCRIPTION:Lista:\\nhttps:\/\/memberstars.com\/volei\/\r\n/);
});

caso('ICS: sem local nem descrição, as linhas nem aparecem', () => {
  const ics = F.gerarIcs({ uid: 'x', titulo: 'Vôlei', data: '2026-10-20', horario: '21:30' }, 0);
  assert.doesNotMatch(ics, /LOCATION/);
  const evento = ics.slice(ics.indexOf('BEGIN:VEVENT'), ics.indexOf('BEGIN:VALARM')); // a DESCRIPTION do alarme é obrigatória
  assert.doesNotMatch(evento, /DESCRIPTION/);
  assert.match(ics, /DTSTART:20261021T003000Z/); // 21h30 em Brasília = 00h30 UTC do dia seguinte
});

caso('Google Agenda: link com título, datas em UTC, local e detalhes codificados', () => {
  const url = F.linkGoogleAgenda(EV);
  assert.ok(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&text=V%C3%B4lei%20de%20Ter%C3%A7a'));
  assert.match(url, /&dates=20261020T230000Z%2F20261021T010000Z/);
  assert.match(url, /&location=Quadra%2C%20Centro%3B%20fundos/);
  assert.match(url, /&details=Lista%3A%0Ahttps/);
});

const rod = (times, vencedores, extra = {}) => ({ data: '2026-09-01', times: times.map((ids) => ({ playerIds: ids })), vencedores, ...extra });
const rodadas = [
  rod([['eu', 'ana'], ['bia', 'caio']], [1]),  // bia e caio campeões contra mim
  rod([['eu', 'bia'], ['ana', 'caio']], [1]),  // ana e caio campeões contra mim (bia comigo)
  rod([['eu', 'ana'], ['caio', 'duda']], [1]), // caio campeão
  rod([['eu'], ['caio'], ['duda']], [0]),      // eu campeão contra caio e duda
  rod([['eu', 'ana'], ['duda']], [0]),         // eu e ana campeões contra duda
  rod([['eu'], ['duda']], [0, 1]),             // os dois campeões: não conta pra ninguém
  rod([['eu'], ['duda']], [0], { rascunho: true }) // rascunho: fora
];

caso('confrontos: contra, vitórias, derrotas e juntos por adversário', () => {
  const c = F.computeConfrontos(rodadas, 'eu');
  assert.deepEqual(c.caio, { contra: 4, vitorias: 1, derrotas: 3, juntos: 0, titulosJuntos: 0 });
  // duda: campeã contra mim na 3ª (com caio); eu campeão na 4ª e na 5ª; na 6ª os dois campeões (não conta); rascunho fora
  assert.deepEqual(c.duda, { contra: 4, vitorias: 2, derrotas: 1, juntos: 0, titulosJuntos: 0 });
  assert.deepEqual(c.ana, { contra: 1, vitorias: 0, derrotas: 1, juntos: 3, titulosJuntos: 1 });
  assert.deepEqual(c.bia, { contra: 1, vitorias: 0, derrotas: 1, juntos: 1, titulosJuntos: 0 });
});

caso('carrasco e freguês (mínimo de 3 rodadas contra)', () => {
  const r = F.computeCarrascoFregues(rodadas, 'eu', 3);
  assert.equal(r.carrasco.id, 'caio'); // 3 de 4
  assert.equal(r.fregues.id, 'duda');  // 2 de 4 (caio também tem 1 vitória, mas 1/4 < 2/4)
  assert.equal(F.computeCarrascoFregues(rodadas, 'eu', 5).carrasco, null); // ninguém com 5 rodadas contra
});

caso('quem nunca jogou: sem confrontos, sem carrasco nem freguês', () => {
  assert.deepEqual(F.computeConfrontos(rodadas, 'novato'), {});
  assert.deepEqual(F.computeCarrascoFregues(rodadas, 'novato', 3), { carrasco: null, fregues: null });
});

console.log(`\n${ok} casos — TODOS OS TESTES PASSARAM`);
