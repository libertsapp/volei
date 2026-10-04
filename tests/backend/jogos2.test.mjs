// tests/backend/jogos2.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { saveSettings } from '../../backend/configuracoes.js';
import { salvarJogo2, removerJogo2 } from '../../backend/jogos2.js';
import { mapearConfig, mapearCheckins } from '../../backend/mapeadores.js';

const ORG = { perfil: 'organizador', nome: 'Org', email: 'o@x.com', viaChaveMestra: false };
const DATA = '2026-10-06';

function ambiente(extra) {
  return {
    repo: criarRepoMemoria({
      config: [{ chave: 'checkinDataAberta', valor: DATA }, { chave: 'checkinHorario', valor: '19:00' }, { chave: 'checkinVagas', valor: '16' }],
      checkins: [], fin_dias: [], fin_jogos: [], fin_pagamentos: [],
      ...extra
    }),
    relogio: () => new Date('2026-10-06T12:00:00.000Z')
  };
}
const cfg = async (d) => mapearConfig(await d.repo.lerConfig());

await ta('salvarJogo2: cria com sucesso; recusa data fechada, horário igual, vagas inválidas', async () => {
  const d = ambiente();
  assert.deepEqual(await salvarJogo2(d, { data: '2026-10-13', horario: '21:00', vagas: 12 }, ORG),
    { error: 'Abra o check-in para essa data antes de adicionar o 2º jogo.' });
  assert.deepEqual(await salvarJogo2(d, { data: DATA, horario: '19:00', vagas: 12 }, ORG), { error: 'Os dois jogos não podem ter o mesmo horário.' });
  assert.deepEqual(await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 0 }, ORG), { error: 'Vagas precisam ser maior que zero.' });
  assert.deepEqual(await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG), { status: 'ok' });
  assert.deepEqual((await cfg(d)).checkinJogo2, { data: DATA, horario: '21:00', vagas: 12, travado: false });
});

await ta('saveSettings: recusa deixar o horário do jogo 1 igual ao do jogo 2 já configurado', async () => {
  const d = ambiente();
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  const r = await saveSettings(d, { checkinDataAberta: DATA, checkinHorario: '21:00', checkinVagas: 16, estrelasVisiveis: true, checkinTravado: false });
  assert.deepEqual(r, { error: 'Os dois jogos não podem ter o mesmo horário.' });
  assert.equal((await cfg(d)).checkinHorario, '19:00'); // não gravou nada
});

await ta('saveSettings: "trocar data" com o check-in já aberto leva o jogo 2 junto pra data nova (spec D-trocar-data)', async () => {
  const d = ambiente();
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  const novaData = '2026-10-07';
  const r = await saveSettings(d, { checkinDataAberta: novaData, checkinHorario: '19:00', checkinVagas: 16, estrelasVisiveis: true, checkinTravado: false });
  assert.deepEqual(r, { status: 'ok' });
  assert.deepEqual((await cfg(d)).checkinJogo2, { data: novaData, horario: '21:00', vagas: 12, travado: false });
});

await ta('saveSettings: abrir uma data NOVA do zero (sem check-in aberto antes) NÃO leva jogo 2 de uma data antiga diferente', async () => {
  const DATA_ANTIGA = '2026-09-22';
  // check-in fechado (checkinDataAberta vazio); jogo 2 ficou "guardado" numa data antiga, de uma semana passada
  const d = ambiente({ config: [{ chave: 'checkinDataAberta', valor: '' }, { chave: 'checkinHorario', valor: '19:00' }, { chave: 'checkinVagas', valor: '16' },
    { chave: 'checkinJogo2Data', valor: DATA_ANTIGA }, { chave: 'checkinJogo2Horario', valor: '21:00' }, { chave: 'checkinJogo2Vagas', valor: '12' }] });
  const r = await saveSettings(d, { checkinDataAberta: DATA, checkinHorario: '19:00', checkinVagas: 16, estrelasVisiveis: true, checkinTravado: false });
  assert.deepEqual(r, { status: 'ok' });
  // o jogo 2 continua preso na DATA_ANTIGA (não foi "levado" pra DATA) — abrir do zero não carrega jogo 2 nenhum
  assert.equal((await cfg(d)).checkinJogo2.data, DATA_ANTIGA);
});

await ta('removerJogo2: "mover" leva a lista pro jogo 1 e some com o 2º jogo', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
    { id: 'c2', data: DATA, jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 2, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  assert.deepEqual(await removerJogo2(d, { data: DATA, destino: 'mover' }, ORG), { status: 'ok' });
  assert.equal((await cfg(d)).checkinJogo2, null);
  const lista = mapearCheckins((await d.repo.lerTudo()).checkins);
  assert.deepEqual(lista.map((c) => [c.jogadorId, c.jogo]), [['p1', 1], ['p2', 1]]);
});

