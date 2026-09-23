require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { lerPlanilhaTerca } = require('./lib/planilha');
const {
  paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO, paraNumero,
  coletarConvidados, anularOrfaos
} = require('./lib/transformacoes');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resumo = [];
const excecoes = [];

// linhas[0] = cabeçalho; devolve um array de objetos { coluna: valor } usando o cabeçalho como chave
// Cada objeto também recebe _ordem = sua posição 1-based entre as linhas de dados (sheet row order)
function paraObjetos(linhas) {
  if (!linhas || linhas.length < 2) return [];
  const [cabecalho, ...resto] = linhas;
  return resto.filter((l) => l[0]).map((l, ordem) => {
    const obj = { _ordem: ordem + 1 };
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

async function gravar(tabela, registros, opcoes = {}, rotulo = tabela) {
  if (!registros.length) { resumo.push(`${rotulo}: 0 registro(s)`); return; }
  const { error } = await supabase.from(tabela).upsert(registros, opcoes);
  if (!error) { resumo.push(`${rotulo}: ${registros.length} registro(s) gravado(s)`); return; }
  let gravados = 0;
  for (const registro of registros) {
    const { error: erroLinha } = await supabase.from(tabela).upsert(registro, opcoes);
    if (erroLinha) {
      const dica = erroLinha.code === '23503' ? ' (referência a um registro que não existe — provavelmente uma falha anterior ou um dado órfão na planilha)' : '';
      excecoes.push(`${tabela} [${identificar(registro)}]: ${erroLinha.message}${dica}`);
    } else gravados++;
  }
  resumo.push(`${rotulo}: ${gravados}/${registros.length} gravado(s) (o lote falhou: ${error.message})`);
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
    estrelas: paraNumero(j.estrelas), sexo: j.sexo || null, porte: j.porte || null, ordem: j._ordem
  }));
  await gravar('jogadores', jogadores);

  // 1b. convidados (guests): coleta de rodadas, checkins, fin_pagamentos, fin_creditos
  const idsRegistrados = new Set(jogadores.map((j) => j.id));
  const linhasRodadas = paraObjetos(dados.Rodadas);
  const todasRodadas = linhasRodadas.flatMap((r) => dividirJogadores(r.jogadores));
  const linhasCheckins = paraObjetos(dados.Checkins);
  const todasCheckins = linhasCheckins.map((c) => c.jogadorId).filter(Boolean);
  const linhasPagamentos = paraObjetos(dados.FinPagamentos);
  const todasPagamentos = linhasPagamentos.map((p) => p.jogadorId).filter(Boolean);
  const linhasCreditos = paraObjetos(dados.FinCreditos);
  const todasCreditos = linhasCreditos.map((c) => c.jogadorId).filter(Boolean);
  const convidados = coletarConvidados([...todasRodadas, ...todasCheckins, ...todasPagamentos, ...todasCreditos]).filter((c) => !idsRegistrados.has(c.id));
  if (convidados.length > 0) await gravar('jogadores', convidados, {}, 'jogadores (convidados)');
  const idsConhecidos = new Set([...idsRegistrados, ...convidados.map((c) => c.id)]);

  // 2. usuarios
  const usuarios = mapear('usuarios', paraObjetos(dados.Usuarios), (u) => ({
    email: u.email, nome: u.nome || null, perfil: (u.perfil || 'jogador').toLowerCase(),
    jogador_id: u.jogadorId || null, jogador_id_pendente: u.jogadorIdPendente || null,
    criado_em: u.criadoEm ? paraTimestampISO(u.criadoEm) : new Date().toISOString(), ordem: u._ordem
  }));
  await gravar('usuarios', usuarios);

  // 3. config (Config é aba key/value, sem cabeçalho de tabela — cada linha é [chave, valor])
  const config = mapear('config', (dados.Config || []).filter((l) => l[0]), (l) => ({ chave: l[0], valor: String(l[1] ?? '') }));
  await gravar('config', config);

  // 4. rodadas (uma linha por round_id só, mesmo que a aba tenha várias linhas por rodada)
  const rodadasUnicas = new Map();
  mapear('rodadas (dedup)', linhasRodadas, (r) => {
    if (!rodadasUnicas.has(r.roundId)) {
      rodadasUnicas.set(r.roundId, { round_id: r.roundId, data: paraDataISO(r.data), rascunho: paraBooleano(r.rascunho), ordem: r._ordem });
    }
  });
  await gravar('rodadas', Array.from(rodadasUnicas.values()));

  // 5. times_rodada
  const timesRodada = mapear('times_rodada', linhasRodadas, (r) => ({
    round_id: r.roundId, time_index: Number(r.timeIndex), time_nome: r.timeNome || null, vitorias: Number(r.vitorias || 0), vencedor: paraBooleano(r.vencedor)
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
    dividirJogadores(r.jogadores).forEach((jogadorId, posicao) => {
      const chave = `${timeRodadaId}:${jogadorId}`;
      if (!timeJogadoresSet.has(chave)) {
        timeJogadoresSet.set(chave, { time_rodada_id: timeRodadaId, jogador_id: jogadorId, posicao });
      }
    });
  });
  const timeJogadores = Array.from(timeJogadoresSet.values());
  await gravar('time_jogadores', timeJogadores);

  // 7. checkins
  let checkinsRaw = mapear('checkins', linhasCheckins, (c) => ({
    id: c.id, data: paraDataISO(c.data), jogador_id: c.jogadorId || null, jogador_nome: c.jogadorNome || null,
    estrelas: paraNumero(c.estrelas), sexo: c.sexo || null,
    estrelas_ajustadas: paraNumero(c.estrelasAjustadas), ordem: c._ordem
  }));
  const checkinsOrfaos = anularOrfaos(checkinsRaw, idsConhecidos);
  if (checkinsOrfaos.anulados > 0) resumo.push(`checkins: ${checkinsOrfaos.anulados} registro(s) gravado(s) com jogador_id nulo (o jogador não existe mais na aba Jogadores; o nome fica em jogador_nome)`);
  await gravar('checkins', checkinsOrfaos.registros);

  // 8. fin_dias
  const finDias = mapear('fin_dias', paraObjetos(dados.FinDias), (f) => ({
    data: paraDataISO(f.data), valor_pessoa: paraNumero(f.valorPessoa) ?? 0, pix: f.pix || null,
    valor_quadra: paraNumero(f.valorQuadra), tem_brinde: paraBooleano(f.temBrinde),
    valor_brinde: paraNumero(f.valorBrinde), atualizado_por: f.atualizadoPor || null,
    atualizado_em: paraTimestampISO(f.atualizadoEm), icone: f.icone || null, status: f.status || 'normal', ordem: f._ordem
  }));
  await gravar('fin_dias', finDias);

  // 9. fin_pagamentos (credito_id fica de fora por enquanto — fin_creditos ainda não existe)
  let finPagamentosRaw = mapear('fin_pagamentos', linhasPagamentos, (p) => ({
    id: p.id, data: paraDataISO(p.data), jogador_id: p.jogadorId || null, jogador_nome: p.jogadorNome || null,
    valor: paraNumero(p.valor) ?? 0, marcado_por: p.marcadoPor || null, marcado_em: paraTimestampISO(p.marcadoEm),
    estornado: paraBooleano(p.estornado), estornado_por: p.estornadoPor || null, estornado_em: paraTimestampISO(p.estornadoEm),
    tipo: p.tipo || 'dinheiro', ordem: p._ordem
  }));
  const finPagamentosOrfaos = anularOrfaos(finPagamentosRaw, idsConhecidos);
  if (finPagamentosOrfaos.anulados > 0) resumo.push(`fin_pagamentos: ${finPagamentosOrfaos.anulados} registro(s) gravado(s) com jogador_id nulo (o jogador não existe mais na aba Jogadores; o nome fica em jogador_nome)`);
  const finPagamentos = finPagamentosOrfaos.registros;
  await gravar('fin_pagamentos', finPagamentos);

  // 10. fin_creditos (já pode referenciar origem_pagamento_id, que existe desde o passo anterior)
  let finCreditosRaw = mapear('fin_creditos', linhasCreditos, (c) => ({
    id: c.id, jogador_id: c.jogadorId || null, jogador_nome: c.jogadorNome || null, valor: paraNumero(c.valor) ?? 0,
    origem_pagamento_id: c.origemPagamentoId || null, data_origem: c.dataOrigem ? paraDataISO(c.dataOrigem) : null,
    criado_por: c.criadoPor || null, criado_em: paraTimestampISO(c.criadoEm), status: c.status || null,
    encerrado_por: c.encerradoPor || null, encerrado_em: paraTimestampISO(c.encerradoEm), ordem: c._ordem
  }));
  const finCreditosOrfaos = anularOrfaos(finCreditosRaw, idsConhecidos);
  if (finCreditosOrfaos.anulados > 0) resumo.push(`fin_creditos: ${finCreditosOrfaos.anulados} registro(s) gravado(s) com jogador_id nulo (o jogador não existe mais na aba Jogadores; o nome fica em jogador_nome)`);
  const finCreditos = finCreditosOrfaos.registros;
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
    estornado: paraBooleano(l.estornado), estornado_por: l.estornadoPor || null, estornado_em: paraTimestampISO(l.estornadoEm), ordem: l._ordem
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
