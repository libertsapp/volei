-- Ajuste 1 dos grupos independentes: termos de uso (v18.2), igual ao ajuste 13 do Terça. Guarda em cada conta (por
-- grupo) QUAL versão do termo a pessoa aceitou e QUANDO. Instalação nova já nasce com as colunas (schema-grupos.sql);
-- este arquivo é para o schema "grupos" que já está no ar. Pode rodar mais de uma vez.
-- Rode ANTES de publicar a função grupos-api com o backend v18.2.
alter table grupos.usuarios add column if not exists termos_versao text null;
alter table grupos.usuarios add column if not exists termos_aceitos_em timestamptz null;
