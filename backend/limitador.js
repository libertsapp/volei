// Limitador de tentativas da chave mestra (ADMIN_PASSWORD). Sem estado próprio: tudo vive no banco pelo repositório
// (registrarTentativa / limparFalhas), porque a Edge Function não guarda memória entre chamadas.
// Desenho por RESERVA: a tentativa é contada de forma atômica ANTES de a senha ser comparada. Se a reserva é negada, a senha
// nem é comparada; assim requisições paralelas não conseguem chutar "de graça" enquanto o contador não subiu.
// No máximo `maxTentativas` senhas são comparadas por janela; ao estourar, bloqueio de `bloqueioSeg`. Há também um teto GERAL
// (chave 'senha:global', bem mais alto) para que trocar de IP não dê chutes ilimitados.
import { iguaisSeguros } from './auth.js';

export const MSG_MUITAS_TENTATIVAS = 'Muitas tentativas. Tente de novo em alguns minutos.';
export const CHAVE_GLOBAL = 'senha:global';

export function criarLimitador({ repo, maxTentativas = 8, janelaSeg = 900, bloqueioSeg = 900, maxGlobal = 200 }) {
  return {
    // true = pode comparar a senha. Primeiro o balde da rede; só se ele deixar, gasta uma do teto geral
    // (assim quem já está bloqueado não consegue esgotar o teto geral e trancar a chave mestra de todo mundo)
    async reservar(chave) {
      if (!(await repo.registrarTentativa(chave, maxTentativas, janelaSeg, bloqueioSeg))) return false;
      return await repo.registrarTentativa(CHAVE_GLOBAL, maxGlobal, janelaSeg, bloqueioSeg);
    },
    ok: (chave) => repo.limparFalhas(chave) // o teto geral NÃO é zerado por uma senha certa: só expira
  };
}

// Normaliza o IP para a chave do balde. IPv4 fica como está; IPv4 embutido em IPv6 (::ffff:1.2.3.4 ou ::ffff:0102:0304) vira o IPv4;
// IPv6 vira só o prefixo /64 (uma rede doméstica recebe milhões de endereços, então por endereço o limite seria inútil).
export function normalizarIp(ip) {
  let s = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!s) return 'desconhecido';
  if (!s.includes(':')) return s.slice(0, 64); // IPv4 (ou lixo, cortado)
  let miolo = s;
  const ponto = miolo.lastIndexOf('.') >= 0;
  if (ponto) {
    const cauda = miolo.slice(miolo.lastIndexOf(':') + 1).split('.').map(Number);
    if (cauda.length !== 4 || cauda.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return s.slice(0, 64);
    miolo = miolo.slice(0, miolo.lastIndexOf(':') + 1) + ((cauda[0] << 8) | cauda[1]).toString(16) + ':' + ((cauda[2] << 8) | cauda[3]).toString(16);
  }
  const partes = miolo.split('::');
  if (partes.length > 2) return s.slice(0, 64);
  const cabeca = partes[0] ? partes[0].split(':') : [];
  const rabo = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  let grupos;
  if (partes.length === 2) {
    const faltam = 8 - cabeca.length - rabo.length;
    if (faltam < 1) return s.slice(0, 64);
    grupos = [...cabeca, ...Array(faltam).fill('0'), ...rabo];
  } else grupos = cabeca;
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s.slice(0, 64);
  const n = grupos.map((g) => parseInt(g, 16));
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) return `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
  return n.slice(0, 4).map((x) => x.toString(16).padStart(4, '0')).join(':') + '::/64';
}

export const chaveSenha = (ip) => 'senha:' + normalizarIp(ip);

// Ponto ÚNICO de comparação da chave mestra (porteiro e bootstrapAdmin passam por aqui).
// Devolve { bloqueado: true } (a senha NEM é comparada) ou { igual: boolean }. Sem limitador injetado, só compara.
export async function conferirChaveMestra({ config, limitador }, contexto, senhaInformada) {
  const compara = () => !!config.adminPassword && iguaisSeguros(senhaInformada, config.adminPassword);
  if (!limitador) return { igual: compara() };
  const chave = chaveSenha(contexto && contexto.ip);
  if (!(await limitador.reservar(chave))) return { bloqueado: true };
  const igual = compara();
  if (igual) await limitador.ok(chave);
  return { igual };
}
