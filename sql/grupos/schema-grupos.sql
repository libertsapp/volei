-- Grupos independentes (spec docs/superpowers/specs/2026-10-12-grupos-independentes-design.md) — Fase 1.
-- Schema "grupos": TODOS os grupos novos moram nas mesmas tabelas, cada linha marcada com grupo_id. Chaves primárias e
-- estrangeiras começam por grupo_id, então nem o banco deixa um grupo apontar para jogador/rodada/dia de outro.
-- Terça (public) e Meme (meme) NÃO são tocados. NÃO é processado pelo scripts/gerar-sql-grupo.js.
-- QUEM RODA: o usuário, uma vez, no SQL Editor (depois do sql/liga/ajuste-1-cidade.sql).
-- Depois: Configurações > API > "Exposed schemas": acrescentar "grupos".
create schema if not exists grupos;
grant usage on schema grupos to service_role;
set search_path to grupos;

-- ======================================================================= cadastro
create table grupos (
  id uuid primary key default gen_random_uuid(),
  apelido text not null unique check (apelido ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' and apelido !~ '--'),
  nome text not null check (char_length(btrim(nome)) between 3 and 60),
  cidade text not null check (char_length(btrim(cidade)) between 2 and 60),
  uf char(2) not null check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  cor_destaque text not null check (cor_destaque ~ '^#[0-9a-f]{6}$'),
  logo_url text,
  plano text not null default 'gratis',
  status text not null default 'ativo' check (status in ('ativo', 'suspenso')),
  dono_email text not null,
  criado_em timestamptz not null default now()
);
create index if not exists grupos_dono_email_idx on grupos (dono_email);

-- uma linha só (id sempre true): os limites do plano grátis, ajustáveis com um update
create table limites (
  id boolean primary key default true check (id),
  max_grupos_por_email int not null default 1,
  max_jogadores_por_grupo int not null default 150,
  max_foto_kb int not null default 300,
  max_criacoes_por_ip_hora int not null default 3
);
insert into limites default values on conflict do nothing;

-- mesma lista de backend/grupos-cadastro.js (APELIDOS_RESERVADOS) — o teste sql-grupos confere que as duas batem
create table apelidos_reservados (apelido text primary key);
insert into apelidos_reservados (apelido) values
  ('criar'), ('admin'), ('api'), ('app'), ('www'), ('static'), ('assets'), ('sw'), ('login'), ('ajuda'), ('suporte'),
  ('termos'), ('privacidade'), ('volei'), ('voleimeme'), ('terca'), ('meme'), ('memberstars'),
  ('porra'), ('caralho'), ('merda'), ('puta'), ('buceta'), ('foda'), ('viado')
on conflict do nothing;

-- ======================================================================= sequências da coluna "ordem"
-- uma por tabela, globais: a ordem relativa DENTRO de cada grupo é a mesma de ter uma por grupo
create sequence if not exists seq_ordem_jogadores;
create sequence if not exists seq_ordem_rodadas;
create sequence if not exists seq_ordem_checkins;
create sequence if not exists seq_ordem_usuarios;
create sequence if not exists seq_ordem_fin_dias;
create sequence if not exists seq_ordem_fin_pagamentos;
create sequence if not exists seq_ordem_fin_creditos;
create sequence if not exists seq_ordem_fin_lancamentos;

-- ======================================================================= núcleo
create table jogadores (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  nome text not null,
  apelido text,
  foto text,
  estrelas numeric(3,1),
  sexo text check (sexo in ('M','F')),
  porte text,
  convidado boolean not null default false,
  removido boolean not null default false,
  ordem int default nextval('seq_ordem_jogadores'),
  primary key (grupo_id, id)
);

create table rodadas (
  grupo_id uuid not null references grupos(id) on delete cascade,
  round_id text not null,
  data date not null,
  rascunho boolean not null default false,
  horario text check (horario is null or horario ~ '^[0-2][0-9]:[0-5][0-9]$'),
  ordem int default nextval('seq_ordem_rodadas'),
  primary key (grupo_id, round_id)
);

create table times_rodada (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  round_id text not null,
  time_index int not null,
  time_nome text,
  vitorias int not null default 0,
  vencedor boolean not null default false,
  unique (grupo_id, round_id, time_index),
  unique (grupo_id, id),
  foreign key (grupo_id, round_id) references rodadas(grupo_id, round_id)
);

create table time_jogadores (
  grupo_id uuid not null references grupos(id) on delete cascade,
  time_rodada_id bigint not null,
  jogador_id text not null,
  posicao int,
  primary key (grupo_id, time_rodada_id, jogador_id),
  foreign key (grupo_id, time_rodada_id) references times_rodada(grupo_id, id),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id)
);

