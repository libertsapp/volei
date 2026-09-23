-- Ajuste 1 (depois da 1ª migração real): convidados viram linhas em jogadores.
alter table jogadores add column if not exists convidado boolean not null default false;
