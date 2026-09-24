import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarHandler } from '../../backend/handler.js';
import { mapearAoVivo } from '../../backend/mapeadores.js';
import { MSG_OCUPADO } from '../../backend/trava.js';

// Etapa 5: Ao Vivo e contador de acessos. Regras do .gs (iniciarTransmissaoAoVivo, salvarParcialAoVivo,
// cancelarTransmissaoAoVivo, lerAoVivo, incrementarAcesso) conferidas pelo handler com o repositório em memória.
// A comparação com o .gs de verdade está em paridade-aovivo.test.mjs.
const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },   // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }    // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const T0 = Date.parse('2026-09-30T19:00:00.000Z');

// fixture + um rascunho "rd" (Azul: p1 e p2 / Verde: convidado)
function novo(config) {
  const dados = structuredClone(fixture);
  dados.rodadas.push({ round_id: 'rd', data: '2026-09-29', rascunho: true, ordem: 3 });
  dados.times_rodada.push(
    { id: 30, round_id: 'rd', time_index: 0, time_nome: 'Azul', vitorias: 0, vencedor: false },
    { id: 31, round_id: 'rd', time_index: 1, time_nome: 'Verde', vitorias: 1, vencedor: false });
  dados.time_jogadores.push(
    { time_rodada_id: 30, jogador_id: 'p1', posicao: 0 }, { time_rodada_id: 30, jogador_id: 'p2', posicao: 1 },
    { time_rodada_id: 31, jogador_id: 'convidado:LUCAS#ab12', posicao: 0 });
  if (config) dados.config = config;
  const relogio = { t: T0 };
  const repo = criarRepoMemoria(dados);
  const h = criarHandler({ repo, config: { adminPassword: 'chave-de-teste' }, verificarToken, relogio: () => new Date(relogio.t), esperar: async () => {} });
  return { repo, h, relogio };
}
const org = (acao, corpo = {}) => ({ action: acao, idToken: 'tok-b', ...corpo });
const iniciar = (h, extra = {}) => h.post(org('iniciarTransmissaoAoVivo', { roundId: 'rd', duracaoMinutos: 30, ...extra }));
const parcial = (h, v, roundId = 'rd') => h.post(org('salvarParcialAoVivo', { roundId, vitoriasPorTime: v }));
const roxo = { id: 'rx', data: '2026-10-06', rascunho: true, times: [{ nome: 'Roxo', playerIds: ['p1'], vitorias: 0 }] };

await ta('iniciar: copia o rascunho (uma linha por time) com data, jogadores, placar, carimbo ISO e duração', async () => {
  const { h, repo } = novo();
  assert.deepEqual(await iniciar(h), { status: 'ok' });
  assert.deepEqual(repo.tabelas.ao_vivo, [
    { id: 1, round_id: 'rd', data: '2026-09-29', time_index: 0, time_nome: 'Azul', jogadores: 'p1,p2', vitorias: 0, iniciado_em: '2026-09-30T19:00:00.000Z', duracao_minutos: 30 },
    { id: 2, round_id: 'rd', data: '2026-09-29', time_index: 1, time_nome: 'Verde', jogadores: 'convidado:LUCAS#ab12', vitorias: 1, iniciado_em: '2026-09-30T19:00:00.000Z', duracao_minutos: 30 }]);
  assert.deepEqual(await h.post({ action: 'lerAoVivo' }), {
    rounds: [{ id: 'rd', data: '2026-09-29', iniciadoEm: '2026-09-30T19:00:00.000Z', duracaoMinutos: 30,
      times: [{ nome: 'Azul', playerIds: ['p1', 'p2'], vitorias: 0 }, { nome: 'Verde', playerIds: ['convidado:LUCAS#ab12'], vitorias: 1 }] }],
    log: [] });
  assert.deepEqual((await h.get()).aoVivo, await h.post({ action: 'lerAoVivo' }));
});

