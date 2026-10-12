import assert from 'node:assert/strict';
import { ta, t, fim } from './executor.mjs';
import { fixture } from './fixture.mjs';
import { criarRepoMemoria } from '../../backend/repo-memoria.js';
import { criarRepoLigaMemoria } from '../../backend/repo-liga-memoria.js';
import {
  statusEfetivo, inicioDoJogo, mapearLiga, lerBlocoLiga, ligaVazia,
  convidarGrupo, responderConvite, cancelarAmistoso, recadoAmistoso,
  entrarAmistoso, sairAmistoso, confirmarEscalado, desconfirmarEscalado, travarEscalacao, destravarEscalacao,
  lancarPlacar, confirmarPlacar, contestarPlacar
} from '../../backend/amistosos.js';

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

// ---- dois "servidores" (Terça e Meme) falando com a MESMA liga ----
const ORG = { perfil: 'organizador', nome: 'Org', email: 'b@exemplo.com' };
function mundo() {
  let agora = new Date('2026-10-12T15:00:00.000Z');
  let n = 0;
  const repoLiga = criarRepoLigaMemoria({ grupos: GRUPOS });
  const push = [];
  const servidor = (grupoId) => ({
    repo: criarRepoMemoria({ ...fixture, push_inscricoes: [{ id: 'i1', endpoint: 'e-' + grupoId, p256dh: 'p', auth: 'a' }] }),
    liga: { repo: repoLiga, grupoId },
    relogio: () => agora,
    gerarId: () => 'id' + (++n),
    enviarPush: async (insc, payload) => { push.push([grupoId, JSON.parse(payload)]); }
  });
  return { terca: servidor('terca'), meme: servidor('meme'), outro: servidor('outro'), repoLiga, push, avancar: (iso) => { agora = new Date(iso); } };
}
const CONVITE = { grupo: 'meme', data: '2026-10-20', horario: '20:00', local: 'Quadra X', vagasPorGrupo: 6, recado: 'levamos bola' };
async function convidar(m) {
  const r = await convidarGrupo(m.terca, CONVITE, ORG);
  assert.equal(r.status, 'ok', JSON.stringify(r));
  return r.liga.amistosos[0].id;
}

await ta('convidarGrupo: cria pendente com a vez do convidado e registra a mensagem; o Meme enxerga', async () => {
  const m = mundo();
  const id = await convidar(m);
  const visto = (await lerBlocoLiga(m.meme)).amistosos.find((a) => a.id === id);
  assert.equal(visto.status, 'pendente');
  assert.equal(visto.vezDe, 'meme');
  assert.deepEqual(visto.mensagens.map((x) => [x.tipo, x.texto, x.grupo]), [['convite', 'levamos bola', 'terca']]);
});

await ta('convidarGrupo: validações (grupo, data, horário, vagas, data passada)', async () => {
  const m = mundo();
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, grupo: 'terca' }, ORG), { error: 'Escolha outro grupo para convidar.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, grupo: 'fantasma' }, ORG), { error: 'Grupo não encontrado.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, data: '2026-02-30' }, ORG), { error: 'Data inválida.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, horario: '8h' }, ORG), { error: 'Horário inválido.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, vagasPorGrupo: 31 }, ORG), { error: 'Vagas por grupo precisam ser entre 1 e 30.' });
  assert.deepEqual(await convidarGrupo(m.terca, { ...CONVITE, data: '2026-10-11' }, ORG), { error: 'A data do amistoso já passou.' });
  assert.equal(m.repoLiga.tabelas.amistosos.length, 0);
});

await ta('convidarGrupo: sem liga configurada responde erro claro', async () => {
  assert.deepEqual(await convidarGrupo({ repo: criarRepoMemoria(fixture) }, CONVITE, ORG), { error: 'Amistosos não estão disponíveis neste servidor.' });
});

