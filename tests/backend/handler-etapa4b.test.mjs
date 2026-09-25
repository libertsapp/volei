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
const novo = () => { const repo = criarRepoMemoria(fixture); return { repo, h: criarHandler({ repo, config: { adminPassword: 'chave-de-teste' }, verificarToken }) }; };
const NEGADO = (perfil) => ({ error: 'Seu perfil (' + perfil + ') não tem permissão para esta ação.' });

const acoes = {
  marcarDiaSemJogo: { data: '2026-09-22' },
  reabrirDia: { data: '2026-09-15' },
  aplicarCreditosDoDia: { data: '2026-09-22' },
  devolverCredito: { id: 'cr1' }
};

await ta('4b: jogador, anônimo e senha errada são negados em toda ação nova; nada muda no banco', async () => {
  const { h } = novo();
  const antes = await h.get();
  for (const [acao, corpo] of Object.entries(acoes)) {
    assert.deepEqual(await h.post({ action: acao, idToken: 'tok-c', ...corpo }), NEGADO('jogador'), acao);
    assert.deepEqual(await h.post({ action: acao, ...corpo }), { error: 'Sem token de login. Entre com sua conta Google.' }, acao);
    assert.deepEqual(await h.post({ action: acao, senha: 'errada', ...corpo }), { error: 'Senha de administrador incorreta.' }, acao);
  }
  assert.deepEqual(await h.get(), antes);
});

await ta('4b: organizador faz as três primeiras; devolverCredito é só admin', async () => {
  const { h } = novo();
  for (const acao of ['marcarDiaSemJogo', 'reabrirDia', 'aplicarCreditosDoDia']) {
    const r = await h.post({ action: acao, idToken: 'tok-b', ...acoes[acao] });
    assert.equal(r.status, 'ok', acao + ': ' + JSON.stringify(r.error));
  }
  assert.deepEqual(await h.post({ action: 'devolverCredito', idToken: 'tok-b', id: 'cr1' }), NEGADO('organizador'));
});

await ta('4b: admin e chave mestra; a resposta traz o financeiro no formato do GET e os contadores de cada ação', async () => {
  const { h } = novo();
  const r = await h.post({ action: 'marcarDiaSemJogo', idToken: 'tok-a', data: '2026-09-22', destino: 'credito' });
  assert.deepEqual(Object.keys(r), ['status', 'financeiro', 'creditos', 'estornados', 'ignorados']);
  assert.deepEqual(r.financeiro, (await h.get()).financeiro);
  assert.equal(r.financeiro.log[0].nome, 'A');
  const a = await h.post({ action: 'aplicarCreditosDoDia', senha: 'chave-de-teste', data: '2026-09-22' });
  assert.deepEqual(Object.keys(a), ['status', 'financeiro', 'aplicados']);
  const d = await h.post({ action: 'devolverCredito', senha: 'chave-de-teste', id: 'cr1' });
  assert.equal(d.status, 'ok');
  assert.equal(d.financeiro.log[0].nome, 'Chave mestra');
});

await ta('4b: check-in pelo handler roda os ganchos (crédito aplicado ao entrar e devolvido ao sair) sob a trava, que fica solta', async () => {
  const dados = structuredClone(fixture);
  dados.fin_pagamentos = dados.fin_pagamentos.filter((p) => p.id !== 'pg2');
  const repo = criarRepoMemoria(dados);
  const h = criarHandler({ repo, config: {}, verificarToken });
  assert.deepEqual(await h.post({ action: 'addCheckin', idToken: 'tok-c', checkin: { id: 'n1', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
  const p = (await h.get()).financeiro.pagamentos.filter((x) => x.tipo === 'credito' && !x.estornado);
  assert.deepEqual(p.map((x) => x.creditoId), ['cr1']);
  assert.deepEqual(await h.post({ action: 'removeCheckin', idToken: 'tok-c', id: 'n1' }), { status: 'ok' });
  // o c2 do fixture (o outro check-in do Bruno no dia) continua na lista: o crédito devolvido é reaplicado logo em seguida
  const f = (await h.get()).financeiro;
  assert.equal(f.pagamentos.filter((x) => x.tipo === 'credito').length, 2);
  assert.equal(f.pagamentos.filter((x) => x.tipo === 'credito' && x.estornado).length, 1);
  assert.ok(f.log.some((l) => l.detalhe.includes('saiu da lista')));
  assert.equal(repo.travas.size, 0);
});

fim();
