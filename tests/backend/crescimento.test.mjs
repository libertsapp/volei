// v20.0: 🔥 últimas vagas, 👋 sumidos no check-in aberto, 🎂 aniversário, 🙋 "Quero jogar" e 🤝 quem trouxe.
// Rodar: node tests/backend/crescimento.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { addCheckin } from '../../backend/checkins.js';
import { addRound } from '../../backend/rodadas.js';
import { saveSettings } from '../../backend/configuracoes.js';
import { addPlayer, updatePlayer } from '../../backend/jogadores.js';
import { lembreteDoDia } from '../../backend/avisos-push.js';
import { inscreverPush } from '../../backend/notificacoes.js';
import { solicitarEntrada, aprovarEntrada, rejeitarVinculo, solicitarVinculo, lerUsuarios } from '../../backend/usuarios.js';
import { mapearJogadores } from '../../backend/mapeadores.js';
import { computeSumidos } from '../../backend/sumidos.js';

const DATA = '2026-10-20'; // terça
const ck = (id, jogador, ordem, jogo = 1) => ({ id, data: DATA, jogador_id: jogador, jogador_nome: jogador, estrelas: 3, sexo: 'M', estrelas_ajustadas: null, jogo, ordem });
const conta = (email, jogador, perfil = 'jogador') => ({ email, nome: email.split('@')[0], perfil, jogador_id: jogador, jogador_id_pendente: null, criado_em: '2026-09-01T10:00:00+00:00' });
const IDS = ['p1', 'p2', 'p3', 'p4', 'p5'];

function ambiente({ agora = '2026-10-20T15:00:00.000Z', config = {}, checkins = [], jogadores, usuarios } = {}) {
  const cfg = { checkinDataAberta: DATA, checkinVagas: '5', checkinHorario: '20:00', checkinTravado: 'FALSE', ...config };
  const repo = criarRepoMemoria({
    jogadores: jogadores || IDS.map((id, i) => ({ id, nome: id.toUpperCase(), convidado: false, removido: false, ordem: i + 1 })),
    checkins,
    config: Object.entries(cfg).map(([chave, valor]) => ({ chave, valor })),
    usuarios: usuarios || IDS.map((id) => conta(id + '@x.com', id)).concat([conta('org@x.com', null, 'organizador'), conta('novo@x.com', null)])
  });
  const enviados = [];
  let relogio = new Date(agora);
  let n = 0;
  const d = {
    repo, relogio: () => relogio, gerarId: () => 'id-' + (++n), avisos: [],
    enviarPush: async (insc, payload) => { enviados.push({ para: insc.email || '(sem login)', ...JSON.parse(payload) }); },
    em: (iso) => { relogio = new Date(iso); }
  };
  d.avisar = (m) => d.avisos.push(m);
  const inscrever = async (emails) => {
    for (const e of emails) await inscreverPush(d, { endpoint: 'https://p/' + e, keys: { p256dh: 'k', auth: 'a' } }, e === '(sem login)' ? '' : e);
  };
  return { d, enviados, inscrever };
}
const novoCk = (id, jogador, jogo = 1) => ({ id, data: DATA, jogadorId: jogador, jogadorNome: jogador, estrelas: 3, sexo: 'M', jogo });

// ------------------------------------------------------------------------------------------------ 🔥 últimas vagas
await ta('últimas vagas: com 3 vagas restando avisa UMA vez todo mundo que não está na lista (inclusive aparelho sem login)', async () => {
  const { d, enviados, inscrever } = ambiente({ checkins: [ck('c1', 'p1', 1)] });
  await inscrever(['p1@x.com', 'p2@x.com', 'p3@x.com', '(sem login)']);
  await addCheckin(d, novoCk('c2', 'p2'));              // 2 de 5: restam 3
  assert.deepEqual(enviados.map((e) => e.para).sort(), ['(sem login)', 'p3@x.com']);
  assert.equal(enviados[0].titulo, '🔥 Últimas vagas!');
  assert.match(enviados[0].corpo, /Restam 3 vagas no vôlei de terça \(20\/10\) às 20:00/);
  enviados.length = 0;
  await addCheckin(d, novoCk('c3', 'p3'));              // restam 2: já avisou esse jogo
  assert.equal(enviados.length, 0);
});

