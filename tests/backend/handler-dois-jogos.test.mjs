// tests/backend/handler-dois-jogos.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const DATA = '2026-10-06';
// addCheckin/removeCheckin sempre exigem identificação (sessão ou token do Google; a chave mestra sozinha não
// vale, como no .gs) — mock de verificarToken só para o check-in da Ana no teste de fluxo completo abaixo.
const verificarToken = async (t) => (t === 'tok-ana' ? { ok: true, email: 'ana@teste.com', nome: 'Ana' } : { ok: false, erro: 'inválido' });
function handler(extra) {
  return criarHandler({
    repo: criarRepoMemoria({
      jogadores: [{ id: 'p1', nome: 'Ana', convidado: false, removido: false, ordem: 1 }],
      config: [{ chave: 'checkinDataAberta', valor: DATA }, { chave: 'checkinHorario', valor: '19:00' }, { chave: 'checkinVagas', valor: '16' }],
      checkins: [], fin_dias: [], fin_jogos: [], fin_pagamentos: [],
      ...extra
    }),
    config: { adminPassword: 'senha-teste' },
    verificarToken,
    relogio: () => new Date('2026-10-06T12:00:00.000Z')
  });
}
const pingAdmin = { action: 'ping', senha: 'senha-teste' };

await ta('salvarJogo2/removerJogo2/moverCheckin exigem organizador/admin (recusa jogador)', async () => {
  const h = handler();
  const semPerfil = await h.post({ action: 'salvarJogo2', jogo2: { data: DATA, horario: '21:00', vagas: 12 } });
  assert.ok(semPerfil.error);
});

await ta('fluxo completo: criar o 2º jogo, confirmar presença nos dois, mover um, GET reflete tudo', async () => {
  const h = handler();
  assert.deepEqual(await h.post({ ...pingAdmin, action: 'salvarJogo2', jogo2: { data: DATA, horario: '21:00', vagas: 12 } }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'addCheckin', idToken: 'tok-ana', checkin: { id: 'c1', data: DATA, jogadorId: 'p1', jogo: 1 } }), { status: 'ok' });
  const mov = await h.post({ ...pingAdmin, action: 'moverCheckin', id: 'c1', paraJogo: 2 });
  assert.deepEqual(mov, { status: 'ok', moveu: true });
  const get = await h.get();
  assert.equal(get.settings.checkinJogo2.horario, '21:00');
  assert.equal(get.checkins.find((c) => c.id === 'c1').jogo, 2);
});

await ta('financeiro: jogo no corpo do POST vira a chave certa (1/2/null)', async () => {
  const h = handler({ checkins: [{ id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 }] });
  await h.post({ ...pingAdmin, action: 'salvarJogo2', jogo2: { data: DATA, horario: '21:00', vagas: 12 } });
  await h.post({ ...pingAdmin, action: 'salvarFinDia', dia: { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true } });
  await h.post({ ...pingAdmin, action: 'salvarFinDia', dia: { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: '' } });
  const r = await h.post({ ...pingAdmin, action: 'marcarPagamento', data: DATA, jogo: 1, jogadorId: 'p1', jogadorNome: 'Ana' });
  assert.equal(r.financeiro.pagamentos[0].jogo, 1);
  assert.equal(r.financeiro.pagamentos[0].valor, 15);
});

fim();
