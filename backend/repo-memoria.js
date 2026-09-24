// Repositório em memória: mesma interface do repo-supabase, usado nos testes. Faz o papel do BANCO onde isso
// importa: a "ordem" das linhas novas (no Postgres é o nextval de uma sequência; aqui, máximo + 1) e as funções
// gravar_rodada / remover_rodada (mesma regra: valida as chaves estrangeiras antes de mexer e substitui a rodada).
export const TABELAS = [
  'jogadores', 'rodadas', 'times_rodada', 'time_jogadores', 'checkins', 'config', 'usuarios',
  'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos', 'fin_log', 'ao_vivo', 'ao_vivo_log'
];

const COM_ORDEM = ['jogadores', 'rodadas', 'checkins', 'usuarios', 'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos'];

// opcoes.agora: relógio da trava em milissegundos (padrão Date.now); os testes injetam um relógio falso para ser determinístico
export function criarRepoMemoria(dados = {}, opcoes = {}) {
  const agoraMs = opcoes.agora || (() => Date.now());
  const travas = new Map(); // nome -> { dono, expira } (na memória; no banco é a tabela "travas", ajuste 5)
  const tabelas = {};
  for (const nome of TABELAS) tabelas[nome] = (dados[nome] || []).map((linha) => ({ ...linha }));

  // padrão da coluna "ordem": só quando a chave nem foi enviada (um `ordem: null` explícito continua nulo)
  function inserir(tabela, linha) {
    const nova = { ...linha };
    if (COM_ORDEM.includes(tabela) && !('ordem' in nova)) {
      nova.ordem = tabelas[tabela].reduce((m, x) => Math.max(m, x.ordem ?? 0), 0) + 1;
    }
    // fin_log.id é "identity" no banco (nunca enviado): aqui, máximo + 1
    if (tabela === 'fin_log' && !('id' in nova)) nova.id = tabelas.fin_log.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1;
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
    travas,
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

    // ---- financeiro (etapa 4a). Semântica igual à do repo-supabase; "ordem" e o id do log vêm do padrão do banco ----
    // fin_dias: upsert pela data; numa atualização só os campos enviados mudam (status e ordem ficam como estavam);
    // dia novo nasce com status 'normal' (padrão da coluna)
    async gravarFinDia(linha) {
      const i = tabelas.fin_dias.findIndex((d) => d.data === linha.data);
      if (i === -1) inserir('fin_dias', { status: 'normal', ...linha });
      else tabelas.fin_dias[i] = { ...tabelas.fin_dias[i], ...linha };
    },
    // fin_pagamentos: emula o índice único parcial fin_pagamentos_valido_uniq (data, jogador_id) onde não estornado
    // (sql/schema-terca-supabase-ajuste-4.sql): devolve false se já existe pagamento válido, true se inseriu
    async inserirFinPagamento(linha) {
      if (tabelas.fin_pagamentos.some((p) => p.id === linha.id)) {
        throw new Error('fin_pagamentos: duplicate key value violates unique constraint "fin_pagamentos_pkey"');
      }
      if (linha.jogador_id != null && linha.estornado !== true && tabelas.fin_pagamentos.some((p) =>
        p.data === linha.data && p.jogador_id === linha.jogador_id && p.estornado !== true)) return false;
      inserir('fin_pagamentos', { estornado: false, tipo: 'dinheiro', ...linha });
      return true;
    },
    // marca como estornado SÓ se ainda não estava (quem chegou depois recebe false e não sobrescreve quem estornou primeiro)
    async estornarFinPagamento(id, { por, em }) {
      const i = tabelas.fin_pagamentos.findIndex((p) => p.id === id && p.estornado !== true);
      if (i === -1) return false;
      tabelas.fin_pagamentos[i] = { ...tabelas.fin_pagamentos[i], estornado: true, estornado_por: por, estornado_em: em };
      return true;
    },
    // encerra um crédito ATIVO (devolvido/cancelado); false se não estava ativo
    async encerrarFinCredito(id, status, { por, em }) {
      const i = tabelas.fin_creditos.findIndex((c) => c.id === id && c.status === 'ativo');
      if (i === -1) return false;
      tabelas.fin_creditos[i] = { ...tabelas.fin_creditos[i], status, encerrado_por: por, encerrado_em: em };
      return true;
    },
    async inserirFinLancamento(linha) {
      if (tabelas.fin_lancamentos.some((l) => l.id === linha.id)) {
        throw new Error('fin_lancamentos: duplicate key value violates unique constraint "fin_lancamentos_pkey"');
      }
      inserir('fin_lancamentos', { estornado: false, ...linha });
    },
    async estornarFinLancamento(id, { por, em }) {
      const i = tabelas.fin_lancamentos.findIndex((l) => l.id === id && l.estornado !== true);
      if (i === -1) return false;
      tabelas.fin_lancamentos[i] = { ...tabelas.fin_lancamentos[i], estornado: true, estornado_por: por, estornado_em: em };
      return true;
    },
    async inserirFinLog(linha) { inserir('fin_log', linha); },
    // muda só o status de um dia existente ('normal' | 'semjogo'); false se o dia não existe
    async definirStatusFinDia(data, status) {
      const i = tabelas.fin_dias.findIndex((d) => d.data === data);
      if (i === -1) return false;
      tabelas.fin_dias[i] = { ...tabelas.fin_dias[i], status };
      return true;
    },
    async inserirFinCredito(linha) {
      if (tabelas.fin_creditos.some((c) => c.id === linha.id)) {
        throw new Error('fin_creditos: duplicate key value violates unique constraint "fin_creditos_pkey"');
      }
      inserir('fin_creditos', { status: 'ativo', ...linha });
    },

    // ---- trava de gravação (etapa 4b). Mesma regra da função pegar_trava do Postgres: só toma se não existe, se o aluguel
    // expirou (expira_em < agora) ou se o dono é o mesmo; devolve true se conseguiu ----
    async pegarTrava(nome, dono, ttlSeg) {
      const agora = agoraMs();
      const t = travas.get(nome);
      if (t && t.expira >= agora && t.dono !== dono) return false;
      travas.set(nome, { dono, expira: agora + ttlSeg * 1000 });
      return true;
    },
    async soltarTrava(nome, dono) {
      const t = travas.get(nome);
      if (t && t.dono === dono) travas.delete(nome);
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
    // remover_rodada do ajuste 6: uma transmissão ao vivo de uma rodada que deixou de existir não tem sentido (e a chave
    // estrangeira de ao_vivo não deixaria apagar a rodada), então o Ao Vivo dela sai junto, na mesma operação
    async removerRodada(id) {
      const existia = apagarRodada(id);
      tabelas.ao_vivo = tabelas.ao_vivo.filter((a) => a.round_id !== id);
      tabelas.ao_vivo_log = tabelas.ao_vivo_log.filter((a) => a.round_id !== id);
      return existia;
    },

    // ---- Ao Vivo e contador de acessos (etapa 5). "id" é identity no banco: aqui, máximo + 1 ----
    async lerAoVivo() { return structuredClone({ ao_vivo: tabelas.ao_vivo, ao_vivo_log: tabelas.ao_vivo_log }); },
    async lerAoVivoDaRodada(roundId) {
      return structuredClone(tabelas.ao_vivo.filter((a) => a.round_id === roundId).sort((a, b) => a.id - b.id));
    },
    // o lote entra inteiro ou não entra; round_id tem chave estrangeira para rodadas (a checagem do banco)
    async inserirAoVivo(linhas) {
      for (const l of linhas) {
        if (l.round_id != null && !tabelas.rodadas.some((r) => r.round_id === l.round_id)) {
          throw new Error('ao_vivo: insert or update on table "ao_vivo" violates foreign key constraint "ao_vivo_round_id_fkey"');
        }
      }
      for (const l of linhas) tabelas.ao_vivo.push({ id: tabelas.ao_vivo.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1, ...l });
    },
    async atualizarVitoriasAoVivo(id, vitorias) {
      const i = tabelas.ao_vivo.findIndex((a) => a.id === id);
      if (i === -1) return false;
      tabelas.ao_vivo[i] = { ...tabelas.ao_vivo[i], vitorias };
      return true;
    },
    async inserirAoVivoLog(linhas) {
      for (const l of linhas) tabelas.ao_vivo_log.push({ id: tabelas.ao_vivo_log.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1, ...l });
    },
    // encerra a transmissão: apaga as linhas do placar e o log daquela rodada
    async apagarAoVivo(roundId) {
      tabelas.ao_vivo = tabelas.ao_vivo.filter((a) => a.round_id !== roundId);
      tabelas.ao_vivo_log = tabelas.ao_vivo_log.filter((a) => a.round_id !== roundId);
    },
    // emula a função incrementar_acesso() do banco (mesma regra do SQL): sem linha, ou valor que não é número, conta como 0
    // (o "Number(x) || 0" do .gs); soma 1 e guarda como texto; devolve o novo valor como número
    async incrementarAcesso() {
      const i = tabelas.config.findIndex((c) => c.chave === 'contadorAcessos');
      const atual = i === -1 ? '0' : String(tabelas.config[i].valor ?? '').trim();
      const base = /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(atual) ? Number(atual) : 0;
      const novo = base + 1;
      if (i === -1) tabelas.config.push({ chave: 'contadorAcessos', valor: String(novo) });
      else tabelas.config[i] = { ...tabelas.config[i], valor: String(novo) };
      return novo;
    }
  };
}
