-- Ajuste 7 (etapa 6a, Edge Function): limite de tentativas da chave mestra (ADMIN_PASSWORD).
-- Pode ser executado mais de uma vez sem estragar nada.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (o código não roda SQL de estrutura).
--
-- Quando o backend vira Edge Function, a chave mestra fica exposta na internet. Este arquivo cria o contador de erros por
-- "chave" (o adaptador usa 'senha:' + IP do cliente): depois de p_max erros dentro da janela, a chave fica bloqueada por
-- p_bloqueio_seg segundos. A janela é o próprio p_bloqueio_seg: erros mais velhos que isso não contam.
-- Sem este arquivo, qualquer tentativa com a chave mestra na Edge Function responde com erro citando tentativa_bloqueada
-- (de propósito: falha fechada, nunca libera a senha sem limite). O login do Google não passa por aqui.

create table if not exists limite_tentativas (
  chave text primary key,
  falhas int not null default 0,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz not null default now()
);

-- como as outras tabelas: RLS ligado e nenhuma política (só a service_role, que ignora o RLS, chega aqui)
alter table limite_tentativas enable row level security;

-- Está bloqueada agora? (só lê; a comparação da senha nem acontece quando dá verdadeiro)
create or replace function tentativa_bloqueada(p_chave text) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select bloqueado_ate > now() from limite_tentativas where chave = p_chave), false);
$$;

-- Registra um erro: UM comando só (atômico, sem ler-e-gravar). Recomeça a contagem em 1 se o último erro saiu da janela
-- ou se o bloqueio anterior já acabou; ao chegar em p_max, bloqueia por p_bloqueio_seg. Também apaga linhas paradas há mais de 1 dia.
create or replace function registrar_falha(p_chave text, p_max int, p_bloqueio_seg int) returns void
language plpgsql set search_path = public as $$
begin
  delete from limite_tentativas where atualizado_em < now() - interval '1 day' and chave <> p_chave;

  insert into limite_tentativas as l (chave, falhas, bloqueado_ate, atualizado_em)
  values (
    p_chave, 1,
    case when p_max <= 1 then now() + make_interval(secs => p_bloqueio_seg) else null end,
    now()
  )
  on conflict (chave) do update set
    falhas = case
      when l.atualizado_em < now() - make_interval(secs => p_bloqueio_seg)
        or (l.bloqueado_ate is not null and l.bloqueado_ate < now()) then 1
      else l.falhas + 1 end,
    bloqueado_ate = case
      when l.atualizado_em < now() - make_interval(secs => p_bloqueio_seg)
        or (l.bloqueado_ate is not null and l.bloqueado_ate < now())
        then (case when p_max <= 1 then now() + make_interval(secs => p_bloqueio_seg) else null end)
      when l.falhas + 1 >= p_max then now() + make_interval(secs => p_bloqueio_seg)
      else l.bloqueado_ate end,
    atualizado_em = now();
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
revoke execute on function tentativa_bloqueada(text) from public, anon, authenticated;
revoke execute on function registrar_falha(text, int, int) from public, anon, authenticated;
revoke execute on function limpar_falhas(text) from public, anon, authenticated;
grant execute on function tentativa_bloqueada(text) to service_role;
grant execute on function registrar_falha(text, int, int) to service_role;
grant execute on function limpar_falhas(text) to service_role;
