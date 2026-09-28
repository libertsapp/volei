// Lê as abas de uma planilha (Terça ou Meme) via Google Sheets API, autenticado como service account.
// Não faz nenhuma transformação de dado — devolve os valores crus, linha 0 = cabeçalho.
const { google } = require('googleapis');

const ABAS = [
  'Jogadores', 'Rodadas', 'Config', 'Checkins', 'Usuarios',
  'FinDias', 'FinPagamentos', 'FinCreditos', 'FinLancamentos', 'FinLog',
  'AoVivo', 'AoVivoLog'
];

async function autenticar() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// O Google responde 400 "Unable to parse range: <aba>" quando a aba não existe (o Meme nunca usou crédito, então não tem FinCreditos:
// o Apps Script só cria a aba na primeira gravação). Isso é dado vazio, não erro; qualquer outro erro continua subindo.
const abaInexistente = (e) => !!e && (e.code === 400 || e.status === 400) && /Unable to parse range/i.test(String(e.message || ''));

// "sheets" vem por injeção (o teste passa um falso)
async function lerAbas(sheets, spreadsheetId, abas = ABAS) {
  if (!spreadsheetId) throw new Error('ID da planilha não informado (SPREADSHEET_ID_TERCA ou SPREADSHEET_ID_MEME no .env)');
  const dados = {};
  const ausentes = [];
  for (const aba of abas) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: aba, valueRenderOption: 'FORMATTED_VALUE' });
      dados[aba] = resp.data.values || [];
    } catch (e) {
      if (!abaInexistente(e)) throw e;
      dados[aba] = [];
      ausentes.push(aba);
    }
  }
  return { dados, ausentes };
}

async function lerPlanilha(spreadsheetId) {
  const { dados, ausentes } = await lerAbas(await autenticar(), spreadsheetId);
  if (ausentes.length) console.log('Abas que não existem na planilha (tratadas como vazias): ' + ausentes.join(', '));
  return dados;
}

const lerPlanilhaTerca = () => lerPlanilha(process.env.SPREADSHEET_ID_TERCA);

module.exports = { lerPlanilha, lerPlanilhaTerca, lerAbas, ABAS };
