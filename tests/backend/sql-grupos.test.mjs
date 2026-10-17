// Confere o SQL do schema "grupos" contra o que o repositório realmente usa: toda tabela e toda função do banco que o
// repo-supabase chama existe no schema novo, presa ao grupo. Não roda Postgres: lê o texto do SQL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { t, fim } from './executor.mjs';
import { TABELAS } from '../../backend/repo-memoria.js';
import { UFS, APELIDOS_RESERVADOS } from '../../backend/grupos-cadastro.js';

const raiz = path.join(import.meta.dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r/g, '');
const sql = ler('sql/grupos/schema-grupos.sql');
const repo = ler('backend/repo-supabase.js');

// só tabelas de várias linhas ("(" seguido de quebra de linha): a de uma linha só (apelidos_reservados) faria o trecho
// preguiçoso engolir a tabela seguinte
const tabelasDoSql = Object.fromEntries([...sql.matchAll(/create table (\w+) \(\n([\s\S]*?)\n\);/g)].map((m) => [m[1], m[2]]));
// lerTudo lê as tabelas de TABELAS por variável (from(tabela)); as demais aparecem literais (from('sessoes') etc.)
const tabelasDoRepo = [...new Set([...TABELAS, ...[...repo.matchAll(/from\('([a-z_0-9]+)'\)/g)].map((m) => m[1])])];
const funcoesDoRepo = [...new Set([...repo.matchAll(/\.rpc\('([a-z_0-9]+)'/g)].map((m) => m[1]))];
const INFRA = ['travas', 'limite_tentativas'];

t('cada tabela que o repositório usa (mais travas e limites) existe em grupos, com grupo_id ligado ao cadastro', () => {
  for (const tabela of [...tabelasDoRepo, ...INFRA]) {
    assert.ok(tabelasDoSql[tabela], 'falta a tabela ' + tabela);
    assert.match(tabelasDoSql[tabela], /grupo_id uuid not null references grupos\(id\) on delete cascade/, tabela);
    assert.match(sql, new RegExp('alter table ' + tabela + ' enable row level security;'), tabela + ' sem RLS');
  }
  assert.equal(tabelasDoRepo.length + INFRA.length, 22); // +votacoes e votos (Craque/Bola Murcha, v19.1)
});

t('cada função do banco que o repositório chama existe com p_grupo_id como 1º parâmetro e fica só com a service_role', () => {
  for (const f of funcoesDoRepo) {
    assert.match(sql, new RegExp('create or replace function ' + f + '\\(p_grupo_id uuid'), f);
    assert.match(sql, new RegExp('revoke execute on function ' + f + '\\(uuid'), f + ' sem revoke');
    assert.match(sql, new RegExp('grant execute on function ' + f + '\\(uuid'), f + ' sem grant');
  }
  assert.equal(funcoesDoRepo.length, 10);
});

t('chaves primárias começam por grupo_id (e casam com os onConflict do repositório)', () => {
  const pk = (tabela) => (tabelasDoSql[tabela].match(/primary key \(([^)]*)\)/) || [])[1];
  assert.equal(pk('jogadores'), 'grupo_id, id');
  assert.equal(pk('rodadas'), 'grupo_id, round_id');
  assert.equal(pk('checkins'), 'grupo_id, id');
  assert.equal(pk('votacoes'), 'grupo_id, data');
  assert.equal(pk('votos'), 'grupo_id, data, categoria, eleitor_jogador_id');
  assert.equal(pk('usuarios'), 'grupo_id, email');
  assert.equal(pk('config'), 'grupo_id, chave');
  assert.equal(pk('fin_dias'), 'grupo_id, data');
  assert.equal(pk('fin_jogos'), 'grupo_id, data, jogo');
  assert.equal(pk('travas'), 'grupo_id, nome');
  assert.equal(pk('limite_tentativas'), 'grupo_id, chave');
  assert.match(tabelasDoSql.push_inscricoes, /unique \(grupo_id, endpoint\)/);
  // todo onConflict do repositório tem uma chave equivalente com grupo_id na frente
  for (const m of repo.matchAll(/onConflict: '([a-z_,]+)'/g)) {
    const alvo = 'grupo_id, ' + m[1].split(',').join(', ');
    assert.ok(sql.includes('(' + alvo + ')'), 'sem chave para onConflict ' + m[1]);
  }
});

t('referências entre tabelas são compostas: um grupo não aponta para jogador/rodada/dia de outro', () => {
  assert.match(tabelasDoSql.checkins, /foreign key \(grupo_id, jogador_id\) references jogadores\(grupo_id, id\)/);
  assert.match(tabelasDoSql.time_jogadores, /foreign key \(grupo_id, jogador_id\) references jogadores\(grupo_id, id\)/);
  assert.match(tabelasDoSql.time_jogadores, /foreign key \(grupo_id, time_rodada_id\) references times_rodada\(grupo_id, id\)/);
  assert.match(tabelasDoSql.times_rodada, /foreign key \(grupo_id, round_id\) references rodadas\(grupo_id, round_id\)/);
  assert.match(tabelasDoSql.fin_pagamentos, /foreign key \(grupo_id, data\) references fin_dias\(grupo_id, data\)/);
  assert.match(tabelasDoSql.ao_vivo, /foreign key \(grupo_id, round_id\) references rodadas\(grupo_id, round_id\) deferrable initially deferred/);
  assert.match(sql, /foreign key \(grupo_id, credito_id\) references fin_creditos\(grupo_id, id\)/);
  // nenhuma referência simples (sem grupo_id) a tabelas do app
  assert.doesNotMatch(sql, /references (jogadores|rodadas|fin_dias|fin_pagamentos|fin_creditos|times_rodada)\((id|round_id|data)\)/);
});

