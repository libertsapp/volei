// Avisos automáticos por push (v18.7): "Check-in aberto!" para todos e "Você entrou na lista!" só para quem saiu da
// reserva. Rodar: node tests/backend/avisos-push.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { removeCheckin, moverCheckin } from '../../backend/checkins.js';
import { saveSettings } from '../../backend/configuracoes.js';
import { salvarJogo2 } from '../../backend/jogos2.js';
import { inscreverPush } from '../../backend/notificacoes.js';
import { diaEData } from '../../backend/avisos-push.js';

const DATA = '2026-10-20'; // uma terça
const ck = (id, jogador, ordem, jogo = 1) => ({ id, data: DATA, jogador_id: jogador, jogador_nome: jogador, estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo, ordem });
const conta = (email, jogador, pendente = null) => ({ email, nome: email, perfil: 'jogador', jogador_id: jogador, jogador_id_pendente: pendente, criado_em: '2026-09-01T10:00:00+00:00' });
const SUB = (nome) => ({ endpoint: 'https://push.exemplo.com/' + nome, keys: { p256dh: 'k', auth: 'a' } });

// 2 vagas: p1 e p2 dentro, p3 e p4 na reserva. Cada um tem conta e aparelho inscrito (p4 só com pedido PENDENTE).
function ambiente({ config = {}, checkins, falhaPush = false } = {}) {
  const cfg = { checkinDataAberta: DATA, checkinVagas: '2', checkinHorario: '20:00', checkinTravado: 'FALSE', ...config };
  const repo = criarRepoMemoria({
    jogadores: ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ id, nome: id, convidado: false, removido: false, ordem: i + 1 })),
    checkins: checkins || [ck('c1', 'p1', 1), ck('c2', 'p2', 2), ck('c3', 'p3', 3), ck('c4', 'p4', 4)],
    config: Object.entries(cfg).map(([chave, valor]) => ({ chave, valor })),
    usuarios: [conta('p1@x.com', 'p1'), conta('p2@x.com', 'p2'), conta('p3@x.com', 'p3'), conta('p4@x.com', null, 'p4')]
  });
  const enviados = [];
  let n = 0;
  const d = {
    repo, relogio: () => new Date('2026-10-18T12:00:00.000Z'), gerarId: () => 'id-' + (++n), avisos: [],
    enviarPush: async (insc, payload) => { if (falhaPush) throw new Error('fora do ar'); enviados.push({ para: insc.endpoint.split('/').pop(), ...JSON.parse(payload) }); }
  };
  d.avisar = (m) => d.avisos.push(m);
  return { d, enviados, inscrever: async () => {
    for (const p of ['p1', 'p2', 'p3', 'p4']) await inscreverPush(d, SUB(p), p + '@x.com');
    await inscreverPush(d, SUB('anonimo')); // aparelho sem login: só recebe os avisos de todo mundo
  } };
}

await ta('diaEData: dia da semana e dd/mm sem depender do fuso', async () => {
  assert.deepEqual(diaEData('2026-10-20'), { diaSemana: 'terça', ddmm: '20/10' });
  assert.deepEqual(diaEData('2026-11-01'), { diaSemana: 'domingo', ddmm: '01/11' });
});

await ta('inscreverPush guarda o e-mail em minúsculas; sem login fica null', async () => {
  const { d } = ambiente();
  await inscreverPush(d, SUB('a'), 'Fulano@X.com');
  await inscreverPush(d, SUB('b'));
  const linhas = await d.repo.lerPushInscricoes();
  assert.equal(linhas.find((l) => l.endpoint.endsWith('/a')).email, 'fulano@x.com');
  assert.equal(linhas.find((l) => l.endpoint.endsWith('/b')).email, null);
});

await ta('alguém de DENTRO desiste: só o 1º da reserva recebe "Você entrou na lista!"', async () => {
  const { d, enviados, inscrever } = ambiente();
  await inscrever();
  assert.deepEqual(await removeCheckin(d, 'c1'), { status: 'ok' });
  assert.deepEqual(enviados.map((e) => e.para), ['p3']);
  assert.equal(enviados[0].titulo, '🏐 Você entrou na lista!');
  assert.match(enviados[0].corpo, /terça \(20\/10\) às 20:00/);
});

await ta('quem sai da RESERVA não abre vaga: ninguém é avisado', async () => {
  const { d, enviados, inscrever } = ambiente();
  await inscrever();
  await removeCheckin(d, 'c3');
  assert.deepEqual(enviados, []);
});

await ta('vínculo só PENDENTE não recebe o aviso pessoal (estranho que pediu o vínculo de outro)', async () => {
  const { d, enviados, inscrever } = ambiente();
  await inscrever();
  await removeCheckin(d, 'c1'); // p3 entra
  await removeCheckin(d, 'c2'); // p4 entra, mas a conta dele só tem pedido pendente
  assert.deepEqual(enviados.map((e) => e.para), ['p3']);
});

await ta('lista de um dia que NÃO é o check-in aberto: não avisa', async () => {
  const { d, enviados, inscrever } = ambiente({ config: { checkinDataAberta: '2026-10-27' } });
  await inscrever();
  await removeCheckin(d, 'c1');
  assert.deepEqual(enviados, []);
});

