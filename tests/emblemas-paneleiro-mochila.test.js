// Emblemas 🍳 Paneleiro e 🎒 Mochila: a mesma pessoa não pode ficar com os dois. Quem cairia nos dois top 3 fica com o
// emblema em que tem MAIS vezes (empate: onde está mais bem colocado; empate de novo: Paneleiro) e a vaga do outro passa
// para o próximo daquela lista. Extrai a função do HTML.
// Rodar: node tests/emblemas-paneleiro-mochila.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('function escolherPaneleiroEMochila(');
assert.ok(ini > -1, 'escolherPaneleiroEMochila não encontrada');
const escolher = new Function(html.slice(ini, html.indexOf('\n}\n', ini) + 3) + '; return escolherPaneleiroEMochila;')();
const lista = (set) => [...set].sort();

// sem ninguém nas duas listas: cada emblema é o top 3 de sempre
let r = escolher({ a: 5, b: 4, c: 3, d: 1 }, { x: 6, y: 2, z: 1 }, 3);
assert.deepEqual(lista(r.paneleiro), ['a', 'b', 'c']);
assert.deepEqual(lista(r.mochila), ['x', 'y', 'z']);

// "a" está nos dois: 5x paneleiro > 2x mochila -> fica com 🍳; a vaga da 🎒 vai para o próximo (w, 4º da mochila)
r = escolher({ a: 5, b: 4, c: 3 }, { x: 6, y: 3, a: 2, w: 1 }, 3);
assert.deepEqual(lista(r.paneleiro), ['a', 'b', 'c']);
assert.deepEqual(lista(r.mochila), ['w', 'x', 'y']);

// ao contrário: "a" tem mais mochila (6x) que paneleiro (1x) -> fica com 🎒; o 4º do paneleiro (d) entra
r = escolher({ b: 4, c: 3, a: 1, d: 1 }, { a: 6, x: 2 }, 3);
assert.deepEqual(lista(r.paneleiro), ['b', 'c', 'd']);
assert.deepEqual(lista(r.mochila), ['a', 'x']);

// cascata: "a" fica com 🍳 e libera a vaga da 🎒 para "b", que também é paneleiro com mais vezes -> libera de novo para "w"
r = escolher({ a: 9, b: 8, c: 7 }, { x: 5, y: 4, a: 3, b: 2, w: 1 }, 3);
assert.deepEqual(lista(r.paneleiro), ['a', 'b', 'c']);
assert.deepEqual(lista(r.mochila), ['w', 'x', 'y']);

// empate de contagem: decide a colocação — "a" é 1º na mochila e 3º no paneleiro -> fica com 🎒
r = escolher({ p: 9, q: 8, a: 4, s: 1 }, { a: 4, x: 3 }, 3);
assert.deepEqual(lista(r.mochila), ['a', 'x']);
assert.deepEqual(lista(r.paneleiro), ['p', 'q', 's']);
// empate de contagem e de colocação (1º nos dois) -> fica com 🍳
r = escolher({ a: 4, p: 2 }, { a: 4, x: 1 }, 3);
assert.deepEqual(lista(r.paneleiro), ['a', 'p']);
assert.deepEqual(lista(r.mochila), ['x']);

// quem só estaria em UMA das listas não perde nada: "a" é 5º no paneleiro (fora do top 3) e 1º na mochila
r = escolher({ p: 9, q: 8, s: 7, t: 6, a: 5 }, { a: 1, x: 1 }, 3);
assert.deepEqual(lista(r.paneleiro), ['p', 'q', 's']);
assert.ok(r.mochila.has('a'));

// listas curtas ou vazias
r = escolher({}, {}, 3);
assert.equal(r.paneleiro.size + r.mochila.size, 0);
r = escolher({ a: 2 }, { a: 1 }, 3);
assert.deepEqual(lista(r.paneleiro), ['a']);
assert.equal(r.mochila.size, 0);

// 200 cenários aleatórios: as regras nunca são quebradas
function aleatorio(semente) {
  let s = semente;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
for (let caso = 1; caso <= 200; caso++) {
  const rnd = aleatorio(caso);
  const ids = Array.from({ length: 4 + Math.floor(rnd() * 10) }, (_, i) => 'j' + i);
  const pan = {}, moc = {};
  ids.forEach((id) => {
    if (rnd() < 0.7) pan[id] = 1 + Math.floor(rnd() * 6);
    if (rnd() < 0.6) moc[id] = 1 + Math.floor(rnd() * 6);
  });
  const { paneleiro, mochila } = escolher(pan, moc, 3);
  const msg = 'caso ' + caso + ' ' + JSON.stringify({ pan, moc });
  assert.ok(paneleiro.size <= 3 && mochila.size <= 3, msg);
  assert.equal([...paneleiro].filter((id) => mochila.has(id)).length, 0, 'alguém ficou com os dois — ' + msg);
  // percorrendo cada ranking: quem ficou de fora ANTES de completar as 3 vagas só pode estar no outro emblema,
  // e tem lá pelo menos tantas vezes quanto aqui (perdeu o emblema "menor")
  for (const [conta, outraConta, set, outro] of [[pan, moc, paneleiro, mochila], [moc, pan, mochila, paneleiro]]) {
    const ranking = Object.entries(conta).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    let pegos = 0;
    for (const id of ranking) {
      if (pegos >= 3) break;
      if (set.has(id)) { pegos++; continue; }
      assert.ok(outro.has(id), id + ' foi pulado sem ter o outro emblema — ' + msg);
      assert.ok(outraConta[id] >= conta[id], id + ' perdeu o emblema maior — ' + msg);
    }
    assert.equal(pegos, set.size, msg);
  }
}
console.log('ok — paneleiro e mochila nunca no mesmo jogador (casos + 200 sorteios)');
