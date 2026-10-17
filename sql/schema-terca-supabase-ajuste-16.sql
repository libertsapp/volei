-- Ajuste 16: faltas (v18.8). O organizador marca quem CONFIRMOU presença e não apareceu; a falta fica no próprio
-- check-in. Quem acumula faltas ganha o emblema público 🏃. QUEM RODA: o usuário (ou o assistente via
-- "npx supabase db query --linked -f"), schema public, o do Terça. Pode ser executado mais de uma vez.
--
-- Se a função nova for publicada antes deste SQL, nada quebra: só o botão "Salvar faltas" dá erro.
alter table checkins add column if not exists faltou boolean not null default false;
