import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarHandler } from '../../backend/handler.js';
import { criarLimitador, MSG_MUITAS_TENTATIVAS, chaveSenha, normalizarIp } from '../../backend/limitador.js';

const SENHA = 'chave-de-teste';
const TOKENS = { 'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, 'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' } };
const verificarToken = async (t) => TOKENS[t] || { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' };
let agora = 1_000_000;
const montar = ({ com = true, max = 3, seg = 60, maxGlobal = 200 } = {}) => {
  const repo = criarRepoMemoria(fixture, { agora: () => agora });
  const limitador = com ? criarLimitador({ repo, maxTentativas: max, janelaSeg: seg, bloqueioSeg: seg, maxGlobal }) : undefined;
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

await ta('após max tentativas: mensagem de bloqueio, INCLUSIVE para a senha correta; antes disso as mensagens normais', async () => {
  const { h } = montar();
  for (let i = 0; i < 3; i++) assert.deepEqual(await ping(h, 'errada', '1.1.1.1'), { error: 'Senha de administrador incorreta.' });
  assert.deepEqual(await ping(h, 'errada', '1.1.1.1'), { error: MSG_MUITAS_TENTATIVAS });
  assert.deepEqual(await ping(h, SENHA, '1.1.1.1'), { error: 'Muitas tentativas. Tente de novo em alguns minutos.' });
});

await ta('passado o bloqueioSeg a chave mestra volta a funcionar (relógio falso)', async () => {
  const { h } = montar();
  agora = 5_000_000;
  await errar(h, '2.2.2.2', 4);
  assert.equal((await ping(h, SENHA, '2.2.2.2')).error, MSG_MUITAS_TENTATIVAS);
  agora += 59_000;
  assert.equal((await ping(h, SENHA, '2.2.2.2')).error, MSG_MUITAS_TENTATIVAS);
  agora += 2_000;
  assert.equal((await ping(h, SENHA, '2.2.2.2')).status, 'ok');
});

await ta('depois do bloqueio expirar a contagem recomeça do zero (um erro não rebloqueia)', async () => {
  const { h } = montar();
  agora = 9_000_000;
  await errar(h, '3.3.3.3', 4);
  agora += 61_000;
  assert.equal((await ping(h, 'errada', '3.3.3.3')).error, 'Senha de administrador incorreta.');
  assert.equal((await ping(h, SENHA, '3.3.3.3')).status, 'ok');
});

await ta('senha correta zera o contador; tentativas fora da janela não somam', async () => {
  const { h } = montar();
  agora = 20_000_000;
  await errar(h, '4.4.4.4', 2);
  assert.equal((await ping(h, SENHA, '4.4.4.4')).status, 'ok'); // 3ª tentativa, certa: zera
  await errar(h, '4.4.4.4', 2);
  assert.equal((await ping(h, SENHA, '4.4.4.4')).status, 'ok'); // zerou de novo
  await errar(h, '4.4.4.4', 2);
  agora += 61_000; // saíram da janela
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
  const repo = { registrarTentativa: async () => { throw new Error('registrar_tentativa: função inexistente'); }, lerUsuarios: async () => [] };
  const h = criarHandler({ repo, config: { adminPassword: SENHA }, verificarToken, limitador: criarLimitador({ repo }) });
  const r = await h.post({ action: 'ping', senha: SENHA }, { ip: '1.1.1.1' });
  assert.match(r.error, /registrar_tentativa/);
});

await ta('repo Supabase: as primitivas chamam as rpc certas e falham com mensagem útil', async () => {
  const chamadas = [];
  const cliente = { rpc: async (nome, args) => { chamadas.push([nome, args]); return { data: nome === 'registrar_tentativa' ? true : null, error: null }; } };
  const repo = criarRepoSupabase(cliente);
  assert.equal(await repo.registrarTentativa('senha:1', 8, 900, 600), true);
  await repo.limparFalhas('senha:1');
  assert.deepEqual(chamadas, [
    ['registrar_tentativa', { p_chave: 'senha:1', p_max: 8, p_janela_seg: 900, p_bloqueio_seg: 600 }],
    ['limpar_falhas', { p_chave: 'senha:1' }]
  ]);
  const ruim = criarRepoSupabase({ rpc: async () => ({ data: null, error: { message: 'boom' } }) });
  await assert.rejects(() => ruim.registrarTentativa('x', 1, 1, 1), /ajuste-7/);
  await assert.rejects(() => ruim.limparFalhas('x'), /limpar_falhas/);
  // resposta que não é exatamente true nega (falha fechada)
  assert.equal(await criarRepoSupabase({ rpc: async () => ({ data: null, error: null }) }).registrarTentativa('x', 1, 1, 1), false);
});

await ta('CONCORRÊNCIA: 200 requisições paralelas com senha errada do mesmo IP (com latência no repo) -> só maxTentativas comparam, o resto é bloqueado', async () => {
  const repo = criarRepoMemoria(fixture, { agora: () => agora });
  const atrasar = (fn) => async (...a) => { await new Promise((r) => setTimeout(r, Math.random() * 15)); return fn(...a); };
  const lento = { ...repo, registrarTentativa: atrasar(repo.registrarTentativa), limparFalhas: atrasar(repo.limparFalhas) };
  const h = criarHandler({ repo: lento, config: { adminPassword: SENHA }, verificarToken, limitador: criarLimitador({ repo: lento, maxTentativas: 8, janelaSeg: 900, bloqueioSeg: 900, maxGlobal: 1000 }) });
  const rs = await Promise.all([...Array(200)].map(() => h.post({ action: 'ping', senha: 'errada' }, { ip: '10.0.0.1' })));
  assert.equal(rs.filter((r) => r.error === 'Senha de administrador incorreta.').length, 8);
  assert.equal(rs.filter((r) => r.error === MSG_MUITAS_TENTATIVAS).length, 192);
  assert.equal((await ping(h, SENHA, '10.0.0.1')).error, MSG_MUITAS_TENTATIVAS);
});

await ta('teto GERAL: trocar de IP a cada tentativa também acaba bloqueando (com a senha certa também); token do Google segue valendo', async () => {
  const { h } = montar({ maxGlobal: 5 });
  agora = 70_000_000;
  for (let i = 0; i < 5; i++) assert.equal((await ping(h, 'errada', '20.0.0.' + i)).error, 'Senha de administrador incorreta.');
  assert.equal((await ping(h, SENHA, '20.0.0.99')).error, MSG_MUITAS_TENTATIVAS);
  assert.equal((await h.post({ action: 'ping', senha: SENHA, idToken: 'tok-a' }, { ip: '20.0.0.99' })).viaChaveMestra, false);
  agora += 901_000;
  assert.equal((await ping(h, SENHA, '20.0.0.99')).status, 'ok');
});

await ta('IP já bloqueado não gasta o teto geral (senão um bloqueado trancaria todo mundo)', async () => {
  const { h } = montar({ maxGlobal: 6, max: 2 });
  agora = 80_000_000;
  for (let i = 0; i < 50; i++) await ping(h, 'errada', '30.0.0.1'); // 2 comparam + 1 estoura; o resto nem chega ao teto geral
  assert.equal((await ping(h, SENHA, '30.0.0.2')).status, 'ok');
});

await ta('normalizarIp: IPv4 igual; mapeado (pontos e hex) vira IPv4; IPv6 vira /64 (comprimido, expandido, maiúsculas, zona, colchetes)', () => {
  assert.equal(normalizarIp('203.0.113.7'), '203.0.113.7');
  assert.equal(normalizarIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(normalizarIp('::ffff:cb00:7107'), '203.0.113.7');
  assert.equal(normalizarIp('0:0:0:0:0:ffff:203.0.113.7'), '203.0.113.7');
  const alvo = '2001:0db8:85a3:0042::/64';
  assert.equal(normalizarIp('2001:db8:85a3:42::1'), alvo);
  assert.equal(normalizarIp('2001:db8:85a3:42:1:2:3:4'), alvo);
  assert.equal(normalizarIp('2001:0DB8:85A3:0042:ffff:ffff:ffff:ffff'), alvo);
  assert.equal(normalizarIp('[2001:db8:85a3:42::abcd]'), alvo);
  assert.equal(normalizarIp('2001:db8:85a3:42::1%eth0'), alvo);
  assert.equal(normalizarIp('2001:db8:85a3:43::1'), '2001:0db8:85a3:0043::/64');
  assert.equal(normalizarIp('2001:db8::1'), '2001:0db8:0000:0000::/64');
  assert.equal(normalizarIp('::1'), '0000:0000:0000:0000::/64');
  assert.equal(normalizarIp(''), 'desconhecido');
  assert.equal(normalizarIp(undefined), 'desconhecido');
  assert.equal(normalizarIp('desconhecido'), 'desconhecido');
  assert.equal(normalizarIp('1:2:3:4:5:6:7:8:9'), '1:2:3:4:5:6:7:8:9');
  assert.equal(chaveSenha('2001:db8:85a3:42::1'), 'senha:' + alvo);
});

await ta('dois IPv6 da mesma /64 compartilham o balde; de /64 diferente não', async () => {
  const { h } = montar();
  agora = 90_000_000;
  await errar(h, '2001:db8:1:1::1', 3);
  assert.equal((await ping(h, SENHA, '2001:db8:1:1:aaaa::9')).error, MSG_MUITAS_TENTATIVAS);
  assert.equal((await ping(h, SENHA, '2001:db8:1:2::1')).status, 'ok');
});

fim();
