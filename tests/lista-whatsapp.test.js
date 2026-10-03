// Check-in pela lista colada do WhatsApp: ler a lista, reconhecer cada nome (nome ou apelido, sem acento/maiúscula; ou o
// 1º nome quando só um jogador bate), montar a conferência e confirmar NA ORDEM da lista. Extrai o bloco
// <lista-whatsapp-puro> do HTML. Rodar: node tests/lista-whatsapp.test.js  (HTML_ARQUIVO=<caminho> p/ outra página)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <lista-whatsapp-puro>');
const fim = html.indexOf('// </lista-whatsapp-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <lista-whatsapp-puro> não encontrado');
const bloco = html.slice(ini, fim);
const puras = new Function(bloco + '; return { lerListaDoGrupo, normalizarNomeLista, casarNomeComJogador, montarConferencia, escolhasDaConferencia };')();

// ---- leitura da lista ----
const listaDoUsuario = '1-Biel \n2-Michel \n3-Elen\n4-Vivi\n5-Sara \n6- Cássia \n7- Bruno\n8- Warley \n9- Marcelo\n10-Dudu\n11-Heleno\n12- João \n13- Maria \n14- Daniel \n15-Gustavo bombadão \n16-rit';
assert.deepEqual(puras.lerListaDoGrupo(listaDoUsuario), ['Biel', 'Michel', 'Elen', 'Vivi', 'Sara', 'Cássia', 'Bruno', 'Warley', 'Marcelo', 'Dudu', 'Heleno', 'João', 'Maria', 'Daniel', 'Gustavo bombadão', 'rit']);
// cabeçalho e rodapé do grupo são ignorados quando a lista é numerada; outros formatos de número também valem
assert.deepEqual(puras.lerListaDoGrupo('🏐 VÔLEI DE TERÇA 30/09 20h\n\n1) Ana ✅\n2. Beto\n3 – Caio\n\nPix: 123'), ['Ana ✅', 'Beto', 'Caio']);
// lista sem números: cada linha com letras é um nome
assert.deepEqual(puras.lerListaDoGrupo('Ana\n\n  Beto  \n---\n'), ['Ana', 'Beto']);
assert.deepEqual(puras.lerListaDoGrupo(''), []);
assert.equal(puras.normalizarNomeLista('  Cássia  ✅ '), 'cassia');
assert.equal(puras.normalizarNomeLista('Gustavo   Bombadão'), 'gustavo bombadao');

// ---- reconhecimento ----
const jogadores = [
  { id: 'biel', nome: 'Gabriel', apelido: 'BIEL' }, { id: 'cassia', nome: 'CASSIA', apelido: '' },
  { id: 'iza', nome: 'Maria', apelido: 'IZA' }, { id: 'marcelo', nome: 'MARCELO', apelido: '' },
  { id: 'joao1', nome: 'João Paulo', apelido: '' }, { id: 'joao2', nome: 'João Victor', apelido: '' },
  { id: 'heleno', nome: 'Heleno Villela', apelido: 'HELENO' }, { id: 'rit', nome: 'Rita', apelido: 'RIT' }
];
const removidos = [{ id: 'vivi', nome: 'VIVI', apelido: '' }, { id: 'gustavo', nome: 'GUSTAVO', apelido: '' }];
const casar = (n) => puras.casarNomeComJogador(n, jogadores, removidos);
assert.deepEqual([casar('Biel').tipo, casar('Biel').jogador.id], ['unico', 'biel']);       // pelo apelido
assert.equal(casar('Cássia').jogador.id, 'cassia');                                          // sem acento
assert.equal(casar('Maria').jogador.id, 'iza');                                              // pelo nome do cadastro
assert.equal(casar('rit').jogador.id, 'rit');
assert.equal(casar('Heleno').jogador.id, 'heleno');
let r = casar('Marcelo Silva');                                                              // só o 1º nome bate, e com um só
assert.equal(r.tipo, 'unico');
assert.equal(r.jogador.id, 'marcelo');
assert.equal(r.peloPrimeiroNome, true);
r = casar('João');                                                                           // dois "João": você escolhe
assert.equal(r.tipo, 'varios');
assert.deepEqual(r.candidatos.map((p) => p.id).sort(), ['joao1', 'joao2']);
assert.deepEqual([casar('Vivi').tipo, casar('Vivi').jogador.id], ['removido', 'vivi']);
assert.deepEqual([casar('Gustavo bombadão').tipo, casar('Gustavo bombadão').jogador.id], ['removido', 'gustavo']);
assert.equal(casar('Michel').tipo, 'nenhum');
assert.equal(casar('Elen').tipo, 'nenhum');                                                  // nada de "parecido" (Heleno)

