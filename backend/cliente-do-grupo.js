// Cliente do banco "com escopo de grupo" (grupos independentes, spec 2026-10-12): embrulha o supabase-js para que TODA
// operação do repositório fique presa a um grupo — select/update/delete ganham .eq('grupo_id', X) antes de qualquer outro
// filtro, insert/upsert gravam grupo_id em cada linha (e o onConflict passa a incluir grupo_id), e toda função do banco
// recebe p_grupo_id. Assim o repo-supabase de sempre vira multigrupo sem reescrever método nenhum, e um método novo
// criado amanhã já nasce filtrado. Qualquer tentativa de escolher OUTRO grupo por fora do escopo é recusada com erro
// (falha alta em vez de gravar no grupo errado em silêncio).
export function clienteDoGrupo(cliente, grupoId) {
  if (!grupoId) throw new Error('clienteDoGrupo: grupoId obrigatório');
  const comGrupo = (linha) => {
    if (linha && Object.hasOwn(linha, 'grupo_id') && linha.grupo_id !== grupoId) {
      throw new Error('clienteDoGrupo: linha de outro grupo recusada');
    }
    return { ...linha, grupo_id: grupoId };
  };
  const linhas = (v) => (Array.isArray(v) ? v.map(comGrupo) : comGrupo(v));
  // a chave de conflito precisa começar por grupo_id: o mesmo "data" ou "endpoint" pode existir em dois grupos
  const conflito = (opcoes) => (opcoes && opcoes.onConflict ? { ...opcoes, onConflict: 'grupo_id,' + opcoes.onConflict } : opcoes);

  return {
    from(tabela) {
      const base = cliente.from(tabela);
      return {
        select: (...a) => base.select(...a).eq('grupo_id', grupoId),
        insert: (v, opcoes) => base.insert(linhas(v), opcoes),
        upsert: (v, opcoes) => base.upsert(linhas(v), conflito(opcoes)),
        update: (campos, opcoes) => {
          if (campos && Object.hasOwn(campos, 'grupo_id')) throw new Error('clienteDoGrupo: update não pode mudar grupo_id');
          return base.update(campos, opcoes).eq('grupo_id', grupoId);
        },
        delete: (opcoes) => base.delete(opcoes).eq('grupo_id', grupoId)
      };
    },
    rpc(nome, params, opcoes) {
      if (params && Object.hasOwn(params, 'p_grupo_id')) throw new Error('clienteDoGrupo: p_grupo_id vem do escopo, não do chamador');
      return cliente.rpc(nome, { p_grupo_id: grupoId, ...(params || {}) }, opcoes);
    }
  };
}
