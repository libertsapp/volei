// Garante que NADA do login aparece sozinho ao carregar/recarregar a página:
//  - o One Tap do Google (google.accounts.id.prompt) não roda no carregamento;
//  - a tarefa automática que avisa de pedidos pendentes nunca abre a tela da chave mestra nem
//    força logout quando o token do Google já venceu — só usa credencial que já existe.
// Extrai o código direto do HTML, então testa exatamente o que vai pro ar.
// Rodar: node tests/login-silencioso.test.js   (MEME=1 roda contra o HTML do Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const nomesDoMeme = ['volei-meme-dashboard.html', 'volei-meme-dashboard - Copia.html', 'volei-meme-dashboard - Copia - Copia.html'];
const arquivo = process.env.MEME
  ? (nomesDoMeme.find(n => fs.existsSync(path.join(__dirname, '..', n))) || nomesDoMeme[0])
  : 'volei-dashboard.html';
const html = fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8').replace(/\r/g, '');

function pegar(inicio, fim){
  const i = html.indexOf(inicio);
  assert.ok(i > -1, 'não encontrei: ' + inicio);
  const f = html.indexOf(fim, i);
  assert.ok(f > i, 'não encontrei o fim de: ' + inicio);
  return html.slice(i, f + fim.length);
}
const codigoHook = pegar('window.onGoogleLibraryLoad = function(){', '\n};\n');
const codigoCarregar = pegar('async function carregarUsuarios(', '\n}\n');
const codigoAviso = pegar('async function atualizarAvisoUsuariosPendentes(){', '\n}\n');

let falhas = 0;
async function t(nome, fn){
  try { await fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

// cenário: monta as funções do HTML com espiões no lugar de tudo que toca rede/tela
function montar({ logado, perfil = 'admin', token = '', expirado = false, senhaCache = '', credManual = { idToken: 'tok', senha: '' } }){
  const chamadas = { requireAuth: [], fetch: [], alert: 0, sair: 0, renovar: 0, modalSenha: 0, prompt: 0 };
  const els = {};
  const elemento = () => ({ style: {}, textContent: '' });
  const fabrica = new Function('ctx', `
    const { chamadas, els, elemento, logado, perfil, token, expirado, senhaCache, credManual } = ctx;
    const AUTH = { logado, perfil, idToken: token, exp: 0 };
    const SHEET_API_URL = 'https://exemplo.test/api';
    const document = { getElementById: (id) => els[id] || (els[id] = elemento()) };
    const getCachedPassword = () => senhaCache;
    const tokenExpirado = () => expirado || !AUTH.idToken;
    const temPermissao = () => !!senhaCache || (AUTH.logado && ['admin','organizador'].includes(AUTH.perfil));
    const requireAuth = async (acao) => { chamadas.requireAuth.push(acao); return credManual; };
    const pedirSenhaModal = async () => { chamadas.modalSenha++; return null; };
    const renovarTokenGoogle = async () => { chamadas.renovar++; return null; };
    const sairDaConta = () => { chamadas.sair++; };
    const alert = () => { chamadas.alert++; };
    const fetch = async (url, opts) => { chamadas.fetch.push(JSON.parse(opts.body)); return { json: async () => ({ usuarios: [{ jogadorIdPendente: 'x' }] }) }; };
    ${codigoCarregar}
    ${codigoAviso}
    return { carregarUsuarios, atualizarAvisoUsuariosPendentes };
  `);
  return { ...fabrica({ chamadas, els, elemento, logado, perfil, token, expirado, senhaCache, credManual }), chamadas };
}

(async () => {
  await t('carregar a página NÃO chama o One Tap (google.accounts.id.prompt), mas configura login e botão', () => {
    let prompt = 0, init = 0, botao = 0;
    const google = { accounts: { id: {
      initialize: () => { init++; }, renderButton: () => { botao++; }, prompt: () => { prompt++; }
    } } };
    const janela = {};
    new Function('window', 'google', 'GOOGLE_CLIENT_ID', 'document', 'handleGoogleCredential', 'console',
      codigoHook)(janela, google, 'id.apps.googleusercontent.com', { getElementById: () => ({}) }, () => {}, console);
    janela.onGoogleLibraryLoad();
    assert.equal(init, 1, 'initialize deveria rodar 1 vez');
    assert.equal(botao, 1, 'o botão "Entrar com Google" deveria continuar sendo desenhado');
    assert.equal(prompt, 0, 'prompt() (One Tap) não pode rodar sozinho no carregamento');
  });

  await t('aviso automático com token VENCIDO: não pede chave mestra, não renova, não desloga, não alerta, não chama a rede', async () => {
    const m = montar({ logado: true, token: 'velho', expirado: true });
    await m.atualizarAvisoUsuariosPendentes();
    assert.deepEqual(m.chamadas.requireAuth, [], 'requireAuth é o que abre pop-up: não pode ser chamado');
    assert.equal(m.chamadas.modalSenha, 0);
    assert.equal(m.chamadas.renovar, 0);
    assert.equal(m.chamadas.sair, 0);
    assert.equal(m.chamadas.alert, 0);
    assert.equal(m.chamadas.fetch.length, 0);
  });

  await t('aviso automático com token VÁLIDO: busca os pendentes com o token, sem pop-up', async () => {
    const m = montar({ logado: true, token: 'novo', expirado: false });
    await m.atualizarAvisoUsuariosPendentes();
    assert.deepEqual(m.chamadas.requireAuth, []);
    assert.equal(m.chamadas.fetch.length, 1);
    assert.equal(m.chamadas.fetch[0].action, 'listarUsuarios');
    assert.equal(m.chamadas.fetch[0].idToken, 'novo');
    assert.equal(m.chamadas.fetch[0].senha, '');
  });

  await t('aviso automático com chave mestra já em cache: usa a senha em cache, sem pop-up', async () => {
    const m = montar({ logado: false, senhaCache: 'cache', token: '' });
    await m.atualizarAvisoUsuariosPendentes();
    assert.deepEqual(m.chamadas.requireAuth, []);
    assert.equal(m.chamadas.fetch.length, 1);
    assert.equal(m.chamadas.fetch[0].senha, 'cache');
  });

  await t('aviso automático de visitante sem permissão: não faz nada e não pede nada', async () => {
    const m = montar({ logado: false });
    await m.atualizarAvisoUsuariosPendentes();
    assert.deepEqual(m.chamadas.requireAuth, []);
    assert.equal(m.chamadas.fetch.length, 0);
  });

  await t('clique manual (abrir "Gerenciar usuários"): continua passando pelo requireAuth de sempre', async () => {
    const m = montar({ logado: true, token: 'velho', expirado: true, credManual: { idToken: 'renovado', senha: '' } });
    const lista = await m.carregarUsuarios();
    assert.deepEqual(m.chamadas.requireAuth, ['listarUsuarios']);
    assert.equal(m.chamadas.fetch[0].idToken, 'renovado');
    assert.equal(lista.length, 1);
  });

  await t('clique manual cancelado (requireAuth devolve null): devolve null e não chama a rede', async () => {
    const m = montar({ logado: true, token: 'velho', expirado: true, credManual: null });
    assert.equal(await m.carregarUsuarios(), null);
    assert.equal(m.chamadas.fetch.length, 0);
  });

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
