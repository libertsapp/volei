// Configurações do app. Port de saveSettingsAction/writeSettings de apps-script-codigo.gs: as 7 chaves, com a mesma
// formatação (TRUE/FALSE, valores padrão). O contador de acessos nunca é tocado por uma gravação de configuração
// (o navegador do admin pode ter um valor desatualizado): desde a etapa 5 ele pertence só à função incrementar_acesso do banco,
// e reler-e-regravar o contador aqui, sob a trava, disputaria com a soma atômica que não usa trava.
import { texto, CHECKIN_MENSAGEM_PADRAO } from './mapeadores.js';

export async function saveSettings({ repo }, settings) {
  const s = settings || {};
  await repo.gravarConfig([
    { chave: 'estrelasVisiveis', valor: s.estrelasVisiveis ? 'TRUE' : 'FALSE' },
    { chave: 'checkinDataAberta', valor: texto(s.checkinDataAberta) },
    { chave: 'checkinTravado', valor: s.checkinTravado ? 'TRUE' : 'FALSE' },
    { chave: 'checkinVagas', valor: String(s.checkinVagas || 16) },
    { chave: 'checkinHorario', valor: String(s.checkinHorario || '20:00') },
    { chave: 'checkinMensagemTemplate', valor: String(s.checkinMensagemTemplate || CHECKIN_MENSAGEM_PADRAO) }
  ]);
  return { status: 'ok' };
}