await ta('responderConvite: só quem tem a vez responde; aceitar marca e manda push só aos inscritos de quem aceitou', async () => {
  const m = mundo();
  const id = await convidar(m);
  assert.deepEqual(await responderConvite(m.terca, { id, resposta: 'aceitar' }, ORG), { error: 'Agora a vez de responder é do outro grupo.' });
  const r = await responderConvite(m.meme, { id, resposta: 'aceitar', recado: 'fechado!' }, ORG);
  assert.equal(r.status, 'ok');
  const a = r.liga.amistosos.find((x) => x.id === id);
  assert.equal(a.status, 'marcado');
  assert.equal(a.vezDe, '');
  assert.deepEqual(m.push.map(([g]) => g), ['meme']);
  assert.match(m.push[0][1].corpo, /Vôlei de Terça em 20\/10 às 20:00/);
  assert.deepEqual(await responderConvite(m.meme, { id, resposta: 'recusar' }, ORG), { error: 'Esse convite não está mais esperando resposta.' });
});

await ta('responderConvite: contraproposta troca a vez e os campos; o vai e volta continua até aceitar', async () => {
  const m = mundo();
  const id = await convidar(m);
  const r1 = await responderConvite(m.meme, { id, resposta: 'contrapropor', data: '2026-10-22', horario: '19:00', local: 'Ginásio', vagasPorGrupo: 12, recado: 'terça não dá' }, ORG);
  assert.equal(r1.status, 'ok');
  let a = r1.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.vezDe, a.data, a.horario, a.local, a.vagasPorGrupo], ['pendente', 'terca', '2026-10-22', '19:00', 'Ginásio', 12]);
  assert.equal(a.mensagens.at(-1).tipo, 'contraproposta');
  assert.match(a.mensagens.at(-1).texto, /22\/10 às 19:00 em Ginásio — terça não dá/);
  const r2 = await responderConvite(m.terca, { id, resposta: 'aceitar' }, ORG);
  a = r2.liga.amistosos.find((x) => x.id === id);
  assert.equal(a.status, 'marcado');
});

await ta('responderConvite: recusar, resposta inválida e contraproposta com campos ruins', async () => {
  const m = mundo();
  const id = await convidar(m);
  assert.deepEqual(await responderConvite(m.meme, { id, resposta: 'talvez' }, ORG), { error: 'Resposta inválida.' });
  assert.deepEqual(await responderConvite(m.meme, { id, resposta: 'contrapropor', data: 'x', horario: '19:00' }, ORG), { error: 'Data inválida.' });
  const r = await responderConvite(m.meme, { id, resposta: 'recusar', recado: 'sem quadra' }, ORG);
  assert.equal(r.liga.amistosos.find((x) => x.id === id).status, 'recusado');
});

await ta('isolamento: grupo que não participa do amistoso recebe "não encontrado" e nada muda', async () => {
  const m = mundo();
  const id = await convidar(m);
  assert.deepEqual(await responderConvite(m.outro, { id, resposta: 'aceitar' }, ORG), { error: 'Amistoso não encontrado.' });
  assert.deepEqual(await cancelarAmistoso(m.outro, { id, motivo: 'x' }, ORG), { error: 'Amistoso não encontrado.' });
  assert.equal(m.repoLiga.tabelas.amistosos[0].status, 'pendente');
});

await ta('concorrência: se o status mudou entre a leitura e a gravação, a segunda ação perde', async () => {
  const m = mundo();
  const id = await convidar(m);
  // simula outro organizador do Meme aceitando "no meio" da recusa deste
  const original = m.repoLiga.atualizarAmistosoSe;
  m.repoLiga.atualizarAmistosoSe = async (...args) => { await original('' + id, 'pendente', { status: 'marcado' }); return original(...args); };
  assert.deepEqual(await responderConvite(m.meme, { id, resposta: 'recusar' }, ORG),
    { error: 'Esse amistoso mudou enquanto você olhava. Recarregue a página e tente de novo.' });
  m.repoLiga.atualizarAmistosoSe = original;
  assert.equal(m.repoLiga.tabelas.amistosos[0].status, 'marcado');
});

