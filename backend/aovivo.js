// Ao Vivo e contador de acessos. Port de iniciarTransmissaoAoVivo, salvarParcialAoVivo, cancelarTransmissaoAoVivo,
// lerAoVivo e incrementarAcesso de apps-script-codigo.gs (mesmas mensagens, mesmas respostas).
// Módulo puro: só regras de negócio, tudo o que fala com o banco entra por deps.repo.
// Como no .gs, o servidor NÃO expira a transmissão pela duração: "duracaoMinutos" é só um dado que o app usa para o
// cronômetro (segundosRestantesAoVivo, no navegador). Quem encerra é o cancelar, ou o app depois de lançar o placar final.
import { mapearRodadas, mapearAoVivo, texto } from './mapeadores.js';

const NAO_ACHOU_RODADA = 'Rodada não encontrada (pode já ter sido removida).';
const NAO_RASCUNHO = 'Essa rodada já teve o placar lançado — não é mais um rascunho.';
const JA_AO_VIVO = 'Essa rodada já está sendo transmitida ao vivo.';
const NAO_ACHOU_TRANSMISSAO = 'Essa transmissão não foi encontrada (pode já ter sido encerrada).';

// leitura pública (o app consulta em polling): só as duas tabelas do Ao Vivo, nunca o banco todo
export async function lerAoVivo({ repo }) {
  const t = await repo.lerAoVivo();
  return mapearAoVivo(t.ao_vivo, t.ao_vivo_log);
}

// espelha a rodada (rascunho) no Ao Vivo: uma linha por time, com o placar e os jogadores do momento
export async function iniciarTransmissaoAoVivo({ repo, relogio }, roundId, duracaoMinutos) {
  const t = await repo.lerTudo();
  const round = mapearRodadas(t.rodadas, t.times_rodada, t.time_jogadores).find((r) => r.id === String(roundId));
  if (!round) return { error: NAO_ACHOU_RODADA };
  if (!round.rascunho) return { error: NAO_RASCUNHO };
  if ((await repo.lerAoVivoDaRodada(String(roundId))).length > 0) return { error: JA_AO_VIVO };
  const agora = relogio().toISOString();
  // "Number(x) || 0" do .gs (sem limites: o app só oferece durações inteiras); infinito não cabe em JSON, vira 0
  const duracao = Number(duracaoMinutos) || 0;
  const linhas = [];
  round.times.forEach((time, idx) => { // forEach pula posições vazias, como no .gs
    linhas.push({
      round_id: round.id, data: round.data, time_index: idx, time_nome: time.nome, jogadores: (time.playerIds || []).join(','),
      vitorias: time.vitorias || 0, iniciado_em: agora, duracao_minutos: Number.isFinite(duracao) ? duracao : 0
    });
  });
  if (linhas.length) await repo.inserirAoVivo(linhas);
  return { status: 'ok' };
}

// grava o placar parcial: só os times cujo valor mudou (e é número) e um registro no log com a diferença
export async function salvarParcialAoVivo({ repo, relogio }, roundId, vitoriasPorTime) {
  const rid = String(roundId);
  const linhas = await repo.lerAoVivoDaRodada(rid);
  if (linhas.length === 0) return { error: NAO_ACHOU_TRANSMISSAO };
  const agora = relogio().toISOString();
  const logs = [];
  const mudancas = [];
  for (const l of linhas) {
    const timeIndex = Number(l.time_index);
    const vitoriasAtual = Number(l.vitorias) || 0;
    const vitoriasNova = Number(vitoriasPorTime[timeIndex]); // sem vitoriasPorTime: TypeError, respondido como erro (igual ao .gs)
    if (!Number.isFinite(vitoriasNova) || vitoriasNova === vitoriasAtual) continue; // nada mudou pra esse time
    logs.push({ round_id: rid, time_index: timeIndex, time_nome: texto(l.time_nome), delta: vitoriasNova - vitoriasAtual, timestamp: agora });
    mudancas.push({ id: l.id, vitorias: vitoriasNova });
  }
  if (logs.length) await repo.inserirAoVivoLog(logs); // o log primeiro: se algo falhar depois, o placar não fica mudado sem rastro
  for (const m of mudancas) await repo.atualizarVitoriasAoVivo(m.id, m.vitorias);
  return { status: 'ok' };
}

// apaga o rastro da transmissão (sem erro se não havia nenhuma, como no .gs)
export async function cancelarTransmissaoAoVivo({ repo }, roundId) {
  await repo.apagarAoVivo(String(roundId));
  return { status: 'ok' };
}

// contador de acessos: quem soma é o banco, num único comando atômico (função incrementar_acesso do ajuste 6);
// o .gs lia, somava e regravava a aba inteira sob o LockService
export async function incrementarAcesso({ repo }) {
  return { contadorAcessos: Number(await repo.incrementarAcesso()) };
}
