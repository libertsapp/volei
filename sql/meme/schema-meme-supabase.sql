-- GERADO por scripts/gerar-sql-grupo.js a partir dos SQL do Terça. NÃO edite: rode "npm run gerar-sql-meme" de novo.
-- Cria o schema "meme" no MESMO projeto do Terça (o schema "public" do Terça não é tocado).
-- QUEM RODA: o usuário, UMA vez, no SQL Editor do Supabase. Depois: Configurações > API > "Exposed schemas": acrescentar o schema.
create schema if not exists meme;
set search_path to meme;

-- ==== schema-terca-supabase.sql (fonte: sql/schema-terca-supabase.sql) ====
-- Núcleo
create table jogadores (
  id text primary key,
  nome text not null,
  apelido text,
  foto text,
  estrelas numeric(3,1),
  sexo text check (sexo in ('M','F')),
  porte text
);

create table rodadas (
  round_id text primary key,
  data date not null,
  vencedor text,
  rascunho boolean not null default false
);

create table times_rodada (
  id bigint generated always as identity primary key,
  round_id text not null references rodadas(round_id),
  time_index int not null,
  time_nome text,
  vitorias int not null default 0,
  unique (round_id, time_index)
);

create table time_jogadores (
  time_rodada_id bigint not null references times_rodada(id),
  jogador_id text not null references jogadores(id),
  primary key (time_rodada_id, jogador_id)
);

create table checkins (
  id text primary key,
  data date not null,
  jogador_id text references jogadores(id),
  jogador_nome text,
  estrelas numeric(3,1),
  sexo text,
  estrelas_ajustadas numeric(3,1)
);

-- Usuários/perfis
create table usuarios (
  email text primary key,
  nome text,
  perfil text not null default 'jogador' check (perfil in ('jogador','organizador','admin')),
  jogador_id text references jogadores(id),
  criado_em timestamptz not null default now(),
  jogador_id_pendente text references jogadores(id)
);

-- Config
create table config (
  chave text primary key,
  valor text
);

-- Financeiro
create table fin_dias (
  data date primary key,
  valor_pessoa numeric(10,2),
  pix text,
  valor_quadra numeric(10,2),
  tem_brinde boolean,
  valor_brinde numeric(10,2),
  atualizado_por text,
  atualizado_em timestamptz,
  icone text,
  status text not null default 'normal' check (status in ('normal','semjogo'))
);

create table fin_pagamentos (
  id text primary key,
  data date references fin_dias(data),
  jogador_id text references jogadores(id),
  jogador_nome text,
  valor numeric(10,2),
  marcado_por text,
  marcado_em timestamptz,
  estornado boolean not null default false,
  estornado_por text,
  estornado_em timestamptz,
  tipo text not null default 'dinheiro' check (tipo in ('dinheiro','credito')),
  credito_id text -- FK adicionada depois de fin_creditos existir (ver abaixo)
);

create table fin_creditos (
  id text primary key,
  jogador_id text references jogadores(id),
  jogador_nome text,
  valor numeric(10,2),
  origem_pagamento_id text references fin_pagamentos(id),
  data_origem date,
  criado_por text,
  criado_em timestamptz,
  status text check (status in ('ativo','devolvido','cancelado')),
  encerrado_por text,
  encerrado_em timestamptz
);

alter table fin_pagamentos
  add constraint fin_pagamentos_credito_id_fkey
  foreign key (credito_id) references fin_creditos(id);

create table fin_lancamentos (
  id text primary key,
  data date,
  tipo text check (tipo in ('entrada','saida')),
  descricao text,
  valor numeric(10,2),
  criado_por text,
  criado_em timestamptz,
  estornado boolean not null default false,
  estornado_por text,
  estornado_em timestamptz
);

create table fin_log (
  id bigint generated always as identity primary key,
  timestamp timestamptz,
  nome text,
  email text,
  acao text,
  detalhe jsonb
);

-- Ao Vivo (efêmero — normalmente vazio no momento da migração)
create table ao_vivo (
  id bigint generated always as identity primary key,
  round_id text references rodadas(round_id),
  time_index int,
  time_nome text,
  vitorias int,
  iniciado_em timestamptz,
  duracao_minutos int
);

