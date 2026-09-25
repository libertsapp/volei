// Exercita, no Supabase REAL, as ações do financeiro da etapa 4a com uma data no futuro distante e um jogador temporário,
// e LIMPA tudo o que criou (fin_* e jogador/check-in de teste), mostrando as contagens antes e depois.
// Confere também o que só o banco faz: ordem por sequência, jsonb do log, tipos numeric/date/timestamptz e (se o
// sql/schema-terca-supabase-ajuste-4.sql já foi rodado) a trava de pagamento duplicado.
// Uso: node tests/backend/integracao-etapa4a.mjs   (precisa do .env; NÃO rodar sem querer: escreve no banco de verdade)
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
const verificarToken = async () => ({ ok: true, email: 'teste-e4a@exemplo.com', nome: 'Teste 4a' });
const h = criarHandler({ repo: criarRepoSupabase(cliente), config: { adminPassword: SENHA }, verificarToken });
const admin = (corpo) => h.post({ senha: SENHA, ...corpo });
const logado = (corpo) => h.post({ idToken: 'qualquer', ...corpo }); // o "Google" falso entra como jogador: só serve para check-in

const P = 'teste-e4a-jogador';
const K = 'teste-e4a-k1';
const DIA = '2099-02-02';
const DIA2 = '2099-02-09';
const TABELAS = ['fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log'];

async function contagens() {
  const c = {};
  for (const t of TABELAS) {
    const { count, error } = await cliente.from(t).select('*', { count: 'exact', head: true });
    if (error) throw new Error(t + ': ' + error.message);
    c[t] = count;
  }
  return c;
}

// apaga só o que este teste criou: tudo com data de teste, os lançamentos de teste, o log das ações de teste e o jogador
async function limpar() {
  const datas = [DIA, DIA2];
  // cada apagamento confere o erro: falha silenciosa deixaria lixo no banco de verdade
  const conferir = (rotulo, { error }) => { if (error) console.log('AVISO: limpeza de ' + rotulo + ' falhou: ' + error.message); };
  // pagamentos por crédito referenciam créditos e créditos referenciam pagamentos: soltar antes de apagar
  conferir('fin_pagamentos.credito_id', await cliente.from('fin_pagamentos').update({ credito_id: null }).in('data', datas));
  conferir('fin_creditos', await cliente.from('fin_creditos').delete().in('data_origem', datas));
  conferir('fin_pagamentos', await cliente.from('fin_pagamentos').delete().in('data', datas));
  conferir('fin_dias', await cliente.from('fin_dias').delete().in('data', datas));
  conferir('fin_lancamentos', await cliente.from('fin_lancamentos').delete().in('data', datas));
  conferir('fin_log (e-mail de teste)', await cliente.from('fin_log').delete().eq('email', 'teste-e4a@exemplo.com'));
  // log das ações feitas com a chave mestra: uma exclusão por data de teste (o texto do detalhe traz a data)
  for (const d of datas) {
    conferir('fin_log ' + d, await cliente.from('fin_log').delete().eq('nome', 'Chave mestra').like('detalhe->>texto', '%' + d + '%'));
  }
  conferir('checkins', await cliente.from('checkins').delete().eq('id', K));
  conferir('jogadores', await cliente.from('jogadores').delete().eq('id', P));
}

