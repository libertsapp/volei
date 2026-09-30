// Bug real (2026-09): a renovação do token do Google só era tentada NA HORA de uma ação de admin (nunca
// proativamente ao reabrir o app), e quando falhava (comum depois de muito tempo fechado) o app deslogava
// tudo (sairDaConta) com um alert() feio, mesmo o servidor sabendo perfeitamente quem era a pessoa — dava a
// impressão de "esqueceu que eu tava logado" toda vez que um admin ia fazer algo depois de um tempo parado.
// garantirTokenFresco() agora: nunca desloga sozinho (deixa o requireAuth() cair pra chave mestra, que já
// existe pra isso), usa toast em vez de alert(), e não fica repetindo a espera de 8s em toda ação seguida
// depois de uma falha (cooldown). tentarRenovarSeNecessario() tenta renovar em silêncio assim que o app volta
// a ficar visível, então na maioria das vezes já resolveu antes da pessoa clicar em qualquer coisa.
// Extrai o código direto do HTML, então testa exatamente o que vai pro ar.
// Rodar: node tests/renovacao-token.test.js   (HTML_ARQUIVO=<caminho> roda contra outro HTML, ex. o Meme)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const caminho = process.env.HTML_ARQUIVO
  ? path.resolve(process.env.HTML_ARQUIVO)
  : path.join(__dirname, '..', 'volei-dashboard.html');
const html = fs.readFileSync(caminho, 'utf8').replace(/\r/g, '');

// pega tudo de "inicio" até (sem incluir) "antesDe" — usado quando o trecho tem vários "}\n" no meio
// (tokenExpirado, renovarTokenGoogle, garantirTokenFresco, tentarRenovarSeNecessario, todos seguidos)
function pegarAte(inicio, antesDe){
  const i = html.indexOf(inicio);
  assert.ok(i > -1, 'não encontrei: ' + inicio);
  const f = html.indexOf(antesDe, i);
  assert.ok(f > i, 'não encontrei: ' + antesDe);
  return html.slice(i, f);
}
const codigo = pegarAte('function tokenExpirado(margemSegundos){', "document.addEventListener('visibilitychange'");

