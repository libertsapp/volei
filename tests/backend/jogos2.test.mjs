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

fim();
