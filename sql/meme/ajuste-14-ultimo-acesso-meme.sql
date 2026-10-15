-- GERADO a partir de sql/schema-terca-supabase-ajuste-14.sql (schema meme). NÃO edite à mão: se o ajuste 14 do
-- Terça mudar, refaça este arquivo e cole nas instalações do Meme já existentes.
-- QUEM RODA: o usuário (ou o assistente via CLI), no projeto que já tem o schema "meme". Pode rodar mais de uma vez.
set search_path = meme;

-- Contas antigas ficam com NULL ("sem registro ainda") até o próximo acesso. Se a função nova for publicada antes deste
-- SQL, nada quebra (o registro falha em silêncio e vai para o log), mas a lista fica sem os acessos.
alter table usuarios add column if not exists ultimo_acesso timestamptz null;
