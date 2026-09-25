import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';

const repo = () => criarRepoMemoria(fixture);

await ta('lerUsuarios/lerJogadores: devolvem cópias independentes', async () => {
  const r = repo();
  const us = await r.lerUsuarios();
  assert.equal(us.length, 3);
  us[0].nome = 'MUDOU';
  assert.notEqual((await r.lerUsuarios())[0].nome, 'MUDOU');
  assert.equal((await r.lerJogadores()).length, 3);
});

await ta('gravarUsuario: linha nova entra no fim; existente é atualizada pela chave email', async () => {
  const r = repo();
  await r.gravarUsuario({ email: 'n@exemplo.com', nome: 'N', perfil: 'jogador', jogador_id: null, criado_em: '2026-09-23T15:00:00.000Z', jogador_id_pendente: null, ordem: 4 });
  let us = await r.lerUsuarios();
  assert.equal(us.length, 4);
  assert.equal(us[3].email, 'n@exemplo.com');
  await r.gravarUsuario({ email: 'n@exemplo.com', nome: 'N2', perfil: 'organizador' });
  us = await r.lerUsuarios();
  assert.equal(us.length, 4);
  assert.equal(us[3].nome, 'N2');
  assert.equal(us[3].perfil, 'organizador');
  assert.equal(us[3].ordem, 4); // campos que a atualização não trouxe ficam como estavam
});

await ta('removerUsuario: apaga; e não falha se o e-mail não existe', async () => {
  const r = repo();
  await r.removerUsuario('c@exemplo.com');
  assert.deepEqual((await r.lerUsuarios()).map((u) => u.email).sort(), ['a@exemplo.com', 'b@exemplo.com']);
  await r.removerUsuario('nao-existe@exemplo.com');
  assert.equal((await r.lerUsuarios()).length, 2);
});

await ta('lerTudo enxerga as gravações feitas pelas primitivas', async () => {
  const r = repo();
  await r.removerUsuario('c@exemplo.com');
  assert.equal((await r.lerTudo()).usuarios.length, 2);
});

fim();
