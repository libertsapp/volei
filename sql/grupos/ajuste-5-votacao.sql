-- Ajuste 5 dos grupos independentes: votação do Craque e do Bola Murcha (v19.1), igual ao ajuste 17 do Terça, com
-- grupo_id em tudo (backend/cliente-do-grupo.js prende cada operação ao grupo). Instalação nova já nasce com as tabelas
-- (schema-grupos.sql). Pode rodar mais de uma vez.
create table if not exists grupos.votacoes (
  grupo_id uuid not null references grupos.grupos(id) on delete cascade,
  data     date not null,
  abre_em  timestamptz not null,
  fecha_em timestamptz not null,
  primary key (grupo_id, data)
);

create table if not exists grupos.votos (
  grupo_id           uuid not null references grupos.grupos(id) on delete cascade,
  data               date not null,
  categoria          text not null check (categoria in ('craque', 'murcha')),
  eleitor_jogador_id text not null,
  eleitor_email      text not null,
  votado_id          text not null,
  criado_em          timestamptz not null default now(),
  primary key (grupo_id, data, categoria, eleitor_jogador_id),
  foreign key (grupo_id, data) references grupos.votacoes(grupo_id, data) on delete cascade
);

alter table grupos.votacoes enable row level security;
alter table grupos.votos enable row level security;