await ta('cancelarAmistoso: qualquer lado; marcado exige motivo; encerrado não cancela', async () => {
  const m = mundo();
  const id = await convidar(m);
  await responderConvite(m.meme, { id, resposta: 'aceitar' }, ORG);
  assert.deepEqual(await cancelarAmistoso(m.terca, { id }, ORG), { error: 'Conte o motivo do cancelamento (o outro grupo vai ver).' });
  const r = await cancelarAmistoso(m.terca, { id, motivo: 'choveu' }, ORG);
  const a = r.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.motivoCancelamento], ['cancelado', 'choveu']);
  assert.deepEqual(await cancelarAmistoso(m.meme, { id, motivo: 'x' }, ORG), { error: 'Esse amistoso não pode mais ser cancelado.' });
  // pendente cancela sem motivo
  const id2 = await convidar(m);
  assert.equal((await cancelarAmistoso(m.terca, { id: id2 }, ORG)).status, 'ok');
});

await ta('recadoAmistoso: grava no histórico; texto vazio é recusado; corta em 500', async () => {
  const m = mundo();
  const id = await convidar(m);
  assert.deepEqual(await recadoAmistoso(m.meme, { id, texto: '   ' }, ORG), { error: 'Escreva o recado.' });
  const r = await recadoAmistoso(m.meme, { id, texto: 'x'.repeat(600) }, ORG);
  const msg = r.liga.amistosos.find((x) => x.id === id).mensagens.at(-1);
  assert.deepEqual([msg.tipo, msg.grupo, msg.texto.length, msg.autorNome], ['recado', 'meme', 500, 'Org']);
});

async function marcado(m, vagas = 6) {
  const r = await convidarGrupo(m.terca, { ...CONVITE, vagasPorGrupo: vagas }, ORG);
  const id = r.liga.amistosos[0].id;
  await responderConvite(m.meme, { id, resposta: 'aceitar' }, ORG);
  return id;
}
const minha = (r, id) => r.liga.amistosos.find((x) => x.id === id).minhaEscalacao;

await ta('entrarAmistoso: só depois de marcado; copia nome (apelido) e foto do jogador do grupo; não repete', async () => {
  const m = mundo();
  const r0 = await convidarGrupo(m.terca, CONVITE, ORG);
  const idPendente = r0.liga.amistosos[0].id;
  assert.deepEqual(await entrarAmistoso(m.terca, { id: idPendente, jogadorId: 'p2' }), { error: 'A lista só abre depois que o amistoso é marcado.' });
  const id = await marcado(m);
  const r = await entrarAmistoso(m.terca, { id, jogadorId: 'p2' });
  assert.deepEqual(minha(r, id).jogadores.map((j) => [j.jogadorId, j.nome, j.foto, j.status]), [['p2', 'Bru', 'https://exemplo.com/b.jpg', 'interessado']]);
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'p2' }), { error: 'Essa pessoa já está na lista.' });
});

await ta('entrarAmistoso: jogador inexistente, convidado ou removido é recusado', async () => {
  const m = mundo();
  const id = await marcado(m);
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'inventado' }), { error: 'Jogador não encontrado no seu grupo.' });
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'convidado:LUCAS#ab12' }), { error: 'Jogador não encontrado no seu grupo.' });
  await m.terca.repo.atualizarJogador('p1', { removido: true });
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'p1' }), { error: 'Jogador não encontrado no seu grupo.' });
});