// ---- conferência ----
const linhas = puras.montarConferencia(['Biel', 'Heleno', 'Michel', 'Biel', 'Vivi'], jogadores, removidos, new Set(['heleno']));
assert.deepEqual(linhas.map((l) => l.tipo), ['unico', 'unico', 'nenhum', 'unico', 'removido']);
assert.deepEqual(linhas.map((l) => !!l.jaConfirmado), [false, true, false, false, false]);
assert.deepEqual(linhas.map((l) => !!l.repetido), [false, false, false, true, false]);      // o 2º "Biel" não conta de novo
// valor inicial de cada linha: reconhecido -> o jogador; removido -> reativar; sem cadastro -> convidado; dúvida/repetido/já confirmado -> nada
assert.deepEqual(linhas.map((l) => l.escolhaInicial), ['p:biel', '', 'g', '', 'r:vivi']);

// ---- escolhas (o que cada linha vai virar) ----
assert.deepEqual(
  puras.escolhasDaConferencia(linhas, ['p:biel', '', 'g', '', 'r:vivi']),
  [{ texto: 'Biel', acao: 'jogador', id: 'biel' }, { texto: 'Michel', acao: 'convidado' }, { texto: 'Vivi', acao: 'reativar', id: 'vivi' }]
);
// trocar a escolha de uma linha (ex.: o "João" escolhido à mão) e ignorar outra
assert.deepEqual(puras.escolhasDaConferencia(linhas, ['', '', 'p:joao2', '', '']), [{ texto: 'Michel', acao: 'jogador', id: 'joao2' }]);
console.log('ok — lista do WhatsApp: leitura, reconhecimento, conferência e escolhas');