await ta('últimas vagas: não avisa com check-in travado, nem com 4+ vagas', async () => {
  const travado = ambiente({ config: { checkinTravado: 'TRUE' }, checkins: [ck('c1', 'p1', 1)] });
  await travado.inscrever(['p3@x.com']);
  await addCheckin(travado.d, novoCk('c2', 'p2'));
  assert.equal(travado.enviados.length, 0);
  const folgado = ambiente({ config: { checkinVagas: '16' } });
  await folgado.inscrever(['p3@x.com']);
  await addCheckin(folgado.d, novoCk('c2', 'p2'));
  assert.equal(folgado.enviados.length, 0);
});

await ta('últimas vagas: "Resta 1 vaga" no singular', async () => {
  const { d, enviados, inscrever } = ambiente({ config: { checkinVagas: '2' } });
  await inscrever(['p3@x.com']);
  await addCheckin(d, novoCk('c1', 'p1'));
  assert.match(enviados[0].corpo, /^Resta 1 vaga /);
});

// ------------------------------------------------------------------------------------------------ 👋 sumidos
async function comHistorico(amb) {
  // 7 terças; p1 joga todas; p2 joga as 4 primeiras e some (faltou as 3 últimas): sumido
  for (let i = 0; i < 7; i++) {
    const data = new Date(Date.UTC(2026, 8, 1 + 7 * i)).toISOString().slice(0, 10);
    await addRound(amb.d, { id: 'r' + i, data, times: [{ nome: 'A', vitorias: 2, playerIds: i < 4 ? ['p1', 'p2'] : ['p1'] }, { nome: 'B', vitorias: 1, playerIds: ['p3'] }], vencedores: [0] });
  }
}

await ta('sumidos: computeSumidos usa a regra da tela (≥4 datas, faltou as 3 últimas, até 180 dias)', async () => {
  const amb = ambiente();
  await comHistorico(amb);
  const s = computeSumidos(await amb.d.repo.lerTudo(), '2026-10-20');
  assert.deepEqual(s.map((x) => [x.id, x.faltas]), [['p2', 3]]);
});

await ta('check-in aberto: o sumido recebe o "sentimos sua falta" no lugar do aviso geral; 21 dias sem repetir', async () => {
  const amb = ambiente({ config: { checkinDataAberta: '2026-10-13' } });
  await comHistorico(amb);
  await amb.inscrever(['p1@x.com', 'p2@x.com']);
  await saveSettings(amb.d, { checkinDataAberta: DATA, checkinVagas: 16, checkinHorario: '20:00' });
  const p2 = amb.enviados.filter((e) => e.para === 'p2@x.com');
  assert.deepEqual(p2.map((e) => e.titulo), ['👋 Sentimos sua falta, P2!']);
  assert.match(p2[0].corpo, /check-in do vôlei de terça \(20\/10\) abriu/);
  assert.deepEqual(amb.enviados.filter((e) => e.para === 'p1@x.com').map((e) => e.titulo), ['🏐 Check-in aberto!']);
  // semana seguinte (7 dias depois): p2 segue sumido, mas só recebe o aviso geral
  amb.enviados.length = 0;
  amb.d.em('2026-10-27T15:00:00.000Z');
  await saveSettings(amb.d, { checkinDataAberta: '2026-10-27', checkinVagas: 16, checkinHorario: '20:00' });
  assert.deepEqual(amb.enviados.filter((e) => e.para === 'p2@x.com').map((e) => e.titulo), ['🏐 Check-in aberto!']);
});

await ta('check-in aberto: sumido SEM aparelho não tira ninguém do aviso geral (e nada quebra)', async () => {
  const amb = ambiente({ config: { checkinDataAberta: '2026-10-13' } });
  await comHistorico(amb);
  await amb.inscrever(['p1@x.com']);
  await saveSettings(amb.d, { checkinDataAberta: DATA, checkinVagas: 16, checkinHorario: '20:00' });
  assert.deepEqual(amb.enviados.map((e) => e.titulo), ['🏐 Check-in aberto!']);
  assert.deepEqual(amb.d.avisos, []);
});

