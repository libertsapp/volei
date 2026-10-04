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
language plpgsql set search_path = public as $$
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
language plpgsql set search_path = public as $$
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
language plpgsql set search_path = public as $$
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