await ta('iniciar: rodada inexistente, rodada já lançada (não é rascunho) e rodada já ao vivo dão os erros do .gs, sem gravar', async () => {
  const { h, repo } = novo();
  assert.deepEqual(await iniciar(h, { roundId: 'nao-existe' }), { error: 'Rodada não encontrada (pode já ter sido removida).' });
  assert.deepEqual(await iniciar(h, { roundId: 'r1' }), { error: 'Essa rodada já teve o placar lançado — não é mais um rascunho.' });
  assert.deepEqual(await iniciar(h, { roundId: undefined }), { error: 'Rodada não encontrada (pode já ter sido removida).' });
  assert.equal(repo.tabelas.ao_vivo.length, 0);
  await iniciar(h);
  assert.deepEqual(await iniciar(h), { error: 'Essa rodada já está sendo transmitida ao vivo.' });
  assert.equal(repo.tabelas.ao_vivo.length, 2);
});

await ta('iniciar: duração como o .gs (Number(x) || 0, sem limites); o relógio injetado vira o carimbo', async () => {
  for (const [entrada, esperado] of [[30, 30], ['45', 45], [0, 0], [undefined, 0], ['abc', 0], [-5, -5], [2.5, 2.5], [null, 0], [Infinity, 0]]) {
    const { h, repo, relogio } = novo();
    relogio.t = Date.parse('2027-01-02T03:04:05.678Z');
    assert.deepEqual(await iniciar(h, { duracaoMinutos: entrada }), { status: 'ok' });
    assert.equal(repo.tabelas.ao_vivo[0].duracao_minutos, esperado, String(entrada));
    assert.equal(repo.tabelas.ao_vivo[0].iniciado_em, '2027-01-02T03:04:05.678Z');
  }
});

await ta('iniciar: cada rodada tem a sua transmissão; duas ao mesmo tempo aparecem na ordem em que começaram', async () => {
  const { h, repo } = novo();
  await h.post(org('addRound', { round: roxo }));
  await iniciar(h, { roundId: 'rx', duracaoMinutos: 10 });
  await iniciar(h);
  assert.deepEqual((await h.post({ action: 'lerAoVivo' })).rounds.map((r) => r.id), ['rx', 'rd']);
  assert.equal(repo.tabelas.ao_vivo.length, 3);
});

await ta('lerAoVivo: transmissão com a duração esgotada continua sendo devolvida (quem esconde é o app, não o servidor)', async () => {
  const { h, relogio } = novo();
  await iniciar(h, { duracaoMinutos: 1 });
  relogio.t += 24 * 3600 * 1000;
  const r = await h.post({ action: 'lerAoVivo' });
  assert.equal(r.rounds.length, 1);
  assert.equal(r.rounds[0].duracaoMinutos, 1);
});

await ta('salvarParcial: grava só os times que mudaram, com um log de diferença por time (mais recente primeiro)', async () => {
  const { h, repo, relogio } = novo();
  await iniciar(h);
  relogio.t += 60000;
  assert.deepEqual(await parcial(h, [2, 1]), { status: 'ok' }); // Azul 0 -> 2; Verde continua 1
  assert.deepEqual(repo.tabelas.ao_vivo.map((l) => l.vitorias), [2, 1]);
  assert.deepEqual(repo.tabelas.ao_vivo_log, [{ id: 1, round_id: 'rd', time_index: 0, time_nome: 'Azul', delta: 2, timestamp: '2026-09-30T19:01:00.000Z' }]);
  relogio.t += 60000;
  assert.deepEqual(await parcial(h, [2, 0]), { status: 'ok' }); // Verde 1 -> 0 (desfazer)
  const lido = await h.post({ action: 'lerAoVivo' });
  assert.deepEqual(lido.rounds[0].times.map((x) => x.vitorias), [2, 0]);
  assert.deepEqual(lido.log, [
    { roundId: 'rd', timeIndex: 1, timeNome: 'Verde', delta: -1, timestamp: '2026-09-30T19:02:00.000Z' },
    { roundId: 'rd', timeIndex: 0, timeNome: 'Azul', delta: 2, timestamp: '2026-09-30T19:01:00.000Z' }]);
});

