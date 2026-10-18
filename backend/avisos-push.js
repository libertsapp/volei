// Avisos automáticos por push (v18.7). Até aqui o push só saía quando o organizador escrevia a mensagem na mão;
// agora o próprio backend avisa em dois momentos:
//   1. "Check-in aberto!" — para todos os aparelhos, uma vez por data aberta (config "pushCheckinAvisado" guarda a
//      última data avisada: trocar outra configuração, travar/destravar ou salvar de novo não repete o aviso).
//   2. "Você entrou na lista!" — só para quem saiu da RESERVA e entrou nas vagas porque alguém desistiu, foi movido
//      de jogo ou o organizador aumentou as vagas. Antes ninguém da espera ficava sabendo.
// Os dois são bônus: NUNCA podem quebrar a ação que os disparou (check-in, configuração), então engolem qualquer erro
// e só registram em deps.avisar.
import { mapearCheckins, mapearConfig, mapearJogadores, texto } from './mapeadores.js';
import { enviarNotificacao, enviarParaJogadores, enviarParaTodosExceto } from './notificacoes.js';
import { computeSumidos } from './sumidos.js';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
// "hoje" no Brasil (-03:00): às 22h de Brasília o servidor (UTC) já está no dia seguinte
const hojeBrasil = (agora) => new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
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
    const sumidos = await convidarSumidos(deps, linhas, diaSemana, ddmm);
    const msg = { titulo: '🏐 Check-in aberto!', corpo: 'Vôlei de ' + diaSemana + ' (' + ddmm + '), ' + quando + '. Corre pra colocar o nome!' };
    if (sumidos.length) await enviarParaTodosExceto(deps, sumidos, msg);
    else await enviarNotificacao(deps, msg);
  } catch (e) { avisar(deps, 'avisarCheckinAberto', e); }
}

// 👋 "Sentimos sua falta" (v20.0): quando o check-in abre, cada sumido (mesma regra da tela 👻 Sumidos) recebe um
// convite pessoal no lugar do aviso geral. No máximo uma vez a cada SUMIDO_INTERVALO_DIAS dias por jogador (config
// "pushSumidosAvisados" = { id: 'aaaa-mm-dd' }), pra não virar cobrança toda semana. Devolve os ids avisados AGORA
// (esses ficam fora do aviso geral). Nunca quebra o aviso geral: erro aqui = ninguém fica de fora.
export const SUMIDO_INTERVALO_DIAS = 21;
async function convidarSumidos(deps, linhas, diaSemana, ddmm) {
  try {
    const t = await deps.repo.lerTudo();
    const hoje = hojeBrasil(deps.relogio());
    const linha = linhas.find((l) => l.chave === 'pushSumidosAvisados');
    let feitos = {};
    try { feitos = linha && linha.valor ? (typeof linha.valor === 'string' ? JSON.parse(linha.valor) : linha.valor) : {}; } catch { feitos = {}; }
    const limite = new Date(Date.parse(hoje + 'T12:00:00Z') - SUMIDO_INTERVALO_DIAS * 86400000).toISOString().slice(0, 10);
    const alvo = computeSumidos(t, hoje).filter((s) => !feitos[s.id] || feitos[s.id] <= limite);
    if (!alvo.length) return [];
    alvo.forEach((s) => { feitos[s.id] = hoje; });
    // guarda só quem foi avisado nos últimos 6 meses (a marca não cresce pra sempre)
    const corte = new Date(Date.parse(hoje + 'T12:00:00Z') - 180 * 86400000).toISOString().slice(0, 10);
    Object.keys(feitos).forEach((id) => { if (feitos[id] < corte) delete feitos[id]; });
    await deps.repo.gravarConfig([{ chave: 'pushSumidosAvisados', valor: JSON.stringify(feitos) }]);
    const avisados = [];
    for (const s of alvo) {
      const r = await enviarParaJogadores(deps, [s.id], {
        titulo: '👋 Sentimos sua falta, ' + s.nome + '!',
        corpo: 'O check-in do vôlei de ' + diaSemana + ' (' + ddmm + ') abriu. Bora voltar? Coloca o nome na lista!'
      });
      if (r.alcancados.length) avisados.push(s.id);
    }
    return avisados;
  } catch (e) { avisar(deps, 'convidarSumidos', e); return []; }
}

