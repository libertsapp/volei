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

// ---------------------------------------------------------------- escrita: helpers comuns
export const MSG_SEM_LIGA = 'Amistosos não estão disponíveis neste servidor.';
export const MSG_MUDOU = 'Esse amistoso mudou enquanto você olhava. Recarregue a página e tente de novo.';
const gerarId = (deps) => (deps.gerarId ? deps.gerarId() : globalThis.crypto.randomUUID());
const nomeDe = (auth) => (auth && (auth.nome || auth.email)) || 'Desconhecido';
const recado = (v) => texto(v).trim().slice(0, MAX_RECADO);
// "hoje" no Brasil (-03:00): sem isso, às 22h de Brasília o servidor (UTC) já acharia que é amanhã
const hojeBrasil = (agora) => new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
const dataCurta = (iso) => { const [, m, d] = texto(iso).split('-'); return d + '/' + m; };

// toda escrita devolve o bloco atualizado: o app troca o estado local por ele (igual ao financeiro)
export async function respostaOk(deps) { return { status: 'ok', liga: await lerBlocoLiga(deps) }; }

// Lê o amistoso para uma ação. Amistoso de outros grupos "não existe" para este servidor. Se o placar já venceu os 7 dias,
// esta é "a primeira escrita que toca nele": grava o encerramento antes de seguir.
export async function carregar(deps, id) {
  const { repo, grupoId } = deps.liga;
  const r = await repo.lerAmistoso(texto(id));
  if (!r || !participa(r.amistoso, grupoId)) return { erro: 'Amistoso não encontrado.' };
  const a = r.amistoso;
  if (a.status === 'aguardando_confirmacao' && statusEfetivo(a, agoraDe(deps)) === 'encerrado') {
    if (await repo.atualizarAmistosoSe(a.id, 'aguardando_confirmacao', { status: 'encerrado', atualizado_em: agoraDe(deps).toISOString() })) a.status = 'encerrado';
  }
  return { ...r, amistoso: a };
}

// muda o amistoso SÓ se o status ainda é o que esta ação leu (concorrência otimista); false = alguém agiu antes
export async function transicionar(deps, a, campos) {
  return deps.liga.repo.atualizarAmistosoSe(a.id, a.status, { ...campos, atualizado_em: agoraDe(deps).toISOString() });
}

export async function registrarMensagem(deps, a, tipo, textoLivre, auth) {
  await deps.liga.repo.inserirMensagem({
    id: gerarId(deps), amistoso_id: a.id, grupo: deps.liga.grupoId, autor_nome: nomeDe(auth), tipo,
    texto: recado(textoLivre), criado_em: agoraDe(deps).toISOString()
  });
}

function validarCampos(c, agora) {
  if (!c || !dataValida(c.data)) return { erro: 'Data inválida.' };
  if (!horarioValido(c.horario)) return { erro: 'Horário inválido.' };
  const bruto = c.vagasPorGrupo;
  const vagas = bruto === undefined || bruto === null || bruto === '' ? 6 : Number(bruto);
  if (!Number.isInteger(vagas) || vagas < 1 || vagas > 30) return { erro: 'Vagas por grupo precisam ser entre 1 e 30.' };
  if (texto(c.data) < hojeBrasil(agora)) return { erro: 'A data do amistoso já passou.' };
  return { campos: { data: texto(c.data), horario: texto(c.horario), local: texto(c.local).trim().slice(0, MAX_LOCAL), vagas_por_grupo: vagas } };
}

// push é bônus: só vai para os inscritos DESTE grupo (cada servidor só lê as próprias inscrições) e nunca desfaz o aceite
async function avisarMarcado(deps, a, auth) {
  try {
    const grupos = await deps.liga.repo.lerGrupos();
    const adv = grupos.find((g) => g.id === outroGrupo(a, deps.liga.grupoId));
    await enviarNotificacao(deps, {
      titulo: '🏐 Amistoso marcado!',
      corpo: 'Contra ' + (adv ? adv.nome : 'outro grupo') + ' em ' + dataCurta(a.data) + ' às ' + a.horario + '. Marque "Vou jogar" no app.'
    }, auth);
  } catch (erro) {
    try { (deps.avisar || (() => {}))('push do amistoso falhou: ' + (erro && erro.message)); } catch { /* nada */ }
  }
}

// ---------------------------------------------------------------- convite
export async function convidarGrupo(deps, convite, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const { repo, grupoId } = deps.liga;
  const destino = texto(convite && convite.grupo);
  if (!destino || destino === grupoId) return { error: 'Escolha outro grupo para convidar.' };
  const grupos = await repo.lerGrupos();
  if (!grupos.some((g) => g.id === destino && g.ativo !== false)) return { error: 'Grupo não encontrado.' };
  const v = validarCampos(convite, agoraDe(deps));
  if (v.erro) return { error: v.erro };
  const agora = agoraDe(deps).toISOString();
  const a = {
    id: gerarId(deps), grupo_convidante: grupoId, grupo_convidado: destino, ...v.campos,
    status: 'pendente', vez_de: destino, criado_por: texto(auth && auth.email), criado_em: agora, atualizado_em: agora
  };
  await repo.inserirAmistoso(a);
  await registrarMensagem(deps, a, 'convite', convite.recado, auth);
  return respostaOk(deps);
}

