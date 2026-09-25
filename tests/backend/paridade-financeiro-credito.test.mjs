import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { dbParaAbas } from './dbParaAbas.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { criarVerificadorGoogle } from '../../backend/auth.js';

// Teste diferencial da etapa 4b: o .gs REAL (planilha falsa) e o backend novo (repositório em memória) recebem os mesmos pedidos;
// depois de CADA passo compara-se a resposta e o GET inteiro (com o financeiro). Cobre marcarDiaSemJogo, reabrirDia,
// aplicarCreditosDoDia, devolverCredito e os ganchos do check-in, estes últimos acionados pelos addCheckin/removeCheckin de
// verdade (com token), como no paridade-checkins. Nada é normalizado: relógio (Date do .gs e relogio() do backend) e ids
// (Utilities.getUuid x gerarId, ambos 'uuid-N') controlados e iguais dos dois lados; a trava de gravação do backend usa outro
// gerador (gerarDono) justamente para não gastar ids da sequência.
const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');
if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - apps-script-codigo.gs não existe nesta pasta (o arquivo é ignorado pelo git; copie-o da máquina do usuário).');
  process.exit(0);
}
const { criarAmbiente } = require('../helpers/planilha-falsa.js');
const json = (x) => JSON.parse(JSON.stringify(x));

// ---------- estado inicial do cenário 1: fixture + Carla, Diego, Eva e créditos de vários tamanhos ----------
// fixture: dia 22/09 normal (14), 15/09 sem jogo; Ana paga (pg1), Bruno tem o crédito cr1 (14) de 15/09.
const dados = structuredClone(fixture);
dados.jogadores.push(
  { id: 'p3', nome: 'Carla', apelido: null, foto: '', estrelas: 3, sexo: 'F', porte: 'M', convidado: false, removido: false, ordem: 3 },
  { id: 'p4', nome: 'Diego', apelido: null, foto: '', estrelas: 2, sexo: 'M', porte: 'G', convidado: false, removido: false, ordem: 4 },
  { id: 'p5', nome: 'Eva', apelido: null, foto: '', estrelas: 2, sexo: 'F', porte: 'P', convidado: false, removido: false, ordem: 5 });
const pag = (id, data, jid, nome, valor, ordem) => ({ id, data, jogador_id: jid, jogador_nome: nome, valor, marcado_por: 'Org',
  marcado_em: data + 'T19:00:00+00:00', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, ordem });
// dinheiro de dias sem jogo que virou crédito: Ana tem DOIS (cr2 mais antigo, cr5), Carla cr3 (14), Diego cr4 (20: sobra saldo parcial)
dados.fin_dias.push({ data: '2026-09-08', valor_pessoa: 14, pix: '', valor_quadra: 0, tem_brinde: false, valor_brinde: 0, atualizado_por: 'Adm', atualizado_em: '2026-09-08T18:00:00+00:00', icone: null, status: 'semjogo', ordem: 3 });
dados.fin_pagamentos.push(pag('pg8', '2026-09-08', 'p1', 'Ana', 14, 4), pag('pg4', '2026-09-15', 'p3', 'Carla', 14, 5),
  pag('pg5', '2026-09-15', 'p4', 'Diego', 20, 6), pag('pg6', '2026-09-15', 'p1', 'Ana', 14, 7));
const cred = (id, jid, nome, valor, origem, dataOrigem, ordem) => ({ id, jogador_id: jid, jogador_nome: nome, valor, origem_pagamento_id: origem, data_origem: dataOrigem,
  criado_por: 'Adm', criado_em: dataOrigem + 'T21:00:00+00:00', status: 'ativo', encerrado_por: null, encerrado_em: null, ordem });
dados.fin_creditos.push(cred('cr2', 'p1', 'Ana', 14, 'pg8', '2026-09-08', 2), cred('cr3', 'p3', 'Carla', 14, 'pg4', '2026-09-15', 3),
  cred('cr4', 'p4', 'Diego', 20, 'pg5', '2026-09-15', 4), cred('cr5', 'p1', 'Ana', 14, 'pg6', '2026-09-15', 5));

