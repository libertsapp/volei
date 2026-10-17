-- Ajuste 16 do Meme: faltas (v18.8), igual ao ajuste 16 do Terça, no schema "meme". O organizador marca quem
-- CONFIRMOU e não apareceu; a falta fica no próprio check-in. Pode rodar mais de uma vez.
alter table meme.checkins add column if not exists faltou boolean not null default false;
