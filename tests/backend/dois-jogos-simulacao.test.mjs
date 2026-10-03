// tests/backend/dois-jogos-simulacao.test.mjs
// 200 sequências aleatórias de ações (confirmar, desconfirmar, mover, pagar, estornar, sem jogo, trocar modo,
// remover o 2º jogo) nos modos único e separado. Depois de CADA ação, confere invariantes que nunca podem quebrar.
// Falha com a semente (SEED) impressa, pra reproduzir o caso exato.
import assert from 'node:assert/strict';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const escolhe = (rand, lista) => lista[Math.floor(rand() * lista.length)];
const DATA = '2026-10-06';
const ORG = { action: 'ping', senha: 'senha-teste' };

function novoHandler() {
  return criarHandler({
    repo: criarRepoMemoria({
      jogadores: [1, 2, 3, 4, 5].map((i) => ({ id: 'p' + i, nome: 'J' + i, convidado: false, removido: false, ordem: i })),
      config: [{ chave: 'checkinDataAberta', valor: DATA }, { chave: 'checkinHorario', valor: '19:00' }, { chave: 'checkinVagas', valor: '3' }],
      checkins: [], fin_dias: [], fin_jogos: [], fin_pagamentos: [], fin_creditos: []
    }),
    config: { adminPassword: 'senha-teste' },
    relogio: () => new Date('2026-10-06T12:00:00.000Z'),
    gerarId: (() => { let n = 0; return () => 'id-' + (++n); })()
  });
}

async function conferirInvariantes(h, comQueAcao) {
  const t = await h.get();
  // nunca duas pessoas na mesma vaga do mesmo jogo (mesmo jogadorId duas vezes no mesmo "jogo")
  const vistosPorJogo = new Map();
  for (const c of t.checkins) {
    const chave = c.data + '|' + c.jogo + '|' + c.jogadorId;
    assert.ok(!vistosPorJogo.has(chave), `jogador duplicado no mesmo jogo após ${comQueAcao}: ${chave}`);
    vistosPorJogo.set(chave, true);
  }
  // nunca dois pagamentos válidos por (data, chave, jogador)
  const vistosPag = new Map();
  for (const p of t.financeiro.pagamentos) {
    if (p.estornado) continue;
    const chave = p.data + '|' + (p.jogo ?? 'dia') + '|' + p.jogadorId;
    assert.ok(!vistosPag.has(chave), `pagamento duplicado após ${comQueAcao}: ${chave}`);
    vistosPag.set(chave, true);
  }
  // o caixa é sempre a soma dos registros (dinheiro válido − saídas dos jogos não-sem-jogo; aqui só confere que não é NaN/infinito)
  const caixa = t.financeiro.pagamentos.filter((p) => !p.estornado && p.tipo !== 'credito').reduce((s, p) => s + p.valor, 0);
  assert.ok(Number.isFinite(caixa), `caixa não numérico após ${comQueAcao}`);
}

async function umaSequencia(seed) {
  const rand = rng(seed);
  const h = novoHandler();
  let porJogo = false;
  for (let i = 0; i < 40; i++) {
    const jogador = escolhe(rand, ['p1', 'p2', 'p3', 'p4', 'p5']);
    const jogo = escolhe(rand, [1, 2]);
    const acao = escolhe(rand, ['confirmar', 'confirmar', 'desconfirmar', 'mover', 'pagar', 'estornar', 'semjogo', 'reabrir', 'trocarModo', 'add2', 'remove2']);
    try {
      if (acao === 'add2') { await h.post({ ...ORG, action: 'salvarJogo2', jogo2: { data: DATA, horario: '21:00', vagas: 3 } }); }
      else if (acao === 'remove2') { await h.post({ ...ORG, action: 'removerJogo2', data: DATA, destino: escolhe(rand, ['mover', 'desconfirmar']) }); porJogo = false; }
      else if (acao === 'confirmar') { await h.post({ action: 'addCheckin', checkin: { id: 'c' + i, data: DATA, jogadorId: jogador, jogo } }); }
      else if (acao === 'desconfirmar') {
        const get = await h.get();
        const alvo = get.checkins.find((c) => c.jogadorId === jogador && c.jogo === jogo);
        if (alvo) await h.post({ action: 'removeCheckin', id: alvo.id });
      } else if (acao === 'mover') {
        const get = await h.get();
        const alvo = get.checkins.find((c) => c.jogadorId === jogador);
        if (alvo) await h.post({ ...ORG, action: 'moverCheckin', id: alvo.id, paraJogo: alvo.jogo === 1 ? 2 : 1 });
      } else if (acao === 'pagar') {
        await h.post({ ...ORG, action: 'salvarFinDia', dia: { data: DATA, jogo: porJogo ? jogo : undefined, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' } });
        await h.post({ ...ORG, action: 'marcarPagamento', data: DATA, jogo: porJogo ? jogo : null, jogadorId: jogador, jogadorNome: jogador });
      } else if (acao === 'estornar') {
        const get = await h.get();
        const p = get.financeiro.pagamentos.find((x) => x.jogadorId === jogador && !x.estornado);
        if (p) await h.post({ ...ORG, action: 'estornarPagamento', id: p.id });
      } else if (acao === 'semjogo') {
        await h.post({ ...ORG, action: 'salvarFinDia', dia: { data: DATA, jogo: porJogo ? jogo : undefined, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' } });
        await h.post({ ...ORG, action: 'marcarDiaSemJogo', data: DATA, jogo: porJogo ? jogo : null, destino: escolhe(rand, ['credito', 'devolver']) });
      } else if (acao === 'reabrir') {
        await h.post({ ...ORG, action: 'reabrirDia', data: DATA, jogo: porJogo ? jogo : null });
      } else if (acao === 'trocarModo') {
        const get = await h.get();
        if (get.financeiro.dias.length) {
          const r = await h.post({ ...ORG, action: 'salvarFinDia', dia: { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: !porJogo } });
          if (!r.error) porJogo = !porJogo;
        }
      }
    } catch (e) { throw new Error(`seed ${seed}, passo ${i} (${acao}): ${e.message}`); }
    await conferirInvariantes(h, `seed ${seed}, passo ${i} (${acao})`);
  }
}

(async () => {
  for (let seed = 1; seed <= 200; seed++) await umaSequencia(seed);
  console.log('ok — simulação (200 sequências) sem violar nenhuma regra');
})().catch((e) => { console.error(e); process.exit(1); });
