// Exercita, no Supabase REAL, a etapa 4b (dia sem jogo, crédito, ganchos do check-in e a trava de gravação) com datas de 2099
// e um jogador temporário, e LIMPA tudo o que criou (fin_*, checkins, jogadores e travas de teste), mostrando as contagens
// antes e depois.
// PRESSUPOSTO: o sql/schema-terca-supabase-ajuste-5.sql (tabela travas + funções pegar_trava/soltar_trava) JÁ foi rodado no SQL Editor.
// Uso: node tests/backend/integracao-etapa4b.mjs   (precisa do .env; NÃO rodar sem querer: escreve no banco de verdade)
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
const verificarToken = async () => ({ ok: true, email: 'teste-e4b@exemplo.com', nome: 'Teste 4b' });
const h = criarHandler({ repo, config: { adminPassword: SENHA }, verificarToken });
const admin = (corpo) => h.post({ senha: SENHA, ...corpo });
const logado = (corpo) => h.post({ idToken: 'qualquer', ...corpo }); // o "Google" falso: só serve para check-in

const P = 'teste-e4b-jogador';
const DIA1 = '2099-03-02'; // dia que vira "sem jogo"
const DIA2 = '2099-03-09'; // dia em que o crédito é usado
const DATAS = [DIA1, DIA2];
const CHECKINS = ['teste-e4b-k1', 'teste-e4b-k2', 'teste-e4b-k3'];
const TRAVA = 'teste-e4b-trava'; // nome PRÓPRIO: não mexe na trava 'gravacao' que o app usa de verdade
const TABELAS = ['fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'checkins', 'jogadores', 'travas'];

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
  // pagamentos por crédito referenciam créditos e créditos referenciam pagamentos: soltar antes de apagar
  conferir('fin_pagamentos.credito_id', await cliente.from('fin_pagamentos').update({ credito_id: null }).in('data', DATAS));
  conferir('fin_creditos', await cliente.from('fin_creditos').delete().in('data_origem', DATAS));
  conferir('fin_pagamentos', await cliente.from('fin_pagamentos').delete().in('data', DATAS));
  conferir('fin_dias', await cliente.from('fin_dias').delete().in('data', DATAS));
  conferir('fin_lancamentos', await cliente.from('fin_lancamentos').delete().in('data', DATAS));
  conferir('fin_log (e-mail de teste)', await cliente.from('fin_log').delete().eq('email', 'teste-e4b@exemplo.com'));
  for (const d of DATAS) { // ações feitas com a chave mestra e as do "Crédito automático" (sem e-mail): o texto do log traz a data
    conferir('fin_log chave mestra ' + d, await cliente.from('fin_log').delete().eq('nome', 'Chave mestra').like('detalhe->>texto', '%' + d + '%'));
    conferir('fin_log crédito automático ' + d, await cliente.from('fin_log').delete().eq('nome', 'Crédito automático').like('detalhe->>texto', '%' + d + '%'));
  }
  conferir('checkins', await cliente.from('checkins').delete().in('id', CHECKINS));
  conferir('jogadores', await cliente.from('jogadores').delete().eq('id', P));
  conferir('travas', await cliente.from('travas').delete().like('nome', 'teste-e4b%'));
}

const pagamentosDo = async (data) => (await h.get()).financeiro.pagamentos.filter((p) => p.data === data);
const creditosDo = async (data) => (await h.get()).financeiro.creditos.filter((c) => c.dataOrigem === data);
const entra = (id, data) => logado({ action: 'addCheckin', checkin: { id, data, jogadorId: P, jogadorNome: 'Teste Etapa 4b', estrelas: 3, sexo: 'M' } });

