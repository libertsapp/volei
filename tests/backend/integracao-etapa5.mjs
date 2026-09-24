// Exercita, no Supabase REAL, a etapa 5 (Ao Vivo e contador de acessos) com uma rodada de 2099 e um jogador temporário, e LIMPA
// tudo o que criou (ao_vivo, ao_vivo_log, rodadas/times, jogadores), mostrando as contagens antes e depois.
// CONTADOR DE ACESSOS: este teste NUNCA sobrescreve nem apaga a linha real. Ele só chama incrementarAcesso 3 vezes ao mesmo tempo
// e confere que os valores devolvidos são distintos; por isso o contador termina 3 acessos acima do que estava (inofensivo, e não
// há restauração). O valor original é impresso no início, para restaurar à mão se algum dia for preciso. As regras de lixo/linha
// ausente do contador são cobertas na paridade contra o .gs (emulação em memória), não aqui.
// PRESSUPOSTO: o sql/schema-terca-supabase-ajuste-6.sql (colunas data/jogadores, FK adiada, remover_rodada e incrementar_acesso)
// e o ajuste 5 (trava) JÁ foram rodados no SQL Editor.
// Uso: node tests/backend/integracao-etapa5.mjs   (precisa do .env; NÃO rodar sem querer: escreve no banco de verdade)
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
const repo = criarRepoSupabase(cliente);
const SENHA = process.env.ADMIN_PASSWORD;
const h = criarHandler({ repo, config: { adminPassword: SENHA }, verificarToken: async () => ({ ok: false, erro: 'sem login neste teste' }) });
const admin = (corpo) => h.post({ senha: SENHA, ...corpo });

const P = 'teste-e5-jogador';
const R = 'teste-e5-rodada';
const R2 = 'teste-e5-rodada-2';
const DATA = '2099-04-06';
const TABELAS = ['ao_vivo', 'ao_vivo_log', 'rodadas', 'times_rodada', 'time_jogadores', 'jogadores'];
const rodada = (id, rascunho = true) => ({ id, data: DATA, rascunho, times: [{ nome: 'Azul', playerIds: [P], vitorias: 0 }, { nome: 'Verde', playerIds: [], vitorias: 1 }] });

async function contagens() {
  const c = {};
  for (const t of TABELAS) {
    const { count, error } = await cliente.from(t).select('*', { count: 'exact', head: true });
    if (error) throw new Error(t + ': ' + error.message);
    c[t] = count;
  }
  return c;
}

// apaga só o que este teste criou; cada apagamento confere o erro (falha silenciosa deixaria lixo no banco de verdade)
async function limpar() {
  const conferir = (rotulo, { error }) => { if (error) console.log('AVISO: limpeza de ' + rotulo + ' falhou: ' + error.message); };
  for (const id of [R, R2]) {
    conferir('ao_vivo_log ' + id, await cliente.from('ao_vivo_log').delete().eq('round_id', id));
    conferir('ao_vivo ' + id, await cliente.from('ao_vivo').delete().eq('round_id', id));
    const { error } = await cliente.rpc('remover_rodada', { p_id: id }); // apaga times, jogadores dos times e a rodada
    conferir('rodada ' + id, { error });
  }
  conferir('jogadores', await cliente.from('jogadores').delete().eq('id', P));
}

