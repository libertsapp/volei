// Testes do cálculo puro dos Amistosos. Extrai o bloco <amistosos-puro> direto do HTML (testa o código que vai pro ar).
// Rodar: node tests/amistosos-puro.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'volei-dashboard.html'), 'utf8').replace(/\r/g, '');
const ini = html.indexOf('// <amistosos-puro>');
const fim = html.indexOf('// </amistosos-puro>');
assert.ok(ini > -1 && fim > ini, 'bloco <amistosos-puro> não encontrado no volei-dashboard.html');
const A = new Function(html.slice(ini, fim) + `
  return { AMI_ATIVOS, amiNormalizar, amiNomeGrupo, amiDataCurta, amiHojeBrasil, amiPendencias, amiTextoAviso,
           amiProximoMarcado, amiPlacarNosso, amiRetrospecto, amiJogoComecou, amiSeparar, amiGruposParaConvite, amiRotuloGrupo };
`)();

let falhas = 0;
function t(nome, fn){
  try { fn(); console.log('ok    -', nome); }
  catch(e){ falhas++; console.log('FALHA -', nome, '\n       ', e.message); }
}

const ami = (id, extra) => Object.assign({ id, convidante: 'terca', convidado: 'meme', adversario: 'meme', data: '2026-10-20', horario: '20:00',
  local: '', vagasPorGrupo: 6, status: 'pendente', vezDe: 'meme', setsConvidante: null, setsConvidado: null, placarLancadoPorGrupo: '', mensagens: [] }, extra || {});
const liga = (amistosos, grupoId) => A.amiNormalizar({ disponivel: true, grupoId: grupoId || 'terca',
  grupos: [{ id: 'terca', nome: 'Vôlei de Terça' }, { id: 'meme', nome: 'Vôlei Meme Brasil' }, { id: 'outro', nome: 'Outro' }], amistosos });

t('amiNormalizar: null vira bloco vazio indisponível', () => {
  assert.deepEqual(A.amiNormalizar(null), { disponivel: false, grupoId: '', grupos: [], amistosos: [] });
});

t('amiPendencias: convite na nossa vez e placar lançado pelo adversário; nada do que espera o outro lado', () => {
  const l = liga([
    ami('convite-recebido', { convidante: 'meme', convidado: 'terca', vezDe: 'terca' }),
    ami('convite-enviado'), // vez do Meme
    ami('placar-deles', { status: 'aguardando_confirmacao', placarLancadoPorGrupo: 'meme', vezDe: '' }),
    ami('placar-nosso', { status: 'aguardando_confirmacao', placarLancadoPorGrupo: 'terca', vezDe: '' }),
    ami('marcado', { status: 'marcado', vezDe: '' })
  ]);
  assert.deepEqual(A.amiPendencias(l).map(a => a.id), ['convite-recebido', 'placar-deles']);
});

t('amiTextoAviso: textos de convite, contraproposta, placar e plural', () => {
  assert.equal(A.amiTextoAviso(liga([])), '');
  assert.equal(A.amiTextoAviso(liga([ami('a', { convidante: 'meme', convidado: 'terca', vezDe: 'terca' })])),
    'Vôlei Meme Brasil convidou vocês pra um amistoso em 20/10');
  assert.equal(A.amiTextoAviso(liga([ami('a', { vezDe: 'terca' })])), 'Vôlei Meme Brasil propôs outra data pro amistoso: 20/10');
  assert.equal(A.amiTextoAviso(liga([ami('a', { status: 'aguardando_confirmacao', placarLancadoPorGrupo: 'meme' })])),
    'Vôlei Meme Brasil lançou o placar do amistoso de 20/10 — confirme');
  assert.equal(A.amiTextoAviso(liga([ami('a', { vezDe: 'terca' }), ami('b', { vezDe: 'terca' })])), '2 amistosos esperando resposta');
});

t('amiHojeBrasil: 22h de Brasília ainda é o mesmo dia (servidor em UTC já virou)', () => {
  assert.equal(A.amiHojeBrasil(Date.parse('2026-10-21T01:00:00Z')), '2026-10-20');
  assert.equal(A.amiHojeBrasil(Date.parse('2026-10-21T03:00:00Z')), '2026-10-21');
});

