import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarHandler } from '../../backend/handler.js';
import { criarLimitador, MSG_MUITAS_TENTATIVAS, chaveSenha } from '../../backend/limitador.js';

const SENHA = 'chave-de-teste';
const TOKENS = { 'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, 'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' } };
const verificarToken = async (t) => TOKENS[t] || { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' };
let agora = 1_000_000;
const montar = ({ com = true, max = 3, seg = 60 } = {}) => {
  const repo = criarRepoMemoria(fixture, { agora: () => agora });
  const limitador = com ? criarLimitador({ repo, maxFalhas: max, bloqueioSeg: seg }) : undefined;
  return { repo, h: criarHandler({ repo, config: { adminPassword: SENHA }, verificarToken, limitador }) };
};
const errar = async (h, ip, n) => { for (let i = 0; i < n; i++) await h.post({ action: 'listarUsuarios', senha: 'errada' }, { ip }); };
const ping = (h, senha, ip) => h.post({ action: 'ping', senha }, { ip });

await ta('sem limitador o comportamento é o de sempre (nunca bloqueia, com ou sem contexto)', async () => {
  const { h } = montar({ com: false });
  for (let i = 0; i < 30; i++) assert.deepEqual(await ping(h, 'errada', '1.1.1.1'), { error: 'Senha de administrador incorreta.' });
  assert.equal((await ping(h, SENHA, '1.1.1.1')).status, 'ok');
  assert.equal((await h.post({ action: 'ping', senha: SENHA })).status, 'ok');
});

await ta('após max erros: mensagem de bloqueio, INCLUSIVE para a senha correta; antes disso as mensagens normais', async () => {
  const { h } = montar();
  for (let i = 0; i < 3; i++) assert.deepEqual(await ping(h, 'errada', '1.1.1.1'), { error: 'Senha de administrador incorreta.' });
  assert.deepEqual(await ping(h, 'errada', '1.1.1.1'), { error: MSG_MUITAS_TENTATIVAS });
  assert.deepEqual(await ping(h, SENHA, '1.1.1.1'), { error: 'Muitas tentativas. Tente de novo em alguns minutos.' });
});

await ta('passado o bloqueioSeg a chave mestra volta a funcionar (relógio falso)', async () => {
  const { h } = montar();
  agora = 5_000_000;
  await errar(h, '2.2.2.2', 3);
  assert.equal((await ping(h, SENHA, '2.2.2.2')).error, MSG_MUITAS_TENTATIVAS);
  agora += 59_000;
  assert.equal((await ping(h, SENHA, '2.2.2.2')).error, MSG_MUITAS_TENTATIVAS);
  agora += 2_000;
  assert.equal((await ping(h, SENHA, '2.2.2.2')).status, 'ok');
});

await ta('depois do bloqueio expirar a contagem recomeça do zero (um erro não rebloqueia)', async () => {
  const { h } = montar();
  agora = 9_000_000;
  await errar(h, '3.3.3.3', 3);
  agora += 61_000;
  assert.equal((await ping(h, 'errada', '3.3.3.3')).error, 'Senha de administrador incorreta.');
  assert.equal((await ping(h, SENHA, '3.3.3.3')).status, 'ok');
});

await ta('senha correta zera as falhas; erros fora da janela não somam', async () => {
  const { h } = montar();
  agora = 20_000_000;
  await errar(h, '4.4.4.4', 2);
  assert.equal((await ping(h, SENHA, '4.4.4.4')).status, 'ok');
  await errar(h, '4.4.4.4', 2);
  assert.equal((await ping(h, SENHA, '4.4.4.4')).status, 'ok');
  await errar(h, '4.4.4.4', 2);
  agora += 61_000;
  await errar(h, '4.4.4.4', 2);
  assert.equal((await ping(h, SENHA, '4.4.4.4')).status, 'ok');
});

await ta('IPs diferentes não se afetam; sem IP todos caem em "desconhecido"', async () => {
  const { h } = montar();
  agora = 30_000_000;
  await errar(h, '5.5.5.5', 3);
  assert.equal((await ping(h, SENHA, '5.5.5.5')).error, MSG_MUITAS_TENTATIVAS);
  assert.equal((await ping(h, SENHA, '6.6.6.6')).status, 'ok');
  await errar(h, undefined, 3);
  assert.equal((await ping(h, SENHA)).error, MSG_MUITAS_TENTATIVAS);
  assert.equal(chaveSenha(undefined), 'senha:desconhecido');
});

await ta('bloqueado, mas com token do Google: o login segue valendo (só a chave mestra é negada)', async () => {
  const { h } = montar();
  agora = 40_000_000;
  await errar(h, '7.7.7.7', 3);
  const r = await h.post({ action: 'ping', senha: SENHA, idToken: 'tok-a' }, { ip: '7.7.7.7' });
  assert.deepEqual(r, { status: 'ok', perfil: 'admin', viaChaveMestra: false });
  assert.equal((await h.post({ action: 'ping', idToken: 'tok-a' }, { ip: '7.7.7.7' })).status, 'ok');
});

await ta('bootstrapAdmin passa pelo mesmo limitador (e o contador é compartilhado com o porteiro)', async () => {
  const { h } = montar();
  agora = 50_000_000;
  for (let i = 0; i < 3; i++) assert.deepEqual(await h.post({ action: 'bootstrapAdmin', senha: 'errada', idToken: 'tok-c' }, { ip: '8.8.8.8' }), { error: 'Chave mestra incorreta.' });
  assert.deepEqual(await h.post({ action: 'bootstrapAdmin', senha: SENHA, idToken: 'tok-c' }, { ip: '8.8.8.8' }), { error: MSG_MUITAS_TENTATIVAS });
  assert.equal((await ping(h, SENHA, '8.8.8.8')).error, MSG_MUITAS_TENTATIVAS);
  assert.equal((await h.post({ action: 'bootstrapAdmin', senha: SENHA, idToken: 'tok-c' }, { ip: '9.9.9.9' })).perfil, 'admin');
});

await ta('erros de Google (token inválido) NÃO contam no limitador', async () => {
  const { h } = montar();
  agora = 60_000_000;
  for (let i = 0; i < 10; i++) assert.equal((await h.post({ action: 'listarUsuarios', idToken: 'lixo' }, { ip: '1.2.3.4' })).error, 'Login do Google inválido ou expirado. Entre de novo.');
  assert.equal((await ping(h, SENHA, '1.2.3.4')).status, 'ok');
});

await ta('falha fechada: se o repositório do limitador der erro, a senha NÃO é aceita', async () => {
  const repo = { tentativaBloqueada: async () => { throw new Error('tentativa_bloqueada: função inexistente'); }, lerUsuarios: async () => [] };
  const h = criarHandler({ repo, config: { adminPassword: SENHA }, verificarToken, limitador: criarLimitador({ repo }) });
  const r = await h.post({ action: 'ping', senha: SENHA }, { ip: '1.1.1.1' });
  assert.match(r.error, /tentativa_bloqueada/);
});

await ta('repo Supabase: as três primitivas chamam as rpc certas e falham com mensagem útil', async () => {
  const chamadas = [];
  const cliente = { rpc: async (nome, args) => { chamadas.push([nome, args]); return { data: nome === 'tentativa_bloqueada' ? true : null, error: null }; } };
  const repo = criarRepoSupabase(cliente);
  assert.equal(await repo.tentativaBloqueada('senha:1'), true);
  await repo.registrarFalha('senha:1', 8, 900);
  await repo.limparFalhas('senha:1');
  assert.deepEqual(chamadas, [
    ['tentativa_bloqueada', { p_chave: 'senha:1' }],
    ['registrar_falha', { p_chave: 'senha:1', p_max: 8, p_bloqueio_seg: 900 }],
    ['limpar_falhas', { p_chave: 'senha:1' }]
  ]);
  const ruim = criarRepoSupabase({ rpc: async () => ({ data: null, error: { message: 'boom' } }) });
  await assert.rejects(() => ruim.tentativaBloqueada('x'), /ajuste-7/);
  await assert.rejects(() => ruim.registrarFalha('x', 1, 1), /registrar_falha/);
  await assert.rejects(() => ruim.limparFalhas('x'), /limpar_falhas/);
});

fim();
