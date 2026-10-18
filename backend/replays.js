// 🎥 Replays (v20.2): os vídeos do RegistraAí (registraai.com.br) aparecem no app SEM passar por aqui — o navegador
// chama a API pública deles e toca o .mp4 direto do armazenamento deles. Nós só guardamos QUAL arena e QUAL quadra
// mostrar, nas configurações (chaves replaysArena/replaysQuadra + os nomes, pra tela não depender de buscar de novo).
// Só ADMIN (matriz de permissões). Os identificadores do RegistraAí são hexadecimais de 24 caracteres; qualquer outra
// coisa é recusada, porque o valor vai parar dentro de um endereço que o app monta (?a=...&q=...).
import { texto } from './mapeadores.js';

export const ID_REGISTRAAI = /^[0-9a-f]{24}$/;
const LIMITE_NOME = 80;

const CHAVES_VAZIAS = [
  { chave: 'replaysArena', valor: '' }, { chave: 'replaysQuadra', valor: '' },
  { chave: 'replaysArenaNome', valor: '' }, { chave: 'replaysQuadraNome', valor: '' }
];

export async function salvarReplays(deps, body) {
  const b = body || {};
  if (b.remover) {
    await deps.repo.gravarConfig(CHAVES_VAZIAS);
    return { status: 'ok', replays: null };
  }
  const arena = texto(b.arena).trim().toLowerCase();
  const quadra = texto(b.quadra).trim().toLowerCase();
  if (!ID_REGISTRAAI.test(arena)) return { error: 'Link da arena inválido. Cole o link do RegistraAí (com ?a=...).' };
  if (!ID_REGISTRAAI.test(quadra)) return { error: 'Escolha a quadra.' };
  const arenaNome = texto(b.arenaNome).trim().slice(0, LIMITE_NOME);
  const quadraNome = texto(b.quadraNome).trim().slice(0, LIMITE_NOME);
  await deps.repo.gravarConfig([
    { chave: 'replaysArena', valor: arena }, { chave: 'replaysQuadra', valor: quadra },
    { chave: 'replaysArenaNome', valor: arenaNome }, { chave: 'replaysQuadraNome', valor: quadraNome }
  ]);
  return { status: 'ok', replays: { arena, quadra, arenaNome, quadraNome } };
}
