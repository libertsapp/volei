-- Ajuste 4 dos grupos independentes: faltas (v18.8), igual ao ajuste 16 do Terça. Instalação nova já nasce com a
-- coluna (schema-grupos.sql); este arquivo é para o schema "grupos" que já está no ar. Pode rodar mais de uma vez.
alter table grupos.checkins add column if not exists faltou boolean not null default false;
