import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },   // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }    // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const novo = () => criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: 'chave-de-teste' }, verificarToken });
const NEGADO = (perfil) => ({ error: 'Seu perfil (' + perfil + ') não tem permissão para esta ação.' });

const acoes = {
  salvarFinDia: { dia: { data: '2026-10-06', valorPessoa: 10 } },
  marcarPagamento: { data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno' },
  estornarPagamento: { id: 'pg1' },
  marcarTodosPagamentos: { data: '2026-09-22' },
  estornarTodosPagamentos: { data: '2026-09-22' },
  addLancamento: { lancamento: { data: '2026-09-22', tipo: 'entrada', valor: 3, descricao: 'x' } },
  estornarLancamento: { id: 'l1' }
};

await ta('jogador e quem não logou são negados em toda ação financeira; nada muda no banco', async () => {
  const h = novo();
  const antes = await h.get();
  for (const [acao, corpo] of Object.entries(acoes)) {
    assert.deepEqual(await h.post({ action: acao, idToken: 'tok-c', ...corpo }), NEGADO('jogador'), acao);
    assert.deepEqual(await h.post({ action: acao, ...corpo }), { error: 'Sem token de login. Entre com sua conta Google.' }, acao);
    assert.deepEqual(await h.post({ action: acao, senha: 'errada', ...corpo }), { error: 'Senha de administrador incorreta.' }, acao);
  }
  assert.deepEqual(await h.get(), antes);
});

await ta('organizador faz tudo, menos estornarLancamento (só admin)', async () => {
  const h = novo();
  for (const acao of Object.keys(acoes).filter((a) => a !== 'estornarLancamento')) {
    const r = await h.post({ action: acao, idToken: 'tok-b', ...acoes[acao] });
    assert.equal(r.status, 'ok', acao + ': ' + JSON.stringify(r.error));
  }
  assert.deepEqual(await h.post({ action: 'estornarLancamento', idToken: 'tok-b', id: 'l1' }), NEGADO('organizador'));
});

await ta('admin e chave mestra: a resposta traz o financeiro no formato do GET e o nome certo no log', async () => {
  const h = novo();
  const r = await h.post({ action: 'estornarLancamento', idToken: 'tok-a', id: 'l1' });
  assert.deepEqual(Object.keys(r), ['status', 'financeiro']);
  assert.deepEqual(r.financeiro, (await h.get()).financeiro);
  assert.equal(r.financeiro.log[0].nome, 'A');
  const m = await h.post({ action: 'addLancamento', senha: 'chave-de-teste', lancamento: { data: '2026-09-22', tipo: 'saida', valor: 2, descricao: 'y' } });
  assert.equal(m.financeiro.log[0].nome, 'Chave mestra');
});

await ta('ações da 4b continuam "ainda não disponível" (depois do porteiro)', async () => {
  const h = novo();
  for (const a of ['marcarDiaSemJogo', 'reabrirDia', 'aplicarCreditosDoDia', 'devolverCredito']) {
    assert.deepEqual(await h.post({ action: a, idToken: 'tok-a' }), { error: 'Esta ação ainda não está disponível na versão Supabase (' + a + ').' });
  }
  assert.deepEqual(await h.post({ action: 'devolverCredito', idToken: 'tok-b' }), NEGADO('organizador'));
});

await ta('falha do repositório vira { error }; sem gerarId injetado o id é um UUID v4', async () => {
  const repo = criarRepoMemoria(fixture);
  repo.inserirFinLancamento = async () => { throw new Error('fin_lancamentos: banco fora do ar'); };
  const h = criarHandler({ repo, config: { adminPassword: 'x' }, verificarToken });
  assert.deepEqual(await h.post({ action: 'addLancamento', idToken: 'tok-b', ...acoes.addLancamento }), { error: 'fin_lancamentos: banco fora do ar' });
  const h2 = novo();
  await h2.post({ action: 'addLancamento', idToken: 'tok-b', ...acoes.addLancamento });
  assert.match((await h2.get()).financeiro.lancamentos.at(-1).id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

fim();
