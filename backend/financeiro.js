// Controle financeiro. Port de finSalvarDia_, finMarcarPagamento_, finEstornarPagamento_, finMarcarTodos_,
// finEstornarTodos_, finAddLancamento_ e finEstornarLancamento_ de apps-script-codigo.gs (mesmas mensagens, mesmos
// textos de log, mesmo arredondamento em centavos), com o conceito de "chave de cobrança" (dois jogos no mesmo dia,
// 2026-10-03): `chave` é `null` quando o pagamento vale pro DIA inteiro (modo único, o padrão) ou `1`/`2` quando vale
// só por um jogo (modo separado, fin_dias.por_jogo = true). Com 1 jogo só (o padrão de sempre), a chave é sempre
// `null` e todo o comportamento é idêntico ao de antes — "chave" é só um rótulo a mais nas mesmas linhas.
// Spec: docs/superpowers/specs/2026-10-03-dois-jogos-no-mesmo-dia-design.md
import { mapearFinanceiro, mapearCheckins, mapearConfig, porOrdem, texto } from './mapeadores.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const MAXIMO = 99999999.99;
function dataValida(s) {
  const v = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '0001-01-01') return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function valor(v) {
  const bruto = (v === undefined || v === null || v === '') ? 0 : v;
  const n = Number(String(bruto).replace(',', '.'));
  return (Number.isFinite(n) && n >= 0) ? Math.round(n * 100) / 100 : null;
}
const icone = (v) => (String(v || '').trim() === '💰' ? '💰' : '✅');
const statusDia = (v) => (texto(v).trim() === 'semjogo' ? 'semjogo' : '');
const tipoPag = (v) => (texto(v).trim() === 'credito' ? 'credito' : 'dinheiro');
const nomeDe = (auth) => auth.nome || (auth.viaChaveMestra ? 'Chave mestra' : (auth.email || 'Desconhecido'));
export const SISTEMA = { nome: 'Crédito automático', email: '', perfil: 'admin', viaChaveMestra: false };

const agora = (deps) => deps.relogio().toISOString();
const gerarId = (deps) => (deps.gerarId ? deps.gerarId() : globalThis.crypto.randomUUID());
const ok = async ({ repo }) => ({ status: 'ok', financeiro: mapearFinanceiro(await repo.lerTudo()) });

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
const creditos = (t) => t.fin_creditos.slice().sort(porOrdem).map((c) => ({
  id: texto(c.id), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome), valor: num(c.valor), origemPagamentoId: texto(c.origem_pagamento_id),
  dataOrigem: texto(c.data_origem), status: texto(c.status) || 'ativo', jogoOrigem: c.jogo_origem == null ? null : Number(c.jogo_origem)
}));
function saldoCreditoCentavos(c, pags) {
  let usado = 0;
  for (const p of pags) if (ehValido(p) && tipoPag(p.tipo) === 'credito' && texto(p.credito_id) === c.id) usado += Math.round(num(p.valor) * 100);
  return Math.round(c.valor * 100) - usado;
}

// ---------- "chave de cobrança": null = o dia inteiro (único); 1/2 = um jogo (separado) ----------
// linha de configuração (mesmo formato de fin_dias) da chave: 2 vem de fin_jogos; null/1 vem de fin_dias
const linhaConfigDaChave = (t, data, chave) =>
  chave === 2 ? (t.fin_jogos || []).find((j) => texto(j.data) === data && Number(j.jogo) === 2) || null : diaDe(t, data);
