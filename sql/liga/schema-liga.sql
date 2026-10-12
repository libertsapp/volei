-- Amistosos entre grupos (spec docs/superpowers/specs/2026-10-12-amistosos-entre-grupos-design.md).
-- Schema COMPARTILHADO entre todos os grupos: roda UMA vez só (não existe versão "meme" deste arquivo, e o
-- gerar-sql-grupo NÃO deve processá-lo). QUEM RODA: o usuário, no SQL Editor do Supabase.
-- Depois de rodar: Configurações > API > "Exposed schemas": acrescentar "liga" (igual foi feito com "meme").
create schema if not exists liga;
grant usage on schema liga to service_role;

-- diretório de grupos: grupo novo = uma linha aqui + a Edge Function dele com grupoId igual ao id
create table if not exists liga.grupos (
  id text primary key,
  nome text not null,
  logo_url text,
  cor text,
  ativo boolean not null default true
);

create table if not exists liga.amistosos (
  id uuid primary key,
  grupo_convidante text not null references liga.grupos(id),
  grupo_convidado text not null references liga.grupos(id),
  data date not null,
  horario text not null,
  local text not null default '',
  vagas_por_grupo int not null default 6 check (vagas_por_grupo between 1 and 30),
  status text not null check (status in ('pendente', 'marcado', 'aguardando_confirmacao', 'encerrado', 'recusado', 'cancelado')),
  vez_de text references liga.grupos(id),
  sets_convidante int,
  sets_convidado int,
  parciais jsonb,
  placar_lancado_por_grupo text references liga.grupos(id),
  placar_lancado_em timestamptz,
  motivo_cancelamento text,
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (grupo_convidante <> grupo_convidado)
);
create index if not exists amistosos_convidante_idx on liga.amistosos (grupo_convidante);
create index if not exists amistosos_convidado_idx on liga.amistosos (grupo_convidado);

-- histórico do convite: é a "troca de informação" entre os grupos (não existe chat livre)
create table if not exists liga.amistoso_mensagens (
  id uuid primary key,
  amistoso_id uuid not null references liga.amistosos(id) on delete cascade,
  grupo text not null references liga.grupos(id),
  autor_nome text not null default '',
  tipo text not null check (tipo in ('convite', 'contraproposta', 'aceite', 'recusa', 'cancelamento', 'placar', 'confirmacao', 'contestacao', 'recado')),
  texto text not null default '' check (char_length(texto) <= 500),
  criado_em timestamptz not null default now()
);
create index if not exists amistoso_mensagens_amistoso_idx on liga.amistoso_mensagens (amistoso_id);

-- convocação: jogador_id é o id NO SCHEMA DO GRUPO (public.jogadores do Terça, meme.jogadores do Meme) — sem
-- chave estrangeira de propósito (cada grupo tem a sua tabela). nome/foto são copiados para o adversário exibir
-- sem precisar ler o schema do outro grupo.
create table if not exists liga.escalacoes (
  id uuid primary key,
  amistoso_id uuid not null references liga.amistosos(id) on delete cascade,
  grupo text not null references liga.grupos(id),
  jogador_id text not null,
  nome text not null,
  foto_url text,
  status text not null default 'interessado' check (status in ('interessado', 'confirmado')),
  criado_em timestamptz not null default now(),
  unique (amistoso_id, grupo, jogador_id)
);

-- a linha existir = a lista daquele grupo naquele amistoso está travada
create table if not exists liga.travas_escalacao (
  amistoso_id uuid not null references liga.amistosos(id) on delete cascade,
  grupo text not null references liga.grupos(id),
  primary key (amistoso_id, grupo)
);

-- RLS ligado e sem políticas (igual às outras tabelas): o navegador nunca fala com o banco direto, só a função (service_role)
alter table liga.grupos enable row level security;
alter table liga.amistosos enable row level security;
alter table liga.amistoso_mensagens enable row level security;
alter table liga.escalacoes enable row level security;
alter table liga.travas_escalacao enable row level security;
grant select, insert, update, delete on all tables in schema liga to service_role;

-- cores aproximadas da identidade de cada app (dá pra ajustar depois com um update)
insert into liga.grupos (id, nome, cor) values
  ('terca', 'Vôlei de Terça', '#ffd700'),
  ('meme', 'Vôlei Meme Brasil', '#b3790a')
on conflict (id) do nothing;
