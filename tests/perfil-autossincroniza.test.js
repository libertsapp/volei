// Bug real (2026-09): AUTH.jogadorId fica gravado no localStorage no primeiro login e NUNCA mais é reconferido
// com o servidor — a renovação silenciosa do token (a cada 45 min ou antes de uma escrita) só atualiza
// idToken/exp, nunca jogadorId/perfil. Se o vínculo da conta mudar depois do primeiro login naquele aparelho
// específico, "Meu Perfil" mostra "jogador vinculado não encontrado" para sempre, mesmo com o servidor correto
// — só se autocorrigia se um admin resalvasse aquela conta na tela Usuários (o único lugar que resincronizava).
// sincronizarContaComServidor() fecha essa lacuna: reconfere no servidor usando o token já em mãos, sem pedir
// login do Google de novo e SEM nunca abrir os popups do primeiro login (convite de vínculo, oferta de bootstrap).
// v14.0: a função mora no bloco <sessao-front> (sessão do app). Com sessão ela usa a ação minhaConta; sem sessão, só
// quem ainda tem o token do Google VÁLIDO troca por uma sessão via loginGoogle. As garantias abaixo valem nos dois.
// Extrai o código direto do HTML, então testa exatamente o que vai pro ar.
// Rodar: node tests/perfil-autossincroniza.test.js   (HTML_ARQUIVO=<caminho> roda contra outro HTML, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const caminho = process.env.HTML_ARQUIVO
  ? path.resolve(process.env.HTML_ARQUIVO)
  : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(caminho, 'utf8').replace(/\r/g, '');

function pegar(inicio, fim){
  const i = html.indexOf(inicio);
  assert.ok(i > -1, 'não encontrei: ' + inicio);
  const f = html.indexOf(fim, i);
  assert.ok(f > i, 'não encontrei o fim de: ' + inicio);
  return html.slice(i, f + fim.length);
}
const codigo = pegar('// <sessao-front>', '// </sessao-front>');