t('amiProximoMarcado: o marcado mais próximo a partir de hoje; ignora passados e não marcados', () => {
  const l = liga([
    ami('passado', { status: 'marcado', data: '2026-10-01' }),
    ami('longe', { status: 'marcado', data: '2026-11-10' }),
    ami('perto-tarde', { status: 'marcado', data: '2026-10-20', horario: '21:00' }),
    ami('perto-cedo', { status: 'marcado', data: '2026-10-20', horario: '19:00' }),
    ami('pendente', { data: '2026-10-15' })
  ]);
  assert.equal(A.amiProximoMarcado(l, '2026-10-12').id, 'perto-cedo');
  assert.equal(A.amiProximoMarcado(liga([]), '2026-10-12'), null);
});

t('amiPlacarNosso e amiRetrospecto: do ponto de vista de quem olha, por adversário', () => {
  const l = liga([
    ami('1', { status: 'encerrado', setsConvidante: 3, setsConvidado: 1 }), // nós convidamos e ganhamos
    ami('2', { status: 'encerrado', convidante: 'meme', convidado: 'terca', setsConvidante: 3, setsConvidado: 0 }), // perdemos
    ami('3', { status: 'encerrado', setsConvidante: 2, setsConvidado: 2 }),
    ami('4', { status: 'encerrado', adversario: 'outro', convidado: 'outro', setsConvidante: 0, setsConvidado: 2 }),
    ami('5', { status: 'cancelado' })
  ]);
  assert.deepEqual(A.amiPlacarNosso(l, l.amistosos[1]), { nos: 0, eles: 3 });
  assert.deepEqual(A.amiRetrospecto(l), [
    { adversario: 'meme', nome: 'Vôlei Meme Brasil', jogos: 3, vitorias: 1, derrotas: 1, empates: 1 },
    { adversario: 'outro', nome: 'Outro', jogos: 1, vitorias: 0, derrotas: 1, empates: 0 }
  ]);
  // o mesmo jogo visto pelo Meme
  const doMeme = A.amiNormalizar({ ...l, grupoId: 'meme', amistosos: [ami('1', { status: 'encerrado', adversario: 'terca', setsConvidante: 3, setsConvidado: 1 })] });
  assert.deepEqual(A.amiRetrospecto(doMeme)[0], { adversario: 'terca', nome: 'Vôlei de Terça', jogos: 1, vitorias: 0, derrotas: 1, empates: 0 });
});

t('amiJogoComecou: compara com o horário de Brasília', () => {
  const a = ami('a');
  assert.equal(A.amiJogoComecou(a, Date.parse('2026-10-20T22:59:00Z')), false);
  assert.equal(A.amiJogoComecou(a, Date.parse('2026-10-20T23:00:00Z')), true);
});

t('amiSeparar: esperando / marcados (mais próximo primeiro) / histórico (mais recente primeiro)', () => {
  const l = liga([
    ami('p'), ami('ag', { status: 'aguardando_confirmacao' }),
    ami('m2', { status: 'marcado', data: '2026-11-01' }), ami('m1', { status: 'marcado', data: '2026-10-25' }),
    ami('h1', { status: 'encerrado', data: '2026-09-01' }), ami('h2', { status: 'recusado', data: '2026-09-20' }), ami('h3', { status: 'cancelado', data: '2026-08-01' })
  ]);
  const s = A.amiSeparar(l);
  assert.deepEqual(s.esperando.map(a => a.id), ['p', 'ag']);
  assert.deepEqual(s.marcados.map(a => a.id), ['m1', 'm2']);
  assert.deepEqual(s.historico.map(a => a.id), ['h2', 'h1', 'h3']);
});

