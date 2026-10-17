// Testa a coluna "Sequência" do cartão do jogador e a conta da sequência. Extrai o código direto do HTML,
// então testa exatamente o que vai pro ar. Rodar: node tests/jogador-card-sequencia.test.js
// (MEME=1 roda contra o HTML do Meme; o nome do arquivo dele já mudou várias vezes, então usa o primeiro que existir)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const nomesDoMeme = ['volei-meme-dashboard.html', 'volei-meme-dashboard - Copia.html', 'volei-meme-dashboard - Copia - Copia.html'];
const arquivo = process.env.MEME
  ? (nomesDoMeme.find(n => fs.existsSync(path.join(__dirname, '..', n))) || nomesDoMeme[0])
  : 'volei-dashboard.html';
const html = fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <jogador-card-puro>');
const fim = html.indexOf('// </jogador-card-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <jogador-card-puro> não encontrado');

// a função da sequência não está num bloco puro: pega só ela e injeta DATA/roundsOficiais/toTimestamp falsos
const iniSeq = html.indexOf('function computeSequenciaAtualPresenca(id){');
const fimSeq = html.indexOf('\n}\n', iniSeq) + 3;
assert.ok(iniSeq > -1 && fimSeq > iniSeq, 'computeSequenciaAtualPresenca não encontrada');

const S = new Function('rodadas', `
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roundsOficiais = () => rodadas;
  const toTimestamp = iso => new Date(iso).getTime();
` + html.slice(ini, fim) + html.slice(iniSeq, fimSeq) + `
  return { jogadorCardHtml, computeSequenciaAtualPresenca };
`);

let falhas = 0;
function t(nome, fn){
  try { fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

const rod = (data, ...ids) => ({ data, times: [{ playerIds: ids }] });
const card = (metricas) => S([]).jogadorCardHtml({ id:'p1', nome:'Ana', metricas }, { variante:'perfil' });
const rotulos = (h) => [...h.matchAll(/<span class="jc-rotulo">([^<]+)<\/span>/g)].map(m=> m[1]);

t('coluna Sequência vem entre Títulos e Aproveitamento', ()=>{
  const r = rotulos(card({ partidas:10, titulos:3, pct:30, vitorias:40, sequencia:4 }));
  assert.deepEqual(r.slice(0,4), ['Partidas','Títulos','Sequência','Aproveitamento']);
});
t('mostra o número da sequência', ()=>{
  assert.match(card({ partidas:10, titulos:3, pct:30, sequencia:7 }), /Sequência<\/span><span class="jc-valor">7</);
});
t('sequência 0 aparece como "0" (não some)', ()=>{
  assert.match(card({ partidas:10, titulos:3, pct:30, sequencia:0 }), /Sequência<\/span><span class="jc-valor">0</);
});
t('chamador antigo, sem "sequencia": a coluna não existe e o resto continua igual', ()=>{
  const r = rotulos(card({ partidas:10, titulos:3, pct:30 }));
  assert.deepEqual(r, ['Partidas','Títulos','Aproveitamento']);
});
t('--jc-cols acompanha o número de colunas', ()=>{
  assert.match(card({ partidas:10, titulos:3, pct:30, vitorias:40, sequencia:2 }), /--jc-cols:5/);
  assert.match(card({ partidas:10, titulos:3, pct:30 }), /--jc-cols:3/);
});

t('6 colunas (com estrelas) ganham a classe jc-seis; 5 ou menos não', ()=>{
  const com = S([]).jogadorCardHtml({ id:'p1', nome:'Ana', estrelas:4, metricas:{ partidas:10, titulos:3, pct:30, vitorias:40, sequencia:2 } }, { variante:'perfil' });
  assert.match(com, /jc-metricas jc-seis" style="--jc-cols:6"/);
  assert.doesNotMatch(card({ partidas:10, titulos:3, pct:30, vitorias:40, sequencia:2 }), /jc-seis/);
});

const seq = (rodadas, id) => S(rodadas).computeSequenciaAtualPresenca(id);
t('sequência conta as rodadas seguidas da mais recente pra trás', ()=>{
  const r = [rod('2026-09-01','a'), rod('2026-09-08','a'), rod('2026-09-15','a')];
  assert.equal(seq(r,'a'), 3);
});
t('para no primeiro buraco', ()=>{
  const r = [rod('2026-09-01','a'), rod('2026-09-08','b'), rod('2026-09-15','a'), rod('2026-09-22','a')];
  assert.equal(seq(r,'a'), 2);
});
t('faltou a rodada mais recente = 0', ()=>{
  const r = [rod('2026-09-01','a'), rod('2026-09-08','a'), rod('2026-09-15','b')];
  assert.equal(seq(r,'a'), 0);
});
t('ordem das rodadas na lista não importa (ordena por data)', ()=>{
  const r = [rod('2026-09-15','a'), rod('2026-09-01','a'), rod('2026-09-08','b')];
  assert.equal(seq(r,'a'), 1);
});
t('dia cancelado sem rodada não quebra a sequência', ()=>{
  // 08/09 cancelado: não existe rodada nessa data
  const r = [rod('2026-09-01','a'), rod('2026-09-15','a'), rod('2026-09-22','a')];
  assert.equal(seq(r,'a'), 3);
});

// dois jogos no mesmo dia (v19.0): conta por DATA — jogar pelo menos um mantém a sequência, os dois contam uma vez só
t('dois jogos no dia: jogou só um deles, a sequência continua', ()=>{
  const r = [rod('2026-09-01','a'), rod('2026-09-08','a'), rod('2026-09-08','b'), rod('2026-09-15','a')];
  assert.equal(seq(r,'a'), 3);
});
t('dois jogos no dia: jogou só o outro (o 2º), também continua', ()=>{
  const r = [rod('2026-09-01','a'), rod('2026-09-08','b'), rod('2026-09-08','a'), rod('2026-09-15','a')];
  assert.equal(seq(r,'a'), 3);
});
t('dois jogos no dia: jogou os dois, o dia conta uma vez só', ()=>{
  const r = [rod('2026-09-08','a'), rod('2026-09-08','a'), rod('2026-09-15','a')];
  assert.equal(seq(r,'a'), 2);
});
t('dois jogos no dia: não jogou nenhum, a sequência para', ()=>{
  const r = [rod('2026-09-01','a'), rod('2026-09-08','b'), rod('2026-09-08','b'), rod('2026-09-15','a')];
  assert.equal(seq(r,'a'), 1);
});
t('dois jogos no dia mais recente: jogou um, a sequência não zera', ()=>{
  const r = [rod('2026-09-08','a'), rod('2026-09-15','b'), rod('2026-09-15','a')];
  assert.equal(seq(r,'a'), 2);
});

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
process.exit(falhas ? 1 : 0);
