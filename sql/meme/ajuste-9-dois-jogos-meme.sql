-- GERADO a partir de sql/schema-terca-supabase-ajuste-9.sql (schema meme). NÃO edite à mão: se o ajuste 9 do
-- Terça mudar, regenere (ver scripts/gerar-sql-grupo.js) e cole este trecho nas instalações do Meme já existentes.
-- QUEM RODA: o usuário, no SQL Editor do Supabase, no projeto que já tem o schema "meme".
set search_path = meme;

alter table checkins add column if not exists jogo smallint not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'checkins_jogo_valido') then
    alter table checkins add constraint checkins_jogo_valido check (jogo in (1, 2));
  end if;
end $$;

alter table fin_pagamentos add column if not exists jogo smallint null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_pagamentos_jogo_valido') then
    alter table fin_pagamentos add constraint fin_pagamentos_jogo_valido check (jogo in (1, 2));
  end if;
end $$;
drop index if exists fin_pagamentos_valido_uniq;
create unique index fin_pagamentos_valido_uniq on fin_pagamentos (data, coalesce(jogo, 0), jogador_id) where not estornado;

alter table fin_dias add column if not exists por_jogo boolean not null default false;

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
alter table fin_jogos enable row level security;

alter table fin_creditos add column if not exists jogo_origem smallint null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_creditos_jogo_origem_valido') then
    alter table fin_creditos add constraint fin_creditos_jogo_origem_valido check (jogo_origem in (1, 2));
  end if;
end $$;

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
    return false;
  end if;
  select coalesce(max(ordem), 0) + 1 into v_proxima_ordem from checkins where data = v_data and jogo = p_para_jogo;
  update checkins set jogo = p_para_jogo, ordem = v_proxima_ordem where id = p_id;
  return true;
end;
$$;

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

alter function mover_checkin_de_jogo(text, smallint) set search_path = meme;
alter function mover_jogo2_para_jogo1(date) set search_path = meme;
alter function mover_fila_para_jogo(date, smallint, smallint) set search_path = meme;
grant execute on function mover_checkin_de_jogo(text, smallint) to service_role;
grant execute on function mover_jogo2_para_jogo1(date) to service_role;
grant execute on function mover_fila_para_jogo(date, smallint, smallint) to service_role;
revoke execute on function mover_checkin_de_jogo(text, smallint) from public, anon, authenticated;
revoke execute on function mover_jogo2_para_jogo1(date) from public, anon, authenticated;
revoke execute on function mover_fila_para_jogo(date, smallint, smallint) from public, anon, authenticated;
