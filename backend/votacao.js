// Votação do Craque e do Bola Murcha (v19.1). Decisões do grupo (2026-10-17):
//   - uma votação por DIA de jogo (num dia com dois jogos, vale quem jogou qualquer um deles);
//   - abre quando a rodada oficial do dia é salva e fecha HORAS_VOTACAO (24) horas depois;
//   - vota só quem jogou naquele dia, pela conta vinculada (vínculo APROVADO) ao jogador; um voto por jogador em cada
//     categoria (votar de novo troca o voto); ninguém vota em si mesmo nem na mesma pessoa pras duas categorias;
//   - votos secretos: o GET público só traz quantas pessoas votaram enquanto está aberta, e o resultado (quem venceu e
//     com quantos votos) depois que fecha. Quem votou em quem nunca sai do servidor;
//   - empate: todos os empatados levam o título.
// Tabelas fora de TABELAS (ajuste 17): se não existirem neste schema, a votação some e o resto do app segue igual.
import { mapearRodadas, texto } from './mapeadores.js';
import { identificar } from './porteiro.js';
import { lerUsuarios } from './usuarios.js';
import { enviarParaJogadores } from './notificacoes.js';
import { diaEData } from './avisos-push.js';

export const HORAS_VOTACAO = 24;
export const CATEGORIAS = ['craque', 'murcha'];
const MAX_DIAS_PARA_ABRIR = 2; // editar rodada antiga (de semanas atrás) não abre votação pra ela

const agoraDe = (deps) => (deps.relogio ? deps.relogio() : new Date());
const iso = (v) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
// "hoje" no Brasil (-03:00): às 22h de Brasília o servidor (UTC) já está no dia seguinte
const hojeBrasil = (agora) => new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

function avisar(deps, onde, erro) {
  try { if (typeof deps.avisar === 'function') deps.avisar(onde + ': ' + (erro && erro.message ? erro.message : erro)); } catch { /* nada */ }
}

// quem jogou (em qualquer rodada OFICIAL) em cada data: { 'aaaa-mm-dd': Set(ids) }.
// v19.3: quem levou 🚫 falta em TODOS os check-ins que tinha na data não jogou, mesmo escalado num time (não vota nem é
// votado). Faltou um jogo e foi no outro: jogou o dia (a votação é por dia).
export function jogadoresPorData(t) {
  const out = {};
  for (const r of mapearRodadas(t.rodadas, t.times_rodada, t.time_jogadores)) {
    if (r.rascunho) continue;
    const s = out[r.data] || (out[r.data] = new Set());
    for (const time of r.times) for (const id of time.playerIds || []) if (id) s.add(String(id));
  }
  const faltou = new Set(), foi = new Set(); // 'data|id'
  for (const c of t.checkins || []) {
    if (!c.jogador_id) continue;
    (c.faltou === true ? faltou : foi).add(texto(c.data).slice(0, 10) + '|' + texto(c.jogador_id));
  }
  for (const k of faltou) {
    if (foi.has(k)) continue;
    const [data, id] = k.split('|');
    if (out[data]) out[data].delete(id);
  }
  return out;
}

// bloco público do GET: só votações de dias que ainda têm rodada oficial, da mais recente pra mais antiga
export function mapearVotacoes(votacoes, votos, porData, agora) {
  return votacoes
    .map((v) => ({ data: texto(v.data).slice(0, 10), abreEm: iso(v.abre_em), fechaEm: iso(v.fecha_em) }))
    .filter((v) => porData[v.data])
    .sort((a, b) => b.data.localeCompare(a.data))
    .map((v) => {
      const doDia = votos.filter((o) => texto(o.data).slice(0, 10) === v.data);
      const aberta = agora.getTime() < Date.parse(v.fechaEm);
      const saida = { ...v, aberta, votantes: new Set(doDia.map((o) => o.eleitor_jogador_id)).size };
      if (aberta) return saida;
      saida.resultado = {};
      for (const cat of CATEGORIAS) {
        const contagem = {};
        doDia.filter((o) => o.categoria === cat).forEach((o) => { contagem[o.votado_id] = (contagem[o.votado_id] || 0) + 1; });
        const max = Math.max(0, ...Object.values(contagem));
        saida.resultado[cat] = { ids: max > 0 ? Object.keys(contagem).filter((id) => contagem[id] === max).sort() : [], votos: max };
      }
      return saida;
    });
}

export async function lerBlocoVotacao(deps, tudo) {
  if (typeof deps.repo.lerVotacoes !== 'function') return [];
  try {
    const { votacoes, votos } = await deps.repo.lerVotacoes();
    return mapearVotacoes(votacoes, votos, jogadoresPorData(tudo), agoraDe(deps));
  } catch (erro) {
    avisar(deps, 'votação indisponível', erro);
    return [];
  }
}

