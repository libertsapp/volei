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
  where c.conrelid = 'public.ao_vivo'::regclass and c.contype = 'f'
    and c.confrelid = 'public.rodadas'::regclass;
  if v_nome is not null then
    execute format('alter table ao_vivo alter constraint %I deferrable initially deferred', v_nome);
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
language plpgsql security invoker set search_path = public as $$
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

-- só o servidor (service_role) chama; o navegador nunca fala com o banco direto
revoke execute on function incrementar_acesso() from public, anon, authenticated;
grant execute on function incrementar_acesso() to service_role;
