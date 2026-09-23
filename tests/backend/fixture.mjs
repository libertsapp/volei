// Dados de teste no formato do BANCO (snake_case). Linhas fora de ordem de propósito.
export const fixture = {
  jogadores: [
    { id: 'p2', nome: 'Bruno', apelido: 'Bru', foto: 'https://exemplo.com/b.jpg', estrelas: 3.5, sexo: 'M', porte: 'G', convidado: false, ordem: 2 },
    { id: 'convidado:LUCAS#ab12', nome: 'LUCAS', apelido: null, foto: null, estrelas: null, sexo: null, porte: null, convidado: true, ordem: null },
    { id: 'p1', nome: 'Ana', apelido: null, foto: null, estrelas: 4, sexo: 'F', porte: 'P', convidado: false, ordem: 1 }
  ],
  rodadas: [
    { round_id: 'r2', data: '2026-09-08', rascunho: false, ordem: 2 },
    { round_id: 'r1', data: '2026-09-01', rascunho: false, ordem: 1 }
  ],
  times_rodada: [
    { id: 21, round_id: 'r2', time_index: 1, time_nome: 'Time 2', vitorias: 1, vencedor: false },
    { id: 20, round_id: 'r2', time_index: 0, time_nome: 'Time 1', vitorias: 3, vencedor: true },
    { id: 12, round_id: 'r1', time_index: 1, time_nome: 'Time 2', vitorias: 2, vencedor: true },
    { id: 11, round_id: 'r1', time_index: 0, time_nome: 'Time 1', vitorias: 2, vencedor: true }
  ],
  time_jogadores: [
    { time_rodada_id: 11, jogador_id: 'p2', posicao: 1 },
    { time_rodada_id: 11, jogador_id: 'p1', posicao: 0 },
    { time_rodada_id: 12, jogador_id: 'convidado:LUCAS#ab12', posicao: 0 },
    { time_rodada_id: 21, jogador_id: 'p2', posicao: 0 },
    { time_rodada_id: 20, jogador_id: 'p1', posicao: 0 }
  ],
  checkins: [
    { id: 'c2', data: '2026-09-22', jogador_id: 'p2', jogador_nome: 'Bruno', estrelas: 3.5, sexo: 'M', estrelas_ajustadas: 4, ordem: 2 },
    { id: 'c3', data: '2026-09-22', jogador_id: null, jogador_nome: 'Antigo', estrelas: null, sexo: 'M', estrelas_ajustadas: null, ordem: 3 },
    { id: 'c1', data: '2026-09-22', jogador_id: 'p1', jogador_nome: 'Ana', estrelas: 4, sexo: 'F', estrelas_ajustadas: null, ordem: 1 }
  ],
  config: [
    { chave: 'checkinVagas', valor: '12' },
    { chave: 'checkinDataAberta', valor: '2026-09-22' },
    { chave: 'checkinTravado', valor: 'TRUE' },
    { chave: 'contadorAcessos', valor: '41' }
  ],
  usuarios: [
    { email: 'b@exemplo.com', nome: 'B', perfil: 'organizador', jogador_id: 'p2', criado_em: '2026-09-02T10:00:00+00:00', jogador_id_pendente: null, ordem: 2 },
    { email: 'c@exemplo.com', nome: 'C', perfil: 'jogador', jogador_id: null, criado_em: '2026-09-03T10:00:00+00:00', jogador_id_pendente: null, ordem: 3 },
    { email: 'a@exemplo.com', nome: 'A', perfil: 'admin', jogador_id: 'p1', criado_em: '2026-09-01T10:00:00+00:00', jogador_id_pendente: null, ordem: 1 }
  ],
  fin_dias: [
    { data: '2026-09-22', valor_pessoa: 14, pix: '31999999999', valor_quadra: 180, tem_brinde: true, valor_brinde: 50, atualizado_por: 'Adm', atualizado_em: '2026-09-22T18:00:00+00:00', icone: '💰', status: 'normal', ordem: 2 },
    { data: '2026-09-15', valor_pessoa: 14, pix: '', valor_quadra: 0, tem_brinde: false, valor_brinde: 0, atualizado_por: 'Adm', atualizado_em: '2026-09-15T18:00:00+00:00', icone: null, status: 'semjogo', ordem: 1 }
  ],
  fin_pagamentos: [
    { id: 'pg2', data: '2026-09-22', jogador_id: 'p2', jogador_nome: 'Bruno', valor: 14, marcado_por: 'Org', marcado_em: '2026-09-22T19:05:00+00:00', estornado: true, estornado_por: 'Adm', estornado_em: '2026-09-22T20:00:00+00:00', tipo: 'credito', credito_id: 'cr1', ordem: 2 },
    { id: 'pg3', data: '2026-09-22', jogador_id: null, jogador_nome: 'Antigo', valor: 14, marcado_por: 'Org', marcado_em: '2026-09-22T19:10:00+00:00', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, ordem: 3 },
    { id: 'pg1', data: '2026-09-22', jogador_id: 'p1', jogador_nome: 'Ana', valor: 14, marcado_por: 'Org', marcado_em: '2026-09-22T19:00:00+00:00', estornado: false, estornado_por: null, estornado_em: null, tipo: 'dinheiro', credito_id: null, ordem: 1 }
  ],
  fin_creditos: [
    { id: 'cr1', jogador_id: 'p2', jogador_nome: 'Bruno', valor: 14, origem_pagamento_id: 'pg0', data_origem: '2026-09-15', criado_por: 'Adm', criado_em: '2026-09-15T21:00:00+00:00', status: 'ativo', encerrado_por: null, encerrado_em: null, ordem: 1 }
  ],
  fin_lancamentos: [
    { id: 'l1', data: '2026-09-01', tipo: 'entrada', descricao: 'Saldo inicial', valor: 500, criado_por: 'Adm', criado_em: '2026-09-01T10:00:00+00:00', estornado: false, estornado_por: null, estornado_em: null, ordem: 1 }
  ],
  fin_log: [
    { id: 2, timestamp: '2026-09-22T19:05:00+00:00', nome: 'Org', email: 'b@exemplo.com', acao: 'marcarPagamento', detalhe: { data: '2026-09-22', jogadorNome: 'Bruno', valor: 14 } },
    { id: 3, timestamp: '2026-09-22T20:00:00+00:00', nome: 'Adm', email: 'a@exemplo.com', acao: 'nota', detalhe: { texto: 'texto solto' } },
    { id: 1, timestamp: '2026-09-22T19:00:00+00:00', nome: 'Org', email: 'b@exemplo.com', acao: 'marcarPagamento', detalhe: { data: '2026-09-22', jogadorNome: 'Ana', valor: 14 } }
  ],
  ao_vivo: [],
  ao_vivo_log: []
};
