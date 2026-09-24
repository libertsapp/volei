import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { addRound, updateRound, removeRound } from '../../backend/rodadas.js';
import { mapearRodadas } from '../../backend/mapeadores.js';

const deps = () => ({ repo: criarRepoMemoria(fixture) });
const rodadas = async (d) => { const t = await d.repo.lerTudo(); return mapearRodadas(t.rodadas, t.times_rodada, t.time_jogadores); };
const r9 = () => ({
  id: 'r9', data: '2026-09-30', rascunho: true, vencedores: [0, 1],
  times: [
    { nome: 'Time A', vitorias: 3, playerIds: ['p1', 'convidado:LUCAS#zz01'] },
    { nome: 'Time B', vitorias: '3', playerIds: ['p2', ''] }
  ]
});

await ta('addRound: cria a rodada no fim com times, vencedores (empate), rascunho e convidado novo', async () => {
  const d = deps();
  assert.deepEqual(await addRound(d, r9()), { status: 'ok' });
  const todas = await rodadas(d);
  assert.deepEqual(todas.map((r) => r.id), ['r1', 'r2', 'r9']);
  assert.deepEqual(todas[2], {
    id: 'r9', data: '2026-09-30', rascunho: true, vencedores: [0, 1],
    times: [{ nome: 'Time A', playerIds: ['p1', 'convidado:LUCAS#zz01'], vitorias: 3 }, { nome: 'Time B', playerIds: ['p2'], vitorias: 3 }]
  });
  const convidado = (await d.repo.lerJogadores()).find((j) => j.id === 'convidado:LUCAS#zz01');
  assert.deepEqual({ nome: convidado.nome, convidado: convidado.convidado }, { nome: 'LUCAS', convidado: true });
});

await ta('addRound: rodada sem times não deixa rastro (como no .gs)', async () => {
  const d = deps();
  assert.deepEqual(await addRound(d, { id: 'r8', data: '2026-09-30', times: [] }), { status: 'ok' });
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r1', 'r2']);
});

await ta('updateRound: troca o conteúdo e leva a rodada para o fim; id novo cria; sem times remove', async () => {
  const d = deps();
  assert.deepEqual(await updateRound(d, { id: 'r1', data: '2026-09-01', vencedores: [1], times: [{ nome: 'X', vitorias: 1, playerIds: ['p2'] }, { nome: 'Y', vitorias: 4, playerIds: ['p1'] }] }), { status: 'ok' });
  let todas = await rodadas(d);
  assert.deepEqual(todas.map((r) => r.id), ['r2', 'r1']);
  assert.deepEqual(todas[1].vencedores, [1]);
  assert.deepEqual(todas[1].times.map((t) => t.nome), ['X', 'Y']);
  await updateRound(d, { id: 'novo', data: '2026-10-01', times: [{ nome: 'Z', vitorias: 0, playerIds: [] }] });
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r2', 'r1', 'novo']);
  await updateRound(d, { id: 'r2', data: '2026-09-08', times: [] });
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r1', 'novo']);
});

await ta('removeRound: remove; repetir ou inexistente dá a mensagem do .gs', async () => {
  const d = deps();
  assert.deepEqual(await removeRound(d, 'r1'), { status: 'ok' });
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r2']);
  assert.deepEqual(await removeRound(d, 'r1'), { error: 'Rodada não encontrada (pode já ter sido removida por outra pessoa).' });
});

await ta('addRound com jogador inexistente: a falha vem do repositório e nada é gravado', async () => {
  const d = deps();
  await assert.rejects(() => addRound(d, { id: 'rx', data: '2026-09-30', times: [{ nome: 'T', vitorias: 0, playerIds: ['nao-existe'] }] }), /foreign key/);
  assert.deepEqual((await rodadas(d)).map((r) => r.id), ['r1', 'r2']);
});

fim();