const chaveDoRegistro = (r) => (r.jogo == null ? null : Number(r.jogo));
const pagamentosDaChave = (t, data, chave) => pagamentos(t).filter((p) => texto(p.data) === data && chaveDoRegistro(p) === chave);
// jogos que existem na data (1 sempre; 2 só se checkinJogo2 bate com a data) — mesma regra do check-in
function jogosDaData(cfg, data) {
  const jogos = [{ numero: 1, vagas: cfg.checkinVagas || 16 }];
  if (cfg.checkinJogo2 && texto(cfg.checkinJogo2.data) === data) jogos.push({ numero: 2, vagas: Number(cfg.checkinJogo2.vagas) || (cfg.checkinVagas || 16) });
  return jogos;
}
const jogoDoCheckin = (c) => Number(c.jogo) || 1;
const checkinsDoJogo = (t, data, jogo) => mapearCheckins(t.checkins).filter((c) => c.data === data && jogoDoCheckin(c) === jogo);
// confirmados "pela chave": null = união de quem está confirmado, dentro das vagas, em QUALQUER jogo do dia (sem
// repetir pessoa); 1/2 = só os confirmados daquele jogo, dentro das vagas dele
function confirmadosPelaChave(t, cfg, data, chave) {
  const jogos = jogosDaData(cfg, data);
  if (chave !== null) {
    const j = jogos.find((x) => x.numero === chave);
    return j ? checkinsDoJogo(t, data, chave).slice(0, j.vagas) : [];
  }
  const vistos = new Set();
  const out = [];
  for (const j of jogos) {
    for (const c of checkinsDoJogo(t, data, j.numero).slice(0, j.vagas)) {
      if (vistos.has(c.jogadorId)) continue;
      vistos.add(c.jogadorId);
      out.push(c);
    }
  }
  return out;
}
// as chaves de cobrança que existem no dia: [null] no único; [1, 2] no separado (fin_dias.por_jogo = true)
function chavesDaData(t, cfg, data) {
  const dia = diaDe(t, data);
  if (!dia || dia.por_jogo !== true) return [null];
  return jogosDaData(cfg, data).map((j) => j.numero);
}
// normaliza a chave que o cliente mandou contra o modo DE VERDADE do dia (protege de um cliente com estado
// desatualizado tentando gravar numa chave que não existe mais, ou vice-versa)
function chaveEfetiva(t, data, chaveRecebida) {
  const dia = diaDe(t, data);
  if (!dia || dia.por_jogo !== true) return null;
  return Number(chaveRecebida) === 2 ? 2 : 1;
}

// linha de pagamento nova, no formato do banco ('' vira null: jogador_id é chave estrangeira); jogo null = "do dia"
function linhaPagamento(deps, { data, jogadorId, jogadorNome, valor: v, por, em, tipo = 'dinheiro', creditoId = null, jogo = null }) {
  return {
    id: gerarId(deps), data, jogador_id: jogadorId || null, jogador_nome: String(jogadorNome || '').slice(0, 80), valor: v,
    marcado_por: por, marcado_em: em, estornado: false, estornado_por: null, estornado_em: null, tipo, credito_id: creditoId, jogo
  };
}

