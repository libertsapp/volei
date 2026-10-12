# Grupos independentes (criação em um clique) — design

Data: 2026-10-12 · Status: aguardando revisão do usuário

## Objetivo

Qualquer pessoa cria, sozinha e de graça, o app do próprio grupo de vôlei: loga com Google, escolhe nome, endereço,
cidade e cor, e em segundos tem um app completo (o mesmo do Vôlei de Terça) em `volei.memberstars.com/<apelido>`,
já participando da rede de amistosos. Ninguém precisa mexer no Supabase, no GitHub ou no DNS por grupo.

**Sucesso:** uma pessoa que nunca falou com o dono do sistema abre `volei.memberstars.com/criar`, cria o grupo
"Vôlei de Quinta" (`/quinta`, Belo Horizonte/MG), cadastra jogadores, abre check-in, instala o app no celular, recebe
notificações e convida o Terça para um amistoso — e nada disso enxerga ou altera dados de outro grupo.

## Decisões tomadas (com o usuário, 2026-10-12)

| Tema | Decisão |
|---|---|
| Quem cria | Qualquer pessoa, sozinha (self-service) |
| Terça e Meme | Ficam como estão; sistema novo nasce em paralelo; migração deles é projeto futuro separado |
| Cobrança | Grátis agora; cada grupo nasce com `plano = 'gratis'` para cobrança futura |
| Endereço | `volei.memberstars.com/<apelido>` (subdomínio no Vercel; CNAME no GoDaddy, uma vez) |
| Isolamento | Tabelas compartilhadas com `grupo_id` + repositório que aplica o filtro em tudo |
| Cidade | Obrigatória (cidade + UF), usada para achar adversário de amistoso |
| Limite | 1 grupo por e-mail (configurável no banco) |
| App | O próprio `volei-dashboard.html` ganha "modo grupo"; fora dele continua sendo o Terça |

## Fora do escopo desta versão

Cobrança/pagamento · painel do dono do sistema (operação por SQL) · migração do Terça e do Meme · transferir posse ou
apagar grupo pela tela · domínio próprio por grupo · mudanças no app do Meme (só ganha cidade/UF na `liga`).

## Arquitetura

```
volei.memberstars.com/<apelido>  ──(Vercel: qualquer caminho → mesmo index.html)──▶  volei-dashboard.html em "modo grupo"
                                                                                         │  POST/GET com apelido
                                                                                         ▼
                                                              Edge Function grupos-api (código backend/ de sempre)
                                                                 │ resolve apelido → grupo_id (grupos.grupos)
                                                                 ▼
                                               criarRepoMultigrupo(cliente, grupoId)  ← aplica grupo_id em TUDO
                                                                 │
                                         schema "grupos" (20 tabelas com grupo_id) · bucket fotos-grupos/<grupo_id>/
                                         schema "liga" (amistosos, compartilhado com Terça e Meme)
```

O domínio do app (handler, check-in, financeiro, rodadas, Ao Vivo, notificações, amistosos) **não muda**: ele recebe
um repositório com a mesma interface do `repo-supabase` de hoje. A única peça que sabe que existem vários grupos é o
repositório multigrupo (e a resolução do apelido na entrada da função).

## Modelo de dados (`sql/grupos/schema-grupos.sql`)

### `grupos.grupos`

| coluna | tipo | regra |
|---|---|---|
| id | uuid PK | |
| apelido | text unique | `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$` (3–30), sem `--`, fora da lista de reservados |
| nome | text | 3–60 caracteres |
| cidade | text | normalizada (trim, espaços únicos, primeira letra de cada palavra maiúscula) |
| uf | char(2) | uma das 27 UFs |
| cor_destaque | text | hex de uma paleta fixa oferecida na criação |
| logo_url | text | opcional |
| plano | text | default `'gratis'` |
| status | text | `'ativo'` / `'suspenso'` |
| dono_email | text | e-mail de quem criou |
| criado_em | timestamptz | |

Reservados (lista no SQL e no backend): `criar, admin, api, app, www, static, assets, sw, login, ajuda, suporte,
termos, privacidade, volei, voleimeme, terca, meme, memberstars` + lista curta de palavrões.

### `grupos.limites` (uma linha, configurável)

`max_grupos_por_email` (1), `max_jogadores_por_grupo` (150), `max_foto_kb` (300), `max_criacoes_por_ip_hora` (3).

### As 20 tabelas (18 do app + 2 de infraestrutura), com `grupo_id`

