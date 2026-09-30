// Sessão do app ponta a ponta no handler: login devolve a sessão; porteiro, check-in e ações da conta aceitam a sessão
// sem falar com o Google; o idToken antigo continua valendo; remover a conta derruba as sessões dela.
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { hashDoToken } from '../../backend/sessoes.js';

const AGORA = new Date('2026-09-30T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, // admin, vinculado a p1
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' }, // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }, // jogador
  'tok-n': { ok: true, email: 'n@exemplo.com', nome: 'Nova Pessoa' } // ainda não existe em usuarios
};
const EXPIROU = { error: 'Sua sessão expirou. Entre com o Google de novo.' };

function novo() {
  const repo = criarRepoMemoria(structuredClone(fixture));
  let chamadasGoogle = 0;
  const verificarToken = async (t) => { chamadasGoogle++; return TOKENS[t] || { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' }; };
  const h = criarHandler({ repo, config: { adminPassword: 'chave-de-teste' }, verificarToken, relogio: () => AGORA });
  return { h, repo, google: () => chamadasGoogle };
}
async function logar(h, tok) { return (await h.post({ action: 'loginGoogle', idToken: tok })).sessao; }

await ta('loginGoogle devolve sessão e validade de 90 dias (conta existente e conta nova)', async () => {
  const { h } = novo();
  const r = await h.post({ action: 'loginGoogle', idToken: 'tok-b' });
  assert.equal(r.perfil, 'organizador');
  assert.match(r.sessao, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.sessaoExpiraEm, '2026-12-29T15:00:00.000Z');
  const n = await h.post({ action: 'loginGoogle', idToken: 'tok-n' });
  assert.equal(n.primeiroLogin, true);
  assert.match(n.sessao, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await h.post({ action: 'ping', sessao: n.sessao })).perfil, 'jogador');
});

await ta('com sessão, ações sensíveis e check-in funcionam SEM falar com o Google', async () => {
  const { h, google } = novo();
  const sessao = await logar(h, 'tok-b');
  const antes = google();
  assert.deepEqual(await h.post({ action: 'addPlayer', sessao, player: { id: 'p9', nome: 'Zé', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
  assert.equal((await h.post({ action: 'addCheckin', sessao, checkin: { id: 'k9', data: '2026-10-06', jogadorId: 'p9', jogadorNome: 'Zé' } })).error, undefined);
  assert.equal((await h.post({ action: 'ping', sessao })).perfil, 'organizador');
  assert.equal(google(), antes);
});

await ta('perfil vem da tabela a cada ação: promover vale sem novo login; jogador continua sem permissão', async () => {
  const { h } = novo();
  const sc = await logar(h, 'tok-c');
  assert.equal((await h.post({ action: 'addPlayer', sessao: sc, player: { id: 'p8', nome: 'X' } })).error, 'Seu perfil (jogador) não tem permissão para esta ação.');
  const sa = await logar(h, 'tok-a');
  await h.post({ action: 'salvarUsuario', sessao: sa, usuario: { email: 'c@exemplo.com', perfil: 'organizador' } });
  assert.deepEqual(await h.post({ action: 'addPlayer', sessao: sc, player: { id: 'p8', nome: 'X' } }), { status: 'ok' });
});

await ta('sessão inválida/vencida sem idToken: "sessão expirou"; com idToken válido, cai no Google (app antigo)', async () => {
  const { h } = novo();
  assert.deepEqual(await h.post({ action: 'ping', sessao: 'lixo' }), EXPIROU);
  assert.deepEqual(await h.post({ action: 'addCheckin', sessao: 'lixo', checkin: { id: 'k1', data: '2026-10-06', jogadorId: 'p1' } }), EXPIROU);
  assert.equal((await h.post({ action: 'ping', sessao: 'lixo', idToken: 'tok-a' })).perfil, 'admin');
  assert.equal((await h.post({ action: 'ping', idToken: 'tok-a' })).perfil, 'admin'); // sem sessão: como hoje
});

await ta('chave mestra errada + sessão válida cai para a sessão (como hoje com idToken)', async () => {
  const { h } = novo();
  const sessao = await logar(h, 'tok-b');
  assert.equal((await h.post({ action: 'ping', senha: 'errada', sessao })).perfil, 'organizador');
  assert.deepEqual(await h.post({ action: 'ping', senha: 'errada' }), { error: 'Senha de administrador incorreta.' });
});

await ta('minhaConta devolve dados atuais; sair encerra só aquela sessão', async () => {
  const { h } = novo();
  const s1 = await logar(h, 'tok-a');
  const s2 = await logar(h, 'tok-a');
  const conta = await h.post({ action: 'minhaConta', sessao: s1 });
  assert.equal(conta.status, 'ok');
  assert.equal(conta.email, 'a@exemplo.com');
  assert.equal(conta.perfil, 'admin');
  assert.equal(conta.jogadorId, 'p1');
  assert.ok(conta.sessaoExpiraEm);
  assert.deepEqual(await h.post({ action: 'sair', sessao: s1 }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'minhaConta', sessao: s1 }), EXPIROU);
  assert.equal((await h.post({ action: 'minhaConta', sessao: s2 })).status, 'ok');
  assert.deepEqual(await h.post({ action: 'sair', sessao: 'lixo' }), { status: 'ok' }); // sair nunca "falha"
});

await ta('sairDeTodosOsAparelhos derruba todas as sessões daquele e-mail, e só dele', async () => {
  const { h } = novo();
  const a1 = await logar(h, 'tok-a');
  const a2 = await logar(h, 'tok-a');
  const b1 = await logar(h, 'tok-b');
  assert.deepEqual(await h.post({ action: 'sairDeTodosOsAparelhos', sessao: a1 }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'ping', sessao: a2 }), EXPIROU);
  assert.equal((await h.post({ action: 'ping', sessao: b1 })).perfil, 'organizador');
  assert.deepEqual(await h.post({ action: 'sairDeTodosOsAparelhos', sessao: 'lixo' }), EXPIROU);
});

await ta('admin remove um usuário: as sessões dele são apagadas e deixam de valer (não vira "jogador")', async () => {
  const { h, repo } = novo();
  const sc = await logar(h, 'tok-c');
  const sa = await logar(h, 'tok-a');
  assert.deepEqual(await h.post({ action: 'removerUsuario', sessao: sa, email: 'c@exemplo.com' }), { status: 'ok' });
  assert.equal(await repo.lerSessao(await hashDoToken(sc)), null); // apagada no banco, não só "sem usuário"
  assert.deepEqual(await h.post({ action: 'ping', sessao: sc }), EXPIROU);
  assert.deepEqual(await h.post({ action: 'addCheckin', sessao: sc, checkin: { id: 'k2', data: '2026-10-06', jogadorId: 'p1' } }), EXPIROU);
});

fim();