create table ao_vivo_log (
  id bigint generated always as identity primary key,
  round_id text,
  time_index int,
  time_nome text,
  delta int,
  "timestamp" timestamptz
);

-- RLS: habilita em todas, sem política nenhuma por enquanto (sub-projeto 2 desenha as políticas)
alter table jogadores enable row level security;
alter table rodadas enable row level security;
alter table times_rodada enable row level security;
alter table time_jogadores enable row level security;
alter table checkins enable row level security;
alter table usuarios enable row level security;
alter table config enable row level security;
alter table fin_dias enable row level security;
alter table fin_pagamentos enable row level security;
alter table fin_creditos enable row level security;
alter table fin_lancamentos enable row level security;
alter table fin_log enable row level security;
alter table ao_vivo enable row level security;
alter table ao_vivo_log enable row level security;

-- ==== schema-terca-supabase-ajuste-1.sql (fonte: sql/schema-terca-supabase-ajuste-1.sql) ====
-- Ajuste 1 (depois da 1ª migração real): convidados viram linhas em jogadores.
alter table jogadores add column if not exists convidado boolean not null default false;

-- ==== schema-terca-supabase-ajuste-2.sql (fonte: sql/schema-terca-supabase-ajuste-2.sql) ====
-- Ajuste 2: vencedor é por time; e a ordem das linhas da planilha passa a ser guardada.
alter table times_rodada add column if not exists vencedor boolean not null default false;
alter table rodadas drop column if exists vencedor;
alter table time_jogadores add column if not exists posicao int;
alter table jogadores add column if not exists ordem int;
alter table rodadas add column if not exists ordem int;
alter table checkins add column if not exists ordem int;
alter table usuarios add column if not exists ordem int;
alter table fin_dias add column if not exists ordem int;
alter table fin_pagamentos add column if not exists ordem int;
alter table fin_creditos add column if not exists ordem int;
alter table fin_lancamentos add column if not exists ordem int;

-- ==== schema-terca-supabase-ajuste-3.sql (fonte: sql/schema-terca-supabase-ajuste-3.sql) ====
-- Ajuste 3 (etapa 3a): jogador arquivado, ordem dada pelo banco, índices únicos e funções de rodada.
-- Pode ser executado mais de uma vez sem estragar nada.

-- 1) Jogador removido = arquivado: some da lista, mas o histórico (rodadas, check-ins, pagamentos, vínculos) continua válido.
alter table jogadores add column if not exists removido boolean not null default false;

-- 2) A "ordem" das linhas novas vem de uma sequência do banco (nada de ler o maior valor e somar 1 no código).
do $$
declare
  t text;
  seq text;
  maior bigint;
begin
  foreach t in array array['jogadores', 'rodadas', 'checkins', 'usuarios', 'fin_dias', 'fin_pagamentos', 'fin_creditos', 'fin_lancamentos'] loop
    seq := 'seq_ordem_' || t;
    execute format('create sequence if not exists %I', seq);
    execute format('select coalesce(max(ordem), 0) from %I', t) into maior;
    -- se a tabela está vazia, o próximo valor é 1; senão, é o maior + 1
    perform setval(seq, greatest(maior, 1), maior > 0);
    execute format('alter table %I alter column ordem set default nextval(%L)', t, seq);
  end loop;
end $$;

-- 3) Um jogador só pode estar vinculado (ou ter pedido de vínculo pendente) a UMA conta.
create unique index if not exists usuarios_jogador_id_unico on usuarios (jogador_id) where jogador_id is not null;
create unique index if not exists usuarios_jogador_id_pendente_unico on usuarios (jogador_id_pendente) where jogador_id_pendente is not null;

-- 4) Salvar uma rodada inteira numa única transação (criar ou substituir).
--    p = { id, data, rascunho, convidados: [{ id, nome }], times: [{ nome, vitorias, vencedor, playerIds: [...] }] }
create or replace function gravar_rodada(p jsonb) returns void
language plpgsql as $$
declare
  v_round_id text := p->>'id';
  v_time jsonb;
  v_idx int;
  v_time_id bigint;
