import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';

const repo = () => criarRepoMemoria(fixture);
const rodada = (extra = {}) => ({
  id: 'r9', data: '2026-09-30', rascunho: false,
  convidados: [{ id: 'convidado:LUCAS#zz01', nome: 'LUCAS' }],
  times: [
    { nome: 'Time 1', vitorias: 2, vencedor: true, playerIds: ['p2', 'p1', 'p2'] },
    { nome: 'Time 2', vitorias: 0, vencedor: false, playerIds: ['convidado:LUCAS#zz01'] }
  ],
  ...extra
});

await ta('inserirJogador: entra no fim com ordem do banco; id repetido falha', async () => {
  const r = repo();
  await r.inserirJogador({ id: 'p7', nome: 'Novo', apelido: null, foto: null, estrelas: 3, sexo: 'M', porte: null });
  const novo = (await r.lerJogadores()).find((j) => j.id === 'p7');
  assert.equal(novo.convidado, false);
  assert.equal(novo.removido, false);
  assert.equal(novo.ordem, 3); // o maior da fixture entre não nulos é 2
  await assert.rejects(() => r.inserirJogador({ id: 'p7', nome: 'Outro' }), /duplicate key/);
});

await ta('atualizarJogador: muda só os campos enviados; id inexistente falha', async () => {
  const r = repo();
  await r.atualizarJogador('p1', { nome: 'Ana Maria', removido: true });
  const p1 = (await r.lerJogadores()).find((j) => j.id === 'p1');
  assert.equal(p1.nome, 'Ana Maria');
  assert.equal(p1.removido, true);
  assert.equal(p1.estrelas, 4);
  await assert.rejects(() => r.atualizarJogador('nao-existe', { nome: 'x' }));
});

await ta('lerConfig/gravarConfig: atualiza chave existente e cria chave nova', async () => {
  const r = repo();
  await r.gravarConfig([{ chave: 'checkinVagas', valor: '20' }, { chave: 'estrelasVisiveis', valor: 'FALSE' }]);
  const c = await r.lerConfig();
  assert.equal(c.find((x) => x.chave === 'checkinVagas').valor, '20');
  assert.equal(c.find((x) => x.chave === 'estrelasVisiveis').valor, 'FALSE');
  assert.equal(c.find((x) => x.chave === 'contadorAcessos').valor, '41');
});

await ta('gravarRodada: cria rodada, times, jogadores por posição (id repetido vale o primeiro) e convidado sem ordem', async () => {
  const r = repo();
  await r.gravarRodada(rodada());
  const t = await r.lerTudo();
  const nova = t.rodadas.find((x) => x.round_id === 'r9');
  assert.deepEqual({ data: nova.data, rascunho: nova.rascunho, ordem: nova.ordem }, { data: '2026-09-30', rascunho: false, ordem: 3 });
  const times = t.times_rodada.filter((x) => x.round_id === 'r9').sort((a, b) => a.time_index - b.time_index);
  assert.deepEqual(times.map((x) => [x.time_index, x.time_nome, x.vitorias, x.vencedor]), [[0, 'Time 1', 2, true], [1, 'Time 2', 0, false]]);
  const doTime0 = t.time_jogadores.filter((x) => x.time_rodada_id === times[0].id).sort((a, b) => a.posicao - b.posicao);
  assert.deepEqual(doTime0.map((x) => [x.jogador_id, x.posicao]), [['p2', 0], ['p1', 1]]);
  const convidado = t.jogadores.find((j) => j.id === 'convidado:LUCAS#zz01');
  assert.deepEqual({ nome: convidado.nome, convidado: convidado.convidado, ordem: convidado.ordem }, { nome: 'LUCAS', convidado: true, ordem: null });
});

await ta('gravarRodada: substitui a rodada existente e ela vai para o fim da lista', async () => {
  const r = repo();
  await r.gravarRodada(rodada({ id: 'r1', data: '2026-09-01' }));
  const t = await r.lerTudo();
  assert.equal(t.rodadas.filter((x) => x.round_id === 'r1').length, 1);
  assert.equal(t.rodadas.find((x) => x.round_id === 'r1').ordem, 3);
  assert.equal(t.times_rodada.filter((x) => x.round_id === 'r1').length, 2);
});

await ta('gravarRodada: jogador que não existe recusa tudo e nada muda (como a chave estrangeira)', async () => {
  const r = repo();
  const antes = await r.lerTudo();
  await assert.rejects(() => r.gravarRodada(rodada({ times: [{ nome: 'T', vitorias: 0, vencedor: false, playerIds: ['nao-existe'] }] })), /foreign key/);
  assert.deepEqual(await r.lerTudo(), antes);
});

await ta('removerRodada: apaga rodada, times e jogadores; devolve se existia', async () => {
  const r = repo();
  assert.equal(await r.removerRodada('r1'), true);
  const t = await r.lerTudo();
  assert.equal(t.rodadas.some((x) => x.round_id === 'r1'), false);
  assert.equal(t.times_rodada.some((x) => x.round_id === 'r1'), false);
  assert.equal(t.time_jogadores.some((x) => x.time_rodada_id === 11 || x.time_rodada_id === 12), false);
  assert.equal(await r.removerRodada('r1'), false);
});

await ta('gravarUsuario: usuário novo sem ordem recebe a ordem do banco (máximo + 1)', async () => {
  const r = repo();
  await r.gravarUsuario({ email: 'n@exemplo.com', nome: 'N', perfil: 'jogador', jogador_id: null, criado_em: '2026-09-23T15:00:00.000Z', jogador_id_pendente: null });
  assert.equal((await r.lerUsuarios()).find((u) => u.email === 'n@exemplo.com').ordem, 4);
});

fim();
