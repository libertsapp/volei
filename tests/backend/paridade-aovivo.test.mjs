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

// Teste diferencial da etapa 5: o .gs REAL (planilha falsa) e o backend novo (repositório em memória) recebem os mesmos pedidos;
// depois de CADA passo compara-se a resposta e o GET inteiro (incluindo aoVivo e settings.contadorAcessos). Cobre
// iniciarTransmissaoAoVivo, salvarParcialAoVivo, cancelarTransmissaoAoVivo, a leitura pública lerAoVivo e o incrementarAcesso.
// Nada é normalizado: o relógio (Date do .gs e relogio() do backend) é controlado e igual dos dois lados.
// FORA da comparação (diferença aceita e documentada no spec da etapa 5): remover uma rodada (removeRound, ou updateRound sem
// times) que está ao vivo. O .gs deixa uma linha órfã na aba AoVivo; o backend novo encerra a transmissão junto (a chave
// estrangeira de ao_vivo não deixaria apagar a rodada). Isso é conferido em aovivo.test.mjs, não aqui.
const require = createRequire(import.meta.url);
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const caminhoGs = path.join(raiz, 'apps-script-codigo.gs');
if (!fs.existsSync(caminhoGs)) {
  console.log('PULADO - apps-script-codigo.gs não existe nesta pasta (o arquivo é ignorado pelo git; copie-o da máquina do usuário).');
  process.exit(0);
}
const { criarAmbiente } = require('../helpers/planilha-falsa.js');
const json = (x) => JSON.parse(JSON.stringify(x));

// ---------- estado inicial: fixture + o rascunho "rd" (Azul: Ana e Bruno / Verde: o convidado) ----------
function dadosBase() {
  const dados = structuredClone(fixture);
  dados.rodadas.push({ round_id: 'rd', data: '2026-09-29', rascunho: true, ordem: 3 });
  dados.times_rodada.push(
    { id: 30, round_id: 'rd', time_index: 0, time_nome: 'Azul', vitorias: 0, vencedor: false },
    { id: 31, round_id: 'rd', time_index: 1, time_nome: 'Verde', vitorias: 1, vencedor: false });
  dados.time_jogadores.push(
    { time_rodada_id: 30, jogador_id: 'p1', posicao: 0 }, { time_rodada_id: 30, jogador_id: 'p2', posicao: 1 },
    { time_rodada_id: 31, jogador_id: 'convidado:LUCAS#ab12', posicao: 0 });
  return dados;
}

function montar(estadoInicial) {
  const T0 = Date.parse('2026-09-30T19:00:00.000Z');
  const gs = criarAmbiente(dbParaAbas(estadoInicial), [caminhoGs]);
  // relógio controlado no .gs (antes de qualquer Date criado no contexto, para o instanceof Date continuar valendo)
  gs.rodar('var __relogio = { t: ' + T0 + ' }; Date = (function (R) { return class D extends R { constructor(...a) { if (a.length === 0) super(__relogio.t); else super(...a); } static now() { return __relogio.t; } }; })(Date);');
  const linhasUsuarios = gs.abas.Usuarios.linhas;
  estadoInicial.usuarios.slice().sort((a, b) => a.ordem - b.ordem).forEach((u, i) => {
    linhasUsuarios[i + 1][4] = gs.rodar('new Date(' + JSON.stringify(new Date(u.criado_em).toISOString()) + ')');
  });
  const CLIENTE = gs.rodar('GOOGLE_CLIENT_ID');
  const SENHA = gs.rodar('ADMIN_PASSWORD'); // lida do .gs carregado, nunca em texto puro nos testes
  const exp = String(Math.floor(T0 / 1000) + 3600);
  const base = { aud: CLIENTE, email_verified: 'true', exp };
  const google = {
    'tok-a': { ...base, email: 'a@exemplo.com', name: 'A' },
    'tok-b': { ...base, email: 'b@exemplo.com', name: 'B' },
    'tok-c': { ...base, email: 'c@exemplo.com', name: 'C' }
  };
  gs.rodar('UrlFetchApp.fetch = function (url) { var t = decodeURIComponent(url.split("id_token=")[1]); var r = (' + JSON.stringify(google) + ')[t]; '
    + 'return r ? { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify(r); } } '
    + ': { getResponseCode: function () { return 400; }, getContentText: function () { return "{}"; } }; };');
  const buscar = async (url) => {
    const t = decodeURIComponent(url.split('id_token=')[1]);
    return google[t] ? { status: 200, json: async () => google[t] } : { status: 400, json: async () => ({}) };
  };
  const relogio = { t: T0 };
  let seq = 0;
  const repo = criarRepoMemoria(estadoInicial);
  const novo = criarHandler({
    repo, config: { adminPassword: SENHA }, verificarToken: criarVerificadorGoogle({ clientId: CLIENTE, buscar }),
    relogio: () => new Date(relogio.t), gerarId: () => 'uuid-' + (++seq)
  });
  const avancar = (i) => { relogio.t = T0 + i * 1000 + 123; gs.rodar('__relogio.t = ' + relogio.t); };
  return { gs, repo, novo, SENHA, avancar };
}

