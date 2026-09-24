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
    async lerTudo() { return structuredClone(tabelas); },
    async lerUsuarios() { return structuredClone(tabelas.usuarios); },
    async lerJogadores() { return structuredClone(tabelas.jogadores); },
    // insere ou atualiza pela chave email; numa atualização, só os campos enviados mudam
    async gravarUsuario(linha) {
      const i = tabelas.usuarios.findIndex((u) => u.email === linha.email);
      if (i === -1) tabelas.usuarios.push({ ...linha });
      else tabelas.usuarios[i] = { ...tabelas.usuarios[i], ...linha };
    },
    async removerUsuario(email) { tabelas.usuarios = tabelas.usuarios.filter((u) => u.email !== email); }
  };
}