// o contador exatamente como está no banco: { existe, valor }
async function lerContador() {
  const { data, error } = await cliente.from('config').select('valor').eq('chave', 'contadorAcessos');
  if (error) throw new Error('config: ' + error.message);
  return data.length ? { existe: true, valor: data[0].valor } : { existe: false, valor: null };
}
const antes = await (async () => { await limpar(); return contagens(); })(); // sobra de execução anterior interrompida
const contadorOriginal = await lerContador();
console.log('contador de acessos ANTES do teste:', contadorOriginal.existe ? 'valor "' + contadorOriginal.valor + '"' : 'linha ausente', '(guarde, para restaurar à mão se precisar)');
try {
  // ------------------------------- contador de acessos (função incrementar_acesso) -------------------------------
  await ta('contador: 3 chamadas simultâneas devolvem números distintos e a função existe (atômico); sem sobrescrever a linha', async () => {
    const rs = await Promise.all([1, 2, 3].map(() => h.post({ action: 'incrementarAcesso' })));
    for (const r of rs) assert.equal(typeof r.contadorAcessos, 'number', JSON.stringify(r));
    const v = rs.map((r) => r.contadorAcessos).sort((x, y) => x - y);
    assert.equal(new Set(v).size, 3, 'valores repetidos: ' + v); // visitantes reais podem se intercalar: só distintos e vão de pelo menos +2
    assert.ok(v[2] - v[0] >= 2, 'intervalo pequeno demais: ' + v);
    assert.ok((await h.get()).settings.contadorAcessos >= v[2]);
  });

  // ------------------------------- Ao Vivo -------------------------------
  await ta('prepara: jogador temporário e uma rodada rascunho de 2099', async () => {
    assert.deepEqual(await admin({ action: 'addPlayer', player: { id: P, nome: 'Teste Etapa 5', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
    assert.deepEqual(await admin({ action: 'addRound', round: rodada(R) }), { status: 'ok' });
  });

  await ta('iniciar: grava uma linha por time (data, jogadores, placar, duração fracionária) e o GET traz o aoVivo', async () => {
    assert.deepEqual(await admin({ action: 'iniciarTransmissaoAoVivo', roundId: R, duracaoMinutos: 2.5 }), { status: 'ok' });
    const av = (await h.get()).aoVivo.rounds.find((r) => r.id === R);
    assert.equal(av.data, DATA);
    assert.equal(av.duracaoMinutos, 2.5);
    assert.match(av.iniciadoEm, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(av.times, [{ nome: 'Azul', playerIds: [P], vitorias: 0 }, { nome: 'Verde', playerIds: [], vitorias: 1 }]);
    assert.deepEqual(await h.post({ action: 'lerAoVivo' }), (await h.get()).aoVivo);
    assert.match((await admin({ action: 'iniciarTransmissaoAoVivo', roundId: R, duracaoMinutos: 30 })).error, /já está sendo transmitida/);
  });

  await ta('salvarParcial: placar e log (delta fracionário incluído) voltam na leitura pública, mais recente primeiro', async () => {
    assert.deepEqual(await admin({ action: 'salvarParcialAoVivo', roundId: R, vitoriasPorTime: [2, 1.5] }), { status: 'ok' });
    const lido = await h.post({ action: 'lerAoVivo' });
    const av = lido.rounds.find((r) => r.id === R);
    assert.deepEqual(av.times.map((t) => t.vitorias), [2, 1.5]);
    const log = lido.log.filter((l) => l.roundId === R);
    assert.deepEqual(log.map((l) => [l.timeIndex, l.delta]).sort(), [[0, 2], [1, 0.5]]);
    assert.match(log[0].timestamp, /Z$/);
  });

  await ta('FK real: iniciar para rodada inexistente falha com erro do handler (não grava); inserir direto viola a chave estrangeira', async () => {
    assert.match((await admin({ action: 'iniciarTransmissaoAoVivo', roundId: 'teste-e5-nao-existe', duracaoMinutos: 30 })).error, /Rodada não encontrada/);
    await assert.rejects(() => repo.inserirAoVivo([{ round_id: 'teste-e5-nao-existe', time_index: 0, time_nome: 'x', vitorias: 0 }]), /ao_vivo:.*foreign key|ao_vivo:.*violates/);
  });

  await ta('editar a rodada durante a transmissão (gravar_rodada apaga e regrava): funciona e o Ao Vivo fica intacto', async () => {
    const antesAv = (await h.get()).aoVivo.rounds.find((r) => r.id === R);
    const editada = { ...rodada(R), times: [{ nome: 'Azul', playerIds: [P], vitorias: 9 }, { nome: 'Verde', playerIds: [], vitorias: 9 }, { nome: 'Novo', playerIds: [], vitorias: 0 }] };
    assert.deepEqual(await admin({ action: 'updateRound', round: editada }), { status: 'ok' });
    assert.deepEqual((await h.get()).aoVivo.rounds.find((r) => r.id === R), antesAv);
  });

  await ta('"Lançar placar" real: updateRound com rascunho falso, depois cancelar; o Ao Vivo some e a rodada fica lançada', async () => {
    assert.deepEqual(await admin({ action: 'updateRound', round: { ...rodada(R, false), vencedores: [0] } }), { status: 'ok' });
    assert.ok((await h.get()).aoVivo.rounds.some((r) => r.id === R)); // ainda ao vivo até o app cancelar
    assert.deepEqual(await admin({ action: 'cancelarTransmissaoAoVivo', roundId: R }), { status: 'ok' });
    const g = await h.get();
    assert.ok(!g.aoVivo.rounds.some((r) => r.id === R));
    assert.ok(!g.aoVivo.log.some((l) => l.roundId === R));
    assert.equal(g.rounds.find((r) => r.id === R).rascunho, false);
    assert.deepEqual(await admin({ action: 'cancelarTransmissaoAoVivo', roundId: R }), { status: 'ok' }); // de novo: nada a apagar
    assert.match((await admin({ action: 'iniciarTransmissaoAoVivo', roundId: R, duracaoMinutos: 30 })).error, /não é mais um rascunho/);
  });

  await ta('remover a rodada enquanto está ao vivo: a transmissão sai junto (remover_rodada do ajuste 6) e nada fica órfão', async () => {
    assert.deepEqual(await admin({ action: 'addRound', round: rodada(R2) }), { status: 'ok' });
    assert.deepEqual(await admin({ action: 'iniciarTransmissaoAoVivo', roundId: R2, duracaoMinutos: 30 }), { status: 'ok' });
    assert.deepEqual(await admin({ action: 'salvarParcialAoVivo', roundId: R2, vitoriasPorTime: [1, 1] }), { status: 'ok' });
    assert.deepEqual(await admin({ action: 'removeRound', id: R2 }), { status: 'ok' });
    const { data: a } = await cliente.from('ao_vivo').select('id').eq('round_id', R2);
    const { data: b } = await cliente.from('ao_vivo_log').select('id').eq('round_id', R2);
    assert.equal(a.length + b.length, 0);
  });
} finally {
  await limpar();
  const depois = await contagens();
  const igual = TABELAS.every((t) => antes[t] === depois[t]);
  console.log('limpeza (linhas antes -> depois):', TABELAS.map((t) => t + ' ' + antes[t] + '->' + depois[t]).join(' | '),
    igual ? '(banco como estava)' : '(ATENÇÃO: diferente!)');
  console.log('contador de acessos DEPOIS:', JSON.stringify(await lerContador()), '(esperado: 3 acima ou mais do valor de antes)');
  const { data: sobra } = await cliente.from('jogadores').select('id').eq('id', P);
  console.log('jogadores de teste restantes:', sobra.length);
}
fim();