// ------------------------------------------------------------------------------------------------ 🎂 aniversário
await ta('aniversário: a partir das 9h, uma vez no dia: parabéns pro aniversariante e aviso pros outros', async () => {
  const jogadores = IDS.map((id, i) => ({ id, nome: id.toUpperCase(), convidado: false, removido: false, ordem: i + 1, ...(id === 'p2' ? { aniversario: '10-20' } : {}) }));
  const amb = ambiente({ agora: '2026-10-20T11:00:00.000Z', config: { checkinDataAberta: '2026-10-21' }, jogadores }); // 8h em Brasília
  await amb.inscrever(['p1@x.com', 'p2@x.com']);
  assert.equal((await lembreteDoDia(amb.d)).aniversarios, undefined);
  amb.d.em('2026-10-20T12:30:00.000Z'); // 9h30
  assert.equal((await lembreteDoDia(amb.d)).aniversarios, 1);
  assert.deepEqual(amb.enviados.map((e) => [e.para, e.titulo]), [['p2@x.com', '🎂 Parabéns, P2!'], ['p1@x.com', '🎂 Hoje é aniversário de P2!']]);
  amb.enviados.length = 0;
  amb.d.em('2026-10-20T20:00:00.000Z');
  await lembreteDoDia(amb.d);
  assert.equal(amb.enviados.length, 0); // já avisou hoje
});

await ta('aniversário: 29/02 vira 28/02 em ano que não é bissexto; dois no mesmo dia = "A e B"', async () => {
  const jogadores = [
    { id: 'p1', nome: 'Ana', convidado: false, removido: false, ordem: 1, aniversario: '02-29' },
    { id: 'p2', nome: 'Bia', convidado: false, removido: false, ordem: 2, aniversario: '02-28' },
    { id: 'p3', nome: 'Caio', convidado: false, removido: false, ordem: 3 }
  ];
  const amb = ambiente({ agora: '2027-02-28T13:00:00.000Z', jogadores, usuarios: [conta('p3@x.com', 'p3')] });
  await amb.inscrever(['p3@x.com']);
  await lembreteDoDia(amb.d);
  assert.deepEqual(amb.enviados.map((e) => e.titulo), ['🎂 Hoje é aniversário de Ana e Bia!']);
});

// ------------------------------------------------------------------------------------------------ cadastro: 🎂 e 🤝
await ta('cadastro: aniversário (MM-DD) e quem trouxe; formato inválido e auto-recrutamento recusados', async () => {
  const { d } = ambiente();
  assert.deepEqual(await addPlayer(d, { id: 'p9', nome: 'Novo', aniversario: '03-15', recrutadoPor: 'p1' }), { status: 'ok' });
  const p9 = mapearJogadores(await d.repo.lerJogadores()).find((p) => p.id === 'p9');
  assert.equal(p9.aniversario, '03-15');
  assert.equal(p9.recrutadoPor, 'p1');
  assert.match((await addPlayer(d, { id: 'p8', nome: 'X', aniversario: '15/03' })).error, /Aniversário inválido/);
  assert.match((await updatePlayer(d, { id: 'p1', nome: 'P1', recrutadoPor: 'p1' })).error, /recruta/);
  // app antigo (sem as chaves): não apaga o que já estava gravado
  await updatePlayer(d, { id: 'p9', nome: 'Novo Nome' });
  const depois = mapearJogadores(await d.repo.lerJogadores()).find((p) => p.id === 'p9');
  assert.equal(depois.aniversario, '03-15');
  assert.equal(depois.recrutadoPor, 'p1');
  // vazio = apagar
  await updatePlayer(d, { id: 'p9', nome: 'Novo Nome', aniversario: '' });
  assert.equal(mapearJogadores(await d.repo.lerJogadores()).find((p) => p.id === 'p9').aniversario, undefined);
});

await ta('quem não usa os campos novos recebe o jogador exatamente como antes', async () => {
  const { d } = ambiente();
  assert.deepEqual(Object.keys(mapearJogadores(await d.repo.lerJogadores())[0]), ['id', 'nome', 'apelido', 'foto', 'estrelas', 'sexo', 'porte']);
});

