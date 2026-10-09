import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' },   // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' },   // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }    // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const SUB = { endpoint: 'https://push.exemplo.com/e1', keys: { p256dh: 'p256', auth: 'a1' } };
const enviarPushOk = async () => {};
const novo = (enviarPush = enviarPushOk) => criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: 'chave-de-teste' }, verificarToken, enviarPush });

await ta('inscreverPush: funciona sem login nenhum, igual ao check-in', async () => {
  const h = novo();
  const r = await h.post({ action: 'inscreverPush', inscricao: SUB });
  assert.equal(r.status, 'ok');
});

await ta('enviarNotificacao: organizador e admin podem; jogador e sem login são negados', async () => {
  const h = novo();
  await h.post({ action: 'inscreverPush', inscricao: SUB });
  assert.deepEqual(await h.post({ action: 'enviarNotificacao', idToken: 'tok-c', mensagem: { titulo: 'x' } }),
    { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.deepEqual(await h.post({ action: 'enviarNotificacao', mensagem: { titulo: 'x' } }),
    { error: 'Sem token de login. Entre com sua conta Google.' });
  const r = await h.post({ action: 'enviarNotificacao', idToken: 'tok-b', mensagem: { titulo: 'Check-in aberto!' } });
  assert.deepEqual(r, { status: 'ok', enviados: 1, removidas: 0, falharam: 0 });
  const rAdmin = await h.post({ action: 'enviarNotificacao', senha: 'chave-de-teste', mensagem: { titulo: 'Times sorteados!' } });
  assert.equal(rAdmin.status, 'ok');
});

await ta('enviarNotificacao: sem enviarPush injetado (VAPID não configurado), devolve ok com tudo em "falharam"', async () => {
  const h = novo(null);
  await h.post({ action: 'inscreverPush', inscricao: SUB });
  const r = await h.post({ action: 'enviarNotificacao', idToken: 'tok-b', mensagem: { titulo: 'x' } });
  assert.deepEqual(r, { status: 'ok', enviados: 0, removidas: 0, falharam: 1 });
});

fim();