// ---- confirmar em sequência (o código de verdade, com servidor falso) ----
const iniC = html.indexOf('async function confirmarListaDoGrupo(');
assert.ok(iniC > -1, 'confirmarListaDoGrupo não encontrada');
const confirmarSrc = html.slice(iniC, html.indexOf('\n}\n', iniC) + 3);
function ambiente({ falhar = [] } = {}) {
  const posts = [];
  const F = new Function('ctx', `
    const { posts, falhar } = ctx;
    let CHECKINS = [{ id: 'k0', data: '2026-10-06', jogadorId: 'heleno', jogadorNome: 'HELENO' }];
    const GUESTS = [];
    const DATA = { players: ${JSON.stringify(jogadores)}, removidos: ${JSON.stringify(removidos)} };
    const SETTINGS = { checkinDataAberta: '2026-10-06' };
    let n = 0; const uid = () => 'id' + (++n);
    const getPlayer = (id) => DATA.players.find((p) => p.id === id) || GUESTS.find((g) => g.id === id);
    const credencialLogada = async () => ({ sessao: 'S1', idToken: '', senha: '' });
    const requireAuth = async () => ({ sessao: 'S1', idToken: '', senha: '' });
    const postAction = async (acao, payload) => {
      posts.push([acao, acao === 'addCheckin' ? payload.checkin.jogadorId : payload.id]);
      const alvo = acao === 'addCheckin' ? payload.checkin.jogadorNome : payload.id;
      return !falhar.includes(alvo);
    };
    const aoProgresso = () => {};
    ${confirmarSrc}
    return { confirmarListaDoGrupo, estado: () => ({ CHECKINS, GUESTS, DATA }) };`);
  return { ...F({ posts, falhar }), posts };
}
(async () => {
  let a = ambiente();
  let res = await a.confirmarListaDoGrupo([
    { texto: 'Biel', acao: 'jogador', id: 'biel' },
    { texto: 'Vivi', acao: 'reativar', id: 'vivi' },
    { texto: 'Michel', acao: 'convidado' },
    { texto: 'Heleno', acao: 'jogador', id: 'heleno' },          // já estava confirmado: pula, sem chamar o servidor
    { texto: 'Biel de novo', acao: 'jogador', id: 'biel' }        // escolhido duas vezes: só a 1ª conta
  ]);
  assert.deepEqual(a.posts, [['addCheckin', 'biel'], ['restorePlayer', 'vivi'], ['addCheckin', 'vivi'], ['addCheckin', a.estado().GUESTS[0].id]]);
  assert.deepEqual(res, { confirmados: 3, pulados: 2, falhas: [] });
  const ck = a.estado().CHECKINS;
  assert.deepEqual(ck.map((c) => c.jogadorNome), ['HELENO', 'BIEL', 'VIVI', 'Michel']);    // na ordem da lista
  assert.ok(a.estado().DATA.players.some((p) => p.id === 'vivi'));                         // reativada volta pra lista
  assert.ok(!a.estado().DATA.removidos.some((p) => p.id === 'vivi'));
  assert.equal(a.estado().GUESTS[0].nome, 'Michel');

  // falhou um: desfaz só aquele, segue com os outros e devolve quem falhou
  a = ambiente({ falhar: ['MARCELO'] });
  res = await a.confirmarListaDoGrupo([{ texto: 'Marcelo', acao: 'jogador', id: 'marcelo' }, { texto: 'Rit', acao: 'jogador', id: 'rit' }]);
  assert.deepEqual(res, { confirmados: 1, pulados: 0, falhas: ['Marcelo'] });
  assert.deepEqual(a.estado().CHECKINS.map((c) => c.jogadorId), ['heleno', 'rit']);
  // reativação recusada: não confirma aquele nome
  a = ambiente({ falhar: ['vivi'] });
  res = await a.confirmarListaDoGrupo([{ texto: 'Vivi', acao: 'reativar', id: 'vivi' }]);
  assert.deepEqual(res, { confirmados: 0, pulados: 0, falhas: ['Vivi'] });
  assert.deepEqual(a.posts, [['restorePlayer', 'vivi']]);
  console.log('ok — lista do WhatsApp: confirmação em sequência');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- a tela da conferência (código de verdade, página mínima) ----
{
  const iniT = html.indexOf('// --- tela da lista colada');
  const fimT = html.indexOf("document.getElementById('lista-grupo-conferir-btn')");
  assert.ok(iniT > -1 && fimT > iniT, 'trecho da tela da lista não encontrado');
  const tela = html.slice(iniT, fimT);
  function montarTela({ perfil = 'organizador', logado = true, aberto = true, travado = false } = {}) {
    const el = {};
    const F = new Function('ctx', `
      const el = ctx.el;
      const document = {
        getElementById: (id) => (el[id] ||= { id, innerHTML: '', style: {}, value: '', textContent: '', disabled: false, addEventListener() {}, querySelectorAll: () => [] }),
        querySelector: () => null
      };
      const AUTH = { logado: ctx.logado, perfil: ctx.perfil };
      const SETTINGS = { checkinDataAberta: ctx.aberto ? '2026-10-06' : '', checkinTravado: ctx.travado };
      const DATA = { players: ${JSON.stringify(jogadores)}, removidos: ${JSON.stringify(removidos)} };
      const escapeHtml = (x) => String(x);
      const sortByName = (l) => l.slice().sort((a, b) => (a.apelido || a.nome).localeCompare(b.apelido || b.nome));
      ${bloco}
      ${tela}
      return { atualizarBlocoListaGrupo, renderConferenciaListaGrupo, montarConferencia, definirLinhas: (l) => { LISTA_GRUPO_LINHAS = l; } };`);
    return { ...F({ el, perfil, logado, aberto, travado }), el };
  }
  // o bloco só aparece para organizador/admin logado, com check-in aberto e destravado
  for (const [caso, esperado] of [[{}, ''], [{ perfil: 'admin' }, ''], [{ perfil: 'jogador' }, 'none'], [{ logado: false }, 'none'], [{ aberto: false }, 'none'], [{ travado: true }, 'none']]) {
    const t = montarTela(caso);
    t.atualizarBlocoListaGrupo();
    assert.equal(t.el['lista-grupo-bloco'].style.display, esperado, JSON.stringify(caso));
  }
  // cada linha já vem com a escolha certa marcada
  const t = montarTela();
  t.definirLinhas(t.montarConferencia(['Biel', 'Heleno', 'Michel', 'João', 'Vivi'], jogadores, removidos, new Set(['heleno'])));
  t.renderConferenciaListaGrupo();
  const linhasHtml = t.el['lista-grupo-conferencia'].innerHTML.split('<li ').slice(1);
  assert.equal(linhasHtml.length, 5);
  assert.match(linhasHtml[0], /value="p:biel" selected/);
  assert.doesNotMatch(linhasHtml[1], /<select/);                       // Heleno já confirmado: nada a escolher
  assert.match(linhasHtml[1], /já está confirmado/);
  assert.match(linhasHtml[2], /value="g" selected>Adicionar como convidado: Michel/);
  assert.match(linhasHtml[3], /value="" selected>Ignorar/);             // dois João: ninguém marcado até você escolher
  assert.match(linhasHtml[3], /<optgroup label="Possíveis">.*João Paulo.*João Victor/s);
  assert.match(linhasHtml[4], /value="r:vivi" selected>Reativar e confirmar VIVI/);
  console.log('ok — lista do WhatsApp: tela da conferência e quem vê o bloco');
}
