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

// cenário: o fixture + um jogador (p3) sem vínculo, para os pedidos de vínculo
const dados = structuredClone(fixture);
dados.jogadores.push({ id: 'p3', nome: 'Carla Souza', apelido: null, foto: null, estrelas: 3, sexo: 'F', porte: 'M', convidado: false, ordem: 3 });

// ---------- lado 1: o .gs REAL ----------
const gs = criarAmbiente(dbParaAbas(dados), [caminhoGs]);
// a data de criação precisa ser um Date do PRÓPRIO contexto do .gs (ele testa `instanceof Date`)
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
  'tok-c': { ...base, email: 'c@exemplo.com', name: 'C' },
  'tok-n': { ...base, email: ' N@Exemplo.com ', name: 'Carla Souza' },
  'tok-n2': { ...base, email: 'm@exemplo.com', name: 'Carla' },
  'tok-b-renomeado': { ...base, email: 'b@exemplo.com', name: 'Bruno Novo' },
  'tok-outro-app': { ...base, aud: 'outro-app', email: 'z@exemplo.com', name: 'Z' },
  'tok-nao-verificado': { ...base, email_verified: 'false', email: 'z@exemplo.com', name: 'Z' },
  'tok-expirado': { ...base, exp: '1', email: 'z@exemplo.com', name: 'Z' }
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

// usuários criados DURANTE o cenário recebem a data de hoje: normaliza para não depender do fuso da hora do teste
const EMAILS_INICIAIS = new Set(dados.usuarios.map((u) => u.email));
function normalizar(x) {
  if (Array.isArray(x)) return x.map(normalizar);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = normalizar(x[k]);
    if ('email' in o && 'criadoEm' in o && !EMAILS_INICIAIS.has(o.email)) o.criadoEm = '<hoje>';
    return o;
  }
  return x;
}

