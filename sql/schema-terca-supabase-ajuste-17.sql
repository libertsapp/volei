-- Ajuste 17: votação do Craque e do Bola Murcha (v19.1). Uma votação por DIA de jogo: abre quando a rodada oficial
-- do dia é salva e fecha 24 horas depois. Vota só quem jogou naquele dia (conta vinculada a um jogador), um voto por
-- categoria. Os votos são secretos: o app só recebe o resultado depois que a votação fecha. QUEM RODA: o usuário (ou o
-- assistente via "npx supabase db query --linked -f"), schema public, o do Terça. Pode ser executado mais de uma vez.
--
-- Se a função nova for publicada antes deste SQL, nada quebra: o app só não mostra votação nenhuma.
create table if not exists votacoes (
  data     date primary key,
  abre_em  timestamptz not null,
  fecha_em timestamptz not null
);

create table if not exists votos (
  data               date not null references votacoes(data) on delete cascade,
  categoria          text not null check (categoria in ('craque', 'murcha')),
  eleitor_jogador_id text not null,  -- um voto por JOGADOR (não por conta) em cada categoria
  eleitor_email      text not null,
  votado_id          text not null,
  criado_em          timestamptz not null default now(),
  primary key (data, categoria, eleitor_jogador_id)
);

-- como as outras tabelas: RLS ligado e nenhuma política (só a service_role, que ignora o RLS, chega aqui)
alter table votacoes enable row level security;
alter table votos enable row level security;
