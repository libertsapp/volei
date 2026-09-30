// Sessão do app no front (bloco <sessao-front>): credencial, "sessão expirou", sincronização da conta e migração de
// quem só tem o token do Google. Extrai o código do HTML. Rodar: node tests/sessao-front.test.js
// (HTML_ARQUIVO=<caminho> roda contra outra página, ex. o index.html do Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.env.HTML_ARQUIVO || path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <sessao-front>');
const fim = html.indexOf('// </sessao-front>');
assert.ok(ini > -1 && fim > ini, 'bloco <sessao-front> não encontrado');
const bloco = html.slice(ini, fim);

function amb({ auth, garantir = async () => null, respostas = [] } = {}) {
  const posts = [], toasts = [];
  let saiu = 0;
  const F = new Function('AUTH', 'garantirTokenFresco', 'respostas', 'posts', 'toasts', 'marcarSaida', `
    const SHEET_API_URL = 'x'; const sheetReady = true; const console = { error(){} };
    const fetch = async (u, o) => { const b = JSON.parse(o.body); posts.push(b); const r = respostas.shift(); if (r === 'rede') throw new TypeError('Failed to fetch'); return { json: async () => r || { status: 'ok' } }; };
    const mostrarToast = (m) => toasts.push(m);
    const salvarSessaoAuth = () => {}; const atualizarStatusAuth = () => {}; const aplicarPermissoesUI = () => {}; const renderAll = () => {};
    const sairDaConta = () => { marcarSaida(); AUTH.logado = false; AUTH.sessao = ''; };
    ${bloco}
    return { credencialLogada, sessaoExpirou, tratarSessaoExpirada, sincronizarContaComServidor, textoValidadeSessao, sairDeTodosOsAparelhos };`);
  const api = F(auth, garantir, respostas, posts, toasts, () => { saiu++; });
  return { ...api, posts, toasts, saidas: () => saiu, auth };
}

(async () => {
  // com sessão: credencial é a sessão, sem pedir nada ao Google
  let chamouGoogle = false;
  let a = amb({ auth: { logado: true, sessao: 'S1', idToken: '' }, garantir: async () => { chamouGoogle = true; return 'G'; } });
  assert.deepEqual(await a.credencialLogada(), { sessao: 'S1', idToken: '', senha: '' });
  assert.equal(chamouGoogle, false);
  // sem sessão (app antigo): cai no token do Google, como antes
  a = amb({ auth: { logado: true, sessao: '', idToken: 'G' }, garantir: async () => 'G2' });
  assert.deepEqual(await a.credencialLogada(), { sessao: '', idToken: 'G2', senha: '' });
  // deslogado / Google não renovou: null
  assert.equal(await amb({ auth: { logado: false } }).credencialLogada(), null);
  assert.equal(await amb({ auth: { logado: true, sessao: '' } }).credencialLogada(), null);

  assert.equal(a.sessaoExpirou('Sua sessão expirou. Entre com o Google de novo.'), true);
  assert.equal(a.sessaoExpirou('Não foi possível conferir sua sessão agora. Tente de novo.'), false);
  assert.equal(a.sessaoExpirou(undefined), false);

  // sincronização com sessão usa minhaConta e atualiza o perfil
  a = amb({ auth: { logado: true, sessao: 'S1', perfil: 'jogador', jogadorId: '', jogadorIdPendente: '' }, respostas: [{ status: 'ok', perfil: 'admin', jogadorId: 'p1', jogadorIdPendente: '', nome: 'A', sessaoExpiraEm: '2026-12-29T15:00:00.000Z' }] });
  await a.sincronizarContaComServidor();
  assert.equal(a.posts[0].action, 'minhaConta');
  assert.equal(a.posts[0].sessao, 'S1');
  assert.equal(a.auth.perfil, 'admin');
  assert.equal(a.auth.sessaoExpiraEm, '2026-12-29T15:00:00.000Z');
  // sessão expirou na sincronização: sai da conta localmente (uma vez) e avisa
  a = amb({ auth: { logado: true, sessao: 'S1' }, respostas: [{ error: 'Sua sessão expirou. Entre com o Google de novo.' }] });
  await a.sincronizarContaComServidor();
  assert.equal(a.saidas(), 1);
  assert.equal(a.toasts.length, 1);
  // banco fora do ar / rede caiu: NÃO sai da conta
  for (const r of [{ error: 'Não foi possível conferir sua sessão agora. Tente de novo.' }, 'rede']) {
    a = amb({ auth: { logado: true, sessao: 'S1' }, respostas: [r] });
    await a.sincronizarContaComServidor();
    assert.equal(a.saidas(), 0);
    assert.equal(a.auth.sessao, 'S1');
  }
  // migração: logado só com idToken ainda válido troca por sessão via loginGoogle, em silêncio
  a = amb({ auth: { logado: true, sessao: '', idToken: 'G', exp: Math.floor(Date.now() / 1000) + 1800 }, respostas: [{ status: 'ok', perfil: 'organizador', jogadorId: '', jogadorIdPendente: '', sessao: 'NOVA', sessaoExpiraEm: '2026-12-29T15:00:00.000Z' }] });
  await a.sincronizarContaComServidor();
  assert.equal(a.posts[0].action, 'loginGoogle');
  assert.equal(a.auth.sessao, 'NOVA');
  // idToken vencido e sem sessão: não chama nada (a pessoa entra de novo pelo botão)
  a = amb({ auth: { logado: true, sessao: '', idToken: 'G', exp: 1 } });
  await a.sincronizarContaComServidor();
  assert.equal(a.posts.length, 0);
  // área da conta: validade legível e "sair de todos os aparelhos"
  assert.equal(a.textoValidadeSessao(''), '');
  assert.match(a.textoValidadeSessao('2026-12-29T15:00:00.000Z'), /^Conectado neste aparelho até \d{2}\/\d{2}\/\d{4}$/);
  // sair de todos: manda a ação certa e sai deste aparelho também
  a = amb({ auth: { logado: true, sessao: 'S1' }, respostas: [{ status: 'ok' }] });
  assert.equal(await a.sairDeTodosOsAparelhos(), true);
  assert.equal(a.posts[0].action, 'sairDeTodosOsAparelhos');
  assert.equal(a.posts[0].sessao, 'S1');
  assert.equal(a.saidas(), 1);
  // servidor fora do ar: não sai e avisa (a pessoa tenta de novo)
  a = amb({ auth: { logado: true, sessao: 'S1' }, respostas: ['rede'] });
  assert.equal(await a.sairDeTodosOsAparelhos(), false);
  assert.equal(a.saidas(), 0);
  assert.equal(a.toasts.length, 1);
  console.log('ok — sessão do app no front');
})().catch(e => { console.error(e); process.exit(1); });
