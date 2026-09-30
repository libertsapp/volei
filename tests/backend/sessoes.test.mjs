// Sessão própria do app (backend/sessoes.js): criar, validar, renovar e encerrar, com relógio falso.
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarSessao, validarSessao, encerrarSessao, hashDoToken, MSG_SESSAO_EXPIRADA, MSG_SESSAO_SEM_BANCO } from '../../backend/sessoes.js';

const DIA = 86400000;
function deps(iniIso = '2026-09-30T12:00:00.000Z') {
  let agora = new Date(iniIso).getTime();
  return { repo: criarRepoMemoria(fixture), relogio: () => new Date(agora), avancar: (ms) => { agora += ms; } };
}

await ta('criarSessao: token base64url de 32 bytes, banco guarda só o hash, vale 90 dias', async () => {
  const d = deps();
  const s = await criarSessao(d, 'a@exemplo.com');
  assert.match(s.sessao, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(s.sessaoExpiraEm, '2026-12-29T12:00:00.000Z');
  const h = await hashDoToken(s.sessao);
  assert.match(h, /^[0-9a-f]{64}$/);
  const linha = await d.repo.lerSessao(h);
  assert.equal(linha.email, 'a@exemplo.com');
  assert.equal(JSON.stringify(linha).includes(s.sessao), false); // token cru nunca no banco
  assert.notEqual((await criarSessao(d, 'a@exemplo.com')).sessao, s.sessao); // cada login, um token
});

await ta('validarSessao: válida devolve o e-mail; lixo, vazio e vencida dão MSG_SESSAO_EXPIRADA', async () => {
  const d = deps();
  const { sessao } = await criarSessao(d, 'a@exemplo.com');
  const v = await validarSessao(d, sessao);
  assert.equal(v.ok, true);
  assert.equal(v.email, 'a@exemplo.com');
  for (const ruim of ['', undefined, null, 123, 'lixo']) assert.deepEqual(await validarSessao(d, ruim), { ok: false, erro: MSG_SESSAO_EXPIRADA });
  d.avancar(90 * DIA); // no instante exato do vencimento já não vale
  assert.deepEqual(await validarSessao(d, sessao), { ok: false, erro: MSG_SESSAO_EXPIRADA });
});

await ta('renovação: dentro do mesmo dia não grava; depois de 1 dia empurra para agora + 90 dias', async () => {
  const d = deps();
  const { sessao } = await criarSessao(d, 'a@exemplo.com');
  const h = await hashDoToken(sessao);
  let gravacoes = 0;
  const renovar = d.repo.renovarSessao;
  d.repo.renovarSessao = async (...a) => { gravacoes++; return renovar(...a); };
  d.avancar(3 * 3600000);
  await validarSessao(d, sessao);
  assert.equal(gravacoes, 0);
  d.avancar(DIA); // agora: 2026-10-01T15:00Z
  const v = await validarSessao(d, sessao);
  assert.equal(gravacoes, 1);
  assert.equal(v.expiraEm, '2026-12-30T15:00:00.000Z');
  assert.equal((await d.repo.lerSessao(h)).expira_em, '2026-12-30T15:00:00.000Z');
  // quem usa pelo menos a cada 3 meses nunca sai: 89 dias depois ainda vale
  d.avancar(89 * DIA);
  assert.equal((await validarSessao(d, sessao)).ok, true);
});

await ta('banco fora do ar ao conferir: MSG_SESSAO_SEM_BANCO (não é "expirou"); falha ao renovar não derruba', async () => {
  const d = deps();
  const { sessao } = await criarSessao(d, 'a@exemplo.com');
  d.repo.renovarSessao = async () => { throw new Error('sessoes: timeout'); };
  d.avancar(2 * DIA);
  assert.equal((await validarSessao(d, sessao)).ok, true);
  d.repo.lerSessao = async () => { throw new Error('sessoes: connection reset'); };
  assert.deepEqual(await validarSessao(d, sessao), { ok: false, erro: MSG_SESSAO_SEM_BANCO });
});

await ta('criarSessao limpa as vencidas daquele e-mail; encerrarSessao apaga só aquela', async () => {
  const d = deps();
  const velha = await criarSessao(d, 'a@exemplo.com');
  d.avancar(91 * DIA);
  const nova = await criarSessao(d, 'a@exemplo.com');
  assert.equal(await d.repo.lerSessao(await hashDoToken(velha.sessao)), null);
  const outra = await criarSessao(d, 'a@exemplo.com');
  await encerrarSessao(d, nova.sessao);
  await encerrarSessao(d, 'lixo'); // não falha
  assert.equal((await validarSessao(d, nova.sessao)).ok, false);
  assert.equal((await validarSessao(d, outra.sessao)).ok, true);
});

fim();
