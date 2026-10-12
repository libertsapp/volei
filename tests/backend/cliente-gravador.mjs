// Cliente falso do supabase-js para os testes do multigrupo: grava cada operação encadeada (tabela, verbo, carga,
// opções, filtros) e responde vazio. Só a parte da interface que o repo-supabase usa.
export function clienteGravador() {
  const ops = [];
  const builder = (registro) => {
    const q = {};
    for (const f of ['eq', 'neq', 'lte', 'gte', 'in', 'or']) q[f] = (...a) => { registro.filtros.push([f, ...a]); return q; };
    for (const f of ['order', 'range', 'limit', 'select']) q[f] = () => q;
    q.maybeSingle = () => q;
    q.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return q;
  };
  const from = (tabela) => {
    const verbo = (nome) => (carga, opcoes) => { const r = { tabela, verbo: nome, carga, opcoes, filtros: [] }; ops.push(r); return builder(r); };
    return { select: verbo('select'), insert: verbo('insert'), upsert: verbo('upsert'), update: verbo('update'), delete: verbo('delete') };
  };
  const rpc = (nome, params) => { ops.push({ verbo: 'rpc', nome, params, filtros: [] }); return builder(ops.at(-1)); };
  return { ops, from, rpc };
}