begin
  -- convidados novos entram em jogadores (sem ordem), como na migração
  insert into jogadores (id, nome, convidado, ordem)
  select c->>'id', c->>'nome', true, null
  from jsonb_array_elements(coalesce(p->'convidados', '[]'::jsonb)) as c
  on conflict (id) do nothing;

  -- a versão antiga da rodada (se existir) some por inteiro
  delete from time_jogadores where time_rodada_id in (select id from times_rodada where round_id = v_round_id);
  delete from times_rodada where round_id = v_round_id;
  delete from rodadas where round_id = v_round_id;

  insert into rodadas (round_id, data, rascunho)
  values (v_round_id, (p->>'data')::date, coalesce((p->>'rascunho')::boolean, false));

  for v_time, v_idx in
    select t.value, (t.ordinality - 1)::int from jsonb_array_elements(p->'times') with ordinality as t
  loop
    insert into times_rodada (round_id, time_index, time_nome, vitorias, vencedor)
    values (
      v_round_id, v_idx, v_time->>'nome',
      coalesce((v_time->>'vitorias')::int, 0),
      coalesce((v_time->>'vencedor')::boolean, false)
    )
    returning id into v_time_id;

    insert into time_jogadores (time_rodada_id, jogador_id, posicao)
    select v_time_id, j.value, (j.ordinality - 1)::int
    from jsonb_array_elements_text(coalesce(v_time->'playerIds', '[]'::jsonb)) with ordinality as j
    on conflict do nothing; -- id repetido na mesma lista: vale o primeiro
  end loop;
end;
$$;

-- 5) Remover uma rodada inteira; devolve verdadeiro se ela existia.
create or replace function remover_rodada(p_id text) returns boolean
language plpgsql as $$
begin
  delete from time_jogadores where time_rodada_id in (select id from times_rodada where round_id = p_id);
  delete from times_rodada where round_id = p_id;
  delete from rodadas where round_id = p_id;
  return found;
end;
$$;

-- ==== schema-terca-supabase-ajuste-4.sql (fonte: sql/schema-terca-supabase-ajuste-4.sql) ====
-- Ajuste 4 (etapa 4a, financeiro parte 1): trava contra pagamento duplicado.
-- Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (o código não roda SQL de estrutura).
--
-- O .gs segurava um LockService em toda gravação, então dois toques seguidos em "pagou" nunca geravam duas linhas.
-- Aqui não há lock: este índice é a trava. Vale UM pagamento válido (não estornado) por jogador e por dia; o estornado
-- sai do índice, então marcar de novo depois de estornar continua funcionando. O backend trata a violação como "já pago"
-- (mesmo resultado do .gs quando o jogador já estava pago).
--
-- Efeito colateral aceito: se o mesmo jogador tiver DOIS check-ins no mesmo dia (o app não impede no .gs), o "Confirmar
-- todos" do .gs cobrava duas vezes dele; com o índice cobra uma vez.
--
-- Antes de criar, confere se já existe duplicado nos dados migrados (o .gs nunca deveria ter gerado, mas o índice falharia
-- se houvesse). Se aparecer o erro abaixo, rode a consulta que ele mostra, estorne o excedente (não remova a linha: perde o histórico) e rode este arquivo de novo.
do $$
declare
  duplicados int;
begin
  select count(*) into duplicados from (
    select 1 from fin_pagamentos
    where not estornado and jogador_id is not null
    group by data, jogador_id having count(*) > 1
  ) d;
  if duplicados > 0 then
    raise exception 'Há % par(es) data+jogador com mais de um pagamento válido em fin_pagamentos. Consulte: select data, jogador_id, count(*) from fin_pagamentos where not estornado and jogador_id is not null group by 1, 2 having count(*) > 1;', duplicados;
  end if;
end $$;

-- linhas sem jogador (check-in antigo sem cadastro) ficam de fora: jogador_id nulo nunca conflita
create unique index if not exists fin_pagamentos_valido_uniq
  on fin_pagamentos (data, jogador_id)
  where not estornado;

-- ==== schema-terca-supabase-ajuste-5.sql (fonte: sql/schema-terca-supabase-ajuste-5.sql) ====
-- Ajuste 5 (etapa 4b, financeiro parte 2): trava de gravação (o LockService do Apps Script).
-- Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (o código não roda SQL de estrutura).
--
-- O .gs segurava LockService.getScriptLock() (espera de até 15 s) em toda gravação. O backend novo é HTTP sem estado
-- (Node agora, Edge Function depois), então a trava vive no Postgres como um "aluguel" (lease): uma linha por nome de
-- trava, com dono e hora de expiração. Se o processo morrer segurando a trava, ela expira sozinha (o backend pede 30 s).
-- Sem este arquivo, addCheckin, removeCheckin e as ações do financeiro respondem com erro citando pegar_trava
-- (de propósito: nunca gravam "sem trava" em silêncio).

