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
language plpgsql set search_path = public as $$
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
language plpgsql set search_path = public as $$
begin
  delete from travas where nome = p_nome and dono = p_dono;
end;
$$;

-- só o servidor (service_role) chama; o navegador nunca fala com o banco direto
revoke execute on function pegar_trava(text, text, int) from public, anon, authenticated;
revoke execute on function soltar_trava(text, text) from public, anon, authenticated;
grant execute on function pegar_trava(text, text, int) to service_role;
grant execute on function soltar_trava(text, text) to service_role;
