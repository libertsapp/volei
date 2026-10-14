-- Ajuste 13: termos de uso (v18.2). Guarda na conta QUAL versão do termo a pessoa aceitou e QUANDO (registro do
-- consentimento exigido pela LGPD). QUEM RODA: o usuário (ou o assistente via "npx supabase db query --linked -f"),
-- schema public, o do Terça. Pode ser executado mais de uma vez.
--
-- Contas antigas ficam com NULL: o app mostra o termo no próximo uso logado. A ordem de deploy não importa para o
-- banco, MAS a função nova lê/grava essas colunas: rode este SQL ANTES de publicar a função com o backend v18.2.
alter table usuarios add column if not exists termos_versao text null;
alter table usuarios add column if not exists termos_aceitos_em timestamptz null;