await ta('salvarParcial: sem mudança não grava log; valores que não são número e times inexistentes são ignorados', async () => {
  const { h, repo } = novo();
  await iniciar(h);
  assert.deepEqual(await parcial(h, [0, 1]), { status: 'ok' });                // igual ao que já estava
  assert.deepEqual(await parcial(h, ['x', null]), { status: 'ok' });            // "x" não é número; null vira 0 (Number(null)) e muda o Verde
  assert.deepEqual(repo.tabelas.ao_vivo.map((l) => l.vitorias), [0, 0]);
  assert.equal(repo.tabelas.ao_vivo_log.length, 1);
  assert.deepEqual(await parcial(h, { 0: 3, 7: 9, 9: 1 }), { status: 'ok' });   // objeto por índice; times 7 e 9 não existem
  assert.deepEqual(repo.tabelas.ao_vivo.map((l) => l.vitorias), [3, 0]);
  assert.deepEqual(await parcial(h, []), { status: 'ok' });                     // lista vazia: nada muda
  assert.deepEqual(repo.tabelas.ao_vivo.map((l) => l.vitorias), [3, 0]);
  assert.deepEqual(await parcial(h, [2.5, undefined]), { status: 'ok' });       // fracionário passa (o .gs também aceita)
  assert.deepEqual(repo.tabelas.ao_vivo.map((l) => l.vitorias), [2.5, 0]);
  assert.equal(repo.tabelas.ao_vivo_log.at(-1).delta, -0.5);
});

await ta('salvarParcial: sem transmissão dá o erro do .gs; sem vitoriasPorTime vira erro (TypeError) sem mudar nada', async () => {
  const { h, repo } = novo();
  assert.deepEqual(await parcial(h, [1, 1]), { error: 'Essa transmissão não foi encontrada (pode já ter sido encerrada).' });
  assert.deepEqual(await parcial(h, [1, 1], 'nao-existe'), { error: 'Essa transmissão não foi encontrada (pode já ter sido encerrada).' });
  await iniciar(h);
  const r = await h.post(org('salvarParcialAoVivo', { roundId: 'rd' }));
  assert.match(r.error, /Cannot read properties of undefined/);
  assert.deepEqual(repo.tabelas.ao_vivo.map((l) => l.vitorias), [0, 1]);
  assert.equal(repo.tabelas.ao_vivo_log.length, 0);
});

await ta('cancelar: apaga o placar e o log só daquela rodada; sem transmissão também dá ok', async () => {
  const { h, repo } = novo();
  assert.deepEqual(await h.post(org('cancelarTransmissaoAoVivo', { roundId: 'rd' })), { status: 'ok' });
  await h.post(org('addRound', { round: roxo }));
  await iniciar(h);
  await iniciar(h, { roundId: 'rx' });
  await parcial(h, [1, 1]);
  await parcial(h, [1], 'rx');
  assert.deepEqual(await h.post(org('cancelarTransmissaoAoVivo', { roundId: 'rd' })), { status: 'ok' });
  assert.deepEqual(repo.tabelas.ao_vivo.map((l) => l.round_id), ['rx']);
  assert.deepEqual(repo.tabelas.ao_vivo_log.map((l) => l.round_id), ['rx']);
  assert.deepEqual((await h.post({ action: 'lerAoVivo' })).rounds.map((r) => r.id), ['rx']);
  assert.deepEqual(await h.post(org('cancelarTransmissaoAoVivo', { roundId: 'rd' })), { status: 'ok' }); // de novo: nada a apagar
});

await ta('permissões: jogador e anônimo negados nas três ações; organizador, admin e chave mestra passam; lerAoVivo é público', async () => {
  const acoes = [['iniciarTransmissaoAoVivo', { roundId: 'rd', duracaoMinutos: 20 }], ['salvarParcialAoVivo', { roundId: 'rd', vitoriasPorTime: [1, 1] }], ['cancelarTransmissaoAoVivo', { roundId: 'rd' }]];
  const { h, repo } = novo();
  const antes = structuredClone(repo.tabelas.ao_vivo);
  for (const [acao, corpo] of acoes) {
    assert.deepEqual(await h.post({ action: acao, idToken: 'tok-c', ...corpo }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' }, acao);
    assert.deepEqual(await h.post({ action: acao, ...corpo }), { error: 'Sem token de login. Entre com sua conta Google.' }, acao);
    assert.deepEqual(await h.post({ action: acao, senha: 'errada', ...corpo }), { error: 'Senha de administrador incorreta.' }, acao);
  }
  assert.deepEqual(repo.tabelas.ao_vivo, antes);
  assert.deepEqual(await h.post({ action: 'iniciarTransmissaoAoVivo', idToken: 'tok-a', roundId: 'rd', duracaoMinutos: 20 }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'salvarParcialAoVivo', senha: 'chave-de-teste', roundId: 'rd', vitoriasPorTime: [1, 1] }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'cancelarTransmissaoAoVivo', idToken: 'tok-b', roundId: 'rd' }), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'lerAoVivo' }), { rounds: [], log: [] }); // sem token nenhum
});

