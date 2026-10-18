// 🎥 Replays do RegistraAí (v20.2), parte pura do app: link da arena, último jogo, janela "início até 2h depois",
// horas a buscar e separação dos clipes por jogo (com validação dos endereços que vêm de fora).
// Rodar: node tests/replays-front.test.js   (HTML_ARQUIVO=<outro .html> testa o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const arquivo = process.env.HTML_ARQUIVO ? path.resolve(process.env.HTML_ARQUIVO) : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(arquivo, 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <replays-puro>');
const fim = html.indexOf('// </replays-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <replays-puro> não encontrado');
const R = new Function(html.slice(ini, fim) + 'return { replaysQuadraDoDia, replaysArenaDoLink,replaysMinutos, replaysHorariosDoDia, replaysUltimoJogo, replaysJanelas, replaysHorasParaBuscar, replaysVideoValido, replaysSepararPorJogo };')();

let falhas = 0;
function t(nome, fn){ try { fn(); console.log('ok    -', nome); } catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); } }

const A = '697391cdf60a9f8fabaa7943';
const CDN = 'https://registraais3.sfo3.cdn.digitaloceanspaces.com/' + A + '/video/';
const v = (hhmm, hash) => ({ hash: hash || 'h' + hhmm, label: hhmm + ' 13/10/2026', video: CDN + 'replay/w' + (hash || hhmm.replace(':', '')) + '.mp4', thumb: CDN + 'thumb/t.png' });
const ms = (iso) => Date.parse(iso);

