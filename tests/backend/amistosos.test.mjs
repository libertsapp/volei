import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';
import { statusEfetivo, inicioDoJogo, mapearLiga, lerBlocoLiga, ligaVazia } from '../../backend/amistosos.js';

const GRUPOS = [{ id: 'terca', nome: 'Vôlei de Terça', cor: '#ffd700' }, { id: 'meme', nome: 'Vôlei Meme Brasil', cor: '#b3790a' }, { id: 'outro', nome: 'Outro' }];
const linha = (id, extra = {}) => ({
  id, grupo_convidante: 'terca', grupo_convidado: 'meme', data: '2026-10-20', horario: '20:00', local: 'Quadra X', vagas_por_grupo: 6,
  status: 'pendente', vez_de: 'meme', criado_por: 'b@exemplo.com', criado_em: '2026-10-12T15:00:00.000Z', atualizado_em: '2026-10-12T15:00:00.000Z', ...extra
});
const AGORA = new Date('2026-10-12T15:00:00.000Z');

t('inicioDoJogo usa o horário de Brasília (-03:00)', () => {
  assert.equal(inicioDoJogo(linha('a')).toISOString(), '2026-10-20T23:00:00.000Z');
});

t('statusEfetivo: placar parado 7 dias vira encerrado; antes disso continua aguardando; outros status não mudam', () => {
  const a = linha('a', { status: 'aguardando_confirmacao', placar_lancado_em: '2026-10-21T00:00:00.000Z' });
  assert.equal(statusEfetivo(a, new Date('2026-10-27T23:59:59.000Z')), 'aguardando_confirmacao');
  assert.equal(statusEfetivo(a, new Date('2026-10-28T00:00:00.000Z')), 'encerrado');
  assert.equal(statusEfetivo(linha('b', { status: 'marcado' }), new Date('2030-01-01')), 'marcado');
});

t('mapearLiga: formato do front, adversário do ponto de vista do grupo, grupos inativos fora', () => {
  const bloco = mapearLiga({ grupos: [...GRUPOS, { id: 'velho', nome: 'Velho', ativo: false }], amistosos: [linha('a1')], mensagens: [], escalacoes: [], travas: [] }, 'meme', AGORA);
  assert.equal(bloco.disponivel, true);
  assert.equal(bloco.grupoId, 'meme');
  assert.deepEqual(bloco.grupos.map((g) => g.id), ['terca', 'meme', 'outro']);
  assert.deepEqual(bloco.grupos[0], { id: 'terca', nome: 'Vôlei de Terça', logoUrl: '', cor: '#ffd700' });
  const a = bloco.amistosos[0];
  assert.equal(a.adversario, 'terca');
  assert.equal(a.convidante, 'terca');
  assert.equal(a.vezDe, 'meme');
  assert.equal(a.vagasPorGrupo, 6);
  assert.equal(a.local, 'Quadra X');
  assert.deepEqual(a.parciais, []);
  assert.equal(a.setsConvidante, null);
});

t('mapearLiga: o próprio grupo vê interessados e confirmados; o adversário só confirmados + contagem', () => {
  // criado_em de verdade é timestamp; 't1'..'t3' viram horários em ordem crescente
  const esc = (grupo, jogador, status, criado) => ({ id: grupo + jogador, amistoso_id: 'a1', grupo, jogador_id: jogador, nome: jogador.toUpperCase(), foto_url: null, status, criado_em: '2026-10-13T10:0' + criado.slice(1) + ':00.000Z' });
  const bruto = {
    grupos: GRUPOS, amistosos: [linha('a1', { status: 'marcado', vez_de: null })], mensagens: [],
    escalacoes: [esc('terca', 'p2', 'interessado', 't2'), esc('terca', 'p1', 'confirmado', 't1'), esc('meme', 'm1', 'confirmado', 't1'), esc('meme', 'm2', 'interessado', 't2'), esc('meme', 'm3', 'interessado', 't3')],
    travas: [{ amistoso_id: 'a1', grupo: 'terca' }]
  };
  const doTerca = mapearLiga(bruto, 'terca', AGORA).amistosos[0];
  assert.equal(doTerca.minhaEscalacao.travada, true);
  assert.deepEqual(doTerca.minhaEscalacao.jogadores.map((j) => [j.jogadorId, j.status]), [['p1', 'confirmado'], ['p2', 'interessado']]); // ordem de chegada
  assert.deepEqual(doTerca.escalacaoAdversario, { confirmados: [{ jogadorId: 'm1', nome: 'M1', foto: '' }], interessados: 2 });
  const doMeme = mapearLiga(bruto, 'meme', AGORA).amistosos[0];
  assert.equal(doMeme.minhaEscalacao.travada, false);
  assert.equal(doMeme.minhaEscalacao.jogadores.length, 3);
  assert.deepEqual(doMeme.escalacaoAdversario.confirmados.map((p) => p.jogadorId), ['p1']);
});