create table if not exists travas (
  nome text primary key,
  dono text not null,
  expira_em timestamptz not null
);

-- como as outras tabelas: RLS ligado e nenhuma política (só a service_role, que ignora o RLS, chega aqui)
alter table travas enable row level security;

-- Pega a trava: UM comando só (atômico). Insere se ninguém tem; se já existe, só toma se o aluguel expirou ou se o
-- dono é o mesmo (renovar). Devolve verdadeiro se conseguiu; falso se outro dono ainda a segura.
create or replace function pegar_trava(p_nome text, p_dono text, p_ttl_seg int) returns boolean
language plpgsql set search_path = meme as $$
declare
  v_ok boolean;
begin
  insert into travas as t (nome, dono, expira_em)
  values (p_nome, p_dono, now() + make_interval(secs => p_ttl_seg))
  on conflict (nome) do update
    set dono = excluded.dono, expira_em = excluded.expira_em
    where t.expira_em < now() or t.dono = excluded.dono
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Solta a trava, mas só se o dono for quem pede (quem perdeu o aluguel por expirar não derruba a de outro).
create or replace function soltar_trava(p_nome text, p_dono text) returns void
language plpgsql set search_path = meme as $$
begin
  delete from travas where nome = p_nome and dono = p_dono;
end;
$$;

-- só o servidor (service_role) chama; o navegador nunca fala com o banco direto
revoke execute on function pegar_trava(text, text, int) from public, anon, authenticated;
revoke execute on function soltar_trava(text, text) from public, anon, authenticated;
grant execute on function pegar_trava(text, text, int) to service_role;
grant execute on function soltar_trava(text, text) to service_role;

-- ==== schema-terca-supabase-ajuste-6.sql (fonte: sql/schema-terca-supabase-ajuste-6.sql) ====
-- Ajuste 6 (etapa 5): Ao Vivo e contador de acessos.
-- Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (o código não roda SQL de estrutura).
--
-- Sem este arquivo: iniciarTransmissaoAoVivo falha (faltam as colunas data e jogadores) e incrementarAcesso responde com
-- erro citando incrementar_acesso (o app tolera: só não conta o acesso). A leitura do Ao Vivo continua funcionando.

-- 1) A aba AoVivo do Apps Script guarda também a data da rodada e a lista de jogadores de cada time; a tabela não tinha.
alter table ao_vivo add column if not exists data date;
alter table ao_vivo add column if not exists jogadores text; -- ids separados por vírgula, como na planilha

-- 2) A planilha guardava qualquer número nestes campos (o .gs faz Number(x)); inteiro no banco rejeitaria, por exemplo, 2.5.
--    numeric aceita tudo o que o .gs aceitava (e os inteiros de hoje continuam saindo iguais).
alter table ao_vivo alter column vitorias type numeric;
alter table ao_vivo alter column duracao_minutos type numeric;
alter table ao_vivo_log alter column delta type numeric;

-- 3) Consultas por rodada (todas as ações do Ao Vivo filtram por round_id).
create index if not exists ao_vivo_round_id_idx on ao_vivo (round_id);
create index if not exists ao_vivo_log_round_id_idx on ao_vivo_log (round_id);

-- 4) Editar uma rodada durante a transmissão. gravar_rodada apaga e regrava a rodada; com a chave estrangeira
--    ao_vivo.round_id -> rodadas isso falharia enquanto existe transmissão dela. A chave continua valendo, mas passa a ser
--    conferida só no FIM da transação (deferrable initially deferred): como a rodada volta a existir antes do fim, editar
--    a rodada (inclusive "Lançar placar", que edita e depois cancela a transmissão) funciona igual ao .gs, e o espelho
--    do Ao Vivo fica intacto até o app cancelar.
do $$
declare
  v_nome text;
