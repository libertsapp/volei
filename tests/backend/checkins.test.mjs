import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { addCheckin, removeCheckin, salvarEstrelasAjustadas } from '../../backend/checkins.js';
import { mapearCheckins, mapearJogadores } from '../../backend/mapeadores.js';

const deps = () => ({ repo: criarRepoMemoria(fixture) });
const lista = async (d) => mapearCheckins((await d.repo.lerTudo()).checkins);

await ta('addCheckin: entra no fim, com padrões (nome vazio, estrelas 0, sexo vazio, sem ajuste)', async () => {
  const d = deps();
  assert.deepEqual(await addCheckin(d, { id: 'c9', data: '2026-09-29', jogadorId: 'p1' }), { status: 'ok' });
  assert.deepEqual((await lista(d)).map((c) => c.id), ['c1', 'c2', 'c3', 'c9']);
  assert.deepEqual((await lista(d)).at(-1), { id: 'c9', data: '2026-09-29', jogadorId: 'p1', jogadorNome: '', estrelas: 0, sexo: '', estrelasAjustadas: '' });
});

await ta('addCheckin: o mesmo jogador pode entrar duas vezes (dias diferentes) e não há limite de vagas', async () => {
  const d = deps();
  await addCheckin(d, { id: 'a', data: '2026-09-29', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: 4, sexo: 'F' });
  await addCheckin(d, { id: 'b', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: '4', sexo: 'F', estrelasAjustadas: '3.5' });
  for (let i = 0; i < 20; i++) await addCheckin(d, { id: 'x' + i, data: '2026-10-06', jogadorId: 'p2' });
  const t = await lista(d);
  assert.equal(t.length, 3 + 22);
  assert.equal(t.find((c) => c.id === 'b').estrelasAjustadas, '3.5');
});

await ta('addCheckin: jogadorId desconhecido (convidado do app) cria o convidado, guarda o check-in e não aparece em players', async () => {
  const d = deps();
  const antes = (await d.repo.lerJogadores()).length;
  assert.deepEqual(await addCheckin(d, { id: 'g1', data: '2026-09-29', jogadorId: 'uid-xyz', jogadorNome: 'Visitante', estrelas: 3, sexo: 'M' }), { status: 'ok' });
  assert.deepEqual((await lista(d)).at(-1), { id: 'g1', data: '2026-09-29', jogadorId: 'uid-xyz', jogadorNome: 'Visitante', estrelas: 3, sexo: 'M', estrelasAjustadas: '' });
  const js = await d.repo.lerJogadores();
  assert.equal(js.length, antes + 1);
  const g = js.find((j) => j.id === 'uid-xyz');
  assert.deepEqual({ n: g.nome, c: g.convidado, r: g.removido, o: g.ordem }, { n: 'Visitante', c: true, r: false, o: null });
  assert.ok(!mapearJogadores(js).some((j) => j.id === 'uid-xyz'));
  // segundo check-in do mesmo convidado não duplica o jogador; jogador arquivado também não é recriado
  await addCheckin(d, { id: 'g2', data: '2026-10-06', jogadorId: 'uid-xyz', jogadorNome: 'Visitante' });
  assert.equal((await d.repo.lerJogadores()).length, antes + 1);
  await d.repo.atualizarJogador('p1', { removido: true });
  assert.deepEqual(await addCheckin(d, { id: 'g3', data: '2026-10-06', jogadorId: 'p1' }), { status: 'ok' });
  assert.equal((await d.repo.lerJogadores()).length, antes + 1);
});

await ta('addCheckin: sem jogadorId não cria jogador; id repetido e sem id dão erro', async () => {
  const d = deps();
  const antes = (await d.repo.lerJogadores()).length;
  assert.deepEqual(await addCheckin(d, { id: 'sj', data: '2026-09-29', jogadorNome: 'Sem cadastro' }), { status: 'ok' });
  assert.equal((await d.repo.lerJogadores()).length, antes);
  assert.deepEqual(await addCheckin(d, { id: 'c1', data: '2026-09-29', jogadorId: 'p1' }), { error: 'Já existe um check-in com esse id.' });
  assert.deepEqual(await addCheckin(d, { data: '2026-09-29' }), { error: 'Check-in sem id.' });
  assert.equal((await lista(d)).length, 4);
});

await ta('removeCheckin: remove, e o id que não existe dá o erro do .gs', async () => {
  const d = deps();
  assert.deepEqual(await removeCheckin(d, 'c2'), { status: 'ok' });
  assert.deepEqual((await lista(d)).map((c) => c.id), ['c1', 'c3']);
  assert.deepEqual(await removeCheckin(d, 'c2'), { error: 'Check-in não encontrado (pode já ter sido desmarcado).' });
});

await ta('salvarEstrelasAjustadas: grava, limpa com vazio, ignora id sem existir ou vazio', async () => {
  const d = deps();
  const r = await salvarEstrelasAjustadas(d, [
    { id: 'c1', estrelasAjustadas: 2.5 }, { id: 'c2', estrelasAjustadas: '' }, { id: 'nao-existe', estrelasAjustadas: 3 }, { id: '', estrelasAjustadas: 3 }, { estrelasAjustadas: 3 }
  ]);
  assert.deepEqual(r, { status: 'ok' });
  const t = await lista(d);
  assert.equal(t.find((c) => c.id === 'c1').estrelasAjustadas, '2.5');
  assert.equal(t.find((c) => c.id === 'c2').estrelasAjustadas, '');
  assert.equal(t.length, 3);
});

await ta('salvarEstrelasAjustadas: lista vazia ou que não é lista dá erro; nota inválida não grava nada', async () => {
  const d = deps();
  for (const v of [[], undefined, null, 'x', {}]) assert.deepEqual(await salvarEstrelasAjustadas(d, v), { error: 'Lista de check-ins vazia.' });
  assert.deepEqual(await salvarEstrelasAjustadas(d, [{ id: 'c1', estrelasAjustadas: 1 }, { id: 'c2', estrelasAjustadas: 'abc' }]), { error: 'Estrelas ajustadas inválidas.' });
  assert.equal((await lista(d)).find((c) => c.id === 'c1').estrelasAjustadas, '');
});

fim();