t('mapearLiga: ignora amistoso de outros grupos; histórico corta nos 50 mais recentes; ativos sempre entram', () => {
  const fechados = Array.from({ length: 60 }, (_, i) => linha('f' + i, { status: 'encerrado', data: '2025-01-' + String((i % 28) + 1).padStart(2, '0'), sets_convidante: 3, sets_convidado: 1 }));
  const bruto = { grupos: GRUPOS, amistosos: [linha('ativo'), linha('alheio', { grupo_convidante: 'meme', grupo_convidado: 'outro' }), ...fechados], mensagens: [], escalacoes: [], travas: [] };
  const bloco = mapearLiga(bruto, 'terca', AGORA);
  assert.ok(bloco.amistosos.some((a) => a.id === 'ativo'));
  assert.ok(!bloco.amistosos.some((a) => a.id === 'alheio'));
  assert.equal(bloco.amistosos.filter((a) => a.status === 'encerrado').length, 50);
});

t('mapearLiga: mensagens em ordem de chegada, com o status efetivo aplicado', () => {
  const bruto = {
    grupos: GRUPOS,
    amistosos: [linha('a1', { status: 'aguardando_confirmacao', placar_lancado_em: '2026-10-01T00:00:00.000Z', placar_lancado_por_grupo: 'terca', sets_convidante: 3, sets_convidado: 2 })],
    mensagens: [{ id: 'm2', amistoso_id: 'a1', grupo: 'meme', autor_nome: 'B', tipo: 'aceite', texto: '', criado_em: '2026-09-02T00:00:00.000Z' },
                { id: 'm1', amistoso_id: 'a1', grupo: 'terca', autor_nome: 'A', tipo: 'convite', texto: 'bora', criado_em: '2026-09-01T00:00:00.000Z' }],
    escalacoes: [], travas: []
  };
  const a = mapearLiga(bruto, 'terca', AGORA).amistosos[0];
  assert.equal(a.status, 'encerrado'); // 11 dias depois do placar
  assert.deepEqual(a.mensagens.map((m) => m.tipo), ['convite', 'aceite']);
  assert.deepEqual(a.mensagens[0], { grupo: 'terca', autorNome: 'A', tipo: 'convite', texto: 'bora', criadoEm: '2026-09-01T00:00:00.000Z' });
});

await ta('lerBlocoLiga: sem liga configurada devolve o bloco vazio', async () => {
  assert.deepEqual(await lerBlocoLiga({ repo: criarRepoMemoria(fixture) }), ligaVazia(''));
});

await ta('lerBlocoLiga: schema liga ausente (repo lança) não derruba — devolve vazio e avisa', async () => {
  const avisos = [];
  const repoQuebrado = { lerGrupos: async () => { throw new Error('grupos: relation "liga.grupos" does not exist'); }, lerAmistososDoGrupo: async () => ({}) };
  const r = await lerBlocoLiga({ repo: criarRepoMemoria(fixture), liga: { repo: repoQuebrado, grupoId: 'terca' }, avisar: (m) => avisos.push(m) });
  assert.deepEqual(r, ligaVazia('terca'));
  assert.equal(avisos.length, 1);
});

await ta('lerBlocoLiga: com liga, devolve o mapeamento do grupo', async () => {
  const liga = { repo: criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [linha('a1')] }), grupoId: 'terca' };
  const r = await lerBlocoLiga({ repo: criarRepoMemoria(fixture), liga, relogio: () => AGORA });
  assert.equal(r.disponivel, true);
  assert.deepEqual(r.amistosos.map((a) => a.id), ['a1']);
});

fim();