begin
  select c.conname into v_nome
  from pg_constraint c
  where c.conrelid = 'meme.ao_vivo'::regclass and c.contype = 'f'
    and c.confrelid = 'meme.rodadas'::regclass;
  if v_nome is not null then
    execute format('alter table ao_vivo alter constraint %I deferrable initially deferred', v_nome);
    raise notice 'FK % de ao_vivo agora é deferrable initially deferred', v_nome;
  else
    raise notice 'ATENÇÃO: nenhuma chave estrangeira de ao_vivo para rodadas foi encontrada; nada foi alterado (editar rodada ao vivo continua seguro, mas confira o schema)';
  end if;
end $$;

-- 5) Remover uma rodada que está ao vivo: a transmissão de uma rodada que não existe mais não tem sentido (no .gs sobrava
--    uma linha órfã na aba AoVivo); o Ao Vivo dela sai junto, na mesma transação. Devolve verdadeiro se a rodada existia.
create or replace function remover_rodada(p_id text) returns boolean
language plpgsql as $$
begin
  delete from ao_vivo_log where round_id = p_id;
  delete from ao_vivo where round_id = p_id;
  delete from time_jogadores where time_rodada_id in (select id from times_rodada where round_id = p_id);
  delete from times_rodada where round_id = p_id;
  delete from rodadas where round_id = p_id;
  return found; -- "found" vem do último comando: o delete da própria rodada
end;
$$;

-- 6) Contador de acessos: UM comando só (atômico, sem ler-somar-regravar). Mesma regra do .gs (Number(valor) || 0):
--    linha ausente, vazia ou que não é número conta como 0. Devolve o novo valor. numeric (e não integer) só para
--    espelhar o .gs também num valor fracionário guardado à mão; no uso normal é sempre inteiro.
create or replace function incrementar_acesso() returns numeric
language plpgsql security invoker set search_path = meme as $$
declare
  v_novo text;
begin
  insert into config (chave, valor) values ('contadorAcessos', '1')
  on conflict (chave) do update set valor = (
    case when btrim(config.valor) ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
         then btrim(config.valor)::numeric else 0 end + 1
  )::text
  returning valor into v_novo;
  return v_novo::numeric;
end;
$$;

-- as funções de rodada também são só do servidor (o navegador nunca fala com o banco direto)
revoke execute on function gravar_rodada(jsonb), remover_rodada(text) from public, anon, authenticated;
grant execute on function gravar_rodada(jsonb), remover_rodada(text) to service_role;

-- só o servidor (service_role) chama; o navegador nunca fala com o banco direto
revoke execute on function incrementar_acesso() from public, anon, authenticated;
grant execute on function incrementar_acesso() to service_role;

-- ==== schema-terca-supabase-ajuste-7.sql (fonte: sql/schema-terca-supabase-ajuste-7.sql) ====
-- Ajuste 7 (etapa 6a, Edge Function): limite de tentativas da chave mestra (ADMIN_PASSWORD).
-- Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (o código não roda SQL de estrutura).
--
-- Quando o backend vira Edge Function, a chave mestra fica exposta na internet. Este arquivo cria o contador por "chave"
-- (o backend usa 'senha:' + rede do cliente, e 'senha:global' como teto geral). O desenho é uma RESERVA: cada tentativa
-- é contada ANTES de a senha ser comparada, num único comando atômico. Assim, mil requisições em paralelo custam mil
-- tentativas; não dá para "chutar de graça" enquanto o contador ainda não subiu.
-- Sem este arquivo, qualquer tentativa com a chave mestra na Edge Function responde com erro (falha fechada, nunca libera
-- a senha sem limite). O login do Google não passa por aqui.

create table if not exists limite_tentativas (
  chave text primary key,
  tentativas int not null default 0,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz not null default now()
);

-- como as outras tabelas: RLS ligado e nenhuma política (só a service_role, que ignora o RLS, chega aqui)
alter table limite_tentativas enable row level security;

-- Se uma versão antiga deste arquivo (rascunho) chegou a ser rodada: tira o que não é mais usado.
drop function if exists tentativa_bloqueada(text);
drop function if exists registrar_falha(text, int, int);