// passo: [nome, corpo | (env)=>corpo, esperado] — esperado: 'ok' ou um trecho da mensagem de erro (garante que os dois lados
// fizeram o que o passo queria, não só que erraram igual); 'lista' = resposta sem "status"/"error" (leituras). Passo AMBIENTE:
// [nome, { ambiente: (env) => ... }] (mexe nos dois lados antes da comparação seguinte)
async function rodar(titulo, env, passos) {
  const S = env.SENHA;
  for (const [i, [nome, corpo0, esperado]] of passos.entries()) {
    await ta(`${titulo} passo ${String(i + 1).padStart(2, '0')}: ${nome}`, async () => {
      env.avancar(i + 1);
      if (corpo0 && corpo0.ambiente) corpo0.ambiente(env);
      else {
        const corpo = typeof corpo0 === 'function' ? corpo0(env, S) : corpo0;
        const esperadoGs = env.gs.post(corpo);
        if (process.env.DBG) console.log('   >', JSON.stringify(esperadoGs));
        const obtido = json(await env.novo.post(corpo));
        assert.deepEqual(obtido, esperadoGs, 'resposta diferente');
        if (esperado === 'ok') assert.equal(esperadoGs.status, 'ok', 'era para dar ok: ' + JSON.stringify(esperadoGs.error));
        else if (esperado === 'lista') assert.ok(Array.isArray(esperadoGs.rounds), 'era para ser uma leitura do Ao Vivo');
        else if (esperado === 'contador') assert.equal(typeof esperadoGs.contadorAcessos, 'number');
        else if (esperado) assert.ok(String(esperadoGs.error).includes(esperado), 'erro esperado "' + esperado + '", veio ' + JSON.stringify(esperadoGs.error));
      }
      assert.deepEqual(json(await env.novo.get()), env.gs.get(), 'o GET (com o aoVivo e o contador) ficou diferente depois deste passo');
    });
  }
}

const A = (nome, corpo, esperado) => [nome, corpo, esperado];
const ORG = 'tok-b'; const ADM = 'tok-a'; const JOG = 'tok-c';
const iniciar = (roundId, duracaoMinutos, tok = ORG) => ({ action: 'iniciarTransmissaoAoVivo', idToken: tok, roundId, duracaoMinutos });
const parcial = (roundId, vitoriasPorTime, tok = ORG) => ({ action: 'salvarParcialAoVivo', idToken: tok, roundId, vitoriasPorTime });
const cancelar = (roundId, tok = ORG) => ({ action: 'cancelarTransmissaoAoVivo', idToken: tok, roundId });
const ler = { action: 'lerAoVivo' };
const acesso = { action: 'incrementarAcesso' };
const rodada = (id, data, times, rascunho = true) => ({ action: 'addRound', idToken: ORG, round: { id, data, rascunho, times } });
const definirContador = (valor) => ({
  ambiente: (env) => {
    const linhas = env.gs.abas.Config.linhas.filter((l) => l[0] !== 'contadorAcessos');
    env.gs.abas.Config.linhas = linhas;
    env.repo.tabelas.config = env.repo.tabelas.config.filter((c) => c.chave !== 'contadorAcessos');
    if (valor !== null) { linhas.push(['contadorAcessos', valor]); env.repo.tabelas.config.push({ chave: 'contadorAcessos', valor }); }
  }
});

