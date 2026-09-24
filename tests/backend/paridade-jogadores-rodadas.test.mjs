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

// cenário: o fixture + Carla (p3), jogadora sem conta; a conta c@ é jogadora e o admin a vincula a p3 durante o cenário
const dados = structuredClone(fixture);
dados.jogadores.push({ id: 'p3', nome: 'Carla', apelido: 'Carlinha', foto: '', estrelas: 3, sexo: 'F', porte: 'M', convidado: false, removido: false, ordem: 3 });

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

const r10 = { id: 'r10', data: '2026-10-06', rascunho: false, vencedores: [1], times: [
  { nome: 'Time 1', vitorias: 1, playerIds: ['p1', 'p10'] },
  { nome: 'Time 2', vitorias: 3, playerIds: ['p2', 'convidado:LUCAS#ab12', 'p3'] }
] };
const r11 = { id: 'r11', data: '2026-10-13', rascunho: true, vencedores: [0, 1], times: [
  { nome: 'A', vitorias: 2, playerIds: ['p3'] }, { nome: 'B', vitorias: 2, playerIds: ['p1', 'p2'] }, { nome: 'C', vitorias: 0, playerIds: [] }
] };
const cfg = { estrelasVisiveis: false, checkinDataAberta: '2026-10-20', checkinTravado: true, checkinVagas: 12, checkinHorario: '21:00', checkinMensagemTemplate: 'Vôlei {data} às {horario}' };
const igualP3 = { id: 'p3', nome: 'Carla', apelido: 'Carlinha', estrelas: 3, sexo: 'F', porte: 'M' };

const passos = [
  ['addPlayer: completo', { action: 'addPlayer', senha: SENHA, player: { id: 'p10', nome: 'Diego', apelido: 'Di', foto: 'https://x/d.jpg', estrelas: 3.5, sexo: 'M', porte: 'G' } }],
  ['addPlayer: só o obrigatório', { action: 'addPlayer', idToken: 'tok-b', player: { id: 'p11', nome: 'Eva' } }],
  ['addPlayer: estrelas como texto', { action: 'addPlayer', idToken: 'tok-a', player: { id: 'p12', nome: 'Fábio', estrelas: '4', sexo: 'M', porte: 'P' } }],
  ['updatePlayer: muda vários campos', { action: 'updatePlayer', idToken: 'tok-b', player: { id: 'p10', nome: 'Diego S', apelido: '', foto: '', estrelas: 4.5, sexo: 'M', porte: 'M' } }],
  ['updatePlayer: jogador inexistente', { action: 'updatePlayer', senha: SENHA, player: { id: 'nao-existe', nome: 'X' } }],
  ['updatePlayer: id de convidado não existe na aba', { action: 'updatePlayer', senha: SENHA, player: { id: 'convidado:LUCAS#ab12', nome: 'X' } }],
  ['removePlayer: inexistente', { action: 'removePlayer', senha: SENHA, id: 'nao-existe' }],
  ['removePlayer: organizador não pode', { action: 'removePlayer', idToken: 'tok-b', id: 'p12' }],
  ['addRound: dois times, vencedor, convidado e jogador novo', { action: 'addRound', idToken: 'tok-b', round: r10 }],
  ['addRound: rascunho com empate de vencedores e time vazio', { action: 'addRound', idToken: 'tok-b', round: r11 }],
  ['addRound: sem times não deixa rastro', { action: 'addRound', idToken: 'tok-b', round: { id: 'r12', data: '2026-10-27', times: [] } }],
  ['updateRound: troca times e vai para o fim', { action: 'updateRound', idToken: 'tok-b', round: { ...r10, vencedores: [0], times: [{ nome: 'Time 1', vitorias: 3, playerIds: ['p2', 'p1'] }, { nome: 'Time 2', vitorias: 1, playerIds: ['p10', 'convidado:NOVO#cd34'] }] } }],
  ['updateRound: id que não existe cria a rodada', { action: 'updateRound', senha: SENHA, round: { id: 'r13', data: '2026-11-03', vencedores: [], times: [{ nome: 'Z', vitorias: 0, playerIds: ['p3'] }] } }],
  ['updateRound: sem times remove a rodada', { action: 'updateRound', senha: SENHA, round: { id: 'r13', data: '2026-11-03', times: [] } }],
  ['removeRound: organizador não pode', { action: 'removeRound', idToken: 'tok-b', id: 'r11' }],
  ['removeRound: admin remove', { action: 'removeRound', idToken: 'tok-a', id: 'r11' }],
  ['removeRound: de novo dá erro', { action: 'removeRound', idToken: 'tok-a', id: 'r11' }],
  ['removePlayer: admin remove p10 (a rodada continua citando o id)', { action: 'removePlayer', idToken: 'tok-a', id: 'p10' }],
  ['removePlayer: de novo dá erro', { action: 'removePlayer', idToken: 'tok-a', id: 'p10' }],
  ['updatePlayer: removido não é achado', { action: 'updatePlayer', senha: SENHA, player: { id: 'p10', nome: 'Diego' } }],
  ['saveSettings: admin grava tudo (o contador de acessos é preservado)', { action: 'saveSettings', idToken: 'tok-a', settings: { ...cfg, contadorAcessos: 99999 } }],
  ['saveSettings: organizador não pode', { action: 'saveSettings', idToken: 'tok-b', settings: cfg }],
  ['saveCheckinSettings: organizador grava', { action: 'saveCheckinSettings', idToken: 'tok-b', settings: { ...cfg, checkinTravado: false, checkinVagas: 0 } }],
  ['saveCheckinSettings: chaves ausentes viram os padrões', { action: 'saveCheckinSettings', idToken: 'tok-b', settings: {} }],
  ['foto: jogador ainda sem vínculo é negado', { action: 'updatePlayer', idToken: 'tok-c', player: { ...igualP3, foto: 'https://x/c.jpg' } }],
  ['vínculo: admin liga a conta c@ ao jogador p3', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'p3' } }],
  ['foto: jogador vinculado troca só a foto', { action: 'updatePlayer', idToken: 'tok-c', player: { ...igualP3, foto: 'https://x/c.jpg' } }],
  ['foto: tentar mudar as estrelas é negado', { action: 'updatePlayer', idToken: 'tok-c', player: { ...igualP3, estrelas: 5, foto: 'https://x/c.jpg' } }],
  ['foto: tentar mudar o nome é negado', { action: 'updatePlayer', idToken: 'tok-c', player: { ...igualP3, nome: 'Outra' } }],
  ['foto: mexer no cadastro de outro jogador é negado', { action: 'updatePlayer', idToken: 'tok-c', player: { id: 'p1', nome: 'Ana', estrelas: 4, sexo: 'F', porte: 'P', foto: 'x' } }],
  ['foto: jogador comum não cadastra', { action: 'addPlayer', idToken: 'tok-c', player: { id: 'p20', nome: 'X' } }],
  ['foto: jogador comum não mexe em rodada', { action: 'addRound', idToken: 'tok-c', round: r10 }]
];

for (const [i, [nome, corpo]] of passos.entries()) {
  await ta(`passo ${String(i + 1).padStart(2, '0')}: ${nome}`, async () => {
    const esperado = gs.post(corpo);
    const obtido = json(await novo.post(corpo));
    assert.deepEqual(obtido, esperado, 'resposta diferente');
    assert.deepEqual(json(await novo.get()), gs.get(), 'o GET completo ficou diferente depois deste passo');
  });
}

fim();
