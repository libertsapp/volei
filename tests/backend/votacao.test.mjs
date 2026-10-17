// Votação do Craque e do Bola Murcha (v19.1). Rodar: node tests/backend/votacao.test.mjs
import assert from 'node:assert/strict';
import { ta, fim } from './executor.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarHandler } from '../../backend/handler.js';
import { addRound, updateRound } from '../../backend/rodadas.js';
import { votar, meusVotos, lerBlocoVotacao } from '../../backend/votacao.js';
import { inscreverPush } from '../../backend/notificacoes.js';

const DATA = '2026-10-13'; // terça
const conta = (email, jogador) => ({ email, nome: email, perfil: 'jogador', jogador_id: jogador, jogador_id_pendente: null, criado_em: '2026-09-01T10:00:00+00:00' });
const rodada = (id, timeA, timeB, extra = {}) => ({ id, data: DATA, times: [{ nome: 'A', vitorias: 2, playerIds: timeA }, { nome: 'B', vitorias: 1, playerIds: timeB }], vencedores: [0], ...extra });

// relógio controlável: começa 13/10 às 23h (Brasília) e anda com d.avancar(horas)
function ambiente() {
  const ids = ['ana', 'bia', 'caio', 'duda', 'eva', 'fora'];
  const repo = criarRepoMemoria({
    jogadores: ids.map((id, i) => ({ id, nome: id, convidado: false, removido: false, ordem: i + 1 })),
    usuarios: ids.map((id) => conta(id + '@x.com', id)).concat([conta('semvinculo@x.com', null)])
  });
  let agora = new Date('2026-10-14T02:00:00.000Z');
  const enviados = [];
  let n = 0;
  const d = {
    repo, relogio: () => agora, gerarId: () => 'id-' + (++n), avisos: [],
    verificarToken: async (tok) => (tok ? { ok: true, email: tok, nome: tok } : { ok: false, erro: 'Entre com sua conta Google.' }),
    enviarPush: async (insc, payload) => { enviados.push({ para: insc.email, ...JSON.parse(payload) }); },
    avancar: (horas) => { agora = new Date(agora.getTime() + horas * 3600000); }
  };
  d.avisar = (m) => d.avisos.push(m);
  return { d, enviados };
}
const como = (email, extra) => ({ idToken: email, data: DATA, ...extra });
const bloco = async (d) => lerBlocoVotacao(d, await d.repo.lerTudo());

await ta('rodada oficial salva abre a votação de 24h e avisa só quem jogou', async () => {
  const { d, enviados } = ambiente();
  for (const id of ['ana', 'eva', 'fora']) await inscreverPush(d, { endpoint: 'https://p/' + id, keys: { p256dh: 'k', auth: 'a' } }, id + '@x.com');
  await addRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda']));
  const [v] = await bloco(d);
  assert.equal(v.data, DATA);
  assert.equal(v.aberta, true);
  assert.equal(Date.parse(v.fechaEm) - Date.parse(v.abreEm), 24 * 3600000);
  assert.deepEqual(enviados.map((e) => e.para), ['ana@x.com']); // eva e "fora" não jogaram
  assert.equal(enviados[0].titulo, '🗳️ Votação aberta!');
  assert.match(enviados[0].corpo, /terça \(13\/10\)/);
});

await ta('rascunho não abre; o 2º jogo do dia (ou salvar de novo) não reabre nem reavisa', async () => {
  const { d, enviados } = ambiente();
  await inscreverPush(d, { endpoint: 'https://p/ana', keys: { p256dh: 'k', auth: 'a' } }, 'ana@x.com');
  await addRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda'], { rascunho: true }));
  assert.deepEqual(await bloco(d), []);
  await updateRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda']));
  d.avancar(1);
  await addRound(d, rodada('r2', ['ana', 'eva'], ['bia', 'caio']));
  await updateRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda']));
  const lista = await bloco(d);
  assert.equal(lista.length, 1);
  assert.equal(enviados.length, 1);
});

await ta('rodada antiga editada não abre votação', async () => {
  const { d } = ambiente();
  await addRound(d, { ...rodada('r1', ['ana'], ['bia']), data: '2026-09-22' });
  assert.deepEqual(await bloco(d), []);
});

await ta('quem pode votar: precisa de login, vínculo e ter jogado no dia (inclusive no 2º jogo)', async () => {
  const { d } = ambiente();
  await addRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda']));
  await addRound(d, rodada('r2', ['ana', 'eva'], ['bia', 'caio']));
  assert.ok((await votar(d, { data: DATA, craque: 'bia' })).error); // sem login
  assert.equal((await votar(d, como('semvinculo@x.com', { craque: 'bia' }))).error, 'Vincule sua conta a um jogador pra votar.');
  assert.equal((await votar(d, como('fora@x.com', { craque: 'bia' }))).error, 'Só quem jogou nesse dia pode votar.');
  assert.equal((await votar(d, como('eva@x.com', { craque: 'bia' }))).status, 'ok'); // eva só jogou o 2º jogo
});

