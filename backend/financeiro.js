// Controle financeiro, parte 1 (etapa 4a). Port de finSalvarDia_, finMarcarPagamento_, finEstornarPagamento_, finMarcarTodos_,
// finEstornarTodos_, finAddLancamento_ e finEstornarLancamento_ de apps-script-codigo.gs (mesmas mensagens, mesmos textos de log,
// mesmo arredondamento em centavos). Também leva as partes de crédito que essas ações tocam dentro do próprio .gs:
//   - salvarFinDia aplica os créditos do dia (finAplicarCreditos_) quando o dia não é "sem jogo";
//   - estornarPagamento devolve o crédito que nasceu do pagamento (e recusa se ele já foi usado);
//   - marcarPagamento recusa dia "sem jogo"; pagamentos tipo 'credito' não têm a trava de "fora da lista".
// Etapa 4b (mesmo arquivo, no fim): marcarDiaSemJogo, reabrirDia, aplicarCreditosDoDia, devolverCredito (ports de
// finMarcarDiaSemJogo_, finReabrirDia_, finAplicarCreditosAcao_ e finDevolverCredito_) e os ganchos do check-in
// (finAposAdicionarCheckin_ / finAposRemoverCheckin_), chamados por checkins.js.
// Toda ação boa devolve { status: 'ok', financeiro } (o mesmo formato do GET). Todas escrevem no fin_log.
// Sem trava AQUI dentro: o .gs usava LockService e, no backend novo, quem segura a trava 'gravacao' é o handler (backend/trava.js,
// ajuste 5), em volta de cada ação; o índice único parcial do ajuste 4 continua como segunda linha de defesa contra toque duplo.
import { mapearFinanceiro, mapearCheckins, mapearConfig, porOrdem, texto } from './mapeadores.js';

// ---------- utilitários (mesmos nomes de domínio do .gs) ----------
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; }; // finNum_
const MAXIMO = 99999999.99; // limite das colunas numeric(10,2); o .gs (planilha) não tinha teto
// finDataValida_ + calendário real: a coluna é "date", então 2026-13-45 (que o .gs aceitaria como texto) é recusada aqui
function dataValida(s) {
  const v = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '0001-01-01') return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
// número >= 0 com até 2 casas (aceita vírgula); null = inválido — cópia fiel de finValor_
function valor(v) {
  const bruto = (v === undefined || v === null || v === '') ? 0 : v;
  const n = Number(String(bruto).replace(',', '.'));
  return (Number.isFinite(n) && n >= 0) ? Math.round(n * 100) / 100 : null;
}
const icone = (v) => (String(v || '').trim() === '💰' ? '💰' : '✅');
const statusDia = (v) => (texto(v).trim() === 'semjogo' ? 'semjogo' : '');
const tipoPag = (v) => (texto(v).trim() === 'credito' ? 'credito' : 'dinheiro');
const nomeDe = (auth) => auth.nome || (auth.viaChaveMestra ? 'Chave mestra' : (auth.email || 'Desconhecido'));
// autor dos registros feitos sozinhos pelo servidor (crédito aplicado ao salvar o dia)
export const SISTEMA = { nome: 'Crédito automático', email: '', perfil: 'admin', viaChaveMestra: false };

const agora = (deps) => deps.relogio().toISOString();
const gerarId = (deps) => (deps.gerarId ? deps.gerarId() : globalThis.crypto.randomUUID());
const ok = async ({ repo }) => ({ status: 'ok', financeiro: mapearFinanceiro(await repo.lerTudo()) });

// o "detalhe" do log é gravado como { texto: JSON } para o texto sair IDÊNTICO ao do .gs: o jsonb do Postgres reordenaria as chaves
async function log(deps, auth, acao, detalhe) {
  await deps.repo.inserirFinLog({
    timestamp: agora(deps), nome: nomeDe(auth), email: auth.email || '', acao,
    detalhe: { texto: typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe) }
  });
}