`jogadores, rodadas, times_rodada, time_jogadores, checkins, config, usuarios, sessoes, push_inscricoes, fin_dias,
fin_pagamentos, fin_creditos, fin_lancamentos, fin_pendencias, fin_log, fin_jogos, ao_vivo, ao_vivo_log` + `travas` e
`limite_tentativas` (infra). Mesmas colunas de `public` (fonte: `sql/schema-terca-supabase*.sql`), mais
`grupo_id uuid not null references grupos.grupos(id) on delete cascade`.

- Chaves únicas viram **por grupo**: ex. `usuarios (grupo_id, email)`, `config (grupo_id, chave)`,
  `fin_dias (grupo_id, data)`, `sessoes.token_hash` continua único global (é aleatório) mas a sessão carrega `grupo_id`
  e só vale no grupo dela.
- Todo índice começa por `grupo_id`.
- Colunas "ordem" (sequências) passam a ser calculadas por grupo.
- RLS ligado sem políticas (só a função, com service_role, acessa).

### As 10 funções do banco

`gravar_rodada, remover_rodada, pegar_trava, soltar_trava, registrar_tentativa, limpar_falhas, incrementar_acesso,
mover_checkin_de_jogo, mover_jogo2_para_jogo1, mover_fila_para_jogo` — versões em `grupos.` com primeiro parâmetro
`p_grupo_id`, tocando só linhas daquele grupo. A trava de gravação é por grupo (chave `(grupo_id, nome)`).

### `criar_grupo(...)` (função SQL, uma transação)

Valida limites e apelido, cria `grupos.grupos`, a config padrão (mesmos defaults do Terça: 16 vagas, estrelas visíveis…),
o usuário dono como `admin`, e a linha em `liga.grupos` (`id = apelido`, nome, cor, cidade, uf). Tudo ou nada.

### Mudanças na `liga`

`alter table liga.grupos add column cidade text, add column uf char(2)`; `update` dando a cidade/UF do Terça e do Meme
(o usuário informa os valores ao rodar o SQL). `mapearLiga` passa a devolver `cidade`/`uf` de cada grupo.

### Fotos

Bucket público `fotos-grupos`, caminho `<grupo_id>/<arquivo>`. O armazenamento recebe o prefixo do grupo; apagar foto
antiga só aceita caminho dentro do prefixo do próprio grupo.

## Backend

### `backend/repo-multigrupo.js`

`criarRepoMultigrupo(cliente, grupoId)` com **exatamente a interface** de `criarRepoSupabase` (mesmos métodos, mesmos
retornos). Toda consulta recebe `.eq('grupo_id', grupoId)`, todo insert/upsert recebe `grupo_id: grupoId`, toda chamada
de função SQL recebe `p_grupo_id: grupoId`. `lerTudo()` devolve só linhas do grupo. Um repositório em memória
equivalente (`repo-multigrupo-memoria.js`, ou o `repo-memoria` com um modo multigrupo) serve aos testes.

### Função `grupos-api`

- Entrada: o apelido vem em `?g=<apelido>` no GET e no campo `grupo` do corpo no POST.
- Resolve o apelido → grupo (cache curto em memória da instância). Inexistente → `{ error: 'Grupo não encontrado.', codigo: 'grupo_inexistente' }`;
  suspenso → `codigo: 'grupo_suspenso'`.
- Monta `criarHandler({ repo: criarRepoMultigrupo(cliente, grupo.id), armazenamento (prefixo do grupo),
  liga: { repo, grupoId: grupo.apelido }, ... })` por requisição. O handler e todo o domínio são os de sempre.
- A sessão do app guarda `grupo_id`; uma sessão de outro grupo é recusada como expirada.
- O GET inclui `grupo: { apelido, nome, cidade, uf, cor, logoUrl, plano }` para o app se vestir.
- Ações novas, fora do handler de grupo: `verificarApelido` (disponível? público, limitado por IP) e `criarGrupo`
  (exige login Google; aplica limite por e-mail e por IP; chama `criar_grupo`).
- Tetos: `addPlayer` recusa acima de `max_jogadores_por_grupo`; `uploadPhoto` recusa acima de `max_foto_kb`.
- Segredos próprios: `GRUPOS_ORIGENS_PERMITIDAS` (`https://volei.memberstars.com`), `GOOGLE_CLIENT_ID` e VAPID
  compartilhados, sem chave mestra.

## App: "modo grupo" no `volei-dashboard.html`

- **Ativação:** `location.hostname === 'volei.memberstars.com'` (lista configurável no topo do script). Fora disso,
  nada muda (Terça).