// 🔥 "Últimas vagas" (v20.0): depois de cada check-in, se o jogo ficou com 1 a ULTIMAS_VAGAS vagas, avisa UMA vez
// (config "pushUltimasVagas" = 'data#jogo,...') todos os aparelhos menos os de quem já está na lista daquele dia.
// Só no dia com check-in aberto e destravado. Bônus: nunca quebra o check-in.
export const ULTIMAS_VAGAS = 3;
export async function avisarUltimasVagas(deps, data, jogo) {
  try {
    const t = await deps.repo.lerTudo();
    const cfg = mapearConfig(t.config);
    if (!data || texto(cfg.checkinDataAberta) !== data) return;
    const j2 = cfg.checkinJogo2 && texto(cfg.checkinJogo2.data) === data ? cfg.checkinJogo2 : null;
    if (jogo === 2 && !j2) return;
    const travado = jogo === 2 ? !!j2.travado : !!cfg.checkinTravado;
    if (travado) return;
    const vagas = jogo === 2 ? (Number(j2.vagas) || 16) : (Number(cfg.checkinVagas) || 16);
    const horario = jogo === 2 ? j2.horario : cfg.checkinHorario;
    const doDia = mapearCheckins(t.checkins).filter((c) => c.data === data);
    const restam = vagas - doDia.filter((c) => c.jogo === jogo).length;
    if (restam < 1 || restam > ULTIMAS_VAGAS) return;
    const marca = (t.config.find((l) => l.chave === 'pushUltimasVagas') || {}).valor || '';
    const feitos = new Set(String(marca).split(',').filter((k) => k.startsWith(data + '#')));
    const chave = data + '#' + jogo;
    if (feitos.has(chave)) return;
    feitos.add(chave);
    await deps.repo.gravarConfig([{ chave: 'pushUltimasVagas', valor: [...feitos].join(',') }]);
    const { diaSemana, ddmm } = diaEData(data);
    await enviarParaTodosExceto(deps, doDia.map((c) => c.jogadorId), {
      titulo: '🔥 Últimas vagas!',
      corpo: (restam === 1 ? 'Resta 1 vaga' : 'Restam ' + restam + ' vagas') + ' no vôlei de ' + diaSemana + ' (' + ddmm + ') às '
        + horario + '. Corre pra colocar o nome!'
    });
  } catch (e) { avisar(deps, 'avisarUltimasVagas', e); }
}

