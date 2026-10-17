// 💰 Cobrança pelo celular e ⏰ lembrete do dia (v19.2). Rodar: node tests/backend/cobranca-lembrete.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { criarGruposApi } from '../../backend/grupos-api.js';
import { criarCadastroMemoria } from '../../backend/cadastro-grupos-memoria.js';
import { cobrarPagamento, lembreteDoDia } from '../../backend/avisos-push.js';
import { inscreverPush } from '../../backend/notificacoes.js';

const DATA = '2026-10-20'; // terça
const ck = (id, jogador, ordem, jogo = 1) => ({ id, data: DATA, jogador_id: jogador, jogador_nome: jogador, estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo, ordem });
const conta = (email, jogador) => ({ email, nome: email, perfil: 'jogador', jogador_id: jogador, jogador_id_pendente: null, criado_em: '2026-09-01T10:00:00+00:00' });

// 2 vagas: p1 e p2 dentro, p3 na reserva. p1, p2 e p3 têm conta + aparelho; p4 tem conta sem aparelho
function ambiente({ agora = '2026-10-20T19:00:00.000Z', config = {}, checkins } = {}) {
  const cfg = { checkinDataAberta: DATA, checkinVagas: '2', checkinHorario: '20:00', checkinTravado: 'FALSE', ...config };
  const repo = criarRepoMemoria({
    jogadores: ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ id, nome: id, convidado: false, removido: false, ordem: i + 1 })),
    checkins: checkins || [ck('c1', 'p1', 1), ck('c2', 'p2', 2), ck('c3', 'p3', 3)],
    config: Object.entries(cfg).map(([chave, valor]) => ({ chave, valor })),
    usuarios: ['p1', 'p2', 'p3', 'p4'].map((id) => conta(id + '@x.com', id))
  });
  const enviados = [];
  let relogio = new Date(agora);
  const d = {
    repo, relogio: () => relogio, gerarId: (() => { let n = 0; return () => 'id-' + (++n); })(), avisos: [],
    enviarPush: async (insc, payload) => { enviados.push({ para: insc.email, ...JSON.parse(payload) }); },
    em: (iso) => { relogio = new Date(iso); }
  };
  d.avisar = (m) => d.avisos.push(m);
  return { d, enviados, inscrever: async () => { for (const id of ['p1', 'p2', 'p3']) await inscreverPush(d, { endpoint: 'https://p/' + id, keys: { p256dh: 'k', auth: 'a' } }, id + '@x.com'); } };
}

// ------------------------------------------------------------------------------------------------ cobrança
await ta('cobrança: avisa quem tem aparelho e devolve quem precisa ser cobrado à mão', async () => {
  const { d, enviados, inscrever } = ambiente({ checkins: [ck('c1', 'p1', 1), ck('c2', 'p2', 2), ck('c4', 'p4', 3)] });
  await inscrever();
  const r = await cobrarPagamento(d, { data: DATA, jogadorIds: ['p1', 'p4'], valor: 'R$ 15,00', pix: 'chave@pix.com' });
  assert.deepEqual(r, { status: 'ok', alcancados: ['p1'], semAparelho: ['p4'] });
  assert.deepEqual(enviados.map((e) => e.para), ['p1@x.com']);
  assert.equal(enviados[0].titulo, '💰 Falta pagar o vôlei');
  assert.equal(enviados[0].corpo, 'Vôlei de terça (20/10): R$ 15,00. Pix: chave@pix.com. Se já pagou, é só avisar o organizador.');
});

await ta('cobrança: ignora quem não está no check-in do dia; lista vazia ou data ruim dá erro', async () => {
  const { d, enviados, inscrever } = ambiente();
  await inscrever();
  assert.equal((await cobrarPagamento(d, { data: DATA, jogadorIds: ['p4'] })).error, 'Ninguém dessa lista está no check-in desse dia.');
  assert.equal((await cobrarPagamento(d, { data: DATA, jogadorIds: [] })).error, 'Ninguém para cobrar.');
  assert.equal((await cobrarPagamento(d, { data: '20/10', jogadorIds: ['p1'] })).error, 'Data inválida.');
  const r = await cobrarPagamento(d, { data: DATA, jogadorIds: ['p2', 'p4', 'p2'] }); // repetido conta uma vez
  assert.deepEqual(r.alcancados, ['p2']);
  assert.deepEqual(r.semAparelho, []);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].corpo, 'Vôlei de terça (20/10). Se já pagou, é só avisar o organizador.'); // sem valor/pix
});

await ta('cobrança: só organizador/admin (passa pelo porteiro)', async () => {
  const { d } = ambiente();
  const h = criarHandler({ repo: d.repo, relogio: d.relogio, enviarPush: d.enviarPush, verificarToken: async (t) => ({ ok: true, email: t, nome: t }) });
  assert.match((await h.post({ action: 'cobrarPagamento', idToken: 'p1@x.com', data: DATA, jogadorIds: ['p2'] })).error, /não tem permissão/);
});

