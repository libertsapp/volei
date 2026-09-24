// Repositório em memória: mesma interface do repo-supabase, usado nos testes. Faz o papel do BANCO onde isso
// importa: a "ordem" das linhas novas (no Postgres é o nextval de uma sequência; aqui, máximo + 1) e as funções
// gravar_rodada / remover_rodada (mesma regra: valida as chaves estrangeiras antes de mexer e substitui a rodada).
export const TABELAS = [
  'jogadores', 'rodadas', 'times_rodada', 'time_jogadores', 'checkins', 'config', 'usuarios',
  'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'ao_vivo', 'ao_vivo_log'
];

const COM_ORDEM = ['jogadores', 'rodadas', 'checkins', 'usuarios', 'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos'];

export function criarRepoMemoria(dados = {}) {
  const tabelas = {};
  for (const nome of TABELAS) tabelas[nome] = (dados[nome] || []).map((linha) => ({ ...linha }));

  // padrão da coluna "ordem": só quando a chave nem foi enviada (um `ordem: null` explícito continua nulo)
  function inserir(tabela, linha) {
    const nova = { ...linha };
    if (COM_ORDEM.includes(tabela) && !('ordem' in nova)) {
      nova.ordem = tabelas[tabela].reduce((m, x) => Math.max(m, x.ordem ?? 0), 0) + 1;
    }
    tabelas[tabela].push(nova);
    return nova;
  }

  function apagarRodada(id) {
    const idsTimes = tabelas.times_rodada.filter((t) => t.round_id === id).map((t) => t.id);
    const existia = tabelas.rodadas.some((r) => r.round_id === id);
    tabelas.time_jogadores = tabelas.time_jogadores.filter((x) => !idsTimes.includes(x.time_rodada_id));
    tabelas.times_rodada = tabelas.times_rodada.filter((t) => t.round_id !== id);
    tabelas.rodadas = tabelas.rodadas.filter((r) => r.round_id !== id);
    return existia;
  }

  return {
    tabelas,
    async lerTudo() { return structuredClone(tabelas); },
    async lerUsuarios() { return structuredClone(tabelas.usuarios); },
    async lerJogadores() { return structuredClone(tabelas.jogadores); },

    // insere ou atualiza pela chave email; numa atualização, só os campos enviados mudam
    async gravarUsuario(linha) {
      const i = tabelas.usuarios.findIndex((u) => u.email === linha.email);
      if (i === -1) inserir('usuarios', linha);
      else tabelas.usuarios[i] = { ...tabelas.usuarios[i], ...linha };
    },
    async removerUsuario(email) { tabelas.usuarios = tabelas.usuarios.filter((u) => u.email !== email); },

    async inserirJogador(linha) {
      if (tabelas.jogadores.some((j) => j.id === linha.id)) {
        throw new Error('duplicate key value violates unique constraint "jogadores_pkey"');
      }
      inserir('jogadores', { convidado: false, removido: false, ...linha });
    },
    async atualizarJogador(id, campos) {
      const i = tabelas.jogadores.findIndex((j) => j.id === id);
      if (i === -1) throw new Error('jogador não encontrado');
      tabelas.jogadores[i] = { ...tabelas.jogadores[i], ...campos };
    },

    // check-ins: a chave estrangeira para jogadores é validada aqui como o SQL faz; "ordem" vem do padrão do banco
    async inserirCheckin(linha) {
      if (tabelas.checkins.some((c) => c.id === linha.id)) {
        throw new Error('checkins: duplicate key value violates unique constraint "checkins_pkey"');
      }
      if (linha.jogador_id != null && !tabelas.jogadores.some((j) => j.id === linha.jogador_id)) {
        throw new Error('checkins: insert or update on table "checkins" violates foreign key constraint "checkins_jogador_id_fkey"');
      }
      inserir('checkins', linha);
    },
    async removerCheckin(id) {
      const antes = tabelas.checkins.length;
      tabelas.checkins = tabelas.checkins.filter((c) => c.id !== id);
      return tabelas.checkins.length < antes;
    },
    async atualizarCheckin(id, campos) {
      const i = tabelas.checkins.findIndex((c) => c.id === id);
      if (i === -1) return false;
      tabelas.checkins[i] = { ...tabelas.checkins[i], ...campos };
      return true;
    },

    async lerConfig() { return structuredClone(tabelas.config); },
    async gravarConfig(pares) {
      for (const par of pares) {
        const i = tabelas.config.findIndex((c) => c.chave === par.chave);
        if (i === -1) tabelas.config.push({ ...par });
        else tabelas.config[i] = { ...tabelas.config[i], ...par };
      }
    },

    async gravarRodada(r) {
      const existentes = new Set([...tabelas.jogadores.map((j) => j.id), ...(r.convidados || []).map((c) => c.id)]);
      for (const time of r.times) {
        for (const id of time.playerIds) {
          if (!existentes.has(id)) throw new Error('insert or update on table "time_jogadores" violates foreign key constraint "time_jogadores_jogador_id_fkey"');
        }
      }
      for (const c of r.convidados || []) {
        if (!tabelas.jogadores.some((j) => j.id === c.id)) {
          tabelas.jogadores.push({ id: c.id, nome: c.nome, apelido: null, foto: null, estrelas: null, sexo: null, porte: null, convidado: true, removido: false, ordem: null });
        }
      }
      apagarRodada(r.id);
      inserir('rodadas', { round_id: r.id, data: r.data, rascunho: r.rascunho });
      r.times.forEach((time, idx) => {
        const id = tabelas.times_rodada.reduce((m, x) => Math.max(m, x.id), 0) + 1;
        tabelas.times_rodada.push({ id, round_id: r.id, time_index: idx, time_nome: time.nome, vitorias: time.vitorias, vencedor: time.vencedor });
        const vistos = new Set();
        time.playerIds.forEach((jogador, posicao) => {
          if (vistos.has(jogador)) return; // id repetido na mesma lista: vale o primeiro
          vistos.add(jogador);
          tabelas.time_jogadores.push({ time_rodada_id: id, jogador_id: jogador, posicao });
        });
      });
    },
    async removerRodada(id) { return apagarRodada(id); }
  };
}