// ---------- leituras sobre as linhas do banco (t = resultado de repo.lerTudo()) ----------
const diaDe = (t, data) => t.fin_dias.slice().sort(porOrdem).find((d) => texto(d.data) === data);
const pagamentos = (t) => t.fin_pagamentos.slice().sort(porOrdem);
const ehValido = (p) => p.estornado !== true;
const checkinsDoDia = (t, data) => mapearCheckins(t.checkins).filter((c) => c.data === data);
const vagasDe = (t) => mapearConfig(t.config).checkinVagas || 16;
const noCheckin = (t, data, jogadorId) => checkinsDoDia(t, data).some((c) => String(c.jogadorId) === String(jogadorId));
const estaEntreConfirmados = (t, data, jogadorId) =>
  checkinsDoDia(t, data).slice(0, vagasDe(t)).some((c) => String(c.jogadorId) === String(jogadorId));

// linha de pagamento nova, no formato do banco ('' vira null: jogador_id é chave estrangeira)
function linhaPagamento(deps, { data, jogadorId, jogadorNome, valor: v, por, em, tipo = 'dinheiro', creditoId = null }) {
  return {
    id: gerarId(deps), data, jogador_id: jogadorId || null, jogador_nome: String(jogadorNome || '').slice(0, 80), valor: v,
    marcado_por: por, marcado_em: em, estornado: false, estornado_por: null, estornado_em: null, tipo, credito_id: creditoId
  };
}

// ---------- créditos (a parte que as ações da 4a tocam) ----------
const creditos = (t) => t.fin_creditos.slice().sort(porOrdem).map((c) => ({
  id: texto(c.id), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome), valor: num(c.valor), origemPagamentoId: texto(c.origem_pagamento_id),
  dataOrigem: texto(c.data_origem), status: texto(c.status) || 'ativo'
}));
// saldo (em CENTAVOS) = valor − pagamentos por crédito ainda válidos que apontam para esse crédito
function saldoCreditoCentavos(c, pags) {
  let usado = 0;
  for (const p of pags) if (ehValido(p) && tipoPag(p.tipo) === 'credito' && texto(p.credito_id) === c.id) usado += Math.round(num(p.valor) * 100);
  return Math.round(c.valor * 100) - usado;
}

// Aplica os créditos num dia NORMAL com valor por pessoa (port de finAplicarCreditos_): cada confirmado DENTRO das vagas que ainda
// não tem pagamento válido e tem crédito ativo de um dia ANTERIOR com saldo >= valor do dia ganha um pagamento tipo 'credito'.
// A 4b reaproveita esta função nos ganchos do check-in e em aplicarCreditosDoDia.
export async function aplicarCreditos(deps, data, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return 0;
  const t = await repo.lerTudo();
  const dia = diaDe(t, data);
  if (!dia || statusDia(dia.status) === 'semjogo' || !(num(dia.valor_pessoa) > 0)) return 0;
  // crédito sem jogador (chave estrangeira nula lida como '') nunca paga por ninguém: sem isto pagaria um check-in sem cadastro
  // (diferença deliberada: o .gs casaria '' com '')
  const ativos = creditos(t).filter((c) => c.status === 'ativo' && c.dataOrigem < data && c.jogadorId !== '');
  if (!ativos.length) return 0;
  const dentro = checkinsDoDia(t, data).slice(0, vagasDe(t));
  if (!dentro.length) return 0;
  const valorC = Math.round(num(dia.valor_pessoa) * 100);
  const pags = pagamentos(t);
  const pagos = {};
  for (const p of pags) if (texto(p.data) === data && ehValido(p)) pagos[texto(p.jogador_id)] = true;
  const saldo = {};
  for (const c of ativos) saldo[c.id] = saldoCreditoCentavos(c, pags);
  const novos = [];
  const em = agora(deps);
  for (const c of dentro) {
    const jid = String(c.jogadorId);
    if (jid === '' || pagos[jid]) continue; // check-in sem cadastro não recebe crédito
    const cred = ativos.find((k) => k.jogadorId === jid && saldo[k.id] >= valorC); // o mais antigo com saldo suficiente
    if (!cred) continue;
    saldo[cred.id] -= valorC;
    pagos[jid] = true;
    novos.push({ nome: String(c.jogadorNome || ''),
      linha: linhaPagamento(deps, { data, jogadorId: jid, jogadorNome: c.jogadorNome, valor: valorC / 100, por: SISTEMA.nome, em, tipo: 'credito', creditoId: cred.id }) });
  }
  const feitos = [];
  for (const n of novos) if (await repo.inserirFinPagamento(n.linha)) feitos.push(n);
  if (!feitos.length) return 0;
  await log(deps, auth || SISTEMA, 'aplicarCreditos', { data, quantidade: feitos.length, nomes: feitos.map((n) => n.nome) });
  return feitos.length;
}