await ta('regras do voto: não vota em si, só em quem jogou, nem na mesma pessoa pras duas', async () => {
  const { d } = ambiente();
  await addRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda']));
  assert.equal((await votar(d, como('ana@x.com', { craque: 'ana' }))).error, 'Não dá pra votar em você mesmo.');
  assert.equal((await votar(d, como('ana@x.com', { murcha: 'fora' }))).error, 'Esse jogador não jogou nesse dia.');
  assert.equal((await votar(d, como('ana@x.com', { craque: 'bia', murcha: 'bia' }))).error, 'Não dá pra votar na mesma pessoa pra Craque e Bola Murcha.');
  // votou craque=bia antes; depois tentar murcha=bia sozinho também é recusado (compara com o voto gravado)
  assert.equal((await votar(d, como('ana@x.com', { craque: 'bia' }))).status, 'ok');
  assert.equal((await votar(d, como('ana@x.com', { murcha: 'bia' }))).error, 'Não dá pra votar na mesma pessoa pra Craque e Bola Murcha.');
  assert.equal((await votar(d, como('ana@x.com', { data: '2026-10-06', craque: 'bia' }))).error, 'Não há votação para esse dia.');
});

await ta('trocar e tirar o voto; meusVotos mostra só os da própria pessoa', async () => {
  const { d } = ambiente();
  await addRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda']));
  await votar(d, como('ana@x.com', { craque: 'bia', murcha: 'caio' }));
  await votar(d, como('bia@x.com', { craque: 'duda' }));
  assert.deepEqual((await votar(d, como('ana@x.com', { craque: 'duda' }))).meusVotos, { [DATA]: { craque: 'duda', murcha: 'caio' } });
  assert.deepEqual((await meusVotos(d, como('ana@x.com'))).meusVotos, { [DATA]: { craque: 'duda', murcha: 'caio' } });
  await votar(d, como('ana@x.com', { murcha: '-' }));
  assert.deepEqual((await meusVotos(d, como('ana@x.com'))).meusVotos, { [DATA]: { craque: 'duda', murcha: '' } });
});

await ta('aberta: o GET só mostra quantos votaram (nada de quem votou em quem)', async () => {
  const { d } = ambiente();
  await addRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda']));
  await votar(d, como('ana@x.com', { craque: 'bia', murcha: 'caio' }));
  await votar(d, como('bia@x.com', { craque: 'ana' }));
  const [v] = await bloco(d);
  assert.equal(v.votantes, 2);
  assert.equal(v.resultado, undefined);
  assert.doesNotMatch(JSON.stringify(v), /@x\.com|bia|caio/); // nem e-mail nem votado
});

await ta('fechada: resultado com os vencedores e empate leva os dois; votar depois é recusado', async () => {
  const { d } = ambiente();
  await addRound(d, rodada('r1', ['ana', 'bia', 'eva'], ['caio', 'duda']));
  await votar(d, como('ana@x.com', { craque: 'bia', murcha: 'caio' }));
  await votar(d, como('eva@x.com', { craque: 'bia', murcha: 'duda' }));
  await votar(d, como('caio@x.com', { craque: 'duda', murcha: 'ana' }));
  await votar(d, como('duda@x.com', { murcha: 'caio' }));
  await votar(d, como('bia@x.com', { murcha: 'duda' }));
  d.avancar(24);
  const [v] = await bloco(d);
  assert.equal(v.aberta, false);
  assert.deepEqual(v.resultado.craque, { ids: ['bia'], votos: 2 });
  assert.deepEqual(v.resultado.murcha, { ids: ['caio', 'duda'], votos: 2 }); // empate: os dois
  assert.equal((await votar(d, como('ana@x.com', { craque: 'eva' }))).error, 'A votação desse dia já fechou.');
  assert.deepEqual((await meusVotos(d, como('ana@x.com'))).meusVotos, {}); // fechada não aparece em "meus votos"
});

await ta('fechada sem nenhum voto: resultado vazio, sem vencedor', async () => {
  const { d } = ambiente();
  await addRound(d, rodada('r1', ['ana'], ['bia']));
  d.avancar(25);
  const [v] = await bloco(d);
  assert.deepEqual(v.resultado, { craque: { ids: [], votos: 0 }, murcha: { ids: [], votos: 0 } });
});

await ta('handler: GET traz "votacoes" e as ações votar/meusVotos funcionam sem passar pelo porteiro', async () => {
  const { d } = ambiente();
  const h = criarHandler({ repo: d.repo, relogio: d.relogio, verificarToken: d.verificarToken, enviarPush: d.enviarPush });
  await addRound(d, rodada('r1', ['ana', 'bia'], ['caio', 'duda']));
  assert.equal((await h.post({ action: 'votar', idToken: 'ana@x.com', data: DATA, craque: 'bia' })).status, 'ok');
  assert.equal((await h.post({ action: 'meusVotos', idToken: 'ana@x.com' })).meusVotos[DATA].craque, 'bia');
  const g = await h.get();
  assert.equal(g.votacoes.length, 1);
  assert.equal(g.votacoes[0].votantes, 1);
});

await ta('repositório sem as tabelas de votação: GET segue com lista vazia (avisando no log)', async () => {
  const { d } = ambiente();
  d.repo.lerVotacoes = async () => { throw new Error('relation "votacoes" does not exist'); };
  assert.deepEqual(await bloco(d), []);
  assert.match(d.avisos[0], /votação indisponível/);
});

fim();