// Fase 5: "+ Convidar grupo" separa "Na sua cidade" de "Outras cidades", com filtro por UF
const ligaCidades = (grupoId, grupos) => A.amiNormalizar({ disponivel: true, grupoId, grupos, amistosos: [] });
const G5 = [
  { id: 'terca', nome: 'Vôlei de Terça', cidade: 'Santa Luzia', uf: 'MG' },
  { id: 'meme', nome: 'Vôlei Meme Brasil', cidade: 'santa luzia', uf: 'mg' },
  { id: 'zeta', nome: 'Zeta Vôlei', cidade: 'Sânta Lúzia ', uf: 'MG' },
  { id: 'pb', nome: 'Areia PB', cidade: 'Santa Luzia', uf: 'PB' },
  { id: 'bh', nome: 'Quinta BH', cidade: 'Belo Horizonte', uf: 'MG' },
  { id: 'rio', nome: 'Alfa Rio', cidade: 'Rio de Janeiro', uf: 'RJ' },
  { id: 'sem', nome: 'Beta sem cidade' }
];
const ids = (lista) => lista.map(g => g.id);

t('amiGruposParaConvite: mesma cidade+UF (sem ligar pra acento/maiúscula/espaço) primeiro, o resto em ordem alfabética', () => {
  const r = A.amiGruposParaConvite(ligaCidades('terca', G5), '');
  assert.deepEqual(ids(r.naCidade), ['meme', 'zeta']);
  assert.deepEqual(ids(r.outras), ['rio', 'pb', 'sem', 'bh']);
});
t('amiGruposParaConvite: Santa Luzia/PB não é "sua cidade" para Santa Luzia/MG', () => {
  const r = A.amiGruposParaConvite(ligaCidades('terca', G5), '');
  assert.ok(!ids(r.naCidade).includes('pb'));
});
t('amiGruposParaConvite: nunca lista o próprio grupo', () => {
  const r = A.amiGruposParaConvite(ligaCidades('terca', G5), '');
  assert.ok(![...ids(r.naCidade), ...ids(r.outras)].includes('terca'));
});
t('amiGruposParaConvite: UFs dos outros grupos, sem repetir, em ordem (grupo sem UF não entra)', () => {
  assert.deepEqual(A.amiGruposParaConvite(ligaCidades('terca', G5), '').ufs, ['MG', 'PB', 'RJ']);
});
t('amiGruposParaConvite: filtro por UF vale para as duas listas; grupo sem UF some no filtro', () => {
  const mg = A.amiGruposParaConvite(ligaCidades('terca', G5), 'MG');
  assert.deepEqual(ids(mg.naCidade), ['meme', 'zeta']);
  assert.deepEqual(ids(mg.outras), ['bh']);
  const rj = A.amiGruposParaConvite(ligaCidades('terca', G5), 'rj');
  assert.deepEqual(ids(rj.naCidade), []);
  assert.deepEqual(ids(rj.outras), ['rio']);
  assert.deepEqual(rj.ufs, ['MG', 'PB', 'RJ'], 'a lista de UFs não depende do filtro');
});
t('amiGruposParaConvite: meu grupo sem cidade → ninguém é "da sua cidade" (nem quem também não tem cidade)', () => {
  const r = A.amiGruposParaConvite(ligaCidades('sem', G5), '');
  assert.deepEqual(ids(r.naCidade), []);
  assert.equal(r.outras.length, 6);
});
t('amiGruposParaConvite: nenhum grupo na minha cidade → tudo em "outras"', () => {
  const r = A.amiGruposParaConvite(ligaCidades('rio', G5), '');
  assert.deepEqual(ids(r.naCidade), []);
  assert.equal(r.outras.length, 6);
});
t('amiGruposParaConvite: grupos antigos sem cidade/uf no objeto não quebram', () => {
  const r = A.amiGruposParaConvite(ligaCidades('terca', [{ id: 'terca', nome: 'T' }, { id: 'meme', nome: 'M' }]), '');
  assert.deepEqual(ids(r.outras), ['meme']);
  assert.deepEqual(r.ufs, []);
});
t('amiRotuloGrupo: nome — cidade/UF; só o nome quando não há cidade', () => {
  assert.equal(A.amiRotuloGrupo({ nome: 'Quinta BH', cidade: 'Belo Horizonte', uf: 'mg' }), 'Quinta BH — Belo Horizonte/MG');
  assert.equal(A.amiRotuloGrupo({ nome: 'Beta' }), 'Beta');
  assert.equal(A.amiRotuloGrupo({ nome: 'Só cidade', cidade: 'Contagem' }), 'Só cidade — Contagem');
});

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(falhas ? 1 : 0);