-- Reserva UMA tentativa para a chave. Devolve verdadeiro se ela PODE prosseguir (o backend então compara a senha) e
-- falso se está bloqueada (a senha nem é comparada). Um comando só (atômico, sem ler-e-gravar):
--   * bloqueada agora                      -> nega e não mexe em nada;
--   * última tentativa fora da janela, ou bloqueio já vencido -> recomeça a contagem em 1;
--   * senão soma 1; ao passar de p_max, bloqueia por p_bloqueio_seg (e essa tentativa que estourou também é negada).
-- Ou seja: no máximo p_max senhas são comparadas por janela. Também apaga linhas paradas há mais de 1 dia.
create or replace function registrar_tentativa(p_chave text, p_max int, p_janela_seg int, p_bloqueio_seg int) returns boolean
language plpgsql set search_path = meme as $$
declare
  v_permitido boolean;
begin
  delete from limite_tentativas
   where atualizado_em < now() - interval '1 day'
     and (bloqueado_ate is null or bloqueado_ate < now())
     and chave <> p_chave;

  insert into limite_tentativas as l (chave, tentativas, bloqueado_ate, atualizado_em)
  values (p_chave, 1, null, now())
  on conflict (chave) do update set
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

-- Senha certa: zera o contador dessa chave.
create or replace function limpar_falhas(p_chave text) returns void
language plpgsql set search_path = meme as $$
begin
  delete from limite_tentativas where chave = p_chave;
end;
$$;

-- só o servidor (service_role) chama; o navegador nunca fala com o banco direto
revoke execute on function registrar_tentativa(text, int, int, int) from public, anon, authenticated;
revoke execute on function limpar_falhas(text) from public, anon, authenticated;
grant execute on function registrar_tentativa(text, int, int, int) to service_role;
grant execute on function limpar_falhas(text) to service_role;

-- ==== schema-terca-supabase-ajuste-8.sql (fonte: sql/schema-terca-supabase-ajuste-8.sql) ====
-- Ajuste 8: sessões do app (login que não cai). Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase, ANTES de publicar a função nova.
-- Guarda só o hash SHA-256 do token (quem lê o banco não consegue usar a sessão de ninguém).
create table if not exists sessoes (
  token_hash  text primary key,
  email       text not null,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  renovada_em timestamptz not null default now()
);
create index if not exists sessoes_email_idx on sessoes (email);
-- como as outras tabelas: RLS ligado e nenhuma política (só a service_role, que ignora o RLS, chega aqui)
alter table sessoes enable row level security;

-- ==== schema-terca-supabase-ajuste-9.sql (fonte: sql/schema-terca-supabase-ajuste-9.sql) ====
-- Ajuste 9 (dois jogos no mesmo dia): colunas de "jogo" em checkins/fin_pagamentos/fin_creditos, a tabela fin_jogos
-- (configuração do 2º jogo quando o financeiro é separado) e duas funções de movimentação de fila.
-- Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (o código não roda SQL de estrutura).
-- Spec: docs/superpowers/specs/2026-10-03-dois-jogos-no-mesmo-dia-design.md

-- 1) check-in: de qual jogo (fila) do dia. Sempre um valor: confirmar presença é sempre numa fila específica.
alter table checkins add column if not exists jogo smallint not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'checkins_jogo_valido') then
    alter table checkins add constraint checkins_jogo_valido check (jogo in (1, 2));
  end if;
end $$;

-- 2) pagamento: NULL = vale para o DIA inteiro (modo único); 1 ou 2 = só aquele jogo (modo separado).
-- Linhas que já existem não precisam de backfill: um pagamento antigo, de quando só havia 1 jogo, sempre valeu
-- "pro dia" (não havia distinção), então NULL já é o valor certo pra elas.
alter table fin_pagamentos add column if not exists jogo smallint null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_pagamentos_jogo_valido') then
    alter table fin_pagamentos add constraint fin_pagamentos_jogo_valido check (jogo in (1, 2));
  end if;
end $$;
-- "um pagamento válido por jogador, por chave de cobrança" — coalesce(jogo, 0) trata NULL como uma chave só
-- (um UNIQUE INDEX comum NÃO barraria duas linhas com jogo IS NULL, porque o Postgres trata NULL <> NULL)
drop index if exists fin_pagamentos_valido_uniq;
create unique index fin_pagamentos_valido_uniq on fin_pagamentos (data, coalesce(jogo, 0), jogador_id) where not estornado;

