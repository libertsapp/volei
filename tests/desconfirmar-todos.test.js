// Botão "Desconfirmar todos" do check-in (organizador/admin): remove todos os confirmados do dia aberto, inclusive a
// reserva, um por vez; não mexe em outras datas; quem falhar continua na lista. Extrai o bloco <desconfirmar-todos>.
// Rodar: node tests/desconfirmar-todos.test.js   (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <desconfirmar-todos>');
const fim = html.indexOf('// </desconfirmar-todos>');
assert.ok(ini > -1 && fim > ini, 'bloco <desconfirmar-todos> não encontrado');
const bloco = html.slice(ini, fim);
const iniP = html.indexOf('function podeColarListaDoGrupo(');
const podeColar = html.slice(iniP, html.indexOf('\n', iniP));

function ambiente({ falhar = [], perfil = 'organizador', logado = true, aberto = true, travado = false, checkins } = {}) {
  const posts = [];
  const el = {};
  const F = new Function('ctx', `
    const { posts, falhar, el } = ctx;
    const document = { getElementById: (id) => (el[id] ||= { id, hidden: false }) };
    const AUTH = { logado: ctx.logado, perfil: ctx.perfil };
    const SETTINGS = { checkinDataAberta: ctx.aberto ? '2026-10-06' : '', checkinTravado: ctx.travado };
    let CHECKINS = ctx.checkins;
    const credencialLogada = async () => ({ sessao: 'S1', idToken: '', senha: '' });
    const postAction = async (acao, payload) => { posts.push([acao, payload.id]); return !falhar.includes(payload.id); };
    ${podeColar}
    ${bloco}
    return { desconfirmarTodosDoDia, atualizarBotaoDesconfirmarTodos, checkins: () => CHECKINS };`);
  return { ...F({ posts, falhar, el, perfil, logado, aberto, travado, checkins: checkins || [
    { id: 'k1', data: '2026-10-06', jogadorId: 'a', jogadorNome: 'Ana' },
    { id: 'k2', data: '2026-09-29', jogadorId: 'b', jogadorNome: 'Beto' },   // outra data: fica
    { id: 'k3', data: '2026-10-06', jogadorId: 'c', jogadorNome: 'Caio' },
    { id: 'k4', data: '2026-10-06', jogadorId: 'd', jogadorNome: 'Duda' }    // reserva: sai também
  ] }), posts, el };
}

(async () => {
  let a = ambiente();
  let res = await a.desconfirmarTodosDoDia();
  assert.deepEqual(a.posts, [['removeCheckin', 'k1'], ['removeCheckin', 'k3'], ['removeCheckin', 'k4']]);
  assert.deepEqual(res, { removidos: 3, falhas: [] });
  assert.deepEqual(a.checkins().map((c) => c.id), ['k2']);

  // um falhou: ele continua na lista e é avisado; os outros saem
  a = ambiente({ falhar: ['k3'] });
  res = await a.desconfirmarTodosDoDia();
  assert.deepEqual(res, { removidos: 2, falhas: ['Caio'] });
  assert.deepEqual(a.checkins().map((c) => c.id), ['k2', 'k3']);

  // quem vê o botão: organizador/admin logado, check-in aberto e destravado, com alguém confirmado
  for (const [caso, escondido] of [[{}, false], [{ perfil: 'admin' }, false], [{ perfil: 'jogador' }, true], [{ logado: false }, true],
    [{ aberto: false }, true], [{ travado: true }, true], [{ checkins: [{ id: 'k2', data: '2026-09-29', jogadorId: 'b' }] }, true]]) {
    const t = ambiente(caso);
    t.atualizarBotaoDesconfirmarTodos();
    assert.equal(t.el['desconfirmar-todos-btn'].hidden, escondido, JSON.stringify(caso));
  }
  console.log('ok — desconfirmar todos do check-in');
})().catch((e) => { console.error(e); process.exit(1); });
