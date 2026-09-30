// Ligações da sessão do app no resto da página: guardar/restaurar/sair, requireAuth, postAction, envio de foto e a lista
// de usuários em silêncio (aviso de pendentes). Um erro aqui derrubaria o login no ar sem nenhum outro teste perceber.
// Extrai o código do HTML. Rodar: node tests/sessao-front-ligacoes.test.js
// (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o index.html do Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');

function pegar(inicio, antesDe) {
  const i = html.indexOf(inicio);
  assert.ok(i > -1, 'não encontrei: ' + inicio);
  const f = html.indexOf(antesDe, i);
  assert.ok(f > i, 'não encontrei o fim de: ' + inicio);
  return html.slice(i, f);
}
const funcao = (inicio) => pegar(inicio, '\n}\n') + '\n}\n';
const blocoSessao = pegar('// <sessao-front>', '// </sessao-front>');
const guardarSair = pegar('function salvarSessaoAuth(){', '// ID Token do Google dura ~1h');
const requireAuthSrc = funcao('async function requireAuth(');
const postActionSrc = funcao('async function postAction(');
const uploadPhotoSrc = funcao('async function uploadPhoto(');
const carregarUsuariosSrc = funcao('async function carregarUsuarios(');

let falhas = 0;
async function t(nome, fn) {
  try { await fn(); console.log('ok    -', nome); } catch (e) { falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

// Página "de mentira": localStorage em memória, fetch que grava o corpo e devolve respostas planejadas ('rede' = falha de
// conexão), e espiões no lugar da interface (toast, alert, modal da senha, renovação do Google).
function pagina({ auth = {}, guardado = {}, respostas = [], senhaCacheada = '', podePerfil = () => true, garantir = async () => null } = {}) {
  const posts = [], toasts = [], espioes = { pedirSenha: 0, garantir: 0, alert: [] };
  const F = new Function('ctx', `
    const { posts, toasts, espioes, respostas, guardado } = ctx;
    let AUTH = Object.assign({ idToken:'', exp:0, email:'', nome:'', foto:'', perfil:'', jogadorId:'', jogadorIdPendente:'', logado:false, aoRenovar:null, sessao:'', sessaoExpiraEm:'' }, ctx.auth);
    const SHEET_API_URL = 'x'; const sheetReady = true; const console = { error(){} };
    const localStorage = { getItem: (k) => (k in guardado ? guardado[k] : null), setItem: (k, v) => { guardado[k] = String(v); }, removeItem: (k) => { delete guardado[k]; } };
    const fetch = async (u, o) => { posts.push(JSON.parse(o.body)); const r = respostas.shift(); if (r === 'rede') throw new TypeError('Failed to fetch'); return { json: async () => r || { status: 'ok' } }; };
    const mostrarToast = (m) => toasts.push(m); const alert = (m) => espioes.alert.push(m); const confirm = () => true;
    const atualizarStatusAuth = () => {}; const aplicarPermissoesUI = () => {}; const renderAll = () => {};
    const updateAdminStatusBtn = () => {}; const clearCachedPassword = () => {}; const setCachedPassword = () => {};
    const getCachedPassword = () => ctx.senhaCacheada; const podePerfil = ctx.podePerfil;
    const garantirTokenFresco = async () => { espioes.garantir++; return ctx.garantir(); };
    const tokenExpirado = () => !(AUTH.exp && AUTH.exp * 1000 - Date.now() > 120000);
    const pedirSenhaModal = async () => { espioes.pedirSenha++; return null; };
    const mostrarCarregando = () => {}; const esconderCarregando = () => {};
    const resizeImageToBase64 = async () => 'BASE64';
    let ULTIMA_RESPOSTA_POST = null;
    ${blocoSessao}
    ${guardarSair}
    ${requireAuthSrc}
    ${postActionSrc}
    ${uploadPhotoSrc}
    ${carregarUsuariosSrc}
    return { salvarSessaoAuth, restaurarSessaoAuth, sairDaConta, requireAuth, postAction, uploadPhoto, carregarUsuarios, auth: () => AUTH };`);
  return { ...F({ auth, guardado, respostas, posts, toasts, espioes, senhaCacheada, podePerfil, garantir }), posts, toasts, espioes, guardado };
}
const umInstante = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  await t('guardar e restaurar: a sessão sobrevive a fechar o app, mesmo sem token do Google', async () => {
    const guardado = {};
    pagina({ auth: { logado: true, email: 'a@exemplo.com', perfil: 'admin', sessao: 'S1', sessaoExpiraEm: '2026-12-29T15:00:00.000Z' }, guardado }).salvarSessaoAuth();
    const b = pagina({ guardado });
    b.restaurarSessaoAuth();
    assert.equal(b.auth().logado, true);
    assert.equal(b.auth().sessao, 'S1');
    assert.equal(b.auth().sessaoExpiraEm, '2026-12-29T15:00:00.000Z');
    assert.equal(b.auth().email, 'a@exemplo.com');
  });

  await t('sair: avisa o servidor (ação sair com a sessão) e limpa o aparelho', async () => {
    const a = pagina({ auth: { logado: true, sessao: 'S1' }, guardado: { 'volei-auth-v1': '{}' } });
    a.sairDaConta(false);
    await umInstante();
    assert.deepEqual(a.posts, [{ action: 'sair', sessao: 'S1' }]);
    assert.equal(a.auth().logado, false);
    assert.equal(a.auth().sessao, '');
    assert.equal('volei-auth-v1' in a.guardado, false);
  });

  await t('sair sem internet: o aparelho sai mesmo assim, sem erro solto', async () => {
    const a = pagina({ auth: { logado: true, sessao: 'S1' }, respostas: ['rede'] });
    a.sairDaConta(false);
    await umInstante();
    assert.equal(a.auth().logado, false);
  });

  await t('requireAuth com sessão: devolve a sessão sem pedir nada ao Google nem a senha', async () => {
    const a = pagina({ auth: { logado: true, perfil: 'organizador', sessao: 'S1' } });
    assert.deepEqual(await a.requireAuth('addPlayer'), { sessao: 'S1', idToken: '', senha: '' });
    assert.equal(a.espioes.garantir, 0);
    assert.equal(a.espioes.pedirSenha, 0);
  });

  await t('requireAuth com chave mestra guardada e perfil sem permissão: manda a senha E a sessão', async () => {
    const a = pagina({ auth: { logado: true, perfil: 'jogador', sessao: 'S1' }, senhaCacheada: 'CHAVE', podePerfil: () => false });
    assert.deepEqual(await a.requireAuth('removePlayer'), { idToken: '', senha: 'CHAVE', sessao: 'S1' });
  });

  await t('postAction manda a sessão no corpo', async () => {
    const a = pagina({ auth: { logado: true, sessao: 'S1' } });
    assert.equal(await a.postAction('addPlayer', { player: { id: 'p1' } }, { sessao: 'S1', idToken: '', senha: '' }), true);
    assert.equal(a.posts[0].action, 'addPlayer');
    assert.equal(a.posts[0].sessao, 'S1');
  });

  await t('postAction com "sessão expirou": sai da conta e avisa', async () => {
    const a = pagina({ auth: { logado: true, sessao: 'S1' }, respostas: [{ error: 'Sua sessão expirou. Entre com o Google de novo.' }] });
    assert.equal(await a.postAction('addPlayer', {}, { sessao: 'S1', idToken: '', senha: '' }), false);
    assert.equal(a.auth().logado, false);
    assert.equal(a.auth().sessao, '');
    assert.equal(a.toasts.length, 1);
  });

  await t('postAction com banco fora do ar ao conferir a sessão: NÃO sai da conta', async () => {
    const a = pagina({ auth: { logado: true, sessao: 'S1' }, respostas: [{ error: 'Não foi possível conferir sua sessão agora. Tente de novo.' }] });
    assert.equal(await a.postAction('addPlayer', {}, { sessao: 'S1', idToken: '', senha: '' }), false);
    assert.equal(a.auth().logado, true);
    assert.equal(a.auth().sessao, 'S1');
    assert.equal(a.toasts.length, 1);
  });

  await t('envio de foto manda a sessão', async () => {
    const a = pagina({ auth: { logado: true, sessao: 'S1' }, respostas: [{ url: 'https://x/f.jpg' }] });
    assert.equal(await a.uploadPhoto({ name: 'foto.png' }, { sessao: 'S1', idToken: '', senha: '' }, ''), 'https://x/f.jpg');
    assert.equal(a.posts[0].action, 'uploadPhoto');
    assert.equal(a.posts[0].sessao, 'S1');
  });

  await t('lista de usuários em silêncio (aviso de pendentes) funciona com a sessão, sem token do Google', async () => {
    const a = pagina({ auth: { logado: true, perfil: 'organizador', sessao: 'S1', idToken: '', exp: 0 }, respostas: [{ usuarios: [{ email: 'x@exemplo.com' }] }] });
    assert.deepEqual(await a.carregarUsuarios(true), [{ email: 'x@exemplo.com' }]);
    assert.equal(a.posts[0].action, 'listarUsuarios');
    assert.equal(a.posts[0].sessao, 'S1');
  });

  await t('lista de usuários em silêncio sem sessão nem token válido: não chama o servidor', async () => {
    const a = pagina({ auth: { logado: true, perfil: 'organizador', sessao: '', idToken: 'G', exp: 1 } });
    assert.equal(await a.carregarUsuarios(true), null);
    assert.equal(a.posts.length, 0);
  });

  // Área da conta (modal do chip): qual botão faz o quê. DOM mínimo: o overlay guarda o ouvinte de clique.
  function modal({ auth, confirmar = true }) {
    const chamadas = { sair: [], todos: 0, removido: 0 };
    let overlay = null;
    const F = new Function('ctx', `
      const { chamadas } = ctx;
      const AUTH = ctx.auth;
      const escapeHtml = (x) => String(x);
      const confirm = () => ctx.confirmar;
      const sairDaConta = (silencioso) => { chamadas.sair.push(silencioso); };
      const sairDeTodosOsAparelhos = async () => { chamadas.todos++; return true; };
      const textoValidadeSessao = (iso) => (iso ? 'Conectado neste aparelho até 29/12/2026' : '');
      const document = {
        createElement: () => { const el = { className: '', innerHTML: '', ouvinte: null, addEventListener: (ev, fn) => { el.ouvinte = fn; }, remove: () => { chamadas.removido++; } }; ctx.criado(el); return el; },
        body: { appendChild: () => {} }
      };
      ${funcao('function abrirAreaDaConta(){')}
      return abrirAreaDaConta;`);
    const abrir = F({ auth, confirmar, chamadas, criado: (el) => { overlay = el; } });
    abrir();
    // clicar(acao): botão com data-acao; clicar(null): fundo escuro (o próprio overlay); clicar(''): dentro do cartão
    const clicar = (acao) => overlay.ouvinte({ target: acao === null ? overlay : { dataset: acao ? { acao } : {} } });
    return { overlay, clicar, chamadas };
  }

  await t('área da conta: mostra e-mail, perfil e validade; "sair de todos" só aparece com sessão do app', async () => {
    const m = modal({ auth: { email: 'a@exemplo.com', perfil: 'admin', sessao: 'S1', sessaoExpiraEm: '2026-12-29T15:00:00.000Z' } });
    assert.match(m.overlay.innerHTML, /a@exemplo\.com/);
    assert.match(m.overlay.innerHTML, /ADMIN/);
    assert.match(m.overlay.innerHTML, /Conectado neste aparelho até 29\/12\/2026/);
    assert.match(m.overlay.innerHTML, /data-acao="todos"/);
    const antigo = modal({ auth: { email: 'a@exemplo.com', perfil: 'admin', sessao: '' } });
    assert.doesNotMatch(antigo.overlay.innerHTML, /data-acao="todos"/);
  });

  await t('área da conta: Sair sai (não silencioso); Fechar e o fundo só fecham; clicar no cartão não fecha', async () => {
    const auth = { email: 'a@exemplo.com', perfil: 'admin', sessao: 'S1' };
    let m = modal({ auth });
    await m.clicar('sair');
    assert.deepEqual(m.chamadas.sair, [false]);
    assert.equal(m.chamadas.removido, 1);
    m = modal({ auth });
    await m.clicar('fechar');
    assert.deepEqual(m.chamadas.sair, []);
    assert.equal(m.chamadas.removido, 1);
    m = modal({ auth });
    await m.clicar(null);
    assert.equal(m.chamadas.removido, 1);
    m = modal({ auth });
    await m.clicar('');
    assert.equal(m.chamadas.removido, 0);
  });

  await t('área da conta: "sair de todos" pede confirmação; sem confirmar não faz nada', async () => {
    const auth = { email: 'a@exemplo.com', perfil: 'admin', sessao: 'S1' };
    let m = modal({ auth, confirmar: true });
    await m.clicar('todos');
    assert.equal(m.chamadas.todos, 1);
    m = modal({ auth, confirmar: false });
    await m.clicar('todos');
    assert.equal(m.chamadas.todos, 0);
    assert.equal(m.chamadas.removido, 0);
  });

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
