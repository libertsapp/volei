// Cadastro de jogadores. Port de addPlayer, updatePlayer e removePlayer de apps-script-codigo.gs (mesmas mensagens).
// "Remover" ARQUIVA o jogador (coluna removido): ele some de players, como acontece hoje, mas o histórico que aponta
// para ele (rodadas, check-ins, pagamentos, vínculos) continua válido no banco.
import { mapearJogadores, mapearJogadoresRemovidos, texto } from './mapeadores.js';

// aniversário: só dia e mês ('MM-DD'), sem ano (ninguém precisa da idade de ninguém)
export const FORMATO_ANIVERSARIO = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

// os 6 campos que o .gs sobrescreve; vazios viram null (sexo tem check M/F) e são lidos de volta como ''.
// v20.0: aniversario e recrutadoPor só entram quando o app MANDA a chave — app antigo (em cache no celular) que não
// conhece o campo não apaga o que já estava gravado. Vazio = apagar.
function campos(p) {
  const c = {
    nome: texto(p.nome),
    apelido: texto(p.apelido) || null,
    foto: texto(p.foto) || null,
    estrelas: Number(p.estrelas) || 0,
    sexo: texto(p.sexo) || null,
    porte: texto(p.porte) || null
  };
  if ('aniversario' in p) c.aniversario = texto(p.aniversario) || null;
  if ('recrutadoPor' in p) c.recrutado_por = texto(p.recrutadoPor) || null;
  return c;
}
function conferirExtras(p, idDoProprio) {
  if (texto(p.aniversario) && !FORMATO_ANIVERSARIO.test(texto(p.aniversario))) return 'Aniversário inválido (use dia e mês).';
  if (texto(p.recrutadoPor) && texto(p.recrutadoPor) === idDoProprio) return 'Ninguém se recruta sozinho. 😄';
  return '';
}

const ativos = async (repo) => mapearJogadores(await repo.lerJogadores());

export async function addPlayer({ repo }, p) {
  if (!p || !texto(p.id)) return { error: 'Jogador sem id.' };
  if ((await repo.lerJogadores()).some((j) => j.id === texto(p.id))) return { error: 'Já existe um jogador com esse id.' };
  const erro = conferirExtras(p, texto(p.id));
  if (erro) return { error: erro };
  const c = campos(p);
  if (!c.aniversario) delete c.aniversario; // jogador novo sem o campo: nem manda a coluna
  if (!c.recrutado_por) delete c.recrutado_por;
  await repo.inserirJogador({ id: texto(p.id), ...c });
  return { status: 'ok' };
}

export async function updatePlayer({ repo }, p) {
  const id = texto(p && p.id);
  if (!(await ativos(repo)).some((j) => j.id === id)) {
    return { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' };
  }
  const erro = conferirExtras(p, id);
  if (erro) return { error: erro };
  await repo.atualizarJogador(id, campos(p));
  return { status: 'ok' };
}

// desfaz o arquivamento: volta a aparecer na lista, no check-in e no ranking (a coluna "ordem" preserva o lugar antigo)
export async function restorePlayer({ repo }, id) {
  const alvo = texto(id);
  if (!mapearJogadoresRemovidos(await repo.lerJogadores()).some((j) => j.id === alvo)) {
    return { error: 'Jogador removido não encontrado (pode já ter sido reativado por outra pessoa).' };
  }
  await repo.atualizarJogador(alvo, { removido: false });
  return { status: 'ok' };
}

export async function removePlayer({ repo }, id) {
  const alvo = texto(id);
  if (!(await ativos(repo)).some((j) => j.id === alvo)) {
    return { error: 'Jogador não encontrado (pode já ter sido removido por outra pessoa).' };
  }
  await repo.atualizarJogador(alvo, { removido: true });
  return { status: 'ok' };
}