// ---------- créditos ----------
// Aplica os créditos numa CHAVE normal (não "sem jogo") com valor cadastrado: cada confirmado DENTRO das vagas
// (daquela chave) que ainda não tem pagamento válido naquela chave e tem crédito ativo de um dia ANTERIOR com saldo
// suficiente ganha um pagamento tipo 'credito'. Um crédito nascido hoje nunca paga outra chave de hoje (dataOrigem < data).
export async function aplicarCreditos(deps, data, chave, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return 0;
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg || statusDia(linhaCfg.status) === 'semjogo' || !(num(linhaCfg.valor_pessoa) > 0)) return 0;
  const ativos = creditos(t).filter((c) => c.status === 'ativo' && c.dataOrigem < data && c.jogadorId !== '');
  if (!ativos.length) return 0;
  const dentro = confirmadosPelaChave(t, cfg, data, chave);
  if (!dentro.length) return 0;
  const valorC = Math.round(num(linhaCfg.valor_pessoa) * 100);
  const pags = pagamentos(t);
  const pagos = {};
  for (const p of pagamentosDaChave(t, data, chave)) if (ehValido(p)) pagos[texto(p.jogador_id)] = true;
  const saldo = {};
  for (const c of ativos) saldo[c.id] = saldoCreditoCentavos(c, pags);
  const novos = [];
  const em = agora(deps);
  for (const c of dentro) {
    const jid = String(c.jogadorId);
    if (jid === '' || pagos[jid]) continue;
    const cred = ativos.find((k) => k.jogadorId === jid && saldo[k.id] >= valorC);
    if (!cred) continue;
    saldo[cred.id] -= valorC;
    pagos[jid] = true;
    novos.push({ nome: String(c.jogadorNome || ''),
      linha: linhaPagamento(deps, { data, jogadorId: jid, jogadorNome: c.jogadorNome, valor: valorC / 100, por: SISTEMA.nome, em, tipo: 'credito', creditoId: cred.id, jogo: chave }) });
  }
  const feitos = [];
  for (const n of novos) if (await repo.inserirFinPagamento(n.linha)) feitos.push(n);
  if (!feitos.length) return 0;
  await log(deps, auth || SISTEMA, 'aplicarCreditos', { data, jogo: chave ?? undefined, quantidade: feitos.length, nomes: feitos.map((n) => n.nome) });
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
  const chave = Number(d.jogo) === 2 ? 2 : 1;
  const t = await repo.lerTudo();
  const diaAtual = diaDe(t, data);
  if (chave === 2 && !(diaAtual && diaAtual.por_jogo === true)) {
    return { error: 'Configure "Separado por jogo" antes de editar o 2º jogo.' };
  }
  if (chave === 1 && d.porJogo !== undefined && diaAtual && (diaAtual.por_jogo === true) !== !!d.porJogo) {
    if (t.fin_pagamentos.some((p) => texto(p.data) === data && ehValido(p))) {
      return { error: 'Já há pagamento(s) neste dia. Para trocar, use "Cancelar todos" antes.' };
    }
  }
  const temBrinde = vb > 0;
  const ic = icone(d.icone);
  const pix = String(d.pix || '').trim().slice(0, 80);
  const existenteChave = linhaConfigDaChave(t, data, chave);
  let status = '';
  let antes = null;
  if (existenteChave) {
    status = statusDia(existenteChave.status);
    antes = { valorPessoa: num(existenteChave.valor_pessoa), pix: texto(existenteChave.pix), valorQuadra: num(existenteChave.valor_quadra),
      temBrinde: existenteChave.tem_brinde === true, valorBrinde: num(existenteChave.valor_brinde), icone: icone(existenteChave.icone) };
  }
  if (chave === 2) {
    await repo.gravarFinJogo({ data, jogo: 2, valor_pessoa: vp, pix, valor_quadra: vq, tem_brinde: temBrinde, valor_brinde: vb,
      atualizado_por: nomeDe(auth), atualizado_em: agora(deps), icone: ic });
  } else {
    const linha = { data, valor_pessoa: vp, pix, valor_quadra: vq, tem_brinde: temBrinde, valor_brinde: vb,
      atualizado_por: nomeDe(auth), atualizado_em: agora(deps), icone: ic };
    if (d.porJogo !== undefined) linha.por_jogo = !!d.porJogo;
    await repo.gravarFinDia(linha);
  }
  await log(deps, auth, 'salvarFinDia', { data, jogo: chave === 2 ? 2 : undefined, antes, depois: { valorPessoa: vp, pix, valorQuadra: vq, temBrinde, valorBrinde: vb, icone: ic } });
  // aplica em TODAS as chaves do dia (não só a que acabou de ser salva): salvar o jogo 1 pode ser justamente o
  // momento em que o dia vira "separado" (porJogo:true), e um crédito pendente tem que cair na chave certa dali pra
  // frente, nunca em jogo:null misturado com pagamentos por jogo já existentes.
  if (status !== 'semjogo') await aplicarCreditosEmTodasAsChaves(deps, data, auth);
  return ok(deps);
}