// ---------- ações ----------
export async function salvarFinDia(deps, d, auth) {
  const { repo } = deps;
  if (!d || !dataValida(d.data)) return { error: 'Data inválida.' };
  const vp = valor(d.valorPessoa), vq = valor(d.valorQuadra), vb = valor(d.valorBrinde);
  if (vp === null || vq === null || vb === null) return { error: 'Os valores precisam ser números maiores ou iguais a zero.' };
  if (vp > MAXIMO || vq > MAXIMO || vb > MAXIMO) return { error: 'Valor alto demais (máximo 99.999.999,99).' };
  const data = String(d.data);
  // brinde: quem decide é o VALOR (0/vazio = não tem brinde), nunca uma flag mandada pelo navegador
  const temBrinde = vb > 0;
  const ic = icone(d.icone);
  const pix = String(d.pix || '').trim().slice(0, 80);
  const existente = diaDe(await repo.lerTudo(), data);
  let status = ''; // editar os valores NUNCA muda o status (semjogo só muda por marcarDiaSemJogo/reabrirDia)
  let antes = null;
  if (existente) {
    status = statusDia(existente.status);
    antes = { valorPessoa: num(existente.valor_pessoa), pix: texto(existente.pix), valorQuadra: num(existente.valor_quadra),
      temBrinde: existente.tem_brinde === true, valorBrinde: num(existente.valor_brinde), icone: icone(existente.icone) };
  }
  // sem "status" nem "ordem": dia novo recebe os padrões do banco; dia existente os mantém
  await repo.gravarFinDia({ data, valor_pessoa: vp, pix, valor_quadra: vq, tem_brinde: temBrinde, valor_brinde: vb,
    atualizado_por: nomeDe(auth), atualizado_em: agora(deps), icone: ic });
  await log(deps, auth, 'salvarFinDia', { data, antes, depois: { valorPessoa: vp, pix, valorQuadra: vq, temBrinde, valorBrinde: vb, icone: ic } });
  if (status !== 'semjogo') await aplicarCreditos(deps, data, auth); // dia novo/atualizado: quem tem crédito já aparece pago
  return ok(deps);
}