// ---------- o "Google" falso, igual para os dois lados ----------
function montar(estadoInicial, semAbasFin) {
  const T0 = Date.now();
  const gs = criarAmbiente(dbParaAbas(estadoInicial), [caminhoGs]);
  if (semAbasFin) for (const n of ['FinDias', 'FinPagamentos', 'FinCreditos', 'FinLancamentos', 'FinLog']) delete gs.abas[n]; // o .gs cria sozinho na 1ª gravação
  // relógio controlado no .gs (antes de qualquer Date criado no contexto, para o instanceof Date continuar valendo)
  gs.rodar('var __relogio = { t: ' + T0 + ' }; Date = (function (R) { return class D extends R { constructor(...a) { if (a.length === 0) super(__relogio.t); else super(...a); } static now() { return __relogio.t; } }; })(Date);');
  const linhasUsuarios = gs.abas.Usuarios.linhas;
  estadoInicial.usuarios.slice().sort((a, b) => a.ordem - b.ordem).forEach((u, i) => {
    linhasUsuarios[i + 1][4] = gs.rodar('new Date(' + JSON.stringify(new Date(u.criado_em).toISOString()) + ')');
  });
  const CLIENTE = gs.rodar('GOOGLE_CLIENT_ID');
  const SENHA = gs.rodar('ADMIN_PASSWORD'); // lida do .gs carregado, nunca em texto puro nos testes
  const exp = String(Math.floor(T0 / 1000) + 3600);
  const base = { aud: CLIENTE, email_verified: 'true', exp };
  const google = {
    'tok-a': { ...base, email: 'a@exemplo.com', name: 'A' },
    'tok-b': { ...base, email: 'b@exemplo.com', name: 'B' },
    'tok-c': { ...base, email: 'c@exemplo.com', name: 'C' }
  };
  gs.rodar('UrlFetchApp.fetch = function (url) { var t = decodeURIComponent(url.split("id_token=")[1]); var r = (' + JSON.stringify(google) + ')[t]; '
    + 'return r ? { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(r); } } '
    + ': { getResponseCode: function () { return 400; }, getContentText: function () { return "{}"; } }; };');
  const buscar = async (url) => {
    const t = decodeURIComponent(url.split('id_token=')[1]);
    return google[t] ? { status: 200, json: async () => google[t] } : { status: 400, json: async () => ({}) };
  };
  const relogio = { t: T0 };
  let seq = 0;
  const repo = criarRepoMemoria(estadoInicial);
  const novo = criarHandler({
    repo, config: { adminPassword: SENHA }, verificarToken: criarVerificadorGoogle({ clientId: CLIENTE, buscar }),
    relogio: () => new Date(relogio.t), gerarId: () => 'uuid-' + (++seq)
  });
  const avancar = (i) => { relogio.t = T0 + i * 1000 + 123; gs.rodar('__relogio.t = ' + relogio.t); };
  return { gs, repo, novo, SENHA, avancar };
}

// passo: [nome, corpo | (env)=>corpo, esperado] — esperado: 'ok' ou um trecho da mensagem de erro (garante que os dois lados
// fizeram o que o passo queria, não só que erraram igual). Passo AMBIENTE: [nome, { ambiente: (env) => ... }]
const definirVagas = (env, n) => {
  env.gs.abas.Config.linhas.find((l) => l[0] === 'checkinVagas')[1] = String(n);
  env.repo.tabelas.config.find((c) => c.chave === 'checkinVagas').valor = String(n);
};
const creditoDe = (env, jogadorId, dataOrigem, status) => {
  const c = env.gs.get().financeiro.creditos.filter((x) => x.jogadorId === jogadorId && x.dataOrigem === dataOrigem && x.status === status);
  assert.equal(c.length >= 1, true, 'crédito de ' + jogadorId + ' de ' + dataOrigem + ' (' + status + ') não encontrado');
  return c.at(-1).id;
};