export async function responderConvite(deps, b, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const { grupoId } = deps.liga;
  const r = await carregar(deps, b && b.id);
  if (r.erro) return { error: r.erro };
  const a = r.amistoso;
  if (a.status !== 'pendente') return { error: 'Esse convite não está mais esperando resposta.' };
  if (a.vez_de !== grupoId) return { error: 'Agora a vez de responder é do outro grupo.' };
  const resposta = texto(b.resposta);
  if (resposta === 'aceitar') {
    if (!(await transicionar(deps, a, { status: 'marcado', vez_de: null }))) return { error: MSG_MUDOU };
    await registrarMensagem(deps, a, 'aceite', b.recado, auth);
    await avisarMarcado(deps, a, auth);
    return respostaOk(deps);
  }
  if (resposta === 'recusar') {
    if (!(await transicionar(deps, a, { status: 'recusado', vez_de: null }))) return { error: MSG_MUDOU };
    await registrarMensagem(deps, a, 'recusa', b.recado, auth);
    return respostaOk(deps);
  }
  if (resposta === 'contrapropor') {
    const v = validarCampos(b, agoraDe(deps));
    if (v.erro) return { error: v.erro };
    if (!(await transicionar(deps, a, { ...v.campos, vez_de: outroGrupo(a, grupoId) }))) return { error: MSG_MUDOU };
    // o histórico guarda a proposta por escrito: quem lê depois entende o vai e volta sem comparar campos
    const c = v.campos;
    const resumo = dataCurta(c.data) + ' às ' + c.horario + (c.local ? ' em ' + c.local : '');
    await registrarMensagem(deps, a, 'contraproposta', [resumo, recado(b.recado)].filter(Boolean).join(' — '), auth);
    return respostaOk(deps);
  }
  return { error: 'Resposta inválida.' };
}

export async function cancelarAmistoso(deps, b, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return { error: r.erro };
  const a = r.amistoso;
  if (a.status !== 'pendente' && a.status !== 'marcado') return { error: 'Esse amistoso não pode mais ser cancelado.' };
  const motivo = recado(b.motivo);
  if (a.status === 'marcado' && !motivo) return { error: 'Conte o motivo do cancelamento (o outro grupo vai ver).' };
  if (!(await transicionar(deps, a, { status: 'cancelado', vez_de: null, motivo_cancelamento: motivo || null }))) return { error: MSG_MUDOU };
  await registrarMensagem(deps, a, 'cancelamento', motivo, auth);
  return respostaOk(deps);
}

export async function recadoAmistoso(deps, b, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return { error: r.erro };
  if (!recado(b.texto)) return { error: 'Escreva o recado.' };
  await registrarMensagem(deps, r.amistoso, 'recado', b.texto, auth);
  return respostaOk(deps);
}

