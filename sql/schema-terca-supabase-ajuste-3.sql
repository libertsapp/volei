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
