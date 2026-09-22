# Terça no Supabase — Sub-projeto 1: Schema + Migração de Dados (Design)

## Contexto e objetivo

Criar uma **segunda versão** do Vôlei de Terça (aprendizado/comparação, não substitui a versão
em produção no Google Sheets/Apps Script), rodando sobre **Supabase** (Postgres) em vez de
Google Sheets. A motivação é curiosidade/aprendizado, não uma dor específica com o Apps Script
atual.

O projeto completo ("Terça no Supabase") tem **6 sub-projetos**, cada um com seu próprio ciclo
spec → plano → implementação:

1. **Schema + migração de dados** (este documento)
2. Login + perfis (Google Auth ligado ao Supabase, mesma matriz jogador/organizador/admin)
3. Núcleo (jogadores, sorteio, check-in) lendo/escrevendo do Supabase
4. Financeiro (incluindo crédito/dia sem jogo)
5. Ao Vivo (candidato a usar Supabase Realtime em vez do polling atual)
6. Hall da Fama e o restante

Este spec cobre **só o sub-projeto 1**: criar as tabelas no Supabase e trazer uma cópia única
dos dados reais do Terça pra lá. Os sub-projetos 2-6 ficam para specs futuras — nenhum deles é
implementado aqui.

## Decisões

- **Cópia única, sem sincronização contínua.** A partir da migração, a versão Supabase vive
  separada da planilha real do Terça — não há replicação em andamento entre as duas.
- **IDs originais preservados como texto.** `j0`, `p1`, `r1`, etc. continuam sendo a chave
  primária (tipo `text`), em vez de gerar `uuid` novo — evita remapear referências em todas as
  tabelas durante a migração, sem abrir mão de chaves estrangeiras de verdade.
- **Schema relacional "de verdade"**: chaves estrangeiras entre tabelas, `check` constraints
  fazendo o papel de enum, tipos nativos (`numeric` pra dinheiro, `date`/`timestamptz` pra
  datas, `boolean` de verdade em vez de texto `"TRUE"/"FALSE"`, `jsonb` pra dados
  semi-estruturados como o campo `detalhe` do log financeiro).
- **RLS adiado pro sub-projeto 2.** As tabelas nascem com Row Level Security **habilitado e sem
  nenhuma política** (ninguém acessa via `anon key` até o sub-projeto 2 desenhar as políticas de
  permissão) — postura seguramente fechada por padrão. O script de migração usa a
  `service_role key`, que ignora RLS.
- **Migração via API do Google Sheets** (não exportação manual de CSV) — service account com
  acesso de leitura à planilha do Terça.
- Projeto Supabase já existe: URL e chaves guardadas em `.env` (fora do git, ver `.gitignore`).

## Schema (DDL)

```sql
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
```

## Script de migração

**Pré-requisito — service account do Google:**
1. Google Cloud Console → criar/usar um projeto → habilitar a **Google Sheets API**.
2. Criar uma **Service Account**, gerar chave JSON.
3. Compartilhar a planilha do Terça (ID `1dBAYE5IuUPxEBW75lILO-jqTrJrM11DsFGkpHeKg0iQ`) com o
   `client_email` da service account, como leitor.
4. Guardar o JSON fora do git (mesma pasta/lógica do `.env`).

**Arquivo:** `scripts/migrar-terca-supabase.js` (versionado — só lê credenciais do `.env`, não
contém segredo nenhum).

**Dependências novas** (`package.json` na raiz, criado se não existir):
`googleapis`, `@supabase/supabase-js`, `dotenv`.

**Lógica:**
1. Carrega `.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, caminho da chave do Google,
   `SPREADSHEET_ID` (o do Terça).
2. Autentica com `googleapis` (JWT da service account) e lê cada aba (`Jogadores`, `Rodadas`,
   `Config`, `Checkins`, `Usuarios`, `FinDias`, `FinPagamentos`, `FinCreditos`,
   `FinLancamentos`, `FinLog`, `AoVivo`, `AoVivoLog`) como valores brutos.
3. Transforma cada linha pro formato novo:
   - `"TRUE"/"FALSE"` (texto) → `boolean`
   - `Rodadas.jogadores` (`"j0,j1,j2"` numa célula) → linhas separadas em `time_jogadores`
   - `FinLog.detalhe` (JSON serializado em texto) → `jsonb` (`JSON.parse`)
   - datas em texto → `date`/`timestamptz`
4. Grava no Supabase com `@supabase/supabase-js` (cliente com a `service_role key`, que ignora
   RLS) usando `upsert` (nunca `insert` puro) em cada tabela — rodar o script de novo não
   duplica nada.
5. **Ordem de gravação** (respeita as chaves estrangeiras):
   `jogadores` → `usuarios` → `config` → `rodadas` → `times_rodada` → `time_jogadores` →
   `checkins` → `fin_dias` → `fin_pagamentos` (com `credito_id` nulo por enquanto) →
   `fin_creditos` (já pode referenciar `origem_pagamento_id`, que existe desde o passo
   anterior) → `update` em `fin_pagamentos` preenchendo `credito_id` de quem pagou com crédito
   → `fin_lancamentos` → `fin_log` → `ao_vivo` → `ao_vivo_log`.
6. Ao final, imprime um resumo com a contagem de linhas gravadas por tabela.
7. Se uma linha violar uma chave estrangeira (ex.: um pagamento com uma data que não existe em
   `fin_dias` — dado real de planilha pode ter inconsistências que a planilha nunca barrou), o
   script **não aborta a migração inteira**: registra a linha problemática no resumo final (com
   motivo) e segue pras próximas, pra depois decidir à mão o que fazer com cada exceção.

## Validação

- Comparar a contagem de linhas de cada aba do Sheets com `select count(*)` da tabela
  correspondente no Supabase.
- Conferir manualmente alguns registros conhecidos (um jogador, uma rodada com seus dois times,
  um pagamento, um crédito) direto no Table Editor do Supabase.
- Rodar o script uma segunda vez e confirmar que as contagens não mudam (idempotência do
  `upsert`).

## Fora de escopo (fica para sub-projetos futuros)

- Qualquer código de aplicação (frontend ou backend) que leia/escreva no Supabase — este
  sub-projeto só cria o banco e copia os dados uma vez.
- Políticas de RLS (sub-projeto 2, junto com login/perfis).
- Sincronização contínua com a planilha real do Terça — não existe e não está planejada.
