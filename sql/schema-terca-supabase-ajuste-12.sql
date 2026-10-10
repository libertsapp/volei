-- Ajuste 12: horário do jogo na rodada (aparece no Histórico ao lado da data).
-- QUEM RODA: o usuário, no SQL Editor do Supabase (schema public, o do Terça). Pode ser executado mais de uma vez.
--
-- O horário vem do check-in (campo preenchido na tela "Nova rodada") e é guardado como texto 'HH:MM'.
-- Rodadas antigas ficam com horario NULL (essa informação nunca foi guardada) e seguem aparecendo só com a data.
-- A ordem de deploy não importa: função antiga ignora o campo novo; backend antigo não manda o campo.
alter table rodadas add column if not exists horario text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rodadas_horario_valido') then
    alter table rodadas add constraint rodadas_horario_valido check (horario is null or horario ~ '^[0-2][0-9]:[0-5][0-9]$');
  end if;
end $$;

-- gravar_rodada igual à do ajuste 3, só acrescentando o horário. p = { id, data, horario, rascunho, convidados, times }
create or replace function gravar_rodada(p jsonb) returns void
language plpgsql as $$
declare
  v_round_id text := p->>'id';
  v_time jsonb;
  v_idx int;
  v_time_id bigint;
begin
  insert into jogadores (id, nome, convidado, ordem)
  select c->>'id', c->>'nome', true, null
  from jsonb_array_elements(coalesce(p->'convidados', '[]'::jsonb)) as c
  on conflict (id) do nothing;

  delete from time_jogadores where time_rodada_id in (select id from times_rodada where round_id = v_round_id);
  delete from times_rodada where round_id = v_round_id;
  delete from rodadas where round_id = v_round_id;

  insert into rodadas (round_id, data, rascunho, horario)
  values (v_round_id, (p->>'data')::date, coalesce((p->>'rascunho')::boolean, false), nullif(btrim(p->>'horario'), ''));

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
    on conflict do nothing;
  end loop;
end;
$$;

revoke execute on function gravar_rodada(jsonb) from public, anon, authenticated;
grant execute on function gravar_rodada(jsonb) to service_role;
