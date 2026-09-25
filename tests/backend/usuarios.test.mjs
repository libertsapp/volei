import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import {
  loginGoogle, bootstrapAdmin, listarUsuarios, salvarUsuario, removerUsuario,
  solicitarVinculo, aprovarVinculo, rejeitarVinculo, acharJogadorPorNome
} from '../../backend/usuarios.js';

const AGORA = new Date('2026-09-23T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' },
  'tok-n': { ok: true, email: 'n@exemplo.com', nome: 'Carla Souza' }
};

// fixture + um jogador (p3) sem vínculo, para os pedidos de vínculo
function novo() {
  const dados = structuredClone(fixture);
  dados.jogadores.push({ id: 'p3', nome: 'Carla Souza', apelido: null, foto: null, estrelas: 3, sexo: 'F', porte: 'M', convidado: false, ordem: 3 });
  const repo = criarRepoMemoria(dados);
  return { repo, relogio: () => AGORA, config: { adminPassword: 'chave-de-teste' }, verificarToken: async (t) => TOKENS[t] || { ok: false, erro: 'inválido' } };
}
const usuariosNoBanco = (deps) => deps.repo.lerUsuarios();

await ta('login de conta existente: devolve perfil e vínculo, sem sugestão', async () => {
  const deps = novo();
  assert.deepEqual(await loginGoogle(deps, { idToken: 'tok-a' }), {
    status: 'ok', email: 'a@exemplo.com', nome: 'A', perfil: 'admin', jogadorId: 'p1', jogadorIdPendente: '',
    sugestao: null, primeiroLogin: false, totalUsuarios: 3
  });
});

await ta('login de conta nova: cria como jogador no fim da lista, com sugestão por nome', async () => {
  const deps = novo();
  const r = await loginGoogle(deps, { idToken: 'tok-n' });
  assert.deepEqual(r, {
    status: 'ok', email: 'n@exemplo.com', nome: 'Carla Souza', perfil: 'jogador', jogadorId: '', jogadorIdPendente: '',
    sugestao: { id: 'p3', nome: 'Carla Souza', motivo: 'exato' }, primeiroLogin: true, totalUsuarios: 4
  });
  const us = await usuariosNoBanco(deps);
  assert.deepEqual(us[3], { email: 'n@exemplo.com', nome: 'Carla Souza', perfil: 'jogador', jogador_id: null, criado_em: '2026-09-23T15:00:00.000Z', jogador_id_pendente: null, ordem: 4 });
});

await ta('login com token inválido devolve o erro do verificador', async () => {
  assert.deepEqual(await loginGoogle(novo(), { idToken: 'x' }), { error: 'inválido' });
});

await ta('login: nome mudou na conta Google, planilha atualiza sem mexer em ordem nem criado_em', async () => {
  const deps = novo();
  TOKENS['tok-b2'] = { ok: true, email: 'b@exemplo.com', nome: 'Bruno Novo' };
  const r = await loginGoogle(deps, { idToken: 'tok-b2' });
  assert.equal(r.nome, 'Bruno Novo');
  const b = (await usuariosNoBanco(deps)).find((u) => u.email === 'b@exemplo.com');
  assert.equal(b.nome, 'Bruno Novo');
  assert.equal(b.ordem, 2);
  assert.equal(b.criado_em, '2026-09-02T10:00:00+00:00');
  assert.equal(b.perfil, 'organizador');
});

await ta('bootstrapAdmin: chave errada, chave certa promove e preserva o vínculo', async () => {
  const deps = novo();
  assert.deepEqual(await bootstrapAdmin(deps, { senha: 'errada', idToken: 'tok-c' }), { error: 'Chave mestra incorreta.' });
  assert.deepEqual(await bootstrapAdmin(deps, { senha: 'chave-de-teste', idToken: 'x' }), { error: 'inválido' });
  assert.deepEqual(await bootstrapAdmin(deps, { senha: 'chave-de-teste', idToken: 'tok-c' }), { status: 'ok', email: 'c@exemplo.com', nome: 'C', perfil: 'admin', jogadorId: '' });
  assert.equal((await usuariosNoBanco(deps)).find((u) => u.email === 'c@exemplo.com').perfil, 'admin');
});