await ta('removerJogo2: "desconfirmar" apaga os check-ins do jogo 2', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
    { id: 'c2', data: DATA, jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 2, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await removerJogo2(d, { data: DATA, destino: 'desconfirmar' }, ORG);
  const lista = mapearCheckins((await d.repo.lerTudo()).checkins);
  assert.deepEqual(lista.map((c) => c.jogadorId), ['p1']);
});

await ta('removerJogo2: bloqueado com pagamento válido amarrado só ao jogo 2 (modo separado)', async () => {
  const d = ambiente();
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await d.repo.gravarFinDia({ data: DATA, valor_pessoa: 15, pix: '', valor_quadra: 300, tem_brinde: false, valor_brinde: 0, status: 'normal', por_jogo: true });
  await d.repo.inserirFinPagamento({ id: 'pg1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, marcado_por: 'Org', marcado_em: 'x', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, jogo: 2 });
  const r = await removerJogo2(d, { data: DATA, destino: 'mover' }, ORG);
  assert.match(r.error, /pagamento/);
});

await ta('removerJogo2 com manter:2 — "trocar os papéis": jogo 1 vira a config do jogo 2', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await removerJogo2(d, { data: DATA, destino: 'mover', manter: 2 }, ORG);
  const c = await cfg(d);
  assert.deepEqual({ h: c.checkinHorario, v: c.checkinVagas, j2: c.checkinJogo2 }, { h: '21:00', v: 12, j2: null });
});

// --- achados da revisão final (branch inteira) — C2, C3 ---

await ta('removerJogo2 com manter:2 + "mover": a fila do jogo MANTIDO (2) vem primeiro; a do REMOVIDO (1) entra no fim', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
    { id: 'c2', data: DATA, jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 2 },
    { id: 'c3', data: DATA, jogador_id: 'p3', jogador_nome: 'Caio', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 2, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  assert.deepEqual(await removerJogo2(d, { data: DATA, destino: 'mover', manter: 2 }, ORG), { status: 'ok' });
  const lista = mapearCheckins((await d.repo.lerTudo()).checkins); // já vem ordenado por "ordem" (porOrdem)
  // Caio (único do jogo mantido) fica em 1º; Ana e Bruno (do jogo removido) entram DEPOIS, na ordem em que já estavam
  assert.deepEqual(lista.map((c) => c.jogadorId), ['p3', 'p1', 'p2']);
  assert.ok(lista.every((c) => c.jogo === 1), 'todo mundo tem que acabar no jogo 1 (a config sobrevivente)');
});

await ta('removerJogo2 com manter:2 + "desconfirmar": apaga quem estava no jogo REMOVIDO (1), não no mantido (2)', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
    { id: 'c2', data: DATA, jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 2, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await removerJogo2(d, { data: DATA, destino: 'desconfirmar', manter: 2 }, ORG);
  const lista = mapearCheckins((await d.repo.lerTudo()).checkins);
  assert.deepEqual(lista.map((c) => c.jogadorId), ['p2']); // Bruno (jogo mantido) sobrevive; Ana (jogo removido) sai
});

await ta('removerJogo2 com manter:2: pagamento válido no jogo 1 (o removido) bloqueia — antes a checagem olhava sempre pro jogo 2', async () => {
  const d = ambiente();
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await d.repo.gravarFinDia({ data: DATA, valor_pessoa: 15, pix: '', valor_quadra: 300, tem_brinde: false, valor_brinde: 0, status: 'normal', por_jogo: true });
  await d.repo.inserirFinPagamento({ id: 'pg1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, marcado_por: 'Org', marcado_em: 'x', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, jogo: 1 });
  const r = await removerJogo2(d, { data: DATA, destino: 'mover', manter: 2 }, ORG);
  assert.match(r.error, /pagamento/);
});

await ta('removerJogo2: separado, jogo 1 pago, remove o jogo 2 (normal) — o pagamento some com chave null (não fica preso em jogo:1)', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 }
  ] });
  await salvarJogo2(d, { data: DATA, horario: '21:00', vagas: 12 }, ORG);
  await d.repo.gravarFinDia({ data: DATA, valor_pessoa: 15, pix: '', valor_quadra: 300, tem_brinde: false, valor_brinde: 0, status: 'normal', por_jogo: true });
  await d.repo.inserirFinPagamento({ id: 'pg1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', valor: 15, marcado_por: 'Org', marcado_em: '2026-10-06T12:00:00.000Z', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, jogo: 1 });
  assert.deepEqual(await removerJogo2(d, { data: DATA, destino: 'mover' }, ORG), { status: 'ok' }); // jogo 2 vazio: nada bloqueia
  const t = await d.repo.lerTudo();
  const pg = t.fin_pagamentos.find((p) => p.id === 'pg1');
  assert.equal(pg.jogo, null, 'o dia voltou a ser único: o pagamento tem que estar visível sob a chave null, não preso em jogo:1');
  assert.equal(t.fin_dias.find((x) => x.data === DATA).por_jogo, false);
});

fim();
