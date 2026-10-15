import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarGruposApi, MSG_MUITAS_CRIACOES } from '../../backend/grupos-api.js';
import { criarCadastroMemoria } from '../../backend/cadastro-grupos-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';

const TOKENS = {
  'tok-dono': { ok: true, email: 'dono@x.com', nome: 'Dono' },
  'tok-outro': { ok: true, email: 'outro@x.com', nome: 'Outro' },
  'tok-terceiro': { ok: true, email: 'terceiro@x.com', nome: 'Terceiro' }
};
const verificarToken = async (t) => (!t ? { ok: false, erro: 'Sem token de login. Entre com sua conta Google.' } : TOKENS[t] || { ok: false, erro: 'inválido' });
const NOVO = { nome: 'Vôlei de Quinta', apelido: 'quinta', cidade: 'belo horizonte', uf: 'mg', cor: '#ffd700' };

function mundo(limites = {}) {
  // 'praia' existe só na liga (não é reservado): serve para o caso "em uso na liga"; 'terca' é reservado
  const repoLiga = criarRepoLigaMemoria({ grupos: [{ id: 'terca', nome: 'Vôlei de Terça', cidade: 'Santa Luzia', uf: 'MG' }, { id: 'praia', nome: 'Vôlei da Praia' }] });
  const cadastro = criarCadastroMemoria({ repoLiga, limites });
  const api = criarGruposApi({
    cadastro, repoLiga, verificarToken,
    criarRepoDoGrupo: (id) => cadastro.repoDoGrupo(id),
    relogio: () => new Date('2026-10-12T15:00:00.000Z'), enviarPush: async () => {}
  });
  return { api, cadastro, repoLiga };
}
const criar = (api, token, dados, ip = '1.1.1.1') => api.post({ action: 'criarGrupo', idToken: token, grupoNovo: dados }, { ip });
const jogador = (id, nome) => ({ id, nome, apelido: '', foto: '', estrelas: 3, sexo: 'M', porte: '' });

await ta('criarGrupo: cria e o grupo responde na hora pelo apelido, com a identidade', async () => {
  const { api } = mundo();
  assert.deepEqual(await criar(api, 'tok-dono', NOVO), { status: 'ok', apelido: 'quinta' });
  const g = await api.get({ consulta: { g: 'quinta' } });
  assert.deepEqual(g.grupo, { apelido: 'quinta', nome: 'Vôlei de Quinta', cidade: 'Belo Horizonte', uf: 'MG', cor: '#ffd700', logoUrl: '', plano: 'gratis' });
  assert.deepEqual(g.players, []);
  assert.equal(g.liga.grupoId, 'quinta');
  assert.ok(g.liga.grupos.some((x) => x.id === 'terca'));
});

await ta('criarGrupo: sem login, dados inválidos, endereço em uso/reservado, segundo grupo do mesmo e-mail', async () => {
  const { api, cadastro } = mundo();
  assert.deepEqual(await criar(api, '', NOVO), { error: 'Sem token de login. Entre com sua conta Google.' });
  assert.deepEqual(await criar(api, 'tok-dono', { ...NOVO, uf: 'XX' }), { error: 'Escolha o estado (UF).' });
  await criar(api, 'tok-dono', NOVO, '2.2.2.2');
  assert.deepEqual(await criar(api, 'tok-outro', NOVO, '3.3.3.3'), { error: 'Esse endereço já está em uso. Escolha outro.', codigo: 'apelido_em_uso' });
  assert.deepEqual(await criar(api, 'tok-outro', { ...NOVO, apelido: 'praia' }, '3.3.3.3'), { error: 'Esse endereço já está em uso. Escolha outro.', codigo: 'apelido_em_uso' });
  assert.deepEqual(await criar(api, 'tok-outro', { ...NOVO, apelido: 'terca' }, '6.6.6.6'), { error: 'Esse endereço é reservado. Escolha outro.', codigo: 'apelido_reservado' });
  assert.match((await criar(api, 'tok-outro', { ...NOVO, apelido: 'admin' }, '4.4.4.4')).error, /reservado/);
  assert.deepEqual(await criar(api, 'tok-dono', { ...NOVO, apelido: 'sabado' }, '5.5.5.5'), { error: 'Por enquanto cada pessoa pode criar 1 grupo.', codigo: 'limite_por_email' });
  assert.equal(cadastro.grupos.length, 1);
});

await ta('criarGrupo: limite por IP conta também as tentativas que falham', async () => {
  const { api } = mundo({ max_criacoes_por_ip_hora: 2 });
  await criar(api, '', NOVO, '9.9.9.9');
  await criar(api, 'tok-dono', { ...NOVO, uf: 'XX' }, '9.9.9.9');
  assert.deepEqual(await criar(api, 'tok-dono', NOVO, '9.9.9.9'), { error: MSG_MUITAS_CRIACOES });
  assert.equal((await criar(api, 'tok-dono', NOVO, '8.8.8.8')).status, 'ok'); // outro IP segue
});