await ta('isolamento: cada servidor só mexe na escalação do próprio grupo', async () => {
  const m = mundo();
  const id = await marcado(m);
  await entrarAmistoso(m.terca, { id, jogadorId: 'p1' });
  await entrarAmistoso(m.meme, { id, jogadorId: 'p1' }); // "p1" do Meme é outra pessoa (outro schema)
  assert.deepEqual(m.repoLiga.tabelas.escalacoes.map((e) => e.grupo).sort(), ['meme', 'terca']);
  await sairAmistoso(m.meme, { id, jogadorId: 'p1' });
  assert.deepEqual(m.repoLiga.tabelas.escalacoes.map((e) => e.grupo), ['terca']);
});

await ta('confirmar/desconfirmar: respeita o limite de vagas; o adversário passa a ver o confirmado', async () => {
  const m = mundo();
  const id = await marcado(m, 1);
  await entrarAmistoso(m.terca, { id, jogadorId: 'p1' });
  await entrarAmistoso(m.terca, { id, jogadorId: 'p2' });
  assert.deepEqual(await confirmarEscalado(m.terca, { id, jogadorId: 'p9' }), { error: 'Essa pessoa não está na lista.' });
  assert.equal((await confirmarEscalado(m.terca, { id, jogadorId: 'p1' })).status, 'ok');
  assert.deepEqual(await confirmarEscalado(m.terca, { id, jogadorId: 'p2' }), { error: 'Já tem 1 confirmados (limite 1).' });
  const visto = (await lerBlocoLiga(m.meme)).amistosos.find((x) => x.id === id).escalacaoAdversario;
  assert.deepEqual(visto, { confirmados: [{ jogadorId: 'p1', nome: 'Ana', foto: '' }], interessados: 1 });
  const r = await desconfirmarEscalado(m.terca, { id, jogadorId: 'p1' });
  assert.equal(minha(r, id).jogadores.find((j) => j.jogadorId === 'p1').status, 'interessado');
});

await ta('travar: ninguém entra nem sai, mas o organizador ainda confirma; destravar libera', async () => {
  const m = mundo();
  const id = await marcado(m);
  await entrarAmistoso(m.terca, { id, jogadorId: 'p1' });
  const r = await travarEscalacao(m.terca, { id });
  assert.equal(minha(r, id).travada, true);
  assert.deepEqual(await entrarAmistoso(m.terca, { id, jogadorId: 'p2' }), { error: 'A lista do seu grupo está travada.' });
  assert.deepEqual(await sairAmistoso(m.terca, { id, jogadorId: 'p1' }), { error: 'A lista do seu grupo está travada.' });
  assert.equal((await confirmarEscalado(m.terca, { id, jogadorId: 'p1' })).status, 'ok');
  assert.equal((await entrarAmistoso(m.meme, { id, jogadorId: 'p2' })).status, 'ok'); // a trava do Terça não trava o Meme
  await destravarEscalacao(m.terca, { id });
  assert.equal((await entrarAmistoso(m.terca, { id, jogadorId: 'p2' })).status, 'ok');
});

await ta('sairAmistoso: quem não está na lista recebe erro', async () => {
  const m = mundo();
  const id = await marcado(m);
  assert.deepEqual(await sairAmistoso(m.terca, { id, jogadorId: 'p1' }), { error: 'Essa pessoa não está na lista.' });
});

const PLACAR = { setsConvidante: 3, setsConvidado: 1, parciais: [[25, 20], [25, 22], [18, 25], [25, 23]] };

await ta('lancarPlacar: só marcado e só depois do horário (Brasília); fica aguardando o outro grupo', async () => {
  const m = mundo();
  const id = await marcado(m);
  assert.deepEqual(await lancarPlacar(m.terca, { id, ...PLACAR }, ORG), { error: 'O placar só pode ser lançado depois do horário do jogo.' });
  m.avancar('2026-10-20T22:59:00.000Z'); // 19:59 em Brasília, jogo às 20:00
  assert.deepEqual(await lancarPlacar(m.terca, { id, ...PLACAR }, ORG), { error: 'O placar só pode ser lançado depois do horário do jogo.' });
  m.avancar('2026-10-20T23:00:00.000Z');
  const r = await lancarPlacar(m.terca, { id, ...PLACAR }, ORG);
  const a = r.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.setsConvidante, a.setsConvidado, a.placarLancadoPorGrupo], ['aguardando_confirmacao', 3, 1, 'terca']);
  assert.deepEqual(a.parciais, PLACAR.parciais);
  assert.equal(a.mensagens.at(-1).tipo, 'placar');
  assert.match(a.mensagens.at(-1).texto, /3 × 1/);
});