await ta('trava: as três gravações usam a trava "gravacao" e a soltam; lerAoVivo e incrementarAcesso nunca a tocam', async () => {
  const { h, repo } = novo();
  const chamadas = [];
  const pegar = repo.pegarTrava; const soltar = repo.soltarTrava;
  repo.pegarTrava = async (n, d, ttl) => { chamadas.push('pegar:' + n); return pegar(n, d, ttl); };
  repo.soltarTrava = async (n, d) => { chamadas.push('soltar:' + n); return soltar(n, d); };
  await h.post({ action: 'lerAoVivo' });
  await h.post({ action: 'incrementarAcesso' });
  assert.deepEqual(chamadas, []);
  await iniciar(h);
  assert.deepEqual(chamadas, ['pegar:gravacao', 'soltar:gravacao']);
  await parcial(h, [1, 1]);
  await h.post(org('cancelarTransmissaoAoVivo', { roundId: 'rd' }));
  assert.equal(chamadas.filter((c) => c === 'pegar:gravacao').length, 3);
  assert.equal(chamadas.filter((c) => c === 'soltar:gravacao').length, 3);
  assert.equal(repo.travas.size, 0);
});

await ta('trava ocupada: as três gravações respondem "ocupado" sem gravar; lerAoVivo e incrementarAcesso seguem funcionando', async () => {
  const { h, repo } = novo();
  await iniciar(h);
  await repo.pegarTrava('gravacao', 'outro-processo', 30);
  assert.deepEqual(await iniciar(h, { roundId: 'r1' }), { error: MSG_OCUPADO });
  assert.deepEqual(await parcial(h, [5, 5]), { error: MSG_OCUPADO });
  assert.deepEqual(await h.post(org('cancelarTransmissaoAoVivo', { roundId: 'rd' })), { error: MSG_OCUPADO });
  assert.equal(repo.tabelas.ao_vivo.length, 2);
  assert.equal((await h.post({ action: 'lerAoVivo' })).rounds.length, 1);
  assert.deepEqual(await h.post({ action: 'incrementarAcesso' }), { contadorAcessos: 42 });
});

await ta('contador: linha ausente = 0, valor vazio ou lixo = 0, número (com espaços ou decimal) soma 1; vários acessos seguidos', async () => {
  for (const [inicial, primeiro] of [[undefined, 1], ['', 1], ['abc', 1], ['NaN', 1], ['0', 1], ['41', 42], [' 7 ', 8], ['3.5', 4.5], ['-3', -2], ['1e3', 1001], ['007', 8]]) {
    const config = structuredClone(fixture.config).filter((c) => c.chave !== 'contadorAcessos');
    if (inicial !== undefined) config.push({ chave: 'contadorAcessos', valor: inicial });
    const { h, repo } = novo(config);
    assert.deepEqual(await h.post({ action: 'incrementarAcesso' }), { contadorAcessos: primeiro }, String(inicial));
    assert.deepEqual(await h.post({ action: 'incrementarAcesso' }), { contadorAcessos: primeiro + 1 }, String(inicial));
    assert.equal((await h.get()).settings.contadorAcessos, primeiro + 1);
    assert.equal(repo.tabelas.config.filter((c) => c.chave === 'contadorAcessos').length, 1);
  }
});

await ta('contador: saveSettings continua sem sobrescrever o contador (o app do admin pode ter um valor velho)', async () => {
  const { h } = novo();
  await h.post({ action: 'incrementarAcesso' });
  await h.post({ action: 'saveSettings', senha: 'chave-de-teste', settings: { estrelasVisiveis: true, contadorAcessos: 5 } });
  assert.equal((await h.get()).settings.contadorAcessos, 42);
});

