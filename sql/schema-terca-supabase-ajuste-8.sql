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
