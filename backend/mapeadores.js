// Converte linhas do banco (snake_case, tipos do Postgres) no JSON que o app já recebe do
// Apps Script (mesmos nomes, tipos e ordem). Funções puras: nada aqui fala com banco nem rede.
// Fonte da verdade do formato: readPlayers/readRounds/readSettings/readCheckins/lerFinanceiro_
// em apps-script-codigo.gs.

export const CHECKIN_MENSAGEM_PADRAO = 'Vôlei {diaSemana} {data} às {horario} horas, quem animar coloca o nome abaixo o mais rápido possível blz pessoal.\nOs {vagas} primeiros a enviarem o nome estarão no jogo';

export const texto = (v) => (v === undefined || v === null ? '' : String(v));
// mesmo efeito de "Number(x) || 0" e de finNum_ do .gs: o que não é número vira 0
const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// o .gs guarda carimbos como texto ISO (toISOString, com milissegundos e Z); o Postgres devolve
// "2026-09-22T19:00:00+00:00" — normaliza pro mesmo formato do .gs
const iso = (v) => (v ? new Date(v).toISOString() : '');

// ordem da planilha; linhas sem "ordem" vão pro fim
export const porOrdem = (a, b) => {
  const x = a.ordem ?? Infinity;
  const y = b.ordem ?? Infinity;
  return x === y ? 0 : (x < y ? -1 : 1);
};

export function mapearJogadores(jogadores) {
  return jogadores
    .filter((j) => !j.convidado && !j.removido)
    .slice().sort(porOrdem)
    .map((j) => ({
      id: texto(j.id), nome: texto(j.nome), apelido: texto(j.apelido), foto: texto(j.foto),
      estrelas: numero(j.estrelas), sexo: texto(j.sexo), porte: texto(j.porte)
    }));
}

export function mapearRodadas(rodadas, times, timeJogadores) {
  const jogadoresPorTime = new Map();
  for (const tj of timeJogadores.slice().sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0))) {
    if (!jogadoresPorTime.has(tj.time_rodada_id)) jogadoresPorTime.set(tj.time_rodada_id, []);
    jogadoresPorTime.get(tj.time_rodada_id).push(texto(tj.jogador_id));
  }
  const timesPorRodada = new Map();
  for (const time of times.slice().sort((a, b) => a.time_index - b.time_index)) {
    if (!timesPorRodada.has(time.round_id)) timesPorRodada.set(time.round_id, []);
    timesPorRodada.get(time.round_id).push(time);
  }
  return rodadas.slice().sort(porOrdem).map((r) => {
    const saida = { id: texto(r.round_id), data: texto(r.data), times: [], vencedores: [], rascunho: r.rascunho === true };
    for (const time of timesPorRodada.get(r.round_id) || []) {
      saida.times[time.time_index] = {
        nome: texto(time.time_nome),
        playerIds: jogadoresPorTime.get(time.id) || [],
        vitorias: numero(time.vitorias)
      };
      if (time.vencedor === true) saida.vencedores.push(time.time_index);
    }
    return saida;
  });
}

export function mapearConfig(linhas) {
  const s = {
    estrelasVisiveis: true, checkinDataAberta: '', checkinTravado: false, checkinVagas: 16,
    checkinHorario: '20:00', checkinMensagemTemplate: CHECKIN_MENSAGEM_PADRAO, contadorAcessos: 0
  };
  for (const { chave, valor } of linhas) {
    if (chave === 'estrelasVisiveis') s.estrelasVisiveis = String(valor).toUpperCase() === 'TRUE';
    if (chave === 'checkinDataAberta') s.checkinDataAberta = texto(valor);
    if (chave === 'checkinTravado') s.checkinTravado = String(valor).toUpperCase() === 'TRUE';
    if (chave === 'checkinVagas') s.checkinVagas = Number(valor) || 16;
    if (chave === 'checkinHorario') s.checkinHorario = texto(valor) || '20:00';
    if (chave === 'checkinMensagemTemplate') s.checkinMensagemTemplate = texto(valor) || CHECKIN_MENSAGEM_PADRAO;
    if (chave === 'contadorAcessos') s.contadorAcessos = Number(valor) || 0;
  }
  return s;
}

export function mapearCheckins(checkins) {
  return checkins.slice().sort(porOrdem).map((c) => ({
    id: texto(c.id), data: texto(c.data), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome),
    estrelas: numero(c.estrelas), sexo: texto(c.sexo),
    // nota só pra ESTE check-in; vazia = usa a estrela do cadastro
    estrelasAjustadas: texto(c.estrelas_ajustadas)
  }));
}

export function mapearPerfisPublicos(usuarios) {
  return usuarios.slice().sort(porOrdem)
    .filter((u) => u.jogador_id)
    .map((u) => ({ jogadorId: texto(u.jogador_id), perfil: (texto(u.perfil) || 'jogador').trim().toLowerCase() }));
}

