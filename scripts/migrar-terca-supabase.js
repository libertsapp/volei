require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { lerPlanilhaTerca } = require('./lib/planilha');
const {
  paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO
} = require('./lib/transformacoes');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resumo = [];
const excecoes = [];

// linhas[0] = cabeçalho; devolve um array de objetos { coluna: valor } usando o cabeçalho como chave
function paraObjetos(linhas) {
  if (!linhas || linhas.length < 2) return [];
  const [cabecalho, ...resto] = linhas;
  return resto.filter((l) => l[0]).map((l) => {
    const obj = {};
    cabecalho.forEach((col, i) => { obj[col] = l[i]; });
    return obj;
  });
}

async function gravar(tabela, registros) {
  if (!registros.length) { resumo.push(`${tabela}: 0 registro(s)`); return; }
  const { error } = await supabase.from(tabela).upsert(registros);
  if (error) {
    excecoes.push(`${tabela}: ${error.message}`);
    resumo.push(`${tabela}: FALHOU (${error.message})`);
    return;
  }
  resumo.push(`${tabela}: ${registros.length} registro(s) gravado(s)`);
}

async function migrar() {
  const dados = await lerPlanilhaTerca();

  // 1. jogadores
  const jogadores = paraObjetos(dados.Jogadores).map((j) => ({
    id: j.id, nome: j.nome, apelido: j.apelido || null, foto: j.foto || null,
    estrelas: j.estrelas ? Number(j.estrelas) : null, sexo: j.sexo || null, porte: j.porte || null
  }));
  await gravar('jogadores', jogadores);

  // 2. usuarios
  const usuarios = paraObjetos(dados.Usuarios).map((u) => {
    const obj = {
      email: u.email, nome: u.nome || null, perfil: (u.perfil || 'jogador').toLowerCase(),
      jogador_id: u.jogadorId || null, jogador_id_pendente: u.jogadorIdPendente || null
    };
    // criado_em é "not null default now()" no schema: só inclui a chave se houver valor,
    // senão o Postgres recusa um null explícito numa coluna not null (o default só entra
    // em ação quando a coluna nem aparece no INSERT)
    if (u.criadoEm) obj.criado_em = paraTimestampISO(u.criadoEm);
    return obj;
  });
  await gravar('usuarios', usuarios);

  // 3. config (Config é aba key/value, sem cabeçalho de tabela — cada linha é [chave, valor])
  const config = (dados.Config || []).filter((l) => l[0]).map((l) => ({ chave: l[0], valor: String(l[1] ?? '') }));
  await gravar('config', config);

  // 4. rodadas (uma linha por round_id só, mesmo que a aba tenha várias linhas por rodada)
  const linhasRodadas = paraObjetos(dados.Rodadas);
  const rodadasUnicas = new Map();
  linhasRodadas.forEach((r) => {
    if (!rodadasUnicas.has(r.roundId)) {
      rodadasUnicas.set(r.roundId, { round_id: r.roundId, data: paraDataISO(r.data), vencedor: r.vencedor || null, rascunho: paraBooleano(r.rascunho) });
    }
  });
  await gravar('rodadas', Array.from(rodadasUnicas.values()));

  // 5. times_rodada
  const timesRodada = linhasRodadas.map((r) => ({
    round_id: r.roundId, time_index: Number(r.timeIndex), time_nome: r.timeNome || null, vitorias: Number(r.vitorias || 0)
  }));
  await gravar('times_rodada', timesRodada);

  // times_rodada.id é gerado pelo Postgres (identity) — buscamos de volta pra montar time_jogadores
  const { data: timesGravados, error: erroTimes } = await supabase.from('times_rodada').select('id, round_id, time_index');
  if (erroTimes) { excecoes.push('times_rodada (select de volta): ' + erroTimes.message); }
  const idPorRoundETime = new Map((timesGravados || []).map((t) => [`${t.round_id}:${t.time_index}`, t.id]));

  // 6. time_jogadores
  const timeJogadores = [];
  linhasRodadas.forEach((r) => {
    const timeRodadaId = idPorRoundETime.get(`${r.roundId}:${r.timeIndex}`);
    if (!timeRodadaId) return;
    dividirJogadores(r.jogadores).forEach((jogadorId) => {
      timeJogadores.push({ time_rodada_id: timeRodadaId, jogador_id: jogadorId });
    });
  });
  await gravar('time_jogadores', timeJogadores);

  // 7. checkins
  const checkins = paraObjetos(dados.Checkins).map((c) => ({
    id: c.id, data: paraDataISO(c.data), jogador_id: c.jogadorId || null, jogador_nome: c.jogadorNome || null,
    estrelas: c.estrelas ? Number(c.estrelas) : null, sexo: c.sexo || null,
    estrelas_ajustadas: c.estrelasAjustadas ? Number(c.estrelasAjustadas) : null
  }));
  await gravar('checkins', checkins);

  // 8. fin_dias
  const finDias = paraObjetos(dados.FinDias).map((f) => ({
    data: paraDataISO(f.data), valor_pessoa: Number(f.valorPessoa || 0), pix: f.pix || null,
    valor_quadra: f.valorQuadra ? Number(f.valorQuadra) : null, tem_brinde: paraBooleano(f.temBrinde),
    valor_brinde: f.valorBrinde ? Number(f.valorBrinde) : null, atualizado_por: f.atualizadoPor || null,
    atualizado_em: paraTimestampISO(f.atualizadoEm), icone: f.icone || null, status: f.status || 'normal'
  }));
  await gravar('fin_dias', finDias);

  // 9. fin_pagamentos (credito_id fica de fora por enquanto — fin_creditos ainda não existe)
  const linhasPagamentos = paraObjetos(dados.FinPagamentos);
  const finPagamentos = linhasPagamentos.map((p) => ({
    id: p.id, data: paraDataISO(p.data), jogador_id: p.jogadorId || null, jogador_nome: p.jogadorNome || null,
    valor: Number(p.valor || 0), marcado_por: p.marcadoPor || null, marcado_em: paraTimestampISO(p.marcadoEm),
    estornado: paraBooleano(p.estornado), estornado_por: p.estornadoPor || null, estornado_em: paraTimestampISO(p.estornadoEm),
    tipo: p.tipo || 'dinheiro'
  }));
  await gravar('fin_pagamentos', finPagamentos);

  // 10. fin_creditos (já pode referenciar origem_pagamento_id, que existe desde o passo anterior)
  const finCreditos = paraObjetos(dados.FinCreditos).map((c) => ({
    id: c.id, jogador_id: c.jogadorId || null, jogador_nome: c.jogadorNome || null, valor: Number(c.valor || 0),
    origem_pagamento_id: c.origemPagamentoId || null, data_origem: c.dataOrigem ? paraDataISO(c.dataOrigem) : null,
    criado_por: c.criadoPor || null, criado_em: paraTimestampISO(c.criadoEm), status: c.status || null,
    encerrado_por: c.encerradoPor || null, encerrado_em: paraTimestampISO(c.encerradoEm)
  }));
  await gravar('fin_creditos', finCreditos);

  // 11. atualiza fin_pagamentos.credito_id pra quem pagou usando crédito
  const pagamentosComCredito = linhasPagamentos.filter((p) => p.creditoId);
  for (const p of pagamentosComCredito) {
    const { error } = await supabase.from('fin_pagamentos').update({ credito_id: p.creditoId }).eq('id', p.id);
    if (error) excecoes.push(`fin_pagamentos.credito_id (${p.id}): ${error.message}`);
  }
  resumo.push(`fin_pagamentos.credito_id: ${pagamentosComCredito.length} atualizado(s)`);

  // 12. fin_lancamentos
  const finLancamentos = paraObjetos(dados.FinLancamentos).map((l) => ({
    id: l.id, data: paraDataISO(l.data), tipo: l.tipo || null, descricao: l.descricao || null,
    valor: Number(l.valor || 0), criado_por: l.criadoPor || null, criado_em: paraTimestampISO(l.criadoEm),
    estornado: paraBooleano(l.estornado), estornado_por: l.estornadoPor || null, estornado_em: paraTimestampISO(l.estornadoEm)
  }));
  await gravar('fin_lancamentos', finLancamentos);

  // 13. fin_log
  const finLog = paraObjetos(dados.FinLog).map((l) => ({
    timestamp: paraTimestampISO(l.timestamp), nome: l.nome || null, email: l.email || null,
    acao: l.acao || null, detalhe: paraJsonb(l.detalhe)
  }));
  await gravar('fin_log', finLog);

  // 14. ao_vivo / ao_vivo_log (normalmente vazias)
  const aoVivo = paraObjetos(dados.AoVivo).map((a) => ({
    round_id: a.roundId, time_index: Number(a.timeIndex), time_nome: a.timeNome || null,
    vitorias: Number(a.vitorias || 0), iniciado_em: paraTimestampISO(a.iniciadoEm),
    duracao_minutos: a.duracaoMinutos ? Number(a.duracaoMinutos) : null
  }));
  await gravar('ao_vivo', aoVivo);

  const aoVivoLog = paraObjetos(dados.AoVivoLog).map((a) => ({
    round_id: a.roundId, time_index: Number(a.timeIndex), time_nome: a.timeNome || null,
    delta: Number(a.delta || 0), timestamp: paraTimestampISO(a.timestamp)
  }));
  await gravar('ao_vivo_log', aoVivoLog);

  console.log('\n=== Resumo da migração ===');
  resumo.forEach((linha) => console.log(' -', linha));
  if (excecoes.length) {
    console.log('\n=== Exceções (revisar à mão) ===');
    excecoes.forEach((linha) => console.log(' !', linha));
  }
}

migrar().catch((e) => { console.error('Migração interrompida:', e); process.exit(1); });
