// Exercita, no Supabase REAL, as ações da etapa 3b (check-in) com dados de teste e limpa tudo no fim. Confere também o que
// só o banco faz: a sequência de "ordem" dos check-ins e a chave estrangeira para jogadores.
// Uso: node tests/backend/integracao-etapa3b.mjs   (precisa do .env; as tabelas e sequências vêm dos ajustes anteriores)
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { criarRepoSupabase } from '../../backend/repo-supabase.js';
import { criarHandler } from '../../backend/handler.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
require('dotenv').config({ path: path.join(raiz, '.env'), quiet: true });
const { createClient } = require('@supabase/supabase-js');

const cliente = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SENHA = process.env.ADMIN_PASSWORD;
// add/removeCheckin exigem login do Google (a chave mestra não vale): aqui o "Google" é um verificador falso
const verificarToken = async () => ({ ok: true, email: 'teste-e3b@exemplo.com', nome: 'Teste 3b' });
const h = criarHandler({ repo: criarRepoSupabase(cliente), config: { adminPassword: SENHA }, verificarToken });
const logado = (corpo) => h.post({ idToken: 'qualquer', ...corpo });
const admin = (corpo) => h.post({ senha: SENHA, ...corpo });

const P = 'teste-e3b-jogador';
const K = ['teste-e3b-k1', 'teste-e3b-k2', 'teste-e3b-k3'];
const DIA = '2099-01-05';

async function limpar() {
  await cliente.from('checkins').delete().in('id', K);
  await cliente.from('jogadores').delete().eq('id', P);
}
const doTeste = (g) => g.checkins.filter((c) => K.includes(c.id));

let antes = 0;
await limpar(); // sobra de uma execução anterior interrompida
try {
  antes = (await h.get()).checkins.length;

  await ta('jogador temporário criado; check-in novo entra no fim (ordem do banco é a maior)', async () => {
    assert.deepEqual(await admin({ action: 'addPlayer', player: { id: P, nome: 'Teste Etapa 3b', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
    assert.deepEqual(await logado({ action: 'addCheckin', checkin: { id: K[0], data: DIA, jogadorId: P, jogadorNome: 'Teste Etapa 3b', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
    const { data } = await cliente.from('checkins').select('id, ordem').eq('id', K[0]);
    const { data: todas } = await cliente.from('checkins').select('ordem').not('ordem', 'is', null);
    assert.ok(data[0].ordem === Math.max(...todas.map((x) => x.ordem)), 'ordem do check-in novo deve ser a maior; veio ' + data[0].ordem);
    const g = await h.get();
    assert.equal(g.checkins.length, antes + 1);
    assert.equal(g.checkins.at(-1).id, K[0]);
  });

  await ta('mais dois check-ins, um repetindo o jogador no mesmo dia (sem checagem), e a ordem cresce', async () => {
    assert.deepEqual(await logado({ action: 'addCheckin', checkin: { id: K[1], data: DIA, jogadorId: P, jogadorNome: 'Teste Etapa 3b', estrelas: 3, sexo: 'M' } }), { status: 'ok' });
    assert.deepEqual(await logado({ action: 'addCheckin', checkin: { id: K[2], data: DIA, jogadorId: P, estrelas: '2.5', estrelasAjustadas: '4' } }), { status: 'ok' });
    const g = await h.get();
    assert.deepEqual(g.checkins.slice(-3).map((c) => c.id), K);
    assert.equal(g.checkins.at(-1).estrelasAjustadas, '4');
    assert.equal(g.checkins.at(-1).estrelas, 2.5);
  });

  await ta('id repetido é recusado com mensagem clara', async () => {
    assert.deepEqual(await logado({ action: 'addCheckin', checkin: { id: K[0], data: DIA, jogadorId: P } }), { error: 'Já existe um check-in com esse id.' });
  });

  await ta('removeCheckin do meio: some da lista, os outros mantêm a ordem; repetir dá a mensagem do .gs', async () => {
    assert.deepEqual(await logado({ action: 'removeCheckin', id: K[1] }), { status: 'ok' });
    assert.deepEqual(doTeste(await h.get()).map((c) => c.id), [K[0], K[2]]);
    assert.deepEqual(await logado({ action: 'removeCheckin', id: K[1] }), { error: 'Check-in não encontrado (pode já ter sido desmarcado).' });
  });

  await ta('salvarEstrelasAjustadas: grava, limpa e ignora id inexistente; GET reflete', async () => {
    assert.deepEqual(await admin({ action: 'salvarEstrelasAjustadas', checkins: [{ id: K[0], estrelasAjustadas: 4.5 }, { id: K[2], estrelasAjustadas: '' }, { id: 'teste-e3b-nao-existe', estrelasAjustadas: 1 }] }), { status: 'ok' });
    const t = doTeste(await h.get());
    assert.deepEqual(t.map((c) => [c.id, c.estrelasAjustadas]), [[K[0], '4.5'], [K[2], '']]);
    assert.deepEqual(await admin({ action: 'salvarEstrelasAjustadas', checkins: [] }), { error: 'Lista de check-ins vazia.' });
  });

  await ta('jogador desconhecido é recusado pela chave estrangeira e nada é gravado', async () => {
    const r = await logado({ action: 'addCheckin', checkin: { id: 'teste-e3b-fk', data: DIA, jogadorId: 'jogador-que-nao-existe' } });
    assert.ok(r.error && /foreign key|violates/i.test(r.error), 'esperava erro de chave estrangeira, veio ' + JSON.stringify(r));
    assert.ok(!(await h.get()).checkins.some((c) => c.id === 'teste-e3b-fk'));
  });
} finally {
  await limpar();
  const g = await h.get();
  const { data: sobra } = await cliente.from('jogadores').select('id').eq('id', P);
  console.log('limpeza: check-ins', antes, '->', g.checkins.length, '| jogador de teste restante:', sobra.length,
    g.checkins.length === antes && sobra.length === 0 ? '(banco como estava)' : '(ATENÇÃO: diferente!)');
}
fim();
