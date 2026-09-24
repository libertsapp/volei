// Check-in. Port de addCheckin, removeCheckin e salvarEstrelasAjustadas_ de apps-script-codigo.gs (mesmas mensagens).
// Como no .gs: não há limite de vagas nem checagem de repetição por jogador/dia (a fila de espera é por ordem, no app).
// Os ganchos do financeiro (finAposAdicionarCheckin_ / finAposRemoverCheckin_) rodam depois de gravar, como no .gs; nunca quebram o check-in.
import { texto } from './mapeadores.js';
import { aposAdicionarCheckin, aposRemoverCheckin } from './financeiro.js';

// "nota só para este check-in": vazio (ou 0, como no .gs) vira null; o resto precisa ser número (a coluna é numeric)
function notaAjustada(v) {
  const s = String(v || '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export async function addCheckin(deps, c) {
  const { repo } = deps;
  if (!c || !texto(c.id)) return { error: 'Check-in sem id.' };
  if ((await repo.lerTudo()).checkins.some((x) => x.id === texto(c.id))) return { error: 'Já existe um check-in com esse id.' };
  const nota = notaAjustada(c.estrelasAjustadas);
  if (nota === undefined) return { error: 'Estrelas ajustadas inválidas.' };
  // O app faz check-in de CONVIDADO com um jogadorId gerado no navegador que não existe em jogadores (o .gs grava
  // qualquer texto). Aqui o convidado nasce junto, como em gravar_rodada: convidado = true e sem ordem (explícito
  // null, para o banco não aplicar a sequência) e, por isso, fora de players. Se o insert do check-in falhar depois
  // disso, a linha do convidado fica (inofensiva: convidados não aparecem em players).
  const jogadorId = texto(c.jogadorId);
  if (jogadorId && !(await repo.lerJogadores()).some((j) => j.id === jogadorId)) {
    await repo.inserirJogador({
      id: jogadorId, nome: texto(c.jogadorNome), apelido: null, foto: null, estrelas: Number(c.estrelas) || null,
      sexo: texto(c.sexo) || null, porte: null, convidado: true, removido: false, ordem: null
    });
  }
  // sem "ordem" no check-in: o banco põe a linha no fim
  await repo.inserirCheckin({
    id: texto(c.id), data: c.data, jogador_id: jogadorId || null, jogador_nome: texto(c.jogadorNome) || null,
    estrelas: Number(c.estrelas) || 0, sexo: texto(c.sexo) || null, estrelas_ajustadas: nota
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
