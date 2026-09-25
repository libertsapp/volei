// Rodadas. Port de addRound, updateRound e removeRound de apps-script-codigo.gs.
// Salvar é UMA operação do repositório (no banco, uma função que roda numa transação só): cria a rodada, os times
// e os jogadores de cada time, e cria os convidados novos. Editar apaga a versão antiga e grava a nova, então a rodada
// editada vai para o FIM da lista (como no .gs, que apaga as linhas e insere de novo no fim).
import { texto } from './mapeadores.js';
import { coletarConvidados } from './convidados.js';

const NAO_ACHOU = 'Rodada não encontrada (pode já ter sido removida por outra pessoa).';

// até 2 times podem empatar e virar campeões juntos: "vencedor" é uma marca por time
function montar(r) {
  const vencedores = Array.isArray(r.vencedores) ? r.vencedores : [];
  const times = (r.times || []).map((t, idx) => ({
    nome: texto(t.nome),
    vitorias: Number(t.vitorias) || 0,
    vencedor: vencedores.indexOf(idx) !== -1,
    playerIds: (t.playerIds || []).map(texto).filter(Boolean)
  }));
  return {
    id: texto(r.id),
    data: texto(r.data),
    rascunho: !!r.rascunho,
    times,
    convidados: coletarConvidados(times.flatMap((t) => t.playerIds))
  };
}

// no .gs uma rodada sem times não deixa nenhuma linha na aba
export async function addRound({ repo }, r) {
  const rodada = montar(r || {});
  if (rodada.times.length) await repo.gravarRodada(rodada);
  return { status: 'ok' };
}

export async function updateRound({ repo }, r) {
  const rodada = montar(r || {});
  if (rodada.times.length) await repo.gravarRodada(rodada);
  else await repo.removerRodada(rodada.id);
  return { status: 'ok' };
}

export async function removeRound({ repo }, id) {
  return (await repo.removerRodada(texto(id))) ? { status: 'ok' } : { error: NAO_ACHOU };
}
