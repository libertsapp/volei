// Porteiro único das ações sensíveis. Ordem (igual ao autorizar_ do .gs):
//   1. senha === chave mestra  -> entra como admin (emergência / bootstrap)
//   2. ID Token válido         -> e-mail -> perfil na tabela usuarios -> confere a matriz
//   3. nada disso              -> nega
import { PERMISSOES } from './permissoes.js';
import { iguaisSeguros } from './auth.js';
import { lerUsuarios } from './usuarios.js';

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
  if (!permitidos.includes(perfil)) return { error: 'Seu perfil (' + perfil + ') não tem permissão para esta ação.' };

  return { ok: true, perfil, email: token.email, nome: token.nome, jogadorId: usuario ? usuario.jogadorId : '', viaChaveMestra: false };
}
