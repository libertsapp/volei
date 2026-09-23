require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { lerPlanilhaTerca } = require('./lib/planilha');
const {
  paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO, paraNumero
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

function mapear(tabela, linhas, fn) {
  const saida = [];
  linhas.forEach((linha, i) => {
    try { saida.push(fn(linha)); }
    catch (e) { excecoes.push(`${tabela} [registro ${i + 1} da aba]: ${e.message}`); }
  });
  return saida;
}

function identificar(registro) {
  return Object.entries(registro).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(', ');
}

async function gravar(tabela, registros, opcoes = {}) {
  if (!registros.length) { resumo.push(`${tabela}: 0 registro(s)`); return; }
  const { error } = await supabase.from(tabela).upsert(registros, opcoes);
  if (!error) { resumo.push(`${tabela}: ${registros.length} registro(s) gravado(s)`); return; }
  let gravados = 0;
  for (const registro of registros) {
    const { error: erroLinha } = await supabase.from(tabela).upsert(registro, opcoes);
    if (erroLinha) {
      const dica = erroLinha.code === '23503' ? ' (referência a um registro que não existe — provavelmente uma falha anterior ou um dado órfão na planilha)' : '';
      excecoes.push(`${tabela} [${identificar(registro)}]: ${erroLinha.message}${dica}`);
    } else gravados++;
  }
  resumo.push(`${tabela}: ${gravados}/${registros.length} gravado(s) (o lote falhou: ${error.message})`);
}

async function gravarSeVazia(tabela, registros) {
  const { count, error } = await supabase.from(tabela).select('*', { count: 'exact', head: true });
  if (error) { excecoes.push(`${tabela}: não deu pra checar se já tem dados (${error.message})`); return; }
  if (count > 0) { resumo.push(`${tabela}: já tem ${count} registro(s) — pulada pra não duplicar (tabela sem chave natural)`); return; }
  await gravar(tabela, registros);
}

async function migrar() {
  const dados = await lerPlanilhaTerca();

  // 1. jogadores
  const jogadores = mapear('jogadores', paraObjetos(dados.Jogadores), (j) => ({
    id: j.id, nome: j.nome, apelido: j.apelido || null, foto: j.foto || null,
    estrelas: paraNumero(j.estrelas), sexo: j.sexo || null, porte: j.porte || null
  }));
  await gravar('jogadores', jogadores);

  // 2. usuarios
  const usuarios = mapear('usuarios', paraObjetos(dados.Usuarios), (u) => ({
    email: u.email, nome: u.nome || null, perfil: (u.perfil || 'jogador').toLowerCase(),
    jogador_id: u.jogadorId || null, jogador_id_pendente: u.jogadorIdPendente || null,
    criado_em: u.criadoEm ? paraTimestampISO(u.criadoEm) : new Date().toISOString()
  }));
  await gravar('usuarios', usuarios);

  // 3. config (Config é aba key/value, sem cabeçalho de tabela — cada linha é [chave, valor])
  const config = mapear('config', (dados.Config || []).filter((l) => l[0]), (l) => ({ chave: l[0], valor: String(l[1] ?? '') }));
  await gravar('config', config);

  // 4. rodadas (uma linha por round_id só, mesmo que a aba tenha várias linhas por rodada)
  const linhasRodadas = paraObjetos(dados.Rodadas);
  const rodadasUnicas = new Map();
  mapear('rodadas (dedup)', linhasRodadas, (r) => {
    if (!rodadasUnicas.has(r.roundId)) {
      rodadasUnicas.set(r.roundId, { round_id: r.roundId, data: paraDataISO(r.data), vencedor: r.vencedor || null, rascunho: paraBooleano(r.rascunho) });
    }
  });
  await gravar('rodadas', Array.from(rodadasUnicas.values()));

  // 5. times_rodada
  const timesRodada = mapear('times_rodada', linhasRodadas, (r) => ({
    round_id: r.roundId, time_index: Number(r.timeIndex), time_nome: r.timeNome || null, vitorias: Number(r.vitorias || 0)
  }));
  await gravar('times_rodada', timesRodada, { onConflict: 'round_id,time_index' });

  // times_rodada.id é gerado pelo Postgres (identity) — buscamos de volta pra montar time_jogadores
  const { data: timesGravados, error: erroTimes } = await supabase.from('times_rodada').select('id, round_id, time_index');
  if (erroTimes) { excecoes.push('times_rodada (select de volta): ' + erroTimes.message); }
  const idPorRoundETime = new Map((timesGravados || []).map((t) => [`${t.round_id}:${t.time_index}`, t.id]));

  // 6. time_jogadores
  const timeJogadoresSet = new Map();
  linhasRodadas.forEach((r) => {
    const timeRodadaId = idPorRoundETime.get(`${r.roundId}:${r.timeIndex}`);
    if (!timeRodadaId) return;
    dividirJogadores(r.jogadores).forEach((jogadorId) => {
      const chave = `${timeRodadaId}:${jogadorId}`;
      if (!timeJogadoresSet.has(chave)) {
        timeJogadoresSet.set(chave, { time_rodada_id: timeRodadaId, jogador_id: jogadorId });
      }
    });
  });
  const timeJogadores = Array.from(timeJogadoresSet.values());
  await gravar('time_jogadores', timeJogadores);

  // 7. checkins
  const checkins = mapear('checkins', paraObjetos(dados.Checkins), (c) => ({
    id: c.id, data: paraDataISO(c.data), jogador_id: c.jogadorId || null, jogador_nome: c.jogadorNome || null,
    estrelas: paraNumero(c.estrelas), sexo: c.sexo || null,
    estrelas_ajustadas: paraNumero(c.estrelasAjustadas)
  }));
  await gravar('checkins', checkins);

  // 8. fin_dias
  const finDias = mapear('fin_dias', paraObjetos(dados.FinDias), (f) => ({
    data: paraDataISO(f.data), valor_pessoa: paraNumero(f.valorPessoa) ?? 0, pix: f.pix || null,
    valor_quadra: paraNumero(f.valorQuadra), tem_brinde: paraBooleano(f.temBrinde),
    valor_brinde: paraNumero(f.valorBrinde), atualizado_por: f.atualizadoPor || null,
    atualizado_em: paraTimestampISO(f.atualizadoEm), icone: f.icone || null, status: f.status || 'normal'
  }));
  await gravar('fin_dias', finDias);

  // 9. fin_pagamentos (credito_id fica de fora por enquanto — fin_creditos ainda não existe)
  const linhasPagamentos = paraObjetos(dados.FinPagamentos);
  const finPagamentos = mapear('fin_pagamentos', linhasPagamentos, (p) => ({
    id: p.id, data: paraDataISO(p.data), jogador_id: p.jogadorId || null, jogador_nome: p.jogadorNome || null,
    valor: paraNumero(p.valor) ?? 0, marcado_por: p.marcadoPor || null, marcado_em: paraTimestampISO(p.marcadoEm),
    estornado: paraBooleano(p.estornado), estornado_por: p.estornadoPor || null, estornado_em: paraTimestampISO(p.estornadoEm),
    tipo: p.tipo || 'dinheiro'
  }));
  await gravar('fin_pagamentos', finPagamentos);

  // 10. fin_creditos (já pode referenciar origem_pagamento_id, que existe desde o passo anterior)
  const finCreditos = mapear('fin_creditos', paraObjetos(dados.FinCreditos), (c) => ({
    id: c.id, jogador_id: c.jogadorId || null, jogador_nome: c.jogadorNome || null, valor: paraNumero(c.valor) ?? 0,
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
  const finLancamentos = mapear('fin_lancamentos', paraObjetos(dados.FinLancamentos), (l) => ({
    id: l.id, data: paraDataISO(l.data), tipo: l.tipo || null, descricao: l.descricao || null,
    valor: paraNumero(l.valor) ?? 0, criado_por: l.criadoPor || null, criado_em: paraTimestampISO(l.criadoEm),
    estornado: paraBooleano(l.estornado), estornado_por: l.estornadoPor || null, estornado_em: paraTimestampISO(l.estornadoEm)
  }));
  await gravar('fin_lancamentos', finLancamentos);

  // 13. fin_log
  const finLog = mapear('fin_log', paraObjetos(dados.FinLog), (l) => ({
    timestamp: paraTimestampISO(l.timestamp), nome: l.nome || null, email: l.email || null,
    acao: l.acao || null, detalhe: paraJsonb(l.detalhe)
  }));
  await gravarSeVazia('fin_log', finLog);

  // 14. ao_vivo / ao_vivo_log (normalmente vazias)
  const aoVivo = mapear('ao_vivo', paraObjetos(dados.AoVivo), (a) => ({
    round_id: a.roundId, time_index: Number(a.timeIndex), time_nome: a.timeNome || null,
    vitorias: Number(a.vitorias || 0), iniciado_em: paraTimestampISO(a.iniciadoEm),
    duracao_minutos: a.duracaoMinutos ? Number(a.duracaoMinutos) : null
  }));
  await gravarSeVazia('ao_vivo', aoVivo);

  const aoVivoLog = mapear('ao_vivo_log', paraObjetos(dados.AoVivoLog), (a) => ({
    round_id: a.roundId, time_index: Number(a.timeIndex), time_nome: a.timeNome || null,
    delta: Number(a.delta || 0), timestamp: paraTimestampISO(a.timestamp)
  }));
  await gravarSeVazia('ao_vivo_log', aoVivoLog);

  console.log('\n=== Resumo da migração ===');
  resumo.forEach((linha) => console.log(' -', linha));
  if (excecoes.length) {
    console.log('\n=== Exceções (revisar à mão) ===');
    excecoes.forEach((linha) => console.log(' !', linha));
  }
  if (excecoes.length) process.exitCode = 1;
}

migrar().catch((e) => { console.error('Migração interrompida:', e); process.exit(1); });
