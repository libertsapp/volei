import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ta, fim } from './executor.mjs';

const { lerAbas } = createRequire(import.meta.url)('../../scripts/lib/planilha.js');

// cliente falso do Sheets: values.get devolve o que está em "abas" ou lança o erro configurado
function sheetsFalso(abas, erros = {}) {
  const chamadas = [];
  return {
    chamadas,
    spreadsheets: { values: { get: async ({ spreadsheetId, range }) => {
      chamadas.push({ spreadsheetId, range });
      if (erros[range]) throw erros[range];
      return { data: { values: abas[range] } };
    } } }
  };
}
const erro400 = (aba) => Object.assign(new Error('Unable to parse range: ' + aba), { code: 400 });

await ta('lê cada aba com o ID pedido; aba sem valores vira lista vazia', async () => {
  const s = sheetsFalso({ Jogadores: [['id', 'nome'], ['1', 'ANA']], Rodadas: undefined });
  const { dados, ausentes } = await lerAbas(s, 'ID-MEME', ['Jogadores', 'Rodadas']);
  assert.deepEqual(dados.Jogadores, [['id', 'nome'], ['1', 'ANA']]);
  assert.deepEqual(dados.Rodadas, []);
  assert.deepEqual(ausentes, []);
  assert.deepEqual(s.chamadas.map((c) => c.spreadsheetId), ['ID-MEME', 'ID-MEME']);
});

await ta('aba que NÃO existe na planilha (400 "Unable to parse range", caso real do Meme: FinCreditos) vira vazia e é avisada', async () => {
  const s = sheetsFalso({ Jogadores: [['id']] }, { FinCreditos: erro400('FinCreditos') });
  const { dados, ausentes } = await lerAbas(s, 'X', ['Jogadores', 'FinCreditos']);
  assert.deepEqual(dados.FinCreditos, []);
  assert.deepEqual(ausentes, ['FinCreditos']);
  assert.deepEqual(dados.Jogadores, [['id']]);
});

await ta('outros erros (sem permissão, rede) NÃO são engolidos', async () => {
  const semPermissao = Object.assign(new Error('The caller does not have permission'), { code: 403 });
  await assert.rejects(() => lerAbas(sheetsFalso({}, { Jogadores: semPermissao }), 'X', ['Jogadores']), /permission/);
  const outro400 = Object.assign(new Error('Invalid value at range'), { code: 400 });
  await assert.rejects(() => lerAbas(sheetsFalso({}, { Jogadores: outro400 }), 'X', ['Jogadores']), /Invalid value/);
});

await ta('ID de planilha vazio é erro claro (não tenta ler "undefined")', async () => {
  await assert.rejects(() => lerAbas(sheetsFalso({}), '', ['Jogadores']), /ID da planilha/);
  await assert.rejects(() => lerAbas(sheetsFalso({}), undefined, ['Jogadores']), /ID da planilha/);
});

fim();
