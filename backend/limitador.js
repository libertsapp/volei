// Limitador de tentativas da chave mestra (ADMIN_PASSWORD). Sem estado próprio: tudo vive no banco pelo repositório
// (tentativaBloqueada / registrarFalha / limparFalhas), porque a Edge Function não guarda memória entre chamadas.
// Depois de `maxFalhas` erros dentro da janela, a chave fica bloqueada por `bloqueioSeg`; a janela também é `bloqueioSeg`.
import { iguaisSeguros } from './auth.js';

export const MSG_MUITAS_TENTATIVAS = 'Muitas tentativas. Tente de novo em alguns minutos.';

export function criarLimitador({ repo, maxFalhas = 8, bloqueioSeg = 900 }) {
  return {
    bloqueado: (chave) => repo.tentativaBloqueada(chave),
    falhou: (chave) => repo.registrarFalha(chave, maxFalhas, bloqueioSeg),
    ok: (chave) => repo.limparFalhas(chave)
  };
}

export const chaveSenha = (ip) => 'senha:' + (ip || 'desconhecido');

// Ponto ÚNICO de comparação da chave mestra (porteiro e bootstrapAdmin passam por aqui).
// Devolve { bloqueado: true } (a senha NEM é comparada) ou { igual: boolean }. Sem limitador injetado, só compara.
export async function conferirChaveMestra({ config, limitador }, contexto, senhaInformada) {
  const compara = () => !!config.adminPassword && iguaisSeguros(senhaInformada, config.adminPassword);
  if (!limitador) return { igual: compara() };
  const chave = chaveSenha(contexto && contexto.ip);
  if (await limitador.bloqueado(chave)) return { bloqueado: true };
  const igual = compara();
  if (igual) await limitador.ok(chave); else await limitador.falhou(chave);
  return { igual };
}
