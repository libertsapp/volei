import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ta, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { dbParaAbas } from './dbParaAbas.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { criarVerificadorGoogle } from '../../backend/auth.js';

const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');
if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - apps-script-codigo.gs não existe nesta pasta (o arquivo é ignorado pelo git; copie-o da máquina do usuário).');
  process.exit(0);
}
const { criarAmbiente } = require('../helpers/planilha-falsa.js');

// cenário: o fixture (check-ins c1, c2 e c3 já existem). Depois de cada passo compara-se o GET SEM o financeiro:
// o .gs chama finAposAdicionarCheckin_/finAposRemoverCheckin_ (aplica créditos, sobe a fila de espera, escreve
// nas abas do Financeiro), que só chegam na etapa 4. Jogadores, rodadas, configurações, check-ins, perfis e
// ao vivo continuam sendo comparados por inteiro.
const dados = structuredClone(fixture);

// ---------- lado 1: o .gs REAL ----------
const gs = criarAmbiente(dbParaAbas(dados), [caminhoGs]);
const linhasUsuarios = gs.abas.Usuarios.linhas;
dados.usuarios.slice().sort((a, b) => a.ordem - b.ordem).forEach((u, i) => {
  linhasUsuarios[i + 1][4] = gs.rodar('new Date(' + JSON.stringify(new Date(u.criado_em).toISOString()) + ')');
});
const CLIENTE = gs.rodar('GOOGLE_CLIENT_ID');
const SENHA = gs.rodar('ADMIN_PASSWORD'); // lida do .gs carregado, nunca em texto puro nos testes

// ---------- o "Google" falso, igual para os dois lados ----------
const exp = String(Math.floor(Date.now() / 1000) + 3600);
const base = { aud: CLIENTE, email_verified: 'true', exp };
const google = {
  'tok-a': { ...base, email: 'a@exemplo.com', name: 'A' },
  'tok-b': { ...base, email: 'b@exemplo.com', name: 'B' },
  'tok-c': { ...base, email: 'c@exemplo.com', name: 'C' }
};
gs.rodar('UrlFetchApp.fetch = function (url) { var t = decodeURIComponent(url.split("id_token=")[1]); var r = (' + JSON.stringify(google) + ')[t]; '
  + 'return r ? { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(r); } } '
  + ': { getResponseCode: function () { return 400; }, getContentText: function () { return "{}"; } }; };');

// ---------- lado 2: o backend novo (repositório em memória, mesmo "Google" falso) ----------
const buscar = async (url) => {
  const t = decodeURIComponent(url.split('id_token=')[1]);
  return google[t] ? { status: 200, json: async () => google[t] } : { status: 400, json: async () => ({}) };
};
const novo = criarHandler({
  repo: criarRepoMemoria(dados),
  config: { adminPassword: SENHA },
  verificarToken: criarVerificadorGoogle({ clientId: CLIENTE, buscar }),
  relogio: () => new Date()
});


const json = (x) => JSON.parse(JSON.stringify(x));
const semFinanceiro = ({ financeiro, ...resto }) => resto;

