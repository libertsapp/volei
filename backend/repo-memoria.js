// Repositório em memória: mesma interface do repo-supabase (lerTudo), usado nos testes.
export const TABELAS = [
  'jogadores', 'rodadas', 'times_rodada', 'time_jogadores', 'checkins', 'config', 'usuarios',
  'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'ao_vivo', 'ao_vivo_log'
];

export function criarRepoMemoria(dados = {}) {
  const tabelas = {};
  for (const nome of TABELAS) tabelas[nome] = (dados[nome] || []).map((linha) => ({ ...linha }));
  return {
    tabelas,
    async lerTudo() { return structuredClone(tabelas); }
  };
}