const passos = [
  ['login: admin existente', { action: 'loginGoogle', idToken: 'tok-a' }],
  ['login: conta nova (e-mail com maiúscula e espaço) ganha sugestão exata', { action: 'loginGoogle', idToken: 'tok-n' }],
  ['login: mesma conta de novo (não é mais o primeiro login)', { action: 'loginGoogle', idToken: 'tok-n' }],
  ['login: outra conta nova, sugestão por primeiro nome', { action: 'loginGoogle', idToken: 'tok-n2' }],
  ['login: nome da conta mudou (atualiza sem mexer no perfil)', { action: 'loginGoogle', idToken: 'tok-b-renomeado' }],
  ['login: token de outro aplicativo', { action: 'loginGoogle', idToken: 'tok-outro-app' }],
  ['login: e-mail não verificado', { action: 'loginGoogle', idToken: 'tok-nao-verificado' }],
  ['login: token expirado', { action: 'loginGoogle', idToken: 'tok-expirado' }],
  ['login: token que o Google recusa', { action: 'loginGoogle', idToken: 'lixo' }],
  ['login: sem token', { action: 'loginGoogle' }],
  ['vínculo: conta nova pede p3', { action: 'solicitarVinculo', idToken: 'tok-n', jogadorId: 'p3' }],
  ['vínculo: outra conta pede o mesmo p3 (pedido pendente)', { action: 'solicitarVinculo', idToken: 'tok-n2', jogadorId: 'p3' }],
  ['vínculo: pede jogador já vinculado a outro e-mail', { action: 'solicitarVinculo', idToken: 'tok-n', jogadorId: 'p1' }],
  ['vínculo: pede jogador inexistente', { action: 'solicitarVinculo', idToken: 'tok-n', jogadorId: 'nao-existe' }],
  ['vínculo: chave mestra não identifica pessoa', { action: 'solicitarVinculo', senha: SENHA, jogadorId: 'p3' }],
  ['vínculo: aprovar e-mail que não existe', { action: 'aprovarVinculo', idToken: 'tok-b', email: 'x@exemplo.com' }],
  ['vínculo: aprovar quem não tem pedido', { action: 'aprovarVinculo', idToken: 'tok-b', email: 'c@exemplo.com' }],
  ['vínculo: organizador aprova o pedido', { action: 'aprovarVinculo', idToken: 'tok-b', email: 'n@exemplo.com' }],
  ['vínculo: jogador comum não pode aprovar', { action: 'aprovarVinculo', idToken: 'tok-c', email: 'm@exemplo.com' }],
  ['vínculo: admin rejeita pedido inexistente', { action: 'rejeitarVinculo', idToken: 'tok-a', email: 'x@exemplo.com' }],
  ['vínculo: conta desiste do pedido (jogadorId vazio)', { action: 'solicitarVinculo', idToken: 'tok-c', jogadorId: '' }],
  ['listar: organizador (sem cargo)', { action: 'listarUsuarios', idToken: 'tok-b' }],
  ['listar: admin (com cargo)', { action: 'listarUsuarios', idToken: 'tok-a' }],
  ['listar: chave mestra', { action: 'listarUsuarios', senha: SENHA }],
  ['listar: jogador comum é negado', { action: 'listarUsuarios', idToken: 'tok-c' }],
  ['salvar: sem e-mail', { action: 'salvarUsuario', idToken: 'tok-a', usuario: {} }],
  ['salvar: perfil inválido', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'xpto' } }],
  ['salvar: rebaixar o último admin', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'a@exemplo.com', perfil: 'jogador' } }],
  ['salvar: jogador inexistente', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'nao-existe' } }],
  ['salvar: jogador já vinculado a outro', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'jogador', jogadorId: 'p1' } }],
  ['salvar: promove b a admin', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'b@exemplo.com', perfil: 'admin', jogadorId: 'p2' } }],
  ['salvar: agora pode rebaixar a', { action: 'salvarUsuario', idToken: 'tok-b', usuario: { email: 'a@exemplo.com', perfil: 'organizador', jogadorId: 'p1' } }],
  ['salvar: admin promove c a organizador', { action: 'salvarUsuario', idToken: 'tok-a', usuario: { email: 'c@exemplo.com', perfil: 'organizador' } }],
  ['remover: e-mail que não existe', { action: 'removerUsuario', idToken: 'tok-b', email: 'x@exemplo.com' }],
  ['remover: c', { action: 'removerUsuario', idToken: 'tok-b', email: 'c@exemplo.com' }],
  ['remover: último admin (b)', { action: 'removerUsuario', idToken: 'tok-b', email: 'b@exemplo.com' }],
  ['herdado: rejeitar vínculo zera o vínculo aprovado de b', { action: 'rejeitarVinculo', idToken: 'tok-b', email: 'b@exemplo.com' }],
  ['bootstrap: chave errada', { action: 'bootstrapAdmin', senha: 'errada', idToken: 'tok-n2' }],
  ['bootstrap: chave certa com token inválido', { action: 'bootstrapAdmin', senha: SENHA, idToken: 'lixo' }],
  ['bootstrap: chave certa promove m a admin', { action: 'bootstrapAdmin', senha: SENHA, idToken: 'tok-n2' }],
  ['porteiro: ação desconhecida', { action: 'xpto', senha: SENHA }],
  ['porteiro: senha errada sem token', { action: 'listarUsuarios', senha: 'errada' }],
  ['porteiro: senha errada com token cai no token', { action: 'listarUsuarios', senha: 'errada', idToken: 'tok-b' }],
  ['porteiro: sem nada', { action: 'listarUsuarios' }],
  ['ping: chave mestra', { action: 'ping', senha: SENHA }],
  ['ping: jogador', { action: 'ping', idToken: 'tok-c' }],
  ['ping: conta promovida a admin pelo bootstrap', { action: 'ping', idToken: 'tok-n2' }]
];

for (const [i, [nome, corpo]] of passos.entries()) {
  await ta(`passo ${String(i + 1).padStart(2, '0')}: ${nome}`, async () => {
    const esperado = normalizar(gs.post(corpo));
    const obtido = normalizar(JSON.parse(JSON.stringify(await novo.post(corpo))));
    assert.deepEqual(obtido, esperado);
  });
}

await ta('estado final: perfisPublicos do GET e lista completa de usuários iguais', async () => {
  const esperadoGet = normalizar(gs.get().perfisPublicos);
  const obtidoGet = normalizar(JSON.parse(JSON.stringify((await novo.get()).perfisPublicos)));
  assert.deepEqual(obtidoGet, esperadoGet);
  const corpo = { action: 'listarUsuarios', senha: SENHA };
  assert.deepEqual(normalizar(JSON.parse(JSON.stringify(await novo.post(corpo)))), normalizar(gs.post(corpo)));
});

fim();
