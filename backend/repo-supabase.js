import { TABELAS } from './repo-memoria.js';

const PAGINA = 1000; // limite de linhas por consulta do Supabase; as tabelas de hoje têm menos que isso (a maior, time_jogadores, ~540)

// colunas-chave de cada tabela, usadas no ORDER BY da paginação
const CHAVES = {
  jogadores: ['id'], rodadas: ['round_id'], times_rodada: ['id'], time_jogadores: ['time_rodada_id', 'jogador_id'],
  checkins: ['id'], config: ['chave'], usuarios: ['email'], fin_dias: ['data'], fin_pagamentos: ['id'],
  fin_creditos: ['id'], fin_lancamentos: ['id'], ao_vivo: ['id'], ao_vivo_log: ['id']
};

async function lerTabela(cliente, tabela) {
  let saida = [];
  for (let de = 0; ; de += PAGINA) {
    // sem ORDER BY estável, páginas seguidas podem repetir ou pular linhas
    let consulta = cliente.from(tabela).select('*');
    for (const coluna of CHAVES[tabela] || []) consulta = consulta.order(coluna);
    const { data, error } = await consulta.range(de, de + PAGINA - 1);
    if (error) throw new Error(tabela + ': ' + error.message);
    saida = saida.concat(data);
    if (data.length < PAGINA) break;
  }
  return saida;
}

// Repositório de verdade: lê todas as tabelas (em paralelo). O cliente recebido deve usar a
// service_role, porque o RLS está ligado sem políticas (o navegador nunca acessa o banco direto).
export function criarRepoSupabase(cliente) {
  return {
    async lerTudo() {
      const pares = await Promise.all(TABELAS.map(async (tabela) => {
        if (tabela === 'fin_log') {
          // o app só usa os 100 mais recentes
          const { data, error } = await cliente.from(tabela).select('*').order('id', { ascending: false }).limit(100);
          if (error) throw new Error(tabela + ': ' + error.message);
          return [tabela, data];
        }
        return [tabela, await lerTabela(cliente, tabela)];
      }));
      return Object.fromEntries(pares);
    },
    async lerUsuarios() { return lerTabela(cliente, 'usuarios'); },
    async lerJogadores() { return lerTabela(cliente, 'jogadores'); },
    // upsert pela chave email (a linha já vem completa do domínio: com criado_em/ordem quando é novo)
    async gravarUsuario(linha) {
      const { error } = await cliente.from('usuarios').upsert(linha);
      if (error) throw new Error('usuarios: ' + error.message);
    },
    async removerUsuario(email) {
      const { error } = await cliente.from('usuarios').delete().eq('email', email);
      if (error) throw new Error('usuarios: ' + error.message);
    },
    async inserirJogador(linha) {
      const { error } = await cliente.from('jogadores').insert(linha);
      if (error) throw new Error('jogadores: ' + error.message);
    },
    async atualizarJogador(id, campos) {
      const { error } = await cliente.from('jogadores').update(campos).eq('id', id);
      if (error) throw new Error('jogadores: ' + error.message);
    },
    // check-ins: "ordem" não é enviada, vem do padrão (sequência) do banco; a chave estrangeira também é do banco
    async inserirCheckin(linha) {
      const { error } = await cliente.from('checkins').insert(linha);
      if (error) throw new Error('checkins: ' + error.message);
    },
    async removerCheckin(id) {
      const { data, error } = await cliente.from('checkins').delete().eq('id', id).select('id');
      if (error) throw new Error('checkins: ' + error.message);
      return data.length > 0;
    },
    async atualizarCheckin(id, campos) {
      const { data, error } = await cliente.from('checkins').update(campos).eq('id', id).select('id');
      if (error) throw new Error('checkins: ' + error.message);
      return data.length > 0;
    },
    // ---- financeiro (etapa 4a). "ordem" (sequências) e o id do log (identity) vêm do banco: nunca são enviados ----
    // upsert pela data: numa atualização só as colunas enviadas mudam (status e ordem ficam como estavam)
    async gravarFinDia(linha) {
      const { error } = await cliente.from('fin_dias').upsert(linha, { onConflict: 'data' });
      if (error) throw new Error('fin_dias: ' + error.message);
    },
    // false = já existe pagamento válido desse jogador no dia (índice único parcial do ajuste 4); o resto propaga
    async inserirFinPagamento(linha) {
      const { error } = await cliente.from('fin_pagamentos').insert(linha);
      if (error) {
        if (error.code === '23505' && /fin_pagamentos_valido_uniq/.test(String(error.message) + String(error.details || ''))) return false;
        throw new Error('fin_pagamentos: ' + error.message);
      }
      return true;
    },
    // só estorna se ainda não estava estornado (um único UPDATE condicional: sem corrida entre dois toques)
    async estornarFinPagamento(id, { por, em }) {
      const { data, error } = await cliente.from('fin_pagamentos')
        .update({ estornado: true, estornado_por: por, estornado_em: em }).eq('id', id).eq('estornado', false).select('id');
      if (error) throw new Error('fin_pagamentos: ' + error.message);
      return data.length > 0;
    },
    async encerrarFinCredito(id, status, { por, em }) {
      const { data, error } = await cliente.from('fin_creditos')
        .update({ status, encerrado_por: por, encerrado_em: em }).eq('id', id).eq('status', 'ativo').select('id');
      if (error) throw new Error('fin_creditos: ' + error.message);
      return data.length > 0;
    },
    async inserirFinLancamento(linha) {
      const { error } = await cliente.from('fin_lancamentos').insert(linha);
      if (error) throw new Error('fin_lancamentos: ' + error.message);
    },
    async estornarFinLancamento(id, { por, em }) {
      const { data, error } = await cliente.from('fin_lancamentos')
        .update({ estornado: true, estornado_por: por, estornado_em: em }).eq('id', id).eq('estornado', false).select('id');
      if (error) throw new Error('fin_lancamentos: ' + error.message);
      return data.length > 0;
    },
    async inserirFinLog(linha) {
      const { error } = await cliente.from('fin_log').insert(linha);
      if (error) throw new Error('fin_log: ' + error.message);
    },
    async lerConfig() { return lerTabela(cliente, 'config'); },
    async gravarConfig(pares) {
      const { error } = await cliente.from('config').upsert(pares);
      if (error) throw new Error('config: ' + error.message);
    },
    // a rodada inteira é gravada por uma função do banco (uma transação só); ver sql/schema-terca-supabase-ajuste-3.sql
    async gravarRodada(r) {
      const { error } = await cliente.rpc('gravar_rodada', { p: r });
      if (error) throw new Error('gravar_rodada: ' + error.message);
    },
    async removerRodada(id) {
      const { data, error } = await cliente.rpc('remover_rodada', { p_id: id });
      if (error) throw new Error('remover_rodada: ' + error.message);
      return data === true;
    }
  };
}
