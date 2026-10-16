-- Ajuste 15: inscrição de push ligada à conta (v18.7). Com o e-mail da conta logada no aparelho, o backend manda o
-- aviso PESSOAL "Você entrou na lista!" para quem saiu da reserva. QUEM RODA: o usuário (ou o assistente via
-- "npx supabase db query --linked -f"), schema public, o do Terça. Pode ser executado mais de uma vez.
--
-- Inscrições antigas ficam com NULL (aparelho sem conta) até o app reenviar a inscrição com login — o app faz isso
-- sozinho ao abrir. Se a função nova for publicada antes deste SQL, nada quebra: a inscrição é gravada sem o e-mail
-- (repo-supabase.js tenta de novo sem a coluna) e só o aviso pessoal fica sem chegar.
alter table push_inscricoes add column if not exists email text null;
