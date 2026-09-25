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

// Teste diferencial da etapa 4a: o .gs REAL (planilha falsa) e o backend novo (repositório em memória) recebem os mesmos
// pedidos do financeiro; depois de CADA passo compara-se a resposta e o GET inteiro (agora COM o financeiro).
// Nada é normalizado: o relógio (Date do .gs e relogio() do backend) é o mesmo, controlado, e os ids (Utilities.getUuid da
// planilha falsa x gerarId injetado) saem da mesma sequência 'uuid-N'. Se as duas pontas gerarem ids em quantidade/ordem
// diferentes, o teste quebra — o que também é uma verificação de paridade.
// Os check-ins e o crédito são semeados direto no estado inicial (e alterados "por fora" nos passos marcados como
// AMBIENTE): os ganchos de check-in do financeiro só chegam na 4b, então addCheckin/removeCheckin não entram aqui.
const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');
if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - apps-script-codigo.gs não existe nesta pasta (o arquivo é ignorado pelo git; copie-o da máquina do usuário).');
  process.exit(0);
}
const { criarAmbiente } = require('../helpers/planilha-falsa.js');
const json = (x) => JSON.parse(JSON.stringify(x));

// ---------- estado inicial do cenário 1: fixture + Carla, Diego, check-ins, créditos e pagamentos por crédito ----------
const dados = structuredClone(fixture);
dados.jogadores.push(
  { id: 'p3', nome: 'Carla', apelido: 'Carlinha', foto: '', estrelas: 3, sexo: 'F', porte: 'M', convidado: false, removido: false, ordem: 3 },
  { id: 'p4', nome: 'Diego', apelido: '', foto: '', estrelas: 2, sexo: 'M', porte: 'G', convidado: false, removido: false, ordem: 4 });
const ck = (id, data, jid, nome, ordem) => ({ id, data, jogador_id: jid, jogador_nome: nome, estrelas: 3, sexo: 'M', estrelas_ajustadas: null, ordem });
dados.checkins.push(
  ck('k0', '2026-09-22', 'p3', 'Carla', 4),
  ck('k1', '2026-09-29', 'p1', 'Ana', 5), ck('k2', '2026-09-29', 'p2', 'Bruno', 6), ck('k3', '2026-09-29', 'p3', 'Carla', 7),
  ck('k10', '2026-10-13', 'p1', 'Ana', 8), ck('k11', '2026-10-13', 'p2', 'Bruno', 9), ck('k12', '2026-10-13', 'p3', 'Carla', 10), ck('k13', '2026-10-13', 'p4', 'Diego', 11));
const pag = (id, data, jid, nome, tipo, creditoId, ordem) => ({ id, data, jogador_id: jid, jogador_nome: nome, valor: 14, marcado_por: 'Org',
  marcado_em: data + 'T19:00:00+00:00', estornado: false, estornado_por: null, estornado_em: null, tipo, credito_id: creditoId, ordem });
// pg4: dinheiro de Carla num dia sem jogo virou o crédito cr3; pg5: Carla usou cr3 (crédito por inteiro) no dia 22
dados.fin_pagamentos.push(pag('pg4', '2026-09-15', 'p3', 'Carla', 'dinheiro', null, 4), pag('pg5', '2026-09-22', 'p3', 'Carla', 'credito', 'cr3', 5));
const cred = (id, jid, nome, origem, dataOrigem, ordem) => ({ id, jogador_id: jid, jogador_nome: nome, valor: 14, origem_pagamento_id: origem, data_origem: dataOrigem,
  criado_por: 'Adm', criado_em: dataOrigem + 'T21:00:00+00:00', status: 'ativo', encerrado_por: null, encerrado_em: null, ordem });
