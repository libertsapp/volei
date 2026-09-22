// Funções puras de transformação: célula do Google Sheets (sempre texto ou já convertido
// pela googleapis) -> valor pronto pra gravar na coluna Postgres correspondente.

function paraBooleano(valor) {
  if (typeof valor === 'boolean') return valor;
  return String(valor || '').trim().toUpperCase() === 'TRUE';
}

function dividirJogadores(idsTexto) {
  return String(idsTexto || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function paraJsonb(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  try { return JSON.parse(texto); }
  catch (e) { return { texto }; }
}

// Sempre devolve "yyyy-mm-dd". Aceita ISO (corta hora se vier junto) e dd/mm/aaaa
// (formato que o Google Sheets costuma mostrar quando a coluna é do tipo Data, locale pt-BR).
function paraDataISO(valor) {
  const texto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  throw new Error('Data em formato inesperado: "' + texto + '"');
}

// Sempre devolve um ISO 8601 completo (o que o Postgres "timestamptz" espera), ou null.
function paraTimestampISO(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  const d = new Date(texto);
  if (isNaN(d.getTime())) throw new Error('Timestamp em formato inesperado: "' + texto + '"');
  return d.toISOString();
}

module.exports = { paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO };
