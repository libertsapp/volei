// Configurações do app. Port de saveSettingsAction/writeSettings de apps-script-codigo.gs: as 7 chaves, com a mesma
// formatação (TRUE/FALSE, valores padrão). O contador de acessos nunca é tocado por uma gravação de configuração
// (o navegador do admin pode ter um valor desatualizado): desde a etapa 5 ele pertence só à função incrementar_acesso do banco,
// e reler-e-regravar o contador aqui, sob a trava, disputaria com a soma atômica que não usa trava.
// Dois jogos no mesmo dia (2026-10-03): esta função NUNCA toca nas chaves checkinJogo2* pra ABRIR/FECHAR o check-in
// (só salvarJogo2/removerJogo2 mexem nelas de verdade — ver backend/jogos2.js) e recusa deixar o horário do jogo 1
// igual ao do 2º jogo já configurado. A ÚNICA exceção é "Trocar a data" com o check-in JÁ aberto (spec: "é correção
// de data, leva o 2º jogo junto") — corrigida na revisão final: antes disso, trocar a data deixava o 2º jogo preso
// na data antiga, sumindo em silêncio da tela.
import { texto, CHECKIN_MENSAGEM_PADRAO, mapearConfig } from './mapeadores.js';

export async function saveSettings({ repo }, settings) {
  const s = settings || {};
  const horario = String(s.checkinHorario || '20:00');
  const dataAberta = texto(s.checkinDataAberta);
  const atual = mapearConfig(await repo.lerConfig());
  if (dataAberta && atual.checkinJogo2 && texto(atual.checkinJogo2.data) === dataAberta && atual.checkinJogo2.horario === horario) {
    return { error: 'Os dois jogos não podem ter o mesmo horário.' };
  }
  const linhas = [
    { chave: 'estrelasVisiveis', valor: s.estrelasVisiveis ? 'TRUE' : 'FALSE' },
    { chave: 'checkinDataAberta', valor: dataAberta },
    { chave: 'checkinTravado', valor: s.checkinTravado ? 'TRUE' : 'FALSE' },
    { chave: 'checkinVagas', valor: String(s.checkinVagas || 16) },
    { chave: 'checkinHorario', valor: horario },
    { chave: 'checkinMensagemTemplate', valor: String(s.checkinMensagemTemplate || CHECKIN_MENSAGEM_PADRAO) }
  ];
  // "trocar data": o check-in já estava aberto (atual.checkinDataAberta não vazio) numa data DIFERENTE da nova, e o
  // jogo 2 estava configurado pra essa data antiga — leva o jogo 2 junto pra nova data, sem mexer em mais nada dele
  if (dataAberta && atual.checkinDataAberta && atual.checkinDataAberta !== dataAberta &&
      atual.checkinJogo2 && texto(atual.checkinJogo2.data) === atual.checkinDataAberta) {
    linhas.push({ chave: 'checkinJogo2Data', valor: dataAberta });
  }
  await repo.gravarConfig(linhas);
  return { status: 'ok' };
}
