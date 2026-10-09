import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { inscreverPush, removerInscricaoPush, enviarNotificacao } from '../../backend/notificacoes.js';

const ORG = { perfil: 'organizador', nome: 'Org', email: 'b@exemplo.com', viaChaveMestra: false };
const SUB = (extra) => ({ endpoint: 'https://push.exemplo.com/e1', keys: { p256dh: 'p256', auth: 'a1' }, ...extra });

function ambiente(enviarPushFn) {
  let n = 0;
  return { repo: criarRepoMemoria({}), relogio: () => new Date('2026-10-09T12:00:00.000Z'), gerarId: () => 'push-' + (++n), enviarPush: enviarPushFn };
}

await ta('inscreverPush: valida a inscrição e grava; upsert pelo mesmo endpoint não duplica', async () => {
  const d = ambiente();
  assert.deepEqual(await inscreverPush(d, null), { error: 'Inscrição inválida.' });
  assert.deepEqual(await inscreverPush(d, SUB({ keys: {} })), { error: 'Inscrição inválida.' });
  assert.equal((await inscreverPush(d, SUB())).status, 'ok');
  assert.equal((await d.repo.lerPushInscricoes()).length, 1);
  assert.equal((await inscreverPush(d, SUB({ keys: { p256dh: 'outra', auth: 'a1' } }))).status, 'ok');
  const linhas = await d.repo.lerPushInscricoes();
  assert.equal(linhas.length, 1); // mesmo endpoint: atualiza, não duplica
  assert.equal(linhas[0].p256dh, 'outra');
});

await ta('removerInscricaoPush: remove pelo endpoint; endpoint vazio dá erro', async () => {
  const d = ambiente();
  await inscreverPush(d, SUB());
  assert.deepEqual(await removerInscricaoPush(d, ''), { error: 'Endpoint inválido.' });
  assert.equal((await removerInscricaoPush(d, SUB().endpoint)).status, 'ok');
  assert.equal((await d.repo.lerPushInscricoes()).length, 0);
});

await ta('enviarNotificacao: valida título, conta enviados, remove inscrição morta (404/410) e conta falhas', async () => {
  const chamadas = [];
  const d = ambiente(async (insc, payload) => {
    chamadas.push({ endpoint: insc.endpoint, payload });
    if (insc.endpoint.includes('morta')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
    if (insc.endpoint.includes('falha')) throw new Error('timeout');
  });
  assert.deepEqual(await enviarNotificacao(d, { titulo: '  ', corpo: 'x' }, ORG), { error: 'Escreva um título para a notificação.' });
  await inscreverPush(d, SUB({ endpoint: 'https://push.exemplo.com/viva' }));
  await inscreverPush(d, SUB({ endpoint: 'https://push.exemplo.com/morta' }));
  await inscreverPush(d, SUB({ endpoint: 'https://push.exemplo.com/falha' }));
  const r = await enviarNotificacao(d, { titulo: 'Check-in aberto!', corpo: 'Confirme sua presença' }, ORG);
  assert.deepEqual(r, { status: 'ok', enviados: 1, removidas: 1, falharam: 1 });
  assert.equal((await d.repo.lerPushInscricoes()).length, 2); // só a morta some
  assert.deepEqual(JSON.parse(chamadas[0].payload), { titulo: 'Check-in aberto!', corpo: 'Confirme sua presença' });
});

await ta('enviarNotificacao: sem inscrições nenhuma, devolve zeros (não quebra)', async () => {
  const d = ambiente(async () => {});
  assert.deepEqual(await enviarNotificacao(d, { titulo: 'Oi' }, ORG), { status: 'ok', enviados: 0, removidas: 0, falharam: 0 });
});

await ta('enviarNotificacao: sem deps.enviarPush (VAPID não configurado) conta tudo como falha, nunca quebra', async () => {
  const d = criarHandlerFaltandoEnviarPush();
  await inscreverPush(d, SUB());
  const r = await enviarNotificacao(d, { titulo: 'Oi' }, ORG);
  assert.deepEqual(r, { status: 'ok', enviados: 0, removidas: 0, falharam: 1 });
});
function criarHandlerFaltandoEnviarPush(){
  return { repo: criarRepoMemoria({}), relogio: () => new Date(), gerarId: () => 'id1',
    enviarPush: async () => { throw new Error('Notificações push não configuradas neste servidor.'); } };
}

fim();
