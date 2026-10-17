// Faltas (v18.8): o organizador marca quem CONFIRMOU e não apareceu; a falta fica no check-in ("faltou").
// Rodar: node tests/backend/faltas.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { salvarFaltas, removeCheckin } from '../../backend/checkins.js';
import { mapearCheckins } from '../../backend/mapeadores.js';
import { PERMISSOES } from '../../backend/permissoes.js';

const DATA = '2026-10-13';
const ck = (id, jogador, ordem, jogo = 1, data = DATA) => ({ id, data, jogador_id: jogador, jogador_nome: jogador, estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo, ordem });
function ambiente() {
  const repo = criarRepoMemoria({
    jogadores: ['p1', 'p2', 'p3'].map((id, i) => ({ id, nome: id, convidado: false, removido: false, ordem: i + 1 })),
    checkins: [ck('c1', 'p1', 1), ck('c2', 'p2', 2), ck('c3', 'p3', 3, 2), ck('c4', 'p1', 4, 1, '2026-10-06')]
  });
  return { repo };
}
const faltas = async (d) => mapearCheckins((await d.repo.lerTudo()).checkins).filter((c) => c.faltou).map((c) => c.id);

await ta('marca e desmarca: a lista enviada é a lista COMPLETA daquele jogo', async () => {
  const d = ambiente();
  assert.deepEqual(await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: ['c1', 'c2'] }), { status: 'ok', alterados: 2 });
  assert.deepEqual(await faltas(d), ['c1', 'c2']);
  assert.deepEqual(await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: ['c2'] }), { status: 'ok', alterados: 1 }); // c1 desmarcado
  assert.deepEqual(await faltas(d), ['c2']);
  assert.deepEqual(await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: ['c2'] }), { status: 'ok', alterados: 0 }); // idempotente
});

await ta('só mexe no jogo e na data pedidos', async () => {
  const d = ambiente();
  await salvarFaltas(d, { data: DATA, jogo: 2, faltaram: ['c3'] });
  await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: [] }); // não desmarca o c3 (jogo 2) nem o dia 06/10
  assert.deepEqual(await faltas(d), ['c3']);
});

await ta('check-in de outro jogo/data na lista: recusa sem gravar nada', async () => {
  const d = ambiente();
  assert.ok((await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: ['c1', 'c3'] })).error);
  assert.ok((await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: ['c4'] })).error);
  assert.deepEqual(await faltas(d), []);
});

await ta('validações: data, jogo e lista', async () => {
  const d = ambiente();
  assert.equal((await salvarFaltas(d, { data: '13/10', faltaram: [] })).error, 'Data inválida.');
  assert.equal((await salvarFaltas(d, { data: DATA, jogo: 3, faltaram: [] })).error, 'Jogo inválido.');
  assert.equal((await salvarFaltas(d, { data: DATA })).error, 'Lista de faltas inválida.');
});

await ta('quem tem falta não consegue apagá-la tirando o nome da lista; sem falta, sai normalmente', async () => {
  const d = ambiente();
  await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: ['c1'] });
  assert.match((await removeCheckin(d, 'c1')).error, /falta registrada/);
  assert.deepEqual(await removeCheckin(d, 'c2'), { status: 'ok' });
  await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: [] });
  assert.deepEqual(await removeCheckin(d, 'c1'), { status: 'ok' });
});

await ta('GET: "faltou" só aparece quando é true (resposta de quem não faltou não muda)', async () => {
  const d = ambiente();
  await salvarFaltas(d, { data: DATA, jogo: 1, faltaram: ['c1'] });
  const lista = mapearCheckins((await d.repo.lerTudo()).checkins);
  assert.equal(lista.find((c) => c.id === 'c1').faltou, true);
  assert.equal('faltou' in lista.find((c) => c.id === 'c2'), false);
});

await ta('permissão: só organizador e admin', async () => {
  assert.deepEqual(PERMISSOES.salvarFaltas, ['organizador', 'admin']);
});

fim();