// ---------- cenário 1: transmissões nascendo do zero (a aba AoVivo nem existe na planilha) ----------
const passos1 = [
  A('lerAoVivo público, sem nada ao vivo (as abas nem existem)', ler, 'lista'),
  A('incrementarAcesso: 41 -> 42', acesso, 'contador'),
  A('incrementarAcesso: 43', acesso, 'contador'),
  A('incrementarAcesso com senha errada e token qualquer: continua público', { ...acesso, senha: 'errada', idToken: 'lixo' }, 'contador'),
  A('iniciar sem token: negado', { action: 'iniciarTransmissaoAoVivo', roundId: 'rd', duracaoMinutos: 30 }, 'Sem token'),
  A('iniciar como jogador: negado', iniciar('rd', 30, JOG), 'Seu perfil (jogador) não tem permissão'),
  A('iniciar com senha errada: negado', { action: 'iniciarTransmissaoAoVivo', senha: 'errada', roundId: 'rd', duracaoMinutos: 30 }, 'Senha de administrador incorreta.'),
  A('iniciar rodada que não existe', iniciar('nao-existe', 30), 'Rodada não encontrada'),
  A('iniciar sem roundId', { action: 'iniciarTransmissaoAoVivo', idToken: ORG, duracaoMinutos: 30 }, 'Rodada não encontrada'),
  A('iniciar rodada já lançada (r1 não é rascunho)', iniciar('r1', 30), 'não é mais um rascunho'),
  A('iniciar rd como organizador (30 min)', iniciar('rd', 30), 'ok'),
  A('iniciar rd de novo: já está ao vivo', iniciar('rd', 30), 'já está sendo transmitida'),
  A('lerAoVivo mostra o rd com os jogadores por time', ler, 'lista'),
  A('salvarParcial: os dois times mudam no mesmo instante (empate de carimbo no log)', parcial('rd', [2, 3]), 'ok'),
  A('lerAoVivo: log com dois registros de mesmo carimbo', ler, 'lista'),
  A('salvarParcial com os mesmos valores: nada muda', parcial('rd', [2, 3]), 'ok'),
  A('salvarParcial: só um valor é número (o outro é texto)', parcial('rd', ['x', 5]), 'ok'),
  A('salvarParcial: índices de times que não existem são ignorados', parcial('rd', { 0: 1, 5: 9, 7: 1 }), 'ok'),
  A('salvarParcial: null vira 0 (Number(null))', parcial('rd', [null, null]), 'ok'),
  A('salvarParcial: lista vazia', parcial('rd', []), 'ok'),
  A('salvarParcial: número como texto', parcial('rd', ['4', '4']), 'ok'),
  A('salvarParcial sem vitoriasPorTime: erro de TypeError igual', { action: 'salvarParcialAoVivo', idToken: ORG, roundId: 'rd' }, 'Cannot read properties'),
  A('salvarParcial de transmissão que não existe', parcial('nao-existe', [1, 1]), 'não foi encontrada'),
  A('salvarParcial como jogador: negado', parcial('rd', [9, 9], JOG), 'Seu perfil (jogador) não tem permissão'),
  A('salvarParcial sem token: negado', { action: 'salvarParcialAoVivo', roundId: 'rd', vitoriasPorTime: [9, 9] }, 'Sem token'),
  A('incrementarAcesso no meio da transmissão', acesso, 'contador'),
  // ---- duas transmissões ao mesmo tempo, durações estranhas ----
  A('addRound: rascunho rx (Roxo)', rodada('rx', '2026-10-06', [{ nome: 'Roxo', playerIds: ['p1'], vitorias: 0 }]), 'ok'),
  A('addRound: rascunho rz (dois times, um vazio)', rodada('rz', '2026-10-13', [{ nome: 'Rosa', playerIds: ['p2', 'p1'], vitorias: 3 }, { nome: 'Cinza', playerIds: [], vitorias: 0 }]), 'ok'),
  A('iniciar rx com a duração como texto ("15")', iniciar('rx', '15'), 'ok'),
  A('iniciar rz com duração lixo ("abc")', iniciar('rz', 'abc'), 'ok'),
  A('lerAoVivo com três rodadas ao vivo (ordem de início)', ler, 'lista'),
  A('salvarParcial em rx', parcial('rx', [1]), 'ok'),
  A('salvarParcial em rz com fracionário e negativo', parcial('rz', [3.5, -2]), 'ok'),
  A('cancelar rz como admin', cancelar('rz', ADM), 'ok'),
  // ---- editar uma rodada durante a transmissão ----
  A('updateRound rd (continua rascunho, muda times e placar): o espelho do Ao Vivo não muda', { action: 'updateRound', idToken: ORG, round: { id: 'rd', data: '2026-09-29', rascunho: true, times: [{ nome: 'Azul', playerIds: ['p1'], vitorias: 9 }, { nome: 'Verde', playerIds: [], vitorias: 9 }, { nome: 'Novo', playerIds: [], vitorias: 0 }] } }, 'ok'),
  A('lerAoVivo depois da edição', ler, 'lista'),
  A('updateRound rd lançando o placar (rascunho falso)', { action: 'updateRound', idToken: ORG, round: { id: 'rd', data: '2026-09-29', rascunho: false, vencedores: [0], times: [{ nome: 'Azul', playerIds: ['p1'], vitorias: 4 }, { nome: 'Verde', playerIds: [], vitorias: 2 }] } }, 'ok'),
  A('cancelar rd (o app faz isso logo depois de lançar)', cancelar('rd'), 'ok'),
  A('cancelar rd de novo (não havia nada): ok', cancelar('rd'), 'ok'),
  A('cancelar como jogador: negado', cancelar('rx', JOG), 'Seu perfil (jogador) não tem permissão'),
  A('iniciar rd lançada: agora não é rascunho', iniciar('rd', 30), 'não é mais um rascunho'),
  A('salvarParcial em rd cancelada', parcial('rd', [1, 1]), 'não foi encontrada'),
  A('lerAoVivo: só o rx', ler, 'lista'),
  A('cancelar rx com a chave mestra', (env, S) => ({ action: 'cancelarTransmissaoAoVivo', senha: S, roundId: 'rx' }), 'ok'),
  A('lerAoVivo: vazio de novo (abas existem, sem linhas)', ler, 'lista'),
  A('iniciar rx de novo com duração 0', iniciar('rx', 0), 'ok'),
  A('iniciar rz de novo com duração negativa e fracionária', iniciar('rz', -5.5), 'ok'),
  A('salvarParcial em rx com chave mestra', (env, S) => ({ action: 'salvarParcialAoVivo', senha: S, roundId: 'rx', vitoriasPorTime: [7] }), 'ok'),
  A('lerAoVivo com duas rodadas', ler, 'lista'),
  A('cancelar rx e rz', cancelar('rx'), 'ok'),
  A('cancelar rz', cancelar('rz'), 'ok'),
  A('lerAoVivo final', ler, 'lista')
];