const antes = await (async () => { await limpar(); return contagens(); })(); // sobra de execução anterior interrompida
try {
  // ------------------------------- a trava de verdade (funções do ajuste 5) -------------------------------
  await ta('trava real: pegar duas vezes com donos diferentes -> a segunda é recusada; o mesmo dono renova', async () => {
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-A', 30), true);
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-B', 30), false);
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-A', 30), true);
  });

  await ta('trava real: soltar só vale para o dono; depois de solta outro dono pega', async () => {
    await repo.soltarTrava(TRAVA, 'dono-B'); // não é o dono: nada acontece
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-B', 30), false);
    await repo.soltarTrava(TRAVA, 'dono-A');
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-B', 30), true);
    await repo.soltarTrava(TRAVA, 'dono-B');
  });

  await ta('trava real: aluguel vencido pode ser tomado por outro dono (ttl de 1 s)', async () => {
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-A', 1), true);
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-B', 30), false);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-B', 30), true);
    assert.equal(await repo.pegarTrava(TRAVA, 'dono-A', 30), false); // agora é do B
    await repo.soltarTrava(TRAVA, 'dono-B');
    const { data } = await cliente.from('travas').select('nome').eq('nome', TRAVA);
    assert.equal(data.length, 0);
  });

  // ------------------------------- ações e ganchos -------------------------------
  await ta('prepara: jogador temporário, dia 1 (10 por pessoa), check-in e pagamento em dinheiro', async () => {
    assert.deepEqual(await admin({ action: 'addPlayer', player: { id: P, nome: 'Teste Etapa 4b', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
    assert.equal((await admin({ action: 'salvarFinDia', dia: { data: DIA1, valorPessoa: 10, pix: 'p', valorQuadra: 50, valorBrinde: 0 } })).status, 'ok');
    assert.deepEqual(await entra(CHECKINS[0], DIA1), { status: 'ok' });
    const r = await admin({ action: 'marcarPagamento', data: DIA1, jogadorId: P, jogadorNome: 'Teste Etapa 4b' });
    assert.equal(r.status, 'ok', JSON.stringify(r.error));
  });

  await ta('marcarDiaSemJogo: o dinheiro vira crédito; status no banco; contadores; log verbatim em jsonb { texto }', async () => {
    const r = await admin({ action: 'marcarDiaSemJogo', data: DIA1 });
    assert.equal(r.status, 'ok', JSON.stringify(r.error));
    assert.deepEqual([r.creditos, r.estornados, r.ignorados], [1, 0, 0]);
    const { data: dia } = await cliente.from('fin_dias').select('status').eq('data', DIA1);
    assert.equal(dia[0].status, 'semjogo');
    const c = (await creditosDo(DIA1))[0];
    assert.deepEqual({ j: c.jogadorId, v: c.valor, s: c.status, por: c.criadoPor }, { j: P, v: 10, s: 'ativo', por: 'Chave mestra' });
    assert.equal(r.financeiro.log[0].detalhe, '{"data":"' + DIA1 + '","destino":"credito","creditos":1,"estornados":0,"ignorados":0,"nomes":["Teste Etapa 4b"]}');
    assert.deepEqual(r.financeiro, (await h.get()).financeiro);
    // idempotente
    assert.deepEqual((await admin({ action: 'marcarDiaSemJogo', data: DIA1 })).creditos, 0);
  });

  await ta('gancho de entrada: dia 2 configurado e check-in de quem tem crédito -> aparece pago por crédito (Crédito automático)', async () => {
    assert.equal((await admin({ action: 'salvarFinDia', dia: { data: DIA2, valorPessoa: 10, pix: '', valorQuadra: 0, valorBrinde: 0 } })).status, 'ok');
    assert.deepEqual(await entra(CHECKINS[1], DIA2), { status: 'ok' });
    const p = (await pagamentosDo(DIA2)).filter((x) => !x.estornado);
    assert.equal(p.length, 1);
    assert.deepEqual({ t: p[0].tipo, v: p[0].valor, por: p[0].marcadoPor, c: p[0].creditoId }, { t: 'credito', v: 10, por: 'Crédito automático', c: (await creditosDo(DIA1))[0].id });
  });

  await ta('reabrirDia: recusa enquanto o crédito está em uso em outro dia (nada muda)', async () => {
    const r = await admin({ action: 'reabrirDia', data: DIA1 });
    assert.equal(r.error, 'Não dá para reabrir: 1 crédito(s) deste dia já foram usados em outro dia.');
  });

  await ta('gancho de saída: quem sai devolve o crédito (pagamento por crédito estornado, log "saiu da lista")', async () => {
    assert.deepEqual(await logado({ action: 'removeCheckin', id: CHECKINS[1] }), { status: 'ok' });
    const p = await pagamentosDo(DIA2);
    assert.equal(p.filter((x) => !x.estornado).length, 0);
    assert.equal(p.filter((x) => x.estornado && x.estornadoPor === 'Crédito automático').length, 1);
    const g = await h.get();
    assert.ok(g.financeiro.log.some((l) => l.detalhe.includes('"motivo":"saiu da lista: crédito devolvido ao saldo"') && l.detalhe.includes(DIA2)));
  });

  await ta('aplicarCreditosDoDia (manual): sem ninguém na lista aplica 0; depois do gancho de entrada não duplica', async () => {
    assert.equal((await admin({ action: 'aplicarCreditosDoDia', data: DIA2 })).aplicados, 0);
    // o gancho de entrada já aplica o crédito; a ação manual logo depois não pode duplicar
    assert.deepEqual(await entra(CHECKINS[2], DIA2), { status: 'ok' });
    assert.equal((await pagamentosDo(DIA2)).filter((x) => !x.estornado && x.tipo === 'credito').length, 1);
    assert.equal((await admin({ action: 'aplicarCreditosDoDia', data: DIA2 })).aplicados, 0);
  });

  await ta('saída de novo e reabrirDia agora vale: cancela o crédito, dia volta a normal (status no banco)', async () => {
    assert.deepEqual(await logado({ action: 'removeCheckin', id: CHECKINS[2] }), { status: 'ok' });
    const r = await admin({ action: 'reabrirDia', data: DIA1 });
    assert.equal(r.status, 'ok', JSON.stringify(r.error));
    assert.equal((await creditosDo(DIA1))[0].status, 'cancelado');
    const { data: dia } = await cliente.from('fin_dias').select('status').eq('data', DIA1);
    assert.equal(dia[0].status, 'normal');
    assert.match(r.financeiro.log.find((l) => l.acao === 'reabrirDia').detalhe, /"creditosCancelados":1\}$/);
  });

  await ta('devolverCredito: de novo sem jogo -> crédito novo; devolve o dinheiro (origem estornada, crédito devolvido); crédito cancelado não está ativo', async () => {
    const canc = (await creditosDo(DIA1))[0].id;
    assert.equal((await admin({ action: 'devolverCredito', id: canc })).error, 'Este crédito não está ativo.');
    assert.equal((await admin({ action: 'marcarDiaSemJogo', data: DIA1 })).creditos, 1);
    const novo = (await creditosDo(DIA1)).find((c) => c.status === 'ativo');
    const r = await admin({ action: 'devolverCredito', id: novo.id });
    assert.equal(r.status, 'ok', JSON.stringify(r.error));
    assert.equal(r.financeiro.creditos.find((c) => c.id === novo.id).status, 'devolvido');
    assert.equal(r.financeiro.pagamentos.find((p) => p.id === novo.origemPagamentoId).estornado, true);
    assert.equal((await admin({ action: 'devolverCredito', id: novo.id })).status, 'ok'); // idempotente
  });

  await ta('trava no handler: duas ações simultâneas terminam ok, em série, e a trava "gravacao" fica livre', async () => {
    const [a, b] = await Promise.all([
      admin({ action: 'addLancamento', lancamento: { data: DIA2, tipo: 'entrada', valor: 1, descricao: 'teste 4b (1)' } }),
      admin({ action: 'addLancamento', lancamento: { data: DIA2, tipo: 'saida', valor: 2, descricao: 'teste 4b (2)' } })
    ]);
    assert.equal(a.status, 'ok', JSON.stringify(a.error));
    assert.equal(b.status, 'ok', JSON.stringify(b.error));
    assert.equal((await h.get()).financeiro.lancamentos.filter((l) => l.data === DIA2).length, 2);
    const { data } = await cliente.from('travas').select('nome').eq('nome', 'gravacao');
    assert.equal(data.length, 0);
  });
} finally {
  await limpar();
  const depois = await contagens();
  const igual = TABELAS.every((t) => antes[t] === depois[t]);
  console.log('limpeza (linhas antes -> depois):', TABELAS.map((t) => t + ' ' + antes[t] + '->' + depois[t]).join(' | '),
    igual ? '(banco como estava)' : '(ATENÇÃO: diferente!)');
  const { data: sobra } = await cliente.from('jogadores').select('id').eq('id', P);
  console.log('jogadores de teste restantes:', sobra.length);
}
fim();