await ta('contador: função do banco ausente (SQL do ajuste 6 não rodado) vira { error } citando incrementar_acesso e o arquivo; GET e Ao Vivo seguem', async () => {
  const cliente = { rpc: async () => ({ data: null, error: { message: 'Could not find the function public.incrementar_acesso without parameters in the schema cache' } }) };
  const repo = { ...criarRepoMemoria(structuredClone(fixture)), incrementarAcesso: criarRepoSupabase(cliente).incrementarAcesso };
  const h = criarHandler({ repo, config: {}, verificarToken });
  const r = await h.post({ action: 'incrementarAcesso' });
  assert.match(r.error, /incrementar_acesso/);
  assert.match(r.error, /schema-terca-supabase-ajuste-6\.sql/);
  assert.deepEqual(Object.keys(r), ['error']);
  assert.equal((await h.get()).settings.contadorAcessos, 41);
  assert.deepEqual(await h.post({ action: 'lerAoVivo' }), { rounds: [], log: [] });
});

await ta('repo Supabase (cliente falso): incrementar devolve o número do rpc; inserir Ao Vivo cita a tabela e o arquivo do ajuste no erro', async () => {
  const chamadas = [];
  const cliente = {
    rpc: async (nome, args) => { chamadas.push([nome, args]); return { data: 42, error: null }; },
    from: () => ({ insert: async () => ({ error: { message: "Could not find the 'data' column of 'ao_vivo' in the schema cache" } }) })
  };
  const repo = criarRepoSupabase(cliente);
  assert.equal(await repo.incrementarAcesso(), 42);
  assert.deepEqual(chamadas, [['incrementar_acesso', undefined]]);
  await assert.rejects(() => repo.inserirAoVivo([{ round_id: 'x' }]), (e) => /^ao_vivo: /.test(e.message) && /ajuste-6\.sql/.test(e.message));
});

// ---- editar / remover uma rodada durante a transmissão (decisão da etapa 5; ver o spec) ----
await ta('rodada ao vivo: editar (mesmo rascunho) mantém a transmissão intacta, como no .gs', async () => {
  const { h, repo } = novo();
  await iniciar(h);
  await parcial(h, [3, 1]);
  const antes = structuredClone(repo.tabelas.ao_vivo);
  const r = await h.post(org('updateRound', { round: { id: 'rd', data: '2026-09-29', rascunho: true, times: [{ nome: 'Azul', playerIds: ['p1'], vitorias: 9 }, { nome: 'Verde', playerIds: [], vitorias: 9 }, { nome: 'Novo', playerIds: [], vitorias: 0 }] } }));
  assert.deepEqual(r, { status: 'ok' });
  assert.deepEqual(repo.tabelas.ao_vivo, antes); // o espelho do Ao Vivo não muda; só o app cancela/atualiza
  assert.equal((await h.get()).rounds.at(-1).times.length, 3);
  assert.equal((await h.post({ action: 'lerAoVivo' })).rounds[0].times.length, 2);
});

await ta('rodada ao vivo: o fluxo "Lançar placar" (updateRound com rascunho falso e depois cancelar) funciona', async () => {
  const { h, repo } = novo();
  await iniciar(h);
  await parcial(h, [2, 1]);
  assert.deepEqual(await h.post(org('updateRound', { round: { id: 'rd', data: '2026-09-29', rascunho: false, vencedores: [0], times: [{ nome: 'Azul', playerIds: ['p1', 'p2'], vitorias: 2 }, { nome: 'Verde', playerIds: [], vitorias: 1 }] } })), { status: 'ok' });
  assert.equal(repo.tabelas.ao_vivo.length, 2); // ainda ao vivo até o app cancelar
  assert.deepEqual(await h.post(org('cancelarTransmissaoAoVivo', { roundId: 'rd' })), { status: 'ok' });
  assert.deepEqual(await h.post({ action: 'lerAoVivo' }), { rounds: [], log: [] });
  assert.equal((await h.get()).rounds.at(-1).rascunho, false);
});