// chamada depois de salvar uma rodada OFICIAL: cria a votação do dia (se ainda não existe) e avisa quem jogou.
// Bônus: nunca quebra o salvar da rodada.
export async function abrirVotacaoSeFaltar(deps, data) {
  try {
    if (typeof deps.repo.criarVotacao !== 'function') return;
    const agora = agoraDe(deps);
    const dia = texto(data);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
    const atraso = diasEntre(dia, hojeBrasil(agora));
    if (atraso > MAX_DIAS_PARA_ABRIR || atraso < -1) return;
    const criou = await deps.repo.criarVotacao({
      data: dia, abre_em: agora.toISOString(), fecha_em: new Date(agora.getTime() + HORAS_VOTACAO * 3600000).toISOString()
    });
    if (!criou) return;
    const jogaram = jogadoresPorData(await deps.repo.lerTudo())[dia];
    if (!jogaram || !jogaram.size) return;
    const { diaSemana, ddmm } = diaEData(dia);
    await enviarParaJogadores(deps, [...jogaram], {
      titulo: '🗳️ Votação aberta!',
      // tom de resenha (v19.4): o Bola Murcha é zoeira de amigo, não crítica
      corpo: 'Bora pra resenha! Quem foi o craque e quem foi o bola murcha do vôlei de ' + diaSemana + ' (' + ddmm + ')? ' +
        'É só pra descontrair 😄 Você tem ' + HORAS_VOTACAO + 'h pra votar.'
    });
  } catch (e) { avisar(deps, 'abrirVotacaoSeFaltar', e); }
}

// quem está votando: conta logada -> jogador do vínculo APROVADO
async function eleitor(deps, b) {
  const quem = await identificar(deps, b);
  if (!quem.ok) return { error: quem.erro };
  const conta = (await lerUsuarios(deps.repo)).find((u) => u.email === quem.email);
  if (!conta || !conta.jogadorId) return { error: 'Vincule sua conta a um jogador pra votar.' };
  return { email: quem.email, jogadorId: String(conta.jogadorId) };
}

// b: { data, craque, murcha } — cada categoria pode vir vazia (não mexe naquele voto); '-' tira o voto da categoria
export async function votar(deps, b) {
  const e = await eleitor(deps, b);
  if (e.error) return e;
  const data = texto(b.data);
  const { votacoes, votos } = await deps.repo.lerVotacoes();
  const v = votacoes.find((x) => texto(x.data).slice(0, 10) === data);
  if (!v) return { error: 'Não há votação para esse dia.' };
  if (agoraDe(deps).getTime() >= Date.parse(iso(v.fecha_em))) return { error: 'A votação desse dia já fechou.' };
  const jogaram = jogadoresPorData(await deps.repo.lerTudo())[data] || new Set();
  if (!jogaram.has(e.jogadorId)) return { error: 'Só quem jogou nesse dia pode votar.' };

  // o voto final de cada categoria depois desta chamada (o que veio, ou o que já estava gravado)
  const atual = (cat) => (votos.find((o) => texto(o.data).slice(0, 10) === data && o.categoria === cat && o.eleitor_jogador_id === e.jogadorId) || {}).votado_id || '';
  const final = {};
  for (const cat of CATEGORIAS) {
    const veio = texto(b[cat]);
    final[cat] = veio === '-' ? '' : (veio || atual(cat));
    if (!veio || veio === '-') continue;
    if (veio === e.jogadorId) return { error: 'Não dá pra votar em você mesmo.' };
    if (!jogaram.has(veio)) return { error: 'Esse jogador não jogou nesse dia.' };
  }
  if (final.craque && final.craque === final.murcha) return { error: 'Não dá pra votar na mesma pessoa pra Craque e Bola Murcha.' };

  const quando = agoraDe(deps).toISOString();
  for (const cat of CATEGORIAS) {
    const veio = texto(b[cat]);
    if (veio === '-') await deps.repo.removerVoto(data, cat, e.jogadorId);
    else if (veio) await deps.repo.gravarVoto({ data, categoria: cat, eleitor_jogador_id: e.jogadorId, eleitor_email: e.email, votado_id: veio, criado_em: quando });
  }
  return { status: 'ok', meusVotos: { [data]: { craque: final.craque, murcha: final.murcha } } };
}

// os votos DA PRÓPRIA pessoa nas votações abertas (o app mostra "você votou em..." e deixa trocar)
export async function meusVotos(deps, b) {
  const e = await eleitor(deps, b);
  if (e.error) return e;
  const { votacoes, votos } = await deps.repo.lerVotacoes();
  const agora = agoraDe(deps).getTime();
  const out = {};
  for (const v of votacoes) {
    if (agora >= Date.parse(iso(v.fecha_em))) continue;
    const data = texto(v.data).slice(0, 10);
    const meu = (cat) => (votos.find((o) => texto(o.data).slice(0, 10) === data && o.categoria === cat && o.eleitor_jogador_id === e.jogadorId) || {}).votado_id || '';
    out[data] = { craque: meu('craque'), murcha: meu('murcha') };
  }
  return { status: 'ok', meusVotos: out };
}
