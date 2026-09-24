// Porteiro único das ações sensíveis. Ordem (igual ao autorizar_ do .gs):
//   1. senha === chave mestra  -> entra como admin (emergência / bootstrap)
//   2. ID Token válido         -> e-mail -> perfil na tabela usuarios -> confere a matriz
//   3. nada disso              -> nega
import { PERMISSOES } from './permissoes.js';
import { iguaisSeguros } from './auth.js';
import { lerUsuarios } from './usuarios.js';
import { mapearJogadores, texto } from './mapeadores.js';

// Única exceção da matriz: um 'jogador' pode mexer no cadastro DELE mesmo, e só para trocar/remover a foto.
// Compara o que chegou com o que já está gravado e só libera se TODO o resto (nome, apelido, estrelas, sexo, porte)
// estiver igualzinho; senão um jogador comum se daria 5 estrelas sozinho.
async function excecaoPropriaFoto(repo, jogadorIdDaConta, body) {
  if (String(body.action) !== 'updatePlayer' || !body.player) return false;
  if (!jogadorIdDaConta || String(jogadorIdDaConta) !== String(body.player.id)) return false;

  const atual = mapearJogadores(await repo.lerJogadores()).find((p) => String(p.id) === String(body.player.id));
  if (!atual) return false;

  const p = body.player;
  return texto(p.nome) === atual.nome
    && texto(p.apelido) === atual.apelido
    && Number(p.estrelas || 0) === atual.estrelas
    && texto(p.sexo) === atual.sexo
    && texto(p.porte) === atual.porte;
}

export async function autorizar({ repo, config, verificarToken }, body) {
  const acao = String(body.action || '');
  if (!Object.hasOwn(PERMISSOES, acao)) return { error: 'Ação desconhecida: ' + acao };
  const permitidos = PERMISSOES[acao];

  // 1) chave mestra — continua valendo em paralelo ao login do Google
  if (body.senha) {
    if (config.adminPassword && iguaisSeguros(body.senha, config.adminPassword)) {
      return { ok: true, perfil: 'admin', email: '', nome: '', jogadorId: '', viaChaveMestra: true };
    }
    // senha errada E sem token: a mensagem que o app já reconhece para limpar a senha guardada
    if (!body.idToken) return { error: 'Senha de administrador incorreta.' };
    // senha errada mas com token: ignora a senha e tenta pelo token
  }

  // 2) token do Google
  const token = await verificarToken(body.idToken);
  if (!token.ok) return { error: token.erro };

  const usuario = (await lerUsuarios(repo)).find((u) => u.email === token.email);
  const perfil = (usuario && usuario.perfil) || 'jogador'; // e-mail desconhecido = jogador
  const jogadorId = usuario ? usuario.jogadorId : '';
  if (!permitidos.includes(perfil)) {
    if (await excecaoPropriaFoto(repo, jogadorId, body)) {
      return { ok: true, perfil, email: token.email, nome: token.nome, jogadorId, viaChaveMestra: false };
    }
    return { error: 'Seu perfil (' + perfil + ') não tem permissão para esta ação.' };
  }

  return { ok: true, perfil, email: token.email, nome: token.nome, jogadorId, viaChaveMestra: false };
}
