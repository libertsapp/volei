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
  { chave: 'replaysArenaNome', valor: '' }, { chave: 'replaysQuadraNome', valor: '' },
  { chave: 'replaysDias', valor: '' }
];
// quadra de cada dia: nem sempre o grupo joga na mesma. Fica numa chave só (JSON { "2026-10-13": { quadra, nome } }),
// guardando só os dias mais recentes — o RegistraAí apaga os vídeos em poucas semanas, dia antigo não serve pra nada
const LIMITE_DIAS = 60;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

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

// organizador/admin marca em qual quadra o jogo de um dia foi (quadra vazia = volta à quadra padrão naquele dia)
export async function salvarQuadraDoDia(deps, body) {
  const b = body || {};
  const data = texto(b.data).trim();
  const quadra = texto(b.quadra).trim().toLowerCase();
  if (!DATA_ISO.test(data)) return { error: 'Data inválida.' };
  if (quadra && !ID_REGISTRAAI.test(quadra)) return { error: 'Quadra inválida.' };
  const linhas = await deps.repo.lerConfig();
  const valor = (k) => texto((linhas.find((c) => c.chave === k) || {}).valor);
  if (!valor('replaysArena')) return { error: 'Os replays não estão ligados. O admin liga na ⚙️ engrenagem.' };
  const dias = lerDias(valor('replaysDias'));
  if (quadra) dias[data] = { quadra, nome: texto(b.nome).trim().slice(0, LIMITE_NOME) };
  else delete dias[data];
  const recentes = Object.keys(dias).sort().reverse().slice(0, LIMITE_DIAS);
  const guardar = {};
  recentes.forEach((d) => { guardar[d] = dias[d]; });
  await deps.repo.gravarConfig([{ chave: 'replaysDias', valor: recentes.length ? JSON.stringify(guardar) : '' }]);
  return { status: 'ok', dias: guardar };
}

// o JSON vem do banco: qualquer coisa fora do formato é descartada (nunca derruba a leitura do app)
export function lerDias(json) {
  let bruto;
  try { bruto = JSON.parse(json || '{}'); } catch { return {}; }
  const dias = {};
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return dias;
  for (const [d, v] of Object.entries(bruto)) {
    if (DATA_ISO.test(d) && v && ID_REGISTRAAI.test(texto(v.quadra))) dias[d] = { quadra: texto(v.quadra), nome: texto(v.nome) };
  }
  return dias;
}
