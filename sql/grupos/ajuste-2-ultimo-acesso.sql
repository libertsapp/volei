-- Ajuste 2 dos grupos independentes: último acesso de cada conta (v18.4), igual ao ajuste 14 do Terça. Instalação nova
-- já nasce com a coluna (schema-grupos.sql); este arquivo é para o schema "grupos" que já está no ar. Pode rodar mais
-- de uma vez.
alter table grupos.usuarios add column if not exists ultimo_acesso timestamptz null;
