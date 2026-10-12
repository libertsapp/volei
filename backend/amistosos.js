// Amistosos entre grupos (spec docs/superpowers/specs/2026-10-12-amistosos-entre-grupos-design.md).
// Tudo que é "entre grupos" vive no schema compartilhado "liga" (deps.liga.repo); o grupo DESTE servidor é
// deps.liga.grupoId. Regra de ouro: cada servidor só altera o LADO do próprio grupo — amistoso em que ele não participa
// "não existe" pra ele, escalação só a do próprio grupo, responder só quando a vez é dele.
import { texto, mapearJogadores } from './mapeadores.js';
import { dataValida, horarioValido } from './jogos2.js';
import { enviarNotificacao } from './notificacoes.js';

export const DIAS_CONFIRMACAO_AUTOMATICA = 7;
const MAX_RECADO = 500;
const MAX_LOCAL = 200;
const MAX_FECHADOS = 50;
const ATIVOS = ['pendente', 'marcado', 'aguardando_confirmacao'];

const agoraDe = (deps) => (deps.relogio ? deps.relogio() : new Date());
const iso = (v) => (v ? new Date(v).toISOString() : '');
const participa = (a, g) => a.grupo_convidante === g || a.grupo_convidado === g;
const outroGrupo = (a, g) => (a.grupo_convidante === g ? a.grupo_convidado : a.grupo_convidante);
const porCriacao = (x, y) => (texto(x.criado_em) < texto(y.criado_em) ? -1 : texto(x.criado_em) > texto(y.criado_em) ? 1 : 0);

// início do jogo no horário de Brasília (os grupos são do Brasil; -03:00 fixo, sem horário de verão desde 2019)
export function inicioDoJogo(a) {
  return new Date(texto(a.data) + 'T' + (texto(a.horario) || '00:00') + ':00-03:00');
}

// placar parado há 7+ dias conta como confirmado — calculado na leitura, sem agendamento nenhum
export function statusEfetivo(a, agora) {
  if (a.status !== 'aguardando_confirmacao' || !a.placar_lancado_em) return a.status;
  const limite = new Date(a.placar_lancado_em).getTime() + DIAS_CONFIRMACAO_AUTOMATICA * 86400000;
  return agora.getTime() >= limite ? 'encerrado' : a.status;
}

export const ligaVazia = (grupoId) => ({ disponivel: false, grupoId: grupoId || '', grupos: [], amistosos: [] });

const pessoa = (e) => ({ jogadorId: texto(e.jogador_id), nome: texto(e.nome), foto: texto(e.foto_url) });

export function mapearLiga(bruto, grupoId, agora) {
  const grupos = (bruto.grupos || []).filter((g) => g.ativo !== false)
    .map((g) => ({ id: texto(g.id), nome: texto(g.nome), logoUrl: texto(g.logo_url), cor: texto(g.cor) }));
  const todos = (bruto.amistosos || []).filter((a) => participa(a, grupoId)).map((a) => ({ a, status: statusEfetivo(a, agora) }));
  const ativos = todos.filter((x) => ATIVOS.includes(x.status));
  // histórico: os 50 mais recentes por data do jogo (o resto continua no banco, só não vai pro app)
  const fechados = todos.filter((x) => !ATIVOS.includes(x.status))
    .sort((p, q) => (texto(p.a.data) < texto(q.a.data) ? 1 : texto(p.a.data) > texto(q.a.data) ? -1 : 0))
    .slice(0, MAX_FECHADOS);
  const amistosos = [...ativos, ...fechados].map(({ a, status }) => {
    const esc = (bruto.escalacoes || []).filter((e) => e.amistoso_id === a.id).sort(porCriacao);
    const meus = esc.filter((e) => e.grupo === grupoId);
    const deles = esc.filter((e) => e.grupo !== grupoId);
    return {
      id: texto(a.id), convidante: texto(a.grupo_convidante), convidado: texto(a.grupo_convidado), adversario: outroGrupo(a, grupoId),
      data: texto(a.data), horario: texto(a.horario), local: texto(a.local), vagasPorGrupo: Number(a.vagas_por_grupo) || 0,
      status, vezDe: texto(a.vez_de),
      setsConvidante: a.sets_convidante ?? null, setsConvidado: a.sets_convidado ?? null, parciais: a.parciais || [],
      placarLancadoPorGrupo: texto(a.placar_lancado_por_grupo), placarLancadoEm: iso(a.placar_lancado_em),
      motivoCancelamento: texto(a.motivo_cancelamento), criadoEm: iso(a.criado_em), atualizadoEm: iso(a.atualizado_em),
      mensagens: (bruto.mensagens || []).filter((m) => m.amistoso_id === a.id).sort(porCriacao)
        .map((m) => ({ grupo: texto(m.grupo), autorNome: texto(m.autor_nome), tipo: texto(m.tipo), texto: texto(m.texto), criadoEm: iso(m.criado_em) })),
      minhaEscalacao: {
        travada: (bruto.travas || []).some((x) => x.amistoso_id === a.id && x.grupo === grupoId),
        jogadores: meus.map((e) => ({ ...pessoa(e), status: texto(e.status), criadoEm: iso(e.criado_em) }))
      },
      // os interessados do outro grupo são assunto interno dele: aqui só a contagem
      escalacaoAdversario: {
        confirmados: deles.filter((e) => e.status === 'confirmado').map(pessoa),
        interessados: deles.filter((e) => e.status !== 'confirmado').length
      }
    };
  });
  return { disponivel: true, grupoId, grupos, amistosos };
}

const semLiga = (deps) => !deps.liga || !deps.liga.repo || !deps.liga.grupoId;

// nunca lança: se o schema "liga" ainda não existe (função publicada antes do SQL), o resto do app segue normal
export async function lerBlocoLiga(deps) {
  if (semLiga(deps)) return ligaVazia(deps.liga && deps.liga.grupoId);
  const { repo, grupoId } = deps.liga;
  try {
    const [grupos, resto] = await Promise.all([repo.lerGrupos(), repo.lerAmistososDoGrupo(grupoId)]);
    return mapearLiga({ grupos, ...resto }, grupoId, agoraDe(deps));
  } catch (erro) {
    try { (deps.avisar || (() => {}))('liga indisponível: ' + (erro && erro.message ? erro.message : erro)); } catch { /* nada */ }
    return ligaVazia(grupoId);
  }
}
