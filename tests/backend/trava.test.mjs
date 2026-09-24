import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarHandler } from '../../backend/handler.js';
import { comTrava, MSG_OCUPADO, TTL_SEG, INTERVALO_MS, LIMITE_MS } from '../../backend/trava.js';
import { salvarFinDia } from '../../backend/financeiro.js';
import { mapearFinanceiro } from '../../backend/mapeadores.js';

// Trava de gravação (o LockService do .gs): comTrava (lógica pura), primitivas dos dois repositórios e a trava dentro do handler.
const cede = () => new Promise((r) => setImmediate(r)); // deixa TODAS as microtarefas pendentes rodarem (um "esperar" falso rápido)
const NEGA = { pegarTrava: async () => false, soltarTrava: async () => {} };

await ta('comTrava: pega, roda a função, devolve o resultado e solta (com o dono e o nome certos, ttl de 30 s)', async () => {
  const chamadas = [];
  const repo = { pegarTrava: async (...a) => { chamadas.push(['pegar', ...a]); return true; }, soltarTrava: async (...a) => { chamadas.push(['soltar', ...a]); } };
  const r = await comTrava({ repo, gerarId: () => 'dono-1' }, 'gravacao', async () => ({ status: 'ok' }));
  assert.deepEqual(r, { status: 'ok' });
  assert.deepEqual(chamadas, [['pegar', 'gravacao', 'dono-1', 30], ['soltar', 'gravacao', 'dono-1']]);
  assert.deepEqual([TTL_SEG, INTERVALO_MS, LIMITE_MS], [30, 150, 15000]);
});

await ta('comTrava: ocupada -> tenta de 150 em 150 ms por 15 s no total e devolve a mensagem de "sistema ocupado" sem rodar a ação', async () => {
  const esperas = [];
  let rodou = false;
  let tentativas = 0;
  const repo = { pegarTrava: async () => { tentativas++; return false; }, soltarTrava: async () => { throw new Error('não devia soltar o que não pegou'); } };
  const r = await comTrava({ repo, gerarId: () => 'x', esperar: async (ms) => { esperas.push(ms); } }, 'gravacao', async () => { rodou = true; });
  assert.deepEqual(r, { error: 'O sistema está ocupado gravando outra alteração. Tente de novo em instantes.' });
  assert.equal(MSG_OCUPADO, r.error);
  assert.equal(rodou, false);
  assert.equal(esperas.length, 100);
  assert.equal(esperas.reduce((a, b) => a + b, 0), 15000);
  assert.equal(tentativas, 101); // a primeira + uma depois de cada espera
});

await ta('comTrava: consegue na 4ª tentativa (a outra ação terminou) e roda normalmente', async () => {
  let n = 0;
  const esperas = [];
  const repo = { pegarTrava: async () => ++n >= 4, soltarTrava: async () => {} };
  const r = await comTrava({ repo, gerarId: () => 'x', esperar: async (ms) => { esperas.push(ms); } }, 'gravacao', async () => 'feito');
  assert.equal(r, 'feito');
  assert.deepEqual(esperas, [150, 150, 150]);
});