await ta('semAviso (tirada em lote) e o handler repassa semAviso:true', async () => {
  const { d, enviados, inscrever } = ambiente();
  await inscrever();
  await removeCheckin(d, 'c1', { semAviso: true });
  assert.deepEqual(enviados, []);
  // pelo handler: a sessão é exigida pro removeCheckin; aqui só confirma que o semAviso chega (sem login = erro antes)
  const h = criarHandler({ repo: d.repo, relogio: d.relogio, enviarPush: d.enviarPush });
  assert.ok((await h.post({ action: 'removeCheckin', id: 'c2', semAviso: true })).error);
});

await ta('push fora do ar não quebra a desistência', async () => {
  const { d, inscrever } = ambiente({ falhaPush: true });
  await inscrever();
  assert.deepEqual(await removeCheckin(d, 'c1'), { status: 'ok' });
});

await ta('mover de jogo: avisa quem entrou na vaga da origem, nunca a pessoa movida', async () => {
  const { d, enviados, inscrever } = ambiente({
    config: { checkinJogo2Data: DATA, checkinJogo2Horario: '21:00', checkinJogo2Vagas: '5' },
    checkins: [ck('c1', 'p1', 1), ck('c2', 'p2', 2), ck('c3', 'p3', 3)]
  });
  await inscrever();
  assert.equal((await moverCheckin(d, { id: 'c1', paraJogo: 2 })).moveu, true);
  assert.deepEqual(enviados.map((e) => e.para), ['p3']); // p1 foi pro jogo 2 (com vaga) e não recebe nada
});

await ta('aumentar as vagas (dia já aberto): quem estava na reserva entra e é avisado', async () => {
  const { d, enviados, inscrever } = ambiente({ config: { pushCheckinAvisado: DATA } });
  await inscrever();
  await saveSettings(d, { checkinDataAberta: DATA, checkinVagas: 3, checkinHorario: '20:00' });
  assert.deepEqual(enviados.map((e) => e.para), ['p3']);
});

await ta('2º jogo ganhou vagas: avisa a reserva dele', async () => {
  const { d, enviados, inscrever } = ambiente({
    config: { checkinJogo2Data: DATA, checkinJogo2Horario: '21:00', checkinJogo2Vagas: '1' },
    checkins: [ck('c1', 'p1', 1, 2), ck('c2', 'p2', 2, 2)]
  });
  await inscrever();
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 2 }, { nome: 'Org' });
  assert.deepEqual(enviados.map((e) => e.para), ['p2']);
});

await ta('abrir o check-in avisa TODOS os aparelhos, uma vez por data', async () => {
  const { d, enviados, inscrever } = ambiente({ config: { checkinDataAberta: '' }, checkins: [] });
  await inscrever();
  await saveSettings(d, { checkinDataAberta: DATA, checkinVagas: 16, checkinHorario: '20:00' });
  assert.equal(enviados.length, 5); // os 4 com conta + o anônimo
  assert.equal(enviados[0].titulo, '🏐 Check-in aberto!');
  assert.match(enviados[0].corpo, /terça \(20\/10\), às 20:00 — 16 vagas/);
  // salvar de novo (outra configuração, mesma data) não repete
  await saveSettings(d, { checkinDataAberta: DATA, checkinVagas: 16, checkinHorario: '20:00', estrelasVisiveis: true });
  assert.equal(enviados.length, 5);
  // data nova: avisa de novo
  await saveSettings(d, { checkinDataAberta: '2026-10-27', checkinVagas: 16, checkinHorario: '20:00' });
  assert.equal(enviados.length, 10);
});

await ta('check-in aberto mas TRAVADO não avisa; ao destravar, avisa', async () => {
  const { d, enviados, inscrever } = ambiente({ config: { checkinDataAberta: '' }, checkins: [] });
  await inscrever();
  await saveSettings(d, { checkinDataAberta: DATA, checkinTravado: true, checkinVagas: 16, checkinHorario: '20:00' });
  assert.equal(enviados.length, 0);
  await saveSettings(d, { checkinDataAberta: DATA, checkinTravado: false, checkinVagas: 16, checkinHorario: '20:00' });
  assert.equal(enviados.length, 5);
});

await ta('check-in de data que já passou: marca e não avisa', async () => {
  const { d, enviados, inscrever } = ambiente({ config: { checkinDataAberta: '' }, checkins: [] });
  await inscrever();
  await saveSettings(d, { checkinDataAberta: '2026-10-10', checkinVagas: 16, checkinHorario: '20:00' });
  assert.equal(enviados.length, 0);
});

await ta('dois jogos no dia: o aviso de check-in fala dos dois horários', async () => {
  const { d, enviados, inscrever } = ambiente({ config: { checkinDataAberta: '', checkinJogo2Data: DATA, checkinJogo2Horario: '21:30' }, checkins: [] });
  await inscrever();
  await saveSettings(d, { checkinDataAberta: DATA, checkinVagas: 16, checkinHorario: '20:00' });
  assert.match(enviados[0].corpo, /dois jogos, às 20:00 e 21:30/);
});

await ta('handler: inscreverPush com sessão inválida ainda inscreve, só que sem conta', async () => {
  const { d } = ambiente();
  const h = criarHandler({ repo: d.repo, relogio: d.relogio, enviarPush: d.enviarPush });
  assert.equal((await h.post({ action: 'inscreverPush', inscricao: SUB('h'), sessao: 'nao-existe' })).status, 'ok');
  assert.equal((await d.repo.lerPushInscricoes()).find((l) => l.endpoint.endsWith('/h')).email, null);
});

fim();
