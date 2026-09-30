-- Ajuste 8 do Meme: sessões do app (login que não cai), no schema "meme" que JÁ EXISTE. Pode ser executado mais de uma vez.
-- QUEM RODA: o usuário, no SQL Editor do Supabase (projeto do Terça e do Meme), antes de publicar a meme-api nova.
-- Mesmo conteúdo de sql/schema-terca-supabase-ajuste-8.sql, com o schema escrito por extenso. (Uma instalação NOVA do Meme
-- não precisa disto: sql/meme/schema-meme-supabase.sql, gerado por "npm run gerar-sql-meme", já cria a tabela.)
-- Guarda só o hash SHA-256 do token (quem lê o banco não consegue usar a sessão de ninguém).
create table if not exists meme.sessoes (
  token_hash  text primary key,
  email       text not null,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  renovada_em timestamptz not null default now()
);
create index if not exists sessoes_email_idx on meme.sessoes (email);
-- como o resto do schema meme: RLS ligado, nenhuma política, e só a service_role (a função) acessa
alter table meme.sessoes enable row level security;
grant all on table meme.sessoes to service_role;
revoke all on table meme.sessoes from anon, authenticated;
-- a API do Supabase passa a enxergar a tabela nova na hora
notify pgrst, 'reload schema';
