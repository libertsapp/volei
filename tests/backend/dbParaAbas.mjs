// Transforma os dados do fixture (formato do banco) nas abas da planilha, como o Apps Script as lê.
// É o caminho inverso da migração: serve só para o teste de paridade.
const vazio = (v) => (v === null || v === undefined ? '' : v);
const iso = (v) => (v ? new Date(v).toISOString() : '');
const porOrdem = (a, b) => {
  const x = a.ordem ?? Infinity;
  const y = b.ordem ?? Infinity;
  return x === y ? 0 : (x < y ? -1 : 1);
};
const ordenar = (linhas) => linhas.slice().sort(porOrdem);

export function dbParaAbas(fx) {
  const abas = {};

  abas.Jogadores = [['id', 'nome', 'apelido', 'foto', 'estrelas', 'sexo', 'porte'],
    ...ordenar(fx.jogadores.filter((j) => !j.convidado))
      .map((j) => [j.id, vazio(j.nome), vazio(j.apelido), vazio(j.foto), vazio(j.estrelas), vazio(j.sexo), vazio(j.porte)])];

  const linhasRodadas = [];
  for (const r of ordenar(fx.rodadas)) {
    const times = fx.times_rodada.filter((x) => x.round_id === r.round_id).sort((a, b) => a.time_index - b.time_index);
    for (const time of times) {
      const ids = fx.time_jogadores.filter((x) => x.time_rodada_id === time.id).sort((a, b) => a.posicao - b.posicao).map((x) => x.jogador_id);
      linhasRodadas.push([r.round_id, r.data, time.time_index, vazio(time.time_nome), ids.join(','), time.vitorias, time.vencedor, r.rascunho]);
    }
  }
  abas.Rodadas = [['roundId', 'data', 'timeIndex', 'timeNome', 'jogadores', 'vitorias', 'vencedor', 'rascunho'], ...linhasRodadas];

  abas.Config = fx.config.map((c) => [c.chave, c.valor]);

  abas.Checkins = [['id', 'data', 'jogadorId', 'jogadorNome', 'estrelas', 'sexo', 'estrelasAjustadas'],
    ...ordenar(fx.checkins).map((c) => [c.id, c.data, vazio(c.jogador_id), vazio(c.jogador_nome), vazio(c.estrelas), vazio(c.sexo), vazio(c.estrelas_ajustadas)])];

  abas.Usuarios = [['email', 'nome', 'perfil', 'jogadorId', 'criadoEm', 'jogadorIdPendente'],
    ...ordenar(fx.usuarios).map((u) => [u.email, vazio(u.nome), u.perfil, vazio(u.jogador_id), iso(u.criado_em), vazio(u.jogador_id_pendente)])];

  abas.FinDias = [['data', 'valorPessoa', 'pix', 'valorQuadra', 'temBrinde', 'valorBrinde', 'atualizadoPor', 'atualizadoEm', 'icone', 'status'],
    ...ordenar(fx.fin_dias).map((d) => [d.data, d.valor_pessoa, vazio(d.pix), d.valor_quadra, d.tem_brinde, d.valor_brinde,
      vazio(d.atualizado_por), iso(d.atualizado_em), vazio(d.icone), d.status === 'semjogo' ? 'semjogo' : ''])];

  abas.FinPagamentos = [['id', 'data', 'jogadorId', 'jogadorNome', 'valor', 'marcadoPor', 'marcadoEm', 'estornado', 'estornadoPor', 'estornadoEm', 'tipo', 'creditoId'],
    ...ordenar(fx.fin_pagamentos).map((p) => [p.id, p.data, vazio(p.jogador_id), vazio(p.jogador_nome), p.valor, vazio(p.marcado_por),
      iso(p.marcado_em), p.estornado, vazio(p.estornado_por), iso(p.estornado_em), p.tipo, vazio(p.credito_id)])];

  abas.FinCreditos = [['id', 'jogadorId', 'jogadorNome', 'valor', 'origemPagamentoId', 'dataOrigem', 'criadoPor', 'criadoEm', 'status', 'encerradoPor', 'encerradoEm'],
    ...ordenar(fx.fin_creditos).map((c) => [c.id, vazio(c.jogador_id), vazio(c.jogador_nome), c.valor, vazio(c.origem_pagamento_id),
      vazio(c.data_origem), vazio(c.criado_por), iso(c.criado_em), vazio(c.status), vazio(c.encerrado_por), iso(c.encerrado_em)])];

  abas.FinLancamentos = [['id', 'data', 'tipo', 'descricao', 'valor', 'criadoPor', 'criadoEm', 'estornado', 'estornadoPor', 'estornadoEm'],
    ...ordenar(fx.fin_lancamentos).map((l) => [l.id, l.data, l.tipo, vazio(l.descricao), l.valor, vazio(l.criado_por),
      iso(l.criado_em), l.estornado, vazio(l.estornado_por), iso(l.estornado_em)])];

  // o log da planilha guarda o detalhe como texto (JSON serializado, ou o texto solto)
  const detalhe = (d) => (d === null || d === undefined ? '' : (typeof d === 'object' && Object.keys(d).length === 1 && typeof d.texto === 'string' ? d.texto : JSON.stringify(d)));
  abas.FinLog = [['timestamp', 'nome', 'email', 'acao', 'detalhe'],
    ...fx.fin_log.slice().sort((a, b) => a.id - b.id).map((l) => [iso(l.timestamp), vazio(l.nome), vazio(l.email), vazio(l.acao), detalhe(l.detalhe)])];

  // Ao Vivo: só entra se o cenário tem linhas (senão a aba nasce sozinha na primeira transmissão, como no .gs de verdade)
  if (fx.ao_vivo.length) {
    abas.AoVivo = [['roundId', 'data', 'timeIndex', 'timeNome', 'jogadores', 'vitorias', 'iniciadoEm', 'duracaoMinutos'],
      ...fx.ao_vivo.slice().sort((a, b) => a.id - b.id).map((a) => [a.round_id, vazio(a.data), a.time_index, vazio(a.time_nome), vazio(a.jogadores), a.vitorias, iso(a.iniciado_em), vazio(a.duracao_minutos)])];
  }
  if (fx.ao_vivo_log.length) {
    abas.AoVivoLog = [['roundId', 'timeIndex', 'timeNome', 'delta', 'timestamp'],
      ...fx.ao_vivo_log.slice().sort((a, b) => a.id - b.id).map((a) => [a.round_id, a.time_index, vazio(a.time_nome), a.delta, iso(a.timestamp)])];
  }

  return abas;
}
