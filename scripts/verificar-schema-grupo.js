// Confere o schema de um grupo no banco REAL: conta as linhas de cada tabela e prova que as funções enxergam o schema certo.
// Somente leitura (a única chamada que "escreve" é remover_rodada com um id que não existe: devolve false e não muda nada).
// Uso: npm run verificar-schema                       (Terça)
//      $env:GRUPO='meme'; npm run verificar-schema    (Meme)
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { configDoGrupo, opcoesDoCliente } = require('./lib/grupo');

const TABELAS = [
  'jogadores', 'rodadas', 'times_rodada', 'time_jogadores', 'checkins', 'usuarios', 'config',
  'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'ao_vivo', 'ao_vivo_log',
  'travas', 'limite_tentativas'
];

async function main() {
  const cfg = configDoGrupo();
  const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opcoesDoCliente(cfg));
  console.log('Grupo ' + cfg.grupo + ' (schema ' + cfg.schema + ')');
  let problemas = 0;
  for (const t of TABELAS) {
    const { count, error } = await cliente.from(t).select('*', { count: 'exact', head: true });
    if (error) { problemas++; console.log('  FALHA ' + t + ': ' + error.message); }
    else console.log('  ok    ' + t + ': ' + count + ' linha(s)');
  }
  const r = await cliente.rpc('remover_rodada', { p_id: '__inexistente__' });
  if (r.error || r.data !== false) {
    problemas++;
    console.log('  FALHA rpc remover_rodada: ' + (r.error ? r.error.message : 'devolveu ' + JSON.stringify(r.data) + ' (esperado false)'));
  } else console.log('  ok    rpc remover_rodada (a função enxerga as tabelas do schema)');
  console.log(problemas ? '\n' + problemas + ' problema(s).' : '\nSchema em ordem.');
  process.exit(problemas ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
