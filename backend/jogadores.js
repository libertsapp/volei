// Cadastro de jogadores. Port de addPlayer, updatePlayer e removePlayer de apps-script-codigo.gs (mesmas mensagens).
// "Remover" ARQUIVA o jogador (coluna removido): ele some de players, como acontece hoje, mas o histórico que aponta
// para ele (rodadas, check-ins, pagamentos, vínculos) continua válido no banco.
import { mapearJogadores, texto } from './mapeadores.js';

// os 6 campos que o .gs sobrescreve; vazios viram null (sexo tem check M/F) e são lidos de volta como ''
function campos(p) {
  return {
    nome: texto(p.nome),
    apelido: texto(p.apelido) || null,
    foto: texto(p.foto) || null,
    estrelas: Number(p.estrelas) || 0,
    sexo: texto(p.sexo) || null,
    porte: texto(p.porte) || null
  };
}

const ativos = async (repo) => mapearJogadores(await repo.lerJogadores());

export async function addPlayer({ repo }, p) {
  if (!p || !texto(p.id)) return { error: 'Jogador sem id.' };
  if ((await repo.lerJogadores()).some((j) => j.id === texto(p.id))) return { error: 'Já existe um jogador com esse id.' };
  await repo.inserirJogador({ id: texto(p.id), ...campos(p) });
  return { status: 'ok' };
}

export async function updatePlayer({ repo }, p) {
  const id = texto(p && p.id);
  if (!(await ativos(repo)).some((j) => j.id === id)) {
    return { error: 'Jogador não encontrado na planilha (pode já ter sido removido por outra pessoa).' };
  }
  await repo.atualizarJogador(id, campos(p));
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
