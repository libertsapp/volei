import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ta, t, fim } from './executor.mjs';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';

const GRUPOS = [{ id: 'terca', nome: 'Vôlei de Terça' }, { id: 'meme', nome: 'Vôlei Meme Brasil' }, { id: 'outro', nome: 'Outro' }];
const amistoso = (id, de, para, extra = {}) => ({
  id, grupo_convidante: de, grupo_convidado: para, data: '2026-10-20', horario: '20:00', local: '', vagas_por_grupo: 6,
  status: 'pendente', vez_de: para, criado_por: 'b@exemplo.com', criado_em: '2026-10-12T15:00:00.000Z', atualizado_em: '2026-10-12T15:00:00.000Z', ...extra
});

t('SQL: cria as 5 tabelas no schema liga, liga RLS e cadastra terca e meme', () => {
  const sql = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'sql', 'liga', 'schema-liga.sql'), 'utf8');
  for (const tabela of ['grupos', 'amistosos', 'amistoso_mensagens', 'escalacoes', 'travas_escalacao']) {
    assert.match(sql, new RegExp('create table if not exists liga\\.' + tabela + ' '), tabela);
    assert.match(sql, new RegExp('alter table liga\\.' + tabela + ' enable row level security'), tabela + ' RLS');
  }
  assert.match(sql, /unique \(amistoso_id, grupo, jogador_id\)/);
  assert.match(sql, /\('terca', 'Vôlei de Terça'/);
  assert.match(sql, /\('meme', 'Vôlei Meme Brasil'/);
});

await ta('lerAmistososDoGrupo: só os amistosos em que o grupo participa, com mensagens/escalações/travas deles', async () => {
  const r = criarRepoLigaMemoria({
    grupos: GRUPOS,
    amistosos: [amistoso('a1', 'terca', 'meme'), amistoso('a2', 'meme', 'outro')],
    amistoso_mensagens: [{ id: 'm1', amistoso_id: 'a1' }, { id: 'm2', amistoso_id: 'a2' }],
    escalacoes: [{ id: 'e1', amistoso_id: 'a2', grupo: 'meme', jogador_id: 'x' }],
    travas_escalacao: [{ amistoso_id: 'a1', grupo: 'terca' }]
  });
  const doTerca = await r.lerAmistososDoGrupo('terca');
  assert.deepEqual(doTerca.amistosos.map((a) => a.id), ['a1']);
  assert.deepEqual(doTerca.mensagens.map((m) => m.id), ['m1']);
  assert.deepEqual(doTerca.escalacoes, []);
  assert.deepEqual(doTerca.travas, [{ amistoso_id: 'a1', grupo: 'terca' }]);
  assert.deepEqual((await r.lerAmistososDoGrupo('meme')).amistosos.map((a) => a.id).sort(), ['a1', 'a2']);
});

await ta('inserirAmistoso recusa id repetido e grupo inexistente (chaves do banco)', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS });
  await r.inserirAmistoso(amistoso('a1', 'terca', 'meme'));
  await assert.rejects(r.inserirAmistoso(amistoso('a1', 'terca', 'meme')), /duplicate key/);
  await assert.rejects(r.inserirAmistoso(amistoso('a9', 'terca', 'fantasma')), /foreign key/);
});

await ta('atualizarAmistosoSe: só atualiza se o status ainda é o esperado (concorrência otimista)', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [amistoso('a1', 'terca', 'meme')] });
  assert.equal(await r.atualizarAmistosoSe('a1', 'pendente', { status: 'marcado' }), true);
  assert.equal(await r.atualizarAmistosoSe('a1', 'pendente', { status: 'recusado' }), false); // quem chegou depois perde
  assert.equal((await r.lerAmistoso('a1')).amistoso.status, 'marcado');
  assert.equal(await r.atualizarAmistosoSe('nao-existe', 'pendente', { status: 'x' }), false);
});

await ta('escalações: unique por (amistoso, grupo, jogador); atualizar/remover devolvem se achou', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [amistoso('a1', 'terca', 'meme', { status: 'marcado' })] });
  const linha = { id: 'e1', amistoso_id: 'a1', grupo: 'terca', jogador_id: 'p1', nome: 'Ana', foto_url: null, criado_em: 't1' };
  assert.equal(await r.inserirEscalacao(linha), true);
  assert.equal(await r.inserirEscalacao({ ...linha, id: 'e2' }), false);
  assert.equal(await r.inserirEscalacao({ ...linha, id: 'e3', grupo: 'meme' }), true); // mesmo id de jogador no OUTRO grupo é outra pessoa
  assert.equal((await r.lerAmistoso('a1')).escalacoes[0].status, 'interessado'); // padrão da coluna
  assert.equal(await r.atualizarEscalacao('a1', 'terca', 'p1', { status: 'confirmado' }), true);
  assert.equal(await r.atualizarEscalacao('a1', 'terca', 'p9', { status: 'confirmado' }), false);
  assert.equal(await r.removerEscalacao('a1', 'terca', 'p1'), true);
  assert.equal(await r.removerEscalacao('a1', 'terca', 'p1'), false);
});

await ta('definirTrava liga e desliga sem duplicar', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [amistoso('a1', 'terca', 'meme')] });
  await r.definirTrava('a1', 'terca', true);
  await r.definirTrava('a1', 'terca', true);
  assert.deepEqual((await r.lerAmistoso('a1')).travas, [{ amistoso_id: 'a1', grupo: 'terca' }]);
  await r.definirTrava('a1', 'terca', false);
  assert.deepEqual((await r.lerAmistoso('a1')).travas, []);
});

await ta('lerAmistoso devolve null para id desconhecido e cópias (mexer no retorno não muda o "banco")', async () => {
  const r = criarRepoLigaMemoria({ grupos: GRUPOS, amistosos: [amistoso('a1', 'terca', 'meme')] });
  assert.equal(await r.lerAmistoso('x'), null);
  (await r.lerAmistoso('a1')).amistoso.status = 'mexido';
  assert.equal((await r.lerAmistoso('a1')).amistoso.status, 'pendente');
});

fim();
