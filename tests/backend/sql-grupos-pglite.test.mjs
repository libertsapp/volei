// Executa o SQL dos grupos de verdade num Postgres embutido (PGlite) e confere o isolamento entre grupos: o que o
// teste sql-grupos (leitura de texto) não consegue provar — chaves estrangeiras compostas, funções presas ao grupo,
// criar_grupo tudo-ou-nada. O PGlite NÃO é dependência do projeto: se não estiver instalado o teste é PULADO.
// Para rodar: npm i --no-save @electric-sql/pglite   (ou PGLITE_MODULO=<caminho do index.js de uma instalação dele>)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let PGlite;
try {
  ({ PGlite } = await import(process.env.PGLITE_MODULO ? pathToFileURL(process.env.PGLITE_MODULO).href : '@electric-sql/pglite'));
} catch {
  console.log('PULADO - sql-grupos-pglite: PGlite não instalado (npm i --no-save @electric-sql/pglite para rodar).');
  process.exit(0);
}
const R = path.join(import.meta.dirname, '..', '..') + path.sep;
const ler = (f) => fs.readFileSync(R + f, 'utf8');
const db = new PGlite();
const ok = (m) => console.log('ok    -', m);
const falha = (m) => { console.log('FALHA -', m); process.exitCode = 1; };
async function esperarErro(sql, params, padrao, nome) {
  try { await db.query(sql, params); falha(nome + ' (não deu erro)'); }
  catch (e) { (padrao.test(e.message) ? ok : falha)(nome + ' → ' + e.message.slice(0, 90)); }
}
// papéis que existem no Supabase (grant/revoke falhariam sem eles)
await db.exec('create role anon; create role authenticated; create role service_role;');
await db.exec(ler('sql/liga/schema-liga.sql'));
await db.exec(ler('sql/liga/ajuste-1-cidade.sql'));
ok('liga + ajuste-1-cidade executaram');
const liga = await db.query('select id, cidade, uf from liga.grupos order by id');
(JSON.stringify(liga.rows) === JSON.stringify([{ id: 'meme', cidade: 'Santa Luzia', uf: 'MG' }, { id: 'terca', cidade: 'Santa Luzia', uf: 'MG' }]) ? ok : falha)('Terça e Meme em Santa Luzia/MG: ' + JSON.stringify(liga.rows));
await db.exec(ler('sql/grupos/schema-grupos.sql'));
ok('schema-grupos executou inteiro');

const criar = (ap, email) => db.query("select grupos.criar_grupo($1, 'Vôlei ' || $1, 'Belo Horizonte', 'mg', '#FFD700', $2, 'Dono') as id", [ap, email]);
const A = (await criar('quinta', 'a@x.com')).rows[0].id;
const B = (await criar('sabado', 'b@x.com')).rows[0].id;
ok('criar_grupo criou dois grupos');
const u = await db.query('select grupo_id, email, perfil from grupos.usuarios order by email');
(u.rows.length === 2 && u.rows.every((r) => r.perfil === 'admin') ? ok : falha)('dono de cada grupo nasce admin');
const lg = await db.query("select id, cidade, uf, cor from liga.grupos where id in ('quinta','sabado') order by id");
(lg.rows.length === 2 && lg.rows[0].uf === 'MG' && lg.rows[0].cor === '#ffd700' ? ok : falha)('grupo novo entra na liga com cidade/UF e cor normalizadas: ' + JSON.stringify(lg.rows[0]));
await esperarErro("select grupos.criar_grupo('quinta2', 'Xyz', 'BH', 'MG', '#ffd700', 'A@X.com', 'D')", [], /limite_por_email/, '1 grupo por e-mail (mesmo com maiúscula)');
await esperarErro("select grupos.criar_grupo('quinta', 'Xyz', 'BH', 'MG', '#ffd700', 'c@x.com', 'D')", [], /apelido_em_uso/, 'apelido repetido');
await esperarErro("select grupos.criar_grupo('terca', 'Xyz', 'BH', 'MG', '#ffd700', 'c@x.com', 'D')", [], /apelido_reservado/, 'apelido reservado');
await esperarErro("select grupos.criar_grupo('Qu Inta', 'Xyz', 'BH', 'MG', '#ffd700', 'c@x.com', 'D')", [], /apelido_invalido/, 'apelido inválido');
await esperarErro("select grupos.criar_grupo('domingo', 'Xyz', 'BH', 'XX', '#ffd700', 'c@x.com', 'D')", [], /check/, 'UF inválida recusada pelo banco');
const nGrupos = (await db.query('select count(*)::int n from grupos.grupos')).rows[0].n;
const nLiga = (await db.query("select count(*)::int n from liga.grupos where id not in ('terca','meme')")).rows[0].n;
(nGrupos === 2 && nLiga === 2 ? ok : falha)('criações recusadas não deixaram meio grupo (transação): ' + nGrupos + '/' + nLiga);

// mesmo id de jogador nos dois grupos, e referência cruzada recusada
await db.query("insert into grupos.jogadores (grupo_id, id, nome) values ($1, 'p1', 'Ana A'), ($2, 'p1', 'Ana B')", [A, B]);
ok('mesmo id p1 nos dois grupos');
await db.query("insert into grupos.jogadores (grupo_id, id, nome) values ($1, 'p2', 'Bia A')", [A]);
await esperarErro("insert into grupos.checkins (grupo_id, id, data, jogador_id) values ($1, 'c1', '2026-10-20', 'p2')", [B], /foreign key/, 'check-in do grupo B apontando para jogador só do A');