create table checkins (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  data date not null,
  jogador_id text,
  jogador_nome text,
  estrelas numeric(3,1),
  sexo text,
  estrelas_ajustadas numeric(3,1),
  jogo smallint not null default 1 check (jogo in (1, 2)),
  ordem int default nextval('seq_ordem_checkins'),
  primary key (grupo_id, id),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id)
);

create table usuarios (
  grupo_id uuid not null references grupos(id) on delete cascade,
  email text not null,
  nome text,
  perfil text not null default 'jogador' check (perfil in ('jogador','organizador','admin')),
  jogador_id text,
  criado_em timestamptz not null default now(),
  jogador_id_pendente text,
  ordem int default nextval('seq_ordem_usuarios'),
  primary key (grupo_id, email),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id),
  foreign key (grupo_id, jogador_id_pendente) references jogadores(grupo_id, id)
);
create unique index if not exists usuarios_jogador_id_unico on usuarios (grupo_id, jogador_id) where jogador_id is not null;
create unique index if not exists usuarios_jogador_id_pendente_unico on usuarios (grupo_id, jogador_id_pendente) where jogador_id_pendente is not null;

create table config (
  grupo_id uuid not null references grupos(id) on delete cascade,
  chave text not null,
  valor text,
  primary key (grupo_id, chave)
);

-- token_hash é aleatório (único no banco todo); a sessão carrega o grupo e só é achada dentro dele
create table sessoes (
  token_hash text primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  email text not null,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null,
  renovada_em timestamptz not null default now()
);
create index if not exists sessoes_grupo_email_idx on sessoes (grupo_id, email);

create table push_inscricoes (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz,
  primary key (grupo_id, id),
  unique (grupo_id, endpoint)
);

-- ======================================================================= financeiro
create table fin_dias (
  grupo_id uuid not null references grupos(id) on delete cascade,
  data date not null,
  valor_pessoa numeric(10,2),
  pix text,
  valor_quadra numeric(10,2),
  tem_brinde boolean,
  valor_brinde numeric(10,2),
  atualizado_por text,
  atualizado_em timestamptz,
  icone text,
  status text not null default 'normal' check (status in ('normal','semjogo')),
  por_jogo boolean not null default false,
  ordem int default nextval('seq_ordem_fin_dias'),
  primary key (grupo_id, data)
);

create table fin_pagamentos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  data date,
  jogador_id text,
  jogador_nome text,
  valor numeric(10,2),
  marcado_por text,
  marcado_em timestamptz,
  estornado boolean not null default false,
  estornado_por text,
  estornado_em timestamptz,
  tipo text not null default 'dinheiro' check (tipo in ('dinheiro','credito')),
  credito_id text,
  jogo smallint check (jogo in (1, 2)),
  ordem int default nextval('seq_ordem_fin_pagamentos'),
  primary key (grupo_id, id),
  foreign key (grupo_id, data) references fin_dias(grupo_id, data),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id)
);

create table fin_creditos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  jogador_id text,
  jogador_nome text,
  valor numeric(10,2),
  origem_pagamento_id text,
  data_origem date,
  criado_por text,
  criado_em timestamptz,
  status text check (status in ('ativo','devolvido','cancelado')),
  encerrado_por text,
  encerrado_em timestamptz,
  jogo_origem smallint check (jogo_origem in (1, 2)),
  ordem int default nextval('seq_ordem_fin_creditos'),
  primary key (grupo_id, id),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id),
  foreign key (grupo_id, origem_pagamento_id) references fin_pagamentos(grupo_id, id)
);

alter table fin_pagamentos
  add constraint fin_pagamentos_credito_fkey
  foreign key (grupo_id, credito_id) references fin_creditos(grupo_id, id);

-- 1 pagamento válido por jogador, por dia (ou por jogo, nos dias separados), DENTRO do grupo. O nome do índice é o que o
-- repositório reconhece no erro 23505 para devolver false (pagamento repetido) — não mudar.
create unique index fin_pagamentos_valido_uniq on fin_pagamentos (grupo_id, data, coalesce(jogo, 0), jogador_id) where not estornado;

