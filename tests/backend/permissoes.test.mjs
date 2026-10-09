import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { t, fim } from './executor.mjs';
import { PERMISSOES } from '../../backend/permissoes.js';

t('matriz: regras principais (vale mesmo sem o .gs)', () => {
  assert.deepEqual(PERMISSOES.salvarUsuario, ['admin']);
  assert.deepEqual(PERMISSOES.removerUsuario, ['admin']);
  assert.deepEqual(PERMISSOES.listarUsuarios, ['organizador', 'admin']);
  assert.deepEqual(PERMISSOES.solicitarVinculo, ['jogador', 'organizador', 'admin']);
  assert.deepEqual(PERMISSOES.estornarLancamento, ['admin']);
  assert.deepEqual(PERMISSOES.marcarPagamento, ['organizador', 'admin']);
  assert.equal(PERMISSOES.acaoInexistente, undefined);
  assert.equal(Object.hasOwn(PERMISSOES, 'constructor'), false);
});

// a matriz do backend novo tem que ser IDÊNTICA à do .gs real (PERMISSOES + PERMISSOES_FIN_)
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');
if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - paridade da matriz: apps-script-codigo.gs não existe nesta pasta.');
} else {
  const require = createRequire(import.meta.url);
  const { criarAmbiente } = require('../helpers/planilha-falsa.js');
  t('matriz: idêntica à do .gs real (ações e perfis)', () => {
    const amb = criarAmbiente({}, [caminhoGs]);
    const doGs = JSON.parse(amb.rodar('JSON.stringify(Object.assign({}, PERMISSOES, PERMISSOES_FIN_))'));
    // restorePlayer só existe no backend novo (o .gs apaga a linha do jogador e não tem como restaurar).
    // moverCheckin/salvarJogo2/removerJogo2 (dois jogos no mesmo dia, 2026-10-03) também: a funcionalidade inteira
    // só existe no backend novo (Supabase) — o .gs não tem addCheckin com campo "jogo" nem essas três ações.
    // enviarNotificacao (ajuste 11, notificações push): também só existe no backend novo.
    const { restorePlayer, moverCheckin, salvarJogo2, removerJogo2, enviarNotificacao, ...resto } = PERMISSOES;
    assert.deepEqual(resto, doGs);
    assert.deepEqual(restorePlayer, ['organizador', 'admin']);
    assert.deepEqual(moverCheckin, ['organizador', 'admin']);
    assert.deepEqual(salvarJogo2, ['organizador', 'admin']);
    assert.deepEqual(removerJogo2, ['organizador', 'admin']);
    assert.deepEqual(enviarNotificacao, ['organizador', 'admin']);
  });
}

fim();