await ta('bootstrapAdmin: sem chave mestra configurada, a chave fica desativada', async () => {
  const deps = novo();
  deps.config = {};
  assert.deepEqual(await bootstrapAdmin(deps, { senha: '', idToken: 'tok-c' }), { error: 'Chave mestra incorreta.' });
});

await ta('listarUsuarios: admin vê o cargo; organizador recebe a lista SEM perfil; criadoEm só a data', async () => {
  const deps = novo();
  const adm = await listarUsuarios(deps, 'admin');
  assert.deepEqual(adm.usuarios[0], { email: 'a@exemplo.com', nome: 'A', perfil: 'admin', jogadorId: 'p1', criadoEm: '2026-09-01', jogadorIdPendente: '' });
  const org = await listarUsuarios(deps, 'organizador');
  assert.deepEqual(org.usuarios.map((u) => u.email), ['a@exemplo.com', 'b@exemplo.com', 'c@exemplo.com']);
  assert.equal(org.usuarios.some((u) => 'perfil' in u), false);
});

await ta('salvarUsuario: validações e mensagens', async () => {
  const deps = novo();
  assert.deepEqual(await salvarUsuario(deps, null), { error: 'E-mail do usuário é obrigatório.' });
  assert.deepEqual(await salvarUsuario(deps, { email: 'c@exemplo.com', perfil: 'xpto' }), { error: 'Perfil inválido: xpto' });
  assert.deepEqual(await salvarUsuario(deps, { email: 'a@exemplo.com', perfil: 'jogador' }), { error: 'Não é possível rebaixar o último administrador. Promova outro admin primeiro.' });
  assert.deepEqual(await salvarUsuario(deps, { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'nao-existe' }), { error: 'O jogador escolhido não existe mais na aba Jogadores.' });
  assert.deepEqual(await salvarUsuario(deps, { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'p1' }), { error: 'Esse jogador já está vinculado ao e-mail a@exemplo.com.' });
});

await ta('salvarUsuario: promove, vincula e limpa o pedido pendente; e-mail é normalizado', async () => {
  const deps = novo();
  assert.deepEqual(await salvarUsuario(deps, { email: ' C@Exemplo.com ', perfil: 'Organizador', jogadorId: 'p3', nome: 'C' }), { status: 'ok' });
  const c = (await usuariosNoBanco(deps)).find((u) => u.email === 'c@exemplo.com');
  assert.equal(c.perfil, 'organizador');
  assert.equal(c.jogador_id, 'p3');
  assert.equal(c.jogador_id_pendente, null);
  assert.equal((await usuariosNoBanco(deps)).length, 3);
});

await ta('removerUsuario: inexistente, último admin e sucesso', async () => {
  const deps = novo();
  assert.deepEqual(await removerUsuario(deps, 'x@exemplo.com'), { error: 'Usuário não encontrado (pode já ter sido removido).' });
  assert.deepEqual(await removerUsuario(deps, 'a@exemplo.com'), { error: 'Não é possível remover o último administrador. Promova outro admin primeiro.' });
  assert.deepEqual(await removerUsuario(deps, 'C@Exemplo.com'), { status: 'ok' });
  assert.equal((await usuariosNoBanco(deps)).length, 2);
});