const passos = [
  ['addCheckin: só o obrigatório (padrões)', { action: 'addCheckin', idToken: 'tok-c', checkin: { id: 'k1', data: '2026-09-29', jogadorId: 'p1' } }],
  ['addCheckin: completo, com nota ajustada', { action: 'addCheckin', idToken: 'tok-b', checkin: { id: 'k2', data: '2026-09-29', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 3.5, sexo: 'M', estrelasAjustadas: '4.5' } }],
  ['addCheckin: mesmo jogador de novo em outro dia', { action: 'addCheckin', idToken: 'tok-a', checkin: { id: 'k3', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: '4', sexo: 'F' } }],
  ['addCheckin: mesmo jogador no mesmo dia (sem checagem)', { action: 'addCheckin', idToken: 'tok-a', checkin: { id: 'k4', data: '2026-10-06', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: 4, sexo: 'F' } }],
  ['addCheckin: nota ajustada 0 vira vazia', { action: 'addCheckin', idToken: 'tok-a', checkin: { id: 'k5', data: '2026-10-06', jogadorId: 'p2', jogadorNome: 'Bruno', estrelas: 0, estrelasAjustadas: 0 } }],
  ['addCheckin: sem token', { action: 'addCheckin', checkin: { id: 'k6', data: '2026-10-06', jogadorId: 'p2' } }],
  ['addCheckin: só a chave mestra não vale', { action: 'addCheckin', senha: SENHA, checkin: { id: 'k6', data: '2026-10-06', jogadorId: 'p2' } }],
  ['addCheckin: token inválido', { action: 'addCheckin', idToken: 'ruim', checkin: { id: 'k6', data: '2026-10-06', jogadorId: 'p2' } }],
  ['removeCheckin: só a chave mestra não vale', { action: 'removeCheckin', senha: SENHA, id: 'k1' }],
  ['removeCheckin: sem token', { action: 'removeCheckin', id: 'k1' }],
  ['removeCheckin: do meio da lista', { action: 'removeCheckin', idToken: 'tok-c', id: 'k2' }],
  ['removeCheckin: de novo dá erro', { action: 'removeCheckin', idToken: 'tok-c', id: 'k2' }],
  ['removeCheckin: id que nunca existiu', { action: 'removeCheckin', idToken: 'tok-b', id: 'nao-existe' }],
  ['removeCheckin: check-in antigo (do fixture)', { action: 'removeCheckin', idToken: 'tok-b', id: 'c3' }],
  ['addCheckin depois de remover: vai para o fim', { action: 'addCheckin', idToken: 'tok-b', checkin: { id: 'k7', data: '2026-10-13', jogadorId: 'p1', jogadorNome: 'Ana', estrelas: 4, sexo: 'F' } }],
  ['salvarEstrelasAjustadas: jogador é negado', { action: 'salvarEstrelasAjustadas', idToken: 'tok-c', checkins: [{ id: 'c1', estrelasAjustadas: 5 }] }],
  ['salvarEstrelasAjustadas: sem login nem senha é negado', { action: 'salvarEstrelasAjustadas', checkins: [{ id: 'c1', estrelasAjustadas: 5 }] }],
  ['salvarEstrelasAjustadas: organizador grava vários (inclui inexistente e sem id)', { action: 'salvarEstrelasAjustadas', idToken: 'tok-b', checkins: [{ id: 'c1', estrelasAjustadas: 2.5 }, { id: 'k1', estrelasAjustadas: '3' }, { id: 'nao-existe', estrelasAjustadas: 1 }, { estrelasAjustadas: 4 }, { id: '', estrelasAjustadas: 4 }] }],
  ['salvarEstrelasAjustadas: valor vazio limpa a nota', { action: 'salvarEstrelasAjustadas', idToken: 'tok-a', checkins: [{ id: 'c2', estrelasAjustadas: '' }, { id: 'k3', estrelasAjustadas: null }, { id: 'k4' }] }],
  ['salvarEstrelasAjustadas: chave mestra grava', { action: 'salvarEstrelasAjustadas', senha: SENHA, checkins: [{ id: 'k7', estrelasAjustadas: 4 }] }],
  ['salvarEstrelasAjustadas: lista vazia', { action: 'salvarEstrelasAjustadas', idToken: 'tok-b', checkins: [] }],
  ['salvarEstrelasAjustadas: sem a lista', { action: 'salvarEstrelasAjustadas', idToken: 'tok-b' }],
  ['salvarEstrelasAjustadas: só ids inexistentes é ok', { action: 'salvarEstrelasAjustadas', idToken: 'tok-b', checkins: [{ id: 'zzz', estrelasAjustadas: 1 }] }],
  ['removeCheckin: remove o primeiro, que tinha nota ajustada', { action: 'removeCheckin', idToken: 'tok-a', id: 'k1' }]
];

for (const [i, [nome, corpo]] of passos.entries()) {
  await ta(`passo ${String(i + 1).padStart(2, '0')}: ${nome}`, async () => {
    const esperado = gs.post(corpo);
    const obtido = json(await novo.post(corpo));
    assert.deepEqual(obtido, esperado, 'resposta diferente');
    assert.deepEqual(semFinanceiro(json(await novo.get())), semFinanceiro(gs.get()), 'o GET (sem o financeiro) ficou diferente depois deste passo');
  });
}

fim();