await ta('lancarPlacar: placar inválido e parciais inválidas', async () => {
  const m = mundo();
  const id = await marcado(m);
  m.avancar('2026-10-21T01:00:00.000Z');
  for (const ruim of [{ setsConvidante: 0, setsConvidado: 0 }, { setsConvidante: -1, setsConvidado: 2 }, { setsConvidante: 1.5, setsConvidado: 2 }, { setsConvidante: 10, setsConvidado: 0 }, { setsConvidante: 'a', setsConvidado: 1 }]) {
    assert.deepEqual(await lancarPlacar(m.terca, { id, ...ruim }, ORG), { error: 'Placar inválido.' }, JSON.stringify(ruim));
  }
  assert.deepEqual(await lancarPlacar(m.terca, { id, setsConvidante: 2, setsConvidado: 1, parciais: [[25, 'x']] }, ORG), { error: 'Parciais inválidas.' });
  assert.deepEqual(await lancarPlacar(m.terca, { id, setsConvidante: 2, setsConvidado: 1, parciais: 'abc' }, ORG), { error: 'Parciais inválidas.' });
  assert.equal((await lancarPlacar(m.terca, { id, setsConvidante: 2, setsConvidado: 1 }, ORG)).status, 'ok'); // parciais opcionais
});

await ta('confirmarPlacar: só o grupo que NÃO lançou; encerra', async () => {
  const m = mundo();
  const id = await marcado(m);
  m.avancar('2026-10-21T01:00:00.000Z');
  await lancarPlacar(m.terca, { id, ...PLACAR }, ORG);
  assert.deepEqual(await confirmarPlacar(m.terca, { id }, ORG), { error: 'Quem confirma o placar é o outro grupo.' });
  const r = await confirmarPlacar(m.meme, { id }, ORG);
  assert.equal(r.liga.amistosos.find((x) => x.id === id).status, 'encerrado');
  assert.deepEqual(await confirmarPlacar(m.meme, { id }, ORG), { error: 'Esse placar já foi confirmado.' });
});

await ta('contestarPlacar: exige texto, limpa o placar e volta para marcado; qualquer lado lança de novo', async () => {
  const m = mundo();
  const id = await marcado(m);
  m.avancar('2026-10-21T01:00:00.000Z');
  await lancarPlacar(m.terca, { id, ...PLACAR }, ORG);
  assert.deepEqual(await contestarPlacar(m.meme, { id, texto: ' ' }, ORG), { error: 'Explique o que está errado no placar.' });
  assert.deepEqual(await contestarPlacar(m.terca, { id, texto: 'x' }, ORG), { error: 'Quem confirma o placar é o outro grupo.' });
  const r = await contestarPlacar(m.meme, { id, texto: 'foi 3 × 2' }, ORG);
  const a = r.liga.amistosos.find((x) => x.id === id);
  assert.deepEqual([a.status, a.setsConvidante, a.placarLancadoPorGrupo, a.parciais], ['marcado', null, '', []]);
  assert.equal((await lancarPlacar(m.meme, { id, setsConvidante: 3, setsConvidado: 2 }, ORG)).status, 'ok');
});