-- 3) o dia: financeiro separado por jogo? (false = único, o padrão)
alter table fin_dias add column if not exists por_jogo boolean not null default false;

-- 4) configuração própria do 2º jogo (só existe no modo separado; o 1º jogo continua em fin_dias)
create table if not exists fin_jogos (
  data date not null references fin_dias(data),
  jogo smallint not null,
  valor_pessoa numeric(10,2), pix text, valor_quadra numeric(10,2), tem_brinde boolean, valor_brinde numeric(10,2),
  icone text, status text not null default 'normal',
  atualizado_por text, atualizado_em timestamptz,
  primary key (data, jogo)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_jogos_jogo_valido') then
    alter table fin_jogos add constraint fin_jogos_jogo_valido check (jogo = 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_jogos_status_valido') then
    alter table fin_jogos add constraint fin_jogos_status_valido check (status in ('normal', 'semjogo'));
  end if;
end $$;
alter table fin_jogos enable row level security; -- sem políticas: só a service_role (a função) acessa

-- 5) crédito: de onde veio (mesma regra do pagamento de origem: NULL = do dia, 1/2 = de um jogo no modo separado)
alter table fin_creditos add column if not exists jogo_origem smallint null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_creditos_jogo_origem_valido') then
    alter table fin_creditos add constraint fin_creditos_jogo_origem_valido check (jogo_origem in (1, 2));
  end if;
end $$;

-- 6) Mover um check-in para o fim da fila do OUTRO jogo (botão ⇄). Se a pessoa já estiver no destino (duas linhas
-- pro mesmo jogador/dia/jogo não deveriam existir, mas por segurança), não faz nada e devolve false.
create or replace function mover_checkin_de_jogo(p_id text, p_para_jogo smallint) returns boolean
language plpgsql set search_path = meme as $$
declare
  v_jogador_id text;
  v_data date;
  v_proxima_ordem bigint;
begin
  select jogador_id, data into v_jogador_id, v_data from checkins where id = p_id;
  if not found then
    return false;
  end if;
  if v_jogador_id is not null and exists (
    select 1 from checkins where data = v_data and jogo = p_para_jogo and jogador_id = v_jogador_id
  ) then
    return false; -- já está no destino: nada para mover
  end if;
  select coalesce(max(ordem), 0) + 1 into v_proxima_ordem from checkins where data = v_data and jogo = p_para_jogo;
  update checkins set jogo = p_para_jogo, ordem = v_proxima_ordem where id = p_id;
  return true;
end;
$$;

-- 7) Remover o 2º jogo movendo quem está nele para o 1º, no fim da fila, sem duplicar quem já está lá.
-- Devolve quantas linhas foram realmente movidas (não conta quem já estava no jogo 1 e foi descartado).
create or replace function mover_jogo2_para_jogo1(p_data date) returns int
language plpgsql set search_path = meme as $$
declare
  v_movidos int := 0;
  v_proxima_ordem bigint;
  v_linha record;
begin
  delete from checkins c2
  where c2.data = p_data and c2.jogo = 2 and c2.jogador_id is not null
    and exists (select 1 from checkins c1 where c1.data = p_data and c1.jogo = 1 and c1.jogador_id = c2.jogador_id);

  select coalesce(max(ordem), 0) into v_proxima_ordem from checkins where data = p_data and jogo = 1;
  for v_linha in select id from checkins where data = p_data and jogo = 2 order by ordem loop
    v_proxima_ordem := v_proxima_ordem + 1;
    update checkins set jogo = 1, ordem = v_proxima_ordem where id = v_linha.id;
    v_movidos := v_movidos + 1;
  end loop;
  return v_movidos;
end;
$$;

-- 8) Generaliza o mesmo algoritmo da função 7 pra qualquer par (de, para) de jogos — usada pra "trocar os papéis"
-- (remover o jogo 1 mantendo o 2): o servidor chama duas vezes, (data,1,2) e depois (data,2,1), e o resultado é a
-- fila do jogo mantido primeiro, a do jogo removido no fim, tudo relabelado pra jogo 1.
create or replace function mover_fila_para_jogo(p_data date, p_de smallint, p_para smallint) returns int
language plpgsql set search_path = meme as $$
declare
  v_movidos int := 0;
  v_proxima_ordem bigint;
  v_linha record;