- **Apelido:** primeiro segmento do caminho (`/quinta/...`). Vazio → página de criação; `criar` → página de criação.
- **API:** `SHEET_API_URL` aponta para `grupos-api`; todo GET leva `?g=` e todo POST leva `grupo`.
- **Identidade:** nome (título, cabeçalho, manifesto, textos de WhatsApp e de bug), cor de destaque (tokens CSS hoje
  amarelos do Terça), logo ou círculo com iniciais na cor do grupo. Todo texto hoje fixo "Vôlei de Terça"/"Volei de
  Terça" no código passa por uma função `nomeDoGrupo()` que, fora do modo grupo, devolve o nome de sempre.
- **App instalável por grupo:** manifesto com `name`/`short_name` do grupo, `start_url` e `scope` = `/<apelido>/`;
  Service Worker registrado em `/<apelido>/sw.js` (rewrite no Vercel para o mesmo `sw.js`), então cada grupo é um app
  separado no celular, com notificações separadas.
- **Chaves do aparelho por grupo:** login, cópia de dados e avisos ganham o apelido (`volei-g-<apelido>-auth-v1` etc.),
  porque todos os grupos dividem o localStorage de `volei.memberstars.com`.
- **Telas especiais:** grupo inexistente ("Esse grupo não existe. Quer criar o seu?"), suspenso ("Grupo indisponível"),
  e boas-vindas no primeiro acesso do dono (cadastrar jogadores, abrir check-in, instalar o app).
- **Página de criação** (mesmo HTML, outra tela): login Google → nome, apelido (verificação de disponibilidade enquanto
  digita, com sugestão a partir do nome), cidade + UF (lista), cor (paleta fixa) → "Criar meu grupo" → redireciona para
  `/<apelido>/` já logado como admin.
- **Amistosos com cidade:** no "+ Convidar grupo", lista dividida em "Na sua cidade" e "Outras cidades", com filtro por UF
  (vale também para o Terça e o Meme, que ganham cidade na `liga`).

## Hospedagem e configuração única (feita pelo usuário)

1. GoDaddy: CNAME `volei` → Vercel.
2. Vercel: projeto/domínio `volei.memberstars.com`; `vercel.json` com rewrites `/:apelido/sw.js → /sw.js` e
   `/(.*) → /index.html` (menos arquivos reais).
3. Google Cloud: `https://volei.memberstars.com` em "Origens JavaScript autorizadas".
4. Supabase: rodar `sql/grupos/schema-grupos.sql` e o ajuste da `liga`; expor o schema `grupos`; segredos e deploy da
   `grupos-api`.

## Erros

- Apelido em uso / inválido / reservado → mensagem na hora, na tela de criação.
- Segundo grupo do mesmo e-mail → "Por enquanto cada pessoa pode criar 1 grupo."
- Muitas criações do mesmo IP → "Muitas tentativas, tente mais tarde."
- Grupo inexistente/suspenso → telas especiais, sem erro técnico.
- Schema `grupos` ausente → `grupos-api` responde erro claro com a dica do SQL; Terça e Meme não são afetados.
- Teto atingido (jogadores, foto) → mensagem com o limite.

## Testes

- **Isolamento (o mais importante):** dois grupos no mesmo repositório de teste; todas as ações do handler executadas
  no grupo A; conferência tabela a tabela de que nada do grupo B foi lido nem alterado; sessão e apelido de outro grupo
  não dão acesso; foto de outro grupo não pode ser apagada.
- **Paridade de interface:** `repo-multigrupo` expõe os mesmos métodos que `repo-supabase` (teste compara as chaves) e,
  com cliente falso, cada método filtra/grava `grupo_id`.
- **Criação:** transação tudo-ou-nada, apelido repetido/inválido/reservado, 1 por e-mail, limite por IP, linha na `liga`.
- **Terça intacto:** suíte atual inteira verde + teste de que, fora do host do modo grupo, URL da API, chaves do aparelho
  e textos são os de antes.
- **Front puro:** extração do apelido do caminho, chaves por grupo, normalização de cidade, `nomeDoGrupo()`.
- **Navegador (servidor descartável em memória + Chrome headless):** criar grupo, identidade aplicada, check-in,
  instalação (manifesto do grupo), grupo inexistente.

## Ordem de entrega

O escopo é grande: o plano de implementação será dividido em fases (uma por item abaixo), cada uma testada e
entregue antes da próxima.


1. Banco: `sql/grupos/schema-grupos.sql` (+ `criar_grupo`) e ajuste da `liga` (cidade/UF).
2. Backend: `repo-multigrupo` (+ memória), `grupos-api`, `verificarApelido`/`criarGrupo`, tetos.
3. App: modo grupo no `volei-dashboard.html` + página de criação + boas-vindas. Versão no rodapé: **v18.0**.
4. Hospedagem: Vercel + DNS + Google (passos do usuário) e publicação.
5. Amistosos com cidade (Terça; Meme só depois de autorização, como sempre).