let falhas = 0;
async function t(nome, fn){
  try { await fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

// monta a função com espiões no lugar de tudo que ela toca (AUTH, fetch, os re-render, e os popups que NUNCA
// podem ser chamados por essa função — só existem no escopo pra provar que não são referenciados)
function montar({ logado = true, idToken = 'tok-atual', perfil = 'admin', jogadorId = 'velho-id', jogadorIdPendente = '', sheetReady = true, resposta, erroFetch,
  sessao = '', exp = Math.floor(Date.now() / 1000) + 1800 }){
  const chamadas = { fetch: [], salvarSessaoAuth: 0, atualizarStatusAuth: 0, aplicarPermissoesUI: 0, renderAll: 0,
    perguntarVinculoJogador: 0, pedirBootstrapAdmin: 0, consoleError: 0, sairDaConta: 0 };
  const AUTH = { logado, idToken, perfil, jogadorId, jogadorIdPendente, nome: 'Fulano', exp, sessao };
  const fabrica = new Function('ctx', `
    const { AUTH, chamadas, sheetReady, SHEET_API_URL } = ctx;
    const salvarSessaoAuth = () => { chamadas.salvarSessaoAuth++; };
    const atualizarStatusAuth = () => { chamadas.atualizarStatusAuth++; };
    const aplicarPermissoesUI = () => { chamadas.aplicarPermissoesUI++; };
    const renderAll = () => { chamadas.renderAll++; };
    const perguntarVinculoJogador = () => { chamadas.perguntarVinculoJogador++; };
    const pedirBootstrapAdmin = () => { chamadas.pedirBootstrapAdmin++; };
    const sairDaConta = () => { chamadas.sairDaConta++; };
    const mostrarToast = () => {};
    const garantirTokenFresco = async () => null;
    const fetch = async (url, opts) => { chamadas.fetch.push({ url, body: JSON.parse(opts.body) }); ${erroFetch ? 'throw new Error("rede fora do ar");' : 'return { json: async () => (ctx.resposta) };'} };
    const console = { error: () => { chamadas.consoleError++; } };
    ${codigo}
    return sincronizarContaComServidor;
  `);
  return { fn: fabrica({ AUTH, chamadas, sheetReady, SHEET_API_URL: 'https://exemplo.test/api', resposta }), AUTH, chamadas };
}

(async () => {
  await t('conta deslogada: não chama a rede nem mexe em nada', async () => {
    const m = montar({ logado: false, resposta: {} });
    await m.fn();
    assert.deepEqual(m.chamadas.fetch, []);
    assert.equal(m.chamadas.salvarSessaoAuth, 0);
  });

  await t('sem idToken em mãos: não chama a rede (nada pra provar ao servidor)', async () => {
    const m = montar({ idToken: '', resposta: {} });
    await m.fn();
    assert.deepEqual(m.chamadas.fetch, []);
  });

  await t('vínculo mudou no servidor: atualiza AUTH, salva a sessão e re-renderiza (é o caso do bug real)', async () => {
    const m = montar({
      jogadorId: 'velho-id', perfil: 'jogador',
      resposta: { status: 'ok', perfil: 'admin', jogadorId: 'msnn65q7u4c1q', jogadorIdPendente: '', nome: 'HELENO VILLELA' }
    });
    await m.fn();
    assert.equal(m.chamadas.fetch[0].body.action, 'loginGoogle');
    assert.equal(m.chamadas.fetch[0].body.idToken, 'tok-atual');
    assert.equal(m.AUTH.jogadorId, 'msnn65q7u4c1q');
    assert.equal(m.AUTH.perfil, 'admin');
    assert.equal(m.chamadas.salvarSessaoAuth, 1);
    assert.equal(m.chamadas.atualizarStatusAuth, 1);
    assert.equal(m.chamadas.aplicarPermissoesUI, 1);
    assert.equal(m.chamadas.renderAll, 1);
  });

  await t('servidor confirma o mesmo vínculo de sempre: salva (idempotente) mas NÃO força re-render', async () => {
    const m = montar({
      jogadorId: 'msnn65q7u4c1q', perfil: 'admin', jogadorIdPendente: '',
      resposta: { status: 'ok', perfil: 'admin', jogadorId: 'msnn65q7u4c1q', jogadorIdPendente: '', nome: 'HELENO VILLELA' }
    });
    await m.fn();
    assert.equal(m.chamadas.salvarSessaoAuth, 1);
    assert.equal(m.chamadas.atualizarStatusAuth, 0);
    assert.equal(m.chamadas.aplicarPermissoesUI, 0);
    assert.equal(m.chamadas.renderAll, 0);
  });

  await t('token vencido (erro do servidor): não mexe em AUTH nem re-renderiza (tenta de novo na próxima renovação)', async () => {
    const m = montar({ jogadorId: 'velho-id', resposta: { error: 'Login do Google expirado.' } });
    await m.fn();
    assert.equal(m.chamadas.fetch.length, 1); // chegou a perguntar ao servidor
    assert.equal(m.chamadas.sairDaConta, 0);  // erro do Google não desloga
    assert.equal(m.AUTH.jogadorId, 'velho-id');
    assert.equal(m.chamadas.salvarSessaoAuth, 0);
    assert.equal(m.chamadas.renderAll, 0);
  });

  await t('falha de rede: não lança (silencioso), não mexe em AUTH', async () => {
    const m = montar({ jogadorId: 'velho-id', erroFetch: true });
    await assert.doesNotReject(() => m.fn());
    assert.equal(m.AUTH.jogadorId, 'velho-id');
  });

  await t('NUNCA abre o convite de vínculo nem a oferta de bootstrap (isso é só do primeiro login de verdade)', async () => {
    const m = montar({
      jogadorId: '', jogadorIdPendente: '',
      resposta: { status: 'ok', perfil: 'jogador', jogadorId: '', jogadorIdPendente: '', totalUsuarios: 1, sugestao: { id: 'x', nome: 'X' } }
    });
    await m.fn();
    assert.equal(m.chamadas.fetch.length, 1); // a resposta do servidor foi processada (o teste não passa "por não chamar")
    assert.equal(m.chamadas.perguntarVinculoJogador, 0);
    assert.equal(m.chamadas.pedirBootstrapAdmin, 0);
  });

  await t('com sessão do app (v14.0): usa minhaConta, aplica o vínculo novo e também nunca abre popup', async () => {
    const m = montar({
      sessao: 'S1', idToken: '', jogadorId: 'velho-id', perfil: 'jogador',
      resposta: { status: 'ok', perfil: 'admin', jogadorId: 'novo-id', jogadorIdPendente: '', nome: 'X', totalUsuarios: 1, sugestao: { id: 'x', nome: 'X' } }
    });
    await m.fn();
    assert.equal(m.chamadas.fetch[0].body.action, 'minhaConta');
    assert.equal(m.chamadas.fetch[0].body.sessao, 'S1');
    assert.equal(m.AUTH.jogadorId, 'novo-id');
    assert.equal(m.chamadas.renderAll, 1);
    assert.equal(m.chamadas.perguntarVinculoJogador, 0);
    assert.equal(m.chamadas.pedirBootstrapAdmin, 0);
  });

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