// ---------------------------------------------------------------------------------------------------------------------
// 💰 Cobrança pelo celular (v19.2): o organizador toca "Cobrar pendentes" no check-in e o app manda a lista de quem está
// confirmado sem pagamento (a MESMA conta da tela, que já sabe de dois jogos e financeiro por jogo). Aqui só confere que
// cada id tem check-in naquela data e manda o aviso pessoal. Devolve quem não tem o app com a conta (cobrar à mão).
export async function cobrarPagamento(deps, { data, jogadorIds, valor, pix } = {}) {
  const dia = texto(data);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { error: 'Data inválida.' };
  if (!Array.isArray(jogadorIds) || jogadorIds.length === 0) return { error: 'Ninguém para cobrar.' };
  if (jogadorIds.length > 100) return { error: 'Lista grande demais.' };
  const noDia = new Set((await deps.repo.lerTudo()).checkins.filter((c) => texto(c.data) === dia).map((c) => texto(c.jogador_id)));
  const ids = [...new Set(jogadorIds.map(texto))].filter((id) => id && noDia.has(id));
  if (ids.length === 0) return { error: 'Ninguém dessa lista está no check-in desse dia.' };
  const { diaSemana, ddmm } = diaEData(dia);
  const v = texto(valor).trim().slice(0, 20), chave = texto(pix).trim().slice(0, 80);
  const corpo = 'Vôlei de ' + diaSemana + ' (' + ddmm + ')' + (v ? ': ' + v : '') + '.' + (chave ? ' Pix: ' + chave + '.' : '')
    + ' Se já pagou, é só avisar o organizador.';
  const r = await enviarParaJogadores(deps, ids, { titulo: '💰 Falta pagar o vôlei', corpo });
  return { status: 'ok', alcancados: r.alcancados, semAparelho: ids.filter((id) => !r.alcancados.includes(id)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// ⏰ "Ainda vai hoje?" (v19.2): um agendador (pg_cron, a cada 15 min) chama esta ação. No dia do check-in aberto, entre
// LEMBRETE_HORAS_ANTES horas antes do jogo e o horário do jogo, avisa UMA vez quem está dentro das vagas. Quem não puder
// ir tira o nome e a reserva recebe o "Você entrou na lista!" na hora. Sem login (o agendador não loga): é seguro porque
// só faz algo dentro da janela e uma vez por jogo (marca "pushLembreteEnviado" ANTES de enviar).
export const LEMBRETE_HORAS_ANTES = 3;

// 🎂 Aniversário (v20.0): no dia (horário de Brasília), a partir de ANIVERSARIO_HORA, UMA vez por dia (config
// "pushAniversarioDia" = 'aaaa-mm-dd', marcada antes de enviar): o aniversariante recebe os parabéns e os outros
// aparelhos recebem "hoje é aniversário de Fulano". Aniversário guardado só com dia e mês ('MM-DD'); 29/02 em ano
// que não é bissexto vira 28/02. Bônus: nunca quebra o lembrete do jogo.
export const ANIVERSARIO_HORA = 9;
export async function avisarAniversarios(deps, t) {
  try {
    const agora = deps.relogio();
    const brasil = new Date(agora.getTime() - 3 * 3600000);
    if (brasil.getUTCHours() < ANIVERSARIO_HORA) return 0;
    const hoje = brasil.toISOString().slice(0, 10);
    if (texto((t.config.find((l) => l.chave === 'pushAniversarioDia') || {}).valor) === hoje) return 0;
    const mmdd = hoje.slice(5);
    const ano = Number(hoje.slice(0, 4));
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    const daVez = mapearJogadores(t.jogadores).filter((p) => p.aniversario === mmdd || (!bissexto && mmdd === '02-28' && p.aniversario === '02-29'));
    await deps.repo.gravarConfig([{ chave: 'pushAniversarioDia', valor: hoje }]);
    if (!daVez.length) return 0;
    const nomes = daVez.map((p) => p.apelido || p.nome);
    const lista = nomes.length === 1 ? nomes[0] : nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
    for (const p of daVez) {
      await enviarParaJogadores(deps, [p.id], { titulo: '🎂 Parabéns, ' + (p.apelido || p.nome) + '!', corpo: 'A turma do vôlei te deseja um feliz aniversário! 🎉🏐' });
    }
    await enviarParaTodosExceto(deps, daVez.map((p) => p.id), {
      titulo: '🎂 Hoje é aniversário de ' + lista + '!', corpo: 'Manda os parabéns no grupo 🎉'
    });
    return daVez.length;
  } catch (e) { avisar(deps, 'avisarAniversarios', e); return 0; }
}

export async function lembreteDoDia(deps) {
  const t = await deps.repo.lerTudo();
  const aniversarios = await avisarAniversarios(deps, t);
  const cfg = mapearConfig(t.config);
  const data = texto(cfg.checkinDataAberta);
  const agora = deps.relogio();
  if (!data || hojeBrasil(agora) !== data) return { status: 'ok', lembretes: 0, ...(aniversarios ? { aniversarios } : {}) };
  const jogos = [{ numero: 1, horario: cfg.checkinHorario }];
  if (cfg.checkinJogo2 && texto(cfg.checkinJogo2.data) === data) jogos.push({ numero: 2, horario: cfg.checkinJogo2.horario });
  const marca = (t.config.find((l) => l.chave === 'pushLembreteEnviado') || {}).valor || '';
  const enviados = new Set(String(marca).split(',').filter((k) => k.startsWith(data + '#'))); // só as marcas de hoje ficam
  const dentro = dentroPorJogo(t, data);
  let lembretes = 0;
  for (const j of jogos) {
    const inicio = Date.parse(data + 'T' + j.horario + ':00-03:00');
    if (!Number.isFinite(inicio)) continue;
    if (agora.getTime() < inicio - LEMBRETE_HORAS_ANTES * 3600000 || agora.getTime() >= inicio) continue;
    const chave = data + '#' + j.numero;
    if (enviados.has(chave)) continue;
    enviados.add(chave);
    await deps.repo.gravarConfig([{ chave: 'pushLembreteEnviado', valor: [...enviados].join(',') }]);
    const ids = dentro[j.numero] ? [...dentro[j.numero].ids] : [];
    if (!ids.length) continue;
    try {
      await enviarParaJogadores(deps, ids, {
        titulo: '⏰ Hoje tem vôlei às ' + j.horario + '!',
        corpo: 'Você está na lista. Não vai poder ir? Tire seu nome agora pra liberar a vaga pra quem está na reserva.'
      });
      lembretes++;
    } catch (e) { avisar(deps, 'lembreteDoDia', e); }
  }
  return { status: 'ok', lembretes, ...(aniversarios ? { aniversarios } : {}) };
}