// funções presas ao grupo
const rodada = (id) => JSON.stringify({ id, data: '2026-10-20', rascunho: false, horario: '20:00', times: [{ nome: 'T1', vitorias: 2, vencedor: true, playerIds: ['p1'] }], convidados: [{ id: 'g1', nome: 'Convidado' }] });
await db.query('select grupos.gravar_rodada($1, $2::jsonb)', [A, rodada('r1')]);
await db.query('select grupos.gravar_rodada($1, $2::jsonb)', [B, rodada('r1')]);
const tj = await db.query('select grupo_id, count(*)::int n from grupos.time_jogadores group by 1');
(tj.rows.length === 2 ? ok : falha)('gravar_rodada com o mesmo round_id nos dois grupos');
await db.query('select grupos.gravar_rodada($1, $2::jsonb)', [A, rodada('r1')]);
const tjA = (await db.query('select count(*)::int n from grupos.time_jogadores where grupo_id = $1', [A])).rows[0].n;
(tjA === 1 ? ok : falha)('regravar a rodada do A substitui (não duplica): ' + tjA);
const rem = await db.query("select grupos.remover_rodada($1, 'r1') as ok", [A]);
const sobrou = (await db.query('select grupo_id from grupos.rodadas')).rows;
(rem.rows[0].ok === true && sobrou.length === 1 && sobrou[0].grupo_id === B ? ok : falha)('remover_rodada no A não apaga a rodada do B');
const t1 = await db.query("select grupos.pegar_trava($1, 'gravacao', 'dono-a', 30) as ok", [A]);
const t2 = await db.query("select grupos.pegar_trava($1, 'gravacao', 'dono-b', 30) as ok", [B]);
const t3 = await db.query("select grupos.pegar_trava($1, 'gravacao', 'outro', 30) as ok", [A]);
(t1.rows[0].ok && t2.rows[0].ok && !t3.rows[0].ok ? ok : falha)('trava por grupo: A e B travam ao mesmo tempo; segundo dono no A espera');
await db.query('select grupos.incrementar_acesso($1)', [A]);
await db.query('select grupos.incrementar_acesso($1)', [A]);
const cA = (await db.query('select grupos.incrementar_acesso($1) as n', [A])).rows[0].n;
const cB = (await db.query('select grupos.incrementar_acesso($1) as n', [B])).rows[0].n;
(Number(cA) === 3 && Number(cB) === 1 ? ok : falha)('contador de acessos por grupo: ' + cA + ' / ' + cB);
await db.query("insert into grupos.checkins (grupo_id, id, data, jogador_id, jogo) values ($1,'a1','2026-10-20','p1',1), ($1,'a2','2026-10-20','p2',2), ($2,'b1','2026-10-20','p1',2)", [A, B]);
const mv = (await db.query("select grupos.mover_jogo2_para_jogo1($1, '2026-10-20') as n", [A])).rows[0].n;
const jogoB = (await db.query("select jogo from grupos.checkins where grupo_id = $1 and id = 'b1'", [B])).rows[0].jogo;
(mv === 1 && jogoB === 2 ? ok : falha)('mover_jogo2_para_jogo1 no A não mexe no B');
const mc = (await db.query("select grupos.mover_checkin_de_jogo($1, 'b1', 1::smallint) as ok", [A])).rows[0].ok;
(mc === false ? ok : falha)('mover_checkin_de_jogo do A não acha check-in do B');
const r1 = (await db.query("select grupos.registrar_tentativa($1, 'ip1', 1, 60, 300) as ok", [A])).rows[0].ok;
const r2 = (await db.query("select grupos.registrar_tentativa($1, 'ip1', 1, 60, 300) as ok", [A])).rows[0].ok;
const r3 = (await db.query("select grupos.registrar_tentativa($1, 'ip1', 1, 60, 300) as ok", [B])).rows[0].ok;
(r1 && !r2 && r3 ? ok : falha)('limite de tentativas por grupo');
await db.query("insert into grupos.fin_dias (grupo_id, data) values ($1, '2026-10-20')", [A]);
await db.query("insert into grupos.fin_pagamentos (grupo_id, id, data, jogador_id) values ($1, 'pg1', '2026-10-20', 'p1')", [A]);
await esperarErro("insert into grupos.fin_pagamentos (grupo_id, id, data, jogador_id) values ($1, 'pg2', '2026-10-20', 'p1')", [A], /fin_pagamentos_valido_uniq/, 'pagamento repetido cai no índice com o nome que o repositório reconhece');
await db.query("insert into grupos.push_inscricoes (grupo_id, id, endpoint, p256dh, auth) values ($1, 'i1', 'e1', 'p', 'a'), ($2, 'i1', 'e1', 'p', 'a')", [A, B]);
ok('o mesmo aparelho (endpoint) pode se inscrever em dois grupos');
// apagar um grupo leva tudo dele junto
await db.query('delete from grupos.grupos where id = $1', [B]);
const restoB = (await db.query('select (select count(*) from grupos.jogadores where grupo_id = $1) + (select count(*) from grupos.rodadas where grupo_id = $1) + (select count(*) from grupos.checkins where grupo_id = $1) as n', [B])).rows[0].n;
(Number(restoB) === 0 ? ok : falha)('apagar o grupo apaga os dados dele em cascata');
console.log(process.exitCode ? '\nFALHA(S)' : '\nTODOS OS TESTES PASSARAM');
