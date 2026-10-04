import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { addCheckin, moverCheckin } from '../../backend/checkins.js';
import { mapearCheckins } from '../../backend/mapeadores.js';

const ORG = { perfil: 'organizador', nome: 'Org', email: 'o@x.com', viaChaveMestra: false };

function ambiente(extra) {
  // config: quando extra.config é passado explicitamente, SUBSTITUI os padrões (não concatena) — é o único jeito
  // de o teste "sem checkinJogo2*" conseguir de fato remover esse jogo do ambiente
  const configPadrao = [
    { chave: 'checkinDataAberta', valor: '2026-10-06' }, { chave: 'checkinVagas', valor: '16' },
    { chave: 'checkinJogo2Data', valor: '2026-10-06' }, { chave: 'checkinJogo2Horario', valor: '21:00' }, { chave: 'checkinJogo2Vagas', valor: '12' }
  ];
  return {
    repo: criarRepoMemoria({
      jogadores: [{ id: 'p1', nome: 'Ana', convidado: false, removido: false, ordem: 1 }, { id: 'p2', nome: 'Bruno', convidado: false, removido: false, ordem: 2 }],
      config: extra?.config !== undefined ? extra.config : configPadrao,
      checkins: extra?.checkins || []
    }),
    relogio: () => new Date('2026-10-06T12:00:00.000Z')
  };
}
const lista = async (d) => mapearCheckins((await d.repo.lerTudo()).checkins);

await ta('addCheckin: jogo ausente grava 1; jogo 2 grava 2; jogo inválido dá erro', async () => {
  const d = ambiente();
  await addCheckin(d, { id: 'c1', data: '2026-10-06', jogadorId: 'p1' });
  await addCheckin(d, { id: 'c2', data: '2026-10-06', jogadorId: 'p2', jogo: 2 });
  const t = await lista(d);
  assert.deepEqual(t.map((c) => [c.id, c.jogo]), [['c1', 1], ['c2', 2]]);
  assert.deepEqual(await addCheckin(d, { id: 'c3', data: '2026-10-06', jogadorId: 'p1', jogo: 3 }), { error: 'Jogo inválido.' });
});

await ta('addCheckin: recusa jogo 2 quando a data não tem 2º jogo configurado', async () => {
  const d = ambiente({ config: [] }); // sem checkinJogo2*
  const r = await addCheckin(d, { id: 'c1', data: '2026-10-06', jogadorId: 'p1', jogo: 2 });
  assert.deepEqual(r, { error: 'Esse jogo não existe mais. Recarregue a página.' });
});

await ta('addCheckin: recusa a mesma pessoa duas vezes NO MESMO jogo; aceita nos dois jogos', async () => {
  const d = ambiente();
  await addCheckin(d, { id: 'c1', data: '2026-10-06', jogadorId: 'p1', jogo: 1 });
  assert.deepEqual(await addCheckin(d, { id: 'c2', data: '2026-10-06', jogadorId: 'p1', jogo: 1 }), { error: 'Essa pessoa já está na lista desse jogo.' });
  assert.deepEqual(await addCheckin(d, { id: 'c3', data: '2026-10-06', jogadorId: 'p1', jogo: 2 }), { status: 'ok' }); // outro jogo: pode
});

await ta('moverCheckin: move pro outro jogo; recusa se já está lá; recusa destino inexistente', async () => {
  const d = ambiente({ checkins: [
    { id: 'c1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 }
  ] });
  assert.deepEqual(await moverCheckin(d, { id: 'c1', paraJogo: 2 }, ORG), { status: 'ok', moveu: true });
  assert.equal((await lista(d))[0].jogo, 2);
  assert.deepEqual(await moverCheckin(d, { id: 'c1', paraJogo: 2 }, ORG), { status: 'ok', moveu: false }); // já estava lá
  assert.deepEqual(await moverCheckin(d, { id: 'nao-existe', paraJogo: 1 }, ORG), { error: 'Check-in não encontrado.' });
});

await ta('moverCheckin: recusa se o jogo de destino não existe (sem checkinJogo2 configurado)', async () => {
  const d = ambiente({ config: [{ chave: 'checkinDataAberta', valor: '2026-10-06' }, { chave: 'checkinVagas', valor: '16' }],
    checkins: [{ id: 'c1', data: '2026-10-06', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 0, sexo: '', estrelas_ajustadas: null, jogo: 1, ordem: 1 }] });
  assert.deepEqual(await moverCheckin(d, { id: 'c1', paraJogo: 2 }, ORG), { error: 'Esse jogo não existe mais. Recarregue a página.' });
  assert.equal((await lista(d))[0].jogo, 1); // continua no jogo 1 — nada foi movido
});

fim();
