// Tendência do gráfico "Evolução do aproveitamento" (perfil): compara o ponto de AGORA com o da ANTEPENÚLTIMA rodada,
// não com o primeiro ponto — quem ganhou a estreia começava em 100% e aparecia "Piorando" para sempre (bug real, 2026-10).
// Verde se melhorou; vermelho em qualquer outro caso. Extrai o código do HTML.
// Rodar: node tests/aproveitamento-tendencia.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('function renderAproveitamentoChart(pontos){');
assert.ok(ini > -1, 'renderAproveitamentoChart não encontrada');
const codigo = html.slice(ini, html.indexOf('\n}\n', ini) + 3);
const render = new Function(`${codigo}; return renderAproveitamentoChart;`)();

const VERDE = '#5fd68a';
const VERMELHO = 'var(--danger)';
const grafico = (pcts) => render(pcts.map((pct, i) => ({ data: '2026-0' + (1 + (i % 9)) + '-01', pct })));
const corDaLinha = (saida) => (saida.match(/<polyline[^>]*stroke="([^"]+)"/) || [])[1];

// o caso do print: estreou com vitória (100%), afundou e depois voltou a subir — tem que aparecer MELHORANDO
let s = grafico([100, 60, 40, 20, 20, 40, 60]);
assert.match(s, /📈 Melhorando \(\+40 pontos\)/);     // antepenúltima (20) -> agora (60)
assert.match(s, /de 20% \(antepenúltima rodada\) pra 60% \(agora\)/);
assert.equal(corDaLinha(s), VERDE);
assert.doesNotMatch(s, /var\(--ball-yellow\)/);

// caiu em relação à antepenúltima: vermelho, mesmo tendo subido desde o começo
s = grafico([0, 20, 40, 80, 60, 40]);
assert.match(s, /📉 Piorando \(-40 pontos\)/);        // 80 -> 40
assert.match(s, /de 80% \(antepenúltima rodada\) pra 40% \(agora\)/);
assert.equal(corDaLinha(s), VERMELHO);

// igual à antepenúltima: não melhorou, então vermelho
s = grafico([100, 40, 40, 40]);
assert.match(s, /Sem melhora/);
assert.doesNotMatch(s, /Melhorando|Piorando/);
assert.equal(corDaLinha(s), VERMELHO);

// qualquer melhora conta (não existe mais a faixa de ±5 pontos)
s = grafico([40, 50, 43]);
assert.match(s, /📈 Melhorando \(\+3 pontos\)/);
assert.equal(corDaLinha(s), VERDE);

// só 2 rodadas: não existe antepenúltima, compara com a rodada anterior
s = grafico([100, 50]);
assert.match(s, /📉 Piorando \(-50 pontos\)/);
assert.match(s, /de 100% \(rodada anterior\) pra 50% \(agora\)/);

// menos de 2 rodadas: mensagem de sempre, sem gráfico
assert.match(grafico([100]), /precisa de pelo menos 2/);
console.log('ok — tendência do aproveitamento comparada com a antepenúltima rodada');
