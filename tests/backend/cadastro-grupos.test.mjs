import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { criarCadastroSupabase, codigoDoErro, ErroCadastro, LIMITES_PADRAO } from '../../backend/cadastro-grupos.js';
import { criarCadastroMemoria } from '../../backend/cadastro-grupos-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';
import { clienteGravador } from './cliente-gravador.mjs';

const NOVO = { apelido: 'quinta', nome: 'Vôlei de Quinta', cidade: 'Belo Horizonte', uf: 'MG', cor: '#ffd700', email: 'dono@x.com', nomeDono: 'Dono' };

t('codigoDoErro: reconhece os 4 códigos do criar_grupo e o unique (corrida de apelido)', () => {
  assert.equal(codigoDoErro({ message: 'apelido_em_uso' }), 'apelido_em_uso');
  assert.equal(codigoDoErro({ message: 'P0001: limite_por_email' }), 'limite_por_email');
  assert.equal(codigoDoErro({ code: '23505', message: 'duplicate key value violates unique constraint "grupos_apelido_key"' }), 'apelido_em_uso');
  assert.equal(codigoDoErro({ code: '42P01', message: 'relation does not exist' }), null);
});

// ---- Supabase (cliente falso) ----
function clienteResposta(respostas) {
  const c = clienteGravador();
  const rpcOriginal = c.rpc;
  c.rpc = (nome, params) => { rpcOriginal(nome, params); return Promise.resolve(respostas[nome] || { data: null, error: null }); };
  return c;
}

await ta('supabase: criarGrupo chama criar_grupo com os parâmetros certos e devolve o id', async () => {
  const c = clienteResposta({ criar_grupo: { data: 'uuid-1', error: null } });
  const id = await criarCadastroSupabase(c).criarGrupo(NOVO);
  assert.equal(id, 'uuid-1');
  assert.deepEqual(c.ops[0], { verbo: 'rpc', nome: 'criar_grupo', filtros: [], params: {
    p_apelido: 'quinta', p_nome: 'Vôlei de Quinta', p_cidade: 'Belo Horizonte', p_uf: 'MG', p_cor: '#ffd700', p_dono_email: 'dono@x.com', p_dono_nome: 'Dono'
  } });
});

await ta('supabase: erro de regra vira ErroCadastro com código; erro técnico sobe com a dica do SQL', async () => {
  const regra = criarCadastroSupabase(clienteResposta({ criar_grupo: { data: null, error: { code: 'P0001', message: 'apelido_reservado' } } }));
  await assert.rejects(regra.criarGrupo(NOVO), (e) => e instanceof ErroCadastro && e.codigo === 'apelido_reservado');
  const tecnico = criarCadastroSupabase(clienteResposta({ criar_grupo: { data: null, error: { code: '42883', message: 'function does not exist' } } }));
  await assert.rejects(tecnico.criarGrupo(NOVO), /criar_grupo: function does not exist.*schema-grupos\.sql/);
});

await ta('supabase: apelidoDisponivel e registrarTentativaGlobal chamam as funções da Task 1', async () => {
  const c = clienteResposta({ apelido_disponivel: { data: true, error: null }, registrar_tentativa_global: { data: false, error: null } });
  const cad = criarCadastroSupabase(c);
  assert.equal(await cad.apelidoDisponivel('quinta'), true);
  assert.equal(await cad.registrarTentativaGlobal('criar:1.2.3.4', 3, 3600, 3600), false);
  assert.deepEqual(c.ops.map((o) => [o.nome, o.params]), [
    ['apelido_disponivel', { p_apelido: 'quinta' }],
    ['registrar_tentativa_global', { p_chave: 'criar:1.2.3.4', p_max: 3, p_janela_seg: 3600, p_bloqueio_seg: 3600 }]
  ]);
});

await ta('supabase: lerGrupoPorApelido filtra pelo apelido; lerLimites cai no padrão sem linha', async () => {
  const c = clienteGravador();
  const cad = criarCadastroSupabase(c);
  assert.deepEqual(await cad.lerGrupoPorApelido('quinta'), null); // cliente falso devolve data: [] → nenhuma linha
  assert.deepEqual(c.ops[0].filtros, [['eq', 'apelido', 'quinta']]);
  assert.deepEqual(await cad.lerLimites(), LIMITES_PADRAO);
});

// ---- memória ----
await ta('memória: criarGrupo cria cadastro, repositório com o dono admin e linha na liga', async () => {
  const repoLiga = criarRepoLigaMemoria({ grupos: [{ id: 'terca', nome: 'Vôlei de Terça' }] });
  const cad = criarCadastroMemoria({ repoLiga });
  const id = await cad.criarGrupo(NOVO);
  const g = await cad.lerGrupoPorApelido('quinta');
  assert.equal(g.id, id);
  assert.equal(g.status, 'ativo');
  const usuarios = await cad.repoDoGrupo(id).lerUsuarios();
  assert.deepEqual(usuarios.map((u) => [u.email, u.perfil]), [['dono@x.com', 'admin']]);
  assert.ok(repoLiga.tabelas.grupos.some((l) => l.id === 'quinta' && l.cidade === 'Belo Horizonte' && l.uf === 'MG'));
});

await ta('memória: mesmas regras do criar_grupo (em uso, na liga, reservado, inválido, 1 por e-mail)', async () => {
  // 'praia' existe só na liga (não é reservado); 'terca' é reservado E está na liga — reservado vem antes, como no SQL
  const repoLiga = criarRepoLigaMemoria({ grupos: [{ id: 'terca', nome: 'Vôlei de Terça' }, { id: 'praia', nome: 'Vôlei da Praia' }] });
  const cad = criarCadastroMemoria({ repoLiga });
  await cad.criarGrupo(NOVO);
  const codigo = (p) => cad.criarGrupo({ ...NOVO, ...p }).then(() => 'criou', (e) => e.codigo);
  assert.equal(await codigo({ email: 'outro@x.com' }), 'apelido_em_uso');
  assert.equal(await codigo({ apelido: 'praia', email: 'outro@x.com' }), 'apelido_em_uso');
  assert.equal(await codigo({ apelido: 'terca', email: 'outro@x.com' }), 'apelido_reservado');
  assert.equal(await codigo({ apelido: 'admin', email: 'outro@x.com' }), 'apelido_reservado');
  assert.equal(await codigo({ apelido: 'Qu Inta', email: 'outro@x.com' }), 'apelido_invalido');
  assert.equal(await codigo({ apelido: 'sabado', email: 'DONO@x.com' }), 'limite_por_email');
  assert.equal(cad.grupos.length, 1);
  assert.equal(await cad.apelidoDisponivel('quinta'), false);
  assert.equal(await cad.apelidoDisponivel('terca'), false);
  assert.equal(await cad.apelidoDisponivel('domingo'), true);
});

await ta('memória: limite global por chave e janela', async () => {
  let agora = 0;
  const cad = criarCadastroMemoria({ agoraMs: () => agora });
  assert.equal(await cad.registrarTentativaGlobal('criar:ip', 2, 3600, 3600), true);
  assert.equal(await cad.registrarTentativaGlobal('criar:ip', 2, 3600, 3600), true);
  assert.equal(await cad.registrarTentativaGlobal('criar:ip', 2, 3600, 3600), false);
  assert.equal(await cad.registrarTentativaGlobal('criar:outro', 2, 3600, 3600), true);
  agora = 7300 * 1000; // passou a janela e o bloqueio
  assert.equal(await cad.registrarTentativaGlobal('criar:ip', 2, 3600, 3600), true);
});

fim();
