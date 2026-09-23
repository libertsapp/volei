import { TABELAS } from './repo-memoria.js';

const PAGINA = 1000; // limite de linhas por consulta do Supabase; as tabelas de hoje têm menos que isso (a maior, time_jogadores, ~540)

async function lerTabela(cliente, tabela) {
  let saida = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await cliente.from(tabela).select('*').range(de, de + PAGINA - 1);
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
    }
  };
}
