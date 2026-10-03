// Check-in. Port de addCheckin, removeCheckin e salvarEstrelasAjustadas_ de apps-script-codigo.gs (mesmas mensagens).
// Como no .gs: não há limite de vagas. Checagem de repetição por jogador/dia agora existe, mas só DENTRO do mesmo
// jogo (dois jogos no mesmo dia: a mesma pessoa pode estar nos dois — moverCheckin, também aqui, troca ela de um
// jogo pro outro). Os ganchos do financeiro (finAposAdicionarCheckin_ / finAposRemoverCheckin_) rodam depois de
// gravar, como no .gs; nunca quebram o check-in.
import { texto } from './mapeadores.js';
import { aposAdicionarCheckin, aposRemoverCheckin } from './financeiro.js';
import { mapearConfig } from './mapeadores.js';

// nome de check-in maior que isto não é nome: corta (o app usa nomes curtos) para um login qualquer do Google não encher o banco
const MAX_NOME = 120;

// "nota só para este check-in": vazio (ou 0, como no .gs) vira null; o resto precisa ser número (a coluna é numeric)
function notaAjustada(v) {
  const s = String(v || '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// jogos que existem na data (1 sempre; 2 só se checkinJogo2 bate com a data) — mesma regra do front
function jogoExiste(cfg, data, jogo) {
  if (jogo === 1) return true;
  if (jogo === 2) return !!(cfg.checkinJogo2 && texto(cfg.checkinJogo2.data) === data);
  return false;
}

export async function addCheckin(deps, c) {
  const { repo } = deps;
  if (!c || !texto(c.id)) return { error: 'Check-in sem id.' };
  const tudo = await repo.lerTudo();
  if (tudo.checkins.some((x) => x.id === texto(c.id))) return { error: 'Já existe um check-in com esse id.' };
  const nota = notaAjustada(c.estrelasAjustadas);
  if (nota === undefined) return { error: 'Estrelas ajustadas inválidas.' };
  const jogo = c.jogo === undefined || c.jogo === null ? 1 : Number(c.jogo);
  if (jogo !== 1 && jogo !== 2) return { error: 'Jogo inválido.' };
  const cfg = mapearConfig(tudo.config);
  if (!jogoExiste(cfg, texto(c.data), jogo)) return { error: 'Esse jogo não existe mais. Recarregue a página.' };
  const jogadorId = texto(c.jogadorId);
  if (jogadorId && tudo.checkins.some((x) => x.data === c.data && (Number(x.jogo) || 1) === jogo && x.jogador_id === jogadorId)) {
    return { error: 'Essa pessoa já está na lista desse jogo.' };
  }
  // O app faz check-in de CONVIDADO com um jogadorId gerado no navegador que não existe em jogadores (o .gs grava
  // qualquer texto). Aqui o convidado nasce junto, como em gravar_rodada: convidado = true e sem ordem (explícito
  // null, para o banco não aplicar a sequência) e, por isso, fora de players. Se o insert do check-in falhar depois
  // disso, a linha do convidado fica (inofensiva: convidados não aparecem em players).
  if (jogadorId && !tudo.jogadores.some((j) => j.id === jogadorId)) {
    await repo.inserirJogador({
      id: jogadorId, nome: texto(c.jogadorNome).slice(0, MAX_NOME), apelido: null, foto: null, estrelas: Number(c.estrelas) || null,
      sexo: texto(c.sexo) || null, porte: null, convidado: true, removido: false, ordem: null
    });
  }
  // sem "ordem" no check-in: o banco põe a linha no fim
  await repo.inserirCheckin({
    id: texto(c.id), data: c.data, jogador_id: jogadorId || null, jogador_nome: texto(c.jogadorNome).slice(0, MAX_NOME) || null,
    estrelas: Number(c.estrelas) || 0, sexo: texto(c.sexo) || null, estrelas_ajustadas: nota, jogo
  });
  await aposAdicionarCheckin(deps, c.data); // quem tem crédito de um dia sem jogo já aparece pago
  return { status: 'ok' };
}

export async function removeCheckin(deps, id) {
  const { repo } = deps;
  // data e jogador são lidos ANTES de apagar (o gancho precisa deles), como no .gs
  const alvo = (await repo.lerTudo()).checkins.find((c) => c.id === texto(id));
  if (!(await repo.removerCheckin(texto(id)))) return { error: 'Check-in não encontrado (pode já ter sido desmarcado).' };
  if (alvo) await aposRemoverCheckin(deps, texto(alvo.data), texto(alvo.jogador_id)); // devolve crédito de quem saiu e sobe a espera
  return { status: 'ok' };
}

export async function salvarEstrelasAjustadas({ repo }, lista) {
  if (!Array.isArray(lista) || lista.length === 0) return { error: 'Lista de check-ins vazia.' };
  // valida tudo antes de gravar, para uma nota inválida não deixar a lista pela metade
  const itens = [];
  for (const item of lista) {
    const id = texto(item && item.id);
    if (!id) continue;
    const nota = notaAjustada(item.estrelasAjustadas);
    if (nota === undefined) return { error: 'Estrelas ajustadas inválidas.' };
    itens.push([id, nota]);
  }
  // id que não existe mais é ignorado (não é erro), como no .gs
  for (const [id, nota] of itens) await repo.atualizarCheckin(id, { estrelas_ajustadas: nota });
  return { status: 'ok' };
}

// Botão ⇄: tira do jogo de origem e põe no fim da fila do destino. "Tudo ou nada": se a pessoa já estava no
// destino, moveu é false e NADA é logado (idempotente, como addCheckin tocado duas vezes).
export async function moverCheckin(deps, { id, paraJogo } = {}, auth) {
  const { repo } = deps;
  const alvo = (await repo.lerTudo()).checkins.find((c) => c.id === texto(id));
  if (!alvo) return { error: 'Check-in não encontrado.' };
  const destino = Number(paraJogo);
  if (destino !== 1 && destino !== 2) return { error: 'Jogo inválido.' };
  const data = texto(alvo.data), jogadorId = texto(alvo.jogador_id);
  // ordem importa: move de verdade PRIMEIRO, só então chama os ganchos — depois do UPDATE a chave de origem já
  // não tem mais a pessoa, então aposRemoverCheckin vê o estado certo (ver nota no plano sobre a 1ª tentativa, que
  // chamava o gancho antes e ficava com a leitura velha)
  const moveu = await repo.moverCheckinDeJogo(texto(id), destino);
  if (moveu) {
    await aposRemoverCheckin(deps, data, jogadorId); // chave de origem já sem a pessoa: devolve crédito/sinaliza se for o caso
    await aposAdicionarCheckin(deps, data); // crédito disponível no destino, se houver
  }
  return { status: 'ok', moveu };
}