await ta('comTrava: solta a trava mesmo quando a ação lança erro (o erro continua subindo); falha ao soltar é engolida', async () => {
  const soltas = [];
  const repo = { pegarTrava: async () => true, soltarTrava: async (n, d) => { soltas.push([n, d]); } };
  await assert.rejects(() => comTrava({ repo, gerarId: () => 'd' }, 'g', async () => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(soltas, [['g', 'd']]);
  const repo2 = { pegarTrava: async () => true, soltarTrava: async () => { throw new Error('rede caiu'); } };
  assert.equal(await comTrava({ repo: repo2, gerarId: () => 'd' }, 'g', async () => 'resultado'), 'resultado');
  await assert.rejects(() => comTrava({ repo: repo2, gerarId: () => 'd' }, 'g', async () => { throw new Error('boom2'); }), /boom2/); // o erro da ação, não o do soltar
});

await ta('comTrava: erro do próprio pegarTrava (SQL do ajuste 5 não rodado) sobe e a ação NÃO roda "sem trava"', async () => {
  let rodou = false;
  const repo = { pegarTrava: async () => { throw new Error('pegar_trava: Could not find the function'); }, soltarTrava: async () => {} };
  await assert.rejects(() => comTrava({ repo, gerarId: () => 'x' }, 'g', async () => { rodou = true; }), /pegar_trava/);
  assert.equal(rodou, false);
});

await ta('comTrava: cada chamada tem um dono próprio (gerarDono tem preferência sobre gerarId; sem nenhum dos dois usa um UUID)', async () => {
  const donos = [];
  const repo = { pegarTrava: async (n, d) => { donos.push(d); return true; }, soltarTrava: async () => {} };
  await comTrava({ repo, gerarDono: () => 'D', gerarId: () => 'I' }, 'g', async () => 1);
  await comTrava({ repo }, 'g', async () => 1);
  await comTrava({ repo }, 'g', async () => 1);
  assert.equal(donos[0], 'D');
  assert.match(donos[1], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(donos[1], donos[2]);
});

await ta('comTrava + repositório em memória: duas ações simultâneas SERIALIZAM (a segunda só começa quando a primeira termina)', async () => {
  const repo = criarRepoMemoria(fixture);
  const deps = { repo, gerarId: (() => { let n = 0; return () => 'd' + (++n); })(), esperar: cede };
  const eventos = [];
  const acao = (nome) => () => comTrava(deps, 'gravacao', async () => {
    eventos.push('inicio ' + nome);
    await cede(); await cede(); // a ação "demora": dá chance para a outra tentar entrar no meio
    eventos.push('fim ' + nome);
    return nome;
  });
  const [a, b] = await Promise.all([acao('A')(), acao('B')()]);
  assert.deepEqual([a, b], ['A', 'B']);
  assert.deepEqual(eventos, ['inicio A', 'fim A', 'inicio B', 'fim B']);
  assert.equal(repo.travas.size, 0); // tudo solto
});

await ta('repo em memória: pegarTrava só dá a trava a UM dono; expira pelo relógio; o mesmo dono renova; soltar só vale para o dono', async () => {
  let agora = 1000;
  const repo = criarRepoMemoria(fixture, { agora: () => agora });
  assert.equal(await repo.pegarTrava('g', 'A', 30), true);
  assert.equal(await repo.pegarTrava('g', 'B', 30), false);
  assert.equal(await repo.pegarTrava('g', 'A', 30), true); // o dono renova
  await repo.soltarTrava('g', 'B'); // quem não é o dono não solta
  assert.equal(await repo.pegarTrava('g', 'B', 30), false);
  agora += 30000; // exatamente no vencimento ainda vale (o SQL só toma quando expira_em < agora)
  assert.equal(await repo.pegarTrava('g', 'B', 30), false);
  agora += 1;
  assert.equal(await repo.pegarTrava('g', 'B', 30), true); // aluguel vencido: B toma
  assert.equal(await repo.pegarTrava('g', 'A', 30), false);
  await repo.soltarTrava('g', 'B');
  assert.equal(await repo.pegarTrava('g', 'A', 30), true); // livre
  assert.equal(await repo.pegarTrava('outra', 'B', 30), true); // nomes diferentes não se atrapalham
});

// ---- repo-supabase com cliente falso (só o rpc) ----
function clienteRpc(respostas) {
  const chamadas = [];
  return { chamadas, rpc: async (nome, args) => { chamadas.push([nome, args]); return respostas[nome] || { data: null, error: null }; } };
}

await ta('repo-supabase: pegarTrava chama a função pegar_trava e devolve true SÓ quando o banco responde true; erro nomeia a função', async () => {
  const c = clienteRpc({ pegar_trava: { data: true, error: null } });
  assert.equal(await criarRepoSupabase(c).pegarTrava('gravacao', 'dono-1', 30), true);
  assert.deepEqual(c.chamadas, [['pegar_trava', { p_nome: 'gravacao', p_dono: 'dono-1', p_ttl_seg: 30 }]]);
  assert.equal(await criarRepoSupabase(clienteRpc({ pegar_trava: { data: false, error: null } })).pegarTrava('g', 'd', 30), false);
  assert.equal(await criarRepoSupabase(clienteRpc({ pegar_trava: { data: null, error: null } })).pegarTrava('g', 'd', 30), false);
  await assert.rejects(() => criarRepoSupabase(clienteRpc({ pegar_trava: { data: null, error: { message: 'Could not find the function public.pegar_trava' } } })).pegarTrava('g', 'd', 30),
    /^Error: pegar_trava: Could not find the function public\.pegar_trava .*ajuste-5\.sql/);
});

await ta('repo-supabase: soltarTrava chama soltar_trava; erro propaga com o nome da função', async () => {
  const c = clienteRpc({});
  await criarRepoSupabase(c).soltarTrava('gravacao', 'dono-1');
  assert.deepEqual(c.chamadas, [['soltar_trava', { p_nome: 'gravacao', p_dono: 'dono-1' }]]);
  await assert.rejects(() => criarRepoSupabase(clienteRpc({ soltar_trava: { data: null, error: { message: 'x' } } })).soltarTrava('g', 'd'), /^Error: soltar_trava: x$/);
});

// ---- a trava dentro do handler ----
const TOKENS = { 'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, 'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' }, 'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' } };
const verificarToken = async (t) => TOKENS[t] || { ok: false, erro: 'inválido' };
const montar = (ajustar, extra = {}) => {
  const dados = structuredClone(fixture);
  if (ajustar) ajustar(dados);
  const repo = criarRepoMemoria(dados);
  return { repo, h: criarHandler({ repo, config: { adminPassword: 'x' }, verificarToken, esperar: cede, ...extra }) };
};
const ck = (id, data, jid, nome, ordem) => ({ id, data, jogador_id: jid, jogador_nome: nome, estrelas: 3, sexo: 'M', estrelas_ajustadas: null, ordem });
// Bruno tem UM crédito (cr1, 14) e dois dias novos com check-in dele: o crédito só pode pagar UM deles
const umCreditoDoisDias = (x) => {
  x.checkins.push(ck('k1', '2026-09-29', 'p2', 'Bruno', 4), ck('k2', '2026-10-06', 'p2', 'Bruno', 5));
  x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg2');
};
const pagamentosPorCredito = async (repo) => mapearFinanceiro(await repo.lerTudo()).pagamentos.filter((p) => p.tipo === 'credito' && !p.estornado);

await ta('CONTROLE: sem a trava, duas salvarFinDia em dias diferentes gastam o MESMO crédito duas vezes (a corrida real da revisão da 4a)', async () => {
  const dados = structuredClone(fixture);
  umCreditoDoisDias(dados);
  const repo = criarRepoMemoria(dados);
  const deps = { repo, relogio: () => new Date('2026-09-24T12:00:00.000Z'), gerarId: (() => { let n = 0; return () => 'id-' + (++n); })() };
  const org = { perfil: 'organizador', nome: 'Org', email: '', viaChaveMestra: false };
  await Promise.all(['2026-09-29', '2026-10-06'].map((data) => salvarFinDia(deps, { data, valorPessoa: 14 }, org)));
  assert.equal((await pagamentosPorCredito(repo)).length, 2, 'se isto passar a dar 1, a corrida deixou de existir e o teste abaixo não prova mais nada');
});

await ta('COM a trava (handler): duas salvarFinDia simultâneas em dias diferentes com UM crédito geram UM pagamento por crédito', async () => {
  const { repo, h } = montar(umCreditoDoisDias);
  const corpo = (data) => ({ action: 'salvarFinDia', idToken: 'tok-b', dia: { data, valorPessoa: 14 } });
  const [a, b] = await Promise.all([h.post(corpo('2026-09-29')), h.post(corpo('2026-10-06'))]);
  assert.equal(a.status, 'ok');
  assert.equal(b.status, 'ok');
  const usados = await pagamentosPorCredito(repo);
  assert.equal(usados.length, 1);
  assert.deepEqual([usados[0].jogadorId, usados[0].creditoId], ['p2', 'cr1']);
  assert.equal(repo.travas.size, 0);
});

await ta('COM a trava: check-in simultâneo com estorno/marcarDiaSemJogo nunca se mistura (o crédito de quem sai volta antes de a espera ser paga)', async () => {
  const { repo, h } = montar((x) => {
    x.fin_pagamentos = x.fin_pagamentos.filter((p) => p.id !== 'pg2');
    x.config.find((c) => c.chave === 'checkinVagas').valor = '1';
  });
  // Ana (c1) dentro; Bruno (c2) na espera com o cr1. Pedidos simultâneos: Ana sai e alguém marca o dia como sem jogo.
  const [a, b] = await Promise.all([h.post({ action: 'removeCheckin', idToken: 'tok-c', id: 'c1' }), h.post({ action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-09-22' })]);
  assert.equal(a.status, 'ok');
  assert.equal(b.status, 'ok');
  const f = mapearFinanceiro(await repo.lerTudo());
  const status = f.dias.find((d) => d.data === '2026-09-22').status;
  // ordem A (sai e depois vira sem jogo): Bruno paga com cr1 e depois o pagamento por crédito é estornado ao virar sem jogo
  // ordem B (sem jogo e depois sai): ninguém paga por crédito. Nos dois casos o dia acaba sem jogo e NENHUM crédito fica gasto.
  assert.equal(status, 'semjogo');
  assert.equal((await pagamentosPorCredito(repo)).length, 0);
});

await ta('handler: trava ocupada -> addCheckin, removeCheckin e as ações do financeiro respondem "sistema ocupado" e NADA é gravado', async () => {
  const { repo, h } = montar(null, {});
  repo.pegarTrava = NEGA.pegarTrava;
  const antes = JSON.stringify(await repo.lerTudo());
  const corpos = [
    { action: 'addCheckin', idToken: 'tok-c', checkin: { id: 'n1', data: '2026-09-29', jogadorId: 'p1' } },
    { action: 'removeCheckin', idToken: 'tok-c', id: 'c1' },
    { action: 'salvarFinDia', idToken: 'tok-b', dia: { data: '2026-09-29', valorPessoa: 10 } },
    { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-09-22', jogadorId: 'p2', jogadorNome: 'Bruno' },
    { action: 'estornarPagamento', idToken: 'tok-b', id: 'pg1' },
    { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-09-22' },
    { action: 'estornarTodosPagamentos', idToken: 'tok-b', data: '2026-09-22' },
    { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'entrada', valor: 1, descricao: 'x' } },
    { action: 'estornarLancamento', idToken: 'tok-a', id: 'l1' },
    { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-09-22' },
    { action: 'reabrirDia', idToken: 'tok-b', data: '2026-09-15' },
    { action: 'aplicarCreditosDoDia', idToken: 'tok-b', data: '2026-09-22' },
    { action: 'devolverCredito', idToken: 'tok-a', id: 'cr1' }
  ];
  for (const c of corpos) assert.deepEqual(await h.post(c), { error: MSG_OCUPADO }, c.action);
  assert.equal(JSON.stringify(await repo.lerTudo()), antes);
});

await ta('handler: perfil sem permissão é barrado ANTES de disputar a trava (trava ocupada não muda a resposta de negado)', async () => {
  const { repo, h } = montar();
  repo.pegarTrava = NEGA.pegarTrava;
  assert.deepEqual(await h.post({ action: 'marcarDiaSemJogo', idToken: 'tok-c', data: '2026-09-22' }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
});

await ta('handler: ações que NÃO usam a trava hoje (jogadores, config) continuam funcionando com a trava ocupada', async () => {
  const { repo, h } = montar();
  repo.pegarTrava = NEGA.pegarTrava;
  assert.deepEqual(await h.post({ action: 'addPlayer', idToken: 'tok-b', player: { id: 'px', nome: 'Novo', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
});

await ta('handler: SQL do ajuste 5 não rodado -> erro claro citando pegar_trava; nada é gravado nem segue sem trava', async () => {
  const { repo, h } = montar();
  repo.pegarTrava = async () => { throw new Error('pegar_trava: Could not find the function public.pegar_trava(p_dono, p_nome, p_ttl_seg) in the schema cache'); };
  const antes = JSON.stringify(await repo.lerTudo());
  const r = await h.post({ action: 'addCheckin', idToken: 'tok-c', checkin: { id: 'n1', data: '2026-09-29', jogadorId: 'p1' } });
  assert.match(r.error, /pegar_trava/);
  const r2 = await h.post({ action: 'salvarFinDia', idToken: 'tok-b', dia: { data: '2026-09-29', valorPessoa: 10 } });
  assert.match(r2.error, /pegar_trava/);
  assert.equal(JSON.stringify(await repo.lerTudo()), antes);
});

await ta('handler: a trava é solta mesmo quando a ação dá erro de validação ou o repositório falha', async () => {
  const { repo, h } = montar();
  assert.deepEqual(await h.post({ action: 'marcarDiaSemJogo', idToken: 'tok-b', data: 'x' }), { error: 'Data inválida.' });
  assert.equal(repo.travas.size, 0);
  repo.inserirFinLancamento = async () => { throw new Error('fin_lancamentos: fora do ar'); };
  assert.deepEqual(await h.post({ action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'entrada', valor: 1, descricao: 'x' } }), { error: 'fin_lancamentos: fora do ar' });
  assert.equal(repo.travas.size, 0);
  assert.equal((await h.post({ action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'entrada', valor: 1, descricao: 'x' } })).error, 'fin_lancamentos: fora do ar'); // e dá para tentar de novo
});

fim();