// ---------- cenário 2: o contador com valores estranhos na aba Config ----------
const passos2 = [
  A('contador 41 -> 42', acesso, 'contador'),
  ['contador vira lixo ("abc")', definirContador('abc')],
  A('lixo conta como 0: vira 1', acesso, 'contador'),
  ['linha do contador ausente', definirContador(null)],
  A('sem linha conta como 0: vira 1', acesso, 'contador'),
  ['contador vazio', definirContador('')],
  A('vazio conta como 0: vira 1', acesso, 'contador'),
  ['contador com espaços (" 7 ")', definirContador(' 7 ')],
  A('espaços são ignorados: 8', acesso, 'contador'),
  ['contador decimal ("3.5")', definirContador('3.5')],
  A('decimal: 4.5', acesso, 'contador'),
  ['contador negativo ("-3")', definirContador('-3')],
  A('negativo: -2', acesso, 'contador'),
  ['contador "0"', definirContador('0')],
  A('zero: 1', acesso, 'contador'),
  ['contador em notação científica ("1e3")', definirContador('1e3')],
  A('1e3: 1001', acesso, 'contador'),
  ['contador com zeros à esquerda ("007")', definirContador('007')],
  A('007: 8', acesso, 'contador'),
  A('e mais um: 9', acesso, 'contador'),
  A('saveSettings do admin não sobrescreve o contador', { action: 'saveSettings', idToken: ADM, settings: { estrelasVisiveis: true, checkinVagas: 12, contadorAcessos: 5 } }, 'ok'),
  A('e o contador continua de onde estava: 10', acesso, 'contador')
];

