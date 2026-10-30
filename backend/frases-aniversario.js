// 🎂 Frases do cartão de parabéns (v21.0). Organizador e admin editam a lista do grupo na ⚙️ engrenagem; o app sorteia
// uma delas cada vez que abre o cartão de um aniversariante. Fica nas configurações, numa chave só (JSON com a lista).
// Lista vazia (ou "voltar às padrão") = chave vazia: o app usa as frases padrão que vêm no próprio HTML.
import { texto } from './mapeadores.js';

export const LIMITE_FRASES = 20;
export const LIMITE_FRASE = 160;

// limpa uma frase: uma linha só, sem espaço sobrando, cortada no tamanho máximo
function limpar(f) {
  return texto(f).replace(/\s+/g, ' ').trim().slice(0, LIMITE_FRASE);
}

export async function salvarFrasesAniversario(deps, body) {
  const b = body || {};
  if (b.remover) {
    await deps.repo.gravarConfig([{ chave: 'frasesAniversario', valor: '' }]);
    return { status: 'ok', frasesAniversario: null };
  }
  if (!Array.isArray(b.frases)) return { error: 'Lista de frases inválida.' };
  const frases = b.frases.map(limpar).filter(Boolean);
  if (frases.length > LIMITE_FRASES) return { error: 'No máximo ' + LIMITE_FRASES + ' frases.' };
  await deps.repo.gravarConfig([{ chave: 'frasesAniversario', valor: frases.length ? JSON.stringify(frases) : '' }]);
  return { status: 'ok', frasesAniversario: frases.length ? frases : null };
}

// o JSON vem do banco: qualquer coisa fora do formato é descartada (nunca derruba a leitura do app)
export function lerFrases(json) {
  let bruto;
  try { bruto = JSON.parse(json || '[]'); } catch { return []; }
  if (!Array.isArray(bruto)) return [];
  return bruto.filter((f) => typeof f === 'string').map(limpar).filter(Boolean).slice(0, LIMITE_FRASES);
}
