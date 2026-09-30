// Porteiro único das ações sensíveis. Ordem (igual ao autorizar_ do .gs):
//   1. senha === chave mestra  -> entra como admin (emergência / bootstrap)
//   2. sessão do app válida (ou, para o app antigo, ID Token do Google) -> e-mail -> perfil na tabela usuarios -> matriz
//   3. nada disso              -> nega
import { PERMISSOES } from './permissoes.js';
import { conferirChaveMestra, MSG_MUITAS_TENTATIVAS } from './limitador.js';
import { lerUsuarios } from './usuarios.js';
import { mapearJogadores, texto } from './mapeadores.js';
import { validarSessao, MSG_SESSAO_EXPIRADA } from './sessoes.js';

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

// Quem é a pessoa. Sessão do app primeiro (banco, sem falar com o Google); senão o ID Token do Google, como antes
// (mantém funcionando o app antigo que ainda está em cache no celular). O nome, na sessão, vem da tabela usuarios.
export async function identificar(deps, body) {
  if (body.sessao) {
    const s = await validarSessao(deps, body.sessao);
    let erro = s.erro;
    if (s.ok) {
      const usuario = (await lerUsuarios(deps.repo)).find((u) => u.email === s.email);
      if (usuario) return { ok: true, email: s.email, nome: usuario.nome || '', via: 'sessao' };
      erro = MSG_SESSAO_EXPIRADA; // conta removida por um admin depois que a sessão foi criada
    }
    if (!body.idToken) return { ok: false, erro };
  }
  const token = await deps.verificarToken(body.idToken);
  return token.ok ? { ...token, via: 'google' } : token;
}

export async function autorizar({ repo, config, verificarToken, limitador, relogio }, body, contexto = {}) {
  const acao = String(body.action || '');
  if (!Object.hasOwn(PERMISSOES, acao)) return { error: 'Ação desconhecida: ' + acao };
  const permitidos = PERMISSOES[acao];

  // 1) chave mestra — continua valendo em paralelo ao login do Google
  if (body.senha) {
    // com limitador (Edge Function): erros seguidos do mesmo IP bloqueiam SÓ este caminho; o login do Google segue valendo
    const conferencia = await conferirChaveMestra({ config, limitador }, contexto, body.senha);
    if (conferencia.bloqueado) {
      // bloqueado e sem token: nega já, sem comparar a senha; com token, ignora a senha e tenta pelo token (não trava quem tem uma senha velha guardada)
      if (!(body.idToken || body.sessao)) return { error: MSG_MUITAS_TENTATIVAS };
    } else if (conferencia.igual) {
      return { ok: true, perfil: 'admin', email: '', nome: '', jogadorId: '', viaChaveMestra: true };
    } else if (!(body.idToken || body.sessao)) {
      // senha errada E sem token/sessão: a mensagem que o app já reconhece para limpar a senha guardada
      return { error: 'Senha de administrador incorreta.' };
    }
    // senha errada (ou bloqueada) mas com token: ignora a senha e tenta pelo token
  }

  // 2) sessão do app ou token do Google
  const token = await identificar({ repo, config, verificarToken, limitador, relogio }, body);
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