// dia sem jogo com valor e com um confirmado que TEM crédito (cr4, do Diego): salvar o dia não pode aplicar o crédito
dados.fin_dias.push({ data: '2026-10-20', valor_pessoa: 14, pix: '', valor_quadra: 0, tem_brinde: false, valor_brinde: 0, atualizado_por: 'Adm', atualizado_em: '2026-10-20T18:00:00+00:00', icone: null, status: 'semjogo', ordem: 3 });
dados.checkins.push(ck('k20', '2026-10-20', 'p4', 'Diego', 12));
dados.fin_creditos.push(cred('cr2', 'p1', 'Ana', 'pg1', '2026-09-22', 2), cred('cr3', 'p3', 'Carla', 'pg4', '2026-09-15', 3), cred('cr4', 'p4', 'Diego', 'pg6', '2026-09-15', 4));

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
const idDoPagamento = (env, data, jogadorId, tipo, valido = true) => {
  const p = env.gs.get().financeiro.pagamentos.filter((x) => x.data === data && x.jogadorId === jogadorId && x.tipo === tipo && x.estornado !== valido);
  assert.equal(p.length >= 1, true, 'pagamento de ' + jogadorId + ' em ' + data + ' não encontrado');
  return p.at(-1).id;
};
const definirVagas = (env, n) => {
  env.gs.abas.Config.linhas.find((l) => l[0] === 'checkinVagas')[1] = String(n);
  env.repo.tabelas.config.find((c) => c.chave === 'checkinVagas').valor = String(n);
};
const tirarDaLista = (env, id) => {
  env.gs.abas.Checkins.linhas = env.gs.abas.Checkins.linhas.filter((l, i) => i === 0 || l[0] !== id);
  env.repo.tabelas.checkins = env.repo.tabelas.checkins.filter((c) => c.id !== id);
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
const S = env1.SENHA;
const A = (nome, corpo, esperado) => [nome, corpo, esperado];
const dia = (extra) => ({ data: '2026-09-29', valorPessoa: 14, pix: 'chave', valorQuadra: 180, valorBrinde: 0, ...extra });

const passos1 = [
  // ---- negados por perfil / sem login ----
  A('salvarFinDia: jogador é negado', { action: 'salvarFinDia', idToken: 'tok-c', dia: dia() }, 'Seu perfil (jogador) não tem permissão'),
  A('salvarFinDia: sem login nem senha', { action: 'salvarFinDia', dia: dia() }, 'Sem token'),
  A('salvarFinDia: senha errada', { action: 'salvarFinDia', senha: 'errada', dia: dia() }, 'Senha de administrador incorreta.'),
  A('marcarPagamento: jogador é negado', { action: 'marcarPagamento', idToken: 'tok-c', data: '2026-09-22', jogadorId: 'p1' }, 'não tem permissão'),
  A('estornarPagamento: jogador é negado', { action: 'estornarPagamento', idToken: 'tok-c', id: 'pg1' }, 'não tem permissão'),
  A('marcarTodosPagamentos: jogador é negado', { action: 'marcarTodosPagamentos', idToken: 'tok-c', data: '2026-09-22' }, 'não tem permissão'),
  A('estornarTodosPagamentos: jogador é negado', { action: 'estornarTodosPagamentos', idToken: 'tok-c', data: '2026-09-22' }, 'não tem permissão'),
  A('addLancamento: jogador é negado', { action: 'addLancamento', idToken: 'tok-c', lancamento: { data: '2026-09-22', tipo: 'entrada', valor: 5, descricao: 'x' } }, 'não tem permissão'),
  A('estornarLancamento: organizador é negado (só admin)', { action: 'estornarLancamento', idToken: 'tok-b', id: 'l1' }, 'Seu perfil (organizador) não tem permissão'),
  // ---- salvarFinDia: validações ----
  A('salvarFinDia: sem o objeto do dia', { action: 'salvarFinDia', idToken: 'tok-b' }, 'Data inválida.'),
  A('salvarFinDia: data em formato errado', { action: 'salvarFinDia', idToken: 'tok-b', dia: dia({ data: '2026-9-29' }) }, 'Data inválida.'),
  A('salvarFinDia: valor negativo', { action: 'salvarFinDia', idToken: 'tok-b', dia: dia({ valorPessoa: '-1' }) }, 'maiores ou iguais a zero'),
  A('salvarFinDia: valor que não é número', { action: 'salvarFinDia', idToken: 'tok-b', dia: dia({ valorQuadra: 'abc' }) }, 'maiores ou iguais a zero'),
  // ---- salvarFinDia: dia novo, arredondamento, brinde pelo valor e créditos aplicados (p1 e p2; p3 não tem saldo) ----
  A('salvarFinDia: dia novo (vírgula, arredondamento em centavos, pix com espaços, ícone 💰) aplica créditos',
    { action: 'salvarFinDia', idToken: 'tok-b', dia: { data: '2026-09-29', valorPessoa: '13,999', pix: '  chave-pix  ', valorQuadra: '180.005', temBrinde: false, valorBrinde: '0,285', icone: '💰' } }, 'ok'),
  A('salvarFinDia: de novo no mesmo dia (ícone inválido vira ✅, pix truncado em 80, brinde zerado; nada de crédito novo)',
    { action: 'salvarFinDia', idToken: 'tok-b', dia: { data: '2026-09-29', valorPessoa: 14, pix: 'p'.repeat(100), valorQuadra: '', valorBrinde: 0, temBrinde: true, icone: 'x' } }, 'ok'),
  A('salvarFinDia: dia sem jogo mantém o status e não aplica crédito', { action: 'salvarFinDia', idToken: 'tok-a', dia: { data: '2026-09-15', valorPessoa: 15.5, pix: '', valorQuadra: 200, valorBrinde: 10 } }, 'ok'),
  A('salvarFinDia: dia sem jogo com crédito disponível não aplica crédito', { action: 'salvarFinDia', idToken: 'tok-b', dia: { data: '2026-10-20', valorPessoa: 14, pix: '', valorQuadra: 0, valorBrinde: 0 } }, 'ok'),
  A('estornarTodosPagamentos: dia sem jogo com pagamentos (10/20) é recusado', { action: 'estornarTodosPagamentos', idToken: 'tok-b', data: '2026-10-20' }, 'marcado como sem jogo'),
  A('salvarFinDia: valor por pessoa zero (dia novo)', { action: 'salvarFinDia', idToken: 'tok-b', dia: { data: '2026-10-06', valorPessoa: 0, pix: '', valorQuadra: 0, valorBrinde: 0 } }, 'ok'),
  // ---- marcarPagamento ----
  A('marcarPagamento: sem jogadorId', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-09-22' }, 'Dados do pagamento incompletos.'),
  A('marcarPagamento: data inválida', { action: 'marcarPagamento', idToken: 'tok-b', data: '22/09', jogadorId: 'p1' }, 'Dados do pagamento incompletos.'),
  A('marcarPagamento: dia não configurado', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-11-03', jogadorId: 'p1' }, 'Configure o valor por pessoa'),
  A('marcarPagamento: dia com valor zero', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-10-06', jogadorId: 'p1' }, 'Configure o valor por pessoa'),
  A('marcarPagamento: dia sem jogo', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-09-15', jogadorId: 'p1' }, 'marcado como sem jogo'),
  A('marcarPagamento: pessoa fora da lista de check-in', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-09-29', jogadorId: 'p4', jogadorNome: 'Diego' }, 'não está na lista de check-in'),
  A('marcarPagamento: Carla paga (valor vem do dia, nome longo é cortado em 80)', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-09-29', jogadorId: 'p3', jogadorNome: 'Carla ' + 'x'.repeat(90), valor: 1 }, 'ok'),
  A('marcarPagamento: de novo é idempotente (sem log)', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-09-29', jogadorId: 'p3', jogadorNome: 'Carla' }, 'ok'),
  A('marcarPagamento: chave mestra marca Bruno em 22 (pagamento antigo estava estornado)', { action: 'marcarPagamento', senha: S, data: '2026-09-22', jogadorId: 'p2' }, 'ok'),
  // ---- estornarPagamento ----
  A('estornarPagamento: id inexistente', { action: 'estornarPagamento', idToken: 'tok-b', id: 'nao-existe' }, 'Pagamento não encontrado.'),
  A('estornarPagamento: sem id', { action: 'estornarPagamento', idToken: 'tok-b' }, 'Pagamento não encontrado.'),
  A('estornarPagamento: já estornado é idempotente', { action: 'estornarPagamento', idToken: 'tok-b', id: 'pg2' }, 'ok'),
  A('estornarPagamento: pg3 (check-in antigo sem jogador) na lista, organizador corrige', { action: 'estornarPagamento', idToken: 'tok-b', id: 'pg3' }, 'ok'),
  A('estornarPagamento: dinheiro de quem saiu da lista, organizador é negado', { action: 'estornarPagamento', idToken: 'tok-b', id: 'pg4' }, 'não está entre os confirmados'),
  A('estornarPagamento: mesmo pagamento, admin, mas o crédito dele já foi usado', { action: 'estornarPagamento', idToken: 'tok-a', id: 'pg4' }, 'já foi usado em outro dia'),
  A('estornarPagamento: pagamento por crédito (Carla, dia 22) devolve o crédito ao saldo (sem trava de lista)', { action: 'estornarPagamento', idToken: 'tok-b', id: 'pg5' }, 'ok'),
  A('estornarPagamento: agora o admin estorna pg4 e o crédito cr3 é devolvido', { action: 'estornarPagamento', idToken: 'tok-a', id: 'pg4' }, 'ok'),
  A('estornarPagamento: pg1 (Ana) virou crédito cr2, já usado no dia 29', { action: 'estornarPagamento', idToken: 'tok-b', id: 'pg1' }, 'já foi usado em outro dia'),
  A('estornarPagamento: desmarca o crédito da Ana no dia 29 (organizador)', (env) => ({ action: 'estornarPagamento', idToken: 'tok-b', id: idDoPagamento(env, '2026-09-29', 'p1', 'credito') }), 'ok'),
  A('salvarFinDia: salvar o dia 29 outra vez reaplica o crédito devolvido da Ana (cr2 voltou a ter saldo)', { action: 'salvarFinDia', idToken: 'tok-b', dia: dia({ valorPessoa: 14 }) }, 'ok'),
  A('estornarPagamento: desmarca o crédito reaplicado da Ana', (env) => ({ action: 'estornarPagamento', idToken: 'tok-b', id: idDoPagamento(env, '2026-09-29', 'p1', 'credito') }), 'ok'),
  A('estornarPagamento: agora pg1 pode ser estornado e devolve cr2', { action: 'estornarPagamento', idToken: 'tok-b', id: 'pg1' }, 'ok'),
  A('salvarFinDia: com cr2 e cr3 devolvidos não há crédito para aplicar', { action: 'salvarFinDia', idToken: 'tok-b', dia: dia({ valorPessoa: 14 }) }, 'ok'),
  // ---- marcarTodosPagamentos ----
  A('marcarTodosPagamentos: data inválida', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: 'ontem' }, 'Data inválida.'),
  A('marcarTodosPagamentos: dia não configurado', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-11-03' }, 'Configure o valor por pessoa'),
  A('marcarTodosPagamentos: dia sem jogo', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-09-15' }, 'marcado como sem jogo'),
  A('marcarTodosPagamentos: dia 22 marca só quem não tem pagamento válido', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-09-22' }, 'ok'),
  A('marcarTodosPagamentos: de novo não muda nada (nem loga)', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-09-22' }, 'ok'),
  A('AMBIENTE: só 2 vagas', { ambiente: (env) => definirVagas(env, 2) }),
  A('salvarFinDia: dia 13/10 (valor 12,5) já com só 2 vagas', { action: 'salvarFinDia', idToken: 'tok-b', dia: { data: '2026-10-13', valorPessoa: 12.5, pix: '', valorQuadra: 100, valorBrinde: 0 } }, 'ok'),
  A('marcarTodosPagamentos: 13/10 só os 2 dentro das vagas (chave mestra), Bruno pode ter crédito', { action: 'marcarTodosPagamentos', senha: S, data: '2026-10-13' }, 'ok'),
  A('estornarPagamento: id que não existe (depois do marcar todos)', { action: 'estornarPagamento', idToken: 'tok-b', id: 'pg-nao-existe' }, 'Pagamento não encontrado.'),
  // ---- estornarTodosPagamentos ----
  A('estornarTodosPagamentos: data inválida', { action: 'estornarTodosPagamentos', idToken: 'tok-b', data: '' }, 'Data inválida.'),
  A('estornarTodosPagamentos: dia sem jogo', { action: 'estornarTodosPagamentos', idToken: 'tok-b', data: '2026-09-15' }, 'marcado como sem jogo'),
  A('estornarTodosPagamentos: dia sem nada (nem loga)', { action: 'estornarTodosPagamentos', idToken: 'tok-b', data: '2026-11-03' }, 'ok'),
  A('AMBIENTE: Ana sai da lista de 13/10 (por fora)', { ambiente: (env) => tirarDaLista(env, 'k10') }),
  A('estornarTodosPagamentos: 13/10 organizador ignora quem saiu da lista', { action: 'estornarTodosPagamentos', idToken: 'tok-b', data: '2026-10-13' }, 'ok'),
  A('estornarTodosPagamentos: 13/10 admin estorna o resto', { action: 'estornarTodosPagamentos', idToken: 'tok-a', data: '2026-10-13' }, 'ok'),
  A('estornarTodosPagamentos: dia 29 organizador (créditos entram, dinheiro de fora das 2 vagas fica)', { action: 'estornarTodosPagamentos', idToken: 'tok-b', data: '2026-09-29' }, 'ok'),
  A('estornarTodosPagamentos: dia 22 chave mestra', { action: 'estornarTodosPagamentos', senha: S, data: '2026-09-22' }, 'ok'),
  // ---- lançamentos ----
  A('addLancamento: sem objeto', { action: 'addLancamento', idToken: 'tok-b' }, 'Data inválida.'),
  A('addLancamento: data inválida', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '9/9', tipo: 'entrada', valor: 1, descricao: 'x' } }, 'Data inválida.'),
  A('addLancamento: tipo inválido', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'saída', valor: 1, descricao: 'x' } }, 'Tipo inválido'),
  A('addLancamento: valor zero', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'saida', valor: 0, descricao: 'x' } }, 'maior que zero'),
  A('addLancamento: valor não numérico', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'saida', valor: 'dez', descricao: 'x' } }, 'maior que zero'),
  A('addLancamento: valor negativo', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'saida', valor: '-3', descricao: 'x' } }, 'maior que zero'),
  A('addLancamento: descrição só com espaços', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'saida', valor: 3, descricao: '   ' } }, 'Descreva o lançamento.'),
  A('addLancamento: entrada com vírgula e arredondamento', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'entrada', valor: '10,555', descricao: '  Rifa  ' } }, 'ok'),
  A('addLancamento: saída com descrição longa (corta em 120)', { action: 'addLancamento', idToken: 'tok-a', lancamento: { data: '2026-09-23', tipo: 'saida', valor: 99.9, descricao: 'Bola nova ' + 'z'.repeat(150) } }, 'ok'),
  A('addLancamento: chave mestra com dados certos', { action: 'addLancamento', senha: S, lancamento: { data: '2026-09-24', tipo: 'saida', valor: 1, descricao: 'Água' } }, 'ok'),
  A('estornarLancamento: id inexistente', { action: 'estornarLancamento', idToken: 'tok-a', id: 'nao-existe' }, 'Lançamento não encontrado.'),
  A('estornarLancamento: admin estorna o l1 do fixture', { action: 'estornarLancamento', idToken: 'tok-a', id: 'l1' }, 'ok'),
  A('estornarLancamento: de novo é idempotente (sem log)', { action: 'estornarLancamento', idToken: 'tok-a', id: 'l1' }, 'ok'),
  A('estornarLancamento: chave mestra estorna o lançamento novo', (env) => ({ action: 'estornarLancamento', senha: env.SENHA, id: env.gs.get().financeiro.lancamentos.at(-1).id }), 'ok'),
  A('addLancamento: sobra das outras ações no log', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-25', tipo: 'entrada', valor: 7, descricao: 'Fim' } }, 'ok')
];

