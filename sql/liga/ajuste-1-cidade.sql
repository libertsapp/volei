-- Amistosos: cidade e UF de cada grupo, para o convite mostrar primeiro os adversários da mesma cidade
-- (grupos independentes, spec 2026-10-12). Idempotente. QUEM RODA: o usuário, antes do sql/grupos/schema-grupos.sql.
alter table liga.grupos add column if not exists cidade text;
alter table liga.grupos add column if not exists uf char(2);
-- Terça e Meme são de Santa Luzia/MG (informado pelo usuário em 2026-10-12)
update liga.grupos set cidade = 'Santa Luzia', uf = 'MG' where id in ('terca', 'meme');