// ------------------------------------------------------------------------------------------------ lembrete
await ta('lembrete: na janela (3h antes), avisa UMA vez só quem está dentro das vagas', async () => {
  const { d, enviados, inscrever } = ambiente({ agora: '2026-10-20T20:00:00.000Z' }); // 17h em Brasília, jogo às 20h
  await inscrever();
  assert.deepEqual(await lembreteDoDia(d), { status: 'ok', lembretes: 1 });
  assert.deepEqual(enviados.map((e) => e.para).sort(), ['p1@x.com', 'p2@x.com']); // p3 está na reserva
  assert.equal(enviados[0].titulo, '⏰ Hoje tem vôlei às 20:00!');
  d.em('2026-10-20T20:15:00.000Z');
  assert.deepEqual(await lembreteDoDia(d), { status: 'ok', lembretes: 0 }); // não repete
  assert.equal(enviados.length, 2);
});

await ta('lembrete: fora da janela não faz nada (cedo demais, depois do jogo, outro dia)', async () => {
  const { d, enviados, inscrever } = ambiente({ agora: '2026-10-20T19:59:00.000Z' }); // 16:59: 3h01 antes
  await inscrever();
  assert.equal((await lembreteDoDia(d)).lembretes, 0);
  d.em('2026-10-20T23:00:00.000Z'); // 20h em ponto: o jogo começou
  assert.equal((await lembreteDoDia(d)).lembretes, 0);
  d.em('2026-10-19T21:00:00.000Z'); // véspera
  assert.equal((await lembreteDoDia(d)).lembretes, 0);
  assert.equal(enviados.length, 0);
});

await ta('lembrete: sem check-in aberto, nada', async () => {
  const { d, enviados, inscrever } = ambiente({ agora: '2026-10-20T20:00:00.000Z', config: { checkinDataAberta: '' } });
  await inscrever();
  assert.deepEqual(await lembreteDoDia(d), { status: 'ok', lembretes: 0 });
  assert.equal(enviados.length, 0);
});

await ta('lembrete: dois jogos no dia, cada um na sua janela, cada um uma vez', async () => {
  const { d, enviados, inscrever } = ambiente({
    agora: '2026-10-20T20:00:00.000Z', // 17h: janela do jogo das 20h; o das 22h abre às 19h
    config: { checkinJogo2Data: DATA, checkinJogo2Horario: '22:00', checkinJogo2Vagas: '5' },
    checkins: [ck('c1', 'p1', 1), ck('c3', 'p3', 2, 2)]
  });
  await inscrever();
  assert.equal((await lembreteDoDia(d)).lembretes, 1);
  assert.deepEqual(enviados.map((e) => e.para), ['p1@x.com']);
  d.em('2026-10-20T22:30:00.000Z'); // 19h30: janela do 2º jogo
  assert.equal((await lembreteDoDia(d)).lembretes, 1);
  assert.deepEqual(enviados.map((e) => e.para), ['p1@x.com', 'p3@x.com']);
  assert.equal(enviados[1].titulo, '⏰ Hoje tem vôlei às 22:00!');
  d.em('2026-10-20T22:45:00.000Z');
  assert.equal((await lembreteDoDia(d)).lembretes, 0);
});

await ta('lembrete pelo handler: público (o agendador não loga)', async () => {
  const { d, enviados, inscrever } = ambiente({ agora: '2026-10-20T21:00:00.000Z' });
  await inscrever();
  const h = criarHandler({ repo: d.repo, relogio: d.relogio, enviarPush: d.enviarPush });
  assert.deepEqual(await h.post({ action: 'lembreteDoDia' }), { status: 'ok', lembretes: 1 });
  assert.equal(enviados.length, 2);
});

await ta('grupos: "lembretesAgendados" passa por todos os grupos ativos e tem limite por hora', async () => {
  const chamados = [];
  const cadastro = criarCadastroMemoria({ grupos: [
    { id: 'g1', apelido: 'um', nome: 'Um' }, { id: 'g2', apelido: 'dois', nome: 'Dois' }, { id: 'g3', apelido: 'tres', nome: 'Três', status: 'suspenso' }
  ] });
  const api = criarGruposApi({
    cadastro, relogio: () => new Date('2026-10-20T20:00:00.000Z'), enviarPush: async () => {},
    criarRepoDoGrupo: (id) => { chamados.push(id); return criarRepoMemoria({}); }
  });
  const r = await api.post({ action: 'lembretesAgendados' });
  assert.deepEqual(r, { status: 'ok', grupos: 2, lembretes: 0 });
  assert.deepEqual([...new Set(chamados)].sort(), ['g1', 'g2']); // o suspenso fica de fora
  for (let i = 0; i < 11; i++) await api.post({ action: 'lembretesAgendados' });
  assert.ok((await api.post({ action: 'lembretesAgendados' })).error); // 13ª na mesma hora
});

fim();