create table fin_lancamentos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  data date,
  tipo text check (tipo in ('entrada','saida')),
  descricao text,
  valor numeric(10,2),
  criado_por text,
  criado_em timestamptz,
  estornado boolean not null default false,
  estornado_por text,
  estornado_em timestamptz,
  ordem int default nextval('seq_ordem_fin_lancamentos'),
  primary key (grupo_id, id)
);

create table fin_pendencias (
  grupo_id uuid not null references grupos(id) on delete cascade,
  id text not null,
  jogador_id text,
  jogador_nome text,
  valor numeric(10,2),
  observacao text,
  data date,
  criado_por text,
  criado_em timestamptz,
  status text not null default 'pendente' check (status in ('pendente','paga')),
  baixado_por text,
  baixado_em timestamptz,
  ordem bigint generated by default as identity,
  primary key (grupo_id, id),
  foreign key (grupo_id, jogador_id) references jogadores(grupo_id, id)
);

create table fin_log (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  timestamp timestamptz,
  nome text,
  email text,
  acao text,
  detalhe jsonb
);
create index if not exists fin_log_grupo_idx on fin_log (grupo_id, id desc);

create table fin_jogos (
  grupo_id uuid not null references grupos(id) on delete cascade,
  data date not null,
  jogo smallint not null check (jogo = 2),
  valor_pessoa numeric(10,2),
  pix text,
  valor_quadra numeric(10,2),
  tem_brinde boolean,
  valor_brinde numeric(10,2),
  icone text,
  status text not null default 'normal' check (status in ('normal', 'semjogo')),
  atualizado_por text,
  atualizado_em timestamptz,
  primary key (grupo_id, data, jogo),
  foreign key (grupo_id, data) references fin_dias(grupo_id, data)
);

-- ======================================================================= Ao Vivo
create table ao_vivo (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  round_id text,
  time_index int,
  time_nome text,
  vitorias numeric,
  iniciado_em timestamptz,
  duracao_minutos numeric,
  data date,
  jogadores text,
  -- adiável até o fim da transação: gravar_rodada apaga e recria a rodada que está ao vivo (mesmo motivo do ajuste 6)
  foreign key (grupo_id, round_id) references rodadas(grupo_id, round_id) deferrable initially deferred
);
create index if not exists ao_vivo_grupo_round_idx on ao_vivo (grupo_id, round_id);

create table ao_vivo_log (
  id bigint generated always as identity primary key,
  grupo_id uuid not null references grupos(id) on delete cascade,
  round_id text,
  time_index int,
  time_nome text,
  delta numeric,
  "timestamp" timestamptz
);
create index if not exists ao_vivo_log_grupo_round_idx on ao_vivo_log (grupo_id, round_id);

-- ======================================================================= infraestrutura
create table travas (
  grupo_id uuid not null references grupos(id) on delete cascade,
  nome text not null,
  dono text not null,
  expira_em timestamptz not null,
  primary key (grupo_id, nome)
);

create table limite_tentativas (
  grupo_id uuid not null references grupos(id) on delete cascade,
  chave text not null,
  tentativas int not null default 0,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (grupo_id, chave)
);

-- ======================================================================= RLS e permissões
-- RLS ligado e sem políticas (como no Terça): o navegador nunca fala com o banco, só a função (service_role)
alter table grupos enable row level security;
alter table limites enable row level security;
alter table apelidos_reservados enable row level security;
alter table jogadores enable row level security;
alter table rodadas enable row level security;
alter table times_rodada enable row level security;
alter table time_jogadores enable row level security;
alter table checkins enable row level security;
alter table usuarios enable row level security;
alter table config enable row level security;
alter table sessoes enable row level security;
alter table push_inscricoes enable row level security;
alter table fin_dias enable row level security;
alter table fin_pagamentos enable row level security;
alter table fin_creditos enable row level security;
alter table fin_lancamentos enable row level security;
alter table fin_pendencias enable row level security;
alter table fin_log enable row level security;
alter table fin_jogos enable row level security;
alter table ao_vivo enable row level security;
alter table ao_vivo_log enable row level security;
alter table travas enable row level security;
alter table limite_tentativas enable row level security;
grant select, insert, update, delete on all tables in schema grupos to service_role;
grant usage, select on all sequences in schema grupos to service_role;

-- ======================================================================= funções (todas presas a p_grupo_id)
create or replace function gravar_rodada(p_grupo_id uuid, p jsonb) returns void
language plpgsql set search_path = grupos as $$
declare
  v_round_id text := p->>'id';
  v_time jsonb;
  v_idx int;
  v_time_id bigint;