async function rodar(titulo, env, passos) {
  const S = env.SENHA;
  for (const [i, [nome, corpo0, esperado]] of passos.entries()) {
    await ta(`${titulo} passo ${String(i + 1).padStart(2, '0')}: ${nome}`, async () => {
      env.avancar(i + 1);
      if (corpo0 && corpo0.ambiente) corpo0.ambiente(env);
      else {
        const corpo = typeof corpo0 === 'function' ? corpo0(env, S) : corpo0;
        const esperadoGs = env.gs.post(corpo);
        if (process.env.DBG) { const { financeiro: f, ...r } = esperadoGs; console.log('   >', JSON.stringify(r), f && f.log.slice(0, 3).map((l) => l.acao + ' ' + l.detalhe).join(' | ')); }
        const obtido = json(await env.novo.post(corpo));
        assert.deepEqual(obtido, esperadoGs, 'resposta diferente');
        if (esperado === 'ok') assert.equal(esperadoGs.status, 'ok', 'era para dar ok: ' + JSON.stringify(esperadoGs.error));
        else if (esperado) assert.ok(String(esperadoGs.error).includes(esperado), 'erro esperado "' + esperado + '", veio ' + JSON.stringify(esperadoGs.error));
      }
      assert.deepEqual(json(await env.novo.get()), env.gs.get(), 'o GET (com o financeiro) ficou diferente depois deste passo');
    });
  }
}

const env1 = montar(dados);
const A = (nome, corpo, esperado) => [nome, corpo, esperado];
const nomes = { p1: 'Ana', p2: 'Bruno', p3: 'Carla', p4: 'Diego', p5: 'Eva' };
const entrar = (id, data, jid, tok = 'tok-c') => ({ action: 'addCheckin', idToken: tok,
  checkin: { id, data, jogadorId: jid, jogadorNome: nomes[jid], estrelas: 3, sexo: 'M' } });
const sair = (id, tok = 'tok-c') => ({ action: 'removeCheckin', idToken: tok, id });
const dia = (data, valorPessoa) => ({ action: 'salvarFinDia', idToken: 'tok-b', dia: { data, valorPessoa, pix: 'chave', valorQuadra: 100, valorBrinde: 0 } });

