-- Ajuste 17 do Meme: votação do Craque e do Bola Murcha (v19.1), igual ao ajuste 17 do Terça, no schema "meme".
-- Uma votação por dia de jogo, 24h, só quem jogou vota, votos secretos. Pode rodar mais de uma vez.
create table if not exists meme.votacoes (
  data     date primary key,
  abre_em  timestamptz not null,
  fecha_em timestamptz not null
);

create table if not exists meme.votos (
  data               date not null references meme.votacoes(data) on delete cascade,
  categoria          text not null check (categoria in ('craque', 'murcha')),
  eleitor_jogador_id text not null,
  eleitor_email      text not null,
  votado_id          text not null,
  criado_em          timestamptz not null default now(),
  primary key (data, categoria, eleitor_jogador_id)
);

alter table meme.votacoes enable row level security;
alter table meme.votos enable row level security;
