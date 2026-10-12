// Repositório dos grupos independentes: o MESMO repo-supabase de sempre, falando com o banco através do cliente com
// escopo de grupo (cliente-do-grupo.js). Nenhuma regra é duplicada aqui de propósito — o isolamento entre grupos mora
// num lugar só, e todo método atual ou futuro do repo-supabase já nasce preso ao grupo.
// O cliente recebido deve apontar para o schema "grupos" (db: { schema: 'grupos' }).
import { criarRepoSupabase } from './repo-supabase.js';
import { clienteDoGrupo } from './cliente-do-grupo.js';

export function criarRepoMultigrupo(cliente, grupoId, opcoes) {
  return criarRepoSupabase(clienteDoGrupo(cliente, grupoId), opcoes);
}
