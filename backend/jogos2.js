// Criar/editar e remover o 2º jogo do dia (dois jogos no mesmo dia, 2026-10-03). O 2º jogo vive só em 4 chaves de
// `config` (checkinJogo2Data/Horario/Vagas/Travado); "existe" quando checkinJogo2Data bate com checkinDataAberta.
// Spec: docs/superpowers/specs/2026-10-03-dois-jogos-no-mesmo-dia-design.md
import { texto, mapearConfig } from './mapeadores.js';
import { removeCheckin } from './checkins.js';
import { aplicarCreditosDoDia } from './financeiro.js';

function dataValida(s) {
  const v = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '0001-01-01') return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const horarioValido = (s) => /^\d{2}:\d{2}$/.test(String(s || ''));
const agora = (deps) => (deps.relogio ? deps.relogio() : new Date()).toISOString();
const nomeDe = (auth) => auth.nome || (auth.viaChaveMestra ? 'Chave mestra' : (auth.email || 'Desconhecido'));

export async function salvarJogo2(deps, jogo2, auth) {
  const { repo } = deps;
  if (!jogo2 || !dataValida(jogo2.data)) return { error: 'Data inválida.' };
  if (!horarioValido(jogo2.horario)) return { error: 'Horário inválido.' };
  const vagas = Number(jogo2.vagas);
  if (!(vagas > 0)) return { error: 'Vagas precisam ser maior que zero.' };
  const cfg = mapearConfig(await repo.lerConfig());
  if (cfg.checkinDataAberta !== texto(jogo2.data)) return { error: 'Abra o check-in para essa data antes de adicionar o 2º jogo.' };
  if (texto(jogo2.horario) === cfg.checkinHorario) return { error: 'Os dois jogos não podem ter o mesmo horário.' };
  await repo.gravarConfig([
    { chave: 'checkinJogo2Data', valor: texto(jogo2.data) },
    { chave: 'checkinJogo2Horario', valor: texto(jogo2.horario) },
    { chave: 'checkinJogo2Vagas', valor: String(vagas) },
    { chave: 'checkinJogo2Travado', valor: jogo2.travado ? 'TRUE' : 'FALSE' }
  ]);
  return { status: 'ok' };
}

// destino: 'mover' (leva a lista do jogo removido pro fim da fila do jogo mantido) ou 'desconfirmar' (desmarca
// presença de quem está no jogo removido, com os mesmos ganchos do financeiro do "Vou jogar"/"Desconfirmar todos").
// manter: 2 — "trocar os papéis": usado quando quem está sendo removido é o jogo 1 (o app sempre chama esta mesma
// ação; com manter:2, a configuração e a fila que SOBREVIVEM no lugar do jogo 1 são as do jogo 2).
export async function removerJogo2(deps, { data, destino, manter } = {}, auth) {
  const { repo } = deps;
  if (!dataValida(data)) return { error: 'Data inválida.' };
  const cfg = mapearConfig(await repo.lerConfig());
  if (!cfg.checkinJogo2 || texto(cfg.checkinJogo2.data) !== texto(data)) return { error: 'Não há um 2º jogo configurado para essa data.' };
  const t = await repo.lerTudo();
  const dia = (t.fin_dias || []).find((d) => texto(d.data) === texto(data));
  const porJogo = !!(dia && dia.por_jogo === true);
  const jogo2Fin = (t.fin_jogos || []).find((j) => texto(j.data) === texto(data) && Number(j.jogo) === 2) || null;
  // o jogo que está SENDO REMOVIDO, de verdade — com manter:2 é o jogo 1, não o 2 (bug encontrado na revisão final:
  // antes disso, a checagem de pagamento e o "desconfirmar" abaixo olhavam sempre pro jogo 2, mesmo quando quem
  // estava saindo era o 1 — bloqueava (ou desconfirmava) o jogo errado)
  const jogoRemovido = manter === 2 ? 1 : 2;
  const horarioRemovido = jogoRemovido === 2 ? cfg.checkinJogo2.horario : cfg.checkinHorario;
  if (porJogo && t.fin_pagamentos.some((p) => texto(p.data) === texto(data) && Number(p.jogo) === jogoRemovido && p.estornado !== true)) {
    return { error: 'O jogo das ' + horarioRemovido + ' tem pagamento(s) só dele. Cancele-os (ou marque como sem jogo) antes de remover.' };
  }
  if (destino === 'mover') {
    if (manter === 2) {
      // "trocar os papéis": a fila do jogo mantido (2) vem primeiro, a do jogo removido (1) entra no fim —
      // duas chamadas do mesmo primitivo genérico fazem o trabalho (ver repo-memoria.js/mover_fila_para_jogo)
      await repo.moverFilaParaJogo(data, 1, 2);
      await repo.moverFilaParaJogo(data, 2, 1);
    } else {
      await repo.moverJogo2ParaJogo1(data);
    }
  } else {
    // "desconfirmar": passa pelo removeCheckin de verdade (não pelo repo direto) — é ele quem aciona o gancho
    // financeiro (devolve crédito de quem tinha pago por crédito, etc.), igual ao "Desconfirmar todos" do check-in
    for (const c of t.checkins.filter((c) => c.data === texto(data) && (Number(c.jogo) || 1) === jogoRemovido)) {
      await removeCheckin(deps, texto(c.id));
    }
  }
  if (manter === 2) {
    await repo.gravarConfig([
      { chave: 'checkinHorario', valor: cfg.checkinJogo2.horario },
      { chave: 'checkinVagas', valor: String(cfg.checkinJogo2.vagas) },
      { chave: 'checkinTravado', valor: cfg.checkinJogo2.travado ? 'TRUE' : 'FALSE' }
    ]);
    if (porJogo && jogo2Fin) {
      await repo.gravarFinDia({
        data, valor_pessoa: Number(jogo2Fin.valor_pessoa) || 0, pix: jogo2Fin.pix || '', valor_quadra: Number(jogo2Fin.valor_quadra) || 0,
        tem_brinde: jogo2Fin.tem_brinde === true, valor_brinde: Number(jogo2Fin.valor_brinde) || 0, icone: jogo2Fin.icone || '✅',
        status: jogo2Fin.status || 'normal', atualizado_por: nomeDe(auth), atualizado_em: agora(deps)
      });
    }
  }
  await repo.gravarConfig([
    { chave: 'checkinJogo2Data', valor: '' }, { chave: 'checkinJogo2Horario', valor: '' },
    { chave: 'checkinJogo2Vagas', valor: '' }, { chave: 'checkinJogo2Travado', valor: 'FALSE' }
  ]);
  if (porJogo) {
    // o dia volta a ser único (chave null): todo pagamento/crédito que ainda estava marcado com jogo 1/2 tem que
    // voltar pra chave null, senão fica invisível pra sempre (a leitura, daqui pra frente, só olha a chave null) —
    // e a configuração solta do jogo 2 em fin_jogos não faz mais sentido existir
    await repo.gravarFinDia({ data, por_jogo: false });
    await repo.reunificarChaveFinanceira(data);
    await aplicarCreditosDoDia(deps, data, auth); // crédito que ficou disponível com a reunificação já se aplica
  }
  return { status: 'ok' };
}
