// Testa a seção "Jogadores removidos" da aba Jogadores (só a lógica; DOM falso). Extrai o código direto do HTML.
// Rodar: node tests/jogadores-removidos.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// Removidos COM jogos');
const fim = html.indexOf('function renderPlayers(){');
assert.ok(ini > -1 && fim > ini, 'bloco dos removidos não encontrado');
const bloco = html.slice(ini, fim);
const iniRem = html.indexOf('async function removerJogadorDaLista(id){');
const removerFn = html.slice(iniRem, html.indexOf('\n}\n', iniRem) + 3);
assert.ok(iniRem > -1, 'removerJogadorDaLista não encontrada');

function cenario({ perfil = 'admin', postOk = true } = {}) {
  const els = {};
  const el = id => (els[id] ||= { style: {}, textContent: '', innerHTML: '', querySelectorAll: () => [] });
  const posts = [];
  const F = new Function('DATA', 'el', 'perfil', 'postOk', 'posts', `
    const document = { getElementById: el, querySelectorAll: () => [] };
    const temPermissao = a => a === 'restorePlayer' ? ['organizador','admin'].includes(perfil) : a === 'removePlayer' ? perfil === 'admin' : false;
    const roundsOficiais = () => DATA.rounds.filter(r => !r.rascunho);
    const sortByName = l => l.slice().sort((a, b) => a.nome.localeCompare(b.nome));
    const avatarHtml = () => '<av>'; const nomeComApelidoHtml = p => p.nome; const escapeHtml = s => s;
    const confirm = () => true; const requireAuth = async () => ({ senha: 'x' });
    const postAction = async (a, p) => { posts.push([a, p]); return postOk; };
    let renders = 0; const renderPlayers = () => { renders++; };
    ${bloco}
    ${removerFn}
    return { jogadoresRemovidosComJogos, renderJogadoresRemovidos, reativarJogadorRemovido, removerJogadorDaLista, renders: () => renders };
  `);
  const DATA = {
    players: [{ id: 'a', nome: 'Ana' }],
    removidos: [{ id: 'b', nome: 'Bia' }, { id: 'c', nome: 'Caio' }, { id: 'd', nome: 'Duda' }],
    rounds: [
      { id: 'r1', rascunho: false, times: [{ playerIds: ['a', 'b'] }, { playerIds: ['c'] }] },
      { id: 'r2', rascunho: false, times: [{ playerIds: ['b'] }] },
      { id: 'r3', rascunho: true, times: [{ playerIds: ['d'] }] } // rascunho não conta como jogo
    ]
  };
  return { DATA, els, el, posts, ...F(DATA, el, perfil, postOk, posts) };
}

// só os removidos COM jogos oficiais entram, com a contagem certa; Duda (só rascunho) fica de fora
let c = cenario();
assert.deepEqual(c.jogadoresRemovidosComJogos().map(x => [x.jogador.id, x.jogos]), [['b', 2], ['c', 1]]);

// admin e organizador veem; título com contagem; nome + jogos + botão Reativar
for (const perfil of ['admin', 'organizador']) {
  c = cenario({ perfil });
  c.renderJogadoresRemovidos();
  assert.equal(c.els['removidos-sec'].style.display, '');
  assert.equal(c.els['removidos-titulo'].textContent, 'Jogadores removidos (2)');
  assert.match(c.els['removidos-lista'].innerHTML, /Bia[\s\S]*2 partidas[\s\S]*data-restaurar="b"/);
  assert.match(c.els['removidos-lista'].innerHTML, /1 partida</);
}
// jogador comum / deslogado: seção escondida
c = cenario({ perfil: 'jogador' });
c.renderJogadoresRemovidos();
assert.equal(c.els['removidos-sec'].style.display, 'none');
// sem removidos com jogos: escondida também
c = cenario(); c.DATA.removidos = [{ id: 'd', nome: 'Duda' }];
c.renderJogadoresRemovidos();
assert.equal(c.els['removidos-sec'].style.display, 'none');

// reativar: sai de removidos, entra em players, manda a ação certa
(async () => {
  c = cenario();
  await c.reativarJogadorRemovido('b');
  assert.deepEqual(c.posts, [['restorePlayer', { id: 'b' }]]);
  assert.deepEqual(c.DATA.players.map(p => p.id), ['a', 'b']);
  assert.deepEqual(c.DATA.removidos.map(p => p.id), ['c', 'd']);
  // falha ao salvar: desfaz
  c = cenario({ postOk: false });
  await c.reativarJogadorRemovido('b');
  assert.deepEqual(c.DATA.players.map(p => p.id), ['a']);
  assert.deepEqual(c.DATA.removidos.map(p => p.id).sort(), ['b', 'c', 'd']);
  // remover jogador: já vai pra removidos; se falhar, volta
  c = cenario();
  await c.removerJogadorDaLista('a');
  assert.deepEqual(c.DATA.players, []);
  assert.ok(c.DATA.removidos.some(p => p.id === 'a'));
  c = cenario({ postOk: false });
  await c.removerJogadorDaLista('a');
  assert.deepEqual(c.DATA.players.map(p => p.id), ['a']);
  assert.ok(!c.DATA.removidos.some(p => p.id === 'a'));
  console.log('ok — jogadores removidos (aba Jogadores)');
})().catch(e => { console.error(e); process.exit(1); });