begin
  insert into jogadores (grupo_id, id, nome, convidado, ordem)
  select p_grupo_id, c->>'id', c->>'nome', true, null
  from jsonb_array_elements(coalesce(p->'convidados', '[]'::jsonb)) as c
  on conflict (grupo_id, id) do nothing;
  delete from time_jogadores where grupo_id = p_grupo_id
    and time_rodada_id in (select id from times_rodada where grupo_id = p_grupo_id and round_id = v_round_id);
  delete from times_rodada where grupo_id = p_grupo_id and round_id = v_round_id;
  delete from rodadas where grupo_id = p_grupo_id and round_id = v_round_id;
  insert into rodadas (grupo_id, round_id, data, rascunho, horario)
  values (p_grupo_id, v_round_id, (p->>'data')::date, coalesce((p->>'rascunho')::boolean, false), nullif(btrim(p->>'horario'), ''));
  for v_time, v_idx in
    select t.value, (t.ordinality - 1)::int from jsonb_array_elements(p->'times') with ordinality as t
  loop
    insert into times_rodada (grupo_id, round_id, time_index, time_nome, vitorias, vencedor)
    values (p_grupo_id, v_round_id, v_idx, v_time->>'nome',
      coalesce((v_time->>'vitorias')::int, 0), coalesce((v_time->>'vencedor')::boolean, false))
    returning id into v_time_id;
    insert into time_jogadores (grupo_id, time_rodada_id, jogador_id, posicao)
    select p_grupo_id, v_time_id, j.value, (j.ordinality - 1)::int
    from jsonb_array_elements_text(coalesce(v_time->'playerIds', '[]'::jsonb)) with ordinality as j
    on conflict do nothing; -- id repetido na mesma lista: vale o primeiro
  end loop;
end;
$$;

create or replace function remover_rodada(p_grupo_id uuid, p_id text) returns boolean
language plpgsql set search_path = grupos as $$
begin
  delete from ao_vivo_log where grupo_id = p_grupo_id and round_id = p_id;
  delete from ao_vivo where grupo_id = p_grupo_id and round_id = p_id;
  delete from time_jogadores where grupo_id = p_grupo_id
    and time_rodada_id in (select id from times_rodada where grupo_id = p_grupo_id and round_id = p_id);
  delete from times_rodada where grupo_id = p_grupo_id and round_id = p_id;
  delete from rodadas where grupo_id = p_grupo_id and round_id = p_id;
  return found; -- "found" vem do último comando: o delete da própria rodada
end;
$$;

create or replace function incrementar_acesso(p_grupo_id uuid) returns numeric
language plpgsql set search_path = grupos as $$
declare
  v_novo text;
begin
  insert into config (grupo_id, chave, valor) values (p_grupo_id, 'contadorAcessos', '1')
  on conflict (grupo_id, chave) do update set valor = (
    case when btrim(config.valor) ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
         then btrim(config.valor)::numeric else 0 end + 1
  )::text
  returning valor into v_novo;
  return v_novo::numeric;
end;
$$;

-- trava de gravação POR GRUPO: um sorteio no grupo A não bloqueia um check-in no grupo B
create or replace function pegar_trava(p_grupo_id uuid, p_nome text, p_dono text, p_ttl_seg int) returns boolean
language plpgsql set search_path = grupos as $$
declare
  v_ok boolean;
begin
  insert into travas as t (grupo_id, nome, dono, expira_em)
  values (p_grupo_id, p_nome, p_dono, now() + make_interval(secs => p_ttl_seg))
  on conflict (grupo_id, nome) do update
    set dono = excluded.dono, expira_em = excluded.expira_em
    where t.expira_em < now() or t.dono = excluded.dono
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function soltar_trava(p_grupo_id uuid, p_nome text, p_dono text) returns void
language plpgsql set search_path = grupos as $$
begin
  delete from travas where grupo_id = p_grupo_id and nome = p_nome and dono = p_dono;
end;
$$;

create or replace function registrar_tentativa(p_grupo_id uuid, p_chave text, p_max int, p_janela_seg int, p_bloqueio_seg int) returns boolean
language plpgsql set search_path = grupos as $$
declare
  v_permitido boolean;
