-- Ajuste 2: vencedor é por time; e a ordem das linhas da planilha passa a ser guardada.
alter table times_rodada add column if not exists vencedor boolean not null default false;
alter table rodadas drop column if exists vencedor;
alter table time_jogadores add column if not exists posicao int;
alter table jogadores add column if not exists ordem int;
alter table rodadas add column if not exists ordem int;
alter table checkins add column if not exists ordem int;
alter table usuarios add column if not exists ordem int;
alter table fin_dias add column if not exists ordem int;
alter table fin_pagamentos add column if not exists ordem int;
alter table fin_creditos add column if not exists ordem int;
alter table fin_lancamentos add column if not exists ordem int;
