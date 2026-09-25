import { TABELAS } from './repo-memoria.js';

const PAGINA = 1000; // limite de linhas por consulta do Supabase; as tabelas de hoje têm menos que isso (a maior, time_jogadores, ~540)

// colunas-chave de cada tabela, usadas no ORDER BY da paginação
const CHAVES = {
  jogadores: ['id'], rodadas: ['round_id'], times_rodada: ['id'], time_jogadores: ['time_rodada_id', 'jogador_id'],
  checkins: ['id'], config: ['chave'], usuarios: ['email'], fin_dias: ['data'], fin_pagamentos: ['id'],
  fin_creditos: ['id'], fin_lancamentos: ['id'], ao_vivo: ['id'], ao_vivo_log: ['id']
};

const DICA_AJUSTE_6 = ' (rode sql/schema-terca-supabase-ajuste-6.sql no SQL Editor do Supabase)';

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
    // muda só o status de um dia existente ('normal' | 'semjogo'); false se o dia não existe
    async definirStatusFinDia(data, status) {
      const { data: linhas, error } = await cliente.from('fin_dias').update({ status }).eq('data', data).select('data');
      if (error) throw new Error('fin_dias: ' + error.message);
      return linhas.length > 0;
    },
    async inserirFinCredito(linha) {
      const { error } = await cliente.from('fin_creditos').insert(linha);
      if (error) throw new Error('fin_creditos: ' + error.message);
    },
    // ---- trava de gravação (etapa 4b; funções do sql/schema-terca-supabase-ajuste-5.sql). Se o SQL ainda não foi rodado, o erro
    // cita pegar_trava e a gravação NÃO segue sem trava ----
    async pegarTrava(nome, dono, ttlSeg) {
      const { data, error } = await cliente.rpc('pegar_trava', { p_nome: nome, p_dono: dono, p_ttl_seg: ttlSeg });
      if (error) throw new Error('pegar_trava: ' + error.message + ' (rode sql/schema-terca-supabase-ajuste-5.sql no SQL Editor do Supabase)');
      return data === true;
    },
    async soltarTrava(nome, dono) {
      const { error } = await cliente.rpc('soltar_trava', { p_nome: nome, p_dono: dono });
      if (error) throw new Error('soltar_trava: ' + error.message);
    },
    // ---- limite de tentativas da chave mestra (funções do sql/schema-terca-supabase-ajuste-7.sql). Erro aqui NÃO libera a senha:
    // sobe e o handler responde com erro (falha fechada) ----
    async registrarTentativa(chave, max, janelaSeg, bloqueioSeg) {
      const { data, error } = await cliente.rpc('registrar_tentativa', { p_chave: chave, p_max: max, p_janela_seg: janelaSeg, p_bloqueio_seg: bloqueioSeg });
      if (error) throw new Error('registrar_tentativa: ' + error.message + ' (rode sql/schema-terca-supabase-ajuste-7.sql no SQL Editor do Supabase)');
      return data === true;
    },
    async limparFalhas(chave) {
      const { error } = await cliente.rpc('limpar_falhas', { p_chave: chave });
      if (error) throw new Error('limpar_falhas: ' + error.message);
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
    },

    // ---- Ao Vivo e contador de acessos (etapa 5; colunas e função do sql/schema-terca-supabase-ajuste-6.sql) ----
    async lerAoVivo() {
      const [ao_vivo, ao_vivo_log] = await Promise.all([lerTabela(cliente, 'ao_vivo'), lerTabela(cliente, 'ao_vivo_log')]);
      return { ao_vivo, ao_vivo_log };
    },
    async lerAoVivoDaRodada(roundId) {
      const { data, error } = await cliente.from('ao_vivo').select('*').eq('round_id', roundId).order('id');
      if (error) throw new Error('ao_vivo: ' + error.message);
      return data;
    },
    // o lote vai num único INSERT (entra inteiro ou não entra); id é identity do banco
    async inserirAoVivo(linhas) {
      const { error } = await cliente.from('ao_vivo').insert(linhas);
      if (error) throw new Error('ao_vivo: ' + error.message + DICA_AJUSTE_6);
    },
    async atualizarVitoriasAoVivo(id, vitorias) {
      const { data, error } = await cliente.from('ao_vivo').update({ vitorias }).eq('id', id).select('id');
      if (error) throw new Error('ao_vivo: ' + error.message);
      return data.length > 0;
    },
    async inserirAoVivoLog(linhas) {
      const { error } = await cliente.from('ao_vivo_log').insert(linhas);
      if (error) throw new Error('ao_vivo_log: ' + error.message);
    },
    async apagarAoVivo(roundId) {
      const a = await cliente.from('ao_vivo').delete().eq('round_id', roundId);
      if (a.error) throw new Error('ao_vivo: ' + a.error.message);
      const b = await cliente.from('ao_vivo_log').delete().eq('round_id', roundId);
      if (b.error) throw new Error('ao_vivo_log: ' + b.error.message);
    },
    // soma 1 ao contador num único comando atômico do banco (upsert com UPDATE ... valor + 1); devolve o novo valor
    async incrementarAcesso() {
      const { data, error } = await cliente.rpc('incrementar_acesso');
      if (error) throw new Error('incrementar_acesso: ' + error.message + DICA_AJUSTE_6);
      return Number(data);
    }
  };
}
