import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { addPlayer, updatePlayer, removePlayer } from '../../backend/jogadores.js';
import { saveSettings } from '../../backend/configuracoes.js';
import { mapearJogadores, mapearConfig } from '../../backend/mapeadores.js';

const deps = () => ({ repo: criarRepoMemoria(fixture) });
const ativos = async (d) => mapearJogadores(await d.repo.lerJogadores());

await ta('addPlayer: grava com os campos vazios como null e estrelas numérica; aparece no fim de players', async () => {
  const d = deps();
  assert.deepEqual(await addPlayer(d, { id: 'p5', nome: 'Diego', estrelas: '3.5', sexo: 'M', porte: 'G' }), { status: 'ok' });
  const bruto = (await d.repo.lerJogadores()).find((j) => j.id === 'p5');
  assert.deepEqual({ apelido: bruto.apelido, foto: bruto.foto, estrelas: bruto.estrelas, sexo: bruto.sexo, porte: bruto.porte, convidado: bruto.convidado, removido: bruto.removido }, { apelido: null, foto: null, estrelas: 3.5, sexo: 'M', porte: 'G', convidado: false, removido: false });
  assert.deepEqual((await ativos(d)).map((p) => p.id), ['p1', 'p2', 'p5']);
});

await ta('addPlayer: sem id ou com id repetido devolve erro', async () => {
  const d = deps();
  assert.deepEqual(await addPlayer(d, {}), { error: 'Jogador sem id.' });
  assert.deepEqual(await addPlayer(d, null), { error: 'Jogador sem id.' });
  assert.deepEqual(await addPlayer(d, { id: 'p1', nome: 'X' }), { error: 'Já existe um jogador com esse id.' });
});

await ta('updatePlayer: sobrescreve os 6 campos; jogador inexistente dá a mensagem do .gs', async () => {
  const d = deps();
  assert.deepEqual(await updatePlayer(d, { id: 'p1', nome: 'Ana Maria', apelido: 'Aninha', foto: 'https://x/f.jpg', estrelas: 5, sexo: 'F', porte: 'M' }), { status: 'ok' });
  const p1 = (await ativos(d)).find((p) => p.id === 'p1');
  assert.deepEqual(p1, { id: 'p1', nome: 'Ana Maria', apelido: 'Aninha', foto: 'https://x/f.jpg', estrelas: 5, sexo: 'F', porte: 'M' });
  assert.deepEqual(await updatePlayer(d, { id: 'nao-existe', nome: 'X' }), { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' });
  assert.deepEqual(await updatePlayer(d, { id: 'convidado:LUCAS#ab12', nome: 'X' }), { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' });
});

await ta('removePlayer: arquiva (some de players, o histórico fica); repetir ou inexistente dá a mensagem do .gs', async () => {
  const d = deps();
  assert.deepEqual(await removePlayer(d, 'p1'), { status: 'ok' });
  assert.deepEqual((await ativos(d)).map((p) => p.id), ['p2']);
  const bruto = (await d.repo.lerJogadores()).find((j) => j.id === 'p1');
  assert.equal(bruto.removido, true);
  assert.equal((await d.repo.lerTudo()).time_jogadores.some((x) => x.jogador_id === 'p1'), true); // o histórico das rodadas continua
  assert.deepEqual(await removePlayer(d, 'p1'), { error: 'Jogador não encontrado (pode já ter sido removido por outra pessoa).' });
  assert.deepEqual(await removePlayer(d, 'xx'), { error: 'Jogador não encontrado (pode já ter sido removido por outra pessoa).' });
  assert.deepEqual(await updatePlayer(d, { id: 'p1', nome: 'x' }), { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' });
});

await ta('saveSettings: grava as 7 chaves como o writeSettings do .gs e preserva o contador de acessos', async () => {
  const d = deps();
  assert.deepEqual(await saveSettings(d, { estrelasVisiveis: false, checkinDataAberta: '2026-10-06', checkinTravado: true, checkinVagas: 14, checkinHorario: '21:00', checkinMensagemTemplate: 'Oi {vagas}', contadorAcessos: 9999 }), { status: 'ok' });
  const c = mapearConfig(await d.repo.lerConfig());
  assert.deepEqual(c, { estrelasVisiveis: false, checkinDataAberta: '2026-10-06', checkinTravado: true, checkinVagas: 14, checkinHorario: '21:00', checkinMensagemTemplate: 'Oi {vagas}', contadorAcessos: 41 });
});

await ta('saveSettings: chaves ausentes viram os padrões do .gs (estrelasVisiveis vira FALSE)', async () => {
  const d = deps();
  await saveSettings(d, {});
  const bruto = Object.fromEntries((await d.repo.lerConfig()).map((x) => [x.chave, x.valor]));
  assert.equal(bruto.estrelasVisiveis, 'FALSE');
  assert.equal(bruto.checkinTravado, 'FALSE');
  assert.equal(bruto.checkinVagas, '16');
  assert.equal(bruto.checkinHorario, '20:00');
  assert.equal(bruto.checkinDataAberta, '');
  assert.equal(bruto.contadorAcessos, '41');
});

await ta('saveSettings nunca toca a linha do contador (dela cuida só incrementar_acesso); sem linha, o GET continua 0', async () => {
  const chamadas = [];
  const d = deps();
  const gravar = d.repo.gravarConfig;
  d.repo.gravarConfig = async (pares) => { chamadas.push(...pares.map((x) => x.chave)); return gravar(pares); };
  await saveSettings(d, { estrelasVisiveis: true, checkinVagas: 10, contadorAcessos: 12345 });
  assert.equal(chamadas.includes('contadorAcessos'), false);
  assert.equal(chamadas.length, 6);
  assert.equal(mapearConfig(await d.repo.lerConfig()).contadorAcessos, 41); // valor anterior segue igual
  assert.equal((await d.repo.lerConfig()).find((x) => x.chave === 'contadorAcessos').valor, '41');
  const dados = structuredClone(fixture);
  dados.config = dados.config.filter((c) => c.chave !== 'contadorAcessos');
  const semLinha = { repo: criarRepoMemoria(dados) };
  await saveSettings(semLinha, { estrelasVisiveis: true });
  assert.equal((await semLinha.repo.lerConfig()).some((x) => x.chave === 'contadorAcessos'), false);
  assert.equal(mapearConfig(await semLinha.repo.lerConfig()).contadorAcessos, 0);
});

fim();