await ta('confirmação automática: depois de 7 dias aparece encerrado e a primeira escrita grava isso', async () => {
  const m = mundo();
  const id = await marcado(m);
  m.avancar('2026-10-21T01:00:00.000Z');
  await lancarPlacar(m.terca, { id, ...PLACAR }, ORG);
  m.avancar('2026-10-28T01:00:00.000Z');
  assert.equal((await lerBlocoLiga(m.meme)).amistosos.find((x) => x.id === id).status, 'encerrado');
  assert.equal(m.repoLiga.tabelas.amistosos[0].status, 'aguardando_confirmacao'); // a leitura não grava
  assert.deepEqual(await contestarPlacar(m.meme, { id, texto: 'tarde demais' }, ORG), { error: 'Esse placar já foi confirmado.' });
  assert.equal(m.repoLiga.tabelas.amistosos[0].status, 'encerrado'); // a escrita gravou
});

// ---- revisão final: versão vista pela pessoa e limite de 500 do histórico ----
await ta('fix: aceitar/confirmar com versão velha (a data mudou numa contraproposta) é recusado; sem versão segue valendo', async () => {
  const m = mundo();
  const id = await convidar(m);
  m.avancar('2026-10-12T15:01:00.000Z');
  const r1 = await responderConvite(m.meme, { id, resposta: 'contrapropor', data: '2026-10-22', horario: '19:00' }, ORG);
  const versaoVista = r1.liga.amistosos.find((x) => x.id === id).atualizadoEm; // organizador B do Terça abre a página aqui
  m.avancar('2026-10-12T15:02:00.000Z');
  await responderConvite(m.terca, { id, resposta: 'contrapropor', data: '2026-10-23', horario: '19:00' }, ORG);
  m.avancar('2026-10-12T15:03:00.000Z');
  const r3 = await responderConvite(m.meme, { id, resposta: 'contrapropor', data: '2026-10-25', horario: '19:00' }, ORG);
  assert.deepEqual(await responderConvite(m.terca, { id, resposta: 'aceitar', versao: versaoVista }, ORG),
    { error: 'Esse amistoso mudou enquanto você olhava. Recarregue a página e tente de novo.' });
  const atual = (await lerBlocoLiga(m.terca)).amistosos.find((x) => x.id === id).atualizadoEm;
  assert.equal(r3.liga.amistosos.find((x) => x.id === id).atualizadoEm, atual);
  assert.equal((await responderConvite(m.terca, { id, resposta: 'aceitar', versao: atual }, ORG)).status, 'ok');
  // placar contestado e relançado diferente: confirmar com a versão do placar antigo é recusado
  m.avancar('2026-10-26T01:00:00.000Z');
  const p1 = await lancarPlacar(m.meme, { id, setsConvidante: 3, setsConvidado: 0 }, ORG);
  const versaoPlacar1 = p1.liga.amistosos.find((x) => x.id === id).atualizadoEm;
  m.avancar('2026-10-26T01:01:00.000Z');
  await contestarPlacar(m.terca, { id, texto: 'não foi isso' }, ORG);
  m.avancar('2026-10-26T01:02:00.000Z');
  await lancarPlacar(m.meme, { id, setsConvidante: 0, setsConvidado: 3 }, ORG);
  assert.deepEqual(await confirmarPlacar(m.terca, { id, versao: versaoPlacar1 }, ORG),
    { error: 'Esse amistoso mudou enquanto você olhava. Recarregue a página e tente de novo.' });
  assert.equal((await confirmarPlacar(m.terca, { id }, ORG)).status, 'ok');
});

await ta('fix: texto montado do histórico (contraproposta com local longo + recado longo) nunca passa de 500', async () => {
  const m = mundo();
  const id = await convidar(m);
  const r = await responderConvite(m.meme, { id, resposta: 'contrapropor', data: '2026-10-22', horario: '19:00', local: 'L'.repeat(200), recado: 'r'.repeat(500) }, ORG);
  assert.equal(r.status, 'ok', JSON.stringify(r));
  const textos = m.repoLiga.tabelas.amistoso_mensagens.map((x) => x.texto.length);
  assert.ok(textos.every((n) => n <= 500), JSON.stringify(textos));
});

fim();