// Ao Vivo. Port de readAoVivo/readAoVivoLog/lerAoVivo do .gs. Cada linha de ao_vivo é um time de uma rodada em transmissão
// (o sql/schema-terca-supabase-ajuste-6.sql acrescenta as colunas "data" e "jogadores", que a planilha sempre teve).
// Agrupa por rodada na ordem das linhas (id do banco = ordem de gravação da planilha). O agrupamento usa um objeto simples
// de propósito, como o .gs: o Object.values dele tem a mesma ordem de chaves (ids só de dígitos sobem primeiro), então
// linhas gravadas por código novo e linhas migradas saem idênticas.
const porId = (a, b) => (a.id ?? 0) - (b.id ?? 0);

export function mapearAoVivo(aoVivo, aoVivoLog) {
  const mapa = Object.create(null);
  for (const l of aoVivo.slice().sort(porId)) {
    if (!l.round_id) continue;
    const rid = String(l.round_id);
    if (!mapa[rid]) {
      mapa[rid] = { id: rid, data: texto(l.data), iniciadoEm: iso(l.iniciado_em), duracaoMinutos: numero(l.duracao_minutos), times: [] };
    }
    mapa[rid].times[Number(l.time_index)] = {
      nome: texto(l.time_nome),
      playerIds: l.jogadores ? String(l.jogadores).split(',').filter(Boolean) : [],
      vitorias: numero(l.vitorias)
    };
  }
  const rounds = Object.values(mapa);
  const idsValidos = new Set(rounds.map((r) => r.id));
  const log = [];
  for (const l of aoVivoLog.slice().sort(porId)) {
    if (!l.round_id || !idsValidos.has(String(l.round_id))) continue;
    log.push({ roundId: String(l.round_id), timeIndex: Number(l.time_index), timeNome: texto(l.time_nome), delta: numero(l.delta), timestamp: iso(l.timestamp) });
  }
  // mais recente primeiro; o comparador é o MESMO do .gs (nunca devolve 0), então empates saem na mesma ordem
  log.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return { rounds, log };
}

const icone = (v) => (texto(v).trim() === '💰' ? '💰' : '✅');
const statusDia = (v) => (texto(v).trim() === 'semjogo' ? 'semjogo' : '');
const tipoPagamento = (v) => (texto(v).trim() === 'credito' ? 'credito' : 'dinheiro');

// o .gs devolve o "detalhe" do log como texto: JSON serializado, ou o texto solto
// (a migração guardou o texto solto como { texto: "..." })
function detalheComoTexto(d) {
  if (d === null || d === undefined) return '';
  if (typeof d === 'string') return d;
  if (typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 1 && typeof d.texto === 'string') return d.texto;
  return JSON.stringify(d);
}

export function mapearFinanceiro({ fin_dias, fin_pagamentos, fin_creditos, fin_lancamentos, fin_log }) {
  const dias = fin_dias.slice().sort(porOrdem).map((d) => ({
    data: texto(d.data), valorPessoa: numero(d.valor_pessoa), pix: texto(d.pix), valorQuadra: numero(d.valor_quadra),
    temBrinde: d.tem_brinde === true, valorBrinde: numero(d.valor_brinde), icone: icone(d.icone), status: statusDia(d.status)
  }));
  const pagamentos = fin_pagamentos.slice().sort(porOrdem).map((p) => ({
    id: texto(p.id), data: texto(p.data), jogadorId: texto(p.jogador_id), jogadorNome: texto(p.jogador_nome),
    valor: numero(p.valor), marcadoPor: texto(p.marcado_por), marcadoEm: iso(p.marcado_em),
    estornado: p.estornado === true, estornadoPor: texto(p.estornado_por), estornadoEm: iso(p.estornado_em),
    tipo: tipoPagamento(p.tipo), creditoId: texto(p.credito_id)
  }));
  const creditos = fin_creditos.slice().sort(porOrdem).map((c) => ({
    id: texto(c.id), jogadorId: texto(c.jogador_id), jogadorNome: texto(c.jogador_nome), valor: numero(c.valor),
    origemPagamentoId: texto(c.origem_pagamento_id), dataOrigem: texto(c.data_origem), criadoPor: texto(c.criado_por),
    criadoEm: iso(c.criado_em), status: texto(c.status) || 'ativo', encerradoPor: texto(c.encerrado_por), encerradoEm: iso(c.encerrado_em)
  }));
  const lancamentos = fin_lancamentos.slice().sort(porOrdem).map((l) => ({
    id: texto(l.id), data: texto(l.data), tipo: texto(l.tipo), descricao: texto(l.descricao), valor: numero(l.valor),
    criadoPor: texto(l.criado_por), criadoEm: iso(l.criado_em),
    estornado: l.estornado === true, estornadoPor: texto(l.estornado_por), estornadoEm: iso(l.estornado_em)
  }));
  const log = fin_log.slice().sort((a, b) => b.id - a.id).slice(0, 100).map((l) => ({
    timestamp: iso(l.timestamp), nome: texto(l.nome), acao: texto(l.acao), detalhe: detalheComoTexto(l.detalhe) // e-mail nunca sai daqui
  }));
  return { dias, pagamentos, lancamentos, log, creditos };
}