begin
  delete from limite_tentativas
   where grupo_id = p_grupo_id
     and atualizado_em < now() - interval '1 day'
     and (bloqueado_ate is null or bloqueado_ate < now())
     and chave <> p_chave;
  insert into limite_tentativas as l (grupo_id, chave, tentativas, bloqueado_ate, atualizado_em)
  values (p_grupo_id, p_chave, 1, null, now())
  on conflict (grupo_id, chave) do update set
    tentativas = case
      when l.bloqueado_ate > now() then l.tentativas
      when l.atualizado_em < now() - make_interval(secs => p_janela_seg)
        or (l.bloqueado_ate is not null and l.bloqueado_ate <= now()) then 1
      else l.tentativas + 1 end,
    bloqueado_ate = case
      when l.bloqueado_ate > now() then l.bloqueado_ate
      when l.atualizado_em < now() - make_interval(secs => p_janela_seg)
        or (l.bloqueado_ate is not null and l.bloqueado_ate <= now()) then null
      when l.tentativas + 1 > p_max then now() + make_interval(secs => p_bloqueio_seg)
      else null end,
    atualizado_em = case when l.bloqueado_ate > now() then l.atualizado_em else now() end
  returning (bloqueado_ate is null or bloqueado_ate <= now()) into v_permitido;
  return coalesce(v_permitido, false);
end;
$$;

create or replace function limpar_falhas(p_grupo_id uuid, p_chave text) returns void
language plpgsql set search_path = grupos as $$
begin
  delete from limite_tentativas where grupo_id = p_grupo_id and chave = p_chave;
end;
$$;

create or replace function mover_checkin_de_jogo(p_grupo_id uuid, p_id text, p_para_jogo smallint) returns boolean
language plpgsql set search_path = grupos as $$
declare
  v_jogador_id text;
  v_data date;
  v_proxima_ordem bigint;
begin
  select jogador_id, data into v_jogador_id, v_data from checkins where grupo_id = p_grupo_id and id = p_id;
  if not found then
    return false;
  end if;
  if v_jogador_id is not null and exists (
    select 1 from checkins where grupo_id = p_grupo_id and data = v_data and jogo = p_para_jogo and jogador_id = v_jogador_id
  ) then
    return false; -- já está no destino: nada para mover
  end if;
  select coalesce(max(ordem), 0) + 1 into v_proxima_ordem from checkins where grupo_id = p_grupo_id and data = v_data and jogo = p_para_jogo;
  update checkins set jogo = p_para_jogo, ordem = v_proxima_ordem where grupo_id = p_grupo_id and id = p_id;
  return true;
end;
$$;

create or replace function mover_jogo2_para_jogo1(p_grupo_id uuid, p_data date) returns int
language plpgsql set search_path = grupos as $$
declare
  v_movidos int := 0;
  v_proxima_ordem bigint;
  v_linha record;
begin
  delete from checkins c2
  where c2.grupo_id = p_grupo_id and c2.data = p_data and c2.jogo = 2 and c2.jogador_id is not null
    and exists (select 1 from checkins c1 where c1.grupo_id = p_grupo_id and c1.data = p_data and c1.jogo = 1 and c1.jogador_id = c2.jogador_id);
  select coalesce(max(ordem), 0) into v_proxima_ordem from checkins where grupo_id = p_grupo_id and data = p_data and jogo = 1;
  for v_linha in select id from checkins where grupo_id = p_grupo_id and data = p_data and jogo = 2 order by ordem loop
    v_proxima_ordem := v_proxima_ordem + 1;
    update checkins set jogo = 1, ordem = v_proxima_ordem where grupo_id = p_grupo_id and id = v_linha.id;
    v_movidos := v_movidos + 1;
  end loop;
  return v_movidos;
end;
$$;

create or replace function mover_fila_para_jogo(p_grupo_id uuid, p_data date, p_de smallint, p_para smallint) returns int
language plpgsql set search_path = grupos as $$
declare
  v_movidos int := 0;
  v_proxima_ordem bigint;
  v_linha record;
begin
  delete from checkins cd
  where cd.grupo_id = p_grupo_id and cd.data = p_data and cd.jogo = p_de and cd.jogador_id is not null
    and exists (select 1 from checkins cp where cp.grupo_id = p_grupo_id and cp.data = p_data and cp.jogo = p_para and cp.jogador_id = cd.jogador_id);
  select coalesce(max(ordem), 0) into v_proxima_ordem from checkins where grupo_id = p_grupo_id and data = p_data and jogo = p_para;
  for v_linha in select id from checkins where grupo_id = p_grupo_id and data = p_data and jogo = p_de order by ordem loop
    v_proxima_ordem := v_proxima_ordem + 1;
    update checkins set jogo = p_para, ordem = v_proxima_ordem where grupo_id = p_grupo_id and id = v_linha.id;
    v_movidos := v_movidos + 1;
  end loop;
  return v_movidos;
