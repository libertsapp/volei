import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { mapearFinanceiro, mapearCheckins } from '../../backend/mapeadores.js';
import {
  salvarFinDia, marcarPagamento, estornarPagamento, marcarTodosPagamentos, estornarTodosPagamentos,
  marcarDiaSemJogo, reabrirDia, aplicarCreditos
} from '../../backend/financeiro.js';

const ORG = { perfil: 'organizador', nome: 'Org', email: 'o@x.com', viaChaveMestra: false };
const ADM = { perfil: 'admin', nome: 'Adm', email: 'a@x.com', viaChaveMestra: false };
const DATA = '2026-10-06';

function ambiente(ajustar) {
  const dados = {
    jogadores: [1, 2, 3].map((i) => ({ id: 'p' + i, nome: 'J' + i, convidado: false, removido: false, ordem: i })),
    checkins: [
      { id: 'c1', data: DATA, jogador_id: 'p1', jogador_nome: 'J1', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 1, ordem: 1 },
      { id: 'c2', data: DATA, jogador_id: 'p2', jogador_nome: 'J2', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 2, ordem: 1 },
      { id: 'c3', data: DATA, jogador_id: 'p1', jogador_nome: 'J1', estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo: 2, ordem: 2 } // p1 nos dois jogos
    ],
    config: [{ chave: 'checkinVagas', valor: '16' }, { chave: 'checkinJogo2Data', valor: DATA }, { chave: 'checkinJogo2Vagas', valor: '16' }],
    fin_dias: [], fin_pagamentos: [], fin_creditos: [], fin_lancamentos: [], fin_log: [], fin_jogos: []
  };
  if (ajustar) ajustar(dados);
  let n = 0;
  return { repo: criarRepoMemoria(dados), relogio: () => new Date('2026-10-06T12:00:00.000Z'), gerarId: () => 'id-' + (++n) };
}
const fin = async (d) => mapearFinanceiro(await d.repo.lerTudo());

await ta('salvarFinDia: único (padrão) — jogo 2 recusado sem "separado por jogo" configurado', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' }, ORG);
  assert.deepEqual(await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 15, valorQuadra: 150, valorBrinde: 0, pix: '' }, ORG),
    { error: 'Configure "Separado por jogo" antes de editar o 2º jogo.' });
});

await ta('único: um pagamento cobre os 2 jogos; quem está nos dois conta uma vez só (pendentes)', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' }, ORG);
  const r = await marcarPagamento(d, DATA, null, 'p1', 'J1', ORG);
  assert.equal(r.financeiro.pagamentos.length, 1);
  assert.equal(r.financeiro.pagamentos[0].jogo, null); // "do dia", não 1
  // marcar todos: só falta p2 (p1 já pagou, conta uma vez mesmo estando nos 2 jogos; p3 não está em nenhum)
  const r2 = await marcarTodosPagamentos(d, DATA, null, ORG);
  assert.equal(r2.financeiro.pagamentos.length, 2);
  assert.ok(r2.financeiro.pagamentos.some((p) => p.jogadorId === 'p2'));
});

await ta('separado: cada jogo cobra o seu; quem está nos dois paga os dois', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG);
  await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: 'px' }, ORG);
  const r1 = await marcarPagamento(d, DATA, 1, 'p1', 'J1', ORG);
  assert.equal(r1.financeiro.pagamentos.find((p) => p.jogo === 1).valor, 15);
  const r2 = await marcarPagamento(d, DATA, 2, 'p1', 'J1', ORG);
  assert.equal(r2.financeiro.pagamentos.length, 2); // dois pagamentos distintos pra mesma pessoa, um por jogo
  assert.equal(r2.financeiro.pagamentos.find((p) => p.jogo === 2).valor, 20);
  // p3 não está no jogo 1: recusado
  assert.deepEqual(await marcarPagamento(d, DATA, 1, 'p3', 'J3', ORG), { error: 'Essa pessoa não está na lista de check-in deste dia.' });
});

await ta('trocar único↔separado é bloqueado se já há pagamento válido no dia', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '' }, ORG);
  await marcarPagamento(d, DATA, null, 'p1', 'J1', ORG);
  assert.deepEqual(await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG),
    { error: 'Já há pagamento(s) neste dia. Para trocar, use "Cancelar todos" antes.' });
});

await ta('separado: "sem jogo" só no jogo 2 — a quadra do jogo 1 continua contando; crédito guarda jogoOrigem', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG);
  await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: '' }, ORG);
  await marcarPagamento(d, DATA, 2, 'p2', 'J2', ORG);
  const r = await marcarDiaSemJogo(d, DATA, 2, 'credito', ORG);
  assert.equal(r.creditos, 1);
  const f = await fin(d);
  assert.equal(f.jogos.find((j) => j.jogo === 2).status, 'semjogo');
  assert.equal(f.dias.find((x) => x.data === DATA).status, ''); // jogo 1 continua normal
  assert.equal(f.creditos[0].jogoOrigem, 2);
});

await ta('crédito de um jogo de hoje nunca paga o outro jogo (nem o dia) de hoje — só datas futuras', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG);
  await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: '' }, ORG);
  await marcarPagamento(d, DATA, 2, 'p2', 'J2', ORG);
  await marcarDiaSemJogo(d, DATA, 2, 'credito', ORG); // p2 ganha crédito de hoje
  const n = await aplicarCreditos(d, DATA, 1, ORG); // tentar aplicar no jogo 1 de HOJE
  assert.equal(n, 0);
});

await ta('reabrirDia: separado, só o jogo 2; jogo 1 não é tocado', async () => {
  const d = ambiente();
  await salvarFinDia(d, { data: DATA, valorPessoa: 15, valorQuadra: 300, valorBrinde: 0, pix: '', porJogo: true }, ORG);
  await salvarFinDia(d, { data: DATA, jogo: 2, valorPessoa: 20, valorQuadra: 150, valorBrinde: 0, pix: '' }, ORG);
  await marcarDiaSemJogo(d, DATA, 2, 'devolver', ADM);
  assert.equal((await reabrirDia(d, DATA, 2, ADM)).status, 'ok');
  const f = await fin(d);
  // convenção já travada pelo mapeadores.js (Task 5): status "normal" sempre mapeia para '' (só "semjogo" é especial)
  assert.equal(f.jogos.find((j) => j.jogo === 2).status, '');
});

fim();
