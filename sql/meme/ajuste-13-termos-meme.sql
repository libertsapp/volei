-- GERADO a partir de sql/schema-terca-supabase-ajuste-13.sql (schema meme). NÃO edite à mão: se o ajuste 13 do
-- Terça mudar, refaça este arquivo e cole nas instalações do Meme já existentes.
-- QUEM RODA: o usuário (ou o assistente via CLI), no projeto que já tem o schema "meme". Pode rodar mais de uma vez.
set search_path = meme;

-- Contas antigas ficam com NULL: o app mostra o termo no próximo uso logado. A ordem de deploy não importa para o
-- banco, MAS a função nova lê/grava essas colunas: rode este SQL ANTES de publicar a função com o backend v18.2.
alter table usuarios add column if not exists termos_versao text null;
alter table usuarios add column if not exists termos_aceitos_em timestamptz null;