const passos1 = [
  // ---- ganchos do check-in: dia ainda não configurado (nada acontece), depois o salvarFinDia aplica os créditos ----
  A('addCheckin Ana em 29/09 (dia ainda não configurado: gancho não faz nada)', entrar('k1', '2026-09-29', 'p1'), 'ok'),
  A('addCheckin Bruno', entrar('k2', '2026-09-29', 'p2'), 'ok'),
  A('addCheckin Carla', entrar('k3', '2026-09-29', 'p3'), 'ok'),
  A('addCheckin Diego', entrar('k4', '2026-09-29', 'p4'), 'ok'),
  A('salvarFinDia 29/09 (14): créditos entram, o MAIS ANTIGO da Ana (cr2) e o parcial do Diego (cr4 de 20)', dia('2026-09-29', 14), 'ok'),
  A('addCheckin Eva (sem crédito: nada de pagamento novo)', entrar('k5', '2026-09-29', 'p5'), 'ok'),
  A('removeCheckin Bruno: o crédito dele usado no dia volta (pagamento por crédito estornado, log "saiu da lista")', sair('k2'), 'ok'),
  A('addCheckin Bruno de novo (vai para o fim): o gancho reaplica o crédito', entrar('k6', '2026-09-29', 'p2'), 'ok'),
  A('removeCheckin Ana e volta: reaplica o cr2 (o mais antigo com saldo)', sair('k1'), 'ok'),
  A('addCheckin Ana (de novo)', entrar('k7', '2026-09-29', 'p1'), 'ok'),
  A('removeCheckin que não existe: erro, sem gancho', sair('k-nao-existe'), 'Check-in não encontrado'),
  A('removeCheckin sem token: erro do token, nada muda', { action: 'removeCheckin', id: 'k4' }, 'Sem token'),
  A('addCheckin com a chave mestra sozinha não vale', (env, S) => ({ ...entrar('k8', '2026-09-29', 'p5'), idToken: undefined, senha: S }), 'Sem token'),
  // ---- vagas curtas: promoção da espera dentro das vagas pelo gancho de remoção ----
  A('AMBIENTE: só 2 vagas', { ambiente: (env) => definirVagas(env, 2) }),
  A('salvarFinDia 13/10 (12,5) com 2 vagas', dia('2026-10-13', 12.5), 'ok'),
  A('addCheckin Eva em 13/10 (dentro)', entrar('m1', '2026-10-13', 'p5'), 'ok'),
  A('addCheckin Carla em 13/10 (dentro; o crédito cr3 dela já foi gasto em 29/09)', entrar('m2', '2026-10-13', 'p3'), 'ok'),
  A('addCheckin Ana em 13/10 (na ESPERA, além das vagas: não recebe crédito)', entrar('m3', '2026-10-13', 'p1'), 'ok'),
  A('addCheckin Diego em 13/10 (espera; cr4 sobrou só 6, menor que 12,5)', entrar('m4', '2026-10-13', 'p4'), 'ok'),
  A('removeCheckin Eva: a Ana sobe para dentro das vagas e paga com o cr5 (promoção pelo gancho)', sair('m1'), 'ok'),
  A('removeCheckin Carla: Diego sobe, mas o saldo parcial (6) não paga', sair('m2'), 'ok'),
  A('AMBIENTE: volta para 12 vagas', { ambiente: (env) => definirVagas(env, 12) }),
  A('addCheckin Carla em 13/10 (de novo, 12 vagas): sem crédito ainda', entrar('m5', '2026-10-13', 'p3'), 'ok'),
  A('addCheckin Eva em 13/10 (de novo): sem crédito ainda', entrar('m6', '2026-10-13', 'p5'), 'ok'),
  // ---- dia sem jogo: validações, perfis, destinos ----
  A('marcarDiaSemJogo: jogador é negado', { action: 'marcarDiaSemJogo', idToken: 'tok-c', data: '2026-10-06' }, 'não tem permissão'),
  A('marcarDiaSemJogo: sem login', { action: 'marcarDiaSemJogo', data: '2026-10-06' }, 'Sem token'),
  A('marcarDiaSemJogo: data inválida', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '6/10' }, 'Data inválida.'),
  A('marcarDiaSemJogo: dia não configurado', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-10-06' }, 'Configure o dia'),
  A('marcarDiaSemJogo: dia que já é sem jogo é idempotente (15/09)', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-09-15' }, 'ok'),
  A('salvarFinDia 06/10 (14)', dia('2026-10-06', 14), 'ok'),
  A('addCheckin Ana em 06/10', entrar('n1', '2026-10-06', 'p1'), 'ok'),
  A('addCheckin Carla em 06/10 (crédito cr3 já gasto)', entrar('n2', '2026-10-06', 'p3'), 'ok'),
  A('addCheckin Eva em 06/10', entrar('n3', '2026-10-06', 'p5'), 'ok'),
  A('marcarPagamento Eva em 06/10 (dinheiro)', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-10-06', jogadorId: 'p5', jogadorNome: 'Eva' }, 'ok'),
  A('marcarTodosPagamentos 06/10: quem não tem crédito nem pagamento vira dinheiro', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-10-06' }, 'ok'),
  A('marcarDiaSemJogo 06/10 (padrão = crédito, organizador): dinheiro vira crédito, os por crédito só devolvem; os créditos novos entram em 13/10', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-10-06' }, 'ok'),
  A('marcarDiaSemJogo 06/10 de novo: idempotente (zeros)', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-10-06', destino: 'devolver' }, 'ok'),
  A('marcarPagamento em dia sem jogo (06/10) é recusado', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-10-06', jogadorId: 'p1' }, 'marcado como sem jogo'),
  A('addCheckin em dia sem jogo (06/10): o gancho não aplica crédito', entrar('n4', '2026-10-06', 'p4'), 'ok'),
  A('reabrirDia 06/10: crédito já usado em 13/10 impede', { action: 'reabrirDia', idToken: 'tok-b', data: '2026-10-06' }, 'já foram usados em outro dia'),
  A('estornarTodosPagamentos 13/10 (admin): os créditos usados voltam ao saldo', { action: 'estornarTodosPagamentos', idToken: 'tok-a', data: '2026-10-13' }, 'ok'),
  A('reabrirDia 06/10: agora vale; cancela os créditos e reaplica no dia', { action: 'reabrirDia', idToken: 'tok-b', data: '2026-10-06' }, 'ok'),
  A('reabrirDia 06/10 de novo: já está normal', { action: 'reabrirDia', idToken: 'tok-b', data: '2026-10-06' }, 'ok'),
  // ---- destino "devolver": organizador x admin, quem saiu da lista ----
  A('salvarFinDia 20/10 (8)', dia('2026-10-20', 8), 'ok'),
  A('addCheckin Ana em 20/10', entrar('q1', '2026-10-20', 'p1'), 'ok'),
  A('addCheckin Diego em 20/10', entrar('q2', '2026-10-20', 'p4'), 'ok'),
  A('addCheckin Eva em 20/10', entrar('q3', '2026-10-20', 'p5'), 'ok'),
  A('marcarTodosPagamentos 20/10', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-10-20' }, 'ok'),
  A('removeCheckin Eva de 20/10 (pagou em dinheiro, sai da lista)', sair('q3'), 'ok'),
  A('marcarDiaSemJogo 20/10 destino devolver (organizador): quem saiu da lista é ignorado', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-10-20', destino: 'devolver' }, 'ok'),
  A('reabrirDia 20/10 (nenhum crédito criado: só reabre)', { action: 'reabrirDia', idToken: 'tok-b', data: '2026-10-20' }, 'ok'),
  A('marcarDiaSemJogo 20/10 destino devolver (admin): agora estorna também o de quem saiu', { action: 'marcarDiaSemJogo', idToken: 'tok-a', data: '2026-10-20', destino: 'devolver' }, 'ok'),
  A('reabrirDia: data inválida', { action: 'reabrirDia', idToken: 'tok-b', data: 'x' }, 'Data inválida.'),
  A('reabrirDia: dia inexistente', { action: 'reabrirDia', idToken: 'tok-b', data: '2027-01-01' }, 'Dia não encontrado.'),
  A('reabrirDia: jogador é negado', { action: 'reabrirDia', idToken: 'tok-c', data: '2026-10-20' }, 'não tem permissão'),
  A('marcarDiaSemJogo 20/10 com destino desconhecido (vira crédito), chave mestra', (env, S) => ({ action: 'marcarDiaSemJogo', senha: S, data: '2026-10-20', destino: 'qualquer' }), 'ok'),
  // ---- aplicarCreditosDoDia ----
  A('aplicarCreditosDoDia: jogador é negado', { action: 'aplicarCreditosDoDia', idToken: 'tok-c', data: '2026-10-13' }, 'não tem permissão'),
  A('aplicarCreditosDoDia: data inválida', { action: 'aplicarCreditosDoDia', idToken: 'tok-b', data: '13/10' }, 'Data inválida.'),
  A('aplicarCreditosDoDia: 13/10 (manual; devolve quantos aplicou)', { action: 'aplicarCreditosDoDia', idToken: 'tok-b', data: '2026-10-13' }, 'ok'),
  A('aplicarCreditosDoDia: de novo, zero', { action: 'aplicarCreditosDoDia', idToken: 'tok-b', data: '2026-10-13' }, 'ok'),
  A('aplicarCreditosDoDia: dia sem jogo (20/10), zero', { action: 'aplicarCreditosDoDia', idToken: 'tok-b', data: '2026-10-20' }, 'ok'),
  A('aplicarCreditosDoDia: dia não configurado, zero', { action: 'aplicarCreditosDoDia', idToken: 'tok-b', data: '2027-02-02' }, 'ok'),
  // ---- devolverCredito ----
  A('salvarFinDia 27/10 (9)', dia('2026-10-27', 9), 'ok'),
  A('addCheckin Eva em 27/10', entrar('r1', '2026-10-27', 'p5'), 'ok'),
  A('marcarPagamento Eva em 27/10 (dinheiro)', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-10-27', jogadorId: 'p5', jogadorNome: 'Eva' }, 'ok'),
  A('marcarDiaSemJogo 27/10 (crédito da Eva, sem dias seguintes)', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-10-27' }, 'ok'),
  A('devolverCredito: organizador é negado (só admin)', { action: 'devolverCredito', idToken: 'tok-b', id: 'cr3' }, 'Seu perfil (organizador) não tem permissão'),
  A('devolverCredito: sem id', { action: 'devolverCredito', idToken: 'tok-a' }, 'Crédito não encontrado.'),
  A('devolverCredito: id inexistente', { action: 'devolverCredito', idToken: 'tok-a', id: 'nao-existe' }, 'Crédito não encontrado.'),
  A('devolverCredito: cr4 do Diego foi usado em parte', { action: 'devolverCredito', idToken: 'tok-a', id: 'cr4' }, 'já foi usado'),
  A('devolverCredito: crédito cancelado pelo reabrirDia não está ativo', (env) => ({ action: 'devolverCredito', idToken: 'tok-a', id: creditoDe(env, 'p5', '2026-10-06', 'cancelado') }), 'não está ativo'),
  A('devolverCredito: cr1 do Bruno está gasto no dia 29/09', { action: 'devolverCredito', idToken: 'tok-a', id: 'cr1' }, 'já foi usado'),
  A('devolverCredito: crédito ativo sem uso (Eva, 27/10): estorna o dinheiro de origem', (env) => ({ action: 'devolverCredito', idToken: 'tok-a', id: creditoDe(env, 'p5', '2026-10-27', 'ativo') }), 'ok'),
  A('devolverCredito: de novo é idempotente', (env) => ({ action: 'devolverCredito', idToken: 'tok-a', id: creditoDe(env, 'p5', '2026-10-27', 'devolvido') }), 'ok'),
  A('removeCheckin Bruno de 29/09: o cr1 volta ao saldo', sair('k6'), 'ok'),
  A('devolverCredito: chave mestra devolve o cr1 do Bruno (pagamento de origem inexistente)', (env, S) => ({ action: 'devolverCredito', senha: S, id: 'cr1' }), 'ok'),
  A('removeCheckin de check-in antigo (sem jogador) do fixture: o gancho roda sem quebrar', sair('c3'), 'ok'),
  A('removeCheckin Carla de 06/10 (dia reaberto): gancho reaplica sem erro', sair('n2'), 'ok')
];

// ---------- cenário 2: planilha SEM abas do financeiro (o .gs cria sozinho na primeira gravação) ----------
const dados2 = structuredClone(fixture);
for (const t of ['fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log']) dados2[t] = [];
const env2 = montar(dados2, true);
const passos2 = [
  A('addCheckin sem nenhuma aba do financeiro: gancho não quebra', entrar('z1', '2026-09-29', 'p1'), 'ok'),
  A('removeCheckin sem nenhuma aba do financeiro: gancho não quebra', sair('z1'), 'ok'),
  A('marcarDiaSemJogo: dia não configurado', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-09-22' }, 'Configure o dia'),
  A('reabrirDia sem dias', { action: 'reabrirDia', idToken: 'tok-b', data: '2026-09-22' }, 'Dia não encontrado.'),
  A('aplicarCreditosDoDia sem dias', { action: 'aplicarCreditosDoDia', idToken: 'tok-b', data: '2026-09-22' }, 'ok'),
  A('devolverCredito sem créditos', { action: 'devolverCredito', idToken: 'tok-a', id: 'x' }, 'Crédito não encontrado.'),
  A('salvarFinDia cria o dia e marcarTodos os pagamentos', dia('2026-09-22', 14), 'ok'),
  A('marcarTodosPagamentos 22/09', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-09-22' }, 'ok'),
  A('marcarDiaSemJogo 22/09: cria a aba de créditos e os créditos', { action: 'marcarDiaSemJogo', idToken: 'tok-b', data: '2026-09-22' }, 'ok')
];

await rodar('cenário 1,', env1, passos1);
await rodar('cenário 2,', env2, passos2);
console.log(`\n${passos1.length + passos2.length} passos comparados com o .gs real`);
fim();