await ta('o próprio jogador pode trocar o aniversário dele (como a foto), mas não quem o trouxe', async () => {
  const { d } = ambiente();
  const h = criarHandler({ ...d, verificarToken: async (tok) => ({ ok: true, email: tok, nome: tok }), config: { adminPassword: '' } });
  const meu = { id: 'p1', nome: 'P1', apelido: '', estrelas: 0, sexo: '', porte: '', foto: '' };
  assert.equal((await h.post({ action: 'updatePlayer', idToken: 'p1@x.com', player: { ...meu, aniversario: '07-04' } })).status, 'ok');
  assert.equal(mapearJogadores(await d.repo.lerJogadores()).find((p) => p.id === 'p1').aniversario, '07-04');
  assert.match((await h.post({ action: 'updatePlayer', idToken: 'p1@x.com', player: { ...meu, recrutadoPor: 'p2' } })).error, /permissão/);
  assert.match((await h.post({ action: 'updatePlayer', idToken: 'p1@x.com', player: { ...meu, id: 'p2', nome: 'P2' } })).error, /permissão/);
});

// ------------------------------------------------------------------------------------------------ 🙋 Quero jogar
await ta('quero jogar: pede com o nome, avisa os organizadores; aprovar cria o jogador e já vincula', async () => {
  const { d, enviados, inscrever } = ambiente();
  await inscrever(['org@x.com', 'p1@x.com']);
  const auth = { email: 'novo@x.com', nome: 'novo', perfil: 'jogador' };
  assert.deepEqual(await solicitarEntrada(d, auth, '  Kaio   Silva '), { status: 'ok', pedidoEntrada: 'Kaio Silva' });
  assert.deepEqual(enviados.map((e) => [e.para, e.titulo]), [['org@x.com', '🙋 Pedido pra jogar']]);
  assert.match(enviados[0].corpo, /Kaio Silva quer entrar no grupo/);
  assert.equal((await lerUsuarios(d.repo)).find((u) => u.email === 'novo@x.com').pedidoEntrada, 'Kaio Silva');
  const r = await aprovarEntrada(d, 'novo@x.com', 'Kaio');
  assert.equal(r.status, 'ok');
  const u = (await lerUsuarios(d.repo)).find((x) => x.email === 'novo@x.com');
  assert.equal(u.jogadorId, r.jogadorId);
  assert.equal(u.pedidoEntrada, undefined); // pedido resolvido
  assert.equal(mapearJogadores(await d.repo.lerJogadores()).find((p) => p.id === r.jogadorId).nome, 'Kaio');
});

await ta('quero jogar: nome curto, conta já vinculada e aprovar sem pedido são recusados; recusar limpa o pedido', async () => {
  const { d } = ambiente();
  assert.match((await solicitarEntrada(d, { email: 'novo@x.com' }, 'K')).error, /de 2 a 60/);
  assert.match((await solicitarEntrada(d, { email: 'p1@x.com' }, 'Outro Nome')).error, /já está ligada/);
  assert.match((await aprovarEntrada(d, 'novo@x.com')).error, /não tem pedido/);
  await solicitarEntrada(d, { email: 'novo@x.com' }, 'Kaio');
  await rejeitarVinculo(d, 'novo@x.com');
  assert.equal((await lerUsuarios(d.repo)).find((u) => u.email === 'novo@x.com').pedidoEntrada, undefined);
});

await ta('pedido de vínculo também avisa os organizadores', async () => {
  const { d, enviados, inscrever } = ambiente({ usuarios: [conta('org@x.com', null, 'admin'), conta('novo@x.com', null)] });
  await inscrever(['org@x.com', 'novo@x.com']);
  await solicitarVinculo(d, { email: 'novo@x.com', nome: 'Novo', perfil: 'jogador' }, 'p3');
  assert.deepEqual(enviados.map((e) => [e.para, e.titulo]), [['org@x.com', '🔗 Pedido de vínculo']]);
});

await ta('handler: solicitarEntrada (qualquer conta) e aprovarEntrada (só organizador/admin)', async () => {
  const { d } = ambiente();
  const h = criarHandler({ ...d, verificarToken: async (tok) => ({ ok: true, email: tok, nome: tok }), config: { adminPassword: '' } });
  assert.equal((await h.post({ action: 'solicitarEntrada', idToken: 'novo@x.com', nome: 'Kaio' })).status, 'ok');
  assert.match((await h.post({ action: 'aprovarEntrada', idToken: 'p1@x.com', email: 'novo@x.com' })).error, /permissão/);
  assert.equal((await h.post({ action: 'aprovarEntrada', idToken: 'org@x.com', email: 'novo@x.com' })).status, 'ok');
});

fim();
