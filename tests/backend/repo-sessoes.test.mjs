// Primitivas da tabela "sessoes" (ajuste 8) nos dois repositórios: o em memória (usado nos testes) e o do Supabase
// (produção), este último com um cliente FALSO que grava a consulta emitida — coluna errada aqui quebraria o login no ar.
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';

const linha = (h, email, expira) => ({ token_hash: h, email, criada_em: '2026-09-30T12:00:00.000Z', expira_em: expira, renovada_em: '2026-09-30T12:00:00.000Z' });

await ta('sessões: insere, lê, renova, apaga uma e apaga todas de um e-mail', async () => {
  const r = criarRepoMemoria(fixture);
  await r.inserirSessao(linha('h1', 'a@exemplo.com', '2026-12-29T12:00:00.000Z'));
  await r.inserirSessao(linha('h2', 'a@exemplo.com', '2026-12-29T12:00:00.000Z'));
  await r.inserirSessao(linha('h3', 'b@exemplo.com', '2026-12-29T12:00:00.000Z'));
  assert.equal((await r.lerSessao('h1')).email, 'a@exemplo.com');
  assert.equal(await r.lerSessao('nao-existe'), null);
  await r.renovarSessao('h1', { expira_em: '2027-01-01T00:00:00.000Z', renovada_em: '2026-10-03T00:00:00.000Z' });
  assert.equal((await r.lerSessao('h1')).expira_em, '2027-01-01T00:00:00.000Z');
  await r.apagarSessao('h1');
  await r.apagarSessao('h1'); // de novo: não falha
  assert.equal(await r.lerSessao('h1'), null);
  await r.apagarSessoesDe('a@exemplo.com');
  assert.equal(await r.lerSessao('h2'), null);
  assert.ok(await r.lerSessao('h3'));
});

await ta('sessões: apagarSessoesVencidas só apaga as vencidas daquele e-mail', async () => {
  const r = criarRepoMemoria(fixture);
  await r.inserirSessao(linha('velha', 'a@exemplo.com', '2026-09-01T00:00:00.000Z'));
  await r.inserirSessao(linha('nova', 'a@exemplo.com', '2026-12-01T00:00:00.000Z'));
  await r.inserirSessao(linha('velha-b', 'b@exemplo.com', '2026-09-01T00:00:00.000Z'));
  await r.apagarSessoesVencidas('a@exemplo.com', '2026-09-30T00:00:00.000Z');
  assert.equal(await r.lerSessao('velha'), null);
  assert.ok(await r.lerSessao('nova'));
  assert.ok(await r.lerSessao('velha-b'));
});

await ta('sessões não aparecem no lerTudo (o GET público nunca vê sessão)', async () => {
  const r = criarRepoMemoria(fixture);
  await r.inserirSessao(linha('h1', 'a@exemplo.com', '2026-12-29T12:00:00.000Z'));
  assert.equal('sessoes' in (await r.lerTudo()), false);
});

// Cliente Supabase falso: cada from() vira um registro { tabela, passos } e o construtor é "thenable" como o do
// supabase-js; cada await consome a próxima resposta planejada (padrão: { data: null, error: null }).
function clienteGravador(respostas = []) {
  const chamadas = [];
  const cliente = {
    from(tabela) {
      const op = { tabela, passos: [] };
      chamadas.push(op);
      const b = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'lte', 'maybeSingle']) {
        b[m] = (...args) => { op.passos.push([m, ...args]); return b; };
      }
      b.then = (ok, falha) => {
        const r = respostas.shift() || { data: null, error: null };
        return (r === 'excecao' ? Promise.reject(new TypeError('fetch failed')) : Promise.resolve(r)).then(ok, falha);
      };
      return b;
    }
  };
  return { cliente, chamadas };
}
const semEspera = { esperar: async () => {} };
const LINHA_H1 = linha('h1', 'a@exemplo.com', '2026-12-29T12:00:00.000Z');

await ta('Supabase: lerSessao busca pela coluna token_hash e devolve a linha, ou null quando não existe', async () => {
  const g = clienteGravador([{ data: LINHA_H1, error: null }, { data: null, error: null }]);
  const r = criarRepoSupabase(g.cliente, semEspera);
  assert.deepEqual(await r.lerSessao('h1'), LINHA_H1);
  assert.deepEqual(g.chamadas[0], { tabela: 'sessoes', passos: [['select', '*'], ['eq', 'token_hash', 'h1'], ['maybeSingle']] });
  assert.equal(await r.lerSessao('nao-existe'), null);
});

await ta('Supabase: lerSessao tenta de novo numa falha passageira e desiste na 3ª com a mensagem da tabela', async () => {
  let g = clienteGravador([{ data: null, error: { message: 'connection reset' } }, 'excecao', { data: LINHA_H1, error: null }]);
  assert.deepEqual(await criarRepoSupabase(g.cliente, semEspera).lerSessao('h1'), LINHA_H1);
  assert.equal(g.chamadas.length, 3);
  g = clienteGravador([{ data: null, error: { message: 'x' } }, { data: null, error: { message: 'y' } }, { data: null, error: { message: 'timeout' } }, { data: LINHA_H1, error: null }]);
  await assert.rejects(criarRepoSupabase(g.cliente, semEspera).lerSessao('h1'), /sessoes: timeout/);
  assert.equal(g.chamadas.length, 3);
});

await ta('Supabase: gravações emitem a consulta certa e NÃO tentam de novo (repetir gravação pode duplicar)', async () => {
  const g = clienteGravador();
  const r = criarRepoSupabase(g.cliente, semEspera);
  await r.inserirSessao(LINHA_H1);
  await r.renovarSessao('h1', { expira_em: '2027-01-01T00:00:00.000Z', renovada_em: '2026-10-03T00:00:00.000Z' });
  await r.apagarSessao('h1');
  await r.apagarSessoesDe('a@exemplo.com');
  await r.apagarSessoesVencidas('a@exemplo.com', '2026-09-30T00:00:00.000Z');
  assert.deepEqual(g.chamadas, [
    { tabela: 'sessoes', passos: [['insert', LINHA_H1]] },
    { tabela: 'sessoes', passos: [['update', { expira_em: '2027-01-01T00:00:00.000Z', renovada_em: '2026-10-03T00:00:00.000Z' }], ['eq', 'token_hash', 'h1']] },
    { tabela: 'sessoes', passos: [['delete'], ['eq', 'token_hash', 'h1']] },
    { tabela: 'sessoes', passos: [['delete'], ['eq', 'email', 'a@exemplo.com']] },
    { tabela: 'sessoes', passos: [['delete'], ['eq', 'email', 'a@exemplo.com'], ['lte', 'expira_em', '2026-09-30T00:00:00.000Z']] }
  ]);
  const comErro = clienteGravador([{ data: null, error: { message: 'duplicate key' } }]);
  await assert.rejects(criarRepoSupabase(comErro.cliente, semEspera).inserirSessao(LINHA_H1), /sessoes: duplicate key/);
  assert.equal(comErro.chamadas.length, 1);
});

fim();
