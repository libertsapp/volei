// Telas do modo grupo: indisponível não tenta de novo nem usa cópia velha. Rodar: node tests/grupo-telas.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const bloco = html.slice(html.indexOf('// <grupo-puro>'), html.indexOf('// </grupo-puro>'));
const { respostaDeGrupoIndisponivel } = new Function(bloco + 'return { respostaDeGrupoIndisponivel };')();

assert.equal(respostaDeGrupoIndisponivel({ error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' }), 'grupo_inexistente');
assert.equal(respostaDeGrupoIndisponivel({ error: 'Grupo indisponível.', codigo: 'grupo_suspenso' }), 'grupo_suspenso');
assert.equal(respostaDeGrupoIndisponivel({ error: 'Erro interno no servidor.' }), null);
assert.equal(respostaDeGrupoIndisponivel({ players: [] }), null);
assert.equal(respostaDeGrupoIndisponivel(null), null);

// a busca inicial devolve na hora (sem 3 tentativas) quando o grupo não existe
const ini = html.indexOf('async function buscarDadosComNovasTentativas(){');
const corpo = html.slice(ini, html.indexOf('\n}\n', ini));
assert.match(corpo, /respostaDeGrupoIndisponivel\(json\)\) return json;/);
// e o loadData mostra a tela própria em vez de cópia guardada
assert.match(html, /const indisponivel = respostaDeGrupoIndisponivel\(json\);\n\s+if\(indisponivel\)\{ mostrarTelaGrupo\(indisponivel\); return; \}/);
console.log('TODOS OS TESTES PASSARAM');
