import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarVerificadorGoogle, iguaisSeguros } from '../../backend/auth.js';

const CLIENTE = 'cliente-de-teste.apps.googleusercontent.com';
const AGORA = 1_800_000_000_000; // ms fixos
const futuro = String(Math.floor(AGORA / 1000) + 3600);
const passado = String(Math.floor(AGORA / 1000) - 3600);

// resposta do tokeninfo com o que o teste quiser mudar
const info = (extra = {}) => ({ aud: CLIENTE, email: 'Ana@Exemplo.com ', email_verified: 'true', exp: futuro, name: 'Ana Silva', picture: 'https://x/y.jpg', ...extra });
const resposta = (status, corpo) => ({ status, json: async () => { if (corpo instanceof Error) throw corpo; return corpo; } });
const verificador = (buscar) => criarVerificadorGoogle({ clientId: CLIENTE, buscar, agora: () => AGORA });

await ta('sem token: mensagem pedindo para entrar', async () => {
  const v = verificador(async () => { throw new Error('não devia chamar'); });
  assert.deepEqual(await v(''), { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' });
  assert.deepEqual(await v(undefined), { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' });
});

await ta('token válido: e-mail normalizado, nome e foto; a URL leva o token codificado', async () => {
  let urlChamada = '';
  const v = verificador(async (url) => { urlChamada = url; return resposta(200, info()); });
  assert.deepEqual(await v('abc+def/ghi'), { ok: true, email: 'ana@exemplo.com', nome: 'Ana Silva', foto: 'https://x/y.jpg' });
  assert.equal(urlChamada, 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent('abc+def/ghi'));
});

await ta('falha de rede: mensagem de "não foi possível falar com o Google"', async () => {
  const v = verificador(async () => { throw new Error('rede'); });
  assert.deepEqual(await v('t'), { ok: false, erro: 'Não foi possível falar com o Google pra conferir seu login. Tente de novo.' });
});

await ta('Google recusa (status diferente de 200): inválido ou expirado', async () => {
  const v = verificador(async () => resposta(400, {}));
  assert.deepEqual(await v('t'), { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' });
});

await ta('resposta que não é JSON: resposta inesperada', async () => {
  const v = verificador(async () => resposta(200, new Error('json ruim')));
  assert.deepEqual(await v('t'), { ok: false, erro: 'Resposta inesperada do Google ao conferir o login.' });
});

await ta('token emitido para outro aplicativo (aud diferente)', async () => {
  const v = verificador(async () => resposta(200, info({ aud: 'outro-app' })));
  assert.deepEqual(await v('t'), { ok: false, erro: 'Login do Google emitido para outro aplicativo.' });
});

await ta('e-mail não verificado', async () => {
  const v = verificador(async () => resposta(200, info({ email_verified: 'false' })));
  assert.deepEqual(await v('t'), { ok: false, erro: 'O e-mail dessa conta Google não está verificado.' });
});

await ta('token expirado ou sem exp', async () => {
  assert.deepEqual(await verificador(async () => resposta(200, info({ exp: passado })))('t'), { ok: false, erro: 'Login do Google expirou. Entre de novo.' });
  assert.deepEqual(await verificador(async () => resposta(200, info({ exp: undefined })))('t'), { ok: false, erro: 'Login do Google expirou. Entre de novo.' });
});

await ta('sem e-mail no token', async () => {
  const v = verificador(async () => resposta(200, info({ email: undefined })));
  assert.deepEqual(await v('t'), { ok: false, erro: 'Login do Google não trouxe e-mail. Entre de novo.' });
});

await ta('iguaisSeguros: igual, diferente, tamanhos diferentes e vazio', async () => {
  assert.equal(iguaisSeguros('abc', 'abc'), true);
  assert.equal(iguaisSeguros('abc', 'abd'), false);
  assert.equal(iguaisSeguros('abc', 'abcd'), false);
  assert.equal(iguaisSeguros('', 'x'), false);
  assert.equal(iguaisSeguros(undefined, 'x'), false);
  assert.equal(iguaisSeguros('', ''), false);
  assert.equal(iguaisSeguros(undefined, undefined), false);
});

fim();
