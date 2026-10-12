// Repositório da LIGA no Supabase. O cliente recebido deve apontar pro schema "liga" (db: { schema: 'liga' }) e usar a
// service_role (RLS ligado sem políticas, como nas outras tabelas). Toda mensagem de erro leva o nome da tabela e a dica
// do SQL — o caso mais provável de erro aqui é a função ter sido publicada antes de o schema existir.
const DICA = ' (rode sql/liga/schema-liga.sql no SQL Editor do Supabase e inclua "liga" em Exposed schemas)';
const falha = (tabela, error) => new Error(tabela + ': ' + error.message + DICA);
const LIMITE_AMISTOSOS = 300; // bem acima do uso real; o mapeamento ainda corta o histórico em 50

export function criarRepoLigaSupabase(cliente) {
  async function porAmistosos(tabela, ids) {
    if (!ids.length) return [];
    const { data, error } = await cliente.from(tabela).select('*').in('amistoso_id', ids);
    if (error) throw falha(tabela, error);
    return data || [];
  }

  return {
    async lerGrupos() {
      const { data, error } = await cliente.from('grupos').select('*').order('id');
      if (error) throw falha('grupos', error);
      return data || [];
    },
    // grupoId vem da configuração do servidor (nunca do navegador), por isso pode entrar direto no filtro "or"
    async lerAmistososDoGrupo(grupoId) {
      const { data, error } = await cliente.from('amistosos').select('*')
        .or(`grupo_convidante.eq.${grupoId},grupo_convidado.eq.${grupoId}`)
        .order('criado_em', { ascending: false }).limit(LIMITE_AMISTOSOS);
      if (error) throw falha('amistosos', error);
      const amistosos = data || [];
      if (!amistosos.length) return { amistosos: [], mensagens: [], escalacoes: [], travas: [] };
      const ids = amistosos.map((a) => a.id);
      const [mensagens, escalacoes, travas] = await Promise.all([
        porAmistosos('amistoso_mensagens', ids), porAmistosos('escalacoes', ids), porAmistosos('travas_escalacao', ids)
      ]);
      return { amistosos, mensagens, escalacoes, travas };
    },
    async lerAmistoso(id) {
      const { data, error } = await cliente.from('amistosos').select('*').eq('id', id).maybeSingle();
      if (error) throw falha('amistosos', error);
      if (!data) return null;
      const [escalacoes, travas] = await Promise.all([porAmistosos('escalacoes', [id]), porAmistosos('travas_escalacao', [id])]);
      return { amistoso: data, escalacoes, travas };
    },
    async inserirAmistoso(linha) {
      const { error } = await cliente.from('amistosos').insert(linha);
      if (error) throw falha('amistosos', error);
    },
    // "update ... where id = X and status = Y": se outra pessoa mudou o status antes, nenhuma linha volta e devolve false
    async atualizarAmistosoSe(id, statusEsperado, campos) {
      const { data, error } = await cliente.from('amistosos').update(campos).eq('id', id).eq('status', statusEsperado).select('id');
      if (error) throw falha('amistosos', error);
      return (data || []).length > 0;
    },
    async inserirMensagem(linha) {
      const { error } = await cliente.from('amistoso_mensagens').insert(linha);
      if (error) throw falha('amistoso_mensagens', error);
    },
    async inserirEscalacao(linha) {
      const { error } = await cliente.from('escalacoes').insert(linha);
      if (error) {
        if (error.code === '23505') return false; // unique (amistoso, grupo, jogador): já está na lista
        throw falha('escalacoes', error);
      }
      return true;
    },
    async atualizarEscalacao(amistosoId, grupo, jogadorId, campos) {
      const { data, error } = await cliente.from('escalacoes').update(campos)
        .eq('amistoso_id', amistosoId).eq('grupo', grupo).eq('jogador_id', jogadorId).select('id');
      if (error) throw falha('escalacoes', error);
      return (data || []).length > 0;
    },
    async removerEscalacao(amistosoId, grupo, jogadorId) {
      const { data, error } = await cliente.from('escalacoes').delete()
        .eq('amistoso_id', amistosoId).eq('grupo', grupo).eq('jogador_id', jogadorId).select('id');
      if (error) throw falha('escalacoes', error);
      return (data || []).length > 0;
    },
    async definirTrava(amistosoId, grupo, travada) {
      const r = travada
        ? await cliente.from('travas_escalacao').upsert({ amistoso_id: amistosoId, grupo }, { onConflict: 'amistoso_id,grupo', ignoreDuplicates: true })
        : await cliente.from('travas_escalacao').delete().eq('amistoso_id', amistosoId).eq('grupo', grupo);
      if (r.error) throw falha('travas_escalacao', r.error);
    }
  };
}
