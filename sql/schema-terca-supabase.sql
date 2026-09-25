-- Núcleo
create table jogadores (
  id text primary key,
  nome text not null,
  apelido text,
  foto text,
  estrelas numeric(3,1),
  sexo text check (sexo in ('M','F')),
  porte text
);

create table rodadas (
  round_id text primary key,
  data date not null,
  vencedor text,
  rascunho boolean not null default false
);

create table times_rodada (
  id bigint generated always as identity primary key,
  round_id text not null references rodadas(round_id),
  time_index int not null,
  time_nome text,
  vitorias int not null default 0,
  unique (round_id, time_index)
);

create table time_jogadores (
  time_rodada_id bigint not null references times_rodada(id),
  jogador_id text not null references jogadores(id),
  primary key (time_rodada_id, jogador_id)
);

create table checkins (
  id text primary key,
  data date not null,
  jogador_id text references jogadores(id),
  jogador_nome text,
  estrelas numeric(3,1),
  sexo text,
  estrelas_ajustadas numeric(3,1)
);

-- Usuários/perfis
create table usuarios (
  email text primary key,
  nome text,
  perfil text not null default 'jogador' check (perfil in ('jogador','organizador','admin')),
  jogador_id text references jogadores(id),
  criado_em timestamptz not null default now(),
  jogador_id_pendente text references jogadores(id)
);

-- Config
create table config (
  chave text primary key,
  valor text
);

-- Financeiro
create table fin_dias (
  data date primary key,
  valor_pessoa numeric(10,2),
  pix text,
  valor_quadra numeric(10,2),
  tem_brinde boolean,
  valor_brinde numeric(10,2),
  atualizado_por text,
  atualizado_em timestamptz,
  icone text,
  status text not null default 'normal' check (status in ('normal','semjogo'))
);

create table fin_pagamentos (
  id text primary key,
  data date references fin_dias(data),
  jogador_id text references jogadores(id),
  jogador_nome text,
  valor numeric(10,2),
  marcado_por text,
  marcado_em timestamptz,
  estornado boolean not null default false,
  estornado_por text,
  estornado_em timestamptz,
  tipo text not null default 'dinheiro' check (tipo in ('dinheiro','credito')),
  credito_id text -- FK adicionada depois de fin_creditos existir (ver abaixo)
);

create table fin_creditos (
  id text primary key,
  jogador_id text references jogadores(id),
  jogador_nome text,
  valor numeric(10,2),
  origem_pagamento_id text references fin_pagamentos(id),
  data_origem date,
  criado_por text,
  criado_em timestamptz,
  status text check (status in ('ativo','devolvido','cancelado')),
  encerrado_por text,
  encerrado_em timestamptz
);

alter table fin_pagamentos
  add constraint fin_pagamentos_credito_id_fkey
  foreign key (credito_id) references fin_creditos(id);

create table fin_lancamentos (
  id text primary key,
  data date,
  tipo text check (tipo in ('entrada','saida')),
  descricao text,
  valor numeric(10,2),
  criado_por text,
  criado_em timestamptz,
  estornado boolean not null default false,
  estornado_por text,
  estornado_em timestamptz
);

create table fin_log (
  id bigint generated always as identity primary key,
  timestamp timestamptz,
  nome text,
  email text,
  acao text,
  detalhe jsonb
);

-- Ao Vivo (efêmero — normalmente vazio no momento da migração)
create table ao_vivo (
  id bigint generated always as identity primary key,
  round_id text references rodadas(round_id),
  time_index int,
  time_nome text,
  vitorias int,
  iniciado_em timestamptz,
  duracao_minutos int
);

create table ao_vivo_log (
  id bigint generated always as identity primary key,
  round_id text,
  time_index int,
  time_nome text,
  delta int,
  "timestamp" timestamptz
);

-- RLS: habilita em todas, sem política nenhuma por enquanto (sub-projeto 2 desenha as políticas)
alter table jogadores enable row level security;
alter table rodadas enable row level security;
alter table times_rodada enable row level security;
alter table time_jogadores enable row level security;
alter table checkins enable row level security;
alter table usuarios enable row level security;
alter table config enable row level security;
alter table fin_dias enable row level security;
alter table fin_pagamentos enable row level security;
alter table fin_creditos enable row level security;
alter table fin_lancamentos enable row level security;
alter table fin_log enable row level security;
alter table ao_vivo enable row level security;
alter table ao_vivo_log enable row level security;
