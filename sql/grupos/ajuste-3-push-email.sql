-- Ajuste 3 dos grupos independentes: inscrição de push ligada à conta (v18.7), igual ao ajuste 15 do Terça. Instalação
-- nova já nasce com a coluna (schema-grupos.sql); este arquivo é para o schema "grupos" que já está no ar. Pode rodar
-- mais de uma vez.
alter table grupos.push_inscricoes add column if not exists email text null;
