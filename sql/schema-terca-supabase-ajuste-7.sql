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
language plpgsql set search_path = public as $$
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
language plpgsql set search_path = public as $$
begin
  delete from limite_tentativas where chave = p_chave;
end;
$$;

-- só o servidor (service_role) chama; o navegador nunca fala com o banco direto
revoke execute on function registrar_tentativa(text, int, int, int) from public, anon, authenticated;
revoke execute on function limpar_falhas(text) from public, anon, authenticated;
grant execute on function registrar_tentativa(text, int, int, int) to service_role;
grant execute on function limpar_falhas(text) to service_role;
