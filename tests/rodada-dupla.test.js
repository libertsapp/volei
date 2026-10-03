// Rodada dupla (dois jogos no mesmo dia) no quadro de campeões do Início: jogos do dia mais recente na ordem em que foram
// lançados, campeões de cada jogo, "dobradinha" (campeão nos dois) e "Dias jogados" contando DATAS. Extrai o bloco
// <rodada-dupla-puro> do HTML. Rodar: node tests/rodada-dupla.test.js  (HTML_ARQUIVO=<caminho> roda contra outra página)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <rodada-dupla-puro>');
const fim = html.indexOf('// </rodada-dupla-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <rodada-dupla-puro> não encontrado');
const bloco = html.slice(ini, fim);

const jogadores = { a: { id: 'a', nome: 'Ana' }, b: { id: 'b', nome: 'Beto', apelido: 'Betão' }, c: { id: 'c', nome: 'Caio' }, d: { id: 'd', nome: 'Duda' }, e: { id: 'e', nome: 'Eva' }, f: { id: 'f', nome: 'Fred' } };
const api = new Function('jogadores', `
  const getPlayer = (id) => jogadores[id];
  const escapeHtml = (x) => String(x);
  const avatarHtml = (p) => '<img data-av="' + (p ? p.id : '?') + '">';
  const classeCorDoTime = (i) => 'time-cor-' + (i + 1);
  const formatDate = (d) => d.split('-').reverse().join('/');
  const toTimestamp = (d) => new Date(d).getTime();
  ${bloco}
  return { jogosDoDiaMaisRecente, campeoesDoJogo, dobradinhaDoDia, contarDiasJogados, quadroRodadaDuplaHtml, toTimestamp };`)(jogadores);

const r0 = { id: 'r0', data: '2026-09-29', vencedores: [0], times: [{ nome: 'Antigo', vitorias: 2, playerIds: ['a'] }] };
const r1 = { id: 'r1', data: '2026-10-06', vencedores: [0], times: [{ nome: 'Azul', vitorias: 3, playerIds: ['a', 'b'] }, { nome: 'Verde', vitorias: 1, playerIds: ['c', 'd'] }] };
const r2 = { id: 'r2', data: '2026-10-06', vencedores: [1], times: [{ nome: 'Preto', vitorias: 0, playerIds: ['c', 'e'] }, { nome: 'Branco', vitorias: 2, playerIds: ['a', 'f'] }] };

// jogos do dia mais recente, na ordem em que foram lançados (a ordem da lista); dias antigos ficam de fora
assert.deepEqual(api.jogosDoDiaMaisRecente([r0, r1, r2], api.toTimestamp).map((r) => r.id), ['r1', 'r2']);
assert.deepEqual(api.jogosDoDiaMaisRecente([r2, r0, r1], api.toTimestamp).map((r) => r.id), ['r2', 'r1']);
assert.deepEqual(api.jogosDoDiaMaisRecente([r0], api.toTimestamp).map((r) => r.id), ['r0']);
assert.deepEqual(api.jogosDoDiaMaisRecente([], api.toTimestamp), []);

// campeões de um jogo (empate = os dois times) e dobradinha (campeão em TODOS os jogos do dia)
assert.deepEqual(api.campeoesDoJogo(r1).map((t) => t.nome), ['Azul']);
assert.deepEqual(api.dobradinhaDoDia([r1, r2]), ['a']);
assert.deepEqual(api.dobradinhaDoDia([r1]), []);                                  // um jogo só: não existe dobradinha
assert.deepEqual(api.dobradinhaDoDia([r1, { ...r2, vencedores: [] }]), []);       // um jogo sem placar: ainda não
assert.deepEqual(api.dobradinhaDoDia([{ ...r1, vencedores: [0, 1] }, r2]), ['a']); // empate no 1º: vale qualquer time campeão

// "Dias jogados" conta datas, não rodadas
assert.equal(api.contarDiasJogados([r0, r1, r2]), 2);
assert.equal(api.contarDiasJogados([]), 0);

// o quadro: duas placas numeradas, costura ×2, dobradinha com anel dourado só em quem venceu os dois
let q = api.quadroRodadaDuplaHtml([r1, r2], 'Campeões da semana');
assert.equal((q.match(/class="sb-placa"/g) || []).length, 2);
assert.match(q, /Campeões da semana/);
assert.match(q, /06\/10\/2026 · 2 jogos/);
assert.match(q, /aria-hidden="true">01</);
assert.match(q, /aria-hidden="true">02</);
assert.match(q, /1º jogo/);
assert.match(q, /2º jogo/);
assert.match(q, /Azul/);
assert.match(q, /Branco/);
assert.doesNotMatch(q, /Verde|Preto/);                                            // só os campeões aparecem
assert.match(q, /×2/);
assert.match(q, /class="sb-dobradinha"[\s\S]*Dobradinha[\s\S]*Ana venceu os dois jogos/);
assert.equal((q.match(/sb-avatar-dobradinha[^>]*data-open-profile="a"/g) || []).length, 2); // Ana nas duas placas
assert.doesNotMatch(q, /sb-avatar-dobradinha[^>]*data-open-profile="(b|f)"/);
assert.match(q, /Ana, Betão/);                                                   // nomes (apelido quando tem) na placa
assert.match(q, /3 vitória\(s\) de partida/);
assert.match(q, /time-cor-1/);                                                   // Azul é o 1º time do 1º jogo
assert.match(q, /time-cor-2/);                                                   // Branco é o 2º time do 2º jogo

// um jogo ainda sem placar: a placa avisa e não há dobradinha
q = api.quadroRodadaDuplaHtml([r1, { ...r2, vencedores: [] }], 'Campeões da semana');
assert.match(q, /Aguardando placar/);
assert.doesNotMatch(q, /sb-dobradinha/);

// empate no 1º jogo: a placa mostra os dois times campeões
q = api.quadroRodadaDuplaHtml([{ ...r1, vencedores: [0, 1] }, r2], 'Campeões da semana');
assert.match(q, /Azul[\s\S]*Verde/);
assert.match(q, /empate/);
console.log('ok — rodada dupla (jogos do dia, dobradinha, dias jogados e quadro)');