t('link da arena: o link inteiro, só o id, maiúsculas e espaços', () => {
  assert.equal(R.replaysArenaDoLink('https://registraai.com.br/?a=' + A), A);
  assert.equal(R.replaysArenaDoLink('  https://registraai.com.br/?x=1&a=' + A.toUpperCase() + '  '), A);
  assert.equal(R.replaysArenaDoLink(A), A);
});
t('link da arena: lixo e id do tamanho errado viram vazio', () => {
  for (const x of ['', null, 'https://registraai.com.br/', 'https://registraai.com.br/?a=' + A + 'ff', 'abc', A.slice(1), '?a=' + A.replace('6', 'g')]) {
    assert.equal(R.replaysArenaDoLink(x), '', String(x));
  }
});
t('minutos: hh:mm válido e inválido', () => {
  assert.equal(R.replaysMinutos('20:00'), 1200);
  assert.equal(R.replaysMinutos('21:38 13/10/2026'), 1298);
  for (const x of ['', null, '24:00', '20:60', 'abc']) assert.equal(R.replaysMinutos(x), null, String(x));
});
t('horários do dia: rodadas + check-in aberto (com 2º jogo); sem nada, o padrão do check-in', () => {
  const st = { checkinDataAberta: '2026-10-20', checkinHorario: '20:00', checkinJogo2: { data: '2026-10-20', horario: '21:30' } };
  const rodadas = [{ data: '2026-10-13', horario: '20:00' }, { data: '2026-10-13', horario: '21:00' }, { data: '2026-10-13', horario: '20:00' }];
  assert.deepEqual(R.replaysHorariosDoDia(rodadas, st, '2026-10-13'), ['20:00', '21:00']);
  assert.deepEqual(R.replaysHorariosDoDia(rodadas, st, '2026-10-20'), ['20:00', '21:30']);
  assert.deepEqual(R.replaysHorariosDoDia([], { checkinHorario: '19:30' }, '2026-10-06'), ['19:30']);
  assert.deepEqual(R.replaysHorariosDoDia([{ data: '2026-10-06', horario: '' }], {}, '2026-10-06'), ['20:00']);
});
t('último jogo: o mais recente que já começou (fica até o próximo começar)', () => {
  const rodadas = [{ data: '2026-10-06', horario: '20:00' }, { data: '2026-10-13', horario: '20:00' }];
  const st = { checkinDataAberta: '2026-10-20', checkinHorario: '20:00' };
  // segunda 19/10: o de 13/10 ainda é o último
  assert.equal(R.replaysUltimoJogo(rodadas, st, ms('2026-10-19T12:00:00-03:00')).data, '2026-10-13');
  // terça 20/10 às 19:59: ainda não começou
  assert.equal(R.replaysUltimoJogo(rodadas, st, ms('2026-10-20T19:59:00-03:00')).data, '2026-10-13');
  // às 20:00 o novo jogo assume (antes de lançar a rodada, pelo check-in)
  assert.deepEqual(R.replaysUltimoJogo(rodadas, st, ms('2026-10-20T20:00:00-03:00')), { data: '2026-10-20', horarios: ['20:00'] });
});
t('último jogo: sem rodadas nem check-in = nenhum; só jogo futuro = nenhum', () => {
  assert.equal(R.replaysUltimoJogo([], {}, Date.now()), null);
  assert.equal(R.replaysUltimoJogo([{ data: '2099-01-01', horario: '20:00' }], {}, ms('2026-10-18T12:00:00-03:00')), null);
});
t('janelas: de cada início até 2 horas depois, sem repetir', () => {
  assert.deepEqual(R.replaysJanelas(['21:00', '20:00', '20:00', 'xx']), [
    { numero: 1, horario: '20:00', ini: 1200, fim: 1320 }, { numero: 2, horario: '21:00', ini: 1260, fim: 1380 }]);
});
t('horas a buscar: cobre a janela e só as horas gravadas', () => {
  assert.deepEqual(R.replaysHorasParaBuscar(R.replaysJanelas(['20:00']), [22, 21, 20, 19]), [20, 21, 22]);
  assert.deepEqual(R.replaysHorasParaBuscar(R.replaysJanelas(['20:30']), [23, 22, 21, 20]), [20, 21, 22]);
  assert.deepEqual(R.replaysHorasParaBuscar(R.replaysJanelas(['20:00']), [9, 10]), []);
  // jogo às 23h: a janela para na meia-noite (o dia seguinte é outra data no RegistraAí)
  assert.deepEqual(R.replaysHorasParaBuscar(R.replaysJanelas(['23:00']), [23]), [23]);
});
t('separar por jogo: um jogo, filtra fora da janela e ordena por horário', () => {
  const g = R.replaysSepararPorJogo([v('21:38'), v('19:50'), v('20:05'), v('22:00'), v('21:59')], R.replaysJanelas(['20:00']), false);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].videos.map((x) => x.hora), ['20:05', '21:38', '21:59']);
});
t('separar por jogo: dois jogos sobrepostos — o clipe vai pro que começou por último', () => {
  const g = R.replaysSepararPorJogo([v('20:10'), v('21:10'), v('22:30'), v('23:10')], R.replaysJanelas(['20:00', '21:00']), false);
  assert.deepEqual(g.map((x) => [x.numero, x.videos.map((y) => y.hora)]), [[1, ['20:10']], [2, ['21:10', '22:30']]]);
});
t('separar: dia inteiro = um grupo com tudo; nada = lista vazia', () => {
  const g = R.replaysSepararPorJogo([v('09:00'), v('21:00')], R.replaysJanelas(['20:00']), true);
  assert.deepEqual(g.map((x) => [x.numero, x.videos.length]), [[0, 2]]);
  assert.deepEqual(R.replaysSepararPorJogo([], R.replaysJanelas(['20:00']), false), []);
  assert.deepEqual(R.replaysSepararPorJogo(null, [], true), []);
});
t('separar: repetidos (mesmo hash) entram uma vez só', () => {
  const g = R.replaysSepararPorJogo([v('20:10', 'abc'), v('20:10', 'abc')], R.replaysJanelas(['20:00']), false);
  assert.equal(g[0].videos.length, 1);
});
t('vídeo de fora: só https terminando em .mp4, sem aspas/espaço; miniatura ruim some (vídeo fica)', () => {
  const ruins = ['http://x.test/a.mp4', 'javascript:alert(1)//.mp4', 'https://x.test/a".mp4', 'https://x.test/a b.mp4', 'https://x.test/a.mov', 'https://x.test/<a>.mp4'];
  for (const url of ruins) assert.equal(R.replaysVideoValido({ video: url, label: '20:10 13/10/2026' }), false, url);
  assert.equal(R.replaysVideoValido({ video: CDN + 'a.mp4', label: 'sem hora' }), false);
  assert.equal(R.replaysVideoValido(null), false);
  const g = R.replaysSepararPorJogo([{ ...v('20:10'), thumb: 'javascript:alert(1)' }], R.replaysJanelas(['20:00']), false);
  assert.equal(g[0].videos[0].thumb, '');
});
t('quadra do dia (v20.3): a marcada naquele dia; sem marcação (ou marcação estragada), a padrão', () => {
  const Q1 = '6973973ef60a9f8fabaa7946', Q2 = '6973976bf60a9f8fabaa7947';
  const cfg = { arena: A, quadra: Q1, quadraNome: 'Quadra 1', dias: { '2026-10-13': { quadra: Q2, nome: 'Quadra 2' }, '2026-10-06': { quadra: 'x' } } };
  assert.deepEqual(R.replaysQuadraDoDia(cfg, '2026-10-13'), { quadra: Q2, nome: 'Quadra 2', marcada: true });
  assert.deepEqual(R.replaysQuadraDoDia(cfg, '2026-10-20'), { quadra: Q1, nome: 'Quadra 1', marcada: false });
  assert.deepEqual(R.replaysQuadraDoDia(cfg, '2026-10-06'), { quadra: Q1, nome: 'Quadra 1', marcada: false });
  assert.deepEqual(R.replaysQuadraDoDia({ arena: A, quadra: Q1 }, '2026-10-13'), { quadra: Q1, nome: '', marcada: false });
});
// simulação: 200 dias aleatórios — nenhum clipe fora de todas as janelas aparece, nenhum some, nenhum repete
t('simulação: 200 dias aleatórios respeitam a janela', () => {
  for (let i = 0; i < 200; i++) {
    const n = 1 + Math.floor(Math.random() * 2);
    const inicios = Array.from({ length: n }, () => String(17 + Math.floor(Math.random() * 6)).padStart(2, '0') + ':' + ['00', '15', '30', '45'][Math.floor(Math.random() * 4)]);
    const js = R.replaysJanelas(inicios);
    const videos = Array.from({ length: 30 }, (_, k) => {
      const m = Math.floor(Math.random() * 1440);
      return v(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'), 'k' + k);
    });
    const dentro = videos.filter((x) => js.some((j) => R.replaysMinutos(x.label) >= j.ini && R.replaysMinutos(x.label) < j.fim));
    const g = R.replaysSepararPorJogo(videos, js, false);
    const saida = [].concat(...g.map((x) => x.videos));
    assert.equal(saida.length, dentro.length, 'iteração ' + i);
    assert.equal(new Set(saida.map((x) => x.hash)).size, saida.length);
    for (const grupo of g) {
      const j = js.find((y) => y.numero === grupo.numero);
      for (const x of grupo.videos) assert.ok(x.minuto >= j.ini && x.minuto < j.fim);
      for (let k = 1; k < grupo.videos.length; k++) assert.ok(grupo.videos[k - 1].minuto <= grupo.videos[k].minuto);
    }
  }
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
