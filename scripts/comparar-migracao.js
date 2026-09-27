// Compara as linhas da planilha do grupo com as do schema do grupo, depois de "npm run migrar". Somente leitura.
// Uso: $env:GRUPO='meme'; npm run comparar-migracao       (sem GRUPO compara o Terça)
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { lerPlanilha } = require('./lib/planilha');
const { configDoGrupo, opcoesDoCliente } = require('./lib/grupo');

// mesma regra do migrar: só conta linha de dados com a 1ª coluna preenchida
const linhas = (aba) => (aba || []).slice(1).filter((l) => l[0]).length;
const unicos = (aba, col) => new Set((aba || []).slice(1).filter((l) => l[0]).map((l) => l[col])).size;

async function contar(cliente, tabela) {
  const { count, error } = await cliente.from(tabela).select('*', { count: 'exact', head: true });
  if (error) throw new Error(tabela + ': ' + error.message);
  return count;
}

async function main() {
  const cfg = configDoGrupo();
  const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));
  const d = await lerPlanilha(cfg.spreadsheetId);
  const cabRodadas = (d.Rodadas || [])[0] || [];
  const colRound = Math.max(0, cabRodadas.indexOf('roundId'));
  // [rótulo, esperado (planilha), tabela, modo]: "min" = o banco pode ter MAIS (convidados viram linhas de jogadores);
  // "log" = o banco pode ter MENOS (o migrar só carrega fin_log quando a tabela está vazia, então numa re-migração o log novo não entra)
  const pares = [
    ['Jogadores', linhas(d.Jogadores), 'jogadores', 'min'],
    ['Rodadas (rodadas únicas)', unicos(d.Rodadas, colRound), 'rodadas'],
    ['Rodadas (times)', linhas(d.Rodadas), 'times_rodada'],
    ['Checkins', linhas(d.Checkins), 'checkins'],
    ['Usuarios', linhas(d.Usuarios), 'usuarios'],
    ['Config', (d.Config || []).filter((l) => l[0]).length, 'config'],
    ['FinDias', linhas(d.FinDias), 'fin_dias'],
    ['FinPagamentos', linhas(d.FinPagamentos), 'fin_pagamentos'],
    ['FinCreditos', linhas(d.FinCreditos), 'fin_creditos'],
    ['FinLancamentos', linhas(d.FinLancamentos), 'fin_lancamentos'],
    ['FinLog', linhas(d.FinLog), 'fin_log', 'log']
  ];
  console.log('Grupo ' + cfg.grupo + ': planilha x schema "' + cfg.schema + '"');
  let diferentes = 0;
  for (const [rotulo, esperado, tabela, modo] of pares) {
    const no = await contar(cliente, tabela);
    const ok = modo === 'min' ? no >= esperado : modo === 'log' ? no <= esperado : no === esperado;
    if (!ok) diferentes++;
    const nota = modo === 'min' ? ' (o banco também tem os convidados)' : modo === 'log' ? ' (o log só é carregado com a tabela vazia)' : '';
    console.log('  ' + (ok ? 'ok       ' : 'DIFERENTE') + ' ' + rotulo + ': planilha ' + esperado + ' | banco ' + no + nota);
  }
  console.log(diferentes ? '\n' + diferentes + ' diferença(s): reveja as exceções do "npm run migrar".' : '\nTudo confere.');
  process.exit(diferentes ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