export async function marcarPagamento(deps, data, jogadorId, jogadorNome, auth) {
  const { repo } = deps;
  if (!dataValida(data) || !jogadorId) return { error: 'Dados do pagamento incompletos.' };
  const t = await repo.lerTudo();
  const dia = diaDe(t, data);
  if (!dia || !(num(dia.valor_pessoa) > 0)) return { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' };
  if (statusDia(dia.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para marcar pagamentos.' };
  if (!noCheckin(t, data, jogadorId)) return { error: 'Essa pessoa não está na lista de check-in deste dia.' };
  const jaPago = pagamentos(t).some((p) => texto(p.data) === data && texto(p.jogador_id) === String(jogadorId) && ehValido(p));
  if (jaPago) return ok(deps); // idempotente: tocar duas vezes não cobra duas vezes
  const v = num(dia.valor_pessoa); // SEMPRE o valor do dia gravado no servidor
  const inseriu = await repo.inserirFinPagamento(linhaPagamento(deps, {
    data, jogadorId: String(jogadorId), jogadorNome, valor: v, por: nomeDe(auth), em: agora(deps) }));
  // false = outro toque quase simultâneo já registrou (índice único): mesmo resultado de "já pago", sem log duplicado
  if (inseriu) await log(deps, auth, 'marcarPagamento', { data, jogadorId: String(jogadorId), jogadorNome: String(jogadorNome || ''), valor: v });
  return ok(deps);
}

// Autocura do estorno: pagamento em dinheiro JÁ estornado cujo crédito de origem continua ativo e sem uso (a regra "sem uso" é a
// do caminho normal). Fecha o crédito como devolvido e loga como o caminho normal; sem nada a curar, não faz nada.
async function curarCredito(deps, t, r, auth) {
  if (tipoPag(r.tipo) !== 'dinheiro') return;
  const cr = creditos(t).find((c) => c.origemPagamentoId === texto(r.id) && c.status === 'ativo');
  if (!cr || saldoCreditoCentavos(cr, pagamentos(t)) < Math.round(cr.valor * 100)) return;
  if (!(await deps.repo.encerrarFinCredito(cr.id, 'devolvido', { por: nomeDe(auth), em: agora(deps) }))) return;
  const data = texto(r.data);
  const naLista = estaEntreConfirmados(t, data, texto(r.jogador_id));
  await log(deps, auth, 'estornarPagamento', { data, jogadorId: texto(r.jogador_id), jogadorNome: texto(r.jogador_nome), valor: num(r.valor),
    motivo: naLista ? 'correção de marcação' : 'pessoa fora da lista', creditoDevolvido: cr.id });
}

export async function estornarPagamento(deps, id, auth) {
  const { repo } = deps;
  const t = await repo.lerTudo();
  const r = pagamentos(t).find((p) => texto(p.id) === String(id));
  if (!r) return { error: 'Pagamento não encontrado.' };
  // já estornado: resposta igual à do .gs, mas cura uma falha anterior no meio da sequência (pagamento estornado e crédito
  // ainda ativo = o mesmo dinheiro contado duas vezes); só escreve algo se realmente havia crédito a fechar
  if (!ehValido(r)) { await curarCredito(deps, t, r, auth); return ok(deps); }
  const data = texto(r.data);
  const tipo = tipoPag(r.tipo);
  const naLista = estaEntreConfirmados(t, data, texto(r.jogador_id));
  // quem ainda está na lista: corrigir toque errado (organizador ou admin). Quem NÃO está: devolução de dinheiro => só admin.
  // Pagamento por CRÉDITO não é dinheiro (estornar só devolve o crédito): a trava de "fora da lista" não se aplica.
  if (tipo === 'dinheiro' && !naLista && auth.perfil !== 'admin') {
    return { error: 'Seu perfil (' + auth.perfil + ') não tem permissão para estornar o pagamento de quem não está entre os confirmados. Peça ao admin.' };
  }
  let cr = null;
  if (tipo === 'dinheiro') {
    // se esse dinheiro virou um crédito ATIVO: sem uso, o crédito é devolvido junto; se já foi usado em outro dia, não dá
    cr = creditos(t).find((c) => c.origemPagamentoId === texto(r.id) && c.status === 'ativo') || null;
    if (cr && saldoCreditoCentavos(cr, pagamentos(t)) < Math.round(cr.valor * 100)) {
      return { error: 'Este pagamento virou crédito e já foi usado em outro dia; não dá para estornar. Desmarque o pagamento por crédito primeiro.' };
    }
  }
  const quando = { por: nomeDe(auth), em: agora(deps) };
  // primeiro o estorno condicional do pagamento: se outro pedido chegou antes, este vira "já estornado" e não mexe no crédito nem no log
  if (!(await repo.estornarFinPagamento(texto(r.id), quando))) { await curarCredito(deps, await repo.lerTudo(), r, auth); return ok(deps); }
  let creditoDevolvido = '';
  if (cr) {
    await repo.encerrarFinCredito(cr.id, 'devolvido', quando);
    creditoDevolvido = cr.id;
  }
  await log(deps, auth, 'estornarPagamento', { data, jogadorId: texto(r.jogador_id), jogadorNome: texto(r.jogador_nome), valor: num(r.valor),
    motivo: tipo === 'credito' ? 'crédito devolvido ao saldo' : (naLista ? 'correção de marcação' : 'pessoa fora da lista'),
    creditoDevolvido });
  return ok(deps);
}

// "Confirmar todos": marca como pago cada confirmado DENTRO das vagas que ainda não tem pagamento válido no dia, com o valor do dia.
export async function marcarTodosPagamentos(deps, data, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const dia = diaDe(t, data);
  if (!dia || !(num(dia.valor_pessoa) > 0)) return { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' };
  if (statusDia(dia.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para marcar pagamentos.' };
  const v = num(dia.valor_pessoa);
  const dentro = checkinsDoDia(t, data).slice(0, vagasDe(t));
  const jaPagos = {};
  for (const p of pagamentos(t)) if (texto(p.data) === data && ehValido(p)) jaPagos[texto(p.jogador_id)] = true;
  const novos = dentro.filter((c) => !jaPagos[String(c.jogadorId)]);
  if (!novos.length) return ok(deps); // nada a marcar (idempotente: nem loga)
  const em = agora(deps), nome = nomeDe(auth);
  const feitos = [];
  for (const c of novos) {
    if (await repo.inserirFinPagamento(linhaPagamento(deps, { data, jogadorId: String(c.jogadorId), jogadorNome: c.jogadorNome, valor: v, por: nome, em }))) feitos.push(c);
  }
  if (feitos.length) {
    await log(deps, auth, 'marcarTodosPagamentos', { data, quantidade: feitos.length, valorCada: v, nomes: feitos.map((c) => String(c.jogadorNome || '')) });
  }
  return ok(deps);
}

// "Cancelar todos": estorna TODOS os pagamentos válidos do dia. O admin estorna tudo; o organizador só quem AINDA está entre os
// confirmados (o de quem saiu da lista fica e volta na contagem "ignorados" para o app avisar).
export async function estornarTodosPagamentos(deps, data, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const dia = diaDe(t, data);
  if (dia && statusDia(dia.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para cancelar pagamentos em massa.' };
  const dentroIds = {};
  for (const c of checkinsDoDia(t, data).slice(0, vagasDe(t))) dentroIds[String(c.jogadorId)] = true;
  const ehAdmin = auth.perfil === 'admin';
  const quando = { por: nomeDe(auth), em: agora(deps) };
  const estornados = [], ignorados = [];
  for (const r of pagamentos(t)) {
    if (!texto(r.id) || texto(r.data) !== data || !ehValido(r)) continue;
    const naLista = !!dentroIds[texto(r.jogador_id)];
    const quem = { jogadorNome: texto(r.jogador_nome), valor: num(r.valor) };
    // pagamento por CRÉDITO não é dinheiro (estornar só devolve o crédito): a trava de "fora da lista" é só do dinheiro
    if (tipoPag(r.tipo) === 'dinheiro' && !naLista && !ehAdmin) { ignorados.push(quem); continue; }
    if (await repo.estornarFinPagamento(texto(r.id), quando)) estornados.push(quem); // false = já estornado por outro pedido
  }
  if (estornados.length || ignorados.length) {
    await log(deps, auth, 'estornarTodosPagamentos', { data, quantidade: estornados.length,
      nomes: estornados.map((q) => q.jogadorNome),
      total: estornados.reduce((s, q) => s + q.valor, 0),
      ignoradosForaDaLista: ignorados.map((q) => q.jogadorNome) });
  }
  const resp = await ok(deps);
  resp.estornados = estornados.length;
  resp.ignorados = ignorados.length;
  return resp;
}

export async function addLancamento(deps, l, auth) {
  const { repo } = deps;
  if (!l || !dataValida(l.data)) return { error: 'Data inválida.' };
  if (l.tipo !== 'entrada' && l.tipo !== 'saida') return { error: 'Tipo inválido (use entrada ou saída).' };
  const v = valor(l.valor);
  if (v === null || v <= 0) return { error: 'O valor precisa ser maior que zero.' };
  if (v > MAXIMO) return { error: 'Valor alto demais (máximo 99.999.999,99).' };
  const descricao = String(l.descricao || '').trim().slice(0, 120);
  if (!descricao) return { error: 'Descreva o lançamento.' };
  await repo.inserirFinLancamento({ id: gerarId(deps), data: String(l.data), tipo: l.tipo, descricao, valor: v,
    criado_por: nomeDe(auth), criado_em: agora(deps), estornado: false, estornado_por: null, estornado_em: null });
  await log(deps, auth, 'addLancamento', { data: l.data, tipo: l.tipo, descricao, valor: v });
  return ok(deps);
}

export async function estornarLancamento(deps, id, auth) {
  const { repo } = deps;
  const r = (await repo.lerTudo()).fin_lancamentos.slice().sort(porOrdem).find((x) => texto(x.id) === String(id));
  if (!r) return { error: 'Lançamento não encontrado.' };
  if (r.estornado === true) return ok(deps);
  if (!(await repo.estornarFinLancamento(texto(r.id), { por: nomeDe(auth), em: agora(deps) }))) return ok(deps); // outro pedido chegou antes
  await log(deps, auth, 'estornarLancamento', { data: texto(r.data), tipo: texto(r.tipo), descricao: texto(r.descricao), valor: num(r.valor) });
  return ok(deps);
}

// ====================== ETAPA 4b: dia sem jogo, crédito e ganchos do check-in ======================

// depois de criar créditos num dia sem jogo, os dias seguintes já configurados também precisam recebê-los (finAplicarCreditosFuturos_)
async function aplicarCreditosFuturos(deps, dataOrigem, auth) {
  const datas = (await deps.repo.lerTudo()).fin_dias.map((d) => texto(d.data)).filter((d) => d > dataOrigem).sort();
  let n = 0;
  for (const d of datas) n += await aplicarCreditos(deps, d, auth);
  return n;
}

// Marca o dia como SEM JOGO: a saída (quadra/brinde) deixa de contar. Os pagamentos EM DINHEIRO do dia viram crédito (padrão) ou são
// devolvidos (estornados; o organizador não estorna quem saiu da lista). Pagamentos por CRÉDITO do dia só devolvem o crédito.
export async function marcarDiaSemJogo(deps, data, destino, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const dia = diaDe(t, data);
  if (!dia) return { error: 'Configure o dia (valor por pessoa etc.) antes de marcá-lo como sem jogo.' };
  const resposta = async (creditosCriados, estornados, ignorados) => {
    const r = await ok(deps);
    r.creditos = creditosCriados; r.estornados = estornados; r.ignorados = ignorados;
    return r;
  };
  // dia que já é semjogo: a resposta do .gs é 'zeros' sem log. Mesmo assim o laço abaixo roda de novo (é idempotente: pula pagamento
  // que já tem crédito ativo e os estornos são condicionais), para uma nova tentativa terminar o que uma falha no meio deixou pela metade.
  const repeticao = statusDia(dia.status) === 'semjogo';
  const modo = destino === 'devolver' ? 'devolver' : 'credito';
  if (!repeticao) await repo.definirStatusFinDia(data, 'semjogo');
  const dentroIds = {};
  for (const c of checkinsDoDia(t, data).slice(0, vagasDe(t))) dentroIds[String(c.jogadorId)] = true;
  const ehAdmin = auth.perfil === 'admin';
  const em = agora(deps), nome = nomeDe(auth);
  const quando = { por: nome, em };
  const ativos = creditos(t).filter((c) => c.status === 'ativo');
  const nomes = [];
  let criados = 0, estornados = 0, ignorados = 0, mudou = false;
  for (const p of pagamentos(t)) {
    if (!texto(p.id) || texto(p.data) !== data || !ehValido(p)) continue;
    if (tipoPag(p.tipo) === 'credito') { // não é dinheiro: só devolve o crédito ao saldo
      if (await repo.estornarFinPagamento(texto(p.id), quando)) mudou = true;
      continue;
    }
    if (modo === 'devolver') {
      // numa repetição, dinheiro que já virou crédito ativo é do fluxo de crédito: 'devolver' não o estorna (evita desfazer um crédito)
      if (repeticao && ativos.some((c) => c.origemPagamentoId === texto(p.id))) continue;
      if (!dentroIds[texto(p.jogador_id)] && !ehAdmin) { ignorados++; continue; }
      await repo.estornarFinPagamento(texto(p.id), quando);
      mudou = true;
      estornados++; nomes.push(texto(p.jogador_nome));
      continue;
    }
    if (ativos.some((c) => c.origemPagamentoId === texto(p.id))) continue; // esse dinheiro já virou crédito ativo
    await repo.inserirFinCredito({ id: gerarId(deps), jogador_id: texto(p.jogador_id) || null, jogador_nome: texto(p.jogador_nome),
      valor: num(p.valor), origem_pagamento_id: texto(p.id), data_origem: data, criado_por: nome, criado_em: em,
      status: 'ativo', encerrado_por: null, encerrado_em: null });
    mudou = true;
    criados++; nomes.push(texto(p.jogador_nome));
  }
  if (repeticao && !mudou) return resposta(0, 0, 0); // repetição sem nada a fazer: nada novo é gravado, resposta igual à do .gs
  await log(deps, auth, 'marcarDiaSemJogo', { data, destino: modo, creditos: criados, estornados, ignorados, nomes });
  if (criados) await aplicarCreditosFuturos(deps, data, auth);
  return resposta(criados, estornados, ignorados);
}

// Reabre um dia sem jogo. Só se NENHUM crédito dele foi usado; os créditos ainda disponíveis são cancelados (voltam a ser pagamentos comuns).
export async function reabrirDia(deps, data, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const dia = diaDe(t, data);
  if (!dia) return { error: 'Dia não encontrado.' };
  if (statusDia(dia.status) !== 'semjogo') return ok(deps); // já está normal
  const pags = pagamentos(t);
  const doDia = creditos(t).filter((c) => c.dataOrigem === data && c.status === 'ativo');
  const usados = doDia.filter((c) => saldoCreditoCentavos(c, pags) < Math.round(c.valor * 100));
  if (usados.length) return { error: 'Não dá para reabrir: ' + usados.length + ' crédito(s) deste dia já foram usados em outro dia.' };
  const quando = { por: nomeDe(auth), em: agora(deps) };
  for (const c of doDia) await repo.encerrarFinCredito(c.id, 'cancelado', quando);
  await repo.definirStatusFinDia(data, 'normal');
  await log(deps, auth, 'reabrirDia', { data, creditosCancelados: doDia.length });
  await aplicarCreditos(deps, data, auth);
  return ok(deps);
}

// Aplicação manual (rede de segurança): devolve quantos pagamentos por crédito foram criados
export async function aplicarCreditosDoDia(deps, data, auth) {
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const n = await aplicarCreditos(deps, data, auth);
  const r = await ok(deps);
  r.aplicados = n;
  return r;
}

// Devolve o DINHEIRO de um crédito (só admin): o pagamento de origem é estornado e o dinheiro sai do caixa. Só se não foi usado.
export async function devolverCredito(deps, id, auth) {
  const { repo } = deps;
  const t = await repo.lerTudo();
  const c = creditos(t).find((k) => k.id === String(id));
  if (!c) return { error: 'Crédito não encontrado.' };
  if (c.status === 'devolvido') {
    // idempotente, mas cura uma falha entre fechar o crédito e estornar o dinheiro de origem: se o pagamento de origem ainda vale, estorna
    const orig = pagamentos(t).find((p) => texto(p.id) === c.origemPagamentoId);
    if (orig && ehValido(orig) && await repo.estornarFinPagamento(texto(orig.id), { por: nomeDe(auth), em: agora(deps) })) {
      await log(deps, auth, 'devolverCredito', { jogadorNome: c.jogadorNome, valor: c.valor, dataOrigem: c.dataOrigem });
    }
    return ok(deps);
  }
  if (c.status !== 'ativo') return { error: 'Este crédito não está ativo.' };
  if (saldoCreditoCentavos(c, pagamentos(t)) < Math.round(c.valor * 100)) {
    return { error: 'Este crédito já foi usado (total ou parcialmente); não dá para devolver o dinheiro.' };
  }
  const quando = { por: nomeDe(auth), em: agora(deps) };
  if (!(await repo.encerrarFinCredito(c.id, 'devolvido', quando))) return ok(deps); // outro pedido chegou antes
  const origem = pagamentos(t).find((p) => texto(p.id) === c.origemPagamentoId);
  if (origem && ehValido(origem)) await repo.estornarFinPagamento(texto(origem.id), quando);
  await log(deps, auth, 'devolverCredito', { jogadorNome: c.jogadorNome, valor: c.valor, dataOrigem: c.dataOrigem });
  return ok(deps);
}

// ---------- ganchos do check-in: NUNCA podem quebrar o check-in, então engolem qualquer erro (como o try/catch do .gs) ----------
// deps.avisar (opcional) recebe a mensagem do erro engolido, no lugar do Logger.log do .gs
function avisar(deps, onde, erro) {
  try { if (typeof deps.avisar === 'function') deps.avisar(onde + ': ' + (erro && erro.message ? erro.message : erro)); } catch { /* nada */ }
}

// quem tem crédito de um dia sem jogo já aparece pago
export async function aposAdicionarCheckin(deps, data) {
  try { await aplicarCreditos(deps, String(data), SISTEMA); } catch (e) { avisar(deps, 'aposAdicionarCheckin', e); }
}

// quem saiu devolve o crédito que tinha usado neste dia (o pagamento por crédito é estornado; o saldo volta sozinho) e a
// lista de espera pode ter subido para dentro das vagas (inclusive além de checkinVagas, se as vagas mudaram)
export async function aposRemoverCheckin(deps, data, jogadorId) {
  try {
    const { repo } = deps;
    const t = await repo.lerTudo();
    const quando = { por: SISTEMA.nome, em: agora(deps) };
    let devolvidos = 0;
    for (const p of pagamentos(t)) {
      if (!texto(p.id) || !ehValido(p) || texto(p.data) !== data || texto(p.jogador_id) !== String(jogadorId) || tipoPag(p.tipo) !== 'credito') continue;
      if (await repo.estornarFinPagamento(texto(p.id), quando)) devolvidos++;
    }
    if (devolvidos) {
      await log(deps, SISTEMA, 'estornarPagamento', { data, jogadorId: String(jogadorId),
        motivo: 'saiu da lista: crédito devolvido ao saldo', quantidade: devolvidos });
    }
    await aplicarCreditos(deps, data, SISTEMA); // a espera pode ter subido pra dentro das vagas
  } catch (e) { avisar(deps, 'aposRemoverCheckin', e); }
}
