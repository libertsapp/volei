// Avisos automáticos por push (v18.7). Até aqui o push só saía quando o organizador escrevia a mensagem na mão;
// agora o próprio backend avisa em dois momentos:
//   1. "Check-in aberto!" — para todos os aparelhos, uma vez por data aberta (config "pushCheckinAvisado" guarda a
//      última data avisada: trocar outra configuração, travar/destravar ou salvar de novo não repete o aviso).
//   2. "Você entrou na lista!" — só para quem saiu da RESERVA e entrou nas vagas porque alguém desistiu, foi movido
//      de jogo ou o organizador aumentou as vagas. Antes ninguém da espera ficava sabendo.
// Os dois são bônus: NUNCA podem quebrar a ação que os disparou (check-in, configuração), então engolem qualquer erro
// e só registram em deps.avisar.
import { mapearCheckins, mapearConfig, texto } from './mapeadores.js';
import { enviarNotificacao, enviarParaJogadores } from './notificacoes.js';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const CHAVE_AVISADO = 'pushCheckinAvisado';

function avisar(deps, onde, erro) {
  try { if (typeof deps.avisar === 'function') deps.avisar(onde + ': ' + (erro && erro.message ? erro.message : erro)); } catch { /* nada */ }
}

// "2026-10-21" -> { diaSemana: 'terça', ddmm: '21/10' } (Date.UTC: o dia da semana não pode depender do fuso do servidor)
export function diaEData(data) {
  const [a, m, d] = String(data).split('-').map(Number);
  const dia = new Date(Date.UTC(a, (m || 1) - 1, d || 1)).getUTCDay();
  return { diaSemana: DIAS[dia], ddmm: String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') };
}

// quem está DENTRO das vagas de cada jogo da data (t = repo.lerTudo()): { 1: { horario, ids: Set }, 2: {...} }.
// Mesma regra do app e do financeiro: a lista na ordem de chegada, os N primeiros (N = vagas daquele jogo).
export function dentroPorJogo(t, data) {
  const cfg = mapearConfig(t.config);
  const jogos = [{ numero: 1, vagas: cfg.checkinVagas || 16, horario: cfg.checkinHorario }];
  if (cfg.checkinJogo2 && texto(cfg.checkinJogo2.data) === data) {
    jogos.push({ numero: 2, vagas: cfg.checkinJogo2.vagas || 16, horario: cfg.checkinJogo2.horario });
  }
  const doDia = mapearCheckins(t.checkins).filter((c) => c.data === data);
  const out = {};
  for (const j of jogos) {
    const ids = doDia.filter((c) => c.jogo === j.numero).slice(0, j.vagas).map((c) => c.jogadorId).filter(Boolean);
    out[j.numero] = { horario: j.horario, ids: new Set(ids) };
  }
  return out;
}

// compara o "antes" (dentroPorJogo lido ANTES da mudança) com o estado atual do banco e avisa quem entrou.
// Só vale para o dia com check-in aberto (mexer em lista de jogo que já passou não avisa ninguém) e só em jogos que
// já existiam antes (2º jogo recém-criado não é "vaga que abriu"). "ignorar": quem causou a mudança (ex.: a pessoa
// movida de jogo cai direto nas vagas do destino — ela sabe, não precisa de aviso).
export async function avisarQuemEntrouNaLista(deps, data, antes, ignorar = []) {
  try {
    const t = await deps.repo.lerTudo();
    if (!data || texto(mapearConfig(t.config).checkinDataAberta) !== data) return;
    const depois = dentroPorJogo(t, data);
    const pular = new Set(ignorar.map(String));
    const { diaSemana, ddmm } = diaEData(data);
    for (const [jogo, d] of Object.entries(depois)) {
      if (!antes || !antes[jogo]) continue;
      const novos = [...d.ids].filter((id) => !antes[jogo].ids.has(id) && !pular.has(id));
      if (novos.length === 0) continue;
      await enviarParaJogadores(deps, novos, {
        titulo: '🏐 Você entrou na lista!',
        corpo: 'Abriu vaga no vôlei de ' + diaSemana + ' (' + ddmm + ') às ' + d.horario
          + ' e seu nome saiu da reserva. Se não puder ir, tire o nome pra liberar a vaga.'
      });
    }
  } catch (e) { avisar(deps, 'avisarQuemEntrouNaLista', e); }
}

// "Check-in aberto!" para todo mundo, se o check-in está aberto, destravado e essa data ainda não foi avisada.
// A marca é gravada ANTES de enviar: dois "salvar" seguidos (ou duas abas) não mandam o aviso duas vezes — no pior
// caso (falha no envio depois da marca) o aviso daquela data se perde, o que é melhor que repetir.
export async function avisarCheckinAberto(deps) {
  try {
    const linhas = await deps.repo.lerConfig();
    const cfg = mapearConfig(linhas);
    const data = texto(cfg.checkinDataAberta);
    if (!data || cfg.checkinTravado) return;
    const avisada = linhas.find((l) => l.chave === CHAVE_AVISADO);
    if (avisada && texto(avisada.valor) === data) return;
    // data que já passou (organizador corrigindo o check-in de ontem): marca e não avisa
    const ontem = new Date(deps.relogio().getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await deps.repo.gravarConfig([{ chave: CHAVE_AVISADO, valor: data }]);
    if (data < ontem) return;
    const { diaSemana, ddmm } = diaEData(data);
    const j2 = cfg.checkinJogo2 && texto(cfg.checkinJogo2.data) === data ? cfg.checkinJogo2 : null;
    const quando = j2
      ? 'dois jogos, às ' + [cfg.checkinHorario, j2.horario].sort().join(' e ')
      : 'às ' + cfg.checkinHorario + ' — ' + cfg.checkinVagas + ' vagas';
    await enviarNotificacao(deps, {
      titulo: '🏐 Check-in aberto!',
      corpo: 'Vôlei de ' + diaSemana + ' (' + ddmm + '), ' + quando + '. Corre pra colocar o nome!'
    });
  } catch (e) { avisar(deps, 'avisarCheckinAberto', e); }
}