await ta('verificarApelido: inválido, reservado, em uso (inclusive na liga) e livre', async () => {
  const { api } = mundo();
  await criar(api, 'tok-dono', NOVO);
  const v = (apelido) => api.post({ action: 'verificarApelido', apelido }, { ip: '1.1.1.1' });
  assert.equal((await v('Qu Inta')).disponivel, false);
  assert.match((await v('admin')).motivo, /reservado/);
  assert.deepEqual(await v('quinta'), { status: 'ok', disponivel: false, motivo: 'Esse endereço já está em uso. Escolha outro.', codigo: 'apelido_em_uso' });
  assert.equal((await v('terca')).disponivel, false);
  assert.deepEqual(await v('domingo'), { status: 'ok', disponivel: true, motivo: '', codigo: '' });
});

await ta('grupo inexistente, suspenso e apelido com maiúscula/espaço', async () => {
  const { api, cadastro } = mundo();
  await criar(api, 'tok-dono', NOVO);
  assert.deepEqual(await api.get({ consulta: { g: 'nao-existe' } }), { error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' });
  assert.deepEqual(await api.get({}), { error: 'Esse grupo não existe.', codigo: 'grupo_inexistente' });
  assert.equal((await api.get({ consulta: { g: ' Quinta ' } })).grupo.apelido, 'quinta');
  cadastro.grupos[0].status = 'suspenso';
  const api2 = criarGruposApi({ cadastro, verificarToken, criarRepoDoGrupo: (id) => cadastro.repoDoGrupo(id) }); // sem cache antigo
  assert.deepEqual(await api2.get({ consulta: { g: 'quinta' } }), { error: 'Grupo indisponível.', codigo: 'grupo_suspenso' });
  assert.deepEqual(await api2.post({ action: 'addPlayer', grupo: 'quinta', idToken: 'tok-dono', player: jogador('p1', 'Ana') }), { error: 'Grupo indisponível.', codigo: 'grupo_suspenso' });
});

await ta('isolamento: dono de um grupo não é organizador no outro; dados não se misturam', async () => {
  const { api } = mundo();
  await criar(api, 'tok-dono', NOVO);
  await criar(api, 'tok-outro', { ...NOVO, nome: 'Vôlei de Sábado', apelido: 'sabado' }, '2.2.2.2');
  assert.equal((await api.post({ action: 'addPlayer', grupo: 'quinta', idToken: 'tok-dono', player: jogador('p1', 'Ana') })).status, 'ok');
  assert.equal((await api.post({ action: 'addPlayer', grupo: 'sabado', idToken: 'tok-outro', player: jogador('p1', 'Bia') })).status, 'ok');
  assert.deepEqual(await api.post({ action: 'addPlayer', grupo: 'sabado', idToken: 'tok-dono', player: jogador('p2', 'Intrusa') }),
    { error: 'Seu perfil (jogador) não tem permissão para esta ação.' });
  assert.deepEqual((await api.get({ consulta: { g: 'quinta' } })).players.map((p) => p.nome), ['Ana']);
  assert.deepEqual((await api.get({ consulta: { g: 'sabado' } })).players.map((p) => p.nome), ['Bia']);
});

await ta('sessão do app de um grupo não vale no outro', async () => {
  const { api } = mundo();
  await criar(api, 'tok-dono', NOVO);
  await criar(api, 'tok-outro', { ...NOVO, apelido: 'sabado' }, '2.2.2.2');
  const login = await api.post({ action: 'loginGoogle', grupo: 'quinta', idToken: 'tok-dono' });
  assert.equal(login.perfil, 'admin');
  assert.ok(login.sessao);
  assert.equal((await api.post({ action: 'addPlayer', grupo: 'quinta', sessao: login.sessao, player: jogador('p1', 'Ana') })).status, 'ok');
  const noOutro = await api.post({ action: 'addPlayer', grupo: 'sabado', sessao: login.sessao, player: jogador('p9', 'X') });
  assert.ok(noOutro.error, 'sessão do quinta não pode valer no sabado');
});

await ta('teto de jogadores do plano grátis (só ativos contam)', async () => {
  const { api } = mundo({ max_jogadores_por_grupo: 2 });
  await criar(api, 'tok-dono', NOVO);
  const add = (id) => api.post({ action: 'addPlayer', grupo: 'quinta', idToken: 'tok-dono', player: jogador(id, 'J' + id) });
  assert.equal((await add('p1')).status, 'ok');
  assert.equal((await add('p2')).status, 'ok');
  assert.deepEqual(await add('p3'), { error: 'Este grupo chegou ao limite de 2 jogadores do plano grátis.' });
  assert.equal((await api.post({ action: 'removePlayer', grupo: 'quinta', idToken: 'tok-dono', id: 'p1' })).status, 'ok');
  assert.equal((await add('p3')).status, 'ok'); // removido não conta
});

await ta('fix: teto de jogadores também vale ao reativar um removido (restorePlayer)', async () => {
  const { api } = mundo({ max_jogadores_por_grupo: 2 });
  await criar(api, 'tok-dono', NOVO);
  const post = (b) => api.post({ grupo: 'quinta', idToken: 'tok-dono', ...b });
  await post({ action: 'addPlayer', player: jogador('p1', 'A') });
  await post({ action: 'removePlayer', id: 'p1' });
  await post({ action: 'addPlayer', player: jogador('p2', 'B') });
  await post({ action: 'addPlayer', player: jogador('p3', 'C') });
  assert.deepEqual(await post({ action: 'restorePlayer', id: 'p1' }), { error: 'Este grupo chegou ao limite de 2 jogadores do plano grátis.' });
  assert.deepEqual((await api.get({ consulta: { g: 'quinta' } })).players.length, 2);
});

await ta('fix: sem IP conhecido (cabeçalho ausente) o limite vira um teto geral maior, não trava todo mundo na 3ª tentativa', async () => {
  const { api } = mundo({ max_criacoes_por_ip_hora: 3 });
  for (let i = 0; i < 5; i++) await criar(api, '', NOVO, 'desconhecido'); // 5 falhas sem login, todas sem IP
  assert.equal((await criar(api, 'tok-dono', NOVO, 'desconhecido')).status, 'ok');
  for (let i = 0; i < 5; i++) await api.post({ action: 'criarGrupo', idToken: '', grupoNovo: NOVO }, {}); // contexto sem ip
  assert.equal((await criar(api, 'tok-outro', { ...NOVO, apelido: 'sabado' }, undefined)).status, 'ok');
});

await ta('grupo pela query no POST (contexto.consulta.g) quando o corpo não traz "grupo"', async () => {
  const { api } = mundo();
  await criar(api, 'tok-dono', NOVO);
  const r = await api.post({ action: 'addPlayer', idToken: 'tok-dono', player: jogador('p1', 'Ana') }, { consulta: { g: 'quinta' } });
  assert.equal(r.status, 'ok');
  assert.deepEqual((await api.get({ consulta: { g: 'quinta' } })).players.map((p) => p.nome), ['Ana']);
});

await ta('recusa de apelido vem sempre com código (validação JS e verificarApelido)', async () => {
  const { api } = mundo();
  assert.deepEqual(await criar(api, 'tok-dono', { ...NOVO, apelido: 'Qu Inta' }), { error: 'Use só letras minúsculas, números e hífen (sem acento, sem espaço, sem hífen nas pontas).', codigo: 'apelido_invalido' });
  const v = await api.post({ action: 'verificarApelido', apelido: 'admin' }, { ip: '1.1.1.1' });
  assert.deepEqual(v, { status: 'ok', disponivel: false, motivo: 'Esse endereço é reservado. Escolha outro.', codigo: 'apelido_reservado' });
});

await ta('GET ?lista=grupos: devolve a vitrine e guarda 5 minutos; falha não fica guardada', async () => {
  let agora = new Date('2026-10-14T15:00:00.000Z');
  let leituras = 0, quebrar = false;
  const vitrine = { cadastrados: 2, jogaramNoMes: 1, grupos: [] };
  const repoLiga = criarRepoLigaMemoria({ grupos: [] });
  const cadastro = criarCadastroMemoria({ repoLiga });
  const api = criarGruposApi({
    cadastro, repoLiga, verificarToken, criarRepoDoGrupo: (id) => cadastro.repoDoGrupo(id), relogio: () => agora,
    lerVitrine: async () => { leituras++; if (quebrar) throw new Error('banco fora'); return vitrine; },
    ocultarErrosInternos: true
  });
  assert.deepEqual(await api.get({ consulta: { lista: 'grupos' } }), vitrine);
  await api.get({ consulta: { lista: 'grupos' } });
  assert.equal(leituras, 1, 'segunda chamada sai do cache');
  agora = new Date(agora.getTime() + 5 * 60 * 1000 + 1);
  quebrar = true;
  const r = await api.get({ consulta: { lista: 'grupos' } });
  assert.ok(r.error, 'falha vira { error }');
  assert.ok(!String(r.error).includes('banco fora'), 'texto interno não vaza');
  quebrar = false;
  assert.deepEqual(await api.get({ consulta: { lista: 'grupos' } }), vitrine, 'depois da falha tenta de novo');
  assert.equal(leituras, 3);
});

await ta('GET ?lista=grupos sem leitor configurado: { error }, sem quebrar', async () => {
  const { api } = mundo();
  const r = await api.get({ consulta: { lista: 'grupos' } });
  assert.ok(r.error);
});

await ta('GET ?g= continua igual com a vitrine ligada', async () => {
  const { api } = mundo();
  assert.equal((await api.get({ consulta: { g: 'naoexiste' } })).codigo, 'grupo_inexistente');
});

fim();