begin
  delete from checkins cd
  where cd.data = p_data and cd.jogo = p_de and cd.jogador_id is not null
    and exists (select 1 from checkins cp where cp.data = p_data and cp.jogo = p_para and cp.jogador_id = cd.jogador_id);

  select coalesce(max(ordem), 0) into v_proxima_ordem from checkins where data = p_data and jogo = p_para;
  for v_linha in select id from checkins where data = p_data and jogo = p_de order by ordem loop
    v_proxima_ordem := v_proxima_ordem + 1;
    update checkins set jogo = p_para, ordem = v_proxima_ordem where id = v_linha.id;
    v_movidos := v_movidos + 1;
  end loop;
  return v_movidos;
end;
$$;

-- só o servidor (service_role) chama; o navegador nunca fala com o banco direto
revoke execute on function mover_checkin_de_jogo(text, smallint) from public, anon, authenticated;
revoke execute on function mover_jogo2_para_jogo1(date) from public, anon, authenticated;
revoke execute on function mover_fila_para_jogo(date, smallint, smallint) from public, anon, authenticated;
grant execute on function mover_checkin_de_jogo(text, smallint) to service_role;
grant execute on function mover_jogo2_para_jogo1(date) to service_role;
grant execute on function mover_fila_para_jogo(date, smallint, smallint) to service_role;

-- ==== schema-terca-supabase-ajuste-10.sql (fonte: sql/schema-terca-supabase-ajuste-10.sql) ====
-- Ajuste 10: pendências (dívida avulsa de um jogador, cobrada "no olho" no próximo check-in).
-- QUEM RODA: o usuário, no SQL Editor do Supabase. Pode ser executado mais de uma vez sem estragar nada.
--
-- Pendência NÃO mexe no caixa: é só um aviso que aparece no check-in (ver finPendenciasDe no front)
-- até um organizador/admin marcar como paga. Mesma forma de fin_lancamentos (nada é apagado; "baixar"
-- marca a linha, não remove).
create table if not exists fin_pendencias (
  id text primary key,
  jogador_id text references jogadores(id),
  jogador_nome text,
  valor numeric(10,2),
  observacao text,
  data date,
  criado_por text,
  criado_em timestamptz,
  status text not null default 'pendente' check (status in ('pendente','paga')),
  baixado_por text,
  baixado_em timestamptz,
  -- mesma ideia das outras tabelas do financeiro (ajuste 3): ordem de inserção dada pelo banco, nunca pelo código
  ordem bigint generated by default as identity
);

-- ==== schema-terca-supabase-ajuste-11.sql (fonte: sql/schema-terca-supabase-ajuste-11.sql) ====
-- Ajuste 11: notificações push (quem instalou o app como PWA e aceitou a permissão do navegador).
-- QUEM RODA: o usuário, no SQL Editor do Supabase. Pode ser executado mais de uma vez sem estragar nada.
--
-- Não depende de login: qualquer aparelho que aceitar a notificação grava sua inscrição aqui (endpoint único
-- por aparelho/navegador, dado pelo próprio navegador). Enviar notificação (ação "enviarNotificacao") é
-- organizador/admin; inscrever é livre, igual ao check-in sem login.
create table if not exists push_inscricoes (
  id text primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz
);

-- ==== acesso e search_path (gerado) ====
-- funções que não fixavam search_path passam a apontar para este schema, sem depender da requisição:
alter function gravar_rodada(jsonb) set search_path = meme;
alter function remover_rodada(text) set search_path = meme;
-- só service_role acessa o schema (o app nunca fala com o banco direto):
grant usage on schema meme to service_role;
grant all on all tables in schema meme to service_role;
grant all on all sequences in schema meme to service_role;
grant execute on all functions in schema meme to service_role;
revoke all on all tables in schema meme from anon, authenticated;
revoke all on all sequences in schema meme from anon, authenticated;
revoke execute on all functions in schema meme from public, anon, authenticated;
revoke all on schema meme from public, anon, authenticated;
alter default privileges in schema meme grant all on tables to service_role;
alter default privileges in schema meme grant all on sequences to service_role;
alter default privileges in schema meme grant execute on functions to service_role;