await ta('vínculos: pedido, conflito, aprovação, sem pendente e chave mestra', async () => {
  const deps = novo();
  const authC = { email: 'c@exemplo.com', nome: 'C', perfil: 'jogador' };
  const authB = { email: 'b@exemplo.com', nome: 'B', perfil: 'organizador' };
  assert.deepEqual(await solicitarVinculo(deps, { email: '' }, 'p3'), { error: 'Essa ação precisa de login com conta Google (a chave mestra não identifica uma pessoa).' });
  assert.deepEqual(await solicitarVinculo(deps, authC, 'nao-existe'), { error: 'O jogador escolhido não existe mais na aba Jogadores.' });
  assert.deepEqual(await solicitarVinculo(deps, authC, 'p1'), { error: 'Esse jogador já está vinculado ao e-mail a@exemplo.com.' });
  assert.deepEqual(await solicitarVinculo(deps, authC, 'p3'), { status: 'ok', jogadorIdPendente: 'p3' });
  assert.deepEqual(await solicitarVinculo(deps, authB, 'p3'), { error: 'Já existe outro pedido de vínculo pendente pra esse jogador. Fale com o administrador.' });
  assert.deepEqual(await aprovarVinculo(deps, 'x@exemplo.com'), { error: 'Usuário não encontrado.' });
  assert.deepEqual(await aprovarVinculo(deps, 'b@exemplo.com'), { error: 'Esse usuário não tem nenhum pedido de vínculo pendente.' });
  assert.deepEqual(await aprovarVinculo(deps, 'c@exemplo.com'), { status: 'ok' });
  const c = (await usuariosNoBanco(deps)).find((u) => u.email === 'c@exemplo.com');
  assert.equal(c.jogador_id, 'p3');
  assert.equal(c.jogador_id_pendente, null);
  assert.deepEqual(await solicitarVinculo(deps, authC, ''), { status: 'ok', jogadorIdPendente: '' });
});

await ta('rejeitarVinculo: limpa o pedido; usuário inexistente dá erro', async () => {
  const deps = novo();
  await solicitarVinculo(deps, { email: 'c@exemplo.com', nome: 'C', perfil: 'jogador' }, 'p3');
  assert.deepEqual(await rejeitarVinculo(deps, 'c@exemplo.com'), { status: 'ok' });
  assert.equal((await usuariosNoBanco(deps)).find((u) => u.email === 'c@exemplo.com').jogador_id_pendente, null);
  assert.deepEqual(await rejeitarVinculo(deps, 'x@exemplo.com'), { error: 'Usuário não encontrado.' });
});

await ta('herdado do .gs: rejeitarVinculo grava sem jogadorId e ZERA o vínculo já aprovado', async () => {
  const deps = novo();
  assert.equal((await usuariosNoBanco(deps)).find((u) => u.email === 'a@exemplo.com').jogador_id, 'p1');
  await rejeitarVinculo(deps, 'a@exemplo.com');
  assert.equal((await usuariosNoBanco(deps)).find((u) => u.email === 'a@exemplo.com').jogador_id, null);
});

await ta('acharJogadorPorNome: exato, sobrenome, primeiro nome único e ambiguidade', async () => {
  const jogadores = [
    { id: '1', nome: 'José Pedro Silva', apelido: 'Zé' },
    { id: '2', nome: 'Wanderson Lima', apelido: '' },
    { id: '3', nome: 'Maria A', apelido: '' },
    { id: '4', nome: 'Maria B', apelido: '' }
  ];
  assert.deepEqual(acharJogadorPorNome(jogadores, 'JOSE  pedro silva.'), { id: '1', nome: 'José Pedro Silva', motivo: 'exato' });
  assert.deepEqual(acharJogadorPorNome(jogadores, 'Zé'), { id: '1', nome: 'José Pedro Silva', motivo: 'exato' });
  assert.deepEqual(acharJogadorPorNome(jogadores, 'Jose Silva'), { id: '1', nome: 'José Pedro Silva', motivo: 'parecido' });
  assert.deepEqual(acharJogadorPorNome(jogadores, 'Wanderson'), { id: '2', nome: 'Wanderson Lima', motivo: 'parecido' });
  assert.equal(acharJogadorPorNome(jogadores, 'Maria'), null);
  assert.equal(acharJogadorPorNome(jogadores, ''), null);
  assert.equal(acharJogadorPorNome(jogadores, 'Qwerty Inexistente'), null);
});

fim();