t('o índice de pagamento válido mantém o nome que o repositório reconhece, agora por grupo', () => {
  assert.match(sql, /create unique index fin_pagamentos_valido_uniq on fin_pagamentos \(grupo_id, data, coalesce\(jogo, 0\), jogador_id\) where not estornado;/);
});

t('as funções nunca tocam linhas sem filtrar pelo grupo (todo delete/update nelas tem grupo_id = p_grupo_id)', () => {
  const corpos = [...sql.matchAll(/create or replace function (\w+)\(p_grupo_id uuid[\s\S]*?\n\$\$;/g)].map((m) => [m[1], m[0]]);
  for (const [nome, corpo] of corpos) {
    // "on conflict ... do update set" é o upsert da própria linha (já presa ao grupo pela chave de conflito): fica de fora
    for (const cmd of corpo.match(/(?<!do )\b(delete from|update) \w+[^;]*;/g) || []) {
      assert.match(cmd, /grupo_id = p_grupo_id/, nome + ': ' + cmd.slice(0, 80));
    }
  }
});

t('JS e SQL concordam: mesmas UFs, mesmos reservados, mesma regex de apelido', () => {
  const ufsSql = sql.match(/uf in \(([^)]*)\)/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(ufsSql.sort(), [...UFS].sort());
  const blocoReservados = sql.match(/insert into apelidos_reservados \(apelido\) values([\s\S]*?)on conflict/)[1];
  const reservadosSql = [...blocoReservados.matchAll(/\('([a-z0-9-]+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(reservadosSql.sort(), [...APELIDOS_RESERVADOS].sort());
  assert.match(sql, /apelido ~ '\^\[a-z0-9\]\[a-z0-9-\]\{1,28\}\[a-z0-9\]\$' and apelido !~ '--'/);
});

t('criar_grupo: uma transação que valida limites e cria cadastro, dono admin e linha na liga', () => {
  const corpo = sql.match(/create or replace function criar_grupo\([\s\S]*?\n\$\$;/)[0];
  for (const erro of ['apelido_invalido', 'apelido_reservado', 'apelido_em_uso', 'limite_por_email']) assert.match(corpo, new RegExp("'" + erro + "'"));
  assert.match(corpo, /insert into grupos \(/);
  assert.match(corpo, /insert into usuarios \(grupo_id, email, nome, perfil\)[\s\S]*'admin'/);
  assert.match(corpo, /insert into liga\.grupos \(id, nome, cor, cidade, uf\)/);
  assert.match(corpo, /from limites/);
  assert.match(sql, /revoke execute on function criar_grupo\(text, text, text, text, text, text, text\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function criar_grupo\(text, text, text, text, text, text, text\) to service_role;/);
});

t('liga ganha cidade e uf (ajuste próprio, idempotente)', () => {
  const liga = ler('sql/liga/ajuste-1-cidade.sql');
  assert.match(liga, /alter table liga\.grupos add column if not exists cidade text;/);
  assert.match(liga, /alter table liga\.grupos add column if not exists uf char\(2\);/);
  assert.match(liga, /update liga\.grupos set cidade = 'Santa Luzia', uf = 'MG' where id in \('terca', 'meme'\);/);
});

t('criar_grupo trava por e-mail dentro da transação (dois cliques juntos não furam o limite de 1 grupo)', () => {
  const corpo = sql.match(/create or replace function criar_grupo\([\s\S]*?\n\$\$;/)[0];
  const trava = corpo.indexOf("perform pg_advisory_xact_lock(hashtext('criar_grupo:' || v_email));");
  assert.ok(trava > -1, 'sem trava por e-mail');
  assert.ok(trava < corpo.indexOf('select count(*) from grupos where dono_email'), 'a trava precisa vir antes da contagem');
});

t('limite global (antes de existir grupo) e apelido_disponivel, só para a service_role', () => {
  assert.match(sql, /create table limite_global \(\n  chave text primary key,/);
  assert.match(sql, /alter table limite_global enable row level security;/);
  assert.match(sql, /grant select, insert, update, delete on limite_global to service_role;/);
  assert.match(sql, /create or replace function registrar_tentativa_global\(p_chave text, p_max int, p_janela_seg int, p_bloqueio_seg int\) returns boolean/);
  assert.match(sql, /create or replace function apelido_disponivel\(p_apelido text\) returns boolean/);
  for (const assinatura of ['registrar_tentativa_global\\(text, int, int, int\\)', 'apelido_disponivel\\(text\\)']) {
    assert.match(sql, new RegExp('revoke execute on function ' + assinatura + ' from public, anon, authenticated;'));
    assert.match(sql, new RegExp('grant execute on function ' + assinatura + ' to service_role;'));
  }
  const corpo = sql.match(/create or replace function apelido_disponivel[\s\S]*?\n\$\$;/)[0];
  for (const fonte of ['from grupos', 'from liga.grupos', 'from apelidos_reservados']) assert.ok(corpo.includes(fonte), fonte);
});

fim();