await ta('rodada ao vivo: remover a rodada encerra a transmissão dela (no .gs sobrava uma linha órfã); as outras seguem', async () => {
  const { h, repo } = novo();
  await h.post(org('addRound', { round: roxo }));
  await iniciar(h); await iniciar(h, { roundId: 'rx' });
  await parcial(h, [1, 0]); await parcial(h, [4], 'rx');
  assert.deepEqual(await h.post({ action: 'removeRound', senha: 'chave-de-teste', id: 'rd' }), { status: 'ok' });
  assert.deepEqual(repo.tabelas.ao_vivo.map((l) => l.round_id), ['rx']);
  assert.deepEqual(repo.tabelas.ao_vivo_log.map((l) => l.round_id), ['rx']);
  assert.deepEqual((await h.get()).aoVivo.rounds.map((r) => r.id), ['rx']);
});

await ta('rodada ao vivo: updateRound sem times (que no .gs apaga a rodada) também encerra a transmissão', async () => {
  const { h, repo } = novo();
  await iniciar(h);
  assert.deepEqual(await h.post(org('updateRound', { round: { id: 'rd', data: '2026-09-29', rascunho: true, times: [] } })), { status: 'ok' });
  assert.equal(repo.tabelas.ao_vivo.length, 0);
});

await ta('repo em memória emula a chave estrangeira: não dá para iniciar transmissão de rodada que não existe (nada é gravado)', async () => {
  const { repo } = novo();
  await assert.rejects(() => repo.inserirAoVivo([{ round_id: 'rd', time_index: 0 }, { round_id: 'fantasma', time_index: 0 }]), /ao_vivo_round_id_fkey/);
  assert.equal(repo.tabelas.ao_vivo.length, 0);
});

await ta('linhas migradas (formato do script de migração) e linhas gravadas pelo código novo saem idênticas em mapearAoVivo', async () => {
  const { h, repo, relogio } = novo();
  await iniciar(h);
  relogio.t += 5000;
  await parcial(h, [1, 0]);
  const lidoNovo = await h.post({ action: 'lerAoVivo' });
  // o que a migração gravaria para as mesmas linhas da planilha: timestamptz volta com +00:00, "jogadores" vazio vira null, duração 0 vira null
  const migradas = {
    ao_vivo: repo.tabelas.ao_vivo.map((l) => ({ ...l, iniciado_em: l.iniciado_em.replace('.000Z', '+00:00'), jogadores: l.jogadores || null })),
    ao_vivo_log: repo.tabelas.ao_vivo_log.map((l) => ({ ...l, timestamp: l.timestamp.replace('.000Z', '+00:00') }))
  };
  assert.deepEqual(mapearAoVivo(migradas.ao_vivo, migradas.ao_vivo_log), lidoNovo);
  const zero = migradas.ao_vivo.map((l) => ({ ...l, duracao_minutos: null }));
  assert.equal(mapearAoVivo(zero, []).rounds[0].duracaoMinutos, 0);
});

await ta('mapearAoVivo: log de rodada sem transmissão some; linhas sem round_id são ignoradas; times fora de ordem entram pelo índice', async () => {
  const linhas = [
    { id: 2, round_id: 'a', data: '2026-09-29', time_index: 1, time_nome: 'B', jogadores: null, vitorias: 2, iniciado_em: '2026-09-30T19:00:00+00:00', duracao_minutos: 10 },
    { id: 1, round_id: 'a', data: '2026-09-29', time_index: 0, time_nome: 'A', jogadores: 'p1,,p2', vitorias: 1, iniciado_em: '2026-09-30T19:00:00+00:00', duracao_minutos: 10 },
    { id: 3, round_id: null, time_index: 0 }
  ];
  const log = [
    { id: 1, round_id: 'a', time_index: 0, time_nome: 'A', delta: 1, timestamp: '2026-09-30T19:01:00+00:00' },
    { id: 2, round_id: 'orfa', time_index: 0, time_nome: 'A', delta: 1, timestamp: '2026-09-30T19:02:00+00:00' }
  ];
  const r = mapearAoVivo(linhas, log);
  assert.deepEqual(r.rounds, [{ id: 'a', data: '2026-09-29', iniciadoEm: '2026-09-30T19:00:00.000Z', duracaoMinutos: 10,
    times: [{ nome: 'A', playerIds: ['p1', 'p2'], vitorias: 1 }, { nome: 'B', playerIds: [], vitorias: 2 }] }]);
  assert.deepEqual(r.log, [{ roundId: 'a', timeIndex: 0, timeNome: 'A', delta: 1, timestamp: '2026-09-30T19:01:00.000Z' }]);
});

fim();