// ---------- cenário 3: transmissão já existente na planilha (linhas "migradas"), inclusive com o log ----------
const dados3 = dadosBase();
dados3.ao_vivo.push(
  { id: 11, round_id: 'rd', data: '2026-09-29', time_index: 0, time_nome: 'Azul', jogadores: 'p1,p2', vitorias: 2, iniciado_em: '2026-09-30T18:30:00+00:00', duracao_minutos: 40 },
  { id: 12, round_id: 'rd', data: '2026-09-29', time_index: 1, time_nome: 'Verde', jogadores: null, vitorias: 1, iniciado_em: '2026-09-30T18:30:00+00:00', duracao_minutos: 40 });
dados3.ao_vivo_log.push(
  { id: 1, round_id: 'rd', time_index: 0, time_nome: 'Azul', delta: 1, timestamp: '2026-09-30T18:40:00+00:00' },
  { id: 2, round_id: 'rd', time_index: 1, time_nome: 'Verde', delta: 1, timestamp: '2026-09-30T18:40:00+00:00' },
  { id: 3, round_id: 'rd', time_index: 0, time_nome: 'Azul', delta: 1, timestamp: '2026-09-30T18:50:00+00:00' },
  { id: 4, round_id: 'orfa', time_index: 0, time_nome: 'X', delta: 9, timestamp: '2026-09-30T18:55:00+00:00' });
const passos3 = [
  A('lerAoVivo lê as linhas que já existiam (o log de rodada sem transmissão some)', ler, 'lista'),
  A('iniciar rd: já está ao vivo (linhas existentes)', iniciar('rd', 30), 'já está sendo transmitida'),
  A('salvarParcial sobre linhas existentes', parcial('rd', [3, 0]), 'ok'),
  A('lerAoVivo: novos registros entram no topo do log', ler, 'lista'),
  A('cancelar rd apaga placar e log', cancelar('rd'), 'ok'),
  A('lerAoVivo: vazio', ler, 'lista'),
  A('iniciar rd de novo (a aba já existia)', iniciar('rd', 20), 'ok'),
  A('salvarParcial rd', parcial('rd', [1, 1]), 'ok')
];

const env1 = montar(dadosBase());
const env2 = montar(dadosBase());
const env3 = montar(dados3);
await rodar('cenário 1,', env1, passos1);
await rodar('cenário 2,', env2, passos2);
await rodar('cenário 3,', env3, passos3);
console.log(`\n${passos1.length + passos2.length + passos3.length} passos comparados com o .gs real`);
fim();