// ---------- cenário 2: planilha SEM abas do financeiro (o .gs cria sozinho na primeira gravação) ----------
const dados2 = structuredClone(fixture);
for (const t of ['fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log']) dados2[t] = [];
const env2 = montar(dados2, true);
const passos2 = [
  A('GET/erro sem nenhuma aba: salvarFinDia jogador negado', { action: 'salvarFinDia', idToken: 'tok-c', dia: dia({ data: '2026-09-22' }) }, 'não tem permissão'),
  A('marcarPagamento sem dia configurado', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-09-22', jogadorId: 'p1' }, 'Configure o valor por pessoa'),
  A('estornarPagamento sem pagamento nenhum', { action: 'estornarPagamento', idToken: 'tok-b', id: 'x' }, 'Pagamento não encontrado.'),
  A('estornarLancamento sem lançamento nenhum', { action: 'estornarLancamento', idToken: 'tok-a', id: 'x' }, 'Lançamento não encontrado.'),
  A('estornarTodosPagamentos sem nada (nem cria log)', { action: 'estornarTodosPagamentos', idToken: 'tok-b', data: '2026-09-22' }, 'ok'),
  A('addLancamento cria a aba e o log', { action: 'addLancamento', idToken: 'tok-b', lancamento: { data: '2026-09-22', tipo: 'entrada', valor: 20, descricao: 'Primeiro' } }, 'ok'),
  A('salvarFinDia cria o dia', { action: 'salvarFinDia', idToken: 'tok-b', dia: { data: '2026-09-22', valorPessoa: '14,00', pix: '3199', valorQuadra: 180, valorBrinde: 50 } }, 'ok'),
  A('marcarTodosPagamentos: Ana, Bruno, o antigo sem jogador e o que sobrou', { action: 'marcarTodosPagamentos', idToken: 'tok-b', data: '2026-09-22' }, 'ok'),
  A('estornarPagamento: o primeiro pagamento criado', (env) => ({ action: 'estornarPagamento', idToken: 'tok-b', id: env.gs.get().financeiro.pagamentos[0].id }), 'ok'),
  A('marcarPagamento: refaz o pagamento estornado', { action: 'marcarPagamento', idToken: 'tok-b', data: '2026-09-22', jogadorId: 'p1', jogadorNome: 'Ana' }, 'ok')
];

await rodar('cenário 1,', env1, passos1);
await rodar('cenário 2,', env2, passos2);
console.log(`\n${passos1.length + passos2.length} passos comparados com o .gs real`);
fim();