let falhas = 0;
async function t(nome, fn){
  try { await fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

// monta as três funções com espiões: google.accounts.id.prompt() resolve via AUTH.aoRenovar (como o Google faz de
// verdade, chamando handleGoogleCredential); "resolverCom" controla o que a renovação simulada devolve (token
// novo, ou nunca resolve = expira em 8s -> mockeamos o setTimeout pra não esperar de verdade no teste)
function montar({ logado = true, exp, resolverCom = null, sessao = '' }){
  const chamadas = { prompt: 0, mostrarToast: [], sairDaConta: 0, timeouts: [], sincronizarConta: 0 };
  const AUTH = { logado, idToken: 'tok-velho', exp, aoRenovar: null, sessao };
  const fabrica = new Function('ctx', `
    const { AUTH, chamadas } = ctx;
    const mostrarToast = (msg, tipo) => { chamadas.mostrarToast.push({ msg, tipo }); };
    const sairDaConta = () => { chamadas.sairDaConta++; };
    const sincronizarContaSeFazTempo = () => { chamadas.sincronizarConta++; };
    const google = { accounts: { id: { prompt: () => {
      chamadas.prompt++;
      // resolve na hora (síncrono, como AUTH.aoRenovar já está setado antes do prompt() no código real):
      // simula uma renovação silenciosa bem-sucedida. resolverCom === null: nunca chama aoRenovar
      // (simula o Google não conseguir renovar em silêncio — o setTimeout de baixo é quem resolve null).
      if(ctx.resolverCom !== null && AUTH.aoRenovar) AUTH.aoRenovar(ctx.resolverCom);
    } } } };
    // setTimeout de mentira: dispara na hora (o teste não precisa esperar 8s de verdade)
    const setTimeout = (fn) => { chamadas.timeouts.push(fn); fn(); return 0; };
    ${codigo}
    return { garantirTokenFresco, renovarTokenGoogle, tentarRenovarSeNecessario, tokenExpirado };
  `);
  return { ...fabrica({ AUTH, chamadas, resolverCom }), AUTH, chamadas };
}

const EXPIRADO = Math.floor(Date.now() / 1000) - 10; // já venceu
const FRESCO = Math.floor(Date.now() / 1000) + 3600; // vence daqui 1h

(async () => {
  await t('token ainda fresco: devolve na hora, sem tentar renovar (sem prompt do Google)', async () => {
    const m = montar({ exp: FRESCO });
    const token = await m.garantirTokenFresco();
    assert.equal(token, 'tok-velho');
    assert.equal(m.chamadas.prompt, 0);
  });

  await t('token vencido, renovação silenciosa dá certo: devolve o token novo, sem toast nem logout', async () => {
    const m = montar({ exp: EXPIRADO, resolverCom: 'tok-novo' });
    const token = await m.garantirTokenFresco();
    assert.equal(token, 'tok-novo');
    assert.equal(m.chamadas.mostrarToast.length, 0);
    assert.equal(m.chamadas.sairDaConta, 0);
  });

  await t('token vencido, renovação silenciosa falha: devolve null, avisa com TOAST (nunca alert) e NÃO desloga', async () => {
    const m = montar({ exp: EXPIRADO, resolverCom: null });
    const token = await m.garantirTokenFresco();
    assert.equal(token, null);
    assert.equal(m.chamadas.sairDaConta, 0, 'não pode deslogar sozinho — o requireAuth() cai pra chave mestra');
    assert.equal(m.chamadas.mostrarToast.length, 1);
    assert.match(m.chamadas.mostrarToast[0].msg, /Entrar com Google/);
  });

  await t('depois de UMA falha, uma 2ª tentativa logo em seguida NÃO tenta de novo (evita travar 8s toda ação)', async () => {
    const m = montar({ exp: EXPIRADO, resolverCom: null });
    await m.garantirTokenFresco();
    const token2 = await m.garantirTokenFresco();
    assert.equal(token2, null);
    assert.equal(m.chamadas.prompt, 1, 'só a 1ª chamada deveria ter tentado o prompt do Google');
  });

  await t('deslogado: nem tenta (sem prompt, sem toast)', async () => {
    const m = montar({ logado: false, exp: EXPIRADO });
    const token = await m.garantirTokenFresco();
    assert.equal(token, null);
    assert.equal(m.chamadas.prompt, 0);
    assert.equal(m.chamadas.mostrarToast.length, 0);
  });

  await t('tentarRenovarSeNecessario: logado com token perto de vencer -> tenta renovar em silêncio', async () => {
    const m = montar({ logado: true, exp: EXPIRADO, resolverCom: 'tok-novo' });
    m.tentarRenovarSeNecessario();
    assert.equal(m.chamadas.prompt, 1);
    assert.equal(m.chamadas.sincronizarConta, 0); // sem sessão, quem reconfere a conta é a renovação do Google
  });

  await t('tentarRenovarSeNecessario: token ainda fresco -> não faz nada', async () => {
    const m = montar({ logado: true, exp: FRESCO });
    m.tentarRenovarSeNecessario();
    assert.equal(m.chamadas.prompt, 0);
  });

  await t('tentarRenovarSeNecessario: com sessão do app (v14.0) nunca pede token ao Google; em vez disso reconfere a conta', async () => {
    const m = montar({ logado: true, exp: EXPIRADO, resolverCom: 'tok-novo', sessao: 'S1' });
    m.tentarRenovarSeNecessario();
    assert.equal(m.chamadas.prompt, 0);
    assert.equal(m.chamadas.sincronizarConta, 1);
  });

  await t('tentarRenovarSeNecessario: deslogado -> não faz nada', async () => {
    const m = montar({ logado: false, exp: EXPIRADO });
    m.tentarRenovarSeNecessario();
    assert.equal(m.chamadas.prompt, 0);
  });

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  process.exit(falhas ? 1 : 0);
})();
