import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';

const base = () => ({
  checkins: [
    { id: 'c1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 4, sexo: 'F', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
    { id: 'c2', data: '2026-10-06', jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 2, ordem: 1 },
    { id: 'c3', data: '2026-10-06', jogador_id: 'p3', jogador_nome: 'Caio', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 1, ordem: 2 }
  ],
  fin_dias: [{ data: '2026-10-06', valor_pessoa: 15, pix: '', valor_quadra: 300, tem_brinde: false, valor_brinde: 0, status: 'normal', por_jogo: true, ordem: 1 }]
});

await ta('gravarFinJogo: insere e, numa segunda chamada, só atualiza os campos enviados (upsert por data+jogo)', async () => {
  const repo = criarRepoMemoria(base());
  await repo.gravarFinJogo({ data: '2026-10-06', jogo: 2, valor_pessoa: 15, pix: 'k', valor_quadra: 180, tem_brinde: false, valor_brinde: 0, icone: '✅', atualizado_por: 'Org', atualizado_em: 'x' });
  let t = await repo.lerTudo();
  assert.equal(t.fin_jogos.length, 1);
  assert.deepEqual({ v: t.fin_jogos[0].valor_pessoa, s: t.fin_jogos[0].status }, { v: 15, s: 'normal' });
  await repo.gravarFinJogo({ data: '2026-10-06', jogo: 2, valor_pessoa: 20 });
  t = await repo.lerTudo();
  assert.equal(t.fin_jogos.length, 1);
  assert.deepEqual({ v: t.fin_jogos[0].valor_pessoa, pix: t.fin_jogos[0].pix }, { v: 20, pix: 'k' }); // só o campo enviado mudou
});

await ta('definirStatusFinJogo: muda o status de uma linha existente; false se não existe', async () => {
  const repo = criarRepoMemoria(base());
  assert.equal(await repo.definirStatusFinJogo('2026-10-06', 2, 'semjogo'), false); // ainda não existe
  await repo.gravarFinJogo({ data: '2026-10-06', jogo: 2, status: 'normal' });
  assert.equal(await repo.definirStatusFinJogo('2026-10-06', 2, 'semjogo'), true);
  const t = await repo.lerTudo();
  assert.equal(t.fin_jogos[0].status, 'semjogo');
});

await ta('moverCheckinDeJogo: muda o jogo e vai pro fim da fila do destino; false se não existe ou já está lá', async () => {
  const repo = criarRepoMemoria(base());
  assert.equal(await repo.moverCheckinDeJogo('nao-existe', 2), false);
  assert.equal(await repo.moverCheckinDeJogo('c1', 2), true);
  let t = await repo.lerTudo();
  const movido = t.checkins.find((c) => c.id === 'c1');
  assert.equal(movido.jogo, 2);
  assert.equal(movido.ordem, 2); // fim da fila do jogo 2 (que já tinha ordem 1)
  assert.equal(await repo.moverCheckinDeJogo('c1', 2), false); // já está lá
});

await ta('moverJogo2ParaJogo1: descarta quem já está no 1, move o resto pro fim, na ordem; devolve quantos moveu', async () => {
  const dados = base();
  dados.checkins.push({ id: 'c4', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 4, sexo: 'F', estrelas_ajustadas: null, jogo: 2, ordem: 2 }); // Ana também no jogo 2: descarta
  dados.checkins.push({ id: 'c5', data: '2026-10-06', jogador_id: 'p4', jogador_nome: 'Duda', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 2, ordem: 3 });
  const repo = criarRepoMemoria(dados);
  const n = await repo.moverJogo2ParaJogo1('2026-10-06');
  assert.equal(n, 2); // Bruno (c2) e Duda (c5); Ana (c4) foi descartada
  const t = await repo.lerTudo();
  assert.equal(t.checkins.length, 4); // c1, c2, c3, c5 (c4 descartada)
  assert.ok(!t.checkins.some((c) => c.id === 'c4'));
  const noJogo1 = t.checkins.filter((c) => c.jogo === 1).sort((a, b) => a.ordem - b.ordem);
  assert.deepEqual(noJogo1.map((c) => c.id), ['c1', 'c3', 'c2', 'c5']); // na ordem em que chegaram
});

fim();
