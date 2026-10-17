// Cadastro dos grupos independentes no Supabase (schema "grupos"): o que existe ANTES ou ACIMA de um grupo — achar o
// grupo pelo apelido, os limites do plano grátis, "esse endereço está livre?", criar o grupo e o limite por IP de quem
// ainda não tem grupo. O cliente recebido deve apontar para o schema "grupos" e NÃO ter escopo de grupo.
const DICA = ' (rode sql/grupos/schema-grupos.sql no SQL Editor do Supabase e exponha o schema "grupos")';
const CODIGOS = ['apelido_invalido', 'apelido_reservado', 'apelido_em_uso', 'limite_por_email'];

export const LIMITES_PADRAO = { max_grupos_por_email: 1, max_jogadores_por_grupo: 150, max_foto_kb: 300, max_criacoes_por_ip_hora: 3 };

export class ErroCadastro extends Error {
  constructor(codigo) { super(codigo); this.codigo = codigo; }
}

// o criar_grupo lança exceção com a mensagem-código; dois criando o mesmo apelido ao mesmo tempo caem no unique (23505)
export function codigoDoErro(error) {
  const msg = String((error && error.message) || '');
  const achado = CODIGOS.find((c) => msg.includes(c));
  if (achado) return achado;
  if (error && error.code === '23505') return 'apelido_em_uso';
  return null;
}

export function criarCadastroSupabase(cliente) {
  const falha = (onde, error) => new Error(onde + ': ' + error.message + DICA);
  return {
    async lerGrupoPorApelido(apelido) {
      const { data, error } = await cliente.from('grupos').select('*').eq('apelido', apelido).maybeSingle();
      if (error) throw falha('grupos', error);
      return data && !Array.isArray(data) ? data : null;
    },
    // lembrete do dia (v19.2): o agendador passa por todos os grupos ativos
    async listarGruposAtivos() {
      const { data, error } = await cliente.from('grupos').select('*').eq('status', 'ativo');
      if (error) throw falha('grupos', error);
      return data || [];
    },
    async lerLimites() {
      const { data, error } = await cliente.from('limites').select('*').limit(1).maybeSingle();
      if (error) throw falha('limites', error);
      return data && !Array.isArray(data) ? { ...LIMITES_PADRAO, ...data } : { ...LIMITES_PADRAO };
    },
    async apelidoDisponivel(apelido) {
      const { data, error } = await cliente.rpc('apelido_disponivel', { p_apelido: apelido });
      if (error) throw falha('apelido_disponivel', error);
      return data === true;
    },
    async registrarTentativaGlobal(chave, max, janelaSeg, bloqueioSeg) {
      const { data, error } = await cliente.rpc('registrar_tentativa_global', { p_chave: chave, p_max: max, p_janela_seg: janelaSeg, p_bloqueio_seg: bloqueioSeg });
      if (error) throw falha('registrar_tentativa_global', error);
      return data === true;
    },
    async criarGrupo({ apelido, nome, cidade, uf, cor, email, nomeDono }) {
      const { data, error } = await cliente.rpc('criar_grupo', {
        p_apelido: apelido, p_nome: nome, p_cidade: cidade, p_uf: uf, p_cor: cor, p_dono_email: email, p_dono_nome: nomeDono
      });
      if (error) {
        const codigo = codigoDoErro(error);
        if (codigo) throw new ErroCadastro(codigo);
        throw falha('criar_grupo', error);
      }
      return data;
    }
  };
}