const antes = await (async () => { await limpar(); return contagens(); })(); // sobra de execução anterior interrompida
try {
  await ta('prepara: jogador temporário e check-in no dia de teste', async () => {
    assert.deepEqual(await admin({ action: 'addPlayer', player: { id: P, nome: 'Teste Etapa 4a', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
    assert.deepEqual(await logado({ action: 'addCheckin', checkin: { id: K, data: DIA, jogadorId: P, jogadorNome: 'Teste Etapa 4a', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
  });

  await ta('salvarFinDia: cria o dia com arredondamento; GET igual à resposta; ordem vem da sequência (a maior)', async () => {
    const r = await admin({ action: 'salvarFinDia', dia: { data: DIA, valorPessoa: '13,999', pix: ' chave ', valorQuadra: '180.005', valorBrinde: '0,285', icone: '💰' } });
    assert.equal(r.status, 'ok', JSON.stringify(r.error));
    const g = await h.get();
    assert.deepEqual(r.financeiro, g.financeiro);
    assert.deepEqual(g.financeiro.dias.find((d) => d.data === DIA), { data: DIA, valorPessoa: 14, pix: 'chave', valorQuadra: 180.01, temBrinde: true, valorBrinde: 0.28, icone: '💰', status: '' });
    const { data } = await cliente.from('fin_dias').select('data, ordem, status').eq('data', DIA);
    const { data: todas } = await cliente.from('fin_dias').select('ordem').not('ordem', 'is', null);
    assert.equal(data[0].ordem, Math.max(...todas.map((x) => x.ordem)));
    assert.equal(data[0].status, 'normal');
  });

  await ta('salvarFinDia de novo: mantém a ordem e o status; o log guarda o texto verbatim (chaves na ordem do .gs)', async () => {
    const { data: a } = await cliente.from('fin_dias').select('ordem').eq('data', DIA);
    const r = await admin({ action: 'salvarFinDia', dia: { data: DIA, valorPessoa: 14, pix: 'chave', valorQuadra: 180, valorBrinde: 0 } });
    assert.equal(r.status, 'ok');
    const { data: b } = await cliente.from('fin_dias').select('ordem').eq('data', DIA);
    assert.equal(b[0].ordem, a[0].ordem);
    assert.match(r.financeiro.log[0].detalhe, /^\{"data":"2099-02-02","antes":\{"valorPessoa":14,/);
  });

  await ta('marcarPagamento: grava com o valor do dia, tipos certos no banco; toque repetido não duplica; estornar e marcar de novo funciona', async () => {
    const r = await admin({ action: 'marcarPagamento', data: DIA, jogadorId: P, jogadorNome: 'Teste Etapa 4a' });
    assert.equal(r.status, 'ok', JSON.stringify(r.error));
    const p = r.financeiro.pagamentos.find((x) => x.data === DIA && x.jogadorId === P);
    assert.deepEqual({ v: p.valor, t: p.tipo, e: p.estornado, por: p.marcadoPor }, { v: 14, t: 'dinheiro', e: false, por: 'Chave mestra' });
    assert.equal((await admin({ action: 'marcarPagamento', data: DIA, jogadorId: P, jogadorNome: 'x' })).financeiro.pagamentos.filter((x) => x.data === DIA).length, 1);
    // dois toques simultâneos: com o índice do ajuste 4 vira 1 só; sem ele o teste avisa em vez de falhar
    assert.equal((await admin({ action: 'estornarPagamento', id: p.id })).status, 'ok');
    const [a, b] = await Promise.all([1, 2].map(() => admin({ action: 'marcarPagamento', data: DIA, jogadorId: P, jogadorNome: 'Teste Etapa 4a' })));
    assert.equal(a.status, 'ok');
    assert.equal(b.status, 'ok');
    const validos = (await h.get()).financeiro.pagamentos.filter((x) => x.data === DIA && x.jogadorId === P && !x.estornado).length;
    if (validos !== 1) console.log('       AVISO: ' + validos + ' pagamentos válidos após toque duplo: o índice do ajuste 4 ainda NÃO foi criado no banco.');
  });

  await ta('estornarTodos / marcarTodos no dia de teste (a ação usa a lista de check-in real)', async () => {
    const e = await admin({ action: 'estornarTodosPagamentos', data: DIA });
    assert.equal(e.status, 'ok');
    assert.equal(e.ignorados, 0);
    const m = await admin({ action: 'marcarTodosPagamentos', data: DIA });
    assert.equal(m.status, 'ok');
    assert.equal(m.financeiro.pagamentos.some((x) => x.data === DIA && x.jogadorId === P && !x.estornado), true);
  });

  await ta('dia inexistente e pessoa fora da lista: mesmas mensagens do .gs', async () => {
    assert.deepEqual(await admin({ action: 'marcarPagamento', data: DIA2, jogadorId: P }), { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' });
    assert.equal((await admin({ action: 'salvarFinDia', dia: { data: DIA2, valorPessoa: 10 } })).status, 'ok');
    assert.deepEqual(await admin({ action: 'marcarPagamento', data: DIA2, jogadorId: P }), { error: 'Essa pessoa não está na lista de check-in deste dia.' });
  });

  await ta('lançamentos: entrada e saída com arredondamento; estornar; GET reflete', async () => {
    const r = await admin({ action: 'addLancamento', lancamento: { data: DIA, tipo: 'entrada', valor: '10,555', descricao: 'Teste 4a' } });
    assert.equal(r.status, 'ok', JSON.stringify(r.error));
    const l = r.financeiro.lancamentos.at(-1);
    assert.deepEqual({ v: l.valor, t: l.tipo, e: l.estornado }, { v: 10.56, t: 'entrada', e: false });
    const r2 = await admin({ action: 'estornarLancamento', id: l.id });
    assert.equal(r2.financeiro.lancamentos.find((x) => x.id === l.id).estornado, true);
    assert.deepEqual(r2.financeiro, (await h.get()).financeiro);
  });

  await ta('log: cada ação escreveu no fin_log (detalhe em jsonb como { texto }) e o e-mail não vai no GET', async () => {
    const g = await h.get();
    assert.equal(JSON.stringify(g.financeiro).includes('teste-e4a@exemplo.com'), false);
    const { data } = await cliente.from('fin_log').select('acao, detalhe').ilike('detalhe->>texto', '%' + DIA + '%');
    assert.ok(data.length >= 5, 'poucas linhas de log: ' + data.length);
    assert.ok(data.every((x) => typeof x.detalhe.texto === 'string'));
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