end;
$$;

revoke execute on function gravar_rodada(uuid, jsonb) from public, anon, authenticated;
revoke execute on function remover_rodada(uuid, text) from public, anon, authenticated;
revoke execute on function incrementar_acesso(uuid) from public, anon, authenticated;
revoke execute on function pegar_trava(uuid, text, text, int) from public, anon, authenticated;
revoke execute on function soltar_trava(uuid, text, text) from public, anon, authenticated;
revoke execute on function registrar_tentativa(uuid, text, int, int, int) from public, anon, authenticated;
revoke execute on function limpar_falhas(uuid, text) from public, anon, authenticated;
revoke execute on function mover_checkin_de_jogo(uuid, text, smallint) from public, anon, authenticated;
revoke execute on function mover_jogo2_para_jogo1(uuid, date) from public, anon, authenticated;
revoke execute on function mover_fila_para_jogo(uuid, date, smallint, smallint) from public, anon, authenticated;
grant execute on function gravar_rodada(uuid, jsonb) to service_role;
grant execute on function remover_rodada(uuid, text) to service_role;
grant execute on function incrementar_acesso(uuid) to service_role;
grant execute on function pegar_trava(uuid, text, text, int) to service_role;
grant execute on function soltar_trava(uuid, text, text) to service_role;
grant execute on function registrar_tentativa(uuid, text, int, int, int) to service_role;
grant execute on function limpar_falhas(uuid, text) to service_role;
grant execute on function mover_checkin_de_jogo(uuid, text, smallint) to service_role;
grant execute on function mover_jogo2_para_jogo1(uuid, date) to service_role;
grant execute on function mover_fila_para_jogo(uuid, date, smallint, smallint) to service_role;

-- ======================================================================= criação de grupo (o "um clique")
-- Tudo numa transação: valida o apelido e o limite por e-mail, cria o cadastro, o dono como admin e a linha na liga
-- (id da liga = apelido). A config fica vazia de propósito: mapearConfig já devolve os padrões quando a chave não existe.
-- Erros saem como exceção com a mensagem-código (apelido_invalido | apelido_reservado | apelido_em_uso |
-- limite_por_email); a função grupos-api traduz para o usuário. Corrida de dois criando o mesmo apelido ao mesmo tempo
-- cai no unique de grupos.apelido / liga.grupos.id (erro 23505), que a grupos-api também traduz para apelido_em_uso.
create or replace function criar_grupo(p_apelido text, p_nome text, p_cidade text, p_uf text, p_cor text,
                                       p_dono_email text, p_dono_nome text) returns uuid
language plpgsql set search_path = grupos as $$
declare
  v_id uuid;
  v_apelido text := lower(btrim(p_apelido));
  v_email text := lower(btrim(p_dono_email));
  v_max int;
begin
  select max_grupos_por_email into v_max from limites limit 1;
  if v_apelido !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' or v_apelido ~ '--' then
    raise exception 'apelido_invalido';
  end if;
  if exists (select 1 from apelidos_reservados where apelido = v_apelido) then
    raise exception 'apelido_reservado';
  end if;
  if exists (select 1 from grupos where apelido = v_apelido) or exists (select 1 from liga.grupos where id = v_apelido) then
    raise exception 'apelido_em_uso';
  end if;
  if (select count(*) from grupos where dono_email = v_email) >= coalesce(v_max, 1) then
    raise exception 'limite_por_email';
  end if;
  insert into grupos (apelido, nome, cidade, uf, cor_destaque, dono_email)
  values (v_apelido, btrim(p_nome), btrim(p_cidade), upper(btrim(p_uf)), lower(btrim(p_cor)), v_email)
  returning id into v_id;
  insert into usuarios (grupo_id, email, nome, perfil) values (v_id, v_email, p_dono_nome, 'admin');
  insert into liga.grupos (id, nome, cor, cidade, uf)
  values (v_apelido, btrim(p_nome), lower(btrim(p_cor)), btrim(p_cidade), upper(btrim(p_uf)));
  return v_id;
end;
$$;
revoke execute on function criar_grupo(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function criar_grupo(text, text, text, text, text, text, text) to service_role;
