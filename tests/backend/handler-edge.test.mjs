import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { criarEdge } from '../../backend/edge.js';
import { ErroDeNegocio } from '../../backend/erros.js';

// Modo Edge (ocultarErrosInternos): exceção lançada vira texto genérico e a mensagem real vai para `registrar`; modo local não muda.
const PG = 'jogadores: permission denied for table jogadores (https://xyz.supabase.co/rest/v1/jogadores) constraint "jogadores_pkey"';
const verificarToken = async (t) => (t === 'tok-a' ? { ok: true, email: 'a@exemplo.com', nome: 'A' } : { ok: false, erro: 'Login do Google inválido ou expirado. Entre de novo.' });
const repoRuim = () => { const r = criarRepoMemoria(fixture); r.lerTudo = async () => { throw new Error(PG); }; r.lerJogadores = async () => { throw new Error(PG); }; r.inserirJogador = async () => { throw new Error(PG); }; return r; };
const montar = (extra) => criarHandler({ repo: repoRuim(), config: { adminPassword: 'chave-de-teste' }, verificarToken, ...extra });
const ADD = { action: 'addPlayer', senha: 'chave-de-teste', player: { id: 'novo-x', nome: 'X' } };

await ta('modo local (padrão): GET e POST devolvem a mensagem crua, como sempre', async () => {
  const h = montar({});
  assert.deepEqual(await h.get(), { error: PG });
  assert.deepEqual(await h.post(ADD), { error: PG });
});

await ta('modo edge: GET e POST veem só o texto genérico; registrar recebe a mensagem real', async () => {
  const vistos = [];
  const h = montar({ ocultarErrosInternos: true, registrar: (e) => vistos.push(e.message) });
  assert.deepEqual(await h.get(), { error: 'Erro interno no servidor.' });
  assert.deepEqual(await h.post(ADD), { error: 'Erro interno no servidor.' });
  assert.equal(vistos.length, 2);
  assert.ok(vistos.every((m) => m === PG));
  // pela camada HTTP inteira nada vaza
  const e = criarEdge({ handler: h, origensPermitidas: ['https://a.com'] });
  const t = await (await e(new Request('https://x/', { method: 'GET' }))).text();
  assert.ok(!/permission|supabase|constraint|jogadores/.test(t), t);
});

await ta('modo edge: erros de negócio devolvidos ({ error }) seguem idênticos e ErroDeNegocio lançado mantém a mensagem', async () => {
  const h = criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: 'chave-de-teste' }, verificarToken, ocultarErrosInternos: true });
  assert.deepEqual(await h.post({ action: 'salvarUsuario', senha: 'errada' }), { error: 'Senha de administrador incorreta.' });
  assert.deepEqual(await h.post({ action: 'xpto', senha: 'chave-de-teste' }), { error: 'Ação desconhecida: xpto' });
  const repo = criarRepoMemoria(fixture);
  repo.lerTudo = async () => { throw new ErroDeNegocio('Mensagem para o usuário.'); };
  const h2 = criarHandler({ repo, ocultarErrosInternos: true });
  assert.deepEqual(await h2.get(), { error: 'Mensagem para o usuário.' });
});

await ta('registrar que falha não derruba a resposta', async () => {
  const h = montar({ ocultarErrosInternos: true, registrar: () => { throw new Error('log quebrou'); } });
  assert.deepEqual(await h.get(), { error: 'Erro interno no servidor.' });
});

await ta('addCheckin corta nome de jogador acima de 120 caracteres e não mexe em nomes normais', async () => {
  const repo = criarRepoMemoria(fixture);
  const h = criarHandler({ repo, config: {}, verificarToken });
  assert.equal((await h.post({ action: 'addCheckin', idToken: 'tok-a', checkin: { id: 'c-long', data: '2026-09-29', jogadorId: 'conv-long', jogadorNome: 'x'.repeat(500) } })).status, 'ok');
  assert.equal((await h.post({ action: 'addCheckin', idToken: 'tok-a', checkin: { id: 'c-norm', data: '2026-09-29', jogadorId: 'conv-norm', jogadorNome: 'Ana Maria' } })).status, 'ok');
  const t = await repo.lerTudo();
  assert.equal(t.checkins.find((c) => c.id === 'c-long').jogador_nome.length, 120);
  assert.equal(t.checkins.find((c) => c.id === 'c-norm').jogador_nome, 'Ana Maria');
});

fim();
