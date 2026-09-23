// Funções puras de transformação: célula do Google Sheets (sempre texto ou já convertido
// pela googleapis) -> valor pronto pra gravar na coluna Postgres correspondente.

function paraBooleano(valor) {
  if (typeof valor === 'boolean') return valor;
  return String(valor || '').trim().toUpperCase() === 'TRUE';
}

// "3,5" -> 3.5 ; "1.234,50" -> 1234.5 ; "R$ 13,60" -> 13.6 ; "14" -> 14 ; ""/undefined/null -> null.
// Texto que não é número lança erro (melhor falhar alto do que gravar null no lugar de dinheiro).
function paraNumero(valor) {
  if (typeof valor === 'number') return valor;
  if (valor === undefined || valor === null) return null;
  let texto = String(valor).trim().replace(/R\$/g, '').replace(/\s/g, '');
  if (!texto) return null;
  if (texto.includes(',')) texto = texto.replace(/\./g, '').replace(',', '.');
  const n = Number(texto);
  if (isNaN(n)) throw new Error('Número em formato inesperado: "' + valor + '"');
  return n;
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

// Sempre devolve "yyyy-mm-dd". Aceita ISO (corta hora se vier junto), dd/mm/aaaa,
// e JS Date strings como "Thu Sep 11 2025 00:00:00 GMT-0300 (...)".
function paraDataISO(valor) {
  const texto = String(valor || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const MESES_EN = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const js = texto.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{2}) (\d{4})\b/);
  if (js && MESES_EN[js[1]]) return `${js[3]}-${MESES_EN[js[1]]}-${js[2]}`;
  throw new Error('Data em formato inesperado: "' + texto + '"');
}

// Sempre devolve um ISO 8601 completo (o que o Postgres "timestamptz" espera), ou null.
function paraTimestampISO(valor) {
  const texto = String(valor || '').trim();
  if (!texto) return null;
  // Brasil não tem mais DST desde 2019; São Paulo é UTC-03:00 o ano inteiro
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (br) {
    const d = new Date(`${br[3]}-${br[2]}-${br[1]}T${br[4]}:${br[5]}:${br[6]}-03:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(texto);
  if (isNaN(d.getTime())) throw new Error('Timestamp em formato inesperado: "' + texto + '"');
  return d.toISOString();
}

module.exports = { paraBooleano, dividirJogadores, paraJsonb, paraDataISO, paraTimestampISO, paraNumero };
