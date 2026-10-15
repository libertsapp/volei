// Último acesso das contas (v18.4): login e minhaConta (abrir/voltar ao app) registram o acesso, no máximo um
// registro a cada 5 min por conta; a lista de contas entrega "ultimoAcesso" só a quem já vê a lista (org e admin).
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { loginGoogle, minhaConta, listarUsuarios, registrarAcesso } from '../../backend/usuarios.js';

const T0 = new Date('2026-10-14T20:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' }, // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }, // jogador
  'tok-n': { ok: true, email: 'n@exemplo.com', nome: 'Nova' }
};
function novo() {
  let agora = T0;
  const repo = criarRepoMemoria(structuredClone(fixture));
  const deps = { repo, relogio: () => agora, config: { adminPassword: '' }, verificarToken: async (t) => TOKENS[t] || { ok: false, erro: 'inválido' }, avisar: () => {} };
  return { deps, repo, andar: (min) => { agora = new Date(agora.getTime() + min * 60000); } };
}
const acessoDe = async (repo, email) => (await repo.lerUsuarios()).find((u) => u.email === email).ultimo_acesso;

await ta('login de conta existente e de conta nova registram o acesso', async () => {
  const { deps, repo } = novo();
  await loginGoogle(deps, { idToken: 'tok-c' });
  assert.equal(await acessoDe(repo, 'c@exemplo.com'), T0.toISOString());
  await loginGoogle(deps, { idToken: 'tok-n' });
  assert.equal(await acessoDe(repo, 'n@exemplo.com'), T0.toISOString());
});

await ta('minhaConta (abrir/voltar ao app) registra; antes de 5 min não grava de novo, depois grava', async () => {
  const { deps, repo, andar } = novo();
  const { sessao } = await loginGoogle(deps, { idToken: 'tok-c' });
  andar(4);
  await minhaConta(deps, { sessao });
  assert.equal(await acessoDe(repo, 'c@exemplo.com'), T0.toISOString(), '4 min depois: não regrava');
  andar(2);
  await minhaConta(deps, { sessao });
  assert.equal(await acessoDe(repo, 'c@exemplo.com'), new Date(T0.getTime() + 6 * 60000).toISOString(), '6 min depois: regrava');
});

await ta('registrar o acesso não mexe em perfil, vínculo, nome nem no aceite dos termos', async () => {
  const { deps, repo } = novo();
  await repo.gravarUsuario({ email: 'a@exemplo.com', termos_versao: '1' });
  const antes = (await repo.lerUsuarios()).find((u) => u.email === 'a@exemplo.com');
  await registrarAcesso(deps, 'a@exemplo.com');
  const depois = (await repo.lerUsuarios()).find((u) => u.email === 'a@exemplo.com');
  for (const k of ['perfil', 'jogador_id', 'nome', 'termos_versao', 'jogador_id_pendente']) assert.equal(depois[k], antes[k], k);
  assert.equal(depois.ultimo_acesso, T0.toISOString());
});

await ta('falha ao registrar (ex.: coluna ainda não criada) nunca derruba o login', async () => {
  const { deps } = novo();
  const avisos = [];
  const gravarOriginal = deps.repo.gravarUsuario;
  deps.repo.gravarUsuario = async (l) => { if ('ultimo_acesso' in l) throw new Error('column "ultimo_acesso" does not exist'); return gravarOriginal(l); };
  const r = await loginGoogle({ ...deps, avisar: (m) => avisos.push(m) }, { idToken: 'tok-c' });
  assert.equal(r.status, 'ok');
  assert.ok(avisos.some((m) => /ultimo_acesso/.test(m)), 'o motivo vai para o log');
});

await ta('lista de contas: admin e organizador recebem ultimoAcesso; quem nunca abriu vem vazio', async () => {
  const { deps } = novo();
  await loginGoogle(deps, { idToken: 'tok-c' });
  for (const perfil of ['admin', 'organizador']) {
    const lista = (await listarUsuarios(deps, perfil)).usuarios;
    assert.equal(lista.find((u) => u.email === 'c@exemplo.com').ultimoAcesso, T0.toISOString(), perfil);
    assert.equal(lista.find((u) => u.email === 'a@exemplo.com').ultimoAcesso, '', perfil);
  }
});

await ta('handler: jogador continua sem acesso à lista de contas', async () => {
  const { deps } = novo();
  const h = criarHandler(deps);
  const { sessao } = await h.post({ action: 'loginGoogle', idToken: 'tok-c' });
  assert.match((await h.post({ action: 'listarUsuarios', sessao })).error, /permissão/i);
  const { sessao: sOrg } = await h.post({ action: 'loginGoogle', idToken: 'tok-b' });
  const lista = (await h.post({ action: 'listarUsuarios', sessao: sOrg })).usuarios;
  assert.equal(lista.find((u) => u.email === 'b@exemplo.com').ultimoAcesso, T0.toISOString());
});

fim();
