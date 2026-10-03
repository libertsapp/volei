// Tira dos JSONs de resposta os campos que só existem no backend novo (dois jogos no mesmo dia, 2026-10-03): o .gs
// real não tem esse conceito, então as comparações byte a byte com ele (paridade-*.test.mjs) precisam ignorar esses
// campos, em qualquer profundidade do objeto — eles aparecem dentro de arrays (checkins[], pagamentos[], creditos[]).
const CAMPOS_NOVOS = new Set(['jogo', 'porJogo', 'jogoOrigem', 'jogos', 'checkinJogo2']);

export function semCamposNovos(valor) {
  if (Array.isArray(valor)) return valor.map(semCamposNovos);
  if (valor && typeof valor === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) {
      if (CAMPOS_NOVOS.has(k)) continue;
      saida[k] = semCamposNovos(v);
    }
    return saida;
  }
  return valor;
}
