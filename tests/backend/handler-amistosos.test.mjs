import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';
import { criarHandler } from '../../backend/handler.js';

const TOKENS = {
  'tok-a': { ok: true, email: 'a@exemplo.com', nome: 'A' }, // admin
  'tok-b': { ok: true, email: 'b@exemplo.com', nome: 'B' }, // organizador
  'tok-c': { ok: true, email: 'c@exemplo.com', nome: 'C' }  // jogador
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const GRUPOS = [{ id: 'terca', nome: 'Vôlei de Terça' }, { id: 'meme', nome: 'Vôlei Meme Brasil' }];

function mundo() {
  let agora = new Date('2026-10-12T15:00:00.000Z');
  const repoLiga = criarRepoLigaMemoria({ grupos: GRUPOS });
  const novo = (grupoId) => criarHandler({
    repo: criarRepoMemoria(fixture), config: { adminPassword: '' }, verificarToken,
    relogio: () => agora, liga: { repo: repoLiga, grupoId }, enviarPush: async () => {}
  });
  return { terca: novo('terca'), meme: novo('meme'), repoLiga, avancar: (iso) => { agora = new Date(iso); } };
}
const CONVITE = { grupo: 'meme', data: '2026-10-20', horario: '20:00', local: 'Quadra X', vagasPorGrupo: 6, recado: 'bora' };

await ta('GET: traz o bloco liga; sem liga injetada vem disponivel=false e o resto do app normal', async () => {
  const m = mundo();
  const g = await m.terca.get();
  assert.equal(g.liga.disponivel, true);
  assert.equal(g.liga.grupoId, 'terca');
  assert.ok(Array.isArray(g.players));
  const semLiga = await criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: '' }, verificarToken }).get();
  assert.deepEqual(semLiga.liga, { disponivel: false, grupoId: '', grupos: [], amistosos: [] });
  assert.ok(semLiga.players.length > 0);
});

await ta('GET: schema liga quebrado não derruba a leitura geral', async () => {
  const quebrado = { lerGrupos: async () => { throw new Error('relation "liga.grupos" does not exist'); }, lerAmistososDoGrupo: async () => ({}) };
  const h = criarHandler({ repo: criarRepoMemoria(fixture), config: { adminPassword: '' }, verificarToken, liga: { repo: quebrado, grupoId: 'terca' } });
  const g = await h.get();
  assert.equal(g.error, undefined);
  assert.equal(g.liga.disponivel, false);
});

await ta('permissões: jogador não convida nem responde; sem login nada', async () => {
  const m = mundo();
  assert.deepEqual(await m.terca.post({ action: 'convidarGrupo', idToken: 'tok-c', convite: CONVITE }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.deepEqual(await m.terca.post({ action: 'convidarGrupo', convite: CONVITE }), { error: 'Sem token de login. Entre com sua conta Google.' });
});

await ta('ponta a ponta: Terça convida, Meme aceita, jogadores entram, org confirma, placar lançado e confirmado', async () => {
  const m = mundo();
  const r1 = await m.terca.post({ action: 'convidarGrupo', idToken: 'tok-b', convite: CONVITE });
  assert.equal(r1.status, 'ok', JSON.stringify(r1));
  const id = r1.liga.amistosos[0].id;
  const rMeme = await m.meme.get();
  assert.equal(rMeme.liga.amistosos[0].vezDe, 'meme');
  assert.equal((await m.meme.post({ action: 'responderConvite', idToken: 'tok-a', id, resposta: 'aceitar' })).status, 'ok');
  // "Vou jogar": qualquer logado, inclusive perfil jogador (igual ao check-in); sem login não
  assert.deepEqual(await m.terca.post({ action: 'entrarAmistoso', id, jogadorId: 'p1' }), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.equal((await m.terca.post({ action: 'entrarAmistoso', idToken: 'tok-c', id, jogadorId: 'p1' })).status, 'ok');
  assert.deepEqual(await m.terca.post({ action: 'confirmarEscalado', idToken: 'tok-c', id, jogadorId: 'p1' }), { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.equal((await m.terca.post({ action: 'confirmarEscalado', idToken: 'tok-b', id, jogadorId: 'p1' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'travarEscalacao', idToken: 'tok-b', id })).status, 'ok');
  m.avancar('2026-10-21T01:00:00.000Z');
  assert.equal((await m.meme.post({ action: 'lancarPlacar', idToken: 'tok-b', id, setsConvidante: 1, setsConvidado: 3 })).status, 'ok');
  const fim_ = await m.terca.post({ action: 'confirmarPlacar', idToken: 'tok-b', id });
  const a = fim_.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.setsConvidante, a.setsConvidado], ['encerrado', 1, 3]);
  assert.deepEqual(a.mensagens.map((x) => x.tipo), ['convite', 'aceite', 'placar', 'confirmacao']);
});

await ta('roteamento: as demais ações chegam ao domínio', async () => {
  const m = mundo();
  const id = (await m.terca.post({ action: 'convidarGrupo', idToken: 'tok-b', convite: CONVITE })).liga.amistosos[0].id;
  assert.equal((await m.terca.post({ action: 'recadoAmistoso', idToken: 'tok-b', id, texto: 'oi' })).status, 'ok');
  assert.equal((await m.meme.post({ action: 'responderConvite', idToken: 'tok-b', id, resposta: 'contrapropor', data: '2026-10-21', horario: '19:00' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'responderConvite', idToken: 'tok-b', id, resposta: 'aceitar' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'entrarAmistoso', idToken: 'tok-b', id, jogadorId: 'p2' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'confirmarEscalado', idToken: 'tok-b', id, jogadorId: 'p2' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'desconfirmarEscalado', idToken: 'tok-b', id, jogadorId: 'p2' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'sairAmistoso', idToken: 'tok-b', id, jogadorId: 'p2' })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'travarEscalacao', idToken: 'tok-b', id })).status, 'ok');
  assert.equal((await m.terca.post({ action: 'destravarEscalacao', idToken: 'tok-b', id })).status, 'ok');
  m.avancar('2026-10-22T01:00:00.000Z');
  assert.equal((await m.terca.post({ action: 'lancarPlacar', idToken: 'tok-b', id, setsConvidante: 2, setsConvidado: 0 })).status, 'ok');
  assert.equal((await m.meme.post({ action: 'contestarPlacar', idToken: 'tok-b', id, texto: 'errado' })).status, 'ok');
  assert.equal((await m.meme.post({ action: 'cancelarAmistoso', idToken: 'tok-b', id, motivo: 'deixa pra lá' })).status, 'ok');
});

fim();
