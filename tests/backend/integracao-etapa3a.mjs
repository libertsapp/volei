// Exercita, no Supabase REAL, as ações da etapa 3a com dados de teste e limpa tudo no fim. Confere também o que só o
// banco faz: sequências de "ordem", a função gravar_rodada (transação) e remover_rodada, o índice único de vínculos.
// Uso: node tests/backend/integracao-etapa3a.mjs   (precisa do .env e do ajuste 3 já executado no painel do Supabase)
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarHandler } from '../../backend/handler.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SENHA = process.env.ADMIN_PASSWORD;
const h = criarHandler({ repo: criarRepoSupabase(cliente), config: { adminPassword: SENHA } });
const post = (corpo) => h.post({ senha: SENHA, ...corpo });

const P = 'teste-e3a-jogador';
const R = 'teste-e3a-rodada';
const CONV = 'convidado:TESTE E3A#zz99';

async function limpar() {
  const { data: times } = await cliente.from('times_rodada').select('id').eq('round_id', R);
  if (times && times.length) await cliente.from('time_jogadores').delete().in('time_rodada_id', times.map((t) => t.id));
  await cliente.from('times_rodada').delete().eq('round_id', R);
  await cliente.from('rodadas').delete().eq('round_id', R);
  await cliente.from('jogadores').delete().in('id', [P, CONV]);
}

const antes = { players: 0, rounds: 0 };
let configAntes;

await limpar(); // sobra de uma execução anterior interrompida
try {
  const g0 = await h.get();
  antes.players = g0.players.length;
  antes.rounds = g0.rounds.length;
  configAntes = g0.settings;

  await ta('sequência de ordem: jogador novo entra no fim (ordem do banco, maior que todas as existentes)', async () => {
    assert.deepEqual(await post({ action: 'addPlayer', player: { id: P, nome: 'Teste Etapa 3a', estrelas: 3.5, sexo: 'M', porte: 'G' } }), { status: 'ok' });
    const { data } = await cliente.from('jogadores').select('id, ordem, removido, convidado').eq('id', P);
    const { data: todas } = await cliente.from('jogadores').select('ordem').not('ordem', 'is', null);
    assert.equal(data[0].removido, false);
    assert.equal(data[0].convidado, false);
    assert.ok(data[0].ordem !== null && data[0].ordem === Math.max(...todas.map((x) => x.ordem)), 'ordem do jogador novo deve ser a maior; veio ' + data[0].ordem);
    const g = await h.get();
    assert.equal(g.players.length, antes.players + 1);
    assert.equal(g.players.at(-1).id, P);
  });

  await ta('id repetido é recusado com mensagem clara', async () => {
    assert.deepEqual(await post({ action: 'addPlayer', player: { id: P, nome: 'X' } }), { error: 'Já existe um jogador com esse id.' });
  });

  await ta('gravar_rodada: cria rodada, times, jogadores e o convidado novo (sem ordem) numa transação', async () => {
    const rodada = { id: R, data: '2026-12-31', rascunho: true, vencedores: [1], times: [
      { nome: 'T1', vitorias: 1, playerIds: [P, CONV] }, { nome: 'T2', vitorias: 2, playerIds: [] }
    ] };
    assert.deepEqual(await post({ action: 'addRound', round: rodada }), { status: 'ok' });
    const g = await h.get();
    assert.equal(g.rounds.length, antes.rounds + 1);
    const nova = g.rounds.at(-1);
    assert.deepEqual({ id: nova.id, data: nova.data, rascunho: nova.rascunho, vencedores: nova.vencedores }, { id: R, data: '2026-12-31', rascunho: true, vencedores: [1] });
    assert.deepEqual(nova.times.map((t) => [t.nome, t.vitorias, t.playerIds]), [['T1', 1, [P, CONV]], ['T2', 2, []]]);
    assert.ok(!g.players.some((p) => p.id === CONV), 'convidado não aparece em players');
    const { data } = await cliente.from('jogadores').select('nome, convidado, ordem').eq('id', CONV);
    assert.deepEqual(data[0], { nome: 'TESTE E3A', convidado: true, ordem: null });
  });

  await ta('gravar_rodada: jogador que não existe recusa tudo e a rodada anterior continua intacta (atomicidade)', async () => {
    const r = await post({ action: 'updateRound', round: { id: R, data: '2027-01-01', times: [{ nome: 'X', vitorias: 0, playerIds: ['id-que-nao-existe'] }] } });
    assert.ok(r.error && /foreign key|violates/i.test(r.error), 'esperava erro de chave estrangeira, veio ' + JSON.stringify(r));
    const nova = (await h.get()).rounds.find((x) => x.id === R);
    assert.equal(nova.data, '2026-12-31');
    assert.equal(nova.times.length, 2);
  });

  await ta('updateRound: troca o conteúdo e a rodada continua sendo a última', async () => {
    assert.deepEqual(await post({ action: 'updateRound', round: { id: R, data: '2027-01-02', rascunho: false, vencedores: [0], times: [{ nome: 'Novo', vitorias: 5, playerIds: [P] }] } }), { status: 'ok' });
    const g = await h.get();
    assert.equal(g.rounds.length, antes.rounds + 1);
    assert.deepEqual(g.rounds.at(-1).times.map((t) => t.nome), ['Novo']);
    assert.equal(g.rounds.at(-1).data, '2027-01-02');
  });

  await ta('índice único: dois usuários não podem ficar vinculados ao mesmo jogador', async () => {
    const dup = await cliente.from('usuarios').select('jogador_id, jogador_id_pendente');
    const ids = dup.data.map((u) => u.jogador_id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, 'já há vínculos duplicados no banco');
    const candidato = ids[0];
    const { error } = await cliente.from('usuarios').insert({ email: 'teste-e3a@exemplo.com', nome: 'T', perfil: 'jogador', jogador_id: candidato });
    await cliente.from('usuarios').delete().eq('email', 'teste-e3a@exemplo.com');
    assert.ok(error && /unique|duplicate/i.test(error.message), 'o banco deveria recusar o vínculo repetido; veio ' + JSON.stringify(error));
  });

  await ta('saveSettings: regravar as configurações atuais não muda nada (e preserva o contador de acessos)', async () => {
    assert.deepEqual(await post({ action: 'saveSettings', settings: configAntes }), { status: 'ok' });
    assert.deepEqual((await h.get()).settings, configAntes);
  });

  await ta('removeRound e removePlayer: apagam a rodada e arquivam o jogador; repetir dá a mensagem do .gs', async () => {
    assert.deepEqual(await post({ action: 'removeRound', id: R }), { status: 'ok' });
    assert.deepEqual(await post({ action: 'removeRound', id: R }), { error: 'Rodada não encontrada (pode já ter sido removida por outra pessoa).' });
    assert.deepEqual(await post({ action: 'removePlayer', id: P }), { status: 'ok' });
    const { data } = await cliente.from('jogadores').select('removido').eq('id', P);
    assert.equal(data[0].removido, true);
    assert.deepEqual(await post({ action: 'removePlayer', id: P }), { error: 'Jogador não encontrado (pode já ter sido removido por outra pessoa).' });
    const g = await h.get();
    assert.equal(g.players.length, antes.players);
    assert.equal(g.rounds.length, antes.rounds);
  });
} finally {
  await limpar();
  const g = await h.get();
  console.log('limpeza: players', antes.players, '->', g.players.length, '| rounds', antes.rounds, '->', g.rounds.length,
    g.players.length === antes.players && g.rounds.length === antes.rounds ? '(banco como estava)' : '(ATENÇÃO: diferente!)');
}
fim();
