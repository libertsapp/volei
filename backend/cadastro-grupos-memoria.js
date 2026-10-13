// Cadastro dos grupos em memória (testes): mesma interface do cadastro-grupos.js e as MESMAS regras do criar_grupo do
// SQL. Guarda um repositório em memória por grupo (repoDoGrupo), já com o dono como admin — é o papel que, no
// Supabase, as tabelas do schema "grupos" com grupo_id fazem.
import { criarRepoMemoria } from './repo-memoria.js';
import { APELIDOS_RESERVADOS } from './grupos-cadastro.js';
import { ErroCadastro, LIMITES_PADRAO } from './cadastro-grupos.js';

const FORMATO = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export function criarCadastroMemoria({ grupos = [], limites = {}, repoLiga, agoraMs = () => Date.now() } = {}) {
  const lista = grupos.map((g) => ({ status: 'ativo', plano: 'gratis', ...g }));
  const lim = { ...LIMITES_PADRAO, ...limites };
  const repos = new Map(lista.map((g) => [g.id, criarRepoMemoria({})]));
  const baldes = new Map(); // chave -> { tentativas, bloqueadoAte, atualizado }
  let seq = 0;
  const naLiga = (a) => !!repoLiga && repoLiga.tabelas.grupos.some((l) => l.id === a);

  return {
    grupos: lista,
    limites: lim,
    repoDoGrupo(grupoId) {
      if (!repos.has(grupoId)) throw new Error('grupo inexistente em memória: ' + grupoId);
      return repos.get(grupoId);
    },
    async lerGrupoPorApelido(apelido) { const g = lista.find((x) => x.apelido === apelido); return g ? { ...g } : null; },
    async lerLimites() { return { ...lim }; },
    async apelidoDisponivel(apelido) {
      const a = String(apelido || '').trim().toLowerCase();
      return !lista.some((g) => g.apelido === a) && !naLiga(a) && !APELIDOS_RESERVADOS.includes(a);
    },
    // mesma regra do registrar_tentativa_global: conta dentro da janela; estourou, bloqueia pelo tempo do bloqueio
    async registrarTentativaGlobal(chave, max, janelaSeg, bloqueioSeg) {
      const agora = agoraMs();
      const b = baldes.get(chave);
      if (b && b.bloqueadoAte && b.bloqueadoAte > agora) return false;
      const zerar = !b || b.atualizado < agora - janelaSeg * 1000 || (b.bloqueadoAte && b.bloqueadoAte <= agora);
      const n = zerar ? 1 : b.tentativas + 1;
      const bloqueadoAte = n > max ? agora + bloqueioSeg * 1000 : null;
      baldes.set(chave, { tentativas: n, bloqueadoAte, atualizado: agora });
      return bloqueadoAte === null;
    },
    async criarGrupo({ apelido, nome, cidade, uf, cor, email, nomeDono }) {
      const a = String(apelido || '').trim().toLowerCase();
      const e = String(email || '').trim().toLowerCase();
      if (!FORMATO.test(a) || a.includes('--')) throw new ErroCadastro('apelido_invalido');
      if (APELIDOS_RESERVADOS.includes(a)) throw new ErroCadastro('apelido_reservado');
      if (lista.some((g) => g.apelido === a) || naLiga(a)) throw new ErroCadastro('apelido_em_uso');
      if (lista.filter((g) => g.dono_email === e).length >= lim.max_grupos_por_email) throw new ErroCadastro('limite_por_email');
      const id = 'grupo-' + (++seq);
      lista.push({ id, apelido: a, nome, cidade, uf, cor_destaque: String(cor).toLowerCase(), logo_url: null, plano: 'gratis', status: 'ativo', dono_email: e });
      repos.set(id, criarRepoMemoria({ usuarios: [{ email: e, nome: nomeDono || '', perfil: 'admin', jogador_id: null, jogador_id_pendente: null, criado_em: new Date(agoraMs()).toISOString(), ordem: 1 }] }));
      if (repoLiga) repoLiga.tabelas.grupos.push({ id: a, nome, cor: String(cor).toLowerCase(), cidade, uf, ativo: true });
      return id;
    }
  };
}
