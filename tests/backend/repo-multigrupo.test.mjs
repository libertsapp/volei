import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarRepoMultigrupo } from '../../backend/repo-multigrupo.js';
import { clienteGravador } from './cliente-gravador.mjs';

const G = '11111111-1111-1111-1111-111111111111';
const semEspera = { esperar: async () => {} };

// argumentos de exemplo por método (o resto usa o padrão). Só precisam ter o FORMATO certo: o cliente é falso.
const ARGS = {
  gravarUsuario: [{ email: 'a@x.com' }], inserirSessao: [{ token_hash: 'h', email: 'a@x.com' }],
  gravarPushInscricao: [{ id: 'i', endpoint: 'e' }], inserirJogador: [{ id: 'p1', nome: 'Ana' }],
  inserirCheckin: [{ id: 'c1' }], gravarFinDia: [{ data: '2026-10-13' }], inserirFinPagamento: [{ id: 'pg' }],
  inserirFinLancamento: [{ id: 'l' }], inserirFinLog: [{ acao: 'x' }], inserirFinPendencia: [{ id: 'pe' }],
  inserirFinCredito: [{ id: 'cr' }], gravarFinJogo: [{ data: '2026-10-13', jogo: 2 }],
  gravarConfig: [[{ chave: 'a', valor: '1' }]], gravarRodada: [{ id: 'r1', times: [] }],
  inserirAoVivo: [[{ round_id: 'r1' }]], inserirAoVivoLog: [[{ round_id: 'r1' }]],
  estornarFinPagamento: ['pg', { por: 'a', em: 't' }], encerrarFinCredito: ['cr', 'devolvido', { por: 'a', em: 't' }],
  estornarFinLancamento: ['l', { por: 'a', em: 't' }], baixarFinPendencia: ['pe', { por: 'a', em: 't' }],
  renovarSessao: ['h', { renovada_em: 't' }], atualizarJogador: ['p1', { nome: 'Bia' }], atualizarCheckin: ['c1', { estrelas_ajustadas: 3 }],
  atualizarVitoriasAoVivo: [1, 2], definirStatusFinJogo: ['2026-10-13', 2, 'semjogo'], moverFilaParaJogo: ['2026-10-13', 1, 2],
  registrarTentativa: ['ip', 5, 60, 300], pegarTrava: ['gravacao', 'dono', 30], soltarTrava: ['gravacao', 'dono'],
  apagarSessoesVencidas: ['a@x.com', 't'], moverCheckinDeJogo: ['c1', 2]
};
const PADRAO = ['x'];

function conferirEscopo(op) {
  if (op.verbo === 'rpc') return op.params && op.params.p_grupo_id === G;
  if (op.verbo === 'insert' || op.verbo === 'upsert') {
    const l = Array.isArray(op.carga) ? op.carga : [op.carga];
    const conflitoOk = !op.opcoes || !op.opcoes.onConflict || op.opcoes.onConflict.startsWith('grupo_id,');
    return l.every((x) => x.grupo_id === G) && conflitoOk;
  }
  return op.filtros[0] && op.filtros[0][0] === 'eq' && op.filtros[0][1] === 'grupo_id' && op.filtros[0][2] === G;
}

t('mesma interface do repositório de hoje (nenhum método a mais nem a menos)', () => {
  const chaves = (r) => Object.keys(r).sort();
  assert.deepEqual(chaves(criarRepoMultigrupo(clienteGravador(), G, semEspera)), chaves(criarRepoSupabase(clienteGravador(), semEspera)));
});

await ta('TODO método do repositório só faz operações presas ao grupo', async () => {
  const nomes = Object.keys(criarRepoSupabase(clienteGravador(), semEspera));
  const semOperacao = [];
  for (const nome of nomes) {
    const c = clienteGravador();
    const repo = criarRepoMultigrupo(c, G, semEspera);
    await repo[nome](...(ARGS[nome] || PADRAO));
    if (!c.ops.length) semOperacao.push(nome);
    for (const op of c.ops) assert.ok(conferirEscopo(op), nome + ': operação fora do grupo ' + JSON.stringify(op));
  }
  assert.deepEqual(semOperacao, []); // todo método fala com o banco (senão o teste não provaria nada sobre ele)
});

await ta('lerTudo devolve só o que o banco filtrado devolve (uma consulta por tabela, todas filtradas)', async () => {
  const c = clienteGravador();
  const tudo = await criarRepoMultigrupo(c, G, semEspera).lerTudo();
  assert.ok(Object.keys(tudo).includes('jogadores'));
  assert.ok(c.ops.length >= Object.keys(tudo).length);
  assert.ok(c.ops.every(conferirEscopo));
});

fim();