// ---------------------------------------------------------------- convocação
// lista aberta de interessados ("Vou jogar") + o organizador confirma quem joga. Separada da rodada: não toca em checkins.
async function carregarParaEscalacao(deps, b) {
  if (semLiga(deps)) return { erro: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return r;
  if (r.amistoso.status !== 'marcado') return { erro: 'A lista só abre depois que o amistoso é marcado.' };
  const travada = r.travas.some((x) => x.grupo === deps.liga.grupoId);
  return { ...r, travada };
}

export async function entrarAmistoso(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  if (r.travada) return { error: 'A lista do seu grupo está travada.' };
  // só jogador de verdade do PRÓPRIO grupo (nem convidado, nem removido): o id vem do navegador e não é confiável
  const jogador = mapearJogadores(await deps.repo.lerJogadores()).find((p) => p.id === texto(b.jogadorId));
  if (!jogador) return { error: 'Jogador não encontrado no seu grupo.' };
  const entrou = await deps.liga.repo.inserirEscalacao({
    id: gerarId(deps), amistoso_id: r.amistoso.id, grupo: deps.liga.grupoId, jogador_id: jogador.id,
    nome: jogador.apelido || jogador.nome, foto_url: jogador.foto || null, status: 'interessado', criado_em: agoraDe(deps).toISOString()
  });
  if (!entrou) return { error: 'Essa pessoa já está na lista.' };
  return respostaOk(deps);
}

export async function sairAmistoso(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  if (r.travada) return { error: 'A lista do seu grupo está travada.' };
  if (!(await deps.liga.repo.removerEscalacao(r.amistoso.id, deps.liga.grupoId, texto(b.jogadorId)))) return { error: 'Essa pessoa não está na lista.' };
  return respostaOk(deps);
}

// a trava não impede o organizador de confirmar: travar é justamente o momento de fechar a escalação
export async function confirmarEscalado(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  const { grupoId } = deps.liga;
  const meus = r.escalacoes.filter((e) => e.grupo === grupoId);
  const alvo = meus.find((e) => e.jogador_id === texto(b.jogadorId));
  if (!alvo) return { error: 'Essa pessoa não está na lista.' };
  if (alvo.status === 'confirmado') return respostaOk(deps); // confirmar duas vezes não é erro
  const vagas = Number(r.amistoso.vagas_por_grupo) || 0;
  const confirmados = meus.filter((e) => e.status === 'confirmado').length;
  if (confirmados >= vagas) return { error: 'Já tem ' + confirmados + ' confirmados (limite ' + vagas + ').' };
  await deps.liga.repo.atualizarEscalacao(r.amistoso.id, grupoId, alvo.jogador_id, { status: 'confirmado' });
  return respostaOk(deps);
}

export async function desconfirmarEscalado(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  if (!(await deps.liga.repo.atualizarEscalacao(r.amistoso.id, deps.liga.grupoId, texto(b.jogadorId), { status: 'interessado' }))) {
    return { error: 'Essa pessoa não está na lista.' };
  }
  return respostaOk(deps);
}

export async function travarEscalacao(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  await deps.liga.repo.definirTrava(r.amistoso.id, deps.liga.grupoId, true);
  return respostaOk(deps);
}

export async function destravarEscalacao(deps, b) {
  const r = await carregarParaEscalacao(deps, b);
  if (r.erro) return { error: r.erro };
  await deps.liga.repo.definirTrava(r.amistoso.id, deps.liga.grupoId, false);
  return respostaOk(deps);
}

// ---------------------------------------------------------------- placar
const setsValidos = (n) => Number.isInteger(n) && n >= 0 && n <= 9;
// parciais opcionais: até 9 sets, cada um [pontos do convidante, pontos do convidado]
function validarParciais(p) {
  if (p === undefined || p === null || (Array.isArray(p) && p.length === 0)) return { parciais: null };
  if (!Array.isArray(p) || p.length > 9) return { erro: true };
  for (const s of p) {
    if (!Array.isArray(s) || s.length !== 2 || !s.every((x) => Number.isInteger(x) && x >= 0 && x <= 99)) return { erro: true };
  }
  return { parciais: p };
}

export async function lancarPlacar(deps, b, auth) {
  if (semLiga(deps)) return { error: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return { error: r.erro };
  const a = r.amistoso;
  if (a.status !== 'marcado') return { error: 'Só dá pra lançar o placar de um amistoso marcado.' };
  if (agoraDe(deps).getTime() < inicioDoJogo(a).getTime()) return { error: 'O placar só pode ser lançado depois do horário do jogo.' };
  const sc = b.setsConvidante, sd = b.setsConvidado;
  if (!setsValidos(sc) || !setsValidos(sd) || sc + sd === 0) return { error: 'Placar inválido.' };
  const p = validarParciais(b.parciais);
  if (p.erro) return { error: 'Parciais inválidas.' };
  const ok = await transicionar(deps, a, {
    status: 'aguardando_confirmacao', sets_convidante: sc, sets_convidado: sd, parciais: p.parciais,
    placar_lancado_por_grupo: deps.liga.grupoId, placar_lancado_em: agoraDe(deps).toISOString()
  });
  if (!ok) return { error: MSG_MUDOU };
  await registrarMensagem(deps, a, 'placar', ['Placar: ' + sc + ' × ' + sd, recado(b.recado)].filter(Boolean).join(' — '), auth);
  return respostaOk(deps);
}

// confirmar e contestar: só o grupo que NÃO lançou. Se os 7 dias já passaram, carregar() já gravou o encerramento.
async function carregarParaConferir(deps, b) {
  if (semLiga(deps)) return { erro: MSG_SEM_LIGA };
  const r = await carregar(deps, b && b.id);
  if (r.erro) return r;
  const a = r.amistoso;
  if (a.status === 'encerrado') return { erro: 'Esse placar já foi confirmado.' };
  if (a.status !== 'aguardando_confirmacao') return { erro: 'Esse amistoso não tem placar esperando confirmação.' };
  if (a.placar_lancado_por_grupo === deps.liga.grupoId) return { erro: 'Quem confirma o placar é o outro grupo.' };
  return r;
}

export async function confirmarPlacar(deps, b, auth) {
  const r = await carregarParaConferir(deps, b);
  if (r.erro) return { error: r.erro };
  if (!(await transicionar(deps, r.amistoso, { status: 'encerrado' }))) return { error: MSG_MUDOU };
  await registrarMensagem(deps, r.amistoso, 'confirmacao', '', auth);
  return respostaOk(deps);
}

export async function contestarPlacar(deps, b, auth) {
  const r = await carregarParaConferir(deps, b);
  if (r.erro) return { error: r.erro };
  if (!recado(b.texto)) return { error: 'Explique o que está errado no placar.' };
  const ok = await transicionar(deps, r.amistoso, {
    status: 'marcado', sets_convidante: null, sets_convidado: null, parciais: null, placar_lancado_por_grupo: null, placar_lancado_em: null
  });
  if (!ok) return { error: MSG_MUDOU };
  await registrarMensagem(deps, r.amistoso, 'contestacao', b.texto, auth);
  return respostaOk(deps);
}
