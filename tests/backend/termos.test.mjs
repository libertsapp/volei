// Termos de uso (v18.2): o aceite fica gravado NA CONTA (versão + data), o login e o minhaConta devolvem a versão
// aceita, e nenhum outro salvamento da conta (cargo, vínculo, nome) apaga esse registro.
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { loginGoogle, aceitarTermos, salvarUsuario, solicitarVinculo, rejeitarVinculo, minhaConta, lerUsuarios } from '../../backend/usuarios.js';
import { PERMISSOES } from '../../backend/permissoes.js';

const AGORA = new Date('2026-10-14T15:00:00.000Z');
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' },
  'tok-n': { ok: true, email: 'n@exemplo.com', nome: 'Nova Pessoa' }
};
function novo() {
  const repo = criarRepoMemoria(structuredClone(fixture));
  return { repo, relogio: () => AGORA, config: { adminPassword: '' }, verificarToken: async (t) => TOKENS[t] || { ok: false, erro: 'inválido' } };
}
const linha = async (deps, email) => (await deps.repo.lerUsuarios()).find((u) => u.email === email);
const authDe = (email, perfil = 'jogador') => ({ email, nome: 'X', perfil });

await ta('conta antiga e conta nova: login devolve termosVersao vazio (popup vai aparecer)', async () => {
  const deps = novo();
  assert.equal((await loginGoogle(deps, { idToken: 'tok-a' })).termosVersao, '');
  assert.equal((await loginGoogle(deps, { idToken: 'tok-n' })).termosVersao, '');
});

await ta('aceitarTermos grava versão e data na linha do PRÓPRIO e-mail; login seguinte devolve a versão', async () => {
  const deps = novo();
  const r = await aceitarTermos(deps, authDe('c@exemplo.com'), '1');
  assert.deepEqual(r, { status: 'ok', termosVersao: '1' });
  const l = await linha(deps, 'c@exemplo.com');
  assert.equal(l.termos_versao, '1');
  assert.equal(l.termos_aceitos_em, AGORA.toISOString());
  assert.equal((await linha(deps, 'a@exemplo.com')).termos_versao, undefined, 'não mexe na conta dos outros');
  assert.equal((await loginGoogle(deps, { idToken: 'tok-c' })).termosVersao, '1');
});

await ta('aceitarTermos não mexe em perfil, vínculo nem nome', async () => {
  const deps = novo();
  const antes = await linha(deps, 'a@exemplo.com');
  await aceitarTermos(deps, authDe('a@exemplo.com', 'admin'), '1');
  const depois = await linha(deps, 'a@exemplo.com');
  assert.equal(depois.perfil, antes.perfil);
  assert.equal(depois.jogador_id, antes.jogador_id);
  assert.equal(depois.nome, antes.nome);
});

await ta('versão inválida e conta inexistente são recusadas', async () => {
  const deps = novo();
  for (const v of ['', null, undefined, 'x'.repeat(21), '1; drop', '<b>']) {
    assert.ok((await aceitarTermos(deps, authDe('c@exemplo.com'), v)).error, 'versão ' + JSON.stringify(v));
  }
  assert.ok((await aceitarTermos(deps, authDe('ninguem@exemplo.com'), '1')).error);
  assert.ok((await aceitarTermos(deps, { perfil: 'admin', viaChaveMestra: true }, '1')).error, 'sem e-mail (chave mestra) não aceita por ninguém');
});

await ta('cargo, vínculo, rejeição e troca de nome no login NÃO apagam o aceite', async () => {
  const deps = novo();
  await aceitarTermos(deps, authDe('c@exemplo.com'), '1');
  await salvarUsuario(deps, { email: 'c@exemplo.com', nome: 'C', perfil: 'organizador', jogadorId: '' });
  await solicitarVinculo(deps, authDe('c@exemplo.com', 'organizador'), 'p2');
  await rejeitarVinculo(deps, 'c@exemplo.com');
  TOKENS['tok-c'] = { ok: true, email: 'c@exemplo.com', nome: 'C Renomeada' };
  const r = await loginGoogle(deps, { idToken: 'tok-c' });
  assert.equal(r.termosVersao, '1');
  assert.equal((await linha(deps, 'c@exemplo.com')).termos_aceitos_em, AGORA.toISOString());
});

await ta('minhaConta devolve termosVersao (app reaberto com sessão salva)', async () => {
  const deps = novo();
  const { sessao } = await loginGoogle(deps, { idToken: 'tok-c' });
  assert.equal((await minhaConta(deps, { sessao })).termosVersao, '');
  await aceitarTermos(deps, authDe('c@exemplo.com'), '1');
  assert.equal((await minhaConta(deps, { sessao })).termosVersao, '1');
});

await ta('lista de usuários do organizador não expõe dados do aceite', async () => {
  const deps = novo();
  await aceitarTermos(deps, authDe('c@exemplo.com'), '1');
  const u = (await lerUsuarios(deps.repo)).find((x) => x.email === 'c@exemplo.com');
  assert.equal(u.termosVersao, '1');
  const { listarUsuarios } = await import('../../backend/usuarios.js');
  const org = (await listarUsuarios(deps, 'organizador')).usuarios.find((x) => x.email === 'c@exemplo.com');
  assert.equal('termosVersao' in org, false);
});

await ta('handler: aceitarTermos liberado para qualquer perfil logado, recusado sem login', async () => {
  assert.deepEqual(PERMISSOES.aceitarTermos, ['jogador', 'organizador', 'admin']);
  const deps = novo();
  const h = criarHandler({ ...deps, avisar: () => {} });
  const { sessao } = await h.post({ action: 'loginGoogle', idToken: 'tok-c' });
  assert.deepEqual(await h.post({ action: 'aceitarTermos', versao: '1', sessao }), { status: 'ok', termosVersao: '1' });
  assert.equal((await linha(deps, 'c@exemplo.com')).termos_versao, '1');
  assert.ok((await h.post({ action: 'aceitarTermos', versao: '1' })).error, 'sem login');
});

fim();
