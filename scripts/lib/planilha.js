// Lê as abas da planilha do Terça via Google Sheets API, autenticado como service account.
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

async function lerPlanilhaTerca() {
  const sheets = await autenticar();
  const spreadsheetId = process.env.SPREADSHEET_ID_TERCA;
  const resultado = {};
  for (const aba of ABAS) {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: aba,
      valueRenderOption: 'FORMATTED_VALUE'
    });
    resultado[aba] = resp.data.values || [];
  }
  return resultado;
}

module.exports = { lerPlanilhaTerca, ABAS };
