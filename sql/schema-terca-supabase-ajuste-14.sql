-- Ajuste 14: último acesso de cada conta (v18.4). O backend grava quando a pessoa logada abre ou volta ao app, no máximo
-- a cada 5 min; organizador e admin veem "Online agora / Últimos online" na tela Contas. QUEM RODA: o usuário (ou o
-- assistente via "npx supabase db query --linked -f"), schema public, o do Terça. Pode ser executado mais de uma vez.
--
-- Contas antigas ficam com NULL ("sem registro ainda") até o próximo acesso. Se a função nova for publicada antes deste
-- SQL, nada quebra (o registro falha em silêncio e vai para o log), mas a lista fica sem os acessos.
alter table usuarios add column if not exists ultimo_acesso timestamptz null;