export async function marcarPagamento(deps, data, chaveEntrada, jogadorId, jogadorNome, auth) {
  const { repo } = deps;
  if (!dataValida(data) || !jogadorId) return { error: 'Dados do pagamento incompletos.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg || !(num(linhaCfg.valor_pessoa) > 0)) return { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' };
  if (statusDia(linhaCfg.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para marcar pagamentos.' };
  if (!confirmadosPelaChave(t, cfg, data, chave).some((c) => String(c.jogadorId) === String(jogadorId))) {
    return { error: 'Essa pessoa não está na lista de check-in deste dia.' };
  }
  const jaPago = pagamentosDaChave(t, data, chave).some((p) => texto(p.jogador_id) === String(jogadorId) && ehValido(p));
  if (jaPago) return ok(deps);
  const v = num(linhaCfg.valor_pessoa);
  const inseriu = await repo.inserirFinPagamento(linhaPagamento(deps, {
    data, jogadorId: String(jogadorId), jogadorNome, valor: v, por: nomeDe(auth), em: agora(deps), jogo: chave }));
  if (inseriu) await log(deps, auth, 'marcarPagamento', { data, jogo: chave ?? undefined, jogadorId: String(jogadorId), jogadorNome: String(jogadorNome || ''), valor: v });
  return ok(deps);
}

async function curarCredito(deps, t, r, auth) {
  if (tipoPag(r.tipo) !== 'dinheiro') return;
  const cr = creditos(t).find((c) => c.origemPagamentoId === texto(r.id) && c.status === 'ativo');
  if (!cr || saldoCreditoCentavos(cr, pagamentos(t)) < Math.round(cr.valor * 100)) return;
  if (!(await deps.repo.encerrarFinCredito(cr.id, 'devolvido', { por: nomeDe(auth), em: agora(deps) }))) return;
  const data = texto(r.data);
  const cfg = mapearConfig(t.config);
  const naLista = confirmadosPelaChave(t, cfg, data, chaveDoRegistro(r)).some((c) => String(c.jogadorId) === texto(r.jogador_id));
  await log(deps, auth, 'estornarPagamento', { data, jogo: chaveDoRegistro(r) ?? undefined, jogadorId: texto(r.jogador_id), jogadorNome: texto(r.jogador_nome), valor: num(r.valor),
    motivo: naLista ? 'correção de marcação' : 'pessoa fora da lista', creditoDevolvido: cr.id });
}

export async function estornarPagamento(deps, id, auth) {
  const { repo } = deps;
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const r = pagamentos(t).find((p) => texto(p.id) === String(id));
  if (!r) return { error: 'Pagamento não encontrado.' };
  const chave = chaveDoRegistro(r);
  if (!ehValido(r)) { await curarCredito(deps, t, r, auth); return ok(deps); }
  const data = texto(r.data);
  const tipo = tipoPag(r.tipo);
  const naLista = confirmadosPelaChave(t, cfg, data, chave).some((c) => String(c.jogadorId) === texto(r.jogador_id));
  if (tipo === 'dinheiro' && !naLista && auth.perfil !== 'admin') {
    return { error: 'Seu perfil (' + auth.perfil + ') não tem permissão para estornar o pagamento de quem não está entre os confirmados. Peça ao admin.' };
  }
  let cr = null;
  if (tipo === 'dinheiro') {
    cr = creditos(t).find((c) => c.origemPagamentoId === texto(r.id) && c.status === 'ativo') || null;
    if (cr && saldoCreditoCentavos(cr, pagamentos(t)) < Math.round(cr.valor * 100)) {
      return { error: 'Este pagamento virou crédito e já foi usado em outro dia; não dá para estornar. Desmarque o pagamento por crédito primeiro.' };
    }
  }
  const quando = { por: nomeDe(auth), em: agora(deps) };
  if (!(await repo.estornarFinPagamento(texto(r.id), quando))) { await curarCredito(deps, await repo.lerTudo(), r, auth); return ok(deps); }
  let creditoDevolvido = '';
  if (cr) { await repo.encerrarFinCredito(cr.id, 'devolvido', quando); creditoDevolvido = cr.id; }
  await log(deps, auth, 'estornarPagamento', { data, jogo: chave ?? undefined, jogadorId: texto(r.jogador_id), jogadorNome: texto(r.jogador_nome), valor: num(r.valor),
    motivo: tipo === 'credito' ? 'crédito devolvido ao saldo' : (naLista ? 'correção de marcação' : 'pessoa fora da lista'),
    creditoDevolvido });
  return ok(deps);
}

export async function marcarTodosPagamentos(deps, data, chaveEntrada, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg || !(num(linhaCfg.valor_pessoa) > 0)) return { error: 'Configure o valor por pessoa deste dia antes de marcar pagamentos.' };
  if (statusDia(linhaCfg.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para marcar pagamentos.' };
  const v = num(linhaCfg.valor_pessoa);
  const dentro = confirmadosPelaChave(t, cfg, data, chave);
  const jaPagos = {};
  for (const p of pagamentosDaChave(t, data, chave)) if (ehValido(p)) jaPagos[texto(p.jogador_id)] = true;
  const novos = dentro.filter((c) => !jaPagos[String(c.jogadorId)]);
  if (!novos.length) return ok(deps);
  const em = agora(deps), nome = nomeDe(auth);
  const feitos = [];
  for (const c of novos) {
    if (await repo.inserirFinPagamento(linhaPagamento(deps, { data, jogadorId: String(c.jogadorId), jogadorNome: c.jogadorNome, valor: v, por: nome, em, jogo: chave }))) feitos.push(c);
  }
  if (feitos.length) {
    await log(deps, auth, 'marcarTodosPagamentos', { data, jogo: chave ?? undefined, quantidade: feitos.length, valorCada: v, nomes: feitos.map((c) => String(c.jogadorNome || '')) });
  }
  return ok(deps);
}

export async function estornarTodosPagamentos(deps, data, chaveEntrada, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (linhaCfg && statusDia(linhaCfg.status) === 'semjogo') return { error: 'Este dia está marcado como sem jogo. Reabra o dia para cancelar pagamentos em massa.' };
  const dentroIds = {};
  for (const c of confirmadosPelaChave(t, cfg, data, chave)) dentroIds[String(c.jogadorId)] = true;
  const ehAdmin = auth.perfil === 'admin';
  const quando = { por: nomeDe(auth), em: agora(deps) };
  const estornados = [], ignorados = [];
  for (const r of pagamentosDaChave(t, data, chave)) {
    if (!texto(r.id) || !ehValido(r)) continue;
    const naLista = !!dentroIds[texto(r.jogador_id)];
    const quem = { jogadorNome: texto(r.jogador_nome), valor: num(r.valor) };
    if (tipoPag(r.tipo) === 'dinheiro' && !naLista && !ehAdmin) { ignorados.push(quem); continue; }
    if (await repo.estornarFinPagamento(texto(r.id), quando)) estornados.push(quem);
  }
  if (estornados.length || ignorados.length) {
    await log(deps, auth, 'estornarTodosPagamentos', { data, jogo: chave ?? undefined, quantidade: estornados.length,
      nomes: estornados.map((q) => q.jogadorNome), total: estornados.reduce((s, q) => s + q.valor, 0),
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
  if (!(await repo.estornarFinLancamento(texto(r.id), { por: nomeDe(auth), em: agora(deps) }))) return ok(deps);
  await log(deps, auth, 'estornarLancamento', { data: texto(r.data), tipo: texto(r.tipo), descricao: texto(r.descricao), valor: num(r.valor) });
  return ok(deps);
}

// pendência = dívida avulsa de um jogador (ex.: saiu sem pagar algo combinado). NÃO mexe no caixa — é só um
// aviso que aparece pra ele no check-in (ver finPendenciasDe no front) até alguém marcar como paga.
export async function addPendencia(deps, p, auth) {
  const { repo } = deps;
  if (!p || !p.jogadorId) return { error: 'Jogador inválido.' };
  const v = valor(p.valor);
  if (v === null || v <= 0) return { error: 'O valor precisa ser maior que zero.' };
  if (v > MAXIMO) return { error: 'Valor alto demais (máximo 99.999.999,99).' };
  const data = dataValida(p.data) ? String(p.data) : agora(deps).slice(0, 10);
  const observacao = String(p.observacao || '').trim().slice(0, 200);
  const jogadorNome = String(p.jogadorNome || '').slice(0, 80);
  await repo.inserirFinPendencia({ id: gerarId(deps), jogador_id: String(p.jogadorId), jogador_nome: jogadorNome, valor: v,
    observacao, data, criado_por: nomeDe(auth), criado_em: agora(deps), status: 'pendente', baixado_por: null, baixado_em: null });
  await log(deps, auth, 'addPendencia', { jogadorId: String(p.jogadorId), jogadorNome, valor: v, data, observacao });
  return ok(deps);
}

export async function baixarPendencia(deps, id, auth) {
  const { repo } = deps;
  const r = (await repo.lerTudo()).fin_pendencias.find((x) => texto(x.id) === String(id));
  if (!r) return { error: 'Pendência não encontrada.' };
  if (r.status === 'paga') return ok(deps);
  if (!(await repo.baixarFinPendencia(texto(r.id), { por: nomeDe(auth), em: agora(deps) }))) return ok(deps);
  await log(deps, auth, 'baixarPendencia', { jogadorId: texto(r.jogador_id), jogadorNome: texto(r.jogador_nome), valor: num(r.valor) });
  return ok(deps);
}

// ====================== dia sem jogo, crédito e ganchos do check-in ======================

async function aplicarCreditosEmTodasAsChaves(deps, data, auth) {
  const t = await deps.repo.lerTudo();
  const cfg = mapearConfig(t.config);
  let n = 0;
  for (const chave of chavesDaData(t, cfg, data)) n += await aplicarCreditos(deps, data, chave, auth);
  return n;
}
async function aplicarCreditosFuturos(deps, dataOrigem, auth) {
  const t0 = await deps.repo.lerTudo();
  const datas = Array.from(new Set([...t0.fin_dias.map((d) => texto(d.data)), ...(t0.fin_jogos || []).map((j) => texto(j.data))]))
    .filter((d) => d > dataOrigem).sort();
  let n = 0;
  for (const d of datas) n += await aplicarCreditosEmTodasAsChaves(deps, d, auth);
  return n;
}

export async function marcarDiaSemJogo(deps, data, chaveEntrada, destino, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg) return { error: 'Configure o dia (valor por pessoa etc.) antes de marcá-lo como sem jogo.' };
  const resposta = async (creditosCriados, estornados, ignorados) => {
    const r = await ok(deps);
    r.creditos = creditosCriados; r.estornados = estornados; r.ignorados = ignorados;
    return r;
  };
  const repeticao = statusDia(linhaCfg.status) === 'semjogo';
  const modo = destino === 'devolver' ? 'devolver' : 'credito';
  if (!repeticao) {
    if (chave === 2) await repo.definirStatusFinJogo(data, 2, 'semjogo'); else await repo.definirStatusFinDia(data, 'semjogo');
  }
  const dentroIds = {};
  for (const c of confirmadosPelaChave(t, cfg, data, chave)) dentroIds[String(c.jogadorId)] = true;
  const ehAdmin = auth.perfil === 'admin';
  const em = agora(deps), nome = nomeDe(auth);
  const quando = { por: nome, em };
  const ativos = creditos(t).filter((c) => c.status === 'ativo');
  const nomes = [];
  let criados = 0, estornados = 0, ignorados = 0, mudou = false;
  for (const p of pagamentosDaChave(t, data, chave)) {
    if (!texto(p.id) || !ehValido(p)) continue;
    if (tipoPag(p.tipo) === 'credito') {
      if (await repo.estornarFinPagamento(texto(p.id), quando)) mudou = true;
      continue;
    }
    if (modo === 'devolver') {
      if (repeticao && ativos.some((c) => c.origemPagamentoId === texto(p.id))) continue;
      if (!dentroIds[texto(p.jogador_id)] && !ehAdmin) { ignorados++; continue; }
      await repo.estornarFinPagamento(texto(p.id), quando);
      mudou = true;
      estornados++; nomes.push(texto(p.jogador_nome));
      continue;
    }
    if (ativos.some((c) => c.origemPagamentoId === texto(p.id))) continue;
    await repo.inserirFinCredito({ id: gerarId(deps), jogador_id: texto(p.jogador_id) || null, jogador_nome: texto(p.jogador_nome),
      valor: num(p.valor), origem_pagamento_id: texto(p.id), data_origem: data, criado_por: nome, criado_em: em,
      status: 'ativo', encerrado_por: null, encerrado_em: null, jogo_origem: chave });
    mudou = true;
    criados++; nomes.push(texto(p.jogador_nome));
  }
  if (repeticao && !mudou) return resposta(0, 0, 0);
  await log(deps, auth, 'marcarDiaSemJogo', { data, jogo: chave ?? undefined, destino: modo, creditos: criados, estornados, ignorados, nomes });
  if (criados) await aplicarCreditosFuturos(deps, data, auth);
  return resposta(criados, estornados, ignorados);
}

export async function reabrirDia(deps, data, chaveEntrada, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const t = await repo.lerTudo();
  const cfg = mapearConfig(t.config);
  const chave = chaveEfetiva(t, data, chaveEntrada);
  const linhaCfg = linhaConfigDaChave(t, data, chave);
  if (!linhaCfg) return { error: 'Dia não encontrado.' };
  if (statusDia(linhaCfg.status) !== 'semjogo') return ok(deps);
  const pags = pagamentos(t);
  const doDia = creditos(t).filter((c) => c.dataOrigem === data && c.status === 'ativo' && c.jogoOrigem === chave);
  const usados = doDia.filter((c) => saldoCreditoCentavos(c, pags) < Math.round(c.valor * 100));
  if (usados.length) return { error: 'Não dá para reabrir: ' + usados.length + ' crédito(s) deste dia já foram usados em outro dia.' };
  const quando = { por: nomeDe(auth), em: agora(deps) };
  for (const c of doDia) await repo.encerrarFinCredito(c.id, 'cancelado', quando);
  if (chave === 2) await repo.definirStatusFinJogo(data, 2, 'normal'); else await repo.definirStatusFinDia(data, 'normal');
  await log(deps, auth, 'reabrirDia', { data, jogo: chave ?? undefined, creditosCancelados: doDia.length });
  await aplicarCreditos(deps, data, chave, auth);
  return ok(deps);
}

export async function aplicarCreditosDoDia(deps, data, auth) {
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const n = await aplicarCreditosEmTodasAsChaves(deps, data, auth);
  const r = await ok(deps);
  r.aplicados = n;
  return r;
}

export async function devolverCredito(deps, id, auth) {
  const { repo } = deps;
  const t = await repo.lerTudo();
  const c = creditos(t).find((k) => k.id === String(id));
  if (!c) return { error: 'Crédito não encontrado.' };
  if (c.status === 'devolvido') {
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
  if (!(await repo.encerrarFinCredito(c.id, 'devolvido', quando))) return ok(deps);
  const origem = pagamentos(t).find((p) => texto(p.id) === c.origemPagamentoId);
  if (origem && ehValido(origem)) await repo.estornarFinPagamento(texto(origem.id), quando);
  await log(deps, auth, 'devolverCredito', { jogadorNome: c.jogadorNome, valor: c.valor, dataOrigem: c.dataOrigem });
  return ok(deps);
}

// ---------- ganchos do check-in: NUNCA podem quebrar o check-in, então engolem qualquer erro ----------
function avisar(deps, onde, erro) {
  try { if (typeof deps.avisar === 'function') deps.avisar(onde + ': ' + (erro && erro.message ? erro.message : erro)); } catch { /* nada */ }
}

// roda em TODAS as chaves do dia (1 no único; 1 e 2 no separado) — idempotente, então não faz mal rodar à toa
export async function aposAdicionarCheckin(deps, data) {
  try { await aplicarCreditosEmTodasAsChaves(deps, String(data), SISTEMA); } catch (e) { avisar(deps, 'aposAdicionarCheckin', e); }
}

// para cada chave do dia: se a pessoa NÃO está mais confirmada nela (saiu de verdade daquela cobrança — no único,
// continuar no outro jogo CONTA como ainda confirmada, então nada é devolvido), devolve o crédito usado lá
export async function aposRemoverCheckin(deps, data, jogadorId) {
  try {
    const { repo } = deps;
    const t = await repo.lerTudo();
    const cfg = mapearConfig(t.config);
    const quando = { por: SISTEMA.nome, em: agora(deps) };
    let devolvidos = 0;
    for (const chave of chavesDaData(t, cfg, data)) {
      const aindaDentro = confirmadosPelaChave(t, cfg, data, chave).some((c) => String(c.jogadorId) === String(jogadorId));
      if (aindaDentro) continue;
      for (const p of pagamentosDaChave(t, data, chave)) {
        if (!texto(p.id) || !ehValido(p) || texto(p.jogador_id) !== String(jogadorId) || tipoPag(p.tipo) !== 'credito') continue;
        if (await repo.estornarFinPagamento(texto(p.id), quando)) devolvidos++;
      }
    }
    if (devolvidos) {
      await log(deps, SISTEMA, 'estornarPagamento', { data, jogadorId: String(jogadorId),
        motivo: 'saiu da lista: crédito devolvido ao saldo', quantidade: devolvidos });
    }
    await aplicarCreditosEmTodasAsChaves(deps, data, SISTEMA);
  } catch (e) { avisar(deps, 'aposRemoverCheckin', e); }
}
