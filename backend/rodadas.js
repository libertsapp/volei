// Rodadas. Port de addRound, updateRound e removeRound de apps-script-codigo.gs.
// Salvar é UMA operação do repositório (no banco, uma função que roda numa transação só): cria a rodada, os times
// e os jogadores de cada time, e cria os convidados novos. Editar apaga a versão antiga e grava a nova, então a rodada
// editada vai para o FIM da lista (como no .gs, que apaga as linhas e insere de novo no fim).
import { texto } from './mapeadores.js';
import { coletarConvidados } from './convidados.js';
import { abrirVotacaoSeFaltar } from './votacao.js';

const NAO_ACHOU = 'Rodada não encontrada (pode já ter sido removida por outra pessoa).';

const horarioValido = (h) => (/^[0-2]\d:[0-5]\d$/.test(texto(h).trim()) ? texto(h).trim() : '');

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
    horario: horarioValido(r.horario), // 'HH:MM' do jogo (vem do check-in); '' = não informado (rodadas antigas)
    rascunho: !!r.rascunho,
    times,
    convidados: coletarConvidados(times.flatMap((t) => t.playerIds))
  };
}

// no .gs uma rodada sem times não deixa nenhuma linha na aba. Rodada OFICIAL (não rascunho) salva abre a votação do
// Craque/Bola Murcha do dia (v19.1), se ainda não existe — salvar de novo ou o 2º jogo do dia não reabre nem reavisa
export async function addRound(deps, r) {
  const rodada = montar(r || {});
  if (rodada.times.length) await deps.repo.gravarRodada(rodada);
  if (rodada.times.length && !rodada.rascunho) await abrirVotacaoSeFaltar(deps, rodada.data);
  return { status: 'ok' };
}

export async function updateRound(deps, r) {
  const rodada = montar(r || {});
  if (rodada.times.length) await deps.repo.gravarRodada(rodada);
  else await deps.repo.removerRodada(rodada.id);
  if (rodada.times.length && !rodada.rascunho) await abrirVotacaoSeFaltar(deps, rodada.data);
  return { status: 'ok' };
}

export async function removeRound({ repo }, id) {
  return (await repo.removerRodada(texto(id))) ? { status: 'ok' } : { error: NAO_ACHOU };
}
