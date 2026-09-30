// Leitura inicial do app: novas tentativas quando o servidor falha e cópia dos últimos dados no aparelho.
// Extrai o código direto do HTML. Rodar: node tests/leitura-inicial.test.js   (HTML_ARQUIVO=<caminho> testa outra página)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('async function buscarDadosComNovasTentativas(){');
const fim = html.indexOf('async function loadData(){');
assert.ok(ini > -1 && fim > ini, 'bloco da leitura inicial não encontrado');
const bloco = html.slice(ini, fim);

function ambiente(respostas) {
  const guardado = {};
  const localStorage = { getItem: k => (k in guardado ? guardado[k] : null), setItem: (k, v) => { guardado[k] = String(v); } };
  let chamadas = 0;
  const fetch = async () => {
    const r = respostas[chamadas++];
    if (r === 'rede') throw new TypeError('Failed to fetch');
    return { json: async () => r };
  };
  const esperas = [];
  const setTimeout = (fn, ms) => { esperas.push(ms); fn(); };
  const F = new Function('fetch', 'localStorage', 'setTimeout', `
    const SHEET_API_URL = 'x'; const console = { error(){} };
    let DATA, SETTINGS, PERFIS_PUBLICOS, CHECKINS, FINANCEIRO;
    const finNormalizar = f => f || {}; const reconstituirConvidadosDosCheckins = () => {};
    ${bloco}
    return { buscarDadosComNovasTentativas, salvarCopiaDosDados, lerCopiaDosDados, aplicarDados, dados: () => ({ DATA, CHECKINS }), chaveCopia: CHAVE_COPIA_DADOS };`);
  return { ...F(fetch, localStorage, setTimeout), chamadas: () => chamadas, esperas, guardado };
}
const BOM = { players: [{ id: 'p1' }], rounds: [], checkins: [{ id: 'c1' }], financeiro: { dias: [1] } };

(async () => {
  // falha passageira (erro do servidor, depois rede) e acerta na 3ª
  let a = ambiente([{ error: 'Erro interno no servidor.' }, 'rede', BOM]);
  assert.deepEqual(await a.buscarDadosComNovasTentativas(), BOM);
  assert.equal(a.chamadas(), 3);
  assert.deepEqual(a.esperas, [1000, 2000]);
  // de primeira: uma chamada só, sem esperar
  a = ambiente([BOM]);
  assert.deepEqual(await a.buscarDadosComNovasTentativas(), BOM);
  assert.deepEqual(a.esperas, []);
  // falha nas 3: desiste e devolve null (nunca uma 4ª tentativa)
  a = ambiente([{ error: 'x' }, 'rede', { error: 'y' }, BOM]);
  assert.equal(await a.buscarDadosComNovasTentativas(), null);
  assert.equal(a.chamadas(), 3);
  // cópia: guarda sem o financeiro e lê de volta; cópia corrompida vira null
  a = ambiente([]);
  a.salvarCopiaDosDados(BOM);
  const c = a.lerCopiaDosDados();
  assert.deepEqual(c.dados.players, BOM.players);
  assert.equal('financeiro' in c.dados, false);
  assert.ok(Math.abs(c.salvoEm - Date.now()) < 5000);
  a.guardado[a.chaveCopia] = '{quebrado';
  assert.equal(a.lerCopiaDosDados(), null);
  assert.equal(ambiente([]).lerCopiaDosDados(), null); // aparelho sem cópia
  // aplicarDados a partir da cópia (sem financeiro) não quebra
  a.aplicarDados(c.dados);
  assert.deepEqual(a.dados().CHECKINS, BOM.checkins);
  console.log('ok — leitura inicial (novas tentativas + cópia no aparelho)');
})().catch(e => { console.error(e); process.exit(1); });
